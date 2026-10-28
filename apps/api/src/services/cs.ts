/**
 * Sucesso do Cliente: configuração versionada, fotografia calculada de cada conta (ACV, Tier, IPC, saúde, criticidade,
 * prioridade efetiva), jornada com kickoff, cadência de acompanhamentos e alertas preventivos.
 * Regras puras em @isp/domain (cs.ts). Aqui só buscamos os dados reais e gravamos o resultado.
 * Dado ausente fica null ("indisponível") — nunca vira bom nem ruim.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  CS_ACTIVITY_LABELS, DEFAULT_CS_CONFIG, accountAcv, IPC_CRITERIA, cadenceDates, contractAcv, criticality, effectivePriority, healthScore, ipcScore, levelRank, ledgerTotals, monthsToIpc, policyFor, tierOf, tierToIpc,
  type CsActivityKind, type CsConfig, type CsLevel, type IpcInput, type JourneyTpl, type Tier,
} from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { sendEmail } from './email';
import { publicLink } from './alerts';

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const dayOf = (d: Date | string | null | undefined) => (d ? (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);

// ------------------------------------------------------------------ configuração
export async function csConfigOf(db: DbOrTx, tenantId: string): Promise<{ config: CsConfig; version: number }> {
  const [r] = await db.select().from(s.csSettings).where(eq(s.csSettings.tenantId, tenantId)).orderBy(desc(s.csSettings.version)).limit(1);
  if (!r) return { config: DEFAULT_CS_CONFIG, version: 0 };
  // campos novos da configuração padrão entram sem sobrescrever o que o admin gravou
  const c = r.config as Partial<CsConfig>;
  return { config: { ...DEFAULT_CS_CONFIG, ...c, alerts: { ...DEFAULT_CS_CONFIG.alerts, ...(c.alerts ?? {}) }, trigger: { ...DEFAULT_CS_CONFIG.trigger, ...(c.trigger ?? {}) } }, version: r.version };
}

// ------------------------------------------------------------------ fotografia da conta
export type Snapshot = {
  computedAt: string; ruleVersion: number;
  acvCents: number; groupAcvCents: number; groupContacts: number; tier: Tier | null;
  /** composição do valor anual consolidado (base do Tier) e o consumo de medição que ficou de fora */
  acvParts?: { recorrente: number; medicao: number; frequente: number; semContrato: number }; acvExcluded?: { count: number; cents: number };
  contracts: { id: string; number: string; billingType: string; kind: string; stage: string; acvCents: number; startAt: string | null; endAt: string | null; consumption: null | { credited: number; consumed: number; share: number | null; elapsedShare: number | null; exhaustAt: string | null; lastConsumptionAt: string | null } }[];
  relationshipMonths: number | null;
  classKey: string | null;
  ipc: { total: number | null; partial: number; pending: string[]; levels: IpcInput; auto: string[]; assessedAt: string | null; reviewDue: boolean };
  satisfaction: { last: number | null; previous: number | null; lastAt: string | null; kind: string | null };
  financial: { available: false; reason: string };
  occurrences: number; highOccurrences: number;
  deliveries: { due: number; late: number };
  churnRisk: 'baixo' | 'medio' | 'alto' | null;
  lastContactAt: string | null; nextContactAt: string | null; overdueFollowUpDays: number;
  daysToEnd: number | null;
  health: { score: number | null; label: string; coverage: number; parts: { key: string; value: number | null; weight: number }[] };
  criticality: { level: CsLevel; points: number; reasons: { key: string; reason: string; points: number }[] };
  manual: { level: CsLevel; reason: string | null; reviewAt: string | null; by: string | null; at: string | null } | null;
  effective: { level: CsLevel; source: 'calculada' | 'manual' };
  csmId: string | null;
  expansion: { openCount: number; openValueCents: number };
  policy: { key: string; name: string; contactDays: number | null; visitDays: number | null; reviewDays: number | null } | null;
};

const rootOf = (doc: string | null) => { const d = (doc ?? '').replace(/\D/g, ''); return d.length === 14 ? d.slice(0, 8) : null; };

/** Contas acompanhadas: com contrato não arquivado, jornada ou cadastro no Sucesso do Cliente. */
export async function accountIds(db: DbOrTx, tenantId: string) {
  const r = await db.execute<{ id: string }>(sql`
    select distinct contact_id as id from contracts where tenant_id = ${tenantId} and stage <> 'arquivado'
    union select contact_id from cs_accounts where tenant_id = ${tenantId}
    union select contact_id from cs_journeys where tenant_id = ${tenantId}`);
  return r.rows.map((x) => x.id);
}

