/** Quadro do Marketing: Sprint, responsável e observadores, limite em execução, fura-fila, etiquetas, relacionados, orçamento e brindes. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [carlos, ana] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'ana@yepnet.test')]); });
afterAll(async () => ctx.close());

it('fluxo completo do quadro', async () => {
  const tid = (await ctx.db.execute<{ tenant_id: string }>(sql`select tenant_id from users where email = 'carlos@yepnet.test'`)).rows[0]!.tenant_id;
  await ctx.db.execute(sql`delete from mkt_cards where tenant_id = ${tid}`);
  await ctx.db.execute(sql`delete from mkt_sprints where tenant_id = ${tid}`);
  await ctx.db.execute(sql`delete from mkt_tags where tenant_id = ${tid}`);
  const me = carlos.me.user.id, other = ana.me.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  // Sprint em planejamento e tarefas com um responsável e observadores
  const sp = ok(await carlos.post('/marketing/quadro/sprints', { startOn: today, objective: 'Campanha de fim de ano (fictícia)' }), 201).json();
  expect(sp.endOn).toBe(day(14));
  const tag = ok(await carlos.post('/marketing/quadro/tags', { name: 'Campanha Fictícia', color: '#2F5986' }), 201).json();
  expect((await carlos.post('/marketing/quadro/tags', { name: 'campanha fictícia' })).statusCode).toBe(422);
  const mk = async (title: string, extra: Record<string, unknown> = {}) => ok(await carlos.post('/marketing/quadro/cards', { title, ownerId: me, observerIds: [other], sprintId: sp.id, dueOn: day(3), verticals: ['arte'], allocation: 'comercial', tagIds: [tag.id], ...extra }), 201).json().id as string;
  const a = await mk('Peças da campanha'), b = await mk('Vídeo curto'), c = await mk('Landing page'), d = await mk('Post orgânico', { dueOn: day(-1) });

  // limite de 3 em execução por pessoa
  let board = ok(await carlos.get('/marketing/quadro')).json();
  const rv = (id: string) => board.cards.find((x: { id: string }) => x.id === id).rowVersion;
  for (const id of [a, b, c]) { ok(await carlos.patch(`/marketing/quadro/cards/${id}`, { rowVersion: rv(id), column: 'em_execucao' })); }
  board = ok(await carlos.get('/marketing/quadro')).json();
  const over = await carlos.patch(`/marketing/quadro/cards/${d}`, { rowVersion: rv(d), column: 'em_execucao' });
  expect(over.statusCode).toBe(422);
  expect(over.json().detail).toMatch(/3 tarefas em execução/);
  expect(board.stats).toMatchObject({ total: 4, overdue: 1, inProgress: 3 });
  expect(board.stats.allocation[0]).toMatchObject({ key: 'comercial', pct: 100, target: 70 });
  expect(board.cards.find((x: { id: string }) => x.id === d).due).toBe('atrasada');

  // observador vê, mas não altera
  board = ok(await ana.get('/marketing/quadro')).json();
  expect(board.cards.find((x: { id: string }) => x.id === a).canEdit).toBe(true); // ana é liderança (supervisão)
  // abrir: escopo fechado; nova demanda só por fura-fila
  const opened = ok(await carlos.post(`/marketing/quadro/sprints/${sp.id}/abrir`)).json();
  expect(opened.email.subject).toBe('Abertura da Sprint de Marketing | Planejamento Quinzenal');
  expect(opened.email.text).toContain('• Peças da campanha');
  expect((await carlos.post('/marketing/quadro/cards', { title: 'Urgente', ownerId: other, sprintId: sp.id })).statusCode).toBe(422);
  const f = ok(await carlos.post('/marketing/quadro/cards', { title: 'Material para licitação urgente', ownerId: other, sprintId: sp.id, furaFila: { criterion: 'receita', reason: 'Pedido do comercial com prazo do edital' } }), 201).json().id;
  board = ok(await carlos.get('/marketing/quadro')).json();
  const fc = board.cards.find((x: { id: string }) => x.id === f);
  expect(fc).toMatchObject({ furaFila: true, furaFilaStatus: 'pendente', column: 'backlog' });
  expect((await carlos.patch(`/marketing/quadro/cards/${f}`, { rowVersion: fc.rowVersion, column: 'a_fazer' })).statusCode).toBe(422);
  const notif = (await ctx.db.execute(sql`select count(*)::int n from user_notifications where user_id = ${other} and event = 'mkt_fura_fila' and link like ${`%${f}%`}`)).rows[0] as { n: number };
  expect(notif.n).toBeGreaterThanOrEqual(1);
  ok(await ana.post(`/marketing/quadro/cards/${f}/fura-fila`, { approve: true, note: 'Prazo do edital', rescheduled: [{ cardId: b, dueOn: day(10) }] }));
  const det = ok(await carlos.get(`/marketing/quadro/cards/${f}`)).json();
  expect(det).toMatchObject({ furaFilaStatus: 'aprovado', column: 'a_fazer' });
  expect(det.events.some((e: { text: string | null }) => e.text?.includes('reprogramadas: Vídeo curto'))).toBe(true);

  // relacionados: oportunidade na tarefa e conta na etiqueta
  const opp = (await ctx.db.execute<{ id: string; title: string }>(sql`select id, title from opportunities where tenant_id = ${tid} and deleted_at is null limit 1`)).rows[0]!;
  const found = ok(await carlos.get(`/marketing/quadro/relacionaveis?q=${encodeURIComponent(opp.title.slice(0, 6))}`)).json().items;
  expect(found.some((x: { entityId: string }) => x.entityId === opp.id)).toBe(true);
  ok(await carlos.post('/marketing/quadro/links', { cardId: a, entityType: 'oportunidade', entityId: opp.id }), 201);
  const acct = (await ctx.db.execute<{ id: string }>(sql`select id from contacts where tenant_id = ${tid} and deleted_at is null limit 1`)).rows[0]!;
  ok(await carlos.post('/marketing/quadro/links', { tagId: tag.id, entityType: 'conta', entityId: acct.id }), 201);
  const da = ok(await carlos.get(`/marketing/quadro/cards/${a}`)).json();
  expect(da.links[0]).toMatchObject({ entityType: 'oportunidade', url: `/opportunities/${opp.id}` });
  expect(da.tagLinks[0]).toMatchObject({ entityType: 'conta' });
  const tags = ok(await carlos.get('/marketing/quadro/tags')).json().items;
  expect(tags[0].cards.length).toBe(4);

  // brindes e orçamento no cartão
  const gift = (await ctx.db.execute<{ id: string; unit_cost_cents: number }>(sql`insert into gift_items (tenant_id, name, unit_cost_cents) values (${tid}, ${`Caneca fictícia ${Date.now()}`}, 2500) returning id, unit_cost_cents`)).rows[0]!;
  const cur = ok(await carlos.get(`/marketing/quadro/cards/${a}`)).json();
  ok(await carlos.patch(`/marketing/quadro/cards/${a}`, { rowVersion: cur.rowVersion, gifts: [{ itemId: gift.id, qty: 40 }], budgetCents: 150_000 }));
  board = ok(await carlos.get('/marketing/quadro')).json();
  expect(board.cards.find((x: { id: string }) => x.id === a)).toMatchObject({ giftQty: 40, giftCents: 100_000, budgetCents: 150_000 });

  // concluir avisa observadores; encerrar devolve a comunicação e tira as pendentes da Sprint
  const ca = board.cards.find((x: { id: string }) => x.id === a);
  ok(await carlos.patch(`/marketing/quadro/cards/${a}`, { rowVersion: ca.rowVersion, column: 'concluido' }));
  const closed = ok(await carlos.post(`/marketing/quadro/sprints/${sp.id}/encerrar`, { highlights: 'Campanha no ar' })).json();
  expect(closed.email.text).toContain('Entregas concluídas\n• Peças da campanha');
  expect(closed.email.text).toContain('Reprogramações');
  const pend = (await ctx.db.execute(sql`select count(*)::int n from mkt_cards where sprint_id = ${sp.id} and "column" <> 'concluido'`)).rows[0] as { n: number };
  expect(pend.n).toBe(0);

  // aviso de prazo pela rotina diária (uma vez por dia)
  const { runMarketingDueAlerts } = await import('../src/routes/marketingBoard');
  const n1 = await runMarketingDueAlerts(ctx.db, tid, today);
  expect(n1).toBeGreaterThan(0);
  expect(await runMarketingDueAlerts(ctx.db, tid, today)).toBe(0);
});
