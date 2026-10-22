/**
 * ABM Fase 8 — integrações dentro do CRM: pessoas da conta ligadas a oportunidades, contratos e leads (com o papel em
 * cada um), contexto ABM nesses registros e identificadores externos preservados. Nada é duplicado: só vínculos.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { ENTITY_LINK_ROLES, LINK_ENTITIES, entityLinkError, externalIdsOf, type LinkEntity } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { factsOf, emptyFacts } from './abm';
import { abmPolicy, assertAccount, canViewInfluence, stakeholderRows } from './stakeholders';

const ALL_ROLES = [...new Set(Object.values(ENTITY_LINK_ROLES).flat())] as [string, ...string[]];

/** Conta (contato), rótulo e endereço do registro; 404 se não existir no tenant ou estiver fora da carteira. */
export async function entityInfo(db: DbOrTx, auth: AuthContext, type: LinkEntity, id: string) {
  let row: { contactId: string; label: string; path: string; open: boolean } | undefined;
  if (type === 'oportunidade') {
    const [o] = await db.select({ contactId: s.opportunities.contactId, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage }).from(s.opportunities).where(and(eq(s.opportunities.id, id), eq(s.opportunities.tenantId, auth.tenantId), isNull(s.opportunities.deletedAt))).limit(1);
    if (o) row = { contactId: o.contactId, label: `OP-${o.code} · ${o.title}`, path: `/opportunities/${id}`, open: !['ganha', 'perdida'].includes(o.stage) };
  } else if (type === 'contrato') {
    const [c] = await db.select({ contactId: s.contracts.contactId, code: s.contracts.code, number: s.contractVersions.number }).from(s.contracts).leftJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(and(eq(s.contracts.id, id), eq(s.contracts.tenantId, auth.tenantId))).limit(1);
    if (c) row = { contactId: c.contactId, label: `CT-${c.code}${c.number ? ` · ${c.number}` : ''}`, path: `/contracts/${id}`, open: true };
  } else {
    const [l] = await db.select({ contactId: s.leads.contactId, createdAt: s.leads.createdAt, status: s.leads.status }).from(s.leads).where(and(eq(s.leads.id, id), eq(s.leads.tenantId, auth.tenantId), isNull(s.leads.deletedAt))).limit(1);
    if (l) row = { contactId: l.contactId, label: `Lead de ${l.createdAt.toISOString().slice(0, 10).split('-').reverse().join('/')}`, path: `/leads?id=${id}`, open: true };
  }
  if (!row) throw notFound('Registro não encontrado.');
  const acc = await assertAccount(db, auth, row.contactId);
  return { ...row, account: acc.name };
}

/** Vínculos ativos de uma pessoa, com o rótulo de cada registro (para a ficha do stakeholder). */
export async function linksOfStakeholder(db: DbOrTx, auth: AuthContext, stakeholderId: string) {
  const ls = await db.select().from(s.stakeholderLinks).where(and(eq(s.stakeholderLinks.stakeholderId, stakeholderId), isNull(s.stakeholderLinks.removedAt))).orderBy(desc(s.stakeholderLinks.createdAt));
  const out = [];
  for (const l of ls) { try { const e = await entityInfo(db, auth, l.entityType as LinkEntity, l.entityId); out.push({ id: l.id, entityType: l.entityType, entityId: l.entityId, role: l.role, label: e.label, path: e.path }); } catch { /* registro apagado ou fora da carteira */ } }
  return out;
}