/** Calcula e grava a fotografia das contas (em lote). Mudanças de Tier, saúde e criticidade vão para o histórico. */
export async function recomputeAccounts(db: DbOrTx, tenantId: string, only?: string[]) {
  const { config: cfg, version } = await csConfigOf(db, tenantId);
  const ids = only?.length ? only : await accountIds(db, tenantId);
  if (!ids.length) return 0;
  const today = todayIso();
  const contacts = await db.select({ id: s.contacts.id, name: s.contacts.name, document: s.contacts.document, segment: s.contacts.segment }).from(s.contacts).where(eq(s.contacts.tenantId, tenantId));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const allContracts = await db.select({ c: s.contracts, v: s.contractVersions }).from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(and(eq(s.contracts.tenantId, tenantId), sql`${s.contracts.stage} not in ('arquivado')`));
  const ledger = await db.select({ contractId: s.contractLedger.contractId, kind: s.contractLedger.kind, amountCents: s.contractLedger.amountCents, occurredOn: s.contractLedger.occurredOn }).from(s.contractLedger).where(eq(s.contractLedger.tenantId, tenantId));
  const links = await db.select().from(s.contactIdentityLinks).where(and(eq(s.contactIdentityLinks.tenantId, tenantId), eq(s.contactIdentityLinks.decision, 'mesmo')));
  const accounts = new Map((await db.select().from(s.csAccounts).where(and(eq(s.csAccounts.tenantId, tenantId), inArray(s.csAccounts.contactId, ids)))).map((a) => [a.contactId, a]));
  const classes = await db.execute<{ contact_id: string; class_key: string | null }>(sql`select distinct on (contact_id) contact_id, class_key from contact_classifications where tenant_id = ${tenantId} order by contact_id, created_at desc`);
  const classOf = new Map(classes.rows.map((r) => [r.contact_id, r.class_key]));
  const ipcs = await db.execute<{ contact_id: string; data: IpcInput; created_at: string }>(sql`select distinct on (contact_id) contact_id, data, created_at from cs_assessments where tenant_id = ${tenantId} and kind = 'ipc' order by contact_id, created_at desc`);
  const ipcOf = new Map(ipcs.rows.map((r) => [r.contact_id, r]));
  const surveys = await db.select().from(s.csSurveys).where(and(eq(s.csSurveys.tenantId, tenantId), inArray(s.csSurveys.contactId, ids))).orderBy(desc(s.csSurveys.respondedAt), desc(s.csSurveys.createdAt));
  const plans = await db.select({ contactId: s.csActionPlans.contactId, kind: s.csActionPlans.kind, severity: s.csActionPlans.severity }).from(s.csActionPlans).where(and(eq(s.csActionPlans.tenantId, tenantId), eq(s.csActionPlans.status, 'aberto'), eq(s.csActionPlans.kind, 'ocorrencia')));
  const miles = await db.select({ contactId: s.csJourneys.contactId, plannedAt: s.csMilestones.plannedAt, doneAt: s.csMilestones.doneAt }).from(s.csMilestones).innerJoin(s.csJourneys, eq(s.csJourneys.id, s.csMilestones.journeyId)).where(and(eq(s.csMilestones.tenantId, tenantId), eq(s.csJourneys.status, 'ativa')));
  const acts = await db.select({ contactId: s.activities.contactId, csKind: s.activities.csKind, csPlannedAt: s.activities.csPlannedAt, completedAt: s.activities.completedAt, csResult: s.activities.csResult, dueAt: s.activities.dueAt }).from(s.activities).where(and(eq(s.activities.tenantId, tenantId), isNotNull(s.activities.csKind), isNull(s.activities.deletedAt), inArray(s.activities.contactId, ids)));
  const opps = await db.execute<{ contact_id: string; n: number; v: string }>(sql`select o.contact_id, count(*)::int n, coalesce(sum(o.value_cents),0)::bigint v from opportunities o join pipelines p on p.id = o.pipeline_id where o.tenant_id = ${tenantId} and o.deleted_at is null and o.stage not in ('ganha','perdida') and p.key <> 'sucesso_cliente' group by o.contact_id`);
  const oppOf = new Map(opps.rows.map((r) => [r.contact_id, r]));
  const prev = await db.execute<{ contact_id: string; kind: string; level: string | null; score: number | null }>(sql`select distinct on (contact_id, kind) contact_id, kind, level, score from cs_assessments where tenant_id = ${tenantId} and kind in ('tier','saude','criticidade') order by contact_id, kind, created_at desc`);
  const prevOf = (cid: string, kind: string) => prev.rows.find((r) => r.contact_id === cid && r.kind === kind);

  // oportunidades ganhas (fora do funil Sucesso do Cliente, que duplica), para o valor consolidado da conta
  const won = await db.execute<{ id: string; contact_id: string; value_cents: string | null; plan_id: string | null; items: number; sale_kind: string | null; consumes: boolean }>(sql`
    select o.id, o.contact_id, o.value_cents, o.plan_id, (select count(*)::int from opportunity_items i where i.opportunity_id = o.id) items, o.sale_kind,
           exists (select 1 from contract_ledger l where l.opportunity_id = o.id and l.kind = 'consumo') consumes
      from opportunities o join pipelines p on p.id = o.pipeline_id
     where o.tenant_id = ${tenantId} and o.deleted_at is null and o.stage = 'ganha' and p.key <> 'sucesso_cliente'`);
  const acvOfContract = (x: (typeof allContracts)[number]) => contractAcv({ monthlyCents: x.v.monthlyCents, totalCents: x.v.totalCents, startAt: x.v.startAt, endAt: x.v.endAt });
  const activeOf = (cid: string) => allContracts.filter((x) => x.c.contactId === cid && x.c.stage !== 'encerramento' && (!x.v.endAt || x.v.endAt >= today));
  let n = 0;
  for (const cid of ids) {
    const contact = contactById.get(cid);
    if (!contact) continue;
    // grupo: mesmo CNPJ raiz + vínculos "mesmo cliente" decididos por pessoas; contrato conta uma vez só
    const root = rootOf(contact.document);
    const group = new Set([cid, ...links.filter((l) => l.contactId === cid || l.otherContactId === cid).flatMap((l) => [l.contactId, l.otherContactId]), ...(root ? contacts.filter((c) => rootOf(c.document) === root).map((c) => c.id) : [])]);
    const own = activeOf(cid);
    const groupContracts = new Map(allContracts.filter((x) => group.has(x.c.contactId) && x.c.stage !== 'encerramento' && (!x.v.endAt || x.v.endAt >= today)).map((x) => [x.c.id, x]));
    // valor anual consolidado: contratos vigentes (recorrente ×12, medição, frequente) + ganhas sem contrato; consumo de medição não soma
    const toC = (x: (typeof allContracts)[number]) => ({ id: x.c.id, opportunityId: x.c.opportunityId, billingType: x.c.billingType, acvCents: acvOfContract(x) });
    const toO = (o: (typeof won.rows)[number]) => ({ id: o.id, valueCents: o.value_cents === null ? null : Number(o.value_cents), monthly: !o.items && !!o.plan_id, saleKind: o.sale_kind, consumesContract: o.consumes });
    const ownAcv = accountAcv(own.map(toC), won.rows.filter((o) => o.contact_id === cid).map(toO));
    const groupCalc = accountAcv([...groupContracts.values()].map(toC), won.rows.filter((o) => group.has(o.contact_id)).map(toO));
    const acv = ownAcv.acvCents;
    const groupAcv = groupCalc.acvCents;
    const tier = groupAcv > 0 ? tierOf(groupAcv, cfg.tierBands) : null;
    const contractsView = allContracts.filter((x) => x.c.contactId === cid).map((x) => {
      let consumption: Snapshot['contracts'][number]['consumption'] = null;
      if (x.c.billingType !== 'recorrente') {
        const led = ledger.filter((l) => l.contractId === x.c.id);
        const t = ledgerTotals(led);
        const elapsed = x.v.startAt && x.v.endAt ? Math.max(0, Math.min(1, daysBetween(x.v.startAt, today) / Math.max(1, daysBetween(x.v.startAt, x.v.endAt)))) : null;
        const usedDays = x.v.startAt ? Math.max(1, daysBetween(x.v.startAt, today)) : null;
        const exhaustAt = t.usedShare && t.usedShare > 0 && usedDays && t.usedShare < 1 ? addDays(today, Math.round((usedDays / t.usedShare) * (1 - t.usedShare))) : null;
        const last = led.filter((l) => l.kind === 'consumo').map((l) => String(l.occurredOn)).sort().pop() ?? null;
        consumption = t.credited ? { credited: t.credited, consumed: t.consumed, share: t.usedShare, elapsedShare: elapsed, exhaustAt, lastConsumptionAt: last } : null;
      }
      return { id: x.c.id, number: x.v.number, billingType: x.c.billingType, kind: x.c.kind, stage: x.c.stage, acvCents: acvOfContract(x), startAt: x.v.startAt, endAt: x.v.endAt, consumption };
    });
    const starts = own.map((x) => x.v.startAt).filter(Boolean).sort() as string[];
    const months = starts[0] ? Math.max(0, Math.floor(daysBetween(starts[0], today) / 30.44)) : null;
    const ends = own.map((x) => x.v.endAt).filter(Boolean).sort() as string[];
    const daysToEnd = ends[0] ? daysBetween(today, ends[0]) : null;

    // IPC: objetivos calculados; qualitativos só do que foi avaliado
    const ipcRow = ipcOf.get(cid);
    const levels: IpcInput = { ...(ipcRow?.data ?? {}) };
    const auto: string[] = [];
    if (tier) { levels.tamanho = tierToIpc(tier); auto.push('tamanho'); }
    if (months !== null) { levels.tempo = monthsToIpc(months); auto.push('tempo'); }
    const ipc = ipcScore(levels, cfg);
    const assessedAt = ipcRow ? dayOf(new Date(ipcRow.created_at)) : null;

    const sv = surveys.filter((x) => x.contactId === cid);
    const norm = (x: (typeof sv)[number]) => (x.scale <= 5 ? Math.round(((x.score - 1) / Math.max(1, x.scale - 1)) * 100) : Math.round((x.score / x.scale) * 100));
    const satLast = sv[0] ? norm(sv[0]) : null;
    const satPrev = sv[1] ? norm(sv[1]) : null;

    const occ = plans.filter((p) => p.contactId === cid);
    const ms = miles.filter((m) => m.contactId === cid && m.plannedAt && m.plannedAt <= today);
    const late = ms.filter((m) => !m.doneAt).length;
    const a = accounts.get(cid);
    const encerrando = own.some((x) => x.c.stage === 'encerramento') || allContracts.some((x) => x.c.contactId === cid && x.c.stage === 'encerramento');
    const churnRisk = (a?.churnRisk as Snapshot['churnRisk']) ?? (encerrando ? 'alto' : null);
    const myActs = acts.filter((x) => x.contactId === cid);
    const done = myActs.filter((x) => x.completedAt && x.csResult).map((x) => dayOf(x.completedAt)!).sort();
    const lastContact = done.pop() ?? null;
    const open = myActs.filter((x) => !x.completedAt);
    const nextContact = open.map((x) => dayOf(x.dueAt)).filter(Boolean).sort()[0] ?? null;
    const overdue = open.filter((x) => x.csPlannedAt && x.csPlannedAt < today).map((x) => daysBetween(x.csPlannedAt!, today));
    const overdueDays = overdue.length ? Math.max(...overdue) : 0;

    // saúde (0 = ruim, 100 = bom); null quando não há dado
    const cons = contractsView.map((c) => c.consumption).filter((c): c is NonNullable<typeof c> => !!c && c.share !== null && c.elapsedShare !== null);
    const consumoScore = cons.length ? Math.round(cons.reduce((t, c) => t + Math.max(0, 100 - Math.abs((c.share ?? 0) - (c.elapsedShare ?? 0)) * 150), 0) / cons.length) : null;
    const pol0 = policyFor({ criticality: (a?.snapshot as Snapshot | null)?.effective?.level ?? 'moderada', tier, classKey: classOf.get(cid) ?? null, billingType: own[0]?.c.billingType ?? null, segment: contact.segment, csmId: a?.csmId ?? null }, cfg);
    const sinceRef = lastContact ?? starts[0] ?? null;
    const relScore = sinceRef && pol0?.contactDays ? Math.max(0, 100 - Math.max(0, daysBetween(sinceRef, today) - pol0.contactDays) * 2) : null;
    const health = healthScore({
      consumo: consumoScore, inadimplencia: null, satisfacao: satLast,
      ocorrencias: occ.length ? Math.max(0, 100 - occ.length * 25 - occ.filter((o) => o.severity === 'alta').length * 25) : (a || ms.length ? 100 : null),
      entregas: ms.length ? Math.round(((ms.length - late) / ms.length) * 100) : null,
      risco: churnRisk ? (churnRisk === 'alto' ? 0 : churnRisk === 'medio' ? 50 : 100) : null,
      relacionamento: relScore,
    }, cfg);
    const maxShare = cons.length ? Math.max(...cons.map((c) => (c.share ?? 0) * 100)) : null;
    const crit = criticality({ health: health.score, tier, ipc: ipc.total, classKey: classOf.get(cid) ?? null, consumptionPct: maxShare, overdueCents: null, satisfaction: satLast, daysToEnd, churnRisk, openOccurrences: occ.length, daysOverdueFollowUp: overdueDays }, cfg);
    const manual = a?.manualLevel ? { level: a.manualLevel as CsLevel, reason: a.manualReason, reviewAt: a.manualReviewAt, by: a.manualBy, at: a.manualAt?.toISOString() ?? null } : null;
    const effective = effectivePriority(crit.level, manual, cfg.precedence, today);
    const pol = policyFor({ criticality: effective.level, tier, classKey: classOf.get(cid) ?? null, billingType: own[0]?.c.billingType ?? null, segment: contact.segment, csmId: a?.csmId ?? null }, cfg);
    const csmId = a?.csmId ?? own.find((x) => x.c.csmId)?.c.csmId ?? null;
    const snap: Snapshot = {
      computedAt: new Date().toISOString(), ruleVersion: version,
      acvCents: acv, groupAcvCents: groupAcv, acvParts: groupCalc.parts, acvExcluded: groupCalc.excluded, groupContacts: group.size, tier, contracts: contractsView, relationshipMonths: months, classKey: classOf.get(cid) ?? null,
      ipc: { total: ipc.total, partial: ipc.partial, pending: ipc.pending, levels, auto, assessedAt, reviewDue: !assessedAt || daysBetween(assessedAt, today) > cfg.ipcRevisionDays },
      satisfaction: { last: satLast, previous: satPrev, lastAt: sv[0]?.respondedAt ?? null, kind: sv[0]?.kind ?? null },
      financial: { available: false, reason: 'Aguardando integração de faturas do IXC/ERP' },
      occurrences: occ.length, highOccurrences: occ.filter((o) => o.severity === 'alta').length,
      deliveries: { due: ms.length, late }, churnRisk, lastContactAt: lastContact, nextContactAt: nextContact, overdueFollowUpDays: overdueDays, daysToEnd,
      health: { score: health.score, label: health.label, coverage: health.coverage, parts: health.parts },
      criticality: crit, manual, effective, csmId,
      expansion: { openCount: oppOf.get(cid)?.n ?? 0, openValueCents: Number(oppOf.get(cid)?.v ?? 0) },
      policy: pol ? { key: pol.key, name: pol.name, contactDays: pol.contactDays, visitDays: pol.visitDays, reviewDays: pol.reviewDays } : null,
    };
    await db.insert(s.csAccounts).values({ tenantId, contactId: cid, csmId, snapshot: snap as unknown as Record<string, unknown>, computedAt: new Date() })
      .onConflictDoUpdate({ target: [s.csAccounts.tenantId, s.csAccounts.contactId], set: { snapshot: snap as unknown as Record<string, unknown>, computedAt: new Date(), csmId: sql`coalesce(${s.csAccounts.csmId}, excluded.csm_id)` } });
    // histórico: só quando muda
    const hist: { kind: string; level: string | null; score: number | null; data: Record<string, unknown> }[] = [];
    if (prevOf(cid, 'tier')?.level !== (tier ?? null) && tier) hist.push({ kind: 'tier', level: tier, score: null, data: { acvCents: acv, groupAcvCents: groupAcv, contracts: [...groupContracts.keys()] } });
    const ph = prevOf(cid, 'saude');
    if ((ph?.score ?? null) !== health.score) hist.push({ kind: 'saude', level: health.label, score: health.score, data: { parts: health.parts, coverage: health.coverage } });
    if (prevOf(cid, 'criticidade')?.level !== crit.level) hist.push({ kind: 'criticidade', level: crit.level, score: crit.points, data: { reasons: crit.reasons } });
    for (const h of hist) await db.insert(s.csAssessments).values({ tenantId, contactId: cid, kind: h.kind, data: h.data, level: h.level, score: h.score, ruleVersion: version, actorId: null });
    n++;
  }
  return n;
}

