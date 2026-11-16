/**
 * Usuários de webservice (API de integração): cadastrados pela administração, entram SÓ por token
 * ("Authorization: Bearer isk_…"). O que podem ler e gravar vem do perfil escolhido, como para qualquer usuário.
 * O token aparece uma única vez; guardamos só o hash. Revogar corta o acesso na hora.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { PROFILE_KEYS, PROFILE_LABELS } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import { API_TOKEN_PREFIX } from '../http/context';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { hashPassword, hashToken } from '../auth/password';
import { ensureRoles } from './admin';

const ADMIN = { tag: 'Webservice', module: 'configuracoes' as const, min: 'total' as const };
/** administrador fica de fora: integração nunca administra a empresa */
export const WEBSERVICE_PROFILES = PROFILE_KEYS.filter((p) => p !== 'administrador') as Exclude<(typeof PROFILE_KEYS)[number], 'administrador'>[];
const Profile = z.enum(WEBSERVICE_PROFILES as [string, ...string[]]);
const name = z.string().trim().min(2).max(80);

async function serviceUser(db: Parameters<typeof ensureRoles>[0], tenantId: string, id: string) {
  const [u] = await db.select().from(s.users).where(and(eq(s.users.id, id), eq(s.users.tenantId, tenantId), eq(s.users.service, true))).limit(1);
  if (!u) throw notFound('Usuário de webservice não encontrado.');
  return u;
}

export const webserviceRoutes = [
  defineRoute({
    method: 'GET', url: '/admin/webservice', summary: 'Usuários de webservice, perfis e tokens (sem o valor do token)', ...ADMIN,
    handler: async ({ app, auth }) => {
      const users = await app.db.select({ id: s.users.id, name: s.users.name, email: s.users.email, active: s.users.active, jobTitle: s.users.jobTitle, ipBypass: s.users.ipBypass, createdAt: s.users.createdAt })
        .from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.service, true))).orderBy(asc(s.users.name));
      const ids = users.map((u) => u.id);
      const roles = ids.length ? await app.db.select({ userId: s.userRoles.userId, key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(inArray(s.userRoles.userId, ids)) : [];
      const tokens = ids.length ? await app.db.select({ id: s.apiTokens.id, userId: s.apiTokens.userId, name: s.apiTokens.name, last4: s.apiTokens.last4, createdAt: s.apiTokens.createdAt, expiresAt: s.apiTokens.expiresAt, revokedAt: s.apiTokens.revokedAt, lastUsedAt: s.apiTokens.lastUsedAt, lastUsedIp: s.apiTokens.lastUsedIp })
        .from(s.apiTokens).where(inArray(s.apiTokens.userId, ids)).orderBy(desc(s.apiTokens.createdAt)) : [];
      return {
        profiles: WEBSERVICE_PROFILES.map((k) => ({ key: k, label: PROFILE_LABELS[k] })),
        users: users.map((u) => ({ ...u, profile: roles.find((r) => r.userId === u.id)?.key ?? null, tokens: tokens.filter((t) => t.userId === u.id) })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/webservice', summary: 'Cadastra um usuário de webservice (não entra pela tela; acesso pelo perfil)', ...ADMIN,
    body: z.object({ name, profile: Profile, description: z.string().trim().max(80).optional().nullable() }),
    handler: async ({ app, auth, body, req, reply }) => {
      const u = await app.db.transaction(async (tx) => {
        const roles = await ensureRoles(tx, auth.tenantId);
        // e-mail técnico (único, nunca recebe nada); senha aleatória que ninguém conhece
        const email = `webservice-${randomBytes(5).toString('hex')}@api.ispsprint.invalid`;
        const [row] = await tx.insert(s.users).values({ tenantId: auth.tenantId, name: body.name, email, jobTitle: body.description ?? 'Webservice', service: true, sectorRole: 'observador', sectorViewer: true, passwordHash: await hashPassword(randomBytes(32).toString('base64url')) }).returning({ id: s.users.id });
        await tx.insert(s.userRoles).values({ userId: row!.id, roleId: roles[body.profile as keyof typeof roles]! });
        await audit(tx, req, { action: 'webservice.create', entityType: 'user', entityId: row!.id, metadata: { name: body.name, profile: body.profile } });
        return row!;
      });
      reply.code(201);
      return u;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/admin/webservice/:id', summary: 'Altera nome, perfil ou situação do usuário de webservice (desativar corta todos os tokens)', ...ADMIN,
    params: IdParams, body: z.object({ name: name.optional(), profile: Profile.optional(), active: z.boolean().optional(), description: z.string().trim().max(80).optional().nullable() }),
    handler: async ({ app, auth, params, body, req }) => {
      await app.db.transaction(async (tx) => {
        const u = await serviceUser(tx, auth.tenantId, params.id);
        await tx.update(s.users).set({ name: body.name, active: body.active, jobTitle: body.description === undefined ? undefined : body.description ?? 'Webservice', updatedAt: new Date() }).where(eq(s.users.id, u.id));
        if (body.profile) {
          const roles = await ensureRoles(tx, auth.tenantId);
          await tx.delete(s.userRoles).where(eq(s.userRoles.userId, u.id));
          await tx.insert(s.userRoles).values({ userId: u.id, roleId: roles[body.profile as keyof typeof roles]! });
        }
        await audit(tx, req, { action: 'webservice.update', entityType: 'user', entityId: u.id, metadata: { name: body.name, profile: body.profile, active: body.active } });
      });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/webservice/:id/tokens', summary: 'Gera um token de acesso (mostrado UMA única vez)', ...ADMIN,
    params: IdParams, body: z.object({ name: z.string().trim().min(2).max(60), expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).nullable().default(365) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const u = await serviceUser(app.db, auth.tenantId, params.id);
      if (!u.active) throw unprocessable('Ative o usuário de webservice antes de gerar um token.');
      const token = `${API_TOKEN_PREFIX}${randomBytes(30).toString('base64url')}`;
      const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null;
      const [row] = await app.db.insert(s.apiTokens).values({ tenantId: auth.tenantId, userId: u.id, name: body.name, tokenHash: hashToken(token), last4: token.slice(-4), createdBy: auth.userId, expiresAt }).returning({ id: s.apiTokens.id });
      await audit(app.db, req, { action: 'webservice.token_create', entityType: 'api_token', entityId: row!.id, metadata: { user: u.name, name: body.name, expiresInDays: body.expiresInDays } });
      reply.code(201);
      return { id: row!.id, token, expiresAt };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/webservice/tokens/:id/revoke', summary: 'Revoga um token (para de funcionar na hora)', ...ADMIN,
    params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      const [t] = await app.db.update(s.apiTokens).set({ revokedAt: new Date(), revokedBy: auth.userId })
        .where(and(eq(s.apiTokens.id, params.id), eq(s.apiTokens.tenantId, auth.tenantId), isNull(s.apiTokens.revokedAt))).returning({ id: s.apiTokens.id, name: s.apiTokens.name });
      if (!t) throw notFound('Token não encontrado ou já revogado.');
      await audit(app.db, req, { action: 'webservice.token_revoke', entityType: 'api_token', entityId: t.id, metadata: { name: t.name } });
      return { ok: true };
    },
  }),
];
