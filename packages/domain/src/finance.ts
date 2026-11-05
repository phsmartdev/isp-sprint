import { annuityFactor, irr as irrOf, npv as npvOf, paybackMonths as paybackOf, type FValue } from './formula';
import { buildModel, runModel, type FinBase, type FinModel, type ModelRun } from './financeModel';
import { ENVELOPE_KINDS, ENVELOPE_RETENTIONS, envelopeTaxBp, FISCAL_REGIME_LABELS, pickFiscalEnvelope, regimeOfYear, type EnvelopeKind, type EnvelopeRetention, type FiscalContextInfo, type FiscalEnvelope } from './fiscalEnvelope';
/**
 * Motor financeiro da viabilidade econômica (especificação FINANCE-1.0 a 1.3, "ENT_MotorFinanceiroViabilidade").
 * Funções puras. Dinheiro em centavos; percentuais de entrada em pontos-base (1% = 100); frações internas (0,35 = 35%).
 *
 *   [1. Entradas & Escopo] → [2. Resolução Fiscal] → [3. Piso Mínimo] → [4. Preço Recomendado] → [5. DRE & Indicadores]
 *
 *   b = 1 − a − c − g                   (base líquida; precisa ser > 0)
 *   a = Σ (w_lote × a_lote)              (a_lote = maior tributo entre os documentos do lote Venda / Serviço; w = receita do lote)
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
/** Retenção na fonte (IRRF, CSRF, ISS/PIS/COFINS/CSLL retidos, INSS retido): camada 3, nunca entra no preço nem na DRE. */
export const isWithholdingTax = (name: string) => /\b(irrf|csrf)\b|retid|reten[cç]/i.test(name.normalize('NFC'));
export function fiscalDocRates(doc: Pick<FiscalDoc, 'taxes' | 'active'>, today: string) {
  const all = doc.active ? doc.taxes.filter((t) => t.active && (!t.validFrom || t.validFrom <= today) && (!t.validTo || t.validTo >= today)) : [];
  const live = all.filter((t) => !isWithholdingTax(t.name));
  return { percentBp: live.reduce((s, t) => s + t.percentBp, 0), fixedCents: live.reduce((s, t) => s + t.fixedCents, 0), taxes: live.map((t) => t.name), complete: live.length > 0, withholdings: all.filter((t) => isWithholdingTax(t.name)).map((t) => t.name) };
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
export const ENGINE_VERSION = 'FINANCE-3.2';

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
  /** (3.0) despesas variáveis % sobre o preço, no divisor do markup; sem valor = 0. A comissão não é mais usada. */
  variableExpenseBp?: number | null;
  /** (3.1) margem líquida alvo da Direção: gera a margem de contribuição recomendada (MO = alvo ÷ (1 − IR); MC = MO + fixas + glosa + inadimplência) */
  netMarginTargetBp?: number | null;
};
export function econSettingsErrors(s: EconSettings) {
  const e: string[] = [];
  for (const [k, v] of [['Margem mínima', s.marginTargetBp], ['TMA', s.tmaMonthlyBp], ['Comissão', s.commissionBp], ['Glosa do setor privado', s.lossPrivateBp], ['Glosa do setor público', s.lossPublicBp], ['Contingência de investimento', s.contingencyCapexBp], ['Contingência de custo mensal', s.contingencyOpexBp], ...(s.variableExpenseBp != null ? [['Despesas variáveis', s.variableExpenseBp] as const] : []), ...(s.overheadBp != null ? [['Despesas fixas', s.overheadBp] as const] : []), ...(s.incomeTaxBp != null ? [['IR/CSLL', s.incomeTaxBp] as const] : []), ...(s.netMarginTargetBp != null ? [['Margem líquida alvo', s.netMarginTargetBp] as const] : [])] as const) if (!Number.isInteger(v) || v < 0 || v >= 10_000) e.push(`${k} inválida.`);
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
/** Tipo de negociação de cada produto/serviço: venda (pagamento único), recorrência (mensalidade) ou locação/aluguel (mensal, mesma conta da recorrência). */
export const DEAL_KINDS = ['venda', 'servico', 'recorrencia', 'locacao'] as const;
export type DealKind = (typeof DEAL_KINDS)[number];
export const DEAL_KIND_LABELS: Record<DealKind, string> = { venda: 'Venda', servico: 'Serviço único', recorrencia: 'Recorrência', locacao: 'Locação/aluguel' };
/**
 * Lotes da viabilidade: Venda = o que é patrimonial (sempre pagamento único); Serviço = o resto, recorrente (recorrência,
 * locação) ou não (serviço único). Em cada lote o tributo é o do documento fiscal de maior tributo entre os produtos do lote.
 */
export const ECON_LOTS = ['venda', 'servico'] as const;
export type EconLot = (typeof ECON_LOTS)[number];
export const ECON_LOT_LABELS: Record<EconLot, string> = { venda: 'Cesta de Produtos', servico: 'Cesta de Serviços' };
export const lotOfKind = (k: DealKind): EconLot => (k === 'venda' ? 'venda' : 'servico');
/** pagamento único: venda e serviço único; mensal: recorrência e locação */
export const isOneTimeKind = (k: DealKind) => k === 'venda' || k === 'servico';
/** venda é pontual; recorrência e locação são mensais */
export const isMonthlyKind = (k: DealKind) => !isOneTimeKind(k);
/** Linha de custo; costItemId/priceId = veio do catálogo (com a versão do preço); manual = valor diferente do catálogo; kind = de qual tipo de negociação o custo sai (vazio = comum, rateado pela receita). */
export type CostLine = { description: string; qtyMilli: number; unitCents: number; unit?: string | null; impact?: CostImpact | null; costItemId?: string | null; priceId?: string | null; manual?: boolean; kind?: DealKind | null };
export type EconInput = {
  mode: EconMode;
  /** N: vigência do contrato em meses (recorrente) */ termMonths: number;
  /** d: mês em que o dinheiro entra (pontual; 0 = à vista) */ receiveMonth: number;
  /** I: itens de investimento inicial (CAPEX) */ capex: CostLine[];
  /** adicional inicial do CAPEX (frete, projeto, mobilização…) */ extraInitialCents: number;
  /** O: custos operacionais mensais */ opex: CostLine[];
  /** sobrescritas da negociação; null = padrão da empresa (margem: a sugestão, limitada ao piso e ao teto) */ commissionBp: number | null; lossBp: number | null; marginTargetBp: number | null;
  /** (3.0) despesas variáveis % da negociação; null = parâmetro da empresa */ variableBp?: number | null;
  /** payback que o vendedor define (meses), até o teto do segmento; null = o teto */ paybackMonths?: number | null;
  /** P informado; null = itens da oportunidade (na negociação mista, é o preço mensal) */ priceCents: number | null;
  /** negociação mista: preço informado da parte de venda (pagamento único); null = itens de venda */ salePriceCents?: number | null;
  /** chave temporal da simulação (ano de vigência do envelope fiscal); null = ano corrente */
  fiscalYear?: number | null;
  /** município (IBGE) do envelope fiscal; null = o da filial emitente */
  municipalityIbge?: string | null;
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
  for (const [k, v] of [['Comissão', i.commissionBp], ['Perda/glosa', i.lossBp], ['Margem mínima', i.marginTargetBp], ['Despesas variáveis', i.variableBp ?? null]] as const) if (v != null && (!Number.isInteger(v) || v < 0 || v >= 10_000)) e.push(`${k} inválida.`);
  if (i.priceCents != null && (!Number.isInteger(i.priceCents) || i.priceCents < 0)) e.push('Preço informado inválido.');
  if (!Number.isInteger(i.extraInitialCents) || i.extraInitialCents < 0) e.push('Adicional inicial inválido.');
  if (i.paybackMonths != null && !(Number.isInteger(i.paybackMonths) && i.paybackMonths >= 1 && i.paybackMonths <= 240)) e.push('Payback entre 1 e 240 meses.');
  for (const l of i.capex) if (l.impact && !(COST_IMPACTS as readonly string[]).includes(l.impact)) e.push(`Impacto inválido em ${l.description}.`);
  for (const l of [...i.capex, ...i.opex]) if (l.kind && !(DEAL_KINDS as readonly string[]).includes(l.kind)) e.push(`Tipo de negociação inválido em ${l.description}.`);
  if (i.salePriceCents != null && (!Number.isInteger(i.salePriceCents) || i.salePriceCents < 0)) e.push('Preço da venda inválido.');
  if (i.fiscalYear != null && !(Number.isInteger(i.fiscalYear) && i.fiscalYear >= 2020 && i.fiscalYear <= 2100)) e.push('Vigência fiscal inválida.');
  if (i.municipalityIbge != null && !/^\d{7}$/.test(i.municipalityIbge)) e.push('Código IBGE do município com 7 dígitos.');
  return e;
}

/** Item da oportunidade com a resolução fiscal do vínculo Filial + Documento + Item. doc null = sem regra (ressalva). */
export type EconItem = { description: string; revenueCents: number; /** tipo de negociação; sem ele vale o tipo da viabilidade (pontual = venda, recorrente = recorrência) */ kind?: DealKind | null; doc: { id?: string; version?: number; name: string; percentBp: number; fixedCents: number; complete: boolean; /** natureza do documento (venda = NF-e de mercadoria; serviço; locação) */ fiscalKind?: string | null } | null };

// ------------------------------------------------------------------ cálculo
export const ECON_VERDICTS = ['viavel', 'abaixo_recomendado', 'fora_politica', 'abaixo_minimo', 'inviavel', 'sem_preco'] as const;
export type EconVerdict = (typeof ECON_VERDICTS)[number];
export const ECON_VERDICT_LABELS: Record<EconVerdict, string> = {
  viavel: 'Viável', abaixo_recomendado: 'Abaixo da margem mínima', fora_politica: 'Fora da política de payback',
  abaixo_minimo: 'Abaixo do preço mínimo', inviavel: 'Inviável: deduções consomem a receita', sem_preco: 'Sem preço para avaliar',
};

export type EconStatement = { revenue: number; tax: number; commission: number; opex: number; amortization: number; contribution: number; risk: number; overhead: number | null; operating: number | null; incomeTax: number | null; net: number | null };

/** Célula de preço (FINANCE-3.0): ritmo (pagamento único ou mensal) × cesta fiscal (Produtos ou Serviços). */
export type EconCell = {
  key: string; ritmo: 'unico' | 'mensal'; lot: EconLot; kinds: DealKind[]; items: number; revenueCents: number;
  doc: string | null; taxPct: number; pending: boolean;
  /** custo da célula: investimento (com contingência) e, na mensal, custo mensal protegido */
  investmentCents: number; monthlyCostCents: number; costCents: number; divisor: number | null;
  suggestedCents: number | null; minCents: number | null; proposedCents: number | null; marginPct: number | null;
  result: EconResult;
};
/** Lote com mais de uma célula: cada uma precificada pelo markup e somadas no preço sugerido do lote. */
export type DealSummary = {
  cells: EconCell[];
  kinds: DealKind[];
  revenue: Record<DealKind, number>;
  suggested: { unico: number | null; mensal: number | null };
  minimum: { unico: number | null; mensal: number | null };
  proposed: { unico: number | null; mensal: number | null } | null;
};
/** Decisão de aprovação: no preço proposto quando informado (é o que vai na proposta), senão no sugerido. */
export type EconDecision = {
  basis: 'proposto' | 'sugerido'; source: 'informado' | 'itens' | 'motor';
  priceCents: number | null; oneTimeCents: number | null;
  verdict: EconVerdict; withinPolicy: boolean | null; marginOk: boolean | null; paybackOk: boolean | null;
  marginPct: number | null; npvCents: number | null; paybackMonths: number | null; irrMonthly: number | null;
  autoApproval?: { ok: boolean; checks: { label: string; ok: boolean }[] };
};

export type EconResult = {
  engineVersion: string;
  /** negociação com venda e itens mensais juntos (um resultado só) */
  deal?: DealSummary;
  mode: EconMode; publicSector: boolean;
  /** P = preço informado; sem ele, o total dos produtos; sem produtos, o preço exato do motor */
  revenueCents: number; priceCents: number | null; /** sugerido = produtos lançados sem valor: a análise roda no preço mínimo sugerido (que acompanha payback e margem) */ priceSource: 'itens' | 'informado' | 'motor' | 'sugerido';
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
  items: { description: string; revenueCents: number; weight: number; percentBp: number; fixedCents: number; doc: string | null; docVersion?: number | null; pending: boolean; lot?: EconLot }[];
  /** tributo por lote: o documento fiscal de maior tributo entre os produtos do lote (pesos pela receita do lote) */
  lots?: { lot: EconLot; revenueCents: number; weight: number; items: number; doc: string | null; docVersion: number | null; percentBp: number; fixedCents: number; pending: boolean }[];
  floor: { cashCents: number | null; economicCents: number | null; minCents: number | null };
  /** preço da margem mínima (piso) e recomendado (preço exato na margem escolhida, nunca abaixo do mínimo) */
  marginPriceCents: number | null; recommendedCents: number | null;
  /** (v2) preço exato pelo markup divisor na margem escolhida */
  markupPriceCents?: number | null;
  /** preço em que a margem operacional zera (cobre amortização e despesas fixas); null sem o parâmetro de despesas fixas */
  operatingFloorCents?: number | null;
  /** sugestão de preço mínimo de venda: o maior entre caixa/TMA, margem mínima e margem operacional zero */
  suggestedMinCents?: number | null;
  /** preço sugerido (FINANCE-3.0: markup na margem escolhida; soma das células); todos os indicadores são calculados nele */
  suggestedCents?: number | null;
  /** pagamento único sugerido quando o lote tem pagamento único e mensal */
  suggestedOneTimeCents?: number | null;
  /** decisão de aprovação: no preço proposto (informado ou dos produtos) ou, sem ele, no sugerido */
  decision?: EconDecision;
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
  /**
   * (v2) desdobramento: 1º mês e contrato inteiro (com o reajuste). (3.1) after = 1º mês depois do payback (D+1), com a
   * amortização zerada; o total é a soma exata dos meses 1..N já arredondados (cada linha "=" é conta das linhas acima).
   */
  statement?: { month: EconStatement; after?: EconStatement | null; total: EconStatement; afterFrom?: number | null };
  /**
   * (3.1) recomendação pela margem líquida alvo (só parâmetros de Configurações → Viabilidade): margem operacional
   * necessária = alvo ÷ (1 − IR/CSLL); margem de contribuição recomendada = MO + despesas fixas + glosa + inadimplência.
   */
  recommendation?: EconRecommendation | null;
  /** política: margem mínima atingida e payback descontado dentro do limite do segmento */
  marginOk: boolean | null; paybackOk: boolean | null;
  verdict: EconVerdict; withinPolicy: boolean | null; withReservations: boolean; warnings: string[];
  /** (v2) aprovação automática: VPL > 0, TIR > TMA, payback e margem na política; senão vai para a alçada */
  autoApproval?: { ok: boolean; checks: { label: string; ok: boolean }[] };
  /** (Financial Studio) modelo de fórmulas usado: chave e versão de cada fórmula alterada pela diretoria */
  model?: { key: string; versions: Record<string, number> };
  /** (3.2) envelope fiscal da simulação: vigência, regime, carga da nota por tipo, alíquota sobre o lucro e retenções (fora do cálculo) */
  fiscal?: FiscalContextInfo;
};

export type EconRecommendation = {
  netTargetPct: number; operatingNeededPct: number | null; contributionPct: number | null;
  /** preço (mensal na recorrente, total na pontual) com a margem recomendada no markup; null = margem não cabe no divisor */
  priceCents: number | null; oneTimePriceCents?: number | null;
  params: { overheadPct: number | null; glosaPct: number; badDebtPct: number; incomeTaxPct: number | null };
  feasible: boolean;
};

/** Payload `recomendacao_viabilidade` (chaves do documento de correções da Direção). */
export function viabilityRecommendationPayload(r: EconRecommendation | null | undefined, mode: EconMode) {
  if (!r) return null;
  const p2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  return {
    'margem_liquida_alvo_%': p2(r.netTargetPct),
    'margem_operacional_necessaria_%': p2(r.operatingNeededPct),
    'margem_contrib_recomendada_%': p2(r.contributionPct),
    [mode === 'pontual' ? 'preco_venda_recomendado_R$' : 'preco_mensal_recomendado_R$']: r.priceCents == null ? null : r.priceCents / 100,
    ...(r.oneTimePriceCents != null ? { 'preco_venda_recomendado_R$': r.oneTimePriceCents / 100 } : {}),
    parametros_utilizados: { 'taxa_rateio_fixo_%': p2(r.params.overheadPct), 'glosa_%': p2(r.params.glosaPct), 'inadimplencia_%': p2(r.params.badDebtPct), 'irpj_csll_%': p2(r.params.incomeTaxPct) },
    viavel: r.feasible,
  };
}

/**
 * Desdobramento com soma exata: cada componente é arredondado no mês e as linhas "=" saem das linhas acima
 * (contribuição = receita − tributos − despesas variáveis − custo mensal − amortização; operacional = contribuição −
 * risco − fixas; líquida = operacional − IR/CSLL). O total é a soma dos meses, então a DRE consolidada fecha centavo a centavo.
 */
export function statementOfPeriods(periods: Record<string, FValue[]>, months: number): { rows: EconStatement[]; total: EconStatement } {
  const at = (code: string, k: number) => { const x = periods[code]?.[k]; return typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null; };
  const rows: EconStatement[] = [];
  for (let k = 0; k < months; k++) {
    const revenue = at('receita', k) ?? 0, tax = at('tributos', k) ?? 0, commission = at('comissao', k) ?? 0, opex = at('custo_mensal', k) ?? 0, amortization = at('amortizacao', k) ?? 0, risk = at('risco', k) ?? 0;
    const overhead = at('despesas_fixas', k);
    const contribution = revenue - tax - commission - opex - amortization;
    const operating = overhead == null ? null : contribution - risk - overhead;
    const irRaw = at('ir_csll', k);
    const incomeTax = operating == null || irRaw == null ? null : operating > 0 ? irRaw : 0;
    const net = operating == null || incomeTax == null ? null : operating - incomeTax;
    rows.push({ revenue, tax, commission, opex, amortization, contribution, risk, overhead, operating, incomeTax, net });
  }
  const f = (key: keyof EconStatement) => { const v = rows.map((x) => x[key]); return v.some((y) => y == null) ? null : (v as number[]).reduce((s, y) => s + y, 0); };
  const total: EconStatement = { revenue: f('revenue') ?? 0, tax: f('tax') ?? 0, commission: f('commission') ?? 0, opex: f('opex') ?? 0, amortization: f('amortization') ?? 0, contribution: f('contribution') ?? 0, risk: f('risk') ?? 0, overhead: f('overhead'), operating: f('operating'), incomeTax: f('incomeTax'), net: f('net') };
  return { rows, total };
}

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
/** preços sugeridos sobem para o centavo de cima: usar a sugestão nunca fica um centavo abaixo da regra */
const roundUp = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.ceil(v - 1e-6));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** TMA mensal: da anual quando informada, senão a mensal das versões antigas. */
export const monthlyTma = (st: Pick<EconSettings, 'tmaMonthlyBp' | 'tmaAnnualBp'>) => (st.tmaAnnualBp != null ? (1 + st.tmaAnnualBp / 10_000) ** (1 / 12) - 1 : st.tmaMonthlyBp / 10_000);

