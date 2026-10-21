/**
 * Motor de eventos de negócio (Etapa 5, 21/10/2026).
 *
 * Eventos são fatos já registrados no sistema (venda ganha, contrato validado, tarefa concluída…),
 * derivados das tabelas de origem por um projetor idempotente — nunca digitados à mão.
 * Cada evento tem um responsável principal, participantes e créditos de reconhecimento
 * calculados por regras versionadas, sem dupla contagem (créditos diretos somam 100%).
 */

export const EVENT_MODULES = ['comercial', 'contratos', 'atas', 'projetos', 'tarefas', 'aprovacoes', 'sucesso_cliente'] as const;
export type EventModule = (typeof EVENT_MODULES)[number];
export const EVENT_MODULE_LABELS: Record<EventModule, string> = {
  comercial: 'Comercial', contratos: 'Contratos', atas: 'Atas', projetos: 'Projetos', tarefas: 'Tarefas', aprovacoes: 'Aprovações', sucesso_cliente: 'Sucesso do Cliente',
};

export type EventTypeDef = {
  key: string;
  label: string;
  module: EventModule;
  /** o que o valor representa, quando há */
  value?: 'mensal_cents' | 'quantidade';
  /** de onde vem o fato (para a tela de catálogo e auditoria) */
  source: string;
  /** quem é o responsável principal */
  owner: string;
};

export const BUSINESS_EVENT_TYPES = [
  { key: 'lead_qualificado', label: 'Lead qualificado (virou oportunidade)', module: 'comercial', source: 'Lead convertido em oportunidade', owner: 'Responsável pelo lead' },
  { key: 'oportunidade_criada', label: 'Oportunidade criada', module: 'comercial', value: 'mensal_cents', source: 'Cadastro da oportunidade', owner: 'Responsável pela oportunidade' },
  { key: 'proposta_enviada', label: 'Proposta enviada', module: 'comercial', source: 'Primeiro envio da proposta por e-mail ou WhatsApp (uma vez por oportunidade)', owner: 'Responsável pela oportunidade' },
  { key: 'negociacao_ganha', label: 'Negociação ganha', module: 'comercial', value: 'mensal_cents', source: 'Oportunidade movida para Ganha (reabrir invalida)', owner: 'Responsável pela oportunidade' },
  { key: 'negociacao_perdida', label: 'Negociação perdida', module: 'comercial', value: 'mensal_cents', source: 'Oportunidade movida para Perdida (reabrir invalida)', owner: 'Responsável pela oportunidade' },
  { key: 'aprovacao_concluida', label: 'Aprovação concluída', module: 'aprovacoes', source: 'Decisão registrada num pedido de aprovação', owner: 'Quem decidiu' },
  { key: 'venda_validada', label: 'Venda validada (contrato validado)', module: 'contratos', value: 'mensal_cents', source: 'Validação do contrato', owner: 'Responsável comercial do contrato' },
  { key: 'contrato_assinado', label: 'Contrato assinado', module: 'contratos', source: 'Assinatura eletrônica concluída', owner: 'Responsável comercial do contrato' },
  { key: 'contrato_renovado', label: 'Contrato renovado', module: 'contratos', source: 'Processo de renovação concluído', owner: 'Responsável pelo processo' },
  { key: 'processo_contrato_concluido', label: 'Processo de contrato concluído', module: 'contratos', source: 'Implantação, reajuste ou encerramento concluído', owner: 'Responsável pelo processo' },
  { key: 'movimentacao_ata_autorizada', label: 'Movimentação de ata efetivada', module: 'atas', source: 'Operação da ata efetivada com documento', owner: 'Quem pediu a operação' },
  { key: 'adesao_ata_autorizada', label: 'Adesão à ata autorizada', module: 'atas', source: 'Autorização do órgão gerenciador registrada', owner: 'Quem registrou a autorização' },
  { key: 'tarefa_concluida', label: 'Tarefa concluída', module: 'tarefas', source: 'Tarefa concluída (reabrir invalida)', owner: 'Responsável pela tarefa' },
  { key: 'entrega_validada', label: 'Entrega aprovada', module: 'tarefas', source: 'Entrega aprovada pelo aprovador', owner: 'Responsável pela tarefa' },
  { key: 'marco_concluido', label: 'Marco de projeto atingido', module: 'projetos', source: 'Marco marcado como atingido (reabrir invalida)', owner: 'Gerente do projeto' },
  { key: 'projeto_concluido', label: 'Projeto concluído', module: 'projetos', source: 'Projeto concluído (reabrir invalida)', owner: 'Gerente do projeto' },
  { key: 'acompanhamento_registrado', label: 'Acompanhamento de cliente com resultado', module: 'sucesso_cliente', source: 'Atividade de Sucesso do Cliente concluída com resultado', owner: 'Responsável pela atividade' },
] as const satisfies readonly EventTypeDef[];
export type BusinessEventType = (typeof BUSINESS_EVENT_TYPES)[number]['key'];
export const EVENT_TYPE_KEYS = BUSINESS_EVENT_TYPES.map((t) => t.key) as BusinessEventType[];
export const eventTypeDef = (k: string) => BUSINESS_EVENT_TYPES.find((t) => t.key === k) as EventTypeDef | undefined;