export async function snapshotOf(db: DbOrTx, tenantId: string, contactId: string, refresh = false): Promise<Snapshot | null> {
  if (refresh) await recomputeAccounts(db, tenantId, [contactId]);
  const [a] = await db.select({ snapshot: s.csAccounts.snapshot }).from(s.csAccounts).where(and(eq(s.csAccounts.tenantId, tenantId), eq(s.csAccounts.contactId, contactId))).limit(1);
  return (a?.snapshot as Snapshot | undefined) ?? null;
}

/**
 * Snapshot atualizado: recalcula a conta quando uma oportunidade ou um contrato dela mudou depois do último cálculo
 * (ganho, valor, aditivo, reajuste, etapa). Assim o Tier e o IPC acompanham o valor anual sem esperar a rotina diária.
 */
export async function freshSnapshot(db: DbOrTx, tenantId: string, contactId: string): Promise<Snapshot | null> {
  const current = await snapshotOf(db, tenantId, contactId);
  const [{ at } = { at: null }] = await db.execute<{ at: string | Date | null }>(sql`
    select greatest(
      (select max(updated_at) from opportunities where tenant_id = ${tenantId} and contact_id = ${contactId}),
      (select max(updated_at) from contracts where tenant_id = ${tenantId} and contact_id = ${contactId})
    ) as at`).then((r) => r.rows);
  if (current && (!at || new Date(at).getTime() <= new Date(current.computedAt).getTime())) return current;
  // prospect sem venda ganha nem contrato não vira conta do Sucesso do Cliente só por ter a ficha aberta
  if (!current) {
    const r = await db.execute<{ n: number }>(sql`
      select (select count(*) from contracts where tenant_id = ${tenantId} and contact_id = ${contactId} and stage <> 'arquivado')
           + (select count(*) from opportunities where tenant_id = ${tenantId} and contact_id = ${contactId} and stage = 'ganha') as n`);
    if (!Number(r.rows[0]?.n)) return null;
  }
  return snapshotOf(db, tenantId, contactId, true);
}

