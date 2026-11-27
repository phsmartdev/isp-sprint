/**
 * Quadro de Tarefas — Etapa 8: indicadores do departamento e visão consolidada da gerência/diretoria (27/11/2026).
 *
 * Regras de cálculo (especificação, 23.3):
 * - esforço estimado/comprometido nunca é tratado como hora trabalhada; horas realizadas só vêm do apontamento;
 * - o plano original fica na base de cálculo mesmo com tarefas replanejadas (fotografia da abertura);
 * - contagem de tarefas concluídas não é indicador isolado de produtividade individual (nada de ranking por pessoa);
 * - o valor de uma oportunidade com várias atividades afetadas entra uma vez só.
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BOARD_KEYS, BOARD_LABELS, CAPACITY_CATEGORIES, dependencyAtRisk, dependencyState, weekStart, type BoardKey, type CapacityCategory } from '@isp/domain';
import { defineRoute } from '../http/route';
import { forbidden } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { ymd } from './workBoards';
import { level } from '../services/scope';
import { Board, addDays, boardOpenTasks, context, isoDay, peopleCapacity } from './workSprints';

type Ctx = Awaited<ReturnType<typeof context>>;
type Cat = Record<CapacityCategory, number>;
const zero = (): Cat => ({ comercial: 0, interno: 0, hipotese: 0 });
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Números de uma Sprint (aberta ou encerrada), opcionalmente de uma pessoa. */
async function sprintStats(db: DbOrTx, auth: AuthContext, sp: typeof s.workSprints.$inferSelect, ownerId?: string) {
  const items = await db.select({ i: s.workSprintItems, status: s.activities.status, completedAt: s.activities.completedAt }).from(s.workSprintItems)
    .innerJoin(s.activities, eq(s.activities.id, s.workSprintItems.activityId)).where(eq(s.workSprintItems.sprintId, sp.id));
  const end = addDays(sp.weekStart, 6);
  // entregue dentro da Sprint: concluída até o domingo da semana
  const delivered = (id: string) => { const x = items.find((r) => r.i.activityId === id); return !!x && x.status === 'concluida' && !!x.completedAt && ymd(x.completedAt, auth.timezone) <= end; };
  const snap = ((sp.snapshot ?? {}) as { items?: { id: string; minutes: number; category: CapacityCategory; ownerId: string }[] }).items ?? [];
  const original = snap.filter((o) => !ownerId || o.ownerId === ownerId);
  const mine = items.filter((r) => !ownerId || r.i.ownerId === ownerId);
  const active = mine.filter((r) => !r.i.removedAt);
  const sum = <T,>(l: readonly T[], f: (x: T) => number) => l.reduce((t, x) => t + f(x), 0);
  const byCat = (l: typeof active, only?: (r: (typeof active)[number]) => boolean) => { const c = zero(); for (const r of l) if (!only || only(r)) c[r.i.category as CapacityCategory] += r.i.committedMinutes; return c; };
  const policy = (sp.policy ?? { comercial: 7000, interno: 2000, hipotese: 1000 }) as Cat;
  const planned = byCat(active);
  const executed = byCat(active, (r) => delivered(r.i.activityId));
  const totalPlanned = sum(CAPACITY_CATEGORIES, (c) => planned[c]);
  const deviation = (d: Cat) => { const t = sum(CAPACITY_CATEGORIES, (c) => d[c]); return t ? Math.round(Math.max(...CAPACITY_CATEGORIES.map((c) => Math.abs((d[c] / t) * 100 - policy[c] / 100))) * 10) / 10 : null; };
  const displaced = byCat(mine.filter((r) => r.i.removedAt && r.i.requestId));
  return {
    id: sp.id, weekStart: sp.weekStart, status: sp.status,
    original: { minutes: sum(original, (o) => o.minutes), deliveredMinutes: sum(original.filter((o) => delivered(o.id)), (o) => o.minutes) },
    revised: { minutes: sum(active, (r) => r.i.committedMinutes), deliveredMinutes: sum(active.filter((r) => delivered(r.i.activityId)), (r) => r.i.committedMinutes) },
    unplannedMinutes: sum(active.filter((r) => r.i.entry === 'fura_fila'), (r) => r.i.committedMinutes),
    furaFilas: active.filter((r) => r.i.entry === 'fura_fila').length,
    replanned: mine.filter((r) => r.i.removedAt).length,
    displaced, planned, executed, policy: { comercial: policy.comercial, interno: policy.interno, hipotese: policy.hipotese },
    plannedDeviationPp: deviation(planned), executedDeviationPp: deviation(executed), totalPlanned,
  };
}

