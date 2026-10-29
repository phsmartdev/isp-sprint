/**
 * Controle de Empenhos: carrega o histórico do contrato (itens, NEs, itens de empenho, medições e reservas da pipeline)
 * e calcula os saldos pelo domínio (packages/domain/src/commitments.ts). Nada aqui guarda saldo: tudo é recalculado.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  allocateRateio, commitmentAlerts, commitmentCurve, commitmentItemBalances, commitmentProjection, contractTotals, lineBalances, priceAt,
  type CCommitment, type CCommitmentItem, type CLine, type CMeasurement, type CMeasurementItem, type CPrice, type CReservation, type CShare, type CommitmentMoveKind, type LineClass, type MeasurementKind, type MeasurementStatus,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { hasSector, isAdmin } from './contracts';
import { level } from './scope';

export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Quem registra empenhos e medições: gestão de contratos, financeiro e os responsáveis do contrato. */
export const canManageCommitments = (auth: AuthContext, c: { commercialOwnerId: string; operationalOwnerId: string | null }) =>
  isAdmin(auth) || level(auth, 'contratos') === 'total' || hasSector(auth, ['administracao', 'inteligencia_comercial', 'diretoria', 'financeiro']) || c.commercialOwnerId === auth.userId || c.operationalOwnerId === auth.userId;

export async function controlData(db: DbOrTx, contractId: string) {
  const [lines, commitments, measurements, reservations, lineMoves, sources, shareVersions, adjustments, retros] = await Promise.all([
    db.select().from(s.contractLines).where(eq(s.contractLines.contractId, contractId)).orderBy(asc(s.contractLines.position), asc(s.contractLines.createdAt)),
    db.select().from(s.contractCommitments).where(eq(s.contractCommitments.contractId, contractId)).orderBy(asc(s.contractCommitments.issuedOn), asc(s.contractCommitments.number)),
    db.select().from(s.contractMeasurements).where(eq(s.contractMeasurements.contractId, contractId)).orderBy(asc(s.contractMeasurements.competence), asc(s.contractMeasurements.createdAt)),
    db.select({ r: s.contractOpportunityLines, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage }).from(s.contractOpportunityLines)
      .innerJoin(s.opportunities, eq(s.opportunities.id, s.contractOpportunityLines.opportunityId))
      .where(and(eq(s.contractOpportunityLines.contractId, contractId), eq(s.contractOpportunityLines.status, 'reservada'))),
    db.select().from(s.contractLineMoves).where(eq(s.contractLineMoves.contractId, contractId)).orderBy(asc(s.contractLineMoves.effectiveOn)),
    db.select().from(s.contractRevenueSources).where(eq(s.contractRevenueSources.contractId, contractId)).orderBy(asc(s.contractRevenueSources.createdAt)),
    db.select().from(s.contractSourceShares).where(eq(s.contractSourceShares.contractId, contractId)).orderBy(desc(s.contractSourceShares.version)),
    db.select().from(s.contractAdjustments).where(eq(s.contractAdjustments.contractId, contractId)).orderBy(asc(s.contractAdjustments.startCompetence), asc(s.contractAdjustments.createdAt)),
    db.select().from(s.contractAdjustmentRetros).where(eq(s.contractAdjustmentRetros.contractId, contractId)),
  ]);
  const ids = commitments.map((c) => c.id);
  const cItems = ids.length ? await db.select().from(s.contractCommitmentItems).where(inArray(s.contractCommitmentItems.commitmentId, ids)) : [];
  const moves = cItems.length ? await db.select().from(s.contractCommitmentMoves).where(inArray(s.contractCommitmentMoves.commitmentItemId, cItems.map((i) => i.id))).orderBy(asc(s.contractCommitmentMoves.occurredOn)) : [];
  const mIds = measurements.map((m) => m.id);
  const mItems = mIds.length ? await db.select().from(s.contractMeasurementItems).where(inArray(s.contractMeasurementItems.measurementId, mIds)) : [];
  const aIds = adjustments.map((a) => a.id);
  const priceRows = aIds.length ? await db.select().from(s.contractLinePrices).where(inArray(s.contractLinePrices.adjustmentId, aIds)) : [];
  const prices: CPrice[] = priceRows.map((p) => ({ lineId: p.lineId, price4: p.price4, from: p.fromCompetence, adjustmentId: p.adjustmentId }));
  const today = todayIso().slice(0, 7);
  // quantidade contratada = original + aditivos (acréscimo − supressão); preço = tabela vigente hoje (reajustes, PF08)
  const netQty = (l: (typeof lines)[number]) => l.qty4 + lineMoves.filter((m) => m.lineId === l.id).reduce((a, m) => a + (m.kind === 'acrescimo' ? m.qty4 : -m.qty4), 0);
  const dl: CLine[] = lines.map((l) => ({ id: l.id, itemNumber: l.itemNumber, description: l.description, unit: l.unit, classification: l.classification as LineClass, qty4: netQty(l), price4: priceAt(l, prices, today), monthlyQty4: l.monthlyQty4 }));
  const dc: CCommitment[] = commitments.map((c) => ({ id: c.id, number: c.number, fiscalYear: c.fiscalYear, issuedOn: c.issuedOn, cancelled: !!c.cancelledAt, source: c.source, sourceId: c.sourceId }));
  const di: CCommitmentItem[] = cItems.map((i) => {
    const mv = moves.filter((m) => m.commitmentItemId === i.id).map((m) => ({ kind: m.kind as CommitmentMoveKind, qty4: m.qty4, occurredOn: m.occurredOn }));
    return { id: i.id, commitmentId: i.commitmentId, lineId: i.lineId, code: i.code, itemNumber: i.itemNumber, qty4: i.qty4, adjust4: mv.reduce((a, m) => a + (m.kind === 'reforco' ? m.qty4 : -m.qty4), 0), moves: mv };
  });
  const dm: CMeasurement[] = measurements.map((m) => ({ id: m.id, competence: m.competence, status: m.status as MeasurementStatus, superseded: m.superseded, title: m.title, kind: m.kind as MeasurementKind, createdAt: m.createdAt.toISOString(), attestedAt: m.attestedAt?.toISOString() ?? null }));
  const dmi: CMeasurementItem[] = mItems.map((x) => ({ measurementId: x.measurementId, lineId: x.lineId, qty4: x.qty4, price4: x.price4, allocations: x.allocations, uncovered4: x.uncovered4 }));
  const dr: CReservation[] = reservations.map((x) => ({ lineId: x.r.lineId, qty4: x.r.qty4, opportunityId: x.r.opportunityId }));
  return { raw: { lines, commitments, cItems, moves, measurements, mItems, reservations, lineMoves, sources, shareVersions, adjustments, priceRows, retros }, lines: dl, commitments: dc, items: di, measurements: dm, mItems: dmi, reservations: dr, prices };
}
export type ControlData = Awaited<ReturnType<typeof controlData>>;