/** Motivo da prioridade em uma frase (explicabilidade). */
export function explain(sn: Snapshot) {
  const parts = [sn.criticality.reasons.slice(0, 3).map((r) => r.reason).join(', ')];
  if (sn.effective.source === 'manual') parts.unshift(`prioridade manual${sn.manual?.reason ? ` (${sn.manual.reason})` : ''}`);
  if (sn.classKey) parts.push(`classe ${sn.classKey}`);
  return parts.filter(Boolean).join('; ') || 'sem sinais de risco no momento';
}

// ------------------------------------------------------------------ jornada e kickoff
function pickTemplate(cfg: CsConfig, c: { kind: string | null; billingType: string | null; acvCents: number }): JourneyTpl {
  const fits = cfg.journeyTemplates.filter((t) => (!t.appliesTo.kind || t.appliesTo.kind === c.kind) && (!t.appliesTo.billingType || t.appliesTo.billingType === c.billingType) && (!t.appliesTo.minAcvCents || c.acvCents >= t.appliesTo.minAcvCents));
  const spec = (t: JourneyTpl) => Object.values(t.appliesTo).filter((v) => v !== null && v !== undefined).length + (t.appliesTo.minAcvCents ?? 0) / 1e12;
  return fits.sort((a, b) => spec(b) - spec(a))[0] ?? cfg.journeyTemplates[0]!;
}

export type Slide = { id: string; key: string; title: string; layout: 'capa' | 'texto' | 'duas_colunas' | 'tabela' | 'encerramento'; body: string; table?: string[][]; hidden: boolean; pending: string[] };
const fmtMoney = (c: number | null | undefined) => (c ? (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null);
const fmtD = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : null);

/** Monta o kickoff com dados reais. O que faltar entra marcado como pendente — nada é inventado. */
export function buildKickoff(d: {
  tenantName: string; client: string; contract: null | { number: string; object: string; startAt: string | null; endAt: string | null; monthlyCents: number | null; totalCents: number | null; items: { description: string; qty: number }[]; specialConditions: string | null; kind: string };
  csm: { name: string; email: string | null; phone: string | null } | null; commercial: { name: string; email: string | null } | null; delivery: { name: string; email: string | null } | null;
  contacts: { name: string; email: string | null; phone: string | null }[]; milestones: { phase: string; title: string; plannedAt: string | null }[]; kickoffAt: string | null;
}): Slide[] {
  const P = (v: string | null | undefined, label: string, pend: string[]) => { if (!v) pend.push(label); return v ?? `[${label} — preencher]`; };
  const slides: Slide[] = [];
  const add = (key: string, title: string, layout: Slide['layout'], build: (pend: string[]) => { body: string; table?: string[][] }) => { const pending: string[] = []; const b = build(pending); slides.push({ id: key, key, title, layout, hidden: false, pending, ...b }); };
  const c = d.contract;
  add('capa', 'Kickoff', 'capa', (p) => ({ body: `${d.client}\nContrato ${P(c?.number, 'Número do contrato', p)}\n${d.tenantName}` }));
  add('institucional', 'Quem somos', 'texto', (p) => ({ body: `${d.tenantName}\n${P(null, 'Apresentação institucional', p)}` }));
  add('servicos', 'Soluções e serviços contratados', 'tabela', (p) => (c?.items.length ? { body: '', table: [['Serviço', 'Quantidade'], ...c.items.map((i) => [i.description, String(i.qty)])] } : { body: P(null, 'Serviços contratados', p) }));
  add('jornada', 'Visão geral da jornada', 'texto', () => ({ body: '- Onboarding: boas-vindas, kickoff, planejamento, implantação e acompanhamento de 30, 60 e 90 dias\n- Adoção: checagens, análises trimestrais, visitas e pesquisas\n- Renovação: avaliação contratual, escopo, consumo, satisfação, proposta e formalização' }));
  for (const [key, title, phase] of [['onboarding', 'Onboarding', 'onboarding'], ['adocao', 'Adoção', 'adocao'], ['renovacao', 'Renovação', 'renovacao']] as const) {
    const ms = d.milestones.filter((m) => m.phase === phase);
    add(key, title, 'tabela', (p) => ({ body: '', table: [['Etapa', 'Data prevista'], ...ms.map((m) => [m.title, fmtD(m.plannedAt) ?? (p.push(`Data de ${m.title}`), 'a definir')])] }));
  }
  add('objeto', 'Objeto do contrato', 'texto', (p) => ({ body: `${P(c?.object, 'Objeto do contrato', p)}\nVigência: ${P(c?.startAt && c.endAt ? `${fmtD(c.startAt)} a ${fmtD(c.endAt)}` : null, 'Vigência', p)}${c?.monthlyCents ? `\nValor mensal: ${fmtMoney(c.monthlyCents)}` : c?.totalCents ? `\nValor global: ${fmtMoney(c.totalCents)}` : ''}` }));
  add('entregaveis_adm', 'Entregáveis administrativos', 'texto', (p) => ({ body: P(null, 'Entregáveis administrativos (relatórios, faturas, reuniões)', p) }));
  add('entregaveis_tec', 'Entregáveis técnicos', 'texto', (p) => ({ body: P(null, 'Entregáveis técnicos', p) }));
  add('sla', 'Níveis mínimos de serviço', 'texto', (p) => ({ body: P(c?.specialConditions, 'SLA do contrato', p) }));
  add('contatos', 'Contatos e responsáveis', 'duas_colunas', (p) => ({ body: `Nossa equipe\n- CSM: ${P(d.csm ? [d.csm.name, d.csm.email, d.csm.phone].filter(Boolean).join(' · ') : null, 'CSM', p)}\n- Comercial: ${P(d.commercial ? [d.commercial.name, d.commercial.email].filter(Boolean).join(' · ') : null, 'Responsável comercial', p)}\n- Implantação: ${P(d.delivery ? [d.delivery.name, d.delivery.email].filter(Boolean).join(' · ') : null, 'Responsável pela implantação', p)}\n|\nCliente\n${d.contacts.length ? d.contacts.map((x) => `- ${[x.name, x.email, x.phone].filter(Boolean).join(' · ')}`).join('\n') : `- ${P(null, 'Contatos do cliente', p)}`}` }));
  add('responsabilidades', 'Responsabilidades das partes', 'duas_colunas', (p) => ({ body: `${d.tenantName}\n- ${P(null, 'Responsabilidades da contratada', p)}\n|\n${d.client}\n- ${P(null, 'Responsabilidades do cliente', p)}` }));
  add('execucao', 'Etapas de execução', 'texto', () => ({ body: d.milestones.filter((m) => m.phase === 'onboarding').map((m) => `- ${m.title}`).join('\n') }));
  add('ativos', 'Ativos e passivos', 'texto', (p) => ({ body: P(null, 'Ativos e passivos (quando aplicável)', p) }));
  slides[slides.length - 1]!.hidden = true;
  add('cronograma', 'Cronograma', 'tabela', () => ({ body: '', table: [['Marco', 'Fase', 'Data'], ...d.milestones.filter((m) => m.plannedAt).slice(0, 14).map((m) => [m.title, m.phase === 'onboarding' ? 'Onboarding' : m.phase === 'adocao' ? 'Adoção' : 'Renovação', fmtD(m.plannedAt)!])] }));
  add('proximos', 'Próximos passos', 'texto', () => ({ body: d.milestones.filter((m) => m.phase === 'onboarding').slice(2, 5).map((m) => `- ${m.title}${m.plannedAt ? ` até ${fmtD(m.plannedAt)}` : ''}`).join('\n') }));
  add('encerramento', 'Obrigado', 'encerramento', () => ({ body: `${d.tenantName}\nEstamos juntos nesta jornada.` }));
  return slides;
}

