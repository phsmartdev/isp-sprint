/**
 * Modelo relacional — Fase 1 (fundação CRM).
 * Convenções (spec §7): UUID interno, tenant_id em toda tabela de negócio, timestamptz (UTC),
 * row_version para concorrência otimista, dinheiro em centavos inteiros, enums como text + CHECK
 * (mais fáceis de evoluir que tipos enum do Postgres).
 * Tabelas de IXC, propostas, contratos e analytics entram nas fases seguintes.
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb, primaryKey, uniqueIndex, index, check, bigint, serial, date, customType,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const id = () => uuid('id').primaryKey().defaultRandom();
const tenantId = () => uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const rowVersion = () => integer('row_version').notNull().default(1);
const inList = (col: string, values: readonly string[]) => sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(',')})`);

// --------------------------------------------------------------- tenancy & IAM

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    active: boolean('active').notNull().default(true),
    lastLoginAt: ts('last_login_at'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    /** Cargo exibido no topo (ex.: "Comercial"). */
    jobTitle: text('job_title'),
    /** Metas mensais usadas em "Meta do mês" e "Meu desempenho" no Início. */
    goalSales: integer('goal_sales').notNull().default(0),
    goalProposals: integer('goal_proposals').notNull().default(0),
    goalLeads: integer('goal_leads').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    // e-mail global: login sem escolher empresa. Usuário multiempresa fica para fase posterior (ver DECISIONS).
    emailUq: uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    tenantIdx: index('users_tenant_idx').on(t.tenantId),
  }),
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('roles_tenant_key_uq').on(t.tenantId, t.key) }),
);

/** Matriz de segurança: nível de acesso de cada perfil em cada módulo. */
export const accessPolicies = pgTable(
  'access_policies',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    level: text('level').notNull(),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.module] }),
    moduleCk: check('access_module_ck', inList('module', ['inicio', 'leads', 'oportunidades', 'clientes', 'atividades', 'relatorios', 'campanhas', 'inteligencia', 'configuracoes'])),
    levelCk: check('access_level_ck', inList('level', ['nenhum', 'proprio', 'equipe', 'total'])),
  }),
);

export const userAvatars = pgTable('user_avatars', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  data: bytea('data').notNull(),
  updatedAt: updatedAt(),
});

/** Espaços de imagem da Personalização (logo, mascotes, banner…), por empresa. */
export const brandAssets = pgTable(
  'brand_assets',
  {
    tenantId: tenantId(),
    slot: text('slot').notNull(),
    mime: text('mime').notNull(),
    data: bytea('data').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.slot] }) }),
);

/** Catálogo de planos. Nesta fase é mantido manualmente pela gerência; a autoridade futura é o IXC. */
export const plans = pgTable(
  'plans',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    line: text('line'),
    segment: text('segment').notNull().default('residencial'),
    priceCents: integer('price_cents').notNull(),
    /** Banda do plano (Mbps), usada nas regras de caminho de entrega. */
    speedMbps: integer('speed_mbps'),
    /** Nome do serviço como sai na fatura. */
    invoiceServiceName: text('invoice_service_name'),
    /** Produtos que compõem o plano: nome, quantidade, valor unitário e comissão por tipo de venda. */
    products: jsonb('products').$type<{ name: string; qty: number; unitPriceCents: number; commissionAtiva: { kind: 'percent' | 'fixo'; value: number } | null; commissionReceptiva: { kind: 'percent' | 'fixo'; value: number } | null }[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    sourceSystem: text('source_system').notNull().default('catalogo_manual'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    uq: uniqueIndex('plans_tenant_name_uq').on(t.tenantId, t.name),
    priceCk: check('plans_price_ck', sql`price_cents >= 0`),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId] }) }),
);

export const teams = pgTable(
  'teams',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('teams_tenant_name_uq').on(t.tenantId, t.name) }),
);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    isLead: boolean('is_lead').notNull().default(false),
  },
  (t) => ({ pk: primaryKey({ columns: [t.teamId, t.userId] }) }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
  },
  (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) }),
);

// --------------------------------------------------------------- origem e campanhas

