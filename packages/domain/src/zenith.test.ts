import { describe, expect, it } from 'vitest';
import { EMPTY_ZENITH, normalizeZenith, zenithErrors, zenithFields, type ZenithContract } from './zenith';

const full: ZenithContract = { ...EMPTY_ZENITH, holderCompany: 'Empresa Fictícia Ltda', alias: 'Enlaces corporativos', managedNetwork: false, publicIp: true, cdiUnits: 3, cdmUnits: 0, slaType: 'Nenhum SLA definido', techContact: { name: 'Técnico Fictício', email: 'tec@exemplo.test', phone: null }, adminContact: { name: 'Adm Fictícia', email: null, phone: null } };

describe('cadastro Zenith', () => {
  it('em branco aponta todos os obrigatórios; completo não tem pendência', () => {
    expect(zenithErrors(EMPTY_ZENITH).map((e) => e.path)).toEqual(['holderCompany', 'alias', 'managedNetwork', 'publicIp', 'cdiUnits', 'cdmUnits', 'slaType', 'techContact.name', 'adminContact.name']);
    expect(zenithErrors(full)).toEqual([]);
    expect(zenithErrors({ ...full, unlimitedBalance: true, cdiUnits: null, cdmUnits: null })).toEqual([]);
    expect(zenithErrors({ ...full, techContact: { ...full.techContact, email: 'x' } }).map((e) => e.path)).toEqual(['techContact.email']);
  });
  it('P2P não pede saldo, IP público nem rede gerenciada e não guarda esses campos', () => {
    const p2p = { ...full, modality: 'pseudowire_p2p' as const, managedNetwork: null, publicIp: null, cdiUnits: null, cdmUnits: null };
    expect(zenithErrors(p2p)).toEqual([]);
    expect(normalizeZenith({ ...full, modality: 'pseudowire_p2p' })).toMatchObject({ managedNetwork: null, publicIp: null, cdiUnits: null, cdmUnits: null, unlimitedBalance: false });
  });
  it('espelho: ICP sai do IPC, CNPJ precisa de 14 dígitos e SLA definido exige os valores da aba SLA', () => {
    const base = { client: { name: 'Cliente Fictício', document: '12.345.678/0001-90', ipc: 72, subclients: [] }, contract: { number: '045/2026', zenith: full }, slas: { availabilityPct: null, packetLossPct: null } };
    const r = zenithFields(base);
    expect(r.missing).toEqual([]);
    expect(r.fields.find((f) => f.label.startsWith('ICP'))).toMatchObject({ value: '72', source: 'crm' });
    expect(zenithFields({ ...base, client: { ...base.client, ipc: null, document: '123.456.789-00' } }).missing).toEqual(['CNPJ', 'ICP (Ideal Customer Profile)']);
    expect(zenithFields({ ...base, contract: { ...base.contract, zenith: { ...full, slaType: 'SLA Ouro' } } }).missing).toEqual(['Disponibilidade mensal mínima (%)', 'Perda de pacote máxima admitida (%)']);
    expect(zenithErrors({ ...full, slaType: 'SLA Ouro' }).map((e) => e.path)).toEqual(['availabilityPct', 'packetLossPct']);
    expect(zenithFields({ ...base, contract: { ...base.contract, zenith: { ...full, slaType: 'SLA Ouro', availabilityPct: 99.8, packetLossPct: 2 } } }).missing).toEqual([]);
    expect(zenithFields({ ...base, contract: { number: '1', zenith: null } }).missing).toContain('Empresa detentora do contrato');
  });
});
