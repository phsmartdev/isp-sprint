/** Atas de registro de preços (dentro de Gestão de Contratos): cadastro, órgãos, itens, importação, documentos, regras e histórico. */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AGENCY_KINDS, ARP_REGIMES, ARP_STATUSES, IMPORT_FIELDS, LEGAL_CAPS, fmtQty, itemKey, lineValue, parseImportRows, validateRules, type ArpRegime, type ArpRules,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import { audit } from '../services/audit';
import { arpEvent, arpState, canEffectArp, canManageArp, loadArp, lockArp, requireArp, rulesFor, todayIso, addDaysIso, type ArpState } from '../services/arp';

const ArpBody = z.object({
  number: z.string().trim().min(1).max(60),
  object: z.string().trim().min(3).max(2000),
  processNumber: z.string().trim().max(80).nullable().default(null),
  regime: z.enum(ARP_REGIMES).default('federal'),
  supplierName: z.string().trim().min(2).max(200),
  supplierDocument: z.string().trim().max(30).nullable().default(null),
  signedAt: z.string().date().nullable().default(null),
  startAt: z.string().date().nullable().default(null),
  endAt: z.string().date().nullable().default(null),
  notes: z.string().trim().max(4000).nullable().default(null),
  managerName: z.string().trim().min(2).max(200),
  managerDocument: z.string().trim().max(30).nullable().default(null),
});
const DOC_CATEGORIES = ['ata', 'edital', 'publicacao', 'adesao', 'aceite_fornecedor', 'autorizacao_gerenciador', 'empenho', 'contrato', 'ordem_servico', 'parecer_juridico', 'outro'] as const;
const ItemParams = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });

/** Visão dos itens com saldos (quantidades em milésimos, valores em centavos). */
export function itemsView(st: ArpState) {
  const contractedValue = new Map<string, number>();
  for (const l of st.ledger) {
    if (l.kind === 'consumo') contractedValue.set(l.itemId, (contractedValue.get(l.itemId) ?? 0) + l.amountCents);
    if (l.kind === 'estorno') contractedValue.set(l.itemId, (contractedValue.get(l.itemId) ?? 0) - l.amountCents);
  }
  return st.items.map((i) => {
    const b = st.balances.byItem.get(i.id)!;
    return {
      id: i.id, itemNumber: i.itemNumber, lot: i.lot, code: i.code, description: i.description, specification: i.specification, unit: i.unit, unitCents: i.unitCents, brandModel: i.brandModel, notes: i.notes, extra: i.extra,
      originalMilli: i.registeredMilli, registeredMilli: b.registered, reservedMilli: b.reserved, contractedMilli: b.contracted, executedMilli: b.executed, billedMilli: b.billed, availableMilli: b.available,
      adhesionAuthorizedMilli: b.adhesionAuthorized, adhesionAvailableMilli: b.adhesionAvailable,
      registeredValueCents: lineValue(b.registered, i.unitCents), availableValueCents: lineValue(b.available, i.unitCents), contractedValueCents: contractedValue.get(i.id) ?? 0,
      byAgency: st.agencies.map((a) => ({ agencyId: a.id, ...(st.balances.byItemAgency.get(`${i.id}|${a.id}`) ?? { quota: 0, reserved: 0, contracted: 0, executed: 0, billed: 0, available: 0 }) })).filter((x) => x.quota || x.reserved || x.contracted),
    };
  });
}

