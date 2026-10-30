/**
 * Controle de Empenhos: carrega o histórico do contrato (itens, NEs, itens de empenho, medições e reservas da pipeline)
 * e calcula os saldos pelo domínio (packages/domain/src/commitments.ts). Nada aqui guarda saldo: tudo é recalculado.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  allocateRateio, commitmentAlerts, commitmentCurve, commitmentItemBalances, commitmentItemValues, commitmentProjection, contractTotals, lineBalances, priceAt,
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
  return (await controlDataMany(db, [contractId])).get(contractId)!;
}

/** O histórico de vários contratos em poucas consultas (uma por tabela), agrupado por contrato. */
export async function controlDataMany(db: DbOrTx, contractIds: string[]) {
  const out = new Map<string, ReturnType<typeof buildControlData>>();
  if (!contractIds.length) return out;
  const ids = contractIds;
  const [lines, commitments, measurements, reservations, lineMoves, sources, shareVersions, adjustments, retros] = await Promise.all([
    db.select().from(s.contractLines).where(inArray(s.contractLines.contractId, ids)).orderBy(asc(s.contractLines.position), asc(s.contractLines.createdAt)),
    db.select().from(s.contractCommitments).where(inArray(s.contractCommitments.contractId, ids)).orderBy(asc(s.contractCommitments.issuedOn), asc(s.contractCommitments.number)),
    db.select().from(s.contractMeasurements).where(inArray(s.contractMeasurements.contractId, ids)).orderBy(asc(s.contractMeasurements.competence), asc(s.contractMeasurements.createdAt)),
    db.select({ r: s.contractOpportunityLines, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage }).from(s.contractOpportunityLines)
      .innerJoin(s.opportunities, eq(s.opportunities.id, s.contractOpportunityLines.opportunityId))
      .where(and(inArray(s.contractOpportunityLines.contractId, ids), eq(s.contractOpportunityLines.status, 'reservada'))),
    db.select().from(s.contractLineMoves).where(inArray(s.contractLineMoves.contractId, ids)).orderBy(asc(s.contractLineMoves.effectiveOn)),
    db.select().from(s.contractRevenueSources).where(inArray(s.contractRevenueSources.contractId, ids)).orderBy(asc(s.contractRevenueSources.createdAt)),
    db.select().from(s.contractSourceShares).where(inArray(s.contractSourceShares.contractId, ids)).orderBy(desc(s.contractSourceShares.version)),
    db.select().from(s.contractAdjustments).where(inArray(s.contractAdjustments.contractId, ids)).orderBy(asc(s.contractAdjustments.startCompetence), asc(s.contractAdjustments.createdAt)),
    db.select().from(s.contractAdjustmentRetros).where(inArray(s.contractAdjustmentRetros.contractId, ids)),
  ]);
  const cIds = commitments.map((c) => c.id), mIds = measurements.map((m) => m.id), aIds = adjustments.map((a) => a.id);
  const [cItems, mItems, priceRows] = await Promise.all([
    cIds.length ? db.select().from(s.contractCommitmentItems).where(inArray(s.contractCommitmentItems.commitmentId, cIds)) : Promise.resolve([]),
    mIds.length ? db.select().from(s.contractMeasurementItems).where(inArray(s.contractMeasurementItems.measurementId, mIds)) : Promise.resolve([]),
    aIds.length ? db.select().from(s.contractLinePrices).where(inArray(s.contractLinePrices.adjustmentId, aIds)) : Promise.resolve([]),
  ]);
  const moves = cItems.length ? await db.select().from(s.contractCommitmentMoves).where(inArray(s.contractCommitmentMoves.commitmentItemId, cItems.map((i) => i.id))).orderBy(asc(s.contractCommitmentMoves.occurredOn)) : [];
  const by = <T,>(rows: T[], key: (r: T) => string) => { const m = new Map<string, T[]>(); for (const r of rows) { const k = key(r); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); } return m; };
  const commitmentContract = new Map(commitments.map((c) => [c.id, c.contractId]));
  const measurementContract = new Map(measurements.map((m) => [m.id, m.contractId]));
  const adjustmentContract = new Map(adjustments.map((a) => [a.id, a.contractId]));
  const itemContract = new Map(cItems.map((i) => [i.id, commitmentContract.get(i.commitmentId)!]));
  const g = {
    lines: by(lines, (x) => x.contractId), commitments: by(commitments, (x) => x.contractId), measurements: by(measurements, (x) => x.contractId),
    reservations: by(reservations, (x) => x.r.contractId), lineMoves: by(lineMoves, (x) => x.contractId), sources: by(sources, (x) => x.contractId),
    shareVersions: by(shareVersions, (x) => x.contractId), adjustments: by(adjustments, (x) => x.contractId), retros: by(retros, (x) => x.contractId),
    cItems: by(cItems, (x) => commitmentContract.get(x.commitmentId)!), mItems: by(mItems, (x) => measurementContract.get(x.measurementId)!),
    priceRows: by(priceRows, (x) => adjustmentContract.get(x.adjustmentId)!), moves: by(moves, (x) => itemContract.get(x.commitmentItemId)!),
  };
  for (const id of ids) {
    out.set(id, buildControlData({
      lines: g.lines.get(id) ?? [], commitments: g.commitments.get(id) ?? [], measurements: g.measurements.get(id) ?? [], reservations: g.reservations.get(id) ?? [],
      lineMoves: g.lineMoves.get(id) ?? [], sources: g.sources.get(id) ?? [], shareVersions: g.shareVersions.get(id) ?? [], adjustments: g.adjustments.get(id) ?? [],
      retros: g.retros.get(id) ?? [], cItems: g.cItems.get(id) ?? [], mItems: g.mItems.get(id) ?? [], priceRows: g.priceRows.get(id) ?? [], moves: g.moves.get(id) ?? [],
    }));
  }
  return out;
}

