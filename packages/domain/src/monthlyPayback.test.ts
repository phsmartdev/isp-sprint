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
  it.each([1, 2, 3, 6, 12])('sugerido preserva a margem contratual com teto de %i meses', (D) => {
    const args = scenario(D);
    const result = financeEngine(args);
    expect(result.decision!.netMarginPct!).toBeCloseTo(20, 2);
    if (result.kpi!.paybackMonths == null || result.kpi!.paybackMonths > result.term.D + 0.0001) expect(result.warnings.some((w) => w.includes('teto de payback'))).toBe(true);
    const products = b2gFromEconomics(args, undefined, result);
    expect(products.recorrente!.lines[0]!.suggestedCents).toBe(result.suggestedCents);
    expect(products.recorrente!.lines[0]!.paybackMonths).toBeCloseTo(result.kpi!.paybackMonths!, 4);
    expect(products.global.netPct).toBeCloseTo(result.decision!.netMarginPct!, 2);
  });
  it('teto curto não força uma margem acima do alvo: informa a incompatibilidade', () => {
    const r = financeEngine(scenario(2, 0));
    expect(r.decision!.netMarginPct!).toBeCloseTo(20, 2);
    expect(r.kpi!.paybackMonths!).toBeGreaterThan(2);
    expect(r.warnings.some((w) => w.includes('teto de payback'))).toBe(true);
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
    expect(changed.decision!.netMarginPct).toBeCloseTo(30, 2);
    expect(b2gFromEconomics(b, undefined, changed).global.netPct).toBeCloseTo(30, 2);
  });
  it('alvo volta a ser a margem contratual e a inferência usa o percentual configurado, inclusive zero', () => {
    for (const serviceCostBp of [3500, 2700, 0]) {
      const a = scenario(6, serviceCostBp);
      const r = financeEngine(a);
      expect(r.serviceCostBp).toBe(serviceCostBp);
      expect(r.serviceMonthlyCents).toBe(Math.round(800000 * serviceCostBp / 10000));
      expect(r.decision!.netMarginPct!).toBeCloseTo(20, 2);
      if ((r.kpi!.paybackMonths ?? Infinity) > 6) expect(r.warnings.join(' ')).toContain('teto de payback');
      const proposed = financeEngine({ ...a, input: { ...a.input, priceCents: 400000 } });
      expect(proposed.proposedResult!.serviceMonthlyCents).toBe(r.serviceMonthlyCents);
      expect(proposed.suggestedCents).toBe(r.suggestedCents);
      expect(proposed.warnings.filter((w) => w.includes('teto de payback'))).toEqual(r.warnings.filter((w) => w.includes('teto de payback')));
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
