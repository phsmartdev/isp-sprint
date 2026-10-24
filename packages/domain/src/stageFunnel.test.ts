import { describe, expect, it } from 'vitest';
import { funnelConversion, stageTimes } from './stageFunnel';

const d = (day: number) => new Date(Date.UTC(2026, 9, day, 12)).toISOString();
const STAGES = [
  { key: 'novo', name: 'Novo', kind: 'open', position: 1 },
  { key: 'proposta', name: 'Proposta', kind: 'open', position: 2 },
  { key: 'negociacao', name: 'Negociação', kind: 'open', position: 3 },
  { key: 'ganha', name: 'Ganha', kind: 'won', position: 9 },
  { key: 'perdida', name: 'Perdida', kind: 'lost', position: 10 },
];

describe('tempo em cada etapa', () => {
  it('soma as passagens, inclusive as concluídas, e conta a atual até agora', () => {
    const t = stageTimes([{ at: d(1), to: 'novo' }, { at: d(4), to: 'proposta' }, { at: d(6), to: 'novo' }, { at: d(7), to: 'proposta' }], d(10));
    expect(t.map((x) => [x.key, x.days, x.visits, x.current])).toEqual([['novo', 4, 2, false], ['proposta', 5, 2, true]]);
  });
  it('ganha e perdida não contam tempo; registro repetido não vira nova passagem', () => {
    const t = stageTimes([{ at: d(1), to: 'novo' }, { at: d(2), to: 'novo' }, { at: d(3), to: 'ganha' }], d(20));
    expect(t).toEqual([{ key: 'novo', days: 2, visits: 1, firstAt: d(1), current: false }, { key: 'ganha', days: 0, visits: 1, firstAt: d(3), current: true }]);
  });
});

describe('conversão do funil', () => {
  it('conversão por etapa, quem pulou passou, perda na etapa e ciclo das ganhas', () => {
    const f = funnelConversion(STAGES, [
      { stage: 'ganha', moves: [{ at: d(1), to: 'novo' }, { at: d(3), to: 'proposta' }, { at: d(5), to: 'negociacao' }, { at: d(11), to: 'ganha' }] },
      { stage: 'perdida', moves: [{ at: d(1), to: 'novo' }, { at: d(2), to: 'proposta' }, { at: d(4), to: 'perdida' }] },
      { stage: 'negociacao', moves: [{ at: d(1), to: 'novo' }, { at: d(2), to: 'negociacao' }] }, // pulou proposta
      { stage: 'novo', moves: [{ at: d(1), to: 'novo' }] },
    ], d(11));
    expect(f.rows.map((r) => [r.key, r.reached, r.advanced, r.lostHere, r.here])).toEqual([
      ['novo', 4, 3, 0, 1], ['proposta', 3, 2, 1, 0], ['negociacao', 2, 1, 0, 1],
    ]);
    expect(f.rows[0]!.conversion).toBe(0.75);
    expect(f.rows[2]!.ofTotal).toBe(0.5);
    expect(f.rows[1]!.avgDays).toBe(2); // 2 dias (ganha) e 2 dias (perdida); quem pulou não conta tempo
    expect(f.rows[0]!.medianDays).toBe(1.5);
    expect(f).toMatchObject({ total: 4, won: 1, lost: 1, open: 2, conversion: 0.25, winRate: 0.5, avgCycleDays: 10 });
  });
  it('sem oportunidades não divide por zero', () => {
    const f = funnelConversion(STAGES, [], d(1));
    expect(f.rows[0]).toMatchObject({ reached: 0, conversion: null, avgDays: null });
    expect(f.conversion).toBeNull();
  });
});
