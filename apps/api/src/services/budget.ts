/** Recursos e Orçamento: visibilidade por centro de custo, saldo disponível, consolidação do trimestre e histórico. */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { accountPath, executionBand, executionPct, monthsOfQuarter, sortAccounts, type AccountNature } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { forbidden, notFound, unprocessable } from '../http/errors';
import { level } from './scope';

/** Diretoria/gestão: nível Total no módulo (aprova, vê todos os centros, mantém a estrutura). */
export const isBudgetAdmin = (auth: AuthContext) => level(auth, 'orcamento') === 'total';

/**
 * Alçadas do orçamento pelo perfil: a liderança planeja e executa o próprio centro; a Gerência aprova o que a liderança lança
 * (e envia à Diretoria), remaneja saldo entre contas do centro e pede o Budget Guardião; a Diretoria dá a aprovação final e decide o Guardião.
 */
export type BudgetRole = 'diretoria' | 'gerencia' | 'lideranca';
export const budgetRole = (auth: AuthContext): BudgetRole => (auth.profiles.some((p) => p === 'diretoria' || p === 'administrador') ? 'diretoria' : auth.profiles.includes('gerencia') ? 'gerencia' : 'lideranca');
/** Etapas de aprovação que a pessoa decide. */
/**
 * Quem decide o orçamento: Diretoria (aprovação final; também decide a etapa da Gerência) e Gerência.
 * Administrador configura, mas não recebe poder de aprovação financeira só por ser administrador (prompt master, 4.1),
 * e quem não tem cargo Liderança / gestor no setor não aprova.
 */
export const decidesStages = (auth: AuthContext & { sectorRole?: string | null }): ('gerencia' | 'diretoria')[] => {
  if (auth.sectorRole && auth.sectorRole !== 'lideranca') return [];
  if (auth.profiles.includes('diretoria')) return ['gerencia', 'diretoria'];
  if (auth.profiles.includes('gerencia')) return ['gerencia'];
  return [];
};
/** Financeiro: quem está no setor Financeiro (e não é só observador) valida documentos, registra pagamentos e concilia. */
export const isFinance = (auth: AuthContext) => auth.sectors.includes('financeiro');
export const budgetCan = (auth: AuthContext) => {
  const r = budgetRole(auth);
  return { role: r, decideStages: decidesStages(auth), guardian: r === 'gerencia', decideGuardian: r === 'diretoria', transfer: r !== 'lideranca' };
};

/** Supervisão (perfil Supervisor sem nível Total): lança e dá baixa, mas não exclui nem muda valor. */
export const isBudgetRestricted = (auth: AuthContext) => !isBudgetAdmin(auth) && auth.profiles.includes('supervisor') && !auth.profiles.includes('gerencia') && !auth.profiles.includes('administrador');

/**
 * Cada time é um centro de custo: cria o centro do time que ainda não tem e mantém nome, responsáveis e situação
 * acompanhando o time (líder = primeiro líder do time, ou o primeiro gestor; demais líderes e gestores também operam).
 */
export async function ensureTeamCostCenters(db: DbOrTx, tenantId: string) {
  const [teams, members, ccs] = await Promise.all([
    db.select({ id: s.teams.id, name: s.teams.name, active: s.teams.active, managerIds: s.teams.managerIds, sub: s.teams.substituteLeadId }).from(s.teams).where(eq(s.teams.tenantId, tenantId)),
    db.select({ teamId: s.teamMemberships.teamId, userId: s.teamMemberships.userId }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(and(eq(s.teams.tenantId, tenantId), eq(s.teamMemberships.isLead, true))),
    db.select().from(s.costCenters).where(eq(s.costCenters.tenantId, tenantId)),
  ]);
  const codes = new Set(ccs.map((c) => c.code));
  for (const t of teams) {
    const leads = members.filter((m) => m.teamId === t.id).map((m) => m.userId).sort();
    const people = [...new Set([...leads, ...(t.sub ? [t.sub] : []), ...t.managerIds])];
    const leaderId = leads[0] ?? t.managerIds[0] ?? null;
    const memberIds = people.filter((u) => u !== leaderId).sort();
    const cc = ccs.find((c) => c.teamId === t.id);
    if (!cc) {
      if (!t.active) continue;
      const base = `T-${t.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'TIME'}`;
      let code = base, n = 2;
      while (codes.has(code)) code = `${base}-${n++}`;
      codes.add(code);
      await db.insert(s.costCenters).values({ tenantId, code, name: t.name, leaderId, memberIds, ownerIds: t.managerIds, executorIds: leads, teamId: t.id, active: true }).onConflictDoNothing();
    } else if (cc.name !== t.name || cc.leaderId !== leaderId || cc.active !== t.active || [...cc.memberIds].sort().join() !== memberIds.join()) {
      await db.update(s.costCenters).set({ name: t.name, leaderId, memberIds, active: t.active, updatedAt: new Date() }).where(eq(s.costCenters.id, cc.id));
    }
  }
}

type CC = typeof s.costCenters.$inferSelect;
/**
 * Associação do centro de custo: Dono do orçamento (gestor da área, um ou mais) e Responsável pela execução
 * (supervisão ou gestão). Sem donos definidos, o líder é o dono; sem execução definida, valem as pessoas indicadas.
 */
export function costCenterRole(c: CC, userId: string): 'dono' | 'execucao' | null {
  const owner = c.ownerIds.length ? c.ownerIds.includes(userId) : c.leaderId === userId;
  if (owner) return 'dono';
  return (c.executorIds.length ? c.executorIds.includes(userId) : c.memberIds.includes(userId)) ? 'execucao' : null;
}
export type CostCenterNeed = 'ver' | 'planejar' | 'executar';
const allows = (auth: AuthContext, c: CC, need: CostCenterNeed) => {
  if (isBudgetAdmin(auth)) return true;
  const r = costCenterRole(c, auth.userId);
  return need === 'planejar' ? r === 'dono' : r !== null;
};

/** Perfis aceitos em cada papel do centro de custo. */
export const OWNER_PROFILES = ['gerencia', 'diretoria', 'administrador'];
export const EXECUTOR_PROFILES = ['supervisor', 'gerencia', 'diretoria', 'administrador'];
/** Confere a associação: dono = gestor da área; execução = supervisão ou gestão. */
export async function assertCostCenterPeople(db: DbOrTx, tenantId: string, ownerIds: string[] | undefined, executorIds: string[] | undefined) {
  const ids = [...new Set([...(ownerIds ?? []), ...(executorIds ?? [])])];
  if (!ids.length) return;
  const rows = await db.select({ userId: s.userRoles.userId, key: s.roles.key, name: s.users.name }).from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).innerJoin(s.users, eq(s.users.id, s.userRoles.userId))
    .where(and(eq(s.users.tenantId, tenantId), inArray(s.userRoles.userId, ids)));
  const profiles = (u: string) => rows.filter((r) => r.userId === u).map((r) => r.key);
  const nameOf = (u: string) => rows.find((r) => r.userId === u)?.name ?? 'pessoa';
  for (const u of ownerIds ?? []) if (!profiles(u).some((p) => OWNER_PROFILES.includes(p))) throw unprocessable(`${nameOf(u)} não é gestor(a): Dono do orçamento precisa ter perfil Gerência ou Diretoria.`, [{ path: 'ownerIds', message: 'Só gestores' }]);
  for (const u of executorIds ?? []) if (!profiles(u).some((p) => EXECUTOR_PROFILES.includes(p))) throw unprocessable(`${nameOf(u)} não pode ser Responsável pela execução: precisa ter perfil Supervisão ou Gerência.`, [{ path: 'executorIds', message: 'Só supervisão ou gestão' }]);
}