/** Eventos citados no pedido mas sem fonte confiável no sistema hoje — aparecem como indisponíveis, nunca inventados. */
export const UNAVAILABLE_EVENT_TYPES = [
  { key: 'cliente_reativado', label: 'Cliente reativado', reason: 'Depende do status de cliente no ERP/IXC, ainda não integrado.' },
  { key: 'cadastro_validado', label: 'Cadastro validado', reason: 'Não existe hoje um passo formal de validação de cadastro.' },
  { key: 'pendencia_resolvida', label: 'Pendência resolvida', reason: 'Pendências ainda não têm registro próprio; entram com o construtor de automações.' },
] as const;

export const EVENT_VALIDATION = ['valido', 'pendente', 'invalidado'] as const;
export type EventValidation = (typeof EVENT_VALIDATION)[number];
export const EVENT_VALIDATION_LABELS: Record<EventValidation, string> = { valido: 'Válido', pendente: 'Aguardando validação', invalidado: 'Invalidado' };

export const CREDIT_KINDS = ['direto', 'participacao', 'gestao'] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];
export const CREDIT_KIND_LABELS: Record<CreditKind, string> = { direto: 'Resultado', participacao: 'Participação', gestao: 'Gestão da equipe' };

/**
 * Regra de atribuição por tipo de evento.
 * - ownerShareBp: parte do resultado do responsável; o resto é dividido igualmente entre participantes.
 *   Sem participantes, o responsável fica com 100% (os créditos "Resultado" sempre somam 100%: sem dupla contagem).
 * - participants: participantes recebem crédito de "Participação" (reconhecimento, não soma no resultado).
 * - managers: líderes do time do responsável recebem crédito de "Gestão da equipe" (não soma no individual).
 */
export type AttributionRule = { ownerShareBp: number; participants: boolean; managers: boolean };
export type PerformanceConfig = {
  attribution: Record<string, AttributionRule>;
  /** tipos que nascem "Aguardando validação" e só contam depois que um gestor valida */
  validationRequired: string[];
  /** faixas do semáforo pelo atingimento (padrão: verde ≥ 90%, amarelo ≥ 85%) */
  traffic?: { green: number; yellow: number };
};
export const DEFAULT_ATTRIBUTION: AttributionRule = { ownerShareBp: 10_000, participants: true, managers: true };
export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  attribution: Object.fromEntries(EVENT_TYPE_KEYS.map((k) => [k, { ...DEFAULT_ATTRIBUTION }])),
  validationRequired: [],
  traffic: { green: 0.9, yellow: 0.85 },
};

export function validatePerformanceConfig(c: PerformanceConfig): string[] {
  const e: string[] = [];
  for (const [k, r] of Object.entries(c.attribution)) {
    if (!eventTypeDef(k)) e.push(`Tipo de evento desconhecido: ${k}.`);
    if (!Number.isInteger(r.ownerShareBp) || r.ownerShareBp < 0 || r.ownerShareBp > 10_000) e.push(`${eventTypeDef(k)?.label ?? k}: parte do responsável deve ficar entre 0% e 100%.`);
  }
  for (const k of c.validationRequired) if (!eventTypeDef(k)) e.push(`Tipo de evento desconhecido: ${k}.`);
  if (c.traffic && !(c.traffic.green > 0 && c.traffic.yellow > 0 && c.traffic.yellow <= c.traffic.green && c.traffic.green <= 2)) e.push('Semáforo: o amarelo deve ser menor ou igual ao verde, ambos entre 0% e 200%.');
  return e;
}

export type Credit = { userId: string; kind: CreditKind; shareBp: number };

/**
 * Créditos de um evento. Os de "Resultado" somam exatamente 10.000 bp (100%), com o resto da divisão
 * ficando com o responsável — assim nenhum resultado conta duas vezes nem some por arredondamento.
 */
export function computeCredits(rule: AttributionRule, ownerId: string, participants: string[], managers: string[]): Credit[] {
  const others = [...new Set(participants)].filter((p) => p !== ownerId);
  const out: Credit[] = [];
  if (!others.length || rule.ownerShareBp >= 10_000) {
    out.push({ userId: ownerId, kind: 'direto', shareBp: 10_000 });
  } else {
    const rest = 10_000 - rule.ownerShareBp;
    const each = Math.floor(rest / others.length);
    const remainder = rest - each * others.length;
    out.push({ userId: ownerId, kind: 'direto', shareBp: rule.ownerShareBp + remainder });
    for (const p of others) out.push({ userId: p, kind: 'direto', shareBp: each });
  }
  if (rule.participants) for (const p of others) if (!out.some((c) => c.userId === p && c.kind === 'direto' && c.shareBp > 0)) out.push({ userId: p, kind: 'participacao', shareBp: 0 });
  if (rule.managers) for (const m of [...new Set(managers)]) if (m !== ownerId) out.push({ userId: m, kind: 'gestao', shareBp: 0 });
  return out.filter((c) => c.kind !== 'direto' || c.shareBp > 0);
}
