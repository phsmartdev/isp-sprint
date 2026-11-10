/**
 * Estruturas (programa, projeto, rede, consórcio, convênio, grupo): a macro entidade que reúne contas e contratos.
 * Criar e editar: administração ou Clientes em nível Total (Configurações → Modelos → Estruturas).
 * Vincular conta: quem vê a conta. Vincular contrato: quem vê o contrato. Desvincular exige motivo e fica no histórico.
 */
import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { STRUCTURE_KINDS, STRUCTURE_KIND_LABELS, STRUCTURE_ROLES, STRUCTURE_ROLE_LABELS } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { atLeast } from '@isp/domain';
import { level, ownerScope } from '../services/scope';
import { contractScope, loadContract } from '../services/contracts';
import { assertAccount } from './stakeholders';

const visibleContact = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });
const canManage = (auth: AuthContext) => atLeast(level(auth, 'configuracoes'), 'total') || atLeast(level(auth, 'clientes'), 'total');
const seesContracts = (auth: AuthContext) => level(auth, 'contratos') !== 'nenhum';
const guard = (auth: AuthContext) => { if (!canManage(auth)) throw forbidden('Só a administração ou quem tem nível Total em Clientes cria e edita estruturas.'); };

const Body = z.object({
  name: z.string().trim().min(2).max(160), kind: z.enum(STRUCTURE_KINDS).default('programa'),
  description: z.string().trim().max(2000).nullable().default(null), ownerId: z.string().uuid().nullable().default(null),
});

async function loadStructure(db: DbOrTx, auth: AuthContext, id: string) {
  const [st] = await db.select().from(s.accountStructures).where(and(eq(s.accountStructures.id, id), eq(s.accountStructures.tenantId, auth.tenantId))).limit(1);
  if (!st) throw notFound('Estrutura não encontrada.');
  return st;
}
const nameTaken = async (db: DbOrTx, tenantId: string, name: string, exceptId?: string) =>
  (await db.select({ id: s.accountStructures.id }).from(s.accountStructures).where(and(eq(s.accountStructures.tenantId, tenantId), sql`lower(${s.accountStructures.name}) = lower(${name})`, exceptId ? sql`${s.accountStructures.id} <> ${exceptId}` : sql`true`)).limit(1)).length > 0;

/** Contas e contratos vinculados (contas fora da carteira aparecem sem nome; contratos só para quem vê contratos). */
async function structureDetail(db: DbOrTx, auth: AuthContext, ids: string[]) {
  if (!ids.length) return { members: [], contracts: [] };
  const members = await db.select({ id: s.structureMembers.id, structureId: s.structureMembers.structureId, contactId: s.structureMembers.contactId, role: s.structureMembers.role, notes: s.structureMembers.notes, createdAt: s.structureMembers.createdAt })
    .from(s.structureMembers).where(and(inArray(s.structureMembers.structureId, ids), eq(s.structureMembers.active, true)));
  const cids = [...new Set(members.map((m) => m.contactId))];
  const vis = cids.length ? await db.select({ id: s.contacts.id, name: s.contacts.name, segment: s.contacts.segment, city: s.contacts.city, abmId: s.abmAccounts.id }).from(s.contacts)
    .leftJoin(s.abmAccounts, eq(s.abmAccounts.contactId, s.contacts.id)).where(and(inArray(s.contacts.id, cids), visibleContact(auth))) : [];
  const links = await db.select({ id: s.structureContracts.id, structureId: s.structureContracts.structureId, contractId: s.structureContracts.contractId, notes: s.structureContracts.notes })
    .from(s.structureContracts).where(and(inArray(s.structureContracts.structureId, ids), eq(s.structureContracts.active, true)));
  const v = s.contractVersions;
  const cts = links.length && seesContracts(auth) ? await db.select({ id: s.contracts.id, code: s.contracts.code, stage: s.contracts.stage, contactId: s.contracts.contactId, clientName: s.contacts.name, number: v.number, object: v.object, endAt: v.endAt, monthlyCents: v.monthlyCents, totalCents: v.totalCents })
    .from(s.contracts).innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion))).innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId))
    .where(and(inArray(s.contracts.id, links.map((l) => l.contractId)), contractScope(auth))) : [];
  return {
    members: members.map((m) => { const c = vis.find((x) => x.id === m.contactId); return { ...m, roleLabel: STRUCTURE_ROLE_LABELS[m.role as keyof typeof STRUCTURE_ROLE_LABELS] ?? m.role, name: c?.name ?? 'Conta fora da sua carteira', visible: !!c, segment: c?.segment ?? null, city: c?.city ?? null, abmId: c?.abmId ?? null }; }),
    contracts: links.flatMap((l) => { const c = cts.find((x) => x.id === l.contractId); return c ? [{ linkId: l.id, structureId: l.structureId, notes: l.notes, ...c }] : []; }),
    hiddenContracts: links.filter((l) => !cts.some((c) => c.id === l.contractId)).length,
  };
}

