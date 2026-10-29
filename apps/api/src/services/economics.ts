/**
 * Viabilidade econômica da oportunidade (motor financeiro em packages/domain/src/finance.ts).
 * Tributos por item: documento fiscal do item (da filial da venda) → tributos vigentes do documento.
 * Parâmetros: versão vigente de Configurações → Viabilidade (sem versão, não calcula).
 * Segmento público (Conta governamental ou natureza pública, ou venda em licitação) usa o limite de payback e a glosa do público.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { emptyEconInput, financeEngine, fiscalDocRates, itemTotal, type CostImpact, type CostLine, type EconInput, type EconItem, type EconResult, type EconSettings, type FiscalTax } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';

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
  const versions = rows.length ? await db.selectDistinctOn([s.fiscalDocVersions.docId], { docId: s.fiscalDocVersions.docId, id: s.fiscalDocVersions.id, version: s.fiscalDocVersions.version, createdAt: s.fiscalDocVersions.createdAt })
    .from(s.fiscalDocVersions).where(inArray(s.fiscalDocVersions.docId, rows.map((d) => d.id))).orderBy(s.fiscalDocVersions.docId, desc(s.fiscalDocVersions.version)) : [];
  return rows.map((d) => {
    const v = versions.find((x) => x.docId === d.id);
    return { id: d.id, branchId: d.branchId, fiscalKind: d.fiscalKind, code: d.code, name: d.name, active: d.active, taxes: d.taxes as FiscalTax[], rates: fiscalDocRates({ active: d.active, taxes: d.taxes as FiscalTax[] }, t), version: v?.version ?? null, versionId: v?.id ?? null, versionAt: v?.createdAt ?? null };
  });
}

/** Grava a próxima versão dos tributos quando eles mudaram (a primeira, se o documento é novo). */
export async function recordFiscalDocVersion(db: DbOrTx, tenantId: string, docId: string, taxes: FiscalTax[], actorId: string | null) {
  const [last] = await db.select({ version: s.fiscalDocVersions.version, taxes: s.fiscalDocVersions.taxes }).from(s.fiscalDocVersions).where(eq(s.fiscalDocVersions.docId, docId)).orderBy(desc(s.fiscalDocVersions.version)).limit(1);
  if (last && stableStringify(last.taxes) === stableStringify(taxes)) return last.version;
  const version = (last?.version ?? 0) + 1;
  await db.insert(s.fiscalDocVersions).values({ tenantId, docId, version, taxes: taxes as unknown as Record<string, unknown>[], createdBy: actorId });
  return version;
}

/** SHA-256 do conteúdo do cálculo (entradas, parâmetros com versão e emitente, resultado com a versão do motor). */
export const snapshotHash = (c: { input: unknown; settings: unknown; result: unknown }) => createHash('sha256').update(stableStringify(c)).digest('hex');

/** Um cálculo salvo como foi gravado (nada é recalculado) e a conferência do hash. */
export async function economicsRun(db: DbOrTx, tenantId: string, opportunityId: string, runId: string) {
  const [r] = await db.select({ snap: s.opportunityEconomicsSnapshots, actorName: s.users.name }).from(s.opportunityEconomicsSnapshots).leftJoin(s.users, eq(s.users.id, s.opportunityEconomicsSnapshots.actorId))
    .where(and(eq(s.opportunityEconomicsSnapshots.tenantId, tenantId), eq(s.opportunityEconomicsSnapshots.opportunityId, opportunityId), runId === 'ultimo' ? sql`true` : eq(s.opportunityEconomicsSnapshots.id, runId)))
    .orderBy(desc(s.opportunityEconomicsSnapshots.createdAt)).limit(1);
  if (!r) return null;
  const x = r.snap;
  // jsonb não guarda a ordem das chaves, por isso o hash é sobre o JSON ordenado
  const verified = x.sha256 ? snapshotHash({ input: x.input, settings: x.settings, result: x.result }) === x.sha256 : null;
  return { id: x.id, reason: x.reason, createdAt: x.createdAt, actorName: r.actorName, engineVersion: x.engineVersion, settingsVersionId: x.settingsVersionId, sha256: x.sha256, verified, input: x.input as unknown as EconInput, settings: x.settings, result: x.result as unknown as EconResult };
}

