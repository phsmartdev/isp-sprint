/**
 * Motor financeiro da viabilidade econômica (especificação FINANCE-1.0 a 1.3, "ENT_MotorFinanceiroViabilidade").
 * Funções puras. Dinheiro em centavos; percentuais de entrada em pontos-base (1% = 100); frações internas (0,35 = 35%).
 *
 *   [1. Entradas & Escopo] → [2. Resolução Fiscal] → [3. Piso Mínimo] → [4. Preço Recomendado] → [5. DRE & Indicadores]
 *
 *   b = 1 − a − c − g                   (base líquida; precisa ser > 0)
 *   a = Σ (wᵢ × aᵢ)                      (alíquota ponderada pela participação de cada item na receita)
 *   F = Σ Fᵢ                             (tributos fixos em R$ por faturamento)
 *   Pontual:    P_caixa = (I + F) / b    P_eco = (I(1+r)^d + F) / b        P_margem = (I + F) / (b − m)
 *   Recorrente: D = min(N, D_alvo)       P_caixa = (O + F + I/D) / b       P_eco = (O + F + I/A(r,D)) / b
 *               A(r,D) = Σ 1/(1+r)^t     P_margem = (O + F) / (b − m)
 *   P_min = max(P_caixa, P_eco)          P_rec = max(P_min, P_margem)
 *   T(P) = P·a + F    MC = P − T(P) − cP − gP − O    VPL = Σ FCₜ/(1+r)^t    TIR: VPL(r*) = 0    payback com interpolação
 *
 * Tributo não é uma taxa sobreposta no fim: cada item resolve os tributos pelo vínculo Filial + Documento fiscal + Item.
 * Regra tributária ausente não trava a simulação: calcula com o que existe e marca "Calculável com ressalvas".
 */

// ------------------------------------------------------------------ documentos fiscais
export type FiscalTax = { name: string; percentBp: number; fixedCents: number; active: boolean; validFrom?: string | null; validTo?: string | null };
export type FiscalDoc = { id: string; branchId: string; code: string; name: string; active: boolean; taxes: FiscalTax[] };

/** Tributos do documento que valem hoje: alíquota somada (aᵢ) e valor fixo por faturamento (Fᵢ). */
export function fiscalDocRates(doc: Pick<FiscalDoc, 'taxes' | 'active'>, today: string) {
  const live = doc.active ? doc.taxes.filter((t) => t.active && (!t.validFrom || t.validFrom <= today) && (!t.validTo || t.validTo >= today)) : [];
  return { percentBp: live.reduce((s, t) => s + t.percentBp, 0), fixedCents: live.reduce((s, t) => s + t.fixedCents, 0), taxes: live.map((t) => t.name), complete: live.length > 0 };
}
export function fiscalDocErrors(d: { code: string; name: string; taxes: FiscalTax[] }) {
  const e: string[] = [];
  if (!d.code.trim()) e.push('Informe o código do documento (ex.: NFS-e).');
  if (d.name.trim().length < 2) e.push('Informe o nome do documento.');
  for (const t of d.taxes) {
    if (!t.name.trim()) e.push('Todo tributo precisa de nome.');
    if (!Number.isInteger(t.percentBp) || t.percentBp < 0 || t.percentBp > 10_000) e.push(`Alíquota inválida em ${t.name || 'tributo'}.`);
    if (!Number.isInteger(t.fixedCents) || t.fixedCents < 0) e.push(`Valor fixo inválido em ${t.name || 'tributo'}.`);
    if (t.validFrom && t.validTo && t.validTo < t.validFrom) e.push(`Vigência de ${t.name} termina antes de começar.`);
  }
  return e;
}

