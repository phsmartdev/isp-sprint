/** Licitação com objeto longo e vários endereços de entrega ligados aos produtos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  lucas = await login(ctx.app, 'lucas@yepnet.test');
});
afterAll(async () => ctx.close());

async function base() {
  const lk = ok(await lucas.get('/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  return { newContact: { name: `Prefeitura ${Date.now().toString(36)}`, segment: 'governamental' }, pipelineId: p.id, saleKind: 'licitacao', branchId: lk.branches[0].id, custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800 } };
}

describe('Licitação: abertura', () => {
  it('aceita objeto longo do edital, título longo e CEP com ponto', async () => {
    const b = await base();
    const objeto = 'Contratação de serviço de link dedicado. '.repeat(200); // ~8 mil caracteres
    const o = ok(await lucas.post('/opportunities', { ...b, title: 'Pregão eletrônico — '.repeat(12), installCep: '49.000-000', custom: { ...b.custom, objeto } }), 201).json();
    expect(o.custom.objeto).toBe(objeto);
    expect(o.installCep).toBe('49000-000');
  });
});

describe('Endereços de entrega', () => {
  it('vários endereços na abertura, editáveis depois e ligados a cada produto', async () => {
    const b = await base();
    const o = ok(await lucas.post('/opportunities', { ...b, installStreet: 'Rua Principal', installCity: 'Aracaju', deliveryAddresses: [{ label: 'Escola A', street: 'Rua A', number: '1', city: 'Aracaju' }, { label: 'Posto B', street: 'Rua B', city: 'Itabaiana' }, { label: '', street: '' }] }), 201).json();
    let d = ok(await lucas.get(`/opportunities/${o.id}/delivery-addresses`)).json();
    expect(d.principal.street).toBe('Rua Principal');
    expect(d.items.map((a: { label: string }) => a.label)).toEqual(['Escola A', 'Posto B']);
    const [a, bb] = d.items;

    // produtos apontam o endereço; endereço de outra oportunidade é recusado
    let items = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    expect(items.deliveryAddresses).toHaveLength(2);
    const item = (desc: string, deliveryAddressId: string | null) => ({ description: desc, unit: 'un', qtyMilli: 1000, unitCents: 1000, deliveryAddressId });
    const saved = ok(await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: items.rowVersion, items: [item('Roteador', a.id), item('Switch', bb.id), item('Link', null)] })).json();
    items = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    expect(items.items.map((i: { deliveryAddressId: string | null }) => i.deliveryAddressId)).toEqual([a.id, bb.id, null]);
    const other = ok(await lucas.post('/opportunities', { ...(await base()), deliveryAddresses: [{ street: 'Rua X' }] }), 201).json();
    const otherAddr = ok(await lucas.get(`/opportunities/${other.id}/delivery-addresses`)).json().items[0];
    expect((await lucas.put(`/opportunities/${o.id}/items`, { rowVersion: saved.rowVersion, items: [item('Roteador', otherAddr.id)] })).statusCode).toBe(422);

    // edita: muda o principal, renomeia A, tira B e inclui C; o produto de B volta ao principal
    d = ok(await lucas.put(`/opportunities/${o.id}/delivery-addresses`, { rowVersion: saved.rowVersion, principal: { street: 'Av. Nova', city: 'Aracaju', cep: '49000000' }, items: [{ id: a.id, label: 'Escola A (sede)', street: 'Rua A' }, { label: 'Unidade C', city: 'Lagarto' }] })).json();
    expect(d.opportunity.installStreet).toBe('Av. Nova');
    expect(d.opportunity.installCep).toBe('49000-000');
    expect(d.items.map((x: { label: string }) => x.label)).toEqual(['Escola A (sede)', 'Unidade C']);
    items = ok(await lucas.get(`/opportunities/${o.id}/items`)).json();
    expect(items.items.map((i: { deliveryAddressId: string | null }) => i.deliveryAddressId)).toEqual([a.id, null, null]);
    expect((await lucas.put(`/opportunities/${o.id}/delivery-addresses`, { rowVersion: saved.rowVersion, principal: {}, items: [] })).statusCode).toBe(409);
    const tl = ok(await lucas.get(`/opportunities/${o.id}/timeline`)).json();
    expect(JSON.stringify(tl)).toMatch(/outros endereços de entrega/);
  });
});

