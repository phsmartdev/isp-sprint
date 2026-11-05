/**
 * Playbook Comercial (PCOM 01.01): papéis e matriz RACI da gestão de contratos.
 *
 * Transcrito das páginas 9 a 13 do documento. Decisões de 04/11/2026:
 * - as siglas "AC", "TC" e "ANS" da matriz original são ANC (Analista Comercial);
 * - papéis sem perfil no sistema são ATORES EXTERNOS (nomeados, sem login);
 * - os TITULARES de cada papel e os prazos (SLA) ficam em aberto, preenchidos pela empresa depois.
 */

export const PLAYBOOK_ROLES = ['GC', 'SC', 'ANC', 'ASC', 'FIN', 'CS', 'OP', 'JUR', 'DIR', 'LID_TECNICA', 'LID_FINANCEIRO', 'LID_OP', 'RESP_JURIDICO'] as const;
export type PlaybookRole = (typeof PLAYBOOK_ROLES)[number];

export const PLAYBOOK_ROLE_LABELS: Record<PlaybookRole, string> = {
  GC: 'Gerência Comercial',
  SC: 'Supervisão Comercial',
  ANC: 'Analista Comercial',
  ASC: 'Assistente Comercial',
  FIN: 'Financeiro',
  CS: 'Sucesso do Cliente',
  OP: 'Operação / T.I.',
  JUR: 'Jurídico',
  DIR: 'Diretoria / Signatário autorizado',
  LID_TECNICA: 'Liderança Técnica',
  LID_FINANCEIRO: 'Liderança Financeira',
  LID_OP: 'Liderança de Operação',
  RESP_JURIDICO: 'Responsável Jurídico',
};

export const RACI_PHASES = ['formalizacao', 'cadastro_ativacao', 'vigencia', 'financeira', 'encerramento'] as const;
export type RaciPhase = (typeof RACI_PHASES)[number];
export const RACI_PHASE_LABELS: Record<RaciPhase, string> = {
  formalizacao: 'Formalização contratual',
  cadastro_ativacao: 'Cadastro e ativação contratual',
  vigencia: 'Gestão da vigência contratual',
  financeira: 'Gestão financeira contratual',
  encerramento: 'Encerramento contratual',
};

export type RaciRow = { key: string; phase: RaciPhase; label: string; R: PlaybookRole[]; A: PlaybookRole; C: PlaybookRole[]; I: PlaybookRole[] };

const r = (key: string, phase: RaciPhase, label: string, R: PlaybookRole[], A: PlaybookRole, C: PlaybookRole[], I: PlaybookRole[]): RaciRow => ({ key, phase, label, R, A, C, I });

