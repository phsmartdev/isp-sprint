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
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ description: 'Link dedicado 200 Mb', unitCents: 150000, qtyMilli: 2000, discountCents: 10000, notes: 'Prédio sede', bidUnitCents: 140000 });
    expect(r.items[1]).toMatchObject({ unit: 'km', qtyMilli: 1500, bidUnitCents: null });
    expect(r.errors).toEqual([{ row: 4, message: expect.stringMatching(/diária/) }]);
    expect(parseItemsTable([['Nome', 'Preço']]).missing).toEqual(['Produto/Serviço', 'Quantidade']);
  });
});
