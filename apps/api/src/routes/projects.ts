import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  BUILTIN_PROJECT_TEMPLATES, PROJECT_KINDS, PROJECT_MEMBER_ROLES, PROJECT_STATUSES, PROJECT_STATUS_LABELS, DEFAULT_PROJECT_STAGES,
  canTransitionProject, instantiateTemplate, templateFromProject, validateTemplate, type ProjectTemplateDef,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { applyStatus } from '../services/tasks';
import { assertCan, assertProjectLinks, dueAtOf, loadProject, progressFor, projectEvent, projectScope, projectTasks, syncTaskStage } from '../services/projects';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const prio = z.enum(['baixa', 'media', 'alta']);
const uuidN = z.string().uuid().nullable().optional();
const Links = { contactId: uuidN, opportunityId: uuidN, contractId: uuidN, arpId: uuidN, campaignId: uuidN };
const Extra = { objective: z.string().trim().max(2000).nullable().optional(), category: z.string().trim().max(40).nullable().optional(), tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).optional() };
const TemplateDef = z.object({
  stages: z.array(z.object({ name: z.string().trim().min(1).max(60), done: z.boolean().optional() })).min(1).max(12),
  milestones: z.array(z.object({ name: z.string().trim().min(1).max(120), offsetDays: z.number().int().min(0).max(3650), stage: z.string().optional() })).max(60),
  tasks: z.array(z.object({ title: z.string().trim().min(1).max(200), stage: z.string().trim().min(1), offsetDays: z.number().int().min(0).max(3650), durationDays: z.number().int().min(0).max(3650).optional(), milestone: z.string().optional(), priority: prio.optional(), notes: z.string().max(2000).optional() })).max(300),
});

async function assertActiveUsers(db: DbOrTx, auth: AuthContext, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const r = await db.select({ id: s.users.id }).from(s.users).where(and(inArray(s.users.id, uniq), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true)));
  if (r.length !== uniq.length) throw unprocessable('Pessoa inválida.', [{ path: 'userId', message: 'Usuário inativo ou de outra empresa' }]);
}

/** Responsável por tarefa precisa estar no projeto (dono ou membro que não seja só observador). */
async function assertTaskOwner(db: DbOrTx, projectId: string, projectOwner: string, userId: string) {
  if (userId === projectOwner) return;
  const [m] = await db.select({ role: s.projectMembers.role }).from(s.projectMembers).where(and(eq(s.projectMembers.projectId, projectId), eq(s.projectMembers.userId, userId))).limit(1);
  if (!m || m.role === 'observador') throw unprocessable('Responsável fora da equipe do projeto.', [{ path: 'ownerId', message: 'Inclua a pessoa na equipe do projeto (como membro) antes de atribuir' }]);
}

async function linkNames(db: DbOrTx, auth: AuthContext, rows: { contactId: string | null; opportunityId: string | null; contractId: string | null; arpId: string | null; campaignId: string | null }[]) {
  const ids = (k: keyof (typeof rows)[number]) => [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])];
  const [c, o, k, a, cp] = await Promise.all([
    ids('contactId').length ? db.select({ id: s.contacts.id, name: s.contacts.name }).from(s.contacts).where(and(eq(s.contacts.tenantId, auth.tenantId), inArray(s.contacts.id, ids('contactId')))) : [],
    ids('opportunityId').length ? db.select({ id: s.opportunities.id, name: s.opportunities.title, code: s.opportunities.code }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, auth.tenantId), inArray(s.opportunities.id, ids('opportunityId')))) : [],
    ids('contractId').length ? db.select({ id: s.contracts.id, code: s.contracts.code }).from(s.contracts).where(and(eq(s.contracts.tenantId, auth.tenantId), inArray(s.contracts.id, ids('contractId')))) : [],
    ids('arpId').length ? db.select({ id: s.arps.id, number: s.arps.number }).from(s.arps).where(and(eq(s.arps.tenantId, auth.tenantId), inArray(s.arps.id, ids('arpId')))) : [],
    ids('campaignId').length ? db.select({ id: s.campaigns.id, name: s.campaigns.name }).from(s.campaigns).where(and(eq(s.campaigns.tenantId, auth.tenantId), inArray(s.campaigns.id, ids('campaignId')))) : [],
  ]);
  return (r: (typeof rows)[number]) => ({
    contact: c.find((x) => x.id === r.contactId) ?? null,
    opportunity: (() => { const x = o.find((y) => y.id === r.opportunityId); return x ? { id: x.id, name: x.name, code: x.code } : null; })(),
    contract: (() => { const x = k.find((y) => y.id === r.contractId); return x ? { id: x.id, name: `Contrato CT-${x.code}` } : null; })(),
    arp: (() => { const x = a.find((y) => y.id === r.arpId); return x ? { id: x.id, name: `Ata ${x.number}` } : null; })(),
    campaign: cp.find((y) => y.id === r.campaignId) ?? null,
  });
}

