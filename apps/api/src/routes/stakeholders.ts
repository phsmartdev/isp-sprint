/**
 * ABM Fase 4 — Stakeholders, influência manual auditada, relações e mapa de influência.
 * Regra crítica: o poder de influência só muda por esta API, por pessoa autorizada, com justificativa (origem "manual").
 * Nenhum outro caminho do sistema (importação, sincronização, automação, pesquisa, IA) grava em stakeholder_influence.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  DEFAULT_INFLUENCE_POLICY, INFLUENCE_CONTEXTS, INFLUENCE_LEVELS, INTERESTS, PARTICIPATIONS, RELATIONSHIP_STRENGTHS, STAKEHOLDER_ACCESS, STAKEHOLDER_PRIORITIES, STAKEHOLDER_ROLES, STANCES,
  atLeast, influenceChangeError, quadrantOf, validateInfluencePolicy,
  type InfluenceContext, type InfluenceLevel, type InfluencePolicy, type Interest,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { assertAssignableUser, level, ownerScope } from '../services/scope';

const contactVisible = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function abmPolicy(db: DbOrTx, tenantId: string): Promise<{ version: number; influence: InfluencePolicy }> {
  const [r] = await db.select().from(s.abmSettings).where(eq(s.abmSettings.tenantId, tenantId)).orderBy(desc(s.abmSettings.version)).limit(1);
  const inf = (r?.config as { influence?: Partial<InfluencePolicy> } | undefined)?.influence;
  return { version: r?.version ?? 0, influence: { ...DEFAULT_INFLUENCE_POLICY, ...(inf ?? {}), labels: { ...DEFAULT_INFLUENCE_POLICY.labels, ...(inf?.labels ?? {}) } } };
}
export const canViewInfluence = (auth: AuthContext, p: InfluencePolicy) => atLeast(level(auth, 'clientes'), p.view);
const canEditInfluence = (auth: AuthContext, p: InfluencePolicy) => atLeast(level(auth, 'clientes'), p.edit);

export async function assertAccount(db: DbOrTx, auth: AuthContext, contactId: string) {
  const [c] = await db.select({ id: s.contacts.id, name: s.contacts.name }).from(s.contacts).where(and(eq(s.contacts.id, contactId), contactVisible(auth))).limit(1);
  if (!c) throw notFound('Conta não encontrada na sua carteira.');
  return c;
}
async function loadStakeholder(db: DbOrTx, auth: AuthContext, id: string, forUpdate = false) {
  const q = db.select().from(s.accountStakeholders).where(and(eq(s.accountStakeholders.id, id), eq(s.accountStakeholders.tenantId, auth.tenantId))).limit(1);
  const [st] = forUpdate ? await q.for('update') : await q;
  if (!st) throw notFound('Stakeholder não encontrado.');
  await assertAccount(db, auth, st.contactId);
  return st;
}
const stEvent = (db: DbOrTx, auth: AuthContext, stakeholderId: string, type: string, payload: Record<string, unknown>) => db.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId, type, payload, actorId: auth.userId });

/** Aplica a avaliação de influência (manual) e grava a auditoria. Única função que escreve em stakeholder_influence. */
async function applyInfluence(db: DbOrTx, auth: AuthContext, v: { stakeholderId: string; contextType: InfluenceContext; contextKey: string; contextLabel: string | null; from: InfluenceLevel; to: InfluenceLevel; justification: string; evidence: string | null; actorId: string; approvedBy: string | null }) {
  await db.insert(s.stakeholderInfluence).values({ tenantId: auth.tenantId, stakeholderId: v.stakeholderId, contextType: v.contextType, contextKey: v.contextKey, contextLabel: v.contextLabel, level: v.to, updatedBy: v.actorId })
    .onConflictDoUpdate({ target: [s.stakeholderInfluence.stakeholderId, s.stakeholderInfluence.contextType, s.stakeholderInfluence.contextKey], set: { level: v.to, contextLabel: v.contextLabel, updatedBy: v.actorId, updatedAt: new Date(), rowVersion: sql`${s.stakeholderInfluence.rowVersion} + 1` } });
  await db.insert(s.stakeholderInfluenceHistory).values({ tenantId: auth.tenantId, stakeholderId: v.stakeholderId, contextType: v.contextType, contextKey: v.contextKey, contextLabel: v.contextLabel, fromLevel: v.from, toLevel: v.to, justification: v.justification, evidence: v.evidence, actorId: v.actorId, approvedBy: v.approvedBy });
}

