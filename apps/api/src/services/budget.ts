/** Recursos e Orçamento: visibilidade por centro de custo, saldo disponível, consolidação do trimestre e histórico. */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { accountPath, executionBand, executionPct, monthsOfQuarter, sortAccounts, type AccountNature } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { forbidden, notFound } from '../http/errors';
import { level } from './scope';

/** Diretoria/gestão: nível Total no módulo (aprova, vê todos os centros, mantém a estrutura). */
export const isBudgetAdmin = (auth: AuthContext) => level(auth, 'orcamento') === 'total';

/** Supervisão (perfil Supervisor sem nível Total): lança e dá baixa, mas não exclui nem muda valor. */
export const isBudgetRestricted = (auth: AuthContext) => !isBudgetAdmin(auth) && auth.profiles.includes('supervisor') && !auth.profiles.includes('gerencia');

export async function costCentersOf(db: DbOrTx, auth: AuthContext, includeInactive = false) {
  const all = await db.select().from(s.costCenters).where(eq(s.costCenters.tenantId, auth.tenantId)).orderBy(s.costCenters.code);
  const list = includeInactive ? all : all.filter((c) => c.active);
  return isBudgetAdmin(auth) ? list : list.filter((c) => c.leaderId === auth.userId || c.memberIds.includes(auth.userId));
}
/** Centro de custo que a pessoa pode operar (líder, indicado pelo líder ou Diretoria). */
export async function loadCostCenter(db: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await db.select().from(s.costCenters).where(and(eq(s.costCenters.id, id), eq(s.costCenters.tenantId, auth.tenantId))).limit(1);
  if (!c) throw notFound('Centro de custo não encontrado.');
  if (!isBudgetAdmin(auth) && c.leaderId !== auth.userId && !c.memberIds.includes(auth.userId)) throw forbidden('Você não é responsável por este centro de custo.');
  return c;
}

export type Account = typeof s.budgetAccounts.$inferSelect;
export async function accountsOf(db: DbOrTx, tenantId: string) {
  const list = sortAccounts(await db.select().from(s.budgetAccounts).where(eq(s.budgetAccounts.tenantId, tenantId)));
  const parents = new Set(list.map((a) => a.parentId).filter(Boolean));
  return list.map((a) => ({ ...a, leaf: !parents.has(a.id), level: a.code.split('.').length, path: accountPath(a.id, list).map((x) => x.name).join(' › ') }));
}
/** Categoria de uma subcategoria = a conta-mãe (ou ela mesma, se for de primeiro nível). */
export const categoryOf = (accountId: string, all: { id: string; parentId: string | null }[]) => all.find((a) => a.id === accountId)?.parentId ?? accountId;

export async function logBudget(db: DbOrTx, auth: AuthContext | { tenantId: string; userId: string | null }, costCenterId: string | null, entity: string, entityId: string | null, action: string, summary: string) {
  await db.insert(s.budgetEvents).values({ tenantId: auth.tenantId, costCenterId, entity, entityId, action, summary: summary.slice(0, 1000), actorId: auth.userId });
}

/**
 * Números do trimestre por centro de custo e conta: planejado aprovado, em aprovação, ajustes do Guardião,
 * realizado e disponível. Base de tudo (tela, saldo para gastar, relatório).
 */
export async function quarterNumbers(db: DbOrTx, tenantId: string, year: number, quarter: number, ccIds: string[]) {
  if (!ccIds.length) return { rows: [] as Row[], months: monthsOfQuarter(year, quarter) };
  const months = monthsOfQuarter(year, quarter);
  const from = `${months[0]}-01`, until = quarter === 4 ? `${year + 1}-01-01` : `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-01`;
  const lines = await db.select({ cc: s.budgetLines.costCenterId, account: s.budgetLines.accountId, month: s.budgetLines.month, amount: s.budgetLines.amountCents, status: s.budgetLines.status })
    .from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, tenantId), inArray(s.budgetLines.costCenterId, ccIds), inArray(s.budgetLines.month, months), isNull(s.budgetLines.deletedAt)));
  const adj = await db.select({ cc: s.budgetAdjustments.costCenterId, account: s.budgetAdjustments.accountId, month: s.budgetAdjustments.month, delta: s.budgetAdjustments.deltaCents, status: s.budgetAdjustments.status })
    .from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.tenantId, tenantId), inArray(s.budgetAdjustments.costCenterId, ccIds), eq(s.budgetAdjustments.year, year), eq(s.budgetAdjustments.quarter, quarter)));
  const exp = await db.select({ cc: s.budgetExpenses.costCenterId, account: s.budgetExpenses.accountId, month: sql<string>`to_char(${s.budgetExpenses.occurredOn}, 'YYYY-MM')`, amount: s.budgetExpenses.amountCents })
    .from(s.budgetExpenses).where(and(eq(s.budgetExpenses.tenantId, tenantId), inArray(s.budgetExpenses.costCenterId, ccIds), eq(s.budgetExpenses.status, 'valido'), sql`${s.budgetExpenses.occurredOn} >= ${from} and ${s.budgetExpenses.occurredOn} < ${until}`));
  const key = (cc: string, a: string, m: string) => `${cc}|${a}|${m}`;
  const map = new Map<string, Row>();
  const get = (cc: string, a: string, m: string) => {
    const k = key(cc, a, m);
    let r = map.get(k);
    if (!r) { r = { cc, account: a, month: m, approved: 0, pending: 0, draft: 0, adjusted: 0, adjustPending: 0, realized: 0 }; map.set(k, r); }
    return r;
  };
  for (const l of lines) {
    const r = get(l.cc, l.account, l.month);
    if (l.status === 'aprovado') r.approved += l.amount; else if (l.status === 'em_aprovacao') r.pending += l.amount; else if (l.status === 'rascunho') r.draft += l.amount;
  }
  for (const a of adj) {
    const r = get(a.cc, a.account, a.month);
    if (a.status === 'registrado' || a.status === 'aprovado') r.adjusted += a.delta; else if (a.status === 'pendente') r.adjustPending += a.delta;
  }
  for (const e of exp) get(e.cc, e.account, e.month).realized += e.amount;
  return { rows: [...map.values()], months };
}
export type Row = { cc: string; account: string; month: string; approved: number; pending: number; draft: number; adjusted: number; adjustPending: number; realized: number };

/** Somatório com % de execução e faixa da política. Planejado = aprovado + ajustes do Guardião. */
export function totals(rows: Row[]) {
  const t = rows.reduce((a, r) => ({ approved: a.approved + r.approved, pending: a.pending + r.pending, draft: a.draft + r.draft, adjusted: a.adjusted + r.adjusted, adjustPending: a.adjustPending + r.adjustPending, realized: a.realized + r.realized }), { approved: 0, pending: 0, draft: 0, adjusted: 0, adjustPending: 0, realized: 0 });
  const planned = t.approved + t.adjusted;
  const pct = executionPct(planned, t.realized);
  return { ...t, planned, available: planned - t.realized, pct: pct === Infinity ? null : pct, over: pct === Infinity, band: executionBand(pct) };
}

/** Disponível para gastar numa subcategoria do centro no trimestre (aprovado + ajustes − realizado). */
export async function availableFor(db: DbOrTx, tenantId: string, ccId: string, accountId: string, year: number, quarter: number) {
  const { rows } = await quarterNumbers(db, tenantId, year, quarter, [ccId]);
  return totals(rows.filter((r) => r.account === accountId)).available;
}

export const natureOf = (a: { nature: string }) => a.nature as AccountNature;
