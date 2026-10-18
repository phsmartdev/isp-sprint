/**
 * Viabilidade da venda: caminho de entrega, custos, comissão, CAC, margem, payback e LTV.
 * Funções puras; todos os valores em centavos inteiros e percentuais em pontos-base (1% = 100).
 *
 *   margem mensal = mensalidade − tributos − parceiros − custo mensal do caminho
 *   CAC           = comissão + cabo + instalação + equipamentos − taxa de ativação (mínimo 0)
 *   payback       = CAC ÷ margem mensal (meses); sem margem positiva, não se paga
 *   LTV           = margem mensal × vida média do cliente (meses)
 */

export type AmountRule = { id: string; name: string; kind: 'percent' | 'fixed'; percentBp: number; amountCents: number; active: boolean; routeIds?: string[] };
export type Equipment = { id: string; name: string; costCents: number; active: boolean };
export type KitItem = { equipmentId: string; qty: number };
export type DeliveryRoute = { id: string; name: string; cablePerMeterCents: number; installCostCents: number; monthlyCostCents: number; requiresApproval: boolean; kit: KitItem[]; active: boolean };
export type RouteRule = { id: string; name: string; position: number; minMeters: number | null; maxMeters: number | null; minMbps: number | null; maxMbps: number | null; routeId: string; active: boolean };
export const SALE_TYPES = ['ativa', 'receptiva'] as const;
export type SaleType = (typeof SALE_TYPES)[number];
export const SALE_TYPE_LABELS: Record<SaleType, string> = { ativa: 'Ativa', receptiva: 'Receptiva' };
export const COMMISSION_KINDS = ['percent', 'mensalidades', 'fixo'] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];
export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = { percent: '% da mensalidade', mensalidades: 'Nº de mensalidades', fixo: 'Valor fixo' };
export type CommissionRule = {
  id: string; name: string; position: number; saleType: SaleType | 'qualquer';
  minPriceCents: number | null; maxPriceCents: number | null;
  kind: CommissionKind; percentBp: number; multiplierX100: number; amountCents: number; active: boolean;
};
export type LtvSettings = { lifetimeMonths: number | null; monthlyChurnBp: number | null; minSample: number };
export type HistoricalBase = { customers: number; avgLifetimeMonths: number | null; avgMarginCents: number | null };

export type ViabilityParams = {
  taxes: AmountRule[];
  partners: AmountRule[];
  equipments: Equipment[];
  routes: DeliveryRoute[];
  rules: RouteRule[];
  defaultRouteId: string | null;
  commissionRules: CommissionRule[];
  ltv: LtvSettings;
  maxPaybackMonths: number | null;
};

/** Produto que compõe o plano: valor unitário e comissão por venda ativa e receptiva. */
export type ProductCommission = { kind: 'percent' | 'fixo'; value: number };
export type PlanProduct = { name: string; qty: number; unitPriceCents: number; commissionAtiva: ProductCommission | null; commissionReceptiva: ProductCommission | null };
export const productsTotal = (items: PlanProduct[]) => items.reduce((a, i) => a + i.unitPriceCents * i.qty, 0);

