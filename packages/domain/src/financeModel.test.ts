import { describe, expect, it } from 'vitest';
import { emptyEconInput, financeEngine, type EconInput, type EconItem, type EconSettings } from './finance';
import { financeEngine as legacyEngine } from './legacy/financeV2';
import { buildModel, dependentsOf, findCycle, runModel, traceOf, validateModel, FIN_FORMULAS, FIN_VARIABLES } from './financeModel';
import { evalFinFormula, parseFinFormula, printFinFormula, FormulaError } from './formula';

/** Gerador determinístico (os mesmos cenários em toda execução). */
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }

function scenario(rand: () => number) {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const mode = rand() < 0.75 ? 'recorrente' as const : 'pontual' as const;
  const st: EconSettings = {
    marginTargetBp: pick([0, 1500, 2000, 3500]), marginSuggestedBp: null, marginMaxBp: pick([null, 4500, 6000]),
    tmaMonthlyBp: pick([0, 100, 150, 300]), tmaAnnualBp: pick([null, 0, 1200, 1500]), inflationAnnualBp: pick([null, 0, 450]),
    horizonMaxMonths: pick([null, 24, 36]), badDebtBp: pick([null, 0, 150]),
    commissionBp: pick([0, 200, 500]), lossPrivateBp: pick([0, 100, 200]), lossPublicBp: pick([0, 300]),
    contingencyCapexBp: pick([0, 1000]), contingencyOpexBp: pick([0, 500]), paybackMaxPrivate: pick([6, 12]), paybackMaxPublic: pick([12, 18]),
    blockOutsidePolicy: true, overheadBp: pick([null, 500, 1000]), incomeTaxBp: pick([null, 3400]),
  };
  if (st.marginMaxBp != null && st.marginMaxBp < st.marginTargetBp) st.marginMaxBp = st.marginTargetBp;
  const input: EconInput = {
    ...emptyEconInput(), mode, termMonths: pick([1, 6, 12, 24, 48]), receiveMonth: pick([0, 1, 3]),
    capex: rand() < 0.8 ? [{ description: 'Equipamento', qtyMilli: 1000 * pick([1, 2, 21]), unitCents: pick([15_000, 300_000, 1_500_000]), impact: 'material' }, ...(rand() < 0.4 ? [{ description: 'Frete', qtyMilli: 1000, unitCents: 50_000, impact: 'entrega' as const }] : [])] : [],
    opex: rand() < 0.8 ? [{ description: 'Link', qtyMilli: 1000, unitCents: pick([20_000, 120_000, 400_000]) }] : [],
    extraInitialCents: pick([0, 0, 25_000]), commissionBp: rand() < 0.2 ? 300 : null, lossBp: null,
    marginTargetBp: rand() < 0.3 ? pick([1000, 3000, 7000]) : null, paybackMonths: rand() < 0.4 ? pick([3, 6, 30]) : null,
    priceCents: rand() < 0.3 ? pick([50_000, 500_000, 2_000_000]) : null,
  };
  const items: EconItem[] = rand() < 0.9 ? [{ description: 'Link', revenueCents: pick([100_000, 600_000, 1_292_500]), doc: { id: 'd1', name: 'NFCOM', percentBp: pick([865, 3000]), fixedCents: pick([0, 350]), complete: rand() < 0.9 } }] : [];
  return { input, items, settings: st, publicSector: rand() < 0.3 };
}

let where = '';
const close = (a: number | null | undefined, b: number | null | undefined, tol = 1) => {
  if (a == null || b == null) return expect(a ?? null, where).toBe(b ?? null);
  expect(Math.abs(a - b), where).toBeLessThanOrEqual(tol);
};

