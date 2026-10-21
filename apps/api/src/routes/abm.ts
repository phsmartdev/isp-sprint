/** Marketing → ABM: contas-alvo sobre os contatos/clientes existentes (sem duplicar cadastro) e catálogo de produtos. */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  ABM_ORIGINS, ABM_PRIORITIES, ABM_STATUSES, ABM_TIERS, COMMERCIAL_STATUSES, abmTransition, cnpjRoot, commercialStatus, dedupMatches, dedupSearchTerms, onlyDigits,
  type AbmStatus, type CommercialStatus,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { assertAssignableUser, ownerScope } from '../services/scope';

const vis = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.abmAccounts.tenantId, ownerId: s.abmAccounts.ownerId });
const contactVisible = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ACTIVE_CONTRACT = ['implantacao', 'vigente', 'renovacao', 'reajuste'];
const ENDED_CONTRACT = ['encerramento', 'arquivado'];

/** Fatos reais de cada conta para o status comercial derivado e os números da lista. */
async function factsOf(db: DbOrTx, auth: AuthContext, contactIds: string[]) {
  if (!contactIds.length) return new Map<string, ReturnType<typeof emptyFacts>>();
  const ids = sql.join(contactIds.map((x) => sql`${x}::uuid`), sql`, `);
  const rows = await db.execute<{ id: string; lifecycle: string | null; active_ct: number; ended_ct: number; open_opps: number; open_value: string | number; pending: number; last_at: string | null; leads: number }>(sql`
    select c.id,
      (select cu.lifecycle from customers cu where cu.contact_id = c.id limit 1) as lifecycle,
      (select count(*)::int from contracts k where k.contact_id = c.id and k.stage in (${sql.join(ACTIVE_CONTRACT.map((x) => sql`${x}`), sql`, `)})) as active_ct,
      (select count(*)::int from contracts k where k.contact_id = c.id and k.stage in (${sql.join(ENDED_CONTRACT.map((x) => sql`${x}`), sql`, `)})) as ended_ct,
      (select count(*)::int from opportunities o where o.contact_id = c.id and o.deleted_at is null and o.stage not in ('ganha', 'perdida')) as open_opps,
      (select coalesce(sum(o.value_cents), 0) from opportunities o where o.contact_id = c.id and o.deleted_at is null and o.stage not in ('ganha', 'perdida')) as open_value,
      (select count(*)::int from activities a where a.contact_id = c.id and a.deleted_at is null and a.status not in ('concluida', 'cancelada')) as pending,
      (select to_char(max(a.completed_at) at time zone ${auth.timezone}, 'YYYY-MM-DD') from activities a where a.contact_id = c.id and a.deleted_at is null and a.status = 'concluida') as last_at,
      (select count(*)::int from leads l where l.contact_id = c.id) as leads
    from contacts c where c.id in (${ids})`);
  const today = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: auth.timezone }).format(new Date())}T12:00:00Z`).getTime();
  const out = new Map<string, ReturnType<typeof emptyFacts>>();
  for (const r of rows.rows) {
    const days = r.last_at ? Math.round((today - new Date(`${r.last_at}T12:00:00Z`).getTime()) / 86_400_000) : null;
    const f = { customerLifecycle: r.lifecycle, activeContracts: r.active_ct, endedContracts: r.ended_ct, openOpportunities: r.open_opps, daysSinceInteraction: days, prospecting: r.leads > 0 || r.pending > 0 };
    out.set(r.id, { ...f, commercial: commercialStatus(f), openValueCents: Number(r.open_value), pendingActivities: r.pending, lastContactOn: r.last_at });
  }
  return out;
}
const emptyFacts = () => ({ customerLifecycle: null as string | null, activeContracts: 0, endedContracts: 0, openOpportunities: 0, daysSinceInteraction: null as number | null, prospecting: false, commercial: 'identificada' as CommercialStatus, openValueCents: 0, pendingActivities: 0, lastContactOn: null as string | null });

const event = (db: DbOrTx, auth: AuthContext, abmId: string, type: string, payload: Record<string, unknown>) => db.insert(s.abmEvents).values({ tenantId: auth.tenantId, abmId, type, payload, actorId: auth.userId });

/** Candidatos a duplicidade entre as contas da empresa (todas, não só a carteira: duplicar é problema da empresa). */
async function dedupFor(db: DbOrTx, auth: AuthContext, input: { name: string; document?: string | null; city?: string | null }) {
  const terms = dedupSearchTerms(input.name);
  const doc = onlyDigits(input.document);
  const root = cnpjRoot(input.document);
  const conds: SQL[] = terms.map((t) => sql`translate(lower(${s.contacts.name}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${`%${t}%`}`);
  if (doc) conds.push(sql`regexp_replace(coalesce(${s.contacts.document}, ''), '[^0-9]', '', 'g') = ${doc}`);
  if (root) conds.push(sql`left(regexp_replace(coalesce(${s.contacts.document}, ''), '[^0-9]', '', 'g'), 8) = ${root}`);
  if (!conds.length) return [];
  const rows = await db.select({ id: s.contacts.id, name: s.contacts.name, document: s.contacts.document, city: s.contacts.city, ownerId: s.contacts.ownerId, abmId: s.abmAccounts.id })
    .from(s.contacts).leftJoin(s.abmAccounts, eq(s.abmAccounts.contactId, s.contacts.id))
    .where(and(eq(s.contacts.tenantId, auth.tenantId), sql`${s.contacts.deletedAt} is null`, or(...conds))).limit(200);
  const matches = dedupMatches(input, rows);
  const visible = new Set((await db.select({ id: s.contacts.id }).from(s.contacts).where(and(contactVisible(auth), inArray(s.contacts.id, matches.length ? matches.map((m) => m.id) : ['00000000-0000-0000-0000-000000000000'])))).map((r) => r.id));
  return matches.map((m) => ({ ...m, inAbm: !!rows.find((r) => r.id === m.id)?.abmId, visible: visible.has(m.id), document: visible.has(m.id) ? m.document : null }));
}

const AbmFields = z.object({
  tier: z.enum(ABM_TIERS).optional(), priority: z.enum(ABM_PRIORITIES).optional(), ownerId: z.string().uuid().optional(),
  reason: z.string().trim().min(5).max(1000).optional(), objective: z.string().trim().max(500).nullable().optional(), origin: z.enum(ABM_ORIGINS).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(), nextStep: z.string().trim().max(300).nullable().optional(), nextStepOn: isoDate.nullable().optional(),
});

export const abmRoutes = [
  defineRoute({
    method: 'GET', url: '/abm', summary: 'Contas do programa ABM (novas e existentes) com status ABM, status comercial derivado, oportunidades, pendências e último contato', tag: 'Marketing', module: 'clientes',
    query: z.object({ status: z.enum(ABM_STATUSES).optional(), priority: z.enum(ABM_PRIORITIES).optional(), commercial: z.enum(COMMERCIAL_STATUSES).optional(), tier: z.enum(ABM_TIERS).optional(), ownerId: z.string().uuid().optional(), q: z.string().max(100).optional() }),
    handler: async ({ app, auth, query: q }) => {
      const w: SQL[] = [vis(auth)];
      if (q.status) w.push(eq(s.abmAccounts.status, q.status));
      if (q.priority) w.push(eq(s.abmAccounts.priority, q.priority));
      if (q.tier) w.push(eq(s.abmAccounts.tier, q.tier));
      if (q.ownerId) w.push(eq(s.abmAccounts.ownerId, q.ownerId));
      if (q.q) w.push(ilike(s.contacts.name, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`));
      const rows = await app.db.select({ a: s.abmAccounts, name: s.contacts.name, segment: s.contacts.segment, city: s.contacts.city, nature: s.contacts.nature, ownerName: s.users.name })
        .from(s.abmAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.abmAccounts.contactId)).innerJoin(s.users, eq(s.users.id, s.abmAccounts.ownerId))
        .where(and(...w)).orderBy(sql`case ${s.abmAccounts.priority} when 'critica' then 0 when 'alta' then 1 when 'media' then 2 else 3 end`, asc(s.contacts.name)).limit(500);
      const facts = await factsOf(app.db, auth, rows.map((r) => r.a.contactId));
      const items = rows.map((r) => {
        const f = facts.get(r.a.contactId) ?? emptyFacts();
        return { ...r.a, name: r.name, segment: r.segment, city: r.city, nature: r.nature, ownerName: r.ownerName, commercial: f.commercial, isCustomer: !!f.customerLifecycle && f.customerLifecycle !== 'prospect', activeContracts: f.activeContracts, openOpportunities: f.openOpportunities, openValueCents: f.openValueCents, pendingActivities: f.pendingActivities, lastContactAt: f.lastContactOn };
      }).filter((x) => !q.commercial || x.commercial === q.commercial);
      const counts = await app.db.select({ status: s.abmAccounts.status, n: sql<number>`count(*)::int` }).from(s.abmAccounts).where(vis(auth)).groupBy(s.abmAccounts.status);
      return { items, counts: Object.fromEntries(ABM_STATUSES.map((st) => [st, counts.find((c) => c.status === st)?.n ?? 0])) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/abm/dedup', summary: 'Possíveis duplicidades antes de cadastrar uma organização nova (CNPJ, raiz do CNPJ, nome parecido, cidade)', tag: 'Marketing', module: 'clientes',
    query: z.object({ name: z.string().trim().min(2).max(200), document: z.string().max(30).optional(), city: z.string().max(120).optional() }),
    handler: async ({ app, auth, query: q }) => ({ items: await dedupFor(app.db, auth, q) }),
  }),
  defineRoute({
    method: 'GET', url: '/abm/by-contact/:id', summary: 'Situação da conta no ABM (para o botão "Adicionar ao ABM" na ficha da conta)', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [a] = await app.db.select({ id: s.abmAccounts.id, status: s.abmAccounts.status, priority: s.abmAccounts.priority }).from(s.abmAccounts).where(and(eq(s.abmAccounts.contactId, params.id), eq(s.abmAccounts.tenantId, auth.tenantId))).limit(1);
      return { abm: a ?? null };
    },
  }),
  defineRoute({
    method: 'GET', url: '/abm/:id', summary: 'Conta do ABM com status comercial, oportunidades e histórico', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [r] = await app.db.select({ a: s.abmAccounts, name: s.contacts.name, segment: s.contacts.segment, city: s.contacts.city, nature: s.contacts.nature, document: s.contacts.document, ownerName: s.users.name }).from(s.abmAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.abmAccounts.contactId)).innerJoin(s.users, eq(s.users.id, s.abmAccounts.ownerId)).where(and(eq(s.abmAccounts.id, params.id), vis(auth))).limit(1);
      if (!r) throw notFound('Conta não encontrada no ABM.');
      const [opps, events, facts] = await Promise.all([
        app.db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, valueCents: s.opportunities.valueCents, ownerName: s.users.name }).from(s.opportunities).innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId)).where(and(eq(s.opportunities.contactId, r.a.contactId), sql`${s.opportunities.deletedAt} is null`)).orderBy(desc(s.opportunities.createdAt)).limit(50),
        app.db.select({ id: s.abmEvents.id, type: s.abmEvents.type, payload: s.abmEvents.payload, createdAt: s.abmEvents.createdAt, actorName: s.users.name }).from(s.abmEvents).leftJoin(s.users, eq(s.users.id, s.abmEvents.actorId)).where(eq(s.abmEvents.abmId, r.a.id)).orderBy(desc(s.abmEvents.createdAt)),
        factsOf(app.db, auth, [r.a.contactId]),
      ]);
      const f = facts.get(r.a.contactId) ?? emptyFacts();
      return { ...r.a, name: r.name, segment: r.segment, city: r.city, nature: r.nature, document: r.document, ownerName: r.ownerName, commercial: f.commercial, facts: f, opportunities: opps, events };
    },
  }),
  defineRoute({
    method: 'POST', url: '/abm', summary: 'Adicionar ao ABM: conta já cadastrada entra no programa (reaproveita tudo; não cria cadastro novo)', tag: 'Marketing', module: 'clientes',
    body: AbmFields.extend({ contactId: z.string().uuid(), reason: z.string().trim().min(5).max(1000), status: z.enum(['candidata', 'selecionada']).default('candidata') }),
    handler: async ({ app, auth, body, reply }) => app.db.transaction(async (tx) => {
      const [c] = await tx.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.id, body.contactId), contactVisible(auth))).limit(1);
      if (!c) throw unprocessable('Conta não encontrada na sua carteira.', [{ path: 'contactId', message: 'Escolha uma conta da lista' }]);
      const ownerId = body.ownerId ?? auth.userId;
      await assertAssignableUser(tx, auth, 'clientes', ownerId);
      const [dup] = await tx.select({ id: s.abmAccounts.id }).from(s.abmAccounts).where(and(eq(s.abmAccounts.tenantId, auth.tenantId), eq(s.abmAccounts.contactId, body.contactId))).limit(1);
      if (dup) throw unprocessable('Esta conta já está no ABM.');
      const [a] = await tx.insert(s.abmAccounts).values({ tenantId: auth.tenantId, contactId: body.contactId, tier: body.tier ?? '1_muitos', status: body.status, ownerId, priority: body.priority ?? 'media', reason: body.reason, objective: body.objective ?? null, origin: body.origin ?? 'base_existente', notes: body.notes ?? null, nextStep: body.nextStep ?? null, nextStepOn: body.nextStepOn ?? null, createdBy: auth.userId }).returning();
      await event(tx, auth, a!.id, 'criada', { origin: 'conta_existente', status: body.status, reason: body.reason });
      reply.code(201);
      return a!;
    }),
  }),
  defineRoute({
    method: 'POST', url: '/abm/new-account', summary: 'Nova organização para prospecção: confere duplicidades, cria a conta (cadastro único) e já a coloca no ABM', tag: 'Marketing', module: 'clientes',
    body: AbmFields.extend({
      name: z.string().trim().min(3).max(200), nature: z.enum(['publica', 'privada']).nullable().default(null), segment: z.enum(['empresarial', 'governamental', 'institucional', 'residencial']).default('empresarial'),
      city: z.string().trim().max(120).nullable().default(null), document: z.string().trim().max(30).nullable().default(null), reason: z.string().trim().min(5).max(1000),
      /** duplicidades vistas e descartadas por quem cadastra (com justificativa) */
      ignoreDuplicates: z.object({ ids: z.array(z.string().uuid()).max(20), justification: z.string().trim().min(10).max(500) }).optional(),
    }),
    handler: async ({ app, auth, body, reply }) => app.db.transaction(async (tx) => {
      const ownerId = body.ownerId ?? auth.userId;
      await assertAssignableUser(tx, auth, 'clientes', ownerId);
      const doc = onlyDigits(body.document);
      if (body.document && doc.length !== 11 && doc.length !== 14) throw unprocessable('CNPJ/CPF incompleto: deixe em branco se ainda não souber.', [{ path: 'document', message: '11 ou 14 dígitos' }]);
      const matches = await dedupFor(tx, auth, body);
      // mesmo CNPJ nunca vira outra conta; nome parecido/raiz exige que a pessoa diga por que não é a mesma
      const exact = matches.find((m) => m.reasons.includes('mesmo CNPJ/CPF'));
      if (exact) throw unprocessable(`Já existe uma conta com este CNPJ/CPF: ${exact.name}. Use "Adicionar ao ABM" nela.`, [{ path: 'document', message: 'Duplicado' }]);
      const pending = matches.filter((m) => !body.ignoreDuplicates?.ids.includes(m.id));
      if (pending.length) { const err = unprocessable('Encontramos contas parecidas. Vincule a uma delas ou confirme que é outra organização.', [{ path: 'name', message: 'Possível duplicidade' }]); err.extra = { ...err.extra, duplicates: pending } as typeof err.extra; throw err; }
      const [c] = await tx.insert(s.contacts).values({ tenantId: auth.tenantId, name: body.name, segment: body.segment, nature: body.nature, city: body.city, document: body.document || null, ownerId, createdBy: auth.userId }).returning({ id: s.contacts.id });
      const [a] = await tx.insert(s.abmAccounts).values({ tenantId: auth.tenantId, contactId: c!.id, tier: body.tier ?? '1_muitos', status: 'candidata', ownerId, priority: body.priority ?? 'media', reason: body.reason, objective: body.objective ?? null, origin: body.origin ?? null, notes: body.notes ?? null, nextStep: body.nextStep ?? null, nextStepOn: body.nextStepOn ?? null, createdBy: auth.userId }).returning();
      await event(tx, auth, a!.id, 'criada', { origin: 'nova_conta', reason: body.reason, ...(body.ignoreDuplicates?.ids.length ? { ignoredDuplicates: body.ignoreDuplicates.ids, justification: body.ignoreDuplicates.justification } : {}) });
      reply.code(201);
      return { ...a!, contactId: c!.id };
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/abm/:id', summary: 'Atualiza status ABM (transições; pausar/encerrar com motivo), prioridade, responsável, objetivo, origem e próximo passo — tudo no histórico', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: AbmFields.extend({ rowVersion: z.number().int(), status: z.enum(ABM_STATUSES).optional(), statusReason: z.string().trim().max(1000).optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [a] = await tx.select().from(s.abmAccounts).where(and(eq(s.abmAccounts.id, params.id), vis(auth))).limit(1);
      if (!a) throw notFound('Conta não encontrada no ABM.');
      if (a.rowVersion !== body.rowVersion) throw conflict(a.rowVersion);
      if (body.ownerId && body.ownerId !== a.ownerId) await assertAssignableUser(tx, auth, 'clientes', body.ownerId);
      if (body.status && body.status !== a.status) {
        const err = abmTransition(a.status as AbmStatus, body.status, body.statusReason);
        if (err) throw unprocessable(err, [{ path: 'status', message: err }]);
      }
      const { rowVersion: _rv, statusReason, ...rest } = body;
      const changed = Object.entries(rest).filter(([k, v]) => v !== undefined && v !== (a as Record<string, unknown>)[k]).map(([k]) => k);
      const statusChanged = !!rest.status && rest.status !== a.status;
      await tx.update(s.abmAccounts).set({ ...rest, ...(statusChanged ? { statusReason: statusReason ?? null } : {}), updatedAt: new Date(), rowVersion: sql`${s.abmAccounts.rowVersion} + 1` }).where(eq(s.abmAccounts.id, a.id));
      if (changed.length) await event(tx, auth, a.id, statusChanged ? 'situacao' : 'alterada', { fields: changed, from: Object.fromEntries(changed.map((k) => [k, (a as Record<string, unknown>)[k]])), to: Object.fromEntries(changed.map((k) => [k, (rest as Record<string, unknown>)[k]])), ...(statusChanged && statusReason ? { reason: statusReason } : {}) });
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