export const leadSources = pgTable(
  'lead_sources',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('lead_sources_tenant_name_uq').on(t.tenantId, t.name) }),
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    tenantId: tenantId(),
    sourceId: uuid('source_id').references(() => leadSources.id),
    name: text('name').notNull(),
    startsOn: ts('starts_on'),
    endsOn: ts('ends_on'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('campaigns_tenant_name_uq').on(t.tenantId, t.name) }),
);

// --------------------------------------------------------------- pessoas e clientes

/** Pessoa/contato. Não é cliente nem lead: é quem conversa com a empresa. */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    createdBy: uuid('created_by').references(() => users.id),
    isProvisional: boolean('is_provisional').notNull().default(false),
    /** Responsável pela carteira: define o que o vendedor (nível Próprio) enxerga em Clientes. */
    ownerId: uuid('owner_id').references(() => users.id),
    segment: text('segment').notNull().default('residencial'),
    city: text('city'),
    sourceSystem: text('source_system').notNull().default('crm'),
    externalId: text('external_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
    rowVersion: rowVersion(),
  },
  (t) => ({
    segmentCk: check('contacts_segment_ck', inList('segment', ['residencial', 'empresarial', 'governamental', 'institucional'])),
    ownerIdx: index('contacts_tenant_owner_idx').on(t.tenantId, t.ownerId),
    tenantIdx: index('contacts_tenant_name_idx').on(t.tenantId, t.name),
    extUq: uniqueIndex('contacts_ext_uq').on(t.tenantId, t.sourceSystem, t.externalId),
  }),
);

/** Cliente = contato com relação contratual (atual ou passada). Vem do IXC a partir da Fase 3/4. */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    displayName: text('display_name').notNull(),
    lifecycle: text('lifecycle').notNull().default('prospect'),
    planId: uuid('plan_id').references(() => plans.id),
    contractStart: date('contract_start', { mode: 'string' }),
    nextDueOn: date('next_due_on', { mode: 'string' }),
    /** Fim do contrato (cancelamento). Usado na vida média do LTV histórico. */
    contractEnd: date('contract_end', { mode: 'string' }),
    sourceSystem: text('source_system').notNull().default('crm'),
    externalId: text('external_id'),
    sourceUpdatedAt: ts('source_updated_at'),
    ingestedAt: ts('ingested_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    lifecycleCk: check('customers_lifecycle_ck', inList('lifecycle', ['prospect', 'em_implantacao', 'ativo', 'inadimplente', 'suspenso', 'cancelado', 'reativado'])),
    extUq: uniqueIndex('customers_ext_uq').on(t.tenantId, t.sourceSystem, t.externalId),
    contactIdx: index('customers_contact_idx').on(t.tenantId, t.contactId),
  }),
);

export const customerExternalIds = pgTable(
  'customer_external_ids',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    system: text('system').notNull(),
    externalId: text('external_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('customer_ext_ids_uq').on(t.tenantId, t.system, t.externalId) }),
);

export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').references(() => contacts.id),
    customerId: uuid('customer_id').references(() => customers.id),
    street: text('street'),
    number: text('number'),
    complement: text('complement'),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    validFrom: ts('valid_from').notNull().defaultNow(),
    validTo: ts('valid_to'),
    createdAt: createdAt(),
  },
  (t) => ({ contactIdx: index('addresses_contact_idx').on(t.tenantId, t.contactId) }),
);

// --------------------------------------------------------------- leads

