/** Chat interno, comentários e menções da negociação. */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ensureVacationAlerts, todayIn } from '../services/vacations';
import * as s from '../db/schema';
import { defineRoute, IdParams } from '../http/route';
import { audit } from '../services/audit';
import { publicLink } from '../services/alerts';
import { loadForAnalysis } from '../services/approvals';
import { chatOf, lastReadAt, markRead, mentionText, myMentions, notifyPeople, participants, unreadOf, validateMentions } from '../services/negotiation';

/** comentário do histórico aceita texto maior: a formatação (links, listas) ocupa espaço */
const CommentPost = z.object({ body: z.string().trim().min(1, 'Escreva o comentário').max(5000), mentions: z.array(z.string().uuid()).max(20).default([]) });
const Post = z.object({ body: z.string().trim().min(1, 'Escreva a mensagem').max(2000), mentions: z.array(z.string().uuid()).max(20).default([]) });

export const negotiationRoutes = [
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/chat',
    summary: 'Chat da negociação (com a última leitura de quem pede)',
    tag: 'Negociação',
    anyAuthenticated: true,
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { opp } = await loadForAnalysis(app.db, auth, params.id);
      return { items: await chatOf(app.db, auth.tenantId, opp.id), lastReadAt: await lastReadAt(app.db, auth.userId, opp.id) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/chat',
    summary: 'Envia mensagem no chat (interno). Menções com @ avisam por e-mail/WhatsApp.',
    tag: 'Negociação',
    anyAuthenticated: true,
    params: IdParams,
    body: Post,
    rateLimit: () => ({ max: 60, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body, reply }) => {
      const { opp } = await loadForAnalysis(app.db, auth, params.id);
      const people = await validateMentions(app.db, auth.tenantId, opp.id, body.mentions, auth.userId);
      const [m] = await app.db.insert(s.negotiationMessages).values({ tenantId: auth.tenantId, opportunityId: opp.id, authorId: auth.userId, kind: 'mensagem', body: body.body, mentions: people.map((p) => p.id) }).returning();
      await markRead(app.db, auth, opp.id);
      const notified = people.length ? await notifyPeople(app, auth.tenantId, opp.id, people, `${auth.name} mencionou você — OP-${opp.code}`, mentionText(auth.name, opp.code, opp.contactName, 'chat', body.body, publicLink(app.config, `/opportunities/${opp.id}?aba=chat`))) : [];
      reply.code(201);
      return { id: m!.id, kind: m!.kind, body: m!.body, authorId: auth.userId, authorName: auth.name, requestId: null, createdAt: m!.createdAt, mentions: people.map((p) => ({ id: p.id, name: p.name })), notified };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/read',
    summary: 'Marca o chat e os comentários desta negociação como lidos',
    tag: 'Negociação',
    anyAuthenticated: true,
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { opp } = await loadForAnalysis(app.db, auth, params.id);
      return { lastReadAt: await markRead(app.db, auth, opp.id) };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/unread',
    summary: 'Não lidas do chat e dos comentários (e menções a mim)',
    tag: 'Negociação',
    anyAuthenticated: true,
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { opp } = await loadForAnalysis(app.db, auth, params.id);
      return unreadOf(app.db, auth, opp.id);
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/participants',
    summary: 'Quem pode ser mencionado (tem acesso à negociação)',
    tag: 'Negociação',
    anyAuthenticated: true,
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { opp } = await loadForAnalysis(app.db, auth, params.id);
      return { items: (await participants(app.db, auth.tenantId, opp.id)).filter((u) => u.id !== auth.userId) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/comments',
    summary: 'Comentário formal no histórico da negociação (não pode ser editado nem apagado)',
    tag: 'Negociação',
    anyAuthenticated: true,
    params: IdParams,
    body: CommentPost,
    rateLimit: () => ({ max: 60, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const { opp } = await loadForAnalysis(app.db, auth, params.id);
      const people = await validateMentions(app.db, auth.tenantId, opp.id, body.mentions, auth.userId);
      const [e] = await app.db.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'comment', actorId: auth.userId, reason: body.body, payload: { mentions: people.map((p) => p.id), mentionNames: people.map((p) => p.name) }, rowVersion: opp.rowVersion }).returning({ id: s.opportunityEvents.id, occurredAt: s.opportunityEvents.occurredAt });
      await markRead(app.db, auth, opp.id);
      await audit(app.db, req, { action: 'opportunity.comment', entityType: 'opportunity', entityId: opp.id, metadata: { mentions: people.length } });
      const notified = people.length ? await notifyPeople(app, auth.tenantId, opp.id, people, `${auth.name} mencionou você — OP-${opp.code}`, mentionText(auth.name, opp.code, opp.contactName, 'comentário', body.body, publicLink(app.config, `/opportunities/${opp.id}?aba=historico`))) : [];
      reply.code(201);
      return { id: e!.id, occurredAt: e!.occurredAt, notified };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/me/mentions',
    summary: 'Onde me mencionaram (chat e comentários), com não lidas. scope: sino ou mencoes (cada painel tem o seu "Limpar")',
    tag: 'Negociação',
    anyAuthenticated: true,
    query: z.object({ scope: z.enum(['sino', 'mencoes']).default('sino') }),
    handler: async ({ app, auth, query }) => {
      // aviso de férias N dias antes (gerado aqui, quando o sino consulta)
      await ensureVacationAlerts(app.db, app.config, auth.tenantId, todayIn(auth.timezone)).catch((e) => console.error('aviso de férias', e));
      const [cl] = await app.db.select({ at: s.userFeedClears.clearedAt }).from(s.userFeedClears).where(and(eq(s.userFeedClears.userId, auth.userId), eq(s.userFeedClears.scope, query.scope))).limit(1);
      return myMentions(app.db, auth, cl?.at ?? null);
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/me/notificacoes/limpar',
    summary: 'Limpa o painel (sino ou menções): o que chegou até agora some; o que chegar depois aparece normalmente',
    tag: 'Negociação',
    anyAuthenticated: true,
    body: z.object({ scope: z.enum(['sino', 'mencoes']) }),
    handler: async ({ app, auth, body }) => {
      const now = new Date();
      await app.db.insert(s.userFeedClears).values({ tenantId: auth.tenantId, userId: auth.userId, scope: body.scope, clearedAt: now })
        .onConflictDoUpdate({ target: [s.userFeedClears.userId, s.userFeedClears.scope], set: { clearedAt: now } });
      return { ok: true, clearedAt: now };
    },
  }),
];
