import { describe, expect, it } from 'vitest';
import { emptyEconInput, financeEngine, type EconItem, type EconSettings } from './finance';
import { sectionErrors, sectionsEngine, sectionsFromLegacy, type DealSection } from './dealSections';

/** Parâmetros fictícios de teste: margem 20–45% (sugestão 30%), TMA 0, sem contingência, payback teto 24. */
const S: EconSettings = { marginTargetBp: 2000, marginMaxBp: 4500, marginSuggestedBp: 3000, tmaMonthlyBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 24, paybackMaxPublic: 24, blockOutsidePolicy: false };
const doc = (percentBp: number) => ({ name: 'Doc fictício', percentBp, fixedCents: 0, complete: true });
const it1 = (description: string, section: number, bp: number, kind: EconItem['kind'] = 'recorrencia'): EconItem => ({ description, revenueCents: 0, kind, section, doc: doc(bp) });

const rec: DealSection = {
  id: 's1', kind: 'recorrencia', termMonths: 36, receiveMonth: 0, marginTargetBp: 3000, paybackMonths: 12, priceCents: null,
  costs: [
    { description: 'ONU + cabo drop', qtyMilli: 1000, unitCents: 85_000, category: 'materia_prima', frequency: 'unico' },
    { description: 'Instalação e ativação', qtyMilli: 1000, unitCents: 120_000, category: 'mao_de_obra', frequency: 'unico' },
    { description: 'Última milha de terceiro', qtyMilli: 1000, unitCents: 90_000, category: 'parceiros', frequency: 'mensal' },
    { description: 'Monitoramento 24h', qtyMilli: 1000, unitCents: 12_000, category: 'despesas_operacionais', frequency: 'mensal' },
    { description: 'Conector sem classificação', qtyMilli: 10_000, unitCents: 350, category: null, frequency: 'unico' },
  ],
};
const sale: DealSection = {
  id: 's2', kind: 'venda', termMonths: 12, receiveMonth: 0, marginTargetBp: 2500, paybackMonths: null, priceCents: null,
  costs: [
    { description: 'Roteador Wi-Fi 6', qtyMilli: 2000, unitCents: 42_000, category: 'materia_prima', frequency: 'unico' },
    { description: 'Configuração', qtyMilli: 1000, unitCents: 15_000, category: 'mao_de_obra', frequency: 'unico' },
    { description: 'Frete', qtyMilli: 1000, unitCents: 6_000, category: 'despesas_operacionais', frequency: 'unico' },
  ],
};
const args = (sections: DealSection[]) => ({ input: { ...emptyEconInput(), sections }, items: [it1('Link dedicado 200 Mbps', 0, 1200), it1('IP fixo /29', 0, 1200), it1('Roteador Wi-Fi 6', 1, 1800, 'venda')], settings: S, publicSector: false });

