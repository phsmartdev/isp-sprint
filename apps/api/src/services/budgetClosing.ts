/**
 * Fechamento orçamentário por competência e avisos do orçamento.
 * - Números do mês por centro de custo e consolidados (mesma camada de cálculo da Central).
 * - Período fechado não aceita alteração retroativa (lançamento da competência, despesa ou pagamento com data no mês).
 * - Destinatários do relatório mensal com o escopo que cada um pode ver.
 * - Avisos no sino, sem duplicar (chave por evento).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { payableSituation, type PaymentInput } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';
import { costCenterRole } from './budget';

const nextMonth = (m: string) => { const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)); return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const lastDay = (m: string) => { const [y, mo] = m.split('-').map(Number) as [number, number]; return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };

/** Bloqueia mudança em competência fechada. */
export async function assertOpenPeriod(db: DbOrTx, tenantId: string, month: string) {
  const [c] = await db.select({ status: s.budgetClosings.status }).from(s.budgetClosings).where(and(eq(s.budgetClosings.tenantId, tenantId), eq(s.budgetClosings.month, month))).limit(1);
  if (c?.status === 'fechado') throw unprocessable(`A competência ${month.slice(5)}/${month.slice(0, 4)} está fechada. Alteração retroativa só depois da reabertura pela Diretoria.`);
}

type TotalKey = 'original' | 'revised' | 'approved' | 'committed' | 'realized' | 'paid' | 'balance' | 'deviation' | 'excess' | 'guardianUsed' | 'overdueCents' | 'overdueCount' | 'latePayments' | 'charges' | 'economy' | 'pendingApproval';
export type ClosingTotals = Record<TotalKey, number> & { deviationPct: number | null };
export type CenterFigures = { id: string; code: string; name: string; original: number; revised: number; approved: number; committed: number; realized: number; paid: number; balance: number; deviation: number; deviationPct: number | null; excess: number; guardianUsed: number; overdueCents: number; overdueCount: number; latePayments: number; charges: number; economy: number; pendingApproval: number };