/**
 * Motor financeiro (FINANCE-2.0), conforme a especificação do motor:
 * 1. entradas: investimento (com contingência), despesas variáveis em R$, custo mensal, tributos pelo maior documento de cada lote;
 * 2. preço exato pelo markup divisor: (custos em R$) ÷ (1 − tributos − despesas variáveis − margem), com o investimento
 *    amortizado no payback definido pelo vendedor (até o teto do segmento) e a margem entre o piso e o teto;
 * 3. fluxo de caixa no horizonte (vigência limitada ao prazo máximo): receita reajustada após o 12º mês, menos glosa,
 *    inadimplência, tributos, comissão e custos; VPL e payback pela TMA (anual → mensal), TIR e ROI;
 * 4. decisão: preço mínimo, margem e payback; aprovação automática quando VPL > 0 e TIR > TMA, senão alçada.
 */
export type FiscalArgs = { envelopes: FiscalEnvelope[]; branchId: string | null; defaultIbge: string | null; today: string };
export type EngineArgs = { input: EconInput; items: EconItem[]; settings: EconSettings; publicSector: boolean; model?: FinModel; fiscal?: FiscalArgs };

/**
 * Aplica o envelope fiscal da chave temporal ativa: a carga da nota de cada documento vira a soma dos tributos do
 * envelope para o tipo do documento (camada 1) e o IR/CSLL vira a alíquota efetiva sobre o lucro do envelope (camada 2).
 * As retenções na fonte do envelope ficam só no resultado, para o contas a receber (camada 3). A matemática do motor não muda.
 */
