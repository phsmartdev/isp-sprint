import { describe, expect, it } from 'vitest';
import { allocateFifo, commitmentAlerts, commitmentItemBalances, contractTotals, fillSheetPrices, lineBalances, parseCommitmentSheet, q4, value4, type CCommitment, type CCommitmentItem, type CLine, type CMeasurement, type CMeasurementItem } from './commitments';

const line = (id: string, qty: number, price: number, extra: Partial<CLine> = {}): CLine => ({ id, itemNumber: id, description: `Item ${id}`, unit: 'UN', classification: 'demanda', qty4: q4(qty), price4: q4(price), monthlyQty4: null, ...extra });
const ne = (id: string, year: number, issuedOn: string, cancelled = false): CCommitment => ({ id, number: `${year}NE${id}`, fiscalYear: year, issuedOn, cancelled, source: null });
const ci = (id: string, commitmentId: string, lineId: string, qty: number): CCommitmentItem => ({ id, commitmentId, lineId, code: null, itemNumber: null, qty4: q4(qty), adjust4: 0 });

describe('controle de empenhos', () => {
  const lines = [line('L1', 100, 50), line('L2', 10, 1000)];
  const commitments = [ne('A', 2026, '2026-02-01'), ne('B', 2026, '2026-05-01'), ne('X', 2025, '2025-03-01')];
  const items = [ci('a1', 'A', 'L1', 30), ci('b1', 'B', 'L1', 50), ci('x1', 'X', 'L1', 20)];

  it('FIFO no exercício da competência; o que não couber fica aguardando empenho', () => {
    const bal = commitmentItemBalances(items, [], []);
    const r = allocateFifo('L1', q4(70), '2026-06', { commitments, items, balances: bal });
    expect(r.allocations).toEqual([{ commitmentItemId: 'a1', qty4: q4(30) }, { commitmentItemId: 'b1', qty4: q4(40) }]);
    expect(r.uncovered4).toBe(0);
    const over = allocateFifo('L1', q4(20), '2026-07', { commitments, items, balances: bal });
    expect(over).toEqual({ allocations: [{ commitmentItemId: 'b1', qty4: q4(10) }], uncovered4: q4(10) }); // a NE de 2025 não cobre 2026
  });

  it('saldos em três níveis, recalculados do histórico (revisada e cancelada não contam)', () => {
    const ms: CMeasurement[] = [
      { id: 'm1', competence: '2026-06', status: 'faturada', superseded: false, title: 'Junho', kind: 'mensal', createdAt: '2026-06-30' },
      { id: 'm2', competence: '2026-07', status: 'elaboracao', superseded: false, title: 'Julho', kind: 'mensal', createdAt: '2026-07-30' },
      { id: 'm0', competence: '2026-06', status: 'atestada', superseded: true, title: 'Junho (v1)', kind: 'mensal', createdAt: '2026-06-29' },
      { id: 'mc', competence: '2026-06', status: 'cancelada', superseded: false, title: 'Errada', kind: 'avulsa', createdAt: '2026-06-29' },
    ];
    const mi: CMeasurementItem[] = [
      { measurementId: 'm1', lineId: 'L1', qty4: q4(70), price4: q4(50), allocations: [{ commitmentItemId: 'a1', qty4: q4(30) }, { commitmentItemId: 'b1', qty4: q4(40) }], uncovered4: 0 },
      { measurementId: 'm2', lineId: 'L1', qty4: q4(20), price4: q4(50), allocations: [{ commitmentItemId: 'b1', qty4: q4(10) }], uncovered4: q4(10) },
      { measurementId: 'm0', lineId: 'L1', qty4: q4(99), price4: q4(50), allocations: [], uncovered4: 0 },
      { measurementId: 'mc', lineId: 'L1', qty4: q4(5), price4: q4(50), allocations: [], uncovered4: 0 },
    ];
    const bal = lineBalances({ lines, commitments, items, measurements: ms, mItems: mi, reservations: [{ lineId: 'L1', qty4: q4(5), opportunityId: 'o1' }] });
    const b1 = bal.find((b) => b.lineId === 'L1')!;
    expect(b1).toMatchObject({ committed4: q4(100), executed4: q4(70), pending4: q4(20), reserved4: q4(5), invoiced4: q4(70), available4: q4(5), toCommit4: q4(0), uncovered4: q4(10) });
    expect(b1.commitmentBalance4).toBe(q4(100 - 70 - 10));
    const t = contractTotals(lines, bal);
    expect(t.contracted).toBe(value4(q4(100), q4(50)) + value4(q4(10), q4(1000)));
    expect(t.uncovered).toBe(value4(q4(10), q4(50)));
    const al = commitmentAlerts({ today: '2026-11-05', lines, bal, commitments, items, measurements: ms, mItems: mi });
    expect(al.map((a) => a.key)).toEqual(expect.arrayContaining(['aguardando_empenho', 'a_empenhar', 'ne_exercicio_anterior']));
    expect(al.map((a) => a.key)).not.toContain('virada'); // as NEs de 2026 já foram consumidas
  });

  it('lê a planilha de controle (itens, empenhos e blocos de medição)', () => {
    const r = parseCommitmentSheet([
      [null, 'Relação de Itens - Contrato nº 34/2025', null, null, null, null, null, null, null, null, 'Medição 24/07/26', null, null, null, 'Medição 04/08/26 - Mensal'],
      [null, 'Nº do Empenho', 'Item do Empenho', 'Código do Item do Empenho', 'Item', 'Especificação', 'Unidade de medida', 'Qtde', 'Valor Unit. Anual', 'Valor Total Anual', 'Qtde', 'Valor Total', 'Saldo', null, 'Qtde', 'Valor Total', 'Saldo'],
      [null, '2026NE002244', 1, '460270-6', 15, 'Projeto executivo', 'METRO', '20000', 7.82, 156400, '8000', 0, 12000, null, '', 0, 12000],
      [null, '2026NE002244', 2, '460271-4', 16, 'Projeto executivo de folha', 'FOLHA', 50, '1.920,80', 96040, null, 0, 50, null, 26, 0, 24],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.measurements).toEqual([{ title: 'Medição 24/07/26', date: '2026-07-24', kind: 'avulsa' }, { title: 'Medição 04/08/26 - Mensal', date: '2026-08-04', kind: 'mensal' }]);
    expect(r.rows[0]).toMatchObject({ commitment: '2026NE002244', commitmentItem: '1', code: '460270-6', itemNumber: '15', unit: 'METRO', qty: 20000, unitPrice: 7.82, measured: [8000, 0] });
    expect(r.rows[1]).toMatchObject({ unitPrice: 1920.8, measured: [0, 26] });
  });

  it('completa o valor unitário pela outra aba (mesmo NE + item do empenho, ou código)', () => {
    const head = [null, 'Nº do Empenho', 'Item do Empenho', 'Código do Item do Empenho', 'Item', 'Especificação', 'Unidade de medida', 'Qtde', 'Valor Unit. Anual'];
    const med = parseCommitmentSheet([head, [null, '2026NE1', 1, 'A', 1, 'OLT', 'UN', '1', null], [null, '2026NE1', 2, 'B', 2, 'ONU', 'UN', '200', null], [null, '2026NE2', 1, 'C', 3, 'Cabo', 'M', '10', null]]);
    expect(med.errors[0]).toMatch(/3 item/);
    const pe = parseCommitmentSheet([head, [null, '2026NE1', 1, 'X', 1, 'OLT', 'UN', 1, 364342.41], [null, '2026NE9', 9, 'B', 2, 'ONU', 'UN', 200, 955.52]]);
    const r = fillSheetPrices(med, [pe]);
    expect(r.rows.map((x) => x.unitPrice)).toEqual([364342.41, 955.52, null]);
    expect(r.filled).toBe(2);
    expect(r.errors).toEqual(['1 item(ns) sem valor unitário na planilha: informe depois em cada item.']);
  });
});
