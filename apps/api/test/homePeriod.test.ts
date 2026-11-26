/** Início: o filtro de período vale para funil, indicadores e oportunidades recentes (situação no fim do período). */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

it('período no passado muda funil, indicadores e recentes; o mês atual segue mostrando a carteira aberta de agora', async () => {
  const now = ok(await carlos.get('/home')).json();
  const openNow = now.kpis.find((k: { key: string }) => k.key === 'abertas').value as number;
  const funnelNow = now.pipeline.reduce((n: number, s: { count: number }) => n + s.count, 0);
  expect(openNow).toBeGreaterThan(0);
  expect(funnelNow).toBe(openNow > 0 ? funnelNow : 0);
  // antes de existir qualquer oportunidade: tudo zero
  const old = ok(await carlos.get('/home?from=2020-01-01&to=2020-01-31')).json();
  expect(old.period).toEqual({ from: '2020-01-01', to: '2020-01-31' });
  expect(old.kpis.find((k: { key: string }) => k.key === 'abertas').value).toBe(0);
  expect(old.kpis.find((k: { key: string }) => k.key === 'valor').value).toBe(0);
  expect(old.pipeline.every((s: { count: number }) => s.count === 0)).toBe(true);
  expect(old.recent).toEqual([]);
});
