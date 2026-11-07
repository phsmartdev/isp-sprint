import { describe, expect, it } from 'vitest';
import { goalsAttainment, groupPerformance, performanceScore, performanceWeightsErrors, type PerformanceWeights } from './hierarchyPerformance';

// valores de teste; na empresa vêm da regra aprovada
const BANDS = { greenBp: 10_000, yellowBp: 8_000 };
const COLAB: PerformanceWeights = { activity: 4_000, individual: 3_500, team: 2_500, unit: 0, company: 0 };
const GER: PerformanceWeights = { activity: 0, individual: 0, team: 2_500, unit: 4_500, company: 3_000 };
const v = (activity: number | null, individual: number | null, team: number | null, unit: number | null = null, company: number | null = null) => ({
  activity: { value: activity, goals: 0 }, individual: { value: individual, goals: individual === null ? 0 : 1 }, team: { value: team, goals: team === null ? 0 : 1 }, unit: { value: unit, goals: unit === null ? 0 : 1 }, company: { value: company, goals: company === null ? 0 : 1 },
});

describe('performance por nível hierárquico', () => {
  it('pesos validados', () => {
    expect(performanceWeightsErrors({ n2: COLAB }, { n2: 'Execução' }, BANDS)).toEqual([]);
    expect(performanceWeightsErrors({ n2: { ...COLAB, team: 3_000 } }, { n2: 'Execução' }, BANDS).join(' ')).toMatch(/somar 100%/);
    expect(performanceWeightsErrors({ n9: COLAB }, { n2: 'Execução' }, BANDS).join(' ')).toMatch(/inexistente/);
    expect(performanceWeightsErrors({}, {}, { greenBp: 8_000, yellowBp: 9_000 }).join(' ')).toMatch(/verde/);
  });
  it('atingimento das metas: média com teto; sem meta = null', () => {
    expect(goalsAttainment([0.8, 1.2], 13_000)).toBe(100);
    expect(goalsAttainment([2, 1], 13_000)).toBe(115);
    expect(goalsAttainment([null], 13_000)).toBeNull();
  });
  it('compõe pelos pesos do nível', () => {
    const r = performanceScore(v(100, 80, 90), COLAB, BANDS);
    expect(r.score).toBe(90.5); // 0,40×100 + 0,35×80 + 0,25×90
    expect(r.tone).toBe('amarelo');
    const g = performanceScore(v(null, null, 100, 110, 90), GER, BANDS);
    expect(g.score).toBe(101.5); // 0,25×100 + 0,45×110 + 0,30×90
    expect(g.tone).toBe('verde');
  });
  it('componente sem meta: o peso vai para os demais', () => {
    const r = performanceScore(v(100, null, 80), COLAB, BANDS); // 40 e 25 → 61,5% e 38,5%
    expect(r.score).toBeCloseTo(92.3, 1);
    expect(r.components.find((c) => c.key === 'individual')).toMatchObject({ value: null, effectiveBp: 0 });
    expect(r.components.find((c) => c.key === 'activity')!.effectiveBp).toBe(6_154);
    expect(performanceScore(v(null, null, null), COLAB, BANDS)).toMatchObject({ score: null, tone: 'sem_dados' });
  });
  it('performance do grupo', () => {
    expect(groupPerformance([90, 110, null])).toBe(100);
    expect(groupPerformance([null])).toBeNull();
  });
});
