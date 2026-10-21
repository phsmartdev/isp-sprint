/** GESTÃO DE RESULTADOS — Fase 2: estrutura organizacional, escopo e perspectivas (Diretoria, Gestão, Liderança). */
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { atLeast, attainment, competenciaOf, trafficLight, trendOf, variation, type GoalStatus } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { ensureFreshEvents, performanceConfig } from '../services/businessEvents';
import { todayLocal } from '../services/projects';
import { allIndicators, computeIndicator, goalWho, indicatorDef } from '../services/indicators';
import { PERSPECTIVE_LABELS, createsUnitCycle, orgData, resultsScope, unitPeople, type Perspective } from '../services/results';
import { goalDto } from './indicators';
import { syncInterventions } from '../services/interventions';

const canConfigure = (auth: AuthContext) => atLeast(level(auth, 'configuracoes'), 'total') || level(auth, 'resultados') === 'total';
const orgEvent = (db: DbOrTx, auth: AuthContext, v: { unitId?: string | null; teamId?: string | null; type: string; payload: Record<string, unknown> }) =>
  db.insert(s.orgEvents).values({ tenantId: auth.tenantId, unitId: v.unitId ?? null, teamId: v.teamId ?? null, type: v.type, payload: v.payload, actorId: auth.userId });

async function assertUser(db: DbOrTx, auth: AuthContext, id: string | null | undefined, path: string) {
  if (!id) return;
  const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, id), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).limit(1);
  if (!u) throw unprocessable('Pessoa inválida.', [{ path, message: 'Usuário inativo ou de outra empresa' }]);
}

const UnitBody = z.object({
  name: z.string().trim().min(2).max(120), kind: z.enum(['diretoria', 'area', 'unidade']), parentId: z.string().uuid().nullable().optional(),
  responsibleId: z.string().uuid().nullable().optional(), substituteId: z.string().uuid().nullable().optional(), approvalLimitCents: z.number().int().min(0).nullable().optional(),
});

