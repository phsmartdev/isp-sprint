/** Modelos de proposta (arte + campos variáveis) e geração do PDF da proposta na oportunidade. */
import { GenBody, branchDefaultTemplate, generateProposal, renderProposal } from '../services/proposalGen';
import { todayIn } from '../services/vacations';
import { normalizeSections, proposalTitle, validityDate } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { loadOpportunity } from '../services/opportunities';
import { CONTRACT_TEMPLATE_VARIABLES } from '@isp/domain';
import { SYSTEM_VARIABLES, buildProposalPdf, imageSize, systemValues } from '../services/proposals';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
const Field = z.object({
  id: z.string().min(1).max(40), page: z.number().int().min(0).max(30), x: z.number().min(0).max(100), y: z.number().min(0).max(100), w: z.number().min(1).max(100),
  size: z.number().min(5).max(200), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), align: z.enum(['left', 'center', 'right']), bold: z.boolean(), strike: z.boolean().optional(), text: z.string().max(2000),
});
const Variable = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use letras minúsculas, números e _'), label: z.string().trim().min(2).max(60), type: z.enum(['texto', 'texto_longo', 'moeda']), default: z.string().max(2000).default('') });
const TemplateBody = z.object({
  name: z.string().trim().min(2).max(80),
  segments: z.array(z.enum(['residencial', 'empresarial', 'governamental', 'institucional'])).default([]),
  fields: z.array(Field).max(80).default([]),
  variables: z.array(Variable).max(40).default([]),
  active: z.boolean().default(true),
  purpose: z.enum(['proposta', 'contrato']).default('proposta'),
  billingType: z.enum(['recorrente', 'frequente', 'medicao']).nullable().default(null),
  sections: z.object({
    enabled: z.boolean(), backgroundPage: z.number().int().min(0).max(40).nullable(), insertAfter: z.number().int().min(-1).max(40),
    margins: z.object({ top: z.number().min(0).max(40), bottom: z.number().min(0).max(40), left: z.number().min(0).max(40), right: z.number().min(0).max(40) }),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/), titles: z.object({ services: z.string().max(80), investment: z.string().max(80), condition: z.string().max(80) }),
    validityDays: z.number().int().min(1).max(365), conditionText: z.string().max(2000),
  }).nullable().optional(),
});
const PageParams = z.object({ id: z.string().uuid(), pageId: z.string().uuid() });

async function templateOr404(db: Parameters<typeof loadOpportunity>[0], tenantId: string, id: string) {
  const [t] = await db.select().from(s.proposalTemplates).where(and(eq(s.proposalTemplates.id, id), eq(s.proposalTemplates.tenantId, tenantId))).limit(1);
  if (!t) throw notFound('Modelo de proposta não encontrado.');
  return t;
}
async function pagesOf(db: Parameters<typeof loadOpportunity>[0], tenantId: string, templateId: string) {
  return db.select({ id: s.proposalTemplatePages.id, position: s.proposalTemplatePages.position, width: s.proposalTemplatePages.width, height: s.proposalTemplatePages.height }).from(s.proposalTemplatePages).where(and(eq(s.proposalTemplatePages.templateId, templateId), eq(s.proposalTemplatePages.tenantId, tenantId))).orderBy(asc(s.proposalTemplatePages.position));
}
const checkVars = (b: z.infer<typeof TemplateBody>) => {
  const keys = new Set<string>();
  for (const v of b.variables) { if (keys.has(v.key)) throw unprocessable(`Variável repetida: ${v.key}`); if (v.key.includes('.')) throw unprocessable('Variável própria não pode ter ponto.'); keys.add(v.key); }
};


const renderFor = renderProposal;