async function journeyData(db: DbOrTx, tenantId: string, j: typeof s.csJourneys.$inferSelect) {
  const [t] = await db.select({ name: s.tenants.name }).from(s.tenants).where(eq(s.tenants.id, tenantId)).limit(1);
  const [contact] = await db.select().from(s.contacts).where(eq(s.contacts.id, j.contactId)).limit(1);
  let contract: Parameters<typeof buildKickoff>[0]['contract'] = null;
  let commercialId: string | null = null, deliveryId: string | null = null;
  if (j.contractId) {
    const [x] = await db.select({ c: s.contracts, v: s.contractVersions }).from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(eq(s.contracts.id, j.contractId)).limit(1);
    if (x) {
      contract = { number: x.v.number, object: x.v.object, startAt: x.v.startAt, endAt: x.v.endAt, monthlyCents: x.v.monthlyCents, totalCents: x.v.totalCents, items: x.v.items.map((i) => ({ description: i.description, qty: i.qty })), specialConditions: x.v.specialConditions, kind: x.c.kind };
      commercialId = x.c.commercialOwnerId; deliveryId = x.c.operationalOwnerId;
    }
  }
  const user = async (id: string | null) => (id ? (await db.select({ name: s.users.name, email: s.users.email, phone: s.users.phone }).from(s.users).where(eq(s.users.id, id)).limit(1))[0] ?? null : null);
  const ms = await db.select().from(s.csMilestones).where(eq(s.csMilestones.journeyId, j.id)).orderBy(asc(s.csMilestones.position));
  return {
    tenantName: t?.name ?? 'Nossa empresa', client: contact?.name ?? 'Cliente', contract,
    csm: await user(j.csmId), commercial: await user(commercialId), delivery: await user(deliveryId),
    contacts: contact ? [{ name: contact.name, email: contact.email, phone: contact.phone }] : [],
    milestones: ms.map((m) => ({ phase: m.phase, title: m.title, plannedAt: m.plannedAt })), kickoffAt: j.kickoffAt?.toISOString() ?? null,
  };
}
export async function regenerateKickoff(db: DbOrTx, tenantId: string, journeyId: string, actorId: string | null, note: string) {
  const [j] = await db.select().from(s.csJourneys).where(eq(s.csJourneys.id, journeyId)).limit(1);
  const slides = buildKickoff(await journeyData(db, tenantId, j!));
  const [last] = await db.select({ v: s.csPresentations.version }).from(s.csPresentations).where(eq(s.csPresentations.journeyId, journeyId)).orderBy(desc(s.csPresentations.version)).limit(1);
  await db.insert(s.csPresentations).values({ tenantId, journeyId, version: (last?.v ?? 0) + 1, slides: slides as unknown as Record<string, unknown>[], note, createdBy: actorId });
}

/**
 * Inicia a jornada (idempotente por contrato, ou por oportunidade quando não há contrato):
 * modelo, marcos, tarefas do onboarding, CSM, kickoff v1, avisos e histórico.
 */
export async function startJourney(db: DbOrTx, config: Config, tenantId: string, actorId: string | null, input: { contactId: string; contractId: string | null; opportunityId: string | null; csmId?: string | null }) {
  const { config: cfg, version } = await csConfigOf(db, tenantId);
  const triggerKey = input.contractId ? `contrato:${input.contractId}` : `oportunidade:${input.opportunityId}`;
  const [exists] = await db.select({ id: s.csJourneys.id }).from(s.csJourneys).where(and(eq(s.csJourneys.tenantId, tenantId), eq(s.csJourneys.triggerKey, triggerKey))).limit(1);
  if (exists) return { id: exists.id, created: false };
  const today = todayIso();
  let ctr: { c: typeof s.contracts.$inferSelect; v: typeof s.contractVersions.$inferSelect } | null = null;
  if (input.contractId) ctr = (await db.select({ c: s.contracts, v: s.contractVersions }).from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(eq(s.contracts.id, input.contractId)).limit(1))[0] ?? null;
  const [acc] = await db.select().from(s.csAccounts).where(and(eq(s.csAccounts.tenantId, tenantId), eq(s.csAccounts.contactId, input.contactId))).limit(1);
  const [opp] = input.opportunityId ? await db.select({ ownerId: s.opportunities.ownerId }).from(s.opportunities).where(eq(s.opportunities.id, input.opportunityId)).limit(1) : [];
  const [sectorCsm] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), sql`'sucesso_cliente' = any(${s.users.sectors})`)).limit(1);
  const csmId = input.csmId ?? ctr?.c.csmId ?? acc?.csmId ?? sectorCsm?.id ?? opp?.ownerId ?? actorId;
  const isNew = !(await db.select({ n: sql<number>`count(*)::int` }).from(s.contracts).where(and(eq(s.contracts.tenantId, tenantId), eq(s.contracts.contactId, input.contactId), input.contractId ? sql`${s.contracts.id} <> ${input.contractId}` : sql`true`, sql`${s.contracts.validatedAt} is not null`)))[0]?.n;
  const acvCents = ctr ? contractAcv({ monthlyCents: ctr.v.monthlyCents, totalCents: ctr.v.totalCents, startAt: ctr.v.startAt, endAt: ctr.v.endAt }) : 0;
  const tpl = pickTemplate(cfg, { kind: ctr?.c.kind ?? null, billingType: ctr?.c.billingType ?? null, acvCents });
  const [j] = await db.insert(s.csJourneys).values({ tenantId, contactId: input.contactId, contractId: input.contractId, opportunityId: input.opportunityId, triggerKey, templateKey: tpl.key, templateName: tpl.name, csmId, isNewCustomer: isNew, startedAt: today, ruleVersion: version, createdBy: actorId })
    .onConflictDoNothing({ target: [s.csJourneys.tenantId, s.csJourneys.triggerKey] }).returning();
  if (!j) { const [again] = await db.select({ id: s.csJourneys.id }).from(s.csJourneys).where(and(eq(s.csJourneys.tenantId, tenantId), eq(s.csJourneys.triggerKey, triggerKey))).limit(1); return { id: again!.id, created: false }; }
  const ownerOf = (o: string) => (o === 'comercial' ? ctr?.c.commercialOwnerId ?? opp?.ownerId ?? csmId : o === 'implantacao' ? ctr?.c.operationalOwnerId ?? csmId : csmId);
  const endAt = ctr?.v.endAt ?? null;
  let pos = 0;
  for (const m of tpl.milestones) {
    const plannedAt = m.anchor === 'inicio' ? addDays(today, m.offsetDays) : endAt ? addDays(endAt, m.offsetDays) : null;
    await db.insert(s.csMilestones).values({ tenantId, journeyId: j.id, phase: m.phase, key: m.key, title: m.title, plannedAt, ownerId: ownerOf(m.owner), position: pos++ });
  }
  await openMilestoneTasks(db, tenantId, j.id);
  await db.insert(s.csAccounts).values({ tenantId, contactId: input.contactId, csmId }).onConflictDoUpdate({ target: [s.csAccounts.tenantId, s.csAccounts.contactId], set: { csmId: sql`coalesce(${s.csAccounts.csmId}, excluded.csm_id)`, updatedAt: new Date() } });
  await regenerateKickoff(db, tenantId, j.id, actorId, 'Gerada automaticamente no início da jornada');
  const [contact] = await db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, input.contactId)).limit(1);
  if (input.opportunityId) await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: input.opportunityId, type: 'cs_jornada_iniciada', actorId, payload: { journeyId: j.id, template: tpl.name } });
  if (input.contractId) await db.insert(s.contractEvents).values({ tenantId, contractId: input.contractId, type: 'cs_jornada', summary: `Jornada de Sucesso do Cliente iniciada (${tpl.name}).`, actorId, payload: { journeyId: j.id } });
  if (cfg.trigger.notifyEmails) {
    const people = await db.select({ email: s.users.email }).from(s.users).where(inArray(s.users.id, [...new Set([csmId, ctr?.c.commercialOwnerId, ctr?.c.operationalOwnerId].filter(Boolean) as string[])]));
    for (const p of people) await sendEmail(db, { tenantId, kind: 'cs_jornada', to: p.email, subject: `Jornada iniciada: ${contact?.name ?? 'cliente'}`, text: `A jornada de Sucesso do Cliente de ${contact?.name ?? 'cliente'} começou (${tpl.name}). A apresentação de kickoff está pronta para revisão.\nVer: ${publicLink(config, `/sucesso/jornadas/${j.id}`)}` }).catch(() => null);
  }
  return { id: j.id, created: true };
}

