import { describe, expect, it } from 'vitest';
import { BUSINESS_EVENT_TYPES, DEFAULT_PERFORMANCE_CONFIG, computeCredits, validatePerformanceConfig } from './performance';

const sumDirect = (c: { kind: string; shareBp: number }[]) => c.filter((x) => x.kind === 'direto').reduce((a, x) => a + x.shareBp, 0);

describe('motor de eventos: atribuição', () => {
  it('sem participantes o responsável fica com 100%', () => {
    expect(computeCredits({ ownerShareBp: 7000, participants: true, managers: false }, 'a', [], [])).toEqual([{ userId: 'a', kind: 'direto', shareBp: 10_000 }]);
  });
  it('divide o resto entre participantes, soma sempre 100% e o arredondamento fica com o responsável', () => {
    const c = computeCredits({ ownerShareBp: 7000, participants: true, managers: true }, 'a', ['b', 'c', 'd', 'a', 'b'], ['g', 'a']);
    expect(sumDirect(c)).toBe(10_000);
    expect(c.find((x) => x.userId === 'a')!.shareBp).toBe(7000);
    expect(c.filter((x) => x.kind === 'direto' && x.userId !== 'a').map((x) => x.shareBp)).toEqual([1000, 1000, 1000]);
    expect(c.find((x) => x.userId === 'g')).toEqual({ userId: 'g', kind: 'gestao', shareBp: 0 });
    const odd = computeCredits({ ownerShareBp: 5000, participants: true, managers: false }, 'a', ['b', 'c', 'd'], []);
    expect(sumDirect(odd)).toBe(10_000);
    expect(odd.find((x) => x.userId === 'a')!.shareBp).toBe(5002);
  });
  it('responsável com 100%: participantes só recebem crédito de participação', () => {
    const c = computeCredits({ ownerShareBp: 10_000, participants: true, managers: false }, 'a', ['b'], []);
    expect(c).toEqual([{ userId: 'a', kind: 'direto', shareBp: 10_000 }, { userId: 'b', kind: 'participacao', shareBp: 0 }]);
  });
  it('configuração padrão é válida e cobre todos os tipos', () => {
    expect(validatePerformanceConfig(DEFAULT_PERFORMANCE_CONFIG)).toEqual([]);
    expect(Object.keys(DEFAULT_PERFORMANCE_CONFIG.attribution)).toHaveLength(BUSINESS_EVENT_TYPES.length);
    expect(validatePerformanceConfig({ attribution: { x: { ownerShareBp: 12_000, participants: false, managers: false } }, validationRequired: ['y'] })).toHaveLength(3);
  });
});
