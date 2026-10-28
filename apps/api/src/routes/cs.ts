/** Sucesso do Cliente: carteira, cobertura, conta 360°, IPC, prioridade, pesquisas, visitas, planos, jornadas, kickoff e configuração. */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CS_ACTIVITY_KINDS, CS_LEVELS, IPC_CRITERIA, coverage, distributeAccounts, levelRank, validateCsConfig, type CsConfig, type CsLevel,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { AppError, forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import { audit } from '../services/audit';
import { level, ownerScope } from '../services/scope';
import { atLeast, milestoneChanges } from '@isp/domain';
import { logMilestone } from '../services/journeyTrail';
import {
  accountIds, addDays, alertsFor, csConfigOf, explain, generateCadence, hashToken, newShareToken, openMilestoneTasks, recomputeAccounts, regenerateKickoff, runCsDaily, snapshotOf, startJourney, syncAlerts, todayIso, type Snapshot,
} from '../services/cs';

export const manager = (a: AuthContext) => atLeast(level(a, 'clientes'), 'equipe') || a.sectors.includes('diretoria');
const isAdmin = (a: AuthContext) => a.access.configuracoes === 'total';
const ContactParams = z.object({ contactId: z.string().uuid() });
const Period = z.object({ from: z.string().date().optional(), to: z.string().date().optional() });
const monthStart = () => `${todayIso().slice(0, 7)}-01`;

/** Acesso à conta: estar na carteira de clientes do usuário ou ser o CSM dela. */
export async function account(db: DbOrTx, auth: AuthContext, contactId: string) {
  const [c] = await db.select({ id: s.contacts.id, name: s.contacts.name, ownerId: s.contacts.ownerId }).from(s.contacts).where(and(eq(s.contacts.id, contactId), eq(s.contacts.tenantId, auth.tenantId), isNull(s.contacts.deletedAt))).limit(1);
  if (!c) throw notFound('Cliente não encontrado.');
  const [a] = await db.select().from(s.csAccounts).where(and(eq(s.csAccounts.tenantId, auth.tenantId), eq(s.csAccounts.contactId, contactId))).limit(1);
  const [inScope] = await db.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.id, contactId), ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt }))).limit(1);
  const isCsm = a?.csmId === auth.userId;
  if (!inScope && !isCsm && !manager(auth)) throw notFound('Cliente não encontrado.');
  return { contact: c, acc: a ?? null, canEdit: isCsm || manager(auth) || (!!inScope && auth.sectors.includes('sucesso_cliente')) };
}
export function requireEdit(x: { canEdit: boolean }) { if (!x.canEdit) throw forbidden('Só o CSM da conta ou a gestão alteram o acompanhamento.'); }

type Row = { contactId: string; name: string; csmId: string | null; csmName: string | null; snapshot: Snapshot };
/** Carteira visível: gestão vê todas; CSM vê as suas e as da própria carteira de clientes. */
async function portfolio(db: DbOrTx, auth: AuthContext, f: { csmId?: string; tier?: string; level?: string; classKey?: string; teamId?: string }) {
  const rows = await db.select({ contactId: s.csAccounts.contactId, name: s.contacts.name, ownerId: s.contacts.ownerId, csmId: s.csAccounts.csmId, csmName: s.users.name, snapshot: s.csAccounts.snapshot }).from(s.csAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.csAccounts.contactId)).leftJoin(s.users, eq(s.users.id, s.csAccounts.csmId))
    .where(and(eq(s.csAccounts.tenantId, auth.tenantId), isNull(s.contacts.deletedAt), isNotNull(s.csAccounts.snapshot)));
  let team: Set<string> | null = null;
  if (f.teamId) team = new Set((await db.select({ u: s.teamMemberships.userId }).from(s.teamMemberships).where(eq(s.teamMemberships.teamId, f.teamId))).map((x) => x.u));
  const all = manager(auth);
  return rows.filter((r) => (all || r.csmId === auth.userId || r.ownerId === auth.userId)
    && (!f.csmId || r.csmId === f.csmId) && (!team || (r.csmId && team.has(r.csmId)))
    && (!f.tier || (r.snapshot as Snapshot).tier === f.tier) && (!f.level || (r.snapshot as Snapshot).effective.level === f.level) && (!f.classKey || (r.snapshot as Snapshot).classKey === f.classKey))
    .map((r) => ({ contactId: r.contactId, name: r.name, csmId: r.csmId, csmName: r.csmName, snapshot: r.snapshot as Snapshot })) as Row[];
}

/** Acompanhamentos (atividades de Sucesso do Cliente) das contas no período, com o peso gravado na época. */
async function followUps(db: DbOrTx, tenantId: string, contactIds: string[], from: string, to: string) {
  if (!contactIds.length) return [];
  return db.select({ id: s.activities.id, contactId: s.activities.contactId, ownerId: s.activities.ownerId, kind: s.activities.csKind, plannedAt: s.activities.csPlannedAt, cadenceKey: s.activities.csCadenceKey, completedAt: s.activities.completedAt, result: s.activities.csResult, weight: s.activities.csWeight, dueAt: s.activities.dueAt, title: s.activities.title })
    .from(s.activities).where(and(eq(s.activities.tenantId, tenantId), inArray(s.activities.contactId, contactIds), isNotNull(s.activities.csKind), isNull(s.activities.deletedAt),
      or(and(isNotNull(s.activities.csPlannedAt), gte(s.activities.csPlannedAt, from), lte(s.activities.csPlannedAt, to)), and(isNull(s.activities.csPlannedAt), gte(s.activities.completedAt, new Date(`${from}T00:00:00Z`)), lte(s.activities.completedAt, new Date(`${to}T23:59:59Z`))))));
}
const cov = (items: Awaited<ReturnType<typeof followUps>>, tol: number) => coverage(items.map((i) => ({ plannedAt: i.plannedAt ?? '', completedAt: i.completedAt?.toISOString() ?? null, validated: !!i.result, weight: i.weight ?? 1, cadence: !!i.cadenceKey && !!i.plannedAt })), tol);