/** Cria tarefas dos marcos que vencem nos próximos 30 dias (os demais entram com o tempo, pela rotina diária). */
export async function openMilestoneTasks(db: DbOrTx, tenantId: string, journeyId?: string) {
  const limit = addDays(todayIso(), 30);
  const rows = await db.select({ m: s.csMilestones, j: s.csJourneys, client: s.contacts.name }).from(s.csMilestones).innerJoin(s.csJourneys, eq(s.csJourneys.id, s.csMilestones.journeyId)).innerJoin(s.contacts, eq(s.contacts.id, s.csJourneys.contactId))
    .where(and(eq(s.csMilestones.tenantId, tenantId), journeyId ? eq(s.csMilestones.journeyId, journeyId) : eq(s.csJourneys.status, 'ativa'), isNull(s.csMilestones.activityId), isNull(s.csMilestones.doneAt), sql`${s.csMilestones.plannedAt} <= ${limit}`));
  const tpl = new Map<string, boolean>();
  const { config: cfg } = await csConfigOf(db, tenantId);
  for (const t of cfg.journeyTemplates) for (const m of t.milestones) tpl.set(`${t.key}:${m.key}`, m.task);
  let n = 0;
  for (const { m, j, client } of rows) {
    if (tpl.get(`${j.templateKey}:${m.key}`) === false || !m.ownerId) continue;
    const kind: CsActivityKind = ['kickoff', 'qbr1'].includes(m.key) ? 'reuniao' : m.key.startsWith('d') && /^d\d+$/.test(m.key) ? 'contato' : m.key.includes('pesquisa') || m.key.includes('satisf') ? 'pesquisa' : m.phase === 'renovacao' ? 'contratual' : 'revisao';
    const [a] = await db.insert(s.activities).values({ tenantId, type: kind === 'reuniao' ? 'reuniao' : 'tarefa', title: `${m.title} · ${client}`.slice(0, 200), notes: `Marco da jornada (${j.templateName}).`, dueAt: new Date(`${m.plannedAt}T12:00:00Z`), priority: 'media', ownerId: m.ownerId, contactId: j.contactId, contractId: j.contractId, opportunityId: j.opportunityId, csKind: kind, createdBy: null }).returning({ id: s.activities.id });
    await db.insert(s.activityEvents).values({ tenantId, activityId: a!.id, type: 'created', actorId: null, payload: { csMilestone: m.id } });
    await db.update(s.csMilestones).set({ activityId: a!.id }).where(eq(s.csMilestones.id, m.id));
    n++;
  }
  return n;
}

export function newShareToken() { const t = randomBytes(24).toString('base64url'); return { token: t, hash: createHash('sha256').update(t).digest('hex') }; }
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

// ------------------------------------------------------------------ cadência
const KIND_TYPE: Record<string, 'ligacao' | 'visita' | 'reuniao'> = { contato: 'ligacao', visita: 'visita', revisao: 'reuniao' };
/**
 * Gera os acompanhamentos previstos no horizonte pela política vigente de cada conta.
 * Idempotente (chave por conta, tipo e data). Ao recalcular, só remove previstos futuros ainda abertos; concluídos e atrasados ficam.
 */
export async function generateCadence(db: DbOrTx, tenantId: string, only?: string[]) {
  const { config: cfg } = await csConfigOf(db, tenantId);
  const today = todayIso();
  const accs = await db.select({ a: s.csAccounts, name: s.contacts.name }).from(s.csAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.csAccounts.contactId)).where(and(eq(s.csAccounts.tenantId, tenantId), isNotNull(s.csAccounts.csmId), only?.length ? inArray(s.csAccounts.contactId, only) : sql`true`));
  let created = 0, removed = 0;
  for (const { a, name } of accs) {
    const sn = a.snapshot as Snapshot | null;
    if (!sn?.policy) continue;
    const weight = cfg.coverageWeights[sn.effective.level];
    const wanted = new Set<string>();
    for (const [kind, every] of [['contato', sn.policy.contactDays], ['visita', sn.policy.visitDays], ['revisao', sn.policy.reviewDays]] as const) {
      const [last] = await db.select({ d: sql<string>`max(completed_at)::date::text` }).from(s.activities).where(and(eq(s.activities.tenantId, tenantId), eq(s.activities.contactId, a.contactId), eq(s.activities.csKind, kind), isNotNull(s.activities.csResult), isNull(s.activities.deletedAt)));
      const [pendingPast] = await db.select({ n: sql<number>`count(*)::int` }).from(s.activities).where(and(eq(s.activities.tenantId, tenantId), eq(s.activities.contactId, a.contactId), eq(s.activities.csKind, kind), isNotNull(s.activities.csCadenceKey), isNull(s.activities.completedAt), isNull(s.activities.deletedAt), sql`${s.activities.csPlannedAt} < ${today}`));
      // com previsto atrasado em aberto, não empilha outro: o atrasado é o próximo a fazer
      const dates = cadenceDates(last?.d ?? null, every, today, cfg.cadenceHorizonDays).filter((_, i) => !(pendingPast?.n && i === 0));
      for (const d of dates) {
        const key = `${kind}:${d}`;
        wanted.add(key);
        const r = await db.insert(s.activities).values({ tenantId, type: KIND_TYPE[kind]!, title: `${CS_ACTIVITY_LABELS[kind]} · ${name}`.slice(0, 200), notes: `Cadência: ${sn.policy.name}.`, dueAt: new Date(`${d}T12:00:00Z`), priority: sn.effective.level === 'critica' || sn.effective.level === 'alta' ? 'alta' : 'media', ownerId: a.csmId!, contactId: a.contactId, csKind: kind, csPlannedAt: d, csCadenceKey: key, csWeight: weight, createdBy: null })
          .onConflictDoNothing().returning({ id: s.activities.id });
        if (r.length) { created++; await db.insert(s.activityEvents).values({ tenantId, activityId: r[0]!.id, type: 'created', actorId: null, payload: { cadencia: sn.policy.key } }); }
      }
    }
    const stale = await db.select({ id: s.activities.id, key: s.activities.csCadenceKey }).from(s.activities).where(and(eq(s.activities.tenantId, tenantId), eq(s.activities.contactId, a.contactId), isNotNull(s.activities.csCadenceKey), isNull(s.activities.completedAt), isNull(s.activities.deletedAt), sql`${s.activities.csPlannedAt} > ${today}`));
    const drop = stale.filter((x) => !wanted.has(x.key!)).map((x) => x.id);
    if (drop.length) { await db.update(s.activities).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(s.activities.id, drop)); removed += drop.length; }
  }
  return { created, removed };
}

