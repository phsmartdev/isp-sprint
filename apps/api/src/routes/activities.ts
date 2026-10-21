import { and, asc, desc, eq, ilike, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { ActivityCreate, ActivityListQuery, ActivityUpdate } from '@isp/shared';
import { ACTIVITY_TYPES, atLeast, isOverdue } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { assertAssignableUser, assertTenantRefs, level, ownerScope } from '../services/scope';
import { loadOpportunity } from '../services/opportunities';

const owner = alias(s.users, 'act_owner');

const select = {
  id: s.activities.id,
  type: s.activities.type,
  title: s.activities.title,
  notes: s.activities.notes,
  dueAt: s.activities.dueAt,
  priority: s.activities.priority,
  completedAt: s.activities.completedAt,
  csKind: s.activities.csKind,
  csResult: s.activities.csResult,
  createdAt: s.activities.createdAt,
  rowVersion: s.activities.rowVersion,
  ownerId: s.activities.ownerId,
  ownerName: owner.name,
  opportunityId: s.activities.opportunityId,
  opportunityTitle: s.opportunities.title,
  opportunityCode: s.opportunities.code,
  leadId: s.activities.leadId,
  contactId: s.activities.contactId,
  contactName: s.contacts.name,
  contactSegment: s.contacts.segment,
};

function query(db: DbOrTx) {
  return db
    .select(select)
    .from(s.activities)
    .innerJoin(owner, eq(owner.id, s.activities.ownerId))
    .leftJoin(s.opportunities, eq(s.opportunities.id, s.activities.opportunityId))
    .leftJoin(s.contacts, eq(s.contacts.id, s.activities.contactId));
}

const vis = (auth: AuthContext) => ownerScope(auth, 'atividades', { tenantId: s.activities.tenantId, ownerId: s.activities.ownerId, deletedAt: s.activities.deletedAt });

async function load(db: DbOrTx, auth: AuthContext, id: string) {
  const [row] = await query(db).where(and(eq(s.activities.id, id), vis(auth))).limit(1);
  if (!row) throw notFound('Atividade não encontrada.');
  return row;
}

function dto(r: Awaited<ReturnType<typeof load>>, now = new Date()) {
  return { ...r, overdue: isOverdue(r.dueAt, r.completedAt, now) };
}

/** Dia local (fuso da empresa) de um timestamp, para filtros de agenda. */
const localDay = (auth: AuthContext) => sql`(${s.activities.dueAt} at time zone ${auth.timezone})::date`;

export const activityRoutes = [
  defineRoute({
    method: 'GET',
    url: '/activities',
    summary: 'Agenda de atividades (filtros por tipo, status, responsável e intervalo de dias)',
    tag: 'Atividades',
    module: 'atividades',
    query: ActivityListQuery,
    handler: async ({ app, auth, query: q }) => {
      if (q.scope === 'equipe' && !atLeast(level(auth, 'atividades'), 'equipe')) throw forbidden('Seu perfil vê apenas as próprias atividades.');
      const base: SQL[] = [vis(auth)];
      if (q.scope === 'minhas') base.push(eq(s.activities.ownerId, auth.userId));
      if (q.ownerId) base.push(eq(s.activities.ownerId, q.ownerId));
      if (q.opportunityId) base.push(eq(s.activities.opportunityId, q.opportunityId));
      if (q.leadId) base.push(eq(s.activities.leadId, q.leadId));
      if (q.contactId) base.push(eq(s.activities.contactId, q.contactId));
      if (q.q) {
        const term = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
        base.push(or(ilike(s.activities.title, term), ilike(s.contacts.name, term))!);
      }
      const tz = auth.timezone;
      if (q.status === 'abertas') base.push(isNull(s.activities.completedAt));
      if (q.status === 'concluidas') base.push(isNotNull(s.activities.completedAt));
      if (q.status === 'atrasadas') base.push(isNull(s.activities.completedAt), lt(s.activities.dueAt, sql`now()`));
      if (q.status === 'hoje') base.push(isNull(s.activities.completedAt), sql`${localDay(auth)} = (now() at time zone ${tz})::date`);
      if (q.from) {
        const days = q.days ?? 1;
        base.push(sql`${localDay(auth)} >= ${q.from}::date and ${localDay(auth)} < ${q.from}::date + ${days}::int`);
      }
      const withType = [...base];
      if (q.type) withType.push(eq(s.activities.type, q.type));
      const order = q.status === 'concluidas' ? [desc(s.activities.completedAt)] : [sql`${s.activities.dueAt} asc nulls last`, asc(s.activities.createdAt)];
      const [rows, [{ total } = { total: 0 }], byType, counts] = await Promise.all([
        query(app.db).where(and(...withType)).orderBy(...order).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        app.db.select({ total: sql<number>`count(*)::int` }).from(s.activities).leftJoin(s.contacts, eq(s.contacts.id, s.activities.contactId)).where(and(...withType)),
        app.db
          .select({ type: s.activities.type, n: sql<number>`count(*)::int` })
          .from(s.activities)
          .leftJoin(s.contacts, eq(s.contacts.id, s.activities.contactId))
          .where(and(...base))
          .groupBy(s.activities.type),
        app.db
          .select({
            overdue: sql<number>`count(*) filter (where ${s.activities.completedAt} is null and ${s.activities.dueAt} < now())::int`,
            today: sql<number>`count(*) filter (where ${s.activities.completedAt} is null and ${localDay(auth)} = (now() at time zone ${tz})::date)::int`,
            open: sql<number>`count(*) filter (where ${s.activities.completedAt} is null)::int`,
          })
          .from(s.activities)
          .where(and(vis(auth), q.scope === 'minhas' ? eq(s.activities.ownerId, auth.userId) : undefined)),
      ]);
      const typeCounts = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, byType.find((b) => b.type === t)?.n ?? 0]));
      const now = new Date();
      return { items: rows.map((r) => dto(r, now)), page: q.page, pageSize: q.pageSize, total, counts: counts[0], typeCounts };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/activities/calendar',
    summary: 'Calendário do mês (tipos por dia), próximas atividades e resumo da semana',
    tag: 'Atividades',
    module: 'atividades',
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), scope: z.enum(['minhas', 'equipe']).default('minhas') }),
    handler: async ({ app, auth, query: q }) => {
      if (q.scope === 'equipe' && !atLeast(level(auth, 'atividades'), 'equipe')) throw forbidden('Seu perfil vê apenas as próprias atividades.');
      const scope = and(vis(auth), q.scope === 'minhas' ? eq(s.activities.ownerId, auth.userId) : undefined);
      const tz = auth.timezone;
      const [days, upcoming, week] = await Promise.all([
        app.db
          .select({ day: sql<string>`to_char(${localDay(auth)}, 'YYYY-MM-DD')`, types: sql<string[]>`array_agg(distinct ${s.activities.type})` })
          .from(s.activities)
          .where(and(scope, sql`to_char(${localDay(auth)}, 'YYYY-MM') = ${q.month}`))
          .groupBy(sql`1`),
        query(app.db)
          .where(and(scope, isNull(s.activities.completedAt), sql`${localDay(auth)} > (now() at time zone ${tz})::date`))
          .orderBy(asc(s.activities.dueAt))
          .limit(4),
        app.db
          .select({ type: s.activities.type, n: sql<number>`count(*)::int` })
          .from(s.activities)
          .where(and(scope, sql`date_trunc('week', ${s.activities.dueAt} at time zone ${tz}) = date_trunc('week', now() at time zone ${tz})`))
          .groupBy(s.activities.type),
      ]);
      return {
        days,
        upcoming: upcoming.map((r) => dto(r)),
        week: Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, week.find((w) => w.type === t)?.n ?? 0])),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/activities',
    summary: 'Cria atividade (idempotente para lembretes idênticos em aberto)',
    tag: 'Atividades',
    module: 'atividades',
    body: ActivityCreate,
    handler: async ({ app, auth, body, reply }) => {
      const ownerId = body.ownerId ?? auth.userId;
      const result = await app.db.transaction(async (tx) => {
        await assertAssignableUser(tx, auth, 'atividades', ownerId);
        await assertTenantRefs(tx, auth, { contactId: body.contactId });
        let contactId = body.contactId ?? null;
        if (body.opportunityId) {
          const opp = await loadOpportunity(tx, auth, body.opportunityId);
          contactId = contactId ?? opp.contactId;
        }
        if (body.leadId) {
          const [l] = await tx.select({ contactId: s.leads.contactId }).from(s.leads).where(and(eq(s.leads.id, body.leadId), eq(s.leads.tenantId, auth.tenantId))).limit(1);
          if (!l) throw notFound('Lead não encontrado.');
          contactId = contactId ?? l.contactId;
        }
        const dueAt = body.dueAt ? new Date(body.dueAt) : null;
        const dup = await tx
          .select({ id: s.activities.id })
          .from(s.activities)
          .where(
            and(
              eq(s.activities.tenantId, auth.tenantId),
              eq(s.activities.ownerId, ownerId),
              eq(s.activities.type, body.type),
              eq(s.activities.title, body.title),
              isNull(s.activities.completedAt),
              isNull(s.activities.deletedAt),
              body.opportunityId ? eq(s.activities.opportunityId, body.opportunityId) : isNull(s.activities.opportunityId),
              dueAt ? eq(s.activities.dueAt, dueAt) : isNull(s.activities.dueAt),
            ),
          )
          .limit(1);
        if (dup[0]) return { id: dup[0].id, created: false };
        const [a] = await tx
          .insert(s.activities)
          .values({
            tenantId: auth.tenantId,
            type: body.type,
            title: body.title,
            notes: body.notes,
            dueAt,
            priority: body.priority,
            ownerId,
            opportunityId: body.opportunityId ?? null,
            leadId: body.leadId ?? null,
            contactId,
            createdBy: auth.userId,
          })
          .returning({ id: s.activities.id });
        await tx.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: a!.id, type: 'created', actorId: auth.userId, payload: { dueAt: dueAt?.toISOString() ?? null, type: body.type } });
        return { id: a!.id, created: true };
      });
      reply.code(result.created ? 201 : 200);
      return { ...dto(await load(app.db, auth, result.id)), deduplicated: !result.created };
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/activities/:id',
    summary: 'Conclui, reabre, reagenda ou edita atividade',
    tag: 'Atividades',
    module: 'atividades',
    params: IdParams,
    body: ActivityUpdate,
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const cur = await load(tx, auth, params.id);
        if (cur.rowVersion !== body.rowVersion) throw conflict(cur.rowVersion);
        if (body.ownerId && body.ownerId !== cur.ownerId) await assertAssignableUser(tx, auth, 'atividades', body.ownerId);
        const now = new Date();
        const dueAt = body.dueAt === undefined ? undefined : body.dueAt ? new Date(body.dueAt) : null;
        const events: { type: string; payload: Record<string, unknown> }[] = [];
        if (body.completed === true && !cur.completedAt) events.push({ type: 'completed', payload: body.csResult ? { csResult: true } : {} });
        if (body.completed === false && cur.completedAt) events.push({ type: 'reopened', payload: {} });
        if (dueAt !== undefined && (dueAt?.getTime() ?? null) !== (cur.dueAt?.getTime() ?? null)) {
          events.push({ type: 'rescheduled', payload: { from: cur.dueAt?.toISOString() ?? null, to: dueAt?.toISOString() ?? null } });
        }
        if (body.ownerId && body.ownerId !== cur.ownerId) events.push({ type: 'assigned', payload: { from: cur.ownerId, to: body.ownerId } });
        if (body.title || body.priority || body.notes !== undefined) events.push({ type: 'updated', payload: {} });
        const updated = await tx
          .update(s.activities)
          .set({
            title: body.title,
            priority: body.priority,
            notes: body.notes,
            ownerId: body.ownerId,
            dueAt,
            completedAt: body.completed === undefined ? undefined : body.completed ? cur.completedAt ?? now : null,
            completedBy: body.completed === undefined ? undefined : body.completed ? auth.userId : null,
            csResult: body.completed === false ? null : body.csResult ?? undefined,
            updatedAt: now,
            rowVersion: sql`${s.activities.rowVersion} + 1`,
          })
          .where(and(eq(s.activities.id, params.id), eq(s.activities.tenantId, auth.tenantId), eq(s.activities.rowVersion, body.rowVersion)))
          .returning({ id: s.activities.id });
        if (!updated.length) throw conflict(cur.rowVersion);
        for (const e of events) await tx.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: params.id, type: e.type, actorId: auth.userId, payload: e.payload });
      });
      return dto(await load(app.db, auth, params.id));
    },
  }),
];
