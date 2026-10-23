/** Chamados no GLPI a partir da negociação: abrir, acompanhar, responder e receber o retorno (webhook + releitura). */
import { timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { glpiOpen, glpiStatusLabel, glpiTicketErrors, glpiTicketUrl, webhookTicketId } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { AppError, notFound, unauthorized, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { DB } from '../db/client';
import { audit } from '../services/audit';
import { loadOpportunity } from '../services/opportunities';
import { integrationRow, logEvent } from '../services/integrations';
import { crcAnswer, GlpiError, glpiCategories, glpiConfig, glpiCreateTicket, glpiEntities, glpiFollowup, glpiGroups, syncTicket, validWebhookSignature, type GlpiCfg } from '../services/glpi';

const ENTITY_SYSTEM = 'glpi_entidade';
const TicketParams = z.object({ id: z.string().uuid('ID inválido') });
const HookParams = z.object({ token: z.string().min(20).max(64) });
const Search = z.object({ q: z.string().trim().max(80).optional() });

/** Erro do GLPI vira resposta clara para a tela (sem vazar detalhes internos além da mensagem). */
async function viaGlpi<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof GlpiError) throw new AppError(e.status === 404 ? 404 : 502, 'Falha no GLPI', e.message);
    throw e;
  }
}

async function ticketFor(app: { db: DB }, auth: Parameters<typeof loadOpportunity>[1], id: string) {
  const [t] = await app.db.select().from(s.glpiTickets).where(and(eq(s.glpiTickets.id, id), eq(s.glpiTickets.tenantId, auth.tenantId))).limit(1);
  if (!t) throw notFound('Chamado não encontrado.');
  const opp = await loadOpportunity(app.db, auth, t.opportunityId); // visibilidade da oportunidade vale para o chamado
  return { t, opp };
}