/** Números do mês (competência para custos; data do pagamento para o pago) por centro e consolidados. */
export async function closingSnapshot(db: DbOrTx, tenantId: string, month: string, ccIds?: string[]) {
  const ccs = await db.select().from(s.costCenters).where(and(eq(s.costCenters.tenantId, tenantId), ccIds ? inArray(s.costCenters.id, ccIds.length ? ccIds : ['00000000-0000-0000-0000-000000000000']) : eq(s.costCenters.active, true))).orderBy(s.costCenters.code);
  const ids = ccs.map((c) => c.id);
  const end = lastDay(month), until = `${nextMonth(month)}-01`;
  const lines = ids.length ? await db.select().from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, tenantId), inArray(s.budgetLines.costCenterId, ids), eq(s.budgetLines.month, month), isNull(s.budgetLines.deletedAt))) : [];
  const exps = ids.length ? await db.select({ cc: s.budgetExpenses.costCenterId, lineId: s.budgetExpenses.lineId, v: s.budgetExpenses.amountCents }).from(s.budgetExpenses).where(and(eq(s.budgetExpenses.tenantId, tenantId), inArray(s.budgetExpenses.costCenterId, ids), eq(s.budgetExpenses.status, 'valido'), sql`${s.budgetExpenses.occurredOn} >= ${`${month}-01`} and ${s.budgetExpenses.occurredOn} < ${until}`)) : [];
  const pays = ids.length ? await db.select({ p: s.budgetPayments, cc: s.budgetPayables.costCenterId, dueOn: s.budgetPayables.dueOn }).from(s.budgetPayments).innerJoin(s.budgetPayables, eq(s.budgetPayables.id, s.budgetPayments.payableId)).where(and(eq(s.budgetPayments.tenantId, tenantId), inArray(s.budgetPayables.costCenterId, ids), sql`${s.budgetPayments.paidOn} >= ${`${month}-01`} and ${s.budgetPayments.paidOn} < ${until}`)) : [];
  const payables = ids.length ? await db.select().from(s.budgetPayables).where(and(eq(s.budgetPayables.tenantId, tenantId), inArray(s.budgetPayables.costCenterId, ids), eq(s.budgetPayables.status, 'aberto'), sql`${s.budgetPayables.dueOn} <= ${end}`)) : [];
  const allPays = payables.length ? await db.select().from(s.budgetPayments).where(inArray(s.budgetPayments.payableId, payables.map((p) => p.id))) : [];
  const adj = ids.length ? await db.select().from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.tenantId, tenantId), inArray(s.budgetAdjustments.costCenterId, ids), eq(s.budgetAdjustments.month, month), eq(s.budgetAdjustments.status, 'aprovado'))) : [];
  const toInput = (x: typeof allPays[number]): PaymentInput => ({ id: x.id, reversesId: x.reversesId, payableId: x.payableId, amountCents: x.amountCents, interestCents: x.interestCents, fineCents: x.fineCents, discountCents: x.discountCents, paidOn: x.paidOn, kind: x.kind as 'pagamento', reconciled: !!x.reconciledAt });
  const sign = (k: string) => (k === 'estorno' ? -1 : 1);
  const centers: CenterFigures[] = ccs.map((c) => {
    const ls = lines.filter((l) => l.costCenterId === c.id);
    const approvedL = ls.filter((l) => l.approvalState === 'aprovado' || l.approvalState === 'aprovado_ressalvas');
    const approved = approvedL.reduce((t, l) => t + (l.approvedCents ?? 0), 0);
    const original = ls.reduce((t, l) => t + (l.firstApprovedCents ?? 0), 0);
    const guard = adj.filter((a) => a.costCenterId === c.id && a.kind === 'guardiao').reduce((t, a) => t + a.deltaCents, 0);
    const excess = adj.filter((a) => a.costCenterId === c.id && (a.kind === 'guardiao' || a.kind === 'excedente') && a.deltaCents > 0).reduce((t, a) => t + a.deltaCents, 0);
    const guardianUsed = adj.filter((a) => a.costCenterId === c.id && a.kind === 'excedente' && a.fromReserve).reduce((t, a) => t + a.deltaCents, 0);
    const committed = approvedL.reduce((t, l) => t + (l.contractedCents ?? 0), 0);
    const realized = exps.filter((e) => e.cc === c.id).reduce((t, e) => t + e.v, 0);
    const myPays = pays.filter((p) => p.cc === c.id);
    const paid = myPays.reduce((t, p) => t + sign(p.p.kind) * p.p.amountCents, 0);
    const charges = myPays.reduce((t, p) => t + sign(p.p.kind) * (p.p.interestCents + p.p.fineCents), 0);
    const latePayments = myPays.filter((p) => p.p.kind === 'pagamento' && p.p.paidOn > p.dueOn).length;
    const overdue = payables.filter((p) => p.costCenterId === c.id).map((p) => payableSituation({ id: p.id, amountCents: p.amountCents, dueOn: p.dueOn, status: 'aberto' }, allPays.filter((x) => x.payableId === p.id).map(toInput), until)).filter((x) => x.openCents > 0);
    const consumption = approvedL.reduce((t, l) => { const r = exps.filter((e) => e.lineId === l.id).reduce((a, e) => a + e.v, 0); return t + Math.max(l.contractedCents ?? 0, r); }, 0) + exps.filter((e) => e.cc === c.id && !e.lineId).reduce((t, e) => t + e.v, 0);
    const economy = approvedL.filter((l) => l.executionState === 'encerrado' || l.contractedCents).reduce((t, l) => t + Math.max(0, (l.approvedCents ?? 0) - Math.max(l.contractedCents ?? 0, exps.filter((e) => e.lineId === l.id).reduce((a, e) => a + e.v, 0))), 0);
    return {
      id: c.id, code: c.code, name: c.name, original, revised: approved + guard, approved, committed, realized, paid, balance: approved + guard - consumption,
      deviation: realized - approved, deviationPct: approved ? Math.round(((realized - approved) / approved) * 1000) / 10 : null, excess, guardianUsed,
      overdueCents: overdue.reduce((t, x) => t + x.openCents, 0), overdueCount: overdue.length, latePayments, charges, economy,
      pendingApproval: ls.filter((l) => ['enviado', 'em_analise', 'questionado'].includes(l.approvalState)).reduce((t, l) => t + l.amountCents, 0),
    };
  });
  const keys: TotalKey[] = ['original', 'revised', 'approved', 'committed', 'realized', 'paid', 'balance', 'deviation', 'excess', 'guardianUsed', 'overdueCents', 'overdueCount', 'latePayments', 'charges', 'economy', 'pendingApproval'];
  const sums = Object.fromEntries(keys.map((k) => [k, centers.reduce((t, c) => t + (Number(c[k]) || 0), 0)])) as Record<TotalKey, number>;
  const total: ClosingTotals = { ...sums, deviationPct: sums.approved ? Math.round(((sums.realized - sums.approved) / sums.approved) * 1000) / 10 : null };
  // performance do mês (vendas ganhas; centros de time contam as vendas do time)
  const teamIds = ccs.map((c) => c.teamId).filter(Boolean) as string[];
  const sales = await db.select({ team: s.opportunities.teamId, n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${s.opportunities.valueCents}), 0)::bigint` }).from(s.opportunities)
    .where(and(eq(s.opportunities.tenantId, tenantId), isNull(s.opportunities.deletedAt), eq(s.opportunities.stage, 'ganha'), sql`${s.opportunities.wonAt} >= ${new Date(`${month}-01T03:00:00Z`)} and ${s.opportunities.wonAt} < ${new Date(`${until}T03:00:00Z`)}`)).groupBy(s.opportunities.teamId);
  const scoped = ccIds ? sales.filter((x) => x.team && teamIds.includes(x.team)) : sales;
  const performance = { wins: scoped.reduce((t, x) => t + x.n, 0), resultCents: scoped.reduce((t, x) => t + Number(x.v), 0) };
  return { month, centers, total, performance: { ...performance, efficiency: total.realized ? Math.round((performance.resultCents / total.realized) * 100) / 100 : null } };
}
export type ClosingSnapshot = Awaited<ReturnType<typeof closingSnapshot>>;

export type Recipient = { userId: string; name: string; email: string; role: 'responsavel' | 'gestor' | 'diretoria' | 'financeiro'; costCenterIds: string[] };
/** Quem recebe o relatório e com qual escopo: Diretoria e Financeiro veem todos; gestor, os centros sob sua gestão; responsável, os seus. */
export async function reportRecipients(db: DbOrTx, tenantId: string): Promise<Recipient[]> {
  const ccs = await db.select().from(s.costCenters).where(and(eq(s.costCenters.tenantId, tenantId), eq(s.costCenters.active, true)));
  const users = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, sectors: s.users.sectors, sectorRole: s.users.sectorRole }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true)));
  const roles = await db.select({ userId: s.userRoles.userId, key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(inArray(s.userRoles.userId, users.length ? users.map((u) => u.id) : ['00000000-0000-0000-0000-000000000000']));
  const all = ccs.map((c) => c.id);
  const out: Recipient[] = [];
  for (const u of users) {
    const prof = roles.filter((r) => r.userId === u.id).map((r) => r.key);
    if (prof.includes('diretoria')) { out.push({ userId: u.id, name: u.name, email: u.email, role: 'diretoria', costCenterIds: all }); continue; }
    if (u.sectors.includes('financeiro') && u.sectorRole !== 'observador') { out.push({ userId: u.id, name: u.name, email: u.email, role: 'financeiro', costCenterIds: all }); continue; }
    const managed = ccs.filter((c) => c.managerId === u.id || c.directorId === u.id).map((c) => c.id);
    if (managed.length) { out.push({ userId: u.id, name: u.name, email: u.email, role: 'gestor', costCenterIds: [...new Set([...managed, ...ccs.filter((c) => costCenterRole(c, u.id)).map((c) => c.id)])] }); continue; }
    const own = ccs.filter((c) => costCenterRole(c, u.id)).map((c) => c.id);
    if (own.length) out.push({ userId: u.id, name: u.name, email: u.email, role: 'responsavel', costCenterIds: own });
  }
  return out;
}

/** Aviso no sino (um por chave): quem recebe, título curto e o link que abre o item. */
export async function notifyBudget(db: DbOrTx, tenantId: string, userIds: (string | null | undefined)[], ev: { event: string; title: string; body?: string | null; link: string; key: string; actorId?: string | null }) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== ev.actorId))];
  if (!ids.length) return 0;
  const rows = await db.insert(s.userNotifications).values(ids.map((userId) => ({ tenantId, userId, module: 'orcamento', event: ev.event, title: ev.title.slice(0, 200), body: ev.body ?? null, link: ev.link, actorId: ev.actorId ?? null, dedupeKey: `orc:${ev.key}` }))).onConflictDoNothing().returning({ id: s.userNotifications.id });
  return rows.length;
}
/** Quem decide numa etapa (Gerência ou Diretoria), com cargo Liderança / gestor. */
export async function deciders(db: DbOrTx, tenantId: string, stage: 'gerencia' | 'diretoria') {
  const rows = await db.select({ id: s.users.id, key: s.roles.key, sectorRole: s.users.sectorRole }).from(s.users).innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), inArray(s.roles.key, stage === 'gerencia' ? ['gerencia', 'diretoria'] : ['diretoria'])));
  return [...new Set(rows.filter((r) => r.sectorRole === 'lideranca').map((r) => r.id))];
}
export async function financeUsers(db: DbOrTx, tenantId: string) {
  const rows = await db.select({ id: s.users.id, sectors: s.users.sectors, sectorRole: s.users.sectorRole }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true)));
  return rows.filter((u) => u.sectors.includes('financeiro') && u.sectorRole !== 'observador').map((u) => u.id);
}

/** Rotina diária: títulos que vencem em até 3 dias e vencidos (Financeiro e responsável), uma vez por estado e dia. */
export async function runBudgetPaymentAlerts(db: DbOrTx, tenantId: string, today: string) {
  const soon = new Date(Date.parse(`${today}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  const open = await db.select({ p: s.budgetPayables, code: s.budgetLines.code, what: s.budgetLines.what, ownerId: s.budgetLines.ownerId }).from(s.budgetPayables).innerJoin(s.budgetLines, eq(s.budgetLines.id, s.budgetPayables.lineId))
    .where(and(eq(s.budgetPayables.tenantId, tenantId), eq(s.budgetPayables.status, 'aberto'), sql`${s.budgetPayables.dueOn} <= ${soon}`));
  if (!open.length) return 0;
  const pays = await db.select().from(s.budgetPayments).where(inArray(s.budgetPayments.payableId, open.map((o) => o.p.id)));
  const fin = await financeUsers(db, tenantId);
  let n = 0;
  for (const o of open) {
    const sit = payableSituation({ id: o.p.id, amountCents: o.p.amountCents, dueOn: o.p.dueOn, status: 'aberto' }, pays.filter((x) => x.payableId === o.p.id).map((x) => ({ id: x.id, reversesId: x.reversesId, payableId: x.payableId, amountCents: x.amountCents, interestCents: x.interestCents, fineCents: x.fineCents, discountCents: x.discountCents, paidOn: x.paidOn, kind: x.kind as 'pagamento', reconciled: !!x.reconciledAt })), today);
    if (!sit.openCents) continue;
    const late = sit.flags.includes('vencido');
    n += await notifyBudget(db, tenantId, [...fin, o.ownerId], { event: late ? 'pagamento_vencido' : 'pagamento_a_vencer', title: `${late ? 'Pagamento vencido' : 'Pagamento vence em breve'}: ${o.code} ${o.what} (parcela ${o.p.installment}/${o.p.installments})`, link: '/orcamento?t=central', key: `${late ? 'vencido' : 'avencer'}:${o.p.id}:${late ? today : o.p.dueOn}` });
  }
  return n;
}