export const proposalRoutes = [
  defineRoute({
    method: 'PUT', url: '/admin/proposal-templates/:id/branches', summary: 'Define em quais filiais este é o modelo padrão (gerado ao entrar na etapa Proposta)', tag: 'Propostas', ...ADMIN, params: IdParams,
    body: z.object({ branchIds: z.array(z.string().uuid()).max(100) }),
    handler: async ({ app, auth, params, body, req }) => {
      const t = await templateOr404(app.db, auth.tenantId, params.id);
      if (t.purpose !== 'proposta') throw unprocessable('Só modelos de proposta podem ser padrão da filial.');
      await app.db.transaction(async (tx) => {
        await tx.update(s.salesBranches).set({ defaultProposalTemplateId: null }).where(and(eq(s.salesBranches.tenantId, auth.tenantId), eq(s.salesBranches.defaultProposalTemplateId, t.id)));
        if (body.branchIds.length) await tx.update(s.salesBranches).set({ defaultProposalTemplateId: t.id }).where(and(eq(s.salesBranches.tenantId, auth.tenantId), inArray(s.salesBranches.id, body.branchIds)));
      });
      await audit(app.db, req, { action: 'proposal_template.branches', entityType: 'proposal_template', entityId: t.id, metadata: { branchIds: body.branchIds } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/opportunities/:id/proposal-draft', summary: 'Últimas escolhas da proposta (para editar e gerar de novo) e o modelo padrão da filial', tag: 'Propostas', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const [d] = await app.db.select().from(s.proposalDrafts).where(and(eq(s.proposalDrafts.opportunityId, o.id), eq(s.proposalDrafts.tenantId, auth.tenantId)));
      const def = await branchDefaultTemplate(app.db, auth.tenantId, o.branchId ?? null);
      return { draft: d ? { templateId: d.templateId, values: d.values, servicesText: d.servicesText, photos: d.photos, validityDays: d.validityDays, updatedAt: d.updatedAt } : null, branchDefaultTemplateId: def?.id ?? null };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/admin/proposal-templates',
    summary: 'Modelos (arte + campos + variáveis) de proposta ou de contrato (purpose=contrato)',
    tag: 'Propostas',
    ...ADMIN,
    query: z.object({ purpose: z.enum(['proposta', 'contrato']).default('proposta') }),
    handler: async ({ app, auth, query }) => {
      const rows = await app.db.select().from(s.proposalTemplates).where(and(eq(s.proposalTemplates.tenantId, auth.tenantId), eq(s.proposalTemplates.purpose, query.purpose))).orderBy(asc(s.proposalTemplates.name));
      const items = [];
      const branches = await app.db.select({ id: s.salesBranches.id, name: s.salesBranches.name, defaultTemplateId: s.salesBranches.defaultProposalTemplateId }).from(s.salesBranches).where(and(eq(s.salesBranches.tenantId, auth.tenantId), eq(s.salesBranches.active, true))).orderBy(asc(s.salesBranches.position), asc(s.salesBranches.name));
      for (const t of rows) items.push({ ...t, pages: await pagesOf(app.db, auth.tenantId, t.id), defaultBranchIds: branches.filter((b) => b.defaultTemplateId === t.id).map((b) => b.id) });
      const systemVariables = query.purpose === 'contrato' ? CONTRACT_TEMPLATE_VARIABLES : SYSTEM_VARIABLES.map(([key, label]) => ({ key, label }));
      return { items, systemVariables, branches: branches.map((b) => ({ id: b.id, name: b.name })) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/proposal-templates',
    summary: 'Cria modelo de proposta',
    tag: 'Propostas',
    ...ADMIN,
    body: TemplateBody,
    handler: async ({ app, auth, body, reply, req }) => {
      checkVars(body);
      const [t] = await app.db.insert(s.proposalTemplates).values({ tenantId: auth.tenantId, ...body }).returning();
      await audit(app.db, req, { action: 'proposal_template.create', entityType: 'proposal_template', entityId: t!.id, metadata: { name: body.name } });
      reply.code(201);
      return t;
    },
  }),
  defineRoute({
    method: 'PUT',
    url: '/admin/proposal-templates/:id',
    summary: 'Salva modelo: nome, tipos de deal, campos posicionados e variáveis próprias',
    tag: 'Propostas',
    ...ADMIN,
    params: IdParams,
    body: TemplateBody,
    handler: async ({ app, auth, params, body, req }) => {
      await templateOr404(app.db, auth.tenantId, params.id);
      checkVars(body);
      const [t] = await app.db.update(s.proposalTemplates).set({ ...body, updatedAt: new Date() }).where(eq(s.proposalTemplates.id, params.id)).returning();
      await audit(app.db, req, { action: 'proposal_template.update', entityType: 'proposal_template', entityId: params.id, metadata: { name: body.name, fields: body.fields.length } });
      return t;
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/proposal-templates/:id/pages',
    summary: 'Envia uma página da arte (PNG ou JPG exportado do Canva)',
    tag: 'Propostas',
    ...ADMIN,
    params: IdParams,
    bodyLimit: 12_000_000,
    body: z.object({ data: z.string().min(10).max(11_500_000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      await templateOr404(app.db, auth.tenantId, params.id);
      const data = Buffer.from(body.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (data.length > 8_000_000) throw unprocessable('Imagem maior que 8 MB. Exporte do Canva em PNG/JPG com qualidade menor.');
      const mime = data[0] === 0x89 && data[1] === 0x50 ? 'image/png' : data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg' : null;
      if (!mime) throw unprocessable('Envie a página como PNG ou JPG (no Canva: Compartilhar → Baixar → PNG).');
      let size: { width: number; height: number };
      try { size = await imageSize(mime, data); } catch { throw unprocessable('Não foi possível ler a imagem.'); }
      const [{ n } = { n: 0 }] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.proposalTemplatePages).where(eq(s.proposalTemplatePages.templateId, params.id));
      const [p] = await app.db.insert(s.proposalTemplatePages).values({ tenantId: auth.tenantId, templateId: params.id, position: n, mime, data, ...size }).returning({ id: s.proposalTemplatePages.id, position: s.proposalTemplatePages.position, width: s.proposalTemplatePages.width, height: s.proposalTemplatePages.height });
      reply.code(201);
      return p;
    },
  }),
  defineRoute({
    method: 'DELETE',
    url: '/admin/proposal-templates/:id/pages/:pageId',
    summary: 'Remove uma página da arte',
    tag: 'Propostas',
    ...ADMIN,
    params: PageParams,
    handler: async ({ app, auth, params, reply }) => {
      const r = await app.db.delete(s.proposalTemplatePages).where(and(eq(s.proposalTemplatePages.id, params.pageId), eq(s.proposalTemplatePages.templateId, params.id), eq(s.proposalTemplatePages.tenantId, auth.tenantId))).returning({ position: s.proposalTemplatePages.position });
      if (!r.length) throw notFound('Página não encontrada.');
      await app.db.update(s.proposalTemplatePages).set({ position: sql`${s.proposalTemplatePages.position} - 1` }).where(and(eq(s.proposalTemplatePages.templateId, params.id), sql`${s.proposalTemplatePages.position} > ${r[0]!.position}`));
      return reply.code(204).send();
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/proposal-templates/:id/pages/:pageId/image',
    summary: 'Imagem de uma página do modelo',
    tag: 'Propostas',
    module: 'oportunidades',
    params: PageParams,
    handler: async ({ app, auth, params, reply }) => {
      const [p] = await app.db.select({ mime: s.proposalTemplatePages.mime, data: s.proposalTemplatePages.data }).from(s.proposalTemplatePages).where(and(eq(s.proposalTemplatePages.id, params.pageId), eq(s.proposalTemplatePages.templateId, params.id), eq(s.proposalTemplatePages.tenantId, auth.tenantId))).limit(1);
      if (!p) throw notFound('Página não encontrada.');
      return reply.header('content-type', p.mime).header('cache-control', 'private, max-age=3600').header('content-security-policy', "default-src 'none'").send(p.data);
    },
  }),

  // ------------------------------------------------------------------ na oportunidade
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/proposal-templates',
    summary: 'Modelos de proposta para esta oportunidade (pelo tipo do deal), com os valores do sistema já preenchidos',
    tag: 'Propostas',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select().from(s.proposalTemplates).where(and(eq(s.proposalTemplates.tenantId, auth.tenantId), eq(s.proposalTemplates.active, true), eq(s.proposalTemplates.purpose, 'proposta'))).orderBy(asc(s.proposalTemplates.name));
      const items = [];
      for (const t of rows) {
        const pages = await pagesOf(app.db, auth.tenantId, t.id);
        if (!pages.length) continue;
        items.push({ id: t.id, name: t.name, segments: t.segments, matches: !t.segments.length || t.segments.includes(o.contactSegment), variables: t.variables, fields: t.fields, pages, sections: normalizeSections(t.sections) });
      }
      return { items: items.sort((a, b) => Number(b.matches) - Number(a.matches)), system: await systemValues(app.db, auth.tenantId, o.id, auth.timezone) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/proposal/preview', summary: 'Prévia exata do PDF da proposta (não anexa nem numera)', tag: 'Propostas', module: 'oportunidades', params: IdParams,
    body: GenBody, bodyLimit: 4_400_000,
    handler: async ({ app, auth, params, body, reply }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const t = await templateOr404(app.db, auth.tenantId, body.templateId);
      const out = await renderFor(app.db, auth, o.id, t, body);
      if (!out) throw unprocessable('O modelo ainda não tem páginas.');
      return reply.header('content-type', 'application/pdf').header('cache-control', 'no-store').send(out.pdf);
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/proposal',
    summary: 'Gera a proposta em PDF pelo modelo e anexa à oportunidade',
    tag: 'Propostas',
    module: 'oportunidades',
    params: IdParams,
    body: GenBody,
    bodyLimit: 4_400_000,
    handler: async ({ app, auth, params, body, req, reply }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const t = await templateOr404(app.db, auth.tenantId, body.templateId);
      const row = await app.db.transaction((tx) => generateProposal(tx, auth, o, t, body, { bump: true }));
      if (!row) throw unprocessable('O modelo ainda não tem páginas. Envie a arte em Configurações → Modelos de proposta.');
      await audit(app.db, req, { action: 'proposal.generate', entityType: 'opportunity', entityId: o.id, metadata: { template: t.name } });
      reply.code(201);
      return row;
    },
  }),
];
