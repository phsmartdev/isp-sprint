/**
 * Atas de registro de preços: acesso, regras versionadas, estado (saldos pelo ledger) e gravação atômica/idempotente.
 * Toda gravação que mexe em saldo trava a ata (SELECT ... FOR UPDATE) e recalcula o saldo dentro da transação:
 * duas oportunidades simultâneas nunca consomem o mesmo saldo.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DEFAULT_RULES, computeBalances, lineValue, type ArpLedgerEntry, type ArpRegime, type ArpRules, type AgencyKind } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { forbidden, notFound, unprocessable } from '../http/errors';
import { fmtQty } from '@isp/domain';
import { level } from './scope';
import { atLeast } from '@isp/domain';

// ------------------------------------------------------------------ permissões
export const canViewArp = (a: AuthContext) => level(a, 'contratos') !== 'nenhum';
/** cadastrar ata, itens, importar, criar oportunidade e reservar */
export const canManageArp = (a: AuthContext) => atLeast(level(a, 'contratos'), 'equipe') || a.sectors.some((x) => ['comercial', 'juridico', 'administracao'].includes(x));
/** efetivar movimentações oficiais: consumo, adesão autorizada, operações, regras */
export const canEffectArp = (a: AuthContext) => level(a, 'contratos') === 'total' || a.sectors.some((x) => ['juridico', 'administracao'].includes(x));
export const isJuridico = (a: AuthContext) => a.sectors.includes('juridico');
export function requireArp(a: AuthContext, what: 'view' | 'manage' | 'effect') {
  const ok = what === 'view' ? canViewArp(a) : what === 'manage' ? canManageArp(a) : canEffectArp(a);
  if (!ok) throw forbidden(what === 'effect' ? 'Efetivar movimentações da ata é com Gerência de contratos, Jurídico ou Administração.' : 'Seu perfil não pode alterar atas.');
}

export async function loadArp(db: DbOrTx, auth: AuthContext, id: string) {
  requireArp(auth, 'view');
  const [a] = await db.select().from(s.arps).where(and(eq(s.arps.id, id), eq(s.arps.tenantId, auth.tenantId))).limit(1);
  if (!a) throw notFound('Ata não encontrada.');
  return a;
}
export type ArpRow = typeof s.arps.$inferSelect;

/** Trava a ata para gravações que mexem em saldo (dentro de transação). */
export async function lockArp(tx: DbOrTx, arpId: string) {
  await tx.execute(sql`select id from arps where id = ${arpId} for update`);
}

// ------------------------------------------------------------------ regras versionadas
export async function rulesFor(db: DbOrTx, tenantId: string, regime: ArpRegime): Promise<{ rules: ArpRules; version: number }> {
  const [r] = await db.select().from(s.arpRuleSets).where(and(eq(s.arpRuleSets.tenantId, tenantId), eq(s.arpRuleSets.regime, regime))).orderBy(desc(s.arpRuleSets.version)).limit(1);
  if (!r) return { rules: DEFAULT_RULES[regime], version: 0 };
  return { rules: { ...DEFAULT_RULES[regime], ...(r.rules as Partial<ArpRules>) }, version: r.version };
}

// ------------------------------------------------------------------ estado e saldos
export async function arpState(db: DbOrTx, arpId: string) {
  const [items, agencies, allocations, ledger] = await Promise.all([
    db.select().from(s.arpItems).where(eq(s.arpItems.arpId, arpId)).orderBy(asc(s.arpItems.lot), sql`length(${s.arpItems.itemNumber})`, asc(s.arpItems.itemNumber)),
    db.select().from(s.arpAgencies).where(eq(s.arpAgencies.arpId, arpId)).orderBy(asc(s.arpAgencies.createdAt)),
    db.select().from(s.arpAllocations).where(eq(s.arpAllocations.arpId, arpId)),
    db.select().from(s.arpLedger).where(eq(s.arpLedger.arpId, arpId)).orderBy(asc(s.arpLedger.occurredAt)),
  ]);
  const balances = computeBalances(
    items.map((i) => ({ id: i.id, registeredMilli: i.registeredMilli, unitCents: i.unitCents })),
    agencies.map((a) => ({ id: a.id, kind: a.kind as AgencyKind })),
    allocations.map((a) => ({ itemId: a.itemId, agencyId: a.agencyId, qtyMilli: a.qtyMilli })),
    ledger.map((l) => ({ id: l.id, kind: l.kind as ArpLedgerEntry['kind'], itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli, dir: (l.dir as 'saida' | 'entrada' | null) ?? null, reversesId: l.reversesId })),
  );
  return { items, agencies, allocations, ledger, balances };
}
export type ArpState = Awaited<ReturnType<typeof arpState>>;

