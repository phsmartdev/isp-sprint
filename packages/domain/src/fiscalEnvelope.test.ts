import { describe, expect, it } from 'vitest';
import { emptyEconInput, financeEngine, fiscalDocRates, type EconItem, type EconSettings } from './finance';
import { envelopeTaxesOf, fiscalEnvelopeErrors, pickFiscalEnvelope, regimeOfYear, type FiscalEnvelope } from './fiscalEnvelope';

const S: EconSettings = { marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 9000, tmaMonthlyBp: 150, commissionBp: 0, lossPrivateBp: 300, lossPublicBp: 300, badDebtBp: 100, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, overheadBp: 2000, incomeTaxBp: 3400, netMarginTargetBp: 4000 };
const B = 'branch-1', IBGE = '2800308';
const env = (year: number, values: FiscalEnvelope['values'], extra: Partial<FiscalEnvelope> = {}): FiscalEnvelope => ({ id: `e${year}`, branchId: B, ibgeCode: IBGE, year, values, createdAt: '2026-11-01T00:00:00Z', ...extra });
const E26 = env(2026, { taxes: { servico: { pis: 65, cofins: 300, iss: 500 } }, profitTaxBp: 1100, retentions: { irrf: 150, csrf: 465, issRetido: 500 } });
const E27 = env(2027, { taxes: { servico: { cbs: 880, ibs: 10, iss: 500 } }, profitTaxBp: 1500 });
const item = (doc: Partial<NonNullable<EconItem['doc']>> = {}): EconItem[] => [{ description: 'Link', revenueCents: 0, kind: 'recorrencia', doc: { id: 'd', name: 'NFS-e', percentBp: 1200, fixedCents: 0, complete: true, fiscalKind: 'servico', ...doc } }];
const input = (over = {}) => ({ ...emptyEconInput(), termMonths: 12, paybackMonths: 3, capex: [{ description: 'Implantação', qtyMilli: 1000, unitCents: 1_000_000 }], ...over });
const run = (over = {}, envs = [E26, E27], it = item()) => financeEngine({ input: input(over), items: it, settings: S, publicSector: false, fiscal: { envelopes: envs, branchId: B, defaultIbge: IBGE, today: '2026-11-05' } });

