/** Extrato dos contratos: saldo de medição, consumo pelas oportunidades e lançamentos de faturamento. */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { ledgerTotals } from '@isp/domain';
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
  const [e] = await db.insert(s.contractLedger).values({ tenantId, contractId: c.id, kind: 'consumo', amountCents: amount, occurredOn: new Date().toISOString().slice(0, 10), description: `OP-${opp.code} · ${opp.title}`, opportunityId: opp.id, createdBy: actorId }).returning({ id: s.contractLedger.id });
  await addEvent(db, tenantId, c.id, actorId, 'consumo', `Consumo de ${brl(amount)} pela oportunidade OP-${opp.code}. Saldo disponível: ${brl(totals.available - amount)}.`, { opportunityId: opp.id, amountCents: amount });
  return e!.id;
}

/** Venda reaberta: estorna o consumo dela. */
export async function reverseForOpportunity(db: DbOrTx, tenantId: string, actorId: string, opp: { id: string; code: number }) {
  const net = await netConsumed(db, opp.id);
  if (net <= 0) return null;
  const [last] = await db.select().from(s.contractLedger).where(and(eq(s.contractLedger.opportunityId, opp.id), eq(s.contractLedger.kind, 'consumo'))).orderBy(sql`${s.contractLedger.createdAt} desc`).limit(1);
  if (!last) return null;
  await db.insert(s.contractLedger).values({ tenantId, contractId: last.contractId, kind: 'estorno', amountCents: net, occurredOn: new Date().toISOString().slice(0, 10), description: `Estorno: OP-${opp.code} reaberta`, opportunityId: opp.id, reversesId: last.id, createdBy: actorId });
  await addEvent(db, tenantId, last.contractId, actorId, 'estorno', `Estorno de ${brl(net)}: oportunidade OP-${opp.code} reaberta.`, { opportunityId: opp.id });
  return last.id;
}
