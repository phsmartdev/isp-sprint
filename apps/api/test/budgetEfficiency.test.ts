/** Fase 6: Eficiência orçamentária em Inteligência (custo × resultado, fontes e atribuição). */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const year = new Date().getFullYear();
const month = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());

it('eficiência: totais, série, centros e campanhas com fonte; operação sem acesso; período inválido recusado', async () => {
  expect((await lucas.get(`/intelligence/budget-efficiency?from=${month}&to=${month}`)).statusCode).toBe(403);
  expect((await carlos.get(`/intelligence/budget-efficiency?from=${month}&to=${year - 1}-01`)).statusCode).toBe(422);
  const r = ok(await carlos.get(`/intelligence/budget-efficiency?from=${year}-01&to=${month}`)).json();
  expect(r.series).toHaveLength(Number(month.slice(5)));
  expect(r.period.previous.to < `${year}-01`).toBe(true);
  expect(r.totals).toHaveProperty('invested');
  expect(r.totals.costPerSale === null || typeof r.totals.costPerSale === 'number').toBe(true);
  if (!r.totals.invested) expect(r.totals.efficiency).toBeNull(); // sem custo, eficiência não é inventada
  expect(r.sources.campanhas).toMatch(/não é atribuída/);
  for (const c of r.centers) expect(Array.isArray(c.situations)).toBe(true);
  expect(r.relationship.attribution).toBe('influenciada');
});
