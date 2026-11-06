/** Licitação: resultado por item (nosso unitário final e o da vencedora) e o histórico de preços na Inteligência. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let lucas: Client, carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  lucas = await login(ctx.app, 'lucas@yepnet.test');
  carlos = await login(ctx.app, 'carlos@yepnet.test');
});
afterAll(async () => ctx.close());

async function newOpp(saleKind: string) {
  const lk = ok(await lucas.get('/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  return ok(await lucas.post('/opportunities', { newContact: { name: `Órgão Preço ${Date.now().toString(36)}`, segment: 'governamental' }, pipelineId: p.id, saleKind, branchId: lk.branches[0].id, ...(saleKind === 'licitacao' ? { custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800, orgao_contratante: 'Prefeitura Fictícia' } } : {}) }), 201).json();
}
const item = (description: string, bidUnitCents: number | null) => ({ description, unit: 'un', qtyMilli: 10_000, unitCents: 15_000, bidUnitCents });

describe('Resultado por item da licitação', () => {
  it('grava nosso final e a vencedora, mantém ao salvar itens, vale depois de encerrada e alimenta o histórico de preços', async () => {
    const o = await newOpp('licitacao');
    const it1 = ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [item('Link dedicado 100 Mbps', 12_000), item('Roteador gerenciado', 5_000)] })).json();
    const got = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    const [a, b] = got.items;
    // validação: vencedora sem empresa
    const bad = await lucas.put(`/opportunities/${o.id}/items/bid-results`, { rowVersion: got.rowVersion, items: [{ id: a.id, finalUnitCents: 11_000, winnerIsUs: false, winnerCompany: '', winnerUnitCents: 10_000 }] });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().detail).toMatch(/empresa vencedora/);
    // encerra a oportunidade: o resultado do pregão sai depois
    await ctx.app.db.execute(sql`update opportunities set stage = 'perdida' where id = ${o.id}`);
    const r = ok(await lucas.put(`/opportunities/${o.id}/items/bid-results`, { rowVersion: got.rowVersion, items: [
      { id: a.id, finalUnitCents: 11_000, winnerIsUs: false, winnerCompany: 'Rede Alfa Fictícia', winnerUnitCents: 10_000 },
      { id: b.id, finalUnitCents: 4_800, winnerIsUs: true, winnerCompany: null, winnerUnitCents: null },
    ] })).json();
    expect(r.items[0]).toMatchObject({ finalUnitCents: 11_000, winnerCompany: 'Rede Alfa Fictícia', winnerUnitCents: 10_000 });
    expect(r.items[1]).toMatchObject({ winnerIsUs: true, winnerCompany: null });
    expect((await lucas.put(`/opportunities/${o.id}/items/bid-results`, { rowVersion: got.rowVersion, items: [] })).statusCode).toBe(409);
    const tl = ok(await lucas.get(`/opportunities/${o.id}/timeline`)).json();
    expect(JSON.stringify(tl.items)).toMatch(/Link dedicado 100 Mbps: nosso 110\.00, vencedora Rede Alfa Fictícia 100\.00/);

    // histórico de preços (Inteligência)
    const h = ok(await carlos.get('/intelligence/bid-item-prices?q=alfa ficticia')).json();
    const row = h.items.find((x: { itemId: string }) => x.itemId === a.id);
    expect(row).toMatchObject({ opportunityId: o.id, orgao: 'Prefeitura Fictícia', bidUnitCents: 12_000, finalUnitCents: 11_000, winnerUnitCents: 10_000 });
    expect(row.gap).toBeCloseTo(0.1, 10);
    const mine = ok(await carlos.get('/intelligence/bid-item-prices?onlyResults=true')).json().items.filter((x: { opportunityId: string }) => x.opportunityId === o.id);
    expect(mine.map((x: { description: string; winnerIsUs: boolean; winnerUnitCents: number; gap: number }) => [x.description, x.winnerIsUs, x.winnerUnitCents, x.gap])).toEqual([['Link dedicado 100 Mbps', false, 10_000, row.gap], ['Roteador gerenciado', true, 4_800, 0]]);
    // sem acesso à Inteligência, não vê o histórico
    expect((await lucas.get('/intelligence/bid-item-prices')).statusCode).toBe(403);
    void it1;
  });
  it('re-salvar os itens mantém o resultado do item de mesma descrição', async () => {
    const o = await newOpp('licitacao');
    ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [item('Link dedicado 50 Mbps', 9_000)] }));
    const g = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    const r = ok(await lucas.put(`/opportunities/${o.id}/items/bid-results`, { rowVersion: g.rowVersion, items: [{ id: g.items[0].id, finalUnitCents: 8_500, winnerIsUs: false, winnerCompany: 'Rede Beta Fictícia', winnerUnitCents: 8_000 }] })).json();
    ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: r.rowVersion, items: [item('Link dedicado 50 Mbps', 9_100), item('Instalação', 1_000)] }));
    const g2 = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    expect(g2.items[0]).toMatchObject({ bidUnitCents: 9_100, finalUnitCents: 8_500, winnerCompany: 'Rede Beta Fictícia', winnerUnitCents: 8_000 });
    expect(g2.items[1]).toMatchObject({ finalUnitCents: null, winnerCompany: null });
  });
  it('só em licitação', async () => {
    const o = await newOpp('venda_consultiva');
    ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [item('Link', null)] }));
    const g = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    expect((await lucas.put(`/opportunities/${o.id}/items/bid-results`, { rowVersion: g.rowVersion, items: [{ id: g.items[0].id, finalUnitCents: 1, winnerIsUs: true, winnerUnitCents: null }] })).statusCode).toBe(422);
  });
});
