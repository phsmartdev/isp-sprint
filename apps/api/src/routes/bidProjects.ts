/**
 * Licitações · L1: projeto de licitação dentro da oportunidade (automático e manuais) e o modelo versionado
 * (rascunho → em aprovação → publicado → arquivado). Publicar uma versão não muda os projetos já criados.
 */
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { BID_AREAS, modelProblems, type BidModelDef } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { loadOpportunity } from '../services/opportunities';
import { level } from '../services/scope';
import { projectEvent } from '../services/projects';
import { bidProjectsOfOpportunity, createBidProject, ensureBidTemplate } from '../services/bidProjects';

const OPP = { tag: 'Licitações', module: 'oportunidades' as const };
const MODEL = { tag: 'Licitações', module: 'projetos' as const };
const isAdmin = (auth: AuthContext) => auth.access.configuracoes === 'total';
const canEditModel = (auth: AuthContext) => isAdmin(auth) || level(auth, 'projetos') === 'total';

const Task = z.object({ key: z.string().min(1).max(60), name: z.string().trim().min(1).max(200), required: z.boolean() });
const Macro = z.object({
  key: z.string().min(1).max(60), name: z.string().trim().min(1).max(200), area: z.enum(BID_AREAS), required: z.boolean(),
  deliverable: z.string().trim().max(500).optional(), acceptance: z.string().trim().max(1000).optional(), instructions: z.string().trim().max(2000).optional(),
  offsetDays: z.number().int().min(0).max(365), durationDays: z.number().int().min(0).max(365), tasks: z.array(Task).max(40),
});
const Phase = z.object({ key: z.string().min(1).max(60), name: z.string().trim().min(1).max(160), objective: z.string().trim().max(1000).optional(), deliverable: z.string().trim().min(1).max(500), durationDays: z.number().int().min(0).max(365), macros: z.array(Macro).max(40) });
const Def = z.object({ phases: z.array(Phase).min(1).max(30) });
const VParams = z.object({ v: z.coerce.number().int().min(1) });

async function oppProject(app: { db: Parameters<typeof loadOpportunity>[0] }, auth: AuthContext, projectId: string) {
  const [p] = await app.db.select().from(s.projects).where(and(eq(s.projects.tenantId, auth.tenantId), eq(s.projects.id, projectId), eq(s.projects.kind, 'licitacao'), isNull(s.projects.deletedAt))).limit(1);
  if (!p || !p.opportunityId) throw notFound('Projeto de licitação não encontrado.');
  await loadOpportunity(app.db, auth, p.opportunityId); // quem vê a oportunidade vê o projeto dela
  return p;
}

