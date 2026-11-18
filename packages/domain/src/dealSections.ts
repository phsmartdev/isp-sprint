/**
 * Seções da negociação (tipos de negócio): Venda, Aluguel e Recorrência, cada uma com os seus produtos, custos,
 * margem, payback e preço. Cada seção roda no motor financeiro (tributos dos documentos fiscais, contingências,
 * parâmetros e regras de aprovação da empresa) e a negociação junta as seções na visão geral.
 *
 * Regra das deduções:
 * - Venda: tudo é de pagamento único e deduz direto do preço (matéria-prima, mão de obra, parceiros, despesas).
 * - Recorrência e aluguel: só deduz o que é mensal. Custos únicos (matéria-prima e mão de obra da entrega, frete…)
 *   formam o investimento, que fica fora do preço e volta pela margem mensal (payback real, descontado pela TMA).
 *   O preço ideal é o maior entre o que atinge a margem e o que paga o investimento dentro do payback máximo.
 */
import {
  costLineTotal, financeEngine, type CostImpact, type CostLine, type DealKind, type EconInput, type EconItem, type EconResult,
  type EconSettings, type EconStatement, type EconVerdict, type EngineArgs,
} from './finance';

export const SECTION_KINDS = ['venda', 'locacao', 'recorrencia'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export const SECTION_KIND_LABELS: Record<SectionKind, string> = { venda: 'Venda', locacao: 'Aluguel', recorrencia: 'Recorrência' };
export const isMonthlySection = (k: SectionKind) => k !== 'venda';
export const MAX_SECTIONS = 10;

export const COST_CATEGORIES = ['materia_prima', 'mao_de_obra', 'parceiros', 'despesas_operacionais'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const COST_CATEGORY_LABELS: Record<CostCategory, string> = { materia_prima: 'Matéria-prima', mao_de_obra: 'Mão de obra', parceiros: 'Parceiros', despesas_operacionais: 'Despesas operacionais' };
export const COST_CATEGORY_SHORT: Record<CostCategory, string> = { materia_prima: 'Matéria-prima', mao_de_obra: 'Mão de obra', parceiros: 'Parceiros', despesas_operacionais: 'Desp. operacional' };
export type CostFrequency = 'unico' | 'mensal';

export type SectionCost = {
  description: string; qtyMilli: number; unitCents: number; unit?: string | null;
  /** dedução em que o custo entra; sem classificação o custo fica fora do cálculo */ category: CostCategory | null;
  frequency: CostFrequency; costItemId?: string | null; priceId?: string | null; manual?: boolean;
};
export type DealSection = {
  id: string; kind: SectionKind;
  /** recorrência e aluguel: vigência (meses) */ termMonths: number;
  /** venda: mês do recebimento (0 = à vista) */ receiveMonth: number;
  costs: SectionCost[];
  /** margem de contribuição pedida; null = sugestão da empresa */ marginTargetBp: number | null;
  /** recorrência e aluguel: payback máximo (meses); null = teto do setor */ paybackMonths: number | null;
  /** preço praticado (mensal na recorrência e no aluguel); null = o preço ideal */ priceCents: number | null;
};

export const dealKindOfSection = (k: SectionKind): DealKind => (k === 'venda' ? 'venda' : k);
export const sectionOfDealKind = (k: DealKind | null | undefined): SectionKind => (!k || k === 'venda' || k === 'servico' ? 'venda' : k);
export const impactOfCategory = (c: CostCategory, f: CostFrequency): CostImpact =>
  c === 'materia_prima' ? 'material' : c === 'mao_de_obra' ? 'servico' : c === 'parceiros' ? 'parceiro' : f === 'mensal' ? 'operacional' : 'entrega';
export const categoryOfImpact = (i: CostImpact | null | undefined): CostCategory | null =>
  i === 'material' ? 'materia_prima' : i === 'servico' ? 'mao_de_obra' : i === 'parceiro' ? 'parceiros' : i ? 'despesas_operacionais' : null;
export const sectionCostTotal = (c: Pick<SectionCost, 'qtyMilli' | 'unitCents'>) => costLineTotal({ description: '', qtyMilli: c.qtyMilli, unitCents: c.unitCents });

export function sectionErrors(secs: DealSection[]): string[] {
  const e: string[] = [];
  if (secs.length > MAX_SECTIONS) e.push(`No máximo ${MAX_SECTIONS} tipos de negócio por negociação.`);
  secs.forEach((s, k) => {
    const n = `Tipo de negócio ${k + 1} (${SECTION_KIND_LABELS[s.kind]})`;
    if (isMonthlySection(s.kind) && !(Number.isInteger(s.termMonths) && s.termMonths >= 1 && s.termMonths <= 240)) e.push(`${n}: vigência entre 1 e 240 meses.`);
    if (!isMonthlySection(s.kind) && !(Number.isInteger(s.receiveMonth) && s.receiveMonth >= 0 && s.receiveMonth <= 60)) e.push(`${n}: recebimento entre o mês 0 (à vista) e o 60.`);
    if (!isMonthlySection(s.kind) && s.costs.some((c) => c.frequency === 'mensal')) e.push(`${n}: na venda os custos são de pagamento único.`);
    if (s.paybackMonths != null && !(Number.isInteger(s.paybackMonths) && s.paybackMonths >= 1 && s.paybackMonths <= 240)) e.push(`${n}: payback entre 1 e 240 meses.`);
    if (s.costs.some((c) => c.qtyMilli <= 0 || c.unitCents < 0 || c.description.trim().length < 2)) e.push(`${n}: confira descrição, quantidade e valor dos custos.`);
  });
  if (new Set(secs.map((s) => s.id)).size !== secs.length) e.push('Seções com identificação repetida.');
  return e;
}

/**
 * Converte a viabilidade anterior (produtos com tipo; investimento por cesta e custos mensais) em seções: uma por tipo
 * de negócio presente nos produtos (serviço único vai para a Venda). itemSection = seção de cada produto, na ordem.
 */
export function sectionsFromLegacy(input: EconInput, items: Pick<EconItem, 'kind'>[]): { sections: DealSection[]; itemSection: number[] } {
  const present = SECTION_KINDS.filter((k) => items.some((i) => sectionOfDealKind(i.kind) === k));
  const kinds: SectionKind[] = present.length ? present : [input.mode === 'pontual' ? 'venda' : 'recorrencia'];
  const idx = (k: SectionKind) => kinds.indexOf(k);
  const firstMonthly = kinds.findIndex(isMonthlySection);
  const target = (k: DealKind | null | undefined, freq: CostFrequency) => {
    if (k) { const i = idx(sectionOfDealKind(k)); if (i >= 0 && (freq === 'unico' || isMonthlySection(kinds[i]!))) return i; }
    if (freq === 'mensal') return firstMonthly;
    return firstMonthly >= 0 && input.mode === 'recorrente' ? firstMonthly : 0;
  };
  const secs: DealSection[] = kinds.map((k, i) => ({ id: `s${i + 1}`, kind: k, termMonths: input.termMonths || 12, receiveMonth: input.receiveMonth || 0, costs: [], marginTargetBp: input.marginTargetBp ?? null, paybackMonths: input.paybackMonths ?? null, priceCents: null }));
  const toCost = (l: CostLine, frequency: CostFrequency): SectionCost => ({ description: l.description, qtyMilli: l.qtyMilli, unitCents: l.unitCents, unit: l.unit ?? null, category: frequency === 'mensal' && (!l.impact || l.impact === 'operacional') ? 'despesas_operacionais' : categoryOfImpact(l.impact), frequency, costItemId: l.costItemId ?? null, priceId: l.priceId ?? null, manual: l.manual });
  for (const l of input.capex) secs[target(l.kind, 'unico')]!.costs.push(toCost(l, 'unico'));
  if (input.extraInitialCents > 0) secs[target(null, 'unico')]!.costs.push({ description: 'Outras despesas de entrega e taxas', qtyMilli: 1000, unitCents: input.extraInitialCents, unit: null, category: 'despesas_operacionais', frequency: 'unico' });
  if (input.mode === 'recorrente') for (const l of input.opex) { const t = target(l.kind, 'mensal'); if (t >= 0) secs[t]!.costs.push(toCost(l, 'mensal')); }
  const monthly = secs.filter((s) => isMonthlySection(s.kind));
  const mixed = monthly.length > 0 && secs.some((s) => s.kind === 'venda');
  if (monthly.length === 1) monthly[0]!.priceCents = input.mode === 'recorrente' ? input.priceCents ?? null : null;
  const sale = secs.find((s) => s.kind === 'venda');
  if (sale) sale.priceCents = mixed ? input.salePriceCents ?? null : input.mode === 'pontual' ? input.priceCents ?? null : null;
  return { sections: secs, itemSection: items.map((i) => Math.max(0, idx(sectionOfDealKind(i.kind)))) };
}

/** Entrada do motor para uma seção: os custos classificados viram investimento (únicos) e custo mensal. */
export function sectionEngineInput(sec: DealSection, base: EconInput, priceCents: number | null): EconInput {
  const monthly = isMonthlySection(sec.kind);
  const line = (c: SectionCost): CostLine => ({ description: c.description, qtyMilli: c.qtyMilli, unitCents: c.unitCents, unit: c.unit ?? null, impact: impactOfCategory(c.category!, c.frequency), costItemId: c.costItemId ?? null, priceId: c.priceId ?? null, manual: c.manual, kind: null });
  const used = sec.costs.filter((c) => c.category);
  return {
    mode: monthly ? 'recorrente' : 'pontual', termMonths: monthly ? sec.termMonths : 12, receiveMonth: monthly ? 0 : sec.receiveMonth,
    capex: used.filter((c) => c.frequency === 'unico' || !monthly).map(line), extraInitialCents: 0,
    opex: monthly ? used.filter((c) => c.frequency === 'mensal').map(line) : [],
    commissionBp: null, lossBp: base.lossBp ?? null, variableBp: base.variableBp ?? null, marginTargetBp: sec.marginTargetBp,
    paybackMonths: null, priceCents, salePriceCents: null, fiscalYear: base.fiscalYear ?? null, b2g: null,
    investmentOutOfPrice: monthly, atProposed: true, sections: null,
  };
}

export type CategoryCents = Record<CostCategory, number>;
const zeroCats = (): CategoryCents => ({ materia_prima: 0, mao_de_obra: 0, parceiros: 0, despesas_operacionais: 0 });
/** Linha da DRE da negociação (contrato inteiro). result = margem de contribuição − investimento (recorrência e aluguel). */
export type SectionDre = { revenue: number; tax: number; costs: CategoryCents; contribution: number; investment: number; result: number };

export type SectionOutcome = {
  id: string; index: number; kind: SectionKind; monthly: boolean; itemCount: number; months: number; receiveMonth: number;
  /** preço ideal (maior entre margem, payback e faixa de margem líquida) e o preço praticado */
  idealCents: number | null; marginPriceCents: number | null; paybackPriceCents: number | null; priceCents: number | null; priceSource: 'ideal' | 'informado';
  /** um período: o mês (recorrência/aluguel, 1º mês) ou a venda */
  revenueCents: number; taxCents: number; deductions: CategoryCents; contributionCents: number; contributionPct: number | null;
  /** custos únicos da recorrência/aluguel (com contingência): o investimento que a margem mensal paga */
  investment: { totalCents: number; byCategory: CategoryCents };
  paybackMonths: number | null; paybackMaxMonths: number | null; paybackOk: boolean | null;
  marginTargetPct: number; marginOk: boolean | null; verdict: EconVerdict; withinPolicy: boolean | null; withReservations: boolean;
  unclassified: number; contract: SectionDre; cashflow: number[]; revenueFlow: number[]; warnings: string[];
};
export type SectionsOverview = {
  months: number; total: SectionDre; bySection: SectionDre[];
  /** séries acumuladas do contrato (índice 0 = início): receita, deduções (impostos e custos) e resultado (caixa, começa no investimento) */
  cumulative: { revenue: number[]; deductions: number[]; result: number[] };
  paybackMonth: number | null; netMarginPct: number | null;
};

const split = (total: number, base: CategoryCents): CategoryCents => {
  const sum = COST_CATEGORIES.reduce((t, c) => t + base[c], 0);
  const out = zeroCats();
  if (!(sum > 0) || !total) return out;
  let left = Math.round(total);
  const cats = COST_CATEGORIES.filter((c) => base[c] > 0);
  cats.forEach((c, k) => { const v = k === cats.length - 1 ? left : Math.round((total * base[c]) / sum); out[c] = v; left -= v; });
  return out;
};
const add = (a: CategoryCents, b: CategoryCents): CategoryCents => ({ materia_prima: a.materia_prima + b.materia_prima, mao_de_obra: a.mao_de_obra + b.mao_de_obra, parceiros: a.parceiros + b.parceiros, despesas_operacionais: a.despesas_operacionais + b.despesas_operacionais });
const ceil = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.ceil(v - 1e-6));
const VERDICT_RANK: EconVerdict[] = ['inviavel', 'sem_preco', 'aguardando_sugerido', 'sem_margem_liquida', 'abaixo_minimo', 'fora_politica', 'abaixo_faixa', 'abaixo_recomendado', 'acima_faixa', 'viavel'];
export const worstVerdict = (vs: EconVerdict[]): EconVerdict => vs.reduce<EconVerdict>((w, v) => (VERDICT_RANK.indexOf(v) < VERDICT_RANK.indexOf(w) ? v : w), 'viavel');

type SecArgs = Omit<EngineArgs, 'input' | 'items'> & { input: EconInput; items: EconItem[] };

/** Uma seção: preço ideal, resultado no preço praticado e as deduções por categoria. */
export function sectionOutcome(sec: DealSection, index: number, args: SecArgs): { outcome: SectionOutcome; result: EconResult } {
  const monthly = isMonthlySection(sec.kind);
  const kind = dealKindOfSection(sec.kind);
  const items = args.items.filter((i) => (i.section ?? 0) === index).map((i) => ({ ...i, kind: monthly ? kind : i.kind === 'servico' ? 'servico' as const : 'venda' as const }));
  const st: EconSettings = args.settings;
  const run = (P: number | null, quick = false) => financeEngine({ ...args, items, input: { ...sectionEngineInput(sec, args.input, P), skipRecommendation: quick } });
  // 1. preço que atinge a margem (e o mínimo da faixa de margem líquida, quando configurada)
  const r0 = run(null);
  const marginPrice = ceil(Math.max(r0.suggestedCents ?? 0, r0.recommendedCents ?? 0)) || null;
  const bandMin = r0.recommendation?.range?.min.priceCents ?? null;
  // 2. recorrência e aluguel: preço que paga o investimento dentro do payback máximo (payback descontado pela TMA)
  const Dmax = monthly ? sec.paybackMonths ?? (args.publicSector ? st.paybackMaxPublic : st.paybackMaxPrivate) : null;
  let paybackPrice: number | null = null;
  const inv = Math.max(0, -(r0.cashflow[0] ?? 0)) || (r0.investmentCents ?? 0);
  if (monthly && Dmax != null && inv > 0) {
    // o caixa mensal é linear no preço: duas simulações dão a reta e o preço que paga o investimento (com a TMA) em
    // Dmax meses sai direto; a conferência final no motor ajusta o centavo (poucas simulações, sem travar a tela)
    const pbAt = (P: number) => run(P, true).kpi?.paybackMonths ?? null;
    const ok = (P: number) => { const pb = pbAt(P); return pb != null && pb <= Dmax + 1e-9; };
    const cash = (P: number) => run(P, true).cashflow.slice(1, Math.max(2, Math.min(Dmax, 12) + 1));
    const p1 = Math.max(10_000, marginPrice ?? 10_000), p2 = p1 * 2;
    const c1 = cash(p1), c2 = cash(p2);
    const beta = ((c2[0] ?? 0) - (c1[0] ?? 0)) / (p2 - p1);
    const rM = r0.rates?.r ?? 0;
    // anuidade: fator que leva o caixa mensal constante ao valor presente de Dmax meses
    const ann = rM > 0 ? (1 - (1 + rM) ** -Dmax) / rM : Dmax;
    let guess = beta > 0 ? Math.ceil(p1 + (inv / ann - (c1[0] ?? 0)) / beta) : null;
    if (guess != null && guess > 0) {
      let lo = Math.max(0, Math.floor(guess * 0.97)), hi = guess;
      for (let i = 0; i < 6 && !ok(hi); i++) { lo = hi; hi = Math.ceil(hi * 1.05) + 100; }
      if (ok(hi)) { for (let i = 0; i < 14 && hi - lo > 1; i++) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) hi = mid; else lo = mid; } paybackPrice = hi; }
    }
    guess = null;
  }
  const cands = [marginPrice, paybackPrice, bandMin != null ? bandMin + 1 : null].filter((x): x is number => x != null && x > 0);
  const ideal = cands.length ? Math.max(...cands) : null;
  const price = sec.priceCents ?? ideal;
  const r = price != null ? run(price) : r0;

  // 3. deduções por categoria (bases sem contingência; o motor aplica a contingência e as despesas variáveis %)
  const used = sec.costs.filter((c) => c.category);
  const oneBase = zeroCats(), monBase = zeroCats();
  for (const c of used) (c.frequency === 'mensal' && monthly ? monBase : oneBase)[c.category!] += sectionCostTotal(c);
  const m1: EconStatement | undefined = r.statement?.month;
  const tot: EconStatement | undefined = r.statement?.total;
  const Inv = Math.round(r.investmentCents ?? r.initialCents ?? 0);
  const invCats = split(Inv, oneBase);
  const perPeriod = (s: EconStatement | undefined, months: number): { rev: number; tax: number; cats: CategoryCents; contribution: number } => {
    if (!s) return { rev: 0, tax: 0, cats: zeroCats(), contribution: 0 };
    const opex = split(s.opex, monBase);
    const varExp = s.commission;
    const cats = monthly ? { ...opex, despesas_operacionais: opex.despesas_operacionais + varExp } : add(split(s.amortization, oneBase), { ...zeroCats(), despesas_operacionais: varExp });
    void months;
    return { rev: s.revenue, tax: s.tax, cats, contribution: s.revenue - s.tax - COST_CATEGORIES.reduce((t, c) => t + cats[c], 0) };
  };
  const p1 = perPeriod(m1, 1);
  const N = monthly ? r.term.N : 1;
  // contrato: na recorrência o total do motor já desconta o investimento como amortização; aqui ele sai em linha própria
  const totNoInv: EconStatement | undefined = tot && monthly ? { ...tot, amortization: tot.amortization - Inv, contribution: tot.contribution + Inv } : tot;
  const pc = perPeriod(totNoInv, N);
  const contract: SectionDre = { revenue: pc.rev, tax: pc.tax, costs: pc.cats, contribution: pc.contribution, investment: monthly ? Inv : 0, result: pc.contribution - (monthly ? Inv : 0) };
  // receita por mês (índice 0 = início): reajuste depois do 12º mês, como no motor; venda no mês do recebimento
  const flowLen = Math.max(1, r.cashflow.length);
  const infl = r.rates?.inflationMonthly ?? 0;
  const revenueFlow = Array.from({ length: flowLen }, (_, k) => (monthly ? (k >= 1 && k <= N ? Math.round((m1?.revenue ?? 0) * (1 + infl) ** Math.max(0, k - 12)) : 0) : k === (r.term.d ?? 0) ? (m1?.revenue ?? 0) : 0));
  const pb = monthly ? r.kpi?.paybackMonths ?? null : null;
  const outcome: SectionOutcome = {
    id: sec.id, index, kind: sec.kind, monthly, itemCount: items.length, months: N, receiveMonth: monthly ? 0 : sec.receiveMonth,
    idealCents: ideal, marginPriceCents: marginPrice, paybackPriceCents: paybackPrice, priceCents: price, priceSource: sec.priceCents != null ? 'informado' : 'ideal',
    revenueCents: p1.rev, taxCents: p1.tax, deductions: p1.cats, contributionCents: p1.contribution, contributionPct: p1.rev > 0 ? (p1.contribution / p1.rev) * 100 : null,
    investment: { totalCents: monthly ? Inv : 0, byCategory: monthly ? invCats : zeroCats() },
    paybackMonths: pb, paybackMaxMonths: Dmax, paybackOk: monthly ? (inv > 0 ? pb != null && Dmax != null && pb <= Dmax : true) : null,
    marginTargetPct: (r.rates?.m ?? 0) * 100, marginOk: p1.rev > 0 ? (p1.contribution / p1.rev) * 100 >= (r.rates?.mMin ?? 0) * 100 - 0.005 : null,
    verdict: r.verdict, withinPolicy: r.withinPolicy, withReservations: r.withReservations,
    unclassified: sec.costs.length - used.length, contract, cashflow: r.cashflow, revenueFlow, warnings: r.warnings,
  };
  return { outcome, result: r };
}

