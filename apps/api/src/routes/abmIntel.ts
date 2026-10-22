/**
 * ABM Fase 7 — inteligência e cobertura: indicadores de prospecção, stakeholders, plays, relacionamento, comercial e
 * pesquisas das contas do ABM visíveis, e a cobertura de stakeholders de cada conta (explicada). Somente leitura.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ABM_PRIORITIES, ABM_TIERS, coverageOf, npsOf, type InfluenceLevel, type RelationshipStrength, type StakeholderRole, type Stance } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { ownerScope } from '../services/scope';
import { factsOf, emptyFacts } from './abm';
import { abmPolicy, canViewInfluence, stakeholderRows } from './stakeholders';

const vis = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.abmAccounts.tenantId, ownerId: s.abmAccounts.ownerId });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}::uuid`), sql`, `);

/** Cobertura de cada conta a partir dos stakeholders e da estrutura registrados. */
export async function coverageFor(db: DbOrTx, auth: AuthContext, contactIds: string[]) {
  if (!contactIds.length) return new Map<string, ReturnType<typeof coverageOf>>();
  const pol = await abmPolicy(db, auth.tenantId);
  const show = canViewInfluence(auth, pol.influence);
  const people = await stakeholderRows(db, auth, contactIds, pol.influence);
  const units = await db.select({ contactId: s.accountOrgUnits.contactId, n: sql<number>`count(*)::int` }).from(s.accountOrgUnits).where(and(inArray(s.accountOrgUnits.contactId, contactIds), eq(s.accountOrgUnits.active, true))).groupBy(s.accountOrgUnits.contactId);
  return new Map(contactIds.map((cid) => [cid, coverageOf(people.filter((p) => p.contactId === cid).map((p) => ({ roles: p.roles as StakeholderRole[], influence: p.influence as InfluenceLevel | null, relationship: p.relationshipStrength as RelationshipStrength, stance: p.stance as Stance, unitId: p.unitId, active: p.active })), units.find((u) => u.contactId === cid)?.n ?? 0, show)]));
}

