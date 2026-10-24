/**
 * Linha do tempo única do contrato: tudo o que aconteceu (eventos, e-mails, tarefas) numa só lista,
 * separado por assunto, com o que é crítico em destaque e os próximos prazos no topo.
 */
export const TIMELINE_CATEGORIES = ['contrato', 'aditivos', 'financeiro', 'processos', 'execucao', 'documentos', 'alertas', 'emails', 'tarefas'] as const;
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];
export const TIMELINE_CATEGORY_LABELS: Record<TimelineCategory, string> = {
  contrato: 'Contrato e versões', aditivos: 'Aditivos', financeiro: 'Financeiro', processos: 'Processos',
  execucao: 'Execução', documentos: 'Documentos', alertas: 'Alertas', emails: 'E-mails', tarefas: 'Tarefas',
};

const BY_TYPE: Record<string, TimelineCategory> = {
  aditivo: 'aditivos',
  consumo: 'financeiro', estorno: 'financeiro', credito: 'financeiro', faturamento: 'financeiro', empenho: 'financeiro', medicao_vinculada: 'financeiro',
  processo_aberto: 'processos', processo_encerrado: 'processos', etapa_processo: 'processos',
  sla: 'execucao', sla_medicao: 'execucao', ocorrencia: 'execucao', fiscal: 'execucao', clausula: 'execucao', atestado: 'execucao',
  documento: 'documentos', assinatura: 'documentos',
  alerta: 'alertas', alerta_resolvido: 'alertas',
  oficio_email: 'emails',
};
/** Assunto do evento; o que não for de outro assunto é do próprio contrato (cadastro, versões, etapas, renovação). */
export const timelineCategory = (type: string): TimelineCategory => BY_TYPE[type] ?? 'contrato';

const SERIOUS_OCCURRENCES = ['multa', 'glosa', 'notificacao_orgao', 'advertencia'];
/** Crítico: alerta disparado, SLA violado, penalidade ou notificação do órgão, contrato que não será renovado. */
export function timelineCritical(type: string, payload: Record<string, unknown> | null | undefined): boolean {
  const p = payload ?? {};
  if (type === 'alerta' || type === 'encerramento_previsto') return true;
  if (type === 'sla_medicao') return p.status === 'violado';
  if (type === 'ocorrencia') return typeof p.kind === 'string' && SERIOUS_OCCURRENCES.includes(p.kind);
  return false;
}

export type UpcomingKind = 'termino' | 'renovacao' | 'alerta' | 'processo' | 'clausula' | 'ocorrencia' | 'tarefa';
export type Upcoming = { kind: UpcomingKind; on: string; title: string };
/** Próximos prazos em ordem, com quantos dias faltam (negativo = vencido). */
export function upcomingOf(list: Upcoming[], today: string, horizonDays = 120) {
  const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return list
    .map((u) => ({ ...u, days: Math.round((day(u.on) - day(today)) / 86_400_000) }))
    .filter((u) => u.days <= horizonDays)
    .sort((a, b) => (a.on === b.on ? a.title.localeCompare(b.title) : a.on < b.on ? -1 : 1));
}
