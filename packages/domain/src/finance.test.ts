import { describe, expect, it } from 'vitest';
import { parseCostTable, shiftMonth, annuityFactor, consolidateCashflow, econDre, econHeadline, econMemory, emptyEconInput, financeEngine, fiscalDocRates, irr, npv, paybackMonths, type EconItem, type EconSettings } from './finance';

/** Parâmetros de teste (na aplicação eles vêm de Configurações → Viabilidade, sem padrão no código). */
const S: EconSettings = { marginTargetBp: 3500, tmaMonthlyBp: 150, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true };

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
    // sem preço informado e sem receita nos produtos: não se inventa preço
    expect(r.priceCents).toBeNull();
    expect(r.verdict).toBe('sem_preco');
  });
  it('recorrente: D = min(N, D_alvo), anuidade, preço mínimo e recomendado; MC, VPL, TIR e payback no preço dos itens', () => {
    const input = { ...emptyEconInput(), termMonths: 24, capex: [{ description: 'Roteador', qtyMilli: 2000, unitCents: 150_000 }], opex: [{ description: 'Trânsito IP', qtyMilli: 1000, unitCents: 40_000 }] };
    const st = { ...S, tmaMonthlyBp: 150, marginTargetBp: 3500, commissionBp: 500, lossPrivateBp: 200 };
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
    expect(r.kpi!.simplePaybackMonths).toBeCloseTo(300_000 / mc, 6);
    expect(r.kpi!.paybackMonths).toBeCloseTo(paybackMonths(flows, 0.015)!, 6);
    expect(r.kpi!.paybackMonths!).toBeGreaterThan(r.kpi!.simplePaybackMonths!);
    expect(npv(flows, r.kpi!.irrMonthly!)).toBeCloseTo(0, 2);
    expect(r.verdict).toBe('viavel');
    expect(econHeadline(r, (c) => `R$ ${(c ?? 0) / 100}`)).toMatch(/volta em .* meses, já descontada a TMA \(limite 6\)/);
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

describe('decisões da diretoria (29/10)', () => {
  const rec = (over: Partial<ReturnType<typeof emptyEconInput>> = {}) => ({ ...emptyEconInput(), termMonths: 24, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 500_000 }], ...over });
  it('margem é mínima: abaixo dela a venda sai da política', () => {
    const it1 = items([100_000, 0]);
    // MC = 100.000 − 70.000 = 30.000 → margem 30% < 35%
    const r = financeEngine({ input: rec({ capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 60_000 }], opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 70_000 }] }), items: it1, settings: { ...S, tmaMonthlyBp: 0 }, publicSector: false });
    expect(r.kpi!.marginPct).toBeCloseTo(30, 6);
    expect(r.marginOk).toBe(false);
    expect(r.withinPolicy).toBe(false);
    expect(r.verdict).toBe('abaixo_recomendado');
    const ok = financeEngine({ input: rec({ capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 60_000 }], opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 60_000 }] }), items: it1, settings: { ...S, tmaMonthlyBp: 0 }, publicSector: false });
    expect(ok.marginOk).toBe(true);
    expect(ok.verdict).toBe('viavel');
  });
  it('preço sem informar = total dos produtos; sem produtos, sem preço', () => {
    expect(financeEngine({ input: rec(), items: items([80_000, 0]), settings: S, publicSector: false }).priceCents).toBe(80_000);
    const none = financeEngine({ input: rec(), items: [], settings: S, publicSector: false });
    expect(none.priceCents).toBeNull();
    expect(none.verdict).toBe('sem_preco');
  });
  it('a trava usa o payback descontado: 5,9 meses simples passa de 6 com TMA de 3%', () => {
    // I = 500.000, MC = 85.000/mês → simples 5,88; descontado a 3% passa de 6
    const r = financeEngine({ input: rec(), items: items([85_000, 0]), settings: { ...S, marginTargetBp: 0, tmaMonthlyBp: 300 }, publicSector: false });
    expect(r.kpi!.simplePaybackMonths!).toBeLessThan(6);
    expect(r.kpi!.paybackMonths!).toBeGreaterThan(6);
    expect(r.paybackOk).toBe(false);
    expect(r.verdict === 'fora_politica' || r.verdict === 'abaixo_minimo').toBe(true);
  });
  it('tributo fixo uma vez por fatura (documento), não por item', () => {
    const fixed = (id: string) => ({ id, name: id, percentBp: 0, fixedCents: 1_000, complete: true });
    const same = financeEngine({ input: rec(), items: [{ description: 'A', revenueCents: 50_000, doc: fixed('nfse') }, { description: 'B', revenueCents: 50_000, doc: fixed('nfse') }], settings: S, publicSector: false });
    expect(same.fixedTaxCents).toBe(1_000);
    const two = financeEngine({ input: rec(), items: [{ description: 'A', revenueCents: 50_000, doc: fixed('nfse') }, { description: 'B', revenueCents: 50_000, doc: fixed('nfcom') }], settings: S, publicSector: false });
    expect(two.fixedTaxCents).toBe(2_000);
  });
  it('glosa por segmento e contingência sobre investimento e custo mensal', () => {
    const st = { ...S, lossPrivateBp: 100, lossPublicBp: 400, contingencyCapexBp: 1000, contingencyOpexBp: 500 };
    const input = rec({ opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 10_000 }] });
    const priv = financeEngine({ input, items: items([100_000, 0]), settings: st, publicSector: false });
    const pub = financeEngine({ input, items: items([100_000, 0]), settings: st, publicSector: true });
    expect(priv.rates.g).toBeCloseTo(0.01, 10);
    expect(pub.rates.g).toBeCloseTo(0.04, 10);
    expect(priv.capexContingencyCents).toBe(50_000);
    expect(priv.initialCents).toBe(550_000);
    expect(priv.opexContingencyCents).toBe(500);
    expect(priv.monthlyCostCents).toBe(10_500);
    expect(priv.cashflow[0]).toBe(-550_000);
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

