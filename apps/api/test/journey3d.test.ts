/** Jornada 3D: leitura consolidada da conta (etapa no funil de CS, marcos de todas as jornadas, oportunidades); nada é gravado. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const today = new Date().toISOString().slice(0, 10);
let contactId: string, journeyId: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name: `Conta Fictícia 3D ${Date.now().toString(36)}`, segment: 'empresarial' }, planId: plan.id, cableMeters: 50, saleType: 'ativa' }), 201).json();
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
  contactId = (await carlos.get(`/opportunities/${o.id}`)).json().contactId;
  const contractId = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { number: `J3-${Date.now().toString(36)}`, object: 'Conectividade fictícia', signedAt: today, startAt: today, termMonths: 12, monthlyCents: 500_000, items: [{ planId: null, description: 'Link 500 Mbps', qty: 1, unitCents: 500_000 }] } }), 201).json().id;
  ok(await carlos.post(`/contracts/${contractId}/validate`));
  const r = await carlos.post('/cs/journeys', { contractId });
  expect([200, 201], r.body).toContain(r.statusCode);
  journeyId = r.json().journeyId ?? r.json().id ?? (await carlos.get(`/cs/journeys?contractId=${contractId}`)).json().items[0].id;
});
afterAll(async () => ctx.close());

it('jornada 3D consolida marcos e etapa da conta sem alterar nada', async () => {
  const j = ok(await carlos.get(`/cs/journeys/${journeyId}`)).json();
  const first = j.milestones[0];
  ok(await carlos.patch(`/cs/milestones/${first.id}`, { done: true, notes: 'Registro de teste' }));
  const before = ok(await carlos.get(`/cs/journeys/${journeyId}`)).json();
  const v = ok(await carlos.get(`/cs/accounts/${contactId}/jornada-3d`)).json();
  expect(v.journeys.length).toBeGreaterThanOrEqual(1);
  expect(v.milestones.length).toBe(j.milestones.length);
  expect(v.milestones.find((m: { id: string }) => m.id === first.id).doneAt).toBeTruthy();
  expect(Array.isArray(v.stages) && Array.isArray(v.stageEvents) && Array.isArray(v.opportunities)).toBe(true);
  // somente leitura: os marcos continuam iguais depois da consulta
  const after = ok(await carlos.get(`/cs/journeys/${journeyId}`)).json();
  expect(after.milestones.map((m: { doneAt: string | null }) => m.doneAt)).toEqual(before.milestones.map((m: { doneAt: string | null }) => m.doneAt));
  // conta inexistente
  expect((await carlos.get('/cs/accounts/00000000-0000-4000-8000-000000000000/jornada-3d')).statusCode).toBe(404);
});
