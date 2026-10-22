import { describe, expect, it } from 'vitest';
import { coverageOf, type CoveragePerson } from './abmIntel';

const p = (o: Partial<CoveragePerson>): CoveragePerson => ({ roles: [], influence: 'nao_avaliado', relationship: 'nao_avaliado', stance: 'desconhecido', unitId: null, active: true, ...o });

describe('cobertura de stakeholders', () => {
  it('conta vazia: nota zero com as lacunas explicadas', () => {
    const c = coverageOf([], 0, true);
    expect(c).toMatchObject({ score: 0, level: 'baixa', people: 0 });
    expect(c.gaps.join(' ')).toMatch(/Falta mapear: quem decide/);
    expect(c.gaps.join(' ')).toMatch(/estrutura organizacional/);
  });
  it('mapeamento completo e bem relacionado: nota boa', () => {
    const c = coverageOf([
      p({ roles: ['decisor'], influence: 'muito_alto', relationship: 'forte', stance: 'defensor', unitId: 'u1' }),
      p({ roles: ['aprovador_financeiro'], influence: 'alto', relationship: 'moderado', stance: 'favoravel', unitId: 'u2' }),
      p({ roles: ['avaliador_tecnico'], influence: 'medio', relationship: 'forte', unitId: 'u2' }),
      p({ roles: ['usuario'], influence: 'baixo', relationship: 'fraco', unitId: 'u1' }),
    ], 2, true);
    expect(c.score).toBe(100);
    expect(c.level).toBe('boa');
    expect(c.gaps).toEqual([]);
  });
  it('não avaliado é lacuna; resistente com influência alta reduz; sem acesso à influência redistribui o peso', () => {
    const people = [p({ roles: ['decisor'], influence: 'alto', relationship: 'fraco', stance: 'opositor' }), p({ roles: ['usuario'], stance: 'defensor', influence: 'medio' }), p({ roles: ['avaliador_tecnico'] })];
    const c = coverageOf(people, 0, true);
    expect(c.items.find((i) => i.key === 'avaliacao')).toMatchObject({ detail: '2 de 3' });
    expect(c.items.find((i) => i.key === 'relacionamento')!.gap).toMatch(/1 pessoa/);
    expect(c.items.find((i) => i.key === 'defensor')).toMatchObject({ score: 0.5 });
    const hidden = coverageOf(people, 0, false);
    expect(hidden.items.map((i) => i.key)).toEqual(['papeis', 'departamentos']);
    expect(hidden.score).toBe(Math.round(((3 / 4) * 30 + 0.5 * 10) / 40 * 100));
  });
});
