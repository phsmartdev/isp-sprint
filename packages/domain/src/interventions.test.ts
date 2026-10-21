import { describe, expect, it } from 'vitest';
import { escalationLevel, interventionAction, interventionNeed, validateInterventionConfig, DEFAULT_INTERVENTION_CONFIG } from './interventions';

describe('intervenções', () => {
  it('vermelho pede plano; primeiro amarelo pede revisão; dois amarelos seguidos pedem plano', () => {
    expect(interventionNeed([{ competencia: '2026-09', color: 'vermelho' }])).toMatchObject({ kind: 'plano', trigger: 'vermelho' });
    expect(interventionNeed([{ competencia: '2026-08', color: 'verde' }, { competencia: '2026-09', color: 'amarelo' }])).toMatchObject({ kind: 'revisao', trigger: 'primeiro_amarelo' });
    expect(interventionNeed([{ competencia: '2026-08', color: 'amarelo' }, { competencia: '2026-09', color: 'amarelo' }])).toMatchObject({ kind: 'plano', trigger: 'amarelos_consecutivos' });
    expect(interventionNeed([{ competencia: '2026-12', color: 'amarelo' }, { competencia: '2027-01', color: 'amarelo' }])).toMatchObject({ kind: 'plano' });
  });
  it('amarelos não consecutivos, verde e sem dado', () => {
    expect(interventionNeed([{ competencia: '2026-06', color: 'amarelo' }, { competencia: '2026-09', color: 'amarelo' }])).toMatchObject({ kind: 'revisao' });
    expect(interventionNeed([{ competencia: '2026-09', color: 'verde' }])).toBeNull();
    expect(interventionNeed([{ competencia: '2026-09', color: 'sem_dado' }])).toBeNull();
    expect(interventionNeed([])).toBeNull();
  });
  it('não duplica: reincidência e promoção', () => {
    const plano = interventionNeed([{ competencia: '2026-10', color: 'vermelho' }]);
    expect(interventionAction(plano, null)).toMatchObject({ do: 'criar', kind: 'plano' });
    expect(interventionAction(plano, { kind: 'plano', competencias: ['2026-10'] })).toEqual({ do: 'nada' });
    expect(interventionAction(plano, { kind: 'plano', competencias: ['2026-09'] })).toMatchObject({ do: 'reincidencia' });
    expect(interventionAction(plano, { kind: 'revisao', competencias: ['2026-09'] })).toMatchObject({ do: 'promover' });
    expect(interventionAction(plano, { kind: 'revisao', competencias: ['2026-10'] })).toMatchObject({ do: 'promover' });
    expect(interventionAction(null, { kind: 'plano', competencias: ['2026-09'] })).toEqual({ do: 'nada' });
  });
  it('escalonamento por atraso, limitado à cadeia', () => {
    expect(escalationLevel('2026-10-10', '2026-10-10', 2, 3)).toBe(0);
    expect(escalationLevel('2026-10-10', '2026-10-11', 2, 3)).toBe(1);
    expect(escalationLevel('2026-10-10', '2026-10-12', 2, 3)).toBe(1);
    expect(escalationLevel('2026-10-10', '2026-10-13', 2, 3)).toBe(2);
    expect(escalationLevel('2026-10-10', '2026-12-31', 2, 3)).toBe(3);
    expect(escalationLevel('2026-10-10', '2026-12-31', 2, 0)).toBe(0);
  });
  it('configuração', () => {
    expect(validateInterventionConfig(DEFAULT_INTERVENTION_CONFIG)).toEqual([]);
    expect(validateInterventionConfig({ planDays: 0, reviewDays: 3, escalateAfterDays: 99 }).length).toBe(2);
  });
});
