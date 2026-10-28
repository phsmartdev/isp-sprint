import { describe, expect, it } from 'vitest';
import { DEFAULT_CS_CONFIG as C, cadenceDates, contractAcv, coverage, criticality, effectivePriority, healthScore, ipcScore, policyFor, tierOf, validateCsConfig } from './cs';

describe('Sucesso do Cliente', () => {
  it('configuração padrão é válida e o IPC vai de 20 a 100', () => {
    expect(validateCsConfig(C)).toEqual([]);
    expect(validateCsConfig({ ...C, ipcPoints: { ...C.ipcPoints, potencial: { baixo: 10, medio: 20, alto: 30 } } })[0]).toContain('20 a 100');
  });
  it('Tier pelas faixas da especificação (limites inclusivos)', () => {
    expect(tierOf(12_000_000, C.tierBands)).toBe('small');
    expect(tierOf(12_000_100, C.tierBands)).toBe('middle');
    expect(tierOf(50_000_000, C.tierBands)).toBe('middle');
    expect(tierOf(50_000_100, C.tierBands)).toBe('large');
    expect(contractAcv({ monthlyCents: 1_000_000, totalCents: null, startAt: null, endAt: null })).toBe(12_000_000);
    expect(contractAcv({ monthlyCents: null, totalCents: 24_000_000, startAt: '2026-01-01', endAt: '2027-12-31' })).toBeCloseTo(12_000_000, -5);
  });
  it('IPC incompleto não tem total; completo soma os sete critérios', () => {
    const p = ipcScore({ tamanho: 'alto', tempo: 'medio' }, C);
    expect(p.total).toBeNull();
    expect(p.pending).toHaveLength(5);
    const full = ipcScore({ tamanho: 'alto', potencial: 'alto', segmento: 'alto', criticidade: 'alto', tempo: 'alto', relacionamento: 'alto', maturidade: 'alto' }, C);
    expect(full.total).toBe(100);
    expect(ipcScore({ tamanho: 'baixo', potencial: 'baixo', segmento: 'baixo', criticidade: 'baixo', tempo: 'baixo', relacionamento: 'baixo', maturidade: 'baixo' }, C).total).toBe(20);
  });
  it('saúde usa só os fatores com dado e exige cobertura mínima', () => {
    expect(healthScore({ satisfacao: 80 }, C).score).toBeNull();
    const h = healthScore({ satisfacao: 80, inadimplencia: 100, risco: 50 }, C);
    expect(h.score).toBe(Math.round((80 * 20 + 100 * 20 + 50 * 15) / 55));
  });
  it('criticidade explica os motivos e respeita os limites', () => {
    const c = criticality({ health: 30, tier: 'large', ipc: 90, classKey: 'Reputação', consumptionPct: 95, overdueCents: null, satisfaction: 40, daysToEnd: 20, churnRisk: 'alto', openOccurrences: 3, daysOverdueFollowUp: 40 }, C);
    expect(c.level).toBe('critica');
    expect(c.reasons[0]!.key).toBe('saude');
    expect(criticality({ health: 95, tier: 'small', ipc: 30, classKey: null, consumptionPct: null, overdueCents: null, satisfaction: 90, daysToEnd: 300, churnRisk: 'baixo', openOccurrences: 0, daysOverdueFollowUp: 0 }, C).level).toBe('baixa');
  });
  it('prioridade manual separada da calculada, com precedência configurável', () => {
    expect(effectivePriority('baixa', { level: 'alta', reviewAt: '2026-01-01' }, 'manual_ate_revisao', '2026-02-01')).toEqual({ level: 'baixa', source: 'calculada' });
    expect(effectivePriority('baixa', { level: 'alta', reviewAt: '2026-03-01' }, 'manual_ate_revisao', '2026-02-01')).toEqual({ level: 'alta', source: 'manual' });
    expect(effectivePriority('critica', { level: 'alta', reviewAt: null }, 'maior', '2026-02-01').level).toBe('critica');
  });
  it('cadência: política mais específica e datas no horizonte', () => {
    const cfg = { ...C, cadence: [...C.cadence, { key: 'x', name: 'Alta Large', when: { criticality: 'alta' as const, tier: 'large' as const }, contactDays: 7, visitDays: 15, reviewDays: null }] };
    expect(policyFor({ criticality: 'alta', tier: 'large', classKey: null, billingType: null, segment: null, csmId: null }, cfg)!.key).toBe('x');
    expect(policyFor({ criticality: 'alta', tier: 'small', classKey: null, billingType: null, segment: null, csmId: null }, cfg)!.key).toBe('alta');
    expect(cadenceDates('2026-01-01', 30, '2026-01-10', 60)).toEqual(['2026-01-31', '2026-03-02']);
    expect(cadenceDates(null, null, '2026-01-10', 60)).toEqual([]);
  });
  it('cobertura: só realizado e validado no prazo; extras à parte; limitada a 100%', () => {
    const r = coverage([
      { plannedAt: '2026-01-10', completedAt: '2026-01-11', validated: true, weight: 4, cadence: true },
      { plannedAt: '2026-01-10', completedAt: '2026-01-20', validated: true, weight: 1, cadence: true },
      { plannedAt: '2026-01-10', completedAt: '2026-01-10', validated: false, weight: 1, cadence: true },
      { plannedAt: '2026-01-10', completedAt: '2026-01-10', validated: true, weight: 1, cadence: false },
    ], 2);
    expect(r).toMatchObject({ planned: 3, onTime: 1, extra: 1, simple: 1 / 3, weighted: 4 / 6 });
    expect(coverage([], 2).simple).toBeNull();
  });
});

