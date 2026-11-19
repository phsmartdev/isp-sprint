/**
 * Objetivos estratégicos = KPIs principais (fichas da Inteligência). Cada KPI ativo tem o seu objetivo estratégico em
 * Metas e indicadores, criado e mantido a partir da ficha (nome, área, objetivo da ficha, ano vigente). Os demais
 * indicadores e as metas se ligam a esses objetivos. Idempotente: pode rodar a cada leitura.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { allIndicators } from './indicators';

export const isKpiDef = (d: { calc: string; sheet?: unknown }) => d.calc === 'informado' && !!d.sheet;

export async function ensureKpiObjectives(db: DbOrTx, tenantId: string, today: string, fallbackOwnerId: string) {
  const kpis = (await allIndicators(db, tenantId)).filter((i) => isKpiDef(i.def));
  if (!kpis.length) return;
  const year = today.slice(0, 4);
  const linked = await db.select().from(s.objectives).where(and(eq(s.objectives.tenantId, tenantId), isNotNull(s.objectives.kpiIndicatorId)));
  const byKpi = new Map(linked.map((o) => [o.kpiIndicatorId!, o]));
  for (const k of kpis) {
    const o = byKpi.get(k.id);
    const status = k.active ? 'ativo' : 'encerrado';
    if (!o) {
      if (!k.active) continue;
      await db.insert(s.objectives).values({
        tenantId, title: k.def.name, description: k.def.sheet?.objective ?? k.def.description ?? null, level: 'estrategico', area: k.def.sheet?.area ?? null,
        ownerId: k.createdBy ?? fallbackOwnerId, priority: 'alta', periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`, kpiIndicatorId: k.id, createdBy: k.createdBy ?? fallbackOwnerId,
      }).onConflictDoNothing();
      continue;
    }
    const patch: Partial<typeof s.objectives.$inferInsert> = {};
    if (o.title !== k.def.name) patch.title = k.def.name;
    if (o.periodEnd < `${year}-12-31`) patch.periodEnd = `${year}-12-31`;
    if (o.status !== status && o.status !== 'cancelado') patch.status = status;
    if (Object.keys(patch).length) await db.update(s.objectives).set({ ...patch, updatedAt: new Date() }).where(eq(s.objectives.id, o.id));
  }
}