async function templateDef(db: DbOrTx, auth: AuthContext, key?: string | null, id?: string | null): Promise<{ def: ProjectTemplateDef; key: string | null }> {
  if (id) {
    const [t] = await db.select().from(s.projectTemplates).where(and(eq(s.projectTemplates.id, id), eq(s.projectTemplates.tenantId, auth.tenantId), eq(s.projectTemplates.active, true))).limit(1);
    if (!t) throw notFound('Modelo não encontrado.');
    return { def: t.def, key: `custom:${t.id}` };
  }
  if (key) {
    const b = BUILTIN_PROJECT_TEMPLATES.find((x) => x.key === key);
    if (!b) throw notFound('Modelo não encontrado.');
    return { def: b.def, key };
  }
  return { def: { stages: DEFAULT_PROJECT_STAGES, milestones: [], tasks: [] }, key: null };
}

const ProjectCreate = z.object({
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  kind: z.enum(PROJECT_KINDS).default('interno'),
  priority: prio.default('media'),
  ownerId: z.string().uuid().optional(),
  startOn: isoDate,
  dueOn: isoDate.nullable().optional(),
  templateKey: z.string().max(60).nullable().optional(),
  templateId: uuidN,
  members: z.array(z.object({ userId: z.string().uuid(), role: z.enum(PROJECT_MEMBER_ROLES) })).max(50).default([]),
  ...Links,
  ...Extra,
});

const TaskBody = z.object({
  title: z.string().trim().min(2).max(200),
  notes: z.string().max(4000).nullable().optional(),
  stageId: z.string().uuid().optional(),
  milestoneId: uuidN,
  ownerId: z.string().uuid().optional(),
  startOn: isoDate.nullable().optional(),
  dueOn: isoDate.nullable().optional(),
  priority: prio.default('media'),
});

