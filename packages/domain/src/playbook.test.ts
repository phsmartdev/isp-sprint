import { describe, expect, it } from 'vitest';
import { PLAYBOOK_EXTERNAL_ROLES, PLAYBOOK_INTERNAL_ROLES, PLAYBOOK_ROLES, isExternalRole, letterSource, normalizeAssignees } from './playbook';

const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';

describe('papéis internos e externos', () => {
  it('cada papel é interno ou externo, nunca os dois', () => {
    expect([...PLAYBOOK_INTERNAL_ROLES, ...PLAYBOOK_EXTERNAL_ROLES].sort()).toEqual([...PLAYBOOK_ROLES].sort());
    expect(isExternalRole('FIN')).toBe(true);
    expect(isExternalRole('DIR')).toBe(false);
  });
});

describe('responsáveis nomeados por atividade', () => {
  it('limpa entradas inválidas, repetidas e deixa um único A', () => {
    const a = normalizeAssignees({ R: [{ kind: 'user', id: U1 }, { kind: 'user', id: U1 }, { kind: 'x', id: U2 }, { kind: 'actor', id: 'nao-uuid' }], A: [{ kind: 'user', id: U1 }, { kind: 'actor', id: U2 }], Z: [{ kind: 'user', id: U1 }] });
    expect(a).toEqual({ R: [{ kind: 'user', id: U1 }], A: [{ kind: 'user', id: U1 }] });
    expect(normalizeAssignees(null)).toEqual({});
  });
  it('sem indicação, vale o papel da matriz', () => {
    expect(letterSource({}, 'C')).toEqual({ by: 'papel' });
    expect(letterSource({ C: [{ kind: 'actor', id: U2 }] }, 'C')).toEqual({ by: 'pessoas', people: [{ kind: 'actor', id: U2 }] });
  });
});