export function applyFiscalEnvelope(args: EngineArgs): { args: EngineArgs; info: FiscalContextInfo | null; warnings: string[] } {
  const f = args.fiscal;
  if (!f) return { args, info: null, warnings: [] };
  const year = args.input.fiscalYear ?? Number(f.today.slice(0, 4));
  const ibge = args.input.municipalityIbge ?? f.defaultIbge;
  const env = pickFiscalEnvelope(f.envelopes, { branchId: f.branchId, ibgeCode: ibge, year });
  const warnings: string[] = [];
  const reg = regimeOfYear(year);
  const base: FiscalContextInfo = { year, regime: reg, branchId: f.branchId, ibgeCode: ibge, envelope: null, basket: [], profitTaxBp: args.settings.incomeTaxBp ?? null, profitTaxSource: args.settings.incomeTaxBp != null ? 'parametros' : null, retentions: [] };
  if (!env) {
    if (f.envelopes.length || reg === 'reforma') warnings.push(`Sem envelope fiscal de ${year} (${FISCAL_REGIME_LABELS[reg]}) para ${!f.branchId ? 'a venda sem filial emitente' : !ibge ? 'a filial sem código IBGE' : `a filial no município ${ibge}`}: valem os tributos dos documentos fiscais e o IR/CSLL dos parâmetros.`);
    return { args, info: base, warnings };
  }
  const basket: FiscalContextInfo['basket'] = [];
  for (const k of ENVELOPE_KINDS) { const b = envelopeTaxBp(env, k); if (b) basket.push({ kind: k, bp: b.bp, parts: b.parts.map((p) => ({ code: p.code, label: p.label, bp: p.bp })) }); }
  const missing = new Set<string>();
  const items = args.items.map((i) => {
    const kind = (i.doc?.fiscalKind ?? null) as EnvelopeKind | null;
    if (!i.doc || !kind || !(ENVELOPE_KINDS as readonly string[]).includes(kind)) return i;
    const b = basket.find((x) => x.kind === kind);
    if (!b) { missing.add(kind); return i; }
    return { ...i, doc: { ...i.doc, percentBp: b.bp, complete: true, name: `${i.doc.name} · envelope ${env.year}` } };
  });
  for (const k of missing) warnings.push(`O envelope fiscal ${env.year} não tem tributos de ${k}: esses produtos usam os tributos do documento fiscal.`);
  const profit = env.values.profitTaxBp;
  const settings = profit != null ? { ...args.settings, incomeTaxBp: profit } : args.settings;
  if (profit == null) warnings.push(`O envelope fiscal ${env.year} não tem a alíquota efetiva sobre o lucro: IR/CSLL pelos parâmetros de viabilidade.`);
  const rv = env.values.retentions ?? {};
  const retentions = (Object.keys(ENVELOPE_RETENTIONS) as EnvelopeRetention[]).filter((c) => (rv[c] ?? 0) > 0).map((code) => ({ code, label: ENVELOPE_RETENTIONS[code], bp: rv[code]! }));
  const info: FiscalContextInfo = {
    ...base, envelope: { id: env.id, year: env.year, municipality: env.municipality ?? null }, basket,
    profitTaxBp: settings.incomeTaxBp ?? null, profitTaxSource: profit != null ? 'envelope' : base.profitTaxSource, retentions,
  };
  return { args: { ...args, items, settings }, info, warnings };
}

export function financeEngine(args: EngineArgs): EconResult {
  const fx = applyFiscalEnvelope(args);
  const r = financeEngineCore(fx.args);
  if (!fx.info) return r;
  return { ...r, fiscal: fx.info, warnings: [...new Set([...fx.warnings, ...r.warnings])] };
}

function financeEngineCore(args0: EngineArgs): EconResult {

  const inp0 = args0.input;
  const kindOf = (i: EconItem): DealKind => i.kind ?? (inp0.mode === 'pontual' ? 'venda' : 'recorrencia');
  const lotOfItem = (i: EconItem) => cestaOf(i.doc?.fiscalKind ?? null, kindOf(i));
  // teto de cada cesta: o documento de maior tributo entre os produtos da cesta (completos primeiro)
  const better = (d: NonNullable<EconItem['doc']>, cur?: NonNullable<EconItem['doc']>) => !cur || d.percentBp > cur.percentBp || (d.percentBp === cur.percentBp && d.fixedCents > cur.fixedCents);
  const top = new Map<EconLot, NonNullable<EconItem['doc']>>();
  for (const i of args0.items) { const l = lotOfItem(i), d = i.doc; if (d?.complete && better(d, top.get(l))) top.set(l, d); }
  const lotOf = new Map<EconItem, EconLot>();
  const items = args0.items.map((i) => { const it = { ...i, kind: kindOf(i), doc: top.get(lotOfItem(i)) ?? i.doc }; lotOf.set(it, lotOfItem(i)); return it; });
  const inherited = args0.items.filter((i) => !i.doc?.complete && top.has(lotOfItem(i))).length;
  const extraWarnings = inherited ? [`${inherited} produto(s) sem documento fiscal próprio usam o documento de maior tributo da sua cesta.`] : [];
  const args: EngineArgs = { ...args0, items };
  const st = args.settings;
  const N = Math.min(inp0.termMonths, st.horizonMaxMonths ?? inp0.termMonths);

  // células: ritmo × cesta
  type Cell = { key: string; ritmo: 'unico' | 'mensal'; lot: EconLot; items: EconItem[] };
  const cells: Cell[] = [];
  for (const ritmo of ['unico', 'mensal'] as const) for (const lot of ECON_LOTS) {
    const its = items.filter((i) => (isOneTimeKind(i.kind!) ? 'unico' : 'mensal') === ritmo && lotOf.get(i) === lot);
    if (its.length) cells.push({ key: `${ritmo}:${lot}`, ritmo, lot, items: its });
  }
  const evalAt = (a: EngineArgs, price: number | null) => financeEngineDetailed({ ...a, input: { ...a.input, priceCents: price, salePriceCents: null } }).result;

  // sem produtos: uma parte só, com todos os custos
  if (!cells.length) {
    const a = { ...args, input: { ...inp0, salePriceCents: null } };
    const sug = evalAt(a, null).suggestedCents ?? null;
    const S = evalAt(a, sug);
    const P = inp0.priceCents != null ? evalAt(a, inp0.priceCents) : null;
    return finalize(S, P, P ? 'informado' : 'motor', extraWarnings);
  }

  // custos de cada célula: cesta do investimento (Produtos / Serviços); sem cesta = comum, rateado pela receita do contrato
  const rev = (c: Cell) => c.items.reduce((t, i) => t + Math.max(0, i.revenueCents), 0);
  const weightOf = (cs: Cell[]) => {
    const w = cs.map((c) => (c.ritmo === 'unico' ? rev(c) : rev(c) * Math.max(1, N)));
    const tot = w.reduce((t, x) => t + x, 0);
    return tot > 0 ? w.map((x) => x / tot) : cs.map((c) => c.items.length / cs.reduce((t, x) => t + x.items.length, 0));
  };
  const split = (l: CostLine, f: number): CostLine => ({ ...l, unitCents: Math.round(l.unitCents * f) });
  const capex = new Map<string, CostLine[]>(cells.map((c) => [c.key, []]));
  const opex = new Map<string, CostLine[]>(cells.map((c) => [c.key, []]));
  const warnings = [...extraWarnings];
  const spread = (lines: CostLine[], targets: Cell[], into: Map<string, CostLine[]>) => {
    if (!targets.length) return false;
    const w = weightOf(targets);
    targets.forEach((c, k) => into.get(c.key)!.push(...lines.map((l) => split(l, w[k]!)).filter((l) => l.unitCents > 0)));
    return true;
  };
  for (const lot of ECON_LOTS) {
    const lines = inp0.capex.filter((l) => l.kind && lotOfKind(l.kind) === lot);
    if (!lines.length) continue;
    if (!spread(lines, cells.filter((c) => c.lot === lot), capex)) { spread(lines, cells, capex); warnings.push(`${lines.length} investimento(s) da ${ECON_LOT_LABELS[lot]} sem produto nessa cesta: rateado(s) entre as demais.`); }
  }
  spread(inp0.capex.filter((l) => !l.kind), cells, capex);
  const monthly = cells.filter((c) => c.ritmo === 'mensal');
  if (monthly.length) {
    for (const lot of ECON_LOTS) {
      const lines = inp0.opex.filter((l) => l.kind && lotOfKind(l.kind) === lot);
      if (lines.length && !spread(lines, monthly.filter((c) => c.lot === lot), opex)) spread(lines, monthly, opex);
    }
    spread(inp0.opex.filter((l) => !l.kind), monthly, opex);
  } else if (inp0.opex.length) warnings.push('Sem produto mensal: os custos mensais não entram no cálculo (use o investimento inicial).');
  const wAll = weightOf(cells);
  const parts = cells.map((c, k) => ({
    cell: c,
    args: { ...args, items: c.items, input: { ...inp0, mode: c.ritmo === 'unico' ? 'pontual' as const : 'recorrente' as const, capex: capex.get(c.key)!, opex: c.ritmo === 'mensal' ? opex.get(c.key)! : [], extraInitialCents: Math.round(inp0.extraInitialCents * wAll[k]!), priceCents: null, salePriceCents: null } },
  }));

  // preço sugerido de cada célula (markup na margem escolhida) e o mínimo (no piso)
  const pre = parts.map((p) => evalAt(p.args, null));
  const sugOf = (k: number) => pre[k]!.suggestedCents ?? null;
  const S = parts.map((p, k) => evalAt(p.args, sugOf(k)));
  const hasU = cells.some((c) => c.ritmo === 'unico'), hasM = monthly.length > 0;
  // preço proposto: informado (mensal no preço por mês; único no preço do pagamento único) ou o total dos produtos
  const revR = (r: 'unico' | 'mensal') => cells.filter((c) => c.ritmo === r).reduce((t, c) => t + rev(c), 0);
  const askU = hasU ? (hasM ? inp0.salePriceCents ?? null : inp0.priceCents) : null;
  const askM = hasM ? inp0.priceCents : null;
  const propU = askU ?? (hasU && revR('unico') > 0 ? revR('unico') : null);
  const propM = askM ?? (hasM && revR('mensal') > 0 ? revR('mensal') : null);
  const anyProposed = propU != null || propM != null;
  const source: EconDecision['source'] = askU != null || askM != null ? 'informado' : anyProposed ? 'itens' : 'motor';
  const share = (r: 'unico' | 'mensal', total: number | null) => {
    const idx = parts.map((p, k) => (p.cell.ritmo === r ? k : -1)).filter((k) => k >= 0);
    const base = idx.map((k) => (revR(r) > 0 ? rev(parts[k]!.cell) : sugOf(k) ?? 0));
    const sum = base.reduce((t, x) => t + x, 0);
    const out = new Map<number, number | null>();
    idx.forEach((k, n) => out.set(k, total == null ? sugOf(k) : Math.round(total * (sum > 0 ? base[n]! / sum : 1 / idx.length))));
    return out;
  };
  const shU = share('unico', propU), shM = share('mensal', propM);
  const P = anyProposed ? parts.map((p, k) => evalAt(p.args, (p.cell.ritmo === 'unico' ? shU : shM).get(k) ?? null)) : null;

  if (cells.length === 1) {
    const r = finalize(S[0]!, P?.[0] ?? null, source, warnings);
    r.lots = lotsOf([S[0]!]);
    return r;
  }
  const sum = (r: 'unico' | 'mensal', xs: (number | null | undefined)[]) => { const v = xs.filter((_, k) => parts[k]!.cell.ritmo === r); return v.length && v.every((x) => x != null) ? (v as number[]).reduce((t, x) => t + x, 0) : null; };
  const comb = combineParts(parts.map((p) => p.cell), S, N, warnings);
  const combP = P ? combineParts(parts.map((p) => p.cell), P, N, warnings) : null;
  const sugU = sum('unico', pre.map((x) => x.suggestedCents)), sugM = sum('mensal', pre.map((x) => x.suggestedCents));
  const minU = sum('unico', pre.map((x) => x.suggestedMinCents)), minM = sum('mensal', pre.map((x) => x.suggestedMinCents));
  const main = hasM ? 'mensal' : 'unico';
  Object.assign(comb, {
    priceCents: main === 'mensal' ? sugM : sugU, suggestedCents: main === 'mensal' ? sugM : sugU, suggestedOneTimeCents: hasM && hasU ? sugU : null,
    suggestedMinCents: main === 'mensal' ? minM : minU, recommendedCents: main === 'mensal' ? sugM : sugU, markupPriceCents: main === 'mensal' ? sugM : sugU, marginPriceCents: main === 'mensal' ? minM : minU,
    floor: { cashCents: null, economicCents: null, minCents: main === 'mensal' ? minM : minU }, operatingFloorCents: null,
  });
  const r = finalize(comb, combP, source, []);
  r.priceCents = comb.priceCents;
  if (combP) r.decision = { ...r.decision!, priceCents: main === 'mensal' ? propM : propU, oneTimeCents: hasM && hasU ? propU : null };
  r.lots = lotsOf(S);
  const revK = (k: DealKind) => items.filter((i) => i.kind === k).reduce((t, i) => t + Math.max(0, i.revenueCents), 0);
  r.deal = {
    cells: parts.map((p, k) => {
      const x = S[k]!, D = x.rates.bMarkup != null ? x.rates.bMarkup - x.rates.m : null;
      const cost = x.mode === 'recorrente' ? Math.round((x.investmentCents ?? 0) / Math.max(1, x.term.D) + x.monthlyCostCents) : x.investmentCents ?? 0;
      return {
        key: p.cell.key, ritmo: p.cell.ritmo, lot: p.cell.lot, kinds: DEAL_KINDS.filter((kk) => p.cell.items.some((i) => i.kind === kk)), items: p.cell.items.length, revenueCents: rev(p.cell),
        doc: x.lots?.[0]?.doc ?? null, taxPct: x.rates.a * 100, pending: x.withReservations, investmentCents: x.investmentCents ?? 0, monthlyCostCents: x.monthlyCostCents, costCents: cost, divisor: D,
        suggestedCents: x.suggestedCents ?? null, minCents: x.suggestedMinCents ?? null, proposedCents: P ? P[k]!.priceCents : null, marginPct: x.kpi?.marginPct ?? null, result: x,
      };
    }),
    kinds: DEAL_KINDS.filter((k) => items.some((i) => i.kind === k)),
    revenue: { venda: revK('venda'), servico: revK('servico'), recorrencia: revK('recorrencia'), locacao: revK('locacao') },
    suggested: { unico: sugU, mensal: sugM }, minimum: { unico: minU, mensal: minM },
    proposed: anyProposed ? { unico: propU, mensal: propM } : null,
  };
  return r;
}

