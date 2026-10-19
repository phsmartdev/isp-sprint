/**
 * Inteligência → Contratos: carteira contratada, vencimentos, risco, renovação, reajustes, garantias,
 * implantação e pendências, com os filtros de cliente, categoria, plano, região, ciclo e período.
 * Receita faturada e recebida dependem do ERP/IXC (faturas): ficam vazias, sem estimativa, até a integração.
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { PeriodQuery } from '@isp/shared';
import { BILLING_TYPE_LABELS, CONTRACT_KINDS, type BillingType, CONTRACT_STAGES, CONTRACT_STAGE_LABELS, SEGMENT_LABELS, addDays, daysBetween, nextAnniversary, type Segment } from '@isp/domain';
import { defineRoute } from '../http/route';
import * as s from '../db/schema';
import { level } from '../services/scope';

const Q = PeriodQuery.and(z.object({
  contactId: z.string().uuid().optional(),
  segment: z.string().max(30).optional(),
  planId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  termMonths: z.coerce.number().int().min(1).max(600).optional(),
  kind: z.enum(CONTRACT_KINDS).optional(),
  billingType: z.enum(['recorrente', 'frequente', 'medicao']).optional(),
}));

export const contractInsightRoutes = [
  defineRoute({
    method: 'GET',
    url: '/intelligence/contracts',
    summary: 'Indicadores contratuais com filtros (cliente, categoria, plano, região, ciclo e período)',
    tag: 'Inteligência',
    module: 'inteligencia',
    query: Q,
    handler: async ({ app, auth, query }) => {
      const today = new Date().toISOString().slice(0, 10);
      const inPeriod = (d: Date | string | null | undefined) => { if (!d) return false; const x = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10); return x >= query.from && x <= query.to; };
      const l = level(auth, 'inteligencia');
      const ids = l === 'total' ? null : l === 'equipe' ? auth.teamMemberIds : [auth.userId];
      const v = s.contractVersions;
      const oc = alias(s.condominiums, 'oc');
      const cc = alias(s.condominiums, 'cc');
      const rows = await app.db
        .select({
          id: s.contracts.id, stage: s.contracts.stage, kind: s.contracts.kind, billingType: s.contracts.billingType, contactId: s.contracts.contactId, clientName: s.contacts.name, segment: s.contacts.segment,
          validatedAt: s.contracts.validatedAt, closedAt: s.contracts.closedAt, closureExpected: s.contracts.closureExpected, renewed: s.contracts.renewed,
          number: v.number, endAt: v.endAt, monthlyCents: v.monthlyCents, totalCents: v.totalCents, termMonths: v.termMonths, items: v.items, guarantee: v.guarantee, adjustmentBaseDate: v.adjustmentBaseDate, activationAt: v.activationAt,
          regionId: sql<string | null>`coalesce(${oc.regionId}, ${cc.regionId})`,
        })
        .from(s.contracts)
        .innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion)))
        .innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId))
        .leftJoin(s.opportunities, eq(s.opportunities.id, s.contracts.opportunityId))
        .leftJoin(oc, eq(oc.id, s.opportunities.condominiumId))
        .leftJoin(s.customers, eq(s.customers.id, s.contracts.customerId))
        .leftJoin(cc, eq(cc.id, s.customers.condominiumId))
        .where(and(
          eq(s.contracts.tenantId, auth.tenantId),
          ids ? inArray(s.contracts.commercialOwnerId, ids) : undefined,
          query.contactId ? eq(s.contracts.contactId, query.contactId) : undefined,
          query.segment ? eq(s.contacts.segment, query.segment) : undefined,
          query.kind ? eq(s.contracts.kind, query.kind) : undefined,
          query.billingType ? eq(s.contracts.billingType, query.billingType) : undefined,
          query.termMonths ? eq(v.termMonths, query.termMonths) : undefined,
          query.planId ? sql`${v.items} @> ${JSON.stringify([{ planId: query.planId }])}::jsonb` : undefined,
          query.regionId ? sql`coalesce(${oc.regionId}, ${cc.regionId}) = ${query.regionId}` : undefined,
        ));
      const cIds = rows.map((r) => r.id);
      const procs = cIds.length ? await app.db.select().from(s.contractProcesses).where(inArray(s.contractProcesses.contractId, cIds)) : [];
      const renewedVersions = cIds.length ? await app.db.select({ contractId: v.contractId, monthlyCents: v.monthlyCents, createdAt: v.createdAt }).from(v).where(and(inArray(v.contractId, cIds), eq(v.changeKind, 'renovacao'), gte(v.createdAt, new Date(`${query.from}T00:00:00Z`)))) : [];
      const alerts = cIds.length ? await app.db.select({ contractId: s.contractAlerts.contractId, dueAt: s.contractAlerts.dueAt, kind: s.contractAlerts.kind }).from(s.contractAlerts).where(and(inArray(s.contractAlerts.contractId, cIds), eq(s.contractAlerts.status, 'aberto'))) : [];
      const plans = await app.db.select({ id: s.plans.id, name: s.plans.name }).from(s.plans).where(eq(s.plans.tenantId, auth.tenantId));
      const regions = await app.db.select({ id: s.regions.id, name: s.regions.name }).from(s.regions).where(eq(s.regions.tenantId, auth.tenantId));

      const active = rows.filter((r) => r.validatedAt && r.stage !== 'arquivado');
      const sum = (list: typeof rows) => list.reduce((a, r) => a + r.monthlyCents, 0);
      const within = (d: number) => active.filter((r) => r.endAt && r.endAt >= today && r.endAt <= addDays(today, d));
      const renewalDone = (r: (typeof rows)[number]) => procs.some((p) => p.contractId === r.id && p.kind === 'renovacao' && p.cycleKey === r.endAt && p.outcome === 'renovado');
      const atRisk = active.filter((r) => r.closureExpected || (r.endAt && r.endAt <= addDays(today, 90) && !renewalDone(r)));
      const closedIn = rows.filter((r) => inPeriod(r.closedAt));
      const renOut = procs.filter((p) => p.kind === 'renovacao' && p.status === 'concluido' && inPeriod(p.closedAt));
      const renewedN = renOut.filter((p) => p.outcome === 'renovado').length;
      const notRenewedN = renOut.filter((p) => p.outcome === 'nao_renovado').length + closedIn.filter((r) => !procs.some((p) => p.contractId === r.id && p.kind === 'renovacao')).length;
      const adjDone = procs.filter((p) => p.kind === 'reajuste' && p.status === 'concluido' && p.outcome === 'aplicado' && inPeriod(p.closedAt));
      const adjOpen = procs.filter((p) => p.kind === 'reajuste' && p.status === 'aberto');
      const adjUpcoming = active.filter((r) => r.adjustmentBaseDate && !adjOpen.some((p) => p.contractId === r.id)).map((r) => ({ r, at: nextAnniversary(r.adjustmentBaseDate!, today) })).filter((x) => x.at > x.r.adjustmentBaseDate! && x.at <= addDays(today, 90));
      const delta = (p: (typeof procs)[number]) => { const d = p.data as { newCents?: number; currentCents?: number }; return (d.newCents ?? 0) - (d.currentCents ?? 0); };
      const g = active.filter((r) => r.guarantee?.expiresAt);
      const impl = rows.filter((r) => r.validatedAt && r.activationAt && inPeriod(r.activationAt));
      const implDays = impl.map((r) => Math.max(0, daysBetween(r.validatedAt!.toISOString().slice(0, 10), r.activationAt!)));
      const pendSteps = procs.filter((p) => p.status === 'aberto').length;
      const group = <K extends string>(key: (r: (typeof rows)[number]) => K[], label: (k: K) => string) => {
        const m = new Map<K, { n: number; monthlyCents: number }>();
        for (const r of active) for (const k of key(r)) { const x = m.get(k) ?? { n: 0, monthlyCents: 0 }; x.n++; x.monthlyCents += r.monthlyCents; m.set(k, x); }
        return [...m.entries()].map(([k, x]) => ({ key: k, label: label(k), ...x })).sort((a, b) => b.monthlyCents - a.monthlyCents);
      };
      const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 + i, 1)); return d.toISOString().slice(0, 7); });
      return {
        period: { from: query.from, to: query.to },
        active: active.length,
        closed: rows.filter((r) => r.stage === 'arquivado').length,
        closedInPeriod: closedIn.length,
        revenue: {
          contractedMonthlyCents: sum(active),
          contractedGlobalCents: active.reduce((a, r) => a + (r.totalCents ?? r.monthlyCents * (r.termMonths ?? 12)), 0),
          billedCents: null, receivedCents: null,
          note: 'Faturada e recebida dependem da integração com o ERP/IXC (faturas e baixas). Sem a integração, só a receita contratada é mostrada.',
        },
        expiring: { d30: within(30).length, d60: within(60).length, d90: within(90).length, monthlyCents90: sum(within(90)) },
        atRisk: { n: atRisk.length, monthlyCents: sum(atRisk) },
        renewal: { renewed: renewedN, notRenewed: notRenewedN, rate: renewedN + notRenewedN ? renewedN / (renewedN + notRenewedN) : null, renewedMonthlyCents: renewedVersions.filter((x) => inPeriod(x.createdAt)).reduce((a, x) => a + x.monthlyCents, 0), closedMonthlyCents: sum(closedIn) },
        adjustments: { forecast: adjOpen.length + adjUpcoming.length, done: adjDone.length, increaseCents: adjDone.reduce((a, p) => a + delta(p), 0) },
        guarantees: { expired: g.filter((r) => r.guarantee!.expiresAt! < today).length, expiring30: g.filter((r) => r.guarantee!.expiresAt! >= today && r.guarantee!.expiresAt! <= addDays(today, 30)).length },
        implantation: { n: impl.length, avgDays: implDays.length ? Math.round(implDays.reduce((a, b) => a + b, 0) / implDays.length) : null },
        pendencies: { alerts: alerts.length, overdue: alerts.filter((a) => a.dueAt && a.dueAt < today).length, openProcesses: pendSteps },
        byStage: CONTRACT_STAGES.map((st) => ({ key: st, label: CONTRACT_STAGE_LABELS[st], n: rows.filter((r) => r.stage === st).length, monthlyCents: sum(rows.filter((r) => r.stage === st)) })),
        byBillingType: group((r) => [r.billingType as BillingType], (k) => BILLING_TYPE_LABELS[k as BillingType] ?? k),
        byKind: group((r) => [r.kind as 'publico' | 'privado'], (k) => (k === 'publico' ? 'Público' : 'Privado')),
        bySegment: group((r) => [r.segment as Segment], (k) => SEGMENT_LABELS[k as Segment] ?? k),
        byPlan: group((r) => { const ks = [...new Set(r.items.map((i) => i.planId ?? 'sem'))]; return ks.length ? ks : ['sem']; }, (k) => plans.find((p) => p.id === k)?.name ?? 'Sem plano vinculado'),
        byRegion: group((r) => [r.regionId ?? 'sem'], (k) => regions.find((x) => x.id === k)?.name ?? 'Sem região'),
        expiringByMonth: months.map((m) => { const list = active.filter((r) => r.endAt?.startsWith(m)); return { month: m, n: list.length, monthlyCents: sum(list) }; }),
        topRisk: atRisk.sort((a, b) => b.monthlyCents - a.monthlyCents).slice(0, 8).map((r) => ({ id: r.id, number: r.number, clientName: r.clientName, endAt: r.endAt, monthlyCents: r.monthlyCents, closureExpected: r.closureExpected })),
      };
    },
  }),
];
