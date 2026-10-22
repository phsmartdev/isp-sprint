import { partnerCostsFromProducts, type PlanProduct } from '@isp/domain';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  BRAND_SLOTS, ImageUpload, PasswordChange, PlanUpsert, SecurityUpdate, SourceUpsert, UserCreate, UserUpdate,
} from '@isp/shared';
import { DEFAULT_ACCESS, MODULES, PROFILE_KEYS, PROFILE_LABELS, allowedLevels, type AccessLevel, type Module, type ProfileKey } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { notifyUserAccess } from '../services/alerts';
import { smtpConfig } from '../services/email';
import { decodeImage } from '../services/images';
import { hashPassword, verifyPassword } from '../auth/password';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
const SlotParams = z.object({ slot: z.enum(BRAND_SLOTS) });
const startedAt = Date.now();

async function roleMap(db: DbOrTx, tenantId: string) {
  const rows = await db.select().from(s.roles).where(eq(s.roles.tenantId, tenantId));
  return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<string, string>;
}

/** Garante papéis e matriz padrão para empresas antigas (idempotente). */
export async function ensureRoles(db: DbOrTx, tenantId: string) {
  const map = await roleMap(db, tenantId);
  for (const key of PROFILE_KEYS) {
    if (!map[key]) {
      const [r] = await db.insert(s.roles).values({ tenantId, key, name: PROFILE_LABELS[key], isSystem: true }).returning();
      map[key] = r!.id;
      await db.insert(s.accessPolicies).values(MODULES.map((m) => ({ roleId: r!.id, module: m, level: DEFAULT_ACCESS[key][m] })));
    }
  }
  return map;
}

async function userRow(db: DbOrTx, auth: AuthContext, id: string) {
  const [u] = await db.select().from(s.users).where(and(eq(s.users.id, id), eq(s.users.tenantId, auth.tenantId))).limit(1);
  if (!u) throw notFound('Usuário não encontrado.');
  return u;
}

const SUP_NEEDS_TEAM = 'O supervisor precisa supervisionar ao menos um time: ele só vê as informações dos times que lidera.';
async function setTeams(db: DbOrTx, auth: AuthContext, userId: string, teamIds: string[], leadTeamIds: string[]) {
  const all = [...new Set([...teamIds, ...leadTeamIds])];
  if (all.length) {
    const valid = await db.select({ id: s.teams.id }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), inArray(s.teams.id, all)));
    if (valid.length !== all.length) throw unprocessable('Time inválido.', [{ path: 'teamIds', message: 'Time não encontrado nesta empresa' }]);
  }
  await db.delete(s.teamMemberships).where(eq(s.teamMemberships.userId, userId));
  if (all.length) await db.insert(s.teamMemberships).values(all.map((teamId) => ({ teamId, userId, isLead: leadTeamIds.includes(teamId) })));
}

const AUDIT_LABELS: Record<string, string> = {
  'auth.login': 'Entrou no sistema',
  'auth.logout': 'Saiu do sistema',
  'auth.login_failed': 'Tentativa de login falhou',
  'auth.login_blocked': 'Login bloqueado',
  'user.create': 'Cadastrou novo usuário',
  'instruction.upload': 'Enviou modelo de instrução',
  'instruction.activate': 'Ativou modelo de instrução',
  'instruction.export': 'Exportou modelo de instrução',
  'smtp.update': 'Alterou o SMTP',
  'notifications.update': 'Alterou notificações',
  'attachment.upload': 'Anexou arquivo em oportunidade',
  'attachment.delete': 'Removeu anexo de oportunidade',
  'email.send': 'Enviou e-mail ao cliente',
  'user.update': 'Atualizou usuário',
  'user.password_reset': 'Gerou nova senha temporária',
  'security.update': 'Alterou nível de acesso',
  'plan.create': 'Cadastrou plano',
  'plan.update': 'Atualizou plano',
  'source.create': 'Cadastrou origem de lead',
  'source.update': 'Atualizou origem de lead',
  'stage.rename': 'Editou etapa de venda',
  'branding.upload': 'Personalizou imagem',
  'branding.delete': 'Removeu imagem personalizada',
  'lead.create': 'Cadastrou lead',
  'lead.assign': 'Reatribuiu lead',
  'lead.bulk_assign': 'Reatribuiu leads em massa',
  'opportunity.create': 'Criou oportunidade',
  'opportunity.assign': 'Reatribuiu oportunidade',
  'opportunity.ganha': 'Marcou venda fechada',
  'opportunity.perdida': 'Marcou oportunidade perdida',
  'opportunity.reopen': 'Reabriu oportunidade',
  'contact.create': 'Cadastrou cliente',
  'customer.view': 'Consultou ficha de cliente',
  'export.csv': 'Exportou relatório',
  'profile.update': 'Atualizou o próprio perfil',
  'profile.password': 'Trocou a própria senha',
};

