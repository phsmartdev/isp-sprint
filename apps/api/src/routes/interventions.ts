/** Gestão de Times — Fase 5: intervenções (vermelho, dois amarelos seguidos, revisão do primeiro amarelo), prazos e escalonamento. */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { OPEN_INTERVENTION, addDaysIso, DEFAULT_INTERVENTION_CONFIG, EMPTY_ANALYSIS, ISHIKAWA_CATEGORIES, actionTaskNotes, planConclusionBlockers, planProgress, validateW2H, type TaskStatus, LOSS_REASON_LABELS, analysisGaps, diagnosisFrom, paretoRows, type AnalysisContent } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { dueAtOf, loadProject, todayLocal } from '../services/projects';
import { applyStatus, assertAssignee, taskEvent } from '../services/tasks';
import { orgData, resultsScope, type ResultsScope } from '../services/results';
import { performanceConfig } from '../services/businessEvents';
import { ensureFreshInterventions, logIntervention, syncInterventions } from '../services/interventions';
import { goalWho } from '../services/indicators';

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
async function actionsOf(db: DbOrTx, auth: AuthContext, interventionId: string) {
  const rows = await db.select({
    a: s.interventionActions, title: s.activities.title, status: s.activities.status, ownerId: s.activities.ownerId, ownerName: s.users.name, projectId: s.activities.projectId,
    dueOn: sql<string | null>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')`,
  }).from(s.interventionActions).innerJoin(s.activities, eq(s.activities.id, s.interventionActions.activityId)).innerJoin(s.users, eq(s.users.id, s.activities.ownerId))
    .where(eq(s.interventionActions.interventionId, interventionId)).orderBy(s.interventionActions.createdAt);
  return rows.map((r) => ({ ...r.a, taskTitle: r.title, status: r.status as TaskStatus, ownerId: r.ownerId, ownerName: r.ownerName, dueOn: r.dueOn, projectId: r.projectId }));
}
async function requireAnalysisDone(db: DbOrTx, auth: AuthContext, interventionId: string) {
  const { config: pc } = await performanceConfig(db, auth.tenantId);
  if ((pc.interventions?.requireAnalysis ?? DEFAULT_INTERVENTION_CONFIG.requireAnalysis) === false) return;
  const [an] = await db.select({ status: s.interventionAnalyses.status }).from(s.interventionAnalyses).where(eq(s.interventionAnalyses.interventionId, interventionId)).limit(1);
  if (an?.status !== 'concluida') throw unprocessable('Conclua a análise (problema, Pareto, Ishikawa e 5 Porquês) antes de montar o plano de ação.');
}

const bump = { updatedAt: new Date(), rowVersion: sql`${s.interventions.rowVersion} + 1` };
const checkVersion = (i: Row, v: number) => { if (i.rowVersion !== v) throw conflict(i.rowVersion); };

