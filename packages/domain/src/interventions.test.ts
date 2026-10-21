import { describe, expect, it } from 'vitest';
import { actionTaskNotes, planConclusionBlockers, planProgress, validateW2H, escalationLevel, interventionAction, interventionNeed, validateInterventionConfig, DEFAULT_INTERVENTION_CONFIG } from './interventions';

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

describe('plano 5W2H', () => {
  const st = (status: 'a_fazer' | 'concluida' | 'cancelada', dueOn: string | null = '2026-10-10') => ({ status, dueOn });
  it('andamento conta concluídas sobre as válidas e atrasadas pelo prazo', () => {
    expect(planProgress([st('concluida'), st('a_fazer'), st('cancelada'), st('a_fazer', '2026-12-01')], '2026-10-20')).toEqual({ total: 4, done: 1, cancelled: 1, open: 2, overdue: 1, pct: 1 / 3 });
    expect(planProgress([], '2026-10-20').pct).toBe(0);
  });
  it('conclusão exige nenhuma ação aberta e ao menos uma executada', () => {
    expect(planConclusionBlockers([])).toHaveLength(1);
    expect(planConclusionBlockers([st('concluida'), st('a_fazer')])[0]).toMatch(/1 ação/);
    expect(planConclusionBlockers([st('cancelada')])[0]).toMatch(/Nenhuma ação/);
    expect(planConclusionBlockers([st('concluida'), st('cancelada')])).toEqual([]);
  });
  it('valida a ação e escreve a tarefa com as sete respostas', () => {
    const a = { what: 'Plantão de suporte', why: 'Triagem inexistente', where: 'Central', whenDue: '2026-11-05', how: 'Escala semanal', howMuchCents: 50000 };
    expect(validateW2H({ ...a, whoId: 'u' }, '2026-10-21')).toEqual([]);
    expect(validateW2H({ ...a, whoId: null, whenDue: '2026-10-01', what: 'x' }, '2026-10-21').map((e) => e.path)).toEqual(['what', 'whoId', 'whenDue']);
    const n = actionTaskNotes({ ...a, whoName: 'Ana' }, 'Visitas');
    expect(n).toContain('Quando: até 05/11/2026');
    expect(n).toMatch(/Quanto: R\$\s?500,00/);
  });
});