function describeAudit(action: string, metadata: Record<string, unknown> | null) {
  const label = AUDIT_LABELS[action] ?? action;
  const m = metadata ?? {};
  const details =
    action === 'security.update' ? `${m.profile} · ${m.module}: ${m.from} → ${m.to}`
    : action === 'stage.rename' ? `Alterou nome de "${m.from}" para "${m.to}"`
    : action.startsWith('plan.') ? `${m.name ?? ''}${m.priceCents !== undefined ? ` - R$ ${(Number(m.priceCents) / 100).toFixed(2).replace('.', ',')}` : ''}`
    : action.startsWith('branding.') ? `Espaço: ${m.slot}`
    : action === 'user.create' || action === 'user.update' ? `${m.name ?? ''}${m.profile ? ` - Perfil: ${m.profile}` : ''}`
    : action.startsWith('instruction.') ? `Versão ${m.version ?? ''}${m.changes !== undefined ? ` · ${m.changes} mudança(s)` : ''}`
    : action.startsWith('attachment.') ? String(m.filename ?? '')
    : action === 'smtp.update' ? `${m.host}:${m.port}${m.passwordChanged ? ' · senha alterada' : ''}`
    : action === 'email.send' ? (m.kind === 'proposta' ? 'Proposta' : 'Follow-up')
    : action === 'export.csv' ? `${m.kind} · ${m.from} a ${m.to} (${m.rows} linhas)`
    : '';
  return { label, details };
}

/** Plano com produtos: a mensalidade é a soma (quantidade × valor unitário) dos produtos. */
function withProductPrice<T extends { priceCents?: number; partnerCosts?: Record<string, number>; products?: PlanProduct[] }>(b: T): T {
  if (!b.products) return b;
  // custo de parceiro (ex.: PlayHub) sai dos produtos do plano ligados a ele
  const partnerCosts = partnerCostsFromProducts(b.products);
  return b.products.length ? { ...b, partnerCosts, priceCents: b.products.reduce((a, i) => a + i.qty * i.unitPriceCents, 0) } : { ...b, partnerCosts };
}

/** Parceiros ligados a produtos passam a ser cobrados pelos produtos do plano (não mais valor fixo). */
async function partnersToPerPlan(db: DbOrTx, tenantId: string, products?: PlanProduct[]) {
  const ids = [...new Set((products ?? []).map((p) => p.partnerId).filter(Boolean) as string[])];
  if (!ids.length) return [];
  const found = await db.select({ id: s.viabilityDeductions.id, name: s.viabilityDeductions.name, kind: s.viabilityDeductions.kind }).from(s.viabilityDeductions).where(and(eq(s.viabilityDeductions.tenantId, tenantId), eq(s.viabilityDeductions.category, 'parceiro'), inArray(s.viabilityDeductions.id, ids)));
  if (found.length !== ids.length) throw unprocessable('Parceiro inválido no produto.', [{ path: 'products', message: 'Parceiro não encontrado' }]);
  const switched = found.filter((f) => f.kind !== 'per_plan');
  if (switched.length) await db.update(s.viabilityDeductions).set({ kind: 'per_plan' }).where(inArray(s.viabilityDeductions.id, switched.map((x) => x.id)));
  return switched.map((x) => x.name);
}

