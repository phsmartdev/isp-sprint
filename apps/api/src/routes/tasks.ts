/** Tarefas (Etapa 4): avulsas ou vinculadas, com subtarefas, checklist, dependências, recorrência, tempo, aprovação, comentários e arquivos. */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  RECURRENCE_FREQS, TASK_MANUAL_STATUSES, TASK_STATUSES, TASK_STATUS_LABELS, atLeast, bucketOf, checklistProgress, createsCycle, describeRecurrence, validateRecurrence,
  type ChecklistItem, type MyTaskBucket, type TaskStatus,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { assertProjectLinks, dueAtOf, loadProject, todayLocal } from '../services/projects';
import { activityScope, applyStatus, assertAssignee, assertUsersActive, blockersOf, decideApproval, loadTask, taskEvent } from '../services/tasks';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const prio = z.enum(['baixa', 'media', 'alta']);
const uuidN = z.string().uuid().nullable().optional();
const RecurrenceSchema = z.object({ freq: z.enum(RECURRENCE_FREQS), interval: z.number().int().min(1).max(365), weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(), until: isoDate.nullable().optional(), skipWeekends: z.boolean().optional() });
const Tag = z.string().trim().toLowerCase().min(1).max(30);
const ChecklistIn = z.array(z.object({ id: z.string().max(40).optional(), text: z.string().trim().min(1).max(200), done: z.boolean().default(false) })).max(50);

const TaskFields = {
  title: z.string().trim().min(2).max(200),
  notes: z.string().max(8000).nullable().optional(),
  ownerId: z.string().uuid().optional(),
  priority: prio.optional(),
  startOn: isoDate.nullable().optional(),
  dueOn: isoDate.nullable().optional(),
  estimateMinutes: z.number().int().min(1).max(100_000).nullable().optional(),
  tags: z.array(Tag).max(10).optional(),
  category: z.string().trim().max(40).nullable().optional(),
  participants: z.array(z.string().uuid()).max(20).optional(),
  recurrence: RecurrenceSchema.nullable().optional(),
  requiresApproval: z.boolean().optional(),
  approverId: uuidN,
  checklist: ChecklistIn.optional(),
  contactId: uuidN, opportunityId: uuidN, contractId: uuidN, arpId: uuidN,
};
const TaskCreate = z.object({ ...TaskFields, projectId: uuidN, parentId: uuidN, templateId: uuidN, status: z.enum(['a_fazer', 'em_andamento', 'aguardando']).optional(), waitingOn: z.string().max(200).nullable().optional() });
const TaskPatch = z.object({ ...TaskFields, title: TaskFields.title.optional(), rowVersion: z.number().int(), status: z.enum(TASK_STATUSES).optional(), waitingOn: z.string().max(200).nullable().optional(), statusNote: z.string().max(1000).optional() });

const owner = alias(s.users, 'task_owner');
const creator = alias(s.users, 'task_creator');

function listSelect(auth: AuthContext) {
  return {
    id: s.activities.id, title: s.activities.title, notes: s.activities.notes, status: s.activities.status, priority: s.activities.priority, type: s.activities.type,
    ownerId: s.activities.ownerId, ownerName: owner.name, createdBy: s.activities.createdBy, createdByName: creator.name,
    dueOn: sql<string | null>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')`, startOn: s.activities.startOn,
    completedAt: s.activities.completedAt, tags: s.activities.tags, category: s.activities.category, estimateMinutes: s.activities.estimateMinutes,
    checklist: s.activities.checklist, participants: s.activities.participants, waitingOn: s.activities.waitingOn, recurrence: s.activities.recurrence,
    requiresApproval: s.activities.requiresApproval, approverId: s.activities.approverId, approvedAt: s.activities.approvedAt, parentId: s.activities.parentId,
    projectId: s.activities.projectId, projectName: s.projects.name, projectStageId: s.activities.projectStageId, milestoneId: s.activities.milestoneId,
    contactId: s.activities.contactId, contactName: s.contacts.name, opportunityId: s.activities.opportunityId, opportunityCode: s.opportunities.code,
    contractId: s.activities.contractId, contractCode: s.contracts.code, arpId: s.activities.arpId, arpNumber: s.arps.number, rowVersion: s.activities.rowVersion, createdAt: s.activities.createdAt,
    timeMinutes: sql<number>`coalesce((select sum(minutes) from activity_time_entries te where te.activity_id = ${s.activities.id}), 0)::int`,
    subDone: sql<number>`(select count(*) from activities sa where sa.parent_id = ${s.activities.id} and sa.deleted_at is null and sa.status = 'concluida')::int`,
    subTotal: sql<number>`(select count(*) from activities sa where sa.parent_id = ${s.activities.id} and sa.deleted_at is null and sa.status <> 'cancelada')::int`,
    blockedBy: sql<number>`(select count(*) from activity_dependencies d join activities b on b.id = d.depends_on_id where d.activity_id = ${s.activities.id} and b.deleted_at is null and b.status not in ('concluida','cancelada'))::int`,
    comments: sql<number>`(select count(*) from activity_comments c where c.activity_id = ${s.activities.id})::int`,
    unread: sql<number>`(select count(*) from activity_comments c where c.activity_id = ${s.activities.id} and c.author_id <> ${auth.userId} and c.created_at > coalesce((select r.last_read_at from activity_reads r where r.activity_id = ${s.activities.id} and r.user_id = ${auth.userId}), '-infinity'))::int`,
  };
}
function listQuery(db: DbOrTx, auth: AuthContext) {
  return db
    .select(listSelect(auth))
    .from(s.activities)
    .innerJoin(owner, eq(owner.id, s.activities.ownerId))
    .leftJoin(creator, eq(creator.id, s.activities.createdBy))
    .leftJoin(s.projects, eq(s.projects.id, s.activities.projectId))
    .leftJoin(s.contacts, eq(s.contacts.id, s.activities.contactId))
    .leftJoin(s.opportunities, eq(s.opportunities.id, s.activities.opportunityId))
    .leftJoin(s.contracts, eq(s.contracts.id, s.activities.contractId))
    .leftJoin(s.arps, eq(s.arps.id, s.activities.arpId));
}
type Row = Awaited<ReturnType<ReturnType<typeof listQuery>['where']>>[number];

