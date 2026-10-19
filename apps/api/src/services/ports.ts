/** Portas da CTO por condomínio: venda fechada ocupa, cancelamento (porta liberada) ou reabertura libera. */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export const occupiesPort = (tenantId: string) =>
  and(eq(s.opportunities.tenantId, tenantId), eq(s.opportunities.stage, 'ganha'), isNull(s.opportunities.portReleasedAt), isNull(s.opportunities.deletedAt), sql`${s.opportunities.condominiumId} is not null`);

export async function portUsage(db: DbOrTx, tenantId: string, condoIds?: string[]) {
  const rows = await db
    .select({ id: s.opportunities.condominiumId, n: sql<number>`count(*)::int` })
    .from(s.opportunities)
    .where(and(occupiesPort(tenantId), condoIds?.length ? inArray(s.opportunities.condominiumId, condoIds) : undefined))
    .groupBy(s.opportunities.condominiumId);
  return new Map(rows.map((r) => [r.id!, r.n]));
}
