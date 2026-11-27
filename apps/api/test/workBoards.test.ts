/**
 * Quadros de Tarefas (27/11/2026): cada módulo tem o seu; uma tarefa enviada a outro time entra no quadro dele e quem
 * enviou acompanha em "Enviadas"; um time não faz a gestão do outro (só a mesma gestão). Dados fictícios.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, mariana: Client;
const st = Date.now().toString(36);
let comTeam = '', csTeam = '';
let hadRow = false;
const FEATS = ['crm.quadro_tarefas', 'crm.quadro_sucesso'];

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana, mariana] = (await Promise.all(['carlos', 'lucas', 'ana', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  const t = carlos.me.tenant.id;
  const mk = async (name: string, lead: string, member: string) => {
    const [r] = (await ctx.app.db.execute<{ id: string }>(sql`insert into teams (tenant_id, name) values (${t}, ${name}) returning id`)).rows;
    await ctx.app.db.execute(sql`insert into team_memberships (team_id, user_id, is_lead) values (${r!.id}, ${lead}, true), (${r!.id}, ${member}, false)`);
    return r!.id;
  };
  comTeam = await mk(`Comercial Quadro ${st}`, ana.me.user.id, lucas.me.user.id);
  csTeam = await mk(`CS Quadro ${st}`, mariana.me.user.id, carlos.me.user.id);
});
afterAll(async () => {
  // devolve as funcionalidades e as equipes como estavam (outros testes usam a mesma base)
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select distinct unnest(disabled_features || '{crm.quadro_tarefas,crm.quadro_sucesso}'::text[])) where module = 'crm' and tenant_id = ${carlos.me.tenant.id}`);
  else await ctx.app.db.execute(sql`delete from tenant_modules where module = 'crm' and tenant_id = ${carlos.me.tenant.id}`);
  await ctx.app.db.execute(sql`delete from task_boards where tenant_id = ${carlos.me.tenant.id}`);
  await ctx.app.db.execute(sql`delete from team_memberships where team_id in (${comTeam}, ${csTeam})`);
  await ctx.app.db.execute(sql`update teams set deleted_at = now(), name = name || ' (removido)' where id in (${comTeam}, ${csTeam})`);
  await ctx.close();
});

it('submenu começa desligado; ligado, cada quadro tem as suas equipes', async () => {
  expect((await lucas.get('/quadros/comercial')).statusCode).toBe(403);
  hadRow = (await ctx.app.db.execute(sql`select 1 from tenant_modules where module = 'crm' and tenant_id = ${carlos.me.tenant.id}`)).rows.length > 0;
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select x from unnest(disabled_features) x where not x = any('{crm.quadro_tarefas,crm.quadro_sucesso}'::text[])) where module = 'crm' and tenant_id = ${carlos.me.tenant.id}`);
  else await ctx.app.db.execute(sql`insert into tenant_modules (tenant_id, module, enabled, mode, disabled_features) values (${carlos.me.tenant.id}, 'crm', true, 'todos', '{}')`);
  // Produto continua desligado (cada submenu é independente)
  expect((await lucas.get('/quadros/produto')).statusCode).toBe(403);
  expect((await ana.put('/quadros/comercial/config', { teamIds: [comTeam], wipLimit: 3, wipCountsWaiting: false })).statusCode).toBe(403); // líder não configura
  expect((await carlos.put('/quadros/comercial/config', { teamIds: [comTeam], wipLimit: 3, wipCountsWaiting: false })).statusCode).toBe(200);
  expect((await carlos.put('/quadros/sucesso_cliente/config', { teamIds: [csTeam], wipLimit: 3, wipCountsWaiting: false })).statusCode).toBe(200);
});

it('tarefa do comercial enviada ao Sucesso do Cliente: entra lá com a liderança de lá; quem enviou acompanha sem gerir', async () => {
  const t = (await lucas.post('/tasks', { title: `Plano de acompanhamento fictício ${st}` })).json();
  let com = (await ana.get('/quadros/comercial')).json();
  const item = com.items.find((i: { id: string }) => i.id === t.id);
  expect(item).toMatchObject({ column: 'backlog', origin: 'interna', category: null });
  expect(com.board.role).toBe('lideranca');

  const sent = await lucas.post(`/quadros/tarefas/${t.id}/enviar`, { to: 'sucesso_cliente', note: 'Cliente fictício pediu acompanhamento' });
  expect(sent.statusCode, sent.body).toBe(200);
  expect(sent.json().owner).toBe(mariana.me.user.id);

  const cs = (await mariana.get('/quadros/sucesso_cliente')).json();
  expect(cs.items.find((i: { id: string }) => i.id === t.id)).toMatchObject({ column: 'backlog', ownerId: mariana.me.user.id });
  com = (await ana.get('/quadros/comercial')).json();
  expect(com.items.some((i: { id: string }) => i.id === t.id)).toBe(false);
  const env = (await ana.get('/quadros/comercial?view=enviadas')).json();
  expect(env.items.find((i: { id: string }) => i.id === t.id)).toMatchObject({ readOnly: true });
  // quem enviou vê o andamento (drawer da tarefa)
  expect((await lucas.get(`/tasks/${t.id}`)).statusCode).toBe(200);

  // o comercial não faz a gestão do Sucesso do Cliente
  const row = (await lucas.get(`/tasks/${t.id}`)).json();
  const rv = row.rowVersion ?? row.task?.rowVersion;
  expect((await lucas.patch(`/tasks/${t.id}`, { rowVersion: rv, dueOn: '2030-01-15' })).statusCode).toBe(403);
  expect((await ana.patch(`/quadros/tarefas/${t.id}/planejamento`, { rowVersion: rv, capacityCategory: 'interno', estimateMinutes: 120 })).statusCode).toBe(403);
  // a liderança de lá planeja
  expect((await mariana.patch(`/quadros/tarefas/${t.id}/planejamento`, { rowVersion: rv, capacityCategory: 'interno', estimateMinutes: 120 })).statusCode).toBe(200);
  // mesma gestão: quem gere os dois times faz nos dois
  await ctx.app.db.execute(sql`update teams set manager_ids = array[${ana.me.user.id}]::uuid[] where id in (${comTeam}, ${csTeam})`);
  const rv2 = (await mariana.get(`/tasks/${t.id}`)).json();
  expect((await ana.patch(`/quadros/tarefas/${t.id}/planejamento`, { rowVersion: rv2.rowVersion ?? rv2.task?.rowVersion, estimateMinutes: 90 })).statusCode).toBe(200);
  await ctx.app.db.execute(sql`update teams set manager_ids = '{}' where id in (${comTeam}, ${csTeam})`);
});

it('tarefa de oportunidade nasce comercial; mudar a categoria pede justificativa; diretriz só pela gestão do departamento', async () => {
  const lk = (await lucas.get('/meta/lookups')).json();
  const o = (await lucas.post('/opportunities', { newContact: { name: `Conta Quadro ${st}`, segment: 'empresarial', phone: '79999994001' }, planId: lk.plans[0].id })).json();
  const t = (await lucas.post('/tasks', { title: `Elaborar proposta fictícia ${st}`, opportunityId: o.id })).json();
  const it0 = (await ana.get('/quadros/comercial?origin=crm')).json().items.find((i: { id: string }) => i.id === t.id);
  expect(it0).toMatchObject({ category: 'comercial', categoryAuto: true, commercial: true });
  const rv = (await lucas.get(`/tasks/${t.id}`)).json();
  const v = rv.rowVersion ?? rv.task?.rowVersion;
  expect((await ana.patch(`/quadros/tarefas/${t.id}/planejamento`, { rowVersion: v, capacityCategory: 'hipotese' })).statusCode).toBe(422);
  expect((await ana.patch(`/quadros/tarefas/${t.id}/planejamento`, { rowVersion: v, capacityCategory: 'hipotese', categoryReason: 'Teste fictício de nova abordagem de prospecção' })).statusCode).toBe(200);

  expect((await ana.post('/quadros/comercial/politica', { comercial: 6000, interno: 3000, hipotese: 1000, reason: 'Teste fictício de diretriz' })).statusCode).toBe(403);
  await ctx.app.db.execute(sql`update teams set manager_ids = array[${carlos.me.user.id}]::uuid[] where id = ${comTeam}`);
  expect((await carlos.post('/quadros/comercial/politica', { comercial: 6000, interno: 3000, hipotese: 500, reason: 'Teste fictício de diretriz' })).statusCode).toBe(422);
  expect((await carlos.post('/quadros/comercial/politica', { comercial: 6000, interno: 3000, hipotese: 1000, reason: 'Teste fictício de diretriz' })).statusCode).toBe(201);
  expect((await ana.get('/quadros/comercial')).json().policy).toMatchObject({ comercial: 6000, interno: 3000, hipotese: 1000 });
  await ctx.app.db.execute(sql`update teams set manager_ids = '{}' where id = ${comTeam}`);
});
