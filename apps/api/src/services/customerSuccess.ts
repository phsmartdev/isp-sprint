/** Funil Sucesso do Cliente: criado na primeira vez que for acionado (não muda as jornadas existentes). */
import { tenantModuleOn } from './modules';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Config } from '../config';
import { csConfigOf, recomputeAccounts, startJourney } from './cs';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';

export const CS_KEY = 'sucesso_cliente';
const STAGES = [
  { key: 'acionado', name: 'Acionado', kind: 'open', color: '#3B82F6' },
  { key: 'planejamento', name: 'Planejamento', kind: 'open', color: '#2F5986' },
  { key: 'diagnostico', name: 'Diagnóstico', kind: 'open', color: '#8B5CF6' },
  { key: 'plano_acao', name: 'Plano de ação', kind: 'open', color: '#F59E0B' },
  { key: 'acompanhamento', name: 'Acompanhamento', kind: 'open', color: '#14B8A6' },
  { key: 'ganha', name: 'Cliente atendido', kind: 'won', color: '#22C55E' },
  { key: 'perdida', name: 'Não resolvido', kind: 'lost', color: '#EF4444' },
];

export async function ensureCustomerSuccessPipeline(db: DbOrTx, tenantId: string) {
  const [p] = await db.select().from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.key, CS_KEY))).limit(1);
  if (p) {
    if (!p.active) throw unprocessable('A jornada Sucesso do Cliente está inativa. Reative em Configurações → Jornadas.');
    return p;
  }
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.pipelines).where(eq(s.pipelines.tenantId, tenantId));
  const [created] = await db.insert(s.pipelines).values({ tenantId, key: CS_KEY, name: 'Sucesso do Cliente', description: 'Clientes da base acionados pelo comercial (criado automaticamente).', segments: [], isDefault: false, position: n }).returning();
  await db.insert(s.pipelineStages).values(STAGES.map((st, i) => ({ tenantId, pipelineId: created!.id, key: st.key, name: st.name, kind: st.kind, color: st.color, requirements: {}, position: i, isTerminal: st.kind !== 'open' })));
  return created!;
}

/** Cliente da base = tem cadastro de cliente que não é só prospecção. */
export async function isBaseCustomer(db: DbOrTx, tenantId: string, contactId: string) {
  const [c] = await db.select({ lifecycle: s.customers.lifecycle }).from(s.customers).where(and(eq(s.customers.tenantId, tenantId), eq(s.customers.contactId, contactId))).limit(1);
  return !!c && c.lifecycle !== 'prospect';
}

/** Garante a etapa Planejamento no funil Sucesso do Cliente (gatilho padrão da jornada), logo depois de "Acionado". */
export async function ensurePlanningStage(db: DbOrTx, tenantId: string, pipelineId: string) {
  const stages = await db.select().from(s.pipelineStages).where(eq(s.pipelineStages.pipelineId, pipelineId));
  if (stages.some((x) => x.key === 'planejamento')) return;
  const after = stages.find((x) => x.key === 'acionado')?.position ?? 0;
  await db.update(s.pipelineStages).set({ position: sql`${s.pipelineStages.position} + 1` }).where(and(eq(s.pipelineStages.pipelineId, pipelineId), sql`${s.pipelineStages.position} > ${after}`));
  await db.insert(s.pipelineStages).values({ tenantId, pipelineId, key: 'planejamento', name: 'Planejamento', kind: 'open', color: '#2F5986', requirements: {}, position: after + 1, isTerminal: false });
}

