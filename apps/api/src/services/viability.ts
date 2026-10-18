/** Parâmetros de viabilidade da empresa e cálculo para uma oportunidade. */
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { computeViability, type HistoricalBase, type SaleType, type ViabilityInput, type ViabilityParams } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export async function loadViabilityParams(db: DbOrTx, tenantId: string): Promise<ViabilityParams> {
  // sequencial: pode rodar dentro de transação (uma conexão só)
  const deductions = await db.select().from(s.viabilityDeductions).where(eq(s.viabilityDeductions.tenantId, tenantId)).orderBy(asc(s.viabilityDeductions.createdAt));
  const equipments = await db.select().from(s.equipmentItems).where(eq(s.equipmentItems.tenantId, tenantId)).orderBy(asc(s.equipmentItems.name));
  const routes = await db.select().from(s.deliveryRoutes).where(eq(s.deliveryRoutes.tenantId, tenantId)).orderBy(asc(s.deliveryRoutes.createdAt));
  const rules = await db.select().from(s.routeRules).where(eq(s.routeRules.tenantId, tenantId)).orderBy(asc(s.routeRules.position));
  const commissions = await db.select().from(s.commissionRules).where(eq(s.commissionRules.tenantId, tenantId)).orderBy(asc(s.commissionRules.position));
  const [settings] = await db.select().from(s.viabilitySettings).where(eq(s.viabilitySettings.tenantId, tenantId)).limit(1);
  const amount = (d: (typeof deductions)[number]) => ({ id: d.id, name: d.name, kind: d.kind as 'percent' | 'fixed', percentBp: d.percentBp, amountCents: d.amountCents, active: d.active, routeIds: d.routeIds });
  return {
    taxes: deductions.filter((d) => d.category === 'tributo').map(amount),
    partners: deductions.filter((d) => d.category === 'parceiro').map(amount),
    equipments: equipments.map((e) => ({ id: e.id, name: e.name, costCents: e.costCents, active: e.active })),
    routes: routes.map((r) => ({ id: r.id, name: r.name, cablePerMeterCents: r.cablePerMeterCents, installCostCents: r.installCostCents, monthlyCostCents: r.monthlyCostCents, requiresApproval: r.requiresApproval, kit: r.kit, active: r.active })),
    rules: rules.map((r) => ({ id: r.id, name: r.name, position: r.position, minMeters: r.minMeters, maxMeters: r.maxMeters, minMbps: r.minMbps, maxMbps: r.maxMbps, routeId: r.routeId, active: r.active })),
    defaultRouteId: settings?.defaultRouteId ?? routes.find((r) => r.active)?.id ?? null,
    commissionRules: commissions.map((c) => ({ ...c, saleType: c.saleType as SaleType | 'qualquer', kind: c.kind as 'percent' | 'mensalidades' | 'fixo' })),
    ltv: { lifetimeMonths: settings?.ltvLifetimeMonths ?? null, monthlyChurnBp: settings?.monthlyChurnBp ?? null, minSample: settings?.ltvMinSample ?? 30 },
    maxPaybackMonths: settings?.maxPaybackMonths ?? null,
  };
}

/**
 * Base histórica da carteira: clientes com início de contrato. Vida média = (fim ou hoje − início).
 * Margem média = preço do plano − tributos − parceiros (sem custo de caminho, que é da venda).
 * Clientes ainda ativos subestimam a vida real; o painel informa o tamanho da amostra.
 */
export async function historicalBase(db: DbOrTx, tenantId: string, p: ViabilityParams): Promise<HistoricalBase> {
  const [r] = await db
    .select({
      n: sql<number>`count(*)::int`,
      months: sql<number | null>`avg(extract(epoch from (coalesce(${s.customers.contractEnd}::timestamp, now()) - ${s.customers.contractStart}::timestamp)) / 2629800.0)`,
      price: sql<number | null>`avg(${s.plans.priceCents})`,
    })
    .from(s.customers)
    .leftJoin(s.plans, eq(s.plans.id, s.customers.planId))
    .where(and(eq(s.customers.tenantId, tenantId), isNotNull(s.customers.contractStart)));
  const price = r?.price ? Math.round(Number(r.price)) : null;
  const ded = (rules: ViabilityParams['taxes']) => rules.filter((x) => x.active && !x.routeIds?.length).reduce((a, x) => a + (x.kind === 'percent' ? Math.round(((price ?? 0) * x.percentBp) / 10_000) : x.amountCents), 0);
  return {
    customers: r?.n ?? 0,
    avgLifetimeMonths: r?.months ? Math.round(Number(r.months) * 10) / 10 : null,
    avgMarginCents: price === null ? null : price - ded(p.taxes) - ded(p.partners),
  };
}

export type OppViabilityRow = {
  valueCents: number | null;
  planId: string | null;
  cableMeters: number | null;
  activationFeeCents: number | null;
  saleType: string | null;
  equipment: { equipmentId: string; qty: number }[] | null;
  routeId: string | null;
};

export async function viabilityFor(db: DbOrTx, tenantId: string, o: OppViabilityRow, cache?: { params?: ViabilityParams; base?: HistoricalBase }) {
  const params = cache?.params ?? (await loadViabilityParams(db, tenantId));
  const base = cache?.base ?? (await historicalBase(db, tenantId, params));
  let mbps: number | null = null;
  let products: ViabilityInput['products'] = null;
  if (o.planId) {
    const [pl] = await db.select({ mbps: s.plans.speedMbps, products: s.plans.products }).from(s.plans).where(and(eq(s.plans.id, o.planId), eq(s.plans.tenantId, tenantId))).limit(1);
    mbps = pl?.mbps ?? null;
    products = pl?.products?.length ? pl.products : null;
  }
  const input: ViabilityInput = {
    priceCents: o.valueCents,
    mbps,
    cableMeters: o.cableMeters,
    activationFeeCents: o.activationFeeCents,
    saleType: (o.saleType as SaleType | null) ?? null,
    equipment: o.equipment,
    routeId: o.routeId,
    products,
  };
  return { input, result: computeViability(input, params, base) };
}

/** Guarda o resultado na oportunidade (para relatórios de comissão, CAC e payback). */
export async function storeViability(db: DbOrTx, tenantId: string, opportunityId: string) {
  const [o] = await db
    .select({ valueCents: s.opportunities.valueCents, planId: s.opportunities.planId, cableMeters: s.opportunities.cableMeters, activationFeeCents: s.opportunities.activationFeeCents, saleType: s.opportunities.saleType, equipment: s.opportunities.equipment, routeId: s.opportunities.routeId })
    .from(s.opportunities)
    .where(and(eq(s.opportunities.id, opportunityId), eq(s.opportunities.tenantId, tenantId)))
    .limit(1);
  if (!o) return null;
  const { result } = await viabilityFor(db, tenantId, o);
  await db
    .update(s.opportunities)
    .set({ viability: result as unknown as Record<string, unknown>, commissionCents: result.commission.cents, cacCents: result.cacCents, marginCents: result.marginMonthlyCents, paybackMonths: result.paybackMonths === null ? null : String(result.paybackMonths) })
    .where(eq(s.opportunities.id, opportunityId));
  return result;
}
