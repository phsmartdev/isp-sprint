/**
 * Gestão de Contratos → Controle de Empenhos: itens do contrato, notas de empenho com itens, medições (com revisão por
 * versão), pendências, alertas, importação da planilha e o consumo pelas oportunidades da pipeline (como na ata).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { COMMITMENT_MOVE_KINDS, COMMITMENT_MOVE_LABELS, LINE_CLASSES, MEASUREMENT_KINDS, MEASUREMENT_STATUS_LABELS, PPM, REVISION_REASONS, REVISION_REASON_LABELS, adjustmentTable, cents, factorToPct, fromQ4, parseAdjustmentIndex, q4, retroactiveFor, value4, type CommitmentMoveKind, type MeasurementStatus } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { addEvent, contractScope, loadContract } from '../services/contracts';
import { loadOpportunity } from '../services/opportunities';
import { allocateItems, availableFor, canManageCommitments, controlCurve, controlData, controlDataMany, controlState, linePriceAt, settingsOf, sharesAt, todayIso, type ControlData } from '../services/commitmentControl';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM');
const qty = z.number().min(0).max(1_000_000_000);
const MParams = z.object({ id: z.string().uuid(), mid: z.string().uuid() });
const brl4 = (v4: number) => (v4 / 10_000).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nQty = (q: number) => fromQ4(q).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

async function manageable(db: DbOrTx, auth: AuthContext, id: string) {
  const c = await loadContract(db, auth, id);
  if (!canManageCommitments(auth, c)) throw forbidden('Empenhos e medições são do Financeiro, da gestão de contratos ou dos responsáveis do contrato.');
  return c;
}
async function versionOf(db: DbOrTx, c: { id: string; currentVersion: number }) {
  const [v] = await db.select({ number: s.contractVersions.number, object: s.contractVersions.object, startAt: s.contractVersions.startAt, endAt: s.contractVersions.endAt, totalCents: s.contractVersions.totalCents }).from(s.contractVersions).where(and(eq(s.contractVersions.contractId, c.id), eq(s.contractVersions.version, c.currentVersion))).limit(1);
  return v ?? null;
}

/** RN04: nenhuma medição excede o saldo do item contratual. */
function checkContractBalance(d: ControlData, items: { lineId: string; qty4: number }[], except?: { exceptMeasurement?: string; exceptOpportunity?: string }) {
  for (const x of items) {
    const l = d.lines.find((y) => y.id === x.lineId);
    if (!l) throw unprocessable('Item que não é deste contrato.');
    const free = availableFor(d, x.lineId, except);
    if (x.qty4 > free) throw unprocessable(`Item ${l.itemNumber} (${l.description.slice(0, 60)}): ${nQty(x.qty4)} ${l.unit} passa do saldo do contrato (${nQty(Math.max(0, free))}). Execução acima do contratado não é permitida; registre um aditivo.`, [{ path: `items.${x.lineId}`, message: 'Saldo do contrato' }]);
  }
}

type Rule = { commitmentBlock: boolean; commitmentAllocation: string };
const allocationOf = (c: Pick<Rule, 'commitmentAllocation'>) => (c.commitmentAllocation === 'rateio' ? 'rateio' : 'fifo') as 'fifo' | 'rateio';

/** Grava os itens da medição com o preço vigente na competência (RN08) e a baixa pela ordem do contrato (RN09). */
async function saveMeasurementItems(db: DbOrTx, tenantId: string, measurementId: string, d: ControlData, competence: string, items: { lineId: string; qty4: number }[], rule: Rule, except?: string) {
  const alloc = allocateItems(d, competence, items, except, allocationOf(rule));
  const uncovered = alloc.filter((a) => a.uncovered4 > 0);
  if (rule.commitmentBlock && uncovered.length) throw unprocessable(`Este contrato bloqueia medição sem empenho: ${uncovered.map((u) => `item ${d.lines.find((l) => l.id === u.lineId)?.itemNumber} (${nQty(u.uncovered4)} sem cobertura)`).join(', ')}.`);
  await db.delete(s.contractMeasurementItems).where(eq(s.contractMeasurementItems.measurementId, measurementId));
  if (alloc.length) await db.insert(s.contractMeasurementItems).values(alloc.map((a) => ({ tenantId, measurementId, lineId: a.lineId, qty4: a.qty4, price4: linePriceAt(d, a.lineId, competence), allocations: a.allocations, uncovered4: a.uncovered4 })));
  return alloc.map((a) => ({ ...a, price4: linePriceAt(d, a.lineId, competence) }));
}

function serialize(d: ControlData, st: ReturnType<typeof controlState>) {
  const lineById = new Map(d.lines.map((l) => [l.id, l]));
  const sourceName = new Map(d.raw.sources.map((x) => [x.id, x.name]));
  const reservationsByLine = new Map<string, { opportunityId: string; code: number; title: string; stage: string; qty4: number }[]>();
  for (const r of d.raw.reservations) reservationsByLine.set(r.r.lineId, [...(reservationsByLine.get(r.r.lineId) ?? []), { opportunityId: r.r.opportunityId, code: r.code, title: r.title, stage: r.stage, qty4: r.r.qty4 }]);
  const measurements = d.raw.measurements.map((m) => {
    const its = d.raw.mItems.filter((x) => x.measurementId === m.id);
    const v4 = its.reduce((a, x) => a + value4(x.qty4, x.price4), 0);
    return { ...m, statusLabel: MEASUREMENT_STATUS_LABELS[m.status as MeasurementStatus], revisionReasonLabel: m.revisionReason ? REVISION_REASON_LABELS[m.revisionReason as keyof typeof REVISION_REASON_LABELS] : null, valueV4: v4, uncoveredV4: its.reduce((a, x) => a + value4(x.uncovered4, x.price4), 0), items: its.map((x) => ({ ...x, valueV4: value4(x.qty4, x.price4) })) };
  });
  const commitments = d.raw.commitments.map((c) => {
    const its = d.raw.cItems.filter((i) => i.commitmentId === c.id).map((i) => {
      const adj = d.items.find((x) => x.id === i.id)!.adjust4;
      const l = lineById.get(i.lineId);
      const balance4 = st.ciBal.get(i.id) ?? 0;
      return { ...i, adjust4: adj, balance4, valueV4: value4(i.qty4 + adj, l?.price4 ?? 0), balanceV4: value4(balance4, l?.price4 ?? 0), moves: d.raw.moves.filter((m) => m.commitmentItemId === i.id).map((m) => ({ ...m, kindLabel: COMMITMENT_MOVE_LABELS[m.kind as CommitmentMoveKind] ?? m.kind })) };
    });
    // virada (RN10): NE nova que recebeu o saldo suprimido desta e NEs antigas que esta substitui
    const linked = [...new Set(d.raw.moves.filter((m) => m.kind === 'supressao' && m.linkedCommitmentId && its.some((i) => i.id === m.commitmentItemId)).map((m) => m.linkedCommitmentId!))];
    const replaces = [...new Set(d.raw.moves.filter((m) => m.kind === 'supressao' && m.linkedCommitmentId === c.id).map((m) => d.raw.cItems.find((i) => i.id === m.commitmentItemId)?.commitmentId).filter((x): x is string => !!x))];
    const num = (id: string) => d.raw.commitments.find((x) => x.id === id)?.number ?? '';
    return { ...c, sourceName: c.sourceId ? sourceName.get(c.sourceId) ?? null : c.source, items: its, valueV4: its.reduce((a, i) => a + i.valueV4, 0), balanceV4: c.cancelledAt ? 0 : its.reduce((a, i) => a + i.balanceV4, 0), suppressedV4: its.reduce((a, i) => a + value4(i.moves.filter((m) => m.kind === 'supressao').reduce((t, m) => t + m.qty4, 0), lineById.get(i.lineId)?.price4 ?? 0), 0), reempenhadaEm: linked.map((id) => ({ id, number: num(id) })), substitui: replaces.map((id) => ({ id, number: num(id) })) };
  });
  // pendências estruturadas (PF05): sem empenho, executado sem nota fiscal
  const pendencias = [
    ...measurements.filter((m) => m.status !== 'cancelada' && !m.superseded && m.uncoveredV4 > 0).map((m) => ({ kind: 'aguardando_empenho', label: 'Aguardando empenho', measurementId: m.id, title: m.title, competence: m.competence, valueV4: m.uncoveredV4, since: m.createdAt })),
    ...measurements.filter((m) => m.status === 'atestada' && !m.superseded).map((m) => ({ kind: 'sem_nf', label: 'Executado sem nota fiscal', measurementId: m.id, title: m.title, competence: m.competence, valueV4: m.valueV4, since: m.attestedAt ?? m.createdAt })),
    // PF05.3: retroativo de reajuste a cobrar, por medição
    ...d.raw.retros.filter((x) => x.status === 'pendente').flatMap((x) => {
      const m = measurements.find((y) => y.id === x.measurementId);
      const a = d.raw.adjustments.find((y) => y.id === x.adjustmentId);
      return m && !m.superseded && m.status !== 'cancelada' ? [{ kind: 'retroativo', label: 'Retroativo de reajuste', measurementId: m.id, title: `${m.title} · ${a?.indexName ?? 'reajuste'}`, competence: m.competence, valueV4: x.diffV4, since: a?.createdAt ?? x.createdAt, retroId: x.id }] : [];
    }),
  ];
  return {
    lines: d.raw.lines.map((l) => ({ ...l, originalQty4: l.qty4, qty4: lineById.get(l.id)!.qty4, originalPrice4: l.price4, price4: lineById.get(l.id)!.price4, valueV4: value4(lineById.get(l.id)!.qty4, lineById.get(l.id)!.price4),
      moves: d.raw.lineMoves.filter((m) => m.lineId === l.id), priceHistory: d.raw.priceRows.filter((p) => p.lineId === l.id).sort((a, b) => a.fromCompetence.localeCompare(b.fromCompetence)), balance: st.bal.find((b) => b.lineId === l.id)!, reservations: reservationsByLine.get(l.id) ?? [], measured: d.raw.mItems.filter((x) => x.lineId === l.id && measurements.some((m) => m.id === x.measurementId && !m.superseded && m.status !== 'cancelada')).map((x) => ({ measurementId: x.measurementId, qty4: x.qty4 })) })),
    commitments, measurements, pendencias, totals: st.totals, alerts: st.alerts, projection: st.projection,
    sources: d.raw.sources.map((x) => ({ id: x.id, name: x.name })),
    shareVersions: d.raw.shareVersions,
    adjustments: d.raw.adjustments.map((a) => ({ ...a, pct: factorToPct(a.factor8), prices: d.raw.priceRows.filter((p) => p.adjustmentId === a.id), retros: d.raw.retros.filter((x) => x.adjustmentId === a.id) })),
  };
}