/** Contratos vigentes (validados, não arquivados) da conta, com a versão atual. */
export async function accountContracts(db: DbOrTx, tenantId: string, contactIds: string[]) {
  if (!contactIds.length) return [];
  return db.select({ id: s.contracts.id, contactId: s.contracts.contactId, code: s.contracts.code, stage: s.contracts.stage, kind: s.contracts.kind, billingType: s.contracts.billingType, csmId: s.contracts.csmId, commercialOwnerId: s.contracts.commercialOwnerId, validatedAt: s.contracts.validatedAt, number: s.contractVersions.number, object: s.contractVersions.object, monthlyCents: s.contractVersions.monthlyCents, totalCents: s.contractVersions.totalCents, endAt: s.contractVersions.endAt, arpId: s.contracts.arpId })
    .from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion)))
    .where(and(eq(s.contracts.tenantId, tenantId), inArray(s.contracts.contactId, contactIds), sql`${s.contracts.stage} <> 'arquivado'`, isNotNull(s.contracts.validatedAt)))
    .orderBy(desc(s.contracts.createdAt));
}

/** Card da conta no funil Sucesso do Cliente (um por conta, enquanto aberto). */
export async function openAccountCard(db: DbOrTx, tenantId: string, pipelineId: string, contactId: string) {
  const [o] = await db.select({ id: s.opportunities.id, stage: s.opportunities.stage, ownerId: s.opportunities.ownerId }).from(s.opportunities)
    .where(and(eq(s.opportunities.tenantId, tenantId), eq(s.opportunities.pipelineId, pipelineId), eq(s.opportunities.contactId, contactId), isNull(s.opportunities.deletedAt), sql`${s.opportunities.stage} not in ('ganha','perdida')`))
    .orderBy(asc(s.opportunities.createdAt)).limit(1);
  return o ?? null;
}

/** Valor do card = soma mensal dos contratos recorrentes vigentes da conta (carteira que o CS cuida). */
async function refreshCardValue(db: DbOrTx, tenantId: string, cardId: string, contactId: string) {
  const list = await accountContracts(db, tenantId, [contactId]);
  const monthly = list.filter((c) => c.billingType === 'recorrente').reduce((t, c) => t + c.monthlyCents, 0);
  await db.update(s.opportunities).set({ valueCents: monthly, updatedAt: new Date() }).where(eq(s.opportunities.id, cardId));
}

/**
 * Garante o card da conta no funil Sucesso do Cliente. Já existe card aberto → devolve ele (a conta não ganha card novo).
 * Não existe → cria em "Acionado": copiando a negociação de origem (histórico e atividades) ou do zero.
 */
export async function ensureAccountCard(db: DbOrTx, tenantId: string, actorId: string | null, input: { contactId: string; sourceOpportunityId: string | null; ownerId: string | null; reason: string }) {
  const cs = await ensureCustomerSuccessPipeline(db, tenantId);
  await ensurePlanningStage(db, tenantId, cs.id);
  const found = await openAccountCard(db, tenantId, cs.id, input.contactId);
  if (found) return { id: found.id, stage: found.stage, created: false, pipelineId: cs.id };
  const [contact] = await db.select({ name: s.contacts.name, ownerId: s.contacts.ownerId }).from(s.contacts).where(eq(s.contacts.id, input.contactId)).limit(1);
  let id: string;
  if (input.sourceOpportunityId) {
    const { duplicateOpportunity } = await import('./automations');
    id = await duplicateOpportunity(db as never, tenantId, actorId, input.sourceOpportunityId, { tipo: 'duplicar', jornada: cs.key, etapa: 'acionado', responsavel: input.ownerId ?? 'mesmo' }, input.reason);
  } else {
    const ownerId = input.ownerId ?? contact?.ownerId ?? actorId;
    if (!ownerId) throw unprocessable('Conta sem responsável para o card do Sucesso do Cliente.');
    const [o] = await db.insert(s.opportunities).values({ tenantId, contactId: input.contactId, ownerId, title: `Conta · ${contact?.name ?? ''}`.slice(0, 160), pipelineId: cs.id, stage: 'acionado', createdBy: actorId, reasons: [] }).returning({ id: s.opportunities.id });
    id = o!.id;
    await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: id, type: 'created', actorId, toValue: 'acionado', rowVersion: 1, payload: { pipeline: cs.key, reason: input.reason } });
  }
  await db.update(s.opportunities).set({ title: `Conta · ${contact?.name ?? ''}`.slice(0, 160) }).where(eq(s.opportunities.id, id));
  await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: id, type: 'conta_acionada', actorId, payload: { reason: input.reason } });
  return { id, stage: 'acionado', created: true, pipelineId: cs.id };
}

