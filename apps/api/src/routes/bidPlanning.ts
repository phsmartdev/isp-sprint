/**
 * Licitações · L2: planejamento do projeto de licitação. Marcos oficiais do edital (sessão e envio da proposta ficam
 * nos campos da oportunidade, sem duplicar), prazos calculados para trás a partir deles com margem de segurança,
 * tabela editável (em linha e em lote), dependências e as pendências que impedem liberar o plano.
 * Editar o projeto não muda o modelo. Toda alteração fica no histórico do projeto.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BID_AREAS, OFFICIAL_DATES, OFFICIAL_KEYS, OFFICIAL_LABEL, anchoredDates, createsCycle, isCriticalChange, planIssues, type OfficialDates, type PlanRow, type ProjectTaskSpec } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { bumpVersion } from '../services/opportunities';
import { level } from '../services/scope';
import { dueAtOf, projectEvent } from '../services/projects';
import { oppProject } from './bidProjects';

const OPP = { tag: 'Licitações', module: 'oportunidades' as const };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
type Proj = Awaited<ReturnType<typeof oppProject>>;

/** Planeja: coordenador, responsável da oportunidade, quem administra Projetos ou a administração. */
export async function canPlanProject(db: DbOrTx, auth: AuthContext, p: Proj) {
  if (p.ownerId === auth.userId || auth.access.configuracoes === 'total' || level(auth, 'projetos') === 'total') return true;
  const [o] = await db.select({ ownerId: s.opportunities.ownerId }).from(s.opportunities).where(eq(s.opportunities.id, p.opportunityId!)).limit(1);
  return o?.ownerId === auth.userId;
}
async function assertPlan(db: DbOrTx, auth: AuthContext, p: Proj) {
  if (!(await canPlanProject(db, auth, p))) throw forbidden('O planejamento é do coordenador do projeto ou do responsável pela oportunidade.');
  if (p.status === 'cancelado' || p.status === 'concluido') throw unprocessable('Projeto encerrado não se replaneja.');
}
/** Plano em aprovação não muda no que é crítico; plano aprovado alterado no que é crítico volta para aprovação (alteração crítica). */
export async function guardCritical(tx: DbOrTx, auth: AuthContext, p: Proj, critical: boolean, what: string) {
  if (!critical) return;
  const [cur] = await tx.select({ planStatus: s.projects.planStatus }).from(s.projects).where(eq(s.projects.id, p.id)).for('update');
  if (cur!.planStatus === 'aguardando') throw unprocessable('O plano está em aprovação: cancele o pedido para alterar datas, responsáveis ou tarefas obrigatórias.');
  if (cur!.planStatus === 'aprovado') {
    await tx.update(s.projects).set({ planStatus: 'alterado', updatedAt: new Date() }).where(eq(s.projects.id, p.id));
    await projectEvent(tx, auth, p.id, 'alteracao_critica', `Plano aprovado alterado (${what}): precisa de aprovação da alteração crítica.`);
  }
}

/** Marcos oficiais: sessão e envio da proposta vêm da oportunidade; a validação fica no projeto (perde-se se a data mudar). */
export async function officialOf(db: DbOrTx, p: Proj): Promise<OfficialDates> {
  const [o] = await db.select({ custom: s.opportunities.custom }).from(s.opportunities).where(eq(s.opportunities.id, p.opportunityId!)).limit(1);
  const custom = (o?.custom ?? {}) as Record<string, unknown>;
  const out: OfficialDates = {};
  for (const d of OFFICIAL_DATES) {
    const saved = p.officialDates[d.key];
    if ('crmField' in d) {
      const v = typeof custom[d.crmField] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(custom[d.crmField] as string) ? (custom[d.crmField] as string) : null;
      out[d.key] = { date: v, validated: !!saved?.validated && saved.date === v, source: saved?.date === v ? saved?.source ?? 'CRM' : v ? 'CRM' : null, validatedBy: saved?.date === v ? saved?.validatedBy ?? null : null, validatedAt: saved?.date === v ? saved?.validatedAt ?? null : null };
    } else out[d.key] = saved ?? { date: null, validated: false, source: null };
  }
  return out;
}

