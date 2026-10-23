/** Produtos e serviços da oportunidade: total vira valor, lance da licitação, histórico, venda fechada exige produtos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  lucas = await login(ctx.app, 'lucas@yepnet.test');
  rafael = await login(ctx.app, 'rafael@yepnet.test');
});
afterAll(async () => ctx.close());

async function newOpp(saleKind: string, custom: Record<string, unknown> = {}) {
  const lk = ok(await lucas.get('/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  // tipos de venda não são funis: tudo nasce no Corporativo, com o tipo no formulário
  expect(lk.pipelines.some((x: { key: string }) => ['licitacao', 'adesao_ata', 'consumo_contrato', 'venda_consultiva'].includes(x.key))).toBe(false);
  const fields = p.fields.filter((f: { required: boolean; saleKinds: string[] }) => f.required && f.saleKinds.includes(saleKind));
  const values = Object.fromEntries(fields.map((f: { key: string; type: string; options: string[] }) => [f.key, f.type === 'numero' || f.type === 'moeda' ? 1 : f.type === 'data' ? '2026-12-01' : f.type === 'lista' ? f.options[0] : f.type === 'sim_nao' ? true : 'Teste']));
  return ok(await lucas.post('/opportunities', { newContact: { name: `Conta Itens ${Date.now().toString(36)}`, segment: 'governamental' }, pipelineId: p.id, saleKind, branchId: lk.branches[0].id, custom: { ...values, ...custom } }), 201).json();
}

describe('Produtos e serviços da oportunidade', () => {
  it('total dos itens vira o valor; erros voltam com o item; histórico registra; sem itens volta ao plano', async () => {
    const o = await newOpp('venda_consultiva');
    expect(o.itemCount).toBe(0);
    const bad = await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link', unit: 'un', qtyMilli: 1000, unitCents: 100, discountCents: 500 }] });
    expect(bad.json().detail).toMatch(/Item 1: O desconto/);
    const saved = ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [
      { description: 'Link dedicado 200 Mb', unit: 'un', qtyMilli: 2000, unitCents: 150000, discountCents: 10000, surchargeCents: 0, notes: 'Sede' },
      { description: 'Lançamento de fibra', unit: 'km', qtyMilli: 1500, unitCents: 320000 },
    ] })).json();
    expect(saved).toMatchObject({ itemCount: 2, valueCents: 290000 + 480000 });
    const items = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    expect(items.totals).toMatchObject({ count: 2, discount: 10000, total: 770000 });
    expect(items.bid).toBe(false);
    // versão antiga: conflito, não sobrescreve
    expect((await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [] })).statusCode).toBe(409);
    const tl = ok(await lucas.get(`/opportunities/${o.id}/timeline`)).json();
    expect(JSON.stringify(tl.items)).toMatch(/2 item\(ns\)/);
    expect((await rafael.get(`/opportunities/${o.id}/items`)).statusCode).toBe(404);
  });

  it('licitação: lance por item ou global; venda fechada exige produtos lançados', async () => {
    const o = await newOpp('licitacao');
    expect(o.saleKind).toBe('licitacao');
    const lk = ok(await lucas.get('/meta/lookups')).json();
    const won = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial').stages.find((st: { kind: string }) => st.kind === 'won');
    // sem produtos, não fecha (as jornadas novas não exigem plano, então o bloqueio vem da exigência configurada na etapa, se houver)
    let cur = ok(await lucas.get(`/opportunities/${o.id}`)).json();
    let r = ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: cur.rowVersion, bidMode: 'item', items: [{ description: 'Link 100 Mb', unit: 'un', qtyMilli: 3000, unitCents: 100000, bidUnitCents: 90000 }] })).json();
    expect(r).toMatchObject({ bidMode: 'item', bidGlobalCents: null });
    let items = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    expect(items).toMatchObject({ bid: true, totals: { total: 300000, bidTotal: 270000 } });
    r = ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: r.rowVersion, bidMode: 'global', bidGlobalCents: 250000, items: items.items.map(({ description, unit, qtyMilli, unitCents, discountCents, surchargeCents, notes, bidUnitCents }: Record<string, unknown>) => ({ description, unit, qtyMilli, unitCents, discountCents, surchargeCents, notes, bidUnitCents })) })).json();
    expect(r).toMatchObject({ bidMode: 'global', bidGlobalCents: 250000 });
    cur = ok(await lucas.get(`/opportunities/${o.id}`)).json();
    ok(await lucas.post(`/opportunities/${o.id}/transition`, { toStage: won.key, rowVersion: cur.rowVersion, confirm: true }));
    items = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    expect(items.editable).toBe(false);
  });

  it('jornada que exige plano: sem produtos não fecha; com produtos fecha', async () => {
    const lk = ok(await lucas.get('/meta/lookups')).json();
    const corp = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
    const o = ok(await lucas.post('/opportunities', { newContact: { name: `Empresa Itens ${Date.now().toString(36)}`, segment: 'empresarial' }, pipelineId: corp.id }), 201).json();
    const won = corp.stages.find((st: { kind: string }) => st.kind === 'won');
    const blocked = await lucas.post(`/opportunities/${o.id}/transition`, { toStage: won.key, rowVersion: o.rowVersion, confirm: true });
    expect(blocked.statusCode).toBe(422);
    expect(JSON.stringify(blocked.json())).toMatch(/Lance os produtos e serviços/);
    const r = ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link 300 Mb', unit: 'un', qtyMilli: 1000, unitCents: 99900 }] })).json();
    ok(await lucas.post(`/opportunities/${o.id}/transition`, { toStage: won.key, rowVersion: r.rowVersion, confirm: true }));
  });
});
