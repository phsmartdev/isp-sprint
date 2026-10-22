/**
 * Etapa 1 — ativação modular e permissões finas: módulo por empresa (teto), liberação por equipe/pessoa,
 * funcionalidades, ações sensíveis, "financeiro restrito" no servidor, novos perfis e auditoria.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { BUSINESS_MODULES } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';
import { routeRegistry } from '../src/http/route';
import { handoffContractToCs } from '../src/services/customerSuccess';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, impl: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
let tenantId: string, contractId: string, lucasTeam: string;
const setModule = (module: string, v: { enabled: boolean; mode?: string; disabledFeatures?: string[] }) =>
  carlos.put(`/admin/modules/${module}`, { enabled: v.enabled, mode: v.mode ?? 'todos', disabledFeatures: v.disabledFeatures ?? [], note: 'Teste automatizado da Etapa 1' });

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
  tenantId = carlos.me.tenant.id;
  lucasTeam = ((await ctx.db.execute(sql`select team_id from team_memberships where user_id = ${lucas.me.user.id} limit 1`)).rows[0] as { team_id: string }).team_id;
  const u = ok(await carlos.post('/admin/users', { name: 'Implantação Fictícia', email: `impl-${stamp}@yepnet.test`, profile: 'implantacao', sectors: ['implantacao'] }), 201).json();
  impl = await login(ctx.app, `impl-${stamp}@yepnet.test`, u.temporaryPassword);
  contractId = ((await ctx.db.execute(sql`select id from contracts where tenant_id = ${tenantId} order by created_at limit 1`)).rows[0] as { id: string }).id;
});
afterAll(async () => {
  await ctx.db.execute(sql`delete from tenant_modules where tenant_id = ${tenantId}`);
  await ctx.db.execute(sql`delete from module_grants where tenant_id = ${tenantId}`);
  await ctx.db.execute(sql`delete from action_policies where role_id in (select id from roles where tenant_id = ${tenantId})`);
  await ctx.close();
});

describe('Etapa 1: módulos de negócio', () => {
  it('padrão: tudo ligado; /me informa módulos e ações; só Configurações total administra', async () => {
    const me = ok(await lucas.get('/me')).json();
    expect(Object.values(me.modules).every(Boolean)).toBe(true);
    expect(Object.keys(me.modules).sort()).toEqual([...BUSINESS_MODULES].sort());
    expect(me.actions).toMatchObject({ ver_financeiro: true, exportar: true });
    expect((await lucas.get('/admin/modules')).statusCode).toBe(403);
    expect(ok(await carlos.get('/admin/modules')).json().items).toHaveLength(7);
  });

  it('perfil Implantação: Contratos e Projetos sem financeiro; sem CRM; não exporta nem exclui', async () => {
    const me = ok(await impl.get('/me')).json();
    expect(me.profiles).toEqual(['implantacao']);
    expect(me.actions).toMatchObject({ ver_financeiro: false, exportar: false, arquivar: false });
    const c = ok(await impl.get(`/contracts/${contractId}`));
    expect(c.headers['x-isp-financeiro']).toBe('oculto');
    expect(JSON.stringify(c.json())).not.toMatch(/"[a-zA-Z]*Cents":\d/);
    expect((await impl.get(`/contracts/reports/full?format=csv`)).statusCode).toBe(403);
    expect((await impl.get('/opportunities')).statusCode).toBe(403);
    // telas do CRM e do ABM que moram no cadastro compartilhado também ficam fora para quem não tem CRM no perfil
    expect((await impl.get('/cs/portfolio')).json().detail).toMatch(/Seu perfil não tem acesso a Sucesso do Cliente/);
    expect((await impl.get('/abm')).statusCode).toBe(403);
    ok(await impl.get('/contacts?q=ho'));
    ok(await impl.get('/tasks'));
    const t = ok(await impl.post('/tasks', { title: 'Tarefa de implantação fictícia' }), 201).json();
    expect((await impl.del(`/tasks/${t.id}`)).statusCode).toBe(403);
    // ver financeiro continua para quem tem
    expect(JSON.stringify(ok(await carlos.get(`/contracts/${contractId}`)).json())).toMatch(/"[a-zA-Z]*Cents":\d/);
  });

  it('CRM desligado na empresa: rotas do CRM recusam com o motivo; cadastro de contas segue; relatório comercial some; contratos seguem', async () => {
    ok(await setModule('crm', { enabled: false }));
    const r = await lucas.get('/opportunities');
    expect(r.statusCode).toBe(403);
    expect(r.json().detail).toBe('O módulo CRM não está liberado para você.');
    expect((await lucas.get('/cs/portfolio')).statusCode).toBe(403);
    expect((await lucas.get('/mail/threads')).statusCode).toBe(403);
    expect((await carlos.get('/reports/overview')).statusCode).toBe(403);
    ok(await carlos.get('/intelligence/contracts?from=2026-01-01&to=2026-10-22'));
    ok(await lucas.get('/contacts?q=jo'));
    ok(await carlos.get('/contracts'));
    expect(ok(await lucas.get('/me')).json()).toMatchObject({ modules: { crm: false }, moduleReasons: { crm: 'empresa_desligou' }, access: { oportunidades: 'nenhum', clientes: 'proprio' } });
    // validação de contrato não abre Sucesso do Cliente com o CRM desligado
    expect(await handoffContractToCs(ctx.db, tenantId, null, { id: contractId, opportunityId: '00000000-0000-0000-0000-000000000000', arpId: null })).toBeNull();
    ok(await setModule('crm', { enabled: true }));
    ok(await lucas.get('/opportunities'));
    const log = (await ctx.db.execute(sql`select metadata from audit_logs where tenant_id = ${tenantId} and action = 'module.update' order by created_at desc limit 1`)).rows[0] as { metadata: { from: { enabled: boolean }; to: { enabled: boolean } } };
    expect(log.metadata).toMatchObject({ from: { enabled: false }, to: { enabled: true } });
  });

  it('liberação progressiva: Projetos só para liberados; equipe libera; pessoa bloqueia acima da equipe; validade no passado é recusada', async () => {
    ok(await setModule('projetos', { enabled: true, mode: 'liberados' }));
    expect((await lucas.get('/projects')).statusCode).toBe(403);
    expect((await carlos.post('/admin/modules/projetos/grants', { subjectType: 'equipe', subjectId: lucasTeam, effect: 'liberar', reason: 'curto' })).statusCode).toBe(422);
    expect((await carlos.post('/admin/modules/projetos/grants', { subjectType: 'equipe', subjectId: lucasTeam, effect: 'liberar', reason: 'Piloto da implantação', validUntil: '2020-01-01' })).statusCode).toBe(422);
    ok(await carlos.post('/admin/modules/projetos/grants', { subjectType: 'equipe', subjectId: lucasTeam, effect: 'liberar', reason: 'Piloto da implantação com a equipe' }), 201);
    ok(await lucas.get('/projects'));
    const block = ok(await carlos.post('/admin/modules/projetos/grants', { subjectType: 'usuario', subjectId: lucas.me.user.id, effect: 'bloquear', reason: 'Fora do piloto por enquanto' }), 201).json();
    expect((await lucas.get('/projects')).statusCode).toBe(403);
    expect(ok(await carlos.get(`/admin/access-preview/${lucas.me.user.id}`)).json().modules.projetos).toEqual({ enabled: false, reason: 'pessoa_bloqueada' });
    ok(await carlos.post(`/admin/module-grants/${block.id}/revoke`, { note: 'Entrou no piloto da implantação' }));
    ok(await lucas.get('/projects'));
    ok(await setModule('projetos', { enabled: true }));
  });

  it('funcionalidade desligada: atas some, contratos seguem; funcionalidade de outro módulo é recusada', async () => {
    expect((await setModule('contratos', { enabled: true, disabledFeatures: ['crm.email'] })).statusCode).toBe(422);
    ok(await setModule('contratos', { enabled: true, disabledFeatures: ['contratos.atas'] }));
    const r = await carlos.get('/arps');
    expect(r.statusCode).toBe(403);
    expect(r.json().detail).toMatch(/Atas de registro de preços.*desligada/);
    ok(await carlos.get('/contracts'));
    ok(await setModule('contratos', { enabled: true }));
  });

  it('ações sensíveis por perfil: negar exportar ao vendedor bloqueia a planilha e fica na auditoria', async () => {
    ok(await carlos.put('/admin/actions', { profile: 'vendedor', action: 'exportar', allowed: false }));
    expect(ok(await carlos.get('/admin/actions')).json().matrix.vendedor.exportar).toBe(false);
    expect((await lucas.get('/reports/export?kind=vendas&from=2026-10-01&to=2026-10-22')).statusCode).toBe(403);
    ok(await carlos.put('/admin/actions', { profile: 'vendedor', action: 'exportar', allowed: true }));
    const back = await lucas.get('/reports/export?kind=vendas&from=2026-10-01&to=2026-10-22');
    expect(back.statusCode, back.body).not.toBe(403);
    expect((await ctx.db.execute(sql`select count(*)::int n from audit_logs where tenant_id = ${tenantId} and action = 'security.action'`)).rows[0]).toMatchObject({ n: expect.any(Number) });
  });

  it('toda rota protegida tem dono: as do ABM, Sucesso do Cliente, e-mail e relatórios caem na funcionalidade certa', () => {
    const r = (m: string, u: string) => routeRegistry.find((x) => x.method === m && x.url === `/api/v1${u}`)!;
    expect(r('GET', '/abm/:id/360').feature).toBe('marketing.abm');
    expect(r('GET', '/accounts/:id/plays').feature).toBe('marketing.abm');
    expect(r('GET', '/cs/portfolio').feature).toBe('crm.sucesso_cliente');
    expect(r('GET', '/mail/threads').feature).toBe('crm.email');
    expect(r('GET', '/reports/overview').feature).toBe('relatorios.comercial');
    expect(r('GET', '/leads').feature).toBe('marketing.leads');
    // nenhuma rota protegida sem política
    expect(routeRegistry.filter((x) => !x.public && !x.module && !x.anyAuthenticated)).toEqual([]);
  });
});
