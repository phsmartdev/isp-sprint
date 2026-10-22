/** Funcionalidade 01 — histórico dos marcos da jornada (append-only). */
import type { MilestoneEventType } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export async function logMilestone(db: DbOrTx, tenantId: string, journeyId: string, milestoneId: string, changes: { type: MilestoneEventType; from: unknown; to: unknown; via?: string }[], actorId: string | null) {
  if (!changes.length) return;
  await db.insert(s.csMilestoneEvents).values(changes.map((c) => ({ tenantId, journeyId, milestoneId, type: c.type, payload: { from: c.from ?? null, to: c.to ?? null, ...(c.via ? { via: c.via } : {}) }, actorId })));
}
