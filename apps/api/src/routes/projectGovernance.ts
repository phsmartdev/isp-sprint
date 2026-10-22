/**
 * Etapa 1 · Fase 2 — governança de projetos: riscos, impedimentos (o mesmo registro dos rituais da Gestão de Times,
 * ligado ao projeto, marco ou tarefa), homologação de marcos (append-only, nunca pelo autor) e o painel das frentes
 * com progresso real por marcos homologados. Criação das frentes de uma iniciativa a partir do modelo.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  BUILTIN_PROJECT_TEMPLATES, HOMOLOGATION_DECISIONS, OPEN_RISK, RISK_IMPACTS, RISK_PROBABILITIES, RISK_STATUSES, frontSummary, frontsErrors, homologationError,
  impedimentTransition, instantiateTemplate, riskErrors, riskLevel, type ImpedimentStatus, type RiskImpact, type RiskProbability, type RiskStatus,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { assertCan, dueAtOf, loadProject, projectEvent, projectScope, projectTasks, todayLocal } from '../services/projects';
import { gov } from './rituals';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const OPEN_IMP = ['aberto', 'em_tratamento'];
const RiskParams = z.object({ id: z.string().uuid(), riskId: z.string().uuid() });
const ImpParams = z.object({ id: z.string().uuid(), impId: z.string().uuid() });
const MsParams = z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() });

async function activeUser(db: DbOrTx, auth: AuthContext, id: string) {
  const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, id), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).limit(1);
  if (!u) throw unprocessable('Pessoa inválida.', [{ path: 'ownerId', message: 'Usuário inativo ou de outra empresa' }]);
}

const RiskBody = z.object({
  title: z.string().trim().max(200), description: z.string().trim().max(2000).nullable().optional(), probability: z.enum(RISK_PROBABILITIES), impact: z.enum(RISK_IMPACTS),
  mitigation: z.string().trim().max(2000).nullable().optional(), ownerId: z.string().uuid(), reviewOn: isoDate.nullable().optional(),
});

export const projectGovernanceRoutes = [
  defineRoute({
    method: 'GET', url: '/projects/:id/governance', summary: 'Riscos, impedimentos e histórico de homologação do projeto, com o resumo da frente', tag: 'Projetos', module: 'projetos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { p, can } = await loadProject(app.db, auth, params.id);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
      const risks = await app.db.select().from(s.projectRisks).where(eq(s.projectRisks.projectId, p.id)).orderBy(desc(s.projectRisks.createdAt));
      const imps = await app.db.select().from(s.impediments).where(and(eq(s.impediments.tenantId, auth.tenantId), eq(s.impediments.projectId, p.id))).orderBy(desc(s.impediments.createdAt));
      const homs = await app.db.select().from(s.milestoneHomologations).where(eq(s.milestoneHomologations.projectId, p.id)).orderBy(desc(s.milestoneHomologations.createdAt));
      const ms = await app.db.select().from(s.projectMilestones).where(and(eq(s.projectMilestones.projectId, p.id), isNull(s.projectMilestones.deletedAt)));
      const tasks = await projectTasks(app.db, auth, [p.id]);
      const today = todayLocal(auth);
      return {
        can: { manage: can.manage, work: can.work, homologate: can.manage || level(auth, 'projetos') === 'total' },
        summary: frontSummary(
          ms.map((m) => ({ id: m.id, name: m.name, dueOn: m.dueOn, position: m.position, completedAt: m.completedAt?.toISOString() ?? null, requiresHomologation: m.requiresHomologation, homologatedAt: m.homologatedAt?.toISOString() ?? null })),
          tasks.map((t) => ({ id: t.id, title: t.title, milestoneId: t.milestoneId, done: !!t.completedAt, dueOn: t.dueOn, ownerName: t.ownerName })),
          imps.map((i) => ({ severity: i.severity, open: OPEN_IMP.includes(i.status) })),
          risks.map((r) => ({ level: riskLevel(r.probability as RiskProbability, r.impact as RiskImpact), open: OPEN_RISK.includes(r.status as RiskStatus) })),
          today,
        ),
        risks: risks.map((r) => ({ ...r, level: riskLevel(r.probability as RiskProbability, r.impact as RiskImpact), ownerName: name(r.ownerId), canEdit: can.manage || r.ownerId === auth.userId || r.createdBy === auth.userId })),
        impediments: imps.map((i) => ({ ...i, ownerName: name(i.ownerId), milestoneName: ms.find((m) => m.id === i.milestoneId)?.name ?? null, overdue: OPEN_IMP.includes(i.status) && !!i.dueOn && i.dueOn < today, canEdit: can.manage || i.ownerId === auth.userId || i.raisedBy === auth.userId })),
        homologations: homs.map((h) => ({ ...h, actorName: name(h.actorId), milestoneName: ms.find((m) => m.id === h.milestoneId)?.name ?? '?' })),
      };
    },
  }),

  // ---------------------------------------------------------------- riscos
  defineRoute({
    method: 'POST', url: '/projects/:id/risks', summary: 'Registra risco (probabilidade × impacto; alto ou crítico exige mitigação)', tag: 'Projetos', module: 'projetos', params: IdParams, body: RiskBody,
    handler: async ({ app, auth, params, body, reply }) => app.db.transaction(async (tx) => {
      const { p, can } = await loadProject(tx, auth, params.id);
      assertCan(can.work, 'Só quem trabalha no projeto registra riscos.');
      const errs = riskErrors({ ...body, mitigation: body.mitigation ?? null, status: 'aberto' });
      if (errs.length) throw unprocessable(errs[0]!);
      await activeUser(tx, auth, body.ownerId);
      const [r] = await tx.insert(s.projectRisks).values({ tenantId: auth.tenantId, projectId: p.id, title: body.title, description: body.description ?? null, probability: body.probability, impact: body.impact, mitigation: body.mitigation ?? null, ownerId: body.ownerId, reviewOn: body.reviewOn ?? null, createdBy: auth.userId }).returning({ id: s.projectRisks.id });
      await projectEvent(tx, auth, p.id, 'risco', `Risco registrado: ${body.title} (${riskLevel(body.probability, body.impact)})`, { riskId: r!.id });
      reply.code(201);
      return r;
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/projects/:id/risks/:riskId', summary: 'Atualiza o risco: avaliação, mitigação, responsável ou situação', tag: 'Projetos', module: 'projetos', params: RiskParams,
    body: RiskBody.partial().extend({ rowVersion: z.number().int(), status: z.enum(RISK_STATUSES).optional(), note: z.string().trim().max(1000).optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { p, can } = await loadProject(tx, auth, params.id);
      const [r] = await tx.select().from(s.projectRisks).where(and(eq(s.projectRisks.id, params.riskId), eq(s.projectRisks.projectId, p.id))).limit(1);
      if (!r) throw notFound('Risco não encontrado.');
      assertCan(can.manage || r.ownerId === auth.userId || r.createdBy === auth.userId, 'Só o responsável pelo risco, quem registrou ou o gerente do projeto altera o risco.');
      if (r.rowVersion !== body.rowVersion) throw conflict(r.rowVersion);
      const next = { title: body.title ?? r.title, mitigation: body.mitigation !== undefined ? body.mitigation : r.mitigation, status: (body.status ?? r.status) as RiskStatus, probability: (body.probability ?? r.probability) as RiskProbability, impact: (body.impact ?? r.impact) as RiskImpact };
      const errs = riskErrors(next);
      if (errs.length) throw unprocessable(errs[0]!);
      if (body.status === 'encerrado' && (body.note ?? '').length < 5) throw unprocessable('Diga por que o risco foi encerrado.');
      if (body.ownerId) await activeUser(tx, auth, body.ownerId);
      await tx.update(s.projectRisks).set({
        title: next.title, description: body.description !== undefined ? body.description : r.description, probability: next.probability, impact: next.impact, mitigation: next.mitigation,
        ownerId: body.ownerId ?? r.ownerId, reviewOn: body.reviewOn !== undefined ? body.reviewOn : r.reviewOn, status: next.status, closedAt: next.status === 'encerrado' ? r.closedAt ?? new Date() : null,
        updatedAt: new Date(), rowVersion: r.rowVersion + 1,
      }).where(eq(s.projectRisks.id, r.id));
      if (body.status && body.status !== r.status) await projectEvent(tx, auth, p.id, 'risco', `Risco "${r.title}": ${r.status} → ${body.status}${body.note ? ` (${body.note})` : ''}`, { riskId: r.id });
      else await projectEvent(tx, auth, p.id, 'risco', `Risco atualizado: ${next.title} (${riskLevel(next.probability, next.impact)})`, { riskId: r.id });
      return { ok: true };
    }),
  }),

  // ---------------------------------------------------------------- impedimentos (mesmo registro dos rituais)
  defineRoute({
    method: 'POST', url: '/projects/:id/impediments', summary: 'Registra impedimento do projeto (aparece também em Gestão de Times → Decisões e impedimentos)', tag: 'Projetos', module: 'projetos', params: IdParams,
    body: z.object({ title: z.string().trim().min(5).max(200), description: z.string().trim().max(2000).nullable().optional(), severity: z.enum(['alta', 'media', 'baixa']).default('media'), ownerId: z.string().uuid(), dueOn: isoDate.nullable().optional(), milestoneId: z.string().uuid().nullable().optional(), taskId: z.string().uuid().nullable().optional() }),
    handler: async ({ app, auth, params, body, reply }) => app.db.transaction(async (tx) => {
      const { p, can } = await loadProject(tx, auth, params.id);
      assertCan(can.work, 'Só quem trabalha no projeto registra impedimentos.');
      await activeUser(tx, auth, body.ownerId);
      if (body.milestoneId) { const [m] = await tx.select({ id: s.projectMilestones.id }).from(s.projectMilestones).where(and(eq(s.projectMilestones.id, body.milestoneId), eq(s.projectMilestones.projectId, p.id))).limit(1); if (!m) throw unprocessable('Marco não é deste projeto.'); }
      if (body.taskId) { const [t] = await tx.select({ id: s.activities.id }).from(s.activities).where(and(eq(s.activities.id, body.taskId), eq(s.activities.projectId, p.id))).limit(1); if (!t) throw unprocessable('Tarefa não é deste projeto.'); }
      const [i] = await tx.insert(s.impediments).values({ tenantId: auth.tenantId, title: body.title, description: body.description ?? null, severity: body.severity, ownerId: body.ownerId, dueOn: body.dueOn ?? null, raisedBy: auth.userId, projectId: p.id, milestoneId: body.milestoneId ?? null, taskId: body.taskId ?? null, teamId: p.teamId }).returning({ id: s.impediments.id });
      await gov(tx, auth, 'impedimento', i!.id, 'registrado', { title: body.title, severity: body.severity, projectId: p.id }, [body.ownerId]);
      await projectEvent(tx, auth, p.id, 'impedimento', `Impedimento registrado: ${body.title}`, { impedimentId: i!.id });
      reply.code(201);
      return i;
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/projects/:id/impediments/:impId', summary: 'Muda a situação do impedimento do projeto (encerrar exige como foi resolvido)', tag: 'Projetos', module: 'projetos', params: ImpParams,
    body: z.object({ rowVersion: z.number().int(), status: z.enum(['aberto', 'em_tratamento', 'removido', 'aceito']).optional(), resolution: z.string().trim().max(2000).optional(), ownerId: z.string().uuid().optional(), dueOn: isoDate.nullable().optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { p, can } = await loadProject(tx, auth, params.id);
      const [i] = await tx.select().from(s.impediments).where(and(eq(s.impediments.id, params.impId), eq(s.impediments.projectId, p.id))).limit(1).for('update');
      if (!i) throw notFound('Impedimento não encontrado.');
      assertCan(can.manage || i.ownerId === auth.userId || i.raisedBy === auth.userId, 'Só quem registrou, o responsável ou o gerente do projeto altera o impedimento.');
      if (i.rowVersion !== body.rowVersion) throw conflict(i.rowVersion);
      const set: Partial<typeof s.impediments.$inferInsert> = {};
      if (body.status && body.status !== i.status) {
        const err = impedimentTransition(i.status as ImpedimentStatus, body.status, body.resolution);
        if (err) throw unprocessable(err);
        const closing = body.status === 'removido' || body.status === 'aceito';
        Object.assign(set, { status: body.status, resolution: closing ? body.resolution! : null, resolvedBy: closing ? auth.userId : null, resolvedAt: closing ? new Date() : null });
      }
      if (body.ownerId && body.ownerId !== i.ownerId) { await activeUser(tx, auth, body.ownerId); set.ownerId = body.ownerId; }
      if (body.dueOn !== undefined) set.dueOn = body.dueOn;
      await tx.update(s.impediments).set({ ...set, updatedAt: new Date(), rowVersion: sql`${s.impediments.rowVersion} + 1` }).where(eq(s.impediments.id, i.id));
      if (set.status) {
        await gov(tx, auth, 'impedimento', i.id, set.status, { from: i.status, resolution: set.resolution ?? null, title: i.title }, [i.raisedBy, i.ownerId]);
        await projectEvent(tx, auth, p.id, 'impedimento', `Impedimento "${i.title}": ${i.status} → ${set.status}`, { impedimentId: i.id });
      }
      return { ok: true };
    }),
  }),

  // ---------------------------------------------------------------- homologação
  defineRoute({
    method: 'POST', url: '/projects/:id/milestones/:milestoneId/homologation', summary: 'Homologa ou reprova um marco concluído (nunca pelo autor; reprovar reabre o marco)', tag: 'Projetos', module: 'projetos', params: MsParams,
    body: z.object({ decision: z.enum(HOMOLOGATION_DECISIONS), note: z.string().trim().max(4000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { p, can } = await loadProject(tx, auth, params.id);
      if (!(can.manage || level(auth, 'projetos') === 'total')) throw forbidden('Só o gerente do projeto ou quem tem acesso total em Projetos homologa marcos.');
      const [m] = await tx.select().from(s.projectMilestones).where(and(eq(s.projectMilestones.id, params.milestoneId), eq(s.projectMilestones.projectId, p.id), isNull(s.projectMilestones.deletedAt))).limit(1).for('update');
      if (!m) throw notFound('Marco não encontrado.');
      const err = homologationError({ completedAt: m.completedAt?.toISOString() ?? null, completedBy: m.completedBy, requiresHomologation: m.requiresHomologation, homologatedAt: m.homologatedAt?.toISOString() ?? null }, auth.userId, body.note, body.decision);
      if (err) throw unprocessable(err);
      await tx.insert(s.milestoneHomologations).values({ tenantId: auth.tenantId, projectId: p.id, milestoneId: m.id, decision: body.decision, note: body.note, actorId: auth.userId });
      if (body.decision === 'homologado') await tx.update(s.projectMilestones).set({ homologatedAt: new Date(), homologatedBy: auth.userId }).where(eq(s.projectMilestones.id, m.id));
      else await tx.update(s.projectMilestones).set({ completedAt: null, completedBy: null }).where(eq(s.projectMilestones.id, m.id));
      await projectEvent(tx, auth, p.id, 'homologacao', body.decision === 'homologado' ? `Marco homologado: ${m.name}` : `Homologação reprovada, marco reaberto: ${m.name} (${body.note})`, { milestoneId: m.id, decision: body.decision });
      return { ok: true };
    }),
  }),

  // ---------------------------------------------------------------- frentes e painel
  defineRoute({
    method: 'GET', url: '/projects/portfolio', summary: 'Painel das frentes: progresso por marcos homologados, marco atual, próxima ação, impedimentos, riscos e homologações pendentes', tag: 'Projetos', module: 'projetos',
    query: z.object({ tag: z.string().trim().max(60).optional() }),
    handler: async ({ app, auth, query }) => {
      const where = [projectScope(auth), sql`${s.projects.status} not in ('cancelado')`];
      if (query.tag) where.push(sql`${query.tag} = any(${s.projects.tags})`);
      const ps = await app.db.select({ p: s.projects, ownerName: s.users.name }).from(s.projects).innerJoin(s.users, eq(s.users.id, s.projects.ownerId)).where(and(...where)).orderBy(asc(s.projects.name)).limit(200);
      const ids = ps.map((x) => x.p.id);
      const allTags = (await app.db.select({ tags: s.projects.tags }).from(s.projects).where(projectScope(auth))).flatMap((x) => x.tags);
      if (!ids.length) return { items: [], tags: [...new Set(allTags)].sort() };
      const [ms, tasks, imps, risks] = await Promise.all([
        app.db.select().from(s.projectMilestones).where(and(inArray(s.projectMilestones.projectId, ids), isNull(s.projectMilestones.deletedAt))),
        projectTasks(app.db, auth, ids),
        app.db.select({ projectId: s.impediments.projectId, severity: s.impediments.severity, status: s.impediments.status }).from(s.impediments).where(and(eq(s.impediments.tenantId, auth.tenantId), inArray(s.impediments.projectId, ids))),
        app.db.select({ projectId: s.projectRisks.projectId, probability: s.projectRisks.probability, impact: s.projectRisks.impact, status: s.projectRisks.status }).from(s.projectRisks).where(inArray(s.projectRisks.projectId, ids)),
      ]);
      const today = todayLocal(auth);
      return {
        tags: [...new Set(allTags)].sort(),
        items: ps.map(({ p, ownerName }) => {
          const myTasks = tasks.filter((t) => t.projectId === p.id);
          return {
            id: p.id, code: p.code, name: p.name, status: p.status, ownerName, dueOn: p.dueOn, tags: p.tags,
            lateTasks: myTasks.filter((t) => !t.completedAt && t.dueOn && t.dueOn < today).length,
            summary: frontSummary(
              ms.filter((m) => m.projectId === p.id).map((m) => ({ id: m.id, name: m.name, dueOn: m.dueOn, position: m.position, completedAt: m.completedAt?.toISOString() ?? null, requiresHomologation: m.requiresHomologation, homologatedAt: m.homologatedAt?.toISOString() ?? null })),
              myTasks.map((t) => ({ id: t.id, title: t.title, milestoneId: t.milestoneId, done: !!t.completedAt, dueOn: t.dueOn, ownerName: t.ownerName })),
              imps.filter((i) => i.projectId === p.id).map((i) => ({ severity: i.severity, open: OPEN_IMP.includes(i.status) })),
              risks.filter((r) => r.projectId === p.id).map((r) => ({ level: riskLevel(r.probability as RiskProbability, r.impact as RiskImpact), open: OPEN_RISK.includes(r.status as RiskStatus) })),
              today,
            ),
          };
        }),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/projects/fronts', summary: 'Cria as frentes de uma iniciativa (um projeto por frente, a partir do modelo "Implantação de módulo", todas com a etiqueta da iniciativa)', tag: 'Projetos', module: 'projetos', min: 'equipe',
    body: z.object({ initiative: z.string().trim().max(60), startOn: isoDate, fronts: z.array(z.object({ name: z.string().trim().max(120), ownerId: z.string().uuid() })).max(12) }),
    handler: async ({ app, auth, body, reply }) => app.db.transaction(async (tx) => {
      const errs = frontsErrors(body);
      if (errs.length) throw unprocessable(errs[0]!);
      for (const f of body.fronts) await activeUser(tx, auth, f.ownerId);
      const tpl = BUILTIN_PROJECT_TEMPLATES.find((t) => t.key === 'implantacao_modulo')!;
      const ids: string[] = [];
      for (const f of body.fronts) {
        const inst = instantiateTemplate(tpl.def, body.startOn);
        const [p] = await tx.insert(s.projects).values({
          tenantId: auth.tenantId, name: `${body.initiative} — ${f.name}`, description: `Frente ${f.name} da iniciativa ${body.initiative}.`, kind: 'implantacao', priority: 'alta', ownerId: f.ownerId,
          startOn: body.startOn, dueOn: inst.dueOn, tags: [body.initiative], templateKey: tpl.key, createdBy: auth.userId,
        }).returning({ id: s.projects.id });
        const pid = p!.id;
        const members = new Map<string, string>([[f.ownerId, 'gerente']]);
        if (!members.has(auth.userId)) members.set(auth.userId, 'membro');
        await tx.insert(s.projectMembers).values([...members].map(([userId, role]) => ({ projectId: pid, userId, tenantId: auth.tenantId, role })));
        const stages = await tx.insert(s.projectStages).values(inst.stages.map((st) => ({ tenantId: auth.tenantId, projectId: pid, name: st.name, position: st.position, done: st.done }))).returning();
        const ms = await tx.insert(s.projectMilestones).values(inst.milestones.map((m) => ({ tenantId: auth.tenantId, projectId: pid, name: m.name, dueOn: m.dueOn, position: m.position, acceptanceCriteria: m.acceptanceCriteria, requiresHomologation: m.homologation }))).returning();
        for (const t of inst.tasks) {
          await tx.insert(s.activities).values({
            tenantId: auth.tenantId, type: 'tarefa', title: t.title, notes: t.notes, priority: t.priority, ownerId: f.ownerId, dueAt: dueAtOf(auth, t.dueOn) as unknown as Date, startOn: t.startOn,
            projectId: pid, projectStageId: stages.find((x) => x.name === t.stage)!.id, milestoneId: ms.find((m) => m.name === t.milestone)?.id ?? null, position: t.position, createdBy: auth.userId,
          });
        }
        await projectEvent(tx, auth, pid, 'created', `Frente criada na iniciativa ${body.initiative} (${inst.tasks.length} tarefas, ${inst.milestones.length} marcos com homologação)`, { templateKey: tpl.key, initiative: body.initiative });
        ids.push(pid);
      }
      reply.code(201);
      return { ids };
    }),
  }),
];