type RawRows = {
  lines: (typeof s.contractLines.$inferSelect)[]; commitments: (typeof s.contractCommitments.$inferSelect)[]; measurements: (typeof s.contractMeasurements.$inferSelect)[];
  reservations: { r: typeof s.contractOpportunityLines.$inferSelect; code: number; title: string; stage: string }[];
  lineMoves: (typeof s.contractLineMoves.$inferSelect)[]; sources: (typeof s.contractRevenueSources.$inferSelect)[]; shareVersions: (typeof s.contractSourceShares.$inferSelect)[];
  adjustments: (typeof s.contractAdjustments.$inferSelect)[]; retros: (typeof s.contractAdjustmentRetros.$inferSelect)[];
  cItems: (typeof s.contractCommitmentItems.$inferSelect)[]; mItems: (typeof s.contractMeasurementItems.$inferSelect)[]; priceRows: (typeof s.contractLinePrices.$inferSelect)[];
  moves: (typeof s.contractCommitmentMoves.$inferSelect)[];
};

function buildControlData(raw: RawRows) {
  const { lines, commitments, measurements, reservations, lineMoves, cItems, moves, mItems, priceRows } = raw;
  const prices: CPrice[] = priceRows.map((p) => ({ lineId: p.lineId, price4: p.price4, from: p.fromCompetence, adjustmentId: p.adjustmentId }));
  const today = todayIso().slice(0, 7);
  const movesByItem = new Map<string, typeof moves>();
  for (const m of moves) movesByItem.set(m.commitmentItemId, [...(movesByItem.get(m.commitmentItemId) ?? []), m]);
  // quantidade contratada = original + aditivos (acréscimo − supressão); preço = tabela vigente hoje (reajustes, PF08)
  const netQty = (l: (typeof lines)[number]) => l.qty4 + lineMoves.filter((m) => m.lineId === l.id).reduce((a, m) => a + (m.kind === 'acrescimo' ? m.qty4 : -m.qty4), 0);
  const dl: CLine[] = lines.map((l) => ({ id: l.id, itemNumber: l.itemNumber, description: l.description, unit: l.unit, classification: l.classification as LineClass, qty4: netQty(l), price4: priceAt(l, prices, today), monthlyQty4: l.monthlyQty4 }));
  const dc: CCommitment[] = commitments.map((c) => ({ id: c.id, number: c.number, fiscalYear: c.fiscalYear, issuedOn: c.issuedOn, cancelled: !!c.cancelledAt, source: c.source, sourceId: c.sourceId }));
  const di: CCommitmentItem[] = cItems.map((i) => {
    const mv = (movesByItem.get(i.id) ?? []).map((m) => ({ kind: m.kind as CommitmentMoveKind, qty4: m.qty4, value4: m.value4, occurredOn: m.occurredOn }));
    const adjust4 = mv.reduce((a, m) => a + (m.kind === 'reforco' ? m.qty4 : m.kind === 'reforco_valor' ? 0 : -m.qty4), 0);
    const valueAdjust4 = mv.reduce((a, m) => a + (m.kind === 'reforco_valor' ? m.value4 ?? 0 : 0), 0);
    return { id: i.id, commitmentId: i.commitmentId, lineId: i.lineId, code: i.code, itemNumber: i.itemNumber, qty4: i.qty4, adjust4, price4: i.price4, valueAdjust4, moves: mv };
  });
  const dm: CMeasurement[] = measurements.map((m) => ({ id: m.id, competence: m.competence, status: m.status as MeasurementStatus, superseded: m.superseded, title: m.title, kind: m.kind as MeasurementKind, createdAt: m.createdAt.toISOString(), attestedAt: m.attestedAt?.toISOString() ?? null }));
  const dmi: CMeasurementItem[] = mItems.map((x) => ({ measurementId: x.measurementId, lineId: x.lineId, qty4: x.qty4, price4: x.price4, allocations: x.allocations, uncovered4: x.uncovered4 }));
  const dr: CReservation[] = reservations.map((x) => ({ lineId: x.r.lineId, qty4: x.r.qty4, opportunityId: x.r.opportunityId }));
  return { raw, lines: dl, commitments: dc, items: di, measurements: dm, mItems: dmi, reservations: dr, prices };
}
export type ControlData = ReturnType<typeof buildControlData>;

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
  // empenho em R$: valor da nota fixo (preço da emissão + reforços de valor) − consumo pelo preço da medição
  const priceNow = new Map(d.lines.map((l) => [l.id, l.price4]));
  const ciVal = commitmentItemValues(d.items, d.measurements, d.mItems, (id) => priceNow.get(id) ?? 0);
  const activeNe = new Set(d.commitments.filter((c) => !c.cancelled).map((c) => c.id));
  const activeItems = d.items.filter((i) => activeNe.has(i.commitmentId));
  totals.committed = activeItems.reduce((a, i) => a + (ciVal.get(i.id)?.committedV4 ?? 0), 0);
  totals.commitmentBalance = activeItems.reduce((a, i) => a + (ciVal.get(i.id)?.balanceV4 ?? 0), 0);
  totals.committedPct = totals.contracted ? (totals.committed / totals.contracted) * 100 : null;
  const valueShort = d.commitments.filter((c) => activeNe.has(c.id)).map((c) => ({ number: c.number, deficitV4: d.items.filter((i) => i.commitmentId === c.id).reduce((a, i) => a + Math.max(0, -(ciVal.get(i.id)?.balanceV4 ?? 0)), 0) })).filter((x) => x.deficitV4 > 0);
  const projection = commitmentProjection({ today, startAt: contract.startAt, endAt: contract.endAt, windowMonths: settings?.windowMonths ?? 3, lines: d.lines, bal, commitments: d.commitments, items: d.items, ciBal, measurements: d.measurements, mItems: d.mItems, reservations: d.reservations });
  const live = new Set(d.raw.measurements.filter((m) => !m.superseded && m.status !== 'cancelada').map((m) => m.id));
  const retroPendingV4 = d.raw.retros.filter((r) => r.status === 'pendente' && live.has(r.measurementId)).reduce((a, r) => a + r.diffV4, 0);
  // a medição faturada já vale pelo preço reajustado; o retroativo dela ainda sem NF complementar não está faturado
  // (no reajuste que mantém o preço das medições abertas, a diferença fica só no retroativo, fora do valor da medição)
  const invoicedM = new Set(d.raw.measurements.filter((m) => m.status === 'faturada' && live.has(m.id)).map((m) => m.id));
  const inValue = d.raw.retros.filter((r) => r.status === 'pendente' && invoicedM.has(r.measurementId)).reduce((a, r) => a + r.items.reduce((t, i) => t + (d.raw.mItems.some((x) => x.measurementId === r.measurementId && x.lineId === i.lineId && x.price4 === i.newPrice4) ? i.diffV4 : 0), 0), 0);
  totals.invoiced = Math.max(0, totals.invoiced - inValue);
  const year = Number(today.slice(0, 4));
  const next = projection.years.find((y) => y.year === year + 1);
  const alerts = commitmentAlerts({
    today, lines: d.lines, bal, commitments: d.commitments, items: d.items, measurements: d.measurements, mItems: d.mItems, endAt: contract.endAt,
    agingDays: settings?.agingDays, toCommitAlertPct: settings?.toCommitPct ?? null,
    extras: { valueShort, exhaustBefore: projection.exhaustBefore, nextInstallmentShort: projection.nextInstallmentShort, retroPendingV4, nextYear: next ? { year: next.year, needV4: next.needV4, hasCommitment: d.commitments.some((c) => !c.cancelled && c.fiscalYear === next.year) } : null },
  });
  return { bal, ciBal, ciVal, totals, alerts, projection, retroPendingV4, valueShort };
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