/** Etapa do card já passou do gatilho da jornada? (contrato novo numa conta já em acompanhamento começa a jornada na hora) */
async function pastTrigger(db: DbOrTx, pipelineId: string, stage: string, triggerStage: string) {
  const st = await db.select({ key: s.pipelineStages.key, position: s.pipelineStages.position }).from(s.pipelineStages).where(eq(s.pipelineStages.pipelineId, pipelineId));
  const pos = (k: string) => st.find((x) => x.key === k)?.position ?? Infinity;
  return pos(stage) >= pos(triggerStage);
}

/** Gatilho: o card da conta entrou na etapa configurada → começa a jornada de cada contrato vigente da conta que ainda não tem (idempotente). */
export async function csOnStage(db: DbOrTx, config: Config, tenantId: string, actorId: string | null, opportunityId: string, stage: string) {
  const { config: cfg } = await csConfigOf(db, tenantId);
  const t = cfg.trigger;
  if (stage !== t.stageKey) return null;
  const [o] = await db.select({ id: s.opportunities.id, contactId: s.opportunities.contactId, arpId: s.opportunities.arpId, pipelineKey: s.pipelines.key }).from(s.opportunities).innerJoin(s.pipelines, eq(s.pipelines.id, s.opportunities.pipelineId)).where(and(eq(s.opportunities.id, opportunityId), eq(s.opportunities.tenantId, tenantId))).limit(1);
  if (!o || o.pipelineKey !== t.pipelineKey || o.arpId) return null;
  const list = (await accountContracts(db, tenantId, [o.contactId])).filter((c) => !c.arpId && contractMatches(t, c));
  const out = [];
  if (!list.length) out.push(await startJourney(db, config, tenantId, actorId, { contactId: o.contactId, contractId: null, opportunityId: o.id, csmId: t.defaultCsmId }));
  for (const c of list) out.push(await startJourney(db, config, tenantId, actorId, { contactId: o.contactId, contractId: c.id, opportunityId: o.id, csmId: c.csmId ?? t.defaultCsmId }));
  await recomputeAccounts(db, tenantId, [o.contactId]);
  return out[0] ?? null;
}

function contractMatches(t: { billingTypes: string[]; kinds: string[] }, c: { billingType: string; kind: string }) {
  return (!t.billingTypes.length || t.billingTypes.includes(c.billingType)) && (!t.kinds.length || t.kinds.includes(c.kind));
}

/**
 * Contrato validado: vai, com as informações dele, para o card da CONTA no funil Sucesso do Cliente.
 * Conta sem card aberto ganha um (em "Acionado"); conta com card recebe o contrato na lista e no histórico.
 * Se o card já passou da etapa que inicia a jornada, a jornada deste contrato começa na hora.
 */
