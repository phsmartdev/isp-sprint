import { setIndexFetcher } from '../src/services/indices';
import { addMonths } from '@isp/domain';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'Sprint@2026';

export async function makeApp(env: Record<string, string> = {}) {
  const config = loadConfig({ ...process.env, DATABASE_URL: TEST_DB, WEB_ORIGIN: ORIGIN, NODE_ENV: 'test', LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT_PER_MINUTE: '1000', ...env });
  const { db, pool } = createDb(TEST_DB);
  // índices oficiais simulados nos testes (sem rede): 0,40% ao mês em qualquer série
  setIndexFetcher(async (_code, from, to) => { const out: { month: string; pct: number }[] = []; for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(`${m}-01`, 1).slice(0, 7)) out.push({ month: m, pct: 0.4 }); return out; });
  const app = await buildApp({ config, db, logger: false, rateLimitMax: 10_000 });
  return { app, db, pool, close: async () => { await app.close(); await pool.end(); } };
}

export type Client = {
  cookie: string;
  get: (url: string) => Promise<LightMyRequestResponse>;
  post: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  patch: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  put: (url: string, body?: unknown) => Promise<LightMyRequestResponse>;
  del: (url: string) => Promise<LightMyRequestResponse>;
  me: { user: { id: string; name: string }; tenant: { id: string }; profiles: string[]; access: Record<string, string> };
};

export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<Client> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login ${email} falhou: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE') => (url: string, body?: unknown) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { cookie, origin: ORIGIN }, ...(body !== undefined ? { payload: body as object } : {}) });
  return { cookie, get: send('GET'), post: send('POST'), patch: send('PATCH'), put: send('PUT'), del: (url: string) => send('DELETE')(url), me: res.json() };
}
