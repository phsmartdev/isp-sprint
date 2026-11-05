import { describe, expect, it } from 'vitest';
import { itemErrors, itemTotal, itemsTotals, parseItemsTable, parseMoney, parseQty, parseUnit } from './items';

describe('itens da oportunidade', () => {
  it('total da linha e da oportunidade, com desconto, acréscimo e lance', () => {
    expect(itemTotal({ qtyMilli: 2500, unitCents: 10000, discountCents: 2000, surchargeCents: 500 })).toBe(23500);
    const t = itemsTotals([
      { qtyMilli: 1000, unitCents: 100000, discountCents: 0, surchargeCents: 0, bidUnitCents: 90000 },
      { qtyMilli: 3000, unitCents: 5000, discountCents: 1000, surchargeCents: 0, bidUnitCents: null },
    ]);
    expect(t).toMatchObject({ count: 2, gross: 115000, discount: 1000, total: 114000, bidTotal: 90000, bidItems: 1 });
    expect(itemErrors({ description: 'Link', unit: 'un', qtyMilli: 1000, unitCents: 100, discountCents: 200, surchargeCents: 0 })).toMatch(/desconto/);
  });

  it('lê números, medidas e a tabela colada do Excel; linhas ruins voltam com o motivo', () => {
    expect(parseMoney('R$ 1.234,56')).toBe(123456);
    expect(parseMoney('1234.5')).toBe(123450);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.500')).toBe(150000);
    expect(parseQty('2,5')).toBe(2500);
    expect(parseUnit('Horas')).toBe('h');
    expect(parseUnit('KM')).toBe('km');
    const r = parseItemsTable([
      ['Produto/Serviço', 'Valor', 'Medida', 'Quantidade', 'Desconto', 'Acréscimo', 'Observação', 'Lance'],
      ['Link dedicado 200 Mb', '1.500,00', 'Un', '2', '100,00', '', 'Prédio sede', '1.400,00'],
      ['Lançamento de fibra', '3,20', 'Km', '1,5', '', '', '', ''],
      ['Suporte', '80', 'diária', '1', '', '', '', ''],
      ['', '', '', '', '', '', '', ''],
    ]);
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({ description: 'Link dedicado 200 Mb', unitCents: 150000, qtyMilli: 2000, discountCents: 10000, notes: 'Prédio sede', bidUnitCents: 140000 });
    expect(r.items[1]).toMatchObject({ unit: 'km', qtyMilli: 1500, bidUnitCents: null });
    expect(r.items[2]).toMatchObject({ description: 'Suporte', unit: 'un', notes: 'Unidade: diária' });
    expect(r.errors).toEqual([]);
    expect(parseItemsTable([['Nome', 'Preço']]).missing).toEqual(['Quantidade']);
    expect(parseItemsTable([['Código', 'Total']]).missing).toEqual(['Descrição', 'Quantidade', 'Valor unitário']);
  });

  it('colar do Excel: as quatro ordens de colunas dos editais, ITEM opcional', () => {
    const orders = [
      [['ITEM', 'DESCRIÇÃO', 'UNIDADE', 'QUANTIDADE', 'VALOR UNITÁRIO ITEM'], ['1', 'Roteador Wi-Fi 6', 'UN', '10', '1.250,00']],
      [['DESCRIÇÃO', 'QUANTIDADE', 'UNIDADE', 'VALOR UNITÁRIO'], ['Roteador Wi-Fi 6', '10', 'UN', '1.250,00']],
      [['ITEM', 'DESCRIÇÃO', 'UNIDADE', 'QUANTIDADE', 'VALOR UNITÁRIO'], ['1', 'Roteador Wi-Fi 6', 'UN', '10', 'R$ 1.250,00']],
      [['ITEM', 'DESCRIÇÃO', 'QUANTIDADE', 'UNIDADE', 'VALOR UNITÁRIO'], ['1', 'Roteador Wi-Fi 6', '10', 'UN', '1250,00']],
    ];
    for (const rows of orders) {
      const r = parseItemsTable(rows);
      expect(r.missing).toEqual([]);
      expect(r.items).toEqual([expect.objectContaining({ description: 'Roteador Wi-Fi 6', unit: 'un', qtyMilli: 10_000, unitCents: 125_000 })]);
    }
    expect(parseItemsTable(orders[0]!).items[0]!.notes).toBe('Item 1');
    expect(parseItemsTable(orders[1]!).items[0]!.notes).toBeNull();
    // valor total não é confundido com o unitário; unidade fora da lista vira Un com a original na observação
    const t = parseItemsTable([['Item', 'Descrição', 'Unid.', 'Qtd.', 'Valor Total (R$)', 'Valor Unit. (R$)'], ['2', 'Link 200 Mb', 'MÊS', '12', '18.000,00', '1.500,00']]);
    expect(t.items[0]).toMatchObject({ unitCents: 150_000, qtyMilli: 12_000, unit: 'un', notes: 'Item 2 · Unidade: MÊS' });
    // sem coluna de descrição, ITEM é a descrição (como antes)
    expect(parseItemsTable([['Item', 'Quantidade', 'Valor'], ['Instalação', '1', '300']]).items[0]).toMatchObject({ description: 'Instalação', notes: null });
  });
});

