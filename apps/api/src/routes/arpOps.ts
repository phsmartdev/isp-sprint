/** Atas: oportunidades vinculadas, formalização (consumo), adesões, operações entre itens, livro de movimentações, relatórios e inteligência. */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ARP_LEDGER_KINDS, ARP_LEDGER_LABELS, OPERATION_KINDS, OPERATION_LABELS, checkAdhesion, fmtQty, lineValue, simulateOperation,
  type AgencyKind, type ArpRegime, type ArpStatus, type OperationInput,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import { audit } from '../services/audit';
import { createOpportunity, loadOpportunity } from '../services/opportunities';
import { releaseOpportunity } from '../services/arpOpportunity';
import { addDaysIso, agencyContact, arpEvent, arpState, canEffectArp, checkAvailable, isJuridico, loadArp, lockArp, requireArp, reserveAdhesionForOpportunity, rulesFor, todayIso, writeLedger, type ArpState } from '../services/arp';

const Line = z.object({ itemId: z.string().uuid(), agencyId: z.string().uuid(), qtyMilli: z.number().int().positive() });
const OpLine = z.object({ itemId: z.string().uuid(), agencyId: z.string().uuid(), qtyMilli: z.number().int().min(0) });
const OpInput = z.object({
  kind: z.enum(OPERATION_KINDS),
  sources: z.array(OpLine).max(100).default([]),
  targets: z.array(OpLine).max(100).default([]),
  newUnitCents: z.number().int().positive().nullable().default(null),
  correctsEntryId: z.string().uuid().nullable().default(null),
  correctedQtyMilli: z.number().int().min(0).nullable().default(null),
});
const Exception = z.object({ basis: z.string().trim().min(10, 'Informe o fundamento legal').max(2000), documentId: z.string().uuid() }).nullable().default(null);
const FORMAL_DOCS = ['empenho', 'contrato', 'ordem_servico'];

function requireStatus(status: string, allowed: ArpStatus[], what: string) {
  if (!allowed.includes(status as ArpStatus)) throw unprocessable(`${what} só com a ata ${allowed.map((x) => (x === 'vigente' ? 'vigente' : x)).join(' ou ')}.`);
}
async function docOf(db: DbOrTx, arpId: string, docId: string | null | undefined, categories?: string[]) {
  if (!docId) return null;
  const [d] = await db.select({ id: s.arpDocuments.id, category: s.arpDocuments.category, name: s.arpDocuments.name }).from(s.arpDocuments).where(and(eq(s.arpDocuments.id, docId), eq(s.arpDocuments.arpId, arpId))).limit(1);
  if (!d) throw unprocessable('Documento não encontrado nesta ata. Anexe em Documentos primeiro.', [{ path: 'documentId', message: 'Documento inválido' }]);
  if (categories && !categories.includes(d.category)) throw unprocessable(`O documento precisa ser do tipo ${categories.join(', ')}.`, [{ path: 'documentId', message: 'Tipo de documento' }]);
  return d;
}
const opView = (o: typeof s.arpOperations.$inferSelect) => ({ ...o, label: OPERATION_LABELS[o.kind as keyof typeof OPERATION_LABELS] ?? o.kind });

