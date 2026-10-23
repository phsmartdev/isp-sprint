import type { FastifyRequest } from 'fastify';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { OpportunityReason } from '@isp/domain';
import type { ContactCreate, OpportunityDetails } from '@isp/shared';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { mergeCustom } from './customFields';
import type { AuthContext } from '../http/context';
import { notFound, unprocessable } from '../http/errors';
import { assertAssignableUser, assertTenantRefs, level, ownerScope } from './scope';
import { audit } from './audit';
import { resolvePipeline } from './instructions';
import { storeViability } from './viability';
import { assertPortAvailable } from './ports';

export type CreateOpportunityInput = Partial<OpportunityDetails> & {
  contactId?: string | null;
  newContact?: ContactCreate | null;
  leadId?: string | null;
  ownerId?: string | null;
  sourceId?: string | null;
  campaignId?: string | null;
  planId?: string | null;
  pipelineId?: string | null;
  branchId?: string | null;
  /** Etapa inicial (aberta) da jornada. */
  stage?: string | null;
  channel: string | null;
  reasons: OpportunityReason[];
  title: string | null;
};

/** Preço vem do catálogo (nunca digitado): sem plano, sem valor. */
export async function planPrice(db: DbOrTx, auth: AuthContext, planId: string | null | undefined) {
  if (!planId) return null;
  const [p] = await db.select().from(s.plans).where(and(eq(s.plans.id, planId), eq(s.plans.tenantId, auth.tenantId))).limit(1);
  if (!p) throw unprocessable('Plano inválido.', [{ path: 'planId', message: 'Plano não encontrado no catálogo' }]);
  if (!p.active) throw unprocessable('Plano inativo no catálogo.', [{ path: 'planId', message: 'Escolha um plano ativo' }]);
  return p;
}

/**
 * Cria a oportunidade e a persiste imediatamente (spec §4): ID, owner, origem, timestamps, versão
 * e evento "created". Contato novo é provisório e entra na carteira do responsável.
 */
