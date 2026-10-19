/**
 * Inteligência geral: base de clientes, faturamento, inadimplência, portas da CTO, motivos de
 * cancelamento e de perda, leads e vendas perdidas, e cohort de retenção por mês de entrada.
 * Faturas vêm do IXC (Fase 4); até lá, "em aberto" usa os clientes marcados como inadimplentes.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PeriodQuery } from '@isp/shared';
import { LOSS_REASON_LABELS, type LossReason } from '@isp/domain';
import { defineRoute } from '../http/route';
import * as s from '../db/schema';
import { ownerScope } from '../services/scope';
import { periodBounds } from '../services/period';
import { leadScopeFor, oppScopeFor } from './reports';
import { portUsage } from '../services/ports';

const ACTIVE = ['ativo', 'reativado', 'inadimplente', 'suspenso', 'em_implantacao'];
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

export const insightsRoutes = [
  defineRoute({
    method: 'GET',
    url: '/intelligence/general',
    summary: 'Inteligência geral: base, faturamento, inadimplência, portas, motivos, leads, perdas e cohort',
    tag: 'Inteligência',
    module: 'inteligencia',
    query: PeriodQuery,
    handler: async ({ app, auth, query }) => {
      const p = periodBounds(auth, query.from, query.to);
      const custScope = ownerScope(auth, 'inteligencia', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });
      const customers = await app.db
        .select({ lifecycle: s.customers.lifecycle, planId: s.customers.planId, planName: s.plans.name, price: s.plans.priceCents, start: s.customers.contractStart, end: s.customers.contractEnd, cancelReason: s.customers.cancelReason })
        .from(s.customers)
        .innerJoin(s.contacts, eq(s.contacts.id, s.customers.contactId))
        .leftJoin(s.plans, eq(s.plans.id, s.customers.planId))
        .where(and(custScope, sql`${s.customers.lifecycle} <> 'prospect'`));
      // posição da base na data final do filtro: ativo = já tinha começado e ainda não tinha cancelado
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: auth.timezone }).format(new Date());
      const refDate = query.to > todayStr ? todayStr : query.to;
      const shift = (d: string, days: number, months = 0) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + months); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
      const activeOn = (d: string) => customers.filter((c) => {
        if (c.start && c.start > d) return false;
        if (c.end) return c.end > d;
        if (c.lifecycle === 'cancelado') return false; // cancelado sem data: fora da base
        return d >= todayStr ? ACTIVE.includes(c.lifecycle) : true;
      });
      const active = activeOn(refDate);
      const activeYesterday = activeOn(shift(refDate, -1)).length;
      const activeLastMonth = activeOn(shift(refDate, 0, -1)).length;
      const cancelled = customers.filter((c) => c.lifecycle === 'cancelado');
      const overdue = active.filter((c) => c.lifecycle === 'inadimplente');
      const billing = active.reduce((a, c) => a + (c.price ?? 0), 0);
      const overdueAmount = overdue.reduce((a, c) => a + (c.price ?? 0), 0);

      const planMap = new Map<string, { name: string; customers: number; billingCents: number }>();
      for (const c of active) {
        const k = c.planId ?? 'sem';
        const cur = planMap.get(k) ?? { name: c.planName ?? 'Sem plano', customers: 0, billingCents: 0 };
        cur.customers++;
        cur.billingCents += c.price ?? 0;
        planMap.set(k, cur);
      }
      const reasons = (list: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const r of list) m.set(r || 'Não informado', (m.get(r || 'Não informado') ?? 0) + 1);
        const total = list.length || 1;
        return [...m.entries()].map(([label, n]) => ({ label, n, share: n / total })).sort((a, b) => b.n - a.n);
      };
      const cancelledInPeriod = cancelled.filter((c) => c.end && c.end >= query.from && c.end <= query.to);

      // portas da CTO (empresa toda)
      const condos = await app.db.select({ id: s.condominiums.id, ports: s.condominiums.ctoPorts }).from(s.condominiums).where(and(eq(s.condominiums.tenantId, auth.tenantId), isNotNull(s.condominiums.ctoPorts)));
      const used = await portUsage(app.db, auth.tenantId);
      const portsTotal = condos.reduce((a, c) => a + (c.ports ?? 0), 0);
      const portsUsed = condos.reduce((a, c) => a + Math.min(c.ports ?? 0, used.get(c.id) ?? 0), 0);

      // comercial: leads e vendas perdidas no período, motivos de perda (objeções)
      const oppScope = oppScopeFor(auth, 'inteligencia');
      const [leads] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.leads).where(and(leadScopeFor(auth, 'inteligencia'), p.inCur(s.leads.createdAt)));
      const lost = await app.db.select({ reason: s.opportunities.lossReason, value: s.opportunities.valueCents }).from(s.opportunities).where(and(oppScope, eq(s.opportunities.stage, 'perdida'), p.inCur(s.opportunities.lostAt)));
      const [won] = await app.db.select({ n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${s.opportunities.valueCents}),0)::bigint` }).from(s.opportunities).where(and(oppScope, eq(s.opportunities.stage, 'ganha'), p.inCur(s.opportunities.wonAt)));
      const [open] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.opportunities).where(and(oppScope, sql`${s.opportunities.stage} not in ('ganha','perdida')`));

      // cohort: clientes por mês de entrada (últimos 12 meses) e % ainda ativos a cada mês
      const now = new Date();
      const first = addMonths(now, -11);
      const cohorts = Array.from({ length: 12 }, (_, i) => {
        const m = addMonths(first, i);
        const key = monthKey(m);
        const members = customers.filter((c) => c.start && c.start.slice(0, 7) === key);
        const ages = Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - m.getTime()) / (30.44 * 86_400_000));
        const retention = Array.from({ length: ages + 1 }, (_, k) => {
          const boundary = addMonths(m, k + 1).toISOString().slice(0, 10);
          const alive = members.filter((c) => !c.end || c.end >= boundary).length;
          return members.length ? alive / members.length : null;
        });
        return { month: key, size: members.length, active: members.filter((c) => ACTIVE.includes(c.lifecycle)).length, cancelled: members.filter((c) => c.lifecycle === 'cancelado').length, retention };
      });

      return {
        negocio: {
          activeCustomers: active.length,
          activeOn: { date: refDate, n: active.length, dayBefore: { date: shift(refDate, -1), n: activeYesterday }, monthBefore: { date: shift(refDate, 0, -1), n: activeLastMonth } },
          cancelledCustomers: cancelled.length,
          cancelledInPeriod: cancelledInPeriod.length,
          billingCents: billing,
          ticketCents: active.length ? Math.round(billing / active.length) : null,
          plans: [...planMap.values()].sort((a, b) => b.customers - a.customers),
          portsTotal, portsUsed, portsRate: portsTotal ? portsUsed / portsTotal : null,
        },
        relacionamento: {
          overdueCustomers: overdue.length,
          overdueRate: active.length ? overdue.length / active.length : null,
          openInvoicesCents: overdueAmount,
          invoicesSource: 'inadimplentes' as const,
          churnRate: active.length + cancelledInPeriod.length ? cancelledInPeriod.length / (active.length + cancelledInPeriod.length) : null,
          cancelReasons: reasons(cancelledInPeriod.length ? cancelledInPeriod.map((c) => c.cancelReason) : cancelled.map((c) => c.cancelReason)),
          cancelReasonsScope: cancelledInPeriod.length ? 'periodo' : 'todos',
        },
        comercial: {
          leads: leads?.n ?? 0,
          won: won?.n ?? 0,
          wonCents: Number(won?.v ?? 0),
          lost: lost.length,
          lostCents: lost.reduce((a, l) => a + (l.value ?? 0), 0),
          openOpportunities: open?.n ?? 0,
          lossReasons: reasons(lost.map((l) => (l.reason ? LOSS_REASON_LABELS[l.reason as LossReason] ?? l.reason : null))),
        },
        cohorts,
      };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/intelligence/heatmap',
    summary: 'Mapa de calor da base pelo endereço: clientes ativos numa data ou cancelados no período',
    tag: 'Inteligência',
    module: 'inteligencia',
    query: PeriodQuery.and(z.object({ status: z.enum(['ativos', 'cancelados']).default('ativos') })),
    handler: async ({ app, auth, query }) => {
      const custScope = ownerScope(auth, 'inteligencia', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: auth.timezone }).format(new Date());
      const ref = query.to > todayStr ? todayStr : query.to;
      const where = query.status === 'ativos'
        ? sql`${s.customers.lifecycle} <> 'prospect' and (${s.customers.contractStart} is null or ${s.customers.contractStart} <= ${ref}) and (case when ${s.customers.contractEnd} is not null then ${s.customers.contractEnd} > ${ref} else ${s.customers.lifecycle} <> 'cancelado' end)`
        : sql`${s.customers.lifecycle} = 'cancelado' and (${s.customers.contractEnd} is null or (${s.customers.contractEnd} >= ${query.from} and ${s.customers.contractEnd} <= ${query.to}))`;
      const rows = await app.db
        .select({
          city: sql<string | null>`coalesce(nullif(trim(${s.addresses.city}), ''), nullif(trim(${s.contacts.city}), ''))`,
          district: sql<string | null>`nullif(trim(${s.addresses.district}), '')`,
          n: sql<number>`count(distinct ${s.customers.id})::int`,
        })
        .from(s.customers)
        .innerJoin(s.contacts, eq(s.contacts.id, s.customers.contactId))
        .leftJoin(s.addresses, eq(s.addresses.customerId, s.customers.id))
        .where(and(custScope, where))
        .groupBy(sql`1`, sql`2`);
      const cities = new Map<string, number>();
      for (const r of rows) cities.set(r.city ?? 'Sem cidade', (cities.get(r.city ?? 'Sem cidade') ?? 0) + r.n);
      const total = rows.reduce((a, r) => a + r.n, 0);
      return {
        status: query.status,
        date: ref,
        total,
        cities: [...cities.entries()].map(([city, n]) => ({ city, n })).sort((a, b) => b.n - a.n),
        districts: rows.filter((r) => r.district).map((r) => ({ city: r.city ?? '—', district: r.district!, n: r.n })).sort((a, b) => b.n - a.n).slice(0, 40),
        withoutAddress: rows.filter((r) => !r.city).reduce((a, r) => a + r.n, 0),
      };
    },
  }),
];
