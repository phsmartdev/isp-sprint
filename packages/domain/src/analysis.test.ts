import { describe, expect, it } from 'vitest';
import { analysisGaps, confirmedRoots, diagnosisFrom, paretoRows, EMPTY_ANALYSIS, type AnalysisContent } from './analysis';

const full: AnalysisContent = {
  problem: { what: 'Conversão de propostas abaixo da meta', where: 'Time Empresarial', when: 'Setembro', howMuch: '62% da meta' },
  pareto: { title: 'Motivos de perda', source: 'manual', items: [{ label: 'Preço', value: 12 }, { label: 'Cobertura', value: 5 }, { label: 'Concorrente', value: 2 }, { label: 'Outro', value: 1 }] },
  causes: [
    { id: 'a', category: 'material', text: 'Preço acima da concorrência', selected: true },
    { id: 'b', category: 'metodo', text: 'Proposta sem comparativo', selected: false },
    { id: 'c', category: 'meio', text: 'Entrada de concorrente regional', selected: false },
  ],
  whys: [{ causeId: 'a', whys: ['Cliente acha caro', 'Não vê o valor do link dedicado', 'Proposta não mostra o custo atual dele'], rootCause: 'Proposta sem comparação com a situação atual', evidence: '9 de 12 perdas sem comparativo anexado', confirmed: true }],
};

describe('Pareto', () => {
  it('ordena, acumula e marca os poucos vitais até cruzar 80%', () => {
    const p = paretoRows(full.pareto!.items);
    expect(p.total).toBe(20);
    expect(p.rows.map((r) => r.label)).toEqual(['Preço', 'Cobertura', 'Concorrente', 'Outro']);
    expect(p.rows.map((r) => r.vital)).toEqual([true, true, false, false]);
    expect(p.rows[1]!.cumulative).toBeCloseTo(0.85);
  });
  it('ignora vazios e não positivos; exatamente 80% fecha o corte', () => {
    expect(paretoRows([{ label: '', value: 3 }, { label: 'X', value: 0 }]).rows).toHaveLength(0);
    expect(paretoRows([{ label: 'A', value: 8 }, { label: 'B', value: 2 }]).rows.map((r) => r.vital)).toEqual([true, false]);
  });
});

describe('jornada', () => {
  it('análise vazia aponta pendências em todas as etapas', () => {
    const steps = new Set(analysisGaps(EMPTY_ANALYSIS).map((g) => g.step));
    expect([...steps]).toEqual(['problema', 'pareto', 'ishikawa', 'conclusao']);
  });
  it('completa não tem pendências e gera o diagnóstico', () => {
    expect(analysisGaps(full)).toEqual([]);
    expect(confirmedRoots(full)).toHaveLength(1);
    const d = diagnosisFrom(full);
    expect(d).toContain('Concentração (Pareto): Preço, Cobertura');
    expect(d).toContain('Proposta sem comparação com a situação atual (Oferta)');
  });
  it('causa escolhida exige 3 porquês e causa raiz; confirmação exige evidência', () => {
    const a = { ...full, whys: [{ ...full.whys[0]!, whys: ['a', 'b'] }] };
    expect(analysisGaps(a).some((g) => g.step === 'porques')).toBe(true);
    const b = { ...full, whys: [{ ...full.whys[0]!, evidence: '' }] };
    expect(analysisGaps(b).map((g) => g.step)).toEqual(['conclusao']);
  });
});