export async function costCentersOf(db: DbOrTx, auth: AuthContext, includeInactive = false) {
  await ensureTeamCostCenters(db, auth.tenantId);
  const all = await db.select().from(s.costCenters).where(eq(s.costCenters.tenantId, auth.tenantId)).orderBy(s.costCenters.code);
  const list = includeInactive ? all : all.filter((c) => c.active);
  return isBudgetAdmin(auth) ? list : list.filter((c) => costCenterRole(c, auth.userId) !== null);
}
/** Centro de custo que a pessoa pode operar (líder, indicado pelo líder ou Diretoria). */
export async function loadCostCenter(db: DbOrTx, auth: AuthContext, id: string, need: CostCenterNeed = 'ver') {
  const [c] = await db.select().from(s.costCenters).where(and(eq(s.costCenters.id, id), eq(s.costCenters.tenantId, auth.tenantId))).limit(1);
  if (!c) throw notFound('Centro de custo não encontrado.');
  if (!allows(auth, c, 'ver')) throw forbidden('Você não é responsável por este centro de custo.');
  if (!allows(auth, c, need)) throw forbidden(need === 'planejar' ? 'Só o Dono do orçamento deste centro de custo planeja, pede ajustes e remaneja.' : 'Só o Dono do orçamento ou o Responsável pela execução deste centro de custo lançam aqui.');
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
  const lines = await db.select({ cc: s.budgetLines.costCenterId, account: s.budgetLines.accountId, month: s.budgetLines.month, amount: sql<number>`case when ${s.budgetLines.status} = 'aprovado' then coalesce(${s.budgetLines.approvedCents}, ${s.budgetLines.amountCents}) else ${s.budgetLines.amountCents} end`.mapWith(Number), status: s.budgetLines.status })
    .from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, tenantId), inArray(s.budgetLines.costCenterId, ccIds), inArray(s.budgetLines.month, months), isNull(s.budgetLines.deletedAt)));
  const adj = await db.select({ cc: s.budgetAdjustments.costCenterId, account: s.budgetAdjustments.accountId, month: s.budgetAdjustments.month, delta: s.budgetAdjustments.deltaCents, status: s.budgetAdjustments.status })
    .from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.tenantId, tenantId), inArray(s.budgetAdjustments.costCenterId, ccIds), eq(s.budgetAdjustments.year, year), eq(s.budgetAdjustments.quarter, quarter), sql`${s.budgetAdjustments.kind} <> 'excedente'`));
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

/** Próximo código de lançamento da empresa no ano (ORC-2026-0001). Chame dentro de uma transação. */
export async function nextLineCode(db: DbOrTx, tenantId: string, year: number) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`budget-code:${tenantId}`}))`);
  const r = await db.execute<{ n: number }>(sql`select coalesce(max(substring(code from '[0-9]+$')::int), 0) + 1 as n from budget_lines where tenant_id = ${tenantId} and code like ${`ORC-${year}-%`}`);
  return `ORC-${year}-${String(r.rows[0]!.n).padStart(4, '0')}`;
}
