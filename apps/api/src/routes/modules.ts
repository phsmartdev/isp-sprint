/**
 * Etapa 1 — Configuração → Módulos: liga/desliga os sete módulos de negócio por empresa, modo de liberação,
 * funcionalidades, liberações e bloqueios por equipe ou pessoa (com motivo e validade), ações sensíveis por perfil
 * e a prévia do acesso efetivo de um usuário. Tudo auditado; nada amplia o nível do perfil.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { z } from 'zod';
import {
  BUSINESS_MODULES, BUSINESS_MODULE_HINTS, BUSINESS_MODULE_LABELS, DEFAULT_ACTIONS, FEATURES, MODULE_OWNER, MODULES, PROFILE_KEYS, PROFILE_LABELS, RELEASE_MODES,
  SENSITIVE_ACTIONS, SENSITIVE_ACTION_LABELS, ACCESS_LEVELS, defaultTenantModule, grantErrors, type AccessLevel, type BusinessModule, type Module,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import { authForUser } from '../http/context';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { ensureRoles } from './admin';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
const ModParams = z.object({ module: z.enum(BUSINESS_MODULES) });
const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Sao_Paulo' }).format(new Date());

/** Pessoas precisam ser ativas e da empresa. */
async function assertActiveUsers(db: DbOrTx, tenantId: string, ids: string[]) {
  const u = [...new Set(ids)];
  if (!u.length) return;
  const ok = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), inArray(s.users.id, u)));
  if (ok.length !== u.length) throw unprocessable('Há pessoa inativa ou de fora da empresa na escolha.');
}
/** Supervisão só enxerga os times que lidera: quem tem esse perfil não pode ficar sem liderar nenhum time. */
async function assertSupervisorsLead(db: DbOrTx, tenantId: string, ids: string[]) {
  if (!ids.length) return;
  const r = await db.execute<{ name: string }>(sql`select u.name from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
    where u.tenant_id = ${tenantId} and r.key = 'supervisor' and u.id in ${sql.raw(`(${[...new Set(ids)].map((i) => `'${i.replace(/[^0-9a-f-]/gi, '')}'`).join(',')})`)}
    and not exists (select 1 from team_memberships m join teams t on t.id = m.team_id where m.user_id = u.id and m.is_lead and t.deleted_at is null)`);
  if (r.rows.length) throw unprocessable(`${r.rows.map((x) => x.name).join(', ')} tem perfil Supervisão e ficaria sem liderar nenhum time (a Supervisão só enxerga os times que lidera). Coloque como liderança de outro time ou troque o perfil antes.`);
}