const sumArrays = (as: number[][]) => { const n = Math.max(0, ...as.map((a) => a.length)); return Array.from({ length: n }, (_, k) => as.reduce((t, a) => t + (a[k] ?? 0), 0)); };
const cum = (a: number[]) => { let t = 0; return a.map((v) => (t += v)); };

/**
 * Negociação por seções: roda cada seção e junta tudo num resultado só (compatível com a aprovação, o histórico e a
 * inteligência): fluxo somado, pior veredito, reservas de qualquer seção, margem líquida do contrato somada.
 */
export function sectionsEngine(args: SecArgs): EconResult {
  const secs = args.input.sections ?? [];
  const runs = secs.map((s, k) => sectionOutcome(s, k, args));
  if (!runs.length) return financeEngine({ ...args, input: { ...args.input, sections: null } });
  const outs = runs.map((x) => x.outcome);
  const results = runs.map((x) => x.result);
  const main = results.reduce((best, r, k) => ((runs[k]!.outcome.contract.revenue > (runs[results.indexOf(best)]!.outcome.contract.revenue)) ? r : best), results[0]!);
  const cashflow = sumArrays(results.map((r) => r.cashflow));
  const revenueFlow = sumArrays(outs.map((o) => o.revenueFlow));
  const resultCum = cum(cashflow);
  const invTotal = outs.reduce((t, o) => t + o.investment.totalCents, 0);
  const revCum = cum(revenueFlow);
  const dedCum = revCum.map((v, k) => v - (resultCum[k]! + invTotal));
  const neg = resultCum.findIndex((v) => v < 0);
  const pbIdx = neg >= 0 ? resultCum.findIndex((v, k) => k > neg && v >= 0) : 0;
  const total: SectionDre = outs.reduce<SectionDre>((t, o) => ({ revenue: t.revenue + o.contract.revenue, tax: t.tax + o.contract.tax, costs: add(t.costs, o.contract.costs), contribution: t.contribution + o.contract.contribution, investment: t.investment + o.contract.investment, result: t.result + o.contract.result }), { revenue: 0, tax: 0, costs: zeroCats(), contribution: 0, investment: 0, result: 0 });
  // margem líquida do contrato (regra de aprovação): soma das DREs do motor (cada uma já com o investimento descontado)
  const nets = results.map((r) => (r.mode === 'recorrente' ? r.statement?.total : r.statement?.month));
  const netSum = nets.every((t) => t && t.net != null) ? nets.reduce((a, t) => a + t!.net!, 0) : null;
  const revSum = nets.reduce((a, t) => a + (t?.revenue ?? 0), 0);
  const netMarginPct = netSum != null && revSum > 0 ? (netSum / revSum) * 100 : null;
  const overview: SectionsOverview = { months: Math.max(0, cashflow.length - 1), total, bySection: outs.map((o) => o.contract), cumulative: { revenue: revCum, deductions: dedCum, result: resultCum }, paybackMonth: pbIdx >= 0 ? pbIdx : null, netMarginPct };
  const verdict = worstVerdict(results.map((r) => r.verdict));
  const withinPolicy = results.every((r) => r.withinPolicy === true) ? true : results.some((r) => r.withinPolicy === false) ? false : null;
  const checks = results.flatMap((r, k) => (r.autoApproval?.checks ?? []).map((c) => ({ label: `${SECTION_KIND_LABELS[outs[k]!.kind]} ${k + 1}: ${c.label}`, ok: c.ok })));
  const autoApproval = { ok: results.every((r) => r.autoApproval?.ok === true), checks };
  const priced = outs.filter((o) => o.priceCents != null);
  const monthlyPrice = priced.filter((o) => o.monthly).reduce((t, o) => t + (o.priceCents ?? 0), 0);
  const onePrice = priced.filter((o) => !o.monthly).reduce((t, o) => t + (o.priceCents ?? 0), 0);
  const warnings = [...new Set(results.flatMap((r, k) => r.warnings.map((w) => (results.length > 1 ? `${SECTION_KIND_LABELS[outs[k]!.kind]} ${k + 1}: ${w}` : w))))];
  return {
    ...main,
    priceCents: monthlyPrice || onePrice || null, priceSource: outs.every((o) => o.priceSource === 'informado') ? 'informado' : 'motor',
    cashflow, verdict, withinPolicy, withReservations: results.some((r) => r.withReservations),
    marginOk: results.every((r) => r.marginOk !== false) ? (results.some((r) => r.marginOk === true) ? true : null) : false,
    paybackOk: results.some((r) => r.paybackOk === false) ? false : results.some((r) => r.paybackOk === true) ? true : null,
    kpi: main.kpi ? { ...main.kpi, npvCents: results.reduce((t, r) => t + (r.kpi?.npvCents ?? 0), 0) } : null,
    decision: main.decision ? { ...main.decision, verdict, withinPolicy, netMarginPct: netMarginPct ?? main.decision.netMarginPct ?? null, contractNetMarginPct: netMarginPct, autoApproval } : main.decision,
    autoApproval, warnings, sections: outs, sectionsOverview: overview,
    // sugerido do topo no mesmo ritmo do preço: o mensal quando há seção mensal, senão o da venda
    suggestedCents: (outs.some((o) => o.monthly) ? outs.filter((o) => o.monthly) : outs).reduce((t, o) => t + (o.idealCents ?? 0), 0) || null,
  };
}
