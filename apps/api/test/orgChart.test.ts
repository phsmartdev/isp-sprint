/** Organograma de acessos: estrutura (times, líderes, gestores) e o que cada pessoa enxerga em cada módulo, com o porquê. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
type Person = { id: string; name: string; profile: string; view: Record<string, { level: string; enabled: boolean; reason: string }> };
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => { await ctx.close(); });

describe('organograma de acessos', () => {
  it('mostra quem vê o quê, segue as liberações e é só da administração', async () => {
    expect((await lucas.get('/admin/org-chart')).statusCode).toBe(403);
    const r = await carlos.get('/admin/org-chart');
    expect(r.statusCode, r.body).toBe(200);
    const d = r.json() as { people: Person[]; teams: { name: string; leadIds: string[]; memberIds: string[] }[]; modules: { key: string }[] };
    const by = (n: string) => d.people.find((p) => p.name.startsWith(n))!;
    expect(d.modules.map((m) => m.key)).toContain('crm');
    expect((await lucas.put('/admin/org-chart/top', { name: 'X Y', title: null })).statusCode).toBe(403);
    expect((await carlos.put('/admin/org-chart/top', { name: 'Welliton Sá', title: 'Diretoria Executiva' })).statusCode).toBe(200);
    expect(((await carlos.get('/admin/org-chart')).json() as { top: unknown }).top).toEqual({ name: 'Welliton Sá', title: 'Diretoria Executiva' });
    expect(by('Carlos').view.crm!.level).toBe('total');
    expect(by('Ana').view.crm!.level).toBe('equipe');
    expect(by('Lucas').view.crm!.level).toBe('proprio');
    const res = d.teams.find((t) => t.name === 'Residencial')!;
    expect(res.leadIds).toContain(by('Ana').id);
    expect(res.memberIds).toContain(by('Lucas').id);
    // bloquear o CRM para o Lucas: o organograma passa a mostrar "sem acesso" e o motivo
    const g = await carlos.post('/admin/modules/crm/grants', { subjectType: 'usuario', subjectId: by('Lucas').id, effect: 'bloquear', reason: 'Teste do organograma', validUntil: null });
    expect(g.statusCode, g.body).toBe(201);
    const after = (await carlos.get('/admin/org-chart')).json() as { people: Person[]; grants: { id: string; subjectId: string }[] };
    expect(after.people.find((p) => p.name.startsWith('Lucas'))!.view.crm).toMatchObject({ level: 'nenhum', enabled: false, reason: 'pessoa_bloqueada' });
    const gid = after.grants.find((x) => x.subjectId === by('Lucas').id)!.id;
    expect((await carlos.post(`/admin/module-grants/${gid}/revoke`, { note: 'Fim do teste do organograma' })).statusCode).toBe(200);
    expect(((await carlos.get('/admin/org-chart')).json() as { people: Person[] }).people.find((p) => p.name.startsWith('Lucas'))!.view.crm!.level).toBe('proprio');
  });

  it('ajusta a estrutura: move pessoa entre times, monta liderança e gestores, protege a Supervisão', async () => {
    type D = { people: Person[]; teams: { id: string; name: string; managerIds: string[]; leadIds: string[]; memberIds: string[] }[] };
    const get = async () => (await carlos.get('/admin/org-chart')).json() as D;
    let d = await get();
    const id = (n: string) => d.people.find((p) => p.name.startsWith(n))!.id;
    const team = (n: string) => d.teams.find((t) => t.name === n)!;
    const res = team('Residencial'), gov = team('Governo');
    // mover Lucas de Residencial para Governo: a Mariana (Governo) não muda; a Ana deixa de vê-lo no nível Time
    expect((await lucas.post('/admin/org-chart/move', { userId: id('Lucas'), fromTeamId: res.id, toTeamId: gov.id })).statusCode).toBe(403);
    expect((await carlos.post('/admin/org-chart/move', { userId: id('Lucas'), fromTeamId: res.id, toTeamId: gov.id, lead: false })).statusCode).toBe(200);
    d = await get();
    expect(team('Residencial').memberIds).not.toContain(id('Lucas'));
    expect(team('Governo').memberIds).toContain(id('Lucas'));
    // a Ana (Supervisão) lidera Residencial e Empresarial: pode deixar um, mas não ficar sem liderar nenhum
    const emp = team('Empresarial');
    expect((await carlos.put(`/admin/org-chart/teams/${res.id}`, { managerIds: res.managerIds, leadIds: [], memberIds: [id('Ana'), ...team('Residencial').memberIds] })).statusCode).toBe(200);
    const sup = await carlos.put(`/admin/org-chart/teams/${emp.id}`, { managerIds: emp.managerIds, leadIds: [], memberIds: [...emp.memberIds, ...emp.leadIds] });
    expect(sup.statusCode).toBe(422);
    expect(sup.json().detail).toContain('Supervisão');
    expect((await get()).teams.find((t) => t.id === emp.id)!.leadIds).toContain(id('Ana')); // nada mudou (tudo ou nada)
    expect((await carlos.put(`/admin/org-chart/teams/${res.id}`, { managerIds: res.managerIds, leadIds: res.leadIds, memberIds: team('Residencial').memberIds })).statusCode).toBe(200);
    // gestor do time: Carlos passa a gerir o Governo
    expect((await carlos.put(`/admin/org-chart/teams/${gov.id}`, { managerIds: [id('Carlos')], leadIds: team('Governo').leadIds, memberIds: team('Governo').memberIds })).statusCode).toBe(200);
    expect((await get()).teams.find((t) => t.id === gov.id)!.managerIds).toEqual([id('Carlos')]);
    // desfaz (volta Lucas para Residencial e tira o gestor)
    expect((await carlos.post('/admin/org-chart/move', { userId: id('Lucas'), fromTeamId: gov.id, toTeamId: res.id })).statusCode).toBe(200);
    expect((await carlos.put(`/admin/org-chart/teams/${gov.id}`, { managerIds: gov.managerIds, leadIds: gov.leadIds, memberIds: gov.memberIds })).statusCode).toBe(200);
    d = await get();
    expect(team('Residencial').memberIds).toContain(id('Lucas'));
  });
});
