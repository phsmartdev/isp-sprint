import { describe, expect, it } from 'vitest';
import { dispersion, gamificationSettingsErrors, goldMedalists, individualPoints, levelOf, podium, teamBoards, type GamificationSettings } from './gamification';

// valores de teste; na empresa vêm das configurações
const ST: GamificationSettings = {
  journeys: [], teamIds: [], points: { negociacao_ganha: 30, proposta_enviada: 5 }, participationMultiplierBp: 15_000, hierarchyWeights: { colaborador: { ownBp: 5_000, teamBp: 5_000 }, lideranca: { ownBp: 2_000, teamBp: 8_000 } },
  dispersionYellowBp: 3_000, dispersionRedBp: 5_000, levels: [{ name: 'Bronze', minPoints: 0 }, { name: 'Prata', minPoints: 50 }, { name: 'Ouro', minPoints: 100 }],
};

describe('gamificação colaborativa', () => {
  it('configurações validadas', () => {
    expect(gamificationSettingsErrors(ST)).toEqual([]);
    expect(gamificationSettingsErrors({ ...ST, dispersionRedBp: 2_000 }).join(' ')).toMatch(/vermelha/);
    expect(gamificationSettingsErrors({ ...ST, levels: [{ name: 'A', minPoints: 10 }, { name: 'B', minPoints: 5 }] }).join(' ')).toMatch(/crescentes/);
    expect(gamificationSettingsErrors({ ...ST, points: { negociacao_ganha: 0 } }).join(' ')).toMatch(/pelo menos um/);
    expect(gamificationSettingsErrors({ ...ST, hierarchyWeights: { ...ST.hierarchyWeights, lideranca: { ownBp: 3_000, teamBp: 8_000 } } }).join(' ')).toMatch(/somar 100%/);
  });
  it('pontos: direto × parte; participação vale mais; crédito de gestão não conta', () => {
    const m = individualPoints([
      { userId: 'a', type: 'negociacao_ganha', kind: 'direto', shareBp: 7_000 },
      { userId: 'b', type: 'negociacao_ganha', kind: 'participacao', shareBp: 3_000 },
      { userId: 'c', type: 'negociacao_ganha', kind: 'gestao', shareBp: 10_000 },
      { userId: 'a', type: 'tipo_sem_pontos', kind: 'direto', shareBp: 10_000 },
    ], ST);
    expect(m.get('a')).toMatchObject({ direct: 21, participation: 0, own: 21 });
    expect(m.get('b')).toMatchObject({ direct: 0, participation: 13.5, own: 13.5 }); // 30 × 0,3 × 1,5
    expect(m.has('c')).toBe(false);
    // pontos das jornadas somam no próprio
    const j = individualPoints([], ST, [{ userId: 'a', points: 8 }, { userId: 'a', points: 10.5 }]);
    expect(j.get('a')).toMatchObject({ journey: 18.5, own: 18.5 });
  });
  it('dispersão: time nivelado é verde; desigual é vermelho', () => {
    expect(dispersion([100, 100, 100], ST)).toMatchObject({ cv: 0, tone: 'verde' });
    expect(dispersion([100, 80, 90], ST).tone).toBe('verde');
    expect(dispersion([100, 60, 80], ST).tone).toBe('verde'); // cv ≈ 0,20
    expect(dispersion([100, 40, 70], ST).tone).toBe('amarelo'); // cv ≈ 0,35
    expect(dispersion([150, 0, 30], ST).tone).toBe('vermelho');
    expect(dispersion([10], ST).tone).toBe('sem_dados');
  });
  it('a média do time pesa na nota de cada pessoa; quem não pontuou conta como zero', () => {
    const credits = [
      { userId: 'a', type: 'negociacao_ganha', kind: 'direto', shareBp: 10_000 },
      { userId: 'a', type: 'negociacao_ganha', kind: 'direto', shareBp: 10_000 },
      { userId: 'b', type: 'proposta_enviada', kind: 'direto', shareBp: 10_000 },
      { userId: 'x', type: 'negociacao_ganha', kind: 'direto', shareBp: 10_000 },
      { userId: 'y', type: 'negociacao_ganha', kind: 'direto', shareBp: 10_000 },
    ];
    const r = teamBoards({ teams: [{ id: 't1', memberIds: ['a', 'b', 'c'] }, { id: 't2', memberIds: ['x', 'y'] }], credits, settings: ST });
    const t1 = r.boards.find((b) => b.teamId === 't1')!;
    expect(t1).toMatchObject({ points: 65, average: 21.7 });
    expect(t1.dispersion.tone).toBe('vermelho'); // 60, 5, 0
    expect(t1.members.map((m) => [m.userId, m.score])).toEqual([['a', 40.8], ['b', 13.3], ['c', 10.8]]);
    const t2 = r.boards.find((b) => b.teamId === 't2')!;
    expect(t2).toMatchObject({ average: 30, dispersion: { tone: 'verde' } });
    // liderança pesa mais o time: se 'a' lidera t1, nota = 60 × 0,2 + 21,67 × 0,8
    const led = teamBoards({ teams: [{ id: 't1', memberIds: ['a', 'b', 'c'], leadIds: ['a'] }], credits, settings: ST });
    expect(led.people.find((p) => p.userId === 'a')).toMatchObject({ role: 'lideranca', score: 29.3 });
    expect(led.people.find((p) => p.userId === 'b')).toMatchObject({ role: 'colaborador', score: 13.3 });
    // time nivelado (t2) vem primeiro no placar dos times
    expect(r.boards[0]!.teamId).toBe('t2');
    expect(r.people[0]).toMatchObject({ userId: 'a', score: 40.8 });
  });
  it('pódio com empate, nível e medalha de ouro (Selo BK de Qualidade)', () => {
    const p = podium([{ userId: 'a', score: 50 }, { userId: 'b', score: 50 }, { userId: 'c', score: 20 }, { userId: 'd', score: 10 }]);
    expect(p.map((x) => [x.userId, x.place])).toEqual([['a', 1], ['b', 1], ['c', 3]]);
    expect(podium([{ userId: 'a', score: 0 }])).toEqual([]);
    expect(levelOf(120, ST)!.name).toBe('Ouro');
    expect(levelOf(50, ST)!.name).toBe('Prata');
    expect(goldMedalists([{ userId: 'a', score: 80 }, { userId: 'b', score: 80 }, { userId: 'c', score: 10 }])).toEqual(['a', 'b']);
    expect(goldMedalists([{ userId: 'a', score: 0 }])).toEqual([]);
  });
});
