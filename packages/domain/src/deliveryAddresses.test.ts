import { describe, expect, it } from 'vitest';
import { deliveryErrors, mergeDelivery, parseDeliveryTable } from './deliveryAddresses';

describe('endereços de entrega do contrato', () => {
  it('lê colado do Excel em qualquer ordem; extras viram colunas; sequência vazia numera', () => {
    const r = parseDeliveryTable([
      ['Banda/Serviço', 'Endereço', 'Seq', 'Contato local', 'Prazo'],
      ['100 Mbps', 'Rua A, 10 - Centro', '1', 'Portaria', '30 dias'],
      ['Link dedicado 50', 'Av. B, 200', '', '', ''],
      ['', '', '3', '', ''],
      ['200 Mbps', 'Rua C, 5', 'x', '', ''],
    ]);
    expect(r.missing).toEqual([]);
    expect(r.columns).toEqual(['Contato local', 'Prazo']);
    expect(r.rows).toEqual([
      { seq: 1, address: 'Rua A, 10 - Centro', service: '100 Mbps', extra: { 'Contato local': 'Portaria', Prazo: '30 dias' } },
      { seq: 2, address: 'Av. B, 200', service: 'Link dedicado 50', extra: {} },
    ]);
    expect(r.errors.map((e) => [e.row, e.message])).toEqual([[4, 'Endereço vazio.'], [5, 'Sequência deve ser um número inteiro.']]);
  });
  it('sem coluna de endereço: avisa', () => {
    expect(parseDeliveryTable([['Seq', 'Banda'], ['1', '100']]).missing).toEqual(['Endereço']);
  });
  it('continua a numeração dos já cadastrados e junta (mesma sequência substitui)', () => {
    const cur = { columns: ['Prazo'], rows: [{ seq: 1, address: 'Rua A', service: null, extra: {} }, { seq: 2, address: 'Rua B', service: null, extra: {} }] };
    const r = parseDeliveryTable([['Endereço', 'prazo'], ['Rua C', '10 dias']], cur);
    expect(r.columns).toEqual(['Prazo']);
    expect(r.rows[0]).toMatchObject({ seq: 3, extra: { Prazo: '10 dias' } });
    const m = mergeDelivery(cur, { columns: r.columns, rows: [...r.rows, { seq: 1, address: 'Rua A nova', service: '50', extra: {} }] });
    expect(m.rows.map((x) => [x.seq, x.address])).toEqual([[1, 'Rua A nova'], [2, 'Rua B'], [3, 'Rua C']]);
  });
  it('validação: sequência repetida, endereço vazio, coluna repetida', () => {
    expect(deliveryErrors({ columns: ['Prazo', 'prazo'], rows: [{ seq: 1, address: 'A', service: null, extra: {} }, { seq: 1, address: '', service: null, extra: {} }] })).toEqual(['Coluna repetida: prazo.', 'Linha 2: endereço vazio.', 'Sequência 1 repetida.']);
    expect(deliveryErrors({ columns: ['Endereço'], rows: [] })).toEqual(['Coluna repetida: Endereço.']);
  });
});
