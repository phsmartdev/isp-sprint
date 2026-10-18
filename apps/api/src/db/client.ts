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
  return { connectionString: u.toString(), max, idleTimeoutMillis: 30_000, ssl: local ? undefined : { rejectUnauthorized: false } };
}

export function createDb(url: string, max = 10) {
  const pool = new pg.Pool(poolConfig(url, max));
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Transação no mesmo tipo do db (Drizzle) — usado pelos serviços. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;
