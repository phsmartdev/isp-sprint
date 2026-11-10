/**
 * Pedido de Apoio: qualquer pessoa pede ajuda ao time (grupo) ou a um colega, de qualquer tela.
 * Fluxo: aberto → assumido → atendido → confirmado (por quem pediu). Pontos só depois da confirmação:
 * quem apoiou ganha os pontos da tarefa em que ajudou (ou os pontos-base do apoio) × multiplicador;
 * quem pediu também ganha (pedir ajuda cedo é bom). Teto mensal por pessoa. Valores vêm da regra aprovada da gamificação.
 */

export const SUPPORT_STATUSES = ['aberto', 'assumido', 'atendido', 'confirmado', 'cancelado'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = { aberto: 'Aberto', assumido: 'Assumido', atendido: 'Atendido (aguarda confirmação)', confirmado: 'Confirmado', cancelado: 'Cancelado' };

export type SupportSettings = {
  /** multiplicador de quem apoiou sobre os pontos da tarefa (bp: 15000 = 1,5x) */
  helperMultiplierBp: number;
  /** pontos-base quando o pedido não está ligado a uma tarefa com pontos */
  basePoints: number;
  /** pontos de quem pediu, por apoio confirmado */
  requesterPoints: number;
  /** teto de pontos de apoio por pessoa no mês (somando apoiar e pedir) */
  monthlyCapPoints: number;
};

export function supportSettingsErrors(x: SupportSettings | undefined): string[] {
  if (!x) return [];
  const e: string[] = [];
  const int = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!int(x.helperMultiplierBp, 50_000) || x.helperMultiplierBp < 10_000) e.push('Multiplicador de quem apoia: entre 1x e 5x.');
  if (!int(x.basePoints, 1000)) e.push('Pontos-base do apoio inválidos.');
  if (!int(x.requesterPoints, 1000)) e.push('Pontos de quem pede apoio inválidos.');
  if (!int(x.monthlyCapPoints, 100_000)) e.push('Teto mensal de pontos de apoio inválido.');
  return e;
}

/** Ações permitidas no estado atual (quem pode fazer cada uma é conferido no servidor). */
export const SUPPORT_NEXT: Record<SupportStatus, ('assumir' | 'atendido' | 'confirmar' | 'reabrir' | 'cancelar' | 'desistir')[]> = {
  aberto: ['assumir', 'cancelar'],
  assumido: ['atendido', 'desistir', 'cancelar'],
  atendido: ['confirmar', 'reabrir'],
  confirmado: [],
  cancelado: [],
};

export type ConfirmedSupport = { id: string; requesterId: string; helperId: string; taskPoints: number | null; confirmedOn: string };
export type SupportCredit = { requestId: string; userId: string; role: 'apoiou' | 'pediu'; points: number; capped: boolean };

/**
 * Pontos dos apoios confirmados, em ordem de confirmação, com teto mensal por pessoa (o que passa do teto não conta).
 * Quem apoiou: (pontos da tarefa ou pontos-base) × multiplicador. Quem pediu: pontos de quem pede. Sem regra: nada.
 */
export function supportCredits(rows: ConfirmedSupport[], st: SupportSettings | undefined): SupportCredit[] {
  if (!st) return [];
  const used = new Map<string, number>();
  const out: SupportCredit[] = [];
  const give = (requestId: string, userId: string, role: SupportCredit['role'], raw: number, month: string) => {
    const k = `${userId}|${month}`;
    const left = Math.max(0, st.monthlyCapPoints - (used.get(k) ?? 0));
    const pts = Math.round(Math.min(raw, left) * 10) / 10;
    used.set(k, (used.get(k) ?? 0) + pts);
    out.push({ requestId, userId, role, points: pts, capped: pts < raw });
  };
  for (const r of [...rows].sort((a, b) => a.confirmedOn.localeCompare(b.confirmedOn) || a.id.localeCompare(b.id))) {
    if (r.helperId === r.requesterId) continue;
    const month = r.confirmedOn.slice(0, 7);
    const base = r.taskPoints != null && r.taskPoints > 0 ? r.taskPoints : st.basePoints;
    give(r.id, r.helperId, 'apoiou', (base * st.helperMultiplierBp) / 10_000, month);
    if (st.requesterPoints > 0) give(r.id, r.requesterId, 'pediu', st.requesterPoints, month);
  }
  return out;
}
