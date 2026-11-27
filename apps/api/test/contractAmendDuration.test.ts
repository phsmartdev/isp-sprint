/** Aditivo: prazo somado (meses/dias) e reajuste por item; o valor vendido na oportunidade não muda. Dados fictícios. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { addDays, addMonths } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

it('prazo +12 meses soma ao término; reajuste só no item escolhido; oportunidade intacta', async () => {
  const list = (await carlos.get('/contracts?pageSize=100')).json().items as { id: string; stage: string }[];
  let c: { id: string; opportunityId: string | null; current: { endAt: string; termMonths: number | null; items: { description: string; unitCents: number }[] } } | null = null;
  for (const x of list.filter((y) => ['vigente', 'implantacao'].includes(y.stage))) {
    const d = (await carlos.get(`/contracts/${x.id}`)).json();
    if (d.current.endAt && d.current.items.length >= 1 && !d.legalLimitAt) { c = d; break; }
  }
  expect(c, 'precisa de um contrato validado com término e itens').toBeTruthy();
  const opp = c!.opportunityId ? (await carlos.get(`/opportunities/${c!.opportunityId}`)).json() : null;

  const r = await carlos.post(`/contracts/${c!.id}/amendments`, { number: `AD-T-${Date.now() % 100000}`, signedOn: new Date().toISOString().slice(0, 10), description: 'Aditivo fictício: prorrogação e reajuste de um item', purposes: { prazo: { months: 12 }, reajuste: { items: [{ index: 0, pct: 10 }] } } });
  expect(r.statusCode, r.body).toBe(201);
  const after = (await carlos.get(`/contracts/${c!.id}`)).json();
  expect(after.current.endAt).toBe(addDays(addMonths(addDays(c!.current.endAt, 1), 12), -1));
  if (c!.current.termMonths) expect(after.current.termMonths).toBe(c!.current.termMonths + 12);
  expect(after.current.items[0].unitCents).toBe(Math.round(c!.current.items[0]!.unitCents * 1.1));
  for (let i = 1; i < c!.current.items.length; i++) expect(after.current.items[i].unitCents).toBe(c!.current.items[i]!.unitCents);

  const am = (await carlos.get(`/contracts/${c!.id}/amendments`)).json();
  const prazo = am.items.find((a: { kind: string; extendMonths: number | null }) => a.kind === 'prazo' && a.extendMonths === 12);
  expect(prazo).toBeTruthy();
  expect(am.items.some((a: { kind: string; itemAdjustments: unknown[] | null }) => a.kind === 'reajuste' && a.itemAdjustments?.length === 1)).toBe(true);
  expect(am.soldItems.length).toBeGreaterThan(0);

  if (opp) {
    const opp2 = (await carlos.get(`/opportunities/${c!.opportunityId}`)).json();
    expect(opp2.valueCents ?? opp2.opportunity?.valueCents).toBe(opp.valueCents ?? opp.opportunity?.valueCents);
  }

  // sem nada informado no prazo, recusa
  const bad = await carlos.post(`/contracts/${c!.id}/amendments`, { number: 'AD-T-X', signedOn: new Date().toISOString().slice(0, 10), description: 'Aditivo fictício sem prazo', purposes: { prazo: {} } });
  expect(bad.statusCode).toBe(422);
});
