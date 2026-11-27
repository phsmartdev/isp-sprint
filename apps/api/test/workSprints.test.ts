/**
 * Etapa 5 do Quadro de Tarefas (27/11/2026): capacidade em horas, Planejar Semana e Sprint semanal com fotografia
 * imutável do plano original, retirada com motivo e encerramento original × revisado. Dados fictícios.
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
// semana distante e única por execução (a Sprint é uma por semana e quadro)
const week = weekStart(new Date(Date.UTC(2045, 0, 2) + (Date.now() % 4000) * 7 * 86_400_000).toISOString().slice(0, 10));

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana] = (await Promise.all(['carlos', 'lucas', 'ana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const t = carlos.me.tenant.id;
  hadRow = (await ctx.app.db.execute(sql`select 1 from tenant_modules where module = 'crm' and tenant_id = ${t}`)).rows.length > 0;
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select x from unnest(disabled_features) x where not x = 'crm.quadro_tarefas') where module = 'crm' and tenant_id = ${t}`);
  else await ctx.app.db.execute(sql`insert into tenant_modules (tenant_id, module, enabled, mode, disabled_features) values (${t}, 'crm', true, 'todos', '{}')`);
  const [r] = (await ctx.app.db.execute<{ id: string }>(sql`insert into teams (tenant_id, name, manager_ids) values (${t}, ${`Comercial Sprint ${st}`}, array[${carlos.me.user.id}]::uuid[]) returning id`)).rows;
  team = r!.id;
  await ctx.app.db.execute(sql`insert into team_memberships (team_id, user_id, is_lead) values (${team}, ${ana.me.user.id}, true), (${team}, ${lucas.me.user.id}, false)`);
  expect((await carlos.put('/quadros/comercial/config', { teamIds: [team], wipLimit: 3, wipCountsWaiting: false })).statusCode).toBe(200);
});
afterAll(async () => {
  const t = carlos.me.tenant.id;
  if (hadRow) await ctx.app.db.execute(sql`update tenant_modules set disabled_features = array(select distinct unnest(disabled_features || '{crm.quadro_tarefas}'::text[])) where module = 'crm' and tenant_id = ${t}`);
  else await ctx.app.db.execute(sql`delete from tenant_modules where module = 'crm' and tenant_id = ${t}`);
  // histórico da Sprint é append-only: só na base de teste, com o gatilho desligado
  await ctx.app.db.execute(sql`alter table work_sprint_events disable trigger user`);
  await ctx.app.db.execute(sql`delete from work_sprint_events where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`alter table work_sprint_events enable trigger user`);
  await ctx.app.db.execute(sql`delete from work_sprint_items where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from work_sprints where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from work_absences where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from work_schedules where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from company_holidays where tenant_id = ${t} and name like ${`%${st}%`}`);
  await ctx.app.db.execute(sql`delete from task_boards where tenant_id = ${t}`);
  await ctx.app.db.execute(sql`delete from team_memberships where team_id = ${team}`);
  await ctx.app.db.execute(sql`update teams set deleted_at = now(), name = name || ' (removido)' where id = ${team}`);
  await ctx.close();
});

it('capacidade em horas: jornada − feriado − ausência, na parte da pessoa no departamento', async () => {
  // só a gestão cadastra jornada
  expect((await ana.put(`/quadros/comercial/capacidade/jornada/${lucas.me.user.id}`, { validFrom: '2040-01-01', minutesByWeekday: { 1: 480 } })).statusCode).toBe(403);
  const jor = { validFrom: '2040-01-01', minutesByWeekday: { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 }, allocations: { comercial: 5000 } };
  expect((await carlos.put(`/quadros/comercial/capacidade/jornada/${lucas.me.user.id}`, jor)).statusCode).toBe(200);
  expect((await carlos.put(`/quadros/comercial/capacidade/jornada/${ana.me.user.id}`, { ...jor, allocations: {} })).statusCode).toBe(200);
  expect((await carlos.post('/quadros/feriados', { day: week, name: `Feriado fictício ${st}` })).statusCode).toBe(201);
  // a liderança registra ausência parcial (2h por dia, terça e quarta)
  const tue = new Date(`${week}T12:00:00Z`); tue.setUTCDate(tue.getUTCDate() + 1);
  const wed = new Date(tue); wed.setUTCDate(wed.getUTCDate() + 1);
  expect((await ana.post('/quadros/comercial/capacidade/ausencias', { userId: lucas.me.user.id, kind: 'compromisso_fixo', startOn: tue.toISOString().slice(0, 10), endOn: wed.toISOString().slice(0, 10), minutesPerDay: 120 })).statusCode).toBe(201);
  expect((await lucas.post('/quadros/comercial/capacidade/ausencias', { userId: lucas.me.user.id, kind: 'ausencia', startOn: week, endOn: week })).statusCode).toBe(403);

  const cap = (await ana.get(`/quadros/comercial/capacidade?week=${week}`)).json();
  const lu = cap.people.find((p: { userId: string }) => p.userId === lucas.me.user.id);
  // 5×8h = 40h; − feriado (8h) − 2×2h = 28h; 50% no Comercial = 14h
  expect(lu).toMatchObject({ netMinutes: 14 * 60, allocationBp: 5000 });
  const an = cap.people.find((p: { userId: string }) => p.userId === ana.me.user.id);
  expect(an.netMinutes).toBe(32 * 60 * (an.allocationBp / 10_000));
});

it('Planejar Semana → abrir a Sprint (fotografia) → retirar com motivo → encerrar com o comparativo', async () => {
  const mk = async (title: string) => (await lucas.post('/tasks', { title: `${title} ${st}` })).json();
  const a = await mk('Proposta fictícia'), b = await mk('Ajuste interno fictício'), c = await mk('Hipótese fictícia');
  // colaborador não planeja a semana
  expect((await lucas.put('/quadros/comercial/planejamento', { week, items: [] })).statusCode).toBe(403);

  const items = [a, b, c].map((t, n) => ({ activityId: t.id, ownerId: lucas.me.user.id, estimateMinutes: [300, 240, 60][n], dueOn: null, position: n }));
  const saved = await ana.put('/quadros/comercial/planejamento', { week, objective: 'Semana fictícia', items });
  expect(saved.statusCode, saved.body).toBe(200);
  const sprintId = saved.json().sprintId;

  // sem categoria não abre
  let open = await ana.post(`/quadros/comercial/sprints/${sprintId}/abrir`, {});
  expect(open.statusCode).toBe(422);
  expect(open.json().detail).toContain('sem categoria');
  for (const [t, cat] of [[a, 'comercial'], [b, 'interno'], [c, 'hipotese']] as const) {
    const rv = (await ana.get(`/tasks/${t.id}`)).json();
    const r = await ana.patch(`/quadros/tarefas/${t.id}/planejamento`, { rowVersion: rv.rowVersion ?? rv.task?.rowVersion, capacityCategory: cat });
    expect(r.statusCode, r.body).toBe(200);
  }
  const plan = (await ana.get(`/quadros/comercial/planejamento?week=${week}`)).json();
  expect(plan.capacity.selectedMinutes).toBe(600);
  expect(plan.capacity.people.find((p: { userId: string }) => p.userId === lucas.me.user.id)).toMatchObject({ committedMinutes: 600, overload: false });
  expect(plan.capacity.distribution).toEqual({ comercial: 300, interno: 240, hipotese: 60 });

  // 50/40/10 está 20 p.p. fora da diretriz 70/20/10: abrir pede justificativa
  open = await ana.post(`/quadros/comercial/sprints/${sprintId}/abrir`, {});
  expect(open.statusCode).toBe(422);
  expect(open.json().detail).toContain('fora da diretriz');
  open = await ana.post(`/quadros/comercial/sprints/${sprintId}/abrir`, { justification: 'Semana de fechamento interno combinada com a gerência (fictício)' });
  expect(open.statusCode, open.body).toBe(200);
  expect(open.json()).toMatchObject({ tasks: 3, minutes: 600 });

  // aberta: o plano não muda mais pelo rascunho
  expect((await ana.put('/quadros/comercial/planejamento', { week, items })).statusCode).toBe(422);
  // fotografia imutável e eventos append-only
  const snap = (await ctx.app.db.execute<{ n: number }>(sql`select jsonb_array_length(snapshot->'items') as n from work_sprints where id = ${sprintId}`)).rows[0]!;
  expect(Number(snap.n)).toBe(3);
  await expect(ctx.app.db.execute(sql`update work_sprint_events set reason = 'x' where sprint_id = ${sprintId}`)).rejects.toThrow();

  // retirar exige motivo e mantém o original
  expect((await ana.post(`/quadros/comercial/sprints/${sprintId}/retirar`, { activityId: c.id, reason: 'curto' })).statusCode).toBe(422);
  expect((await ana.post(`/quadros/comercial/sprints/${sprintId}/retirar`, { activityId: c.id, reason: 'Hipótese adiada para a próxima semana (fictício)' })).statusCode).toBe(200);

  // conclui a proposta; encerra
  const rv = (await lucas.get(`/tasks/${a.id}`)).json();
  expect((await lucas.patch(`/tasks/${a.id}`, { rowVersion: rv.rowVersion ?? rv.task?.rowVersion, status: 'concluida' })).statusCode).toBe(200);
  const closed = await ana.post(`/quadros/comercial/sprints/${sprintId}/encerrar`, { learnings: 'Aprendizado fictício' });
  expect(closed.statusCode, closed.body).toBe(200);
  expect(closed.json().closing).toMatchObject({
    original: { tasks: 3, minutes: 600, deliveredMinutes: 300, deliveredTasks: 1 },
    revised: { tasks: 2, minutes: 540, deliveredMinutes: 300, deliveredTasks: 1 },
    finalDistribution: { comercial: 300, interno: 0, hipotese: 0 },
  });
  expect(closed.json().closing.replanned).toHaveLength(1);
  // a pendente volta a ser elegível (sem semana); nada vai sozinho para a próxima Sprint
  const pend = (await ctx.app.db.execute<{ planned_week: string | null }>(sql`select planned_week from activities where id = ${b.id}`)).rows[0]!;
  expect(pend.planned_week).toBeNull();
  const hist = (await ana.get(`/quadros/comercial/sprints/${sprintId}`)).json();
  expect(hist.events.map((e: { type: string }) => e.type)).toEqual(['aberta', 'retirada', 'encerrada']);
  expect((await ana.get('/quadros/comercial/sprints')).json().items[0]).toMatchObject({ id: sprintId, status: 'encerrada', planned: 3 });
});