/** Limite de alerta e de bloqueio do centro no ano (política ou limites do centro): avisa donos, gestor e diretoria responsável uma vez por nível. */
export async function checkCostCenterLimit(db: DbOrTx, tenantId: string, ccId: string, year: number, actorId: string | null) {
  const [cc] = await db.select().from(s.costCenters).where(eq(s.costCenters.id, ccId)).limit(1);
  const [pol] = await db.select().from(s.budgetPolicies).where(eq(s.budgetPolicies.tenantId, tenantId)).limit(1);
  const alertPct = cc?.alertPct ?? pol?.alertPct ?? null, blockPct = cc?.blockPct ?? pol?.blockPct ?? null;
  if (!cc || (alertPct === null && blockPct === null)) return null;
  const r = await db.execute<{ authorized: string; consumed: string }>(sql`
    select coalesce((select sum(approved_cents) from budget_lines where cost_center_id = ${ccId} and deleted_at is null and approval_state in ('aprovado','aprovado_ressalvas') and month like ${`${year}-%`}), 0)
         + coalesce((select sum(delta_cents) from budget_adjustments where cost_center_id = ${ccId} and kind = 'guardiao' and status in ('aprovado','registrado') and year = ${year}), 0) as authorized,
      coalesce((select sum(greatest(coalesce(l.contracted_cents, 0), coalesce((select sum(e.amount_cents) from budget_expenses e where e.line_id = l.id and e.status = 'valido'), 0)))
        from budget_lines l where l.cost_center_id = ${ccId} and l.deleted_at is null and l.month like ${`${year}-%`}), 0)
      + coalesce((select sum(amount_cents) from budget_expenses where cost_center_id = ${ccId} and line_id is null and status = 'valido' and extract(year from occurred_on) = ${year}), 0) as consumed`);
  const authorized = Number(r.rows[0]!.authorized), consumed = Number(r.rows[0]!.consumed);
  const pct = authorized ? (consumed / authorized) * 100 : consumed ? Infinity : 0;
  const level = blockPct !== null && pct >= blockPct ? 'excedido' : alertPct !== null && pct >= alertPct ? 'alerta' : null;
  if (!level) return null;
  await notifyBudget(db, tenantId, [...cc.ownerIds, cc.leaderId, cc.managerId, cc.directorId], { event: level === 'excedido' ? 'limite_excedido' : 'limite_alerta', title: `${cc.code}: ${level === 'excedido' ? 'limite de bloqueio atingido' : 'limite de alerta atingido'} (${Number.isFinite(pct) ? Math.round(pct) : '∞'}% do autorizado em ${year})`, link: '/orcamento?t=central', key: `limite:${ccId}:${year}:${level}`, actorId });
  return level;
}
