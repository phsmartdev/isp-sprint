/**
 * Gestão de Contratos → Controle de Empenhos: itens do contrato, notas de empenho com itens, medições (com revisão por
 * versão), pendências, alertas, importação da planilha e o consumo pelas oportunidades da pipeline (como na ata).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { LINE_CLASSES, MEASUREMENT_KINDS, MEASUREMENT_STATUS_LABELS, REVISION_REASONS, REVISION_REASON_LABELS, cents, fromQ4, q4, value4, type MeasurementStatus } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { addEvent, loadContract } from '../services/contracts';
import { loadOpportunity } from '../services/opportunities';
import { allocateItems, availableFor, canManageCommitments, controlData, controlState, todayIso, type ControlData } from '../services/commitmentControl';

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

async function saveMeasurementItems(db: DbOrTx, tenantId: string, measurementId: string, d: ControlData, competence: string, items: { lineId: string; qty4: number }[], block: boolean, except?: string) {
  const alloc = allocateItems(d, competence, items, except);
  const uncovered = alloc.filter((a) => a.uncovered4 > 0);
  if (block && uncovered.length) throw unprocessable(`Este contrato bloqueia medição sem empenho: ${uncovered.map((u) => `item ${d.lines.find((l) => l.id === u.lineId)?.itemNumber} (${nQty(u.uncovered4)} sem cobertura)`).join(', ')}.`);
  await db.delete(s.contractMeasurementItems).where(eq(s.contractMeasurementItems.measurementId, measurementId));
  if (alloc.length) await db.insert(s.contractMeasurementItems).values(alloc.map((a) => ({ tenantId, measurementId, lineId: a.lineId, qty4: a.qty4, price4: d.lines.find((l) => l.id === a.lineId)!.price4, allocations: a.allocations, uncovered4: a.uncovered4 })));
  return alloc;
}

function serialize(d: ControlData, st: ReturnType<typeof controlState>) {
  const lineById = new Map(d.raw.lines.map((l) => [l.id, l]));
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
      return { ...i, adjust4: adj, balance4, valueV4: value4(i.qty4 + adj, l?.price4 ?? 0), balanceV4: value4(balance4, l?.price4 ?? 0), moves: d.raw.moves.filter((m) => m.commitmentItemId === i.id) };
    });
    return { ...c, items: its, valueV4: its.reduce((a, i) => a + i.valueV4, 0), balanceV4: c.cancelledAt ? 0 : its.reduce((a, i) => a + i.balanceV4, 0) };
  });
  // pendências estruturadas (PF05): sem empenho, executado sem nota fiscal
  const pendencias = [
    ...measurements.filter((m) => m.status !== 'cancelada' && !m.superseded && m.uncoveredV4 > 0).map((m) => ({ kind: 'aguardando_empenho', label: 'Aguardando empenho', measurementId: m.id, title: m.title, competence: m.competence, valueV4: m.uncoveredV4, since: m.createdAt })),
    ...measurements.filter((m) => m.status === 'atestada' && !m.superseded).map((m) => ({ kind: 'sem_nf', label: 'Executado sem nota fiscal', measurementId: m.id, title: m.title, competence: m.competence, valueV4: m.valueV4, since: m.attestedAt ?? m.createdAt })),
  ];
  return {
    lines: d.raw.lines.map((l) => ({ ...l, valueV4: value4(l.qty4, l.price4), balance: st.bal.find((b) => b.lineId === l.id)!, reservations: reservationsByLine.get(l.id) ?? [], measured: d.raw.mItems.filter((x) => x.lineId === l.id && measurements.some((m) => m.id === x.measurementId && !m.superseded && m.status !== 'cancelada')).map((x) => ({ measurementId: x.measurementId, qty4: x.qty4 })) })),
    commitments, measurements, pendencias, totals: st.totals, alerts: st.alerts,
  };
}

export const commitmentControlRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/:id/commitment-control', summary: 'Controle de Empenhos do contrato: itens com os saldos (contratado, empenhado, executado, faturado, a empenhar), NEs, medições, pendências e alertas', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const v = await versionOf(app.db, c);
      const d = await controlData(app.db, c.id);
      const st = controlState(d, v?.endAt ?? null);
      const sum = d.lines.reduce((a, l) => a + value4(l.qty4, l.price4), 0);
      const global = v?.totalCents ?? null;
      return {
        contract: { id: c.id, code: c.code, kind: c.kind, number: v?.number ?? null, object: v?.object ?? null, startAt: v?.startAt ?? null, endAt: v?.endAt ?? null, totalCents: global, commitmentBlock: c.commitmentBlock },
        ...serialize(d, st), canManage: canManageCommitments(auth, c), today: todayIso(),
        // RN02: soma dos itens × valor global (alerta, não bloqueio)
        globalCheck: global != null && d.lines.length ? { itemsCents: cents(sum), globalCents: global, diffCents: cents(sum) - global } : null,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-control/settings', summary: 'Regra do contrato: bloquear medição sem empenho (padrão: permitir com pendência)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ commitmentBlock: z.boolean() }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await manageable(app.db, auth, params.id);
      await app.db.update(s.contracts).set({ commitmentBlock: body.commitmentBlock, updatedAt: new Date() }).where(eq(s.contracts.id, c.id));
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'empenho', body.commitmentBlock ? 'Controle de empenhos: medição sem empenho bloqueada.' : 'Controle de empenhos: medição sem empenho permitida com pendência.');
      await audit(app.db, req, { action: 'contract.commitment_settings', entityType: 'contract', entityId: c.id, metadata: body });
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
    method: 'POST', url: '/contracts/:id/commitment-control/commitments', summary: 'Registra a nota de empenho com os itens que ela cobre (código do item na NE e quantidade); o valor sai dos itens', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ number: z.string().trim().min(3).max(40), issuedOn: day, fiscalYear: z.number().int().min(2000).max(2100).optional(), source: z.string().trim().max(120).nullable().optional(), replacesId: z.string().uuid().nullable().optional(), notes: z.string().trim().max(500).nullable().optional(),
      items: z.array(z.object({ lineId: z.string().uuid(), qty: z.number().positive().max(1_000_000_000), code: z.string().trim().max(40).nullable().optional(), itemNumber: z.string().trim().max(20).nullable().optional() })).min(1).max(500) }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      const c = await manageable(tx, auth, params.id);
      const [dup] = await tx.select({ id: s.contractCommitments.id }).from(s.contractCommitments).where(and(eq(s.contractCommitments.contractId, c.id), eq(s.contractCommitments.number, body.number))).limit(1);
      if (dup) throw unprocessable('Este empenho já está registrado no contrato.', [{ path: 'number', message: 'Duplicado' }]);
      const d = await controlData(tx, c.id);
      const lineIds = new Set(body.items.map((i) => i.lineId));
      if (lineIds.size !== body.items.length) throw unprocessable('O mesmo item aparece duas vezes na nota.');
      // RN10: o que não pode passar do contrato é a soma dos empenhos válidos
      const st = controlState(d, null);
      for (const it of body.items) {
        const l = d.lines.find((x) => x.id === it.lineId);
        if (!l) throw unprocessable('Item que não é deste contrato.');
        const b = st.bal.find((x) => x.lineId === it.lineId)!;
        if (q4(it.qty) > b.toCommit4) throw unprocessable(`Item ${l.itemNumber}: empenhar ${nQty(q4(it.qty))} passa do que falta empenhar (${nQty(Math.max(0, b.toCommit4))}). Anule ou suprima a NE antiga antes de reempenhar.`);
      }
      const amount = body.items.reduce((a, it) => a + value4(q4(it.qty), d.lines.find((l) => l.id === it.lineId)!.price4), 0);
      const fy = body.fiscalYear ?? (Number(/^(\d{4})NE/i.exec(body.number)?.[1]) || Number(body.issuedOn.slice(0, 4)));
      const [e] = await tx.insert(s.contractCommitments).values({ tenantId: auth.tenantId, contractId: c.id, number: body.number, issuedOn: body.issuedOn, fiscalYear: fy, amountCents: Math.max(1, cents(amount)), source: body.source ?? null, replacesId: body.replacesId ?? null, notes: body.notes ?? null, createdBy: auth.userId }).returning({ id: s.contractCommitments.id });
      await tx.insert(s.contractCommitmentItems).values(body.items.map((it) => ({ tenantId: auth.tenantId, commitmentId: e!.id, lineId: it.lineId, qty4: q4(it.qty), code: it.code ?? null, itemNumber: it.itemNumber ?? null })));
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `Empenho ${body.number} (${fy}) de ${brl4(amount)} cobrindo ${body.items.length} item(ns).`, { commitmentId: e!.id });
      await audit(tx, req, { action: 'contract.commitment', entityType: 'contract', entityId: c.id, metadata: { number: body.number, items: body.items.length, amountV4: amount } });
      reply.code(201);
      return { id: e!.id };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitment-items/:itemId/moves', summary: 'Reforço ou anulação parcial de um item de empenho (movimentação formal com motivo)', tag: 'Contratos', module: 'contratos',
    params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }),
    body: z.object({ kind: z.enum(['reforco', 'anulacao']), qty: z.number().positive().max(1_000_000_000), occurredOn: day, reason: z.string().trim().min(5).max(500) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await manageable(app.db, auth, params.id);
      const d = await controlData(app.db, c.id);
      const it = d.items.find((i) => i.id === params.itemId);
      if (!it) throw notFound('Item de empenho não encontrado.');
      const st = controlState(d, null);
      if (body.kind === 'anulacao' && q4(body.qty) > Math.max(0, st.ciBal.get(it.id) ?? 0)) throw unprocessable(`A anulação passa do saldo do item de empenho (${nQty(Math.max(0, st.ciBal.get(it.id) ?? 0))}).`);
      if (body.kind === 'reforco' && q4(body.qty) > (st.bal.find((b) => b.lineId === it.lineId)?.toCommit4 ?? 0)) throw unprocessable('O reforço passa do que falta empenhar no item do contrato.');
      await app.db.insert(s.contractCommitmentMoves).values({ tenantId: auth.tenantId, commitmentItemId: it.id, kind: body.kind, qty4: q4(body.qty), occurredOn: body.occurredOn, reason: body.reason, createdBy: auth.userId });
      const ne = d.commitments.find((x) => x.id === it.commitmentId)!;
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'empenho', `${body.kind === 'reforco' ? 'Reforço' : 'Anulação parcial'} de ${nQty(q4(body.qty))} no empenho ${ne.number}: ${body.reason}`);
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
      const alloc = await saveMeasurementItems(tx, auth.tenantId, m!.id, d, body.competence, items, c.commitmentBlock);
      const unc = alloc.reduce((a, x) => a + value4(x.uncovered4, d.lines.find((l) => l.id === x.lineId)!.price4), 0);
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
        await saveMeasurementItems(tx, auth.tenantId, m.id, d, m.competence, items, c.commitmentBlock, m.id);
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
      const alloc = await saveMeasurementItems(tx, auth.tenantId, n!.id, d, m.competence, items, c.commitmentBlock, m.id);
      const after = alloc.reduce((a, x) => a + value4(x.qty4, d.lines.find((l) => l.id === x.lineId)!.price4), 0);
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
          const [a] = allocateItems(d, m.competence, [{ lineId: x.lineId, qty4: x.uncovered4 }]);
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
          await saveMeasurementItems(tx, auth.tenantId, m!.id, d, competence, merged, false);
          createdMeasurements++;
        }
      }
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'empenho', `Planilha importada: ${createdLines} item(ns), ${createdCommitments} empenho(s), ${createdItems} item(ns) de empenho, ${createdMeasurements} medição(ões).`);
      await audit(tx, req, { action: 'contract.commitment_import', entityType: 'contract', entityId: c.id, metadata: { createdLines, createdCommitments, createdItems, createdMeasurements } });
      return { createdLines, createdCommitments, createdItems, createdMeasurements };
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
    const [c] = await tx.select({ commitmentBlock: s.contracts.commitmentBlock }).from(s.contracts).where(eq(s.contracts.id, contractId)).limit(1);
    // a reserva da própria oportunidade sai antes de medir (vira consumo)
    await tx.update(s.contractOpportunityLines).set({ status: 'medida', updatedAt: new Date() }).where(inArray(s.contractOpportunityLines.id, ls.map((l) => l.id)));
    const d = await controlData(tx, contractId);
    const competence = todayIso().slice(0, 7);
    const [m] = await tx.insert(s.contractMeasurements).values({ tenantId: auth.tenantId, contractId, groupId: randomUUID(), competence, kind: 'avulsa', title: `Venda OP-${opp.code} · ${opp.title}`.slice(0, 160), opportunityId: opp.id, createdBy: auth.userId }).returning();
    await saveMeasurementItems(tx, auth.tenantId, m!.id, d, competence, ls.map((l) => ({ lineId: l.lineId, qty4: l.qty4 })), false);
    await tx.update(s.contractOpportunityLines).set({ measurementId: m!.id }).where(inArray(s.contractOpportunityLines.id, ls.map((l) => l.id)));
    await addEvent(tx, auth.tenantId, contractId, auth.userId, 'medicao', `Venda OP-${opp.code} fechada: medição "${m!.title}" criada em elaboração com ${ls.length} item(ns)${c?.commitmentBlock ? '' : ''}.`, { measurementId: m!.id, opportunityId: opp.id });
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
