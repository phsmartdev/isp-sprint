/**
 * Pessoas & Cultura — mensagens diretas, contadores do menu e destaques (colegas que publicaram há pouco).
 * Conversa é privada: só os dois participantes leem; nenhum papel administrativo abre conversas.
 */
import { and, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { eligibleMembers } from '../services/people/audience';
import { institutionalOf, publicCard } from '../services/people/profiles';
import { inMyFeed, postVisible } from '../services/people/posts';
import { BELL_EVENTS } from '../services/people/notify';
import { todayIn } from '../services/vacations';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';

const M = { tag: 'Pessoas & Cultura', module: 'pessoas' as const };
const Id = z.object({ id: z.string().uuid() });

async function membership(db: DbOrTx, auth: AuthContext, conversationId: string) {
  const [m] = await db.select().from(s.peopleConversationMembers).where(and(eq(s.peopleConversationMembers.conversationId, conversationId), eq(s.peopleConversationMembers.userId, auth.userId), eq(s.peopleConversationMembers.tenantId, auth.tenantId))).limit(1);
  if (!m) throw notFound('Conversa não encontrada.');
  return m;
}

export const peopleMessageRoutes = [
  defineRoute({
    method: 'GET', url: '/pessoas/mensagens', summary: 'Minhas conversas, com a última mensagem e as não lidas', ...M,
    handler: async ({ app, auth }) => {
      const rows = await app.db.execute<{ id: string; other: string; last_at: Date | null; last_body: string | null; last_author: string | null; unread: number }>(sql`
        select c.id, o.user_id as other, c.last_message_at as last_at,
               (select body from people_messages m where m.conversation_id = c.id and m.deleted_at is null order by created_at desc limit 1) as last_body,
               (select author_id from people_messages m where m.conversation_id = c.id and m.deleted_at is null order by created_at desc limit 1) as last_author,
               (select count(*)::int from people_messages m where m.conversation_id = c.id and m.deleted_at is null and m.author_id <> ${auth.userId} and (me.last_read_at is null or m.created_at > me.last_read_at)) as unread
          from people_conversation_members me
          join people_conversations c on c.id = me.conversation_id
          join people_conversation_members o on o.conversation_id = c.id and o.user_id <> me.user_id
         where me.tenant_id = ${auth.tenantId} and me.user_id = ${auth.userId} and c.last_message_at is not null
         order by c.last_message_at desc limit 100`);
      const people = await institutionalOf(app.db, auth.tenantId, rows.rows.map((r) => r.other));
      return {
        items: rows.rows.filter((r) => people.get(r.other)).map((r) => ({ id: r.id, with: publicCard(people.get(r.other)!), lastAt: r.last_at, last: r.last_body ? (r.last_author === auth.userId ? `Você: ${r.last_body}` : r.last_body).slice(0, 120) : null, unread: Number(r.unread) })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/mensagens/conversas', summary: 'Abre (ou reabre) a conversa direta com um colega', ...M,
    body: z.object({ userId: z.string().uuid() }),
    handler: async ({ app, auth, body }) => {
      if (body.userId === auth.userId) throw unprocessable('Escolha outro colega.');
      // só com quem também usa o módulo
      const eligible = await eligibleMembers(app.db, auth.tenantId, todayIn(auth.timezone));
      if (!eligible.has(body.userId)) throw unprocessable('Esta pessoa ainda não tem acesso a Pessoas & Cultura.');
      const pairKey = [auth.userId, body.userId].sort().join(':');
      const id = await app.db.transaction(async (tx) => {
        const [c] = await tx.insert(s.peopleConversations).values({ tenantId: auth.tenantId, pairKey }).onConflictDoNothing().returning({ id: s.peopleConversations.id });
        const conv = c ?? (await tx.select({ id: s.peopleConversations.id }).from(s.peopleConversations).where(and(eq(s.peopleConversations.tenantId, auth.tenantId), eq(s.peopleConversations.pairKey, pairKey))).limit(1))[0]!;
        await tx.insert(s.peopleConversationMembers).values([{ conversationId: conv.id, userId: auth.userId, tenantId: auth.tenantId }, { conversationId: conv.id, userId: body.userId, tenantId: auth.tenantId }]).onConflictDoNothing();
        return conv.id;
      });
      return { id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/mensagens/conversas/:id', summary: 'Mensagens da conversa (mais recentes; antes= para as anteriores) e marca como lida', ...M, params: Id,
    query: z.object({ antes: z.string().datetime().optional() }),
    handler: async ({ app, auth, params, query }) => {
      await membership(app.db, auth, params.id);
      const [other] = await app.db.select({ userId: s.peopleConversationMembers.userId, lastReadAt: s.peopleConversationMembers.lastReadAt }).from(s.peopleConversationMembers).where(and(eq(s.peopleConversationMembers.conversationId, params.id), ne(s.peopleConversationMembers.userId, auth.userId))).limit(1);
      const rows = await app.db.select({ id: s.peopleMessages.id, authorId: s.peopleMessages.authorId, body: s.peopleMessages.body, createdAt: s.peopleMessages.createdAt }).from(s.peopleMessages)
        .where(and(eq(s.peopleMessages.conversationId, params.id), isNull(s.peopleMessages.deletedAt), query.antes ? lt(s.peopleMessages.createdAt, new Date(query.antes)) : undefined))
        .orderBy(desc(s.peopleMessages.createdAt)).limit(51);
      if (!query.antes) await app.db.update(s.peopleConversationMembers).set({ lastReadAt: new Date() }).where(and(eq(s.peopleConversationMembers.conversationId, params.id), eq(s.peopleConversationMembers.userId, auth.userId)));
      const person = other ? (await institutionalOf(app.db, auth.tenantId, [other.userId])).get(other.userId) : null;
      return {
        with: person ? publicCard(person) : null,
        items: rows.slice(0, 50).reverse().map((m) => ({ ...m, mine: m.authorId === auth.userId, seen: m.authorId === auth.userId && !!other?.lastReadAt && other.lastReadAt >= m.createdAt })),
        more: rows.length > 50,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/mensagens/conversas/:id', summary: 'Envia mensagem na conversa', ...M, params: Id,
    rateLimit: () => ({ max: 40, timeWindow: '1 minute' }),
    body: z.object({ body: z.string().trim().min(1, 'Escreva a mensagem').max(2000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      await membership(app.db, auth, params.id);
      const now = new Date();
      const [m] = await app.db.transaction(async (tx) => {
        const r = await tx.insert(s.peopleMessages).values({ tenantId: auth.tenantId, conversationId: params.id, authorId: auth.userId, body: body.body, createdAt: now }).returning({ id: s.peopleMessages.id, createdAt: s.peopleMessages.createdAt });
        await tx.update(s.peopleConversations).set({ lastMessageAt: now }).where(eq(s.peopleConversations.id, params.id));
        await tx.update(s.peopleConversationMembers).set({ lastReadAt: now }).where(and(eq(s.peopleConversationMembers.conversationId, params.id), eq(s.peopleConversationMembers.userId, auth.userId)));
        return r;
      });
      reply.code(201);
      return m;
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/pessoas/mensagens/:id', summary: 'Apaga a própria mensagem (some para os dois)', ...M, params: Id,
    handler: async ({ app, auth, params, reply }) => {
      const [m] = await app.db.select({ authorId: s.peopleMessages.authorId }).from(s.peopleMessages).where(and(eq(s.peopleMessages.id, params.id), eq(s.peopleMessages.tenantId, auth.tenantId))).limit(1);
      if (!m) throw notFound('Mensagem não encontrada.');
      if (m.authorId !== auth.userId) throw forbidden('Só quem enviou apaga a mensagem.');
      await app.db.update(s.peopleMessages).set({ deletedAt: new Date() }).where(eq(s.peopleMessages.id, params.id));
      return reply.code(204).send();
    },
  }),

  // ------------------------------------------------------------------ menu do módulo
  defineRoute({
    method: 'GET', url: '/pessoas/contadores', summary: 'Contadores do menu: mensagens e notificações não lidas', ...M,
    handler: async ({ app, auth }) => {
      const [msg] = (await app.db.execute<{ n: number }>(sql`
        select count(*)::int as n from people_messages m join people_conversation_members me on me.conversation_id = m.conversation_id and me.user_id = ${auth.userId}
         where m.tenant_id = ${auth.tenantId} and m.deleted_at is null and m.author_id <> ${auth.userId} and (me.last_read_at is null or m.created_at > me.last_read_at)`)).rows;
      const [notif] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.userNotifications)
        .where(and(eq(s.userNotifications.tenantId, auth.tenantId), eq(s.userNotifications.userId, auth.userId), eq(s.userNotifications.module, 'pessoas'), isNull(s.userNotifications.readAt), sql`${s.userNotifications.event} not in (${sql.join(BELL_EVENTS.map((e) => sql`${e}`), sql`, `)})`));
      return { messages: Number(msg?.n ?? 0), notifications: Number(notif?.n ?? 0) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/destaques', summary: 'Colegas que publicaram nas últimas 48 horas (a fileira de fotos do topo do feed)', ...M,
    handler: async ({ app, auth }) => {
      const since = new Date(Date.now() - 48 * 3600 * 1000);
      const rows = await app.db.select({ authorId: s.peoplePosts.authorId, at: sql<Date>`max(${s.peoplePosts.publishedAt})` }).from(s.peoplePosts)
        .where(and(postVisible(auth), inMyFeed(auth), eq(s.peoplePosts.status, 'publicado'), gt(s.peoplePosts.publishedAt, since), ne(s.peoplePosts.kind, 'institucional')))
        .groupBy(s.peoplePosts.authorId).orderBy(sql`max(${s.peoplePosts.publishedAt}) desc`).limit(15);
      const people = await institutionalOf(app.db, auth.tenantId, rows.map((r) => r.authorId));
      return { items: rows.filter((r) => people.get(r.authorId)?.active).map((r) => ({ ...publicCard(people.get(r.authorId)!), at: r.at })) };
    },
  }),
];

