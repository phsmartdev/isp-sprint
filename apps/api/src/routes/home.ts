import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { resolvePipeline } from '../services/instructions';
import { defineRoute } from '../http/route';
import * as s from '../db/schema';
import { ownerScope, visibleUserIds } from '../services/scope';
import { opportunityDto, opportunityQuery } from '../services/opportunities';
import { opportunityKpis } from './opportunities';
import { pctDelta, ratio } from '../services/metrics';

/** Início: visão do dia na carteira visível pelo nível do módulo Início. */
export const homeRoutes = [
  defineRoute({
    method: 'GET',
    url: '/home',
    summary: 'Início: indicadores, meta do mês, agenda de hoje, pipeline e oportunidades recentes',
    tag: 'Início',
    module: 'inicio',
    handler: async ({ app, auth }) => {
      const tz = auth.timezone;
      const oppScope = ownerScope(auth, 'inicio', { tenantId: s.opportunities.tenantId, ownerId: s.opportunities.ownerId, deletedAt: s.opportunities.deletedAt });
      const leadScope = ownerScope(auth, 'inicio', { tenantId: s.leads.tenantId, ownerId: s.leads.ownerId, deletedAt: s.leads.deletedAt });
      const users = visibleUserIds(auth, 'inicio');
      const monthStart = sql`(date_trunc('month', now() at time zone ${tz}) at time zone ${tz})`;
      const prevMonthStart = sql`(date_trunc('month', (now() at time zone ${tz}) - interval '1 month') at time zone ${tz})`;
      const prevSame = sql`(now() - interval '1 month')`;
      const localDay = sql`(${s.activities.dueAt} at time zone ${tz})::date`;
      const today = sql`(now() at time zone ${tz})::date`;

      const pipe = await resolvePipeline(app.db, auth.tenantId, {});
      const [oppK, actK, month, goals, agenda, pipeline, recent] = await Promise.all([
        opportunityKpis(app.db, auth, 'inicio'),
        app.db
          .select({
            today: sql<number>`count(*) filter (where ${localDay} = ${today})::int`,
            yesterday: sql<number>`count(*) filter (where ${localDay} = ${today} - 1)::int`,
          })
          .from(s.activities)
          .where(and(eq(s.activities.tenantId, auth.tenantId), isNull(s.activities.deletedAt), eq(s.activities.ownerId, auth.userId))),
        app.db.execute<{ won: number; won_prev: number; proposals: number; proposals_prev: number; leads: number; leads_prev: number }>(sql`
          select
            (select count(*) from ${s.opportunities} where ${oppScope} and ${s.opportunities.wonAt} >= ${monthStart})::int won,
            (select count(*) from ${s.opportunities} where ${oppScope} and ${s.opportunities.wonAt} >= ${prevMonthStart} and ${s.opportunities.wonAt} < ${prevSame})::int won_prev,
            (select count(*) from ${s.opportunities} where ${oppScope} and ${s.opportunities.proposalStatus} in ('enviada','aceita') and ${s.opportunities.createdAt} >= ${monthStart})::int proposals,
            (select count(*) from ${s.opportunities} where ${oppScope} and ${s.opportunities.proposalStatus} in ('enviada','aceita') and ${s.opportunities.createdAt} >= ${prevMonthStart} and ${s.opportunities.createdAt} < ${prevSame})::int proposals_prev,
            (select count(*) from ${s.leads} where ${leadScope} and ${s.leads.createdAt} >= ${monthStart})::int leads,
            (select count(*) from ${s.leads} where ${leadScope} and ${s.leads.createdAt} >= ${prevMonthStart} and ${s.leads.createdAt} < ${prevSame})::int leads_prev`),
        app.db
          .select({ sales: sql<number>`coalesce(sum(${s.users.goalSales}),0)::int`, proposals: sql<number>`coalesce(sum(${s.users.goalProposals}),0)::int`, leads: sql<number>`coalesce(sum(${s.users.goalLeads}),0)::int` })
          .from(s.users)
          .where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), users === 'all' ? undefined : inArray(s.users.id, users.length ? users : [auth.userId]))),
        app.db
          .select({ id: s.activities.id, type: s.activities.type, title: s.activities.title, notes: s.activities.notes, dueAt: s.activities.dueAt, completedAt: s.activities.completedAt, rowVersion: s.activities.rowVersion, opportunityId: s.activities.opportunityId })
          .from(s.activities)
          .where(and(eq(s.activities.tenantId, auth.tenantId), isNull(s.activities.deletedAt), eq(s.activities.ownerId, auth.userId), sql`${localDay} = ${today}`))
          .orderBy(asc(s.activities.dueAt))
          .limit(5),
        app.db
          .select({ stage: s.opportunities.stage, n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${s.opportunities.valueCents}),0)::bigint` })
          .from(s.opportunities)
          .where(and(oppScope, eq(s.opportunities.pipelineId, pipe.id), sql`${s.opportunities.stage} not in ('ganha','perdida')`))
          .groupBy(s.opportunities.stage),
        opportunityQuery(app.db).where(oppScope).orderBy(desc(s.opportunities.updatedAt)).limit(5),
      ]);
      const m = month.rows[0]!;
      const g = goals[0]!;
      const a = actK[0]!;
      return {
        kpis: [
          oppK.find((k) => k.key === 'abertas')!,
          oppK.find((k) => k.key === 'valor')!,
          { key: 'atividades_hoje', label: 'Atividades hoje', value: a.today, delta: null, deltaAbs: a.today - a.yesterday, unit: 'count', formula: 'Suas atividades com data de hoje × ontem' },
          oppK.find((k) => k.key === 'propostas')!,
        ],
        goal: {
          sales: m.won,
          target: g.sales,
          progress: ratio(m.won, g.sales),
          delta: pctDelta(m.won, m.won_prev),
          formula: 'Vendas fechadas (ganho comercial) no mês até hoje ÷ meta de vendas cadastrada em Configurações → Usuários. Comparação: mesmo intervalo do mês anterior.',
        },
        performance: [
          { key: 'vendas', label: 'Vendas', value: m.won, target: g.sales, progress: ratio(m.won, g.sales) },
          { key: 'propostas', label: 'Propostas enviadas', value: m.proposals, target: g.proposals, progress: ratio(m.proposals, g.proposals) },
          { key: 'leads', label: 'Novos leads', value: m.leads, target: g.leads, progress: ratio(m.leads, g.leads) },
        ],
        agenda: agenda.map((x) => ({ ...x, overdue: !x.completedAt && !!x.dueAt && x.dueAt < new Date() })),
        pipelineName: pipe.name,
        pipeline: pipe.stages.filter((st) => st.kind === 'open').map((st) => {
          const row = pipeline.find((p) => p.stage === st.key);
          return { stage: st.key, name: st.name, color: st.color, count: row?.n ?? 0, valueCents: Number(row?.value ?? 0) };
        }),
        recent: recent.map((o) => opportunityDto(o)),
        today: new Date().toISOString(),
      };
    },
  }),
];
