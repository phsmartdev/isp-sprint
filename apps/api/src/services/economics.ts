/**
 * Viabilidade econômica da oportunidade (motor financeiro em packages/domain/src/finance.ts).
 * Tributos por item: documento fiscal do item (da filial da venda) → tributos vigentes do documento.
 * Parâmetros: versão vigente de Configurações → Viabilidade (sem versão, não calcula).
 * Segmento público (Conta governamental ou natureza pública, ou venda em licitação) usa o limite de payback e a glosa do público.
 */
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { emptyEconInput, financeEngine, fiscalDocRates, itemTotal, type EconInput, type EconItem, type EconResult, type EconSettings, type FiscalTax } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export type SettingsVersion = { id: string; validFrom: string; createdAt: Date; createdBy: string | null; settings: EconSettings };

/** Versão de parâmetros vigente na data (a de maior vigência até ela; empate, a mais recente). */
export async function econSettingsOf(db: DbOrTx, tenantId: string, on = today()): Promise<SettingsVersion | null> {
  const [r] = await db.select().from(s.econSettingsVersions)
    .where(and(eq(s.econSettingsVersions.tenantId, tenantId), lte(s.econSettingsVersions.validFrom, on)))
    .orderBy(desc(s.econSettingsVersions.validFrom), desc(s.econSettingsVersions.createdAt)).limit(1);
  return r ? { id: r.id, validFrom: r.validFrom, createdAt: r.createdAt, createdBy: r.createdBy, settings: r.values as unknown as EconSettings } : null;
}

export async function econSettingsHistory(db: DbOrTx, tenantId: string) {
  return db.select({ id: s.econSettingsVersions.id, values: s.econSettingsVersions.values, validFrom: s.econSettingsVersions.validFrom, createdAt: s.econSettingsVersions.createdAt, createdByName: s.users.name })
    .from(s.econSettingsVersions).leftJoin(s.users, eq(s.users.id, s.econSettingsVersions.createdBy))
    .where(eq(s.econSettingsVersions.tenantId, tenantId)).orderBy(desc(s.econSettingsVersions.validFrom), desc(s.econSettingsVersions.createdAt)).limit(50);
}

export async function fiscalDocsOf(db: DbOrTx, tenantId: string, branchId?: string | null) {
  const rows = await db.select().from(s.fiscalDocTypes)
    .where(branchId ? and(eq(s.fiscalDocTypes.tenantId, tenantId), eq(s.fiscalDocTypes.branchId, branchId)) : eq(s.fiscalDocTypes.tenantId, tenantId))
    .orderBy(asc(s.fiscalDocTypes.position), asc(s.fiscalDocTypes.code));
  const t = today();
  return rows.map((d) => ({ id: d.id, branchId: d.branchId, fiscalKind: d.fiscalKind, code: d.code, name: d.name, active: d.active, taxes: d.taxes as FiscalTax[], rates: fiscalDocRates({ active: d.active, taxes: d.taxes as FiscalTax[] }, t) }));
}

type Opp = { id: string; tenantId: string; contactId: string; branchId: string | null; saleKind: string | null };

/** Tudo que o cálculo precisa: itens com a resolução fiscal, parâmetros vigentes, segmento e o que foi salvo. */
export async function economicsContext(db: DbOrTx, opp: Opp) {
  const [version, items, docs, [contact], [saved]] = await Promise.all([
    econSettingsOf(db, opp.tenantId),
    db.select().from(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, opp.tenantId))).orderBy(asc(s.opportunityItems.position)),
    fiscalDocsOf(db, opp.tenantId),
    db.select({ segment: s.contacts.segment, nature: s.contacts.nature }).from(s.contacts).where(eq(s.contacts.id, opp.contactId)).limit(1),
    db.select().from(s.opportunityEconomics).where(eq(s.opportunityEconomics.opportunityId, opp.id)).limit(1),
  ]);
  const publicSector = contact?.nature === 'publica' || (contact?.nature !== 'privada' && contact?.segment === 'governamental') || opp.saleKind === 'licitacao';
  const econItems: EconItem[] = items.map((i) => {
    const d = i.fiscalDocTypeId ? docs.find((x) => x.id === i.fiscalDocTypeId) : null;
    return { description: i.description, revenueCents: itemTotal(i), doc: d ? { id: d.id, name: `${d.code} · ${d.name}`, percentBp: d.rates.percentBp, fixedCents: d.rates.fixedCents, complete: d.rates.complete } : null };
  });
  const input = saved ? ({ ...emptyEconInput(), ...(saved.input as Partial<EconInput>) } as EconInput) : emptyEconInput();
  return {
    settings: version?.settings ?? null, settingsVersion: version ? { id: version.id, validFrom: version.validFrom } : null,
    items: econItems, publicSector, input,
    saved: saved ? { updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : null, savedResult: saved ? (saved.result as unknown as EconResult) : null,
    branchDocs: docs.filter((d) => d.active && (!opp.branchId || d.branchId === opp.branchId)),
  };
}
export type EconContext = Awaited<ReturnType<typeof economicsContext>>;

