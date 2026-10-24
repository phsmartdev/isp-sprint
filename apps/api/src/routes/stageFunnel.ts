/** Bloco 4: tempo em cada etapa (na negociação) e conversão por etapa e do funil (Inteligência). */
import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PeriodFields } from '@isp/shared';
import { funnelConversion, stageTimes, type StageMove } from '@isp/domain';
import { defineRoute } from '../http/route';
import { notFound } from '../http/errors';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { loadOpportunity } from '../services/opportunities';
import { ownerScope } from '../services/scope';
import { periodBounds } from '../services/period';

const ENTRY_TYPES = ['created', 'stage_changed', 'reopened', 'duplicated_from'];

/** Histórico de etapas de cada oportunidade (append-only); sem histórico, a etapa atual desde a criação. */
export async function stageMovesOf(db: DbOrTx, tenantId: string, opps: { id: string; stage: string; createdAt: Date | string }[]) {
  const out = new Map<string, StageMove[]>(opps.map((o) => [o.id, []]));
  const ids = opps.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 2000) {
    const chunk = ids.slice(i, i + 2000);
    const rows = await db.select({ opp: s.opportunityEvents.opportunityId, type: s.opportunityEvents.type, to: s.opportunityEvents.toValue, payload: s.opportunityEvents.payload, at: s.opportunityEvents.occurredAt })
      .from(s.opportunityEvents)
      .where(and(eq(s.opportunityEvents.tenantId, tenantId), inArray(s.opportunityEvents.opportunityId, chunk), or(inArray(s.opportunityEvents.type, ENTRY_TYPES), sql`${s.opportunityEvents.type} = 'updated' and ${s.opportunityEvents.payload} -> 'changed' ? 'etapa'`)))
      .orderBy(asc(s.opportunityEvents.occurredAt));
    for (const r of rows) {
      const to = r.type === 'updated' ? ((r.payload?.changed as Record<string, { to?: string }> | undefined)?.etapa?.to ?? null) : r.to;
      if (to) out.get(r.opp)!.push({ at: r.at.toISOString(), to });
    }
  }
  for (const o of opps) {
    const ms = out.get(o.id)!;
    const created = typeof o.createdAt === 'string' ? o.createdAt : o.createdAt.toISOString();
    if (!ms.length) ms.push({ at: created, to: o.stage });
  }
  return out;
}

const FunnelQuery = PeriodFields.extend({ pipelineId: z.string().uuid().optional() });

export const stageFunnelRoutes = [
  defineRoute({
    method: 'GET', url: '/opportunities/:id/stage-times', summary: 'Dias em cada etapa da negociação (todas as passagens, inclusive as concluídas)', tag: 'Oportunidades', module: 'oportunidades',
    params: z.object({ id: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const moves = (await stageMovesOf(app.db, auth.tenantId, [{ id: o.id, stage: o.stage, createdAt: o.createdAt }])).get(o.id)!;
      return { stages: stageTimes(moves, new Date().toISOString()), moves };
    },
  }),
  defineRoute({
    method: 'GET', url: '/intelligence/stage-funnel', summary: 'Conversão por etapa e do funil, perda por etapa e tempo médio em cada etapa (coorte criada no período)', tag: 'Inteligência', module: 'inteligencia',
    query: FunnelQuery,
    handler: async ({ app, auth, query }) => {
      const pipes = await app.db.select({ id: s.pipelines.id, name: s.pipelines.name, isDefault: s.pipelines.isDefault }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, auth.tenantId), eq(s.pipelines.active, true))).orderBy(asc(s.pipelines.position));
      const p = periodBounds(auth, query.from, query.to);
      let pipe = pipes.find((x) => x.id === query.pipelineId) ?? null;
      if (query.pipelineId && !pipe) throw notFound('Funil não encontrado.');
      if (!pipe) {
        // sem escolha: o funil com mais negociações criadas no período
        const [top] = await app.db.select({ id: s.opportunities.pipelineId, n: sql<number>`count(*)::int` }).from(s.opportunities)
          .where(and(ownerScope(auth, 'inteligencia', { tenantId: s.opportunities.tenantId, ownerId: s.opportunities.ownerId, deletedAt: s.opportunities.deletedAt }), gte(s.opportunities.createdAt, p.from), lt(s.opportunities.createdAt, p.to)))
          .groupBy(s.opportunities.pipelineId).orderBy(sql`2 desc`).limit(1);
        pipe = pipes.find((x) => x.id === top?.id) ?? pipes.find((x) => x.isDefault) ?? pipes[0] ?? null;
      }
      if (!pipe) throw notFound('Funil não encontrado.');
      const stages = await app.db.select({ key: s.pipelineStages.key, name: s.pipelineStages.name, kind: s.pipelineStages.kind, position: s.pipelineStages.position }).from(s.pipelineStages).where(and(eq(s.pipelineStages.pipelineId, pipe.id), eq(s.pipelineStages.active, true))).orderBy(asc(s.pipelineStages.position));
      const opps = await app.db.select({ id: s.opportunities.id, stage: s.opportunities.stage, createdAt: s.opportunities.createdAt }).from(s.opportunities)
        .where(and(ownerScope(auth, 'inteligencia', { tenantId: s.opportunities.tenantId, ownerId: s.opportunities.ownerId, deletedAt: s.opportunities.deletedAt }), eq(s.opportunities.pipelineId, pipe.id), gte(s.opportunities.createdAt, p.from), lt(s.opportunities.createdAt, p.to)));
      const moves = await stageMovesOf(app.db, auth.tenantId, opps);
      const f = funnelConversion(stages, opps.map((o) => ({ stage: o.stage, moves: moves.get(o.id)! })), new Date().toISOString());
      return { pipelines: pipes.map(({ id, name }) => ({ id, name })), pipelineId: pipe.id, ...f };
    },
  }),
];
