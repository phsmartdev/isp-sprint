/** Desempenho — Etapa 6: indicadores (versionados), objetivos em cascata, metas com governança e scorecards por função. */
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  CONSOLIDATIONS, DEFAULT_TRAFFIC_BANDS, GOAL_CATEGORIES, GOAL_SCOPES, GOAL_SCOPE_ORDER, INDICATOR_CALCS, INDICATOR_CATEGORIES, INDICATOR_UNITS, OBJECTIVE_LEVELS, PERIOD_TYPES,
  FILTER_FIELDS, NUMERIC_FIELDS, SUGGESTED_INDICATORS, atLeast, attainment, canLinkObjective, consolidate, periodRange, previousRange, trafficLight, validateIndicator, validateScorecard,
  type Consolidation, type IndicatorDef, type ObjectiveLevel, type PeriodType,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { ensureFreshEvents, performanceConfig } from '../services/businessEvents';
import { todayLocal } from '../services/projects';
import { performanceUsers } from './performance';
import { descendants, orgData, resultsScope } from '../services/results';
import {
  allIndicators, computeIndicator, goalProgress, indicatorDef, rollRecurringGoals, scorecardsFor, sourceEvents, teamUsers, type Who,
} from '../services/indicators';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const SourceSchema = z.object({
  event: z.string().max(60), measure: z.enum(['contagem', 'soma_valor', 'media_valor', 'media_campo']), field: z.enum(Object.keys(NUMERIC_FIELDS) as [keyof typeof NUMERIC_FIELDS, ...(keyof typeof NUMERIC_FIELDS)[]]).optional(),
  filters: z.array(z.object({ field: z.enum(Object.keys(FILTER_FIELDS) as [keyof typeof FILTER_FIELDS, ...(keyof typeof FILTER_FIELDS)[]]), op: z.enum(['eq', 'ne']), value: z.union([z.string().max(60), z.boolean()]) })).max(8).optional(),
  credit: z.enum(['direto', 'participacao', 'gestao', 'qualquer']).optional(),
});
const DefSchema = z.object({
  name: z.string().trim().min(3).max(120), description: z.string().max(1000).optional(), category: z.enum(INDICATOR_CATEGORIES), calc: z.enum(INDICATOR_CALCS), unit: z.enum(INDICATOR_UNITS),
  direction: z.enum(['maior', 'menor']), period: z.enum(['semana', 'mes', 'trimestre', 'ano']),
  base: SourceSchema.optional(), numerator: SourceSchema.optional(), denominator: SourceSchema.optional(), vars: z.record(z.string(), SourceSchema).optional(), expr: z.string().max(300).optional(),
  profiles: z.array(z.string().max(40)).max(10).optional(), target: z.number().nullable().optional(), weight: z.number().min(0).max(100).optional(), minSample: z.number().int().min(0).max(10_000).optional(),
});
const checkDef = (d: IndicatorDef) => { const e = validateIndicator(d); if (e.length) throw unprocessable(e[0]!, e.map((m) => ({ path: 'def', message: m }))); };
const slug = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'indicador';

async function ledTeams(db: DbOrTx, userId: string) {
  return (await db.select({ teamId: s.teamMemberships.teamId }).from(s.teamMemberships).where(and(eq(s.teamMemberships.userId, userId), eq(s.teamMemberships.isLead, true)))).map((r) => r.teamId);
}
/** Para quem o usuário pode calcular/ver resultados: a si, à equipe que lidera, a todos (Total). */
async function resolveWho(db: DbOrTx, auth: AuthContext, q: { userId?: string; teamId?: string; empresa?: boolean }): Promise<Who> {
  const scope = performanceUsers(auth);
  if (q.empresa) { if (scope !== 'all') throw forbidden('Só quem tem visão total vê o consolidado da empresa.'); return { users: 'all' }; }
  if (q.teamId) {
    if (scope !== 'all' && !(await ledTeams(db, auth.userId)).includes(q.teamId)) throw forbidden('Você só vê equipes que lidera.');
    return { users: await teamUsers(db, auth.tenantId, q.teamId) };
  }
  const u = q.userId ?? auth.userId;
  if (scope !== 'all' && !scope.includes(u)) throw forbidden('Você só vê os próprios resultados ou os da equipe que lidera.');
  return { users: [u] };
}

const GoalBody = z.object({
  title: z.string().trim().min(3).max(160), scope: z.enum(GOAL_SCOPES), category: z.enum(GOAL_CATEGORIES).default('comercial'),
  indicatorId: z.string().uuid().nullable().optional(), manualUnit: z.string().max(30).nullable().optional(),
  userId: z.string().uuid().nullable().optional(), teamId: z.string().uuid().nullable().optional(), orgUnitId: z.string().uuid().nullable().optional(), ownerId: z.string().uuid().optional(), recurring: z.boolean().default(false),
  periodType: z.enum(PERIOD_TYPES), periodStart: isoDate.optional(), periodEnd: isoDate.optional(), ref: isoDate.optional(), target: z.number(),
  objectiveId: z.string().uuid().nullable().optional(), parentGoalId: z.string().uuid().nullable().optional(), weight: z.number().int().min(1).max(100).default(1),
  consolidation: z.enum(CONSOLIDATIONS).default('indicador'), notes: z.string().max(2000).nullable().optional(),
});

/**
 * Quem pode criar/alterar metas:
 * - empresa: Diretoria (responsável/substituto de diretoria) ou nível Total;
 * - área/unidade: quem responde por ela ou por uma unidade acima (Gestão/Diretoria) ou Total;
 * - equipe: líder do time, quem responde pela unidade do time ou Total;
 * - individual: liderança da pessoa (nível Equipe sobre ela), Gestão da unidade dela ou Total.
 */
