import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PeriodQuery } from '@isp/shared';
import { consolidateCashflow, type EconResult } from '@isp/domain';
import { defineRoute } from '../http/route';
import * as s from '../db/schema';
import { ownerScope, visibleUserIds } from '../services/scope';
import { requireAction } from '../services/modules';
import { pctDelta, ratio } from '../services/metrics';
import { periodBounds } from '../services/period';
import { leadOrigins, leadScopeFor, monthlySeries, oppScopeFor, salesByPlan, salesTotals } from './reports';

const MIN_SAMPLE = 10;
const pct = (x: number | null) => (x === null ? 'N/D' : `${Math.round(x * 100)}%`);

/**
 * Inteligência: estatística descritiva com amostra visível. Os "insights" são frases geradas
 * por regras fixas sobre estes números — só aparecem quando a amostra tem ao menos 10 registros.
 * Correlação não é apresentada como causa.
 */
export const intelligenceRoutes = [
  defineRoute({
    method: 'GET',
    url: '/intelligence/economics',
    summary: 'Fluxo de caixa consolidado das oportunidades com viabilidade econômica salva (ganhas no mês do fechamento, em andamento a partir deste mês)',
    tag: 'Inteligência',
    module: 'inteligencia',
    query: z.object({ status: z.enum(['todas', 'ganhas', 'andamento']).default('todas') }),
    handler: async ({ app, auth, query }) => {
      requireAction(auth, 'ver_financeiro', 'O fluxo de caixa das vendas mostra valores financeiros que seu perfil não vê.');
      const month = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(d);
      const rows = await app.db
        .select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, wonAt: s.opportunities.wonAt, account: s.contacts.name, result: s.opportunityEconomics.result })
        .from(s.opportunityEconomics)
        .innerJoin(s.opportunities, eq(s.opportunities.id, s.opportunityEconomics.opportunityId))
        .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
        .where(and(oppScopeFor(auth, 'inteligencia'), eq(s.opportunityEconomics.tenantId, auth.tenantId), ne(s.opportunities.stage, 'perdida'),
          ...(query.status === 'ganhas' ? [eq(s.opportunities.stage, 'ganha')] : query.status === 'andamento' ? [ne(s.opportunities.stage, 'ganha')] : [])));
      const now = month(new Date());
      const items = rows.map((r) => {
        const e = r.result as unknown as EconResult;
        return {
          id: r.id, code: r.code, title: r.title, account: r.account, won: r.stage === 'ganha', startMonth: r.wonAt ? month(r.wonAt) : now,
          verdict: e.verdict, mode: e.mode, investmentCents: Math.max(0, -(e.cashflow?.[0] ?? 0)), contributionCents: e.kpi?.contributionCents ?? null,
          npvCents: e.kpi?.npvCents ?? null, paybackMonths: e.kpi?.paybackMonths ?? null, months: Math.max(0, (e.cashflow?.length ?? 1) - 1), cashflow: e.cashflow ?? [],
        };
      });
      const flow = consolidateCashflow(items.map((i) => ({ startMonth: i.startMonth, flows: i.cashflow })));
      const firstPositive = flow.cumulative.findIndex((v, k) => v >= 0 && flow.cumulative.slice(0, k).some((x) => x < 0));
      return {
        flow,
        totals: {
          n: items.length,
          investmentCents: items.reduce((t, i) => t + i.investmentCents, 0),
          npvCents: items.reduce((t, i) => t + (i.npvCents ?? 0), 0),
          resultCents: flow.cumulative.at(-1) ?? 0,
          lowestCents: Math.min(0, ...flow.cumulative),
          breakEvenMonth: firstPositive >= 0 ? flow.months[firstPositive] : null,
        },
        items: items.map(({ cashflow: _c, ...i }) => i).sort((a, b) => (b.npvCents ?? 0) - (a.npvCents ?? 0)),
      };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/intelligence/overview',
    summary: 'Inteligência: desempenho comercial, origem, conversão por etapa, planos, regiões, equipe e insights',
    tag: 'Inteligência',
    module: 'inteligencia',
    query: PeriodQuery,
    handler: async ({ app, auth, query }) => {
      const p = periodBounds(auth, query.from, query.to);
      const leadScope = leadScopeFor(auth, 'inteligencia');
      const [t, series, origins, plans] = await Promise.all([
        salesTotals(app.db, auth, 'inteligencia', p),
        monthlySeries(app.db, auth, 'inteligencia', query.to, 5),
        leadOrigins(app.db, auth, 'inteligencia', p),
        salesByPlan(app.db, auth, 'inteligencia', p),
      ]);

      const [active] = await app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.customers)
        .innerJoin(s.contacts, eq(s.contacts.id, s.customers.contactId))
        .where(and(ownerScope(auth, 'inteligencia', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt }), inArray(s.customers.lifecycle, ['ativo', 'reativado'])));

      // Funil por coorte: leads CRIADOS no período e até onde chegaram (sem misturar coortes).
      const [f] = await app.db
        .select({
          total: sql<number>`count(*)::int`,
          contacted: sql<number>`count(*) filter (where ${s.leads.firstContactAt} is not null or ${s.leads.status} in ('em_contato','qualificado','convertido'))::int`,
          qualified: sql<number>`count(*) filter (where ${s.leads.status} in ('qualificado','convertido'))::int`,
          proposals: sql<number>`count(*) filter (where o.proposal_status in ('enviada','aceita') or o.stage = 'ganha')::int`,
          won: sql<number>`count(*) filter (where o.stage = 'ganha')::int`,
        })
        .from(s.leads)
        .leftJoin(sql`opportunities o`, sql`o.id = ${s.leads.convertedOpportunityId}`)
        .where(and(leadScope, p.inCur(s.leads.createdAt)));
      const funnel = [
        { key: 'novos', label: 'Novos leads', n: f!.total },
        { key: 'contato', label: 'Em contato', n: f!.contacted },
        { key: 'qualificados', label: 'Qualificados', n: f!.qualified },
        { key: 'propostas', label: 'Propostas', n: f!.proposals },
        { key: 'vendas', label: 'Vendas fechadas', n: f!.won },
      ].map((x) => ({ ...x, share: ratio(x.n, f!.total) }));

      const cityRows = await app.db
        .select({ city: s.contacts.city, cur: sql<number>`count(*) filter (where ${p.inCur(s.leads.createdAt)})::int`, prev: sql<number>`count(*) filter (where ${p.inPrev(s.leads.createdAt)})::int` })
        .from(s.leads)
        .innerJoin(s.contacts, eq(s.contacts.id, s.leads.contactId))
        .where(and(leadScope, isNotNull(s.contacts.city)))
        .groupBy(s.contacts.city)
        .orderBy(desc(sql`2`));
      const cityTotal = cityRows.reduce((a, r) => a + r.cur, 0);
      const topCities = cityRows.filter((r) => r.cur > 0).slice(0, 5);
      const restCities = cityTotal - topCities.reduce((a, r) => a + r.cur, 0);

      const users = visibleUserIds(auth, 'inteligencia');
      const team = await app.db
        .select({
          userId: s.users.id,
          name: s.users.name,
          hasAvatar: sql<boolean>`exists(select 1 from user_avatars ua where ua.user_id = "users"."id")`,
          calls: sql<number>`(select count(*) from activities a where a.owner_id = "users"."id" and a.tenant_id = ${auth.tenantId} and a.type = 'ligacao' and a.completed_at is not null and ${p.inCur(sql`a.completed_at`)})::int`,
          emails: sql<number>`(select count(*) from activities a where a.owner_id = "users"."id" and a.tenant_id = ${auth.tenantId} and a.type in ('email','whatsapp') and a.completed_at is not null and ${p.inCur(sql`a.completed_at`)})::int`,
          meetings: sql<number>`(select count(*) from activities a where a.owner_id = "users"."id" and a.tenant_id = ${auth.tenantId} and a.type in ('reuniao','visita') and a.completed_at is not null and ${p.inCur(sql`a.completed_at`)})::int`,
          total: sql<number>`(select count(*) from activities a where a.owner_id = "users"."id" and a.tenant_id = ${auth.tenantId} and a.completed_at is not null and ${p.inCur(sql`a.completed_at`)})::int`,
        })
        .from(s.users)
        .where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), users === 'all' ? undefined : inArray(s.users.id, users.length ? users : [auth.userId])));

      // ------------------------------------------------------------ insights por regra
      const insights: { kind: 'crescimento' | 'plano' | 'conversao' | 'regiao'; title: string; detail: string; n: number }[] = [];
      const leadDelta = pctDelta(t.leads, t.leadsPrev);
      if (t.leads >= MIN_SAMPLE && t.leadsPrev >= MIN_SAMPLE && leadDelta !== null) {
        const bySource = await app.db
          .select({ source: s.leadSources.name, cur: sql<number>`count(*) filter (where ${p.inCur(s.leads.createdAt)})::int`, prev: sql<number>`count(*) filter (where ${p.inPrev(s.leads.createdAt)})::int` })
          .from(s.leads)
          .innerJoin(s.leadSources, eq(s.leadSources.id, s.leads.sourceId))
          .where(leadScope)
          .groupBy(s.leadSources.name);
        const growers = bySource.map((r) => ({ ...r, diff: r.cur - r.prev })).filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 2);
        insights.push({
          kind: 'crescimento',
          title: `A geração de leads ${leadDelta >= 0 ? 'aumentou' : 'caiu'} ${pct(Math.abs(leadDelta))} em relação ao período anterior.`,
          detail: growers.length ? `O maior crescimento veio de ${growers.map((g) => g.source).join(' e ')}.` : 'Nenhuma origem cresceu no período.',
          n: t.leads + t.leadsPrev,
        });
      }
      if (plans.total >= MIN_SAMPLE && plans.items[0]) {
        const others = plans.items.slice(1, 3).map((x) => x.plan).filter((x) => x !== 'Outros');
        insights.push({
          kind: 'plano',
          title: `O plano ${plans.items[0].plan} representa ${pct(plans.items[0].share)} das vendas do período.`,
          detail: others.length ? `Considerar ações específicas para ${others.join(' e ')}.` : 'Vendas concentradas em um único plano.',
          n: plans.total,
        });
      }
      if (f!.total >= MIN_SAMPLE) {
        const steps = funnel.slice(1).map((x, i) => ({ label: x.label, drop: (funnel[i]!.n - x.n) / Math.max(1, funnel[i]!.n) }));
        const worst = steps.sort((a, b) => b.drop - a.drop)[0];
        insights.push({
          kind: 'conversao',
          title: `A taxa de conversão de leads para vendas é de ${pct(ratio(f!.won, f!.total))}.`,
          detail: worst ? `Maior perda na passagem para ${worst.label.toLowerCase()} (${pct(worst.drop)} dos leads da etapa anterior).` : '',
          n: f!.total,
        });
      }
      if (cityTotal >= MIN_SAMPLE && topCities[0]) {
        const growing = cityRows.filter((r) => r.city !== topCities[0]!.city && r.cur > r.prev).sort((a, b) => b.cur - b.prev - (a.cur - a.prev)).slice(0, 2);
        insights.push({
          kind: 'regiao',
          title: `${topCities[0].city} concentra ${pct(topCities[0].cur / cityTotal)} dos leads gerados.`,
          detail: growing.length ? `Vale reforçar ações em ${growing.map((g) => g.city).join(' e ')}, que estão em crescimento.` : 'Nenhuma outra cidade cresceu no período.',
          n: cityTotal,
        });
      }

      return {
        period: p.label,
        kpis: [
          { key: 'clientes', label: 'Clientes ativos', value: active!.n, delta: null, unit: 'count', formula: 'Clientes com situação Ativo ou Reativado. Sem histórico para comparar até a sincronização do IXC.' },
          { key: 'leads', label: 'Novos leads', value: t.leads, delta: pctDelta(t.leads, t.leadsPrev), unit: 'count', formula: 'Leads criados no período × período anterior de mesmo tamanho' },
          { key: 'vendas', label: 'Vendas fechadas', value: t.won, delta: pctDelta(t.won, t.wonPrev), unit: 'count', formula: 'Vendas fechadas (ganho comercial) no período. Não é contrato confirmado.' },
          { key: 'receita', label: 'Receita gerada', value: t.value, delta: pctDelta(t.value, t.valuePrev), unit: 'brl_cents', formula: 'Soma do valor mensal (catálogo) das vendas fechadas no período. Não é faturamento recebido.' },
        ],
        series,
        origins,
        funnel,
        plans,
        regions: {
          total: cityTotal,
          items: [...topCities.map((r) => ({ city: r.city!, n: r.cur, share: r.cur / cityTotal })), ...(restCities > 0 ? [{ city: 'Demais regiões', n: restCities, share: restCities / cityTotal }] : [])],
          map: cityRows.filter((r) => r.cur > 0).map((r) => ({ city: r.city!, n: r.cur })),
        },
        team,
        insights,
        minSample: MIN_SAMPLE,
      };
    },
  }),
];
