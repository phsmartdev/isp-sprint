/** Jornadas de pontuação: cria as tarefas da etapa e calcula os créditos (tarefas concluídas e ganhos) pela situação atual do CRM. */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { componentRef, componentsForStage, journeyCredits, levelFor, type ExtraPoints, type GamificationSettings, type JourneyContext, type JourneyCredit, type ScoreJourney } from '@isp/domain';
import { vacationOrg } from './vacations';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { gamificationSettingsOf } from './gamification';

export async function approvedJourneys(db: DbOrTx, tenantId: string): Promise<ScoreJourney[]> {
  const { settings } = await gamificationSettingsOf(db, tenantId);
  return settings?.journeys ?? [];
}

/**
 * Quando a oportunidade nasce ou entra numa etapa, cria as tarefas da jornada daquela etapa (uma por componente, sem repetir),
 * para o responsável pela oportunidade, com o prazo do componente. Só com regra aprovada.
 */
export async function ensureJourneyTasks(db: DbOrTx, tenantId: string, actorId: string | null, opportunityId: string, opts: { stage: string | null; creation: boolean }) {
  const journeys = await approvedJourneys(db, tenantId);
  if (!journeys.length) return [];
  const [opp] = await db.select({ id: s.opportunities.id, pipelineId: s.opportunities.pipelineId, ownerId: s.opportunities.ownerId, contactId: s.opportunities.contactId, stage: s.opportunities.stage })
    .from(s.opportunities).where(and(eq(s.opportunities.id, opportunityId), eq(s.opportunities.tenantId, tenantId), isNull(s.opportunities.deletedAt))).limit(1);
  const j = opp && journeys.find((x) => x.pipelineId === opp.pipelineId);
  if (!opp || !j) return [];
  const comps = componentsForStage(j, opts.stage ?? opp.stage, opts.creation);
  const created: string[] = [];
  for (const c of comps) {
    const ref = componentRef(j.key, c.key);
    const [exists] = await db.select({ id: s.activities.id }).from(s.activities)
      .where(and(eq(s.activities.tenantId, tenantId), eq(s.activities.opportunityId, opportunityId), eq(s.activities.scoreComponent, ref), isNull(s.activities.deletedAt))).limit(1);
    if (exists) continue;
    const due = new Date(Date.now() + (c.dueDays === 0 ? 2 * 3_600_000 : c.dueDays * 86_400_000));
    const [a] = await db.insert(s.activities).values({ tenantId, type: 'tarefa', title: c.name, notes: `Tarefa da jornada “${j.name}” (${c.points} pts)`, dueAt: due, priority: 'media', ownerId: opp.ownerId, opportunityId, contactId: opp.contactId, createdBy: actorId, category: 'Jornada', scoreComponent: ref })
      .returning({ id: s.activities.id });
    await db.insert(s.activityEvents).values({ tenantId, activityId: a!.id, type: 'created', actorId, payload: { journey: j.name, component: c.name, points: c.points } });
    created.push(a!.id);
  }
  return created;
}

/** Contexto de níveis e bônus da regra: nível de cada pessoa (cadastrado ou padrão; padrão da liderança para quem lidera time). */
export async function journeyContext(db: DbOrTx, tenantId: string, st: GamificationSettings): Promise<JourneyContext> {
  const org = await vacationOrg(db, tenantId);
  const leads = new Set(Object.values(org.leads).flat());
  return {
    onTimeBp: st.bonuses.onTimeBp, adherenceBp: st.bonuses.adherenceBp, extraPerLevelBp: st.bonuses.extraPerLevelBp,
    rankOfUser: (u) => levelFor(st, u, leads.has(u)).rank,
    rankOfLevel: (k) => st.competencyLevels.find((l) => l.key === k)?.rank ?? null,
  };
}

/** Créditos das jornadas no período (data local da empresa): tarefas concluídas no período (com bônus e alçada) e negócios ganhos no período. */
export async function journeyCreditsBetween(db: DbOrTx, tenantId: string, from: string, to: string, tz: string, st: GamificationSettings): Promise<JourneyCredit[]> {
  const journeys: ScoreJourney[] = st.journeys ?? [];
  if (!journeys.length) return [];
  const pipes = journeys.map((j) => j.pipelineId);
  const wins = await db.execute<{ id: string; pipeline_id: string; owner_id: string }>(sql`
    select o.id, o.pipeline_id, o.owner_id from opportunities o
     where o.tenant_id = ${tenantId} and o.deleted_at is null and o.stage = 'ganha' and o.won_at is not null and o.pipeline_id in ${pipes}
       and (o.won_at at time zone ${tz})::date between ${from}::date and ${to}::date`);
  const winIds = wins.rows.map((w) => w.id);
  const tasks = await db.execute<{ id: string; opportunity_id: string; ref: string; user_id: string; in_period: boolean; on_time: boolean; approved: boolean }>(sql`
    select a.id, a.opportunity_id, a.score_component as ref, coalesce(a.completed_by, a.owner_id) as user_id,
           (a.due_at is not null and a.completed_at <= a.due_at) as on_time, (a.qualification = 'aprovada') as approved,
           ((a.completed_at at time zone ${tz})::date between ${from}::date and ${to}::date) as in_period
      from activities a join opportunities o on o.id = a.opportunity_id and o.deleted_at is null
     where a.tenant_id = ${tenantId} and a.deleted_at is null and a.completed_at is not null and a.score_component is not null
       and (((a.completed_at at time zone ${tz})::date between ${from}::date and ${to}::date) ${winIds.length ? sql`or a.opportunity_id in ${winIds}` : sql``})`);
  const ctx = await journeyContext(db, tenantId, st);
  return journeyCredits(journeys, tasks.rows.map((t) => ({ taskId: t.id, opportunityId: t.opportunity_id, ref: t.ref, userId: t.user_id, inPeriod: t.in_period, onTime: t.on_time, approved: t.approved })), wins.rows.map((w) => ({ opportunityId: w.id, pipelineId: w.pipeline_id, ownerId: w.owner_id })), ctx);
}

export const asExtra = (cs: JourneyCredit[]): ExtraPoints[] => cs.map((c) => ({ userId: c.userId, points: c.points, extra: c.extra }));
