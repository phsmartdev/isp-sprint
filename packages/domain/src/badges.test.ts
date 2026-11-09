import { describe, expect, it } from 'vitest';
import { DEFAULT_BADGES, badgeProgress, badgeSettingsErrors, pointsBySource } from './badges';
import { journeyCredits } from './scoreJourneys';

describe('badges', () => {
  it('padrão é válido e nenhuma origem conta em dois badges', () => {
    expect(badgeSettingsErrors(DEFAULT_BADGES)).toEqual([]);
    const all = DEFAULT_BADGES.flatMap((b) => b.sources);
    expect(new Set(all).size).toBe(all.length);
  });
  it('recusa origem repetida, desconhecida e faixas fora de ordem', () => {
    const bad = structuredClone(DEFAULT_BADGES);
    bad[1]!.sources.push('apoio_dado', 'evento:inexistente');
    bad[2]!.tiers[1]!.minPoints = 10;
    const e = badgeSettingsErrors(bad).join(' ');
    expect(e).toMatch(/duas badges/);
    expect(e).toMatch(/origem desconhecida/);
    expect(e).toMatch(/crescentes/);
  });
  it('faixa alcançada, quanto falta para a próxima e de onde vieram', () => {
    const p = badgeProgress({ apoio_dado: 50, participacao: 40, tarefas: 10 }, DEFAULT_BADGES);
    const h = p.find((b) => b.key === 'humanizacao')!;
    expect(h.points).toBe(90);
    expect(h.tier).toBe('Faixa média');
    expect(h.next).toEqual({ name: 'Faixa alta', minPoints: 160, missing: 70 });
    expect(h.parts[0]).toMatchObject({ source: 'apoio_dado', points: 50 });
    const d = p.find((b) => b.key === 'dinamismo')!;
    expect(d.tierIndex).toBeNull();
    expect(d.next?.missing).toBe(290);
    const top = badgeProgress({ apoio_dado: 500 }, DEFAULT_BADGES).find((b) => b.key === 'humanizacao')!;
    expect(top.tier).toBe('Faixa alta');
    expect(top.next).toBeNull();
  });
  it('separa base, prazo, aderência e acima da alçada da tarefa; soma eventos, apoio e certificados', () => {
    const journeys = [{ key: 'j', name: 'J', pipelineId: 'p', wonPoints: 0, components: [{ key: 'c', name: 'C', stageKey: null, points: 10, dueDays: 1, level: 'n3' }] }];
    const cr = journeyCredits(journeys, [{ taskId: 't', opportunityId: 'o', ref: 'j:c', userId: 'u', inPeriod: true, onTime: true, approved: true }], [],
      { onTimeBp: 2000, adherenceBp: 1000, extraPerLevelBp: 5000, rankOfUser: () => 1, rankOfLevel: () => 2 });
    expect(cr[0]!.split).toEqual({ base: 10, onTime: 2, adherence: 1, above: 6.5 });
    const m = pointsBySource({ journey: cr, events: [{ userId: 'u', type: 'proposta_enviada', kind: 'direto', points: 3 }, { userId: 'u', type: 'negociacao_ganha', kind: 'participacao', points: 2 }], support: [{ userId: 'u', role: 'apoiou', points: 4 }], certificates: [{ userId: 'u', points: 12 }] }).get('u')!;
    expect(m).toMatchObject({ tarefas: 10, pontualidade: 2, aderencia: 1, acima_alcada: 6.5, 'evento:proposta_enviada': 3, participacao: 2, apoio_dado: 4, certificados: 12 });
  });
});
