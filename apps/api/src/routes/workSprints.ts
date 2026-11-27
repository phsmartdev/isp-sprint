/**
 * Quadro de Tarefas — Etapa 5: capacidade, Planejar Semana e Sprint semanal (27/11/2026).
 *
 * Capacidade em horas estimadas (nunca contagem de tarefas): jornada − feriados − férias − ausências − reservas, na parte
 * da pessoa no departamento. Planejar Semana é da liderança/gestão do próprio quadro. Abrir a Sprint grava a fotografia
 * imutável do plano original; durante a semana, retirar pede motivo e fica no histórico; tarefa nova não entra sozinha.
 * Encerrar compara original × revisado e devolve as pendentes ao backlog (sem empurrar em silêncio para a próxima).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  ABSENCE_KINDS, BOARD_KEYS, BOARD_LABELS, CAPACITY_CATEGORIES, boardOfTask, categoryTargets, commitIssues, taskCategory, taskOrigin, weekCapacity, weekStart,
  type BoardKey, type CapacityCategory, type WeekSchedule,
} from '@isp/domain';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { taskEvent } from '../services/tasks';
import { dueAtOf } from '../services/projects';
import { activityScope } from '../services/tasks';
import { assertBoardOpen, boardRole, boardsConfig, capacityPolicy, teamsByUser, ymd } from './workBoards';

const Board = z.object({ board: z.enum(BOARD_KEYS) });
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function context(db: DbOrTx, auth: AuthContext, board: BoardKey) {
  assertBoardOpen(auth, board);
  const boards = await boardsConfig(db, auth.tenantId);
  const cfg = boards.find((b) => b.key === board)!;
  const role = await boardRole(db, auth, cfg.teamIds);
  const byUser = await teamsByUser(db, auth.tenantId);
  const members = [...byUser.entries()].filter(([, ts]) => ts.some((t) => cfg.teamIds.includes(t))).map(([u]) => u);
  return { boards, cfg, role, byUser, members };
}
const assertLeads = (role: string) => { if (role === 'colaborador') throw forbidden('Planejar a semana e abrir ou encerrar a Sprint é da liderança ou da gestão deste time.'); };

/** Capacidade líquida de cada pessoa do departamento na semana (null = sem jornada cadastrada). */
export async function peopleCapacity(db: DbOrTx, tenantId: string, board: BoardKey, week: string, members: string[], byUser: Map<string, string[]>, boards: { key: BoardKey; teamIds: string[] }[]) {
  if (!members.length) return [];
  const end = addDays(week, 6);
  const [users, schedules, holidays, vacations, absences] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(inArray(s.users.id, members), eq(s.users.active, true))),
    db.select().from(s.workSchedules).where(and(eq(s.workSchedules.tenantId, tenantId), inArray(s.workSchedules.userId, members), lte(s.workSchedules.validFrom, end))).orderBy(desc(s.workSchedules.validFrom), desc(s.workSchedules.createdAt)),
    db.select({ day: s.companyHolidays.day }).from(s.companyHolidays).where(and(eq(s.companyHolidays.tenantId, tenantId), gte(s.companyHolidays.day, week), lte(s.companyHolidays.day, end))),
    db.select({ userId: s.vacations.userId, startDate: s.vacations.startDate, days: s.vacations.days }).from(s.vacations).where(and(eq(s.vacations.tenantId, tenantId), inArray(s.vacations.userId, members), eq(s.vacations.status, 'programada'), lte(s.vacations.startDate, end))),
    db.select().from(s.workAbsences).where(and(eq(s.workAbsences.tenantId, tenantId), inArray(s.workAbsences.userId, members), isNull(s.workAbsences.deletedAt), lte(s.workAbsences.startOn, end), gte(s.workAbsences.endOn, week))),
  ]);
  return users.map((u) => {
    const sc = schedules.find((x) => x.userId === u.id);
    // parte da pessoa neste quadro: a cadastrada, ou dividida igualmente entre os quadros das equipes dela
    const inBoards = boards.filter((b) => b.teamIds.some((t) => (byUser.get(u.id) ?? []).includes(t))).length || 1;
    const allocationBp = sc?.allocations?.[board] ?? Math.round(10_000 / inBoards);
    const cap = weekCapacity({ weekStart: week, schedule: (sc?.minutesByWeekday ?? null) as WeekSchedule | null, holidays: holidays.map((h) => h.day), vacations: vacations.filter((v) => v.userId === u.id), absences: absences.filter((a) => a.userId === u.id), allocationBp });
    return { userId: u.id, name: u.name, allocationBp, netMinutes: cap?.netMinutes ?? null, grossMinutes: cap?.grossMinutes ?? null, unavailableMinutes: cap?.unavailableMinutes ?? null, days: cap?.days ?? [] };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Tarefas abertas do quadro (candidatas ao planejamento), com o contexto comercial que existir no CRM. */
async function boardOpenTasks(db: DbOrTx, auth: AuthContext, board: BoardKey, ctx: Awaited<ReturnType<typeof context>>, extra?: SQL) {
  const owner = alias(s.users, 'owner');
  const oppOwner = alias(s.users, 'opp_owner');
  const rows = await db.select({
    a: s.activities, ownerName: owner.name, oppCode: s.opportunities.code, oppTitle: s.opportunities.title, oppValue: s.opportunities.valueCents, oppStage: s.opportunities.stage, oppOwnerName: oppOwner.name, contactName: s.contacts.name,
    blockedBy: sql<number>`(select count(*)::int from activity_dependencies d join activities x on x.id = d.depends_on_id where d.activity_id = ${s.activities.id} and x.status not in ('concluida','cancelada') and x.deleted_at is null)`,
  }).from(s.activities)
    .leftJoin(owner, eq(owner.id, s.activities.ownerId))
    .leftJoin(s.opportunities, eq(s.opportunities.id, s.activities.opportunityId))
    .leftJoin(oppOwner, eq(oppOwner.id, s.opportunities.ownerId))
    .leftJoin(s.contacts, eq(s.contacts.id, s.activities.contactId))
    .where(and(activityScope(auth), isNull(s.activities.parentId), sql`${s.activities.status} not in ('concluida','cancelada')`,
      or(eq(s.activities.boardKey, board), and(isNull(s.activities.boardKey), ctx.members.length ? inArray(s.activities.ownerId, ctx.members) : sql`false`))!, extra))
    .orderBy(sql`${s.activities.planOrder} asc nulls last`, sql`${s.activities.dueAt} asc nulls last`).limit(800);
  return rows.filter((r) => boardOfTask({ boardKey: r.a.boardKey, ownerTeamIds: ctx.byUser.get(r.a.ownerId) ?? [] }, ctx.boards) === board);
}
const committed = (a: { remainingMinutes: number | null; estimateMinutes: number | null }) => a.remainingMinutes ?? a.estimateMinutes ?? 0;

async function sprintOf(db: DbOrTx, tenantId: string, board: BoardKey, week: string) {
  const [sp] = await db.select().from(s.workSprints).where(and(eq(s.workSprints.tenantId, tenantId), eq(s.workSprints.boardKey, board), eq(s.workSprints.weekStart, week), sql`${s.workSprints.status} <> 'cancelada'`)).limit(1);
  return sp ?? null;
}
async function loadSprint(db: DbOrTx, auth: AuthContext, board: BoardKey, id: string) {
  const [sp] = await db.select().from(s.workSprints).where(and(eq(s.workSprints.id, id), eq(s.workSprints.tenantId, auth.tenantId), eq(s.workSprints.boardKey, board))).limit(1);
  if (!sp) throw notFound('Sprint não encontrada.');
  return sp;
}
const sprintEvent = (db: DbOrTx, auth: AuthContext, sprintId: string, type: string, payload: Record<string, unknown> = {}, reason?: string | null) =>
  db.insert(s.workSprintEvents).values({ tenantId: auth.tenantId, sprintId, type, payload, reason: reason ?? null, actorId: auth.userId });

/** Distribuição do esforço por categoria e desvio (pontos percentuais) em relação à diretriz. */
function distribution(items: { category: CapacityCategory | null; minutes: number }[], policy: Record<CapacityCategory, number>) {
  const total = items.reduce((t, i) => t + i.minutes, 0);
  const by = Object.fromEntries(CAPACITY_CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).reduce((t, i) => t + i.minutes, 0)])) as Record<CapacityCategory, number>;
  const deviationPp = total ? Math.max(...CAPACITY_CATEGORIES.map((c) => Math.abs((by[c] / total) * 100 - policy[c] / 100))) : 0;
  return { total, by, deviationPp: Math.round(deviationPp * 10) / 10 };
}
/** desvio da diretriz acima disto exige justificativa ao abrir a Sprint */
const DEVIATION_TOLERANCE_PP = 10;

