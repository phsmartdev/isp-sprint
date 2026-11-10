/**
 * Pessoas & Cultura — publicações.
 * A visibilidade mora numa função só (feed, publicação, comentários e mídias usam a mesma regra), sempre no servidor.
 * Etapa 2: publicações para toda a organização; rascunhos só para o autor. A Etapa 3 acrescenta as comunidades aqui.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';
import type { AuthContext } from '../../http/context';
import { institutionalOf, publicCard } from './profiles';

/**
 * O que a pessoa pode ver: publicado para a organização; publicado numa comunidade pública ou institucional;
 * publicado numa comunidade privada da qual ela é membro; ou o que ela mesma escreveu (inclusive rascunho).
 * Nenhum papel (gestão, administração) amplia isso: conteúdo privado depende só de ser membro.
 */
export function postVisible(auth: AuthContext): SQL {
  return and(
    eq(s.peoplePosts.tenantId, auth.tenantId),
    isNull(s.peoplePosts.deletedAt),
    or(
      and(eq(s.peoplePosts.status, 'publicado'), eq(s.peoplePosts.audience, 'organizacao')),
      and(eq(s.peoplePosts.status, 'publicado'), eq(s.peoplePosts.audience, 'comunidade'), sql`exists (
        select 1 from people_communities c where c.id = ${s.peoplePosts.communityId} and c.tenant_id = ${auth.tenantId}
          and (c.kind <> 'privada' or exists (select 1 from people_community_members m where m.community_id = c.id and m.user_id = ${auth.userId})))`),
      eq(s.peoplePosts.authorId, auth.userId),
    ),
  )!;
}

/** O feed principal: o da organização mais o das comunidades em que a pessoa participa. */
export function inMyFeed(auth: AuthContext): SQL {
  return or(
    eq(s.peoplePosts.audience, 'organizacao'),
    sql`exists (select 1 from people_community_members m where m.community_id = ${s.peoplePosts.communityId} and m.user_id = ${auth.userId})`,
  )!;
}

export const AUDIENCE_LABEL: Record<string, string> = { organizacao: 'Toda a empresa', comunidade: 'Comunidade', segmentado: 'Público selecionado' };

type PostRow = typeof s.peoplePosts.$inferSelect;

/** Monta as publicações para a tela: autor (institucional), mídias, minha reação, se salvei e o resumo das reações. */
export async function postDtos(db: DbOrTx, auth: AuthContext, rows: PostRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const commIds = [...new Set(rows.map((r) => r.communityId).filter(Boolean) as string[])];
  const [people, media, mine, saved, byKind, communities] = await Promise.all([
    institutionalOf(db, auth.tenantId, rows.flatMap((r) => [r.authorId, ...r.mentions])),
    db.select({ id: s.peopleMedia.id, postId: s.peopleMedia.postId, kind: s.peopleMedia.kind, mime: s.peopleMedia.mime, filename: s.peopleMedia.filename, sizeBytes: s.peopleMedia.sizeBytes, position: s.peopleMedia.position })
      .from(s.peopleMedia).where(inArray(s.peopleMedia.postId, ids)).orderBy(s.peopleMedia.position),
    db.select({ postId: s.peopleReactions.postId, kind: s.peopleReactions.kind }).from(s.peopleReactions).where(and(inArray(s.peopleReactions.postId, ids), eq(s.peopleReactions.userId, auth.userId))),
    db.select({ postId: s.peopleSavedPosts.postId }).from(s.peopleSavedPosts).where(and(inArray(s.peopleSavedPosts.postId, ids), eq(s.peopleSavedPosts.userId, auth.userId))),
    db.select({ postId: s.peopleReactions.postId, kind: s.peopleReactions.kind, n: sql<number>`count(*)::int` }).from(s.peopleReactions).where(inArray(s.peopleReactions.postId, ids)).groupBy(s.peopleReactions.postId, s.peopleReactions.kind),
    commIds.length ? db.select({ id: s.peopleCommunities.id, name: s.peopleCommunities.name, kind: s.peopleCommunities.kind }).from(s.peopleCommunities).where(inArray(s.peopleCommunities.id, commIds)) : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const a = people.get(r.authorId);
    const comm = r.communityId ? communities.find((c) => c.id === r.communityId) : null;
    return {
      id: r.id, kind: r.kind, audience: r.audience, audienceLabel: comm ? comm.name : AUDIENCE_LABEL[r.audience] ?? r.audience, status: r.status,
      community: comm ? { id: comm.id, name: comm.name, kind: comm.kind } : null, pinnedAt: r.pinnedAt,
      body: r.body, publishedAt: r.publishedAt, editedAt: r.editedAt, createdAt: r.createdAt,
      author: a ? publicCard(a) : { id: r.authorId, name: 'Colaborador', jobTitle: null, hasPhoto: false, area: null, unit: null },
      mentions: r.mentions.map((m) => people.get(m)).filter(Boolean).map((p) => ({ id: p!.id, name: p!.name })),
      media: media.filter((m) => m.postId === r.id).map(({ postId: _p, position: _x, ...m }) => m),
      reactionCount: r.reactionCount, commentCount: r.commentCount,
      reactions: Object.fromEntries(byKind.filter((x) => x.postId === r.id).map((x) => [x.kind, x.n])),
      myReaction: mine.find((x) => x.postId === r.id)?.kind ?? null,
      saved: saved.some((x) => x.postId === r.id),
      mine: r.authorId === auth.userId,
    };
  });
}

/** Menções válidas: só colegas ativos da mesma empresa (o resto é descartado). */
export async function validMentions(db: DbOrTx, tenantId: string, ids: string[]) {
  const uniq = [...new Set(ids)].slice(0, 20);
  if (!uniq.length) return [];
  const rows = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), inArray(s.users.id, uniq)));
  return rows.map((r) => r.id);
}
