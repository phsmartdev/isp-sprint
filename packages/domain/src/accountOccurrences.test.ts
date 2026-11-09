import { describe, expect, it } from 'vitest';
import { activeOn, evolutionByYear, quarterKey, responseState } from './accountOccurrences';

describe('ocorrências da conta', () => {
  it('situação da resposta só existe com prazo; respondida vence o prazo', () => {
    expect(responseState({ responseDueOn: null, respondedOn: null }, '2026-11-09')).toBeNull();
    expect(responseState({ responseDueOn: '2026-11-09', respondedOn: null }, '2026-11-09')).toBe('pendente');
    expect(responseState({ responseDueOn: '2026-11-08', respondedOn: null }, '2026-11-09')).toBe('atrasada');
    expect(responseState({ responseDueOn: '2026-11-01', respondedOn: '2026-11-05' }, '2026-11-09')).toBe('respondida');
  });

  it('trimestre', () => {
    expect(quarterKey('2025-01-31')).toBe('2025-T1');
    expect(quarterKey('2025-09-30')).toBe('2025-T3');
    expect(quarterKey('2025-12-01')).toBe('2025-T4');
  });

  it('contrato ativo respeita fim e encerramento antecipado', () => {
    const c = { startAt: '2024-07-01', endAt: '2026-06-30', monthlyCents: 100, closedOn: '2025-03-10' };
    expect(activeOn(c, '2024-06-30')).toBe(false);
    expect(activeOn(c, '2024-12-31')).toBe(true);
    expect(activeOn(c, '2025-12-31')).toBe(false);
    expect(activeOn({ startAt: null, endAt: null, monthlyCents: 1 }, '2025-01-01')).toBe(false);
  });

  it('resumo por ano: foto do fim do ano, ano corrente até hoje, nada no futuro', () => {
    const rows = evolutionByYear({
      contracts: [
        { startAt: '2023-07-01', endAt: '2024-06-30', monthlyCents: 1_800_000 },
        { startAt: '2024-07-01', endAt: '2026-12-31', monthlyCents: 4_100_000 },
      ],
      opportunities: [
        { createdOn: '2023-03-01', wonOn: '2023-06-10', lostOn: null },
        { createdOn: '2024-02-01', wonOn: null, lostOn: '2024-05-01' },
        { createdOn: '2026-12-01', wonOn: null, lostOn: null }, // futuro: ignorado
      ],
      interactions: ['2023-05-01', '2024-01-01', '2024-08-01', '2026-11-01'],
      occurrences: [{ on: '2024-09-01', impact: 'positivo' }, { on: '2025-02-01', impact: 'negativo' }],
    }, '2026-11-09');
    expect(rows.map((r) => r.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(rows[0]).toMatchObject({ monthlyCents: 1_800_000, activeContracts: 1, opened: 1, won: 1, lost: 0, interactions: 1 });
    expect(rows[1]).toMatchObject({ monthlyCents: 4_100_000, activeContracts: 1, opened: 1, lost: 1, interactions: 2, positive: 1 });
    expect(rows[2]).toMatchObject({ negative: 1, interactions: 0 });
    expect(rows[3]).toMatchObject({ opened: 0, interactions: 1, monthlyCents: 4_100_000 });
  });

  it('sem nenhum registro, sem linhas', () => {
    expect(evolutionByYear({ contracts: [], opportunities: [], interactions: [], occurrences: [] }, '2026-11-09')).toEqual([]);
  });
});
