/** Contas da empresa (26/11/2026): leitura compartilhada, edição/exclusão pelo nível de acesso. Dados fictícios. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client]; });
afterAll(async () => ctx.close());

it('conta criada por um consultor é lida por outro, que pode abrir oportunidade nela, mas não editar', async () => {
  const c = (await lucas.post('/contacts', { name: 'Prefeitura Fictícia de Teste', phone: '79 98888-2222', segment: 'residencial' })).json();
  expect(c.id).toBeTruthy();
  expect((await rafael.get(`/contacts/${c.id}`)).statusCode).toBe(200);
  expect((await rafael.patch(`/contacts/${c.id}`, { name: 'Outro nome' })).statusCode).not.toBe(200);

  const ed = await lucas.patch(`/contacts/${c.id}`, { email: 'contato@prefeitura.example', segment: 'governamental', nature: 'publica' });
  expect(ed.statusCode).toBe(200);
  const got = (await carlos.get(`/contacts/${c.id}`)).json();
  expect(got).toMatchObject({ email: 'contato@prefeitura.example', segment: 'governamental', nature: 'publica' });
  expect((await lucas.patch(`/contacts/${c.id}`, { email: '' })).json().email).toBeNull();

  const plan = (await rafael.get('/meta/lookups')).json().plans[0];
  expect((await rafael.post('/opportunities', { contactId: c.id, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false })).statusCode).toBe(201);

  const del = await lucas.del(`/contacts/${c.id}`);
  expect(del.statusCode).toBe(422);
  expect(JSON.stringify(del.json())).toMatch(/oportunidade/i);
});

it('conta sem vínculos: só o dono (no nível próprio) exclui; depois some da lista e não aceita oportunidade', async () => {
  const c = (await lucas.post('/contacts', { name: 'Conta Descartável Fictícia', phone: '79 98888-3333', segment: 'residencial' })).json();
  expect((await rafael.del(`/contacts/${c.id}`)).statusCode).not.toBe(200);
  expect((await lucas.del(`/contacts/${c.id}`)).statusCode).toBe(200);
  expect((await lucas.get(`/contacts/${c.id}`)).statusCode).toBe(404);
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  const op = await lucas.post('/opportunities', { contactId: c.id, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false });
  expect(op.statusCode).toBe(422);
  expect(JSON.stringify(op.json())).toMatch(/Conta não encontrada/);
});
