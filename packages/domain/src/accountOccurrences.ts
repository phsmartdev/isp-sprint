/**
 * Ocorrências da conta e evolução do relacionamento.
 * Ocorrência = fato registrado pela equipe que ajuda a analisar a conta (notificação recebida, elogio, mudança na negociação…).
 * Nada aqui é inferido: o impacto sugerido pelo tipo pode ser trocado por quem registra.
 */

export const ACCOUNT_OCCURRENCE_KINDS = ['notificacao', 'reclamacao', 'feedback_positivo', 'mudanca_negociacao', 'mudanca_gestao', 'reuniao_decisao', 'marco', 'outro'] as const;
export type AccountOccurrenceKind = (typeof ACCOUNT_OCCURRENCE_KINDS)[number];
export const ACCOUNT_OCCURRENCE_KIND_LABELS: Record<AccountOccurrenceKind, string> = {
  notificacao: 'Notificação recebida',
  reclamacao: 'Reclamação',
  feedback_positivo: 'Feedback positivo / elogio',
  mudanca_negociacao: 'Mudança na negociação',
  mudanca_gestao: 'Mudança de gestão ou pessoa-chave',
  reuniao_decisao: 'Reunião ou decisão importante',
  marco: 'Marco do relacionamento',
  outro: 'Outro',
};
export const ACCOUNT_OCCURRENCE_KIND_HINTS: Record<AccountOccurrenceKind, string> = {
  notificacao: 'Ofício, advertência, notificação contratual ou cobrança formal do cliente.',
  reclamacao: 'Insatisfação relatada pelo cliente (atendimento, qualidade, prazo, cobrança).',
  feedback_positivo: 'Elogio, agradecimento, depoimento ou indicação.',
  mudanca_negociacao: 'O que mudou numa negociação: escopo, prazo, preço, decisor, cronograma…',
  mudanca_gestao: 'Troca de gestor, secretário, diretor ou outra pessoa-chave do cliente.',
  reuniao_decisao: 'Reunião relevante ou decisão tomada pelo cliente.',
  marco: 'Fato que marca a história da conta (inauguração, ampliação, prêmio…).',
  outro: 'Qualquer outro fato que ajude a entender a conta.',
};

export const ACCOUNT_OCCURRENCE_IMPACTS = ['positivo', 'neutro', 'negativo'] as const;
export type AccountOccurrenceImpact = (typeof ACCOUNT_OCCURRENCE_IMPACTS)[number];
export const ACCOUNT_OCCURRENCE_IMPACT_LABELS: Record<AccountOccurrenceImpact, string> = { positivo: 'Positivo', neutro: 'Neutro', negativo: 'Negativo' };
/** Impacto sugerido ao escolher o tipo; quem registra pode trocar. */
export const DEFAULT_ACCOUNT_OCCURRENCE_IMPACT: Record<AccountOccurrenceKind, AccountOccurrenceImpact> = {
  notificacao: 'negativo', reclamacao: 'negativo', feedback_positivo: 'positivo', mudanca_negociacao: 'neutro',
  mudanca_gestao: 'neutro', reuniao_decisao: 'neutro', marco: 'positivo', outro: 'neutro',
};

export const ACCOUNT_OCCURRENCE_CHANNELS = ['oficio', 'email', 'reuniao', 'telefone', 'whatsapp', 'glpi', 'pesquisa', 'visita', 'outro'] as const;
export type AccountOccurrenceChannel = (typeof ACCOUNT_OCCURRENCE_CHANNELS)[number];
export const ACCOUNT_OCCURRENCE_CHANNEL_LABELS: Record<AccountOccurrenceChannel, string> = {
  oficio: 'Ofício / documento', email: 'E-mail', reuniao: 'Reunião', telefone: 'Telefone', whatsapp: 'WhatsApp', glpi: 'Chamado (GLPI)', pesquisa: 'Pesquisa', visita: 'Visita', outro: 'Outro',
};

