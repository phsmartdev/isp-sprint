import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import path from 'node:path';
import os from 'node:os';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { TEST_DB } from './helpers';

describe('atualização de banco da produção para a viabilidade integrada', () => {
  it('aplica 0179 após as migrations atuais, preserva preços existentes e pode rodar novamente', async () => {
    const url = new URL(TEST_DB);
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) throw Error('Teste permitido somente em PostgreSQL local');
    url.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: url.href }); await admin.connect();
    const database = 'isp_upgrade_' + Date.now();
    const folder = mkdtempSync(path.join(os.tmpdir(), 'isp-pre-viability-'));
    let pool: pg.Pool | undefined;
    try {
      await admin.query('CREATE DATABASE ' + database); url.pathname = '/' + database;
      const original = path.resolve('migrations');
      const journal = JSON.parse(readFileSync(path.join(original, 'meta/_journal.json'), 'utf8'));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 178);
      mkdirSync(path.join(folder, 'meta')); writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries) copyFileSync(path.join(original, entry.tag + '.sql'), path.join(folder, entry.tag + '.sql'));
      const connection = createDb(url.href); pool = connection.pool;
      await migrate(connection.db, { migrationsFolder: folder });
      const tenant = (await pool.query("INSERT INTO tenants(name,slug) VALUES ('Migração de teste','migration-only') RETURNING id")).rows[0];
      const product = (await pool.query("INSERT INTO product_catalog(tenant_id,description,last_unit_cents,deal_kind) VALUES ($1,'Produto existente',154432,'recorrencia') RETURNING id", [tenant.id])).rows[0];
      const noValue = (await pool.query("INSERT INTO product_catalog(tenant_id,description,last_unit_cents,deal_kind) VALUES ($1,'Produto sem valor',0,'recorrencia') RETURNING id", [tenant.id])).rows[0];
      const before = Number((await pool.query('SELECT count(*) n FROM drizzle.__drizzle_migrations')).rows[0].n);
      await runMigrations(url.href);
      const row = (await pool.query('SELECT description,last_unit_cents,last_price_defined FROM product_catalog WHERE id=$1', [product.id])).rows[0];
      expect(row.description).toBe('Produto existente'); expect(Number(row.last_unit_cents)).toBe(154432); expect(row.last_price_defined).toBe(true);
      expect((await pool.query('SELECT last_price_defined FROM product_catalog WHERE id=$1', [noValue.id])).rows[0].last_price_defined).toBe(false);
      const column = (await pool.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_name='opportunity_items' AND column_name='price_defined'")).rows[0];
      expect(column).toMatchObject({ is_nullable: 'NO', column_default: 'true' });
      const after = Number((await pool.query('SELECT count(*) n FROM drizzle.__drizzle_migrations')).rows[0].n);
      // aplica a 0179 e as migrations que vieram depois dela
      const total = JSON.parse(readFileSync(path.join(original, 'meta/_journal.json'), 'utf8')).entries.length;
      expect(after).toBe(total);
      expect(after).toBeGreaterThan(before);
      await pool.query('UPDATE product_catalog SET last_price_defined=true WHERE id=$1', [noValue.id]);
      await runMigrations(url.href);
      expect((await pool.query('SELECT last_price_defined FROM product_catalog WHERE id=$1', [noValue.id])).rows[0].last_price_defined).toBe(true);
      expect(Number((await pool.query('SELECT count(*) n FROM drizzle.__drizzle_migrations')).rows[0].n)).toBe(after);
    } finally {
      if (pool) await pool.end();
      if (/^isp_upgrade_[0-9]+$/.test(database)) await admin.query('DROP DATABASE IF EXISTS ' + database + ' WITH (FORCE)');
      await admin.end();
      const target = path.resolve(folder), temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
      if (!target.startsWith(temporaryRoot) || !path.basename(target).startsWith('isp-pre-viability-')) throw Error('Pasta temporária inválida');
      rmSync(target, { recursive: true, force: true });
    }
  }, 60000);
});
