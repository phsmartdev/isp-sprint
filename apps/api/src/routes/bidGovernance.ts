/**
 * Licitações · L3: matriz RACI e aprovações dentro do processo comercial.
 * - Responsáveis por área (titular, substituto, gestor) resolvem o R das tarefas da área.
 * - Quem aprova cada tipo de decisão (Accountable único); sem regra, o gestor da Diretoria.
 * - Aprovação: plano, Go/No-Go, proposta, alteração crítica e contratação. Só o aprovador decide (resposta por
 *   e-mail não vale); quem pede não aprova o próprio pedido. A versão aprovada fica congelada (snapshot).
 * - Exceções de preço e margem seguem as alçadas comerciais que já existem ("Pedir aprovação" na oportunidade).
 */
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BID_APPROVAL_KINDS, BID_APPROVAL_LABELS, BID_AREAS, BID_AREA_ROLES, GO_DECISIONS, GO_LABELS, planIssues, type BidApprovalKind, type PlanRow, type ProjectTaskSpec } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { level } from '../services/scope';
import { dueAtOf, projectEvent, todayLocal } from '../services/projects';
import { oppProject } from './bidProjects';
import { canPlanProject, guardCritical, officialOf, planRows } from './bidPlanning';

const OPP = { tag: 'Licitações', module: 'oportunidades' as const };
const canAdmin = (auth: AuthContext) => auth.access.configuracoes === 'total' || level(auth, 'projetos') === 'total';
type Proj = Awaited<ReturnType<typeof oppProject>>;

/** Aprovador do tipo: regra da empresa; sem regra, o gestor da Diretoria. */
export async function approverFor(db: DbOrTx, tenantId: string, kind: BidApprovalKind) {
  const [r] = await db.select({ id: s.bidApprovalRules.approverId }).from(s.bidApprovalRules).where(and(eq(s.bidApprovalRules.tenantId, tenantId), eq(s.bidApprovalRules.kind, kind))).limit(1);
  if (r) return { id: r.id, via: 'regra' as const };
  const [g] = await db.select({ id: s.bidAreaMembers.userId }).from(s.bidAreaMembers).where(and(eq(s.bidAreaMembers.tenantId, tenantId), eq(s.bidAreaMembers.area, 'diretoria'), eq(s.bidAreaMembers.role, 'gestor'))).limit(1);
  return g ? { id: g.id, via: 'diretoria' as const } : null;
}

async function governance(db: DbOrTx, tenantId: string) {
  const [members, rules] = await Promise.all([
    db.select({ area: s.bidAreaMembers.area, userId: s.bidAreaMembers.userId, role: s.bidAreaMembers.role, name: s.users.name }).from(s.bidAreaMembers).innerJoin(s.users, eq(s.users.id, s.bidAreaMembers.userId)).where(eq(s.bidAreaMembers.tenantId, tenantId)).orderBy(asc(s.users.name)),
    db.select({ kind: s.bidApprovalRules.kind, approverId: s.bidApprovalRules.approverId, name: s.users.name }).from(s.bidApprovalRules).innerJoin(s.users, eq(s.users.id, s.bidApprovalRules.approverId)).where(eq(s.bidApprovalRules.tenantId, tenantId)),
  ]);
  return { members, rules };
}

