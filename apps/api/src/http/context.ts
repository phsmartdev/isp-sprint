import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { MODULES, mergeLevels, type AccessLevel, type Module, type Sector } from '@isp/domain';
import type { DB } from '../db/client';
import type { Config } from '../config';
import * as s from '../db/schema';
import { hashToken } from '../auth/password';

export type AuthContext = {
  sessionId: string;
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  timezone: string;
  tenantName: string;
  profiles: string[];
  /** Nível efetivo por módulo (maior nível entre os perfis do usuário). */
  access: Record<Module, AccessLevel>;
  /** Times dos quais o usuário participa. */
  teamIds: string[];
  /** Usuários visíveis no nível "Equipe": membros dos times que ele LIDERA + ele mesmo. */
  teamMemberIds: string[];
  /** Setores do usuário (contratos): definem tarefas e quem conclui cada etapa. */
  sectors: Sector[];
};

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    config: Config;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export const SESSION_COOKIE = 'isp_session';

/** Resolve a sessão a partir do cookie. Nunca confia em tenant/usuário vindos do cliente. */
export async function resolveSession(app: FastifyInstance, req: FastifyRequest): Promise<AuthContext | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const now = new Date();
  const [row] = await app.db
    .select({
      sessionId: s.sessions.id,
      userId: s.users.id,
      tenantId: s.users.tenantId,
      name: s.users.name,
      email: s.users.email,
      jobTitle: s.users.jobTitle,
      sectors: s.users.sectors,
      active: s.users.active,
      timezone: s.tenants.timezone,
      tenantName: s.tenants.name,
      lastSeenAt: s.sessions.lastSeenAt,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .innerJoin(s.tenants, eq(s.tenants.id, s.users.tenantId))
    .where(and(eq(s.sessions.tokenHash, hashToken(unsigned.value)), isNull(s.sessions.revokedAt), gt(s.sessions.expiresAt, now)))
    .limit(1);
  if (!row || !row.active) return null;

  const roleRows = await app.db
    .select({ key: s.roles.key, roleId: s.roles.id })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(and(eq(s.userRoles.userId, row.userId), eq(s.roles.tenantId, row.tenantId)));
  const policies = roleRows.length
    ? await app.db.select().from(s.accessPolicies).where(inArray(s.accessPolicies.roleId, roleRows.map((r) => r.roleId)))
    : [];
  const access = Object.fromEntries(
    MODULES.map((m) => [m, mergeLevels(policies.filter((p) => p.module === m).map((p) => p.level as AccessLevel))]),
  ) as Record<Module, AccessLevel>;

  const memberships = await app.db.select().from(s.teamMemberships).where(eq(s.teamMemberships.userId, row.userId));
  const ledTeams = memberships.filter((m) => m.isLead).map((m) => m.teamId);
  const members = ledTeams.length
    ? await app.db.select({ userId: s.teamMemberships.userId }).from(s.teamMemberships).where(inArray(s.teamMemberships.teamId, ledTeams))
    : [];

  if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    await app.db.update(s.sessions).set({ lastSeenAt: now }).where(eq(s.sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    jobTitle: row.jobTitle,
    timezone: row.timezone,
    tenantName: row.tenantName,
    profiles: roleRows.map((r) => r.key),
    access,
    teamIds: memberships.map((m) => m.teamId),
    teamMemberIds: [...new Set([row.userId, ...members.map((m) => m.userId)])],
    sectors: (row.sectors ?? []) as Sector[],
  };
}