const PersonBody = z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().toLowerCase().email().max(200).nullable().default(null), phone: z.string().trim().max(40).nullable().default(null) });
const StakeholderFields = z.object({
  title: z.string().trim().max(160).nullable().optional(), unitId: z.string().uuid().nullable().optional(),
  roles: z.array(z.enum(STAKEHOLDER_ROLES)).max(11).optional(), customRoles: z.array(z.string().trim().min(2).max(60)).max(10).optional(),
  interest: z.enum(INTERESTS).optional(), stance: z.enum(STANCES).optional(), relationshipStrength: z.enum(RELATIONSHIP_STRENGTHS).optional(), access: z.enum(STAKEHOLDER_ACCESS).optional(),
  participation: z.enum(PARTICIPATIONS).optional(), priority: z.enum(STAKEHOLDER_PRIORITIES).optional(), relationshipOwnerId: z.string().uuid().nullable().optional(),
  nextInteractionOn: isoDate.nullable().optional(), notes: z.string().trim().max(4000).nullable().optional(), active: z.boolean().optional(),
}).strict();

async function assertUnit(db: DbOrTx, contactId: string, unitId: string | null | undefined) {
  if (!unitId) return;
  const [u] = await db.select({ id: s.accountOrgUnits.id }).from(s.accountOrgUnits).where(and(eq(s.accountOrgUnits.id, unitId), eq(s.accountOrgUnits.contactId, contactId))).limit(1);
  if (!u) throw unprocessable('O departamento não é desta organização.', [{ path: 'unitId', message: 'Inválido' }]);
}

/** Linhas de stakeholders de um conjunto de contas, com pessoa, departamento e influência por contexto. */
export async function stakeholderRows(db: DbOrTx, auth: AuthContext, contactIds: string[], policy: InfluencePolicy) {
  if (!contactIds.length) return [];
  const rows = await db.select({ st: s.accountStakeholders, person: s.people, unitName: s.accountOrgUnits.name, account: s.contacts.name, ownerName: s.users.name })
    .from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).innerJoin(s.contacts, eq(s.contacts.id, s.accountStakeholders.contactId))
    .leftJoin(s.accountOrgUnits, eq(s.accountOrgUnits.id, s.accountStakeholders.unitId)).leftJoin(s.users, eq(s.users.id, s.accountStakeholders.relationshipOwnerId))
    .where(inArray(s.accountStakeholders.contactId, contactIds)).orderBy(asc(s.people.name)).limit(2000);
  const ids = rows.map((r) => r.st.id);
  const inf = ids.length && canViewInfluence(auth, policy) ? await db.select().from(s.stakeholderInfluence).where(inArray(s.stakeholderInfluence.stakeholderId, ids)) : [];
  const pend = ids.length ? await db.select({ id: s.influenceChangeRequests.stakeholderId }).from(s.influenceChangeRequests).where(and(inArray(s.influenceChangeRequests.stakeholderId, ids), eq(s.influenceChangeRequests.status, 'pendente'))) : [];
  const show = canViewInfluence(auth, policy);
  return rows.map((r) => {
    const mine = inf.filter((i) => i.stakeholderId === r.st.id);
    const acc = mine.find((i) => i.contextType === 'conta');
    return {
      ...r.st, name: r.person.name, email: r.person.email, phone: r.person.phone, personId: r.person.id, unitName: r.unitName, account: r.account, relationshipOwnerName: r.ownerName,
      influence: show ? ((acc?.level ?? 'nao_avaliado') as InfluenceLevel) : null,
      influenceContexts: show ? mine.filter((i) => i.contextType !== 'conta').map((i) => ({ contextType: i.contextType, contextKey: i.contextKey, contextLabel: i.contextLabel, level: i.level })) : [],
      influencePending: pend.some((p) => p.id === r.st.id),
    };
  });
}

