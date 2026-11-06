/** Estruturas: macro entidade que reúne contas e contratos (ex.: rede estadual fictícia). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((x) => login(ctx.app, `${x}@yepnet.test`)))) as [Client, Client, Client];
});
afterAll(async () => ctx.close());

async function contractFor(name: string) {
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name, segment: 'governamental' }, planId: plan.id }), 201).json();
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
  const id = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { number: `RG-${name.slice(-4)}`, object: 'Link da rede', signedAt: today, startAt: today, endAt: '2027-12-31', monthlyCents: 250_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 250_000 }] } }), 201).json().id as string;
  return { contactId: o.contactId as string, contractId: id };
}

describe('estruturas', () => {
  it('cria (só gestão), vincula contas com papel e contratos, sugere contratos das contas, soma o mensal, desvincula com motivo', async () => {
    ok(await lucas.post('/structures', { name: `Rede Fictícia ${stamp}` }), 403);
    const st = ok(await carlos.post('/structures', { name: `Rede Fictícia ${stamp}`, kind: 'rede', description: 'Rede estadual de conectividade (fictícia)' }), 201).json().id;
    ok(await carlos.post('/structures', { name: `rede fictícia ${stamp}` }), 422);
    const a = await contractFor(`Órgão Gestor ${stamp}`);
    const b = await contractFor(`Escola Participante ${stamp}`);
    // na conta: vincula a uma estrutura existente
    const avail = ok(await lucas.get(`/accounts/${a.contactId}/structures`)).json();
    expect(avail.available.some((x: { id: string }) => x.id === st)).toBe(true);
    ok(await lucas.post(`/structures/${st}/members`, { contactId: a.contactId, role: 'gestor' }), 201);
    ok(await lucas.post(`/structures/${st}/members`, { contactId: a.contactId, role: 'participante' }), 422);
    ok(await lucas.post(`/structures/${st}/members`, { contactId: b.contactId }), 201);
    ok(await rafael.post(`/structures/${st}/members`, { contactId: a.contactId }), 404); // conta fora da carteira
    let d = ok(await lucas.get(`/structures/${st}`)).json();
    expect(d.members.map((m: { roleLabel: string }) => m.roleLabel).sort()).toEqual(['Participante', 'Órgão gestor / coordenação']);
    expect(d.suggestedContracts.map((c: { id: string }) => c.id).sort()).toEqual([a.contractId, b.contractId].sort());
    ok(await lucas.post(`/structures/${st}/contracts`, { contractId: a.contractId }), 201);
    ok(await lucas.post(`/structures/${st}/contracts`, { contractId: b.contractId }), 201);
    ok(await lucas.post(`/structures/${st}/contracts`, { contractId: b.contractId }), 422);
    d = ok(await lucas.get(`/structures/${st}`)).json();
    expect(d.contracts).toHaveLength(2);
    expect(d.monthlyCents).toBe(500_000);
    expect(d.suggestedContracts).toEqual([]);
    const list = ok(await lucas.get('/structures')).json().items.find((x: { id: string }) => x.id === st);
    expect(list).toMatchObject({ accounts: 2, contracts: 2, monthlyCents: 500_000, kindLabel: 'Rede' });
    const mine = ok(await lucas.get(`/accounts/${b.contactId}/structures`)).json();
    expect(mine.items[0]).toMatchObject({ id: st, me: { role: 'participante' } });
    expect(mine.items[0].members).toHaveLength(2);
    // desvincula
    const link = d.contracts.find((c: { id: string }) => c.id === b.contractId);
    ok(await lucas.post(`/structure-contracts/${link.linkId}/remove`, { reason: 'Contrato fora da rede' }));
    const mem = d.members.find((m: { contactId: string }) => m.contactId === b.contactId);
    ok(await lucas.post(`/structure-members/${mem.id}/remove`, { reason: 'Saiu da rede' }));
    d = ok(await lucas.get(`/structures/${st}`)).json();
    expect([d.members.length, d.contracts.length, d.monthlyCents]).toEqual([1, 1, 250_000]);
    const v = d.rowVersion;
    ok(await carlos.patch(`/structures/${st}`, { rowVersion: v, active: false }));
    ok(await lucas.post(`/structures/${st}/members`, { contactId: b.contactId }), 422);
  });
});
