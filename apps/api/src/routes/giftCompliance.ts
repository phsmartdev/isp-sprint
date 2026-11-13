/**
 * Marketing → Brindes → Compliance: solicitações de brindes, kits, materiais, apoios e patrocínios com avaliação automática
 * das diretrizes, decisão por alçada (segregação de funções), reserva e execução (baixa única do estoque), registro na conta,
 * evidências, indicadores e a prestação de contas da Gestão Comercial (PDF guardado). Nada é apagado.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  allowedDecisions, ATTENTION_SITUATIONS, complianceKpis, currentRules, KIT_CATEGORIES, CONCESSION_DECISIONS, CONCESSION_KINDS, CONCESSION_PURPOSES, CONCESSION_STATES, CONTROL_TYPES, deliveryNeeds, RULE_PARAMS, splitEvenly, stockShortages,
  type ApproverLevel, type ConcessionKind, type ConcessionPurpose, type Evaluation,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { todayIn } from '../services/vacations';
import { assertAccount } from './stakeholders';
import {
  accountConcessions, allRules, budgetAvailable, recipientsOf, detectedAttention, canConfigure, canReport, canSeeRequest, COMPLIANCE_EVENTS, decidersFor, evaluate, isComplete, levelsOf, notifyCompliance, pendenciesOf, seesAll, settingsOf,
  type EvalInput, type Req,
} from '../services/giftCompliance';
import { buildComplianceReport } from '../services/giftComplianceReport';
import { letterheadForBranch } from '../services/contractErp';

/** Solicitar e acompanhar as próprias é de todos (Operação Comercial e Marketing); o que cada um vê e decide é filtrado no servidor. */
const READ = { tag: 'Marketing', anyAuthenticated: true as const };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const uuid = z.string().uuid();
const lockBrindes = (db: DbOrTx, tenantId: string) => db.execute(sql`select pg_advisory_xact_lock(hashtext(${`brindes:${tenantId}`}))`);

const RequestBody = z.object({
  kind: z.enum(CONCESSION_KINDS), purpose: z.enum(CONCESSION_PURPOSES).default('relacionamento'),
  orgUnitId: uuid.nullable().optional(), institutionalClass: z.string().trim().max(120).nullable().optional(),
  campaignId: uuid.nullable().optional(), opportunityId: uuid.nullable().optional(), eventName: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(5, 'Descreva a concessão').max(2000), justification: z.string().trim().min(10, 'Justifique (mínimo 10 caracteres)').max(4000),
  plannedOn: isoDate, kitId: uuid.nullable().optional(), kits: z.number().int().min(0).max(10_000).default(0),
  items: z.array(z.object({ itemId: uuid, qty: z.number().int().min(1).max(100_000) })).max(50).default([]),
  estimatedCents: z.number().int().min(0).max(2_000_000_000),
  costCenterId: uuid.nullable().optional(), budgetLineId: uuid.nullable().optional(),
  /** política: categoria do kit, destinatários (stakeholders das contas), entrega coletiva e situações de atenção declaradas */
  kitCategory: z.enum(KIT_CATEGORIES).nullable().optional(), stakeholderIds: z.array(uuid).max(200).default([]),
  collective: z.boolean().default(false), audience: z.string().trim().max(300).nullable().optional(), attention: z.array(z.enum(ATTENTION_SITUATIONS)).max(13).default([]),
  /** contas beneficiadas; sem share = rateio igual */
  accounts: z.array(z.object({ contactId: uuid, shareCents: z.number().int().min(0).nullable().optional() })).max(30).default([]),
});
type Body = z.infer<typeof RequestBody>;

async function nextCode(db: DbOrTx, tenantId: string, year: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`gc-code:${tenantId}:${year}`}))`);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.giftRequests).where(and(eq(s.giftRequests.tenantId, tenantId), sql`${s.giftRequests.code} like ${`GC-${year}-%`}`));
  return `GC-${year}-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}

/** Contas e rateio: soma das partes = valor (sem dupla contagem); sem conta só ação institucional classificada. */
function shares(body: Pick<Body, 'accounts' | 'estimatedCents' | 'purpose' | 'institutionalClass'>) {
  const ids = body.accounts.map((a) => a.contactId);
  if (new Set(ids).size !== ids.length) throw unprocessable('A mesma conta aparece duas vezes.');
  if (!ids.length) {
    if (!body.institutionalClass?.trim()) throw unprocessable('Sem conta beneficiada, classifique a ação institucional.', [{ path: 'institutionalClass', message: 'Obrigatório sem conta' }]);
    return [];
  }
  const given = body.accounts.every((a) => a.shareCents != null);
  if (given) {
    const sum = body.accounts.reduce((t, a) => t + (a.shareCents ?? 0), 0);
    if (sum !== body.estimatedCents) throw unprocessable(`O rateio (${(sum / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) precisa somar o valor da concessão.`, [{ path: 'accounts', message: 'Rateio diferente do total' }]);
    return body.accounts.map((a) => ({ contactId: a.contactId, shareCents: a.shareCents! }));
  }
  const parts = splitEvenly(body.estimatedCents, ids.length);
  return ids.map((id, i) => ({ contactId: id, shareCents: parts[i]! }));
}

async function validateRefs(db: DbOrTx, auth: AuthContext, body: Body) {
  for (const a of body.accounts) await assertAccount(db, auth, a.contactId);
  const one = async (table: typeof s.campaigns | typeof s.opportunities | typeof s.giftKits | typeof s.orgUnits | typeof s.costCenters | typeof s.budgetLines, id: string | null | undefined, what: string) => {
    if (!id) return;
    const [x] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.tenantId, auth.tenantId))).limit(1);
    if (!x) throw unprocessable(`${what} não encontrado(a).`);
  };
  await one(s.campaigns, body.campaignId, 'Campanha'); await one(s.opportunities, body.opportunityId, 'Oportunidade'); await one(s.giftKits, body.kitId, 'Kit');
  await one(s.orgUnits, body.orgUnitId, 'Unidade de negócio'); await one(s.costCenters, body.costCenterId, 'Centro de custo'); await one(s.budgetLines, body.budgetLineId, 'Lançamento de orçamento');
  if (body.items.length) {
    const found = await db.select({ id: s.giftItems.id }).from(s.giftItems).where(and(inArray(s.giftItems.id, body.items.map((i) => i.itemId)), eq(s.giftItems.tenantId, auth.tenantId)));
    if (found.length !== new Set(body.items.map((i) => i.itemId)).size) throw unprocessable('Item não encontrado.');
  }
  if (body.kitId && body.kits < 1) throw unprocessable('Informe quantos kits.');
  if (body.kind === 'patrocinio_financeiro' && (body.kitId || body.items.length)) throw unprocessable('Patrocínio financeiro não leva itens do estoque.');
  if (body.purpose === 'campanha' && !body.campaignId) throw unprocessable('Escolha a campanha.', [{ path: 'campaignId', message: 'Obrigatório' }]);
  if (body.purpose === 'oportunidade' && !body.opportunityId) throw unprocessable('Escolha a oportunidade.', [{ path: 'opportunityId', message: 'Obrigatório' }]);
  if (body.purpose === 'evento' && !body.eventName) throw unprocessable('Informe o evento.', [{ path: 'eventName', message: 'Obrigatório' }]);
}

type Recipient = { stakeholderId: string; contactId: string; name: string; title: string | null; powerClass: string };
const evalInput = (body: Pick<Body, 'kind' | 'purpose' | 'estimatedCents' | 'kitId' | 'kits' | 'items' | 'budgetLineId' | 'plannedOn' | 'kitCategory' | 'collective' | 'attention'>, accs: { contactId: string; shareCents: number }[], recipients: Recipient[]): EvalInput => ({
  kind: body.kind as ConcessionKind, purpose: body.purpose as ConcessionPurpose, totalCents: body.estimatedCents, kitId: body.kitId ?? null, kits: body.kits, items: body.items, accounts: accs, budgetLineId: body.budgetLineId ?? null, on: body.plannedOn,
  kitCategory: body.kitCategory ?? null, recipients, collective: body.collective, attention: body.attention,
});
async function recipientsFor(db: DbOrTx, auth: AuthContext, body: Pick<Body, 'stakeholderIds' | 'collective' | 'audience'>, accs: { contactId: string }[]) {
  if (body.collective && !body.audience?.trim()) throw unprocessable('Na entrega coletiva, descreva o grupo (evento, órgão, público).', [{ path: 'audience', message: 'Obrigatório' }]);
  const r = await recipientsOf(db, auth.tenantId, body.stakeholderIds, accs.map((a) => a.contactId));
  if (r === null) throw unprocessable('Escolha stakeholders das contas beneficiadas.');
  return r;
}

