import { describe, expect, it } from 'vitest';
import { b2gFromEconomics } from './b2gViability';
import { econBasketViews, econTargetErrors, emptyEconInput, financeEngine, type DealKind, type EconInput, type EconSettings } from './finance';
const settings: EconSettings = { marginTargetBp: 0, tmaMonthlyBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, badDebtBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, serviceCostBp: 3500, overheadBp: 0, incomeTaxBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 9900 };
const kinds: DealKind[] = ['venda', 'servico', 'recorrencia', 'locacao'];
const input: EconInput = { ...emptyEconInput(), pricingMode: 'global', termMonths: 12, paybackMonths: 6, capex: kinds.slice(0, 3).map((kind) => ({ description: 'Investimento ' + kind, kind, qtyMilli: 1000, unitCents: 1000000, impact: 'material' })), opex: [] };
const items = kinds.map((kind, index) => ({ id: String(index), qtyMilli: index === 2 ? 3000 : 1000, unit: 'un', description: 'Produto ' + kind, kind, priceDefined: false, revenueCents: 0, doc: { name: 'Nota', percentBp: 0, fixedCents: 0, complete: true } }));
const run = (i = input) => financeEngine({ input: i, items, settings, publicSector: false });
describe('precificação global por cesta', () => {
  it('margens líquidas diferentes por cesta não alteram os preços das demais', () => {
    const base = run();
    const next = run({ ...input, baskets: { fornecimento: { netTargetBp: 3000 }, instalacao: { netTargetBp: 2500 }, implantacao: { netTargetBp: 2000 } } });
    const views = econBasketViews(input, items, settings, next);
    expect(views.map((v) => v.profile)).toEqual(['fornecimento', 'instalacao', 'implantacao']);
    expect(views[0]!.evaluation.statement!.total.net! / views[0]!.evaluation.statement!.total.revenue).toBeCloseTo(0.3, 5);
    expect(views[1]!.evaluation.statement!.total.net! / views[1]!.evaluation.statement!.total.revenue).toBeCloseTo(0.25, 5);
    expect(views[2]!.result.suggestedCents).toBe(econBasketViews(input, items, settings, base)[2]!.result.suggestedCents);
    expect(views[2]!.kinds).toEqual(['recorrencia', 'locacao']);
    expect(views[0]!.result.suggestedCents).toBe(1428572);
    expect(views[1]!.result.suggestedCents).toBe(1800000);
  });
  it('payback da Implantação altera sua mensalidade e preserva Venda e Instalação', () => {
    const a = run(), b = run({ ...input, baskets: { implantacao: { paybackMonths: 2 } } });
    const av = econBasketViews(input, items, settings, a), bv = econBasketViews(input, items, settings, b);
    expect(bv[2]!.result.term.D).toBe(2);
    expect(bv[2]!.result.kpi!.paybackMonths!).toBeLessThanOrEqual(2.00001);
    expect(bv[2]!.result.suggestedCents!).toBeGreaterThan(av[2]!.result.suggestedCents!);
    expect(bv.slice(0, 2).map((v) => v.result.suggestedCents)).toEqual(av.slice(0, 2).map((v) => v.result.suggestedCents));
  });
  it('os preços globais propostos são avaliados separadamente e fecham com o consolidado', () => {
    const draft: EconInput = { ...input, baskets: { fornecimento: { priceCents: 1500000 }, instalacao: { priceCents: 2000000 }, implantacao: { priceCents: 800000, paybackMonths: 4 } } };
    const result = run(draft), views = econBasketViews(draft, items, settings, result);
    expect(result.decision).toMatchObject({ basis: 'proposto', priceCents: 800000, oneTimeCents: 3500000 });
    expect(views.map((v) => v.evaluation.priceCents)).toEqual([1500000, 2000000, 800000]);
    expect(views.every((v) => v.result.decision?.basis === 'proposto')).toBe(true);
    expect(result.proposedResult!.statement!.total.revenue).toBe(3500000 + 800000 * 12);
    expect(result.proposedResult!.statement!.total.net).toBe(views.reduce((n, v) => n + v.evaluation.statement!.total.net!, 0));
    expect(JSON.stringify(result).length).toBeLessThan(200000);
    const detail = b2gFromEconomics({ input: draft, items, settings, publicSector: false }, undefined, result);
    expect(detail.unica!.lines.reduce((n, l) => n + l.priceCents!, 0)).toBe(3500000);
    expect(detail.recorrente!.lines.reduce((n, l) => n + l.priceCents!, 0)).toBe(800000);
    expect(detail.global.netCents).toBe(result.proposedResult!.statement!.total.net);
  });
  it('adotar o preço global não altera os valores originais dos produtos', () => {
    const before = JSON.stringify(items);
    const draft = { ...input, baskets: { fornecimento: { priceCents: 1750000 } } };
    const views = econBasketViews(draft, items, settings, run(draft));
    expect(views[0]!.result.decision!.basis).toBe('proposto');
    expect(views[1]!.result.decision!.basis).toBe('sugerido');
    expect(JSON.stringify(items)).toBe(before);
  });
  it('somente uma cesta mantém o preço proposto e os ajustes específicos', () => {
    const one = { ...input, capex: [input.capex[0]!], opex: [], baskets: { fornecimento: { netTargetBp: 3500, priceCents: 2000000 } } };
    const result = financeEngine({ input: one, items: [items[0]!], settings, publicSector: false });
    const views = econBasketViews(one, [items[0]!], settings, result);
    expect(views).toHaveLength(1);
    expect(views[0]!.result.targetNetMarginPct).toBe(35);
    expect(views[0]!.evaluation.priceCents).toBe(2000000);
  });
  it('descrições repetidas na mesma cesta não colidem no rateio global', () => {
    const repeated = items.map((i) => ({ ...i, description: 'Mesmo nome' }));
    const draft = { ...input, baskets: { implantacao: { priceCents: 800001 } } };
    const result = financeEngine({ input: draft, items: repeated, settings, publicSector: false });
    const detail = b2gFromEconomics({ input: draft, items: repeated, settings, publicSector: false }, undefined, result);
    expect(detail.recorrente!.lines).toHaveLength(2);
    expect(new Set(detail.recorrente!.lines.map((l) => l.id)).size).toBe(2);
    expect(detail.recorrente!.lines.reduce((n, l) => n + l.priceCents!, 0)).toBe(800001);
  });
  it('lances antigos por item são preservados no input, mas não substituem o preço global', () => {
    const draft = { ...input, b2g: { bids: { 'produto recorrencia': 1 } }, baskets: { implantacao: { priceCents: 800000 } } };
    const result = run(draft);
    const detail = b2gFromEconomics({ input: draft, items, settings, publicSector: false }, undefined, result);
    expect(detail.recorrente!.lines.reduce((n, l) => n + l.priceCents!, 0)).toBe(800000);
    expect(draft.b2g.bids['produto recorrencia']).toBe(1);
  });
  it('valida os limites da empresa em cada cesta', () => {
    expect(econTargetErrors({ ...input, baskets: { fornecimento: { netTargetBp: 800 }, implantacao: { netTargetBp: 10000 } } }, settings)).toHaveLength(2);
    expect(econTargetErrors({ ...input, baskets: { fornecimento: { netTargetBp: 900 }, instalacao: { netTargetBp: 9900 } } }, settings)).toEqual([]);
  });
  it.each([0, 100, 760, 1500])('IR %i bp: rateio global mantém lucro e margens exatamente iguais aos do motor', (incomeTaxBp) => {
    const st = { ...settings, incomeTaxBp, tmaMonthlyBp: 10, lossPrivateBp: 100, badDebtBp: 100 };
    const draft: EconInput = { ...input, baskets: { fornecimento: { priceCents: 1700003 }, instalacao: { priceCents: 2200007 }, implantacao: { priceCents: 900003, paybackMonths: 4 } }, opex: [{ description: 'Parceiro', kind: 'recorrencia', qtyMilli: 45000, unitCents: 1200 }] };
    const fiscalItems = items.map((i) => ({ ...i, doc: { ...i.doc, percentBp: 2465 } }));
    const result = financeEngine({ input: draft, items: fiscalItems, settings: st, publicSector: false });
    const detail = b2gFromEconomics({ input: draft, items: fiscalItems, settings: st, publicSector: false }, undefined, result);
    expect(detail.global.netCents).toBe(result.proposedResult!.statement!.total.net);
    expect(detail.unica!.netCents! + detail.recorrente!.netCents!).toBe(detail.global.netCents);
  });

});
