import { describe, expect, it } from 'vitest';
import { contractMargins } from './finance';

const st = (revenue: number, amortization: number, overhead: number, net: number) => ({ revenue, tax: 0, commission: 0, opex: 0, amortization, contribution: revenue - amortization, risk: 0, overhead, operating: net, incomeTax: 0, net });

describe('margem líquida do contrato', () => {
  it('recorrente: soma a vigência inteira, não o 1º mês', () => {
    // 1º mês com amortização (líquida 10%); no contrato de 36 meses a amortização some depois do payback
    const r = { mode: 'recorrente' as const, term: { N: 36 } as never, kpi: { margins: { netPct: 10 } } as never, statement: { month: st(1000, 500, 400, 100), total: st(36_000, 6_000, 14_400, 15_600) } };
    const m = contractMargins(r)!;
    expect(m.months).toBe(36);
    expect(m.netPct).toBeCloseTo(15_600 / 36_000 * 100, 8);
    expect(m.contributionPct).toBeCloseTo(100, 8);
  });
  it('venda única: não há contrato mensal', () => {
    expect(contractMargins({ mode: 'pontual', term: { N: 0 } as never, kpi: { margins: { netPct: 10 } } as never, statement: { month: st(1, 0, 0, 1), total: st(1, 0, 0, 1) } })).toBeNull();
  });
});