async function loadReq(db: DbOrTx, auth: AuthContext, id: string, lock = false) {
  const q = db.select().from(s.giftRequests).where(and(eq(s.giftRequests.id, id), eq(s.giftRequests.tenantId, auth.tenantId))).limit(1);
  const [r] = lock ? await q.for('update') : await q;
  if (!r || !canSeeRequest(auth, r.requesterId)) throw notFound('Solicitação não encontrada.');
  return r;
}
const logEv = (db: DbOrTx, auth: AuthContext, r: Pick<Req, 'id'>, type: string, text: string, data?: Record<string, unknown>) =>
  db.insert(s.giftRequestEvents).values({ tenantId: auth.tenantId, requestId: r.id, type, text, data: data ?? null, actorId: auth.userId });

/** Quem precisa decidir: a alçada da avaliação (ou a das conformes). */
const neededLevel = (ev: Pick<Evaluation, 'outcome' | 'level'>, conforming: ApproverLevel): ApproverLevel | null => (ev.outcome === 'impedido' ? null : ev.outcome === 'conforme' ? conforming : ev.level);

async function notifyNew(db: DbOrTx, config: Parameters<typeof notifyCompliance>[1], auth: AuthContext, r: Req, ev: Evaluation, conforming: ApproverLevel, cycle: number) {
  const level = neededLevel(ev, conforming);
  const who = await decidersFor(db, auth.tenantId, level ?? 'gerencia');
  const out = ev.outcome !== 'conforme';
  await notifyCompliance(db, config, auth.tenantId, who, { event: out ? 'fora_parametros' : 'aguardando', title: `${out ? 'Fora dos parâmetros' : 'Aguardando autorização'}: ${r.code} ${r.description.slice(0, 80)}`, body: ev.findings.map((f) => f.name).join(' · ') || null, requestId: r.id, key: `novo:${r.id}:${cycle}`, actorId: auth.userId });
}

// ------------------------------------------------------------------ listagem, indicadores e pendências
const ListQuery = z.object({
  from: isoDate.optional(), to: isoDate.optional(), contactId: uuid.optional(), orgUnitId: uuid.optional(), kind: z.enum(CONCESSION_KINDS).optional(),
  state: z.enum(CONCESSION_STATES).optional(), requesterId: uuid.optional(), outcome: z.enum(['conforme', 'autorizacao', 'excecao', 'impedido', 'excecao_autorizada']).optional(),
});

export async function complianceData(db: DbOrTx, auth: AuthContext, q: z.infer<typeof ListQuery>) {
  const today = todayIn(auth.timezone);
  const from = q.from ?? `${today.slice(0, 4)}-01-01`, to = q.to ?? today;
  let rows = await db.select({ r: s.giftRequests, requester: s.users.name }).from(s.giftRequests).innerJoin(s.users, eq(s.users.id, s.giftRequests.requesterId))
    .where(and(eq(s.giftRequests.tenantId, auth.tenantId), sql`coalesce(${s.giftRequests.executedOn}, ${s.giftRequests.plannedOn}) between ${from} and ${to}`,
      q.orgUnitId ? eq(s.giftRequests.orgUnitId, q.orgUnitId) : undefined, q.kind ? eq(s.giftRequests.kind, q.kind) : undefined, q.state ? eq(s.giftRequests.state, q.state) : undefined,
      q.requesterId ? eq(s.giftRequests.requesterId, q.requesterId) : undefined,
      q.outcome === 'excecao_autorizada' ? eq(s.giftRequests.exception, true) : q.outcome ? eq(s.giftRequests.outcome, q.outcome) : undefined))
    .orderBy(desc(s.giftRequests.plannedOn), desc(s.giftRequests.createdAt));
  rows = rows.filter((x) => canSeeRequest(auth, x.r.requesterId));
  const ids = rows.map((x) => x.r.id);
  const [accs, docs, decs] = ids.length ? await Promise.all([
    db.select({ a: s.giftRequestAccounts, name: s.contacts.name }).from(s.giftRequestAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.giftRequestAccounts.contactId)).where(inArray(s.giftRequestAccounts.requestId, ids)),
    db.select({ requestId: s.giftRequestDocuments.requestId, kind: s.giftRequestDocuments.kind }).from(s.giftRequestDocuments).where(inArray(s.giftRequestDocuments.requestId, ids)),
    db.select({ requestId: s.giftRequestDecisions.requestId, decision: s.giftRequestDecisions.decision, deciderId: s.giftRequestDecisions.deciderId, at: s.giftRequestDecisions.createdAt }).from(s.giftRequestDecisions).where(inArray(s.giftRequestDecisions.requestId, ids)).orderBy(asc(s.giftRequestDecisions.createdAt)),
  ]) : [[], [], []];
  if (q.contactId) rows = rows.filter((x) => accs.some((a) => a.a.requestId === x.r.id && a.a.contactId === q.contactId));
  // pago no orçamento (patrocínio financeiro com lançamento)
  const lineIds = [...new Set(rows.map((x) => x.r.budgetLineId).filter((x): x is string => !!x))];
  const paid = new Map<string, number>();
  for (const id of lineIds) { const b = await budgetAvailable(db, auth.tenantId, id, today); if (b) paid.set(id, b.paid); }
  const full = rows.map((x) => {
    const myDocs = docs.filter((d) => d.requestId === x.r.id).map((d) => d.kind);
    const approvals = decs.filter((d) => d.requestId === x.r.id && (d.decision === 'aprovar' || d.decision === 'aprovar_excecao'));
    return { ...x.r, requesterName: x.requester, docKinds: myDocs, decided: approvals.length > 0, paidCents: x.r.budgetLineId ? paid.get(x.r.budgetLineId) ?? null : null, accounts: accs.filter((a) => a.a.requestId === x.r.id).map((a) => ({ contactId: a.a.contactId, name: a.name, shareCents: a.a.shareCents })) };
  });
  const executed = full.filter((r) => r.state === 'executado');
  const pend = pendenciesOf(full, today);
  const kpis = complianceKpis(executed.map((r) => ({ totalCents: r.executedCents ?? 0, accountIds: r.accounts.map((a) => a.contactId), exception: r.exception, complete: isComplete(r, r.decided, r.docKinds) })), pend.length);
  const byKind = Object.fromEntries(CONCESSION_KINDS.map((k) => [k, { count: executed.filter((r) => r.kind === k).length, cents: executed.filter((r) => r.kind === k).reduce((t, r) => t + (r.executedCents ?? 0), 0) }]));
  return { from, to, today, rows: full, kpis, byKind, pendencies: pend, totals: { requested: full.filter((r) => r.state === 'solicitado' || r.state === 'ajustes').reduce((t, r) => t + r.estimatedCents, 0), approved: full.filter((r) => ['aprovado', 'reservado', 'executado'].includes(r.state)).reduce((t, r) => t + (r.approvedCents ?? 0), 0), realized: kpis.realizedCents } };
}

