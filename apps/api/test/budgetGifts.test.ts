/** Fase 5: brindes ligados ao orçamento (um controle só), destinação e investimento em relacionamento. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, dir: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const year = new Date().getFullYear();
const month = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const stamp = Date.now().toString(36);

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  const email = `dir-gift-${stamp}@yepnet.test`;
  const u = ok(await carlos.post('/admin/users', { name: 'Diretor Fictício', email, profile: 'diretoria', teamIds: [] }), 201).json();
  dir = await login(ctx.app, email, u.temporaryPassword);
  ok(await carlos.post('/budget/setup'));
});
afterAll(async () => ctx.close());

it('brinde planejado vira lançamento; restrição, economia, nova autorização e estoque sem despesa duplicada', async () => {
  const st = ok(await carlos.get('/budget/structure')).json();
  const acc = st.accounts.find((a: { code: string }) => a.code === '3.1.03').id;
  const cc = ok(await carlos.post('/budget/cost-centers', { code: `BR${stamp.slice(-4)}`, name: 'Brindes fictício', leaderId: carlos.me.user.id }), 201).json().id;
  const item = ok(await carlos.post('/brindes/itens', { name: `Squeeze ${stamp}`, unitCostCents: 2500, initialStock: 0 }), 201).json().id;
  const camp = ok(await carlos.post('/campaigns', { name: `Campanha fictícia ${stamp}` }), 201).json().id;
  // 1.000 × R$ 25 = R$ 25.000 no orçamento
  const p = ok(await carlos.post('/brindes/planos', { itemId: item, costCenterId: cc, accountId: acc, qty: 1000, unitCostCents: 25_00, month, campaignId: camp, destination: 'Contas ABM do evento', justification: 'Ação de fim de ano' }), 201).json().items[0];
  expect(p.amountCents).toBe(25_000_00);
  const central = ok(await carlos.get(`/budget/central?year=${year}&costCenterId=${cc}`)).json();
  expect(central.rows.find((r: { id: string }) => r.id === p.id)).toMatchObject({ planned: 25_000_00 });
  ok(await carlos.post(`/budget/lines/${p.id}/submit`, {}));
  // diretoria aprova só R$ 20.000: a restrição aparece no planejamento de brindes
  expect(ok(await dir.post('/budget/decisions', { items: [{ lineId: p.id, decision: 'aprovar_parcial', approvedCents: 20_000_00, note: 'Reduzir o volume' }] })).json().decided).toHaveLength(1);
  let plan = ok(await carlos.get(`/brindes/planos?year=${year}`)).json().plans.find((x: { lineId: string }) => x.lineId === p.id);
  expect(plan).toMatchObject({ restricted: true, plannedQty: '1000', figures: { approved: 20_000_00 } });
  // fornecedor cobra R$ 23: 1.000 × 23 = 23.000 passa do aprovado → nova autorização
  expect(ok(await carlos.post(`/brindes/planos/${p.id}/compra`, { qty: 1000, unitCostCents: 23_00 }), 422).json().detail).toMatch(/Budget Guardião/);
  // 800 × 23 = 18.400: cabe, e a economia fica registrada
  expect(ok(await carlos.post(`/brindes/planos/${p.id}/compra`, { qty: 800, unitCostCents: 23_00, poNumber: 'PC-77' })).json()).toMatchObject({ contractedCents: 18_400_00, economyCents: 1_600_00 });
  ok(await carlos.post(`/brindes/planos/${p.id}/recebimento`, { qty: 500 }));
  expect(ok(await carlos.post(`/brindes/planos/${p.id}/recebimento`, { qty: 400 }), 422).json().detail).toMatch(/acima do comprado/);
  ok(await carlos.post(`/brindes/planos/${p.id}/recebimento`, { qty: 300 }));
  plan = ok(await carlos.get(`/brindes/planos?year=${year}`)).json().plans.find((x: { lineId: string }) => x.lineId === p.id);
  expect(plan).toMatchObject({ receivedQty: 800, stock: 800, executionState: 'executado', figures: { committed: 18_400_00, realized: 0 } });
  // receber não cria gasto: a despesa continua sendo só a do lançamento
  const line = ok(await carlos.get(`/budget/lines/${p.id}`)).json();
  expect(line.expenses).toHaveLength(0);
  // distribuição baixa o estoque e conta como investimento na campanha, sem nova despesa
  ok(await carlos.post('/brindes/envios', { purpose: 'campanha', campaignId: camp, extra: [{ itemId: item, qty: 50 }] }), 201);
  expect((await carlos.post('/brindes/envios', { purpose: 'relacionamento', extra: [{ itemId: item, qty: 1 }] })).statusCode).toBe(422);
  const today = new Date().toISOString().slice(0, 10);
  const cons = ok(await carlos.get(`/brindes/consumo?from=${year}-01-01&to=${today > `${year}-12-31` ? today : `${year}-12-31`}`)).json();
  expect(cons.byCampaign.find((c: { campaignId: string }) => c.campaignId === camp)).toMatchObject({ deliveries: 1 });
  expect(cons.byPurpose.find((c: { key: string }) => c.key === 'campanha').deliveries).toBeGreaterThan(0);
  expect(ok(await carlos.get(`/budget/lines/${p.id}`)).json().expenses).toHaveLength(0);
  // orçamento ligado à campanha
  const linked = ok(await carlos.get(`/budget/linked?campaignId=${camp}`)).json();
  expect(linked.totals).toMatchObject({ planned: 25_000_00, approved: 20_000_00, committed: 18_400_00 });
});
