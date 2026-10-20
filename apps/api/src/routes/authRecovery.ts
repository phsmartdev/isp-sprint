/**
 * Entrar com Google (OAuth 2.0 / OpenID Connect) e "Esqueci minha senha" por e-mail.
 * Google só entra em contas que já existem no CRM, ativas e com o mesmo e-mail verificado.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { hashPassword, hashToken } from '../auth/password';
import { audit } from '../services/audit';
import { sendAlert, smtpConfig } from '../services/email';
import { publicLink } from '../services/alerts';
import { startSession } from './auth';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_COOKIE = 'isp_oauth';
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const safeNext = (n: unknown) => (typeof n === 'string' && /^\/(?!\/)[\w\-/?=&%.#]*$/.test(n) ? n : '/');
const callbackUrl = (publicUrl: string) => `${publicUrl.replace(/\/$/, '')}/api/v1/auth/google/callback`;

function signState(secret: string, payload: object) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(createHmac('sha256', secret).update(`oauth:${body}`).digest())}`;
}
function readState(secret: string, raw: string | undefined): { state: string; next: string; exp: number } | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(`oauth:${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString()) as { state: string; next: string; exp: number };
    return v.exp > Date.now() ? v : null;
  } catch { return null; }
}

export const authRecoveryRoutes = [
  defineRoute({
    method: 'GET',
    url: '/auth/providers',
    summary: 'Formas de entrar disponíveis (para a tela de login)',
    tag: 'Auth',
    public: true,
    handler: async ({ app }) => ({ google: !!app.config.google, passwordReset: true }),
  }),

  defineRoute({
    method: 'GET',
    url: '/auth/google/start',
    summary: 'Redireciona para o login do Google',
    tag: 'Auth',
    public: true,
    query: z.object({ next: z.string().max(300).optional() }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, query, reply }) => {
      const g = app.config.google;
      if (!g) return reply.redirect('/login?erro=google_desligado');
      const state = b64u(randomBytes(24));
      reply.setCookie(STATE_COOKIE, signState(app.config.cookieSecret, { state, next: safeNext(query.next), exp: Date.now() + 10 * 60_000 }), { httpOnly: true, sameSite: 'lax', secure: app.config.cookieSecure, path: '/api/v1/auth/google', maxAge: 600 });
      const params = new URLSearchParams({ client_id: g.clientId, redirect_uri: callbackUrl(app.config.publicUrl), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account', access_type: 'online' });
      if (g.allowedDomains.length === 1) params.set('hd', g.allowedDomains[0]!);
      return reply.redirect(`${GOOGLE_AUTH}?${params}`);
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/auth/google/callback',
    summary: 'Retorno do Google: confere o estado, troca o código e entra na conta do CRM com o mesmo e-mail',
    tag: 'Auth',
    public: true,
    query: z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, req, reply, query }) => {
      const fail = (code: string) => { reply.clearCookie(STATE_COOKIE, { path: '/api/v1/auth/google' }); return reply.redirect(`/login?erro=${code}`); };
      const g = app.config.google;
      if (!g) return fail('google_desligado');
      if (query.error) return fail('google_cancelado');
      const raw = req.cookies[STATE_COOKIE];
      const unsigned = raw ? req.unsignCookie(raw) : null;
      const st = readState(app.config.cookieSecret, unsigned?.valid ? unsigned.value ?? undefined : raw);
      if (!st || !query.state || st.state !== query.state || !query.code) return fail('google_estado');
      let info: { sub?: string; email?: string; email_verified?: boolean; hd?: string };
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 10_000);
        const tok = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: query.code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: callbackUrl(app.config.publicUrl), grant_type: 'authorization_code' }), signal: ctl.signal });
        const tj = (await tok.json()) as { access_token?: string; error?: string };
        if (!tok.ok || !tj.access_token) { clearTimeout(t); req.log.warn({ error: tj.error }, 'google token'); return fail('google_falhou'); }
        const ui = await fetch(GOOGLE_USERINFO, { headers: { authorization: `Bearer ${tj.access_token}` }, signal: ctl.signal });
        clearTimeout(t);
        info = (await ui.json()) as typeof info;
        if (!ui.ok) return fail('google_falhou');
      } catch (e) {
        req.log.warn({ err: (e as Error).message }, 'google oauth');
        return fail('google_falhou');
      }
      const email = (info.email ?? '').toLowerCase();
      if (!info.sub || !email || info.email_verified !== true) return fail('google_email');
      if (g.allowedDomains.length && !g.allowedDomains.includes(email.split('@')[1] ?? '')) return fail('google_dominio');
      const [user] = await app.db.select().from(s.users).where(sql`lower(${s.users.email}) = ${email}`).limit(1);
      if (!user || !user.active) {
        await audit(app.db, req, { action: 'auth.login_failed', tenantId: user?.tenantId ?? null, actorId: user?.id ?? null, metadata: { via: 'google', reason: user ? 'inactive' : 'unknown_user' } });
        return fail('google_sem_usuario');
      }
      if (user.googleSub && user.googleSub !== info.sub) {
        await audit(app.db, req, { action: 'auth.login_failed', tenantId: user.tenantId, actorId: user.id, metadata: { via: 'google', reason: 'other_google_account' } });
        return fail('google_outra_conta');
      }
      if (!user.googleSub) await app.db.update(s.users).set({ googleSub: info.sub }).where(eq(s.users.id, user.id));
      await startSession(app, req, reply, user, 'google');
      reply.clearCookie(STATE_COOKIE, { path: '/api/v1/auth/google' });
      return reply.redirect(st.next);
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/auth/password/forgot',
    summary: 'Envia por e-mail o link para criar uma nova senha (resposta igual exista ou não a conta)',
    tag: 'Auth',
    public: true,
    body: z.object({ email: z.string().trim().toLowerCase().email().max(200) }),
    rateLimit: () => ({ max: 5, timeWindow: '1 minute' }),
    handler: async ({ app, req, body }) => {
      const generic = { ok: true, message: 'Se o e-mail estiver cadastrado, enviamos o link para criar uma nova senha. Ele vale por 1 hora.' };
      const [user] = await app.db.select().from(s.users).where(sql`lower(${s.users.email}) = ${body.email}`).limit(1);
      if (!user || !user.active) return generic;
      const smtp = await smtpConfig(app.db, user.tenantId);
      if (!smtp?.enabled) {
        await audit(app.db, req, { action: 'auth.password_reset_unavailable', tenantId: user.tenantId, actorId: user.id });
        return generic;
      }
      // um pedido por vez: invalida os anteriores
      await app.db.update(s.passwordResets).set({ usedAt: new Date() }).where(and(eq(s.passwordResets.userId, user.id), isNull(s.passwordResets.usedAt)));
      const token = b64u(randomBytes(32));
      await app.db.insert(s.passwordResets).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60_000) });
      const link = publicLink(app.config, `/redefinir-senha?token=${token}`);
      await sendAlert(app.db, { tenantId: user.tenantId, kind: 'senha_redefinir', to: user.email, subject: 'Criar nova senha do CRM', text: `Olá, ${user.name.split(' ')[0]}.\n\nRecebemos um pedido para criar uma nova senha. Use o link abaixo (vale por 1 hora, uma única vez):\n\n${link}\n\nSe não foi você, ignore este e-mail; sua senha continua a mesma.` });
      await audit(app.db, req, { action: 'auth.password_reset_requested', tenantId: user.tenantId, actorId: user.id });
      return generic;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/auth/password/reset',
    summary: 'Cria a nova senha com o código do e-mail (uso único) e encerra as sessões abertas',
    tag: 'Auth',
    public: true,
    body: z.object({ token: z.string().min(20).max(100), password: z.string().min(10, 'Use ao menos 10 caracteres').max(200) }),
    rateLimit: () => ({ max: 10, timeWindow: '1 minute' }),
    handler: async ({ app, req, body }) => {
      const now = new Date();
      const [r] = await app.db.select().from(s.passwordResets).where(and(eq(s.passwordResets.tokenHash, hashToken(body.token)), isNull(s.passwordResets.usedAt), gt(s.passwordResets.expiresAt, now))).limit(1);
      if (!r) throw unprocessable('Link inválido ou expirado. Peça um novo em “Esqueci minha senha”.');
      const [user] = await app.db.select().from(s.users).where(eq(s.users.id, r.userId)).limit(1);
      if (!user?.active) throw unprocessable('Link inválido ou expirado. Peça um novo em “Esqueci minha senha”.');
      await app.db.transaction(async (tx) => {
        const used = await tx.update(s.passwordResets).set({ usedAt: now }).where(and(eq(s.passwordResets.id, r.id), isNull(s.passwordResets.usedAt))).returning({ id: s.passwordResets.id });
        if (!used.length) throw unprocessable('Este link já foi usado.');
        await tx.update(s.users).set({ passwordHash: await hashPassword(body.password), failedLogins: 0, lockedUntil: null, updatedAt: now }).where(eq(s.users.id, user.id));
        await tx.update(s.sessions).set({ revokedAt: now }).where(and(eq(s.sessions.userId, user.id), isNull(s.sessions.revokedAt)));
      });
      await audit(app.db, req, { action: 'auth.password_reset', tenantId: user.tenantId, actorId: user.id });
      return { ok: true };
    },
  }),
];
