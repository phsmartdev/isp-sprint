import { describe, expect, it } from 'vitest';
import { emptyEconInput, financeEngine, fiscalDocRates, type EconItem, type EconSettings, type FiscalTax } from './finance';
import { docTaxesForYear, fiscalEnvelopeErrors, pickFiscalEnvelope, regimeOfYear, type FiscalEnvelope } from './fiscalEnvelope';

const S: EconSettings = { marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 9000, tmaMonthlyBp: 150, commissionBp: 0, lossPrivateBp: 300, lossPublicBp: 300, badDebtBp: 100, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, overheadBp: 2000, incomeTaxBp: 3400, netMarginTargetBp: 4000 };
const B = 'branch-1';
const tx = (name: string, percentBp: number): FiscalTax => ({ name, percentBp, fixedCents: 0, active: true });
const env = (year: number, values: FiscalEnvelope['values'], extra: Partial<FiscalEnvelope> = {}): FiscalEnvelope => ({ id: `e${year}`, branchId: B, year, values, createdAt: '2026-11-01T00:00:00Z', ...extra });
const E26 = env(2026, { profitTaxBp: 1100, retentions: { irrf: 150, csrf: 465, issRetido: 500 } });
const E27 = env(2027, { profitTaxBp: 1500 });
// documento com tributos base (cadastro atual) e por ano
const raw = { taxes: [tx('ISS', 500), tx('PIS', 65), tx('COFINS', 300)], taxesByYear: { '2026': [tx('ISS', 500), tx('PIS', 65), tx('COFINS', 300)], '2027': [tx('ISS', 500), tx('CBS', 880), tx('IBS', 10)] } };
const items = (r = raw): EconItem[] => [{ description: 'Link', revenueCents: 0, kind: 'recorrencia', doc: { id: 'd', name: 'NFS-E · Nota de serviço', percentBp: 865, fixedCents: 0, complete: true, fiscalKind: 'servico', raw: r } }];
const input = (over = {}) => ({ ...emptyEconInput(), termMonths: 12, paybackMonths: 3, capex: [{ description: 'Implantação', qtyMilli: 1000, unitCents: 1_000_000 }], ...over });
const run = (over = {}, envs = [E26, E27], it = items()) => financeEngine({ input: input(over), items: it, settings: S, publicSector: false, fiscal: { envelopes: envs, branchId: B, today: '2026-11-05' } });

describe('envelope fiscal por vigência (documentos fiscais por ano + DRE e retenções da empresa)', () => {
  it('regime pelo ano (só rótulo) e validação do envelope', () => {
    expect(regimeOfYear(2026)).toBe('tradicional');
    expect(regimeOfYear(2027)).toBe('reforma');
    expect(fiscalEnvelopeErrors({ year: 2027, values: { profitTaxBp: 1500 } })).toEqual([]);
    expect(fiscalEnvelopeErrors({ year: 2019, values: { profitTaxBp: 1500 } }).join(' ')).toMatch(/Vigência/);
    expect(fiscalEnvelopeErrors({ year: 2027, values: { profitTaxBp: 1500, retentions: { irrf: -1 } } }).join(' ')).toMatch(/IRRF/);
  });
  it('tributos do documento no ano: o do maior ano até ele; sem nenhum, o cadastro base', () => {
    expect(docTaxesForYear(raw, 2027).fromYear).toBe(2027);
    expect(docTaxesForYear(raw, 2029).fromYear).toBe(2027);
    expect(docTaxesForYear(raw, 2025)).toMatchObject({ fromYear: null });
    expect(docTaxesForYear({ taxes: [tx('ISS', 500)] }, 2027)).toMatchObject({ fromYear: null });
  });
  it('envelope da empresa: maior ano até a vigência; outra empresa não', () => {
    expect(pickFiscalEnvelope([E26, E27], { branchId: B, year: 2026 })?.id).toBe('e2026');
    expect(pickFiscalEnvelope([E26, E27], { branchId: B, year: 2029 })?.id).toBe('e2027');
    expect(pickFiscalEnvelope([E26, E27], { branchId: 'outra', year: 2027 })).toBeNull();
    const newer = env(2026, { profitTaxBp: 1200 }, { id: 'e2026b', createdAt: '2026-11-04T00:00:00Z' });
    expect(pickFiscalEnvelope([E26, newer], { branchId: B, year: 2026 })?.id).toBe('e2026b');
  });
  it('a carga da cesta vem dos tributos do ano (mesma matemática) e o IR/CSLL da empresa no ano', () => {
    const r26 = run({ fiscalYear: 2026 });
    expect(r26.fiscal).toMatchObject({ year: 2026, regime: 'tradicional', envelope: { id: 'e2026' }, profitTaxBp: 1100, profitTaxSource: 'envelope' });
    expect(r26.rates.a).toBeCloseTo(0.0865, 10);
    const r27 = run({ fiscalYear: 2027 });
    expect(r27.fiscal).toMatchObject({ year: 2027, regime: 'reforma', envelope: { id: 'e2027' }, profitTaxBp: 1500, docs: [{ fromYear: 2027, percentBp: 1390 }] });
    expect(r27.rates.a).toBeCloseTo(0.139, 10);
    expect(r27.suggestedCents!).toBeGreaterThan(r26.suggestedCents!);
    const s = r27.statement!;
    expect(s.month.incomeTax).toBe(Math.round(Math.max(0, s.month.operating!) * 0.15));
    expect(s.after!.incomeTax).toBe(Math.round(Math.max(0, s.after!.operating!) * 0.15));
    expect(r27.recommendation!.contributionPct!).toBeCloseTo(40 / 0.85 + 24, 6);
    expect(r26.recommendation!.contributionPct!).toBeCloseTo(40 / 0.89 + 24, 6);
    // sem ano informado: o ano corrente
    expect(run().fiscal!.year).toBe(2026);
  });
  it('retenções (camada 3) não mudam preço, DRE nem recomendação; retenção no documento fica fora da carga', () => {
    const a = run({ fiscalYear: 2026 });
    const b = run({ fiscalYear: 2026 }, [env(2026, { profitTaxBp: 1100 }), E27]);
    expect(a.fiscal!.retentions.map((x) => x.code)).toEqual(['irrf', 'csrf', 'issRetido']);
    expect(b.fiscal!.retentions).toEqual([]);
    expect(a.suggestedCents).toBe(b.suggestedCents);
    expect(a.statement).toEqual(b.statement);
    const doc = { active: true, taxes: [tx('ISS', 500), tx('IRRF', 150), tx('ISS retido', 500), tx('CSRF', 465)] };
    expect(fiscalDocRates(doc, '2026-11-05')).toMatchObject({ percentBp: 500, withholdings: ['IRRF', 'ISS retido', 'CSRF'] });
  });
  it('ano sem tributos próprios usa o anterior, com aviso; sem envelope da empresa, IR/CSLL dos parâmetros', () => {
    const r = run({ fiscalYear: 2028 }, [E26]);
    expect(r.fiscal).toMatchObject({ year: 2028, envelope: { id: 'e2026' }, docs: [{ fromYear: 2027 }] });
    expect(r.warnings.join(' ')).toMatch(/não tem tributos cadastrados para 2028: valem os de 2027/);
    const n = run({ fiscalYear: 2026 }, []);
    expect(n.fiscal).toMatchObject({ envelope: null, profitTaxSource: 'parametros', profitTaxBp: 3400 });
    expect(n.warnings.join(' ')).toMatch(/Sem DRE e retenções da empresa para 2026/);
  });
});
