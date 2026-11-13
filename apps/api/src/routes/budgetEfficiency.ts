/**
 * Relatórios e Inteligência → Eficiência orçamentária: custo realizado (competência) × resultado produzido.
 * Fontes e atribuição (cada número diz de onde vem):
 * - Custo: despesas realizadas do orçamento (lançamentos e gastos avulsos) pela data de competência, nos centros que a pessoa vê.
 * - Vendas: oportunidades ganhas no período (data da venda) e o valor delas. Centro ligado a um time: vendas do time (direta);
 *   centro sem time: vendas da empresa só como correlação.
 * - Campanha: custo dos lançamentos ligados à campanha × leads da campanha e vendas convertidas deles (direta).
 * - Relacionamento: brindes enviados às contas no período × vendas dessas contas até 180 dias depois (influenciada).
 */
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EFFICIENCY_SITUATION_INFO, diagnose, deviationOf, lowReturn, pctChange, ratio, type EfficiencySituation } from '@isp/domain';
import { defineRoute } from '../http/route';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import { visibleCostCenters } from './budgetCentral';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const addMonths = (m: string, n: number) => { const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const monthsBetween = (a: string, b: string) => { const out: string[] = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; };
const firstDay = (m: string) => `${m}-01`;
/** Custo por resultado só existe com custo registrado e resultado (senão é ausência de dado, não zero). */
const costPer = (cost: number, n: number | null | undefined) => (cost > 0 ? ratio(cost, n) : null);

type Window = { from: string; to: string };
async function numbers(db: DbOrTx, tenantId: string, ccIds: string[], w: Window) {
  const until = firstDay(addMonths(w.to, 1));
  const cost = ccIds.length ? await db.select({ cc: s.budgetExpenses.costCenterId, m: sql<string>`to_char(${s.budgetExpenses.occurredOn}, 'YYYY-MM')`, v: sql<number>`sum(${s.budgetExpenses.amountCents})::bigint` })
    .from(s.budgetExpenses).where(and(eq(s.budgetExpenses.tenantId, tenantId), inArray(s.budgetExpenses.costCenterId, ccIds), eq(s.budgetExpenses.status, 'valido'), gte(s.budgetExpenses.occurredOn, firstDay(w.from)), lt(s.budgetExpenses.occurredOn, until)))
    .groupBy(s.budgetExpenses.costCenterId, sql`2`) : [];
  const approved = ccIds.length ? await db.select({ cc: s.budgetLines.costCenterId, m: s.budgetLines.month, v: sql<number>`sum(coalesce(${s.budgetLines.approvedCents}, 0))::bigint` })
    .from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, tenantId), inArray(s.budgetLines.costCenterId, ccIds), isNull(s.budgetLines.deletedAt), inArray(s.budgetLines.approvalState, ['aprovado', 'aprovado_ressalvas']), sql`${s.budgetLines.month} between ${w.from} and ${w.to}`))
    .groupBy(s.budgetLines.costCenterId, s.budgetLines.month) : [];
  const sales = await db.select({ team: s.opportunities.teamId, m: sql<string>`to_char(${s.opportunities.wonAt} at time zone 'America/Sao_Paulo', 'YYYY-MM')`, n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${s.opportunities.valueCents}), 0)::bigint` })
    .from(s.opportunities).where(and(eq(s.opportunities.tenantId, tenantId), isNull(s.opportunities.deletedAt), eq(s.opportunities.stage, 'ganha'), gte(s.opportunities.wonAt, new Date(`${firstDay(w.from)}T03:00:00Z`)), lt(s.opportunities.wonAt, new Date(`${until}T03:00:00Z`))))
    .groupBy(s.opportunities.teamId, sql`2`);
  const leads = await db.select({ m: sql<string>`to_char(${s.leads.createdAt} at time zone 'America/Sao_Paulo', 'YYYY-MM')`, n: sql<number>`count(*)::int`, q: sql<number>`count(*) filter (where ${s.leads.status} in ('qualificado','convertido'))::int` })
    .from(s.leads).where(and(eq(s.leads.tenantId, tenantId), isNull(s.leads.deletedAt), gte(s.leads.createdAt, new Date(`${firstDay(w.from)}T03:00:00Z`)), lt(s.leads.createdAt, new Date(`${until}T03:00:00Z`)))).groupBy(sql`1`);
  const opps = await db.select({ m: sql<string>`to_char(${s.opportunities.createdAt} at time zone 'America/Sao_Paulo', 'YYYY-MM')`, n: sql<number>`count(*)::int` })
    .from(s.opportunities).where(and(eq(s.opportunities.tenantId, tenantId), isNull(s.opportunities.deletedAt), gte(s.opportunities.createdAt, new Date(`${firstDay(w.from)}T03:00:00Z`)), lt(s.opportunities.createdAt, new Date(`${until}T03:00:00Z`)))).groupBy(sql`1`);
  return { cost: cost.map((r) => ({ ...r, v: Number(r.v) })), approved: approved.map((r) => ({ ...r, v: Number(r.v) })), sales: sales.map((r) => ({ ...r, v: Number(r.v) })), leads, opps };
}

export const budgetEfficiencyRoutes = [
  defineRoute({
    method: 'GET', url: '/intelligence/budget-efficiency', summary: 'Eficiência orçamentária: investimento realizado × resultado (vendas, leads, oportunidades) no período e no anterior, por mês, por centro de custo, por campanha e relacionamento, com diagnóstico e fonte de cada número', tag: 'Inteligência', module: 'inteligencia', min: 'equipe',
    query: z.object({ from: month, to: month, costCenterId: z.string().uuid().optional() }).refine((q) => q.from <= q.to, 'Período inválido'),
    handler: async ({ app, auth, query }) => {
      const ccs = (await visibleCostCenters(app.db, auth)).filter((c) => !query.costCenterId || c.id === query.costCenterId);
      const ids = ccs.map((c) => c.id);
      const months = monthsBetween(query.from, query.to);
      const prevW = { from: addMonths(query.from, -months.length), to: addMonths(query.from, -1) };
      const [cur, prev] = await Promise.all([numbers(app.db, auth.tenantId, ids, query), numbers(app.db, auth.tenantId, ids, prevW)]);
      const sum = <T extends { v: number }>(xs: T[], f: (x: T) => boolean = () => true) => xs.filter(f).reduce((t, x) => t + x.v, 0);
      const count = <T extends { n: number }>(xs: T[], f: (x: T) => boolean = () => true) => xs.filter(f).reduce((t, x) => t + x.n, 0);
      const teamIds = new Set(ccs.map((c) => c.teamId).filter(Boolean));
      const salesScope = (r: { team: string | null }) => (query.costCenterId ? teamIds.has(r.team) : true);

      // totais
      const invested = sum(cur.cost), investedPrev = sum(prev.cost);
      const result = sum(cur.sales, salesScope), resultPrev = sum(prev.sales, salesScope);
      const wins = count(cur.sales, salesScope), winsPrev = count(prev.sales, salesScope);
      const eff = ratio(result, invested), effPrev = ratio(resultPrev, investedPrev);
      const approved = sum(cur.approved);
      const totals = {
        invested, approved, result, wins, leads: count(cur.leads), qualifiedLeads: cur.leads.reduce((t, x) => t + x.q, 0), opportunities: count(cur.opps),
        efficiency: eff, costPerSale: costPer(invested, wins), costPerLead: costPer(invested, count(cur.leads)), costPerQualifiedLead: costPer(invested, cur.leads.reduce((t, x) => t + x.q, 0)), costPerOpportunity: costPer(invested, count(cur.opps)),
        costVariation: pctChange(invested, investedPrev), performanceVariation: pctChange(result, resultPrev), efficiencyVariation: pctChange(eff, effPrev), deviation: deviationOf(invested, approved),
        marginalProductivity: invested !== investedPrev ? ratio(result - resultPrev, invested - investedPrev) : null,
        attribution: query.costCenterId && teamIds.size ? 'direta' : 'correlacao',
      };
      // série mensal
      const series = months.map((m) => {
        const c = sum(cur.cost, (x) => x.m === m), r = sum(cur.sales, (x) => x.m === m && salesScope(x)), n = count(cur.sales, (x) => x.m === m && salesScope(x));
        return { month: m, cost: c, approved: sum(cur.approved, (x) => x.m === m), result: r, wins: n, leads: count(cur.leads, (x) => x.m === m), efficiency: ratio(r, c), costPerSale: costPer(c, n) };
      });
      // por centro de custo
      const centers = ccs.map((c) => {
        const cost = sum(cur.cost, (x) => x.cc === c.id), costPrev = sum(prev.cost, (x) => x.cc === c.id), appr = sum(cur.approved, (x) => x.cc === c.id);
        const direct = !!c.teamId;
        const res = direct ? sum(cur.sales, (x) => x.team === c.teamId) : null, resPrev = direct ? sum(prev.sales, (x) => x.team === c.teamId) : null, w = direct ? count(cur.sales, (x) => x.team === c.teamId) : null;
        return { id: c.id, code: c.code, name: c.name, cost, approved: appr, executionPct: appr ? Math.round((cost / appr) * 1000) / 10 : null, result: res, wins: w, efficiency: ratio(res, cost), costPerSale: costPer(cost, w), attribution: direct ? 'direta' : 'sem_resultado_proprio', situations: diagnose({ cost, result: res, approved: appr }, { cost: costPrev, result: resPrev }) as EfficiencySituation[] };
      });
      for (const r of lowReturn(centers)) r.situations.push('alto_investimento_baixo_retorno');
      // campanhas (atribuição direta: lançamentos ligados × leads da campanha e vendas convertidas deles)
      const until = firstDay(addMonths(query.to, 1));
      const campCost = ids.length ? await app.db.select({ id: s.budgetLines.campaignId, v: sql<number>`coalesce(sum(e.amount_cents), 0)::bigint` }).from(s.budgetLines)
        .innerJoin(sql`budget_expenses e`, sql`e.line_id = ${s.budgetLines.id} and e.status = 'valido' and e.occurred_on >= ${firstDay(query.from)} and e.occurred_on < ${until}`)
        .where(and(eq(s.budgetLines.tenantId, auth.tenantId), inArray(s.budgetLines.costCenterId, ids), sql`${s.budgetLines.campaignId} is not null`)).groupBy(s.budgetLines.campaignId) : [];
      const campIds = campCost.map((c) => c.id!).filter(Boolean);
      const campLeads = campIds.length ? await app.db.select({ id: s.leads.campaignId, leads: sql<number>`count(*)::int`, qualified: sql<number>`count(*) filter (where ${s.leads.status} in ('qualificado','convertido'))::int`, opps: sql<number>`count(o.id)::int`, wins: sql<number>`count(o.id) filter (where o.stage = 'ganha')::int`, revenue: sql<number>`coalesce(sum(o.value_cents) filter (where o.stage = 'ganha'), 0)::bigint` })
        .from(s.leads).leftJoin(sql`opportunities o`, sql`o.id = ${s.leads.convertedOpportunityId} and o.deleted_at is null`).where(and(eq(s.leads.tenantId, auth.tenantId), inArray(s.leads.campaignId, campIds), isNull(s.leads.deletedAt))).groupBy(s.leads.campaignId) : [];
      const campNames = campIds.length ? await app.db.select({ id: s.campaigns.id, name: s.campaigns.name }).from(s.campaigns).where(inArray(s.campaigns.id, campIds)) : [];
      const campaigns = campCost.filter((c) => c.id).map((c) => {
        const l = campLeads.find((x) => x.id === c.id), cost = Number(c.v), rev = Number(l?.revenue ?? 0);
        return { id: c.id!, name: campNames.find((n) => n.id === c.id)?.name ?? 'Campanha', cost, leads: l?.leads ?? 0, qualifiedLeads: l?.qualified ?? 0, opportunities: l?.opps ?? 0, wins: l?.wins ?? 0, revenue: rev, costPerLead: costPer(cost, l?.leads), costPerQualifiedLead: costPer(cost, l?.qualified), costPerOpportunity: costPer(cost, l?.opps), revenuePerReal: ratio(rev, cost), attribution: 'direta' };
      }).sort((a, b) => b.cost - a.cost);
      // relacionamento (influenciado): brindes enviados às contas × vendas dessas contas em até 180 dias
      const rel = await app.db.execute<{ accounts: number; invested: string; revenue: string; wins: number }>(sql`
        with d as (select contact_id, min(occurred_on) as first_on, sum(total_cents) as cents from gift_deliveries
          where tenant_id = ${auth.tenantId} and cancelled_at is null and contact_id is not null and occurred_on >= ${firstDay(query.from)} and occurred_on < ${until} group by contact_id)
        select count(*)::int as accounts, coalesce(sum(d.cents), 0)::bigint as invested,
          coalesce(sum((select coalesce(sum(o.value_cents), 0) from opportunities o where o.contact_id = d.contact_id and o.stage = 'ganha' and o.deleted_at is null and o.won_at >= d.first_on and o.won_at < d.first_on + interval '180 days')), 0)::bigint as revenue,
          coalesce(sum((select count(*) from opportunities o where o.contact_id = d.contact_id and o.stage = 'ganha' and o.deleted_at is null and o.won_at >= d.first_on and o.won_at < d.first_on + interval '180 days')), 0)::int as wins
        from d`);
      const r0 = rel.rows[0]!;
      const relationship = { accounts: r0.accounts, invested: Number(r0.invested), influencedRevenue: Number(r0.revenue), influencedWins: r0.wins, investmentPerAccount: ratio(Number(r0.invested), r0.accounts), attribution: 'influenciada' };
      const alerts = centers.flatMap((c) => c.situations.filter((x) => EFFICIENCY_SITUATION_INFO[x].tone === 'atencao').map((x) => ({ costCenterId: c.id, code: c.code, situation: x, ...EFFICIENCY_SITUATION_INFO[x] })));
      return {
        period: { ...query, previous: prevW }, totals, series, centers, campaigns, relationship, alerts,
        sources: {
          custo: 'Despesas realizadas do orçamento (competência), nos centros de custo que você vê.',
          vendas: 'Oportunidades ganhas no período (data da venda) e o valor delas. Centro ligado a um time conta as vendas do time (atribuição direta); no total da empresa é correlação.',
          campanhas: 'Custo dos lançamentos ligados à campanha × leads da campanha e vendas convertidas desses leads (atribuição direta). A receita da conta inteira não é atribuída à campanha.',
          relacionamento: 'Brindes enviados às contas no período × vendas dessas contas em até 180 dias depois do primeiro envio (influenciado, não é causa).',
          maturação: 'Resultados de investimento podem aparecer em períodos seguintes; redução de gasto sozinha não é eficiência.',
        },
      };
    },
  }),
];