export async function arpEvent(db: DbOrTx, auth: AuthContext | null, tenantId: string, arpId: string, type: string, summary: string, payload: Record<string, unknown> | null = null) {
  await db.insert(s.arpEvents).values({ tenantId, arpId, type, summary, actorId: auth?.userId ?? null, payload });
}

export type LedgerMeta = {
  origin: 'oportunidade' | 'formalizacao' | 'adesao' | 'operacao' | 'manual' | 'contrato';
  opportunityId?: string | null;
  contractId?: string | null;
  adhesionId?: string | null;
  operationId?: string | null;
  documentId?: string | null;
  justification?: string | null;
  approvalRef?: string | null;
  ruleVersion: number;
  /** data de eficácia (retroativa quando autorizada); a data de lançamento é sempre agora */
  effectiveOn?: string | null;
  /** prefixo da chave de idempotência; cada linha recebe um sufixo estável */
  idem: string;
};

/**
 * Grava lançamentos (já validados contra o saldo travado). Idempotente: repetir o mesmo pedido não duplica.
 * Devolve quantos foram realmente gravados.
 */
export async function writeLedger(tx: DbOrTx, auth: AuthContext, arpId: string, state: ArpState, entries: ArpLedgerEntry[], meta: LedgerMeta) {
  const byId = new Map(state.items.map((i) => [i.id, i]));
  let written = 0;
  for (const [i, e] of entries.entries()) {
    const it = byId.get(e.itemId);
    if (!it) throw unprocessable('Item fora da ata.');
    const amount = e.amountCents ?? lineValue(Math.abs(e.qtyMilli), it.unitCents);
    const r = await tx.insert(s.arpLedger).values({
      tenantId: auth.tenantId, arpId, itemId: e.itemId, agencyId: e.agencyId, kind: e.kind, dir: e.dir ?? null, qtyMilli: e.qtyMilli, unit: it.unit, unitCents: it.unitCents, amountCents: amount,
      origin: meta.origin, opportunityId: meta.opportunityId ?? null, contractId: meta.contractId ?? null, adhesionId: meta.adhesionId ?? null, operationId: meta.operationId ?? null,
      documentId: meta.documentId ?? null, actorId: auth.userId, justification: meta.justification ?? null, approvalRef: meta.approvalRef ?? null, ruleVersion: meta.ruleVersion,
      reversesId: e.reversesId ?? null, effectiveOn: meta.effectiveOn ?? null, idempotencyKey: `${meta.idem}:${i}:${e.kind}:${e.itemId}:${e.agencyId}`,
    }).onConflictDoNothing({ target: [s.arpLedger.tenantId, s.arpLedger.idempotencyKey] }).returning({ id: s.arpLedger.id });
    written += r.length;
  }
  return written;
}

