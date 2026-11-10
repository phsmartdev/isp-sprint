/** Licitação com objeto longo, vários endereços de entrega ligados aos produtos e anexo grande em partes. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATTACHMENT_CHUNK_BYTES, ATTACHMENT_DOWNLOAD_PART_BYTES } from '@isp/shared';
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

describe('Anexo grande em partes', () => {
  it('monta o arquivo, confere o tipo e baixa em pedaços', async () => {
    const o = ok(await lucas.post('/opportunities', await base()), 201).json();
    const size = Math.round(ATTACHMENT_CHUNK_BYTES * 2.4); // ~6 MB, 3 partes
    const file = Buffer.alloc(size);
    file.write('%PDF-1.4\n', 0, 'latin1');
    for (let i = 9; i < size; i++) file[i] = (i * 31) % 251;
    const uploadId = randomUUID();
    const parts = Math.ceil(size / ATTACHMENT_CHUNK_BYTES);
    // incompleto: falta parte
    ok(await lucas.put(`/opportunities/${o.id}/attachments/uploads/${uploadId}/parts/0`, { data: file.subarray(0, ATTACHMENT_CHUNK_BYTES).toString('base64') }), 204);
    expect((await lucas.post(`/opportunities/${o.id}/attachments/uploads/${uploadId}/complete`, { kind: 'outro', filename: 'edital.pdf', parts, sizeBytes: size })).statusCode).toBe(422);
    // outra pessoa não escreve no envio de quem começou
    expect((await rafael.put(`/opportunities/${o.id}/attachments/uploads/${uploadId}/parts/0`, { data: 'AAAA' })).statusCode).not.toBe(204);
    for (let n = 1; n < parts; n++) ok(await lucas.put(`/opportunities/${o.id}/attachments/uploads/${uploadId}/parts/${n}`, { data: file.subarray(n * ATTACHMENT_CHUNK_BYTES, (n + 1) * ATTACHMENT_CHUNK_BYTES).toString('base64') }), 204);
    const a = ok(await lucas.post(`/opportunities/${o.id}/attachments/uploads/${uploadId}/complete`, { kind: 'outro', filename: 'edital.pdf', parts, sizeBytes: size }), 201).json();
    expect(a).toMatchObject({ filename: 'edital.pdf', mime: 'application/pdf', sizeBytes: size });
    // as partes saem depois de montar
    expect((await lucas.post(`/opportunities/${o.id}/attachments/uploads/${uploadId}/complete`, { kind: 'outro', filename: 'edital.pdf', parts, sizeBytes: size })).statusCode).toBe(422);

    const got: Buffer[] = [];
    for (let p = 0; p * ATTACHMENT_DOWNLOAD_PART_BYTES < size; p++) {
      const r = ok(await lucas.get(`/opportunities/${o.id}/attachments/${a.id}/download?part=${p}`));
      expect(r.headers['x-total-size']).toBe(String(size));
      got.push(r.rawPayload);
    }
    expect(Buffer.concat(got).equals(file)).toBe(true);
    const list = ok(await lucas.get(`/opportunities/${o.id}/attachments`)).json();
    expect(list.items[0]).toMatchObject({ id: a.id, sizeBytes: size });

    // formato não aceito: recusa e limpa
    const bad = randomUUID();
    const exe = Buffer.from('MZ executavel qualquer');
    ok(await lucas.put(`/opportunities/${o.id}/attachments/uploads/${bad}/parts/0`, { data: exe.toString('base64') }), 204);
    const r = await lucas.post(`/opportunities/${o.id}/attachments/uploads/${bad}/complete`, { kind: 'outro', filename: 'x.exe', parts: 1, sizeBytes: exe.length });
    expect(r.statusCode).toBe(422);
    expect(r.json().detail).toMatch(/Formato não aceito/);
  });
});