/** JSON com chaves em ordem: mesma entrada, mesmo texto (base do hash do cálculo). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object' && !(v instanceof Date)) return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v instanceof Date ? v.toISOString() : v);
}

type Opp = { id: string; tenantId: string; contactId: string; branchId: string | null; saleKind: string | null };

/** Tudo que o cálculo precisa: itens com a resolução fiscal, parâmetros vigentes, segmento e o que foi salvo. */
export async function economicsContext(db: DbOrTx, opp: Opp) {
  const [version, items, docs, [contact], [saved], [branch]] = await Promise.all([
    econSettingsOf(db, opp.tenantId),
    db.select().from(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, opp.tenantId))).orderBy(asc(s.opportunityItems.position)),
    fiscalDocsOf(db, opp.tenantId),
    db.select({ segment: s.contacts.segment, nature: s.contacts.nature }).from(s.contacts).where(eq(s.contacts.id, opp.contactId)).limit(1),
    db.select().from(s.opportunityEconomics).where(eq(s.opportunityEconomics.opportunityId, opp.id)).limit(1),
    opp.branchId ? db.select({ name: s.salesBranches.name, cnpj: s.salesBranches.cnpj, taxRegime: s.salesBranches.taxRegime, city: s.salesBranches.city, state: s.salesBranches.state }).from(s.salesBranches).where(eq(s.salesBranches.id, opp.branchId)).limit(1) : Promise.resolve([]),
  ]);
  const publicSector = contact?.nature === 'publica' || (contact?.nature !== 'privada' && contact?.segment === 'governamental') || opp.saleKind === 'licitacao';
  const econItems: EconItem[] = items.map((i) => {
    const d = i.fiscalDocTypeId ? docs.find((x) => x.id === i.fiscalDocTypeId) : null;
    return { description: i.description, revenueCents: itemTotal(i), doc: d ? { id: d.id, version: d.version ?? undefined, name: `${d.code} · ${d.name}`, percentBp: d.rates.percentBp, fixedCents: d.rates.fixedCents, complete: d.rates.complete } : null };
  });
  const input = saved ? ({ ...emptyEconInput(), ...(saved.input as Partial<EconInput>) } as EconInput) : emptyEconInput();
  return {
    settings: version?.settings ?? null, settingsVersion: version ? { id: version.id, validFrom: version.validFrom } : null,
    items: econItems, publicSector, input,
    /** emitente: a filial da venda com CNPJ, regime e município (contexto fiscal) */
    emitter: branch ?? null,
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
  const settings = { ...ctx.settings, settingsVersionId: ctx.settingsVersion?.id, publicSector: ctx.publicSector, emitter: ctx.emitter };
  await db.insert(s.opportunityEconomicsSnapshots).values({ tenantId: opp.tenantId, opportunityId: opp.id, input, settings, result, reason, actorId, engineVersion: result.engineVersion, settingsVersionId: ctx.settingsVersion?.id ?? null, sha256: snapshotHash({ input, settings, result }) });
  return result;
}

/** Na venda fechada, a fotografia do dia do fechamento (só quando a viabilidade econômica foi preenchida). */
export async function snapshotEconomicsOnWon(db: DbOrTx, opp: Opp, actorId: string | null) {
  const [saved] = await db.select({ input: s.opportunityEconomics.input }).from(s.opportunityEconomics).where(eq(s.opportunityEconomics.opportunityId, opp.id)).limit(1);
  if (!saved) return null;
  return saveEconomics(db, opp, { ...emptyEconInput(), ...(saved.input as Partial<EconInput>) } as EconInput, actorId, 'ganha');
}

