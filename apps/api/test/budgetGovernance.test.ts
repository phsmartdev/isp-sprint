/** Demonstrativo da governança: responde para o ano, trimestre, mês e centro, com orçamento, brindes, patrocínios e atenção. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client]; });
afterAll(async () => ctx.close());

it('monta o demonstrativo por período e centro de custo', async () => {
  const y = new Date().getFullYear();
  const all = ok(await carlos.get(`/budget/governanca?year=${y}`)).json();
  expect(all.period.months).toHaveLength(12);
  for (const k of ['budget', 'approval', 'series', 'sectors', 'gifts', 'sponsorships', 'compliance', 'resources', 'suppliers', 'activity', 'attention']) expect(all).toHaveProperty(k);
  expect(all.series).toHaveLength(12);
  const q = ok(await carlos.get(`/budget/governanca?year=${y}&quarter=4`)).json();
  expect(q.period.months).toEqual([`${y}-10`, `${y}-11`, `${y}-12`]);
  const m = ok(await carlos.get(`/budget/governanca?year=${y}&month=11`)).json();
  expect(m.period.months).toEqual([`${y}-11`]);
  if (all.costCenters.length) {
    const cc = ok(await carlos.get(`/budget/governanca?year=${y}&costCenterId=${all.costCenters[0].id}`)).json();
    expect(cc.sectors.length).toBe(1);
  }
  expect((await lucas.get(`/budget/governanca?year=${y}`)).statusCode).toBeLessThan(500);
});
