/**
 * Funcionalidade 01 — Trilha Visual da Jornada (Sucesso do Cliente).
 * Situação de cada parada a partir dos marcos reais, links externos com prazo, código e revogação, e o histórico dos marcos.
 */
import type { JourneyPhase } from './cs';

export type StopStatus = 'concluido' | 'atrasado' | 'atual' | 'proximo';
export const STOP_STATUS_LABELS: Record<StopStatus, string> = { concluido: 'Concluído', atrasado: 'Atrasado', atual: 'Agora', proximo: 'Próximo' };
type MilestoneLike = { id: string; phase: JourneyPhase; title: string; plannedAt: string | null; doneAt: string | null };

/**
 * Paradas da trilha na ordem dos marcos. "Agora" é o primeiro marco não concluído (se não estiver atrasado);
 * atrasado = não concluído com data prevista no passado. A trilha não reordena nem inventa datas.
 */
export function trailStops<T extends MilestoneLike>(ms: T[], today: string) {
  const current = ms.findIndex((m) => !m.doneAt);
  const stops = ms.map((m, i) => {
    const late = !m.doneAt && !!m.plannedAt && m.plannedAt < today;
    const status: StopStatus = m.doneAt ? 'concluido' : late ? 'atrasado' : i === current ? 'atual' : 'proximo';
    return { ...m, index: i, status };
  });
  const done = stops.filter((s) => s.status === 'concluido').length;
  return {
    stops,
    currentIndex: current === -1 ? null : current,
    done, total: ms.length, late: stops.filter((s) => s.status === 'atrasado').length,
    pct: ms.length ? Math.round((done / ms.length) * 100) : 0,
    finished: ms.length > 0 && current === -1,
  };
}

// ---------------------------------------------------------------- links externos
export const LINK_DURATIONS = [7, 15, 30, 60, 90] as const;
export const MAX_CODE_ATTEMPTS = 5;
export const CODE_LOCK_MINUTES = 15;
export type LinkState = 'ativo' | 'expirado' | 'revogado' | 'bloqueado';
export const LINK_STATE_LABELS: Record<LinkState, string> = { ativo: 'Ativo', expirado: 'Expirado', revogado: 'Revogado', bloqueado: 'Bloqueado por tentativas' };
export function linkState(l: { expiresAt: Date | string; revokedAt: Date | string | null; lockedUntil: Date | string | null }, now = new Date()): LinkState {
  if (l.revokedAt) return 'revogado';
  if (new Date(l.expiresAt) <= now) return 'expirado';
  if (l.lockedUntil && new Date(l.lockedUntil) > now) return 'bloqueado';
  return 'ativo';
}
/** Erros ao pedir um link (vazio = válido). */
export function linkRequestErrors(r: { label: string; days: number }) {
  const e: string[] = [];
  if (r.label.trim().length < 3) e.push('Diga para quem é o link (ex.: diretoria do cliente).');
  if (!Number.isInteger(r.days) || r.days < 1 || r.days > 180) e.push('O prazo vai de 1 a 180 dias.');
  return e;
}
/** Depois de uma tentativa com código errado: bloqueia ao atingir o limite. */
export function afterWrongCode(failed: number, now = new Date()) {
  const n = failed + 1;
  return { failedAttempts: n, lockedUntil: n >= MAX_CODE_ATTEMPTS ? new Date(now.getTime() + CODE_LOCK_MINUTES * 60_000) : null };
}

// ---------------------------------------------------------------- histórico dos marcos
export const MILESTONE_EVENT_TYPES = ['concluido', 'reaberto', 'reprogramado', 'responsavel', 'observacao'] as const;
export type MilestoneEventType = (typeof MILESTONE_EVENT_TYPES)[number];
export const MILESTONE_EVENT_LABELS: Record<MilestoneEventType, string> = { concluido: 'concluiu', reaberto: 'reabriu', reprogramado: 'mudou a data prevista', responsavel: 'mudou o responsável', observacao: 'atualizou as observações' };
type MsState = { doneAt: Date | string | null; plannedAt: string | null; ownerId: string | null; notes: string | null };
/** O que mudou num marco (um evento por mudança, com antes e depois). */
export function milestoneChanges(before: MsState, after: Partial<MsState>) {
  const ev: { type: MilestoneEventType; from: unknown; to: unknown }[] = [];
  if (after.doneAt !== undefined && !!after.doneAt !== !!before.doneAt) ev.push({ type: after.doneAt ? 'concluido' : 'reaberto', from: before.doneAt, to: after.doneAt });
  if (after.plannedAt !== undefined && after.plannedAt !== before.plannedAt) ev.push({ type: 'reprogramado', from: before.plannedAt, to: after.plannedAt });
  if (after.ownerId !== undefined && after.ownerId !== before.ownerId) ev.push({ type: 'responsavel', from: before.ownerId, to: after.ownerId });
  if (after.notes !== undefined && (after.notes ?? '') !== (before.notes ?? '')) ev.push({ type: 'observacao', from: before.notes, to: after.notes });
  return ev;
}