// ------------------------------------------------------------------ alertas preventivos
type AlertOut = { key: string; category: 'relacionamento' | 'contrato' | 'financeiro' | 'comercial' | 'saude' | 'dados'; level: 'media' | 'alta'; text: string };
export async function alertsFor(db: DbOrTx, tenantId: string, cfg: CsConfig, contactId: string, sn: Snapshot): Promise<AlertOut[]> {
  const out: AlertOut[] = [];
  const A = cfg.alerts;
  const today = todayIso();
  const add = (a: AlertOut) => { if (!cfg.alerts.disabled.includes(a.key.split(':')[0]!)) out.push(a); };
  const since = sn.lastContactAt ? daysBetween(sn.lastContactAt, today) : null;
  if (since !== null ? since > A.noContactDays : sn.contracts.length > 0) add({ key: 'sem_contato', category: 'relacionamento', level: levelRank(sn.effective.level) >= 2 ? 'alta' : 'media', text: since === null ? 'Conta sem nenhum contato registrado.' : `Sem contato há ${since} dias.` });
  const [visit] = await db.select({ n: sql<number>`count(*)::int` }).from(s.activities).where(and(eq(s.activities.tenantId, tenantId), eq(s.activities.contactId, contactId), eq(s.activities.csKind, 'visita'), isNull(s.activities.completedAt), isNull(s.activities.deletedAt), sql`${s.activities.csPlannedAt} < ${today}`));
  if (visit?.n) add({ key: 'visita_atrasada', category: 'relacionamento', level: 'alta', text: `${visit.n} visita(s) prevista(s) em atraso.` });
  const [surveyLate] = await db.select({ n: sql<number>`count(*)::int` }).from(s.csMilestones).innerJoin(s.csJourneys, eq(s.csJourneys.id, s.csMilestones.journeyId)).where(and(eq(s.csJourneys.contactId, contactId), eq(s.csJourneys.status, 'ativa'), isNull(s.csMilestones.doneAt), sql`${s.csMilestones.key} in ('pesquisa','satisfacao_ren')`, sql`${s.csMilestones.plannedAt} < ${today}`));
  if (surveyLate?.n) add({ key: 'pesquisa_pendente', category: 'relacionamento', level: 'media', text: 'Pesquisa de satisfação prevista na jornada e não registrada.' });
  if (sn.satisfaction.last !== null && sn.satisfaction.previous !== null && sn.satisfaction.previous - sn.satisfaction.last >= A.satisfactionDrop * 10) add({ key: 'queda_satisfacao', category: 'relacionamento', level: 'alta', text: `Satisfação caiu de ${sn.satisfaction.previous} para ${sn.satisfaction.last} (escala 0–100).` });
  if (sn.classKey && cfg.critStrategicClasses.includes(sn.classKey) && sn.overdueFollowUpDays > 0) add({ key: 'estrategica_sem_acompanhamento', category: 'relacionamento', level: 'alta', text: `Conta estratégica (${sn.classKey}) com acompanhamento atrasado há ${sn.overdueFollowUpDays} dia(s).` });
  if (sn.daysToEnd !== null && sn.daysToEnd <= A.renewalDays) {
    add({ key: 'vencimento', category: 'contrato', level: sn.daysToEnd <= 60 ? 'alta' : 'media', text: sn.daysToEnd < 0 ? 'Contrato com vigência encerrada.' : `Contrato vence em ${sn.daysToEnd} dias.` });
    const [plan] = await db.select({ n: sql<number>`count(*)::int` }).from(s.csMilestones).innerJoin(s.csJourneys, eq(s.csJourneys.id, s.csMilestones.journeyId)).where(and(eq(s.csJourneys.contactId, contactId), eq(s.csMilestones.key, 'plano_ren'), isNotNull(s.csMilestones.doneAt)));
    const [proc] = await db.select({ n: sql<number>`count(*)::int` }).from(s.contractProcesses).innerJoin(s.contracts, eq(s.contracts.id, s.contractProcesses.contractId)).where(and(eq(s.contracts.contactId, contactId), eq(s.contractProcesses.kind, 'renovacao')));
    if (!plan?.n && !proc?.n) add({ key: 'renovacao_sem_plano', category: 'contrato', level: 'alta', text: 'Renovação sem planejamento registrado.' });
  }
  for (const c of sn.contracts) {
    const k = c.consumption;
    if (!k || k.share === null) continue;
    if (k.share * 100 >= A.consumptionHighPct) add({ key: `consumo_limite:${c.id}`, category: 'contrato', level: 'alta', text: `Contrato ${c.number}: ${Math.round(k.share * 100)}% do saldo consumido.` });
    else if (k.exhaustAt && c.endAt && k.exhaustAt < c.endAt) add({ key: `esgotamento:${c.id}`, category: 'contrato', level: 'media', text: `Contrato ${c.number}: no ritmo atual, o saldo acaba em ${fmtD(k.exhaustAt)}, antes do fim da vigência.` });
    if (k.elapsedShare !== null && k.elapsedShare > 0.5 && k.share * 100 <= A.consumptionLowPct) add({ key: `baixo_consumo:${c.id}`, category: 'contrato', level: 'media', text: `Contrato ${c.number}: só ${Math.round(k.share * 100)}% consumido com ${Math.round(k.elapsedShare * 100)}% da vigência.` });
    if (c.billingType === 'medicao' && (!k.lastConsumptionAt || daysBetween(k.lastConsumptionAt, today) > 45)) add({ key: `medicao_pendente:${c.id}`, category: 'contrato', level: 'media', text: `Contrato ${c.number}: sem medição lançada há mais de 45 dias.` });
  }
  if (sn.ipc.levels.potencial === 'alto' && !sn.expansion.openCount) add({ key: 'expansao_sem_acao', category: 'comercial', level: 'media', text: 'Potencial de expansão alto sem negociação aberta.' });
  const [stuck] = await db.select({ n: sql<number>`count(*)::int` }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, tenantId), eq(s.opportunities.contactId, contactId), isNull(s.opportunities.deletedAt), sql`${s.opportunities.stage} not in ('ganha','perdida')`, sql`(${s.opportunities.nextActionAt} is null or ${s.opportunities.nextActionAt} < now() - interval '7 days')`));
  if (stuck?.n) add({ key: 'negociacao_sem_acompanhamento', category: 'comercial', level: 'media', text: `${stuck.n} negociação(ões) aberta(s) sem próxima ação em dia.` });
  const [up] = await db.select({ n: sql<number>`count(*)::int` }).from(s.csVisits).where(and(eq(s.csVisits.contactId, contactId), eq(s.csVisits.status, 'realizada'), sql`coalesce(${s.csVisits.opportunities}, '') <> ''`, sql`${s.csVisits.doneAt} > now() - interval '30 days'`));
  if (up?.n && !sn.expansion.openCount) add({ key: 'upgrade_identificado', category: 'comercial', level: 'media', text: 'Oportunidade identificada em visita, ainda sem negociação aberta.' });
  const ipcHist = await db.select({ score: s.csAssessments.score }).from(s.csAssessments).where(and(eq(s.csAssessments.contactId, contactId), eq(s.csAssessments.kind, 'ipc'))).orderBy(desc(s.csAssessments.createdAt)).limit(2);
  if (ipcHist.length === 2 && ipcHist[0]!.score !== null && ipcHist[1]!.score !== null && Math.abs(ipcHist[0]!.score - ipcHist[1]!.score) >= 15) add({ key: 'mudanca_ipc', category: 'comercial', level: 'media', text: `Score IPC mudou de ${ipcHist[1]!.score} para ${ipcHist[0]!.score}.` });
  const hist = await db.select({ kind: s.csAssessments.kind, level: s.csAssessments.level, score: s.csAssessments.score }).from(s.csAssessments).where(and(eq(s.csAssessments.contactId, contactId), inArray(s.csAssessments.kind, ['criticidade', 'saude']))).orderBy(desc(s.csAssessments.createdAt)).limit(10);
  const crit = hist.filter((h) => h.kind === 'criticidade');
  if (crit.length >= 2 && levelRank(crit[0]!.level as CsLevel) > levelRank(crit[1]!.level as CsLevel)) add({ key: 'aumento_criticidade', category: 'saude', level: 'alta', text: `Criticidade subiu de ${crit[1]!.level} para ${crit[0]!.level}.` });
  const hs = hist.filter((h) => h.kind === 'saude' && h.score !== null);
  if (hs.length >= 2 && hs[1]!.score! - hs[0]!.score! >= 15) add({ key: 'queda_saude', category: 'saude', level: 'alta', text: `Saúde caiu de ${hs[1]!.score} para ${hs[0]!.score}.` });
  if (sn.highOccurrences) add({ key: 'ocorrencia_relevante', category: 'saude', level: 'alta', text: `${sn.highOccurrences} ocorrência(s) de gravidade alta em aberto.` });
  if (sn.churnRisk === 'alto') add({ key: 'risco_cancelamento', category: 'saude', level: 'alta', text: 'Risco de cancelamento alto.' });
  if (sn.ipc.reviewDue) add({ key: 'ipc_revisao', category: 'dados', level: 'media', text: sn.ipc.assessedAt ? `Score IPC avaliado em ${fmtD(sn.ipc.assessedAt)}: revisão vencida.` : 'Score IPC ainda não avaliado.' });
  if (sn.satisfaction.lastAt && daysBetween(sn.satisfaction.lastAt, today) > A.staleDataDays * 6) add({ key: 'satisfacao_desatualizada', category: 'dados', level: 'media', text: `Última pesquisa de satisfação em ${fmtD(sn.satisfaction.lastAt)}.` });
  return out;
}