export const resultsRoutes = [
  defineRoute({
    method: 'GET', url: '/results/scope', summary: 'Perspectivas disponíveis (Diretoria, Gestão, Liderança), onde a pessoa responde e o alcance dos dados', tag: 'Gestão de Resultados', module: 'resultados',
    handler: async ({ app, auth }) => {
      const sc = await resultsScope(app.db, auth);
      const org = await orgData(app.db, auth.tenantId);
      return {
        perspectives: sc.perspectives.map((p) => ({ key: p, label: PERSPECTIVE_LABELS[p] })), all: sc.all, roles: sc.roles,
        units: org.units.filter((u) => u.active && sc.unitIds.includes(u.id)).map((u) => ({ id: u.id, name: u.name, kind: u.kind, parentId: u.parentId })),
        teams: org.teams.filter((t) => sc.teamIds.includes(t.id)).map((t) => ({ id: t.id, name: t.name, orgUnitId: t.orgUnitId })),
        people: sc.userIds.length, canConfigure: canConfigure(auth),
      };
    },
  }),

  defineRoute({
    method: 'GET', url: '/results/org', summary: 'Estrutura organizacional completa (unidades, times, responsáveis, substitutos, alçadas) e histórico', tag: 'Gestão de Resultados', module: 'resultados',
    handler: async ({ app, auth }) => {
      if (!canConfigure(auth)) throw forbidden('Só quem administra pode ver a estrutura completa.');
      const org = await orgData(app.db, auth.tenantId);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? null : null);
      const events = await app.db.select({ id: s.orgEvents.id, type: s.orgEvents.type, payload: s.orgEvents.payload, createdAt: s.orgEvents.createdAt, actorName: s.users.name }).from(s.orgEvents).leftJoin(s.users, eq(s.users.id, s.orgEvents.actorId)).where(eq(s.orgEvents.tenantId, auth.tenantId)).orderBy(desc(s.orgEvents.createdAt)).limit(50);
      return {
        units: org.units.map((u) => ({ ...u, responsibleName: name(u.responsibleId), substituteName: name(u.substituteId) })),
        teams: org.teams.map((t) => ({ id: t.id, name: t.name, orgUnitId: t.orgUnitId, substituteLeadId: t.substituteLeadId, substituteLeadName: name(t.substituteLeadId), leads: org.members.filter((m) => m.teamId === t.id && m.isLead).map((m) => name(m.userId)), members: org.members.filter((m) => m.teamId === t.id).length })),
        events,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/results/org/units', summary: 'Cria unidade (diretoria, área ou unidade)', tag: 'Gestão de Resultados', module: 'resultados', body: UnitBody,
    handler: async ({ app, auth, body, reply }) => {
      if (!canConfigure(auth)) throw forbidden();
      return app.db.transaction(async (tx) => {
        if (body.parentId) { const [p] = await tx.select({ id: s.orgUnits.id }).from(s.orgUnits).where(and(eq(s.orgUnits.id, body.parentId), eq(s.orgUnits.tenantId, auth.tenantId))).limit(1); if (!p) throw unprocessable('Unidade superior não encontrada.'); }
        await assertUser(tx, auth, body.responsibleId, 'responsibleId');
        await assertUser(tx, auth, body.substituteId, 'substituteId');
        if (body.responsibleId && body.responsibleId === body.substituteId) throw unprocessable('O substituto precisa ser outra pessoa.');
        const [u] = await tx.insert(s.orgUnits).values({ tenantId: auth.tenantId, name: body.name, kind: body.kind, parentId: body.parentId ?? null, responsibleId: body.responsibleId ?? null, substituteId: body.substituteId ?? null, approvalLimitCents: body.approvalLimitCents ?? null, createdBy: auth.userId }).returning({ id: s.orgUnits.id });
        await orgEvent(tx, auth, { unitId: u!.id, type: 'unidade_criada', payload: body });
        reply.code(201);
        return u!;
      });
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/results/org/units/:id', summary: 'Altera unidade (sem ciclos na hierarquia; mudança de responsável fica no histórico)', tag: 'Gestão de Resultados', module: 'resultados', params: IdParams,
    body: UnitBody.partial().extend({ rowVersion: z.number().int(), active: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => {
      if (!canConfigure(auth)) throw forbidden();
      return app.db.transaction(async (tx) => {
        const units = await tx.select().from(s.orgUnits).where(eq(s.orgUnits.tenantId, auth.tenantId));
        const u = units.find((x) => x.id === params.id);
        if (!u) throw notFound('Unidade não encontrada.');
        if (u.rowVersion !== body.rowVersion) throw conflict(u.rowVersion);
        if (body.parentId !== undefined && createsUnitCycle(units, u.id, body.parentId)) throw unprocessable('A unidade superior não pode estar abaixo desta.');
        await assertUser(tx, auth, body.responsibleId, 'responsibleId');
        await assertUser(tx, auth, body.substituteId, 'substituteId');
        const resp = body.responsibleId === undefined ? u.responsibleId : body.responsibleId;
        const sub = body.substituteId === undefined ? u.substituteId : body.substituteId;
        if (resp && resp === sub) throw unprocessable('O substituto precisa ser outra pessoa.');
        if (body.active === false && (units.some((x) => x.parentId === u.id && x.active))) throw unprocessable('Desative ou mova as unidades abaixo antes.');
        const { rowVersion, ...rest } = body;
        await tx.update(s.orgUnits).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.orgUnits.rowVersion} + 1` }).where(eq(s.orgUnits.id, u.id));
        await orgEvent(tx, auth, { unitId: u.id, type: 'unidade_alterada', payload: { before: { name: u.name, parentId: u.parentId, responsibleId: u.responsibleId, substituteId: u.substituteId, approvalLimitCents: u.approvalLimitCents, active: u.active }, after: rest } });
        return { ok: true };
      });
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/results/org/teams/:id', summary: 'Vincula o time a uma unidade e define o líder substituto', tag: 'Gestão de Resultados', module: 'resultados', params: IdParams,
    body: z.object({ orgUnitId: z.string().uuid().nullable().optional(), substituteLeadId: z.string().uuid().nullable().optional() }),
    handler: async ({ app, auth, params, body }) => {
      if (!canConfigure(auth)) throw forbidden();
      return app.db.transaction(async (tx) => {
        const [t] = await tx.select().from(s.teams).where(and(eq(s.teams.id, params.id), eq(s.teams.tenantId, auth.tenantId))).limit(1);
        if (!t) throw notFound('Time não encontrado.');
        if (body.orgUnitId) { const [u] = await tx.select({ id: s.orgUnits.id }).from(s.orgUnits).where(and(eq(s.orgUnits.id, body.orgUnitId), eq(s.orgUnits.tenantId, auth.tenantId))).limit(1); if (!u) throw unprocessable('Unidade não encontrada.'); }
        await assertUser(tx, auth, body.substituteLeadId, 'substituteLeadId');
        await tx.update(s.teams).set({ orgUnitId: body.orgUnitId, substituteLeadId: body.substituteLeadId }).where(eq(s.teams.id, t.id));
        await orgEvent(tx, auth, { teamId: t.id, type: 'time_alterado', payload: { before: { orgUnitId: t.orgUnitId, substituteLeadId: t.substituteLeadId }, after: body } });
        return { ok: true };
      });
    },
  }),

  defineRoute({
    method: 'GET', url: '/results/overview', summary: 'Visão da perspectiva: metas do escopo no período atual com semáforo e objetivos ligados', tag: 'Gestão de Resultados', module: 'resultados',
    query: z.object({ perspective: z.enum(['diretoria', 'gestao', 'lideranca']).optional(), unitId: z.string().uuid().optional(), teamId: z.string().uuid().optional() }),
    handler: async ({ app, auth, query: q }) => {
      const sc = await resultsScope(app.db, auth);
      const perspective: Perspective | null = q.perspective && sc.perspectives.includes(q.perspective) ? q.perspective : sc.perspectives[0] ?? null;
      if (q.perspective && !sc.perspectives.includes(q.perspective)) throw forbidden('Você não responde por esta perspectiva.');
      let teamIds = sc.teamIds;
      let userIds = sc.userIds;
      if (q.unitId) {
        if (!sc.all && !sc.unitIds.includes(q.unitId)) throw forbidden('Unidade fora do seu escopo.');
        const p = unitPeople(await orgData(app.db, auth.tenantId), q.unitId);
        teamIds = p.teamIds; userIds = p.userIds;
      }
      if (q.teamId) {
        if (!sc.all && !sc.teamIds.includes(q.teamId)) throw forbidden('Time fora do seu escopo.');
        teamIds = [q.teamId];
        userIds = (await app.db.select({ u: s.teamMemberships.userId }).from(s.teamMemberships).where(eq(s.teamMemberships.teamId, q.teamId))).map((r) => r.u);
      }
      await ensureFreshEvents(app.db, auth.tenantId);
      const today = todayLocal(auth);
      const vis: SQL[] = [];
      if (perspective === 'diretoria' && !q.unitId && !q.teamId) vis.push(eq(s.goals.scope, 'empresa'));
      if (teamIds.length) vis.push(and(eq(s.goals.scope, 'equipe'), inArray(s.goals.teamId, teamIds))!);
      if (userIds.length && perspective !== 'diretoria') vis.push(and(eq(s.goals.scope, 'individual'), inArray(s.goals.userId, userIds))!);
      const rows = vis.length ? await app.db.select().from(s.goals).where(and(eq(s.goals.tenantId, auth.tenantId), eq(s.goals.status, 'ativa'), sql`${s.goals.periodStart} <= ${today}::date and ${s.goals.periodEnd} >= ${today}::date`, or(...vis))).orderBy(s.goals.scope, s.goals.title).limit(300) : [];
      const { config } = await performanceConfig(app.db, auth.tenantId);
      const inds = await allIndicators(app.db, auth.tenantId);
      const org = await orgData(app.db, auth.tenantId);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const goals = await Promise.all(rows.map(async (g) => ({ ...(await goalDto(app.db, auth, g, config.traffic)), indicatorName: inds.find((i) => i.id === g.indicatorId)?.def.name ?? null, teamName: org.teams.find((t) => t.id === g.teamId)?.name ?? null, userName: users.find((u) => u.id === g.userId)?.name ?? null })));
      const colors = { verde: 0, amarelo: 0, vermelho: 0, sem_dado: 0 } as Record<string, number>;
      for (const g of goals) colors[g.progress.color] = (colors[g.progress.color] ?? 0) + 1;
      return { perspective, today, goals, colors, scope: { teams: teamIds.length, people: userIds.length } };
    },
  }),

  // ------------------------------------------------------------ apuração oficial (Fase 4)
  defineRoute({
    method: 'GET', url: '/results/closings/:id', summary: 'Histórico de apurações da série da meta (competências, versões, tendência, variação e qualidade)', tag: 'Gestão de Resultados', module: 'resultados', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [g] = await app.db.select().from(s.goals).where(and(eq(s.goals.id, params.id), eq(s.goals.tenantId, auth.tenantId))).limit(1);
      if (!g) throw notFound('Meta não encontrada.');
      await assertGoalInScope(app.db, auth, g);
      const rows = await app.db.select({ c: s.resultClosings, by: s.users.name }).from(s.resultClosings).leftJoin(s.users, eq(s.users.id, s.resultClosings.actorId)).where(and(eq(s.resultClosings.tenantId, auth.tenantId), eq(s.resultClosings.seriesId, g.seriesId ?? g.id))).orderBy(s.resultClosings.competencia, s.resultClosings.version);
      const byComp = new Map<string, typeof rows>();
      for (const r of rows) byComp.set(r.c.competencia, [...(byComp.get(r.c.competencia) ?? []), r]);
      const comps = [...byComp.entries()].map(([competencia, vs]) => { const cur = vs[vs.length - 1]!.c; return { competencia, current: cur, versions: vs.map((v) => ({ ...v.c, actorName: v.by })) }; });
      const ind = g.indicatorId ? await indicatorDef(app.db, auth.tenantId, g.indicatorId) : null;
      const direction = ind?.def.direction ?? 'maior';
      const last = comps.slice(-12);
      return {
        goalId: g.id, seriesId: g.seriesId ?? g.id, unit: ind?.def.unit ?? g.manualUnit ?? 'quantidade', direction,
        competencias: last.map((c, i) => ({ ...c, variation: i ? variation(last[i - 1]!.current.value, c.current.value) : null })),
        trend: trendOf(last.map((c) => c.current.value), direction),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/results/closings/:id/drift', summary: 'Confere se os dados de origem mudaram depois do fechamento (sugere retificação, não altera nada)', tag: 'Gestão de Resultados', module: 'resultados', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { g, cur } = await closingTarget(app.db, auth, params.id);
      if (!g.indicatorId) return { changed: false, closedValue: cur.value, currentValue: cur.value, manual: true };
      const d = await indicatorDef(app.db, auth.tenantId, g.indicatorId);
      const r = await computeIndicator(app.db, auth.tenantId, auth.timezone, d!.def, await goalWho(app.db, g), { from: g.periodStart, to: g.periodEnd });
      const changed = (r.value ?? null) !== (cur.value ?? null) && !(r.value !== null && cur.value !== null && Math.abs(r.value - cur.value) < 1e-6);
      return { changed, closedValue: cur.value, currentValue: r.value, indicatorVersion: d!.version, closedIndicatorVersion: cur.indicatorVersion };
    },
  }),
  defineRoute({
    method: 'POST', url: '/results/closings/:id/validate', summary: 'Valida a apuração (nova versão "validado", mesmo valor). Quem é avaliado não valida o próprio resultado.', tag: 'Gestão de Resultados', module: 'resultados', params: IdParams,
    body: z.object({ note: z.string().trim().max(1000).default('') }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { g, cur } = await closingTarget(tx, auth, params.id, true);
      if (cur.status === 'validado') throw unprocessable('A apuração vigente já está validada.');
      await insertClosing(tx, auth, g, cur, { status: 'validado', value: cur.value, reason: body.note || null });
      await syncInterventions(tx, auth.tenantId, todayLocal(auth), [cur.seriesId ?? g.id]);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/results/closings/:id/rectify', summary: 'Retifica a apuração: recalcula pela origem atual ou informa o valor (meta manual); exige motivo e gera nova versão', tag: 'Gestão de Resultados', module: 'resultados', params: IdParams,
    body: z.object({ reason: z.string().trim().min(10).max(1000), value: z.number().nullable().optional(), recompute: z.boolean().default(true) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { g, cur } = await closingTarget(tx, auth, params.id, true);
      let value: number | null;
      let indicatorVersion = cur.indicatorVersion;
      if (g.indicatorId && body.recompute) {
        const d = await indicatorDef(tx, auth.tenantId, g.indicatorId);
        const r = await computeIndicator(tx, auth.tenantId, auth.timezone, d!.def, await goalWho(tx, g), { from: g.periodStart, to: g.periodEnd });
        value = r.value; indicatorVersion = d!.version;
      } else {
        if (body.value === undefined) throw unprocessable('Informe o valor correto.', [{ path: 'value', message: 'Obrigatório sem recálculo' }]);
        value = body.value ?? null;
      }
      await insertClosing(tx, auth, g, cur, { status: 'retificado', value, reason: body.reason, indicatorVersion });
      await syncInterventions(tx, auth.tenantId, todayLocal(auth), [cur.seriesId ?? g.id]);
      return { ok: true, value };
    }),
  }),
];

async function assertGoalInScope(db: DbOrTx, auth: AuthContext, g: typeof s.goals.$inferSelect) {
  const sc = await resultsScope(db, auth);
  if (sc.all || level(auth, 'desempenho') === 'total') return sc;
  const ok = g.scope === 'empresa' ? sc.perspectives.includes('diretoria') : g.scope === 'unidade' ? !!g.orgUnitId && sc.unitIds.includes(g.orgUnitId) : g.scope === 'equipe' ? !!g.teamId && sc.teamIds.includes(g.teamId) : !!g.userId && sc.userIds.includes(g.userId);
  if (!ok) throw forbidden('Meta fora do seu escopo.');
  return sc;
}

/** Apuração vigente da meta; para alterar, exige escopo de gestão e que a pessoa não seja a avaliada. */
async function closingTarget(db: DbOrTx, auth: AuthContext, goalId: string, forChange = false) {
  const [g] = await db.select().from(s.goals).where(and(eq(s.goals.id, goalId), eq(s.goals.tenantId, auth.tenantId))).limit(1);
  if (!g) throw notFound('Meta não encontrada.');
  await assertGoalInScope(db, auth, g);
  const [cur] = await db.select().from(s.resultClosings).where(eq(s.resultClosings.goalId, g.id)).orderBy(desc(s.resultClosings.version)).limit(1);
  if (!cur) throw unprocessable('A meta ainda não tem apuração oficial (o período não terminou).');
  if (forChange) {
    if (g.userId === auth.userId || g.ownerId === auth.userId) throw forbidden('Quem é avaliado pela meta não valida nem retifica o próprio resultado.');
    if (level(auth, 'resultados') === 'proprio' && level(auth, 'desempenho') !== 'total') throw forbidden('Só a gestão valida ou retifica apurações.');
  }
  return { g, cur };
}

async function insertClosing(db: DbOrTx, auth: AuthContext, g: typeof s.goals.$inferSelect, cur: typeof s.resultClosings.$inferSelect, v: { status: 'validado' | 'retificado'; value: number | null; reason: string | null; indicatorVersion?: number | null }) {
  const ind = g.indicatorId ? await indicatorDef(db, auth.tenantId, g.indicatorId) : null;
  const att = attainment(v.value, cur.target, ind?.def.direction ?? 'maior');
  const { config } = await performanceConfig(db, auth.tenantId);
  const color = trafficLight(att, config.traffic);
  await db.insert(s.resultClosings).values({ tenantId: auth.tenantId, goalId: g.id, seriesId: cur.seriesId, competencia: cur.competencia, version: cur.version + 1, status: v.status, value: v.value, target: cur.target, attainment: att, color, indicatorVersion: v.indicatorVersion ?? cur.indicatorVersion, sample: cur.sample, quality: cur.quality, reason: v.reason, actorId: auth.userId });
  await db.insert(s.goalEvents).values({ tenantId: auth.tenantId, goalId: g.id, type: v.status === 'validado' ? 'apuracao_validada' : 'apuracao_retificada', payload: { competencia: cur.competencia, from: cur.value, to: v.value, color, previousColor: cur.color, reason: v.reason }, actorId: auth.userId });
  return { color, attainment: att };
}
