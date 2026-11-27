/** Contrato validado: dados contratuais só por aditivo; campo vazio pode ser completado (ex.: data-base do reajuste). Dados fictícios. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

it('data-base vazia: preenche sem aditivo, alerta de reajuste passa a valer; depois de preenchida, trava', async () => {
  // contrato próprio do teste: oportunidade ganha → contrato → validado
  const shift = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  const lk = (await carlos.get('/meta/lookups')).json();
  const o = (await carlos.post('/opportunities', { newContact: { name: `Conta Trava Fictícia ${Date.now().toString(36)}`, segment: 'empresarial' }, planId: lk.plans[0].id })).json();
  const cur = (await carlos.get(`/opportunities/${o.id}`)).json();
  expect((await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: cur.rowVersion })).statusCode).toBe(200);
  const created = await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', kind: 'privado', legalRegime: 'privado', commercialOwnerId: carlos.me.user.id, version: { number: `TR-${Date.now().toString(36)}`, object: 'Link fictício de teste', signedAt: shift(-40), startAt: shift(-35), termMonths: 12, monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }], adjustmentIndex: 'IPCA' } });
  expect(created.statusCode, created.body).toBe(201);
  const c = { id: created.json().id as string };
  const val = await carlos.post(`/contracts/${c.id}/validate`);
  expect(val.statusCode, val.body).toBe(200);
  expect((await carlos.get(`/contracts/${c.id}`)).json().current.adjustmentBaseDate).toBeNull();

  const base = `${new Date().getFullYear() - 1}-${new Date(Date.now() + 10 * 86400000).toISOString().slice(5, 10)}`;
  const fill = await carlos.put(`/contracts/${c.id}`, { version: { adjustmentBaseDate: base }, reason: 'Data-base que faltou no cadastro' });
  expect(fill.statusCode).toBe(200);
  expect((await carlos.get(`/contracts/${c.id}`)).json().current.adjustmentBaseDate).toBe(base);

  const change = await carlos.put(`/contracts/${c.id}`, { version: { adjustmentBaseDate: '2020-01-01' }, reason: 'teste' });
  expect(change.statusCode).toBe(422);
  expect(change.json().detail).toContain('data-base do reajuste só muda por aditivo');

  // aniversário em 10 dias, dentro do prazo padrão de 30 dias: o monitoramento abre o alerta de reajuste
  await carlos.post('/contracts/alerts/run');
  const alerts = (await carlos.get(`/contracts/alerts?contractId=${c.id}`)).json().items as { kind: string }[];
  expect(alerts.some((a) => a.kind === 'reajuste')).toBe(true);
});