export async function alertsOf(db: DbOrTx, arp: typeof s.arps.$inferSelect, st: ArpState) {
  const out: { level: 'alta' | 'media'; text: string }[] = [];
  const today = todayIso();
  if (arp.status === 'vigente' && arp.endAt) {
    const days = Math.round((Date.parse(arp.endAt) - Date.parse(today)) / 86_400_000);
    if (days < 0) out.push({ level: 'alta', text: `Vigência terminou em ${arp.endAt.split('-').reverse().join('/')}: encerre a ata.` });
    else if (days <= 60) out.push({ level: days <= 30 ? 'alta' : 'media', text: `Vigência termina em ${days} dia(s).` });
  }
  const rules = (await rulesFor(db, arp.tenantId, arp.regime as ArpRegime)).rules;
  for (const i of st.items) {
    const b = st.balances.byItem.get(i.id)!;
    if (b.registered > 0 && b.available <= b.registered * 0.1) out.push({ level: b.available <= 0 ? 'alta' : 'media', text: `Item ${i.itemNumber}: saldo de ${fmtQty(Math.max(0, b.available))} ${i.unit} (${Math.round((Math.max(0, b.available) / b.registered) * 100)}% do registrado).` });
    const total = Math.floor((i.registeredMilli * rules.adhesionTotalBp) / 10_000);
    if (total > 0 && b.adhesionAuthorized >= total * 0.8) out.push({ level: b.adhesionAuthorized >= total ? 'alta' : 'media', text: `Item ${i.itemNumber}: adesões em ${Math.round((b.adhesionAuthorized / total) * 100)}% do limite total.` });
  }
  const adh = await db.select().from(s.arpAdhesions).where(and(eq(s.arpAdhesions.arpId, arp.id), eq(s.arpAdhesions.status, 'autorizada')));
  for (const a of adh) if (a.deadlineAt && !a.contractId && a.deadlineAt <= addDaysIso(today, 15)) out.push({ level: a.deadlineAt < today ? 'alta' : 'media', text: `Adesão autorizada com prazo de contratação ${a.deadlineAt < today ? 'vencido' : 'perto do fim'} (${a.deadlineAt.split('-').reverse().join('/')}).` });
  const [ops] = await db.select({ n: sql<number>`count(*)::int` }).from(s.arpOperations).where(and(eq(s.arpOperations.arpId, arp.id), inArray(s.arpOperations.status, ['solicitada', 'aprovada'])));
  if (ops?.n) out.push({ level: 'media', text: `${ops.n} operação(ões) entre itens aguardando aprovação ou efetivação.` });
  return out;
}

