/** Sprint na gamificação: tarefa da Sprint concluída no prazo vira evento (uma vez só); fora do prazo não; reabrir invalida. Dados fictícios. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq, like, sql } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { syncBusinessEvents } from '../src/services/businessEvents';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
let sprintId = '';
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client]; });
afterAll(async () => {
  // eventos de negócio são append-only: ficam (o invalidado já registra que a origem foi desfeita)
  if (sprintId) {
    await ctx.app.db.execute(sql`delete from work_sprint_items where sprint_id = ${sprintId}`);
    await ctx.app.db.execute(sql`delete from work_sprints where id = ${sprintId}`);
  }
  // este teste sincronizou os eventos agora: marca a última sincronização como antiga para os próximos testes
  // (a comemoração só ressincroniza se a última tiver mais de 5 s)
  await ctx.app.db.execute(sql`update business_event_sync set last_run_at = now() - interval '1 hour' where tenant_id = ${carlos.me.tenant.id}`);
  await ctx.close();
});

it('no prazo pontua; atrasada não; não duplica; reaberta é invalidada', async () => {
  const t = carlos.me.tenant.id, u = lucas.me.user.id, db = ctx.app.db;
  const st = Date.now().toString(36);
  const mk = async (title: string) => (await lucas.post('/tasks', { title: `${title} ${st}` })).json().id as string;
  const onTime = await mk('Entrega no prazo fictícia'), late = await mk('Entrega atrasada fictícia');
  const week = `2047-0${1 + (Date.now() % 9)}-0${1 + (Date.now() % 7)}`;
  const [sp] = await db.insert(s.workSprints).values({ tenantId: t, boardKey: 'comercial', weekStart: week, status: 'andamento', openedAt: new Date(), openedBy: carlos.me.user.id }).returning();
  sprintId = sp!.id;
  const due = new Date(Date.now() - 2 * 86_400_000);
  await db.insert(s.workSprintItems).values([onTime, late].map((activityId, n) => ({ tenantId: t, sprintId, activityId, entry: 'plano', committedMinutes: 60, category: 'comercial', ownerId: u, dueAt: due, position: n })));
  // uma concluída um dia antes do prazo, outra um dia depois
  await db.update(s.activities).set({ status: 'concluida', completedAt: new Date(due.getTime() - 86_400_000) }).where(eq(s.activities.id, onTime));
  await db.update(s.activities).set({ status: 'concluida', completedAt: new Date(due.getTime() + 86_400_000) }).where(eq(s.activities.id, late));

  await syncBusinessEvents(db, t);
  const evs = await db.select({ source: s.businessEvents.sourceId, owner: s.businessEvents.ownerId, type: s.businessEvents.type }).from(s.businessEvents).where(and(eq(s.businessEvents.tenantId, t), like(s.businessEvents.idemKey, `sprint_tarefa_no_prazo:${sprintId}:%`)));
  expect(evs).toEqual([{ source: onTime, owner: u, type: 'sprint_tarefa_no_prazo' }]);

  await syncBusinessEvents(db, t);
  expect((await db.execute<{ n: number }>(sql`select count(*)::int n from business_events where idem_key like ${`sprint_tarefa_no_prazo:${sprintId}:%`}`)).rows[0]!.n).toBe(1);

  // reaberta: o evento é invalidado (o histórico fica)
  await db.update(s.activities).set({ status: 'a_fazer', completedAt: null }).where(eq(s.activities.id, onTime));
  await syncBusinessEvents(db, t);
  const [ev] = await db.select({ validation: s.businessEvents.validation }).from(s.businessEvents).where(like(s.businessEvents.idemKey, `sprint_tarefa_no_prazo:${sprintId}:%`));
  expect(ev!.validation).toBe('invalidado');
  const cat = (await carlos.get('/performance/events/catalog')).json();
  if (cat?.items) expect(cat.items.some((x: { key: string }) => x.key === 'sprint_tarefa_no_prazo')).toBe(true);
});