describe('seções da negociação', () => {
  it('recorrência: só o mensal deduz; o investimento fica fora do preço e o payback mostra quando volta', () => {
    const r = sectionsEngine(args([rec]));
    const s = r.sections![0]!;
    // preço ideal = (parceiros + operacional) ÷ (1 − 12% − 30%)
    expect(s.idealCents).toBe(Math.ceil(102_000 / 0.58));
    expect(s.deductions).toEqual({ materia_prima: 0, mao_de_obra: 0, parceiros: 90_000, despesas_operacionais: 12_000 });
    expect(s.taxCents).toBe(Math.round(s.priceCents! * 0.12));
    expect(s.contributionPct!).toBeCloseTo(30, 1);
    expect(s.investment.totalCents).toBe(205_000);
    expect(s.investment.byCategory).toEqual({ materia_prima: 85_000, mao_de_obra: 120_000, parceiros: 0, despesas_operacionais: 0 });
    expect(s.unclassified).toBe(1);
    // 2.050 ÷ ~527/mês → volta no 4º mês (TMA 0), dentro do máximo de 12
    expect(s.paybackMonths).toBeGreaterThan(3);
    expect(s.paybackMonths).toBeLessThanOrEqual(4);
    expect(s.paybackOk).toBe(true);
    // contrato: margem × 36 − investimento
    expect(s.contract.investment).toBe(205_000);
    expect(s.contract.result).toBe(s.contract.contribution - 205_000);
    expect(s.contract.revenue).toBe(s.priceCents! * 36);
  });

  it('payback máximo curto sobe o preço ideal até pagar o investimento no prazo', () => {
    const r = sectionsEngine(args([{ ...rec, paybackMonths: 1 }]));
    const s = r.sections![0]!;
    expect(s.paybackPriceCents!).toBeGreaterThan(s.marginPriceCents!);
    expect(s.idealCents).toBe(s.paybackPriceCents);
    expect(s.paybackMonths!).toBeLessThanOrEqual(1);
  });

  it('venda: matéria-prima, mão de obra e despesas deduzem direto do preço', () => {
    const r = sectionsEngine(args([rec, sale]));
    const v = r.sections![1]!;
    expect(v.idealCents).toBe(Math.ceil(105_000 / (1 - 0.18 - 0.25)));
    expect(v.deductions).toEqual({ materia_prima: 84_000, mao_de_obra: 15_000, parceiros: 0, despesas_operacionais: 6_000 });
    expect(v.investment.totalCents).toBe(0);
    expect(v.contributionPct!).toBeCloseTo(25, 1);
    // visão geral: soma das seções, fluxo somado e resultado do contrato
    const o = r.sectionsOverview!;
    expect(o.total.revenue).toBe(r.sections![0]!.contract.revenue + v.contract.revenue);
    expect(o.total.result).toBe(r.sections![0]!.contract.result + v.contract.result);
    expect(o.cumulative.result.at(-1)).toBe(r.cashflow.reduce((a, b) => a + b, 0));
    expect(o.cumulative.result[0]).toBeLessThan(0);
    expect(r.priceCents).toBe(r.sections![0]!.priceCents);
  });

  it('preço praticado informado manda; abaixo da margem mínima o veredito piora', () => {
    const r = sectionsEngine(args([{ ...rec, priceCents: 110_000 }]));
    expect(r.sections![0]!.priceSource).toBe('informado');
    expect(r.sections![0]!.contributionPct!).toBeLessThan(20);
    expect(r.verdict).not.toBe('viavel');
  });

  it('converte a viabilidade anterior em seções pelo tipo dos produtos', () => {
    const input = { ...emptyEconInput(), mode: 'recorrente' as const, termMonths: 24, priceCents: 300_000, salePriceCents: 90_000,
      capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 40_000, impact: 'material' as const, kind: 'venda' as const }, { description: 'Instalação', qtyMilli: 1000, unitCents: 50_000, impact: 'servico' as const }],
      opex: [{ description: 'Link terceiro', qtyMilli: 1000, unitCents: 70_000, impact: 'operacional' as const }] };
    const c = sectionsFromLegacy(input, [{ kind: 'recorrencia' }, { kind: 'venda' }, { kind: 'servico' }]);
    expect(c.sections.map((s) => s.kind)).toEqual(['venda', 'recorrencia']);
    expect(c.itemSection).toEqual([1, 0, 0]);
    expect(c.sections[0]!.costs.map((x) => [x.description, x.category])).toEqual([['Roteador', 'materia_prima']]);
    expect(c.sections[1]!.costs.map((x) => [x.description, x.category, x.frequency])).toEqual([['Instalação', 'mao_de_obra', 'unico'], ['Link terceiro', 'despesas_operacionais', 'mensal']]);
    expect([c.sections[0]!.priceCents, c.sections[1]!.priceCents]).toEqual([90_000, 300_000]);
    expect(sectionErrors([{ ...sale, costs: [{ ...sale.costs[0]!, frequency: 'mensal' }] }])[0]).toMatch(/pagamento único/);
  });

  it('motor: investimento fora do preço não amortiza e o contrato desconta o investimento', () => {
    const base = { ...emptyEconInput(), mode: 'recorrente' as const, termMonths: 12, marginTargetBp: 3000, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 120_000, impact: 'servico' as const }], opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 50_000 }] };
    const out = financeEngine({ input: { ...base, investmentOutOfPrice: true }, items: [it1('Serviço', 0, 1000)], settings: { ...S, overheadBp: 0, incomeTaxBp: 0 }, publicSector: false });
    expect(out.term.D).toBe(0);
    expect(out.statement!.month.amortization).toBe(0);
    expect(out.statement!.total.amortization).toBe(120_000);
    expect(out.recommendedCents).toBe(Math.ceil(50_000 / 0.6));
  });
});