/** Atualiza os alertas da conta: novos entram, os que deixaram de valer são resolvidos. Devolve os novos. */
export async function syncAlerts(db: DbOrTx, tenantId: string, contactId: string, list: AlertOut[]) {
  const cur = await db.select().from(s.csAlerts).where(and(eq(s.csAlerts.tenantId, tenantId), eq(s.csAlerts.contactId, contactId)));
  const fresh: AlertOut[] = [];
  for (const a of list) {
    const ex = cur.find((c) => c.key === a.key);
    if (!ex) { await db.insert(s.csAlerts).values({ tenantId, contactId, ...a }); fresh.push(a); }
    else await db.update(s.csAlerts).set({ text: a.text, level: a.level, category: a.category, lastSeenAt: new Date(), ...(ex.resolvedAt ? { resolvedAt: null, firstSeenAt: new Date(), notifiedAt: null, escalatedAt: null } : {}) }).where(eq(s.csAlerts.id, ex.id)).then(() => { if (ex.resolvedAt) fresh.push(a); });
  }
  const keys = new Set(list.map((a) => a.key));
  const gone = cur.filter((c) => !c.resolvedAt && !keys.has(c.key)).map((c) => c.id);
  if (gone.length) await db.update(s.csAlerts).set({ resolvedAt: new Date() }).where(inArray(s.csAlerts.id, gone));
  return fresh;
}

/** Rotina diária do Sucesso do Cliente: recalcula contas, abre tarefas de marcos, gera cadência, alertas e escalonamento. */
export async function runCsDaily(db: DbOrTx, config: Config, tenantId: string) {
  const { config: cfg } = await csConfigOf(db, tenantId);
  const accounts = await recomputeAccounts(db, tenantId);
  const tasks = await openMilestoneTasks(db, tenantId);
  const cadence = await generateCadence(db, tenantId);
  const accs = await db.select({ contactId: s.csAccounts.contactId, snapshot: s.csAccounts.snapshot, csmId: s.csAccounts.csmId, name: s.contacts.name }).from(s.csAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.csAccounts.contactId)).where(eq(s.csAccounts.tenantId, tenantId));
  let alerts = 0, notified = 0, escalated = 0;
  for (const a of accs) {
    const sn = a.snapshot as Snapshot | null;
    if (!sn) continue;
    const list = await alertsFor(db, tenantId, cfg, a.contactId, sn);
    alerts += list.length;
    const fresh = (await syncAlerts(db, tenantId, a.contactId, list)).filter((x) => x.level === 'alta');
    if (fresh.length && a.csmId) {
      const [u] = await db.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, a.csmId)).limit(1);
      if (u) { await sendEmail(db, { tenantId, kind: 'cs_alerta', to: u.email, subject: `Atenção: ${a.name}`, text: `${fresh.map((f) => `- ${f.text}`).join('\n')}\nVer: ${publicLink(config, `/customers/${a.contactId}?t=sucesso`)}` }).catch(() => null); notified++; }
    }
  }
  // escalonamento: alerta alto aberto há mais de N dias vai para os e-mails configurados
  const esc = cfg.alerts.escalateEmails;
  if (esc.length) {
    const old = await db.select({ a: s.csAlerts, name: s.contacts.name }).from(s.csAlerts).innerJoin(s.contacts, eq(s.contacts.id, s.csAlerts.contactId)).where(and(eq(s.csAlerts.tenantId, tenantId), isNull(s.csAlerts.resolvedAt), isNull(s.csAlerts.escalatedAt), eq(s.csAlerts.level, 'alta'), sql`${s.csAlerts.firstSeenAt} < now() - make_interval(days => ${cfg.alerts.escalateAfterDays})`));
    if (old.length) {
      for (const to of esc) await sendEmail(db, { tenantId, kind: 'cs_escalonamento', to, subject: `Sucesso do Cliente: ${old.length} alerta(s) sem solução`, text: old.map((o) => `- ${o.name}: ${o.a.text}`).join('\n') }).catch(() => null);
      await db.update(s.csAlerts).set({ escalatedAt: new Date() }).where(inArray(s.csAlerts.id, old.map((o) => o.a.id)));
      escalated = old.length;
    }
  }
  // revisão do IPC vencida vira tarefa (uma aberta por conta)
  for (const a of accs) {
    const sn = a.snapshot as Snapshot | null;
    if (!sn?.ipc.reviewDue || !a.csmId) continue;
    const key = `ipc:${todayIso().slice(0, 7)}`;
    await db.insert(s.activities).values({ tenantId, type: 'tarefa', title: `Revisar Score IPC · ${a.name}`.slice(0, 200), notes: 'Revisão trimestral (ou pendente) do Score IPC.', dueAt: new Date(`${addDays(todayIso(), 7)}T12:00:00Z`), priority: 'media', ownerId: a.csmId, contactId: a.contactId, csKind: 'revisao', csCadenceKey: key, createdBy: null }).onConflictDoNothing();
  }
  return { accounts, milestoneTasks: tasks, cadence, alerts, notified, escalated };
}

export const IPC_KEYS = IPC_CRITERIA;
