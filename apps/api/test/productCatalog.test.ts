/** Catálogo de produtos: o que é lançado (ou importado) numa negociação fica salvo para as próximas. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

describe('catálogo de produtos', () => {
  it('itens salvos na negociação entram no catálogo com o último valor; repetir soma o uso', async () => {
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const tag = Date.now().toString(36);
    const mk = async () => ok(await carlos.post('/opportunities', { newContact: { name: `Cliente Catálogo ${tag}${Math.random()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: lk.branches[0].id }), 201).json();
    const a = await mk();
    ok(await carlos.put(`/opportunities/${a.id}/items`, { rowVersion: a.rowVersion, items: [{ description: `Switch gerenciável ${tag}`, unit: 'un', qtyMilli: 2000, unitCents: 120_000, dealKind: 'venda' }] }));
    let c = ok(await carlos.get(`/product-catalog?q=${tag}`)).json().items;
    expect(c).toEqual([expect.objectContaining({ description: `Switch gerenciável ${tag}`, lastUnitCents: 120_000, dealKind: 'venda', timesUsed: 1 })]);
    const b = await mk();
    ok(await carlos.put(`/opportunities/${b.id}/items`, { rowVersion: b.rowVersion, items: [{ description: `SWITCH GERENCIÁVEL ${tag}`, unit: 'un', qtyMilli: 1000, unitCents: 110_000, dealKind: 'venda' }] }));
    c = ok(await carlos.get(`/product-catalog?q=${tag}`)).json().items;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ lastUnitCents: 110_000, timesUsed: 2 });
  });
});
