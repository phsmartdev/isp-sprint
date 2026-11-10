/**
 * Endereços de entrega da oportunidade: o principal (campos install* da oportunidade) e os demais.
 * A lista é salva de uma vez; cada produto pode apontar o endereço em que será entregue.
 */
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { DeliveryAddressInput, MAX_DELIVERY_ADDRESSES } from '@isp/shared';
import { TERMINAL_STAGES } from '@isp/domain';
import { defineRoute } from '../http/route';
import { conflict, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { bumpVersion, hasAddress, loadOpportunity, opportunityDto } from '../services/opportunities';
import type { DbOrTx } from '../db/client';

const OppParams = z.object({ id: z.string().uuid() });
const Principal = DeliveryAddressInput.pick({ cep: true, street: true, number: true, district: true, city: true });

export async function deliveryAddressesOf(db: DbOrTx, tenantId: string, opportunityId: string) {
  return db
    .select({ id: s.opportunityDeliveryAddresses.id, label: s.opportunityDeliveryAddresses.label, cep: s.opportunityDeliveryAddresses.cep, street: s.opportunityDeliveryAddresses.street, number: s.opportunityDeliveryAddresses.number, district: s.opportunityDeliveryAddresses.district, city: s.opportunityDeliveryAddresses.city, notes: s.opportunityDeliveryAddresses.notes })
    .from(s.opportunityDeliveryAddresses)
    .where(and(eq(s.opportunityDeliveryAddresses.tenantId, tenantId), eq(s.opportunityDeliveryAddresses.opportunityId, opportunityId)))
    .orderBy(asc(s.opportunityDeliveryAddresses.position), asc(s.opportunityDeliveryAddresses.createdAt));
}

const line = (a: { street?: string | null; number?: string | null; district?: string | null; city?: string | null; cep?: string | null }) =>
  [[a.street, a.number].filter(Boolean).join(', '), a.district, a.city, a.cep].filter(Boolean).join(' · ') || '—';

export const deliveryAddressRoutes = [
  defineRoute({
    method: 'GET', url: '/opportunities/:id/delivery-addresses', summary: 'Endereços de entrega: o principal e os demais', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      return {
        principal: { cep: opp.installCep, street: opp.installStreet, number: opp.installNumber, district: opp.installDistrict, city: opp.installCity },
        items: await deliveryAddressesOf(app.db, auth.tenantId, opp.id),
        rowVersion: opp.rowVersion,
        editable: !TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number]),
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/opportunities/:id/delivery-addresses', summary: 'Salva os endereços de entrega (o principal e a lista dos demais; os que saem da lista deixam os produtos no principal)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    body: z.object({ rowVersion: z.number().int(), principal: Principal, items: z.array(DeliveryAddressInput).max(MAX_DELIVERY_ADDRESSES) }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const opp = await loadOpportunity(tx, auth, params.id);
        if (opp.rowVersion !== body.rowVersion) throw conflict(opp.rowVersion);
        if (TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number])) throw unprocessable('Oportunidade encerrada: os endereços não mudam mais.');
        const before = await deliveryAddressesOf(tx, auth.tenantId, opp.id);
        const known = new Set(before.map((a) => a.id));
        const list = body.items.filter(hasAddress);
        for (const [i, a] of list.entries()) if (a.id && !known.has(a.id)) throw unprocessable(`Endereço ${i + 2} não é desta oportunidade.`, [{ path: `items.${i}.id`, message: 'Endereço não encontrado' }]);
        const keep = list.map((a) => a.id).filter(Boolean) as string[];
        // os que saíram: os produtos deles voltam para o principal (FK com set null)
        await tx.delete(s.opportunityDeliveryAddresses).where(and(eq(s.opportunityDeliveryAddresses.tenantId, auth.tenantId), eq(s.opportunityDeliveryAddresses.opportunityId, opp.id), keep.length ? notInArray(s.opportunityDeliveryAddresses.id, keep) : undefined));
        for (const [position, a] of list.entries()) {
          const v = { position, label: a.label ?? null, cep: a.cep ?? null, street: a.street ?? null, number: a.number ?? null, district: a.district ?? null, city: a.city ?? null, notes: a.notes ?? null };
          if (a.id) await tx.update(s.opportunityDeliveryAddresses).set(v).where(and(eq(s.opportunityDeliveryAddresses.id, a.id), eq(s.opportunityDeliveryAddresses.tenantId, auth.tenantId)));
          else await tx.insert(s.opportunityDeliveryAddresses).values({ ...v, tenantId: auth.tenantId, opportunityId: opp.id, createdBy: auth.userId });
        }
        const p = body.principal;
        const updated = await tx.update(s.opportunities)
          .set({ installCep: p.cep ?? null, installStreet: p.street ?? null, installNumber: p.number ?? null, installDistrict: p.district ?? null, installCity: p.city ?? null, updatedAt: new Date(), rowVersion: bumpVersion() })
          .where(and(eq(s.opportunities.id, opp.id), eq(s.opportunities.rowVersion, body.rowVersion))).returning({ rowVersion: s.opportunities.rowVersion });
        if (!updated.length) throw conflict(opp.rowVersion);
        const fromP = line({ cep: opp.installCep, street: opp.installStreet, number: opp.installNumber, district: opp.installDistrict, city: opp.installCity }), toP = line(p);
        const fromL = before.map(line).join('; '), toL = list.map(line).join('; ');
        if (fromP !== toP || fromL !== toL) {
          await tx.insert(s.opportunityEvents).values({
            tenantId: auth.tenantId, opportunityId: opp.id, type: 'updated', actorId: auth.userId, rowVersion: updated[0]!.rowVersion,
            payload: { changed: { ...(fromP !== toP ? { 'endereço de entrega principal': { from: fromP, to: toP } } : {}), ...(fromL !== toL ? { 'outros endereços de entrega': { from: `${before.length}: ${fromL || '—'}`, to: `${list.length}: ${toL || '—'}` } } : {}) } },
          });
        }
      });
      const opp = await loadOpportunity(app.db, auth, params.id);
      return { opportunity: opportunityDto(opp), items: await deliveryAddressesOf(app.db, auth.tenantId, opp.id), rowVersion: opp.rowVersion };
    },
  }),
];

/** Confere se os endereços apontados pelos produtos são desta oportunidade. */
export async function assertDeliveryAddresses(db: DbOrTx, tenantId: string, opportunityId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const found = await db.select({ id: s.opportunityDeliveryAddresses.id }).from(s.opportunityDeliveryAddresses)
    .where(and(eq(s.opportunityDeliveryAddresses.tenantId, tenantId), eq(s.opportunityDeliveryAddresses.opportunityId, opportunityId), inArray(s.opportunityDeliveryAddresses.id, uniq)));
  if (found.length !== uniq.length) throw unprocessable('Endereço de entrega inválido em algum produto.');
}
