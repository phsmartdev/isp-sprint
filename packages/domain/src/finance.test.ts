import { describe, expect, it } from 'vitest';
import { DEFAULT_ECON_SETTINGS as S, annuityFactor, econHeadline, emptyEconInput, financeEngine, fiscalDocRates, irr, npv, paybackMonths, type EconItem } from './finance';

const doc = (percentBp: number, fixedCents = 0) => ({ name: 'Doc', percentBp, fixedCents, complete: true });
const items = (...x: [number, number][]) => x.map(([rev, bp]) => ({ description: `Item ${bp}`, revenueCents: rev, doc: doc(bp) })) as EconItem[];
const near = (v: number | null, x: number, tol = 1) => { expect(v).not.toBeNull(); expect(Math.abs(v! - x)).toBeLessThanOrEqual(tol); };

describe('resolução fiscal', () => {
  it('alíquota ponderada pela receita (exemplo do documento: 10% e 20% em 50/50 = 15%, não 30%)', () => {
    const r = financeEngine({ input: { ...emptyEconInput(), mode: 'pontual' }, items: items([5000, 1000], [5000, 2000]), settings: { ...S, marginTargetBp: 0 }, publicSector: false });
    expect(r.rates.a).toBeCloseTo(0.15, 10);
    expect(r.rates.b).toBeCloseTo(0.85, 10);
  });
  it('tributos vigentes do documento: soma, vigência e desativados', () => {
    const d = { active: true, taxes: [
      { name: 'ISS', percentBp: 500, fixedCents: 0, active: true },
      { name: 'PIS', percentBp: 65, fixedCents: 0, active: true, validTo: '2026-01-01' },
      { name: 'Taxa', percentBp: 0, fixedCents: 350, active: true },
      { name: 'Antigo', percentBp: 900, fixedCents: 0, active: false },
    ] };
    expect(fiscalDocRates(d, '2026-10-28')).toMatchObject({ percentBp: 500, fixedCents: 350, complete: true });
    expect(fiscalDocRates({ ...d, active: false }, '2026-10-28').complete).toBe(false);
  });
});

describe('piso, preço recomendado e indicadores', () => {
  it('venda pontual: P_caixa = (I+F)/b, P_eco com TMA e mês de recebimento, P_margem = (I+F)/(b−m)', () => {
    const input = { ...emptyEconInput(), mode: 'pontual' as const, receiveMonth: 2, capex: [{ description: 'Equipamento', qtyMilli: 1000, unitCents: 85_000 }] };
    const r = financeEngine({ input, items: items([0, 1500]), settings: { ...S, tmaMonthlyBp: 100, marginTargetBp: 2000 }, publicSector: false });
    // b = 1 − 0,15 = 0,85
    near(r.floor.cashCents, 85_000 / 0.85);
    near(r.floor.economicCents, (85_000 * 1.01 ** 2) / 0.85);
    near(r.marginPriceCents, 85_000 / 0.65);
    near(r.recommendedCents, 85_000 / 0.65);
    expect(r.priceSource).toBe('recomendado');
  });
  it('recorrente: D = min(N, D_alvo), anuidade, preço mínimo e recomendado; MC, VPL, TIR e payback no preço dos itens', () => {
    const input = { ...emptyEconInput(), termMonths: 24, capex: [{ description: 'Roteador', qtyMilli: 2000, unitCents: 150_000 }], opex: [{ description: 'Trânsito IP', qtyMilli: 1000, unitCents: 40_000 }] };
    const st = { ...S, tmaMonthlyBp: 150, marginTargetBp: 3500, commissionBp: 500, lossBp: 200 };
    const r = financeEngine({ input, items: items([200_000, 1000]), settings: st, publicSector: false });
    const b = 1 - 0.1 - 0.05 - 0.02;
    expect(r.term).toMatchObject({ N: 24, Dalvo: 6, D: 6 });
    near(r.floor.cashCents, (40_000 + 300_000 / 6) / b);
    near(r.floor.economicCents, (40_000 + 300_000 / annuityFactor(0.015, 6)) / b);
    near(r.marginPriceCents, 40_000 / (b - 0.35));
    const P = 200_000;
    const mc = P - P * 0.1 - P * 0.05 - P * 0.02 - 40_000;
    near(r.kpi!.contributionCents, mc);
    expect(r.kpi!.marginPct).toBeCloseTo((mc / P) * 100, 6);
    const flows = [-300_000, ...Array.from({ length: 24 }, () => mc)];
    near(r.kpi!.npvCents, npv(flows, 0.015));
    expect(r.kpi!.paybackMonths).toBeCloseTo(300_000 / mc, 6);
    expect(npv(flows, r.kpi!.irrMonthly!)).toBeCloseTo(0, 2);
    expect(r.verdict).toBe('viavel');
    expect(econHeadline(r, (c) => `R$ ${(c ?? 0) / 100}`)).toMatch(/volta em .* meses \(limite 6\)/);
  });
  it('trava de segmento: payback acima de 6 meses no privado fica fora da política; no público o limite é 12', () => {
    const input = { ...emptyEconInput(), termMonths: 36, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 900_000 }] };
    const it1 = items([100_000, 0]);
    expect(financeEngine({ input, items: it1, settings: { ...S, marginTargetBp: 0 }, publicSector: false }).verdict).toBe('abaixo_minimo');
    const priv = financeEngine({ input: { ...input, priceCents: 180_000 }, items: it1, settings: { ...S, marginTargetBp: 0, tmaMonthlyBp: 0 }, publicSector: false });
    expect(priv.kpi!.paybackMonths).toBeCloseTo(5, 6);
    const slow = financeEngine({ input: { ...input, priceCents: 100_000 }, items: it1, settings: { ...S, marginTargetBp: 0, tmaMonthlyBp: 0 }, publicSector: true });
    expect(slow.term.Dalvo).toBe(12);
    expect(slow.kpi!.paybackMonths).toBeCloseTo(9, 6);
    expect(slow.withinPolicy).toBe(true);
  });
  it('ressalvas: item sem documento fiscal calcula sem o tributo e marca a proposta', () => {
    const r = financeEngine({ input: emptyEconInput(), items: [{ description: 'Link', revenueCents: 100_000, doc: null }], settings: S, publicSector: false });
    expect(r.withReservations).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/sem documento fiscal/);
  });
  it('deduções ≥ 100%: inviável', () => {
    const r = financeEngine({ input: { ...emptyEconInput(), commissionBp: 6000, lossBp: 5000 }, items: items([100_000, 0]), settings: S, publicSector: false });
    expect(r.verdict).toBe('inviavel');
    expect(r.floor.minCents).toBeNull();
  });
});

describe('fluxo de caixa', () => {
  it('payback interpolado e TIR', () => {
    expect(paybackMonths([-100, 40, 40, 40])).toBeCloseTo(2.5, 10);
    expect(paybackMonths([0, 10])).toBe(0);
    expect(paybackMonths([-100, 10, 10])).toBeNull();
    expect(irr([-100, 110])).toBeCloseTo(0.1, 6);
    expect(irr([10, 10])).toBeNull();
    expect(annuityFactor(0, 6)).toBe(6);
  });
});
