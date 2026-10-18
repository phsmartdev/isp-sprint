import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;

/**
 * Banco local: sem TLS. Banco gerenciado (Supabase, Neon…): TLS obrigatório.
 * O `sslmode` da URL é removido porque o driver o trataria como verificação completa da cadeia,
 * que falha com o certificado do pooler do Supabase; a conexão continua cifrada.
 */
export function poolConfig(url: string, max = 10): pg.PoolConfig {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname) || process.env.DB_SSL === 'disable';
  u.searchParams.delete('sslmode');
  return { connectionString: u.toString(), max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ssl: local ? undefined : { rejectUnauthorized: false } };
}

/**
 * Na Vercel cada instância da função abre conexões próprias. O pooler do Supabase em modo
 * sessão (porta 5432) tem poucas vagas e esgota ("max clients reached"); o modo transação
 * (porta 6543, mesmo host) devolve a conexão a cada transação. O driver usa consultas sem
 * nome (sem prepared statements nomeados) e os bloqueios são por transação, então é seguro.
 * DB_POOL_MODE=session desliga a troca.
 */
export function serverlessUrl(url: string) {
  try {
    const u = new URL(url);
    if (process.env.DB_POOL_MODE !== 'session' && u.hostname.endsWith('.pooler.supabase.com') && (u.port === '5432' || u.port === '')) {
      u.port = '6543';
      return u.toString();
    }
  } catch { /* URL inválida: o config já explica */ }
  return url;
}

export function createDb(url: string, max = 10, opts: { idleMs?: number } = {}) {
  const pool = new pg.Pool({ ...poolConfig(url, max), ...(opts.idleMs ? { idleTimeoutMillis: opts.idleMs } : {}) });
  // conexão derrubada pelo pooler não pode derrubar o processo
  pool.on('error', () => {});
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Transação no mesmo tipo do db (Drizzle) — usado pelos serviços. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;
