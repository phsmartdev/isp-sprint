import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCESS, MODULES } from './access';
import { BUSINESS_MODULES, MODULE_OWNER, defaultTenantModule, featureOn, gateAccess, mergeActions, moduleDecision, redactMoney, routeFeature, type BusinessModule, type ModuleGrant } from './modules';

const all = (v: boolean) => Object.fromEntries(BUSINESS_MODULES.map((m) => [m, v])) as Record<BusinessModule, boolean>;
const today = '2026-10-22';
const user = { id: 'u1', teamIds: ['t1'] };
const g = (p: Partial<ModuleGrant>): ModuleGrant => ({ module: 'projetos', subjectType: 'usuario', subjectId: 'u1', effect: 'liberar', validUntil: null, ...p });

describe('módulos de negócio', () => {
  it('todo módulo técnico tem dono; fundação nunca é desligada', () => {
    expect(Object.keys(MODULE_OWNER).sort()).toEqual([...MODULES].sort());
    const gated = gateAccess(DEFAULT_ACCESS.gerencia, { ...all(true), crm: false, contratos: false });
    expect(gated.oportunidades).toBe('nenhum');
    expect(gated.contratos).toBe('nenhum');
    expect(gated.clientes).toBe('total'); // cadastro compartilhado
    expect(gated.configuracoes).toBe('total');
    expect(gated.projetos).toBe('total');
  });

  it('decisão: empresa é teto; pessoa vence equipe; bloqueio vence; validade vencida não vale', () => {
    const on = defaultTenantModule('projetos');
    expect(moduleDecision(on, [], user, today)).toEqual({ enabled: true, reason: 'todos' });
    expect(moduleDecision({ ...on, enabled: false }, [g({})], user, today).reason).toBe('empresa_desligou');
    const only = { ...on, mode: 'liberados' as const };
    expect(moduleDecision(only, [], user, today).reason).toBe('nao_liberado');
    expect(moduleDecision(only, [g({ subjectType: 'equipe', subjectId: 't1' })], user, today).reason).toBe('equipe_liberada');
    expect(moduleDecision(only, [g({ subjectType: 'equipe', subjectId: 't1' }), g({ effect: 'bloquear' })], user, today).reason).toBe('pessoa_bloqueada');
    expect(moduleDecision(on, [g({ subjectType: 'equipe', subjectId: 't1', effect: 'bloquear' }), g({})], user, today).reason).toBe('pessoa_liberada');
    expect(moduleDecision(only, [g({ validUntil: '2026-10-21' })], user, today).reason).toBe('nao_liberado');
    expect(moduleDecision(only, [g({ module: 'crm' })], user, today).reason).toBe('nao_liberado');
  });

  it('funcionalidades: regra de rota e dependência do módulo de origem', () => {
    expect(routeFeature('GET', '/abm/:id/360')).toBe('marketing.abm');
    expect(routeFeature('PUT', '/abm/settings')).toBeNull();
    expect(routeFeature('GET', '/leads/summary')).toBe('marketing.leads');
    expect(routeFeature('GET', '/tasks')).toBe('projetos.tarefas');
    expect(routeFeature('PATCH', '/tasks/:id')).toBeNull(); // a tarefa é compartilhada
    expect(routeFeature('GET', '/activities')).toBe('crm.atividades');
    expect(routeFeature('POST', '/activities')).toBeNull();
    expect(routeFeature('GET', '/arp-import-mappings')).toBe('contratos.atas');
    expect(routeFeature('GET', '/intelligence/contracts')).toBe('relatorios.contratos');
    expect(routeFeature('GET', '/intelligence/overview')).toBe('relatorios.comercial');
    expect(routeFeature('GET', '/contracts/:id')).toBeNull();
    expect(featureOn('relatorios.comercial', { ...all(true), crm: false }, [])).toBe(false);
    expect(featureOn('relatorios.contratos', { ...all(true), crm: false }, [])).toBe(true);
    expect(featureOn('contratos.atas', all(true), ['contratos.atas'])).toBe(false);
  });

  it('ações: qualquer perfil que permita vale; financeiro some da resposta', () => {
    expect(mergeActions([{ action: 'exportar', allowed: false }, { action: 'exportar', allowed: true }]).exportar).toBe(true);
    expect(mergeActions([]).ver_financeiro).toBe(false);
    const r = redactMoney({ id: 'c1', valueCents: 900000, items: [{ unitCents: 100, description: 'Link' }], kpis: { ltv: 10, count: 3 }, at: new Date('2026-01-01') });
    expect(r).toEqual({ id: 'c1', valueCents: null, items: [{ unitCents: null, description: 'Link' }], kpis: { ltv: null, count: 3 }, at: new Date('2026-01-01') });
  });
});
