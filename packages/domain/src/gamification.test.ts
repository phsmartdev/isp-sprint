import { describe, expect, it } from 'vitest';
import { dispersion, dispersionScore, gamificationSettingsErrors, goldMedalists, individualPoints, levelFor, levelOf, teamBoards, type GamificationSettings } from './gamification';

// valores de teste; na empresa vêm da regra aprovada
const ST: GamificationSettings = {
  journeys: [], teamIds: [], points: { negociacao_ganha: 30, proposta_enviada: 5 }, participationMultiplierBp: 15_000,
  competencyLevels: [
    { key: 'n1', name: 'Apoio', rank: 1, expectedMonthlyPoints: 60, scoresTasks: true, weights: { ownBp: 6_000, teamBp: 4_000, dispersionBp: 0, areaBp: 0 } },
    { key: 'n2', name: 'Execução', rank: 2, expectedMonthlyPoints: 100, scoresTasks: true, weights: { ownBp: 6_000, teamBp: 4_000, dispersionBp: 0, areaBp: 0 } },
    { key: 'n4', name: 'Liderança', rank: 4, expectedMonthlyPoints: 100, scoresTasks: true, weights: { ownBp: 3_000, teamBp: 5_000, dispersionBp: 2_000, areaBp: 0 } },
    { key: 'n5', name: 'Gerência', rank: 5, expectedMonthlyPoints: 0, scoresTasks: false, weights: { ownBp: 0, teamBp: 4_000, dispersionBp: 0, areaBp: 6_000 } },
  ],
  assignments: { assist: 'n1', ger: 'n5' }, defaultLevelKey: 'n2', defaultLeadLevelKey: 'n4',
  bonuses: { onTimeBp: 2_000, adherenceBp: 3_000, extraPerLevelBp: 2_500, extraCapBp: 3_000, scoreCapBp: 13_000 },
  dispersionYellowBp: 3_000, dispersionRedBp: 5_000, levels: [{ name: 'Bronze', minPoints: 0 }, { name: 'Prata', minPoints: 80 }, { name: 'Ouro', minPoints: 100 }],
  performanceBands: { greenBp: 10_000, yellowBp: 8_000 },
  performanceWeights: {
    n1: { activity: 5_000, individual: 3_000, team: 2_000, unit: 0, company: 0 }, n2: { activity: 4_000, individual: 3_500, team: 2_500, unit: 0, company: 0 },
    n4: { activity: 1_500, individual: 1_500, team: 4_500, unit: 2_500, company: 0 }, n5: { activity: 0, individual: 0, team: 2_500, unit: 4_500, company: 3_000 },
  },
};