export const bidProjectRoutes = [
  // ------------------------------------------------------------------ na oportunidade
  defineRoute({
    method: 'GET', url: '/opportunities/:id/licitacao/projetos', summary: 'Projetos de licitação da oportunidade: progresso, etapa atual, próximo marco, pendências, atrasos, áreas e histórico', ...OPP, params: IdParams,
    handler: async ({ app, auth, params }) => {
      await loadOpportunity(app.db, auth, params.id);
      return { items: await bidProjectsOfOpportunity(app.db, auth, params.id), canSeeProjects: level(auth, 'projetos') !== 'nenhum' };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/licitacao/projetos', summary: 'Cria outro projeto de licitação na oportunidade (a partir da versão publicada do modelo)', ...OPP, params: IdParams,
    body: z.object({ name: z.string().trim().min(3).max(160).nullable().default(null), coordinatorId: z.string().uuid().nullable().default(null) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      await loadOpportunity(app.db, auth, params.id);
      if (body.coordinatorId) await activeUser(app.db, auth, body.coordinatorId);
      const id = await app.db.transaction((tx) => createBidProject(tx, auth, params.id, { origin: 'manual', coordinatorId: body.coordinatorId, name: body.name }));
      await audit(app.db, req, { action: 'bid.project.create', entityType: 'project', entityId: id!, metadata: { opportunityId: params.id } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/projects/:id/licitacao/coordenador', summary: 'Troca o coordenador do projeto de licitação (qualquer pessoa ativa da empresa)', ...OPP, params: IdParams,
    body: z.object({ coordinatorId: z.string().uuid() }),
    handler: async ({ app, auth, params, body, req }) => {
      const p = await oppProject(app, auth, params.id);
      const u = await activeUser(app.db, auth, body.coordinatorId);
      await app.db.transaction(async (tx) => {
        await tx.update(s.projects).set({ ownerId: u.id, updatedAt: new Date() }).where(eq(s.projects.id, p.id));
        await tx.insert(s.projectMembers).values({ projectId: p.id, userId: u.id, tenantId: auth.tenantId, role: 'gerente' }).onConflictDoUpdate({ target: [s.projectMembers.projectId, s.projectMembers.userId], set: { role: 'gerente' } });
        await projectEvent(tx, auth, p.id, 'coordenador', `Coordenação passou para ${u.name}.`, { from: p.ownerId, to: u.id });
      });
      await audit(app.db, req, { action: 'bid.project.coordinator', entityType: 'project', entityId: p.id, metadata: { to: u.id } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/projects/:id/licitacao/decisao', summary: 'A oportunidade deixou de ser licitação: continuar o projeto ou arquivá-lo (o histórico fica)', ...OPP, params: IdParams,
    body: z.object({ decision: z.enum(['continuar', 'arquivar']), note: z.string().trim().max(500).nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      const p = await oppProject(app, auth, params.id);
      if (p.attention !== 'modalidade_alterada') throw unprocessable('Não há decisão pendente neste projeto.');
      await app.db.transaction(async (tx) => {
        await tx.update(s.projects).set({ attention: null, ...(body.decision === 'arquivar' ? { status: 'cancelado' } : {}), updatedAt: new Date() }).where(eq(s.projects.id, p.id));
        await projectEvent(tx, auth, p.id, 'modalidade', body.decision === 'arquivar' ? `Projeto arquivado: a oportunidade deixou de ser licitação${body.note ? ` (${body.note})` : ''}.` : `Projeto continua mesmo com a oportunidade fora de licitação${body.note ? ` (${body.note})` : ''}.`);
      });
      await audit(app.db, req, { action: `bid.project.${body.decision}`, entityType: 'project', entityId: p.id });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ modelo versionado
  defineRoute({
    method: 'GET', url: '/modelos-projeto/licitacao', summary: 'Modelo de projeto de licitação com todas as versões (a publicada vale para os novos projetos)', ...MODEL,
    handler: async ({ app, auth }) => {
      const t = await ensureBidTemplate(app.db, auth.tenantId, auth.userId);
      const versions = await app.db.select({ v: s.projectTemplateVersions, author: s.users.name }).from(s.projectTemplateVersions).leftJoin(s.users, eq(s.users.id, s.projectTemplateVersions.createdBy))
        .where(eq(s.projectTemplateVersions.templateId, t.id)).orderBy(desc(s.projectTemplateVersions.version));
      return { template: { id: t.id, name: t.name, description: t.description, publishedVersion: t.publishedVersion }, canEdit: canEditModel(auth), canPublish: isAdmin(auth), versions: versions.map(({ v, author }) => ({ ...v, author, problems: modelProblems(v.def) })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/modelos-projeto/licitacao/versoes', summary: 'Nova versão em rascunho, copiada de uma versão existente (uma em edição por vez)', ...MODEL,
    body: z.object({ fromVersion: z.number().int().min(1) }),
    handler: async ({ app, auth, body, req, reply }) => {
      if (!canEditModel(auth)) throw forbidden('Só quem administra Projetos edita o modelo.');
      const t = await ensureBidTemplate(app.db, auth.tenantId, auth.userId);
      const out = await app.db.transaction(async (tx) => {
        const all = await tx.select().from(s.projectTemplateVersions).where(eq(s.projectTemplateVersions.templateId, t.id)).for('update');
        const open = all.find((v) => v.status === 'rascunho' || v.status === 'em_aprovacao');
        if (open) throw unprocessable(`A versão ${open.version} já está em ${open.status === 'rascunho' ? 'rascunho' : 'aprovação'}: continue nela.`);
        const src = all.find((v) => v.version === body.fromVersion);
        if (!src) throw notFound('Versão de origem não encontrada.');
        const version = Math.max(...all.map((v) => v.version)) + 1;
        const [nv] = await tx.insert(s.projectTemplateVersions).values({ tenantId: auth.tenantId, templateId: t.id, version, status: 'rascunho', def: src.def, notes: `Baseada na versão ${src.version}`, createdBy: auth.userId }).returning();
        return nv!;
      });
      await audit(app.db, req, { action: 'bid.model.draft', entityType: 'project_template', entityId: t.id, metadata: { version: out.version } });
      reply.code(201);
      return out;
    },
  }),
  defineRoute({
    method: 'PUT', url: '/modelos-projeto/licitacao/versoes/:v', summary: 'Salva o rascunho (etapas, macrotarefas, tarefas, áreas, entregáveis, prazos)', ...MODEL, params: VParams,
    body: z.object({ def: Def, notes: z.string().trim().max(1000).nullable().default(null), rowVersion: z.number().int() }), bodyLimit: 1_000_000,
    handler: async ({ app, auth, params, body, req }) => {
      if (!canEditModel(auth)) throw forbidden('Só quem administra Projetos edita o modelo.');
      const v = await loadVersion(app.db, auth, params.v);
      if (v.status !== 'rascunho') throw unprocessable('Só o rascunho se edita. Versão publicada fica como está: crie uma nova versão.');
      const [r] = await app.db.update(s.projectTemplateVersions).set({ def: body.def as BidModelDef, notes: body.notes, updatedAt: new Date(), rowVersion: v.rowVersion + 1 })
        .where(and(eq(s.projectTemplateVersions.id, v.id), eq(s.projectTemplateVersions.rowVersion, body.rowVersion))).returning({ rowVersion: s.projectTemplateVersions.rowVersion });
      if (!r) throw conflict(v.rowVersion);
      await audit(app.db, req, { action: 'bid.model.save', entityType: 'project_template', entityId: v.templateId, metadata: { version: v.version } });
      return { rowVersion: r.rowVersion, problems: modelProblems(body.def as BidModelDef) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/modelos-projeto/licitacao/versoes/:v/enviar', summary: 'Envia o rascunho para aprovação (precisa estar sem problemas)', ...MODEL, params: VParams,
    handler: async ({ app, auth, params, req }) => {
      if (!canEditModel(auth)) throw forbidden('Só quem administra Projetos edita o modelo.');
      const v = await loadVersion(app.db, auth, params.v);
      if (v.status !== 'rascunho') throw unprocessable('Só rascunho vai para aprovação.');
      const pr = modelProblems(v.def);
      if (pr.length) throw unprocessable(`Corrija antes: ${pr.slice(0, 3).join(' ')}`);
      await app.db.update(s.projectTemplateVersions).set({ status: 'em_aprovacao', submittedAt: new Date(), submittedBy: auth.userId, reviewNote: null, updatedAt: new Date(), rowVersion: v.rowVersion + 1 }).where(eq(s.projectTemplateVersions.id, v.id));
      await audit(app.db, req, { action: 'bid.model.submit', entityType: 'project_template', entityId: v.templateId, metadata: { version: v.version } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/modelos-projeto/licitacao/versoes/:v/decidir', summary: 'Aprova (publica para os novos projetos) ou devolve para ajustes a versão em aprovação', ...MODEL, params: VParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!isAdmin(auth)) throw forbidden('Quem publica o modelo é a administração (Configurações em nível Total).');
      const v = await loadVersion(app.db, auth, params.v);
      if (v.status !== 'em_aprovacao') throw unprocessable('Esta versão não está aguardando aprovação.');
      if (!body.approve && (!body.note || body.note.length < 5)) throw unprocessable('Diga o que precisa ser ajustado.', [{ path: 'note', message: 'Obrigatório' }]);
      await app.db.transaction(async (tx) => {
        if (body.approve) {
          await tx.update(s.projectTemplateVersions).set({ status: 'arquivado', updatedAt: new Date() }).where(and(eq(s.projectTemplateVersions.templateId, v.templateId), eq(s.projectTemplateVersions.status, 'publicado'), ne(s.projectTemplateVersions.id, v.id)));
          await tx.update(s.projectTemplateVersions).set({ status: 'publicado', publishedAt: new Date(), publishedBy: auth.userId, reviewNote: body.note, updatedAt: new Date(), rowVersion: v.rowVersion + 1 }).where(eq(s.projectTemplateVersions.id, v.id));
          await tx.update(s.projectTemplates).set({ publishedVersion: v.version }).where(eq(s.projectTemplates.id, v.templateId));
        } else {
          await tx.update(s.projectTemplateVersions).set({ status: 'rascunho', reviewNote: body.note, updatedAt: new Date(), rowVersion: v.rowVersion + 1 }).where(eq(s.projectTemplateVersions.id, v.id));
        }
      });
      await audit(app.db, req, { action: body.approve ? 'bid.model.publish' : 'bid.model.return', entityType: 'project_template', entityId: v.templateId, metadata: { version: v.version, note: body.note } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/modelos-projeto/licitacao/versoes/:v/descartar', summary: 'Descarta o rascunho (fica arquivado no histórico)', ...MODEL, params: VParams,
    handler: async ({ app, auth, params, req }) => {
      if (!canEditModel(auth)) throw forbidden('Só quem administra Projetos edita o modelo.');
      const v = await loadVersion(app.db, auth, params.v);
      if (v.status !== 'rascunho') throw unprocessable('Só rascunho se descarta.');
      await app.db.update(s.projectTemplateVersions).set({ status: 'arquivado', updatedAt: new Date() }).where(eq(s.projectTemplateVersions.id, v.id));
      await audit(app.db, req, { action: 'bid.model.discard', entityType: 'project_template', entityId: v.templateId, metadata: { version: v.version } });
      return { ok: true };
    },
  }),
];

async function loadVersion(db: Parameters<typeof loadOpportunity>[0], auth: AuthContext, version: number) {
  const t = await ensureBidTemplate(db, auth.tenantId, auth.userId);
  const [v] = await db.select().from(s.projectTemplateVersions).where(and(eq(s.projectTemplateVersions.templateId, t.id), eq(s.projectTemplateVersions.version, version))).limit(1);
  if (!v) throw notFound('Versão não encontrada.');
  return v;
}
async function activeUser(db: Parameters<typeof loadOpportunity>[0], auth: AuthContext, id: string) {
  const [u] = await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.id, id), eq(s.users.active, true))).limit(1);
  if (!u) throw unprocessable('Pessoa inválida ou inativa.', [{ path: 'coordinatorId', message: 'Escolha uma pessoa ativa da empresa' }]);
  return u;
}
