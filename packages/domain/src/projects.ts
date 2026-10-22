/**
 * Projetos (Etapa 3 da evolução integrada, 21/10/2026).
 *
 * Um projeto organiza tarefas (as mesmas `activities` do CRM) em etapas de quadro,
 * marcos com data e uma equipe. Modelos geram etapas, marcos e tarefas com datas
 * relativas ao início. Regras puras: o servidor aplica, a tela só mostra.
 */

export const PROJECT_STATUSES = ['planejamento', 'em_andamento', 'pausado', 'concluido', 'cancelado'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planejamento: 'Planejamento',
  em_andamento: 'Em andamento',
  pausado: 'Pausado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};
/** Transições permitidas. Concluído e cancelado reabrem para Em andamento com motivo. */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  planejamento: ['em_andamento', 'cancelado'],
  em_andamento: ['pausado', 'concluido', 'cancelado'],
  pausado: ['em_andamento', 'cancelado'],
  concluido: ['em_andamento'],
  cancelado: ['em_andamento'],
};
export const PROJECT_KINDS = ['implantacao', 'comercial', 'sucesso_cliente', 'interno', 'contrato_publico', 'outro'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  implantacao: 'Implantação',
  comercial: 'Comercial',
  sucesso_cliente: 'Sucesso do Cliente',
  interno: 'Interno',
  contrato_publico: 'Contrato público / ata',
  outro: 'Outro',
};
export const PROJECT_MEMBER_ROLES = ['gerente', 'membro', 'observador'] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];
export const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = { gerente: 'Gerente do projeto', membro: 'Membro', observador: 'Observador' };

export type ProjectTemplateDef = {
  stages: { name: string; done?: boolean }[];
  milestones: { name: string; offsetDays: number; stage?: string; acceptanceCriteria?: string; homologation?: boolean }[];
  tasks: { title: string; stage: string; offsetDays: number; durationDays?: number; milestone?: string; priority?: 'baixa' | 'media' | 'alta'; notes?: string }[];
};

export const DEFAULT_PROJECT_STAGES: ProjectTemplateDef['stages'] = [{ name: 'A fazer' }, { name: 'Em execução' }, { name: 'Em revisão' }, { name: 'Concluído', done: true }];

