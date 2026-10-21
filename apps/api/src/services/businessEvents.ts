/**
 * Projetor de eventos de negócio (Etapa 5). Lê as tabelas de origem e grava os fatos de forma idempotente
 * (chave por tipo + registro + instante). Quando a origem é desfeita (oportunidade reaberta, tarefa reaberta…),
 * o evento antigo é invalidado com registro no histórico; se o fato acontecer de novo, nasce outro evento.
 * O mesmo código faz a carga histórica (backfill) e a atualização incremental.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { DEFAULT_PERFORMANCE_CONFIG, computeCredits, eventTypeDef, type BusinessEventType, type PerformanceConfig } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

type Candidate = {
  key: string; type: BusinessEventType; sourceType: string; sourceId: string; ownerId: string | null; participants: string[];
  occurredAt: Date; valueCents: number | null; quantity: number | null; outcome: string | null; context: Record<string, unknown>;
};

export async function performanceConfig(db: DbOrTx, tenantId: string): Promise<{ version: number; config: PerformanceConfig }> {
  const [r] = await db.select().from(s.performanceSettings).where(eq(s.performanceSettings.tenantId, tenantId)).orderBy(desc(s.performanceSettings.version)).limit(1);
  if (!r) return { version: 0, config: DEFAULT_PERFORMANCE_CONFIG };
  return { version: r.version, config: { ...DEFAULT_PERFORMANCE_CONFIG, ...r.config, attribution: { ...DEFAULT_PERFORMANCE_CONFIG.attribution, ...r.config.attribution } } };
}

const rows = async <T>(db: DbOrTx, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];
type Raw = { key: string; source_id: string; owner_id: string | null; participants: string[] | null; occurred_at: Date | string; value_cents: string | number | null; quantity: number | null; outcome: string | null; context: Record<string, unknown> | null };
const toCand = (type: BusinessEventType, sourceType: string) => (r: Raw): Candidate => ({
  key: r.key, type, sourceType, sourceId: r.source_id, ownerId: r.owner_id, participants: (r.participants ?? []).filter(Boolean), occurredAt: new Date(r.occurred_at),
  valueCents: r.value_cents === null || r.value_cents === undefined ? null : Number(r.value_cents), quantity: r.quantity ?? null, outcome: r.outcome ?? null, context: r.context ?? {},
});

/** Fatos atuais de cada tipo (o que deveria existir como evento válido agora). Só lê; não inventa dado ausente. */
async function candidates(db: DbOrTx, t: string): Promise<Candidate[]> {
  const notExists = (key: ReturnType<typeof sql>) => sql`not exists (select 1 from business_events be where be.tenant_id = ${t} and be.idem_key = ${key})`;
  const out: Candidate[] = [];
  const add = async (type: BusinessEventType, sourceType: string, q: ReturnType<typeof sql>) => out.push(...(await rows<Raw>(db, q)).map(toCand(type, sourceType)));

  // comercial
  await add('oportunidade_criada', 'opportunity', sql`
    select 'oportunidade_criada:' || o.id as key, o.id as source_id, o.owner_id, null::uuid[] as participants, o.created_at as occurred_at, o.value_cents, null::int as quantity, o.stage as outcome,
           jsonb_build_object('pipelineId', o.pipeline_id, 'leadId', o.lead_id, 'saleType', o.sale_type, 'teamId', o.team_id) as context
      from opportunities o where o.tenant_id = ${t} and o.deleted_at is null and o.duplicated_from_id is null and ${notExists(sql`'oportunidade_criada:' || o.id`)}`);
  await add('lead_qualificado', 'lead', sql`
    select 'lead_qualificado:' || l.id as key, l.id as source_id, l.owner_id, null::uuid[] as participants, o.created_at as occurred_at, null::bigint as value_cents, null::int as quantity, null as outcome,
           jsonb_build_object('opportunityId', o.id, 'channel', l.channel) as context
      from leads l join opportunities o on o.id = l.converted_opportunity_id
     where l.tenant_id = ${t} and l.deleted_at is null and ${notExists(sql`'lead_qualificado:' || l.id`)}`);
  await add('proposta_enviada', 'opportunity', sql`
    select distinct on (e.opportunity_id) 'proposta_enviada:' || e.opportunity_id as key, e.opportunity_id as source_id, o.owner_id, case when e.actor_id is not null and e.actor_id <> o.owner_id then array[e.actor_id] else null end as participants,
           e.occurred_at, o.value_cents, null::int as quantity, e.type as outcome, jsonb_build_object('channel', e.type) as context
      from opportunity_events e join opportunities o on o.id = e.opportunity_id
     where e.tenant_id = ${t} and o.deleted_at is null and (e.type = 'whatsapp_sent' or (e.type = 'email_sent' and e.payload->>'kind' = 'proposta'))
       and ${notExists(sql`'proposta_enviada:' || e.opportunity_id`)}
     order by e.opportunity_id, e.occurred_at`);
  for (const [type, stage, col] of [['negociacao_ganha', 'ganha', 'won_at'], ['negociacao_perdida', 'perdida', 'lost_at']] as const) {
    const key = sql`${sql.raw(`'${type}:'`)} || o.id || ':' || (extract(epoch from o.${sql.raw(col)}) * 1000)::bigint`;
    await add(type, 'opportunity', sql`
      select ${key} as key, o.id as source_id, o.owner_id, null::uuid[] as participants, o.${sql.raw(col)} as occurred_at, o.value_cents, null::int as quantity, o.loss_reason as outcome,
             jsonb_build_object('pipelineId', o.pipeline_id, 'saleType', o.sale_type, 'marginCents', o.margin_cents, 'createdAt', o.created_at, 'teamId', o.team_id) as context
        from opportunities o where o.tenant_id = ${t} and o.deleted_at is null and o.stage = ${stage} and o.${sql.raw(col)} is not null and ${notExists(key)}`);
  }
  // aprovações: o trabalho de decidir é de quem decidiu; quem pediu participa
  await add('aprovacao_concluida', 'approval_request', sql`
    select 'aprovacao_concluida:' || d.id as key, d.request_id as source_id, d.decided_by as owner_id, array[r.requested_by] as participants, d.created_at as occurred_at, r.proposed_monthly_cents as value_cents, null::int as quantity, d.decision as outcome,
           jsonb_build_object('opportunityId', d.opportunity_id, 'level', d.level, 'hoursToDecide', round(extract(epoch from (d.created_at - r.created_at)) / 3600.0, 1)) as context
      from approval_decisions d join approval_requests r on r.id = d.request_id
     where d.tenant_id = ${t} and d.decided_by is not null and d.decision <> 'substituida' and ${notExists(sql`'aprovacao_concluida:' || d.id`)}`);
  // contratos
  await add('venda_validada', 'contract', sql`
    select 'venda_validada:' || c.id as key, c.id as source_id, coalesce(c.commercial_owner_id, c.validated_by) as owner_id, case when c.validated_by is not null and c.validated_by <> coalesce(c.commercial_owner_id, c.validated_by) then array[c.validated_by] else null end as participants,
           c.validated_at as occurred_at, v.monthly_cents as value_cents, null::int as quantity, c.billing_type as outcome, jsonb_build_object('opportunityId', c.opportunity_id, 'arpId', c.arp_id) as context
      from contracts c left join contract_versions v on v.contract_id = c.id and v.version = c.current_version
     where c.tenant_id = ${t} and c.validated_at is not null and ${notExists(sql`'venda_validada:' || c.id`)}`);
  await add('contrato_assinado', 'contract', sql`
    select 'contrato_assinado:' || g.id as key, c.id as source_id, coalesce(c.commercial_owner_id, g.created_by) as owner_id, null::uuid[] as participants, g.updated_at as occurred_at, null::bigint as value_cents, null::int as quantity, g.provider as outcome,
           jsonb_build_object('signatureId', g.id) as context
      from contract_signatures g join contracts c on c.id = g.contract_id
     where g.tenant_id = ${t} and g.status = 'assinado' and ${notExists(sql`'contrato_assinado:' || g.id`)}`);
  await add('contrato_renovado', 'contract_process', sql`
    select 'contrato_renovado:' || p.id as key, p.id as source_id, coalesce(p.owner_id, p.closed_by) as owner_id, case when p.closed_by is not null and p.closed_by <> p.owner_id then array[p.closed_by] else null end as participants,
           p.closed_at as occurred_at, null::bigint as value_cents, null::int as quantity, p.outcome, jsonb_build_object('contractId', p.contract_id, 'dueAt', p.due_at, 'onTime', p.due_at is null or p.closed_at::date <= p.due_at) as context
      from contract_processes p where p.tenant_id = ${t} and p.kind = 'renovacao' and p.status = 'concluido' and p.closed_at is not null and ${notExists(sql`'contrato_renovado:' || p.id`)}`);
  await add('processo_contrato_concluido', 'contract_process', sql`
    select 'processo_contrato_concluido:' || p.id as key, p.id as source_id, coalesce(p.owner_id, p.closed_by) as owner_id, case when p.closed_by is not null and p.closed_by <> p.owner_id then array[p.closed_by] else null end as participants,
           p.closed_at as occurred_at, null::bigint as value_cents, null::int as quantity, p.kind as outcome, jsonb_build_object('contractId', p.contract_id, 'kind', p.kind, 'dueAt', p.due_at, 'onTime', p.due_at is null or p.closed_at::date <= p.due_at) as context
      from contract_processes p where p.tenant_id = ${t} and p.kind <> 'renovacao' and p.status = 'concluido' and p.closed_at is not null and ${notExists(sql`'processo_contrato_concluido:' || p.id`)}`);
  // atas (o valor movimentado não vira mérito: quantidade fica no contexto, não no valor)
  await add('movimentacao_ata_autorizada', 'arp_operation', sql`
    select 'movimentacao_ata_autorizada:' || op.id as key, op.id as source_id, op.requested_by as owner_id, array_remove(array[op.decided_by, op.effected_by], op.requested_by) as participants,
           op.effected_at as occurred_at, null::bigint as value_cents, null::int as quantity, op.kind as outcome, jsonb_build_object('arpId', op.arp_id, 'kind', op.kind) as context
      from arp_operations op where op.tenant_id = ${t} and op.status = 'efetivada' and op.effected_at is not null and ${notExists(sql`'movimentacao_ata_autorizada:' || op.id`)}`);
  await add('adesao_ata_autorizada', 'arp_adhesion', sql`
    select 'adesao_ata_autorizada:' || a.id as key, a.id as source_id, coalesce(a.authorized_by, a.created_by) as owner_id, case when a.created_by is not null and a.created_by <> a.authorized_by then array[a.created_by] else null end as participants,
           coalesce(a.manager_authorized_at, a.authorized_on::timestamptz) as occurred_at, null::bigint as value_cents, null::int as quantity, null as outcome, jsonb_build_object('arpId', a.arp_id, 'opportunityId', a.opportunity_id) as context
      from arp_adhesions a where a.tenant_id = ${t} and a.status in ('autorizada', 'contratada') and (a.manager_authorized_at is not null or a.authorized_on is not null) and ${notExists(sql`'adesao_ata_autorizada:' || a.id`)}`);
  // tarefas: no prazo, criada pela própria pessoa e tempo entre criar e concluir ficam no contexto (anti-tarefa artificial)
  const taskKey = sql`'tarefa_concluida:' || a.id || ':' || (extract(epoch from a.completed_at) * 1000)::bigint`;
  await add('tarefa_concluida', 'activity', sql`
    select ${taskKey} as key, a.id as source_id, a.owner_id, a.participants, a.completed_at as occurred_at, null::bigint as value_cents, null::int as quantity, null as outcome,
           jsonb_build_object('projectId', a.project_id, 'parentId', a.parent_id, 'priority', a.priority, 'hadDue', a.due_at is not null,
             'onTime', a.due_at is null or a.completed_at <= a.due_at + interval '6 hours',
             'selfCreated', a.created_by = a.owner_id, 'minutesToComplete', round(extract(epoch from (a.completed_at - a.created_at)) / 60.0),
             'approved', a.approved_at is not null, 'checklist', jsonb_array_length(a.checklist)) as context
      from activities a where a.tenant_id = ${t} and a.type = 'tarefa' and a.deleted_at is null and a.completed_at is not null and a.cs_kind is null and ${notExists(taskKey)}`);
  const appKey = sql`'entrega_validada:' || a.id || ':' || (extract(epoch from a.approved_at) * 1000)::bigint`;
  await add('entrega_validada', 'activity', sql`
    select ${appKey} as key, a.id as source_id, a.owner_id, a.participants, a.approved_at as occurred_at, null::bigint as value_cents, null::int as quantity, null as outcome,
           jsonb_build_object('approverId', a.approved_by, 'projectId', a.project_id) as context
      from activities a where a.tenant_id = ${t} and a.deleted_at is null and a.approved_at is not null and a.completed_at is not null and ${notExists(appKey)}`);
  const csKey = sql`'acompanhamento_registrado:' || a.id || ':' || (extract(epoch from a.completed_at) * 1000)::bigint`;
  await add('acompanhamento_registrado', 'activity', sql`
    select ${csKey} as key, a.id as source_id, a.owner_id, null::uuid[] as participants, a.completed_at as occurred_at, null::bigint as value_cents, null::int as quantity, a.cs_kind as outcome,
           jsonb_build_object('contactId', a.contact_id, 'plannedAt', a.cs_planned_at, 'weight', a.cs_weight, 'onTime', a.cs_planned_at is null or a.completed_at::date <= a.cs_planned_at + 3) as context
      from activities a where a.tenant_id = ${t} and a.deleted_at is null and a.cs_kind is not null and a.completed_at is not null and coalesce(a.cs_result, '') <> '' and ${notExists(csKey)}`);
  // projetos
  const msKey = sql`'marco_concluido:' || m.id || ':' || (extract(epoch from m.completed_at) * 1000)::bigint`;
  await add('marco_concluido', 'project_milestone', sql`
    select ${msKey} as key, m.id as source_id, p.owner_id, (select array_agg(distinct a.owner_id) from activities a where a.milestone_id = m.id and a.deleted_at is null) as participants,
           m.completed_at as occurred_at, null::bigint as value_cents, null::int as quantity, null as outcome,
           jsonb_build_object('projectId', p.id, 'dueOn', m.due_on, 'onTime', m.due_on is null or m.completed_at::date <= m.due_on) as context
      from project_milestones m join projects p on p.id = m.project_id
     where m.tenant_id = ${t} and m.deleted_at is null and p.deleted_at is null and m.completed_at is not null and ${notExists(msKey)}`);
  const pjKey = sql`'projeto_concluido:' || p.id || ':' || (extract(epoch from p.completed_at) * 1000)::bigint`;
  await add('projeto_concluido', 'project', sql`
    select ${pjKey} as key, p.id as source_id, p.owner_id, (select array_agg(pm.user_id) from project_members pm where pm.project_id = p.id and pm.role <> 'observador') as participants,
           p.completed_at as occurred_at, null::bigint as value_cents, null::int as quantity, p.kind as outcome,
           jsonb_build_object('dueOn', p.due_on, 'onTime', p.due_on is null or p.completed_at::date <= p.due_on) as context
      from projects p where p.tenant_id = ${t} and p.deleted_at is null and p.status = 'concluido' and p.completed_at is not null and ${notExists(pjKey)}`);
  return out;
}