export const abmLinkRoutes = [
  defineRoute({
    method: 'GET', url: '/abm/entity-links', summary: 'Pessoas e contexto ABM de uma oportunidade, contrato ou lead (vínculos, influência, plays e status da conta)', tag: 'Marketing', module: 'clientes',
    query: z.object({ entity: z.enum(LINK_ENTITIES), id: z.string().uuid() }),
    handler: async ({ app, auth, query: q }) => {
      const e = await entityInfo(app.db, auth, q.entity, q.id);
      const pol = await abmPolicy(app.db, auth.tenantId);
      const people = await stakeholderRows(app.db, auth, [e.contactId], pol.influence);
      const links = await app.db.select({ l: s.stakeholderLinks, by: s.users.name }).from(s.stakeholderLinks).leftJoin(s.users, eq(s.users.id, s.stakeholderLinks.createdBy))
        .where(and(eq(s.stakeholderLinks.entityType, q.entity), eq(s.stakeholderLinks.entityId, q.id), isNull(s.stakeholderLinks.removedAt))).orderBy(s.stakeholderLinks.createdAt);
      const [abm] = await app.db.select({ id: s.abmAccounts.id, status: s.abmAccounts.status, priority: s.abmAccounts.priority, tier: s.abmAccounts.tier, owner: s.users.name }).from(s.abmAccounts).innerJoin(s.users, eq(s.users.id, s.abmAccounts.ownerId)).where(and(eq(s.abmAccounts.contactId, e.contactId), eq(s.abmAccounts.tenantId, auth.tenantId))).limit(1);
      const facts = (await factsOf(app.db, auth, [e.contactId])).get(e.contactId) ?? emptyFacts();
      const runs = q.entity === 'oportunidade' ? await app.db.select({ id: s.abmPlayRuns.id, status: s.abmPlayRuns.status, play: s.abmPlays.name, startOn: s.abmPlayRuns.startOn, abmId: s.abmPlayRuns.abmId }).from(s.abmPlayRuns).innerJoin(s.abmPlays, eq(s.abmPlays.id, s.abmPlayRuns.playId)).where(eq(s.abmPlayRuns.opportunityId, q.id)).orderBy(desc(s.abmPlayRuns.createdAt)) : [];
      return {
        entity: { type: q.entity, id: q.id, label: e.label, contactId: e.contactId, account: e.account, open: e.open },
        abm: abm ? { ...abm, commercial: facts.commercial } : null,
        policy: { labels: pol.influence.labels, view: canViewInfluence(auth, pol.influence) },
        roles: ENTITY_LINK_ROLES[q.entity],
        people: people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, title: p.title, roles: p.roles })),
        links: links.map(({ l, by }) => {
          const p = people.find((x) => x.id === l.stakeholderId);
          const here = q.entity === 'oportunidade' ? p?.influenceContexts.find((c) => c.contextType === 'oportunidade' && c.contextKey === q.id)?.level ?? null : null;
          return { id: l.id, stakeholderId: l.stakeholderId, role: l.role, notes: l.notes, rowVersion: l.rowVersion, createdAt: l.createdAt, createdByName: by, name: p?.name ?? '—', title: p?.title ?? null, stance: p?.stance ?? 'desconhecido', influence: p?.influence ?? null, influenceHere: here, active: p?.active ?? false };
        }),
        plays: runs,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/abm/entity-links', summary: 'Liga uma pessoa da conta a uma oportunidade, contrato ou lead, com o papel nela', tag: 'Marketing', module: 'clientes',
    body: z.object({ entity: z.enum(LINK_ENTITIES), entityId: z.string().uuid(), stakeholderId: z.string().uuid(), role: z.enum(ALL_ROLES), notes: z.string().trim().max(1000).nullable().default(null) }),
    handler: async ({ app, auth, body, reply }) => app.db.transaction(async (tx) => {
      const e = await entityInfo(tx, auth, body.entity, body.entityId);
      const [st] = await tx.select().from(s.accountStakeholders).where(and(eq(s.accountStakeholders.id, body.stakeholderId), eq(s.accountStakeholders.tenantId, auth.tenantId))).limit(1);
      if (!st) throw notFound('Pessoa não encontrada.');
      const err = entityLinkError({ entity: body.entity, role: body.role, stakeholderContactId: st.contactId, entityContactId: e.contactId, stakeholderActive: st.active });
      if (err) throw unprocessable(err);
      const [l] = await tx.insert(s.stakeholderLinks).values({ tenantId: auth.tenantId, stakeholderId: st.id, contactId: e.contactId, entityType: body.entity, entityId: body.entityId, role: body.role, notes: body.notes, createdBy: auth.userId }).onConflictDoNothing().returning({ id: s.stakeholderLinks.id });
      if (!l) throw unprocessable('Esta pessoa já está ligada a este registro.');
      await tx.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId: st.id, type: 'vinculo_incluido', payload: { entity: body.entity, entityId: body.entityId, label: e.label, role: body.role }, actorId: auth.userId });
      reply.code(201);
      return { id: l.id };
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/abm/entity-links/:id', summary: 'Muda o papel ou a observação do vínculo', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), role: z.enum(ALL_ROLES).optional(), notes: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [l] = await tx.select().from(s.stakeholderLinks).where(and(eq(s.stakeholderLinks.id, params.id), eq(s.stakeholderLinks.tenantId, auth.tenantId), isNull(s.stakeholderLinks.removedAt))).limit(1).for('update');
      if (!l) throw notFound('Vínculo não encontrado.');
      const e = await entityInfo(tx, auth, l.entityType as LinkEntity, l.entityId);
      if (l.rowVersion !== body.rowVersion) throw unprocessable('O vínculo foi alterado por outra pessoa. Recarregue.');
      if (body.role && !(ENTITY_LINK_ROLES[l.entityType as LinkEntity] as readonly string[]).includes(body.role)) throw unprocessable('Papel inválido para este registro.');
      await tx.update(s.stakeholderLinks).set({ role: body.role ?? l.role, notes: body.notes === undefined ? l.notes : body.notes, rowVersion: l.rowVersion + 1 }).where(eq(s.stakeholderLinks.id, l.id));
      await tx.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId: l.stakeholderId, type: 'vinculo_alterado', payload: { entity: l.entityType, label: e.label, from: l.role, to: body.role ?? l.role }, actorId: auth.userId });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/abm/entity-links/:id/remove', summary: 'Desfaz o vínculo (motivo obrigatório; fica no histórico da pessoa)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ reason: z.string().trim().min(5).max(500) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [l] = await tx.select().from(s.stakeholderLinks).where(and(eq(s.stakeholderLinks.id, params.id), eq(s.stakeholderLinks.tenantId, auth.tenantId), isNull(s.stakeholderLinks.removedAt))).limit(1).for('update');
      if (!l) throw notFound('Vínculo não encontrado.');
      const e = await entityInfo(tx, auth, l.entityType as LinkEntity, l.entityId);
      await tx.update(s.stakeholderLinks).set({ removedAt: new Date(), removedBy: auth.userId, removeReason: body.reason, rowVersion: l.rowVersion + 1 }).where(eq(s.stakeholderLinks.id, l.id));
      await tx.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId: l.stakeholderId, type: 'vinculo_removido', payload: { entity: l.entityType, label: e.label, role: l.role, reason: body.reason }, actorId: auth.userId });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'GET', url: '/accounts/:id/external-ids', summary: 'Identificadores externos da conta (ERP/IXC, importação) — somente leitura; o ABM não os altera', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      const [c] = await app.db.select({ sourceSystem: s.contacts.sourceSystem, externalId: s.contacts.externalId }).from(s.contacts).where(eq(s.contacts.id, params.id)).limit(1);
      const cust = await app.db.select({ system: s.customerExternalIds.system, externalId: s.customerExternalIds.externalId }).from(s.customerExternalIds).innerJoin(s.customers, eq(s.customers.id, s.customerExternalIds.customerId)).where(eq(s.customers.contactId, params.id));
      const [cu] = await app.db.select({ sourceSystem: s.customers.sourceSystem, externalId: s.customers.externalId }).from(s.customers).where(eq(s.customers.contactId, params.id)).limit(1);
      const extra = cu && cu.sourceSystem !== 'crm' && cu.externalId ? [{ system: cu.sourceSystem, externalId: cu.externalId }] : [];
      return { origin: c!.sourceSystem, items: externalIdsOf(c!, [...extra, ...cust]) };
    },
  }),
];