describe('gamificação por nível de competência', () => {
  it('regra validada', () => {
    expect(gamificationSettingsErrors(ST)).toEqual([]);
    expect(gamificationSettingsErrors({ ...ST, dispersionRedBp: 2_000 }).join(' ')).toMatch(/vermelha/);
    expect(gamificationSettingsErrors({ ...ST, competencyLevels: [{ ...ST.competencyLevels[0]!, weights: { ownBp: 5_000, teamBp: 4_000, dispersionBp: 0, areaBp: 0 } }, ...ST.competencyLevels.slice(1)] }).join(' ')).toMatch(/somar 100%/);
    expect(gamificationSettingsErrors({ ...ST, assignments: { x: 'nenhum' } }).join(' ')).toMatch(/nível inexistente/);
    expect(gamificationSettingsErrors({ ...ST, performanceWeights: { ...ST.performanceWeights, n1: { activity: 5_000, individual: 3_000, team: 1_000, unit: 0, company: 0 } } }).join(' ')).toMatch(/Performance de Apoio: os pesos devem somar 100%/);
    expect(gamificationSettingsErrors({ ...ST, performanceWeights: { n1: ST.performanceWeights.n1! } }).join(' ')).toMatch(/defina os pesos de Execução/);
    expect(gamificationSettingsErrors({ ...ST, journeys: [{ key: 'lic', name: 'Lic', pipelineId: 'p', wonPoints: 0, components: [{ key: 'a', name: 'A', stageKey: null, points: 5, dueDays: 1, level: 'n9' }] }] }).join(' ')).toMatch(/alçada inexistente/);
  });
  it('pontos brutos: eventos, ajuda com multiplicador, jornada regular e extra', () => {
    const m = individualPoints([{ userId: 'a', type: 'negociacao_ganha', kind: 'direto', shareBp: 7_000 }, { userId: 'b', type: 'negociacao_ganha', kind: 'participacao', shareBp: 3_000 }, { userId: 'c', type: 'negociacao_ganha', kind: 'gestao', shareBp: 10_000 }], ST, [{ userId: 'a', points: 8 }, { userId: 'a', points: 12, extra: true }]);
    expect(m.get('a')).toMatchObject({ direct: 21, journey: 8, extra: 12, points: 41 });
    expect(m.get('b')).toMatchObject({ participation: 13.5 });
    expect(m.has('c')).toBe(false);
  });
  it('nível: cadastrado, padrão e padrão da liderança', () => {
    expect(levelFor(ST, 'assist', false).key).toBe('n1');
    expect(levelFor(ST, 'qualquer', false).key).toBe('n2');
    expect(levelFor(ST, 'lider', true).key).toBe('n4');
  });
  it('nota proporcional: assistente com 60 e analista com 100 ficam iguais; teto; extra com teto próprio', () => {
    const r = teamBoards({ teams: [{ id: 't', memberIds: ['assist', 'anal', 'anal2'] }], credits: [], settings: ST, extra: [
      { userId: 'assist', points: 60 }, { userId: 'anal', points: 100 }, { userId: 'anal2', points: 200 }, { userId: 'anal2', points: 60, extra: true },
    ] });
    const by = Object.fromEntries(r.people.map((p) => [p.userId, p]));
    expect(by.assist).toMatchObject({ levelKey: 'n1', attainment: 100, own: 100 });
    expect(by.anal).toMatchObject({ levelKey: 'n2', attainment: 100, own: 100 });
    // 200/100 = 200% → teto 130%; extra 60/100 = 60 p.p. → teto 30 p.p.
    expect(by.anal2).toMatchObject({ attainment: 130, extraAttainment: 30, own: 160 });
    expect(r.boards[0]!.average).toBeCloseTo(120, 5);
  });
  it('composição por nível: liderança soma a dispersão; gerência fica só com o coletivo e fora da média', () => {
    const r = teamBoards({ teams: [{ id: 't', memberIds: ['lider', 'a', 'b', 'ger'], leadIds: ['lider'] }], credits: [], settings: ST, extra: [
      { userId: 'lider', points: 100 }, { userId: 'a', points: 100 }, { userId: 'b', points: 100 }, { userId: 'ger', points: 999 },
    ] });
    const by = Object.fromEntries(r.people.map((p) => [p.userId, p]));
    // todos com 100%: time nivelado → dispersão nota 100
    expect(by.lider).toMatchObject({ levelKey: 'n4', dispersionScore: 100, score: 100 });
    expect(by.ger).toMatchObject({ levelKey: 'n5', own: 0, teamAverage: 100, area: 100, score: 100 });
    expect(r.boards[0]!.average).toBe(100);
    // time desigual: a dispersão derruba a nota da liderança
    const d = teamBoards({ teams: [{ id: 't', memberIds: ['lider', 'a', 'b'], leadIds: ['lider'] }], credits: [], settings: ST, extra: [{ userId: 'lider', points: 100 }, { userId: 'a', points: 130 }, { userId: 'b', points: 10 }] });
    const lider = d.people.find((p) => p.userId === 'lider')!;
    expect(lider.dispersionScore).toBeLessThan(50);
    expect(d.boards[0]!.dispersion.tone).toBe('vermelho');
  });
  it('meta do período: no ano, a meta do nível × meses', () => {
    const r = teamBoards({ teams: [{ id: 't', memberIds: ['anal'] }], credits: [], settings: ST, extra: [{ userId: 'anal', points: 600 }], months: 6 });
    expect(r.people[0]).toMatchObject({ expected: 600, attainment: 100 });
  });
  it('dispersão, faixas e medalha do primeiro lugar', () => {
    expect(dispersion([100, 100, 100], ST)).toMatchObject({ cv: 0, tone: 'verde' });
    expect(dispersion([150, 0, 30], ST).tone).toBe('vermelho');
    expect(dispersionScore(null, ST)).toBe(100);
    expect(dispersionScore(0.5, ST)).toBe(0);
    expect(levelOf(105, ST)!.name).toBe('Ouro');
    expect(levelOf(85, ST)!.name).toBe('Prata');
    expect(goldMedalists([{ userId: 'a', score: 80 }, { userId: 'b', score: 80 }, { userId: 'c', score: 10 }])).toEqual(['a', 'b']);
    expect(goldMedalists([{ userId: 'a', score: 0 }])).toEqual([]);
  });
});
