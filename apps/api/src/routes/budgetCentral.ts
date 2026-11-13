/**
 * Central do orçamento (prompt master do Orçamento): uma tela, um registro por lançamento do planejamento ao pagamento.
 * - Indicadores consolidados, filtros, tabela em DRE e painel do lançamento (planejamento, aprovação, execução,
 *   financeiro, auditoria e resultado).
 * - Aprovação contextual da Diretoria: integral, parcial, com condições (valor-alvo e valor-limite), rejeição,
 *   revisão e questionamentos; lote com decisão individual por item.
 * - Execução até o teto autorizado; acima, só com o Budget Guardião (consumo da reserva com trava).
 * - Financeiro: títulos e parcelas, pagamentos parciais, juros, multa, desconto, estorno e conciliação (idempotentes).
 * Cálculos: @isp/domain/budgetLedger (um lugar só).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  APPROVAL_STATE_LABELS, BUDGET_DECISIONS, BUDGET_DECISION_LABELS, EDITABLE_STATES, DECIDABLE_STATES, EXECUTION_STATES, EXPENSE_TYPES, PAYMENT_METHODS, BUDGET_PRIORITIES, QUESTION_KINDS, QUESTION_KIND_LABELS, BUDGET_UNITS,
  ceilingOf, coarseStatus, consolidateBudget, costCenterAlert, decisionOutcome, executionCheck, isApproved, lineFigures, lineFinancial, milliToQty, payableSituation, planStatusOf, qtyToMilli, quarterOfMonth,
  splitInstallments, totalCents, type ApprovalState, type ExecutionState, type LineStatus, type PaymentInput, type PlanStatus,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { brl } from '../services/email';
import { accountsOf, costCenterRole, costCentersOf, decidesStages, isBudgetAdmin, isFinance, loadCostCenter, logBudget, nextLineCode } from '../services/budget';
import { groupBy } from '../services/group';
import { todayIn } from '../services/vacations';
import { detectAttachment } from './sprint';

const M = { module: 'orcamento' as const, tag: 'Orçamento' };
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM');
const cents = z.number().int().positive().max(100_000_000_000);
const cents0 = z.number().int().min(0).max(100_000_000_000);
const qty = z.union([z.string(), z.number()]).transform((v, ctx) => { try { return qtyToMilli(v); } catch { ctx.addIssue({ code: 'custom', message: 'Quantidade com até 3 casas decimais' }); return z.NEVER; } });
const Doc = z.object({ name: z.string().trim().min(1).max(200), data: z.string().min(1).max(7_000_000) });

type Line = typeof s.budgetLines.$inferSelect;
type CC = typeof s.costCenters.$inferSelect;

// ------------------------------------------------------------------ acesso
/** O que a pessoa faz num centro de custo (o backend decide; a tela só reflete). */
function ccAccess(auth: AuthContext, c: CC) {
  const role = costCenterRole(c, auth.userId);
  const oversees = c.managerId === auth.userId || c.directorId === auth.userId;
  const admin = isBudgetAdmin(auth);
  return { see: admin || role !== null || oversees || isFinance(auth), plan: admin || role === 'dono', execute: admin || role !== null, oversees };
}
async function visibleCostCenters(db: DbOrTx, auth: AuthContext) {
  await costCentersOf(db, auth); // garante os centros dos times
  const all = await db.select().from(s.costCenters).where(and(eq(s.costCenters.tenantId, auth.tenantId), eq(s.costCenters.active, true))).orderBy(s.costCenters.code);
  return all.filter((c) => ccAccess(auth, c).see);
}
async function loadLine(db: DbOrTx, auth: AuthContext, id: string, lock = false) {
  const q = db.select().from(s.budgetLines).where(and(eq(s.budgetLines.id, id), eq(s.budgetLines.tenantId, auth.tenantId), isNull(s.budgetLines.deletedAt))).limit(1);
  const [l] = lock ? await q.for('update') : await q;
  if (!l) throw notFound('Lançamento não encontrado.');
  const [c] = await db.select().from(s.costCenters).where(eq(s.costCenters.id, l.costCenterId)).limit(1);
  if (!c || !ccAccess(auth, c).see) throw notFound('Lançamento não encontrado.');
  return { l, c, access: ccAccess(auth, c) };
}
const stageOf = (auth: AuthContext) => (auth.profiles.includes('diretoria') || auth.profiles.includes('gerencia') ? 'diretoria' : 'gerencia');
const canDecide = (auth: AuthContext, l: Line) => {
  const st = decidesStages(auth);
  return st.includes((l.approvalStage ?? 'diretoria') as 'gerencia' | 'diretoria') && l.createdBy !== auth.userId && l.ownerId !== auth.userId;
};

