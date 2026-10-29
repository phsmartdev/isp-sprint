import { describe, expect, it } from 'vitest';
import { commitmentItemBalances, lineBalances, q4, value4, type CCommitment, type CCommitmentItem, type CLine, type CMeasurement, type CMeasurementItem } from './commitments';
import { FACTOR, compAddMonths, adjustmentTable, allocateRateio, commitmentCurve, commitmentProjection, compMonthsBetween, parseAdjustmentIndex, priceAt, retroactiveFor, splitByShares, PPM } from './commitmentPlanning';

const line = (id: string, over: Partial<CLine> = {}): CLine => ({ id, itemNumber: id, description: id, unit: 'UN', classification: 'recorrente', qty4: q4(120), price4: q4(10), monthlyQty4: q4(10), ...over });
const meas = (id: string, competence: string, status: CMeasurement['status'], kind: CMeasurement['kind'] = 'mensal'): CMeasurement => ({ id, competence, status, superseded: false, title: id, kind, createdAt: `${competence}-05T00:00:00Z` });

describe('competências', () => {
  it('soma meses e conta intervalos', () => {
    expect(compAddMonths('2026-11', 3)).toBe('2027-02');
    expect(compAddMonths('2026-01', -1)).toBe('2025-12');
    expect(compMonthsBetween('2026-07', '2027-06')).toBe(12);
    expect(compMonthsBetween('2026-07', '2026-06')).toBe(0);
  });
});

describe('reajuste (PF08)', () => {
  it('lê o índice como fator ou percentual, com até 4 casas', () => {
    expect(parseAdjustmentIndex('1,0432', 'fator')).toBe(104_320_000);
    expect(parseAdjustmentIndex('4,3215%', 'percentual')).toBe(104_321_500);
    expect(parseAdjustmentIndex('4,32151', 'percentual')).toBeNull();
    expect(parseAdjustmentIndex('abc', 'fator')).toBeNull();
  });
  it('gera a nova tabela sobre o preço vigente e calcula o retroativo medição a medição', () => {
    const lines = [line('A', { price4: q4(7.82) }), line('B', { price4: q4(126) })];
    const prices = [{ lineId: 'B', price4: q4(130), from: '2026-03', adjustmentId: 'r0' }];
    const t = adjustmentTable(lines, prices, parseAdjustmentIndex('4,3215', 'percentual')!, '2026-05');
    expect(t).toEqual([{ lineId: 'A', oldPrice4: 78_200, newPrice4: Math.round((78_200 * 104_321_500) / FACTOR) }, { lineId: 'B', oldPrice4: 1_300_000, newPrice4: 1_356_180 }]);
    expect(priceAt(lines[1]!, prices, '2026-02')).toBe(q4(126));
    expect(priceAt(lines[1]!, prices, '2026-04')).toBe(q4(130));
    const ms = [meas('m4', '2026-04', 'faturada'), meas('m5', '2026-05', 'faturada'), meas('m6', '2026-06', 'atestada')];
    const mi: CMeasurementItem[] = [
      { measurementId: 'm4', lineId: 'B', qty4: q4(10), price4: q4(130), allocations: [], uncovered4: 0 },
      { measurementId: 'm5', lineId: 'B', qty4: q4(10), price4: q4(130), allocations: [], uncovered4: 0 },
      { measurementId: 'm5', lineId: 'A', qty4: q4(100), price4: 78_200, allocations: [], uncovered4: 0 },
      { measurementId: 'm6', lineId: 'B', qty4: q4(5), price4: q4(130), allocations: [], uncovered4: 0 },
    ];
    const r = retroactiveFor(ms, mi, t, '2026-05');
    expect(r.invoiced).toHaveLength(1); // abril é anterior ao início
    expect(r.invoiced[0]!.items.find((i) => i.lineId === 'B')!.diffV4).toBe(value4(q4(10), 1_356_180) - value4(q4(10), q4(130)));
    expect(r.invoiced[0]!.diffV4).toBe(r.invoiced[0]!.items.reduce((a, i) => a + i.diffV4, 0));
    expect(r.reprice).toEqual([{ measurementId: 'm6', lineId: 'B', oldPrice4: q4(130), newPrice4: 1_356_180 }]);
  });
});