export const projectRoutes = [
  defineRoute({
    method: 'GET',
    url: '/projects',
    summary: 'Projetos visíveis (filtros por situação, tipo, texto, participação e vínculo) com progresso e saúde',
    tag: 'Projetos',
    module: 'projetos',
    query: z.object({
      status: z.enum([...PROJECT_STATUSES, 'ativos'] as const).optional(),
      kind: z.enum(PROJECT_KINDS).optional(),
      q: z.string().max(100).optional(),
      mine: z.coerce.boolean().optional(),
      tag: z.string().max(30).optional(),
      ...Links,
    }),
    handler: async ({ app, auth, query: q }) => {
      const w: SQL[] = [projectScope(auth)];
      if (q.status === 'ativos') w.push(inArray(s.projects.status, ['planejamento', 'em_andamento', 'pausado']));
      else if (q.status) w.push(eq(s.projects.status, q.status));
      if (q.kind) w.push(eq(s.projects.kind, q.kind));
      if (q.q) w.push(ilike(s.projects.name, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`));
      if (q.mine) w.push(sql`(${s.projects.ownerId} = ${auth.userId} or exists (select 1 from project_members pm where pm.project_id = ${s.projects.id} and pm.user_id = ${auth.userId}))`);
      for (const k of ['contactId', 'opportunityId', 'contractId', 'arpId', 'campaignId'] as const) if (q[k]) w.push(eq(s.projects[k], q[k]!));
      if (q.tag) w.push(sql`${q.tag.toLowerCase()} = any(${s.projects.tags})`);
      const rows = await app.db.select({ p: s.projects, ownerName: s.users.name }).from(s.projects).innerJoin(s.users, eq(s.users.id, s.projects.ownerId)).where(and(...w)).orderBy(sql`${s.projects.dueOn} asc nulls last`, desc(s.projects.createdAt)).limit(500);
      const prog = await progressFor(app.db, auth, rows.map((r) => r.p));
      const names = await linkNames(app.db, auth, rows.map((r) => r.p));
      return { items: rows.map(({ p, ownerName }) => ({ ...p, ownerName, statusLabel: PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS], progress: prog.get(p.id)!, links: names(p) })) };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/projects',
    summary: 'Cria projeto (em branco ou a partir de modelo: etapas, marcos e tarefas com datas relativas ao início)',
    tag: 'Projetos',
    module: 'projetos',
    body: ProjectCreate,
    handler: async ({ app, auth, body, reply }) => {
      const ownerId = body.ownerId ?? auth.userId;
      if (body.dueOn && body.dueOn < body.startOn) throw unprocessable('O prazo não pode ser antes do início.', [{ path: 'dueOn', message: 'Antes do início' }]);
      const id = await app.db.transaction(async (tx) => {
        await assertActiveUsers(tx, auth, [ownerId, ...body.members.map((m) => m.userId)]);
        await assertProjectLinks(tx, auth, body);
        const tpl = await templateDef(tx, auth, body.templateKey, body.templateId);
        const inst = instantiateTemplate(tpl.def, body.startOn);
        const [p] = await tx.insert(s.projects).values({
          tenantId: auth.tenantId, name: body.name, description: body.description ?? null, kind: body.kind, priority: body.priority, ownerId,
          startOn: body.startOn, dueOn: body.dueOn ?? inst.dueOn, contactId: body.contactId ?? null, opportunityId: body.opportunityId ?? null,
          contractId: body.contractId ?? null, arpId: body.arpId ?? null, campaignId: body.campaignId ?? null, objective: body.objective ?? null, category: body.category ?? null, tags: [...new Set(body.tags ?? [])], templateKey: tpl.key, createdBy: auth.userId,
        }).returning({ id: s.projects.id });
        const pid = p!.id;
        const members = new Map(body.members.map((m) => [m.userId, m.role]));
        members.set(ownerId, 'gerente');
        if (ownerId !== auth.userId && !members.has(auth.userId)) members.set(auth.userId, 'membro');
        await tx.insert(s.projectMembers).values([...members].map(([userId, role]) => ({ projectId: pid, userId, tenantId: auth.tenantId, role })));
        const stages = await tx.insert(s.projectStages).values(inst.stages.map((st) => ({ tenantId: auth.tenantId, projectId: pid, name: st.name, position: st.position, done: st.done }))).returning();
        const ms = inst.milestones.length ? await tx.insert(s.projectMilestones).values(inst.milestones.map((m) => ({ tenantId: auth.tenantId, projectId: pid, name: m.name, dueOn: m.dueOn, position: m.position, acceptanceCriteria: m.acceptanceCriteria, requiresHomologation: m.homologation }))).returning() : [];
        for (const t of inst.tasks) {
          await tx.insert(s.activities).values({
            tenantId: auth.tenantId, type: 'tarefa', title: t.title, notes: t.notes, priority: t.priority, ownerId,
            dueAt: dueAtOf(auth, t.dueOn) as unknown as Date, startOn: t.startOn, projectId: pid,
            projectStageId: stages.find((x) => x.name === t.stage)!.id, milestoneId: ms.find((m) => m.name === t.milestone)?.id ?? null,
            position: t.position, contactId: body.contactId ?? null, opportunityId: body.opportunityId ?? null, contractId: body.contractId ?? null, createdBy: auth.userId,
          });
        }
        await projectEvent(tx, auth, pid, 'created', tpl.key ? `Projeto criado a partir do modelo (${inst.tasks.length} tarefas, ${inst.milestones.length} marcos)` : 'Projeto criado', { templateKey: tpl.key });
        return pid;
      });
      reply.code(201);
      return { id };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/projects/:id',
    summary: 'Projeto completo: etapas, marcos, equipe, tarefas, vínculos, progresso e permissões',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { p, can } = await loadProject(app.db, auth, params.id);
      const [stages, milestones, members, tasks, owner] = await Promise.all([
        app.db.select().from(s.projectStages).where(and(eq(s.projectStages.projectId, p.id), isNull(s.projectStages.archivedAt))).orderBy(asc(s.projectStages.position)),
        app.db.select().from(s.projectMilestones).where(and(eq(s.projectMilestones.projectId, p.id), isNull(s.projectMilestones.deletedAt))).orderBy(sql`${s.projectMilestones.dueOn} asc nulls last`, asc(s.projectMilestones.position)),
        app.db.select({ userId: s.projectMembers.userId, role: s.projectMembers.role, name: s.users.name, email: s.users.email }).from(s.projectMembers).innerJoin(s.users, eq(s.users.id, s.projectMembers.userId)).where(eq(s.projectMembers.projectId, p.id)).orderBy(asc(s.users.name)),
        projectTasks(app.db, auth, [p.id]),
        app.db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, p.ownerId)).limit(1),
      ]);
      const prog = (await progressFor(app.db, auth, [p])).get(p.id)!;
      const names = await linkNames(app.db, auth, [p]);
      return { ...p, ownerName: owner[0]?.name ?? null, statusLabel: PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS], stages, milestones, members, tasks, progress: prog, links: names(p), can };
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/projects/:id',
    summary: 'Edita projeto ou muda a situação (transições válidas; reabrir exige motivo)',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    body: z.object({
      rowVersion: z.number().int(),
      name: z.string().trim().min(3).max(160).optional(),
      description: z.string().trim().max(4000).nullable().optional(),
      kind: z.enum(PROJECT_KINDS).optional(),
      priority: prio.optional(),
      ownerId: z.string().uuid().optional(),
      startOn: isoDate.optional(),
      dueOn: isoDate.nullable().optional(),
      status: z.enum(PROJECT_STATUSES).optional(),
      reason: z.string().trim().max(1000).optional(),
      ...Links,
      ...Extra,
    }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const { p, can } = await loadProject(tx, auth, params.id);
        assertCan(can.manage, 'Só o gerente do projeto ou a liderança pode editar o projeto.');
        if (p.rowVersion !== body.rowVersion) throw conflict(p.rowVersion);
        const changes: string[] = [];
        if (body.status && body.status !== p.status) {
          if (!canTransitionProject(p.status as never, body.status)) throw unprocessable(`Não é possível ir de ${PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS]} para ${PROJECT_STATUS_LABELS[body.status]}.`);
          if (['concluido', 'cancelado'].includes(p.status) || body.status === 'cancelado') {
            if (!body.reason || body.reason.length < 5) throw unprocessable('Informe o motivo.', [{ path: 'reason', message: 'Mínimo 5 caracteres' }]);
          }
          changes.push(`situação: ${PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS]} → ${PROJECT_STATUS_LABELS[body.status]}`);
        }
        if (body.ownerId && body.ownerId !== p.ownerId) {
          await assertActiveUsers(tx, auth, [body.ownerId]);
          await tx.insert(s.projectMembers).values({ projectId: p.id, userId: body.ownerId, tenantId: auth.tenantId, role: 'gerente' }).onConflictDoUpdate({ target: [s.projectMembers.projectId, s.projectMembers.userId], set: { role: 'gerente' } });
          changes.push('responsável alterado');
        }
        await assertProjectLinks(tx, auth, body);
        const start = body.startOn ?? p.startOn;
        const due = body.dueOn === undefined ? p.dueOn : body.dueOn;
        if (due && due < start) throw unprocessable('O prazo não pode ser antes do início.', [{ path: 'dueOn', message: 'Antes do início' }]);
        for (const k of ['name', 'description', 'kind', 'priority', 'startOn', 'dueOn', 'contactId', 'opportunityId', 'contractId', 'arpId', 'campaignId', 'objective', 'category'] as const) {
          if (body[k] !== undefined && body[k] !== p[k]) changes.push(k);
        }
        const status = body.status ?? p.status;
        await tx.update(s.projects).set({
          name: body.name, description: body.description, kind: body.kind, priority: body.priority, ownerId: body.ownerId, startOn: body.startOn, dueOn: body.dueOn,
          contactId: body.contactId, opportunityId: body.opportunityId, contractId: body.contractId, arpId: body.arpId, campaignId: body.campaignId,
          objective: body.objective, category: body.category, tags: body.tags ? [...new Set(body.tags)] : undefined,
          status, completedAt: status === 'concluido' ? p.completedAt ?? new Date() : null, updatedAt: new Date(), rowVersion: sql`${s.projects.rowVersion} + 1`,
        }).where(eq(s.projects.id, p.id));
        if (changes.length) await projectEvent(tx, auth, p.id, body.status && body.status !== p.status ? 'status' : 'updated', `Projeto alterado: ${changes.join(', ')}${body.reason ? ` — ${body.reason}` : ''}`, { before: p, after: body });
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/projects/:id/stages',
    summary: 'Define as etapas do quadro (ordem, nome, concluída, limite). Etapa removida precisa estar vazia ou ter destino.',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    body: z.object({
      stages: z.array(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), done: z.boolean().default(false), wipLimit: z.number().int().min(1).max(500).nullable().optional() })).min(1).max(12),
      moveTo: z.record(z.string().uuid(), z.number().int().min(0)).default({}),
    }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const { p, can } = await loadProject(tx, auth, params.id);
        assertCan(can.manage, 'Só o gerente do projeto pode mudar as etapas.');
        if (new Set(body.stages.map((x) => x.name.toLowerCase())).size !== body.stages.length) throw unprocessable('Há etapas com o mesmo nome.');
        if (!body.stages.some((x) => x.done)) throw unprocessable('Marque pelo menos uma etapa como concluída (onde ficam as tarefas prontas).');
        const cur = await tx.select().from(s.projectStages).where(and(eq(s.projectStages.projectId, p.id), isNull(s.projectStages.archivedAt)));
        if (body.stages.some((x) => x.id && !cur.some((c) => c.id === x.id))) throw unprocessable('Etapa de outro projeto.');
        const ids: string[] = [];
        for (const [i, st] of body.stages.entries()) {
          if (st.id) { await tx.update(s.projectStages).set({ name: st.name, done: st.done, wipLimit: st.wipLimit ?? null, position: i }).where(eq(s.projectStages.id, st.id)); ids.push(st.id); }
          else { const [n] = await tx.insert(s.projectStages).values({ tenantId: auth.tenantId, projectId: p.id, name: st.name, done: st.done, wipLimit: st.wipLimit ?? null, position: i }).returning({ id: s.projectStages.id }); ids.push(n!.id); }
        }
        for (const old of cur.filter((c) => !body.stages.some((x) => x.id === c.id))) {
          const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.activities).where(and(eq(s.activities.projectStageId, old.id), isNull(s.activities.deletedAt)));
          if (n) {
            const target = body.moveTo[old.id];
            if (target === undefined || !ids[target]) throw unprocessable(`A etapa "${old.name}" tem ${n} tarefa(s). Escolha para qual etapa elas vão.`);
            await tx.update(s.activities).set({ projectStageId: ids[target] }).where(eq(s.activities.projectStageId, old.id));
          }
          await tx.update(s.projectStages).set({ archivedAt: new Date() }).where(eq(s.projectStages.id, old.id));
        }
        await projectEvent(tx, auth, p.id, 'stages', `Etapas do quadro: ${body.stages.map((x) => x.name).join(' → ')}`);
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/projects/:id/milestones',
    summary: 'Cria marco do projeto',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(120), dueOn: isoDate.nullable().optional(), notes: z.string().max(2000).nullable().optional(), acceptanceCriteria: z.string().trim().max(2000).nullable().optional(), requiresHomologation: z.boolean().optional() }),
    handler: async ({ app, auth, params, body, reply }) => {
      const r = await app.db.transaction(async (tx) => {
        const { p, can } = await loadProject(tx, auth, params.id);
        assertCan(can.manage, 'Só o gerente do projeto pode criar marcos.');
        const [m] = await tx.insert(s.projectMilestones).values({ tenantId: auth.tenantId, projectId: p.id, name: body.name, dueOn: body.dueOn ?? null, notes: body.notes ?? null, acceptanceCriteria: body.acceptanceCriteria ?? null, requiresHomologation: body.requiresHomologation ?? false }).returning({ id: s.projectMilestones.id });
        await projectEvent(tx, auth, p.id, 'milestone', `Marco criado: ${body.name}`);
        return m!;
      });
      reply.code(201);
      return r;
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/projects/:id/milestones/:milestoneId',
    summary: 'Edita, conclui, reabre ou remove marco (remover desvincula as tarefas)',
    tag: 'Projetos',
    module: 'projetos',
    params: z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() }),
    body: z.object({ name: z.string().trim().min(2).max(120).optional(), dueOn: isoDate.nullable().optional(), notes: z.string().max(2000).nullable().optional(), completed: z.boolean().optional(), remove: z.boolean().optional(), acceptanceCriteria: z.string().trim().max(2000).nullable().optional(), requiresHomologation: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const { p, can } = await loadProject(tx, auth, params.id);
        assertCan(can.manage, 'Só o gerente do projeto pode alterar marcos.');
        const [m] = await tx.select().from(s.projectMilestones).where(and(eq(s.projectMilestones.id, params.milestoneId), eq(s.projectMilestones.projectId, p.id), isNull(s.projectMilestones.deletedAt))).limit(1);
        if (!m) throw notFound('Marco não encontrado.');
        if (body.remove) {
          await tx.update(s.activities).set({ milestoneId: null }).where(eq(s.activities.milestoneId, m.id));
          await tx.update(s.projectMilestones).set({ deletedAt: new Date() }).where(eq(s.projectMilestones.id, m.id));
          await projectEvent(tx, auth, p.id, 'milestone', `Marco removido: ${m.name}`);
          return;
        }
        if (body.completed === true && !m.completedAt) {
          const [{ open } = { open: 0 }] = await tx.select({ open: sql<number>`count(*)::int` }).from(s.activities).where(and(eq(s.activities.milestoneId, m.id), isNull(s.activities.completedAt), isNull(s.activities.deletedAt)));
          if (open) throw unprocessable(`O marco tem ${open} tarefa(s) em aberto. Conclua ou desvincule antes.`);
        }
        await tx.update(s.projectMilestones).set({
          name: body.name, dueOn: body.dueOn, notes: body.notes, acceptanceCriteria: body.acceptanceCriteria, requiresHomologation: body.requiresHomologation,
          // reabrir desfaz a homologação (a decisão anterior fica no histórico)
          ...(body.completed === false && m.homologatedAt ? { homologatedAt: null, homologatedBy: null } : {}),
          completedAt: body.completed === undefined ? undefined : body.completed ? m.completedAt ?? new Date() : null,
          completedBy: body.completed === undefined ? undefined : body.completed ? auth.userId : null,
        }).where(eq(s.projectMilestones.id, m.id));
        const what = body.completed === true ? `Marco atingido: ${m.name}` : body.completed === false ? `Marco reaberto: ${m.name}` : `Marco alterado: ${m.name}${body.dueOn !== undefined && body.dueOn !== m.dueOn ? ` (prazo ${m.dueOn ?? '—'} → ${body.dueOn ?? '—'})` : ''}`;
        await projectEvent(tx, auth, p.id, 'milestone', what);
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/projects/:id/members',
    summary: 'Define a equipe do projeto (papéis: gerente, membro, observador). O responsável é sempre gerente.',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    body: z.object({ members: z.array(z.object({ userId: z.string().uuid(), role: z.enum(PROJECT_MEMBER_ROLES) })).max(50) }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const { p, can, members } = await loadProject(tx, auth, params.id);
        assertCan(can.manage, 'Só o gerente do projeto pode mudar a equipe.');
        const next = new Map(body.members.map((m) => [m.userId, m.role]));
        next.set(p.ownerId, 'gerente');
        await assertActiveUsers(tx, auth, [...next.keys()]);
        const removed = members.filter((m) => !next.has(m.userId)).map((m) => m.userId);
        if (removed.length) {
          const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.activities).where(and(eq(s.activities.projectId, p.id), inArray(s.activities.ownerId, removed), isNull(s.activities.completedAt), isNull(s.activities.deletedAt)));
          if (n) throw unprocessable(`Quem sai da equipe ainda tem ${n} tarefa(s) em aberto. Reatribua antes.`);
        }
        await tx.delete(s.projectMembers).where(eq(s.projectMembers.projectId, p.id));
        await tx.insert(s.projectMembers).values([...next].map(([userId, role]) => ({ projectId: p.id, userId, tenantId: auth.tenantId, role })));
        await projectEvent(tx, auth, p.id, 'members', `Equipe atualizada (${next.size} pessoa(s))`, { before: members, after: [...next] });
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/projects/:id/tasks',
    summary: 'Cria tarefa no projeto (vira atividade do CRM do responsável)',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    body: TaskBody,
    handler: async ({ app, auth, params, body, reply }) => {
      const r = await app.db.transaction(async (tx) => {
        const { p, can } = await loadProject(tx, auth, params.id);
        assertCan(can.work, 'Observadores não criam tarefas.');
        const ownerId = body.ownerId ?? auth.userId;
        await assertTaskOwner(tx, p.id, p.ownerId, ownerId);
        const stages = await tx.select().from(s.projectStages).where(and(eq(s.projectStages.projectId, p.id), isNull(s.projectStages.archivedAt))).orderBy(asc(s.projectStages.position));
        const stage = body.stageId ? stages.find((x) => x.id === body.stageId) : stages.find((x) => !x.done) ?? stages[0];
        if (!stage) throw unprocessable('Etapa inválida.', [{ path: 'stageId', message: 'Etapa de outro projeto' }]);
        if (body.milestoneId) {
          const [m] = await tx.select({ id: s.projectMilestones.id }).from(s.projectMilestones).where(and(eq(s.projectMilestones.id, body.milestoneId), eq(s.projectMilestones.projectId, p.id), isNull(s.projectMilestones.deletedAt))).limit(1);
          if (!m) throw unprocessable('Marco inválido.', [{ path: 'milestoneId', message: 'Marco de outro projeto' }]);
        }
        if (body.startOn && body.dueOn && body.dueOn < body.startOn) throw unprocessable('O prazo não pode ser antes do início.', [{ path: 'dueOn', message: 'Antes do início' }]);
        const [{ pos } = { pos: 0 }] = await tx.select({ pos: sql<number>`coalesce(max(${s.activities.position}), -1)::int + 1` }).from(s.activities).where(eq(s.activities.projectStageId, stage.id));
        const [a] = await tx.insert(s.activities).values({
          tenantId: auth.tenantId, type: 'tarefa', title: body.title, notes: body.notes ?? null, priority: body.priority, ownerId,
          dueAt: dueAtOf(auth, body.dueOn) as unknown as Date, startOn: body.startOn ?? null, projectId: p.id, projectStageId: stage.id, milestoneId: body.milestoneId ?? null,
          position: pos, contactId: p.contactId, opportunityId: p.opportunityId, contractId: p.contractId, createdBy: auth.userId,
          completedAt: stage.done ? new Date() : null, completedBy: stage.done ? auth.userId : null, status: stage.done ? 'concluida' : 'a_fazer',
        }).returning({ id: s.activities.id });
        await tx.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: a!.id, type: 'created', actorId: auth.userId, payload: { projectId: p.id } });
        return a!;
      });
      reply.code(201);
      return r;
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/projects/:id/tasks/:taskId',
    summary: 'Move a tarefa no quadro (etapa e posição), edita, reatribui ou remove. Etapa concluída conclui a tarefa.',
    tag: 'Projetos',
    module: 'projetos',
    params: z.object({ id: z.string().uuid(), taskId: z.string().uuid() }),
    body: TaskBody.partial().extend({ rowVersion: z.number().int(), position: z.number().int().min(0).optional(), remove: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const { p, can } = await loadProject(tx, auth, params.id);
        assertCan(can.work, 'Observadores não alteram tarefas.');
        const [t] = await tx.select().from(s.activities).where(and(eq(s.activities.id, params.taskId), eq(s.activities.projectId, p.id), isNull(s.activities.deletedAt))).limit(1);
        if (!t) throw notFound('Tarefa não encontrada.');
        if (t.rowVersion !== body.rowVersion) throw conflict(t.rowVersion);
        if (!can.manage && t.ownerId !== auth.userId && body.ownerId && body.ownerId !== t.ownerId) throw unprocessable('Só o gerente do projeto reatribui tarefas de outra pessoa.');
        const events: { type: string; payload: Record<string, unknown> }[] = [];
        if (body.remove) {
          await tx.update(s.activities).set({ deletedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, t.id));
          await tx.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: t.id, type: 'removed', actorId: auth.userId, payload: { projectId: p.id } });
          await projectEvent(tx, auth, p.id, 'task', `Tarefa removida: ${t.title}`);
          return;
        }
        if (body.ownerId && body.ownerId !== t.ownerId) { await assertTaskOwner(tx, p.id, p.ownerId, body.ownerId); events.push({ type: 'assigned', payload: { from: t.ownerId, to: body.ownerId } }); }
        let complete: boolean | undefined;
        if (body.stageId && body.stageId !== t.projectStageId) {
          const [st] = await tx.select().from(s.projectStages).where(and(eq(s.projectStages.id, body.stageId), eq(s.projectStages.projectId, p.id), isNull(s.projectStages.archivedAt))).limit(1);
          if (!st) throw unprocessable('Etapa inválida.', [{ path: 'stageId', message: 'Etapa de outro projeto' }]);
          if (st.wipLimit) {
            const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.activities).where(and(eq(s.activities.projectStageId, st.id), isNull(s.activities.deletedAt)));
            if (n >= st.wipLimit) throw unprocessable(`A etapa "${st.name}" está no limite de ${st.wipLimit} tarefa(s).`);
          }
          events.push({ type: 'moved', payload: { from: t.projectStageId, to: st.id } });
          if (st.done && !t.completedAt && t.status !== 'em_aprovacao') complete = true;
          if (!st.done && (t.completedAt || t.status === 'em_aprovacao')) complete = false;
        }
        if (body.milestoneId) {
          const [m] = await tx.select({ id: s.projectMilestones.id }).from(s.projectMilestones).where(and(eq(s.projectMilestones.id, body.milestoneId), eq(s.projectMilestones.projectId, p.id), isNull(s.projectMilestones.deletedAt))).limit(1);
          if (!m) throw unprocessable('Marco inválido.', [{ path: 'milestoneId', message: 'Marco de outro projeto' }]);
        }
        if (body.dueOn !== undefined) events.push({ type: 'rescheduled', payload: { to: body.dueOn } });
        if (body.title || body.notes !== undefined || body.priority) events.push({ type: 'updated', payload: {} });
        await tx.update(s.activities).set({
          title: body.title, notes: body.notes, priority: body.priority, ownerId: body.ownerId, projectStageId: body.stageId, milestoneId: body.milestoneId,
          startOn: body.startOn, dueAt: body.dueOn === undefined ? undefined : (dueAtOf(auth, body.dueOn) as unknown as Date), position: body.position,
          updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1`,
        }).where(eq(s.activities.id, t.id));
        if (body.position !== undefined) {
          // reordena a coluna de destino sem buracos, mantendo a tarefa movida na posição pedida
          const stageId = body.stageId ?? t.projectStageId;
          const col = await tx.select({ id: s.activities.id }).from(s.activities).where(and(eq(s.activities.projectStageId, stageId!), isNull(s.activities.deletedAt), sql`${s.activities.id} <> ${t.id}`)).orderBy(asc(s.activities.position), asc(s.activities.createdAt));
          const ordered = col.map((c) => c.id);
          ordered.splice(Math.min(body.position, ordered.length), 0, t.id);
          for (const [i, id] of ordered.entries()) await tx.update(s.activities).set({ position: i }).where(eq(s.activities.id, id));
        }
        for (const e of events) await tx.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: t.id, type: e.type, actorId: auth.userId, payload: { ...e.payload, projectId: p.id } });
        if (complete !== undefined) {
          // a conclusão segue as regras da tarefa (dependências, subtarefas, aprovação, recorrência); a coluna escolhida prevalece
          const [fresh] = await tx.select().from(s.activities).where(eq(s.activities.id, t.id)).limit(1);
          await applyStatus(tx, auth, fresh!, complete ? 'concluida' : 'em_andamento');
          await tx.update(s.activities).set({ projectStageId: body.stageId }).where(eq(s.activities.id, t.id));
        }
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/projects/:id/events',
    summary: 'Histórico do projeto',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await loadProject(app.db, auth, params.id);
      const rows = await app.db.select({ e: s.projectEvents, who: s.users.name }).from(s.projectEvents).leftJoin(s.users, eq(s.users.id, s.projectEvents.actorId)).where(and(eq(s.projectEvents.projectId, params.id), eq(s.projectEvents.tenantId, auth.tenantId))).orderBy(desc(s.projectEvents.occurredAt)).limit(300);
      return { items: rows.map(({ e, who }) => ({ id: e.id, type: e.type, summary: e.summary, occurredAt: e.occurredAt, actorName: who })) };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/projects/:id/files',
    summary: 'Documentos do projeto e dos arquivos anexados às tarefas dele',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { p } = await loadProject(app.db, auth, params.id);
      const rows = await app.db
        .select({ id: s.workFiles.id, name: s.workFiles.name, mime: s.workFiles.mime, sizeBytes: s.workFiles.sizeBytes, createdAt: s.workFiles.createdAt, uploadedBy: s.users.name, activityId: s.workFiles.activityId, taskTitle: s.activities.title })
        .from(s.workFiles).leftJoin(s.users, eq(s.users.id, s.workFiles.uploadedBy)).leftJoin(s.activities, eq(s.activities.id, s.workFiles.activityId))
        .where(and(eq(s.workFiles.tenantId, auth.tenantId), isNull(s.workFiles.deletedAt), sql`(${s.workFiles.projectId} = ${p.id} or ${s.activities.projectId} = ${p.id})`))
        .orderBy(desc(s.workFiles.createdAt));
      return { items: rows };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/projects/:id/files',
    summary: 'Anexa documento ao projeto (até 3 MB)',
    tag: 'Projetos',
    module: 'projetos',
    params: IdParams,
    bodyLimit: 5_000_000,
    body: z.object({ name: z.string().trim().min(1).max(200), mime: z.string().max(120), data: z.string().min(1) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const { p, can } = await loadProject(app.db, auth, params.id);
      assertCan(can.work, 'Observadores não anexam documentos.');
      const buf = Buffer.from(body.data, 'base64');
      if (buf.length > 3 * 1024 * 1024) throw unprocessable('Arquivo maior que 3 MB.');
      const [f] = await app.db.insert(s.workFiles).values({ tenantId: auth.tenantId, projectId: p.id, name: body.name, mime: body.mime || 'application/octet-stream', sizeBytes: buf.length, data: buf, uploadedBy: auth.userId }).returning({ id: s.workFiles.id });
      await projectEvent(app.db, auth, p.id, 'file', `Documento anexado: ${body.name}`);
      reply.code(201);
      return f!;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/projects/:id/files/:fileId',
    summary: 'Baixa documento do projeto',
    tag: 'Projetos',
    module: 'projetos',
    params: z.object({ id: z.string().uuid(), fileId: z.string().uuid() }),
    handler: async ({ app, auth, params, reply }) => {
      const { p } = await loadProject(app.db, auth, params.id);
      const [f] = await app.db.select({ f: s.workFiles }).from(s.workFiles).leftJoin(s.activities, eq(s.activities.id, s.workFiles.activityId))
        .where(and(eq(s.workFiles.id, params.fileId), isNull(s.workFiles.deletedAt), sql`(${s.workFiles.projectId} = ${p.id} or ${s.activities.projectId} = ${p.id})`)).limit(1);
      if (!f) throw notFound('Arquivo não encontrado.');
      reply.header('content-type', f.f.mime).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.f.name)}`);
      return reply.send(f.f.data);
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/project-templates',
    summary: 'Modelos de projeto (padrões do sistema e os criados pela empresa)',
    tag: 'Projetos',
    module: 'projetos',
    handler: async ({ app, auth }) => {
      const rows = await app.db.select().from(s.projectTemplates).where(and(eq(s.projectTemplates.tenantId, auth.tenantId), eq(s.projectTemplates.active, true))).orderBy(asc(s.projectTemplates.name));
      return {
        items: [
          ...BUILTIN_PROJECT_TEMPLATES.map((t) => ({ id: null, key: t.key, name: t.name, kind: t.kind, description: t.description, def: t.def, builtin: true })),
          ...rows.map((t) => ({ id: t.id, key: null, name: t.name, kind: t.kind, description: t.description, def: t.def, builtin: false })),
        ],
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/project-templates',
    summary: 'Cria modelo de projeto (definição direta ou a partir de um projeto existente)',
    tag: 'Projetos',
    module: 'projetos',
    min: 'equipe',
    body: z.object({ name: z.string().trim().min(3).max(120), description: z.string().max(1000).nullable().optional(), kind: z.enum(PROJECT_KINDS).default('interno'), def: TemplateDef.optional(), fromProjectId: z.string().uuid().optional() }),
    handler: async ({ app, auth, body, reply }) => {
      let def: ProjectTemplateDef | undefined = body.def;
      if (body.fromProjectId) {
        const { p } = await loadProject(app.db, auth, body.fromProjectId);
        const [stages, milestones, tasks] = await Promise.all([
          app.db.select().from(s.projectStages).where(and(eq(s.projectStages.projectId, p.id), isNull(s.projectStages.archivedAt))).orderBy(asc(s.projectStages.position)),
          app.db.select().from(s.projectMilestones).where(and(eq(s.projectMilestones.projectId, p.id), isNull(s.projectMilestones.deletedAt))),
          projectTasks(app.db, auth, [p.id]),
        ]);
        def = templateFromProject({ startOn: p.startOn, stages, milestones, tasks: tasks.map((t) => ({ title: t.title, stageId: t.stageId, milestoneId: t.milestoneId, startOn: t.startOn, dueOn: t.dueOn, priority: t.priority, notes: t.notes })) });
      }
      if (!def) throw unprocessable('Informe a definição do modelo ou o projeto de origem.');
      const errs = validateTemplate(def);
      if (errs.length) throw unprocessable(errs[0]!, errs.map((m) => ({ path: 'def', message: m })));
      const [t] = await app.db.insert(s.projectTemplates).values({ tenantId: auth.tenantId, name: body.name, description: body.description ?? null, kind: body.kind, def, createdBy: auth.userId }).returning({ id: s.projectTemplates.id });
      reply.code(201);
      return t!;
    },
  }),

  defineRoute({
    method: 'DELETE',
    url: '/project-templates/:id',
    summary: 'Desativa modelo da empresa (projetos já criados não mudam)',
    tag: 'Projetos',
    module: 'projetos',
    min: 'equipe',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const r = await app.db.update(s.projectTemplates).set({ active: false }).where(and(eq(s.projectTemplates.id, params.id), eq(s.projectTemplates.tenantId, auth.tenantId))).returning({ id: s.projectTemplates.id });
      if (!r.length) throw notFound('Modelo não encontrado.');
      return { ok: true };
    },
  }),
];

export { syncTaskStage };