export async function planRows(db: DbOrTx, auth: AuthContext, projectId: string) {
  const rows = await db.select({
    id: s.activities.id, parentId: s.activities.parentId, title: s.activities.title, ownerId: s.activities.ownerId, ownerName: s.users.name, startOn: s.activities.startOn,
    dueOn: sql<string | null>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')`, completedAt: s.activities.completedAt, status: s.activities.status,
    spec: s.activities.spec, milestoneId: s.activities.milestoneId, position: s.activities.position, notes: s.activities.notes, rowVersion: s.activities.rowVersion,
  }).from(s.activities).innerJoin(s.users, eq(s.users.id, s.activities.ownerId))
    .where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.projectId, projectId), isNull(s.activities.deletedAt))).orderBy(asc(s.activities.position), asc(s.activities.createdAt));
  const deps = rows.length ? await db.select({ from: s.activityDependencies.activityId, to: s.activityDependencies.dependsOnId }).from(s.activityDependencies).where(inArray(s.activityDependencies.activityId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({ ...r, done: !!r.completedAt || r.status === 'cancelada', dependsOn: deps.filter((d) => d.from === r.id).map((d) => d.to) }));
}

async function plan(db: DbOrTx, auth: AuthContext, p: Proj) {
  const [dates, rows, ms] = await Promise.all([
    officialOf(db, p), planRows(db, auth, p.id),
    db.select({ id: s.projectMilestones.id, name: s.projectMilestones.name, dueOn: s.projectMilestones.dueOn, position: s.projectMilestones.position, acceptanceCriteria: s.projectMilestones.acceptanceCriteria })
      .from(s.projectMilestones).where(and(eq(s.projectMilestones.projectId, p.id), isNull(s.projectMilestones.deletedAt))).orderBy(asc(s.projectMilestones.position)),
  ]);
  const issues = planIssues(rows.map((r) => ({ id: r.id, parentId: r.parentId, title: r.title, ownerId: r.ownerId, startOn: r.startOn, dueOn: r.dueOn, done: r.done, spec: r.spec as ProjectTaskSpec | null, dependsOn: r.dependsOn }) satisfies PlanRow), dates, p.ownerId);
  // recálculo pelo edital: o que mudaria (só aplica com confirmação)
  const recalc = rows.filter((r) => !r.parentId && !r.done).flatMap((r) => {
    const a = anchoredDates((r.spec ?? {}) as ProjectTaskSpec, dates, p.marginDays);
    return a && (a.dueOn !== r.dueOn || a.startOn !== r.startOn) ? [{ id: r.id, title: r.title, from: { startOn: r.startOn, dueOn: r.dueOn }, to: a }] : [];
  });
  return { project: { id: p.id, code: p.code, name: p.name, status: p.status, coordinatorId: p.ownerId, marginDays: p.marginDays, planStatus: p.planStatus, goDecision: p.goDecision, opportunityId: p.opportunityId, templateVersion: p.templateVersion }, canPlan: await canPlanProject(db, auth, p), officialDates: dates, phases: ms, rows, issues, recalc };
}

const RowPatch = z.object({
  title: z.string().trim().min(2).max(200).optional(), ownerId: z.string().uuid().optional(), startOn: day.nullable().optional(), dueOn: day.nullable().optional(),
  area: z.enum(BID_AREAS).optional(), required: z.boolean().optional(), deliverable: z.string().trim().max(500).nullable().optional(), acceptance: z.string().trim().max(1000).nullable().optional(),
  approverId: z.string().uuid().nullable().optional(), docs: z.string().trim().max(1000).nullable().optional(), notes: z.string().max(4000).nullable().optional(),
  anchor: z.enum(OFFICIAL_KEYS as [string, ...string[]]).nullable().optional(), anchorOffsetDays: z.number().int().min(-365).max(365).optional(), durationDays: z.number().int().min(0).max(365).optional(),
  milestoneId: z.string().uuid().optional(),
  consulted: z.array(z.string().uuid()).max(20).optional(), informed: z.array(z.string().uuid()).max(30).optional(),
});

