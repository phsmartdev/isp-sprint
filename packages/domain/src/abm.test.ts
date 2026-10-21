import { describe, expect, it } from 'vitest';
import { objectiveTransition, orgUnitCycle, orgUnitTree, abmTransition, cnpjRoot, commercialStatus, dedupMatches, dedupSearchTerms, orgNameSimilarity, orgNameTokens } from './abm';

const base = { customerLifecycle: null, activeContracts: 0, endedContracts: 0, openOpportunities: 0, daysSinceInteraction: null, prospecting: false };

describe('status comercial derivado', () => {
  it('cobre as situações da conta', () => {
    expect(commercialStatus(base)).toBe('identificada');
    expect(commercialStatus({ ...base, prospecting: true })).toBe('prospeccao');
    expect(commercialStatus({ ...base, daysSinceInteraction: 20 })).toBe('relacionamento');
    expect(commercialStatus({ ...base, daysSinceInteraction: 200, prospecting: true })).toBe('prospeccao');
    expect(commercialStatus({ ...base, openOpportunities: 1, daysSinceInteraction: 5 })).toBe('oportunidade');
    expect(commercialStatus({ ...base, customerLifecycle: 'ativo', activeContracts: 2, openOpportunities: 1 })).toBe('cliente_ativo');
    expect(commercialStatus({ ...base, customerLifecycle: 'ativo' })).toBe('cliente_sem_contrato');
    expect(commercialStatus({ ...base, customerLifecycle: 'cancelado', endedContracts: 1 })).toBe('ex_cliente');
    expect(commercialStatus({ ...base, customerLifecycle: 'cancelado', endedContracts: 1, openOpportunities: 1 })).toBe('oportunidade');
    expect(commercialStatus({ ...base, customerLifecycle: 'prospect', openOpportunities: 1 })).toBe('oportunidade');
  });
});

describe('status ABM', () => {
  it('transições e motivo para pausar/encerrar', () => {
    expect(abmTransition('candidata', 'selecionada')).toBeNull();
    expect(abmTransition('candidata', 'ativa')).toMatch(/Não dá/);
    expect(abmTransition('ativa', 'encerrada', 'curto')).toMatch(/sai do programa/);
    expect(abmTransition('ativa', 'encerrada', 'Cliente migrou para outra operação')).toBeNull();
    expect(abmTransition('encerrada', 'candidata')).toBeNull();
  });
});

describe('deduplicação', () => {
  it('normaliza nomes e mede semelhança', () => {
    expect(orgNameTokens('Prefeitura Municipal de São Cristóvão LTDA.')).toEqual(['prefeitura', 'municipal', 'sao', 'cristovao']);
    expect(orgNameSimilarity('Hospital São Lucas', 'Hosp. Sao Lucas S/A')).toBeGreaterThan(0.6);
    expect(orgNameSimilarity('Padaria Central', 'Escola Estadual Central')).toBeLessThan(0.6);
    expect(cnpjRoot('12.345.678/0001-90')).toBe('12345678');
    expect(cnpjRoot('123.456.789-00')).toBeNull();
    expect(dedupSearchTerms('Prefeitura Municipal de Aracaju')).toEqual(['prefeitura', 'municipal', 'aracaju']);
  });
  it('aponta CNPJ igual, mesma raiz e nome parecido, com motivos', () => {
    const rows = [
      { id: '1', name: 'Clínica Fictícia Ltda', document: '12.345.678/0001-90', city: 'Aracaju' },
      { id: '2', name: 'Outra Empresa', document: '12.345.678/0002-71', city: 'Lagarto' },
      { id: '3', name: 'Clinica Ficticia', document: null, city: 'Aracaju' },
      { id: '4', name: 'Mercado Bom Preço', document: null, city: 'Aracaju' },
    ];
    const m = dedupMatches({ name: 'Clínica Fictícia', document: '12345678000190', city: 'Aracaju' }, rows);
    expect(m.map((x) => x.id)).toEqual(['1', '3', '2']);
    expect(m[0]!.reasons).toContain('mesmo CNPJ/CPF');
    expect(m[2]!.reasons[0]).toMatch(/raiz de CNPJ/);
    expect(dedupMatches({ name: 'Nada a ver' }, rows)).toEqual([]);
  });
});

describe('Conta 360: objetivos e estrutura', () => {
  it('encerrar objetivo exige resultado; encerrado só reabre', () => {
    expect(objectiveTransition('planejado', 'em_andamento')).toBeNull();
    expect(objectiveTransition('em_andamento', 'atingido', 'ok')).toMatch(/resultado/);
    expect(objectiveTransition('em_andamento', 'atingido', 'Reunião com o secretário realizada')).toBeNull();
    expect(objectiveTransition('atingido', 'planejado')).toMatch(/reaberto/);
    expect(objectiveTransition('cancelado', 'em_andamento')).toBeNull();
  });
  it('estrutura: sem ciclos e em ordem de árvore', () => {
    const u = [{ id: 'a', parentId: null, name: 'Prefeitura' }, { id: 'b', parentId: 'a', name: 'Secretaria de Saúde' }, { id: 'c', parentId: 'b', name: 'Setor de TI' }, { id: 'd', parentId: 'a', name: 'Secretaria de Educação' }];
    expect(orgUnitCycle(u, 'a', 'c')).toBe(true);
    expect(orgUnitCycle(u, 'c', 'c')).toBe(true);
    expect(orgUnitCycle(u, 'c', 'd')).toBe(false);
    expect(orgUnitTree(u).map((x) => `${x.depth}:${x.id}`)).toEqual(['0:a', '1:d', '1:b', '2:c']);
  });
});