export const abmIntelRoutes = [
  defineRoute({
    method: 'GET', url: '/abm/intelligence', summary: 'Indicadores ABM (prospecção, stakeholders, plays, relacionamento, comercial, pesquisas) e cobertura por conta', tag: 'Marketing', module: 'clientes',
    query: z.object({ from: isoDate.optional(), to: isoDate.optional(), owner: z.string().uuid().optional(), priority: z.enum(ABM_PRIORITIES).optional(), tier: z.enum(ABM_TIERS).optional() }),
    handler: async ({ app, auth, query: q }) => {
      const today = todayIn(auth.timezone);
      const to = q.to ?? today, from = q.from ?? `${today.slice(0, 7)}-01`;
      const accs = await app.db.select({ a: s.abmAccounts, name: s.contacts.name, owner: s.users.name }).from(s.abmAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.abmAccounts.contactId)).innerJoin(s.users, eq(s.users.id, s.abmAccounts.ownerId))
        .where(and(vis(auth), q.owner ? eq(s.abmAccounts.ownerId, q.owner) : undefined, q.priority ? eq(s.abmAccounts.priority, q.priority) : undefined, q.tier ? eq(s.abmAccounts.tier, q.tier) : undefined));
      const cids = accs.map((x) => x.a.contactId);
      const empty = { period: { from, to }, accounts: [], prospeccao: null, stakeholders: null, plays: null, relacionamento: null, comercial: null, pesquisas: null, cobertura: null };
      if (!cids.length) return empty;
      const facts = await factsOf(app.db, auth, cids);
      const cov = await coverageFor(app.db, auth, cids);
      const pol = await abmPolicy(app.db, auth.tenantId);
      const show = canViewInfluence(auth, pol.influence);
      const people = (await stakeholderRows(app.db, auth, cids, pol.influence)).filter((p) => p.active);
      const fromTs = sql`(${from}::date)::timestamp at time zone ${auth.timezone}`, toTs = sql`((${to}::date + 1)::timestamp at time zone ${auth.timezone})`;
      const [interactions, opps, won, ctrs, runs, late, nps, byPlay] = await Promise.all([
        app.db.execute<{ contact_id: string; n: number }>(sql`select contact_id, count(*)::int as n from activities where contact_id in (${ids(cids)}) and deleted_at is null and status = 'concluida' and completed_at >= ${fromTs} and completed_at < ${toTs} group by contact_id`),
        app.db.execute<{ contact_id: string; n: number; v: string }>(sql`select contact_id, count(*)::int as n, coalesce(sum(value_cents), 0) as v from opportunities where contact_id in (${ids(cids)}) and deleted_at is null and stage not in ('ganha', 'perdida') group by contact_id`),
        app.db.execute<{ n: number; v: string }>(sql`select count(*)::int as n, coalesce(sum(value_cents), 0) as v from opportunities where contact_id in (${ids(cids)}) and deleted_at is null and stage = 'ganha' and won_at >= ${fromTs} and won_at < ${toTs}`),
        app.db.execute<{ n: number }>(sql`select count(*)::int as n from contracts where contact_id in (${ids(cids)}) and stage in ('implantacao', 'vigente', 'renovacao', 'reajuste')`),
        app.db.select({ status: s.abmPlayRuns.status, success: s.abmPlayRuns.successAchieved, closedAt: s.abmPlayRuns.closedAt, contactId: s.abmPlayRuns.contactId, playId: s.abmPlayRuns.playId }).from(s.abmPlayRuns).where(inArray(s.abmPlayRuns.contactId, cids)),
        app.db.execute<{ n: number }>(sql`select count(*)::int as n from abm_play_run_steps r join abm_play_runs pr on pr.id = r.run_id join activities a on a.id = r.activity_id where pr.contact_id in (${ids(cids)}) and pr.status = 'em_andamento' and a.deleted_at is null and a.status not in ('concluida', 'cancelada') and a.due_at < now()`),
        app.db.select({ score: s.csSurveys.score, contactId: s.csSurveys.contactId }).from(s.csSurveys).where(and(inArray(s.csSurveys.contactId, cids), eq(s.csSurveys.kind, 'NPS'), eq(s.csSurveys.scale, 10), gte(s.csSurveys.respondedAt, from), lte(s.csSurveys.respondedAt, to))),
        app.db.select({ id: s.abmPlays.id, name: s.abmPlays.name }).from(s.abmPlays).where(eq(s.abmPlays.tenantId, auth.tenantId)),
      ]);
      const inPeriod = (d: Date | null) => !!d && d.toISOString().slice(0, 10) >= from && d.toISOString().slice(0, 10) <= to;
      const accounts = accs.map(({ a, name, owner }) => {
        const f = facts.get(a.contactId) ?? emptyFacts();
        const c = cov.get(a.contactId)!;
        const o = opps.rows.find((x) => x.contact_id === a.contactId);
        return { id: a.id, contactId: a.contactId, name, ownerName: owner, status: a.status, priority: a.priority, tier: a.tier, commercial: f.commercial, lastContactOn: f.lastContactOn, daysSinceInteraction: f.daysSinceInteraction, openOpps: o?.n ?? 0, openValueCents: Number(o?.v ?? 0), interactions: interactions.rows.find((x) => x.contact_id === a.contactId)?.n ?? 0, runsOpen: runs.filter((r) => r.contactId === a.contactId && r.status === 'em_andamento').length, coverage: { score: c.score, level: c.level, gaps: c.gaps, people: c.people } };
      });
      const count = <T extends string>(xs: T[]) => xs.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});
      const concluded = runs.filter((r) => r.status === 'concluido' && inPeriod(r.closedAt));
      const hi = people.filter((p) => p.influence === 'alto' || p.influence === 'muito_alto');
      const noContact = accounts.filter((a) => a.daysSinceInteraction === null || a.daysSinceInteraction > 30);
      return {
        period: { from, to },
        accounts: accounts.sort((x, y) => x.coverage.score - y.coverage.score),
        prospeccao: { total: accounts.length, byStatus: count(accounts.map((a) => a.status)), byCommercial: count(accounts.map((a) => a.commercial)), newInPeriod: accs.filter((x) => inPeriod(x.a.createdAt)).length, noContact30: noContact.length },
        stakeholders: { total: people.length, perAccount: Math.round((people.length / accounts.length) * 10) / 10, decisores: people.filter((p) => p.roles.includes('decisor')).length, accountsWithoutDecisor: accounts.filter((a) => !people.some((p) => p.contactId === a.contactId && p.roles.includes('decisor'))).length, assessedPct: show && people.length ? Math.round((people.filter((p) => p.influence && p.influence !== 'nao_avaliado').length / people.length) * 100) : null },
        plays: { running: runs.filter((r) => r.status === 'em_andamento').length, concludedInPeriod: concluded.length, successRate: concluded.length ? Math.round((concluded.filter((r) => r.success).length / concluded.length) * 100) : null, lateSteps: late.rows[0]?.n ?? 0, byPlay: byPlay.map((p) => ({ name: p.name, running: runs.filter((r) => r.playId === p.id && r.status === 'em_andamento').length, concluded: concluded.filter((r) => r.playId === p.id).length, succeeded: concluded.filter((r) => r.playId === p.id && r.success).length })).filter((p) => p.running || p.concluded) },
        relacionamento: { interactionsInPeriod: accounts.reduce((a, x) => a + x.interactions, 0), noContact30: noContact.length, highInfluence: show ? hi.length : null, highInfluenceClose: show ? hi.filter((p) => p.relationshipStrength === 'forte' || p.relationshipStrength === 'moderado').length : null },
        comercial: { openOpps: accounts.reduce((a, x) => a + x.openOpps, 0), openValueCents: accounts.reduce((a, x) => a + x.openValueCents, 0), wonInPeriod: won.rows[0]?.n ?? 0, wonValueCents: Number(won.rows[0]?.v ?? 0), activeContracts: ctrs.rows[0]?.n ?? 0, accountsWithOpp: accounts.filter((a) => a.openOpps > 0).length },
        pesquisas: { responses: nps.length, nps: npsOf(nps.map((n) => n.score)) },
        cobertura: { avg: Math.round(accounts.reduce((a, x) => a + x.coverage.score, 0) / accounts.length), byLevel: count(accounts.map((a) => a.coverage.level)) },
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/accounts/:id/coverage', summary: 'Cobertura de stakeholders da conta, item a item, com as lacunas', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [a] = await app.db.select({ id: s.abmAccounts.id }).from(s.abmAccounts).where(and(eq(s.abmAccounts.contactId, params.id), vis(auth))).limit(1);
      if (!a) throw notFound('Conta não encontrada no ABM.');
      return (await coverageFor(app.db, auth, [params.id])).get(params.id)!;
    },
  }),
];