export const leads = pgTable(
  'leads',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    status: text('status').notNull().default('novo'),
    sourceId: uuid('source_id').references(() => leadSources.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    ownerId: uuid('owner_id').references(() => users.id),
    interests: text('interests').array().notNull().default(sql`'{}'::text[]`),
    nextAction: text('next_action'),
    nextActionAt: ts('next_action_at'),
    firstContactAt: ts('first_contact_at'),
    lastContactAt: ts('last_contact_at'),
    notes: text('notes'),
    /** Canal do contato (metadado opcional) e descrição da última interação ("Formulário site"). */
    channel: text('channel'),
    lastInteractionNote: text('last_interaction_note'),
    convertedOpportunityId: uuid('converted_opportunity_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
    rowVersion: rowVersion(),
  },
  (t) => ({
    statusCk: check('leads_status_ck', inList('status', ['novo', 'em_contato', 'qualificado', 'convertido', 'descartado'])),
    tenantCreatedIdx: index('leads_tenant_created_idx').on(t.tenantId, t.createdAt),
    tenantOwnerIdx: index('leads_tenant_owner_idx').on(t.tenantId, t.ownerId),
  }),
);

// --------------------------------------------------------------- funil

/** Jornada de venda = um pipeline com etapas próprias. Definidas pelo modelo de instrução ativo. */
export const pipelines = pgTable(
  'pipelines',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    segments: text('segments').array().notNull().default(sql`'{}'::text[]`),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('pipelines_uq').on(t.tenantId, t.key) }),
);

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: id(),
    tenantId: tenantId(),
    pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    isTerminal: boolean('is_terminal').notNull().default(false),
    /** open | won | lost — won/lost têm sempre as chaves 'ganha' / 'perdida'. */
    kind: text('kind').notNull().default('open'),
    color: text('color'),
    /** Exigências para ENTRAR na etapa: { proposta, plano, proximaAcao, respostasObrigatorias }. */
    requirements: jsonb('requirements').$type<{ proposta?: boolean; plano?: boolean; proximaAcao?: boolean; respostasObrigatorias?: boolean }>().notNull().default({}),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    uq: uniqueIndex('pipeline_stages_pipe_uq').on(t.pipelineId, t.key),
    kindCk: check('pipeline_stages_kind_ck', inList('kind', ['open', 'won', 'lost'])),
  }),
);

