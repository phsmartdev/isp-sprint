/** Receita da base de contratos do CRM por mês (Booking): carrega versões, valores informados por ano e lançamentos. */
import { and, eq, isNull } from 'drizzle-orm';
import { growthToMonth, revenueByMonth, type RevContract, type RevLedger } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { groupBy } from './group';

export async function revenueInputs(db: DbOrTx, tenantId: string) {
  const cs = await db.select({ id: s.contracts.id, billingType: s.contracts.billingType, archivedAt: s.contracts.archivedAt, validatedAt: s.contracts.validatedAt, createdAt: s.contracts.createdAt }).from(s.contracts).where(eq(s.contracts.tenantId, tenantId));
  const vs = await db.select({ contractId: s.contractVersions.contractId, version: s.contractVersions.version, changeKind: s.contractVersions.changeKind, monthlyCents: s.contractVersions.monthlyCents, createdAt: s.contractVersions.createdAt, effectiveFrom: s.contractVersions.effectiveFrom, startAt: s.contractVersions.startAt, endAt: s.contractVersions.endAt, billingStartAt: s.contractVersions.billingStartAt, activationAt: s.contractVersions.activationAt })
    .from(s.contractVersions).where(eq(s.contractVersions.tenantId, tenantId));
  const ys = await db.select().from(s.contractYearValues).where(and(eq(s.contractYearValues.tenantId, tenantId), isNull(s.contractYearValues.supersededAt)));
  const ledger: RevLedger[] = (await db.select({ contractId: s.contractLedger.contractId, kind: s.contractLedger.kind, amountCents: s.contractLedger.amountCents, occurredOn: s.contractLedger.occurredOn }).from(s.contractLedger).where(eq(s.contractLedger.tenantId, tenantId)));
  const vBy = groupBy(vs, (v) => v.contractId);
  const yBy = groupBy(ys, (y) => y.contractId);
  // só contratos validados entram na receita (cadastro em validação ainda não é contrato)
  const contracts: (RevContract & { createdAt: string })[] = cs.filter((c) => c.validatedAt).map((c) => ({
    id: c.id, billingType: c.billingType, archivedAt: c.archivedAt ? c.archivedAt.toISOString().slice(0, 10) : null, createdAt: c.createdAt.toISOString().slice(0, 10),
    versions: (vBy.get(c.id) ?? []).map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
    yearValues: (yBy.get(c.id) ?? []).map((y) => ({ year: y.year, monthlyCents: y.monthlyCents, onlyAdjustment: y.onlyAdjustment })),
  }));
  const valid = new Set(contracts.map((c) => c.id));
  return { contracts, ledger: ledger.filter((e) => valid.has(e.contractId)) };
}

/** Receita do ano e do anterior, crescimento acumulado e o que falta informar para a comparação ficar justa. */
export async function revenueReport(db: DbOrTx, tenantId: string, year: number, today: string) {
  const { contracts, ledger } = await revenueInputs(db, tenantId);
  const cur = revenueByMonth(contracts, ledger, year);
  const prev = revenueByMonth(contracts, ledger, year - 1);
  const upTo = Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) : Number(today.slice(0, 4)) > year ? 12 : 0;
  const quarters = [1, 2, 3, 4].map((q) => {
    const sl = (a: typeof cur) => a.slice((q - 1) * 3, Math.min(q * 3, q * 3));
    const months = Math.max(0, Math.min(3, upTo - (q - 1) * 3));
    const g = months ? growthToMonth(sl(cur), sl(prev), months) : null;
    return { q, months, ...(g ?? { base: 0, real: 0, comparable: 0, reajuste: 0, growthReal: null, growthComparable: null }) };
  });
  const sum = (a: typeof cur, n = 12) => a.slice(0, n).reduce((t, m) => t + m.total, 0);
  // recorrentes que já existiam no ano anterior (início antes do ano) cadastrados no ano, sem valor do ano anterior informado
  const missingHistory = contracts.filter((c) => c.billingType === 'recorrente' && Number(c.createdAt.slice(0, 4)) >= year && !c.yearValues.some((y) => y.year === year - 1)
    && c.versions.some((v) => v.version === 1 && (v.billingStartAt ?? v.startAt ?? '9999') < `${year}-01-01`)).map((c) => c.id);
  return {
    year, upTo, months: cur, prevMonths: prev, quarters,
    ytd: upTo ? growthToMonth(cur, prev, upTo) : null,
    totals: { [year - 1]: sum(prev), [year]: sum(cur), [`${year}_ate_mes`]: sum(cur, upTo), [`${year - 1}_ate_mes`]: sum(prev, upTo) },
    missingHistory: missingHistory.length,
  };
}
