/**
 * Pessoas & Cultura — Etapa 2 (feed): publicações, rascunhos, mídias, comentários e respostas, reações e salvos.
 * Toda leitura passa por postVisible (servidor); quem não pode ver recebe 404, mesmo sabendo o ID.
 */
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { notifyComment, notifyPostMentions } from '../services/people/notify';
import { authorEdited } from '../services/people/moderation';
import { touchActivity } from './peopleAdmin';
import { todayIn } from '../services/vacations';
import { audit } from '../services/audit';
import { peopleCaps, peopleSettingsOf } from '../services/people/settings';
import { inMyFeed, postDtos, postVisible, validMentions } from '../services/people/posts';
import { communityPerms, loadCommunity } from '../services/people/communities';
import { visibleAnnouncementMedia } from './peopleCulture';
import { detectMedia, safeFilename } from '../services/people/media';
import { institutionalOf, publicCard } from '../services/people/profiles';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';

const tag = 'Pessoas & Cultura';
const M = { tag, module: 'pessoas' as const };
const Id = z.object({ id: z.string().uuid('ID inválido') });
const CHUNK = 2_500_000;
const PART_SERVE = 3_000_000;
const MAX_PARTS = 21; // 50 MB / 2,5 MB
const REACTIONS = ['curtir', 'celebrar', 'apoiar', 'inspirador'] as const;
const uuids = z.array(z.string().uuid()).max(20).default([]);

async function visiblePost(db: DbOrTx, auth: AuthContext, id: string) {
  const [p] = await db.select().from(s.peoplePosts).where(and(eq(s.peoplePosts.id, id), postVisible(auth))).limit(1);
  if (!p) throw notFound('Publicação não encontrada.');
  return p;
}
/** Só o autor mexe na própria publicação. */
async function ownPost(db: DbOrTx, auth: AuthContext, id: string) {
  const p = await visiblePost(db, auth, id);
  if (p.authorId !== auth.userId) throw forbidden('Só quem publicou pode alterar esta publicação.');
  return p;
}
/** Interagir só com publicação publicada (rascunho não recebe reação nem comentário). */
async function livePost(db: DbOrTx, auth: AuthContext, id: string) {
  const p = await visiblePost(db, auth, id);
  if (p.status !== 'publicado') throw unprocessable('Esta publicação ainda não foi publicada.');
  if (p.communityId) {
    const [c] = await db.select({ status: s.peopleCommunities.status }).from(s.peopleCommunities).where(eq(s.peopleCommunities.id, p.communityId)).limit(1);
    if (c?.status !== 'ativa') throw unprocessable('Comunidade arquivada: só leitura.');
  }
  return p;
}

/** Liga as mídias enviadas (do próprio autor, ainda soltas ou já desta publicação) à publicação, na ordem dada. */
async function attachMedia(db: DbOrTx, auth: AuthContext, postId: string, mediaIds: string[], max: number) {
  if (mediaIds.length > max) throw unprocessable(`No máximo ${max} mídias por publicação.`);
  if (mediaIds.length) {
    const own = await db.select({ id: s.peopleMedia.id }).from(s.peopleMedia)
      .where(and(eq(s.peopleMedia.tenantId, auth.tenantId), eq(s.peopleMedia.ownerId, auth.userId), isNull(s.peopleMedia.communityId), inArray(s.peopleMedia.id, mediaIds), or(isNull(s.peopleMedia.postId), eq(s.peopleMedia.postId, postId))));
    if (own.length !== new Set(mediaIds).size) throw unprocessable('Alguma mídia não é sua ou já está em outra publicação.');
  }
  // mídias que saíram da publicação são apagadas; as que ficam seguem a nova ordem
  await db.delete(s.peopleMedia).where(and(eq(s.peopleMedia.postId, postId), mediaIds.length ? sql`${s.peopleMedia.id} <> all(${sql`array[${sql.join(mediaIds.map((m) => sql`${m}::uuid`), sql`, `)}]`})` : undefined));
  for (const [position, id] of mediaIds.entries()) await db.update(s.peopleMedia).set({ postId, position }).where(eq(s.peopleMedia.id, id));
}