describe('fluxo de caixa consolidado', () => {
  it('alinha cada oportunidade no seu mês e acumula', () => {
    const c = consolidateCashflow([
      { startMonth: '2026-11', flows: [-1000, 300, 300, 300, 300] },
      { startMonth: '2027-01', flows: [-500, 200, 200] },
    ]);
    expect(c.months).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
    expect(c.net).toEqual([-1000, 300, -200, 500, 500]);
    expect(c.outflow[2]).toBe(-500);
    expect(c.inflow[2]).toBe(300);
    expect(c.cumulative.at(-1)).toBe(100);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(consolidateCashflow([]).months).toEqual([]);
  });
});

describe('tabela de custos (colar do Excel / importar)', () => {
  const t = [
    ['ITEM', 'DESCRIÇÃO', 'UNIDADE', 'QUANTIDADE', 'VALOR UNITÁRIO', 'VALOR TOTAL'],
    ['1', 'Cabo 01FO', 'm', '8400', 'R$ 1,50', 'R$ 12.600,00'],
    ['2', 'ONU Bridge', 'und', '21', 'R$ 200,00', 'R$ 4.200,00'],
    ['10', 'Elaboração de projeto FTTx', 'hh', '42', 'R$ 120,00', 'R$ 5.040,00'],
    ['13', 'IPs Públicos', 'und', 4, 30, 120],
    ['', '', '', '', '', ''],
    ['14', 'Sem quantidade', 'und', '', 'R$ 10,00', ''],
  ];
  it('lê com títulos (planilha da diretoria) e recusa linha sem quantidade', () => {
    const r = parseCostTable(t);
    expect(r.missing).toEqual([]);
    expect(r.lines.map((l) => [l.description, l.unit, l.qtyMilli, l.unitCents])).toEqual([
      ['Cabo 01FO', 'm', 8_400_000, 150], ['ONU Bridge', 'und', 21_000, 20_000], ['Elaboração de projeto FTTx', 'hh', 42_000, 12_000], ['IPs Públicos', 'und', 4_000, 3_000],
    ]);
    expect(r.errors).toEqual([{ row: 7, message: 'quantidade inválida em Sem quantidade' }]);
  });
  it('sem títulos, pela posição; milhar "8.400"; valor pelo total quando falta o unitário', () => {
    const r = parseCostTable([['1', 'Cabo 01FO', 'm', '8.400', '', 'R$ 12.600,00']]);
    expect(r.lines[0]).toMatchObject({ qtyMilli: 8_400_000, unitCents: 150 });
    expect(parseCostTable([['Roteador', '2', '350,00']]).lines[0]).toMatchObject({ description: 'Roteador', qtyMilli: 2_000, unitCents: 35_000 });
  });
});

describe('TMA alta (caso real de 29/10: 50% ao mês)', () => {
  it('payback simples volta em 3,8 meses, o descontado não; a frase explica o porquê', () => {
    const S2: EconSettings = { marginTargetBp: 2500, tmaMonthlyBp: 5000, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 5, paybackMaxPublic: 12, blockOutsidePolicy: true };
    const r = financeEngine({ input: { ...emptyEconInput(), termMonths: 12, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 4_979_000 }], priceCents: 1_316_973 }, items: [], settings: S2, publicSector: false });
    expect(r.kpi!.simplePaybackMonths).toBeCloseTo(3.78, 2);
    expect(r.kpi!.paybackMonths).toBeNull();
    expect(Math.round(r.kpi!.npvCents / 100)).toBe(-23_654);
    expect(econHeadline(r, (c) => `R$ ${(c ?? 0) / 100}`)).toMatch(/TMA de 50% ao mês .* voltaria em 3,8 meses/);
  });
});

