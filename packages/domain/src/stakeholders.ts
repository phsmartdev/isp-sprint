/**
 * ABM Fase 4 — Stakeholders. Pessoa única (pode estar em várias organizações) + vínculo com a conta (dados próprios).
 * PODER DE INFLUÊNCIA: sempre manual, por pessoa autorizada, com justificativa e histórico; por contexto (conta, unidade,
 * oportunidade, projeto, processo). Nenhuma automação, importação, sincronização ou IA define ou altera esse valor.
 */

export const STAKEHOLDER_ROLES = ['decisor', 'influenciador', 'avaliador_tecnico', 'usuario', 'aprovador_financeiro', 'patrocinador', 'responsavel_contratacao', 'fiscal_contrato', 'gestor_tecnico', 'gestor_politico', 'bloqueador'] as const;
export type StakeholderRole = (typeof STAKEHOLDER_ROLES)[number];
export const STAKEHOLDER_ROLE_LABELS: Record<StakeholderRole, string> = {
  decisor: 'Decisor', influenciador: 'Influenciador', avaliador_tecnico: 'Avaliador técnico', usuario: 'Usuário', aprovador_financeiro: 'Aprovador financeiro', patrocinador: 'Patrocinador',
  responsavel_contratacao: 'Responsável por contratação', fiscal_contrato: 'Fiscal de contrato', gestor_tecnico: 'Gestor técnico', gestor_politico: 'Gestor político-institucional', bloqueador: 'Bloqueador',
};

// ---------------------------------------------------------------- influência (manual)
export const INFLUENCE_LEVELS = ['muito_alto', 'alto', 'medio', 'baixo', 'muito_baixo', 'nao_avaliado'] as const;
export type InfluenceLevel = (typeof INFLUENCE_LEVELS)[number];
export const DEFAULT_INFLUENCE_LABELS: Record<InfluenceLevel, string> = { muito_alto: 'Muito alto', alto: 'Alto', medio: 'Médio', baixo: 'Baixo', muito_baixo: 'Muito baixo', nao_avaliado: 'Não avaliado' };
/** 5 = muito alto … 1 = muito baixo; não avaliado não tem posição. */
export const influenceRank = (l: InfluenceLevel): number | null => (l === 'nao_avaliado' ? null : 5 - INFLUENCE_LEVELS.indexOf(l));
export const INFLUENCE_CONTEXTS = ['conta', 'unidade', 'oportunidade', 'projeto', 'processo'] as const;
export type InfluenceContext = (typeof INFLUENCE_CONTEXTS)[number];
export const INFLUENCE_CONTEXT_LABELS: Record<InfluenceContext, string> = { conta: 'Conta', unidade: 'Unidade / departamento', oportunidade: 'Oportunidade', projeto: 'Projeto', processo: 'Processo decisório' };
/** Origem de quem tenta mudar a influência: só "manual" é aceita. */
export type ChangeOrigin = 'manual' | 'automacao' | 'importacao' | 'sincronizacao' | 'ia' | 'pesquisa';
export function influenceChangeError(input: { origin: ChangeOrigin; to: InfluenceLevel; from: InfluenceLevel; justification?: string | null; contextType: InfluenceContext; contextId?: string | null }) {
  if (input.origin !== 'manual') return 'O poder de influência só pode ser definido manualmente por uma pessoa autorizada.';
  if (input.from === input.to) return 'A classificação já é esta.';
  if ((input.justification ?? '').trim().length < 10) return 'Explique a avaliação (justificativa com pelo menos 10 caracteres).';
  if (input.contextType !== 'conta' && !input.contextId) return 'Indique a qual unidade, oportunidade, projeto ou processo esta avaliação se refere.';
  return null;
}

