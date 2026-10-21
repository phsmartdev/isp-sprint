/** Limpeza da base: roda por último (apaga os dados da empresa de teste). */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, ana] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'ana@yepnet.test')]); });
afterAll(async () => ctx.close());

it('limpar base: só gerência, com senha e frase; histórico de auditoria continua protegido', async () => {
  expect((await ana.post('/admin/clear-base', { password: 'Sprint@2026', confirm: 'LIMPAR BASE', scopes: ['clientes'] })).statusCode).toBe(403);
  expect((await carlos.post('/admin/clear-base', { password: 'errada', confirm: 'LIMPAR BASE', scopes: ['clientes'] })).statusCode).toBe(422);
  expect((await carlos.post('/admin/clear-base', { password: 'Sprint@2026', confirm: 'limpar', scopes: ['clientes'] })).statusCode).toBe(422);
  const r = await carlos.post('/admin/clear-base', { password: 'Sprint@2026', confirm: 'LIMPAR BASE', scopes: ['clientes', 'comercial'] });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().counts.clientes).toBeGreaterThan(0);
  expect(r.json().counts.oportunidades).toBeGreaterThan(0);
  expect((await carlos.get('/opportunities?status=todas')).json().items).toHaveLength(0);
  // fora da limpeza autorizada, o histórico segue append-only
  await expect(ctx.db.execute(sql`delete from opportunity_events`)).rejects.toThrow(/append-only/);
  await expect(ctx.db.execute(sql`delete from audit_logs`)).rejects.toThrow(/append-only/);
  // a outra empresa não foi tocada
  const [{ n } = { n: 0 }] = (await ctx.db.execute<{ n: number }>(sql`select count(*)::int n from customers c join tenants t on t.id = c.tenant_id where t.slug = 'outro'`)).rows as { n: number }[];
  expect(n).toBeGreaterThan(0);
});
