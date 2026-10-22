/**
 * Etapa 1 — Configuração → Módulos: liga/desliga os sete módulos de negócio por empresa, modo de liberação,
 * funcionalidades, liberações e bloqueios por equipe ou pessoa (com motivo e validade), ações sensíveis por perfil
 * e a prévia do acesso efetivo de um usuário. Tudo auditado; nada amplia o nível do perfil.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  BUSINESS_MODULES, BUSINESS_MODULE_HINTS, BUSINESS_MODULE_LABELS, DEFAULT_ACTIONS, FEATURES, MODULE_OWNER, MODULES, PROFILE_KEYS, PROFILE_LABELS, RELEASE_MODES,
  SENSITIVE_ACTIONS, SENSITIVE_ACTION_LABELS, defaultTenantModule, grantErrors, type BusinessModule,
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