export const glpiRoutes = [
  defineRoute({
    method: 'GET', url: '/glpi/status', summary: 'A integração com o GLPI está pronta para abrir chamados?', tag: 'GLPI', module: 'oportunidades',
    handler: async ({ app, auth }) => {
      const r = await integrationRow(app.db, auth.tenantId, 'glpi');
      try { const c = await glpiConfig(app.db, auth.tenantId); return { ready: true, baseUrl: c.baseUrl, message: null }; }
      catch (e) { return { ready: false, baseUrl: null, message: r.enabled ? (e as Error).message : 'A integração com o GLPI ainda não foi ligada pela gerência.' }; }
    },
  }),
  defineRoute({
    method: 'GET', url: '/glpi/entities', summary: 'Entidades do GLPI (busca por nome) e a já vinculada ao cliente da oportunidade', tag: 'GLPI', module: 'oportunidades',
    query: Search.extend({ opportunityId: z.string().uuid().optional() }),
    handler: async ({ app, auth, query }) => {
      const c = await glpiConfig(app.db, auth.tenantId);
      let linked: { id: number; name: string | null } | null = null;
      if (query.opportunityId) {
        const opp = await loadOpportunity(app.db, auth, query.opportunityId);
        if (opp.customerId) {
          const [x] = await app.db.select().from(s.customerExternalIds).where(and(eq(s.customerExternalIds.tenantId, auth.tenantId), eq(s.customerExternalIds.customerId, opp.customerId), eq(s.customerExternalIds.system, ENTITY_SYSTEM))).limit(1);
          if (x) {
            const [last] = await app.db.select({ name: s.glpiTickets.entityName }).from(s.glpiTickets).where(and(eq(s.glpiTickets.tenantId, auth.tenantId), eq(s.glpiTickets.entityId, Number(x.externalId)))).orderBy(desc(s.glpiTickets.createdAt)).limit(1);
            linked = { id: Number(x.externalId), name: last?.name ?? null };
          }
        }
      }
      const items = await viaGlpi(() => glpiEntities(c, query.q));
      return { linked, items: items.map((e) => ({ id: e.id, name: e.completename || e.name })) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/glpi/categories', summary: 'Categorias de chamado do GLPI', tag: 'GLPI', module: 'oportunidades', query: Search,
    handler: async ({ app, auth, query }) => {
      const c = await glpiConfig(app.db, auth.tenantId);
      return { items: (await viaGlpi(() => glpiCategories(c, query.q))).map((e) => ({ id: e.id, name: e.completename || e.name })) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/glpi/groups', summary: 'Grupos técnicos do GLPI (para atribuir o chamado)', tag: 'GLPI', module: 'oportunidades', query: Search,
    handler: async ({ app, auth, query }) => {
      const c = await glpiConfig(app.db, auth.tenantId);
      return { items: (await viaGlpi(() => glpiGroups(c, query.q))).map((e) => ({ id: e.id, name: e.completename || e.name })) };
    },
  }),

  defineRoute({
    method: 'GET', url: '/opportunities/:id/glpi-tickets', summary: 'Chamados do GLPI abertos nesta oportunidade, com os retornos', tag: 'GLPI', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select({ t: s.glpiTickets, openedByName: s.users.name }).from(s.glpiTickets).innerJoin(s.users, eq(s.users.id, s.glpiTickets.openedBy))
        .where(and(eq(s.glpiTickets.tenantId, auth.tenantId), eq(s.glpiTickets.opportunityId, opp.id))).orderBy(desc(s.glpiTickets.createdAt));
      const ids = rows.map((r) => r.t.id);
      const events = ids.length ? await app.db.select({ e: s.glpiTicketEvents, actorName: s.users.name }).from(s.glpiTicketEvents).leftJoin(s.users, eq(s.users.id, s.glpiTicketEvents.actorId)).where(inArray(s.glpiTicketEvents.ticketId, ids)).orderBy(asc(s.glpiTicketEvents.occurredAt), asc(s.glpiTicketEvents.createdAt)) : [];
      const r = await integrationRow(app.db, auth.tenantId, 'glpi');
      const base = r.config.baseUrl ?? null;
      // quem é dono da oportunidade (ou abriu o chamado) "viu" os retornos ao abrir a aba
      const mine = rows.filter((x) => x.t.unseen > 0 && (opp.ownerId === auth.userId || x.t.openedBy === auth.userId)).map((x) => x.t.id);
      if (mine.length) await app.db.update(s.glpiTickets).set({ unseen: 0 }).where(inArray(s.glpiTickets.id, mine));
      return {
        items: rows.map(({ t, openedByName }) => ({
          id: t.id, glpiId: t.glpiId, title: t.title, entityName: t.entityName, categoryName: t.categoryName, groupName: t.groupName, type: t.type, urgency: t.urgency,
          status: t.status, statusName: t.statusName ?? glpiStatusLabel(t.status), open: glpiOpen(t.status), solvedAt: t.solvedAt, closedAt: t.closedAt,
          lastSyncAt: t.lastSyncAt, syncError: t.syncError, unseen: t.unseen, openedByName, createdAt: t.createdAt, url: base ? glpiTicketUrl(base, t.glpiId) : null,
          events: events.filter((x) => x.e.ticketId === t.id).map(({ e, actorName }) => ({ id: e.id, kind: e.kind, direction: e.direction, author: e.direction === 'saida' ? actorName : e.author, text: e.text, isPrivate: e.isPrivate, occurredAt: e.occurredAt })),
        })),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/opportunities/:id/glpi-tickets/unseen', summary: 'Quantos retornos do GLPI ainda não foram vistos nesta oportunidade', tag: 'GLPI', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select({ unseen: s.glpiTickets.unseen, status: s.glpiTickets.status }).from(s.glpiTickets).where(and(eq(s.glpiTickets.tenantId, auth.tenantId), eq(s.glpiTickets.opportunityId, opp.id)));
      return { total: rows.length, open: rows.filter((r) => glpiOpen(r.status)).length, unseen: rows.reduce((a, r) => a + r.unseen, 0) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/glpi-tickets', summary: 'Abre chamado no GLPI na entidade do cliente, ligado a esta oportunidade', tag: 'GLPI', module: 'oportunidades', params: IdParams,
    body: z.object({
      entityId: z.number().int().min(0), entityName: z.string().trim().max(300).nullable().optional(),
      categoryId: z.number().int().positive().nullable().optional(), categoryName: z.string().trim().max(300).nullable().optional(),
      groupId: z.number().int().positive().nullable().optional(), groupName: z.string().trim().max(300).nullable().optional(),
      type: z.number().int(), urgency: z.number().int(), title: z.string().trim().max(250), content: z.string().trim().max(20_000),
      rememberEntity: z.boolean().default(true),
    }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const errs = glpiTicketErrors(body);
      if (errs.length) throw unprocessable(errs[0]!.message, errs);
      const c = await glpiConfig(app.db, auth.tenantId);
      const [me] = await app.db.select({ name: s.users.name, email: s.users.email }).from(s.users).where(eq(s.users.id, auth.userId)).limit(1);
      const content = `${body.content}\n\n—\nAberto pelo ISP Sprint por ${me?.name ?? 'usuário'} (${me?.email ?? ''}) na oportunidade OP-${opp.code} · ${opp.contactName}.`;
      const created = await viaGlpi(() => glpiCreateTicket(c, { ...body, content }));
      const [row] = await app.db.transaction(async (tx) => {
        const r = await tx.insert(s.glpiTickets).values({
          tenantId: auth.tenantId, opportunityId: opp.id, customerId: opp.customerId, glpiId: created.id, entityId: body.entityId, entityName: body.entityName ?? null,
          categoryId: body.categoryId ?? null, categoryName: body.categoryName ?? null, groupId: created.groupWarning ? null : body.groupId ?? null, groupName: created.groupWarning ? null : body.groupName ?? null,
          type: body.type, urgency: body.urgency, title: body.title, status: 1, statusName: glpiStatusLabel(1), openedBy: auth.userId,
        }).returning();
        await tx.insert(s.glpiTicketEvents).values({ tenantId: auth.tenantId, ticketId: r[0]!.id, kind: 'Abertura', externalId: `Abertura:${created.id}`, direction: 'saida', author: null, text: body.content, occurredAt: new Date(Math.floor(Date.now() / 1000) * 1000), actorId: auth.userId });
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'glpi_ticket_opened', actorId: auth.userId, toValue: `#${created.id}`, reason: body.title.slice(0, 500), payload: { glpiId: created.id, entityId: body.entityId, entityName: body.entityName ?? null }, sourceSystem: 'crm' });
        if (body.rememberEntity && opp.customerId) {
          await tx.delete(s.customerExternalIds).where(and(eq(s.customerExternalIds.tenantId, auth.tenantId), eq(s.customerExternalIds.customerId, opp.customerId), eq(s.customerExternalIds.system, ENTITY_SYSTEM)));
          await tx.insert(s.customerExternalIds).values({ tenantId: auth.tenantId, customerId: opp.customerId, system: ENTITY_SYSTEM, externalId: String(body.entityId) }).onConflictDoNothing();
        }
        return r;
      });
      await audit(app.db, req, { action: 'glpi.ticket_open', entityType: 'opportunity', entityId: opp.id, metadata: { glpiId: created.id, entityId: body.entityId } });
      reply.code(201);
      return { id: row!.id, glpiId: created.id, warning: created.groupWarning ? `Chamado aberto, mas o grupo não foi atribuído: ${created.groupWarning}` : null };
    },
  }),
  defineRoute({
    method: 'POST', url: '/glpi-tickets/:id/followups', summary: 'Envia um acompanhamento ao chamado (visível para a equipe do GLPI)', tag: 'GLPI', module: 'oportunidades', params: TicketParams,
    body: z.object({ text: z.string().trim().min(3).max(10_000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const { t } = await ticketFor(app, auth, params.id);
      if (t.status === 6) throw unprocessable('O chamado está fechado no GLPI. Abra um novo chamado se precisar.');
      const c = await glpiConfig(app.db, auth.tenantId);
      const f = await viaGlpi(() => glpiFollowup(c, t.glpiId, body.text));
      await app.db.insert(s.glpiTicketEvents).values({ tenantId: auth.tenantId, ticketId: t.id, kind: 'Followup', externalId: `Followup:${f.id}`, direction: 'saida', text: body.text, occurredAt: new Date(Math.floor(Date.now() / 1000) * 1000), actorId: auth.userId }).onConflictDoNothing();
      reply.code(201);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/glpi-tickets/:id/sync', summary: 'Relê o chamado no GLPI agora', tag: 'GLPI', module: 'oportunidades', params: TicketParams,
    handler: async ({ app, auth, params }) => {
      const { t } = await ticketFor(app, auth, params.id);
      const c = await glpiConfig(app.db, auth.tenantId);
      return viaGlpi(() => syncTicket(app.db, c, t));
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/integrations/glpi/test', summary: 'Confere endereço, cliente OAuth e usuário de integração do GLPI', tag: 'Integrações', module: 'configuracoes', min: 'total',
    handler: async ({ app, auth }) => {
      let c: GlpiCfg;
      try { c = await glpiConfig(app.db, auth.tenantId, { requireEnabled: false }); } catch (e) { return { ok: false, message: (e as Error).message }; }
      try {
        const ents = await glpiEntities(c);
        const message = `Conectado. O usuário de integração enxerga ${ents.length}${ents.length === 50 ? '+' : ''} entidade(s).`;
        await logEvent(app.db, auth.tenantId, 'glpi', 'recebido', `Teste de conexão: ${message}`);
        return { ok: true, message };
      } catch (e) {
        await logEvent(app.db, auth.tenantId, 'glpi', 'erro', `Teste de conexão: ${(e as Error).message}`);
        return { ok: false, message: (e as Error).message };
      }
    },
  }),

  // ------------------------------------------------------------------ webhook do GLPI (público, por código secreto + assinatura)
  defineRoute({
    method: 'GET', url: '/hooks/glpi/:token', summary: 'Validação do endereço pelo GLPI (desafio crc_token)', tag: 'Integrações', public: true, params: HookParams,
    query: z.object({ crc_token: z.string().max(200).optional() }),
    handler: async ({ app, params, query, reply }) => {
      const r = await hookIntegration(app, params.token);
      const secret = await webhookSecret(app, r.tenantId);
      if (!query.crc_token || !secret) throw unauthorized();
      return reply.type('text/plain').send(crcAnswer(query.crc_token, secret));
    },
  }),
  defineRoute({
    method: 'POST', url: '/hooks/glpi/:token', summary: 'Aviso do GLPI (chamado, acompanhamento, solução ou tarefa criados/alterados)', tag: 'Integrações', public: true, params: HookParams,
    handler: async ({ app, params, req }) => {
      const r = await hookIntegration(app, params.token);
      const secret = await webhookSecret(app, r.tenantId);
      const raw = req.rawBody ?? '';
      const sig = req.headers['x-glpi-signature'];
      const ts = req.headers['x-glpi-timestamp'];
      if (!secret || !validWebhookSignature(raw, typeof ts === 'string' ? ts : undefined, typeof sig === 'string' ? sig : undefined, secret)) {
        await logEvent(app.db, r.tenantId, 'glpi', 'erro', 'Aviso recusado: assinatura ausente ou inválida.');
        throw unauthorized();
      }
      let payload: unknown = null;
      try { payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { payload = null; }
      const glpiId = webhookTicketId(payload);
      if (!glpiId) return { ok: true, ignored: 'sem chamado' };
      const [t] = await app.db.select().from(s.glpiTickets).where(and(eq(s.glpiTickets.tenantId, r.tenantId), eq(s.glpiTickets.glpiId, glpiId))).limit(1);
      if (!t) return { ok: true, ignored: 'chamado não aberto pelo CRM' };
      try {
        const c = await glpiConfig(app.db, r.tenantId);
        const res = await syncTicket(app.db, c, t);
        await logEvent(app.db, r.tenantId, 'glpi', 'recebido', `Chamado #${glpiId}: ${res.added} retorno(s) novo(s).`);
        return { ok: true, ...res };
      } catch (e) {
        await logEvent(app.db, r.tenantId, 'glpi', 'erro', `Chamado #${glpiId}: ${(e as Error).message}`);
        return { ok: false };
      }
    },
  }),
];

async function hookIntegration(app: { db: DB }, token: string) {
  const [r] = await app.db.select().from(s.integrations).where(and(eq(s.integrations.kind, 'glpi'), eq(s.integrations.webhookToken, token))).limit(1);
  if (!r || !sameLen(r.webhookToken, token)) throw notFound('Endereço de integração inválido.');
  return r;
}
const sameLen = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
async function webhookSecret(app: { db: DB }, tenantId: string) {
  try { return (await glpiConfig(app.db, tenantId, { requireEnabled: true })).webhookSecret; } catch { return null; }
}