export const BUILTIN_PROJECT_TEMPLATES: { key: string; name: string; kind: ProjectKind; description: string; def: ProjectTemplateDef }[] = [
  {
    key: 'implantacao_corporativa',
    name: 'Implantação de cliente corporativo',
    kind: 'implantacao',
    description: 'Do contrato assinado à ativação e ao aceite: vistoria, projeto técnico, obra, ativação e entrega ao Sucesso do Cliente.',
    def: {
      stages: [{ name: 'Planejamento' }, { name: 'Execução' }, { name: 'Validação' }, { name: 'Concluído', done: true }],
      milestones: [
        { name: 'Kickoff realizado', offsetDays: 3 },
        { name: 'Infraestrutura pronta', offsetDays: 20 },
        { name: 'Serviço ativado', offsetDays: 30 },
        { name: 'Aceite do cliente', offsetDays: 35 },
      ],
      tasks: [
        { title: 'Agendar kickoff com o cliente', stage: 'Planejamento', offsetDays: 0, durationDays: 3, milestone: 'Kickoff realizado', priority: 'alta' },
        { title: 'Vistoria técnica no endereço', stage: 'Planejamento', offsetDays: 3, durationDays: 4, milestone: 'Infraestrutura pronta' },
        { title: 'Projeto técnico e lista de materiais', stage: 'Planejamento', offsetDays: 7, durationDays: 4, milestone: 'Infraestrutura pronta' },
        { title: 'Obra de rede / lançamento de cabo', stage: 'Execução', offsetDays: 11, durationDays: 9, milestone: 'Infraestrutura pronta' },
        { title: 'Configuração e ativação do serviço', stage: 'Execução', offsetDays: 20, durationDays: 10, milestone: 'Serviço ativado', priority: 'alta' },
        { title: 'Teste de aceite com o cliente', stage: 'Validação', offsetDays: 30, durationDays: 5, milestone: 'Aceite do cliente' },
        { title: 'Entregar conta ao Sucesso do Cliente', stage: 'Validação', offsetDays: 35, durationDays: 2 },
      ],
    },
  },
  {
    key: 'execucao_ata',
    name: 'Execução de ata de registro de preços',
    kind: 'contrato_publico',
    description: 'Adesão, empenho, instalação, medição e faturamento de um órgão sobre uma ata.',
    def: {
      stages: [{ name: 'Documentação' }, { name: 'Execução' }, { name: 'Medição e faturamento' }, { name: 'Concluído', done: true }],
      milestones: [
        { name: 'Adesão autorizada', offsetDays: 10 },
        { name: 'Empenho recebido', offsetDays: 20 },
        { name: 'Instalação concluída', offsetDays: 50 },
        { name: 'Primeira medição faturada', offsetDays: 65 },
      ],
      tasks: [
        { title: 'Ofício de solicitação de adesão', stage: 'Documentação', offsetDays: 0, durationDays: 5, milestone: 'Adesão autorizada' },
        { title: 'Anuência do fornecedor e do gerenciador', stage: 'Documentação', offsetDays: 5, durationDays: 5, milestone: 'Adesão autorizada' },
        { title: 'Acompanhar emissão do empenho', stage: 'Documentação', offsetDays: 10, durationDays: 10, milestone: 'Empenho recebido' },
        { title: 'Ordem de serviço e instalação', stage: 'Execução', offsetDays: 20, durationDays: 30, milestone: 'Instalação concluída', priority: 'alta' },
        { title: 'Relatório de medição', stage: 'Medição e faturamento', offsetDays: 50, durationDays: 10, milestone: 'Primeira medição faturada' },
        { title: 'Emitir nota e registrar faturamento na ata', stage: 'Medição e faturamento', offsetDays: 60, durationDays: 5, milestone: 'Primeira medição faturada' },
      ],
    },
  },
  {
    key: 'implantacao_modulo',
    name: 'Implantação de módulo do ISP Sprint',
    kind: 'implantacao',
    description: 'Uma frente da implantação modular: configuração, ajustes, testes, homologação com usuários, entrada em produção e acompanhamento. Cada marco tem critério de aceite e precisa ser homologado.',
    def: {
      stages: [{ name: 'Planejamento' }, { name: 'Execução' }, { name: 'Testes e homologação' }, { name: 'Concluído', done: true }],
      milestones: [
        { name: 'Diagnóstico e configuração', offsetDays: 7, homologation: true, acceptanceCriteria: 'Cadastros reais, usuários, setores e permissões do módulo configurados; checklist de configuração completo.' },
        { name: 'Ajustes', offsetDays: 21, homologation: true, acceptanceCriteria: 'Itens de corrigir, complementar e desenvolver da frente entregues; regressão completa verde e implantação em produção.' },
        { name: 'Testes', offsetDays: 28, homologation: true, acceptanceCriteria: 'Roteiros de teste do módulo executados com os perfis reais, sem erro bloqueante.' },
        { name: 'Homologação com usuários', offsetDays: 35, homologation: true, acceptanceCriteria: 'Usuários representativos executaram os processos com dados reais; termo de homologação registrado.' },
        { name: 'Entrada em produção', offsetDays: 38, homologation: true, acceptanceCriteria: 'Módulo ligado para os usuários definidos e carga da base conferida.' },
        { name: 'Acompanhamento de 30 dias', offsetDays: 68, homologation: true, acceptanceCriteria: 'Nenhum impedimento aberto de prioridade alta ao fim de 30 dias de uso.' },
      ],
      tasks: [
        { title: 'Levantar cadastros, usuários e permissões do módulo', stage: 'Planejamento', offsetDays: 0, durationDays: 4, milestone: 'Diagnóstico e configuração', priority: 'alta' },
        { title: 'Configurar o módulo e registrar o checklist', stage: 'Planejamento', offsetDays: 4, durationDays: 3, milestone: 'Diagnóstico e configuração' },
        { title: 'Executar os ajustes da frente (um por tarefa)', stage: 'Execução', offsetDays: 7, durationDays: 14, milestone: 'Ajustes', priority: 'alta' },
        { title: 'Escrever e executar os roteiros de teste', stage: 'Testes e homologação', offsetDays: 21, durationDays: 7, milestone: 'Testes' },
        { title: 'Sessões de homologação com usuários representativos', stage: 'Testes e homologação', offsetDays: 28, durationDays: 7, milestone: 'Homologação com usuários', priority: 'alta' },
        { title: 'Ligar o módulo e conferir a carga', stage: 'Execução', offsetDays: 35, durationDays: 3, milestone: 'Entrada em produção', priority: 'alta' },
        { title: 'Acompanhar uso e tratar pendências', stage: 'Execução', offsetDays: 38, durationDays: 30, milestone: 'Acompanhamento de 30 dias' },
      ],
    },
  },
  {
    key: 'interno_simples',
    name: 'Projeto interno',
    kind: 'interno',
    description: 'Quadro simples para iniciativas internas: a fazer, em execução, em revisão e concluído.',
    def: { stages: DEFAULT_PROJECT_STAGES, milestones: [], tasks: [] },
  },
];