/** Tarefas abertas do quadro com o contexto de negócio (oportunidade, conta, contrato, projeto). */
async function openWithBusiness(db: DbOrTx, auth: AuthContext, board: BoardKey, ctx: Ctx) {
  const rows = await boardOpenTasks(db, auth, board, ctx);
  const today = ymd(new Date(), auth.timezone);
  const extra = rows.length ? await db.select({ id: s.activities.id, contractId: s.activities.contractId, projectId: s.activities.projectId, contractCode: s.contracts.code, projectName: s.projects.name, oppStage: s.opportunities.stage })
    .from(s.activities).leftJoin(s.contracts, eq(s.contracts.id, s.activities.contractId)).leftJoin(s.projects, eq(s.projects.id, s.activities.projectId)).leftJoin(s.opportunities, eq(s.opportunities.id, s.activities.opportunityId))
    .where(inArray(s.activities.id, rows.map((r) => r.a.id))) : [];
  return rows.map((r) => {
    const x = extra.find((e) => e.id === r.a.id);
    const dueDay = r.a.dueAt ? ymd(r.a.dueAt, auth.timezone) : null;
    return {
      a: r.a, ownerName: r.ownerName, dueDay, overdue: !!dueDay && dueDay < today,
      opportunity: r.a.opportunityId ? { id: r.a.opportunityId, label: `OP-${r.oppCode} · ${r.contactName ?? r.oppTitle ?? ''}`, valueCents: r.oppValue ?? null, stage: x?.oppStage ?? null, ownerName: r.oppOwnerName } : null,
      contract: r.a.contractId ? { id: r.a.contractId, label: `Contrato ${x?.contractCode ?? ''}` } : null,
      project: r.a.projectId ? { id: r.a.projectId, label: x?.projectName ?? 'Projeto' } : null,
      client: r.contactName,
    };
  });
}
const businessLink = (t: Awaited<ReturnType<typeof openWithBusiness>>[number]) => t.opportunity?.label ?? t.contract?.label ?? (t.project ? `Projeto ${t.project.label}` : null) ?? t.client ?? null;

