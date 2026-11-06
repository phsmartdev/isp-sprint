/**
 * Produtos e serviços da oportunidade: a lista inteira é salva de uma vez (conferida no servidor), o total vira o
 * valor da oportunidade e cada mudança entra no histórico. Licitação guarda o lance por item ou global.
 */
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { bidItemResultError, BID_MODES, ITEM_UNITS, itemErrors, itemTotal, itemsTotals, TERMINAL_STAGES, DEAL_KINDS } from '@isp/domain';
import { defineRoute } from '../http/route';
import { conflict, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { bumpVersion, loadOpportunity, opportunityDto } from '../services/opportunities';
import { pipelinesOf } from '../services/instructions';

const OppParams = z.object({ id: z.string().uuid() });
const cents = z.number().int().min(0).max(100_000_000_000);
const ItemBody = z.object({
  description: z.string().trim().min(2).max(300), unit: z.enum(ITEM_UNITS), qtyMilli: z.number().int().min(1).max(1_000_000_000),
  unitCents: cents, discountCents: cents.default(0), surchargeCents: cents.default(0), notes: z.string().trim().max(1000).nullable().optional(), bidUnitCents: cents.nullable().optional(), dealKind: z.enum(DEAL_KINDS).default('recorrencia'),
  /** documento fiscal do item (tributos da viabilidade econômica) */ fiscalDocTypeId: z.string().uuid().nullable().optional(),
});

/** Licitação: tipo de venda do formulário (ou, nas oportunidades antigas, a jornada com essa chave). */
export async function isBid(db: Parameters<typeof pipelinesOf>[0], tenantId: string, opp: { pipelineId: string; saleKind?: string | null }) {
  if (opp.saleKind) return opp.saleKind === 'licitacao';
  const pipes = await pipelinesOf(db, tenantId, { includeInactive: true });
  return pipes.find((p) => p.id === opp.pipelineId)?.key === 'licitacao';
}

export const opportunityItemRoutes = [
  defineRoute({
    method: 'GET', url: '/product-catalog', summary: 'Catálogo de produtos e serviços já usados nas negociações (busca pela descrição)', tag: 'Oportunidades', module: 'oportunidades',
    query: z.object({ q: z.string().trim().max(100).optional() }),
    handler: async ({ app, auth, query }) => {
      const t = query.q ? `%${query.q.replace(/[%_\\]/g, '\\$&')}%` : null;
      const items = await app.db.select({ id: s.productCatalog.id, description: s.productCatalog.description, unit: s.productCatalog.unit, lastUnitCents: s.productCatalog.lastUnitCents, dealKind: s.productCatalog.dealKind, fiscalDocTypeId: s.productCatalog.fiscalDocTypeId, timesUsed: s.productCatalog.timesUsed })
        .from(s.productCatalog).where(and(eq(s.productCatalog.tenantId, auth.tenantId), t ? ilike(s.productCatalog.description, t) : undefined))
        .orderBy(desc(s.productCatalog.timesUsed), asc(s.productCatalog.description)).limit(300);
      return { items };
    },
  }),
  defineRoute({
    method: 'GET', url: '/opportunities/:id/items', summary: 'Produtos e serviços da oportunidade, com totais e lance (licitação)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select().from(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, auth.tenantId))).orderBy(asc(s.opportunityItems.position));
      return {
        items: rows.map((r) => ({ ...r, totalCents: itemTotal(r) })),
        totals: itemsTotals(rows),
        bid: await isBid(app.db, auth.tenantId, opp),
        bidMode: opp.bidMode ?? null, bidGlobalCents: opp.bidGlobalCents ?? null,
        rowVersion: opp.rowVersion,
        editable: !TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number]),
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/opportunities/:id/items', summary: 'Salva a lista de produtos e serviços (o total vira o valor da oportunidade)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    body: z.object({ rowVersion: z.number().int(), items: z.array(ItemBody).max(300), bidMode: z.enum(BID_MODES).nullable().optional(), bidGlobalCents: cents.nullable().optional() }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const opp = await loadOpportunity(tx, auth, params.id);
        if (opp.rowVersion !== body.rowVersion) throw conflict(opp.rowVersion);
        if (TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number])) throw unprocessable('Oportunidade encerrada: os itens não mudam mais.');
        for (const [i, it] of body.items.entries()) {
          const err = itemErrors({ ...it, notes: it.notes ?? null, bidUnitCents: it.bidUnitCents ?? null });
          if (err) throw unprocessable(`Item ${i + 1}: ${err}`, [{ path: `items.${i}`, message: err }]);
        }
        const docIds = [...new Set(body.items.map((i) => i.fiscalDocTypeId).filter(Boolean) as string[])];
        if (docIds.length) {
          const found = await tx.select({ id: s.fiscalDocTypes.id }).from(s.fiscalDocTypes).where(and(eq(s.fiscalDocTypes.tenantId, auth.tenantId), inArray(s.fiscalDocTypes.id, docIds)));
          if (found.length !== docIds.length) throw unprocessable('Documento fiscal inválido em algum item.');
        }
        const bid = await isBid(tx, auth.tenantId, opp);
        const before = await tx.select().from(s.opportunityItems).where(eq(s.opportunityItems.opportunityId, opp.id));
        const beforeTotals = itemsTotals(before);
        await tx.delete(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, auth.tenantId)));
        // resultado do pregão por item (nosso final e vencedora) acompanha o item de mesma descrição ao salvar a lista
        const prevRes = new Map<string, (typeof before)[number][]>();
        for (const b of before) { const k = b.description.trim().toLowerCase(); prevRes.set(k, [...(prevRes.get(k) ?? []), b]); }
        const carry = (desc: string) => {
          const b = prevRes.get(desc.trim().toLowerCase())?.shift();
          return b ? { finalUnitCents: b.finalUnitCents, winnerIsUs: b.winnerIsUs, winnerCompany: b.winnerCompany, winnerUnitCents: b.winnerUnitCents } : {};
        };
        if (body.items.length) {
          await tx.insert(s.opportunityItems).values(body.items.map((it, position) => ({
            ...(bid ? carry(it.description) : {}),
            tenantId: auth.tenantId, opportunityId: opp.id, position, description: it.description, unit: it.unit, qtyMilli: it.qtyMilli, unitCents: it.unitCents,
            discountCents: it.discountCents, surchargeCents: it.surchargeCents, notes: it.notes ?? null, bidUnitCents: bid ? it.bidUnitCents ?? null : null, fiscalDocTypeId: it.fiscalDocTypeId ?? null, dealKind: it.dealKind, createdBy: auth.userId,
          })));
        }
        // cada item lançado/importado fica no catálogo para as próximas negociações (último valor e tipo usados)
        const seen = new Set<string>();
        for (const it of body.items) {
          const key = it.description.trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          await tx.execute(sql`
            insert into product_catalog (tenant_id, description, unit, last_unit_cents, deal_kind, fiscal_doc_type_id)
            values (${auth.tenantId}, ${it.description.trim().slice(0, 300)}, ${it.unit}, ${it.unitCents}, ${it.dealKind}, ${it.fiscalDocTypeId ?? null})
            on conflict (tenant_id, lower(description)) do update set unit = excluded.unit, last_unit_cents = excluded.last_unit_cents, deal_kind = excluded.deal_kind,
              fiscal_doc_type_id = coalesce(excluded.fiscal_doc_type_id, product_catalog.fiscal_doc_type_id), times_used = product_catalog.times_used + 1, last_used_at = now()`);
        }
        const totals = itemsTotals(body.items.map((i) => ({ ...i, bidUnitCents: bid ? i.bidUnitCents ?? null : null })));
        // com itens, o valor da oportunidade é a soma deles; sem itens, volta ao plano (se houver)
        let valueCents: number | null = totals.total;
        if (!body.items.length) {
          const [p] = opp.planId ? await tx.select({ price: s.plans.priceCents }).from(s.plans).where(eq(s.plans.id, opp.planId)).limit(1) : [];
          valueCents = p?.price ?? null;
        }
        const bidMode = bid ? body.bidMode ?? opp.bidMode ?? null : null;
        const bidGlobalCents = bid && bidMode === 'global' ? body.bidGlobalCents ?? null : null;
        const updated = await tx.update(s.opportunities).set({ valueCents, bidMode, bidGlobalCents, updatedAt: new Date(), rowVersion: bumpVersion() })
          .where(and(eq(s.opportunities.id, opp.id), eq(s.opportunities.rowVersion, body.rowVersion))).returning({ rowVersion: s.opportunities.rowVersion });
        if (!updated.length) throw conflict(opp.rowVersion);
        await tx.insert(s.opportunityEvents).values({
          tenantId: auth.tenantId, opportunityId: opp.id, type: 'updated', actorId: auth.userId, rowVersion: updated[0]!.rowVersion,
          payload: { changed: { itens: { from: `${beforeTotals.count} item(ns) · ${(beforeTotals.total / 100).toFixed(2)}`, to: `${totals.count} item(ns) · ${(totals.total / 100).toFixed(2)}` }, ...(bid && (bidMode !== (opp.bidMode ?? null) || bidGlobalCents !== (opp.bidGlobalCents ?? null)) ? { lance: { from: opp.bidMode ?? null, to: bidMode === 'global' ? `global ${((bidGlobalCents ?? 0) / 100).toFixed(2)}` : bidMode } } : {}) } },
        });
      });
      return opportunityDto(await loadOpportunity(app.db, auth, params.id));
    },
  }),
  defineRoute({
    method: 'PUT', url: '/opportunities/:id/items/bid-results', summary: 'Licitação: resultado por item (nosso preço unitário final e o da empresa vencedora). Vale também depois do encerramento', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    body: z.object({ rowVersion: z.number().int(), items: z.array(z.object({ id: z.string().uuid(), finalUnitCents: cents.nullable(), winnerIsUs: z.boolean().default(false), winnerCompany: z.string().trim().max(200).nullable().optional(), winnerUnitCents: cents.nullable() })).max(300) }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const opp = await loadOpportunity(tx, auth, params.id);
        if (opp.rowVersion !== body.rowVersion) throw conflict(opp.rowVersion);
        if (!(await isBid(tx, auth.tenantId, opp))) throw unprocessable('Resultado por item é só para oportunidades do tipo Licitação.');
        const rows = await tx.select().from(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, auth.tenantId)));
        const byId = new Map(rows.map((r) => [r.id, r]));
        const fmt = (c: number | null) => (c == null ? '—' : (c / 100).toFixed(2));
        const describe = (r: { description: string; finalUnitCents: number | null; winnerIsUs: boolean; winnerCompany: string | null; winnerUnitCents: number | null }) =>
          `${r.description}: nosso ${fmt(r.finalUnitCents)}, vencedora ${r.winnerIsUs ? 'nós' : r.winnerCompany ?? '—'} ${r.winnerIsUs ? fmt(r.finalUnitCents) : fmt(r.winnerUnitCents)}`;
        const from: string[] = [], to: string[] = [];
        for (const [i, it] of body.items.entries()) {
          const cur = byId.get(it.id);
          if (!cur) throw unprocessable(`Item ${i + 1} não é desta oportunidade.`);
          const next = { finalUnitCents: it.finalUnitCents, winnerIsUs: it.winnerIsUs, winnerCompany: it.winnerIsUs ? null : it.winnerCompany?.trim() || null, winnerUnitCents: it.winnerIsUs ? null : it.winnerUnitCents };
          const err = bidItemResultError(next);
          if (err) throw unprocessable(`${cur.description}: ${err}`, [{ path: `items.${i}`, message: err }]);
          const a = describe(cur), b = describe({ ...cur, ...next });
          if (a === b) continue;
          from.push(a); to.push(b);
          await tx.update(s.opportunityItems).set(next).where(and(eq(s.opportunityItems.id, cur.id), eq(s.opportunityItems.tenantId, auth.tenantId)));
        }
        const updated = await tx.update(s.opportunities).set({ updatedAt: new Date(), rowVersion: bumpVersion() })
          .where(and(eq(s.opportunities.id, opp.id), eq(s.opportunities.rowVersion, body.rowVersion))).returning({ rowVersion: s.opportunities.rowVersion });
        if (!updated.length) throw conflict(opp.rowVersion);
        if (to.length) await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'updated', actorId: auth.userId, rowVersion: updated[0]!.rowVersion, payload: { changed: { 'resultado por item': { from: from.join('; '), to: to.join('; ') } } } });
      });
      const opp = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select().from(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, auth.tenantId))).orderBy(asc(s.opportunityItems.position));
      return { rowVersion: opp.rowVersion, items: rows };
    },
  }),
];
