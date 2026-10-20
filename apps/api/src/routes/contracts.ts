/** Gestão de Contratos: cadastro (a partir da oportunidade), edição versionada, validação, funil, painel, calendário e relatórios. */
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  BILLING_TYPES, BILLING_TYPE_LABELS, CONTRACT_KINDS, CONTRACT_STAGES, CONTRACT_STAGE_LABELS, DEFAULT_CONTRACT_SETTINGS, LEGAL_REGIMES, ALERT_LABELS,
  SEGMENT_LABELS, addDays, daysBetween, endFromTerm, ledgerTotals, nextAnniversary, recurringBilledInPeriod, type AlertKind, type Segment,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import { audit } from '../services/audit';
import { level } from '../services/scope';
import { oppVisibility } from '../services/opportunities';
import { brl } from '../services/email';
import {
  addEvent, contractScope, contractSettingsOf, contractSummary, createTask, currentVersion, hasSector, isAdmin, loadContract, mailTo,
  newVersion, openPendencies, openProcess, sectorOwners, setStage, userById, type ContractRow, type VersionPatch,
} from '../services/contracts';
import { runContractAlerts } from '../services/contractAlerts';
import { ledgerOf } from '../services/contractLedger';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const optDay = day.nullable().optional();
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : v === '' ? null : v));
const uuid = z.string().uuid();
const Item = z.object({ planId: uuid.nullable().default(null), description: z.string().trim().min(2).max(200), qty: z.number().int().min(1).max(100_000), unitCents: z.number().int().min(0).max(10_000_000_000) });
const Guarantee = z.object({ type: z.string().trim().min(2).max(80), amountCents: z.number().int().min(0).nullable().default(null), insurer: optText(120).default(null), policy: optText(80).default(null), expiresAt: day.nullable().default(null), renewalAt: day.nullable().default(null) }).nullable();
const PublicTerms = z.object({ agency: optText(200).default(null), processNumber: optText(80).default(null), modality: optText(80).default(null), commitmentNote: optText(80).default(null), budgetLine: optText(200).default(null), extensionMaxMonths: z.number().int().min(1).max(600).nullable().default(null) }).nullable();
const VersionFields = z.object({
  number: z.string().trim().min(1).max(60),
  object: z.string().trim().min(3).max(2000),
  signedAt: optDay, startAt: optDay, endAt: optDay, termMonths: z.number().int().min(1).max(600).nullable().optional(),
  activationAt: optDay, billingStartAt: optDay, renewalAt: optDay,
  monthlyCents: z.number().int().min(0).max(10_000_000_000),
  totalCents: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
  billingDay: z.number().int().min(1).max(31).nullable().optional(),
  billingTerms: optText(2000),
  items: z.array(Item).max(50).default([]),
  guarantee: Guarantee.optional(),
  publicTerms: PublicTerms.optional(),
  adjustmentIndex: optText(60), adjustmentBaseDate: optDay, adjustmentRule: optText(1000),
  specialConditions: optText(4000),
});
const Header = z.object({
  kind: z.enum(CONTRACT_KINDS).default('privado'),
  billingType: z.enum(BILLING_TYPES).default('recorrente'),
  legalRegime: z.enum(LEGAL_REGIMES).default('privado'),
  commercialOwnerId: uuid,
  operationalOwnerId: uuid.nullable().default(null),
  csmId: uuid.nullable().default(null),
  legalLimitAt: optDay,
  nextAction: optText(300), nextActionAt: optDay,
});
const CreateBody = Header.extend({ opportunityId: uuid.nullable().default(null), contactId: uuid.nullable().default(null), initialBalanceCents: z.number().int().min(0).max(1_000_000_000_000).default(0), version: VersionFields });
const UpdateBody = Header.partial().extend({ version: VersionFields.partial().optional(), reason: z.string().trim().max(500).optional() });

/** Datas derivadas: término pelo prazo e renovação prevista no dia seguinte ao término. */
function normalizeVersion<T extends Partial<z.infer<typeof VersionFields>>>(v: T): T {
  const out = { ...v };
  if (out.startAt && out.termMonths && !out.endAt) out.endAt = endFromTerm(out.startAt, out.termMonths);
  if (out.endAt && out.renewalAt === undefined) out.renewalAt = addDays(out.endAt, 1);
  if (out.startAt && out.endAt && out.endAt < out.startAt) throw unprocessable('O término da vigência é anterior ao início.', [{ path: 'version.endAt', message: 'Término antes do início' }]);
  if (out.items?.length && out.monthlyCents === undefined) out.monthlyCents = out.items.reduce((a, i) => a + i.qty * i.unitCents, 0);
  return out;
}

const canManage = (auth: AuthContext) => isAdmin(auth) || level(auth, 'contratos') === 'total' || hasSector(auth, ['administracao', 'inteligencia_comercial', 'diretoria']);
const canEdit = (auth: AuthContext, c: ContractRow) => canManage(auth) || (c.stage === 'cadastro_validacao' && c.commercialOwnerId === auth.userId) || (level(auth, 'contratos') === 'equipe' && auth.teamMemberIds.includes(c.commercialOwnerId));

async function assertUsers(db: DbOrTx, auth: AuthContext, ids: (string | null | undefined)[]) {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return;
  const found = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, list)));
  if (new Set(found.map((f) => f.id)).size !== new Set(list).size) throw unprocessable('Responsável inválido.');
}

