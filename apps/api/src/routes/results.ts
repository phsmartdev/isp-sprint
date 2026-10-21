/** GESTÃO DE RESULTADOS — Fase 2: estrutura organizacional, escopo e perspectivas (Diretoria, Gestão, Liderança). */
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { atLeast } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { ensureFreshEvents, performanceConfig } from '../services/businessEvents';
import { todayLocal } from '../services/projects';
import { allIndicators } from '../services/indicators';
import { PERSPECTIVE_LABELS, createsUnitCycle, orgData, resultsScope, unitPeople, type Perspective } from '../services/results';
import { goalDto } from './indicators';

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
];