export const workIndicatorRoutes = [
  defineRoute({
    method: 'GET', url: '/quadros/:board/indicadores', summary: 'Indicadores do departamento no período (cumprimento do plano original e revisado, 70/20/10, não planejado, comercial deslocado, bloqueios, capacidade, lead e cycle time)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board, query: z.object({ from: isoDay.optional(), to: isoDay.optional(), ownerId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, query }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      const today = ymd(new Date(), auth.timezone);
      const to = weekStart(query.to ?? today);
      const from = weekStart(query.from ?? addDays(to, -49));
      const sprints = await app.db.select().from(s.workSprints).where(and(eq(s.workSprints.tenantId, auth.tenantId), eq(s.workSprints.boardKey, board), inArray(s.workSprints.status, ['andamento', 'encerrada']), gte(s.workSprints.weekStart, from), lte(s.workSprints.weekStart, to))).orderBy(desc(s.workSprints.weekStart));
      const history = await Promise.all(sprints.map((sp) => sprintStats(app.db, auth, sp, query.ownerId)));
      const tot = (f: (h: (typeof history)[number]) => number) => history.reduce((t, h) => t + f(h), 0);
      const displaced = zero(); const planned = zero(); const executed = zero();
      for (const h of history) for (const c of CAPACITY_CATEGORIES) { displaced[c] += h.displaced[c]; planned[c] += h.planned[c]; executed[c] += h.executed[c]; }
      // frequência de consumo das camadas pelos fura-filas efetivados
      const sids = sprints.map((x) => x.id);
      const ffEvents = sids.length ? await app.db.select({ payload: s.workSprintEvents.payload }).from(s.workSprintEvents).where(and(inArray(s.workSprintEvents.sprintId, sids), eq(s.workSprintEvents.type, 'fura_fila'))) : [];
      const layers = { hipotese: 0, interno: 0, comercial: 0, livre: 0 };
      for (const e of ffEvents) { const d = (e.payload as { displaced?: Cat; freeUsedMinutes?: number }); if (d.freeUsedMinutes) layers.livre++; for (const c of CAPACITY_CATEGORIES) if ((d.displaced?.[c] ?? 0) > 0) layers[c]++; }
      const requests = sids.length ? await app.db.select({ origin: s.workSprintRequests.origin, status: s.workSprintRequests.status }).from(s.workSprintRequests).where(inArray(s.workSprintRequests.sprintId, sids)) : [];
      const origins = [...requests.reduce((m, r) => m.set(r.origin, (m.get(r.origin) ?? 0) + 1), new Map<string, number>())].map(([origin, n]) => ({ origin, n })).sort((a, b) => b.n - a.n).slice(0, 8);

      // situação atual do quadro
      const open = (await openWithBusiness(app.db, auth, board, ctx)).filter((t) => !query.ownerId || t.a.ownerId === query.ownerId);
      const cur = weekStart(today);
      const commercialOut = open.filter((t) => t.opportunity && t.a.plannedWeek !== cur);
      const opps = new Map(commercialOut.map((t) => [t.opportunity!.id, t.opportunity!]));
      const critical = open.filter((t) => t.overdue && (t.opportunity || t.contract || t.project || t.a.contactId));
      const blockedIds = open.filter((t) => t.a.status === 'aguardando').map((t) => t.a.id);
      const since = blockedIds.length ? await app.db.select({ id: s.activityEvents.activityId, at: sql<Date>`max(${s.activityEvents.occurredAt})` }).from(s.activityEvents)
        .where(and(inArray(s.activityEvents.activityId, blockedIds), eq(s.activityEvents.type, 'status'), sql`${s.activityEvents.payload}->>'to' = 'aguardando'`)).groupBy(s.activityEvents.activityId) : [];
      const now = Date.now();
      const blocked = open.filter((t) => t.a.status === 'aguardando').map((t) => { const at = since.find((x) => x.id === t.a.id)?.at; return { id: t.a.id, title: t.a.title, ownerName: t.ownerName, waitingOn: t.a.waitingOn, days: at ? Math.floor((now - new Date(at).getTime()) / 86_400_000) : null }; });

      // capacidade por pessoa na semana atual: disponível, comprometida e restante (estimado, não horas trabalhadas)
      const people = await peopleCapacity(app.db, auth.tenantId, board, cur, ctx.members, ctx.byUser, ctx.boards);
      const [curSprint] = await app.db.select().from(s.workSprints).where(and(eq(s.workSprints.tenantId, auth.tenantId), eq(s.workSprints.boardKey, board), eq(s.workSprints.weekStart, cur), sql`${s.workSprints.status} <> 'cancelada'`)).limit(1);
      const curItems = curSprint ? await app.db.select({ ownerId: s.workSprintItems.ownerId, minutes: s.workSprintItems.committedMinutes, status: s.activities.status, remaining: s.activities.remainingMinutes }).from(s.workSprintItems)
        .innerJoin(s.activities, eq(s.activities.id, s.workSprintItems.activityId)).where(and(eq(s.workSprintItems.sprintId, curSprint.id), isNull(s.workSprintItems.removedAt))) : [];
      const capacity = people.filter((p) => !query.ownerId || p.userId === query.ownerId).map((p) => {
        const mine = curItems.filter((i) => i.ownerId === p.userId);
        const committed = mine.reduce((t, i) => t + i.minutes, 0);
        return { userId: p.userId, name: p.name, availableMinutes: p.netMinutes, committedMinutes: committed, remainingMinutes: mine.filter((i) => i.status !== 'concluida').reduce((t, i) => t + (i.remaining ?? i.minutes), 0), overload: p.netMinutes === null ? committed > 0 : committed > p.netMinutes };
      });

      // fluxo: tarefas do quadro concluídas no período (lead time = criação → conclusão; cycle time = início da execução → conclusão)
      const periodEnd = addDays(to, 6);
      const doneRows = await app.db.select({ id: s.activities.id, ownerId: s.activities.ownerId, boardKey: s.activities.boardKey, createdAt: s.activities.createdAt, completedAt: s.activities.completedAt, estimate: s.activities.estimateMinutes }).from(s.activities)
        .where(and(eq(s.activities.tenantId, auth.tenantId), isNull(s.activities.deletedAt), isNull(s.activities.parentId), eq(s.activities.status, 'concluida'), sql`${s.activities.completedAt} >= ${from}::date`, sql`${s.activities.completedAt} < (${periodEnd}::date + 1)`,
          query.ownerId ? eq(s.activities.ownerId, query.ownerId) : ctx.members.length ? sql`(${s.activities.boardKey} = ${board} or (${s.activities.boardKey} is null and ${inArray(s.activities.ownerId, ctx.members)}))` : eq(s.activities.boardKey, board)));
      const dids = doneRows.map((d) => d.id);
      const [starts, time] = dids.length ? await Promise.all([
        app.db.select({ id: s.activityEvents.activityId, at: sql<Date>`min(${s.activityEvents.occurredAt})` }).from(s.activityEvents).where(and(inArray(s.activityEvents.activityId, dids), eq(s.activityEvents.type, 'status'), sql`${s.activityEvents.payload}->>'to' = 'em_andamento'`)).groupBy(s.activityEvents.activityId),
        app.db.select({ id: s.activityTimeEntries.activityId, minutes: sql<number>`sum(case when ${s.activityTimeEntries.reversesId} is null then ${s.activityTimeEntries.minutes} else -${s.activityTimeEntries.minutes} end)::int` }).from(s.activityTimeEntries).where(inArray(s.activityTimeEntries.activityId, dids)).groupBy(s.activityTimeEntries.activityId),
      ]) : [[], []];
      const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 86_400_000;
      const avg = (l: number[]) => (l.length ? Math.round((l.reduce((t, x) => t + x, 0) / l.length) * 10) / 10 : null);
      const withTime = doneRows.filter((d) => time.find((t) => t.id === d.id)?.minutes && d.estimate);

      return {
        board: { key: board, label: BOARD_LABELS[board] }, role: ctx.role, period: { from, to: periodEnd }, basis: 'esforço estimado/comprometido (não são horas trabalhadas)',
        compliance: {
          original: { minutes: tot((h) => h.original.minutes), deliveredMinutes: tot((h) => h.original.deliveredMinutes), pct: pct(tot((h) => h.original.deliveredMinutes), tot((h) => h.original.minutes)) },
          revised: { minutes: tot((h) => h.revised.minutes), deliveredMinutes: tot((h) => h.revised.deliveredMinutes), pct: pct(tot((h) => h.revised.deliveredMinutes), tot((h) => h.revised.minutes)) },
        },
        distribution: { planned, executed, policy: history[0]?.policy ?? null },
        unplanned: { minutes: tot((h) => h.unplannedMinutes), pct: pct(tot((h) => h.unplannedMinutes), tot((h) => h.revised.minutes)) },
        displaced,
        furaFilas: { included: tot((h) => h.furaFilas), requests: requests.length, rejected: requests.filter((r) => r.status === 'rejeitada').length, origins, layers },
        replanned: tot((h) => h.replanned),
        commercialUnplanned: { tasks: commercialOut.length, estimateMinutes: commercialOut.reduce((t, x) => t + (x.a.estimateMinutes ?? 0), 0), withoutEstimate: commercialOut.filter((x) => !x.a.estimateMinutes).length,
          opportunities: opps.size, valueCents: [...opps.values()].reduce((t, o) => t + (o.valueCents ?? 0), 0) },
        criticalLate: critical.slice(0, 30).map((t) => ({ id: t.a.id, title: t.a.title, ownerName: t.ownerName, dueDay: t.dueDay, link: businessLink(t) })),
        blocked: { count: blocked.length, items: blocked.slice(0, 30) },
        capacity,
        flow: {
          done: doneRows.length,
          leadTimeDays: avg(doneRows.map((d) => days(d.createdAt, d.completedAt!))),
          cycleTimeDays: avg(doneRows.map((d) => { const st = starts.find((x) => x.id === d.id)?.at; return st ? days(new Date(st), d.completedAt!) : null; }).filter((x): x is number => x !== null)),
          // estimado × realizado só onde há apontamento de horas
          estimateVsActual: withTime.length ? { tasks: withTime.length, estimateMinutes: withTime.reduce((t, d) => t + (d.estimate ?? 0), 0), actualMinutes: withTime.reduce((t, d) => t + (time.find((x) => x.id === d.id)?.minutes ?? 0), 0) } : null,
        },
        history: history.map((h) => ({ weekStart: h.weekStart, status: h.status, originalPct: pct(h.original.deliveredMinutes, h.original.minutes), revisedPct: pct(h.revised.deliveredMinutes, h.revised.minutes), originalMinutes: h.original.minutes, revisedMinutes: h.revised.minutes, unplannedMinutes: h.unplannedMinutes, furaFilas: h.furaFilas, displacedComercial: h.displaced.comercial, plannedDeviationPp: h.plannedDeviationPp })),
      };
    },
  }),

  defineRoute({
    method: 'GET', url: '/quadros/visao-geral', summary: 'Visão consolidada da gerência e diretoria: departamentos sob a sua gestão, compromissos de negócio afetados, projetos em risco, dependências entre times e aprovações pendentes', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      // escopo sobre vários departamentos: diretoria/administrador ou perfil com alcance total das tarefas (ex.: gerência geral)
      const wide = auth.profiles.some((p) => ['diretoria', 'administrador'].includes(p)) || level(auth, 'atividades') === 'total';
      const today = ymd(new Date(), auth.timezone);
      const cur = weekStart(today);
      const since = addDays(cur, -56);
      const departments = [];
      const allOpen: (Awaited<ReturnType<typeof openWithBusiness>>[number] & { board: BoardKey })[] = [];
      for (const board of BOARD_KEYS.filter((b) => b !== 'marketing')) {
        let ctx: Ctx;
        try { ctx = await context(app.db, auth, board); } catch { continue; }
        if (ctx.role !== 'gestao' && !wide) continue;
        if (!ctx.cfg.teamIds.length) continue;
        const sprints = await app.db.select().from(s.workSprints).where(and(eq(s.workSprints.tenantId, auth.tenantId), eq(s.workSprints.boardKey, board), inArray(s.workSprints.status, ['planejamento', 'andamento', 'encerrada']), gte(s.workSprints.weekStart, since), lte(s.workSprints.weekStart, cur))).orderBy(desc(s.workSprints.weekStart));
        const current = sprints.find((x) => x.weekStart === cur) ?? null;
        const lastClosed = sprints.find((x) => x.status === 'encerrada') ?? null;
        const [curStats, lastStats] = await Promise.all([current && current.status !== 'planejamento' ? sprintStats(app.db, auth, current) : null, lastClosed ? sprintStats(app.db, auth, lastClosed) : null]);
        const periodStats = await Promise.all(sprints.filter((x) => x.status !== 'planejamento').map((x) => sprintStats(app.db, auth, x)));
        const people = await peopleCapacity(app.db, auth.tenantId, board, cur, ctx.members, ctx.byUser, ctx.boards);
        const curItems = current ? await app.db.select({ ownerId: s.workSprintItems.ownerId, minutes: s.workSprintItems.committedMinutes }).from(s.workSprintItems).where(and(eq(s.workSprintItems.sprintId, current.id), isNull(s.workSprintItems.removedAt))) : [];
        const overload = people.map((p) => ({ name: p.name, net: p.netMinutes, committed: curItems.filter((i) => i.ownerId === p.userId).reduce((t, i) => t + i.minutes, 0) })).filter((p) => (p.net === null ? p.committed > 0 : p.committed > p.net));
        const pending = current ? await app.db.select({ id: s.workSprintRequests.id, title: s.activities.title, status: s.workSprintRequests.status, createdAt: s.workSprintRequests.createdAt }).from(s.workSprintRequests)
          .innerJoin(s.activities, eq(s.activities.id, s.workSprintRequests.activityId)).where(and(eq(s.workSprintRequests.sprintId, current.id), inArray(s.workSprintRequests.status, ['pendente', 'aguardando_gerencia']))) : [];
        const open = await openWithBusiness(app.db, auth, board, ctx);
        allOpen.push(...open.map((o) => ({ ...o, board })));
        departments.push({
          key: board, label: BOARD_LABELS[board], role: ctx.role,
          capacity: { totalNetMinutes: people.reduce((t, p) => t + (p.netMinutes ?? 0), 0), committedMinutes: curItems.reduce((t, i) => t + i.minutes, 0), withoutSchedule: people.filter((p) => p.netMinutes === null).map((p) => p.name) },
          sprint: current ? { id: current.id, status: current.status, objective: current.objective, progressPct: curStats ? pct(curStats.revised.deliveredMinutes, curStats.revised.minutes) : null, planned: curStats?.planned ?? null, deviationPp: curStats?.plannedDeviationPp ?? null, furaFilas: curStats?.furaFilas ?? 0 } : null,
          lastClosed: lastStats ? { weekStart: lastStats.weekStart, originalPct: pct(lastStats.original.deliveredMinutes, lastStats.original.minutes), revisedPct: pct(lastStats.revised.deliveredMinutes, lastStats.revised.minutes) } : null,
          displacedComercialMinutes: periodStats.reduce((t, h) => t + h.displaced.comercial, 0),
          furaFilas: periodStats.reduce((t, h) => t + h.furaFilas, 0),
          overload, pendingApprovals: pending.filter((p) => p.status === 'aguardando_gerencia').map((p) => ({ id: p.id, title: p.title, since: p.createdAt })), pendingDecisions: pending.filter((p) => p.status === 'pendente').length,
          overdue: open.filter((t) => t.overdue).length, blocked: open.filter((t) => t.a.status === 'aguardando').length,
        });
      }
      if (!departments.length) throw forbidden('A visão consolidada é da gerência e da diretoria dos departamentos (equipes configuradas nos Quadros de Tarefas).');

      // compromissos de negócio afetados: oportunidades com tarefa atrasada, bloqueada ou deslocada por fura-fila (valor uma vez por oportunidade)
      const displacedIds = (await app.db.select({ id: s.workSprintItems.activityId }).from(s.workSprintItems).innerJoin(s.workSprints, eq(s.workSprints.id, s.workSprintItems.sprintId))
        .where(and(eq(s.workSprintItems.tenantId, auth.tenantId), sql`${s.workSprintItems.requestId} is not null`, sql`${s.workSprintItems.removedAt} is not null`, gte(s.workSprints.weekStart, since), inArray(s.workSprints.boardKey, departments.map((d) => d.key))))).map((x) => x.id);
      const opps = new Map<string, { id: string; label: string; valueCents: number | null; stage: string | null; ownerName: string | null; reasons: Set<string>; departments: Set<string> }>();
      for (const t of allOpen) {
        if (!t.opportunity) continue;
        const reasons = [t.overdue ? 'tarefa atrasada' : '', t.a.status === 'aguardando' ? 'tarefa bloqueada' : '', displacedIds.includes(t.a.id) ? 'replanejada por fura-fila' : ''].filter(Boolean);
        if (!reasons.length) continue;
        const o = opps.get(t.opportunity.id) ?? { ...t.opportunity, reasons: new Set<string>(), departments: new Set<string>() };
        reasons.forEach((r) => o.reasons.add(r)); o.departments.add(BOARD_LABELS[t.board]);
        opps.set(t.opportunity.id, o);
      }
      const impacted = [...opps.values()].map((o) => ({ ...o, reasons: [...o.reasons], departments: [...o.departments] })).sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0));

      // dependências entre departamentos em risco
      const openIds = allOpen.map((t) => t.a.id);
      const edges = openIds.length ? await app.db.select({ dep: s.activityDependencies.activityId, pred: s.activityDependencies.dependsOnId }).from(s.activityDependencies).where(inArray(s.activityDependencies.activityId, openIds)) : [];
      const byId = new Map(allOpen.map((t) => [t.a.id, t]));
      const predRows = edges.length ? await app.db.select({ id: s.activities.id, title: s.activities.title, status: s.activities.status, dueAt: s.activities.dueAt }).from(s.activities).where(inArray(s.activities.id, [...new Set(edges.map((e) => e.pred))])) : [];
      const dependencies = edges.map((e) => {
        const dep = byId.get(e.dep)!; const pred = predRows.find((p) => p.id === e.pred); const predOpen = byId.get(e.pred);
        if (!pred || !predOpen || predOpen.board === dep.board) return null;
        const state = dependencyState({ status: pred.status, dueDay: pred.dueAt ? ymd(pred.dueAt, auth.timezone) : null }, dep.dueDay, today);
        return dependencyAtRisk(state) ? { predecessor: { id: pred.id, title: pred.title, board: BOARD_LABELS[predOpen.board] }, dependent: { id: dep.a.id, title: dep.a.title, board: BOARD_LABELS[dep.board], link: businessLink(dep) }, state } : null;
      }).filter((x): x is NonNullable<typeof x> => !!x);

      // projetos em risco: tarefa atrasada ou bloqueada, ou dependência entre times em risco
      const projects = new Map<string, { id: string; label: string; overdue: number; blocked: number; depRisk: number; departments: Set<string> }>();
      for (const t of allOpen) {
        if (!t.project) continue;
        const p = projects.get(t.project.id) ?? { id: t.project.id, label: t.project.label, overdue: 0, blocked: 0, depRisk: 0, departments: new Set<string>() };
        if (t.overdue) p.overdue++; if (t.a.status === 'aguardando') p.blocked++;
        if (dependencies.some((d) => d.dependent.id === t.a.id)) p.depRisk++;
        p.departments.add(BOARD_LABELS[t.board]);
        projects.set(t.project.id, p);
      }
      const projectsAtRisk = [...projects.values()].filter((p) => p.overdue || p.blocked || p.depRisk).map((p) => ({ ...p, departments: [...p.departments] }));
      return {
        week: cur, departments,
        business: { opportunities: impacted.slice(0, 40), opportunitiesCount: impacted.length, valueCents: impacted.reduce((t, o) => t + (o.valueCents ?? 0), 0) },
        projectsAtRisk, dependencies,
      };
    },
  }),
];