/** Eventos válidos cuja origem foi desfeita: invalida com motivo (o histórico fica). */
async function staleEvents(db: DbOrTx, t: string) {
  return rows<{ id: string; reason: string }>(db, sql`
    select be.id, case be.type
        when 'negociacao_ganha' then 'Oportunidade saiu de Ganha'
        when 'negociacao_perdida' then 'Oportunidade saiu de Perdida'
        when 'tarefa_concluida' then 'Tarefa reaberta, cancelada ou removida'
        when 'entrega_validada' then 'Entrega reaberta ou tarefa removida'
        when 'acompanhamento_registrado' then 'Acompanhamento reaberto ou removido'
        when 'marco_concluido' then 'Marco reaberto ou removido'
        when 'projeto_concluido' then 'Projeto reaberto ou removido'
        else 'Origem desfeita' end as reason
      from business_events be
     where be.tenant_id = ${t} and be.validation <> 'invalidado' and (
       (be.type = 'negociacao_ganha' and not exists (select 1 from opportunities o where o.id = be.source_id and o.deleted_at is null and o.stage = 'ganha' and be.idem_key = 'negociacao_ganha:' || o.id || ':' || (extract(epoch from o.won_at) * 1000)::bigint))
    or (be.type = 'negociacao_perdida' and not exists (select 1 from opportunities o where o.id = be.source_id and o.deleted_at is null and o.stage = 'perdida' and be.idem_key = 'negociacao_perdida:' || o.id || ':' || (extract(epoch from o.lost_at) * 1000)::bigint))
    or (be.type in ('tarefa_concluida', 'acompanhamento_registrado') and not exists (select 1 from activities a where a.id = be.source_id and a.deleted_at is null and a.completed_at is not null and be.idem_key like '%:' || (extract(epoch from a.completed_at) * 1000)::bigint))
    or (be.type = 'entrega_validada' and not exists (select 1 from activities a where a.id = be.source_id and a.deleted_at is null and a.completed_at is not null and a.approved_at is not null and be.idem_key like '%:' || (extract(epoch from a.approved_at) * 1000)::bigint))
    or (be.type = 'marco_concluido' and not exists (select 1 from project_milestones m where m.id = be.source_id and m.deleted_at is null and m.completed_at is not null and be.idem_key like '%:' || (extract(epoch from m.completed_at) * 1000)::bigint))
    or (be.type = 'projeto_concluido' and not exists (select 1 from projects p where p.id = be.source_id and p.deleted_at is null and p.status = 'concluido' and be.idem_key like '%:' || (extract(epoch from p.completed_at) * 1000)::bigint))
     )`);
}

