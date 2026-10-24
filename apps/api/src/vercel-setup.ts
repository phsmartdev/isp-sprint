/**
 * Roda no build da Vercel: aplica as migrations no banco de DATABASE_URL e, se SEED_DEMO=true
 * e o banco ainda não tiver nenhuma empresa, cria a empresa fictícia de demonstração.
 * Nunca apaga dados.
 */
import pg from 'pg';
import { runMigrations } from './db/migrate';
import { seed, SEED_PASSWORD } from './db/seed';
import { poolConfig } from './db/client';
import { recoverAccess, RECOVER_MESSAGES } from './db/recover';
import { createDb } from './db/client';
import { loadKpiDemo, tenantsWithoutKpis } from './services/kpiDemo';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[setup] DATABASE_URL não definido: build segue sem preparar o banco. Configure a variável e faça novo deploy.');
    return;
  }
  // Deploys de prévia (branches) usam o mesmo banco da produção: não migram, para não quebrar a versão publicada.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && process.env.MIGRATE_ON_PREVIEW !== 'true') {
    console.log(`[setup] deploy de ${process.env.VERCEL_ENV}: migrations não aplicadas (só em produção).`);
    return;
  }
  console.log('[setup] aplicando migrations…');
  await runMigrations(url);
  console.log('[setup] migrations aplicadas.');
  await seedDemo(url);
  await kpiDemo(url);
  const re = process.env.ADMIN_RESET_EMAIL, rp = process.env.ADMIN_RESET_PASSWORD;
  if (re && rp) {
    const r = await recoverAccess(url, re, rp);
    console.log(`[setup] recuperação de acesso (${re.trim().toLowerCase()}): ${RECOVER_MESSAGES[r]}`);
  }
}

/** Indicadores principais da área: empresa sem nenhuma ficha de KPI recebe as fichas e resultados fictícios (marcados). KPI_DEMO=false desliga. */
async function kpiDemo(url: string) {
  if (process.env.KPI_DEMO === 'false') return;
  const { db, pool } = createDb(url);
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());
    for (const t of await tenantsWithoutKpis(db)) {
      const r = await loadKpiDemo(db, t, today);
      console.log(`[setup] indicadores principais na empresa ${t}: ${r.created} ficha(s), ${r.entries} resultado(s) de demonstração.`);
    }
  } finally { await pool.end(); }
}

async function seedDemo(url: string) {
  if (process.env.SEED_DEMO !== 'true') return;
  const pool = new pg.Pool(poolConfig(url, 1));
  const { rows } = await pool.query<{ n: number }>('select count(*)::int n from tenants');
  await pool.end();
  if (rows[0]!.n > 0) {
    console.log('[setup] banco já tem empresas; dados de demonstração não foram recriados.');
    return;
  }
  console.log('[setup] criando dados fictícios de demonstração…');
  await seed(url);
  console.log(`[setup] pronto. Usuários de demonstração com senha ${SEED_PASSWORD}.`);
}

main().catch((e) => {
  console.error('[setup] falhou:', e);
  process.exit(1);
});