async function canManageGoal(db: DbOrTx, auth: AuthContext, g: { scope: string; userId?: string | null; teamId?: string | null; orgUnitId?: string | null }) {
  if (level(auth, 'desempenho') === 'total') return true;
  const sc = await resultsScope(db, auth);
  if (sc.all) return true;
  if (g.scope === 'empresa') return sc.perspectives.includes('diretoria');
  if (g.scope === 'unidade') return !!g.orgUnitId && sc.unitIds.includes(g.orgUnitId);
  if (g.scope === 'equipe') return !!g.teamId && (sc.teamIds.includes(g.teamId) || (level(auth, 'desempenho') === 'equipe' && (await ledTeams(db, auth.userId)).includes(g.teamId)));
  if (!g.userId) return false;
  return (level(auth, 'desempenho') === 'equipe' && auth.teamMemberIds.includes(g.userId)) || (sc.userIds.includes(g.userId) && g.userId !== auth.userId);
}
/** Metas da empresa e de área nascem como proposta; aprova quem está acima (Diretoria para empresa; unidade superior para área). */
async function canApproveGoal(db: DbOrTx, auth: AuthContext, g: { scope: string; orgUnitId?: string | null }) {
  const sc = await resultsScope(db, auth);
  const org = await orgData(db, auth.tenantId);
  if (g.scope === 'empresa') return sc.perspectives.includes('diretoria') && sc.roles.some((r) => r.perspective === 'diretoria') || (sc.all && !org.units.some((u) => u.kind === 'diretoria' && u.active));
  if (g.scope === 'unidade' && g.orgUnitId) {
    const above = org.units.filter((u) => u.id !== g.orgUnitId && descendants(org.units, [u.id]).includes(g.orgUnitId!));
    return above.some((u) => u.responsibleId === auth.userId || u.substituteId === auth.userId) || (sc.all && !above.some((u) => u.responsibleId));
  }
  return false;
}

function goalVisible(auth: AuthContext, rs?: { all: boolean; unitIds: string[]; teamIds: string[]; userIds: string[] }): SQL {
  const scope = performanceUsers(auth);
  if (scope === 'all' || rs?.all) return sql`true`;
  const users = [...new Set([...scope, ...(rs?.userIds ?? [])])];
  return or(
    eq(s.goals.scope, 'empresa'),
    and(eq(s.goals.scope, 'individual'), users.length ? inArray(s.goals.userId, users) : sql`false`),
    and(eq(s.goals.scope, 'equipe'), or(sql`exists (select 1 from team_memberships tm where tm.team_id = ${s.goals.teamId} and tm.user_id = ${auth.userId})`, rs?.teamIds.length ? inArray(s.goals.teamId, rs.teamIds) : sql`false`)),
    and(eq(s.goals.scope, 'unidade'), rs?.unitIds.length ? inArray(s.goals.orgUnitId, rs.unitIds) : sql`false`),
  )!;
}

export async function goalDto(db: DbOrTx, auth: AuthContext, g: typeof s.goals.$inferSelect, bands = DEFAULT_TRAFFIC_BANDS) {
  const p = await goalProgress(db, auth.timezone, todayLocal(auth), g, bands);
  // período aberto: a cor segue o ritmo (realizado × esperado até hoje) e é marcada como parcial; só o fechamento é oficial
  const pace = !p.closed && p.direction === 'maior' && p.value !== null && p.expected ? p.value / p.expected : p.attainment;
  return { ...g, progress: { ...p, partial: !p.closed, color: trafficLight(p.closed ? p.attainment : pace, bands) } };
}

