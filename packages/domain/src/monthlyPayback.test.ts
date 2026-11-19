import { describe, expect, it } from 'vitest';
import { b2gFromEconomics } from './b2gViability';
import { econMemory, econPaybackErrors, emptyEconInput, financeEngine, type DealKind, type EconSettings } from './finance';

const settings: EconSettings = {
  marginTargetBp: 0, marginSuggestedBp: 3500, tmaMonthlyBp: 10,
  commissionBp: 0, lossPrivateBp: 100, lossPublicBp: 100, badDebtBp: 100,
  contingencyCapexBp: 200, contingencyOpexBp: 500, serviceCostBp: 3500,
  overheadBp: 0, incomeTaxBp: 757, paybackMaxPrivate: 6, paybackMaxPublic: 12,
  blockOutsidePolicy: true, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 9900,
};
function scenario(D = 6, serviceCostBp = 3500, kind: DealKind = 'recorrencia') {
  return {
    publicSector: false, settings: { ...settings, serviceCostBp },
    input: { ...emptyEconInput(), mode: kind === 'servico' ? 'pontual' as const : 'recorrente' as const,
      termMonths: 12, paybackMonths: D,
      capex: [{ description: 'Investimento', kind, qtyMilli: 1000, unitCents: 800000 }],
      opex: kind === 'servico' ? [] : [{ description: 'Operação', qtyMilli: 1000, unitCents: 10000 }] },
    items: [{ description: 'Link', kind, priceDefined: false, revenueCents: 0,
      doc: { name: 'NFCOM', percentBp: 2465, fixedCents: 0, complete: true } }],
  };
}
describe('preço mensal: caixa, inferência e margem negociada', () => {
  it.each([1, 2, 3, 6, 12])('sugerido recupera o investimento em até %i meses, já depois dos custos e IR', (D) => {
    const args = scenario(D);
    const result = financeEngine(args);
    expect(result.kpi!.paybackMonths).not.toBeNull();
    expect(result.kpi!.paybackMonths!).toBeLessThanOrEqual(D + 0.0001);
    expect(result.cashflow.slice(0, D + 1).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(-1);
    expect(result.cashflow.slice(0, D + 1).reduce((a, b, k) => a + b / 1.001 ** k, 0)).toBeGreaterThanOrEqual(-2);
    expect(result.decision!.netMarginPct!).toBeGreaterThanOrEqual(19.99);
    const products = b2gFromEconomics(args, undefined, result);
    expect(products.recorrente!.lines[0]!.suggestedCents).toBe(result.suggestedCents);
    expect(products.recorrente!.lines[0]!.paybackMonths).toBeCloseTo(result.kpi!.paybackMonths!, 4);
    expect(products.global.netPct).toBeCloseTo(result.decision!.netMarginPct!, 2);
  });
  it('payback menor aumenta o preço quando é a restrição dominante, evitando o prejuízo de amortização inicial', () => {
    const fast = financeEngine(scenario(2, 0)), slow = financeEngine(scenario(6, 0));
    expect(fast.suggestedCents!).toBeGreaterThan(slow.suggestedCents!);
    expect(fast.statement!.month.net!).toBeGreaterThanOrEqual(-1);
    expect(fast.kpi!.paybackMonths!).toBeLessThanOrEqual(2);
    expect(fast.warnings.some((w) => w.includes('margem líquida alvo é aplicada'))).toBe(true);
    expect(fast.statement!.total.net).toBeGreaterThan(0);
  });
  it.each(['recorrencia', 'locacao'] as const)('%s: 35%% da base se repete em todos os meses e não duplica o investimento inicial', (kind) => {
    const args = scenario(6, 3500, kind), result = financeEngine(args);
    expect(result.initialCents).toBe(816000);
    expect(result.serviceInvestmentCents).toBe(0);
    expect(result.serviceMonthlyCents).toBe(280000);
    expect(result.monthlyCostCents).toBe(290500);
    expect(result.opexContingencyCents).toBe(500);
    expect(result.statement!.month.opex).toBe(290500);
    expect(result.statement!.after!.opex).toBe(290500);
    expect(result.statement!.total.opex).toBe(3486000);
    expect(b2gFromEconomics(args, undefined, result).global.costCents).toBe(4302000);
    expect(JSON.stringify(econMemory(result, String))).toContain('280000/mês');
  });
  it('Serviço único mantém a inferência uma única vez', () => {
    const result = financeEngine(scenario(6, 3500, 'servico'));
    expect(result.initialCents).toBe(1096000);
    expect(result.serviceInvestmentCents).toBe(280000);
    expect(result.serviceMonthlyCents).toBe(0);
    expect(result.monthlyCostCents).toBe(0);
  });
  it('margem da negociação altera o sugerido e é respeitada nos dois motores', () => {
    const a = scenario(6);
    const normal = financeEngine(a);
    const b = { ...a, input: { ...a.input, b2g: { netTargetBp: 3000 } } };
    const changed = financeEngine(b);
    expect(changed.targetNetMarginPct).toBe(30);
    expect(changed.suggestedCents!).toBeGreaterThan(normal.suggestedCents!);
    expect(changed.decision!.paybackNetMarginPct).toBeCloseTo(30, 2);
    expect(changed.decision!.netMarginPct!).toBeGreaterThan(30);
    expect(b2gFromEconomics(b, undefined, changed).global.netPct).toBeCloseTo(changed.decision!.netMarginPct!, 2);
  });
  it.each(['recorrencia', 'locacao'] as const)('%s: mais prazo reduz a mensalidade em todos os prazos permitidos, com tributos, IR, TMA e inferência', (kind) => {
    for (const publicSector of [false, true]) {
      let previous = Infinity;
      const limit = publicSector ? settings.paybackMaxPublic : settings.paybackMaxPrivate;
      for (let D = 1; D <= limit; D++) {
        const a = { ...scenario(D, 2700, kind), publicSector };
        const r = financeEngine(a);
        expect(r.term.D).toBe(D);
        expect(r.suggestedCents!).toBeLessThan(previous);
        expect(r.decision!.paybackNetMarginPct!).toBeCloseTo(20, 2);
        expect(r.kpi!.paybackMonths!).toBeLessThanOrEqual(D + 0.0001);
        expect(r.statement!.total.net!).toBeGreaterThan(0);
        previous = r.suggestedCents!;
      }
    }
  });
  it('API deve rejeitar o prazo acima do teto privado ou público, inclusive por cesta', () => {
    const a = scenario(7);
    expect(econPaybackErrors(a.input, settings, false)).toHaveLength(1);
    expect(econPaybackErrors(a.input, settings, true)).toEqual([]);
    expect(econPaybackErrors({ ...a.input, paybackMonths: null, baskets: { implantacao: { paybackMonths: 7 } } }, settings, false)).toHaveLength(1);
    expect(econPaybackErrors({ ...a.input, paybackMonths: 13, termMonths: 24 }, settings, true)).toHaveLength(1);
    expect(financeEngine(a).term.D).toBe(6);
    expect(financeEngine({ ...a, publicSector: true }).term.D).toBe(7);
  });
  it('preço informado continua sendo analisado, mesmo quando não atende ao payback', () => {
    const a = scenario(2, 0);
    const r = financeEngine({ ...a, input: { ...a.input, priceCents: 148869 } });
    expect(r.decision!.priceCents).toBe(148869);
    expect(r.decision!.paybackMonths == null || r.decision!.paybackMonths > 2).toBe(true);
    expect(r.decision!.paybackNetMarginPct!).toBeLessThan(0);
    expect(r.suggestedCents!).toBeGreaterThan(r.decision!.priceCents!);
  });
});
