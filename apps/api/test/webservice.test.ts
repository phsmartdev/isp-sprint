/** Usuário de webservice: entra só por token (Bearer), com o acesso do perfil; token aparece uma vez e pode ser revogado. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const bearer = (token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, payload: payload as never });

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => ctx.close());

it('cria usuário de webservice, gera token e usa a API com o perfil dele', async () => {
  expect((await lucas.post('/admin/webservice', { name: 'Integração ERP', profile: 'operacao' })).statusCode).toBe(403);
  expect((await carlos.post('/admin/webservice', { name: 'Integração ERP', profile: 'administrador' })).statusCode).toBeGreaterThanOrEqual(400);
  const created = await carlos.post('/admin/webservice', { name: 'Integração ERP', profile: 'gerencia', description: 'ERP financeiro' });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id as string;

  const t = await carlos.post(`/admin/webservice/${id}/tokens`, { name: 'Produção', expiresInDays: 90 });
  expect(t.statusCode, t.body).toBe(201);
  const token = t.json().token as string;
  expect(token.startsWith('isk_')).toBe(true);

  // a lista nunca devolve o valor do token
  const list = (await carlos.get('/admin/webservice')).json();
  const ws = list.users.find((u: { id: string }) => u.id === id);
  expect(ws.profile).toBe('gerencia');
  expect(ws.tokens[0].last4).toBe(token.slice(-4));
  expect(JSON.stringify(list)).not.toContain(token);
  // não aparece entre as pessoas
  expect((await carlos.get('/admin/users')).json().users.some((u: { id: string }) => u.id === id)).toBe(false);

  // sem token / token errado
  expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
  expect((await bearer('isk_errado', 'GET', '/me')).statusCode).toBe(401);

  const me = await bearer(token, 'GET', '/me');
  expect(me.statusCode, me.body).toBe(200);
  expect(me.json().user.name).toBe('Integração ERP');

  // inserir e coletar dados
  const lead = await bearer(token, 'POST', '/leads', { name: 'Lead via API', phone: '79999990000', segment: 'empresarial' });
  expect(lead.statusCode, lead.body).toBe(201);
  const leads = await bearer(token, 'GET', '/leads?q=Lead%20via%20API');
  expect(leads.statusCode, leads.body).toBe(200);

  // configurações continuam fechadas (perfil sem administração) e login pela tela é recusado
  expect((await bearer(token, 'GET', '/admin/users')).statusCode).toBe(403);
  expect((await bearer(token, 'POST', '/auth/logout')).statusCode).toBe(403);
  expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: ws.email, password: 'qualquer-coisa-123' } })).statusCode).toBe(401);

  // revogar corta na hora; desativar o usuário também
  const tokenId = ws.tokens[0].id as string;
  expect((await carlos.post(`/admin/webservice/tokens/${tokenId}/revoke`)).statusCode).toBe(200);
  expect((await bearer(token, 'GET', '/me')).statusCode).toBe(401);
  const t2 = (await carlos.post(`/admin/webservice/${id}/tokens`, { name: 'Novo', expiresInDays: null })).json().token as string;
  expect((await bearer(t2, 'GET', '/me')).statusCode).toBe(200);
  expect((await carlos.patch(`/admin/webservice/${id}`, { active: false })).statusCode).toBe(200);
  expect((await bearer(t2, 'GET', '/me')).statusCode).toBe(401);
});