export const opportunities = pgTable(
  'opportunities',
  {
    id: id(),
    tenantId: tenantId(),
    /** Número sequencial legível (OP-1042). Global, mas só exibido dentro do tenant. */
    code: serial('code').notNull(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    customerId: uuid('customer_id').references(() => customers.id),
    leadId: uuid('lead_id').references(() => leads.id),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    teamId: uuid('team_id').references(() => teams.id),
    title: text('title').notNull(),
    pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id),
    /** Endereço de instalação (90% em condomínio). */
    installCep: text('install_cep'),
    installStreet: text('install_street'),
    installNumber: text('install_number'),
    installDistrict: text('install_district'),
    installCity: text('install_city'),
    condominiumId: uuid('condominium_id').references(() => condominiums.id),
    installBlock: text('install_block'),
    installUnit: text('install_unit'),
    /** Viabilidade: venda ativa/receptiva, metragem, ativação, equipamentos e caminho. */
    saleType: text('sale_type'),
    cableMeters: integer('cable_meters'),
    activationFeeCents: bigint('activation_fee_cents', { mode: 'number' }),
    equipment: jsonb('equipment').$type<{ equipmentId: string; qty: number }[] | null>(),
    routeId: uuid('route_id').references(() => deliveryRoutes.id),
    viability: jsonb('viability').$type<Record<string, unknown> | null>(),
    commissionCents: bigint('commission_cents', { mode: 'number' }),
    cacCents: bigint('cac_cents', { mode: 'number' }),
    marginCents: bigint('margin_cents', { mode: 'number' }),
    paybackMonths: text('payback_months'),
    /** Campos personalizados da jornada: { chave: valor }. */
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    duplicatedFromId: uuid('duplicated_from_id'),
    /** Chave da etapa dentro da jornada (pipeline_stages.key). 'ganha' e 'perdida' são reservadas. */
    stage: text('stage').notNull().default('novo_lead'),
    planId: uuid('plan_id').references(() => plans.id),
    proposalStatus: text('proposal_status').notNull().default('nao_criada'),
    contractRequestStatus: text('contract_request_status').notNull().default('nao_solicitada'),
    coverageStatus: text('coverage_status').notNull().default('nao_consultada'),
    reasons: text('reasons').array().notNull().default(sql`'{}'::text[]`),
    channel: text('channel'),
    sourceId: uuid('source_id').references(() => leadSources.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    valueCents: bigint('value_cents', { mode: 'number' }),
    nextAction: text('next_action'),
    nextActionAt: ts('next_action_at'),
    notes: text('notes'),
    lossReason: text('loss_reason'),
    stageChangedAt: ts('stage_changed_at').notNull().defaultNow(),
    wonAt: ts('won_at'),
    lostAt: ts('lost_at'),
    /** Sprint: tempo acumulado de sessões ativas (Fase 2 usa estes campos). */
    sprintStartedAt: ts('sprint_started_at'),
    sprintElapsedSeconds: integer('sprint_elapsed_seconds').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
    rowVersion: rowVersion(),
  },
  (t) => ({
    pipelineIdx: index('opp_pipeline_idx').on(t.tenantId, t.pipelineId, t.stage),
    proposalCk: check('opp_proposal_ck', inList('proposal_status', ['nao_criada', 'rascunho', 'enviada', 'aceita', 'recusada', 'expirada'])),
    contractCk: check('opp_contract_ck', inList('contract_request_status', ['nao_solicitada', 'pendente', 'enviada', 'erro', 'confirmada', 'rejeitada'])),
    coverageCk: check('opp_coverage_ck', inList('coverage_status', ['nao_consultada', 'pendente', 'elegivel', 'inelegivel', 'indeterminada'])),
    valueCk: check('opp_value_ck', sql`value_cents is null or value_cents >= 0`),
    codeUq: uniqueIndex('opp_code_uq').on(t.code),
    tenantStageIdx: index('opp_tenant_stage_idx').on(t.tenantId, t.stage),
    tenantOwnerIdx: index('opp_tenant_owner_idx').on(t.tenantId, t.ownerId),
    tenantUpdatedIdx: index('opp_tenant_updated_idx').on(t.tenantId, t.updatedAt),
    contactIdx: index('opp_contact_idx').on(t.tenantId, t.contactId),
  }),
);

/** Eventos append-only: nunca atualizados nem apagados pela aplicação. */
export const opportunityEvents = pgTable(
  'opportunity_events',
  {
    id: id(),
    tenantId: tenantId(),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    type: text('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    reason: text('reason'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    rowVersion: integer('row_version'),
    sourceSystem: text('source_system').notNull().default('crm'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    observedAt: ts('observed_at').notNull().defaultNow(),
  },
  (t) => ({ oppIdx: index('opp_events_opp_idx').on(t.tenantId, t.opportunityId, t.occurredAt) }),
);

// --------------------------------------------------------------- atividades

export const activities = pgTable(
  'activities',
  {
    id: id(),
    tenantId: tenantId(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    dueAt: ts('due_at'),
    priority: text('priority').notNull().default('media'),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    leadId: uuid('lead_id').references(() => leads.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    completedAt: ts('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
    rowVersion: rowVersion(),
  },
  (t) => ({
    typeCk: check('activities_type_ck', inList('type', ['tarefa', 'ligacao', 'reuniao', 'email', 'whatsapp', 'visita'])),
    priorityCk: check('activities_priority_ck', inList('priority', ['baixa', 'media', 'alta'])),
    ownerDueIdx: index('activities_owner_due_idx').on(t.tenantId, t.ownerId, t.dueAt),
    oppIdx: index('activities_opp_idx').on(t.tenantId, t.opportunityId),
  }),
);

export const activityEvents = pgTable(
  'activity_events',
  {
    id: id(),
    tenantId: tenantId(),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
    type: text('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => ({ actIdx: index('activity_events_act_idx').on(t.tenantId, t.activityId) }),
);

// --------------------------------------------------------------- auditoria

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    requestId: text('request_id'),
    ip: text('ip'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => ({ tenantIdx: index('audit_tenant_created_idx').on(t.tenantId, t.createdAt) }),
);

// --------------------------------------------------------------- modelo de instrução, roteiro, anexos, e-mail

/** Versões do modelo de instrução da inteligência do negócio. Só uma 'ativa' por empresa. */
export const businessInstructions = pgTable(
  'business_instructions',
  {
    id: id(),
    tenantId: tenantId(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('rascunho'),
    content: jsonb('content').notNull(),
    changes: jsonb('changes').$type<string[]>().notNull().default([]),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    activatedBy: uuid('activated_by').references(() => users.id),
    activatedAt: ts('activated_at'),
  },
  (t) => ({
    uq: uniqueIndex('business_instructions_version_uq').on(t.tenantId, t.version),
    activeUq: uniqueIndex('business_instructions_active_uq').on(t.tenantId).where(sql`status = 'ativa'`),
    statusCk: check('business_instructions_status_ck', inList('status', ['rascunho', 'ativa', 'arquivada'])),
  }),
);

/** Respostas do roteiro do Sprint por oportunidade. */
export const opportunityAnswers = pgTable(
  'opportunity_answers',
  {
    tenantId: tenantId(),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    questionId: text('question_id').notNull(),
    answer: text('answer').notNull(),
    instructionVersion: integer('instruction_version'),
    answeredBy: uuid('answered_by').references(() => users.id),
    answeredAt: ts('answered_at').notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.opportunityId, t.questionId] }) }),
);

/** Anexos da oportunidade (proposta e outros). Guardados no banco, até 3 MB. */
export const opportunityAttachments = pgTable(
  'opportunity_attachments',
  {
    id: id(),
    tenantId: tenantId(),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    kind: text('kind').notNull().default('proposta'),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    data: bytea('data').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id),
  },
  (t) => ({
    oppIdx: index('opp_attach_opp_idx').on(t.tenantId, t.opportunityId),
    kindCk: check('opp_attach_kind_ck', inList('kind', ['proposta', 'outro'])),
  }),
);

/** Servidor SMTP da empresa. A senha fica cifrada (AES-256-GCM) e nunca volta para a tela. */
export const smtpSettings = pgTable('smtp_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  secure: boolean('secure').notNull().default(false),
  username: text('username'),
  passwordEnc: text('password_enc'),
  fromName: text('from_name').notNull(),
  fromEmail: text('from_email').notNull(),
  replyTo: text('reply_to'),
  enabled: boolean('enabled').notNull().default(true),
  lastTestAt: ts('last_test_at'),
  lastTestOk: boolean('last_test_ok'),
  lastTestError: text('last_test_error'),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

/** Quais alertas automáticos por e-mail estão ligados. */
export const notificationSettings = pgTable('notification_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  activityDigest: boolean('activity_digest').notNull().default(true),
  leadAssigned: boolean('lead_assigned').notNull().default(true),
  dealWon: boolean('deal_won').notNull().default(true),
  userAccess: boolean('user_access').notNull().default(true),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

/** Registro de cada e-mail enviado ou que falhou. */
export const emailMessages = pgTable(
  'email_messages',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    toAddress: text('to_address').notNull(),
    subject: text('subject').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    messageId: text('message_id'),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    attachmentId: uuid('attachment_id').references(() => opportunityAttachments.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    tenantIdx: index('email_messages_tenant_idx').on(t.tenantId, t.createdAt),
    statusCk: check('email_messages_status_ck', inList('status', ['enviado', 'falhou', 'ignorado'])),
  }),
);

// --------------------------------------------------------------- jornadas pelo painel

export const pipelineMembers = pgTable(
  'pipeline_members',
  {
    pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id),
    userId: uuid('user_id').notNull().references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.pipelineId, t.userId] }) }),
);