export const arpOpsRoutes = [
  // ------------------------------------------------------------------ oportunidades vinculadas
  defineRoute({
    method: 'GET',
    url: '/arps/:id/opportunities',
    summary: 'Oportunidades vinculadas à ata, com itens, quantidades, valores e situação da contratação',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const a = await loadArp(app.db, auth, params.id);
      const opps = await app.db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, ownerName: s.users.name, contactName: s.contacts.name, createdAt: s.opportunities.createdAt, wonAt: s.opportunities.wonAt })
        .from(s.opportunities).innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId)).innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
        .where(and(eq(s.opportunities.arpId, a.id), sql`${s.opportunities.deletedAt} is null`)).orderBy(desc(s.opportunities.createdAt));
      const lines = opps.length ? await app.db.select().from(s.arpOpportunityLines).where(inArray(s.arpOpportunityLines.opportunityId, opps.map((o) => o.id))) : [];
      const consumed = opps.length ? await app.db.select({ opportunityId: s.arpLedger.opportunityId, kind: s.arpLedger.kind, q: sql<number>`sum(${s.arpLedger.qtyMilli})::bigint`, v: sql<number>`sum(${s.arpLedger.amountCents})::bigint` }).from(s.arpLedger).where(and(eq(s.arpLedger.arpId, a.id), inArray(s.arpLedger.opportunityId, opps.map((o) => o.id)), inArray(s.arpLedger.kind, ['consumo', 'estorno']))).groupBy(s.arpLedger.opportunityId, s.arpLedger.kind) : [];
      const contracts = opps.length ? await app.db.select({ id: s.contracts.id, opportunityId: s.contracts.opportunityId }).from(s.contracts).where(inArray(s.contracts.opportunityId, opps.map((o) => o.id))) : [];
      return {
        items: opps.map((o) => {
          const ls = lines.filter((l) => l.opportunityId === o.id);
          const c = consumed.filter((x) => x.opportunityId === o.id);
          const contractedCents = c.reduce((x, r) => x + (r.kind === 'consumo' ? Number(r.v) : -Number(r.v)), 0);
          return {
            ...o, lines: ls.map((l) => ({ ...l, valueCents: lineValue(l.qtyMilli, l.unitCents) })), valueCents: ls.reduce((x, l) => x + lineValue(l.qtyMilli, l.unitCents), 0),
            contractedCents, contractId: contracts.find((k) => k.opportunityId === o.id)?.id ?? null,
            situation: contractedCents > 0 ? 'formalizada' : o.stage === 'ganha' ? 'aguardando_formalizacao' : o.stage === 'perdida' ? 'perdida' : 'em_andamento',
          };
        }),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arps/:id/opportunities',
    summary: 'Cria oportunidade a partir da ata (itens, quantidades e órgão) e reserva o saldo. Não gera negócio no Sucesso do Cliente.',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ agencyId: z.string().uuid(), lines: z.array(z.object({ itemId: z.string().uuid(), qtyMilli: z.number().int().positive() })).min(1).max(200), title: z.string().trim().max(200).nullable().default(null), ownerId: z.string().uuid().nullable().default(null), adhesionId: z.string().uuid().nullable().default(null) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      requireArp(auth, 'manage');
      if (auth.access.oportunidades === 'nenhum') throw forbidden('Seu perfil não cria oportunidades.');
      const a = await loadArp(app.db, auth, params.id);
      requireStatus(a.status, ['vigente'], 'Oportunidades');
      const out = await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        const ag = st.agencies.find((x) => x.id === body.agencyId);
        if (!ag) throw unprocessable('Órgão não cadastrado nesta ata.');
        if (ag.kind === 'nao_participante') {
          const [adh] = await tx.select({ id: s.arpAdhesions.id }).from(s.arpAdhesions).where(and(eq(s.arpAdhesions.arpId, a.id), eq(s.arpAdhesions.agencyId, ag.id), eq(s.arpAdhesions.status, 'autorizada'))).limit(1);
          if (!adh) throw unprocessable('Órgão não participante só contrata com adesão autorizada.');
        }
        const lines = body.lines.map((l) => ({ ...l, agencyId: ag.id }));
        checkAvailable(st, lines);
        const contactId = await agencyContact(tx, auth, ag);
        const total = lines.reduce((x, l) => x + lineValue(l.qtyMilli, st.items.find((i) => i.id === l.itemId)!.unitCents), 0);
        const opp = await createOpportunity(tx, auth, req, { contactId, channel: 'Ata de registro de preços', reasons: [], title: body.title ?? `Ata ${a.number} — ${ag.name}`, ownerId: body.ownerId, notes: `Itens da ata ${a.number}: ${lines.map((l) => { const it = st.items.find((i) => i.id === l.itemId)!; return `${it.itemNumber} (${fmtQty(l.qtyMilli)} ${it.unit})`; }).join('; ')}. Valor total: ${(total / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` } as never, { trustedContact: true, arpId: a.id });
        for (const l of lines) await tx.insert(s.arpOpportunityLines).values({ tenantId: auth.tenantId, arpId: a.id, opportunityId: opp.id, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli, unitCents: st.items.find((i) => i.id === l.itemId)!.unitCents });
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        await writeLedger(tx, auth, a.id, st, lines.map((l) => ({ kind: 'reserva' as const, ...l })), { origin: 'oportunidade', opportunityId: opp.id, adhesionId: body.adhesionId, justification: 'Reserva da oportunidade', ruleVersion: rule.version, idem: `reserva:${opp.id}:inicial` });
        if (body.adhesionId) await tx.update(s.arpAdhesions).set({ opportunityId: opp.id, updatedAt: new Date() }).where(and(eq(s.arpAdhesions.id, body.adhesionId), eq(s.arpAdhesions.arpId, a.id)));
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'ata_vinculada', actorId: auth.userId, payload: { arpId: a.id, number: a.number, lines: lines.length } });
        await arpEvent(tx, auth, auth.tenantId, a.id, 'oportunidade', `Oportunidade OP-${opp.code} criada para ${ag.name} com ${lines.length} item(ns) reservados.`, { opportunityId: opp.id });
        return opp;
      });
      reply.code(201);
      return { id: out.id, code: out.code };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arps/:id/opportunities/link',
    summary: 'Vincula uma oportunidade existente à ata (itens e reservas)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ opportunityId: z.string().uuid(), agencyId: z.string().uuid(), lines: z.array(z.object({ itemId: z.string().uuid(), qtyMilli: z.number().int().positive() })).min(1).max(200) }),
    handler: async ({ app, auth, params, body }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      requireStatus(a.status, ['vigente'], 'Vínculo de oportunidades');
      const o = await loadOpportunity(app.db, auth, body.opportunityId);
      if (o.arpId && o.arpId !== a.id) throw unprocessable('Esta oportunidade já está vinculada a outra ata.');
      if (o.stage === 'perdida') throw unprocessable('Oportunidade perdida não reserva saldo.');
      await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        if (!st.agencies.some((g) => g.id === body.agencyId)) throw unprocessable('Órgão não cadastrado nesta ata.');
        const [existing] = await tx.select({ id: s.arpOpportunityLines.id }).from(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, o.id), eq(s.arpOpportunityLines.status, 'reservada'))).limit(1);
        if (existing) throw unprocessable('A oportunidade já tem itens reservados; ajuste as quantidades na ficha.');
        const lines = body.lines.map((l) => ({ ...l, agencyId: body.agencyId }));
        checkAvailable(st, lines);
        await tx.update(s.opportunities).set({ arpId: a.id, updatedAt: new Date() }).where(eq(s.opportunities.id, o.id));
        for (const l of lines) await tx.insert(s.arpOpportunityLines).values({ tenantId: auth.tenantId, arpId: a.id, opportunityId: o.id, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli, unitCents: st.items.find((i) => i.id === l.itemId)!.unitCents }).onConflictDoUpdate({ target: [s.arpOpportunityLines.opportunityId, s.arpOpportunityLines.itemId, s.arpOpportunityLines.agencyId], set: { qtyMilli: l.qtyMilli, status: 'reservada', updatedAt: new Date() } });
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        await writeLedger(tx, auth, a.id, st, lines.map((l) => ({ kind: 'reserva' as const, ...l })), { origin: 'oportunidade', opportunityId: o.id, justification: 'Oportunidade vinculada à ata', ruleVersion: rule.version, idem: `reserva:${o.id}:vinculo:${Date.now()}` });
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'ata_vinculada', actorId: auth.userId, payload: { arpId: a.id, number: a.number } });
        await arpEvent(tx, auth, auth.tenantId, a.id, 'oportunidade', `OP-${o.code} vinculada à ata.`, { opportunityId: o.id });
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/arps/:id/opportunities/:oppId/lines',
    summary: 'Ajusta itens e quantidades reservadas da oportunidade (libera o anterior e reserva o novo, na mesma transação)',
    tag: 'Atas',
    module: 'contratos',
    params: z.object({ id: z.string().uuid(), oppId: z.string().uuid() }),
    body: z.object({ lines: z.array(Line).max(200) }),
    handler: async ({ app, auth, params, body }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      requireStatus(a.status, ['vigente'], 'Reservas');
      const o = await loadOpportunity(app.db, auth, params.oppId);
      if (o.arpId !== a.id) throw notFound('Oportunidade não vinculada a esta ata.');
      if (o.stage === 'perdida') throw unprocessable('Oportunidade perdida não reserva saldo.');
      await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        const cur = await tx.select().from(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, o.id), eq(s.arpOpportunityLines.status, 'reservada')));
        const release = new Map<string, number>();
        for (const l of cur) release.set(`${l.itemId}|${l.agencyId}`, (release.get(`${l.itemId}|${l.agencyId}`) ?? 0) + l.qtyMilli);
        checkAvailable(st, body.lines, release);
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        const stamp = Date.now();
        await writeLedger(tx, auth, a.id, st, cur.map((l) => ({ kind: 'liberacao' as const, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli })), { origin: 'oportunidade', opportunityId: o.id, justification: 'Ajuste das quantidades', ruleVersion: rule.version, idem: `ajuste-libera:${o.id}:${stamp}` });
        await writeLedger(tx, auth, a.id, st, body.lines.map((l) => ({ kind: 'reserva' as const, ...l })), { origin: 'oportunidade', opportunityId: o.id, justification: 'Ajuste das quantidades', ruleVersion: rule.version, idem: `ajuste-reserva:${o.id}:${stamp}` });
        await tx.delete(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, o.id), eq(s.arpOpportunityLines.status, 'reservada')));
        for (const l of body.lines) await tx.insert(s.arpOpportunityLines).values({ tenantId: auth.tenantId, arpId: a.id, opportunityId: o.id, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli, unitCents: st.items.find((i) => i.id === l.itemId)!.unitCents }).onConflictDoUpdate({ target: [s.arpOpportunityLines.opportunityId, s.arpOpportunityLines.itemId, s.arpOpportunityLines.agencyId], set: { qtyMilli: l.qtyMilli, status: 'reservada', updatedAt: new Date() } });
        await arpEvent(tx, auth, auth.tenantId, a.id, 'reserva_ajustada', `Reservas da OP-${o.code} ajustadas.`, { opportunityId: o.id });
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arps/:id/opportunities/:oppId/release',
    summary: 'Libera as reservas da oportunidade',
    tag: 'Atas',
    module: 'contratos',
    params: z.object({ id: z.string().uuid(), oppId: z.string().uuid() }),
    body: z.object({ reason: z.string().trim().min(5).max(500) }),
    handler: async ({ app, auth, params, body }) => {
      requireArp(auth, 'manage');
      await loadArp(app.db, auth, params.id);
      await loadOpportunity(app.db, auth, params.oppId);
      return { released: await app.db.transaction((tx) => releaseOpportunity(tx, auth, params.oppId, body.reason)) };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arps/:id/formalize',
    summary: 'Formaliza a contratação (empenho, contrato ou ordem de serviço): converte a reserva em consumo confirmado. Idempotente.',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ opportunityId: z.string().uuid(), documentId: z.string().uuid(), contractId: z.string().uuid().nullable().default(null), lines: z.array(Line).max(200).optional(), note: z.string().trim().max(1000).default('') }),
    handler: async ({ app, auth, params, body, req }) => {
      requireArp(auth, 'effect');
      const a = await loadArp(app.db, auth, params.id);
      requireStatus(a.status, ['vigente'], 'Formalização');
      const doc = await docOf(app.db, a.id, body.documentId, FORMAL_DOCS);
      const [o] = await app.db.select().from(s.opportunities).where(and(eq(s.opportunities.id, body.opportunityId), eq(s.opportunities.tenantId, auth.tenantId))).limit(1);
      if (!o || o.arpId !== a.id) throw notFound('Oportunidade não vinculada a esta ata.');
      if (o.stage !== 'ganha') throw unprocessable('Formalize depois que a oportunidade estiver como venda fechada.');
      if (body.contractId) {
        const [c] = await app.db.select({ id: s.contracts.id, arpId: s.contracts.arpId }).from(s.contracts).where(and(eq(s.contracts.id, body.contractId), eq(s.contracts.tenantId, auth.tenantId))).limit(1);
        if (!c) throw unprocessable('Contrato não encontrado.');
        if (c.arpId && c.arpId !== a.id) throw unprocessable('O contrato pertence a outra ata.');
      }
      const result = await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        const idem = `formaliza:${o.id}:${doc!.id}`;
        const [already] = await tx.select({ id: s.arpLedger.id }).from(s.arpLedger).where(and(eq(s.arpLedger.tenantId, auth.tenantId), sql`${s.arpLedger.idempotencyKey} like ${`${idem}:%`}`)).limit(1);
        if (already) return { duplicate: true, consumed: 0 };
        const reserved = await tx.select().from(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, o.id), eq(s.arpOpportunityLines.status, 'reservada')));
        const lines = body.lines?.length ? body.lines : reserved.map((l) => ({ itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli }));
        if (!lines.length) throw unprocessable('Nada a formalizar: a oportunidade não tem itens reservados.');
        // a parte reservada desta oportunidade volta ao disponível antes de consumir
        const release = new Map<string, number>();
        for (const l of reserved) release.set(`${l.itemId}|${l.agencyId}`, (release.get(`${l.itemId}|${l.agencyId}`) ?? 0) + l.qtyMilli);
        checkAvailable(st, lines, release);
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        const liberar = reserved.map((l) => {
          const used = lines.filter((x) => x.itemId === l.itemId && x.agencyId === l.agencyId).reduce((q, x) => q + x.qtyMilli, 0);
          return { kind: 'liberacao' as const, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: Math.min(l.qtyMilli, used) };
        }).filter((x) => x.qtyMilli > 0);
        const meta = { origin: 'formalizacao' as const, opportunityId: o.id, contractId: body.contractId, documentId: doc!.id, justification: body.note || `Formalização: ${doc!.name}`, ruleVersion: rule.version, idem };
        await writeLedger(tx, auth, a.id, st, [...liberar, ...lines.map((l) => ({ kind: 'consumo' as const, ...l }))], meta);
        for (const l of reserved) {
          const used = lines.filter((x) => x.itemId === l.itemId && x.agencyId === l.agencyId).reduce((q, x) => q + x.qtyMilli, 0);
          if (used >= l.qtyMilli) await tx.update(s.arpOpportunityLines).set({ status: 'formalizada', updatedAt: new Date() }).where(eq(s.arpOpportunityLines.id, l.id));
          else if (used > 0) await tx.update(s.arpOpportunityLines).set({ qtyMilli: l.qtyMilli - used, updatedAt: new Date() }).where(eq(s.arpOpportunityLines.id, l.id));
        }
        if (body.contractId) await tx.update(s.contracts).set({ arpId: a.id }).where(eq(s.contracts.id, body.contractId));
        // adesão contratada
        const agencyIds = [...new Set(lines.map((l) => l.agencyId))];
        await tx.update(s.arpAdhesions).set({ status: 'contratada', contractId: body.contractId, updatedAt: new Date() }).where(and(eq(s.arpAdhesions.arpId, a.id), inArray(s.arpAdhesions.agencyId, agencyIds), eq(s.arpAdhesions.status, 'autorizada')));
        const value = lines.reduce((x, l) => x + lineValue(l.qtyMilli, st.items.find((i) => i.id === l.itemId)!.unitCents), 0);
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'ata_consumo', actorId: auth.userId, payload: { arpId: a.id, documentId: doc!.id, valueCents: value, contractId: body.contractId } });
        await arpEvent(tx, auth, auth.tenantId, a.id, 'consumo', `Contratação formalizada (OP-${o.code}, ${doc!.name}): ${lines.length} item(ns), ${(value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`, { opportunityId: o.id, documentId: doc!.id });
        return { duplicate: false, consumed: lines.length, valueCents: value };
      });
      await audit(app.db, req, { action: 'arp.formalize', entityType: 'arp', entityId: a.id, metadata: { opportunityId: o.id, ...result } });
      return result;
    },
  }),

  // ------------------------------------------------------------------ livro de movimentações
  defineRoute({
    method: 'GET',
    url: '/arps/:id/ledger',
    summary: 'Livro de movimentações da ata (filtros por tipo, item, órgão e oportunidade)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    query: z.object({ kind: z.enum(ARP_LEDGER_KINDS).optional(), itemId: z.string().uuid().optional(), agencyId: z.string().uuid().optional(), opportunityId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, query }) => {
      const a = await loadArp(app.db, auth, params.id);
      const rows = await ledgerRows(app.db, auth.tenantId, { arpId: a.id, ...query });
      return { items: rows };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/arps/:id/ledger/execution',
    summary: 'Registra execução ou faturamento de quantidade contratada (não muda o saldo disponível)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ kind: z.enum(['execucao', 'faturamento']), itemId: z.string().uuid(), agencyId: z.string().uuid(), qtyMilli: z.number().int().positive(), documentId: z.string().uuid().nullable().default(null), contractId: z.string().uuid().nullable().default(null), justification: z.string().trim().min(3).max(1000), requestId: z.string().max(80) }),
    handler: async ({ app, auth, params, body }) => {
      requireArp(auth, 'effect');
      const a = await loadArp(app.db, auth, params.id);
      await docOf(app.db, a.id, body.documentId);
      return app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        const b = st.balances.byItemAgency.get(`${body.itemId}|${body.agencyId}`);
        const limit = body.kind === 'execucao' ? (b?.contracted ?? 0) - (b?.executed ?? 0) : (b?.executed ?? 0) - (b?.billed ?? 0);
        if (body.qtyMilli > limit) throw unprocessable(body.kind === 'execucao' ? `Execução maior que o contratado ainda não executado (${fmtQty(Math.max(0, limit))}).` : `Faturamento maior que o executado ainda não faturado (${fmtQty(Math.max(0, limit))}).`);
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        const n = await writeLedger(tx, auth, a.id, st, [{ kind: body.kind, itemId: body.itemId, agencyId: body.agencyId, qtyMilli: body.qtyMilli }], { origin: 'manual', contractId: body.contractId, documentId: body.documentId, justification: body.justification, ruleVersion: rule.version, idem: `${body.kind}:${body.requestId}` });
        if (n) await arpEvent(tx, auth, auth.tenantId, a.id, body.kind, `${body.kind === 'execucao' ? 'Execução' : 'Faturamento'} registrada: ${fmtQty(body.qtyMilli)} do item ${st.items.find((i) => i.id === body.itemId)?.itemNumber}.`);
        return { written: n };
      });
    },
  }),

  // ------------------------------------------------------------------ órgãos e adesões
  defineRoute({
    method: 'GET',
    url: '/arps/:id/adhesions',
    summary: 'Adesões com itens, limites (por órgão e total) e situação',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const a = await loadArp(app.db, auth, params.id);
      const st = await arpState(app.db, a.id);
      const rule = await rulesFor(app.db, auth.tenantId, a.regime as ArpRegime);
      const rows = await app.db.select().from(s.arpAdhesions).where(eq(s.arpAdhesions.arpId, a.id)).orderBy(desc(s.arpAdhesions.createdAt));
      const registered = new Map(st.items.map((i) => [i.id, i.registeredMilli]));
      return {
        rules: rule,
        items: rows.map((r) => {
          const ctx = adhesionCtx(st, r.agencyId, r.id, rows);
          return { ...r, agencyName: st.agencies.find((g) => g.id === r.agencyId)?.name ?? '', check: checkAdhesion(rule.rules, r.items, { registered, ...ctx }) };
        }),
        limits: st.items.map((i) => {
          const tot = Math.floor((i.registeredMilli * rule.rules.adhesionTotalBp) / 10_000);
          const used = st.balances.byItem.get(i.id)!.adhesionAuthorized;
          return { itemId: i.id, itemNumber: i.itemNumber, description: i.description, unit: i.unit, registeredMilli: i.registeredMilli, perAgencyLimitMilli: Math.floor((i.registeredMilli * rule.rules.adhesionPerAgencyBp) / 10_000), totalLimitMilli: tot, usedMilli: used, availableMilli: Math.max(0, tot - used) };
        }),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arps/:id/adhesions',
    summary: 'Registra pedido de adesão de órgão não participante (verifica limites na hora)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ agencyId: z.string().uuid().nullable().default(null), newAgency: z.object({ name: z.string().trim().min(2).max(200), document: z.string().trim().max(30).nullable().default(null) }).nullable().default(null), requestedAt: z.string().date(), justification: z.string().trim().min(10).max(2000), items: z.array(z.object({ itemId: z.string().uuid(), qtyMilli: z.number().int().positive() })).min(1).max(200) }),
    handler: async ({ app, auth, params, body, reply }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      requireStatus(a.status, ['vigente'], 'Adesões');
      const out = await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        let agencyId = body.agencyId;
        if (!agencyId) {
          if (!body.newAgency) throw unprocessable('Informe o órgão solicitante.');
          const ex = st.agencies.find((g) => g.name.trim().toLowerCase() === body.newAgency!.name.trim().toLowerCase());
          if (ex) agencyId = ex.id;
          else agencyId = (await tx.insert(s.arpAgencies).values({ tenantId: auth.tenantId, arpId: a.id, kind: 'nao_participante', name: body.newAgency.name, document: body.newAgency.document }).returning())[0]!.id;
        }
        const ag = (await tx.select().from(s.arpAgencies).where(eq(s.arpAgencies.id, agencyId!)).limit(1))[0];
        if (!ag || ag.arpId !== a.id) throw unprocessable('Órgão não cadastrado nesta ata.');
        if (ag.kind !== 'nao_participante') throw unprocessable('Adesão é para órgão não participante; gerenciador e participantes usam a própria cota.');
        const items = body.items.map((i) => { const it = st.items.find((x) => x.id === i.itemId); if (!it) throw unprocessable('Item fora da ata.'); return { ...i, unitCents: it.unitCents }; });
        const [r] = await tx.insert(s.arpAdhesions).values({ tenantId: auth.tenantId, arpId: a.id, agencyId: ag.id, requestedAt: body.requestedAt, justification: body.justification, items, createdBy: auth.userId }).returning();
        await arpEvent(tx, auth, auth.tenantId, a.id, 'adesao', `Pedido de adesão de ${ag.name}: ${items.length} item(ns).`, { adhesionId: r!.id });
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        const all = await tx.select().from(s.arpAdhesions).where(eq(s.arpAdhesions.arpId, a.id));
        return { ...r!, check: checkAdhesion(rule.rules, items, { registered: new Map(st.items.map((i) => [i.id, i.registeredMilli])), ...adhesionCtx(st, ag.id, r!.id, all) }) };
      });
      reply.code(201);
      return out;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arp-adhesions/:id/supplier-accept',
    summary: 'Registra o aceite do fornecedor',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ documentId: z.string().uuid().nullable().default(null) }),
    handler: async ({ app, auth, params, body }) => {
      requireArp(auth, 'manage');
      const r = await adhesionOr404(app.db, auth, params.id);
      if (r.status !== 'solicitada') throw unprocessable('O aceite é registrado com a adesão solicitada.');
      await docOf(app.db, r.arpId, body.documentId, ['aceite_fornecedor']);
      await app.db.update(s.arpAdhesions).set({ status: 'aceita_fornecedor', supplierAcceptedAt: new Date(), supplierAcceptedBy: auth.userId, updatedAt: new Date(), rowVersion: sql`${s.arpAdhesions.rowVersion} + 1` }).where(eq(s.arpAdhesions.id, r.id));
      await arpEvent(app.db, auth, auth.tenantId, r.arpId, 'adesao_aceite', 'Aceite do fornecedor registrado.', { adhesionId: r.id });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arp-adhesions/:id/authorize',
    summary: 'Registra a autorização do gerenciador e libera a cota da adesão (limites conferidos; exceção só com validação do Jurídico)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ managerAuthorizationRef: z.string().trim().min(2).max(200), documentId: z.string().uuid(), exception: Exception }),
    handler: async ({ app, auth, params, body, req }) => {
      requireArp(auth, 'effect');
      const r0 = await adhesionOr404(app.db, auth, params.id);
      const a = await loadArp(app.db, auth, r0.arpId);
      requireStatus(a.status, ['vigente'], 'Autorização de adesão');
      await docOf(app.db, a.id, body.documentId, ['autorizacao_gerenciador']);
      const out = await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const [r] = await tx.select().from(s.arpAdhesions).where(eq(s.arpAdhesions.id, r0.id)).limit(1);
        if (r!.status !== 'aceita_fornecedor') throw unprocessable('Autorize depois do aceite do fornecedor.');
        const st = await arpState(tx, a.id);
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        const all = await tx.select().from(s.arpAdhesions).where(eq(s.arpAdhesions.arpId, a.id));
        const check = checkAdhesion(rule.rules, r!.items, { registered: new Map(st.items.map((i) => [i.id, i.registeredMilli])), ...adhesionCtx(st, r!.agencyId, r!.id, all) });
        let exception: Record<string, unknown> | null = null;
        if (!check.ok) {
          if (!body.exception) throw unprocessable(`Adesão fora dos limites: ${check.lines.flatMap((l) => l.violations).join(' ')} Só com exceção legal validada pelo Jurídico.`, [{ path: 'exception', message: 'Limite legal' }]);
          if (!isJuridico(auth)) throw forbidden('Exceção a limite legal só pode ser validada por alguém do setor Jurídico.');
          await docOf(tx, a.id, body.exception.documentId, ['parecer_juridico']);
          exception = { ...body.exception, validatedBy: auth.userId, validatedByName: auth.name, at: new Date().toISOString(), violations: check.lines.flatMap((l) => l.violations) };
        }
        const deadline = addDaysIso(todayIso(), rule.rules.contractDeadlineDays);
        await writeLedger(tx, auth, a.id, st, r!.items.map((i) => ({ kind: 'adesao' as const, itemId: i.itemId, agencyId: r!.agencyId, qtyMilli: i.qtyMilli })), { origin: 'adesao', adhesionId: r!.id, documentId: body.documentId, justification: r!.justification, approvalRef: body.managerAuthorizationRef, ruleVersion: rule.version, idem: `adesao:${r!.id}` });
        await tx.update(s.arpAdhesions).set({ status: 'autorizada', managerAuthorizedAt: new Date(), managerAuthorizationRef: body.managerAuthorizationRef, authorizedBy: auth.userId, deadlineAt: deadline, limitsSnapshot: { rules: rule.rules, check } as unknown as Record<string, unknown>, ruleVersion: rule.version, exception, updatedAt: new Date(), rowVersion: sql`${s.arpAdhesions.rowVersion} + 1` }).where(eq(s.arpAdhesions.id, r!.id));
        if (r!.opportunityId) await reserveAdhesionForOpportunity(tx, auth, a.id, r!.id);
        await arpEvent(tx, auth, auth.tenantId, a.id, 'adesao_autorizada', `Adesão autorizada (${body.managerAuthorizationRef}). Prazo para contratar: ${deadline.split('-').reverse().join('/')}.${exception ? ' Com exceção validada pelo Jurídico.' : ''}`, { adhesionId: r!.id, ruleVersion: rule.version });
        return { deadlineAt: deadline, exception: !!exception };
      });
      await audit(app.db, req, { action: 'arp.adhesion_authorize', entityType: 'arp', entityId: a.id, metadata: { adhesionId: r0.id, ...out } });
      return out;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/arp-adhesions/:id/status',
    summary: 'Recusa, cancela ou marca a adesão como expirada (devolve a cota não usada com lançamento compensatório)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ status: z.enum(['recusada', 'cancelada', 'expirada']), note: z.string().trim().min(5).max(1000) }),
    handler: async ({ app, auth, params, body }) => {
      requireArp(auth, 'effect');
      const r0 = await adhesionOr404(app.db, auth, params.id);
      const a = await loadArp(app.db, auth, r0.arpId);
      await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const [r] = await tx.select().from(s.arpAdhesions).where(eq(s.arpAdhesions.id, r0.id)).limit(1);
        if (['recusada', 'cancelada', 'expirada', 'contratada'].includes(r!.status)) throw unprocessable('Adesão já encerrada.');
        if (r!.status === 'autorizada') {
          const st = await arpState(tx, a.id);
          const back = r!.items.map((i) => {
            const b = st.balances.byItemAgency.get(`${i.itemId}|${r!.agencyId}`);
            return { kind: 'adesao' as const, itemId: i.itemId, agencyId: r!.agencyId, qtyMilli: -Math.max(0, Math.min(i.qtyMilli, b?.available ?? 0)) };
          }).filter((x) => x.qtyMilli < 0);
          const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
          await writeLedger(tx, auth, a.id, st, back, { origin: 'adesao', adhesionId: r!.id, justification: body.note, ruleVersion: rule.version, idem: `adesao-fim:${r!.id}` });
        }
        await tx.update(s.arpAdhesions).set({ status: body.status, updatedAt: new Date(), rowVersion: sql`${s.arpAdhesions.rowVersion} + 1` }).where(eq(s.arpAdhesions.id, r!.id));
        await arpEvent(tx, auth, auth.tenantId, a.id, 'adesao_situacao', `Adesão ${body.status}: ${body.note}`, { adhesionId: r!.id });
      });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ motor de operações
  defineRoute({
    method: 'POST',
    url: '/arps/:id/operations/simulate',
    summary: 'Simula conversão, remanejamento, correção, alteração de preço ou cancelamento (não grava nada)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: OpInput,
    handler: async ({ app, auth, params, body }) => {
      const a = await loadArp(app.db, auth, params.id);
      const st = await arpState(app.db, a.id);
      return simulate(app.db, auth, a, st, body);
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/arps/:id/operations',
    summary: 'Operações entre itens (pedidas, aprovadas, efetivadas)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const a = await loadArp(app.db, auth, params.id);
      const rows = await app.db.select().from(s.arpOperations).where(eq(s.arpOperations.arpId, a.id)).orderBy(desc(s.arpOperations.createdAt));
      const users = new Map((await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId))).map((u) => [u.id, u.name]));
      return { items: rows.map((o) => ({ ...opView(o), requestedByName: users.get(o.requestedBy) ?? null, decidedByName: o.decidedBy ? users.get(o.decidedBy) ?? null : null, effectedByName: o.effectedBy ? users.get(o.effectedBy) ?? null : null, canDecide: canEffectArp(auth) && o.requestedBy !== auth.userId && o.status === 'solicitada', canEffect: canEffectArp(auth) && o.status === 'aprovada' })) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/arps/:id/operations',
    summary: 'Solicita a operação (só se a simulação for admissível); conversões ficam registradas como "proposta" no livro',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ input: OpInput, justification: z.string().trim().min(10, 'Justifique a operação').max(2000), documentId: z.string().uuid().nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => {
      requireArp(auth, 'manage');
      const a = await loadArp(app.db, auth, params.id);
      await docOf(app.db, a.id, body.documentId);
      const op = await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        const sim = await simulate(tx, auth, a, st, body.input);
        if (!sim.ok) throw unprocessable(`Operação não admitida: ${sim.errors.join(' ')}`, [{ path: 'input', message: 'Inadmissível' }]);
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        const [op] = await tx.insert(s.arpOperations).values({ tenantId: auth.tenantId, arpId: a.id, kind: body.input.kind, input: body.input, simulation: sim as unknown as Record<string, unknown>, justification: body.justification, documentId: body.documentId, requestedBy: auth.userId, ruleVersion: rule.version }).returning();
        if (body.input.kind === 'conversao') await writeLedger(tx, auth, a.id, st, sim.entries.map((e) => ({ ...e, kind: 'conversao_proposta' as const })), { origin: 'operacao', operationId: op!.id, justification: body.justification, ruleVersion: rule.version, idem: `op:${op!.id}:proposta` });
        await arpEvent(tx, auth, auth.tenantId, a.id, 'operacao_solicitada', `${OPERATION_LABELS[body.input.kind]} solicitada: ${body.justification}`, { operationId: op!.id });
        return op!;
      });
      reply.code(201);
      return opView(op);
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/arp-operations/:id/decide',
    summary: 'Aprova ou reprova a operação (quem pediu não decide)',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).default('') }),
    handler: async ({ app, auth, params, body }) => {
      requireArp(auth, 'effect');
      const op = await opOr404(app.db, auth, params.id);
      if (op.status !== 'solicitada') throw unprocessable('Operação já decidida.');
      if (op.requestedBy === auth.userId) throw forbidden('Quem pediu a operação não pode aprová-la.');
      if (!body.approve && body.note.length < 5) throw unprocessable('Explique o motivo da reprovação.');
      await app.db.update(s.arpOperations).set({ status: body.approve ? 'aprovada' : 'reprovada', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note || null, updatedAt: new Date(), rowVersion: sql`${s.arpOperations.rowVersion} + 1` }).where(and(eq(s.arpOperations.id, op.id), eq(s.arpOperations.status, 'solicitada')));
      await arpEvent(app.db, auth, auth.tenantId, op.arpId, 'operacao_decidida', `${OPERATION_LABELS[op.kind as keyof typeof OPERATION_LABELS]} ${body.approve ? 'aprovada' : 'reprovada'}${body.note ? `: ${body.note}` : ''}.`, { operationId: op.id });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/arp-operations/:id/effect',
    summary: 'Efetiva a operação aprovada: confere de novo o saldo, exige documento de autorização e grava no livro',
    tag: 'Atas',
    module: 'contratos',
    params: IdParams,
    body: z.object({ documentId: z.string().uuid(), exception: Exception }),
    handler: async ({ app, auth, params, body, req }) => {
      requireArp(auth, 'effect');
      const op0 = await opOr404(app.db, auth, params.id);
      const a = await loadArp(app.db, auth, op0.arpId);
      await docOf(app.db, a.id, body.documentId, ['autorizacao_gerenciador', 'parecer_juridico', 'outro', 'ata', 'publicacao']);
      const res = await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const [op] = await tx.select().from(s.arpOperations).where(eq(s.arpOperations.id, op0.id)).limit(1);
        if (op!.status !== 'aprovada') throw unprocessable('Só operação aprovada pode ser efetivada.');
        const st = await arpState(tx, a.id);
        const input = op!.input as z.infer<typeof OpInput>;
        const sim = await simulate(tx, auth, a, st, input);
        if (!sim.ok) throw unprocessable(`O saldo mudou desde a aprovação e a operação deixou de ser admissível: ${sim.errors.join(' ')}`);
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        let exception: Record<string, unknown> | null = null;
        if (input.kind === 'conversao' && !rule.rules.allowConversion) {
          if (!body.exception) throw unprocessable('O regulamento aplicado não prevê conversão entre itens: só com exceção validada pelo Jurídico.', [{ path: 'exception', message: 'Exceção legal' }]);
          if (!isJuridico(auth)) throw forbidden('Exceção legal só pode ser validada por alguém do setor Jurídico.');
          await docOf(tx, a.id, body.exception.documentId, ['parecer_juridico']);
          exception = { ...body.exception, validatedBy: auth.userId, validatedByName: auth.name, at: new Date().toISOString() };
        }
        const meta = { origin: 'operacao' as const, operationId: op!.id, documentId: body.documentId, justification: op!.justification, approvalRef: `operação aprovada por ${op!.decidedBy}`, ruleVersion: rule.version, idem: `op:${op!.id}:efetiva` };
        await writeLedger(tx, auth, a.id, st, sim.entries, meta);
        if (input.kind === 'alteracao_preco') {
          const itemId = (input.sources[0] ?? input.targets[0])!.itemId;
          const it = st.items.find((i) => i.id === itemId)!;
          await tx.update(s.arpItems).set({ unitCents: input.newUnitCents!, updatedAt: new Date() }).where(eq(s.arpItems.id, itemId));
          await tx.insert(s.arpItemChanges).values({ tenantId: auth.tenantId, itemId, field: 'unitCents', fromValue: String(it.unitCents), toValue: String(input.newUnitCents), reason: op!.justification, origin: 'operacao', documentId: body.documentId, operationId: op!.id, actorId: auth.userId });
        }
        await tx.update(s.arpOperations).set({ status: 'efetivada', effectedBy: auth.userId, effectedAt: new Date(), documentId: body.documentId, exception, simulation: sim as unknown as Record<string, unknown>, updatedAt: new Date(), rowVersion: sql`${s.arpOperations.rowVersion} + 1` }).where(eq(s.arpOperations.id, op!.id));
        await arpEvent(tx, auth, auth.tenantId, a.id, 'operacao_efetivada', `${OPERATION_LABELS[input.kind]} efetivada (${sim.entries.length} lançamento(s)).`, { operationId: op!.id });
        return { entries: sim.entries.length };
      });
      await audit(app.db, req, { action: 'arp.operation_effect', entityType: 'arp', entityId: a.id, metadata: { operationId: op0.id, ...res } });
      return res;
    },
  }),

  // ------------------------------------------------------------------ relatórios
  defineRoute({
    method: 'GET',
    url: '/arp-reports',
    summary: 'Relatórios das atas (consumo por ata/item/órgão, adesões, saldo, conversões, movimentações, oportunidades, contratações), com CSV',
    tag: 'Atas',
    module: 'contratos',
    query: z.object({
      type: z.enum(['consumo_ata', 'consumo_item', 'orgao', 'adesoes', 'saldo', 'conversoes', 'movimentacoes', 'oportunidades', 'contratacoes']),
      arpId: z.string().uuid().optional(), itemId: z.string().uuid().optional(), agencyId: z.string().uuid().optional(), agencyKind: z.enum(['gerenciador', 'participante', 'nao_participante']).optional(),
      from: z.string().date().optional(), to: z.string().date().optional(), opportunityId: z.string().uuid().optional(), contractId: z.string().uuid().optional(),
      kind: z.enum(ARP_LEDGER_KINDS).optional(), actorId: z.string().uuid().optional(), status: z.string().max(30).optional(), format: z.enum(['json', 'csv']).default('json'),
    }),
    handler: async ({ app, auth, query, reply }) => {
      requireArp(auth, 'view');
      const data = await buildReport(app.db, auth, query);
      if (query.format === 'csv') {
        const esc = (v: unknown) => { const t = v === null || v === undefined ? '' : String(v); return /^[=+\-@]/.test(t) ? `'${t}` : /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
        const csv = [data.columns.map((c) => esc(c.label)).join(';'), ...data.rows.map((r) => data.columns.map((c) => esc(fmtCell(c.type, r[c.key]))).join(';'))].join('\r\n');
        reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="atas-${query.type}.csv"`);
        return `﻿${csv}\r\n`;
      }
      return data;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/arps/dashboard',
    summary: 'Painel das atas: valores, saldos, adesões, limites, conversões, evolução mensal e potencial remanescente',
    tag: 'Atas',
    module: 'contratos',
    query: z.object({ from: z.string().date().optional(), to: z.string().date().optional() }),
    handler: async ({ app, auth, query }) => {
      requireArp(auth, 'view');
      return dashboard(app.db, auth, query.from, query.to);
    },
  }),
];

// ------------------------------------------------------------------ auxiliares

async function adhesionOr404(db: DbOrTx, auth: AuthContext, id: string) {
  const [r] = await db.select().from(s.arpAdhesions).where(and(eq(s.arpAdhesions.id, id), eq(s.arpAdhesions.tenantId, auth.tenantId))).limit(1);
  if (!r) throw notFound('Adesão não encontrada.');
  return r;
}
async function opOr404(db: DbOrTx, auth: AuthContext, id: string) {
  const [r] = await db.select().from(s.arpOperations).where(and(eq(s.arpOperations.id, id), eq(s.arpOperations.tenantId, auth.tenantId))).limit(1);
  if (!r) throw notFound('Operação não encontrada.');
  return r;
}
/** Quantidade já autorizada em adesões: do órgão e no total (fora a própria adesão). */
function adhesionCtx(st: ArpState, agencyId: string, selfId: string | null, all: (typeof s.arpAdhesions.$inferSelect)[]) {
  const agencyAuthorized = new Map<string, number>();
  const totalAuthorized = new Map<string, number>();
  for (const l of st.ledger) {
    if (l.kind !== 'adesao' || l.adhesionId === selfId) continue;
    totalAuthorized.set(l.itemId, (totalAuthorized.get(l.itemId) ?? 0) + l.qtyMilli);
    if (l.agencyId === agencyId) agencyAuthorized.set(l.itemId, (agencyAuthorized.get(l.itemId) ?? 0) + l.qtyMilli);
  }
  void all;
  return { agencyAuthorized, totalAuthorized };
}

async function simulate(db: DbOrTx, auth: AuthContext, a: typeof s.arps.$inferSelect, st: ArpState, input: z.infer<typeof OpInput>) {
  const rule = await rulesFor(db, auth.tenantId, a.regime as ArpRegime);
  let corrects: OperationInput['correctsEntry'] = null;
  if (input.correctsEntryId) {
    const e = st.ledger.find((l) => l.id === input.correctsEntryId);
    if (!e) throw unprocessable('Lançamento não encontrado nesta ata.');
    corrects = { id: e.id, kind: e.kind as never, itemId: e.itemId, agencyId: e.agencyId, qtyMilli: e.qtyMilli, reversed: st.ledger.some((l) => l.reversesId === e.id) };
  }
  const sim = simulateOperation({ kind: input.kind, sources: input.sources, targets: input.targets, newUnitCents: input.newUnitCents, correctsEntry: corrects, correctedQtyMilli: input.correctedQtyMilli }, {
    items: new Map(st.items.map((i) => [i.id, { id: i.id, registeredMilli: i.registeredMilli, unitCents: i.unitCents, label: `item ${i.itemNumber}` }])),
    agencies: new Map(st.agencies.map((g) => [g.id, { id: g.id, kind: g.kind as AgencyKind, name: g.name }])),
    balances: st.balances,
    rules: rule.rules,
    status: a.status as ArpStatus,
  });
  return { ...sim, ruleVersion: rule.version, legalBasis: rule.rules.legalBasis };
}

async function ledgerRows(db: DbOrTx, tenantId: string, f: { arpId?: string; kind?: string; itemId?: string; agencyId?: string; opportunityId?: string; contractId?: string; actorId?: string; from?: string; to?: string; agencyKind?: string }) {
  const rows = await db
    .select({ l: s.arpLedger, item: s.arpItems.itemNumber, lot: s.arpItems.lot, description: s.arpItems.description, agency: s.arpAgencies.name, agencyKind: s.arpAgencies.kind, actor: s.users.name, arpNumber: s.arps.number, oppCode: s.opportunities.code, doc: s.arpDocuments.name })
    .from(s.arpLedger)
    .innerJoin(s.arpItems, eq(s.arpItems.id, s.arpLedger.itemId))
    .innerJoin(s.arpAgencies, eq(s.arpAgencies.id, s.arpLedger.agencyId))
    .innerJoin(s.arps, eq(s.arps.id, s.arpLedger.arpId))
    .leftJoin(s.users, eq(s.users.id, s.arpLedger.actorId))
    .leftJoin(s.opportunities, eq(s.opportunities.id, s.arpLedger.opportunityId))
    .leftJoin(s.arpDocuments, eq(s.arpDocuments.id, s.arpLedger.documentId))
    .where(and(
      eq(s.arpLedger.tenantId, tenantId),
      f.arpId ? eq(s.arpLedger.arpId, f.arpId) : undefined, f.kind ? eq(s.arpLedger.kind, f.kind) : undefined, f.itemId ? eq(s.arpLedger.itemId, f.itemId) : undefined,
      f.agencyId ? eq(s.arpLedger.agencyId, f.agencyId) : undefined, f.opportunityId ? eq(s.arpLedger.opportunityId, f.opportunityId) : undefined, f.contractId ? eq(s.arpLedger.contractId, f.contractId) : undefined,
      f.actorId ? eq(s.arpLedger.actorId, f.actorId) : undefined, f.agencyKind ? eq(s.arpAgencies.kind, f.agencyKind) : undefined,
      f.from ? gte(s.arpLedger.occurredAt, new Date(`${f.from}T00:00:00Z`)) : undefined, f.to ? lte(s.arpLedger.occurredAt, new Date(`${f.to}T23:59:59Z`)) : undefined,
    ))
    .orderBy(desc(s.arpLedger.occurredAt))
    .limit(5000);
  return rows.map((r) => ({ ...r.l, kindLabel: ARP_LEDGER_LABELS[r.l.kind as keyof typeof ARP_LEDGER_LABELS] ?? r.l.kind, itemNumber: r.item, lot: r.lot, description: r.description, agencyName: r.agency, agencyKind: r.agencyKind, actorName: r.actor, arpNumber: r.arpNumber, opportunityCode: r.oppCode, documentName: r.doc }));
}

type Col = { key: string; label: string; type?: 'qty' | 'money' | 'pct' | 'date' | 'text' };
function fmtCell(type: Col['type'], v: unknown) {
  if (v === null || v === undefined) return '';
  if (type === 'qty') return (Number(v) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  if (type === 'money') return (Number(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'pct') return `${(Number(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (type === 'date') return String(v instanceof Date ? v.toISOString() : v).slice(0, 10).split('-').reverse().join('/');
  return String(v);
}

async function atasInScope(db: DbOrTx, auth: AuthContext, arpId?: string) {
  return db.select().from(s.arps).where(and(eq(s.arps.tenantId, auth.tenantId), arpId ? eq(s.arps.id, arpId) : undefined));
}

/** Somatórios por item/órgão vindos do ledger (o relatório concilia com o livro: cada número é soma de lançamentos). */
async function buildReport(db: DbOrTx, auth: AuthContext, q: Record<string, string | undefined> & { type: string }) {
  const atas = await atasInScope(db, auth, q.arpId);
  const how: Record<string, string> = {
    consumo_ata: 'Somas do livro de movimentações por ata: contratado = consumos − estornos; reservado = reservas − liberações; saldo = cota registrada − reservado − contratado. Valores pelo preço de cada lançamento.',
    consumo_item: 'Por item: mesmas somas do livro, mais a quantidade original registrada e as adesões autorizadas (fora do saldo dos participantes).',
    orgao: 'Por órgão: cota (distribuição + remanejamentos/conversões/cancelamentos, ou adesão autorizada), reservado, contratado, executado e saldo.',
    adesoes: 'Pedidos de adesão com situação, quantidades e limites usados na autorização (a versão da regra fica registrada).',
    saldo: 'Saldo disponível por item e órgão = cota − reservado − contratado.',
    conversoes: 'Operações entre itens (conversão, remanejamento, correção, alteração de preço, cancelamento) com simulação, aprovação e efetivação.',
    movimentacoes: 'Lançamentos do livro, um por linha, com origem, documento, responsável e versão da regra.',
    oportunidades: 'Oportunidades vinculadas: itens pedidos, reservas e consumo formalizado.',
    contratacoes: 'Contratos decorrentes das atas (registro jurídico próprio) com o consumo formalizado vinculado.',
  };
  let columns: Col[] = [];
  let rows: Record<string, unknown>[] = [];
  const states = new Map<string, ArpState>();
  for (const a of atas) states.set(a.id, await arpState(db, a.id));
  const inPeriod = (d: Date) => (!q.from || d >= new Date(`${q.from}T00:00:00Z`)) && (!q.to || d <= new Date(`${q.to}T23:59:59Z`));

  if (q.type === 'consumo_ata' || q.type === 'consumo_item' || q.type === 'orgao' || q.type === 'saldo') {
    for (const a of atas) {
      const st = states.get(a.id)!;
      const led = st.ledger.filter((l) => inPeriod(l.occurredAt) && (!q.kind || l.kind === q.kind) && (!q.opportunityId || l.opportunityId === q.opportunityId) && (!q.contractId || l.contractId === q.contractId) && (!q.actorId || l.actorId === q.actorId));
      const value = (kind: string, itemId?: string, agencyId?: string) => led.filter((l) => l.kind === kind && (!itemId || l.itemId === itemId) && (!agencyId || l.agencyId === agencyId)).reduce((x, l) => x + l.amountCents, 0);
      if (q.type === 'consumo_ata') {
        if (q.status && a.status !== q.status) continue;
        const it = [...st.balances.byItem.entries()];
        const regValue = st.items.reduce((x, i) => x + lineValue(st.balances.byItem.get(i.id)!.registered, i.unitCents), 0);
        const contracted = value('consumo') - value('estorno');
        rows.push({ ata: a.number, objeto: a.object, situacao: a.status, registrado: regValue, reservado: st.items.reduce((x, i) => x + lineValue(st.balances.byItem.get(i.id)!.reserved, i.unitCents), 0), contratado: contracted, executado: value('execucao'), disponivel: st.items.reduce((x, i) => x + lineValue(Math.max(0, st.balances.byItem.get(i.id)!.available), i.unitCents), 0), utilizacao: regValue ? contracted / regValue : null, adesoes: st.items.reduce((x, i) => x + lineValue(st.balances.byItem.get(i.id)!.adhesionAuthorized, i.unitCents), 0), lancamentos: led.length, itens: it.length });
        columns = [{ key: 'ata', label: 'Ata' }, { key: 'objeto', label: 'Objeto' }, { key: 'situacao', label: 'Situação' }, { key: 'itens', label: 'Itens' }, { key: 'registrado', label: 'Valor registrado', type: 'money' }, { key: 'reservado', label: 'Reservado', type: 'money' }, { key: 'contratado', label: 'Contratado', type: 'money' }, { key: 'executado', label: 'Executado', type: 'money' }, { key: 'disponivel', label: 'Saldo disponível', type: 'money' }, { key: 'utilizacao', label: 'Utilização', type: 'pct' }, { key: 'adesoes', label: 'Adesões autorizadas', type: 'money' }, { key: 'lancamentos', label: 'Lançamentos considerados' }];
      } else if (q.type === 'consumo_item' || q.type === 'saldo') {
        for (const i of st.items) {
          if (q.itemId && i.id !== q.itemId) continue;
          if (q.type === 'saldo') {
            for (const g of st.agencies) {
              if (q.agencyId && g.id !== q.agencyId) continue;
              if (q.agencyKind && g.kind !== q.agencyKind) continue;
              const b = st.balances.byItemAgency.get(`${i.id}|${g.id}`);
              if (!b || (!b.quota && !b.contracted && !b.reserved)) continue;
              rows.push({ ata: a.number, lote: i.lot, item: i.itemNumber, descricao: i.description, unidade: i.unit, orgao: g.name, tipo_orgao: g.kind, cota: b.quota, reservado: b.reserved, contratado: b.contracted, disponivel: b.available, valor_disponivel: lineValue(Math.max(0, b.available), i.unitCents) });
            }
          } else {
            const b = st.balances.byItem.get(i.id)!;
            const contracted = value('consumo', i.id) - value('estorno', i.id);
            rows.push({ ata: a.number, lote: i.lot, item: i.itemNumber, descricao: i.description, unidade: i.unit, original: i.registeredMilli, registrado: b.registered, reservado: b.reserved, contratado: b.contracted, executado: b.executed, faturado: b.billed, disponivel: b.available, adesao_autorizada: b.adhesionAuthorized, preco: i.unitCents, valor_registrado: lineValue(b.registered, i.unitCents), valor_contratado: contracted, valor_disponivel: lineValue(Math.max(0, b.available), i.unitCents) });
          }
        }
        columns = q.type === 'saldo'
          ? [{ key: 'ata', label: 'Ata' }, { key: 'lote', label: 'Lote' }, { key: 'item', label: 'Item' }, { key: 'descricao', label: 'Descrição' }, { key: 'unidade', label: 'Unidade' }, { key: 'orgao', label: 'Órgão' }, { key: 'tipo_orgao', label: 'Tipo' }, { key: 'cota', label: 'Cota', type: 'qty' }, { key: 'reservado', label: 'Reservado', type: 'qty' }, { key: 'contratado', label: 'Contratado', type: 'qty' }, { key: 'disponivel', label: 'Disponível', type: 'qty' }, { key: 'valor_disponivel', label: 'Valor disponível', type: 'money' }]
          : [{ key: 'ata', label: 'Ata' }, { key: 'lote', label: 'Lote' }, { key: 'item', label: 'Item' }, { key: 'descricao', label: 'Descrição' }, { key: 'unidade', label: 'Unidade' }, { key: 'original', label: 'Qtd. original', type: 'qty' }, { key: 'registrado', label: 'Registrada', type: 'qty' }, { key: 'reservado', label: 'Reservada', type: 'qty' }, { key: 'contratado', label: 'Contratada', type: 'qty' }, { key: 'executado', label: 'Executada', type: 'qty' }, { key: 'faturado', label: 'Faturada', type: 'qty' }, { key: 'disponivel', label: 'Saldo', type: 'qty' }, { key: 'adesao_autorizada', label: 'Adesão autorizada', type: 'qty' }, { key: 'preco', label: 'Preço unitário', type: 'money' }, { key: 'valor_registrado', label: 'Valor registrado', type: 'money' }, { key: 'valor_contratado', label: 'Valor contratado', type: 'money' }, { key: 'valor_disponivel', label: 'Valor disponível', type: 'money' }];
      } else {
        for (const g of st.agencies) {
          if (q.agencyId && g.id !== q.agencyId) continue;
          if (q.agencyKind && g.kind !== q.agencyKind) continue;
          let quota = 0, reserved = 0, contracted = 0, executed = 0, available = 0, quotaValue = 0;
          for (const i of st.items) { const b = st.balances.byItemAgency.get(`${i.id}|${g.id}`); if (!b) continue; quota += b.quota; reserved += b.reserved; contracted += b.contracted; executed += b.executed; available += b.available; quotaValue += lineValue(b.quota, i.unitCents); }
          const cv = value('consumo', undefined, g.id) - value('estorno', undefined, g.id);
          rows.push({ ata: a.number, orgao: g.name, tipo: g.kind, valor_cota: quotaValue, valor_contratado: cv, utilizacao: quotaValue ? cv / quotaValue : null, qtd_cota: quota, qtd_reservada: reserved, qtd_contratada: contracted, qtd_executada: executed, qtd_disponivel: available });
        }
        columns = [{ key: 'ata', label: 'Ata' }, { key: 'orgao', label: 'Órgão' }, { key: 'tipo', label: 'Tipo' }, { key: 'valor_cota', label: 'Valor da cota', type: 'money' }, { key: 'valor_contratado', label: 'Valor contratado', type: 'money' }, { key: 'utilizacao', label: 'Utilização', type: 'pct' }, { key: 'qtd_cota', label: 'Qtd. cota (soma itens)', type: 'qty' }, { key: 'qtd_reservada', label: 'Reservada', type: 'qty' }, { key: 'qtd_contratada', label: 'Contratada', type: 'qty' }, { key: 'qtd_executada', label: 'Executada', type: 'qty' }, { key: 'qtd_disponivel', label: 'Disponível', type: 'qty' }];
      }
    }
  } else if (q.type === 'movimentacoes') {
    const led = await ledgerRows(db, auth.tenantId, q as Parameters<typeof ledgerRows>[2]);
    rows = led.map((l) => ({ data: l.occurredAt, ata: l.arpNumber, tipo: l.kindLabel, direcao: l.dir, lote: l.lot, item: l.itemNumber, orgao: l.agencyName, quantidade: l.qtyMilli, unidade: l.unit, valor: l.amountCents, origem: l.origin, oportunidade: l.opportunityCode ? `OP-${l.opportunityCode}` : '', documento: l.documentName, responsavel: l.actorName, justificativa: l.justification, aprovacao: l.approvalRef, versao_regra: l.ruleVersion, id: l.id, estorna: l.reversesId }));
    columns = [{ key: 'data', label: 'Data', type: 'date' }, { key: 'ata', label: 'Ata' }, { key: 'tipo', label: 'Tipo' }, { key: 'direcao', label: 'Direção' }, { key: 'lote', label: 'Lote' }, { key: 'item', label: 'Item' }, { key: 'orgao', label: 'Órgão' }, { key: 'quantidade', label: 'Quantidade', type: 'qty' }, { key: 'unidade', label: 'Unidade' }, { key: 'valor', label: 'Valor', type: 'money' }, { key: 'origem', label: 'Origem' }, { key: 'oportunidade', label: 'Oportunidade' }, { key: 'documento', label: 'Documento' }, { key: 'responsavel', label: 'Responsável' }, { key: 'justificativa', label: 'Justificativa' }, { key: 'aprovacao', label: 'Aprovação' }, { key: 'versao_regra', label: 'Versão da regra' }, { key: 'id', label: 'ID do lançamento' }, { key: 'estorna', label: 'Compensa o lançamento' }];
  } else if (q.type === 'adesoes') {
    const ad = await db.select({ r: s.arpAdhesions, agency: s.arpAgencies.name, number: s.arps.number }).from(s.arpAdhesions).innerJoin(s.arpAgencies, eq(s.arpAgencies.id, s.arpAdhesions.agencyId)).innerJoin(s.arps, eq(s.arps.id, s.arpAdhesions.arpId)).where(and(eq(s.arpAdhesions.tenantId, auth.tenantId), q.arpId ? eq(s.arpAdhesions.arpId, q.arpId) : undefined, q.status ? eq(s.arpAdhesions.status, q.status) : undefined, q.agencyId ? eq(s.arpAdhesions.agencyId, q.agencyId) : undefined)).orderBy(desc(s.arpAdhesions.createdAt));
    rows = ad.filter(({ r }) => inPeriod(new Date(`${r.requestedAt}T12:00:00Z`))).map(({ r, agency, number }) => ({ ata: number, orgao: agency, solicitada: r.requestedAt, situacao: r.status, itens: r.items.length, quantidade: r.items.reduce((x, i) => x + i.qtyMilli, 0), valor: r.items.reduce((x, i) => x + lineValue(i.qtyMilli, i.unitCents), 0), autorizacao: r.managerAuthorizationRef, prazo: r.deadlineAt, versao_regra: r.ruleVersion, excecao: r.exception ? 'sim' : '' }));
    columns = [{ key: 'ata', label: 'Ata' }, { key: 'orgao', label: 'Órgão' }, { key: 'solicitada', label: 'Solicitada em', type: 'date' }, { key: 'situacao', label: 'Situação' }, { key: 'itens', label: 'Itens' }, { key: 'quantidade', label: 'Quantidade', type: 'qty' }, { key: 'valor', label: 'Valor', type: 'money' }, { key: 'autorizacao', label: 'Autorização do gerenciador' }, { key: 'prazo', label: 'Prazo para contratar', type: 'date' }, { key: 'versao_regra', label: 'Versão da regra' }, { key: 'excecao', label: 'Exceção jurídica' }];
  } else if (q.type === 'conversoes') {
    const ops = await db.select({ o: s.arpOperations, number: s.arps.number, who: s.users.name }).from(s.arpOperations).innerJoin(s.arps, eq(s.arps.id, s.arpOperations.arpId)).leftJoin(s.users, eq(s.users.id, s.arpOperations.requestedBy)).where(and(eq(s.arpOperations.tenantId, auth.tenantId), q.arpId ? eq(s.arpOperations.arpId, q.arpId) : undefined, q.status ? eq(s.arpOperations.status, q.status) : undefined)).orderBy(desc(s.arpOperations.createdAt));
    rows = ops.filter(({ o }) => inPeriod(o.createdAt)).map(({ o, number, who }) => { const sim = o.simulation as { sourceValueCents?: number; targetValueCents?: number; entries?: unknown[] }; return { ata: number, tipo: OPERATION_LABELS[o.kind as keyof typeof OPERATION_LABELS], situacao: o.status, solicitada: o.createdAt, por: who, justificativa: o.justification, valor_origem: sim.sourceValueCents ?? null, valor_destino: sim.targetValueCents ?? null, lancamentos: sim.entries?.length ?? 0, efetivada: o.effectedAt, versao_regra: o.ruleVersion }; });
    columns = [{ key: 'ata', label: 'Ata' }, { key: 'tipo', label: 'Operação' }, { key: 'situacao', label: 'Situação' }, { key: 'solicitada', label: 'Solicitada em', type: 'date' }, { key: 'por', label: 'Solicitada por' }, { key: 'justificativa', label: 'Justificativa' }, { key: 'valor_origem', label: 'Valor de origem', type: 'money' }, { key: 'valor_destino', label: 'Valor de destino', type: 'money' }, { key: 'lancamentos', label: 'Lançamentos' }, { key: 'efetivada', label: 'Efetivada em', type: 'date' }, { key: 'versao_regra', label: 'Versão da regra' }];
  } else if (q.type === 'oportunidades') {
    const lines = await db.select({ l: s.arpOpportunityLines, code: s.opportunities.code, stage: s.opportunities.stage, title: s.opportunities.title, number: s.arps.number, item: s.arpItems.itemNumber, agency: s.arpAgencies.name, owner: s.users.name })
      .from(s.arpOpportunityLines).innerJoin(s.opportunities, eq(s.opportunities.id, s.arpOpportunityLines.opportunityId)).innerJoin(s.arps, eq(s.arps.id, s.arpOpportunityLines.arpId)).innerJoin(s.arpItems, eq(s.arpItems.id, s.arpOpportunityLines.itemId)).innerJoin(s.arpAgencies, eq(s.arpAgencies.id, s.arpOpportunityLines.agencyId)).innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId))
      .where(and(eq(s.arpOpportunityLines.tenantId, auth.tenantId), q.arpId ? eq(s.arpOpportunityLines.arpId, q.arpId) : undefined, q.opportunityId ? eq(s.arpOpportunityLines.opportunityId, q.opportunityId) : undefined, q.agencyId ? eq(s.arpOpportunityLines.agencyId, q.agencyId) : undefined));
    rows = lines.filter(({ l }) => inPeriod(l.createdAt)).map(({ l, code, stage, title, number, item, agency, owner }) => ({ ata: number, oportunidade: `OP-${code}`, titulo: title, etapa: stage, responsavel: owner, orgao: agency, item, quantidade: l.qtyMilli, valor: lineValue(l.qtyMilli, l.unitCents), situacao: l.status }));
    columns = [{ key: 'ata', label: 'Ata' }, { key: 'oportunidade', label: 'Oportunidade' }, { key: 'titulo', label: 'Título' }, { key: 'etapa', label: 'Etapa' }, { key: 'responsavel', label: 'Responsável' }, { key: 'orgao', label: 'Órgão' }, { key: 'item', label: 'Item' }, { key: 'quantidade', label: 'Quantidade', type: 'qty' }, { key: 'valor', label: 'Valor', type: 'money' }, { key: 'situacao', label: 'Situação da linha' }];
  } else if (q.type === 'contratacoes') {
    const cs = await db.select({ id: s.contracts.id, arpId: s.contracts.arpId, stage: s.contracts.stage, number: s.contractVersions.number, object: s.contractVersions.object, totalCents: s.contractVersions.totalCents, monthlyCents: s.contractVersions.monthlyCents, client: s.contacts.name, ata: s.arps.number })
      .from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId)).innerJoin(s.arps, eq(s.arps.id, sql`${s.contracts.arpId}`))
      .where(and(eq(s.contracts.tenantId, auth.tenantId), sql`${s.contracts.arpId} is not null`, q.arpId ? eq(s.contracts.arpId, q.arpId) : undefined));
    const cons = cs.length ? await db.select({ contractId: s.arpLedger.contractId, kind: s.arpLedger.kind, v: sql<number>`sum(${s.arpLedger.amountCents})::bigint` }).from(s.arpLedger).where(inArray(s.arpLedger.contractId, cs.map((c) => c.id))).groupBy(s.arpLedger.contractId, s.arpLedger.kind) : [];
    rows = cs.map((c) => ({ ata: c.ata, contrato: c.number, cliente: c.client, objeto: c.object, etapa: c.stage, mensal: c.monthlyCents, total: c.totalCents, consumo_ata: cons.filter((x) => x.contractId === c.id).reduce((x, r) => x + (r.kind === 'consumo' ? Number(r.v) : r.kind === 'estorno' ? -Number(r.v) : 0), 0) }));
    columns = [{ key: 'ata', label: 'Ata' }, { key: 'contrato', label: 'Contrato' }, { key: 'cliente', label: 'Órgão contratante' }, { key: 'objeto', label: 'Objeto' }, { key: 'etapa', label: 'Etapa' }, { key: 'mensal', label: 'Valor mensal', type: 'money' }, { key: 'total', label: 'Valor global', type: 'money' }, { key: 'consumo_ata', label: 'Consumo da ata vinculado', type: 'money' }];
  }
  const totals: Record<string, number> = {};
  for (const c of columns) if (c.type === 'money' || c.type === 'qty') totals[c.key] = rows.reduce((x, r) => x + (Number(r[c.key]) || 0), 0);
  return { type: q.type, columns, rows, totals, how: how[q.type] };
}

async function dashboard(db: DbOrTx, auth: AuthContext, from?: string, to?: string) {
  const atas = await atasInScope(db, auth);
  const months = new Map<string, number>();
  let registered = 0, reserved = 0, contracted = 0, executed = 0, available = 0, adhesionValue = 0, conversions = 0;
  const byAgency = new Map<string, { name: string; kind: string; contracted: number }>();
  const limits: { ata: string; item: string; usedPct: number }[] = [];
  for (const a of atas) {
    if (a.status === 'cancelada') continue;
    const st = await arpState(db, a.id);
    const rule = await rulesFor(db, auth.tenantId, a.regime as ArpRegime);
    for (const i of st.items) {
      const b = st.balances.byItem.get(i.id)!;
      registered += lineValue(b.registered, i.unitCents); reserved += lineValue(b.reserved, i.unitCents); executed += lineValue(b.executed, i.unitCents); available += lineValue(Math.max(0, b.available), i.unitCents); adhesionValue += lineValue(b.adhesionAuthorized, i.unitCents);
      const tot = Math.floor((i.registeredMilli * rule.rules.adhesionTotalBp) / 10_000);
      if (tot && b.adhesionAuthorized) limits.push({ ata: a.number, item: i.itemNumber, usedPct: b.adhesionAuthorized / tot });
    }
    for (const l of st.ledger) {
      if ((from && l.occurredAt < new Date(`${from}T00:00:00Z`)) || (to && l.occurredAt > new Date(`${to}T23:59:59Z`))) continue;
      const sign = l.kind === 'consumo' ? 1 : l.kind === 'estorno' ? -1 : 0;
      if (sign) {
        contracted += sign * l.amountCents;
        const m = l.occurredAt.toISOString().slice(0, 7);
        months.set(m, (months.get(m) ?? 0) + sign * l.amountCents);
        const g = st.agencies.find((x) => x.id === l.agencyId)!;
        const cur = byAgency.get(g.id) ?? { name: g.name, kind: g.kind, contracted: 0 };
        cur.contracted += sign * l.amountCents;
        byAgency.set(g.id, cur);
      }
      if (l.kind === 'conversao' && l.dir === 'saida') conversions++;
    }
  }
  const openOpps = await db.select({ n: sql<number>`count(distinct ${s.opportunities.id})::int`, v: sql<number>`coalesce(sum(${s.arpOpportunityLines.qtyMilli} * ${s.arpOpportunityLines.unitCents} / 1000), 0)::bigint` }).from(s.opportunities).innerJoin(s.arpOpportunityLines, eq(s.arpOpportunityLines.opportunityId, s.opportunities.id)).where(and(eq(s.opportunities.tenantId, auth.tenantId), sql`${s.opportunities.arpId} is not null`, sql`${s.opportunities.deletedAt} is null`, sql`${s.opportunities.stage} not in ('ganha','perdida')`, eq(s.arpOpportunityLines.status, 'reservada')));
  const adhesions = await db.select({ status: s.arpAdhesions.status, n: sql<number>`count(*)::int` }).from(s.arpAdhesions).where(eq(s.arpAdhesions.tenantId, auth.tenantId)).groupBy(s.arpAdhesions.status);
  return {
    atas: { total: atas.length, vigentes: atas.filter((a) => a.status === 'vigente').length, emCadastro: atas.filter((a) => a.status === 'rascunho').length },
    values: { registered, reserved, contracted, executed, available, adhesionValue, potentialRemaining: available },
    openOpportunities: { count: openOpps[0]?.n ?? 0, valueCents: Number(openOpps[0]?.v ?? 0) },
    adhesions: Object.fromEntries(adhesions.map((x) => [x.status, x.n])),
    conversions,
    monthly: [...months.entries()].sort().map(([month, valueCents]) => ({ month, valueCents })),
    byAgency: [...byAgency.values()].sort((a, b) => b.contracted - a.contracted).slice(0, 10),
    limits: limits.sort((a, b) => b.usedPct - a.usedPct).slice(0, 10),
    note: 'Valor registrado e saldo disponível não são receita. Contratado = consumo formalizado (empenho/contrato/OS). Receita efetiva e rentabilidade dependem do faturamento e das baixas do ERP/IXC.',
  };
}
