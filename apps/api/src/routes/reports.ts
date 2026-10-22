import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { requireAction } from '../services/modules';
import { z } from 'zod';
import { PeriodQuery, ReportQuery } from '@isp/shared';
import { CONTRACT_LABELS, csvSafe, STAGE_LABELS, type ContractRequestStatus, SEGMENT_PRODUCT_LABELS, type OpportunityStage, type Segment } from '@isp/domain';
import { defineRoute } from '../http/route';
import type { AuthContext } from '../http/context';
import type { DB, DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { ownerScope, visibleUserIds, level } from '../services/scope';
import { opportunityQuery } from '../services/opportunities';
import { resolvePipeline } from '../services/instructions';
import { pctDelta } from '../services/metrics';
import { monthsEnding, periodBounds } from '../services/period';
import { audit } from '../services/audit';
import { occupiesPort, portReservations, portUsage, reservesPort } from '../services/ports';

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
  kind: z.enum(['vendas', 'leads', 'oportunidades', 'comissoes']).default('vendas'),
});

async function commissionRows(db: DbOrTx, auth: AuthContext, p: ReturnType<typeof periodBounds>) {
  const rows = await opportunityQuery(db)
    .where(and(oppScopeFor(auth, 'relatorios'), eq(s.opportunities.stage, 'ganha'), p.inCur(s.opportunities.wonAt)))
    .orderBy(desc(s.opportunities.wonAt));
  return rows.map((o) => ({ ...o, rule: ((o.viability as { commission?: { rule?: string } } | null)?.commission?.rule) ?? null }));
}

