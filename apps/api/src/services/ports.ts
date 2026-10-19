/**
 * Portas da CTO por condomínio.
 *  - reservada: oportunidade aberta com o condomínio indicado
 *  - ocupada: venda fechada (até o cancelamento liberar a porta)
 * Perder a oportunidade, trocar de condomínio ou cancelar libera a porta.
 */
import { and, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

const base = (tenantId: string) => and(eq(s.opportunities.tenantId, tenantId), isNull(s.opportunities.deletedAt), sql`${s.opportunities.condominiumId} is not null`);
export const occupiesPort = (tenantId: string) => and(base(tenantId), eq(s.opportunities.stage, 'ganha'), isNull(s.opportunities.portReleasedAt));
export const reservesPort = (tenantId: string) => and(base(tenantId), notInArray(s.opportunities.stage, ['ganha', 'perdida']));

/** Portas ocupadas (vendas fechadas) por condomínio. */
export async function portUsage(db: DbOrTx, tenantId: string, condoIds?: string[], exceptOpportunityId?: string) {
  const rows = await db
    .select({ id: s.opportunities.condominiumId, n: sql<number>`count(*)::int` })
    .from(s.opportunities)
    .where(and(occupiesPort(tenantId), condoIds?.length ? inArray(s.opportunities.condominiumId, condoIds) : undefined, exceptOpportunityId ? ne(s.opportunities.id, exceptOpportunityId) : undefined))
    .groupBy(s.opportunities.condominiumId);
  return new Map(rows.map((r) => [r.id!, r.n]));
}

/** Portas reservadas (oportunidades abertas) por condomínio. */
export async function portReservations(db: DbOrTx, tenantId: string, condoIds?: string[], exceptOpportunityId?: string) {
  const rows = await db
    .select({ id: s.opportunities.condominiumId, n: sql<number>`count(*)::int` })
    .from(s.opportunities)
    .where(and(reservesPort(tenantId), condoIds?.length ? inArray(s.opportunities.condominiumId, condoIds) : undefined, exceptOpportunityId ? ne(s.opportunities.id, exceptOpportunityId) : undefined))
    .groupBy(s.opportunities.condominiumId);
  return new Map(rows.map((r) => [r.id!, r.n]));
}

/** Ao indicar o condomínio numa oportunidade aberta: precisa haver porta livre (nem ocupada nem reservada). */
export async function assertPortAvailable(db: DbOrTx, tenantId: string, condominiumId: string, exceptOpportunityId?: string) {
  const [c] = await db.select({ name: s.condominiums.name, ports: s.condominiums.ctoPorts }).from(s.condominiums).where(and(eq(s.condominiums.id, condominiumId), eq(s.condominiums.tenantId, tenantId))).limit(1);
  if (!c || c.ports == null) return;
  const used = (await portUsage(db, tenantId, [condominiumId], exceptOpportunityId)).get(condominiumId) ?? 0;
  const reserved = (await portReservations(db, tenantId, [condominiumId], exceptOpportunityId)).get(condominiumId) ?? 0;
  if (used + reserved >= c.ports) {
    const { unprocessable } = await import('../http/errors');
    throw unprocessable(`A CTO do ${c.name} está sem portas livres: ${used} ocupada(s) e ${reserved} reservada(s) de ${c.ports}. Libere uma reserva ou fale com a engenharia.`, [{ path: 'condominiumId', message: 'Sem porta livre na CTO' }]);
  }
}
