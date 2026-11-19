import { describe, expect, it } from 'vitest';
import { globalInputFromSections } from './sectionCompatibility';
import { emptyEconInput, financeEngine, type EconInput, type EconSettings } from './finance';
import type { DealSection } from './dealSections';
const settings: EconSettings = { marginTargetBp: 0, tmaMonthlyBp: 10, commissionBp: 0, lossPrivateBp: 100, lossPublicBp: 100, badDebtBp: 100, contingencyCapexBp: 200, contingencyOpexBp: 500, serviceCostBp: 2700, overheadBp: 0, incomeTaxBp: 757, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, netMarginTargetBp: 2000, netMarginMinBp: 800, netMarginMaxBp: 9900 };
const cost = { description: 'Equipamento', qtyMilli: 1000, unitCents: 800000, category: 'materia_prima' as const, frequency: 'unico' as const };
const section = (kind: DealSection['kind'], id: string): DealSection => ({ id, kind, termMonths: 20, receiveMonth: 0, costs: [cost], marginTargetBp: 3500, paybackMonths: 6, priceCents: null });
const input: EconInput = { ...emptyEconInput(), sections: [section('venda', 's1'), { ...section('recorrencia', 's2'), costs: [cost, { ...cost, description: 'Parceiro', category: 'parceiros', frequency: 'mensal', unitCents: 54000 }] }] };
const items = [{ kind: 'venda' as const, section: 0, description: 'Venda', revenueCents: 0, priceDefined: false, doc: { name: 'Nota', percentBp: 2465, fixedCents: 0, complete: true } }, { kind: 'recorrencia' as const, section: 1, description: 'Link', revenueCents: 0, priceDefined: false, doc: { name: 'Nota', percentBp: 2465, fixedCents: 0, complete: true } }];
describe('integração das seções já existentes', () => {
 it('converte custos, frequência e vigência sem mutar dados nem perder as seções originais', () => {
   const before = JSON.stringify(input), converted = globalInputFromSections(input, items)!;
   expect(converted.pricingMode).toBe('global'); expect(converted.termMonths).toBe(20);
   expect(converted.sections).toBe(input.sections); expect(JSON.stringify(input)).toBe(before);
   expect(converted.capex.map((c) => [c.kind, c.unitCents])).toEqual([['venda', 800000], ['recorrencia', 800000]]);
   expect(converted.opex[0]).toMatchObject({ kind: 'recorrencia', category: 'parceiros', unitCents: 54000 });
   const result = financeEngine({ input: converted, items, settings, publicSector: false });
   const monthly = result.deal!.cells.find((c) => c.lot === 'servico')!.result;
   expect(monthly.serviceMonthlyCents).toBe(216000); expect(monthly.decision?.netMarginPct ?? monthly.statement!.total.net! / monthly.statement!.total.revenue * 100).toBeCloseTo(20, 2);
 });
 it('serviço único em uma seção antiga de venda vai para Instalação', () => {
   const converted = globalInputFromSections({ ...input, sections: [section('venda', 's1')] }, [{ kind: 'servico', section: 0 }])!;
   expect(converted.capex[0]!.kind).toBe('servico'); expect(converted.mode).toBe('pontual');
 });
 it('preços legados parcialmente preenchidos permanecem no editor anterior', () => {
   expect(globalInputFromSections(input, [{ ...items[0]!, priceDefined: true }, { ...items[1]!, priceDefined: false }])).toBeNull();
 });
 it.each(['prazo', 'preço parcial', 'classificação', 'perfil misturado'])('preserva o editor de seções quando há %s', (reason) => {
   let secs = [section('recorrencia', 's1'), section('recorrencia', 's2')];
   let products: { kind: 'venda' | 'servico' | 'recorrencia'; section: number }[] = [{ kind: 'recorrencia', section: 0 }, { kind: 'recorrencia', section: 1 }];
   if (reason === 'prazo') secs[1]!.termMonths = 12;
   if (reason === 'preço parcial') secs[0]!.priceCents = 100000;
   if (reason === 'classificação') secs[0]!.costs = [{ ...cost, category: null }];
   if (reason === 'perfil misturado') { secs = [section('venda', 's1')]; products = [{ kind: 'venda', section: 0 }, { kind: 'servico', section: 0 }]; }
   expect(globalInputFromSections({ ...input, sections: secs }, products)).toBeNull();
 });
});
