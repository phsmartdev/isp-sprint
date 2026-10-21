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
  milestones: { name: string; offsetDays: number; stage?: string }[];
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
  const milestones = def.milestones.map((m, i) => ({ name: m.name.trim(), dueOn: addDaysIso(startOn, m.offsetDays), position: i }));
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
  milestones: { id: string; name: string; dueOn: string | null }[];
  tasks: { title: string; stageId: string | null; milestoneId: string | null; startOn: string | null; dueOn: string | null; priority: string; notes: string | null }[];
}): ProjectTemplateDef {
  const diff = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${p.startOn}T12:00:00Z`)) / 86_400_000)) : 0);
  const stageName = (id: string | null) => p.stages.find((s) => s.id === id)?.name ?? p.stages[0]?.name ?? 'A fazer';
  return {
    stages: p.stages.map((s) => ({ name: s.name, done: s.done })),
    milestones: p.milestones.map((m) => ({ name: m.name, offsetDays: diff(m.dueOn) })),
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
