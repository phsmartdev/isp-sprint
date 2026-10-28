/**
 * Viabilidade econômica da oportunidade (motor financeiro em packages/domain/src/finance.ts).
 * Tributos por item: documento fiscal do item (da filial da venda) → tributos vigentes do documento.
 * Segmento público (Conta governamental ou natureza pública, ou venda em licitação) usa o limite de payback do público.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  DEFAULT_ECON_SETTINGS, emptyEconInput, financeEngine, fiscalDocRates, itemTotal,
  type EconInput, type EconItem, type EconSettings, type FiscalTax,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export async function econSettingsOf(db: DbOrTx, tenantId: string): Promise<EconSettings> {
  const [r] = await db.select({ econ: s.viabilitySettings.econ }).from(s.viabilitySettings).where(eq(s.viabilitySettings.tenantId, tenantId)).limit(1);
  return { ...DEFAULT_ECON_SETTINGS, ...((r?.econ ?? {}) as Partial<EconSettings>) };
}

export async function fiscalDocsOf(db: DbOrTx, tenantId: string, branchId?: string | null) {
  const rows = await db.select().from(s.fiscalDocTypes)
    .where(branchId ? and(eq(s.fiscalDocTypes.tenantId, tenantId), eq(s.fiscalDocTypes.branchId, branchId)) : eq(s.fiscalDocTypes.tenantId, tenantId))
    .orderBy(asc(s.fiscalDocTypes.position), asc(s.fiscalDocTypes.code));
  const t = today();
  return rows.map((d) => ({ id: d.id, branchId: d.branchId, saleKind: d.saleKind, code: d.code, name: d.name, active: d.active, taxes: d.taxes as FiscalTax[], rates: fiscalDocRates({ active: d.active, taxes: d.taxes as FiscalTax[] }, t) }));
}

type Opp = { id: string; tenantId: string; contactId: string; branchId: string | null; saleKind: string | null };

/** Tudo que o cálculo precisa: itens com a resolução fiscal, parâmetros, segmento e o que foi salvo. */
export async function economicsContext(db: DbOrTx, opp: Opp) {
  const [settings, items, docs, [contact], [saved]] = await Promise.all([
    econSettingsOf(db, opp.tenantId),
    db.select().from(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, opp.tenantId))).orderBy(asc(s.opportunityItems.position)),
    fiscalDocsOf(db, opp.tenantId),
    db.select({ segment: s.contacts.segment, nature: s.contacts.nature }).from(s.contacts).where(eq(s.contacts.id, opp.contactId)).limit(1),
    db.select().from(s.opportunityEconomics).where(eq(s.opportunityEconomics.opportunityId, opp.id)).limit(1),
  ]);
  const publicSector = contact?.nature === 'publica' || (contact?.nature !== 'privada' && contact?.segment === 'governamental') || opp.saleKind === 'licitacao';
  const econItems: EconItem[] = items.map((i) => {
    const d = i.fiscalDocTypeId ? docs.find((x) => x.id === i.fiscalDocTypeId) : null;
    return { description: i.description, revenueCents: itemTotal(i), doc: d ? { name: `${d.code} · ${d.name}`, percentBp: d.rates.percentBp, fixedCents: d.rates.fixedCents, complete: d.rates.complete } : null };
  });
  const input = saved ? ({ ...emptyEconInput(), ...(saved.input as Partial<EconInput>) } as EconInput) : emptyEconInput();
  return { settings, items: econItems, publicSector, input, saved: saved ? { updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : null, branchDocs: docs.filter((d) => d.active && (!opp.branchId || d.branchId === opp.branchId) && (!opp.saleKind || d.saleKind === opp.saleKind)) };
}

export const computeEconomics = (ctx: Awaited<ReturnType<typeof economicsContext>>, input?: EconInput) =>
  financeEngine({ input: input ?? ctx.input, items: ctx.items, settings: ctx.settings, publicSector: ctx.publicSector });

/** Guarda entradas e resultado e tira a fotografia auditável (entradas, parâmetros, tributos e avisos da época). */
export async function saveEconomics(db: DbOrTx, opp: Opp, input: EconInput, actorId: string | null, reason = 'salvo') {
  const ctx = await economicsContext(db, opp);
  const result = computeEconomics(ctx, input);
  const now = new Date();
  await db.insert(s.opportunityEconomics).values({ opportunityId: opp.id, tenantId: opp.tenantId, input, result, updatedBy: actorId, updatedAt: now })
    .onConflictDoUpdate({ target: s.opportunityEconomics.opportunityId, set: { input, result, updatedBy: actorId, updatedAt: now } });
  await db.insert(s.opportunityEconomicsSnapshots).values({ tenantId: opp.tenantId, opportunityId: opp.id, input, settings: { ...ctx.settings, publicSector: ctx.publicSector }, result, reason, actorId });
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
