/** Extrato dos contratos: saldo de medição, consumo pelas oportunidades e lançamentos de faturamento. */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { commitmentBalances, consumptionIndicator, ledgerTotals, monthlyConsumption } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';
import { brl } from './email';
import { addEvent } from './contracts';

export async function ledgerOf(db: DbOrTx, contractId: string) {
  const entries = await db.select().from(s.contractLedger).where(eq(s.contractLedger.contractId, contractId)).orderBy(asc(s.contractLedger.occurredOn), asc(s.contractLedger.createdAt));
  return { entries, totals: ledgerTotals(entries) };
}
export async function ledgerTotalsFor(db: DbOrTx, contractIds: string[]) {
  const m = new Map<string, ReturnType<typeof ledgerTotals>>();
  if (!contractIds.length) return m;
  const rows = await db.select({ contractId: s.contractLedger.contractId, kind: s.contractLedger.kind, amountCents: s.contractLedger.amountCents, occurredOn: s.contractLedger.occurredOn }).from(s.contractLedger).where(inArray(s.contractLedger.contractId, contractIds));
  for (const id of contractIds) m.set(id, ledgerTotals(rows.filter((r) => r.contractId === id)));
  return m;
}

/** Consumo líquido já lançado para a oportunidade (consumos − estornos). */
async function netConsumed(db: DbOrTx, opportunityId: string) {
  const [r] = await db.execute<{ n: string }>(sql`select coalesce(sum(case when kind = 'consumo' then amount_cents when kind = 'estorno' then -amount_cents else 0 end), 0)::bigint as n from contract_ledger where opportunity_id = ${opportunityId}`).then((x) => x.rows);
  return Number(r?.n ?? 0);
}

/** Venda fechada com contrato por medição: dá saída no saldo (bloqueia se não houver saldo). */
export async function consumeForOpportunity(db: DbOrTx, tenantId: string, actorId: string, opp: { id: string; code: number; title: string; measurementContractId: string | null; measurementCents: number | null; valueCents: number | null }) {
  if (!opp.measurementContractId) return null;
  if ((await netConsumed(db, opp.id)) > 0) return null;
  const amount = opp.measurementCents ?? opp.valueCents ?? 0;
  if (amount <= 0) throw unprocessable('Informe o valor a consumir do contrato por medição.', [{ path: 'measurementCents', message: 'Valor obrigatório' }]);
  const [c] = await db.select({ id: s.contracts.id, stage: s.contracts.stage, billingType: s.contracts.billingType, tenantId: s.contracts.tenantId }).from(s.contracts).where(and(eq(s.contracts.id, opp.measurementContractId), eq(s.contracts.tenantId, tenantId))).limit(1);
  if (!c || c.billingType !== 'medicao' || c.stage === 'arquivado') throw unprocessable('O contrato por medição escolhido não está disponível.');
  // trava o contrato para dois fechamentos simultâneos não passarem do saldo
  await db.execute(sql`select id from contracts where id = ${c.id} for update`);
  const { totals } = await ledgerOf(db, c.id);
  if (amount > totals.available) throw unprocessable(`Saldo insuficiente no contrato: disponível ${brl(totals.available)}, necessário ${brl(amount)}.`, [{ path: 'measurementCents', message: 'Saldo insuficiente' }]);
  const commitmentId = await pickCommitment(db, c.id, amount);
  const [e] = await db.insert(s.contractLedger).values({ tenantId, contractId: c.id, kind: 'consumo', amountCents: amount, occurredOn: new Date().toISOString().slice(0, 10), description: `OP-${opp.code} · ${opp.title}`, opportunityId: opp.id, commitmentId, createdBy: actorId }).returning({ id: s.contractLedger.id });
  await addEvent(db, tenantId, c.id, actorId, 'consumo', `Consumo de ${brl(amount)} pela oportunidade OP-${opp.code}. Saldo disponível: ${brl(totals.available - amount)}.`, { opportunityId: opp.id, amountCents: amount });
  return e!.id;
}

/** Venda reaberta: estorna o consumo dela. */
export async function reverseForOpportunity(db: DbOrTx, tenantId: string, actorId: string, opp: { id: string; code: number }) {
  const net = await netConsumed(db, opp.id);
  if (net <= 0) return null;
  const [last] = await db.select().from(s.contractLedger).where(and(eq(s.contractLedger.opportunityId, opp.id), eq(s.contractLedger.kind, 'consumo'))).orderBy(sql`${s.contractLedger.createdAt} desc`).limit(1);
  if (!last) return null;
  await db.insert(s.contractLedger).values({ tenantId, contractId: last.contractId, kind: 'estorno', amountCents: net, occurredOn: new Date().toISOString().slice(0, 10), description: `Estorno: OP-${opp.code} reaberta`, opportunityId: opp.id, reversesId: last.id, commitmentId: last.commitmentId, createdBy: actorId });
  await addEvent(db, tenantId, last.contractId, actorId, 'estorno', `Estorno de ${brl(net)}: oportunidade OP-${opp.code} reaberta.`, { opportunityId: opp.id });
  return last.id;
}

/** Empenhos do contrato com saldo calculado (o que foi faturado contra cada um). */
export async function commitmentsOf(db: DbOrTx, contractId: string) {
  const list = await db.select().from(s.contractCommitments).where(eq(s.contractCommitments.contractId, contractId)).orderBy(asc(s.contractCommitments.issuedOn), asc(s.contractCommitments.createdAt));
  if (!list.length) return [];
  const uses = await db.select({ commitmentId: s.contractLedger.commitmentId, kind: s.contractLedger.kind, amountCents: s.contractLedger.amountCents }).from(s.contractLedger).where(and(eq(s.contractLedger.contractId, contractId), inArray(s.contractLedger.kind, ['consumo', 'estorno', 'faturamento'])));
  const bal = commitmentBalances(list.map((c) => ({ id: c.id, amountCents: c.amountCents, cancelled: !!c.cancelledAt })), uses);
  return list.map((c, i) => ({ ...c, ...bal[i]! }));
}

/** Empenho para um faturamento: o mais antigo que cobre o valor; senão o mais antigo com saldo; sem empenho, null (vira alerta). */
export async function pickCommitment(db: DbOrTx, contractId: string, amount: number) {
  const list = (await commitmentsOf(db, contractId)).filter((c) => !c.cancelledAt && c.available > 0);
  return (list.find((c) => c.available >= amount) ?? list[0])?.id ?? null;
}

/** Indicador de consumo (medição) e empenhos (público) de um contrato. */
export async function consumptionOf(db: DbOrTx, c: { id: string; billingType: string; kind: string }, v: { startAt: string | null; endAt: string | null }, today = new Date().toISOString().slice(0, 10)) {
  const { entries, totals } = await ledgerOf(db, c.id);
  const monthly = monthlyConsumption(entries.map((e) => ({ kind: e.kind, amountCents: e.amountCents, occurredOn: String(e.occurredOn) })));
  const indicator = c.billingType === 'medicao' && totals.credited > 0 ? consumptionIndicator({ credited: totals.credited, consumed: totals.consumed, startAt: v.startAt, endAt: v.endAt, today, monthly }) : null;
  const commitments = c.kind === 'publico' ? await commitmentsOf(db, c.id) : null;
  return { indicator, monthly, commitments, billed: totals.billed };
}
