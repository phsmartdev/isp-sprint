/** Topo: "Apoiei" num pedido do time, comentário com @ num contrato vira pedido de apoio, "Limpar" do sino e das menções. Dados fictícios. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas, ana] = (await Promise.all(['carlos', 'lucas', 'ana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client]; });
afterAll(async () => ctx.close());

it('"Apoiei": sai da lista de quem apoiou e vai para quem pediu confirmar', async () => {
  const resid = (await ctx.app.db.execute<{ id: string }>(sql`select id from teams where name = 'Residencial' limit 1`)).rows[0]!.id;
  const r = (await lucas.post('/apoio', { title: `Conferir viabilidade fictícia ${Date.now()}`, teamId: resid })).json();
  let view = (await ana.get('/apoio')).json();
  const mine = view.toMe.find((x: { id: string }) => x.id === r.id);
  expect(mine.actions).toContain('apoiei');
  expect((await ana.post(`/apoio/${r.id}/apoiei`, { note: 'Conferido por telefone' })).statusCode).toBe(200);
  view = (await ana.get('/apoio')).json();
  expect(view.toMe.some((x: { id: string }) => x.id === r.id)).toBe(false);
  const req = (await lucas.get('/apoio')).json().mine.find((x: { id: string }) => x.id === r.id);
  expect(req.status).toBe('atendido');
  expect(req.helper.name).toBeTruthy();
  expect(req.actions).toContain('confirmar');
});

it('comentário com @ no contrato: cada pessoa mencionada recebe um pedido ligado ao contrato', async () => {
  const [k] = (await ctx.app.db.execute<{ id: string }>(sql`select k.id from contracts k join users u on u.tenant_id = k.tenant_id and u.email = 'carlos@yepnet.test' limit 1`)).rows;
  if (!k) return; // sem contrato na base de teste
  const anaId = ana.me.user.id, lucasId = lucas.me.user.id;
  expect((await carlos.post('/apoio/mencao', { entityType: 'contrato', entityId: k.id, text: 'Revisar a cláusula fictícia', userIds: [] })).statusCode).toBe(422);
  const r = await carlos.post('/apoio/mencao', { entityType: 'contrato', entityId: k.id, text: '@Ana e @Lucas podem revisar a cláusula fictícia de reajuste?', userIds: [anaId, lucasId] });
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().ids).toHaveLength(2);
  const list = (await carlos.get(`/apoio/item/contrato/${k.id}`)).json().items;
  expect(list.filter((x: { description: string }) => x.description.includes('cláusula fictícia de reajuste'))).toHaveLength(2);
  const anaFeed = (await ana.get('/apoio')).json();
  expect(anaFeed.toMe.some((x: { entity: { type: string; id: string } | null }) => x.entity?.type === 'contrato' && x.entity.id === k.id)).toBe(true);
  // aparece no sino de quem foi chamado
  const bell = (await ana.get('/me/mentions?scope=sino')).json();
  expect(bell.items.some((x: { source: string }) => x.source === 'apoio_pedido')).toBe(true);
});

it('"Limpar" do sino esvazia só o sino; menções continuam; o que chegar depois aparece', async () => {
  const before = (await ana.get('/me/mentions?scope=sino')).json();
  expect(before.items.length).toBeGreaterThan(0);
  expect((await ana.post('/me/notificacoes/limpar', { scope: 'sino' })).statusCode).toBe(200);
  expect((await ana.get('/me/mentions?scope=sino')).json().items).toHaveLength(0);
  expect((await ana.get('/me/mentions?scope=mencoes')).json().items.length).toBe(before.items.length);
  await new Promise((r) => setTimeout(r, 20));
  const resid = (await ctx.app.db.execute<{ id: string }>(sql`select id from teams where name = 'Residencial' limit 1`)).rows[0]!.id;
  await lucas.post('/apoio', { title: `Novo pedido fictício ${Date.now()}`, teamId: resid });
  const after = (await ana.get('/me/mentions?scope=sino')).json();
  expect(after.items.length).toBeGreaterThan(0);
  expect((await ana.post('/me/notificacoes/limpar', { scope: 'mencoes' })).statusCode).toBe(200);
  expect((await ana.get('/me/mentions?scope=mencoes')).json().items).toHaveLength(0);
});
