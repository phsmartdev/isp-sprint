import { describe, expect, it } from 'vitest';
import { econCompare, financeEngineDetailed, parseCostTable, shiftMonth, consolidateCashflow, econDre, econHeadline, econMemory, emptyEconInput, financeEngine, fiscalDocRates, type EconItem, type EconSettings, applyNetMarginRule } from './finance';
import { npv as npvF } from './formula';
import { annuityFactor, irr, npv, paybackMonths } from './formula';

/** Parâmetros de teste (na aplicação eles vêm de Configurações → Viabilidade, sem padrão no código). */
const S: EconSettings = { marginTargetBp: 3500, tmaMonthlyBp: 150, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true };

const doc = (percentBp: number, fixedCents = 0) => ({ name: 'Doc', percentBp, fixedCents, complete: true });
const items = (...x: [number, number][]) => x.map(([rev, bp]) => ({ description: `Item ${bp}`, revenueCents: rev, doc: doc(bp) })) as EconItem[];
/** avaliação num preço dado (o que a decisão usa no preço proposto) */
const evalAt = (a: Parameters<typeof financeEngine>[0]) => financeEngineDetailed(a).result;
const near = (v: number | null, x: number, tol = 1) => { expect(v).not.toBeNull(); expect(Math.abs(v! - x)).toBeLessThanOrEqual(tol); };

