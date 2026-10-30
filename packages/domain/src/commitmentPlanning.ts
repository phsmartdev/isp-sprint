/**
 * Controle de Empenhos — fase 2 (especificação "Controle de Contratos com Saldo"):
 *   PF08 reajuste por índice: nova tabela de preços por item (4 casas, RN07) com janela de vigência e retroativo
 *        calculado medição a medição para o que já foi faturado;
 *   RN09-a rateio proporcional entre fontes de receita (o restante do contrato segue FIFO);
 *   PF07 projeções: consumo médio mensal só das medições mensais (avulsos não contaminam), esgotamento por item,
 *        empenho e contrato, necessidade de empenho por exercício (RN10) e previsão de faturamento;
 *   PF07.5 curva contratado × empenhado × executado × faturado.
 */
import { allocateFifo, isFinal, isLive, value4, type CAllocation, type CCommitment, type CCommitmentItem, type CLine, type CMeasurement, type CMeasurementItem, type CReservation, type LineBalance } from './commitments';

// ------------------------------------------------------------------ competências (AAAA-MM)
export const compAddMonths = (comp: string, n: number) => {
  const y = Number(comp.slice(0, 4)), m = Number(comp.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
};
/** meses de `a` até `b`, inclusive (0 se b < a) */
export const compMonthsBetween = (a: string, b: string) => Math.max(0, (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1);
const maxC = (a: string, b: string) => (a > b ? a : b);
const minC = (a: string, b: string) => (a < b ? a : b);

// ------------------------------------------------------------------ PF08 reajuste
/** Índice multiplicador com 8 casas (1,0432 → 104_320_000). */
export const FACTOR = 100_000_000;
/**
 * Lê o índice como a pessoa digita: fator ("1,0432") ou percentual ("4,3215" ou "4,3215%"), até 4 casas decimais.
 * Devolve o fator ×10⁸ ou null se inválido.
 */
export function parseAdjustmentIndex(text: string, mode: 'fator' | 'percentual'): number | null {
  const t = text.trim().replace('%', '').replace(/\s/g, '');
  if (!/^-?\d{1,4}([.,]\d{1,4})?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const f = mode === 'fator' ? n : 1 + n / 100;
  if (f <= 0 || f > 10) return null;
  return Math.round(f * FACTOR);
}
export const factorToPct = (factor8: number) => ((factor8 - FACTOR) / FACTOR) * 100;

/** Tabela de preço de um item a partir de uma competência (a original é o preço do item). */
export type CPrice = { lineId: string; price4: number; from: string; adjustmentId: string };
/** Preço vigente do item numa competência: a última tabela com início ≤ competência; senão o original. */
export function priceAt(line: Pick<CLine, 'id' | 'price4'>, prices: CPrice[], competence: string) {
  let best: CPrice | null = null;
  for (const p of prices) if (p.lineId === line.id && p.from <= competence && (!best || p.from >= best.from)) best = p;
  return best ? best.price4 : line.price4;
}

/** Nova tabela: preço vigente na competência de início × índice, arredondado a 4 casas (RN07). */
export function adjustmentTable(lines: Pick<CLine, 'id' | 'price4'>[], prices: CPrice[], factor8: number, start: string) {
  return lines.map((l) => {
    const oldPrice4 = priceAt(l, prices, start);
    return { lineId: l.id, oldPrice4, newPrice4: Math.round((oldPrice4 * factor8) / FACTOR) };
  });
}

export type RetroItem = { lineId: string; qty4: number; oldPrice4: number; newPrice4: number; diffV4: number };
/**
 * Efeito do reajuste nas medições a partir da competência de início:
 *   faturadas → retroativo medição a medição (qtd × diferença de preço), a cobrar em NF complementar (PF05);
 *   ainda não faturadas → passam a valer pelo preço novo (RN08).
 */
export function retroactiveFor(measurements: CMeasurement[], mItems: CMeasurementItem[], table: { lineId: string; newPrice4: number }[], start: string, opts: { repriceOpen?: boolean } = {}) {
  // repriceOpen = false: as medições ainda não faturadas mantêm o preço lançado e a diferença também vira retroativo
  const repriceOpen = opts.repriceOpen ?? true;
  const np = new Map(table.map((t) => [t.lineId, t.newPrice4]));
  const invoiced: { measurementId: string; competence: string; title: string; items: RetroItem[]; diffV4: number }[] = [];
  const reprice: { measurementId: string; lineId: string; oldPrice4: number; newPrice4: number }[] = [];
  for (const m of measurements) {
    if (!isLive(m.status) || m.superseded || m.competence < start) continue;
    const its = mItems.filter((x) => x.measurementId === m.id && np.has(x.lineId) && np.get(x.lineId) !== x.price4);
    if (!its.length) continue;
    if (m.status === 'faturada' || !repriceOpen) {
      const items = its.map((x) => ({ lineId: x.lineId, qty4: x.qty4, oldPrice4: x.price4, newPrice4: np.get(x.lineId)!, diffV4: value4(x.qty4, np.get(x.lineId)!) - value4(x.qty4, x.price4) }));
      invoiced.push({ measurementId: m.id, competence: m.competence, title: m.title, items, diffV4: items.reduce((a, i) => a + i.diffV4, 0) });
    } else for (const x of its) reprice.push({ measurementId: m.id, lineId: x.lineId, oldPrice4: x.price4, newPrice4: np.get(x.lineId)! });
  }
  return { invoiced: invoiced.sort((a, b) => a.competence.localeCompare(b.competence)), reprice };
}

// ------------------------------------------------------------------ RN09-a rateio entre fontes de receita
/** Proporção de uma fonte em partes por milhão (100% = 1.000.000). */
export const PPM = 1_000_000;
export type CShare = { sourceId: string; ppm: number };

/** Divide a quantidade pelas proporções (maior resto), sem perder nem criar fração. */
export function splitByShares(qty4: number, shares: CShare[]) {
  const total = shares.reduce((a, s) => a + s.ppm, 0);
  const out = new Map<string, number>();
  if (!total) return out;
  const raw = shares.map((s) => ({ s, exact: (qty4 * s.ppm) / total }));
  let left = qty4;
  for (const r of raw) { const f = Math.floor(r.exact); out.set(r.s.sourceId, f); left -= f; }
  for (const r of [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))) {
    if (left <= 0) break;
    out.set(r.s.sourceId, out.get(r.s.sourceId)! + 1); left--;
  }
  return out;
}

/**
 * Rateio proporcional (RN09-a): a parte de cada fonte baixa nos empenhos daquela fonte (FIFO dentro da fonte, só do
 * exercício da competência). O que a fonte não cobrir fica aguardando empenho — cada fonte paga a sua parte.
 */
export function allocateRateio(lineId: string, qty4: number, competence: string, ctx: { commitments: CCommitment[]; items: CCommitmentItem[]; balances: Map<string, number>; shares: CShare[] }): { allocations: CAllocation[]; uncovered4: number; bySource: { sourceId: string; qty4: number; uncovered4: number }[] } {
  if (!ctx.shares.length) return { ...allocateFifo(lineId, qty4, competence, ctx), bySource: [] };
  const parts = splitByShares(qty4, ctx.shares);
  const allocations: CAllocation[] = [];
  const bySource: { sourceId: string; qty4: number; uncovered4: number }[] = [];
  let uncovered4 = 0;
  for (const [sourceId, part] of parts) {
    if (part <= 0) continue;
    const r = allocateFifo(lineId, part, competence, { commitments: ctx.commitments.filter((c) => c.sourceId === sourceId), items: ctx.items, balances: ctx.balances });
    allocations.push(...r.allocations);
    uncovered4 += r.uncovered4;
    bySource.push({ sourceId, qty4: part, uncovered4: r.uncovered4 });
  }
  return { allocations, uncovered4, bySource };
}

// ------------------------------------------------------------------ PF07 projeções
export type LineProjection = {
  lineId: string; itemNumber: string;
  /** consumo médio mensal (medições mensais na janela) e, à parte, o avulso (não entra na projeção) */
  avgMonthly4: number; avgAvulso4: number;
  /** base da projeção: média das medições mensais, franquia cadastrada ou sem base */
  basis: 'media' | 'franquia' | 'sem_base';
  rate4: number;
  remaining4: number;
  monthsLeft: number | null;
  /** competência em que o saldo acaba no ritmo atual */
  exhaustCompetence: string | null;
  /** saldo que sobra no fim da vigência (negativo = falta) */
  leftoverAtEnd4: number | null;
  status: 'esgota_antes' | 'sobra' | 'ok' | 'sem_base';
};

export type ProjectionInput = {
  today: string; startAt: string | null; endAt: string | null; windowMonths: number;
  /** itens com o preço vigente hoje */
  lines: CLine[]; bal: LineBalance[];
  commitments: CCommitment[]; items: CCommitmentItem[]; ciBal: Map<string, number>;
  measurements: CMeasurement[]; mItems: CMeasurementItem[]; reservations: CReservation[];
  /** meses da previsão de faturamento */
  forecastMonths?: number;
};

const counts = (m: CMeasurement) => isLive(m.status) && !m.superseded;

export function commitmentProjection(a: ProjectionInput) {
  const today = a.today.slice(0, 7);
  const live = new Map(a.measurements.filter(counts).map((m) => [m.id, m]));
  // o mês atual com medição mensal já lançada não é consumo futuro: a projeção começa no mês seguinte
  const cur = [...live.values()].some((m) => m.kind === 'mensal' && m.competence === today) ? compAddMonths(today, 1) : today;
  const end = a.endAt ? a.endAt.slice(0, 7) : null;
  const winFrom = compAddMonths(cur, -a.windowMonths), winTo = compAddMonths(cur, -1);
  const monthsLeft = end ? compMonthsBetween(cur, end) : null;

  const lines: LineProjection[] = a.lines.map((l) => {
    const b = a.bal.find((x) => x.lineId === l.id)!;
    let mensal = 0, avulso = 0;
    for (const x of a.mItems) {
      if (x.lineId !== l.id) continue;
      const m = live.get(x.measurementId);
      if (!m || m.competence < winFrom || m.competence > winTo) continue;
      if (m.kind === 'mensal') mensal += x.qty4; else avulso += x.qty4;
    }
    const avgMonthly4 = Math.round(mensal / a.windowMonths), avgAvulso4 = Math.round(avulso / a.windowMonths);
    const basis: LineProjection['basis'] = avgMonthly4 > 0 ? 'media' : l.classification === 'recorrente' && l.monthlyQty4 ? 'franquia' : 'sem_base';
    const rate4 = basis === 'media' ? avgMonthly4 : basis === 'franquia' ? l.monthlyQty4! : 0;
    const remaining4 = Math.max(0, b.contracted4 - b.executed4 - b.pending4);
    const exhaustCompetence = rate4 > 0 ? compAddMonths(cur, Math.max(0, Math.ceil(remaining4 / rate4) - 1)) : null;
    const leftoverAtEnd4 = monthsLeft != null && rate4 > 0 ? remaining4 - rate4 * monthsLeft : null;
    // a média tem 4 casas: até meia unidade (×10.000) de arredondamento por mês não é falta
    const tol = monthsLeft ?? 0;
    // "ok" = termina a vigência com menos de um mês de consumo sobrando
    const status: LineProjection['status'] = rate4 <= 0 ? 'sem_base' : leftoverAtEnd4 == null ? 'ok' : leftoverAtEnd4 < -tol ? 'esgota_antes' : leftoverAtEnd4 >= rate4 ? 'sobra' : 'ok';
    return { lineId: l.id, itemNumber: l.itemNumber, avgMonthly4, avgAvulso4, basis, rate4, remaining4, monthsLeft, exhaustCompetence, leftoverAtEnd4, status };
  });
  const lp = new Map(lines.map((x) => [x.lineId, x]));
  const price = new Map(a.lines.map((l) => [l.id, l.price4]));

  // por empenho: até quando cobre, consumindo os empenhos do ano na ordem FIFO de cada item
  const year = Number(today.slice(0, 4));
  const yearNes = a.commitments.filter((c) => !c.cancelled && c.fiscalYear === year).sort((x, y) => x.issuedOn.localeCompare(y.issuedOn) || x.number.localeCompare(y.number));
  const coverUntil = new Map<string, string | null>();
  const before = new Map<string, number>();
  for (const c of yearNes) {
    let until = null as string | null;
    for (const i of a.items.filter((x) => x.commitmentId === c.id)) {
      const r = lp.get(i.lineId)?.rate4 ?? 0;
      const bal4 = Math.max(0, a.ciBal.get(i.id) ?? 0);
      const prev = before.get(i.lineId) ?? 0;
      before.set(i.lineId, prev + bal4);
      if (r <= 0) continue;
      // meses inteiros cobertos pelos empenhos do item até esta NE (k = 0: já não cobre o mês atual)
      const comp = compAddMonths(cur, Math.floor((prev + bal4) / r) - 1);
      until = until == null || comp < until ? comp : until;
    }
    coverUntil.set(c.id, until);
  }
  const yearEnd = end ? minC(end, `${year}-12`) : `${year}-12`;
  const commitments = yearNes.map((c) => ({ commitmentId: c.id, number: c.number, coversUntil: coverUntil.get(c.id) ?? null, shortBeforeYearEnd: (coverUntil.get(c.id) ?? yearEnd) < yearEnd }));

  // necessidade de empenho por exercício (RN10): consumo projetado nos meses de vigência de cada ano − NE do ano
  const years: { year: number; months: number; projectedV4: number; coveredV4: number; needV4: number }[] = [];
  if (end) {
    const left = new Map(lines.map((x) => [x.lineId, x.remaining4]));
    for (let y = year; y <= Number(end.slice(0, 4)); y++) {
      const from = maxC(cur, `${y}-01`), to = minC(end, `${y}-12`);
      const months = compMonthsBetween(from, to);
      let projectedV4 = 0, coveredV4 = 0, needV4 = 0;
      for (const x of lines) {
        const q = Math.min(left.get(x.lineId)!, x.rate4 * months);
        left.set(x.lineId, left.get(x.lineId)! - q);
        const cov = a.items.filter((i) => i.lineId === x.lineId && a.commitments.some((c) => c.id === i.commitmentId && !c.cancelled && c.fiscalYear === y)).reduce((s, i) => s + Math.max(0, a.ciBal.get(i.id) ?? 0), 0);
        const p = price.get(x.lineId) ?? 0;
        projectedV4 += value4(q, p); coveredV4 += value4(Math.min(cov, q), p); needV4 += value4(Math.max(0, q - cov), p);
      }
      years.push({ year: y, months, projectedV4, coveredV4, needV4 });
    }
  }

  // previsão de faturamento: recorrentes pela média/franquia (até o saldo acabar), já executado sem nota, pipeline
  const n = a.forecastMonths ?? 6;
  const left2 = new Map(lines.map((x) => [x.lineId, x.remaining4]));
  const forecast: { competence: string; recurringV4: number }[] = [];
  for (let k = 0; k < n; k++) {
    const comp = compAddMonths(cur, k);
    if (end && comp > end) break;
    let v = 0;
    for (const x of lines) {
      const q = Math.min(left2.get(x.lineId)!, x.rate4);
      left2.set(x.lineId, left2.get(x.lineId)! - q);
      v += value4(q, price.get(x.lineId) ?? 0);
    }
    forecast.push({ competence: comp, recurringV4: v });
  }
  let toInvoiceV4 = 0;
  for (const x of a.mItems) { const m = live.get(x.measurementId); if (m && m.status !== 'faturada') toInvoiceV4 += value4(x.qty4, x.price4); }
  const pipelineV4 = a.reservations.reduce((s, r) => s + value4(r.qty4, price.get(r.lineId) ?? 0), 0);

  // contrato: valor sem base de projeção (itens sob demanda) e sobra projetada
  const noBasisV4 = lines.filter((x) => x.status === 'sem_base').reduce((s, x) => s + value4(x.remaining4, price.get(x.lineId) ?? 0), 0);
  const leftoverV4 = lines.reduce((s, x) => s + (x.leftoverAtEnd4 && x.leftoverAtEnd4 > 0 ? value4(x.leftoverAtEnd4, price.get(x.lineId) ?? 0) : 0), 0);
  const shortV4 = lines.reduce((s, x) => s + (x.leftoverAtEnd4 && x.leftoverAtEnd4 < 0 ? value4(-x.leftoverAtEnd4, price.get(x.lineId) ?? 0) : 0), 0);

  // próxima parcela: saldo de empenho do ano por item × consumo projetado de um mês
  const nextInstallmentShort = lines.filter((x) => x.rate4 > 0 && x.remaining4 > 0 && (before.get(x.lineId) ?? 0) < Math.min(x.rate4, x.remaining4)).map((x) => x.itemNumber);

  return {
    window: { from: winFrom, to: winTo, months: a.windowMonths }, from: cur, monthsLeft, lines, commitments, years, forecast, toInvoiceV4, pipelineV4, noBasisV4, leftoverV4, shortV4, nextInstallmentShort,
    exhaustBefore: lines.filter((x) => x.status === 'esgota_antes').map((x) => ({ itemNumber: x.itemNumber, competence: x.exhaustCompetence! })),
  };
}
export type CommitmentProjection = ReturnType<typeof commitmentProjection>;

// ------------------------------------------------------------------ PF07.5 curva
/**
 * Curva mês a mês (acumulada) das quatro linhas. O empenhado acompanha emissão, reforço,
 * anulação, supressão e reforço de valor pelas datas, no preço da emissão da NE; executado pela competência das medições atestadas/faturadas; faturado pela data da NF.
 */
export function commitmentCurve(a: { today: string; startAt: string | null; lines: (CLine & { qtyMoves?: { qty4: number; effectiveOn: string }[]; originalQty4?: number })[]; commitments: CCommitment[]; items: CCommitmentItem[]; measurements: (CMeasurement & { invoiceDate?: string | null })[]; mItems: CMeasurementItem[] }) {
  const cur = a.today.slice(0, 7);
  const starts = [a.startAt?.slice(0, 7), ...a.commitments.map((c) => c.issuedOn.slice(0, 7)), ...a.measurements.filter(counts).map((m) => m.competence)].filter((x): x is string => !!x && x <= cur);
  if (!starts.length) return [];
  const first = starts.reduce((x, y) => (x < y ? x : y));
  const n = Math.min(120, compMonthsBetween(first, cur));
  const price = new Map(a.lines.map((l) => [l.id, l.price4]));
  const active = new Map(a.commitments.filter((c) => !c.cancelled).map((c) => [c.id, c]));
  const live = a.measurements.filter(counts);
  const out: { competence: string; contractedV4: number; committedV4: number; executedV4: number; invoicedV4: number }[] = [];
  for (let k = 0; k < n; k++) {
    const comp = compAddMonths(first, k);
    const eom = `${comp}-31`;
    const contractedV4 = a.lines.reduce((s, l) => s + value4((l.originalQty4 ?? l.qty4) + (l.qtyMoves ?? []).filter((x) => x.effectiveOn <= eom).reduce((t, x) => t + x.qty4, 0), l.price4), 0);
    let committedV4 = 0;
    for (const i of a.items) {
      const c = active.get(i.commitmentId);
      if (!c || c.issuedOn > eom) continue;
      const ms = i.moves ? i.moves.filter((m) => m.occurredOn <= eom) : null;
      const p = i.price4 ?? price.get(i.lineId) ?? 0;
      committedV4 += ms
        ? value4(i.qty4, p) + ms.reduce((t, m) => t + (m.kind === 'reforco' ? value4(m.qty4, p) : m.kind === 'reforco_valor' ? m.value4 ?? 0 : -(m.value4 ?? value4(m.qty4, p))), 0)
        : value4(i.qty4 + i.adjust4, p) + (i.valueAdjust4 ?? 0);
    }
    let executedV4 = 0, invoicedV4 = 0;
    for (const m of live) {
      const its = a.mItems.filter((x) => x.measurementId === m.id);
      const v = its.reduce((s, x) => s + value4(x.qty4, x.price4), 0);
      if (isFinal(m.status) && m.competence <= comp) executedV4 += v;
      if (m.status === 'faturada' && (m.invoiceDate ?? `${m.competence}-28`) <= eom) invoicedV4 += v;
    }
    out.push({ competence: comp, contractedV4, committedV4, executedV4, invoicedV4 });
  }
  return out;
}
