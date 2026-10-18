import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { BulkAssign, LeadCreate, LeadListQuery, LeadUpdate } from '@isp/shared';
import { leadSla, leadTemperature } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import { assertAssignableUser, assertTenantRefs, ownerScope } from '../services/scope';
import { audit } from '../services/audit';
import { notifyLeadAssigned } from '../services/alerts';
import { createOpportunity } from '../services/opportunities';
import { pctDelta } from '../services/metrics';

const owner = alias(s.users, 'owner');

const leadSelect = {
  id: s.leads.id,
  status: s.leads.status,
  interests: s.leads.interests,
  channel: s.leads.channel,
  nextAction: s.leads.nextAction,
  nextActionAt: s.leads.nextActionAt,
  firstContactAt: s.leads.firstContactAt,
  lastContactAt: s.leads.lastContactAt,
  lastInteractionNote: s.leads.lastInteractionNote,
  notes: s.leads.notes,
  convertedOpportunityId: s.leads.convertedOpportunityId,
  createdAt: s.leads.createdAt,
  updatedAt: s.leads.updatedAt,
  rowVersion: s.leads.rowVersion,
  contactId: s.contacts.id,
  name: s.contacts.name,
  phone: s.contacts.phone,
  email: s.contacts.email,
  segment: s.contacts.segment,
  city: s.contacts.city,
  ownerId: s.leads.ownerId,
  ownerName: owner.name,
  ownerHasAvatar: sql<boolean>`exists(select 1 from user_avatars ua where ua.user_id = "leads"."owner_id")`,
  sourceId: s.leads.sourceId,
  sourceName: s.leadSources.name,
  campaignId: s.leads.campaignId,
  campaignName: s.campaigns.name,
};

type LeadRow = Awaited<ReturnType<typeof loadLead>>;

function toDto(r: LeadRow, now = new Date()) {
  return {
    ...r,
    temperature: leadTemperature({ now, createdAt: r.createdAt, lastContactAt: r.lastContactAt, nextActionAt: r.nextActionAt, interests: r.interests, status: r.status }),
    sla: leadSla(r.createdAt, r.firstContactAt, now),
  };
}

function baseQuery(db: DbOrTx) {
  return db
    .select(leadSelect)
    .from(s.leads)
    .innerJoin(s.contacts, eq(s.contacts.id, s.leads.contactId))
    .leftJoin(owner, eq(owner.id, s.leads.ownerId))
    .leftJoin(s.leadSources, eq(s.leadSources.id, s.leads.sourceId))
    .leftJoin(s.campaigns, eq(s.campaigns.id, s.leads.campaignId));
}

const scope = (auth: AuthContext) => ownerScope(auth, 'leads', { tenantId: s.leads.tenantId, ownerId: s.leads.ownerId, deletedAt: s.leads.deletedAt });

async function loadLead(db: DbOrTx, auth: AuthContext, id: string) {
  const [row] = await baseQuery(db).where(and(eq(s.leads.id, id), scope(auth))).limit(1);
  if (!row) throw notFound('Lead não encontrado.');
  return row;
}

const SORT_COLUMNS = {
  created_at: s.leads.createdAt,
  name: s.contacts.name,
  next_action_at: s.leads.nextActionAt,
  last_contact_at: sql`coalesce(${s.leads.lastContactAt}, ${s.leads.createdAt})`,
  status: s.leads.status,
} as const;