/** Parâmetros do contrato que a regra usa (ordem de baixa e alertas). */
export type ControlSettings = { allocation: 'fifo' | 'rateio'; agingDays: number; toCommitPct: number | null; windowMonths: number };
export const settingsOf = (c: { commitmentAllocation: string; commitmentAgingDays: number; commitmentToCommitPct: number | null; commitmentWindowMonths: number }): ControlSettings =>
  ({ allocation: c.commitmentAllocation === 'rateio' ? 'rateio' : 'fifo', agingDays: c.commitmentAgingDays, toCommitPct: c.commitmentToCommitPct, windowMonths: c.commitmentWindowMonths });

/** Saldos, totais, projeção, alertas e pendências a partir do histórico. */
export function controlState(d: ControlData, contract: { startAt: string | null; endAt: string | null }, settings?: ControlSettings) {
  const today = todayIso();
  const bal = lineBalances({ lines: d.lines, commitments: d.commitments, items: d.items, measurements: d.measurements, mItems: d.mItems, reservations: d.reservations });
  const ciBal = commitmentItemBalances(d.items, d.measurements, d.mItems);
  const totals = contractTotals(d.lines, bal, { measurements: d.measurements, mItems: d.mItems });
  const projection = commitmentProjection({ today, startAt: contract.startAt, endAt: contract.endAt, windowMonths: settings?.windowMonths ?? 3, lines: d.lines, bal, commitments: d.commitments, items: d.items, ciBal, measurements: d.measurements, mItems: d.mItems, reservations: d.reservations });
  const live = new Set(d.raw.measurements.filter((m) => !m.superseded && m.status !== 'cancelada').map((m) => m.id));
  const retroPendingV4 = d.raw.retros.filter((r) => r.status === 'pendente' && live.has(r.measurementId)).reduce((a, r) => a + r.diffV4, 0);
  // a medição faturada já vale pelo preço reajustado; o retroativo ainda sem NF complementar não está faturado
  totals.invoiced = Math.max(0, totals.invoiced - retroPendingV4);
  const year = Number(today.slice(0, 4));
  const next = projection.years.find((y) => y.year === year + 1);
  const alerts = commitmentAlerts({
    today, lines: d.lines, bal, commitments: d.commitments, items: d.items, measurements: d.measurements, mItems: d.mItems, endAt: contract.endAt,
    agingDays: settings?.agingDays, toCommitAlertPct: settings?.toCommitPct ?? null,
    extras: { exhaustBefore: projection.exhaustBefore, nextInstallmentShort: projection.nextInstallmentShort, retroPendingV4, nextYear: next ? { year: next.year, needV4: next.needV4, hasCommitment: d.commitments.some((c) => !c.cancelled && c.fiscalYear === next.year) } : null },
  });
  return { bal, ciBal, totals, alerts, projection, retroPendingV4 };
}

