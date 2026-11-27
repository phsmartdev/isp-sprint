/**
 * Quadro de Tarefas — Etapa 7: o projeto visto pelos departamentos executores (27/11/2026).
 * As atividades do projeto são as mesmas tarefas que aparecem no quadro de cada departamento (sem cópia). Aqui o
 * responsável acompanha o andamento por departamento — planejadas ou não numa Sprint —, as dependências entre times e o
 * avanço pelos entregáveis alcançados (marcos concluídos/homologados), não pela contagem de tarefas.
 */
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BOARD_LABELS, DEPENDENCY_STATE_LABELS, boardOfTask, dependencyAtRisk, dependencyState, frontSummary, weekStart, type BoardKey } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import * as s from '../db/schema';
import { loadProject, todayLocal } from '../services/projects';
import { boardsConfig, teamsByUser, ymd } from './workBoards';

export const workProjectRoutes = [
  defineRoute({
    method: 'GET', url: '/projects/:id/departamentos', summary: 'Projeto por departamento executor: tarefas (na Sprint, planejadas ou no backlog do time), dependências entre times e avanço pelos entregáveis', tag: 'Projetos', module: 'projetos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { p: project } = await loadProject(app.db, auth, params.id);
      const today = todayLocal(auth);
      const week = weekStart(today);
      const owner = alias(s.users, 'owner');
      const [tasks, boards, byUser, milestones] = await Promise.all([
        app.db.select({ id: s.activities.id, title: s.activities.title, status: s.activities.status, ownerId: s.activities.ownerId, ownerName: owner.name, dueAt: s.activities.dueAt, plannedWeek: s.activities.plannedWeek, boardKey: s.activities.boardKey, milestoneId: s.activities.milestoneId, completedAt: s.activities.completedAt })
          .from(s.activities).innerJoin(owner, eq(owner.id, s.activities.ownerId))
          .where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.projectId, params.id), isNull(s.activities.parentId), isNull(s.activities.deletedAt), ne(s.activities.status, 'cancelada')))
          .orderBy(sql`${s.activities.dueAt} asc nulls last`),
        boardsConfig(app.db, auth.tenantId), teamsByUser(app.db, auth.tenantId),
        app.db.select().from(s.projectMilestones).where(and(eq(s.projectMilestones.projectId, params.id), isNull(s.projectMilestones.deletedAt))).orderBy(asc(s.projectMilestones.position)),
      ]);
      const ids = tasks.map((t) => t.id);
      const inSprint = new Set(ids.length ? (await app.db.select({ id: s.workSprintItems.activityId }).from(s.workSprintItems).innerJoin(s.workSprints, eq(s.workSprints.id, s.workSprintItems.sprintId))
        .where(and(inArray(s.workSprintItems.activityId, ids), isNull(s.workSprintItems.removedAt), eq(s.workSprints.status, 'andamento')))).map((x) => x.id) : []);
      const boardOf = (t: { boardKey: string | null; ownerId: string }) => boardOfTask({ boardKey: t.boardKey, ownerTeamIds: byUser.get(t.ownerId) ?? [] }, boards);
      const shaped = tasks.map((t) => {
        const dueDay = t.dueAt ? ymd(t.dueAt, auth.timezone) : null;
        const done = t.status === 'concluida';
        const board = boardOf(t);
        return {
          id: t.id, ref: `T-${t.id.slice(0, 6).toUpperCase()}`, title: t.title, status: t.status, ownerName: t.ownerName, dueDay, board, done,
          overdue: !done && !!dueDay && dueDay < today, blocked: t.status === 'aguardando',
          // situação no planejamento do departamento: o responsável do projeto acompanha mesmo fora da Sprint
          planning: done ? 'concluida' : inSprint.has(t.id) ? 'na_sprint' : t.plannedWeek && t.plannedWeek >= week ? 'planejada' : 'backlog',
          plannedWeek: t.plannedWeek,
        };
      });
      const departments = [...new Set(shaped.map((t) => t.board ?? 'sem'))].map((key) => {
        const list = shaped.filter((t) => (t.board ?? 'sem') === key);
        return {
          key, label: key === 'sem' ? 'Sem departamento (responsável fora das equipes dos quadros)' : BOARD_LABELS[key as BoardKey],
          total: list.length, done: list.filter((t) => t.done).length, overdue: list.filter((t) => t.overdue).length, blocked: list.filter((t) => t.blocked).length,
          inSprint: list.filter((t) => t.planning === 'na_sprint').length, planned: list.filter((t) => t.planning === 'planejada').length, backlog: list.filter((t) => t.planning === 'backlog').length,
          tasks: list,
        };
      }).sort((a, b) => (a.key === 'sem' ? 1 : b.key === 'sem' ? -1 : a.label.localeCompare(b.label, 'pt-BR')));

      // dependências que envolvem atividades do projeto e cruzam departamentos
      const edges = ids.length ? await app.db.select({ dep: s.activityDependencies.activityId, pred: s.activityDependencies.dependsOnId }).from(s.activityDependencies)
        .where(or(inArray(s.activityDependencies.activityId, ids), inArray(s.activityDependencies.dependsOnId, ids))) : [];
      const otherIds = [...new Set(edges.flatMap((e) => [e.dep, e.pred]).filter((x) => !ids.includes(x)))];
      const others = otherIds.length ? await app.db.select({ id: s.activities.id, title: s.activities.title, status: s.activities.status, ownerId: s.activities.ownerId, ownerName: owner.name, dueAt: s.activities.dueAt, boardKey: s.activities.boardKey })
        .from(s.activities).innerJoin(owner, eq(owner.id, s.activities.ownerId)).where(and(inArray(s.activities.id, otherIds), isNull(s.activities.deletedAt))) : [];
      const info = (id: string) => {
        const t = tasks.find((x) => x.id === id) ?? others.find((x) => x.id === id);
        if (!t) return null;
        const board = boardOf(t);
        return { id, title: t.title, status: t.status, ownerName: t.ownerName, dueDay: t.dueAt ? ymd(t.dueAt, auth.timezone) : null, board, boardLabel: board ? BOARD_LABELS[board] : 'Sem departamento', inProject: ids.includes(id) };
      };
      const dependencies = edges.map((e) => {
        const pred = info(e.pred), dep = info(e.dep);
        if (!pred || !dep || pred.board === dep.board) return null;
        const state = dependencyState({ status: pred.status, dueDay: pred.dueDay }, dep.dueDay, today);
        return { predecessor: pred, dependent: dep, state, stateLabel: DEPENDENCY_STATE_LABELS[state], atRisk: dependencyAtRisk(state) };
      }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => Number(b.atRisk) - Number(a.atRisk));

      const summary = frontSummary(
        milestones.map((m) => ({ id: m.id, name: m.name, dueOn: m.dueOn, position: m.position, completedAt: m.completedAt?.toISOString() ?? null, requiresHomologation: m.requiresHomologation, homologatedAt: m.homologatedAt?.toISOString() ?? null })),
        tasks.map((t) => ({ id: t.id, title: t.title, milestoneId: t.milestoneId, done: !!t.completedAt, dueOn: t.dueAt ? ymd(t.dueAt, auth.timezone) : null, ownerName: t.ownerName })),
        [], [], today,
      );
      return {
        project: { id: project.id, name: project.name, objective: project.objective },
        // avanço pelos entregáveis alcançados; a contagem de tarefas fica ao lado, só como referência
        progress: summary.progress, currentMilestone: summary.current, nextAction: summary.nextAction,
        tasks: { total: shaped.length, done: shaped.filter((t) => t.done).length },
        departments, dependencies,
      };
    },
  }),
];
