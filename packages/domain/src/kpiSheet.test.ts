import { describe, expect, it } from 'vitest';
import { kpiAttainment, kpiStatus, kpiTarget, parseKpiForm, parseQuarterTargets, aggregate } from './indicators';

const rows = (pairs: [string, string | number | null][]) => [['FORMULÁRIO DE CRIAÇÃO DE INDICADORES DE DESEMPENHO (KPI)'], ['1. INFORMAÇÕES BÁSICAS'], ...pairs.map(([a, b]) => [a, b])] as (string | number | null)[][];

describe('ficha do KPI', () => {
  it('lê metas trimestrais em texto', () => {
    expect(parseQuarterTargets('1T e 4T - 35% / 2T - 60% / 3T - 50%', 'percentual')).toEqual([35, 60, 50, 35]);
    expect(parseQuarterTargets('1T 60% / 2T - 80% / 3T e 4T- 90%', 'percentual')).toEqual([60, 80, 90, 90]);
    expect(parseQuarterTargets(0.35, 'percentual')).toEqual([35, 35, 35, 35]);
    expect(parseQuarterTargets('2 dias', 'dias')).toEqual([2, 2, 2, 2]);
  });
  it('converte a aba do formulário em indicador informado', () => {
    const p = parseKpiForm('Booking', rows([
      ['Nome do KPI', 'Booking Fictício'], ['Departamento/Área', 'Comercial'], ['Responsável', 'Pessoa Exemplo'], ['Objetivo do KPI', 'Receita garantida'],
      ['Fórmula de Cálculo', 'ACV / Meta × 100'], ['Unidade de Medida', '%'], ['Fonte de Dados', 'ERP'], ['Meta Anual', 0.45], ['Meta Trimestral', '1T e 4T - 35% / 2T - 60% / 3T - 50%'],
      ['Limite Mínimo Aceitável', '80% da meta'], ['Limite Máximo Desejável', 'Qual é o valor máximo desejável?'], ['Frequência de Medição', 'Mensal'], ['Data de Início', '2026-02-02'],
    ]))!;
    expect(p.key).toBe('kpi_booking_ficticio');
    expect(p.def).toMatchObject({ calc: 'informado', unit: 'percentual', direction: 'maior', period: 'mes', target: 45, category: 'comercial' });
    expect(p.def.sheet).toMatchObject({ quarterTargets: [35, 60, 50, 35], minOfTarget: 0.8, maxDesirable: null, owner: 'Pessoa Exemplo', startDate: '2026-02-02', paused: false });
    const lead = parseKpiForm('Lead Time (Pausar)', rows([['Nome do KPI', 'Lead Time Exemplo'], ['Unidade de Medida', 'Data'], ['Meta Anual', '2 dias'], ['Meta Trimestral', '2 dias'], ['Limite Máximo Desejável', '5 dias'], ['Frequência de Medição', 'Trimestral']]))!;
    expect(lead.def).toMatchObject({ unit: 'dias', direction: 'menor', target: 2, period: 'trimestre' });
    expect(lead.def.sheet).toMatchObject({ maxDesirable: 5, paused: true });
    expect(parseKpiForm('Vazia', [['nada']])).toBeNull();
  });
  it('farol e atingimento nos dois sentidos', () => {
    const maior = { direction: 'maior' as const, sheet: { minOfTarget: 0.8 } as never };
    expect(kpiStatus(maior, 50, 45)).toBe('atingido');
    expect(kpiStatus(maior, 37, 45)).toBe('atencao');
    expect(kpiStatus(maior, 30, 45)).toBe('abaixo');
    expect(kpiStatus(maior, null, 45)).toBe('sem_dado');
    const menor = { direction: 'menor' as const, sheet: { maxDesirable: 30 } as never };
    expect(kpiStatus(menor, 12, 15)).toBe('atingido');
    expect(kpiStatus(menor, 25, 15)).toBe('atencao');
    expect(kpiStatus(menor, 35, 15)).toBe('abaixo');
    expect(kpiAttainment('menor', 30, 15)).toBe(0.5);
    expect(kpiTarget({ target: 45, sheet: { quarterTargets: [35, 60, null, 35] } as never }, 2)).toBe(60);
    expect(kpiTarget({ target: 45, sheet: { quarterTargets: [35, 60, null, 35] } as never }, 3)).toBe(45);
    expect(aggregate([30, 40], 'media')).toBe(35);
    expect(aggregate([30, 40], 'ultimo')).toBe(40);
  });
});
import { kpiBands } from './indicators';
describe('faixas da régua', () => {
  it('seguem as regras do farol', () => {
    expect(kpiBands({ direction: 'maior', sheet: { minOfTarget: 0.8 } as never }, 50)).toEqual({ direction: 'maior', target: 50, limit: 40 });
    expect(kpiBands({ direction: 'menor', sheet: { maxDesirable: 30 } as never }, 15)).toEqual({ direction: 'menor', target: 15, limit: 30 });
  });
});
