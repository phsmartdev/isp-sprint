/**
 * Etapa 7 do Quadro de Tarefas (27/11/2026): atividade de projeto no quadro do departamento executor (sem cópia),
 * dependência entre departamentos com situação e risco, aviso sem mexer em prazo e o projeto por departamento.
 * Dados fictícios.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, mariana: Client;
const st = Date.now().toString(36);
let comTeam = '', csTeam = '', hadRow = false, pid = '';
const ids = {} as { com: string; cs: string };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana, mariana] = (await Promise.all(['carlos', 'lucas', 'ana', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  const t = carlos.me.tenant.id;
  hadRow = (await ctx.app.db.execute(sql`select 1 from tenant_modules where module = 'crm' and tenant_id = ${t}`)).rows.length > 0;
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select x from unnest(disabled_features) x where not x = any('{crm.quadro_tarefas,crm.quadro_sucesso}'::text[])) where module = 'crm' and tenant_id = ${t}`);
  else await ctx.app.db.execute(sql`insert into tenant_modules (tenant_id, module, enabled, mode, disabled_features) values (${t}, 'crm', true, 'todos', '{}')`);
  const mk = async (name: string, lead: string, member: string) => {
    const [r] = (await ctx.app.db.execute<{ id: string }>(sql`insert into teams (tenant_id, name) values (${t}, ${name}) returning id`)).rows;
    await ctx.app.db.execute(sql`insert into team_memberships (team_id, user_id, is_lead) values (${r!.id}, ${lead}, true), (${r!.id}, ${member}, false)`);
    return r!.id;
  };
  comTeam = await mk(`Comercial Projeto ${st}`, ana.me.user.id, lucas.me.user.id);
  csTeam = await mk(`CS Projeto ${st}`, mariana.me.user.id, carlos.me.user.id);
  await ctx.app.db.execute(sql`update teams set manager_ids = array[${carlos.me.user.id}]::uuid[] where id in (${comTeam}, ${csTeam})`);
  expect((await carlos.put('/quadros/comercial/config', { teamIds: [comTeam], wipLimit: 3, wipCountsWaiting: false })).statusCode).toBe(200);
  expect((await carlos.put('/quadros/sucesso_cliente/config', { teamIds: [csTeam], wipLimit: 3, wipCountsWaiting: false })).statusCode).toBe(200);
  // nova sessão: o escopo de equipe é lido no login
  [carlos, lucas, ana, mariana] = (await Promise.all(['carlos', 'lucas', 'ana', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
});
afterAll(async () => {
  const t = carlos.me.tenant.id;
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select distinct unnest(disabled_features || '{crm.quadro_tarefas,crm.quadro_sucesso}'::text[])) where module = 'crm' and tenant_id = ${t}`);
  else await ctx.app.db.execute(sql`delete from tenant_modules where module = 'crm' and tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from task_boards where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from team_memberships where team_id in (${comTeam}, ${csTeam})`);
  await ctx.app.db.execute(sql`update teams set deleted_at = now(), name = name || ' (removido)' where id in (${comTeam}, ${csTeam})`);
  await ctx.close();
});

it('atividade de projeto aparece no quadro do departamento executor, sem cópia', async () => {
  const p = await carlos.post('/projects', { name: `Planejamento Estratégico fictício ${st}`, startOn: '2030-01-07', objective: 'Plano fictício', members: [{ userId: lucas.me.user.id, role: 'membro' }] });
  expect(p.statusCode, p.body).toBe(201);
  pid = p.json().id;
  const a = await carlos.post(`/projects/${pid}/tasks`, { title: `Definir metas de receita ${st}`, ownerId: lucas.me.user.id, dueOn: '2030-03-15' });
  const b = await carlos.post(`/projects/${pid}/tasks`, { title: `Definir estratégia de retenção ${st}`, ownerId: carlos.me.user.id, dueOn: '2030-03-20' });
  expect(a.statusCode, a.body).toBe(201);
  expect(b.statusCode, b.body).toBe(201);
  ids.com = a.json().id; ids.cs = b.json().id;
  const com = (await ana.get('/quadros/comercial')).json().items.find((i: { id: string }) => i.id === ids.com);
  expect(com).toMatchObject({ column: 'backlog', link: { kind: 'projeto' } });
  const cs = (await mariana.get('/quadros/sucesso_cliente')).json().items.find((i: { id: string }) => i.id === ids.cs);
  expect(cs).toBeTruthy();
  expect((await mariana.get('/quadros/sucesso_cliente')).json().items.some((i: { id: string }) => i.id === ids.com)).toBe(false);
  expect(Number((await ctx.app.db.execute<{ n: number }>(sql`select count(*)::int as n from activities where title = ${`Definir metas de receita ${st}`}`)).rows[0]!.n)).toBe(1);
});

it('dependência entre departamentos: busca, vínculo, situação, risco e leitura da predecessora', async () => {
  const found = (await lucas.get(`/quadros/dependencias/busca?q=${encodeURIComponent(`estratégia de retenção ${st}`)}`)).json().items;
  expect(found[0]).toMatchObject({ id: ids.cs, boardLabel: 'Sucesso do Cliente' });
  const add = await lucas.post(`/tasks/${ids.com}/dependencies`, { dependsOnId: ids.cs });
  expect(add.statusCode, add.body).toBe(201);
  // circular não entra
  expect((await carlos.post(`/tasks/${ids.cs}/dependencies`, { dependsOnId: ids.com })).statusCode).toBe(422);

  const t = (await lucas.get(`/tasks/${ids.com}`)).json();
  // a predecessora (20/03) termina depois do prazo desta (15/03): em risco
  expect(t.blockedBy[0]).toMatchObject({ id: ids.cs, boardLabel: 'Sucesso do Cliente', dueDay: '2030-03-20', state: 'em_risco', atRisk: true });
  // a liderança do Comercial (fora do projeto) lê a predecessora do outro time, sem poder alterá-la
  const peer = await ana.get(`/tasks/${ids.cs}`);
  expect(peer.statusCode, peer.body).toBe(200);
  expect(peer.json().can).toMatchObject({ edit: false, comment: false });
  expect(peer.json().blocking[0]).toMatchObject({ id: ids.com, boardLabel: 'Comercial e Contratos' });
  expect((await ana.patch(`/tasks/${ids.cs}`, { rowVersion: peer.json().rowVersion, dueOn: '2030-03-10' })).statusCode).toBe(404);

  const card = (await ana.get('/quadros/comercial')).json().items.find((i: { id: string }) => i.id === ids.com);
  expect(card).toMatchObject({ depOpen: 1, depRisk: true });
});

it('replanejar a predecessora avisa a dependente e não muda o prazo dela', async () => {
  const cs = (await carlos.get(`/tasks/${ids.cs}`)).json();
  const before = (await lucas.get(`/tasks/${ids.com}`)).json().dueOn;
  const r = await carlos.patch(`/tasks/${ids.cs}`, { rowVersion: cs.rowVersion ?? cs.task?.rowVersion, dueOn: '2030-03-25' });
  expect(r.statusCode, r.body).toBe(200);
  expect((await lucas.get(`/tasks/${ids.com}`)).json().dueOn).toBe(before);
  const n = (await ctx.app.db.execute<{ title: string }>(sql`select title from user_notifications where user_id = ${lucas.me.user.id} and event = 'dependencia_em_risco' and title like ${`%metas de receita ${st}%`}`)).rows;
  expect(n.length).toBeGreaterThan(0);
  const ev = (await ctx.app.db.execute<{ type: string }>(sql`select type from activity_events where activity_id = ${ids.com} and type = 'dependencia_em_risco'`)).rows;
  expect(ev.length).toBeGreaterThan(0);
});

it('projeto por departamento: andamento em cada time, dependências entre times e avanço pelos entregáveis', async () => {
  const d = await carlos.get(`/projects/${pid}/departamentos`);
  expect(d.statusCode, d.body).toBe(200);
  const j = d.json();
  expect(j.departments.map((x: { key: string }) => x.key).sort()).toEqual(['comercial', 'sucesso_cliente']);
  expect(j.departments.find((x: { key: string }) => x.key === 'comercial')).toMatchObject({ total: 1, backlog: 1, inSprint: 0 });
  expect(j.dependencies).toHaveLength(1);
  expect(j.dependencies[0]).toMatchObject({ predecessor: { id: ids.cs, boardLabel: 'Sucesso do Cliente' }, dependent: { id: ids.com, boardLabel: 'Comercial e Contratos' }, state: 'em_risco', atRisk: true });
  expect(j.progress).toMatchObject({ total: 0, pct: 0 });
  expect(j.tasks).toEqual({ total: 2, done: 0 });
  // sem acesso ao projeto, sem painel
  expect((await mariana.get(`/projects/${pid}/departamentos`)).statusCode).toBe(404);
});