export const indicatorRoutes = [
  // ------------------------------------------------------------ indicadores
  defineRoute({
    method: 'GET', url: '/performance/indicators', summary: 'Indicadores da empresa (definição vigente) e sugestões ainda não criadas', tag: 'Desempenho', module: 'desempenho',
    handler: async ({ app, auth }) => {
      const items = await allIndicators(app.db, auth.tenantId);
      return { items, suggestions: SUGGESTED_INDICATORS.filter((x) => !items.some((i) => i.key === x.key)), canEdit: atLeast(level(auth, 'configuracoes'), 'total') };
    },
  }),
  defineRoute({
    method: 'POST', url: '/performance/indicators', summary: 'Cria indicador (definição validada; fórmula sem execução de código)', tag: 'Desempenho', module: 'configuracoes', min: 'total',
    body: z.object({ def: DefSchema, key: z.string().max(40).optional(), note: z.string().max(500).optional() }),
    handler: async ({ app, auth, body, reply }) => {
      const def = body.def as IndicatorDef;
      checkDef(def);
      const r = await app.db.transaction(async (tx) => {
        let key = body.key ?? slug(def.name);
        const [dup] = await tx.select({ id: s.indicators.id }).from(s.indicators).where(and(eq(s.indicators.tenantId, auth.tenantId), eq(s.indicators.key, key))).limit(1);
        if (dup) key = `${key}_${Date.now().toString(36).slice(-4)}`;
        const [i] = await tx.insert(s.indicators).values({ tenantId: auth.tenantId, key, createdBy: auth.userId }).returning({ id: s.indicators.id });
        await tx.insert(s.indicatorVersions).values({ tenantId: auth.tenantId, indicatorId: i!.id, version: 1, def, note: body.note ?? 'Criação', createdBy: auth.userId });
        return i!;
      });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/performance/indicators/suggested', summary: 'Cria indicadores a partir das sugestões', tag: 'Desempenho', module: 'configuracoes', min: 'total',
    body: z.object({ keys: z.array(z.string().max(40)).min(1).max(30) }),
    handler: async ({ app, auth, body }) => app.db.transaction(async (tx) => {
      let created = 0;
      for (const k of body.keys) {
        const sug = SUGGESTED_INDICATORS.find((x) => x.key === k);
        if (!sug) continue;
        const [ex] = await tx.select({ id: s.indicators.id }).from(s.indicators).where(and(eq(s.indicators.tenantId, auth.tenantId), eq(s.indicators.key, k))).limit(1);
        if (ex) continue;
        const { key, ...def } = sug;
        const [i] = await tx.insert(s.indicators).values({ tenantId: auth.tenantId, key, createdBy: auth.userId }).returning({ id: s.indicators.id });
        await tx.insert(s.indicatorVersions).values({ tenantId: auth.tenantId, indicatorId: i!.id, version: 1, def, note: 'Criado a partir da sugestão', createdBy: auth.userId });
        created++;
      }
      return { created };
    }),
  }),
  defineRoute({
    method: 'PUT', url: '/performance/indicators/:id', summary: 'Nova versão da definição (resultados já fechados guardam a versão da época)', tag: 'Desempenho', module: 'configuracoes', min: 'total', params: IdParams,
    body: z.object({ def: DefSchema, note: z.string().trim().min(3).max(500) }),
    handler: async ({ app, auth, params, body }) => {
      checkDef(body.def as IndicatorDef);
      return app.db.transaction(async (tx) => {
        const [i] = await tx.select().from(s.indicators).where(and(eq(s.indicators.id, params.id), eq(s.indicators.tenantId, auth.tenantId))).for('update').limit(1);
        if (!i) throw notFound('Indicador não encontrado.');
        const v = i.currentVersion + 1;
        await tx.insert(s.indicatorVersions).values({ tenantId: auth.tenantId, indicatorId: i.id, version: v, def: body.def as IndicatorDef, note: body.note, createdBy: auth.userId });
        await tx.update(s.indicators).set({ currentVersion: v }).where(eq(s.indicators.id, i.id));
        return { version: v };
      });
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/performance/indicators/:id', summary: 'Ativa ou desativa indicador', tag: 'Desempenho', module: 'configuracoes', min: 'total', params: IdParams,
    body: z.object({ active: z.boolean() }),
    handler: async ({ app, auth, params, body }) => {
      const r = await app.db.update(s.indicators).set({ active: body.active }).where(and(eq(s.indicators.id, params.id), eq(s.indicators.tenantId, auth.tenantId))).returning({ id: s.indicators.id });
      if (!r.length) throw notFound('Indicador não encontrado.');
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/performance/indicators/:id/versions', summary: 'Histórico de versões do indicador', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    handler: async ({ app, auth, params }) => ({ items: await app.db.select({ version: s.indicatorVersions.version, def: s.indicatorVersions.def, note: s.indicatorVersions.note, createdAt: s.indicatorVersions.createdAt, by: s.users.name }).from(s.indicatorVersions).leftJoin(s.users, eq(s.users.id, s.indicatorVersions.createdBy)).where(and(eq(s.indicatorVersions.indicatorId, params.id), eq(s.indicatorVersions.tenantId, auth.tenantId))).orderBy(desc(s.indicatorVersions.version)) }),
  }),
  defineRoute({
    method: 'POST', url: '/performance/indicators/preview', summary: 'Calcula uma definição sem salvar (para testar no construtor)', tag: 'Desempenho', module: 'configuracoes', min: 'total',
    body: z.object({ def: DefSchema, userId: z.string().uuid().optional(), teamId: z.string().uuid().optional(), empresa: z.boolean().optional(), ref: isoDate.optional() }),
    handler: async ({ app, auth, body }) => {
      const def = body.def as IndicatorDef;
      checkDef(def);
      await ensureFreshEvents(app.db, auth.tenantId);
      const range = periodRange(def.period, body.ref ?? todayLocal(auth));
      const who = await resolveWho(app.db, auth, body.empresa || (!body.userId && !body.teamId) ? { empresa: true } : body);
      return { range, ...(await computeIndicator(app.db, auth.tenantId, auth.timezone, def, who, range)) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/performance/indicators/:id/value', summary: 'Resultado do indicador (pessoa, equipe ou empresa) no período, com o período anterior, meta e semáforo', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    query: z.object({ userId: z.string().uuid().optional(), teamId: z.string().uuid().optional(), empresa: z.coerce.boolean().optional(), from: isoDate.optional(), to: isoDate.optional(), ref: isoDate.optional() }),
    handler: async ({ app, auth, params, query: q }) => {
      const d = await indicatorDef(app.db, auth.tenantId, params.id);
      if (!d) throw notFound('Indicador não encontrado.');
      await ensureFreshEvents(app.db, auth.tenantId);
      const who = await resolveWho(app.db, auth, q);
      const range = q.from && q.to ? { from: q.from, to: q.to } : periodRange(d.def.period, q.ref ?? todayLocal(auth));
      const prev = previousRange(range, q.from ? undefined : d.def.period);
      const [cur, before, { config }] = await Promise.all([computeIndicator(app.db, auth.tenantId, auth.timezone, d.def, who, range), computeIndicator(app.db, auth.tenantId, auth.timezone, d.def, who, prev), performanceConfig(app.db, auth.tenantId)]);
      const target = d.def.target ?? null;
      const att = cur.status === 'ok' || cur.status === 'incompleto' ? attainment(cur.value, target, d.def.direction) : null;
      return { indicator: { id: d.indicator.id, version: d.version, ...d.def }, range, previous: { range: prev, ...before }, ...cur, target, attainment: att, color: trafficLight(att, config.traffic) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/performance/indicators/:id/events', summary: 'Detalhamento: eventos que compõem o resultado, com o peso de cada um', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    query: z.object({ userId: z.string().uuid().optional(), teamId: z.string().uuid().optional(), empresa: z.coerce.boolean().optional(), from: isoDate, to: isoDate }),
    handler: async ({ app, auth, params, query: q }) => {
      const d = await indicatorDef(app.db, auth.tenantId, params.id);
      if (!d) throw notFound('Indicador não encontrado.');
      const who = await resolveWho(app.db, auth, q);
      const srcs = d.def.calc === 'formula' ? Object.entries(d.def.vars ?? {}) : ['percentual', 'taxa', 'razao'].includes(d.def.calc) ? [['numerador', d.def.numerator!], ['denominador', d.def.denominator!]] as const : [['base', d.def.base!]] as const;
      const parts = [];
      for (const [name, src] of srcs) parts.push({ name, event: src.event, items: await sourceEvents(app.db, auth.tenantId, auth.timezone, src, who, { from: q.from, to: q.to }) });
      return { parts };
    },
  }),

  // ------------------------------------------------------------ objetivos
  defineRoute({
    method: 'GET', url: '/performance/objectives', summary: 'Objetivos (estratégicos, táticos, operacionais) com vínculos e metas', tag: 'Desempenho', module: 'desempenho',
    query: z.object({ active: z.coerce.boolean().optional() }),
    handler: async ({ app, auth, query: q }) => {
      const rows = await app.db.select({ o: s.objectives, ownerName: s.users.name }).from(s.objectives).innerJoin(s.users, eq(s.users.id, s.objectives.ownerId)).where(and(eq(s.objectives.tenantId, auth.tenantId), q.active ? eq(s.objectives.status, 'ativo') : undefined)).orderBy(asc(s.objectives.level), desc(s.objectives.periodEnd));
      const ids = rows.map((r) => r.o.id);
      const gs = ids.length ? await app.db.select().from(s.goals).where(and(eq(s.goals.tenantId, auth.tenantId), inArray(s.goals.objectiveId, ids), eq(s.goals.status, 'ativa'), goalVisible(auth, await resultsScope(app.db, auth)))) : [];
      const { config } = await performanceConfig(app.db, auth.tenantId);
      const goalsOut = await Promise.all(gs.map((g) => goalDto(app.db, auth, g, config.traffic)));
      return {
        items: rows.map(({ o, ownerName }) => {
          const mine = goalsOut.filter((g) => g.objectiveId === o.id);
          const atts = mine.map((g) => g.progress.attainment).filter((a): a is number => a !== null);
          return { ...o, ownerName, goals: mine, progress: atts.length ? Math.min(1, atts.reduce((a, b) => a + Math.min(1, b), 0) / atts.length) : null };
        }),
        canEdit: atLeast(level(auth, 'desempenho'), 'equipe'),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/performance/objectives', summary: 'Cria objetivo (estratégico: Diretoria ou visão total; tático/operacional: liderança pela matriz ou pela estrutura)', tag: 'Desempenho', module: 'desempenho',
    body: z.object({ title: z.string().trim().min(3).max(200), description: z.string().max(4000).nullable().optional(), level: z.enum(OBJECTIVE_LEVELS), parentId: z.string().uuid().nullable().optional(), area: z.string().max(80).nullable().optional(), teamId: z.string().uuid().nullable().optional(), ownerId: z.string().uuid().optional(), sponsorId: z.string().uuid().nullable().optional(), priority: z.enum(['baixa', 'media', 'alta']).default('media'), periodStart: isoDate, periodEnd: isoDate }),
    handler: async ({ app, auth, body, reply }) => {
      const rs = await resultsScope(app.db, auth);
      const total = level(auth, 'desempenho') === 'total' || rs.all;
      if (body.level === 'estrategico' && !total && !rs.perspectives.includes('diretoria')) throw forbidden('Objetivos estratégicos são definidos pela Diretoria.');
      if (!total && !rs.perspectives.length && level(auth, 'desempenho') !== 'equipe') throw forbidden('Só lideranças definem objetivos.');
      if (body.periodEnd < body.periodStart) throw unprocessable('O fim não pode ser antes do início.');
      if (body.parentId) {
        const [p] = await app.db.select().from(s.objectives).where(and(eq(s.objectives.id, body.parentId), eq(s.objectives.tenantId, auth.tenantId))).limit(1);
        if (!p) throw unprocessable('Objetivo superior não encontrado.');
        if (!canLinkObjective(body.level, p.level as ObjectiveLevel)) throw unprocessable('O objetivo superior precisa ser de nível acima (estratégico → tático → operacional).');
      }
      const [o] = await app.db.insert(s.objectives).values({ ...body, description: body.description ?? null, tenantId: auth.tenantId, ownerId: body.ownerId ?? auth.userId, createdBy: auth.userId }).returning({ id: s.objectives.id });
      reply.code(201);
      return o!;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/performance/objectives/:id', summary: 'Edita, encerra ou cancela objetivo', tag: 'Desempenho', module: 'desempenho', min: 'equipe', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), title: z.string().trim().min(3).max(200).optional(), description: z.string().max(4000).nullable().optional(), status: z.enum(['ativo', 'encerrado', 'cancelado']).optional(), priority: z.enum(['baixa', 'media', 'alta']).optional(), ownerId: z.string().uuid().optional(), sponsorId: z.string().uuid().nullable().optional(), periodEnd: isoDate.optional() }),
    handler: async ({ app, auth, params, body }) => {
      const [o] = await app.db.select().from(s.objectives).where(and(eq(s.objectives.id, params.id), eq(s.objectives.tenantId, auth.tenantId))).limit(1);
      if (!o) throw notFound('Objetivo não encontrado.');
      if (o.level === 'estrategico' && level(auth, 'desempenho') !== 'total') throw forbidden();
      if (o.rowVersion !== body.rowVersion) throw conflict(o.rowVersion);
      const { rowVersion, ...rest } = body;
      await app.db.update(s.objectives).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.objectives.rowVersion} + 1` }).where(eq(s.objectives.id, o.id));
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------ metas
  defineRoute({
    method: 'GET', url: '/performance/goals', summary: 'Metas visíveis com realizado, atingimento, ritmo e semáforo', tag: 'Desempenho', module: 'desempenho',
    query: z.object({ scope: z.enum(GOAL_SCOPES).optional(), userId: z.string().uuid().optional(), teamId: z.string().uuid().optional(), orgUnitId: z.string().uuid().optional(), proposals: z.coerce.boolean().optional(), objectiveId: z.string().uuid().optional(), parentGoalId: z.string().uuid().optional(), current: z.coerce.boolean().optional(), includeCancelled: z.coerce.boolean().optional() }),
    handler: async ({ app, auth, query: q }) => {
      await ensureFreshEvents(app.db, auth.tenantId);
      const today = todayLocal(auth);
      const w: SQL[] = [eq(s.goals.tenantId, auth.tenantId), goalVisible(auth, await resultsScope(app.db, auth))];
      if (!q.includeCancelled) w.push(eq(s.goals.status, 'ativa'));
      if (q.scope) w.push(eq(s.goals.scope, q.scope));
      if (q.userId) w.push(eq(s.goals.userId, q.userId));
      if (q.teamId) w.push(eq(s.goals.teamId, q.teamId));
      if (q.orgUnitId) w.push(eq(s.goals.orgUnitId, q.orgUnitId));
      if (q.proposals) w.push(eq(s.goals.approvalStatus, 'proposta'));
      if (q.objectiveId) w.push(eq(s.goals.objectiveId, q.objectiveId));
      if (q.parentGoalId) w.push(eq(s.goals.parentGoalId, q.parentGoalId));
      if (q.current) w.push(sql`${s.goals.periodStart} <= ${today}::date and ${s.goals.periodEnd} >= ${today}::date`);
      await rollRecurringGoals(app.db, auth.tenantId, today);
      const rows = await app.db.select({ g: s.goals, userName: s.users.name }).from(s.goals).leftJoin(s.users, eq(s.users.id, s.goals.userId)).where(and(...w)).orderBy(desc(s.goals.periodEnd), asc(s.goals.title)).limit(300);
      const { config } = await performanceConfig(app.db, auth.tenantId);
      const inds = await allIndicators(app.db, auth.tenantId);
      const teams = await app.db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(eq(s.teams.tenantId, auth.tenantId));
      const units = await app.db.select({ id: s.orgUnits.id, name: s.orgUnits.name }).from(s.orgUnits).where(eq(s.orgUnits.tenantId, auth.tenantId));
      const items = await Promise.all(rows.map(async ({ g, userName }) => ({ ...(await goalDto(app.db, auth, g, config.traffic)), userName, teamName: teams.find((t) => t.id === g.teamId)?.name ?? null, unitName: units.find((u) => u.id === g.orgUnitId)?.name ?? null, indicatorName: inds.find((i) => i.id === g.indicatorId)?.def.name ?? null })));
      return { items, today };
    },
  }),
  defineRoute({
    method: 'GET', url: '/performance/goals/:id', summary: 'Meta com histórico, apontamentos, metas filhas (cascata) e consolidação', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [g] = await app.db.select().from(s.goals).where(and(eq(s.goals.id, params.id), eq(s.goals.tenantId, auth.tenantId), goalVisible(auth, await resultsScope(app.db, auth)))).limit(1);
      if (!g) throw notFound('Meta não encontrada.');
      const { config } = await performanceConfig(app.db, auth.tenantId);
      const [events, checkins, children] = await Promise.all([
        app.db.select({ id: s.goalEvents.id, type: s.goalEvents.type, payload: s.goalEvents.payload, createdAt: s.goalEvents.createdAt, actorName: s.users.name }).from(s.goalEvents).leftJoin(s.users, eq(s.users.id, s.goalEvents.actorId)).where(eq(s.goalEvents.goalId, g.id)).orderBy(desc(s.goalEvents.createdAt)),
        app.db.select({ id: s.goalCheckins.id, value: s.goalCheckins.value, note: s.goalCheckins.note, createdAt: s.goalCheckins.createdAt, actorName: s.users.name }).from(s.goalCheckins).leftJoin(s.users, eq(s.users.id, s.goalCheckins.actorId)).where(eq(s.goalCheckins.goalId, g.id)).orderBy(desc(s.goalCheckins.createdAt)),
        app.db.select().from(s.goals).where(and(eq(s.goals.parentGoalId, g.id), eq(s.goals.status, 'ativa'))),
      ]);
      const kids = await Promise.all(children.map((c) => goalDto(app.db, auth, c, config.traffic)));
      const dto = await goalDto(app.db, auth, g, config.traffic);
      const ind = g.indicatorId ? await indicatorDef(app.db, auth.tenantId, g.indicatorId) : null;
      const [u] = g.userId ? await app.db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, g.userId)).limit(1) : [];
      const [t] = g.teamId ? await app.db.select({ name: s.teams.name }).from(s.teams).where(eq(s.teams.id, g.teamId)).limit(1) : [];
      const consolidated = g.consolidation === 'indicador' ? null : consolidate(g.consolidation as Consolidation, kids.map((k) => ({ value: k.progress.value, weight: k.weight })));
      return { ...dto, indicatorName: ind?.def.name ?? null, userName: u?.name ?? null, teamName: t?.name ?? null, events, checkins, children: kids, consolidated, canManage: await canManageGoal(app.db, auth, g) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/performance/goals', summary: 'Cria meta (individual, equipe, área/unidade ou empresa), opcionalmente desdobrada e ligada a um objetivo. Quem pode: liderança no seu escopo (matriz ou estrutura organizacional).', tag: 'Desempenho', module: 'desempenho',
    body: GoalBody,
    handler: async ({ app, auth, body, reply }) => {
      if (body.scope === 'individual' && !body.userId) throw unprocessable('Escolha a pessoa da meta.', [{ path: 'userId', message: 'Obrigatório' }]);
      if (body.scope === 'equipe' && !body.teamId) throw unprocessable('Escolha a equipe da meta.', [{ path: 'teamId', message: 'Obrigatório' }]);
      if (body.scope === 'unidade' && !body.orgUnitId) throw unprocessable('Escolha a área/unidade da meta.', [{ path: 'orgUnitId', message: 'Obrigatório' }]);
      if (body.recurring && body.periodType !== 'mes') throw unprocessable('Só metas mensais podem se repetir.');
      if (!body.indicatorId && !body.manualUnit) throw unprocessable('Escolha um indicador ou informe a unidade da meta manual.');
      if (!(await canManageGoal(app.db, auth, body))) throw forbidden('Você só define metas no seu escopo: equipe que lidera, unidade pela qual responde ou, para a empresa, a Diretoria.');
      let range: { from: string; to: string };
      if (body.periodType === 'personalizado') { if (!body.periodStart || !body.periodEnd || body.periodEnd < body.periodStart) throw unprocessable('Informe início e fim do período.'); range = { from: body.periodStart, to: body.periodEnd }; }
      else range = periodRange(body.periodType as Exclude<PeriodType, 'personalizado'>, body.ref ?? body.periodStart ?? todayLocal(auth));
      return app.db.transaction(async (tx) => {
        if (body.indicatorId && !(await indicatorDef(tx, auth.tenantId, body.indicatorId))) throw unprocessable('Indicador não encontrado.');
        if (body.parentGoalId) {
          const [p] = await tx.select().from(s.goals).where(and(eq(s.goals.id, body.parentGoalId), eq(s.goals.tenantId, auth.tenantId))).limit(1);
          if (!p) throw unprocessable('Meta superior não encontrada.');
          if (range.from < p.periodStart || range.to > p.periodEnd) throw unprocessable('O período da meta desdobrada precisa caber no da meta superior.');
          if (GOAL_SCOPE_ORDER.indexOf(body.scope) < GOAL_SCOPE_ORDER.indexOf(p.scope as (typeof GOAL_SCOPE_ORDER)[number])) throw unprocessable('A meta desdobrada não pode ser de nível acima da superior.');
        }
        const needsApproval = (body.scope === 'empresa' || body.scope === 'unidade') && !(await canApproveGoal(tx, auth, body));
        const [g] = await tx.insert(s.goals).values({
          tenantId: auth.tenantId, title: body.title, scope: body.scope, category: body.category, indicatorId: body.indicatorId ?? null, manualUnit: body.indicatorId ? null : body.manualUnit ?? null,
          userId: body.scope === 'individual' ? body.userId! : null, teamId: body.scope === 'equipe' ? body.teamId! : null, orgUnitId: body.scope === 'unidade' ? body.orgUnitId! : null, ownerId: body.ownerId ?? body.userId ?? auth.userId,
          recurring: body.recurring, approvalStatus: needsApproval ? 'proposta' : 'aprovada', approvedBy: needsApproval ? null : auth.userId, approvedAt: needsApproval ? null : new Date(),
          periodType: body.periodType, periodStart: range.from, periodEnd: range.to, target: body.target, originalTarget: body.target, objectiveId: body.objectiveId ?? null, parentGoalId: body.parentGoalId ?? null,
          weight: body.weight, consolidation: body.consolidation, notes: body.notes ?? null, createdBy: auth.userId,
        }).returning({ id: s.goals.id });
        await tx.update(s.goals).set({ seriesId: g!.id }).where(eq(s.goals.id, g!.id));
        await tx.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g!.id, type: needsApproval ? 'proposta' : 'criada', payload: { target: body.target, range }, actorId: auth.userId });
        reply.code(201);
        return g!;
      });
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/performance/goals/:id', summary: 'Altera meta. Depois do início, mudar o alvo exige motivo e autorização de quem lidera (nunca da própria pessoa) e gera nova versão; o alvo original fica guardado.', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), title: z.string().trim().min(3).max(160).optional(), target: z.number().optional(), notes: z.string().max(2000).nullable().optional(), weight: z.number().int().min(1).max(100).optional(), cancel: z.boolean().optional(), reason: z.string().trim().max(1000).optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [g] = await tx.select().from(s.goals).where(and(eq(s.goals.id, params.id), eq(s.goals.tenantId, auth.tenantId))).for('update').limit(1);
      if (!g) throw notFound('Meta não encontrada.');
      if (g.rowVersion !== body.rowVersion) throw conflict(g.rowVersion);
      if (!(await canManageGoal(tx, auth, g))) throw forbidden('Só a liderança responsável altera esta meta.');
      const started = todayLocal(auth) >= g.periodStart;
      const [closed] = await tx.select({ x: s.goalResults.goalId }).from(s.goalResults).where(eq(s.goalResults.goalId, g.id)).limit(1);
      if (closed) throw unprocessable('Período encerrado: o resultado da meta já foi fechado e não muda.');
      const targetChange = body.target !== undefined && body.target !== g.target;
      if ((targetChange || body.cancel) && started) {
        if (!body.reason || body.reason.length < 10) throw unprocessable('Explique o motivo (mínimo 10 caracteres): a meta já está em andamento.', [{ path: 'reason', message: 'Obrigatório após o início' }]);
        if (g.userId === auth.userId && level(auth, 'desempenho') !== 'total') throw forbidden('Ninguém altera a própria meta depois do início; peça à liderança.');
      }
      await tx.update(s.goals).set({
        title: body.title, notes: body.notes, weight: body.weight, target: body.target, status: body.cancel ? 'cancelada' : undefined,
        version: targetChange ? sql`${s.goals.version} + 1` : undefined, updatedAt: new Date(), rowVersion: sql`${s.goals.rowVersion} + 1`,
      }).where(eq(s.goals.id, g.id));
      if (targetChange) await tx.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g.id, type: 'revisao', payload: { from: g.target, to: body.target, original: g.originalTarget, reason: body.reason ?? null, authorizedBy: auth.userId, version: g.version + 1, started }, actorId: auth.userId });
      if (body.cancel) await tx.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g.id, type: 'cancelada', payload: { reason: body.reason ?? null }, actorId: auth.userId });
      if (!targetChange && !body.cancel && (body.title || body.notes !== undefined || body.weight)) await tx.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g.id, type: 'alterada', payload: { title: body.title ?? null, weight: body.weight ?? null }, actorId: auth.userId });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/performance/goals/:id/approve', summary: 'Aprova ou recusa meta proposta da empresa ou de área (Diretoria / unidade superior)', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).default('') }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [g] = await tx.select().from(s.goals).where(and(eq(s.goals.id, params.id), eq(s.goals.tenantId, auth.tenantId))).for('update').limit(1);
      if (!g) throw notFound('Meta não encontrada.');
      if (g.approvalStatus !== 'proposta') throw unprocessable('A meta não está aguardando aprovação.');
      if (!(await canApproveGoal(tx, auth, g))) throw forbidden('Só a instância superior aprova esta meta.');
      if (g.createdBy === auth.userId) throw forbidden('Quem propôs a meta não a aprova.');
      if (!body.approve && body.note.length < 5) throw unprocessable('Explique a recusa (mínimo 5 caracteres).');
      await tx.update(s.goals).set({ approvalStatus: body.approve ? 'aprovada' : 'rejeitada', approvedBy: auth.userId, approvedAt: new Date(), status: body.approve ? 'ativa' : 'cancelada', updatedAt: new Date(), rowVersion: sql`${s.goals.rowVersion} + 1` }).where(eq(s.goals.id, g.id));
      await tx.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g.id, type: body.approve ? 'aprovada' : 'recusada', payload: { note: body.note || null }, actorId: auth.userId });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/performance/goals/:id/revision-requests', summary: 'Pede revisão do alvo (para quem não tem alçada): justificativa obrigatória, o superior decide', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    body: z.object({ toTarget: z.number(), reason: z.string().trim().min(10).max(1000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const [g] = await app.db.select().from(s.goals).where(and(eq(s.goals.id, params.id), eq(s.goals.tenantId, auth.tenantId), goalVisible(auth, await resultsScope(app.db, auth)))).limit(1);
      if (!g) throw notFound('Meta não encontrada.');
      if (g.status !== 'ativa') throw unprocessable('Meta encerrada ou cancelada.');
      const [open] = await app.db.select({ id: s.goalRevisionRequests.id }).from(s.goalRevisionRequests).where(and(eq(s.goalRevisionRequests.goalId, g.id), eq(s.goalRevisionRequests.status, 'pendente'))).limit(1);
      if (open) throw unprocessable('Já existe um pedido de revisão pendente para esta meta.');
      const [r] = await app.db.insert(s.goalRevisionRequests).values({ tenantId: auth.tenantId, goalId: g.id, requestedBy: auth.userId, fromTarget: g.target, toTarget: body.toTarget, reason: body.reason }).returning({ id: s.goalRevisionRequests.id });
      await app.db.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g.id, type: 'revisao_pedida', payload: { from: g.target, to: body.toTarget, reason: body.reason }, actorId: auth.userId });
      reply.code(201);
      return r!;
    },
  }),
  defineRoute({
    method: 'GET', url: '/performance/goal-revisions', summary: 'Pedidos de revisão pendentes que eu posso decidir', tag: 'Desempenho', module: 'desempenho',
    handler: async ({ app, auth }) => {
      const rows = await app.db.select({ r: s.goalRevisionRequests, g: s.goals, by: s.users.name }).from(s.goalRevisionRequests).innerJoin(s.goals, eq(s.goals.id, s.goalRevisionRequests.goalId)).innerJoin(s.users, eq(s.users.id, s.goalRevisionRequests.requestedBy)).where(and(eq(s.goalRevisionRequests.tenantId, auth.tenantId), eq(s.goalRevisionRequests.status, 'pendente')));
      const out = [];
      for (const x of rows) if (x.r.requestedBy !== auth.userId && x.g.userId !== auth.userId && (await canManageGoal(app.db, auth, x.g))) out.push({ ...x.r, goalTitle: x.g.title, requestedByName: x.by });
      return { items: out };
    },
  }),
  defineRoute({
    method: 'POST', url: '/performance/goal-revisions/:id/decide', summary: 'Decide o pedido de revisão: aprovado vira nova versão da meta (o original fica guardado)', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).default('') }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [r] = await tx.select().from(s.goalRevisionRequests).where(and(eq(s.goalRevisionRequests.id, params.id), eq(s.goalRevisionRequests.tenantId, auth.tenantId))).for('update').limit(1);
      if (!r || r.status !== 'pendente') throw notFound('Pedido não encontrado ou já decidido.');
      const [g] = await tx.select().from(s.goals).where(eq(s.goals.id, r.goalId)).for('update').limit(1);
      if (!g) throw notFound('Meta não encontrada.');
      if (r.requestedBy === auth.userId || g.userId === auth.userId || !(await canManageGoal(tx, auth, g))) throw forbidden('Só a liderança acima de quem pediu decide a revisão.');
      if (!body.approve && body.note.length < 5) throw unprocessable('Explique a recusa (mínimo 5 caracteres).');
      const [closed] = await tx.select({ x: s.goalResults.goalId }).from(s.goalResults).where(eq(s.goalResults.goalId, g.id)).limit(1);
      if (closed && body.approve) throw unprocessable('Período encerrado: a meta já foi apurada e não muda.');
      await tx.update(s.goalRevisionRequests).set({ status: body.approve ? 'aprovada' : 'recusada', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note || null }).where(eq(s.goalRevisionRequests.id, r.id));
      if (body.approve) {
        await tx.update(s.goals).set({ target: r.toTarget, version: sql`${s.goals.version} + 1`, updatedAt: new Date(), rowVersion: sql`${s.goals.rowVersion} + 1` }).where(eq(s.goals.id, g.id));
        await tx.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g.id, type: 'revisao', payload: { from: r.fromTarget, to: r.toTarget, original: g.originalTarget, reason: r.reason, requestedBy: r.requestedBy, authorizedBy: auth.userId, version: g.version + 1, started: true }, actorId: auth.userId });
      } else await tx.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g.id, type: 'revisao_recusada', payload: { to: r.toTarget, note: body.note }, actorId: auth.userId });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/performance/goals/:id/checkins', summary: 'Apontamento de meta manual (sem indicador automático)', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    body: z.object({ value: z.number(), note: z.string().trim().min(3).max(1000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const [g] = await app.db.select().from(s.goals).where(and(eq(s.goals.id, params.id), eq(s.goals.tenantId, auth.tenantId), goalVisible(auth, await resultsScope(app.db, auth)))).limit(1);
      if (!g) throw notFound('Meta não encontrada.');
      if (g.indicatorId) throw unprocessable('Esta meta é calculada pelo indicador; não aceita apontamento manual.');
      if (g.ownerId !== auth.userId && !(await canManageGoal(app.db, auth, g))) throw forbidden('Só o responsável ou a liderança apontam o resultado.');
      const [c] = await app.db.insert(s.goalCheckins).values({ tenantId: auth.tenantId, goalId: g.id, value: body.value, note: body.note, actorId: auth.userId }).returning({ id: s.goalCheckins.id });
      reply.code(201);
      return c!;
    },
  }),

  // ------------------------------------------------------------ scorecards
  defineRoute({
    method: 'GET', url: '/performance/scorecards', summary: 'Scorecards por função (definição vigente e a quem se aplicam)', tag: 'Desempenho', module: 'desempenho',
    handler: async ({ app, auth }) => {
      const rows = await app.db.select({ c: s.scorecards, v: s.scorecardVersions }).from(s.scorecards).innerJoin(s.scorecardVersions, and(eq(s.scorecardVersions.scorecardId, s.scorecards.id), eq(s.scorecardVersions.version, s.scorecards.currentVersion))).where(eq(s.scorecards.tenantId, auth.tenantId)).orderBy(asc(s.scorecards.name));
      const assigns = await app.db.select({ userId: s.scorecardAssignments.userId, scorecardId: s.scorecardAssignments.scorecardId, weight: s.scorecardAssignments.weight, name: s.users.name }).from(s.scorecardAssignments).innerJoin(s.users, eq(s.users.id, s.scorecardAssignments.userId)).where(eq(s.scorecardAssignments.tenantId, auth.tenantId));
      return { items: rows.map(({ c, v }) => ({ ...c, def: v.def, assignments: assigns.filter((a) => a.scorecardId === c.id) })), canEdit: atLeast(level(auth, 'configuracoes'), 'total') };
    },
  }),
  defineRoute({
    method: 'POST', url: '/performance/scorecards', summary: 'Cria scorecard por função', tag: 'Desempenho', module: 'configuracoes', min: 'total',
    body: z.object({ name: z.string().trim().min(3).max(120), description: z.string().max(1000).nullable().optional(), appliesProfiles: z.array(z.string().max(40)).max(10).default([]), appliesJobTitles: z.array(z.string().max(80)).max(20).default([]), appliesTeamIds: z.array(z.string().uuid()).max(20).default([]), periodicity: z.enum(['semana', 'mes', 'trimestre', 'ano']).default('mes'), def: z.object({ items: z.array(z.object({ indicatorId: z.string().uuid(), weight: z.number(), target: z.number().nullable().optional() })).max(15), cap: z.number().default(1.2) }) }),
    handler: async ({ app, auth, body, reply }) => {
      const e = validateScorecard(body.def);
      if (e.length) throw unprocessable(e[0]!, e.map((m) => ({ path: 'def', message: m })));
      const inds = await allIndicators(app.db, auth.tenantId);
      if (body.def.items.some((i) => !inds.some((x) => x.id === i.indicatorId))) throw unprocessable('Indicador inexistente no scorecard.');
      return app.db.transaction(async (tx) => {
        const { def, ...rest } = body;
        const [c] = await tx.insert(s.scorecards).values({ ...rest, description: rest.description ?? null, tenantId: auth.tenantId, createdBy: auth.userId }).returning({ id: s.scorecards.id });
        await tx.insert(s.scorecardVersions).values({ tenantId: auth.tenantId, scorecardId: c!.id, version: 1, def, note: 'Criação', createdBy: auth.userId });
        reply.code(201);
        return c!;
      });
    },
  }),
  defineRoute({
    method: 'PUT', url: '/performance/scorecards/:id', summary: 'Nova versão do scorecard (indicadores, pesos, metas, teto) e a quem se aplica', tag: 'Desempenho', module: 'configuracoes', min: 'total', params: IdParams,
    body: z.object({ name: z.string().trim().min(3).max(120).optional(), description: z.string().max(1000).nullable().optional(), appliesProfiles: z.array(z.string().max(40)).max(10).optional(), appliesJobTitles: z.array(z.string().max(80)).max(20).optional(), appliesTeamIds: z.array(z.string().uuid()).max(20).optional(), periodicity: z.enum(['semana', 'mes', 'trimestre', 'ano']).optional(), active: z.boolean().optional(), def: z.object({ items: z.array(z.object({ indicatorId: z.string().uuid(), weight: z.number(), target: z.number().nullable().optional() })).max(15), cap: z.number().default(1.2) }).optional(), note: z.string().trim().min(3).max(500) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [c] = await tx.select().from(s.scorecards).where(and(eq(s.scorecards.id, params.id), eq(s.scorecards.tenantId, auth.tenantId))).for('update').limit(1);
      if (!c) throw notFound('Scorecard não encontrado.');
      const { def, note, ...rest } = body;
      let version = c.currentVersion;
      if (def) {
        const e = validateScorecard(def);
        if (e.length) throw unprocessable(e[0]!, e.map((m) => ({ path: 'def', message: m })));
        version++;
        await tx.insert(s.scorecardVersions).values({ tenantId: auth.tenantId, scorecardId: c.id, version, def, note, createdBy: auth.userId });
      }
      await tx.update(s.scorecards).set({ ...rest, currentVersion: version }).where(eq(s.scorecards.id, c.id));
      return { version };
    }),
  }),
  defineRoute({
    method: 'PUT', url: '/performance/scorecards/assignments/:id', summary: 'Composição explícita de uma pessoa com mais de uma função (scorecards e pesos)', tag: 'Desempenho', module: 'configuracoes', min: 'total', params: IdParams,
    body: z.object({ items: z.array(z.object({ scorecardId: z.string().uuid(), weight: z.number().int().min(1).max(100) })).max(5) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [u] = await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, params.id), eq(s.users.tenantId, auth.tenantId))).limit(1);
      if (!u) throw notFound('Usuário não encontrado.');
      await tx.delete(s.scorecardAssignments).where(and(eq(s.scorecardAssignments.userId, u.id), eq(s.scorecardAssignments.tenantId, auth.tenantId)));
      if (body.items.length) await tx.insert(s.scorecardAssignments).values(body.items.map((i) => ({ userId: u.id, scorecardId: i.scorecardId, tenantId: auth.tenantId, weight: i.weight, createdBy: auth.userId })));
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'GET', url: '/performance/scorecards/for/:id', summary: 'Notas da pessoa em cada scorecard aplicável e a nota composta', tag: 'Desempenho', module: 'desempenho', params: IdParams,
    query: z.object({ ref: isoDate.optional() }),
    handler: async ({ app, auth, params, query: q }) => {
      await resolveWho(app.db, auth, { userId: params.id });
      await ensureFreshEvents(app.db, auth.tenantId);
      return scorecardsFor(app.db, auth.tenantId, auth.timezone, params.id, q.ref ?? todayLocal(auth));
    },
  }),
];

