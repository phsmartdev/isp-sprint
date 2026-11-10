/**
 * Relações entre contas (CRM e ABM): quem é matriz/filial, órgão superior/vinculado, membro de consórcio, parceira,
 * fornecedora, concorrente ou influencia quem. Registradas por pessoa; o sistema só sugere (mesma raiz de CNPJ e
 * pessoas em comum). Conta fora da carteira de quem consulta aparece sem nome.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ACCOUNT_RELATION_KINDS, ACCOUNT_RELATION_LABELS, accountRelationError, cnpjRoot, relationComponent, type AccountRel, type AccountRelationKind } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { ownerScope } from '../services/scope';
import { assertAccount } from './stakeholders';

const visible = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });

async function activeRels(db: DbOrTx, tenantId: string): Promise<(AccountRel & { notes: string | null; createdBy: string | null; createdAt: Date })[]> {
  const rows = await db.select().from(s.accountRelations).where(and(eq(s.accountRelations.tenantId, tenantId), eq(s.accountRelations.active, true)));
  return rows.map((r) => ({ id: r.id, fromId: r.fromContactId, toId: r.toContactId, kind: r.kind as AccountRelationKind, notes: r.notes, createdBy: r.createdBy, createdAt: r.createdAt }));
}

/** Nomes das contas (só as visíveis para quem consulta) e o id ABM, quando a conta está no programa. */
async function accountsInfo(db: DbOrTx, auth: AuthContext, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; segment: string; city: string | null; abmId: string | null }>();
  const rows = await db.select({ id: s.contacts.id, name: s.contacts.name, segment: s.contacts.segment, city: s.contacts.city, abmId: s.abmAccounts.id })
    .from(s.contacts).leftJoin(s.abmAccounts, eq(s.abmAccounts.contactId, s.contacts.id)).where(and(inArray(s.contacts.id, ids), visible(auth)));
  return new Map(rows.map((r) => [r.id, { name: r.name, segment: r.segment, city: r.city, abmId: r.abmId }]));
}

/** Sugestões: mesma raiz de CNPJ (grupo econômico) e pessoas em comum (stakeholders ativos nas duas contas). */
async function suggestions(db: DbOrTx, auth: AuthContext, contactId: string, related: Set<string>) {
  const out = new Map<string, { contactId: string; name: string; reasons: string[]; kind: AccountRelationKind }>();
  const [me] = await db.select({ document: s.contacts.document }).from(s.contacts).where(eq(s.contacts.id, contactId)).limit(1);
  const root = cnpjRoot(me?.document);
  if (root) {
    const same = await db.select({ id: s.contacts.id, name: s.contacts.name, document: s.contacts.document }).from(s.contacts)
      .where(and(visible(auth), ne(s.contacts.id, contactId), sql`regexp_replace(coalesce(${s.contacts.document}, ''), '\\D', '', 'g') like ${`${root}%`}`)).limit(20);
    for (const c of same) if (!related.has(c.id) && cnpjRoot(c.document) === root) out.set(c.id, { contactId: c.id, name: c.name, reasons: [`Mesma raiz de CNPJ (${root.slice(0, 2)}.${root.slice(2, 5)}.${root.slice(5, 8)})`], kind: 'matriz' });
  }
  const mine = await db.select({ personId: s.accountStakeholders.personId }).from(s.accountStakeholders).where(and(eq(s.accountStakeholders.contactId, contactId), eq(s.accountStakeholders.active, true)));
  if (mine.length) {
    const shared = await db.select({ contactId: s.accountStakeholders.contactId, account: s.contacts.name, person: s.people.name }).from(s.accountStakeholders)
      .innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).innerJoin(s.contacts, eq(s.contacts.id, s.accountStakeholders.contactId))
      .where(and(inArray(s.accountStakeholders.personId, mine.map((m) => m.personId)), ne(s.accountStakeholders.contactId, contactId), eq(s.accountStakeholders.active, true), visible(auth))).limit(100);
    for (const r of shared) {
      if (related.has(r.contactId)) continue;
      const cur = out.get(r.contactId) ?? { contactId: r.contactId, name: r.account, reasons: [], kind: 'outro' as AccountRelationKind };
      const tag = 'Pessoas em comum: ';
      const i = cur.reasons.findIndex((x) => x.startsWith(tag));
      if (i < 0) cur.reasons.push(`${tag}${r.person}`); else if (!cur.reasons[i]!.includes(r.person)) cur.reasons[i] = `${cur.reasons[i]}, ${r.person}`;
      out.set(r.contactId, cur);
    }
  }
  return [...out.values()];
}

