import { describe, expect, it } from 'vitest';
import { BUILTIN_PROJECT_TEMPLATES, canTransitionProject, instantiateTemplate, projectProgress, templateFromProject, validateTemplate } from './projects';

describe('projetos', () => {
  it('modelos embutidos são válidos', () => {
    for (const t of BUILTIN_PROJECT_TEMPLATES) expect(validateTemplate(t.def)).toEqual([]);
  });
  it('valida etapas, marcos e referências das tarefas', () => {
    const errs = validateTemplate({ stages: [{ name: 'A' }, { name: 'a' }], milestones: [{ name: 'M', offsetDays: -1 }], tasks: [{ title: 'T', stage: 'X', offsetDays: 0, milestone: 'Z' }] });
    expect(errs.join(' ')).toMatch(/mesmo nome/);
    expect(errs.join(' ')).toMatch(/inteiro ≥ 0/);
    expect(errs.join(' ')).toMatch(/etapa "X"/);
    expect(errs.join(' ')).toMatch(/marco "Z"/);
  });
  it('instancia datas a partir do início e marca a última etapa como concluída', () => {
    const r = instantiateTemplate({ stages: [{ name: 'A' }, { name: 'B' }], milestones: [{ name: 'M', offsetDays: 10 }], tasks: [{ title: 'T', stage: 'b', offsetDays: 2, durationDays: 3, milestone: 'm' }] }, '2026-10-30');
    expect(r.stages[1]!.done).toBe(true);
    expect(r.milestones[0]!.dueOn).toBe('2026-11-09');
    expect(r.tasks[0]).toMatchObject({ stage: 'B', milestone: 'M', startOn: '2026-11-01', dueOn: '2026-11-04' });
    expect(r.dueOn).toBe('2026-11-09');
  });
  it('projeto vira modelo com dias relativos', () => {
    const def = templateFromProject({ startOn: '2026-10-01', stages: [{ id: 's1', name: 'A', done: false }, { id: 's2', name: 'B', done: true }], milestones: [{ id: 'm1', name: 'M', dueOn: '2026-10-11' }], tasks: [{ title: 'T', stageId: 's1', milestoneId: 'm1', startOn: '2026-10-03', dueOn: '2026-10-05', priority: 'alta', notes: null }] });
    expect(def.milestones[0]!.offsetDays).toBe(10);
    expect(def.tasks[0]).toMatchObject({ stage: 'A', offsetDays: 2, durationDays: 2, milestone: 'M', priority: 'alta' });
    expect(validateTemplate(def)).toEqual([]);
  });
  it('saúde: atrasado com marco vencido, atenção com tarefa atrasada', () => {
    const p = { status: 'em_andamento' as const, dueOn: '2026-12-31' };
    expect(projectProgress(p, [{ done: true, dueOn: null }, { done: false, dueOn: '2026-10-01' }], [], '2026-10-21')).toMatchObject({ pct: 50, health: 'atencao', lateTasks: 1 });
    expect(projectProgress(p, [], [{ id: 'm', dueOn: '2026-10-20', done: false }], '2026-10-21').health).toBe('atrasado');
    expect(projectProgress({ ...p, status: 'concluido' }, [], [], '2026-10-21').health).toBe('concluido');
  });
  it('transições de status', () => {
    expect(canTransitionProject('planejamento', 'em_andamento')).toBe(true);
    expect(canTransitionProject('planejamento', 'concluido')).toBe(false);
    expect(canTransitionProject('concluido', 'em_andamento')).toBe(true);
  });
});
