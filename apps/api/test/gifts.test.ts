/** Marketing → Brindes: itens, entrada com custo médio, kits com categoria, envio para conta/stakeholders, estoque, cancelamento, consumo e consolidado. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

describe('brindes', () => {
  it('estoque, kit, envio para a conta e stakeholders, consolidado e consumo', async () => {
    const sup = ok(await carlos.post('/brindes/fornecedores', { name: `Gráfica Fictícia ${stamp}` }), 201).json().id;
    const cat = ok(await carlos.post('/brindes/categorias', { name: `Executivo ${stamp}` }), 201).json().id;
    const cam = ok(await carlos.post('/brindes/itens', { name: `Camiseta ${stamp}`, supplierId: sup, unitCostCents: 3500, minStock: 2, initialStock: 10 }), 201).json().id;
    const cop = ok(await carlos.post('/brindes/itens', { name: `Copo ${stamp}`, unitCostCents: 1000, initialStock: 0 }), 201).json().id;
    // entrada: custo médio ponderado (estoque 0: vale o da compra)
    expect(ok(await carlos.post(`/brindes/itens/${cop}/movimento`, { kind: 'entrada', qty: 4, unitCostCents: 1200, supplierId: sup })).json()).toMatchObject({ stock: 4, unitCostCents: 1200 });
    expect(ok(await carlos.post(`/brindes/itens/${cam}/movimento`, { kind: 'entrada', qty: 10, unitCostCents: 4500 })).json()).toMatchObject({ stock: 20, unitCostCents: 4000 });
    const kit = ok(await carlos.post('/brindes/kits', { name: `Kit boas-vindas ${stamp}`, categoryId: cat, items: [{ itemId: cam, qty: 1 }, { itemId: cop, qty: 2 }] }), 201).json().id;
    const all = ok(await carlos.get('/brindes')).json();
    expect(all.kits.find((k: { id: string }) => k.id === kit)).toMatchObject({ costCents: 4000 + 2400, available: 2, categoryName: `Executivo ${stamp}` });
    expect(all.suppliers.find((x: { id: string }) => x.id === sup)).toMatchObject({ purchasedQty: 24 });

    const acc = ok(await carlos.post('/abm/new-account', { name: `Prefeitura Fictícia Brindes ${stamp}`, segment: 'governamental', reason: 'Teste de brindes' }), 201).json();
    const st = ok(await carlos.post(`/accounts/${acc.contactId}/stakeholders`, { person: { name: 'Maria Fictícia' }, title: 'Secretária' }), 201).json().id;
    // sem estoque para 3 kits
    expect(ok(await carlos.post('/brindes/envios', { contactId: acc.contactId, kitId: kit, kits: 3 }), 422).body).toMatch(/Estoque insuficiente: Copo/);
    const d = ok(await carlos.post('/brindes/envios', { contactId: acc.contactId, kitId: kit, kits: 2, extra: [{ itemId: cam, qty: 1 }], stakeholderIds: [st] }), 201).json();
    expect(d.totalCents).toBe(2 * 6400 + 4000);
    const items = ok(await carlos.get('/brindes')).json().items;
    expect(items.find((i: { id: string }) => i.id === cop)).toMatchObject({ stock: 0, low: true });

    const g = ok(await carlos.get(`/accounts/${acc.contactId}/brindes`)).json();
    expect(g.consolidated).toMatchObject({ totalCents: 16800, kits: 2, deliveries: 1 });
    expect(g.consolidated.byStakeholder[0]).toMatchObject({ name: 'Maria Fictícia', qty: 2 });
    expect(ok(await carlos.get(`/stakeholders/${st}/brindes`)).json().totalKits).toBe(2);
    const today = new Date().toISOString().slice(0, 10);
    const c = ok(await carlos.get(`/brindes/consumo?from=${today}&to=${today}`)).json();
    expect(c.byAccount.find((a: { contactId: string }) => a.contactId === acc.contactId)?.totalCents).toBe(16800);

    // cancelar devolve ao estoque e sai do consolidado (fica no histórico)
    ok(await carlos.post(`/brindes/envios/${d.id}/cancelar`, { reason: 'Evento adiado' }));
    expect(ok(await carlos.get(`/accounts/${acc.contactId}/brindes`)).json().consolidated.totalCents).toBe(0);
    expect(ok(await carlos.get('/brindes')).json().items.find((i: { id: string }) => i.id === cop).stock).toBe(4);
    ok(await carlos.post(`/brindes/envios/${d.id}/cancelar`, { reason: 'De novo' }), 404);
  });
});
