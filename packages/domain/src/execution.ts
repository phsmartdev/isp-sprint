/**
 * Execução do contrato (fase 5): SLA contratado × realizado, ocorrências e penalidades, fiscal e gestor do
 * órgão, cláusulas críticas com prazo e atestados de capacidade técnica. Tudo append-only: corrigir grava
 * um novo registro e o anterior fica no histórico.
 */
import { addDays, daysBetween } from './contracts';

export const SLA_METRICS = ['disponibilidade', 'tempo_reparo', 'tempo_atendimento', 'latencia', 'perda_pacotes', 'outro'] as const;
export type SlaMetric = (typeof SLA_METRICS)[number];
export const SLA_METRIC_LABELS: Record<SlaMetric, string> = {
  disponibilidade: 'Disponibilidade', tempo_reparo: 'Tempo de reparo', tempo_atendimento: 'Tempo de atendimento', latencia: 'Latência', perda_pacotes: 'Perda de pacotes', outro: 'Outro',
};
/** Unidade e sentido padrão de cada métrica (maior é melhor só na disponibilidade). */
export const SLA_DEFAULTS: Record<SlaMetric, { unit: string; direction: 'maior' | 'menor' }> = {
  disponibilidade: { unit: '%', direction: 'maior' }, tempo_reparo: { unit: 'h', direction: 'menor' }, tempo_atendimento: { unit: 'h', direction: 'menor' },
  latencia: { unit: 'ms', direction: 'menor' }, perda_pacotes: { unit: '%', direction: 'menor' }, outro: { unit: '', direction: 'maior' },
};
export type SlaStatus = 'cumprido' | 'violado' | 'sem_medicao';
export function slaStatus(direction: 'maior' | 'menor', target: number, value: number | null): SlaStatus {
  if (value === null || value === undefined) return 'sem_medicao';
  return (direction === 'maior' ? value >= target : value <= target) ? 'cumprido' : 'violado';
}
/** Horas de indisponibilidade permitidas no mês para uma meta de disponibilidade (ex.: 99,5% em 30 dias = 3,6 h). */
export const allowedDowntimeHours = (targetPct: number, days = 30) => Math.round(days * 24 * (1 - targetPct / 100) * 10) / 10;

export const OCCURRENCE_KINDS = ['falha_servico', 'atraso', 'notificacao_orgao', 'advertencia', 'multa', 'glosa', 'reclamacao', 'outro'] as const;
export type OccurrenceKind = (typeof OCCURRENCE_KINDS)[number];
export const OCCURRENCE_LABELS: Record<OccurrenceKind, string> = {
  falha_servico: 'Falha no serviço', atraso: 'Atraso na entrega', notificacao_orgao: 'Notificação do órgão/cliente', advertencia: 'Advertência', multa: 'Multa', glosa: 'Glosa na fatura', reclamacao: 'Reclamação', outro: 'Outro',
};
/** Ocorrências que podem custar dinheiro ao contrato. */
export const PENALTY_KINDS: OccurrenceKind[] = ['multa', 'glosa'];
export const OCCURRENCE_STATUS = ['aberta', 'defesa_enviada', 'aceita', 'revertida', 'encerrada'] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUS)[number];
export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = { aberta: 'Aberta', defesa_enviada: 'Defesa enviada', aceita: 'Penalidade aceita', revertida: 'Revertida', encerrada: 'Encerrada' };
export const OCCURRENCE_OPEN: OccurrenceStatus[] = ['aberta', 'defesa_enviada'];

export const PARTY_ROLES = ['gestor', 'fiscal_tecnico', 'fiscal_administrativo', 'fiscal_requisitante', 'preposto'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  gestor: 'Gestor do contrato (órgão)', fiscal_tecnico: 'Fiscal técnico', fiscal_administrativo: 'Fiscal administrativo', fiscal_requisitante: 'Fiscal requisitante', preposto: 'Preposto (nosso)',
};

export const CLAUSE_KINDS = ['sla', 'multa', 'rescisao', 'reajuste', 'garantia', 'entrega', 'obrigacao', 'confidencialidade', 'outra'] as const;
export type ClauseKind = (typeof CLAUSE_KINDS)[number];
export const CLAUSE_LABELS: Record<ClauseKind, string> = {
  sla: 'Nível de serviço', multa: 'Multas e sanções', rescisao: 'Rescisão', reajuste: 'Reajuste', garantia: 'Garantia contratual', entrega: 'Prazo de entrega', obrigacao: 'Obrigação periódica', confidencialidade: 'Confidencialidade/LGPD', outra: 'Outra',
};

export const CERT_STATUS = ['a_solicitar', 'solicitado', 'recebido', 'recusado'] as const;
export type CertStatus = (typeof CERT_STATUS)[number];
export const CERT_STATUS_LABELS: Record<CertStatus, string> = { a_solicitar: 'A solicitar', solicitado: 'Solicitado', recebido: 'Recebido', recusado: 'Recusado' };

/**
 * Quando pedir o atestado de capacidade técnica: com metade da vigência cumprida (já há execução para atestar)
 * e de novo no fim; sem atestado recebido, vira pendência.
 */
export function certificateDue(c: { startAt: string | null; endAt: string | null; hasReceived: boolean; hasRequested: boolean }, today: string) {
  if (c.hasReceived || !c.startAt || !c.endAt) return null;
  const total = Math.max(1, daysBetween(c.startAt, c.endAt));
  const half = addDays(c.startAt, Math.round(total / 2));
  if (today < half) return null;
  return { dueAt: c.hasRequested ? addDays(today, 0) : half, stage: today >= addDays(c.endAt, -30) ? 'fim' as const : 'meio' as const, requested: c.hasRequested };
}

/** Cláusula com prazo: aviso N dias antes. */
export const clauseAlertOn = (deadline: string, remindDays: number) => addDays(deadline, -Math.max(0, remindDays));
