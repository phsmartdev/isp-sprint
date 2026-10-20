/** Entrar com Google, "Esqueci minha senha" e recuperação de acesso pelo deploy. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, ORIGIN, TEST_DB, type Client } from './helpers';
import { setTransportFactory } from '../src/services/email';
import { recoverAccess } from '../src/db/recover';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
let userId: string;
const EMAIL = 'acesso.teste@yepnet.test';
const sent: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  ctx = await makeApp({ GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'gsecret', PUBLIC_URL: 'https://crm.exemplo.test' });
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  setTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  const r = await carlos.post('/admin/users', { name: 'Acesso Teste Fictício', email: EMAIL, profile: 'gerencia' });
  expect(r.statusCode, r.body).toBeLessThan(300);
  userId = r.json().id;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: false });
  setTransportFactory(null);
  await ctx.close();
});

const cookieOf = (h: string | string[] | undefined, name: string) => (Array.isArray(h) ? h : [h ?? '']).find((c) => c.startsWith(`${name}=`))?.split(';')[0];

describe('Google', () => {
  it('informa os provedores e redireciona ao Google com state', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/providers' })).json()).toEqual({ google: true, passwordReset: true });
    const r = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/google/start?next=/contracts' });
    expect(r.statusCode).toBe(302);
    const loc = new URL(r.headers.location as string);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://crm.exemplo.test/api/v1/auth/google/callback');
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    expect(cookieOf(r.headers['set-cookie'], 'isp_oauth')).toBeTruthy();
  });

  async function flow(userinfo: Record<string, unknown>, next = '/contracts') {
    const start = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/google/start?next=${encodeURIComponent(next)}` });
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const cookie = cookieOf(start.headers['set-cookie'], 'isp_oauth')!;
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push(String(url));
      if (String(url).includes('oauth2.googleapis.com/token')) {
        expect(String(init?.body)).toContain('client_secret=gsecret');
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
      }
      return new Response(JSON.stringify(userinfo), { status: 200 });
    });
    const cb = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?code=abc&state=${state}`, headers: { cookie } });
    return { cb, calls };
  }

  it('entra na conta com o mesmo e-mail verificado e vincula a conta Google', async () => {
    const { cb, calls } = await flow({ sub: 'g-123', email: EMAIL.toUpperCase(), email_verified: true });
    expect(calls).toHaveLength(2);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/contracts');
    const session = cookieOf(cb.headers['set-cookie'], 'isp_session')!;
    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: session } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(userId);
    const [u] = (await ctx.db.execute(sql`select google_sub from users where id = ${userId}`)).rows as { google_sub: string }[];
    expect(u!.google_sub).toBe('g-123');
  });

  it('recusa e-mail não verificado, usuário inexistente, outra conta Google, state inválido e next externo', async () => {
    expect((await flow({ sub: 'g-123', email: EMAIL, email_verified: false })).cb.headers.location).toBe('/login?erro=google_email');
    expect((await flow({ sub: 'g-9', email: 'ninguem@exemplo.test', email_verified: true })).cb.headers.location).toBe('/login?erro=google_sem_usuario');
    expect((await flow({ sub: 'g-OUTRA', email: EMAIL, email_verified: true })).cb.headers.location).toBe('/login?erro=google_outra_conta');
    const bad = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/google/callback?code=abc&state=forjado' });
    expect(bad.headers.location).toBe('/login?erro=google_estado');
    expect((await flow({ sub: 'g-123', email: EMAIL, email_verified: true }, '//evil.example')).cb.headers.location).toBe('/');
  });

  it('respeita domínios permitidos e fica desligado sem credenciais', async () => {
    const other = await makeApp({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_ALLOWED_DOMAINS: 'bktele.com.br' });
    const start = await other.app.inject({ method: 'GET', url: '/api/v1/auth/google/start' });
    expect(new URL(start.headers.location as string).searchParams.get('hd')).toBe('bktele.com.br');
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(String(url).includes('token') ? { access_token: 'a' } : { sub: 's', email: EMAIL, email_verified: true }), { status: 200 }));
    const cb = await other.app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?code=c&state=${state}`, headers: { cookie: cookieOf(start.headers['set-cookie'], 'isp_oauth')! } });
    expect(cb.headers.location).toBe('/login?erro=google_dominio');
    await other.close();
    const off = await makeApp({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect((await off.app.inject({ method: 'GET', url: '/api/v1/auth/providers' })).json().google).toBe(false);
    expect((await off.app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })).headers.location).toBe('/login?erro=google_desligado');
    await off.close();
  });
});

describe('Esqueci minha senha', () => {
  const post = (url: string, payload: object) => ctx.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { origin: ORIGIN }, payload });

  it('resposta é a mesma exista ou não a conta; o link cria nova senha uma única vez', async () => {
    expect((await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: true })).statusCode).toBe(200);
    const none = await post('/auth/password/forgot', { email: 'ninguem@exemplo.test' });
    const r = await post('/auth/password/forgot', { email: EMAIL });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(none.json());
    const mail = sent.find((m) => m.to === EMAIL)!;
    expect(mail.subject).toBe('Criar nova senha do CRM');
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    expect(mail.text).toContain('https://crm.exemplo.test/redefinir-senha?token=');

    expect((await post('/auth/password/reset', { token, password: 'curta' })).statusCode).toBe(422);
    const ok = await post('/auth/password/reset', { token, password: 'NovaSenha@2026' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await post('/auth/password/reset', { token, password: 'OutraSenha@2026' })).statusCode).toBe(422);
    await login(ctx.app, EMAIL, 'NovaSenha@2026');
  });
});

describe('recuperação pelo deploy', () => {
  it('redefine senha, desbloqueia e reativa; cria Gerência quando não existe', async () => {
    await ctx.db.execute(sql`update users set failed_logins = 5, locked_until = now() + interval '1 hour', active = false where id = ${userId}`);
    expect(await recoverAccess(TEST_DB, ` ${EMAIL.toUpperCase()} `, 'Recupera@2026')).toBe('reset');
    await login(ctx.app, EMAIL, 'Recupera@2026');
    expect(await recoverAccess(TEST_DB, EMAIL, 'curta')).toBe('weak_password');
    // o banco de teste tem mais de uma empresa: não cria usuário sem saber qual
    expect(await recoverAccess(TEST_DB, 'novo.admin@yepnet.test', 'Recupera@2026')).toBe('many_tenants');
  });

  it('gerência corrige o e-mail do usuário (e desvincula o Google)', async () => {
    const dup = await carlos.patch(`/admin/users/${userId}`, { email: 'ana@yepnet.test' });
    expect(dup.statusCode).toBe(422);
    expect((await carlos.patch(`/admin/users/${userId}`, { email: 'Acesso.Novo@yepnet.test' })).statusCode).toBe(200);
    const [u] = (await ctx.db.execute(sql`select email, google_sub from users where id = ${userId}`)).rows as { email: string; google_sub: string | null }[];
    expect(u).toEqual({ email: 'acesso.novo@yepnet.test', google_sub: null });
    await login(ctx.app, 'acesso.novo@yepnet.test', 'Recupera@2026');
  });
});