export async function createOpportunity(tx: DbOrTx, auth: AuthContext, req: FastifyRequest, input: CreateOpportunityInput, opts: { trustedContact?: boolean; arpId?: string | null } = {}) {
  const ownerId = input.ownerId ?? auth.userId;
  await assertAssignableUser(tx, auth, 'oportunidades', ownerId);
  await assertTenantRefs(tx, auth, { sourceId: input.sourceId, campaignId: input.campaignId });
  if (input.branchId) await assertBranch(tx, auth.tenantId, input.branchId);
  const plan = await planPrice(tx, auth, input.planId);

  let contactId = input.contactId ?? null;
  let contactName: string;
  let segment: string | null = input.newContact?.segment ?? null;
  if (!contactId) {
    if (!input.newContact) throw notFound('Contato não encontrado.');
    const doc = (input.newContact.document ?? '').replace(/\D/g, '');
    if (doc) {
      const [dup] = await tx.select({ id: s.contacts.id, name: s.contacts.name }).from(s.contacts).where(and(eq(s.contacts.tenantId, auth.tenantId), isNull(s.contacts.deletedAt), sql`regexp_replace(coalesce(${s.contacts.document}, ''), '\D', '', 'g') = ${doc}`)).limit(1);
      if (dup) throw unprocessable(`Já existe uma conta com este CNPJ: ${dup.name}. Use "Cliente da carteira".`, [{ path: 'newContact.document', message: `CNPJ já cadastrado em ${dup.name}` }]);
    }
    const [c] = await tx
      .insert(s.contacts)
      .values({
        tenantId: auth.tenantId,
        name: input.newContact.name,
        phone: input.newContact.phone,
        email: input.newContact.email,
        segment: input.newContact.segment,
        city: input.newContact.city ?? input.newContact.address?.city ?? null,
        document: input.newContact.document ?? null,
        ownerId,
        isProvisional: true,
        createdBy: auth.userId,
      })
      .returning({ id: s.contacts.id, name: s.contacts.name });
    contactId = c!.id;
    contactName = c!.name;
    const a = input.newContact.address;
    if (a && (a.street || a.postalCode || a.city)) {
      await tx.insert(s.addresses).values({ tenantId: auth.tenantId, contactId, street: a.street ?? null, number: a.number ?? null, district: a.district ?? null, city: a.city ?? null, state: a.state ?? null, postalCode: a.postalCode ?? null });
    }
  } else {
    // contato existente precisa estar visível na carteira do usuário (Clientes)
    const [c] = await tx
      .select({ name: s.contacts.name, segment: s.contacts.segment })
      .from(s.contacts)
      // órgão da ata: o contato é do cadastro da ata, não da carteira de quem cria
      .where(opts.trustedContact ? and(eq(s.contacts.id, contactId), eq(s.contacts.tenantId, auth.tenantId)) : and(eq(s.contacts.id, contactId), ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt })))
      .limit(1);
    if (!c) throw unprocessable('Referência inválida.', [{ path: 'contactId', message: 'Contato fora da sua carteira' }]);
    contactName = c.name;
    segment = c.segment;
  }
  const pipeline = await resolvePipeline(tx, auth.tenantId, { pipelineId: input.pipelineId, segment, userId: auth.userId, total: level(auth, 'oportunidades') === 'total' });
  // etapa inicial escolhida na abertura (só etapas abertas); sem escolha, a primeira
  const chosen = input.stage ? pipeline.stages.find((st) => st.key === input.stage && st.kind === 'open') : undefined;
  if (input.stage && !chosen) throw unprocessable('Etapa inicial inválida.', [{ path: 'stage', message: 'Escolha uma etapa aberta deste tipo de venda' }]);
  const firstStage = chosen ?? pipeline.stages.find((st) => st.kind === 'open')!;

  if (input.leadId) {
    const [l] = await tx.select({ id: s.leads.id }).from(s.leads).where(and(eq(s.leads.id, input.leadId), eq(s.leads.tenantId, auth.tenantId))).limit(1);
    if (!l) throw notFound('Lead não encontrado.');
  }

  const [customer] = await tx.select({ id: s.customers.id }).from(s.customers).where(and(eq(s.customers.contactId, contactId), eq(s.customers.tenantId, auth.tenantId))).limit(1);
  const [team] = await tx.select({ teamId: s.teamMemberships.teamId }).from(s.teamMemberships).where(eq(s.teamMemberships.userId, ownerId)).limit(1);
  const now = new Date();
  const [opp] = await tx
    .insert(s.opportunities)
    .values({
      tenantId: auth.tenantId,
      contactId,
      customerId: customer?.id ?? null,
      leadId: input.leadId ?? null,
      ownerId,
      teamId: team?.teamId ?? null,
      pipelineId: pipeline.id,
      stage: firstStage.key,
      title: input.title ?? (plan ? `${plan.name} — ${contactName}` : `${contactName} — nova oportunidade`),
      reasons: input.reasons,
      channel: input.channel,
      sourceId: input.sourceId ?? null,
      branchId: input.branchId ?? null,
      campaignId: input.campaignId ?? null,
      planId: plan?.id ?? null,
      valueCents: plan?.priceCents ?? null,
      sprintStartedAt: now,
      createdBy: auth.userId,
      arpId: opts.arpId ?? null,
      ...(await detailsPatch(tx, auth, input, pipeline.id)),
    })
    .returning({ id: s.opportunities.id, code: s.opportunities.code });
  await tx.insert(s.opportunityEvents).values({
    tenantId: auth.tenantId,
    opportunityId: opp!.id,
    type: 'created',
    actorId: auth.userId,
    toValue: firstStage.key,
    rowVersion: 1,
    payload: { pipeline: pipeline.key, reasons: input.reasons, channel: input.channel, fromLead: input.leadId ?? null, provisionalContact: !input.contactId, planId: plan?.id ?? null },
  });
  await audit(tx, req, { action: 'opportunity.create', entityType: 'opportunity', entityId: opp!.id });
  await storeViability(tx, auth.tenantId, opp!.id);
  const missing = pipeline.fields.filter((f) => f.required && (input.custom?.[f.key] === undefined || input.custom?.[f.key] === null || input.custom?.[f.key] === ''));
  if (missing.length) throw unprocessable(`Preencha: ${missing.map((f) => f.label).join(', ')}.`, missing.map((f) => ({ path: `custom.${f.key}`, message: 'Obrigatório' })));
  return { ...opp!, pipelineId: pipeline.id, stage: firstStage.key };
}

