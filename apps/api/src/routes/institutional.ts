/** Apresentação institucional (Central de Playbooks): selos e certificações em fila, um arquivo por selo. */
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { decodeImage } from '../services/images';

const T = { tag: 'Playbooks', anyAuthenticated: true as const };

const Rect = z.object({ x: z.number().min(-400).max(2000), y: z.number().min(-400).max(1300), w: z.number().min(40).max(2400), h: z.number().min(20).max(1600), scale: z.number().min(0.5).max(2).optional() });
const LayoutBody = z.object({ layout: z.object({ blocks: z.record(z.string().max(30), Rect), texts: z.record(z.string().max(30), z.string().max(600)) }).nullable() });

export const institutionalRoutes = [
  defineRoute({
    method: 'GET', url: '/institucional/layout/:slide', summary: 'Layout salvo de um slide (blocos e textos); sem layout, vale o padrão', ...T,
    params: z.object({ slide: z.string().regex(/^[a-z0-9-]{2,40}$/) }),
    handler: async ({ app, auth, params }) => {
      const [r] = await app.db.select().from(s.institutionalLayouts).where(and(eq(s.institutionalLayouts.tenantId, auth.tenantId), eq(s.institutionalLayouts.slide, params.slide))).limit(1);
      return { layout: r?.layout ?? null, canManage: auth.access.configuracoes === 'total' };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/institucional/layout/:slide', summary: 'Salva o layout de um slide (null volta ao padrão)', ...T,
    params: z.object({ slide: z.string().regex(/^[a-z0-9-]{2,40}$/) }), body: LayoutBody,
    handler: async ({ app, auth, params, body, req }) => {
      if (auth.access.configuracoes !== 'total') throw forbidden('Só a administração edita a apresentação.');
      if (!body.layout) await app.db.delete(s.institutionalLayouts).where(and(eq(s.institutionalLayouts.tenantId, auth.tenantId), eq(s.institutionalLayouts.slide, params.slide)));
      else await app.db.insert(s.institutionalLayouts).values({ tenantId: auth.tenantId, slide: params.slide, layout: body.layout, updatedBy: auth.userId }).onConflictDoUpdate({ target: [s.institutionalLayouts.tenantId, s.institutionalLayouts.slide], set: { layout: body.layout, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'institutional_layout.save', entityType: 'institutional_layout', entityId: params.slide, metadata: { reset: !body.layout } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/institucional/selos', summary: 'Selos e certificações da apresentação institucional, na ordem', ...T,
    handler: async ({ app, auth }) => ({
      items: await app.db.select({ id: s.institutionalSeals.id, name: s.institutionalSeals.name, position: s.institutionalSeals.position, sha256: s.institutionalSeals.sha256 }).from(s.institutionalSeals).where(eq(s.institutionalSeals.tenantId, auth.tenantId)).orderBy(asc(s.institutionalSeals.position), asc(s.institutionalSeals.createdAt)),
      canManage: auth.access.configuracoes === 'total',
    }),
  }),
  defineRoute({
    method: 'GET', url: '/institucional/selos/:id/imagem', summary: 'Imagem de um selo', ...T, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [a] = await app.db.select().from(s.institutionalSeals).where(and(eq(s.institutionalSeals.id, params.id), eq(s.institutionalSeals.tenantId, auth.tenantId))).limit(1);
      if (!a) throw notFound('Selo não encontrado.');
      return reply.header('content-type', a.mime).header('cache-control', 'private, max-age=300').header('etag', `"${a.sha256}"`).header('content-security-policy', "default-src 'none'").send(a.data);
    },
  }),
  defineRoute({
    method: 'POST', url: '/institucional/selos', summary: 'Adiciona um selo ou certificação (PNG, JPG ou WebP até 3 MB) ao fim da fila', ...T,
    body: z.object({ name: z.string().trim().min(1).max(120), data: z.string().min(16).max(4_200_000) }), bodyLimit: 4_400_000,
    handler: async ({ app, auth, body, req, reply }) => {
      if (auth.access.configuracoes !== 'total') throw forbidden('Só a administração envia os selos.');
      const img = decodeImage(body.data, 3 * 1024 * 1024);
      const [m] = await app.db.select({ p: sql<number>`coalesce(max(${s.institutionalSeals.position}), -1)::int` }).from(s.institutionalSeals).where(eq(s.institutionalSeals.tenantId, auth.tenantId));
      const [row] = await app.db.insert(s.institutionalSeals).values({ tenantId: auth.tenantId, name: body.name, position: (m?.p ?? -1) + 1, mime: img.mime, data: img.data, sizeBytes: img.data.length, sha256: img.sha256, createdBy: auth.userId }).returning({ id: s.institutionalSeals.id });
      await audit(app.db, req, { action: 'institutional_seal.create', entityType: 'institutional_seal', entityId: row!.id, metadata: { name: body.name } });
      reply.code(201);
      return row;
    },
  }),
  defineRoute({
    method: 'PUT', url: '/institucional/selos/ordem', summary: 'Reordena os selos (lista de ids na ordem desejada)', ...T,
    body: z.object({ ids: z.array(z.string().uuid()).max(40) }),
    handler: async ({ app, auth, body }) => {
      if (auth.access.configuracoes !== 'total') throw forbidden('Só a administração reordena os selos.');
      for (const [n, id] of body.ids.entries()) await app.db.update(s.institutionalSeals).set({ position: n }).where(and(eq(s.institutionalSeals.id, id), eq(s.institutionalSeals.tenantId, auth.tenantId)));
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/institucional/selos/:id', summary: 'Remove um selo', ...T, params: IdParams,
    handler: async ({ app, auth, params, req, reply }) => {
      if (auth.access.configuracoes !== 'total') throw forbidden('Só a administração remove os selos.');
      await app.db.delete(s.institutionalSeals).where(and(eq(s.institutionalSeals.id, params.id), eq(s.institutionalSeals.tenantId, auth.tenantId)));
      await audit(app.db, req, { action: 'institutional_seal.delete', entityType: 'institutional_seal', entityId: params.id });
      return reply.code(204).send();
    },
  }),
];