export const leadRoutes = [
  defineRoute({
    method: 'GET',
    url: '/leads/summary',
    summary: 'Indicadores e contagem por status (abas) da carteira de leads',
    tag: 'Leads',
    module: 'leads',
    handler: async ({ app, auth }) => {
      const [r] = (
        await app.db.execute<{ total: number; total_prev: number; novo: number; em_contato: number; qualificado: number; descartado: number; convertido: number }>(sql`
          select count(*)::int total,
            count(*) filter (where ${s.leads.createdAt} < (now() - interval '1 month'))::int total_prev,
            count(*) filter (where ${s.leads.status} = 'novo')::int novo,
            count(*) filter (where ${s.leads.status} = 'em_contato')::int em_contato,
            count(*) filter (where ${s.leads.status} = 'qualificado')::int qualificado,
            count(*) filter (where ${s.leads.status} = 'descartado')::int descartado,
            count(*) filter (where ${s.leads.status} = 'convertido')::int convertido
          from ${s.leads} where ${scope(auth)}`)
      ).rows;
      return {
        counts: { todos: r!.total, novo: r!.novo, em_contato: r!.em_contato, qualificado: r!.qualificado, descartado: r!.descartado, convertido: r!.convertido },
        kpis: [
          { key: 'total', label: 'Total de leads', value: r!.total, delta: pctDelta(r!.total, r!.total_prev), formula: 'Leads da sua carteira agora × total existente há um mês' },
          { key: 'em_contato', label: 'Em contato', value: r!.em_contato, delta: null, formula: 'Leads com status Em contato. Ainda não há histórico de status para comparar.' },
          { key: 'qualificado', label: 'Qualificados', value: r!.qualificado, delta: null, formula: 'Leads com status Qualificado. Ainda não há histórico de status para comparar.' },
          { key: 'descartado', label: 'Descartados', value: r!.descartado, delta: null, formula: 'Leads com status Descartado. Ainda não há histórico de status para comparar.' },
        ],
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/leads',
    summary: 'Lista leads com busca, filtros, ordenação e paginação',
    tag: 'Leads',
    module: 'leads',
    query: LeadListQuery,
    handler: async ({ app, auth, query }) => {
      const where: SQL[] = [scope(auth)];
      if (query.q) {
        const term = `%${query.q.replace(/[%_\\]/g, '\\$&')}%`;
        where.push(or(ilike(s.contacts.name, term), ilike(s.contacts.phone, term), ilike(s.contacts.email, term))!);
      }
      if (query.status) where.push(eq(s.leads.status, query.status));
      if (query.sourceId) where.push(eq(s.leads.sourceId, query.sourceId));
      if (query.channel) where.push(eq(s.leads.channel, query.channel));
      if (query.ownerId === 'me') where.push(eq(s.leads.ownerId, auth.userId));
      else if (query.ownerId === 'none') where.push(isNull(s.leads.ownerId));
      else if (query.ownerId) where.push(eq(s.leads.ownerId, query.ownerId));
      const cond = and(...where);
      const col = SORT_COLUMNS[query.sort];
      const order = query.dir === 'asc' ? sql`${col} asc nulls last` : sql`${col} desc nulls last`;
      const [rows, [{ total } = { total: 0 }]] = await Promise.all([
        baseQuery(app.db).where(cond).orderBy(order, desc(s.leads.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        app.db.select({ total: sql<number>`count(*)::int` }).from(s.leads).innerJoin(s.contacts, eq(s.contacts.id, s.leads.contactId)).where(cond),
      ]);
      const now = new Date();
      return { items: rows.map((r) => toDto(r, now)), page: query.page, pageSize: query.pageSize, total };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/leads/:id',
    summary: 'Detalhe do lead',
    tag: 'Leads',
    module: 'leads',
    params: IdParams,
    handler: async ({ app, auth, params }) => toDto(await loadLead(app.db, auth, params.id)),
  }),

  defineRoute({
    method: 'POST',
    url: '/leads',
    summary: 'Cria lead (e o contato associado na carteira do responsável)',
    tag: 'Leads',
    module: 'leads',
    body: LeadCreate,
    handler: async ({ app, auth, body, reply, req }) => {
      const ownerId = body.ownerId ?? auth.userId;
      const id = await app.db.transaction(async (tx) => {
        await assertAssignableUser(tx, auth, 'leads', ownerId);
        await assertTenantRefs(tx, auth, { sourceId: body.sourceId, campaignId: body.campaignId });
        const [contact] = await tx
          .insert(s.contacts)
          .values({ tenantId: auth.tenantId, name: body.name, phone: body.phone, email: body.email, segment: body.segment, city: body.city, ownerId, createdBy: auth.userId })
          .returning({ id: s.contacts.id });
        const [lead] = await tx
          .insert(s.leads)
          .values({
            tenantId: auth.tenantId,
            contactId: contact!.id,
            ownerId,
            sourceId: body.sourceId ?? null,
            campaignId: body.campaignId ?? null,
            channel: body.channel,
            interests: body.interests,
            nextAction: body.nextAction,
            nextActionAt: body.nextActionAt ? new Date(body.nextActionAt) : null,
            lastInteractionNote: body.lastInteractionNote ?? 'Cadastro manual',
            notes: body.notes,
            createdBy: auth.userId,
          })
          .returning({ id: s.leads.id });
        await audit(tx, req, { action: 'lead.create', entityType: 'lead', entityId: lead!.id });
        return lead!.id;
      });
      reply.code(201);
      const dto = toDto(await loadLead(app.db, auth, id));
      if (dto.ownerId) await notifyLeadAssigned(app.db, app.config, auth, dto.ownerId, [{ id: dto.id, name: dto.name, phone: dto.phone }]);
      return dto;
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/leads/:id',
    summary: 'Atualiza lead (concorrência otimista por rowVersion)',
    tag: 'Leads',
    module: 'leads',
    params: IdParams,
    body: LeadUpdate,
    handler: async ({ app, auth, params, body, req }) => {
      if (body.status === 'convertido') throw unprocessable('Use "Converter em oportunidade" para converter o lead.');
      let beforeOwner: string | null = null;
      await app.db.transaction(async (tx) => {
        const current = await loadLead(tx, auth, params.id);
        beforeOwner = current.ownerId;
        if (current.rowVersion !== body.rowVersion) throw conflict(current.rowVersion);
        if (body.ownerId !== undefined && body.ownerId !== current.ownerId) {
          if (!body.ownerId) throw unprocessable('Responsável obrigatório.');
          await assertAssignableUser(tx, auth, 'leads', body.ownerId);
          await audit(tx, req, { action: 'lead.assign', entityType: 'lead', entityId: params.id, metadata: { from: current.ownerId, to: body.ownerId } });
        }
        await assertTenantRefs(tx, auth, { sourceId: body.sourceId, campaignId: body.campaignId });
        const contactPatch: Partial<typeof s.contacts.$inferInsert> = {};
        if (body.name !== undefined) contactPatch.name = body.name;
        if (body.phone !== undefined) contactPatch.phone = body.phone;
        if (body.email !== undefined) contactPatch.email = body.email;
        if (body.segment !== undefined) contactPatch.segment = body.segment;
        if (body.city !== undefined) contactPatch.city = body.city;
        if (body.ownerId) contactPatch.ownerId = body.ownerId;
        if (Object.keys(contactPatch).length) {
          await tx
            .update(s.contacts)
            .set({ ...contactPatch, updatedAt: new Date(), rowVersion: sql`${s.contacts.rowVersion} + 1` })
            .where(and(eq(s.contacts.id, current.contactId), eq(s.contacts.tenantId, auth.tenantId)));
        }
        const lastContact = body.lastContactAt ? new Date(body.lastContactAt) : undefined;
        const updated = await tx
          .update(s.leads)
          .set({
            status: body.status,
            ownerId: body.ownerId ?? undefined,
            sourceId: body.sourceId,
            campaignId: body.campaignId,
            channel: body.channel,
            interests: body.interests,
            nextAction: body.nextAction,
            nextActionAt: body.nextActionAt === undefined ? undefined : body.nextActionAt ? new Date(body.nextActionAt) : null,
            notes: body.notes,
            lastContactAt: body.lastContactAt === undefined ? undefined : lastContact ?? null,
            firstContactAt: lastContact && !current.firstContactAt ? lastContact : undefined,
            lastInteractionNote: body.lastInteractionNote ?? (lastContact ? 'Contato registrado' : undefined),
            updatedAt: new Date(),
            rowVersion: sql`${s.leads.rowVersion} + 1`,
          })
          .where(and(eq(s.leads.id, params.id), eq(s.leads.tenantId, auth.tenantId), eq(s.leads.rowVersion, body.rowVersion)))
          .returning({ id: s.leads.id });
        if (!updated.length) throw conflict(current.rowVersion);
      });
      const dto = toDto(await loadLead(app.db, auth, params.id));
      if (body.ownerId && body.ownerId !== beforeOwner) await notifyLeadAssigned(app.db, app.config, auth, body.ownerId, [{ id: dto.id, name: dto.name, phone: dto.phone }]);
      return dto;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/leads/bulk-assign',
    summary: 'Atribui vários leads a um responsável (auditado; exige nível Equipe)',
    tag: 'Leads',
    module: 'leads',
    min: 'equipe',
    body: BulkAssign,
    handler: async ({ app, auth, body, req }) => {
      const out = await app.db.transaction(async (tx) => {
        await assertAssignableUser(tx, auth, 'leads', body.ownerId);
        const rows = await tx
          .update(s.leads)
          .set({ ownerId: body.ownerId, updatedAt: new Date(), rowVersion: sql`${s.leads.rowVersion} + 1` })
          .where(and(scope(auth), inArray(s.leads.id, body.ids)))
          .returning({ id: s.leads.id, contactId: s.leads.contactId });
        if (rows.length) await tx.update(s.contacts).set({ ownerId: body.ownerId }).where(and(eq(s.contacts.tenantId, auth.tenantId), inArray(s.contacts.id, rows.map((r) => r.contactId))));
        await audit(tx, req, { action: 'lead.bulk_assign', entityType: 'lead', metadata: { ownerId: body.ownerId, count: rows.length, ids: rows.map((r) => r.id) } });
        return { updated: rows.length, ids: rows.map((r) => r.id) };
      });
      if (out.ids.length) {
        const names = await app.db.select({ id: s.leads.id, name: s.contacts.name, phone: s.contacts.phone }).from(s.leads).innerJoin(s.contacts, eq(s.contacts.id, s.leads.contactId)).where(inArray(s.leads.id, out.ids));
        await notifyLeadAssigned(app.db, app.config, auth, body.ownerId, names);
      }
      return { updated: out.updated };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/leads/:id/convert',
    summary: 'Converte lead em oportunidade (mantém vínculo e histórico)',
    tag: 'Leads',
    module: 'leads',
    params: IdParams,
    body: z.object({ rowVersion: z.number().int().min(1) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const result = await app.db.transaction(async (tx) => {
        const lead = await loadLead(tx, auth, params.id);
        if (lead.rowVersion !== body.rowVersion) throw conflict(lead.rowVersion);
        if (lead.status === 'convertido' && lead.convertedOpportunityId) return { opportunityId: lead.convertedOpportunityId, created: false };
        if (lead.status === 'descartado') throw unprocessable('Lead descartado não pode ser convertido. Reative-o antes.');
        const opp = await createOpportunity(tx, auth, req, {
          contactId: lead.contactId,
          leadId: lead.id,
          ownerId: lead.ownerId ?? auth.userId,
          sourceId: lead.sourceId,
          campaignId: lead.campaignId,
          reasons: [],
          title: null,
          channel: lead.channel,
        });
        await tx
          .update(s.leads)
          .set({ status: 'convertido', convertedOpportunityId: opp.id, updatedAt: new Date(), rowVersion: sql`${s.leads.rowVersion} + 1` })
          .where(and(eq(s.leads.id, params.id), eq(s.leads.tenantId, auth.tenantId)));
        return { opportunityId: opp.id, created: true };
      });
      reply.code(result.created ? 201 : 200);
      return result;
    },
  }),
];
