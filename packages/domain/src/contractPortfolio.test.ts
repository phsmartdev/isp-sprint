import { describe, expect, it } from 'vitest';
import { adjustmentsDue, contractHealth, expiringPlan, healthSummary, pareto, renewalState, termProgress, type PortfolioContract } from './contractPortfolio';

const T = '2026-11-04';
const c = (p: Partial<PortfolioContract>): PortfolioContract => ({ id: 'x', endAt: '2028-01-01', monthlyCents: 1000, closureExpected: false, renewal: null, overdue: 0, overdueTasks: 0, erpStatus: null, ...p });

describe('saúde do contrato', () => {
  it('risco de receita vence divergência, que vence pendência', () => {
    expect(contractHealth(c({}), T)).toBe('em_dia');
    expect(contractHealth(c({ overdueTasks: 1 }), T)).toBe('pendencia');
    expect(contractHealth(c({ overdue: 1, erpStatus: 'divergente' }), T)).toBe('divergente');
    expect(contractHealth(c({ endAt: '2026-12-20', erpStatus: 'divergente' }), T)).toBe('em_risco');
    expect(contractHealth(c({ endAt: '2026-12-20', renewal: 'concluido' }), T)).toBe('em_dia');
    expect(contractHealth(c({ closureExpected: true }), T)).toBe('em_risco');
  });
  it('resumo soma contratos e receita por situação', () => {
    const s = healthSummary([c({}), c({ monthlyCents: 500, overdue: 2 }), c({ monthlyCents: 300, closureExpected: true })], T);
    expect(Object.fromEntries(s.map((x) => [x.key, [x.n, x.monthlyCents]]))).toEqual({ em_dia: [1, 1000], pendencia: [1, 500], divergente: [0, 0], em_risco: [1, 300] });
  });
});

describe('plano de vencimentos', () => {
  it('distribui a receita do mês pela situação da renovação; já vencidos não entram', () => {
    const p = expiringPlan([
      c({ endAt: '2026-11-20', monthlyCents: 100 }), c({ endAt: '2026-11-25', monthlyCents: 200, renewal: 'aberto' }),
      c({ endAt: '2026-11-02', monthlyCents: 999 }), c({ endAt: '2027-01-10', monthlyCents: 50, renewal: 'concluido' }), c({ endAt: '2027-01-11', monthlyCents: 70, closureExpected: true }),
    ], T, 3);
    expect(p.map((x) => x.month)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(p[0]).toMatchObject({ n: 2, sem_acao: 100, em_renovacao: 200, renovado: 0 });
    expect(p[2]).toMatchObject({ n: 2, renovado: 50, encerramento: 70, encerramentoN: 1 });
    expect(renewalState({ closureExpected: true, renewal: 'concluido' })).toBe('encerramento');
  });
});

describe('concentração', () => {
  it('participação, acumulado e clientes que fazem 80%', () => {
    const r = pareto([{ key: 'a', name: 'A', cents: 600 }, { key: 'b', name: 'B', cents: 300 }, { key: 'c', name: 'C', cents: 100 }, { key: 'z', name: 'Z', cents: 0 }]);
    expect(r.items.map((x) => [x.key, x.share, x.cumulative])).toEqual([['a', 0.6, 0.6], ['b', 0.3, 0.9], ['c', 0.1, 1]]);
    expect(r.clientsFor80).toBe(2);
    expect(pareto([]).clientsFor80).toBeNull();
  });
});

describe('reajustes', () => {
  it('aniversário da data-base dentro da janela, com a situação do processo do ciclo', () => {
    const r = adjustmentsDue([
      { id: '1', adjustmentBaseDate: '2025-12-15', adjustmentIndex: 'IPCA', monthlyCents: 100, processes: [{ cycleKey: '2026-12-15', status: 'aberto' }] },
      { id: '2', adjustmentBaseDate: '2025-06-01', adjustmentIndex: null, monthlyCents: 100, processes: [] },
      { id: '3', adjustmentBaseDate: '2027-06-01', adjustmentIndex: 'IGP-M', monthlyCents: 100, processes: [] },
    ], T);
    expect(r).toEqual([{ id: '1', date: '2026-12-15', days: 41, index: 'IPCA', monthlyCents: 100, status: 'em_andamento' }]);
  });
  it('vigência decorrida', () => {
    expect(termProgress('2026-01-01', '2027-01-01', '2026-07-02')).toBeCloseTo(0.5, 2);
    expect(termProgress(null, '2027-01-01', T)).toBeNull();
  });
});