/**
 * Cesta fiscal do produto (regra provisória, decisão em aberto para NFCOM e locação): documento de venda (NF-e de
 * mercadoria) = Cesta de Produtos; qualquer outro documento = Cesta de Serviços; sem documento, pelo tipo de negociação.
 */
export function cestaOf(fiscalKind: string | null | undefined, kind: DealKind): EconLot {
  if (fiscalKind) return fiscalKind === 'venda' ? 'venda' : 'servico';
  return lotOfKind(kind);
}

function lotsOf(rs: EconResult[]): NonNullable<EconResult['lots']> {
  const by = new Map<EconLot, NonNullable<EconResult['lots']>[number]>();
  for (const l of rs.flatMap((r) => r.lots ?? [])) {
    const cur = by.get(l.lot);
    by.set(l.lot, cur ? { ...cur, revenueCents: cur.revenueCents + l.revenueCents, items: cur.items + l.items } : { ...l });
  }
  const tot = [...by.values()].reduce((t, l) => t + l.revenueCents, 0);
  return [...by.values()].map((l) => ({ ...l, weight: tot > 0 ? l.revenueCents / tot : l.weight }));
}

/** Indicadores no sugerido (r) e decisão no proposto (p) quando houver; os campos de decisão do topo seguem a decisão. */
function finalize(r: EconResult, p: EconResult | null, source: EconDecision['source'], warnings: string[]): EconResult {
  const d = p ?? r;
  const out: EconResult = { ...r, priceSource: 'motor', warnings: [...new Set([...r.warnings, ...(p?.warnings ?? []), ...warnings])] };
  out.suggestedCents = r.priceCents;
  out.decision = {
    basis: p ? 'proposto' : 'sugerido', source: p ? source : 'motor', priceCents: d.priceCents, oneTimeCents: null,
    verdict: d.verdict, withinPolicy: d.withinPolicy, marginOk: d.marginOk, paybackOk: d.paybackOk,
    marginPct: d.kpi?.marginPct ?? null, npvCents: d.kpi?.npvCents ?? null, paybackMonths: d.kpi?.paybackMonths ?? null, irrMonthly: d.kpi?.irrMonthly ?? null,
    autoApproval: d.autoApproval,
  };
  out.verdict = d.verdict; out.withinPolicy = d.withinPolicy; out.marginOk = d.marginOk; out.paybackOk = d.paybackOk; out.autoApproval = d.autoApproval;
  return out;
}

/**
 * Junta as células num resultado só: fluxos somados (VPL, TIR, payback da negociação), margens sobre a mesma base
 * (mês na mensal, valor único na única), investimentos e custos somados; decisão = a mais restritiva das partes.
 */
function combineParts(cells: { ritmo: 'unico' | 'mensal' }[], parts: EconResult[], N: number, warnings: string[]): EconResult {
  const base = parts.find((_, k) => cells[k]!.ritmo === 'mensal') ?? parts[0]!;
  const hasM = cells.some((c) => c.ritmo === 'mensal');
  const len = Math.max(...parts.map((p) => p.cashflow.length));
  const flows = Array.from({ length: len }, (_, k) => parts.reduce((t, p) => t + (p.cashflow[k] ?? 0), 0));
  const r = base.rates.r;
  const priced = parts.every((p) => !!p.kpi);
  const pb = priced ? paybackOf(flows, r) : null, pbS = priced ? paybackOf(flows, 0) : null;
  const npvC = priced ? Math.round(npvOf(flows, r)) : 0;
  const ir = priced ? irrOf(flows) : null;
  const inv = parts.reduce((t, p) => t + (p.investmentCents ?? 0), 0);
  const Dalvo = base.term.Dalvo;
  const paybackOk = !priced ? null : hasM ? inv === 0 || (pb != null && pb <= Dalvo) : null;
  const order: EconVerdict[] = ['inviavel', 'sem_preco', 'abaixo_minimo', 'fora_politica', 'abaixo_recomendado', 'viavel'];
  let verdict = order[Math.min(...parts.map((p) => order.indexOf(p.verdict === 'fora_politica' ? 'viavel' : p.verdict)))]!;
  if ((verdict === 'viavel' || verdict === 'abaixo_recomendado') && paybackOk === false) verdict = 'fora_politica';
  const marginOk = parts.every((p) => p.marginOk === true) ? true : parts.some((p) => p.marginOk === null) ? null : false;
  // base das margens: mês da mensal, valor único da única
  const stOf = (p: EconResult, k: number) => (cells[k]!.ritmo === 'mensal' ? p.statement?.month : p.statement?.total);
  const add = (f: keyof EconStatement) => { const xs = parts.map((p, k) => stOf(p, k)?.[f] ?? null); return xs.some((x) => x == null) ? null : (xs as number[]).reduce((t, x) => t + x, 0); };
  const revB = add('revenue') ?? 0;
  const pctB = (v: number | null) => (v == null || revB <= 0 ? null : (v / revB) * 100);
  const contrib = add('contribution') ?? 0;
  const sumStmt = (xs: (EconStatement | undefined)[]): EconStatement | undefined => {
    if (!xs.length || xs.some((x) => !x)) return undefined;
    const f = (k: keyof EconStatement) => { const v = (xs as EconStatement[]).map((x) => x[k]); return v.some((y) => y == null) ? null : (v as number[]).reduce((t, y) => t + y, 0); };
    return { revenue: f('revenue') ?? 0, tax: f('tax') ?? 0, commission: f('commission') ?? 0, opex: f('opex') ?? 0, amortization: f('amortization') ?? 0, contribution: f('contribution') ?? 0, risk: f('risk') ?? 0, overhead: f('overhead'), operating: f('operating'), incomeTax: f('incomeTax'), net: f('net') };
  };
  const monthParts = parts.filter((_, k) => cells[k]!.ritmo === 'mensal');
  const tma = r;
  const checks = [
    { label: 'VPL positivo', ok: priced && npvC > 0 },
    { label: 'TIR acima da TMA', ok: ir != null && ir > tma },
    ...(hasM ? [{ label: 'Payback descontado dentro do teto', ok: paybackOk === true }] : []),
    { label: 'Margem no piso ou acima (todas as cestas)', ok: marginOk === true },
    { label: 'Preço no mínimo ou acima (todas as cestas)', ok: !['abaixo_minimo', 'inviavel', 'sem_preco'].includes(verdict) },
    { label: 'Tributos de todos os produtos', ok: parts.every((p) => !p.withReservations) },
  ];
  const op = add('operating'), net = add('net');
  return {
    ...base,
    mode: hasM ? 'recorrente' : 'pontual',
    revenueCents: parts.reduce((t, p) => t + p.revenueCents, 0),
    rates: { ...base.rates, a: revB > 0 ? (add('tax') ?? 0) / revB : base.rates.a },
    fixedTaxCents: parts.reduce((t, p) => t + p.fixedTaxCents, 0),
    initialCents: parts.reduce((t, p) => t + p.initialCents, 0), monthlyCostCents: monthParts.reduce((t, p) => t + p.monthlyCostCents, 0),
    capexBaseCents: parts.reduce((t, p) => t + p.capexBaseCents, 0), capexContingencyCents: parts.reduce((t, p) => t + p.capexContingencyCents, 0),
    opexBaseCents: monthParts.reduce((t, p) => t + p.opexBaseCents, 0), opexContingencyCents: monthParts.reduce((t, p) => t + p.opexContingencyCents, 0),
    variableFixedCents: parts.reduce((t, p) => t + (p.variableFixedCents ?? 0), 0), investmentCents: inv,
    term: { ...base.term, N: hasM ? N : 0 },
    items: parts.flatMap((p) => p.items),
    kpi: priced ? {
      taxCents: add('tax') ?? 0, commissionCents: add('commission') ?? 0, lossCents: add('risk') ?? 0, contributionCents: contrib, marginPct: pctB(contrib) ?? 0,
      npvCents: npvC, irrMonthly: ir, irrAnnual: ir === null ? null : (1 + ir) ** 12 - 1, paybackMonths: pb, simplePaybackMonths: pbS,
      margins: { contributionPct: pctB(contrib) ?? 0, amortizationCents: add('amortization') ?? 0, overheadCents: add('overhead'), operatingCents: op, operatingPct: pctB(op), incomeTaxCents: add('incomeTax'), netCents: net, netPct: pctB(net) },
      cashMonthlyCents: monthParts.reduce((t, p) => t + (p.kpi?.cashMonthlyCents ?? 0), 0), amortizationCents: add('amortization') ?? 0,
      roiPct: inv > 0 ? (flows.reduce((t, x) => t + x, 0) / inv) * 100 : null,
    } : null,
    cashflow: flows.map(Math.round),
    statement: (() => {
      const tot = sumStmt(parts.map((p) => p.statement?.total)); const mon = sumStmt(monthParts.map((p) => p.statement?.month)) ?? base.statement?.month;
      const aft = monthParts.length && monthParts.every((p) => p.statement?.after) ? sumStmt(monthParts.map((p) => p.statement!.after!)) ?? null : null;
      return tot && mon ? { month: mon, after: aft, afterFrom: aft ? base.statement?.afterFrom ?? null : null, total: tot } : undefined;
    })(),
    recommendation: (() => {
      const rec0 = parts.find((p) => p.recommendation)?.recommendation;
      if (!rec0) return base.recommendation ?? null;
      const sumP = (xs: EconResult[]) => (xs.length && xs.every((p) => p.recommendation?.priceCents != null) ? xs.reduce((t, p) => t + p.recommendation!.priceCents!, 0) : null);
      const uniParts = parts.filter((_, k) => cells[k]!.ritmo === 'unico');
      return { ...rec0, priceCents: hasM ? sumP(monthParts) : sumP(uniParts), oneTimePriceCents: hasM && uniParts.length ? sumP(uniParts) : null, feasible: parts.every((p) => p.recommendation?.feasible) };
    })(),
    paybackOk, marginOk, verdict, withinPolicy: priced ? paybackOk !== false && marginOk === true : null,
    withReservations: parts.some((p) => p.withReservations), warnings: [...new Set([...parts.flatMap((p) => p.warnings), ...warnings])],
    autoApproval: { ok: checks.every((x) => x.ok) && parts.every((p) => !!p.autoApproval), checks },
  };
}

