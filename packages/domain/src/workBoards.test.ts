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