export const reportRoutes = [
  defineRoute({
    method: 'GET',
    url: '/reports/ports',
    summary: 'Ocupação das portas da CTO por condomínio e quem ocupa (nomes no escopo do usuário)',
    tag: 'Relatórios',
    module: 'relatorios',
    handler: async ({ app, auth }) => {
      const condos = await app.db
        .select({ id: s.condominiums.id, name: s.condominiums.name, regionName: s.regions.name, ports: s.condominiums.ctoPorts, active: s.condominiums.active })
        .from(s.condominiums)
        .innerJoin(s.regions, eq(s.regions.id, s.condominiums.regionId))
        .where(eq(s.condominiums.tenantId, auth.tenantId));
      const used = await portUsage(app.db, auth.tenantId);
      const reservedMap = await portReservations(app.db, auth.tenantId);
      const reservations = await app.db
        .select({ opportunityId: s.opportunities.id, code: s.opportunities.code, condominiumId: s.opportunities.condominiumId, contactName: s.contacts.name, block: s.opportunities.installBlock, unit: s.opportunities.installUnit, stage: s.opportunities.stage, since: s.opportunities.createdAt, ownerName: s.users.name })
        .from(s.opportunities)
        .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
        .innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId))
        .where(and(reservesPort(auth.tenantId), oppScopeFor(auth, 'relatorios')))
        .orderBy(desc(s.opportunities.createdAt));
      const clients = await app.db
        .select({ opportunityId: s.opportunities.id, code: s.opportunities.code, condominiumId: s.opportunities.condominiumId, contactName: s.contacts.name, block: s.opportunities.installBlock, unit: s.opportunities.installUnit, wonAt: s.opportunities.wonAt, ownerName: s.users.name })
        .from(s.opportunities)
        .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
        .innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId))
        .where(and(occupiesPort(auth.tenantId), oppScopeFor(auth, 'relatorios')))
        .orderBy(desc(s.opportunities.wonAt));
      const items = condos
        .filter((c) => c.active || (used.get(c.id) ?? 0) > 0 || (reservedMap.get(c.id) ?? 0) > 0)
        .map((c) => {
          const u = used.get(c.id) ?? 0;
          const r = reservedMap.get(c.id) ?? 0;
          return { ...c, used: u, reserved: r, free: c.ports == null ? null : Math.max(0, c.ports - u - r), rate: c.ports ? u / c.ports : null, commitRate: c.ports ? (u + r) / c.ports : null, clients: clients.filter((x) => x.condominiumId === c.id), reservations: reservations.filter((x) => x.condominiumId === c.id) };
        })
        .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
      const withPorts = items.filter((i) => i.ports);
      const total = withPorts.reduce((a, i) => a + i.ports!, 0);
      const usedTotal = withPorts.reduce((a, i) => a + Math.min(i.used, i.ports!), 0);
      const reservedTotal = withPorts.reduce((a, i) => a + i.reserved, 0);
      return { total, used: usedTotal, reserved: reservedTotal, free: Math.max(0, total - usedTotal - reservedTotal), rate: total ? usedTotal / total : null, items };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/reports/commissions',
    summary: 'Comissões das vendas fechadas no período (vendedor vê só as suas; supervisão a equipe; gerência todas)',
    tag: 'Relatórios',
    module: 'relatorios',
    query: PeriodQuery,
    handler: async ({ app, auth, query }) => {
      const p = periodBounds(auth, query.from, query.to);
      const rows = await commissionRows(app.db, auth, p);
      const bySeller = new Map<string, { userId: string; name: string; sales: number; revenueCents: number; commissionCents: number; cacCents: number }>();
      for (const r of rows) {
        const cur = bySeller.get(r.ownerId) ?? { userId: r.ownerId, name: r.ownerName, sales: 0, revenueCents: 0, commissionCents: 0, cacCents: 0 };
        cur.sales++;
        cur.revenueCents += r.valueCents ?? 0;
        cur.commissionCents += r.commissionCents ?? 0;
        cur.cacCents += r.cacCents ?? 0;
        bySeller.set(r.ownerId, cur);
      }
      const total = rows.reduce((a, r) => ({ sales: a.sales + 1, commissionCents: a.commissionCents + (r.commissionCents ?? 0), revenueCents: a.revenueCents + (r.valueCents ?? 0), cacCents: a.cacCents + (r.cacCents ?? 0) }), { sales: 0, commissionCents: 0, revenueCents: 0, cacCents: 0 });
      return {
        scope: level(auth, 'relatorios'),
        total: { ...total, avgCacCents: total.sales ? Math.round(total.cacCents / total.sales) : null },
        sellers: [...bySeller.values()].sort((a, b) => b.commissionCents - a.commissionCents),
        items: rows.map((r) => ({ id: r.id, code: r.code, contactName: r.contactName, planName: r.planName, valueCents: r.valueCents, saleType: r.saleType, commissionCents: r.commissionCents, rule: r.rule, cacCents: r.cacCents, marginCents: r.marginCents, paybackMonths: r.paybackMonths, ownerId: r.ownerId, ownerName: r.ownerName, wonAt: r.wonAt })),
      };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/reports/overview',
    summary: 'Relatórios — visão geral do período (vendas, leads, funil, planos, equipe)',
    tag: 'Relatórios',
    module: 'relatorios',
    query: ReportQuery,
    handler: async ({ app, auth, query }) => {
      const p = periodBounds(auth, query.from, query.to);
      const pipe = await resolvePipeline(app.db, auth.tenantId, { pipelineId: query.pipelineId, userId: auth.userId, total: level(auth, 'oportunidades') === 'total' });
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
      requireAction(auth, 'exportar'); requireAction(auth, 'ver_financeiro', 'A planilha inclui valores financeiros que seu perfil não vê.');
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
      } else if (query.kind === 'comissoes') {
        const rows = await commissionRows(app.db, auth, p);
        header = ['Código', 'Cliente', 'Plano', 'Mensalidade (R$)', 'Tipo de venda', 'Comissão (R$)', 'Regra', 'CAC (R$)', 'Margem mensal (R$)', 'Payback (meses)', 'Vendedor', 'Venda fechada em'];
        const r2 = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));
        lines = rows.map((o) => [`OP-${o.code}`, o.contactName, o.planName, r2(o.valueCents), o.saleType ?? '', r2(o.commissionCents), o.rule ?? '', r2(o.cacCents), r2(o.marginCents), o.paybackMonths ?? '', o.ownerName, o.wonAt?.toISOString() ?? '']);
      } else {
        const rows = await opportunityQuery(app.db).where(
          and(oppScopeFor(auth, 'relatorios'), query.kind === 'vendas' ? and(eq(s.opportunities.stage, 'ganha'), p.inCur(s.opportunities.wonAt)) : p.inCur(s.opportunities.createdAt)),
        );
        header = ['Código', 'Cliente', 'Plano', 'Valor mensal (R$)', 'Etapa', 'Responsável', 'Criada em', 'Venda fechada em', 'Contrato'];
        lines = rows.map((o) => [`OP-${o.code}`, o.contactName, o.planName, o.valueCents === null ? '' : (o.valueCents / 100).toFixed(2).replace('.', ','), o.stageName ?? STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage, o.ownerName, o.createdAt.toISOString(), o.wonAt?.toISOString() ?? '', CONTRACT_LABELS[o.contractRequestStatus as ContractRequestStatus] ?? o.contractRequestStatus]);
      }
      await audit(app.db, req, { action: 'export.csv', entityType: 'report', metadata: { kind: query.kind, from: query.from, to: query.to, rows: lines.length } });
      const meta = [`# RevOps — exportação de ${query.kind}`, `# Período: ${query.from} a ${query.to} (${auth.timezone})`, `# Gerado em: ${new Date().toISOString()} por ${auth.name}`];
      const csv = '﻿' + [...meta, header.map(csvSafe).join(';'), ...lines.map((l) => l.map(csvSafe).join(';'))].join('\r\n');
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="isp-sprint-${query.kind}-${query.from}-a-${query.to}.csv"`);
      return reply.send(csv);
    },
  }),
];