// ---------------------------------------------------------------- demais dimensões (independentes da influência)
export const STANCES = ['defensor', 'favoravel', 'neutro', 'resistente', 'opositor', 'desconhecido'] as const;
export type Stance = (typeof STANCES)[number];
export const STANCE_LABELS: Record<Stance, string> = { defensor: 'Defensor', favoravel: 'Favorável', neutro: 'Neutro', resistente: 'Resistente', opositor: 'Opositor', desconhecido: 'Desconhecido' };
export const INTERESTS = ['alto', 'medio', 'baixo', 'desconhecido'] as const;
export type Interest = (typeof INTERESTS)[number];
export const INTEREST_LABELS: Record<Interest, string> = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo', desconhecido: 'Desconhecido' };
export const RELATIONSHIP_STRENGTHS = ['forte', 'moderado', 'fraco', 'inexistente', 'nao_avaliado'] as const;
export type RelationshipStrength = (typeof RELATIONSHIP_STRENGTHS)[number];
export const RELATIONSHIP_LABELS: Record<RelationshipStrength, string> = { forte: 'Forte', moderado: 'Moderado', fraco: 'Fraco', inexistente: 'Inexistente', nao_avaliado: 'Não avaliado' };
export const STAKEHOLDER_ACCESS = ['direto', 'indireto', 'sem_acesso', 'nao_avaliado'] as const;
export type StakeholderAccess = (typeof STAKEHOLDER_ACCESS)[number];
export const STAKEHOLDER_ACCESS_LABELS: Record<StakeholderAccess, string> = { direto: 'Direto', indireto: 'Indireto', sem_acesso: 'Sem acesso', nao_avaliado: 'Não avaliado' };
export const PARTICIPATIONS = ['ativo', 'ocasional', 'inativo', 'nao_avaliado'] as const;
export type Participation = (typeof PARTICIPATIONS)[number];
export const PARTICIPATION_LABELS: Record<Participation, string> = { ativo: 'Ativo', ocasional: 'Ocasional', inativo: 'Inativo', nao_avaliado: 'Não avaliado' };
export const STAKEHOLDER_PRIORITIES = ['critica', 'alta', 'media', 'baixa'] as const;
export type StakeholderPriority = (typeof STAKEHOLDER_PRIORITIES)[number];

// ---------------------------------------------------------------- mapa de influência
export type Quadrant = 'gerenciar_de_perto' | 'manter_satisfeito' | 'manter_informado' | 'monitorar';
export const QUADRANT_LABELS: Record<Quadrant, { title: string; hint: string }> = {
  gerenciar_de_perto: { title: 'Gerenciar de perto', hint: 'Alta influência e alto interesse' },
  manter_satisfeito: { title: 'Manter satisfeitos', hint: 'Alta influência e baixo interesse' },
  manter_informado: { title: 'Manter informados', hint: 'Baixa influência e alto interesse' },
  monitorar: { title: 'Monitorar', hint: 'Baixa influência e baixo interesse' },
};
/**
 * Quadrante pela influência (manual) e pelo interesse. Alta influência = médio, alto ou muito alto (rank ≥ 3);
 * alto interesse = alto ou médio. Sem avaliação de influência, ou interesse desconhecido, fica fora da matriz.
 */
export function quadrantOf(influence: InfluenceLevel, interest: Interest): Quadrant | null {
  const r = influenceRank(influence);
  if (r === null || interest === 'desconhecido') return null;
  const hiInf = r >= 3;
  const hiInt = interest === 'alto' || interest === 'medio';
  return hiInf ? (hiInt ? 'gerenciar_de_perto' : 'manter_satisfeito') : hiInt ? 'manter_informado' : 'monitorar';
}

/** Configuração de quem vê/edita a influência (nível mínimo no módulo Contas) e se a mudança precisa de aprovação. */
export type InfluencePolicy = { view: 'proprio' | 'equipe' | 'total'; edit: 'proprio' | 'equipe' | 'total'; requireApproval: boolean; labels: Record<InfluenceLevel, string> };
export const DEFAULT_INFLUENCE_POLICY: InfluencePolicy = { view: 'proprio', edit: 'proprio', requireApproval: false, labels: { ...DEFAULT_INFLUENCE_LABELS } };
export function validateInfluencePolicy(p: InfluencePolicy) {
  const e: string[] = [];
  const order = ['proprio', 'equipe', 'total'];
  if (order.indexOf(p.edit) < order.indexOf(p.view)) e.push('Quem edita precisa também poder ver: o nível para editar não pode ser menor que o para ver.');
  for (const l of INFLUENCE_LEVELS) if (!(p.labels[l] ?? '').trim()) e.push(`Dê um nome ao nível "${DEFAULT_INFLUENCE_LABELS[l]}".`);
  return e;
}