/** Contato do órgão (para a oportunidade), criado na primeira vez e guardado no órgão. */
export async function agencyContact(tx: DbOrTx, auth: AuthContext, agency: typeof s.arpAgencies.$inferSelect) {
  if (agency.contactId) return agency.contactId;
  const [c] = await tx.insert(s.contacts).values({ tenantId: auth.tenantId, name: agency.name, document: agency.document, segment: 'governamental', ownerId: null, isProvisional: false, createdBy: auth.userId }).returning({ id: s.contacts.id });
  await tx.update(s.arpAgencies).set({ contactId: c!.id }).where(eq(s.arpAgencies.id, agency.id));
  return c!.id;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Confere o saldo disponível por item e órgão (somando linhas repetidas); `release` devolve o que esta mesma operação libera. */
export function checkAvailable(st: ArpState, lines: { itemId: string; agencyId: string; qtyMilli: number }[], release: Map<string, number> = new Map()) {
  const want = new Map<string, number>();
  for (const l of lines) want.set(`${l.itemId}|${l.agencyId}`, (want.get(`${l.itemId}|${l.agencyId}`) ?? 0) + l.qtyMilli);
  for (const [k, q] of want) {
    const b = st.balances.byItemAgency.get(k);
    const avail = (b?.available ?? 0) + (release.get(k) ?? 0);
    const [itemId, agencyId] = k.split('|');
    const it = st.items.find((i) => i.id === itemId);
    const ag = st.agencies.find((a) => a.id === agencyId);
    if (!it || !ag) throw unprocessable('Item ou órgão fora da ata.');
    if (q > avail) throw unprocessable(`Saldo insuficiente no item ${it.itemNumber} para ${ag.name}: disponível ${fmtQty(Math.max(0, avail))} ${it.unit}, pedido ${fmtQty(q)}.`, [{ path: 'lines', message: 'Saldo insuficiente' }]);
  }
}

/**
 * Adesão autorizada que nasceu de uma oportunidade: a quantidade autorizada já fica reservada para ela
 * (é para isso que o órgão pediu). Só reserva se a oportunidade estiver aberta e sem outras reservas. Idempotente.
 */
export async function reserveAdhesionForOpportunity(tx: DbOrTx, auth: AuthContext, arpId: string, adhesionId: string) {
  const [r] = await tx.select().from(s.arpAdhesions).where(eq(s.arpAdhesions.id, adhesionId)).limit(1);
  if (!r?.opportunityId) return 0;
  const [o] = await tx.select({ id: s.opportunities.id, stage: s.opportunities.stage, code: s.opportunities.code, arpId: s.opportunities.arpId, deletedAt: s.opportunities.deletedAt }).from(s.opportunities).where(eq(s.opportunities.id, r.opportunityId)).limit(1);
  if (!o || o.deletedAt || o.stage === 'perdida' || (o.arpId && o.arpId !== arpId)) return 0;
  const [busy] = await tx.select({ id: s.arpOpportunityLines.id }).from(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, o.id), eq(s.arpOpportunityLines.status, 'reservada'))).limit(1);
  if (busy) return 0;
  const st = await arpState(tx, arpId);
  const lines = r.items.map((i) => ({ itemId: i.itemId, agencyId: r.agencyId, qtyMilli: Math.min(i.qtyMilli, Math.max(0, st.balances.byItemAgency.get(`${i.itemId}|${r.agencyId}`)?.available ?? 0)) })).filter((l) => l.qtyMilli > 0);
  if (!lines.length) return 0;
  const [arp] = await tx.select({ regime: s.arps.regime }).from(s.arps).where(eq(s.arps.id, arpId)).limit(1);
  const rule = await rulesFor(tx, auth.tenantId, arp!.regime as ArpRegime);
  const n = await writeLedger(tx, auth, arpId, st, lines.map((l) => ({ kind: 'reserva' as const, ...l })), { origin: 'oportunidade', opportunityId: o.id, adhesionId: r.id, justification: 'Reserva da adesão autorizada', ruleVersion: rule.version, idem: `reserva:${o.id}:adesao:${r.id}` });
  if (!n) return 0;
  for (const l of lines) await tx.insert(s.arpOpportunityLines).values({ tenantId: auth.tenantId, arpId, opportunityId: o.id, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli, unitCents: st.items.find((i) => i.id === l.itemId)!.unitCents }).onConflictDoUpdate({ target: [s.arpOpportunityLines.opportunityId, s.arpOpportunityLines.itemId, s.arpOpportunityLines.agencyId], set: { qtyMilli: l.qtyMilli, status: 'reservada', updatedAt: new Date() } });
  await tx.update(s.opportunities).set({ arpId, updatedAt: new Date() }).where(eq(s.opportunities.id, o.id));
  await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'ata_adesao_autorizada', actorId: auth.userId, payload: { arpId, adhesionId: r.id, lines: lines.length } });
  await arpEvent(tx, auth, auth.tenantId, arpId, 'reserva', `Adesão autorizada: quantidade reservada para a OP-${o.code}.`, { opportunityId: o.id, adhesionId: r.id });
  return n;
}
