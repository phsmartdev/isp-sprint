import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginInput } from '@isp/shared';
import { defineRoute } from '../http/route';
import { AppError } from '../http/errors';
import { SESSION_COOKIE, resolveSession } from '../http/context';
import * as s from '../db/schema';
import { DUMMY_HASH, hashToken, newSessionToken, verifyPassword } from '../auth/password';
import { audit } from '../services/audit';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function meDto(auth: NonNullable<Awaited<ReturnType<typeof resolveSession>>>, hasAvatar = false) {
  return {
    user: { id: auth.userId, name: auth.name, email: auth.email, jobTitle: auth.jobTitle, hasAvatar },
    tenant: { id: auth.tenantId, name: auth.tenantName, timezone: auth.timezone },
    profiles: auth.profiles,
    access: auth.access,
    teamIds: auth.teamIds,
    teamMemberIds: auth.teamMemberIds,
    sectors: auth.sectors,
    modules: auth.modules,
    moduleReasons: auth.moduleReasons,
    disabledFeatures: auth.disabledFeatures,
    actions: auth.actions,
  };
}

async function hasAvatar(app: Parameters<typeof resolveSession>[0], userId: string) {
  const r = await app.db.select({ u: s.userAvatars.userId }).from(s.userAvatars).where(eq(s.userAvatars.userId, userId)).limit(1);
  return r.length > 0;
}

/** Cria a sessão em cookie (senha ou Google) e devolve o contexto. */
export async function startSession(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, user: { id: string; tenantId: string }, via = 'senha') {
  const now = new Date();
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + app.config.sessionTtlHours * 3_600_000);
  await app.db.insert(s.sessions).values({ userId: user.id, tenantId: user.tenantId, tokenHash: hashToken(token), expiresAt, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) });
  await app.db.update(s.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(s.users.id, user.id));
  await audit(app.db, req, { action: 'auth.login', tenantId: user.tenantId, actorId: user.id, metadata: { via } });
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: app.config.cookieSecure, path: '/', signed: true, expires: expiresAt });
  req.cookies[SESSION_COOKIE] = reply.signCookie(token);
  return resolveSession(app, req);
}

export const authRoutes = [
  defineRoute({
    method: 'POST',
    url: '/auth/login',
    summary: 'Login com e-mail e senha; cria sessão em cookie httpOnly',
    tag: 'Auth',
    public: true,
    body: LoginInput,
    rateLimit: (c) => ({ max: c.loginRateLimitPerMinute, timeWindow: '1 minute' }),
    handler: async ({ app, req, reply, body }) => {
      const [user] = await app.db.select().from(s.users).where(sql`lower(${s.users.email}) = ${body.email}`).limit(1);
      const now = new Date();
      // sempre roda o hash para igualar o tempo de resposta
      const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
      const generic = new AppError(401, 'Credenciais inválidas', 'E-mail ou senha incorretos.');

      if (!user || !user.active) {
        await audit(app.db, req, { action: 'auth.login_failed', tenantId: user?.tenantId ?? null, actorId: user?.id ?? null, metadata: { reason: user ? 'inactive' : 'unknown_user' } });
        throw generic;
      }
      if (user.lockedUntil && user.lockedUntil > now) {
        await audit(app.db, req, { action: 'auth.login_blocked', tenantId: user.tenantId, actorId: user.id });
        throw new AppError(423, 'Conta temporariamente bloqueada', `Muitas tentativas. Tente novamente em até ${LOCK_MINUTES} minutos.`);
      }
      if (!ok) {
        const failed = user.failedLogins + 1;
        await app.db
          .update(s.users)
          .set({ failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null })
          .where(eq(s.users.id, user.id));
        await audit(app.db, req, { action: 'auth.login_failed', tenantId: user.tenantId, actorId: user.id, metadata: { failed } });
        throw generic;
      }

      const ctx = await startSession(app, req, reply, user);
      return meDto(ctx!, await hasAvatar(app, user.id));
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/auth/logout',
    summary: 'Revoga a sessão atual',
    tag: 'Auth',
    anyAuthenticated: true,
    handler: async ({ app, req, reply, auth }) => {
      await app.db.update(s.sessions).set({ revokedAt: new Date() }).where(and(eq(s.sessions.id, auth.sessionId), eq(s.sessions.userId, auth.userId)));
      await audit(app.db, req, { action: 'auth.logout' });
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send();
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/me',
    summary: 'Usuário, empresa, papéis e permissões da sessão',
    tag: 'Auth',
    anyAuthenticated: true,
    handler: async ({ app, auth }) => meDto(auth, await hasAvatar(app, auth.userId)),
  }),
];