describe('resolução fiscal', () => {
  it('lotes (11/2026): no mesmo lote vale o documento de maior tributo; entre lotes, ponderado pela receita', () => {
    // mesmo lote (venda), 10% e 20%: vale o maior, 20%
    const same = financeEngine({ input: { ...emptyEconInput(), mode: 'pontual' }, items: items([5000, 1000], [5000, 2000]), settings: { ...S, marginTargetBp: 0 }, publicSector: false });
    expect(same.rates.a).toBeCloseTo(0.2, 10);
    expect(same.lots).toEqual([expect.objectContaining({ lot: 'venda', percentBp: 2000, items: 2 })]);
    expect(same.items.map((i) => i.percentBp)).toEqual([2000, 2000]);
    // Lote Venda 10% e Lote Serviço (serviço único) 20%, 50/50: 15%
    const [v, sv] = items([5000, 1000], [5000, 2000]);
    const two = financeEngine({ input: { ...emptyEconInput(), mode: 'pontual' }, items: [{ ...v!, kind: 'venda' }, { ...sv!, kind: 'servico' }], settings: { ...S, marginTargetBp: 0 }, publicSector: false });
    // cestas (3.0): cada cesta com o seu teto e o seu preço; nada de média entre cestas
    expect(two.lots!.map((l) => [l.lot, l.percentBp])).toEqual([['venda', 1000], ['servico', 2000]]);
    expect(two.deal!.cells.map((c) => [c.key, c.taxPct])).toEqual([['unico:venda', 10], ['unico:servico', 20]]);
    // documento de serviço (natureza) leva o produto para a Cesta de Serviços mesmo marcado como venda
    const nat = financeEngine({ input: { ...emptyEconInput(), mode: 'pontual' }, items: [{ ...v!, kind: 'venda', doc: { ...v!.doc!, fiscalKind: 'venda' } }, { ...sv!, kind: 'venda', doc: { ...sv!.doc!, fiscalKind: 'servico' } }], settings: { ...S, marginTargetBp: 0 }, publicSector: false });
    expect(nat.deal!.cells.map((c) => [c.lot, c.taxPct])).toEqual([['venda', 10], ['servico', 20]]);
    // produto sem documento usa o do lote (e não fica pendente)
    const noDoc = financeEngine({ input: { ...emptyEconInput(), mode: 'pontual' }, items: [{ ...v!, kind: 'venda' }, { description: 'Sem NF', revenueCents: 5000, kind: 'venda', doc: null }], settings: { ...S, marginTargetBp: 0 }, publicSector: false });
    expect(noDoc.rates.a).toBeCloseTo(0.1, 10);
    expect(noDoc.withReservations).toBe(false);
    expect(noDoc.warnings.join(' ')).toMatch(/1 produto\(s\) sem documento fiscal próprio/);
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
  it('venda pontual: preço = (I + E + F) ÷ (1 − tributos − despesas variáveis − margem); glosa fora do preço; sem preço proposto a decisão usa o sugerido', () => {
    const input = { ...emptyEconInput(), mode: 'pontual' as const, receiveMonth: 2, capex: [{ description: 'Equipamento', qtyMilli: 1000, unitCents: 85_000 }] };
    const st = { ...S, tmaMonthlyBp: 100, marginTargetBp: 2000, lossPrivateBp: 500, badDebtBp: 300, variableExpenseBp: 500 };
    const r = financeEngine({ input, items: items([0, 1500]), settings: st, publicSector: false });
    // D = 1 − (15% + 5% + 20%) = 60%; glosa e inadimplência não mudam o preço
    near(r.suggestedCents!, 85_000 / 0.6);
    near(r.floor.minCents, 85_000 / 0.6);
    expect(financeEngine({ input, items: items([0, 1500]), settings: { ...st, lossPrivateBp: 0, badDebtBp: 0 }, publicSector: false }).suggestedCents).toBe(r.suggestedCents);
    expect(r.priceCents).toBe(r.suggestedCents);
    expect(r.kpi!.marginPct).toBeCloseTo(20, 2);
    expect(r.decision).toMatchObject({ basis: 'sugerido', source: 'motor', verdict: 'viavel' });
    // comissão não entra mais (a empresa não paga comissão por venda)
    expect(financeEngine({ input: { ...input, commissionBp: 3000 }, items: items([0, 1500]), settings: { ...st, commissionBp: 3000 }, publicSector: false }).suggestedCents).toBe(r.suggestedCents);
  });
  it('recorrente: C = (I + E) ÷ payback + O protegido; M = (C + F) ÷ (1 − tributos − dv − m); indicadores no sugerido, decisão no proposto', () => {
    const input = { ...emptyEconInput(), termMonths: 24, capex: [{ description: 'Roteador', qtyMilli: 2000, unitCents: 150_000 }], opex: [{ description: 'Trânsito IP', qtyMilli: 1000, unitCents: 40_000 }] };
    const st = { ...S, tmaMonthlyBp: 150, marginTargetBp: 3500, variableExpenseBp: 500, lossPrivateBp: 200, contingencyOpexBp: 1000 };
    const r = financeEngine({ input, items: items([200_000, 1000]), settings: st, publicSector: false });
    expect(r.term).toMatchObject({ N: 24, Dalvo: 6, D: 6 });
    // 3.1: C = parcela da anuidade (300.000 × k(1+k)^6 ÷ ((1+k)^6 − 1), k = 1,5%) + 40.000 × 1,10; D = 1 − (10% + 5% + 35%) = 50%
    const parc = 300_000 / annuityFactor(0.015, 6);
    near(parc, (300_000 * 0.015 * 1.015 ** 6) / (1.015 ** 6 - 1), 1e-6);
    near(r.suggestedCents!, (parc + 44_000) / 0.5);
    expect(r.kpi!.marginPct).toBeCloseTo(35, 2); // centavos arredondados (preço para cima, parcela no centavo)
    expect(r.decision).toMatchObject({ basis: 'proposto', source: 'itens', priceCents: 200_000 });
    // no proposto (200.000): MC = P − tributos − dv − custo − amortização
    expect(r.decision!.marginPct).toBeCloseTo(((200_000 - 20_000 - 10_000 - 44_000 - parc) / 200_000) * 100, 6);
    const p = evalAt({ input, items: items([200_000, 1000]), settings: st, publicSector: false });
    // fluxo mensal = P − glosa − tributos − despesas variáveis − custos (glosa só aqui)
    const fc = 200_000 - 4_000 - 20_000 - 10_000 - 44_000;
    expect(p.kpi!.cashMonthlyCents).toBe(fc);
    const flows = [-300_000, ...Array.from({ length: 24 }, () => fc)];
    near(p.kpi!.npvCents, npv(flows, 0.015));
    expect(p.kpi!.paybackMonths).toBeCloseTo(paybackMonths(flows, 0.015)!, 6);
    expect(npv(flows, p.kpi!.irrMonthly!)).toBeCloseTo(0, 2);
    expect(r.decision!.npvCents).toBe(p.kpi!.npvCents);
    expect(r.verdict).toBe('viavel');
    // payback do vendedor: 3 meses dobra a amortização; acima do teto também vale (o teto fica na aprovação)
    expect(financeEngine({ input: { ...input, paybackMonths: 3 }, items: items([200_000, 1000]), settings: st, publicSector: false }).term.D).toBe(3);
    const over = financeEngine({ input: { ...input, paybackMonths: 10 }, items: items([200_000, 1000]), settings: st, publicSector: false });
    expect(over.term.D).toBe(10);
    expect(over.warnings.join(' ')).toMatch(/acima do teto/);
  });
  it('margem do vendedor fica entre o piso e o teto; sem escolha, vale a sugestão', () => {
    const input = { ...emptyEconInput(), opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 50_000 }] };
    const st = { ...S, marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 4500 };
    expect(financeEngine({ input, items: items([100_000, 0]), settings: st, publicSector: false }).rates.m).toBeCloseTo(0.3, 9);
    const hi = financeEngine({ input: { ...input, marginTargetBp: 6000 }, items: items([100_000, 0]), settings: st, publicSector: false });
    expect(hi.rates.m).toBeCloseTo(0.45, 9);
    expect(hi.warnings.join(' ')).toMatch(/ajustada para 45%/);
    expect(financeEngine({ input: { ...input, marginTargetBp: 1000 }, items: items([100_000, 0]), settings: st, publicSector: false }).rates.m).toBeCloseTo(0.2, 9);
  });
  it('TMA anual vira mensal, inflação reajusta a receita depois do 12º mês e o horizonte limita a projeção', () => {
    const input = { ...emptyEconInput(), termMonths: 60, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 100_000 }] };
    const st = { ...S, marginTargetBp: 0, tmaAnnualBp: 1200, inflationAnnualBp: 500, horizonMaxMonths: 36, badDebtBp: 100, lossPrivateBp: 200 };
    const r = evalAt({ input, items: items([100_000, 0]), settings: st, publicSector: false });
    expect(r.rates.r).toBeCloseTo(1.12 ** (1 / 12) - 1, 12);
    expect(r.term.N).toBe(36);
    expect(r.cashflow).toHaveLength(37);
    const im = 1.05 ** (1 / 12) - 1;
    near(r.cashflow[12]!, 100_000 * (1 - 0.03));
    near(r.cashflow[13]!, 100_000 * (1 + im) * (1 - 0.03));
    expect(r.rates.g).toBeCloseTo(0.03, 12); // glosa 2% + inadimplência 1%
    expect(r.warnings.join(' ')).toMatch(/prazo máximo de previsão/);
  });
  it('entrega e taxa fixa de venda entram no preço sem contingência', () => {
    const input = { ...emptyEconInput(), mode: 'pontual' as const, receiveMonth: 1, priceCents: 300_000, capex: [{ description: 'Cabo', qtyMilli: 1000, unitCents: 100_000, impact: 'material' as const }, { description: 'Frete', qtyMilli: 1000, unitCents: 50_000, impact: 'entrega' as const }] };
    const r = financeEngine({ input, items: items([0, 0]), settings: { ...S, contingencyCapexBp: 1000, marginTargetBp: 0 }, publicSector: false });
    expect(r.initialCents).toBe(110_000);
    expect(r.variableFixedCents).toBe(50_000);
    expect(r.investmentCents).toBe(160_000);
    expect(r.cashflow[0]).toBe(-160_000);
  });
  it('trava de segmento: payback acima de 6 meses no privado fica fora da política; no público o limite é 12', () => {
    const input = { ...emptyEconInput(), termMonths: 36, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 900_000 }] };
    const it1 = items([100_000, 0]);
    expect(financeEngine({ input, items: it1, settings: { ...S, marginTargetBp: 0 }, publicSector: false }).verdict).toBe('abaixo_minimo');
    const priv = financeEngine({ input: { ...input, priceCents: 180_000 }, items: it1, settings: { ...S, marginTargetBp: 0, tmaMonthlyBp: 0 }, publicSector: false });
    expect(priv.decision!.paybackMonths).toBeCloseTo(5, 6);
    const slow = financeEngine({ input: { ...input, priceCents: 100_000 }, items: it1, settings: { ...S, marginTargetBp: 0, tmaMonthlyBp: 0 }, publicSector: true });
    expect(slow.term.Dalvo).toBe(12);
    expect(slow.decision!.paybackMonths).toBeCloseTo(9, 6);
    expect(slow.withinPolicy).toBe(true);
  });
  it('ressalvas: item sem documento fiscal calcula sem o tributo e marca a proposta', () => {
    const r = financeEngine({ input: emptyEconInput(), items: [{ description: 'Link', revenueCents: 100_000, doc: null }], settings: S, publicSector: false });
    expect(r.withReservations).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/sem documento fiscal/);
  });
  it('deduções ≥ 100%: inviável', () => {
    // tributos + despesas variáveis + margem ≥ 100%: nenhum preço fecha o markup
    const r = financeEngine({ input: { ...emptyEconInput(), variableBp: 7000 }, items: items([100_000, 0]), settings: S, publicSector: false });
    expect(r.verdict).toBe('inviavel');
    expect(r.floor.minCents).toBeNull();
  });
});

