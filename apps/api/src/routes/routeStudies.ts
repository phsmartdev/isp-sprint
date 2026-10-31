/**
 * Viabilidade técnica (só na instância Yepnet): mapa da rede (KMZ/KML lido no navegador) e traçado da CTO até o cliente.
 *
 * - O KMZ é lido no navegador e chega aqui já como lista de elementos; vem em partes (a Vercel recusa corpo > 4,5 MB):
 *   cria a versão, acrescenta as partes e ativa. Só a versão ativa aparece no mapa da oportunidade.
 * - O traçado é gravado como versão nova a cada "Salvar"; a metragem é recalculada aqui sobre os pontos recebidos.
 *   A imagem gerada no navegador vira anexo da oportunidade (PNG, até 3 MB) e o chamado no GLPI cita o traçado.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { NET_LIMITS, pathLengthM, validLatLng, type LatLng, type NetFeature } from '@isp/domain';
import { defineRoute } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { loadOpportunity } from '../services/opportunities';
import { BRAND } from '../brand';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
const IdParams = z.object({ id: z.string().uuid() });
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Só a Yepnet tem viabilidade técnica por mapa: nas outras instâncias as rotas não existem. */
function yepnetOnly() {
  if (BRAND.id !== 'yepnet') throw notFound('Recurso não disponível nesta instância.');
}

const Coord = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const Text = (n: number) => z.string().max(n * 4).transform((v) => v.trim().slice(0, n));
const Feature = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ponto'), name: Text(NET_LIMITS.nameChars), folder: Text(NET_LIMITS.nameChars).nullable(), description: Text(NET_LIMITS.descriptionChars).nullable(), at: Coord }),
  z.object({ kind: z.literal('linha'), name: Text(NET_LIMITS.nameChars), folder: Text(NET_LIMITS.nameChars).nullable(), description: Text(NET_LIMITS.descriptionChars).nullable(), path: z.array(Coord).min(2).max(20_000) }),
  z.object({ kind: z.literal('area'), name: Text(NET_LIMITS.nameChars), folder: Text(NET_LIMITS.nameChars).nullable(), description: Text(NET_LIMITS.descriptionChars).nullable(), ring: z.array(Coord).min(3).max(20_000) }),
]);
const Chunk = z.array(Feature).max(NET_LIMITS.features);

const vertices = (f: NetFeature) => (f.kind === 'ponto' ? 1 : f.kind === 'linha' ? f.path.length : f.ring.length);
const counts = (fs: NetFeature[]) => ({ points: fs.filter((f) => f.kind === 'ponto').length, lines: fs.filter((f) => f.kind === 'linha').length, areas: fs.filter((f) => f.kind === 'area').length });

async function activeMap(db: Parameters<typeof loadOpportunity>[0], tenantId: string) {
  const [m] = await db.select().from(s.networkMaps).where(and(eq(s.networkMaps.tenantId, tenantId), eq(s.networkMaps.active, true), isNull(s.networkMaps.deletedAt))).orderBy(desc(s.networkMaps.createdAt)).limit(1);
  return m ?? null;
}

const studyOut = (r: typeof s.routeStudies.$inferSelect & { createdByName?: string | null; attachmentName?: string | null }) => ({
  id: r.id, clientAt: [r.clientLat, r.clientLng] as LatLng, clientAddress: r.clientAddress, ctoName: r.ctoName, ctoAt: r.ctoLat != null && r.ctoLng != null ? [r.ctoLat, r.ctoLng] as LatLng : null,
  port: r.port, route: r.route, lengthM: r.lengthM, slackM: r.slackM, totalM: r.lengthM + r.slackM, notes: r.notes,
  attachmentId: r.attachmentId, attachmentName: r.attachmentName ?? null, glpiTicketId: r.glpiTicketId, createdAt: r.createdAt, createdByName: r.createdByName ?? null,
});