export const bidPlanningRoutes = [
  defineRoute({
    method: 'GET', url: '/projects/:id/licitacao/plano', summary: 'Planejamento: marcos do edital, tabela de etapas/macrotarefas/tarefas, dependências, pendências e recálculo pelo edital', ...OPP, params: IdParams,
    handler: async ({ app, auth, params }) => plan(app.db, auth, await oppProject(app, auth, params.id)),
  }),
  defineRoute({
    method: 'PUT', url: '/projects/:id/licitacao/datas', summary: 'Marcos oficiais do edital (validados pelo analista) e a margem de segurança. Sessão e envio da proposta gravam na oportunidade.', ...OPP, params: IdParams,
    body: z.object({ dates: z.record(z.enum(OFFICIAL_KEYS as [string, ...string[]]), z.object({ date: day.nullable(), validated: z.boolean(), source: z.string().trim().max(200).nullable().default(null) })), marginDays: z.number().int().min(0).max(30).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const p = await oppProject(app, auth, params.id);
      await assertPlan(app.db, auth, p);
      const before = await officialOf(app.db, p);
      await app.db.transaction(async (tx) => {
        const next: OfficialDates = { ...p.officialDates };
        const crm: Record<string, string | null> = {};
        const changes: string[] = [];
        for (const [k, v] of Object.entries(body.dates) as [keyof OfficialDates, { date: string | null; validated: boolean; source: string | null }][]) {
          if (v.validated && !v.date) throw unprocessable(`Informe a data de "${OFFICIAL_LABEL[k]}" antes de validar.`, [{ path: `dates.${k}`, message: 'Sem data' }]);
          const old = before[k];
          const keep = old?.validated && old.date === v.date && v.validated;
          next[k] = { date: v.date, validated: v.validated, source: v.source ?? old?.source ?? null, validatedBy: keep ? old?.validatedBy ?? null : v.validated ? auth.userId : null, validatedAt: keep ? old?.validatedAt ?? null : v.validated ? new Date().toISOString() : null };
          const def = OFFICIAL_DATES.find((d) => d.key === k)!;
          if ('crmField' in def && (old?.date ?? null) !== v.date) crm[def.crmField] = v.date;
          if ((old?.date ?? null) !== v.date) changes.push(`${OFFICIAL_LABEL[k]}: ${old?.date ?? '—'} → ${v.date ?? '—'}`);
          else if (!!old?.validated !== v.validated) changes.push(`${OFFICIAL_LABEL[k]} ${v.validated ? 'validada com o edital' : 'deixou de estar validada'}`);
        }
        await tx.update(s.projects).set({ officialDates: next, ...(body.marginDays !== undefined ? { marginDays: body.marginDays } : {}), updatedAt: new Date() }).where(eq(s.projects.id, p.id));
        if (Object.keys(crm).length) {
          await tx.update(s.opportunities).set({ custom: sql`coalesce(${s.opportunities.custom}, '{}'::jsonb) || ${JSON.stringify(crm)}::jsonb`, updatedAt: new Date(), rowVersion: bumpVersion() }).where(eq(s.opportunities.id, p.opportunityId!));
          await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: p.opportunityId!, type: 'updated', actorId: auth.userId, payload: { changes: Object.fromEntries(Object.entries(crm).map(([k, v]) => [`custom.${k}`, { to: v }])), via: 'projeto_licitacao' } });
        }
        if (body.marginDays !== undefined && body.marginDays !== p.marginDays) changes.push(`Margem de segurança: ${p.marginDays} → ${body.marginDays} dia(s)`);
        if (changes.length) await projectEvent(tx, auth, p.id, 'marcos_edital', `Marcos do edital: ${changes.join('; ')}.`, { changes });
      });
      await audit(app.db, req, { action: 'bid.plan.dates', entityType: 'project', entityId: p.id });
      const [fresh] = await app.db.select().from(s.projects).where(eq(s.projects.id, p.id)).limit(1);
      return plan(app.db, auth, fresh!);
    },
  }),
  defineRoute({
    method: 'POST', url: '/projects/:id/licitacao/recalcular', summary: 'Aplica os prazos calculados pelo edital nas tarefas escolhidas (depois de conferir a prévia)', ...OPP, params: IdParams,
    body: z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }),
    handler: async ({ app, auth, params, body, req }) => {
      const p = await oppProject(app, auth, params.id);
      await assertPlan(app.db, auth, p);
      const cur = await plan(app.db, auth, p);
      const pick = cur.recalc.filter((r) => body.ids.includes(r.id));
      await app.db.transaction(async (tx) => {
        await guardCritical(tx, auth, p, pick.length > 0, 'prazos recalculados pelo edital');
        for (const r of pick) await tx.update(s.activities).set({ startOn: r.to.startOn, dueAt: dueAtOf(auth, r.to.dueOn) as unknown as Date, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, r.id));
        if (pick.length) await projectEvent(tx, auth, p.id, 'recalculo', `Prazos recalculados pelo edital em ${pick.length} macrotarefa(s).`, { tasks: pick.map((r) => ({ id: r.id, from: r.from, to: r.to })) });
      });
      await audit(app.db, req, { action: 'bid.plan.recalc', entityType: 'project', entityId: p.id, metadata: { n: pick.length } });
      return plan(app.db, auth, p);
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/projects/:id/licitacao/tarefas', summary: 'Edita uma ou várias tarefas do plano (em linha ou em lote; deslocar datas em N dias)', ...OPP, params: IdParams,
    body: z.object({ ids: z.array(z.string().uuid()).min(1).max(500), patch: RowPatch, shiftDays: z.number().int().min(-365).max(365).optional(), rowVersions: z.record(z.string(), z.number().int()).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const p = await oppProject(app, auth, params.id);
      await assertPlan(app.db, auth, p);
      const pt = body.patch;
      if (pt.ownerId || pt.approverId || pt.consulted?.length || pt.informed?.length) {
        const ids = [...new Set([pt.ownerId, pt.approverId, ...(pt.consulted ?? []), ...(pt.informed ?? [])].filter(Boolean) as string[])];
        const us = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, ids), eq(s.users.active, true)));
        if (us.length !== ids.length) throw unprocessable('Pessoa inválida ou inativa.');
      }
      if (pt.milestoneId) {
        const [m] = await app.db.select({ id: s.projectMilestones.id }).from(s.projectMilestones).where(and(eq(s.projectMilestones.projectId, p.id), eq(s.projectMilestones.id, pt.milestoneId))).limit(1);
        if (!m) throw unprocessable('Etapa inválida.');
      }
      await app.db.transaction(async (tx) => {
        const rows = await tx.select().from(s.activities).where(and(eq(s.activities.projectId, p.id), inArray(s.activities.id, body.ids), isNull(s.activities.deletedAt))).for('update');
        if (rows.length !== new Set(body.ids).size) throw notFound('Tarefa não encontrada neste projeto.');
        await guardCritical(tx, auth, p, rows.some((r) => isCriticalChange(pt as Record<string, unknown>, !!(r.spec as ProjectTaskSpec | null)?.required, body.shiftDays)), rows.length === 1 ? `"${rows[0]!.title}"` : `${rows.length} tarefas`);
        for (const r of rows) {
          const rv = body.rowVersions?.[r.id];
          if (rv !== undefined && rv !== r.rowVersion) throw conflict(r.rowVersion);
          const spec = { ...((r.spec ?? { phaseKey: '', sourceKey: null, area: 'comercial', required: false, deliverable: null, acceptance: null, instructions: null }) as ProjectTaskSpec) };
          for (const k of ['area', 'required', 'deliverable', 'acceptance', 'approverId', 'docs', 'anchor', 'anchorOffsetDays', 'durationDays', 'consulted', 'informed'] as const) if (pt[k] !== undefined) (spec as Record<string, unknown>)[k] = pt[k];
          if (pt.ownerId) spec.assigned = true;
          let startOn = pt.startOn !== undefined ? pt.startOn : r.startOn;
          let dueOn: string | null | undefined = pt.dueOn;
          if (body.shiftDays) {
            const sh = (d: string | null) => (d ? new Date(Date.parse(`${d}T12:00:00Z`) + body.shiftDays! * 86_400_000).toISOString().slice(0, 10) : d);
            startOn = sh(startOn);
            const [cur] = (await tx.execute<{ d: string | null }>(sql`select to_char(${r.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD') as d`)).rows;
            dueOn = sh(cur?.d ?? null);
          }
          if (startOn && dueOn && dueOn < startOn) throw unprocessable(`"${r.title}": a entrega não pode ser antes do início.`);
          await tx.update(s.activities).set({
            ...(pt.title ? { title: pt.title } : {}), ...(pt.ownerId ? { ownerId: pt.ownerId } : {}), ...(pt.notes !== undefined ? { notes: pt.notes } : {}), ...(pt.milestoneId ? { milestoneId: pt.milestoneId } : {}),
            startOn, ...(dueOn !== undefined ? { dueAt: dueAtOf(auth, dueOn) as unknown as Date } : {}), spec, updatedAt: new Date(), rowVersion: r.rowVersion + 1,
          }).where(eq(s.activities.id, r.id));
        }
        const what = Object.keys(pt).filter((k) => (pt as Record<string, unknown>)[k] !== undefined).concat(body.shiftDays ? [`datas ${body.shiftDays > 0 ? '+' : ''}${body.shiftDays}d`] : []);
        await projectEvent(tx, auth, p.id, 'plano', `Plano: ${rows.length === 1 ? `"${rows[0]!.title}"` : `${rows.length} tarefas`} — ${what.join(', ')}.`, { ids: body.ids, patch: pt, shiftDays: body.shiftDays ?? null });
      });
      await audit(app.db, req, { action: 'bid.plan.edit', entityType: 'project', entityId: p.id, metadata: { n: body.ids.length } });
      return plan(app.db, auth, p);
    },
  }),
  defineRoute({
    method: 'POST', url: '/projects/:id/licitacao/tarefas', summary: 'Inclui macrotarefa (numa etapa) ou tarefa (dentro de uma macrotarefa) só neste projeto', ...OPP, params: IdParams,
    body: z.object({ milestoneId: z.string().uuid().optional(), parentId: z.string().uuid().optional(), title: z.string().trim().min(2).max(200), area: z.enum(BID_AREAS).default('comercial'), required: z.boolean().default(false), deliverable: z.string().trim().max(500).nullable().default(null), acceptance: z.string().trim().max(1000).nullable().default(null), startOn: day.nullable().default(null), dueOn: day.nullable().default(null) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const p = await oppProject(app, auth, params.id);
      await assertPlan(app.db, auth, p);
      const id = await app.db.transaction(async (tx) => {
        let milestoneId = body.milestoneId ?? null, phaseKey = '';
        let parent: typeof s.activities.$inferSelect | undefined;
        if (body.parentId) {
          [parent] = await tx.select().from(s.activities).where(and(eq(s.activities.projectId, p.id), eq(s.activities.id, body.parentId), isNull(s.activities.deletedAt), isNull(s.activities.parentId))).limit(1);
          if (!parent) throw notFound('Macrotarefa não encontrada.');
          milestoneId = parent.milestoneId; phaseKey = (parent.spec as ProjectTaskSpec | null)?.phaseKey ?? '';
        } else if (!milestoneId) throw unprocessable('Escolha a etapa.', [{ path: 'milestoneId', message: 'Obrigatória' }]);
        else {
          const [m] = await tx.select({ id: s.projectMilestones.id }).from(s.projectMilestones).where(and(eq(s.projectMilestones.projectId, p.id), eq(s.projectMilestones.id, milestoneId))).limit(1);
          if (!m) throw unprocessable('Etapa inválida.');
          const [sib] = await tx.select({ spec: s.activities.spec }).from(s.activities).where(and(eq(s.activities.projectId, p.id), eq(s.activities.milestoneId, milestoneId), isNull(s.activities.parentId))).limit(1);
          phaseKey = (sib?.spec as ProjectTaskSpec | null)?.phaseKey ?? '';
        }
        const [stage] = await tx.select({ id: s.projectStages.id }).from(s.projectStages).where(eq(s.projectStages.projectId, p.id)).orderBy(asc(s.projectStages.position)).limit(1);
        const [{ pos } = { pos: 0 }] = await tx.select({ pos: sql<number>`coalesce(max(${s.activities.position}), 0)::int + 1` }).from(s.activities).where(and(eq(s.activities.projectId, p.id), body.parentId ? eq(s.activities.parentId, body.parentId) : isNull(s.activities.parentId)));
        const [a] = await tx.insert(s.activities).values({
          tenantId: auth.tenantId, type: 'tarefa', title: body.title, priority: body.required ? 'alta' : 'media', ownerId: parent?.ownerId ?? p.ownerId, projectId: p.id, projectStageId: stage!.id, milestoneId,
          parentId: body.parentId ?? null, startOn: body.startOn, dueAt: dueAtOf(auth, body.dueOn) as unknown as Date, position: pos, createdBy: auth.userId,
          spec: { phaseKey, sourceKey: null, area: parent ? ((parent.spec as ProjectTaskSpec | null)?.area ?? body.area) : body.area, required: body.required, deliverable: body.deliverable, acceptance: body.acceptance, instructions: null } satisfies ProjectTaskSpec,
        }).returning({ id: s.activities.id });
        await projectEvent(tx, auth, p.id, 'plano', `Incluída ${body.parentId ? 'tarefa' : 'macrotarefa'} "${body.title}" (só neste projeto).`, { id: a!.id });
        return a!.id;
      });
      await audit(app.db, req, { action: 'bid.plan.add', entityType: 'project', entityId: p.id, metadata: { taskId: id } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/projects/:id/licitacao/tarefas/:taskId', summary: 'Exclui tarefa não obrigatória do projeto (fica no histórico)', ...OPP, params: z.object({ id: z.string().uuid(), taskId: z.string().uuid() }),
    handler: async ({ app, auth, params, req }) => {
      const p = await oppProject(app, auth, params.id);
      await assertPlan(app.db, auth, p);
      await app.db.transaction(async (tx) => {
        const [t] = await tx.select().from(s.activities).where(and(eq(s.activities.projectId, p.id), eq(s.activities.id, params.taskId), isNull(s.activities.deletedAt))).limit(1);
        if (!t) throw notFound('Tarefa não encontrada.');
        if ((t.spec as ProjectTaskSpec | null)?.required) throw unprocessable('Tarefa obrigatória não se exclui. Desmarque "obrigatória" antes, se o edital permitir.');
        const deps = await tx.select({ n: sql<number>`count(*)::int` }).from(s.activityDependencies).where(eq(s.activityDependencies.dependsOnId, t.id));
        if (deps[0]!.n) throw unprocessable('Outras tarefas dependem desta. Retire a dependência antes.');
        await guardCritical(tx, auth, p, true, `exclusão de "${t.title}"`);
        await tx.update(s.activities).set({ deletedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(and(eq(s.activities.projectId, p.id), sql`(${s.activities.id} = ${t.id} or ${s.activities.parentId} = ${t.id})`));
        await projectEvent(tx, auth, p.id, 'plano', `Excluída a ${t.parentId ? 'tarefa' : 'macrotarefa'} "${t.title}".`, { id: t.id });
      });
      await audit(app.db, req, { action: 'bid.plan.remove', entityType: 'project', entityId: p.id, metadata: { taskId: params.taskId } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/projects/:id/licitacao/tarefas/:taskId/dependencias', summary: 'Define as predecessoras da tarefa (dentro do projeto, sem ciclos)', ...OPP, params: z.object({ id: z.string().uuid(), taskId: z.string().uuid() }),
    body: z.object({ dependsOn: z.array(z.string().uuid()).max(20) }),
    handler: async ({ app, auth, params, body, req }) => {
      const p = await oppProject(app, auth, params.id);
      await assertPlan(app.db, auth, p);
      await app.db.transaction(async (tx) => {
        const ids = [params.taskId, ...body.dependsOn];
        const rows = await tx.select({ id: s.activities.id, title: s.activities.title }).from(s.activities).where(and(eq(s.activities.projectId, p.id), inArray(s.activities.id, ids), isNull(s.activities.deletedAt)));
        if (rows.length !== new Set(ids).size) throw unprocessable('As tarefas precisam ser deste projeto.');
        const all = await tx.select({ from: s.activityDependencies.activityId, to: s.activityDependencies.dependsOnId }).from(s.activityDependencies).innerJoin(s.activities, eq(s.activities.id, s.activityDependencies.activityId)).where(eq(s.activities.projectId, p.id));
        const edges = all.filter((e) => e.from !== params.taskId);
        for (const d of body.dependsOn) {
          if (createsCycle(edges, params.taskId, d)) throw unprocessable(`Depender de "${rows.find((r) => r.id === d)?.title}" criaria um ciclo.`);
          edges.push({ from: params.taskId, to: d });
        }
        await guardCritical(tx, auth, p, true, 'dependências');
        await tx.delete(s.activityDependencies).where(eq(s.activityDependencies.activityId, params.taskId));
        if (body.dependsOn.length) await tx.insert(s.activityDependencies).values(body.dependsOn.map((d) => ({ tenantId: auth.tenantId, activityId: params.taskId, dependsOnId: d, createdBy: auth.userId })));
        const t = rows.find((r) => r.id === params.taskId)!;
        await projectEvent(tx, auth, p.id, 'plano', `Dependências de "${t.title}": ${body.dependsOn.length ? body.dependsOn.map((d) => `"${rows.find((r) => r.id === d)?.title}"`).join(', ') : 'nenhuma'}.`, { id: t.id, dependsOn: body.dependsOn });
      });
      await audit(app.db, req, { action: 'bid.plan.deps', entityType: 'project', entityId: p.id });
      return plan(app.db, auth, p);
    },
  }),
];