const owner = alias(s.users, 'opp_owner');

export const opportunitySelect = {
  id: s.opportunities.id,
  code: s.opportunities.code,
  title: s.opportunities.title,
  stage: s.opportunities.stage,
  pipelineId: s.opportunities.pipelineId,
  pipelineName: s.pipelines.name,
  installCep: s.opportunities.installCep,
  installStreet: s.opportunities.installStreet,
  installNumber: s.opportunities.installNumber,
  installDistrict: s.opportunities.installDistrict,
  installCity: s.opportunities.installCity,
  condominiumId: s.opportunities.condominiumId,
  condominiumName: sql<string | null>`(select c.name from condominiums c where c.id = "opportunities"."condominium_id")`,
  regionName: sql<string | null>`(select r.name from condominiums c join regions r on r.id = c.region_id where c.id = "opportunities"."condominium_id")`,
  installBlock: s.opportunities.installBlock,
  installUnit: s.opportunities.installUnit,
  saleType: s.opportunities.saleType,
  cableMeters: s.opportunities.cableMeters,
  activationFeeCents: s.opportunities.activationFeeCents,
  equipment: s.opportunities.equipment,
  routeId: s.opportunities.routeId,
  viability: s.opportunities.viability,
  commissionCents: s.opportunities.commissionCents,
  cacCents: s.opportunities.cacCents,
  marginCents: s.opportunities.marginCents,
  paybackMonths: s.opportunities.paybackMonths,
  custom: s.opportunities.custom,
  duplicatedFromId: s.opportunities.duplicatedFromId,
  engineeringStatus: s.opportunities.engineeringStatus,
  portReleasedAt: s.opportunities.portReleasedAt,
  portReleaseReason: s.opportunities.portReleaseReason,
  engineeringTicket: s.opportunities.engineeringTicket,
  executiveTicket: s.opportunities.executiveTicket,
  handoffStage: s.opportunities.handoffStage,
  measurementContractId: s.opportunities.measurementContractId,
  branchId: s.opportunities.branchId,
  bidMode: s.opportunities.bidMode,
  bidGlobalCents: s.opportunities.bidGlobalCents,
  itemCount: sql<number>`(select count(*)::int from opportunity_items oi where oi.opportunity_id = ${s.opportunities.id})`,
  measurementCents: s.opportunities.measurementCents,
  arpId: s.opportunities.arpId,
  contractId: sql<string | null>`(select c.id from contracts c where c.opportunity_id = "opportunities"."id" limit 1)`,
  approvalStatus: sql<string | null>`(select coalesce(d.decision, 'pendente') from approval_requests r left join approval_decisions d on d.request_id = r.id where r.opportunity_id = "opportunities"."id" order by r.version desc limit 1)`,
  stageName: s.pipelineStages.name,
  attachmentCount: sql<number>`(select count(*)::int from opportunity_attachments oa where oa.opportunity_id = "opportunities"."id" and oa.deleted_at is null)`,
  proposalCount: sql<number>`(select count(*)::int from opportunity_attachments oa where oa.opportunity_id = "opportunities"."id" and oa.deleted_at is null and oa.kind = 'proposta')`,
  proposalStatus: s.opportunities.proposalStatus,
  contractRequestStatus: s.opportunities.contractRequestStatus,
  coverageStatus: s.opportunities.coverageStatus,
  reasons: s.opportunities.reasons,
  channel: s.opportunities.channel,
  valueCents: s.opportunities.valueCents,
  planId: s.opportunities.planId,
  planName: s.plans.name,
  planLine: s.plans.line,
  nextAction: s.opportunities.nextAction,
  nextActionAt: s.opportunities.nextActionAt,
  notes: s.opportunities.notes,
  lossReason: s.opportunities.lossReason,
  stageChangedAt: s.opportunities.stageChangedAt,
  wonAt: s.opportunities.wonAt,
  lostAt: s.opportunities.lostAt,
  sprintStartedAt: s.opportunities.sprintStartedAt,
  sprintElapsedSeconds: s.opportunities.sprintElapsedSeconds,
  createdAt: s.opportunities.createdAt,
  updatedAt: s.opportunities.updatedAt,
  rowVersion: s.opportunities.rowVersion,
  leadId: s.opportunities.leadId,
  customerId: s.opportunities.customerId,
  customerLifecycle: s.customers.lifecycle,
  contactId: s.contacts.id,
  contactName: s.contacts.name,
  contactPhone: s.contacts.phone,
  contactEmail: s.contacts.email,
  contactSegment: s.contacts.segment,
  contactCity: s.contacts.city,
  contactProvisional: s.contacts.isProvisional,
  ownerId: s.opportunities.ownerId,
  ownerName: owner.name,
  ownerHasAvatar: sql<boolean>`exists(select 1 from user_avatars ua where ua.user_id = "opportunities"."owner_id")`,
  sourceId: s.opportunities.sourceId,
  sourceName: s.leadSources.name,
  campaignId: s.opportunities.campaignId,
  campaignName: s.campaigns.name,
};