import { accountAcv, tierOf as tierOf2, DEFAULT_CS_CONFIG as CFG2 } from './cs';
describe('ACV consolidado e Tier', () => {
  it('recorrente ×12 + medição + frequente; ganha sem contrato pelo valor; consumo de medição não soma', () => {
    const r = accountAcv(
      [{ id: 'c1', opportunityId: 'o1', billingType: 'recorrente', acvCents: 6_000_000 }, { id: 'c2', opportunityId: null, billingType: 'medicao', acvCents: 30_000_000 }, { id: 'c3', opportunityId: 'o3', billingType: 'frequente', acvCents: 2_000_000 }],
      [
        { id: 'o1', valueCents: 500_000, monthly: true, saleKind: null, consumesContract: false }, // já no contrato c1
        { id: 'o4', valueCents: 1_000_000, monthly: true, saleKind: 'venda_consultiva', consumesContract: false }, // sem contrato: 12× mensal
        { id: 'o5', valueCents: 4_000_000, monthly: false, saleKind: 'licitacao', consumesContract: false }, // sem contrato: valor global
        { id: 'o6', valueCents: 9_000_000, monthly: false, saleKind: 'consumo_contrato', consumesContract: false },
        { id: 'o7', valueCents: 3_000_000, monthly: false, saleKind: null, consumesContract: true },
      ],
    );
    expect(r.parts).toEqual({ recorrente: 6_000_000, medicao: 30_000_000, frequente: 2_000_000, semContrato: 12_000_000 + 4_000_000 });
    expect(r.acvCents).toBe(54_000_000);
    expect(r.excluded).toEqual({ count: 2, cents: 12_000_000 });
    expect(tierOf2(r.acvCents, CFG2.tierBands)).toBe('large');
    expect(tierOf2(12_000_000, CFG2.tierBands)).toBe('small');
    expect(tierOf2(12_000_100, CFG2.tierBands)).toBe('middle');
    expect(tierOf2(50_000_000, CFG2.tierBands)).toBe('middle');
  });
});

import { distributeAccounts } from './cs';
describe('distribuição da carteira entre CSMs', () => {
  const accs = [
    { id: 'a', acvCents: 600_000_00, csmId: null }, { id: 'b', acvCents: 300_000_00, csmId: null }, { id: 'c', acvCents: 250_000_00, csmId: null },
    { id: 'd', acvCents: 50_000_00, csmId: null }, { id: 'e', acvCents: 0, csmId: null }, { id: 'f', acvCents: 0, csmId: null },
  ];
  it('equilibra o valor anual e, no empate, a quantidade', () => {
    const r = distributeAccounts(accs, ['luiz', 'paulo'], false);
    expect(r.assign.size).toBe(6);
    const [l, p] = [r.load.get('luiz')!, r.load.get('paulo')!];
    expect(Math.abs(l.acvCents - p.acvCents)).toBeLessThanOrEqual(50_000_00);
    expect(l.count + p.count).toBe(6);
    expect(r.assign.get('a')).toBe('luiz');
    expect(r.assign.get('b')).toBe('paulo');
  });
  it('mantém quem já tem um dos CSMs escolhidos quando pedido', () => {
    const r = distributeAccounts([{ ...accs[0]!, csmId: 'paulo' }, ...accs.slice(1)], ['luiz', 'paulo'], true);
    expect(r.assign.has('a')).toBe(false);
    expect(r.load.get('paulo')!.acvCents).toBeGreaterThanOrEqual(600_000_00);
    expect(r.assign.get('b')).toBe('luiz');
  });
});
