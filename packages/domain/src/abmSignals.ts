/**
 * ABM Fase 6 — acompanhamento: sinais (situações que pedem ação), cadências de contato e o estado de cada sinal.
 * Sinais são detectados a partir dos dados reais (ou registrados por uma pessoa) e se resolvem sozinhos quando a
 * condição deixa de existir. Nada aqui altera avaliações humanas.
 */
import { addDays } from './contracts';
import type { AbmPriority } from './abm';

export const SIGNAL_KINDS = ['sem_contato', 'interacao_pessoa_vencida', 'play_atrasado', 'contrato_vencendo', 'oportunidade_parada', 'objetivo_vencido', 'cobertura_baixa', 'nps_detrator', 'manual'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  sem_contato: 'Conta sem contato', interacao_pessoa_vencida: 'Interação com pessoa vencida', play_atrasado: 'Play com etapa atrasada', contrato_vencendo: 'Contrato vencendo',
  oportunidade_parada: 'Oportunidade parada', objetivo_vencido: 'Objetivo vencido', cobertura_baixa: 'Cobertura de stakeholders baixa', nps_detrator: 'NPS de detrator', manual: 'Registrado pela equipe',
};
export const SIGNAL_SEVERITIES = ['alta', 'media', 'baixa'] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];
export const SIGNAL_SEVERITY_LABELS: Record<SignalSeverity, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
export const SIGNAL_STATUSES = ['novo', 'em_analise', 'tratado', 'descartado', 'resolvido'] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
export const SIGNAL_STATUS_LABELS: Record<SignalStatus, string> = { novo: 'Novo', em_analise: 'Em análise', tratado: 'Tratado', descartado: 'Descartado', resolvido: 'Resolvido sozinho' };
export const OPEN_SIGNAL: SignalStatus[] = ['novo', 'em_analise'];

/** Dias sem contato tolerados por prioridade da conta. */
export const NO_CONTACT_DAYS: Record<AbmPriority, number> = { critica: 15, alta: 30, media: 45, baixa: 60 };
/** Por quanto tempo um sinal tratado ou descartado não volta, se a condição persistir. */
export const SUPPRESS_DAYS = { tratado: 7, descartado: 30 } as const;

export type SignalFacts = {
  priority: AbmPriority; today: string; daysSinceInteraction: number | null; accountCreatedOn: string;
  people: { id: string; name: string; nextInteractionOn: string | null; key: boolean }[];
  lateRuns: { id: string; play: string; lateSteps: number }[];
  contracts: { id: string; label: string; endAt: string }[];
  staleOpps: { id: string; label: string; days: number }[];
  objectives: { id: string; title: string; dueOn: string }[];
  coverage: number | null; active: boolean;
  detractors: { id: string; score: number; on: string }[];
};
export type SignalCandidate = { kind: Exclude<SignalKind, 'manual'>; key: string; severity: SignalSeverity; title: string; detail: string; ref: Record<string, unknown> };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Sinais que a situação atual da conta pede (função pura; a sincronização decide o que abrir ou resolver). */
export function evaluateSignals(f: SignalFacts): SignalCandidate[] {
  const out: SignalCandidate[] = [];
  const limit = NO_CONTACT_DAYS[f.priority];
  const sinceStart = daysBetween(f.accountCreatedOn, f.today);
  const silent = f.daysSinceInteraction ?? (sinceStart > limit ? sinceStart : null);
  if (silent !== null && silent > limit) out.push({ kind: 'sem_contato', key: 'sem_contato', severity: f.priority === 'critica' ? 'alta' : f.priority === 'alta' ? 'media' : 'baixa', title: `Sem contato há ${silent} dias`, detail: `${f.daysSinceInteraction === null ? 'Nenhuma interação registrada desde a entrada no ABM' : 'Última interação concluída'} — o limite para prioridade ${f.priority} é ${limit} dias.`, ref: { days: silent, limit } });
  for (const p of f.people) if (p.nextInteractionOn && p.nextInteractionOn < f.today) out.push({ kind: 'interacao_pessoa_vencida', key: `pessoa:${p.id}`, severity: p.key ? 'alta' : 'media', title: `Interação com ${p.name} vencida`, detail: `Prevista para ${p.nextInteractionOn.split('-').reverse().join('/')}.`, ref: { stakeholderId: p.id } });
  for (const r of f.lateRuns) out.push({ kind: 'play_atrasado', key: `play:${r.id}`, severity: 'media', title: `Play "${r.play}" com ${r.lateSteps} etapa(s) atrasada(s)`, detail: 'Conclua, reprograme ou cancele as tarefas atrasadas do play.', ref: { runId: r.id } });
  for (const c of f.contracts) { const d = daysBetween(f.today, c.endAt); if (d >= 0 && d <= 90) out.push({ kind: 'contrato_vencendo', key: `contrato:${c.id}`, severity: d <= 30 ? 'alta' : 'media', title: `Contrato ${c.label} vence em ${d} dia(s)`, detail: 'Prepare a renovação (há o play "Preparação de renovação").', ref: { contractId: c.id, days: d } }); }
  for (const o of f.staleOpps) out.push({ kind: 'oportunidade_parada', key: `op:${o.id}`, severity: 'media', title: `${o.label} parada há ${o.days} dias`, detail: 'Sem mudança de etapa no período.', ref: { opportunityId: o.id } });
  for (const o of f.objectives) if (o.dueOn < f.today) out.push({ kind: 'objetivo_vencido', key: `objetivo:${o.id}`, severity: 'media', title: `Objetivo vencido: ${o.title}`, detail: `Prazo era ${o.dueOn.split('-').reverse().join('/')}. Encerre com o resultado ou ajuste o prazo.`, ref: { objectiveId: o.id } });
  if (f.active && f.coverage !== null && f.coverage < 40) out.push({ kind: 'cobertura_baixa', key: 'cobertura', severity: 'baixa', title: `Cobertura de stakeholders em ${f.coverage}`, detail: 'Mapeie decisores, avalie a influência e fortaleça o relacionamento.', ref: { score: f.coverage } });
  for (const d of f.detractors) out.push({ kind: 'nps_detrator', key: `nps:${d.id}`, severity: 'alta', title: `NPS ${d.score} (detrator)`, detail: `Resposta de ${d.on.split('-').reverse().join('/')}. Entenda o motivo e trate a insatisfação.`, ref: { surveyId: d.id } });
  return out;
}

