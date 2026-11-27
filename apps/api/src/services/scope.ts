import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { atLeast, LEVEL_LABELS, MODULE_LABELS, type AccessLevel, type Module } from '@isp/domain';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { forbidden, unprocessable } from '../http/errors';

export const level = (auth: AuthContext, m: Module): AccessLevel => auth.access[m] ?? 'nenhum';

export function requireLevel(auth: AuthContext, m: Module, min: AccessLevel = 'proprio') {
  if (!atLeast(level(auth, m), min)) {
    throw forbidden(min === 'proprio' ? `Seu perfil não tem acesso a ${MODULE_LABELS[m]}.` : `Esta ação exige nível ${LEVEL_LABELS[min]} em ${MODULE_LABELS[m]}.`);
  }
}

/**
 * Filtro de carteira por nível do módulo — aplicado em TODA consulta do módulo.
 * Próprio: dono = usuário. Equipe: dono ∈ times que lidera (e registros sem dono, para distribuir).
 * Total: empresa inteira. Sempre restrito ao tenant da sessão.
 */
export function ownerScope(auth: AuthContext, m: Module, cols: { tenantId: PgColumn; ownerId: PgColumn; deletedAt?: PgColumn }): SQL {
  const parts: SQL[] = [eq(cols.tenantId, auth.tenantId)];
  if (cols.deletedAt) parts.push(isNull(cols.deletedAt));
  const l = level(auth, m);
  if (l === 'nenhum') parts.push(sql`false`);
  else if (l === 'proprio') parts.push(eq(cols.ownerId, auth.userId));
  else if (l === 'equipe') parts.push(or(inArray(cols.ownerId, auth.teamMemberIds), isNull(cols.ownerId))!);
  return and(...parts)!;
}

/** Para filtros de "responsável" em agregações (usuários visíveis no nível). */
export function visibleUserIds(auth: AuthContext, m: Module): string[] | 'all' {
  const l = level(auth, m);
  if (l === 'total') return 'all';
  if (l === 'equipe') return auth.teamMemberIds;
  if (l === 'proprio') return [auth.userId];
  return [];
}

/** Atribuir a alguém: só a si (Próprio), a membros dos seus times (Equipe) ou a qualquer um da empresa (Total). */
export async function assertAssignableUser(db: DbOrTx, auth: AuthContext, m: Module, userId: string) {
  const l = level(auth, m);
  if (userId !== auth.userId) {
    if (l === 'proprio' || l === 'nenhum') throw forbidden('Seu perfil não pode atribuir registros a outra pessoa.');
    if (l === 'equipe' && !auth.teamMemberIds.includes(userId)) throw forbidden('Só é possível atribuir a pessoas dos seus times.');
  }
  const [u] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.id, userId), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true)))
    .limit(1);
  if (!u) throw unprocessable('Responsável inválido.', [{ path: 'ownerId', message: 'Usuário não encontrado nesta empresa' }]);
}

/** Valida que referências pertencem ao tenant (evita IDOR por chave estrangeira). */
export async function assertTenantRefs(
  db: DbOrTx,
  auth: AuthContext,
  refs: { sourceId?: string | null; campaignId?: string | null; contactId?: string | null; planId?: string | null },
) {
  const checks: [string, PgColumn, PgColumn, string | null | undefined, typeof s.leadSources | typeof s.campaigns | typeof s.contacts | typeof s.plans][] = [
    ['sourceId', s.leadSources.id, s.leadSources.tenantId, refs.sourceId, s.leadSources],
    ['campaignId', s.campaigns.id, s.campaigns.tenantId, refs.campaignId, s.campaigns],
    ['contactId', s.contacts.id, s.contacts.tenantId, refs.contactId, s.contacts],
    ['planId', s.plans.id, s.plans.tenantId, refs.planId, s.plans],
  ];
  for (const [path, idCol, tenantCol, value, table] of checks) {
    if (!value) continue;
    const rows = await db.select({ id: idCol }).from(table).where(and(eq(idCol, value), eq(tenantCol, auth.tenantId))).limit(1);
    if (!rows.length) throw unprocessable('Referência inválida.', [{ path, message: 'Registro não encontrado nesta empresa' }]);
  }
}