describe('compatibilidade: o modelo padrão reproduz o motor anterior', () => {
  it('400 cenários: preços, indicadores, fluxo, desdobramento e decisão iguais (±1 centavo)', () => {
    const rand = rng(20261029);
    for (let k = 0; k < 400; k++) {
      const args = scenario(rand);
      const a = legacyEngine(args), b = financeEngine(args);
      const ctx = `cenário ${k}: ${JSON.stringify(args.input.mode)}`;
      where = ctx;
      expect(b.priceCents, ctx).toBe(a.priceCents);
      for (const key of ['cashCents', 'economicCents', 'minCents'] as const) close(b.floor[key], a.floor[key]);
      close(b.marginPriceCents, a.marginPriceCents); close(b.recommendedCents, a.recommendedCents); close(b.markupPriceCents, a.markupPriceCents);
      close(b.operatingFloorCents, a.operatingFloorCents); close(b.suggestedMinCents, a.suggestedMinCents);
      expect(b.verdict, ctx).toBe(a.verdict);
      expect(b.marginOk, ctx).toBe(a.marginOk);
      expect(b.paybackOk, ctx).toBe(a.paybackOk);
      expect(b.withinPolicy, ctx).toBe(a.withinPolicy);
      expect(b.autoApproval!.ok, ctx).toBe(a.autoApproval!.ok);
      expect(b.cashflow.length, ctx).toBe(a.cashflow.length);
      b.cashflow.forEach((x, i) => close(x, a.cashflow[i]));
      if (!a.kpi) { expect(b.kpi).toBeNull(); continue; }
      const ka = a.kpi, kb = b.kpi!;
      for (const key of ['taxCents', 'commissionCents', 'lossCents', 'contributionCents', 'npvCents', 'cashMonthlyCents', 'amortizationCents'] as const) close(kb[key], ka[key]);
      close(kb.marginPct, ka.marginPct, 1e-6);
      close(kb.irrMonthly, ka.irrMonthly, 1e-6);
      close(kb.paybackMonths, ka.paybackMonths, 1e-6);
      close(kb.simplePaybackMonths, ka.simplePaybackMonths, 1e-6);
      // ROI: na venda pontual à vista o motor anterior ignorava o mês 0 combinado (−100%); o modelo usa a soma da série
      if (!(args.input.mode === 'pontual' && args.input.receiveMonth === 0)) close(kb.roiPct, ka.roiPct, 1e-6);
      for (const key of ['operatingCents', 'incomeTaxCents', 'netCents', 'overheadCents'] as const) { where = `${ctx} margins.${key}`; close(kb.margins![key], ka.margins![key]); }
      for (const key of Object.keys(a.statement!.total) as (keyof NonNullable<typeof a.statement>['total'])[]) {
        where = `${ctx} statement.${key}`;
        close(b.statement!.month[key], a.statement!.month[key]);
        close(b.statement!.total[key], a.statement!.total[key], 2 + Math.abs((a.statement!.total[key] as number) ?? 0) * 1e-9);
      }
    }
  });
});

describe('linguagem de fórmulas', () => {
  it('analisa, imprime e avalia com segurança', () => {
    const ast = parseFinFormula('receita_mensal - custo_operacional - tributos');
    expect(printFinFormula(ast)).toBe('receita_mensal - custo_operacional - tributos');
    expect(printFinFormula(parseFinFormula('a - (b - c)'))).toBe('a - (b - c)');
    expect(printFinFormula(parseFinFormula('(a + b) * c ^ 2'))).toBe('(a + b) * c ^ 2');
    const env = { get: (n: string) => ({ receita_mensal: 1_378_200, custo_operacional: 482_370, tributos: 206_730 } as Record<string, number>)[n] ?? null };
    expect(evalFinFormula(ast, env)).toBe(689_100);
    expect(evalFinFormula(parseFinFormula('15% * 200'), env)).toBeCloseTo(30, 10);
    expect(evalFinFormula(parseFinFormula('SE(1 > 2; 10; 20)'), env)).toBe(20);
    expect(evalFinFormula(parseFinFormula('MAX(NULO; 3; 7)'), env)).toBe(7);
    expect(evalFinFormula(parseFinFormula('1 + NULO'), env)).toBeNull();
    const warns: string[] = [];
    expect(evalFinFormula(parseFinFormula('10 / 0'), { ...env, warn: (m) => warns.push(m) })).toBeNull();
    expect(warns[0]).toMatch(/Divisão por zero/);
    expect(evalFinFormula(parseFinFormula('TAXA_ANUAL(TAXA_MENSAL(0.12))'), env)).toBeCloseTo(0.12, 12);
    expect(evalFinFormula(parseFinFormula('ARRED(2.345; 2)'), env)).toBeCloseTo(2.35, 12);
  });
  it('recusa código arbitrário e sintaxe inválida', () => {
    for (const bad of ['process.exit()', 'a; b', '1 +', 'constructor["x"]', 'a & b', 'FOO(1)', '']) expect(() => parseFinFormula(bad)).toThrow(FormulaError);
  });
});

