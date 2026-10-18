import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PeriodQuery, ReportQuery } from '@isp/shared';
import { CONTRACT_LABELS, csvSafe, STAGE_LABELS, type ContractRequestStatus, SEGMENT_PRODUCT_LABELS, type OpportunityStage, type Segment } from '@isp/domain';
import { defineRoute } from '../http/route';
import type { AuthContext } from '../http/context';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { ownerScope, visibleUserIds, level } from '../services/scope';
import { opportunityQuery } from '../services/opportunities';
import { resolvePipeline } from '../services/instructions';
import { pctDelta } from '../services/metrics';
import { monthsEnding, periodBounds } from '../services/period';
import { audit } from '../services/audit';

type Mod = 'relatorios' | 'inteligencia';
export const oppScopeFor = (auth: AuthContext, m: Mod) => ownerScope(auth, m, { tenantId: s.opportunities.tenantId, ownerId: s.opportunities.ownerId, deletedAt: s.opportunities.deletedAt });
export const leadScopeFor = (auth: AuthContext, m: Mod) => ownerScope(auth, m, { tenantId: s.leads.tenantId, ownerId: s.leads.ownerId, deletedAt: s.leads.deletedAt });

/** Origem dos leads criados no período (com percentual sobre o total). */
export async function leadOrigins(db: DB, auth: AuthContext, m: Mod, p: ReturnType<typeof periodBounds>) {
  const rows = await db
    .select({ source: sql<string>`coalesce(${s.leadSources.name}, 'Outros')`, n: sql<number>`count(*)::int` })
    .from(s.leads)
    .leftJoin(s.leadSources, eq(s.leadSources.id, s.leads.sourceId))
    .where(and(leadScopeFor(auth, m), p.inCur(s.leads.createdAt)))
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`));
  const total = rows.reduce((a, r) => a + r.n, 0);
  // agrupa a cauda em "Outros" para caber no gráfico (até 5 origens nomeadas)
  const named = rows.filter((r) => r.source !== 'Outros').slice(0, 5);
  const rest = total - named.reduce((a, r) => a + r.n, 0);
  const items = [...named, ...(rest > 0 ? [{ source: 'Outros', n: rest }] : [])].map((r) => ({ ...r, share: total ? r.n / total : null }));
  return { total, items };
}

export async function salesByPlan(db: DB, auth: AuthContext, m: Mod, p: ReturnType<typeof periodBounds>) {
  const rows = await db
    .select({ plan: sql<string>`coalesce(${s.plans.name}, 'Sem plano')`, n: sql<number>`count(*)::int` })
    .from(s.opportunities)
    .leftJoin(s.plans, eq(s.plans.id, s.opportunities.planId))
    .where(and(oppScopeFor(auth, m), eq(s.opportunities.stage, 'ganha'), p.inCur(s.opportunities.wonAt)))
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`));
  const total = rows.reduce((a, r) => a + r.n, 0);
  const top = rows.slice(0, 4);
  const rest = total - top.reduce((a, r) => a + r.n, 0);
  return { total, items: [...top, ...(rest > 0 ? [{ plan: 'Outros', n: rest }] : [])].map((r) => ({ ...r, share: total ? r.n / total : null })) };
}

export async function salesTotals(db: DB, auth: AuthContext, m: Mod, p: ReturnType<typeof periodBounds>) {
  const [r] = await db
    .select({
      won: sql<number>`count(*) filter (where ${p.inCur(s.opportunities.wonAt)})::int`,
      wonPrev: sql<number>`count(*) filter (where ${p.inPrev(s.opportunities.wonAt)})::int`,
      value: sql<number>`coalesce(sum(${s.opportunities.valueCents}) filter (where ${p.inCur(s.opportunities.wonAt)}),0)::bigint`,
      valuePrev: sql<number>`coalesce(sum(${s.opportunities.valueCents}) filter (where ${p.inPrev(s.opportunities.wonAt)}),0)::bigint`,
      days: sql<number | null>`avg(extract(epoch from (${s.opportunities.wonAt} - ${s.opportunities.createdAt}))/86400) filter (where ${p.inCur(s.opportunities.wonAt)})`,
      daysPrev: sql<number | null>`avg(extract(epoch from (${s.opportunities.wonAt} - ${s.opportunities.createdAt}))/86400) filter (where ${p.inPrev(s.opportunities.wonAt)})`,
    })
    .from(s.opportunities)
    .where(and(oppScopeFor(auth, m), eq(s.opportunities.stage, 'ganha')));
  const [l] = await db
    .select({ cur: sql<number>`count(*) filter (where ${p.inCur(s.leads.createdAt)})::int`, prev: sql<number>`count(*) filter (where ${p.inPrev(s.leads.createdAt)})::int` })
    .from(s.leads)
    .where(leadScopeFor(auth, m));
  return { ...r!, value: Number(r!.value), valuePrev: Number(r!.valuePrev), days: r!.days === null ? null : Number(r!.days), daysPrev: r!.daysPrev === null ? null : Number(r!.daysPrev), leads: l!.cur, leadsPrev: l!.prev };
}

