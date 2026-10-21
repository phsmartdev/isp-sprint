import { describe, expect, it } from 'vitest';
import { canLinkObjective, consolidate, trafficLight, SUGGESTED_INDICATORS, attainment, combine, compositeScore, evalFormula, goalStatus, normalizeWeights, parseFormula, periodRange, previousRange, scorecardScore, validateIndicator, validateScorecard } from './indicators';

describe('fórmula segura', () => {
  it('calcula com precedência, parênteses, funções e vírgula decimal', () => {
    const p = parseFormula('ganhas / (ganhas + perdidas) * 100', ['ganhas', 'perdidas']);
    expect(p.ok && evalFormula(p.ast, { ganhas: 3, perdidas: 1 })).toBe(75);
    const q = parseFormula('round(max(a; b) × 1,5 - -2, 1)', ['a', 'b']);
    expect(q.ok && evalFormula(q.ast, { a: 2, b: 3 })).toBe(6.5);
  });
  it('recusa código, variáveis não declaradas e sintaxe quebrada', () => {
    for (const bad of ['process.exit()', 'a; drop table x', 'constructor', 'a +', '(a', 'a b', 'require("fs")', 'a[0]', '`x`', 'a ** 2', '1e9']) expect(parseFormula(bad, ['a']).ok, bad).toBe(false);
    expect(parseFormula('x * 2', ['a'])).toMatchObject({ ok: false, error: 'variável "x" não declarada' });
  });
  it('divisão por zero e dado ausente viram "sem base" (null), nunca número inventado', () => {
    const p = parseFormula('a / b', ['a', 'b']);
    expect(p.ok && evalFormula(p.ast, { a: 1, b: 0 })).toBeNull();
    expect(p.ok && evalFormula(p.ast, { a: 1, b: null })).toBeNull();
    expect(combine({ calc: 'percentual' }, { num: 3, den: 0 })).toBeNull();
    expect(combine({ calc: 'percentual' }, { num: 3, den: 4 })).toBe(75);
  });
});

describe('indicadores, metas e scorecards', () => {
  it('sugestões são válidas; validação aponta erros de origem e fórmula', () => {
    for (const s of SUGGESTED_INDICATORS) expect(validateIndicator(s), s.key).toEqual([]);
    const e = validateIndicator({ name: 'X', category: 'comercial', calc: 'formula', unit: 'indice', direction: 'maior', period: 'mes', vars: { A: { event: 'nada', measure: 'contagem' } }, expr: 'A +' });
    expect(e.join(' ')).toMatch(/nome/);
    expect(e.join(' ')).toMatch(/Variável "A"/);
    expect(e.join(' ')).toMatch(/evento desconhecido/);
    expect(e.join(' ')).toMatch(/Fórmula/);
  });
  it('períodos e período anterior', () => {
    expect(periodRange('semana', '2026-10-21')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(periodRange('mes', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('trimestre', '2026-11-30')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(previousRange({ from: '2026-10-01', to: '2026-10-31' }, 'mes')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousRange({ from: '2026-10-11', to: '2026-10-20' })).toEqual({ from: '2026-10-01', to: '2026-10-10' });
  });
  it('cumprimento para maior e menor é melhor', () => {
    expect(attainment(8, 10, 'maior')).toBe(0.8);
    expect(attainment(20, 24, 'menor')).toBe(1.2);
    expect(attainment(48, 24, 'menor')).toBe(0.5);
    expect(attainment(null, 10, 'maior')).toBeNull();
  });
  it('situação da meta pelo ritmo do período', () => {
    const r = { from: '2026-10-01', to: '2026-10-31' };
    expect(goalStatus(5, 10, 'maior', r, '2026-10-16').status).toBe('no_ritmo'); // metade do mês, metade da meta
    expect(goalStatus(3, 10, 'maior', r, '2026-10-16').status).toBe('abaixo');
    expect(goalStatus(10, 10, 'maior', r, '2026-10-16').status).toBe('atingida');
    expect(goalStatus(9, 10, 'maior', r, '2026-11-02').status).toBe('nao_atingida');
    expect(goalStatus(null, 10, 'maior', r, '2026-10-16').status).toBe('indisponivel');
    expect(goalStatus(20, 24, 'menor', r, '2026-10-16').status).toBe('no_ritmo');
    expect(goalStatus(1, 10, 'maior', r, '2026-09-30').status).toBe('nao_iniciada');
  });
  it('pesos normalizados, teto, indicador sem dado fora e nota composta', () => {
    expect(normalizeWeights([{ weight: 30 }, { weight: 10 }]).map((x) => x.norm)).toEqual([0.75, 0.25]);
    expect(scorecardScore([{ weight: 3, attainment: 2 }, { weight: 1, attainment: 0.6 }], 1.2)).toEqual({ score: 105, incomplete: false, used: 2, total: 2 });
    expect(scorecardScore([{ weight: 3, attainment: 1 }, { weight: 1, attainment: null }])).toMatchObject({ score: 100, incomplete: true, used: 1 });
    expect(compositeScore([{ score: 80, weight: 70 }, { score: 100, weight: 30 }])).toBe(86);
    expect(validateScorecard({ items: [{ indicatorId: 'a', weight: 0 }, { indicatorId: 'a', weight: 10 }], cap: 3 })).toHaveLength(3);
  });
});

describe('cascata e semáforo', () => {
  it('semáforo com faixas padrão 90/85 e sem dado', () => {
    expect([0.95, 0.9, 0.87, 0.85, 0.84, null].map((a) => trafficLight(a))).toEqual(['verde', 'verde', 'amarelo', 'amarelo', 'vermelho', 'sem_dado']);
    expect(trafficLight(0.8, { green: 0.8, yellow: 0.7 })).toBe('verde');
  });
  it('consolidação não presume soma', () => {
    const k = [{ value: 10, weight: 1 }, { value: 30, weight: 3 }, { value: null, weight: 5 }];
    expect(consolidate('soma', k)).toBe(40);
    expect(consolidate('media_simples', k)).toBe(20);
    expect(consolidate('media_ponderada', k)).toBe(25);
    expect(consolidate('nao_agregavel', k)).toBeNull();
    expect(canLinkObjective('tatico', 'estrategico')).toBe(true);
    expect(canLinkObjective('estrategico', 'tatico')).toBe(false);
  });
});