export async function handoffContractToCs(db: DbOrTx, tenantId: string, actorId: string | null, contract: { id: string; opportunityId: string | null; arpId: string | null }, config?: Config) {
  if (!(await tenantModuleOn(db, tenantId, 'crm'))) return null; // Etapa 1: Sucesso do Cliente é do CRM
  const { config: cfg } = await csConfigOf(db, tenantId);
  if (!cfg.trigger.createOnContractValidation || contract.arpId) return null;
  const [c] = await db.select({ contactId: s.contracts.contactId, csmId: s.contracts.csmId, kind: s.contracts.kind, billingType: s.contracts.billingType, number: s.contractVersions.number, object: s.contractVersions.object, monthlyCents: s.contractVersions.monthlyCents, endAt: s.contractVersions.endAt })
    .from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(eq(s.contracts.id, contract.id)).limit(1);
  if (!c) return null;
  const card = await ensureAccountCard(db, tenantId, actorId, { contactId: c.contactId, sourceOpportunityId: contract.opportunityId, ownerId: null, reason: 'Contrato validado: entrada no Sucesso do Cliente' });
  const [already] = await db.select({ id: s.opportunityEvents.id }).from(s.opportunityEvents).where(and(eq(s.opportunityEvents.opportunityId, card.id), eq(s.opportunityEvents.type, 'contrato_incluido'), sql`${s.opportunityEvents.payload} ->> 'contractId' = ${contract.id}`)).limit(1);
  if (!already) {
    await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: card.id, type: 'contrato_incluido', actorId, payload: { contractId: contract.id, number: c.number, object: c.object, monthlyCents: c.monthlyCents, billingType: c.billingType, kind: c.kind, endAt: c.endAt, opportunityId: contract.opportunityId } });
    await db.insert(s.contractEvents).values({ tenantId, contractId: contract.id, type: 'cs_conta', actorId, summary: card.created ? 'Conta acionada no Sucesso do Cliente com este contrato.' : 'Contrato incluído no card da conta no Sucesso do Cliente.', payload: { opportunityId: card.id } });
  }
  await refreshCardValue(db, tenantId, card.id, c.contactId);
  if (config && !card.created && contractMatches(cfg.trigger, c) && (await pastTrigger(db, card.pipelineId, card.stage, cfg.trigger.stageKey))) {
    await startJourney(db, config, tenantId, actorId, { contactId: c.contactId, contractId: contract.id, opportunityId: card.id, csmId: c.csmId ?? cfg.trigger.defaultCsmId });
  }
  return card.id;
}

/**
 * Um card por conta: contas com mais de um card aberto no funil Sucesso do Cliente ficam com o mais adiantado
 * (empate: o mais antigo); os outros saem do quadro (histórico preservado e apontando para o card que ficou).
 */
export async function consolidateAccountCards(db: DbOrTx, tenantId: string) {
  const [cs] = await db.select({ id: s.pipelines.id }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.key, CS_KEY))).limit(1);
  if (!cs) return 0;
  const rows = await db.execute<{ id: string; contact_id: string; pos: number; created_at: string }>(sql`
    select o.id, o.contact_id, coalesce(ps.position, 0) pos, o.created_at from opportunities o left join pipeline_stages ps on ps.pipeline_id = o.pipeline_id and ps.key = o.stage
     where o.tenant_id = ${tenantId} and o.pipeline_id = ${cs.id} and o.deleted_at is null and o.stage not in ('ganha','perdida')
       and o.contact_id in (select contact_id from opportunities where tenant_id = ${tenantId} and pipeline_id = ${cs.id} and deleted_at is null and stage not in ('ganha','perdida') group by contact_id having count(*) > 1)`);
  const by = new Map<string, typeof rows.rows>();
  for (const r of rows.rows) by.set(r.contact_id, [...(by.get(r.contact_id) ?? []), r]);
  let n = 0;
  for (const list of by.values()) {
    const keep = [...list].sort((a, b) => b.pos - a.pos || String(a.created_at).localeCompare(String(b.created_at)))[0]!;
    for (const o of list) {
      if (o.id === keep.id) continue;
      // contratos do card que sai passam para o que fica
      const evs = await db.select().from(s.opportunityEvents).where(and(eq(s.opportunityEvents.opportunityId, o.id), eq(s.opportunityEvents.type, 'contrato_incluido')));
      for (const e of evs) await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: keep.id, type: 'contrato_incluido', actorId: e.actorId, payload: { ...(e.payload ?? {}), movedFrom: o.id }, occurredAt: e.occurredAt });
      await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: o.id, type: 'consolidada_na_conta', actorId: null, payload: { into: keep.id } });
      await db.insert(s.opportunityEvents).values({ tenantId, opportunityId: keep.id, type: 'card_consolidado', actorId: null, payload: { from: o.id } });
      await db.update(s.opportunities).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(s.opportunities.id, o.id));
      n++;
    }
  }
  return n;
}
