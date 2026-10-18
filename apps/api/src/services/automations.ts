/**
 * Automações das jornadas. Rodam depois que a ação do usuário foi gravada: uma automação que falha
 * nunca desfaz a ação principal; o resultado de cada uma fica em automation_runs.
 * Proteção contra laço: no máximo 3 níveis (ex.: perdida → duplica → criada → move …).
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { renderTemplate, type Automation, type AutomationAction } from '@isp/shared';
import type { Config } from '../config';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { brl, sendEmail, tenantName } from './email';
import { publicLink } from './alerts';

export type AutomationEvent = { type: 'criada' | 'entrou_na_etapa' | 'ganha' | 'perdida' | 'parada'; stage?: string; automationId?: string };
type Ctx = { db: DB; config: Config; tenantId: string; actorId: string | null; depth: number };

const MAX_DEPTH = 3;

async function loadOpp(db: DB, tenantId: string, id: string) {
  const [o] = await db
    .select({ opp: s.opportunities, contactName: s.contacts.name, contactPhone: s.contacts.phone, contactEmail: s.contacts.email, pipelineKey: s.pipelines.key, pipelineName: s.pipelines.name, planName: s.plans.name, ownerName: s.users.name, ownerEmail: s.users.email })
    .from(s.opportunities)
    .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
    .innerJoin(s.pipelines, eq(s.pipelines.id, s.opportunities.pipelineId))
    .innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId))
    .leftJoin(s.plans, eq(s.plans.id, s.opportunities.planId))
    .where(and(eq(s.opportunities.id, id), eq(s.opportunities.tenantId, tenantId)))
    .limit(1);
  return o ?? null;
}

export async function runAutomations(db: DB, config: Config, tenantId: string, actorId: string | null, opportunityId: string, event: AutomationEvent, depth = 0) {
  if (depth >= MAX_DEPTH) return [];
  const o = await loadOpp(db, tenantId, opportunityId);
  if (!o) return [];
  const autos = await db
    .select()
    .from(s.pipelineAutomations)
    .where(and(eq(s.pipelineAutomations.pipelineId, o.opp.pipelineId), eq(s.pipelineAutomations.active, true)))
    .orderBy(asc(s.pipelineAutomations.position));
  const matching = autos.filter((a) => {
    const t = a.trigger as Automation['gatilho'];
    if (event.automationId) return a.id === event.automationId;
    if (t.tipo !== event.type) return false;
    if (t.tipo === 'entrou_na_etapa') return t.etapa === event.stage;
    return true;
  });
  const results: { automation: string; status: string }[] = [];
  for (const a of matching) {
    const detail: Record<string, unknown>[] = [];
    let status: 'ok' | 'erro' = 'ok';
    for (const action of a.actions as AutomationAction[]) {
      try {
        detail.push({ action: action.tipo, ...(await execute({ db, config, tenantId, actorId, depth }, a.name, opportunityId, action)) });
      } catch (e) {
        status = 'erro';
        detail.push({ action: action.tipo, error: (e as Error).message.slice(0, 300) });
      }
    }
    await db.insert(s.automationRuns).values({ tenantId, automationId: a.id, opportunityId, status, detail: { event: event.type, stage: event.stage ?? null, actions: detail } });
    await db.insert(s.opportunityEvents).values({ tenantId, opportunityId, type: 'automation_ran', actorId, payload: { automation: a.name, status, actions: detail.map((d) => d.action) } });
    results.push({ automation: a.name, status });
  }
  return results;
}

async function execute(ctx: Ctx, automationName: string, opportunityId: string, action: AutomationAction): Promise<Record<string, unknown>> {
  const { db, tenantId } = ctx;
  const o = await loadOpp(db, tenantId, opportunityId);
  if (!o) throw new Error('Oportunidade não encontrada');
  const person = (v: string) => (v === 'dono' || v === 'mesmo' ? o.opp.ownerId : v);

  if (action.tipo === 'criar_tarefa') {
    const due = new Date(Date.now() + (action.prazoDias === 0 ? 2 * 3_600_000 : action.prazoDias * 86_400_000));
    const [a] = await db
      .insert(s.activities)
      .values({ tenantId, type: action.tipoAtividade, title: action.titulo, notes: `Criada pela automação “${automationName}”`, dueAt: due, priority: 'media', ownerId: person(action.responsavel), opportunityId, contactId: o.opp.contactId, createdBy: ctx.actorId })
      .returning({ id: s.activities.id });
    await db.insert(s.activityEvents).values({ tenantId, activityId: a!.id, type: 'created', actorId: ctx.actorId, payload: { automation: automationName } });
    return { activityId: a!.id };
  }

  if (action.tipo === 'enviar_email') {
    const vars = {
      'cliente.nome': o.contactName, 'cliente.telefone': o.contactPhone ?? '', 'responsavel.nome': o.ownerName, 'oportunidade.titulo': o.opp.title,
      'etapa.nome': o.opp.stage, 'jornada.nome': o.pipelineName, 'plano.nome': o.planName ?? '', 'plano.valor': brl(o.opp.valueCents),
      link: publicLink(ctx.config, `/opportunities/${opportunityId}`), 'empresa.nome': await tenantName(db, tenantId),
    };
    let to: string[] = [];
    if (action.para === 'cliente') to = o.contactEmail ? [o.contactEmail] : [];
    if (action.para === 'responsavel') to = [o.ownerEmail];
    if (action.para === 'gerencia') {
      const r = await db.execute<{ email: string }>(sql`select u.email from users u where u.tenant_id = ${tenantId} and u.active and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.key = 'gerencia')`);
      to = r.rows.map((x) => x.email);
    }
    if (!to.length) return { skipped: 'sem destinatário com e-mail' };
    const sent = [];
    for (const addr of to) {
      const r = await sendEmail(db, { tenantId, kind: 'automacao', to: addr, subject: renderTemplate(action.assunto, vars), text: renderTemplate(action.corpo, vars), opportunityId, createdBy: ctx.actorId });
      if (!r.ok) throw new Error(r.error);
      sent.push(addr);
    }
    return { sent };
  }

  if (action.tipo === 'mover_etapa') {
    if (['ganha', 'perdida'].includes(o.opp.stage)) return { skipped: 'oportunidade encerrada' };
    if (o.opp.stage === action.etapa) return { skipped: 'já está na etapa' };
    const [st] = await db.select().from(s.pipelineStages).where(and(eq(s.pipelineStages.pipelineId, o.opp.pipelineId), eq(s.pipelineStages.key, action.etapa), eq(s.pipelineStages.active, true), eq(s.pipelineStages.kind, 'open'))).limit(1);
    if (!st) throw new Error(`Etapa ${action.etapa} não existe nesta jornada`);
    const [u] = await db
      .update(s.opportunities)
      .set({ stage: st.key, stageChangedAt: new Date(), updatedAt: new Date(), rowVersion: sql`${s.opportunities.rowVersion} + 1` })
      .where(eq(s.opportunities.id, opportunityId))
      .returning({ rowVersion: s.opportunities.rowVersion });
    await db.insert(s.opportunityEvents).values({ tenantId, opportunityId, type: 'stage_changed', actorId: ctx.actorId, fromValue: o.opp.stage, toValue: st.key, reason: `Automação “${automationName}”`, rowVersion: u!.rowVersion });
    await runAutomations(db, ctx.config, tenantId, ctx.actorId, opportunityId, { type: 'entrou_na_etapa', stage: st.key }, ctx.depth + 1);
    return { to: st.key };
  }

  if (action.tipo === 'atribuir') {
    const ownerId = person(action.responsavel);
    const [u0] = await db.select({ id: s.users.id, active: s.users.active }).from(s.users).where(and(eq(s.users.id, ownerId), eq(s.users.tenantId, tenantId))).limit(1);
    if (!u0?.active) throw new Error('Responsável inativo ou inexistente');
    const [u] = await db.update(s.opportunities).set({ ownerId, updatedAt: new Date(), rowVersion: sql`${s.opportunities.rowVersion} + 1` }).where(eq(s.opportunities.id, opportunityId)).returning({ rowVersion: s.opportunities.rowVersion });
    await db.update(s.contacts).set({ ownerId }).where(eq(s.contacts.id, o.opp.contactId));
    await db.insert(s.opportunityEvents).values({ tenantId, opportunityId, type: 'assigned', actorId: ctx.actorId, payload: { changed: { ownerId: { from: o.opp.ownerId, to: ownerId } }, automation: automationName }, rowVersion: u!.rowVersion });
    return { ownerId };
  }

  if (action.tipo === 'duplicar') {
    const newId = await duplicateOpportunity(db, tenantId, ctx.actorId, opportunityId, action, automationName);
    await runAutomations(db, ctx.config, tenantId, ctx.actorId, newId, { type: 'criada' }, ctx.depth + 1);
    return { opportunityId: newId };
  }
  return {};
}

/** Cria uma cópia em outra jornada com todo o histórico: eventos, atividades, respostas e anexos. */
export async function duplicateOpportunity(db: DB, tenantId: string, actorId: string | null, sourceId: string, action: Extract<AutomationAction, { tipo: 'duplicar' }>, automationName: string) {
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(s.opportunities).where(and(eq(s.opportunities.id, sourceId), eq(s.opportunities.tenantId, tenantId))).limit(1);
    if (!src) throw new Error('Oportunidade de origem não encontrada');
    const [target] = await tx.select().from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.key, action.jornada), eq(s.pipelines.active, true))).limit(1);
    if (!target) throw new Error(`Jornada ${action.jornada} não existe ou está inativa`);
    const stages = await tx.select().from(s.pipelineStages).where(and(eq(s.pipelineStages.pipelineId, target.id), eq(s.pipelineStages.active, true), eq(s.pipelineStages.kind, 'open'))).orderBy(asc(s.pipelineStages.position));
    const stage = (action.etapa ? stages.find((x) => x.key === action.etapa) : stages[0]) ?? stages[0];
    if (!stage) throw new Error('Jornada de destino sem etapa aberta');
    const ownerId = action.responsavel === 'mesmo' || action.responsavel === 'dono' ? src.ownerId : action.responsavel;
    const { id: _id, code: _code, createdAt: _c, updatedAt: _u, rowVersion: _r, wonAt: _w, lostAt: _l, lossReason: _lr, ...rest } = src;
    const now = new Date();
    const [copy] = await tx
      .insert(s.opportunities)
      .values({ ...rest, pipelineId: target.id, stage: stage.key, ownerId, duplicatedFromId: src.id, stageChangedAt: now, sprintStartedAt: now, sprintElapsedSeconds: 0, contractRequestStatus: 'nao_solicitada', createdBy: actorId, title: src.title })
      .returning({ id: s.opportunities.id });
    const newId = copy!.id;
    // histórico: eventos com a data original
    const events = await tx.select().from(s.opportunityEvents).where(eq(s.opportunityEvents.opportunityId, src.id)).orderBy(asc(s.opportunityEvents.occurredAt));
    for (const e of events) {
      const { id: _e, opportunityId: _o, ...ev } = e;
      await tx.insert(s.opportunityEvents).values({ ...ev, opportunityId: newId, payload: { ...(ev.payload ?? {}), copiedFrom: src.id } });
    }
    await tx.insert(s.opportunityEvents).values({ tenantId, opportunityId: newId, type: 'duplicated_from', actorId, toValue: stage.key, payload: { from: src.id, automation: automationName }, rowVersion: 1 });
    await tx.insert(s.opportunityEvents).values({ tenantId, opportunityId: src.id, type: 'duplicated_to', actorId, payload: { to: newId, pipeline: target.name, automation: automationName } });
    // atividades (com seus eventos de criação)
    const acts = await tx.select().from(s.activities).where(and(eq(s.activities.opportunityId, src.id), isNull(s.activities.deletedAt)));
    for (const a of acts) {
      const { id: _a, rowVersion: _rv, ...act } = a;
      await tx.insert(s.activities).values({ ...act, opportunityId: newId });
    }
    const answers = await tx.select().from(s.opportunityAnswers).where(eq(s.opportunityAnswers.opportunityId, src.id));
    if (answers.length) await tx.insert(s.opportunityAnswers).values(answers.map((x) => ({ ...x, opportunityId: newId })));
    const files = await tx.select().from(s.opportunityAttachments).where(and(eq(s.opportunityAttachments.opportunityId, src.id), isNull(s.opportunityAttachments.deletedAt)));
    for (const f of files) {
      const { id: _f, ...file } = f;
      await tx.insert(s.opportunityAttachments).values({ ...file, opportunityId: newId });
    }
    return newId;
  });
}

