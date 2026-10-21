/** Gestão de Times — Fase 5: intervenções (vermelho, dois amarelos seguidos, revisão do primeiro amarelo), prazos e escalonamento. */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { OPEN_INTERVENTION, addDaysIso, DEFAULT_INTERVENTION_CONFIG } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { todayLocal } from '../services/projects';
import { orgData, resultsScope, type ResultsScope } from '../services/results';
import { performanceConfig } from '../services/businessEvents';
import { ensureFreshInterventions, logIntervention, syncInterventions } from '../services/interventions';

type Row = typeof s.interventions.$inferSelect;
const canSee = (sc: ResultsScope, auth: AuthContext, i: Row) =>
  sc.all || i.ownerId === auth.userId || i.subjectUserId === auth.userId || i.escalationChain.includes(auth.userId)
  || (!!i.teamId && sc.teamIds.includes(i.teamId)) || (!!i.orgUnitId && sc.unitIds.includes(i.orgUnitId))
  || (!!i.subjectUserId && sc.userIds.includes(i.subjectUserId) && sc.perspectives.length > 0)
  || (!i.teamId && !i.orgUnitId && !i.subjectUserId && sc.perspectives.includes('diretoria'));
const canAct = (sc: ResultsScope, auth: AuthContext, i: Row) => sc.all || i.ownerId === auth.userId || i.escalationChain.includes(auth.userId);
const canDismiss = (sc: ResultsScope, auth: AuthContext, i: Row) => (sc.all || i.escalationChain.includes(auth.userId)) && i.ownerId !== auth.userId && i.subjectUserId !== auth.userId;

async function load(db: DbOrTx, auth: AuthContext, id: string, forUpdate = false) {
  const q = db.select().from(s.interventions).where(and(eq(s.interventions.id, id), eq(s.interventions.tenantId, auth.tenantId))).limit(1);
  const [i] = forUpdate ? await q.for('update') : await q;
  if (!i) throw notFound('Intervenção não encontrada.');
  const sc = await resultsScope(db, auth);
  if (!canSee(sc, auth, i)) throw notFound('Intervenção não encontrada.');
  return { i, sc };
}
const bump = { updatedAt: new Date(), rowVersion: sql`${s.interventions.rowVersion} + 1` };
const checkVersion = (i: Row, v: number) => { if (i.rowVersion !== v) throw conflict(i.rowVersion); };

