/**
 * Moderação de Pessoas & Cultura.
 *  - Quem modera: setores de Moderação/Comunicação/Pessoas e Cultura e a administração do módulo (caps.moderate) e,
 *    para conteúdo de uma comunidade, o responsável e os moderadores dela.
 *  - O moderador trabalha sobre a cópia do item denunciado; não ganha acesso ao resto da comunidade privada.
 *  - Ninguém decide denúncia sobre conteúdo próprio nem denúncia que fez. Quem denunciou não é revelado ao autor.
 *  - Medidas: manter (restaura se estava oculto), ocultar, remover, solicitar edição (fica oculto até o autor editar)
 *    e encaminhar (fica oculto e segue para a instância indicada — ex.: Canal de Confiança/CIEI).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';
import type { AuthContext } from '../../http/context';
import type { PeopleCaps } from './settings';

export const REASONS = { inadequado: 'Conteúdo inadequado', ofensivo: 'Linguagem ofensiva', exposicao: 'Exposição indevida de informações', assedio: 'Assédio ou discriminação', spam: 'Spam', outro: 'Outros' } as const;
export const MEASURES = { manter: 'Manter o conteúdo', ocultar: 'Ocultar temporariamente', remover: 'Remover', solicitar_edicao: 'Solicitar edição ao autor', encaminhar: 'Encaminhar para a instância responsável' } as const;
export type TargetType = 'publicacao' | 'comentario' | 'reconhecimento';
export type Measure = keyof typeof MEASURES;

/** Estado do conteúdo para cada medida (publicação/comentário; reconhecimento usa valido/oculto/removido). */
const contentStatus = (m: Measure) => (m === 'manter' ? 'publicado' : m === 'remover' ? 'removido' : 'oculto');

/** Comunidades em que a pessoa é responsável ou moderadora (modera o conteúdo delas). */
export async function moderatedCommunities(db: DbOrTx, auth: AuthContext) {
  const rows = await db.select({ id: s.peopleCommunityMembers.communityId }).from(s.peopleCommunityMembers)
    .where(and(eq(s.peopleCommunityMembers.tenantId, auth.tenantId), eq(s.peopleCommunityMembers.userId, auth.userId), inArray(s.peopleCommunityMembers.role, ['responsavel', 'moderador'])));
  return rows.map((r) => r.id);
}

/** Denúncias que a pessoa pode tratar. */
export async function reportScope(db: DbOrTx, auth: AuthContext, caps: PeopleCaps) {
  if (caps.moderate) return sql`true`;
  const comms = await moderatedCommunities(db, auth);
  if (!comms.length) return null;
  return sql`${s.peopleReports.communityId} in (${sql.join(comms.map((c) => sql`${c}::uuid`), sql`, `)})`;
}

/** Aplica a medida ao conteúdo (e ao post do reconhecimento público) e recalcula o contador de comentários. */
export async function applyMeasure(db: DbOrTx, tenantId: string, targetType: TargetType, targetId: string, measure: Measure) {
  const st = contentStatus(measure);
  if (targetType === 'publicacao') {
    await db.update(s.peoplePosts).set({ status: st, updatedAt: new Date() }).where(and(eq(s.peoplePosts.tenantId, tenantId), eq(s.peoplePosts.id, targetId), sql`${s.peoplePosts.status} <> 'rascunho'`));
    // publicação de reconhecimento: o reconhecimento segue a mesma medida
    await db.update(s.peopleRecognitions).set({ status: st === 'publicado' ? 'valido' : st }).where(and(eq(s.peopleRecognitions.tenantId, tenantId), eq(s.peopleRecognitions.postId, targetId)));
  } else if (targetType === 'comentario') {
    const [c] = await db.update(s.peopleComments).set({ status: st }).where(and(eq(s.peopleComments.tenantId, tenantId), eq(s.peopleComments.id, targetId))).returning({ postId: s.peopleComments.postId });
    if (c) await db.execute(sql`update people_posts set comment_count = (select count(*) from people_comments where post_id = ${c.postId} and status = 'publicado' and deleted_at is null) where id = ${c.postId}`);
  } else {
    const [r] = await db.update(s.peopleRecognitions).set({ status: st === 'publicado' ? 'valido' : st }).where(and(eq(s.peopleRecognitions.tenantId, tenantId), eq(s.peopleRecognitions.id, targetId))).returning({ postId: s.peopleRecognitions.postId });
    if (r?.postId) await db.update(s.peoplePosts).set({ status: st }).where(eq(s.peoplePosts.id, r.postId));
  }
}

/** Situação atual do conteúdo (para a fila). */
export async function contentState(db: DbOrTx, targetType: TargetType, targetId: string) {
  if (targetType === 'publicacao') { const [p] = await db.select({ status: s.peoplePosts.status, deleted: s.peoplePosts.deletedAt }).from(s.peoplePosts).where(eq(s.peoplePosts.id, targetId)); return p ? (p.deleted ? 'excluido' : p.status) : 'excluido'; }
  if (targetType === 'comentario') { const [c] = await db.select({ status: s.peopleComments.status, deleted: s.peopleComments.deletedAt }).from(s.peopleComments).where(eq(s.peopleComments.id, targetId)); return c ? (c.deleted ? 'excluido' : c.status) : 'excluido'; }
  const [r] = await db.select({ status: s.peopleRecognitions.status }).from(s.peopleRecognitions).where(eq(s.peopleRecognitions.id, targetId));
  return r ? (r.status === 'valido' ? 'publicado' : r.status) : 'excluido';
}

/** Autor editou conteúdo com edição solicitada: volta ao ar e fica registrado para a moderação conferir. */
export async function authorEdited(db: DbOrTx, tenantId: string, targetType: TargetType, targetId: string, actorId: string) {
  const [last] = await db.select({ measure: s.peopleModerationActions.measure }).from(s.peopleModerationActions)
    .where(and(eq(s.peopleModerationActions.tenantId, tenantId), eq(s.peopleModerationActions.targetType, targetType), eq(s.peopleModerationActions.targetId, targetId), sql`(${s.peopleModerationActions.measure} is not null or ${s.peopleModerationActions.action} = 'edicao_autor')`))
    .orderBy(sql`${s.peopleModerationActions.createdAt} desc`).limit(1);
  if (last?.measure !== 'solicitar_edicao') return false;
  await applyMeasure(db, tenantId, targetType, targetId, 'manter');
  await db.insert(s.peopleModerationActions).values({ tenantId, targetType, targetId, action: 'edicao_autor', measure: null, note: 'O autor editou o conteúdo após o pedido da moderação; voltou a ser exibido.', actorId });
  return true;
}
