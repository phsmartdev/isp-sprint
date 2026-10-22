import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(3333),
  WEB_ORIGIN: z.string().default('http://localhost:5173').refine((v) => v.split(',').every((o) => /^https?:\/\/[^\s/]+$/.test(o.trim())), 'WEB_ORIGIN: lista de origens separadas por vírgula'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),
  COOKIE_SECRET: z.string().min(32).optional(),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
});

/** Na Vercel, as URLs do próprio deploy entram como origem permitida e o cookie é sempre Secure. */
function vercelDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.VERCEL) return env;
  const hosts = [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((h) => `https://${h}`);
  const origins = [...(env.WEB_ORIGIN ? env.WEB_ORIGIN.split(',') : []), ...(env.PUBLIC_URL ? [env.PUBLIC_URL.replace(/\/$/, '')] : []), ...hosts].map((s) => s.trim()).filter(Boolean);
  return { ...env, NODE_ENV: env.NODE_ENV ?? 'production', COOKIE_SECURE: env.COOKIE_SECURE ?? 'true', WEB_ORIGIN: [...new Set(origins)].join(',') || undefined };
}

export type Config = {
  trustProxy: boolean;
  /** Endereço público do sistema, usado nos links dos e-mails. */
  publicUrl: string;
  cronSecret: string | null;
  databaseUrl: string;
  port: number;
  webOrigins: string[];
  cookieSecure: boolean;
  sessionTtlHours: number;
  isProd: boolean;
  logLevel: string;
  cookieSecret: string;
  loginRateLimitPerMinute: number;
  /** Login com Google (OAuth). Sem as duas variáveis, o botão não aparece. */
  google: { clientId: string; clientSecret: string; allowedDomains: string[] } | null;
  /**
   * E-mail corporativo (Gmail API). Usa o mesmo cliente OAuth do login com Google, com os escopos do Gmail.
   * Os endereços do Google só podem ser trocados fora de produção (servidor simulado nos testes).
   */
  gmail: { clientId: string; clientSecret: string; simulated: boolean; endpoints: GoogleEndpoints } | null;
};
export type GoogleEndpoints = { auth: string; token: string; userinfo: string; revoke: string; gmail: string };
export const REAL_GOOGLE: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  revoke: 'https://oauth2.googleapis.com/revoke',
  gmail: 'https://gmail.googleapis.com/gmail/v1',
};
function gmailConfig(env: NodeJS.ProcessEnv, isProd: boolean): Config['gmail'] {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const fake = !isProd && env.GOOGLE_FAKE_BASE ? env.GOOGLE_FAKE_BASE.replace(/\/$/, '') : null;
  const endpoints = fake ? { auth: `${fake}/o/oauth2/v2/auth`, token: `${fake}/token`, userinfo: `${fake}/v1/userinfo`, revoke: `${fake}/revoke`, gmail: `${fake}/gmail/v1` } : REAL_GOOGLE;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, simulated: !!fake, endpoints };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(vercelDefaults(env));
  const isProd = e.NODE_ENV === 'production';
  if (isProd && !e.COOKIE_SECRET) throw new Error('COOKIE_SECRET (>= 32 caracteres) é obrigatório em produção');
  if (isProd && !e.COOKIE_SECURE) throw new Error('COOKIE_SECURE=true é obrigatório em produção (HTTPS)');
  return {
    publicUrl: env.PUBLIC_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : e.WEB_ORIGIN.split(',')[0]!.trim()),
    cronSecret: env.CRON_SECRET ?? null,
    trustProxy: !!env.VERCEL || isProd || env.TRUST_PROXY === 'true',
    cookieSecret: e.COOKIE_SECRET ?? 'dev-only-cookie-secret-change-me-0123456789',
    databaseUrl: e.DATABASE_URL,
    port: e.API_PORT,
    webOrigins: e.WEB_ORIGIN.split(',').map((s) => s.trim()),
    cookieSecure: e.COOKIE_SECURE,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    isProd,
    loginRateLimitPerMinute: e.LOGIN_RATE_LIMIT_PER_MINUTE,
    logLevel: e.LOG_LEVEL,
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, allowedDomains: (env.GOOGLE_ALLOWED_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) }
      : null,
    gmail: gmailConfig(env, isProd),
  };
}
