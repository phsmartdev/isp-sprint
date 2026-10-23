/**
 * Participantes da licitação: empresas, lances, ranking por lote e vencedor(es).
 * Ranking: dentro de cada lote, do menor lance para o maior (menor preço); quem não tem lance ou foi
 * desclassificado fica fora da classificação. Um vencedor por lote; mais de um só quando há mais de um lote.
 */
export const PARTICIPANT_STATUSES = ['ativo', 'desclassificado', 'desistente'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];
export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = { ativo: 'Na disputa', desclassificado: 'Desclassificada', desistente: 'Desistiu' };

export type BidParticipant = { company: string; document: string | null; lot: string; bidCents: number | null; status: ParticipantStatus; winner: boolean; isUs: boolean; notes?: string | null };

export const normalizeLot = (lot: string | null | undefined) => (lot ?? '').trim() || 'Único';
const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** Posição de cada participante no lote (1 = melhor lance); null quando fora da classificação. */
export function rankParticipants<T extends Pick<BidParticipant, 'lot' | 'bidCents' | 'status'>>(rows: T[]): (number | null)[] {
  const out: (number | null)[] = rows.map(() => null);
  const byLot = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.bidCents === null || r.status !== 'ativo') return;
    const k = normalizeLot(r.lot);
    byLot.set(k, [...(byLot.get(k) ?? []), i]);
  });
  for (const idx of byLot.values()) {
    idx.sort((a, b) => rows[a]!.bidCents! - rows[b]!.bidCents!);
    let pos = 0, last: number | null = null;
    idx.forEach((i, n) => { if (rows[i]!.bidCents !== last) { pos = n + 1; last = rows[i]!.bidCents; } out[i] = pos; });
  }
  return out;
}

/** Primeiro problema da lista, ou null. */
export function participantsError(rows: BidParticipant[]): string | null {
  for (const [i, r] of rows.entries()) {
    if (r.company.trim().length < 2) return `Linha ${i + 1}: informe a empresa.`;
    const d = onlyDigits(r.document);
    if (d && d.length !== 14) return `Linha ${i + 1}: CNPJ com 14 dígitos.`;
    if (r.bidCents !== null && (!Number.isInteger(r.bidCents) || r.bidCents < 0)) return `Linha ${i + 1}: lance inválido.`;
    if (r.winner && r.status !== 'ativo') return `Linha ${i + 1}: empresa ${PARTICIPANT_STATUS_LABELS[r.status].toLowerCase()} não pode vencer.`;
  }
  const seen = new Set<string>();
  for (const r of rows) {
    const k = `${normalizeLot(r.lot)}|${onlyDigits(r.document) || r.company.trim().toLowerCase()}`;
    if (seen.has(k)) return `${r.company} aparece duas vezes no lote ${normalizeLot(r.lot)}.`;
    seen.add(k);
  }
  const winners = new Map<string, number>();
  for (const r of rows.filter((x) => x.winner)) winners.set(normalizeLot(r.lot), (winners.get(normalizeLot(r.lot)) ?? 0) + 1);
  for (const [lot, n] of winners) if (n > 1) return lot === 'Único' ? 'Lote único: só uma empresa vence. Para mais de um vencedor, informe o lote de cada participante.' : `Lote ${lot}: só uma empresa vence por lote.`;
  if (rows.filter((r) => r.isUs).length && new Set(rows.filter((r) => r.isUs).map((r) => normalizeLot(r.lot))).size !== rows.filter((r) => r.isUs).length) return 'Nossa empresa aparece duas vezes no mesmo lote.';
  return null;
}

// ------------------------------------------------------------------ ações durante o pregão (linha do tempo append-only)
export const BID_ACTION_KINDS = ['lance', 'negociacao', 'esclarecimento', 'impugnacao', 'habilitacao', 'inabilitacao', 'desclassificacao', 'recurso', 'contrarrazao', 'desistencia', 'adjudicacao', 'homologacao', 'outro'] as const;
export type BidActionKind = (typeof BID_ACTION_KINDS)[number];
export const BID_ACTION_LABELS: Record<BidActionKind, string> = {
  lance: 'Lance', negociacao: 'Negociação', esclarecimento: 'Pedido de esclarecimento', impugnacao: 'Impugnação', habilitacao: 'Habilitação', inabilitacao: 'Inabilitação',
  desclassificacao: 'Desclassificação', recurso: 'Recurso', contrarrazao: 'Contrarrazão', desistencia: 'Desistência', adjudicacao: 'Adjudicação', homologacao: 'Homologação', outro: 'Outra ação',
};

// ------------------------------------------------------------------ inteligência por concorrente
/** Chave do concorrente: CNPJ quando houver; senão o nome normalizado. */
export const competitorKey = (r: { document: string | null; company: string }) => {
  const d = onlyDigits(r.document);
  return d.length === 14 ? d : `nome:${r.company.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')}`;
};

export type ParticipantRow = BidParticipant & { opportunityId: string; at: string };
export type CompetitorStats = {
  key: string; name: string; document: string | null;
  bids: number; lots: number; wins: number; winRate: number | null;
  ourWinsAgainst: number; theirWinsAgainstUs: number;
  avgBidCents: number | null; minBidCents: number | null; lastAt: string;
};

/** Agrega os participantes de todos os pregões em indicadores por concorrente (nossa empresa fica de fora). */
export function competitorStats(rows: ParticipantRow[]): CompetitorStats[] {
  const byOpp = new Map<string, ParticipantRow[]>();
  for (const r of rows) byOpp.set(r.opportunityId, [...(byOpp.get(r.opportunityId) ?? []), r]);
  const acc = new Map<string, CompetitorStats & { opps: Set<string>; sum: number; n: number; lastName: string; lastNameAt: string }>();
  for (const list of byOpp.values()) {
    const ours = new Map(list.filter((r) => r.isUs).map((r) => [normalizeLot(r.lot), r]));
    for (const r of list) {
      if (r.isUs) continue;
      const k = competitorKey(r);
      const lot = normalizeLot(r.lot);
      const a = acc.get(k) ?? { key: k, name: r.company.trim(), document: onlyDigits(r.document).length === 14 ? onlyDigits(r.document) : null, bids: 0, lots: 0, wins: 0, winRate: null, ourWinsAgainst: 0, theirWinsAgainstUs: 0, avgBidCents: null, minBidCents: null, lastAt: r.at, opps: new Set(), sum: 0, n: 0, lastName: r.company.trim(), lastNameAt: r.at };
      a.opps.add(r.opportunityId);
      a.lots += 1;
      if (r.winner) a.wins += 1;
      const us = ours.get(lot);
      if (us?.winner) a.ourWinsAgainst += 1;
      if (us && r.winner) a.theirWinsAgainstUs += 1;
      if (r.bidCents !== null) { a.sum += r.bidCents; a.n += 1; a.minBidCents = a.minBidCents === null ? r.bidCents : Math.min(a.minBidCents, r.bidCents); }
      if (r.at > a.lastAt) a.lastAt = r.at;
      if (r.at >= a.lastNameAt) { a.lastName = r.company.trim(); a.lastNameAt = r.at; }
      acc.set(k, a);
    }
  }
  return [...acc.values()].map(({ opps, sum, n, lastName, lastNameAt: _l, ...a }) => ({
    ...a, name: lastName, bids: opps.size, winRate: a.lots ? a.wins / a.lots : null, avgBidCents: n ? Math.round(sum / n) : null,
  })).sort((x, y) => y.bids - x.bids || y.wins - x.wins || x.name.localeCompare(y.name));
}
