/** Arte do login: hexágono (padrão) ou RevOps animado; leitura pública, troca só pela administração. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => {
  await carlos.put('/admin/branding/estilo-login', { style: 'hexagono' });
  await ctx.close();
});

it('é pública e só a administração troca', async () => {
  const pub = () => ctx.app.inject({ method: 'GET', url: '/api/v1/public/login-estilo' });
  expect(['hexagono', 'revops']).toContain((await pub()).json().style);
  expect((await lucas.put('/admin/branding/estilo-login', { style: 'revops' })).statusCode).toBe(403);
  expect((await carlos.put('/admin/branding/estilo-login', { style: 'neon' })).statusCode).toBeGreaterThanOrEqual(400);
  const ok = await carlos.put('/admin/branding/estilo-login', { style: 'revops' });
  expect(ok.statusCode, ok.body).toBe(200);
  expect((await carlos.get('/admin/branding')).json().loginStyle).toBe('revops');
  expect((await pub()).json().style).toBe('revops');
});
