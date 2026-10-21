/** Tarefas (Etapa 4): visibilidade, permissões e o fluxo de conclusão (dependências, subtarefas, aprovação e recorrência). */
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { completionBlockers, nextOccurrence, type TaskStatus } from '@isp/domain';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { level } from './scope';
import { autoStartProject, dueAtOf, syncTaskStage } from './projects';

/**
 * Quem vê uma atividade/tarefa: o nível do módulo Atividades sobre o responsável (Próprio/Equipe/Total)
 * e, além disso, quem a criou (delegou), participantes, o aprovador e a equipe do projeto.
 */
export function activityScope(auth: AuthContext): SQL {
  const l = level(auth, 'atividades');
  const base = and(eq(s.activities.tenantId, auth.tenantId), isNull(s.activities.deletedAt))!;
  if (l === 'nenhum') return sql`false`;
  if (l === 'total') return base;
  const owners = l === 'equipe' ? (auth.teamMemberIds.length ? auth.teamMemberIds : [auth.userId]) : [auth.userId];
  return and(
    base,
    or(
      inArray(s.activities.ownerId, owners),
      eq(s.activities.createdBy, auth.userId),
      eq(s.activities.approverId, auth.userId),
      sql`${auth.userId}::uuid = any(${s.activities.participants})`,
      sql`(${s.activities.projectId} is not null and exists (select 1 from project_members pm where pm.project_id = ${s.activities.projectId} and pm.user_id = ${auth.userId}))`,
    ),
  )!;
}

export type TaskRow = typeof s.activities.$inferSelect;

export async function loadTask(db: DbOrTx, auth: AuthContext, id: string) {
  const [t] = await db.select().from(s.activities).where(and(eq(s.activities.id, id), activityScope(auth))).limit(1);
  if (!t) throw notFound('Tarefa não encontrada.');
  return { t, can: await taskPermissions(db, auth, t) };
}

export async function taskPermissions(db: DbOrTx, auth: AuthContext, t: TaskRow) {
  const l = level(auth, 'atividades');
  const supervises = l === 'total' || (l === 'equipe' && auth.teamMemberIds.includes(t.ownerId));
  let projectManager = false;
  let projectWorker = false;
  if (t.projectId) {
    const [p] = await db.select({ ownerId: s.projects.ownerId }).from(s.projects).where(eq(s.projects.id, t.projectId)).limit(1);
    const [m] = await db.select({ role: s.projectMembers.role }).from(s.projectMembers).where(and(eq(s.projectMembers.projectId, t.projectId), eq(s.projectMembers.userId, auth.userId))).limit(1);
    projectManager = p?.ownerId === auth.userId || m?.role === 'gerente';
    projectWorker = projectManager || m?.role === 'membro';
  }
  const edit = t.ownerId === auth.userId || t.createdBy === auth.userId || supervises || projectManager || projectWorker;
  return { edit, assign: t.createdBy === auth.userId || supervises || projectManager || t.ownerId === auth.userId, approve: !!t.approverId && t.approverId === auth.userId, comment: true };
}

export async function taskEvent(db: DbOrTx, auth: AuthContext, activityId: string, type: string, payload: Record<string, unknown> = {}) {
  await db.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId, type, actorId: auth.userId, payload });
}

