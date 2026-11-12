import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
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
  /** Setores que a pessoa acompanha (inclui os de quem é só visualizador): servem para ver, não para atuar. */
  viewSectors: Sector[];
  /** Só visualiza os setores (não atua na operação). */
  sectorViewer: boolean;
  /** cargo nos setores: só liderança aprova */
  sectorRole: 'observador' | 'operador' | 'lideranca';
  /** Etapa 1: módulos de negócio ligados para a pessoa (e por quê), funcionalidades desligadas na empresa e ações sensíveis. */
  modules: Record<BusinessModule, boolean>;
  moduleReasons: Record<BusinessModule, ModuleDecision['reason']>;
  disabledFeatures: string[];
  actions: Record<SensitiveAction, boolean>;
  /** Nível do perfil antes de desligar módulos (só para mostrar "módulo desligado" em vez de "sem acesso"). */
  profileAccess: Record<Module, AccessLevel>;
  /** pode entrar de qualquer IP (exceção ao acesso por IP liberado) */
  ipBypass: boolean;
  /** método da requisição em curso (leituras podem ver mais que escritas, ex.: negociações do time) */
  requestMethod?: string;
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
      sectorViewer: s.users.sectorViewer,
      sectorRole: s.users.sectorRole,
      active: s.users.active,
      ipBypass: s.users.ipBypass,
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

type UserBasics = { sessionId: string; userId: string; tenantId: string; name: string; email: string; jobTitle: string | null; sectors: string[] | null; sectorViewer?: boolean | null; sectorRole?: string | null; timezone: string; tenantName: string; ipBypass?: boolean };

/** Contexto de acesso de qualquer usuário ativo (ex.: conferir se a pessoa mencionada vê a negociação). */
export async function authForUser(db: DB, tenantId: string, userId: string): Promise<AuthContext | null> {
  const [row] = await db
    .select({ userId: s.users.id, tenantId: s.users.tenantId, name: s.users.name, email: s.users.email, jobTitle: s.users.jobTitle, sectors: s.users.sectors, sectorViewer: s.users.sectorViewer, sectorRole: s.users.sectorRole, active: s.users.active, ipBypass: s.users.ipBypass, timezone: s.tenants.timezone, tenantName: s.tenants.name })
    .from(s.users)
    .innerJoin(s.tenants, eq(s.tenants.id, s.users.tenantId))
    .where(and(eq(s.users.id, userId), eq(s.users.tenantId, tenantId)))
    .limit(1);
  if (!row || !row.active) return null;
  return buildAuth(db, { ...row, sessionId: '' });
}

type AuthBundle = {
  roles: { key: string; roleId: string }[];
  policies: { roleId: string; module: string; level: string }[];
  memberships: { teamId: string; isLead: boolean }[];
  members: { userId: string }[];
  tms: { module: string; enabled: boolean; mode: string; disabledFeatures: string[] }[];
  grants: { module: string; subjectType: string; subjectId: string; effect: string; validUntil: string | null }[];
  actionRows: { roleId: string; action: string; allowed: boolean }[];
};

/**
 * Perfis, permissões, times, módulos e ações do usuário numa única ida ao banco.
 * Cada requisição autenticada passa por aqui: no banco remoto, cada consulta a menos é uma viagem a menos.
 */
async function authBundle(db: DB, userId: string, tenantId: string): Promise<AuthBundle> {
  const r = await db.execute<AuthBundle>(sql`
    with my_roles as (select r.id, r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${userId} and r.tenant_id = ${tenantId}),
         my_teams as (select team_id, is_lead from team_memberships where user_id = ${userId})
    select
      coalesce((select json_agg(json_build_object('key', key, 'roleId', id)) from my_roles), '[]') as roles,
      coalesce((select json_agg(json_build_object('roleId', role_id, 'module', module, 'level', level)) from access_policies where role_id in (select id from my_roles)), '[]') as policies,
      coalesce((select json_agg(json_build_object('teamId', team_id, 'isLead', is_lead)) from my_teams), '[]') as memberships,
      coalesce((select json_agg(distinct jsonb_build_object('userId', user_id)) from team_memberships where team_id in (select team_id from my_teams where is_lead)), '[]') as members,
      coalesce((select json_agg(json_build_object('module', module, 'enabled', enabled, 'mode', mode, 'disabledFeatures', disabled_features)) from tenant_modules where tenant_id = ${tenantId}), '[]') as tms,
      coalesce((select json_agg(json_build_object('module', module, 'subjectType', subject_type, 'subjectId', subject_id, 'effect', effect, 'validUntil', valid_until))
                  from module_grants where tenant_id = ${tenantId} and (subject_id = ${userId} or subject_id in (select team_id from my_teams))), '[]') as grants,
      coalesce((select json_agg(json_build_object('roleId', role_id, 'action', action, 'allowed', allowed)) from action_policies where role_id in (select id from my_roles)), '[]') as "actionRows"`);
  return r.rows[0]!;
}

async function buildAuth(db: DB, row: UserBasics): Promise<AuthContext> {
  const { roles: roleRows, policies, memberships, members, tms, grants, actionRows } = await authBundle(db, row.userId, row.tenantId);
  const profileAccess = Object.fromEntries(
    MODULES.map((m) => [m, mergeLevels(policies.filter((p) => p.module === m).map((p) => p.level as AccessLevel))]),
  ) as Record<Module, AccessLevel>;


  // módulos de negócio: teto da empresa + liberação por equipe ou pessoa
  const teamIds = memberships.map((m) => m.teamId);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: row.timezone || 'America/Sao_Paulo' }).format(new Date());
  const decisions = Object.fromEntries(BUSINESS_MODULES.map((m) => {
    const t = tms.find((x) => x.module === m);
    const tm = t ? { module: m, enabled: t.enabled, mode: t.mode as ReleaseMode, disabledFeatures: t.disabledFeatures } : defaultTenantModule(m);
    return [m, moduleDecision(tm, grants.map((g) => ({ module: g.module as BusinessModule, subjectType: g.subjectType as 'equipe' | 'usuario', subjectId: g.subjectId, effect: g.effect as 'liberar' | 'bloquear', validUntil: g.validUntil })), { id: row.userId, teamIds }, today)];
  })) as Record<BusinessModule, ModuleDecision>;
  const modules = Object.fromEntries(BUSINESS_MODULES.map((m) => [m, decisions[m].enabled])) as Record<BusinessModule, boolean>;
  // ações sensíveis: linha gravada no perfil ou o padrão do perfil; vale se qualquer perfil permitir
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
    ipBypass: !!row.ipBypass,
    modules,
    moduleReasons: Object.fromEntries(BUSINESS_MODULES.map((m) => [m, decisions[m].reason])) as Record<BusinessModule, ModuleDecision['reason']>,
    disabledFeatures: [...new Set(tms.flatMap((x) => x.disabledFeatures))],
    actions,
    teamIds: memberships.map((m) => m.teamId),
    teamMemberIds: [...new Set([row.userId, ...members.map((m) => m.userId)])],
    // só visualizador: os setores servem para ver (viewSectors), não para atuar (sectors)
    sectors: (row.sectorViewer ? [] : row.sectors ?? []) as Sector[],
    viewSectors: (row.sectors ?? []) as Sector[],
    sectorViewer: !!row.sectorViewer,
    sectorRole: (row.sectorRole === 'observador' || row.sectorRole === 'lideranca' ? row.sectorRole : 'operador') as 'observador' | 'operador' | 'lideranca',
  };
}