function dto(r: Row, auth: AuthContext, today: string) {
  return {
    ...r,
    statusLabel: TASK_STATUS_LABELS[r.status as TaskStatus] ?? r.status,
    overdue: !r.completedAt && r.status !== 'cancelada' && !!r.dueOn && r.dueOn < today,
    bucket: bucketOf({ ownerId: r.ownerId, createdBy: r.createdBy, status: r.status as TaskStatus, dueOn: r.dueOn }, auth.userId, today),
    checklistProgress: checklistProgress(r.checklist),
    recurrenceText: r.recurrence ? describeRecurrence(r.recurrence) : null,
    links: {
      contact: r.contactId ? { id: r.contactId, name: r.contactName } : null,
      opportunity: r.opportunityId ? { id: r.opportunityId, name: `OP-${r.opportunityCode}` } : null,
      contract: r.contractId ? { id: r.contractId, name: `CT-${r.contractCode}` } : null,
      arp: r.arpId ? { id: r.arpId, name: `Ata ${r.arpNumber}` } : null,
      project: r.projectId ? { id: r.projectId, name: r.projectName } : null,
    },
  };
}

function normalizeChecklist(items: { id?: string; text: string; done: boolean }[], prev: ChecklistItem[], userId: string): ChecklistItem[] {
  return items.map((i) => {
    const old = i.id ? prev.find((p) => p.id === i.id) : undefined;
    const changed = !old || old.done !== i.done;
    return { id: i.id ?? randomUUID().slice(0, 8), text: i.text, done: i.done, doneAt: i.done ? (changed ? new Date().toISOString() : old?.doneAt ?? null) : null, doneBy: i.done ? (changed ? userId : old?.doneBy ?? null) : null };
  });
}

async function assertLinks(db: DbOrTx, auth: AuthContext, b: { contactId?: string | null; opportunityId?: string | null; contractId?: string | null; arpId?: string | null }) {
  await assertProjectLinks(db, auth, b);
}

async function checkApprover(db: DbOrTx, auth: AuthContext, requires: boolean, approverId: string | null | undefined, ownerId: string) {
  if (!requires) return;
  if (!approverId) throw unprocessable('Escolha quem aprova a entrega.', [{ path: 'approverId', message: 'Obrigatório quando a entrega precisa de aprovação' }]);
  if (approverId === ownerId) throw unprocessable('Quem aprova não pode ser o responsável pela tarefa.', [{ path: 'approverId', message: 'Escolha outra pessoa' }]);
  await assertUsersActive(db, auth, [approverId], 'approverId');
}

