import { describe, expect, it } from 'vitest';
import { deliveryNeeds, giftConsolidated, kitCost, kitsAvailable, stockShortages, weightedCost } from './gifts';

const items = [{ id: 'cam', name: 'Camiseta', unitCostCents: 3500, stock: 10 }, { id: 'cop', name: 'Copo', unitCostCents: 1200, stock: 3 }];
describe('brindes', () => {
  it('custo do kit é a soma dos itens; quantos kits dá para montar', () => {
    const k = kitCost([{ itemId: 'cam', qty: 1 }, { itemId: 'cop', qty: 2 }], items);
    expect(k.cents).toBe(3500 + 2400);
    expect(kitsAvailable([{ itemId: 'cam', qty: 1 }, { itemId: 'cop', qty: 2 }], items)).toBe(1);
  });
  it('custo médio ponderado na entrada', () => {
    expect(weightedCost(10, 3500, 10, 4500)).toBe(4000);
    expect(weightedCost(0, 3500, 5, 4500)).toBe(4500);
  });
  it('envio: soma itens do kit e avulsos; aponta falta de estoque', () => {
    const n = deliveryNeeds([{ itemId: 'cam', qty: 1 }, { itemId: 'cop', qty: 2 }], 2, [{ itemId: 'cop', qty: 1 }]);
    expect(n).toEqual([{ itemId: 'cam', qty: 2 }, { itemId: 'cop', qty: 5 }]);
    expect(stockShortages(n, items)).toEqual([{ itemId: 'cop', name: 'Copo', need: 5, stock: 3 }]);
  });
  it('consolidado da conta ignora cancelados', () => {
    const base = { occurredOn: '2026-11-01', categoryName: 'Executivo', items: [{ itemId: 'cam', name: 'Camiseta', qty: 2, unitCostCents: 3500 }], stakeholderIds: ['p1'] };
    const c = giftConsolidated([
      { ...base, id: '1', kitId: 'k', kitName: 'Kit boas-vindas', kits: 2, totalCents: 7000, cancelled: false },
      { ...base, id: '2', kitId: 'k', kitName: 'Kit boas-vindas', kits: 1, totalCents: 3500, cancelled: true },
    ]);
    expect(c).toMatchObject({ totalCents: 7000, kits: 2, deliveries: 1 });
    expect(c.byKit[0]).toMatchObject({ name: 'Kit boas-vindas', qty: 2, totalCents: 7000 });
    expect(c.byStakeholder[0]).toMatchObject({ key: 'p1', qty: 2 });
  });
});