/** Transição de estado do sinal (null = permitida). */
export function signalTransition(from: SignalStatus, to: SignalStatus, note?: string | null) {
  if (!OPEN_SIGNAL.includes(from)) return 'Este sinal já foi encerrado.';
  if (to === 'em_analise') return from === 'novo' ? null : 'O sinal já está em análise.';
  if (to === 'tratado' || to === 'descartado') return (note ?? '').trim().length >= 10 ? null : to === 'tratado' ? 'Diga o que foi feito (pelo menos 10 caracteres).' : 'Diga por que descartar (pelo menos 10 caracteres).';
  return 'Transição inválida.';
}

// ---------------------------------------------------------------- cadências
export const CADENCE_TYPES = ['ligacao', 'reuniao', 'visita', 'email', 'whatsapp', 'tarefa'] as const;
export type CadenceType = (typeof CADENCE_TYPES)[number];
export const CADENCE_TYPE_LABELS: Record<CadenceType, string> = { ligacao: 'Ligação', reuniao: 'Reunião', visita: 'Visita', email: 'E-mail', whatsapp: 'WhatsApp', tarefa: 'Tarefa' };
export const CADENCE_LEAD_DAYS = 3;
export function cadenceErrors(c: { title: string; everyDays: number; startOn: string }) {
  const e: string[] = [];
  if (c.title.trim().length < 3) e.push('Dê um nome à cadência (ex.: ligação mensal com a decisora).');
  if (!Number.isInteger(c.everyDays) || c.everyDays < 1 || c.everyDays > 365) e.push('A frequência vai de 1 a 365 dias.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.startOn)) e.push('Informe a data de início.');
  return e;
}
/**
 * Próximo contato da cadência: a partir da última conclusão (ou do início). A tarefa nasce alguns dias antes;
 * não nasce se já houver uma aberta da mesma cadência.
 */
export function nextCadence(c: { startOn: string; everyDays: number; lastDoneOn: string | null; hasOpen: boolean }, today: string) {
  const due = c.lastDoneOn ? addDays(c.lastDoneOn, c.everyDays) : c.startOn;
  const dueOn = due < c.startOn ? c.startOn : due;
  return { dueOn, generate: !c.hasOpen && dueOn <= addDays(today, CADENCE_LEAD_DAYS) };
}