const txt = (max: number) => z.string().max(max).default('');
const AnalysisBody = z.object({
  problem: z.object({ what: txt(1000), where: txt(300), when: txt(300), howMuch: txt(300) }),
  pareto: z.object({ title: z.string().trim().max(120), source: z.enum(['manual', 'motivos_perda', 'motivos_perda_valor']), items: z.array(z.object({ label: z.string().trim().max(120), value: z.number().finite().min(0).max(1e12) })).max(30) }).nullable(),
  causes: z.array(z.object({ id: z.string().min(1).max(40), category: z.enum(ISHIKAWA_CATEGORIES.map((c) => c.key) as [string, ...string[]]), text: z.string().trim().max(300), selected: z.boolean() })).max(60),
  whys: z.array(z.object({ causeId: z.string().min(1).max(40), whys: z.array(z.string().max(500)).max(5), rootCause: txt(500), evidence: txt(1000), confirmed: z.boolean() })).max(60),
});

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
      const [an] = await app.db.select({ status: s.interventionAnalyses.status }).from(s.interventionAnalyses).where(eq(s.interventionAnalyses.interventionId, i.id)).limit(1);
      const actions = await actionsOf(app.db, auth, i.id);
      const [proj] = i.projectId ? await app.db.select({ id: s.projects.id, name: s.projects.name, code: s.projects.code }).from(s.projects).where(eq(s.projects.id, i.projectId)).limit(1) : [];
      return {
        ...i, analysisStatus: an?.status ?? null, actions, progress: planProgress(actions, todayLocal(auth)), project: proj ?? null,
        planCostCents: actions.filter((a) => a.status !== 'cancelada').reduce((x, a) => x + (a.howMuchCents ?? 0), 0), goal: { id: g!.id, title: g!.title, scope: g!.scope, periodStart: g!.periodStart, periodEnd: g!.periodEnd, target: g!.target },
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
    body: z.object({ rowVersion: z.number().int(), diagnosis: z.string().trim().min(10).max(4000), actionPlan: z.string().trim().max(8000).default(''), planDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele na estrutura registra o plano.');
      if (i.kind !== 'plano' || !OPEN_INTERVENTION.includes(i.status as 'aberta')) throw unprocessable('Esta intervenção não aceita plano de ação.');
      checkVersion(i, body.rowVersion);
      await requireAnalysisDone(tx, auth, i.id);
      const acts = (await actionsOf(tx, auth, i.id)).filter((a) => a.status !== 'cancelada');
      if (!acts.length) throw unprocessable('Inclua pelo menos uma ação 5W2H no plano.');
      // prazo do plano: o informado ou o da última ação
      const planDueOn = body.planDueOn ?? acts.map((a) => a.dueOn ?? '').sort().at(-1)!;
      if (planDueOn < todayLocal(auth)) throw unprocessable('O prazo do plano não pode estar no passado.', [{ path: 'planDueOn', message: 'Data passada' }]);
      const first = i.status === 'aberta';
      await tx.update(s.interventions).set({ ...bump, diagnosis: body.diagnosis, actionPlan: body.actionPlan || null, planDueOn, status: 'em_andamento' }).where(eq(s.interventions.id, i.id));
      await logIntervention(tx, auth.tenantId, i.id, first ? 'plano_registrado' : 'plano_atualizado', { planDueOn, actions: acts.length, ...(first ? {} : { previousDueOn: i.planDueOn }) }, [i.ownerId, i.subjectUserId, ...i.escalationChain.slice(0, Math.max(1, i.escalationLevel))], auth.userId);
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
      const blockers = planConclusionBlockers(await actionsOf(tx, auth, i.id));
      if (blockers.length) throw unprocessable(blockers[0]!);
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

  // ------------------------------------------------------------ Fase 6: jornada de análise
  defineRoute({
    method: 'GET', url: '/interventions/:id/analysis', summary: 'Jornada de análise da intervenção (problema, Pareto, Ishikawa, 5 Porquês) com as pendências de cada etapa', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { i, sc } = await load(app.db, auth, params.id);
      const [a] = await app.db.select({ a: s.interventionAnalyses, by: s.users.name }).from(s.interventionAnalyses).leftJoin(s.users, eq(s.users.id, s.interventionAnalyses.concludedBy)).where(eq(s.interventionAnalyses.interventionId, i.id)).limit(1);
      const content = a?.a.content ?? EMPTY_ANALYSIS;
      const open = OPEN_INTERVENTION.includes(i.status as 'aberta');
      return {
        analysis: a ? { ...a.a, concludedByName: a.by } : null, content, gaps: analysisGaps(content), pareto: content.pareto ? paretoRows(content.pareto.items) : null,
        categories: ISHIKAWA_CATEGORIES, canEdit: open && canAct(sc, auth, i) && a?.a.status !== 'concluida', canReopen: open && canAct(sc, auth, i) && a?.a.status === 'concluida',
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/interventions/:id/analysis', summary: 'Salva o rascunho da análise (versão otimista: 0 para criar)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int().min(0), content: AnalysisBody }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele na estrutura conduz a análise.');
      if (!OPEN_INTERVENTION.includes(i.status as 'aberta')) throw unprocessable('A intervenção já foi encerrada.');
      const ids = new Set(body.content.causes.map((c) => c.id));
      if (ids.size !== body.content.causes.length) throw unprocessable('Causas com identificador repetido.');
      const content = { ...body.content, whys: body.content.whys.filter((w) => ids.has(w.causeId)) } as AnalysisContent;
      const [cur] = await tx.select().from(s.interventionAnalyses).where(eq(s.interventionAnalyses.interventionId, i.id)).limit(1);
      if (!cur) {
        if (body.rowVersion !== 0) throw conflict(0);
        const [r] = await tx.insert(s.interventionAnalyses).values({ tenantId: auth.tenantId, interventionId: i.id, content, createdBy: auth.userId }).onConflictDoNothing().returning({ rowVersion: s.interventionAnalyses.rowVersion });
        if (!r) throw conflict(1);
        await logIntervention(tx, auth.tenantId, i.id, 'analise_iniciada', {}, [], auth.userId);
        return { rowVersion: r.rowVersion, gaps: analysisGaps(content) };
      }
      if (cur.status === 'concluida') throw unprocessable('A análise está concluída. Reabra para alterar.');
      if (cur.rowVersion !== body.rowVersion) throw conflict(cur.rowVersion);
      const [r] = await tx.update(s.interventionAnalyses).set({ content, updatedAt: new Date(), rowVersion: sql`${s.interventionAnalyses.rowVersion} + 1` }).where(eq(s.interventionAnalyses.id, cur.id)).returning({ rowVersion: s.interventionAnalyses.rowVersion });
      return { rowVersion: r!.rowVersion, gaps: analysisGaps(content) };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/interventions/:id/analysis/conclude', summary: 'Conclui a análise (todas as etapas completas); o diagnóstico vai para o plano de ação', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), conclusion: z.string().trim().max(4000).optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele conclui a análise.');
      const [cur] = await tx.select().from(s.interventionAnalyses).where(eq(s.interventionAnalyses.interventionId, i.id)).limit(1).for('update');
      if (!cur) throw unprocessable('Comece a análise antes de concluir.');
      if (cur.status === 'concluida') throw unprocessable('A análise já está concluída.');
      if (cur.rowVersion !== body.rowVersion) throw conflict(cur.rowVersion);
      const gaps = analysisGaps(cur.content);
      if (gaps.length) throw unprocessable(gaps[0]!.message, gaps.map((g) => ({ path: g.step, message: g.message })));
      const diagnosis = body.conclusion?.trim() || diagnosisFrom(cur.content);
      await tx.update(s.interventionAnalyses).set({ status: 'concluida', conclusion: diagnosis, concludedBy: auth.userId, concludedAt: new Date(), updatedAt: new Date(), rowVersion: sql`${s.interventionAnalyses.rowVersion} + 1` }).where(eq(s.interventionAnalyses.id, cur.id));
      // o diagnóstico da análise vira o ponto de partida do plano (sem sobrescrever plano já registrado)
      if (!i.diagnosis) await tx.update(s.interventions).set({ ...bump, diagnosis }).where(eq(s.interventions.id, i.id));
      await logIntervention(tx, auth.tenantId, i.id, 'analise_concluida', { roots: cur.content.whys.filter((w) => w.confirmed).map((w) => w.rootCause) }, [i.ownerId, ...i.escalationChain.slice(0, i.escalationLevel)], auth.userId);
      return { ok: true, diagnosis };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/interventions/:id/analysis/reopen', summary: 'Reabre a análise concluída para revisão (com motivo, fica no histórico)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), reason: z.string().trim().min(10).max(1000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i) || !OPEN_INTERVENTION.includes(i.status as 'aberta')) throw forbidden('A análise só pode ser reaberta por quem conduz uma intervenção aberta.');
      const [cur] = await tx.select().from(s.interventionAnalyses).where(eq(s.interventionAnalyses.interventionId, i.id)).limit(1).for('update');
      if (cur?.status !== 'concluida') throw unprocessable('A análise não está concluída.');
      if (cur.rowVersion !== body.rowVersion) throw conflict(cur.rowVersion);
      await tx.update(s.interventionAnalyses).set({ status: 'rascunho', updatedAt: new Date(), rowVersion: sql`${s.interventionAnalyses.rowVersion} + 1` }).where(eq(s.interventionAnalyses.id, cur.id));
      await logIntervention(tx, auth.tenantId, i.id, 'analise_reaberta', { reason: body.reason }, [i.ownerId], auth.userId);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'GET', url: '/interventions/:id/analysis/pareto-data', summary: 'Dados reais para o Pareto: negociações perdidas no período da meta, por motivo (quantidade ou valor mensal)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    query: z.object({ source: z.enum(['motivos_perda', 'motivos_perda_valor']) }),
    handler: async ({ app, auth, params, query: q }) => {
      const { i } = await load(app.db, auth, params.id);
      const [g] = await app.db.select().from(s.goals).where(eq(s.goals.id, i.goalId)).limit(1);
      const who = await goalWho(app.db, g!);
      if (Array.isArray(who.users) && !who.users.length) return { items: [], sample: 0, period: { from: g!.periodStart, to: g!.periodEnd } };
      const rows = await app.db.execute<{ reason: string | null; n: number; value: string | number }>(sql`
        select o.loss_reason as reason, count(*)::int as n, coalesce(sum(be.value_cents), 0) as value
          from business_events be join opportunities o on o.id = be.source_id
         where be.tenant_id = ${auth.tenantId} and be.type = 'negociacao_perdida' and be.validation = 'valido'
           and (be.occurred_at at time zone ${auth.timezone})::date between ${g!.periodStart}::date and ${g!.periodEnd}::date
           ${who.users === 'all' ? sql`` : sql`and be.owner_id in (${sql.join(who.users.map((u) => sql`${u}::uuid`), sql`, `)})`}
         group by o.loss_reason`);
      const labels = LOSS_REASON_LABELS as Record<string, string>;
      const items = rows.rows.map((r) => ({ label: r.reason ? labels[r.reason] ?? r.reason : 'Sem motivo informado', value: q.source === 'motivos_perda' ? r.n : Math.round(Number(r.value)) / 100 }));
      return { items, sample: rows.rows.reduce((a, r) => a + r.n, 0), period: { from: g!.periodStart, to: g!.periodEnd } };
    },
  }),

  // ------------------------------------------------------------ Fase 7: plano 5W2H integrado a tarefas e projetos
  defineRoute({
    method: 'POST', url: '/interventions/:id/actions', summary: 'Inclui ação 5W2H no plano: nasce como tarefa para quem executa (no projeto do plano, se houver)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({
      what: z.string().trim().max(200), why: z.string().trim().max(1000), rootCause: z.string().trim().max(500).nullable().optional(), where: z.string().trim().max(200).default(''),
      whenDue: z.string(), whoId: z.string().uuid().nullable(), how: z.string().trim().max(2000), howMuchCents: z.number().int().nullable().default(null),
    }),
    handler: async ({ app, auth, params, body, reply }) => {
      const id = await app.db.transaction(async (tx) => {
        const { i, sc } = await load(tx, auth, params.id, true);
        if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele monta o plano.');
        if (i.kind !== 'plano' || !OPEN_INTERVENTION.includes(i.status as 'aberta')) throw unprocessable('Esta intervenção não aceita plano de ação.');
        await requireAnalysisDone(tx, auth, i.id);
        const errs = validateW2H(body, todayLocal(auth));
        if (errs.length) throw unprocessable(errs[0]!.message, errs);
        await assertAssignee(tx, auth, body.whoId!, i.projectId);
        const [who] = await tx.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, body.whoId!)).limit(1);
        const [g] = await tx.select({ title: s.goals.title }).from(s.goals).where(eq(s.goals.id, i.goalId)).limit(1);
        let stageId: string | null = null;
        if (i.projectId) {
          const [st] = await tx.select({ id: s.projectStages.id }).from(s.projectStages).where(and(eq(s.projectStages.projectId, i.projectId), sql`${s.projectStages.archivedAt} is null`, eq(s.projectStages.done, false))).orderBy(s.projectStages.position).limit(1);
          stageId = st?.id ?? null;
        }
        const [a] = await tx.insert(s.activities).values({
          tenantId: auth.tenantId, type: 'tarefa', title: `Plano: ${body.what}`, notes: actionTaskNotes({ ...body, whoName: who!.name }, g!.title), priority: 'alta',
          ownerId: body.whoId!, createdBy: auth.userId, dueAt: dueAtOf(auth, body.whenDue) as unknown as Date, status: 'a_fazer', category: 'Plano de ação', tags: ['intervenção'],
          participants: [...new Set([i.ownerId, auth.userId].filter((u) => u !== body.whoId))], projectId: i.projectId, projectStageId: stageId,
          position: stageId ? sql`coalesce((select max(position) + 1 from activities where project_stage_id = ${stageId}), 0)` as unknown as number : 0,
        }).returning({ id: s.activities.id });
        await taskEvent(tx, auth, a!.id, 'created', { delegatedTo: body.whoId !== auth.userId ? body.whoId : null, interventionId: i.id });
        const [act] = await tx.insert(s.interventionActions).values({ tenantId: auth.tenantId, interventionId: i.id, activityId: a!.id, what: body.what, why: body.why, rootCause: body.rootCause ?? null, where: body.where, how: body.how, howMuchCents: body.howMuchCents, createdBy: auth.userId }).returning({ id: s.interventionActions.id });
        await tx.update(s.interventions).set(bump).where(eq(s.interventions.id, i.id));
        await logIntervention(tx, auth.tenantId, i.id, 'acao_incluida', { what: body.what, whoId: body.whoId, whenDue: body.whenDue, taskId: a!.id }, [], auth.userId);
        return act!.id;
      });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/interventions/:id/actions/:actionId/cancel', summary: 'Cancela uma ação do plano (com motivo); a tarefa é cancelada junto', tag: 'Gestão de Times', module: 'resultados',
    params: z.object({ id: z.string().uuid(), actionId: z.string().uuid() }), body: z.object({ reason: z.string().trim().min(10).max(1000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele altera o plano.');
      if (!OPEN_INTERVENTION.includes(i.status as 'aberta')) throw unprocessable('A intervenção já foi encerrada.');
      const [a] = await tx.select().from(s.interventionActions).where(and(eq(s.interventionActions.id, params.actionId), eq(s.interventionActions.interventionId, i.id))).limit(1);
      if (!a) throw notFound('Ação não encontrada.');
      const [task] = await tx.select().from(s.activities).where(eq(s.activities.id, a.activityId)).limit(1).for('update');
      if (task!.status === 'concluida') throw unprocessable('A ação já foi executada; não dá para cancelar.');
      if (task!.status !== 'cancelada') await applyStatus(tx, auth, task!, 'cancelada', { note: body.reason });
      await tx.update(s.interventionActions).set({ cancelReason: body.reason }).where(eq(s.interventionActions.id, a.id));
      await logIntervention(tx, auth.tenantId, i.id, 'acao_cancelada', { what: a.what, reason: body.reason }, [task!.ownerId], auth.userId);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/interventions/:id/project', summary: 'Liga (ou desliga) o projeto que executa o plano; novas ações nascem como tarefas dele', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ projectId: z.string().uuid().nullable() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { i, sc } = await load(tx, auth, params.id, true);
      if (!canAct(sc, auth, i)) throw forbidden('Só o responsável pela intervenção ou quem está acima dele liga o projeto.');
      if (!OPEN_INTERVENTION.includes(i.status as 'aberta')) throw unprocessable('A intervenção já foi encerrada.');
      let name: string | null = null;
      if (body.projectId) {
        const { p, can } = await loadProject(tx, auth, body.projectId);
        if (!can.work) throw forbidden('Você precisa fazer parte da equipe do projeto para ligá-lo ao plano.');
        name = p.name;
      }
      await tx.update(s.interventions).set({ ...bump, projectId: body.projectId }).where(eq(s.interventions.id, i.id));
      await logIntervention(tx, auth.tenantId, i.id, body.projectId ? 'projeto_ligado' : 'projeto_desligado', { projectId: body.projectId, name }, [], auth.userId);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/interventions/sync', summary: 'Recalcula as intervenções pelas apurações vigentes (idempotente)', tag: 'Gestão de Times', module: 'resultados', min: 'total',
    handler: async ({ app, auth }) => syncInterventions(app.db, auth.tenantId, todayLocal(auth)),
  }),
];
