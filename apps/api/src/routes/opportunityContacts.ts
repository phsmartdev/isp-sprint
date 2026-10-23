/**
 * Contatos da oportunidade (CRM, sem depender do ABM): várias pessoas, cada uma com o papel nesta negociação.
 * Reaproveita o cadastro único de pessoas (people), o vínculo pessoa↔conta (account_stakeholders) e o vínculo
 * pessoa↔registro (stakeholder_links). Uma pessoa existente é reaproveitada pelo id ou pelo mesmo e-mail: nada duplica.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ENTITY_LINK_ROLES, ENTITY_LINK_ROLE_LABELS } from '@isp/domain';
import { defineRoute } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { loadOpportunity } from '../services/opportunities';

const ROLES = ENTITY_LINK_ROLES.oportunidade;
const OppParams = z.object({ id: z.string().uuid() });
const LinkParams = z.object({ id: z.string().uuid(), linkId: z.string().uuid() });
const PersonBody = z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().toLowerCase().email().max(200).nullable().default(null), phone: z.string().trim().max(40).nullable().default(null) });

export const opportunityContactRoutes = [
  defineRoute({
    method: 'GET', url: '/opportunities/:id/contacts', summary: 'Contatos da oportunidade (pessoas da conta com o papel nesta negociação) e pessoas da conta ainda não ligadas', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db
        .select({ stakeholderId: s.accountStakeholders.id, personId: s.people.id, name: s.people.name, email: s.people.email, phone: s.people.phone, title: s.accountStakeholders.title, active: s.accountStakeholders.active })
        .from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId))
        .where(and(eq(s.accountStakeholders.contactId, opp.contactId), eq(s.accountStakeholders.tenantId, auth.tenantId)))
        .orderBy(asc(s.people.name));
      const links = await app.db.select().from(s.stakeholderLinks)
        .where(and(eq(s.stakeholderLinks.entityType, 'oportunidade'), eq(s.stakeholderLinks.entityId, opp.id), isNull(s.stakeholderLinks.removedAt)))
        .orderBy(asc(s.stakeholderLinks.createdAt));
      const linked = new Set(links.map((l) => l.stakeholderId));
      return {
        roles: ROLES.map((r) => ({ key: r, label: ENTITY_LINK_ROLE_LABELS[r] })),
        items: links.map((l) => {
          const p = rows.find((r) => r.stakeholderId === l.stakeholderId);
          return { id: l.id, stakeholderId: l.stakeholderId, role: l.role, roleLabel: ENTITY_LINK_ROLE_LABELS[l.role as (typeof ROLES)[number]] ?? l.role, name: p?.name ?? '—', email: p?.email ?? null, phone: p?.phone ?? null, title: p?.title ?? null, rowVersion: l.rowVersion };
        }),
        available: rows.filter((r) => r.active && !linked.has(r.stakeholderId)).map((r) => ({ stakeholderId: r.stakeholderId, name: r.name, title: r.title, email: r.email })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/contacts', summary: 'Adiciona um contato à oportunidade: pessoa da conta, pessoa já cadastrada ou nova (sem duplicar pelo e-mail)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    body: z.object({ stakeholderId: z.string().uuid().optional(), personId: z.string().uuid().optional(), person: PersonBody.optional(), title: z.string().trim().max(160).nullable().optional(), role: z.enum(ROLES).optional() }),
    handler: async ({ app, auth, params, body, reply }) => app.db.transaction(async (tx) => {
      const opp = await loadOpportunity(tx, auth, params.id);
      let stakeholderId = body.stakeholderId ?? null;
      if (stakeholderId) {
        const [st] = await tx.select({ id: s.accountStakeholders.id, contactId: s.accountStakeholders.contactId }).from(s.accountStakeholders).where(and(eq(s.accountStakeholders.id, stakeholderId), eq(s.accountStakeholders.tenantId, auth.tenantId))).limit(1);
        if (!st || st.contactId !== opp.contactId) throw unprocessable('A pessoa precisa ser desta conta.');
      } else {
        if (!body.personId && !body.person) throw unprocessable('Escolha uma pessoa ou informe o nome do contato.');
        let personId = body.personId ?? null;
        if (personId) { const [p] = await tx.select({ id: s.people.id }).from(s.people).where(and(eq(s.people.id, personId), eq(s.people.tenantId, auth.tenantId))).limit(1); if (!p) throw notFound('Pessoa não encontrada.'); }
        else if (body.person!.email) { const [p] = await tx.select({ id: s.people.id }).from(s.people).where(and(eq(s.people.tenantId, auth.tenantId), sql`lower(${s.people.email}) = ${body.person!.email}`)).limit(1); personId = p?.id ?? null; }
        if (!personId) { const [p] = await tx.insert(s.people).values({ tenantId: auth.tenantId, ...body.person!, createdBy: auth.userId }).returning({ id: s.people.id }); personId = p!.id; }
        const [cur] = await tx.select({ id: s.accountStakeholders.id }).from(s.accountStakeholders).where(and(eq(s.accountStakeholders.contactId, opp.contactId), eq(s.accountStakeholders.personId, personId))).limit(1);
        if (cur) stakeholderId = cur.id;
        else {
          const [st] = await tx.insert(s.accountStakeholders).values({ tenantId: auth.tenantId, contactId: opp.contactId, personId, title: body.title ?? null, relationshipOwnerId: auth.userId, createdBy: auth.userId }).returning({ id: s.accountStakeholders.id });
          stakeholderId = st!.id;
          await tx.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId, type: 'incluido', payload: { personId, title: body.title ?? null, via: 'oportunidade' }, actorId: auth.userId });
        }
      }
      if (body.title !== undefined && body.stakeholderId) await tx.update(s.accountStakeholders).set({ title: body.title }).where(eq(s.accountStakeholders.id, stakeholderId!));
      // o primeiro contato da negociação é o principal; os seguintes entram como usuários, e o papel muda depois
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.stakeholderLinks).where(and(eq(s.stakeholderLinks.entityType, 'oportunidade'), eq(s.stakeholderLinks.entityId, opp.id), isNull(s.stakeholderLinks.removedAt)));
      const role = body.role ?? (n === 0 ? 'contato_principal' : 'usuario');
      const [l] = await tx.insert(s.stakeholderLinks).values({ tenantId: auth.tenantId, stakeholderId: stakeholderId!, contactId: opp.contactId, entityType: 'oportunidade', entityId: opp.id, role, createdBy: auth.userId }).onConflictDoNothing().returning({ id: s.stakeholderLinks.id });
      if (!l) throw unprocessable('Esta pessoa já é contato desta oportunidade.');
      await tx.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId: stakeholderId!, type: 'vinculo_incluido', payload: { entity: 'oportunidade', entityId: opp.id, label: `OP-${opp.code}`, role }, actorId: auth.userId });
      reply.code(201);
      return { id: l.id };
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/opportunities/:id/contacts/:linkId', summary: 'Muda o papel do contato nesta oportunidade', tag: 'Oportunidades', module: 'oportunidades', params: LinkParams,
    body: z.object({ rowVersion: z.number().int(), role: z.enum(ROLES) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const opp = await loadOpportunity(tx, auth, params.id);
      const [l] = await tx.select().from(s.stakeholderLinks).where(and(eq(s.stakeholderLinks.id, params.linkId), eq(s.stakeholderLinks.entityId, opp.id), eq(s.stakeholderLinks.entityType, 'oportunidade'), isNull(s.stakeholderLinks.removedAt))).limit(1).for('update');
      if (!l) throw notFound('Contato não encontrado nesta oportunidade.');
      if (l.rowVersion !== body.rowVersion) throw unprocessable('O contato foi alterado por outra pessoa. Recarregue.');
      await tx.update(s.stakeholderLinks).set({ role: body.role, rowVersion: l.rowVersion + 1 }).where(eq(s.stakeholderLinks.id, l.id));
      await tx.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId: l.stakeholderId, type: 'vinculo_alterado', payload: { entity: 'oportunidade', label: `OP-${opp.code}`, from: l.role, to: body.role }, actorId: auth.userId });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/contacts/:linkId/remove', summary: 'Tira o contato desta oportunidade (a pessoa continua na conta; fica no histórico dela)', tag: 'Oportunidades', module: 'oportunidades', params: LinkParams,
    handler: async ({ app, auth, params }) => app.db.transaction(async (tx) => {
      const opp = await loadOpportunity(tx, auth, params.id);
      const [l] = await tx.select().from(s.stakeholderLinks).where(and(eq(s.stakeholderLinks.id, params.linkId), eq(s.stakeholderLinks.entityId, opp.id), eq(s.stakeholderLinks.entityType, 'oportunidade'), isNull(s.stakeholderLinks.removedAt))).limit(1).for('update');
      if (!l) throw notFound('Contato não encontrado nesta oportunidade.');
      await tx.update(s.stakeholderLinks).set({ removedAt: new Date(), removedBy: auth.userId, removeReason: 'Retirado dos contatos da oportunidade', rowVersion: l.rowVersion + 1 }).where(eq(s.stakeholderLinks.id, l.id));
      await tx.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId: l.stakeholderId, type: 'vinculo_removido', payload: { entity: 'oportunidade', label: `OP-${opp.code}`, role: l.role, reason: 'Retirado dos contatos da oportunidade' }, actorId: auth.userId });
      return { ok: true };
    }),
  }),
];
