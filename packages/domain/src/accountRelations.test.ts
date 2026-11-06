import { describe, expect, it } from 'vitest';
import { accountRelationError, hierarchyTree, relationComponent, type AccountRel } from './accountRelations';

const R = (id: string, fromId: string, toId: string, kind: AccountRel['kind']): AccountRel => ({ id, fromId, toId, kind });
describe('relações entre contas', () => {
  const ex = [R('1', 'pref', 'sme', 'orgao_superior'), R('2', 'pref', 'sms', 'orgao_superior'), R('3', 'sme', 'cons', 'membro'), R('4', 'a', 'b', 'parceira')];
  it('não relaciona consigo, não duplica (simétrica nos dois sentidos), uma mãe por tipo, sem ciclo', () => {
    expect(accountRelationError({ fromId: 'x', toId: 'x', kind: 'outro' }, ex)).toMatch(/ela mesma/);
    expect(accountRelationError({ fromId: 'b', toId: 'a', kind: 'parceira' }, ex)).toMatch(/já está registrada/);
    expect(accountRelationError({ fromId: 'b', toId: 'a', kind: 'fornecedora' }, ex)).toBeNull();
    expect(accountRelationError({ fromId: 'outra', toId: 'sme', kind: 'orgao_superior' }, ex)).toMatch(/já tem um órgão superior/);
    expect(accountRelationError({ fromId: 'sme', toId: 'pref', kind: 'orgao_superior' }, ex)).toMatch(/ciclo/);
    expect(accountRelationError({ fromId: 'sme', toId: 'escola', kind: 'orgao_superior' }, ex)).toBeNull();
  });
  it('componente conectado e árvore da hierarquia', () => {
    expect([...relationComponent('sms', ex)].sort()).toEqual(['cons', 'pref', 'sme', 'sms']);
    const t = hierarchyTree(['pref', 'sme', 'sms', 'cons'], ex);
    expect(t.roots).toEqual(['pref']);
    expect(t.children.get('pref')!.map((c) => c.id)).toEqual(['sme', 'sms']);
    expect(t.inTree.has('cons')).toBe(false);
  });
});