export const workSprintRoutes = [
  // ------------------------------------------------------------------ Planejar Semana
  defineRoute({
    method: 'GET', url: '/quadros/:board/planejamento', summary: 'Planejar Semana: tarefas pendentes do departamento, capacidade de cada pessoa, distribuição 70/20/10 e alertas comerciais', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board, query: z.object({ week: isoDay.optional() }),
    handler: async ({ app, auth, params, query }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      const today = ymd(new Date(), auth.timezone);
      const week = weekStart(query.week ?? today);
      const [policy, sprint, people, rows] = await Promise.all([capacityPolicy(app.db, auth.tenantId, board), sprintOf(app.db, auth.tenantId, board, week), peopleCapacity(app.db, auth.tenantId, board, week, ctx.members, ctx.byUser, ctx.boards), boardOpenTasks(app.db, auth, board, ctx)]);
      const weekEnd = addDays(week, 6);
      const tasks = rows.map((r) => {
        const a = r.a;
        const category = taskCategory(a);
        const dueDay = a.dueAt ? ymd(a.dueAt, auth.timezone) : null;
        const alerts: string[] = [];
        if (dueDay && dueDay < today) alerts.push('vencida');
        else if (dueDay && dueDay < week) alerts.push('prazo antes da semana');
        if (a.status === 'aguardando') alerts.push('bloqueada');
        if (r.blockedBy) alerts.push(`depende de ${r.blockedBy} tarefa(s) em aberto`);
        if (a.opportunityId && !a.estimateMinutes) alerts.push('comercial sem estimativa');
        return {
          id: a.id, ref: `T-${a.id.slice(0, 6).toUpperCase()}`, title: a.title, status: a.status, ownerId: a.ownerId, ownerName: r.ownerName, priority: a.priority, dueDay, agreedDueAt: a.agreedDueAt,
          category, estimateMinutes: a.estimateMinutes, remainingMinutes: a.remainingMinutes, origin: taskOrigin(a), selected: a.plannedWeek === week, planOrder: a.planOrder, protectedCommitment: a.protectedCommitment,
          dueThisWeek: !!dueDay && dueDay >= week && dueDay <= weekEnd, issues: commitIssues({ ownerId: a.ownerId, category, estimateMinutes: a.estimateMinutes }), alerts,
          // contexto comercial: só o que existe no CRM (nada de probabilidade ou previsão inventada)
          opportunity: a.opportunityId ? { id: a.opportunityId, label: `OP-${r.oppCode}`, client: r.contactName ?? r.oppTitle, valueCents: r.oppValue, stage: r.oppStage, ownerName: r.oppOwnerName } : null,
        };
      });
      const selected = tasks.filter((t) => t.selected);
      const totalNet = people.reduce((t, p) => t + (p.netMinutes ?? 0), 0);
      const byPerson = people.map((p) => { const c = selected.filter((t) => t.ownerId === p.userId).reduce((t, x) => t + committed(x), 0); return { ...p, committedMinutes: c, overload: p.netMinutes === null ? c > 0 : c > p.netMinutes }; });
      const dist = distribution(selected.map((t) => ({ category: t.category, minutes: committed(t) })), policy);
      return {
        week, today, role: ctx.role, board: { key: board, label: BOARD_LABELS[board] }, policy, sprint: sprint && { id: sprint.id, status: sprint.status, objective: sprint.objective, openedAt: sprint.openedAt },
        capacity: { totalNetMinutes: totalNet, selectedMinutes: dist.total, availableMinutes: totalNet - dist.total, targets: categoryTargets(totalNet, policy), distribution: dist.by, deviationPp: dist.deviationPp, tolerancePp: DEVIATION_TOLERANCE_PP, people: byPerson, withoutSchedule: byPerson.filter((p) => p.netMinutes === null).map((p) => p.name) },
        tasks,
      };
    },
  }),

  defineRoute({
    method: 'PUT', url: '/quadros/:board/planejamento', summary: 'Salva o planejamento da semana como rascunho: tarefas escolhidas, ordem, responsáveis, esforço e prazos (liderança/gestão do time)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board,
    body: z.object({
      week: isoDay, objective: z.string().trim().max(1000).nullable().optional(),
      items: z.array(z.object({ activityId: z.string().uuid(), ownerId: z.string().uuid(), estimateMinutes: z.number().int().min(0).max(60 * 400).nullable(), dueOn: isoDay.nullable().optional(), position: z.number().int().min(0).max(10_000) })).max(400),
    }),
    handler: async ({ app, auth, params, body }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      assertLeads(ctx.role);
      const week = weekStart(body.week);
      return app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sprint:${auth.tenantId}:${board}:${week}`}))`);
        let sp = await sprintOf(tx, auth.tenantId, board, week);
        if (sp && sp.status !== 'planejamento') throw unprocessable('A Sprint desta semana já foi aberta: mudanças no compromisso entram pelo fura-fila ou pela retirada com motivo.');
        if (!sp) sp = (await tx.insert(s.workSprints).values({ tenantId: auth.tenantId, boardKey: board, weekStart: week, objective: body.objective ?? null, createdBy: auth.userId }).returning())[0]!;
        else if (body.objective !== undefined) await tx.update(s.workSprints).set({ objective: body.objective }).where(eq(s.workSprints.id, sp.id));
        const rows = await boardOpenTasks(tx, auth, board, ctx);
        const ids = new Set(rows.map((r) => r.a.id));
        for (const it of body.items) {
          if (!ids.has(it.activityId)) throw unprocessable('Tarefa fora deste quadro ou já concluída.', [{ path: 'items', message: it.activityId }]);
          if (!ctx.members.includes(it.ownerId)) throw unprocessable('O responsável precisa ser de uma equipe deste quadro.', [{ path: 'items.ownerId', message: it.ownerId }]);
        }
        const chosen = new Map(body.items.map((i) => [i.activityId, i]));
        for (const r of rows) {
          const it = chosen.get(r.a.id);
          if (it) {
            const changes: Record<string, unknown> = {};
            if (r.a.plannedWeek !== week) changes.semana = week;
            if (it.ownerId !== r.a.ownerId) changes.responsavel = { from: r.a.ownerId, to: it.ownerId };
            if (it.estimateMinutes !== r.a.estimateMinutes) changes.esforco = { from: r.a.estimateMinutes, to: it.estimateMinutes };
            const curDue = r.a.dueAt ? ymd(r.a.dueAt, auth.timezone) : null;
            if (it.dueOn !== undefined && it.dueOn !== curDue) changes.prazo = { from: curDue, to: it.dueOn };
            await tx.update(s.activities).set({
              plannedWeek: week, planOrder: it.position, ownerId: it.ownerId, estimateMinutes: it.estimateMinutes,
              dueAt: it.dueOn === undefined || it.dueOn === curDue ? undefined : (dueAtOf(auth, it.dueOn) as unknown as Date),
              updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1`,
            }).where(eq(s.activities.id, r.a.id));
            if (Object.keys(changes).length) await taskEvent(tx, auth, r.a.id, 'planejamento', { semana: week, ...changes });
          } else if (r.a.plannedWeek === week) {
            await tx.update(s.activities).set({ plannedWeek: null, planOrder: null, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, r.a.id));
            await taskEvent(tx, auth, r.a.id, 'planejamento', { retiradaDaSemana: week });
          }
        }
        return { ok: true, sprintId: sp!.id, status: sp!.status };
      });
    },
  }),

  // ------------------------------------------------------------------ Sprint: abrir, retirar, encerrar, cancelar
  defineRoute({
    method: 'POST', url: '/quadros/:board/sprints/:id/abrir', summary: 'Abre a Sprint: confere responsável, categoria e esforço de cada tarefa e a capacidade; grava a fotografia imutável do plano original', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ id: z.string().uuid() }), body: z.object({ justification: z.string().trim().max(1000).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      assertLeads(ctx.role);
      const out = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sprint-open:${params.id}`}))`);
        const sp = await loadSprint(tx, auth, board, params.id);
        if (sp.status !== 'planejamento') throw unprocessable('Esta Sprint já foi aberta ou encerrada.');
        const [open] = await tx.select({ id: s.workSprints.id }).from(s.workSprints).where(and(eq(s.workSprints.tenantId, auth.tenantId), eq(s.workSprints.boardKey, board), eq(s.workSprints.status, 'andamento'))).limit(1);
        if (open) throw unprocessable('Já existe uma Sprint em andamento neste quadro: encerre a anterior antes de abrir a próxima.');
        const rows = (await boardOpenTasks(tx, auth, board, ctx)).filter((r) => r.a.plannedWeek === sp.weekStart);
        if (!rows.length) throw unprocessable('Nenhuma tarefa planejada para a semana.');
        const issues = rows.map((r) => ({ id: r.a.id, title: r.a.title, issues: commitIssues({ ownerId: r.a.ownerId, category: taskCategory(r.a), estimateMinutes: r.a.estimateMinutes }) })).filter((x) => x.issues.length);
        if (issues.length) throw unprocessable(`Antes de comprometer, complete: ${issues.slice(0, 5).map((x) => `“${x.title}” (${x.issues.join(', ')})`).join('; ')}${issues.length > 5 ? '…' : ''}.`, issues.map((x) => ({ path: 'tasks', message: x.id })));
        const policy = await capacityPolicy(tx, auth.tenantId, board);
        const people = await peopleCapacity(tx, auth.tenantId, board, sp.weekStart, ctx.members, ctx.byUser, ctx.boards);
        const items = rows.map((r) => ({ id: r.a.id, title: r.a.title, ownerId: r.a.ownerId, ownerName: r.ownerName, minutes: committed(r.a), category: taskCategory(r.a)!, dueAt: r.a.dueAt, opportunityId: r.a.opportunityId, protected: r.a.protectedCommitment }));
        const overload = people.map((p) => ({ name: p.name, net: p.netMinutes, committed: items.filter((i) => i.ownerId === p.userId).reduce((t, i) => t + i.minutes, 0) })).filter((p) => p.net === null ? p.committed > 0 : p.committed > p.net);
        const dist = distribution(items, policy);
        const needsJustification = overload.length > 0 || dist.deviationPp > DEVIATION_TOLERANCE_PP;
        if (needsJustification && (body.justification ?? '').length < 10)
          throw unprocessable(`Justifique para abrir: ${[overload.length ? `sobrecarga de ${overload.map((o) => o.name).join(', ')}` : '', dist.deviationPp > DEVIATION_TOLERANCE_PP ? `distribuição ${dist.deviationPp} p.p. fora da diretriz` : ''].filter(Boolean).join(' e ')}.`, [{ path: 'justification', message: 'Obrigatório' }]);
        const snapshot = { items, people: people.map((p) => ({ userId: p.userId, name: p.name, netMinutes: p.netMinutes, allocationBp: p.allocationBp })), totalNetMinutes: people.reduce((t, p) => t + (p.netMinutes ?? 0), 0), distribution: dist.by, deviationPp: dist.deviationPp, overload, justification: body.justification ?? null, policyVersion: policy.version };
        await tx.update(s.workSprints).set({ status: 'andamento', policy: { comercial: policy.comercial, interno: policy.interno, hipotese: policy.hipotese, version: policy.version }, snapshot, openedAt: new Date(), openedBy: auth.userId }).where(eq(s.workSprints.id, sp.id));
        await tx.insert(s.workSprintItems).values(items.map((i, n) => ({ tenantId: auth.tenantId, sprintId: sp.id, activityId: i.id, entry: 'plano', committedMinutes: i.minutes, category: i.category, ownerId: i.ownerId, dueAt: i.dueAt, position: n, addedBy: auth.userId })));
        await sprintEvent(tx, auth, sp.id, 'aberta', { tasks: items.length, minutes: dist.total, deviationPp: dist.deviationPp, overload: overload.map((o) => o.name) }, body.justification ?? null);
        return { tasks: items.length, minutes: dist.total };
      });
      await audit(app.db, req, { action: 'work_sprint.open', entityType: 'work_sprint', entityId: params.id, metadata: out });
      return { ok: true, ...out };
    },
  }),

  defineRoute({
    method: 'POST', url: '/quadros/:board/sprints/:id/retirar', summary: 'Retira uma tarefa da Sprint aberta (com motivo): volta a ser elegível; o plano original continua registrado', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ id: z.string().uuid() }), body: z.object({ activityId: z.string().uuid(), reason: z.string().trim().min(10, 'Explique o replanejamento').max(1000) }),
    handler: async ({ app, auth, params, body }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      assertLeads(ctx.role);
      return app.db.transaction(async (tx) => {
        const sp = await loadSprint(tx, auth, board, params.id);
        if (sp.status !== 'andamento') throw unprocessable('Só se retira tarefa de Sprint em andamento.');
        const [it] = await tx.update(s.workSprintItems).set({ removedAt: new Date(), removedBy: auth.userId, removedReason: body.reason })
          .where(and(eq(s.workSprintItems.sprintId, sp.id), eq(s.workSprintItems.activityId, body.activityId), isNull(s.workSprintItems.removedAt))).returning();
        if (!it) throw notFound('A tarefa não está na Sprint.');
        await tx.update(s.activities).set({ plannedWeek: null, planOrder: null, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, body.activityId));
        await taskEvent(tx, auth, body.activityId, 'replanejada', { sprint: sp.weekStart, reason: body.reason });
        await sprintEvent(tx, auth, sp.id, 'retirada', { activityId: body.activityId, minutes: it.committedMinutes, category: it.category }, body.reason);
        return { ok: true };
      });
    },
  }),

  defineRoute({
    method: 'POST', url: '/quadros/:board/sprints/:id/encerrar', summary: 'Encerra a Sprint: original × revisado, entregue, não entregue, replanejadas, fura-filas e distribuição final; pendentes voltam ao backlog', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ id: z.string().uuid() }), body: z.object({ learnings: z.string().trim().max(4000).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      assertLeads(ctx.role);
      const closing = await app.db.transaction(async (tx) => {
        const sp = await loadSprint(tx, auth, board, params.id);
        if (sp.status !== 'andamento') throw unprocessable('Só se encerra Sprint em andamento.');
        const items = await tx.select({ i: s.workSprintItems, status: s.activities.status, title: s.activities.title, waitingOn: s.activities.waitingOn }).from(s.workSprintItems).innerJoin(s.activities, eq(s.activities.id, s.workSprintItems.activityId)).where(eq(s.workSprintItems.sprintId, sp.id));
        const snap = (sp.snapshot ?? {}) as { items?: { id: string; minutes: number; category: CapacityCategory }[] };
        const original = snap.items ?? [];
        const done = (id: string) => items.some((x) => x.i.activityId === id && x.status === 'concluida');
        const active = items.filter((x) => !x.i.removedAt);
        const sum = (l: { minutes: number }[]) => l.reduce((t, x) => t + x.minutes, 0);
        const result = {
          original: { tasks: original.length, minutes: sum(original), deliveredMinutes: sum(original.filter((o) => done(o.id))), deliveredTasks: original.filter((o) => done(o.id)).length },
          revised: { tasks: active.length, minutes: active.reduce((t, x) => t + x.i.committedMinutes, 0), deliveredMinutes: active.filter((x) => x.status === 'concluida').reduce((t, x) => t + x.i.committedMinutes, 0), deliveredTasks: active.filter((x) => x.status === 'concluida').length },
          replanned: items.filter((x) => x.i.removedAt).map((x) => ({ activityId: x.i.activityId, title: x.title, minutes: x.i.committedMinutes, category: x.i.category, reason: x.i.removedReason })),
          furaFilas: items.filter((x) => x.i.entry === 'fura_fila').map((x) => ({ activityId: x.i.activityId, title: x.title, minutes: x.i.committedMinutes, category: x.i.category })),
          notDelivered: active.filter((x) => x.status !== 'concluida').map((x) => ({ activityId: x.i.activityId, title: x.title, minutes: x.i.committedMinutes, category: x.i.category })),
          impediments: active.filter((x) => x.status === 'aguardando').map((x) => ({ title: x.title, waitingOn: x.waitingOn })),
          finalDistribution: Object.fromEntries(CAPACITY_CATEGORIES.map((c) => [c, active.filter((x) => x.status === 'concluida' && x.i.category === c).reduce((t, x) => t + x.i.committedMinutes, 0)])),
          learnings: body.learnings ?? null,
        };
        // pendentes voltam a ser elegíveis (com vínculos, situação e histórico); nada vai sozinho para a próxima Sprint
        const pending = result.notDelivered.map((x) => x.activityId);
        if (pending.length) {
          await tx.update(s.activities).set({ plannedWeek: null, planOrder: null, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(inArray(s.activities.id, pending));
          for (const id of pending) await taskEvent(tx, auth, id, 'planejamento', { naoEntregueNaSprint: sp.weekStart });
        }
        await tx.update(s.workSprints).set({ status: 'encerrada', closing: result, closedAt: new Date(), closedBy: auth.userId }).where(eq(s.workSprints.id, sp.id));
        await sprintEvent(tx, auth, sp.id, 'encerrada', { original: result.original, revised: result.revised, furaFilas: result.furaFilas.length, replanned: result.replanned.length }, body.learnings ?? null);
        return result;
      });
      await audit(app.db, req, { action: 'work_sprint.close', entityType: 'work_sprint', entityId: params.id, metadata: { original: closing.original, revised: closing.revised } });
      return { ok: true, closing };
    },
  }),

  defineRoute({
    method: 'POST', url: '/quadros/:board/sprints/:id/cancelar', summary: 'Cancela a Sprint ainda em planejamento (as tarefas voltam a ser elegíveis)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ id: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      assertLeads(ctx.role);
      return app.db.transaction(async (tx) => {
        const sp = await loadSprint(tx, auth, board, params.id);
        if (sp.status !== 'planejamento') throw unprocessable('Só se cancela Sprint em planejamento. Sprint aberta é encerrada, com o comparativo.');
        const rows = (await boardOpenTasks(tx, auth, board, ctx)).filter((r) => r.a.plannedWeek === sp.weekStart);
        if (rows.length) await tx.update(s.activities).set({ plannedWeek: null, planOrder: null }).where(inArray(s.activities.id, rows.map((r) => r.a.id)));
        await tx.update(s.workSprints).set({ status: 'cancelada' }).where(eq(s.workSprints.id, sp.id));
        await sprintEvent(tx, auth, sp.id, 'cancelada', { tasks: rows.length });
        return { ok: true };
      });
    },
  }),

  defineRoute({
    method: 'GET', url: '/quadros/:board/sprints', summary: 'Sprints do departamento (atual e anteriores), com o resultado de cada uma', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board,
    handler: async ({ app, auth, params }) => {
      assertBoardOpen(auth, params.board as BoardKey);
      const rows = await app.db.select({ id: s.workSprints.id, weekStart: s.workSprints.weekStart, status: s.workSprints.status, objective: s.workSprints.objective, openedAt: s.workSprints.openedAt, closedAt: s.workSprints.closedAt, closing: s.workSprints.closing, snapshot: s.workSprints.snapshot })
        .from(s.workSprints).where(and(eq(s.workSprints.tenantId, auth.tenantId), eq(s.workSprints.boardKey, params.board))).orderBy(desc(s.workSprints.weekStart)).limit(60);
      return { items: rows.map((r) => ({ ...r, snapshot: undefined, planned: (r.snapshot as { items?: unknown[] } | null)?.items?.length ?? null })) };
    },
  }),

  defineRoute({
    method: 'GET', url: '/quadros/:board/sprints/:id', summary: 'Sprint: plano original (fotografia), tarefas atuais, revisões e o fechamento', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ id: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      assertBoardOpen(auth, params.board as BoardKey);
      const sp = await loadSprint(app.db, auth, params.board as BoardKey, params.id);
      const owner = alias(s.users, 'owner');
      const [items, events] = await Promise.all([
        app.db.select({ activityId: s.workSprintItems.activityId, entry: s.workSprintItems.entry, minutes: s.workSprintItems.committedMinutes, category: s.workSprintItems.category, ownerName: owner.name, removedAt: s.workSprintItems.removedAt, removedReason: s.workSprintItems.removedReason, title: s.activities.title, status: s.activities.status })
          .from(s.workSprintItems).innerJoin(s.activities, eq(s.activities.id, s.workSprintItems.activityId)).leftJoin(owner, eq(owner.id, s.workSprintItems.ownerId)).where(eq(s.workSprintItems.sprintId, sp.id)).orderBy(asc(s.workSprintItems.position)),
        app.db.select({ type: s.workSprintEvents.type, payload: s.workSprintEvents.payload, reason: s.workSprintEvents.reason, at: s.workSprintEvents.createdAt, by: s.users.name }).from(s.workSprintEvents).leftJoin(s.users, eq(s.users.id, s.workSprintEvents.actorId)).where(eq(s.workSprintEvents.sprintId, sp.id)).orderBy(asc(s.workSprintEvents.createdAt)),
      ]);
      return { ...sp, items, events };
    },
  }),

  // ------------------------------------------------------------------ capacidade: jornada, feriados, ausências
  defineRoute({
    method: 'GET', url: '/quadros/:board/capacidade', summary: 'Pessoas do departamento com a jornada vigente, ausências e a capacidade da semana', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board, query: z.object({ week: isoDay.optional() }),
    handler: async ({ app, auth, params, query }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      const week = weekStart(query.week ?? ymd(new Date(), auth.timezone));
      const people = await peopleCapacity(app.db, auth.tenantId, board, week, ctx.members, ctx.byUser, ctx.boards);
      const schedules = ctx.members.length ? await app.db.select().from(s.workSchedules).where(and(eq(s.workSchedules.tenantId, auth.tenantId), inArray(s.workSchedules.userId, ctx.members))).orderBy(desc(s.workSchedules.validFrom), desc(s.workSchedules.createdAt)) : [];
      const absences = ctx.members.length ? await app.db.select({ id: s.workAbsences.id, userId: s.workAbsences.userId, kind: s.workAbsences.kind, startOn: s.workAbsences.startOn, endOn: s.workAbsences.endOn, minutesPerDay: s.workAbsences.minutesPerDay, note: s.workAbsences.note })
        .from(s.workAbsences).where(and(eq(s.workAbsences.tenantId, auth.tenantId), inArray(s.workAbsences.userId, ctx.members), isNull(s.workAbsences.deletedAt), gte(s.workAbsences.endOn, addDays(week, -60)))).orderBy(desc(s.workAbsences.startOn)) : [];
      const holidays = await app.db.select({ id: s.companyHolidays.id, day: s.companyHolidays.day, name: s.companyHolidays.name }).from(s.companyHolidays).where(and(eq(s.companyHolidays.tenantId, auth.tenantId), gte(s.companyHolidays.day, addDays(week, -30)))).orderBy(asc(s.companyHolidays.day));
      return { week, role: ctx.role, people: people.map((p) => ({ ...p, schedule: schedules.find((x) => x.userId === p.userId) ?? null })), absences, holidays };
    },
  }),

  defineRoute({
    method: 'PUT', url: '/quadros/:board/capacidade/jornada/:userId', summary: 'Jornada da pessoa (minutos por dia da semana) e a parte dela em cada departamento, a partir de uma data (gestão do time)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ userId: z.string().uuid() }),
    body: z.object({ validFrom: isoDay, minutesByWeekday: z.record(z.enum(['1', '2', '3', '4', '5', '6', '7']), z.number().int().min(0).max(24 * 60)), allocations: z.record(z.enum(BOARD_KEYS), z.number().int().min(0).max(10_000)).default({}) }),
    handler: async ({ app, auth, params, body, req }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      if (ctx.role !== 'gestao' && !auth.profiles.includes('administrador')) throw forbidden('A jornada é cadastrada pela gestão do time ou pelo administrador.');
      if (!ctx.members.includes(params.userId)) throw unprocessable('Pessoa fora das equipes deste quadro.');
      const total = Object.values(body.allocations).reduce((t, v) => t + v, 0);
      if (total > 10_000) throw unprocessable('A soma das partes nos departamentos passa de 100%.');
      await app.db.insert(s.workSchedules).values({ tenantId: auth.tenantId, userId: params.userId, validFrom: body.validFrom, minutesByWeekday: body.minutesByWeekday, allocations: body.allocations, createdBy: auth.userId });
      await audit(app.db, req, { action: 'work_schedule.set', entityType: 'user', entityId: params.userId, metadata: body });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST', url: '/quadros/:board/capacidade/ausencias', summary: 'Ausência, afastamento, compromisso fixo ou rotina fora das tarefas (liderança ou gestão do time)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board,
    body: z.object({ userId: z.string().uuid(), kind: z.enum(ABSENCE_KINDS), startOn: isoDay, endOn: isoDay, minutesPerDay: z.number().int().min(1).max(24 * 60).nullable().default(null), note: z.string().trim().max(300).nullable().optional() }).refine((b) => b.endOn >= b.startOn, 'O fim é antes do início.'),
    handler: async ({ app, auth, params, body, reply }) => {
      const ctx = await context(app.db, auth, params.board as BoardKey);
      assertLeads(ctx.role);
      if (!ctx.members.includes(body.userId)) throw unprocessable('Pessoa fora das equipes deste quadro.');
      const [r] = await app.db.insert(s.workAbsences).values({ tenantId: auth.tenantId, ...body, note: body.note ?? null, createdBy: auth.userId }).returning({ id: s.workAbsences.id });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/quadros/:board/capacidade/ausencias/:id', summary: 'Retira uma ausência (fica marcada, não é apagada)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ id: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const ctx = await context(app.db, auth, params.board as BoardKey);
      assertLeads(ctx.role);
      const r = await app.db.update(s.workAbsences).set({ deletedAt: new Date() }).where(and(eq(s.workAbsences.id, params.id), eq(s.workAbsences.tenantId, auth.tenantId), isNull(s.workAbsences.deletedAt))).returning({ id: s.workAbsences.id });
      if (!r.length) throw notFound('Ausência não encontrada.');
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST', url: '/quadros/feriados', summary: 'Feriado da empresa (sai da capacidade de todos os departamentos)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    body: z.object({ day: isoDay, name: z.string().trim().min(2).max(120) }),
    handler: async ({ app, auth, body, reply }) => {
      if (!auth.profiles.some((p) => ['administrador', 'diretoria', 'gerencia'].includes(p))) throw forbidden('Feriados são cadastrados pela gestão ou pelo administrador.');
      const [r] = await app.db.insert(s.companyHolidays).values({ tenantId: auth.tenantId, day: body.day, name: body.name, createdBy: auth.userId }).onConflictDoUpdate({ target: [s.companyHolidays.tenantId, s.companyHolidays.day], set: { name: body.name } }).returning({ id: s.companyHolidays.id });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/quadros/feriados/:id', summary: 'Retira um feriado', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: z.object({ id: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      if (!auth.profiles.some((p) => ['administrador', 'diretoria', 'gerencia'].includes(p))) throw forbidden('Feriados são cadastrados pela gestão ou pelo administrador.');
      await app.db.delete(s.companyHolidays).where(and(eq(s.companyHolidays.id, params.id), eq(s.companyHolidays.tenantId, auth.tenantId)));
      return { ok: true };
    },
  }),
];
