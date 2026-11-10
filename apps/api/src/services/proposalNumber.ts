/** Número da proposta gerada no CRM (PC AAMMDD, sufixo no mesmo dia). Atribuído uma vez por oportunidade. */
import { and, eq, like, sql } from 'drizzle-orm';
import { nextProposalNumber, proposalNumberBase } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export async function ensureProposalNumber(db: DbOrTx, tenantId: string, opportunityId: string, today: string): Promise<string> {
  const [o] = await db.select({ n: s.opportunities.proposalNumber }).from(s.opportunities).where(and(eq(s.opportunities.id, opportunityId), eq(s.opportunities.tenantId, tenantId)));
  if (o?.n) return o.n;
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`proposal-number:${tenantId}`}))`);
  const base = proposalNumberBase(today);
  const taken = (await db.select({ n: s.opportunities.proposalNumber }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, tenantId), like(s.opportunities.proposalNumber, `${base}%`)))).map((r) => r.n!);
  const n = nextProposalNumber(today, taken);
  await db.update(s.opportunities).set({ proposalNumber: n }).where(and(eq(s.opportunities.id, opportunityId), sql`${s.opportunities.proposalNumber} is null`));
  return n;
}