/** Matriz RACI por atividade, na ordem do Playbook. Um único A por atividade. */
export const RACI_MATRIX: readonly RaciRow[] = [
  r('recebimento_registro', 'formalizacao', 'Recebimento e registro do contrato', ['ANC'], 'SC', [], ['GC']),
  r('conferencia_cadastral', 'formalizacao', 'Conferência de dados cadastrais', ['ASC'], 'SC', ['FIN'], []),
  r('validacao_comercial', 'formalizacao', 'Validação das condições comerciais', ['ANC'], 'SC', ['GC'], []),
  r('conferencia_escopo', 'formalizacao', 'Conferência de escopo e condições técnicas', ['OP'], 'LID_TECNICA', ['ANC', 'CS'], ['SC']),
  r('analise_juridica', 'formalizacao', 'Análise jurídica, quando exigida', ['JUR'], 'RESP_JURIDICO', ['ANC'], ['SC']),
  r('documentacao_obrigatoria', 'formalizacao', 'Conferência da documentação obrigatória', ['ANC'], 'SC', [], []),
  r('coleta_assinaturas', 'formalizacao', 'Coordenação da coleta de assinaturas', ['ASC'], 'SC', ['DIR'], ['GC']),
  r('assinatura', 'formalizacao', 'Assinatura do instrumento contratual', ['DIR'], 'DIR', ['GC'], ['ANC']),
  r('arquivamento_assinado', 'formalizacao', 'Arquivamento do contrato assinado', ['ASC'], 'SC', [], ['CS', 'FIN']),

  r('cadastro_erp', 'cadastro_ativacao', 'Cadastro do contrato no ERP', ['ASC'], 'SC', ['FIN'], ['GC']),
  r('registro_crm', 'cadastro_ativacao', 'Registro e atualização no CRM', ['ASC'], 'SC', [], []),
  r('solicitacao_provisionamento', 'cadastro_ativacao', 'Solicitação de provisionamento', ['ASC'], 'SC', ['FIN'], ['GC']),
  r('configuracao_faturamento', 'cadastro_ativacao', 'Validação e configuração do faturamento', ['FIN'], 'LID_FINANCEIRO', ['ANC'], ['SC']),
  r('transferencia_implantacao', 'cadastro_ativacao', 'Transferência para implantação', ['ANC'], 'SC', ['CS', 'OP'], ['GC']),
  r('aceite_implantacao', 'cadastro_ativacao', 'Aceite da demanda de implantação', ['CS'], 'GC', ['OP'], ['ANC']),
  r('execucao_implantacao', 'cadastro_ativacao', 'Execução técnica da implantação', ['OP'], 'LID_TECNICA', ['CS'], ['GC']),
  r('marcos_inicio_servico', 'cadastro_ativacao', 'Confirmação dos marcos de início de serviço', ['CS', 'OP'], 'LID_OP', ['SC', 'FIN'], ['SC']),

  r('prazos_obrigacoes', 'vigencia', 'Acompanhamento de prazos e obrigações', ['ASC'], 'ANC', ['SC'], ['GC']),
  r('garantias_vencimentos', 'vigencia', 'Controle de garantias e vencimentos', ['ANC'], 'SC', ['FIN'], ['GC']),
  r('necessidade_aditivo', 'vigencia', 'Identificação de necessidade de aditivo', ['ANC'], 'SC', ['CS'], ['GC']),
  r('continuidade_comercial', 'vigencia', 'Avaliação de continuidade comercial', ['CS'], 'GC', ['FIN'], ['SC']),
  r('conducao_renovacao', 'vigencia', 'Condução administrativa da renovação', ['ANC'], 'SC', ['GC'], ['DIR']),
  r('analise_aditivos', 'vigencia', 'Análise de aditivos', ['ANC'], 'SC', ['DIR'], ['GC']),
  r('formalizacao_alteracoes', 'vigencia', 'Formalização de alterações contratuais', ['ASC'], 'ANC', ['SC'], ['GC']),
  r('atualizacao_sistemas', 'vigencia', 'Atualização dos sistemas após alteração', ['ASC'], 'ANC', ['FIN'], ['SC']),
  r('conferencia_alteracoes', 'vigencia', 'Conferência das alterações registradas', ['ANC'], 'SC', ['FIN'], ['GC']),

  r('reajustes_previstos', 'financeira', 'Identificação de reajustes previstos', ['ASC'], 'ANC', ['SC'], ['FIN']),
  r('apuracao_valores', 'financeira', 'Apuração e validação de valores', ['ANC'], 'FIN', ['SC'], ['GC']),
  r('condicoes_excepcionais', 'financeira', 'Avaliação comercial de condições excepcionais', ['GC'], 'GC', ['DIR'], ['FIN']),
  r('formalizacao_reajuste', 'financeira', 'Formalização do reajuste', ['ASC'], 'ANC', ['SC'], ['GC']),
  r('aplicacao_faturamento', 'financeira', 'Aplicação dos valores no faturamento', ['FIN'], 'FIN', ['SC'], ['GC']),

  r('identificacao_encerrar', 'encerramento', 'Identificação de contratos a encerrar', ['ASC'], 'ANC', ['SC'], ['GC']),
  r('validacao_situacao', 'encerramento', 'Validação da situação contratual', ['ANC'], 'SC', ['GC'], ['DIR']),
  r('comunicacao_encerramento', 'encerramento', 'Comunicação interna do encerramento', ['ANC'], 'SC', ['FIN', 'CS'], ['GC']),
  r('desmobilizacao', 'encerramento', 'Coordenação da desmobilização', ['CS'], 'GC', ['OP'], ['SC']),
  r('encerramento_financeiro', 'encerramento', 'Encerramento financeiro', ['FIN'], 'FIN', ['ANC'], ['SC']),
  r('atualizacao_final', 'encerramento', 'Atualização final dos sistemas', ['ASC'], 'ANC', ['SC'], ['GC']),
  r('conferencia_encerramento', 'encerramento', 'Conferência do encerramento administrativo', ['ANC'], 'SC', ['CS'], ['GC']),
  r('arquivamento_definitivo', 'encerramento', 'Arquivamento definitivo', ['ANC'], 'SC', ['CS'], ['GC']),
];

export const RACI_KEYS = RACI_MATRIX.map((x) => x.key);
export const raciRow = (key: string | null | undefined) => RACI_MATRIX.find((x) => x.key === key) ?? null;
export const isPlaybookRole = (v: unknown): v is PlaybookRole => PLAYBOOK_ROLES.includes(v as PlaybookRole);

/** Quem ocupa um papel: usuário do sistema ou ator externo (nome, sem login). */
export type RoleHolder = { role: PlaybookRole; userId: string | null; externalName: string | null };

/** Usuários do sistema que ocupam algum dos papéis. Papel sem titular = em aberto. */
export function holdersOf(holders: readonly RoleHolder[], roles: readonly PlaybookRole[]) {
  return [...new Set(holders.filter((h) => roles.includes(h.role) && h.userId).map((h) => h.userId!))];
}

/** Prazo da atividade pelo SLA configurado (em horas). Sem SLA, não há prazo calculado. */
export function slaDueAt(start: Date, slaHours: number | null | undefined): Date | null {
  if (!slaHours || slaHours <= 0) return null;
  return new Date(start.getTime() + slaHours * 3_600_000);
}