/** Valida um modelo antes de gravar. Retorna a lista de problemas (vazia = válido). */
export function validateTemplate(def: ProjectTemplateDef): string[] {
  const errs: string[] = [];
  const names = def.stages.map((s) => s.name.trim());
  if (!names.length) errs.push('O modelo precisa de pelo menos uma etapa.');
  if (names.some((n) => !n)) errs.push('Toda etapa precisa de nome.');
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) errs.push('Há etapas com o mesmo nome.');
  if (def.stages.length > 12) errs.push('No máximo 12 etapas.');
  const ms = new Set(def.milestones.map((m) => m.name.trim().toLowerCase()));
  if (ms.size !== def.milestones.length) errs.push('Há marcos com o mesmo nome.');
  for (const m of def.milestones) {
    if (!m.name.trim()) errs.push('Todo marco precisa de nome.');
    if (!Number.isInteger(m.offsetDays) || m.offsetDays < 0) errs.push(`Marco "${m.name}": dias a partir do início deve ser inteiro ≥ 0.`);
  }
  for (const t of def.tasks) {
    if (!t.title.trim()) errs.push('Toda tarefa precisa de título.');
    if (!names.some((n) => n.toLowerCase() === t.stage.trim().toLowerCase())) errs.push(`Tarefa "${t.title}": etapa "${t.stage}" não existe no modelo.`);
    if (t.milestone && !ms.has(t.milestone.trim().toLowerCase())) errs.push(`Tarefa "${t.title}": marco "${t.milestone}" não existe no modelo.`);
    if (!Number.isInteger(t.offsetDays) || t.offsetDays < 0) errs.push(`Tarefa "${t.title}": dias a partir do início deve ser inteiro ≥ 0.`);
    if (t.durationDays !== undefined && (!Number.isInteger(t.durationDays) || t.durationDays < 0)) errs.push(`Tarefa "${t.title}": duração deve ser inteira ≥ 0.`);
  }
  return errs;
}

export const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Instancia o modelo a partir da data de início. Datas de tarefa: início = início + offset; prazo = início + offset + duração. */
export function instantiateTemplate(def: ProjectTemplateDef, startOn: string) {
  const stages = def.stages.map((s, i) => ({ name: s.name.trim(), position: i, done: !!s.done }));
  if (!stages.some((s) => s.done) && stages.length) stages[stages.length - 1]!.done = true;
  const milestones = def.milestones.map((m, i) => ({ name: m.name.trim(), dueOn: addDaysIso(startOn, m.offsetDays), position: i, acceptanceCriteria: m.acceptanceCriteria?.trim() || null, homologation: !!m.homologation }));
  const tasks = def.tasks.map((t, i) => ({
    title: t.title.trim(),
    stage: stages.find((s) => s.name.toLowerCase() === t.stage.trim().toLowerCase())!.name,
    milestone: t.milestone ? milestones.find((m) => m.name.toLowerCase() === t.milestone!.trim().toLowerCase())?.name ?? null : null,
    startOn: addDaysIso(startOn, t.offsetDays),
    dueOn: addDaysIso(startOn, t.offsetDays + (t.durationDays ?? 0)),
    priority: t.priority ?? 'media',
    notes: t.notes ?? null,
    position: i,
  }));
  const dueOn = [...milestones.map((m) => m.dueOn), ...tasks.map((t) => t.dueOn)].sort().at(-1) ?? null;
  return { stages, milestones, tasks, dueOn };
}