export const giftComplianceRoutes = [
  defineRoute({
    method: 'GET', url: '/brindes/compliance', summary: 'Compliance: indicadores (só executadas), pendências de controle, concessões filtradas e o que a pessoa pode fazer', ...READ,
    query: ListQuery,
    handler: async ({ app, auth, query }) => {
      const d = await complianceData(app.db, auth, query);
      const st = await settingsOf(app.db, auth.tenantId);
      const rules = await allRules(app.db, auth.tenantId);
      const units = await app.db.select({ id: s.orgUnits.id, name: s.orgUnits.name, kind: s.orgUnits.kind }).from(s.orgUnits).where(eq(s.orgUnits.tenantId, auth.tenantId)).orderBy(asc(s.orgUnits.name));
      const requesters = [...new Map(d.rows.map((r) => [r.requesterId, r.requesterName])).entries()].map(([id, name]) => ({ id, name }));
      return {
        ...d,
        rows: d.rows.map((r) => ({ id: r.id, code: r.code, kind: r.kind, purpose: r.purpose, description: r.description, plannedOn: r.plannedOn, executedOn: r.executedOn, state: r.state, outcome: r.outcome, exception: r.exception, estimatedCents: r.estimatedCents, approvedCents: r.approvedCents, executedCents: r.executedCents, requesterId: r.requesterId, requesterName: r.requesterName, accounts: r.accounts, institutionalClass: r.institutionalClass, complete: isComplete(r, r.decided, r.docKinds), orgUnitId: r.orgUnitId })),
        options: { units, requesters },
        can: { create: true, decideLevels: levelsOf(auth), configure: canConfigure(auth), report: canReport(auth), seesAll: seesAll(auth) },
        policy: { configured: currentRules(rules, d.today).length > 0, rules: currentRules(rules, d.today).length, segregation: st.segregation, conformingLevel: st.conformingLevel, note: st.policyNote },
      };
    },
  }),

  defineRoute({
    method: 'POST', url: '/brindes/compliance/avaliar', summary: 'Avalia uma solicitação antes de enviar (diretrizes vigentes, histórico das contas e estoque), sem gravar', ...READ,
    body: RequestBody.partial({ description: true, justification: true }),
    handler: async ({ app, auth, body }) => {
      const b = { ...body, description: body.description ?? 'prévia', justification: body.justification ?? 'prévia da avaliação' } as Body;
      for (const a of b.accounts) await assertAccount(app.db, auth, a.contactId);
      const accs = b.accounts.length ? shares({ ...b, institutionalClass: b.institutionalClass ?? 'prévia' }) : [];
      const today = todayIn(auth.timezone);
      const rec = await recipientsFor(app.db, auth, { stakeholderIds: b.stakeholderIds ?? [], collective: !!b.collective, audience: b.audience ?? (b.collective ? 'prévia' : null) }, accs);
      const ev = await evaluate(app.db, auth.tenantId, evalInput({ ...b, attention: b.attention ?? [], collective: !!b.collective }, accs, rec), null, today);
      const st = await settingsOf(app.db, auth.tenantId);
      const names = accs.length ? await app.db.select({ id: s.contacts.id, name: s.contacts.name, nature: s.contacts.nature }).from(s.contacts).where(inArray(s.contacts.id, accs.map((a) => a.contactId))) : [];
      const hist = await accountConcessions(app.db, auth.tenantId, accs.map((a) => a.contactId));
      return { evaluation: ev, level: neededLevel(ev, st.conformingLevel), accounts: accs.map((a) => ({ ...a, name: names.find((n) => n.id === a.contactId)?.name ?? '', nature: names.find((n) => n.id === a.contactId)?.nature ?? null, history: hist.find((h) => h.contactId === a.contactId) })), budget: await budgetAvailable(app.db, auth.tenantId, b.budgetLineId ?? null, today) };
    },
  }),

  defineRoute({
    method: 'POST', url: '/brindes/compliance/solicitacoes', summary: 'Registra a solicitação: avalia as diretrizes vigentes e encaminha à alçada (restrição obrigatória fica impedida)', ...READ,
    body: RequestBody,
    handler: async ({ app, auth, body, reply, req }) => {
      await validateRefs(app.db, auth, body);
      const accs = shares(body);
      const today = todayIn(auth.timezone);
      const st = await settingsOf(app.db, auth.tenantId);
      const rec = await recipientsFor(app.db, auth, body, accs);
      const r = await app.db.transaction(async (tx) => {
        const ev = await evaluate(tx, auth.tenantId, evalInput(body, accs, rec), null, today);
        const code = await nextCode(tx, auth.tenantId, body.plannedOn.slice(0, 4));
        const [row] = await tx.insert(s.giftRequests).values({
          tenantId: auth.tenantId, code, requesterId: auth.userId, orgUnitId: body.orgUnitId ?? null, kind: body.kind, purpose: body.purpose, institutionalClass: accs.length ? null : body.institutionalClass ?? null,
          campaignId: body.campaignId ?? null, opportunityId: body.opportunityId ?? null, eventName: body.eventName ?? null, description: body.description, justification: body.justification, plannedOn: body.plannedOn,
          kitId: body.kitId ?? null, kits: body.kitId ? body.kits : 0, items: body.items, estimatedCents: body.estimatedCents, costCenterId: body.costCenterId ?? null, budgetLineId: body.budgetLineId ?? null,
          kitCategory: body.kitCategory ?? null, recipients: rec, collective: body.collective, audience: body.audience ?? null, attention: body.attention,
          evaluation: ev as unknown as Record<string, unknown>, outcome: ev.outcome,
        }).returning();
        if (accs.length) await tx.insert(s.giftRequestAccounts).values(accs.map((a) => ({ requestId: row!.id, contactId: a.contactId, shareCents: a.shareCents })));
        await logEv(tx, auth, row!, 'criada', `Solicitação registrada (${(body.estimatedCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`, { accounts: accs });
        await logEv(tx, auth, row!, 'avaliada', ev.findings.length ? `Avaliação: ${ev.findings.map((f) => f.name).join('; ')}.` : 'Avaliação: dentro das diretrizes vigentes.', { evaluation: ev });
        await audit(tx, req, { action: 'gift_request.create', entityType: 'gift_request', entityId: row!.id, metadata: { code, outcome: ev.outcome } });
        await notifyNew(tx, app.config, auth, row!, ev, st.conformingLevel, 1);
        return row!;
      });
      reply.code(201);
      return r;
    },
  }),

  defineRoute({
    method: 'GET', url: '/brindes/compliance/solicitacoes/:id', summary: 'Solicitação completa: contas e histórico delas, avaliação, decisões, eventos, documentos, estoque e orçamento vinculado', ...READ, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const r = await loadReq(app.db, auth, params.id);
      const today = todayIn(auth.timezone);
      const st = await settingsOf(app.db, auth.tenantId);
      const [accs, decisions, events, docs, people, kit, items] = await Promise.all([
        app.db.select({ a: s.giftRequestAccounts, name: s.contacts.name, nature: s.contacts.nature }).from(s.giftRequestAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.giftRequestAccounts.contactId)).where(eq(s.giftRequestAccounts.requestId, r.id)),
        app.db.select({ d: s.giftRequestDecisions, name: s.users.name }).from(s.giftRequestDecisions).innerJoin(s.users, eq(s.users.id, s.giftRequestDecisions.deciderId)).where(eq(s.giftRequestDecisions.requestId, r.id)).orderBy(asc(s.giftRequestDecisions.createdAt)),
        app.db.select({ e: s.giftRequestEvents, name: s.users.name }).from(s.giftRequestEvents).leftJoin(s.users, eq(s.users.id, s.giftRequestEvents.actorId)).where(eq(s.giftRequestEvents.requestId, r.id)).orderBy(asc(s.giftRequestEvents.createdAt)),
        app.db.select({ id: s.giftRequestDocuments.id, kind: s.giftRequestDocuments.kind, name: s.giftRequestDocuments.name, size: s.giftRequestDocuments.size, at: s.giftRequestDocuments.createdAt }).from(s.giftRequestDocuments).where(eq(s.giftRequestDocuments.requestId, r.id)).orderBy(asc(s.giftRequestDocuments.createdAt)),
        app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, [r.requesterId, ...(r.executorId ? [r.executorId] : [])]))),
        r.kitId ? app.db.select().from(s.giftKits).where(eq(s.giftKits.id, r.kitId)).limit(1) : Promise.resolve([]),
        app.db.select({ id: s.giftItems.id, name: s.giftItems.name, stock: s.giftItems.stock, unitCostCents: s.giftItems.unitCostCents }).from(s.giftItems).where(eq(s.giftItems.tenantId, auth.tenantId)),
      ]);
      const needs = deliveryNeeds(kit[0]?.items ?? null, kit[0] ? r.kits : 0, r.items);
      // reservado por outras solicitações (não baixa estoque: compromete)
      const reservedRows = await app.db.select().from(s.giftRequests).where(and(eq(s.giftRequests.tenantId, auth.tenantId), eq(s.giftRequests.state, 'reservado'), sql`${s.giftRequests.id} <> ${r.id}`));
      const kitsById = new Map((reservedRows.some((x) => x.kitId) ? await app.db.select().from(s.giftKits).where(inArray(s.giftKits.id, reservedRows.map((x) => x.kitId).filter((x): x is string => !!x))) : []).map((k) => [k.id, k]));
      const reservedQty = new Map<string, number>();
      for (const x of reservedRows) for (const n of deliveryNeeds(x.kitId ? kitsById.get(x.kitId)?.items ?? null : null, x.kits, x.items)) reservedQty.set(n.itemId, (reservedQty.get(n.itemId) ?? 0) + n.qty);
      const stock = needs.map((n) => { const it = items.find((i) => i.id === n.itemId); const reserved = reservedQty.get(n.itemId) ?? 0; return { itemId: n.itemId, name: it?.name ?? 'Item', need: n.qty, stock: it?.stock ?? 0, reservedByOthers: reserved, available: (it?.stock ?? 0) - reserved, unitCostCents: it?.unitCostCents ?? 0 }; });
      const ev = r.evaluation as unknown as Evaluation;
      const myLevels = levelsOf(auth);
      const allowed = ['solicitado'].includes(r.state) ? allowedDecisions(ev, myLevels, st.conformingLevel) : { decisions: [], reason: null };
      const segregated = st.segregation && r.requesterId === auth.userId && allowed.decisions.length > 0;
      const hist = await accountConcessions(app.db, auth.tenantId, accs.map((a) => a.a.contactId));
      const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
      return {
        request: { ...r, requesterName: name(r.requesterId), executorName: name(r.executorId), kitName: kit[0]?.name ?? null },
        accounts: accs.map((a) => ({ contactId: a.a.contactId, name: a.name, nature: a.nature, shareCents: a.a.shareCents, history: hist.find((h) => h.contactId === a.a.contactId) })),
        evaluation: ev, level: neededLevel(ev, st.conformingLevel),
        decisions: decisions.map((d) => ({ ...d.d, deciderName: d.name })),
        events: events.map((e) => ({ ...e.e, actorName: e.name })),
        documents: docs, stock, budget: await budgetAvailable(app.db, auth.tenantId, r.budgetLineId, today),
        can: {
          decide: segregated ? [] : allowed.decisions, decideReason: segregated ? 'Segregação de funções: quem solicitou não decide a própria solicitação.' : allowed.reason,
          edit: (['solicitado', 'ajustes', 'aprovado', 'reservado'].includes(r.state)) && (r.requesterId === auth.userId || myLevels.length > 0),
          reserve: r.state === 'aprovado' && stock.length > 0, execute: r.state === 'aprovado' || r.state === 'reservado', cancel: !['cancelado', 'rejeitado'].includes(r.state),
          upload: r.state !== 'cancelado',
        },
      };
    },
  }),

  defineRoute({
    method: 'PATCH', url: '/brindes/compliance/solicitacoes/:id', summary: 'Altera a solicitação (versão otimista). Mudança de valor, contas, finalidade ou itens depois da aprovação reavalia e volta para autorização', ...READ, params: IdParams,
    body: RequestBody.extend({ rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body, req }) => {
      await validateRefs(app.db, auth, body);
      const accs = shares(body);
      const today = todayIn(auth.timezone);
      const st = await settingsOf(app.db, auth.tenantId);
      const rec = await recipientsFor(app.db, auth, body, accs);
      return app.db.transaction(async (tx) => {
        const r = await loadReq(tx, auth, params.id, true);
        if (r.rowVersion !== body.rowVersion) throw conflict(r.rowVersion);
        if (!['solicitado', 'ajustes', 'aprovado', 'reservado'].includes(r.state)) throw unprocessable('Executada, rejeitada ou cancelada não pode ser alterada.');
        if (r.requesterId !== auth.userId && !levelsOf(auth).length) throw forbidden('Só quem solicitou ou a gestão altera a solicitação.');
        const before = await tx.select().from(s.giftRequestAccounts).where(eq(s.giftRequestAccounts.requestId, r.id));
        const material = r.estimatedCents !== body.estimatedCents || r.purpose !== body.purpose || r.kind !== body.kind || JSON.stringify(r.items) !== JSON.stringify(body.items) || r.kitId !== (body.kitId ?? null) || r.kits !== (body.kitId ? body.kits : 0)
          || JSON.stringify(before.map((a) => [a.contactId, a.shareCents]).sort()) !== JSON.stringify(accs.map((a) => [a.contactId, a.shareCents]).sort())
          || (r.kitCategory ?? null) !== (body.kitCategory ?? null) || JSON.stringify(r.recipients.map((x) => x.stakeholderId).sort()) !== JSON.stringify(rec.map((x) => x.stakeholderId).sort());
        const ev = await evaluate(tx, auth.tenantId, evalInput(body, accs, rec), r.id, today);
        const afterApproval = r.state === 'aprovado' || r.state === 'reservado';
        const backToApproval = r.state === 'ajustes' || (afterApproval && material);
        const [u] = await tx.update(s.giftRequests).set({
          orgUnitId: body.orgUnitId ?? null, kind: body.kind, purpose: body.purpose, institutionalClass: accs.length ? null : body.institutionalClass ?? null, campaignId: body.campaignId ?? null, opportunityId: body.opportunityId ?? null, eventName: body.eventName ?? null,
          description: body.description, justification: body.justification, plannedOn: body.plannedOn, kitId: body.kitId ?? null, kits: body.kitId ? body.kits : 0, items: body.items, estimatedCents: body.estimatedCents,
          costCenterId: body.costCenterId ?? null, budgetLineId: body.budgetLineId ?? null,
          kitCategory: body.kitCategory ?? null, recipients: rec, collective: body.collective, audience: body.audience ?? null, attention: body.attention,
          // aprovada sem mudança material mantém a avaliação da época da decisão
          ...(afterApproval && !material ? {} : { evaluation: ev as unknown as Record<string, unknown>, outcome: ev.outcome }),
          ...(backToApproval ? { state: 'solicitado', approvedCents: null, exception: false, reservedAt: null } : {}),
          rowVersion: r.rowVersion + 1, updatedAt: new Date(),
        }).where(eq(s.giftRequests.id, r.id)).returning();
        await tx.delete(s.giftRequestAccounts).where(eq(s.giftRequestAccounts.requestId, r.id));
        if (accs.length) await tx.insert(s.giftRequestAccounts).values(accs.map((a) => ({ requestId: r.id, contactId: a.contactId, shareCents: a.shareCents })));
        await logEv(tx, auth, r, 'alterada', `Solicitação alterada${material ? ' (valor, contas, finalidade ou itens)' : ''}.`, { before: { estimatedCents: r.estimatedCents, purpose: r.purpose, kind: r.kind, items: r.items, kitId: r.kitId, kits: r.kits, accounts: before.map((a) => ({ contactId: a.contactId, shareCents: a.shareCents })) }, after: { estimatedCents: body.estimatedCents, purpose: body.purpose, kind: body.kind, items: body.items, kitId: body.kitId, kits: body.kits, accounts: accs } });
        if (!(afterApproval && !material)) await logEv(tx, auth, r, 'avaliada', ev.findings.length ? `Reavaliação: ${ev.findings.map((f) => f.name).join('; ')}.` : 'Reavaliação: dentro das diretrizes vigentes.', { evaluation: ev });
        if (afterApproval && material) await logEv(tx, auth, r, 'reautorizacao', 'Mudança material depois da aprovação: a aprovação anterior fica no histórico e a solicitação volta para autorização.');
        await audit(tx, req, { action: 'gift_request.update', entityType: 'gift_request', entityId: r.id, metadata: { material, backToApproval } });
        if (backToApproval) await notifyNew(tx, app.config, auth, u!, ev, st.conformingLevel, u!.rowVersion);
        return u;
      });
    },
  }),

  defineRoute({
    method: 'POST', url: '/brindes/compliance/solicitacoes/:id/decidir', summary: 'Decide pela alçada: aprovar, aprovar excepcionalmente (com fundamentação), pedir ajustes ou rejeitar. Validado no servidor (alçada e segregação)', ...READ, params: IdParams,
    body: z.object({ decision: z.enum(CONCESSION_DECISIONS), reason: z.string().trim().max(4000).nullable().optional(), conditions: z.string().trim().max(2000).nullable().optional(), approvedCents: z.number().int().min(0).nullable().optional(), rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body, req }) => {
      const st = await settingsOf(app.db, auth.tenantId);
      return app.db.transaction(async (tx) => {
        const r = await loadReq(tx, auth, params.id, true);
        if (r.rowVersion !== body.rowVersion) throw conflict(r.rowVersion);
        if (r.state !== 'solicitado') throw unprocessable('Só solicitação aguardando autorização recebe decisão.');
        const ev = r.evaluation as unknown as Evaluation;
        const levels = levelsOf(auth);
        const allowed = allowedDecisions(ev, levels, st.conformingLevel);
        if (!allowed.decisions.includes(body.decision)) throw forbidden(allowed.reason ?? 'Esta decisão não cabe à sua alçada.');
        if (st.segregation && r.requesterId === auth.userId) throw forbidden('Segregação de funções: quem solicitou não decide a própria solicitação.');
        if (body.decision === 'aprovar_excecao' && (body.reason ?? '').length < 15) throw unprocessable('Aprovação excepcional exige fundamentação expressa (mínimo 15 caracteres).', [{ path: 'reason', message: 'Obrigatório' }]);
        if ((body.decision === 'rejeitar' || body.decision === 'ajustes') && (body.reason ?? '').length < 5) throw unprocessable('Explique a decisão.', [{ path: 'reason', message: 'Obrigatório' }]);
        const approved = body.decision === 'aprovar' || body.decision === 'aprovar_excecao';
        const amount = approved ? body.approvedCents ?? r.estimatedCents : r.estimatedCents;
        if (approved && amount > r.estimatedCents) throw unprocessable('O valor aprovado não pode passar do solicitado; altere a solicitação para nova avaliação.');
        const level = neededLevel(ev, st.conformingLevel) ?? 'gerencia';
        const profile = auth.profiles.includes('diretoria') ? 'diretoria' : auth.profiles.includes('gerencia') ? 'gerencia' : auth.profiles[0] ?? '';
        await tx.insert(s.giftRequestDecisions).values({ tenantId: auth.tenantId, requestId: r.id, decision: body.decision, deciderId: auth.userId, profile, level: levels.includes('diretoria') ? 'diretoria' : 'gerencia', outcome: ev.outcome, findings: ev.findings, requesterJustification: r.justification, reason: body.reason ?? null, conditions: body.conditions ?? null, amountCents: amount, requestVersion: r.rowVersion });
        const state = approved ? 'aprovado' : body.decision === 'ajustes' ? 'ajustes' : 'rejeitado';
        const [u] = await tx.update(s.giftRequests).set({ state, approvedCents: approved ? amount : null, exception: body.decision === 'aprovar_excecao', rowVersion: r.rowVersion + 1, updatedAt: new Date() }).where(eq(s.giftRequests.id, r.id)).returning();
        const label = { aprovar: 'Aprovada', aprovar_excecao: 'Aprovada excepcionalmente', ajustes: 'Ajustes pedidos', rejeitar: 'Rejeitada' }[body.decision];
        await logEv(tx, auth, r, 'decisao', `${label} (alçada ${level === 'diretoria' ? 'Diretoria' : 'Gestão comercial'})${body.reason ? `: ${body.reason}` : ''}.`, { decision: body.decision, amount, conditions: body.conditions ?? null });
        await audit(tx, req, { action: `gift_request.${body.decision}`, entityType: 'gift_request', entityId: r.id, metadata: { amount, outcome: ev.outcome } });
        await notifyCompliance(tx, app.config, auth.tenantId, [r.requesterId], { event: approved ? 'aprovada' : body.decision === 'ajustes' ? 'ajustes' : 'rejeitada', title: `${label}: ${r.code} ${r.description.slice(0, 80)}`, body: body.reason ?? null, requestId: r.id, key: `dec:${r.id}:${u!.rowVersion}`, actorId: auth.userId });
        return u;
      });
    },
  }),

  defineRoute({
    method: 'POST', url: '/brindes/compliance/solicitacoes/:id/reservar', summary: 'Reserva os materiais da concessão aprovada (compromete o estoque; não baixa)', ...READ, params: IdParams,
    handler: async ({ app, auth, params, req }) => app.db.transaction(async (tx) => {
      await lockBrindes(tx, auth.tenantId);
      const r = await loadReq(tx, auth, params.id, true);
      if (r.state !== 'aprovado') throw unprocessable('Só concessão aprovada é reservada.');
      const [kit] = r.kitId ? await tx.select().from(s.giftKits).where(eq(s.giftKits.id, r.kitId)) : [];
      const needs = deliveryNeeds(kit?.items ?? null, kit ? r.kits : 0, r.items);
      if (!needs.length) throw unprocessable('Esta concessão não usa materiais do estoque.');
      const items = await tx.select().from(s.giftItems).where(eq(s.giftItems.tenantId, auth.tenantId));
      const others = await tx.select().from(s.giftRequests).where(and(eq(s.giftRequests.tenantId, auth.tenantId), eq(s.giftRequests.state, 'reservado')));
      const okits = new Map((others.some((x) => x.kitId) ? await tx.select().from(s.giftKits).where(inArray(s.giftKits.id, others.map((x) => x.kitId).filter((x): x is string => !!x))) : []).map((k) => [k.id, k]));
      const reserved = new Map<string, number>();
      for (const x of others) for (const n of deliveryNeeds(x.kitId ? okits.get(x.kitId)?.items ?? null : null, x.kits, x.items)) reserved.set(n.itemId, (reserved.get(n.itemId) ?? 0) + n.qty);
      const short = stockShortages(needs, items.map((i) => ({ ...i, stock: i.stock - (reserved.get(i.id) ?? 0) })));
      if (short.length) throw unprocessable(`Estoque livre insuficiente: ${short.map((x) => `${x.name} (precisa ${x.need}, livre ${x.stock})`).join('; ')}.`);
      const [u] = await tx.update(s.giftRequests).set({ state: 'reservado', reservedAt: new Date(), rowVersion: r.rowVersion + 1, updatedAt: new Date() }).where(eq(s.giftRequests.id, r.id)).returning();
      await logEv(tx, auth, r, 'reservada', `Materiais reservados: ${needs.map((n) => `${n.qty}× ${items.find((i) => i.id === n.itemId)?.name ?? 'item'}`).join(', ')}.`);
      await audit(tx, req, { action: 'gift_request.reserve', entityType: 'gift_request', entityId: r.id });
      return u;
    }),
  }),

  defineRoute({
    method: 'POST', url: '/brindes/compliance/solicitacoes/:id/executar', summary: 'Confirma a execução: baixa o estoque uma única vez (envio ligado à concessão), registra na conta e quem executou', ...READ, params: IdParams,
    body: z.object({ executedOn: isoDate, executedCents: z.number().int().min(0).nullable().optional(), executorId: uuid.nullable().optional(), note: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      await lockBrindes(tx, auth.tenantId);
      const r = await loadReq(tx, auth, params.id, true);
      if (r.state === 'executado') return r; // reprocessamento: não baixa de novo
      if (r.state !== 'aprovado' && r.state !== 'reservado') throw unprocessable('Só concessão aprovada é executada.');
      if (r.deliveryId) throw unprocessable('Esta concessão já tem saída de estoque registrada.');
      if (body.executorId) { const [x] = await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, body.executorId), eq(s.users.tenantId, auth.tenantId))); if (!x) throw unprocessable('Responsável pela entrega não encontrado.'); }
      const accs = await tx.select().from(s.giftRequestAccounts).where(eq(s.giftRequestAccounts.requestId, r.id));
      const [kit] = r.kitId ? await tx.select().from(s.giftKits).where(eq(s.giftKits.id, r.kitId)) : [];
      const needs = deliveryNeeds(kit?.items ?? null, kit ? r.kits : 0, r.items);
      let deliveryId: string | null = null, stockCents = 0;
      if (needs.length) {
        const items = await tx.select().from(s.giftItems).where(eq(s.giftItems.tenantId, auth.tenantId));
        const short = stockShortages(needs, items);
        if (short.length) throw unprocessable(`Estoque insuficiente: ${short.map((x) => `${x.name} (precisa ${x.need}, tem ${x.stock})`).join('; ')}.`);
        const lines = needs.map((n) => { const i = items.find((x) => x.id === n.itemId)!; return { itemId: i.id, name: i.name, qty: n.qty, unitCostCents: i.unitCostCents }; });
        stockCents = lines.reduce((t, l) => t + l.qty * l.unitCostCents, 0);
        const purpose = accs.length === 1 ? r.purpose : r.eventName ? 'evento' : r.campaignId ? 'campanha' : 'institucional';
        const [cat] = kit?.categoryId ? await tx.select({ name: s.giftKitCategories.name }).from(s.giftKitCategories).where(eq(s.giftKitCategories.id, kit.categoryId)) : [];
        const [d] = await tx.insert(s.giftDeliveries).values({ tenantId: auth.tenantId, contactId: accs.length === 1 ? accs[0]!.contactId : null, purpose: accs.length === 1 && purpose === 'oportunidade' && !r.opportunityId ? 'relacionamento' : purpose, opportunityId: accs.length === 1 ? r.opportunityId : null, campaignId: r.campaignId, eventName: r.eventName ?? (purpose === 'evento' ? r.description.slice(0, 120) : null), kitId: kit?.id ?? null, kitName: kit?.name ?? null, categoryName: cat?.name ?? null, kits: kit ? r.kits : 0, items: lines, totalCents: stockCents, occurredOn: body.executedOn, note: `Concessão ${r.code}${body.note ? ` · ${body.note}` : ''}`, createdBy: auth.userId }).returning();
        deliveryId = d!.id;
        for (const l of lines) {
          await tx.insert(s.giftMovements).values({ tenantId: auth.tenantId, itemId: l.itemId, kind: 'saida', qty: -l.qty, unitCostCents: l.unitCostCents, deliveryId, note: `Concessão ${r.code}`, actorId: auth.userId });
          await tx.update(s.giftItems).set({ stock: sql`${s.giftItems.stock} - ${l.qty}`, updatedAt: new Date() }).where(eq(s.giftItems.id, l.itemId));
        }
      }
      const executed = body.executedCents ?? r.approvedCents ?? r.estimatedCents;
      // rateio do executado nas contas (mesma proporção do solicitado)
      if (accs.length && executed !== r.estimatedCents) {
        const base = accs.reduce((t, a) => t + a.shareCents, 0) || 1;
        let rest = executed;
        for (const [i, a] of accs.entries()) { const v = i === accs.length - 1 ? rest : Math.round((a.shareCents / base) * executed); rest -= v; await tx.update(s.giftRequestAccounts).set({ shareCents: v }).where(eq(s.giftRequestAccounts.id, a.id)); }
      }
      const [u] = await tx.update(s.giftRequests).set({ state: 'executado', executedOn: body.executedOn, executedCents: executed, executorId: body.executorId ?? auth.userId, deliveryId, rowVersion: r.rowVersion + 1, updatedAt: new Date() }).where(eq(s.giftRequests.id, r.id)).returning();
      await logEv(tx, auth, r, 'executada', `Executada em ${body.executedOn.split('-').reverse().join('/')} (${(executed / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})${deliveryId ? `; saída de estoque ${(stockCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}${accs.length ? `; registrada em ${accs.length} conta(s)` : ''}.`, { deliveryId, executed });
      await audit(tx, req, { action: 'gift_request.execute', entityType: 'gift_request', entityId: r.id, metadata: { executed, deliveryId } });
      const decs = await tx.select({ deciderId: s.giftRequestDecisions.deciderId }).from(s.giftRequestDecisions).where(eq(s.giftRequestDecisions.requestId, r.id));
      await notifyCompliance(tx, app.config, auth.tenantId, [r.requesterId, ...decs.map((d) => d.deciderId)], { event: 'executada', title: `Execução concluída: ${r.code} ${r.description.slice(0, 80)}`, requestId: r.id, key: `exec:${r.id}`, actorId: auth.userId });
      const docs = await tx.select({ kind: s.giftRequestDocuments.kind }).from(s.giftRequestDocuments).where(eq(s.giftRequestDocuments.requestId, r.id));
      if (!docs.some((d) => ['comprovante', 'entrega', 'evidencia'].includes(d.kind))) await notifyCompliance(tx, app.config, auth.tenantId, [body.executorId ?? auth.userId, r.requesterId], { event: 'pendencia_documental', title: `Anexe o comprovante: ${r.code} ${r.description.slice(0, 80)}`, requestId: r.id, key: `doc:${r.id}` });
      return u;
    }),
  }),

  defineRoute({
    method: 'POST', url: '/brindes/compliance/solicitacoes/:id/cancelar', summary: 'Cancela a concessão (executada: estorna a saída de estoque e o registro na conta; nada é apagado)', ...READ, params: IdParams,
    body: z.object({ reason: z.string().trim().min(5, 'Explique o cancelamento').max(500) }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      await lockBrindes(tx, auth.tenantId);
      const r = await loadReq(tx, auth, params.id, true);
      if (r.state === 'cancelado' || r.state === 'rejeitado') throw unprocessable('Já está encerrada.');
      if (r.requesterId !== auth.userId && !levelsOf(auth).length && !seesAll(auth)) throw forbidden('Só quem solicitou ou a gestão cancela.');
      if (r.deliveryId) {
        const [d] = await tx.select().from(s.giftDeliveries).where(and(eq(s.giftDeliveries.id, r.deliveryId), isNull(s.giftDeliveries.cancelledAt)));
        if (d) {
          for (const l of d.items) {
            await tx.insert(s.giftMovements).values({ tenantId: auth.tenantId, itemId: l.itemId, kind: 'devolucao', qty: l.qty, unitCostCents: l.unitCostCents, deliveryId: d.id, note: `Estorno da concessão ${r.code}: ${body.reason}`, actorId: auth.userId });
            await tx.update(s.giftItems).set({ stock: sql`${s.giftItems.stock} + ${l.qty}`, updatedAt: new Date() }).where(eq(s.giftItems.id, l.itemId));
          }
          await tx.update(s.giftDeliveries).set({ cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: `Concessão ${r.code} cancelada: ${body.reason}`.slice(0, 300) }).where(eq(s.giftDeliveries.id, d.id));
        }
      }
      const [u] = await tx.update(s.giftRequests).set({ state: 'cancelado', cancelReason: body.reason, reservedAt: null, rowVersion: r.rowVersion + 1, updatedAt: new Date() }).where(eq(s.giftRequests.id, r.id)).returning();
      await logEv(tx, auth, r, r.state === 'executado' ? 'estornada' : 'cancelada', `${r.state === 'executado' ? 'Estornada' : 'Cancelada'}: ${body.reason}.`, { previous: r.state });
      await audit(tx, req, { action: 'gift_request.cancel', entityType: 'gift_request', entityId: r.id, metadata: { previous: r.state } });
      return u;
    }),
  }),

  defineRoute({
    method: 'POST', url: '/brindes/compliance/solicitacoes/:id/documentos', summary: 'Anexa evidência, comprovante, autorização ou registro de entrega (até 8 MB)', ...READ, params: IdParams,
    body: z.object({ kind: z.enum(['evidencia', 'comprovante', 'autorizacao', 'entrega', 'outro']), name: z.string().trim().min(1).max(200), mime: z.string().max(120), data: z.string().max(12_000_000) }),
    handler: async ({ app, auth, params, body, reply, req }) => {
      const r = await loadReq(app.db, auth, params.id);
      if (r.state === 'cancelado') throw unprocessable('Concessão cancelada não recebe documentos.');
      const buf = Buffer.from(body.data, 'base64');
      if (!buf.length || buf.length > 8 * 1024 * 1024) throw unprocessable('Arquivo vazio ou maior que 8 MB.');
      const [d] = await app.db.insert(s.giftRequestDocuments).values({ tenantId: auth.tenantId, requestId: r.id, kind: body.kind, name: body.name, mime: body.mime || 'application/octet-stream', size: buf.length, data: buf, createdBy: auth.userId }).returning({ id: s.giftRequestDocuments.id, kind: s.giftRequestDocuments.kind, name: s.giftRequestDocuments.name });
      await logEv(app.db, auth, r, 'documento', `Documento anexado (${body.kind}): ${body.name}.`);
      await audit(app.db, req, { action: 'gift_request.document', entityType: 'gift_request', entityId: r.id, metadata: { kind: body.kind, name: body.name } });
      reply.code(201);
      return d;
    },
  }),
  defineRoute({
    method: 'GET', url: '/brindes/compliance/documentos/:id', summary: 'Baixa um documento da concessão', ...READ, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [d] = await app.db.select().from(s.giftRequestDocuments).where(and(eq(s.giftRequestDocuments.id, params.id), eq(s.giftRequestDocuments.tenantId, auth.tenantId))).limit(1);
      if (!d) throw notFound('Documento não encontrado.');
      await loadReq(app.db, auth, d.requestId);
      reply.header('content-type', d.mime).header('content-disposition', `attachment; filename="${encodeURIComponent(d.name)}"`);
      return reply.send(d.data);
    },
  }),

  // ------------------------------------------------------------------ diretrizes e ajustes (administrador autorizado)
  defineRoute({
    method: 'GET', url: '/brindes/compliance/diretrizes', summary: 'Diretrizes com todas as versões (histórico de alterações) e os ajustes de compliance', ...READ,
    handler: async ({ app, auth }) => {
      const rows = await app.db.select({ r: s.giftComplianceRules, by: s.users.name }).from(s.giftComplianceRules).leftJoin(s.users, eq(s.users.id, s.giftComplianceRules.createdBy)).where(eq(s.giftComplianceRules.tenantId, auth.tenantId)).orderBy(asc(s.giftComplianceRules.ruleKey), desc(s.giftComplianceRules.version));
      return { rules: rows.map((x) => ({ ...x.r, createdByName: x.by })), settings: await settingsOf(app.db, auth.tenantId), canConfigure: canConfigure(auth), events: COMPLIANCE_EVENTS };
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/compliance/diretrizes', summary: 'Cria diretriz ou nova versão de uma diretriz (as decisões já tomadas guardam a versão da época)', ...READ,
    body: z.object({
      ruleKey: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/, 'Identificação: letras minúsculas, números, - e _').optional(),
      name: z.string().trim().min(3).max(160), description: z.string().trim().max(2000).nullable().optional(), param: z.enum(RULE_PARAMS), controlType: z.enum(CONTROL_TYPES), approverLevel: z.enum(['gerencia', 'diretoria']).default('gerencia'),
      limitValue: z.number().int().min(0).nullable().optional(), windowDays: z.number().int().min(1).max(3650).nullable().optional(),
      allowedKitIds: z.array(uuid).max(100).default([]), allowedItemIds: z.array(uuid).max(200).default([]),
      kinds: z.array(z.enum(CONCESSION_KINDS)).default([]), natures: z.array(z.enum(['publica', 'privada'])).default([]), segments: z.array(z.enum(['residencial', 'empresarial', 'governamental', 'institucional'])).default([]), purposes: z.array(z.enum(CONCESSION_PURPOSES)).default([]), kitCategories: z.array(z.enum(KIT_CATEGORIES)).default([]),
      validFrom: isoDate, validTo: isoDate.nullable().optional(), active: z.boolean().default(true), changeNote: z.string().trim().min(5, 'Registre o motivo da alteração').max(500),
    }),
    handler: async ({ app, auth, body, reply, req }) => {
      if (!canConfigure(auth)) throw forbidden('Só o administrador autorizado configura as diretrizes.');
      const needsLimit = ['valor_por_kit', 'valor_por_concessao', 'valor_acumulado_conta', 'valor_periodo', 'quantidade_itens', 'frequencia_conta'].includes(body.param);
      if (needsLimit && body.limitValue == null) throw unprocessable('Informe o parâmetro (limite) desta diretriz.', [{ path: 'limitValue', message: 'Obrigatório' }]);
      if (['valor_acumulado_conta', 'valor_periodo', 'frequencia_conta'].includes(body.param) && !body.windowDays) throw unprocessable('Informe o período (em dias) desta diretriz.', [{ path: 'windowDays', message: 'Obrigatório' }]);
      if (body.param === 'composicao_kit' && !body.allowedKitIds.length && !body.allowedItemIds.length) throw unprocessable('Escolha os kits ou itens permitidos.');
      if (body.validTo && body.validTo < body.validFrom) throw unprocessable('Fim da vigência antes do início.');
      const key = body.ruleKey ?? `d${Date.now().toString(36)}`;
      const r = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gc-rule:${auth.tenantId}:${key}`}))`);
        const [last] = await tx.select({ v: s.giftComplianceRules.version }).from(s.giftComplianceRules).where(and(eq(s.giftComplianceRules.tenantId, auth.tenantId), eq(s.giftComplianceRules.ruleKey, key))).orderBy(desc(s.giftComplianceRules.version)).limit(1);
        if (body.ruleKey && !last) throw notFound('Diretriz não encontrada para nova versão.');
        const [row] = await tx.insert(s.giftComplianceRules).values({ tenantId: auth.tenantId, ruleKey: key, version: (last?.v ?? 0) + 1, name: body.name, description: body.description ?? null, param: body.param, controlType: body.controlType, approverLevel: body.approverLevel, limitValue: body.limitValue ?? null, windowDays: body.windowDays ?? null, allowedKitIds: body.allowedKitIds, allowedItemIds: body.allowedItemIds, kinds: body.kinds, natures: body.natures, segments: body.segments, purposes: body.purposes, kitCategories: body.kitCategories, validFrom: body.validFrom, validTo: body.validTo ?? null, active: body.active, changeNote: body.changeNote, createdBy: auth.userId }).returning();
        await audit(tx, req, { action: last ? 'gift_rule.version' : 'gift_rule.create', entityType: 'gift_compliance_rule', entityId: row!.id, metadata: { key, version: row!.version, note: body.changeNote } });
        return row!;
      });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/compliance/diretrizes/politica', summary: 'Carrega as diretrizes da política "Diretrizes de Relacionamento Institucional, Stakeholders e Distribuição de Brindes" (só o que a política define; não repete as já carregadas)', ...READ,
    handler: async ({ app, auth, req }) => {
      if (!canConfigure(auth)) throw forbidden('Só o administrador autorizado configura as diretrizes.');
      const today = todayIn(auth.timezone);
      const POL = 'Diretrizes de Relacionamento Institucional, Stakeholders e Distribuição de Brindes';
      const cat = (c: 'A' | 'B' | 'C' | 'D', cents: number, nome: string, extra = '') => ({ ruleKey: `politica-cat-${c.toLowerCase()}`, name: `Categoria ${c} (${nome}): até ${(cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por kit`, description: `Item 6 da política: faixa de valor de referência por kit. Valor máximo, não obrigatório; acima é exceção (item 15).${extra}`, param: 'valor_por_kit', controlType: 'orientativa', approverLevel: 'gerencia', limitValue: cents, kitCategories: [c], natures: [] as string[] });
      const defs = [
        cat('A', 400_00, 'relacionamento estratégico', ' A tabela do item 5 indica até R$ 450,00 para o nível Estratégico; aqui vale o valor por kit do item 6 (R$ 400,00), o mais restritivo. Ajuste numa nova versão se a política for esclarecida.'),
        cat('B', 250_00, 'relacionamento recorrente'), cat('C', 150_00, 'relacionamento específico'), cat('D', 80_00, 'relacionamento geral'),
        { ruleKey: 'politica-matriz', name: 'Categoria compatível com a classificação do stakeholder', description: 'Item 8: IA recebe A, B, C ou D; INA, B, C ou D; NIA, C ou D; NINA, D. Categoria superior é exceção. Stakeholder sem classificação é apontado.', param: 'matriz_stakeholder', controlType: 'orientativa', approverLevel: 'gerencia', limitValue: null, kitCategories: [], natures: [] },
        { ruleKey: 'politica-agente-publico', name: 'Destinatário de órgão ou entidade pública', description: 'Item 9: a classificação não autoriza automaticamente; confirmar as regras do órgão antes da entrega (prevalece a regra mais restritiva).', param: 'condicao', controlType: 'autorizacao', approverLevel: 'gerencia', limitValue: null, kitCategories: [], natures: ['publica'] },
        { ruleKey: 'politica-atencao', name: 'Situação de atenção', description: 'Item 10: licitação, contratação, negociação, renovação, decisões, fiscalização, medição, aceite, pagamento, aprovação de projeto, análise de proposta, penalidade. Pode ser recomendável postergar ou não entregar.', param: 'situacao_atencao', controlType: 'autorizacao', approverLevel: 'gerencia', limitValue: null, kitCategories: [], natures: [] },
      ];
      const created: string[] = [];
      await app.db.transaction(async (tx) => {
        const have = new Set((await tx.select({ k: s.giftComplianceRules.ruleKey }).from(s.giftComplianceRules).where(eq(s.giftComplianceRules.tenantId, auth.tenantId))).map((x) => x.k));
        for (const d of defs) {
          if (have.has(d.ruleKey)) continue;
          await tx.insert(s.giftComplianceRules).values({ tenantId: auth.tenantId, ruleKey: d.ruleKey, version: 1, name: d.name, description: d.description, param: d.param, controlType: d.controlType, approverLevel: d.approverLevel, limitValue: d.limitValue, kitCategories: d.kitCategories, natures: d.natures, validFrom: today, changeNote: `Carga inicial: ${POL}`, createdBy: auth.userId });
          created.push(d.ruleKey);
        }
        const [st] = await tx.select().from(s.giftComplianceSettings).where(eq(s.giftComplianceSettings.tenantId, auth.tenantId));
        if (!st?.policyNote) await tx.insert(s.giftComplianceSettings).values({ tenantId: auth.tenantId, policyNote: POL, updatedBy: auth.userId }).onConflictDoUpdate({ target: s.giftComplianceSettings.tenantId, set: { policyNote: POL, updatedBy: auth.userId, updatedAt: new Date() } });
        await audit(tx, req, { action: 'gift_rule.policy_load', entityType: 'gift_compliance_rule', entityId: auth.tenantId, metadata: { created } });
      });
      return { created: created.length, skipped: defs.length - created.length, frequency: 'A política pede razoabilidade na recorrência, sem número: cadastre o limite de frequência quando ele for definido.' };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/brindes/compliance/ajustes', summary: 'Ajustes: segregação de funções, alçada das conformes, canais de aviso por evento e referência da política', ...READ,
    body: z.object({ segregation: z.boolean(), conformingLevel: z.enum(['gerencia', 'diretoria']), channels: z.record(z.enum(Object.keys(COMPLIANCE_EVENTS) as [string, ...string[]]), z.object({ email: z.boolean().optional(), whatsapp: z.boolean().optional() })).default({}), policyNote: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, body, req }) => {
      if (!canConfigure(auth)) throw forbidden('Só o administrador autorizado altera os ajustes.');
      await app.db.insert(s.giftComplianceSettings).values({ tenantId: auth.tenantId, segregation: body.segregation, conformingLevel: body.conformingLevel, channels: body.channels, policyNote: body.policyNote ?? null, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: s.giftComplianceSettings.tenantId, set: { segregation: body.segregation, conformingLevel: body.conformingLevel, channels: body.channels, policyNote: body.policyNote ?? null, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'gift_compliance.settings', entityType: 'gift_compliance_settings', entityId: auth.tenantId, metadata: body });
      return settingsOf(app.db, auth.tenantId);
    },
  }),

  // ------------------------------------------------------------------ prestação de contas
  defineRoute({
    method: 'GET', url: '/brindes/compliance/prestacoes', summary: 'Prestações de contas emitidas (sem o arquivo) e as filiais com timbrado', ...READ,
    handler: async ({ app, auth }) => {
      if (!canReport(auth)) throw forbidden('Prestação de contas: Gestão comercial, Diretoria e Administração.');
      const rows = await app.db.select({ r: { id: s.giftComplianceReports.id, code: s.giftComplianceReports.code, version: s.giftComplianceReports.version, periodFrom: s.giftComplianceReports.periodFrom, periodTo: s.giftComplianceReports.periodTo, filters: s.giftComplianceReports.filters, analysis: s.giftComplianceReports.analysis, letterhead: s.giftComplianceReports.letterhead, sha256: s.giftComplianceReports.sha256, createdAt: s.giftComplianceReports.createdAt, refs: s.giftComplianceReports.refs }, by: s.users.name })
        .from(s.giftComplianceReports).innerJoin(s.users, eq(s.users.id, s.giftComplianceReports.createdBy)).where(eq(s.giftComplianceReports.tenantId, auth.tenantId)).orderBy(desc(s.giftComplianceReports.createdAt));
      const branches = await app.db.select({ id: s.salesBranches.id, name: s.salesBranches.name, letterhead: sql<boolean>`exists(select 1 from branch_letterheads bl where bl.branch_id = ${s.salesBranches.id})` }).from(s.salesBranches).where(eq(s.salesBranches.tenantId, auth.tenantId)).orderBy(asc(s.salesBranches.name));
      return { items: rows.map((x) => ({ ...x.r, records: x.r.refs.length, refs: undefined, createdByName: x.by })), branches };
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/compliance/prestacoes', summary: 'Gera a prestação de contas em PDF (A4, timbrado da filial escolhida) a partir dos registros; guarda o arquivo, os filtros e as referências', ...READ,
    body: z.object({
      from: isoDate, to: isoDate, contactId: uuid.nullable().optional(), orgUnitId: uuid.nullable().optional(), kinds: z.array(z.enum(CONCESSION_KINDS)).default([]),
      detailed: z.boolean().default(true), justifications: z.boolean().default(true), exceptions: z.boolean().default(true), evidences: z.boolean().default(false),
      analysis: z.string().trim().max(6000).nullable().optional(), conclusion: z.string().trim().max(6000).nullable().optional(), branchId: uuid.nullable().optional(),
    }),
    handler: async ({ app, auth, body, reply, req }) => {
      if (!canReport(auth)) throw forbidden('Prestação de contas: Gestão comercial, Diretoria e Administração.');
      if (body.to < body.from) throw unprocessable('Período inválido.');
      const d = await complianceData(app.db, auth, { from: body.from, to: body.to, contactId: body.contactId ?? undefined, orgUnitId: body.orgUnitId ?? undefined });
      const rows = d.rows.filter((r) => !body.kinds.length || body.kinds.includes(r.kind as ConcessionKind));
      const ids = rows.map((r) => r.id);
      const [decisions, docs, rules] = await Promise.all([
        ids.length ? app.db.select({ d: s.giftRequestDecisions, name: s.users.name }).from(s.giftRequestDecisions).innerJoin(s.users, eq(s.users.id, s.giftRequestDecisions.deciderId)).where(inArray(s.giftRequestDecisions.requestId, ids)).orderBy(asc(s.giftRequestDecisions.createdAt)) : [],
        ids.length ? app.db.select({ requestId: s.giftRequestDocuments.requestId, kind: s.giftRequestDocuments.kind, name: s.giftRequestDocuments.name, at: s.giftRequestDocuments.createdAt }).from(s.giftRequestDocuments).where(inArray(s.giftRequestDocuments.requestId, ids)) : [],
        allRules(app.db, auth.tenantId),
      ]);
      const [unit] = body.orgUnitId ? await app.db.select({ name: s.orgUnits.name }).from(s.orgUnits).where(eq(s.orgUnits.id, body.orgUnitId)) : [];
      const [acc] = body.contactId ? await app.db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, body.contactId)) : [];
      const letterhead = body.branchId ? await letterheadForBranch(app.db, auth.tenantId, body.branchId) : null;
      const st = await settingsOf(app.db, auth.tenantId);
      const rep = await app.db.transaction(async (tx) => {
        const year = body.to.slice(0, 4);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gc-rep:${auth.tenantId}`}))`);
        const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.giftComplianceReports).where(and(eq(s.giftComplianceReports.tenantId, auth.tenantId), sql`${s.giftComplianceReports.code} like ${`PC-${year}-%`}`));
        const [v] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.giftComplianceReports).where(and(eq(s.giftComplianceReports.tenantId, auth.tenantId), eq(s.giftComplianceReports.periodFrom, body.from), eq(s.giftComplianceReports.periodTo, body.to)));
        const code = `PC-${year}-${String((n?.n ?? 0) + 1).padStart(3, '0')}`;
        const version = (v?.n ?? 0) + 1;
        const emittedAt = new Date();
        const pdf = await buildComplianceReport({
          code, version, emittedAt, emitter: auth.name, tenantName: auth.tenantName, from: body.from, to: body.to,
          scope: { account: acc?.name ?? null, unit: unit?.name ?? null, kinds: body.kinds },
          options: { detailed: body.detailed, justifications: body.justifications, exceptions: body.exceptions, evidences: body.evidences },
          analysis: body.analysis ?? null, conclusion: body.conclusion ?? null, letterhead,
          data: { ...d, rows }, decisions: decisions.map((x) => ({ ...x.d, deciderName: x.name })), documents: docs, activeRules: currentRules(rules, body.to).length, segregation: st.segregation, policyNote: st.policyNote,
        });
        const sha256 = createHash('sha256').update(pdf).digest('hex');
        const [row] = await tx.insert(s.giftComplianceReports).values({ tenantId: auth.tenantId, code, version, periodFrom: body.from, periodTo: body.to, filters: { contactId: body.contactId ?? null, orgUnitId: body.orgUnitId ?? null, kinds: body.kinds, detailed: body.detailed, justifications: body.justifications, exceptions: body.exceptions, evidences: body.evidences, branchId: body.branchId ?? null }, analysis: body.analysis ?? null, conclusion: body.conclusion ?? null, refs: rows.map((r) => ({ id: r.id, code: r.code, rowVersion: (r as unknown as Req).rowVersion })), totals: d.kpis as unknown as Record<string, unknown>, letterhead: !!letterhead, pdf: Buffer.from(pdf), sha256, createdBy: auth.userId, createdAt: emittedAt }).returning({ id: s.giftComplianceReports.id, code: s.giftComplianceReports.code, version: s.giftComplianceReports.version, sha256: s.giftComplianceReports.sha256 });
        await audit(tx, req, { action: 'gift_compliance.report', entityType: 'gift_compliance_report', entityId: row!.id, metadata: { code, from: body.from, to: body.to, records: rows.length } });
        return row!;
      });
      reply.code(201);
      return rep;
    },
  }),
  defineRoute({
    method: 'GET', url: '/brindes/compliance/prestacoes/:id/pdf', summary: 'Baixa a prestação de contas emitida (o arquivo guardado, como foi apresentado)', ...READ, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      if (!canReport(auth)) throw forbidden('Prestação de contas: Gestão comercial, Diretoria e Administração.');
      const [r] = await app.db.select({ code: s.giftComplianceReports.code, version: s.giftComplianceReports.version, pdf: s.giftComplianceReports.pdf }).from(s.giftComplianceReports).where(and(eq(s.giftComplianceReports.id, params.id), eq(s.giftComplianceReports.tenantId, auth.tenantId))).limit(1);
      if (!r) throw notFound('Prestação de contas não encontrada.');
      reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="Prestacao-de-Contas-${r.code}-v${r.version}.pdf"`);
      return reply.send(r.pdf);
    },
  }),
];