export const taskRoutes = [
  defineRoute({
    method: 'GET',
    url: '/tasks',
    summary: 'Tarefas visíveis: Minhas (com grupos Hoje, Próximas, Atrasadas, Aguardando, Delegadas, Concluídas), Equipe ou vinculadas a um registro',
    tag: 'Tarefas',
    module: 'atividades',
    query: z.object({
      view: z.enum(['minhas', 'equipe', 'todas']).default('minhas'),
      bucket: z.string().max(20).optional(),
      status: z.string().max(120).optional(),
      ownerId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      priority: prio.optional(),
      tag: z.string().max(30).optional(),
      category: z.string().max(40).optional(),
      q: z.string().max(100).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      includeDone: z.coerce.boolean().optional(),
      parentId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(), opportunityId: z.string().uuid().optional(), contractId: z.string().uuid().optional(), arpId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    }),
    handler: async ({ app, auth, query: q }) => {
      if (q.view === 'equipe' && !atLeast(level(auth, 'atividades'), 'equipe')) throw forbidden('Seu perfil vê apenas as próprias tarefas.');
      const w: SQL[] = [activityScope(auth), eq(s.activities.type, 'tarefa')];
      w.push(q.parentId ? eq(s.activities.parentId, q.parentId) : isNull(s.activities.parentId));
      if (q.view === 'minhas') w.push(or(eq(s.activities.ownerId, auth.userId), and(eq(s.activities.createdBy, auth.userId), ne(s.activities.ownerId, auth.userId)))!);
      if (q.ownerId) w.push(eq(s.activities.ownerId, q.ownerId));
      if (q.projectId) w.push(eq(s.activities.projectId, q.projectId));
      if (q.priority) w.push(eq(s.activities.priority, q.priority));
      if (q.tag) w.push(sql`${q.tag.toLowerCase()} = any(${s.activities.tags})`);
      if (q.category) w.push(eq(s.activities.category, q.category));
      for (const k of ['contactId', 'opportunityId', 'contractId', 'arpId'] as const) if (q[k]) w.push(eq(s.activities[k], q[k]!));
      if (q.status) { const st = q.status.split(',').filter((x): x is TaskStatus => (TASK_STATUSES as readonly string[]).includes(x)); if (st.length) w.push(inArray(s.activities.status, st)); }
      else if (!q.includeDone && q.view !== 'minhas') w.push(inArray(s.activities.status, ['a_fazer', 'em_andamento', 'aguardando', 'em_aprovacao']));
      if (q.q) { const term = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`; w.push(or(ilike(s.activities.title, term), ilike(s.contacts.name, term), ilike(s.projects.name, term))!); }
      const day = sql`(${s.activities.dueAt} at time zone ${auth.timezone})::date`;
      if (q.from) w.push(sql`${day} >= ${q.from}::date`);
      if (q.to) w.push(sql`${day} <= ${q.to}::date`);
      if (q.view === 'minhas' && !q.status) {
        // concluídas só dos últimos 30 dias para não pesar
        w.push(or(ne(s.activities.status, 'concluida'), gte(s.activities.completedAt, sql`now() - interval '30 days'`))!, ne(s.activities.status, 'cancelada'));
      }
      const rows = await listQuery(app.db, auth).where(and(...w)).orderBy(sql`${s.activities.dueAt} asc nulls last`, asc(s.activities.position), desc(s.activities.createdAt)).limit(q.limit);
      const today = todayLocal(auth);
      let items = rows.map((r) => dto(r, auth, today));
      const counts: Record<string, number> = {};
      if (q.view === 'minhas') for (const i of items) if (i.bucket) counts[i.bucket] = (counts[i.bucket] ?? 0) + 1;
      if (q.bucket) items = items.filter((i) => i.bucket === (q.bucket as MyTaskBucket));
      const tags = [...new Set(rows.flatMap((r) => r.tags))].sort();
      const categories = [...new Set(rows.map((r) => r.category).filter(Boolean) as string[])].sort();
      return { items, counts, today, tags, categories };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/tasks/:id',
    summary: 'Tarefa completa: subtarefas, dependências, comentários, tempo, arquivos, histórico e permissões',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { t, can } = await loadTask(app.db, auth, params.id);
      const today = todayLocal(auth);
      const [row] = await listQuery(app.db, auth).where(eq(s.activities.id, t.id)).limit(1);
      const [subtasks, blockedBy, blocking, comments, time, files, events, users, stages, milestones] = await Promise.all([
        listQuery(app.db, auth).where(and(eq(s.activities.parentId, t.id), isNull(s.activities.deletedAt))).orderBy(asc(s.activities.createdAt)),
        app.db.select({ id: s.activities.id, title: s.activities.title, status: s.activities.status, ownerName: s.users.name }).from(s.activityDependencies).innerJoin(s.activities, eq(s.activities.id, s.activityDependencies.dependsOnId)).innerJoin(s.users, eq(s.users.id, s.activities.ownerId)).where(and(eq(s.activityDependencies.activityId, t.id), isNull(s.activities.deletedAt))),
        app.db.select({ id: s.activities.id, title: s.activities.title, status: s.activities.status, ownerName: s.users.name }).from(s.activityDependencies).innerJoin(s.activities, eq(s.activities.id, s.activityDependencies.activityId)).innerJoin(s.users, eq(s.users.id, s.activities.ownerId)).where(and(eq(s.activityDependencies.dependsOnId, t.id), isNull(s.activities.deletedAt))),
        app.db.select({ id: s.activityComments.id, body: s.activityComments.body, mentions: s.activityComments.mentions, createdAt: s.activityComments.createdAt, authorId: s.activityComments.authorId, authorName: s.users.name }).from(s.activityComments).leftJoin(s.users, eq(s.users.id, s.activityComments.authorId)).where(eq(s.activityComments.activityId, t.id)).orderBy(asc(s.activityComments.createdAt)),
        app.db.select({ id: s.activityTimeEntries.id, minutes: s.activityTimeEntries.minutes, workedOn: s.activityTimeEntries.workedOn, note: s.activityTimeEntries.note, reversesId: s.activityTimeEntries.reversesId, userId: s.activityTimeEntries.userId, userName: s.users.name, createdAt: s.activityTimeEntries.createdAt }).from(s.activityTimeEntries).innerJoin(s.users, eq(s.users.id, s.activityTimeEntries.userId)).where(eq(s.activityTimeEntries.activityId, t.id)).orderBy(desc(s.activityTimeEntries.workedOn), desc(s.activityTimeEntries.createdAt)),
        app.db.select({ id: s.workFiles.id, name: s.workFiles.name, mime: s.workFiles.mime, sizeBytes: s.workFiles.sizeBytes, createdAt: s.workFiles.createdAt, uploadedBy: s.users.name }).from(s.workFiles).leftJoin(s.users, eq(s.users.id, s.workFiles.uploadedBy)).where(and(eq(s.workFiles.activityId, t.id), isNull(s.workFiles.deletedAt))).orderBy(desc(s.workFiles.createdAt)),
        app.db.select({ id: s.activityEvents.id, type: s.activityEvents.type, payload: s.activityEvents.payload, occurredAt: s.activityEvents.occurredAt, actorName: s.users.name }).from(s.activityEvents).leftJoin(s.users, eq(s.users.id, s.activityEvents.actorId)).where(eq(s.activityEvents.activityId, t.id)).orderBy(desc(s.activityEvents.occurredAt)).limit(200),
        (() => { const ids = [...new Set([...t.participants, ...(t.approverId ? [t.approverId] : [])])]; return ids.length ? app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids)) : Promise.resolve([]); })(),
        t.projectId ? app.db.select({ id: s.projectStages.id, name: s.projectStages.name, done: s.projectStages.done }).from(s.projectStages).where(and(eq(s.projectStages.projectId, t.projectId), isNull(s.projectStages.archivedAt))).orderBy(asc(s.projectStages.position)) : Promise.resolve([]),
        t.projectId ? app.db.select({ id: s.projectMilestones.id, name: s.projectMilestones.name }).from(s.projectMilestones).where(and(eq(s.projectMilestones.projectId, t.projectId), isNull(s.projectMilestones.deletedAt))) : Promise.resolve([]),
      ]);
      const [parent] = t.parentId ? await app.db.select({ id: s.activities.id, title: s.activities.title }).from(s.activities).where(eq(s.activities.id, t.parentId)).limit(1) : [];
      await app.db.insert(s.activityReads).values({ userId: auth.userId, activityId: t.id }).onConflictDoUpdate({ target: [s.activityReads.userId, s.activityReads.activityId], set: { lastReadAt: new Date() } });
      const blockers = await blockersOf(app.db, t);
      return {
        ...dto(row!, auth, today),
        subtasks: subtasks.map((r) => dto(r, auth, today)), blockedBy, blocking, comments, time, files, events, parent: parent ?? null,
        people: users, stages, milestones, blockers, can,
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/tasks',
    summary: 'Cria tarefa avulsa, vinculada (cliente, oportunidade, contrato, ata, projeto) ou subtarefa; pode partir de modelo',
    tag: 'Tarefas',
    module: 'atividades',
    body: TaskCreate,
    handler: async ({ app, auth, body, reply }) => {
      const id = await app.db.transaction(async (tx) => {
        let b = { ...body };
        if (body.templateId) {
          const [tp] = await tx.select().from(s.taskTemplates).where(and(eq(s.taskTemplates.id, body.templateId), eq(s.taskTemplates.tenantId, auth.tenantId), eq(s.taskTemplates.active, true))).limit(1);
          if (!tp) throw notFound('Modelo de tarefa não encontrado.');
          b = { ...b, notes: b.notes ?? tp.notes, priority: b.priority ?? (tp.priority as 'baixa' | 'media' | 'alta'), estimateMinutes: b.estimateMinutes ?? tp.estimateMinutes, tags: b.tags ?? tp.tags, category: b.category ?? tp.category, requiresApproval: b.requiresApproval ?? tp.requiresApproval, checklist: b.checklist ?? tp.checklist.map((c) => ({ text: c.text, done: false })) };
        }
        let parent: typeof s.activities.$inferSelect | null = null;
        if (b.parentId) {
          parent = (await loadTask(tx, auth, b.parentId)).t;
          if (parent.parentId) throw unprocessable('Subtarefa não pode ter subtarefas (um nível só).');
        }
        const projectId = parent?.projectId ?? b.projectId ?? null;
        let stageId: string | null = null;
        if (projectId && !parent) {
          const { can } = await loadProject(tx, auth, projectId);
          if (!can.work) throw forbidden('Observadores não criam tarefas no projeto.');
          const [st] = await tx.select({ id: s.projectStages.id }).from(s.projectStages).where(and(eq(s.projectStages.projectId, projectId), isNull(s.projectStages.archivedAt), eq(s.projectStages.done, false))).orderBy(asc(s.projectStages.position)).limit(1);
          stageId = st?.id ?? null;
        }
        const ownerId = b.ownerId ?? auth.userId;
        // delegar: qualquer pessoa pode pedir uma tarefa a um colega ativo; quem criou continua vendo (Delegadas)
        await assertAssignee(tx, auth, ownerId, projectId);
        await assertLinks(tx, auth, b);
        await assertUsersActive(tx, auth, b.participants ?? [], 'participants');
        await checkApprover(tx, auth, !!b.requiresApproval, b.approverId, ownerId);
        if (b.recurrence) { const e = validateRecurrence(b.recurrence); if (e.length) throw unprocessable(e[0]!); if (!b.dueOn) throw unprocessable('Tarefa recorrente precisa de prazo (a série conta a partir dele).', [{ path: 'dueOn', message: 'Obrigatório na recorrência' }]); }
        if (b.startOn && b.dueOn && b.dueOn < b.startOn) throw unprocessable('O prazo não pode ser antes do início.', [{ path: 'dueOn', message: 'Antes do início' }]);
        const [a] = await tx.insert(s.activities).values({
          tenantId: auth.tenantId, type: 'tarefa', title: b.title, notes: b.notes ?? null, priority: b.priority ?? 'media', ownerId, createdBy: auth.userId,
          dueAt: dueAtOf(auth, b.dueOn) as unknown as Date, startOn: b.startOn ?? null, status: b.status ?? 'a_fazer', waitingOn: b.status === 'aguardando' ? b.waitingOn ?? null : null,
          estimateMinutes: b.estimateMinutes ?? null, tags: [...new Set(b.tags ?? [])], category: b.category ?? null, participants: [...new Set(b.participants ?? [])],
          recurrence: b.recurrence ?? null, requiresApproval: !!b.requiresApproval, approverId: b.requiresApproval ? b.approverId ?? null : null,
          checklist: normalizeChecklist(b.checklist ?? [], [], auth.userId), parentId: parent?.id ?? null, projectId, projectStageId: stageId,
          contactId: b.contactId ?? parent?.contactId ?? null, opportunityId: b.opportunityId ?? parent?.opportunityId ?? null, contractId: b.contractId ?? parent?.contractId ?? null, arpId: b.arpId ?? parent?.arpId ?? null,
          position: stageId ? sql`coalesce((select max(position) + 1 from activities where project_stage_id = ${stageId}), 0)` as unknown as number : 0,
        }).returning({ id: s.activities.id });
        await taskEvent(tx, auth, a!.id, 'created', { parentId: parent?.id ?? null, delegatedTo: ownerId !== auth.userId ? ownerId : null, templateId: body.templateId ?? null });
        return a!.id;
      });
      reply.code(201);
      return { id };
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/tasks/:id',
    summary: 'Edita, reatribui (delega), reagenda, muda situação (concluir respeita dependências, subtarefas e aprovação), checklist, vínculos e recorrência',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    body: TaskPatch,
    handler: async ({ app, auth, params, body }) => {
      const r = await app.db.transaction(async (tx) => {
        const { t, can } = await loadTask(tx, auth, params.id);
        if (t.rowVersion !== body.rowVersion) throw conflict(t.rowVersion);
        const onlyChecklist = Object.keys(body).every((k) => ['rowVersion', 'checklist'].includes(k));
        if (!can.edit && !(onlyChecklist && t.participants.includes(auth.userId))) throw forbidden('Você pode comentar, mas não alterar esta tarefa.');
        const events: { type: string; payload: Record<string, unknown> }[] = [];
        const ownerId = body.ownerId ?? t.ownerId;
        if (body.ownerId && body.ownerId !== t.ownerId) {
          if (!can.assign) throw forbidden('Só quem criou, o responsável, o gerente do projeto ou a liderança reatribui a tarefa.');
          await assertAssignee(tx, auth, body.ownerId, t.projectId);
          events.push({ type: 'assigned', payload: { from: t.ownerId, to: body.ownerId } });
        }
        await assertLinks(tx, auth, body);
        if (body.participants) await assertUsersActive(tx, auth, body.participants, 'participants');
        const requires = body.requiresApproval ?? t.requiresApproval;
        const approver = body.approverId === undefined ? t.approverId : body.approverId;
        if (body.requiresApproval !== undefined || body.approverId !== undefined || body.ownerId) await checkApprover(tx, auth, requires, approver, ownerId);
        if (body.recurrence) { const e = validateRecurrence(body.recurrence); if (e.length) throw unprocessable(e[0]!); }
        const [{ due } = { due: null }] = await tx.select({ due: sql<string | null>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')` }).from(s.activities).where(eq(s.activities.id, t.id));
        const newDue = body.dueOn === undefined ? due : body.dueOn;
        if ((body.recurrence ?? t.recurrence) && !newDue && (body.recurrence !== null)) throw unprocessable('Tarefa recorrente precisa de prazo.', [{ path: 'dueOn', message: 'Obrigatório na recorrência' }]);
        const start = body.startOn === undefined ? t.startOn : body.startOn;
        if (start && newDue && newDue < start) throw unprocessable('O prazo não pode ser antes do início.', [{ path: 'dueOn', message: 'Antes do início' }]);
        if (body.dueOn !== undefined && body.dueOn !== due) events.push({ type: 'rescheduled', payload: { from: due, to: body.dueOn } });
        if (body.checklist) {
          const prev = t.checklist ?? [];
          const done = body.checklist.filter((c) => c.done && !prev.find((p) => p.id === c.id)?.done).length;
          if (done || body.checklist.length !== prev.length) events.push({ type: 'checklist', payload: { done, total: body.checklist.length } });
        }
        const edited = ['title', 'notes', 'priority', 'startOn', 'estimateMinutes', 'tags', 'category', 'participants', 'recurrence', 'requiresApproval', 'approverId', 'contactId', 'opportunityId', 'contractId', 'arpId'].filter((k) => (body as Record<string, unknown>)[k] !== undefined);
        if (edited.length) events.push({ type: 'updated', payload: { fields: edited } });
        await tx.update(s.activities).set({
          title: body.title, notes: body.notes, priority: body.priority, ownerId: body.ownerId, startOn: body.startOn,
          dueAt: body.dueOn === undefined ? undefined : (dueAtOf(auth, body.dueOn) as unknown as Date),
          estimateMinutes: body.estimateMinutes, tags: body.tags ? [...new Set(body.tags)] : undefined, category: body.category,
          participants: body.participants ? [...new Set(body.participants)] : undefined, recurrence: body.recurrence,
          seriesId: body.recurrence === null ? null : undefined, recurrenceKey: body.recurrence === null ? null : undefined,
          requiresApproval: body.requiresApproval, approverId: body.requiresApproval === false ? null : body.approverId,
          checklist: body.checklist ? normalizeChecklist(body.checklist, t.checklist ?? [], auth.userId) : undefined,
          contactId: body.contactId, opportunityId: body.opportunityId, contractId: body.contractId, arpId: body.arpId,
          waitingOn: body.status === undefined && body.waitingOn !== undefined && t.status === 'aguardando' ? body.waitingOn : undefined,
          updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1`,
        }).where(eq(s.activities.id, t.id));
        for (const e of events) await taskEvent(tx, auth, t.id, e.type, e.payload);
        if (body.status && body.status !== t.status) {
          if (!(TASK_MANUAL_STATUSES as readonly string[]).includes(body.status)) throw unprocessable('Essa situação não pode ser escolhida diretamente.');
          const [fresh] = await tx.select().from(s.activities).where(eq(s.activities.id, t.id)).limit(1);
          return applyStatus(tx, auth, fresh!, body.status, { waitingOn: body.waitingOn ?? null, note: body.statusNote });
        }
        if (body.status === 'aguardando' && body.waitingOn !== undefined) await tx.update(s.activities).set({ waitingOn: body.waitingOn }).where(eq(s.activities.id, t.id));
        return { status: t.status, next: null };
      });
      return { ok: true, ...r };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/tasks/:id/checklist',
    summary: 'Checklist item a item (incluir, marcar, renomear, retirar) — sem conflito entre pessoas marcando ao mesmo tempo',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    body: z.discriminatedUnion('op', [
      z.object({ op: z.literal('add'), text: z.string().trim().min(1).max(200) }),
      z.object({ op: z.literal('toggle'), itemId: z.string().max(40), done: z.boolean() }),
      z.object({ op: z.literal('rename'), itemId: z.string().max(40), text: z.string().trim().min(1).max(200) }),
      z.object({ op: z.literal('remove'), itemId: z.string().max(40) }),
    ]),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { t, can } = await loadTask(tx, auth, params.id);
      const participant = t.participants.includes(auth.userId);
      if (body.op === 'toggle' ? !(can.edit || participant) : !can.edit) throw forbidden(body.op === 'toggle' ? undefined : 'Só quem pode editar a tarefa muda os itens do checklist.');
      const [locked] = await tx.select({ checklist: s.activities.checklist }).from(s.activities).where(eq(s.activities.id, t.id)).for('update');
      let list = [...(locked?.checklist ?? [])];
      if (body.op === 'add') {
        if (list.length >= 50) throw unprocessable('No máximo 50 itens.');
        list.push({ id: randomUUID().slice(0, 8), text: body.text, done: false, doneAt: null, doneBy: null });
      } else {
        const i = list.findIndex((c) => c.id === body.itemId);
        if (i < 0) throw notFound('Item não encontrado.');
        if (body.op === 'toggle') list[i] = { ...list[i]!, done: body.done, doneAt: body.done ? new Date().toISOString() : null, doneBy: body.done ? auth.userId : null };
        if (body.op === 'rename') list[i] = { ...list[i]!, text: body.text };
        if (body.op === 'remove') list = list.filter((_, k) => k !== i);
      }
      await tx.update(s.activities).set({ checklist: list, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, t.id));
      if (body.op !== 'rename') await taskEvent(tx, auth, t.id, 'checklist', { op: body.op, done: list.filter((c) => c.done).length, total: list.length });
      return { checklist: list };
    }),
  }),

  defineRoute({
    method: 'DELETE',
    url: '/tasks/:id',
    summary: 'Remove a tarefa (exclusão lógica; subtarefas saem junto; histórico fica)',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await app.db.transaction(async (tx) => {
        const { t, can } = await loadTask(tx, auth, params.id);
        if (!(t.createdBy === auth.userId || can.assign)) throw forbidden('Só quem criou a tarefa ou a liderança pode removê-la.');
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.activityDependencies).innerJoin(s.activities, eq(s.activities.id, s.activityDependencies.activityId)).where(and(eq(s.activityDependencies.dependsOnId, t.id), isNull(s.activities.deletedAt), ne(s.activities.status, 'concluida')));
        if (n) throw unprocessable(`${n} tarefa(s) dependem desta. Retire a dependência antes de remover.`);
        await tx.update(s.activities).set({ deletedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(or(eq(s.activities.id, t.id), eq(s.activities.parentId, t.id)));
        await taskEvent(tx, auth, t.id, 'removed', {});
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/tasks/:id/dependencies',
    summary: 'Esta tarefa depende de outra (bloqueia a conclusão até a outra terminar). Recusa ciclos.',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    body: z.object({ dependsOnId: z.string().uuid() }),
    handler: async ({ app, auth, params, body, reply }) => {
      await app.db.transaction(async (tx) => {
        const { t, can } = await loadTask(tx, auth, params.id);
        if (!can.edit) throw forbidden();
        const { t: other } = await loadTask(tx, auth, body.dependsOnId);
        const edges = await tx.select({ from: s.activityDependencies.activityId, to: s.activityDependencies.dependsOnId }).from(s.activityDependencies).where(eq(s.activityDependencies.tenantId, auth.tenantId));
        if (createsCycle(edges, t.id, other.id)) throw unprocessable('Isso criaria uma dependência circular.');
        await tx.insert(s.activityDependencies).values({ tenantId: auth.tenantId, activityId: t.id, dependsOnId: other.id, createdBy: auth.userId }).onConflictDoNothing();
        await taskEvent(tx, auth, t.id, 'dependency', { added: other.id, title: other.title });
      });
      reply.code(201);
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'DELETE',
    url: '/tasks/:id/dependencies/:dependsOnId',
    summary: 'Retira a dependência',
    tag: 'Tarefas',
    module: 'atividades',
    params: z.object({ id: z.string().uuid(), dependsOnId: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      await app.db.transaction(async (tx) => {
        const { t, can } = await loadTask(tx, auth, params.id);
        if (!can.edit) throw forbidden();
        await tx.delete(s.activityDependencies).where(and(eq(s.activityDependencies.activityId, t.id), eq(s.activityDependencies.dependsOnId, params.dependsOnId)));
        await taskEvent(tx, auth, t.id, 'dependency', { removed: params.dependsOnId });
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/tasks/:id/comments',
    summary: 'Comenta na tarefa e menciona pessoas (@) — elas recebem o aviso em Menções',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    body: z.object({ body: z.string().trim().min(1).max(4000), mentions: z.array(z.string().uuid()).max(20).default([]) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const r = await app.db.transaction(async (tx) => {
        const { t } = await loadTask(tx, auth, params.id);
        const mentions = [...new Set(body.mentions.filter((m) => m !== auth.userId))];
        await assertUsersActive(tx, auth, mentions, 'mentions');
        const [c] = await tx.insert(s.activityComments).values({ tenantId: auth.tenantId, activityId: t.id, authorId: auth.userId, body: body.body, mentions }).returning({ id: s.activityComments.id, createdAt: s.activityComments.createdAt });
        // quem é mencionado passa a acompanhar a tarefa (vê e é avisado), sem virar responsável
        const add = mentions.filter((m) => m !== t.ownerId && !t.participants.includes(m));
        if (add.length) await tx.update(s.activities).set({ participants: [...t.participants, ...add] }).where(eq(s.activities.id, t.id));
        await tx.insert(s.activityReads).values({ userId: auth.userId, activityId: t.id }).onConflictDoUpdate({ target: [s.activityReads.userId, s.activityReads.activityId], set: { lastReadAt: new Date() } });
        return c!;
      });
      reply.code(201);
      return r;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/tasks/:id/time',
    summary: 'Registra tempo trabalhado na tarefa',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    body: z.object({ minutes: z.number().int().min(1).max(24 * 60), workedOn: isoDate, note: z.string().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body, reply }) => {
      const { t, can } = await loadTask(app.db, auth, params.id);
      if (!can.edit && !t.participants.includes(auth.userId)) throw forbidden();
      if (body.workedOn > todayLocal(auth)) throw unprocessable('Não dá para registrar tempo no futuro.', [{ path: 'workedOn', message: 'Data futura' }]);
      const [e] = await app.db.insert(s.activityTimeEntries).values({ tenantId: auth.tenantId, activityId: t.id, userId: auth.userId, minutes: body.minutes, workedOn: body.workedOn, note: body.note ?? null }).returning({ id: s.activityTimeEntries.id });
      reply.code(201);
      return e!;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/tasks/:id/time/:entryId/reverse',
    summary: 'Estorna um lançamento de tempo (lançamento negativo; o original continua no histórico)',
    tag: 'Tarefas',
    module: 'atividades',
    params: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      await app.db.transaction(async (tx) => {
        const { t } = await loadTask(tx, auth, params.id);
        const [e] = await tx.select().from(s.activityTimeEntries).where(and(eq(s.activityTimeEntries.id, params.entryId), eq(s.activityTimeEntries.activityId, t.id))).limit(1);
        if (!e || e.minutes < 0) throw notFound('Lançamento não encontrado.');
        if (e.userId !== auth.userId && !atLeast(level(auth, 'atividades'), 'equipe')) throw forbidden('Só quem lançou ou a liderança estorna.');
        const [rev] = await tx.select({ id: s.activityTimeEntries.id }).from(s.activityTimeEntries).where(eq(s.activityTimeEntries.reversesId, e.id)).limit(1);
        if (rev) throw unprocessable('Este lançamento já foi estornado.');
        await tx.insert(s.activityTimeEntries).values({ tenantId: auth.tenantId, activityId: t.id, userId: e.userId, minutes: -e.minutes, workedOn: e.workedOn, note: `Estorno por ${auth.name}`, reversesId: e.id });
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/tasks/:id/approval',
    summary: 'Aprovador aceita a entrega (conclui) ou devolve com o que falta',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().max(1000).default('') }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { t } = await loadTask(tx, auth, params.id);
      return decideApproval(tx, auth, t, body.approve, body.note);
    }),
  }),

  defineRoute({
    method: 'POST',
    url: '/tasks/:id/files',
    summary: 'Anexa arquivo à tarefa (até 3 MB)',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    bodyLimit: 5_000_000,
    body: z.object({ name: z.string().trim().min(1).max(200), mime: z.string().max(120), data: z.string().min(1) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const { t } = await loadTask(app.db, auth, params.id);
      const buf = Buffer.from(body.data, 'base64');
      if (buf.length > 3 * 1024 * 1024) throw unprocessable('Arquivo maior que 3 MB.');
      const [f] = await app.db.insert(s.workFiles).values({ tenantId: auth.tenantId, activityId: t.id, name: body.name, mime: body.mime || 'application/octet-stream', sizeBytes: buf.length, data: buf, uploadedBy: auth.userId }).returning({ id: s.workFiles.id });
      await taskEvent(app.db, auth, t.id, 'file', { name: body.name });
      reply.code(201);
      return f!;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/tasks/:id/files/:fileId',
    summary: 'Baixa arquivo da tarefa',
    tag: 'Tarefas',
    module: 'atividades',
    params: z.object({ id: z.string().uuid(), fileId: z.string().uuid() }),
    handler: async ({ app, auth, params, reply }) => {
      const { t } = await loadTask(app.db, auth, params.id);
      const [f] = await app.db.select().from(s.workFiles).where(and(eq(s.workFiles.id, params.fileId), eq(s.workFiles.activityId, t.id), isNull(s.workFiles.deletedAt))).limit(1);
      if (!f) throw notFound('Arquivo não encontrado.');
      reply.header('content-type', f.mime).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      return reply.send(f.data);
    },
  }),

  defineRoute({
    method: 'DELETE',
    url: '/tasks/:id/files/:fileId',
    summary: 'Retira o arquivo da tarefa (fica registrado no histórico)',
    tag: 'Tarefas',
    module: 'atividades',
    params: z.object({ id: z.string().uuid(), fileId: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const { t, can } = await loadTask(app.db, auth, params.id);
      const [f] = await app.db.select({ id: s.workFiles.id, name: s.workFiles.name, uploadedBy: s.workFiles.uploadedBy }).from(s.workFiles).where(and(eq(s.workFiles.id, params.fileId), eq(s.workFiles.activityId, t.id), isNull(s.workFiles.deletedAt))).limit(1);
      if (!f) throw notFound('Arquivo não encontrado.');
      if (f.uploadedBy !== auth.userId && !can.edit) throw forbidden();
      await app.db.update(s.workFiles).set({ deletedAt: new Date(), deletedBy: auth.userId }).where(eq(s.workFiles.id, f.id));
      await taskEvent(app.db, auth, t.id, 'file_removed', { name: f.name });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/task-templates',
    summary: 'Modelos de tarefa da empresa',
    tag: 'Tarefas',
    module: 'atividades',
    handler: async ({ app, auth }) => ({ items: await app.db.select().from(s.taskTemplates).where(and(eq(s.taskTemplates.tenantId, auth.tenantId), eq(s.taskTemplates.active, true))).orderBy(asc(s.taskTemplates.name)) }),
  }),

  defineRoute({
    method: 'POST',
    url: '/task-templates',
    summary: 'Cria modelo de tarefa (título, descrição, checklist, estimativa, etiquetas, categoria, aprovação)',
    tag: 'Tarefas',
    module: 'atividades',
    body: z.object({ name: z.string().trim().min(3).max(120), title: z.string().trim().min(2).max(200), notes: z.string().max(8000).nullable().optional(), priority: prio.default('media'), checklist: z.array(z.object({ text: z.string().trim().min(1).max(200) })).max(50).default([]), estimateMinutes: z.number().int().min(1).max(100_000).nullable().optional(), tags: z.array(Tag).max(10).default([]), category: z.string().trim().max(40).nullable().optional(), requiresApproval: z.boolean().default(false) }),
    handler: async ({ app, auth, body, reply }) => {
      const [t] = await app.db.insert(s.taskTemplates).values({ tenantId: auth.tenantId, ...body, notes: body.notes ?? null, estimateMinutes: body.estimateMinutes ?? null, category: body.category ?? null, createdBy: auth.userId }).returning({ id: s.taskTemplates.id });
      reply.code(201);
      return t!;
    },
  }),

  defineRoute({
    method: 'DELETE',
    url: '/task-templates/:id',
    summary: 'Desativa modelo de tarefa',
    tag: 'Tarefas',
    module: 'atividades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [t] = await app.db.select().from(s.taskTemplates).where(and(eq(s.taskTemplates.id, params.id), eq(s.taskTemplates.tenantId, auth.tenantId))).limit(1);
      if (!t) throw notFound('Modelo não encontrado.');
      if (t.createdBy !== auth.userId && !atLeast(level(auth, 'atividades'), 'equipe')) throw forbidden('Só quem criou o modelo ou a liderança pode desativá-lo.');
      await app.db.update(s.taskTemplates).set({ active: false }).where(eq(s.taskTemplates.id, t.id));
      return { ok: true };
    },
  }),
];