const PostBody = z.object({
  body: z.string().trim().max(5000).default(''),
  mediaIds: z.array(z.string().uuid()).max(10).default([]),
  mentions: uuids,
  /** institucional = em nome da empresa (só Comunicação) */
  kind: z.enum(['social', 'institucional']).default('social'),
  status: z.enum(['publicado', 'rascunho']).default('publicado'),
  /** comunidade de destino (vazio = toda a empresa) */
  communityId: z.string().uuid().nullable().optional(),
});

export const peopleFeedRoutes = [
  // ------------------------------------------------------------------ feed
  defineRoute({
    method: 'GET', url: '/pessoas/feed', summary: 'Feed: publicações visíveis, mais recentes ou relevantes (interações recentes), por página', ...M,
    query: z.object({
      ordem: z.enum(['recentes', 'relevantes']).default('recentes'),
      cursor: z.string().max(200).optional(),
      autor: z.string().uuid().optional(),
      comunidade: z.string().uuid().optional(),
      salvos: z.coerce.boolean().optional(),
      limite: z.coerce.number().int().min(1).max(30).default(10),
    }),
    handler: async ({ app, auth, query }) => {
      await touchActivity(app.db, auth.tenantId, auth.userId, todayIn(auth.timezone)).catch(() => undefined);
      // no próprio perfil, o autor vê também o que a moderação tirou do ar (com o motivo)
      const where = [postVisible(auth), query.autor === auth.userId ? inArray(s.peoplePosts.status, ['publicado', 'oculto', 'removido']) : eq(s.peoplePosts.status, 'publicado')];
      let pinned: (typeof s.peoplePosts.$inferSelect)[] = [];
      if (query.comunidade) {
        const { c, role } = await loadCommunity(app.db, auth, query.comunidade);
        if (!communityPerms(c, role, peopleCaps(auth, await peopleSettingsOf(app.db, auth.tenantId))).read) throw forbidden('Conteúdo só para membros desta comunidade.');
        where.push(eq(s.peoplePosts.communityId, c.id));
        // fixadas vêm à parte, no topo (só na primeira página) e saem da lista normal
        if (!query.cursor) pinned = await app.db.select().from(s.peoplePosts).where(and(...where, sql`${s.peoplePosts.pinnedAt} is not null`)).orderBy(desc(s.peoplePosts.pinnedAt)).limit(3);
        where.push(isNull(s.peoplePosts.pinnedAt));
      } else if (!query.autor && !query.salvos) where.push(inMyFeed(auth));
      if (query.autor) where.push(eq(s.peoplePosts.authorId, query.autor));
      if (query.salvos) where.push(sql`exists (select 1 from people_saved_posts sp where sp.post_id = ${s.peoplePosts.id} and sp.user_id = ${auth.userId})`);
      let rows: (typeof s.peoplePosts.$inferSelect)[];
      let next: string | null = null;
      if (query.ordem === 'relevantes' && !query.salvos) {
        // relevância simples e transparente: interações (comentário vale 2) amortecidas pelo tempo; nada pessoal
        const offset = query.cursor ? Math.max(0, Number(Buffer.from(query.cursor, 'base64url').toString()) || 0) : 0;
        rows = await app.db.select().from(s.peoplePosts).where(and(...where))
          .orderBy(sql`(${s.peoplePosts.reactionCount} + 2 * ${s.peoplePosts.commentCount} + 1) / power(extract(epoch from (now() - ${s.peoplePosts.publishedAt})) / 3600 + 2, 1.5) desc`, desc(s.peoplePosts.id))
          .limit(query.limite + 1).offset(offset);
        if (rows.length > query.limite) { rows = rows.slice(0, query.limite); next = Buffer.from(String(offset + query.limite)).toString('base64url'); }
      } else {
        // mais recentes: cursor pela data de publicação + id (estável, sem pular nem repetir)
        if (query.cursor) {
          const [at, id] = Buffer.from(query.cursor, 'base64url').toString().split('|');
          if (at && id && /^[0-9a-f-]{36}$/.test(id)) where.push(or(lt(s.peoplePosts.publishedAt, new Date(at)), and(eq(s.peoplePosts.publishedAt, new Date(at)), lt(s.peoplePosts.id, id)))!);
        }
        rows = await app.db.select().from(s.peoplePosts).where(and(...where)).orderBy(desc(s.peoplePosts.publishedAt), desc(s.peoplePosts.id)).limit(query.limite + 1);
        if (rows.length > query.limite) { rows = rows.slice(0, query.limite); const l = rows[rows.length - 1]!; next = Buffer.from(`${l.publishedAt!.toISOString()}|${l.id}`).toString('base64url'); }
      }
      return { items: await postDtos(app.db, auth, rows), pinned: pinned.length ? await postDtos(app.db, auth, pinned) : [], next };
    },
  }),

  defineRoute({
    method: 'GET', url: '/pessoas/rascunhos', summary: 'Meus rascunhos de publicação', ...M,
    handler: async ({ app, auth }) => {
      const rows = await app.db.select().from(s.peoplePosts).where(and(eq(s.peoplePosts.tenantId, auth.tenantId), eq(s.peoplePosts.authorId, auth.userId), eq(s.peoplePosts.status, 'rascunho'), isNull(s.peoplePosts.deletedAt))).orderBy(desc(s.peoplePosts.updatedAt)).limit(20);
      return { items: await postDtos(app.db, auth, rows) };
    },
  }),

  // ------------------------------------------------------------------ publicação
  defineRoute({
    method: 'POST', url: '/pessoas/posts', summary: 'Publica ou salva rascunho (texto, mídias, menções; institucional só com o papel de Comunicação)', ...M, body: PostBody,
    rateLimit: () => ({ max: 20, timeWindow: '1 minute' }),
    handler: async ({ app, auth, body, req, reply }) => {
      const st = await peopleSettingsOf(app.db, auth.tenantId);
      if (body.kind === 'institucional' && !peopleCaps(auth, st).communicate) throw forbidden('Publicar em nome da empresa exige o papel de Comunicação Interna.');
      if (body.body.length > st.limits.postChars) throw unprocessable(`Texto acima de ${st.limits.postChars} caracteres.`, [{ path: 'body', message: `No máximo ${st.limits.postChars} caracteres` }]);
      if (body.status === 'publicado' && !body.body && !body.mediaIds.length) throw unprocessable('Escreva algo ou adicione uma mídia.', [{ path: 'body', message: 'Obrigatório' }]);
      if (body.communityId) {
        const { c, role } = await loadCommunity(app.db, auth, body.communityId);
        if (!communityPerms(c, role, peopleCaps(auth, st)).post) throw forbidden(c.kind === 'institucional' ? 'Nesta comunidade só responsável e moderadores publicam.' : 'Participe da comunidade para publicar nela.');
      }
      const mentions = await validMentions(app.db, auth.tenantId, body.mentions);
      const post = await app.db.transaction(async (tx) => {
        const [p] = await tx.insert(s.peoplePosts).values({ tenantId: auth.tenantId, authorId: auth.userId, kind: body.kind, body: body.body, mentions, status: body.status, publishedAt: body.status === 'publicado' ? new Date() : null, audience: body.communityId ? 'comunidade' : 'organizacao', communityId: body.communityId ?? null }).returning();
        await attachMedia(tx, auth, p!.id, body.mediaIds, st.limits.mediaPerPost);
        return p!;
      });
      if (body.kind === 'institucional') await audit(app.db, req, { action: 'people.post.institutional', entityType: 'people_post', entityId: post.id });
      await notifyPostMentions(app.db, app.config, auth.tenantId, post, { id: auth.userId, name: auth.name }).catch((e) => console.error('aviso de menção', e));
      reply.code(201);
      return (await postDtos(app.db, auth, [post]))[0];
    },
  }),

  defineRoute({
    method: 'GET', url: '/pessoas/posts/:id', summary: 'Publicação com os comentários e respostas', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const p = await visiblePost(app.db, auth, params.id);
      const comments = await app.db.select().from(s.peopleComments)
        .where(and(eq(s.peopleComments.postId, p.id), eq(s.peopleComments.status, 'publicado'), isNull(s.peopleComments.deletedAt))).orderBy(asc(s.peopleComments.createdAt)).limit(500);
      const people = await institutionalOf(app.db, auth.tenantId, comments.flatMap((c) => [c.authorId, ...c.mentions]));
      return {
        post: (await postDtos(app.db, auth, [p]))[0],
        comments: comments.map((c) => ({
          id: c.id, parentId: c.parentId, body: c.body, createdAt: c.createdAt, editedAt: c.editedAt, mine: c.authorId === auth.userId,
          author: people.get(c.authorId) ? publicCard(people.get(c.authorId)!) : { id: c.authorId, name: 'Colaborador', jobTitle: null, hasPhoto: false, area: null, unit: null },
          mentions: c.mentions.map((m) => people.get(m)).filter(Boolean).map((x) => ({ id: x!.id, name: x!.name })),
        })),
      };
    },
  }),

  defineRoute({
    method: 'PATCH', url: '/pessoas/posts/:id', summary: 'Edita a própria publicação ou publica o rascunho', ...M, params: Id, body: PostBody.partial(),
    handler: async ({ app, auth, params, body }) => {
      const cur = await ownPost(app.db, auth, params.id);
      const st = await peopleSettingsOf(app.db, auth.tenantId);
      if (body.kind === 'institucional' && cur.kind !== 'institucional' && !peopleCaps(auth, st).communicate) throw forbidden('Publicar em nome da empresa exige o papel de Comunicação Interna.');
      const text = body.body ?? cur.body;
      if (text.length > st.limits.postChars) throw unprocessable(`Texto acima de ${st.limits.postChars} caracteres.`);
      if (body.status === 'rascunho' && cur.status === 'publicado') throw unprocessable('Publicação já publicada não volta a rascunho.');
      const publishing = body.status === 'publicado' && cur.status === 'rascunho';
      const p = await app.db.transaction(async (tx) => {
        if (body.mediaIds) await attachMedia(tx, auth, cur.id, body.mediaIds, st.limits.mediaPerPost);
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.peopleMedia).where(eq(s.peopleMedia.postId, cur.id)) as [{ n: number }];
        if ((body.status ?? cur.status) === 'publicado' && !text && !n) throw unprocessable('Escreva algo ou adicione uma mídia.');
        const [u] = await tx.update(s.peoplePosts).set({
          body: text, kind: body.kind ?? cur.kind, updatedAt: new Date(),
          ...(body.mentions ? { mentions: await validMentions(tx, auth.tenantId, body.mentions) } : {}),
          ...(publishing ? { status: 'publicado', publishedAt: new Date() } : cur.status === 'publicado' ? { editedAt: new Date() } : {}),
        }).where(eq(s.peoplePosts.id, cur.id)).returning();
        return u!;
      });
      // edição pedida pela moderação: ao editar, volta ao ar (e fica registrado para conferência)
      if (cur.status === 'oculto' && (await authorEdited(app.db, auth.tenantId, 'publicacao', cur.id, auth.userId))) p.status = 'publicado';
      await notifyPostMentions(app.db, app.config, auth.tenantId, p, { id: auth.userId, name: auth.name }).catch((e) => console.error('aviso de menção', e));
      return (await postDtos(app.db, auth, [p]))[0];
    },
  }),

  defineRoute({
    method: 'DELETE', url: '/pessoas/posts/:id', summary: 'Exclui a própria publicação (fica registrada para auditoria)', ...M, params: Id,
    handler: async ({ app, auth, params, req, reply }) => {
      const p = await ownPost(app.db, auth, params.id);
      await app.db.update(s.peoplePosts).set({ deletedAt: new Date(), deletedBy: auth.userId }).where(eq(s.peoplePosts.id, p.id));
      await audit(app.db, req, { action: 'people.post.delete', entityType: 'people_post', entityId: p.id });
      return reply.code(204).send();
    },
  }),

  // ------------------------------------------------------------------ reações e salvos
  defineRoute({
    method: 'PUT', url: '/pessoas/posts/:id/reacao', summary: 'Reage à publicação (uma reação por pessoa; trocar o tipo substitui)', ...M, params: Id,
    body: z.object({ kind: z.enum(REACTIONS).default('curtir') }),
    rateLimit: () => ({ max: 120, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body }) => {
      const p = await livePost(app.db, auth, params.id);
      await app.db.transaction(async (tx) => {
        const r = await tx.execute(sql`insert into people_reactions (post_id, user_id, tenant_id, kind) values (${p.id}, ${auth.userId}, ${auth.tenantId}, ${body.kind})
          on conflict (post_id, user_id) do update set kind = excluded.kind returning (xmax = 0) as inserted`);
        if ((r.rows[0] as { inserted: boolean }).inserted) await tx.update(s.peoplePosts).set({ reactionCount: sql`${s.peoplePosts.reactionCount} + 1` }).where(eq(s.peoplePosts.id, p.id));
      });
      return (await postDtos(app.db, auth, [await visiblePost(app.db, auth, p.id)]))[0];
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/pessoas/posts/:id/reacao', summary: 'Remove a própria reação', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const p = await visiblePost(app.db, auth, params.id);
      await app.db.transaction(async (tx) => {
        const del = await tx.delete(s.peopleReactions).where(and(eq(s.peopleReactions.postId, p.id), eq(s.peopleReactions.userId, auth.userId))).returning({ k: s.peopleReactions.kind });
        if (del.length) await tx.update(s.peoplePosts).set({ reactionCount: sql`greatest(${s.peoplePosts.reactionCount} - 1, 0)` }).where(eq(s.peoplePosts.id, p.id));
      });
      return (await postDtos(app.db, auth, [await visiblePost(app.db, auth, p.id)]))[0];
    },
  }),
  defineRoute({
    method: 'PUT', url: '/pessoas/posts/:id/salvo', summary: 'Salva a publicação para ver depois', ...M, params: Id,
    handler: async ({ app, auth, params, reply }) => {
      const p = await livePost(app.db, auth, params.id);
      await app.db.insert(s.peopleSavedPosts).values({ userId: auth.userId, postId: p.id, tenantId: auth.tenantId }).onConflictDoNothing();
      return reply.code(204).send();
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/pessoas/posts/:id/salvo', summary: 'Tira dos salvos', ...M, params: Id,
    handler: async ({ app, auth, params, reply }) => {
      await app.db.delete(s.peopleSavedPosts).where(and(eq(s.peopleSavedPosts.postId, params.id), eq(s.peopleSavedPosts.userId, auth.userId)));
      return reply.code(204).send();
    },
  }),

  // ------------------------------------------------------------------ comentários
  defineRoute({
    method: 'POST', url: '/pessoas/posts/:id/comentarios', summary: 'Comenta ou responde a um comentário', ...M, params: Id,
    body: z.object({ body: z.string().trim().min(1, 'Escreva o comentário').max(2000), parentId: z.string().uuid().nullable().default(null), mentions: uuids }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body, reply }) => {
      const p = await livePost(app.db, auth, params.id);
      let parentId = body.parentId;
      if (parentId) {
        const [parent] = await app.db.select({ id: s.peopleComments.id, parentId: s.peopleComments.parentId }).from(s.peopleComments).where(and(eq(s.peopleComments.id, parentId), eq(s.peopleComments.postId, p.id), isNull(s.peopleComments.deletedAt))).limit(1);
        if (!parent) throw unprocessable('Comentário respondido não encontrado.');
        parentId = parent.parentId ?? parent.id; // um nível de resposta: responder a uma resposta vai para a mesma conversa
      }
      const mentions = await validMentions(app.db, auth.tenantId, body.mentions);
      const c = await app.db.transaction(async (tx) => {
        const [c] = await tx.insert(s.peopleComments).values({ tenantId: auth.tenantId, postId: p.id, authorId: auth.userId, parentId, body: body.body, mentions }).returning({ id: s.peopleComments.id });
        await tx.update(s.peoplePosts).set({ commentCount: sql`${s.peoplePosts.commentCount} + 1` }).where(eq(s.peoplePosts.id, p.id));
        return c!;
      });
      await notifyComment(app.db, app.config, auth.tenantId, p, { id: c.id, parentId, mentions }, { id: auth.userId, name: auth.name }).catch((e) => console.error('aviso de comentário', e));
      reply.code(201);
      return { id: c.id, parentId };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/pessoas/comentarios/:id', summary: 'Edita o próprio comentário', ...M, params: Id,
    body: z.object({ body: z.string().trim().min(1).max(2000), mentions: uuids }),
    handler: async ({ app, auth, params, body }) => {
      const c = await ownComment(app.db, auth, params.id);
      await app.db.update(s.peopleComments).set({ body: body.body, mentions: await validMentions(app.db, auth.tenantId, body.mentions), editedAt: new Date() }).where(eq(s.peopleComments.id, c.id));
      if (c.status === 'oculto') await authorEdited(app.db, auth.tenantId, 'comentario', c.id, auth.userId);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/pessoas/comentarios/:id', summary: 'Remove o próprio comentário', ...M, params: Id,
    handler: async ({ app, auth, params, reply }) => {
      const c = await ownComment(app.db, auth, params.id);
      await app.db.transaction(async (tx) => {
        await tx.update(s.peopleComments).set({ deletedAt: new Date() }).where(eq(s.peopleComments.id, c.id));
        await tx.execute(sql`update people_posts set comment_count = (select count(*) from people_comments where post_id = ${c.postId} and status = 'publicado' and deleted_at is null) where id = ${c.postId}`);
      });
      return reply.code(204).send();
    },
  }),

  // ------------------------------------------------------------------ mídias
  defineRoute({
    method: 'PUT', url: '/pessoas/midias/envios/:uploadId/partes/:n', summary: 'Envia uma parte da mídia (cada requisição cabe no limite da hospedagem)', ...M,
    params: z.object({ uploadId: z.string().uuid(), n: z.coerce.number().int().min(0).max(MAX_PARTS - 1) }),
    body: z.object({ data: z.string().min(4).max(3_400_000) }), bodyLimit: 4_400_000,
    rateLimit: () => ({ max: 120, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body, reply }) => {
      const clean = body.data.replace(/^data:[^;]+;base64,/, '');
      if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw unprocessable('Arquivo inválido.');
      const data = Buffer.from(clean, 'base64');
      if (!data.length || data.length > CHUNK) throw unprocessable('Parte inválida.');
      // limpeza: partes abandonadas e mídias enviadas e não usadas há mais de um dia
      await app.db.delete(s.peopleMediaChunks).where(sql`${s.peopleMediaChunks.createdAt} < now() - interval '1 day'`);
      await app.db.delete(s.peopleMedia).where(and(eq(s.peopleMedia.tenantId, auth.tenantId), isNull(s.peopleMedia.postId), isNull(s.peopleMedia.communityId), isNull(s.peopleMedia.announcementId), sql`${s.peopleMedia.createdAt} < now() - interval '1 day'`));
      const r = await app.db.execute(sql`insert into people_media_chunks (tenant_id, upload_id, n, owner_id, data) values (${auth.tenantId}, ${params.uploadId}, ${params.n}, ${auth.userId}, ${data})
        on conflict (upload_id, n) do update set data = excluded.data, created_at = now() where people_media_chunks.owner_id = excluded.owner_id returning n`);
      if (!r.rows.length) throw forbidden('Este envio é de outra pessoa.');
      return reply.code(204).send();
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/midias/envios/:uploadId/concluir', summary: 'Conclui o envio: confere tipo e tamanho e guarda a mídia (ainda não publicada)', ...M,
    params: z.object({ uploadId: z.string().uuid() }),
    body: z.object({ filename: z.string().trim().min(1).max(200), parts: z.number().int().min(1).max(MAX_PARTS), sizeBytes: z.number().int().min(1).max(MAX_PARTS * CHUNK), width: z.number().int().min(1).max(20000).nullable().default(null), height: z.number().int().min(1).max(20000).nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const st = await peopleSettingsOf(app.db, auth.tenantId);
      const mine = and(eq(s.peopleMediaChunks.uploadId, params.uploadId), eq(s.peopleMediaChunks.tenantId, auth.tenantId), eq(s.peopleMediaChunks.ownerId, auth.userId));
      const [stt] = await app.db.select({ count: sql<number>`count(*)::int`, maxN: sql<number>`coalesce(max(${s.peopleMediaChunks.n}), -1)::int`, bytes: sql<number>`coalesce(sum(octet_length(${s.peopleMediaChunks.data})), 0)::bigint` }).from(s.peopleMediaChunks).where(mine);
      if (!stt || stt.count !== body.parts || stt.maxN !== body.parts - 1 || Number(stt.bytes) !== body.sizeBytes) throw unprocessable('O envio ficou incompleto. Tente de novo.');
      const [head] = await app.db.select({ data: sql<Buffer>`substring(${s.peopleMediaChunks.data} from 1 for 16)` }).from(s.peopleMediaChunks).where(and(mine, eq(s.peopleMediaChunks.n, 0)));
      const type = detectMedia(body.filename, Buffer.from(head!.data));
      const limitMb = !type ? 0 : type.kind === 'imagem' ? st.limits.imageMb : type.kind === 'video' ? st.limits.videoMb : Math.min(20, st.limits.videoMb);
      if (!type || body.sizeBytes > limitMb * 1024 * 1024) {
        await app.db.delete(s.peopleMediaChunks).where(mine);
        if (!type) throw unprocessable('Formato não aceito. Envie imagem (PNG, JPG, WebP, GIF), vídeo (MP4, MOV, WebM) ou documento (PDF, Word, Excel, PowerPoint).');
        throw unprocessable(`${type.kind === 'imagem' ? 'Imagem' : type.kind === 'video' ? 'Vídeo' : 'Arquivo'} acima de ${limitMb} MB.`);
      }
      const filename = safeFilename(body.filename);
      const row = await app.db.transaction(async (tx) => {
        const ins = await tx.execute<{ id: string; size_bytes: number }>(sql`
          insert into people_media (tenant_id, owner_id, kind, mime, filename, size_bytes, width, height, sha256, data)
          select ${auth.tenantId}, ${auth.userId}, ${type.kind}, ${type.mime}, ${filename}, octet_length(f.data), ${body.width}, ${body.height}, encode(sha256(f.data), 'hex'), f.data
          from (select string_agg(c.data, ''::bytea order by c.n) as data from people_media_chunks c where c.upload_id = ${params.uploadId} and c.tenant_id = ${auth.tenantId} and c.owner_id = ${auth.userId}) f
          returning id, size_bytes`);
        await tx.delete(s.peopleMediaChunks).where(mine);
        return ins.rows[0]!;
      });
      reply.code(201);
      return { id: row.id, kind: type.kind, mime: type.mime, filename, sizeBytes: Number(row.size_bytes), width: body.width, height: body.height };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/midias/:id', summary: 'Abre a mídia de uma publicação visível (vídeo em partes, por intervalo de bytes)', ...M, params: Id,
    handler: async ({ app, auth, params, req, reply }) => {
      const [m] = await app.db.select({ id: s.peopleMedia.id, postId: s.peopleMedia.postId, communityId: s.peopleMedia.communityId, announcementId: s.peopleMedia.announcementId, ownerId: s.peopleMedia.ownerId, mime: s.peopleMedia.mime, kind: s.peopleMedia.kind, filename: s.peopleMedia.filename, size: s.peopleMedia.sizeBytes, sha: s.peopleMedia.sha256 })
        .from(s.peopleMedia).where(and(eq(s.peopleMedia.id, params.id), eq(s.peopleMedia.tenantId, auth.tenantId))).limit(1);
      if (!m) throw notFound('Mídia não encontrada.');
      // capa/avatar de comunidade: como nome e descrição, visível a quem usa o módulo; solta (no editor): só o dono;
      // publicada: segue a visibilidade da publicação
      if (m.postId) await visiblePost(app.db, auth, m.postId);
      else if (m.announcementId) await visibleAnnouncementMedia(app.db, auth, m.announcementId);
      else if (!m.communityId && m.ownerId !== auth.userId) throw notFound('Mídia não encontrada.');
      reply.header('content-type', m.mime).header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=3600').header('etag', `"${m.sha}"`).header('accept-ranges', 'bytes')
        .header('content-security-policy', "default-src 'none'; media-src 'self'; img-src 'self'")
        .header('content-disposition', `${m.kind === 'arquivo' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(m.filename)}`);
      if (req.headers['if-none-match'] === `"${m.sha}"`) return reply.code(304).send();
      // a resposta da hospedagem tem limite: sempre por intervalo, no máximo ~3 MB por vez (o player pede o resto)
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      const start = range && range[1] ? Number(range[1]) : 0;
      if (start >= m.size) return reply.code(416).header('content-range', `bytes */${m.size}`).send();
      const wantedEnd = range && range[2] ? Number(range[2]) : m.size - 1;
      const end = Math.min(wantedEnd, start + PART_SERVE - 1, m.size - 1);
      const [part] = await app.db.select({ data: sql<Buffer>`substring(${s.peopleMedia.data} from ${start + 1} for ${end - start + 1})` }).from(s.peopleMedia).where(eq(s.peopleMedia.id, m.id));
      if (range || end < m.size - 1) reply.code(206).header('content-range', `bytes ${start}-${end}/${m.size}`);
      return reply.header('content-length', String(end - start + 1)).send(Buffer.from(part!.data));
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/pessoas/midias/:id', summary: 'Descarta mídia enviada e ainda não publicada', ...M, params: Id,
    handler: async ({ app, auth, params, reply }) => {
      await app.db.delete(s.peopleMedia).where(and(eq(s.peopleMedia.id, params.id), eq(s.peopleMedia.tenantId, auth.tenantId), eq(s.peopleMedia.ownerId, auth.userId), isNull(s.peopleMedia.postId), isNull(s.peopleMedia.communityId)));
      return reply.code(204).send();
    },
  }),
];

async function ownComment(db: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await db.select().from(s.peopleComments).where(and(eq(s.peopleComments.id, id), eq(s.peopleComments.tenantId, auth.tenantId), isNull(s.peopleComments.deletedAt))).limit(1);
  if (!c) throw notFound('Comentário não encontrado.');
  await visiblePost(db, auth, c.postId);
  if (c.authorId !== auth.userId) throw forbidden('Só quem comentou pode alterar este comentário.');
  return c;
}