export const stakeholderRoutes = [
  // ------------------------------------------------------------ configuração (Administração → ABM)
  defineRoute({
    method: 'GET', url: '/abm/settings', summary: 'Configuração do ABM: quem vê e edita a influência, se exige aprovação e os nomes dos níveis', tag: 'Marketing', module: 'clientes',
    handler: async ({ app, auth }) => {
      const p = await abmPolicy(app.db, auth.tenantId);
      return { ...p, canEdit: atLeast(level(auth, 'configuracoes'), 'total'), you: { view: canViewInfluence(auth, p.influence), edit: canEditInfluence(auth, p.influence) } };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/abm/settings', summary: 'Salva nova versão da configuração do ABM (histórico mantido)', tag: 'Marketing', module: 'configuracoes', min: 'total',
    body: z.object({ influence: z.object({ view: z.enum(['proprio', 'equipe', 'total']), edit: z.enum(['proprio', 'equipe', 'total']), requireApproval: z.boolean(), labels: z.record(z.enum(INFLUENCE_LEVELS), z.string().trim().max(40)) }), note: z.string().trim().min(3).max(300) }),
    handler: async ({ app, auth, body }) => {
      const pol = { ...body.influence, labels: { ...DEFAULT_INFLUENCE_POLICY.labels, ...body.influence.labels } } as InfluencePolicy;
      const errs = validateInfluencePolicy(pol);
      if (errs.length) throw unprocessable(errs[0]!);
      const cur = await abmPolicy(app.db, auth.tenantId);
      await app.db.insert(s.abmSettings).values({ tenantId: auth.tenantId, version: cur.version + 1, config: { influence: pol }, note: body.note, createdBy: auth.userId });
      return { version: cur.version + 1 };
    },
  }),

  // ------------------------------------------------------------ pessoas (reaproveitar antes de criar)
  defineRoute({
    method: 'GET', url: '/people/search', summary: 'Pessoas já cadastradas (nome ou e-mail), com as organizações a que estão ligadas — para reaproveitar em vez de duplicar', tag: 'Marketing', module: 'clientes',
    query: z.object({ q: z.string().trim().min(2).max(100) }),
    handler: async ({ app, auth, query: q }) => {
      const term = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
      const ps = await app.db.select().from(s.people).where(and(eq(s.people.tenantId, auth.tenantId), or(ilike(s.people.name, term), ilike(s.people.email, term)))).orderBy(asc(s.people.name)).limit(20);
      const links = ps.length ? await app.db.select({ personId: s.accountStakeholders.personId, account: s.contacts.name, title: s.accountStakeholders.title }).from(s.accountStakeholders).innerJoin(s.contacts, eq(s.contacts.id, s.accountStakeholders.contactId)).where(and(inArray(s.accountStakeholders.personId, ps.map((p) => p.id)), contactVisible(auth))) : [];
      return { items: ps.map((p) => ({ id: p.id, name: p.name, email: p.email, phone: p.phone, accounts: links.filter((l) => l.personId === p.id).map((l) => ({ account: l.account, title: l.title })) })) };
    },
  }),

  // ------------------------------------------------------------ stakeholders da conta
  defineRoute({
    method: 'GET', url: '/accounts/:id/stakeholders', summary: 'Stakeholders da conta com papéis, classificações e influência (se a política permitir ver)', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      const pol = await abmPolicy(app.db, auth.tenantId);
      const [items, relations, units] = await Promise.all([
        stakeholderRows(app.db, auth, [params.id], pol.influence),
        app.db.select().from(s.stakeholderRelations).where(and(eq(s.stakeholderRelations.contactId, params.id), eq(s.stakeholderRelations.active, true))),
        app.db.select({ id: s.accountOrgUnits.id, name: s.accountOrgUnits.name, parentId: s.accountOrgUnits.parentId, active: s.accountOrgUnits.active }).from(s.accountOrgUnits).where(eq(s.accountOrgUnits.contactId, params.id)),
      ]);
      return { items, relations, units, policy: { labels: pol.influence.labels, view: canViewInfluence(auth, pol.influence), edit: canEditInfluence(auth, pol.influence), requireApproval: pol.influence.requireApproval } };
    },
  }),
  defineRoute({
    method: 'POST', url: '/accounts/:id/stakeholders', summary: 'Liga uma pessoa à conta como stakeholder (reaproveita pessoa existente pelo id ou pelo mesmo e-mail; influência começa "não avaliado")', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: StakeholderFields.extend({ personId: z.string().uuid().optional(), person: PersonBody.optional() }),
    handler: async ({ app, auth, params, body, reply }) => app.db.transaction(async (tx) => {
      await assertAccount(tx, auth, params.id);
      const { personId: pid, person, ...fields } = body;
      if (!pid && !person) throw unprocessable('Escolha uma pessoa já cadastrada ou informe o nome.');
      await assertUnit(tx, params.id, fields.unitId);
      if (fields.relationshipOwnerId) await assertAssignableUser(tx, auth, 'clientes', fields.relationshipOwnerId);
      let personId = pid ?? null;
      if (personId) { const [p] = await tx.select({ id: s.people.id }).from(s.people).where(and(eq(s.people.id, personId), eq(s.people.tenantId, auth.tenantId))).limit(1); if (!p) throw unprocessable('Pessoa não encontrada.'); }
      else if (person!.email) { const [p] = await tx.select({ id: s.people.id }).from(s.people).where(and(eq(s.people.tenantId, auth.tenantId), sql`lower(${s.people.email}) = ${person!.email}`)).limit(1); personId = p?.id ?? null; }
      if (!personId) { const [p] = await tx.insert(s.people).values({ tenantId: auth.tenantId, ...person!, createdBy: auth.userId }).returning({ id: s.people.id }); personId = p!.id; }
      const [dup] = await tx.select({ id: s.accountStakeholders.id }).from(s.accountStakeholders).where(and(eq(s.accountStakeholders.contactId, params.id), eq(s.accountStakeholders.personId, personId))).limit(1);
      if (dup) throw unprocessable('Esta pessoa já é stakeholder desta conta.');
      const [st] = await tx.insert(s.accountStakeholders).values({ tenantId: auth.tenantId, contactId: params.id, personId, ...fields, relationshipOwnerId: fields.relationshipOwnerId ?? auth.userId, createdBy: auth.userId }).returning();
      await stEvent(tx, auth, st!.id, 'incluido', { personId, title: fields.title ?? null, roles: fields.roles ?? [] });
      reply.code(201);
      return st!;
    }),
  }),
  defineRoute({
    method: 'GET', url: '/stakeholders/:id', summary: 'Stakeholder: dados, classificações, influência por contexto com auditoria, pedidos e relações', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const st = await loadStakeholder(app.db, auth, params.id);
      const pol = await abmPolicy(app.db, auth.tenantId);
      const [row] = await stakeholderRows(app.db, auth, [st.contactId], pol.influence).then((r) => r.filter((x) => x.id === st.id));
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const uname = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
      const show = canViewInfluence(auth, pol.influence);
      const [hist, events, reqs, rels] = await Promise.all([
        show ? app.db.select().from(s.stakeholderInfluenceHistory).where(eq(s.stakeholderInfluenceHistory.stakeholderId, st.id)).orderBy(desc(s.stakeholderInfluenceHistory.createdAt)) : Promise.resolve([]),
        app.db.select().from(s.stakeholderEvents).where(eq(s.stakeholderEvents.stakeholderId, st.id)).orderBy(desc(s.stakeholderEvents.createdAt)).limit(100),
        show ? app.db.select().from(s.influenceChangeRequests).where(eq(s.influenceChangeRequests.stakeholderId, st.id)).orderBy(desc(s.influenceChangeRequests.createdAt)).limit(30) : Promise.resolve([]),
        app.db.select().from(s.stakeholderRelations).where(and(or(eq(s.stakeholderRelations.fromId, st.id), eq(s.stakeholderRelations.toId, st.id)), eq(s.stakeholderRelations.active, true))),
      ]);
      const otherIds = [...new Set(rels.flatMap((r) => [r.fromId, r.toId]).filter((x) => x !== st.id))];
      const others = otherIds.length ? await app.db.select({ id: s.accountStakeholders.id, name: s.people.name }).from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(inArray(s.accountStakeholders.id, otherIds)) : [];
      return {
        ...row!, policy: { labels: pol.influence.labels, view: show, edit: canEditInfluence(auth, pol.influence), requireApproval: pol.influence.requireApproval },
        influenceHistory: hist.map((h) => ({ ...h, actorName: uname(h.actorId), approvedByName: uname(h.approvedBy) })),
        requests: reqs.map((r) => ({ ...r, requestedByName: uname(r.requestedBy), decidedByName: uname(r.decidedBy) })),
        events: events.map((e) => ({ ...e, actorName: uname(e.actorId) })),
        relations: rels.map((r) => ({ ...r, otherName: others.find((o) => o.id === (r.fromId === st.id ? r.toId : r.fromId))?.name ?? null, direction: r.fromId === st.id ? 'saida' : 'entrada' })),
      };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/stakeholders/:id', summary: 'Atualiza cargo, departamento, papéis e classificações (interesse, posicionamento, relacionamento, acesso, participação, prioridade) — a influência não muda por aqui', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: StakeholderFields.extend({ rowVersion: z.number().int() }).strict(),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const st = await loadStakeholder(tx, auth, params.id, true);
      if (st.rowVersion !== body.rowVersion) throw conflict(st.rowVersion);
      await assertUnit(tx, st.contactId, body.unitId);
      if (body.relationshipOwnerId && body.relationshipOwnerId !== st.relationshipOwnerId) await assertAssignableUser(tx, auth, 'clientes', body.relationshipOwnerId);
      const { rowVersion: _rv, ...rest } = body;
      const changed = Object.entries(rest).filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify((st as Record<string, unknown>)[k])).map(([k]) => k);
      if (!changed.length) return { ok: true };
      await tx.update(s.accountStakeholders).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.accountStakeholders.rowVersion} + 1` }).where(eq(s.accountStakeholders.id, st.id));
      await stEvent(tx, auth, st.id, 'alterado', { fields: changed, from: Object.fromEntries(changed.map((k) => [k, (st as Record<string, unknown>)[k]])), to: Object.fromEntries(changed.map((k) => [k, (rest as Record<string, unknown>)[k]])) });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/people/:id', summary: 'Atualiza os dados da pessoa (nome, e-mail, telefone) — vale em todas as organizações a que ela está ligada', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: PersonBody.partial().extend({ rowVersion: z.number().int(), stakeholderId: z.string().uuid() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const st = await loadStakeholder(tx, auth, body.stakeholderId);
      if (st.personId !== params.id) throw notFound('Pessoa não encontrada.');
      const [p] = await tx.select().from(s.people).where(eq(s.people.id, params.id)).limit(1).for('update');
      if (p!.rowVersion !== body.rowVersion) throw conflict(p!.rowVersion);
      const { rowVersion: _rv, stakeholderId: _s, ...rest } = body;
      if (rest.email) { const [d] = await tx.select({ id: s.people.id }).from(s.people).where(and(eq(s.people.tenantId, auth.tenantId), sql`lower(${s.people.email}) = ${rest.email}`, sql`${s.people.id} <> ${p!.id}`)).limit(1); if (d) throw unprocessable('Já existe outra pessoa com este e-mail.'); }
      await tx.update(s.people).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.people.rowVersion} + 1` }).where(eq(s.people.id, p!.id));
      await stEvent(tx, auth, st.id, 'pessoa_alterada', { fields: Object.keys(rest) });
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ influência: manual, justificada, auditada, por contexto
  defineRoute({
    method: 'POST', url: '/stakeholders/:id/influence', summary: 'Avalia o poder de influência (manual, com justificativa, por contexto). Se a empresa exigir aprovação, vira pedido.', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ contextType: z.enum(INFLUENCE_CONTEXTS).default('conta'), contextKey: z.string().max(80).default(''), contextLabel: z.string().trim().max(200).nullable().default(null), level: z.enum(INFLUENCE_LEVELS), justification: z.string().trim().max(2000), evidence: z.string().trim().max(2000).nullable().default(null) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const st = await loadStakeholder(tx, auth, params.id, true);
      const pol = await abmPolicy(tx, auth.tenantId);
      if (!canEditInfluence(auth, pol.influence)) throw forbidden('Seu perfil não pode avaliar o poder de influência.');
      const key = body.contextType === 'conta' ? '' : body.contextKey;
      if (body.contextType === 'unidade' && key) await assertUnit(tx, st.contactId, key);
      if (body.contextType === 'oportunidade' && key) { const [o] = await tx.select({ id: s.opportunities.id }).from(s.opportunities).where(and(eq(s.opportunities.id, key), eq(s.opportunities.contactId, st.contactId))).limit(1); if (!o) throw unprocessable('A oportunidade não é desta conta.'); }
      if (body.contextType === 'projeto' && key) { const [p] = await tx.select({ id: s.projects.id }).from(s.projects).where(and(eq(s.projects.id, key), eq(s.projects.tenantId, auth.tenantId))).limit(1); if (!p) throw unprocessable('Projeto não encontrado.'); }
      const [cur] = await tx.select().from(s.stakeholderInfluence).where(and(eq(s.stakeholderInfluence.stakeholderId, st.id), eq(s.stakeholderInfluence.contextType, body.contextType), eq(s.stakeholderInfluence.contextKey, key))).limit(1);
      const from = (cur?.level ?? 'nao_avaliado') as InfluenceLevel;
      const err = influenceChangeError({ origin: 'manual', from, to: body.level, justification: body.justification, contextType: body.contextType, contextId: key || null });
      if (err) throw unprocessable(err, [{ path: 'justification', message: err }]);
      if (pol.influence.requireApproval) {
        const [r] = await tx.insert(s.influenceChangeRequests).values({ tenantId: auth.tenantId, stakeholderId: st.id, contextType: body.contextType, contextKey: key, contextLabel: body.contextLabel, fromLevel: from, toLevel: body.level, justification: body.justification, evidence: body.evidence, requestedBy: auth.userId }).onConflictDoNothing().returning({ id: s.influenceChangeRequests.id });
        if (!r) throw unprocessable('Já existe um pedido pendente para este contexto. Aguarde a decisão.');
        await stEvent(tx, auth, st.id, 'influencia_pedida', { contextType: body.contextType, from, to: body.level });
        return { status: 'pendente', requestId: r.id };
      }
      await applyInfluence(tx, auth, { stakeholderId: st.id, contextType: body.contextType, contextKey: key, contextLabel: body.contextLabel, from, to: body.level, justification: body.justification, evidence: body.evidence, actorId: auth.userId, approvedBy: null });
      return { status: 'aplicada' };
    }),
  }),
  defineRoute({
    method: 'GET', url: '/influence-requests', summary: 'Pedidos de mudança de influência (pendentes por padrão) das contas visíveis', tag: 'Marketing', module: 'clientes',
    query: z.object({ status: z.enum(['pendente', 'aprovada', 'recusada']).default('pendente') }),
    handler: async ({ app, auth, query: q }) => {
      const pol = await abmPolicy(app.db, auth.tenantId);
      if (!canViewInfluence(auth, pol.influence)) return { items: [] };
      const rows = await app.db.select({ r: s.influenceChangeRequests, name: s.people.name, account: s.contacts.name, contactId: s.contacts.id, abmId: s.abmAccounts.id, by: s.users.name })
        .from(s.influenceChangeRequests).innerJoin(s.accountStakeholders, eq(s.accountStakeholders.id, s.influenceChangeRequests.stakeholderId)).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId))
        .innerJoin(s.contacts, eq(s.contacts.id, s.accountStakeholders.contactId)).leftJoin(s.abmAccounts, eq(s.abmAccounts.contactId, s.contacts.id)).innerJoin(s.users, eq(s.users.id, s.influenceChangeRequests.requestedBy))
        .where(and(eq(s.influenceChangeRequests.tenantId, auth.tenantId), eq(s.influenceChangeRequests.status, q.status), contactVisible(auth))).orderBy(desc(s.influenceChangeRequests.createdAt)).limit(200);
      return { items: rows.map((x) => ({ ...x.r, name: x.name, account: x.account, contactId: x.contactId, abmId: x.abmId, requestedByName: x.by, canDecide: canEditInfluence(auth, pol.influence) && atLeast(level(auth, 'clientes'), 'equipe') && x.r.requestedBy !== auth.userId })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/influence-requests/:id/decide', summary: 'Aprova ou recusa o pedido de influência (quem pediu não decide)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).default('') }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [r] = await tx.select().from(s.influenceChangeRequests).where(and(eq(s.influenceChangeRequests.id, params.id), eq(s.influenceChangeRequests.tenantId, auth.tenantId))).limit(1).for('update');
      if (!r) throw notFound('Pedido não encontrado.');
      const st = await loadStakeholder(tx, auth, r.stakeholderId, true);
      const pol = await abmPolicy(tx, auth.tenantId);
      if (!canEditInfluence(auth, pol.influence) || !atLeast(level(auth, 'clientes'), 'equipe')) throw forbidden('Só a liderança com permissão de editar influência decide pedidos.');
      if (r.requestedBy === auth.userId) throw forbidden('Quem pediu a mudança não pode aprovar o próprio pedido.');
      if (r.status !== 'pendente') throw unprocessable('Este pedido já foi decidido.');
      if (!body.approve && body.note.length < 5) throw unprocessable('Diga por que o pedido foi recusado.');
      await tx.update(s.influenceChangeRequests).set({ status: body.approve ? 'aprovada' : 'recusada', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note || null }).where(eq(s.influenceChangeRequests.id, r.id));
      if (body.approve) {
        const [cur] = await tx.select().from(s.stakeholderInfluence).where(and(eq(s.stakeholderInfluence.stakeholderId, st.id), eq(s.stakeholderInfluence.contextType, r.contextType), eq(s.stakeholderInfluence.contextKey, r.contextKey))).limit(1);
        await applyInfluence(tx, auth, { stakeholderId: st.id, contextType: r.contextType as InfluenceContext, contextKey: r.contextKey, contextLabel: r.contextLabel, from: (cur?.level ?? 'nao_avaliado') as InfluenceLevel, to: r.toLevel as InfluenceLevel, justification: r.justification, evidence: r.evidence, actorId: r.requestedBy, approvedBy: auth.userId });
      }
      await stEvent(tx, auth, st.id, body.approve ? 'influencia_aprovada' : 'influencia_recusada', { requestId: r.id, note: body.note || null });
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ relações (registradas, nunca inferidas)
  defineRoute({
    method: 'POST', url: '/accounts/:id/relations', summary: 'Registra relação profissional entre dois stakeholders da conta', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ fromId: z.string().uuid(), toId: z.string().uuid(), kind: z.enum(['reporta_a', 'influencia', 'aliado', 'conflito', 'indicou', 'outro']), notes: z.string().trim().max(500).nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => app.db.transaction(async (tx) => {
      await assertAccount(tx, auth, params.id);
      if (body.fromId === body.toId) throw unprocessable('Escolha duas pessoas diferentes.');
      const both = await tx.select({ id: s.accountStakeholders.id }).from(s.accountStakeholders).where(and(inArray(s.accountStakeholders.id, [body.fromId, body.toId]), eq(s.accountStakeholders.contactId, params.id)));
      if (both.length !== 2) throw unprocessable('As duas pessoas precisam ser stakeholders desta conta.');
      const [dup] = await tx.select({ id: s.stakeholderRelations.id }).from(s.stakeholderRelations).where(and(eq(s.stakeholderRelations.fromId, body.fromId), eq(s.stakeholderRelations.toId, body.toId), eq(s.stakeholderRelations.kind, body.kind), eq(s.stakeholderRelations.active, true))).limit(1);
      if (dup) throw unprocessable('Esta relação já está registrada.');
      const [r] = await tx.insert(s.stakeholderRelations).values({ tenantId: auth.tenantId, contactId: params.id, ...body, createdBy: auth.userId }).returning();
      await stEvent(tx, auth, body.fromId, 'relacao_incluida', { relationId: r!.id, kind: body.kind, toId: body.toId });
      reply.code(201);
      return r!;
    }),
  }),
  defineRoute({
    method: 'POST', url: '/stakeholder-relations/:id/remove', summary: 'Desativa uma relação registrada (fica no histórico)', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => app.db.transaction(async (tx) => {
      const [r] = await tx.select().from(s.stakeholderRelations).where(and(eq(s.stakeholderRelations.id, params.id), eq(s.stakeholderRelations.tenantId, auth.tenantId))).limit(1);
      if (!r) throw notFound('Relação não encontrada.');
      await assertAccount(tx, auth, r.contactId);
      await tx.update(s.stakeholderRelations).set({ active: false }).where(eq(s.stakeholderRelations.id, r.id));
      await stEvent(tx, auth, r.fromId, 'relacao_removida', { relationId: r.id, kind: r.kind, toId: r.toId });
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ lista geral e mapa de influência
  defineRoute({
    method: 'GET', url: '/abm/stakeholders', summary: 'Stakeholders das contas do ABM visíveis, com filtros (papel, influência, prioridade, sem avaliação, conta)', tag: 'Marketing', module: 'clientes',
    query: z.object({ role: z.enum(STAKEHOLDER_ROLES).optional(), influence: z.enum(INFLUENCE_LEVELS).optional(), priority: z.enum(STAKEHOLDER_PRIORITIES).optional(), contactId: z.string().uuid().optional(), q: z.string().max(100).optional() }),
    handler: async ({ app, auth, query: q }) => {
      const pol = await abmPolicy(app.db, auth.tenantId);
      const accounts = await app.db.select({ id: s.contacts.id, abmId: s.abmAccounts.id }).from(s.abmAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.abmAccounts.contactId)).where(and(eq(s.abmAccounts.tenantId, auth.tenantId), contactVisible(auth), q.contactId ? eq(s.contacts.id, q.contactId) : sql`true`));
      const abmOf = new Map(accounts.map((a) => [a.id, a.abmId]));
      let items = (await stakeholderRows(app.db, auth, accounts.map((a) => a.id), pol.influence)).map((i) => ({ ...i, abmId: abmOf.get(i.contactId) ?? null }));
      if (q.role) items = items.filter((i) => i.roles.includes(q.role!));
      if (q.priority) items = items.filter((i) => i.priority === q.priority);
      if (q.influence) items = items.filter((i) => i.influence === q.influence);
      if (q.q) { const t = q.q.toLowerCase(); items = items.filter((i) => i.name.toLowerCase().includes(t) || (i.title ?? '').toLowerCase().includes(t) || i.account.toLowerCase().includes(t)); }
      const all = items.filter((i) => i.active);
      return {
        items, policy: { labels: pol.influence.labels, view: canViewInfluence(auth, pol.influence) },
        counts: { total: all.length, decisores: all.filter((i) => i.roles.includes('decisor')).length, naoAvaliados: canViewInfluence(auth, pol.influence) ? all.filter((i) => i.influence === 'nao_avaliado').length : null, criticos: all.filter((i) => i.priority === 'critica').length },
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/accounts/:id/influence-map', summary: 'Mapa influência × interesse da conta (por contexto e departamento), não avaliados à parte; CSV opcional', tag: 'Marketing', module: 'clientes', params: IdParams,
    query: z.object({ context: z.enum(INFLUENCE_CONTEXTS).default('conta'), contextKey: z.string().max(80).default(''), unitId: z.string().uuid().optional(), format: z.enum(['json', 'csv']).default('json') }),
    handler: async ({ app, auth, params, query: q, reply }) => {
      await assertAccount(app.db, auth, params.id);
      const pol = await abmPolicy(app.db, auth.tenantId);
      if (!canViewInfluence(auth, pol.influence)) throw forbidden('Seu perfil não vê o poder de influência.');
      let rows = (await stakeholderRows(app.db, auth, [params.id], pol.influence)).filter((r) => r.active);
      if (q.unitId) rows = rows.filter((r) => r.unitId === q.unitId);
      const level = (r: (typeof rows)[number]): InfluenceLevel => (q.context === 'conta' ? r.influence! : ((r.influenceContexts.find((c) => c.contextType === q.context && c.contextKey === q.contextKey)?.level ?? 'nao_avaliado') as InfluenceLevel));
      const points = rows.map((r) => ({ id: r.id, name: r.name, title: r.title, unitName: r.unitName, roles: r.roles, stance: r.stance, interest: r.interest as Interest, influence: level(r), quadrant: quadrantOf(level(r), r.interest as Interest) }));
      if (q.format === 'csv') {
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = ['Nome;Cargo;Departamento;Papéis;Influência;Interesse;Posicionamento;Quadrante', ...points.map((p) => [p.name, p.title, p.unitName, p.roles.join(', '), pol.influence.labels[p.influence], p.interest, p.stance, p.quadrant ?? 'fora da matriz'].map(esc).join(';'))];
        reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="mapa-de-influencia.csv"');
        return `﻿${lines.join('\n')}`;
      }
      return { points: points.filter((p) => p.quadrant), outside: points.filter((p) => !p.quadrant), labels: pol.influence.labels };
    },
  }),
];
