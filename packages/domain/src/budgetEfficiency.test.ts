import { describe, expect, it } from 'vitest';
import { deviationOf, diagnose, indexBase100, lowReturn, pctChange, ratio } from './budgetEfficiency';

describe('eficiência orçamentária', () => {
  it('fórmulas tratam zero e ausência sem inventar número', () => {
    expect(ratio(1000, 0)).toBeNull();
    expect(ratio(null, 10)).toBeNull();
    expect(ratio(1000, 4)).toBe(250);
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(120, 0)).toBeNull();
    expect(deviationOf(110, 100)).toEqual({ abs: 10, pct: 10 });
    expect(deviationOf(10, 0).pct).toBeNull();
  });
  it('diagnóstico: redução de gasto com queda de resultado não é eficiência', () => {
    expect(diagnose({ cost: 80, result: 70, approved: 100 }, { cost: 100, result: 100 })).toEqual(['economia_com_perda']);
    expect(diagnose({ cost: 120, result: 90, approved: 150 }, { cost: 100, result: 100 })).toEqual(['custo_sobe_resultado_cai']);
    expect(diagnose({ cost: 90, result: 110, approved: 100 }, { cost: 100, result: 100 })).toEqual(['custo_cai_resultado_sobe']);
    expect(diagnose({ cost: 110, result: 130, approved: 120 }, { cost: 100, result: 100 })).toEqual(['resultado_cresce_mais_que_custo']);
    expect(diagnose({ cost: 130, result: 110, approved: 140 }, { cost: 100, result: 100 })).toEqual(['custo_cresce_mais_que_resultado']);
    expect(diagnose({ cost: 40, result: null, approved: 100 }, { cost: 0, result: null })).toEqual(['orcamento_ocioso']);
    expect(diagnose({ cost: 10, result: 5, approved: 0 }, { cost: 0, result: 0 })).toEqual(['sem_base']);
  });
  it('alto investimento e baixo retorno pela mediana; índice base 100', () => {
    const rows = [{ id: 'a', cost: 100, efficiency: 5 }, { id: 'b', cost: 500, efficiency: 1 }, { id: 'c', cost: 300, efficiency: 3 }, { id: 'd', cost: 50, efficiency: null }];
    expect([...lowReturn(rows)].map((r) => r.id)).toEqual(['b']);
    expect(indexBase100([null, 0, 50, 75])).toEqual([null, 0, 100, 150]);
  });
});
