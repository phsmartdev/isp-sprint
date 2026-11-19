import { describe, expect, it } from 'vitest';
import { b2gFromEconomics } from './b2gViability';
import { econMemory, emptyEconInput, financeEngine, type DealKind, econSettingsErrors, type EconSettings } from './finance';

const settings: EconSettings = { marginTargetBp: 3500, marginSuggestedBp: 3500, tmaMonthlyBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 200, contingencyOpexBp: 500, overheadBp: 0, incomeTaxBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true };
function scenario(kind: DealKind, contingencyCapexBp = 200) {
  const input = { ...emptyEconInput(), termMonths: 12, paybackMonths: 6, capex: [{ description: 'Investimento', kind, qtyMilli: 1000, unitCents: 800000 }], opex: [{ description: 'Operação mensal', qtyMilli: 1000, unitCents: 10000 }], b2g: { contributionBp: { fornecimento: 3500, instalacao: 3500 } } };
  const items = [{ description: 'Produto', kind, priceDefined: true, revenueCents: 2000000, doc: { name: 'Nota', percentBp: 1000, fixedCents: 0, complete: true } }];
  const args = { input, items, settings: { ...settings, contingencyCapexBp }, publicSector: false };
  return { args, main: financeEngine(args), product: b2gFromEconomics(args) };
}

describe('acréscimo independente no investimento dos serviços', () => {
  it.each(['servico', 'recorrencia', 'locacao'] as const)('%s: 8.000 + 160 + 2.800 = 10.960, sem compor os percentuais', (kind) => {
    const { main, product } = scenario(kind);
    expect(main.capexBaseCents).toBe(800000);
    expect(main.capexContingencyCents).toBe(16000);
    expect(main.serviceInvestmentCents).toBe(280000);
    expect(main.initialCents).toBe(1096000);
    if (kind !== 'servico') expect(main.cashflow[0]).toBe(-1096000);
    else expect(main.statement!.total.amortization).toBe(1096000);
    expect(main.rates.m).toBe(0.35);
    expect(product.baskets!.find((b) => b.profile === (kind === 'servico' ? 'instalacao' : 'implantacao'))).toMatchObject({ baseCents: 800000, contingencyCents: 16000, serviceInvestmentCents: 280000, investmentCents: 1096000 });
    const line = kind === 'servico' ? product.unica!.lines[0]! : product.recorrente!.lines[0]!;
    if (kind === 'servico') {
      expect(main.decision!.netMarginPct).toBeCloseTo(35.2, 8);
      expect(line.netPct).toBeCloseTo(35.2, 8);
      expect(line.suggestedCents).toBe(Math.round(1096000 / 0.55));
    } else {
      expect(main.monthlyCostCents).toBe(10500);
      expect(product.recorrente!.monthlyCostCents).toBe(10500);
      expect(product.global.costCents).toBe(1096000 + 10500 * 12);
    }
    expect(econMemory(main, String)[0]!.rows.find((r) => r.label === 'Investimento inicial (I)')!.formula).toContain('280000');
  });

  it('Fornecimento mantém apenas a contingência configurada', () => {
    const { main, product } = scenario('venda');
    expect(main.initialCents).toBe(816000);
    expect(main.serviceInvestmentCents).toBe(0);
    expect(product.unica!.costCents).toBe(816000);
    expect(main.rates.m).toBe(0.35);
  });

  it.each([0, 200, 500])('contingência %i vem das configurações, sem alterar os 35% de serviço', (contingency) => {
    const { main, product } = scenario('servico', contingency);
    expect(main.initialCents).toBe(800000 + 800000 * contingency / 10000 + 280000);
    expect(product.unica!.costCents).toBe(main.initialCents);
  });
});

describe('inferência configurável', () => {
  it.each(['servico', 'recorrencia', 'locacao', 'venda'] as const)('%s utiliza o percentual configurado sem compor a contingência', (kind) => {
    const { args } = scenario(kind);
    for (const serviceCostBp of [0, 2000, 3500, 4250]) {
      const configured = { ...args, input: { ...args.input, opex: kind === 'venda' || kind === 'servico' ? [] : args.input.opex }, items: args.items.map((item) => ({ ...item, priceDefined: false, revenueCents: 0 })), settings: { ...args.settings, serviceCostBp, netMarginTargetBp: 2000 } };
      const main = financeEngine(configured);
      const product = b2gFromEconomics(configured, undefined, main);
      const extra = kind === 'venda' ? 0 : 800000 * serviceCostBp / 10000;
      expect(main.serviceCostBp).toBe(serviceCostBp);
      const monthly = kind === 'recorrencia' || kind === 'locacao';
      expect(main.serviceInvestmentCents).toBe(monthly ? 0 : extra);
      expect(main.serviceMonthlyCents).toBe(monthly ? extra : 0);
      expect(main.initialCents).toBe(816000 + (monthly ? 0 : extra));
      expect(product.baskets!.find((b) => b.baseCents === 800000)).toMatchObject({
        serviceCostBp, serviceInvestmentCents: monthly ? 0 : extra, serviceMonthlyCents: monthly ? extra : 0, investmentCents: 816000 + (monthly ? 0 : extra),
      });
      expect(product.global.netPct!).toBeGreaterThanOrEqual(19.99);
      if (kind !== 'venda' && extra > 0) {
        const memory = econMemory(main, String)[0]!.rows.find((r) => r.label === (monthly ? 'Custos mensais (O)' : 'Investimento inicial (I)'))!.formula;
        expect(memory).toContain((serviceCostBp / 100).toLocaleString('pt-BR') + '%');
      }
    }
  });

  it('rejeita percentuais negativos ou fracionários em pontos-base', () => {
    for (const serviceCostBp of [-100, 2.5, 10000]) {
      expect(econSettingsErrors({ ...settings, serviceCostBp })).toContain('Inferência custo de serviço inválida.');
    }
  });
});