export async function economicsHistory(db: DbOrTx, tenantId: string, opportunityId: string) {
  return db.select({ id: s.opportunityEconomicsSnapshots.id, reason: s.opportunityEconomicsSnapshots.reason, createdAt: s.opportunityEconomicsSnapshots.createdAt, actorName: s.users.name, engineVersion: s.opportunityEconomicsSnapshots.engineVersion, sha256: s.opportunityEconomicsSnapshots.sha256, verdict: sql<string>`${s.opportunityEconomicsSnapshots.result}->>'verdict'`, priceCents: sql<number | null>`(${s.opportunityEconomicsSnapshots.result}->>'priceCents')::bigint` })
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

// ------------------------------------------------------------------ catálogo de custos
export type CostItemRow = { id: string; name: string; kind: 'investimento' | 'mensal'; unit: string; impact: CostImpact | null; active: boolean; unitCents: number | null; priceId: string | null; priceFrom: string | null };

/** Itens do catálogo com o preço vigente na data (o de maior vigência até ela; empate, o mais recente). */
export async function costItemsOf(db: DbOrTx, tenantId: string, on = today()): Promise<CostItemRow[]> {
  const items = await db.select().from(s.costItems).where(eq(s.costItems.tenantId, tenantId)).orderBy(asc(s.costItems.kind), asc(s.costItems.name));
  if (!items.length) return [];
  const prices = await db.selectDistinctOn([s.costItemPrices.itemId], { itemId: s.costItemPrices.itemId, id: s.costItemPrices.id, unitCents: s.costItemPrices.unitCents, validFrom: s.costItemPrices.validFrom })
    .from(s.costItemPrices).where(and(inArray(s.costItemPrices.itemId, items.map((i) => i.id)), lte(s.costItemPrices.validFrom, on)))
    .orderBy(s.costItemPrices.itemId, desc(s.costItemPrices.validFrom), desc(s.costItemPrices.createdAt));
  return items.map((i) => { const p = prices.find((x) => x.itemId === i.id); return { id: i.id, name: i.name, kind: i.kind as CostItemRow['kind'], unit: i.unit, impact: (i.impact as CostImpact | null) ?? null, active: i.active, unitCents: p?.unitCents ?? null, priceId: p?.id ?? null, priceFrom: p?.validFrom ?? null }; });
}

/**
 * Linhas de custo vindas do catálogo: confere o item (da empresa, do tipo certo), grava a versão do preço vigente
 * e marca "manual" quando o valor digitado difere do catálogo. Linha sem item fica como está (manual).
 */
export async function resolveCostLines(db: DbOrTx, tenantId: string, input: EconInput): Promise<EconInput> {
  const ids = [...input.capex, ...input.opex].map((l) => l.costItemId).filter((x): x is string => !!x);
  const cat = ids.length ? await costItemsOf(db, tenantId) : [];
  const fix = (kind: CostItemRow['kind']) => (l: EconInput['capex'][number]) => {
    const { costItemId, priceId: _p, manual: _m, ...line } = l;
    if (!costItemId) return { ...line, costItemId: null, priceId: null, manual: true };
    const it = cat.find((c) => c.id === costItemId && c.kind === kind);
    if (!it) return { ...line, costItemId: null, priceId: null, manual: true };
    return { ...line, costItemId: it.id, priceId: it.priceId, manual: it.unitCents == null || it.unitCents !== line.unitCents };
  };
  return { ...input, capex: input.capex.map(fix('investimento')), opex: input.opex.map(fix('mensal')) };
}

const keyOf = (name: string, unit: string | null | undefined) => `${name.trim().toLowerCase()}|${(unit ?? 'un').trim().toLowerCase() || 'un'}`;

/**
 * Auto-aprendizado da planilha (chave Descrição + Unidade): item conhecido preenche o impacto e passa a valer o preço
 * da nova cotação; item novo (ou mesma descrição em outra unidade) entra no catálogo e exige o impacto na primeira vez.
 * Investimento sem impacto e sem histórico é recusado com o nome do item.
 */
export async function learnCostLines(db: DbOrTx, tenantId: string, actorId: string | null, input: EconInput): Promise<EconInput> {
  const cat = await costItemsOf(db, tenantId);
  const on = today();
  const missing: string[] = [];
  const learn = async (kind: CostItemRow['kind'], l: CostLine): Promise<CostLine> => {
    const unit = (l.unit ?? '').trim() || 'un';
    let it = cat.find((c) => c.kind === kind && keyOf(c.name, c.unit) === keyOf(l.description, unit));
    const impact: CostImpact | null = kind === 'mensal' ? 'operacional' : (l.impact ?? it?.impact ?? null);
    if (!impact) { missing.push(l.description); return l; }
    if (!it) {
      const [n] = await db.insert(s.costItems).values({ tenantId, name: l.description.trim().slice(0, 120), kind, unit, impact }).onConflictDoNothing().returning();
      if (!n) return { ...l, impact };
      it = { id: n.id, name: n.name, kind, unit: n.unit, impact, active: true, unitCents: null, priceId: null, priceFrom: null };
      cat.push(it);
    } else if (!it.impact || (l.impact && l.impact !== it.impact)) await db.update(s.costItems).set({ impact, updatedAt: new Date() }).where(eq(s.costItems.id, it.id));
    let priceId = it.priceId;
    if (it.unitCents !== l.unitCents) {
      const [p] = await db.insert(s.costItemPrices).values({ tenantId, itemId: it.id, unitCents: l.unitCents, validFrom: on, createdBy: actorId }).returning({ id: s.costItemPrices.id });
      priceId = p!.id; it.unitCents = l.unitCents; it.priceId = priceId;
    }
    return { ...l, unit, impact, costItemId: it.id, priceId, manual: false };
  };
  const capex: CostLine[] = [], opex: CostLine[] = [];
  for (const l of input.capex) capex.push(await learn('investimento', l));
  for (const l of input.opex) opex.push(await learn('mensal', l));
  if (missing.length) throw unprocessable(`Classifique o que cada item novo impacta (material, serviço, entrega ou taxa fixa de venda): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}.`, [{ path: 'capex', message: 'impacto' }]);
  return { ...input, capex, opex };
}
