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
});