describe('produtos do contrato a partir da oportunidade ou planilha', () => {
  it('oportunidade: lance, desconto, cobrança e quantidade fracionada', async () => {
    const { contractItemFromOpportunity } = await import('./items');
    expect(contractItemFromOpportunity({ description: 'Link 500M', qtyMilli: 2000, unitCents: 150000, discountCents: 0, surchargeCents: 0, dealKind: 'recorrencia' })).toEqual({ planId: null, description: 'Link 500M', qty: 2, unitCents: 150000, recurring: true });
    expect(contractItemFromOpportunity({ description: 'Instalação', qtyMilli: 1000, unitCents: 200000, discountCents: 50000, dealKind: 'servico' })).toMatchObject({ qty: 1, unitCents: 150000, recurring: false });
    expect(contractItemFromOpportunity({ description: 'Fibra', unit: 'km', qtyMilli: 2500, unitCents: 1000, dealKind: 'venda' })).toEqual({ planId: null, description: 'Fibra (2,5 Km)', qty: 1, unitCents: 2500, recurring: false });
    expect(contractItemFromOpportunity({ description: 'Câmera', qtyMilli: 3000, unitCents: 999, bidUnitCents: 900, dealKind: 'locacao' })).toMatchObject({ qty: 3, unitCents: 900, recurring: true });
    expect(contractItemFromOpportunity({ description: 'Licença', qtyMilli: 3000, unitCents: 1000, discountCents: 1 })).toMatchObject({ qty: 1, unitCents: 2999, description: 'Licença (3)' });
  });
  it('planilha: colunas em qualquer ordem, cobrança opcional e linhas recusadas com motivo', async () => {
    const { parseContractItemsTable } = await import('./items');
    const r = parseContractItemsTable([
      ['Valor unitário', 'Descrição', 'Qtd', 'Cobrança'],
      ['1.500,00', 'Link dedicado', '2', 'Mensal'],
      ['2000', 'Instalação', '1', 'Única'],
      ['x', 'Erro', '1', 'Mensal'],
      ['10', 'Outro', '1', 'Trimestral'],
    ]);
    expect(r.items).toEqual([
      { planId: null, description: 'Link dedicado', qty: 2, unitCents: 150000, recurring: true },
      { planId: null, description: 'Instalação', qty: 1, unitCents: 200000, recurring: false },
    ]);
    expect(r.errors.map((e) => e.row)).toEqual([4, 5]);
    expect(parseContractItemsTable([['Descrição', 'Qtd', 'Valor'], ['Link', '1', '10']]).items[0]).toMatchObject({ recurring: true, unitCents: 1000 });
    expect(parseContractItemsTable([['Nome', 'Preço']]).missing).toEqual(['Quantidade']);
  });
});
