import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { atLeast, projectProgress, type ProjectStatus } from '@isp/domain';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { level } from './scope';

/**
 * Visibilidade de projetos (módulo `projetos`):
 * Total vê todos; Equipe vê os do seu time (responsável ou membro do time) e onde participa;
 * Próprio vê onde é responsável ou membro.
 */
export function projectScope(auth: AuthContext): SQL {
  const l = level(auth, 'projetos');
  const base = and(eq(s.projects.tenantId, auth.tenantId), isNull(s.projects.deletedAt))!;
  if (l === 'nenhum') return sql`false`;
  if (l === 'total') return base;
  const member = sql`exists (select 1 from project_members pm where pm.project_id = ${s.projects.id} and pm.user_id = ${auth.userId})`;
  const users = l === 'equipe' ? auth.teamMemberIds : [auth.userId];
  const teamMember = l === 'equipe' && auth.teamMemberIds.length ? sql`exists (select 1 from project_members pm where pm.project_id = ${s.projects.id} and pm.user_id in ${auth.teamMemberIds})` : sql`false`;
  return and(base, or(inArray(s.projects.ownerId, users.length ? users : [auth.userId]), member, teamMember))!;
}

export async function loadProject(db: DbOrTx, auth: AuthContext, id: string) {
  const [p] = await db.select().from(s.projects).where(and(eq(s.projects.id, id), projectScope(auth))).limit(1);
  if (!p) throw notFound('Projeto não encontrado.');
  const members = await db.select({ userId: s.projectMembers.userId, role: s.projectMembers.role }).from(s.projectMembers).where(eq(s.projectMembers.projectId, id));
  const mine = members.find((m) => m.userId === auth.userId)?.role;
  const l = level(auth, 'projetos');
  const supervises = l === 'total' || (l === 'equipe' && auth.teamMemberIds.includes(p.ownerId));
  const manage = p.ownerId === auth.userId || mine === 'gerente' || supervises;
  const work = manage || mine === 'membro';
  return { p, members, can: { manage, work, view: true } };
}

export function assertCan(ok: boolean, msg = 'Você só pode consultar este projeto.') {
  if (!ok) throw forbidden(msg);
}

/** Valida vínculos opcionais (sempre da mesma empresa). */
export async function assertProjectLinks(db: DbOrTx, auth: AuthContext, l: { contactId?: string | null; opportunityId?: string | null; contractId?: string | null; arpId?: string | null }) {
  const checks = [
    ['contactId', s.contacts, l.contactId],
    ['opportunityId', s.opportunities, l.opportunityId],
    ['contractId', s.contracts, l.contractId],
    ['arpId', s.arps, l.arpId],
  ] as const;
  for (const [path, t, v] of checks) {
    if (!v) continue;
    const r = await db.select({ id: t.id }).from(t).where(and(eq(t.id, v), eq(t.tenantId, auth.tenantId))).limit(1);
    if (!r.length) throw unprocessable('Vínculo inválido.', [{ path, message: 'Registro não encontrado nesta empresa' }]);
  }
}

export async function projectEvent(db: DbOrTx, auth: AuthContext, projectId: string, type: string, summary: string, payload: Record<string, unknown> = {}) {
  await db.insert(s.projectEvents).values({ tenantId: auth.tenantId, projectId, type, summary, actorId: auth.userId, payload });
}

/** Data local (fuso da empresa) → instante do prazo (18h locais). */
export const dueAtOf = (auth: AuthContext, iso: string | null | undefined) => (iso ? sql`((${iso}::date + time '18:00') at time zone ${auth.timezone})` : null);
export const dueOnSql = (auth: AuthContext) => sql<string | null>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')`;

export const todayLocal = (auth: AuthContext) => new Intl.DateTimeFormat('en-CA', { timeZone: auth.timezone }).format(new Date());

