/** Limpeza da base: roda por último (apaga os dados da empresa de teste). */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, ana] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'ana@yepnet.test')]); });
afterAll(async () => ctx.close());
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

it('limpar base: só gerência, com senha e frase; histórico de auditoria continua protegido', async () => {
  expect((await ana.post('/admin/clear-base', { password: 'Sprint@2026', confirm: 'LIMPAR BASE', scopes: ['clientes'] })).statusCode).toBe(403);
  expect((await carlos.post('/admin/clear-base', { password: 'errada', confirm: 'LIMPAR BASE', scopes: ['clientes'] })).statusCode).toBe(422);
  expect((await carlos.post('/admin/clear-base', { password: 'Sprint@2026', confirm: 'limpar', scopes: ['clientes'] })).statusCode).toBe(422);
  // fica só o contrato escolhido (com a oportunidade, o cliente e as atividades dele); o resto sai
  const ctr = (await ctx.db.execute<{ id: string; opportunity_id: string | null; contact_id: string }>(sql`select k.id, k.opportunity_id, k.contact_id from contracts k join users u on u.tenant_id = k.tenant_id where u.email = 'carlos@yepnet.test' and k.opportunity_id is not null order by k.created_at limit 1`)).rows[0]!;
  expect((await carlos.post('/admin/clear-base', { password: 'Sprint@2026', confirm: 'LIMPAR BASE', scopes: ['comercial'], keep: { contractIds: ['00000000-0000-4000-8000-000000000000'] } })).statusCode).toBe(422);
  const r = await carlos.post('/admin/clear-base', { password: 'Sprint@2026', confirm: 'LIMPAR BASE', scopes: ['clientes', 'comercial'], keep: { contractIds: [ctr.id] } });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().counts.clientes).toBeGreaterThan(0);
  expect(r.json().counts.oportunidades).toBeGreaterThan(0);
  const left = (await carlos.get('/opportunities?status=todas')).json().items as { id: string }[];
  expect(left.map((o) => o.id)).toEqual([ctr.opportunity_id]);
  const ctrs = (await carlos.get('/contracts?pageSize=50')).json().items as { id: string }[];
  expect(ctrs.map((c) => c.id)).toEqual([ctr.id]);
  ok(await carlos.get(`/contracts/${ctr.id}`));
  // fora da limpeza autorizada, o histórico segue append-only
  await expect(ctx.db.execute(sql`delete from opportunity_events`)).rejects.toThrow(/append-only/);
  await expect(ctx.db.execute(sql`delete from audit_logs`)).rejects.toThrow(/append-only/);
  // a outra empresa não foi tocada
  const [{ n } = { n: 0 }] = (await ctx.db.execute<{ n: number }>(sql`select count(*)::int n from customers c join tenants t on t.id = c.tenant_id where t.slug = 'outro'`)).rows as { n: number }[];
  expect(n).toBeGreaterThan(0);
});