export const routeStudyRoutes = [
  // ------------------------------------------------------------------ mapa da rede (Configurações)
  defineRoute({
    method: 'GET', url: '/admin/network-maps', summary: 'Versões do mapa da rede (KMZ/KML), sem os elementos', tag: 'Viabilidade técnica', ...ADMIN,
    handler: async ({ app, auth }) => {
      yepnetOnly();
      const items = await app.db.select({ id: s.networkMaps.id, name: s.networkMaps.name, filename: s.networkMaps.filename, points: s.networkMaps.points, lines: s.networkMaps.lines, areas: s.networkMaps.areas, active: s.networkMaps.active, createdAt: s.networkMaps.createdAt, uploadedByName: s.users.name })
        .from(s.networkMaps).leftJoin(s.users, eq(s.users.id, s.networkMaps.uploadedBy))
        .where(and(eq(s.networkMaps.tenantId, auth.tenantId), isNull(s.networkMaps.deletedAt))).orderBy(desc(s.networkMaps.createdAt)).limit(30);
      return { items };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/network-maps', summary: 'Começa uma versão nova do mapa da rede com a primeira parte dos elementos (fica inativa até ativar)', tag: 'Viabilidade técnica', ...ADMIN,
    body: z.object({ name: z.string().trim().min(2).max(120), filename: z.string().trim().min(1).max(200), features: Chunk }), bodyLimit: 4_400_000,
    handler: async ({ app, auth, body, reply }) => {
      yepnetOnly();
      const fs = body.features as NetFeature[];
      const [row] = await app.db.insert(s.networkMaps).values({ tenantId: auth.tenantId, name: body.name, filename: body.filename, features: fs, ...counts(fs), active: false, uploadedBy: auth.userId })
        .returning({ id: s.networkMaps.id });
      reply.code(201);
      return { id: row!.id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/network-maps/:id/features', summary: 'Acrescenta uma parte dos elementos a uma versão ainda inativa', tag: 'Viabilidade técnica', ...ADMIN, params: IdParams,
    body: z.object({ features: Chunk }), bodyLimit: 4_400_000,
    handler: async ({ app, auth, params, body }) => {
      yepnetOnly();
      return app.db.transaction(async (tx) => {
        const [m] = await tx.select().from(s.networkMaps).where(and(eq(s.networkMaps.id, params.id), eq(s.networkMaps.tenantId, auth.tenantId), isNull(s.networkMaps.deletedAt))).for('update').limit(1);
        if (!m) throw notFound('Mapa não encontrado.');
        if (m.active) throw unprocessable('Esta versão já está ativa. Envie o arquivo de novo para criar outra versão.');
        const all = [...(m.features as NetFeature[]), ...(body.features as NetFeature[])];
        if (all.length > NET_LIMITS.features) throw unprocessable(`O mapa passa de ${NET_LIMITS.features.toLocaleString('pt-BR')} elementos. Envie só as camadas da rede de acesso (CTOs, cabos e áreas).`);
        if (all.reduce((n, f) => n + vertices(f), 0) > NET_LIMITS.vertices) throw unprocessable('O mapa tem pontos demais nos cabos. Simplifique as linhas no Google Earth ou envie só a região de atendimento.');
        await tx.update(s.networkMaps).set({ features: all, ...counts(all) }).where(eq(s.networkMaps.id, m.id));
        return { ok: true, ...counts(all) };
      });
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/network-maps/:id/activate', summary: 'Ativa esta versão do mapa da rede (a anterior fica no histórico)', tag: 'Viabilidade técnica', ...ADMIN, params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      yepnetOnly();
      return app.db.transaction(async (tx) => {
        const [m] = await tx.select({ id: s.networkMaps.id, name: s.networkMaps.name, points: s.networkMaps.points, lines: s.networkMaps.lines, areas: s.networkMaps.areas }).from(s.networkMaps)
          .where(and(eq(s.networkMaps.id, params.id), eq(s.networkMaps.tenantId, auth.tenantId), isNull(s.networkMaps.deletedAt))).limit(1);
        if (!m) throw notFound('Mapa não encontrado.');
        if (!m.points && !m.lines && !m.areas) throw unprocessable('Esta versão não tem nenhum elemento.');
        await tx.update(s.networkMaps).set({ active: false }).where(and(eq(s.networkMaps.tenantId, auth.tenantId), eq(s.networkMaps.active, true)));
        await tx.update(s.networkMaps).set({ active: true }).where(eq(s.networkMaps.id, m.id));
        await audit(tx, req, { action: 'network_map.activate', entityType: 'network_map', entityId: m.id, metadata: { name: m.name, points: m.points, lines: m.lines, areas: m.areas } });
        return { ok: true };
      });
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/admin/network-maps/:id', summary: 'Remove uma versão do mapa da rede (traçados já salvos não mudam)', tag: 'Viabilidade técnica', ...ADMIN, params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      yepnetOnly();
      const [m] = await app.db.update(s.networkMaps).set({ deletedAt: new Date(), active: false }).where(and(eq(s.networkMaps.id, params.id), eq(s.networkMaps.tenantId, auth.tenantId), isNull(s.networkMaps.deletedAt))).returning({ id: s.networkMaps.id, name: s.networkMaps.name });
      if (!m) throw notFound('Mapa não encontrado.');
      await audit(app.db, req, { action: 'network_map.delete', entityType: 'network_map', entityId: m.id, metadata: { name: m.name } });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ rede no mapa da oportunidade
  defineRoute({
    method: 'GET', url: '/network-map', summary: 'Elementos do mapa da rede ativo (para o traçado na oportunidade)', tag: 'Viabilidade técnica', module: 'oportunidades',
    handler: async ({ app, auth }) => {
      yepnetOnly();
      const m = await activeMap(app.db, auth.tenantId);
      return m ? { id: m.id, name: m.name, createdAt: m.createdAt, features: m.features as NetFeature[] } : { id: null, name: null, createdAt: null, features: [] as NetFeature[] };
    },
  }),

  // ------------------------------------------------------------------ traçados da oportunidade
  defineRoute({
    method: 'GET', url: '/opportunities/:id/route-studies', summary: 'Traçados de viabilidade técnica da oportunidade (o mais recente primeiro)', tag: 'Viabilidade técnica', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params }) => {
      yepnetOnly();
      await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select({ r: s.routeStudies, createdByName: s.users.name, attachmentName: s.opportunityAttachments.filename }).from(s.routeStudies)
        .leftJoin(s.users, eq(s.users.id, s.routeStudies.createdBy))
        .leftJoin(s.opportunityAttachments, and(eq(s.opportunityAttachments.id, s.routeStudies.attachmentId), isNull(s.opportunityAttachments.deletedAt)))
        .where(and(eq(s.routeStudies.tenantId, auth.tenantId), eq(s.routeStudies.opportunityId, params.id))).orderBy(desc(s.routeStudies.createdAt)).limit(20);
      return { items: rows.map((x) => studyOut({ ...x.r, createdByName: x.createdByName, attachmentName: x.attachmentName })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/route-studies', summary: 'Salva o traçado (versão nova), com a imagem como anexo da oportunidade', tag: 'Viabilidade técnica', module: 'oportunidades', params: IdParams,
    body: z.object({
      clientAt: Coord, clientAddress: z.string().trim().max(300).nullable().default(null),
      ctoName: z.string().trim().max(NET_LIMITS.nameChars).nullable().default(null), ctoAt: Coord.nullable().default(null),
      port: z.string().trim().max(40).nullable().default(null),
      route: z.array(Coord).min(2, 'Trace pelo menos dois pontos.').max(NET_LIMITS.routeVertices),
      slackM: z.number().int().min(0).max(5_000).default(0),
      notes: z.string().trim().max(2_000).nullable().default(null),
      image: z.string().max(4_300_000).nullable().default(null),
    }),
    bodyLimit: 4_400_000,
    handler: async ({ app, auth, params, body, req, reply }) => {
      yepnetOnly();
      const opp = await loadOpportunity(app.db, auth, params.id);
      if (!body.route.every(validLatLng)) throw unprocessable('Traçado com coordenada inválida.');
      const lengthM = Math.round(pathLengthM(body.route as LatLng[]));
      let image: Buffer | null = null;
      if (body.image) {
        const clean = body.image.replace(/^data:image\/png;base64,/, '');
        if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw unprocessable('Imagem inválida.');
        image = Buffer.from(clean, 'base64');
        const png = image.length > 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        if (!png) throw unprocessable('A imagem do traçado precisa ser PNG.');
        if (image.length > MAX_IMAGE_BYTES) throw unprocessable('A imagem do traçado passou de 3 MB. Aproxime o mapa e tente de novo.');
      }
      const map = await activeMap(app.db, auth.tenantId);
      const row = await app.db.transaction(async (tx) => {
        let attachmentId: string | null = null;
        if (image) {
          const stamp = new Date().toLocaleString('sv-SE', { timeZone: auth.timezone || 'America/Sao_Paulo' }).slice(0, 16).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
          const filename = `Viabilidade OP-${opp.code} ${stamp}.png`;
          const [a] = await tx.insert(s.opportunityAttachments).values({ tenantId: auth.tenantId, opportunityId: opp.id, kind: 'outro', filename, mime: 'image/png', sizeBytes: image.length, sha256: createHash('sha256').update(image).digest('hex'), data: image, uploadedBy: auth.userId })
            .returning({ id: s.opportunityAttachments.id });
          attachmentId = a!.id;
          await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'attachment_added', actorId: auth.userId, payload: { filename, kind: 'outro', sizeBytes: image.length }, rowVersion: opp.rowVersion });
        }
        const [r] = await tx.insert(s.routeStudies).values({
          tenantId: auth.tenantId, opportunityId: opp.id, clientLat: body.clientAt[0], clientLng: body.clientAt[1], clientAddress: body.clientAddress,
          ctoName: body.ctoName, ctoLat: body.ctoAt?.[0] ?? null, ctoLng: body.ctoAt?.[1] ?? null, port: body.port, route: body.route as LatLng[], lengthM, slackM: body.slackM,
          notes: body.notes, networkMapId: map?.id ?? null, attachmentId, createdBy: auth.userId,
        }).returning();
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'updated', actorId: auth.userId, rowVersion: opp.rowVersion,
          payload: { changed: { 'traçado de viabilidade': { from: null, to: `${lengthM} m + ${body.slackM} m de sobra${body.ctoName ? ` · ${body.ctoName}` : ''}${body.port ? ` porta ${body.port}` : ''}` } } } });
        return r!;
      });
      await audit(app.db, req, { action: 'route_study.create', entityType: 'opportunity', entityId: opp.id, metadata: { lengthM, slackM: body.slackM, ctoName: body.ctoName, port: body.port, vertices: body.route.length } });
      reply.code(201);
      return studyOut(row);
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/route-studies/:sid/ticket', summary: 'Liga o traçado ao chamado de viabilidade aberto no GLPI', tag: 'Viabilidade técnica', module: 'oportunidades',
    params: z.object({ id: z.string().uuid(), sid: z.string().uuid() }), body: z.object({ ticketId: z.string().uuid() }),
    handler: async ({ app, auth, params, body }) => {
      yepnetOnly();
      await loadOpportunity(app.db, auth, params.id);
      const [t] = await app.db.select({ id: s.glpiTickets.id }).from(s.glpiTickets).where(and(eq(s.glpiTickets.id, body.ticketId), eq(s.glpiTickets.tenantId, auth.tenantId), eq(s.glpiTickets.opportunityId, params.id))).limit(1);
      if (!t) throw notFound('Chamado não encontrado nesta oportunidade.');
      const [r] = await app.db.update(s.routeStudies).set({ glpiTicketId: t.id }).where(and(eq(s.routeStudies.id, params.sid), eq(s.routeStudies.opportunityId, params.id), eq(s.routeStudies.tenantId, auth.tenantId))).returning({ id: s.routeStudies.id });
      if (!r) throw notFound('Traçado não encontrado.');
      return { ok: true };
    },
  }),
];