async function teamInfo(db: DbOrTx, t: string) {
  const ms = await db.select({ userId: s.teamMemberships.userId, teamId: s.teamMemberships.teamId, isLead: s.teamMemberships.isLead }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(eq(s.teams.tenantId, t));
  const primaryTeam = (u: string) => ms.find((m) => m.userId === u && !m.isLead)?.teamId ?? ms.find((m) => m.userId === u)?.teamId ?? null;
  const leadsOf = (u: string) => {
    const teams = ms.filter((m) => m.userId === u).map((m) => m.teamId);
    return ms.filter((m) => m.isLead && teams.includes(m.teamId) && m.userId !== u).map((m) => m.userId);
  };
  return { primaryTeam, leadsOf };
}

export type SyncStats = { created: number; invalidated: number; byType: Record<string, number>; ms: number };

/** Roda o projetor para uma empresa. Idempotente: rodar de novo não duplica nada. */
export async function syncBusinessEvents(db: DbOrTx, tenantId: string): Promise<SyncStats> {
  const started = Date.now();
  const { version, config } = await performanceConfig(db, tenantId);
  const cands = await candidates(db, tenantId);
  const team = await teamInfo(db, tenantId);
  const byType: Record<string, number> = {};
  let created = 0;
  for (const c of cands) {
    const def = eventTypeDef(c.type)!;
    const pending = config.validationRequired.includes(c.type);
    const [ev] = await db.insert(s.businessEvents).values({
      tenantId, type: c.type, module: def.module, sourceType: c.sourceType, sourceId: c.sourceId, ownerId: c.ownerId, participants: [...new Set(c.participants)].filter((p) => p !== c.ownerId),
      teamId: c.ownerId ? team.primaryTeam(c.ownerId) : null, occurredAt: c.occurredAt, outcome: c.outcome, valueCents: c.valueCents, quantity: c.quantity,
      validation: pending ? 'pendente' : 'valido', context: c.context, idemKey: c.key, ruleVersion: version,
    }).onConflictDoNothing().returning({ id: s.businessEvents.id });
    if (!ev) continue;
    created++;
    byType[c.type] = (byType[c.type] ?? 0) + 1;
    if (c.ownerId) {
      const credits = computeCredits(config.attribution[c.type] ?? { ownerShareBp: 10_000, participants: true, managers: true }, c.ownerId, c.participants, team.leadsOf(c.ownerId));
      if (credits.length) await db.insert(s.businessEventCredits).values(credits.map((cr) => ({ eventId: ev.id, userId: cr.userId, tenantId, kind: cr.kind, shareBp: cr.shareBp }))).onConflictDoNothing();
    }
  }
  const stale = await staleEvents(db, tenantId);
  for (const st of stale) {
    const r = await db.update(s.businessEvents).set({ validation: 'invalidado', validatedAt: new Date(), validatedBy: null }).where(and(eq(s.businessEvents.id, st.id), sql`${s.businessEvents.validation} <> 'invalidado'`)).returning({ from: sql<string>`'valido'` });
    if (r.length) await db.insert(s.businessEventReviews).values({ tenantId, eventId: st.id, fromValidation: 'valido', toValidation: 'invalidado', reason: st.reason, automatic: true });
  }
  const stats = { created, invalidated: stale.length, byType, ms: Date.now() - started };
  await db.insert(s.businessEventSync).values({ tenantId, lastRunAt: new Date(), stats }).onConflictDoUpdate({ target: s.businessEventSync.tenantId, set: { lastRunAt: new Date(), stats } });
  return stats;
}

/** Atualiza só se a última execução tiver mais de `maxAgeMs` (usado antes de telas de desempenho). */
export async function ensureFreshEvents(db: DbOrTx, tenantId: string, maxAgeMs = 60_000) {
  const [r] = await db.select({ at: s.businessEventSync.lastRunAt }).from(s.businessEventSync).where(eq(s.businessEventSync.tenantId, tenantId)).limit(1);
  if (r && Date.now() - r.at.getTime() < maxAgeMs) return null;
  return syncBusinessEvents(db, tenantId);
}

export async function eventCountsByType(db: DbOrTx, tenantId: string) {
  return db.select({ type: s.businessEvents.type, validation: s.businessEvents.validation, n: sql<number>`count(*)::int` }).from(s.businessEvents).where(eq(s.businessEvents.tenantId, tenantId)).groupBy(s.businessEvents.type, s.businessEvents.validation);
}