describe('rateio entre fontes (RN09-a)', () => {
  it('divide pela proporção sem perder fração', () => {
    const m = splitByShares(10, [{ sourceId: 'e', ppm: 333_333 }, { sourceId: 'm', ppm: 666_667 }]);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(10);
    expect(m.get('m')).toBe(7);
  });
  it('cada fonte baixa nos seus empenhos; o que a fonte não cobre fica aguardando empenho', () => {
    const commitments: CCommitment[] = [
      { id: 'E1', number: '2026NE1', fiscalYear: 2026, issuedOn: '2026-01-10', cancelled: false, source: null, sourceId: 'est' },
      { id: 'M1', number: '2026NE2', fiscalYear: 2026, issuedOn: '2026-01-05', cancelled: false, source: null, sourceId: 'mun' },
    ];
    const items: CCommitmentItem[] = [{ id: 'ie', commitmentId: 'E1', lineId: 'A', code: null, itemNumber: null, qty4: q4(100), adjust4: 0 }, { id: 'im', commitmentId: 'M1', lineId: 'A', code: null, itemNumber: null, qty4: q4(10), adjust4: 0 }];
    const balances = new Map([['ie', q4(100)], ['im', q4(10)]]);
    const r = allocateRateio('A', q4(40), '2026-06', { commitments, items, balances, shares: [{ sourceId: 'est', ppm: PPM * 0.6 }, { sourceId: 'mun', ppm: PPM * 0.4 }] });
    expect(r.allocations).toEqual([{ commitmentItemId: 'ie', qty4: q4(24) }, { commitmentItemId: 'im', qty4: q4(10) }]);
    expect(r.uncovered4).toBe(q4(6)); // municipal devia 16, só tinha 10
    // sem proporção vigente: FIFO comum (a NE mais antiga primeiro)
    const f = allocateRateio('A', q4(15), '2026-06', { commitments, items, balances: new Map([['ie', q4(100)], ['im', q4(10)]]), shares: [] });
    expect(f.allocations).toEqual([{ commitmentItemId: 'im', qty4: q4(10) }, { commitmentItemId: 'ie', qty4: q4(5) }]);
  });
});

