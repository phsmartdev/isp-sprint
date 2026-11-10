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

/**
 * Pontos que UMA pessoa ganhou nesta oportunidade até agora (todas as datas): tarefas da jornada que ela concluiu
 * (com bônus e alçada), a parte dela no ganho, eventos de negócio da oportunidade em que tem crédito
 * e apoios confirmados ligados à oportunidade. Mesma regra aprovada da gamificação.
 */
export async function opportunityPointsFor(db: DbOrTx, tenantId: string, st: GamificationSettings, opportunityId: string, userId: string) {
  const journeys: ScoreJourney[] = st.journeys ?? [];
  const [o] = (await db.execute<{ id: string; pipeline_id: string; owner_id: string; won: boolean }>(sql`select id, pipeline_id, owner_id, (stage = 'ganha' and won_at is not null) won from opportunities where id = ${opportunityId} and tenant_id = ${tenantId}`)).rows;
  if (!o) return null;
  let tasks = 0, extra = 0, win = 0;
  if (journeys.some((j) => j.pipelineId === o.pipeline_id)) {
    const rows = (await db.execute<{ id: string; ref: string; user_id: string; on_time: boolean; approved: boolean }>(sql`
      select a.id, a.score_component as ref, coalesce(a.completed_by, a.owner_id) as user_id, (a.due_at is not null and a.completed_at <= a.due_at) as on_time, (a.qualification = 'aprovada') as approved
        from activities a where a.tenant_id = ${tenantId} and a.opportunity_id = ${opportunityId} and a.deleted_at is null and a.completed_at is not null and a.score_component is not null`)).rows;
    const ctx = await journeyContext(db, tenantId, st);
    const credits = journeyCredits(journeys, rows.map((t) => ({ taskId: t.id, opportunityId, ref: t.ref, userId: t.user_id, inPeriod: true, onTime: t.on_time, approved: t.approved })), o.won ? [{ opportunityId, pipelineId: o.pipeline_id, ownerId: o.owner_id }] : [], ctx);
    for (const c of credits.filter((x) => x.userId === userId)) { if (c.source === 'ganho') win += c.points; else if (c.extra) extra += c.points; else tasks += c.points; }
  }
  // eventos de negócio da oportunidade (dela, das tarefas e do contrato) com crédito da pessoa
  const ev = (await db.execute<{ type: string; kind: string; share: number }>(sql`
    select e.type, c.kind, sum(c.share_bp)::int share from business_events e join business_event_credits c on c.event_id = e.id
     where e.tenant_id = ${tenantId} and e.validation = 'valido' and c.user_id = ${userId}
       and ((e.source_type = 'opportunity' and e.source_id = ${opportunityId})
         or (e.source_type = 'activity' and e.source_id in (select id from activities where opportunity_id = ${opportunityId}))
         or (e.source_type = 'contract' and e.source_id in (select id from contracts where opportunity_id = ${opportunityId})))
     group by e.type, c.kind`)).rows;
  let direct = 0, participation = 0;
  for (const r of ev) {
    const pts = st.points[r.type as keyof typeof st.points] ?? 0;
    if (!pts) continue;
    if (r.kind === 'direto') direct += (pts * r.share) / 10_000;
    else if (r.kind === 'participacao') participation += (pts * r.share * st.participationMultiplierBp) / 10_000 / 10_000;
  }
  // apoios confirmados ligados à oportunidade (sem o teto mensal, que vale na nota do mês)
  let support = 0;
  if (st.support) {
    const sp = (await db.execute<{ requester_id: string; helper_id: string | null; task_points: number | null }>(sql`
      select requester_id, helper_id, task_points from support_requests where tenant_id = ${tenantId} and status = 'confirmado' and entity_type = 'opportunity' and entity_id = ${opportunityId}`)).rows;
    for (const r of sp) {
      if (r.helper_id === userId) support += ((r.task_points ?? st.support.basePoints) * st.support.helperMultiplierBp) / 10_000;
      if (r.requester_id === userId) support += st.support.requesterPoints;
    }
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const parts = { tarefas: r1(tasks), extra: r1(extra), ganho: r1(win), eventos: r1(direct), participacao: r1(participation), apoio: r1(support) };
  return { total: r1(Object.values(parts).reduce((a, b) => a + b, 0)), parts };
}