export const adminRoutes = [
  // ------------------------------------------------------------------ visão geral
  defineRoute({
    method: 'GET',
    url: '/admin/overview',
    summary: 'Administração — números da plataforma, informações do sistema e atividades recentes',
    tag: 'Administração',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const t = auth.tenantId;
      const [[u], [p], [st], [mig], logs] = await Promise.all([
        app.db.select({ n: sql<number>`count(*)::int` }).from(s.users).where(and(eq(s.users.tenantId, t), eq(s.users.active, true))),
        app.db.select({ n: sql<number>`count(*)::int` }).from(s.plans).where(and(eq(s.plans.tenantId, t), eq(s.plans.active, true))),
        app.db.select({ n: sql<number>`count(*)::int` }).from(s.pipelineStages).where(and(eq(s.pipelineStages.tenantId, t), eq(s.pipelineStages.active, true))),
        app.db.execute<{ at: string | null; n: number }>(sql`select to_timestamp(max(created_at)/1000.0) at, count(*)::int n from drizzle.__drizzle_migrations`).then((r) => r.rows),
        app.db
          .select({ id: s.auditLogs.id, action: s.auditLogs.action, metadata: s.auditLogs.metadata, createdAt: s.auditLogs.createdAt, actorId: s.auditLogs.actorId, actorName: s.users.name })
          .from(s.auditLogs)
          .leftJoin(s.users, eq(s.users.id, s.auditLogs.actorId))
          .where(and(eq(s.auditLogs.tenantId, t), sql`${s.auditLogs.action} not like 'auth.%' and ${s.auditLogs.action} <> 'customer.view'`))
          .orderBy(desc(s.auditLogs.createdAt))
          .limit(5),
      ]);
      const sources = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.leadSources).where(and(eq(s.leadSources.tenantId, t), eq(s.leadSources.active, true)));
      return {
        counts: { users: u!.n, plans: p!.n, stages: st!.n, sources: sources[0]!.n, integrations: (await smtpConfig(app.db, t)) ? 1 : 0, pipelines: (await app.db.select({ n: sql<number>`count(*)::int` }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, t), eq(s.pipelines.active, true))))[0]!.n },
        system: {
          version: 'v1.2.0-fase1',
          online: true,
          lastUpdate: mig?.at ?? null,
          migrations: mig?.n ?? 0,
          database: 'Operacional',
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          ixcMode: process.env.IXC_MODE ?? 'mock',
        },
        recent: logs.map((l) => ({ ...l, ...describeAudit(l.action, l.metadata ?? null) })),
      };
    },
  }),

  // ------------------------------------------------------------------ usuários e times
  defineRoute({
    method: 'GET',
    url: '/admin/users',
    summary: 'Usuários, perfis, times e metas',
    tag: 'Administração',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const users = await app.db
        .select({
          id: s.users.id, name: s.users.name, email: s.users.email, jobTitle: s.users.jobTitle, phone: s.users.phone, active: s.users.active, lastLoginAt: s.users.lastLoginAt,
          goalSales: s.users.goalSales, goalProposals: s.users.goalProposals, goalLeads: s.users.goalLeads, sectors: s.users.sectors, createdAt: s.users.createdAt,
          hasAvatar: sql<boolean>`exists(select 1 from user_avatars ua where ua.user_id = "users"."id")`,
          profile: sql<string | null>`(select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = "users"."id" order by case r.key when 'gerencia' then 0 when 'supervisor' then 1 else 2 end limit 1)`,
        })
        .from(s.users)
        .where(eq(s.users.tenantId, auth.tenantId))
        .orderBy(asc(s.users.name));
      const memberships = users.length
        ? await app.db.select().from(s.teamMemberships).where(inArray(s.teamMemberships.userId, users.map((u) => u.id)))
        : [];
      const teams = await app.db.select().from(s.teams).where(eq(s.teams.tenantId, auth.tenantId)).orderBy(asc(s.teams.name));
      return {
        users: users.map((u) => ({
          ...u,
          teamIds: memberships.filter((m) => m.userId === u.id).map((m) => m.teamId),
          leadTeamIds: memberships.filter((m) => m.userId === u.id && m.isLead).map((m) => m.teamId),
        })),
        teams,
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/users',
    summary: 'Cadastra usuário com senha temporária (mostrada uma única vez)',
    tag: 'Administração',
    ...ADMIN,
    body: UserCreate,
    handler: async ({ app, auth, body, req, reply }) => {
      const temp = randomBytes(9).toString('base64url');
      const result = await app.db.transaction(async (tx) => {
        const roles = await ensureRoles(tx, auth.tenantId);
        const [exists] = await tx.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.email}) = ${body.email}`).limit(1);
        if (exists) throw unprocessable('E-mail já cadastrado.', [{ path: 'email', message: 'Já existe um usuário com este e-mail' }]);
        if (body.profile === 'supervisor' && !body.leadTeamIds.length) throw unprocessable(SUP_NEEDS_TEAM, [{ path: 'leadTeamIds', message: 'Escolha os times que ele supervisiona' }]);
        const [u] = await tx.insert(s.users).values({ tenantId: auth.tenantId, name: body.name, email: body.email, jobTitle: body.jobTitle, phone: body.phone ?? null, sectors: body.sectors, passwordHash: await hashPassword(temp) }).returning();
        await tx.insert(s.userRoles).values({ userId: u!.id, roleId: roles[body.profile]! });
        await setTeams(tx, auth, u!.id, body.teamIds, body.leadTeamIds);
        await audit(tx, req, { action: 'user.create', entityType: 'user', entityId: u!.id, metadata: { name: body.name, profile: body.profile } });
        return u!;
      });
      reply.code(201);
      const emailSent = await notifyUserAccess(app.db, app.config, auth, 'convite_usuario', { name: result.name, email: result.email }, temp);
      return { id: result.id, temporaryPassword: temp, emailSent };
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/admin/users/:id',
    summary: 'Atualiza perfil, times, metas, cargo ou situação do usuário',
    tag: 'Administração',
    ...ADMIN,
    params: IdParams,
    body: UserUpdate,
    handler: async ({ app, auth, params, body, req }) => {
      await app.db.transaction(async (tx) => {
        const u = await userRow(tx, auth, params.id);
        if (params.id === auth.userId && (body.active === false || (body.profile && body.profile !== 'gerencia'))) {
          throw unprocessable('Você não pode remover o próprio acesso de gerência nem se desativar.');
        }
        if (body.email && body.email !== u.email.toLowerCase()) {
          const [exists] = await tx.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.email}) = ${body.email} and ${s.users.id} <> ${u.id}`).limit(1);
          if (exists) throw unprocessable('E-mail já cadastrado.', [{ path: 'email', message: 'Já existe um usuário com este e-mail' }]);
          // e-mail novo: desfaz o vínculo com a conta Google anterior
          await tx.update(s.users).set({ email: body.email, googleSub: null }).where(eq(s.users.id, u.id));
        }
        await tx
          .update(s.users)
          .set({ name: body.name, jobTitle: body.jobTitle, phone: body.phone, active: body.active, goalSales: body.goalSales, goalProposals: body.goalProposals, goalLeads: body.goalLeads, sectors: body.sectors, updatedAt: new Date() })
          .where(eq(s.users.id, u.id));
        if (body.active === false) await tx.update(s.sessions).set({ revokedAt: new Date() }).where(eq(s.sessions.userId, u.id));
        if (body.profile) {
          const roles = await ensureRoles(tx, auth.tenantId);
          await tx.delete(s.userRoles).where(eq(s.userRoles.userId, u.id));
          await tx.insert(s.userRoles).values({ userId: u.id, roleId: roles[body.profile]! });
        }
        const current = await tx.select().from(s.teamMemberships).where(eq(s.teamMemberships.userId, u.id));
        const leads = body.leadTeamIds ?? current.filter((c) => c.isLead).map((c) => c.teamId);
        const [role] = await tx.select({ key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, u.id)).limit(1);
        if ((body.profile ?? role?.key) === 'supervisor' && !leads.length) throw unprocessable(SUP_NEEDS_TEAM, [{ path: 'leadTeamIds', message: 'Escolha os times que ele supervisiona' }]);
        if (body.teamIds || body.leadTeamIds) await setTeams(tx, auth, u.id, body.teamIds ?? current.map((c) => c.teamId), leads);
        await audit(tx, req, { action: 'user.update', entityType: 'user', entityId: u.id, metadata: { name: body.name ?? u.name, profile: body.profile, active: body.active, sectors: body.sectors, ...(body.email && body.email !== u.email.toLowerCase() ? { emailFrom: u.email, emailTo: body.email } : {}) } });
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/users/:id/reset-password',
    summary: 'Gera nova senha temporária e encerra as sessões do usuário',
    tag: 'Administração',
    ...ADMIN,
    params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      const u = await userRow(app.db, auth, params.id);
      const temp = randomBytes(9).toString('base64url');
      await app.db.update(s.users).set({ passwordHash: await hashPassword(temp), failedLogins: 0, lockedUntil: null }).where(eq(s.users.id, u.id));
      await app.db.update(s.sessions).set({ revokedAt: new Date() }).where(eq(s.sessions.userId, u.id));
      await audit(app.db, req, { action: 'user.password_reset', entityType: 'user', entityId: u.id });
      const emailSent = await notifyUserAccess(app.db, app.config, auth, 'nova_senha', { name: u.name, email: u.email }, temp);
      return { temporaryPassword: temp, emailSent };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/admin/users/:id/avatar',
    summary: 'Envia foto do usuário (PNG, JPG ou WebP até 2 MB)',
    tag: 'Administração',
    ...ADMIN,
    params: IdParams,
    body: ImageUpload,
    bodyLimit: 3_200_000,
    handler: async ({ app, auth, params, body }) => {
      await userRow(app.db, auth, params.id);
      const img = decodeImage(body.data);
      await app.db.insert(s.userAvatars).values({ userId: params.id, mime: img.mime, data: img.data }).onConflictDoUpdate({ target: s.userAvatars.userId, set: { mime: img.mime, data: img.data, updatedAt: new Date() } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/teams',
    summary: 'Cria time',
    tag: 'Administração',
    ...ADMIN,
    body: z.object({ name: z.string().trim().min(2).max(60) }),
    handler: async ({ app, auth, body, reply }) => {
      const [t] = await app.db.insert(s.teams).values({ tenantId: auth.tenantId, name: body.name }).returning();
      reply.code(201);
      return t;
    },
  }),

  // ------------------------------------------------------------------ segurança
  defineRoute({
    method: 'GET',
    url: '/admin/security',
    summary: 'Matriz de segurança: nível de cada perfil em cada módulo',
    tag: 'Administração',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const roles = await ensureRoles(app.db, auth.tenantId);
      const rows = await app.db.select().from(s.accessPolicies).where(inArray(s.accessPolicies.roleId, PROFILE_KEYS.map((k) => roles[k]!)));
      const counts = await app.db
        .select({ key: s.roles.key, n: sql<number>`count(*)::int` })
        .from(s.userRoles)
        .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
        .innerJoin(s.users, eq(s.users.id, s.userRoles.userId))
        .where(and(eq(s.roles.tenantId, auth.tenantId), eq(s.users.active, true)))
        .groupBy(s.roles.key);
      return {
        profiles: PROFILE_KEYS.map((k) => ({ key: k, users: counts.find((c) => c.key === k)?.n ?? 0 })),
        modules: MODULES.map((m) => ({ key: m, allowed: allowedLevels(m) })),
        matrix: Object.fromEntries(
          PROFILE_KEYS.map((k) => [k, Object.fromEntries(MODULES.map((m) => [m, (rows.find((r) => r.roleId === roles[k] && r.module === m)?.level ?? 'nenhum') as AccessLevel]))]),
        ),
        defaults: DEFAULT_ACCESS,
      };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/admin/security',
    summary: 'Altera o nível de um perfil em um módulo (auditado)',
    tag: 'Administração',
    ...ADMIN,
    body: SecurityUpdate,
    handler: async ({ app, auth, body, req }) => {
      if (!allowedLevels(body.module).includes(body.level)) throw unprocessable('Nível não disponível para este módulo.', [{ path: 'level', message: 'Configurações aceita apenas Sem acesso ou Total' }]);
      if (body.profile === 'gerencia' && body.module === 'configuracoes' && body.level !== 'total') {
        throw unprocessable('A Gerência precisa manter acesso total a Configurações, senão ninguém conseguiria administrar a plataforma.');
      }
      return app.db.transaction(async (tx) => {
        const roles = await ensureRoles(tx, auth.tenantId);
        const roleId = roles[body.profile]!;
        const [cur] = await tx.select().from(s.accessPolicies).where(and(eq(s.accessPolicies.roleId, roleId), eq(s.accessPolicies.module, body.module))).limit(1);
        await tx
          .insert(s.accessPolicies)
          .values({ roleId, module: body.module, level: body.level, updatedBy: auth.userId })
          .onConflictDoUpdate({ target: [s.accessPolicies.roleId, s.accessPolicies.module], set: { level: body.level, updatedAt: new Date(), updatedBy: auth.userId } });
        await audit(tx, req, { action: 'security.update', entityType: 'access_policy', entityId: `${body.profile}:${body.module}`, metadata: { profile: body.profile, module: body.module, from: cur?.level ?? null, to: body.level } });
        return { profile: body.profile as ProfileKey, module: body.module as Module, level: body.level };
      });
    },
  }),

  // ------------------------------------------------------------------ planos, origens e etapas
  defineRoute({
    method: 'GET',
    url: '/admin/plans',
    summary: 'Catálogo de planos (manual até a integração com o IXC)',
    tag: 'Administração',
    ...ADMIN,
    handler: async ({ app, auth }) => ({ items: await app.db.select().from(s.plans).where(eq(s.plans.tenantId, auth.tenantId)).orderBy(asc(s.plans.priceCents)) }),
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/plans',
    summary: 'Cadastra plano',
    tag: 'Administração',
    ...ADMIN,
    body: PlanUpsert,
    handler: async ({ app, auth, body, req, reply }) => {
      const switched = await partnersToPerPlan(app.db, auth.tenantId, body.products);
      const [p] = await app.db.insert(s.plans).values({ tenantId: auth.tenantId, ...withProductPrice(body) }).returning();
      await audit(app.db, req, { action: 'plan.create', entityType: 'plan', entityId: p!.id, metadata: { name: p!.name, priceCents: p!.priceCents } });
      reply.code(201);
      return { ...p!, partnersSwitched: switched };
    },
  }),
  defineRoute({
    method: 'PATCH',
    url: '/admin/plans/:id',
    summary: 'Atualiza plano (preço vale para novas oportunidades)',
    tag: 'Administração',
    ...ADMIN,
    params: IdParams,
    body: PlanUpsert.partial(),
    handler: async ({ app, auth, params, body, req }) => {
      const switched = await partnersToPerPlan(app.db, auth.tenantId, body.products);
      const [p] = await app.db.update(s.plans).set({ ...withProductPrice(body), updatedAt: new Date() }).where(and(eq(s.plans.id, params.id), eq(s.plans.tenantId, auth.tenantId))).returning();
      if (!p) throw notFound('Plano não encontrado.');
      await audit(app.db, req, { action: 'plan.update', entityType: 'plan', entityId: p.id, metadata: { name: p.name, priceCents: p.priceCents } });
      return { ...p, partnersSwitched: switched };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/admin/sources',
    summary: 'Origens de lead',
    tag: 'Administração',
    ...ADMIN,
    handler: async ({ app, auth }) => ({ items: await app.db.select().from(s.leadSources).where(eq(s.leadSources.tenantId, auth.tenantId)).orderBy(asc(s.leadSources.name)) }),
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/sources',
    summary: 'Cadastra origem de lead',
    tag: 'Administração',
    ...ADMIN,
    body: SourceUpsert,
    handler: async ({ app, auth, body, req, reply }) => {
      const [x] = await app.db.insert(s.leadSources).values({ tenantId: auth.tenantId, ...body }).returning();
      await audit(app.db, req, { action: 'source.create', entityType: 'source', entityId: x!.id, metadata: { name: x!.name } });
      reply.code(201);
      return x;
    },
  }),
  defineRoute({
    method: 'PATCH',
    url: '/admin/sources/:id',
    summary: 'Renomeia ou ativa/desativa origem',
    tag: 'Administração',
    ...ADMIN,
    params: IdParams,
    body: SourceUpsert.partial(),
    handler: async ({ app, auth, params, body, req }) => {
      const [x] = await app.db.update(s.leadSources).set(body).where(and(eq(s.leadSources.id, params.id), eq(s.leadSources.tenantId, auth.tenantId))).returning();
      if (!x) throw notFound('Origem não encontrada.');
      await audit(app.db, req, { action: 'source.update', entityType: 'source', entityId: x.id, metadata: { name: x.name, active: x.active } });
      return x;
    },
  }),
  // ------------------------------------------------------------------ logs
  defineRoute({
    method: 'GET',
    url: '/admin/logs',
    summary: 'Logs do sistema (trilha de auditoria)',
    tag: 'Administração',
    ...ADMIN,
    query: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }),
    handler: async ({ app, auth, query }) => {
      const rows = await app.db
        .select({ id: s.auditLogs.id, action: s.auditLogs.action, metadata: s.auditLogs.metadata, entityType: s.auditLogs.entityType, createdAt: s.auditLogs.createdAt, requestId: s.auditLogs.requestId, actorId: s.auditLogs.actorId, actorName: s.users.name })
        .from(s.auditLogs)
        .leftJoin(s.users, eq(s.users.id, s.auditLogs.actorId))
        .where(eq(s.auditLogs.tenantId, auth.tenantId))
        .orderBy(desc(s.auditLogs.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [{ total } = { total: 0 }] = await app.db.select({ total: sql<number>`count(*)::int` }).from(s.auditLogs).where(eq(s.auditLogs.tenantId, auth.tenantId));
      return { items: rows.map((l) => ({ ...l, ...describeAudit(l.action, l.metadata ?? null) })), page: query.page, pageSize: query.pageSize, total };
    },
  }),

  // ------------------------------------------------------------------ personalização
  defineRoute({
    method: 'GET',
    url: '/admin/branding',
    summary: 'Espaços de imagem da Personalização e o que já foi enviado',
    tag: 'Administração',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const rows = await app.db
        .select({ slot: s.brandAssets.slot, mime: s.brandAssets.mime, sizeBytes: s.brandAssets.sizeBytes, updatedAt: s.brandAssets.updatedAt, sha256: s.brandAssets.sha256, updatedByName: s.users.name })
        .from(s.brandAssets)
        .leftJoin(s.users, eq(s.users.id, s.brandAssets.updatedBy))
        .where(eq(s.brandAssets.tenantId, auth.tenantId));
      return { slots: BRAND_SLOTS.map((slot) => ({ slot, ...(rows.find((r) => r.slot === slot) ?? {}), hasImage: rows.some((r) => r.slot === slot) })) };
    },
  }),
  defineRoute({
    method: 'PUT',
    url: '/admin/branding/:slot',
    summary: 'Envia imagem para um espaço (PNG, JPG ou WebP até 2 MB; SVG não aceito)',
    tag: 'Administração',
    ...ADMIN,
    params: SlotParams,
    body: ImageUpload,
    bodyLimit: 3_200_000,
    handler: async ({ app, auth, params, body, req }) => {
      const img = decodeImage(body.data);
      await app.db
        .insert(s.brandAssets)
        .values({ tenantId: auth.tenantId, slot: params.slot, mime: img.mime, data: img.data, sizeBytes: img.data.length, sha256: img.sha256, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: [s.brandAssets.tenantId, s.brandAssets.slot], set: { mime: img.mime, data: img.data, sizeBytes: img.data.length, sha256: img.sha256, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'branding.upload', entityType: 'brand_asset', entityId: params.slot, metadata: { slot: params.slot, sizeBytes: img.data.length, mime: img.mime, sha256: img.sha256 } });
      return { slot: params.slot, sha256: img.sha256, sizeBytes: img.data.length };
    },
  }),
  defineRoute({
    method: 'DELETE',
    url: '/admin/branding/:slot',
    summary: 'Remove a imagem e volta ao padrão (espaço vazio)',
    tag: 'Administração',
    ...ADMIN,
    params: SlotParams,
    handler: async ({ app, auth, params, req, reply }) => {
      await app.db.delete(s.brandAssets).where(and(eq(s.brandAssets.tenantId, auth.tenantId), eq(s.brandAssets.slot, params.slot)));
      await audit(app.db, req, { action: 'branding.delete', entityType: 'brand_asset', entityId: params.slot, metadata: { slot: params.slot } });
      return reply.code(204).send();
    },
  }),

  // ------------------------------------------------------------------ meu perfil (qualquer usuário)
  defineRoute({
    method: 'PATCH',
    url: '/me/profile',
    summary: 'Atualiza nome e cargo do próprio usuário',
    tag: 'Perfil',
    anyAuthenticated: true,
    body: z.object({ name: z.string().trim().min(2).max(120), jobTitle: z.string().trim().max(80).optional().nullable() }),
    handler: async ({ app, auth, body, req }) => {
      await app.db.update(s.users).set({ name: body.name, jobTitle: body.jobTitle ?? null, updatedAt: new Date() }).where(eq(s.users.id, auth.userId));
      await audit(app.db, req, { action: 'profile.update', entityType: 'user', entityId: auth.userId });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/me/password',
    summary: 'Troca a própria senha (encerra as outras sessões)',
    tag: 'Perfil',
    anyAuthenticated: true,
    body: PasswordChange,
    rateLimit: (c) => ({ max: c.loginRateLimitPerMinute, timeWindow: '1 minute' }),
    handler: async ({ app, auth, body, req }) => {
      const u = await userRow(app.db, auth, auth.userId);
      if (!(await verifyPassword(body.current, u.passwordHash))) throw unprocessable('Senha atual incorreta.', [{ path: 'current', message: 'Senha atual incorreta' }]);
      await app.db.update(s.users).set({ passwordHash: await hashPassword(body.next), updatedAt: new Date() }).where(eq(s.users.id, auth.userId));
      await app.db.update(s.sessions).set({ revokedAt: new Date() }).where(and(eq(s.sessions.userId, auth.userId), ne(s.sessions.id, auth.sessionId)));
      await audit(app.db, req, { action: 'profile.password', entityType: 'user', entityId: auth.userId });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'PUT',
    url: '/me/avatar',
    summary: 'Envia a própria foto',
    tag: 'Perfil',
    anyAuthenticated: true,
    body: ImageUpload,
    bodyLimit: 3_200_000,
    handler: async ({ app, auth, body }) => {
      const img = decodeImage(body.data);
      await app.db.insert(s.userAvatars).values({ userId: auth.userId, mime: img.mime, data: img.data }).onConflictDoUpdate({ target: s.userAvatars.userId, set: { mime: img.mime, data: img.data, updatedAt: new Date() } });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ servir imagens
  defineRoute({
    method: 'GET',
    url: '/brand/:slot',
    summary: 'Imagem de um espaço da Personalização da empresa da sessão',
    tag: 'Personalização',
    anyAuthenticated: true,
    params: SlotParams,
    handler: async ({ app, auth, params, reply }) => {
      const [a] = await app.db.select().from(s.brandAssets).where(and(eq(s.brandAssets.tenantId, auth.tenantId), eq(s.brandAssets.slot, params.slot))).limit(1);
      if (!a) throw notFound('Imagem não enviada.');
      return reply
        .header('content-type', a.mime)
        .header('cache-control', 'private, max-age=300')
        .header('etag', `"${a.sha256}"`)
        .header('content-security-policy', "default-src 'none'")
        .send(a.data);
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/public/brand/:slot',
    summary: 'Imagem pública da empresa principal (logo e arte da tela de login)',
    tag: 'Personalização',
    public: true,
    params: SlotParams,
    handler: async ({ app, params, reply }) => {
      const slug = process.env.PRIMARY_TENANT_SLUG ?? 'yepnet';
      const [a] = await app.db
        .select({ mime: s.brandAssets.mime, data: s.brandAssets.data, sha256: s.brandAssets.sha256 })
        .from(s.brandAssets)
        .innerJoin(s.tenants, eq(s.tenants.id, s.brandAssets.tenantId))
        .where(and(eq(s.tenants.slug, slug), eq(s.brandAssets.slot, params.slot)))
        .limit(1);
      if (!a) throw notFound('Imagem não enviada.');
      return reply
        .header('content-type', a.mime)
        .header('cache-control', 'public, max-age=300')
        .header('etag', `"${a.sha256}"`)
        .header('content-security-policy', "default-src 'none'")
        .send(a.data);
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/users/:id/avatar',
    summary: 'Foto de um usuário da mesma empresa',
    tag: 'Perfil',
    anyAuthenticated: true,
    params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [a] = await app.db
        .select({ mime: s.userAvatars.mime, data: s.userAvatars.data })
        .from(s.userAvatars)
        .innerJoin(s.users, eq(s.users.id, s.userAvatars.userId))
        .where(and(eq(s.userAvatars.userId, params.id), eq(s.users.tenantId, auth.tenantId)))
        .limit(1);
      if (!a) throw notFound('Sem foto.');
      return reply.header('content-type', a.mime).header('cache-control', 'private, max-age=300').header('content-security-policy', "default-src 'none'").send(a.data);
    },
  }),
];

