import { defaultCostProfile } from './b2gViability';
import { impactOfCategory, isMonthlySection } from './dealSections';
import { emptyEconInput, type CostLine, type DealKind, type EconInput, type EconItem } from './finance';

/** Prévia reversível de conversão. As seções originais e os snapshots permanecem preservados. */
export function globalInputFromSections(input: EconInput, items: Pick<EconItem, 'kind' | 'section' | 'priceDefined'>[]): EconInput | null {
  if (input.pricingMode === 'global' || !input.sections?.length) return input;
  if (items.some((i) => i.priceDefined === true) && items.some((i) => i.priceDefined === false)) return null;
  const sections = input.sections;
  if (items.some((i) => (i.section ?? 0) < 0 || (i.section ?? 0) >= sections.length)) return null;
  const monthly = sections.filter((s) => isMonthlySection(s.kind));
  const unique = sections.filter((s) => !isMonthlySection(s.kind));
  // Prazos distintos e custos sem classificação continuam no editor de seções existente.
  if (new Set(monthly.map((s) => s.termMonths)).size > 1 || new Set(unique.map((s) => s.receiveMonth)).size > 1 || sections.some((s) => s.costs.some((c) => !c.category))) return null;
  const kinds: DealKind[] = [];
  for (const [index, section] of sections.entries()) {
    const products = items.filter((i) => (i.section ?? 0) === index);
    const profiles = new Set(products.map((i) => defaultCostProfile(i.kind ?? section.kind)));
    if (profiles.size > 1) return null;
    const kind = section.kind === 'venda' && products.length && products.every((i) => i.kind === 'servico') ? 'servico' : section.kind;
    if (products.some((i) => defaultCostProfile(i.kind ?? kind) !== defaultCostProfile(kind))) return null;
    kinds.push(kind);
  }
  const capex: CostLine[] = [], opex: CostLine[] = [];
  sections.forEach((s, index) => s.costs.forEach((c) => {
    const line: CostLine = { description: c.description, qtyMilli: c.qtyMilli, unitCents: c.unitCents, unit: c.unit, impact: impactOfCategory(c.category!, c.frequency), category: c.category, costItemId: c.costItemId, priceId: c.priceId, manual: c.manual, kind: kinds[index] };
    (c.frequency === 'mensal' ? opex : capex).push(line);
  }));
  const baskets = { ...input.baskets };
  for (const profile of ['fornecimento', 'instalacao', 'implantacao'] as const) {
    const matching = sections.filter((_, index) => defaultCostProfile(kinds[index]!) === profile);
    if (!matching.length) continue;
    // Preço parcial não é misturado com uma sugestão: preserva o editor original.
    if (matching.some((s) => s.priceCents != null) && matching.some((s) => s.priceCents == null)) return null;
    baskets[profile] = { ...baskets[profile], priceCents: matching.every((s) => s.priceCents != null) ? matching.reduce((sum, s) => sum + s.priceCents!, 0) : null,
      paybackMonths: profile === 'implantacao' && matching.some((s) => s.paybackMonths != null) ? Math.min(...matching.flatMap((s) => s.paybackMonths == null ? [] : [s.paybackMonths])) : null };
  }
  return { ...emptyEconInput(), ...input, pricingMode: 'global', mode: monthly.length ? 'recorrente' : 'pontual', termMonths: monthly[0]?.termMonths ?? input.termMonths,
    receiveMonth: unique[0]?.receiveMonth ?? input.receiveMonth, capex, opex, extraInitialCents: 0, baskets, priceCents: null, salePriceCents: null, paybackMonths: null,
    investmentOutOfPrice: undefined, atProposed: undefined, skipRecommendation: undefined };
}
