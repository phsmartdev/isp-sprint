/** Oportunidade → Pontos da jornada: tarefas da jornada (peso, situação, quem concluiu) e o peso do ganho. */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { componentRef, journeyCredits, parseComponentRef } from '@isp/domain';
import { defineRoute } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { loadOpportunity } from '../services/opportunities';
import { approvedJourneys } from '../services/scoreJourneys';

const OppParams = z.object({ id: z.string().uuid() });

export const scoreJourneyRoutes = [
  defineRoute({
    method: 'GET', url: '/opportunities/:id/score', summary: 'Pontos da jornada da oportunidade: cada tarefa com peso, situação e quem concluiu; peso do ganho e a divisão', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const journeys = await approvedJourneys(app.db, auth.tenantId);
      const j = journeys.find((x) => x.pipelineId === opp.pipelineId);
      if (!j) return { journey: null };
      const tasks = await app.db.select({ id: s.activities.id, title: s.activities.title, ref: s.activities.scoreComponent, completedAt: s.activities.completedAt, dueAt: s.activities.dueAt, completedBy: s.activities.completedBy, ownerId: s.activities.ownerId })
        .from(s.activities).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.opportunityId, opp.id), isNull(s.activities.deletedAt))).orderBy(asc(s.activities.createdAt));
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const name = (u: string | null) => users.find((x) => x.id === u)?.name ?? null;
      const mine = tasks.filter((t) => t.ref && parseComponentRef(t.ref)?.journeyKey === j.key);
      const done = mine.filter((t) => t.completedAt).map((t) => ({ opportunityId: opp.id, ref: t.ref!, userId: t.completedBy ?? t.ownerId, inPeriod: true }));
      const won = opp.stage === 'ganha';
      const credits = journeyCredits([j], done, won ? [{ opportunityId: opp.id, pipelineId: opp.pipelineId, ownerId: opp.ownerId }] : []);
      const winShare = credits.filter((c) => c.source === 'ganho').map((c) => ({ userId: c.userId, name: name(c.userId), points: c.points }));
      return {
        journey: { key: j.key, name: j.name, wonPoints: j.wonPoints },
        components: j.components.map((c) => {
          const ts = mine.filter((t) => t.ref === componentRef(j.key, c.key));
          const t = ts.find((x) => x.completedAt) ?? ts[0] ?? null;
          return { key: c.key, name: c.name, stageKey: c.stageKey, points: c.points, task: t ? { id: t.id, title: t.title, done: !!t.completedAt, completedAt: t.completedAt, dueAt: t.dueAt, by: name(t.completedAt ? t.completedBy ?? t.ownerId : t.ownerId) } : null };
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
];