/** Concessões executadas registradas na conta (para a aba Brindes da conta). */
export async function accountConcessionList(db: DbOrTx, tenantId: string, contactId: string) {
  const rows = await db.select({ a: s.giftRequestAccounts, r: s.giftRequests, requester: s.users.name }).from(s.giftRequestAccounts).innerJoin(s.giftRequests, eq(s.giftRequests.id, s.giftRequestAccounts.requestId)).innerJoin(s.users, eq(s.users.id, s.giftRequests.requesterId))
    .where(and(eq(s.giftRequests.tenantId, tenantId), eq(s.giftRequestAccounts.contactId, contactId), inArray(s.giftRequests.state, ['executado', 'aprovado', 'reservado', 'solicitado', 'cancelado']))).orderBy(desc(sql`coalesce(${s.giftRequests.executedOn}, ${s.giftRequests.plannedOn})`));
  const ids = rows.map((x) => x.r.id);
  const [decs, execs] = ids.length ? await Promise.all([
    db.select({ requestId: s.giftRequestDecisions.requestId, decision: s.giftRequestDecisions.decision, name: s.users.name, reason: s.giftRequestDecisions.reason }).from(s.giftRequestDecisions).innerJoin(s.users, eq(s.users.id, s.giftRequestDecisions.deciderId)).where(inArray(s.giftRequestDecisions.requestId, ids)),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, rows.map((x) => x.r.executorId).filter((x): x is string => !!x).concat(['00000000-0000-0000-0000-000000000000']))),
  ]) : [[], []];
  return rows.map((x) => {
    const appr = decs.filter((d) => d.requestId === x.r.id && (d.decision === 'aprovar' || d.decision === 'aprovar_excecao')).at(-1);
    return {
      id: x.r.id, code: x.r.code, kind: x.r.kind, purpose: x.r.purpose, description: x.r.description, eventName: x.r.eventName, state: x.r.state, on: x.r.executedOn ?? x.r.plannedOn,
      shareCents: x.a.shareCents, totalCents: x.r.executedCents ?? x.r.approvedCents ?? x.r.estimatedCents, shared: false, exception: x.r.exception, outcome: x.r.outcome, justification: x.r.justification,
      requesterName: x.requester, executorName: execs.find((e) => e.id === x.r.executorId)?.name ?? null, approverName: appr?.name ?? null, deliveryId: x.r.deliveryId,
    };
  });
}