async function sourceOf(db: DbOrTx, contractId: string, id: string) {
  const [x] = await db.select().from(s.contractRevenueSources).where(and(eq(s.contractRevenueSources.id, id), eq(s.contractRevenueSources.contractId, contractId))).limit(1);
  if (!x) throw unprocessable('Fonte de receita que não é deste contrato.');
  return x;
}

const commitmentBody = z.object({
  number: z.string().trim().min(3).max(40), issuedOn: day, fiscalYear: z.number().int().min(2000).max(2100).optional(),
  source: z.string().trim().max(120).nullable().optional(), sourceId: z.string().uuid().nullable().optional(), replacesId: z.string().uuid().nullable().optional(), notes: z.string().trim().max(500).nullable().optional(),
  items: z.array(z.object({ lineId: z.string().uuid(), qty: z.number().positive().max(1_000_000_000), code: z.string().trim().max(40).nullable().optional(), itemNumber: z.string().trim().max(20).nullable().optional() })).min(1).max(500),
});

/** Nova NE com itens. RN10: o que não pode passar do contrato é a soma dos empenhos válidos (sem os suprimidos). */
async function createCommitment(tx: DbOrTx, auth: AuthContext, c: { id: string; commitmentAllocation: string }, body: z.infer<typeof commitmentBody>) {
  const [dup] = await tx.select({ id: s.contractCommitments.id }).from(s.contractCommitments).where(and(eq(s.contractCommitments.contractId, c.id), eq(s.contractCommitments.number, body.number))).limit(1);
  if (dup) throw unprocessable('Este empenho já está registrado no contrato.', [{ path: 'number', message: 'Duplicado' }]);
  const d = await controlData(tx, c.id);
  if (new Set(body.items.map((i) => i.lineId)).size !== body.items.length) throw unprocessable('O mesmo item aparece duas vezes na nota.');
  if (c.commitmentAllocation === 'rateio' && !body.sourceId) throw unprocessable('Este contrato faz rateio entre fontes: informe a fonte de receita da NE.', [{ path: 'sourceId', message: 'Obrigatório' }]);
  const src = body.sourceId ? await sourceOf(tx, c.id, body.sourceId) : null;
  const st = controlState(d, { startAt: null, endAt: null });
  for (const it of body.items) {
    const l = d.lines.find((x) => x.id === it.lineId);
    if (!l) throw unprocessable('Item que não é deste contrato.');
    const b = st.bal.find((x) => x.lineId === it.lineId)!;
    if (q4(it.qty) > b.toCommit4) throw unprocessable(`Item ${l.itemNumber}: empenhar ${nQty(q4(it.qty))} passa do que falta empenhar (${nQty(Math.max(0, b.toCommit4))}). Suprima o saldo da NE antiga (virada de exercício) antes de reempenhar.`);
  }
  const amount = body.items.reduce((a, it) => a + value4(q4(it.qty), d.lines.find((l) => l.id === it.lineId)!.price4), 0);
  const fy = body.fiscalYear ?? (Number(/^(\d{4})NE/i.exec(body.number)?.[1]) || Number(body.issuedOn.slice(0, 4)));
  const [e] = await tx.insert(s.contractCommitments).values({ tenantId: auth.tenantId, contractId: c.id, number: body.number, issuedOn: body.issuedOn, fiscalYear: fy, amountCents: Math.max(1, cents(amount)), source: src?.name ?? body.source ?? null, sourceId: src?.id ?? null, replacesId: body.replacesId ?? null, notes: body.notes ?? null, createdBy: auth.userId }).returning({ id: s.contractCommitments.id });
  await tx.insert(s.contractCommitmentItems).values(body.items.map((it) => ({ tenantId: auth.tenantId, commitmentId: e!.id, lineId: it.lineId, qty4: q4(it.qty), code: it.code ?? null, itemNumber: it.itemNumber ?? null })));
  await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `Empenho ${body.number} (${fy}) de ${brl4(amount)} cobrindo ${body.items.length} item(ns)${src ? ` · fonte ${src.name}` : ''}.`, { commitmentId: e!.id });
  return e!.id;
}

const adjustmentBody = z.object({ indexName: z.string().trim().min(2).max(60), mode: z.enum(['fator', 'percentual']), index: z.string().trim().min(1).max(20), baseDate: day, startCompetence: month });

/** Reajuste sobre a tabela vigente na competência de início; só depois do último reajuste (a ordem importa). */
async function planAdjustment(db: DbOrTx, contractId: string, body: z.infer<typeof adjustmentBody>) {
  const d = await controlData(db, contractId);
  if (!d.raw.lines.length) throw unprocessable('Cadastre os itens do contrato antes do reajuste.');
  const factor8 = parseAdjustmentIndex(body.index, body.mode);
  if (!factor8) throw unprocessable('Índice inválido: use até 4 casas decimais (ex.: fator 1,0432 ou 4,3215%).', [{ path: 'index', message: 'Índice' }]);
  const last = d.raw.adjustments.at(-1);
  if (last && body.startCompetence <= last.startCompetence) throw unprocessable(`Já existe reajuste a partir de ${last.startCompetence.slice(5)}/${last.startCompetence.slice(0, 4)}: o novo começa depois dele.`);
  const table = adjustmentTable(d.raw.lines, d.prices, factor8, body.startCompetence);
  const retro = retroactiveFor(d.measurements, d.mItems, table, body.startCompetence);
  return { d, factor8, table, retro };
}

