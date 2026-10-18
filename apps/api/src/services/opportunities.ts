import type { FastifyRequest } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { OpportunityReason } from '@isp/domain';
import type { ContactCreate } from '@isp/shared';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { notFound, unprocessable } from '../http/errors';
import { assertAssignableUser, assertTenantRefs, ownerScope } from './scope';
import { audit } from './audit';
import { resolvePipeline } from './instructions';

export type CreateOpportunityInput = {
  contactId?: string | null;
  newContact?: ContactCreate | null;
  leadId?: string | null;
  ownerId?: string | null;
  sourceId?: string | null;
  campaignId?: string | null;
  planId?: string | null;
  pipelineId?: string | null;
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
export async function createOpportunity(tx: DbOrTx, auth: AuthContext, req: FastifyRequest, input: CreateOpportunityInput) {
  const ownerId = input.ownerId ?? auth.userId;
  await assertAssignableUser(tx, auth, 'oportunidades', ownerId);
  await assertTenantRefs(tx, auth, { sourceId: input.sourceId, campaignId: input.campaignId });
  const plan = await planPrice(tx, auth, input.planId);

  let contactId = input.contactId ?? null;
  let contactName: string;
  let segment: string | null = input.newContact?.segment ?? null;
  if (!contactId) {
    if (!input.newContact) throw notFound('Contato não encontrado.');
    const [c] = await tx
      .insert(s.contacts)
      .values({
        tenantId: auth.tenantId,
        name: input.newContact.name,
        phone: input.newContact.phone,
        email: input.newContact.email,
        segment: input.newContact.segment,
        city: input.newContact.city,
        ownerId,
        isProvisional: true,
        createdBy: auth.userId,
      })
      .returning({ id: s.contacts.id, name: s.contacts.name });
    contactId = c!.id;
    contactName = c!.name;
  } else {
    // contato existente precisa estar visível na carteira do usuário (Clientes)
    const [c] = await tx
      .select({ name: s.contacts.name, segment: s.contacts.segment })
      .from(s.contacts)
      .where(and(eq(s.contacts.id, contactId), ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt })))
      .limit(1);
    if (!c) throw unprocessable('Referência inválida.', [{ path: 'contactId', message: 'Contato fora da sua carteira' }]);
    contactName = c.name;
    segment = c.segment;
  }
  const pipeline = await resolvePipeline(tx, auth.tenantId, { pipelineId: input.pipelineId, segment });
  const firstStage = pipeline.stages.find((st) => st.kind === 'open')!;

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
      campaignId: input.campaignId ?? null,
      planId: plan?.id ?? null,
      valueCents: plan?.priceCents ?? null,
      sprintStartedAt: now,
      createdBy: auth.userId,
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
  return opp!;
}

const owner = alias(s.users, 'opp_owner');

export const opportunitySelect = {
  id: s.opportunities.id,
  code: s.opportunities.code,
  title: s.opportunities.title,
  stage: s.opportunities.stage,
  pipelineId: s.opportunities.pipelineId,
  pipelineName: s.pipelines.name,
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

export function oppVisibility(auth: AuthContext) {
  return ownerScope(auth, 'oportunidades', { tenantId: s.opportunities.tenantId, ownerId: s.opportunities.ownerId, deletedAt: s.opportunities.deletedAt });
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