export const arpRoutes = [
  defineRoute({
    method: 'GET',
    url: '/arps',
    summary: 'Atas de registro de preços com saldos resumidos',
    tag: 'Atas',
    module: 'contratos',
    query: z.object({ q: z.string().max(100).optional(), status: z.enum(ARP_STATUSES).optional() }),
    handler: async ({ app, auth, query }) => {
      requireArp(auth, 'view');
      const rows = await app.db.select().from(s.arps).where(and(eq(s.arps.tenantId, auth.tenantId), query.status ? eq(s.arps.status, query.status) : undefined, query.q ? sql`(${s.arps.number} ilike ${`%${query.q}%`} or ${s.arps.object} ilike ${`%${query.q}%`})` : undefined)).orderBy(desc(s.arps.createdAt));
      const items = [];
      for (const a of rows) {
        const st = await arpState(app.db, a.id);
        const iv = itemsView(st);
        const manager = st.agencies.find((x) => x.kind === 'gerenciador');
        items.push({
          ...a, managerName: manager?.name ?? null, itemCount: iv.length, agencyCount: st.agencies.length,
          registeredValueCents: iv.reduce((x, i) => x + i.registeredValueCents, 0), contractedValueCents: iv.reduce((x, i) => x + i.contractedValueCents, 0), availableValueCents: iv.reduce((x, i) => x + Math.max(0, i.availableValueCents), 0),
          adhesions: (await app.db.select({ n: sql<number>`count(*)::int` }).from(s.arpAdhesions).where(and(eq(s.arpAdhesions.arpId, a.id), inArray(s.arpAdhesions.status, ['autorizada', 'contratada']))))[0]?.n ?? 0,
          openOpportunities: (await app.db.select({ n: sql<number>`count(*)::int` }).from(s.opportunities).where(and(eq(s.opportunities.arpId, a.id), sql`${s.opportunities.deletedAt} is null`, sql`${s.opportunities.stage} not in ('ganha','perdida')`)))[0]?.n ?? 0,
          alerts: (await alertsOf(app.db, a, st)).length,
        });
      }
      return { items, canManage: canManageArp(auth) };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arps',
    summary: 'Cadastra uma ata (com o órgão gerenciador). Os itens entram em seguida, à mão ou por importação.',
    tag: 'Atas',
    module: 'contratos',
    body: ArpBody,
    handler: async ({ app, auth, body, req, reply }) => {
      requireArp(auth, 'manage');
      if (body.startAt && body.endAt && body.endAt < body.startAt) throw unprocessable('O fim da vigência é anterior ao início.', [{ path: 'endAt', message: 'Data inválida' }]);
      const [dup] = await app.db.select({ id: s.arps.id }).from(s.arps).where(and(eq(s.arps.tenantId, auth.tenantId), sql`lower(${s.arps.number}) = lower(${body.number})`)).limit(1);
      if (dup) throw unprocessable('Já existe ata com este número.', [{ path: 'number', message: 'Número já cadastrado' }]);
      const a = await app.db.transaction(async (tx) => {
        const { managerName, managerDocument, ...rest } = body;
        const [a] = await tx.insert(s.arps).values({ ...rest, tenantId: auth.tenantId, ownerId: auth.userId, createdBy: auth.userId }).returning();
        await tx.insert(s.arpAgencies).values({ tenantId: auth.tenantId, arpId: a!.id, kind: 'gerenciador', name: managerName, document: managerDocument });
        await arpEvent(tx, auth, auth.tenantId, a!.id, 'cadastro', `Ata ${a!.number} cadastrada (gerenciador: ${managerName}).`);
        return a!;
      });
      await audit(app.db, req, { action: 'arp.create', entityType: 'arp', entityId: a.id });
      reply.code(201);
      return a;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/arps/:id',
    summary: 'Ficha da ata: órgãos, itens e saldos por item e órgão, alertas e regra aplicada',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const a = await loadArp(app.db, auth, params.id);
      const st = await arpState(app.db, a.id);
      const rules = await rulesFor(app.db, auth.tenantId, a.regime as ArpRegime);
      const iv = itemsView(st);
      const [owner] = await app.db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, a.ownerId)).limit(1);
      const contracts = await app.db.select({ id: s.contracts.id, stage: s.contracts.stage, number: s.contractVersions.number, monthlyCents: s.contractVersions.monthlyCents, totalCents: s.contractVersions.totalCents, contactId: s.contracts.contactId, opportunityId: s.contracts.opportunityId })
        .from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(and(eq(s.contracts.tenantId, auth.tenantId), eq(s.contracts.arpId, a.id)));
      return {
        ...a, ownerName: owner?.name ?? null,
        agencies: st.agencies,
        items: iv,
        totals: {
          registeredValueCents: iv.reduce((x, i) => x + i.registeredValueCents, 0),
          contractedValueCents: iv.reduce((x, i) => x + i.contractedValueCents, 0),
          availableValueCents: iv.reduce((x, i) => x + Math.max(0, i.availableValueCents), 0),
          reservedValueCents: iv.reduce((x, i) => x + lineValue(i.reservedMilli, i.unitCents), 0),
          adhesionValueCents: iv.reduce((x, i) => x + lineValue(i.adhesionAuthorizedMilli, i.unitCents), 0),
          movements: st.ledger.length,
        },
        alerts: await alertsOf(app.db, a, st),
        rules: { ...rules, caps: LEGAL_CAPS[a.regime as ArpRegime] },
        contracts,
        can: { manage: canManageArp(auth), effect: canEffectArp(auth) },
      };
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/arps/:id',
    summary: 'Atualiza a identificação e a situação da ata (vigente exige itens)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: ArpBody.omit({ managerName: true, managerDocument: true }).partial().extend({ status: z.enum(ARP_STATUSES).optional(), rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body, req }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      if (a.rowVersion !== body.rowVersion) throw unprocessable('A ata foi alterada por outra pessoa. Recarregue.');
      const { rowVersion: _rv, status, ...patch } = body;
      if (status && status !== a.status) {
        if (status === 'vigente') {
          const [n] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.arpItems).where(eq(s.arpItems.arpId, a.id));
          if (!n?.n) throw unprocessable('Cadastre ou importe os itens antes de tornar a ata vigente.');
          if (!(patch.endAt ?? a.endAt)) throw unprocessable('Informe o fim da vigência.');
        }
        if (a.status === 'encerrada' || a.status === 'cancelada') throw unprocessable('Ata encerrada ou cancelada não muda de situação.');
        if ((status === 'encerrada' || status === 'cancelada') && !canEffectArp(auth)) requireArp(auth, 'effect');
      }
      if (a.status !== 'rascunho' && (patch.regime && patch.regime !== a.regime)) throw unprocessable('O regime jurídico não muda depois que a ata está vigente.');
      await app.db.update(s.arps).set({ ...patch, ...(status ? { status } : {}), updatedAt: new Date(), rowVersion: sql`${s.arps.rowVersion} + 1` }).where(eq(s.arps.id, a.id));
      await arpEvent(app.db, auth, auth.tenantId, a.id, status && status !== a.status ? 'situacao' : 'edicao', status && status !== a.status ? `Situação: ${a.status} → ${status}.` : `Dados da ata atualizados: ${Object.keys(patch).join(', ')}.`, { patch, status });
      await audit(app.db, req, { action: 'arp.update', entityType: 'arp', entityId: a.id, metadata: { status } });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ órgãos
  defineRoute({
    method: 'POST',
    url: '/arps/:id/agencies',
    summary: 'Cadastra órgão participante ou não participante',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ kind: z.enum(AGENCY_KINDS).exclude(['gerenciador']), name: z.string().trim().min(2).max(200), document: z.string().trim().max(30).nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      if (body.kind === 'participante' && a.status !== 'rascunho') throw unprocessable('Participantes são definidos no registro; depois da vigência, novos órgãos entram como não participantes (adesão).');
      const [dup] = await app.db.select({ id: s.arpAgencies.id }).from(s.arpAgencies).where(and(eq(s.arpAgencies.arpId, a.id), sql`lower(${s.arpAgencies.name}) = lower(${body.name})`)).limit(1);
      if (dup) throw unprocessable('Órgão já cadastrado nesta ata.');
      const [g] = await app.db.insert(s.arpAgencies).values({ tenantId: auth.tenantId, arpId: a.id, ...body }).returning();
      await arpEvent(app.db, auth, auth.tenantId, a.id, 'orgao', `Órgão ${body.name} (${body.kind === 'participante' ? 'participante' : 'não participante'}) cadastrado.`);
      reply.code(201);
      return g;
    },
  }),

  // ------------------------------------------------------------------ itens
  defineRoute({
    method: 'POST',
    url: '/arps/:id/items',
    summary: 'Cadastra um item à mão (com distribuição opcional por órgão participante)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({
      itemNumber: z.string().trim().min(1).max(30), lot: z.string().trim().max(30).nullable().default(null), code: z.string().trim().max(60).nullable().default(null),
      description: z.string().trim().min(2).max(2000), specification: z.string().trim().max(4000).nullable().default(null), unit: z.string().trim().min(1).max(30),
      registeredMilli: z.number().int().positive(), unitCents: z.number().int().positive(), brandModel: z.string().trim().max(200).nullable().default(null), notes: z.string().trim().max(2000).nullable().default(null),
      allocations: z.array(z.object({ agencyId: z.string().uuid(), qtyMilli: z.number().int().positive() })).max(200).default([]),
    }),
    handler: async ({ app, auth, params, body, reply }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      if (a.status !== 'rascunho') throw unprocessable('Itens novos só com a ata em cadastro. Depois da vigência, o objeto registrado não muda.');
      const { allocations, ...item } = body;
      const it = await app.db.transaction(async (tx) => {
        const [dup] = await tx.select({ id: s.arpItems.id }).from(s.arpItems).where(and(eq(s.arpItems.arpId, a.id), sql`lower(coalesce(${s.arpItems.lot}, '')) = lower(${item.lot ?? ''})`, sql`lower(${s.arpItems.itemNumber}) = lower(${item.itemNumber})`)).limit(1);
        if (dup) throw unprocessable('Já existe item com este número (e lote).');
        const [it] = await tx.insert(s.arpItems).values({ ...item, tenantId: auth.tenantId, arpId: a.id }).returning();
        const ag = await tx.select().from(s.arpAgencies).where(eq(s.arpAgencies.arpId, a.id));
        if (allocations.reduce((x, l) => x + l.qtyMilli, 0) > item.registeredMilli) throw unprocessable('A distribuição passa da quantidade registrada.');
        for (const l of allocations) {
          if (ag.find((x) => x.id === l.agencyId)?.kind !== 'participante') throw unprocessable('Distribuição só para órgãos participantes.');
          await tx.insert(s.arpAllocations).values({ tenantId: auth.tenantId, arpId: a.id, itemId: it!.id, agencyId: l.agencyId, qtyMilli: l.qtyMilli });
        }
        await arpEvent(tx, auth, auth.tenantId, a.id, 'item', `Item ${item.lot ? `${item.lot}/` : ''}${item.itemNumber} cadastrado: ${fmtQty(item.registeredMilli)} ${item.unit} a ${(item.unitCents / 100).toFixed(2)}.`);
        return it!;
      });
      reply.code(201);
      return it;
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/arps/:id/items/:itemId',
    summary: 'Corrige dados cadastrais do item (com motivo). Quantidade e preço oficiais só mudam por operação formal.',
    tag: 'Atas',
    module: 'contratos',
    params: ItemParams,
    body: z.object({
      code: z.string().trim().max(60).nullable().optional(), description: z.string().trim().min(2).max(2000).optional(), specification: z.string().trim().max(4000).nullable().optional(),
      unit: z.string().trim().min(1).max(30).optional(), brandModel: z.string().trim().max(200).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional(),
      registeredMilli: z.number().int().positive().optional(), unitCents: z.number().int().positive().optional(),
      reason: z.string().trim().min(5, 'Explique o motivo da correção').max(1000),
    }),
    handler: async ({ app, auth, params, body }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const [it] = await tx.select().from(s.arpItems).where(and(eq(s.arpItems.id, params.itemId), eq(s.arpItems.arpId, a.id))).limit(1);
        if (!it) throw notFound('Item não encontrado.');
        const { reason, ...patch } = body;
        const official = (['registeredMilli', 'unitCents'] as const).filter((k) => patch[k] !== undefined && patch[k] !== it[k]);
        if (official.length) {
          const [mov] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.arpLedger).where(eq(s.arpLedger.itemId, it.id));
          if (a.status !== 'rascunho' || mov?.n) throw unprocessable('Quantidade e preço registrados não mudam por edição: use Conversões e remanejamentos (alteração de preço, cancelamento) com documento e aprovação.');
        }
        const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== undefined && patch[k] !== it[k]);
        if (!changed.length) return;
        await tx.update(s.arpItems).set({ ...patch, updatedAt: new Date() }).where(eq(s.arpItems.id, it.id));
        for (const k of changed) await tx.insert(s.arpItemChanges).values({ tenantId: auth.tenantId, itemId: it.id, field: k, fromValue: String(it[k] ?? ''), toValue: String(patch[k] ?? ''), reason, origin: 'cadastro', actorId: auth.userId });
        await arpEvent(tx, auth, auth.tenantId, a.id, 'item_correcao', `Item ${it.itemNumber}: ${changed.join(', ')} corrigido(s). Motivo: ${reason}`);
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/arps/:id/items/:itemId/changes',
    summary: 'Histórico de alterações do item',
    tag: 'Atas',
    module: 'contratos',
    params: ItemParams,
    handler: async ({ app, auth, params }) => {
      await loadArp(app.db, auth, params.id);
      return { items: await app.db.select({ c: s.arpItemChanges, who: s.users.name }).from(s.arpItemChanges).leftJoin(s.users, eq(s.users.id, s.arpItemChanges.actorId)).where(eq(s.arpItemChanges.itemId, params.itemId)).orderBy(desc(s.arpItemChanges.createdAt)).then((r) => r.map(({ c, who }) => ({ ...c, actorName: who }))) };
    },
  }),

  // ------------------------------------------------------------------ importação em massa
  defineRoute({
    method: 'POST',
    url: '/arps/:id/import',
    summary: 'Importa itens (linhas já mapeadas). Prévia valida e mostra o que entra, completa, corrige ou é bloqueado; aplicar grava tudo ou nada.',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    bodyLimit: 4_000_000,
    body: z.object({
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
      apply: z.boolean().default(false),
      authorizeCorrections: z.boolean().default(false),
      reason: z.string().trim().max(1000).default(''),
      fileName: z.string().trim().max(200).default('planilha'),
    }),
    handler: async ({ app, auth, params, body, req }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      const rows = body.rows.map((r) => {
        const o: Record<string, unknown> = {};
        const extra: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) (IMPORT_FIELDS as readonly string[]).includes(k) ? (o[k] = v) : k.startsWith('extra:') ? (extra[k.slice(6)] = v) : null;
        return { ...o, extra };
      });
      const { items, issues } = parseImportRows(rows as never);
      const run = async (tx: DbOrTx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        const existing = new Map(st.items.map((i) => [itemKey(i.lot, i.itemNumber), i]));
        const moved = new Set(st.ledger.map((l) => l.itemId));
        const agencies = new Map(st.agencies.map((g) => [g.name.trim().toLowerCase(), g]));
        const report = { created: [] as string[], completed: [] as string[], corrected: [] as string[], blocked: [] as { row: number; item: string; reason: string }[], unchanged: 0, allocations: 0, newAgencies: [] as string[] };
        const newItems = new Map<string, string>();
        for (const p of items) {
          const k = itemKey(p.lot, p.itemNumber);
          const label = `${p.lot ? `${p.lot}/` : ''}${p.itemNumber}`;
          let it = existing.get(k);
          let itemId = it?.id ?? newItems.get(k) ?? null;
          if (!it && !itemId) {
            if (a.status !== 'rascunho') { report.blocked.push({ row: p.row, item: label, reason: 'Ata vigente: item novo não pode ser incluído no registro.' }); continue; }
            if (body.apply) {
              const [n] = await tx.insert(s.arpItems).values({ tenantId: auth.tenantId, arpId: a.id, itemNumber: p.itemNumber, lot: p.lot, code: p.code, description: p.description, specification: p.specification, unit: p.unit, registeredMilli: p.registeredMilli, unitCents: p.unitCents, brandModel: p.brandModel, notes: p.notes, extra: p.extra }).returning({ id: s.arpItems.id });
              itemId = n!.id;
            } else itemId = `novo:${k}`;
            newItems.set(k, itemId);
            report.created.push(label);
          } else if (it) {
            // oficiais: quantidade e preço
            const officialDiff = (p.registeredMilli !== it.registeredMilli ? ['quantidade'] : []).concat(p.unitCents !== it.unitCents ? ['preço'] : []);
            if (officialDiff.length) {
              if (a.status !== 'rascunho' || moved.has(it.id)) { report.blocked.push({ row: p.row, item: label, reason: `${officialDiff.join(' e ')} diferente(s) do registrado: mudança oficial só por operação formal com documento.` }); continue; }
              if (!body.authorizeCorrections) { report.blocked.push({ row: p.row, item: label, reason: `${officialDiff.join(' e ')} diferente(s): marque "corrigir dados com autorização" e informe o motivo.` }); continue; }
            }
            // cadastrais: completa o vazio; muda o preenchido só com autorização
            const fields = ['code', 'specification', 'brandModel', 'notes', 'description', 'unit'] as const;
            const fill: Record<string, unknown> = {};
            const fix: Record<string, unknown> = {};
            for (const f of fields) {
              const v = p[f];
              if (v === null || v === undefined || v === '') continue;
              if (it[f] === null || it[f] === '') fill[f] = v;
              else if (String(it[f]) !== String(v)) fix[f] = v;
            }
            if (officialDiff.length) { fix.registeredMilli = p.registeredMilli; fix.unitCents = p.unitCents; }
            if (Object.keys(fix).length && !body.authorizeCorrections) { report.blocked.push({ row: p.row, item: label, reason: `Dados diferentes do cadastro (${Object.keys(fix).join(', ')}): exige autorização de correção.` }); }
            const apply = { ...fill, ...(body.authorizeCorrections ? fix : {}) };
            if (Object.keys(fill).length) report.completed.push(label);
            if (body.authorizeCorrections && Object.keys(fix).length) report.corrected.push(label);
            if (!Object.keys(apply).length && !p.agency) report.unchanged++;
            if (body.apply && Object.keys(apply).length) {
              if (Object.keys(fix).length && body.reason.trim().length < 5) throw unprocessable('Informe o motivo das correções autorizadas.', [{ path: 'reason', message: 'Obrigatório para corrigir' }]);
              await tx.update(s.arpItems).set({ ...apply, updatedAt: new Date() }).where(eq(s.arpItems.id, it.id));
              for (const [f, v] of Object.entries(apply)) await tx.insert(s.arpItemChanges).values({ tenantId: auth.tenantId, itemId: it.id, field: f, fromValue: String((it as Record<string, unknown>)[f] ?? ''), toValue: String(v ?? ''), reason: fill[f] !== undefined ? 'Complemento por importação' : body.reason, origin: 'importacao', actorId: auth.userId });
              it = { ...it, ...apply } as typeof it;
            }
            itemId = it.id;
          }
          // distribuição por órgão participante
          if (p.agency && p.agencyMilli) {
            let g = agencies.get(p.agency.trim().toLowerCase());
            if (g && g.kind === 'nao_participante') { report.blocked.push({ row: p.row, item: label, reason: `${p.agency} é não participante: quantidade de adesão entra pela aba Órgãos e adesões.` }); continue; }
            if (g?.kind === 'gerenciador') { continue; }
            if (!g) {
              if (a.status !== 'rascunho') { report.blocked.push({ row: p.row, item: label, reason: `Órgão ${p.agency} não é participante desta ata.` }); continue; }
              if (body.apply) {
                const [ng] = await tx.insert(s.arpAgencies).values({ tenantId: auth.tenantId, arpId: a.id, kind: 'participante', name: p.agency.trim() }).returning();
                g = ng!;
              } else g = { id: `novo:${p.agency}`, kind: 'participante', name: p.agency } as unknown as (typeof st.agencies)[number];
              agencies.set(p.agency.trim().toLowerCase(), g!);
              report.newAgencies.push(p.agency.trim());
            }
            const prev = st.allocations.find((x) => x.itemId === itemId && x.agencyId === g!.id);
            if (prev && prev.qtyMilli !== p.agencyMilli) {
              if (a.status !== 'rascunho' || (itemId && moved.has(itemId))) { report.blocked.push({ row: p.row, item: label, reason: `Distribuição de ${p.agency} diferente da registrada: use remanejamento.` }); continue; }
            }
            if (body.apply && itemId && !itemId.startsWith('novo:')) {
              await tx.insert(s.arpAllocations).values({ tenantId: auth.tenantId, arpId: a.id, itemId, agencyId: g!.id, qtyMilli: p.agencyMilli }).onConflictDoUpdate({ target: [s.arpAllocations.itemId, s.arpAllocations.agencyId], set: { qtyMilli: p.agencyMilli } });
            }
            report.allocations++;
          }
        }
        if (body.apply) {
          // distribuição não pode passar do registrado
          const after = await arpState(tx, a.id);
          for (const i of after.items) {
            const dist = after.allocations.filter((x) => x.itemId === i.id).reduce((x, l) => x + l.qtyMilli, 0);
            if (dist > i.registeredMilli) throw unprocessable(`Item ${i.itemNumber}: a distribuição entre órgãos (${fmtQty(dist)}) passa da quantidade registrada (${fmtQty(i.registeredMilli)}).`);
          }
          await arpEvent(tx, auth, auth.tenantId, a.id, 'importacao', `Importação de ${body.fileName}: ${report.created.length} novo(s), ${report.completed.length} completado(s), ${report.corrected.length} corrigido(s), ${report.blocked.length} bloqueado(s), ${report.allocations} distribuição(ões).`, { report, issues: issues.length });
        }
        return report;
      };
      const report = body.apply ? await app.db.transaction(run) : await app.db.transaction(async (tx) => { const r = await run(tx); return r; });
      if (body.apply) await audit(app.db, req, { action: 'arp.import', entityType: 'arp', entityId: a.id, metadata: { created: report.created.length, blocked: report.blocked.length } });
      return { applied: body.apply, valid: items.length, issues, report };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/arp-import-mappings',
    summary: 'Modelos de mapeamento de colunas salvos',
    tag: 'Atas',
    module: 'contratos',
    handler: async ({ app, auth }) => ({ items: await app.db.select().from(s.arpImportMappings).where(eq(s.arpImportMappings.tenantId, auth.tenantId)).orderBy(asc(s.arpImportMappings.name)) }),
  }),
  defineRoute({
    method: 'POST',
    url: '/arp-import-mappings',
    summary: 'Salva um modelo de mapeamento (coluna do arquivo → campo)',
    tag: 'Atas',
    module: 'contratos',
    body: z.object({ name: z.string().trim().min(2).max(80), mapping: z.record(z.string().max(200), z.string().max(80)) }),
    handler: async ({ app, auth, body, reply }) => {
      requireArp(auth, 'manage');
      const [m] = await app.db.insert(s.arpImportMappings).values({ tenantId: auth.tenantId, name: body.name, mapping: body.mapping, createdBy: auth.userId }).returning();
      reply.code(201);
      return m;
    },
  }),

  // ------------------------------------------------------------------ documentos
  defineRoute({
    method: 'POST',
    url: '/arps/:id/documents',
    summary: 'Anexa documento à ata (ata, edital, adesão, autorização, empenho, contrato, parecer...)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    bodyLimit: 4_500_000,
    body: z.object({ category: z.enum(DOC_CATEGORIES), name: z.string().trim().min(1).max(200), mime: z.string().max(120), data: z.string().min(10).max(4_400_000), adhesionId: z.string().uuid().nullable().default(null), operationId: z.string().uuid().nullable().default(null), opportunityId: z.string().uuid().nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      const data = Buffer.from(body.data, 'base64');
      if (data.length > 3_300_000) throw unprocessable('Arquivo maior que 3 MB.');
      const [d] = await app.db.insert(s.arpDocuments).values({ tenantId: auth.tenantId, arpId: a.id, category: body.category, name: body.name, mime: body.mime, sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), data, adhesionId: body.adhesionId, operationId: body.operationId, opportunityId: body.opportunityId, uploadedBy: auth.userId })
        .returning({ id: s.arpDocuments.id, name: s.arpDocuments.name, category: s.arpDocuments.category, createdAt: s.arpDocuments.createdAt });
      await arpEvent(app.db, auth, auth.tenantId, a.id, 'documento', `Documento anexado: ${body.name} (${body.category}).`, { documentId: d!.id });
      reply.code(201);
      return d;
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/arps/:id/documents',
    summary: 'Documentos da ata',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await loadArp(app.db, auth, params.id);
      return { items: await app.db.select({ id: s.arpDocuments.id, category: s.arpDocuments.category, name: s.arpDocuments.name, sizeBytes: s.arpDocuments.sizeBytes, adhesionId: s.arpDocuments.adhesionId, operationId: s.arpDocuments.operationId, opportunityId: s.arpDocuments.opportunityId, createdAt: s.arpDocuments.createdAt, uploadedBy: s.users.name }).from(s.arpDocuments).leftJoin(s.users, eq(s.users.id, s.arpDocuments.uploadedBy)).where(eq(s.arpDocuments.arpId, params.id)).orderBy(desc(s.arpDocuments.createdAt)) };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/arps/:id/documents/:docId',
    summary: 'Baixa documento da ata',
    tag: 'Atas',
    module: 'contratos',
    params: z.object({ id: z.string().uuid(), docId: z.string().uuid() }),
    handler: async ({ app, auth, params, reply }) => {
      await loadArp(app.db, auth, params.id);
      const [d] = await app.db.select().from(s.arpDocuments).where(and(eq(s.arpDocuments.id, params.docId), eq(s.arpDocuments.arpId, params.id))).limit(1);
      if (!d) throw notFound('Documento não encontrado.');
      reply.header('content-type', d.mime).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`).header('x-content-type-options', 'nosniff');
      return reply.send(d.data);
    },
  }),

  // ------------------------------------------------------------------ histórico
  defineRoute({
    method: 'GET',
    url: '/arps/:id/events',
    summary: 'Histórico da ata',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await loadArp(app.db, auth, params.id);
      return { items: (await app.db.select({ e: s.arpEvents, who: s.users.name }).from(s.arpEvents).leftJoin(s.users, eq(s.users.id, s.arpEvents.actorId)).where(eq(s.arpEvents.arpId, params.id)).orderBy(desc(s.arpEvents.occurredAt)).limit(500)).map(({ e, who }) => ({ ...e, actorName: who })) };
    },
  }),

  // ------------------------------------------------------------------ regras legais versionadas
  defineRoute({
    method: 'GET',
    url: '/arp-rules',
    summary: 'Regras aplicadas por regime (versão vigente), tetos legais e histórico de versões',
    tag: 'Atas',
    module: 'contratos',
    handler: async ({ app, auth }) => {
      const current = [];
      for (const r of ARP_REGIMES) current.push({ regime: r, ...(await rulesFor(app.db, auth.tenantId, r)), caps: LEGAL_CAPS[r] });
      const history = await app.db.select({ r: s.arpRuleSets, who: s.users.name }).from(s.arpRuleSets).leftJoin(s.users, eq(s.users.id, s.arpRuleSets.createdBy)).where(eq(s.arpRuleSets.tenantId, auth.tenantId)).orderBy(desc(s.arpRuleSets.createdAt));
      return { current, history: history.map(({ r, who }) => ({ ...r, createdByName: who })), canEdit: canEffectArp(auth) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/arp-rules',
    summary: 'Nova versão das regras de um regime (nunca acima dos tetos legais; decisões antigas mantêm a versão delas)',
    tag: 'Atas',
    module: 'contratos',
    body: z.object({
      regime: z.enum(ARP_REGIMES),
      rules: z.object({ adhesionPerAgencyBp: z.number().int().min(0).max(10_000), adhesionTotalBp: z.number().int().min(0).max(40_000), contractDeadlineDays: z.number().int().min(1).max(365), allowAdhesion: z.boolean(), remanejamentoNeedsManager: z.boolean(), allowConversion: z.boolean(), legalBasis: z.string().trim().min(5).max(2000) }),
      note: z.string().trim().min(5, 'Explique a mudança').max(1000),
    }),
    handler: async ({ app, auth, body, req, reply }) => {
      requireArp(auth, 'effect');
      const errs = validateRules(body.regime, body.rules as ArpRules);
      if (errs.length) throw unprocessable(errs.join(' '), [{ path: 'rules', message: 'Acima do teto legal' }]);
      const cur = await rulesFor(app.db, auth.tenantId, body.regime);
      const [r] = await app.db.insert(s.arpRuleSets).values({ tenantId: auth.tenantId, regime: body.regime, version: cur.version + 1, rules: body.rules, note: body.note, createdBy: auth.userId }).returning();
      await audit(app.db, req, { action: 'arp.rules', entityType: 'tenant', entityId: auth.tenantId, metadata: { regime: body.regime, version: r!.version } });
      reply.code(201);
      return r;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/arps/import-template.csv',
    summary: 'Modelo de planilha para importar itens',
    tag: 'Atas',
    module: 'contratos',
    handler: async ({ reply }) => {
      const head = 'Lote;Item;Código;Descrição;Especificação;Unidade;Quantidade registrada;Valor unitário;Valor total;Órgão participante;Quantitativo do órgão;Marca/modelo;Observações';
      const ex = [
        '1;1;123456;Link dedicado de internet 100 Mbps;Fibra óptica, SLA 99,5%;mês;120;1.500,00;180.000,00;;;;',
        '1;1;123456;Link dedicado de internet 100 Mbps;Fibra óptica, SLA 99,5%;mês;120;1.500,00;180.000,00;Secretaria de Saúde;36;;',
        '1;2;654321;Instalação de ponto de acesso;Inclui cabeamento até 100 m;un;40;800,00;32.000,00;;;Marca X / Modelo Y;',
      ];
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="modelo-itens-ata.csv"');
      return `﻿${[head, ...ex].join('\r\n')}\r\n`;
    },
  }),
];
