import { describe, expect, it } from 'vitest';
import {
  validateTransition, leadTemperature, leadSla, isOverdue, maskPhone, maskEmail, toCents, formatBRL, csvSafe,
  DEFAULT_ACCESS, atLeast, mergeLevels, allowedLevels,
} from './index';

describe('transições de etapa', () => {
  it('permite mover livremente entre etapas abertas', () => {
    expect(validateTransition({ from: 'novo_lead', to: 'cobertura', canReopen: false })).toEqual({ ok: true });
    expect(validateTransition({ from: 'fechamento', to: 'qualificacao', canReopen: false })).toEqual({ ok: true });
  });
  it('rejeita transição para a mesma etapa', () => {
    expect(validateTransition({ from: 'novo_lead', to: 'novo_lead', canReopen: true })).toMatchObject({ ok: false, code: 'same_stage' });
  });
  it('perdida exige motivo e confirmação', () => {
    expect(validateTransition({ from: 'proposta', to: 'perdida', canReopen: false, confirm: true })).toMatchObject({ code: 'loss_reason_required' });
    expect(validateTransition({ from: 'proposta', to: 'perdida', canReopen: false, lossReason: 'preco' })).toMatchObject({ code: 'confirmation_required' });
    expect(validateTransition({ from: 'proposta', to: 'perdida', canReopen: false, lossReason: 'preco', confirm: true })).toEqual({ ok: true });
  });
  it('ganha exige confirmação explícita', () => {
    expect(validateTransition({ from: 'fechamento', to: 'ganha', canReopen: false })).toMatchObject({ code: 'confirmation_required' });
    expect(validateTransition({ from: 'fechamento', to: 'ganha', canReopen: false, confirm: true })).toEqual({ ok: true });
  });
  it('etapas terminais só reabrem com permissão e justificativa', () => {
    expect(validateTransition({ from: 'ganha', to: 'fechamento', canReopen: false, reason: 'x' })).toMatchObject({ code: 'terminal' });
    expect(validateTransition({ from: 'perdida', to: 'qualificacao', canReopen: true })).toMatchObject({ code: 'reason_required' });
    expect(validateTransition({ from: 'perdida', to: 'qualificacao', canReopen: true, reason: 'Cliente voltou a ligar' })).toEqual({ ok: true });
  });
});

describe('temperatura do lead', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  it('lead novo, com contato recente e interesse é quente, com motivos', () => {
    const r = leadTemperature({ now, createdAt: new Date('2026-10-16T12:00:00Z'), lastContactAt: new Date('2026-10-17T10:00:00Z'), interests: ['velocidade'], status: 'em_contato' });
    expect(r.level).toBe('quente');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it('lead antigo sem contato é frio', () => {
    expect(leadTemperature({ now, createdAt: new Date('2026-09-01T00:00:00Z'), interests: [], status: 'novo' }).level).toBe('frio');
  });
  it('descartado é sempre frio', () => {
    expect(leadTemperature({ now, createdAt: now, lastContactAt: now, interests: ['x'], status: 'descartado' }).level).toBe('frio');
  });
});

describe('SLA e atraso', () => {
  const created = new Date('2026-10-16T12:00:00Z');
  it('marca violado quando passa do prazo sem contato', () => {
    expect(leadSla(created, null, new Date('2026-10-17T13:00:00Z')).state).toBe('violado');
    expect(leadSla(created, null, new Date('2026-10-17T11:00:00Z')).state).toBe('no_prazo');
    expect(leadSla(created, new Date('2026-10-16T13:00:00Z'), new Date()).state).toBe('cumprido');
  });
  it('atividade concluída nunca está atrasada', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(isOverdue(new Date('2026-10-17T11:00:00Z'), null, now)).toBe(true);
    expect(isOverdue(new Date('2026-10-17T11:00:00Z'), now, now)).toBe(false);
    expect(isOverdue(null, null, now)).toBe(false);
  });
});

describe('máscaras, dinheiro e CSV', () => {
  it('mascara telefone e e-mail', () => {
    expect(maskPhone('(79) 99876-5432')).toBe('(••) •••••-5432');
    expect(maskEmail('maria@exemplo.com')).toBe('m•••@exemplo.com');
  });
  it('converte valores para centavos sem erro de ponto flutuante', () => {
    expect(toCents('1.234,56')).toBe(123456);
    expect(toCents('99.90')).toBe(9990);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('abc')).toBeNull();
    expect(formatBRL(123456)).toMatch(/1\.234,56/);
    expect(formatBRL(null)).toBe('—');
  });
  it('neutraliza formula injection', () => {
    expect(csvSafe('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvSafe('Maria')).toBe('"Maria"');
  });
});

describe('matriz de acesso padrão', () => {
  it('vendedor: próprio nos módulos de trabalho, sem Configurações nem Inteligência', () => {
    expect(DEFAULT_ACCESS.operacao.oportunidades).toBe('proprio');
    expect(DEFAULT_ACCESS.operacao.relatorios).toBe('proprio');
    expect(DEFAULT_ACCESS.operacao.configuracoes).toBe('nenhum');
  });
  it('supervisão vê a equipe; gerência vê tudo e administra', () => {
    expect(DEFAULT_ACCESS.supervisor.oportunidades).toBe('equipe');
    expect(DEFAULT_ACCESS.supervisor.configuracoes).toBe('nenhum');
    expect(DEFAULT_ACCESS.gerencia.configuracoes).toBe('total');
    expect(Object.entries(DEFAULT_ACCESS.gerencia).filter(([m]) => m !== 'pessoas').every(([, l]) => l === 'total')).toBe(true);
  });
  it('Pessoas & Cultura: cargo de gestão não administra o módulo; só o Administrador nasce com Total', () => {
    expect(DEFAULT_ACCESS.gerencia.pessoas).toBe('equipe');
    expect(DEFAULT_ACCESS.diretoria.pessoas).toBe('equipe');
    expect(DEFAULT_ACCESS.operacao.pessoas).toBe('proprio');
    expect(DEFAULT_ACCESS.administrador.pessoas).toBe('total');
  });
  it('níveis comparáveis e combinação pelo maior nível', () => {
    expect(atLeast('equipe', 'proprio')).toBe(true);
    expect(atLeast('proprio', 'equipe')).toBe(false);
    expect(atLeast(undefined, 'proprio')).toBe(false);
    expect(mergeLevels(['proprio', 'equipe', 'nenhum'])).toBe('equipe');
    expect(mergeLevels([])).toBe('nenhum');
  });
  it('Configurações aceita só sem acesso ou total', () => {
    expect(allowedLevels('configuracoes')).toEqual(['nenhum', 'total']);
    expect(allowedLevels('leads')).toContain('proprio');
  });
});
