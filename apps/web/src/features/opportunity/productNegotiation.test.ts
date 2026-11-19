import { describe, expect, it } from 'vitest';
import { emptyEconInput, financeEngine, type DealKind, type EconInput, type EconSettings } from '@isp/domain';
import { costDrafts, costsInput } from './productNegotiation';
const settings: EconSettings = { marginTargetBp: 0, tmaMonthlyBp: 10, commissionBp: 0, lossPrivateBp: 100, lossPublicBp: 100, badDebtBp: 100, contingencyCapexBp: 200, contingencyOpexBp: 500, serviceCostBp: 3500, overheadBp: 0, incomeTaxBp: 757, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 9900 };
const kinds: DealKind[] = ['venda', 'servico', 'recorrencia', 'locacao'];
const input: EconInput = { ...emptyEconInput(), termMonths: 24, paybackMonths: 6, extraInitialCents: 12345, b2g: { netTargetBp: 3000, weights: { venda: 0.25 } }, capex: kinds.map((kind) => ({ description: kind, kind, qtyMilli: 8400000, unitCents: 250, unit: 'm', impact: kind === 'venda' ? 'material' : 'servico', manual: true })), opex: [{ description: 'Operação', qtyMilli: 1500, unitCents: 15037, impact: 'operacional', kind: 'recorrencia' }] };
describe('editor de produtos: preservação financeira', () => {
  it('abrir e salvar não altera os números do motor nem os parâmetros da negociação', () => {
    const rebuilt = costsInput(input, costDrafts(input, kinds));
    expect(rebuilt).toEqual(input);
    const items = kinds.map((kind) => ({ kind, description: kind, priceDefined: false, revenueCents: 0, doc: { name: 'Nota', percentBp: 2465, fixedCents: 37, complete: true } }));
    expect(financeEngine({ input: rebuilt, items, settings, publicSector: false })).toEqual(financeEngine({ input, items, settings, publicSector: false }));
  });
  it('custos antigos sem tipo ou classificação são preservados, inclusive entrega e taxa fixa', () => {
    const old = { ...input, capex: [{ description: 'Compartilhado', qtyMilli: 1000, unitCents: 30000 }, { description: 'Entrega', qtyMilli: 1000, unitCents: 12000, impact: 'entrega' as const }, { description: 'Taxa', qtyMilli: 1000, unitCents: 1234, impact: 'taxa_venda' as const }], opex: [{ description: 'Operação comum', qtyMilli: 1000, unitCents: 5000 }] };
    const rebuilt = costsInput(old, costDrafts(old, kinds));
    expect(rebuilt.capex.every((c) => c.kind == null)).toBe(true);
    expect(rebuilt.capex.map((c) => c.unitCents)).toEqual([30000, 12000, 1234]);
    const items = kinds.map((kind) => ({ kind, description: kind, priceDefined: false, revenueCents: 0, doc: { name: 'Nota', percentBp: 1000, fixedCents: 0, complete: true } }));
    expect(financeEngine({ input: rebuilt, items, settings, publicSector: false })).toEqual(financeEngine({ input: old, items, settings, publicSector: false }));
  });
  it('Quando move somente a linha escolhida para o custo mensal', () => {
    const drafts = costDrafts(input, kinds).map((c) => c.description === 'recorrencia' ? { ...c, frequency: 'mensal' as const } : c);
    const next = costsInput(input, drafts);
    expect(next.capex.map((c) => c.kind)).toEqual(['venda', 'servico', 'locacao']);
    expect(next.opex.find((c) => c.description === 'recorrencia')).toMatchObject({ kind: 'recorrencia', unitCents: 250, qtyMilli: 8400000 });
    expect(next.b2g).toEqual(input.b2g);
    expect(next.paybackMonths).toBe(6);
  });
  it('não atribui a Venda um custo mensal antigo sem produtos mensais', () => {
    const legacy = { ...input, opex: [{ description: 'Mensal antigo', qtyMilli: 1000, unitCents: 12000 }] };
    expect(costDrafts(legacy, ['venda']).find((c) => c.frequency === 'mensal')!.kind).toBeNull();
    expect(costsInput(legacy, costDrafts(legacy, ['venda'])).opex[0]).toMatchObject({ kind: null, unitCents: 12000 });
  });

});
