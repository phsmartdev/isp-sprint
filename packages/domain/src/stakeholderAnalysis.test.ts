import { describe, expect, it } from 'vitest';
import { buildOrgChart, reportsToError, suggestPowerClass } from './stakeholders';

const p = (id: string, reportsToId: string | null, extra: Partial<{ hiddenAgent: boolean; active: boolean }> = {}) => ({ id, name: id, reportsToId, ...extra });

describe('análise de stakeholders', () => {
  it('sugere IA/INA/NIA/NINA pela influência avaliada e pelos papéis de autoridade', () => {
    expect(suggestPowerClass(['decisor'], 'alto')).toBe('ia');
    expect(suggestPowerClass(['influenciador'], 'muito_alto')).toBe('ina');
    expect(suggestPowerClass(['aprovador_financeiro'], 'baixo')).toBe('nia');
    expect(suggestPowerClass(['usuario'], 'muito_baixo')).toBe('nina');
    expect(suggestPowerClass(['decisor'], 'nao_avaliado')).toBeNull();
  });
  it('organograma: árvore pelo "reporta a", agentes ocultos à parte, ciclo quebrado', () => {
    const o = buildOrgChart([p('sec', null), p('dir', 'sec'), p('coord', 'dir'), p('ana', 'dir'), p('oculto', null, { hiddenAgent: true }), p('saiu', 'sec', { active: false })]);
    expect(o.roots.map((r) => r.item.id)).toEqual(['sec']);
    expect(o.roots[0]!.children.map((c) => c.item.id)).toEqual(['dir']);
    expect(o.roots[0]!.children[0]!.children.map((c) => c.item.id)).toEqual(['ana', 'coord']);
    expect(o.hidden.map((h) => h.id)).toEqual(['oculto']);
    const cyc = buildOrgChart([p('a', 'b'), p('b', 'a')]);
    expect(cyc.roots.length).toBeGreaterThan(0);
    expect(cyc.cyclic.length).toBeGreaterThan(0);
  });
  it('reporta a: nem a si mesmo, nem ciclo, nem fora da conta', () => {
    const items = [p('a', null), p('b', 'a'), p('c', 'b')];
    expect(reportsToError('a', 'c', items)).toMatch(/ciclo/);
    expect(reportsToError('a', 'a', items)).toMatch(/si mesma/);
    expect(reportsToError('a', 'x', items)).toMatch(/não é stakeholder/);
    expect(reportsToError('c', 'a', items)).toBeNull();
  });
});
