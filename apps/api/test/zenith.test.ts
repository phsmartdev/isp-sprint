/** Zenith: cadastro no contrato (versionado), listas configuráveis e espelho campo a campo com origem e pendências. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client]; });
afterAll(async () => { await ctx.close(); });

const zenith = { modality: 'convencional', holderCompany: 'Empresa Detentora Fictícia', alias: 'Enlaces corporativos', managedNetwork: false, publicIp: true, unlimitedBalance: false, cdiUnits: 2, cdmUnits: 1, slaType: 'SLA Fictício', techContact: { name: 'Técnico Fictício', email: 'tec@exemplo.test', phone: null }, adminContact: { name: 'Administrativo Fictício', email: null, phone: '79 90000-0000' } };

describe('Zenith', () => {
  it('listas: só a administração altera; padrão traz "Nenhum SLA definido"', async () => {
    expect((await lucas.get('/contracts/zenith-lists')).json().slaTypes).toContain('Nenhum SLA definido');
    expect((await lucas.put('/admin/contract-settings/zenith', { holders: ['X'], slaTypes: ['Y'] })).statusCode).toBe(403);
    ok(await carlos.put('/admin/contract-settings/zenith', { holders: ['Empresa Detentora Fictícia'], slaTypes: ['Nenhum SLA definido', 'SLA Fictício'] }));
    expect((await lucas.get('/contracts/zenith-lists')).json()).toEqual({ holders: ['Empresa Detentora Fictícia'], slaTypes: ['Nenhum SLA definido', 'SLA Fictício'] });
    // não apaga os outros parâmetros de contratos
    expect((await carlos.get('/admin/contract-settings')).json().renewalAlertDays).toBeGreaterThan(0);
  });

  it('contrato: cadastro incompleto é recusado; completo grava e o espelho aponta só o que falta no CRM', async () => {
    const stamp = Date.now().toString(36);
    const today = new Date().toISOString().slice(0, 10);
    const c = ok(await lucas.post('/contacts', { name: `Cliente Zenith ${stamp}`, segment: 'empresarial', phone: '79999990003' }), 201).json();
    const plan = (await carlos.get('/meta/lookups')).json().plans[0];
    const branch = (await carlos.get('/meta/lookups')).json().branches[0];
    const won = ok(await lucas.post('/opportunities', { contactId: c.id, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false, branchId: branch.id }), 201).json().id;
    ok(await carlos.post(`/opportunities/${won}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${won}`)).json().rowVersion }));
    // a empresa detentora já vem da filial da oportunidade
    expect((await carlos.get(`/contracts/prefill?opportunityId=${won}`)).json().suggestion.version.zenith.holderCompany).toBe(branch.name);
    const version = { number: `ZEN-${stamp}`, object: 'Conectividade fictícia', signedAt: today, startAt: today, termMonths: 12, monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }] };
    const bad = await carlos.post('/contracts', { opportunityId: won, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { ...version, zenith: { ...zenith, alias: '', cdiUnits: null } } });
    // SLA definido sem as metas também é recusado
    expect((await carlos.post('/contracts', { opportunityId: won, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { ...version, zenith } })).statusCode).toBe(422);
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('Cadastro Zenith');
    const id = ok(await carlos.post('/contracts', { opportunityId: won, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { ...version, serviceType: 'telecom', zenith: { ...zenith, availabilityPct: 99.5, packetLossPct: 3 } } }), 201).json().id;
    let m = ok(await carlos.get(`/contracts/${id}/zenith`)).json();
    expect(m.ready).toBe(false);
    expect(m.sending).toBe('aguardando_api');
    // faltam no CRM: CNPJ e IPC da conta; SLA definido exige disponibilidade e perda de pacotes cadastradas
    expect(m.missing).toEqual(['CNPJ', 'ICP (Ideal Customer Profile)']);
    expect(m.fields.find((f: { label: string }) => f.label === 'Número do contrato')).toMatchObject({ value: `ZEN-${stamp}`, source: 'crm' });
    expect(m.fields.find((f: { label: string }) => f.label === 'Alias / apelido')).toMatchObject({ value: 'Enlaces corporativos', source: 'cadastro_zenith' });
    // as metas digitadas no cadastro Zenith viram as metas de SLA do contrato (aba Execução)
    ok(await carlos.put(`/contracts/${id}`, { version: { zenith: { ...zenith, availabilityPct: 99.8, packetLossPct: 2 } } }));
    const ex = ok(await carlos.get(`/contracts/${id}/execution`)).json();
    expect(ex.slas.map((x: { metric: string; target: number }) => [x.metric, x.target]).sort()).toEqual([['disponibilidade', 99.8], ['perda_pacotes', 2]]);
    m = ok(await carlos.get(`/contracts/${id}/zenith`)).json();
    expect(m.missing).toEqual(['CNPJ', 'ICP (Ideal Customer Profile)']);
    expect(m.fields.find((f: { label: string }) => f.label.startsWith('Disponibilidade')).value).toBe('99.8');
    // P2P: edição gera versão nova e descarta saldo/IP/rede
    ok(await carlos.put(`/contracts/${id}`, { version: { zenith: { ...zenith, availabilityPct: 99.8, packetLossPct: 2, modality: 'pseudowire_p2p' } } }));
    const d = ok(await carlos.get(`/contracts/${id}`)).json();
    m = ok(await carlos.get(`/contracts/${id}/zenith`)).json();
    expect(m.zenith).toMatchObject({ modality: 'pseudowire_p2p', publicIp: null, cdiUnits: null });
    expect(m.fields.some((f: { label: string }) => f.label === 'Possuirá IP público')).toBe(false);
    expect(d.versions.length).toBe(3);
    // telecom sem cadastro Zenith não salva; mudar para outro serviço tira o contrato do Zenith
    expect((await carlos.put(`/contracts/${id}`, { version: { zenith: null } })).statusCode).toBe(422);
    ok(await carlos.put(`/contracts/${id}`, { version: { serviceType: 'outro' } }));
    m = ok(await carlos.get(`/contracts/${id}/zenith`)).json();
    expect(m).toMatchObject({ applicable: false, serviceType: 'outro', zenith: null });
  });
});
