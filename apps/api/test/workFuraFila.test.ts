/**
 * Etapa 6 do Quadro de Tarefas (27/11/2026): fura-fila com a ordem obrigatória de consumo
 * (livre → 10% hipóteses → 20% internas → 70% comercial), alçadas e revalidação antes de aprovar. Dados fictícios.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { weekStart } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client;
const st = Date.now().toString(36);
let team = '';
let hadRow = false;
let sprintId = '';
const ids = {} as { C: string; I: string; H: string };
const week = weekStart(new Date(Date.UTC(2046, 0, 2) + (Date.now() % 4000) * 7 * 86_400_000).toISOString().slice(0, 10));
const day = (n: number) => { const d = new Date(`${week}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const h = (n: number) => n * 60;

const rv = async (c: Client, id: string) => { const r = (await c.get(`/tasks/${id}`)).json(); return r.rowVersion ?? r.task?.rowVersion; };
const task = async (title: string, cat: string, hours: number) => {
  const t = (await lucas.post('/tasks', { title: `${title} ${st}` })).json();
  const r = await ana.patch(`/quadros/tarefas/${t.id}/planejamento`, { rowVersion: await rv(ana, t.id), capacityCategory: cat, estimateMinutes: h(hours) });
  expect(r.statusCode, r.body).toBe(200);
  return t.id as string;
};
const ask = async (activityId: string, hours: number) => {
  const r = await lucas.post(`/quadros/comercial/sprints/${sprintId}/fura-filas`, { activityId, origin: 'Cliente fictício', justification: 'Cliente fictício pediu com urgência', urgency: 'Prazo do cliente', consequence: 'Perde a janela de instalação', neededBy: day(3), estimateMinutes: h(hours), ownerId: lucas.me.user.id });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
};
const decide = (c: Client, rid: string, body: Record<string, unknown>) => c.post(`/quadros/comercial/fura-filas/${rid}/decisao`, body);
const inSprint = async (id: string) => (await ctx.app.db.execute(sql`select 1 from work_sprint_items where sprint_id = ${sprintId} and activity_id = ${id} and removed_at is null`)).rows.length > 0;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana] = (await Promise.all(['carlos', 'lucas', 'ana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const t = carlos.me.tenant.id;
  hadRow = (await ctx.app.db.execute(sql`select 1 from tenant_modules where module = 'crm' and tenant_id = ${t}`)).rows.length > 0;
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select x from unnest(disabled_features) x where not x = 'crm.quadro_tarefas') where module = 'crm' and tenant_id = ${t}`);
  else await ctx.app.db.execute(sql`insert into tenant_modules (tenant_id, module, enabled, mode, disabled_features) values (${t}, 'crm', true, 'todos', '{}')`);
  const [r] = (await ctx.app.db.execute<{ id: string }>(sql`insert into teams (tenant_id, name, manager_ids) values (${t}, ${`Comercial Fura ${st}`}, array[${carlos.me.user.id}]::uuid[]) returning id`)).rows;
  team = r!.id;
  await ctx.app.db.execute(sql`insert into team_memberships (team_id, user_id, is_lead) values (${team}, ${ana.me.user.id}, true), (${team}, ${lucas.me.user.id}, false)`);
  expect((await carlos.put('/quadros/comercial/config', { teamIds: [team], wipLimit: 3, wipCountsWaiting: false })).statusCode).toBe(200);
  // Lucas: 40h na semana, todas no Comercial; Ana: sem horas de execução
  expect((await carlos.put(`/quadros/comercial/capacidade/jornada/${lucas.me.user.id}`, { validFrom: '2040-01-01', minutesByWeekday: { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 }, allocations: { comercial: 10_000 } })).statusCode).toBe(200);
  expect((await carlos.put(`/quadros/comercial/capacidade/jornada/${ana.me.user.id}`, { validFrom: '2040-01-01', minutesByWeekday: {}, allocations: {} })).statusCode).toBe(200);

  // Sprint: comercial 20h, interna 10h, hipótese 5h = 35h comprometidas de 40h (5h livres)
  ids.C = await task('Proposta fictícia', 'comercial', 20);
  ids.I = await task('Rotina interna fictícia', 'interno', 10);
  ids.H = await task('Teste de hipótese fictício', 'hipotese', 5);
  const items = [ids.C, ids.I, ids.H].map((activityId, n) => ({ activityId, ownerId: lucas.me.user.id, estimateMinutes: [h(20), h(10), h(5)][n], dueOn: day(4), position: n }));
  const saved = await ana.put('/quadros/comercial/planejamento', { week, objective: 'Semana fictícia', items });
  expect(saved.statusCode, saved.body).toBe(200);
  sprintId = saved.json().sprintId;
  const open = await ana.post(`/quadros/comercial/sprints/${sprintId}/abrir`, { justification: 'Distribuição fictícia combinada com a gerência' });
  expect(open.statusCode, open.body).toBe(200);
});
afterAll(async () => {
  const t = carlos.me.tenant.id;
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select distinct unnest(disabled_features || '{crm.quadro_tarefas}'::text[])) where module = 'crm' and tenant_id = ${t}`);
  else await ctx.app.db.execute(sql`delete from tenant_modules where module = 'crm' and tenant_id = ${t}`);
  await ctx.app.db.execute(sql`alter table work_sprint_events disable trigger user`);
  await ctx.app.db.execute(sql`delete from work_sprint_events where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`alter table work_sprint_events enable trigger user`);
  await ctx.app.db.execute(sql`delete from work_sprint_requests where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from work_sprint_items where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from work_sprints where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from work_schedules where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from task_boards where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from team_memberships where team_id = ${team}`);
  await ctx.app.db.execute(sql`update teams set deleted_at = now(), name = name || ' (removido)' where id = ${team}`);
  await ctx.close();
});

it('com capacidade livre: entra sem deslocar nada; colaborador pede, mas não decide', async () => {
  const f1 = await task('Urgência pequena fictícia', 'comercial', 3);
  // já na Sprint não vira fura-fila
  expect((await lucas.post(`/quadros/comercial/sprints/${sprintId}/fura-filas`, { activityId: ids.C, origin: 'x', justification: 'Justificativa fictícia', urgency: 'Urgente', consequence: 'Atraso', neededBy: day(2), estimateMinutes: 60, ownerId: lucas.me.user.id })).statusCode).toBe(422);
  const rid = await ask(f1, 3);
  const a = (await ana.get(`/quadros/comercial/fura-filas/${rid}`)).json();
  expect(a.live.capacity).toMatchObject({ totalNetMinutes: h(40), committedMinutes: h(35), freeMinutes: h(5), toRecoverMinutes: 0 });
  expect(a.live.analysis.suggestedIds).toEqual([]);
  expect((await decide(lucas, rid, { action: 'autorizar', selection: [] })).statusCode).toBe(403);
  const ok = await decide(ana, rid, { action: 'autorizar', selection: [] });
  expect(ok.statusCode, ok.body).toBe(200);
  expect(ok.json()).toMatchObject({ displaced: 0, freeUsedMinutes: h(3) });
  expect(await inSprint(f1)).toBe(true);
  expect(await inSprint(ids.H)).toBe(true);
});

it('sem capacidade livre: hipóteses antes das internas; pular a ordem é recusado', async () => {
  const f2 = await task('Ajuste urgente fictício', 'comercial', 8);
  const rid = await ask(f2, 8);
  const a = (await ana.get(`/quadros/comercial/fura-filas/${rid}`)).json();
  // 2h livres, faltam 6h: hipótese (5h) e depois a interna (10h); comercial intocado
  expect(a.live.capacity).toMatchObject({ freeMinutes: h(2), toRecoverMinutes: h(6) });
  expect(a.live.analysis.suggestedIds).toEqual([ids.H, ids.I]);
  expect(a.live.analysis.requiresManagerApproval).toBe(false);
  expect(a.live.layers.map((l: { category: string }) => l.category)).toEqual(['hipotese', 'interno', 'comercial']);
  const skip = await decide(ana, rid, { action: 'autorizar', selection: [{ activityId: ids.C, newDueOn: day(10) }] });
  expect(skip.statusCode).toBe(422);
  expect(skip.json().detail).toContain('Ordem de consumo');
  // nada mudou com a recusa (tudo ou nada)
  expect(await inSprint(ids.C)).toBe(true);
  const ok = await decide(ana, rid, { action: 'autorizar', selection: [{ activityId: ids.H, newDueOn: day(9) }, { activityId: ids.I, newDueOn: null }] });
  expect(ok.statusCode, ok.body).toBe(200);
  expect(await inSprint(ids.H)).toBe(false);
  expect(await inSprint(ids.I)).toBe(false);
  expect(await inSprint(f2)).toBe(true);
  const h1 = (await ctx.app.db.execute<{ planned_week: string | null; due: string }>(sql`select planned_week, to_char(due_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as due from activities where id = ${ids.H}`)).rows[0]!;
  expect(h1).toMatchObject({ planned_week: null, due: day(9) });
});

it('tocar o comercial: a liderança não aprova; a gerência aprova sobre a análise atual', async () => {
  const f3 = await task('Demanda grande fictícia', 'interno', 10);
  const rid = await ask(f3, 10);
  let a = (await ana.get(`/quadros/comercial/fura-filas/${rid}`)).json();
  // comprometido: C 20h + 3h + 8h = 31h; livres 9h; falta 1h e só resta o comercial
  expect(a.live.capacity).toMatchObject({ freeMinutes: h(9), toRecoverMinutes: h(1) });
  expect(a.live.analysis).toMatchObject({ suggestedIds: [ids.C], requiresManagerApproval: true });
  expect((await decide(ana, rid, { action: 'autorizar', selection: [{ activityId: ids.C, newDueOn: day(14) }] })).statusCode).toBe(403);
  expect(await inSprint(ids.C)).toBe(true);
  // precisa propor o novo prazo da atividade comercial
  expect((await decide(ana, rid, { action: 'solicitar_aprovacao', selection: [{ activityId: ids.C, newDueOn: null }] })).statusCode).toBe(422);
  expect((await decide(ana, rid, { action: 'solicitar_aprovacao', selection: [{ activityId: ids.C, newDueOn: day(14) }], reason: 'Renegociado com o cliente fictício' })).statusCode).toBe(200);
  expect((await decide(ana, rid, { action: 'aprovar', reason: 'Tentativa da liderança' })).statusCode).toBe(403);
  expect(await inSprint(ids.C)).toBe(true); // nada muda enquanto a aprovação está pendente

  // a capacidade mudou depois do pedido: a gerência não aprova sobre números velhos
  const r2 = await ana.patch(`/quadros/tarefas/${ids.C}/planejamento`, { rowVersion: await rv(ana, ids.C), remainingMinutes: h(18) });
  expect(r2.statusCode, r2.body).toBe(200);
  a = (await carlos.get(`/quadros/comercial/fura-filas/${rid}`)).json();
  expect(a.stale).toBe(true);
  const stale = await decide(carlos, rid, { action: 'aprovar', reason: 'Aprovação fictícia da gerência' });
  expect(stale.statusCode).toBe(422);
  expect((await carlos.get(`/quadros/comercial/fura-filas/${rid}`)).json().request.status).toBe('pendente');

  expect((await decide(ana, rid, { action: 'solicitar_aprovacao', selection: [{ activityId: ids.C, newDueOn: day(14) }], reason: 'Renegociado de novo' })).statusCode).toBe(200);
  expect((await decide(carlos, rid, { action: 'aprovar' })).statusCode).toBe(422); // sem justificativa
  const ok = await decide(carlos, rid, { action: 'aprovar', reason: 'Aprovado pela gerência após renegociação fictícia' });
  expect(ok.statusCode, ok.body).toBe(200);
  expect(await inSprint(ids.C)).toBe(false);
  expect(await inSprint(f3)).toBe(true);
  const req = (await carlos.get(`/quadros/comercial/fura-filas/${rid}`)).json().request;
  expect(req).toMatchObject({ status: 'aprovada', approvedBy: carlos.me.user.id, decidedBy: ana.me.user.id, approvalReason: 'Aprovado pela gerência após renegociação fictícia' });
  // prazo da oportunidade/projeto não é tocado; só a tarefa recebe o novo prazo proposto
  const evs = (await ctx.app.db.execute<{ type: string }>(sql`select type from work_sprint_events where sprint_id = ${sprintId} order by created_at`)).rows.map((x) => x.type);
  expect(evs.filter((x) => x === 'fura_fila')).toHaveLength(3);
  expect(evs).toContain('fura_fila_revalidar');
});

it('encerrar: fura-filas e o esforço deslocado por categoria, sem contar duas vezes', async () => {
  const closed = await ana.post(`/quadros/comercial/sprints/${sprintId}/encerrar`, {});
  expect(closed.statusCode, closed.body).toBe(200);
  const c = closed.json().closing;
  expect(c.furaFilas).toHaveLength(3);
  expect(c.displacedByFuraFila).toEqual({ comercial: h(20), interno: h(10), hipotese: h(5) });
  expect(c.original.minutes).toBe(h(35));
  expect(c.revised.minutes).toBe(h(21));
});