export const commitmentControlRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/commitment-portfolio', summary: 'Carteira do Controle de Empenhos (PF09.5): contratos públicos ou por medição com os quatro saldos, pendências, alertas e projeção', tag: 'Contratos', module: 'contratos',
    handler: async ({ app, auth }) => {
      const rows = await app.db.select({ c: s.contracts, number: s.contractVersions.number, object: s.contractVersions.object, startAt: s.contractVersions.startAt, endAt: s.contractVersions.endAt, publicTerms: s.contractVersions.publicTerms, contact: s.contacts.name })
        .from(s.contracts)
        .innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion)))
        .innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId))
        .where(and(contractScope(auth), sql`(${s.contracts.kind} = 'publico' or ${s.contracts.billingType} = 'medicao')`, sql`${s.contracts.stage} <> 'arquivado'`));
      // tudo em poucas consultas (uma por tabela) e o cálculo em memória
      const all = await controlDataMany(app.db, rows.map((r) => r.c.id));
      const out = [];
      for (const r of rows) {
        const d = all.get(r.c.id)!;
        const base = { id: r.c.id, code: r.c.code, number: r.number, object: r.object, contact: r.contact, agency: (r.publicTerms as { agency?: string | null } | null)?.agency ?? null, stage: r.c.stage, startAt: r.startAt, endAt: r.endAt, lines: d.raw.lines.length };
        if (!d.raw.lines.length) { out.push({ ...base, totals: null, alerts: [], pendingV4: 0, exhaustBefore: 0, toInvoiceV4: 0, nextYearNeedV4: 0, commitments: 0 }); continue; }
        const st = controlState(d, { startAt: r.startAt, endAt: r.endAt }, settingsOf(r.c));
        const live = new Set(d.raw.measurements.filter((m) => !m.superseded && m.status !== 'cancelada').map((m) => m.id));
        const attested = new Set(d.raw.measurements.filter((m) => m.status === 'atestada').map((m) => m.id));
        const semNf = d.raw.mItems.filter((x) => live.has(x.measurementId) && attested.has(x.measurementId)).reduce((a, x) => a + value4(x.qty4, x.price4), 0);
        const year = Number(todayIso().slice(0, 4));
        out.push({
          ...base, totals: st.totals, alerts: st.alerts, commitments: d.raw.commitments.length,
          pendingV4: st.totals.uncovered + semNf + st.retroPendingV4,
          exhaustBefore: st.projection.exhaustBefore.length, toInvoiceV4: st.projection.toInvoiceV4,
          nextYearNeedV4: st.projection.years.find((y) => y.year === year + 1)?.needV4 ?? 0,
        });
      }
      return { items: out, today: todayIso() };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/:id/commitment-control', summary: 'Controle de Empenhos do contrato: itens com os saldos (contratado, empenhado, executado, faturado, a empenhar), NEs, medições, pendências e alertas', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const v = await versionOf(app.db, c);
      const d = await controlData(app.db, c.id);
      const settings = settingsOf(c);
      const st = controlState(d, { startAt: v?.startAt ?? null, endAt: v?.endAt ?? null }, settings);
      const sum = d.lines.reduce((a, l) => a + value4(l.qty4, l.price4), 0);
      const [confirmer] = c.commitmentAllocationBy ? await app.db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, c.commitmentAllocationBy)).limit(1) : [];
      const global = v?.totalCents ?? null;
      return {
        contract: { id: c.id, code: c.code, kind: c.kind, number: v?.number ?? null, object: v?.object ?? null, startAt: v?.startAt ?? null, endAt: v?.endAt ?? null, totalCents: global, commitmentBlock: c.commitmentBlock },
        settings: { ...settings, commitmentBlock: c.commitmentBlock, allocationConfirmedAt: c.commitmentAllocationAt, allocationConfirmedBy: confirmer?.name ?? null },
        ...serialize(d, st), curve: controlCurve(d, v?.startAt ?? null), canManage: canManageCommitments(auth, c), today: todayIso(),
        // RN02: soma dos itens × valor global (alerta, não bloqueio)
        globalCheck: global != null && d.lines.length ? { itemsCents: cents(sum), globalCents: global, diffCents: cents(sum) - global } : null,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/settings', summary: 'Regras do contrato: medição sem empenho (padrão: pendência), ordem de baixa (FIFO ou rateio pelas fontes, com confirmação) e parâmetros dos alertas', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({
      commitmentBlock: z.boolean().optional(),
      allocation: z.object({ mode: z.enum(['fifo', 'rateio']), confirm: z.literal(true) }).optional(),
      agingDays: z.number().int().min(1).max(365).optional(),
      toCommitPct: z.number().int().min(0).max(100).nullable().optional(),
      windowMonths: z.number().int().min(1).max(24).optional(),
    }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await manageable(app.db, auth, params.id);
      const set: Partial<typeof s.contracts.$inferInsert> = {};
      const notes: string[] = [];
      if (body.commitmentBlock !== undefined) { set.commitmentBlock = body.commitmentBlock; notes.push(body.commitmentBlock ? 'medição sem empenho bloqueada' : 'medição sem empenho permitida com pendência'); }
      if (body.allocation) {
        if (body.allocation.mode === 'rateio') {
          const d = await controlData(app.db, c.id);
          if (d.raw.sources.length < 2) throw unprocessable('O rateio proporcional precisa de pelo menos duas fontes de receita cadastradas.');
          if (!sharesAt(d, todayIso().slice(0, 7)).length) throw unprocessable('Registre a proporção entre as fontes antes de ativar o rateio.');
        }
        Object.assign(set, { commitmentAllocation: body.allocation.mode, commitmentAllocationBy: auth.userId, commitmentAllocationAt: new Date() });
        notes.push(body.allocation.mode === 'rateio' ? 'baixa por rateio proporcional entre as fontes (confirmado)' : 'baixa FIFO (empenho mais antigo primeiro)');
      }
      if (body.agingDays !== undefined) { set.commitmentAgingDays = body.agingDays; notes.push(`alerta de faturamento após ${body.agingDays} dias`); }
      if (body.toCommitPct !== undefined) { set.commitmentToCommitPct = body.toCommitPct; notes.push(body.toCommitPct == null ? 'sem limite de % a empenhar' : `alerta acima de ${body.toCommitPct}% a empenhar`); }
      if (body.windowMonths !== undefined) { set.commitmentWindowMonths = body.windowMonths; notes.push(`média de consumo dos últimos ${body.windowMonths} meses`); }
      if (!notes.length) return { ok: true };
      await app.db.update(s.contracts).set({ ...set, updatedAt: new Date() }).where(eq(s.contracts.id, c.id));
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'empenho', `Controle de empenhos: ${notes.join('; ')}.`);
      await audit(app.db, req, { action: 'contract.commitment_settings', entityType: 'contract', entityId: c.id, metadata: { before: settingsOf(c), after: body } });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ itens do contrato
  defineRoute({
    method: 'POST', url: '/contracts/:id/lines', summary: 'Inclui itens do contrato (item do órgão, item da ARP, especificação, unidade, quantidade, valor unitário, classificação)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ items: z.array(z.object({ itemNumber: z.string().trim().min(1).max(20), arpItemNumber: z.string().trim().max(20).nullable().optional(), description: z.string().trim().min(2).max(500), unit: z.string().trim().min(1).max(20), classification: z.enum(LINE_CLASSES).default('demanda'), qty, price: z.number().min(0).max(1_000_000_000), monthlyQty: qty.nullable().optional() })).min(1).max(500) }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const existing = await tx.select({ itemNumber: s.contractLines.itemNumber, arp: s.contractLines.arpItemNumber, position: s.contractLines.position }).from(s.contractLines).where(eq(s.contractLines.contractId, c.id));
      const key = (i: string, a: string | null | undefined) => `${i.toLowerCase()}|${(a ?? '').toLowerCase()}`;
      const seen = new Set(existing.map((e) => key(e.itemNumber, e.arp)));
      for (const it of body.items) { const k = key(it.itemNumber, it.arpItemNumber); if (seen.has(k)) throw unprocessable(`O item ${it.itemNumber} já existe neste contrato (RN01).`); seen.add(k); }
      let pos = Math.max(0, ...existing.map((e) => e.position));
      const rows = await tx.insert(s.contractLines).values(body.items.map((it) => ({ tenantId: auth.tenantId, contractId: c.id, position: ++pos, itemNumber: it.itemNumber, arpItemNumber: it.arpItemNumber ?? null, description: it.description, unit: it.unit, classification: it.classification, qty4: q4(it.qty), price4: q4(it.price), monthlyQty4: it.monthlyQty != null ? q4(it.monthlyQty) : null, createdBy: auth.userId }))).returning({ id: s.contractLines.id });
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `${rows.length} item(ns) incluído(s) no controle de empenhos.`);
      await audit(tx, req, { action: 'contract.lines', entityType: 'contract', entityId: c.id, metadata: { count: rows.length } });
      reply.code(201);
      return { ids: rows.map((r) => r.id) };
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/contracts/:id/lines/:lineId', summary: 'Corrige um item ainda sem medição; com medição, mudanças de quantidade/valor só por aditivo', tag: 'Contratos', module: 'contratos',
    params: z.object({ id: z.string().uuid(), lineId: z.string().uuid() }),
    body: z.object({ description: z.string().trim().min(2).max(500).optional(), unit: z.string().trim().min(1).max(20).optional(), classification: z.enum(LINE_CLASSES).optional(), qty: qty.optional(), price: z.number().min(0).max(1_000_000_000).optional(), monthlyQty: qty.nullable().optional(), arpItemNumber: z.string().trim().max(20).nullable().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await manageable(app.db, auth, params.id);
      const [l] = await app.db.select().from(s.contractLines).where(and(eq(s.contractLines.id, params.lineId), eq(s.contractLines.contractId, c.id))).limit(1);
      if (!l) throw notFound('Item não encontrado.');
      const [used] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.contractMeasurementItems).where(eq(s.contractMeasurementItems.lineId, l.id));
      if ((used?.n ?? 0) > 0 && (body.qty !== undefined || body.price !== undefined)) throw unprocessable('Item com medição: quantidade e valor mudam só por aditivo, apostilamento ou reajuste (o histórico é preservado).');
      await app.db.update(s.contractLines).set({ ...(body.description ? { description: body.description } : {}), ...(body.unit ? { unit: body.unit } : {}), ...(body.classification ? { classification: body.classification } : {}), ...(body.qty !== undefined ? { qty4: q4(body.qty) } : {}), ...(body.price !== undefined ? { price4: q4(body.price) } : {}), ...(body.monthlyQty !== undefined ? { monthlyQty4: body.monthlyQty == null ? null : q4(body.monthlyQty) } : {}), ...(body.arpItemNumber !== undefined ? { arpItemNumber: body.arpItemNumber } : {}), updatedAt: new Date() }).where(eq(s.contractLines.id, l.id));
      await audit(app.db, req, { action: 'contract.line_update', entityType: 'contract', entityId: c.id, metadata: { lineId: l.id, before: { qty4: l.qty4, price4: l.price4 }, after: body } });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ empenhos
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/commitments', summary: 'Registra a nota de empenho com os itens que ela cobre (código do item na NE e quantidade) e a fonte de receita; o valor sai dos itens', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: commitmentBody,
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const id = await createCommitment(tx, auth, c, body);
      await audit(tx, req, { action: 'contract.commitment', entityType: 'contract', entityId: c.id, metadata: { number: body.number, items: body.items.length } });
      reply.code(201);
      return { id };
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/contracts/:id/commitment-control/commitments/:cid', summary: 'Define a fonte de receita de uma NE (ex.: NEs importadas da planilha)', tag: 'Contratos', module: 'contratos',
    params: z.object({ id: z.string().uuid(), cid: z.string().uuid() }),
    body: z.object({ sourceId: z.string().uuid().nullable() }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await manageable(app.db, auth, params.id);
      const [ne] = await app.db.select().from(s.contractCommitments).where(and(eq(s.contractCommitments.id, params.cid), eq(s.contractCommitments.contractId, c.id))).limit(1);
      if (!ne) throw notFound('Empenho não encontrado.');
      const src = body.sourceId ? await sourceOf(app.db, c.id, body.sourceId) : null;
      await app.db.update(s.contractCommitments).set({ sourceId: body.sourceId, source: src?.name ?? null }).where(eq(s.contractCommitments.id, ne.id));
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'empenho', `Empenho ${ne.number}: fonte de receita ${src ? `"${src.name}"` : 'removida'}.`);
      await audit(app.db, req, { action: 'contract.commitment_source', entityType: 'contract', entityId: c.id, metadata: { commitmentId: ne.id, before: ne.sourceId, after: body.sourceId } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-items/:itemId/moves', summary: 'Reforço ou anulação parcial de um item de empenho (movimentação formal com motivo)', tag: 'Contratos', module: 'contratos',
    params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }),
    body: z.object({ kind: z.enum(COMMITMENT_MOVE_KINDS), qty: z.number().positive().max(1_000_000_000), occurredOn: day, reason: z.string().trim().min(5).max(500) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await manageable(app.db, auth, params.id);
      const d = await controlData(app.db, c.id);
      const it = d.items.find((i) => i.id === params.itemId);
      if (!it) throw notFound('Item de empenho não encontrado.');
      const st = controlState(d, { startAt: null, endAt: null });
      if (body.kind !== 'reforco' && q4(body.qty) > Math.max(0, st.ciBal.get(it.id) ?? 0)) throw unprocessable(`A ${body.kind === 'supressao' ? 'supressão' : 'anulação'} passa do saldo do item de empenho (${nQty(Math.max(0, st.ciBal.get(it.id) ?? 0))}).`);
      if (body.kind === 'reforco' && q4(body.qty) > (st.bal.find((b) => b.lineId === it.lineId)?.toCommit4 ?? 0)) throw unprocessable('O reforço passa do que falta empenhar no item do contrato.');
      await app.db.insert(s.contractCommitmentMoves).values({ tenantId: auth.tenantId, commitmentItemId: it.id, kind: body.kind, qty4: q4(body.qty), occurredOn: body.occurredOn, reason: body.reason, createdBy: auth.userId });
      const ne = d.commitments.find((x) => x.id === it.commitmentId)!;
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'empenho', `${COMMITMENT_MOVE_LABELS[body.kind]} de ${nQty(q4(body.qty))} no empenho ${ne.number}: ${body.reason}`);
      await audit(app.db, req, { action: `contract.commitment_${body.kind}`, entityType: 'contract', entityId: c.id, metadata: { itemId: it.id, ...body } });
      reply.code(201);
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ medições
  defineRoute({
    method: 'POST', url: '/contracts/:id/measurements', summary: 'Registra uma medição (competência, tipo, itens): reserva o saldo, baixa FIFO nos empenhos do exercício e abre pendência sem empenho', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ competence: month, kind: z.enum(MEASUREMENT_KINDS), title: z.string().trim().min(2).max(160), notes: z.string().trim().max(1000).nullable().optional(), items: z.array(z.object({ lineId: z.string().uuid(), qty: z.number().positive().max(1_000_000_000) })).min(1).max(500) }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const d = await controlData(tx, c.id);
      const items = body.items.map((i) => ({ lineId: i.lineId, qty4: q4(i.qty) }));
      checkContractBalance(d, items);
      const groupId = randomUUID();
      const [m] = await tx.insert(s.contractMeasurements).values({ tenantId: auth.tenantId, contractId: c.id, groupId, competence: body.competence, kind: body.kind, title: body.title, notes: body.notes ?? null, createdBy: auth.userId }).returning();
      const alloc = await saveMeasurementItems(tx, auth.tenantId, m!.id, d, body.competence, items, c);
      const unc = alloc.reduce((a, x) => a + value4(x.uncovered4, x.price4), 0);
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'medicao', `Medição "${body.title}" (${body.competence}) registrada${unc ? ` com ${brl4(unc)} aguardando empenho` : ''}.`, { measurementId: m!.id });
      await audit(tx, req, { action: 'contract.measurement', entityType: 'contract', entityId: c.id, metadata: { measurementId: m!.id, items: items.length } });
      reply.code(201);
      return { id: m!.id, uncoveredV4: unc };
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/contracts/:id/measurements/:mid', summary: 'Altera itens ou título de medição em elaboração (depois de enviada, só por revisão)', tag: 'Contratos', module: 'contratos', params: MParams,
    body: z.object({ title: z.string().trim().min(2).max(160).optional(), notes: z.string().trim().max(1000).nullable().optional(), items: z.array(z.object({ lineId: z.string().uuid(), qty: z.number().positive().max(1_000_000_000) })).min(1).max(500).optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const [m] = await tx.select().from(s.contractMeasurements).where(and(eq(s.contractMeasurements.id, params.mid), eq(s.contractMeasurements.contractId, c.id))).limit(1);
      if (!m) throw notFound('Medição não encontrada.');
      if (m.status !== 'elaboracao' || m.superseded) throw unprocessable('Só medição em elaboração muda direto; enviada, atestada ou faturada passa por revisão.');
      if (body.items) {
        const d = await controlData(tx, c.id);
        const items = body.items.map((i) => ({ lineId: i.lineId, qty4: q4(i.qty) }));
        checkContractBalance(d, items, { exceptMeasurement: m.id });
        await saveMeasurementItems(tx, auth.tenantId, m.id, d, m.competence, items, c, m.id);
      }
      await tx.update(s.contractMeasurements).set({ ...(body.title ? { title: body.title } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}), updatedAt: new Date() }).where(eq(s.contractMeasurements.id, m.id));
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/measurements/:mid/status', summary: 'Enviar ao órgão, atestar, faturar (com a NF) ou cancelar a medição', tag: 'Contratos', module: 'contratos', params: MParams,
    body: z.object({ action: z.enum(['enviar', 'atestar', 'faturar', 'cancelar']), invoiceNumber: z.string().trim().max(40).optional(), invoiceDate: day.optional(), invoiceCents: z.number().int().min(1).max(1_000_000_000_000).optional(), reason: z.string().trim().max(500).optional() }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const [m] = await tx.select().from(s.contractMeasurements).where(and(eq(s.contractMeasurements.id, params.mid), eq(s.contractMeasurements.contractId, c.id))).limit(1);
      if (!m || m.superseded) throw notFound('Medição não encontrada (ou já substituída por uma revisão).');
      const its = await tx.select().from(s.contractMeasurementItems).where(eq(s.contractMeasurementItems.measurementId, m.id));
      const total = its.reduce((a, x) => a + value4(x.qty4, x.price4), 0);
      let set: Partial<typeof s.contractMeasurements.$inferInsert> = {};
      if (body.action === 'enviar') { if (m.status !== 'elaboracao') throw unprocessable('Só medição em elaboração é enviada.'); set = { status: 'enviada' }; }
      if (body.action === 'atestar') { if (!['elaboracao', 'enviada'].includes(m.status)) throw unprocessable('Medição já atestada ou cancelada.'); set = { status: 'atestada', attestedAt: new Date() }; }
      if (body.action === 'faturar') {
        if (m.status !== 'atestada') throw unprocessable('Fature depois de atestada.');
        // RN13: NF só com empenho ativo cobrindo tudo
        if (its.some((x) => x.uncovered4 > 0)) throw unprocessable(`Há ${brl4(its.reduce((a, x) => a + value4(x.uncovered4, x.price4), 0))} sem empenho nesta medição: registre a NE e use "Cobrir com empenho" antes de faturar.`);
        if (!body.invoiceNumber || !body.invoiceDate) throw unprocessable('Informe o número e a data da nota fiscal.');
        set = { status: 'faturada', invoiceNumber: body.invoiceNumber, invoiceDate: body.invoiceDate, invoiceCents: body.invoiceCents ?? cents(total) };
      }
      if (body.action === 'cancelar') {
        if (!['elaboracao', 'enviada'].includes(m.status)) throw unprocessable('Medição atestada ou faturada não é cancelada: faça uma revisão.');
        if ((body.reason ?? '').length < 5) throw unprocessable('Diga o motivo do cancelamento.');
        set = { status: 'cancelada', notes: [m.notes, `Cancelada: ${body.reason}`].filter(Boolean).join('\n') };
        await tx.update(s.contractOpportunityLines).set({ status: 'reservada', measurementId: null, updatedAt: new Date() }).where(eq(s.contractOpportunityLines.measurementId, m.id));
      }
      await tx.update(s.contractMeasurements).set({ ...set, updatedAt: new Date() }).where(eq(s.contractMeasurements.id, m.id));
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'medicao', `Medição "${m.title}": ${({ enviar: 'enviada ao órgão', atestar: 'atestada', faturar: `faturada (NF ${body.invoiceNumber})`, cancelar: `cancelada (${body.reason})` } as const)[body.action]}.`, { measurementId: m.id });
      await audit(tx, req, { action: `contract.measurement_${body.action}`, entityType: 'contract', entityId: c.id, metadata: { measurementId: m.id, ...body } });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/measurements/:mid/revise', summary: 'Revisão de medição em qualquer status: nova versão com motivo, a anterior fica no histórico e os saldos se refazem', tag: 'Contratos', module: 'contratos', params: MParams,
    body: z.object({ reason: z.enum(REVISION_REASONS), note: z.string().trim().min(10).max(1000), items: z.array(z.object({ lineId: z.string().uuid(), qty: z.number().positive().max(1_000_000_000) })).min(1).max(500) }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const [m] = await tx.select().from(s.contractMeasurements).where(and(eq(s.contractMeasurements.id, params.mid), eq(s.contractMeasurements.contractId, c.id))).limit(1);
      if (!m || m.superseded) throw notFound('Medição não encontrada (ou já revisada).');
      if (m.status === 'cancelada') throw unprocessable('Medição cancelada não é revisada.');
      const d = await controlData(tx, c.id);
      const items = body.items.map((i) => ({ lineId: i.lineId, qty4: q4(i.qty) }));
      checkContractBalance(d, items, { exceptMeasurement: m.id });
      const before = d.mItems.filter((x) => x.measurementId === m.id).reduce((a, x) => a + value4(x.qty4, x.price4), 0);
      await tx.update(s.contractMeasurements).set({ superseded: true, updatedAt: new Date() }).where(eq(s.contractMeasurements.id, m.id));
      const [n] = await tx.insert(s.contractMeasurements).values({ tenantId: auth.tenantId, contractId: c.id, groupId: m.groupId, version: m.version + 1, competence: m.competence, kind: m.kind, title: m.title, status: m.status, opportunityId: m.opportunityId, revisionReason: body.reason, revisionNote: body.note, invoiceNumber: m.invoiceNumber, invoiceDate: m.invoiceDate, invoiceCents: m.invoiceCents, attestedAt: m.attestedAt, notes: m.notes, createdBy: auth.userId }).returning();
      const alloc = await saveMeasurementItems(tx, auth.tenantId, n!.id, d, m.competence, items, c, m.id);
      const after = alloc.reduce((a, x) => a + value4(x.qty4, x.price4), 0);
      // retroativo de reajuste ainda a cobrar acompanha a nova versão
      await tx.update(s.contractAdjustmentRetros).set({ measurementId: n!.id }).where(and(eq(s.contractAdjustmentRetros.measurementId, m.id), eq(s.contractAdjustmentRetros.status, 'pendente')));
      await tx.update(s.contractOpportunityLines).set({ measurementId: n!.id, updatedAt: new Date() }).where(eq(s.contractOpportunityLines.measurementId, m.id));
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'medicao', `Medição "${m.title}" revisada (v${n!.version}, ${REVISION_REASON_LABELS[body.reason]}): ${brl4(before)} → ${brl4(after)}. ${body.note}`, { measurementId: n!.id, previousId: m.id });
      await audit(tx, req, { action: 'contract.measurement_revise', entityType: 'contract', entityId: c.id, metadata: { from: m.id, to: n!.id, beforeV4: before, afterV4: after, reason: body.reason } });
      reply.code(201);
      return { id: n!.id, version: n!.version, beforeV4: before, afterV4: after, invoiceCorrection: m.status === 'faturada' && before !== after };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/cover', summary: 'Cobre com empenho as medições que estavam aguardando NE (baixa FIFO do que ficou descoberto)', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params, req }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const d = await controlData(tx, c.id);
      let covered = 0;
      for (const m of d.measurements.filter((x) => x.status !== 'cancelada' && !x.superseded)) {
        const its = d.raw.mItems.filter((x) => x.measurementId === m.id && x.uncovered4 > 0);
        for (const x of its) {
          const [a] = allocateItems(d, m.competence, [{ lineId: x.lineId, qty4: x.uncovered4 }], undefined, allocationOf(c));
          if (!a || !a.allocations.length) continue;
          const merged = [...x.allocations];
          for (const n of a.allocations) { const e = merged.find((y) => y.commitmentItemId === n.commitmentItemId); if (e) e.qty4 += n.qty4; else merged.push(n); }
          await tx.update(s.contractMeasurementItems).set({ allocations: merged, uncovered4: a.uncovered4 }).where(eq(s.contractMeasurementItems.id, x.id));
          // reflete na memória para a próxima medição não usar o mesmo saldo
          const mi = d.mItems.find((y) => y.measurementId === m.id && y.lineId === x.lineId)!;
          mi.allocations = merged; mi.uncovered4 = a.uncovered4;
          covered += value4(x.uncovered4 - a.uncovered4, x.price4);
        }
      }
      if (covered) await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `${brl4(covered)} de medições cobertos pelos empenhos disponíveis.`);
      await audit(tx, req, { action: 'contract.commitment_cover', entityType: 'contract', entityId: c.id, metadata: { coveredV4: covered } });
      return { coveredV4: covered };
    }),
  }),

  // ------------------------------------------------------------------ importação da planilha (PF11)
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/import', summary: 'Importa a planilha de controle: itens, empenhos com itens e, se pedido, o histórico de medições', tag: 'Contratos', module: 'contratos', params: IdParams,
    bodyLimit: 4_000_000,
    body: z.object({
      rows: z.array(z.object({ commitment: z.string().max(40).nullable(), commitmentItem: z.string().max(20).nullable(), code: z.string().max(40).nullable(), itemNumber: z.string().min(1).max(20), description: z.string().min(1).max(500), unit: z.string().min(1).max(20), qty: z.number().min(0), unitPrice: z.number().min(0).nullable(), measured: z.array(z.number().min(0)) })).min(1).max(2000),
      measurements: z.array(z.object({ title: z.string().max(160), date: day.nullable(), kind: z.enum(MEASUREMENT_KINDS) })).max(60),
      importMeasurements: z.boolean(), measurementStatus: z.enum(['atestada', 'faturada']).default('atestada'),
    }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const existing = await tx.select().from(s.contractLines).where(eq(s.contractLines.contractId, c.id));
      const byItem = new Map(existing.map((l) => [l.itemNumber.toLowerCase(), l]));
      let pos = Math.max(0, ...existing.map((l) => l.position));
      let createdLines = 0, createdCommitments = 0, createdItems = 0;
      // 1. itens do contrato (quantidade do contrato = soma das linhas do mesmo item)
      const lineQty = new Map<string, number>();
      for (const r of body.rows) lineQty.set(r.itemNumber.toLowerCase(), (lineQty.get(r.itemNumber.toLowerCase()) ?? 0) + r.qty);
      for (const r of body.rows) {
        const k = r.itemNumber.toLowerCase();
        if (byItem.has(k)) continue;
        const [l] = await tx.insert(s.contractLines).values({ tenantId: auth.tenantId, contractId: c.id, position: ++pos, itemNumber: r.itemNumber, description: r.description, unit: r.unit, classification: /mensal|manuten|monitora|noc/i.test(r.description) ? 'recorrente' : /instala|fus[aã]o|projeto|evento|remo|medi|treina/i.test(r.description) ? 'demanda' : 'fornecimento', qty4: q4(lineQty.get(k)!), price4: q4(r.unitPrice ?? 0), createdBy: auth.userId }).returning();
        byItem.set(k, l!); createdLines++;
      }
      // 2. empenhos e itens de empenho
      const nes = new Map((await tx.select().from(s.contractCommitments).where(eq(s.contractCommitments.contractId, c.id))).map((n) => [n.number.toUpperCase(), n]));
      for (const r of body.rows) {
        if (!r.commitment || r.qty <= 0) continue;
        const num = r.commitment.toUpperCase();
        let ne = nes.get(num);
        if (!ne) {
          const fy = Number(/^(\d{4})NE/i.exec(num)?.[1]) || Number(todayIso().slice(0, 4));
          [ne] = await tx.insert(s.contractCommitments).values({ tenantId: auth.tenantId, contractId: c.id, number: num, issuedOn: `${fy}-01-01`, fiscalYear: fy, amountCents: 1, notes: 'Importado da planilha de controle', createdBy: auth.userId }).returning();
          nes.set(num, ne!); createdCommitments++;
        }
        const line = byItem.get(r.itemNumber.toLowerCase())!;
        const [dup] = await tx.select({ id: s.contractCommitmentItems.id }).from(s.contractCommitmentItems).where(and(eq(s.contractCommitmentItems.commitmentId, ne!.id), eq(s.contractCommitmentItems.lineId, line.id))).limit(1);
        if (dup) continue;
        await tx.insert(s.contractCommitmentItems).values({ tenantId: auth.tenantId, commitmentId: ne!.id, lineId: line.id, qty4: q4(r.qty), code: r.code, itemNumber: r.commitmentItem });
        createdItems++;
      }
      // valor das NEs pelos itens
      for (const ne of nes.values()) {
        const its = await tx.select({ qty4: s.contractCommitmentItems.qty4, price4: s.contractLines.price4 }).from(s.contractCommitmentItems).innerJoin(s.contractLines, eq(s.contractLines.id, s.contractCommitmentItems.lineId)).where(eq(s.contractCommitmentItems.commitmentId, ne.id));
        await tx.update(s.contractCommitments).set({ amountCents: Math.max(1, cents(its.reduce((a, i) => a + value4(i.qty4, i.price4), 0))) }).where(eq(s.contractCommitments.id, ne.id));
      }
      // 3. histórico de medições (cada bloco da planilha vira uma medição com a baixa FIFO)
      let createdMeasurements = 0;
      if (body.importMeasurements) {
        for (const [k, mm] of body.measurements.entries()) {
          const items = body.rows.map((r) => ({ lineId: byItem.get(r.itemNumber.toLowerCase())!.id, qty4: q4(r.measured[k] ?? 0) })).filter((x) => x.qty4 > 0);
          if (!items.length) continue;
          const merged = [...items.reduce((acc, x) => acc.set(x.lineId, (acc.get(x.lineId) ?? 0) + x.qty4), new Map<string, number>())].map(([lineId, qty4]) => ({ lineId, qty4 }));
          const competence = (mm.date ?? todayIso()).slice(0, 7);
          const d = await controlData(tx, c.id);
          checkContractBalance(d, merged);
          const [m] = await tx.insert(s.contractMeasurements).values({ tenantId: auth.tenantId, contractId: c.id, groupId: randomUUID(), competence, kind: mm.kind, title: mm.title, status: body.measurementStatus, attestedAt: mm.date ? new Date(`${mm.date}T12:00:00Z`) : new Date(), notes: 'Importada da planilha de controle', createdBy: auth.userId }).returning();
          await saveMeasurementItems(tx, auth.tenantId, m!.id, d, competence, merged, { commitmentBlock: false, commitmentAllocation: c.commitmentAllocation });
          createdMeasurements++;
        }
      }
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `Planilha importada: ${createdLines} item(ns), ${createdCommitments} empenho(s), ${createdItems} item(ns) de empenho, ${createdMeasurements} medição(ões).`);
      await audit(tx, req, { action: 'contract.commitment_import', entityType: 'contract', entityId: c.id, metadata: { createdLines, createdCommitments, createdItems, createdMeasurements } });
      return { createdLines, createdCommitments, createdItems, createdMeasurements };
    }),
  }),

  // ------------------------------------------------------------------ fontes de receita e proporção (RN09-a)
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/sources', summary: 'Cadastra uma fonte de receita do cliente (ex.: educação estadual, educação municipal)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(120) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await manageable(app.db, auth, params.id);
      const [dup] = await app.db.select({ id: s.contractRevenueSources.id }).from(s.contractRevenueSources).where(and(eq(s.contractRevenueSources.contractId, c.id), sql`lower(${s.contractRevenueSources.name}) = lower(${body.name})`)).limit(1);
      if (dup) throw unprocessable('Esta fonte já está cadastrada.');
      const [x] = await app.db.insert(s.contractRevenueSources).values({ tenantId: auth.tenantId, contractId: c.id, name: body.name, createdBy: auth.userId }).returning({ id: s.contractRevenueSources.id });
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'empenho', `Fonte de receita "${body.name}" cadastrada.`);
      await audit(app.db, req, { action: 'contract.revenue_source', entityType: 'contract', entityId: c.id, metadata: body });
      reply.code(201);
      return { id: x!.id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/shares', summary: 'Registra a proporção entre as fontes (nova versão): quem definiu, a partir de qual competência; a soma é 100%', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ validFrom: month, definedBy: z.enum(['cliente', 'bk']), note: z.string().trim().max(500).nullable().optional(), shares: z.array(z.object({ sourceId: z.string().uuid(), pct: z.number().min(0).max(100) })).min(2).max(10) }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const names: string[] = [];
      for (const x of body.shares) names.push((await sourceOf(tx, c.id, x.sourceId)).name);
      if (new Set(body.shares.map((x) => x.sourceId)).size !== body.shares.length) throw unprocessable('A mesma fonte aparece duas vezes.');
      const shares = body.shares.map((x) => ({ sourceId: x.sourceId, ppm: Math.round(x.pct * 10_000) }));
      const sum = shares.reduce((a, x) => a + x.ppm, 0);
      if (sum !== PPM) throw unprocessable(`A soma das proporções deve ser 100% (está ${(sum / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%).`);
      const [last] = await tx.select({ v: sql<number>`coalesce(max(${s.contractSourceShares.version}), 0)::int` }).from(s.contractSourceShares).where(eq(s.contractSourceShares.contractId, c.id));
      const version = (last?.v ?? 0) + 1;
      await tx.insert(s.contractSourceShares).values({ tenantId: auth.tenantId, contractId: c.id, version, validFrom: body.validFrom, definedBy: body.definedBy, shares, note: body.note ?? null, createdBy: auth.userId });
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `Proporção entre fontes v${version} a partir de ${body.validFrom} (${body.definedBy === 'cliente' ? 'definida pelo cliente' : 'sugestão da BK'}): ${body.shares.map((x, i) => `${names[i]} ${x.pct.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`).join(', ')}.`);
      await audit(tx, req, { action: 'contract.source_shares', entityType: 'contract', entityId: c.id, metadata: { version, ...body } });
      reply.code(201);
      return { version };
    }),
  }),

  // ------------------------------------------------------------------ aditivo de quantidade por item (PF08.1)
  defineRoute({
    method: 'POST', url: '/contracts/:id/lines/:lineId/moves', summary: 'Aditivo de quantidade do item: acréscimo ou supressão, com data de efeito, justificativa e referência do termo', tag: 'Contratos', module: 'contratos',
    params: z.object({ id: z.string().uuid(), lineId: z.string().uuid() }),
    body: z.object({ kind: z.enum(['acrescimo', 'supressao']), qty: z.number().positive().max(1_000_000_000), effectiveOn: day, reason: z.string().trim().min(5).max(500), reference: z.string().trim().max(120).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const d = await controlData(tx, c.id);
      const l = d.lines.find((x) => x.id === params.lineId);
      if (!l) throw notFound('Item não encontrado.');
      const b = controlState(d, { startAt: null, endAt: null }).bal.find((x) => x.lineId === l.id)!;
      if (body.kind === 'supressao') {
        const max = Math.min(b.available4, b.toCommit4);
        if (q4(body.qty) > max) throw unprocessable(`A supressão passa do que está livre no item (${nQty(Math.max(0, max))} ${l.unit}): o que já foi medido, reservado ou empenhado não é suprimido. Anule o empenho do saldo antes, se for o caso.`);
      }
      await tx.insert(s.contractLineMoves).values({ tenantId: auth.tenantId, contractId: c.id, lineId: l.id, kind: body.kind, qty4: q4(body.qty), effectiveOn: body.effectiveOn, reason: body.reason, reference: body.reference ?? null, createdBy: auth.userId });
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'aditivo', `Item ${l.itemNumber}: ${body.kind === 'acrescimo' ? 'acréscimo' : 'supressão'} de ${nQty(q4(body.qty))} ${l.unit}${body.reference ? ` (${body.reference})` : ''} — ${body.reason}`);
      await audit(tx, req, { action: `contract.line_${body.kind}`, entityType: 'contract', entityId: c.id, metadata: { lineId: l.id, before: b.contracted4, ...body } });
      reply.code(201);
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------------ virada de exercício (RN10)
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/rollover', summary: 'Virada de exercício guiada: suprime o saldo das NEs do ano e vincula (ou registra) a NE do ano seguinte que reempenha', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({
      year: z.number().int().min(2000).max(2100), occurredOn: day, reason: z.string().trim().min(5).max(500),
      items: z.array(z.object({ commitmentItemId: z.string().uuid(), qty: z.number().positive().max(1_000_000_000) })).min(1).max(1000),
      newCommitment: commitmentBody.omit({ replacesId: true }).optional(),
      linkCommitmentId: z.string().uuid().optional(),
    }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const d = await controlData(tx, c.id);
      const st = controlState(d, { startAt: null, endAt: null });
      const olds = new Set<string>();
      let suppressedV4 = 0;
      const moveIds: string[] = [];
      for (const x of body.items) {
        const it = d.items.find((i) => i.id === x.commitmentItemId);
        const ne = it && d.commitments.find((n) => n.id === it.commitmentId);
        if (!it || !ne) throw unprocessable('Item de empenho que não é deste contrato.');
        if (ne.cancelled || ne.fiscalYear !== body.year) throw unprocessable(`A NE ${ne.number} não é do exercício ${body.year}.`);
        const free = Math.max(0, st.ciBal.get(it.id) ?? 0);
        if (q4(x.qty) > free) throw unprocessable(`NE ${ne.number}: a supressão passa do saldo do item (${nQty(free)}).`);
        const [mv] = await tx.insert(s.contractCommitmentMoves).values({ tenantId: auth.tenantId, commitmentItemId: it.id, kind: 'supressao', qty4: q4(x.qty), occurredOn: body.occurredOn, reason: body.reason, createdBy: auth.userId }).returning({ id: s.contractCommitmentMoves.id });
        moveIds.push(mv!.id); olds.add(ne.id);
        suppressedV4 += value4(q4(x.qty), d.lines.find((l) => l.id === it.lineId)?.price4 ?? 0);
      }
      let linked: string | null = null;
      if (body.newCommitment) {
        const fy = body.newCommitment.fiscalYear ?? (Number(/^(\d{4})NE/i.exec(body.newCommitment.number)?.[1]) || Number(body.newCommitment.issuedOn.slice(0, 4)));
        if (fy <= body.year) throw unprocessable(`A NE que reempenha deve ser de ${body.year + 1} ou depois.`);
        linked = await createCommitment(tx, auth, c, { ...body.newCommitment, fiscalYear: fy, replacesId: [...olds][0] ?? null });
      } else if (body.linkCommitmentId) {
        const ne = d.commitments.find((n) => n.id === body.linkCommitmentId);
        if (!ne || ne.fiscalYear <= body.year) throw unprocessable(`Escolha uma NE de ${body.year + 1} deste contrato.`);
        linked = ne.id;
      }
      if (linked) await tx.update(s.contractCommitmentMoves).set({ linkedCommitmentId: linked }).where(inArray(s.contractCommitmentMoves.id, moveIds));
      const nums = d.commitments.filter((n) => olds.has(n.id)).map((n) => n.number);
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `Virada de ${body.year}: ${brl4(suppressedV4)} suprimidos de ${nums.join(', ')}${linked ? ` e reempenhados na ${linked === body.linkCommitmentId ? d.commitments.find((n) => n.id === linked)!.number : body.newCommitment!.number}` : ' (NE do ano seguinte ainda a vincular)'}. ${body.reason}`);
      await audit(tx, req, { action: 'contract.commitment_rollover', entityType: 'contract', entityId: c.id, metadata: { year: body.year, items: body.items.length, suppressedV4, linked } });
      reply.code(201);
      return { suppressedV4, commitmentId: linked };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/rollover/link', summary: 'Vincula a NE do ano seguinte às supressões da virada que ficaram sem NE nova (rastro NE antiga → NE nova)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ year: z.number().int().min(2000).max(2100), commitmentId: z.string().uuid() }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const d = await controlData(tx, c.id);
      const ne = d.commitments.find((n) => n.id === body.commitmentId);
      if (!ne || ne.fiscalYear <= body.year) throw unprocessable(`Escolha uma NE de ${body.year + 1} deste contrato.`);
      const itemIds = d.items.filter((i) => d.commitments.some((n) => n.id === i.commitmentId && n.fiscalYear === body.year)).map((i) => i.id);
      const open = d.raw.moves.filter((m) => m.kind === 'supressao' && !m.linkedCommitmentId && itemIds.includes(m.commitmentItemId));
      if (!open.length) throw unprocessable(`Não há supressão de ${body.year} sem NE nova.`);
      await tx.update(s.contractCommitmentMoves).set({ linkedCommitmentId: ne.id }).where(inArray(s.contractCommitmentMoves.id, open.map((m) => m.id)));
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `Supressões de ${body.year} vinculadas à NE ${ne.number}.`);
      await audit(tx, req, { action: 'contract.commitment_rollover_link', entityType: 'contract', entityId: c.id, metadata: body });
      return { linked: open.length };
    }),
  }),

  // ------------------------------------------------------------------ reajuste por índice (PF08.2)
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/adjustments/preview', summary: 'Simula o reajuste: tabela anterior × reajustada por item e retroativo medição a medição (nada é gravado)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: adjustmentBody,
    handler: async ({ app, auth, params, body }) => {
      const c = await manageable(app.db, auth, params.id);
      const p = await planAdjustment(app.db, c.id, body);
      return { factor8: p.factor8, pct: factorToPct(p.factor8), table: p.table, retro: p.retro.invoiced, repriced: p.retro.reprice.length, retroTotalV4: p.retro.invoiced.reduce((a, x) => a + x.diffV4, 0) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/adjustments', summary: 'Registra o reajuste: grava a nova tabela de preços (a anterior fica com a sua janela), passa as medições não faturadas ao preço novo e gera o retroativo das faturadas', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: adjustmentBody.extend({ note: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const p = await planAdjustment(tx, c.id, body);
      const [a] = await tx.insert(s.contractAdjustments).values({ tenantId: auth.tenantId, contractId: c.id, indexName: body.indexName, mode: body.mode, inputText: body.index, factor8: p.factor8, baseDate: body.baseDate, startCompetence: body.startCompetence, note: body.note ?? null, repriced: p.retro.reprice, createdBy: auth.userId }).returning({ id: s.contractAdjustments.id });
      if (p.table.length) await tx.insert(s.contractLinePrices).values(p.table.map((t) => ({ tenantId: auth.tenantId, adjustmentId: a!.id, lineId: t.lineId, fromCompetence: body.startCompetence, previousPrice4: t.oldPrice4, price4: t.newPrice4 })));
      if (p.retro.invoiced.length) await tx.insert(s.contractAdjustmentRetros).values(p.retro.invoiced.map((r) => ({ tenantId: auth.tenantId, contractId: c.id, adjustmentId: a!.id, measurementId: r.measurementId, items: r.items, diffV4: r.diffV4 })));
      // RN08: a medição passa a valer pelo preço reajustado (a faturada fica com a diferença como retroativo)
      for (const x of [...p.retro.reprice, ...p.retro.invoiced.flatMap((r) => r.items.map((i) => ({ measurementId: r.measurementId, lineId: i.lineId, newPrice4: i.newPrice4 })))]) {
        await tx.update(s.contractMeasurementItems).set({ price4: x.newPrice4 }).where(and(eq(s.contractMeasurementItems.measurementId, x.measurementId), eq(s.contractMeasurementItems.lineId, x.lineId)));
      }
      const retroV4 = p.retro.invoiced.reduce((acc, x) => acc + x.diffV4, 0);
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'reajuste', `Reajuste ${body.indexName} (${body.index}${body.mode === 'percentual' ? '%' : ''}) a partir de ${body.startCompetence}, data-base ${body.baseDate}: ${p.table.length} item(ns) com preço novo${retroV4 ? `, retroativo de ${brl4(retroV4)} em ${p.retro.invoiced.length} medição(ões) faturada(s)` : ''}.`);
      await audit(tx, req, { action: 'contract.adjustment', entityType: 'contract', entityId: c.id, metadata: { adjustmentId: a!.id, factor8: p.factor8, start: body.startCompetence, retroV4, repriced: p.retro.reprice.length } });
      reply.code(201);
      return { id: a!.id, retroTotalV4: retroV4 };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/retros/invoice', summary: 'Fatura o retroativo de reajuste em NF complementar (uma ou mais medições)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ ids: z.array(z.string().uuid()).min(1).max(200), invoiceNumber: z.string().trim().min(1).max(40), invoiceDate: day, invoiceCents: z.number().int().min(1).max(1_000_000_000_000).optional() }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const rows = await tx.select().from(s.contractAdjustmentRetros).where(and(eq(s.contractAdjustmentRetros.contractId, c.id), inArray(s.contractAdjustmentRetros.id, body.ids), eq(s.contractAdjustmentRetros.status, 'pendente')));
      if (rows.length !== body.ids.length) throw unprocessable('Retroativo não encontrado ou já faturado.');
      const total = rows.reduce((a, r) => a + r.diffV4, 0);
      await tx.update(s.contractAdjustmentRetros).set({ status: 'faturado', invoiceNumber: body.invoiceNumber, invoiceDate: body.invoiceDate, invoiceCents: body.invoiceCents ?? cents(total), invoicedBy: auth.userId, invoicedAt: new Date() }).where(inArray(s.contractAdjustmentRetros.id, body.ids));
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'reajuste', `Retroativo de ${brl4(total)} faturado na NF complementar ${body.invoiceNumber} (${rows.length} medição(ões)).`);
      await audit(tx, req, { action: 'contract.adjustment_retro_invoice', entityType: 'contract', entityId: c.id, metadata: { ...body, totalV4: total } });
      return { ok: true, totalV4: total };
    }),
  }),

  // ------------------------------------------------------------------ pipeline: oportunidade consome itens do contrato
  defineRoute({
    method: 'GET', url: '/opportunities/:id/contract-items', summary: 'Contratos do cliente com controle de empenhos (itens e saldo disponível) e o que a oportunidade já reservou', tag: 'Oportunidades', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const ctrs = await app.db.select({ id: s.contracts.id, code: s.contracts.code, stage: s.contracts.stage, number: s.contractVersions.number, object: s.contractVersions.object })
        .from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion)))
        .where(and(eq(s.contracts.tenantId, auth.tenantId), eq(s.contracts.contactId, o.contactId), sql`${s.contracts.stage} not in ('arquivado','encerramento')`, sql`exists (select 1 from contract_lines cl where cl.contract_id = ${s.contracts.id})`));
      const mine = await app.db.select().from(s.contractOpportunityLines).where(and(eq(s.contractOpportunityLines.opportunityId, o.id), inArray(s.contractOpportunityLines.status, ['reservada', 'medida'])));
      const out = [];
      for (const ct of ctrs) {
        const d = await controlData(app.db, ct.id);
        out.push({ ...ct, lines: d.raw.lines.map((l) => ({ id: l.id, itemNumber: l.itemNumber, description: l.description, unit: l.unit, price4: l.price4, available4: availableFor(d, l.id, { exceptOpportunity: o.id }) })) });
      }
      return { contracts: out, reserved: mine, locked: o.stage === 'ganha' || o.stage === 'perdida' };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/opportunities/:id/contract-items', summary: 'Reserva itens do contrato para a oportunidade (compromete o saldo); vazio libera. Na venda ganha viram medição', tag: 'Oportunidades', module: 'oportunidades', params: IdParams,
    body: z.object({ contractId: z.string().uuid().nullable(), lines: z.array(z.object({ lineId: z.string().uuid(), qty: z.number().positive().max(1_000_000_000) })).max(500) }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const o = await loadOpportunity(tx, auth, params.id);
      if (o.stage === 'ganha' || o.stage === 'perdida') throw unprocessable('Oportunidade encerrada: reabra para mudar os itens do contrato.');
      await tx.update(s.contractOpportunityLines).set({ status: 'liberada', updatedAt: new Date() }).where(and(eq(s.contractOpportunityLines.opportunityId, o.id), eq(s.contractOpportunityLines.status, 'reservada')));
      if (body.contractId && body.lines.length) {
        const [ct] = await tx.select({ id: s.contracts.id, contactId: s.contracts.contactId }).from(s.contracts).where(and(eq(s.contracts.id, body.contractId), eq(s.contracts.tenantId, auth.tenantId))).limit(1);
        if (!ct || ct.contactId !== o.contactId) throw unprocessable('Escolha um contrato deste cliente.');
        const d = await controlData(tx, ct.id);
        const items = body.lines.map((l) => ({ lineId: l.lineId, qty4: q4(l.qty) }));
        checkContractBalance(d, items, { exceptOpportunity: o.id });
        for (const it of items) {
          await tx.insert(s.contractOpportunityLines).values({ tenantId: auth.tenantId, contractId: ct.id, opportunityId: o.id, lineId: it.lineId, qty4: it.qty4, status: 'reservada' })
            .onConflictDoUpdate({ target: [s.contractOpportunityLines.opportunityId, s.contractOpportunityLines.lineId], set: { contractId: ct.id, qty4: it.qty4, status: 'reservada', measurementId: null, updatedAt: new Date() } });
        }
        await addEvent(tx, auth.tenantId, ct.id, auth.userId, 'empenho', `OP-${o.code} reservou ${items.length} item(ns) do contrato.`, { opportunityId: o.id });
      }
      await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'contrato_itens', actorId: auth.userId, payload: { contractId: body.contractId, lines: body.lines.length } });
      await audit(tx, req, { action: 'opportunity.contract_items', entityType: 'opportunity', entityId: o.id, metadata: body });
      return { ok: true };
    }),
  }),
];

