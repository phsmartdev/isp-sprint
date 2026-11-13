/** Perfis novos, exclusão de time, setores da Gestão de Contratos (criar, renomear, excluir) e marcação de CSM. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

describe('cadastro: perfis, times, setores e CSM', () => {
  it('perfis: Administrador, Diretoria, Gerência, Supervisão e Operação', async () => {
    const sec = ok(await carlos.get('/admin/security')).json();
    expect(sec.profiles.map((p: { key: string }) => p.key)).toEqual(['administrador', 'diretoria', 'gerencia', 'supervisor', 'operacao']);
    expect((await carlos.post('/admin/users', { name: 'Perfil Antigo', email: `antigo-${stamp}@yepnet.test`, profile: 'vendedor', teamIds: [] })).statusCode).toBe(422);
    ok(await carlos.post('/admin/users', { name: 'Pessoa Diretoria', email: `dir-${stamp}@yepnet.test`, profile: 'diretoria', teamIds: [] }), 201);
  });

  it('time excluído some das escolhas, libera o nome e tira as pessoas', async () => {
    const t = ok(await carlos.post('/admin/teams', { name: `Time Temporário ${stamp}` }), 201).json();
    const u = ok(await carlos.post('/admin/users', { name: 'Membro Temporário', email: `membro-${stamp}@yepnet.test`, profile: 'operacao', teamIds: [t.id] }), 201).json();
    ok(await carlos.del(`/admin/teams/${t.id}`));
    const lk = ok(await carlos.get('/meta/lookups')).json();
    expect(lk.teams.some((x: { id: string }) => x.id === t.id)).toBe(false);
    const users = ok(await carlos.get('/admin/users')).json();
    expect(users.teams.some((x: { id: string }) => x.id === t.id)).toBe(false);
    expect(users.users.find((x: { id: string }) => x.id === (u.user?.id ?? u.id))?.teamIds ?? []).not.toContain(t.id);
    ok(await carlos.post('/admin/teams', { name: `Time Temporário ${stamp}` }), 201);
  });

  it('excluir time leva metas em aberto para outro; time já excluído também transfere depois', async () => {
    const def = { name: `Tarefas ${stamp}`, category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' }, target: 4 };
    const ind = ok(await carlos.post('/performance/indicators', { def }), 201).json().id;
    const gov = ok(await carlos.post('/admin/teams', { name: `Governo ${stamp}` }), 201).json();
    const neg = ok(await carlos.post('/admin/teams', { name: `Negócios ${stamp}` }), 201).json();
    const goal = (teamId: string) => carlos.post('/performance/goals', { title: `Vendas do time ${stamp}`, scope: 'equipe', teamId, indicatorId: ind, periodType: 'mes', target: 10 });
    const g1 = ok(await goal(gov.id), 201).json().id;
    expect(ok(await carlos.get(`/admin/teams/${gov.id}/open-work`)).json().goals).toBe(1);
    // destino inválido: o próprio time
    expect((await carlos.del(`/admin/teams/${gov.id}?transferTo=${gov.id}`)).statusCode).toBe(422);
    const r = ok(await carlos.del(`/admin/teams/${gov.id}?transferTo=${neg.id}`)).json();
    expect(r.moved.goals).toBe(1);
    expect(ok(await carlos.get(`/admin/teams/${neg.id}/open-work`)).json().goals).toBe(1);
    const goals = ok(await carlos.get('/performance/goals')).json();
    expect((goals.items ?? goals).find((x: { id: string }) => x.id === g1).teamId).toBe(neg.id);
    // excluído sem transferir: aparece na lista de pendências e transfere depois
    const old = ok(await carlos.post('/admin/teams', { name: `Antigo ${stamp}` }), 201).json();
    ok(await goal(old.id), 201);
    ok(await carlos.del(`/admin/teams/${old.id}`));
    const pend = ok(await carlos.get('/admin/teams/deleted-with-work')).json().items;
    const it0 = pend.find((x: { id: string }) => x.id === old.id);
    expect(it0.name).toBe(`Antigo ${stamp}`);
    expect(it0.work.goals).toBe(1);
    expect((await carlos.post(`/admin/teams/${old.id}/transfer`, { toTeamId: gov.id })).statusCode).toBe(422); // destino excluído
    expect(ok(await carlos.post(`/admin/teams/${old.id}/transfer`, { toTeamId: neg.id })).json().moved.goals).toBe(1);
    expect(ok(await carlos.get('/admin/teams/deleted-with-work')).json().items.some((x: { id: string }) => x.id === old.id)).toBe(false);
    ok(await carlos.del(`/admin/teams/${neg.id}`));
  });

  it('setores: cria, renomeia, usa no cadastro e exclui; setor com etapas não exclui', async () => {
    const c = ok(await carlos.post('/contract-sectors', { label: `Compras ${stamp}` }), 201).json();
    ok(await carlos.patch(`/contract-sectors/${c.key}`, { label: `Suprimentos ${stamp}` }));
    const u = ok(await carlos.post('/admin/users', { name: 'Pessoa de Suprimentos', email: `sup-${stamp}@yepnet.test`, profile: 'operacao', teamIds: [], sectors: [c.key], isCsm: true }), 201).json();
    const uid = u.user?.id ?? u.id;
    expect((await carlos.post('/admin/users', { name: 'Setor Inexistente', email: `x-${stamp}@yepnet.test`, profile: 'operacao', teamIds: [], sectors: ['nao_existe'] })).statusCode).toBe(422);
    const list = ok(await carlos.get('/contract-sectors')).json().items;
    expect(list.find((x: { key: string }) => x.key === c.key).label).toBe(`Suprimentos ${stamp}`);
    // CSM marcado aparece na lista de CSMs
    const csms = ok(await carlos.get('/cs/csms')).json().items;
    expect(csms.some((x: { id: string; source: string }) => x.id === uid && x.source === 'marcado')).toBe(true);
    // renomear setor do sistema; não excluir quem tem etapas
    ok(await carlos.patch('/contract-sectors/financeiro', { label: 'Financeiro e Faturamento' }));
    expect(ok(await carlos.del('/contract-sectors/financeiro'), 422).body).toMatch(/etapas nos processos/);
    ok(await carlos.patch('/contract-sectors/financeiro', { label: 'Financeiro' }));
    ok(await carlos.del(`/contract-sectors/${c.key}`));
    expect(ok(await carlos.get('/contract-sectors')).json().items.some((x: { key: string }) => x.key === c.key)).toBe(false);
    const after = ok(await carlos.get('/admin/users')).json().users.find((x: { id: string }) => x.id === uid);
    expect(after.sectors).not.toContain(c.key);
    ok(await carlos.patch(`/admin/users/${uid}`, { isCsm: false }));
  });
});
