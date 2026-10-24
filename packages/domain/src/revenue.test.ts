import { describe, expect, it } from 'vitest';
import { growthToMonth, recurringInMonth, revenueByMonth, type RevContract, type RevVersion } from './revenue';

const v = (p: Partial<RevVersion> & { version: number; monthlyCents: number }): RevVersion => ({ changeKind: 'cadastro', createdAt: '2025-01-10T12:00:00Z', effectiveFrom: null, startAt: '2025-01-01', endAt: '2027-12-31', billingStartAt: '2025-01-01', activationAt: null, ...p });

describe('receita por mês (Booking)', () => {
  it('recorrente pela versão em vigor; reajuste sai do comparável por 12 meses', () => {
    const c: RevContract = { id: 'a', billingType: 'recorrente', archivedAt: null, yearValues: [], versions: [v({ version: 1, monthlyCents: 1000 }), v({ version: 2, monthlyCents: 1100, changeKind: 'reajuste', effectiveFrom: '2026-03-01' })] };
    expect(recurringInMonth(c, '2026-02')).toEqual({ cents: 1000, reajuste: 0 });
    expect(recurringInMonth(c, '2026-03')).toEqual({ cents: 1100, reajuste: 100 });
    expect(recurringInMonth(c, '2027-02')).toEqual({ cents: 1100, reajuste: 100 });
    expect(recurringInMonth(c, '2027-03')).toEqual({ cents: 1100, reajuste: 0 }); // já completou 12 meses: está no ano anterior também
    expect(recurringInMonth(c, '2024-12')).toEqual({ cents: 0, reajuste: 0 }); // antes do faturamento
  });
  it('contrato cadastrado já reajustado: o valor do ano anterior informado separa o reajuste', () => {
    const c: RevContract = { id: 'b', billingType: 'recorrente', archivedAt: null, versions: [v({ version: 1, monthlyCents: 1100, createdAt: '2026-05-01T12:00:00Z' })], yearValues: [{ year: 2025, monthlyCents: 1000, onlyAdjustment: true }] };
    expect(recurringInMonth(c, '2025-06')).toEqual({ cents: 1000, reajuste: 0 });
    expect(recurringInMonth(c, '2026-06')).toEqual({ cents: 1100, reajuste: 100 });
    const upsell: RevContract = { ...c, yearValues: [{ year: 2025, monthlyCents: 1000, onlyAdjustment: false }] };
    expect(recurringInMonth(upsell, '2026-06').reajuste).toBe(0); // diferença foi venda (aditivo), conta como crescimento
  });
  it('soma recorrente, medição (consumo − estorno) e frequente; crescimento real × comparável', () => {
    const contracts: RevContract[] = [
      { id: 'r', billingType: 'recorrente', archivedAt: null, yearValues: [], versions: [v({ version: 1, monthlyCents: 1000 }), v({ version: 2, monthlyCents: 1200, changeKind: 'reajuste', effectiveFrom: '2026-01-01' })] },
      { id: 'm', billingType: 'medicao', archivedAt: null, yearValues: [], versions: [v({ version: 1, monthlyCents: 0 })] },
      { id: 'f', billingType: 'frequente', archivedAt: null, yearValues: [], versions: [v({ version: 1, monthlyCents: 0 })] },
    ];
    const ledger = [
      { contractId: 'm', kind: 'consumo', amountCents: 500, occurredOn: '2026-01-15' }, { contractId: 'm', kind: 'estorno', amountCents: 100, occurredOn: '2026-01-20' },
      { contractId: 'm', kind: 'credito', amountCents: 99999, occurredOn: '2026-01-02' }, { contractId: 'f', kind: 'faturamento', amountCents: 300, occurredOn: '2026-01-05' },
      { contractId: 'm', kind: 'consumo', amountCents: 200, occurredOn: '2025-01-15' },
    ];
    const y26 = revenueByMonth(contracts, ledger, 2026);
    expect(y26[0]).toMatchObject({ recorrente: 1200, reajuste: 200, medicao: 400, frequente: 300, total: 1900, comparavel: 1700 });
    const y25 = revenueByMonth(contracts, ledger, 2025);
    expect(y25[0]).toMatchObject({ recorrente: 1000, medicao: 200, total: 1200 });
    const g = growthToMonth(y26, y25, 1);
    expect(g.growthReal).toBeCloseTo(58.33, 1);
    expect(g.growthComparable).toBeCloseTo(41.67, 1);
  });
});