// ------------------------------------------------------------------ parâmetros e entradas
export type EconSettings = {
  /** m: margem de contribuição alvo sobre a receita bruta */ marginTargetBp: number;
  /** r: TMA mensal */ tmaMonthlyBp: number;
  /** c: comissão padrão sobre a receita bruta */ commissionBp: number;
  /** g: perda esperada / glosa padrão */ lossBp: number;
  /** D_alvo por segmento (meses) */ paybackMaxPrivate: number; paybackMaxPublic: number;
  /** Trava de segmento: retorno fora da política não vai para aprovação */ blockOutsidePolicy: boolean;
};
export const DEFAULT_ECON_SETTINGS: EconSettings = { marginTargetBp: 3500, tmaMonthlyBp: 150, commissionBp: 0, lossBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true };
export function econSettingsErrors(s: EconSettings) {
  const e: string[] = [];
  for (const [k, v] of [['Margem alvo', s.marginTargetBp], ['TMA', s.tmaMonthlyBp], ['Comissão', s.commissionBp], ['Perda/glosa', s.lossBp]] as const) if (!Number.isInteger(v) || v < 0 || v >= 10_000) e.push(`${k} inválida.`);
  if (!(s.paybackMaxPrivate >= 1 && s.paybackMaxPrivate <= 120) || !(s.paybackMaxPublic >= 1 && s.paybackMaxPublic <= 120)) e.push('Payback máximo entre 1 e 120 meses.');
  return e;
}

export const ECON_MODES = ['recorrente', 'pontual'] as const;
export type EconMode = (typeof ECON_MODES)[number];
export const ECON_MODE_LABELS: Record<EconMode, string> = { recorrente: 'Contrato recorrente (mensalidade)', pontual: 'Venda pontual (valor único)' };
export type CostLine = { description: string; qtyMilli: number; unitCents: number };
export type EconInput = {
  mode: EconMode;
  /** N: vigência do contrato em meses (recorrente) */ termMonths: number;
  /** d: mês em que o dinheiro entra (pontual; 0 = à vista) */ receiveMonth: number;
  /** I: itens de investimento inicial (CAPEX) */ capex: CostLine[];
  /** adicional inicial do CAPEX (frete, projeto, mobilização…) */ extraInitialCents: number;
  /** O: custos operacionais mensais */ opex: CostLine[];
  /** sobrescritas da negociação; null = padrão da empresa */ commissionBp: number | null; lossBp: number | null; marginTargetBp: number | null;
  /** P informado; null = itens da oportunidade */ priceCents: number | null;
};
export const emptyEconInput = (): EconInput => ({ mode: 'recorrente', termMonths: 12, receiveMonth: 0, capex: [], extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null });
export const costLineTotal = (l: CostLine) => Math.round((l.qtyMilli * l.unitCents) / 1000);
export function econInputErrors(i: EconInput) {
  const e: string[] = [];
  if (!(ECON_MODES as readonly string[]).includes(i.mode)) e.push('Tipo de venda inválido.');
  if (i.mode === 'recorrente' && !(Number.isInteger(i.termMonths) && i.termMonths >= 1 && i.termMonths <= 240)) e.push('Vigência entre 1 e 240 meses.');
  if (i.mode === 'pontual' && !(Number.isInteger(i.receiveMonth) && i.receiveMonth >= 0 && i.receiveMonth <= 60)) e.push('Mês de recebimento entre 0 (à vista) e 60.');
  for (const l of [...i.capex, ...i.opex]) {
    if (l.description.trim().length < 2) e.push('Todo custo precisa de descrição.');
    if (!Number.isInteger(l.qtyMilli) || l.qtyMilli <= 0 || !Number.isInteger(l.unitCents) || l.unitCents < 0) e.push(`Valores inválidos em ${l.description || 'custo'}.`);
  }
  for (const [k, v] of [['Comissão', i.commissionBp], ['Perda/glosa', i.lossBp], ['Margem alvo', i.marginTargetBp]] as const) if (v != null && (!Number.isInteger(v) || v < 0 || v >= 10_000)) e.push(`${k} inválida.`);
  if (i.priceCents != null && (!Number.isInteger(i.priceCents) || i.priceCents < 0)) e.push('Preço informado inválido.');
  if (!Number.isInteger(i.extraInitialCents) || i.extraInitialCents < 0) e.push('Adicional inicial inválido.');
  return e;
}

/** Item da oportunidade com a resolução fiscal do vínculo Filial + Documento + Item. doc null = sem regra (ressalva). */
export type EconItem = { description: string; revenueCents: number; doc: { name: string; percentBp: number; fixedCents: number; complete: boolean } | null };

