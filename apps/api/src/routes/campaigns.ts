/**
 * Campanhas: concepção, vigência, orçamento, gastos e resultado.
 * ROI = (retorno − investimento) ÷ investimento. Retorno = soma do LTV de cada venda fechada
 * ligada à campanha (margem mensal × vida média, do cálculo de viabilidade); sem viabilidade,
 * usa 12 mensalidades. Investimento = gastos lançados; sem gastos, o orçamento previsto.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CampaignCostCreate, CampaignUpsert } from '@isp/shared';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';

const READ = { module: 'campanhas' as const };
const WRITE = { module: 'campanhas' as const, min: 'equipe' as const };
const toTs = (d?: string | null, end = false) => (d ? new Date(`${d}T${end ? '23:59:59' : '00:00:00'}-03:00`) : d === null ? null : undefined);

async function metrics(db: DbOrTx, tenantId: string, ids: string[]) {
  if (!ids.length) return new Map<string, ReturnType<typeof emptyM>>();
  const leads = await db.select({ id: s.leads.campaignId, n: sql<number>`count(*)::int`, converted: sql<number>`count(*) filter (where ${s.leads.status} = 'convertido')::int` }).from(s.leads).where(and(eq(s.leads.tenantId, tenantId), inArray(s.leads.campaignId, ids), sql`${s.leads.deletedAt} is null`)).groupBy(s.leads.campaignId);
  const opps = await db
    .select({
      id: s.opportunities.campaignId,
      n: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${s.opportunities.stage} not in ('ganha','perdida'))::int`,
      won: sql<number>`count(*) filter (where ${s.opportunities.stage} = 'ganha')::int`,
      lost: sql<number>`count(*) filter (where ${s.opportunities.stage} = 'perdida')::int`,
      mrr: sql<number>`coalesce(sum(${s.opportunities.valueCents}) filter (where ${s.opportunities.stage} = 'ganha'),0)::bigint`,
      ltv: sql<number>`coalesce(sum(coalesce((${s.opportunities.viability}->'ltv'->>'dealCents')::bigint, ${s.opportunities.valueCents} * 12)) filter (where ${s.opportunities.stage} = 'ganha'),0)::bigint`,
      margin: sql<number>`coalesce(sum(coalesce(${s.opportunities.marginCents}, ${s.opportunities.valueCents})) filter (where ${s.opportunities.stage} = 'ganha'),0)::bigint`,
      commission: sql<number>`coalesce(sum(${s.opportunities.commissionCents}) filter (where ${s.opportunities.stage} = 'ganha'),0)::bigint`,
    })
    .from(s.opportunities)
    .where(and(eq(s.opportunities.tenantId, tenantId), inArray(s.opportunities.campaignId, ids), sql`${s.opportunities.deletedAt} is null`))
    .groupBy(s.opportunities.campaignId);
  const costs = await db.select({ id: s.campaignCosts.campaignId, spent: sql<number>`coalesce(sum(${s.campaignCosts.amountCents}),0)::bigint` }).from(s.campaignCosts).where(and(eq(s.campaignCosts.tenantId, tenantId), inArray(s.campaignCosts.campaignId, ids))).groupBy(s.campaignCosts.campaignId);
  const out = new Map<string, ReturnType<typeof emptyM>>();
  for (const id of ids) {
    const l = leads.find((x) => x.id === id), o = opps.find((x) => x.id === id), c = costs.find((x) => x.id === id);
    out.set(id, { ...emptyM(), leads: l?.n ?? 0, leadsConverted: l?.converted ?? 0, opportunities: o?.n ?? 0, open: o?.open ?? 0, won: o?.won ?? 0, lost: o?.lost ?? 0, mrrCents: Number(o?.mrr ?? 0), ltvCents: Number(o?.ltv ?? 0), marginCents: Number(o?.margin ?? 0), commissionCents: Number(o?.commission ?? 0), spentCents: Number(c?.spent ?? 0) });
  }
  return out;
}
const emptyM = () => ({ leads: 0, leadsConverted: 0, opportunities: 0, open: 0, won: 0, lost: 0, mrrCents: 0, ltvCents: 0, marginCents: 0, commissionCents: 0, spentCents: 0 });

function withResult(c: typeof s.campaigns.$inferSelect, m: ReturnType<typeof emptyM>) {
  const investment = m.spentCents > 0 ? m.spentCents : c.budgetCents ?? 0;
  const basis = m.spentCents > 0 ? 'gastos' : c.budgetCents ? 'orcamento' : null;
  const today = new Date();
  const status = !c.active ? 'encerrada' : c.startsOn && c.startsOn > today ? 'planejada' : c.endsOn && c.endsOn < today ? 'encerrada' : 'ativa';
  return {
    ...c,
    status,
    metrics: m,
    result: {
      investmentCents: investment,
      basis,
      roi: investment > 0 ? (m.ltvCents - investment) / investment : null,
      cplCents: m.leads && investment ? Math.round(investment / m.leads) : null,
      cacCents: m.won && investment ? Math.round(investment / m.won) : null,
      paybackMonths: investment && m.marginCents > 0 ? Math.round((investment / m.marginCents) * 10) / 10 : null,
      winRate: m.won + m.lost ? m.won / (m.won + m.lost) : null,
      budgetUsed: c.budgetCents ? m.spentCents / c.budgetCents : null,
    },
  };
}

async function campaignOr404(db: DbOrTx, tenantId: string, id: string) {
  const [c] = await db.select().from(s.campaigns).where(and(eq(s.campaigns.id, id), eq(s.campaigns.tenantId, tenantId))).limit(1);
  if (!c) throw notFound('Campanha não encontrada.');
  return c;
}
async function assertRefs(db: DbOrTx, tenantId: string, b: { ownerId?: string | null; sourceId?: string | null }) {
  if (b.ownerId) { const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, b.ownerId), eq(s.users.tenantId, tenantId))).limit(1); if (!u) throw unprocessable('Responsável inválido.'); }
  if (b.sourceId) { const [x] = await db.select({ id: s.leadSources.id }).from(s.leadSources).where(and(eq(s.leadSources.id, b.sourceId), eq(s.leadSources.tenantId, tenantId))).limit(1); if (!x) throw unprocessable('Canal inválido.'); }
}
const values = (b: Partial<z.infer<typeof CampaignUpsert>>) => {
  const { startsOn, endsOn, ...rest } = b;
  return { ...rest, ...(startsOn !== undefined ? { startsOn: toTs(startsOn) } : {}), ...(endsOn !== undefined ? { endsOn: toTs(endsOn, true) } : {}) };
};

export const campaignRoutes = [
  defineRoute({
    method: 'GET',
    url: '/campaigns',
    summary: 'Campanhas com orçamento, gastos, leads, vendas e ROI',
    tag: 'Campanhas',
    ...READ,
    handler: async ({ app, auth }) => {
      const rows = await app.db.select().from(s.campaigns).where(eq(s.campaigns.tenantId, auth.tenantId)).orderBy(desc(s.campaigns.startsOn), asc(s.campaigns.name));
      const m = await metrics(app.db, auth.tenantId, rows.map((r) => r.id));
      return { items: rows.map((r) => withResult(r, m.get(r.id) ?? emptyM())) };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/campaigns/:id',
    summary: 'Campanha: concepção, gastos, vendas atreladas e resultado',
    tag: 'Campanhas',
    ...READ,
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await campaignOr404(app.db, auth.tenantId, params.id);
      const m = (await metrics(app.db, auth.tenantId, [c.id])).get(c.id) ?? emptyM();
      const costs = await app.db.select({ id: s.campaignCosts.id, spentOn: s.campaignCosts.spentOn, category: s.campaignCosts.category, description: s.campaignCosts.description, amountCents: s.campaignCosts.amountCents, createdByName: s.users.name }).from(s.campaignCosts).leftJoin(s.users, eq(s.users.id, s.campaignCosts.createdBy)).where(and(eq(s.campaignCosts.campaignId, c.id), eq(s.campaignCosts.tenantId, auth.tenantId))).orderBy(desc(s.campaignCosts.spentOn));
      const sales = await app.db
        .select({ id: s.opportunities.id, code: s.opportunities.code, stage: s.opportunities.stage, contactName: s.contacts.name, ownerName: s.users.name, valueCents: s.opportunities.valueCents, wonAt: s.opportunities.wonAt, planName: s.plans.name, ltvCents: sql<number | null>`(${s.opportunities.viability}->'ltv'->>'dealCents')::bigint` })
        .from(s.opportunities)
        .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
        .innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId))
        .leftJoin(s.plans, eq(s.plans.id, s.opportunities.planId))
        .where(and(eq(s.opportunities.tenantId, auth.tenantId), eq(s.opportunities.campaignId, c.id), sql`${s.opportunities.deletedAt} is null`))
        .orderBy(desc(s.opportunities.createdAt))
        .limit(300);
      return { ...withResult(c, m), costs, opportunities: sales.map((x) => ({ ...x, ltvCents: x.ltvCents === null ? null : Number(x.ltvCents) })) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/campaigns',
    summary: 'Cria campanha',
    tag: 'Campanhas',
    ...WRITE,
    body: CampaignUpsert,
    handler: async ({ app, auth, body, req, reply }) => {
      await assertRefs(app.db, auth.tenantId, body);
      if (body.startsOn && body.endsOn && body.endsOn < body.startsOn) throw unprocessable('O fim da vigência é antes do início.', [{ path: 'endsOn', message: 'Data final antes da inicial' }]);
      const [c] = await app.db.insert(s.campaigns).values({ tenantId: auth.tenantId, ...values(body) } as typeof s.campaigns.$inferInsert).onConflictDoNothing().returning();
      if (!c) throw unprocessable('Já existe uma campanha com esse nome.', [{ path: 'name', message: 'Nome repetido' }]);
      await audit(app.db, req, { action: 'campaign.create', entityType: 'campaign', entityId: c.id, metadata: { name: c.name } });
      reply.code(201);
      return c;
    },
  }),
  defineRoute({
    method: 'PATCH',
    url: '/campaigns/:id',
    summary: 'Altera campanha',
    tag: 'Campanhas',
    ...WRITE,
    params: IdParams,
    body: CampaignUpsert.partial(),
    handler: async ({ app, auth, params, body, req }) => {
      const cur = await campaignOr404(app.db, auth.tenantId, params.id);
      await assertRefs(app.db, auth.tenantId, body);
      const [c] = await app.db.update(s.campaigns).set({ ...values(body), updatedAt: new Date() } as Partial<typeof s.campaigns.$inferInsert>).where(eq(s.campaigns.id, cur.id)).returning();
      if (c!.startsOn && c!.endsOn && c!.endsOn < c!.startsOn) throw unprocessable('O fim da vigência é antes do início.');
      await audit(app.db, req, { action: 'campaign.update', entityType: 'campaign', entityId: cur.id, metadata: { name: c!.name } });
      return c;
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/campaigns/:id/costs',
    summary: 'Lança um gasto realizado',
    tag: 'Campanhas',
    ...WRITE,
    params: IdParams,
    body: CampaignCostCreate,
    handler: async ({ app, auth, params, body, reply }) => {
      const c = await campaignOr404(app.db, auth.tenantId, params.id);
      const [r] = await app.db.insert(s.campaignCosts).values({ tenantId: auth.tenantId, campaignId: c.id, ...body, createdBy: auth.userId }).returning();
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'DELETE',
    url: '/campaigns/:id/costs/:costId',
    summary: 'Remove um gasto lançado por engano',
    tag: 'Campanhas',
    ...WRITE,
    params: z.object({ id: z.string().uuid(), costId: z.string().uuid() }),
    handler: async ({ app, auth, params, reply, req }) => {
      const r = await app.db.delete(s.campaignCosts).where(and(eq(s.campaignCosts.id, params.costId), eq(s.campaignCosts.campaignId, params.id), eq(s.campaignCosts.tenantId, auth.tenantId))).returning();
      if (!r.length) throw notFound('Gasto não encontrado.');
      await audit(app.db, req, { action: 'campaign.cost_delete', entityType: 'campaign', entityId: params.id, metadata: { amountCents: r[0]!.amountCents, description: r[0]!.description } });
      return reply.code(204).send();
    },
  }),
];