describe('decisões da diretoria (29/10)', () => {
  const rec = (over: Partial<ReturnType<typeof emptyEconInput>> = {}) => ({ ...emptyEconInput(), termMonths: 24, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 500_000 }], ...over });
  it('margem é mínima: abaixo dela a venda sai da política (margem já com o investimento amortizado no payback)', () => {
    const it1 = items([100_000, 0]);
    // MC = 100.000 − 70.000 − 60.000 ÷ 6 = 20.000 → 20% < 35%
    const r = financeEngine({ input: rec({ capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 60_000 }], opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 70_000 }] }), items: it1, settings: { ...S, tmaMonthlyBp: 0 }, publicSector: false });
    expect(r.decision!.marginPct).toBeCloseTo(20, 6);
    expect(r.kpi!.marginPct).toBeCloseTo(35, 2); // no sugerido, a margem é a escolhida
    expect(r.marginOk).toBe(false);
    // 3.0: o mínimo é o preço da margem no piso; abaixo do piso é abaixo do mínimo
    expect(r.verdict).toBe('abaixo_minimo');
    expect(r.autoApproval!.ok).toBe(false);
    const ok = financeEngine({ input: rec({ capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 60_000 }], opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 50_000 }] }), items: it1, settings: { ...S, tmaMonthlyBp: 0 }, publicSector: false });
    expect(ok.marginOk).toBe(true);
    expect(ok.verdict).toBe('viavel');
  });
  it('preço proposto: informado; senão o total dos produtos; sem nenhum, a decisão usa o sugerido', () => {
    const it8 = financeEngine({ input: rec(), items: items([80_000, 0]), settings: S, publicSector: false });
    expect(it8.decision).toMatchObject({ basis: 'proposto', source: 'itens', priceCents: 80_000 });
    expect(it8.priceCents).toBe(it8.suggestedCents);
    const inf = financeEngine({ input: rec({ priceCents: 90_000 }), items: items([80_000, 0]), settings: S, publicSector: false });
    expect(inf.decision).toMatchObject({ source: 'informado', priceCents: 90_000 });
    const none = financeEngine({ input: rec(), items: [], settings: S, publicSector: false });
    expect(none.decision).toMatchObject({ basis: 'sugerido', priceCents: none.suggestedCents });
  });
  it('produto lançado sem valor: análise no sugerido, que acompanha payback e margem', () => {
    const r = financeEngine({ input: rec(), items: items([0, 0]), settings: S, publicSector: false });
    expect(r.revenueCents).toBe(0);
    expect(r.priceCents).toBe(r.suggestedCents);
    expect(r.kpi).not.toBeNull();
    expect(r.decision!.basis).toBe('sugerido');
    const fast = financeEngine({ input: rec({ paybackMonths: 3 }), items: items([0, 0]), settings: S, publicSector: false });
    expect(fast.priceCents!).toBeGreaterThan(r.priceCents!);
    expect(fast.kpi!.paybackMonths!).toBeLessThan(r.kpi!.paybackMonths!);
    const rich = financeEngine({ input: rec({ marginTargetBp: 6000 }), items: items([0, 0]), settings: { ...S, marginMaxBp: 8000 }, publicSector: false });
    expect(rich.priceCents!).toBeGreaterThan(r.priceCents!);
    expect(rich.kpi!.marginPct).toBeCloseTo(60, 1);
    expect(econHeadline(r, (c) => String(c))).toMatch(/Sem preço proposto: a decisão usa o sugerido/);
  });
  it('payback do vendedor muda a análise inteira (inclusive acima do teto); o teto segue na aprovação pelo retorno real', () => {
    const it0 = items([0, 0]);
    const a = financeEngine({ input: rec({ paybackMonths: 3 }), items: it0, settings: S, publicSector: false });
    const b = financeEngine({ input: rec({ paybackMonths: 12 }), items: it0, settings: S, publicSector: false });
    expect(a.term.D).toBe(3);
    expect(b.term.D).toBe(12); // teto privado é 6: não corta mais
    expect(b.suggestedMinCents!).toBeLessThan(a.suggestedMinCents!);
    expect(b.warnings.join(' ')).toMatch(/acima do teto/);
    // no preço mínimo do payback de 12 meses, o retorno real passa do teto de 6: fora da política
    const atMin = financeEngine({ input: rec({ paybackMonths: 12, priceCents: b.suggestedMinCents }), items: it0, settings: S, publicSector: false });
    expect(atMin.kpi!.margins!.amortizationCents).toBe(Math.round(atMin.investmentCents! / annuityFactor(0.015, 12)));
    expect(atMin.paybackOk).toBe(false);
  });
  it('a trava usa o payback descontado: 5,9 meses simples passa de 6 com TMA de 3%', () => {
    // I = 500.000, MC = 85.000/mês → simples 5,88; descontado a 3% passa de 6
    const r = financeEngine({ input: rec(), items: items([85_000, 0]), settings: { ...S, marginTargetBp: 0, tmaMonthlyBp: 300 }, publicSector: false });
    expect(r.decision!.priceCents).toBe(85_000);
    expect(r.decision!.paybackMonths!).toBeGreaterThan(6);
    // 3.1: no sugerido com margem 0 a parcela da anuidade fecha o payback descontado em exatamente D = 6 meses
    near(r.kpi!.paybackMonths!, 6, 1e-3);
    expect(r.paybackOk).toBe(false);
    expect(r.verdict === 'fora_politica' || r.verdict === 'abaixo_minimo').toBe(true);
  });
  it('tributo fixo uma vez por lote (o documento escolhido do lote), não por item', () => {
    const fixed = (id: string) => ({ id, name: id, percentBp: 0, fixedCents: 1_000, complete: true });
    const same = financeEngine({ input: rec(), items: [{ description: 'A', revenueCents: 50_000, doc: fixed('nfse') }, { description: 'B', revenueCents: 50_000, doc: fixed('nfse') }], settings: S, publicSector: false });
    expect(same.fixedTaxCents).toBe(1_000);
    const two = financeEngine({ input: rec(), items: [{ description: 'A', revenueCents: 50_000, doc: fixed('nfse') }, { description: 'B', revenueCents: 50_000, doc: fixed('nfcom') }], settings: S, publicSector: false });
    // mesmo lote, documentos diferentes com o mesmo percentual: vale um só (o de maior fixo), uma vez
    expect(two.fixedTaxCents).toBe(1_000);
    const lots = financeEngine({ input: { ...rec(), mode: 'pontual' }, items: [{ description: 'A', revenueCents: 50_000, kind: 'venda', doc: fixed('nfe') }, { description: 'B', revenueCents: 50_000, kind: 'servico', doc: fixed('nfse') }], settings: S, publicSector: false });
    expect(lots.fixedTaxCents).toBe(2_000);
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
  it('payback simples volta em 3,8 meses, o descontado não', () => {
    const S2: EconSettings = { marginTargetBp: 2500, tmaMonthlyBp: 5000, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 5, paybackMaxPublic: 12, blockOutsidePolicy: true };
    const args = { input: { ...emptyEconInput(), termMonths: 12, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 4_979_000 }], priceCents: 1_316_973 }, items: [], settings: S2, publicSector: false };
    const p = evalAt(args);
    expect(p.kpi!.simplePaybackMonths).toBeCloseTo(3.78, 2);
    expect(p.kpi!.paybackMonths).toBeNull();
    expect(Math.round(p.kpi!.npvCents / 100)).toBe(-23_654);
    const r = financeEngine(args);
    expect(r.decision).toMatchObject({ basis: 'proposto', paybackMonths: null });
    expect(econHeadline(r, (c) => `R$ ${(c ?? 0) / 100}`)).toMatch(/Decisão no preço proposto de R\$ 13169.73\/mês/);
  });
});

