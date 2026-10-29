/** Tipos e formatação do Controle de Empenhos (a resposta de GET /contracts/:id/commitment-control). */
import { useQueryClient } from '@tanstack/react-query';
import type { CommitmentProjection, LineClass, MeasurementKind } from '@isp/domain';

export type Bal = { contracted4: number; committed4: number; executed4: number; pending4: number; reserved4: number; invoiced4: number; available4: number; toCommit4: number; commitmentBalance4: number; uncovered4: number };
export type LineMove = { id: string; kind: 'acrescimo' | 'supressao'; qty4: number; effectiveOn: string; reason: string; reference: string | null };
export type PriceRow = { id: string; adjustmentId: string; lineId: string; fromCompetence: string; previousPrice4: number; price4: number };
export type Line = { id: string; itemNumber: string; arpItemNumber: string | null; description: string; unit: string; classification: LineClass; qty4: number; originalQty4: number; price4: number; originalPrice4: number; monthlyQty4: number | null; valueV4: number; balance: Bal; moves: LineMove[]; priceHistory: PriceRow[]; reservations: { opportunityId: string; code: number; title: string; stage: string; qty4: number }[]; measured: { measurementId: string; qty4: number }[] };
export type CMove = { id: string; kind: 'reforco' | 'anulacao' | 'supressao'; kindLabel: string; qty4: number; occurredOn: string; reason: string; linkedCommitmentId: string | null };
export type CItem = { id: string; lineId: string; code: string | null; itemNumber: string | null; qty4: number; adjust4: number; balance4: number; valueV4: number; balanceV4: number; moves: CMove[] };
export type Commitment = { id: string; number: string; fiscalYear: number; issuedOn: string; source: string | null; sourceId: string | null; sourceName: string | null; cancelledAt: string | null; cancelReason: string | null; valueV4: number; balanceV4: number; suppressedV4: number; reempenhadaEm: { id: string; number: string }[]; substitui: { id: string; number: string }[]; items: CItem[] };
export type MItem = { lineId: string; qty4: number; price4: number; valueV4: number; allocations: { commitmentItemId: string; qty4: number }[]; uncovered4: number };
export type Measurement = { id: string; groupId: string; version: number; superseded: boolean; competence: string; kind: MeasurementKind; title: string; status: string; statusLabel: string; opportunityId: string | null; revisionReasonLabel: string | null; revisionNote: string | null; invoiceNumber: string | null; invoiceDate: string | null; invoiceCents: number | null; attestedAt: string | null; createdAt: string; valueV4: number; uncoveredV4: number; items: MItem[] };
export type Retro = { id: string; measurementId: string; items: { lineId: string; qty4: number; oldPrice4: number; newPrice4: number; diffV4: number }[]; diffV4: number; status: 'pendente' | 'faturado'; invoiceNumber: string | null; invoiceDate: string | null };
export type Adjustment = { id: string; indexName: string; mode: 'fator' | 'percentual'; inputText: string; factor8: number; pct: number; baseDate: string; startCompetence: string; note: string | null; createdAt: string; repriced: { measurementId: string; lineId: string; oldPrice4: number; newPrice4: number }[]; prices: PriceRow[]; retros: Retro[] };
export type Settings = { allocation: 'fifo' | 'rateio'; agingDays: number; toCommitPct: number | null; windowMonths: number; commitmentBlock: boolean; allocationConfirmedAt: string | null; allocationConfirmedBy: string | null };
export type ShareVersion = { id: string; version: number; validFrom: string; definedBy: 'cliente' | 'bk'; shares: { sourceId: string; ppm: number }[]; note: string | null; createdAt: string };
export type CurvePoint = { competence: string; contractedV4: number; committedV4: number; executedV4: number; invoicedV4: number };
export type Pendencia = { kind: string; label: string; measurementId: string; title: string; competence: string; valueV4: number; since: string; retroId?: string };
export type Data = {
  contract: { id: string; code: number; kind: string; number: string | null; object: string | null; startAt: string | null; endAt: string | null; totalCents: number | null; commitmentBlock: boolean };
  settings: Settings;
  lines: Line[]; commitments: Commitment[]; measurements: Measurement[];
  pendencias: Pendencia[];
  totals: { contracted: number; committed: number; executed: number; pending: number; reserved: number; invoiced: number; available: number; toCommit: number; commitmentBalance: number; uncovered: number; executionPct: number | null; committedPct: number | null };
  alerts: { level: 'alto' | 'medio' | 'info'; key: string; text: string }[];
  projection: CommitmentProjection; curve: CurvePoint[];
  sources: { id: string; name: string }[]; shareVersions: ShareVersion[]; adjustments: Adjustment[];
  canManage: boolean; today: string; globalCheck: { itemsCents: number; globalCents: number; diffCents: number } | null;
};

export const qty = (q4: number) => (q4 / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
export const money = (v4: number) => (v4 / 10_000).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** preço com as 4 casas internas (RN07) */
export const price = (p4: number) => `R$ ${(p4 / 10_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
export const pctOf = (a: number, b: number) => (b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
export const parseNum = (t: string) => { const s = t.trim(); if (!s) return null; const n = Number(/,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : null; };
export const monthLabel = (c: string) => new Date(`${c}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
export const monthShort = (c: string) => `${c.slice(5)}/${c.slice(2, 4)}`;

export function useRefresh(contractId: string) {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ['commitment-control', contractId] }); qc.invalidateQueries({ queryKey: ['contract', contractId] }); };
}

/** CSV para abrir no Excel em português (ponto e vírgula, BOM). */
export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => { const t = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v; return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
