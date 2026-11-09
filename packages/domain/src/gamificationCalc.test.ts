import { describe, expect, it } from 'vitest';
import { planSummary, taskPointsWith, unitsNeeded } from './gamificationCalc';

const b = { onTimeBp: 2_000, adherenceBp: 3_000, extraPerLevelBp: 2_500 };
describe('calculadora de meta', () => {
  it('soma os bônus sobre a base e multiplica acima da alçada (igual ao cálculo oficial)', () => {
    expect(taskPointsWith(10, { onTime: false, adherence: false }, b)).toBe(10);
    expect(taskPointsWith(10, { onTime: true, adherence: false }, b)).toBe(12);
    expect(taskPointsWith(10, { onTime: true, adherence: true }, b)).toBe(15);
    expect(taskPointsWith(10, { onTime: true, adherence: true, levelsAbove: 1 }, b)).toBe(18.8);
  });
  it('quantas faltam: arredonda para cima e desconta o que já tem', () => {
    expect(unitsNeeded(1000, 0, 12)).toBe(84);
    expect(unitsNeeded(1000, 400, 12)).toBe(50);
    expect(unitsNeeded(1000, 1200, 12)).toBe(0);
    expect(unitsNeeded(100, 0, 10)).toBe(10);
    expect(unitsNeeded(100, 0, 0)).toBeNull();
  });
  it('plano com várias tarefas', () => {
    expect(planSummary([{ points: 12, qty: 50 }, { points: 30, qty: 5 }], 1000, 100)).toEqual({ planned: 750, total: 850, missing: 150, pct: 85, reached: false });
    expect(planSummary([{ points: 10, qty: 10 }], 100).reached).toBe(true);
  });
});

import { simulateScore } from './gamificationCalc';
import { teamBoards, type GamificationSettings } from './gamification';
describe('simulador de nota', () => {
  it('bate com o cálculo oficial do placar', () => {
    const lvl = { key: 'n2', name: 'N2', rank: 2, expectedMonthlyPoints: 100, scoresTasks: true, weights: { ownBp: 6_000, teamBp: 4_000, dispersionBp: 0, areaBp: 0 } };
    const st = { journeys: [], teamIds: [], points: {}, participationMultiplierBp: 10_000, competencyLevels: [lvl], assignments: {}, defaultLevelKey: 'n2', defaultLeadLevelKey: 'n2',
      bonuses: { onTimeBp: 0, adherenceBp: 0, extraPerLevelBp: 0, extraCapBp: 3_000, scoreCapBp: 13_000 }, dispersionYellowBp: 3_000, dispersionRedBp: 5_000, levels: [{ name: 'B', minPoints: 0 }], performanceWeights: {}, performanceBands: { greenBp: 10_000, yellowBp: 8_000 } } as GamificationSettings;
    const b = teamBoards({ teams: [{ id: 't', memberIds: ['a', 'b'] }], credits: [], settings: st, extra: [{ userId: 'a', points: 110 }, { userId: 'a', points: 15, extra: true }, { userId: 'b', points: 85 }] });
    const a = b.people.find((p) => p.userId === 'a')!;
    const sim = simulateScore({ level: lvl, bonuses: st.bonuses, dispersionRedBp: 5_000, regular: 110, extra: 15, teamAverage: a.teamAverage, dispersionPct: null, area: a.area });
    expect(sim.score).toBe(a.score);
    expect(sim.own).toBe(125);
  });
  it('tetos e nivelamento', () => {
    const lvl = { expectedMonthlyPoints: 100, scoresTasks: true, weights: { ownBp: 3_000, teamBp: 5_000, dispersionBp: 2_000, areaBp: 0 } };
    const s = simulateScore({ level: lvl, bonuses: { scoreCapBp: 13_000, extraCapBp: 3_000 }, dispersionRedBp: 5_000, regular: 500, extra: 500, teamAverage: 100, dispersionPct: 25, area: 0 });
    expect(s.own).toBe(160);
    expect(s.dispersion).toBe(50);
    expect(s.score).toBe(108);
  });
});