export const structureRoutes = [
  defineRoute({
    method: 'GET', url: '/structures', summary: 'Estruturas (programas, projetos, redes, consórcios…) com quantas contas e contratos reúnem e o valor mensal dos contratos', tag: 'Clientes', module: 'clientes',
    query: z.object({ q: z.string().trim().max(100).optional(), all: z.coerce.boolean().default(false) }),
    handler: async ({ app, auth, query }) => {
      const rows = await app.db.select().from(s.accountStructures).where(and(eq(s.accountStructures.tenantId, auth.tenantId), query.all ? sql`true` : eq(s.accountStructures.active, true), query.q ? ilike(s.accountStructures.name, `%${query.q.replace(/[%_\\]/g, '\\$&')}%`) : sql`true`)).orderBy(asc(s.accountStructures.name)).limit(300);
      const d = await structureDetail(app.db, auth, rows.map((r) => r.id));
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      return {
        kinds: STRUCTURE_KINDS.map((k) => ({ key: k, label: STRUCTURE_KIND_LABELS[k] })), roles: STRUCTURE_ROLES.map((k) => ({ key: k, label: STRUCTURE_ROLE_LABELS[k] })), canManage: canManage(auth),
        items: rows.map((r) => {
          const cs = d.contracts.filter((c) => c.structureId === r.id);
          return { ...r, kindLabel: STRUCTURE_KIND_LABELS[r.kind as keyof typeof STRUCTURE_KIND_LABELS] ?? r.kind, ownerName: users.find((u) => u.id === r.ownerId)?.name ?? null, accounts: d.members.filter((m) => m.structureId === r.id).length, contracts: cs.length, monthlyCents: cs.reduce((t, c) => t + (c.stage === 'arquivado' ? 0 : c.monthlyCents ?? 0), 0) };
        }),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/structures', summary: 'Cria uma estrutura (programa, projeto, rede, consórcio, convênio, grupo econômico)', tag: 'Clientes', module: 'clientes', body: Body,
    handler: async ({ app, auth, body, req, reply }) => {
      guard(auth);
      if (await nameTaken(app.db, auth.tenantId, body.name)) throw unprocessable('Já existe uma estrutura com esse nome.', [{ path: 'name', message: 'Duplicado' }]);
      const [r] = await app.db.insert(s.accountStructures).values({ tenantId: auth.tenantId, ...body, createdBy: auth.userId }).returning({ id: s.accountStructures.id });
      await audit(app.db, req, { action: 'structure.create', entityType: 'structure', entityId: r!.id, metadata: body });
      reply.code(201);
      return { id: r!.id };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/structures/:id', summary: 'Edita a estrutura (nome, tipo, descrição, responsável) ou a desativa', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: Body.partial().extend({ active: z.boolean().optional(), rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body, req }) => {
      guard(auth);
      const st = await loadStructure(app.db, auth, params.id);
      if (st.rowVersion !== body.rowVersion) throw conflict(st.rowVersion);
      if (body.name && await nameTaken(app.db, auth.tenantId, body.name, st.id)) throw unprocessable('Já existe uma estrutura com esse nome.', [{ path: 'name', message: 'Duplicado' }]);
      const { rowVersion: _rv, ...rest } = body;
      const [u] = await app.db.update(s.accountStructures).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.accountStructures.rowVersion} + 1` }).where(eq(s.accountStructures.id, st.id)).returning({ rowVersion: s.accountStructures.rowVersion });
      await audit(app.db, req, { action: 'structure.update', entityType: 'structure', entityId: st.id, metadata: rest });
      return { rowVersion: u!.rowVersion };
    },
  }),
  defineRoute({
    method: 'GET', url: '/structures/:id', summary: 'Estrutura com as contas (e o papel de cada uma), os contratos vinculados e contratos das contas ainda fora dela', tag: 'Clientes', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const st = await loadStructure(app.db, auth, params.id);
      const d = await structureDetail(app.db, auth, [st.id]);
      const linked = new Set(d.contracts.map((c) => c.id));
      const v = s.contractVersions;
      const memberIds = d.members.filter((m) => m.visible).map((m) => m.contactId);
      const suggested = memberIds.length && seesContracts(auth) ? (await app.db.select({ id: s.contracts.id, code: s.contracts.code, clientName: s.contacts.name, number: v.number, object: v.object, monthlyCents: v.monthlyCents, stage: s.contracts.stage })
        .from(s.contracts).innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion))).innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId))
        .where(and(inArray(s.contracts.contactId, memberIds), contractScope(auth), sql`${s.contracts.stage} <> 'arquivado'`)).limit(100)).filter((c) => !linked.has(c.id)) : [];
      const [owner] = st.ownerId ? await app.db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, st.ownerId)).limit(1) : [];
      return {
        ...st, kindLabel: STRUCTURE_KIND_LABELS[st.kind as keyof typeof STRUCTURE_KIND_LABELS] ?? st.kind, ownerName: owner?.name ?? null, canManage: canManage(auth), seesContracts: seesContracts(auth),
        roles: STRUCTURE_ROLES.map((k) => ({ key: k, label: STRUCTURE_ROLE_LABELS[k] })),
        members: d.members, contracts: d.contracts, hiddenContracts: d.hiddenContracts, suggestedContracts: suggested,
        monthlyCents: d.contracts.reduce((t, c) => t + (c.stage === 'arquivado' ? 0 : c.monthlyCents ?? 0), 0),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/structures/:id/members', summary: 'Vincula uma conta à estrutura, com o papel dela (órgão gestor, participante, executor…)', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: z.object({ contactId: z.string().uuid(), role: z.enum(STRUCTURE_ROLES).default('participante'), notes: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const st = await loadStructure(app.db, auth, params.id);
      if (!st.active) throw unprocessable('Estrutura desativada: reative antes de vincular.');
      await assertAccount(app.db, auth, body.contactId);
      const [dup] = await app.db.select({ id: s.structureMembers.id }).from(s.structureMembers).where(and(eq(s.structureMembers.structureId, st.id), eq(s.structureMembers.contactId, body.contactId), eq(s.structureMembers.active, true))).limit(1);
      if (dup) throw unprocessable('Esta conta já está nesta estrutura.');
      const [r] = await app.db.insert(s.structureMembers).values({ tenantId: auth.tenantId, structureId: st.id, contactId: body.contactId, role: body.role, notes: body.notes ?? null, createdBy: auth.userId }).returning({ id: s.structureMembers.id });
      await audit(app.db, req, { action: 'structure.member', entityType: 'structure', entityId: st.id, metadata: { contactId: body.contactId, role: body.role } });
      reply.code(201);
      return { id: r!.id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/structure-members/:id/remove', summary: 'Desvincula a conta da estrutura (fica no histórico, com o motivo)', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: z.object({ reason: z.string().trim().min(3).max(300) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [m] = await app.db.select().from(s.structureMembers).where(and(eq(s.structureMembers.id, params.id), eq(s.structureMembers.tenantId, auth.tenantId), eq(s.structureMembers.active, true))).limit(1);
      if (!m) throw notFound('Vínculo não encontrado.');
      await assertAccount(app.db, auth, m.contactId);
      await app.db.update(s.structureMembers).set({ active: false, removedBy: auth.userId, removedAt: new Date(), removedReason: body.reason }).where(eq(s.structureMembers.id, m.id));
      await audit(app.db, req, { action: 'structure.member_remove', entityType: 'structure', entityId: m.structureId, metadata: { contactId: m.contactId, reason: body.reason } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/structures/:id/contracts', summary: 'Vincula um contrato à estrutura', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: z.object({ contractId: z.string().uuid(), notes: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const st = await loadStructure(app.db, auth, params.id);
      if (!st.active) throw unprocessable('Estrutura desativada: reative antes de vincular.');
      if (!seesContracts(auth)) throw forbidden('Seu perfil não acessa contratos.');
      const c = await loadContract(app.db, auth, body.contractId);
      const [dup] = await app.db.select({ id: s.structureContracts.id }).from(s.structureContracts).where(and(eq(s.structureContracts.structureId, st.id), eq(s.structureContracts.contractId, c.id), eq(s.structureContracts.active, true))).limit(1);
      if (dup) throw unprocessable('Este contrato já está nesta estrutura.');
      const [r] = await app.db.insert(s.structureContracts).values({ tenantId: auth.tenantId, structureId: st.id, contractId: c.id, notes: body.notes ?? null, createdBy: auth.userId }).returning({ id: s.structureContracts.id });
      await audit(app.db, req, { action: 'structure.contract', entityType: 'structure', entityId: st.id, metadata: { contractId: c.id } });
      reply.code(201);
      return { id: r!.id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/structure-contracts/:id/remove', summary: 'Desvincula o contrato da estrutura (fica no histórico, com o motivo)', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: z.object({ reason: z.string().trim().min(3).max(300) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [l] = await app.db.select().from(s.structureContracts).where(and(eq(s.structureContracts.id, params.id), eq(s.structureContracts.tenantId, auth.tenantId), eq(s.structureContracts.active, true))).limit(1);
      if (!l) throw notFound('Vínculo não encontrado.');
      await loadContract(app.db, auth, l.contractId);
      await app.db.update(s.structureContracts).set({ active: false, removedBy: auth.userId, removedAt: new Date(), removedReason: body.reason }).where(eq(s.structureContracts.id, l.id));
      await audit(app.db, req, { action: 'structure.contract_remove', entityType: 'structure', entityId: l.structureId, metadata: { contractId: l.contractId, reason: body.reason } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/accounts/:id/structures', summary: 'Estruturas a que a conta pertence (com as outras contas e os contratos de cada uma) e as estruturas disponíveis para vincular', tag: 'Clientes', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      const mine = await app.db.select({ structureId: s.structureMembers.structureId }).from(s.structureMembers).where(and(eq(s.structureMembers.contactId, params.id), eq(s.structureMembers.active, true)));
      const all = await app.db.select({ id: s.accountStructures.id, name: s.accountStructures.name, kind: s.accountStructures.kind, description: s.accountStructures.description, active: s.accountStructures.active })
        .from(s.accountStructures).where(eq(s.accountStructures.tenantId, auth.tenantId)).orderBy(asc(s.accountStructures.name));
      const ids = mine.map((m) => m.structureId);
      const d = await structureDetail(app.db, auth, ids);
      return {
        roles: STRUCTURE_ROLES.map((k) => ({ key: k, label: STRUCTURE_ROLE_LABELS[k] })),
        items: all.filter((x) => ids.includes(x.id)).map((x) => ({
          ...x, kindLabel: STRUCTURE_KIND_LABELS[x.kind as keyof typeof STRUCTURE_KIND_LABELS] ?? x.kind,
          me: d.members.find((m) => m.structureId === x.id && m.contactId === params.id) ?? null,
          members: d.members.filter((m) => m.structureId === x.id), contracts: d.contracts.filter((c) => c.structureId === x.id),
        })),
        available: all.filter((x) => x.active && !ids.includes(x.id)).map((x) => ({ id: x.id, name: x.name, kindLabel: STRUCTURE_KIND_LABELS[x.kind as keyof typeof STRUCTURE_KIND_LABELS] ?? x.kind })),
      };
    },
  }),
];