export type TaskSlaState = 'sem_sla' | 'no_prazo' | 'vence_hoje' | 'atrasada' | 'concluida';
/** Situação da atividade frente ao prazo. Sem prazo, "sem SLA" (nunca inventa um). */
export function taskSlaState(dueAt: Date | string | null, completedAt: Date | string | null, now = new Date()): TaskSlaState {
  if (completedAt) return 'concluida';
  if (!dueAt) return 'sem_sla';
  const d = new Date(dueAt);
  if (d.getTime() < now.getTime()) return 'atrasada';
  return d.getTime() - now.getTime() <= 24 * 3_600_000 ? 'vence_hoje' : 'no_prazo';
}

export const ACCEPT_STATUSES = ['pendente', 'aceita', 'devolvida'] as const;
export type AcceptStatus = (typeof ACCEPT_STATUSES)[number];
export const ACCEPT_LABELS: Record<AcceptStatus, string> = { pendente: 'Aguardando aceite', aceita: 'Aceita', devolvida: 'Devolvida' };

// ------------------------------------------------------------------ avisos por nível de responsabilidade
export const RACI_LETTERS = ['R', 'A', 'C', 'I'] as const;
export type RaciLetter = (typeof RACI_LETTERS)[number];
export const RACI_LETTER_LABELS: Record<RaciLetter, string> = { R: 'Responsável pela execução (R)', A: 'Responsável final (A)', C: 'Consultado (C)', I: 'Informado (I)' };

export const NOTIFY_EVENTS = ['criada', 'vence_em_breve', 'vencida', 'devolvida', 'concluida'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];
export const NOTIFY_EVENT_LABELS: Record<NotifyEvent, string> = {
  criada: 'Atividade criada ou transferida', vence_em_breve: 'Prazo perto de vencer', vencida: 'Prazo vencido', devolvida: 'Demanda devolvida sem aceite', concluida: 'Atividade concluída',
};

export type EscalationLevel = { afterHours: number; role: PlaybookRole };
export type NotifyRules = { events: Record<NotifyEvent, RaciLetter[]>; dueSoonHours: number | null; escalation: EscalationLevel[] };

/**
 * Padrão tirado das definições da RACI do Playbook: R executa (recebe a atividade e os prazos), A responde pelo
 * resultado (vê vencimento, devolução e conclusão), I é informado da conclusão. Antecedência do "perto de vencer"
 * e escalonamento ficam EM ABERTO (sem valor inventado) até a empresa definir.
 */
export const DEFAULT_NOTIFY_RULES: NotifyRules = {
  events: { criada: ['R'], vence_em_breve: ['R'], vencida: ['R', 'A'], devolvida: ['A'], concluida: ['A', 'I'] },
  dueSoonHours: null,
  escalation: [],
};

export function normalizeNotifyRules(v: unknown): NotifyRules {
  const x = (v && typeof v === 'object' ? v : {}) as Partial<NotifyRules>;
  const ev = (x.events ?? {}) as Partial<Record<NotifyEvent, unknown>>;
  const letters = (a: unknown, d: RaciLetter[]) => (Array.isArray(a) ? [...new Set(a.filter((l): l is RaciLetter => RACI_LETTERS.includes(l as RaciLetter)))] : d);
  const hours = typeof x.dueSoonHours === 'number' && x.dueSoonHours > 0 ? Math.round(x.dueSoonHours) : null;
  const esc = Array.isArray(x.escalation) ? x.escalation.filter((e): e is EscalationLevel => !!e && typeof e.afterHours === 'number' && e.afterHours > 0 && isPlaybookRole(e.role)).map((e) => ({ afterHours: Math.round(e.afterHours), role: e.role })) : [];
  return {
    events: Object.fromEntries(NOTIFY_EVENTS.map((k) => [k, letters(ev[k], DEFAULT_NOTIFY_RULES.events[k])])) as Record<NotifyEvent, RaciLetter[]>,
    dueSoonHours: hours,
    escalation: esc.sort((a, b) => a.afterHours - b.afterHours),
  };
}

/** Papéis do Playbook que recebem o aviso de um evento, pela linha da RACI da atividade (R fica com o dono da tarefa). */
export function rolesToNotify(row: RaciRow | null, letters: readonly RaciLetter[]): { letter: RaciLetter; roles: PlaybookRole[] }[] {
  if (!row) return letters.map((l) => ({ letter: l, roles: [] }));
  return letters.map((l) => ({ letter: l, roles: l === 'A' ? [row.A] : [...row[l]] }));
}

/** Níveis de escalonamento já atingidos por uma atividade vencida há `overdueHours`. */
export function escalationReached(overdueHours: number, levels: readonly EscalationLevel[]) {
  return levels.map((l, i) => ({ ...l, index: i })).filter((l) => overdueHours >= l.afterHours);
}
