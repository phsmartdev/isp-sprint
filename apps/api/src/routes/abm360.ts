/**
 * ABM Fase 3 — Conta 360: tudo da conta em um lugar, a partir dos registros existentes (sem cópias):
 * cabeçalho estratégico, objetivos, dados da organização, estrutura, leads/oportunidades, contratos, trabalho e histórico unificado.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ABM_OBJECTIVE_KINDS, ABM_OBJECTIVE_STATUSES, ORG_UNIT_KINDS, objectiveTransition, onlyDigits, orgUnitCycle, orgUnitTree, type AbmObjectiveStatus } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { assertAssignableUser, ownerScope } from '../services/scope';
import { audit } from '../services/audit';
import { emptyFacts, factsOf } from './abm';

const vis = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.abmAccounts.tenantId, ownerId: s.abmAccounts.ownerId });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const event = (db: DbOrTx, auth: AuthContext, abmId: string, type: string, payload: Record<string, unknown>) => db.insert(s.abmEvents).values({ tenantId: auth.tenantId, abmId, type, payload, actorId: auth.userId });

async function loadAbm(db: DbOrTx, auth: AuthContext, id: string) {
  const [a] = await db.select().from(s.abmAccounts).where(and(eq(s.abmAccounts.id, id), vis(auth))).limit(1);
  if (!a) throw notFound('Conta não encontrada no ABM.');
  return a;
}

export const abm360Routes = [
  defineRoute({
    method: 'GET', url: '/abm/:id/360', summary: 'Conta 360 ABM: classificação estratégica, responsáveis, objetivos, estrutura, leads, oportunidades, contratos e histórico unificado', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const a = await loadAbm(app.db, auth, params.id);
      const cid = a.contactId;
      const [c] = await app.db.select({ id: s.contacts.id, name: s.contacts.name, document: s.contacts.document, segment: s.contacts.segment, nature: s.contacts.nature, city: s.contacts.city, phone: s.contacts.phone, email: s.contacts.email, ownerId: s.contacts.ownerId, rowVersion: s.contacts.rowVersion, externalId: s.contacts.externalId, sourceSystem: s.contacts.sourceSystem }).from(s.contacts).where(eq(s.contacts.id, cid)).limit(1);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const uname = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
      const [cls] = await app.db.select({ classKey: s.contactClassifications.classKey, at: s.contactClassifications.createdAt }).from(s.contactClassifications).where(eq(s.contactClassifications.contactId, cid)).orderBy(desc(s.contactClassifications.createdAt)).limit(1);
      const [objectives, units, leads, opps, contracts, nextAct, lastAct, events, acts] = await Promise.all([
        app.db.select().from(s.abmObjectives).where(eq(s.abmObjectives.abmId, a.id)).orderBy(s.abmObjectives.status, s.abmObjectives.dueOn),
        app.db.select().from(s.accountOrgUnits).where(and(eq(s.accountOrgUnits.contactId, cid), eq(s.accountOrgUnits.tenantId, auth.tenantId))),
        app.db.select({ id: s.leads.id, status: s.leads.status, createdAt: s.leads.createdAt, ownerId: s.leads.ownerId }).from(s.leads).where(eq(s.leads.contactId, cid)).orderBy(desc(s.leads.createdAt)).limit(30),
        app.db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, valueCents: s.opportunities.valueCents, ownerId: s.opportunities.ownerId, createdAt: s.opportunities.createdAt }).from(s.opportunities).where(and(eq(s.opportunities.contactId, cid), sql`${s.opportunities.deletedAt} is null`)).orderBy(desc(s.opportunities.createdAt)).limit(50),
        app.db.select({ id: s.contracts.id, code: s.contracts.code, stage: s.contracts.stage, kind: s.contracts.kind, number: s.contractVersions.number, monthlyCents: s.contractVersions.monthlyCents, endAt: s.contractVersions.endAt }).from(s.contracts).leftJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(eq(s.contracts.contactId, cid)).orderBy(desc(s.contracts.createdAt)).limit(50),
        app.db.select({ id: s.activities.id, title: s.activities.title, due: sql<string | null>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')`, ownerId: s.activities.ownerId }).from(s.activities).where(and(eq(s.activities.contactId, cid), sql`${s.activities.deletedAt} is null`, sql`${s.activities.status} not in ('concluida', 'cancelada')`)).orderBy(sql`${s.activities.dueAt} asc nulls last`).limit(1),
        app.db.select({ title: s.activities.title, type: s.activities.type, at: s.activities.completedAt }).from(s.activities).where(and(eq(s.activities.contactId, cid), sql`${s.activities.deletedAt} is null`, eq(s.activities.status, 'concluida'))).orderBy(desc(s.activities.completedAt)).limit(1),
        app.db.select({ id: s.abmEvents.id, type: s.abmEvents.type, payload: s.abmEvents.payload, at: s.abmEvents.createdAt, actorId: s.abmEvents.actorId }).from(s.abmEvents).where(eq(s.abmEvents.abmId, a.id)).orderBy(desc(s.abmEvents.createdAt)).limit(100),
        app.db.select({ id: s.activities.id, title: s.activities.title, type: s.activities.type, at: s.activities.completedAt, ownerId: s.activities.ownerId }).from(s.activities).where(and(eq(s.activities.contactId, cid), sql`${s.activities.deletedAt} is null`, eq(s.activities.status, 'concluida'))).orderBy(desc(s.activities.completedAt)).limit(100),
      ]);
      const oppIds = opps.map((o) => o.id);
      const oppEvents = oppIds.length ? await app.db.select({ id: s.opportunityEvents.id, oppId: s.opportunityEvents.opportunityId, type: s.opportunityEvents.type, at: s.opportunityEvents.occurredAt, actorId: s.opportunityEvents.actorId, to: s.opportunityEvents.toValue }).from(s.opportunityEvents).where(and(inArray(s.opportunityEvents.opportunityId, oppIds), inArray(s.opportunityEvents.type, ['created', 'stage_changed']))).orderBy(desc(s.opportunityEvents.occurredAt)).limit(100) : [];
      // histórico unificado: cada fato aparece uma vez, com a origem
      const history = [
        ...events.map((e) => ({ id: `abm:${e.id}`, at: e.at, source: 'abm' as const, type: e.type, text: null as string | null, payload: e.payload, actor: uname(e.actorId) })),
        ...acts.filter((x) => x.at).map((x) => ({ id: `act:${x.id}`, at: x.at!, source: 'atividade' as const, type: x.type, text: x.title, payload: {}, actor: uname(x.ownerId) })),
        ...oppEvents.map((e) => ({ id: `opp:${e.id}`, at: e.at, source: 'oportunidade' as const, type: e.type, text: `OP-${opps.find((o) => o.id === e.oppId)?.code} · ${opps.find((o) => o.id === e.oppId)?.title ?? ''}`, payload: { to: e.to }, actor: uname(e.actorId) })),
      ].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime()).slice(0, 150);
      const f = (await factsOf(app.db, auth, [cid])).get(cid) ?? emptyFacts();
      return {
        commercial: f.commercial,
        abm: { ...a, ownerName: uname(a.ownerId) },
        organization: { ...c!, crmOwnerName: uname(c!.ownerId) },
        classification: cls ? { classKey: cls.classKey, at: cls.at } : null,
        lastInteraction: lastAct[0] ?? null, nextActivity: nextAct[0] ? { ...nextAct[0], ownerName: uname(nextAct[0].ownerId) } : null,
        objectives: objectives.map((o) => ({ ...o, ownerName: uname(o.ownerId) })),
        units: orgUnitTree(units),
        leads: leads.map((l) => ({ ...l, ownerName: uname(l.ownerId) })),
        opportunities: opps.map((o) => ({ ...o, ownerName: uname(o.ownerId) })),
        contracts, history,
      };
    },
  }),

  // ------------------------------------------------------------ dados da organização (cadastro único, com histórico)
  defineRoute({
    method: 'PATCH', url: '/abm/:id/organization', summary: 'Completa os dados da organização aos poucos (nome, CNPJ, natureza, segmento, cidade, contatos institucionais); CNPJ duplicado é recusado', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), name: z.string().trim().min(3).max(200).optional(), document: z.string().trim().max(30).nullable().optional(), nature: z.enum(['publica', 'privada']).nullable().optional(), segment: z.enum(['empresarial', 'governamental', 'institucional', 'residencial']).optional(), city: z.string().trim().max(120).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), email: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)) }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const a = await loadAbm(tx, auth, params.id);
      const [c] = await tx.select().from(s.contacts).where(eq(s.contacts.id, a.contactId)).limit(1).for('update');
      if (c!.rowVersion !== body.rowVersion) throw conflict(c!.rowVersion);
      if (c!.sourceSystem !== 'crm' && (body.name || body.document !== undefined)) throw unprocessable('Conta vinda de integração: nome e CNPJ são mantidos pelo sistema de origem.');
      if (body.document) {
        const d = onlyDigits(body.document);
        if (d.length !== 11 && d.length !== 14) throw unprocessable('CNPJ/CPF incompleto.', [{ path: 'document', message: '11 ou 14 dígitos' }]);
        const [dup] = await tx.select({ id: s.contacts.id, name: s.contacts.name }).from(s.contacts).where(and(eq(s.contacts.tenantId, auth.tenantId), sql`${s.contacts.id} <> ${c!.id}`, sql`${s.contacts.deletedAt} is null`, sql`regexp_replace(coalesce(${s.contacts.document}, ''), '[^0-9]', '', 'g') = ${d}`)).limit(1);
        if (dup) throw unprocessable(`Este CNPJ/CPF já pertence à conta ${dup.name}. Unir cadastros exige revisão.`, [{ path: 'document', message: 'Duplicado' }]);
      }
      const { rowVersion: _rv, ...rest } = body;
      const changed = Object.entries(rest).filter(([k, v]) => v !== undefined && v !== (c as Record<string, unknown>)[k]).map(([k]) => k);
      if (!changed.length) return { ok: true };
      await tx.update(s.contacts).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.contacts.rowVersion} + 1` }).where(eq(s.contacts.id, c!.id));
      const from = Object.fromEntries(changed.map((k) => [k, (c as Record<string, unknown>)[k]]));
      const to = Object.fromEntries(changed.map((k) => [k, (rest as Record<string, unknown>)[k]]));
      await event(tx, auth, a.id, 'organizacao', { fields: changed, from, to });
      await audit(tx, req, { tenantId: auth.tenantId, actorId: auth.userId, action: 'contact.update', entityType: 'contact', entityId: c!.id, metadata: { from, to } });
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ objetivos por conta
  defineRoute({
    method: 'POST', url: '/abm/:id/objectives', summary: 'Inclui objetivo da conta (tipo, responsável, prazo, critério de sucesso)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ kind: z.enum(ABM_OBJECTIVE_KINDS), title: z.string().trim().min(3).max(200), ownerId: z.string().uuid().optional(), dueOn: isoDate.nullable().default(null), successCriteria: z.string().trim().max(500).nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => app.db.transaction(async (tx) => {
      const a = await loadAbm(tx, auth, params.id);
      const ownerId = body.ownerId ?? auth.userId;
      await assertAssignableUser(tx, auth, 'clientes', ownerId);
      const [o] = await tx.insert(s.abmObjectives).values({ tenantId: auth.tenantId, abmId: a.id, kind: body.kind, title: body.title, ownerId, dueOn: body.dueOn, successCriteria: body.successCriteria, createdBy: auth.userId }).returning();
      await event(tx, auth, a.id, 'objetivo_criado', { objectiveId: o!.id, title: body.title, kind: body.kind });
      reply.code(201);
      return o!;
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/abm/objectives/:id', summary: 'Atualiza objetivo; encerrar (atingido, não atingido, cancelado) exige registrar o resultado', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), title: z.string().trim().min(3).max(200).optional(), ownerId: z.string().uuid().optional(), dueOn: isoDate.nullable().optional(), successCriteria: z.string().trim().max(500).nullable().optional(), status: z.enum(ABM_OBJECTIVE_STATUSES).optional(), result: z.string().trim().max(2000).optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [o] = await tx.select().from(s.abmObjectives).where(and(eq(s.abmObjectives.id, params.id), eq(s.abmObjectives.tenantId, auth.tenantId))).limit(1).for('update');
      if (!o) throw notFound('Objetivo não encontrado.');
      const a = await loadAbm(tx, auth, o.abmId);
      if (o.rowVersion !== body.rowVersion) throw conflict(o.rowVersion);
      if (body.status && body.status !== o.status) { const err = objectiveTransition(o.status as AbmObjectiveStatus, body.status, body.result); if (err) throw unprocessable(err, [{ path: 'result', message: err }]); }
      if (body.ownerId && body.ownerId !== o.ownerId) await assertAssignableUser(tx, auth, 'clientes', body.ownerId);
      const { rowVersion: _rv, ...rest } = body;
      const changed = Object.entries(rest).filter(([k, v]) => v !== undefined && v !== (o as Record<string, unknown>)[k]).map(([k]) => k);
      await tx.update(s.abmObjectives).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.abmObjectives.rowVersion} + 1` }).where(eq(s.abmObjectives.id, o.id));
      if (changed.length) await event(tx, auth, a.id, rest.status && rest.status !== o.status ? 'objetivo_situacao' : 'objetivo_alterado', { objectiveId: o.id, title: o.title, fields: changed, from: o.status, to: rest.status ?? o.status, result: rest.result ?? null });
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ estrutura organizacional da conta
  defineRoute({
    method: 'POST', url: '/abm/:id/units', summary: 'Inclui unidade/departamento/secretaria na estrutura da organização (vínculo explícito com o pai)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(160), kind: z.enum(ORG_UNIT_KINDS), parentId: z.string().uuid().nullable().default(null), notes: z.string().trim().max(1000).nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => app.db.transaction(async (tx) => {
      const a = await loadAbm(tx, auth, params.id);
      if (body.parentId) { const [p] = await tx.select({ id: s.accountOrgUnits.id }).from(s.accountOrgUnits).where(and(eq(s.accountOrgUnits.id, body.parentId), eq(s.accountOrgUnits.contactId, a.contactId))).limit(1); if (!p) throw unprocessable('A unidade superior não é desta organização.', [{ path: 'parentId', message: 'Inválida' }]); }
      const [u] = await tx.insert(s.accountOrgUnits).values({ tenantId: auth.tenantId, contactId: a.contactId, ...body, createdBy: auth.userId }).returning();
      await event(tx, auth, a.id, 'estrutura', { unitId: u!.id, name: body.name, kind: body.kind, parentId: body.parentId, action: 'incluida' });
      reply.code(201);
      return u!;
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/abm/units/:id', summary: 'Altera unidade da estrutura (nome, tipo, pai — sem ciclos — ou desativa); nada é apagado', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), name: z.string().trim().min(2).max(160).optional(), kind: z.enum(ORG_UNIT_KINDS).optional(), parentId: z.string().uuid().nullable().optional(), notes: z.string().trim().max(1000).nullable().optional(), active: z.boolean().optional(), abmId: z.string().uuid() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const a = await loadAbm(tx, auth, body.abmId);
      const [u] = await tx.select().from(s.accountOrgUnits).where(and(eq(s.accountOrgUnits.id, params.id), eq(s.accountOrgUnits.contactId, a.contactId))).limit(1).for('update');
      if (!u) throw notFound('Unidade não encontrada.');
      if (u.rowVersion !== body.rowVersion) throw conflict(u.rowVersion);
      if (body.parentId !== undefined && body.parentId !== u.parentId) {
        const all = await tx.select({ id: s.accountOrgUnits.id, parentId: s.accountOrgUnits.parentId }).from(s.accountOrgUnits).where(eq(s.accountOrgUnits.contactId, a.contactId));
        if (body.parentId && !all.some((x) => x.id === body.parentId)) throw unprocessable('A unidade superior não é desta organização.');
        if (orgUnitCycle(all, u.id, body.parentId)) throw unprocessable('Uma unidade não pode ficar abaixo dela mesma ou de uma unidade que está abaixo dela.', [{ path: 'parentId', message: 'Ciclo' }]);
      }
      const { rowVersion: _rv, abmId: _a, ...rest } = body;
      await tx.update(s.accountOrgUnits).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.accountOrgUnits.rowVersion} + 1` }).where(eq(s.accountOrgUnits.id, u.id));
      await event(tx, auth, a.id, 'estrutura', { unitId: u.id, name: rest.name ?? u.name, action: rest.active === false ? 'desativada' : rest.active === true ? 'reativada' : 'alterada', fields: Object.keys(rest) });
      return { ok: true };
    }),
  }),
];
