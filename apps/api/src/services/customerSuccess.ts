/** Funil Sucesso do Cliente: criado na primeira vez que for acionado (não muda as jornadas existentes). */
import { tenantModuleOn } from './modules';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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

/** Contrato da negociação de Sucesso do Cliente: o da própria oportunidade ou o da oportunidade comercial de origem. */
async function contractFor(db: DbOrTx, opp: { id: string; duplicatedFromId: string | null }) {
  const ids = [opp.id, opp.duplicatedFromId].filter(Boolean) as string[];
  const [c] = await db.select().from(s.contracts).where(inArray(s.contracts.opportunityId, ids)).orderBy(desc(s.contracts.createdAt)).limit(1);
  return c ?? null;
}

/** Gatilho: a oportunidade entrou no funil/etapa configurados → inicia a jornada (idempotente; voltar à etapa não duplica). */
export async function csOnStage(db: DbOrTx, config: Config, tenantId: string, actorId: string | null, opportunityId: string, stage: string) {
  const { config: cfg } = await csConfigOf(db, tenantId);
  const t = cfg.trigger;
  if (stage !== t.stageKey) return null;
  const [o] = await db.select({ id: s.opportunities.id, contactId: s.opportunities.contactId, duplicatedFromId: s.opportunities.duplicatedFromId, arpId: s.opportunities.arpId, pipelineKey: s.pipelines.key }).from(s.opportunities).innerJoin(s.pipelines, eq(s.pipelines.id, s.opportunities.pipelineId)).where(and(eq(s.opportunities.id, opportunityId), eq(s.opportunities.tenantId, tenantId))).limit(1);
  if (!o || o.pipelineKey !== t.pipelineKey || o.arpId) return null;
  const c = await contractFor(db, o);
  if (c && t.billingTypes.length && !t.billingTypes.includes(c.billingType)) return null;
  if (c && t.kinds.length && !t.kinds.includes(c.kind)) return null;
  if (t.customerType !== 'todos') {
    const [prior] = await db.select({ n: sql<number>`count(*)::int` }).from(s.contracts).where(and(eq(s.contracts.tenantId, tenantId), eq(s.contracts.contactId, o.contactId), c ? sql`${s.contracts.id} <> ${c.id}` : sql`true`, sql`${s.contracts.validatedAt} is not null`));
    const isNew = !prior?.n;
    if ((t.customerType === 'novo') !== isNew) return null;
  }
  const r = await startJourney(db, config, tenantId, actorId, { contactId: o.contactId, contractId: c?.id ?? null, opportunityId: o.id, csmId: c?.csmId ?? t.defaultCsmId });
  await recomputeAccounts(db, tenantId, [o.contactId]);
  return r;
}

/** Contrato validado: entra no funil Sucesso do Cliente (uma negociação por contrato), sem mexer na negociação comercial. */
export async function handoffContractToCs(db: DbOrTx, tenantId: string, actorId: string | null, contract: { id: string; opportunityId: string | null; arpId: string | null }) {
  if (!(await tenantModuleOn(db, tenantId, 'crm'))) return null; // Etapa 1: Sucesso do Cliente é do CRM
  const { config: cfg } = await csConfigOf(db, tenantId);
  if (!cfg.trigger.createOnContractValidation || !contract.opportunityId || contract.arpId) return null;
  const cs = await ensureCustomerSuccessPipeline(db, tenantId);
  await ensurePlanningStage(db, tenantId, cs.id);
  const [exists] = await db.select({ id: s.opportunities.id }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, tenantId), eq(s.opportunities.pipelineId, cs.id), eq(s.opportunities.duplicatedFromId, contract.opportunityId))).limit(1);
  if (exists) return exists.id;
  const { duplicateOpportunity } = await import('./automations');
  return duplicateOpportunity(db as never, tenantId, actorId, contract.opportunityId, { tipo: 'duplicar', jornada: cs.key, etapa: 'acionado', responsavel: 'mesmo' }, 'Contrato validado: entrada no Sucesso do Cliente');
}