/** Tarefas de um conjunto de projetos (não excluídas). */
export async function projectTasks(db: DbOrTx, auth: AuthContext, projectIds: string[]) {
  if (!projectIds.length) return [];
  return db
    .select({
      id: s.activities.id,
      projectId: s.activities.projectId,
      title: s.activities.title,
      notes: s.activities.notes,
      priority: s.activities.priority,
      ownerId: s.activities.ownerId,
      ownerName: s.users.name,
      stageId: s.activities.projectStageId,
      milestoneId: s.activities.milestoneId,
      startOn: s.activities.startOn,
      dueOn: dueOnSql(auth),
      position: s.activities.position,
      completedAt: s.activities.completedAt,
      rowVersion: s.activities.rowVersion,
    })
    .from(s.activities)
    .innerJoin(s.users, eq(s.users.id, s.activities.ownerId))
    .where(and(eq(s.activities.tenantId, auth.tenantId), inArray(s.activities.projectId, projectIds), isNull(s.activities.deletedAt)))
    .orderBy(asc(s.activities.position), asc(s.activities.createdAt));
}

export async function progressFor(db: DbOrTx, auth: AuthContext, projects: { id: string; status: string; dueOn: string | null }[]) {
  const ids = projects.map((p) => p.id);
  const [tasks, ms] = await Promise.all([
    projectTasks(db, auth, ids),
    ids.length ? db.select().from(s.projectMilestones).where(and(inArray(s.projectMilestones.projectId, ids), isNull(s.projectMilestones.deletedAt))) : Promise.resolve([]),
  ]);
  const today = todayLocal(auth);
  return new Map(
    projects.map((p) => [
      p.id,
      projectProgress(
        { status: p.status as ProjectStatus, dueOn: p.dueOn },
        tasks.filter((t) => t.projectId === p.id).map((t) => ({ done: !!t.completedAt, dueOn: t.dueOn, milestoneId: t.milestoneId })),
        ms.filter((m) => m.projectId === p.id).map((m) => ({ id: m.id, dueOn: m.dueOn, done: !!m.completedAt })),
        today,
      ),
    ]),
  );
}

/** Primeira tarefa concluída tira o projeto de Planejamento (fica no histórico como ação automática). */
export async function autoStartProject(db: DbOrTx, auth: AuthContext, projectId: string) {
  const r = await db.update(s.projects).set({ status: 'em_andamento', updatedAt: new Date(), rowVersion: sql`${s.projects.rowVersion} + 1` }).where(and(eq(s.projects.id, projectId), eq(s.projects.status, 'planejamento'))).returning({ id: s.projects.id });
  if (r.length) await db.insert(s.projectEvents).values({ tenantId: auth.tenantId, projectId, type: 'status', summary: 'Projeto passou para Em andamento (primeira tarefa concluída)', actorId: auth.userId, payload: { automatic: true } });
}

/** Ao concluir/reabrir uma tarefa de projeto por qualquer tela, a etapa acompanha. */
export async function syncTaskStage(db: DbOrTx, taskId: string, completed: boolean, auth?: AuthContext) {
  const [t] = await db.select({ projectId: s.activities.projectId, stageId: s.activities.projectStageId }).from(s.activities).where(eq(s.activities.id, taskId)).limit(1);
  if (!t?.projectId) return;
  if (completed && auth) await autoStartProject(db, auth, t.projectId);
  const stages = await db.select().from(s.projectStages).where(and(eq(s.projectStages.projectId, t.projectId), isNull(s.projectStages.archivedAt))).orderBy(asc(s.projectStages.position));
  const cur = stages.find((x) => x.id === t.stageId);
  if (completed && !cur?.done) {
    const done = stages.find((x) => x.done);
    if (done) await db.update(s.activities).set({ projectStageId: done.id }).where(eq(s.activities.id, taskId));
  }
  if (!completed && cur?.done) {
    const open = stages.find((x) => !x.done);
    if (open) await db.update(s.activities).set({ projectStageId: open.id }).where(eq(s.activities.id, taskId));
  }
}

export const canSeeProjects = (auth: AuthContext) => atLeast(level(auth, 'projetos'), 'proprio');