/** Só para "Mudança na negociação": o que mudou (pode marcar mais de um). */
export const NEGOTIATION_ASPECTS = ['escopo', 'preco', 'prazo', 'decisor', 'cronograma', 'condicoes', 'status'] as const;
export type NegotiationAspect = (typeof NEGOTIATION_ASPECTS)[number];
export const NEGOTIATION_ASPECT_LABELS: Record<NegotiationAspect, string> = {
  escopo: 'Escopo', preco: 'Preço', prazo: 'Prazo contratual', decisor: 'Decisor', cronograma: 'Cronograma', condicoes: 'Condições', status: 'Andamento (pausa, retomada, cancelamento)',
};

/** Tipos em que costuma haver resposta a dar ao cliente (o prazo de resposta aparece no formulário). */
export const ACCOUNT_OCCURRENCE_NEEDS_RESPONSE: readonly AccountOccurrenceKind[] = ['notificacao', 'reclamacao'];

export type ResponseState = 'respondida' | 'atrasada' | 'pendente' | null;
/** Situação da resposta: só existe quando há prazo de resposta. */
export function responseState(o: { responseDueOn: string | null; respondedOn: string | null }, today: string): ResponseState {
  if (o.respondedOn) return 'respondida';
  if (!o.responseDueOn) return null;
  return o.responseDueOn < today ? 'atrasada' : 'pendente';
}

// ---------------------------------------------------------------- evolução por ano

export type EvolutionInput = {
  contracts: { startAt: string | null; endAt: string | null; monthlyCents: number; closedOn?: string | null }[];
  opportunities: { createdOn: string; wonOn: string | null; lostOn: string | null }[];
  interactions: string[];
  occurrences: { on: string; impact: AccountOccurrenceImpact }[];
};
export type EvolutionYear = {
  year: number; monthlyCents: number; activeContracts: number; opened: number; won: number; lost: number;
  interactions: number; positive: number; negative: number;
};

const yearOf = (d: string) => Number(d.slice(0, 4));
/** Contrato ativo na data: começou até ela e não terminou (fim ou encerramento) antes dela. */
export function activeOn(c: EvolutionInput['contracts'][number], day: string) {
  if (!c.startAt || c.startAt > day) return false;
  const end = [c.endAt, c.closedOn].filter((x): x is string => !!x).sort()[0];
  return !end || end >= day;
}

/**
 * Resumo por ano, do primeiro registro até o ano de hoje.
 * Mensal e contratos ativos são a foto do último dia do ano (ou de hoje, no ano corrente).
 */
export function evolutionByYear(i: EvolutionInput, today: string): EvolutionYear[] {
  const dates = [
    ...i.contracts.map((c) => c.startAt).filter((x): x is string => !!x),
    ...i.opportunities.map((o) => o.createdOn), ...i.interactions, ...i.occurrences.map((o) => o.on),
  ].filter((d) => d <= today);
  if (!dates.length) return [];
  const first = Math.min(...dates.map(yearOf));
  const last = yearOf(today);
  const out: EvolutionYear[] = [];
  for (let y = first; y <= last; y++) {
    const snap = y === last ? today : `${y}-12-31`;
    const active = i.contracts.filter((c) => activeOn(c, snap));
    const inYear = (d: string | null) => !!d && yearOf(d) === y && d <= today;
    out.push({
      year: y,
      monthlyCents: active.reduce((s, c) => s + c.monthlyCents, 0),
      activeContracts: active.length,
      opened: i.opportunities.filter((o) => inYear(o.createdOn)).length,
      won: i.opportunities.filter((o) => inYear(o.wonOn)).length,
      lost: i.opportunities.filter((o) => inYear(o.lostOn)).length,
      interactions: i.interactions.filter(inYear).length,
      positive: i.occurrences.filter((o) => inYear(o.on) && o.impact === 'positivo').length,
      negative: i.occurrences.filter((o) => inYear(o.on) && o.impact === 'negativo').length,
    });
  }
  return out;
}

/** "2025-T3" para agrupar interações por trimestre. */
export function quarterKey(day: string) {
  return `${day.slice(0, 4)}-T${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
}
