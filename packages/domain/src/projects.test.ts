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

describe('Fase 2: riscos, homologação e frentes', () => {
  it('nível do risco pela matriz; alto ou crítico exige mitigação', async () => {
    const { riskLevel, riskErrors } = await import('./projects');
    expect(riskLevel('baixa', 'baixo')).toBe('baixo');
    expect(riskLevel('media', 'medio')).toBe('moderado');
    expect(riskLevel('alta', 'medio')).toBe('alto');
    expect(riskLevel('alta', 'alto')).toBe('critico');
    expect(riskErrors({ title: 'Atraso no ERP', mitigation: null, status: 'aberto', probability: 'alta', impact: 'alto' })[0]).toMatch(/mitigação/);
    expect(riskErrors({ title: 'Atraso no ERP', mitigation: null, status: 'aberto', probability: 'baixa', impact: 'alto' })).toEqual([]);
  });
  it('homologação: só concluído, exige homologação, não pelo autor, com evidência', async () => {
    const { homologationError } = await import('./projects');
    const m = { completedAt: '2026-10-20T10:00:00Z', completedBy: 'u1', requiresHomologation: true, homologatedAt: null };
    expect(homologationError(m, 'u1', 'ok, conferido', 'homologado')).toMatch(/próprio trabalho/);
    expect(homologationError({ ...m, completedAt: null }, 'u2', 'ok, conferido', 'homologado')).toMatch(/Conclua/);
    expect(homologationError(m, 'u2', 'curto', 'reprovado')).toMatch(/o que falta/);
    expect(homologationError(m, 'u2', 'Termo assinado', 'homologado')).toBeNull();
    expect(homologationError({ ...m, requiresHomologation: false }, 'u2', 'Termo assinado', 'homologado')).toMatch(/não exige/);
  });
  it('resumo da frente: progresso por homologados, homologação pendente vem antes, depois a tarefa mais urgente', async () => {
    const { frontSummary, instantiateTemplate, BUILTIN_PROJECT_TEMPLATES } = await import('./projects');
    const ms = [
      { id: 'm1', name: 'Configuração', dueOn: '2026-10-10', position: 0, completedAt: '2026-10-09', requiresHomologation: true, homologatedAt: '2026-10-10' },
      { id: 'm2', name: 'Ajustes', dueOn: '2026-10-20', position: 1, completedAt: null, requiresHomologation: true, homologatedAt: null },
      { id: 'm3', name: 'Testes', dueOn: '2026-10-30', position: 2, completedAt: null, requiresHomologation: true, homologatedAt: null },
    ];
    const tasks = [{ id: 't1', title: 'Ajuste B', milestoneId: 'm2', done: false, dueOn: '2026-10-25' }, { id: 't2', title: 'Ajuste A', milestoneId: 'm2', done: false, dueOn: '2026-10-18' }];
    const s = frontSummary(ms, tasks, [{ severity: 'alta', open: true }, { severity: 'media', open: false }], [{ level: 'critico', open: true }], '2026-10-22');
    expect(s.progress).toEqual({ done: 1, total: 3, pct: 33, basis: 'homologados' });
    expect(s.current).toEqual({ id: 'm2', name: 'Ajustes', dueOn: '2026-10-20', late: true });
    expect(s.nextAction).toMatchObject({ kind: 'tarefa', text: 'Ajuste A' });
    expect(s.impediments).toEqual({ open: 1, high: 1 });
    expect(s.risks).toEqual({ open: 1, high: 1 });
    const pend = frontSummary([{ ...ms[0]!, homologatedAt: null }, ms[1]!], tasks, [], [], '2026-10-22');
    expect(pend.nextAction).toEqual({ kind: 'homologar', text: 'Homologar "Configuração"' });
    expect(pend.progress.done).toBe(0);
    const inst = instantiateTemplate(BUILTIN_PROJECT_TEMPLATES.find((t) => t.key === 'implantacao_modulo')!.def, '2026-11-02');
    expect(inst.milestones).toHaveLength(6);
    expect(inst.milestones.every((m) => m.homologation && m.acceptanceCriteria)).toBe(true);
  });
});