/** null = sem parâmetros vigentes (a empresa ainda não informou em Configurações → Viabilidade). */
export const computeEconomics = (ctx: EconContext, input?: EconInput) =>
  ctx.settings ? financeEngine({ input: input ?? ctx.input, items: ctx.items, settings: ctx.settings, publicSector: ctx.publicSector }) : null;

/**
 * O resultado salvo deixou de valer? Recalcula as mesmas entradas com os itens, tributos, parâmetros e motor de hoje
 * só para comparar: nada é gravado e o número mostrado continua sendo o salvo.
 */
export function isStale(saved: EconResult, fresh: EconResult | null) {
  if (!fresh) return true;
  return saved.engineVersion !== fresh.engineVersion || saved.verdict !== fresh.verdict || saved.priceCents !== fresh.priceCents || saved.floor?.minCents !== fresh.floor.minCents
    || saved.recommendedCents !== fresh.recommendedCents || (saved.kpi?.contributionCents ?? null) !== (fresh.kpi?.contributionCents ?? null)
    || saved.withReservations !== fresh.withReservations || saved.fixedTaxCents !== fresh.fixedTaxCents;
}

/** Guarda entradas e resultado e tira a fotografia auditável (entradas, parâmetros com a versão, tributos e avisos da época). */
export async function saveEconomics(db: DbOrTx, opp: Opp, input: EconInput, actorId: string | null, reason = 'salvo') {
  const ctx = await economicsContext(db, opp);
  const result = computeEconomics(ctx, input);
  if (!result) return null;
  const now = new Date();
  await db.insert(s.opportunityEconomics).values({ opportunityId: opp.id, tenantId: opp.tenantId, input, result, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({ target: s.opportunityEconomics.opportunityId, set: { input, result, updatedBy: actorId, updatedAt: now } });
  await db.insert(s.opportunityEconomicsSnapshots).values({ tenantId: opp.tenantId, opportunityId: opp.id, input, settings: { ...ctx.settings, settingsVersionId: ctx.settingsVersion?.id, publicSector: ctx.publicSector }, result, reason, actorId });
  return result;
}

/** Na venda fechada, a fotografia do dia do fechamento (só quando a viabilidade econômica foi preenchida). */
export async function snapshotEconomicsOnWon(db: DbOrTx, opp: Opp, actorId: string | null) {
  const [saved] = await db.select({ input: s.opportunityEconomics.input }).from(s.opportunityEconomics).where(eq(s.opportunityEconomics.opportunityId, opp.id)).limit(1);
  if (!saved) return null;
  return saveEconomics(db, opp, { ...emptyEconInput(), ...(saved.input as Partial<EconInput>) } as EconInput, actorId, 'ganha');
}

export async function economicsHistory(db: DbOrTx, tenantId: string, opportunityId: string) {
  return db.select({ id: s.opportunityEconomicsSnapshots.id, reason: s.opportunityEconomicsSnapshots.reason, createdAt: s.opportunityEconomicsSnapshots.createdAt, actorName: s.users.name, verdict: sql<string>`${s.opportunityEconomicsSnapshots.result}->>'verdict'`, priceCents: sql<number | null>`(${s.opportunityEconomicsSnapshots.result}->>'priceCents')::bigint` })
    .from(s.opportunityEconomicsSnapshots).leftJoin(s.users, eq(s.users.id, s.opportunityEconomicsSnapshots.actorId))
    .where(and(eq(s.opportunityEconomicsSnapshots.tenantId, tenantId), eq(s.opportunityEconomicsSnapshots.opportunityId, opportunityId)))
    .orderBy(desc(s.opportunityEconomicsSnapshots.createdAt)).limit(20);
}

// ------------------------------------------------------------------ decisão da viabilidade
export const ECON_STATUS_LABELS = { rascunho: 'Não salva', calculada: 'Calculada', em_decisao: 'Em decisão', aprovada: 'Aprovada', devolvida: 'Devolvida' } as const;
export type EconStatus = keyof typeof ECON_STATUS_LABELS;

/**
 * Situação da viabilidade: a última fotografia salva ("salvo", não a do fechamento) e as decisões sobre ela.
 * Salvar de novo gera outra fotografia: volta a "calculada" e a decisão anterior fica no histórico, presa à fotografia antiga.
 */
export async function econStatus(db: DbOrTx, tenantId: string, opportunityId: string) {
  const [snap] = await db.select({ id: s.opportunityEconomicsSnapshots.id, createdAt: s.opportunityEconomicsSnapshots.createdAt }).from(s.opportunityEconomicsSnapshots)
    .where(and(eq(s.opportunityEconomicsSnapshots.tenantId, tenantId), eq(s.opportunityEconomicsSnapshots.opportunityId, opportunityId), eq(s.opportunityEconomicsSnapshots.reason, 'salvo')))
    .orderBy(desc(s.opportunityEconomicsSnapshots.createdAt)).limit(1);
  const decisions = await db.select({ id: s.opportunityEconDecisions.id, snapshotId: s.opportunityEconDecisions.snapshotId, action: s.opportunityEconDecisions.action, reason: s.opportunityEconDecisions.reason, actorId: s.opportunityEconDecisions.actorId, actorName: s.users.name, createdAt: s.opportunityEconDecisions.createdAt })
    .from(s.opportunityEconDecisions).leftJoin(s.users, eq(s.users.id, s.opportunityEconDecisions.actorId))
    .where(and(eq(s.opportunityEconDecisions.tenantId, tenantId), eq(s.opportunityEconDecisions.opportunityId, opportunityId)))
    .orderBy(desc(s.opportunityEconDecisions.createdAt)).limit(50);
  const last = snap ? decisions.find((d) => d.snapshotId === snap.id) : undefined;
  const status: EconStatus = !snap ? 'rascunho' : !last ? 'calculada' : last.action === 'enviada' ? 'em_decisao' : last.action === 'aprovada' ? 'aprovada' : 'devolvida';
  const submittedBy = snap ? decisions.find((d) => d.snapshotId === snap.id && d.action === 'enviada')?.actorId ?? null : null;
  return { status, snapshotId: snap?.id ?? null, submittedBy, decisions };
}

/** Viabilidades aguardando decisão, das oportunidades dadas (já filtradas pelo escopo de quem pergunta). */
export async function pendingDecisions(db: DbOrTx, tenantId: string, opportunityIds: string[]) {
  if (!opportunityIds.length) return [];
  const out: { opportunityId: string; snapshotId: string; submittedAt: Date; submittedBy: string | null; submittedByName: string | null }[] = [];
  const rows = await db.select({ opportunityId: s.opportunityEconDecisions.opportunityId }).from(s.opportunityEconDecisions)
    .where(and(eq(s.opportunityEconDecisions.tenantId, tenantId), eq(s.opportunityEconDecisions.action, 'enviada'), inArray(s.opportunityEconDecisions.opportunityId, opportunityIds)));
  for (const id of [...new Set(rows.map((r) => r.opportunityId))]) {
    const st = await econStatus(db, tenantId, id);
    if (st.status !== 'em_decisao') continue;
    const sent = st.decisions.find((d) => d.snapshotId === st.snapshotId && d.action === 'enviada')!;
    out.push({ opportunityId: id, snapshotId: st.snapshotId!, submittedAt: sent.createdAt, submittedBy: sent.actorId, submittedByName: sent.actorName });
  }
  return out.sort((a, b) => +a.submittedAt - +b.submittedAt);
}
