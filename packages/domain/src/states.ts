/** Estados separados (spec §6). Nunca inferir um a partir do outro. */

export const OPPORTUNITY_STAGES = ['novo_lead', 'qualificacao', 'cobertura', 'proposta', 'fechamento', 'ganha', 'perdida'] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** Etapas do funil Yepnet. "Ganha" = venda fechada (ganho comercial); contrato confirmado é outro estado. */
export const STAGE_LABELS: Record<OpportunityStage, string> = {
  novo_lead: 'Novo lead',
  qualificacao: 'Qualificação',
  cobertura: 'Cobertura',
  proposta: 'Proposta',
  fechamento: 'Fechamento',
  ganha: 'Venda fechada',
  perdida: 'Perdido',
};

export const TERMINAL_STAGES: readonly OpportunityStage[] = ['ganha', 'perdida'];
export const OPEN_STAGES = OPPORTUNITY_STAGES.filter((s) => !TERMINAL_STAGES.includes(s));

export const PROPOSAL_STATUSES = ['nao_criada', 'rascunho', 'enviada', 'aceita', 'recusada', 'expirada'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_LABELS: Record<ProposalStatus, string> = {
  nao_criada: 'Não criada', rascunho: 'Rascunho', enviada: 'Enviada', aceita: 'Aceita', recusada: 'Recusada', expirada: 'Expirada',
};

export const CONTRACT_REQUEST_STATUSES = ['nao_solicitada', 'pendente', 'enviada', 'erro', 'confirmada', 'rejeitada'] as const;
export type ContractRequestStatus = (typeof CONTRACT_REQUEST_STATUSES)[number];
export const CONTRACT_LABELS: Record<ContractRequestStatus, string> = {
  nao_solicitada: 'Não solicitada', pendente: 'Pendente', enviada: 'Enviada', erro: 'Erro', confirmada: 'Confirmada', rejeitada: 'Rejeitada',
};

export const COVERAGE_STATUSES = ['nao_consultada', 'pendente', 'elegivel', 'inelegivel', 'indeterminada'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  nao_consultada: 'Não consultada', pendente: 'Pendente', elegivel: 'Elegível', inelegivel: 'Inelegível', indeterminada: 'Indeterminada',
};

export const CUSTOMER_LIFECYCLES = ['prospect', 'em_implantacao', 'ativo', 'inadimplente', 'suspenso', 'cancelado', 'reativado'] as const;
export type CustomerLifecycle = (typeof CUSTOMER_LIFECYCLES)[number];
export const LIFECYCLE_LABELS: Record<CustomerLifecycle, string> = {
  prospect: 'Prospect', em_implantacao: 'Em implantação', ativo: 'Ativo', inadimplente: 'Inadimplente', suspenso: 'Suspenso', cancelado: 'Cancelado', reativado: 'Reativado',
};

export const LEAD_STATUSES = ['novo', 'em_contato', 'qualificado', 'convertido', 'descartado'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo', em_contato: 'Em contato', qualificado: 'Qualificado', convertido: 'Convertido em oportunidade', descartado: 'Descartado',
};

export const OPPORTUNITY_REASONS = ['oferta', 'problema', 'comparacao', 'satisfeito_aberto', 'nova_instalacao', 'outro'] as const;
export type OpportunityReason = (typeof OPPORTUNITY_REASONS)[number];
export const REASON_LABELS: Record<OpportunityReason, string> = {
  oferta: 'Oferta / curiosidade',
  problema: 'Problema de conexão',
  comparacao: 'Comparando provedores',
  satisfeito_aberto: 'Satisfeito, mas aberto',
  nova_instalacao: 'Nova instalação',
  outro: 'Outro / não informado',
};

export const LOSS_REASONS = [
  'sem_cobertura', 'preco', 'fidelidade_atual', 'satisfeito_atual', 'sem_resposta', 'nao_quer_trocar', 'outro',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];
export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  sem_cobertura: 'Sem cobertura',
  preco: 'Preço',
  fidelidade_atual: 'Fidelidade com provedor atual',
  satisfeito_atual: 'Satisfeito com o atual',
  sem_resposta: 'Sem resposta',
  nao_quer_trocar: 'Não quer trocar',
  outro: 'Outro',
};