/** O motor com o que o Financial Studio mostra: as variáveis de entrada (com o preço avaliado) e a execução do modelo. */
export function financeEngineDetailed(args: EngineArgs): { result: EconResult; base: FinBase; run: ModelRun; model: FinModel } {
  const { input: inp, settings: st, publicSector } = args;
  const warnings: string[] = [];
  const bp = (v: number) => v / 10_000;
  const rec = inp.mode === 'recorrente';
  // 1. entradas: investimento com contingência; entrega e taxa fixa de venda sem contingência
  const revenue = args.items.reduce((s, i) => s + Math.max(0, i.revenueCents), 0);
  const capexBase = inp.capex.filter((l) => !isVariableFixed(l.impact)).reduce((s, l) => s + costLineTotal(l), 0);
  const E = inp.capex.filter((l) => isVariableFixed(l.impact)).reduce((s, l) => s + costLineTotal(l), 0) + inp.extraInitialCents;
  const opexBase = rec ? inp.opex.reduce((s, l) => s + costLineTotal(l), 0) : 0;
  const invEstimate = capexBase * (1 + bp(st.contingencyCapexBp)) + E; // só para os avisos de prazo
  if (!rec && inp.opex.length) warnings.push('Venda pontual: custos mensais não entram no cálculo (use o investimento inicial).');
  // tributos por lote: em cada lote (Venda / Serviço) vale o documento fiscal de maior tributo entre os produtos do lote;
  // com os dois lotes no mesmo cálculo, a alíquota é a dos lotes ponderada pela receita; o fixo, uma vez por lote (fatura)
  const n = args.items.length;
  const kindOfItem = (i: EconItem): DealKind => i.kind ?? (rec ? 'recorrencia' : 'venda');
  const lotRev = (l: EconLot) => args.items.filter((i) => lotOfKind(kindOfItem(i)) === l).reduce((t, i) => t + Math.max(0, i.revenueCents), 0);
  const lots = ECON_LOTS.map((lot) => {
    const its = args.items.filter((i) => lotOfKind(kindOfItem(i)) === lot);
    const all = its.map((i) => i.doc).filter((d): d is NonNullable<EconItem['doc']> => !!d);
    const max = (ds: NonNullable<EconItem['doc']>[]) => ds.reduce<NonNullable<EconItem['doc']> | null>((best, d) => (!best || d.percentBp > best.percentBp || (d.percentBp === best.percentBp && d.fixedCents > best.fixedCents) ? d : best), null);
    // o maior entre os documentos completos; sem nenhum completo, o maior que houver (e o lote fica pendente)
    const top = max(all.filter((d) => d.complete)) ?? max(all);
    return { lot, its, top, revenueCents: lotRev(lot) };
  }).filter((x) => x.its.length);
  const lotW = (x: (typeof lots)[number]) => (revenue > 0 ? x.revenueCents / revenue : n ? x.its.length / n : 0);
  const a = lots.reduce((t, x) => t + lotW(x) * bp(x.top?.percentBp ?? 0), 0);
  const F = lots.reduce((t, x) => t + (x.top?.fixedCents ?? 0), 0);
  const items = args.items.map((i) => {
    const lot = lotOfKind(kindOfItem(i));
    const top = lots.find((x) => x.lot === lot)?.top ?? null;
    const w = revenue > 0 ? Math.max(0, i.revenueCents) / revenue : n ? 1 / n : 0;
    return { description: i.description, revenueCents: i.revenueCents, weight: w, percentBp: top?.percentBp ?? 0, fixedCents: top?.fixedCents ?? 0, doc: top?.name ?? null, docVersion: top?.version ?? null, pending: !top?.complete, lot };
  });
  const lotsOut = lots.map((x) => ({ lot: x.lot, revenueCents: x.revenueCents, weight: lotW(x), items: x.its.length, doc: x.top?.name ?? null, docVersion: x.top?.version ?? null, percentBp: x.top?.percentBp ?? 0, fixedCents: x.top?.fixedCents ?? 0, pending: !x.top?.complete }));
  const pendingItems = items.filter((i) => i.pending);
  const noDoc = args.items.filter((i, k) => !i.doc?.complete && !items[k]!.pending);
  if (!n) warnings.push('Sem produtos na oportunidade: sem tributos por item; o preço avaliado é o preço exato do motor.');
  if (pendingItems.length) warnings.push(`${lotsOut.filter((l) => l.pending).map((l) => ECON_LOT_LABELS[l.lot]).join(' e ')} sem documento fiscal com tributos vigentes (${pendingItems.slice(0, 3).map((i) => i.description).join(', ')}${pendingItems.length > 3 ? '…' : ''}): calculado sem esses tributos.`);
  if (noDoc.length) warnings.push(`${noDoc.length} produto(s) sem documento fiscal próprio usam o documento de maior tributo do seu lote.`);
  // parâmetros
  // FINANCE-3.0: sem comissão (a empresa não paga comissão por venda); no lugar, despesas variáveis % (0 sem parâmetro)
  const c = bp(inp.variableBp ?? st.variableExpenseBp ?? 0);
  const glosa = bp(inp.lossBp ?? (publicSector ? st.lossPublicBp : st.lossPrivateBp));
  const badDebt = st.badDebtBp != null ? bp(st.badDebtBp) : 0;
  if (st.badDebtBp == null) warnings.push('Inadimplência não informada em Configurações → Viabilidade: só a glosa entra no risco.');
  const g = glosa + badDebt;
  const mMin = bp(st.marginTargetBp), mMax = st.marginMaxBp != null ? bp(st.marginMaxBp) : null;
  const mAsk = inp.marginTargetBp != null ? bp(inp.marginTargetBp) : bp(st.marginSuggestedBp ?? st.marginTargetBp);
  const m = clamp(mAsk, mMin, mMax ?? 1);
  if (inp.marginTargetBp != null && m !== mAsk) warnings.push(`Margem pedida (${(mAsk * 100).toLocaleString('pt-BR')}%) fora dos limites da Direção: ajustada para ${(m * 100).toLocaleString('pt-BR')}%.`);
  const Dalvo = publicSector ? st.paybackMaxPublic : st.paybackMaxPrivate;
  const horizon = st.horizonMaxMonths ?? null;
  const N = rec ? Math.min(inp.termMonths, horizon ?? inp.termMonths) : 0;
  if (rec && horizon != null && inp.termMonths > horizon) warnings.push(`Vigência de ${inp.termMonths} meses acima do prazo máximo de previsão: a projeção vai até ${horizon} meses.`);
  const pbAsk = inp.paybackMonths ?? null;
  // o vendedor ajusta o payback livremente (até o prazo projetado) e a análise toda acompanha;
  // o teto do setor continua como regra de aprovação, pelo payback descontado real (atende_payback)
  const D = rec ? Math.max(1, Math.min(pbAsk ?? Dalvo, N || 1)) : 0;
  if (rec && pbAsk != null && pbAsk > Dalvo) warnings.push(`Payback de ${pbAsk} meses acima do teto do setor ${publicSector ? 'público' : 'privado'} (${Dalvo}): o preço mínimo cai, mas se o retorno real passar do teto a viabilidade vai para a alçada superior.`);
  if (rec && (pbAsk ?? Dalvo) > N && invEstimate > 0) warnings.push(`Payback maior que a projeção (${N} meses): o investimento é amortizado em ${D} meses.`);
  const d = rec ? 0 : inp.receiveMonth;

  // 2–4. preço, fluxo de caixa e decisão: executados pelo modelo de fórmulas (Financial Studio; padrão = motor 2.0)
  const fm = args.model ?? defaultModel();
  const base: FinBase = {
    recorrente: rec, receita_produtos: revenue, investimento_base: capexBase, despesas_variaveis: E, custo_mensal_base: rec ? opexBase : 0,
    aliq_contingencia_capex: bp(st.contingencyCapexBp), aliq_contingencia_opex: bp(st.contingencyOpexBp),
    aliq_tributos: a, tributo_fixo: F, tributos_completos: !(pendingItems.length > 0 || !n),
    aliq_comissao: 0, aliq_despesas_variaveis: c, aliq_glosa: glosa, aliq_inadimplencia: badDebt, margem: m, margem_piso: mMin,
    tma_anual: st.tmaAnnualBp != null ? bp(st.tmaAnnualBp) : null, tma_mensal_informada: bp(st.tmaMonthlyBp), inflacao_anual: st.inflationAnnualBp != null ? bp(st.inflationAnnualBp) : null,
    aliq_despesas_fixas: st.overheadBp != null ? bp(st.overheadBp) : null, aliq_ir: st.incomeTaxBp != null ? bp(st.incomeTaxBp) : null,
    margem_liquida_alvo: st.netMarginTargetBp != null ? bp(st.netMarginTargetBp) : null,
    prazo: N, payback: D, teto_payback: Dalvo, mes_recebimento: d, preco: null,
  };
  const numv = (x: FValue | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const boolv = (x: FValue | undefined) => x === true;
  // 1ª passada sem preço: pisos e preço recomendado (não dependem do preço)
  const pre = runModel(fm, base);
  const b = numv(pre.values.base_caixa) ?? 0;
  const r = numv(pre.values.tma_mensal) ?? 0;
  const inflM = numv(pre.values.inflacao_mensal) ?? 0;
  const I = numv(pre.values.investimento) ?? 0, Inv = numv(pre.values.investimento_total) ?? 0, O = numv(pre.values.custo_mensal) ?? 0;
  const capexCont = I - capexBase, opexCont = rec ? O - opexBase : 0;
  const cash = numv(pre.values.preco_caixa), eco = numv(pre.values.preco_tma), minP = numv(pre.values.preco_minimo);
  const marginPrice = numv(pre.values.preco_margem_minima), markupPrice = numv(pre.values.preco_exato), recP = numv(pre.values.preco_recomendado);
  const opFloor = numv(pre.values.preco_margem_operacional_zero), suggested = numv(pre.values.preco_minimo_sugerido);
  const bMk = numv(pre.values.base_markup) ?? 1 - a - c;
  if (bMk - m <= 0) warnings.push('Tributos, despesas variáveis e margem somam 100% ou mais: nenhum preço fecha o markup.');
  else if (b <= 0) warnings.push('Tributos, despesas variáveis, glosa e inadimplência somam 100% ou mais da receita: nenhum preço cobre o caixa.');
  else if (markupPrice === null) warnings.push('A margem escolhida é maior que a base do markup: não há preço que entregue essa margem.');
  for (const w of pre.warnings) if (!w.includes('Divisão por zero')) warnings.push(`Fórmula ${w}`);

  // 3. preço avaliado: informado; senão o dos produtos; sem produtos, o recomendado do motor.
  // Produtos lançados sem valor (receita zero): a análise roda no preço mínimo sugerido, então payback, margens e VPL
  // acompanham o payback e a margem que o vendedor indicar; a receita dos produtos continua zero.
  const noValue = n > 0 && revenue <= 0;
  const priceSource: EconResult['priceSource'] = inp.priceCents != null ? 'informado' : noValue ? 'sugerido' : n ? 'itens' : 'motor';
  // sem valor nos produtos: o maior entre o mínimo sugerido e o preço que entrega a margem escolhida pelo vendedor
  const sugP = suggested != null && recP != null ? Math.max(suggested, recP) : suggested ?? recP;
  const P0 = inp.priceCents ?? (noValue ? roundUp(sugP) : n ? revenue : roundUp(recP));
  const P = P0 != null && Number.isFinite(P0) ? P0 : null;
  let kpi: EconResult['kpi'] = null;
  let flows: number[] = [];
  let statement: EconResult['statement'];
  let run: ModelRun | null = null;
  if (P != null && P > 0) {
    run = runModel(fm, { ...base, preco: P });
    const v = run.values;
    flows = run.fluxo;
    const R0 = (x: FValue | undefined) => { const y = numv(x); return y == null ? null : Math.round(y); };
    const month = (code: string) => R0(v[code]);
    const months = rec ? N : 1;
    const sp = statementOfPeriods(run.periods, months);
    const afterFrom = rec && D < N ? D + 1 : null;
    statement = { month: sp.rows[0]!, after: afterFrom ? sp.rows[afterFrom - 1]! : null, afterFrom, total: sp.total };
    const mcPct = numv(v.margem_contribuicao_pct);
    const ir = numv(v.tir);
    kpi = {
      taxCents: month('tributos') ?? 0, commissionCents: month('comissao') ?? 0, lossCents: month('risco') ?? 0, contributionCents: month('margem_contribuicao') ?? 0,
      marginPct: (mcPct ?? 0) * 100,
      npvCents: R0(v.vpl) ?? 0, irrMonthly: ir, irrAnnual: ir === null ? null : (1 + ir) ** 12 - 1,
      paybackMonths: numv(v.payback_descontado), simplePaybackMonths: numv(v.payback_simples),
      margins: {
        contributionPct: (mcPct ?? 0) * 100, amortizationCents: statement.month.amortization, overheadCents: statement.month.overhead,
        operatingCents: statement.month.operating, operatingPct: statement.month.operating == null ? null : (statement.month.operating / statement.month.revenue) * 100,
        incomeTaxCents: statement.month.incomeTax, netCents: statement.month.net, netPct: statement.month.net == null ? null : (statement.month.net / statement.month.revenue) * 100,
      },
      cashMonthlyCents: month('fluxo_caixa') ?? 0, amortizationCents: month('amortizacao') ?? 0, roiPct: numv(v.roi) == null ? null : numv(v.roi)! * 100,
    };
    for (const w of run.warnings) if (!w.includes('Divisão por zero') && !warnings.includes(`Fórmula ${w}`)) warnings.push(`Fórmula ${w}`);
  }
  let recommendation: EconRecommendation | null = null;
  if (st.netMarginTargetBp != null) {
    const mo = numv(pre.values.margem_operacional_necessaria), mc = numv(pre.values.margem_contrib_recomendada), pr = numv(pre.values.preco_margem_liquida_alvo);
    const fixas = st.overheadBp != null ? bp(st.overheadBp) : null, irA = st.incomeTaxBp != null ? bp(st.incomeTaxBp) : null;
    recommendation = {
      netTargetPct: bp(st.netMarginTargetBp) * 100, operatingNeededPct: mo == null ? null : mo * 100, contributionPct: mc == null ? null : mc * 100,
      priceCents: roundUp(pr), params: { overheadPct: fixas == null ? null : fixas * 100, glosaPct: glosa * 100, badDebtPct: badDebt * 100, incomeTaxPct: irA == null ? null : irA * 100 },
      feasible: pr != null,
    };
    if (mc == null) warnings.push('Margem líquida alvo informada, mas faltam despesas fixas ou IR/CSLL em Configurações → Viabilidade: sem margem de contribuição recomendada.');
    else if (pr == null) warnings.push(`A margem de contribuição recomendada (${(mc * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%) não cabe no markup com os tributos e despesas variáveis: a margem líquida alvo não é alcançável por preço.`);
  }
  if (st.overheadBp == null || st.incomeTaxBp == null) warnings.push('Despesas fixas e IR/CSLL não informados em Configurações → Viabilidade: margem operacional e líquida não calculadas.');
  if (st.inflationAnnualBp == null && rec && N > 12) warnings.push('Inflação anual não informada: a receita não é reajustada depois do 12º mês.');

  // 4. decisão (regras do modelo)
  const v = run?.values ?? {};
  const paybackOk = rec && kpi ? boolv(v.atende_payback) : null;
  const marginOk = kpi ? boolv(v.atende_margem) : null;
  const withinPolicy = kpi ? paybackOk !== false && marginOk === true : null;
  let verdict: EconVerdict;
  if (b <= 0 || bMk - m <= 0) verdict = 'inviavel';
  else if (!kpi || P == null) verdict = 'sem_preco';
  else if (!boolv(v.atende_preco_minimo)) verdict = 'abaixo_minimo';
  else if (paybackOk === false) verdict = 'fora_politica';
  else if (!marginOk) verdict = 'abaixo_recomendado';
  else verdict = 'viavel';
  const withReservations = pendingItems.length > 0 || !n;
  const checks = [
    { label: 'VPL positivo', ok: !!kpi && kpi.npvCents > 0 },
    { label: 'TIR acima da TMA', ok: boolv(v.tir_acima_tma) },
    { label: rec ? 'Payback descontado dentro do teto' : 'Preço cobre o investimento', ok: rec ? paybackOk === true : verdict !== 'abaixo_minimo' },
    { label: 'Margem no piso ou acima', ok: marginOk === true },
    { label: 'Preço no mínimo ou acima', ok: verdict !== 'abaixo_minimo' && verdict !== 'inviavel' && verdict !== 'sem_preco' },
    { label: 'Tributos de todos os produtos', ok: !withReservations },
    ...(priceSource === 'sugerido' ? [{ label: 'Preço definido na negociação', ok: false }] : []),
  ];
  const versions: Record<string, number> = {};
  for (const f of fm.formulas.values()) if (f.version !== 0) versions[f.code] = f.version ?? -1;

  const result: EconResult = {
    engineVersion: ENGINE_VERSION,
    mode: inp.mode, publicSector, revenueCents: revenue, priceCents: round(P), priceSource,
    rates: { a, c, g, m, r, b, glosa, badDebt, bMarkup: bMk, mMin, mMax, inflationMonthly: inflM, tmaAnnual: st.tmaAnnualBp != null ? bp(st.tmaAnnualBp) : null },
    fixedTaxCents: F, initialCents: Math.round(I), monthlyCostCents: Math.round(O),
    capexBaseCents: capexBase, capexContingencyCents: Math.round(capexCont), opexBaseCents: opexBase, opexContingencyCents: Math.round(opexCont),
    variableFixedCents: E, investmentCents: Math.round(Inv),
    term: { N, Dalvo, D, d, termMonths: inp.termMonths, horizon, paybackAsked: pbAsk }, items, lots: lotsOut,
    floor: { cashCents: roundUp(cash), economicCents: roundUp(eco), minCents: roundUp(minP) },
    marginPriceCents: roundUp(marginPrice), recommendedCents: roundUp(recP), markupPriceCents: roundUp(markupPrice), operatingFloorCents: roundUp(opFloor), suggestedMinCents: roundUp(suggested),
    suggestedCents: roundUp(sugP),
    kpi, cashflow: flows.map(Math.round), statement, recommendation,
    marginOk, paybackOk, verdict, withinPolicy, withReservations, warnings,
    autoApproval: { ok: boolv(v.aprovacao_automatica) && checks.every((x) => x.ok), checks },
    model: { key: fm.key, versions },
  };
  return { result, base: { ...base, preco: P }, run: run ?? pre, model: fm };
}

let DEFAULT_MODEL: FinModel | null = null;
/** Modelo padrão do sistema (as fórmulas do motor sem nenhuma alteração da diretoria). */
export const defaultModel = () => (DEFAULT_MODEL ??= buildModel());

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

/** Linha da DRE: month = 1º mês (meses 1..D na recorrente), after = 1º mês depois do payback (D+1..N), total = soma exata dos N meses; pct = % sobre a receita da mesma coluna. */
export type DreRow = { sign: '+' | '−' | '='; label: string; month: number | null; after?: number | null; total: number; strong?: boolean; tone?: boolean; note?: string; pct?: { month: number | null; after: number | null; total: number | null } };

/**
 * DRE da oportunidade: o que entra (+), o que sai (−) e os resultados (=). Na recorrente: mês do período de
 * amortização (1..D), mês depois do payback (D+1..N, amortização zero) e o contrato (soma exata dos N meses). Cada %
 * é sobre a receita da própria coluna, então o sinal do % acompanha o do valor.
 */
export function econDre(r: EconResult, fmt: (c: number) => string): DreRow[] {
  const s = r.statement;
  if (!s || !r.kpi || r.priceCents == null) return econDreV1(r, fmt);
  const rec = r.mode === 'recorrente';
  const pc = (v: number, d = 2) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`;
  const A = rec ? s.after ?? null : null;
  const M = (v: number | null) => (rec ? v : null);
  const pctOf = (v: number | null, rev: number | null | undefined) => (v == null || rev == null || rev <= 0 ? null : (v / rev) * 100);
  const pct = (f: keyof EconStatement) => ({ month: rec ? pctOf(s.month[f], s.month.revenue) : null, after: A ? pctOf(A[f], A.revenue) : null, total: pctOf(s.total[f], s.total.revenue) });
  const row = (sign: DreRow['sign'], label: string, f: keyof EconStatement, extra: Partial<DreRow> = {}): DreRow => {
    const neg = sign === '−' ? -1 : 1;
    const val = (x: number | null) => (x == null ? null : neg * x || 0);
    return { sign, label, month: M(val(s.month[f])), after: A ? val(A[f]) : null, total: val(s.total[f]) ?? 0, ...(sign === '=' ? { pct: pct(f) } : {}), ...extra };
  };
  const D = r.term.D;
  const opexNote = r.opexContingencyCents > 0 ? `inclui contingência de ${fmt(r.opexContingencyCents)}/mês` : undefined;
  const rows: DreRow[] = [
    row('+', 'Receita bruta', 'revenue', { note: rec && r.rates.inflationMonthly ? 'reajuste após o 12º mês' : undefined }),
    row('−', `Tributos (${pc(r.rates.a * 100)}${r.fixedTaxCents ? ` + ${fmt(r.fixedTaxCents)}` : ''})`, 'tax'),
    ...(s.total.commission ? [row('−', `Despesas variáveis (${pc(r.rates.c * 100)})`, 'commission')] : []),
    ...(rec && s.total.opex ? [row('−', 'Custos operacionais', 'opex', { note: opexNote })] : []),
    ...((r.investmentCents ?? 0) > 0 ? [row('−', rec ? `Amortização do investimento (${fmt(r.investmentCents!)} pela TMA em ${D} ${D === 1 ? 'mês' : 'meses'})` : 'Investimento e despesas de entrega', 'amortization', rec ? { note: s.afterFrom ? `parcela da anuidade nos meses 1–${D}; zero a partir do mês ${s.afterFrom}` : `parcela da anuidade nos meses 1–${D}` } : {})] : []),
    row('=', 'Margem de contribuição', 'contribution', { strong: true }),
    ...(s.total.risk ? [row('−', `Glosa e inadimplência (${pc(r.rates.g * 100)})`, 'risk')] : []),
  ];
  if (s.month.operating != null && s.total.operating != null) {
    rows.push(row('−', 'Despesas fixas rateadas', 'overhead'), row('=', 'Margem operacional', 'operating', { strong: true }));
    if (s.month.incomeTax != null && s.total.incomeTax != null && s.total.net != null) rows.push(
      row('−', 'IR/CSLL', 'incomeTax', { note: 'sobre a margem operacional positiva' }),
      row('=', 'Margem líquida', 'net', { strong: true, tone: true, note: s.total.net >= 0 ? 'lucro' : 'prejuízo' }),
    );
  } else {
    const res = s.total.contribution - s.total.risk;
    rows.push({ sign: '=', label: rec ? 'Resultado do contrato' : 'Resultado da venda', month: null, after: null, total: res, strong: true, tone: true, pct: { month: null, after: null, total: pctOf(res, s.total.revenue) }, note: `${res >= 0 ? 'lucro' : 'prejuízo'} · sem despesas fixas e IR/CSLL (não informados)` });
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
  const dec = rs.decision;
  // cálculos salvos antes da versão 3.0 não têm sugerido × proposto: só o veredito
  if (!dec) return `${ECON_VERDICT_LABELS[rs.verdict]}. Cálculo da versão ${rs.engineVersion}: salve de novo para ver no modelo atual.`;
  if (rs.verdict === 'inviavel' && !rs.kpi) return 'Tributos, despesas variáveis e margem somam 100% ou mais: nenhum preço fecha a conta. Revise a margem ou os documentos fiscais.';
  const k = rs.kpi;
  const sug = rs.suggestedCents ?? rs.priceCents;
  const one = rs.suggestedOneTimeCents;
  const m = (rs.rates.m * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const pbv = (v: number | null | undefined) => (v == null ? 'não se paga na projeção' : v === 0 ? 'sem investimento a recuperar' : `o investimento volta em ${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`);
  const a = `No preço sugerido de ${fmt(sug)}${per}${one != null ? ` + ${fmt(one)} de pagamento único` : ''} (margem ${m}%)${k ? `, ${pbv(k.paybackMonths)} e o ganho no contrato (VPL) é ${fmt(k.npvCents)}` : ''}.`;
  const b = dec.basis === 'proposto'
    ? ` Decisão no preço proposto de ${fmt(dec.priceCents)}${per}${dec.oneTimeCents != null ? ` + ${fmt(dec.oneTimeCents)} único` : ''}${dec.source === 'itens' ? ' (total dos produtos)' : ''}: ${ECON_VERDICT_LABELS[dec.verdict]}${dec.marginPct != null ? `, margem ${dec.marginPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : ''}.`
    : ` Sem preço proposto: a decisão usa o sugerido (${ECON_VERDICT_LABELS[dec.verdict]}).`;
  return a + b;
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
  const taxParts = r.lots?.length ? r.lots.map((l) => `${ECON_LOT_LABELS[l.lot]} ${pc(l.weight * 100, 1)} × ${pc(l.percentBp / 100)}${l.doc ? ` (${l.doc})` : ''}`).join(' + ') : r.items.slice(0, 4).map((i) => `${pc(i.weight * 100, 1)} × ${pc(i.percentBp / 100)}`).join(' + ') + (r.items.length > 4 ? ' + …' : '');
  steps.push({
    key: 'entradas', title: 'Entradas', desc: 'Planilha de custos classificada (frequência e impacto), tributos do documento fiscal e parâmetros da Direção.',
    rows: [
      { label: 'Investimento inicial (I)', formula: r.capexContingencyCents ? `${money(r.capexBaseCents)} + contingência ${money(r.capexContingencyCents)}` : 'materiais, equipamentos e serviços de valor único', value: money(I), strong: true },
      ...(E ? [{ label: 'Despesas variáveis em R$ (E)', formula: 'despesa de entrega e taxa fixa de venda, sem contingência', value: money(E) }] : []),
      ...(rec ? [{ label: 'Custos mensais (O)', formula: r.opexContingencyCents ? `${money(r.opexBaseCents)} + contingência ${money(r.opexContingencyCents)}` : 'custos operacionais recorrentes', value: money(O), strong: true }] : []),
      { label: 'Tributos sobre o preço (a)', formula: r.items.length ? `maior documento de cada lote, pelo peso na receita: ${taxParts}` : 'sem produtos', value: pc(a * 100) },
      ...(r.fiscal ? [
        { label: `Envelope fiscal ${r.fiscal.year} (${r.fiscal.regime === 'reforma' ? 'Reforma Tributária' : 'regime atual'})`, formula: r.fiscal.envelope ? `município IBGE ${r.fiscal.ibgeCode}${r.fiscal.envelope.municipality ? ` (${r.fiscal.envelope.municipality})` : ''} · chave ${r.fiscal.envelope.year} · ${r.fiscal.basket.map((b) => `${b.kind}: ${b.parts.map((x) => `${x.label} ${pc(x.bp / 100)}`).join(' + ')}`).join(' · ')}` : 'sem envelope para a chave: tributos dos documentos fiscais', value: r.fiscal.envelope ? 'na carga da nota' : '—' },
        { label: 'Alíquota efetiva sobre o lucro (IRPJ/CSLL)', formula: r.fiscal.profitTaxSource === 'envelope' ? `envelope ${r.fiscal.envelope?.year}` : 'parâmetros de viabilidade', value: r.fiscal.profitTaxBp == null ? '—' : pc(r.fiscal.profitTaxBp / 100) },
        ...(r.fiscal.retentions.length ? [{ label: 'Retenções na fonte (fora do cálculo)', formula: `${r.fiscal.retentions.map((x) => `${x.label} ${pc(x.bp / 100)}`).join(' + ')}: contas a receber e compensação, não entram no preço nem na DRE`, value: '—' }] : []),
      ] : []),
      ...(F ? [{ label: 'Tributo fixo por fatura (F)', value: money(F) }] : []),
      { label: 'Despesas variáveis (dv)', formula: 'sobre o preço; sem comissão', value: pc(c * 100) },
      { label: `Glosa, setor ${r.publicSector ? 'público' : 'privado'}`, formula: 'só no fluxo de caixa, fora do preço', value: pc(glosa * 100) },
      { label: 'Inadimplência', formula: 'só no fluxo de caixa, fora do preço', value: pc(bad * 100) },
      { label: 'Margem de contribuição (m)', formula: `escolhida entre o piso ${pc(mMin * 100)}${r.rates.mMax != null ? ` e o teto ${pc(r.rates.mMax * 100)}` : ''}`, value: pc(m * 100) },
      { label: 'TMA (k)', formula: r.rates.tmaAnnual != null ? `(1 + ${pc(r.rates.tmaAnnual * 100)})^(1/12) - 1` : 'mensal informada', value: `${pc(rt * 100, 3)} a.m.` },
      ...(rec && r.rates.inflationMonthly ? [{ label: 'Reajuste (inflação)', formula: `${pc(((1 + r.rates.inflationMonthly) ** 12 - 1) * 100)} ao ano, aplicado a partir do 13º mês`, value: `${pc(r.rates.inflationMonthly * 100, 3)} a.m.` }] : []),
      rec ? { label: 'Prazos', formula: `vigência ${r.term.termMonths ?? N} meses${r.term.horizon != null ? `, prazo máximo de previsão ${r.term.horizon}` : ''} · payback ${r.term.paybackAsked ?? 'no teto'} (teto ${Dalvo})`, value: `N = ${N} · D = ${D}` }
        : { label: 'Recebimento', value: d ? `mês ${d}` : 'à vista' },
    ],
  });
  // 3.1: o investimento entra pela parcela da anuidade da TMA no payback; cálculos salvos antes usam (I + E) ÷ D
  const annuity = !/^FINANCE-(1|2|3\.0)/.test(r.engineVersion ?? '') && !!r.statement && 'afterFrom' in r.statement;
  const parc = rec ? (annuity ? (Inv > 0 && D > 0 ? Inv / annuityFactor(rt, D) : 0) : Inv / Math.max(1, D)) : 0;
  const factor = rec && D > 0 ? (rt === 0 ? 1 / D : (rt * (1 + rt) ** D) / ((1 + rt) ** D - 1)) : 0;
  const costTxt = rec ? `P_inv + O + F = ${money(Math.round(parc))} + ${money(O)} + ${money(F)}` : `I + E + F = ${money(Inv)} + ${money(F)}`;
  const prices: MemoryRow[] = [
    ...(rec && annuity ? [{ label: 'Parcela do investimento (P_inv)', formula: `I × [k(1+k)^D ÷ ((1+k)^D - 1)] = ${money(Inv)} × [${pc(rt * 100, 3)} × (1+${pc(rt * 100, 3)})^${D} ÷ ((1+${pc(rt * 100, 3)})^${D} - 1)] = ${money(Inv)} × ${num(factor, 6)}`, value: `${money(Math.round(parc))}/mês nos meses 1–${D}`, strong: true }] : []),
    ...(rec ? [{ label: 'Custo mensal consolidado (C)', formula: annuity ? `parcela do investimento + custo mensal protegido O = ${money(Math.round(parc))} + ${money(O)}` : `investimento amortizado (I + E) ÷ payback + custo mensal protegido O = ${money(Inv)} ÷ ${D} + ${money(O)}`, value: money(Math.round(parc) + O) }] : []),
    { label: 'Divisor do markup (D)', formula: `1 - (tributos da cesta + despesas variáveis + margem) = 1 - (${pc(a * 100)} + ${pc(c * 100)} + ${pc(m * 100)})`, value: pc((bMk - m) * 100) },
    { label: 'Preço sugerido', formula: `(${costTxt}) ÷ D`, value: `${money(r.suggestedCents ?? r.markupPriceCents)}${rec ? '/mês' : ''}`, strong: true },
    { label: 'Preço mínimo (margem no piso)', formula: `mesmo numerador ÷ (1 - ${pc(a * 100)} - ${pc(c * 100)} - ${pc(mMin * 100)})`, value: money(r.suggestedMinCents ?? r.marginPriceCents) },
    ...(r.decision?.basis === 'proposto' ? [{ label: 'Preço proposto (base da aprovação)', formula: r.decision.source === 'itens' ? 'total dos produtos' : 'informado na negociação', value: `${money(r.decision.priceCents)}${rec ? '/mês' : ''}`, strong: true }] : []),
  ];
  void b;
  const rc = r.recommendation;
  if (rc) prices.push(
    { label: 'Margem operacional necessária', formula: `margem líquida alvo ÷ (1 - IR/CSLL) = ${pc(rc.netTargetPct)} ÷ (1 - ${rc.params.incomeTaxPct == null ? '—' : pc(rc.params.incomeTaxPct)})`, value: rc.operatingNeededPct == null ? '—' : pc(rc.operatingNeededPct) },
    { label: 'Margem de contribuição recomendada', formula: `MO + despesas fixas + glosa + inadimplência = ${rc.operatingNeededPct == null ? '—' : pc(rc.operatingNeededPct)} + ${rc.params.overheadPct == null ? '—' : pc(rc.params.overheadPct)} + ${pc(rc.params.glosaPct)} + ${pc(rc.params.badDebtPct)}`, value: rc.contributionPct == null ? '—' : pc(rc.contributionPct), strong: true },
    { label: 'Preço com a margem recomendada', formula: rc.contributionPct == null ? 'sem margem recomendada' : `(${costTxt}) ÷ (1 - ${pc(a * 100)} - ${pc(c * 100)} - ${pc(rc.contributionPct)})`, value: rc.priceCents == null ? 'a margem não cabe no divisor' : `${money(rc.priceCents)}${rec ? '/mês' : ''}`, ok: rc.feasible },
  );
  const pbNote = rec && annuity && k ? `Payback do investimento na precificação = ${D} ${D === 1 ? 'mês' : 'meses'} (a parcela pela TMA devolve I com juros em exatamente D meses). O payback de caixa (${k.paybackMonths == null ? 'não se paga' : `${num(k.paybackMonths, 1)} meses`}) sai menor porque a margem de contribuição também entra no caixa; ele só é igual a D com margem zero.` : undefined;
  steps.push({ key: 'preco', title: `Precificação (markup divisor, ${annuity ? 'FINANCE-3.1' : 'FINANCE-3.0'})`, desc: 'Custos em R$ no numerador; no divisor só o que sai da nota: tributos da cesta, despesas variáveis e margem. Glosa, inadimplência e despesas fixas ficam fora do preço e entram no fluxo de caixa e nas margens operacional e líquida.', rows: prices, note: pbNote });

  const fx = (rec ? opts.legacy?.recurringX100 : opts.legacy?.oneTimeX100) ?? null;
  const cmp = fx ? econCompare(r, opts.legacy ?? {}) : null;
  if (cmp && cmp.baseCents > 0 && cmp.legacy.priceCents != null) {
    const f = cmp.legacy.factor!, Pl = cmp.legacy.priceCents, sb = cmp.legacy.grossMarginPct!, ml = cmp.legacy.effectiveMarginPct!;
    steps.push({
      key: 'historico', title: 'Comparativo com o modelo antigo', desc: `Regra antiga: ${cmp.baseLabel} × ${num(f)}. Só informativo; não entra na decisão.`,
      rows: [
        { label: 'Preço pelo modelo antigo', formula: `${money(cmp.baseCents)} × ${num(f)}`, value: `${money(Pl)}${rec ? '/mês' : ''}`, strong: true },
        { label: 'Margem bruta', formula: `1 - 1 ÷ ${num(f)}`, value: pc(sb) },
        { label: 'Margem efetiva', formula: `bruta - tributos - despesas variáveis = ${pc(sb)} - ${pc(a * 100)} - ${pc(c * 100)}`, value: pc(ml), ok: ml >= mMin * 100 - 1e-9 },
        ...(cmp.differenceCents != null ? [{ label: 'Diferença para o sugerido', formula: 'antigo - sugerido', value: money(cmp.differenceCents) }] : []),
      ],
      note: `No modelo antigo (×${num(f)}) o preço seria ${money(Pl)}, com margem efetiva de ${pc(ml)}. Para a margem de ${pc(m * 100)}, o preço sugerido é ${money(r.suggestedCents ?? r.markupPriceCents)}.`,
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
  const taxParts = r.lots?.length ? r.lots.map((l) => `${ECON_LOT_LABELS[l.lot]} ${pc(l.weight * 100, 1)} × ${pc(l.percentBp / 100)}${l.doc ? ` (${l.doc})` : ''}`).join(' + ') : r.items.slice(0, 4).map((i) => `${pc(i.weight * 100, 1)} × ${pc(i.percentBp / 100)}`).join(' + ') + (r.items.length > 4 ? ' + …' : '');
  steps.push({
    key: 'entradas', title: 'Entradas', desc: 'Custos da oportunidade, tributos dos documentos fiscais e parâmetros vigentes do motor.',
    rows: [
      { label: 'Investimento inicial (I)', formula: r.capexContingencyCents ? `${money(capexBase)} + contingência ${money(r.capexContingencyCents)}` : undefined, value: money(I), strong: true },
      ...(rec ? [{ label: 'Custos mensais (O)', formula: r.opexContingencyCents ? `${money(opexBase)} + contingência ${money(r.opexContingencyCents)}` : undefined, value: money(O), strong: true }] : []),
      { label: 'Tributos sobre o preço (a)', formula: r.items.length ? `maior documento de cada lote, pelo peso na receita: ${taxParts}` : 'sem produtos', value: pc(a * 100) },
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
  prices.push({ label: 'Preço avaliado (P)', formula: r.priceSource === 'informado' ? 'informado na negociação' : r.priceSource === 'sugerido' ? 'produtos sem preço: mínimo sugerido' : 'total dos produtos', value: `${money(r.priceCents)}${rec ? '/mês' : ''}`, strong: true });
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

// ------------------------------------------------------------------ comparativo com o modelo antigo (só informativo)
/** Fatores do modelo antigo (Configurações → Viabilidade); sem valor lá, os da regra da empresa: mensal ×3,2 e único ×2,5. */
export const LEGACY_FACTORS = { recurringX100: 320, oneTimeX100: 250 } as const;
export type EconCompareSide = { priceCents: number | null; markupPct: number | null; grossMarginPct: number | null; effectiveMarginPct: number | null; factor: number | null };
/**
 * Preço sugerido do motor × modelo antigo, sobre a mesma base de custo (sem tributos):
 * recorrente = amortização do investimento no payback + custo mensal protegido; pagamento único = investimento + despesas.
 *   markup efetivo = (preço − base) ÷ base
 *   margem bruta = 1 − base ÷ preço  (= 1 − 1 ÷ fator)
 *   margem efetiva = margem bruta − tributos % − despesas variáveis % (comissão)
 * Modelo antigo: preço = base × fator (mensal ×3,2 · único ×2,5); não entra na decisão.
 */
export function econCompare(r: EconResult, legacy: { recurringX100?: number | null; oneTimeX100?: number | null } = {}) {
  const rec = r.mode === 'recorrente';
  // custo sem tributos: único = investimento com contingência + despesas em R$; mensal = amortização no payback + custo mensal protegido
  const base = rec ? Math.round((r.investmentCents ?? r.initialCents) / Math.max(1, r.term.D) + r.monthlyCostCents) : r.investmentCents ?? r.initialCents;
  const fx = (rec ? legacy.recurringX100 ?? LEGACY_FACTORS.recurringX100 : legacy.oneTimeX100 ?? LEGACY_FACTORS.oneTimeX100) / 100;
  const ded = (r.rates.a + r.rates.c) * 100;
  const side = (P: number | null): EconCompareSide => {
    if (P == null || P <= 0 || base <= 0) return { priceCents: P, markupPct: null, grossMarginPct: null, effectiveMarginPct: null, factor: null };
    const gross = (1 - base / P) * 100;
    return { priceCents: P, markupPct: ((P - base) / base) * 100, grossMarginPct: gross, effectiveMarginPct: gross - ded, factor: P / base };
  };
  const sugg = r.suggestedCents ?? r.suggestedMinCents ?? null;
  return {
    mode: r.mode, baseCents: base, baseLabel: rec ? 'custo mensal consolidado (amortização + custos mensais)' : 'custo do pagamento único (investimento + despesas)', taxesPct: r.rates.a * 100, variablePct: r.rates.c * 100,
    engine: side(sugg),
    evaluated: side(r.priceCents),
    legacy: base > 0 ? { ...side(Math.round(base * fx)), factor: fx } : { priceCents: null, markupPct: null, grossMarginPct: null, effectiveMarginPct: null, factor: fx },
    differenceCents: base > 0 && sugg != null ? Math.round(base * fx) - sugg : null,
  };
}
export type EconCompare = ReturnType<typeof econCompare>;
