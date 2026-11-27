/** GLPI na gamificação: o que foi feito no prazo vira evento (uma vez só); fora do prazo não. Dados fictícios. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq, like, sql } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { syncBusinessEvents } from '../src/services/businessEvents';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client]; });
afterAll(async () => ctx.close());

it('assumir e solucionar no prazo, menção respondida no prazo e aprovação atrasada', async () => {
  const t = carlos.me.tenant.id, u = lucas.me.user.id;
  const db = ctx.app.db;
  await db.insert(s.glpiSlaSettings).values({ tenantId: t, enabled: true, settings: { slaSource: 'universal', ownHours: 4, solveHours: 24, businessHoursOnly: false, approvalReplyHours: 1 } })
    .onConflictDoUpdate({ target: s.glpiSlaSettings.tenantId, set: { settings: { slaSource: 'universal', ownHours: 4, solveHours: 24, businessHoursOnly: false, approvalReplyHours: 1 } } });
  const glpiId = 900_000 + Math.floor(Math.random() * 99_999);
  const open = new Date(Date.now() - 3 * 86_400_000);
  const h = (n: number) => new Date(open.getTime() + n * 3_600_000);
  await db.insert(s.glpiQueueTickets).values({ tenantId: t, glpiId, title: 'Chamado fictício de teste', openedAt: open, takenAt: h(2), solvedAt: h(30), userIds: [u],
    mentions: [{ userId: u, name: 'Lucas', by: 'Fulano', at: h(1).toISOString(), answeredAt: h(3).toISOString() }],
    approvals: [{ validationId: glpiId, userId: u, groupId: null, name: 'Lucas', requester: 'Fulano', at: h(1).toISOString(), status: 3, decidedAt: h(5).toISOString() }] });

  await syncBusinessEvents(db, t);
  const evs = await db.select({ type: s.businessEvents.type, owner: s.businessEvents.ownerId }).from(s.businessEvents).where(and(eq(s.businessEvents.tenantId, t), like(s.businessEvents.idemKey, `glpi_%:${glpiId}:%`)));
  // assumiu em 2 h (prazo 4 h) e respondeu a menção em 2 h: pontuam; solucionou em 30 h (prazo 24 h) e aprovou em 4 h (prazo 1 h): não
  expect(evs.map((e) => e.type).sort()).toEqual(['glpi_chamado_assumido', 'glpi_mencao_respondida']);
  expect(evs.every((e) => e.owner === u)).toBe(true);

  await syncBusinessEvents(db, t); // de novo: não duplica
  const again = (await db.execute<{ n: number }>(sql`select count(*)::int n from business_events where tenant_id = ${t} and idem_key like ${`glpi_%:${glpiId}:%`}`)).rows[0]!.n;
  expect(again).toBe(2);
  // catálogo mostra os novos eventos do GLPI
  const cat = (await carlos.get('/performance/events/catalog')).json();
  if (cat?.items) expect(cat.items.some((x: { key: string }) => x.key === 'glpi_chamado_solucionado')).toBe(true);
});