/** Comissão pelos produtos do plano; null quando nenhum produto define comissão para o tipo de venda. */
export function productsCommission(items: PlanProduct[] | null | undefined, saleType: SaleType | null) {
  if (!items?.length || !saleType) return null;
  const lines: Line[] = [];
  for (const i of items) {
    const c = saleType === 'ativa' ? i.commissionAtiva : i.commissionReceptiva;
    if (!c) continue;
    const cents = c.kind === 'percent' ? pct(i.unitPriceCents * i.qty, c.value) : c.value * i.qty;
    lines.push({ label: i.name, cents, detail: c.kind === 'percent' ? `${fmtBp(c.value)} de ${i.qty} × ${(i.unitPriceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : `${i.qty} × ${(c.value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` });
  }
  if (!lines.length) return null;
  return { cents: lines.reduce((a, l) => a + l.cents, 0), lines };
}

export type ViabilityInput = {
  priceCents: number | null;
  mbps: number | null;
  cableMeters: number | null;
  activationFeeCents: number | null;
  saleType: SaleType | null;
  /** Equipamentos escolhidos; null usa o kit do caminho. */
  equipment: KitItem[] | null;
  /** Caminho escolhido à mão; null usa a regra. */
  routeId: string | null;
  /** Produtos do plano; com comissão definida, substituem as regras gerais de comissão. */
  products?: PlanProduct[] | null;
};

export type Line = { label: string; cents: number; detail?: string };
export type ViabilityResult = {
  complete: boolean;
  missing: string[];
  route: { id: string; name: string; byRule: string | null; requiresApproval: boolean } | null;
  revenue: { monthlyCents: number; activationFeeCents: number };
  monthlyDeductions: Line[];
  oneTimeCosts: Line[];
  commission: { cents: number; rule: string | null; detail: string | null; lines?: Line[] };
  marginMonthlyCents: number;
  cacCents: number;
  paybackMonths: number | null;
  ltv: { months: number | null; source: 'base' | 'parametro' | null; sample: number; dealCents: number | null; historicalCents: number | null; ratio: number | null };
  alerts: string[];
};

const pct = (cents: number, bp: number) => Math.round((cents * bp) / 10_000);
const inRange = (v: number | null, min: number | null, max: number | null) => {
  if (min === null && max === null) return true;
  if (v === null) return false;
  return (min === null || v >= min) && (max === null || v <= max);
};
export const fmtBp = (bp: number) => `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** Primeira regra ativa (pela ordem) que casa metragem e banda; senão o caminho padrão. */
export function pickRoute(p: Pick<ViabilityParams, 'rules' | 'routes' | 'defaultRouteId'>, meters: number | null, mbps: number | null) {
  const rule = [...p.rules].filter((r) => r.active).sort((a, b) => a.position - b.position).find((r) => inRange(meters, r.minMeters, r.maxMeters) && inRange(mbps, r.minMbps, r.maxMbps));
  const route = p.routes.find((x) => x.active && x.id === (rule?.routeId ?? p.defaultRouteId)) ?? null;
  return { route, rule: route && rule ? rule : null };
}

export function pickCommission(rules: CommissionRule[], saleType: SaleType | null, priceCents: number | null) {
  return [...rules]
    .filter((r) => r.active)
    .sort((a, b) => a.position - b.position)
    .find((r) => (r.saleType === 'qualquer' || r.saleType === saleType) && inRange(priceCents, r.minPriceCents, r.maxPriceCents)) ?? null;
}

export function commissionFor(rule: CommissionRule | null, priceCents: number) {
  if (!rule) return { cents: 0, detail: null };
  if (rule.kind === 'percent') return { cents: pct(priceCents, rule.percentBp), detail: `${fmtBp(rule.percentBp)} da mensalidade` };
  if (rule.kind === 'mensalidades') return { cents: Math.round((priceCents * rule.multiplierX100) / 100), detail: `${(rule.multiplierX100 / 100).toLocaleString('pt-BR')} mensalidade(s)` };
  return { cents: rule.amountCents, detail: 'valor fixo' };
}

/** Vida média do cliente: a base do CRM quando a amostra é suficiente; senão o parâmetro (direto ou 1 ÷ churn). */
export function lifetime(ltv: LtvSettings, base: HistoricalBase | null) {
  if (base && base.customers >= ltv.minSample && base.avgLifetimeMonths && base.avgLifetimeMonths > 0) return { months: base.avgLifetimeMonths, source: 'base' as const, sample: base.customers };
  if (ltv.lifetimeMonths && ltv.lifetimeMonths > 0) return { months: ltv.lifetimeMonths, source: 'parametro' as const, sample: base?.customers ?? 0 };
  if (ltv.monthlyChurnBp && ltv.monthlyChurnBp > 0) return { months: Math.round((10_000 / ltv.monthlyChurnBp) * 10) / 10, source: 'parametro' as const, sample: base?.customers ?? 0 };
  return { months: null, source: null, sample: base?.customers ?? 0 };
}

export function computeViability(input: ViabilityInput, p: ViabilityParams, base: HistoricalBase | null = null): ViabilityResult {
  const missing: string[] = [];
  if (input.priceCents === null) missing.push('plano (mensalidade)');
  if (input.cableMeters === null) missing.push('metragem de cabo');
  if (!input.saleType) missing.push('tipo de venda (ativa ou receptiva)');
  const price = input.priceCents ?? 0;
  const meters = input.cableMeters ?? 0;
  const alerts: string[] = [];

  const picked = input.routeId ? { route: p.routes.find((r) => r.id === input.routeId && r.active) ?? null, rule: null } : pickRoute(p, input.cableMeters, input.mbps);
  const route = picked.route;
  if (!route) alerts.push('Nenhum caminho de entrega cadastrado para esta metragem e banda. Cadastre em Configurações → Viabilidade.');
  if (route?.requiresApproval) alerts.push(`O caminho “${route.name}” exige aprovação antes de fechar.`);

  const applies = (r: AmountRule) => r.active && (!r.routeIds?.length || (route && r.routeIds.includes(route.id)));
  const ruleLine = (r: AmountRule): Line => ({ label: r.name, cents: r.kind === 'percent' ? pct(price, r.percentBp) : r.amountCents, detail: r.kind === 'percent' ? fmtBp(r.percentBp) : 'valor fixo' });
  const monthlyDeductions: Line[] = [
    ...p.taxes.filter(applies).map((r) => ({ ...ruleLine(r), label: `Tributo · ${r.name}` })),
    ...p.partners.filter(applies).map((r) => ({ ...ruleLine(r), label: `Parceiro · ${r.name}` })),
  ];
  if (route && route.monthlyCostCents) monthlyDeductions.push({ label: `Custo mensal · ${route.name}`, cents: route.monthlyCostCents });

  const kit = input.equipment ?? route?.kit ?? [];
  const equipmentLines: Line[] = kit
    .filter((k) => k.qty > 0)
    .map((k) => {
      const e = p.equipments.find((x) => x.id === k.equipmentId);
      return { label: `Equipamento · ${e?.name ?? 'removido do cadastro'}`, cents: (e?.costCents ?? 0) * k.qty, detail: `${k.qty} × ${((e?.costCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` };
    });
  const oneTimeCosts: Line[] = [];
  if (route) {
    oneTimeCosts.push({ label: 'Cabo lançado', cents: meters * route.cablePerMeterCents, detail: `${meters} m × ${(route.cablePerMeterCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/m` });
    if (route.installCostCents) oneTimeCosts.push({ label: 'Instalação / mão de obra', cents: route.installCostCents });
  }
  oneTimeCosts.push(...equipmentLines);

  const byProducts = productsCommission(input.products, input.saleType);
  const cRule = byProducts ? null : pickCommission(p.commissionRules, input.saleType, input.priceCents);
  const comm = byProducts ? { cents: byProducts.cents, detail: `${byProducts.lines.length} produto(s) do plano` } : commissionFor(cRule, price);
  if (input.saleType && input.priceCents !== null && !cRule && !byProducts) alerts.push('Nenhuma regra de comissão cobre este tipo de venda e valor.');

  const marginMonthlyCents = price - monthlyDeductions.reduce((a, l) => a + l.cents, 0);
  const activation = input.activationFeeCents ?? 0;
  const cacCents = Math.max(0, comm.cents + oneTimeCosts.reduce((a, l) => a + l.cents, 0) - activation);
  const paybackMonths = marginMonthlyCents > 0 ? Math.round((cacCents / marginMonthlyCents) * 10) / 10 : null;
  if (marginMonthlyCents <= 0 && input.priceCents !== null) alerts.push('A margem mensal é zero ou negativa: a venda não se paga com estes parâmetros.');
  if (paybackMonths !== null && p.maxPaybackMonths && paybackMonths > p.maxPaybackMonths) alerts.push(`Payback de ${paybackMonths} meses acima do limite de ${p.maxPaybackMonths} meses.`);

  const life = lifetime(p.ltv, base);
  const dealLtv = life.months !== null ? Math.round(marginMonthlyCents * life.months) : null;
  const historicalLtv = life.months !== null && base?.avgMarginCents !== null && base?.avgMarginCents !== undefined ? Math.round(base.avgMarginCents * life.months) : null;
  const ratio = dealLtv !== null && cacCents > 0 ? Math.round((dealLtv / cacCents) * 10) / 10 : null;
  if (ratio !== null && ratio < 3) alerts.push(`LTV/CAC de ${ratio.toLocaleString('pt-BR')}: abaixo de 3, a venda devolve pouco do que custa.`);

  return {
    complete: missing.length === 0 && !!route,
    missing,
    route: route ? { id: route.id, name: route.name, byRule: picked.rule?.name ?? null, requiresApproval: route.requiresApproval } : null,
    revenue: { monthlyCents: price, activationFeeCents: activation },
    monthlyDeductions,
    oneTimeCosts,
    commission: { cents: comm.cents, rule: byProducts ? 'Produtos do plano' : cRule?.name ?? null, detail: comm.detail, ...(byProducts ? { lines: byProducts.lines } : {}) },
    marginMonthlyCents,
    cacCents,
    paybackMonths,
    ltv: { months: life.months, source: life.source, sample: life.sample, dealCents: dealLtv, historicalCents: historicalLtv, ratio },
    alerts,
  };
}