// ------------------------------------------------------------------ cálculo
export const ECON_VERDICTS = ['viavel', 'abaixo_recomendado', 'fora_politica', 'abaixo_minimo', 'inviavel', 'sem_preco'] as const;
export type EconVerdict = (typeof ECON_VERDICTS)[number];
export const ECON_VERDICT_LABELS: Record<EconVerdict, string> = {
  viavel: 'Viável', abaixo_recomendado: 'Viável, abaixo do recomendado', fora_politica: 'Fora da política de payback',
  abaixo_minimo: 'Abaixo do preço mínimo', inviavel: 'Inviável: deduções consomem a receita', sem_preco: 'Sem preço para avaliar',
};

/** A(r,D) = Σ_{t=1..D} 1/(1+r)^t (com r = 0, vale D). */
export function annuityFactor(r: number, D: number) {
  if (D <= 0) return 0;
  if (r === 0) return D;
  let s = 0;
  for (let t = 1; t <= D; t++) s += 1 / (1 + r) ** t;
  return s;
}
export const npv = (flows: number[], r: number) => flows.reduce((s, f, t) => s + f / (1 + r) ** t, 0);
/** TIR mensal por bisseção (VPL = 0); null sem troca de sinal nos fluxos. */
export function irr(flows: number[]): number | null {
  if (!flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return null;
  let lo = -0.9999, hi = 10;
  let flo = npv(flows, lo), fhi = npv(flows, hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(flows, mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
/** Payback simples com interpolação: (k − 1) + saldo a recuperar no início do mês k ÷ FCₖ. */
export function paybackMonths(flows: number[]): number | null {
  let cum = flows[0] ?? 0;
  if (cum >= 0) return 0;
  for (let k = 1; k < flows.length; k++) {
    const f = flows[k]!;
    if (cum + f >= 0) return f > 0 ? k - 1 + -cum / f : k;
    cum += f;
  }
  return null;
}

export type EconResult = {
  mode: EconMode; publicSector: boolean;
  revenueCents: number; priceCents: number | null; priceSource: 'itens' | 'informado' | 'recomendado';
  rates: { a: number; c: number; g: number; m: number; r: number; b: number };
  fixedTaxCents: number; initialCents: number; monthlyCostCents: number;
  term: { N: number; Dalvo: number; D: number; d: number };
  items: { description: string; revenueCents: number; weight: number; percentBp: number; fixedCents: number; doc: string | null; pending: boolean }[];
  floor: { cashCents: number | null; economicCents: number | null; minCents: number | null };
  marginPriceCents: number | null; recommendedCents: number | null;
  /** indicadores no preço avaliado (P) */
  kpi: null | { taxCents: number; commissionCents: number; lossCents: number; contributionCents: number; marginPct: number; npvCents: number; irrMonthly: number | null; irrAnnual: number | null; paybackMonths: number | null };
  cashflow: number[];
  verdict: EconVerdict; withinPolicy: boolean | null; withReservations: boolean; warnings: string[];
};

const round = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v));

export function financeEngine(args: { input: EconInput; items: EconItem[]; settings: EconSettings; publicSector: boolean }): EconResult {
  const { input: inp, settings: st, publicSector } = args;
  const warnings: string[] = [];
  const bp = (v: number) => v / 10_000;
  // 1. entradas & escopo
  const revenue = args.items.reduce((s, i) => s + Math.max(0, i.revenueCents), 0);
  const I = inp.capex.reduce((s, l) => s + costLineTotal(l), 0) + inp.extraInitialCents;
  const O = inp.mode === 'recorrente' ? inp.opex.reduce((s, l) => s + costLineTotal(l), 0) : 0;
  if (inp.mode === 'pontual' && inp.opex.length) warnings.push('Venda pontual: custos mensais não entram no cálculo (use o investimento inicial).');
  // 2. resolução fiscal por item e ponderação pela receita
  const n = args.items.length;
  const items = args.items.map((i) => {
    const w = revenue > 0 ? Math.max(0, i.revenueCents) / revenue : n ? 1 / n : 0;
    const pending = !i.doc || !i.doc.complete;
    return { description: i.description, revenueCents: i.revenueCents, weight: w, percentBp: i.doc?.percentBp ?? 0, fixedCents: i.doc?.fixedCents ?? 0, doc: i.doc?.name ?? null, pending };
  });
  const a = items.reduce((s, i) => s + i.weight * bp(i.percentBp), 0);
  const F = items.reduce((s, i) => s + i.fixedCents, 0);
  const pendingItems = items.filter((i) => i.pending);
  if (!n) warnings.push('Sem produtos na oportunidade: sem tributos por item e sem preço pelos itens.');
  if (pendingItems.length) warnings.push(`${pendingItems.length} item(ns) sem documento fiscal ou sem tributos vigentes (${pendingItems.slice(0, 3).map((i) => i.description).join(', ')}${pendingItems.length > 3 ? '…' : ''}): calculado sem esses tributos.`);
  const c = bp(inp.commissionBp ?? st.commissionBp);
  const g = bp(inp.lossBp ?? st.lossBp);
  const m = bp(inp.marginTargetBp ?? st.marginTargetBp);
  const r = bp(st.tmaMonthlyBp);
  const b = 1 - a - c - g;
  const Dalvo = publicSector ? st.paybackMaxPublic : st.paybackMaxPrivate;
  const N = inp.mode === 'recorrente' ? inp.termMonths : 0;
  const D = inp.mode === 'recorrente' ? Math.min(N, Dalvo) : 0;
  const d = inp.mode === 'pontual' ? inp.receiveMonth : 0;

  // 3. piso mínimo e 4. preço recomendado
  let cash: number | null = null, eco: number | null = null, marginPrice: number | null = null;
  if (b > 0) {
    if (inp.mode === 'pontual') {
      cash = (I + F) / b;
      eco = (I * (1 + r) ** d + F) / b;
      marginPrice = b - m > 0 ? (I + F) / (b - m) : null;
    } else {
      cash = (O + F + (D ? I / D : 0)) / b;
      const A = annuityFactor(r, D);
      eco = (O + F + (A ? I / A : 0)) / b;
      marginPrice = b - m > 0 ? (O + F) / (b - m) : null;
    }
    if (marginPrice === null) warnings.push('A margem alvo é maior que a base líquida: não há preço que entregue essa margem.');
  } else warnings.push('Tributos, comissão e perdas somam 100% ou mais da receita: nenhum preço cobre os custos.');
  const minP = cash !== null && eco !== null ? Math.max(cash, eco) : null;
  const recP = minP !== null ? Math.max(minP, marginPrice ?? minP) : null;

  // 5. preço avaliado e indicadores
  const priceSource: EconResult['priceSource'] = inp.priceCents != null ? 'informado' : revenue > 0 ? 'itens' : 'recomendado';
  const P = inp.priceCents ?? (revenue > 0 ? revenue : recP);
  let kpi: EconResult['kpi'] = null;
  let flows: number[] = [];
  if (P != null && P > 0) {
    const T = P * a + F, comm = c * P, loss = g * P;
    const contribution = P - T - comm - loss - O;
    if (inp.mode === 'recorrente') flows = [-I, ...Array.from({ length: N }, () => contribution)];
    else { flows = Array.from({ length: d + 1 }, () => 0); flows[0] = -I; flows[d] = flows[d]! + contribution; }
    const ir = irr(flows);
    kpi = {
      taxCents: Math.round(T), commissionCents: Math.round(comm), lossCents: Math.round(loss), contributionCents: Math.round(contribution),
      marginPct: (inp.mode === 'pontual' ? (contribution - I) / P : contribution / P) * 100,
      npvCents: Math.round(npv(flows, r)), irrMonthly: ir, irrAnnual: ir === null ? null : (1 + ir) ** 12 - 1, paybackMonths: paybackMonths(flows),
    };
  }
  const pb = kpi?.paybackMonths ?? null;
  const withinPolicy = inp.mode === 'recorrente' && kpi ? I === 0 || (pb !== null && pb <= Dalvo) : null;
  let verdict: EconVerdict;
  if (b <= 0) verdict = 'inviavel';
  else if (!kpi || P == null) verdict = 'sem_preco';
  else if (minP !== null && P < Math.round(minP)) verdict = 'abaixo_minimo';
  else if (withinPolicy === false) verdict = 'fora_politica';
  else if (recP !== null && P < Math.round(recP)) verdict = 'abaixo_recomendado';
  else verdict = 'viavel';
  if (inp.mode === 'recorrente' && N < Dalvo && I > 0) warnings.push(`Vigência de ${N} meses menor que o limite de payback (${Dalvo}): o investimento é amortizado na vigência.`);

  return {
    mode: inp.mode, publicSector, revenueCents: revenue, priceCents: round(P), priceSource,
    rates: { a, c, g, m, r, b }, fixedTaxCents: F, initialCents: I, monthlyCostCents: O,
    term: { N, Dalvo, D, d }, items,
    floor: { cashCents: round(cash), economicCents: round(eco), minCents: round(minP) },
    marginPriceCents: round(marginPrice), recommendedCents: round(recP), kpi, cashflow: flows.map(Math.round),
    verdict, withinPolicy, withReservations: pendingItems.length > 0 || !n, warnings,
  };
}

/** Uma frase para o time entender o impacto, sem fórmulas. */
export function econHeadline(rs: EconResult, fmt: (c: number | null) => string) {
  const per = rs.mode === 'recorrente' ? '/mês' : '';
  if (rs.verdict === 'inviavel') return 'Tributos, comissão e perdas consomem toda a receita: revise a comissão, a perda esperada ou os documentos fiscais.';
  if (rs.verdict === 'sem_preco' || !rs.kpi) return `Informe o preço ou lance os produtos. O preço mínimo é ${fmt(rs.floor.minCents)}${per} e o recomendado ${fmt(rs.recommendedCents)}${per}.`;
  const k = rs.kpi;
  const pb = k.paybackMonths === null ? 'não se paga na vigência' : k.paybackMonths === 0 ? 'sem investimento a recuperar' : `o investimento volta em ${k.paybackMonths.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses (limite ${rs.term.Dalvo})`;
  const sobra = rs.mode === 'recorrente' ? `sobram ${fmt(k.contributionCents)} por mês (${k.marginPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da receita) depois de tributos, comissão, perdas e custos` : `o resultado é ${fmt(k.contributionCents - rs.initialCents)} (${k.marginPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da receita) depois de tributos, comissão, perdas e investimento`;
  return `Com ${fmt(rs.priceCents)}${per}, ${sobra}; ${pb}.`;
}

/** Soma `n` meses a 'AAAA-MM'. */
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/**
 * Fluxo de caixa consolidado: cada oportunidade começa no seu mês (mês 0 = investimento) e os fluxos
 * caem no calendário. Devolve entradas, saídas, saldo do mês e acumulado, até `maxMonths` meses.
 */
export function consolidateCashflow(entries: { startMonth: string; flows: number[] }[], maxMonths = 60) {
  if (!entries.length) return { months: [] as string[], inflow: [] as number[], outflow: [] as number[], net: [] as number[], cumulative: [] as number[] };
  const first = entries.map((e) => e.startMonth).sort()[0]!;
  const offset = (m: string) => { const [a, b] = first.split('-').map(Number) as [number, number]; const [c, d] = m.split('-').map(Number) as [number, number]; return (c * 12 + d) - (a * 12 + b); };
  const len = Math.min(maxMonths, Math.max(...entries.map((e) => offset(e.startMonth) + e.flows.length)));
  const inflow = Array.from({ length: len }, () => 0), outflow = Array.from({ length: len }, () => 0);
  for (const e of entries) {
    const o = offset(e.startMonth);
    e.flows.forEach((f, t) => { const k = o + t; if (k >= len) return; if (f >= 0) inflow[k]! += f; else outflow[k]! += f; });
  }
  const net = inflow.map((v, i) => v + outflow[i]!);
  let acc = 0;
  const cumulative = net.map((v) => (acc += v));
  return { months: Array.from({ length: len }, (_, i) => shiftMonth(first, i)), inflow, outflow, net, cumulative };
}
