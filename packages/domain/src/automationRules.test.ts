import { describe, expect, it } from 'vitest';
import { exceptionHit } from './automationRules';

const o = { saleKind: 'consumo_contrato', segment: 'governo', nature: 'publica', branchId: 'b1', valueCents: 150_000 };
describe('exceções das automações', () => {
  it('consumo de contrato não vai para CS', () => {
    expect(exceptionHit([{ campo: 'tipo_venda', valores: ['consumo_contrato'] }], o)).toMatch(/tipo de venda/);
    expect(exceptionHit([{ campo: 'tipo_venda', valores: ['consumo_contrato'] }], { ...o, saleKind: 'venda_consultiva' })).toBeNull();
  });
  it('valores e listas', () => {
    expect(exceptionHit([{ campo: 'valor_ate', valor: 1500 }], o)).not.toBeNull();
    expect(exceptionHit([{ campo: 'valor_acima', valor: 1500 }], o)).toBeNull();
    expect(exceptionHit([{ campo: 'filial', valores: ['b2'] }, { campo: 'natureza', valores: ['publica'] }], o)).toMatch(/natureza/);
    expect(exceptionHit([], o)).toBeNull();
  });
});