describe('cadeia de margens', () => {
  const rec = { ...emptyEconInput(), termMonths: 12, capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 120_000 }], opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 20_000 }] };
  it('contribuição (com a amortização no payback) → operacional (− glosa − despesas fixas) → líquida (− IR/CSLL)', () => {
    // P = 100.000, tributos 10%, dv 5%, custo 20.000, investimento 120.000 pela anuidade (TMA 1,5%) em 6 meses
    const r = evalAt({ input: rec, items: items([100_000, 1000]), settings: { ...S, variableExpenseBp: 500, overheadBp: 1000, incomeTaxBp: 3400 }, publicSector: false });
    const m = r.kpi!.margins!;
    const am = Math.round(120_000 / annuityFactor(0.015, 6)); // 21.063
    expect(am).toBe(21_063);
    expect(m.amortizationCents).toBe(am);
    expect(r.kpi!.contributionCents).toBe(65_000 - am);
    expect(m.overheadCents).toBe(10_000);
    expect(m.operatingCents).toBe(55_000 - am);
    expect(m.incomeTaxCents).toBe(Math.round((55_000 - am) * 0.34));
    expect(m.netCents).toBe(55_000 - am - Math.round((55_000 - am) * 0.34));
    // depois do payback (mês 7) a amortização zera e a margem sobe
    expect(r.statement!.afterFrom).toBe(7);
    expect(r.statement!.after).toMatchObject({ amortization: 0, contribution: 65_000, operating: 55_000, incomeTax: 18_700, net: 36_300 });
    const dre = econDre(r, String);
    expect(dre.map((x) => x.label)).toEqual(expect.arrayContaining(['Margem de contribuição', 'Margem operacional', 'IR/CSLL', 'Margem líquida']));
    // no contrato: o investimento sai uma vez; IR mês a mês (meses 1–6 com amortização, 7–12 sem)
    const net1 = 55_000 - am - Math.round((55_000 - am) * 0.34);
    expect(dre.find((x) => x.label === 'Margem líquida')!.total).toBe(6 * net1 + 6 * 36_300);
    expect(r.statement!.total.net).toBe(6 * net1 + 6 * 36_300);
  });
  it('IR/CSLL só sobre resultado operacional positivo', () => {
    const r = evalAt({ input: rec, items: items([30_000, 1000]), settings: { ...S, overheadBp: 1000, incomeTaxBp: 3400 }, publicSector: false });
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
  it('passos com fórmulas e o comparativo do modelo antigo (×3,2 sobre o custo mensal consolidado)', () => {
    // NFCOM com 30% de tributos e 2% de despesas variáveis; custo mensal 3.200 + roteador 6.000 em 6 meses = 4.200
    const input = { ...emptyEconInput(), termMonths: 12, opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 320_000 }], capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 600_000 }] };
    const r = financeEngine({ input, items: items([1_292_500, 3000]), settings: { ...S, variableExpenseBp: 200, marginTargetBp: 3000, tmaMonthlyBp: 0 }, publicSector: false });
    const steps = econMemory(r, (c) => `R$ ${(c / 100).toFixed(2)}`, { legacy: { recurringX100: 320, oneTimeX100: 250 } });
    expect(steps.map((s) => s.key)).toEqual(['entradas', 'preco', 'historico', 'fluxo', 'decisao']);
    const hist = steps.find((s) => s.key === 'historico')!;
    expect(hist.rows[0]!.value).toBe('R$ 13440.00/mês');
    expect(hist.rows[1]!.value).toBe('68,75%');
    expect(hist.rows[2]!.value).toBe('36,75%'); // bruta − tributos − despesas variáveis
    const preco = steps.find((s) => s.key === 'preco')!;
    expect(preco.rows.find((x) => x.label === 'Divisor do markup (D)')!.value).toBe('38%');
    const fluxo = steps.find((s) => s.key === 'fluxo')!;
    const roi = fluxo.rows.find((x) => x.label === 'ROI')!;
    expect(roi.value).toBe(`${r.kpi!.roiPct!.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
    expect(steps.at(-1)!.rows.at(-1)!.label).toBe('Resultado');
    expect(econMemory(r, String).some((s) => s.key === 'historico')).toBe(false);
  });
});

describe('planilha de materiais (BOM) com frequência e impacto', () => {
  it('lê as colunas do documento e classifica cada linha', () => {
    const r = parseCostTable([
      ['Item / Descrição', 'Unid.', 'Qtd.', 'Custo Unit.', 'Frequência do Custo', 'Impacta o Quê?'],
      ['Cabo Fibra Óptica', 'Metro', '1.000', 'R$ 5,00', 'Único (Setup)', 'Material/Equipamento'],
      ['Mão de Obra (HH)', 'HH', '40', 'R$ 50,00', 'Único (Setup)', 'Serviço/Mão de Obra'],
      ['Aluguel de Poste', 'Unid.', '10', 'R$ 12,00', 'Mensal (Recorrente)', 'Custo Operacional'],
      ['Frete do Material', 'Unid.', '1', 'R$ 500,00', 'Único (Setup)', 'Despesa de Entrega'],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.frequency, l.impact])).toEqual([['unico', 'material'], ['unico', 'servico'], ['mensal', 'operacional'], ['unico', 'entrega']]);
    expect(r.lines[0]).toMatchObject({ qtyMilli: 1_000_000, unitCents: 500, unit: 'Metro' });
  });
});

describe('negociação mista: venda, recorrência e locação na mesma oportunidade', () => {
  const doc = (bp: number) => ({ name: `Doc ${bp}`, percentBp: bp, fixedCents: 0, complete: true });
  const base = { ...emptyEconInput(), termMonths: 12, receiveMonth: 0 };
  it('cada custo sai do seu tipo, o comum é rateado pela receita e o resultado é um só', () => {
    const items: EconItem[] = [
      { description: 'Roteador vendido', revenueCents: 120_000, kind: 'venda', doc: doc(1000) },
      { description: 'Link', revenueCents: 10_000, kind: 'recorrencia', doc: doc(2000) },
      { description: 'ONU alugada', revenueCents: 10_000, kind: 'locacao', doc: doc(0) },
    ];
    const input = { ...base, capex: [
      { description: 'Roteador', qtyMilli: 1000, unitCents: 60_000, kind: 'venda' as const },
      { description: 'ONU', qtyMilli: 1000, unitCents: 30_000, kind: 'locacao' as const },
      { description: 'Instalação', qtyMilli: 1000, unitCents: 24_000 },
    ], opex: [{ description: 'Trânsito', qtyMilli: 1000, unitCents: 2_000 }] };
    const S0 = { ...S, tmaMonthlyBp: 100, contingencyCapexBp: 0, contingencyOpexBp: 0 };
    const r = financeEngine({ input, items, settings: S0, publicSector: false });
    expect(r.deal).toBeDefined();
    const d = r.deal!;
    expect(d.kinds).toEqual(['venda', 'recorrencia', 'locacao']);
    // células: pagamento único na Cesta de Produtos; recorrência e locação na Cesta de Serviços (mensal)
    expect(d.cells.map((c) => c.key)).toEqual(['unico:venda', 'mensal:servico']);
    const [u, m] = d.cells.map((c) => c.result);
    // Roteador (produtos) na única; ONU (serviços) na mensal; Instalação (sem cesta) rateada: único 120.000 × mensal 20.000 × 12 → 1/3
    expect(u!.capexBaseCents).toBe(60_000 + 8_000);
    expect(m!.capexBaseCents).toBe(30_000 + 16_000);
    expect(m!.opexBaseCents).toBe(2_000);
    expect(u!.mode).toBe('pontual');
    expect(m!.mode).toBe('recorrente');
    // um fluxo só, no preço sugerido de cada célula
    expect(r.cashflow[0]).toBe(u!.cashflow[0]! + m!.cashflow[0]!);
    expect(r.cashflow).toHaveLength(13);
    expect(r.kpi!.npvCents).toBe(Math.round(npvF(r.cashflow, r.rates.r)));
    expect(r.investmentCents).toBe(114_000);
    // sugerido do lote = soma das células; cada célula na margem escolhida
    expect(d.suggested).toEqual({ unico: u!.suggestedCents, mensal: m!.suggestedCents });
    expect(r.suggestedOneTimeCents).toBe(u!.suggestedCents);
    expect(r.kpi!.marginPct).toBeCloseTo(35, 2);
    // decisão no proposto (total dos produtos), dividido entre as células
    expect(r.decision).toMatchObject({ basis: 'proposto', source: 'itens', priceCents: 20_000, oneTimeCents: 120_000 });
    expect(d.cells.map((c) => c.proposedCents)).toEqual([120_000, 20_000]);
  });
  it('produtos sem kind seguem o tipo da viabilidade; um tipo só = motor de sempre', () => {
    const single = financeEngine({ input: { ...base, capex: [{ description: 'Obra', qtyMilli: 1000, unitCents: 50_000 }] }, items: items([100_000, 0]), settings: S, publicSector: false });
    expect(single.deal).toBeUndefined();
    const sale = financeEngine({ input: { ...base, mode: 'recorrente' }, items: [{ description: 'Kit', revenueCents: 90_000, kind: 'venda', doc: doc(0) }], settings: S, publicSector: false });
    expect(sale.mode).toBe('pontual');
  });
});


describe('lotes Venda e Serviço (11/2026)', () => {
  it('serviço único no pagamento único com o tributo do Lote Serviço; investimento de cada lote sai do seu lote', () => {
    const doc = (id: string, pct: number) => ({ id, name: id, percentBp: pct, fixedCents: 0, complete: true });
    const r = financeEngine({
      input: { ...emptyEconInput(), mode: 'recorrente', termMonths: 12, capex: [{ description: 'Roteador (patrimonial)', qtyMilli: 1000, unitCents: 6_000, kind: 'venda' }, { description: 'Instalação', qtyMilli: 1000, unitCents: 3_000, kind: 'servico' }] },
      items: [
        { description: 'Roteador', revenueCents: 10_000, kind: 'venda', doc: doc('NF-e', 1000) },
        { description: 'Instalação', revenueCents: 5_000, kind: 'servico', doc: doc('NFS-e 5%', 500) },
        { description: 'Link', revenueCents: 1_000, kind: 'recorrencia', doc: doc('NFS-e 15%', 1500) },
      ],
      settings: { ...S, marginTargetBp: 0, contingencyCapexBp: 0 }, publicSector: false,
    });
    // Cesta de Serviços: o maior entre os serviços (15%) vale também para o serviço único
    expect(r.lots!.map((l) => [l.lot, l.percentBp, l.items])).toEqual([['venda', 1000, 1], ['servico', 1500, 2]]);
    const cells = r.deal!.cells;
    expect(cells.map((c) => [c.key, c.taxPct])).toEqual([['unico:venda', 10], ['unico:servico', 15], ['mensal:servico', 15]]);
    // investimento: o da Cesta de Produtos inteiro na venda; o da Cesta de Serviços dividido entre o serviço único (5.000) e a recorrência (1.000 × 12)
    const fS = 5_000 / (5_000 + 12_000);
    expect(cells[0]!.result.capexBaseCents).toBe(6_000);
    expect(cells[1]!.result.capexBaseCents).toBe(Math.round(3_000 * fS));
    expect(cells[2]!.result.capexBaseCents).toBe(Math.round(3_000 * (1 - fS)));
    expect(r.deal!.revenue).toMatchObject({ venda: 10_000, servico: 5_000, recorrencia: 1_000 });
    expect(r.suggestedOneTimeCents).toBe(cells[0]!.suggestedCents! + cells[1]!.suggestedCents!);
  });
});

describe('comparativo com o modelo antigo', () => {
  const rec = (over: Partial<ReturnType<typeof emptyEconInput>> = {}) => ({ ...emptyEconInput(), termMonths: 24, ...over });
  it('markup efetivo, margem bruta e efetiva do sugerido e do modelo antigo (×3,2 mensal / ×2,5 único)', () => {
    const r = financeEngine({ input: rec({ opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 10_000 }] }), items: items([0, 1000]), settings: { ...S, marginTargetBp: 2000 }, publicSector: false });
    const c = econCompare(r, {});
    expect(c.baseCents).toBe(10_000);
    expect(c.legacy).toMatchObject({ priceCents: 32_000, factor: 3.2 });
    expect(c.legacy.markupPct).toBeCloseTo(220, 10);
    expect(c.legacy.grossMarginPct).toBeCloseTo((1 - 1 / 3.2) * 100, 10);
    expect(c.legacy.effectiveMarginPct).toBeCloseTo((1 - 1 / 3.2 - r.rates.a - r.rates.c) * 100, 10);
    const P = r.suggestedCents!;
    expect(c.engine.markupPct).toBeCloseTo(((P - 10_000) / 10_000) * 100, 10);
    expect(c.differenceCents).toBe(32_000 - P);
    // fator da empresa em Configurações vence o padrão
    expect(econCompare(r, { recurringX100: 300 }).legacy.priceCents).toBe(30_000);
    // pagamento único: sobre o investimento, ×2,5
    const u = financeEngine({ input: { ...emptyEconInput(), mode: 'pontual', capex: [{ description: 'Equip.', qtyMilli: 1000, unitCents: 40_000 }] }, items: items([0, 1000]), settings: S, publicSector: false });
    expect(econCompare(u).legacy).toMatchObject({ priceCents: 100_000, factor: 2.5 });
  });
  it('o preço sugerido acompanha a margem escolhida', () => {
    const input = rec({ opex: [{ description: 'Link', qtyMilli: 1000, unitCents: 10_000 }] });
    const lo = financeEngine({ input: { ...input, marginTargetBp: 2000 }, items: items([0, 1000]), settings: { ...S, marginTargetBp: 2000, marginMaxBp: 6000 }, publicSector: false });
    const hi = financeEngine({ input: { ...input, marginTargetBp: 4000 }, items: items([0, 1000]), settings: { ...S, marginTargetBp: 2000, marginMaxBp: 6000 }, publicSector: false });
    expect(hi.suggestedCents!).toBeGreaterThan(lo.suggestedCents!);
    expect(hi.suggestedMinCents).toBe(lo.suggestedMinCents);
  });
});

describe('FINANCE-3.1: payback pela anuidade, DRE temporal e margem líquida alvo', () => {
  const st: EconSettings = { ...S, tmaMonthlyBp: 150, marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 9000, variableExpenseBp: 0, lossPrivateBp: 300, badDebtBp: 100, overheadBp: 2000, incomeTaxBp: 1500 };
  const input = { ...emptyEconInput(), termMonths: 12, paybackMonths: 3, capex: [{ description: 'Implantação', qtyMilli: 1000, unitCents: 5_847_700 }] };
  it('parcela do investimento = I × k(1+k)^D ÷ ((1+k)^D − 1); com margem zero o payback descontado fecha em D', () => {
    const r = financeEngine({ input: { ...input, marginTargetBp: 0 }, items: items([0, 0]), settings: { ...st, marginTargetBp: 0, marginSuggestedBp: 0, lossPrivateBp: 0, badDebtBp: 0 }, publicSector: false });
    const k = 0.015, P = (5_847_700 * k * (1 + k) ** 3) / ((1 + k) ** 3 - 1);
    expect(r.kpi!.margins!.amortizationCents).toBe(Math.round(P));
    near(r.kpi!.paybackMonths!, 3, 1e-3);
  });
  it('amortização zera a partir de D+1; DRE consolidada = soma exata dos meses; % com o mesmo sinal do valor', () => {
    const d = financeEngineDetailed({ input, items: items([0, 1000]), settings: st, publicSector: false });
    const s = d.result.statement!;
    expect(s.afterFrom).toBe(4);
    expect(s.after!.amortization).toBe(0);
    expect(s.after!.contribution).toBeGreaterThan(s.month.contribution);
    // MC % do período de amortização = margem escolhida (30%)
    expect((s.month.contribution / s.month.revenue) * 100).toBeCloseTo(30, 2);
    // total = 3 meses de amortização + 9 meses sem
    for (const f of ['revenue', 'tax', 'amortization', 'contribution', 'risk', 'overhead', 'operating', 'incomeTax', 'net'] as const) expect(s.total[f]).toBe(3 * s.month[f]! + 9 * s.after![f]!);
    expect(s.total.net).toBe(s.total.revenue - s.total.tax - s.total.commission - s.total.opex - s.total.amortization - s.total.risk - s.total.overhead! - s.total.incomeTax!);
    const dre = econDre(d.result, String);
    const net = dre.find((x) => x.label === 'Margem líquida')!;
    expect(net.total).toBe(s.total.net);
    expect(net.pct!.total).toBeCloseTo((s.total.net! / s.total.revenue) * 100, 10);
    for (const row of dre.filter((x) => x.pct)) for (const c of ['month', 'after', 'total'] as const) {
      const v = c === 'total' ? row.total : row[c];
      if (row.pct![c] != null && v != null) expect(Math.sign(row.pct![c]!)).toBe(Math.sign(v));
    }
  });
  it('recomendação: MO = alvo ÷ (1 − IR); MC = MO + fixas + glosa + inadimplência, tudo dos parâmetros (40% → 71,06%)', () => {
    const r = financeEngine({ input, items: items([0, 1000]), settings: { ...st, netMarginTargetBp: 4000 }, publicSector: false });
    const rc = r.recommendation!;
    expect(rc.operatingNeededPct!).toBeCloseTo(47.0588, 3);
    expect(rc.contributionPct!).toBeCloseTo(71.0588, 3);
    expect(rc.params).toEqual({ overheadPct: 20, glosaPct: 3, badDebtPct: 1, incomeTaxPct: 15 });
    // 1 − 10% − 0% − 71,06% = 18,94%; preço = (parcela da anuidade) ÷ 18,94%
    near(rc.priceCents!, (5_847_700 / annuityFactor(0.015, 3)) / (1 - 0.1 - (0.4 / 0.85 + 0.2 + 0.03 + 0.01)), 1);
    // nesse preço a margem líquida dos meses 1..D fica no alvo
    const at = evalAt({ input: { ...input, priceCents: rc.priceCents }, items: items([0, 1000]), settings: { ...st, netMarginTargetBp: 4000 }, publicSector: false });
    expect(at.kpi!.margins!.netPct!).toBeCloseTo(40, 1);
    // muda o parâmetro → muda a recomendação (sem valor fixo no código)
    const r2 = financeEngine({ input, items: items([0, 1000]), settings: { ...st, netMarginTargetBp: 4000, overheadBp: 4000 }, publicSector: false });
    expect(r2.recommendation!.contributionPct!).toBeCloseTo(91.0588, 3);
    expect(r2.recommendation!.priceCents).toBeNull();
    expect(r2.warnings.join(' ')).toMatch(/não cabe no markup/);
  });
  it('sem margem líquida alvo nos parâmetros: sem recomendação', () => {
    expect(financeEngine({ input, items: items([0, 1000]), settings: st, publicSector: false }).recommendation ?? null).toBeNull();
  });
});

describe('FINANCE-3.2: viabilidade pela faixa de margem líquida, recomendação de preço e payback do investimento', () => {
  const st: EconSettings = { ...S, tmaMonthlyBp: 150, marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 9000, variableExpenseBp: 0, lossPrivateBp: 300, badDebtBp: 100, overheadBp: 2000, incomeTaxBp: 1500, netMarginMinBp: 1200, netMarginMaxBp: 2500 };
  const input = { ...emptyEconInput(), termMonths: 12, paybackMonths: 3, capex: [{ description: 'Implantação', qtyMilli: 1000, unitCents: 5_847_700 }] };
  it('payback do investimento no preço sugerido = D (contado do 1º faturamento), com 3 e com 4 meses', () => {
    for (const D of [3, 4]) {
      const r = financeEngine({ input: { ...input, paybackMonths: D }, items: items([0, 1000]), settings: st, publicSector: false });
      near(r.kpi!.investmentPaybackMonths!, D, 2e-3);
      expect(r.kpi!.paybackMonths!).toBeLessThan(D); // o de caixa inclui a margem
    }
  });
  it('faixa: preço da margem mínima e da máxima (target seeking com o IR dos parâmetros); viável só dentro dela', () => {
    const r = financeEngine({ input, items: items([0, 1000]), settings: st, publicSector: false });
    const rg = r.recommendation!.range!;
    expect(rg.min.contributionPct!).toBeCloseTo(12 / 0.85 + 24, 6);
    expect(rg.max.contributionPct!).toBeCloseTo(25 / 0.85 + 24, 6);
    expect(rg.max.priceCents!).toBeGreaterThan(rg.min.priceCents!);
    const at = (P: number) => financeEngine({ input: { ...input, priceCents: P }, items: items([0, 1000]), settings: st, publicSector: false });
    const mid = Math.round((rg.min.priceCents! + rg.max.priceCents!) / 2);
    const vMid = at(mid);
    expect(vMid.decision!.verdict).toBe('viavel');
    expect(vMid.decision!.netMarginPct!).toBeGreaterThan(12);
    expect(vMid.decision!.netMarginPct!).toBeLessThan(25);
    expect(at(Math.round(rg.min.priceCents! * 0.9)).decision!.verdict).toBe('abaixo_faixa');
    expect(at(Math.round(rg.max.priceCents! * 1.1)).decision!.verdict).toBe('acima_faixa');
    // na margem mínima exata a margem líquida dos meses 1..D é 12%
    near(at(rg.min.priceCents!).decision!.netMarginPct!, 12, 0.01);
    // VPL, TIR e payback viram informação (veredito antigo guardado)
    expect(vMid.decision!.policyVerdict).toBeDefined();
  });
  it('sem preço sugerido pelo motor (zero/nulo) a base da aprovação não diz viável', () => {
    const r = financeEngine({ input: { ...emptyEconInput(), termMonths: 12, priceCents: 100_000 }, items: [], settings: st, publicSector: false });
    if (!r.suggestedCents) expect(r.decision!.verdict).toBe('aguardando_sugerido');
    else expect(r.decision!.verdict).not.toBe('aguardando_sugerido');
    const z = applyNetMarginRule({ ...r, suggestedCents: 0, decision: { ...r.decision!, verdict: 'viavel' } }, st);
    expect(z.decision!.verdict).toBe('aguardando_sugerido');
  });
});