export function opportunityQuery(db: DbOrTx) {
  return db
    .select(opportunitySelect)
    .from(s.opportunities)
    .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
    .innerJoin(owner, eq(owner.id, s.opportunities.ownerId))
    .innerJoin(s.pipelines, eq(s.pipelines.id, s.opportunities.pipelineId))
    .leftJoin(s.pipelineStages, and(eq(s.pipelineStages.pipelineId, s.opportunities.pipelineId), eq(s.pipelineStages.key, s.opportunities.stage)))
    .leftJoin(s.customers, eq(s.customers.id, s.opportunities.customerId))
    .leftJoin(s.plans, eq(s.plans.id, s.opportunities.planId))
    .leftJoin(s.leadSources, eq(s.leadSources.id, s.opportunities.sourceId))
    .leftJoin(s.campaigns, eq(s.campaigns.id, s.opportunities.campaignId));
}

/** Nível do módulo + jornadas restritas: quem não é membro só vê as próprias oportunidades nelas. */
export function oppVisibility(auth: AuthContext) {
  const base = ownerScope(auth, 'oportunidades', { tenantId: s.opportunities.tenantId, ownerId: s.opportunities.ownerId, deletedAt: s.opportunities.deletedAt });
  if (level(auth, 'oportunidades') === 'total') return base;
  return and(
    base,
    sql`(${s.opportunities.ownerId} = ${auth.userId}
      or not exists (select 1 from pipeline_members pm where pm.pipeline_id = ${s.opportunities.pipelineId})
      or exists (select 1 from pipeline_members pm where pm.pipeline_id = ${s.opportunities.pipelineId} and pm.user_id = ${auth.userId}))`,
  )!;
}

export async function loadOpportunity(db: DbOrTx, auth: AuthContext, id: string) {
  const [row] = await opportunityQuery(db).where(and(eq(s.opportunities.id, id), oppVisibility(auth))).limit(1);
  if (!row) throw notFound('Oportunidade não encontrada.');
  return row;
}

export type OpportunityRow = Awaited<ReturnType<typeof loadOpportunity>>;

export function opportunityDto(r: OpportunityRow, now = new Date()) {
  const open = r.stage !== 'ganha' && r.stage !== 'perdida';
  return {
    ...r,
    ageDays: Math.floor((now.getTime() - r.createdAt.getTime()) / 86_400_000),
    daysInStage: Math.floor((now.getTime() - r.stageChangedAt.getTime()) / 86_400_000),
    overdue: open && !!r.nextActionAt && r.nextActionAt < now,
    missingNextAction: open && !r.nextAction && !r.nextActionAt,
  };
}

export const bumpVersion = () => sql`${s.opportunities.rowVersion} + 1`;