describe('cadeia de margens', () => {
  const rec = { ...emptyEconInput(), termMonths: 12, capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 120_000 }], opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 20_000 }] };
  it('contribuição → operacional (− amortização − despesas fixas) → líquida (− IR/CSLL)', () => {
    // P = 100.000, tributos 10%, comissão 5% → MC = 100.000 − 10.000 − 5.000 − 20.000 = 65.000
    const r = financeEngine({ input: rec, items: items([100_000, 1000]), settings: { ...S, commissionBp: 500, overheadBp: 1000, incomeTaxBp: 3400 }, publicSector: false });
    const m = r.kpi!.margins!;
    expect(r.kpi!.contributionCents).toBe(65_000);
    expect(m.amortizationCents).toBe(10_000); // 120.000 ÷ 12
    expect(m.overheadCents).toBe(10_000);
    expect(m.operatingCents).toBe(45_000);
    expect(m.incomeTaxCents).toBe(15_300); // 34% de 45.000
    expect(m.netCents).toBe(29_700);
    near(m.netPct, 29.7, 1e-9);
    // margem operacional zero: (20.000 + 10.000) ÷ (1 − 0,10 − 0,05 − 0,10) = 40.000; a margem mínima (35%) pede mais
    near(r.operatingFloorCents!, 40_000);
    near(r.marginPriceCents, 20_000 / (0.85 - 0.35));
    expect(r.suggestedMinCents).toBe(Math.max(r.floor.minCents!, r.marginPriceCents!, r.operatingFloorCents!));
    const dre = econDre(r, String);
    expect(dre.map((x) => x.label)).toEqual(expect.arrayContaining(['Margem de contribuição', 'Margem operacional', 'IR/CSLL', 'Margem líquida']));
    expect(dre.find((x) => x.label === 'Margem líquida')!.total).toBe(65_000 * 12 - 120_000 - 10_000 * 12 - 15_300 * 12);
  });
  it('IR/CSLL só sobre resultado operacional positivo', () => {
    const r = financeEngine({ input: rec, items: items([30_000, 1000]), settings: { ...S, overheadBp: 1000, incomeTaxBp: 3400 }, publicSector: false });
    expect(r.kpi!.margins!.operatingCents).toBeLessThan(0);
    expect(r.kpi!.margins!.incomeTaxCents).toBe(0);
  });
  it('sem despesas fixas e IR/CSLL nos parâmetros: não calcula operacional nem líquida e avisa', () => {
    const r = financeEngine({ input: rec, items: items([100_000, 1000]), settings: S, publicSector: false });
    expect(r.kpi!.margins!.operatingCents).toBeNull();
    expect(r.kpi!.margins!.netCents).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/margem operacional e líquida não calculadas/);
    expect(econDre(r, String).some((x) => x.label === 'Margem líquida')).toBe(false);
  });
});

describe('memória de cálculo', () => {
  it('passos com fórmulas e o comparativo histórico do documento (×3,2: sobra 68,75%, margem real 36,75%)', () => {
    // NFCOM com 30% de tributos e 2% de comissão; custo mensal R$ 3.200,00
    const input = { ...emptyEconInput(), termMonths: 12, opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 320_000 }], capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 600_000 }] };
    const r = financeEngine({ input, items: items([1_292_500, 3000]), settings: { ...S, commissionBp: 200, marginTargetBp: 3000, tmaMonthlyBp: 0 }, publicSector: false });
    const steps = econMemory(r, (c) => `R$ ${(c / 100).toFixed(2)}`, { legacy: { recurringX100: 320, oneTimeX100: 250 } });
    expect(steps.map((s) => s.key)).toEqual(['entradas', 'preco', 'historico', 'fluxo', 'decisao']);
    const hist = steps.find((s) => s.key === 'historico')!;
    expect(hist.rows[0]!.value).toBe('R$ 10240.00/mês');
    expect(hist.rows[1]!.value).toBe('68,75%');
    expect(hist.rows[2]!.value).toBe('36,8%'); // 36,75% arredondado a 1 casa
    const fluxo = steps.find((s) => s.key === 'fluxo')!;
    const roi = fluxo.rows.find((x) => x.label === 'ROI')!;
    const k = r.kpi!;
    expect(roi.value).toBe(`${(((k.contributionCents * 12 - 600_000) / 600_000) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
    expect(steps.at(-1)!.rows.at(-1)).toMatchObject({ label: 'Resultado', ok: true });
    // sem fator configurado, o comparativo não aparece
    expect(econMemory(r, String).some((s) => s.key === 'historico')).toBe(false);
  });
});