const dueOnOf = async (db: DbOrTx, auth: AuthContext, id: string) => {
  const [r] = await db.select({ d: sql<string | null>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')` }).from(s.activities).where(eq(s.activities.id, id)).limit(1);
  return r?.d ?? null;
};

/** Cria a próxima ocorrência de uma tarefa recorrente (idempotente por série e data). */
async function spawnNext(db: DbOrTx, auth: AuthContext, t: TaskRow) {
  if (!t.recurrence) return null;
  const due = await dueOnOf(db, auth, t.id);
  if (!due) return null;
  const next = nextOccurrence(t.recurrence, due);
  if (!next) return null;
  const series = t.seriesId ?? t.id;
  if (!t.seriesId) await db.update(s.activities).set({ seriesId: series, recurrenceKey: t.recurrenceKey ?? `${series}:${due}` }).where(eq(s.activities.id, t.id));
  const shift = Math.round((Date.parse(`${next}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000);
  const startOn = t.startOn ? new Date(Date.parse(`${t.startOn}T12:00:00Z`) + shift * 86_400_000).toISOString().slice(0, 10) : null;
  const [n] = await db
    .insert(s.activities)
    .values({
      tenantId: t.tenantId, type: t.type, title: t.title, notes: t.notes, priority: t.priority, ownerId: t.ownerId, dueAt: dueAtOf(auth, next) as unknown as Date, startOn,
      opportunityId: t.opportunityId, leadId: t.leadId, contactId: t.contactId, contractId: t.contractId, arpId: t.arpId, projectId: t.projectId,
      projectStageId: t.projectId ? sql`(select id from project_stages where project_id = ${t.projectId} and archived_at is null and not done order by position limit 1)` as unknown as string : null,
      milestoneId: null, checklist: (t.checklist ?? []).map((c) => ({ ...c, done: false, doneAt: null, doneBy: null })), estimateMinutes: t.estimateMinutes, tags: t.tags, category: t.category,
      participants: t.participants, recurrence: t.recurrence, seriesId: series, recurrenceKey: `${series}:${next}`, requiresApproval: t.requiresApproval, approverId: t.approverId,
      createdBy: t.createdBy, status: 'a_fazer',
    })
    .onConflictDoNothing()
    .returning({ id: s.activities.id });
  if (n) await taskEvent(db, auth, n.id, 'created', { recurrenceOf: t.id, dueOn: next });
  return n ? { id: n.id, dueOn: next } : null;
}

/** Marca como concluída e cuida do resto: projeto, recorrência. Não confere bloqueios (quem chama já conferiu). */
async function finish(db: DbOrTx, auth: AuthContext, t: TaskRow, extra: Partial<TaskRow> = {}) {
  await db.update(s.activities).set({ status: 'concluida', completedAt: new Date(), completedBy: auth.userId, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1`, ...extra }).where(eq(s.activities.id, t.id));
  await taskEvent(db, auth, t.id, 'completed', {});
  if (t.projectId) { await syncTaskStage(db, t.id, true); await autoStartProject(db, auth, t.projectId); }
  return spawnNext(db, auth, t);
}

/** Bloqueios para concluir: dependências e subtarefas em aberto. */
export async function blockersOf(db: DbOrTx, t: TaskRow) {
  const deps = await db
    .select({ id: s.activities.id, title: s.activities.title })
    .from(s.activityDependencies)
    .innerJoin(s.activities, eq(s.activities.id, s.activityDependencies.dependsOnId))
    .where(and(eq(s.activityDependencies.activityId, t.id), isNull(s.activities.deletedAt), ne(s.activities.status, 'concluida'), ne(s.activities.status, 'cancelada')));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.activities).where(and(eq(s.activities.parentId, t.id), isNull(s.activities.deletedAt), ne(s.activities.status, 'concluida'), ne(s.activities.status, 'cancelada')));
  return completionBlockers({ openBlockers: deps, openSubtasks: n });
}

/**
 * Muda a situação da tarefa respeitando as regras:
 * - concluir exige dependências e subtarefas concluídas; com aprovação, vai para "Em aprovação";
 * - reabrir limpa conclusão e aprovação; "Em aprovação" não se escolhe à mão.
 */
export async function applyStatus(db: DbOrTx, auth: AuthContext, t: TaskRow, to: TaskStatus, opts: { waitingOn?: string | null; note?: string } = {}) {
  if (to === t.status && to !== 'aguardando') return { status: t.status, next: null };
  if (to === 'em_aprovacao') throw unprocessable('Para pedir aprovação, conclua a tarefa: ela vai para o aprovador automaticamente.');
  if (to === 'concluida') {
    const b = await blockersOf(db, t);
    if (b.length) throw unprocessable(`Ainda não dá para concluir: ${b.join(' ')}`);
    if (t.requiresApproval && !t.approvedAt) {
      if (!t.approverId) throw unprocessable('Defina quem aprova a entrega antes de concluir.');
      await db.update(s.activities).set({ status: 'em_aprovacao', updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, t.id));
      await taskEvent(db, auth, t.id, 'submitted', { approverId: t.approverId, note: opts.note ?? null });
      return { status: 'em_aprovacao' as const, next: null };
    }
    const next = await finish(db, auth, t);
    return { status: 'concluida' as const, next };
  }
  const reopening = t.status === 'concluida' || t.status === 'em_aprovacao';
  await db.update(s.activities).set({
    status: to, waitingOn: to === 'aguardando' ? opts.waitingOn ?? t.waitingOn : null,
    completedAt: null, completedBy: null, approvedAt: reopening ? null : undefined, approvedBy: reopening ? null : undefined,
    updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1`,
  }).where(eq(s.activities.id, t.id));
  await taskEvent(db, auth, t.id, t.status === 'concluida' ? 'reopened' : to === 'cancelada' ? 'cancelled' : 'status', { from: t.status, to, waitingOn: opts.waitingOn ?? null, note: opts.note ?? null });
  if (t.projectId && t.status === 'concluida') await syncTaskStage(db, t.id, false);
  return { status: to, next: null };
}

/** Decisão do aprovador sobre a entrega. */
export async function decideApproval(db: DbOrTx, auth: AuthContext, t: TaskRow, approve: boolean, note: string) {
  if (t.approverId !== auth.userId) throw forbidden('Só quem foi indicado como aprovador decide esta entrega.');
  if (t.status !== 'em_aprovacao') throw unprocessable('A tarefa não está aguardando aprovação.');
  if (!approve) {
    if (note.trim().length < 5) throw unprocessable('Explique o que falta (mínimo 5 caracteres).', [{ path: 'note', message: 'Obrigatório para devolver' }]);
    await db.update(s.activities).set({ status: 'em_andamento', updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, t.id));
    await taskEvent(db, auth, t.id, 'rejected', { note });
    if (t.projectId) await syncTaskStage(db, t.id, false);
    return { status: 'em_andamento' as const, next: null };
  }
  await taskEvent(db, auth, t.id, 'approved', { note: note || null });
  const next = await finish(db, auth, t, { approvedAt: new Date(), approvedBy: auth.userId });
  return { status: 'concluida' as const, next };
}

/** Responsável precisa ser usuário ativo da empresa; numa tarefa de projeto, membro (não observador) ou dono do projeto. */
export async function assertAssignee(db: DbOrTx, auth: AuthContext, userId: string, projectId: string | null) {
  const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, userId), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).limit(1);
  if (!u) throw unprocessable('Responsável inválido.', [{ path: 'ownerId', message: 'Usuário inativo ou de outra empresa' }]);
  if (!projectId) return;
  const [p] = await db.select({ ownerId: s.projects.ownerId }).from(s.projects).where(eq(s.projects.id, projectId)).limit(1);
  if (p?.ownerId === userId) return;
  const [m] = await db.select({ role: s.projectMembers.role }).from(s.projectMembers).where(and(eq(s.projectMembers.projectId, projectId), eq(s.projectMembers.userId, userId))).limit(1);
  if (!m || m.role === 'observador') throw unprocessable('Responsável fora da equipe do projeto.', [{ path: 'ownerId', message: 'Inclua a pessoa na equipe do projeto antes' }]);
}

export async function assertUsersActive(db: DbOrTx, auth: AuthContext, ids: string[], path: string) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const r = await db.select({ id: s.users.id }).from(s.users).where(and(inArray(s.users.id, uniq), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true)));
  if (r.length !== uniq.length) throw unprocessable('Pessoa inválida.', [{ path, message: 'Usuário inativo ou de outra empresa' }]);
}
