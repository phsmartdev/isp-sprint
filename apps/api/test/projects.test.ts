/** Projetos: modelo, quadro, marcos, equipe, visibilidade e integração com Atividades. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, mariana: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
let pid: string;
const get = async (c: Client = carlos) => ok(await c.get(`/projects/${pid}`)).json();

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, mariana] = (await Promise.all(['carlos', 'ana', 'lucas', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
});
afterAll(async () => ctx.close());

describe('projetos', () => {
  it('cria a partir do modelo com etapas, marcos, tarefas e datas relativas', async () => {
    const tpl = ok(await carlos.get('/project-templates')).json().items;
    expect(tpl.map((t: { key: string }) => t.key)).toContain('implantacao_corporativa');
    const contact = (await ctx.db.execute(sql`select c.id from contacts c join users u on u.tenant_id = c.tenant_id where u.email = 'carlos@yepnet.test' limit 1`)).rows[0] as { id: string } | undefined;
    pid = ok(await carlos.post('/projects', { name: 'Implantação Clínica Fictícia', kind: 'implantacao', startOn: '2026-11-02', templateKey: 'implantacao_corporativa', contactId: contact?.id ?? null, members: [{ userId: uid('lucas'), role: 'membro' }, { userId: uid('mariana'), role: 'observador' }] }), 201).json().id;
    const p = await get();
    expect(p.stages.map((s: { name: string }) => s.name)).toEqual(['Planejamento', 'Execução', 'Validação', 'Concluído']);
    expect(p.milestones).toHaveLength(4);
    expect(p.milestones[0]).toMatchObject({ name: 'Kickoff realizado', dueOn: '2026-11-05' });
    expect(p.tasks).toHaveLength(7);
    expect(p.tasks[0]).toMatchObject({ title: 'Agendar kickoff com o cliente', startOn: '2026-11-02', dueOn: '2026-11-05' });
    expect(p.dueOn).toBe('2026-12-09'); // última tarefa: dia 35 + 2 de duração
    expect(p.progress).toMatchObject({ total: 7, done: 0, pct: 0 });
    if (contact) expect(p.links.contact.id).toBe(contact.id);
    const ev = ok(await carlos.get(`/projects/${pid}/events`)).json().items;
    expect(ev[0].summary).toMatch(/modelo/);
  });

  it('visibilidade e papéis: membro trabalha, observador só lê, fora da equipe não vê', async () => {
    expect(ok(await lucas.get('/projects')).json().items.map((x: { id: string }) => x.id)).toContain(pid);
    expect((await get(lucas)).can).toMatchObject({ work: true, manage: false });
    expect((await get(mariana)).can).toMatchObject({ work: false });
    expect((await mariana.post(`/projects/${pid}/tasks`, { title: 'Tarefa do observador' })).statusCode).toBe(403);
    const rafael = await login(ctx.app, 'rafael@yepnet.test');
    expect((await rafael.get(`/projects/${pid}`)).statusCode).toBe(404);
    expect((await lucas.patch(`/projects/${pid}`, { rowVersion: (await get()).rowVersion, name: 'Outro nome' })).statusCode).toBe(403);
    // atribuir a quem não é da equipe (ou é observador) é recusado
    expect((await carlos.post(`/projects/${pid}/tasks`, { title: 'Para observador', ownerId: uid('mariana') })).statusCode).toBe(422);
  });

  it('quadro: mover para etapa concluída conclui; concluir pela agenda move a etapa; posição reordena', async () => {
    let p = await get();
    const done = p.stages.find((s: { done: boolean }) => s.done).id;
    const exec = p.stages.find((s: { name: string }) => s.name === 'Execução').id;
    const t = p.tasks[0];
    ok(await lucas.patch(`/projects/${pid}/tasks/${t.id}`, { rowVersion: t.rowVersion, stageId: done, position: 0 }));
    p = await get();
    expect(p.tasks.find((x: { id: string }) => x.id === t.id).completedAt).toBeTruthy();
    expect(p.progress.done).toBe(1);
    // nova tarefa do Lucas aparece na agenda dele; concluir lá leva para a etapa concluída
    const nt = ok(await lucas.post(`/projects/${pid}/tasks`, { title: 'Levantar fotos da sala técnica', ownerId: uid('lucas'), stageId: exec, dueOn: '2026-11-10' }), 201).json();
    const act = ok(await lucas.get('/activities?scope=minhas&q=Levantar%20fotos')).json().items[0];
    expect(act.id).toBe(nt.id);
    ok(await lucas.patch(`/activities/${nt.id}`, { rowVersion: act.rowVersion, completed: true }));
    p = await get();
    expect(p.tasks.find((x: { id: string }) => x.id === nt.id).stageId).toBe(done);
    // reordenar coluna
    const col = p.tasks.filter((x: { stageId: string }) => x.stageId === done);
    const last = col.at(-1);
    ok(await carlos.patch(`/projects/${pid}/tasks/${last.id}`, { rowVersion: last.rowVersion, position: 0 }));
    p = await get();
    expect(p.tasks.filter((x: { stageId: string }) => x.stageId === done).sort((a: { position: number }, b: { position: number }) => a.position - b.position)[0].id).toBe(last.id);
  });

  it('marcos: não conclui com tarefa aberta; etapas: remover exige destino; limite por etapa', async () => {
    let p = await get();
    const m = p.milestones[1];
    expect((await carlos.patch(`/projects/${pid}/milestones/${m.id}`, { completed: true })).statusCode).toBe(422);
    const kick = p.milestones[0];
    ok(await carlos.patch(`/projects/${pid}/milestones/${kick.id}`, { completed: true }));
    const stages = p.stages.map((s: { id: string; name: string; done: boolean }) => ({ id: s.id, name: s.name, done: s.done }));
    const without = stages.filter((s: { name: string }) => s.name !== 'Validação');
    expect((await carlos.put(`/projects/${pid}/stages`, { stages: without })).statusCode).toBe(422);
    ok(await carlos.put(`/projects/${pid}/stages`, { stages: without.map((s: object, i: number) => (i === 1 ? { ...s, wipLimit: 2 } : s)), moveTo: { [stages[2].id]: 1 } }));
    p = await get();
    expect(p.stages).toHaveLength(3);
    const exec = p.stages[1];
    const outside = p.tasks.find((x: { stageId: string; completedAt: string | null }) => x.stageId !== exec.id && !x.completedAt);
    expect((await carlos.patch(`/projects/${pid}/tasks/${outside.id}`, { rowVersion: outside.rowVersion, stageId: exec.id })).statusCode).toBe(422);
  });

  it('situação, modelo a partir do projeto e filtro por vínculo', async () => {
    let p = await get();
    // a primeira tarefa concluída já tirou o projeto de Planejamento, com registro no histórico
    expect(p.status).toBe('em_andamento');
    expect(ok(await carlos.get(`/projects/${pid}/events`)).json().items.some((e: { summary: string }) => /primeira tarefa concluída/.test(e.summary))).toBe(true);
    expect((await carlos.patch(`/projects/${pid}`, { rowVersion: p.rowVersion, status: 'planejamento' })).statusCode).toBe(422);
    expect((await carlos.patch(`/projects/${pid}`, { rowVersion: p.rowVersion, status: 'cancelado' })).statusCode).toBe(422); // sem motivo
    ok(await carlos.patch(`/projects/${pid}`, { rowVersion: p.rowVersion, status: 'pausado' }));
    p = await get();
    ok(await carlos.patch(`/projects/${pid}`, { rowVersion: p.rowVersion, status: 'em_andamento' }));
    p = await get();
    const t = ok(await carlos.post('/project-templates', { name: 'Implantação revisada', kind: 'implantacao', fromProjectId: pid }), 201).json();
    const list = ok(await carlos.get('/project-templates')).json().items;
    const mine = list.find((x: { id: string }) => x.id === t.id);
    expect(mine.def.stages).toHaveLength(3);
    expect(mine.def.tasks.length).toBeGreaterThanOrEqual(8);
    expect((await lucas.post('/project-templates', { name: 'Do vendedor', fromProjectId: pid })).statusCode).toBe(403);
    const created = ok(await ana.post('/projects', { name: 'Projeto a partir do modelo da empresa', startOn: '2026-12-01', templateId: t.id }), 201).json().id;
    expect((await ana.get(`/projects/${created}`)).json().tasks.length).toBe(mine.def.tasks.length);
    if (p.contactId) expect(ok(await carlos.get(`/projects?contactId=${p.contactId}`)).json().items.map((x: { id: string }) => x.id)).toContain(pid);
  });
});
