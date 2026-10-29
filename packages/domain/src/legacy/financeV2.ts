/** Cópia congelada do motor 2.0 antes do Financial Studio: referência dos testes de compatibilidade (não usar na aplicação). */
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
/** Versão do motor gravada em cada cálculo salvo (muda quando uma regra de cálculo muda). */
export const ENGINE_VERSION = 'FINANCE-2.0/isp-3';

/**
 * Parâmetros da empresa, informados em Configurações → Viabilidade com data de vigência.
 * Não há valor padrão no código: sem parâmetros vigentes a viabilidade não calcula.
 */
export type EconSettings = {
  /** piso da margem de contribuição (abaixo dele a venda sai da política) */ marginTargetBp: number;
  /** teto e sugestão da margem que o vendedor escolhe (a sugestão inicia a tela); ausentes em versões antigas */ marginMaxBp?: number | null; marginSuggestedBp?: number | null;
  /** TMA mensal (derivada da anual nas versões novas) */ tmaMonthlyBp: number;
  /** TMA anual (custo de capital); a mensal é (1 + anual)^(1/12) − 1 */ tmaAnnualBp?: number | null;
  /** reajuste anual esperado (IPCA/IGP-M): a receita sobe a partir do 13º mês */ inflationAnnualBp?: number | null;
  /** horizonte máximo da projeção de caixa (meses) */ horizonMaxMonths?: number | null;
  /** inadimplência esperada sobre o faturamento (a glosa é por segmento) */ badDebtBp?: number | null;
  /** c: comissão padrão sobre a receita bruta */ commissionBp: number;
  /** g: perda esperada / glosa padrão por segmento */ lossPrivateBp: number; lossPublicBp: number;
  /** contingência sobre o investimento inicial e sobre os custos mensais */ contingencyCapexBp: number; contingencyOpexBp: number;
  /** D_alvo por segmento (meses), comparado ao payback descontado */ paybackMaxPrivate: number; paybackMaxPublic: number;
  /** Trava: venda fora da política não vai para aprovação */ blockOutsidePolicy: boolean;
  /** despesas fixas rateadas (estrutura, administrativo) em % da receita bruta → margem operacional; ausente em versões antigas */ overheadBp?: number | null;
  /** IR/CSLL sobre o resultado operacional positivo → margem líquida; ausente em versões antigas */ incomeTaxBp?: number | null;
  /**
   * Comparativo com o modelo histórico da empresa (só informativo, não entra na decisão): fator × 100 sobre o
   * investimento na venda pontual (ex.: 250 = ×2,5) e sobre o custo mensal na recorrente (ex.: 320 = ×3,2). Ausente = não mostra.
   */
  legacyOneTimeX100?: number | null; legacyRecurringX100?: number | null;
};
export function econSettingsErrors(s: EconSettings) {
  const e: string[] = [];
  for (const [k, v] of [['Margem mínima', s.marginTargetBp], ['TMA', s.tmaMonthlyBp], ['Comissão', s.commissionBp], ['Glosa do setor privado', s.lossPrivateBp], ['Glosa do setor público', s.lossPublicBp], ['Contingência de investimento', s.contingencyCapexBp], ['Contingência de custo mensal', s.contingencyOpexBp], ...(s.overheadBp != null ? [['Despesas fixas', s.overheadBp] as const] : []), ...(s.incomeTaxBp != null ? [['IR/CSLL', s.incomeTaxBp] as const] : [])] as const) if (!Number.isInteger(v) || v < 0 || v >= 10_000) e.push(`${k} inválida.`);
  for (const [k, v] of [['Teto da margem', s.marginMaxBp], ['Sugestão de margem', s.marginSuggestedBp], ['TMA anual', s.tmaAnnualBp], ['Inflação anual', s.inflationAnnualBp], ['Inadimplência', s.badDebtBp]] as const) if (v != null && (!Number.isInteger(v) || v < 0 || v >= 100_000)) e.push(`${k} inválida.`);
  if (s.marginMaxBp != null && s.marginMaxBp < s.marginTargetBp) e.push('O teto da margem precisa ser maior ou igual ao piso.');
  if (s.marginSuggestedBp != null && (s.marginSuggestedBp < s.marginTargetBp || (s.marginMaxBp != null && s.marginSuggestedBp > s.marginMaxBp))) e.push('A sugestão de margem precisa ficar entre o piso e o teto.');
  if (s.horizonMaxMonths != null && !(Number.isInteger(s.horizonMaxMonths) && s.horizonMaxMonths >= 1 && s.horizonMaxMonths <= 240)) e.push('Prazo máximo de previsão entre 1 e 240 meses.');
  for (const [k, v] of [['Fator histórico da venda pontual', s.legacyOneTimeX100], ['Fator histórico da recorrente', s.legacyRecurringX100]] as const) if (v != null && (!Number.isInteger(v) || v < 100 || v > 2000)) e.push(`${k} entre ×1 e ×20.`);
  if (!(s.paybackMaxPrivate >= 1 && s.paybackMaxPrivate <= 120) || !(s.paybackMaxPublic >= 1 && s.paybackMaxPublic <= 120)) e.push('Payback máximo entre 1 e 120 meses.');
  return e;
}

export const ECON_MODES = ['recorrente', 'pontual'] as const;
export type EconMode = (typeof ECON_MODES)[number];
export const ECON_MODE_LABELS: Record<EconMode, string> = { recorrente: 'Contrato recorrente (mensalidade)', pontual: 'Venda pontual (valor único)' };
/** "Impacta o quê?" de cada custo da planilha: define onde ele entra no cálculo. */
export const COST_IMPACTS = ['material', 'servico', 'operacional', 'entrega', 'taxa_venda'] as const;
export type CostImpact = (typeof COST_IMPACTS)[number];
export const COST_IMPACT_LABELS: Record<CostImpact, string> = { material: 'Material/Equipamento', servico: 'Serviço/Mão de obra', operacional: 'Custo operacional', entrega: 'Despesa de entrega', taxa_venda: 'Taxa fixa de venda' };
/** Despesa de entrega e taxa fixa de venda são despesas variáveis em R$: entram no preço, mas fora do investimento (sem contingência). */
export const isVariableFixed = (impact?: CostImpact | null) => impact === 'entrega' || impact === 'taxa_venda';
/** Linha de custo; costItemId/priceId = veio do catálogo (com a versão do preço); manual = valor diferente do catálogo. */
export type CostLine = { description: string; qtyMilli: number; unitCents: number; unit?: string | null; impact?: CostImpact | null; costItemId?: string | null; priceId?: string | null; manual?: boolean };
export type EconInput = {
  mode: EconMode;
  /** N: vigência do contrato em meses (recorrente) */ termMonths: number;
  /** d: mês em que o dinheiro entra (pontual; 0 = à vista) */ receiveMonth: number;
  /** I: itens de investimento inicial (CAPEX) */ capex: CostLine[];
  /** adicional inicial do CAPEX (frete, projeto, mobilização…) */ extraInitialCents: number;
  /** O: custos operacionais mensais */ opex: CostLine[];
  /** sobrescritas da negociação; null = padrão da empresa (margem: a sugestão, limitada ao piso e ao teto) */ commissionBp: number | null; lossBp: number | null; marginTargetBp: number | null;
  /** payback que o vendedor define (meses), até o teto do segmento; null = o teto */ paybackMonths?: number | null;
  /** P informado; null = itens da oportunidade */ priceCents: number | null;
};
export const emptyEconInput = (): EconInput => ({ mode: 'recorrente', termMonths: 12, receiveMonth: 0, capex: [], extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, paybackMonths: null, priceCents: null });
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
  for (const [k, v] of [['Comissão', i.commissionBp], ['Perda/glosa', i.lossBp], ['Margem mínima', i.marginTargetBp]] as const) if (v != null && (!Number.isInteger(v) || v < 0 || v >= 10_000)) e.push(`${k} inválida.`);
  if (i.priceCents != null && (!Number.isInteger(i.priceCents) || i.priceCents < 0)) e.push('Preço informado inválido.');
  if (!Number.isInteger(i.extraInitialCents) || i.extraInitialCents < 0) e.push('Adicional inicial inválido.');
  if (i.paybackMonths != null && !(Number.isInteger(i.paybackMonths) && i.paybackMonths >= 1 && i.paybackMonths <= 240)) e.push('Payback entre 1 e 240 meses.');
  for (const l of i.capex) if (l.impact && !(COST_IMPACTS as readonly string[]).includes(l.impact)) e.push(`Impacto inválido em ${l.description}.`);
  return e;
}

/** Item da oportunidade com a resolução fiscal do vínculo Filial + Documento + Item. doc null = sem regra (ressalva). */
export type EconItem = { description: string; revenueCents: number; doc: { id?: string; version?: number; name: string; percentBp: number; fixedCents: number; complete: boolean } | null };

