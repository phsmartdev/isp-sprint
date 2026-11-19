import { describe, expect, it } from 'vitest';
import { b2gFromEconomics } from './b2gViability';
import { emptyEconInput, financeEngine, type DealKind, type EconSettings } from './finance';
const settings: EconSettings = { marginTargetBp: 3500, marginSuggestedBp: 5000, marginMaxBp: 9900, tmaMonthlyBp: 100, commissionBp: 0, lossPrivateBp: 200, lossPublicBp: 200, badDebtBp: 100, contingencyCapexBp: 200, contingencyOpexBp: 500, overheadBp: 1500, incomeTaxBp: 1500, inflationAnnualBp: 500, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 4100 };
function scenario(kind: DealKind, termMonths = 24) {
  return { publicSector: false, settings, input: { ...emptyEconInput(), termMonths, paybackMonths: Math.min(6, termMonths), capex: [{ description: 'Investimento', kind, qtyMilli: 1000, unitCents: 800000 }], extraInitialCents: 12345, opex: [{ description: 'Operação', qtyMilli: 1000, unitCents: 10000 }] }, items: [{ description: 'Produto', kind, priceDefined: false, revenueCents: 0, doc: { name: 'Doc', percentBp: 1000, fixedCents: 37, complete: true } }] };
}
describe('preço governado pela margem líquida esperada', () => {
  it.each(['venda', 'servico', 'recorrencia', 'locacao'] as const)('%s entrega o alvo e ignora ajustes antigos de contribuição', (kind) => {
    const args = scenario(kind);
    const r = financeEngine(args);
    expect(r.decision!.netMarginPct!).toBeGreaterThanOrEqual(19.99);
    expect(r.suggestedCents).toBeGreaterThan(0);
    expect(r.rates.m).not.toBe(0.5);
    expect(r.kpi!.marginPct / 100).toBeCloseTo(r.rates.m, 4);
    const changed = financeEngine({ ...args, input: { ...args.input, marginTargetBp: 9500, b2g: { contributionBp: { fornecimento: 9500, instalacao: 9500, implantacao: 9500 } } } });
    expect(changed.suggestedCents).toBe(r.suggestedCents);
    const p = b2gFromEconomics(args, undefined, r);
    const line = (p.unica ?? p.recorrente)!.lines[0]!;
    expect(line.suggestedCents).toBe(r.suggestedCents);
    expect(line.netPct!).toBeGreaterThanOrEqual(19.99);
    const known = financeEngine({ ...args, items: [{ ...args.items[0]!, priceDefined: true, revenueCents: 1000000 }] });
    expect(known.suggestedCents).toBe(r.suggestedCents);
    expect(known.decision!.priceCents).toBe(1000000);
  });
  it.each([1, 6, 12, 24, 36])('recorrência: alvo na vigência de %i meses, sem mudar o payback informado', (months) => {
    const args = scenario('recorrencia', months);
    const r = financeEngine(args);
    expect(r.decision!.netMarginPct!).toBeGreaterThanOrEqual(19.99);
    expect(r.term.D).toBe(args.input.paybackMonths);
    const p = b2gFromEconomics(args, undefined, r);
    expect(p.recorrente!.netPct!).toBeGreaterThanOrEqual(19.99);
  });
  it('três cestas e vários produtos: sugeridos dos itens fecham com o sugerido do motor', () => {
    const a = scenario('recorrencia');
    const args = { ...a, input: { ...a.input, capex: ['venda','servico','recorrencia'].map((kind) => ({ ...a.input.capex[0]!, kind: kind as DealKind })) }, items: ['venda','servico','recorrencia','locacao'].map((kind) => ({ ...a.items[0]!, description: kind, kind: kind as DealKind })) };
    const r = financeEngine(args), p = b2gFromEconomics(args, undefined, r);
    expect(r.decision!.netMarginPct!).toBeGreaterThanOrEqual(19.99);
    expect(p.unica!.lines.reduce((t, l) => t + l.suggestedCents!, 0)).toBe(r.suggestedOneTimeCents);
    expect(p.recorrente!.lines.reduce((t, l) => t + l.suggestedCents!, 0)).toBe(r.suggestedCents);
    expect(p.global.netPct!).toBeGreaterThanOrEqual(19.99);
  });
  it('ajuste de despesas fixas participa da busca sem alterar o alvo líquido', () => {
    const a = scenario('recorrencia');
    const args = { ...a, input: { ...a.input, b2g: { overheadBp: 2500 } } };
    const r = financeEngine(args), p = b2gFromEconomics(args, undefined, r);
    expect(r.decision!.netMarginPct!).toBeGreaterThanOrEqual(19.99);
    expect(p.recorrente!.netPct!).toBeGreaterThanOrEqual(19.99);
    expect(r.suggestedCents).toBeGreaterThan(financeEngine(a).suggestedCents!);
  });

  it('descrições iguais em perfis diferentes mantêm as referências separadas', () => {
    const a = scenario('recorrencia');
    const kinds: DealKind[] = ['venda', 'servico', 'recorrencia'];
    const args = { ...a, input: { ...a.input, capex: kinds.map((kind, i) => ({ ...a.input.capex[0]!, kind, unitCents: 100000 * (i + 1) })) }, items: kinds.map((kind) => ({ ...a.items[0]!, description: 'Mesmo nome', kind })) };
    const r = financeEngine(args), p = b2gFromEconomics(args, undefined, r);
    expect(p.unica!.lines.reduce((t, l) => t + l.suggestedCents!, 0)).toBe(r.suggestedOneTimeCents);
    expect(p.recorrente!.lines[0]!.suggestedCents).toBe(r.suggestedCents);
    expect(p.global.netPct!).toBeGreaterThanOrEqual(19.99);
  });

});
