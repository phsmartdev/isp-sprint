/**
 * Quem tem um módulo de negócio, calculado para a empresa toda de uma vez — a mesma decisão do login
 * (módulo ligado e liberado para a pessoa/equipe/perfil + nível no módulo técnico pela matriz dos perfis).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { defaultTenantModule, mergeLevels, moduleDecision, type AccessLevel, type BusinessModule, type Module, type ReleaseMode } from '@isp/domain';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';

export async function usersWithModule(db: DbOrTx, tenantId: string, module: BusinessModule, technical: Module, today = new Date().toISOString().slice(0, 10)): Promise<Set<string>> {
  const [users, memberships, tm, grants, roles] = await Promise.all([
    db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true))),
    db.select({ userId: s.teamMemberships.userId, teamId: s.teamMemberships.teamId }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(and(eq(s.teams.tenantId, tenantId), isNull(s.teams.deletedAt))),
    db.select().from(s.tenantModules).where(and(eq(s.tenantModules.tenantId, tenantId), eq(s.tenantModules.module, module))).limit(1),
    db.select().from(s.moduleGrants).where(and(eq(s.moduleGrants.tenantId, tenantId), eq(s.moduleGrants.module, module))),
    db.select({ userId: s.userRoles.userId, key: s.roles.key, level: s.accessPolicies.level }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
      .leftJoin(s.accessPolicies, and(eq(s.accessPolicies.roleId, s.roles.id), eq(s.accessPolicies.module, technical))).where(eq(s.roles.tenantId, tenantId)),
  ]);
  const t = tm[0] ? { module, enabled: tm[0].enabled, mode: tm[0].mode as ReleaseMode, disabledFeatures: tm[0].disabledFeatures } : defaultTenantModule(module);
  const gs = grants.map((g) => ({ module: g.module as BusinessModule, subjectType: g.subjectType as 'equipe' | 'usuario', subjectId: g.subjectId, effect: g.effect as 'liberar' | 'bloquear', validUntil: g.validUntil }));
  const out = new Set<string>();
  for (const u of users) {
    const mine = roles.filter((r) => r.userId === u.id);
    const lv = mergeLevels(mine.map((r) => (r.level ?? 'nenhum') as AccessLevel));
    const teamIds = memberships.filter((m) => m.userId === u.id).map((m) => m.teamId);
    if (lv !== 'nenhum' && moduleDecision(t, gs, { id: u.id, teamIds, profiles: mine.map((r) => r.key) }, today).enabled) out.add(u.id);
  }
  return out;
}