/** Converte um projeto existente em modelo (datas viram dias a partir do início). */
export function templateFromProject(p: {
  startOn: string;
  stages: { id: string; name: string; done: boolean }[];
  milestones: { id: string; name: string; dueOn: string | null; acceptanceCriteria?: string | null; requiresHomologation?: boolean }[];
  tasks: { title: string; stageId: string | null; milestoneId: string | null; startOn: string | null; dueOn: string | null; priority: string; notes: string | null }[];
}): ProjectTemplateDef {
  const diff = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${p.startOn}T12:00:00Z`)) / 86_400_000)) : 0);
  const stageName = (id: string | null) => p.stages.find((s) => s.id === id)?.name ?? p.stages[0]?.name ?? 'A fazer';
  return {
    stages: p.stages.map((s) => ({ name: s.name, done: s.done })),
    milestones: p.milestones.map((m) => ({ name: m.name, offsetDays: diff(m.dueOn), ...(m.acceptanceCriteria ? { acceptanceCriteria: m.acceptanceCriteria } : {}), ...(m.requiresHomologation ? { homologation: true } : {}) })),
    tasks: p.tasks.map((t) => {
      const off = diff(t.startOn ?? t.dueOn);
      return {
        title: t.title,
        stage: stageName(t.stageId),
        offsetDays: off,
        durationDays: Math.max(0, diff(t.dueOn) - off),
        milestone: p.milestones.find((m) => m.id === t.milestoneId)?.name,
        priority: (['baixa', 'media', 'alta'].includes(t.priority) ? t.priority : 'media') as 'baixa' | 'media' | 'alta',
        notes: t.notes ?? undefined,
      };
    }),
  };
}

export type ProjectHealth = 'em_dia' | 'atencao' | 'atrasado' | 'concluido';
export const PROJECT_HEALTH_LABELS: Record<ProjectHealth, string> = { em_dia: 'Em dia', atencao: 'Atenção', atrasado: 'Atrasado', concluido: 'Concluído' };

/**
 * Progresso e saúde. Progresso = tarefas concluídas / tarefas (marcos contam como tarefa quando não há tarefas).
 * Saúde: atrasado se algum marco aberto ou o próprio projeto passou do prazo; atenção se há tarefa atrasada
 * ou marco aberto nos próximos 3 dias com tarefa pendente; senão em dia.
 */
export function projectProgress(
  p: { status: ProjectStatus; dueOn: string | null },
  tasks: { done: boolean; dueOn: string | null; milestoneId?: string | null }[],
  milestones: { id: string; dueOn: string | null; done: boolean }[],
  today: string,
) {
  const total = tasks.length || milestones.length;
  const done = tasks.length ? tasks.filter((t) => t.done).length : milestones.filter((m) => m.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const lateTasks = tasks.filter((t) => !t.done && t.dueOn && t.dueOn < today).length;
  const lateMilestones = milestones.filter((m) => !m.done && m.dueOn && m.dueOn < today).length;
  const soon = addDaysIso(today, 3);
  const pendingSoon = milestones.some((m) => !m.done && m.dueOn && m.dueOn >= today && m.dueOn <= soon && tasks.some((t) => t.milestoneId === m.id && !t.done));
  let health: ProjectHealth;
  const reasons: string[] = [];
  if (p.status === 'concluido') health = 'concluido';
  else {
    if (lateMilestones) reasons.push(`${lateMilestones} marco(s) vencido(s)`);
    if (p.dueOn && p.dueOn < today && p.status !== 'cancelado') reasons.push('prazo do projeto vencido');
    if (lateTasks) reasons.push(`${lateTasks} tarefa(s) atrasada(s)`);
    if (pendingSoon) reasons.push('marco nos próximos 3 dias com tarefa pendente');
    health = lateMilestones || (p.dueOn && p.dueOn < today) ? 'atrasado' : lateTasks || pendingSoon ? 'atencao' : 'em_dia';
  }
  return { total, done, pct, lateTasks, lateMilestones, health, reasons };
}

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus) {
  return PROJECT_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------- Etapa 1 · Fase 2: riscos, impedimentos, homologação e frentes

export const RISK_PROBABILITIES = ['baixa', 'media', 'alta'] as const;
export type RiskProbability = (typeof RISK_PROBABILITIES)[number];
export const RISK_PROBABILITY_LABELS: Record<RiskProbability, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };
export const RISK_IMPACTS = ['baixo', 'medio', 'alto'] as const;
export type RiskImpact = (typeof RISK_IMPACTS)[number];
export const RISK_IMPACT_LABELS: Record<RiskImpact, string> = { baixo: 'Baixo', medio: 'Médio', alto: 'Alto' };
export const RISK_STATUSES = ['aberto', 'em_mitigacao', 'ocorrido', 'encerrado'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const RISK_STATUS_LABELS: Record<RiskStatus, string> = { aberto: 'Aberto', em_mitigacao: 'Em mitigação', ocorrido: 'Ocorreu', encerrado: 'Encerrado' };
export const OPEN_RISK: RiskStatus[] = ['aberto', 'em_mitigacao', 'ocorrido'];
export type RiskLevel = 'baixo' | 'moderado' | 'alto' | 'critico';
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = { baixo: 'Baixo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico' };

/** Matriz 3×3: probabilidade × impacto. Pontos 1–9 → baixo (1–2), moderado (3–4), alto (6), crítico (9). */
export function riskLevel(p: RiskProbability, i: RiskImpact): RiskLevel {
  const score = (RISK_PROBABILITIES.indexOf(p) + 1) * (RISK_IMPACTS.indexOf(i) + 1);
  return score >= 9 ? 'critico' : score >= 6 ? 'alto' : score >= 3 ? 'moderado' : 'baixo';
}
export function riskErrors(r: { title: string; mitigation: string | null; status: RiskStatus; probability: RiskProbability; impact: RiskImpact }) {
  const e: string[] = [];
  if (r.title.trim().length < 5) e.push('Descreva o risco (pelo menos 5 caracteres).');
  const lvl = riskLevel(r.probability, r.impact);
  if ((lvl === 'alto' || lvl === 'critico') && (r.mitigation ?? '').trim().length < 10) e.push('Risco alto ou crítico precisa de plano de mitigação (pelo menos 10 caracteres).');
  return e;
}

export const HOMOLOGATION_DECISIONS = ['homologado', 'reprovado'] as const;
export type HomologationDecision = (typeof HOMOLOGATION_DECISIONS)[number];

/** Quem concluiu o marco não homologa o próprio trabalho; só marco concluído, que exige homologação e ainda não foi homologado. */
export function homologationError(m: { completedAt: string | null; completedBy: string | null; requiresHomologation: boolean; homologatedAt: string | null }, actorId: string, note: string, decision: HomologationDecision) {
  if (!m.requiresHomologation) return 'Este marco não exige homologação.';
  if (!m.completedAt) return 'Conclua o marco antes de homologar.';
  if (m.homologatedAt) return 'Este marco já foi homologado.';
  if (m.completedBy === actorId) return 'Quem concluiu o marco não pode homologar o próprio trabalho.';
  if (note.trim().length < (decision === 'reprovado' ? 10 : 5)) return decision === 'reprovado' ? 'Diga o que falta para homologar (pelo menos 10 caracteres).' : 'Registre a evidência da homologação (pelo menos 5 caracteres).';
  return null;
}

export type FrontMilestone = { id: string; name: string; dueOn: string | null; position: number; completedAt: string | null; requiresHomologation: boolean; homologatedAt: string | null };
export type FrontSummary = {
  progress: { done: number; total: number; pct: number; basis: 'homologados' | 'concluidos' };
  current: { id: string; name: string; dueOn: string | null; late: boolean } | null;
  pendingHomologation: { id: string; name: string }[];
  nextAction: { kind: 'tarefa' | 'concluir_marco' | 'homologar' | 'nenhuma'; text: string; taskId?: string; dueOn?: string | null; ownerName?: string | null };
  impediments: { open: number; high: number };
  risks: { open: number; high: number };
};

/**
 * Resumo de uma frente para o painel. Progresso real = marcos homologados ÷ marcos que exigem homologação
 * (sem marcos de homologação: concluídos ÷ marcos). Próxima ação: homologação pendente vem primeiro (destrava o
 * avanço), depois a tarefa aberta mais urgente do marco atual, depois "concluir o marco".
 */
export function frontSummary(
  milestones: FrontMilestone[],
  tasks: { id: string; title: string; milestoneId: string | null; done: boolean; dueOn: string | null; ownerName?: string | null }[],
  impediments: { severity: string; open: boolean }[],
  risks: { level: RiskLevel; open: boolean }[],
  today: string,
): FrontSummary {
  const ms = [...milestones].sort((a, b) => a.position - b.position);
  const homol = ms.filter((m) => m.requiresHomologation);
  const basis = homol.length ? 'homologados' : 'concluidos';
  const counted = homol.length ? homol : ms;
  const done = counted.filter((m) => (homol.length ? !!m.homologatedAt : !!m.completedAt)).length;
  const isDone = (m: FrontMilestone) => (m.requiresHomologation ? !!m.homologatedAt : !!m.completedAt);
  const cur = ms.find((m) => !isDone(m)) ?? null;
  const pending = ms.filter((m) => m.requiresHomologation && m.completedAt && !m.homologatedAt).map((m) => ({ id: m.id, name: m.name }));
  let nextAction: FrontSummary['nextAction'] = { kind: 'nenhuma', text: 'Todos os marcos concluídos.' };
  if (pending.length) nextAction = { kind: 'homologar', text: `Homologar "${pending[0]!.name}"` };
  else if (cur) {
    const open = tasks.filter((t) => t.milestoneId === cur.id && !t.done).sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));
    nextAction = open[0] ? { kind: 'tarefa', text: open[0].title, taskId: open[0].id, dueOn: open[0].dueOn, ownerName: open[0].ownerName ?? null } : { kind: 'concluir_marco', text: `Concluir o marco "${cur.name}"`, dueOn: cur.dueOn };
  }
  return {
    progress: { done, total: counted.length, pct: counted.length ? Math.round((done / counted.length) * 100) : 0, basis },
    current: cur ? { id: cur.id, name: cur.name, dueOn: cur.dueOn, late: !!cur.dueOn && cur.dueOn < today && !cur.completedAt } : null,
    pendingHomologation: pending,
    nextAction,
    impediments: { open: impediments.filter((i) => i.open).length, high: impediments.filter((i) => i.open && i.severity === 'alta').length },
    risks: { open: risks.filter((r) => r.open).length, high: risks.filter((r) => r.open && (r.level === 'alto' || r.level === 'critico')).length },
  };
}

export function frontsErrors(f: { initiative: string; fronts: { name: string; ownerId: string }[] }) {
  const e: string[] = [];
  if (f.initiative.trim().length < 3) e.push('Dê um nome à iniciativa (vira a etiqueta das frentes).');
  if (!f.fronts.length) e.push('Inclua pelo menos uma frente.');
  if (f.fronts.length > 12) e.push('No máximo 12 frentes por vez.');
  for (const x of f.fronts) if (x.name.trim().length < 3) e.push('Toda frente precisa de nome.');
  if (new Set(f.fronts.map((x) => x.name.trim().toLowerCase())).size !== f.fronts.length) e.push('Há frentes com o mesmo nome.');
  return e;
}