async function approvalsOf(db: DbOrTx, auth: AuthContext, p: Proj) {
  const req = sql<string>`(select name from users where id = ${s.bidApprovals.requestedBy})`;
  const apr = sql<string>`(select name from users where id = ${s.bidApprovals.approverId})`;
  const dec = sql<string | null>`(select name from users where id = ${s.bidApprovals.decidedBy})`;
  const items = await db.select({ a: s.bidApprovals, requester: req, approver: apr, decider: dec }).from(s.bidApprovals).where(and(eq(s.bidApprovals.tenantId, auth.tenantId), eq(s.bidApprovals.projectId, p.id))).orderBy(desc(s.bidApprovals.createdAt));
  const resolved = Object.fromEntries(await Promise.all(BID_APPROVAL_KINDS.map(async (k) => {
    const a = await approverFor(db, auth.tenantId, k);
    const [u] = a ? await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, a.id)).limit(1) : [];
    return [k, a ? { id: a.id, name: u?.name ?? '', via: a.via } : null];
  })));
  // exceções de preço/margem: as aprovações comerciais da oportunidade (fluxo que já existe)
  const price = await db.select({ id: s.approvalRequests.id, version: s.approvalRequests.version, discountBp: s.approvalRequests.discountBp, level: s.approvalRequests.requiredLevel, createdAt: s.approvalRequests.createdAt,
    decision: sql<string | null>`(select decision from approval_decisions d where d.request_id = ${s.approvalRequests.id} order by d.created_at desc limit 1)` })
    .from(s.approvalRequests).where(and(eq(s.approvalRequests.tenantId, auth.tenantId), eq(s.approvalRequests.opportunityId, p.opportunityId!))).orderBy(desc(s.approvalRequests.createdAt)).limit(10);
  return {
    items: items.map(({ a, requester, approver, decider }) => ({ ...a, requester, approver, decider, canDecide: a.status === 'aguardando' && a.approverId === auth.userId && a.requestedBy !== auth.userId, canCancel: a.status === 'aguardando' && (a.requestedBy === auth.userId || p.ownerId === auth.userId) })),
    resolved, planStatus: p.planStatus, goDecision: p.goDecision, price,
  };
}

const Note = z.string().trim().max(2000).nullable().default(null);