export const pipelineFields = pgTable(
  'pipeline_fields',
  {
    id: id(),
    tenantId: tenantId(),
    pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull().default('texto'),
    options: text('options').array().notNull().default(sql`'{}'::text[]`),
    required: boolean('required').notNull().default(false),
    position: integer('position').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    uq: uniqueIndex('pipeline_fields_uq').on(t.pipelineId, t.key),
    typeCk: check('pipeline_fields_type_ck', inList('type', ['texto', 'texto_longo', 'numero', 'moeda', 'data', 'lista', 'sim_nao'])),
  }),
);

export const pipelineAutomations = pgTable(
  'pipeline_automations',
  {
    id: id(),
    tenantId: tenantId(),
    pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull(),
    actions: jsonb('actions').$type<Record<string, unknown>[]>().notNull(),
    position: integer('position').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ pipeIdx: index('pipeline_automations_pipe_idx').on(t.pipelineId) }),
);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: id(),
    tenantId: tenantId(),
    automationId: uuid('automation_id').notNull().references(() => pipelineAutomations.id),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    status: text('status').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => ({
    oppIdx: index('automation_runs_opp_idx').on(t.opportunityId, t.automationId),
    statusCk: check('automation_runs_status_ck', inList('status', ['ok', 'erro', 'ignorado'])),
  }),
);

