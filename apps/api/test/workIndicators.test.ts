/**
 * Etapa 8 do Quadro de Tarefas (27/11/2026): indicadores do departamento e visão consolidada da gerência.
 * Números conferidos à mão: plano original 35h, revisado 38h, fura-fila 8h, hipótese de 5h deslocada. Dados fictícios.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { weekStart } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client;
const st = Date.now().toString(36);
let team = '', hadRow = false, sprintId = '';
let opp = { id: '', value: 0 };
const ids = {} as { C: string; I: string; H: string; F: string; D1: string; D2: string };
const week = weekStart(new Date(Date.UTC(2048, 0, 2) + (Date.now() % 4000) * 7 * 86_400_000).toISOString().slice(0, 10));
const day = (n: number) => { const d = new Date(`${week}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const h = (n: number) => n * 60;
const rv = async (c: Client, id: string) => { const r = (await c.get(`/tasks/${id}`)).json(); return r.rowVersion ?? r.task?.rowVersion; };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana] = (await Promise.all(['carlos', 'lucas', 'ana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const t = carlos.me.tenant.id;
  hadRow = (await ctx.app.db.execute(sql`select 1 from tenant_modules where module = 'crm' and tenant_id = ${t}`)).rows.length > 0;
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select x from unnest(disabled_features) x where not x = 'crm.quadro_tarefas') where module = 'crm' and tenant_id = ${t}`);
  else await ctx.app.db.execute(sql`insert into tenant_modules (tenant_id, module, enabled, mode, disabled_features) values (${t}, 'crm', true, 'todos', '{}')`);
  const [r] = (await ctx.app.db.execute<{ id: string }>(sql`insert into teams (tenant_id, name, manager_ids) values (${t}, ${`Comercial Indicadores ${st}`}, array[${carlos.me.user.id}]::uuid[]) returning id`)).rows;
  team = r!.id;
  await ctx.app.db.execute(sql`insert into team_memberships (team_id, user_id, is_lead) values (${team}, ${ana.me.user.id}, true), (${team}, ${lucas.me.user.id}, false)`);
  expect((await carlos.put('/quadros/comercial/config', { teamIds: [team], wipLimit: 3, wipCountsWaiting: false })).statusCode).toBe(200);
  expect((await carlos.put(`/quadros/comercial/capacidade/jornada/${lucas.me.user.id}`, { validFrom: '2040-01-01', minutesByWeekday: { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 }, allocations: { comercial: 10_000 } })).statusCode).toBe(200);
  expect((await carlos.put(`/quadros/comercial/capacidade/jornada/${ana.me.user.id}`, { validFrom: '2040-01-01', minutesByWeekday: {}, allocations: {} })).statusCode).toBe(200);
  const [o] = (await ctx.app.db.execute<{ id: string; value: number }>(sql`select id, coalesce(value_cents, 0)::int as value from opportunities where tenant_id = ${t} and owner_id = ${lucas.me.user.id} and deleted_at is null and value_cents > 0 limit 1`)).rows;
  opp = { id: o!.id, value: o!.value };

  const task = async (title: string, cat: string, hours: number, extra: Record<string, unknown> = {}) => {
    const created = await lucas.post('/tasks', { title: `${title} ${st}`, ...extra });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const p = await ana.patch(`/quadros/tarefas/${id}/planejamento`, { rowVersion: await rv(ana, id), capacityCategory: cat, estimateMinutes: h(hours) });
    expect(p.statusCode, p.body).toBe(200);
    return id;
  };
  ids.C = await task('Proposta fictícia', 'comercial', 20, { opportunityId: opp.id });
  ids.I = await task('Rotina interna fictícia', 'interno', 10);
  ids.H = await task('Hipótese fictícia', 'hipotese', 5);
  ids.F = await task('Urgência fictícia', 'interno', 8);
  // duas tarefas atrasadas da MESMA oportunidade, fora da Sprint: o valor dela entra uma vez só
  ids.D1 = await task('Retorno atrasado fictício', 'comercial', 1, { opportunityId: opp.id, dueOn: '2026-01-05' });
  ids.D2 = await task('Documento atrasado fictício', 'comercial', 1, { opportunityId: opp.id, dueOn: '2026-01-06' });

  const items = [ids.C, ids.I, ids.H].map((activityId, n) => ({ activityId, ownerId: lucas.me.user.id, estimateMinutes: [h(20), h(10), h(5)][n], dueOn: day(4), position: n }));
  const saved = await ana.put('/quadros/comercial/planejamento', { week, objective: 'Semana fictícia', items });
  expect(saved.statusCode, saved.body).toBe(200);
  sprintId = saved.json().sprintId;
  expect((await ana.post(`/quadros/comercial/sprints/${sprintId}/abrir`, { justification: 'Distribuição fictícia combinada com a gerência' })).statusCode).toBe(200);
  // fura-fila de 8h: 5h livres + a hipótese de 5h
  const req = await lucas.post(`/quadros/comercial/sprints/${sprintId}/fura-filas`, { activityId: ids.F, origin: 'Cliente fictício', justification: 'Cliente fictício pediu com urgência', urgency: 'Prazo do cliente', consequence: 'Perde a janela', neededBy: day(3), estimateMinutes: h(8), ownerId: lucas.me.user.id });
  expect(req.statusCode, req.body).toBe(201);
  const ok = await ana.post(`/quadros/comercial/fura-filas/${req.json().id}/decisao`, { action: 'autorizar', selection: [{ activityId: ids.H, newDueOn: null }] });
  expect(ok.statusCode, ok.body).toBe(200);
  // a proposta é entregue dentro da semana; o resto não
  await ctx.app.db.execute(sql`update activities set status = 'concluida', completed_at = ${`${day(2)}T15:00:00Z`}::timestamptz where id = ${ids.C}`);
  expect((await ana.post(`/quadros/comercial/sprints/${sprintId}/encerrar`, {})).statusCode).toBe(200);
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
  await ctx.app.db.execute(sql`update activities set deleted_at = now() where id in (${ids.D1}, ${ids.D2})`);
  await ctx.app.db.execute(sql`delete from team_memberships where team_id = ${team}`);
  await ctx.app.db.execute(sql`update teams set deleted_at = now(), name = name || ' (removido)' where id = ${team}`);
  await ctx.close();
});

it('indicadores do departamento: original × revisado, não planejado, deslocado e camadas', async () => {
  const r = await ana.get(`/quadros/comercial/indicadores?from=${week}&to=${week}`);
  expect(r.statusCode, r.body).toBe(200);
  const j = r.json();
  expect(j.basis).toContain('não são horas trabalhadas');
  // original: 35h, entregue a proposta (20h) → 57,1%; revisado: 20 + 10 + 8 = 38h → 52,6%
  expect(j.compliance.original).toEqual({ minutes: h(35), deliveredMinutes: h(20), pct: 57.1 });
  expect(j.compliance.revised).toEqual({ minutes: h(38), deliveredMinutes: h(20), pct: 52.6 });
  expect(j.unplanned).toEqual({ minutes: h(8), pct: 21.1 });
  expect(j.displaced).toEqual({ comercial: 0, interno: 0, hipotese: h(5) });
  expect(j.furaFilas).toMatchObject({ included: 1, requests: 1, layers: { livre: 1, hipotese: 1, interno: 0, comercial: 0 } });
  expect(j.replanned).toBe(1);
  expect(j.distribution.planned).toEqual({ comercial: h(20), interno: h(18), hipotese: 0 });
  expect(j.distribution.executed).toEqual({ comercial: h(20), interno: 0, hipotese: 0 });
  expect(j.history).toHaveLength(1);
  // comerciais fora do plano: duas tarefas da mesma oportunidade → uma oportunidade, valor uma vez
  // comerciais fora do plano: o valor de cada oportunidade entra uma vez, mesmo com várias tarefas (a base tem outras do seed)
  const distinct = (await ctx.app.db.execute<{ n: number; v: number }>(sql`select count(distinct o.id)::int n, coalesce(sum(distinct_v.v), 0)::bigint v from (select distinct a.opportunity_id from activities a where a.id in (select id from activities where tenant_id = ${carlos.me.tenant.id} and owner_id in (${lucas.me.user.id}, ${ana.me.user.id}) and deleted_at is null and parent_id is null and status not in ('concluida','cancelada') and opportunity_id is not null and planned_week is distinct from ${weekStart(new Date().toISOString().slice(0, 10))})) x join opportunities o on o.id = x.opportunity_id cross join lateral (select coalesce(o.value_cents, 0) v) distinct_v`)).rows[0]!;
  expect(j.commercialUnplanned.opportunities).toBe(distinct.n);
  expect(j.commercialUnplanned.valueCents).toBe(Number(distinct.v));
  expect(j.commercialUnplanned.tasks).toBeGreaterThan(j.commercialUnplanned.opportunities);
  expect(j.criticalLate.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([ids.D1, ids.D2]));
  // filtro por pessoa
  const mine = (await ana.get(`/quadros/comercial/indicadores?from=${week}&to=${week}&ownerId=${ana.me.user.id}`)).json();
  expect(mine.compliance.original.minutes).toBe(0);
});

it('visão consolidada: só gerência/diretoria; compromisso de negócio afetado com valor uma vez', async () => {
  expect((await lucas.get('/quadros/visao-geral')).statusCode).toBe(403);
  expect((await ana.get('/quadros/visao-geral')).statusCode).toBe(403);
  const r = await carlos.get('/quadros/visao-geral');
  expect(r.statusCode, r.body).toBe(200);
  const j = r.json();
  const com = j.departments.find((d: { key: string }) => d.key === 'comercial');
  expect(com).toMatchObject({ role: 'gestao' });
  expect(com.overdue).toBeGreaterThanOrEqual(2);
  const o = j.business.opportunities.find((x: { id: string }) => x.id === opp.id);
  expect(o).toMatchObject({ valueCents: opp.value, reasons: ['tarefa atrasada'], departments: ['Comercial e Contratos'] });
  expect(j.business.opportunities.filter((x: { id: string }) => x.id === opp.id)).toHaveLength(1);
});