export const ACTIVITY_TYPES = ['tarefa', 'ligacao', 'reuniao', 'email', 'whatsapp', 'visita'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  tarefa: 'Tarefa', ligacao: 'Ligação', reuniao: 'Reunião', email: 'E-mail', whatsapp: 'WhatsApp', visita: 'Visita técnica',
};
/** Rótulo do selo na lista de atividades (design: WhatsApp aparece como "Mensagem"). */
export const ACTIVITY_TAG_LABELS: Record<ActivityType, string> = {
  tarefa: 'Tarefa', ligacao: 'Ligação', reuniao: 'Reunião', email: 'E-mail', whatsapp: 'Mensagem', visita: 'Visita',
};

export const SEGMENTS = ['residencial', 'empresarial', 'governamental', 'institucional'] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_LABELS: Record<Segment, string> = { residencial: 'Residencial', empresarial: 'Corporativo', governamental: 'Governamental', institucional: 'Institucional' };
export const SEGMENT_PRODUCT_LABELS: Record<Segment, string> = { residencial: 'Internet residencial', empresarial: 'Internet corporativa', governamental: 'Governamental', institucional: 'Institucional' };
export const ACTIVITY_PRIORITIES = ['baixa', 'media', 'alta'] as const;
export type ActivityPriority = (typeof ACTIVITY_PRIORITIES)[number];
export const PRIORITY_LABELS: Record<ActivityPriority, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

// ---------------------------------------------------------------- transições

export type TransitionInput = {
  from: OpportunityStage;
  to: OpportunityStage;
  reason?: string | null;
  lossReason?: LossReason | null;
  confirm?: boolean;
  canReopen: boolean;
};

export type TransitionResult =
  | { ok: true }
  | { ok: false; code: 'same_stage' | 'terminal' | 'loss_reason_required' | 'confirmation_required' | 'reason_required'; message: string };

/**
 * Regras de transição de etapa. Puro e testável; a API é a única chamadora autorizada.
 * - Entre etapas abertas: livre (o playbook é orientativo, não rígido).
 * - Para "perdida": exige motivo de perda e confirmação.
 * - Para "ganha": exige confirmação explícita. Ganha é ganho comercial, NÃO contrato confirmado.
 * - Saindo de ganha/perdida (reabrir): exige permissão opportunity.reopen e justificativa.
 */
export function validateTransition(i: TransitionInput): TransitionResult {
  if (i.from === i.to) return { ok: false, code: 'same_stage', message: 'A oportunidade já está nesta etapa.' };
  const fromTerminal = TERMINAL_STAGES.includes(i.from);
  if (fromTerminal) {
    if (!i.canReopen) return { ok: false, code: 'terminal', message: 'Oportunidade encerrada. Reabrir exige permissão de supervisor.' };
    if (!i.reason?.trim()) return { ok: false, code: 'reason_required', message: 'Informe o motivo da reabertura.' };
  }
  if (i.to === 'perdida') {
    if (!i.lossReason) return { ok: false, code: 'loss_reason_required', message: 'Informe o motivo da perda.' };
    if (!i.confirm) return { ok: false, code: 'confirmation_required', message: 'Confirme o encerramento como perdida.' };
  }
  if (i.to === 'ganha' && !i.confirm) {
    return { ok: false, code: 'confirmation_required', message: 'Confirme o ganho comercial. Isso não confirma contrato no IXC.' };
  }
  return { ok: true };
}

export function isTerminal(stage: OpportunityStage) {
  return TERMINAL_STAGES.includes(stage);
}