describe('catálogo, dependências e simulação', () => {
  const S: EconSettings = { marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 4500, tmaMonthlyBp: 0, tmaAnnualBp: 1500, inflationAnnualBp: 450, horizonMaxMonths: 36, badDebtBp: 150, commissionBp: 200, lossPrivateBp: 100, lossPublicBp: 200, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, overheadBp: 500, incomeTaxBp: 3400 };
  const input: EconInput = { ...emptyEconInput(), termMonths: 24, capex: [{ description: 'Cabo', qtyMilli: 1000, unitCents: 750_000, impact: 'material' }], opex: [{ description: 'Poste', qtyMilli: 1000, unitCents: 12_000 }] };
  const items: EconItem[] = [{ description: 'Link', revenueCents: 1_292_500, doc: { name: 'NFCOM', percentBp: 3000, fixedCents: 0, complete: true } }];

  it('todas as fórmulas do motor estão no catálogo, sem erro nem ciclo, e cada variável tem origem', () => {
    const m = buildModel();
    expect(validateModel(m).filter((i) => i.level === 'erro')).toEqual([]);
    expect(findCycle(m)).toBeNull();
    for (const f of FIN_FORMULAS) for (const ref of m.formulas.get(f.code)!.refs) expect(m.formulas.has(ref) || FIN_VARIABLES.some((v) => v.code === ref), `${f.code} → ${ref}`).toBe(true);
    for (const v of FIN_VARIABLES) expect(v.origin.length).toBeGreaterThan(5);
  });
  it('dependências reais: o custo operacional afeta margem, fluxo e indicadores, mas não os tributos', () => {
    const deps = dependentsOf(buildModel(), ['custo_mensal']);
    expect(deps).toEqual(expect.arrayContaining(['margem_contribuicao', 'margem_operacional', 'margem_liquida', 'fluxo_caixa', 'vpl', 'tir', 'roi', 'payback_descontado', 'preco_minimo', 'aprovacao_automatica']));
    expect(deps).not.toContain('tributos');
    expect(dependentsOf(buildModel(), ['tributos'])).not.toContain('preco_minimo'); // o preço usa a alíquota, não o valor
  });
  it('fórmula alterada pela diretoria muda o cálculo sem mudar o código (e detecta ciclo)', () => {
    const before = financeEngine({ input, items, settings: S, publicSector: false });
    const m = buildModel([{ code: 'custo_mensal', expression: 'SE(recorrente; custo_mensal_base * 2; 0)', version: 2 }]);
    expect(validateModel(m).filter((i) => i.level === 'erro')).toEqual([]);
    const after = financeEngine({ input, items, settings: S, publicSector: false, model: m });
    expect(after.monthlyCostCents).toBe(24_000);
    expect(after.kpi!.cashMonthlyCents).toBe(before.kpi!.cashMonthlyCents! - 12_000);
    expect(after.model).toMatchObject({ versions: { custo_mensal: 2 } });
    expect(after.model!.key).not.toBe(before.model!.key);
    expect(after.kpi!.npvCents).toBeLessThan(before.kpi!.npvCents);
    const cyc = buildModel([{ code: 'custo_mensal', expression: 'margem_contribuicao * 0.1' }]);
    expect(validateModel(cyc).some((i) => /circular/.test(i.message))).toBe(true);
    // fórmula personalizada usada por uma fórmula do sistema
    const custom = buildModel([{ code: 'taxa_cartao', expression: '2%', unit: '%', name: 'Taxa do cartão' }, { code: 'comissao', expression: 'receita * (aliq_comissao + taxa_cartao)' }]);
    const withCard = financeEngine({ input, items, settings: S, publicSector: false, model: custom });
    expect(withCard.kpi!.commissionCents).toBe(Math.round(1_292_500 * 0.04));
  });
  it('memória de cálculo de uma fórmula com os números e as parcelas', () => {
    const m = buildModel();
    const base = { recorrente: true, preco: 1_378_200, aliq_tributos: 0.15, tributo_fixo: 0, mes: 1, inflacao_anual: null, tma_anual: null, tma_mensal_informada: 0 } as unknown as Record<string, number>;
    const run = runModel(m, base, ['tributos']);
    const tr = traceOf(m, base, run, 'tributos');
    expect(tr.expression).toBe('receita * aliq_tributos + tributo_fixo');
    expect(tr.memory).toBe('13.782,00 * 15% + 0,00');
    expect(tr.value).toBeCloseTo(206_730, 6);
    expect(tr.children!.map((c) => c.code)).toEqual(['receita', 'aliq_tributos', 'tributo_fixo']);
  });
});