export const moduleRoutes = [
  defineRoute({
    method: 'GET', url: '/admin/modules', summary: 'Os sete módulos de negócio: situação na empresa, funcionalidades e liberações por equipe ou pessoa', tag: 'Administração', ...ADMIN,
    handler: async ({ app, auth }) => {
      const rows = await app.db.select().from(s.tenantModules).where(eq(s.tenantModules.tenantId, auth.tenantId));
      const grants = await app.db.select().from(s.moduleGrants).where(eq(s.moduleGrants.tenantId, auth.tenantId)).orderBy(asc(s.moduleGrants.createdAt));
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const teams = await app.db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(eq(s.teams.tenantId, auth.tenantId));
      const today = todayIn(auth.timezone);
      return {
        items: BUSINESS_MODULES.map((m) => {
          const r = rows.find((x) => x.module === m);
          const cfg = r ? { enabled: r.enabled, mode: r.mode, disabledFeatures: r.disabledFeatures } : defaultTenantModule(m);
          return {
            key: m, label: BUSINESS_MODULE_LABELS[m], hint: BUSINESS_MODULE_HINTS[m], ...cfg, saved: !!r,
            technical: MODULES.filter((t) => MODULE_OWNER[t] === m),
            features: FEATURES.filter((f) => f.module === m).map((f) => ({ key: f.key, label: f.label, requires: 'requires' in f ? f.requires : [] })),
            grants: grants.filter((g) => g.module === m).map((g) => ({
              id: g.id, subjectType: g.subjectType, subjectId: g.subjectId, effect: g.effect, reason: g.reason, validUntil: g.validUntil, expired: !!g.validUntil && g.validUntil < today,
              subjectName: g.subjectType === 'usuario' ? users.find((u) => u.id === g.subjectId)?.name ?? '?' : teams.find((t) => t.id === g.subjectId)?.name ?? '?',
            })),
          };
        }),
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/modules/:module', summary: 'Liga ou desliga o módulo na empresa, define quem recebe (todos ou só liberados) e as funcionalidades desligadas', tag: 'Administração', ...ADMIN, params: ModParams,
    body: z.object({ enabled: z.boolean(), mode: z.enum(RELEASE_MODES), disabledFeatures: z.array(z.string().max(60)).max(30), note: z.string().trim().min(10, 'Explique o motivo (pelo menos 10 caracteres).').max(500) }),
    handler: async ({ app, auth, req, params, body }) => {
      const allowed = FEATURES.filter((f) => f.module === params.module).map((f) => f.key as string);
      const bad = body.disabledFeatures.find((f) => !allowed.includes(f));
      if (bad) throw unprocessable(`Funcionalidade fora do módulo: ${bad}`);
      const [cur] = await app.db.select().from(s.tenantModules).where(and(eq(s.tenantModules.tenantId, auth.tenantId), eq(s.tenantModules.module, params.module))).limit(1);
      const before = cur ? { enabled: cur.enabled, mode: cur.mode, disabledFeatures: cur.disabledFeatures } : defaultTenantModule(params.module);
      const value = { enabled: body.enabled, mode: body.mode, disabledFeatures: [...new Set(body.disabledFeatures)], updatedBy: auth.userId, updatedAt: new Date() };
      await app.db.insert(s.tenantModules).values({ tenantId: auth.tenantId, module: params.module, ...value }).onConflictDoUpdate({ target: [s.tenantModules.tenantId, s.tenantModules.module], set: value });
      await audit(app.db, req, { action: 'module.update', entityType: 'module', entityId: params.module, metadata: { from: before, to: { enabled: value.enabled, mode: value.mode, disabledFeatures: value.disabledFeatures }, note: body.note } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/modules/:module/grants', summary: 'Libera ou bloqueia o módulo para uma equipe ou pessoa (substitui a regra anterior do mesmo alvo)', tag: 'Administração', ...ADMIN, params: ModParams,
    body: z.object({ subjectType: z.enum(['equipe', 'usuario']), subjectId: z.string().uuid(), effect: z.enum(['liberar', 'bloquear']), reason: z.string().trim().max(500), validUntil: z.string().date().nullable().default(null) }),
    handler: async ({ app, auth, req, params, body, reply }) => {
      const errs = grantErrors(body, todayIn(auth.timezone));
      if (errs.length) throw unprocessable(errs[0]!);
      const tbl = body.subjectType === 'usuario' ? s.users : s.teams;
      const [subj] = await app.db.select({ id: tbl.id }).from(tbl).where(and(eq(tbl.id, body.subjectId), eq(tbl.tenantId, auth.tenantId))).limit(1);
      if (!subj) throw unprocessable(body.subjectType === 'usuario' ? 'Pessoa não encontrada.' : 'Equipe não encontrada.');
      const value = { effect: body.effect, reason: body.reason, validUntil: body.validUntil, createdBy: auth.userId, createdAt: new Date() };
      const [g] = await app.db.insert(s.moduleGrants).values({ tenantId: auth.tenantId, module: params.module, subjectType: body.subjectType, subjectId: body.subjectId, ...value })
        .onConflictDoUpdate({ target: [s.moduleGrants.tenantId, s.moduleGrants.module, s.moduleGrants.subjectType, s.moduleGrants.subjectId], set: value }).returning();
      await audit(app.db, req, { action: 'module.grant', entityType: 'module', entityId: params.module, metadata: { subjectType: body.subjectType, subjectId: body.subjectId, effect: body.effect, reason: body.reason, validUntil: body.validUntil } });
      reply.code(201);
      return g;
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/module-grants/:id/revoke', summary: 'Retira a liberação ou o bloqueio (volta à regra do módulo)', tag: 'Administração', ...ADMIN, params: IdParams,
    body: z.object({ note: z.string().trim().min(10, 'Explique o motivo (pelo menos 10 caracteres).').max(500) }),
    handler: async ({ app, auth, req, params, body }) => {
      const [g] = await app.db.select().from(s.moduleGrants).where(and(eq(s.moduleGrants.id, params.id), eq(s.moduleGrants.tenantId, auth.tenantId))).limit(1);
      if (!g) throw notFound();
      await app.db.delete(s.moduleGrants).where(eq(s.moduleGrants.id, g.id));
      await audit(app.db, req, { action: 'module.grant_revoked', entityType: 'module', entityId: g.module, metadata: { subjectType: g.subjectType, subjectId: g.subjectId, effect: g.effect, note: body.note } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/actions', summary: 'Ações sensíveis por perfil (ver financeiro, exportar, validar contrato, alterar valores, arquivar)', tag: 'Administração', ...ADMIN,
    handler: async ({ app, auth }) => {
      const roles = await ensureRoles(app.db, auth.tenantId);
      const rows = await app.db.select().from(s.actionPolicies).where(inArray(s.actionPolicies.roleId, PROFILE_KEYS.map((k) => roles[k]!)));
      return {
        actions: SENSITIVE_ACTIONS.map((a) => ({ key: a, label: SENSITIVE_ACTION_LABELS[a] })),
        profiles: PROFILE_KEYS.map((k) => ({ key: k, label: PROFILE_LABELS[k] })),
        matrix: Object.fromEntries(PROFILE_KEYS.map((k) => [k, Object.fromEntries(SENSITIVE_ACTIONS.map((a) => [a, rows.find((r) => r.roleId === roles[k] && r.action === a)?.allowed ?? DEFAULT_ACTIONS[k]?.[a] ?? false]))])),
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/actions', summary: 'Permite ou nega uma ação sensível a um perfil (auditado)', tag: 'Administração', ...ADMIN,
    body: z.object({ profile: z.enum(PROFILE_KEYS), action: z.enum(SENSITIVE_ACTIONS), allowed: z.boolean() }),
    handler: async ({ app, auth, req, body }) => {
      const roles = await ensureRoles(app.db, auth.tenantId);
      const roleId = roles[body.profile]!;
      const [cur] = await app.db.select().from(s.actionPolicies).where(and(eq(s.actionPolicies.roleId, roleId), eq(s.actionPolicies.action, body.action))).limit(1);
      await app.db.insert(s.actionPolicies).values({ roleId, action: body.action, allowed: body.allowed, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: [s.actionPolicies.roleId, s.actionPolicies.action], set: { allowed: body.allowed, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'security.action', entityType: 'action_policy', entityId: `${body.profile}:${body.action}`, metadata: { profile: body.profile, action: body.action, from: cur?.allowed ?? DEFAULT_ACTIONS[body.profile]?.[body.action] ?? false, to: body.allowed } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/org-chart', summary: 'Organograma de acessos: pessoas, times (gestores, líderes e membros) e, por módulo, o que cada pessoa enxerga e por quê', tag: 'Administração', ...ADMIN,
    handler: async ({ app, auth }) => {
      const [users, teams, members, grants] = await Promise.all([
        app.db.select({ id: s.users.id, name: s.users.name, jobTitle: s.users.jobTitle, hasAvatar: s.userAvatars.userId }).from(s.users).leftJoin(s.userAvatars, eq(s.userAvatars.userId, s.users.id)).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).orderBy(asc(s.users.name)),
        app.db.select({ id: s.teams.id, name: s.teams.name, managerIds: s.teams.managerIds }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), eq(s.teams.active, true), isNull(s.teams.deletedAt))).orderBy(asc(s.teams.name)),
        app.db.select({ teamId: s.teamMemberships.teamId, userId: s.teamMemberships.userId, isLead: s.teamMemberships.isLead }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(eq(s.teams.tenantId, auth.tenantId)),
        app.db.select().from(s.moduleGrants).where(eq(s.moduleGrants.tenantId, auth.tenantId)),
      ]);
      const rank = (l: AccessLevel) => ACCESS_LEVELS.indexOf(l);
      const people = [];
      for (const u of users) {
        const a = await authForUser(app.db, auth.tenantId, u.id);
        if (!a) continue;
        // o que a pessoa enxerga em cada módulo de negócio: o maior nível entre as telas do módulo (já com o módulo ligado ou não para ela)
        const view = Object.fromEntries(BUSINESS_MODULES.map((bm: BusinessModule) => {
          const techs = (MODULES as readonly Module[]).filter((m) => MODULE_OWNER[m] === bm);
          const lvl = techs.reduce<AccessLevel>((best, m) => (rank(a.access[m] ?? 'nenhum') > rank(best) ? a.access[m]! : best), 'nenhum');
          const prof = techs.reduce<AccessLevel>((best, m) => (rank(a.profileAccess[m] ?? 'nenhum') > rank(best) ? a.profileAccess[m]! : best), 'nenhum');
          return [bm, { level: a.modules[bm] ? lvl : 'nenhum', enabled: a.modules[bm], reason: a.moduleReasons[bm], profileLevel: prof }];
        }));
        people.push({ id: u.id, name: u.name, jobTitle: u.jobTitle, hasAvatar: !!u.hasAvatar, profile: a.profiles[0] ?? null, profiles: a.profiles, view });
      }
      const [tn] = await app.db.select({ name: s.tenants.orgTopName, title: s.tenants.orgTopTitle }).from(s.tenants).where(eq(s.tenants.id, auth.tenantId));
      return {
        top: { name: tn?.name ?? null, title: tn?.title ?? null },
        modules: BUSINESS_MODULES.map((m: BusinessModule) => ({ key: m, label: BUSINESS_MODULE_LABELS[m], technical: (MODULES as readonly Module[]).filter((t) => MODULE_OWNER[t] === m) })),
        profiles: PROFILE_KEYS.map((k) => ({ key: k, label: PROFILE_LABELS[k] })),
        people,
        teams: teams.map((t) => ({ id: t.id, name: t.name, managerIds: t.managerIds, leadIds: members.filter((m) => m.teamId === t.id && m.isLead).map((m) => m.userId), memberIds: members.filter((m) => m.teamId === t.id && !m.isLead).map((m) => m.userId) })),
        grants: grants.map((g) => ({ id: g.id, module: g.module, subjectType: g.subjectType, subjectId: g.subjectId, effect: g.effect, reason: g.reason, validUntil: g.validUntil })),
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/org-chart/top', summary: 'Define quem encabeça o organograma (nome e cargo)', tag: 'Administração', ...ADMIN,
    body: z.object({ name: z.string().trim().min(2).max(120), title: z.string().trim().max(120).nullable().default(null) }),
    handler: async ({ app, auth, req, body }) => {
      await app.db.update(s.tenants).set({ orgTopName: body.name, orgTopTitle: body.title || null, updatedAt: new Date() }).where(eq(s.tenants.id, auth.tenantId));
      await audit(app.db, req, { action: 'org_chart.top', entityType: 'tenant', entityId: auth.tenantId, metadata: { name: body.name, title: body.title } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/org-chart/teams/:id', summary: 'Monta o time pelo organograma: gestores, liderança e membros (substitui a composição atual, auditado)', tag: 'Administração', ...ADMIN, params: IdParams,
    body: z.object({ managerIds: z.array(z.string().uuid()).max(20), leadIds: z.array(z.string().uuid()).max(30), memberIds: z.array(z.string().uuid()).max(300) }),
    handler: async ({ app, auth, req, params, body }) => {
      const leads = [...new Set(body.leadIds)], members = [...new Set(body.memberIds)].filter((x) => !leads.includes(x)), managers = [...new Set(body.managerIds)];
      return app.db.transaction(async (tx) => {
        const [t] = await tx.select().from(s.teams).where(and(eq(s.teams.id, params.id), eq(s.teams.tenantId, auth.tenantId), isNull(s.teams.deletedAt)));
        if (!t) throw notFound('Time não encontrado.');
        await assertActiveUsers(tx, auth.tenantId, [...leads, ...members, ...managers]);
        const before = await tx.select().from(s.teamMemberships).where(eq(s.teamMemberships.teamId, t.id));
        await tx.delete(s.teamMemberships).where(eq(s.teamMemberships.teamId, t.id));
        const rows = [...leads.map((u) => ({ teamId: t.id, userId: u, isLead: true })), ...members.map((u) => ({ teamId: t.id, userId: u, isLead: false }))];
        if (rows.length) await tx.insert(s.teamMemberships).values(rows);
        await tx.update(s.teams).set({ managerIds: managers }).where(eq(s.teams.id, t.id));
        await assertSupervisorsLead(tx, auth.tenantId, before.filter((b) => b.isLead && !leads.includes(b.userId)).map((b) => b.userId));
        await audit(tx, req, { action: 'org_chart.team', entityType: 'team', entityId: t.id, metadata: { name: t.name, managers, leads, members, before: { leads: before.filter((b) => b.isLead).map((b) => b.userId), members: before.filter((b) => !b.isLead).map((b) => b.userId), managers: t.managerIds } } });
        return { ok: true };
      });
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/org-chart/move', summary: 'Move uma pessoa para um time (sai do time de origem, se informado), como liderança ou membro', tag: 'Administração', ...ADMIN,
    body: z.object({ userId: z.string().uuid(), fromTeamId: z.string().uuid().nullable().default(null), toTeamId: z.string().uuid(), lead: z.boolean().default(false) }),
    handler: async ({ app, auth, req, body }) => {
      return app.db.transaction(async (tx) => {
        const ts = await tx.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), isNull(s.teams.deletedAt), inArray(s.teams.id, [body.toTeamId, ...(body.fromTeamId ? [body.fromTeamId] : [])])));
        if (!ts.some((t) => t.id === body.toTeamId) || (body.fromTeamId && !ts.some((t) => t.id === body.fromTeamId))) throw notFound('Time não encontrado.');
        await assertActiveUsers(tx, auth.tenantId, [body.userId]);
        const wasLead = body.fromTeamId ? (await tx.select().from(s.teamMemberships).where(and(eq(s.teamMemberships.teamId, body.fromTeamId), eq(s.teamMemberships.userId, body.userId))))[0]?.isLead ?? false : false;
        if (body.fromTeamId && body.fromTeamId !== body.toTeamId) await tx.delete(s.teamMemberships).where(and(eq(s.teamMemberships.teamId, body.fromTeamId), eq(s.teamMemberships.userId, body.userId)));
        await tx.insert(s.teamMemberships).values({ teamId: body.toTeamId, userId: body.userId, isLead: body.lead }).onConflictDoUpdate({ target: [s.teamMemberships.teamId, s.teamMemberships.userId], set: { isLead: body.lead } });
        if (wasLead) await assertSupervisorsLead(tx, auth.tenantId, [body.userId]);
        await audit(tx, req, { action: 'org_chart.move', entityType: 'user', entityId: body.userId, metadata: { from: body.fromTeamId, to: body.toTeamId, lead: body.lead } });
        return { ok: true };
      });
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/access-preview/:id', summary: 'Prévia do acesso efetivo de um usuário: módulos (e por quê), níveis por módulo técnico e ações', tag: 'Administração', ...ADMIN, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const a = await authForUser(app.db, auth.tenantId, params.id);
      if (!a) throw notFound('Usuário não encontrado ou inativo.');
      return {
        profiles: a.profiles, modules: Object.fromEntries(BUSINESS_MODULES.map((m: BusinessModule) => [m, { enabled: a.modules[m], reason: a.moduleReasons[m] }])),
        access: a.access, profileAccess: a.profileAccess, actions: a.actions, disabledFeatures: a.disabledFeatures,
      };
    },
  }),
];