export const bidGovernanceRoutes = [
  // ------------------------------------------------------------------ áreas e aprovadores (empresa)
  defineRoute({
    method: 'GET', url: '/licitacoes/governanca', summary: 'Responsáveis por área (titular, substituto, gestor) e quem aprova cada decisão', ...OPP,
    handler: async ({ app, auth }) => ({ ...(await governance(app.db, auth.tenantId)), canEdit: canAdmin(auth) }),
  }),
  defineRoute({
    method: 'PUT', url: '/licitacoes/governanca/areas/:area', summary: 'Define as pessoas da área (titular, substituto, gestor)', ...OPP, params: z.object({ area: z.enum(BID_AREAS) }),
    body: z.object({ members: z.array(z.object({ userId: z.string().uuid(), role: z.enum(BID_AREA_ROLES) })).max(30) }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!canAdmin(auth)) throw forbidden('Quem administra Projetos ou a empresa define as áreas.');
      const ids = [...new Set(body.members.map((m) => m.userId))];
      if (ids.length !== body.members.length) throw unprocessable('Cada pessoa aparece uma vez por área.');
      if (body.members.filter((m) => m.role === 'gestor').length > 1) throw unprocessable('A área tem um gestor só.');
      if (ids.length) { const us = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, ids), eq(s.users.active, true))); if (us.length !== ids.length) throw unprocessable('Pessoa inválida ou inativa.'); }
      await app.db.transaction(async (tx) => {
        await tx.delete(s.bidAreaMembers).where(and(eq(s.bidAreaMembers.tenantId, auth.tenantId), eq(s.bidAreaMembers.area, params.area)));
        if (body.members.length) await tx.insert(s.bidAreaMembers).values(body.members.map((m) => ({ tenantId: auth.tenantId, area: params.area, userId: m.userId, role: m.role })));
      });
      await audit(app.db, req, { action: 'bid.governance.area', entityType: 'bid_area', entityId: params.area, metadata: { members: body.members } });
      return governance(app.db, auth.tenantId);
    },
  }),
  defineRoute({
    method: 'PUT', url: '/licitacoes/governanca/aprovadores/:kind', summary: 'Quem aprova este tipo de decisão (vazio: volta ao gestor da Diretoria)', ...OPP, params: z.object({ kind: z.enum(BID_APPROVAL_KINDS) }),
    body: z.object({ approverId: z.string().uuid().nullable() }),
    handler: async ({ app, auth, params, body, req }) => {
      if (auth.access.configuracoes !== 'total') throw forbidden('Só a administração define as alçadas de aprovação.');
      if (body.approverId) {
        const [u] = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.id, body.approverId), eq(s.users.active, true))).limit(1);
        if (!u) throw unprocessable('Pessoa inválida ou inativa.');
        await app.db.insert(s.bidApprovalRules).values({ tenantId: auth.tenantId, kind: params.kind, approverId: body.approverId, updatedBy: auth.userId }).onConflictDoUpdate({ target: [s.bidApprovalRules.tenantId, s.bidApprovalRules.kind], set: { approverId: body.approverId, updatedBy: auth.userId, updatedAt: new Date() } });
      } else await app.db.delete(s.bidApprovalRules).where(and(eq(s.bidApprovalRules.tenantId, auth.tenantId), eq(s.bidApprovalRules.kind, params.kind)));
      await audit(app.db, req, { action: 'bid.governance.approver', entityType: 'bid_approval_rule', entityId: params.kind, metadata: { approverId: body.approverId } });
      return governance(app.db, auth.tenantId);
    },
  }),

  // ------------------------------------------------------------------ no projeto
  defineRoute({
    method: 'POST', url: '/projects/:id/licitacao/atribuir-areas', summary: 'Atribui ao titular de cada área as macrotarefas da área ainda sem responsável', ...OPP, params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      const p = await oppProject(app, auth, params.id);
      if (!(await canPlanProject(app.db, auth, p))) throw forbidden('O planejamento é do coordenador do projeto ou do responsável pela oportunidade.');
      const g = await governance(app.db, auth.tenantId);
      const titular = new Map(g.members.filter((m) => m.role === 'titular').map((m) => [m.area, m]));
      const rows = await app.db.select({ id: s.activities.id, spec: s.activities.spec }).from(s.activities).where(and(eq(s.activities.projectId, p.id), isNull(s.activities.parentId), isNull(s.activities.deletedAt), isNull(s.activities.completedAt)));
      const todo = rows.filter((r) => { const sp = r.spec as ProjectTaskSpec | null; return sp && sp.area !== 'comercial' && !sp.assigned && titular.has(sp.area); });
      await app.db.transaction(async (tx) => {
        await guardCritical(tx, auth, p, todo.length > 0, 'responsáveis atribuídos pelas áreas');
        for (const r of todo) {
          const sp = r.spec as ProjectTaskSpec;
          const m = titular.get(sp.area)!;
          await tx.update(s.activities).set({ ownerId: m.userId, spec: { ...sp, assigned: true }, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, r.id));
          // a subtarefa acompanha a macrotarefa
          await tx.update(s.activities).set({ ownerId: m.userId, updatedAt: new Date() }).where(and(eq(s.activities.parentId, r.id), isNull(s.activities.completedAt)));
        }
        if (todo.length) await projectEvent(tx, auth, p.id, 'raci', `Responsáveis atribuídos pelas áreas em ${todo.length} macrotarefa(s).`);
      });
      await audit(app.db, req, { action: 'bid.raci.assign', entityType: 'project', entityId: p.id, metadata: { n: todo.length } });
      const missing = [...new Set(rows.map((r) => (r.spec as ProjectTaskSpec | null)?.area).filter((a) => a && a !== 'comercial' && !titular.has(a)))];
      return { assigned: todo.length, missingAreas: missing };
    },
  }),
  defineRoute({
    method: 'GET', url: '/projects/:id/licitacao/aprovacoes', summary: 'Aprovações do projeto (com o aprovador de cada tipo) e as aprovações comerciais de preço/margem da oportunidade', ...OPP, params: IdParams,
    handler: async ({ app, auth, params }) => approvalsOf(app.db, auth, await oppProject(app, auth, params.id)),
  }),
  defineRoute({
    method: 'POST', url: '/projects/:id/licitacao/aprovacoes', summary: 'Submete à aprovação (plano, Go/No-Go, proposta, alteração crítica, contratação) ao aprovador da matriz', ...OPP, params: IdParams,
    body: z.object({ kind: z.enum(BID_APPROVAL_KINDS), justification: z.string().trim().min(5).max(4000), recommendation: z.enum(GO_DECISIONS).nullable().default(null), data: z.record(z.string(), z.unknown()).default({}) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const p = await oppProject(app, auth, params.id);
      if (!(await canPlanProject(app.db, auth, p))) throw forbidden('Quem conduz o processo (coordenador ou responsável pela oportunidade) submete as aprovações.');
      if (p.status === 'cancelado' || p.status === 'concluido') throw unprocessable('Projeto encerrado.');
      const ap = await approverFor(app.db, auth.tenantId, body.kind);
      if (!ap) throw unprocessable('Defina quem aprova esta decisão (Configurações → Modelos → Projeto de licitação → Aprovadores) ou o gestor da Diretoria.');
      if (ap.id === auth.userId) throw unprocessable('Quem pede não aprova o próprio pedido. Peça para outra pessoa conduzir ou mude o aprovador.');
      const out = await app.db.transaction(async (tx) => {
        const [lock] = await tx.select({ planStatus: s.projects.planStatus, goDecision: s.projects.goDecision }).from(s.projects).where(eq(s.projects.id, p.id)).for('update');
        const [open] = await tx.select({ id: s.bidApprovals.id }).from(s.bidApprovals).where(and(eq(s.bidApprovals.projectId, p.id), eq(s.bidApprovals.kind, body.kind), eq(s.bidApprovals.status, 'aguardando'))).limit(1);
        if (open) throw unprocessable('Já há um pedido deste tipo aguardando decisão.');
        let snapshot: Record<string, unknown> = { ...body.data };
        if (body.kind === 'plano' || body.kind === 'alteracao_critica') {
          if (body.kind === 'plano' && !['em_elaboracao', 'devolvido'].includes(lock!.planStatus)) throw unprocessable(lock!.planStatus === 'aprovado' ? 'O plano já está aprovado.' : lock!.planStatus === 'alterado' ? 'O plano aprovado foi alterado: submeta como alteração crítica.' : 'O plano já está em aprovação.');
          if (body.kind === 'alteracao_critica' && lock!.planStatus !== 'alterado') throw unprocessable('Não há alteração crítica pendente no plano aprovado.');
          const [rows, dates] = await Promise.all([planRows(tx, auth, p.id), officialOf(tx, p)]);
          const blocks = planIssues(rows.map((r) => ({ id: r.id, parentId: r.parentId, title: r.title, ownerId: r.ownerId, startOn: r.startOn, dueOn: r.dueOn, done: r.done, spec: r.spec as ProjectTaskSpec | null, dependsOn: r.dependsOn }) satisfies PlanRow), dates, p.ownerId).filter((i) => i.level === 'bloqueio');
          if (blocks.length) throw unprocessable(`Resolva antes as pendências do plano: ${blocks.slice(0, 3).map((b) => b.message).join(' ')}`);
          snapshot = { dates, rows: rows.filter((r) => !r.parentId).map((r) => ({ id: r.id, title: r.title, owner: r.ownerName, startOn: r.startOn, dueOn: r.dueOn, area: (r.spec as ProjectTaskSpec | null)?.area, required: (r.spec as ProjectTaskSpec | null)?.required, deliverable: (r.spec as ProjectTaskSpec | null)?.deliverable, acceptance: (r.spec as ProjectTaskSpec | null)?.acceptance })) };
          await tx.update(s.projects).set({ planStatus: 'aguardando', updatedAt: new Date() }).where(eq(s.projects.id, p.id));
        }
        if (body.kind === 'go_no_go' && !body.recommendation) throw unprocessable('Indique a recomendação: Go, Go condicionado ou No-Go.', [{ path: 'recommendation', message: 'Obrigatória' }]);
        if ((body.kind === 'proposta' || body.kind === 'contratacao') && !(lock!.goDecision === 'go' || lock!.goDecision === 'go_condicionado')) throw unprocessable('Primeiro a participação precisa estar aprovada (Go ou Go condicionado).');
        if (body.recommendation) snapshot.recommendation = body.recommendation;
        const [{ v } = { v: 0 }] = await tx.select({ v: max(s.bidApprovals.version) }).from(s.bidApprovals).where(and(eq(s.bidApprovals.projectId, p.id), eq(s.bidApprovals.kind, body.kind)));
        const version = (v ?? 0) + 1;
        const title = `${BID_APPROVAL_LABELS[body.kind]} — ${p.name}`;
        // a decisão chega na lista de tarefas de quem aprova (conclui sozinha ao decidir)
        const due = new Date(Date.parse(`${todayLocal(auth)}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
        const [task] = await tx.insert(s.activities).values({ tenantId: auth.tenantId, type: 'tarefa', title: `Aprovar: ${title}`.slice(0, 200), notes: `${body.justification}\n\nDecida em Oportunidade → Projeto de Licitação → Cronograma e planejamento → Aprovações. Resposta por e-mail não vale como aprovação.`, priority: 'alta', ownerId: ap.id, opportunityId: p.opportunityId, dueAt: dueAtOf(auth, due) as unknown as Date, createdBy: auth.userId }).returning({ id: s.activities.id });
        const [a] = await tx.insert(s.bidApprovals).values({ tenantId: auth.tenantId, projectId: p.id, opportunityId: p.opportunityId!, kind: body.kind, version, status: 'aguardando', title, justification: body.justification, snapshot, requestedBy: auth.userId, approverId: ap.id, taskId: task!.id }).returning();
        await projectEvent(tx, auth, p.id, 'aprovacao', `${BID_APPROVAL_LABELS[body.kind]} (v${version}) enviado para aprovação.`, { approvalId: a!.id, approverId: ap.id });
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: p.opportunityId!, type: 'aprovacao_licitacao', actorId: auth.userId, payload: { approvalId: a!.id, kind: body.kind, version, status: 'aguardando' } });
        return a!;
      });
      await audit(app.db, req, { action: 'bid.approval.request', entityType: 'bid_approval', entityId: out.id, metadata: { kind: body.kind, version: out.version, approverId: out.approverId } });
      reply.code(201);
      return out;
    },
  }),
  defineRoute({
    method: 'POST', url: '/licitacoes/aprovacoes/:id/decidir', summary: 'Decisão do aprovador (aprovar, devolver ou rejeitar; no Go/No-Go, a decisão)', ...OPP, params: IdParams,
    body: z.object({ status: z.enum(['aprovado', 'devolvido', 'rejeitado']), decision: z.enum(GO_DECISIONS).nullable().default(null), note: Note }),
    handler: async ({ app, auth, params, body, req }) => {
      const [a] = await app.db.select().from(s.bidApprovals).where(and(eq(s.bidApprovals.tenantId, auth.tenantId), eq(s.bidApprovals.id, params.id))).limit(1);
      if (!a) throw notFound('Aprovação não encontrada.');
      const p = await oppProject(app, auth, a.projectId);
      if (a.status !== 'aguardando') throw unprocessable('Esta aprovação já foi decidida.');
      if (a.approverId !== auth.userId) throw forbidden('Só o aprovador definido na matriz decide.');
      if (a.requestedBy === auth.userId) throw forbidden('Quem pediu não aprova o próprio pedido.');
      if (body.status !== 'aprovado' && (!body.note || body.note.length < 5)) throw unprocessable('Explique o motivo.', [{ path: 'note', message: 'Obrigatório' }]);
      let decision = body.decision;
      if (a.kind === 'go_no_go') {
        if (body.status === 'aprovado' && !decision) throw unprocessable('Registre Go, Go condicionado ou No-Go.', [{ path: 'decision', message: 'Obrigatória' }]);
        if (decision === 'go_condicionado' && (!body.note || body.note.length < 5)) throw unprocessable('Descreva as condições do Go condicionado.', [{ path: 'note', message: 'Obrigatório' }]);
        if (body.status !== 'aprovado') decision = null;
      } else decision = null;
      await app.db.transaction(async (tx) => {
        const [cur] = await tx.select({ status: s.bidApprovals.status }).from(s.bidApprovals).where(eq(s.bidApprovals.id, a.id)).for('update');
        if (cur!.status !== 'aguardando') throw unprocessable('Esta aprovação já foi decidida.');
        await tx.update(s.bidApprovals).set({ status: body.status, decision, decisionNote: body.note, decidedBy: auth.userId, decidedAt: new Date() }).where(eq(s.bidApprovals.id, a.id));
        if (a.kind === 'plano' || a.kind === 'alteracao_critica') await tx.update(s.projects).set({ planStatus: body.status === 'aprovado' ? 'aprovado' : a.kind === 'plano' ? 'devolvido' : 'alterado', updatedAt: new Date() }).where(eq(s.projects.id, p.id));
        if (a.kind === 'go_no_go' && decision) await tx.update(s.projects).set({ goDecision: decision, updatedAt: new Date() }).where(eq(s.projects.id, p.id));
        if (a.taskId) await tx.update(s.activities).set({ status: 'concluida', completedAt: new Date(), completedBy: auth.userId, updatedAt: new Date() }).where(and(eq(s.activities.id, a.taskId), isNull(s.activities.completedAt)));
        const what = `${BID_APPROVAL_LABELS[a.kind as BidApprovalKind]} (v${a.version}): ${body.status === 'aprovado' ? (decision ? `aprovado — ${GO_LABELS[decision]}` : 'aprovado') : body.status === 'devolvido' ? 'devolvido para ajustes' : 'rejeitado'}${body.note ? ` (${body.note})` : ''}.`;
        await projectEvent(tx, auth, p.id, 'aprovacao', what, { approvalId: a.id, status: body.status, decision });
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: a.opportunityId, type: 'aprovacao_licitacao', actorId: auth.userId, payload: { approvalId: a.id, kind: a.kind, version: a.version, status: body.status, decision, note: body.note } });
      });
      await audit(app.db, req, { action: 'bid.approval.decide', entityType: 'bid_approval', entityId: a.id, metadata: { status: body.status, decision } });
      return approvalsOf(app.db, auth, (await oppProject(app, auth, a.projectId)));
    },
  }),
  defineRoute({
    method: 'POST', url: '/licitacoes/aprovacoes/:id/cancelar', summary: 'Cancela um pedido ainda aguardando decisão (quem pediu ou o coordenador)', ...OPP, params: IdParams,
    body: z.object({ note: Note }),
    handler: async ({ app, auth, params, body, req }) => {
      const [a] = await app.db.select().from(s.bidApprovals).where(and(eq(s.bidApprovals.tenantId, auth.tenantId), eq(s.bidApprovals.id, params.id))).limit(1);
      if (!a) throw notFound('Aprovação não encontrada.');
      const p = await oppProject(app, auth, a.projectId);
      if (a.status !== 'aguardando') throw unprocessable('Só pedido aguardando decisão se cancela.');
      if (a.requestedBy !== auth.userId && p.ownerId !== auth.userId) throw forbidden('Quem pediu ou o coordenador cancela o pedido.');
      await app.db.transaction(async (tx) => {
        await tx.update(s.bidApprovals).set({ status: 'cancelado', decisionNote: body.note, decidedBy: auth.userId, decidedAt: new Date() }).where(eq(s.bidApprovals.id, a.id));
        if (a.kind === 'plano') await tx.update(s.projects).set({ planStatus: 'em_elaboracao', updatedAt: new Date() }).where(eq(s.projects.id, p.id));
        if (a.kind === 'alteracao_critica') await tx.update(s.projects).set({ planStatus: 'alterado', updatedAt: new Date() }).where(eq(s.projects.id, p.id));
        if (a.taskId) await tx.update(s.activities).set({ status: 'cancelada', updatedAt: new Date() }).where(and(eq(s.activities.id, a.taskId), isNull(s.activities.completedAt)));
        await projectEvent(tx, auth, p.id, 'aprovacao', `${BID_APPROVAL_LABELS[a.kind as BidApprovalKind]} (v${a.version}): pedido cancelado${body.note ? ` (${body.note})` : ''}.`, { approvalId: a.id });
      });
      await audit(app.db, req, { action: 'bid.approval.cancel', entityType: 'bid_approval', entityId: a.id });
      return approvalsOf(app.db, auth, (await oppProject(app, auth, a.projectId)));
    },
  }),
];
