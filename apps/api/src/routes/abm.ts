/** Marketing → ABM: contas-alvo sobre os contatos/clientes existentes (sem duplicar cadastro) e catálogo de produtos. */
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute, IdParams } from '../http/route';
import { conflict, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { assertAssignableUser, ownerScope } from '../services/scope';

const TIERS = ['1_1', '1_poucos', '1_muitos'] as const;
const STATUSES = ['identificada', 'engajando', 'oportunidade', 'cliente', 'pausada'] as const;
const vis = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.abmAccounts.tenantId, ownerId: s.abmAccounts.ownerId });
const contactVisible = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });

async function enrich(db: DbOrTx, contactIds: string[]) {
  if (!contactIds.length) return { opps: [], tasks: [], last: [] };
  const [opps, tasks, last] = await Promise.all([
    db.select({ contactId: s.opportunities.contactId, n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${s.opportunities.valueCents}), 0)::bigint` }).from(s.opportunities).where(and(inArray(s.opportunities.contactId, contactIds), sql`${s.opportunities.deletedAt} is null`, sql`${s.opportunities.stage} not in ('ganha', 'perdida')`)).groupBy(s.opportunities.contactId),
    db.select({ contactId: s.activities.contactId, n: sql<number>`count(*)::int` }).from(s.activities).where(and(inArray(s.activities.contactId, contactIds), sql`${s.activities.deletedAt} is null`, sql`${s.activities.completedAt} is null`)).groupBy(s.activities.contactId),
    db.select({ contactId: s.activities.contactId, at: sql<string | null>`max(${s.activities.completedAt})` }).from(s.activities).where(and(inArray(s.activities.contactId, contactIds), sql`${s.activities.deletedAt} is null`)).groupBy(s.activities.contactId),
  ]);
  return { opps, tasks, last };
}

const Body = z.object({
  tier: z.enum(TIERS).optional(), status: z.enum(STATUSES).optional(), ownerId: z.string().uuid().optional(), priority: z.enum(['baixa', 'media', 'alta']).optional(),
  reason: z.string().trim().min(5).max(1000).optional(), nextStep: z.string().trim().max(300).nullable().optional(), nextStepOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const event = (db: DbOrTx, auth: AuthContext, abmId: string, type: string, payload: Record<string, unknown>) => db.insert(s.abmEvents).values({ tenantId: auth.tenantId, abmId, type, payload, actorId: auth.userId });

export const abmRoutes = [
  defineRoute({
    method: 'GET', url: '/abm', summary: 'Contas-alvo (ABM) com oportunidades abertas, pendências e último contato', tag: 'Marketing', module: 'clientes',
    query: z.object({ tier: z.enum(TIERS).optional(), status: z.enum(STATUSES).optional(), ownerId: z.string().uuid().optional(), q: z.string().max(100).optional() }),
    handler: async ({ app, auth, query: q }) => {
      const w: SQL[] = [vis(auth)];
      if (q.tier) w.push(eq(s.abmAccounts.tier, q.tier));
      if (q.status) w.push(eq(s.abmAccounts.status, q.status));
      if (q.ownerId) w.push(eq(s.abmAccounts.ownerId, q.ownerId));
      if (q.q) w.push(ilike(s.contacts.name, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`));
      const rows = await app.db.select({ a: s.abmAccounts, name: s.contacts.name, segment: s.contacts.segment, city: s.contacts.city, ownerName: s.users.name, customerId: s.customers.id })
        .from(s.abmAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.abmAccounts.contactId)).innerJoin(s.users, eq(s.users.id, s.abmAccounts.ownerId)).leftJoin(s.customers, eq(s.customers.contactId, s.contacts.id))
        .where(and(...w)).orderBy(sql`case ${s.abmAccounts.priority} when 'alta' then 0 when 'media' then 1 else 2 end`, asc(s.contacts.name)).limit(500);
      const e = await enrich(app.db, rows.map((r) => r.a.contactId));
      const counts = await app.db.select({ status: s.abmAccounts.status, n: sql<number>`count(*)::int` }).from(s.abmAccounts).where(vis(auth)).groupBy(s.abmAccounts.status);
      return {
        items: rows.map((r) => ({
          ...r.a, name: r.name, segment: r.segment, city: r.city, ownerName: r.ownerName, isCustomer: !!r.customerId,
          openOpportunities: e.opps.find((x) => x.contactId === r.a.contactId)?.n ?? 0, openValueCents: Number(e.opps.find((x) => x.contactId === r.a.contactId)?.value ?? 0),
          pendingActivities: e.tasks.find((x) => x.contactId === r.a.contactId)?.n ?? 0, lastContactAt: e.last.find((x) => x.contactId === r.a.contactId)?.at ?? null,
        })),
        counts: Object.fromEntries(STATUSES.map((st) => [st, counts.find((c) => c.status === st)?.n ?? 0])),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/abm/:id', summary: 'Conta-alvo com oportunidades e histórico', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [r] = await app.db.select({ a: s.abmAccounts, name: s.contacts.name, segment: s.contacts.segment, ownerName: s.users.name }).from(s.abmAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.abmAccounts.contactId)).innerJoin(s.users, eq(s.users.id, s.abmAccounts.ownerId)).where(and(eq(s.abmAccounts.id, params.id), vis(auth))).limit(1);
      if (!r) throw notFound('Conta-alvo não encontrada.');
      const [opps, events] = await Promise.all([
        app.db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, valueCents: s.opportunities.valueCents, ownerName: s.users.name }).from(s.opportunities).innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId)).where(and(eq(s.opportunities.contactId, r.a.contactId), sql`${s.opportunities.deletedAt} is null`)).orderBy(desc(s.opportunities.createdAt)).limit(50),
        app.db.select({ id: s.abmEvents.id, type: s.abmEvents.type, payload: s.abmEvents.payload, createdAt: s.abmEvents.createdAt, actorName: s.users.name }).from(s.abmEvents).leftJoin(s.users, eq(s.users.id, s.abmEvents.actorId)).where(eq(s.abmEvents.abmId, r.a.id)).orderBy(desc(s.abmEvents.createdAt)),
      ]);
      return { ...r.a, name: r.name, segment: r.segment, ownerName: r.ownerName, opportunities: opps, events };
    },
  }),
  defineRoute({
    method: 'POST', url: '/abm', summary: 'Marca uma conta existente como alvo do ABM (sem criar cadastro novo)', tag: 'Marketing', module: 'clientes',
    body: Body.extend({ contactId: z.string().uuid(), reason: z.string().trim().min(5).max(1000) }),
    handler: async ({ app, auth, body, reply }) => app.db.transaction(async (tx) => {
      const [c] = await tx.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.id, body.contactId), contactVisible(auth))).limit(1);
      if (!c) throw unprocessable('Conta não encontrada na sua carteira.', [{ path: 'contactId', message: 'Escolha uma conta da lista' }]);
      const ownerId = body.ownerId ?? auth.userId;
      await assertAssignableUser(tx, auth, 'clientes', ownerId);
      const [dup] = await tx.select({ id: s.abmAccounts.id }).from(s.abmAccounts).where(and(eq(s.abmAccounts.tenantId, auth.tenantId), eq(s.abmAccounts.contactId, body.contactId))).limit(1);
      if (dup) throw unprocessable('Esta conta já está na lista de ABM.');
      const [a] = await tx.insert(s.abmAccounts).values({ tenantId: auth.tenantId, contactId: body.contactId, tier: body.tier ?? '1_muitos', status: body.status ?? 'identificada', ownerId, priority: body.priority ?? 'media', reason: body.reason, nextStep: body.nextStep ?? null, nextStepOn: body.nextStepOn ?? null, createdBy: auth.userId }).returning({ id: s.abmAccounts.id });
      await event(tx, auth, a!.id, 'criada', { tier: body.tier ?? '1_muitos', reason: body.reason });
      reply.code(201);
      return a!;
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/abm/:id', summary: 'Atualiza tier, situação, responsável, prioridade, motivo e próximo passo (com histórico)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: Body.extend({ rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [a] = await tx.select().from(s.abmAccounts).where(and(eq(s.abmAccounts.id, params.id), vis(auth))).limit(1);
      if (!a) throw notFound('Conta-alvo não encontrada.');
      if (a.rowVersion !== body.rowVersion) throw conflict(a.rowVersion);
      if (body.ownerId && body.ownerId !== a.ownerId) await assertAssignableUser(tx, auth, 'clientes', body.ownerId);
      const { rowVersion, ...rest } = body;
      const changed = Object.entries(rest).filter(([k, v]) => v !== undefined && v !== (a as Record<string, unknown>)[k]).map(([k]) => k);
      await tx.update(s.abmAccounts).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.abmAccounts.rowVersion} + 1` }).where(eq(s.abmAccounts.id, a.id));
      if (changed.length) await event(tx, auth, a.id, rest.status && rest.status !== a.status ? 'situacao' : 'alterada', { fields: changed, from: Object.fromEntries(changed.map((k) => [k, (a as Record<string, unknown>)[k]])), to: Object.fromEntries(changed.map((k) => [k, (rest as Record<string, unknown>)[k]])) });
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ Produto: catálogo para consulta
  defineRoute({
    method: 'GET', url: '/catalog/plans', summary: 'Catálogo de planos e produtos para consulta (sem custos de parceiros)', tag: 'Produto', anyAuthenticated: true,
    query: z.object({ includeInactive: z.coerce.boolean().optional() }),
    handler: async ({ app, auth, query: q }) => {
      const rows = await app.db.select({ id: s.plans.id, name: s.plans.name, line: s.plans.line, segment: s.plans.segment, priceCents: s.plans.priceCents, speedMbps: s.plans.speedMbps, products: s.plans.products, active: s.plans.active, sourceSystem: s.plans.sourceSystem })
        .from(s.plans).where(and(eq(s.plans.tenantId, auth.tenantId), q.includeInactive ? undefined : eq(s.plans.active, true))).orderBy(asc(s.plans.segment), asc(s.plans.priceCents));
      return { items: rows.map((r) => ({ ...r, products: r.products.map((p) => ({ name: p.name, qty: p.qty, unitPriceCents: p.unitPriceCents })) })) };
    },
  }),
];