/** Venda ganha: os itens reservados viram uma medição em elaboração (baixa FIFO nos empenhos). */
export async function onContractItemsWon(tx: DbOrTx, auth: AuthContext, opp: { id: string; code: number; title: string }) {
  const lines = await tx.select().from(s.contractOpportunityLines).where(and(eq(s.contractOpportunityLines.opportunityId, opp.id), eq(s.contractOpportunityLines.status, 'reservada')));
  if (!lines.length) return;
  const byContract = new Map<string, typeof lines>();
  for (const l of lines) byContract.set(l.contractId, [...(byContract.get(l.contractId) ?? []), l]);
  for (const [contractId, ls] of byContract) {
    const [c] = await tx.select({ commitmentBlock: s.contracts.commitmentBlock, commitmentAllocation: s.contracts.commitmentAllocation }).from(s.contracts).where(eq(s.contracts.id, contractId)).limit(1);
    // a reserva da própria oportunidade sai antes de medir (vira consumo)
    await tx.update(s.contractOpportunityLines).set({ status: 'medida', updatedAt: new Date() }).where(inArray(s.contractOpportunityLines.id, ls.map((l) => l.id)));
    const d = await controlData(tx, contractId);
    const competence = todayIso().slice(0, 7);
    const [m] = await tx.insert(s.contractMeasurements).values({ tenantId: auth.tenantId, contractId, groupId: randomUUID(), competence, kind: 'avulsa', title: `Venda OP-${opp.code} · ${opp.title}`.slice(0, 160), opportunityId: opp.id, createdBy: auth.userId }).returning();
    await saveMeasurementItems(tx, auth.tenantId, m!.id, d, competence, ls.map((l) => ({ lineId: l.lineId, qty4: l.qty4 })), { commitmentBlock: false, commitmentAllocation: c?.commitmentAllocation ?? 'fifo' });
    await tx.update(s.contractOpportunityLines).set({ measurementId: m!.id }).where(inArray(s.contractOpportunityLines.id, ls.map((l) => l.id)));
    await addEvent(tx, auth.tenantId, contractId, auth.userId, 'medicao', `Venda OP-${opp.code} fechada: medição "${m!.title}" criada em elaboração com ${ls.length} item(ns).`, { measurementId: m!.id, opportunityId: opp.id });
  }
}
/** Venda perdida libera as reservas; reabrir uma venda ganha cancela a medição ainda não atestada e volta a reservar. */
export async function onContractItemsLost(tx: DbOrTx, oppId: string) {
  await tx.update(s.contractOpportunityLines).set({ status: 'liberada', updatedAt: new Date() }).where(and(eq(s.contractOpportunityLines.opportunityId, oppId), eq(s.contractOpportunityLines.status, 'reservada')));
}
export async function onContractItemsReopened(tx: DbOrTx, oppId: string) {
  const ls = await tx.select().from(s.contractOpportunityLines).where(and(eq(s.contractOpportunityLines.opportunityId, oppId), eq(s.contractOpportunityLines.status, 'medida')));
  const mids = [...new Set(ls.map((l) => l.measurementId).filter((x): x is string => !!x))];
  if (!mids.length) return;
  const open = await tx.select({ id: s.contractMeasurements.id }).from(s.contractMeasurements).where(and(inArray(s.contractMeasurements.id, mids), inArray(s.contractMeasurements.status, ['elaboracao', 'enviada']), eq(s.contractMeasurements.superseded, false)));
  if (!open.length) return;
  await tx.update(s.contractMeasurements).set({ status: 'cancelada', notes: 'Cancelada: a venda foi reaberta', updatedAt: new Date() }).where(inArray(s.contractMeasurements.id, open.map((x) => x.id)));
  await tx.update(s.contractOpportunityLines).set({ status: 'reservada', measurementId: null, updatedAt: new Date() }).where(and(eq(s.contractOpportunityLines.opportunityId, oppId), inArray(s.contractOpportunityLines.measurementId, open.map((x) => x.id))));
}
