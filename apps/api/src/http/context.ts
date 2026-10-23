import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import {
  BUSINESS_MODULES, DEFAULT_ACTIONS, MODULES, SENSITIVE_ACTIONS, defaultTenantModule, gateAccess, mergeLevels, moduleDecision,
  type AccessLevel, type BusinessModule, type ModuleDecision, type ModuleGrant, type Module, type ReleaseMode, type Sector, type SensitiveAction,
} from '@isp/domain';
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
  /** Etapa 1: módulos de negócio ligados para a pessoa (e por quê), funcionalidades desligadas na empresa e ações sensíveis. */
  modules: Record<BusinessModule, boolean>;
  moduleReasons: Record<BusinessModule, ModuleDecision['reason']>;
  disabledFeatures: string[];
  actions: Record<SensitiveAction, boolean>;
  /** Nível do perfil antes de desligar módulos (só para mostrar "módulo desligado" em vez de "sem acesso"). */
  profileAccess: Record<Module, AccessLevel>;
};

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    config: Config;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
    rawBody: string | null;
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

  if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
    await app.db.update(s.sessions).set({ lastSeenAt: now }).where(eq(s.sessions.id, row.sessionId));
  }
  return buildAuth(app.db, row);
}

type UserBasics = { sessionId: string; userId: string; tenantId: string; name: string; email: string; jobTitle: string | null; sectors: string[] | null; timezone: string; tenantName: string };

/** Contexto de acesso de qualquer usuário ativo (ex.: conferir se a pessoa mencionada vê a negociação). */
export async function authForUser(db: DB, tenantId: string, userId: string): Promise<AuthContext | null> {
  const [row] = await db
    .select({ userId: s.users.id, tenantId: s.users.tenantId, name: s.users.name, email: s.users.email, jobTitle: s.users.jobTitle, sectors: s.users.sectors, active: s.users.active, timezone: s.tenants.timezone, tenantName: s.tenants.name })
    .from(s.users)
    .innerJoin(s.tenants, eq(s.tenants.id, s.users.tenantId))
    .where(and(eq(s.users.id, userId), eq(s.users.tenantId, tenantId)))
    .limit(1);
  if (!row || !row.active) return null;
  return buildAuth(db, { ...row, sessionId: '' });
}

async function buildAuth(db: DB, row: UserBasics): Promise<AuthContext> {
  const roleRows = await db
    .select({ key: s.roles.key, roleId: s.roles.id })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(and(eq(s.userRoles.userId, row.userId), eq(s.roles.tenantId, row.tenantId)));
  const policies = roleRows.length
    ? await db.select().from(s.accessPolicies).where(inArray(s.accessPolicies.roleId, roleRows.map((r) => r.roleId)))
    : [];
  const profileAccess = Object.fromEntries(
    MODULES.map((m) => [m, mergeLevels(policies.filter((p) => p.module === m).map((p) => p.level as AccessLevel))]),
  ) as Record<Module, AccessLevel>;

  const memberships = await db.select().from(s.teamMemberships).where(eq(s.teamMemberships.userId, row.userId));
  const ledTeams = memberships.filter((m) => m.isLead).map((m) => m.teamId);
  const members = ledTeams.length
    ? await db.select({ userId: s.teamMemberships.userId }).from(s.teamMemberships).where(inArray(s.teamMemberships.teamId, ledTeams))
    : [];

  // módulos de negócio: teto da empresa + liberação por equipe ou pessoa
  const teamIds = memberships.map((m) => m.teamId);
  const tms = await db.select().from(s.tenantModules).where(eq(s.tenantModules.tenantId, row.tenantId));
  const grants = await db.select().from(s.moduleGrants).where(and(eq(s.moduleGrants.tenantId, row.tenantId), inArray(s.moduleGrants.subjectId, [row.userId, ...teamIds])));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: row.timezone || 'America/Sao_Paulo' }).format(new Date());
  const decisions = Object.fromEntries(BUSINESS_MODULES.map((m) => {
    const t = tms.find((x) => x.module === m);
    const tm = t ? { module: m, enabled: t.enabled, mode: t.mode as ReleaseMode, disabledFeatures: t.disabledFeatures } : defaultTenantModule(m);
    return [m, moduleDecision(tm, grants.map((g) => ({ module: g.module as BusinessModule, subjectType: g.subjectType as 'equipe' | 'usuario', subjectId: g.subjectId, effect: g.effect as 'liberar' | 'bloquear', validUntil: g.validUntil })), { id: row.userId, teamIds }, today)];
  })) as Record<BusinessModule, ModuleDecision>;
  const modules = Object.fromEntries(BUSINESS_MODULES.map((m) => [m, decisions[m].enabled])) as Record<BusinessModule, boolean>;
  // ações sensíveis: linha gravada no perfil ou o padrão do perfil; vale se qualquer perfil permitir
  const actionRows = roleRows.length ? await db.select().from(s.actionPolicies).where(inArray(s.actionPolicies.roleId, roleRows.map((r) => r.roleId))) : [];
  const actions = Object.fromEntries(SENSITIVE_ACTIONS.map((a) => [a, roleRows.some((r) => {
    const saved = actionRows.find((x) => x.roleId === r.roleId && x.action === a);
    return saved ? saved.allowed : (DEFAULT_ACTIONS[r.key]?.[a] ?? false);
  })])) as Record<SensitiveAction, boolean>;

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
    access: gateAccess(profileAccess, modules),
    profileAccess,
    modules,
    moduleReasons: Object.fromEntries(BUSINESS_MODULES.map((m) => [m, decisions[m].reason])) as Record<BusinessModule, ModuleDecision['reason']>,
    disabledFeatures: [...new Set(tms.flatMap((x) => x.disabledFeatures))],
    actions,
    teamIds: memberships.map((m) => m.teamId),
    teamMemberIds: [...new Set([row.userId, ...members.map((m) => m.userId)])],
    sectors: (row.sectors ?? []) as Sector[],
  };
}
