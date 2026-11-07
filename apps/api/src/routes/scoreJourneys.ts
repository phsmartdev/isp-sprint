/** Oportunidade → Pontos da jornada: tarefas da jornada (peso, situação, quem concluiu) e o peso do ganho. */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { componentRef, journeyCredits, parseComponentRef } from '@isp/domain';
import { forbidden } from '../http/errors';
import { level } from '../services/scope';
import { gamificationSettingsOf } from '../services/gamification';
import { leadersOf, vacationOrg } from '../services/vacations';
import { defineRoute } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { loadOpportunity } from '../services/opportunities';
import { approvedJourneys, journeyContext } from '../services/scoreJourneys';

const OppParams = z.object({ id: z.string().uuid() });

export const scoreJourneyRoutes = [
  defineRoute({
    method: 'GET', url: '/opportunities/:id/score', summary: 'Pontos da jornada da oportunidade: cada tarefa com peso, situação e quem concluiu; peso do ganho e a divisão', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const { settings } = await gamificationSettingsOf(app.db, auth.tenantId);
      const j = settings?.journeys.find((x) => x.pipelineId === opp.pipelineId);
      if (!settings || !j) return { journey: null };
      const ctx = await journeyContext(app.db, auth.tenantId, settings);
      const org = await vacationOrg(app.db, auth.tenantId);
      const tasks = await app.db.select({ id: s.activities.id, title: s.activities.title, ref: s.activities.scoreComponent, completedAt: s.activities.completedAt, dueAt: s.activities.dueAt, completedBy: s.activities.completedBy, ownerId: s.activities.ownerId, qualification: s.activities.qualification })
        .from(s.activities).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.opportunityId, opp.id), isNull(s.activities.deletedAt))).orderBy(asc(s.activities.createdAt));
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const name = (u: string | null) => users.find((x) => x.id === u)?.name ?? null;
      const mine = tasks.filter((t) => t.ref && parseComponentRef(t.ref)?.journeyKey === j.key);
      const done = mine.filter((t) => t.completedAt).map((t) => ({ taskId: t.id, opportunityId: opp.id, ref: t.ref!, userId: t.completedBy ?? t.ownerId, inPeriod: true, onTime: !!t.dueAt && t.completedAt! <= t.dueAt, approved: t.qualification === 'aprovada' }));
      const won = opp.stage === 'ganha';
      const credits = journeyCredits([j], done, won ? [{ opportunityId: opp.id, pipelineId: opp.pipelineId, ownerId: opp.ownerId }] : [], ctx);
      // qualificar (opcional): a gerência e a liderança de quem concluiu; nunca quem concluiu
      const canQualify = (doer: string) => doer !== auth.userId && (level(auth, 'resultados') === 'total' || leadersOf(org, doer).includes(auth.userId));
      const winShare = credits.filter((c) => c.source === 'ganho').map((c) => ({ userId: c.userId, name: name(c.userId), points: c.points }));
      return {
        journey: { key: j.key, name: j.name, wonPoints: j.wonPoints },
        components: j.components.map((c) => {
          const ts = mine.filter((t) => t.ref === componentRef(j.key, c.key));
          const t = ts.find((x) => x.completedAt) ?? ts[0] ?? null;
          const cr = t ? credits.find((x) => x.taskId === t.id) : null;
          const doer = t ? (t.completedAt ? t.completedBy ?? t.ownerId : t.ownerId) : null;
          return {
            key: c.key, name: c.name, stageKey: c.stageKey, points: c.points, level: c.level ? settings.competencyLevels.find((l) => l.key === c.level)?.name ?? null : null,
            task: t ? { id: t.id, title: t.title, done: !!t.completedAt, completedAt: t.completedAt, dueAt: t.dueAt, by: name(doer), qualification: t.qualification, canQualify: !!t.completedAt && canQualify(doer!), earned: cr?.points ?? 0, extra: cr?.extra ?? false, bonus: cr?.bonus ?? null } : null,
          };
        }),
        earned: Math.round(credits.reduce((a, c) => a + c.points, 0) * 10) / 10,
        won, winShare,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/score/tasks', summary: 'Cria à mão a tarefa de um componente da jornada (quando a etapa já passou ou a tarefa foi excluída)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    body: z.object({ componentKey: z.string().max(40) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const j = (await approvedJourneys(app.db, auth.tenantId)).find((x) => x.pipelineId === opp.pipelineId);
      const c = j?.components.find((x) => x.key === body.componentKey);
      if (!j || !c) throw notFound('Tarefa da jornada não encontrada.');
      const ref = componentRef(j.key, c.key);
      const [exists] = await app.db.select({ id: s.activities.id }).from(s.activities).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.opportunityId, opp.id), eq(s.activities.scoreComponent, ref), isNull(s.activities.deletedAt))).limit(1);
      if (exists) throw unprocessable('Esta tarefa da jornada já existe na oportunidade.');
      const due = new Date(Date.now() + (c.dueDays === 0 ? 2 * 3_600_000 : c.dueDays * 86_400_000));
      const [a] = await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type: 'tarefa', title: c.name, notes: `Tarefa da jornada “${j.name}” (${c.points} pts)`, dueAt: due, priority: 'media', ownerId: auth.userId, opportunityId: opp.id, contactId: opp.contactId, createdBy: auth.userId, category: 'Jornada', scoreComponent: ref }).returning({ id: s.activities.id });
      await app.db.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: a!.id, type: 'created', actorId: auth.userId, payload: { journey: j.name, component: c.name, points: c.points } });
      reply.code(201);
      return { id: a!.id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/score/tasks/:taskId/qualify', summary: 'Qualifica (opcional) a tarefa da jornada concluída: aprovada dá bônus de aderência; reprovada não tira pontos; null limpa', tag: 'Oportunidades', module: 'oportunidades',
    params: z.object({ id: z.string().uuid(), taskId: z.string().uuid() }), body: z.object({ result: z.enum(['aprovada', 'reprovada']).nullable() }),
    handler: async ({ app, auth, params, body }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const [t] = await app.db.select().from(s.activities).where(and(eq(s.activities.id, params.taskId), eq(s.activities.tenantId, auth.tenantId), eq(s.activities.opportunityId, opp.id), isNull(s.activities.deletedAt))).limit(1);
      if (!t || !t.scoreComponent) throw notFound('Tarefa da jornada não encontrada.');
      if (!t.completedAt) throw unprocessable('Só tarefa concluída pode ser qualificada.');
      const doer = t.completedBy ?? t.ownerId;
      const org = await vacationOrg(app.db, auth.tenantId);
      if (doer === auth.userId || !(level(auth, 'resultados') === 'total' || leadersOf(org, doer).includes(auth.userId))) throw forbidden('Só a gerência ou a liderança de quem concluiu qualifica a tarefa.');
      await app.db.update(s.activities).set({ qualification: body.result, qualifiedBy: body.result ? auth.userId : null, qualifiedAt: body.result ? new Date() : null, updatedAt: new Date() }).where(eq(s.activities.id, t.id));
      await app.db.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: t.id, type: 'qualified', actorId: auth.userId, payload: { result: body.result } });
      return { qualification: body.result };
    },
  }),
];