describe('projeções (PF07)', () => {
  const lines = [line('R'), line('D', { classification: 'demanda', monthlyQty4: null, qty4: q4(50) })];
  const commitments: CCommitment[] = [{ id: 'N', number: '2026NE9', fiscalYear: 2026, issuedOn: '2026-01-02', cancelled: false, source: null }];
  const items: CCommitmentItem[] = [{ id: 'nr', commitmentId: 'N', lineId: 'R', code: null, itemNumber: null, qty4: q4(80), adjust4: 0 }];
  const ms = [meas('a', '2026-08', 'faturada'), meas('b', '2026-09', 'atestada'), meas('c', '2026-10', 'atestada'), meas('x', '2026-09', 'atestada', 'avulsa')];
  const mi: CMeasurementItem[] = [
    { measurementId: 'a', lineId: 'R', qty4: q4(12), price4: q4(10), allocations: [{ commitmentItemId: 'nr', qty4: q4(12) }], uncovered4: 0 },
    { measurementId: 'b', lineId: 'R', qty4: q4(12), price4: q4(10), allocations: [{ commitmentItemId: 'nr', qty4: q4(12) }], uncovered4: 0 },
    { measurementId: 'c', lineId: 'R', qty4: q4(12), price4: q4(10), allocations: [{ commitmentItemId: 'nr', qty4: q4(12) }], uncovered4: 0 },
    // avulso grande não pode contaminar a média
    { measurementId: 'x', lineId: 'R', qty4: q4(30), price4: q4(10), allocations: [{ commitmentItemId: 'nr', qty4: q4(30) }], uncovered4: 0 },
    { measurementId: 'x', lineId: 'D', qty4: q4(5), price4: q4(10), allocations: [], uncovered4: q4(5) },
  ];
  const bal = lineBalances({ lines, commitments, items, measurements: ms, mItems: mi, reservations: [{ lineId: 'D', qty4: q4(2), opportunityId: 'o' }] });
  const p = commitmentProjection({ today: '2026-11-05', startAt: '2026-01-02', endAt: '2027-06-30', windowMonths: 3, lines, bal, commitments, items, ciBal: commitmentItemBalances(items, ms, mi), measurements: ms, mItems: mi, reservations: [{ lineId: 'D', qty4: q4(2), opportunityId: 'o' }] });
  it('média só das medições mensais e esgotamento antes do fim da vigência', () => {
    const r = p.lines.find((x) => x.lineId === 'R')!;
    expect(r).toMatchObject({ avgMonthly4: q4(12), avgAvulso4: q4(10), basis: 'media', remaining4: q4(120 - 66), monthsLeft: 8 });
    expect(r.exhaustCompetence).toBe('2027-03'); // 54 / 12 = 4,5 meses a partir de nov
    expect(r.status).toBe('esgota_antes');
    expect(p.lines.find((x) => x.lineId === 'D')!.status).toBe('sem_base');
    expect(p.exhaustBefore).toEqual([{ itemNumber: 'R', competence: '2027-03' }]);
  });
  it('empenho por exercício, cobertura da NE e previsão de faturamento', () => {
    // NE do ano tem 80 − 66 = 14: cobre novembro (12) e não dezembro
    expect(p.commitments[0]).toMatchObject({ coversUntil: '2026-11', shortBeforeYearEnd: true });
    expect(p.years.map((y) => [y.year, y.months])).toEqual([[2026, 2], [2027, 6]]);
    expect(p.years[0]).toMatchObject({ projectedV4: value4(q4(24), q4(10)), coveredV4: value4(q4(14), q4(10)), needV4: value4(q4(10), q4(10)) });
    expect(p.years[1]!.projectedV4).toBe(value4(q4(54 - 24), q4(10))); // limitado ao saldo do contrato
    expect(p.forecast.slice(0, 2).map((f) => f.recurringV4)).toEqual([value4(q4(12), q4(10)), value4(q4(12), q4(10))]);
    expect(p.toInvoiceV4).toBe(value4(q4(12 + 12 + 30 + 5), q4(10)));
    expect(p.pipelineV4).toBe(value4(q4(2), q4(10)));
    expect(p.nextInstallmentShort).toEqual([]);
  });
  it('mês atual com a medição mensal já lançada não conta de novo', () => {
    const q = commitmentProjection({ today: '2026-10-20', startAt: '2026-01-02', endAt: '2027-06-30', windowMonths: 3, lines, bal, commitments, items, ciBal: commitmentItemBalances(items, ms, mi), measurements: ms, mItems: mi, reservations: [] });
    expect(q.from).toBe('2026-11');
    expect(q.window).toMatchObject({ from: '2026-08', to: '2026-10' });
    expect(q.monthsLeft).toBe(8);
    expect(q.years[0]!.year).toBe(2026);
  });
  it('curva acumulada das quatro linhas', () => {
    const c = commitmentCurve({ today: '2026-11-05', startAt: '2026-08-01', lines, commitments, items, measurements: ms.map((m) => ({ ...m, invoiceDate: m.status === 'faturada' ? '2026-09-10' : null })), mItems: mi });
    expect(c.map((x) => x.competence)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    const sep = c.find((x) => x.competence === '2026-09')!;
    expect(sep).toMatchObject({ committedV4: value4(q4(80), q4(10)), executedV4: value4(q4(12 + 12 + 30 + 5), q4(10)), invoicedV4: value4(q4(12), q4(10)) });
    expect(c.find((x) => x.competence === '2026-08')!.invoicedV4).toBe(0);
  });
});
