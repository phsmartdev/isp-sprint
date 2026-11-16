/** Fornecedor: editar, excluir só sem movimentação e ficha com histórico, frequência e custo médio. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

it('sem movimentação exclui; com movimentação mostra o histórico e não exclui', async () => {
  const free = ok(await carlos.post('/budget/suppliers', { name: `Fornecedor duplicado ${stamp}` }), 201).json();
  ok(await carlos.patch(`/budget/suppliers/${free.id}`, { advantages: 'Frete grátis acima de R$ 500' }));
  const card0 = ok(await carlos.get(`/budget/suppliers/${free.id}/historico`)).json();
  expect(card0.canDelete).toBe(true);
  expect(card0.supplier.advantages).toBe('Frete grátis acima de R$ 500');
  ok(await carlos.del(`/budget/suppliers/${free.id}`), 204);
  expect((await carlos.get(`/budget/suppliers/${free.id}/historico`)).statusCode).toBe(404);

  const sup = ok(await carlos.post('/budget/suppliers', { name: `Gráfica ${stamp}` }), 201).json();
  const item = ok(await carlos.post('/brindes/itens', { name: `Caneta ${stamp}`, unitCostCents: 300, initialStock: 0 }), 201).json().id;
  ok(await carlos.post(`/brindes/itens/${item}/movimento`, { kind: 'entrada', qty: 100, unitCostCents: 300, supplierId: sup.id }));
  ok(await carlos.post(`/brindes/itens/${item}/movimento`, { kind: 'entrada', qty: 100, unitCostCents: 400, supplierId: sup.id }));
  const card = ok(await carlos.get(`/budget/suppliers/${sup.id}/historico`)).json();
  expect(card.kpis.count).toBe(2);
  expect(card.kpis.totalCents).toBe(70_000);
  expect(card.items[0]).toMatchObject({ qty: 200, avgUnitCents: 350, lastUnitCents: 400 });
  expect(card.canDelete).toBe(false);
  const del = await carlos.del(`/budget/suppliers/${sup.id}`);
  expect(del.statusCode).toBe(422);
  expect(del.json().detail).toContain('movimentação');
});
