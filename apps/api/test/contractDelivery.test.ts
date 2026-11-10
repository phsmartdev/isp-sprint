/** Contrato → endereços de entrega: cadastro com várias linhas e colunas extras, validação e alteração em nova versão. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  lucas = await login(ctx.app, 'lucas@yepnet.test');
});
afterAll(async () => ctx.close());

describe('Endereços de entrega do contrato', () => {
  it('cadastra, valida e altera (nova versão, a anterior fica)', async () => {
    const stamp = Date.now().toString(36);
    const today = new Date().toISOString().slice(0, 10);
    const c = ok(await lucas.post('/contacts', { name: `Cliente Endereços ${stamp}`, segment: 'empresarial', phone: '79999990002' }), 201).json();
    const plan = (await carlos.get('/meta/lookups')).json().plans[0];
    const won = ok(await lucas.post('/opportunities', { contactId: c.id, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false }), 201).json().id;
    ok(await carlos.post(`/opportunities/${won}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${won}`)).json().rowVersion }));
    const base = { number: `END-${stamp}`, object: 'Conectividade fictícia em vários pontos', signedAt: today, startAt: today, termMonths: 12, monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }] };
    const delivery = { columns: ['Contato local'], rows: [
      { seq: 1, address: 'Rua Fictícia A, 10 - Centro', service: '100 Mbps', extra: { 'Contato local': 'Portaria' } },
      { seq: 2, address: 'Av. Fictícia B, 200', service: 'Link dedicado 50 Mbps', extra: {} },
    ] };
    const dup = await carlos.post('/contracts', { opportunityId: won, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { ...base, deliveryAddresses: { columns: [], rows: [delivery.rows[0], { ...delivery.rows[1], seq: 1 }] } } });
    expect(dup.statusCode).toBe(422);
    expect(dup.body).toMatch(/Sequência 1 repetida/);
    const id = ok(await carlos.post('/contracts', { opportunityId: won, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { ...base, deliveryAddresses: delivery } }), 201).json().id;
    const got = ok(await carlos.get(`/contracts/${id}`)).json();
    expect(got.current.deliveryAddresses).toEqual(delivery);
    // inclui um terceiro ponto: nova versão, a anterior fica com dois
    const more = { columns: ['Contato local', 'Prazo'], rows: [...delivery.rows, { seq: 3, address: 'Rua Fictícia C, 5', service: '200 Mbps', extra: { Prazo: '30 dias' } }] };
    ok(await carlos.put(`/contracts/${id}`, { version: { deliveryAddresses: more }, reason: 'Novo ponto de entrega' }));
    // reenviar os mesmos endereços (outra ordem de campos) não cria versão
    ok(await carlos.put(`/contracts/${id}`, { version: { deliveryAddresses: { columns: more.columns, rows: more.rows.map(({ extra, service, address, seq }) => ({ extra, service, address, seq })) } }, reason: 'Sem mudança' }));
    const after = ok(await carlos.get(`/contracts/${id}`)).json();
    expect(after.current.deliveryAddresses.rows).toHaveLength(3);
    expect(after.current.version).toBe(2);
    expect(after.versions.find((v: { version: number }) => v.version === 1).deliveryAddresses.rows).toHaveLength(2);
  });
});
