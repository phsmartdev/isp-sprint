/** Produtos do contrato vindos da oportunidade: itens lançados (com desconto, cobrança mensal/única) no lugar do plano. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

describe('produtos do contrato a partir da oportunidade', () => {
  it('pré-preenchimento e "trazer da oportunidade" usam os itens lançados, com a cobrança de cada um', async () => {
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Cliente Itens ${Date.now().toString(36)}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: lk.branches[0].id }), 201).json();
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [
      { description: 'Link dedicado 500 Mbps', unit: 'un', qtyMilli: 2000, unitCents: 150_000, dealKind: 'recorrencia' },
      { description: 'Instalação', unit: 'un', qtyMilli: 1000, unitCents: 200_000, discountCents: 50_000, dealKind: 'servico' },
    ] }));
    const pre = ok(await carlos.get(`/contracts/prefill?opportunityId=${o.id}`)).json();
    expect(pre.suggestion.version.items).toEqual([
      { planId: null, description: 'Link dedicado 500 Mbps', qty: 2, unitCents: 150_000, recurring: true },
      { planId: null, description: 'Instalação', qty: 1, unitCents: 150_000, recurring: false },
    ]);
    expect(pre.suggestion.version.monthlyCents).toBe(300_000);
    const src = ok(await carlos.get(`/contracts/item-sources?contactId=${o.contactId}`)).json();
    expect(src.items).toHaveLength(1);
    expect(src.items[0]).toMatchObject({ id: o.id, code: o.code });
    expect(src.items[0].items).toHaveLength(2);
  });
});
