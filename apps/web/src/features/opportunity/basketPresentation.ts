import { costLineTotal, defaultCostProfile, isVariableFixed, type CostLine, type EconBasketView, type EconInput, type EconSettings, type EconStatement } from '@isp/domain';

export const BASKET_LABELS = { fornecimento: 'Venda', instalacao: 'Instalação', implantacao: 'Recorrência' } as const;
export const basketName = (view: EconBasketView) => view.profile === 'implantacao' ? view.kinds.includes('locacao') ? view.kinds.includes('recorrencia') ? 'Recorrência / Aluguel' : 'Aluguel' : 'Recorrência' : BASKET_LABELS[view.profile];
export const CATEGORY_LABELS = { materia_prima: 'Matéria-prima', mao_de_obra: 'Mão de obra', parceiros: 'Parceiros', despesas_operacionais: 'Despesas operacionais', inferencia: 'Inferência custo de serviço' };
export type Category = keyof typeof CATEGORY_LABELS;
export type BasketForm = { margin: string; payback: string; price: string };
export const rateText = (n: number | null | undefined) => n == null ? '' : (n / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
export function parseRate(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n * 100) : NaN;
}
const categoryOf = (c: CostLine): Category => c.category ?? (c.impact === 'material' ? 'materia_prima' : c.impact === 'servico' ? 'mao_de_obra' : 'despesas_operacionais');

/** Distribuição visual dos totais já calculados. Não resolve preços e não desconta o investimento duas vezes. */
export function categoryCosts(view: EconBasketView, input: EconInput, settings: EconSettings): Record<Category, number> {
  const e = view.evaluation, monthly = e.mode === 'recorrente';
  const source = view.costInput;
  const lines = (monthly ? source.opex : source.capex).filter((c) => !c.kind || defaultCostProfile(c.kind) === view.profile);
  const weights: Record<Category, number> = { materia_prima: 0, mao_de_obra: 0, parceiros: 0, despesas_operacionais: 0, inferencia: 0 };
  for (const c of lines) {
    const base = costLineTotal(c);
    const protectedCost = monthly ? base * (1 + settings.contingencyOpexBp / 10000)
      : isVariableFixed(c.impact) ? base : base * (1 + settings.contingencyCapexBp / 10000 + (view.profile === 'fornecimento' ? 0 : (settings.serviceCostBp ?? 3500) / 10000));
    weights[categoryOf(c)] += protectedCost;
  }
  if (monthly) weights.inferencia = e.serviceMonthlyCents ?? 0;
  else weights.despesas_operacionais += Math.max(0, source.extraInitialCents);
  const total = monthly ? e.statement?.total.opex ?? 0 : e.statement?.total.amortization ?? 0;
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (!sum) { weights.despesas_operacionais = total; return weights; }
  const keys = (Object.keys(weights) as Category[]).filter((k) => weights[k] > 0);
  let rest = total;
  for (const [i, key] of keys.entries()) { const value = i === keys.length - 1 ? rest : Math.round(total * weights[key] / sum); weights[key] = value; rest -= value; }
  return weights;
}
export const zeroStatement = (): EconStatement => ({ revenue: 0, tax: 0, commission: 0, opex: 0, amortization: 0, contribution: 0, risk: 0, overhead: 0, operating: 0, incomeTax: 0, net: 0 });
export function businessStatement(views: EconBasketView[]): EconStatement {
  const total = zeroStatement();
  for (const v of views) for (const key of Object.keys(total) as (keyof EconStatement)[]) total[key] = (total[key] ?? 0) + (v.evaluation.statement?.total[key] ?? 0);
  return total;
}
export function businessCash(views: EconBasketView[]) {
  const length = Math.max(1, ...views.map((v) => v.evaluation.cashflow.length));
  const revenue = Array<number>(length).fill(0), cash = Array<number>(length).fill(0);
  for (const { evaluation: e } of views) {
    e.cashflow.forEach((value, k) => cash[k]! += value);
    if (e.mode === 'recorrente') for (let k = 1; k < length && k <= e.term.N; k++) revenue[k]! += Math.round((e.priceCents ?? 0) * (1 + (e.rates.inflationMonthly ?? 0)) ** Math.max(0, k - 12));
    else if (e.term.d < length) revenue[e.term.d]! += e.statement?.total.revenue ?? 0;
  }
  let r = 0, c = 0;
  return { cashflow: cash, categories: revenue.map((_, k) => k ? 'M' + k : 'Início'), revenue: revenue.map((value) => r += value), cash: cash.map((value) => c += value), deductions: revenue.map((_, k) => 0).map((_, k) => revenue.slice(0, k + 1).reduce((a, b) => a + b, 0) - cash.slice(0, k + 1).reduce((a, b) => a + b, 0)) };
}
