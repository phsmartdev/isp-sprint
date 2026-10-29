/**
 * Recursos e Orçamento — planejamento, aprovação, gastos, Budget Guardião, revisão mensal e indicadores.
 * Regras da Política de Orçamento (Anexo I). Diretoria = nível Total no módulo; líderes operam os próprios centros.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACCOUNT_NATURES, DEFAULT_ACCOUNTS, DEFAULT_COST_CENTERS, EXECUTION_BAND_INFO, ITEM_TYPES, PAYMENT_METHODS, accountCodeError, guardianRoute, monthsOfQuarter,
  needsJustification, deviationPct, parentCode, planStatusOf, quarterLabel, quarterOfMonth, resourceMonths, sameItemConflict, spendCheck, type LineStatus, type PlanStatus,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { brl } from '../services/email';
import { accountsOf, availableFor, categoryOf, costCentersOf, isBudgetAdmin, isBudgetRestricted, loadCostCenter, logBudget, quarterNumbers, totals } from '../services/budget';
import { groupBy } from '../services/group';
import { detectAttachment } from './sprint';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM');
const uuid = z.string().uuid();
const cents = z.number().int().positive().max(100_000_000_000);
const Q = z.object({ year: z.coerce.number().int().min(2020).max(2100), quarter: z.coerce.number().int().min(1).max(4) });
const M = { module: 'orcamento' as const };
const ADMIN = { module: 'orcamento' as const, min: 'total' as const };

const SUPERVISION = 'A supervisão lança e dá baixa, mas não exclui nem altera valores. Peça à gestão.';
function requireAdmin(auth: AuthContext) { if (!isBudgetAdmin(auth)) throw forbidden('Só a Diretoria (nível Total em Recursos e Orçamento) pode fazer isso.'); }

async function leafAccount(db: DbOrTx, tenantId: string, id: string) {
  const all = await accountsOf(db, tenantId);
  const a = all.find((x) => x.id === id);
  if (!a || !a.active) throw unprocessable('Conta contábil não encontrada ou inativa.', [{ path: 'accountId', message: 'Conta inválida' }]);
  if (!a.leaf) throw unprocessable('Lance na subcategoria (conta analítica), não na categoria.', [{ path: 'accountId', message: 'Escolha uma subcategoria' }]);
  return { a, all };
}

async function planOf(db: DbOrTx, auth: AuthContext, ccId: string, year: number, quarter: number) {
  const [p] = await db.select().from(s.budgetPlans).where(and(eq(s.budgetPlans.costCenterId, ccId), eq(s.budgetPlans.year, year), eq(s.budgetPlans.quarter, quarter))).limit(1);
  if (p) return p;
  const [n] = await db.insert(s.budgetPlans).values({ tenantId: auth.tenantId, costCenterId: ccId, year, quarter }).onConflictDoNothing().returning();
  if (n) return n;
  const [again] = await db.select().from(s.budgetPlans).where(and(eq(s.budgetPlans.costCenterId, ccId), eq(s.budgetPlans.year, year), eq(s.budgetPlans.quarter, quarter))).limit(1);
  return again!;
}

async function syncPlanStatus(db: DbOrTx, planId: string) {
  const [p] = await db.select().from(s.budgetPlans).where(eq(s.budgetPlans.id, planId)).limit(1);
  const lines = await db.select({ status: s.budgetLines.status }).from(s.budgetLines).where(and(eq(s.budgetLines.planId, planId), isNull(s.budgetLines.deletedAt)));
  const next = planStatusOf(lines as { status: LineStatus }[], p!.status as PlanStatus);
  if (next !== p!.status) await db.update(s.budgetPlans).set({ status: next, updatedAt: new Date(), rowVersion: sql`${s.budgetPlans.rowVersion} + 1` }).where(eq(s.budgetPlans.id, planId));
  return next;
}

const LineBody = z.object({
  accountId: uuid, what: z.string().trim().min(3).max(200), how: z.string().trim().max(2000).nullable().optional(), month, amountCents: cents,
  itemType: z.enum(ITEM_TYPES).default('outro'), supplierId: uuid.nullable().optional(),
});

export const budgetRoutes = [
  // ------------------------------------------------------------------ estrutura
  defineRoute({
    method: 'GET', url: '/budget/structure', summary: 'Plano de contas (hierarquia), centros de custo visíveis, fornecedores e pessoas', tag: 'Orçamento', ...M,
    handler: async ({ app, auth }) => {
      const accounts = await accountsOf(app.db, auth.tenantId);
      const ccs = await costCentersOf(app.db, auth, true);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).orderBy(asc(s.users.name));
      const suppliers = await app.db.select().from(s.suppliers).where(eq(s.suppliers.tenantId, auth.tenantId)).orderBy(asc(s.suppliers.name));
      const name = new Map(users.map((u) => [u.id, u.name]));
      return {
        admin: isBudgetAdmin(auth),
        accounts,
        costCenters: ccs.map((c) => ({ ...c, leaderName: c.leaderId ? name.get(c.leaderId) ?? null : null, memberNames: c.memberIds.map((m) => name.get(m) ?? '') })),
        suppliers, users,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/setup', summary: 'Cria o plano de contas e os centros de custo sugeridos pela política (só o que ainda não existe)', tag: 'Orçamento', ...ADMIN,
    handler: async ({ app, auth, req }) => {
      const r = await app.db.transaction(async (tx) => {
        const existing = await tx.select().from(s.budgetAccounts).where(eq(s.budgetAccounts.tenantId, auth.tenantId));
        const byCode = new Map(existing.map((a) => [a.code, a.id]));
        let accounts = 0, ccs = 0;
        for (const d of DEFAULT_ACCOUNTS) {
          if (byCode.has(d.code)) continue;
          const pc = parentCode(d.code);
          const [n] = await tx.insert(s.budgetAccounts).values({ tenantId: auth.tenantId, code: d.code, name: d.name, nature: 'despesa', parentId: pc ? byCode.get(pc) ?? null : null, createdBy: auth.userId }).returning({ id: s.budgetAccounts.id });
          byCode.set(d.code, n!.id); accounts++;
        }
        const have = new Set((await tx.select({ code: s.costCenters.code }).from(s.costCenters).where(eq(s.costCenters.tenantId, auth.tenantId))).map((c) => c.code));
        for (const c of DEFAULT_COST_CENTERS) if (!have.has(c.code)) { await tx.insert(s.costCenters).values({ tenantId: auth.tenantId, code: c.code, name: c.name }); ccs++; }
        await logBudget(tx, auth, null, 'estrutura', null, 'criada', `Estrutura sugerida criada: ${accounts} conta(s) e ${ccs} centro(s) de custo.`);
        return { accounts, costCenters: ccs };
      });
      await audit(app.db, req, { action: 'budget.setup', entityType: 'tenant', entityId: auth.tenantId, metadata: r });
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/accounts', summary: 'Cria conta contábil (categoria ou subcategoria) com código hierárquico', tag: 'Orçamento', ...ADMIN,
    body: z.object({ parentId: uuid.nullable().default(null), code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(120), nature: z.enum(ACCOUNT_NATURES).default('despesa'), description: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, body, req, reply }) => {
      const all = await app.db.select().from(s.budgetAccounts).where(eq(s.budgetAccounts.tenantId, auth.tenantId));
      const parent = body.parentId ? all.find((a) => a.id === body.parentId) ?? null : null;
      if (body.parentId && !parent) throw unprocessable('Conta-mãe não encontrada.');
      const err = accountCodeError(body.code, parent, all.map((a) => a.code));
      if (err) throw unprocessable(err, [{ path: 'code', message: err }]);
      // conta-mãe com lançamentos não pode virar categoria (o que foi lançado nela ficaria sem subcategoria)
      if (parent) {
        const [used] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.budgetLines).where(and(eq(s.budgetLines.accountId, parent.id), isNull(s.budgetLines.deletedAt)));
        const [spent] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.budgetExpenses).where(eq(s.budgetExpenses.accountId, parent.id));
        if ((used?.n ?? 0) + (spent?.n ?? 0) > 0) throw unprocessable(`A conta ${parent.code} já tem planejamento ou gastos; crie a subcategoria em outra categoria ou mova os lançamentos.`);
      }
      const [n] = await app.db.insert(s.budgetAccounts).values({ tenantId: auth.tenantId, parentId: parent?.id ?? null, code: body.code, name: body.name, nature: parent ? parent.nature : body.nature, description: body.description ?? null, createdBy: auth.userId }).returning();
      await logBudget(app.db, auth, null, 'conta', n!.id, 'criada', `Conta ${n!.code} ${n!.name} criada.`);
      await audit(app.db, req, { action: 'budget.account.create', entityType: 'budget_account', entityId: n!.id });
      reply.code(201);
      return n;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/budget/accounts/:id', summary: 'Renomeia, descreve ou desativa a conta (o código não muda)', tag: 'Orçamento', ...ADMIN, params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(500).nullable().optional(), active: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => {
      const [a] = await app.db.update(s.budgetAccounts).set({ ...body, updatedAt: new Date() }).where(and(eq(s.budgetAccounts.id, params.id), eq(s.budgetAccounts.tenantId, auth.tenantId))).returning();
      if (!a) throw notFound();
      await logBudget(app.db, auth, null, 'conta', a.id, 'alterada', `Conta ${a.code} ${a.name}${body.active === false ? ' desativada' : body.active ? ' reativada' : ' alterada'}.`);
      return a;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/cost-centers', summary: 'Cria centro de custo com líder e quem mais pode consumir', tag: 'Orçamento', ...ADMIN,
    body: z.object({ code: z.string().trim().min(2).max(12).transform((x) => x.toUpperCase()), name: z.string().trim().min(2).max(80), leaderId: uuid.nullable().default(null), memberIds: z.array(uuid).max(30).default([]) }),
    handler: async ({ app, auth, body, reply }) => {
      const [dup] = await app.db.select({ id: s.costCenters.id }).from(s.costCenters).where(and(eq(s.costCenters.tenantId, auth.tenantId), eq(s.costCenters.code, body.code))).limit(1);
      if (dup) throw unprocessable('Já existe um centro de custo com este código.', [{ path: 'code', message: 'Código em uso' }]);
      const [c] = await app.db.insert(s.costCenters).values({ tenantId: auth.tenantId, ...body }).returning();
      await logBudget(app.db, auth, c!.id, 'centro', c!.id, 'criado', `Centro de custo ${c!.code} ${c!.name} criado.`);
      reply.code(201);
      return c;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/budget/cost-centers/:id', summary: 'Altera nome, líder, pessoas que consomem ou desativa o centro de custo', tag: 'Orçamento', ...ADMIN, params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(80).optional(), leaderId: uuid.nullable().optional(), memberIds: z.array(uuid).max(30).optional(), active: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => {
      const [c] = await app.db.update(s.costCenters).set({ ...body, updatedAt: new Date() }).where(and(eq(s.costCenters.id, params.id), eq(s.costCenters.tenantId, auth.tenantId))).returning();
      if (!c) throw notFound();
      await logBudget(app.db, auth, c.id, 'centro', c.id, 'alterado', `Centro de custo ${c.code} alterado.`);
      return c;
    },
  }),

  // ------------------------------------------------------------------ trimestre (visão geral e por centro)
  defineRoute({
    method: 'GET', url: '/budget/quarter', summary: 'Trimestre: por centro de custo, planejado aprovado (com ajustes), em aprovação, realizado, % de execução e faixa da política', tag: 'Orçamento', ...M, query: Q,
    handler: async ({ app, auth, query }) => {
      const ccs = await costCentersOf(app.db, auth);
      const { rows, months } = await quarterNumbers(app.db, auth.tenantId, query.year, query.quarter, ccs.map((c) => c.id));
      const plans = ccs.length ? await app.db.select().from(s.budgetPlans).where(and(inArray(s.budgetPlans.costCenterId, ccs.map((c) => c.id)), eq(s.budgetPlans.year, query.year), eq(s.budgetPlans.quarter, query.quarter))) : [];
      const pendAdj = ccs.length ? await app.db.select({ cc: s.budgetAdjustments.costCenterId, n: sql<number>`count(*)::int` }).from(s.budgetAdjustments).where(and(inArray(s.budgetAdjustments.costCenterId, ccs.map((c) => c.id)), eq(s.budgetAdjustments.status, 'pendente'))).groupBy(s.budgetAdjustments.costCenterId) : [];
      const byCc = groupBy(rows, (r) => r.cc);
      const items = ccs.map((c) => {
        const t = totals(byCc.get(c.id) ?? []);
        const p = plans.find((x) => x.costCenterId === c.id);
        return { costCenter: { id: c.id, code: c.code, name: c.name, leaderId: c.leaderId }, planStatus: (p?.status ?? 'rascunho') as PlanStatus, ...t, pendingAdjustments: pendAdj.find((x) => x.cc === c.id)?.n ?? 0, byMonth: months.map((m) => ({ month: m, ...totals((byCc.get(c.id) ?? []).filter((r) => r.month === m)) })) };
      });
      return { year: query.year, quarter: query.quarter, label: quarterLabel(query.year, query.quarter), months, items, total: totals(rows), admin: isBudgetAdmin(auth), bands: EXECUTION_BAND_INFO };
    },
  }),
  defineRoute({
    method: 'GET', url: '/budget/items', summary: 'Lançamentos do trimestre (tela principal): cada item planejado dos centros visíveis com o executado (baixas), situação de pagamento e o que a pessoa pode fazer', tag: 'Orçamento', ...M, query: Q,
    handler: async ({ app, auth, query }) => {
      const ccs = await costCentersOf(app.db, auth);
      const months = monthsOfQuarter(query.year, query.quarter);
      const ids = ccs.map((c) => c.id);
      const from = `${months[0]}-01`, until = query.quarter === 4 ? `${query.year + 1}-01-01` : `${query.year}-${String(query.quarter * 3 + 1).padStart(2, '0')}-01`;
      const [lines, exps] = ids.length ? await Promise.all([
        app.db.select().from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, auth.tenantId), inArray(s.budgetLines.costCenterId, ids), inArray(s.budgetLines.month, months), isNull(s.budgetLines.deletedAt))).orderBy(asc(s.budgetLines.month), asc(s.budgetLines.createdAt)),
        app.db.select({ id: s.budgetExpenses.id, lineId: s.budgetExpenses.lineId, costCenterId: s.budgetExpenses.costCenterId, occurredOn: s.budgetExpenses.occurredOn, description: s.budgetExpenses.description, amountCents: s.budgetExpenses.amountCents, paymentMethod: s.budgetExpenses.paymentMethod, supplierId: s.budgetExpenses.supplierId, docName: s.budgetExpenses.docName, status: s.budgetExpenses.status, cancelReason: s.budgetExpenses.cancelReason, createdAt: s.budgetExpenses.createdAt, createdBy: s.users.name })
          .from(s.budgetExpenses).leftJoin(s.users, eq(s.users.id, s.budgetExpenses.createdBy)).where(and(eq(s.budgetExpenses.tenantId, auth.tenantId), inArray(s.budgetExpenses.costCenterId, ids), sql`${s.budgetExpenses.occurredOn} >= ${from} and ${s.budgetExpenses.occurredOn} < ${until}`)).orderBy(desc(s.budgetExpenses.occurredOn), desc(s.budgetExpenses.createdAt)),
      ]) : [[], []];
      const byLine = groupBy(exps.filter((e) => e.lineId), (e) => e.lineId!);
      const ccOf = new Map(ccs.map((c) => [c.id, { id: c.id, code: c.code, name: c.name }]));
      const items = lines.map((l) => {
        const baixas = byLine.get(l.id) ?? [];
        const executedCents = baixas.filter((e) => e.status === 'valido').reduce((a, e) => a + e.amountCents, 0);
        return { ...l, costCenter: ccOf.get(l.costCenterId)!, executedCents, paid: executedCents >= l.amountCents ? 'pago' : executedCents > 0 ? 'parcial' : 'aberto', baixas };
      });
      const live = items.filter((i) => i.status !== 'recusado');
      const unlinked = exps.filter((e) => !e.lineId && e.status === 'valido');
      const executed = live.reduce((a, i) => a + i.executedCents, 0) + unlinked.reduce((a, e) => a + e.amountCents, 0);
      const planned = live.reduce((a, i) => a + i.amountCents, 0);
      const drafts = ccs.map((c) => { const d = items.filter((i) => i.costCenterId === c.id && (i.status === 'rascunho' || i.status === 'recusado')); return { costCenterId: c.id, code: c.code, name: c.name, count: d.length, cents: d.reduce((a, i) => a + i.amountCents, 0) }; }).filter((d) => d.count);
      const restricted = isBudgetRestricted(auth);
      return {
        label: quarterLabel(query.year, query.quarter), months, items,
        totals: { planned, executed, deviation: planned - executed, unlinkedCents: unlinked.reduce((a, e) => a + e.amountCents, 0), unlinkedCount: unlinked.length },
        drafts, costCenters: [...ccOf.values()],
        can: { create: ccs.length > 0, delete: !restricted, editAmount: !restricted, cancelBaixa: !restricted, approve: isBudgetAdmin(auth) },
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/budget/plan', summary: 'Planejamento de um centro no trimestre: itens (o quê, como, quando), números por conta e mês, ajustes e gastos', tag: 'Orçamento', ...M,
    query: Q.extend({ costCenterId: uuid }),
    handler: async ({ app, auth, query }) => {
      const cc = await loadCostCenter(app.db, auth, query.costCenterId);
      const plan = await planOf(app.db, auth, cc.id, query.year, query.quarter);
      const months = monthsOfQuarter(query.year, query.quarter);
      const lines = await app.db.select().from(s.budgetLines).where(and(eq(s.budgetLines.planId, plan.id), isNull(s.budgetLines.deletedAt))).orderBy(asc(s.budgetLines.month), asc(s.budgetLines.createdAt));
      const adjustments = await app.db.select().from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.costCenterId, cc.id), eq(s.budgetAdjustments.year, query.year), eq(s.budgetAdjustments.quarter, query.quarter))).orderBy(desc(s.budgetAdjustments.createdAt));
      const from = `${months[0]}-01`, until = query.quarter === 4 ? `${query.year + 1}-01-01` : `${query.year}-${String(query.quarter * 3 + 1).padStart(2, '0')}-01`;
      const expenses = await app.db.select({ id: s.budgetExpenses.id, accountId: s.budgetExpenses.accountId, lineId: s.budgetExpenses.lineId, occurredOn: s.budgetExpenses.occurredOn, description: s.budgetExpenses.description, amountCents: s.budgetExpenses.amountCents, supplierId: s.budgetExpenses.supplierId, paymentMethod: s.budgetExpenses.paymentMethod, financeCheck: s.budgetExpenses.financeCheck, docName: s.budgetExpenses.docName, status: s.budgetExpenses.status, cancelReason: s.budgetExpenses.cancelReason, createdBy: s.budgetExpenses.createdBy, createdAt: s.budgetExpenses.createdAt })
        .from(s.budgetExpenses).where(and(eq(s.budgetExpenses.costCenterId, cc.id), sql`${s.budgetExpenses.occurredOn} >= ${from} and ${s.budgetExpenses.occurredOn} < ${until}`)).orderBy(desc(s.budgetExpenses.occurredOn), desc(s.budgetExpenses.createdAt));
      const { rows } = await quarterNumbers(app.db, auth.tenantId, query.year, query.quarter, [cc.id]);
      const accounts = await accountsOf(app.db, auth.tenantId);
      const byAcc = groupBy(rows, (r) => r.account);
      // números por conta (subcategoria) e consolidados por categoria e acima
      const accRows = accounts.map((a) => {
        const desc = accounts.filter((x) => x.code === a.code || x.code.startsWith(`${a.code}.`)).map((x) => x.id);
        const rs = desc.flatMap((id) => byAcc.get(id) ?? []);
        return { accountId: a.id, ...totals(rs), byMonth: months.map((m) => ({ month: m, ...totals(rs.filter((r) => r.month === m)) })) };
      }).filter((r) => r.approved || r.pending || r.draft || r.adjusted || r.adjustPending || r.realized);
      const canEdit = isBudgetAdmin(auth) || cc.leaderId === auth.userId || cc.memberIds.includes(auth.userId);
      return { costCenter: cc, plan, months, lines, adjustments, expenses, accounts: accRows, total: totals(rows), canEdit, admin: isBudgetAdmin(auth), label: quarterLabel(query.year, query.quarter) };
    },
  }),

  // ------------------------------------------------------------------ itens do planejamento
  defineRoute({
    method: 'POST', url: '/budget/plan/lines', summary: 'Planeja um item (o quê, como, quando, conta, valor) no trimestre do centro de custo', tag: 'Orçamento', ...M,
    body: LineBody.extend({ costCenterId: uuid }),
    handler: async ({ app, auth, body, req, reply }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      const year = Number(body.month.slice(0, 4)), quarter = quarterOfMonth(body.month);
      const plan = await planOf(app.db, auth, cc.id, year, quarter);
      if (plan.status === 'em_aprovacao') throw unprocessable('O planejamento está com a Diretoria. Aguarde a decisão para incluir itens.');
      if (plan.status === 'aprovado') throw unprocessable('O planejamento do trimestre já foi aprovado. Para incluir ou mudar valores, use o Budget Guardião.');
      const { all } = await leafAccount(app.db, auth.tenantId, body.accountId);
      const others = await app.db.select({ what: s.budgetLines.what, accountId: s.budgetLines.accountId }).from(s.budgetLines).where(and(eq(s.budgetLines.planId, plan.id), isNull(s.budgetLines.deletedAt)));
      const clash = sameItemConflict(body.what, categoryOf(body.accountId, all), others.map((o) => ({ what: o.what, categoryId: categoryOf(o.accountId, all) })));
      if (clash) throw unprocessable('Este item já está planejado em outra categoria neste trimestre (política 3.3). Use a mesma categoria.', [{ path: 'what', message: 'Item em outra categoria' }]);
      const [l] = await app.db.insert(s.budgetLines).values({ tenantId: auth.tenantId, planId: plan.id, costCenterId: cc.id, accountId: body.accountId, what: body.what, how: body.how ?? null, month: body.month, amountCents: body.amountCents, itemType: body.itemType, supplierId: body.supplierId ?? null, createdBy: auth.userId }).returning();
      if (plan.status === 'devolvido') await syncPlanStatus(app.db, plan.id);
      await logBudget(app.db, auth, cc.id, 'item', l!.id, 'planejado', `${cc.code}: planejado “${l!.what}” em ${l!.month} (−${brl(l!.amountCents)}).`);
      await audit(app.db, req, { action: 'budget.line.create', entityType: 'budget_line', entityId: l!.id });
      reply.code(201);
      return l;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/budget/plan/lines/:id', summary: 'Altera item ainda não enviado (ou devolvido/recusado)', tag: 'Orçamento', ...M, params: IdParams,
    body: LineBody.partial(),
    handler: async ({ app, auth, params, body }) => {
      const [l] = await app.db.select().from(s.budgetLines).where(and(eq(s.budgetLines.id, params.id), eq(s.budgetLines.tenantId, auth.tenantId), isNull(s.budgetLines.deletedAt))).limit(1);
      if (!l) throw notFound();
      const cc = await loadCostCenter(app.db, auth, l.costCenterId);
      if (l.status !== 'rascunho' && l.status !== 'recusado') throw unprocessable('Item enviado ou aprovado não muda. Depois de aprovado, ajustes vão pelo Budget Guardião.');
      if (body.month && quarterOfMonth(body.month) !== quarterOfMonth(l.month)) throw unprocessable('O mês precisa ser do mesmo trimestre.');
      if (body.accountId) await leafAccount(app.db, auth.tenantId, body.accountId);
      if (isBudgetRestricted(auth) && body.amountCents !== undefined && body.amountCents !== l.amountCents) throw forbidden(SUPERVISION);
      const [n] = await app.db.update(s.budgetLines).set({ ...body, status: 'rascunho', updatedAt: new Date() }).where(eq(s.budgetLines.id, l.id)).returning();
      await logBudget(app.db, auth, cc.id, 'item', l.id, 'alterado', `${cc.code}: item “${n!.what}” alterado (−${brl(n!.amountCents)} em ${n!.month}).`);
      return n;
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/budget/plan/lines/:id', summary: 'Retira item não aprovado do planejamento (fica no histórico)', tag: 'Orçamento', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [l] = await app.db.select().from(s.budgetLines).where(and(eq(s.budgetLines.id, params.id), eq(s.budgetLines.tenantId, auth.tenantId), isNull(s.budgetLines.deletedAt))).limit(1);
      if (!l) throw notFound();
      const cc = await loadCostCenter(app.db, auth, l.costCenterId);
      if (isBudgetRestricted(auth)) throw forbidden(SUPERVISION);
      if (l.status === 'aprovado' || l.status === 'em_aprovacao') throw unprocessable('Item enviado ou aprovado não sai do planejamento; use o Budget Guardião para reduzir.');
      await app.db.update(s.budgetLines).set({ deletedAt: new Date() }).where(eq(s.budgetLines.id, l.id));
      await logBudget(app.db, auth, cc.id, 'item', l.id, 'retirado', `${cc.code}: item “${l.what}” retirado do planejamento.`);
      await syncPlanStatus(app.db, l.planId);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/plan/import-resources', summary: 'Traz para o planejamento os softwares, licenças, contratos e assinaturas ativos do centro (valores recorrentes do trimestre)', tag: 'Orçamento', ...M,
    body: Q.extend({ costCenterId: uuid }),
    handler: async ({ app, auth, body }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      const plan = await planOf(app.db, auth, cc.id, body.year, body.quarter);
      if (plan.status === 'em_aprovacao' || plan.status === 'aprovado') throw unprocessable('Planejamento enviado ou aprovado: inclua pelo Budget Guardião.');
      const months = monthsOfQuarter(body.year, body.quarter);
      const res = await app.db.select().from(s.resourceContracts).where(and(eq(s.resourceContracts.costCenterId, cc.id), eq(s.resourceContracts.status, 'ativo')));
      const existing = await app.db.select({ resourceId: s.budgetLines.resourceId, month: s.budgetLines.month }).from(s.budgetLines).where(and(eq(s.budgetLines.planId, plan.id), isNull(s.budgetLines.deletedAt)));
      const accounts = await accountsOf(app.db, auth.tenantId);
      let created = 0, skipped = 0;
      for (const r of res) {
        const acc = accounts.find((a) => a.id === r.accountId && a.leaf);
        if (!acc) { skipped++; continue; }
        for (const m of resourceMonths({ amountCents: r.amountCents, currency: r.currency as 'BRL' | 'USD', fxRate: r.fxRate, period: r.period as 'mensal', startOn: r.startOn, endOn: r.endOn }, months)) {
          if (!m.cents || existing.some((e) => e.resourceId === r.id && e.month === m.month)) continue;
          await app.db.insert(s.budgetLines).values({ tenantId: auth.tenantId, planId: plan.id, costCenterId: cc.id, accountId: acc.id, what: r.name, how: `${r.kind === 'software' ? 'Licença' : r.kind === 'assinatura' ? 'Assinatura' : 'Contrato'} recorrente${r.currency === 'USD' ? ` (US$ pela cotação ${r.fxRate})` : ''}`, month: m.month, amountCents: m.cents, itemType: r.kind === 'software' ? 'software' : 'servico', supplierId: r.supplierId, resourceId: r.id, createdBy: auth.userId });
          created++;
        }
      }
      if (created) await logBudget(app.db, auth, cc.id, 'plano', plan.id, 'recorrentes', `${cc.code}: ${created} item(ns) recorrente(s) trazido(s) de softwares, contratos e assinaturas.`);
      return { created, skipped };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/plan/submit', summary: 'Envia o planejamento do trimestre para validação da Diretoria', tag: 'Orçamento', ...M,
    body: Q.extend({ costCenterId: uuid, note: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, body, req }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      const plan = await planOf(app.db, auth, cc.id, body.year, body.quarter);
      const r = await app.db.transaction(async (tx) => {
        const upd = await tx.update(s.budgetLines).set({ status: 'em_aprovacao', updatedAt: new Date() }).where(and(eq(s.budgetLines.planId, plan.id), isNull(s.budgetLines.deletedAt), inArray(s.budgetLines.status, ['rascunho', 'recusado']))).returning({ amount: s.budgetLines.amountCents });
        if (!upd.length) throw unprocessable('Não há itens novos para enviar.');
        await tx.update(s.budgetPlans).set({ status: 'em_aprovacao', note: body.note ?? plan.note, submittedAt: new Date(), submittedBy: auth.userId, updatedAt: new Date(), rowVersion: sql`${s.budgetPlans.rowVersion} + 1` }).where(eq(s.budgetPlans.id, plan.id));
        const total = upd.reduce((t, x) => t + x.amount, 0);
        await logBudget(tx, auth, cc.id, 'plano', plan.id, 'enviado', `${cc.code} ${quarterLabel(body.year, body.quarter)}: ${upd.length} item(ns) enviados à Diretoria (−${brl(total)}).`);
        return { lines: upd.length, totalCents: total };
      });
      await audit(app.db, req, { action: 'budget.plan.submit', entityType: 'budget_plan', entityId: plan.id, metadata: r });
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/plan/decide', summary: 'Diretoria aprova/recusa itens (um a um) ou o total do centro de custo; devolver pede ajuste', tag: 'Orçamento', ...ADMIN,
    body: z.object({ planId: uuid, lineIds: z.array(uuid).max(500).default([]), decision: z.enum(['aprovar', 'recusar', 'devolver']), note: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, body, req }) => {
      requireAdmin(auth);
      if (body.decision !== 'aprovar' && !body.note) throw unprocessable('Explique o motivo para o líder do centro de custo.', [{ path: 'note', message: 'Obrigatório' }]);
      const [plan] = await app.db.select().from(s.budgetPlans).where(and(eq(s.budgetPlans.id, body.planId), eq(s.budgetPlans.tenantId, auth.tenantId))).limit(1);
      if (!plan) throw notFound();
      const [cc] = await app.db.select().from(s.costCenters).where(eq(s.costCenters.id, plan.costCenterId)).limit(1);
      const whole = !body.lineIds.length;
      const r = await app.db.transaction(async (tx) => {
        const target = and(eq(s.budgetLines.planId, plan.id), isNull(s.budgetLines.deletedAt), eq(s.budgetLines.status, 'em_aprovacao'), whole ? sql`true` : inArray(s.budgetLines.id, body.lineIds));
        const status = body.decision === 'aprovar' ? 'aprovado' : body.decision === 'recusar' ? 'recusado' : 'rascunho';
        const upd = await tx.update(s.budgetLines).set({ status, decisionNote: body.note ?? null, decidedBy: auth.userId, decidedAt: new Date(), updatedAt: new Date() }).where(target!).returning({ amount: s.budgetLines.amountCents, what: s.budgetLines.what });
        if (!upd.length) throw unprocessable('Nenhum item aguardando decisão.');
        if (body.decision === 'devolver') await tx.update(s.budgetPlans).set({ status: 'devolvido', decidedAt: new Date(), decidedBy: auth.userId, updatedAt: new Date() }).where(eq(s.budgetPlans.id, plan.id));
        else await tx.update(s.budgetPlans).set({ decidedAt: new Date(), decidedBy: auth.userId }).where(eq(s.budgetPlans.id, plan.id));
        const st = body.decision === 'devolver' ? 'devolvido' : await syncPlanStatus(tx, plan.id);
        const total = upd.reduce((t, x) => t + x.amount, 0);
        const verb = body.decision === 'aprovar' ? 'aprovou' : body.decision === 'recusar' ? 'recusou' : 'devolveu para ajuste';
        await logBudget(tx, auth, plan.costCenterId, 'plano', plan.id, body.decision, `Diretoria ${verb} ${whole ? `o total do centro ${cc?.code}` : `${upd.length} item(ns) de ${cc?.code}`} em ${quarterLabel(plan.year, plan.quarter)} (−${brl(total)})${body.note ? `: ${body.note}` : ''}.`);
        return { lines: upd.length, totalCents: total, planStatus: st };
      });
      await audit(app.db, req, { action: `budget.plan.${body.decision}`, entityType: 'budget_plan', entityId: plan.id, metadata: { ...r, whole } });
      return r;
    },
  }),

  // ------------------------------------------------------------------ Budget Guardião
  defineRoute({
    method: 'POST', url: '/budget/adjustments', summary: 'Budget Guardião: ajuste no trimestre (até 15% do centro com justificativa; acima, vai à Diretoria). Sempre reportado.', tag: 'Orçamento', ...M,
    body: z.object({ costCenterId: uuid, accountId: uuid, month, deltaCents: z.number().int().refine((x) => x !== 0, 'Informe o valor do ajuste').refine((x) => Math.abs(x) <= 100_000_000_000), justification: z.string().trim().min(15, 'Justifique o ajuste (mínimo 15 caracteres)').max(2000) }),
    handler: async ({ app, auth, body, req, reply }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      await leafAccount(app.db, auth.tenantId, body.accountId);
      const year = Number(body.month.slice(0, 4)), quarter = quarterOfMonth(body.month);
      const { rows } = await quarterNumbers(app.db, auth.tenantId, year, quarter, [cc.id]);
      const t = totals(rows);
      if (!t.approved) throw unprocessable('O trimestre ainda não tem planejamento aprovado. Planeje e envie à Diretoria.');
      if (body.deltaCents < 0) {
        const acc = totals(rows.filter((r) => r.account === body.accountId));
        if (acc.available + body.deltaCents < 0) throw unprocessable(`Não dá para reduzir mais do que o saldo disponível da conta (${brl(Math.max(0, acc.available))}).`);
      }
      const prev = await app.db.select({ d: s.budgetAdjustments.deltaCents, st: s.budgetAdjustments.status }).from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.costCenterId, cc.id), eq(s.budgetAdjustments.year, year), eq(s.budgetAdjustments.quarter, quarter)));
      const prevAbs = prev.filter((p) => p.st !== 'recusado').reduce((a, p) => a + Math.abs(p.d), 0);
      const route = guardianRoute(t.approved, prevAbs, body.deltaCents);
      const status = route.needsDirector && !isBudgetAdmin(auth) ? 'pendente' : route.needsDirector ? 'aprovado' : 'registrado';
      const [a] = await app.db.insert(s.budgetAdjustments).values({ tenantId: auth.tenantId, costCenterId: cc.id, year, quarter, accountId: body.accountId, month: body.month, deltaCents: body.deltaCents, justification: body.justification, pct: route.pct, status, requestedBy: auth.userId, ...(status === 'aprovado' ? { decidedBy: auth.userId, decidedAt: new Date(), decisionNote: 'Ajuste feito pela própria Diretoria' } : {}) }).returning();
      await logBudget(app.db, auth, cc.id, 'guardiao', a!.id, status, `Budget Guardião ${cc.code}: ${body.deltaCents > 0 ? 'acréscimo' : 'redução'} de ${brl(Math.abs(body.deltaCents))} (${route.pct.toFixed(1).replace('.', ',')}% do trimestre acumulado) — ${status === 'pendente' ? 'aguardando a Diretoria (acima de 15%)' : status === 'registrado' ? 'registrado dentro do limite de 15% e reportado à Diretoria' : 'aprovado'}. Justificativa: ${body.justification}`);
      await audit(app.db, req, { action: 'budget.guardian', entityType: 'budget_adjustment', entityId: a!.id, metadata: { status, pct: route.pct } });
      reply.code(201);
      return { ...a, needsDirector: route.needsDirector };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/adjustments/:id/decide', summary: 'Diretoria decide ajuste acima de 15%', tag: 'Orçamento', ...ADMIN, params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      requireAdmin(auth);
      if (!body.approve && !body.note) throw unprocessable('Explique a recusa.', [{ path: 'note', message: 'Obrigatório' }]);
      const [a] = await app.db.update(s.budgetAdjustments).set({ status: body.approve ? 'aprovado' : 'recusado', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note ?? null })
        .where(and(eq(s.budgetAdjustments.id, params.id), eq(s.budgetAdjustments.tenantId, auth.tenantId), eq(s.budgetAdjustments.status, 'pendente'))).returning();
      if (!a) throw unprocessable('Ajuste não está aguardando decisão.');
      await logBudget(app.db, auth, a.costCenterId, 'guardiao', a.id, body.approve ? 'aprovado' : 'recusado', `Diretoria ${body.approve ? 'aprovou' : 'recusou'} ajuste do Budget Guardião de ${brl(Math.abs(a.deltaCents))}${body.note ? `: ${body.note}` : ''}.`);
      await audit(app.db, req, { action: 'budget.guardian.decide', entityType: 'budget_adjustment', entityId: a.id, metadata: { approve: body.approve } });
      return a;
    },
  }),

  // ------------------------------------------------------------------ gastos (consumo do orçamento)
  defineRoute({
    method: 'POST', url: '/budget/expenses', summary: 'Lança gasto realizado (com comprovante). Exige checagem prévia com o Financeiro e saldo aprovado; acima, só com Budget Guardião.', tag: 'Orçamento', ...M, bodyLimit: 8_000_000,
    body: z.object({
      costCenterId: uuid, accountId: uuid, lineId: uuid.nullable().optional(), occurredOn: day, description: z.string().trim().min(3).max(300), amountCents: cents,
      supplierId: uuid.nullable().optional(), paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(), financeCheck: z.boolean(),
      doc: z.object({ name: z.string().trim().min(1).max(200), data: z.string().min(1).max(7_000_000) }).nullable().optional(),
      resourceId: uuid.nullable().optional(), assetId: uuid.nullable().optional(), purchaseId: uuid.nullable().optional(),
    }),
    handler: async ({ app, auth, body, req, reply }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      if (!body.financeCheck) throw unprocessable('Antes de executar, faça a checagem prévia com o Financeiro (política 11.2).', [{ path: 'financeCheck', message: 'Obrigatório' }]);
      await leafAccount(app.db, auth.tenantId, body.accountId);
      if (body.lineId) {
        const [l] = await app.db.select().from(s.budgetLines).where(and(eq(s.budgetLines.id, body.lineId), eq(s.budgetLines.costCenterId, cc.id), isNull(s.budgetLines.deletedAt))).limit(1);
        if (!l || l.status !== 'aprovado') throw unprocessable('O item planejado escolhido não está aprovado.');
        if (l.accountId !== body.accountId) throw unprocessable('O gasto precisa estar na mesma conta do item planejado.');
      }
      const year = Number(body.occurredOn.slice(0, 4)), quarter = quarterOfMonth(body.occurredOn.slice(0, 7));
      const available = await availableFor(app.db, auth.tenantId, cc.id, body.accountId, year, quarter);
      const chk = spendCheck(available, body.amountCents);
      if (!chk.ok) throw unprocessable(`Sem saldo aprovado nesta conta no ${quarterLabel(year, quarter)} (disponível ${brl(Math.max(0, available))}; faltam ${brl(chk.missingCents)}). Acione o Budget Guardião.`, [{ path: 'amountCents', message: 'guardiao' }]);
      let doc: { name: string; mime: string; size: number; data: Buffer } | null = null;
      if (body.doc) {
        const data = Buffer.from(body.doc.data, 'base64');
        if (data.length > 5_000_000) throw unprocessable('Comprovante acima de 5 MB.');
        const mime = detectAttachment(body.doc.name, data);
        if (!mime || !['application/pdf', 'image/png', 'image/jpeg'].includes(mime)) throw unprocessable('Envie o comprovante em PDF, PNG ou JPG.');
        doc = { name: body.doc.name, mime, size: data.length, data };
      }
      const [e] = await app.db.insert(s.budgetExpenses).values({
        tenantId: auth.tenantId, costCenterId: cc.id, accountId: body.accountId, lineId: body.lineId ?? null, occurredOn: body.occurredOn, description: body.description, amountCents: body.amountCents,
        supplierId: body.supplierId ?? null, paymentMethod: body.paymentMethod ?? null, financeCheck: true, docName: doc?.name ?? null, docMime: doc?.mime ?? null, docSize: doc?.size ?? null, docData: doc?.data ?? null,
        resourceId: body.resourceId ?? null, assetId: body.assetId ?? null, purchaseId: body.purchaseId ?? null, createdBy: auth.userId,
      }).returning({ id: s.budgetExpenses.id });
      await logBudget(app.db, auth, cc.id, 'gasto', e!.id, 'lancado', `${cc.code}: gasto “${body.description}” de −${brl(body.amountCents)} em ${body.occurredOn}${doc ? ' (com comprovante)' : ''}.`);
      await audit(app.db, req, { action: 'budget.expense', entityType: 'budget_expense', entityId: e!.id, metadata: { amountCents: body.amountCents } });
      reply.code(201);
      return { id: e!.id, availableAfter: available - body.amountCents };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/expenses/:id/cancel', summary: 'Cancela gasto lançado errado (motivo obrigatório; fica registrado)', tag: 'Orçamento', ...M, params: IdParams,
    body: z.object({ reason: z.string().trim().min(5).max(500) }),
    handler: async ({ app, auth, params, body }) => {
      const [e] = await app.db.select().from(s.budgetExpenses).where(and(eq(s.budgetExpenses.id, params.id), eq(s.budgetExpenses.tenantId, auth.tenantId))).limit(1);
      if (!e) throw notFound();
      const cc = await loadCostCenter(app.db, auth, e.costCenterId);
      if (isBudgetRestricted(auth)) throw forbidden(SUPERVISION);
      if (e.status === 'cancelado') throw unprocessable('Gasto já cancelado.');
      await app.db.update(s.budgetExpenses).set({ status: 'cancelado', cancelReason: body.reason, cancelledAt: new Date(), cancelledBy: auth.userId }).where(eq(s.budgetExpenses.id, e.id));
      await logBudget(app.db, auth, cc.id, 'gasto', e.id, 'cancelado', `${cc.code}: gasto “${e.description}” (−${brl(e.amountCents)}) cancelado: ${body.reason}`);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/budget/expenses/:id/document', summary: 'Baixa o comprovante do gasto', tag: 'Orçamento', ...M, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [e] = await app.db.select().from(s.budgetExpenses).where(and(eq(s.budgetExpenses.id, params.id), eq(s.budgetExpenses.tenantId, auth.tenantId))).limit(1);
      if (!e || !e.docData) throw notFound('Sem comprovante.');
      await loadCostCenter(app.db, auth, e.costCenterId);
      return reply.header('content-type', e.docMime ?? 'application/octet-stream').header('content-disposition', `attachment; filename="${encodeURIComponent(e.docName ?? 'comprovante')}"`).send(e.docData);
    },
  }),

  // ------------------------------------------------------------------ revisão mensal
  defineRoute({
    method: 'GET', url: '/budget/review', summary: 'Revisão mensal: planejado × realizado por categoria no mês, desvios acima de 15% e justificativas', tag: 'Orçamento', ...M,
    query: z.object({ costCenterId: uuid, month }),
    handler: async ({ app, auth, query }) => {
      const cc = await loadCostCenter(app.db, auth, query.costCenterId);
      const year = Number(query.month.slice(0, 4)), quarter = quarterOfMonth(query.month);
      const { rows } = await quarterNumbers(app.db, auth.tenantId, year, quarter, [cc.id]);
      const all = await accountsOf(app.db, auth.tenantId);
      const inMonth = rows.filter((r) => r.month === query.month);
      const byCat = groupBy(inMonth, (r) => categoryOf(r.account, all));
      const reviews = await app.db.select().from(s.budgetReviews).where(and(eq(s.budgetReviews.costCenterId, cc.id), eq(s.budgetReviews.month, query.month))).orderBy(desc(s.budgetReviews.createdAt));
      const items = [...byCat].map(([catId, rs]) => {
        const t = totals(rs);
        const cat = all.find((a) => a.id === catId);
        const last = reviews.find((r) => r.accountId === catId);
        const dev = deviationPct(t.planned, t.realized);
        return { accountId: catId, code: cat?.code ?? '', name: cat?.name ?? '', planned: t.planned, realized: t.realized, deviationPct: Number.isFinite(dev) ? dev : null, needsJustification: needsJustification(t.planned, t.realized), justification: last?.justification ?? null, justifiedAt: last?.createdAt ?? null };
      }).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
      return { costCenter: { id: cc.id, code: cc.code, name: cc.name }, month: query.month, items, pending: items.filter((i) => i.needsJustification && !i.justification).length };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/reviews', summary: 'Registra a justificativa do desvio de uma categoria no mês', tag: 'Orçamento', ...M,
    body: z.object({ costCenterId: uuid, month, accountId: uuid, justification: z.string().trim().min(10).max(2000) }),
    handler: async ({ app, auth, body, reply }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      const year = Number(body.month.slice(0, 4)), quarter = quarterOfMonth(body.month);
      const { rows } = await quarterNumbers(app.db, auth.tenantId, year, quarter, [cc.id]);
      const all = await accountsOf(app.db, auth.tenantId);
      const t = totals(rows.filter((r) => r.month === body.month && categoryOf(r.account, all) === body.accountId));
      await app.db.insert(s.budgetReviews).values({ tenantId: auth.tenantId, costCenterId: cc.id, month: body.month, accountId: body.accountId, plannedCents: t.planned, realizedCents: t.realized, justification: body.justification, createdBy: auth.userId });
      const cat = all.find((a) => a.id === body.accountId);
      await logBudget(app.db, auth, cc.id, 'revisao', null, 'justificada', `${cc.code} ${body.month}: desvio em ${cat?.code ?? ''} ${cat?.name ?? ''} justificado: ${body.justification}`);
      reply.code(201);
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ indicadores, relatório e histórico
  defineRoute({
    method: 'GET', url: '/budget/report', summary: 'Relatório dos setores: orçado × realizado por centro, categoria e mês; recursos recorrentes, ativos e Guardião', tag: 'Orçamento', ...M,
    query: z.object({ year: z.coerce.number().int().min(2020).max(2100), quarter: z.coerce.number().int().min(1).max(4).optional() }),
    handler: async ({ app, auth, query }) => {
      const ccs = await costCentersOf(app.db, auth);
      const ids = ccs.map((c) => c.id);
      const qs = query.quarter ? [query.quarter] : [1, 2, 3, 4];
      const rows = (await Promise.all(qs.map((q) => quarterNumbers(app.db, auth.tenantId, query.year, q, ids)))).flatMap((x) => x.rows);
      const all = await accountsOf(app.db, auth.tenantId);
      const byCc = groupBy(rows, (r) => r.cc);
      const top = (accId: string) => { const a = all.find((x) => x.id === accId); const cat = a?.parentId ? all.find((x) => x.id === a.parentId) : a; return cat; };
      const sectors = ccs.map((c) => {
        const rs = byCc.get(c.id) ?? [];
        const cats = groupBy(rs, (r) => top(r.account)?.id ?? r.account);
        return {
          costCenter: { id: c.id, code: c.code, name: c.name }, ...totals(rs),
          categories: [...cats].map(([id, list]) => { const a = all.find((x) => x.id === id); const t = totals(list); return { accountId: id, code: a?.code ?? '', name: a?.name ?? '', ...t, deviationPct: Number.isFinite(deviationPct(t.planned, t.realized)) ? deviationPct(t.planned, t.realized) : null, needsJustification: needsJustification(t.planned, t.realized) }; }).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })),
        };
      });
      const months = [...new Set(rows.map((r) => r.month))].sort().map((m) => ({ month: m, ...totals(rows.filter((r) => r.month === m)) }));
      const res = ids.length ? await app.db.select().from(s.resourceContracts).where(and(inArray(s.resourceContracts.costCenterId, ids), eq(s.resourceContracts.status, 'ativo'))) : [];
      const assets = ids.length ? await app.db.select({ cc: s.resourceAssets.costCenterId, value: s.resourceAssets.valueCents, status: s.resourceAssets.status }).from(s.resourceAssets).where(inArray(s.resourceAssets.costCenterId, ids)) : [];
      const adj = ids.length ? await app.db.select().from(s.budgetAdjustments).where(and(inArray(s.budgetAdjustments.costCenterId, ids), eq(s.budgetAdjustments.year, query.year))).orderBy(desc(s.budgetAdjustments.createdAt)) : [];
      const { monthlyBrlCents } = await import('@isp/domain');
      return {
        year: query.year, quarter: query.quarter ?? null, total: totals(rows), sectors, months,
        recurring: { count: res.length, monthlyCents: res.reduce((t, r) => t + monthlyBrlCents({ amountCents: r.amountCents, currency: r.currency as 'BRL', fxRate: r.fxRate, period: r.period as 'mensal' }), 0), withoutVault: res.filter((r) => r.kind === 'software' && !r.vaultRegistered).length },
        assets: { count: assets.filter((a) => a.status !== 'baixado').length, valueCents: assets.filter((a) => a.status !== 'baixado').reduce((t, a) => t + a.value, 0) },
        guardian: adj.map((a) => ({ id: a.id, costCenterId: a.costCenterId, quarter: a.quarter, month: a.month, deltaCents: a.deltaCents, pct: a.pct, status: a.status, justification: a.justification, createdAt: a.createdAt })),
        bands: EXECUTION_BAND_INFO,
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/budget/events', summary: 'Histórico do orçamento (planejamento, decisões, Guardião, gastos, revisões)', tag: 'Orçamento', ...M,
    query: z.object({ costCenterId: uuid.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }),
    handler: async ({ app, auth, query }) => {
      const ccs = await costCentersOf(app.db, auth, true);
      const ids = query.costCenterId ? ccs.filter((c) => c.id === query.costCenterId).map((c) => c.id) : ccs.map((c) => c.id);
      const where = isBudgetAdmin(auth) && !query.costCenterId ? eq(s.budgetEvents.tenantId, auth.tenantId) : and(eq(s.budgetEvents.tenantId, auth.tenantId), ids.length ? inArray(s.budgetEvents.costCenterId, ids) : sql`false`);
      const items = await app.db.select({ id: s.budgetEvents.id, costCenterId: s.budgetEvents.costCenterId, entity: s.budgetEvents.entity, action: s.budgetEvents.action, summary: s.budgetEvents.summary, createdAt: s.budgetEvents.createdAt, actor: s.users.name })
        .from(s.budgetEvents).leftJoin(s.users, eq(s.users.id, s.budgetEvents.actorId)).where(where).orderBy(desc(s.budgetEvents.createdAt)).limit(query.limit);
      return { items };
    },
  }),
];
