/**
 * Comunidades: papéis dentro da comunidade (responsável, moderador, membro) e o que cada um pode.
 * Administração do módulo gerencia comunidades e participantes, mas NÃO lê conteúdo de comunidade privada
 * sem ser membro (a leitura segue só postVisible).
 */
import { and, eq, sql } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';
import type { AuthContext } from '../../http/context';
import { notFound } from '../../http/errors';
import { level } from '../scope';
import type { PeopleCaps } from './settings';

export type CommunityRole = 'responsavel' | 'moderador' | 'membro';
export type CommunityRow = typeof s.peopleCommunities.$inferSelect;

export async function loadCommunity(db: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await db.select().from(s.peopleCommunities).where(and(eq(s.peopleCommunities.id, id), eq(s.peopleCommunities.tenantId, auth.tenantId))).limit(1);
  if (!c) throw notFound('Comunidade não encontrada.');
  const [m] = await db.select({ role: s.peopleCommunityMembers.role }).from(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.userId, auth.userId))).limit(1);
  return { c, role: (m?.role ?? null) as CommunityRole | null };
}

export function communityPerms(c: CommunityRow, role: CommunityRole | null, caps: PeopleCaps) {
  const active = c.status === 'ativa';
  const staff = role === 'responsavel' || role === 'moderador';
  return {
    /** ver as publicações */
    read: c.kind !== 'privada' || !!role,
    /** publicar: membro (na institucional, só responsável e moderadores) e comunidade ativa */
    post: active && !!role && (c.kind !== 'institucional' || staff),
    /** aprovar pedidos, convidar, remover membros comuns, fixar publicações */
    moderate: active && (staff || caps.administer),
    /** editar dados, definir moderadores e responsáveis, arquivar */
    manage: role === 'responsavel' || caps.administer,
    join: active && !role,
  };
}

export function canCreateCommunity(auth: AuthContext, caps: PeopleCaps, kind: string) {
  if (kind === 'institucional') return caps.administer || caps.communicate;
  return caps.administer || caps.communicate || ['equipe', 'total'].includes(level(auth, 'pessoas'));
}

export async function refreshMemberCount(db: DbOrTx, communityId: string) {
  await db.update(s.peopleCommunities).set({ memberCount: sql`(select count(*)::int from people_community_members m where m.community_id = ${communityId})`, updatedAt: new Date() }).where(eq(s.peopleCommunities.id, communityId));
}

export const KIND_LABEL: Record<string, string> = { publica: 'Pública', privada: 'Privada', institucional: 'Institucional' };
