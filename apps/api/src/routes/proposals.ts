/** Modelos de proposta (arte + campos variáveis) e geração do PDF da proposta na oportunidade. */
import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { loadOpportunity } from '../services/opportunities';
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

export const proposalRoutes = [
  defineRoute({
    method: 'GET',
    url: '/admin/proposal-templates',
    summary: 'Modelos de proposta com páginas, campos e variáveis',
    tag: 'Propostas',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const rows = await app.db.select().from(s.proposalTemplates).where(eq(s.proposalTemplates.tenantId, auth.tenantId)).orderBy(asc(s.proposalTemplates.name));
      const items = [];
      for (const t of rows) items.push({ ...t, pages: await pagesOf(app.db, auth.tenantId, t.id) });
      return { items, systemVariables: SYSTEM_VARIABLES.map(([key, label]) => ({ key, label })) };
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
      const rows = await app.db.select().from(s.proposalTemplates).where(and(eq(s.proposalTemplates.tenantId, auth.tenantId), eq(s.proposalTemplates.active, true))).orderBy(asc(s.proposalTemplates.name));
      const items = [];
      for (const t of rows) {
        const pages = await pagesOf(app.db, auth.tenantId, t.id);
        if (!pages.length) continue;
        items.push({ id: t.id, name: t.name, segments: t.segments, matches: !t.segments.length || t.segments.includes(o.contactSegment), variables: t.variables, fields: t.fields, pages });
      }
      return { items: items.sort((a, b) => Number(b.matches) - Number(a.matches)), system: await systemValues(app.db, auth.tenantId, o.id, auth.timezone) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/proposal',
    summary: 'Gera a proposta em PDF pelo modelo e anexa à oportunidade',
    tag: 'Propostas',
    module: 'oportunidades',
    params: IdParams,
    body: z.object({ templateId: z.string().uuid(), values: z.record(z.string(), z.string().max(2000)).default({}) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const t = await templateOr404(app.db, auth.tenantId, body.templateId);
      const custom = Object.fromEntries(t.variables.map((v) => [v.key, body.values[v.key] ?? v.default]));
      const vars = { ...(await systemValues(app.db, auth.tenantId, o.id, auth.timezone)), ...custom };
      const out = await buildProposalPdf(app.db, auth.tenantId, t.id, vars);
      if (!out) throw unprocessable('O modelo ainda não tem páginas. Envie a arte em Configurações → Modelos de proposta.');
      const filename = `Proposta ${o.contactName} - ${t.name}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 150);
      const row = await app.db.transaction(async (tx) => {
        const [r] = await tx.insert(s.opportunityAttachments).values({ tenantId: auth.tenantId, opportunityId: o.id, kind: 'proposta', filename, mime: 'application/pdf', sizeBytes: out.pdf.length, sha256: createHash('sha256').update(out.pdf).digest('hex'), data: out.pdf, uploadedBy: auth.userId }).returning({ id: s.opportunityAttachments.id, filename: s.opportunityAttachments.filename, sizeBytes: s.opportunityAttachments.sizeBytes });
        if (o.proposalStatus === 'nao_criada') await tx.update(s.opportunities).set({ proposalStatus: 'rascunho', updatedAt: new Date(), rowVersion: sql`${s.opportunities.rowVersion} + 1` }).where(eq(s.opportunities.id, o.id));
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'attachment_added', actorId: auth.userId, payload: { filename: r!.filename, kind: 'proposta', sizeBytes: out.pdf.length, template: t.name }, rowVersion: o.rowVersion });
        return r!;
      });
      await audit(app.db, req, { action: 'proposal.generate', entityType: 'opportunity', entityId: o.id, metadata: { template: t.name } });
      reply.code(201);
      return row;
    },
  }),
];