/** Gatilho "parada": roda uma vez por entrada na etapa, quando passa do número de dias. Chamado pelo agendamento. */
export async function runIdleAutomations(db: DB, config: Config) {
  const autos = await db.select().from(s.pipelineAutomations).where(and(eq(s.pipelineAutomations.active, true), sql`${s.pipelineAutomations.trigger}->>'tipo' = 'parada'`));
  let ran = 0;
  for (const a of autos) {
    const t = a.trigger as Automation['gatilho'];
    const days = t.dias ?? 0;
    if (!days) continue;
    const rows = await db.execute<{ id: string }>(sql`
      select o.id from opportunities o
      where o.pipeline_id = ${a.pipelineId} and o.deleted_at is null and o.stage not in ('ganha','perdida')
        ${t.etapa ? sql`and o.stage = ${t.etapa}` : sql``}
        and o.stage_changed_at < now() - (${days} || ' days')::interval
        and not exists (select 1 from automation_runs r where r.automation_id = ${a.id} and r.opportunity_id = o.id and r.created_at > o.stage_changed_at)
      limit 500`);
    for (const r of rows.rows) {
      await runAutomations(db, config, a.tenantId, null, r.id, { type: 'parada', automationId: a.id });
      ran++;
    }
  }
  return { idle: ran };
}