// --------------------------------------------------------------- área de atendimento

export const regions = pgTable(
  'regions',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('regions_uq').on(t.tenantId, sql`lower(${t.name})`) }),
);

export const condominiums = pgTable(
  'condominiums',
  {
    id: id(),
    tenantId: tenantId(),
    regionId: uuid('region_id').notNull().references(() => regions.id),
    name: text('name').notNull(),
    cep: text('cep'),
    street: text('street'),
    number: text('number'),
    district: text('district'),
    city: text('city'),
    blocks: text('blocks').array().notNull().default(sql`'{}'::text[]`),
    units: integer('units'),
    hasNetwork: boolean('has_network').notNull().default(false),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({ regionIdx: index('condominiums_region_idx').on(t.tenantId, t.regionId) }),
);

// --------------------------------------------------------------- viabilidade

/** Tributos (kind=tributo) e parceiros/fornecedores (kind=parceiro): % da mensalidade ou valor fixo mensal. */
export const viabilityDeductions = pgTable(
  'viability_deductions',
  {
    id: id(),
    tenantId: tenantId(),
    category: text('category').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    percentBp: integer('percent_bp').notNull().default(0),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull().default(0),
    routeIds: uuid('route_ids').array().notNull().default(sql`'{}'::uuid[]`),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({
    catCk: check('viability_deductions_cat_ck', inList('category', ['tributo', 'parceiro'])),
    kindCk: check('viability_deductions_kind_ck', inList('kind', ['percent', 'fixed'])),
  }),
);

export const equipmentItems = pgTable('equipment_items', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  costCents: bigint('cost_cents', { mode: 'number' }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** Caminho de entrega: custo do cabo por metro, instalação, custo mensal e kit de equipamentos. */
export const deliveryRoutes = pgTable('delivery_routes', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  cablePerMeterCents: bigint('cable_per_meter_cents', { mode: 'number' }).notNull().default(0),
  installCostCents: bigint('install_cost_cents', { mode: 'number' }).notNull().default(0),
  monthlyCostCents: bigint('monthly_cost_cents', { mode: 'number' }).notNull().default(0),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  kit: jsonb('kit').$type<{ equipmentId: string; qty: number }[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** Regra de distância e banda: a primeira que casar (pela posição) escolhe o caminho. */
export const routeRules = pgTable('route_rules', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  minMeters: integer('min_meters'),
  maxMeters: integer('max_meters'),
  minMbps: integer('min_mbps'),
  maxMbps: integer('max_mbps'),
  routeId: uuid('route_id').notNull().references(() => deliveryRoutes.id),
  active: boolean('active').notNull().default(true),
});

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    saleType: text('sale_type').notNull().default('qualquer'),
    minPriceCents: bigint('min_price_cents', { mode: 'number' }),
    maxPriceCents: bigint('max_price_cents', { mode: 'number' }),
    kind: text('kind').notNull(),
    percentBp: integer('percent_bp').notNull().default(0),
    multiplierX100: integer('multiplier_x100').notNull().default(0),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    saleCk: check('commission_rules_sale_ck', inList('sale_type', ['ativa', 'receptiva', 'qualquer'])),
    kindCk: check('commission_rules_kind_ck', inList('kind', ['percent', 'mensalidades', 'fixo'])),
  }),
);

export const viabilitySettings = pgTable('viability_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  defaultRouteId: uuid('default_route_id').references(() => deliveryRoutes.id),
  ltvLifetimeMonths: integer('ltv_lifetime_months'),
  monthlyChurnBp: integer('monthly_churn_bp'),
  ltvMinSample: integer('ltv_min_sample').notNull().default(30),
  maxPaybackMonths: integer('max_payback_months'),
  defaultActivationFeeCents: bigint('default_activation_fee_cents', { mode: 'number' }),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});
