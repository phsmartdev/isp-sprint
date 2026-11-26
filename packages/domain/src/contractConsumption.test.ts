import { describe, expect, it } from 'vitest';
import { calculateContractConsumption } from './contractConsumption';
import { emptyEconInput } from './finance';

describe('inferência do consumo de contrato', () => {
  it('preserva repasse, valores únicos e mensais em cestas mistas', () => {
    const line = { description: 'Item contratado', qtyMilli: 5000, unitCents: 10000 };
    const result = calculateContractConsumption({
      ...emptyEconInput(), extraInitialCents: 60000,
      capex: [{ ...line, kind: 'venda' }, { ...line, kind: 'servico' }],
      opex: [{ ...line, kind: 'locacao' }, { ...line, kind: 'recorrencia' }],
    }, { serviceCostBp: 3500 });
    expect(result.totals).toEqual([
      { kind: 'venda', frequency: 'unico', contractCents: 50000, inferenceCents: 0 },
      { kind: 'servico', frequency: 'unico', contractCents: 50000, inferenceCents: 17500 },
      { kind: 'locacao', frequency: 'mensal', contractCents: 50000, inferenceCents: 17500 },
      { kind: 'recorrencia', frequency: 'mensal', contractCents: 50000, inferenceCents: 17500 },
    ]);
  });

  it('reabre uma seção antiga sem descartar itens sem categoria nem confundir zero com falta de parâmetro', () => {
    const input = { ...emptyEconInput(), sections: [{
      id: 's1', kind: 'recorrencia' as const, termMonths: 12, receiveMonth: 0, marginTargetBp: null, paybackMonths: null, priceCents: null,
      costs: [{ description: 'Serviço já lançado', qtyMilli: 1250, unitCents: 10001, category: null, frequency: 'mensal' as const }],
    }] };
    expect(calculateContractConsumption(input, null).totals).toEqual([{ kind: 'recorrencia', frequency: 'mensal', contractCents: 12501, inferenceCents: null }]);
    expect(calculateContractConsumption(input, { serviceCostBp: 0 }).totals[0]?.inferenceCents).toBe(0);
  });
});