async function logLine(db: DbOrTx, auth: AuthContext, l: Pick<Line, 'id' | 'costCenterId' | 'code'>, action: string, summary: string, data?: Record<string, unknown>) {
  await db.insert(s.budgetEvents).values({ tenantId: auth.tenantId, costCenterId: l.costCenterId, entity: 'item', entityId: l.id, action, summary: `${l.code ?? 'Lançamento'}: ${summary}`, data: data ?? null, actorId: auth.userId });
}
/** Diferenças campo a campo (valor anterior e novo) para a auditoria. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(after).filter((k) => after[k] !== undefined && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => ({ field: k, before: before[k] ?? null, after: after[k] ?? null }));
}
async function syncPlan(db: DbOrTx, planId: string) {
  const lines = await db.select({ status: s.budgetLines.status }).from(s.budgetLines).where(and(eq(s.budgetLines.planId, planId), isNull(s.budgetLines.deletedAt)));
  const [p] = await db.select({ status: s.budgetPlans.status }).from(s.budgetPlans).where(eq(s.budgetPlans.id, planId)).limit(1);
  const st = planStatusOf(lines as { status: LineStatus }[], (p?.status ?? 'rascunho') as PlanStatus);
  await db.update(s.budgetPlans).set({ status: st, updatedAt: new Date() }).where(eq(s.budgetPlans.id, planId));
}
async function planFor(db: DbOrTx, auth: AuthContext, ccId: string, m: string) {
  const year = Number(m.slice(0, 4)), quarter = quarterOfMonth(m);
  await db.insert(s.budgetPlans).values({ tenantId: auth.tenantId, costCenterId: ccId, year, quarter }).onConflictDoNothing();
  const [p] = await db.select().from(s.budgetPlans).where(and(eq(s.budgetPlans.costCenterId, ccId), eq(s.budgetPlans.year, year), eq(s.budgetPlans.quarter, quarter))).limit(1);
  return p!;
}
async function policyOf(db: DbOrTx, tenantId: string) {
  const [p] = await db.select().from(s.budgetPolicies).where(eq(s.budgetPolicies.tenantId, tenantId)).limit(1);
  return p ?? { tenantId, alertPct: null, blockPct: null, reserveMode: 'nenhuma', globalReserveCents: null, version: 0, updatedBy: null, updatedAt: null };
}
async function readDoc(d: z.infer<typeof Doc>) {
  const data = Buffer.from(d.data, 'base64');
  if (data.length > 5_000_000) throw unprocessable('Arquivo acima de 5 MB.');
  const mime = detectAttachment(d.name, data);
  if (!mime || !['application/pdf', 'image/png', 'image/jpeg'].includes(mime)) throw unprocessable('Envie o arquivo em PDF, PNG ou JPG.');
  return { name: d.name, mime, size: data.length, data };
}

// ------------------------------------------------------------------ números (compartilhados pela central e pelo painel)
async function figuresFor(db: DbOrTx, tenantId: string, lines: Line[], today: string) {
  const ids = lines.map((l) => l.id);
  const [exps, pays, pbls, qs] = ids.length ? await Promise.all([
    db.select({ lineId: s.budgetExpenses.lineId, amountCents: s.budgetExpenses.amountCents, status: s.budgetExpenses.status, occurredOn: s.budgetExpenses.occurredOn }).from(s.budgetExpenses).where(and(eq(s.budgetExpenses.tenantId, tenantId), inArray(s.budgetExpenses.lineId, ids))),
    db.select().from(s.budgetPayments).where(and(eq(s.budgetPayments.tenantId, tenantId), inArray(s.budgetPayments.lineId, ids))),
    db.select().from(s.budgetPayables).where(and(eq(s.budgetPayables.tenantId, tenantId), inArray(s.budgetPayables.lineId, ids))),
    db.select({ lineId: s.budgetQuestions.lineId, status: s.budgetQuestions.status, blocking: s.budgetQuestions.blocking }).from(s.budgetQuestions).where(and(eq(s.budgetQuestions.tenantId, tenantId), inArray(s.budgetQuestions.lineId, ids))),
  ]) : [[], [], [], []];
  const E = groupBy(exps, (e) => e.lineId!), P = groupBy(pays, (p) => p.lineId), T = groupBy(pbls, (p) => p.lineId), Q = groupBy(qs, (q) => q.lineId!);
  return lines.map((l) => {
    const payments: PaymentInput[] = (P.get(l.id) ?? []).map((p) => ({ id: p.id, reversesId: p.reversesId, payableId: p.payableId, amountCents: p.amountCents, interestCents: p.interestCents, fineCents: p.fineCents, discountCents: p.discountCents, paidOn: p.paidOn, kind: p.kind as 'pagamento', reconciled: !!p.reconciledAt }));
    const f = lineFigures({ plannedCents: l.amountCents, approvedCents: l.approvedCents, firstApprovedCents: l.firstApprovedCents, limitCents: l.limitCents, approvalState: l.approvalState as ApprovalState, executionState: l.executionState as ExecutionState, contractedCents: l.contractedCents }, (E.get(l.id) ?? []).map((e) => ({ amountCents: e.amountCents, status: e.status as 'valido' })), payments);
    const payables = (T.get(l.id) ?? []).map((p) => ({ id: p.id, amountCents: p.amountCents, dueOn: p.dueOn, status: p.status as 'aberto' }));
    const openQuestions = (Q.get(l.id) ?? []).filter((q) => q.status !== 'resolvido' && q.blocking && q.status === 'aberto').length;
    return { l, f, financial: lineFinancial(payables, payments, today), openQuestions, payables, payments };
  });
}

const Filters = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  from: month.optional(), to: month.optional(),
  costCenterId: uuid.optional(), accountId: uuid.optional(), ownerId: uuid.optional(), projectId: uuid.optional(), campaignId: uuid.optional(), supplierId: uuid.optional(),
  approval: z.string().max(40).optional(), execution: z.string().max(40).optional(), financial: z.string().max(40).optional(), q: z.string().trim().max(100).optional(),
});

const PlanningBody = z.object({
  what: z.string().trim().min(3).max(200), how: z.string().trim().max(2000).nullable().optional(), justification: z.string().trim().max(2000).nullable().optional(), objective: z.string().trim().max(1000).nullable().optional(),
  accountId: uuid, ownerId: uuid.nullable().optional(), projectId: uuid.nullable().optional(), campaignId: uuid.nullable().optional(), supplierId: uuid.nullable().optional(),
  qty: qty.default('1'), unit: z.enum(BUDGET_UNITS).default('un'), unitCents: cents, month, plannedOn: day.nullable().optional(),
  priority: z.enum(BUDGET_PRIORITIES).default('media'), expenseType: z.enum(EXPENSE_TYPES).default('pontual'),
});

export const budgetCentralRoutes = [
  // ------------------------------------------------------------------ tela principal
  defineRoute({
    method: 'GET', url: '/budget/central', summary: 'Central do orçamento: indicadores do período e dos filtros, lançamentos com planejado, aprovado, comprometido, realizado, pago, saldo e desvio, centros com alerta e evolução mensal', ...M, query: Filters,
    handler: async ({ app, auth, query }) => {
      const today = todayIn(auth.timezone ?? 'America/Sao_Paulo');
      const ccs = await visibleCostCenters(app.db, auth);
      const ccIds = (query.costCenterId ? ccs.filter((c) => c.id === query.costCenterId) : ccs).map((c) => c.id);
      const from = query.from ?? `${query.year}-01`, to = query.to ?? `${query.year}-12`;
      const accounts = await accountsOf(app.db, auth.tenantId);
      const accIds = query.accountId ? accounts.filter((a) => a.id === query.accountId || a.code.startsWith(`${accounts.find((x) => x.id === query.accountId)?.code}.`)).map((a) => a.id) : null;
      const lines = ccIds.length ? await app.db.select().from(s.budgetLines).where(and(
        eq(s.budgetLines.tenantId, auth.tenantId), inArray(s.budgetLines.costCenterId, ccIds), isNull(s.budgetLines.deletedAt),
        sql`${s.budgetLines.month} >= ${from} and ${s.budgetLines.month} <= ${to}`,
        accIds ? inArray(s.budgetLines.accountId, accIds) : sql`true`,
        query.ownerId ? eq(s.budgetLines.ownerId, query.ownerId) : sql`true`, query.projectId ? eq(s.budgetLines.projectId, query.projectId) : sql`true`,
        query.campaignId ? eq(s.budgetLines.campaignId, query.campaignId) : sql`true`, query.supplierId ? eq(s.budgetLines.supplierId, query.supplierId) : sql`true`,
        query.approval ? eq(s.budgetLines.approvalState, query.approval) : sql`true`, query.execution ? eq(s.budgetLines.executionState, query.execution) : sql`true`,
        query.q ? sql`(${s.budgetLines.what} ilike ${`%${query.q}%`} or ${s.budgetLines.code} ilike ${`%${query.q}%`})` : sql`true`,
      )).orderBy(asc(s.budgetLines.month), asc(s.budgetLines.code)) : [];
      let rows = await figuresFor(app.db, auth.tenantId, lines, today);
      if (query.financial) rows = rows.filter((r) => r.financial === query.financial);
      // gastos sem lançamento e Budget Guardião do período
      const unlinked = ccIds.length && !query.ownerId && !query.projectId && !query.campaignId && !query.supplierId && !query.approval && !query.execution && !query.financial && !query.q
        ? await app.db.select({ cc: s.budgetExpenses.costCenterId, month: sql<string>`to_char(${s.budgetExpenses.occurredOn}, 'YYYY-MM')`, amount: s.budgetExpenses.amountCents }).from(s.budgetExpenses)
          .where(and(eq(s.budgetExpenses.tenantId, auth.tenantId), inArray(s.budgetExpenses.costCenterId, ccIds), isNull(s.budgetExpenses.lineId), eq(s.budgetExpenses.status, 'valido'), accIds ? inArray(s.budgetExpenses.accountId, accIds) : sql`true`, sql`to_char(${s.budgetExpenses.occurredOn}, 'YYYY-MM') between ${from} and ${to}`))
        : [];
      const adj = ccIds.length ? await app.db.select().from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.tenantId, auth.tenantId), inArray(s.budgetAdjustments.costCenterId, ccIds), sql`${s.budgetAdjustments.month} between ${from} and ${to}`)) : [];
      const policy = await policyOf(app.db, auth.tenantId);
      const guardianApproved = adj.filter((a) => a.kind === 'guardiao' && (a.status === 'aprovado' || a.status === 'registrado')).reduce((t, a) => t + a.deltaCents, 0);
      const excessApproved = adj.filter((a) => a.kind === 'excedente' && a.status === 'aprovado').reduce((t, a) => t + a.deltaCents, 0);
      const guardianPending = adj.filter((a) => (a.kind === 'guardiao' || a.kind === 'excedente') && a.status === 'pendente').reduce((t, a) => t + a.deltaCents, 0);
      const reserve = policy.reserveMode === 'nenhuma' ? null : (policy.reserveMode === 'centro' ? 0 : (policy.globalReserveCents ?? 0)) + (policy.reserveMode === 'global' ? 0 : ccs.filter((c) => ccIds.includes(c.id)).reduce((t, c) => t + (c.guardianReserveCents ?? 0), 0));
      const used = adj.filter((a) => a.kind === 'excedente' && a.status === 'aprovado' && a.fromReserve).reduce((t, a) => t + a.deltaCents, 0);
      const unlinkedCents = unlinked.reduce((t, e) => t + e.amount, 0);
      const kpis = consolidateBudget(rows.map((r) => ({ f: r.f, executionState: r.l.executionState as ExecutionState, sent: !['rascunho', 'planejado'].includes(r.l.approvalState) })), { unlinkedRealizedCents: unlinkedCents, guardianApprovedCents: guardianApproved, guardianPendingCents: guardianPending, guardianReserveCents: reserve, guardianUsedCents: used });
      // evolução mensal (custos pela competência; pago pela data do pagamento)
      const months: string[] = [];
      for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5)); `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, m = 1) : m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
      const series = months.map((m) => {
        const rs = rows.filter((r) => r.l.month === m);
        const sum = (k: 'original' | 'approved' | 'committed' | 'realized') => rs.reduce((t, r) => t + r.f[k], 0);
        const paid = rows.reduce((t, r) => t + r.payments.filter((p) => p.paidOn.slice(0, 7) === m).reduce((a, p) => a + (p.kind === 'estorno' ? -p.amountCents : p.amountCents), 0), 0);
        const adjM = adj.filter((a) => a.month === m && a.kind === 'guardiao' && (a.status === 'aprovado' || a.status === 'registrado')).reduce((t, a) => t + a.deltaCents, 0);
        const unl = unlinked.filter((e) => e.month === m).reduce((t, e) => t + e.amount, 0);
        return { month: m, original: sum('original'), revised: sum('approved') + adjM, approved: sum('approved'), committed: sum('committed'), realized: sum('realized') + unl, paid, projection: rs.reduce((t, r) => t + (r.l.executionState === 'encerrado' ? r.f.consumption : Math.max(r.f.approved, r.f.consumption)), 0) + unl };
      });
      // centros: autorizado, consumo e alerta pela política (limites próprios do centro valem sobre os da empresa)
      const byCc = groupBy(rows, (r) => r.l.costCenterId);
      const centers = ccs.filter((c) => ccIds.includes(c.id)).map((c) => {
        const rs = byCc.get(c.id) ?? [];
        const authorized = rs.reduce((t, r) => t + r.f.approved, 0) + adj.filter((a) => a.costCenterId === c.id && a.kind === 'guardiao' && (a.status === 'aprovado' || a.status === 'registrado')).reduce((t, a) => t + a.deltaCents, 0);
        const consumed = rs.reduce((t, r) => t + r.f.consumption, 0) + unlinked.filter((e) => e.cc === c.id).reduce((t, e) => t + e.amount, 0);
        const a = ccAccess(auth, c);
        return { id: c.id, code: c.code, name: c.name, authorized, consumed, alert: costCenterAlert(authorized, consumed, { alertPct: c.alertPct ?? policy.alertPct, blockPct: c.blockPct ?? policy.blockPct }), canPlan: a.plan, canExecute: a.execute };
      });
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId)).orderBy(s.users.name);
      const suppliers = await app.db.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.tenantId, auth.tenantId)).orderBy(s.suppliers.name);
      const projects = await app.db.select({ id: s.projects.id, name: s.projects.name }).from(s.projects).where(eq(s.projects.tenantId, auth.tenantId)).orderBy(s.projects.name);
      const campaigns = await app.db.select({ id: s.campaigns.id, name: s.campaigns.name }).from(s.campaigns).where(eq(s.campaigns.tenantId, auth.tenantId)).orderBy(s.campaigns.name);
      const nameOf = new Map(users.map((u) => [u.id, u.name]));
      return {
        period: { from, to }, kpis, series, centers, policy: { alertPct: policy.alertPct, blockPct: policy.blockPct, reserveMode: policy.reserveMode },
        rows: rows.map((r) => ({
          id: r.l.id, code: r.l.code, what: r.l.what, costCenterId: r.l.costCenterId, accountId: r.l.accountId, month: r.l.month, ownerId: r.l.ownerId, owner: r.l.ownerId ? nameOf.get(r.l.ownerId) ?? null : null,
          qty: milliToQty(r.l.qtyMilli), unit: r.l.unit, unitCents: r.l.unitCents, approvalState: r.l.approvalState, approvalStage: r.l.approvalStage, executionState: r.l.executionState, financial: r.financial,
          priority: r.l.priority, expenseType: r.l.expenseType, projectId: r.l.projectId, campaignId: r.l.campaignId, supplierId: r.l.supplierId, openQuestions: r.openQuestions, limitCents: r.l.limitCents, targetUnitCents: r.l.targetUnitCents,
          ...r.f, canDecide: DECIDABLE_STATES.includes(r.l.approvalState as ApprovalState) && canDecide(auth, r.l),
        })),
        accounts: accounts.map((a) => ({ id: a.id, parentId: a.parentId, code: a.code, name: a.name, leaf: a.leaf, level: a.level, nature: a.nature, active: a.active })),
        options: { costCenters: ccs.map((c) => ({ id: c.id, code: c.code, name: c.name })), users, suppliers, projects, campaigns },
        can: { decide: decidesStages(auth).length > 0, finance: isFinance(auth), admin: isBudgetAdmin(auth), director: auth.profiles.includes('diretoria') },
      };
    },
  }),

  // ------------------------------------------------------------------ painel do lançamento
  defineRoute({
    method: 'GET', url: '/budget/lines/:id', summary: 'Lançamento completo: planejamento, aprovação (perguntas e decisões), execução, financeiro (títulos, parcelas e pagamentos), auditoria e resultado', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { l, c, access } = await loadLine(app.db, auth, params.id);
      const today = todayIn(auth.timezone ?? 'America/Sao_Paulo');
      const [r] = await figuresFor(app.db, auth.tenantId, [l], today);
      const [questions, events, docs, expenses, adjustments] = await Promise.all([
        app.db.select().from(s.budgetQuestions).where(eq(s.budgetQuestions.lineId, l.id)).orderBy(asc(s.budgetQuestions.createdAt)),
        app.db.select({ id: s.budgetEvents.id, action: s.budgetEvents.action, summary: s.budgetEvents.summary, data: s.budgetEvents.data, at: s.budgetEvents.createdAt, actor: s.users.name }).from(s.budgetEvents).leftJoin(s.users, eq(s.users.id, s.budgetEvents.actorId)).where(and(eq(s.budgetEvents.entity, 'item'), eq(s.budgetEvents.entityId, l.id))).orderBy(desc(s.budgetEvents.createdAt)),
        app.db.select({ id: s.budgetDocuments.id, kind: s.budgetDocuments.kind, name: s.budgetDocuments.name, size: s.budgetDocuments.size, at: s.budgetDocuments.createdAt }).from(s.budgetDocuments).where(and(eq(s.budgetDocuments.lineId, l.id), isNull(s.budgetDocuments.deletedAt))),
        app.db.select({ id: s.budgetExpenses.id, occurredOn: s.budgetExpenses.occurredOn, description: s.budgetExpenses.description, amountCents: s.budgetExpenses.amountCents, status: s.budgetExpenses.status, docName: s.budgetExpenses.docName }).from(s.budgetExpenses).where(eq(s.budgetExpenses.lineId, l.id)).orderBy(desc(s.budgetExpenses.occurredOn)),
        app.db.select().from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.lineId, l.id))).orderBy(desc(s.budgetAdjustments.createdAt)),
      ]);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const nm = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? null : null);
      const pays = r!.payments;
      const payables = (await app.db.select().from(s.budgetPayables).where(eq(s.budgetPayables.lineId, l.id)).orderBy(asc(s.budgetPayables.dueOn), asc(s.budgetPayables.installment))).map((p) => {
        const sit = payableSituation({ id: p.id, amountCents: p.amountCents, dueOn: p.dueOn, status: p.status as 'aberto' }, pays, today);
        return { ...p, ...sit };
      });
      const paymentRows = await app.db.select().from(s.budgetPayments).where(eq(s.budgetPayments.lineId, l.id)).orderBy(asc(s.budgetPayments.createdAt));
      const editable = access.plan && EDITABLE_STATES.includes(l.approvalState as ApprovalState);
      return {
        line: { ...l, qty: milliToQty(l.qtyMilli), approvedQty: l.approvedQtyMilli ? milliToQty(l.approvedQtyMilli) : null, contractedQty: l.contractedQtyMilli ? milliToQty(l.contractedQtyMilli) : null, deliveredQty: l.deliveredQtyMilli ? milliToQty(l.deliveredQtyMilli) : null, owner: nm(l.ownerId), createdByName: nm(l.createdBy), decidedByName: nm(l.decidedBy) },
        costCenter: { id: c.id, code: c.code, name: c.name },
        figures: r!.f, financial: r!.financial, ceilingCents: isApproved(l.approvalState as ApprovalState) ? ceilingOf(l) : null,
        questions: questions.map((q) => ({ ...q, askedByName: nm(q.askedBy), toUserName: nm(q.toUserId), answeredByName: nm(q.answeredBy) })),
        events, documents: docs, expenses, adjustments: adjustments.map((a) => ({ ...a, requestedByName: nm(a.requestedBy), decidedByName: nm(a.decidedBy) })),
        payables: payables.map((p) => ({ ...p, payments: paymentRows.filter((x) => x.payableId === p.id).map((x) => ({ ...x, createdByName: nm(x.createdBy), reversed: paymentRows.some((y) => y.reversesId === x.id) })) })),
        can: {
          edit: editable, submit: editable, decide: DECIDABLE_STATES.includes(l.approvalState as ApprovalState) && canDecide(auth, l), ask: decidesStages(auth).length > 0 && l.approvalState !== 'rascunho',
          answer: access.plan || l.ownerId === auth.userId || l.createdBy === auth.userId, execute: access.execute && isApproved(l.approvalState as ApprovalState) && l.executionState !== 'encerrado',
          finance: isFinance(auth), guardian: access.plan && isApproved(l.approvalState as ApprovalState), decideGuardian: auth.profiles.includes('diretoria') && decidesStages(auth).includes('diretoria'),
        },
      };
    },
  }),

  // ------------------------------------------------------------------ planejamento
  defineRoute({
    method: 'POST', url: '/budget/central/lines', summary: 'Cria lançamento (unitário, por quantidade ou recorrente por N meses) no centro de custo, com código único', ...M,
    body: PlanningBody.extend({ costCenterId: uuid, recurrenceMonths: z.number().int().min(1).max(24).default(1) }),
    handler: async ({ app, auth, body, req, reply }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId, 'planejar');
      const accounts = await accountsOf(app.db, auth.tenantId);
      const acc = accounts.find((a) => a.id === body.accountId);
      if (!acc?.leaf || !acc.active) throw unprocessable('Escolha uma subconta ativa (conta analítica).', [{ path: 'accountId', message: 'Conta inválida' }]);
      const amount = totalCents(body.qty as unknown as number, body.unitCents);
      if (amount <= 0) throw unprocessable('O total do lançamento precisa ser maior que zero.');
      const group = body.recurrenceMonths > 1 ? crypto.randomUUID() : null;
      const created = await app.db.transaction(async (tx) => {
        const out: Line[] = [];
        for (let i = 0; i < body.recurrenceMonths; i++) {
          const mm = Number(body.month.slice(5)) - 1 + i, m = `${Number(body.month.slice(0, 4)) + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, '0')}`;
          const plan = await planFor(tx, auth, cc.id, m);
          const [l] = await tx.insert(s.budgetLines).values({
            tenantId: auth.tenantId, planId: plan.id, costCenterId: cc.id, accountId: body.accountId, what: body.what, how: body.how ?? null, justification: body.justification ?? null, objective: body.objective ?? null,
            ownerId: body.ownerId ?? auth.userId, projectId: body.projectId ?? null, campaignId: body.campaignId ?? null, supplierId: body.supplierId ?? null,
            qtyMilli: body.qty as unknown as number, unit: body.unit, unitCents: body.unitCents, amountCents: amount, month: m, plannedOn: i === 0 ? body.plannedOn ?? null : null,
            priority: body.priority, expenseType: body.recurrenceMonths > 1 ? 'recorrente' : body.expenseType, recurrenceGroupId: group, approvalState: 'planejado', status: 'rascunho',
            createdBy: auth.userId, code: await nextLineCode(tx, auth.tenantId, Number(m.slice(0, 4))),
          }).returning();
          await logLine(tx, auth, l!, 'criado', `planejado “${l!.what}” (${milliToQty(l!.qtyMilli)} × ${brl(body.unitCents)} = ${brl(amount)}) em ${m}.`, { planned: amount });
          await syncPlan(tx, plan.id);
          out.push(l!);
        }
        return out;
      });
      await audit(app.db, req, { action: 'budget.line.create', entityType: 'budget_line', entityId: created[0]!.id, metadata: { count: created.length } });
      reply.code(201);
      return { items: created.map((l) => ({ id: l.id, code: l.code, month: l.month, amountCents: l.amountCents })) };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/budget/lines/:id', summary: 'Altera o planejamento do lançamento (rascunho, planejado, em revisão ou rejeitado), com controle de versão e auditoria campo a campo', ...M, params: IdParams,
    body: PlanningBody.partial().extend({ rowVersion: z.number().int(), reason: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => {
      return app.db.transaction(async (tx) => {
        const { l, access } = await loadLine(tx, auth, params.id, true);
        if (!access.plan) throw forbidden('Só o Dono do orçamento deste centro de custo muda o planejamento.');
        if (!EDITABLE_STATES.includes(l.approvalState as ApprovalState)) throw unprocessable(`Lançamento ${APPROVAL_STATE_LABELS[l.approvalState as ApprovalState].toLowerCase()} não muda o planejamento. Depois de aprovado, valor adicional vai pelo Budget Guardião.`);
        if (body.rowVersion !== l.rowVersion) throw conflict(l.rowVersion);
        if (body.month && quarterOfMonth(body.month) !== quarterOfMonth(l.month) || body.month && body.month.slice(0, 4) !== l.month.slice(0, 4)) throw unprocessable('A competência precisa ser do mesmo trimestre.');
        const qtyM = (body.qty as unknown as number | undefined) ?? l.qtyMilli, unit = body.unitCents ?? l.unitCents ?? l.amountCents;
        const amount = totalCents(qtyM, unit);
        const next = { what: body.what, how: body.how, justification: body.justification, objective: body.objective, accountId: body.accountId, ownerId: body.ownerId, projectId: body.projectId, campaignId: body.campaignId, supplierId: body.supplierId, qtyMilli: qtyM, unit: body.unit, unitCents: unit, amountCents: amount, month: body.month, plannedOn: body.plannedOn, priority: body.priority, expenseType: body.expenseType };
        const changes = diff(l as unknown as Record<string, unknown>, next);
        if (!changes.length) return l;
        const [n] = await tx.update(s.budgetLines).set({ ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)), approvalState: l.approvalState === 'rejeitado' ? 'planejado' : l.approvalState, status: 'rascunho', updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id)).returning();
        await logLine(tx, auth, l, 'alterado', `planejamento alterado (${changes.map((c) => c.field).join(', ')}).`, { changes, reason: body.reason ?? null });
        return n;
      });
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/lines/:id/submit', summary: 'Envia o lançamento para aprovação (da liderança à Gerência; da Gerência à Diretoria)', ...M, params: IdParams,
    body: z.object({ note: z.string().trim().max(1000).nullable().optional() }).default({}),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { l, access } = await loadLine(tx, auth, params.id, true);
      if (!access.plan) throw forbidden('Só o Dono do orçamento envia para aprovação.');
      if (!EDITABLE_STATES.includes(l.approvalState as ApprovalState)) throw unprocessable('Este lançamento já foi enviado.');
      if (!l.justification?.trim()) throw unprocessable('Escreva a justificativa antes de enviar.', [{ path: 'justification', message: 'Obrigatória' }]);
      const stage = stageOf(auth);
      await tx.update(s.budgetLines).set({ approvalState: 'enviado', status: 'em_aprovacao', approvalStage: stage, updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id));
      await syncPlan(tx, l.planId);
      await logLine(tx, auth, l, 'enviado', `enviado à ${stage === 'gerencia' ? 'Gerência' : 'Diretoria'} (${brl(l.amountCents)})${body.note ? `: ${body.note}` : ''}.`, { requested: l.amountCents });
      return { ok: true, stage };
    }),
  }),

  // ------------------------------------------------------------------ questionamentos
  defineRoute({
    method: 'POST', url: '/budget/questions', summary: 'Questiona um lançamento (valor unitário, quantidade, necessidade, documentos) ou o centro de custo inteiro; obrigatório trava a aprovação até ser respondido', ...M,
    body: z.object({ lineId: uuid.nullable().optional(), costCenterId: uuid.nullable().optional(), kind: z.enum(QUESTION_KINDS), message: z.string().trim().min(5).max(2000), blocking: z.boolean().default(true), toUserId: uuid.nullable().optional() }),
    handler: async ({ app, auth, body, reply }) => {
      if (!decidesStages(auth).length) throw forbidden('Quem questiona é quem aprova (Gerência ou Diretoria).');
      const r = await app.db.transaction(async (tx) => {
        if (body.lineId) {
          const { l } = await loadLine(tx, auth, body.lineId, true);
          if (l.approvalState === 'rascunho' || l.approvalState === 'planejado') throw unprocessable('O lançamento ainda não foi enviado para aprovação.');
          const [q] = await tx.insert(s.budgetQuestions).values({ tenantId: auth.tenantId, costCenterId: l.costCenterId, lineId: l.id, kind: body.kind, message: body.message, blocking: body.blocking, askedBy: auth.userId, toUserId: body.toUserId ?? l.ownerId ?? l.createdBy }).returning();
          if (DECIDABLE_STATES.includes(l.approvalState as ApprovalState) && body.blocking) await tx.update(s.budgetLines).set({ approvalState: 'questionado', updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id));
          await logLine(tx, auth, l, 'questionado', `questionamento (${QUESTION_KIND_LABELS[body.kind]}): ${body.message}`, { questionId: q!.id, kind: body.kind });
          return q!;
        }
        if (!body.costCenterId) throw unprocessable('Informe o lançamento ou o centro de custo.');
        const cc = await loadCostCenter(tx, auth, body.costCenterId);
        const [q] = await tx.insert(s.budgetQuestions).values({ tenantId: auth.tenantId, costCenterId: cc.id, lineId: null, kind: body.kind, message: body.message, blocking: false, askedBy: auth.userId, toUserId: body.toUserId ?? cc.ownerIds[0] ?? cc.leaderId }).returning();
        await logBudget(tx, auth, cc.id, 'centro', cc.id, 'questionado', `${cc.code}: questionamento consolidado (${QUESTION_KIND_LABELS[body.kind]}): ${body.message}`);
        return q!;
      });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/questions/:id/answer', summary: 'O responsável responde o questionamento; sem outro obrigatório aberto, o lançamento volta para análise', ...M, params: IdParams,
    body: z.object({ answer: z.string().trim().min(3).max(4000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [q] = await tx.select().from(s.budgetQuestions).where(and(eq(s.budgetQuestions.id, params.id), eq(s.budgetQuestions.tenantId, auth.tenantId))).for('update').limit(1);
      if (!q) throw notFound();
      if (q.status !== 'aberto') throw unprocessable('Este questionamento já foi respondido.');
      if (q.lineId) {
        const { l, access } = await loadLine(tx, auth, q.lineId, true);
        if (!(access.plan || l.ownerId === auth.userId || l.createdBy === auth.userId || q.toUserId === auth.userId)) throw forbidden('Quem responde é o responsável pelo lançamento.');
        await tx.update(s.budgetQuestions).set({ status: 'respondido', answer: body.answer, answeredBy: auth.userId, answeredAt: new Date() }).where(eq(s.budgetQuestions.id, q.id));
        const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(s.budgetQuestions).where(and(eq(s.budgetQuestions.lineId, l.id), eq(s.budgetQuestions.status, 'aberto'), eq(s.budgetQuestions.blocking, true))) as [{ open: number }];
        if (!open && l.approvalState === 'questionado') await tx.update(s.budgetLines).set({ approvalState: 'em_analise', updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id));
        await logLine(tx, auth, l, 'respondido', `resposta ao questionamento: ${body.answer}`, { questionId: q.id });
      } else {
        const cc = await loadCostCenter(tx, auth, q.costCenterId);
        if (!(costCenterRole(cc, auth.userId) === 'dono' || q.toUserId === auth.userId || isBudgetAdmin(auth))) throw forbidden('Quem responde é o Dono do orçamento do centro.');
        await tx.update(s.budgetQuestions).set({ status: 'respondido', answer: body.answer, answeredBy: auth.userId, answeredAt: new Date() }).where(eq(s.budgetQuestions.id, q.id));
        await logBudget(tx, auth, cc.id, 'centro', cc.id, 'respondido', `${cc.code}: resposta ao questionamento consolidado: ${body.answer}`);
      }
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/budget/questions/:id/resolve', summary: 'Quem questionou dá o questionamento por resolvido', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [q] = await app.db.select().from(s.budgetQuestions).where(and(eq(s.budgetQuestions.id, params.id), eq(s.budgetQuestions.tenantId, auth.tenantId))).limit(1);
      if (!q) throw notFound();
      if (!decidesStages(auth).length) throw forbidden('Quem resolve é quem aprova.');
      if (q.status === 'aberto' && q.blocking) throw unprocessable('Aguarde a resposta do responsável antes de resolver.');
      await app.db.update(s.budgetQuestions).set({ status: 'resolvido', resolvedBy: auth.userId, resolvedAt: new Date() }).where(eq(s.budgetQuestions.id, q.id));
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ decisões (um item ou em lote; cada item com a sua decisão)
  defineRoute({
    method: 'POST', url: '/budget/decisions', summary: 'Decide lançamentos: aprovar integral, parcial ou com condições (valor-alvo e valor-limite), rejeitar ou pedir revisão. Em lote, cada item tem decisão própria e os com questionamento aberto ficam de fora', ...M,
    body: z.object({
      items: z.array(z.object({
        lineId: uuid, decision: z.enum(BUDGET_DECISIONS), approvedQty: qty.nullable().optional(), approvedCents: cents.nullable().optional(), targetUnitCents: cents.nullable().optional(), limitCents: cents.nullable().optional(),
        conditions: z.string().trim().max(2000).nullable().optional(), note: z.string().trim().max(2000).nullable().optional(),
      })).min(1).max(200),
    }),
    handler: async ({ app, auth, body, req }) => {
      if (!decidesStages(auth).length) throw forbidden('Quem aprova o orçamento é a Gerência e a Diretoria (cargo Liderança / gestor).');
      const decided: { lineId: string; code: string | null; state: string }[] = [], blocked: { lineId: string; code: string | null; reason: string }[] = [];
      for (const it of body.items) {
        const r = await app.db.transaction(async (tx) => {
          const { l } = await loadLine(tx, auth, it.lineId, true);
          if (!DECIDABLE_STATES.includes(l.approvalState as ApprovalState)) return { blocked: 'Não está aguardando decisão.' };
          if (!canDecide(auth, l)) return { blocked: l.createdBy === auth.userId || l.ownerId === auth.userId ? 'Quem pediu não decide o próprio lançamento.' : 'Está na alçada de outra pessoa.' };
          const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(s.budgetQuestions).where(and(eq(s.budgetQuestions.lineId, l.id), eq(s.budgetQuestions.status, 'aberto'), eq(s.budgetQuestions.blocking, true))) as [{ open: number }];
          if (open && it.decision !== 'rejeitar' && it.decision !== 'revisao') return { blocked: 'Há questionamento obrigatório sem resposta.' };
          const forward = l.approvalStage === 'gerencia' && !auth.profiles.includes('diretoria') && (it.decision === 'aprovar' || it.decision === 'aprovar_parcial' || it.decision === 'aprovar_condicoes');
          if (forward) {
            await tx.update(s.budgetLines).set({ approvalState: 'em_analise', approvalStage: 'diretoria', decisionNote: it.note ?? null, updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id));
            await logLine(tx, auth, l, 'aprovado_gerencia', `Gerência recomendou aprovar e enviou à Diretoria${it.note ? `: ${it.note}` : ''}.`, { decision: it.decision, recommendation: { approvedCents: it.approvedCents ?? null, limitCents: it.limitCents ?? null, targetUnitCents: it.targetUnitCents ?? null, conditions: it.conditions ?? null } });
            return { state: 'em_analise' };
          }
          const out = decisionOutcome({ decision: it.decision, requestedCents: l.amountCents, requestedQtyMilli: l.qtyMilli, approvedQtyMilli: (it.approvedQty as unknown as number | null) ?? null, approvedCents: it.approvedCents ?? null, targetUnitCents: it.targetUnitCents ?? null, limitCents: it.limitCents ?? null, conditions: it.conditions ?? null, note: it.note ?? null });
          if (!out.ok) return { blocked: out.errors.map((e) => e.message).join('; ') };
          await tx.update(s.budgetLines).set({
            approvalState: out.state, status: coarseStatus(out.state), approvalStage: null, approvedCents: out.approvedCents, approvedQtyMilli: out.approvedQtyMilli, limitCents: out.limitCents, targetUnitCents: out.targetUnitCents,
            firstApprovedCents: out.approvedCents !== null ? sql`coalesce(${s.budgetLines.firstApprovedCents}, ${out.approvedCents})` : s.budgetLines.firstApprovedCents,
            conditions: it.conditions ?? null, decisionNote: it.note ?? null, decidedBy: auth.userId, decidedAt: new Date(), updatedAt: new Date(), rowVersion: l.rowVersion + 1,
          }).where(eq(s.budgetLines.id, l.id));
          await syncPlan(tx, l.planId);
          const what = out.approvedCents !== null ? `${BUDGET_DECISION_LABELS[it.decision]}: ${brl(out.approvedCents)} de ${brl(l.amountCents)}${out.limitCents ? `, limite ${brl(out.limitCents)}` : ''}${out.targetUnitCents ? `, alvo ${brl(out.targetUnitCents)}/un.` : ''}` : BUDGET_DECISION_LABELS[it.decision];
          await logLine(tx, auth, l, it.decision, `${what}${it.conditions ? `. Condições: ${it.conditions}` : ''}${it.note ? `. ${it.note}` : ''}.`, { decision: it.decision, before: { state: l.approvalState, approvedCents: l.approvedCents }, after: { state: out.state, approvedCents: out.approvedCents, limitCents: out.limitCents, targetUnitCents: out.targetUnitCents } });
          return { state: out.state };
        });
        const code = (await app.db.select({ code: s.budgetLines.code }).from(s.budgetLines).where(eq(s.budgetLines.id, it.lineId)).limit(1))[0]?.code ?? null;
        if ('blocked' in r) blocked.push({ lineId: it.lineId, code, reason: r.blocked! }); else decided.push({ lineId: it.lineId, code, state: r.state });
      }
      await audit(app.db, req, { action: 'budget.decisions', entityType: 'budget_line', entityId: body.items[0]!.lineId, metadata: { decided: decided.length, blocked: blocked.length } });
      return { decided, blocked };
    },
  }),

  // ------------------------------------------------------------------ execução
  defineRoute({
    method: 'POST', url: '/budget/lines/:id/execution', summary: 'Registra a execução: fornecedor, cotação, valor negociado, pedido de compra, contrato, quantidades e entrega. Comprometer acima do autorizado é bloqueado (peça o Budget Guardião)', ...M, params: IdParams,
    body: z.object({
      rowVersion: z.number().int(), supplierId: uuid.nullable().optional(), quoteCents: cents.nullable().optional(), negotiatedCents: cents.nullable().optional(), contractedCents: cents.nullable().optional(),
      contractedQty: qty.nullable().optional(), contractedOn: day.nullable().optional(), poNumber: z.string().trim().max(60).nullable().optional(), resourceId: uuid.nullable().optional(),
      deliveredQty: qty.nullable().optional(), deliveredOn: day.nullable().optional(), executionState: z.enum(EXECUTION_STATES).optional(), reason: z.string().trim().max(1000).nullable().optional(),
    }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { l, access } = await loadLine(tx, auth, params.id, true);
      if (!access.execute) throw forbidden('Só o Dono do orçamento ou o Responsável pela execução registram a execução.');
      if (!isApproved(l.approvalState as ApprovalState)) throw unprocessable('Execução só depois da aprovação.');
      if (body.rowVersion !== l.rowVersion) throw conflict(l.rowVersion);
      if (l.executionState === 'encerrado' && body.executionState !== undefined && body.executionState !== 'encerrado') throw unprocessable('Lançamento encerrado; reabrir é com a Gerência.');
      const contracted = body.contractedCents === undefined ? l.contractedCents : body.contractedCents;
      if (contracted) {
        const [{ realized }] = await tx.select({ realized: sql<number>`coalesce(sum(${s.budgetExpenses.amountCents}), 0)::bigint` }).from(s.budgetExpenses).where(and(eq(s.budgetExpenses.lineId, l.id), eq(s.budgetExpenses.status, 'valido'))) as [{ realized: number }];
        const chk = executionCheck(l as { approvedCents: number | null; limitCents: number | null; approvalState: ApprovalState }, Math.max(Number(contracted), Number(realized)));
        if (!chk.ok) throw unprocessable(`${chk.message} Autorizado: ${brl(ceilingOf(l))}; excedente: ${brl(chk.overCents)}.`, [{ path: 'contractedCents', message: 'guardiao' }]);
      }
      const state = body.executionState ?? (contracted && l.executionState === 'nao_iniciada' ? 'comprometido' : l.executionState);
      const next = { supplierId: body.supplierId, quoteCents: body.quoteCents, negotiatedCents: body.negotiatedCents, contractedCents: body.contractedCents, contractedQtyMilli: body.contractedQty as unknown as number | null | undefined, contractedOn: body.contractedOn, poNumber: body.poNumber, resourceId: body.resourceId, deliveredQtyMilli: body.deliveredQty as unknown as number | null | undefined, deliveredOn: body.deliveredOn, executionState: state };
      const changes = diff(l as unknown as Record<string, unknown>, next);
      if (!changes.length) return { ok: true };
      await tx.update(s.budgetLines).set({ ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)), updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id));
      await logLine(tx, auth, l, state === 'encerrado' && l.executionState !== 'encerrado' ? 'encerrado' : 'execucao', `execução atualizada (${changes.map((c) => c.field).join(', ')}).`, { changes, reason: body.reason ?? null });
      return { ok: true, executionState: state };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/budget/lines/:id/realized', summary: 'Reconhece despesa realizada no lançamento (nota/execução), sem passar do teto autorizado', ...M, params: IdParams, bodyLimit: 8_000_000,
    body: z.object({ occurredOn: day, description: z.string().trim().min(3).max(300), amountCents: cents, invoiceNumber: z.string().trim().max(60).nullable().optional(), doc: Doc.nullable().optional(), idempotencyKey: z.string().trim().min(8).max(80) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const r = await app.db.transaction(async (tx) => {
        const { l, access } = await loadLine(tx, auth, params.id, true);
        if (!access.execute) throw forbidden('Só o Dono do orçamento ou o Responsável pela execução reconhecem a despesa.');
        const dup = await tx.select({ id: s.budgetEvents.id }).from(s.budgetEvents).where(and(eq(s.budgetEvents.entity, 'item'), eq(s.budgetEvents.entityId, l.id), sql`${s.budgetEvents.data}->>'idempotencyKey' = ${body.idempotencyKey}`)).limit(1);
        if (dup.length) return { duplicate: true };
        const [{ realized }] = await tx.select({ realized: sql<number>`coalesce(sum(${s.budgetExpenses.amountCents}), 0)::bigint` }).from(s.budgetExpenses).where(and(eq(s.budgetExpenses.lineId, l.id), eq(s.budgetExpenses.status, 'valido'))) as [{ realized: number }];
        const chk = executionCheck(l as { approvedCents: number | null; limitCents: number | null; approvalState: ApprovalState }, Math.max(Number(l.contractedCents ?? 0), Number(realized) + body.amountCents));
        if (!chk.ok) throw unprocessable(`${chk.message} Autorizado: ${brl(ceilingOf(l))}; excedente: ${brl(chk.overCents)}.`, [{ path: 'amountCents', message: 'guardiao' }]);
        const doc = body.doc ? await readDoc(body.doc) : null;
        const [e] = await tx.insert(s.budgetExpenses).values({ tenantId: auth.tenantId, costCenterId: l.costCenterId, accountId: l.accountId, lineId: l.id, occurredOn: body.occurredOn, description: body.invoiceNumber ? `${body.description} (NF ${body.invoiceNumber})` : body.description, amountCents: body.amountCents, supplierId: l.supplierId, financeCheck: true, docName: doc?.name ?? null, docMime: doc?.mime ?? null, docSize: doc?.size ?? null, docData: doc?.data ?? null, createdBy: auth.userId }).returning({ id: s.budgetExpenses.id });
        const state = l.executionState === 'nao_iniciada' || l.executionState === 'comprometido' ? 'em_execucao' : l.executionState;
        await tx.update(s.budgetLines).set({ executionState: state, updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id));
        await logLine(tx, auth, l, 'realizado', `despesa reconhecida de ${brl(body.amountCents)} em ${body.occurredOn}${body.invoiceNumber ? ` (NF ${body.invoiceNumber})` : ''}.`, { expenseId: e!.id, amountCents: body.amountCents, idempotencyKey: body.idempotencyKey });
        return { id: e!.id };
      });
      reply.code('duplicate' in r ? 200 : 201);
      return r;
    },
  }),

  // ------------------------------------------------------------------ Budget Guardião no lançamento
  defineRoute({
    method: 'POST', url: '/budget/lines/:id/guardian', summary: 'Pede valor adicional (excedente) para o lançamento aprovado: justificativa obrigatória; a Diretoria decide', ...M, params: IdParams,
    body: z.object({ deltaCents: cents, justification: z.string().trim().min(10).max(2000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const r = await app.db.transaction(async (tx) => {
        const { l, access } = await loadLine(tx, auth, params.id, true);
        if (!access.plan) throw forbidden('Quem pede o Budget Guardião é o Dono do orçamento do centro.');
        if (!isApproved(l.approvalState as ApprovalState)) throw unprocessable('O Budget Guardião vale para lançamentos aprovados.');
        const [a] = await tx.insert(s.budgetAdjustments).values({ tenantId: auth.tenantId, costCenterId: l.costCenterId, year: Number(l.month.slice(0, 4)), quarter: quarterOfMonth(l.month), accountId: l.accountId, month: l.month, deltaCents: body.deltaCents, justification: body.justification, status: 'pendente', kind: 'excedente', lineId: l.id, requestedBy: auth.userId }).returning();
        await logLine(tx, auth, l, 'guardiao_pedido', `Budget Guardião pedido: +${brl(body.deltaCents)}. ${body.justification}`, { adjustmentId: a!.id, deltaCents: body.deltaCents });
        return a!;
      });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/guardian/:id/decide', summary: 'Diretoria decide o excedente do lançamento: aprova (todo ou parte) consumindo a reserva com trava, ou recusa', ...M, params: IdParams,
    body: z.object({ decision: z.enum(['aprovar', 'recusar']), approvedCents: cents.nullable().optional(), note: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!(auth.profiles.includes('diretoria') && decidesStages(auth).includes('diretoria'))) throw forbidden('O Budget Guardião é decidido pela Diretoria.');
      if (body.decision === 'recusar' && !body.note) throw unprocessable('Explique a recusa.', [{ path: 'note', message: 'Obrigatório' }]);
      const r = await app.db.transaction(async (tx) => {
        // trava a política e o centro: duas decisões simultâneas não consomem a mesma reserva
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`budget-guardian:${auth.tenantId}`}))`);
        const [a] = await tx.select().from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.id, params.id), eq(s.budgetAdjustments.tenantId, auth.tenantId), eq(s.budgetAdjustments.kind, 'excedente'))).for('update').limit(1);
        if (!a) throw notFound();
        if (a.status !== 'pendente') throw unprocessable('Este pedido já foi decidido.');
        if (a.requestedBy === auth.userId) throw forbidden('Quem pediu não decide o próprio Budget Guardião.');
        const { l } = await loadLine(tx, auth, a.lineId!, true);
        if (body.decision === 'recusar') {
          await tx.update(s.budgetAdjustments).set({ status: 'recusado', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note ?? null }).where(eq(s.budgetAdjustments.id, a.id));
          await logLine(tx, auth, l, 'guardiao_recusado', `Budget Guardião recusado: ${body.note}`, { adjustmentId: a.id });
          return { status: 'recusado' };
        }
        const value = body.approvedCents ?? a.deltaCents;
        if (value > a.deltaCents) throw unprocessable('Não aprove mais que o pedido.');
        const policy = await policyOf(tx, auth.tenantId);
        let from: string | null = null;
        if (policy.reserveMode !== 'nenhuma') {
          const [cc] = await tx.select().from(s.costCenters).where(eq(s.costCenters.id, a.costCenterId)).for('update').limit(1);
          const usedBy = async (where: ReturnType<typeof sql>) => Number((await tx.execute<{ v: string }>(sql`select coalesce(sum(delta_cents), 0) as v from budget_adjustments where tenant_id = ${auth.tenantId} and kind = 'excedente' and status = 'aprovado' and ${where}`)).rows[0]!.v);
          const ccLeft = (cc!.guardianReserveCents ?? 0) - await usedBy(sql`cost_center_id = ${cc!.id} and from_reserve = 'centro'`);
          const glLeft = (policy.globalReserveCents ?? 0) - await usedBy(sql`from_reserve = 'global'`);
          if ((policy.reserveMode === 'centro' || policy.reserveMode === 'hibrida') && ccLeft >= value) from = 'centro';
          else if ((policy.reserveMode === 'global' || policy.reserveMode === 'hibrida') && glLeft >= value) from = 'global';
          else throw unprocessable(`Reserva do Budget Guardião insuficiente (centro: ${brl(Math.max(0, ccLeft))}; global: ${brl(Math.max(0, glLeft))}).`);
        }
        await tx.update(s.budgetAdjustments).set({ status: 'aprovado', deltaCents: value, fromReserve: from, decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note ?? null }).where(eq(s.budgetAdjustments.id, a.id));
        await tx.update(s.budgetLines).set({ approvedCents: (l.approvedCents ?? 0) + value, limitCents: l.limitCents !== null ? l.limitCents + value : null, updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id));
        await logLine(tx, auth, l, 'guardiao_aprovado', `Budget Guardião aprovado: +${brl(value)}${from ? ` (reserva ${from === 'centro' ? 'do centro' : 'global'})` : ''}${body.note ? `. ${body.note}` : ''}.`, { adjustmentId: a.id, before: { approvedCents: l.approvedCents, limitCents: l.limitCents }, after: { approvedCents: (l.approvedCents ?? 0) + value } });
        return { status: 'aprovado', approvedCents: value, fromReserve: from };
      });
      await audit(app.db, req, { action: 'budget.guardian.decide', entityType: 'budget_adjustment', entityId: params.id, metadata: r });
      return r;
    },
  }),

  // ------------------------------------------------------------------ financeiro
  defineRoute({
    method: 'POST', url: '/budget/lines/:id/payables', summary: 'Financeiro lança o título (nota fiscal) do lançamento, à vista ou parcelado; o identificador externo evita título duplicado', ...M, params: IdParams,
    body: z.object({ invoiceNumber: z.string().trim().max(60).nullable().optional(), supplierId: uuid.nullable().optional(), amountCents: cents, competence: month, firstDueOn: day, plannedPayOn: day.nullable().optional(), installments: z.number().int().min(1).max(60).default(1), externalId: z.string().trim().min(3).max(120) }),
    handler: async ({ app, auth, params, body, reply }) => {
      if (!isFinance(auth)) throw forbidden('Títulos e pagamentos são do setor Financeiro.');
      const r = await app.db.transaction(async (tx) => {
        const { l } = await loadLine(tx, auth, params.id, true);
        if (!isApproved(l.approvalState as ApprovalState)) throw unprocessable('O lançamento ainda não foi aprovado.');
        const existing = await tx.select().from(s.budgetPayables).where(and(eq(s.budgetPayables.tenantId, auth.tenantId), sql`${s.budgetPayables.externalId} like ${`${body.externalId}#%`}`));
        if (existing.length) return { duplicate: true, items: existing };
        const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${s.budgetPayables.amountCents}), 0)::bigint` }).from(s.budgetPayables).where(and(eq(s.budgetPayables.lineId, l.id), eq(s.budgetPayables.status, 'aberto'))) as [{ total: number }];
        if (Number(total) + body.amountCents > ceilingOf(l)) throw unprocessable(`Os títulos passariam do valor autorizado (${brl(ceilingOf(l))}). Peça o Budget Guardião antes.`, [{ path: 'amountCents', message: 'guardiao' }]);
        const parts = splitInstallments(body.amountCents, body.installments, body.firstDueOn);
        const items = await tx.insert(s.budgetPayables).values(parts.map((p) => ({ tenantId: auth.tenantId, lineId: l.id, costCenterId: l.costCenterId, supplierId: body.supplierId ?? l.supplierId, invoiceNumber: body.invoiceNumber ?? null, installment: p.n, installments: body.installments, amountCents: p.amountCents, competence: body.competence, dueOn: p.dueOn, plannedPayOn: p.n === 1 ? body.plannedPayOn ?? null : null, externalId: `${body.externalId}#${p.n}`, createdBy: auth.userId }))).returning();
        await logLine(tx, auth, l, 'titulo', `título ${body.invoiceNumber ? `NF ${body.invoiceNumber} ` : ''}de ${brl(body.amountCents)} em ${body.installments}x (1º vencimento ${body.firstDueOn}).`, { externalId: body.externalId, amountCents: body.amountCents, installments: body.installments });
        return { items };
      });
      reply.code('duplicate' in r ? 200 : 201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/payables/:id/payments', summary: 'Financeiro registra pagamento (parcial ou total) com juros, multa, desconto, forma e comprovante; a chave de idempotência impede pagamento duplicado', ...M, params: IdParams, bodyLimit: 8_000_000,
    body: z.object({ paidOn: day, amountCents: cents0, interestCents: cents0.default(0), fineCents: cents0.default(0), discountCents: cents0.default(0), method: z.enum(PAYMENT_METHODS).nullable().optional(), proof: Doc.nullable().optional(), idempotencyKey: z.string().trim().min(8).max(80) }),
    handler: async ({ app, auth, params, body, reply }) => {
      if (!isFinance(auth)) throw forbidden('Pagamentos são registrados pelo setor Financeiro.');
      if (body.amountCents + body.discountCents <= 0) throw unprocessable('Informe o valor pago.');
      const r = await app.db.transaction(async (tx) => {
        // trava o título primeiro: dois envios iguais ao mesmo tempo esperam um pelo outro e o segundo vira "já registrado"
        const [p] = await tx.select().from(s.budgetPayables).where(and(eq(s.budgetPayables.id, params.id), eq(s.budgetPayables.tenantId, auth.tenantId))).for('update').limit(1);
        if (!p) throw notFound();
        const [dup] = await tx.select().from(s.budgetPayments).where(and(eq(s.budgetPayments.tenantId, auth.tenantId), eq(s.budgetPayments.idempotencyKey, body.idempotencyKey))).limit(1);
        if (dup) return { duplicate: true, payment: dup };
        const { l } = await loadLine(tx, auth, p.lineId);
        if (p.status === 'cancelado') throw unprocessable('Título cancelado.');
        const pays = await tx.select().from(s.budgetPayments).where(eq(s.budgetPayments.payableId, p.id));
        const sit = payableSituation({ id: p.id, amountCents: p.amountCents, dueOn: p.dueOn, status: 'aberto' }, pays.map((x) => ({ id: x.id, reversesId: x.reversesId, payableId: x.payableId, amountCents: x.amountCents, interestCents: x.interestCents, fineCents: x.fineCents, discountCents: x.discountCents, paidOn: x.paidOn, kind: x.kind as 'pagamento', reconciled: !!x.reconciledAt })), body.paidOn);
        if (body.amountCents + body.discountCents > sit.openCents) throw unprocessable(`O pagamento passa do saldo do título (em aberto: ${brl(sit.openCents)}).`, [{ path: 'amountCents', message: 'Acima do saldo' }]);
        let proofId: string | null = null;
        if (body.proof) {
          const d = await readDoc(body.proof);
          const [doc] = await tx.insert(s.budgetDocuments).values({ tenantId: auth.tenantId, lineId: l.id, kind: 'comprovante', ...d, createdBy: auth.userId }).returning({ id: s.budgetDocuments.id });
          proofId = doc!.id;
        }
        const [pay] = await tx.insert(s.budgetPayments).values({ tenantId: auth.tenantId, payableId: p.id, lineId: l.id, paidOn: body.paidOn, amountCents: body.amountCents, interestCents: body.interestCents, fineCents: body.fineCents, discountCents: body.discountCents, method: body.method ?? null, idempotencyKey: body.idempotencyKey, proofId, createdBy: auth.userId }).returning();
        await logLine(tx, auth, l, 'pagamento', `pagamento de ${brl(body.amountCents)} (parcela ${p.installment}/${p.installments}) em ${body.paidOn}${body.interestCents + body.fineCents ? `, juros/multa ${brl(body.interestCents + body.fineCents)}` : ''}${body.discountCents ? `, desconto ${brl(body.discountCents)}` : ''}.`, { paymentId: pay!.id, payableId: p.id });
        return { payment: pay };
      });
      reply.code('duplicate' in r ? 200 : 201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/payments/:id/reverse', summary: 'Estorna um pagamento (novo registro que aponta para o original; motivo obrigatório; uma vez)', ...M, params: IdParams,
    body: z.object({ reason: z.string().trim().min(5).max(1000), paidOn: day }),
    handler: async ({ app, auth, params, body }) => {
      if (!isFinance(auth)) throw forbidden('Estorno é do setor Financeiro.');
      return app.db.transaction(async (tx) => {
        const [p] = await tx.select().from(s.budgetPayments).where(and(eq(s.budgetPayments.id, params.id), eq(s.budgetPayments.tenantId, auth.tenantId))).for('update').limit(1);
        if (!p) throw notFound();
        if (p.kind !== 'pagamento') throw unprocessable('Só pagamentos podem ser estornados.');
        const [already] = await tx.select({ id: s.budgetPayments.id }).from(s.budgetPayments).where(eq(s.budgetPayments.reversesId, p.id)).limit(1);
        if (already) throw unprocessable('Este pagamento já foi estornado.');
        const { l } = await loadLine(tx, auth, p.lineId);
        const [r] = await tx.insert(s.budgetPayments).values({ tenantId: auth.tenantId, payableId: p.payableId, lineId: p.lineId, kind: 'estorno', reversesId: p.id, paidOn: body.paidOn, amountCents: p.amountCents, interestCents: p.interestCents, fineCents: p.fineCents, discountCents: p.discountCents, method: p.method, reason: body.reason, idempotencyKey: `estorno:${p.id}`, createdBy: auth.userId }).returning();
        await logLine(tx, auth, l, 'estorno', `estorno de ${brl(p.amountCents)}: ${body.reason}`, { paymentId: p.id, reversalId: r!.id });
        return r;
      });
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/payments/:id/reconcile', summary: 'Financeiro concilia o pagamento com o extrato', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      if (!isFinance(auth)) throw forbidden('Conciliação é do setor Financeiro.');
      const [p] = await app.db.select().from(s.budgetPayments).where(and(eq(s.budgetPayments.id, params.id), eq(s.budgetPayments.tenantId, auth.tenantId))).limit(1);
      if (!p) throw notFound();
      if (p.reconciledAt) return { ok: true };
      const { l } = await loadLine(app.db, auth, p.lineId);
      await app.db.update(s.budgetPayments).set({ reconciledAt: new Date(), reconciledBy: auth.userId }).where(eq(s.budgetPayments.id, p.id));
      await logLine(app.db, auth, l, 'conciliado', `pagamento de ${brl(p.amountCents)} conciliado.`, { paymentId: p.id });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ documentos
  defineRoute({
    method: 'POST', url: '/budget/lines/:id/documents', summary: 'Anexa documento ao lançamento (pedido, cotação, pedido de compra, nota fiscal, entrega, comprovante)', ...M, params: IdParams, bodyLimit: 8_000_000,
    body: z.object({ kind: z.enum(['anexo', 'cotacao', 'pedido', 'nota_fiscal', 'entrega', 'comprovante', 'outro']), doc: Doc }),
    handler: async ({ app, auth, params, body, reply }) => {
      const { l, access } = await loadLine(app.db, auth, params.id);
      if (!(access.execute || isFinance(auth))) throw forbidden('Só quem planeja, executa ou o Financeiro anexam documentos.');
      const d = await readDoc(body.doc);
      const [doc] = await app.db.insert(s.budgetDocuments).values({ tenantId: auth.tenantId, lineId: l.id, kind: body.kind, ...d, createdBy: auth.userId }).returning({ id: s.budgetDocuments.id });
      await logLine(app.db, auth, l, 'documento', `documento anexado: ${d.name}.`, { documentId: doc!.id, kind: body.kind });
      reply.code(201);
      return { id: doc!.id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/budget/documents/:id', summary: 'Baixa um documento do lançamento', ...M, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [d] = await app.db.select().from(s.budgetDocuments).where(and(eq(s.budgetDocuments.id, params.id), eq(s.budgetDocuments.tenantId, auth.tenantId), isNull(s.budgetDocuments.deletedAt))).limit(1);
      if (!d) throw notFound();
      await loadLine(app.db, auth, d.lineId);
      reply.header('content-type', d.mime).header('content-disposition', `attachment; filename="${encodeURIComponent(d.name)}"`);
      return reply.send(d.data);
    },
  }),

  // ------------------------------------------------------------------ política
  defineRoute({
    method: 'PUT', url: '/budget/policy', summary: 'Política do orçamento: % de alerta e de bloqueio e a reserva do Budget Guardião (global, por centro ou híbrida). Sem valor, nada é presumido', ...M, min: 'total',
    body: z.object({ alertPct: z.number().int().min(1).max(500).nullable(), blockPct: z.number().int().min(1).max(500).nullable(), reserveMode: z.enum(['nenhuma', 'global', 'centro', 'hibrida']), globalReserveCents: cents0.nullable(), centers: z.array(z.object({ id: uuid, alertPct: z.number().int().min(1).max(500).nullable(), blockPct: z.number().int().min(1).max(500).nullable(), guardianReserveCents: cents0.nullable() })).max(200).default([]) }),
    handler: async ({ app, auth, body }) => {
      if (!auth.profiles.includes('diretoria') && !auth.profiles.includes('administrador')) throw forbidden('A política do orçamento é definida pela Diretoria (ou configurada pelo Administrador).');
      if (body.alertPct !== null && body.blockPct !== null && body.alertPct > body.blockPct) throw unprocessable('O alerta precisa vir antes do bloqueio.');
      return app.db.transaction(async (tx) => {
        const cur = await policyOf(tx, auth.tenantId);
        await tx.insert(s.budgetPolicies).values({ tenantId: auth.tenantId, alertPct: body.alertPct, blockPct: body.blockPct, reserveMode: body.reserveMode, globalReserveCents: body.globalReserveCents, version: 1, updatedBy: auth.userId })
          .onConflictDoUpdate({ target: s.budgetPolicies.tenantId, set: { alertPct: body.alertPct, blockPct: body.blockPct, reserveMode: body.reserveMode, globalReserveCents: body.globalReserveCents, version: sql`${s.budgetPolicies.version} + 1`, updatedBy: auth.userId, updatedAt: new Date() } });
        for (const c of body.centers) await tx.update(s.costCenters).set({ alertPct: c.alertPct, blockPct: c.blockPct, guardianReserveCents: c.guardianReserveCents, updatedAt: new Date() }).where(and(eq(s.costCenters.id, c.id), eq(s.costCenters.tenantId, auth.tenantId)));
        await tx.insert(s.budgetEvents).values({ tenantId: auth.tenantId, entity: 'politica', action: 'alterada', summary: `Política do orçamento alterada (versão ${cur.version + 1}).`, data: { before: { alertPct: cur.alertPct, blockPct: cur.blockPct, reserveMode: cur.reserveMode, globalReserveCents: cur.globalReserveCents }, after: body }, actorId: auth.userId });
        return { ok: true, version: cur.version + 1 };
      });
    },
  }),
  defineRoute({
    method: 'GET', url: '/budget/policy', summary: 'Política do orçamento vigente e limites por centro de custo', ...M,
    handler: async ({ app, auth }) => {
      const p = await policyOf(app.db, auth.tenantId);
      const ccs = await visibleCostCenters(app.db, auth);
      return { ...p, centers: ccs.map((c) => ({ id: c.id, code: c.code, name: c.name, alertPct: c.alertPct, blockPct: c.blockPct, guardianReserveCents: c.guardianReserveCents })), canEdit: auth.profiles.includes('diretoria') || auth.profiles.includes('administrador') };
    },
  }),
];
