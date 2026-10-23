/**
 * Produtos e serviços da oportunidade: a lista inteira é salva de uma vez (conferida no servidor), o total vira o
 * valor da oportunidade e cada mudança entra no histórico. Licitação guarda o lance por item ou global.
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { BID_MODES, ITEM_UNITS, itemErrors, itemTotal, itemsTotals, TERMINAL_STAGES } from '@isp/domain';
import { defineRoute } from '../http/route';
import { conflict, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { bumpVersion, loadOpportunity, opportunityDto } from '../services/opportunities';
import { pipelinesOf } from '../services/instructions';

const OppParams = z.object({ id: z.string().uuid() });
const cents = z.number().int().min(0).max(100_000_000_000);
const ItemBody = z.object({
  description: z.string().trim().min(2).max(300), unit: z.enum(ITEM_UNITS), qtyMilli: z.number().int().min(1).max(1_000_000_000),
  unitCents: cents, discountCents: cents.default(0), surchargeCents: cents.default(0), notes: z.string().trim().max(1000).nullable().optional(), bidUnitCents: cents.nullable().optional(),
});

async function isBid(db: Parameters<typeof pipelinesOf>[0], tenantId: string, pipelineId: string) {
  const pipes = await pipelinesOf(db, tenantId);
  return pipes.find((p) => p.id === pipelineId)?.key === 'licitacao';
}

export const opportunityItemRoutes = [
  defineRoute({
    method: 'GET', url: '/opportunities/:id/items', summary: 'Produtos e serviços da oportunidade, com totais e lance (licitação)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select().from(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, auth.tenantId))).orderBy(asc(s.opportunityItems.position));
      return {
        items: rows.map((r) => ({ ...r, totalCents: itemTotal(r) })),
        totals: itemsTotals(rows),
        bid: await isBid(app.db, auth.tenantId, opp.pipelineId),
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
        const bid = await isBid(tx, auth.tenantId, opp.pipelineId);
        const before = await tx.select().from(s.opportunityItems).where(eq(s.opportunityItems.opportunityId, opp.id));
        const beforeTotals = itemsTotals(before);
        await tx.delete(s.opportunityItems).where(and(eq(s.opportunityItems.opportunityId, opp.id), eq(s.opportunityItems.tenantId, auth.tenantId)));
        if (body.items.length) {
          await tx.insert(s.opportunityItems).values(body.items.map((it, position) => ({
            tenantId: auth.tenantId, opportunityId: opp.id, position, description: it.description, unit: it.unit, qtyMilli: it.qtyMilli, unitCents: it.unitCents,
            discountCents: it.discountCents, surchargeCents: it.surchargeCents, notes: it.notes ?? null, bidUnitCents: bid ? it.bidUnitCents ?? null : null, createdBy: auth.userId,
          })));
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
];