export const interventionRoutes = [
  defineRoute({
    method: 'GET', url: '/interventions', summary: 'Intervenções no seu escopo (abertas por padrão), com contagens por situação, tipo, atraso e escalonamento', tag: 'Gestão de Times', module: 'resultados',
    query: z.object({ status: z.enum(['abertas', 'aberta', 'em_andamento', 'concluida', 'dispensada', 'todas']).default('abertas'), kind: z.enum(['plano', 'revisao']).optional(), mine: z.coerce.boolean().optional() }),
    handler: async ({ app, auth, query: q }) => {
      const today = todayLocal(auth);
      await ensureFreshInterventions(app.db, auth.tenantId, today);
      const sc = await resultsScope(app.db, auth);
      const rows = await app.db.select({ i: s.interventions, goalTitle: s.goals.title, goalScope: s.goals.scope, ownerName: s.users.name })
        .from(s.interventions).innerJoin(s.goals, eq(s.goals.id, s.interventions.goalId)).innerJoin(s.users, eq(s.users.id, s.interventions.ownerId))
        .where(eq(s.interventions.tenantId, auth.tenantId)).orderBy(desc(s.interventions.createdAt)).limit(1000);
      const vis = rows.filter((r) => canSee(sc, auth, r.i));
      const due = (i: Row) => (i.status === 'aberta' ? i.dueOn : i.planDueOn ?? i.dueOn);
      const isOpen = (i: Row) => OPEN_INTERVENTION.includes(i.status as 'aberta');
      const counts = {
        abertas: vis.filter((r) => isOpen(r.i)).length,
        planos: vis.filter((r) => isOpen(r.i) && r.i.kind === 'plano').length,
        revisoes: vis.filter((r) => isOpen(r.i) && r.i.kind === 'revisao').length,
        atrasadas: vis.filter((r) => isOpen(r.i) && due(r.i) < today).length,
        escaladas: vis.filter((r) => isOpen(r.i) && r.i.escalationLevel > 0).length,
        minhas: vis.filter((r) => isOpen(r.i) && (r.i.ownerId === auth.userId || r.i.escalationChain.slice(0, r.i.escalationLevel).includes(auth.userId))).length,
      };
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const org = await orgData(app.db, auth.tenantId);
      const items = vis
        .filter((r) => q.status === 'todas' || (q.status === 'abertas' ? isOpen(r.i) : r.i.status === q.status))
        .filter((r) => !q.kind || r.i.kind === q.kind)
        .filter((r) => !q.mine || r.i.ownerId === auth.userId || r.i.escalationChain.slice(0, r.i.escalationLevel).includes(auth.userId))
        .map((r) => ({
          id: r.i.id, kind: r.i.kind, trigger: r.i.trigger, status: r.i.status, competencias: r.i.competencias, goalId: r.i.goalId, goalTitle: r.goalTitle, goalScope: r.goalScope,
          ownerId: r.i.ownerId, ownerName: r.ownerName, subjectName: users.find((u) => u.id === r.i.subjectUserId)?.name ?? null,
          teamName: org.teams.find((t) => t.id === r.i.teamId)?.name ?? null, unitName: org.units.find((u) => u.id === r.i.orgUnitId)?.name ?? null,
          dueOn: due(r.i), overdue: isOpen(r.i) && due(r.i) < today, escalationLevel: r.i.escalationLevel,
          escalatedTo: r.i.escalationLevel > 0 ? users.find((u) => u.id === r.i.escalationChain[r.i.escalationLevel - 1])?.name ?? null : null,
          createdAt: r.i.createdAt,
        }))
        .sort((a, b) => Number(OPEN_INTERVENTION.includes(b.status as 'aberta')) - Number(OPEN_INTERVENTION.includes(a.status as 'aberta')) || Number(b.kind === 'plano') - Number(a.kind === 'plano') || a.dueOn.localeCompare(b.dueOn));
      return { today, counts, items };
    },
  }),
  defineRoute({
    method: 'GET', url: '/interventions/:id', summary: 'Detalhe da intervenção: meta, histórico de apurações da série, cadeia de responsáveis e histórico de ações', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { i, sc } = await load(app.db, auth, params.id);
      const [g] = await app.db.select().from(s.goals).where(eq(s.goals.id, i.goalId)).limit(1);
      const closings = await app.db.execute<{ competencia: string; color: string; attainment: number | null; value: number | null; target: number; status: string; version: number }>(sql`
        select distinct on (competencia) competencia, color, attainment, value, target, status, version from result_closings
         where tenant_id = ${auth.tenantId} and series_id = ${i.seriesId} order by competencia desc, version desc limit 6`);
      const events = await app.db.select({ e: s.interventionEvents, actorName: s.users.name }).from(s.interventionEvents).leftJoin(s.users, eq(s.users.id, s.interventionEvents.actorId)).where(eq(s.interventionEvents.interventionId, i.id)).orderBy(desc(s.interventionEvents.createdAt));
      const ids = [i.ownerId, i.subjectUserId, i.resolvedBy, ...i.escalationChain].filter(Boolean) as string[];
      const people = ids.length ? await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids)) : [];
      const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
      const org = await orgData(app.db, auth.tenantId);
      await app.db.insert(s.interventionReads).values({ userId: auth.userId, interventionId: i.id }).onConflictDoUpdate({ target: [s.interventionReads.userId, s.interventionReads.interventionId], set: { lastReadAt: new Date() } });
      const { config } = await performanceConfig(app.db, auth.tenantId);
      return {
        ...i, goal: { id: g!.id, title: g!.title, scope: g!.scope, periodStart: g!.periodStart, periodEnd: g!.periodEnd, target: g!.target },
        ownerName: name(i.ownerId), subjectName: name(i.subjectUserId), resolvedByName: name(i.resolvedBy),
        teamName: org.teams.find((t) => t.id === i.teamId)?.name ?? null, unitName: org.units.find((u) => u.id === i.orgUnitId)?.name ?? null,
        chain: i.escalationChain.map((id, k) => ({ id, name: name(id), level: k + 1, called: k < i.escalationLevel })),
        closings: [...closings.rows].reverse(),
        events: events.map((r) => ({ ...r.e, actorName: r.actorName })),
        can: { act: canAct(sc, auth, i), dismiss: canDismiss(sc, auth, i) },
        config: { ...DEFAULT_INTERVENTION_CONFIG, ...(config.interventions ?? {}) },
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/interventions/:id/review', summary: 'Revisão simplificada do primeiro amarelo: causa provável e decisão (manter acompanhamento ou abrir plano de ação)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), cause: z.string().trim().min(10).max(2000), decision: z.enum(['manter', 'plano']) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele na estrutura registra a revisão.');
      if (i.kind !== 'revisao' || i.status !== 'aberta') throw unprocessable('Esta intervenção não está aguardando revisão.');
      checkVersion(i, body.rowVersion);
      const today = todayLocal(auth);
      if (body.decision === 'manter') {
        await tx.update(s.interventions).set({ ...bump, reviewCause: body.cause, reviewDecision: 'manter', status: 'concluida', conclusion: body.cause, resolvedBy: auth.userId, resolvedAt: new Date() }).where(eq(s.interventions.id, i.id));
      } else {
        const { config } = await performanceConfig(tx, auth.tenantId);
        const days = config.interventions?.planDays ?? DEFAULT_INTERVENTION_CONFIG.planDays;
        await tx.update(s.interventions).set({ ...bump, reviewCause: body.cause, reviewDecision: 'plano', kind: 'plano', dueOn: addDaysIso(today, days), escalationLevel: 0 }).where(eq(s.interventions.id, i.id));
      }
      await logIntervention(tx, auth.tenantId, i.id, 'revisada', { cause: body.cause, decision: body.decision }, [i.ownerId, i.subjectUserId, ...i.escalationChain.slice(0, i.escalationLevel)], auth.userId);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/interventions/:id/plan', summary: 'Registra (ou atualiza) o diagnóstico e o plano de ação com prazo; a intervenção passa a "em execução"', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), diagnosis: z.string().trim().min(10).max(4000), actionPlan: z.string().trim().min(10).max(8000), planDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele na estrutura registra o plano.');
      if (i.kind !== 'plano' || !OPEN_INTERVENTION.includes(i.status as 'aberta')) throw unprocessable('Esta intervenção não aceita plano de ação.');
      checkVersion(i, body.rowVersion);
      if (body.planDueOn < todayLocal(auth)) throw unprocessable('O prazo do plano não pode estar no passado.', [{ path: 'planDueOn', message: 'Data passada' }]);
      const first = i.status === 'aberta';
      await tx.update(s.interventions).set({ ...bump, diagnosis: body.diagnosis, actionPlan: body.actionPlan, planDueOn: body.planDueOn, status: 'em_andamento' }).where(eq(s.interventions.id, i.id));
      await logIntervention(tx, auth.tenantId, i.id, first ? 'plano_registrado' : 'plano_atualizado', { planDueOn: body.planDueOn, ...(first ? {} : { previousDueOn: i.planDueOn }) }, [i.ownerId, i.subjectUserId, ...i.escalationChain.slice(0, Math.max(1, i.escalationLevel))], auth.userId);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/interventions/:id/conclude', summary: 'Conclui o plano de ação com o resultado obtido', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), conclusion: z.string().trim().min(10).max(4000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele conclui o plano.');
      if (i.status !== 'em_andamento') throw unprocessable('Registre o plano de ação antes de concluir.');
      checkVersion(i, body.rowVersion);
      await tx.update(s.interventions).set({ ...bump, status: 'concluida', conclusion: body.conclusion, resolvedBy: auth.userId, resolvedAt: new Date() }).where(eq(s.interventions.id, i.id));
      await logIntervention(tx, auth.tenantId, i.id, 'concluida', { conclusion: body.conclusion }, [i.ownerId, i.subjectUserId, ...i.escalationChain.slice(0, Math.max(1, i.escalationLevel))], auth.userId);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/interventions/:id/dismiss', summary: 'Dispensa a intervenção com justificativa (só quem está acima do responsável; nunca o próprio responsável ou o avaliado)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), reason: z.string().trim().min(10).max(2000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canDismiss(sc, auth, i)) throw forbidden('Só quem está acima do responsável na estrutura pode dispensar uma intervenção.');
      if (!OPEN_INTERVENTION.includes(i.status as 'aberta')) throw unprocessable('A intervenção já foi encerrada.');
      checkVersion(i, body.rowVersion);
      await tx.update(s.interventions).set({ ...bump, status: 'dispensada', conclusion: body.reason, resolvedBy: auth.userId, resolvedAt: new Date() }).where(eq(s.interventions.id, i.id));
      await logIntervention(tx, auth.tenantId, i.id, 'dispensada', { reason: body.reason }, [i.ownerId, i.subjectUserId], auth.userId);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/interventions/sync', summary: 'Recalcula as intervenções pelas apurações vigentes (idempotente)', tag: 'Gestão de Times', module: 'resultados', min: 'total',
    handler: async ({ app, auth }) => syncInterventions(app.db, auth.tenantId, todayLocal(auth)),
  }),
];
