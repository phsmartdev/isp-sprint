import { describe, expect, it } from 'vitest';
import { boardColumn, boardOfTask, taskCategory, taskOrigin, weekStart } from './workBoards';

describe('Quadro de Tarefas: regras', () => {
  it('origem preservada pelo registro de origem', () => {
    expect(taskOrigin({ opportunityId: 'o' })).toBe('crm');
    expect(taskOrigin({ opportunityId: 'o', contractId: 'c' })).toBe('contratos');
    expect(taskOrigin({ csKind: 'visita', contractId: 'c' })).toBe('sucesso_cliente');
    expect(taskOrigin({ projectId: 'p' })).toBe('projetos');
    expect(taskOrigin({})).toBe('interna');
  });
  it('ligada a oportunidade nasce comercial; a escolha manual vale; sem oportunidade fica sem categoria', () => {
    expect(taskCategory({ opportunityId: 'o' })).toBe('comercial');
    expect(taskCategory({ opportunityId: 'o', capacityCategory: 'hipotese' })).toBe('hipotese');
    expect(taskCategory({})).toBeNull();
  });
  it('coluna separa execução de planejamento', () => {
    expect(boardColumn({ status: 'a_fazer', planned: false })).toBe('backlog');
    expect(boardColumn({ status: 'a_fazer', planned: true })).toBe('a_fazer');
    expect(boardColumn({ status: 'aguardando', planned: false })).toBe('em_execucao');
    expect(boardColumn({ status: 'em_aprovacao', planned: true })).toBe('em_revisao');
    expect(boardColumn({ status: 'concluida', planned: false })).toBe('concluido');
  });
  it('semana começa na segunda', () => {
    expect(weekStart('2026-11-27')).toBe('2026-11-23');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
  });
  it('quadro: o escolhido na tarefa, senão o da equipe do responsável', () => {
    const boards = [{ key: 'comercial' as const, teamIds: ['t1'] }, { key: 'produto' as const, teamIds: ['t2'] }];
    expect(boardOfTask({ ownerTeamIds: ['t2'] }, boards)).toBe('produto');
    expect(boardOfTask({ boardKey: 'comercial', ownerTeamIds: ['t2'] }, boards)).toBe('comercial');
    expect(boardOfTask({ ownerTeamIds: ['t9'] }, boards)).toBeNull();
  });
});

import { categoryTargets, commitIssues, weekCapacity } from './workBoards';
describe('capacidade semanal', () => {
  const sched = { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 } as const;
  const base = { weekStart: '2026-11-23', schedule: sched, holidays: [], vacations: [], absences: [], allocationBp: 10_000 };
  it('sem jornada cadastrada não há capacidade (não presume)', () => {
    expect(weekCapacity({ ...base, schedule: null })).toBeNull();
    expect(weekCapacity({ ...base, schedule: {} })).toBeNull();
  });
  it('jornada − feriado − férias − ausência parcial', () => {
    expect(weekCapacity(base)!.netMinutes).toBe(2400);
    const r = weekCapacity({ ...base, holidays: ['2026-11-25'], vacations: [{ startDate: '2026-11-27', days: 10 }], absences: [{ startOn: '2026-11-23', endOn: '2026-11-24', minutesPerDay: 120 }] })!;
    expect(r.grossMinutes).toBe(2400);
    expect(r.unavailableMinutes).toBe(480 + 480 + 240);
    expect(r.netMinutes).toBe(1200);
  });
  it('quem divide o tempo entre departamentos entra só com a sua parte', () => {
    expect(weekCapacity({ ...base, allocationBp: 5000 })!.netMinutes).toBe(1200);
  });
  it('meta 70/20/10 e pendências para comprometer', () => {
    expect(categoryTargets(6000, { comercial: 7000, interno: 2000, hipotese: 1000 })).toEqual({ comercial: 4200, interno: 1200, hipotese: 600 });
    expect(commitIssues({ ownerId: 'a', category: null, estimateMinutes: 0 })).toEqual(['sem categoria', 'sem esforço estimado']);
  });
});
