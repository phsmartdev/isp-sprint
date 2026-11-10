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

/** O que a pessoa pode ver: publicado para a organização, ou o que ela mesma escreveu (inclusive rascunho). */
export function postVisible(auth: AuthContext): SQL {
  return and(
    eq(s.peoplePosts.tenantId, auth.tenantId),
    isNull(s.peoplePosts.deletedAt),
    or(
      and(eq(s.peoplePosts.status, 'publicado'), eq(s.peoplePosts.audience, 'organizacao')),
      eq(s.peoplePosts.authorId, auth.userId),
    ),
  )!;
}

export const AUDIENCE_LABEL: Record<string, string> = { organizacao: 'Toda a empresa', comunidade: 'Comunidade', segmentado: 'Público selecionado' };

type PostRow = typeof s.peoplePosts.$inferSelect;

/** Monta as publicações para a tela: autor (institucional), mídias, minha reação, se salvei e o resumo das reações. */
export async function postDtos(db: DbOrTx, auth: AuthContext, rows: PostRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [people, media, mine, saved, byKind] = await Promise.all([
    institutionalOf(db, auth.tenantId, rows.flatMap((r) => [r.authorId, ...r.mentions])),
    db.select({ id: s.peopleMedia.id, postId: s.peopleMedia.postId, kind: s.peopleMedia.kind, mime: s.peopleMedia.mime, filename: s.peopleMedia.filename, sizeBytes: s.peopleMedia.sizeBytes, position: s.peopleMedia.position })
      .from(s.peopleMedia).where(inArray(s.peopleMedia.postId, ids)).orderBy(s.peopleMedia.position),
    db.select({ postId: s.peopleReactions.postId, kind: s.peopleReactions.kind }).from(s.peopleReactions).where(and(inArray(s.peopleReactions.postId, ids), eq(s.peopleReactions.userId, auth.userId))),
    db.select({ postId: s.peopleSavedPosts.postId }).from(s.peopleSavedPosts).where(and(inArray(s.peopleSavedPosts.postId, ids), eq(s.peopleSavedPosts.userId, auth.userId))),
    db.select({ postId: s.peopleReactions.postId, kind: s.peopleReactions.kind, n: sql<number>`count(*)::int` }).from(s.peopleReactions).where(inArray(s.peopleReactions.postId, ids)).groupBy(s.peopleReactions.postId, s.peopleReactions.kind),
  ]);
  return rows.map((r) => {
    const a = people.get(r.authorId);
    return {
      id: r.id, kind: r.kind, audience: r.audience, audienceLabel: AUDIENCE_LABEL[r.audience] ?? r.audience, status: r.status,
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
