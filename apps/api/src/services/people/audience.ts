/**
 * Público de Pessoas & Cultura.
 *  - Elegíveis: pessoas ativas com o módulo liberado (empresa/equipe/pessoa) e nível no módulo "pessoas"
 *    — a mesma decisão do login (moduleDecision + matriz de acesso), calculada para todos de uma vez.
 *  - Segmento de comunicado: empresa toda, unidades/áreas (inclui as de baixo), cargos, times ou pessoas.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { defaultTenantModule, mergeLevels, moduleDecision, type AccessLevel, type BusinessModule, type ReleaseMode } from '@isp/domain';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';

export type Audience = { all: boolean; orgUnitIds: string[]; jobTitles: string[]; teamIds: string[]; userIds: string[] };
export type Member = { id: string; name: string; jobTitle: string | null; teamIds: string[]; orgUnitIds: string[] };

export async function eligibleMembers(db: DbOrTx, tenantId: string, today: string): Promise<Map<string, Member>> {
  const [users, memberships, teams, units, tm, grants, roles] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name, jobTitle: s.users.jobTitle }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true))),
    db.select({ userId: s.teamMemberships.userId, teamId: s.teamMemberships.teamId }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(and(eq(s.teams.tenantId, tenantId), isNull(s.teams.deletedAt))),
    db.select({ id: s.teams.id, orgUnitId: s.teams.orgUnitId }).from(s.teams).where(eq(s.teams.tenantId, tenantId)),
    db.select({ id: s.orgUnits.id, parentId: s.orgUnits.parentId }).from(s.orgUnits).where(eq(s.orgUnits.tenantId, tenantId)),
    db.select().from(s.tenantModules).where(and(eq(s.tenantModules.tenantId, tenantId), eq(s.tenantModules.module, 'pessoas_cultura'))).limit(1),
    db.select().from(s.moduleGrants).where(and(eq(s.moduleGrants.tenantId, tenantId), eq(s.moduleGrants.module, 'pessoas_cultura'))),
    db.select({ userId: s.userRoles.userId, level: s.accessPolicies.level }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).innerJoin(s.accessPolicies, and(eq(s.accessPolicies.roleId, s.roles.id), eq(s.accessPolicies.module, 'pessoas'))).where(eq(s.roles.tenantId, tenantId)),
  ]);
  const t = tm[0] ? { module: 'pessoas_cultura' as BusinessModule, enabled: tm[0].enabled, mode: tm[0].mode as ReleaseMode, disabledFeatures: tm[0].disabledFeatures } : defaultTenantModule('pessoas_cultura');
  const parent = new Map(units.map((u) => [u.id, u.parentId]));
  const chain = (id: string | null) => { const out: string[] = []; for (let c = id, g = 0; c && g < 30; c = parent.get(c) ?? null, g++) out.push(c); return out; };
  const teamUnit = new Map(teams.map((x) => [x.id, x.orgUnitId]));
  const gs = grants.map((g) => ({ module: g.module as BusinessModule, subjectType: g.subjectType as 'equipe' | 'usuario', subjectId: g.subjectId, effect: g.effect as 'liberar' | 'bloquear', validUntil: g.validUntil }));
  const out = new Map<string, Member>();
  for (const u of users) {
    const teamIds = memberships.filter((m) => m.userId === u.id).map((m) => m.teamId);
    const lv = mergeLevels(roles.filter((r) => r.userId === u.id).map((r) => r.level as AccessLevel));
    if (lv === 'nenhum' || !moduleDecision(t, gs, { id: u.id, teamIds }, today).enabled) continue;
    out.set(u.id, { ...u, teamIds, orgUnitIds: [...new Set(teamIds.flatMap((tid) => chain(teamUnit.get(tid) ?? null)))] });
  }
  return out;
}

/** A pessoa está no público do comunicado? (unidade/área vale para quem está nela ou abaixo dela) */
export function inAudience(a: Audience, m: Pick<Member, 'id' | 'jobTitle' | 'teamIds' | 'orgUnitIds'>) {
  if (a.all) return true;
  const title = (m.jobTitle ?? '').trim().toLowerCase();
  return a.userIds.includes(m.id) || a.teamIds.some((t) => m.teamIds.includes(t)) || a.orgUnitIds.some((u) => m.orgUnitIds.includes(u)) || (!!title && a.jobTitles.some((j) => j.trim().toLowerCase() === title));
}

/** Os dados de público da própria pessoa (para ver os comunicados dela sem calcular a empresa toda). */
export async function memberOf(db: DbOrTx, tenantId: string, user: { id: string; jobTitle: string | null; teamIds: string[] }): Promise<Pick<Member, 'id' | 'jobTitle' | 'teamIds' | 'orgUnitIds'>> {
  if (!user.teamIds.length) return { ...user, orgUnitIds: [] };
  const [teams, units] = await Promise.all([
    db.select({ orgUnitId: s.teams.orgUnitId }).from(s.teams).where(inArray(s.teams.id, user.teamIds)),
    db.select({ id: s.orgUnits.id, parentId: s.orgUnits.parentId }).from(s.orgUnits).where(eq(s.orgUnits.tenantId, tenantId)),
  ]);
  const parent = new Map(units.map((u) => [u.id, u.parentId]));
  const ids = new Set<string>();
  for (const t of teams) for (let c = t.orgUnitId, g = 0; c && g < 30; c = parent.get(c) ?? null, g++) ids.add(c);
  return { ...user, orgUnitIds: [...ids] };
}
