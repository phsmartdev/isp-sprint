import { describe, expect, it } from 'vitest';
import {
  accountCodeError, accountPath, bookValueCents, deviationPct, executionBand, executionPct, guardianRoute, monthlyBrlCents, monthsOfQuarter, needsJustification,
  planStatusOf, purchasePending, resourceMonths, sameItemConflict, signed, sortAccounts, spendCheck,
} from './budget';

describe('plano de contas', () => {
  it('código segue a conta-mãe, um nível abaixo, sem repetir', () => {
    expect(accountCodeError('3', null, [])).toBeNull();
    expect(accountCodeError('3.1', { code: '3' }, ['3'])).toBeNull();
    expect(accountCodeError('3.1.02', { code: '3.1' }, [])).toBeNull();
    expect(accountCodeError('4.1', { code: '3' }, [])).toMatch(/começar com/);
    expect(accountCodeError('3.1.2.4', { code: '3.1' }, [])).toMatch(/um nível abaixo/);
    expect(accountCodeError('3.1', { code: '3' }, ['3.1'])).toMatch(/Já existe/);
    expect(accountCodeError('3.x', null, [])).toMatch(/números/);
    expect(accountCodeError('3.1', null, [])).toMatch(/primeiro nível/);
  });
  it('despesa sempre negativa; ordem numérica por nível; caminho até a raiz', () => {
    expect(signed('despesa', 1500)).toBe(-1500);
    expect(signed('receita', -1500)).toBe(1500);
    expect(sortAccounts([{ code: '3.10' }, { code: '3.2' }, { code: '3' }, { code: '3.2.1' }]).map((x) => x.code)).toEqual(['3', '3.2', '3.2.1', '3.10']);
    const all = [{ id: 'a', parentId: null, code: '3' }, { id: 'b', parentId: 'a', code: '3.1' }, { id: 'c', parentId: 'b', code: '3.1.01' }];
    expect(accountPath('c', all).map((x) => x.code)).toEqual(['3', '3.1', '3.1.01']);
  });
});

describe('execução e desvios (política 3.4 e 5)', () => {
  it('faixas da política', () => {
    expect(executionBand(executionPct(1000, 400))).toBe('subexecucao');
    expect(executionBand(executionPct(1000, 500))).toBe('adequada');
    expect(executionBand(executionPct(1000, 900))).toBe('adequada');
    expect(executionBand(executionPct(1000, 950))).toBe('risco');
    expect(executionBand(executionPct(1000, 1001))).toBe('excedente');
    expect(executionBand(executionPct(0, 10))).toBe('excedente');
    expect(executionBand(executionPct(0, 0))).toBeNull();
  });
  it('justificativa acima de 15% para mais ou para menos', () => {
    expect(needsJustification(1000, 1150)).toBe(false);
    expect(needsJustification(1000, 1160)).toBe(true);
    expect(needsJustification(1000, 840)).toBe(true);
    expect(deviationPct(1000, 1200)).toBe(20);
  });
});

describe('Budget Guardião (6.2)', () => {
  it('até 15% do trimestre do centro de custo vai com justificativa; acima, Diretoria; soma os ajustes do trimestre', () => {
    expect(guardianRoute(100_000, 0, 15_000).needsDirector).toBe(false);
    expect(guardianRoute(100_000, 0, -15_001).needsDirector).toBe(true);
    expect(guardianRoute(100_000, 10_000, 6_000).needsDirector).toBe(true);
    expect(guardianRoute(0, 0, 1).needsDirector).toBe(true);
  });
  it('gasto acima do disponível pede Guardião', () => {
    expect(spendCheck(1000, 1000)).toEqual({ ok: true, missingCents: 0 });
    expect(spendCheck(1000, 1300)).toEqual({ ok: false, missingCents: 300 });
  });
});

describe('planejamento', () => {
  it('situação do plano pelas linhas', () => {
    expect(planStatusOf([{ status: 'rascunho' }], 'rascunho')).toBe('rascunho');
    expect(planStatusOf([{ status: 'em_aprovacao' }, { status: 'aprovado' }], 'em_aprovacao')).toBe('em_aprovacao');
    expect(planStatusOf([{ status: 'recusado' }, { status: 'aprovado' }], 'em_aprovacao')).toBe('aprovado');
    expect(planStatusOf([{ status: 'rascunho' }], 'devolvido')).toBe('devolvido');
  });
  it('mesmo item em outra categoria no trimestre é recusado', () => {
    const others = [{ what: 'Licença  do CRM', categoryId: 'ferr' }];
    expect(sameItemConflict('licença do crm', 'serv', others)).toBeTruthy();
    expect(sameItemConflict('Licença do CRM', 'ferr', others)).toBeNull();
    expect(monthsOfQuarter(2026, 4)).toEqual(['2026-10', '2026-11', '2026-12']);
  });
});

describe('recursos', () => {
  it('custo mensal em reais e meses de cobrança', () => {
    expect(monthlyBrlCents({ amountCents: 12_000, currency: 'BRL', fxRate: null, period: 'anual' })).toBe(1000);
    expect(monthlyBrlCents({ amountCents: 1000, currency: 'USD', fxRate: 5.5, period: 'mensal' })).toBe(5500);
    const m = resourceMonths({ amountCents: 1200, currency: 'BRL', fxRate: null, period: 'anual', startOn: '2025-11-10', endOn: null }, ['2026-10', '2026-11', '2026-12']);
    expect(m.map((x) => x.cents)).toEqual([0, 1200, 0]);
    expect(resourceMonths({ amountCents: 100, currency: 'BRL', fxRate: null, period: 'mensal', startOn: '2026-11-01', endOn: '2026-11-30' }, ['2026-10', '2026-11', '2026-12']).map((x) => x.cents)).toEqual([0, 100, 0]);
  });
  it('depreciação linear e pendências da compra', () => {
    expect(bookValueCents(120_000, '2026-01-10', 24, '2027-01-10')).toBe(60_000);
    expect(bookValueCents(120_000, '2020-01-10', 24, '2027-01-10')).toBe(0);
    expect(purchasePending({ kind: 'especifica', financeCheck: true, legalReview: false, directorSigned: false, quotes: 0 })).toEqual(['Análise do Jurídico', 'Assinatura da Diretoria Comercial (ou liberação por escrito)']);
    expect(purchasePending({ kind: 'consumo', financeCheck: false, legalReview: false, directorSigned: false, quotes: 0 })).toEqual(['Checagem prévia com o Financeiro', 'Cotação do setor de Compras']);
  });
});
