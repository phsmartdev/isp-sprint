/** Responsável comercial do contrato só entre quem tem acesso ao módulo Contratos (27/11/2026). Dados fictícios. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

it('troca de responsável comercial: aceita quem acessa Contratos, recusa quem não acessa; o atual pode ficar', async () => {
  // Rafael fica sem acesso a Contratos (bloqueio individual) durante o teste
  const rafael = await login(ctx.app, 'rafael@yepnet.test');
  const block = (await carlos.post('/admin/modules/contratos/grants', { subjectType: 'usuario', subjectId: rafael.me.user.id, effect: 'bloquear', reason: 'Teste: fora de Contratos' })).json();
  const { userIds } = (await carlos.get('/contracts/commercial-owners')).json() as { userIds: string[] };
  expect(userIds).not.toContain(rafael.me.user.id);
  const outside = { id: rafael.me.user.id };
  const c = (await carlos.get('/contracts?pageSize=50')).json().items.find((x: { stage: string }) => x.stage !== 'arquivado');
  const d = (await carlos.get(`/contracts/${c.id}`)).json();
  const bad = await carlos.put(`/contracts/${c.id}`, { commercialOwnerId: outside!.id });
  expect(bad.statusCode).toBe(422);
  expect(bad.json().detail).toContain('acesso ao módulo Contratos');
  expect((await carlos.put(`/contracts/${c.id}`, { commercialOwnerId: d.commercialOwnerId })).statusCode).toBe(200);
  const other = userIds.find((id) => id !== d.commercialOwnerId)!;
  expect((await carlos.put(`/contracts/${c.id}`, { commercialOwnerId: other })).statusCode).toBe(200);
  expect((await carlos.get(`/contracts/${c.id}`)).json().commercialOwnerId).toBe(other);
  await carlos.post(`/admin/module-grants/${block.id}/revoke`, { note: 'Fim do teste automatizado' });
});
