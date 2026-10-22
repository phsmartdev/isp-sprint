import { describe, expect, it } from 'vitest';
import { entityLinkError, externalIdsOf } from './abmLinks';

describe('vínculos ABM', () => {
  it('papel por tipo de registro e mesma conta', () => {
    const base = { stakeholderContactId: 'c1', entityContactId: 'c1', stakeholderActive: true };
    expect(entityLinkError({ ...base, entity: 'oportunidade', role: 'decisor' })).toBeNull();
    expect(entityLinkError({ ...base, entity: 'contrato', role: 'fiscal_contrato' })).toBeNull();
    expect(entityLinkError({ ...base, entity: 'contrato', role: 'bloqueador' })).toMatch(/Papel inválido/);
    expect(entityLinkError({ ...base, entity: 'lead', role: 'contato_origem', entityContactId: 'c2' })).toMatch(/mesma conta/);
    expect(entityLinkError({ ...base, entity: 'lead', role: 'indicou', stakeholderActive: false })).toMatch(/inativa/);
  });
  it('IDs externos sem duplicar; cadastro do próprio CRM não conta', () => {
    expect(externalIdsOf({ sourceSystem: 'crm', externalId: null }, [])).toEqual([]);
    expect(externalIdsOf({ sourceSystem: 'ixc', externalId: '123' }, [{ system: 'ixc', externalId: '123' }, { system: 'legado', externalId: 'A9' }])).toEqual([{ system: 'ixc', externalId: '123' }, { system: 'legado', externalId: 'A9' }]);
  });
});
