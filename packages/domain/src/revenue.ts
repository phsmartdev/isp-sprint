/**
 * Receita por mês a partir da base de contratos do CRM, para o Booking (crescimento sobre o ano anterior).
 *
 * Recorrente = mensal da versão do contrato em vigor no mês, dentro da janela de faturamento.
 * Medição = consumos − estornos lançados no mês (inclui as oportunidades de consumo).
 * Frequente = faturamentos lançados no mês.
 *
 * Comparável: o reajuste não é crescimento. Do recorrente de cada mês sai o que veio de reajuste nos
 * 12 meses anteriores (pelas versões de reajuste ou pelo valor do ano anterior informado no contrato).
 */
import { addDays, addMonths } from './contracts';

export type RevVersion = {
  version: number; changeKind: string; monthlyCents: number; createdAt: string; effectiveFrom: string | null;
  startAt: string | null; endAt: string | null; billingStartAt: string | null; activationAt: string | null;
};
/** Valor mensal do contrato num ano (informado), e se a diferença para o valor seguinte é só reajuste. */
export type RevYearValue = { year: number; monthlyCents: number; onlyAdjustment: boolean };
export type RevContract = { id: string; billingType: string; archivedAt: string | null; versions: RevVersion[]; yearValues: RevYearValue[] };
export type RevLedger = { contractId: string; kind: string; amountCents: number; occurredOn: string };
export type RevMonth = { month: string; recorrente: number; reajuste: number; medicao: number; frequente: number; total: number; comparavel: number };

const monthCache = new Map<string, { end: string; windowStart: string }>();
const monthInfo = (m: string) => {
  let x = monthCache.get(m);
  if (!x) { x = { end: addDays(addMonths(`${m}-01`, 1), -1), windowStart: addMonths(`${m}-01`, -11) }; monthCache.set(m, x); }
  return x;
};
/** Desde quando a versão vale: a 1ª vale desde sempre; renovação pelo início; o resto pela data de vigência ou de registro. */
export const effectiveOf = (v: RevVersion) => (v.version === 1 ? '0000-01-01' : v.effectiveFrom ?? (v.changeKind === 'renovacao' ? v.startAt : null) ?? v.createdAt.slice(0, 10));

/** Mensal recorrente do contrato no mês e quanto dele veio de reajuste nos 12 meses anteriores. */
const sortedCache = new WeakMap<RevVersion[], RevVersion[]>();
const sortedVersions = (c: RevContract) => {
  let v = sortedCache.get(c.versions);
  if (!v) { v = [...c.versions].sort((a, b) => a.version - b.version); sortedCache.set(c.versions, v); }
  return v;
};

export function recurringInMonth(c: RevContract, month: string) {
  if (c.billingType !== 'recorrente' || !c.versions.length) return { cents: 0, reajuste: 0 };
  const vs = sortedVersions(c);
  const { end, windowStart } = monthInfo(month);
  const first = `${month}-01`;
  const last = vs[vs.length - 1]!;
  const start = last.billingStartAt ?? vs.find((v) => v.billingStartAt)?.billingStartAt ?? last.activationAt ?? last.startAt;
  const stop = [last.endAt, c.archivedAt].filter(Boolean).sort()[0] ?? null;
  if (!start || start > end || (stop && stop < first)) return { cents: 0, reajuste: 0 };
  const year = Number(month.slice(0, 4));
  const informed = c.yearValues.find((y) => y.year === year);
  let v = vs[0]!;
  for (const x of vs) if (effectiveOf(x) <= end) v = x;
  const cents = informed ? informed.monthlyCents : v.monthlyCents;
  // reajustes registrados como versão, com vigência nos 12 meses até este mês
  let reajuste = 0;
  vs.forEach((x, i) => {
    if (i === 0 || x.changeKind !== 'reajuste') return;
    const eff = effectiveOf(x);
    if (eff >= windowStart && eff <= end) reajuste += Math.max(0, x.monthlyCents - vs[i - 1]!.monthlyCents);
  });
  // contrato cadastrado já reajustado: o valor do ano anterior informado mostra quanto foi reajuste
  const prev = c.yearValues.find((y) => y.year === year - 1);
  if (!informed && !reajuste && prev?.onlyAdjustment && cents > prev.monthlyCents) reajuste = cents - prev.monthlyCents;
  return { cents, reajuste: Math.min(reajuste, cents) };
}

/** Receita de cada mês do ano. */
export function revenueByMonth(contracts: RevContract[], ledger: RevLedger[], year: number): RevMonth[] {
  const type = new Map(contracts.map((c) => [c.id, c.billingType]));
  const byMonth = new Map<string, RevLedger[]>();
  for (const e of ledger) { const k = e.occurredOn.slice(0, 7); if (!k.startsWith(String(year))) continue; const a = byMonth.get(k); if (a) a.push(e); else byMonth.set(k, [e]); }
  const recurring = contracts.filter((c) => c.billingType === 'recorrente' && c.versions.length);
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    let recorrente = 0, reajuste = 0;
    for (const c of recurring) { const r = recurringInMonth(c, month); recorrente += r.cents; reajuste += r.reajuste; }
    const inMonth = byMonth.get(month) ?? [];
    const medicao = inMonth.filter((e) => type.get(e.contractId) === 'medicao').reduce((t, e) => t + (e.kind === 'consumo' ? e.amountCents : e.kind === 'estorno' ? -e.amountCents : 0), 0);
    const frequente = inMonth.filter((e) => type.get(e.contractId) === 'frequente' && e.kind === 'faturamento').reduce((t, e) => t + e.amountCents, 0);
    const total = recorrente + medicao + frequente;
    return { month, recorrente, reajuste, medicao, frequente, total, comparavel: total - reajuste };
  });
}

/** Crescimento acumulado até o mês: comparável do ano contra o realizado do ano anterior nos mesmos meses. */
export function growthToMonth(cur: RevMonth[], prev: RevMonth[], upTo: number) {
  const sum = (a: RevMonth[], k: keyof Omit<RevMonth, 'month'>) => a.slice(0, upTo).reduce((t, m) => t + (m[k] as number), 0);
  const base = sum(prev, 'total');
  const real = sum(cur, 'total');
  const comparable = sum(cur, 'comparavel');
  return {
    base, real, comparable, reajuste: sum(cur, 'reajuste'),
    growthReal: base ? (real / base - 1) * 100 : null,
    growthComparable: base ? (comparable / base - 1) * 100 : null,
  };
}
