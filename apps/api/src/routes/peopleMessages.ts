/**
 * Pessoas & Cultura — mensagens diretas, contadores do menu e destaques (colegas que publicaram há pouco).
 * Conversa é privada: só os dois participantes leem; nenhum papel administrativo abre conversas.
 */
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { eligibleMembers } from '../services/people/audience';
import { institutionalOf, publicCard } from '../services/people/profiles';
import { inMyFeed, postVisible } from '../services/people/posts';
import { BELL_EVENTS } from '../services/people/notify';
import { todayIn } from '../services/vacations';
import type { DB, DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';

const M = { tag: 'Pessoas & Cultura', module: 'pessoas' as const };
const Id = z.object({ id: z.string().uuid() });

async function membership(db: DbOrTx, auth: AuthContext, conversationId: string) {
  const [m] = await db.select().from(s.peopleConversationMembers).where(and(eq(s.peopleConversationMembers.conversationId, conversationId), eq(s.peopleConversationMembers.userId, auth.userId), eq(s.peopleConversationMembers.tenantId, auth.tenantId))).limit(1);
  if (!m) throw notFound('Conversa não encontrada.');
  return m;
}

/** Conversa direta com a pessoa (cria na primeira vez). */
async function directConversation(db: DbOrTx, auth: AuthContext, userId: string) {
  const pairKey = [auth.userId, userId].sort().join(':');
  return (db as DB).transaction(async (tx) => {
    const [c] = await tx.insert(s.peopleConversations).values({ tenantId: auth.tenantId, pairKey }).onConflictDoNothing().returning({ id: s.peopleConversations.id });
    const conv = c ?? (await tx.select({ id: s.peopleConversations.id }).from(s.peopleConversations).where(and(eq(s.peopleConversations.tenantId, auth.tenantId), eq(s.peopleConversations.pairKey, pairKey))).limit(1))[0]!;
    await tx.insert(s.peopleConversationMembers).values([{ conversationId: conv.id, userId: auth.userId, tenantId: auth.tenantId }, { conversationId: conv.id, userId, tenantId: auth.tenantId }]).onConflictDoNothing();
    return conv.id;
  });
}

async function sendMessage(db: DbOrTx, auth: AuthContext, conversationId: string, body: string, postId: string | null) {
  const now = new Date();
  return (db as DB).transaction(async (tx) => {
    const [m] = await tx.insert(s.peopleMessages).values({ tenantId: auth.tenantId, conversationId, authorId: auth.userId, body, postId, createdAt: now }).returning({ id: s.peopleMessages.id, createdAt: s.peopleMessages.createdAt });
    await tx.update(s.peopleConversations).set({ lastMessageAt: now }).where(eq(s.peopleConversations.id, conversationId));
    await tx.update(s.peopleConversationMembers).set({ lastReadAt: now }).where(and(eq(s.peopleConversationMembers.conversationId, conversationId), eq(s.peopleConversationMembers.userId, auth.userId)));
    return m!;
  });
}

/** Publicação enviada na conversa: só aparece para quem pode vê-la (comunidade privada fica "indisponível"). */
async function sharedPosts(db: DbOrTx, auth: AuthContext, ids: string[]) {
  const out = new Map<string, { id: string; unavailable: false; author: ReturnType<typeof publicCard> | null; excerpt: string; kind: string; imageId: string | null; meta: unknown }>();
  if (!ids.length) return out;
  const rows = await db.select().from(s.peoplePosts).where(and(inArray(s.peoplePosts.id, [...new Set(ids)]), postVisible(auth), eq(s.peoplePosts.status, 'publicado')));
  const people = await institutionalOf(db, auth.tenantId, rows.map((r) => r.authorId));
  const media = rows.length ? await db.select({ postId: s.peopleMedia.postId, id: s.peopleMedia.id, kind: s.peopleMedia.kind, position: s.peopleMedia.position }).from(s.peopleMedia).where(inArray(s.peopleMedia.postId, rows.map((r) => r.id))) : [];
  for (const r of rows) {
    const img = media.filter((m) => m.postId === r.id && m.kind === 'imagem').sort((a, b) => a.position - b.position)[0];
    out.set(r.id, { id: r.id, unavailable: false, author: people.get(r.authorId) ? publicCard(people.get(r.authorId)!) : null, excerpt: r.body.slice(0, 200), kind: r.kind, imageId: img?.id ?? null, meta: r.meta ?? null });
  }
  return out;
}

export const peopleMessageRoutes = [
  defineRoute({
    method: 'GET', url: '/pessoas/mensagens', summary: 'Minhas conversas (diretas e grupos), com a última mensagem e as não lidas', ...M,
    handler: async ({ app, auth }) => {
      const rows = await app.db.execute<{ id: string; kind: string; title: string | null; others: string[]; last_at: Date | null; last_body: string | null; last_post: string | null; last_author: string | null; unread: number }>(sql`
        select c.id, c.kind, c.title,
               array(select o.user_id from people_conversation_members o where o.conversation_id = c.id and o.user_id <> ${auth.userId} order by o.user_id limit 4) as others,
               coalesce(c.last_message_at, c.created_at) as last_at,
               lm.body as last_body, lm.post_id as last_post, lm.author_id as last_author,
               (select count(*)::int from people_messages m where m.conversation_id = c.id and m.deleted_at is null and m.author_id <> ${auth.userId} and (me.last_read_at is null or m.created_at > me.last_read_at)) as unread
          from people_conversation_members me
          join people_conversations c on c.id = me.conversation_id
          left join lateral (select body, post_id, author_id from people_messages m where m.conversation_id = c.id and m.deleted_at is null order by created_at desc limit 1) lm on true
         where me.tenant_id = ${auth.tenantId} and me.user_id = ${auth.userId} and (c.last_message_at is not null or c.kind = 'grupo')
         order by coalesce(c.last_message_at, c.created_at) desc limit 100`);
      const people = await institutionalOf(app.db, auth.tenantId, rows.rows.flatMap((r) => r.others));
      const authors = await institutionalOf(app.db, auth.tenantId, rows.rows.map((r) => r.last_author).filter(Boolean) as string[]);
      const preview = (r: (typeof rows.rows)[number]) => {
        if (!r.last_author) return null;
        const txt = r.last_body || (r.last_post ? 'Enviou uma publicação' : '');
        const who = r.last_author === auth.userId ? 'Você' : r.kind === 'grupo' ? authors.get(r.last_author)?.name.split(' ')[0] ?? '' : '';
        return (who ? `${who}: ${txt}` : txt).slice(0, 120);
      };
      return {
        items: rows.rows.filter((r) => r.kind === 'grupo' || people.get(r.others[0] ?? '')).map((r) => ({
          id: r.id, kind: r.kind, title: r.kind === 'grupo' ? r.title ?? 'Grupo' : people.get(r.others[0]!)!.name,
          with: r.kind === 'direta' ? publicCard(people.get(r.others[0]!)!) : null,
          members: r.others.map((o) => people.get(o)).filter(Boolean).map((p) => publicCard(p!)),
          lastAt: r.last_at, last: preview(r), unread: Number(r.unread),
        })),
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
      const id = await directConversation(app.db, auth, body.userId);
      return { id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/mensagens/conversas/:id', summary: 'Mensagens da conversa (mais recentes; antes= para as anteriores) e marca como lida', ...M, params: Id,
    query: z.object({ antes: z.string().datetime().optional() }),
    handler: async ({ app, auth, params, query }) => {
      await membership(app.db, auth, params.id);
      const [conv] = await app.db.select().from(s.peopleConversations).where(eq(s.peopleConversations.id, params.id)).limit(1);
      const others = await app.db.select({ userId: s.peopleConversationMembers.userId, lastReadAt: s.peopleConversationMembers.lastReadAt }).from(s.peopleConversationMembers).where(and(eq(s.peopleConversationMembers.conversationId, params.id), ne(s.peopleConversationMembers.userId, auth.userId)));
      const rows = await app.db.select({ id: s.peopleMessages.id, authorId: s.peopleMessages.authorId, body: s.peopleMessages.body, postId: s.peopleMessages.postId, createdAt: s.peopleMessages.createdAt }).from(s.peopleMessages)
        .where(and(eq(s.peopleMessages.conversationId, params.id), isNull(s.peopleMessages.deletedAt), query.antes ? lt(s.peopleMessages.createdAt, new Date(query.antes)) : undefined))
        .orderBy(desc(s.peopleMessages.createdAt)).limit(51);
      if (!query.antes) await app.db.update(s.peopleConversationMembers).set({ lastReadAt: new Date() }).where(and(eq(s.peopleConversationMembers.conversationId, params.id), eq(s.peopleConversationMembers.userId, auth.userId)));
      const people = await institutionalOf(app.db, auth.tenantId, [...others.map((o) => o.userId), ...rows.map((r) => r.authorId)]);
      const posts = await sharedPosts(app.db, auth, rows.map((r) => r.postId).filter(Boolean) as string[]);
      const seenAll = (at: Date) => others.length > 0 && others.every((o) => o.lastReadAt && o.lastReadAt >= at);
      const membersList = others.map((o) => people.get(o.userId)).filter(Boolean).map((p) => publicCard(p!));
      return {
        kind: conv!.kind, title: conv!.kind === 'grupo' ? conv!.title ?? 'Grupo' : membersList[0]?.name ?? '',
        with: conv!.kind === 'direta' ? membersList[0] ?? null : null, members: membersList,
        items: rows.slice(0, 50).reverse().map((m) => ({
          id: m.id, authorId: m.authorId, body: m.body, createdAt: m.createdAt, mine: m.authorId === auth.userId,
          author: people.get(m.authorId) ? publicCard(people.get(m.authorId)!) : null,
          post: m.postId ? posts.get(m.postId) ?? { id: m.postId, unavailable: true } : null,
          seen: m.authorId === auth.userId && seenAll(m.createdAt),
        })),
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
      reply.code(201);
      return sendMessage(app.db, auth, params.id, body.body, null);
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/mensagens/grupos', summary: 'Cria um grupo de conversa com colegas', ...M,
    body: z.object({ title: z.string().trim().min(2, 'Dê um nome ao grupo').max(60), userIds: z.array(z.string().uuid()).min(2, 'Escolha ao menos duas pessoas').max(49) }),
    handler: async ({ app, auth, body, reply }) => {
      const eligible = await eligibleMembers(app.db, auth.tenantId, todayIn(auth.timezone));
      const ids = [...new Set(body.userIds)].filter((u) => u !== auth.userId);
      if (ids.some((u) => !eligible.has(u))) throw unprocessable('Alguém escolhido ainda não tem acesso a Pessoas & Cultura.');
      const id = await app.db.transaction(async (tx) => {
        const [c] = await tx.insert(s.peopleConversations).values({ tenantId: auth.tenantId, kind: 'grupo', title: body.title, createdBy: auth.userId, pairKey: null }).returning({ id: s.peopleConversations.id });
        await tx.insert(s.peopleConversationMembers).values([auth.userId, ...ids].map((u) => ({ conversationId: c!.id, userId: u, tenantId: auth.tenantId })));
        return c!.id;
      });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/mensagens/conversas/:id/sair', summary: 'Sai de um grupo', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      await membership(app.db, auth, params.id);
      const [c] = await app.db.select({ kind: s.peopleConversations.kind }).from(s.peopleConversations).where(eq(s.peopleConversations.id, params.id)).limit(1);
      if (c?.kind !== 'grupo') throw unprocessable('Só dá para sair de grupos.');
      await app.db.delete(s.peopleConversationMembers).where(and(eq(s.peopleConversationMembers.conversationId, params.id), eq(s.peopleConversationMembers.userId, auth.userId)));
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/posts/:id/enviar', summary: 'Envia a publicação por mensagem para colegas e/ou grupos', ...M, params: Id,
    rateLimit: () => ({ max: 20, timeWindow: '1 minute' }),
    body: z.object({ userIds: z.array(z.string().uuid()).max(30).default([]), conversationIds: z.array(z.string().uuid()).max(30).default([]), note: z.string().trim().max(1000).default('') }),
    handler: async ({ app, auth, params, body }) => {
      const [p] = await app.db.select({ id: s.peoplePosts.id }).from(s.peoplePosts).where(and(eq(s.peoplePosts.id, params.id), postVisible(auth), eq(s.peoplePosts.status, 'publicado'))).limit(1);
      if (!p) throw notFound('Publicação não encontrada.');
      if (!body.userIds.length && !body.conversationIds.length) throw unprocessable('Escolha para quem enviar.');
      const convs = new Set<string>();
      if (body.userIds.length) {
        const eligible = await eligibleMembers(app.db, auth.tenantId, todayIn(auth.timezone));
        for (const u of new Set(body.userIds)) {
          if (u === auth.userId || !eligible.has(u)) continue;
          convs.add(await directConversation(app.db, auth, u));
        }
      }
      for (const c of new Set(body.conversationIds)) { await membership(app.db, auth, c); convs.add(c); }
      for (const c of convs) await sendMessage(app.db, auth, c, body.note, p.id);
      return { sent: convs.size };
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