// ------------------------------------------------------------------ cálculo
export const ECON_VERDICTS = ['viavel', 'abaixo_recomendado', 'fora_politica', 'abaixo_minimo', 'inviavel', 'sem_preco'] as const;
export type EconVerdict = (typeof ECON_VERDICTS)[number];
export const ECON_VERDICT_LABELS: Record<EconVerdict, string> = {
  viavel: 'Viável', abaixo_recomendado: 'Abaixo da margem mínima', fora_politica: 'Fora da política de payback',
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
/**
 * Payback com interpolação: (k − 1) + saldo a recuperar no início do mês k ÷ FCₖ.
 * Com r > 0 é o payback descontado (cada FCₖ trazido a valor presente pela TMA); r = 0 = simples.
 */
export function paybackMonths(flows: number[], r = 0): number | null {
  let cum = flows[0] ?? 0;
  if (cum >= 0) return 0;
  for (let k = 1; k < flows.length; k++) {
    const f = flows[k]! / (1 + r) ** k;
    if (cum + f >= 0) return f > 0 ? k - 1 + -cum / f : k;
    cum += f;
  }
  return null;
}

/** Valores de um período do desdobramento (mês 1 ou o contrato inteiro). */
export type EconStatement = { revenue: number; tax: number; commission: number; opex: number; amortization: number; contribution: number; risk: number; overhead: number | null; operating: number | null; incomeTax: number | null; net: number | null };

export type EconResult = {
  engineVersion: string;
  mode: EconMode; publicSector: boolean;
  /** P = preço informado; sem ele, o total dos produtos; sem produtos, o preço exato do motor */
  revenueCents: number; priceCents: number | null; priceSource: 'itens' | 'informado' | 'motor';
  /**
   * a tributos ponderados · c comissão · g glosa e inadimplência (risco) · m margem escolhida (entre piso e teto) ·
   * r TMA mensal · b base líquida de caixa (1 − a − c − g) · (v2) glosa e inadimplência separadas, base do markup e limites da margem
   */
  rates: { a: number; c: number; g: number; m: number; r: number; b: number; glosa?: number; badDebt?: number; bMarkup?: number; mMin?: number; mMax?: number | null; inflationMonthly?: number; tmaAnnual?: number | null };
  /** F: tributo fixo, contado uma vez por documento fiscal (por fatura) */
  fixedTaxCents: number;
  /** I (investimento) e O (custo mensal) já com contingência; as bases e as contingências vêm separadas */
  initialCents: number; monthlyCostCents: number;
  capexBaseCents: number; capexContingencyCents: number; opexBaseCents: number; opexContingencyCents: number;
  /** (v2) despesas variáveis em R$ de valor único (entrega, taxa fixa de venda): sem contingência; investimento total = I + E */
  variableFixedCents?: number; investmentCents?: number;
  /** N meses projetados (vigência limitada ao horizonte máximo) · Dalvo teto de payback · D payback do vendedor · d mês do recebimento */
  term: { N: number; Dalvo: number; D: number; d: number; termMonths?: number; horizon?: number | null; paybackAsked?: number | null };
  items: { description: string; revenueCents: number; weight: number; percentBp: number; fixedCents: number; doc: string | null; docVersion?: number | null; pending: boolean }[];
  floor: { cashCents: number | null; economicCents: number | null; minCents: number | null };
  /** preço da margem mínima (piso) e recomendado (preço exato na margem escolhida, nunca abaixo do mínimo) */
  marginPriceCents: number | null; recommendedCents: number | null;
  /** (v2) preço exato pelo markup divisor na margem escolhida */
  markupPriceCents?: number | null;
  /** preço em que a margem operacional zera (cobre amortização e despesas fixas); null sem o parâmetro de despesas fixas */
  operatingFloorCents?: number | null;
  /** sugestão de preço mínimo de venda: o maior entre caixa/TMA, margem mínima e margem operacional zero */
  suggestedMinCents?: number | null;
  /** indicadores no preço avaliado (P); paybackMonths = descontado pela TMA (é o que a política usa) */
  kpi: null | { taxCents: number; commissionCents: number; lossCents: number; contributionCents: number; marginPct: number; npvCents: number; irrMonthly: number | null; irrAnnual: number | null; paybackMonths: number | null; simplePaybackMonths: number | null;
    /**
     * cadeia de margens (por mês na recorrente, na venda na pontual): contribuição → operacional → líquida (− IR/CSLL
     * sobre o operacional positivo). null = parâmetro não informado.
     */
    margins?: { contributionPct: number; amortizationCents: number; overheadCents: number | null; operatingCents: number | null; operatingPct: number | null; incomeTaxCents: number | null; netCents: number | null; netPct: number | null };
    /** (v2) fluxo do 1º mês, amortização do investimento no payback e ROI */
    cashMonthlyCents?: number; amortizationCents?: number; roiPct?: number | null;
  };
  cashflow: number[];
  /** (v2) desdobramento: 1º mês e contrato inteiro (com o reajuste) */
  statement?: { month: EconStatement; total: EconStatement };
  /** política: margem mínima atingida e payback descontado dentro do limite do segmento */
  marginOk: boolean | null; paybackOk: boolean | null;
  verdict: EconVerdict; withinPolicy: boolean | null; withReservations: boolean; warnings: string[];
  /** (v2) aprovação automática: VPL > 0, TIR > TMA, payback e margem na política; senão vai para a alçada */
  autoApproval?: { ok: boolean; checks: { label: string; ok: boolean }[] };
};

/** Contribuição → operacional → líquida, no mesmo período da contribuição (mês na recorrente). */
export function marginChain(P: number, contribution: number, amortization: number, st: Pick<EconSettings, 'overheadBp' | 'incomeTaxBp'>, risk = 0) {
  const pct = (v: number) => (v / P) * 100;
  const overhead = st.overheadBp != null ? (P * st.overheadBp) / 10_000 : null;
  const operating = overhead != null ? contribution - amortization - risk - overhead : null;
  const tax = operating != null && st.incomeTaxBp != null ? (Math.max(0, operating) * st.incomeTaxBp) / 10_000 : null;
  const net = operating != null && tax != null ? operating - tax : null;
  const r0 = (v: number | null) => (v == null ? null : Math.round(v));
  return { contributionPct: pct(contribution), amortizationCents: Math.round(amortization), overheadCents: r0(overhead), operatingCents: r0(operating), operatingPct: operating == null ? null : pct(operating), incomeTaxCents: r0(tax), netCents: r0(net), netPct: net == null ? null : pct(net) };
}

const round = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** TMA mensal: da anual quando informada, senão a mensal das versões antigas. */
export const monthlyTma = (st: Pick<EconSettings, 'tmaMonthlyBp' | 'tmaAnnualBp'>) => (st.tmaAnnualBp != null ? (1 + st.tmaAnnualBp / 10_000) ** (1 / 12) - 1 : st.tmaMonthlyBp / 10_000);

/**
 * Motor financeiro (FINANCE-2.0), conforme a especificação do motor:
 * 1. entradas: investimento (com contingência), despesas variáveis em R$, custo mensal, tributos ponderados por item;
 * 2. preço exato pelo markup divisor: (custos em R$) ÷ (1 − tributos − despesas variáveis − margem), com o investimento
 *    amortizado no payback definido pelo vendedor (até o teto do segmento) e a margem entre o piso e o teto;
 * 3. fluxo de caixa no horizonte (vigência limitada ao prazo máximo): receita reajustada após o 12º mês, menos glosa,
 *    inadimplência, tributos, comissão e custos; VPL e payback pela TMA (anual → mensal), TIR e ROI;
 * 4. decisão: preço mínimo, margem e payback; aprovação automática quando VPL > 0 e TIR > TMA, senão alçada.
 */
export function financeEngine(args: { input: EconInput; items: EconItem[]; settings: EconSettings; publicSector: boolean }): EconResult {
  const { input: inp, settings: st, publicSector } = args;
  const warnings: string[] = [];
  const bp = (v: number) => v / 10_000;
  const rec = inp.mode === 'recorrente';
  // 1. entradas: investimento com contingência; entrega e taxa fixa de venda sem contingência
  const revenue = args.items.reduce((s, i) => s + Math.max(0, i.revenueCents), 0);
  const capexBase = inp.capex.filter((l) => !isVariableFixed(l.impact)).reduce((s, l) => s + costLineTotal(l), 0);
  const E = inp.capex.filter((l) => isVariableFixed(l.impact)).reduce((s, l) => s + costLineTotal(l), 0) + inp.extraInitialCents;
  const opexBase = rec ? inp.opex.reduce((s, l) => s + costLineTotal(l), 0) : 0;
  const capexCont = capexBase * bp(st.contingencyCapexBp), opexCont = opexBase * bp(st.contingencyOpexBp);
  const I = capexBase + capexCont, O = opexBase + opexCont, Inv = I + E;
  if (!rec && inp.opex.length) warnings.push('Venda pontual: custos mensais não entram no cálculo (use o investimento inicial).');
  // tributos por item, ponderados pela receita; tributo fixo uma vez por documento (fatura)
  const n = args.items.length;
  const items = args.items.map((i) => {
    const w = revenue > 0 ? Math.max(0, i.revenueCents) / revenue : n ? 1 / n : 0;
    const pending = !i.doc || !i.doc.complete;
    return { description: i.description, revenueCents: i.revenueCents, weight: w, percentBp: i.doc?.percentBp ?? 0, fixedCents: i.doc?.fixedCents ?? 0, doc: i.doc?.name ?? null, docVersion: i.doc?.version ?? null, pending };
  });
  const a = items.reduce((s, i) => s + i.weight * bp(i.percentBp), 0);
  const perDoc = new Map<string, number>();
  args.items.forEach((i, k) => { if (i.doc) perDoc.set(i.doc.id ?? `item-${k}`, i.doc.fixedCents); });
  const F = [...perDoc.values()].reduce((s, v) => s + v, 0);
  const pendingItems = items.filter((i) => i.pending);
  if (!n) warnings.push('Sem produtos na oportunidade: sem tributos por item; o preço avaliado é o preço exato do motor.');
  if (pendingItems.length) warnings.push(`${pendingItems.length} item(ns) sem documento fiscal ou sem tributos vigentes (${pendingItems.slice(0, 3).map((i) => i.description).join(', ')}${pendingItems.length > 3 ? '…' : ''}): calculado sem esses tributos.`);
  // parâmetros
  const c = bp(inp.commissionBp ?? st.commissionBp);
  const glosa = bp(inp.lossBp ?? (publicSector ? st.lossPublicBp : st.lossPrivateBp));
  const badDebt = st.badDebtBp != null ? bp(st.badDebtBp) : 0;
  if (st.badDebtBp == null) warnings.push('Inadimplência não informada em Configurações → Viabilidade: só a glosa entra no risco.');
  const g = glosa + badDebt;
  const mMin = bp(st.marginTargetBp), mMax = st.marginMaxBp != null ? bp(st.marginMaxBp) : null;
  const mAsk = inp.marginTargetBp != null ? bp(inp.marginTargetBp) : bp(st.marginSuggestedBp ?? st.marginTargetBp);
  const m = clamp(mAsk, mMin, mMax ?? 1);
  if (inp.marginTargetBp != null && m !== mAsk) warnings.push(`Margem pedida (${(mAsk * 100).toLocaleString('pt-BR')}%) fora dos limites da Direção: ajustada para ${(m * 100).toLocaleString('pt-BR')}%.`);
  const r = monthlyTma(st);
  const inflM = st.inflationAnnualBp != null ? (1 + bp(st.inflationAnnualBp)) ** (1 / 12) - 1 : 0;
  const Dalvo = publicSector ? st.paybackMaxPublic : st.paybackMaxPrivate;
  const horizon = st.horizonMaxMonths ?? null;
  const N = rec ? Math.min(inp.termMonths, horizon ?? inp.termMonths) : 0;
  if (rec && horizon != null && inp.termMonths > horizon) warnings.push(`Vigência de ${inp.termMonths} meses acima do prazo máximo de previsão: a projeção vai até ${horizon} meses.`);
  const pbAsk = inp.paybackMonths ?? null;
  const D = rec ? Math.max(1, Math.min(pbAsk ?? Dalvo, Dalvo, N || 1)) : 0;
  if (rec && pbAsk != null && pbAsk > Dalvo) warnings.push(`Payback pedido (${pbAsk} meses) acima do teto do setor ${publicSector ? 'público' : 'privado'} (${Dalvo}): ajustado para ${Math.min(Dalvo, N)}.`);
  else if (rec && (pbAsk ?? Dalvo) > N && Inv > 0) warnings.push(`Payback maior que a projeção (${N} meses): o investimento é amortizado em ${D} meses.`);
  const d = rec ? 0 : inp.receiveMonth;

  // 2. preço: pisos de caixa (com o risco) e preço exato pelo markup divisor (tributos, comissão e margem)
  const b = 1 - a - c - g, bMk = 1 - a - c;
  const costR = rec ? O + F + Inv / D : Inv + F; // numerador em R$ do período
  let cash: number | null = null, eco: number | null = null;
  if (b > 0) {
    if (rec) { cash = costR / b; const A = annuityFactor(r, D); eco = (O + F + (A ? Inv / A : 0)) / b; }
    else { cash = costR / b; eco = (Inv * (1 + r) ** d + F) / b; }
  } else warnings.push('Tributos, comissão, glosa e inadimplência somam 100% ou mais da receita: nenhum preço cobre os custos.');
  const markupAt = (x: number) => (bMk - x > 0 ? costR / (bMk - x) : null);
  const marginPrice = markupAt(mMin), markupPrice = markupAt(m);
  if (b > 0 && markupPrice === null) warnings.push('A margem escolhida é maior que a base do markup: não há preço que entregue essa margem.');
  const minP = cash !== null && eco !== null ? Math.max(cash, eco) : null;
  const recP = minP !== null && markupPrice !== null ? Math.max(minP, markupPrice) : markupPrice;
  const o = st.overheadBp != null ? bp(st.overheadBp) : null;
  const opFloor = o !== null && bMk - g - o > 0 ? costR / (bMk - g - o) : null;
  const floors = [minP, marginPrice, opFloor].filter((v): v is number => v !== null);
  const suggested = floors.length ? Math.max(...floors) : null;

  // 3. preço avaliado (informado; senão o dos produtos; senão o preço exato) e fluxo de caixa no horizonte
  const priceSource: EconResult['priceSource'] = inp.priceCents != null ? 'informado' : revenue > 0 ? 'itens' : 'motor';
  const P0 = inp.priceCents ?? (revenue > 0 ? revenue : recP);
  const P = P0 != null && Number.isFinite(P0) ? P0 : null;
  let kpi: EconResult['kpi'] = null;
  let flows: number[] = [];
  let statement: EconResult['statement'];
  if (P != null && P > 0) {
    const T = P * a + F, comm = c * P, risk = g * P;
    const amort = rec ? Inv / D : Inv;
    const MC = P - T - comm - (rec ? O : 0) - amort; // margem de contribuição (precificação)
    const cash1 = P - risk - T - comm - (rec ? O : 0);
    const tot = { revenue: 0, tax: 0, commission: 0, risk: 0 };
    if (rec) {
      flows = [-Inv];
      for (let t = 1; t <= N; t++) {
        const Pt = P * (1 + inflM) ** Math.max(0, t - 12);
        const Tt = Pt * a + F, ct = c * Pt, rt = g * Pt;
        flows.push(Pt - rt - Tt - ct - O);
        tot.revenue += Pt; tot.tax += Tt; tot.commission += ct; tot.risk += rt;
      }
    } else {
      flows = Array.from({ length: d + 1 }, () => 0); flows[0] = -Inv; flows[d] = flows[d]! + cash1;
      Object.assign(tot, { revenue: P, tax: T, commission: comm, risk });
    }
    const ir = irr(flows);
    const inflow = flows.slice(1).reduce((s, x) => s + x, 0);
    const chain = marginChain(P, MC + amort, amort, st, risk);
    const periods = rec ? N : 1;
    const totContribution = tot.revenue - tot.tax - tot.commission - (rec ? O * N : 0) - Inv;
    const totOverhead = o != null ? tot.revenue * o : null;
    const totOperating = totOverhead != null ? totContribution - tot.risk - totOverhead : null;
    // IR/CSLL mês a mês sobre o operacional positivo (com o reajuste, a base muda)
    let totTax: number | null = null;
    if (totOperating != null && st.incomeTaxBp != null) {
      totTax = 0;
      for (let t = 1; t <= periods; t++) {
        const Pt = rec ? P * (1 + inflM) ** Math.max(0, t - 12) : P;
        const opT = Pt - (Pt * a + F) - c * Pt - (rec ? O + (t <= D ? Inv / D : 0) : Inv) - g * Pt - Pt * o!;
        totTax += Math.max(0, opT) * bp(st.incomeTaxBp);
      }
    }
    const R = (v: number) => Math.round(v);
    const R0 = (v: number | null) => (v == null ? null : Math.round(v));
    statement = {
      month: { revenue: R(P), tax: R(T), commission: R(comm), opex: R(rec ? O : 0), amortization: R(amort), contribution: R(MC), risk: R(risk), overhead: chain.overheadCents, operating: chain.operatingCents, incomeTax: chain.incomeTaxCents, net: chain.netCents },
      total: { revenue: R(tot.revenue), tax: R(tot.tax), commission: R(tot.commission), opex: R(rec ? O * N : 0), amortization: R(Inv), contribution: R(totContribution), risk: R(tot.risk), overhead: R0(totOverhead), operating: R0(totOperating), incomeTax: R0(totTax), net: totOperating != null && totTax != null ? R(totOperating - totTax) : null },
    };
    kpi = {
      taxCents: R(T), commissionCents: R(comm), lossCents: R(risk), contributionCents: R(MC),
      marginPct: (MC / P) * 100,
      npvCents: R(npv(flows, r)), irrMonthly: ir, irrAnnual: ir === null ? null : (1 + ir) ** 12 - 1,
      paybackMonths: paybackMonths(flows, r), simplePaybackMonths: paybackMonths(flows),
      margins: { ...chain, contributionPct: (MC / P) * 100 },
      cashMonthlyCents: R(cash1), amortizationCents: R(amort), roiPct: Inv > 0 ? ((inflow - Inv) / Inv) * 100 : null,
    };
  }
  if (st.overheadBp == null || st.incomeTaxBp == null) warnings.push('Despesas fixas e IR/CSLL não informados em Configurações → Viabilidade: margem operacional e líquida não calculadas.');
  if (st.inflationAnnualBp == null && rec && N > 12) warnings.push('Inflação anual não informada: a receita não é reajustada depois do 12º mês.');

  // 4. decisão
  const pb = kpi?.paybackMonths ?? null;
  const paybackOk = rec && kpi ? Inv === 0 || (pb !== null && pb <= Dalvo) : null;
  const marginOk = kpi ? kpi.marginPct >= mMin * 100 - 1e-9 : null;
  const withinPolicy = kpi ? paybackOk !== false && marginOk === true : null;
  let verdict: EconVerdict;
  if (b <= 0) verdict = 'inviavel';
  else if (!kpi || P == null) verdict = 'sem_preco';
  else if (minP !== null && P < Math.round(minP)) verdict = 'abaixo_minimo';
  else if (paybackOk === false) verdict = 'fora_politica';
  else if (!marginOk) verdict = 'abaixo_recomendado';
  else verdict = 'viavel';
  const withReservations = pendingItems.length > 0 || !n;
  const irrOk = kpi ? (kpi.irrMonthly == null ? Inv === 0 && kpi.npvCents > 0 : kpi.irrMonthly > r) : false;
  const checks = [
    { label: 'VPL positivo', ok: !!kpi && kpi.npvCents > 0 },
    { label: 'TIR acima da TMA', ok: irrOk },
    { label: rec ? 'Payback descontado dentro do teto' : 'Preço cobre o investimento', ok: rec ? paybackOk === true : verdict !== 'abaixo_minimo' },
    { label: 'Margem no piso ou acima', ok: marginOk === true },
    { label: 'Preço no mínimo ou acima', ok: verdict !== 'abaixo_minimo' && verdict !== 'inviavel' && verdict !== 'sem_preco' },
    { label: 'Tributos de todos os produtos', ok: !withReservations },
  ];

  return {
    engineVersion: ENGINE_VERSION,
    mode: inp.mode, publicSector, revenueCents: revenue, priceCents: round(P), priceSource,
    rates: { a, c, g, m, r, b, glosa, badDebt, bMarkup: bMk, mMin, mMax, inflationMonthly: inflM, tmaAnnual: st.tmaAnnualBp != null ? bp(st.tmaAnnualBp) : null },
    fixedTaxCents: F, initialCents: Math.round(I), monthlyCostCents: Math.round(O),
    capexBaseCents: capexBase, capexContingencyCents: Math.round(capexCont), opexBaseCents: opexBase, opexContingencyCents: Math.round(opexCont),
    variableFixedCents: E, investmentCents: Math.round(Inv),
    term: { N, Dalvo, D, d, termMonths: inp.termMonths, horizon, paybackAsked: pbAsk }, items,
    floor: { cashCents: round(cash), economicCents: round(eco), minCents: round(minP) },
    marginPriceCents: round(marginPrice), recommendedCents: round(recP), markupPriceCents: round(markupPrice), operatingFloorCents: round(opFloor), suggestedMinCents: round(suggested),
    kpi, cashflow: flows.map(Math.round), statement,
    marginOk, paybackOk, verdict, withinPolicy, withReservations, warnings,
    autoApproval: { ok: checks.every((x) => x.ok), checks },
  };
}

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
const COST_COLS = {
  description: ['descricao', 'item / descricao', 'item/descricao', 'produto', 'servico', 'produto/servico', 'material', 'custo', 'item'],
  unit: ['unidade', 'unid.', 'unid', 'medida', 'un', 'und'],
  qty: ['quantidade', 'qtd', 'qtd.', 'qtde', 'qtde.', 'quant', 'quant.'],
  unitValue: ['valor unitario', 'valor unit', 'valor unit.', 'preco unitario', 'preco', 'valor', 'custo unitario', 'custo unit.', 'custo unit'],
  total: ['valor total', 'total'],
  frequency: ['frequencia do custo', 'frequencia', 'periodicidade', 'recorrencia'],
  impact: ['impacta o que?', 'impacta o que', 'impacto', 'impacto contabil', 'classificacao'],
};
const freqOf = (v: unknown): 'unico' | 'mensal' | null => { const s = norm(v); return !s ? null : /mens|recorr/.test(s) ? 'mensal' : /unic|setup|pontu|avuls/.test(s) ? 'unico' : null; };
const impactOf = (v: unknown): CostImpact | null => { const s = norm(v); return !s ? null : /entreg|frete/.test(s) ? 'entrega' : /taxa/.test(s) ? 'taxa_venda' : /operac|recorr/.test(s) ? 'operacional' : /servi|mao de obra|hh/.test(s) ? 'servico' : /mater|equip/.test(s) ? 'material' : null; };
/** Quantidade de planilha ou digitada: "8400", "8.400" (milhar), "2,5", 21 → milésimos. */
export function costQty(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 1000) : null;
  const t = String(raw ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  const n = Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}
function costMoney(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  const t = String(raw ?? '').replace(/R\$|\s/g, '');
  if (!t) return null;
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/**
 * Lê uma tabela de custos colada do Excel ou importada (CSV/XLSX).
 * Com títulos: Descrição, Unidade, Quantidade, Valor unitário (e Item/Valor total, opcionais). Sem títulos, na ordem
 * Item, Descrição, Unidade, Quantidade, Valor unitário, Valor total — ou Descrição, Quantidade, Valor unitário.
 * Sem valor unitário, usa Valor total ÷ Quantidade. Linhas recusadas voltam com o motivo; nada é inventado.
 */
export function parseCostTable(rows: (string | number | null | undefined)[][]): { lines: (CostLine & { frequency?: 'unico' | 'mensal' | null })[]; errors: { row: number; message: string }[]; missing: string[] } {
  // guarda o número da linha na planilha (as linhas em branco contam)
  const clean = rows.map((r, i) => ({ r, n: i + 1 })).filter(({ r }) => r.some((c) => String(c ?? '').trim()));
  if (!clean.length) return { lines: [], errors: [], missing: ['Descrição', 'Quantidade', 'Valor unitário'] };
  const head = clean[0]!.r.map(norm);
  const find = (names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  let idx = { description: find(COST_COLS.description.filter((x) => x !== 'item')), unit: find(COST_COLS.unit), qty: find(COST_COLS.qty), unitValue: find(COST_COLS.unitValue), total: find(COST_COLS.total), frequency: find(COST_COLS.frequency), impact: find(COST_COLS.impact) };
  if (idx.description < 0) idx.description = find(['item']);
  let body = clean.slice(1);
  if (idx.description < 0 || idx.qty < 0 || (idx.unitValue < 0 && idx.total < 0)) {
    // sem títulos: pela posição
    const w = clean[0]!.r.length;
    const none = { frequency: -1, impact: -1 };
    if (w >= 6) idx = { description: 1, unit: 2, qty: 3, unitValue: 4, total: 5, ...none };
    else if (w === 5) idx = { description: 0, unit: 1, qty: 2, unitValue: 3, total: 4, ...none };
    else if (w === 4) idx = { description: 0, unit: 1, qty: 2, unitValue: 3, total: -1, ...none };
    else if (w === 3) idx = { description: 0, unit: -1, qty: 1, unitValue: 2, total: -1, ...none };
    else return { lines: [], errors: [], missing: ['Descrição', 'Quantidade', 'Valor unitário'] };
    body = clean;
  }
  const lines: (CostLine & { frequency?: 'unico' | 'mensal' | null })[] = [];
  const errors: { row: number; message: string }[] = [];
  body.forEach(({ r, n: row }) => {
    const description = String(r[idx.description] ?? '').trim();
    const qtyMilli = costQty(r[idx.qty]);
    let unitCents = idx.unitValue >= 0 ? costMoney(r[idx.unitValue]) : null;
    if (unitCents == null && idx.total >= 0 && qtyMilli) { const t = costMoney(r[idx.total]); if (t != null) unitCents = Math.round((t * 1000) / qtyMilli); }
    if (description.length < 2) return errors.push({ row, message: 'sem descrição' });
    if (qtyMilli == null) return errors.push({ row, message: `quantidade inválida em ${description}` });
    if (unitCents == null) return errors.push({ row, message: `valor inválido em ${description}` });
    const unit = idx.unit >= 0 ? String(r[idx.unit] ?? '').trim().slice(0, 12) || null : null;
    const frequency = idx.frequency >= 0 ? freqOf(r[idx.frequency]) : null, impact = idx.impact >= 0 ? impactOf(r[idx.impact]) : null;
    lines.push({ description: description.slice(0, 160), qtyMilli, unitCents, unit, ...(frequency ? { frequency } : {}), ...(impact ? { impact } : {}) });
  });
  return { lines, errors, missing: [] };
}

export type DreRow = { sign: '+' | '−' | '='; label: string; month: number | null; total: number; strong?: boolean; tone?: boolean; note?: string };

/**
 * DRE da oportunidade: o que entra (+), o que sai (−) e os resultados (=), por mês e no contrato inteiro.
 * Mesma conta na tela e na exportação. `fmt` formata o tributo fixo no rótulo.
 */
/**
 * Desdobramento financeiro: o que entra (+), o que sai (−) e os resultados (=), no 1º mês e no contrato inteiro
 * (com o reajuste). Cálculos de versões anteriores do motor usam o desdobramento da época.
 */
export function econDre(r: EconResult, fmt: (c: number) => string): DreRow[] {
  const s = r.statement;
  if (!s || !r.kpi || r.priceCents == null) return econDreV1(r, fmt);
  const rec = r.mode === 'recorrente', N = rec ? r.term.N : 1;
  const pc = (v: number, d = 2) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`;
  const per = (x: number | null, P = r.priceCents!) => (x == null ? '' : `${pc((x / P) * 100, 1)} da receita`);
  const M = (v: number | null) => (rec ? v : null);
  const opexBase = r.opexBaseCents, opexCont = r.opexContingencyCents;
  const rows: DreRow[] = [
    { sign: '+', label: 'Receita bruta', month: M(s.month.revenue), total: s.total.revenue, note: rec && r.rates.inflationMonthly ? 'reajuste após o 12º mês' : undefined },
    { sign: '−', label: `Tributos (${pc(r.rates.a * 100)}${r.fixedTaxCents ? ` + ${fmt(r.fixedTaxCents)}` : ''})`, month: M(-s.month.tax), total: -s.total.tax },
    { sign: '−', label: `Comissão (${pc(r.rates.c * 100)})`, month: M(-s.month.commission), total: -s.total.commission },
    ...(rec && opexBase > 0 ? [{ sign: '−' as const, label: 'Custos operacionais', month: -opexBase, total: -opexBase * N }] : []),
    ...(rec && opexCont > 0 ? [{ sign: '−' as const, label: 'Contingência dos custos mensais', month: -opexCont, total: -opexCont * N }] : []),
    ...((r.investmentCents ?? 0) > 0 ? [{ sign: '−' as const, label: rec ? `Investimento amortizado no payback (${fmt(r.investmentCents!)} em ${r.term.D} meses)` : 'Investimento e despesas de entrega', month: M(-s.month.amortization), total: -s.total.amortization }] : []),
    { sign: '=', label: 'Margem de contribuição', month: M(s.month.contribution), total: s.total.contribution, strong: true, note: per(s.month.contribution) },
    ...(s.month.risk > 0 ? [{ sign: '−' as const, label: `Glosa e inadimplência (${pc(r.rates.g * 100)})`, month: M(-s.month.risk), total: -s.total.risk }] : []),
  ];
  if (s.month.operating != null && s.total.operating != null) {
    rows.push(
      { sign: '−', label: 'Despesas fixas rateadas', month: M(-(s.month.overhead ?? 0)), total: -(s.total.overhead ?? 0) },
      { sign: '=', label: 'Margem operacional', month: M(s.month.operating), total: s.total.operating, strong: true, note: per(s.month.operating) },
    );
    if (s.month.incomeTax != null && s.total.incomeTax != null && s.total.net != null) rows.push(
      { sign: '−', label: 'IR/CSLL', month: M(-s.month.incomeTax), total: -s.total.incomeTax },
      { sign: '=', label: 'Margem líquida', month: M(s.month.net), total: s.total.net, strong: true, tone: true, note: `${per(s.month.net)} · ${s.total.net >= 0 ? 'lucro' : 'prejuízo'}` },
    );
  } else {
    const res = s.total.contribution - s.total.risk;
    rows.push({ sign: '=', label: rec ? 'Resultado do contrato' : 'Resultado da venda', month: null, total: res, strong: true, tone: true, note: `${res >= 0 ? 'lucro' : 'prejuízo'} · sem despesas fixas e IR/CSLL (não informados)` });
  }
  return rows;
}

function econDreV1(r: EconResult, fmt: (c: number) => string): DreRow[] {
  const k = r.kpi;
  if (!k || r.priceCents == null) return [];
  const P = r.priceCents;
  const pc = (v: number, d = 2) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`;
  const rec = r.mode === 'recorrente', N = rec ? r.term.N : 1;
  const liquid = P - k.taxCents;
  const result = k.contributionCents * N - r.initialCents;
  // resultados salvos antes da contingência não têm as bases separadas
  const opexBase = r.opexBaseCents ?? r.monthlyCostCents, opexCont = r.opexContingencyCents ?? 0;
  const capexBase = r.capexBaseCents ?? r.initialCents, capexCont = r.capexContingencyCents ?? 0;
  const mg = k.margins ?? null;
  // investimento (com contingência) diluído na vigência: o total do contrato é o investimento inteiro
  // totais do contrato sem arredondar a amortização mensal
  const opTotal = mg?.operatingCents != null ? k.contributionCents * N - r.initialCents - mg.overheadCents! * N : 0;
  const amortRows: DreRow[] = r.initialCents > 0 ? [{ sign: '−', label: rec ? `Amortização do investimento (${fmt(r.initialCents)} em ${N} meses)` : 'Investimento inicial', month: mg ? -mg.amortizationCents : null, total: -r.initialCents }] : [];
  return [
    { sign: '+', label: 'Receita bruta', month: P, total: P * N },
    { sign: '−', label: `Tributos (${pc(r.rates.a * 100)}${r.fixedTaxCents ? ` + ${fmt(r.fixedTaxCents)}` : ''})`, month: -k.taxCents, total: -k.taxCents * N },
    { sign: '=', label: 'Receita líquida', month: liquid, total: liquid * N, strong: true },
    { sign: '−', label: `Comissão (${pc(r.rates.c * 100)})`, month: -k.commissionCents, total: -k.commissionCents * N },
    ...(k.lossCents > 0 ? [{ sign: '−' as const, label: `Perda / glosa (${pc(r.rates.g * 100)})`, month: -k.lossCents, total: -k.lossCents * N }] : []),
    ...(opexBase > 0 ? [{ sign: '−' as const, label: 'Custos operacionais', month: -opexBase, total: -opexBase * N }] : []),
    ...(opexCont > 0 ? [{ sign: '−' as const, label: 'Contingência dos custos mensais', month: -opexCont, total: -opexCont * N }] : []),
    { sign: '=', label: 'Margem de contribuição', month: k.contributionCents, total: k.contributionCents * N, strong: true, note: `${pc(mg ? mg.contributionPct : k.marginPct, 1)} da receita` },
    ...(mg ? amortRows : [
      // resultados salvos antes da cadeia de margens
      { sign: '−' as const, label: 'Investimento inicial', month: null, total: -capexBase },
      ...(capexCont > 0 ? [{ sign: '−' as const, label: 'Contingência do investimento', month: null, total: -capexCont }] : []),
    ]),
    ...(mg?.operatingCents != null ? [
      { sign: '−' as const, label: `Despesas fixas rateadas (${pc((mg.overheadCents! / P) * 100)})`, month: -mg.overheadCents!, total: -mg.overheadCents! * N },
      { sign: '=' as const, label: 'Margem operacional', month: mg.operatingCents, total: opTotal, strong: true, note: `${pc(mg.operatingPct!, 1)} da receita` },
      { sign: '−' as const, label: 'IR/CSLL', month: -mg.incomeTaxCents!, total: -mg.incomeTaxCents! * N },
      { sign: '=' as const, label: 'Margem líquida', month: mg.netCents!, total: opTotal - mg.incomeTaxCents! * N, strong: true, tone: true, note: `${pc(mg.netPct!, 1)} da receita · ${mg.netCents! >= 0 ? 'lucro' : 'prejuízo'}` },
    ] : [{ sign: '=' as const, label: rec ? 'Resultado do contrato' : 'Resultado da venda', month: null, total: result, strong: true, tone: true, note: mg ? `${result >= 0 ? 'lucro' : 'prejuízo'} · sem despesas fixas e IR/CSLL (não informados)` : result >= 0 ? 'lucro' : 'prejuízo' }]),
  ];
}

/** Uma frase para o time entender o impacto, sem fórmulas. */
export function econHeadline(rs: EconResult, fmt: (c: number | null) => string) {
  const per = rs.mode === 'recorrente' ? '/mês' : '';
  if (rs.verdict === 'inviavel') return 'Tributos, comissão e perdas consomem toda a receita: revise a comissão, a perda esperada ou os documentos fiscais.';
  if (rs.verdict === 'sem_preco' || !rs.kpi) return `Informe o preço ou lance os produtos. O preço mínimo é ${fmt(rs.floor.minCents)}${per}${rs.recommendedCents != null ? ` e o que entrega a margem mínima, ${fmt(rs.recommendedCents)}${per}` : ''}.`;
  const k = rs.kpi;
  const tma = (rs.rates.r * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const pb = k.paybackMonths === null
    ? (k.simplePaybackMonths != null && k.simplePaybackMonths > 0
      ? `com a TMA de ${tma}% ao mês o investimento não se paga na vigência (sem descontar a TMA, voltaria em ${k.simplePaybackMonths.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses)`
      : 'não se paga na vigência') : k.paybackMonths === 0 ? 'sem investimento a recuperar' : `o investimento volta em ${k.paybackMonths.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses, já descontada a TMA (limite ${rs.term.Dalvo})`;
  if (rs.statement) {
    const pctm = k.marginPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const sobra2 = rs.mode === 'recorrente'
      ? `a margem de contribuição é ${pctm}% (${fmt(k.contributionCents)} por mês, já com o investimento amortizado em ${rs.term.D} meses) e o caixa do mês, depois de glosa e inadimplência, é ${fmt(k.cashMonthlyCents ?? k.contributionCents)}`
      : `a margem de contribuição é ${pctm}% (${fmt(k.contributionCents)}) depois de tributos, comissão e investimento`;
    return `Com ${fmt(rs.priceCents)}${per}, ${sobra2}; ${pb}.${rs.autoApproval?.ok ? ' Dentro das regras de aprovação automática.' : ''}`;
  }
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

// ------------------------------------------------------------------ memória de cálculo

export type MemoryRow = { label: string; formula?: string; value: string; strong?: boolean; ok?: boolean | null };
export type MemoryOpts = { legacy?: { oneTimeX100?: number | null; recurringX100?: number | null } };
export type MemoryStep = { key: 'entradas' | 'preco' | 'historico' | 'fluxo' | 'decisao'; title: string; desc: string; rows: MemoryRow[]; note?: string };

/** Preço → margem de contribuição no mesmo modelo do motor (usado no comparativo histórico). */
function marginAt(r: EconResult, P: number) {
  const contribution = P - (P * r.rates.a + r.fixedTaxCents) - r.rates.c * P - r.rates.g * P - (r.mode === 'recorrente' ? r.monthlyCostCents : 0);
  return ((r.mode === 'pontual' ? contribution - r.initialCents : contribution) / P) * 100;
}

/**
 * Memória de cálculo do resultado salvo, em passos (entradas → preço → comparativo histórico → fluxo de caixa → decisão),
 * com cada fórmula e os números que entraram nela. Só lê o resultado: nada é recalculado na regra, e a mesma função
 * alimenta a tela, o CSV e o PDF.
 */
/** Memória de cálculo (FINANCE-2.0): passos com fórmula e números; cálculos anteriores usam a memória da época. */
export function econMemory(r: EconResult, fmt: (c: number) => string, opts: MemoryOpts = {}): MemoryStep[] {
  if (!r.statement) return econMemoryV1(r, fmt, opts);
  const pc = (v: number, d = 2) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`;
  const num = (v: number, d = 2) => v.toLocaleString('pt-BR', { maximumFractionDigits: d });
  const money = (c: number | null | undefined) => (c == null ? '—' : c < 0 ? `-${fmt(-c)}` : fmt(c));
  const rec = r.mode === 'recorrente';
  const { a, c, g, m, b } = r.rates, rt = r.rates.r;
  const glosa = r.rates.glosa ?? g, bad = r.rates.badDebt ?? 0, bMk = r.rates.bMarkup ?? 1 - a - c, mMin = r.rates.mMin ?? m;
  const I = r.initialCents, O = r.monthlyCostCents, F = r.fixedTaxCents, E = r.variableFixedCents ?? 0, Inv = r.investmentCents ?? I;
  const { N, D, d, Dalvo } = r.term;
  const k = r.kpi;
  const steps: MemoryStep[] = [];
  const taxParts = r.items.slice(0, 4).map((i) => `${pc(i.weight * 100, 1)} × ${pc(i.percentBp / 100)}`).join(' + ') + (r.items.length > 4 ? ' + …' : '');
  steps.push({
    key: 'entradas', title: 'Entradas', desc: 'Planilha de custos classificada (frequência e impacto), tributos do documento fiscal e parâmetros da Direção.',
    rows: [
      { label: 'Investimento inicial (I)', formula: r.capexContingencyCents ? `${money(r.capexBaseCents)} + contingência ${money(r.capexContingencyCents)}` : 'materiais, equipamentos e serviços de valor único', value: money(I), strong: true },
      ...(E ? [{ label: 'Despesas variáveis em R$ (E)', formula: 'despesa de entrega e taxa fixa de venda, sem contingência', value: money(E) }] : []),
      ...(rec ? [{ label: 'Custos mensais (O)', formula: r.opexContingencyCents ? `${money(r.opexBaseCents)} + contingência ${money(r.opexContingencyCents)}` : 'custos operacionais recorrentes', value: money(O), strong: true }] : []),
      { label: 'Tributos sobre o preço (a)', formula: r.items.length ? `peso na receita × alíquota: ${taxParts}` : 'sem produtos', value: pc(a * 100) },
      ...(F ? [{ label: 'Tributo fixo por fatura (F)', value: money(F) }] : []),
      { label: 'Comissão (c)', value: pc(c * 100) },
      { label: `Glosa, setor ${r.publicSector ? 'público' : 'privado'}`, value: pc(glosa * 100) },
      { label: 'Inadimplência', value: pc(bad * 100) },
      { label: 'Margem de contribuição (m)', formula: `escolhida entre o piso ${pc(mMin * 100)}${r.rates.mMax != null ? ` e o teto ${pc(r.rates.mMax * 100)}` : ''}`, value: pc(m * 100) },
      { label: 'TMA (k)', formula: r.rates.tmaAnnual != null ? `(1 + ${pc(r.rates.tmaAnnual * 100)})^(1/12) - 1` : 'mensal informada', value: `${pc(rt * 100, 3)} a.m.` },
      ...(rec && r.rates.inflationMonthly ? [{ label: 'Reajuste (inflação)', formula: `${pc(((1 + r.rates.inflationMonthly) ** 12 - 1) * 100)} ao ano, aplicado a partir do 13º mês`, value: `${pc(r.rates.inflationMonthly * 100, 3)} a.m.` }] : []),
      rec ? { label: 'Prazos', formula: `vigência ${r.term.termMonths ?? N} meses${r.term.horizon != null ? `, prazo máximo de previsão ${r.term.horizon}` : ''} · payback ${r.term.paybackAsked ?? 'no teto'} (teto ${Dalvo})`, value: `N = ${N} · D = ${D}` }
        : { label: 'Recebimento', value: d ? `mês ${d}` : 'à vista' },
    ],
  });
  const costTxt = rec ? `I + E ÷ D + O + F = ${money(Inv)} ÷ ${D} + ${money(O)} + ${money(F)}` : `I + E + F = ${money(Inv)} + ${money(F)}`;
  const prices: MemoryRow[] = [
    ...(rec ? [{ label: 'Custo mensal amortizado (C)', formula: `(I + E) ÷ payback + O = ${money(Inv)} ÷ ${D} + ${money(O)}`, value: money(Inv / D + O) }] : []),
    { label: 'Preço exato (markup divisor)', formula: `(${costTxt}) ÷ (1 - a - c - m) = ÷ (1 - ${pc(a * 100)} - ${pc(c * 100)} - ${pc(m * 100)})`, value: money(r.markupPriceCents), strong: true },
    { label: 'Preço na margem mínima (piso)', formula: `mesmo numerador ÷ (1 - a - c - ${pc(mMin * 100)})`, value: money(r.marginPriceCents) },
    { label: 'Base líquida de caixa (b)', formula: `1 - a - c - glosa - inadimplência = ${pc(b * 100)}`, value: pc(b * 100) },
    { label: 'Preço que cobre o caixa', formula: `(${rec ? 'C + F' : 'I + E + F'}) ÷ b`, value: money(r.floor.cashCents) },
    { label: 'Preço que cobre a TMA', formula: rec ? `(O + F + (I + E) ÷ A) ÷ b, A = anuidade de ${D} meses a ${pc(rt * 100, 3)} = ${num(annuityFactor(rt, D), 4)}` : `((I + E) × (1 + k)^${d} + F) ÷ b`, value: money(r.floor.economicCents) },
    { label: 'Preço mínimo', formula: 'maior dos dois', value: money(r.floor.minCents), strong: true },
    ...(r.operatingFloorCents != null ? [{ label: 'Preço da margem operacional zero', formula: '(mesmo numerador) ÷ (1 - a - c - glosa - inadimplência - despesas fixas)', value: money(r.operatingFloorCents) }] : []),
    ...(r.suggestedMinCents != null ? [{ label: 'Preço mínimo sugerido', formula: 'maior entre o mínimo, o do piso de margem e o da margem operacional zero', value: money(r.suggestedMinCents), strong: true }] : []),
    { label: 'Preço avaliado (P)', formula: r.priceSource === 'informado' ? 'informado na negociação' : r.priceSource === 'itens' ? 'total dos produtos' : 'preço exato do motor', value: `${money(r.priceCents)}${rec ? '/mês' : ''}`, strong: true },
  ];
  void bMk;
  steps.push({ key: 'preco', title: 'Precificação exata (markup divisor)', desc: 'Valores em R$ no numerador; tributos, despesas variáveis (comissão) e margem, que variam com o preço, no denominador. IR/CSLL não entram na nota: ficam cobertos pela margem.', rows: prices });

  const fx = (rec ? opts.legacy?.recurringX100 : opts.legacy?.oneTimeX100) ?? null;
  const base = rec ? r.opexBaseCents : r.capexBaseCents;
  if (fx && base > 0) {
    const f = fx / 100, Pl = Math.round(base * f), sb = (1 - 1 / f) * 100;
    const ml = (sb / 100 - a - c) * 100;
    steps.push({
      key: 'historico', title: 'Comparativo com o modelo histórico', desc: `Regra antiga da empresa: ${rec ? 'custo mensal' : 'investimento'} × ${num(f)}. Só informativo; não entra na decisão.`,
      rows: [
        { label: 'Preço pelo modelo histórico', formula: `${money(base)} × ${num(f)}`, value: `${money(Pl)}${rec ? '/mês' : ''}`, strong: true },
        { label: 'Sobra bruta teórica (SB)', formula: `1 - 1 ÷ ${num(f)}`, value: pc(sb) },
        { label: 'Margem efetiva real', formula: `SB - tributos - despesas variáveis = ${pc(sb)} - ${pc(a * 100)} - ${pc(c * 100)}`, value: pc(ml), ok: ml >= mMin * 100 - 1e-9 },
        ...(r.markupPriceCents != null ? [{ label: 'Diferença para o preço exato', formula: 'histórico - exato', value: money(Pl - r.markupPriceCents) }] : []),
      ],
      note: `Se for usado o modelo histórico (×${num(f)}), o valor cobrado seria ${money(Pl)}, gerando uma margem de contribuição efetiva real de ${pc(ml)} após os tributos da nota fiscal. No modelo exato (markup divisor), para garantir a margem de ${pc(m * 100)}, o valor correto é ${money(r.markupPriceCents)}.`,
    });
  }

  if (k && r.priceCents != null) {
    const P = r.priceCents, flows = r.cashflow;
    const inflow = flows.slice(1).reduce((s, x) => s + x, 0);
    steps.push({
      key: 'fluxo', title: 'Fluxo de caixa projetado e indicadores', desc: rec ? `Mês 0 = investimento; meses 1 a ${N} = receita (reajustada após o 12º mês) menos glosa, inadimplência, tributos, comissão e custos.` : `Mês 0 = investimento; o preço entra no mês ${d}.`,
      rows: [
        { label: 'Mês 0 (FC0)', formula: '- (I + E)', value: money(-Inv) },
        { label: rec ? '1º mês (FC1)' : `Mês ${d}`, formula: `P - glosa e inadimplência - tributos - comissão${rec ? ' - custos' : ''} = ${money(P)} - ${money(k.lossCents)} - ${money(k.taxCents)} - ${money(k.commissionCents)}${rec ? ` - ${money(O)}` : ''}`, value: money(k.cashMonthlyCents ?? null), strong: true },
        { label: 'VPL', formula: `FC0 + soma de FCt ÷ (1 + ${pc(rt * 100, 3)})^t`, value: money(k.npvCents), ok: k.npvCents > 0 },
        { label: 'TIR', formula: 'taxa que zera o VPL (comparada à TMA)', value: k.irrMonthly == null ? 'não se aplica' : `${pc(k.irrMonthly * 100, 1)} a.m. · ${k.irrAnnual! > 10 ? 'acima de 1.000%' : pc(k.irrAnnual! * 100, 1)} a.a.`, ok: k.irrMonthly == null ? null : k.irrMonthly > rt },
        { label: 'Payback descontado', formula: `(p - 1) + saldo a recuperar ÷ FCp descontado (simples: ${k.simplePaybackMonths == null ? 'não se paga' : `${num(k.simplePaybackMonths, 1)} meses`})`, value: k.paybackMonths == null ? 'não se paga' : `${num(k.paybackMonths, 1)} meses` },
        ...(k.roiPct != null ? [{ label: 'ROI', formula: `(soma dos fluxos - investimento) ÷ investimento = (${money(inflow)} - ${money(Inv)}) ÷ ${money(Inv)}`, value: pc(k.roiPct, 1), ok: k.roiPct >= 0 }] : []),
      ],
    });
    const aa = r.autoApproval;
    steps.push({
      key: 'decisao', title: 'Decisão', desc: 'Aprovação automática quando todas as regras passam; senão a oportunidade vai para a alçada superior.',
      rows: [
        ...(aa?.checks ?? []).map((x) => ({ label: x.label, value: x.ok ? 'sim' : 'não', ok: x.ok })),
        { label: 'Resultado', value: aa?.ok ? 'Aprovação automática' : `${ECON_VERDICT_LABELS[r.verdict]} · alçada superior`, strong: true, ok: aa?.ok ?? null },
      ],
    });
  }
  return steps;
}

function econMemoryV1(r: EconResult, fmt: (c: number) => string, opts: MemoryOpts = {}): MemoryStep[] {
  const pc = (v: number, d = 2) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`;
  const num = (v: number, d = 2) => v.toLocaleString('pt-BR', { maximumFractionDigits: d });
  const money = (c: number | null | undefined) => (c == null ? '—' : c < 0 ? `-${fmt(-c)}` : fmt(c));
  const rec = r.mode === 'recorrente';
  const { a, c, g, m, b } = r.rates, rt = r.rates.r;
  const I = r.initialCents, O = r.monthlyCostCents, F = r.fixedTaxCents;
  const capexBase = r.capexBaseCents ?? I, opexBase = r.opexBaseCents ?? O;
  const { N, D, d, Dalvo } = r.term;
  const k = r.kpi;
  const steps: MemoryStep[] = [];

  // 1. entradas: o que veio da oportunidade e dos parâmetros
  const taxParts = r.items.slice(0, 4).map((i) => `${pc(i.weight * 100, 1)} × ${pc(i.percentBp / 100)}`).join(' + ') + (r.items.length > 4 ? ' + …' : '');
  steps.push({
    key: 'entradas', title: 'Entradas', desc: 'Custos da oportunidade, tributos dos documentos fiscais e parâmetros vigentes do motor.',
    rows: [
      { label: 'Investimento inicial (I)', formula: r.capexContingencyCents ? `${money(capexBase)} + contingência ${money(r.capexContingencyCents)}` : undefined, value: money(I), strong: true },
      ...(rec ? [{ label: 'Custos mensais (O)', formula: r.opexContingencyCents ? `${money(opexBase)} + contingência ${money(r.opexContingencyCents)}` : undefined, value: money(O), strong: true }] : []),
      { label: 'Tributos sobre o preço (a)', formula: r.items.length ? `peso na receita × alíquota: ${taxParts}` : 'sem produtos', value: pc(a * 100) },
      ...(F ? [{ label: 'Tributo fixo por fatura (F)', value: money(F) }] : []),
      { label: 'Comissão (c)', value: pc(c * 100) },
      { label: `Glosa e inadimplência (g), setor ${r.publicSector ? 'público' : 'privado'}`, value: pc(g * 100) },
      { label: 'Margem de contribuição mínima (m)', value: pc(m * 100) },
      { label: 'TMA (r)', formula: `${pc(rt * 100)} ao mês ≈ ${pc(((1 + rt) ** 12 - 1) * 100, 1)} ao ano`, value: `${pc(rt * 100)} a.m.` },
      rec ? { label: 'Prazo', formula: `vigência N = ${N} meses · limite de payback ${Dalvo} meses · investimento diluído em D = menor dos dois = ${D}`, value: `${N} meses` }
        : { label: 'Recebimento', value: d ? `mês ${d}` : 'à vista' },
    ],
  });

  // 2. preço: markup divisor (custos em R$ no numerador, percentuais no denominador)
  const A = rec ? annuityFactor(rt, D) : 0;
  const prices: MemoryRow[] = [{ label: 'Base líquida (b)', formula: `1 - a - c - g = 1 - ${pc(a * 100)} - ${pc(c * 100)} - ${pc(g * 100)}`, value: pc(b * 100) }];
  if (b > 0) {
    if (rec) {
      prices.push(
        { label: 'Preço que cobre o caixa', formula: `(O + F + I ÷ D) ÷ b = (${money(O)} + ${money(F)} + ${money(I)} ÷ ${D}) ÷ ${pc(b * 100)}`, value: money(r.floor.cashCents) },
        { label: 'Preço que cobre a TMA', formula: `(O + F + I ÷ A) ÷ b, A = fator de anuidade de ${D} meses a ${pc(rt * 100)} = ${num(A, 4)}`, value: money(r.floor.economicCents) },
        { label: 'Preço mínimo', formula: 'maior dos dois', value: money(r.floor.minCents), strong: true },
        { label: 'Preço da margem mínima', formula: `(O + F) ÷ (b - m) = (${money(O)} + ${money(F)}) ÷ ${pc((b - m) * 100)}`, value: money(r.marginPriceCents) },
      );
    } else {
      prices.push(
        { label: 'Preço que cobre o caixa', formula: `(I + F) ÷ b = (${money(I)} + ${money(F)}) ÷ ${pc(b * 100)}`, value: money(r.floor.cashCents) },
        { label: 'Preço que cobre a TMA', formula: `(I × (1 + r)^${d} + F) ÷ b`, value: money(r.floor.economicCents) },
        { label: 'Preço mínimo', formula: 'maior dos dois', value: money(r.floor.minCents), strong: true },
        { label: 'Preço da margem mínima', formula: `(I + F) ÷ (b - m) = (${money(I)} + ${money(F)}) ÷ ${pc((b - m) * 100)}`, value: money(r.marginPriceCents) },
      );
    }
    if (r.operatingFloorCents != null) prices.push({ label: 'Preço da margem operacional zero', formula: rec ? '(O + F + I ÷ N) ÷ (b - despesas fixas)' : '(I + F) ÷ (b - despesas fixas)', value: money(r.operatingFloorCents) });
    if (r.suggestedMinCents != null) prices.push({ label: 'Preço mínimo sugerido', formula: 'maior entre o preço mínimo, o da margem mínima e o da margem operacional zero', value: money(r.suggestedMinCents), strong: true });
  }
  prices.push({ label: 'Preço avaliado (P)', formula: r.priceSource === 'informado' ? 'informado na negociação' : 'total dos produtos', value: `${money(r.priceCents)}${rec ? '/mês' : ''}`, strong: true });
  steps.push({ key: 'preco', title: 'Preço (markup divisor)', desc: 'Valores em R$ ficam no numerador; tributos, comissão, glosa e margem, que variam com o preço, no denominador.', rows: prices });

  // 3. comparativo com o modelo histórico (informativo)
  const fx = (rec ? opts.legacy?.recurringX100 : opts.legacy?.oneTimeX100) ?? null;
  const base = rec ? opexBase : capexBase;
  if (fx && base > 0) {
    const f = fx / 100, Pl = Math.round(base * f), sb = (1 - 1 / f) * 100, ml = marginAt(r, Pl);
    steps.push({
      key: 'historico', title: 'Comparativo com o modelo histórico', desc: `Regra antiga da empresa: ${rec ? 'custo mensal' : 'investimento'} × ${num(f)}. Só informativo; não entra na decisão.`,
      rows: [
        { label: 'Preço pelo modelo histórico', formula: `${money(base)} × ${num(f)}`, value: `${money(Pl)}${rec ? '/mês' : ''}`, strong: true },
        { label: 'Sobra bruta teórica', formula: `1 - 1 ÷ ${num(f)}`, value: pc(sb) },
        { label: 'Margem efetiva real nesse preço', formula: rec ? '(preço - tributos - comissão - glosa - custos mensais) ÷ preço' : '(preço - tributos - comissão - glosa - investimento) ÷ preço', value: pc(ml, 1), ok: ml >= m * 100 - 1e-9 },
        ...(r.priceCents != null ? [{ label: 'Diferença para o preço avaliado', formula: 'histórico - avaliado', value: money(Pl - r.priceCents) }] : []),
      ],
      note: `No modelo histórico (×${num(f)}) o preço seria ${money(Pl)}, com margem efetiva real de ${pc(ml, 1)} depois dos tributos.${r.recommendedCents != null ? ` No modelo exato, para a margem mínima de ${pc(m * 100, 0)}, o preço é ${money(r.recommendedCents)}.` : ''}`,
    });
  }

  // 4. fluxo de caixa e indicadores
  if (k && r.priceCents != null) {
    const P = r.priceCents, flows = r.cashflow;
    const inflow = flows.slice(1).reduce((s, x) => s + x, 0);
    const roi = I > 0 ? ((inflow - I) / I) * 100 : null;
    steps.push({
      key: 'fluxo', title: 'Fluxo de caixa e indicadores', desc: rec ? `Mês 0 = investimento; meses 1 a ${N} = o que sobra da mensalidade.` : `Mês 0 = investimento; o preço entra no mês ${d}.`,
      rows: [
        { label: 'Mês 0 (FC0)', formula: '- investimento inicial', value: money(-I) },
        { label: rec ? 'Cada mês (FCt)' : `Mês ${d}`, formula: `P - tributos - comissão - glosa${rec ? ' - custos' : ''} = ${money(P)} - ${money(k.taxCents)} - ${money(k.commissionCents)} - ${money(k.lossCents)}${rec ? ` - ${money(O)}` : ''}`, value: money(k.contributionCents), strong: true },
        { label: 'VPL', formula: `soma de FCt ÷ (1 + ${pc(rt * 100)})^t`, value: money(k.npvCents), ok: k.npvCents >= 0 },
        { label: 'TIR', formula: 'taxa que zera o VPL', value: k.irrMonthly == null ? 'não se aplica' : `${pc(k.irrMonthly * 100, 1)} a.m. · ${k.irrAnnual! > 10 ? 'acima de 1.000%' : pc(k.irrAnnual! * 100, 1)} a.a.`, ok: k.irrMonthly == null ? null : k.irrMonthly >= rt },
        { label: 'Payback descontado', formula: `mês em que a soma dos fluxos descontados pela TMA fica positiva (simples: ${k.simplePaybackMonths == null ? 'não se paga' : `${num(k.simplePaybackMonths, 1)} meses`})`, value: k.paybackMonths == null ? 'não se paga' : `${num(k.paybackMonths, 1)} meses` },
        ...(roi != null ? [{ label: 'ROI', formula: `(soma dos fluxos - investimento) ÷ investimento = (${money(inflow)} - ${money(I)}) ÷ ${money(I)}`, value: pc(roi, 1), ok: roi >= 0 }] : []),
      ],
    });

    // 5. decisão
    const decisions: MemoryRow[] = [
      { label: 'Preço avaliado cobre o preço mínimo', formula: `${money(P)} ≥ ${money(r.floor.minCents)}`, value: r.floor.minCents == null ? '—' : P >= Math.round(r.floor.minCents) ? 'sim' : 'não', ok: r.floor.minCents == null ? null : P >= Math.round(r.floor.minCents) },
      { label: 'Margem efetiva atinge a mínima', formula: `${pc(k.marginPct, 1)} ≥ ${pc(m * 100, 1)}`, value: r.marginOk ? 'sim' : 'não', ok: r.marginOk },
      ...(rec ? [{ label: 'Payback descontado dentro do limite', formula: `${k.paybackMonths == null ? 'não se paga' : `${num(k.paybackMonths, 1)} meses`} ≤ ${Dalvo} meses`, value: r.paybackOk ? 'sim' : 'não', ok: r.paybackOk }] : []),
      { label: 'Tributos de todos os produtos informados', value: r.withReservations ? 'não' : 'sim', ok: !r.withReservations },
      { label: 'Resultado', value: ECON_VERDICT_LABELS[r.verdict], strong: true, ok: r.verdict === 'viavel' },
    ];
    steps.push({ key: 'decisao', title: 'Decisão', desc: 'Regras da política aplicadas ao preço avaliado.', rows: decisions });
  }
  return steps;
}