/** Valida referências da empresa e os campos personalizados da jornada; devolve o patch para o banco. */
export async function detailsPatch(tx: DbOrTx, auth: AuthContext, d: Partial<OpportunityDetails>, pipelineId: string, currentCustom?: Record<string, unknown>, current?: { id: string; stage: string; condominiumId: string | null }) {
  const out: Record<string, unknown> = {};
  const copy = ['installCep', 'installStreet', 'installNumber', 'installDistrict', 'installCity', 'installBlock', 'installUnit', 'saleType', 'cableMeters', 'activationFeeCents', 'equipment', 'engineeringStatus', 'engineeringTicket', 'executiveTicket'] as const;
  for (const k of copy) if (d[k] !== undefined) out[k] = d[k];
  if (d.installCep) out.installCep = d.installCep.replace(/^(\d{5})-?(\d{3})$/, '$1-$2');
  if (d.condominiumId !== undefined) {
    if (d.condominiumId) {
      const [c] = await tx.select({ id: s.condominiums.id }).from(s.condominiums).where(and(eq(s.condominiums.id, d.condominiumId), eq(s.condominiums.tenantId, auth.tenantId))).limit(1);
      if (!c) throw unprocessable('Condomínio inválido.', [{ path: 'condominiumId', message: 'Condomínio não encontrado' }]);
      // indicar o condomínio numa oportunidade aberta reserva uma porta da CTO
      const open = !current || (current.stage !== 'ganha' && current.stage !== 'perdida');
      if (open && d.condominiumId !== current?.condominiumId) await assertPortAvailable(tx, auth.tenantId, d.condominiumId, current?.id);
    }
    out.condominiumId = d.condominiumId;
  }
  if (d.routeId !== undefined) {
    if (d.routeId) {
      const [r] = await tx.select({ id: s.deliveryRoutes.id }).from(s.deliveryRoutes).where(and(eq(s.deliveryRoutes.id, d.routeId), eq(s.deliveryRoutes.tenantId, auth.tenantId))).limit(1);
      if (!r) throw unprocessable('Caminho de entrega inválido.', [{ path: 'routeId', message: 'Caminho não encontrado' }]);
    }
    out.routeId = d.routeId;
  }
  if (d.equipment) {
    const ids = [...new Set(d.equipment.map((e) => e.equipmentId))];
    if (ids.length) {
      const found = await tx.select({ id: s.equipmentItems.id }).from(s.equipmentItems).where(and(eq(s.equipmentItems.tenantId, auth.tenantId), inArray(s.equipmentItems.id, ids)));
      if (found.length !== ids.length) throw unprocessable('Equipamento inválido.', [{ path: 'equipment', message: 'Equipamento não encontrado no cadastro' }]);
    }
  }
  if (d.custom !== undefined) {
    const fields = await tx.select().from(s.pipelineFields).where(and(eq(s.pipelineFields.pipelineId, pipelineId), eq(s.pipelineFields.active, true)));
    const merged = mergeCustom(fields, currentCustom ?? {}, d.custom);
    out.custom = merged;
  }
  return out;
}

/** A filial precisa ser desta empresa e estar ativa. */
export async function assertBranch(db: DbOrTx, tenantId: string, branchId: string) {
  const [b] = await db.select({ id: s.salesBranches.id }).from(s.salesBranches).where(and(eq(s.salesBranches.id, branchId), eq(s.salesBranches.tenantId, tenantId), eq(s.salesBranches.active, true))).limit(1);
  if (!b) throw unprocessable('Filial inválida.', [{ path: 'branchId', message: 'Filial inexistente ou desativada' }]);
}

/** Empresas sem filial cadastrada ganham as filiais iniciais (BKT Soluções e UPNET). */
export async function ensureSalesBranches(db: DbOrTx, tenantId: string) {
  const [any] = await db.select({ id: s.salesBranches.id }).from(s.salesBranches).where(eq(s.salesBranches.tenantId, tenantId)).limit(1);
  if (any) return;
  await db.insert(s.salesBranches).values([{ tenantId, name: 'BKT Soluções', position: 0 }, { tenantId, name: 'UPNET', position: 1 }]).onConflictDoNothing();
}
