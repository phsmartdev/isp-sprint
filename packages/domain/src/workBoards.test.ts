import { describe, expect, it } from 'vitest';
import { analyzeFuraFila, boardColumn, boardOfTask, dependencyAtRisk, dependencyState, taskCategory, taskOrigin, weekStart, type FuraFilaCandidate } from './workBoards';

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

describe('fura-fila: ordem de consumo (exemplos da especificação, Sprint de 100h sem nada executado)', () => {
  const h = (n: number) => n * 60;
  // 70h comercial (7×10h), 20h interno (2×10h), 10h hipótese (2×5h)
  const cands: FuraFilaCandidate[] = [
    ...Array.from({ length: 7 }, (_, k) => ({ id: `c${k}`, category: 'comercial' as const, remainingMinutes: h(10), protectedCommitment: false, done: false })),
    { id: 'i0', category: 'interno', remainingMinutes: h(10), protectedCommitment: false, done: false },
    { id: 'i1', category: 'interno', remainingMinutes: h(10), protectedCommitment: false, done: false },
    { id: 'h0', category: 'hipotese', remainingMinutes: h(5), protectedCommitment: false, done: false },
    { id: 'h1', category: 'hipotese', remainingMinutes: h(5), protectedCommitment: false, done: false },
  ];
  it('A — 8h: só hipóteses, preserva internas e comercial', () => {
    const a = analyzeFuraFila({ neededMinutes: h(8), freeMinutes: 0, candidates: cands });
    expect(a.suggestedIds.sort()).toEqual(['h0', 'h1']);
    expect(a).toMatchObject({ sufficient: true, requiresManagerApproval: false, issues: [] });
    expect(a.selected).toEqual({ hipotese: h(10), interno: 0, comercial: 0 });
  });
  it('B — 15h: hipóteses e internas, preserva o comercial', () => {
    const a = analyzeFuraFila({ neededMinutes: h(15), freeMinutes: 0, candidates: cands });
    expect(a.selected.comercial).toBe(0);
    expect(a.selected.hipotese).toBe(h(10));
    expect(a.selected.interno).toBeGreaterThan(0);
    expect(a).toMatchObject({ sufficient: true, requiresManagerApproval: false });
  });
  it('C — 35h: chega ao comercial e exige aprovação da gerência', () => {
    const a = analyzeFuraFila({ neededMinutes: h(35), freeMinutes: 0, candidates: cands });
    expect(a.selected).toMatchObject({ hipotese: h(10), interno: h(20) });
    expect(a.selected.comercial).toBeGreaterThan(0);
    expect(a).toMatchObject({ sufficient: true, requiresManagerApproval: true, issues: [] });
  });
  it('capacidade livre primeiro: nada é deslocado', () => {
    const a = analyzeFuraFila({ neededMinutes: h(4), freeMinutes: h(6), candidates: cands });
    expect(a).toMatchObject({ freeUsedMinutes: h(4), toRecoverMinutes: 0, suggestedIds: [], sufficient: true });
    expect(analyzeFuraFila({ neededMinutes: h(4), freeMinutes: h(6), candidates: cands, selectedIds: ['h0'] }).issues[0]).toContain('capacidade livre');
  });
  it('pular a ordem é recusado; protegido e concluído não entram', () => {
    expect(analyzeFuraFila({ neededMinutes: h(8), freeMinutes: 0, candidates: cands, selectedIds: ['c0'] }).issues.join()).toContain('Ordem de consumo');
    const prot = cands.map((c) => (c.id === 'h0' ? { ...c, protectedCommitment: true } : c.id === 'h1' ? { ...c, done: true } : c));
    const a = analyzeFuraFila({ neededMinutes: h(8), freeMinutes: 0, candidates: prot });
    expect(a.recoverable.hipotese).toBe(0);
    expect(a.suggestedIds).toEqual(['i0']);
    expect(a.blocked.map((b) => b.id).sort()).toEqual(['h0', 'h1']);
    expect(analyzeFuraFila({ neededMinutes: h(8), freeMinutes: 0, candidates: prot, selectedIds: ['h0'] }).issues.join()).toContain('protegido');
  });
  it('sem capacidade suficiente: fica aguardando decisão', () => {
    const a = analyzeFuraFila({ neededMinutes: h(200), freeMinutes: 0, candidates: cands });
    expect(a.sufficient).toBe(false);
  });
});

describe('dependências: situação e risco de atraso', () => {
  const today = '2030-03-10';
  it('classifica a predecessora frente ao prazo da dependente', () => {
    expect(dependencyState({ status: 'concluida', dueDay: '2030-03-01' }, '2030-03-05', today)).toBe('concluida');
    expect(dependencyState({ status: 'a_fazer', dueDay: '2030-03-09' }, '2030-03-20', today)).toBe('atrasada');
    expect(dependencyState({ status: 'a_fazer', dueDay: '2030-03-20' }, '2030-03-15', today)).toBe('em_risco');
    expect(dependencyState({ status: 'a_fazer', dueDay: '2030-03-15' }, '2030-03-15', today)).toBe('em_risco');
    expect(dependencyState({ status: 'a_fazer', dueDay: '2030-03-12' }, '2030-03-15', today)).toBe('no_prazo');
    expect(dependencyState({ status: 'a_fazer', dueDay: null }, '2030-03-15', today)).toBe('sem_prazo');
    expect(dependencyAtRisk('em_risco') && dependencyAtRisk('atrasada') && !dependencyAtRisk('sem_prazo')).toBe(true);
  });
});