export const accountRelationRoutes = [
  defineRoute({
    method: 'GET', url: '/accounts/:id/account-relations', summary: 'Contas relacionadas a esta (diretas), o mapa do grupo (todas as contas ligadas, até 80) e sugestões (mesma raiz de CNPJ, pessoas em comum)', tag: 'Clientes', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const acc = await assertAccount(app.db, auth, params.id);
      const rels = await activeRels(app.db, auth.tenantId);
      const comp = relationComponent(params.id, rels);
      const compRels = rels.filter((r) => comp.has(r.fromId) && comp.has(r.toId));
      const info = await accountsInfo(app.db, auth, [...comp]);
      const users = compRels.length ? await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId)) : [];
      const node = (id: string) => { const i = info.get(id); return { contactId: id, name: i?.name ?? 'Conta fora da sua carteira', visible: !!i, segment: i?.segment ?? null, city: i?.city ?? null, abmId: i?.abmId ?? null }; };
      const direct = compRels.filter((r) => r.fromId === params.id || r.toId === params.id).map((r) => {
        const out = r.fromId === params.id;
        return { id: r.id, kind: r.kind, direction: out ? 'saida' : 'entrada', label: ACCOUNT_RELATION_LABELS[r.kind][out ? 'out' : 'in'], group: ACCOUNT_RELATION_LABELS[r.kind].group, other: node(out ? r.toId : r.fromId), notes: r.notes, createdByName: users.find((u) => u.id === r.createdBy)?.name ?? null, createdAt: r.createdAt };
      });
      const related = new Set([params.id, ...direct.map((d) => d.other.contactId)]);
      return {
        account: { contactId: acc.id, name: acc.name },
        kinds: ACCOUNT_RELATION_KINDS.map((k) => ({ key: k, ...ACCOUNT_RELATION_LABELS[k] })),
        items: direct,
        network: { nodes: [...comp].map(node), edges: compRels.map((r) => ({ id: r.id, fromId: r.fromId, toId: r.toId, kind: r.kind })) },
        suggestions: await suggestions(app.db, auth, params.id, related),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/accounts/:id/account-relations', summary: 'Registra a relação desta conta com outra (direção: esta conta → outra; "inverter" grava ao contrário)', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: z.object({ otherContactId: z.string().uuid(), kind: z.enum(ACCOUNT_RELATION_KINDS), inverse: z.boolean().default(false), notes: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      await assertAccount(tx, auth, params.id);
      await assertAccount(tx, auth, body.otherContactId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`account-relations:${auth.tenantId}`}))`);
      const fromId = body.inverse ? body.otherContactId : params.id, toId = body.inverse ? params.id : body.otherContactId;
      const err = accountRelationError({ fromId, toId, kind: body.kind }, await activeRels(tx, auth.tenantId));
      if (err) throw unprocessable(err);
      const [r] = await tx.insert(s.accountRelations).values({ tenantId: auth.tenantId, fromContactId: fromId, toContactId: toId, kind: body.kind, notes: body.notes ?? null, createdBy: auth.userId }).returning({ id: s.accountRelations.id });
      await audit(tx, req, { action: 'account.relation', entityType: 'contact', entityId: params.id, metadata: { relationId: r!.id, fromId, toId, kind: body.kind } });
      reply.code(201);
      return { id: r!.id };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/account-relations/:id/remove', summary: 'Remove a relação entre contas (fica no histórico, com o motivo)', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: z.object({ reason: z.string().trim().min(3).max(300) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [r] = await app.db.select().from(s.accountRelations).where(and(eq(s.accountRelations.id, params.id), eq(s.accountRelations.tenantId, auth.tenantId), eq(s.accountRelations.active, true))).limit(1);
      if (!r) throw notFound('Relação não encontrada.');
      await assertAccount(app.db, auth, r.fromContactId);
      await app.db.update(s.accountRelations).set({ active: false, removedBy: auth.userId, removedAt: new Date(), removedReason: body.reason }).where(eq(s.accountRelations.id, r.id));
      await audit(app.db, req, { action: 'account.relation_remove', entityType: 'contact', entityId: r.fromContactId, metadata: { relationId: r.id, reason: body.reason } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/abm/account-relations', summary: 'Mapa das relações entre as contas do ABM (e as contas ligadas a elas), em grupos conectados', tag: 'Marketing', module: 'clientes',
    handler: async ({ app, auth }) => {
      const abm = await app.db.select({ contactId: s.abmAccounts.contactId }).from(s.abmAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.abmAccounts.contactId)).where(and(eq(s.abmAccounts.tenantId, auth.tenantId), visible(auth)));
      const rels = await activeRels(app.db, auth.tenantId);
      const abmSet = new Set(abm.map((a) => a.contactId));
      const seen = new Set<string>(); const groups: { nodes: string[]; edges: AccountRel[] }[] = [];
      for (const a of abm) {
        if (seen.has(a.contactId)) continue;
        const comp = relationComponent(a.contactId, rels);
        comp.forEach((c) => seen.add(c));
        const edges = rels.filter((r) => comp.has(r.fromId) && comp.has(r.toId));
        if (edges.length) groups.push({ nodes: [...comp], edges });
      }
      const info = await accountsInfo(app.db, auth, [...new Set(groups.flatMap((g) => g.nodes))]);
      return {
        kinds: ACCOUNT_RELATION_KINDS.map((k) => ({ key: k, ...ACCOUNT_RELATION_LABELS[k] })),
        groups: groups.map((g) => ({
          nodes: g.nodes.map((id) => { const i = info.get(id); return { contactId: id, name: i?.name ?? 'Conta fora da sua carteira', visible: !!i, segment: i?.segment ?? null, city: i?.city ?? null, abmId: i?.abmId ?? null, inAbm: abmSet.has(id) }; }),
          edges: g.edges.map((r) => ({ id: r.id, fromId: r.fromId, toId: r.toId, kind: r.kind })),
        })).sort((a, b) => b.nodes.length - a.nodes.length),
        withoutRelations: abm.filter((a) => !seen.has(a.contactId) || !groups.some((g) => g.nodes.includes(a.contactId))).length,
      };
    },
  }),
];

