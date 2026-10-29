/**
 * Controle de Empenhos: carrega o histórico do contrato (itens, NEs, itens de empenho, medições e reservas da pipeline)
 * e calcula os saldos pelo domínio (packages/domain/src/commitments.ts). Nada aqui guarda saldo: tudo é recalculado.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  allocateFifo, commitmentAlerts, commitmentItemBalances, contractTotals, lineBalances,
  type CCommitment, type CCommitmentItem, type CLine, type CMeasurement, type CMeasurementItem, type CReservation, type LineClass, type MeasurementKind, type MeasurementStatus,
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
  const [lines, commitments, measurements, reservations] = await Promise.all([
    db.select().from(s.contractLines).where(eq(s.contractLines.contractId, contractId)).orderBy(asc(s.contractLines.position), asc(s.contractLines.createdAt)),
    db.select().from(s.contractCommitments).where(eq(s.contractCommitments.contractId, contractId)).orderBy(asc(s.contractCommitments.issuedOn), asc(s.contractCommitments.number)),
    db.select().from(s.contractMeasurements).where(eq(s.contractMeasurements.contractId, contractId)).orderBy(asc(s.contractMeasurements.competence), asc(s.contractMeasurements.createdAt)),
    db.select({ r: s.contractOpportunityLines, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage }).from(s.contractOpportunityLines)
      .innerJoin(s.opportunities, eq(s.opportunities.id, s.contractOpportunityLines.opportunityId))
      .where(and(eq(s.contractOpportunityLines.contractId, contractId), eq(s.contractOpportunityLines.status, 'reservada'))),
  ]);
  const ids = commitments.map((c) => c.id);
  const cItems = ids.length ? await db.select().from(s.contractCommitmentItems).where(inArray(s.contractCommitmentItems.commitmentId, ids)) : [];
  const moves = cItems.length ? await db.select().from(s.contractCommitmentMoves).where(inArray(s.contractCommitmentMoves.commitmentItemId, cItems.map((i) => i.id))).orderBy(asc(s.contractCommitmentMoves.occurredOn)) : [];
  const mIds = measurements.map((m) => m.id);
  const mItems = mIds.length ? await db.select().from(s.contractMeasurementItems).where(inArray(s.contractMeasurementItems.measurementId, mIds)) : [];
  const dl: CLine[] = lines.map((l) => ({ id: l.id, itemNumber: l.itemNumber, description: l.description, unit: l.unit, classification: l.classification as LineClass, qty4: l.qty4, price4: l.price4, monthlyQty4: l.monthlyQty4 }));
  const dc: CCommitment[] = commitments.map((c) => ({ id: c.id, number: c.number, fiscalYear: c.fiscalYear, issuedOn: c.issuedOn, cancelled: !!c.cancelledAt, source: c.source }));
  const di: CCommitmentItem[] = cItems.map((i) => ({ id: i.id, commitmentId: i.commitmentId, lineId: i.lineId, code: i.code, itemNumber: i.itemNumber, qty4: i.qty4, adjust4: moves.filter((m) => m.commitmentItemId === i.id).reduce((a, m) => a + (m.kind === 'reforco' ? m.qty4 : -m.qty4), 0) }));
  const dm: CMeasurement[] = measurements.map((m) => ({ id: m.id, competence: m.competence, status: m.status as MeasurementStatus, superseded: m.superseded, title: m.title, kind: m.kind as MeasurementKind, createdAt: m.createdAt.toISOString(), attestedAt: m.attestedAt?.toISOString() ?? null }));
  const dmi: CMeasurementItem[] = mItems.map((x) => ({ measurementId: x.measurementId, lineId: x.lineId, qty4: x.qty4, price4: x.price4, allocations: x.allocations, uncovered4: x.uncovered4 }));
  const dr: CReservation[] = reservations.map((x) => ({ lineId: x.r.lineId, qty4: x.r.qty4, opportunityId: x.r.opportunityId }));
  return { raw: { lines, commitments, cItems, moves, measurements, mItems, reservations }, lines: dl, commitments: dc, items: di, measurements: dm, mItems: dmi, reservations: dr };
}
export type ControlData = Awaited<ReturnType<typeof controlData>>;

/** Saldos, totais, alertas e pendências a partir do histórico. */
export function controlState(d: ControlData, endAt: string | null) {
  const bal = lineBalances({ lines: d.lines, commitments: d.commitments, items: d.items, measurements: d.measurements, mItems: d.mItems, reservations: d.reservations });
  const ciBal = commitmentItemBalances(d.items, d.measurements, d.mItems);
  const totals = contractTotals(d.lines, bal);
  const alerts = commitmentAlerts({ today: todayIso(), lines: d.lines, bal, commitments: d.commitments, items: d.items, measurements: d.measurements, mItems: d.mItems, endAt });
  return { bal, ciBal, totals, alerts };
}

/**
 * Baixa FIFO dos itens de uma medição (RN09/RN10). `except` = medição sendo refeita (o saldo dela volta antes).
 * Devolve as alocações por item e o descoberto (pendência aguardando empenho).
 */
export function allocateItems(d: ControlData, competence: string, items: { lineId: string; qty4: number }[], except?: string) {
  const balances = commitmentItemBalances(d.items, d.measurements, d.mItems, except);
  return items.map((x) => ({ ...x, ...allocateFifo(x.lineId, x.qty4, competence, { commitments: d.commitments, items: d.items, balances }) }));
}

/** Saldo do item contratual disponível para uma medição/reserva (RN04), sem contar a própria medição/oportunidade. */
export function availableFor(d: ControlData, lineId: string, opts: { exceptMeasurement?: string; exceptOpportunity?: string } = {}) {
  const ms = d.measurements.map((m) => (m.id === opts.exceptMeasurement ? { ...m, status: 'cancelada' as const } : m));
  const rs = d.reservations.filter((r) => r.opportunityId !== opts.exceptOpportunity);
  const b = lineBalances({ lines: d.lines.filter((l) => l.id === lineId), commitments: d.commitments, items: d.items, measurements: ms, mItems: d.mItems, reservations: rs })[0];
  return b?.available4 ?? 0;
}
