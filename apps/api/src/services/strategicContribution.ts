/**
 * Início estratégico: para cada número do Início (oportunidades, R$ em oportunidades, atividades, propostas), a meta da
 * empresa do planejamento estratégico que mede a mesma coisa no período vigente — e a parte da pessoa nela.
 * Só metas reais (empresa, aprovadas, ativas, com indicador somável). Sem meta ligada, devolve `null`: a tela diz isso.
 */
import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { IndicatorDef } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { computeIndicator, goalProgress, indicatorDef } from './indicators';

/** O que cada número do Início mede, em eventos de negócio (os mesmos dos indicadores). */
const KPI_EVENTS: Record<string, { events: string[]; money: boolean }> = {
  abertas: { events: ['oportunidade_criada'], money: false },
  valor: { events: ['oportunidade_criada', 'venda_validada'], money: true },
  atividades_hoje: { events: ['tarefa_concluida'], money: false },
  propostas: { events: ['proposta_enviada'], money: false },
};
export const STRATEGIC_KPIS = Object.keys(KPI_EVENTS);

/** Indicador somável (dá para dizer "a parte de cada um") sobre um único evento. */
function measures(def: IndicatorDef): { event: string; money: boolean } | null {
  if (!['contagem', 'soma', 'valor'].includes(def.calc) || !def.base) return null;
  if (def.direction !== 'maior') return null;
  return { event: def.base.event, money: def.base.measure === 'soma_valor' };
}

export type Contribution = {
  goalId: string; goal: string; objective: { id: string; title: string; level: string } | null;
  unit: string; target: number; periodStart: string; periodEnd: string;
  company: { value: number | null; attainment: number | null; status: string };
  mine: number | null; share: number | null; others: number;
};

export async function strategicContribution(db: DbOrTx, auth: AuthContext, today: string): Promise<Record<string, Contribution | null>> {
  const goals = await db.select().from(s.goals).where(and(eq(s.goals.tenantId, auth.tenantId), eq(s.goals.scope, 'empresa'), eq(s.goals.status, 'ativa'), eq(s.goals.approvalStatus, 'aprovada'), isNotNull(s.goals.indicatorId), lte(s.goals.periodStart, today), gte(s.goals.periodEnd, today)));
  const objectives = await db.select({ id: s.objectives.id, title: s.objectives.title, level: s.objectives.level, parentId: s.objectives.parentId, status: s.objectives.status }).from(s.objectives).where(eq(s.objectives.tenantId, auth.tenantId));
  const objById = new Map(objectives.map((o) => [o.id, o]));
  /** objetivo estratégico ao qual a meta responde (sobe a cadeia tático → estratégico) */
  const strategicOf = (id: string | null) => {
    let o = id ? objById.get(id) : undefined;
    for (let i = 0; o && i < 5; i++) { if (o.level === 'estrategico') return o; o = o.parentId ? objById.get(o.parentId) : undefined; }
    return id ? objById.get(id) ?? null : null;
  };
  const defs = new Map<string, IndicatorDef>();
  for (const g of goals) if (g.indicatorId && !defs.has(g.indicatorId)) { const d = await indicatorDef(db, auth.tenantId, g.indicatorId); if (d) defs.set(g.indicatorId, d.def); }

  const out: Record<string, Contribution | null> = {};
  for (const [kpi, want] of Object.entries(KPI_EVENTS)) {
    const matches = goals.filter((g) => { const m = measures(defs.get(g.indicatorId!)!); return !!m && want.events.includes(m.event) && m.money === want.money; });
    if (!matches.length) { out[kpi] = null; continue; }
    // prioridade: meta ligada a objetivo estratégico ativo; depois a de período mais curto (a mais próxima do dia a dia)
    const rankOf = (g: typeof goals[number]) => (strategicOf(g.objectiveId)?.level === 'estrategico' ? 0 : g.objectiveId ? 1 : 2);
    matches.sort((a, b) => rankOf(a) - rankOf(b) || a.periodEnd.localeCompare(b.periodEnd) || a.title.localeCompare(b.title));
    const g = matches[0]!, def = defs.get(g.indicatorId!)!;
    const company = await goalProgress(db, auth.timezone, today, g);
    const me = await computeIndicator(db, auth.tenantId, auth.timezone, def, { users: [auth.userId] }, { from: g.periodStart, to: g.periodEnd }, g.indicatorId ?? undefined);
    const mine = me.status === 'indisponivel' ? null : me.value;
    const obj = strategicOf(g.objectiveId);
    out[kpi] = {
      goalId: g.id, goal: g.title, objective: obj ? { id: obj.id, title: obj.title, level: obj.level } : null,
      unit: def.unit, target: g.target, periodStart: g.periodStart, periodEnd: g.periodEnd,
      company: { value: company.value, attainment: company.attainment, status: company.status },
      mine, share: mine !== null && g.target > 0 ? Math.round((mine / g.target) * 1000) / 10 : null, others: matches.length - 1,
    };
  }
  return out;
}