export const csRoutes = [
  // ------------------------------------------------------------------ configuração
  defineRoute({
    method: 'GET', url: '/cs/config', summary: 'Configuração do Sucesso do Cliente (versão vigente e histórico)', tag: 'Sucesso do Cliente', module: 'clientes',
    handler: async ({ app, auth }) => {
      const cur = await csConfigOf(app.db, auth.tenantId);
      const history = await app.db.select({ version: s.csSettings.version, note: s.csSettings.note, createdAt: s.csSettings.createdAt, by: s.users.name }).from(s.csSettings).leftJoin(s.users, eq(s.users.id, s.csSettings.createdBy)).where(eq(s.csSettings.tenantId, auth.tenantId)).orderBy(desc(s.csSettings.version));
      const pipes = await app.db.select({ key: s.pipelines.key, name: s.pipelines.name, id: s.pipelines.id }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, auth.tenantId), eq(s.pipelines.active, true)));
      const stages = await app.db.select({ pipelineId: s.pipelineStages.pipelineId, key: s.pipelineStages.key, name: s.pipelineStages.name }).from(s.pipelineStages).where(eq(s.pipelineStages.tenantId, auth.tenantId)).orderBy(asc(s.pipelineStages.position));
      const csms = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).orderBy(asc(s.users.name));
      return { ...cur, history, pipelines: pipes.map((p) => ({ ...p, stages: stages.filter((x) => x.pipelineId === p.id) })), users: csms, canEdit: isAdmin(auth) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/cs/config', summary: 'Nova versão da configuração (cálculos antigos mantêm a versão da época)', tag: 'Sucesso do Cliente', module: 'configuracoes', min: 'total',
    body: z.object({ config: z.record(z.string(), z.unknown()), note: z.string().trim().min(5, 'Explique a mudança').max(1000) }),
    handler: async ({ app, auth, body, req, reply }) => {
      const merged = { ...(await csConfigOf(app.db, auth.tenantId)).config, ...body.config } as CsConfig;
      const errs = validateCsConfig(merged);
      if (errs.length) throw unprocessable(errs.join(' '));
      const cur = await csConfigOf(app.db, auth.tenantId);
      await app.db.insert(s.csSettings).values({ tenantId: auth.tenantId, version: cur.version + 1, config: merged as unknown as Record<string, unknown>, note: body.note, createdBy: auth.userId });
      await audit(app.db, req, { action: 'cs.config', entityType: 'tenant', entityId: auth.tenantId, metadata: { version: cur.version + 1 } });
      await recomputeAccounts(app.db, auth.tenantId);
      reply.code(201);
      return { version: cur.version + 1 };
    },
  }),

  // ------------------------------------------------------------------ carteira, atenção, gestão
  defineRoute({
    method: 'GET', url: '/cs/portfolio', summary: 'Carteira: contas com Tier, IPC, classe, saúde, criticidade e motivo; prioridades de hoje; contas críticas sem acompanhamento', tag: 'Sucesso do Cliente', module: 'clientes',
    query: Period.extend({ csmId: z.string().uuid().optional(), tier: z.string().max(20).optional(), level: z.enum(CS_LEVELS).optional(), classKey: z.string().max(80).optional(), teamId: z.string().uuid().optional() }),
    handler: async ({ app, auth, query }) => {
      const { config: cfg, version } = await csConfigOf(app.db, auth.tenantId);
      const from = query.from ?? monthStart(), to = query.to ?? todayIso();
      const rows = await portfolio(app.db, auth, query);
      const ids = rows.map((r) => r.contactId);
      const fu = await followUps(app.db, auth.tenantId, ids, from, to);
      const alerts = ids.length ? await app.db.select().from(s.csAlerts).where(and(eq(s.csAlerts.tenantId, auth.tenantId), inArray(s.csAlerts.contactId, ids), isNull(s.csAlerts.resolvedAt))) : [];
      const today = todayIso();
      const accounts = rows.map((r) => {
        const sn = r.snapshot;
        const mine = fu.filter((f) => f.contactId === r.contactId);
        const al = alerts.filter((a) => a.contactId === r.contactId);
        const score = levelRank(sn.effective.level) * 1000 + Math.min(300, sn.overdueFollowUpDays * 5) + al.filter((a) => a.level === 'alta').length * 50 + al.length * 10 + (sn.health.score === null ? 0 : 100 - sn.health.score) + (sn.ipc.total ?? 0) / 2 + (sn.daysToEnd !== null && sn.daysToEnd < 90 ? 90 - sn.daysToEnd : 0);
        return {
          contactId: r.contactId, name: r.name, csmId: r.csmId, csmName: r.csmName, tier: sn.tier, acvCents: sn.groupAcvCents, ipc: sn.ipc.total, ipcPending: sn.ipc.pending.length, classKey: sn.classKey,
          health: sn.health.score, healthLabel: sn.health.label, criticality: sn.criticality.level, effective: sn.effective, manual: sn.manual, lastContactAt: sn.lastContactAt, nextContactAt: sn.nextContactAt,
          daysToEnd: sn.daysToEnd, overdueDays: sn.overdueFollowUpDays, satisfaction: sn.satisfaction.last, reason: explain(sn), reasons: sn.criticality.reasons,
          alerts: al.map((a) => ({ key: a.key, level: a.level, text: a.text, category: a.category })), coverage: cov(mine, cfg.onTimeToleranceDays), priorityScore: Math.round(score),
          expansion: sn.expansion, policy: sn.policy, computedAt: sn.computedAt,
        };
      }).sort((a, b) => b.priorityScore - a.priorityScore);
      const overall = cov(fu, cfg.onTimeToleranceDays);
      const by = <K extends string>(f: (a: (typeof accounts)[number]) => K | null) => { const m: Record<string, number> = {}; for (const a of accounts) { const k = f(a) ?? 'sem'; m[k] = (m[k] ?? 0) + 1; } return m; };
      const critical = accounts.filter((a) => a.effective.level === 'critica');
      const criticalLate = critical.filter((a) => a.overdueDays > 0 || (a.lastContactAt === null) || (a.policy?.contactDays && a.lastContactAt && (Date.parse(today) - Date.parse(a.lastContactAt)) / 86_400_000 > a.policy.contactDays));
      const todayList = await app.db.select({ id: s.activities.id, title: s.activities.title, dueAt: s.activities.dueAt, contactId: s.activities.contactId, kind: s.activities.csKind, plannedAt: s.activities.csPlannedAt, rowVersion: s.activities.rowVersion })
        .from(s.activities).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.ownerId, query.csmId ?? auth.userId), isNotNull(s.activities.csKind), isNull(s.activities.completedAt), isNull(s.activities.deletedAt), lte(s.activities.dueAt, new Date(`${addDays(today, 1)}T03:00:00Z`)))).orderBy(asc(s.activities.dueAt)).limit(100);
      const rank = new Map(accounts.map((a, i) => [a.contactId, i]));
      const priorities = todayList.map((t) => { const a = accounts.find((x) => x.contactId === t.contactId); return { ...t, account: a?.name ?? '', level: a?.effective.level ?? 'baixa', why: a?.reason ?? '', late: !!t.plannedAt && t.plannedAt < today }; })
        .sort((x, y) => levelRank(y.level as CsLevel) - levelRank(x.level as CsLevel) || Number(y.late) - Number(x.late) || (rank.get(x.contactId!) ?? 0) - (rank.get(y.contactId!) ?? 0));
      return {
        period: { from, to }, ruleVersion: version, accounts, coverage: overall,
        totals: {
          accounts: accounts.length, acvCents: accounts.reduce((t, a) => t + a.acvCents, 0), byTier: by((a) => a.tier), byLevel: by((a) => a.effective.level), byClass: by((a) => a.classKey),
          byIpc: by((a) => (a.ipc === null ? null : a.ipc >= 80 ? '80-100' : a.ipc >= 60 ? '60-79' : a.ipc >= 40 ? '40-59' : '20-39')),
          withoutContact: accounts.filter((a) => !a.lastContactAt).length, alerts: alerts.length, atRisk: accounts.filter((a) => a.health !== null && a.health < 50).length,
          renewals90: accounts.filter((a) => a.daysToEnd !== null && a.daysToEnd >= 0 && a.daysToEnd <= 90).length, openExpansion: accounts.reduce((t, a) => t + a.expansion.openValueCents, 0),
        },
        criticalLate: { count: criticalLate.length, ofCritical: critical.length, share: critical.length ? criticalLate.length / critical.length : null, accounts: criticalLate.map((a) => ({ contactId: a.contactId, name: a.name, csmName: a.csmName, overdueDays: a.overdueDays, lastContactAt: a.lastContactAt, nextContactAt: a.nextContactAt, reason: a.reason })) },
        priorities, canManage: manager(auth),
      };
    },
  }),

  defineRoute({
    method: 'GET', url: '/cs/coverage', summary: 'Cobertura simples e ponderada agrupada (CSM, equipe, Tier, classe, criticidade, conta ou mês)', tag: 'Sucesso do Cliente', module: 'clientes',
    query: Period.extend({ groupBy: z.enum(['csm', 'equipe', 'tier', 'classe', 'criticidade', 'conta', 'mes']).default('csm'), csmId: z.string().uuid().optional() }),
    handler: async ({ app, auth, query }) => {
      const { config: cfg } = await csConfigOf(app.db, auth.tenantId);
      const from = query.from ?? addDays(todayIso(), -180), to = query.to ?? todayIso();
      const rows = await portfolio(app.db, auth, { csmId: query.csmId });
      const fu = await followUps(app.db, auth.tenantId, rows.map((r) => r.contactId), from, to);
      const acc = new Map(rows.map((r) => [r.contactId, r]));
      const teams = query.groupBy === 'equipe' ? await app.db.select({ userId: s.teamMemberships.userId, name: s.teams.name }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(eq(s.teams.tenantId, auth.tenantId)) : [];
      const keyOf = (f: (typeof fu)[number]) => {
        const a = acc.get(f.contactId!);
        switch (query.groupBy) {
          case 'csm': return a?.csmName ?? 'Sem CSM';
          case 'equipe': return teams.find((t) => t.userId === a?.csmId)?.name ?? 'Sem equipe';
          case 'tier': return a?.snapshot.tier ?? 'Sem Tier';
          case 'classe': return a?.snapshot.classKey ?? 'Sem classe';
          case 'criticidade': return a?.snapshot.effective.level ?? 'baixa';
          case 'conta': return a?.name ?? '—';
          default: return (f.plannedAt ?? f.completedAt?.toISOString() ?? '').slice(0, 7);
        }
      };
      const groups = new Map<string, typeof fu>();
      for (const f of fu) { const k = keyOf(f); groups.set(k, [...(groups.get(k) ?? []), f]); }
      const noFollow = rows.filter((r) => !fu.some((f) => f.contactId === r.contactId && f.completedAt && f.result)).map((r) => ({ contactId: r.contactId, name: r.name, csmName: r.csmName, level: r.snapshot.effective.level }));
      return { from, to, groupBy: query.groupBy, overall: cov(fu, cfg.onTimeToleranceDays), groups: [...groups.entries()].map(([key, items]) => ({ key, ...cov(items, cfg.onTimeToleranceDays) })).sort((a, b) => a.key.localeCompare(b.key)), withoutFollowUp: noFollow, weights: cfg.coverageWeights, tolerance: cfg.onTimeToleranceDays };
    },
  }),

  defineRoute({
    method: 'GET', url: '/cs/team', summary: 'Painel gerencial: carteira, cobertura, capacidade e scorecard por CSM', tag: 'Sucesso do Cliente', module: 'clientes', min: 'equipe',
    query: Period,
    handler: async ({ app, auth, query }) => {
      const { config: cfg } = await csConfigOf(app.db, auth.tenantId);
      const from = query.from ?? monthStart(), to = query.to ?? todayIso();
      const rows = await portfolio(app.db, auth, {});
      const fu = await followUps(app.db, auth.tenantId, rows.map((r) => r.contactId), from, to);
      const won = rows.length ? await app.db.execute<{ contact_id: string; v: string; n: number }>(sql`select contact_id, coalesce(sum(value_cents),0)::bigint v, count(*)::int n from opportunities where tenant_id = ${auth.tenantId} and stage = 'ganha' and won_at between ${new Date(`${from}T00:00:00Z`)} and ${new Date(`${to}T23:59:59Z`)} and contact_id in (${sql.join(rows.map((r) => sql`${r.contactId}`), sql`, `)}) group by contact_id`) : { rows: [] };
      const visits = rows.length ? await app.db.select({ contactId: s.csVisits.contactId, status: s.csVisits.status, summary: s.csVisits.summary, plannedAt: s.csVisits.plannedAt }).from(s.csVisits).where(and(eq(s.csVisits.tenantId, auth.tenantId), gte(s.csVisits.plannedAt, new Date(`${from}T00:00:00Z`)), lte(s.csVisits.plannedAt, new Date(`${to}T23:59:59Z`)))) : [];
      const plans = await app.db.select({ contactId: s.csActionPlans.contactId, status: s.csActionPlans.status, kind: s.csActionPlans.kind }).from(s.csActionPlans).where(eq(s.csActionPlans.tenantId, auth.tenantId));
      const csms = new Map<string, { id: string | null; name: string; accounts: Row[] }>();
      for (const r of rows) { const k = r.csmId ?? 'none'; const cur = csms.get(k) ?? { id: r.csmId, name: r.csmName ?? 'Sem CSM', accounts: [] }; cur.accounts.push(r); csms.set(k, cur); }
      const per = (days: number | null) => (days ? 30 / days : 0);
      const out = [...csms.values()].map((c) => {
        const ids = new Set(c.accounts.map((a) => a.contactId));
        const mine = fu.filter((f) => ids.has(f.contactId!));
        const cv = cov(mine, cfg.onTimeToleranceDays);
        const crit = c.accounts.filter((a) => a.snapshot.effective.level === 'critica');
        const critCov = cov(mine.filter((f) => crit.some((a) => a.contactId === f.contactId)), cfg.onTimeToleranceDays);
        const demandMin = c.accounts.reduce((t, a) => t + per(a.snapshot.policy?.contactDays ?? null) * cfg.effortMinutes.contato + per(a.snapshot.policy?.visitDays ?? null) * cfg.effortMinutes.visita + per(a.snapshot.policy?.reviewDays ?? null) * cfg.effortMinutes.revisao, 0);
        const done = mine.filter((f) => f.completedAt);
        const quality = done.length ? done.filter((f) => !!f.result && f.result.trim().length >= 15).length / done.length : null;
        const v = visits.filter((x) => ids.has(x.contactId));
        const vDone = v.filter((x) => x.status === 'realizada');
        const wonRows = won.rows.filter((w) => ids.has(w.contact_id));
        const additional = wonRows.reduce((t, w) => t + Number(w.v), 0);
        const plansMine = plans.filter((p) => ids.has(p.contactId));
        const risk = crit.length ? critCov.weighted : null;
        const comercial = c.accounts.length ? Math.min(1, (wonRows.length + c.accounts.filter((a) => a.snapshot.expansion.openCount > 0).length) / c.accounts.length) : null;
        const comp = { operacional: cv.weighted, comercial, qualidade: quality, risco: risk };
        const ws = cfg.scorecard;
        const avail = (Object.keys(comp) as (keyof typeof comp)[]).filter((k) => comp[k] !== null);
        const total = avail.length ? avail.reduce((t, k) => t + (comp[k] ?? 0) * ws[k], 0) / avail.reduce((t, k) => t + ws[k], 0) : null;
        const points = mine.filter((f) => f.result && f.completedAt && (!f.plannedAt || f.completedAt.toISOString().slice(0, 10) <= addDays(f.plannedAt, cfg.onTimeToleranceDays))).reduce((t, f) => t + (f.weight ?? 1) * 10, 0) + vDone.filter((x) => (x.summary ?? '').trim().length >= 20).length * 20 + plansMine.filter((p) => p.status === 'concluido').length * 15;
        return {
          csmId: c.id, name: c.name, accounts: c.accounts.length, acvCents: c.accounts.reduce((t, a) => t + a.snapshot.groupAcvCents, 0),
          byLevel: Object.fromEntries(CS_LEVELS.map((l) => [l, c.accounts.filter((a) => a.snapshot.effective.level === l).length])),
          coverage: cv, criticalCoverage: critCov, visits: { planned: v.length, done: vDone.length, late: v.filter((x) => x.status === 'agendada' && x.plannedAt < new Date()).length },
          contacts: done.filter((f) => f.kind === 'contato').length, withoutContact: c.accounts.filter((a) => !a.snapshot.lastContactAt).length,
          satisfaction: (() => { const xs = c.accounts.map((a) => a.snapshot.satisfaction.last).filter((x): x is number => x !== null); return xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length) : null; })(),
          renewals: c.accounts.filter((a) => a.snapshot.daysToEnd !== null && a.snapshot.daysToEnd >= 0 && a.snapshot.daysToEnd <= 120).length,
          newBusiness: wonRows.reduce((t, w) => t + w.n, 0), additionalCents: additional, openExpansionCents: c.accounts.reduce((t, a) => t + a.snapshot.expansion.openValueCents, 0),
          capacity: { demandHours: Math.round(demandMin / 6) / 10, capacityHours: cfg.csmCapacityHoursMonth, load: cfg.csmCapacityHoursMonth ? demandMin / 60 / cfg.csmCapacityHoursMonth : null },
          scorecard: { ...comp, total, weights: ws }, gamification: { points, rule: 'Só conta o que foi realizado e comprovado: acompanhamento no prazo com resultado (10 × peso), visita realizada com resumo (20) e plano de ação concluído (15).' },
        };
      }).sort((a, b) => b.accounts - a.accounts);
      return { from, to, csms: out, note: 'Comparação justa: a carga considera criticidade, frequência e esforço de cada interação, não só a quantidade de contas.' };
    },
  }),

  defineRoute({
    method: 'POST', url: '/cs/recompute', summary: 'Recalcula as contas (todas ou uma), a cadência e os alertas', tag: 'Sucesso do Cliente', module: 'clientes',
    body: z.object({ contactId: z.string().uuid().optional() }),
    handler: async ({ app, auth, body }) => {
      if (body.contactId) {
        const x = await account(app.db, auth, body.contactId);
        requireEdit(x);
        await recomputeAccounts(app.db, auth.tenantId, [body.contactId]);
        const cad = await generateCadence(app.db, auth.tenantId, [body.contactId]);
        const sn = await snapshotOf(app.db, auth.tenantId, body.contactId);
        if (sn) await syncAlerts(app.db, auth.tenantId, body.contactId, await alertsFor(app.db, auth.tenantId, (await csConfigOf(app.db, auth.tenantId)).config, body.contactId, sn));
        return { accounts: 1, cadence: cad };
      }
      if (!manager(auth)) throw forbidden('Recalcular a carteira inteira é com a gestão.');
      return runCsDaily(app.db, app.config, auth.tenantId);
    },
  }),

  defineRoute({
    method: 'POST', url: '/cs/distribute', summary: 'Distribui a carteira entre CSMs equilibrando valor anual e quantidade (prévia com dryRun; auditado)', tag: 'Sucesso do Cliente', module: 'clientes',
    body: z.object({
      csmIds: z.array(z.string().uuid()).min(1).max(20),
      scope: z.enum(['sem_csm', 'todas']).default('todas'),
      keep: z.boolean().default(true),
      dryRun: z.boolean().default(true),
      justification: z.string().trim().max(500).default(''),
    }),
    handler: async ({ app, auth, body, req }) => {
      if (!manager(auth)) throw forbidden('Distribuir a carteira é com a gestão.');
      const csmIds = [...new Set(body.csmIds)];
      const users = await app.db.select({ id: s.users.id, name: s.users.name, sectors: s.users.sectors }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), inArray(s.users.id, csmIds)));
      if (users.length !== csmIds.length) throw unprocessable('Escolha só usuários ativos da empresa.');
      const notCsm = users.filter((u) => !u.sectors.includes('sucesso_cliente'));
      if (notCsm.length) throw unprocessable(`${notCsm.map((u) => u.name).join(', ')} não tem o setor Sucesso do Cliente no cadastro: só CSMs recebem carteira.`);
      // contas do Sucesso do Cliente (com contrato, jornada ou acompanhamento); quem ainda não tem fotografia é calculado antes
      const ids = await accountIds(app.db, auth.tenantId);
      const load0 = () => (ids.length ? app.db.select({ contactId: s.csAccounts.contactId, csmId: s.csAccounts.csmId, snapshot: s.csAccounts.snapshot }).from(s.csAccounts).where(and(eq(s.csAccounts.tenantId, auth.tenantId), inArray(s.csAccounts.contactId, ids))) : Promise.resolve([]));
      let rows = await load0();
      const missing = ids.filter((id) => !rows.some((r) => r.contactId === id && r.snapshot));
      if (missing.length) { await recomputeAccounts(app.db, auth.tenantId, missing); rows = await load0(); }
      const acc = ids.map((id) => { const r = rows.find((x) => x.contactId === id); return { id, csmId: r?.csmId ?? null, acvCents: (r?.snapshot as Snapshot | null)?.groupAcvCents ?? 0 }; });
      const pool = body.scope === 'sem_csm' ? acc.filter((a) => !a.csmId) : acc;
      const { assign, load } = distributeAccounts(pool, csmIds, body.keep);
      const moves = [...assign.entries()].filter(([id, to]) => acc.find((a) => a.id === id)?.csmId !== to);
      const preview = {
        accounts: pool.length, changes: moves.length,
        csms: users.map((u) => ({ id: u.id, name: u.name, accounts: load.get(u.id)!.count, acvCents: load.get(u.id)!.acvCents })),
        outside: acc.length - pool.length,
      };
      if (body.dryRun) return { ...preview, applied: false };
      if (body.justification.length < 10) throw unprocessable('Explique o motivo da distribuição (pelo menos 10 caracteres).');
      for (const [contactId, to] of moves) {
        const from = acc.find((a) => a.id === contactId)?.csmId ?? null;
        await app.db.insert(s.csAccounts).values({ tenantId: auth.tenantId, contactId, csmId: to })
          .onConflictDoUpdate({ target: [s.csAccounts.tenantId, s.csAccounts.contactId], set: { csmId: to, updatedAt: new Date() } });
        await app.db.insert(s.csAssessments).values({ tenantId: auth.tenantId, contactId, kind: 'csm', data: { from, to, via: 'distribuicao' }, justification: body.justification, actorId: auth.userId });
        // acompanhamentos em aberto passam para o novo CSM (como na troca individual)
        await app.db.update(s.activities).set({ ownerId: to, updatedAt: new Date() }).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.contactId, contactId), isNotNull(s.activities.csKind), isNull(s.activities.completedAt), isNull(s.activities.deletedAt)));
      }
      const changed = moves.map(([id]) => id);
      if (changed.length) { await recomputeAccounts(app.db, auth.tenantId, changed); await generateCadence(app.db, auth.tenantId, changed); }
      await audit(app.db, req, { action: 'cs.distribute', entityType: 'tenant', entityId: auth.tenantId, metadata: { csmIds, scope: body.scope, keep: body.keep, changes: changed.length, justification: body.justification } });
      return { ...preview, applied: true };
    },
  }),

  // ------------------------------------------------------------------ conta 360°
  defineRoute({
    method: 'GET', url: '/cs/accounts/:contactId', summary: 'Visão 360° da conta no Sucesso do Cliente', tag: 'Sucesso do Cliente', module: 'clientes', params: ContactParams,
    handler: async ({ app, auth, params }) => {
      const x = await account(app.db, auth, params.contactId);
      let sn = await snapshotOf(app.db, auth.tenantId, params.contactId);
      if (!sn || Date.now() - Date.parse(sn.computedAt) > 6 * 3600_000) sn = await snapshotOf(app.db, auth.tenantId, params.contactId, true);
      const t = auth.tenantId, c = params.contactId;
      const [journeys, surveys, visits, plans, alerts, ipcHist, hist, opps, acts, csm] = await Promise.all([
        app.db.select().from(s.csJourneys).where(and(eq(s.csJourneys.tenantId, t), eq(s.csJourneys.contactId, c))).orderBy(desc(s.csJourneys.createdAt)),
        app.db.select({ v: s.csSurveys, by: s.users.name }).from(s.csSurveys).leftJoin(s.users, eq(s.users.id, s.csSurveys.actorId)).where(and(eq(s.csSurveys.tenantId, t), eq(s.csSurveys.contactId, c))).orderBy(desc(s.csSurveys.respondedAt)).limit(30),
        app.db.select({ v: s.csVisits, csm: s.users.name }).from(s.csVisits).leftJoin(s.users, eq(s.users.id, s.csVisits.csmId)).where(and(eq(s.csVisits.tenantId, t), eq(s.csVisits.contactId, c))).orderBy(desc(s.csVisits.plannedAt)).limit(50),
        app.db.select({ p: s.csActionPlans, owner: s.users.name }).from(s.csActionPlans).leftJoin(s.users, eq(s.users.id, s.csActionPlans.ownerId)).where(and(eq(s.csActionPlans.tenantId, t), eq(s.csActionPlans.contactId, c))).orderBy(desc(s.csActionPlans.createdAt)),
        app.db.select().from(s.csAlerts).where(and(eq(s.csAlerts.tenantId, t), eq(s.csAlerts.contactId, c), isNull(s.csAlerts.resolvedAt))),
        app.db.select({ a: s.csAssessments, by: s.users.name }).from(s.csAssessments).leftJoin(s.users, eq(s.users.id, s.csAssessments.actorId)).where(and(eq(s.csAssessments.tenantId, t), eq(s.csAssessments.contactId, c), eq(s.csAssessments.kind, 'ipc'))).orderBy(desc(s.csAssessments.createdAt)).limit(20),
        app.db.select({ a: s.csAssessments, by: s.users.name }).from(s.csAssessments).leftJoin(s.users, eq(s.users.id, s.csAssessments.actorId)).where(and(eq(s.csAssessments.tenantId, t), eq(s.csAssessments.contactId, c), inArray(s.csAssessments.kind, ['tier', 'saude', 'criticidade', 'prioridade_manual', 'csm']))).orderBy(desc(s.csAssessments.createdAt)).limit(60),
        app.db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, valueCents: s.opportunities.valueCents, wonAt: s.opportunities.wonAt, createdAt: s.opportunities.createdAt }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, t), eq(s.opportunities.contactId, c), isNull(s.opportunities.deletedAt))).orderBy(desc(s.opportunities.createdAt)).limit(30),
        app.db.select({ id: s.activities.id, title: s.activities.title, kind: s.activities.csKind, dueAt: s.activities.dueAt, plannedAt: s.activities.csPlannedAt, completedAt: s.activities.completedAt, result: s.activities.csResult, cadence: s.activities.csCadenceKey, planId: s.activities.csPlanId, ownerName: s.users.name, rowVersion: s.activities.rowVersion }).from(s.activities).leftJoin(s.users, eq(s.users.id, s.activities.ownerId)).where(and(eq(s.activities.tenantId, t), eq(s.activities.contactId, c), isNull(s.activities.deletedAt), or(isNotNull(s.activities.csKind), isNotNull(s.activities.csPlanId)))).orderBy(desc(s.activities.dueAt)).limit(120),
        x.acc?.csmId ? app.db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users).where(eq(s.users.id, x.acc.csmId)).limit(1) : Promise.resolve([]),
      ]);
      const cls = await app.db.select({ classKey: s.contactClassifications.classKey, createdAt: s.contactClassifications.createdAt, notes: s.contactClassifications.notes, by: s.users.name }).from(s.contactClassifications).leftJoin(s.users, eq(s.users.id, s.contactClassifications.classifiedBy)).where(and(eq(s.contactClassifications.tenantId, t), eq(s.contactClassifications.contactId, c))).orderBy(desc(s.contactClassifications.createdAt)).limit(10);
      const { config: cfg } = await csConfigOf(app.db, t);
      const ixc = await app.db.select({ enabled: s.integrations.enabled }).from(s.integrations).where(and(eq(s.integrations.tenantId, t), eq(s.integrations.kind, 'ixc'))).limit(1);
      return {
        contact: x.contact, canEdit: x.canEdit, csm: csm[0] ?? null, churnRisk: x.acc?.churnRisk ?? null, snapshot: sn, reason: sn ? explain(sn) : null,
        coverage: cov(await followUps(app.db, t, [c], addDays(todayIso(), -90), todayIso()), cfg.onTimeToleranceDays),
        journeys, surveys: surveys.map(({ v, by }) => ({ ...v, actorName: by })), visits: visits.map(({ v, csm: n }) => ({ ...v, csmName: n })), plans: plans.map(({ p, owner }) => ({ ...p, ownerName: owner })),
        alerts, ipcHistory: ipcHist.map(({ a, by }) => ({ ...a, actorName: by })), history: hist.map(({ a, by }) => ({ ...a, actorName: by })), classHistory: cls,
        opportunities: opps, followUps: acts, ixc: { configured: !!ixc[0]?.enabled, dataAvailable: false },
        options: { visitTypes: cfg.visitTypes, surveyKinds: cfg.surveyKinds, ipcPoints: cfg.ipcPoints },
      };
    },
  }),

  defineRoute({
    method: 'PATCH', url: '/cs/accounts/:contactId', summary: 'Define CSM e risco de cancelamento da conta', tag: 'Sucesso do Cliente', module: 'clientes', params: ContactParams,
    body: z.object({ csmId: z.string().uuid().nullable().optional(), churnRisk: z.enum(['baixo', 'medio', 'alto']).nullable().optional(), justification: z.string().trim().max(500).optional() }),
    handler: async ({ app, auth, params, body }) => {
      const x = await account(app.db, auth, params.contactId);
      requireEdit(x);
      if (body.csmId !== undefined && !manager(auth)) throw forbidden('Trocar o CSM da conta é com a gestão.');
      if (body.csmId) { const [u] = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, body.csmId), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).limit(1); if (!u) throw unprocessable('Usuário inválido.'); }
      await app.db.insert(s.csAccounts).values({ tenantId: auth.tenantId, contactId: params.contactId, csmId: body.csmId ?? x.acc?.csmId ?? null, churnRisk: body.churnRisk === undefined ? x.acc?.churnRisk ?? null : body.churnRisk })
        .onConflictDoUpdate({ target: [s.csAccounts.tenantId, s.csAccounts.contactId], set: { ...(body.csmId !== undefined ? { csmId: body.csmId } : {}), ...(body.churnRisk !== undefined ? { churnRisk: body.churnRisk } : {}), updatedAt: new Date() } });
      if (body.csmId !== undefined) {
        await app.db.insert(s.csAssessments).values({ tenantId: auth.tenantId, contactId: params.contactId, kind: 'csm', data: { from: x.acc?.csmId ?? null, to: body.csmId }, justification: body.justification ?? null, actorId: auth.userId });
        // acompanhamentos futuros em aberto passam para o novo CSM
        if (body.csmId) await app.db.update(s.activities).set({ ownerId: body.csmId, updatedAt: new Date() }).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.contactId, params.contactId), isNotNull(s.activities.csKind), isNull(s.activities.completedAt), isNull(s.activities.deletedAt)));
      }
      await recomputeAccounts(app.db, auth.tenantId, [params.contactId]);
      await generateCadence(app.db, auth.tenantId, [params.contactId]);
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST', url: '/cs/accounts/:contactId/priority', summary: 'Prioridade manual (a calculada é mantida em separado)', tag: 'Sucesso do Cliente', module: 'clientes', params: ContactParams,
    body: z.object({ level: z.enum(CS_LEVELS).nullable(), reason: z.string().trim().min(10, 'Explique o motivo (mín. 10 caracteres)').max(1000), reviewAt: z.string().date().nullable().default(null) }),
    handler: async ({ app, auth, params, body }) => {
      const x = await account(app.db, auth, params.contactId);
      requireEdit(x);
      if (body.level && !body.reviewAt) throw unprocessable('Defina o prazo de revisão da prioridade manual.', [{ path: 'reviewAt', message: 'Obrigatório' }]);
      await app.db.insert(s.csAccounts).values({ tenantId: auth.tenantId, contactId: params.contactId, manualLevel: body.level, manualReason: body.reason, manualBy: auth.userId, manualAt: new Date(), manualReviewAt: body.reviewAt })
        .onConflictDoUpdate({ target: [s.csAccounts.tenantId, s.csAccounts.contactId], set: { manualLevel: body.level, manualReason: body.reason, manualBy: auth.userId, manualAt: new Date(), manualReviewAt: body.reviewAt, updatedAt: new Date() } });
      await app.db.insert(s.csAssessments).values({ tenantId: auth.tenantId, contactId: params.contactId, kind: 'prioridade_manual', data: { reviewAt: body.reviewAt }, level: body.level ?? 'removida', justification: body.reason, actorId: auth.userId, ruleVersion: (await csConfigOf(app.db, auth.tenantId)).version });
      await recomputeAccounts(app.db, auth.tenantId, [params.contactId]);
      await generateCadence(app.db, auth.tenantId, [params.contactId]);
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST', url: '/cs/accounts/:contactId/ipc', summary: 'Avaliação do Score IPC (critérios qualitativos; os objetivos são calculados)', tag: 'Sucesso do Cliente', module: 'clientes', params: ContactParams,
    body: z.object({ levels: z.object(Object.fromEntries(IPC_CRITERIA.map((k) => [k, z.enum(['baixo', 'medio', 'alto']).nullable().optional()])) as Record<(typeof IPC_CRITERIA)[number], z.ZodOptional<z.ZodNullable<z.ZodEnum<['baixo', 'medio', 'alto']>>>>), justification: z.string().trim().min(10, 'Justifique a avaliação').max(2000), evidence: z.string().trim().max(2000).nullable().default(null) }),
    handler: async ({ app, auth, params, body }) => {
      const x = await account(app.db, auth, params.contactId);
      requireEdit(x);
      const { config: cfg, version } = await csConfigOf(app.db, auth.tenantId);
      const sn = await snapshotOf(app.db, auth.tenantId, params.contactId, true);
      const levels = Object.fromEntries(Object.entries(body.levels).filter(([, v]) => v)) as Record<string, string>;
      // critérios objetivos com dado confiável não são sobrescritos pela avaliação manual
      for (const k of sn?.ipc.auto ?? []) delete levels[k];
      const merged = { ...levels, ...Object.fromEntries((sn?.ipc.auto ?? []).map((k) => [k, (sn!.ipc.levels as Record<string, string>)[k]])) };
      const { ipcScore } = await import('@isp/domain');
      const sc = ipcScore(merged as never, cfg);
      await app.db.insert(s.csAssessments).values({ tenantId: auth.tenantId, contactId: params.contactId, kind: 'ipc', data: levels, score: sc.total, level: sc.complete ? 'completa' : 'incompleta', justification: body.justification, evidence: body.evidence, ruleVersion: version, actorId: auth.userId });
      await recomputeAccounts(app.db, auth.tenantId, [params.contactId]);
      return { total: sc.total, pending: sc.pending };
    },
  }),

  defineRoute({
    method: 'POST', url: '/cs/accounts/:contactId/surveys', summary: 'Registra resposta de pesquisa (NPS, CSAT, experiência…)', tag: 'Sucesso do Cliente', module: 'clientes', params: ContactParams,
    body: z.object({ kind: z.string().trim().min(2).max(40), score: z.number().int().min(0).max(10), scale: z.number().int().refine((v) => [5, 10].includes(v), 'Escala 5 ou 10'), respondent: z.string().trim().max(200).nullable().default(null), comment: z.string().trim().max(2000).nullable().default(null), respondedAt: z.string().date() }),
    handler: async ({ app, auth, params, body, reply }) => {
      const x = await account(app.db, auth, params.contactId);
      requireEdit(x);
      if (body.scale === 5 && (body.score < 1 || body.score > 5)) throw unprocessable('Na escala de 5, a nota vai de 1 a 5.');
      await app.db.insert(s.csSurveys).values({ tenantId: auth.tenantId, contactId: params.contactId, ...body, actorId: auth.userId });
      // pesquisa prevista na jornada fica cumprida
      await app.db.update(s.csMilestones).set({ doneAt: new Date(), doneBy: auth.userId }).where(and(isNull(s.csMilestones.doneAt), sql`${s.csMilestones.key} in ('pesquisa','satisfacao_ren')`, sql`${s.csMilestones.journeyId} in (select id from cs_journeys where contact_id = ${params.contactId} and status = 'ativa')`, sql`${s.csMilestones.plannedAt} <= ${addDays(todayIso(), 30)}`));
      await recomputeAccounts(app.db, auth.tenantId, [params.contactId]);
      reply.code(201);
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST', url: '/cs/accounts/:contactId/followups', summary: 'Registra acompanhamento realizado (conclui o previsto ou entra como ação adicional)', tag: 'Sucesso do Cliente', module: 'clientes', params: ContactParams,
    body: z.object({ activityId: z.string().uuid().nullable().default(null), kind: z.enum(CS_ACTIVITY_KINDS), doneAt: z.string().datetime({ offset: true }).optional(), result: z.string().trim().min(5, 'Descreva o resultado do acompanhamento').max(2000), nextAction: z.string().trim().max(300).nullable().default(null), nextAt: z.string().date().nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const x = await account(app.db, auth, params.contactId);
      requireEdit(x);
      const at = body.doneAt ? new Date(body.doneAt) : new Date();
      if (at.getTime() > Date.now() + 3600_000) throw unprocessable('A data de realização não pode estar no futuro.');
      let id = body.activityId;
      if (id) {
        const [a] = await app.db.select().from(s.activities).where(and(eq(s.activities.id, id), eq(s.activities.tenantId, auth.tenantId), eq(s.activities.contactId, params.contactId))).limit(1);
        if (!a) throw notFound('Acompanhamento não encontrado.');
        if (a.completedAt && a.csResult) throw unprocessable('Este acompanhamento já foi registrado.');
        await app.db.update(s.activities).set({ completedAt: at, completedBy: auth.userId, csResult: body.result, csKind: a.csKind ?? body.kind, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, id));
        await app.db.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: id, type: 'completed', actorId: auth.userId, payload: { csResult: true } });
        const doneMs = await app.db.update(s.csMilestones).set({ doneAt: at, doneBy: auth.userId }).where(and(eq(s.csMilestones.activityId, id), isNull(s.csMilestones.doneAt))).returning({ id: s.csMilestones.id, journeyId: s.csMilestones.journeyId });
        for (const dm of doneMs) await logMilestone(app.db, auth.tenantId, dm.journeyId, dm.id, [{ type: 'concluido', from: null, to: at, via: 'acompanhamento' }], auth.userId);
      } else {
        const type = body.kind === 'visita' ? 'visita' : body.kind === 'reuniao' || body.kind === 'revisao' ? 'reuniao' : body.kind === 'contato' ? 'ligacao' : 'tarefa';
        const [a] = await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type, title: `Acompanhamento registrado · ${x.contact.name}`.slice(0, 200), notes: body.result, dueAt: at, priority: 'media', ownerId: auth.userId, contactId: params.contactId, csKind: body.kind, csResult: body.result, completedAt: at, completedBy: auth.userId, createdBy: auth.userId }).returning({ id: s.activities.id });
        id = a!.id;
        await app.db.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: id, type: 'created', actorId: auth.userId, payload: { csAdicional: true } });
      }
      if (body.nextAction && body.nextAt) await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type: 'tarefa', title: body.nextAction.slice(0, 200), dueAt: new Date(`${body.nextAt}T12:00:00Z`), priority: 'media', ownerId: auth.userId, contactId: params.contactId, createdBy: auth.userId });
      await recomputeAccounts(app.db, auth.tenantId, [params.contactId]);
      await generateCadence(app.db, auth.tenantId, [params.contactId]);
      reply.code(201);
      return { id };
    },
  }),

  // ------------------------------------------------------------------ planos de ação e ocorrências
  defineRoute({
    method: 'POST', url: '/cs/accounts/:contactId/plans', summary: 'Abre plano de ação ou registra ocorrência (com passos como tarefas)', tag: 'Sucesso do Cliente', module: 'clientes', params: ContactParams,
    body: z.object({ kind: z.enum(['plano', 'ocorrencia']).default('plano'), title: z.string().trim().min(3).max(200), reason: z.string().trim().max(2000).nullable().default(null), severity: z.enum(['baixa', 'media', 'alta']).nullable().default(null), ownerId: z.string().uuid().nullable().default(null), dueAt: z.string().date().nullable().default(null), alertKey: z.string().max(80).nullable().default(null), steps: z.array(z.object({ title: z.string().trim().min(3).max(200), dueAt: z.string().date() })).max(20).default([]) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const x = await account(app.db, auth, params.contactId);
      requireEdit(x);
      const ownerId = body.ownerId ?? x.acc?.csmId ?? auth.userId;
      const [p] = await app.db.insert(s.csActionPlans).values({ tenantId: auth.tenantId, contactId: params.contactId, kind: body.kind, title: body.title, reason: body.reason, severity: body.severity, ownerId, dueAt: body.dueAt, alertKey: body.alertKey, createdBy: auth.userId }).returning();
      for (const st of body.steps) await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type: 'tarefa', title: st.title, dueAt: new Date(`${st.dueAt}T12:00:00Z`), priority: body.severity === 'alta' ? 'alta' : 'media', ownerId, contactId: params.contactId, csPlanId: p!.id, createdBy: auth.userId });
      await recomputeAccounts(app.db, auth.tenantId, [params.contactId]);
      reply.code(201);
      return p;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/cs/plans/:id', summary: 'Conclui ou cancela plano de ação / ocorrência', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ status: z.enum(['concluido', 'cancelado']), note: z.string().trim().min(5, 'Descreva o desfecho').max(1000) }),
    handler: async ({ app, auth, params, body }) => {
      const [p] = await app.db.select().from(s.csActionPlans).where(and(eq(s.csActionPlans.id, params.id), eq(s.csActionPlans.tenantId, auth.tenantId))).limit(1);
      if (!p) throw notFound('Plano não encontrado.');
      requireEdit(await account(app.db, auth, p.contactId));
      if (p.status !== 'aberto') throw unprocessable('Plano já encerrado.');
      await app.db.update(s.csActionPlans).set({ status: body.status, closedAt: new Date(), closedNote: body.note }).where(eq(s.csActionPlans.id, p.id));
      await recomputeAccounts(app.db, auth.tenantId, [p.contactId]);
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ visitas
  defineRoute({
    method: 'POST', url: '/cs/accounts/:contactId/visits', summary: 'Agenda visita (vira compromisso na agenda do CSM)', tag: 'Sucesso do Cliente', module: 'clientes', params: ContactParams,
    body: z.object({ type: z.string().trim().min(2).max(60), modality: z.enum(['presencial', 'remota']).default('presencial'), objective: z.string().trim().min(5).max(1000), plannedAt: z.string().datetime({ offset: true }), participants: z.string().trim().max(1000).nullable().default(null), contractIds: z.array(z.string().uuid()).max(20).default([]), csmId: z.string().uuid().nullable().default(null) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const x = await account(app.db, auth, params.contactId);
      requireEdit(x);
      if (body.contractIds.length) { const ok = await app.db.select({ id: s.contracts.id }).from(s.contracts).where(and(inArray(s.contracts.id, body.contractIds), eq(s.contracts.contactId, params.contactId))); if (ok.length !== body.contractIds.length) throw unprocessable('Contrato de outra conta.'); }
      const csmId = body.csmId ?? x.acc?.csmId ?? auth.userId;
      // usa a visita prevista pela cadência, se houver uma aberta perto da data (não duplica o compromisso)
      const day = body.plannedAt.slice(0, 10);
      const [planned] = await app.db.select({ id: s.activities.id }).from(s.activities).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.contactId, params.contactId), eq(s.activities.csKind, 'visita'), isNull(s.activities.completedAt), isNull(s.activities.deletedAt), sql`not exists (select 1 from cs_visits v where v.activity_id = ${s.activities.id})`, sql`${s.activities.csPlannedAt} between ${addDays(day, -45)} and ${addDays(day, 45)}`)).orderBy(asc(s.activities.csPlannedAt)).limit(1);
      let activityId = planned?.id ?? null;
      if (activityId) await app.db.update(s.activities).set({ dueAt: new Date(body.plannedAt), ownerId: csmId, updatedAt: new Date() }).where(eq(s.activities.id, activityId));
      else activityId = (await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type: 'visita', title: `Visita (${body.type}) · ${x.contact.name}`.slice(0, 200), notes: body.objective, dueAt: new Date(body.plannedAt), priority: 'media', ownerId: csmId, contactId: params.contactId, csKind: 'visita', createdBy: auth.userId }).returning({ id: s.activities.id }))[0]!.id;
      const [v] = await app.db.insert(s.csVisits).values({ tenantId: auth.tenantId, contactId: params.contactId, contractIds: body.contractIds, csmId, type: body.type, modality: body.modality, participants: body.participants, objective: body.objective, plannedAt: new Date(body.plannedAt), activityId, createdBy: auth.userId }).returning();
      reply.code(201);
      return v;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/cs/visits/:id', summary: 'Registra a visita realizada (resumo, demandas, riscos, oportunidades, próximos passos) ou cancela', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ status: z.enum(['realizada', 'cancelada']), doneAt: z.string().datetime({ offset: true }).optional(), summary: z.string().trim().max(4000).nullable().default(null), demands: z.string().trim().max(2000).nullable().default(null), risks: z.string().trim().max(2000).nullable().default(null), opportunities: z.string().trim().max(2000).nullable().default(null), nextSteps: z.array(z.object({ title: z.string().trim().min(3).max(200), dueAt: z.string().date() })).max(20).default([]), participants: z.string().trim().max(1000).nullable().optional(), createOpportunity: z.boolean().default(false) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [v] = await app.db.select().from(s.csVisits).where(and(eq(s.csVisits.id, params.id), eq(s.csVisits.tenantId, auth.tenantId))).limit(1);
      if (!v) throw notFound('Visita não encontrada.');
      const x = await account(app.db, auth, v.contactId);
      requireEdit(x);
      if (v.status !== 'agendada') throw unprocessable('Visita já registrada.');
      if (body.status === 'realizada' && (body.summary ?? '').length < 20) throw unprocessable('Descreva o resumo da visita (mín. 20 caracteres): sem registro, a visita não conta como realizada.', [{ path: 'summary', message: 'Obrigatório' }]);
      const at = body.doneAt ? new Date(body.doneAt) : new Date();
      if (body.status === 'realizada' && at.getTime() > Date.now() + 3600_000) throw unprocessable('A visita não pode ser registrada como realizada no futuro.');
      await app.db.update(s.csVisits).set({ status: body.status, doneAt: body.status === 'realizada' ? at : null, summary: body.summary, demands: body.demands, risks: body.risks, opportunities: body.opportunities, nextSteps: body.nextSteps.map((n) => `${n.title} (${n.dueAt})`).join('\n') || null, ...(body.participants !== undefined ? { participants: body.participants } : {}), updatedAt: new Date() }).where(eq(s.csVisits.id, v.id));
      if (v.activityId) {
        if (body.status === 'realizada') await app.db.update(s.activities).set({ completedAt: at, completedBy: auth.userId, csResult: body.summary, updatedAt: new Date() }).where(eq(s.activities.id, v.activityId));
        else await app.db.update(s.activities).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(s.activities.id, v.activityId), isNull(s.activities.csCadenceKey)));
      }
      for (const n of body.nextSteps) await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type: 'tarefa', title: n.title, dueAt: new Date(`${n.dueAt}T12:00:00Z`), priority: 'media', ownerId: v.csmId, contactId: v.contactId, createdBy: auth.userId });
      let opportunityId: string | null = null;
      if (body.status === 'realizada' && body.createOpportunity && body.opportunities) {
        const { createOpportunity } = await import('../services/opportunities');
        const o = await createOpportunity(app.db, auth, req, { contactId: v.contactId, reasons: [], channel: 'Sucesso do Cliente', title: `Expansão: ${body.opportunities.slice(0, 120)}`, notes: `Identificada em visita de ${at.toISOString().slice(0, 10)}.\n${body.opportunities}` } as never, { trustedContact: true });
        opportunityId = o.id;
      }
      await recomputeAccounts(app.db, auth.tenantId, [v.contactId]);
      await generateCadence(app.db, auth.tenantId, [v.contactId]);
      return { ok: true, opportunityId };
    },
  }),
  defineRoute({
    method: 'POST', url: '/cs/visits/:id/files', summary: 'Anexa arquivo à visita (até 3 MB)', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams, bodyLimit: 4_500_000,
    body: z.object({ name: z.string().trim().min(1).max(200), mime: z.string().max(120), data: z.string().min(4).max(4_400_000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const [v] = await app.db.select().from(s.csVisits).where(and(eq(s.csVisits.id, params.id), eq(s.csVisits.tenantId, auth.tenantId))).limit(1);
      if (!v) throw notFound('Visita não encontrada.');
      requireEdit(await account(app.db, auth, v.contactId));
      const data = Buffer.from(body.data, 'base64');
      if (data.length > 3_300_000) throw unprocessable('Arquivo maior que 3 MB.');
      const [f] = await app.db.insert(s.csFiles).values({ tenantId: auth.tenantId, contactId: v.contactId, visitId: v.id, name: body.name, mime: body.mime, sizeBytes: data.length, data, uploadedBy: auth.userId }).returning({ id: s.csFiles.id, name: s.csFiles.name });
      reply.code(201);
      return f;
    },
  }),
  defineRoute({
    method: 'GET', url: '/cs/visits/:id/files', summary: 'Arquivos da visita', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [v] = await app.db.select().from(s.csVisits).where(and(eq(s.csVisits.id, params.id), eq(s.csVisits.tenantId, auth.tenantId))).limit(1);
      if (!v) throw notFound('Visita não encontrada.');
      await account(app.db, auth, v.contactId);
      return { items: await app.db.select({ id: s.csFiles.id, name: s.csFiles.name, sizeBytes: s.csFiles.sizeBytes, createdAt: s.csFiles.createdAt }).from(s.csFiles).where(eq(s.csFiles.visitId, v.id)) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/cs/files/:id', summary: 'Baixa arquivo de visita', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [f] = await app.db.select().from(s.csFiles).where(and(eq(s.csFiles.id, params.id), eq(s.csFiles.tenantId, auth.tenantId))).limit(1);
      if (!f) throw notFound('Arquivo não encontrado.');
      await account(app.db, auth, f.contactId);
      reply.header('content-type', f.mime).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`).header('x-content-type-options', 'nosniff');
      return reply.send(f.data);
    },
  }),

  // ------------------------------------------------------------------ jornadas e kickoff
  defineRoute({
    method: 'GET', url: '/cs/journeys', summary: 'Jornadas (por conta, contrato ou todas da carteira)', tag: 'Sucesso do Cliente', module: 'clientes',
    query: z.object({ contactId: z.string().uuid().optional(), contractId: z.string().uuid().optional(), status: z.enum(['ativa', 'concluida', 'cancelada']).optional() }),
    handler: async ({ app, auth, query }) => {
      if (query.contactId) await account(app.db, auth, query.contactId);
      const rows = await app.db.select({ j: s.csJourneys, client: s.contacts.name, csm: s.users.name, ownerId: s.contacts.ownerId }).from(s.csJourneys).innerJoin(s.contacts, eq(s.contacts.id, s.csJourneys.contactId)).leftJoin(s.users, eq(s.users.id, s.csJourneys.csmId))
        .where(and(eq(s.csJourneys.tenantId, auth.tenantId), query.contactId ? eq(s.csJourneys.contactId, query.contactId) : undefined, query.contractId ? eq(s.csJourneys.contractId, query.contractId) : undefined, query.status ? eq(s.csJourneys.status, query.status) : undefined)).orderBy(desc(s.csJourneys.createdAt)).limit(300);
      const visible = rows.filter((r) => manager(auth) || query.contactId || query.contractId || r.j.csmId === auth.userId || r.ownerId === auth.userId);
      const ms = visible.length ? await app.db.select({ journeyId: s.csMilestones.journeyId, plannedAt: s.csMilestones.plannedAt, doneAt: s.csMilestones.doneAt, title: s.csMilestones.title, phase: s.csMilestones.phase }).from(s.csMilestones).where(inArray(s.csMilestones.journeyId, visible.map((r) => r.j.id))).orderBy(asc(s.csMilestones.position)) : [];
      const today = todayIso();
      return { items: visible.map(({ j, client, csm }) => { const m = ms.filter((x) => x.journeyId === j.id); const done = m.filter((x) => x.doneAt).length; const next = m.find((x) => !x.doneAt); return { ...j, shareTokenHash: undefined, client, csmName: csm, progress: m.length ? done / m.length : 0, total: m.length, done, late: m.filter((x) => !x.doneAt && x.plannedAt && x.plannedAt < today).length, next: next ? { title: next.title, plannedAt: next.plannedAt, phase: next.phase } : null }; }) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/cs/journeys', summary: 'Inicia a jornada manualmente para um contrato (idempotente)', tag: 'Sucesso do Cliente', module: 'clientes',
    body: z.object({ contractId: z.string().uuid() }),
    handler: async ({ app, auth, body, reply }) => {
      const [c] = await app.db.select().from(s.contracts).where(and(eq(s.contracts.id, body.contractId), eq(s.contracts.tenantId, auth.tenantId))).limit(1);
      if (!c) throw notFound('Contrato não encontrado.');
      requireEdit(await account(app.db, auth, c.contactId));
      const r = await startJourney(app.db, app.config, auth.tenantId, auth.userId, { contactId: c.contactId, contractId: c.id, opportunityId: c.opportunityId });
      await recomputeAccounts(app.db, auth.tenantId, [c.contactId]);
      reply.code(r.created ? 201 : 200);
      return r;
    },
  }),
  defineRoute({
    method: 'GET', url: '/cs/journeys/:id', summary: 'Jornada com marcos, apresentação vigente e versões', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [j] = await app.db.select().from(s.csJourneys).where(and(eq(s.csJourneys.id, params.id), eq(s.csJourneys.tenantId, auth.tenantId))).limit(1);
      if (!j) throw notFound('Jornada não encontrada.');
      const x = await account(app.db, auth, j.contactId);
      const ms = await app.db.select({ m: s.csMilestones, owner: s.users.name, act: s.activities.completedAt }).from(s.csMilestones).leftJoin(s.users, eq(s.users.id, s.csMilestones.ownerId)).leftJoin(s.activities, eq(s.activities.id, s.csMilestones.activityId)).where(eq(s.csMilestones.journeyId, j.id)).orderBy(asc(s.csMilestones.position));
      const versions = await app.db.select({ id: s.csPresentations.id, version: s.csPresentations.version, note: s.csPresentations.note, createdAt: s.csPresentations.createdAt, by: s.users.name }).from(s.csPresentations).leftJoin(s.users, eq(s.users.id, s.csPresentations.createdBy)).where(eq(s.csPresentations.journeyId, j.id)).orderBy(desc(s.csPresentations.version));
      const [cur] = await app.db.select().from(s.csPresentations).where(eq(s.csPresentations.journeyId, j.id)).orderBy(desc(s.csPresentations.version)).limit(1);
      const [contract] = j.contractId ? await app.db.select({ id: s.contracts.id, number: s.contractVersions.number, endAt: s.contractVersions.endAt }).from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(eq(s.contracts.id, j.contractId)).limit(1) : [];
      const [csm] = j.csmId ? await app.db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, j.csmId)).limit(1) : [];
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).orderBy(asc(s.users.name));
      return { journey: { ...j, shareTokenHash: undefined, shared: !!j.shareTokenHash && !!j.shareExpiresAt && j.shareExpiresAt > new Date() }, client: x.contact, contract: contract ?? null, csmName: csm?.name ?? null, canEdit: x.canEdit, milestones: ms.map(({ m, owner }) => ({ ...m, ownerName: owner })), presentation: cur ?? null, versions, users };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/cs/milestones/:id', summary: 'Conclui, reabre ou reprograma um marco da jornada', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ done: z.boolean().optional(), plannedAt: z.string().date().nullable().optional(), ownerId: z.string().uuid().nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => {
      const [m] = await app.db.select({ m: s.csMilestones, contactId: s.csJourneys.contactId }).from(s.csMilestones).innerJoin(s.csJourneys, eq(s.csJourneys.id, s.csMilestones.journeyId)).where(and(eq(s.csMilestones.id, params.id), eq(s.csMilestones.tenantId, auth.tenantId))).limit(1);
      if (!m) throw notFound('Marco não encontrado.');
      requireEdit(await account(app.db, auth, m.contactId));
      const doneAt = body.done === undefined ? undefined : body.done ? new Date() : null;
      await logMilestone(app.db, auth.tenantId, m.m.journeyId, m.m.id, milestoneChanges(m.m, { doneAt, plannedAt: body.plannedAt, ownerId: body.ownerId, notes: body.notes }), auth.userId);
      await app.db.update(s.csMilestones).set({ ...(doneAt !== undefined ? { doneAt, doneBy: doneAt ? auth.userId : null } : {}), ...(body.plannedAt !== undefined ? { plannedAt: body.plannedAt } : {}), ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}) }).where(eq(s.csMilestones.id, m.m.id));
      if (body.done && m.m.activityId) await app.db.update(s.activities).set({ completedAt: new Date(), completedBy: auth.userId, csResult: body.notes ?? m.m.notes ?? `Marco concluído: ${m.m.title}`, updatedAt: new Date() }).where(and(eq(s.activities.id, m.m.activityId), isNull(s.activities.completedAt)));
      if (body.plannedAt && m.m.activityId) await app.db.update(s.activities).set({ dueAt: new Date(`${body.plannedAt}T12:00:00Z`), updatedAt: new Date() }).where(and(eq(s.activities.id, m.m.activityId), isNull(s.activities.completedAt)));
      const [left] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.csMilestones).where(and(eq(s.csMilestones.journeyId, m.m.journeyId), isNull(s.csMilestones.doneAt)));
      await app.db.update(s.csJourneys).set({ status: left?.n ? 'ativa' : 'concluida', updatedAt: new Date() }).where(and(eq(s.csJourneys.id, m.m.journeyId), sql`status <> 'cancelada'`));
      await openMilestoneTasks(app.db, auth.tenantId, m.m.journeyId);
      await recomputeAccounts(app.db, auth.tenantId, [m.contactId]);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/cs/journeys/:id/presentation', summary: 'Salva nova versão da apresentação (não altera os dados oficiais do contrato)', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams, bodyLimit: 2_000_000,
    body: z.object({ slides: z.array(z.object({ id: z.string().max(60), key: z.string().max(60), title: z.string().max(200), layout: z.enum(['capa', 'texto', 'duas_colunas', 'tabela', 'encerramento']), body: z.string().max(8000), table: z.array(z.array(z.string().max(500)).max(8)).max(40).optional(), hidden: z.boolean(), pending: z.array(z.string().max(200)).max(40) })).min(1).max(60), note: z.string().trim().max(300).default(''), regenerate: z.boolean().default(false) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const [j] = await app.db.select().from(s.csJourneys).where(and(eq(s.csJourneys.id, params.id), eq(s.csJourneys.tenantId, auth.tenantId))).limit(1);
      if (!j) throw notFound('Jornada não encontrada.');
      requireEdit(await account(app.db, auth, j.contactId));
      if (body.regenerate) { await regenerateKickoff(app.db, auth.tenantId, j.id, auth.userId, body.note || 'Regerada com os dados atuais do CRM'); reply.code(201); return { ok: true }; }
      const [last] = await app.db.select({ v: s.csPresentations.version }).from(s.csPresentations).where(eq(s.csPresentations.journeyId, j.id)).orderBy(desc(s.csPresentations.version)).limit(1);
      await app.db.insert(s.csPresentations).values({ tenantId: auth.tenantId, journeyId: j.id, version: (last?.v ?? 0) + 1, slides: body.slides as unknown as Record<string, unknown>[], note: body.note || null, createdBy: auth.userId });
      reply.code(201);
      return { version: (last?.v ?? 0) + 1 };
    },
  }),
  defineRoute({
    method: 'GET', url: '/cs/presentations/:id', summary: 'Versão específica da apresentação', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [p] = await app.db.select({ p: s.csPresentations, contactId: s.csJourneys.contactId }).from(s.csPresentations).innerJoin(s.csJourneys, eq(s.csJourneys.id, s.csPresentations.journeyId)).where(and(eq(s.csPresentations.id, params.id), eq(s.csPresentations.tenantId, auth.tenantId))).limit(1);
      if (!p) throw notFound('Versão não encontrada.');
      await account(app.db, auth, p.contactId);
      return p.p;
    },
  }),
  defineRoute({
    method: 'POST', url: '/cs/journeys/:id/share', summary: 'Gera (ou revoga) link autorizado de 30 dias para o cliente ver a apresentação', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ revoke: z.boolean().default(false) }),
    handler: async ({ app, auth, params, body }) => {
      const [j] = await app.db.select().from(s.csJourneys).where(and(eq(s.csJourneys.id, params.id), eq(s.csJourneys.tenantId, auth.tenantId))).limit(1);
      if (!j) throw notFound('Jornada não encontrada.');
      requireEdit(await account(app.db, auth, j.contactId));
      if (body.revoke) { await app.db.update(s.csJourneys).set({ shareTokenHash: null, shareExpiresAt: null }).where(eq(s.csJourneys.id, j.id)); return { url: null }; }
      const t = newShareToken();
      const exp = new Date(Date.now() + 30 * 86_400_000);
      await app.db.update(s.csJourneys).set({ shareTokenHash: t.hash, shareExpiresAt: exp }).where(eq(s.csJourneys.id, j.id));
      return { url: `/k/${t.token}`, expiresAt: exp.toISOString() };
    },
  }),
  defineRoute({
    method: 'POST', url: '/cs/journeys/:id/kickoff', summary: 'Registra a reunião de kickoff (conclui o marco)', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ at: z.string().datetime({ offset: true }), participants: z.string().trim().min(3).max(1000), notes: z.string().trim().min(10, 'Registre o que foi combinado').max(4000) }),
    handler: async ({ app, auth, params, body }) => {
      const [j] = await app.db.select().from(s.csJourneys).where(and(eq(s.csJourneys.id, params.id), eq(s.csJourneys.tenantId, auth.tenantId))).limit(1);
      if (!j) throw notFound('Jornada não encontrada.');
      requireEdit(await account(app.db, auth, j.contactId));
      const at = new Date(body.at);
      if (at.getTime() > Date.now() + 3600_000) throw unprocessable('O kickoff só é registrado depois de acontecer.');
      const notes = `Participantes: ${body.participants}\n${body.notes}`;
      await app.db.update(s.csJourneys).set({ kickoffAt: at, kickoffNotes: notes, updatedAt: new Date() }).where(eq(s.csJourneys.id, j.id));
      const [m] = await app.db.select().from(s.csMilestones).where(and(eq(s.csMilestones.journeyId, j.id), eq(s.csMilestones.key, 'kickoff'))).limit(1);
      if (m && !m.doneAt) {
        await app.db.update(s.csMilestones).set({ doneAt: at, doneBy: auth.userId, notes }).where(eq(s.csMilestones.id, m.id));
        await logMilestone(app.db, auth.tenantId, j.id, m.id, [{ type: 'concluido', from: null, to: at, via: 'kickoff' }], auth.userId);
        if (m.activityId) await app.db.update(s.activities).set({ completedAt: at, completedBy: auth.userId, csResult: notes, updatedAt: new Date() }).where(and(eq(s.activities.id, m.activityId), isNull(s.activities.completedAt)));
        else await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type: 'reuniao', title: 'Reunião de kickoff', dueAt: at, priority: 'media', ownerId: auth.userId, contactId: j.contactId, contractId: j.contractId, csKind: 'reuniao', csResult: notes, completedAt: at, completedBy: auth.userId, createdBy: auth.userId });
      }
      if (j.opportunityId) await app.db.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: j.opportunityId, type: 'cs_kickoff', actorId: auth.userId, payload: { journeyId: j.id } });
      await recomputeAccounts(app.db, auth.tenantId, [j.contactId]);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/cs/slide-templates', summary: 'Modelos de apresentação salvos', tag: 'Sucesso do Cliente', module: 'clientes',
    handler: async ({ app, auth }) => ({ items: await app.db.select({ id: s.csSlideTemplates.id, name: s.csSlideTemplates.name, slides: s.csSlideTemplates.slides, createdAt: s.csSlideTemplates.createdAt }).from(s.csSlideTemplates).where(eq(s.csSlideTemplates.tenantId, auth.tenantId)).orderBy(asc(s.csSlideTemplates.name)) }),
  }),
  defineRoute({
    method: 'POST', url: '/cs/slide-templates', summary: 'Salva a apresentação como modelo reutilizável (sem os dados do cliente)', tag: 'Sucesso do Cliente', module: 'clientes', bodyLimit: 2_000_000,
    body: z.object({ name: z.string().trim().min(2).max(80), slides: z.array(z.record(z.string(), z.unknown())).min(1).max(60) }),
    handler: async ({ app, auth, body, reply }) => {
      if (!(manager(auth) || auth.sectors.includes('sucesso_cliente'))) throw forbidden('Modelos são do time de Sucesso do Cliente ou da gestão.');
      const [t] = await app.db.insert(s.csSlideTemplates).values({ tenantId: auth.tenantId, name: body.name, slides: body.slides, createdBy: auth.userId }).returning({ id: s.csSlideTemplates.id });
      reply.code(201);
      return t;
    },
  }),

  // ------------------------------------------------------------------ link autorizado (público)
  defineRoute({
    method: 'GET', url: '/public/kickoff/:token', summary: 'Apresentação de kickoff compartilhada por link (somente leitura, expira)', tag: 'Sucesso do Cliente', public: true,
    params: z.object({ token: z.string().min(20).max(100) }),
    handler: async ({ app, params }) => {
      const [j] = await app.db.select({ id: s.csJourneys.id, exp: s.csJourneys.shareExpiresAt, client: s.contacts.name }).from(s.csJourneys).innerJoin(s.contacts, eq(s.contacts.id, s.csJourneys.contactId)).where(eq(s.csJourneys.shareTokenHash, hashToken(params.token))).limit(1);
      if (!j || !j.exp || j.exp < new Date()) throw new AppError(404, 'Link expirado ou inválido', 'Peça um novo link ao seu gerente de sucesso.');
      const [p] = await app.db.select({ slides: s.csPresentations.slides }).from(s.csPresentations).where(eq(s.csPresentations.journeyId, j.id)).orderBy(desc(s.csPresentations.version)).limit(1);
      return { client: j.client, slides: ((p?.slides ?? []) as { hidden?: boolean }[]).filter((x) => !x.hidden).map((x) => ({ ...x, pending: [] })) };
    },
  }),
];
