import { describe, expect, it } from 'vitest';
import { DEFAULT_INFLUENCE_POLICY, influenceChangeError, influenceRank, quadrantOf, validateInfluencePolicy } from './stakeholders';

describe('influência é manual', () => {
  it('qualquer origem que não seja manual é recusada; exige justificativa e contexto', () => {
    for (const origin of ['automacao', 'importacao', 'sincronizacao', 'ia', 'pesquisa'] as const) {
      expect(influenceChangeError({ origin, from: 'nao_avaliado', to: 'alto', justification: 'Justificativa válida e longa', contextType: 'conta' })).toMatch(/manualmente/);
    }
    expect(influenceChangeError({ origin: 'manual', from: 'nao_avaliado', to: 'alto', justification: 'curta', contextType: 'conta' })).toMatch(/justificativa/);
    expect(influenceChangeError({ origin: 'manual', from: 'alto', to: 'alto', justification: 'Justificativa válida e longa', contextType: 'conta' })).toMatch(/já é/);
    expect(influenceChangeError({ origin: 'manual', from: 'nao_avaliado', to: 'alto', justification: 'Justificativa válida e longa', contextType: 'oportunidade' })).toMatch(/Indique/);
    expect(influenceChangeError({ origin: 'manual', from: 'nao_avaliado', to: 'alto', justification: 'Assina os empenhos da secretaria', contextType: 'conta' })).toBeNull();
  });
  it('posição e quadrantes; não avaliado fica fora da matriz', () => {
    expect(influenceRank('muito_alto')).toBe(5);
    expect(influenceRank('nao_avaliado')).toBeNull();
    expect(quadrantOf('alto', 'alto')).toBe('gerenciar_de_perto');
    expect(quadrantOf('muito_alto', 'baixo')).toBe('manter_satisfeito');
    expect(quadrantOf('baixo', 'medio')).toBe('manter_informado');
    expect(quadrantOf('muito_baixo', 'baixo')).toBe('monitorar');
    expect(quadrantOf('nao_avaliado', 'alto')).toBeNull();
    expect(quadrantOf('alto', 'desconhecido')).toBeNull();
  });
  it('política: editar exige poder ver; níveis com nome', () => {
    expect(validateInfluencePolicy(DEFAULT_INFLUENCE_POLICY)).toEqual([]);
    expect(validateInfluencePolicy({ ...DEFAULT_INFLUENCE_POLICY, view: 'total', edit: 'equipe' })).toHaveLength(1);
    expect(validateInfluencePolicy({ ...DEFAULT_INFLUENCE_POLICY, labels: { ...DEFAULT_INFLUENCE_POLICY.labels, alto: ' ' } })).toHaveLength(1);
  });
});
