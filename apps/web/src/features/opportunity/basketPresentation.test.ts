import { describe, expect, it } from 'vitest';
import { econBasketViews, emptyEconInput, financeEngine, type DealKind, type EconSettings } from '@isp/domain';
import { businessCash, businessStatement, categoryCosts } from './basketPresentation';
const settings: EconSettings = { marginTargetBp: 0, tmaMonthlyBp: 10, commissionBp: 0, lossPrivateBp: 100, lossPublicBp: 100, badDebtBp: 100, contingencyCapexBp: 200, contingencyOpexBp: 500, serviceCostBp: 3500, overheadBp: 0, incomeTaxBp: 757, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 9900 };
const kinds: DealKind[] = ['venda', 'servico', 'recorrencia'];
const input = { ...emptyEconInput(), pricingMode: 'global' as const, termMonths: 24, extraInitialCents: 12345, capex: kinds.map((kind) => ({ description: kind, kind, qtyMilli: 1000, unitCents: 800000, impact: 'material' as const })), opex: [{ description: 'Parceiro', kind: 'recorrencia' as const, category: 'parceiros' as const, impact: 'operacional' as const, qtyMilli: 1000, unitCents: 54000 }], baskets: { fornecimento: { netTargetBp: 3000, priceCents: 1500000 }, instalacao: { netTargetBp: 2500, priceCents: 2000000 }, implantacao: { netTargetBp: 2000, paybackMonths: 4, priceCents: 900000 } } };
const items = kinds.map((kind) => ({ description: kind, kind, priceDefined: false, revenueCents: 0, doc: { name: 'Nota', percentBp: 2465, fixedCents: 37, complete: true } }));
describe('consolidado global usa os resultados do motor', () => {
  it('categorias fecham os custos avaliados, sem deduzir investimento duas vezes', () => {
    const result = financeEngine({ input, items, settings, publicSector: false });
    const views = econBasketViews(input, items, settings, result);
    for (const v of views) {
      const cats = categoryCosts(v, input, settings);
      const total = v.evaluation.statement!.total;
      const sum = Object.values(cats).reduce((a, b) => a + b, 0);
      expect(sum).toBe(v.evaluation.mode === 'recorrente' ? total.opex : total.amortization);
      const contribution = total.revenue - total.tax - total.commission - sum - (v.evaluation.mode === 'recorrente' ? total.amortization : 0);
      expect(contribution).toBe(total.contribution);
    }
  });
  it('resultado, tributos e lucro da DRE fecham com o consolidado proposto do servidor', () => {
    const result = financeEngine({ input, items, settings, publicSector: false });
    const views = econBasketViews(input, items, settings, result), total = businessStatement(views);
    expect(total).toEqual(result.proposedResult!.statement!.total);
    expect(total.net).toBe(total.operating! - total.incomeTax!);
  });
  it('gráfico usa os fluxos de caixa reais; receita menos desembolsos é o saldo acumulado', () => {
    const result = financeEngine({ input, items, settings, publicSector: false });
    const views = econBasketViews(input, items, settings, result);
    const flow = businessCash(views);
    expect(flow.cashflow).toEqual(result.proposedResult!.cashflow);
    flow.cash.forEach((n, k) => expect(n).toBe(flow.revenue[k]! - flow.deductions[k]!));
    expect(flow.cash.at(-1)).toBe(flow.cashflow.reduce((a, b) => a + b, 0));
  });
  it('Instalação: inferência custo de serviço em linha própria, com o % das Configurações', () => {
    const one = { ...emptyEconInput(), mode: 'pontual' as const, pricingMode: 'global' as const, capex: [{ description: 'Cabo', kind: 'servico' as const, qtyMilli: 1000, unitCents: 1000000, impact: 'material' as const }], baskets: { instalacao: { netTargetBp: 2000 } } };
    const its = [{ description: 'Cabeamento', kind: 'servico' as const, priceDefined: false, revenueCents: 0, doc: { name: 'NFS', percentBp: 2515, fixedCents: 0, complete: true } }];
    for (const bp of [3500, 2000]) {
      const st = { ...settings, serviceCostBp: bp };
      const [v] = econBasketViews(one, its, st, financeEngine({ input: one, items: its, settings: st, publicSector: false }));
      const cats = categoryCosts(v!, one, st);
      expect(cats.inferencia).toBe(1000000 * bp / 10000);
      expect(cats.materia_prima).toBe(1000000 + 20000); // base + contingência de 2%
      expect(cats.mao_de_obra + cats.inferencia + cats.materia_prima).toBe(v!.evaluation.statement!.total.amortization);
    }
  });
});