// ------------------------------------------------------------------ consulta das listas
const owner = alias(s.users, 'ct_owner');
const v = s.contractVersions;
const listSelect = {
  id: s.contracts.id, code: s.contracts.code, stage: s.contracts.stage, kind: s.contracts.kind, billingType: s.contracts.billingType, legalRegime: s.contracts.legalRegime,
  contactId: s.contracts.contactId, clientName: s.contacts.name, segment: s.contacts.segment, opportunityId: s.contracts.opportunityId,
  ownerId: s.contracts.commercialOwnerId, ownerName: owner.name, validatedAt: s.contracts.validatedAt, renewed: s.contracts.renewed,
  closureExpected: s.contracts.closureExpected, closureAt: s.contracts.closureAt, nextAction: s.contracts.nextAction, nextActionAt: s.contracts.nextActionAt,
  stageChangedAt: s.contracts.stageChangedAt, archivedAt: s.contracts.archivedAt, erpRef: s.contracts.erpRef,
  number: v.number, object: v.object, startAt: v.startAt, endAt: v.endAt, monthlyCents: v.monthlyCents, totalCents: v.totalCents, termMonths: v.termMonths,
  signedAt: v.signedAt, activationAt: v.activationAt, billingStartAt: v.billingStartAt, version: v.version, guarantee: v.guarantee, adjustmentBaseDate: v.adjustmentBaseDate, adjustmentIndex: v.adjustmentIndex, items: v.items,
};
function listQuery(db: DbOrTx) {
  return db.select(listSelect).from(s.contracts)
    .innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion)))
    .innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId))
    .leftJoin(owner, eq(owner.id, s.contracts.commercialOwnerId));
}
type ListRow = Awaited<ReturnType<ReturnType<typeof listQuery>['execute']>>[number];
async function decorate(db: DbOrTx, rows: ListRow[]) {
  const today = new Date().toISOString().slice(0, 10);
  const pend = await openPendencies(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, daysLeft: r.endAt ? daysBetween(today, r.endAt) : null, pendencies: pend.get(r.id) ?? { alerts: 0, overdue: 0, steps: 0 } }));
}

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z.enum(CONTRACT_STAGES).optional(),
  kind: z.enum(CONTRACT_KINDS).optional(),
  billingType: z.enum(BILLING_TYPES).optional(),
  ownerId: uuid.optional(),
  status: z.enum(['ativos', 'encerrados', 'todos']).default('todos'),
  expiringDays: z.coerce.number().int().min(1).max(730).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export const contractRoutes = [
  defineRoute({
    method: 'GET',
    url: '/contracts/prefill',
    summary: 'Dados da oportunidade fechada para iniciar o cadastro do contrato (sem copiar o cliente)',
    tag: 'Contratos',
    module: 'contratos',
    query: z.object({ opportunityId: uuid }),
    handler: async ({ app, auth, query }) => {
      const [o] = await app.db
        .select({ id: s.opportunities.id, code: s.opportunities.code, stage: s.opportunities.stage, title: s.opportunities.title, contactId: s.opportunities.contactId, customerId: s.opportunities.customerId, ownerId: s.opportunities.ownerId, planId: s.opportunities.planId, valueCents: s.opportunities.valueCents, wonAt: s.opportunities.wonAt, notes: s.opportunities.notes, contactName: s.contacts.name, document: s.contacts.document, segment: s.contacts.segment, email: s.contacts.email, phone: s.contacts.phone })
        .from(s.opportunities).innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
        .where(and(eq(s.opportunities.id, query.opportunityId), eq(s.opportunities.tenantId, auth.tenantId), canManage(auth) ? undefined : oppVisibility(auth))).limit(1);
      if (!o) throw notFound('Oportunidade não encontrada.');
      const [existing] = await app.db.select({ id: s.contracts.id }).from(s.contracts).where(eq(s.contracts.opportunityId, o.id)).limit(1);
      const [plan] = o.planId ? await app.db.select().from(s.plans).where(eq(s.plans.id, o.planId)).limit(1) : [];
      const items = plan
        ? (plan.products.length ? plan.products.map((p) => ({ planId: plan.id, description: `${plan.invoiceServiceName ?? plan.name} · ${p.name}`, qty: p.qty || 1, unitCents: p.unitPriceCents })) : [{ planId: plan.id, description: plan.invoiceServiceName ?? plan.name, qty: 1, unitCents: plan.priceCents }])
        : [];
      const publico = o.segment === 'governamental';
      return {
        opportunity: { id: o.id, code: o.code, stage: o.stage, title: o.title, wonAt: o.wonAt, contactId: o.contactId, customerId: o.customerId },
        client: { name: o.contactName, document: o.document, segment: o.segment, email: o.email, phone: o.phone },
        existingContractId: existing?.id ?? null,
        won: o.stage === 'ganha',
        suggestion: {
          kind: publico ? 'publico' : 'privado', legalRegime: publico ? 'lei_14133' : 'privado', commercialOwnerId: o.ownerId,
          version: { number: '', object: plan ? `Prestação de serviços de ${plan.invoiceServiceName ?? plan.name}` : o.title, items, monthlyCents: items.reduce((a, i) => a + i.qty * i.unitCents, 0) || (o.valueCents ?? 0), signedAt: o.wonAt ? o.wonAt.toISOString().slice(0, 10) : null, termMonths: 12 },
        },
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts',
    summary: 'Cadastra contrato (a partir da oportunidade fechada ou de um cliente). Cria a versão 1.',
    tag: 'Contratos',
    module: 'contratos',
    body: CreateBody,
    handler: async ({ app, auth, body, req, reply }) => {
      let contactId = body.contactId, customerId: string | null = null, oppTitle: string | null = null, arpFromOpp: string | null = null;
      if (body.opportunityId) {
        const [o] = await app.db.select().from(s.opportunities).where(and(eq(s.opportunities.id, body.opportunityId), eq(s.opportunities.tenantId, auth.tenantId), canManage(auth) ? undefined : oppVisibility(auth))).limit(1);
        if (!o) throw notFound('Oportunidade não encontrada.');
        if (o.stage !== 'ganha') throw unprocessable('O contrato é cadastrado depois que a oportunidade é concluída (venda fechada).');
        const [dup] = await app.db.select({ id: s.contracts.id }).from(s.contracts).where(eq(s.contracts.opportunityId, o.id)).limit(1);
        if (dup) throw unprocessable('Esta oportunidade já tem contrato cadastrado.', [{ path: 'opportunityId', message: dup.id }]);
        contactId = o.contactId; customerId = o.customerId; oppTitle = o.title; arpFromOpp = o.arpId;
      }
      if (!contactId) throw unprocessable('Informe a oportunidade ou o cliente.', [{ path: 'contactId', message: 'Obrigatório' }]);
      const [contact] = await app.db.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.id, contactId), eq(s.contacts.tenantId, auth.tenantId))).limit(1);
      if (!contact) throw unprocessable('Cliente inválido.');
      if (!customerId) customerId = (await app.db.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.contactId, contactId)).limit(1))[0]?.id ?? null;
      if (level(auth, 'contratos') === 'proprio' && body.commercialOwnerId !== auth.userId && !canManage(auth)) throw forbidden('No nível Próprio, o responsável comercial é você.');
      await assertUsers(app.db, auth, [body.commercialOwnerId, body.operationalOwnerId, body.csmId]);
      const ver = normalizeVersion(body.version);
      if (body.billingType === 'medicao' && !ver.totalCents && body.initialBalanceCents) ver.totalCents = body.initialBalanceCents;
      const c = await app.db.transaction(async (tx) => {
        const [c] = await tx.insert(s.contracts).values({
          tenantId: auth.tenantId, contactId: contactId!, customerId, opportunityId: body.opportunityId, arpId: arpFromOpp, kind: body.kind, billingType: body.billingType, legalRegime: body.kind === 'privado' ? 'privado' : body.legalRegime,
          commercialOwnerId: body.commercialOwnerId, operationalOwnerId: body.operationalOwnerId, csmId: body.csmId, legalLimitAt: body.legalLimitAt ?? null,
          nextAction: body.nextAction ?? 'Validar cadastro', nextActionAt: body.nextActionAt ?? null, createdBy: auth.userId,
        }).returning();
        await tx.insert(s.contractVersions).values({ ...ver, tenantId: auth.tenantId, contractId: c!.id, version: 1, changeKind: 'cadastro', reason: 'Cadastro inicial', guarantee: ver.guarantee ?? null, publicTerms: ver.publicTerms ?? null, createdBy: auth.userId } as typeof s.contractVersions.$inferInsert);
        if (body.billingType === 'medicao' && body.initialBalanceCents > 0) {
          await tx.insert(s.contractLedger).values({ tenantId: auth.tenantId, contractId: c!.id, kind: 'credito', amountCents: body.initialBalanceCents, occurredOn: ver.signedAt ?? new Date().toISOString().slice(0, 10), description: 'Saldo inicial do contrato', createdBy: auth.userId });
        }
        await addEvent(tx, auth.tenantId, c!.id, auth.userId, 'cadastro', `Contrato ${ver.number} (${BILLING_TYPE_LABELS[body.billingType]}) cadastrado${oppTitle ? ` a partir da oportunidade “${oppTitle}”` : ''}`, { opportunityId: body.opportunityId });
        if (body.opportunityId) await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: body.opportunityId, type: 'contrato_cadastrado', actorId: auth.userId, payload: { contractId: c!.id, number: ver.number } });
        return c!;
      });
      await audit(app.db, req, { action: 'contract.create', entityType: 'contract', entityId: c.id, metadata: { number: ver.number, opportunityId: body.opportunityId } });
      reply.code(201);
      return { id: c.id };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts',
    summary: 'Lista e pesquisa de contratos (vigência, valor, dias restantes, pendências e próxima ação)',
    tag: 'Contratos',
    module: 'contratos',
    query: ListQuery,
    handler: async ({ app, auth, query }) => {
      const today = new Date().toISOString().slice(0, 10);
      const where: (SQL | undefined)[] = [contractScope(auth)];
      if (query.q) { const t = `%${query.q.replace(/[%_\\]/g, '\\$&')}%`; where.push(or(ilike(v.number, t), ilike(s.contacts.name, t), ilike(v.object, t), sql`('CT-' || ${s.contracts.code}::text) ilike ${t}`)); }
      if (query.stage) where.push(eq(s.contracts.stage, query.stage));
      if (query.kind) where.push(eq(s.contracts.kind, query.kind));
      if (query.billingType) where.push(eq(s.contracts.billingType, query.billingType));
      if (query.ownerId) where.push(eq(s.contracts.commercialOwnerId, query.ownerId));
      if (query.status === 'ativos') where.push(sql`${s.contracts.stage} <> 'arquivado'`);
      if (query.status === 'encerrados') where.push(eq(s.contracts.stage, 'arquivado'));
      if (query.expiringDays) where.push(and(isNotNull(v.endAt), lte(v.endAt, addDays(today, query.expiringDays)), sql`${s.contracts.stage} <> 'arquivado'`));
      const cond = and(...where);
      const rows = await listQuery(app.db).where(cond).orderBy(sql`${v.endAt} asc nulls last`, desc(s.contracts.code)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const [{ n } = { n: 0 }] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.contracts).innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion))).innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId)).where(cond);
      return { items: await decorate(app.db, rows), total: n, page: query.page, pageSize: query.pageSize };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/dashboard',
    summary: 'Painel: faturamento por tipo no período, carteira estratificada, saldo de medição, vencimentos, risco e alertas',
    tag: 'Contratos',
    module: 'contratos',
    query: z.object({ from: day.optional(), to: day.optional() }),
    handler: async ({ app, auth, query }) => {
      const today = new Date().toISOString().slice(0, 10);
      const from = query.from ?? `${today.slice(0, 7)}-01`;
      const to = query.to ?? today;
      if (to < from || daysBetween(from, to) > 1100) throw unprocessable('Período inválido (até 3 anos).');
      const span = daysBetween(from, to) + 1;
      const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(span - 1));
      const rows = await decorate(app.db, await listQuery(app.db).where(contractScope(auth)));
      const active = rows.filter((r) => r.stage !== 'arquivado' && r.validatedAt);
      const within = (d: number) => active.filter((r) => r.endAt && r.endAt >= today && r.endAt <= addDays(today, d));
      const renewOpen = await app.db.select({ contractId: s.contractProcesses.contractId, cycleKey: s.contractProcesses.cycleKey, status: s.contractProcesses.status }).from(s.contractProcesses).where(and(eq(s.contractProcesses.tenantId, auth.tenantId), eq(s.contractProcesses.kind, 'renovacao')));
      const atRisk = active.filter((r) => r.closureExpected || (r.endAt && r.endAt <= addDays(today, 90) && !renewOpen.some((p) => p.contractId === r.id && p.cycleKey === r.endAt && p.status === 'concluido')));
      const ids = rows.map((r) => r.id);
      const alerts = ids.length ? await app.db.select({ kind: s.contractAlerts.kind, dueAt: s.contractAlerts.dueAt, contractId: s.contractAlerts.contractId, id: s.contractAlerts.id, detail: s.contractAlerts.detail }).from(s.contractAlerts).where(and(inArray(s.contractAlerts.contractId, ids), eq(s.contractAlerts.status, 'aberto'))).orderBy(asc(s.contractAlerts.dueAt)) : [];
      const ledger = ids.length ? await app.db.select({ contractId: s.contractLedger.contractId, kind: s.contractLedger.kind, amountCents: s.contractLedger.amountCents, occurredOn: s.contractLedger.occurredOn }).from(s.contractLedger).where(inArray(s.contractLedger.contractId, ids)) : [];
      // faturamento do período por contrato (registrado no CRM; recorrente = previsto pela mensalidade)
      const billed = (r: (typeof rows)[number], f: string, t: string) => {
        if (r.billingType === 'recorrente') return r.validatedAt ? recurringBilledInPeriod(r.monthlyCents, r.billingStartAt ?? r.activationAt ?? r.startAt, r.archivedAt ? r.archivedAt.toISOString().slice(0, 10) : r.endAt, f, t) : 0;
        const inP = ledger.filter((e) => e.contractId === r.id && e.occurredOn >= f && e.occurredOn <= t);
        if (r.billingType === 'frequente') return inP.filter((e) => e.kind === 'faturamento').reduce((a, e) => a + e.amountCents, 0);
        return inP.reduce((a, e) => a + (e.kind === 'consumo' ? e.amountCents : e.kind === 'estorno' ? -e.amountCents : 0), 0);
      };
      const withBilling = rows.map((r) => ({ ...r, billedCents: billed(r, from, to), billedPrevCents: billed(r, prevFrom, prevTo), ledger: ledgerTotals(ledger.filter((e) => e.contractId === r.id)) }));
      const sumBy = <K extends string>(keyOf: (r: (typeof withBilling)[number]) => K, label: (k: K) => string) => {
        const m = new Map<K, { n: number; monthlyCents: number; billedCents: number }>();
        for (const r of withBilling.filter((x) => (x.stage !== 'arquivado' && x.validatedAt) || x.billedCents)) { const k = keyOf(r); const v = m.get(k) ?? { n: 0, monthlyCents: 0, billedCents: 0 }; if (r.stage !== 'arquivado') { v.n++; v.monthlyCents += r.monthlyCents; } v.billedCents += r.billedCents; m.set(k, v); }
        return [...m.entries()].map(([key, v]) => ({ key, label: label(key), ...v })).sort((a, b) => b.billedCents - a.billedCents || b.monthlyCents - a.monthlyCents);
      };
      const meas = withBilling.filter((r) => r.billingType === 'medicao' && r.stage !== 'arquivado');
      const byType = BILLING_TYPES.map((t) => {
        const list = withBilling.filter((r) => r.billingType === t);
        const act = list.filter((r) => r.stage !== 'arquivado' && r.validatedAt);
        return {
          type: t, label: BILLING_TYPE_LABELS[t], active: act.length,
          billedCents: list.reduce((a, r) => a + r.billedCents, 0), billedPrevCents: list.reduce((a, r) => a + r.billedPrevCents, 0),
          monthlyCents: act.reduce((a, r) => a + r.monthlyCents, 0),
          ...(t === 'medicao' ? { balance: { credited: meas.reduce((a, r) => a + r.ledger.credited, 0), consumed: meas.reduce((a, r) => a + r.ledger.consumed, 0), available: meas.reduce((a, r) => a + r.ledger.available, 0) } } : {}),
        };
      });
      const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 + i, 1)).toISOString().slice(0, 7));
      const ages = active.filter((r) => r.startAt).map((r) => Math.max(0, daysBetween(r.startAt!, today)) / 30.4);
      const remaining = active.filter((r) => r.endAt && r.endAt >= today).map((r) => daysBetween(today, r.endAt!) / 30.4);
      const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
      const clientMap = new Map<string, { contactId: string; name: string; contracts: number; monthlyCents: number; billedCents: number }>();
      for (const r of withBilling) { const c = clientMap.get(r.contactId) ?? { contactId: r.contactId, name: r.clientName, contracts: 0, monthlyCents: 0, billedCents: 0 }; if (r.stage !== 'arquivado') { c.contracts++; c.monthlyCents += r.monthlyCents; } c.billedCents += r.billedCents; clientMap.set(r.contactId, c); }
      const totalBilled = byType.reduce((a, t) => a + t.billedCents, 0);
      return {
        period: { from, to, prevFrom, prevTo },
        billing: { totalCents: totalBilled, prevTotalCents: byType.reduce((a, t) => a + t.billedPrevCents, 0), byType, note: 'Faturamento registrado no CRM: recorrente pela mensalidade dos meses faturáveis (previsto), frequente pelos lançamentos e medição pelos consumos. O faturado no ERP entra com a integração.' },
        byBillingType: sumBy((r) => r.billingType as (typeof BILLING_TYPES)[number], (k) => BILLING_TYPE_LABELS[k]),
        byKind: sumBy((r) => r.kind, (k) => (k === 'publico' ? 'Público' : 'Privado')),
        bySegment: sumBy((r) => r.segment, (k) => SEGMENT_LABELS[k as Segment] ?? k),
        byOwner: sumBy((r) => r.ownerName ?? 'Sem responsável', (k) => k),
        topClients: [...clientMap.values()].sort((a, b) => b.billedCents - a.billedCents || b.monthlyCents - a.monthlyCents).slice(0, 10),
        expiringByMonth: months.map((m) => ({ month: m, ...Object.fromEntries(BILLING_TYPES.map((t) => [t, active.filter((r) => r.billingType === t && r.endAt?.startsWith(m)).length])), monthlyCents: active.filter((r) => r.endAt?.startsWith(m)).reduce((a, r) => a + r.monthlyCents, 0) })),
        measurement: {
          contracts: meas.length,
          lowBalance: meas.filter((r) => r.ledger.credited > 0 && r.ledger.available / r.ledger.credited < 0.2).map((r) => ({ id: r.id, number: r.number, clientName: r.clientName, credited: r.ledger.credited, available: r.ledger.available, usedShare: r.ledger.usedShare })),
        },
        portfolio: { avgTicketCents: active.length ? Math.round(active.reduce((a, r) => a + r.monthlyCents, 0) / active.length) : null, avgAgeMonths: avg(ages), avgRemainingMonths: avg(remaining), renewalPipelineCents: within(90).reduce((a, r) => a + r.monthlyCents, 0), publicShare: active.length ? active.filter((r) => r.kind === 'publico').length / active.length : null },
        byStage: CONTRACT_STAGES.map((st) => ({ stage: st, label: CONTRACT_STAGE_LABELS[st], n: rows.filter((r) => r.stage === st).length, monthlyCents: rows.filter((r) => r.stage === st).reduce((a, r) => a + r.monthlyCents, 0) })),
        active: active.length,
        archived: rows.filter((r) => r.stage === 'arquivado').length,
        pendingValidation: rows.filter((r) => r.stage === 'cadastro_validacao').length,
        monthlyCents: active.reduce((a, r) => a + r.monthlyCents, 0),
        globalCents: active.reduce((a, r) => a + (r.totalCents ?? r.monthlyCents * (r.termMonths ?? 12)), 0),
        expiring: { d30: within(30).length, d60: within(60).length, d90: within(90).length },
        atRisk: { n: atRisk.length, monthlyCents: atRisk.reduce((a, r) => a + r.monthlyCents, 0) },
        alerts: { open: alerts.length, overdue: alerts.filter((a) => a.dueAt && a.dueAt < today).length, byKind: Object.entries(alerts.reduce<Record<string, number>>((m, a) => ((m[a.kind] = (m[a.kind] ?? 0) + 1), m), {})).map(([kind, n]) => ({ kind, label: ALERT_LABELS[kind as AlertKind] ?? kind, n })) },
        nextExpiring: within(120).sort((a, b) => (a.endAt! < b.endAt! ? -1 : 1)).slice(0, 8),
        attention: rows.filter((r) => r.pendencies.overdue > 0).slice(0, 8),
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/calendar',
    summary: 'Calendário de obrigações: término, renovação, reajuste, garantias, prazos de processos, alertas e tarefas',
    tag: 'Contratos',
    module: 'contratos',
    query: z.object({ from: day, to: day }),
    handler: async ({ app, auth, query }) => {
      if (daysBetween(query.from, query.to) > 400 || query.to < query.from) throw unprocessable('Período de até 400 dias.');
      const rows = await listQuery(app.db).where(and(contractScope(auth), sql`${s.contracts.stage} <> 'arquivado'`));
      type Ev = { date: string; kind: string; label: string; contractId: string; number: string; client: string };
      const out: Ev[] = [];
      const push = (date: string | null | undefined, kind: string, label: string, r: (typeof rows)[number]) => { if (date && date >= query.from && date <= query.to) out.push({ date, kind, label, contractId: r.id, number: r.number, client: r.clientName }); };
      for (const r of rows) {
        push(r.endAt, 'termino', 'Término da vigência', r);
        if (r.endAt) push(addDays(r.endAt, -DEFAULT_CONTRACT_SETTINGS.renewalAlertDays), 'renovacao', 'Início da renovação (60 dias)', r);
        if (r.closureExpected) push(r.closureAt ?? r.endAt, 'encerramento', 'Encerramento previsto', r);
        push(r.guarantee?.expiresAt, 'garantia', `Vencimento da garantia${r.guarantee?.type ? ` (${r.guarantee.type})` : ''}`, r);
        if (r.adjustmentBaseDate) { const a = nextAnniversary(r.adjustmentBaseDate, query.from); if (a > r.adjustmentBaseDate) push(a, 'reajuste', `Data-base do reajuste${r.adjustmentIndex ? ` (${r.adjustmentIndex})` : ''}`, r); }
        push(r.nextActionAt, 'acao', r.nextAction ?? 'Próxima ação', r);
      }
      const ids = rows.map((r) => r.id);
      const byId = new Map(rows.map((r) => [r.id, r]));
      if (ids.length) {
        const procs = await app.db.select({ contractId: s.contractProcesses.contractId, kind: s.contractProcesses.kind, dueAt: s.contractProcesses.dueAt }).from(s.contractProcesses).where(and(inArray(s.contractProcesses.contractId, ids), eq(s.contractProcesses.status, 'aberto')));
        for (const p of procs) push(p.dueAt, `processo_${p.kind}`, `Prazo do processo de ${p.kind}`, byId.get(p.contractId)!);
        const acts = await app.db.select({ contractId: s.activities.contractId, title: s.activities.title, dueAt: s.activities.dueAt }).from(s.activities).where(and(inArray(s.activities.contractId, ids), sql`${s.activities.completedAt} is null`, sql`${s.activities.deletedAt} is null`, isNotNull(s.activities.dueAt)));
        for (const a of acts) push(a.dueAt!.toISOString().slice(0, 10), 'tarefa', a.title, byId.get(a.contractId!)!);
      }
      return { items: out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/reports/expiring',
    summary: 'Relatório mensal: contratos que vencem no mês (padrão: mês seguinte). format=csv para planilha.',
    tag: 'Contratos',
    module: 'contratos',
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), format: z.enum(['json', 'csv']).default('json') }),
    handler: async ({ app, auth, query, reply }) => {
      const now = new Date();
      const month = query.month ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
      const from = `${month}-01`;
      const to = addDays(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10), -1);
      const rows = await decorate(app.db, await listQuery(app.db).where(and(contractScope(auth), gte(v.endAt, from), lte(v.endAt, to))).orderBy(asc(v.endAt)));
      const procs = rows.length ? await app.db.select({ contractId: s.contractProcesses.contractId, cycleKey: s.contractProcesses.cycleKey, status: s.contractProcesses.status, outcome: s.contractProcesses.outcome }).from(s.contractProcesses).where(and(inArray(s.contractProcesses.contractId, rows.map((r) => r.id)), eq(s.contractProcesses.kind, 'renovacao'))) : [];
      const items = rows.map((r) => {
        const p = procs.find((x) => x.contractId === r.id && x.cycleKey === r.endAt);
        return { ...r, renewal: p ? (p.status === 'concluido' ? (p.outcome ?? 'concluida') : p.status === 'cancelado' ? 'cancelada' : 'em andamento') : r.closureExpected ? 'encerramento previsto' : 'não iniciada' };
      });
      if (query.format === 'csv') {
        const esc = (x: unknown) => { const t = String(x ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
        const head = ['Contrato', 'Código', 'Cliente', 'Tipo', 'Regime', 'Objeto', 'Término', 'Dias restantes', 'Valor mensal', 'Responsável', 'Etapa', 'Renovação'];
        const lines = items.map((r) => [r.number, `CT-${r.code}`, r.clientName, r.kind, r.legalRegime, r.object, r.endAt, r.daysLeft, brl(r.monthlyCents), r.ownerName, CONTRACT_STAGE_LABELS[r.stage as keyof typeof CONTRACT_STAGE_LABELS], r.renewal].map(esc).join(';'));
        return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="contratos-vencendo-${month}.csv"`).send(`﻿${[head.join(';'), ...lines].join('\r\n')}\r\n`);
      }
      return { month, from, to, items, monthlyCents: items.reduce((a, r) => a + r.monthlyCents, 0) };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/reports/full',
    summary: 'Relatório completo de contratos: cadastro, datas, valores, faturamento no período, saldo, reajuste, garantia, processos e pendências. format=csv para planilha.',
    tag: 'Contratos',
    module: 'contratos',
    query: z.object({ from: day.optional(), to: day.optional(), status: z.enum(['ativos', 'encerrados', 'todos']).default('todos'), billingType: z.enum(BILLING_TYPES).optional(), kind: z.enum(CONTRACT_KINDS).optional(), stage: z.enum(CONTRACT_STAGES).optional(), ownerId: uuid.optional(), format: z.enum(['json', 'csv']).default('json') }),
    handler: async ({ app, auth, query, reply }) => {
      const today = new Date().toISOString().slice(0, 10);
      const from = query.from ?? `${today.slice(0, 4)}-01-01`, to = query.to ?? today;
      if (to < from) throw unprocessable('Período inválido.');
      const where: (SQL | undefined)[] = [contractScope(auth)];
      if (query.status === 'ativos') where.push(sql`${s.contracts.stage} <> 'arquivado'`);
      if (query.status === 'encerrados') where.push(eq(s.contracts.stage, 'arquivado'));
      if (query.billingType) where.push(eq(s.contracts.billingType, query.billingType));
      if (query.kind) where.push(eq(s.contracts.kind, query.kind));
      if (query.stage) where.push(eq(s.contracts.stage, query.stage));
      if (query.ownerId) where.push(eq(s.contracts.commercialOwnerId, query.ownerId));
      const rows = await decorate(app.db, await listQuery(app.db).where(and(...where)).orderBy(asc(s.contacts.name), asc(v.number)));
      const ids = rows.map((r) => r.id);
      const extra = ids.length ? await app.db.select({ id: s.contracts.id, document: s.contacts.document, operationalOwnerId: s.contracts.operationalOwnerId, csmId: s.contracts.csmId, closureReason: s.contracts.closureReason, legalLimitAt: s.contracts.legalLimitAt, renewalAt: v.renewalAt, adjustmentRule: v.adjustmentRule, billingDay: v.billingDay, opportunityCode: s.opportunities.code })
        .from(s.contracts).innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion))).innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId)).leftJoin(s.opportunities, eq(s.opportunities.id, s.contracts.opportunityId)).where(inArray(s.contracts.id, ids)) : [];
      const people = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const pname = (id: string | null | undefined) => people.find((p) => p.id === id)?.name ?? '';
      const ledger = ids.length ? await app.db.select({ contractId: s.contractLedger.contractId, kind: s.contractLedger.kind, amountCents: s.contractLedger.amountCents, occurredOn: s.contractLedger.occurredOn }).from(s.contractLedger).where(inArray(s.contractLedger.contractId, ids)) : [];
      const procs = ids.length ? await app.db.select({ contractId: s.contractProcesses.contractId, kind: s.contractProcesses.kind, status: s.contractProcesses.status }).from(s.contractProcesses).where(inArray(s.contractProcesses.contractId, ids)) : [];
      const items = rows.map((r) => {
        const x = extra.find((e) => e.id === r.id);
        const led = ledger.filter((e) => e.contractId === r.id);
        const inP = led.filter((e) => e.occurredOn >= from && e.occurredOn <= to);
        const billedCents = r.billingType === 'recorrente'
          ? (r.validatedAt ? recurringBilledInPeriod(r.monthlyCents, r.billingStartAt ?? r.activationAt ?? r.startAt, r.archivedAt ? r.archivedAt.toISOString().slice(0, 10) : r.endAt, from, to) : 0)
          : r.billingType === 'frequente' ? inP.filter((e) => e.kind === 'faturamento').reduce((a, e) => a + e.amountCents, 0)
            : inP.reduce((a, e) => a + (e.kind === 'consumo' ? e.amountCents : e.kind === 'estorno' ? -e.amountCents : 0), 0);
        const totals = ledgerTotals(led);
        return {
          ...r, document: x?.document ?? null, operationalOwnerName: pname(x?.operationalOwnerId), csmName: pname(x?.csmId), closureReason: x?.closureReason ?? null, legalLimitAt: x?.legalLimitAt ?? null,
          renewalAt: x?.renewalAt ?? null, adjustmentRule: x?.adjustmentRule ?? null, billingDay: x?.billingDay ?? null, opportunityCode: x?.opportunityCode ?? null,
          billedCents, balance: r.billingType === 'medicao' ? totals : null,
          openProcesses: procs.filter((p) => p.contractId === r.id && p.status === 'aberto').map((p) => p.kind),
        };
      });
      const sum = (list: typeof items, f: (r: (typeof items)[number]) => number) => list.reduce((a, r) => a + f(r), 0);
      const summary = {
        contracts: items.length, active: items.filter((r) => r.stage !== 'arquivado' && r.validatedAt).length, archived: items.filter((r) => r.stage === 'arquivado').length,
        monthlyCents: sum(items.filter((r) => r.stage !== 'arquivado'), (r) => r.monthlyCents), globalCents: sum(items.filter((r) => r.stage !== 'arquivado'), (r) => r.totalCents ?? r.monthlyCents * (r.termMonths ?? 12)),
        billedCents: sum(items, (r) => r.billedCents),
        byType: BILLING_TYPES.map((t) => ({ type: t, label: BILLING_TYPE_LABELS[t], n: items.filter((r) => r.billingType === t).length, monthlyCents: sum(items.filter((r) => r.billingType === t && r.stage !== 'arquivado'), (r) => r.monthlyCents), billedCents: sum(items.filter((r) => r.billingType === t), (r) => r.billedCents) })),
        byStage: CONTRACT_STAGES.map((st) => ({ stage: st, label: CONTRACT_STAGE_LABELS[st], n: items.filter((r) => r.stage === st).length })).filter((x) => x.n),
        measurement: { credited: sum(items, (r) => r.balance?.credited ?? 0), consumed: sum(items, (r) => r.balance?.consumed ?? 0), available: sum(items, (r) => r.balance?.available ?? 0) },
        pendencies: { alerts: sum(items, (r) => r.pendencies.alerts), overdue: sum(items, (r) => r.pendencies.overdue) },
      };
      if (query.format === 'csv') {
        const esc = (val: unknown) => { const t = String(val ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
        const d = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
        const money = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
        const cols: [string, (r: (typeof items)[number]) => unknown][] = [
          ['Código', (r) => `CT-${r.code}`], ['Número', (r) => r.number], ['Cliente', (r) => r.clientName], ['CPF/CNPJ', (r) => r.document], ['Categoria', (r) => SEGMENT_LABELS[r.segment as Segment] ?? r.segment],
          ['Tipo de contrato', (r) => BILLING_TYPE_LABELS[r.billingType as keyof typeof BILLING_TYPE_LABELS]], ['Público/privado', (r) => (r.kind === 'publico' ? 'Público' : 'Privado')], ['Regime', (r) => r.legalRegime],
          ['Etapa', (r) => CONTRACT_STAGE_LABELS[r.stage as keyof typeof CONTRACT_STAGE_LABELS]], ['Objeto', (r) => r.object],
          ['Responsável comercial', (r) => r.ownerName], ['Responsável operacional', (r) => r.operationalOwnerName], ['CSM', (r) => r.csmName],
          ['Assinatura', (r) => d(r.signedAt)], ['Início vigência', (r) => d(r.startAt)], ['Término vigência', (r) => d(r.endAt)], ['Prazo (meses)', (r) => r.termMonths], ['Dias restantes', (r) => (r.stage === 'arquivado' ? '' : r.daysLeft)],
          ['Renovação prevista', (r) => d(r.renewalAt)], ['Ativação técnica', (r) => d(r.activationAt)], ['Início faturamento', (r) => d(r.billingStartAt)], ['Dia faturamento', (r) => r.billingDay],
          ['Valor mensal (R$)', (r) => money(r.monthlyCents)], ['Valor global (R$)', (r) => money(r.totalCents)], [`Faturado ${d(from)} a ${d(to)} (R$)`, (r) => money(r.billedCents)],
          ['Saldo contratado (R$)', (r) => money(r.balance?.credited)], ['Saldo consumido (R$)', (r) => money(r.balance?.consumed)], ['Saldo disponível (R$)', (r) => money(r.balance?.available)],
          ['Índice reajuste', (r) => r.adjustmentIndex], ['Data-base', (r) => d(r.adjustmentBaseDate)], ['Regra de reajuste', (r) => r.adjustmentRule],
          ['Garantia', (r) => r.guarantee?.type], ['Vencimento garantia', (r) => d(r.guarantee?.expiresAt)], ['Limite legal', (r) => d(r.legalLimitAt)],
          ['ERP', (r) => r.erpRef], ['Renovado', (r) => (r.renewed ? 'Sim' : 'Não')], ['Encerramento previsto', (r) => (r.closureExpected ? `${d(r.closureAt)} ${r.closureReason ?? ''}`.trim() : '')],
          ['Processos abertos', (r) => r.openProcesses.join(', ')], ['Alertas abertos', (r) => r.pendencies.alerts], ['Alertas atrasados', (r) => r.pendencies.overdue],
          ['Próxima ação', (r) => r.nextAction], ['Data próxima ação', (r) => d(r.nextActionAt)], ['Versão', (r) => r.version], ['Validado em', (r) => (r.validatedAt ? r.validatedAt.toISOString().slice(0, 10).split('-').reverse().join('/') : '')], ['Oportunidade', (r) => (r.opportunityCode ? `OP-${r.opportunityCode}` : '')],
        ];
        const lines = [cols.map(([h]) => esc(h)).join(';'), ...items.map((r) => cols.map(([, f]) => esc(f(r))).join(';'))];
        return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="relatorio-contratos-${from}-a-${to}.csv"`).send(`\uFEFF${lines.join('\r\n')}\r\n`);
      }
      return { period: { from, to }, summary, items };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/processes',
    summary: 'Processos de renovação, reajuste, implantação ou encerramento (abertos ou concluídos)',
    tag: 'Contratos',
    module: 'contratos',
    query: z.object({ kind: z.enum(['implantacao', 'renovacao', 'reajuste', 'encerramento']), status: z.enum(['aberto', 'concluido', 'cancelado', 'todos']).default('aberto') }),
    handler: async ({ app, auth, query }) => {
      const rows = await app.db
        .select({ id: s.contractProcesses.id, contractId: s.contractProcesses.contractId, kind: s.contractProcesses.kind, cycleKey: s.contractProcesses.cycleKey, status: s.contractProcesses.status, steps: s.contractProcesses.steps, data: s.contractProcesses.data, dueAt: s.contractProcesses.dueAt, outcome: s.contractProcesses.outcome, openedAt: s.contractProcesses.openedAt, closedAt: s.contractProcesses.closedAt, contractKind: s.contracts.kind, code: s.contracts.code, number: v.number, clientName: s.contacts.name, monthlyCents: v.monthlyCents, endAt: v.endAt, ownerName: owner.name })
        .from(s.contractProcesses)
        .innerJoin(s.contracts, eq(s.contracts.id, s.contractProcesses.contractId))
        .innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion)))
        .innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId))
        .leftJoin(owner, eq(owner.id, s.contractProcesses.ownerId))
        .where(and(contractScope(auth), eq(s.contractProcesses.kind, query.kind), query.status === 'todos' ? undefined : eq(s.contractProcesses.status, query.status)))
        .orderBy(sql`${s.contractProcesses.dueAt} asc nulls last`);
      return { items: rows };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/alerts',
    summary: 'Notificações dos contratos: responsável, prazo, status e histórico',
    tag: 'Contratos',
    module: 'contratos',
    query: z.object({ status: z.enum(['aberto', 'concluido', 'cancelado', 'todos']).default('aberto'), contractId: uuid.optional() }),
    handler: async ({ app, auth, query }) => {
      const resp = alias(s.users, 'al_owner');
      const rows = await app.db
        .select({ id: s.contractAlerts.id, contractId: s.contractAlerts.contractId, kind: s.contractAlerts.kind, cycleKey: s.contractAlerts.cycleKey, dueAt: s.contractAlerts.dueAt, status: s.contractAlerts.status, detail: s.contractAlerts.detail, emails: s.contractAlerts.emails, activityIds: s.contractAlerts.activityIds, createdAt: s.contractAlerts.createdAt, resolvedAt: s.contractAlerts.resolvedAt, resolution: s.contractAlerts.resolution, ownerId: s.contractAlerts.ownerId, ownerName: resp.name, number: v.number, clientName: s.contacts.name, code: s.contracts.code })
        .from(s.contractAlerts)
        .innerJoin(s.contracts, eq(s.contracts.id, s.contractAlerts.contractId))
        .innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion)))
        .innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId))
        .leftJoin(resp, eq(resp.id, s.contractAlerts.ownerId))
        .where(and(contractScope(auth), query.status === 'todos' ? undefined : eq(s.contractAlerts.status, query.status), query.contractId ? eq(s.contractAlerts.contractId, query.contractId) : undefined))
        .orderBy(sql`${s.contractAlerts.dueAt} asc nulls last`)
        .limit(500);
      return { items: rows.map((r) => ({ ...r, label: ALERT_LABELS[r.kind as AlertKind] ?? r.kind })) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contracts/alerts/:id/resolve',
    summary: 'Conclui ou cancela uma notificação com a providência tomada',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    body: z.object({ status: z.enum(['concluido', 'cancelado']).default('concluido'), resolution: z.string().trim().min(3).max(500) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [a] = await app.db.select().from(s.contractAlerts).where(and(eq(s.contractAlerts.id, params.id), eq(s.contractAlerts.tenantId, auth.tenantId))).limit(1);
      if (!a) throw notFound();
      const c = await loadContract(app.db, auth, a.contractId);
      if (a.status !== 'aberto') throw unprocessable('Esta notificação já foi encerrada.');
      if (a.ownerId !== auth.userId && !canManage(auth) && c.commercialOwnerId !== auth.userId) throw forbidden('Só o responsável pela notificação ou a gestão de contratos pode concluí-la.');
      await app.db.update(s.contractAlerts).set({ status: body.status, resolution: body.resolution, resolvedAt: new Date(), resolvedBy: auth.userId }).where(eq(s.contractAlerts.id, a.id));
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'alerta_resolvido', `Notificação ${ALERT_LABELS[a.kind as AlertKind] ?? a.kind} ${body.status === 'concluido' ? 'concluída' : 'cancelada'}: ${body.resolution}`, { alertId: a.id });
      await audit(app.db, req, { action: 'contract.alert.resolve', entityType: 'contract', entityId: c.id, metadata: { alertId: a.id, status: body.status } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contracts/alerts/run',
    summary: 'Roda agora o monitoramento de vigências desta empresa (o agendamento diário faz o mesmo)',
    tag: 'Contratos',
    module: 'contratos',
    min: 'total',
    handler: async ({ app, auth, req }) => {
      const r = await runContractAlerts(app.db, app.config, { tenantId: auth.tenantId });
      await audit(app.db, req, { action: 'contract.alerts.run', entityType: 'tenant', entityId: auth.tenantId, metadata: r });
      return r;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/:id',
    summary: 'Ficha do contrato: cliente, versão atual, histórico de versões, processos, alertas e documentos',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const versions = await app.db.select().from(s.contractVersions).where(eq(s.contractVersions.contractId, c.id)).orderBy(desc(s.contractVersions.version));
      const cur = versions.find((x) => x.version === c.currentVersion)!;
      const [contact] = await app.db.select({ id: s.contacts.id, name: s.contacts.name, document: s.contacts.document, email: s.contacts.email, phone: s.contacts.phone, segment: s.contacts.segment, city: s.contacts.city }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
      const [address] = await app.db.select().from(s.addresses).where(or(eq(s.addresses.contactId, c.contactId), c.customerId ? eq(s.addresses.customerId, c.customerId) : undefined)).orderBy(desc(s.addresses.validFrom)).limit(1);
      const [opp] = c.opportunityId ? await app.db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, handoffStage: s.opportunities.handoffStage }).from(s.opportunities).where(eq(s.opportunities.id, c.opportunityId)).limit(1) : [];
      const people = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, [c.commercialOwnerId, c.operationalOwnerId, c.csmId, c.validatedBy, c.archiveResponsibleId].filter((x): x is string => !!x)));
      const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
      const processes = await app.db.select().from(s.contractProcesses).where(eq(s.contractProcesses.contractId, c.id)).orderBy(desc(s.contractProcesses.openedAt));
      const alerts = await app.db.select().from(s.contractAlerts).where(eq(s.contractAlerts.contractId, c.id)).orderBy(desc(s.contractAlerts.createdAt));
      const today = new Date().toISOString().slice(0, 10);
      const pend = (await openPendencies(app.db, [c.id])).get(c.id) ?? { alerts: 0, overdue: 0, steps: 0 };
      return {
        ...c,
        commercialOwnerName: name(c.commercialOwnerId), operationalOwnerName: name(c.operationalOwnerId), csmName: name(c.csmId), validatedByName: name(c.validatedBy), archiveResponsibleName: name(c.archiveResponsibleId),
        current: cur, versions, contact, address: address ?? null, opportunity: opp ?? null, processes,
        alerts: alerts.map((a) => ({ ...a, label: ALERT_LABELS[a.kind as AlertKind] ?? a.kind })),
        daysLeft: cur.endAt ? daysBetween(today, cur.endAt) : null, pendencies: pend,
        permissions: { edit: canEdit(auth, c), manage: canManage(auth), validate: c.stage === 'cadastro_validacao' && canManage(auth) },
      };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/contracts/:id',
    summary: 'Edita o contrato. Mudança nos dados contratuais gera nova versão (INSERT) com motivo; a anterior fica preservada.',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    body: UpdateBody,
    handler: async ({ app, auth, params, body, req }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canEdit(auth, c)) throw forbidden('Você não pode editar este contrato.');
      if (c.stage === 'arquivado') throw unprocessable('Contrato arquivado não pode ser alterado.');
      if (c.validatedAt && body.version && !body.reason) throw unprocessable('Informe o motivo da alteração (fica no histórico da versão).', [{ path: 'reason', message: 'Obrigatório' }]);
      await assertUsers(app.db, auth, [body.commercialOwnerId, body.operationalOwnerId, body.csmId]);
      const out = await app.db.transaction(async (tx) => {
        const header: Partial<ContractRow> = {};
        for (const k of ['kind', 'billingType', 'legalRegime', 'commercialOwnerId', 'operationalOwnerId', 'csmId', 'legalLimitAt', 'nextAction', 'nextActionAt'] as const) if (body[k] !== undefined) (header as Record<string, unknown>)[k] = body[k];
        if (header.kind === 'privado') header.legalRegime = 'privado';
        const changedHeader = Object.keys(header).filter((k) => JSON.stringify((header as Record<string, unknown>)[k]) !== JSON.stringify((c as Record<string, unknown>)[k]));
        if (changedHeader.length) {
          await tx.update(s.contracts).set({ ...header, updatedAt: new Date(), rowVersion: sql`${s.contracts.rowVersion} + 1` }).where(eq(s.contracts.id, c.id));
          await addEvent(tx, auth.tenantId, c.id, auth.userId, 'cadastro_alterado', `Alterou ${changedHeader.join(', ')}`, { changed: changedHeader });
        }
        let version = c.currentVersion;
        if (body.version) {
          const cur = await currentVersion(tx, c);
          const patch: Record<string, unknown> = { ...body.version };
          const startAt = (patch.startAt as string | null | undefined) ?? cur.startAt;
          const termMonths = (patch.termMonths as number | null | undefined) ?? cur.termMonths;
          if ((patch.termMonths !== undefined || patch.startAt !== undefined) && patch.endAt === undefined && startAt && termMonths) patch.endAt = endFromTerm(startAt, termMonths);
          const endAt = patch.endAt === undefined ? cur.endAt : (patch.endAt as string | null);
          if (patch.endAt !== undefined && patch.endAt !== cur.endAt && patch.renewalAt === undefined && endAt) patch.renewalAt = addDays(endAt, 1);
          if (startAt && endAt && endAt < startAt) throw unprocessable('O término da vigência é anterior ao início.', [{ path: 'version.endAt', message: 'Término antes do início' }]);
          if (patch.items && patch.monthlyCents === undefined) patch.monthlyCents = (patch.items as { qty: number; unitCents: number }[]).reduce((a, i) => a + i.qty * i.unitCents, 0);
          const r = await newVersion(tx, c, auth.userId, patch as VersionPatch, 'edicao', body.reason ?? 'Ajuste no cadastro antes da validação');
          version = r.version;
        }
        return { version, changedHeader };
      });
      await audit(app.db, req, { action: 'contract.update', entityType: 'contract', entityId: c.id, metadata: { version: out.version, header: out.changedHeader, reason: body.reason } });
      return { ok: true, version: out.version };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts/:id/validate',
    summary: 'Valida o cadastro: abre a implantação, pede ERP e provisionamento ao Financeiro, avisa a entrega e passa a negociação para Sucesso do Cliente',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (c.stage !== 'cadastro_validacao') throw unprocessable('Este contrato já foi validado.');
      if (!canManage(auth)) throw forbidden('A validação é feita por Administração, Inteligência Comercial, Diretoria ou gerência.');
      const cur = await currentVersion(app.db, c);
      const missing = [
        !cur.signedAt && 'data de assinatura', !cur.startAt && 'início da vigência', !cur.endAt && 'término da vigência', c.billingType === 'recorrente' && !cur.monthlyCents && 'valor mensal',
        c.billingType === 'medicao' && !(await ledgerOf(app.db, c.id)).totals.credited && 'saldo do contrato (medição)', c.billingType !== 'medicao' && !cur.items.length && 'produtos e serviços',
        c.kind === 'publico' && !cur.publicTerms?.agency && 'órgão contratante',
      ].filter(Boolean);
      if (missing.length) throw unprocessable(`Complete antes de validar: ${missing.join(', ')}.`, missing.map((m) => ({ path: 'version', message: String(m) })));
      const cfg = await contractSettingsOf(app.db, auth.tenantId);
      const today = new Date().toISOString().slice(0, 10);
      const result = await app.db.transaction(async (tx) => {
        await tx.update(s.contracts).set({ validatedAt: new Date(), validatedBy: auth.userId, nextAction: 'Cadastrar no ERP e provisionar faturamento', nextActionAt: addDays(today, cfg.provisioningSlaDays), updatedAt: new Date(), rowVersion: sql`${s.contracts.rowVersion} + 1` }).where(eq(s.contracts.id, c.id));
        c.validatedAt = new Date();
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'validado', 'Cadastro validado', null);
        await setStage(tx, c, auth.userId, 'implantacao', 'cadastro validado; implantação iniciada');
        await openProcess(tx, c, 'implantacao', 'inicial', auth.userId, {}, addDays(today, cfg.implantationSlaDays), c.operationalOwnerId ?? c.commercialOwnerId);
        const sum = await contractSummary(tx, c, app.config);
        const client = sum.contact?.name ?? '';
        const record = async (kind: AlertKind, cycleKey: string, dueAt: string, ownerId: string | null, tasks: string[], emails: { to: string; status: string; error: string | null }[], detail: string) => {
          await tx.insert(s.contractAlerts).values({ tenantId: auth.tenantId, contractId: c.id, kind, cycleKey, dueAt, ownerId, activityIds: tasks, emails, detail }).onConflictDoNothing();
        };
        // 1. ERP: sem integração configurada, vira tarefa com referência a informar (nada é marcado como feito)
        const erpPeople = await sectorOwners(tx, auth.tenantId, ['administracao', 'financeiro'], [c.commercialOwnerId]);
        const erpTasks: string[] = [];
        for (const p of erpPeople.slice(0, 3)) erpTasks.push(await createTask(tx, c, p.id, `Cadastrar/atualizar no ERP: contrato ${cur.number} – ${client}`, `A integração automática com o ERP ainda não está configurada. Cadastre no ERP e registre o código na etapa “Cadastrar/atualizar no ERP” do contrato.\n\n${sum.text}`, new Date(`${addDays(today, 2)}T12:00:00Z`), auth.userId, 'alta'));
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'erp_solicitado', `Cadastro no ERP solicitado (integração não configurada: tarefa para ${erpPeople.map((p) => p.name).join(', ') || 'ninguém'})`, { tasks: erpTasks });
        // 2. provisionamento do faturamento (Financeiro), com e-mail
        const fin = await sectorOwners(tx, auth.tenantId, ['financeiro'], [c.commercialOwnerId]);
        const finTasks: string[] = [];
        for (const p of fin.slice(0, 3)) finTasks.push(await createTask(tx, c, p.id, `Provisionar faturamento: contrato ${cur.number} – ${client}`, sum.text, new Date(`${addDays(today, cfg.provisioningSlaDays)}T12:00:00Z`), auth.userId, 'alta'));
        const finTo = cfg.financeEmail ? [cfg.financeEmail] : fin.map((p) => p.email);
        const finMails = [];
        for (const to of finTo) finMails.push(await mailTo(tx, c, 'contrato_provisionamento', to, `Provisionamento de faturamento – Contrato ${cur.number} – ${client}`, `Solicitação de provisionamento do faturamento do contrato abaixo, validado em ${today}.\n\nDatas: assinatura ${cur.signedAt}; início da vigência ${cur.startAt}; ativação técnica ${cur.activationAt ?? 'a definir pela implantação'}; início do faturamento ${cur.billingStartAt ?? 'a definir'}.\n\n${sum.text}\n\nConfirme na etapa “Provisionamento do faturamento” do contrato.`, auth.userId));
        await record('provisionamento', today, addDays(today, cfg.provisioningSlaDays), fin[0]?.id ?? c.commercialOwnerId, finTasks, finMails, 'Provisionamento de faturamento solicitado ao Financeiro.');
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'provisionamento_solicitado', `Provisionamento solicitado ao Financeiro. E-mails: ${finMails.map((m) => `${m.to} (${m.status})`).join(', ') || 'nenhum destinatário (configure o e-mail do Financeiro)'}`, { emails: finMails, tasks: finTasks });
        // 3. implantação e entrega
        const ops = await sectorOwners(tx, auth.tenantId, ['implantacao'], [c.operationalOwnerId, c.commercialOwnerId]);
        const opsTasks: string[] = [];
        for (const p of ops.slice(0, 3)) opsTasks.push(await createTask(tx, c, p.id, `Implantação e entrega: ${client}`, sum.text, new Date(`${addDays(today, 5)}T12:00:00Z`), auth.userId));
        const opsTo = cfg.deliveryEmail ? [cfg.deliveryEmail] : ops.map((p) => p.email);
        const opsMails = [];
        for (const to of opsTo) opsMails.push(await mailTo(tx, c, 'contrato_implantacao', to, `Nova implantação – Contrato ${cur.number} – ${client}`, `Contrato validado e pronto para implantação.\n\n${sum.text}`, auth.userId));
        await record('implantacao', today, addDays(today, cfg.implantationSlaDays), ops[0]?.id ?? c.commercialOwnerId, opsTasks, opsMails, 'Time de implantação e entrega notificado.');
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'implantacao_notificada', `Implantação notificada. E-mails: ${opsMails.map((m) => `${m.to} (${m.status})`).join(', ') || 'nenhum destinatário'}`, { emails: opsMails, tasks: opsTasks });
        // 4. documento assinado
        const [signed] = await tx.select({ id: s.contractDocuments.id }).from(s.contractDocuments).where(and(eq(s.contractDocuments.contractId, c.id), eq(s.contractDocuments.category, 'CONTRATO'), eq(s.contractDocuments.signed, true), sql`${s.contractDocuments.deletedAt} is null`)).limit(1);
        if (!signed) await record('documento_pendente', `contrato:${today}`, addDays(today, 7), c.commercialOwnerId, [], [], 'Anexar o contrato assinado.');
        // 5. negociação: histórico e Sucesso do Cliente, preservando a oportunidade
        if (c.opportunityId && c.arpId) {
          // contratação decorrente de ata: fica no comercial, sem negócio novo no Sucesso do Cliente; acompanhamento por tarefas
          const ev = (type: string, payload: Record<string, unknown>) => tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: c.opportunityId!, type, actorId: auth.userId, payload: { contractId: c.id, number: cur.number, ...payload } });
          await ev('contrato_validado', {});
          await ev('erp_solicitado', { tasks: erpTasks.length });
          await ev('provisionamento_solicitado', { emails: finMails });
          await ev('implantacao_notificada', { emails: opsMails });
          await ev('ata_operacional', { arpId: c.arpId });
        } else if (c.opportunityId) {
          await tx.update(s.opportunities).set({ handoffStage: 'sucesso_cliente', updatedAt: new Date() }).where(eq(s.opportunities.id, c.opportunityId));
          const ev = (type: string, payload: Record<string, unknown>) => tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: c.opportunityId!, type, actorId: auth.userId, payload: { contractId: c.id, number: cur.number, ...payload } });
          await ev('contrato_validado', {});
          await ev('erp_solicitado', { tasks: erpTasks.length });
          await ev('provisionamento_solicitado', { emails: finMails });
          await ev('implantacao_notificada', { emails: opsMails });
          await ev('sucesso_cliente', {});
        }
        return { erp: { status: 'pendente_integracao', tasks: erpTasks.length }, provisioning: { emails: finMails, tasks: finTasks.length }, delivery: { emails: opsMails, tasks: opsTasks.length } };
      });
      await audit(app.db, req, { action: 'contract.validate', entityType: 'contract', entityId: c.id, metadata: result });
      return { ok: true, ...result };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts/:id/stage',
    summary: 'Move o contrato no funil. Renovação, reajuste e encerramento abrem o processo correspondente; arquivar só pelo encerramento.',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    body: z.object({ stage: z.enum(CONTRACT_STAGES), reason: z.string().trim().max(500).optional(), closureAt: day.optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canEdit(auth, c)) throw forbidden('Você não pode mover este contrato.');
      if (c.stage === body.stage) return { ok: true };
      if (c.stage === 'cadastro_validacao') throw unprocessable('Valide o cadastro para iniciar o fluxo do contrato.');
      if (body.stage === 'cadastro_validacao') throw unprocessable('Contrato validado não volta para cadastro. Edite gerando nova versão.');
      if (body.stage === 'arquivado') throw unprocessable('O arquivamento acontece ao concluir o processo de encerramento, com as validações.');
      if (c.stage === 'arquivado') throw unprocessable('Contrato arquivado.');
      const cur = await currentVersion(app.db, c);
      const today = new Date().toISOString().slice(0, 10);
      await app.db.transaction(async (tx) => {
        if (body.stage === 'renovacao') await openProcess(tx, c, 'renovacao', cur.endAt ?? today, auth.userId, { previousEndAt: cur.endAt, kind: c.kind, legalRegime: c.legalRegime, manual: true }, cur.endAt);
        if (body.stage === 'reajuste') await openProcess(tx, c, 'reajuste', cur.adjustmentBaseDate ? nextAnniversary(cur.adjustmentBaseDate, today) : `manual:${today}`, auth.userId, { baseDate: cur.adjustmentBaseDate, index: cur.adjustmentIndex, rule: cur.adjustmentRule, currentCents: cur.monthlyCents, manual: true });
        if (body.stage === 'encerramento') {
          if (!body.reason || body.reason.length < 3) throw unprocessable('Informe o motivo do encerramento.', [{ path: 'reason', message: 'Obrigatório' }]);
          const at = body.closureAt ?? cur.endAt ?? today;
          await tx.update(s.contracts).set({ closureExpected: true, closureReason: body.reason, closureAt: at }).where(eq(s.contracts.id, c.id));
          await openProcess(tx, c, 'encerramento', at, auth.userId, { reason: body.reason, closingAt: at, manual: true }, at);
          await addEvent(tx, auth.tenantId, c.id, auth.userId, 'encerramento_previsto', `Encerramento previsto para ${at}: ${body.reason}`, null);
        }
        await setStage(tx, c, auth.userId, body.stage, body.reason ? `${CONTRACT_STAGE_LABELS[body.stage]} — ${body.reason}` : CONTRACT_STAGE_LABELS[body.stage]);
      });
      await audit(app.db, req, { action: 'contract.stage', entityType: 'contract', entityId: c.id, metadata: { from: c.stage, to: body.stage, reason: body.reason } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/admin/contract-settings',
    summary: 'Parâmetros de contratos: prazos dos alertas, e-mails, assuntos e modelo do ofício',
    tag: 'Contratos',
    module: 'configuracoes',
    min: 'total',
    handler: async ({ app, auth }) => contractSettingsOf(app.db, auth.tenantId),
  }),
  defineRoute({
    method: 'PUT',
    url: '/admin/contract-settings',
    summary: 'Salva os parâmetros de contratos',
    tag: 'Contratos',
    module: 'configuracoes',
    min: 'total',
    body: z.object({
      renewalAlertDays: z.number().int().min(1).max(365), closureNoticeDays: z.number().int().min(1).max(365), closureFinalDays: z.number().int().min(1).max(365),
      guaranteeAlertDays: z.number().int().min(1).max(365), adjustmentAlertDays: z.number().int().min(1).max(365),
      provisioningSlaDays: z.number().int().min(1).max(90), implantationSlaDays: z.number().int().min(1).max(365), signatureSlaDays: z.number().int().min(1).max(90),
      ccEmail: z.string().trim().email().max(200), financeEmail: z.string().trim().email().max(200).nullable(), deliveryEmail: z.string().trim().email().max(200).nullable(),
      renewalSubject: z.string().trim().min(5).max(200), closureSubject: z.string().trim().min(5).max(200),
      oficioTemplate: z.string().trim().min(20).max(20_000), oficioTemplateId: uuid.nullable(),
    }),
    handler: async ({ app, auth, body, req }) => {
      if (body.closureFinalDays >= body.closureNoticeDays) throw unprocessable('O segundo aviso de encerramento precisa ser mais perto da data que o primeiro.');
      if (body.oficioTemplateId) {
        const [t] = await app.db.select({ id: s.proposalTemplates.id }).from(s.proposalTemplates).where(and(eq(s.proposalTemplates.id, body.oficioTemplateId), eq(s.proposalTemplates.tenantId, auth.tenantId))).limit(1);
        if (!t) throw unprocessable('Modelo institucional não encontrado.');
      }
      await app.db.insert(s.contractSettings).values({ tenantId: auth.tenantId, settings: body, updatedBy: auth.userId }).onConflictDoUpdate({ target: s.contractSettings.tenantId, set: { settings: body, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'contract.settings', entityType: 'tenant', entityId: auth.tenantId, metadata: { renewalAlertDays: body.renewalAlertDays, closureNoticeDays: body.closureNoticeDays } });
      return { ok: true };
    },
  }),
];