/** Curva contratado × empenhado × executado × faturado (PF07.5). */
export function controlCurve(d: ControlData, startAt: string | null) {
  const lines = d.lines.map((l) => {
    const raw = d.raw.lines.find((x) => x.id === l.id)!;
    return { ...l, originalQty4: raw.qty4, qtyMoves: d.raw.lineMoves.filter((m) => m.lineId === l.id).map((m) => ({ qty4: m.kind === 'acrescimo' ? m.qty4 : -m.qty4, effectiveOn: m.effectiveOn })) };
  });
  const ms = d.measurements.map((m) => ({ ...m, invoiceDate: d.raw.measurements.find((x) => x.id === m.id)?.invoiceDate ?? null }));
  return commitmentCurve({ today: todayIso(), startAt, lines, commitments: d.commitments, items: d.items, measurements: ms, mItems: d.mItems });
}

/** Proporção entre fontes vigente na competência (a última versão com início ≤ competência). */
export function sharesAt(d: ControlData, competence: string): CShare[] {
  const v = d.raw.shareVersions.find((x) => x.validFrom <= competence);
  return v ? v.shares : [];
}

/** Preço do item numa competência (tabela reajustada vigente, RN08). */
export function linePriceAt(d: ControlData, lineId: string, competence: string) {
  const l = d.raw.lines.find((x) => x.id === lineId);
  return l ? priceAt(l, d.prices, competence) : 0;
}

/**
 * Baixa dos itens de uma medição (RN09/RN10). `except` = medição sendo refeita (o saldo dela volta antes).
 * FIFO por padrão; rateio pelas fontes quando o contrato confirmou essa ordem e há proporção vigente.
 * Devolve as alocações por item e o descoberto (pendência aguardando empenho).
 */
export function allocateItems(d: ControlData, competence: string, items: { lineId: string; qty4: number }[], except?: string, allocation: 'fifo' | 'rateio' = 'fifo') {
  const balances = commitmentItemBalances(d.items, d.measurements, d.mItems, except);
  const shares = allocation === 'rateio' ? sharesAt(d, competence) : [];
  return items.map((x) => { const r = allocateRateio(x.lineId, x.qty4, competence, { commitments: d.commitments, items: d.items, balances, shares }); return { ...x, allocations: r.allocations, uncovered4: r.uncovered4 }; });
}

/** Saldo do item contratual disponível para uma medição/reserva (RN04), sem contar a própria medição/oportunidade. */
export function availableFor(d: ControlData, lineId: string, opts: { exceptMeasurement?: string; exceptOpportunity?: string } = {}) {
  const ms = d.measurements.map((m) => (m.id === opts.exceptMeasurement ? { ...m, status: 'cancelada' as const } : m));
  const rs = d.reservations.filter((r) => r.opportunityId !== opts.exceptOpportunity);
  const b = lineBalances({ lines: d.lines.filter((l) => l.id === lineId), commitments: d.commitments, items: d.items, measurements: ms, mItems: d.mItems, reservations: rs })[0];
  return b?.available4 ?? 0;
}