describe('envelope fiscal por vigência', () => {
  it('schema por chave temporal: até 2026 PIS/COFINS; de 2027 CBS/IBS no lugar (ICMS/ISS seguem)', () => {
    expect(regimeOfYear(2026)).toBe('tradicional');
    expect(regimeOfYear(2027)).toBe('reforma');
    expect(envelopeTaxesOf('tradicional')).toEqual(expect.arrayContaining(['pis', 'cofins', 'icms', 'iss', 'fecoep']));
    expect(envelopeTaxesOf('reforma')).not.toContain('pis');
    expect(envelopeTaxesOf('reforma')).toEqual(expect.arrayContaining(['cbs', 'ibs', 'das', 'icms', 'iss']));
    expect(fiscalEnvelopeErrors({ year: 2027, ibgeCode: IBGE, values: { taxes: { servico: { pis: 65 } }, profitTaxBp: 1500 } }).join(' ')).toMatch(/PIS não existe na vigência 2027/);
    expect(fiscalEnvelopeErrors({ year: 2026, ibgeCode: IBGE, values: { taxes: { servico: { cbs: 90 } }, profitTaxBp: 1500 } }).join(' ')).toMatch(/CBS não existe na vigência 2026/);
    expect(fiscalEnvelopeErrors({ year: 2026, ibgeCode: '123', values: { taxes: {}, profitTaxBp: null } }).join(' ')).toMatch(/IBGE/);
    expect(fiscalEnvelopeErrors({ year: 2027, ibgeCode: IBGE, values: E27.values })).toEqual([]);
  });
  it('escolha da chave: maior ano até a vigência, no mesmo regime e município; 2027 nunca usa 2026', () => {
    expect(pickFiscalEnvelope([E26, E27], { branchId: B, ibgeCode: IBGE, year: 2026 })?.id).toBe('e2026');
    expect(pickFiscalEnvelope([E26, E27], { branchId: B, ibgeCode: IBGE, year: 2029 })?.id).toBe('e2027');
    expect(pickFiscalEnvelope([E26], { branchId: B, ibgeCode: IBGE, year: 2027 })).toBeNull();
    expect(pickFiscalEnvelope([E26, E27], { branchId: B, ibgeCode: '2803500', year: 2026 })).toBeNull();
    const newer = env(2026, { ...E26.values, profitTaxBp: 1200 }, { id: 'e2026b', createdAt: '2026-11-04T00:00:00Z' });
    expect(pickFiscalEnvelope([E26, newer], { branchId: B, ibgeCode: IBGE, year: 2026 })?.id).toBe('e2026b');
  });
  it('a carga da cesta vem da chave ativa (mesma matemática do markup) e o IR/CSLL da alíquota efetiva do envelope', () => {
    const r26 = run();
    expect(r26.fiscal).toMatchObject({ year: 2026, regime: 'tradicional', envelope: { id: 'e2026' }, profitTaxBp: 1100, profitTaxSource: 'envelope' });
    expect(r26.rates.a).toBeCloseTo(0.0865, 10); // PIS 0,65 + COFINS 3 + ISS 5
    const r27 = run({ fiscalYear: 2027 });
    expect(r27.fiscal).toMatchObject({ year: 2027, regime: 'reforma', envelope: { id: 'e2027' }, profitTaxBp: 1500 });
    expect(r27.rates.a).toBeCloseTo(0.139, 10); // CBS 8,8 + IBS 0,1 + ISS 5
    expect(r27.suggestedCents!).toBeGreaterThan(r26.suggestedCents!);
    // IR/CSLL da DRE (meses 1..D e D+1..N) com a alíquota do envelope
    const s = r27.statement!;
    expect(s.month.incomeTax).toBe(Math.round(Math.max(0, s.month.operating!) * 0.15));
    expect(s.after!.incomeTax).toBe(Math.round(Math.max(0, s.after!.operating!) * 0.15));
    // target seeking com a alíquota dinâmica: 40% ÷ (1 − 15%) + 20% + 3% + 1%
    expect(r27.recommendation!.contributionPct!).toBeCloseTo(40 / 0.85 + 24, 6);
    expect(r26.recommendation!.contributionPct!).toBeCloseTo(40 / 0.89 + 24, 6);
  });
  it('retenções na fonte (camada 3) não mudam preço, DRE nem recomendação', () => {
    const a = run();
    const b = run({}, [env(2026, { ...E26.values, retentions: {} }), E27]);
    expect(a.fiscal!.retentions.map((x) => x.code)).toEqual(['irrf', 'csrf', 'issRetido']);
    expect(b.fiscal!.retentions).toEqual([]);
    expect(a.suggestedCents).toBe(b.suggestedCents);
    expect(a.statement).toEqual(b.statement);
    expect(a.recommendation).toEqual(b.recommendation);
    // retenção cadastrada no próprio documento fiscal também fica fora da carga da nota
    const doc = { active: true, taxes: [{ name: 'ISS', percentBp: 500, fixedCents: 0, active: true }, { name: 'IRRF', percentBp: 150, fixedCents: 0, active: true }, { name: 'ISS retido', percentBp: 500, fixedCents: 0, active: true }, { name: 'CSRF', percentBp: 465, fixedCents: 0, active: true }] };
    expect(fiscalDocRates(doc, '2026-11-05')).toMatchObject({ percentBp: 500, withholdings: ['IRRF', 'ISS retido', 'CSRF'] });
  });
  it('sem envelope da chave: tributos do documento e IR/CSLL dos parâmetros, com aviso', () => {
    const r = run({ fiscalYear: 2027 }, [E26]);
    expect(r.fiscal).toMatchObject({ envelope: null, regime: 'reforma', profitTaxSource: 'parametros', profitTaxBp: 3400 });
    expect(r.rates.a).toBeCloseTo(0.12, 10);
    expect(r.warnings.join(' ')).toMatch(/Sem envelope fiscal de 2027/);
    // outro município, informado na simulação
    expect(run({ municipalityIbge: '2803500' }).fiscal!.envelope).toBeNull();
  });
});