export async function monthlySeries(db: DB, auth: AuthContext, m: Mod, to: string, months = 5) {
  const tz = auth.timezone;
  const keys = monthsEnding(to, months);
  const won = await db
    .select({ month: sql<string>`to_char(${s.opportunities.wonAt} at time zone ${tz}, 'YYYY-MM')`, n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${s.opportunities.valueCents}),0)::bigint` })
    .from(s.opportunities)
    .where(and(oppScopeFor(auth, m), eq(s.opportunities.stage, 'ganha'), inArray(sql`to_char(${s.opportunities.wonAt} at time zone ${tz}, 'YYYY-MM')`, keys)))
    .groupBy(sql`1`);
  const leads = await db
    .select({ month: sql<string>`to_char(${s.leads.createdAt} at time zone ${tz}, 'YYYY-MM')`, n: sql<number>`count(*)::int` })
    .from(s.leads)
    .where(and(leadScopeFor(auth, m), inArray(sql`to_char(${s.leads.createdAt} at time zone ${tz}, 'YYYY-MM')`, keys)))
    .groupBy(sql`1`);
  return keys.map((k) => ({ month: k, sales: won.find((w) => w.month === k)?.n ?? 0, revenueCents: Number(won.find((w) => w.month === k)?.value ?? 0), leads: leads.find((x) => x.month === k)?.n ?? 0 }));
}

const ExportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['vendas', 'leads', 'oportunidades']).default('vendas'),
});

export const reportRoutes = [
  defineRoute({
    method: 'GET',
    url: '/reports/overview',
    summary: 'Relatórios — visão geral do período (vendas, leads, funil, planos, equipe)',
    tag: 'Relatórios',
    module: 'relatorios',
    query: ReportQuery,
    handler: async ({ app, auth, query }) => {
      const p = periodBounds(auth, query.from, query.to);
      const pipe = await resolvePipeline(app.db, auth.tenantId, { pipelineId: query.pipelineId });
      const [t, evolution, origins, plans, statusRows, latest] = await Promise.all([
        salesTotals(app.db, auth, 'relatorios', p),
        monthlySeries(app.db, auth, 'relatorios', query.to, 5),
        leadOrigins(app.db, auth, 'relatorios', p),
        salesByPlan(app.db, auth, 'relatorios', p),
        app.db
          .select({ stage: s.opportunities.stage, n: sql<number>`count(*)::int` })
          .from(s.opportunities)
          .where(and(oppScopeFor(auth, 'relatorios'), eq(s.opportunities.pipelineId, pipe.id), p.inCur(s.opportunities.createdAt)))
          .groupBy(s.opportunities.stage),
        opportunityQuery(app.db)
          .where(and(oppScopeFor(auth, 'relatorios'), eq(s.opportunities.stage, 'ganha'), p.inCur(s.opportunities.wonAt)))
          .orderBy(desc(s.opportunities.wonAt))
          .limit(5),
      ]);
      // ranking só existe a partir do nível Equipe; no nível Próprio o vendedor vê apenas a própria linha
      const users = visibleUserIds(auth, 'relatorios');
      const team = await app.db
        .select({
          userId: s.users.id,
          name: s.users.name,
          hasAvatar: sql<boolean>`exists(select 1 from user_avatars ua where ua.user_id = "users"."id")`,
          won: sql<number>`(select count(*) from opportunities o where o.owner_id = "users"."id" and o.tenant_id = ${auth.tenantId} and o.stage = 'ganha' and ${p.inCur(sql`o.won_at`)})::int`,
          wonPrev: sql<number>`(select count(*) from opportunities o where o.owner_id = "users"."id" and o.tenant_id = ${auth.tenantId} and o.stage = 'ganha' and ${p.inPrev(sql`o.won_at`)})::int`,
        })
        .from(s.users)
        .where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), users === 'all' ? undefined : inArray(s.users.id, users.length ? users : [auth.userId])));
      const statusStages = pipe.stages.filter((st) => st.kind !== 'won');
      const statusTotal = statusStages.reduce((a, st) => a + (statusRows.find((r) => r.stage === st.key)?.n ?? 0), 0);
      return {
        period: p.label,
        kpis: [
          { key: 'receita', label: 'Receita potencial', value: t.value, delta: pctDelta(t.value, t.valuePrev), unit: 'brl_cents', formula: 'Soma do valor mensal (catálogo) das vendas fechadas no período. Não é faturamento recebido.' },
          { key: 'vendas', label: 'Vendas fechadas', value: t.won, delta: pctDelta(t.won, t.wonPrev), unit: 'count', formula: 'Oportunidades marcadas como venda fechada (ganho comercial) no período. Não é contrato confirmado no IXC.' },
          { key: 'leads', label: 'Novos leads', value: t.leads, delta: pctDelta(t.leads, t.leadsPrev), unit: 'count', formula: 'Leads criados no período' },
          { key: 'tempo', label: 'Tempo médio de fechamento', value: t.days, delta: pctDelta(t.days, t.daysPrev), unit: 'days', lowerIsBetter: true, formula: 'Média de dias entre criação e venda fechada, para vendas do período' },
        ],
        evolution,
        origins,
        status: { pipeline: { id: pipe.id, name: pipe.name }, total: statusTotal, items: statusStages.map((st) => { const n = statusRows.find((r) => r.stage === st.key)?.n ?? 0; return { stage: st.key, label: st.name, color: st.color, n, share: statusTotal ? n / statusTotal : null }; }) },
        plans,
        team: {
          ranking: level(auth, 'relatorios') !== 'proprio',
          items: team.map((u) => ({ ...u, delta: pctDelta(u.won, u.wonPrev) })).sort((a, b) => b.won - a.won),
        },
        latest: latest.map((o) => ({ id: o.id, contactName: o.contactName, segment: o.contactSegment, segmentLabel: SEGMENT_PRODUCT_LABELS[o.contactSegment as Segment], planName: o.planName, valueCents: o.valueCents, ownerName: o.ownerName, ownerId: o.ownerId, ownerHasAvatar: o.ownerHasAvatar, wonAt: o.wonAt, contractRequestStatus: o.contractRequestStatus })),
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/reports/export',
    summary: 'Exporta CSV do período (vendas, leads ou oportunidades), respeitando o nível de acesso',
    tag: 'Relatórios',
    module: 'relatorios',
    query: ExportQuery,
    handler: async ({ app, auth, query, reply, req }) => {
      const p = periodBounds(auth, query.from, query.to);
      let header: string[] = [];
      let lines: unknown[][] = [];
      if (query.kind === 'leads') {
        const rows = await app.db
          .select({ name: s.contacts.name, status: s.leads.status, source: s.leadSources.name, city: s.contacts.city, owner: s.users.name, createdAt: s.leads.createdAt })
          .from(s.leads)
          .innerJoin(s.contacts, eq(s.contacts.id, s.leads.contactId))
          .leftJoin(s.leadSources, eq(s.leadSources.id, s.leads.sourceId))
          .leftJoin(s.users, eq(s.users.id, s.leads.ownerId))
          .where(and(leadScopeFor(auth, 'relatorios'), p.inCur(s.leads.createdAt)));
        header = ['Nome', 'Status', 'Origem', 'Cidade', 'Responsável', 'Criado em'];
        lines = rows.map((r) => [r.name, r.status, r.source, r.city, r.owner, r.createdAt.toISOString()]);
      } else {
        const rows = await opportunityQuery(app.db).where(
          and(oppScopeFor(auth, 'relatorios'), query.kind === 'vendas' ? and(eq(s.opportunities.stage, 'ganha'), p.inCur(s.opportunities.wonAt)) : p.inCur(s.opportunities.createdAt)),
        );
        header = ['Código', 'Cliente', 'Plano', 'Valor mensal (R$)', 'Etapa', 'Responsável', 'Criada em', 'Venda fechada em', 'Contrato'];
        lines = rows.map((o) => [`OP-${o.code}`, o.contactName, o.planName, o.valueCents === null ? '' : (o.valueCents / 100).toFixed(2).replace('.', ','), o.stageName ?? STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage, o.ownerName, o.createdAt.toISOString(), o.wonAt?.toISOString() ?? '', CONTRACT_LABELS[o.contractRequestStatus as ContractRequestStatus] ?? o.contractRequestStatus]);
      }
      await audit(app.db, req, { action: 'export.csv', entityType: 'report', metadata: { kind: query.kind, from: query.from, to: query.to, rows: lines.length } });
      const meta = [`# ISP Sprint — exportação de ${query.kind}`, `# Período: ${query.from} a ${query.to} (${auth.timezone})`, `# Gerado em: ${new Date().toISOString()} por ${auth.name}`];
      const csv = '﻿' + [...meta, header.map(csvSafe).join(';'), ...lines.map((l) => l.map(csvSafe).join(';'))].join('\r\n');
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="isp-sprint-${query.kind}-${query.from}-a-${query.to}.csv"`);
      return reply.send(csv);
    },
  }),
];
