/** Abas da Gestão de Contratos como permissão por perfil e configuração do Painel. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARD } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => { await ctx.close(); });

describe('abas e painel de contratos', () => {
  it('sem configuração todas as abas ficam liberadas e o painel usa o padrão', async () => {
    const v = ok(await lucas.get('/contracts/view')).json();
    expect(v.tabs.indexOf('funil')).toBe(v.tabs.indexOf('painel') + 1);
    expect(v.tabs).toContain('modelos');
    expect(v.tabs).not.toContain('habilitacao');
    expect(v.dashboard).toEqual(DEFAULT_DASHBOARD);
  });

  it('nega a aba por perfil na tela e na API; os parâmetros de contratos não apagam a configuração', async () => {
    ok(await lucas.put('/admin/contract-view', { tabAccess: {}, dashboard: DEFAULT_DASHBOARD }), 403);
    const dashboard = { ...DEFAULT_DASHBOARD, order: ['executivo', ...DEFAULT_DASHBOARD.order.filter((k) => k !== 'executivo')], hidden: ['perfil'], compactValues: false };
    ok(await carlos.put('/admin/contract-view', { tabAccess: { vendedor: ['painel', 'relatorios', 'atencao'] }, dashboard }));

    const v = ok(await lucas.get('/contracts/view')).json();
    expect(v.tabs).not.toContain('painel');
    expect(v.tabs).toContain('lista');
    expect(v.dashboard.order[0]).toBe('executivo');
    expect(v.dashboard.hidden).toEqual(['perfil']);
    ok(await lucas.get('/contracts/dashboard'), 403);
    ok(await lucas.get('/contracts/attention'), 403);
    ok(await lucas.get('/contracts/reports/expiring'), 403);
    ok(await lucas.get('/contracts'));
    // carlos (gerência, administração) continua vendo tudo
    ok(await carlos.get('/contracts/dashboard'));
    expect(ok(await carlos.get('/contracts/view')).json().tabs).toContain('painel');

    // salvar os parâmetros de contratos mescla, sem perder abas e painel
    const settings = ok(await carlos.get('/admin/contract-settings')).json();
    ok(await carlos.put('/admin/contract-settings', settings));
    expect(ok(await carlos.get('/admin/contract-view')).json().tabAccess.vendedor).toEqual(['painel', 'relatorios', 'atencao']);

    ok(await carlos.put('/admin/contract-view', { tabAccess: {}, dashboard: DEFAULT_DASHBOARD }));
    ok(await lucas.get('/contracts/dashboard'));
  });
});
