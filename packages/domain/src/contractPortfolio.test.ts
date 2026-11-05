import { describe, expect, it } from 'vitest';
import { adjustmentsDue, contractHealth, contractPerformance, expiringPlan, healthSummary, pareto, renewalState, termProgress, type PortfolioContract } from './contractPortfolio';

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

describe('desempenho da operação', () => {
  const base = { today: '2026-11-05', windowDays: 365, renewals: [], expiredWithoutRenewal: 0, adjustments: [], tasks: [], transfers: { accepted: 0, returned: 0 }, erp: { avgHours: null, firstPassRate: null } };
  const by = (ms: ReturnType<typeof contractPerformance>) => Object.fromEntries(ms.map((m) => [m.key, m]));
  it('sem base, nenhum valor é inventado', () => {
    for (const m of contractPerformance(base)) expect(m.value).toBeNull();
  });
  it('renovação no prazo conta quem venceu sem renovação; reajuste efetivado e receita capturada', () => {
    const m = by(contractPerformance({ ...base,
      renewals: [
        { cycleKey: '2026-06-30', status: 'concluido', openedAt: '2026-04-01T10:00:00Z', closedAt: '2026-06-20T10:00:00Z' },
        { cycleKey: '2026-08-31', status: 'concluido', openedAt: '2026-07-01T10:00:00Z', closedAt: '2026-09-05T10:00:00Z' },
        { cycleKey: '2026-09-30', status: 'cancelado', openedAt: '2026-08-01T10:00:00Z', closedAt: null },
      ],
      expiredWithoutRenewal: 2,
      adjustments: [{ cycleKey: '2026-03-01', status: 'concluido', applied: true, pct: 10, newCents: 1100 }, { cycleKey: '2026-04-01', status: 'aberto', applied: false, pct: null, newCents: null }],
      tasks: [{ dueAt: '2026-10-10T00:00:00Z', completedAt: '2026-10-09T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', acceptedAt: '2026-10-01T06:00:00Z' }, { dueAt: '2026-10-10T00:00:00Z', completedAt: '2026-10-12T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', acceptedAt: null }],
      transfers: { accepted: 3, returned: 1 },
    }));
    expect(m.renovacao_prazo).toMatchObject({ num: 1, den: 4, value: 0.25 });
    expect(m.antecedencia!.value).toBe(2.5); // (+10 e −5) / 2
    expect(m.reajuste).toMatchObject({ num: 1, den: 2, value: 0.5 });
    expect(m.receita_reajuste!.value).toBe(100);
    expect(m.sla_atividades).toMatchObject({ num: 1, den: 2 });
    expect(m.aceite!.value).toBe(6);
    expect(m.devolucao!.value).toBe(0.25);
  });
});
