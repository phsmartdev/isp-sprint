/**
 * Modelo relacional — Fase 1 (fundação CRM).
 * Convenções (spec §7): UUID interno, tenant_id em toda tabela de negócio, timestamptz (UTC),
 * row_version para concorrência otimista, dinheiro em centavos inteiros, enums como text + CHECK
 * (mais fáceis de evoluir que tipos enum do Postgres).
 * Tabelas de IXC, propostas, contratos e analytics entram nas fases seguintes.
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb, primaryKey, uniqueIndex, index, check, bigint, serial, date, customType, doublePrecision, type AnyPgColumn,
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
    /** WhatsApp para avisos internos (pedidos de aprovação). */
    phone: text('phone'),
    /** Metas mensais usadas em "Meta do mês" e "Meu desempenho" no Início. */
    goalSales: integer('goal_sales').notNull().default(0),
    goalProposals: integer('goal_proposals').notNull().default(0),
    goalLeads: integer('goal_leads').notNull().default(0),
    /** Setores (Comercial, Financeiro, Jurídico...): definem quem recebe tarefas e quem conclui cada etapa dos contratos. */
    sectors: text('sectors').array().notNull().default(sql`'{}'::text[]`),
    /** Conta Google vinculada no primeiro login com Google (identificador "sub"). */
    googleSub: text('google_sub'),
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
    moduleCk: check('access_module_ck', inList('module', ['inicio', 'leads', 'oportunidades', 'clientes', 'atividades', 'relatorios', 'campanhas', 'contratos', 'projetos', 'desempenho', 'resultados', 'inteligencia', 'email', 'configuracoes'])),
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
    /** Custo mensal de parceiros cobrados por plano (ex.: PlayHub), por id do parceiro, em centavos. Só residencial. */
    partnerCosts: jsonb('partner_costs').$type<Record<string, number>>().notNull().default({}),
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
    /** Gestão de Resultados: unidade organizacional a que o time pertence e líder substituto */
    orgUnitId: uuid('org_unit_id'),
    substituteLeadId: uuid('substitute_lead_id'),
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

/** Redefinição de senha por e-mail: só o hash do código, uso único, expira em 1 hora. */
export const passwordResets = pgTable('password_resets', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});

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
    // concepção
    objective: text('objective'),
    audience: text('audience'),
    offer: text('offer'),
    message: text('message'),
    channels: text('channels').array().notNull().default(sql`'{}'::text[]`),
    notes: text('notes'),
    ownerId: uuid('owner_id').references(() => users.id),
    /** Orçamento total previsto, em centavos. */
    budgetCents: bigint('budget_cents', { mode: 'number' }),
    targetLeads: integer('target_leads'),
    targetSales: integer('target_sales'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ uq: uniqueIndex('campaigns_tenant_name_uq').on(t.tenantId, t.name) }),
);

/** Gastos realizados da campanha (mídia, produção, brindes…). */
export const campaignCosts = pgTable(
  'campaign_costs',
  {
    id: id(),
    tenantId: tenantId(),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ byCampaign: index('campaign_costs_campaign_idx').on(t.tenantId, t.campaignId) }),
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
    /** CPF ou CNPJ (opcional; vem do IXC ou da importação). */
    document: text('document'),
    createdBy: uuid('created_by').references(() => users.id),
    isProvisional: boolean('is_provisional').notNull().default(false),
    /** Responsável pela carteira: define o que o vendedor (nível Próprio) enxerga em Clientes. */
    ownerId: uuid('owner_id').references(() => users.id),
    segment: text('segment').notNull().default('residencial'),
    city: text('city'),
    /** natureza da organização (pública/privada); preenchida aos poucos, sem obrigar */
    nature: text('nature'),
    sourceSystem: text('source_system').notNull().default('crm'),
    externalId: text('external_id'),
    /** Valores dos campos personalizados de cliente (definidos em customer_fields). */
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
    rowVersion: rowVersion(),
  },
  (t) => ({
    segmentCk: check('contacts_segment_ck', inList('segment', ['residencial', 'empresarial', 'governamental', 'institucional'])),
    natureCk: check('contacts_nature_ck', sql`nature is null or nature in ('publica', 'privada')`),
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
    /** Motivo do cancelamento (vem do IXC na integração; aqui pode ser informado à mão). */
    cancelReason: text('cancel_reason'),
    /** Condomínio onde o cliente está instalado (mapa por zona e condomínio). */
    condominiumId: uuid('condominium_id'),
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
    /** Viabilidade da engenharia: nao_necessaria | pendente | aprovada | reprovada. */
    engineeringStatus: text('engineering_status').notNull().default('nao_necessaria'),
    /** Porta da CTO liberada (cliente cancelou). Venda fechada sem esta data ocupa uma porta do condomínio. */
    portReleasedAt: ts('port_released_at'),
    portReleaseReason: text('port_release_reason'),
    engineeringTicket: text('engineering_ticket'),
    executiveTicket: text('executive_ticket'),
    /** Contrato por medição de onde sai o consumo quando a venda fecha (e o valor consumido). */
    measurementContractId: uuid('measurement_contract_id'),
    measurementCents: bigint('measurement_cents', { mode: 'number' }),
    /** Ata de registro de preços de origem (não gera negócio no Sucesso do Cliente). */
    arpId: uuid('arp_id'),
    /** Pós-venda: 'sucesso_cliente' quando o contrato foi cadastrado e validado. */
    handoffStage: text('handoff_stage'),
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
    contractId: uuid('contract_id'),
    completedAt: ts('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
    rowVersion: rowVersion(),
    /** Sucesso do Cliente: tipo do acompanhamento (contato, visita, revisão…); a data prevista não muda com reagendamento. */
    csKind: text('cs_kind'),
    csPlannedAt: date('cs_planned_at', { mode: 'string' }),
    /** chave da cadência (idempotência: uma por conta e data) */
    csCadenceKey: text('cs_cadence_key'),
    /** peso da criticidade da conta quando o acompanhamento foi previsto (a apuração histórica mantém o peso da época) */
    csWeight: integer('cs_weight'),
    /** resultado registrado: sem resultado, a execução não conta na cobertura */
    csResult: text('cs_result'),
    csPlanId: uuid('cs_plan_id'),
    /** Projetos: tarefa pertence a um projeto, numa etapa do quadro, opcionalmente ligada a um marco */
    projectId: uuid('project_id').references((): AnyPgColumn => projects.id),
    projectStageId: uuid('project_stage_id'),
    milestoneId: uuid('milestone_id'),
    startOn: date('start_on', { mode: 'string' }),
    position: integer('position').notNull().default(0),
    /** Tarefas (Etapa 4): situação de trabalho; concluída ⇔ completed_at preenchido */
    status: text('status').notNull().default('a_fazer'),
    parentId: uuid('parent_id').references((): AnyPgColumn => activities.id),
    checklist: jsonb('checklist').$type<import('@isp/domain').ChecklistItem[]>().notNull().default(sql`'[]'::jsonb`),
    estimateMinutes: integer('estimate_minutes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    category: text('category'),
    participants: uuid('participants').array().notNull().default(sql`'{}'::uuid[]`),
    waitingOn: text('waiting_on'),
    recurrence: jsonb('recurrence').$type<import('@isp/domain').Recurrence>(),
    seriesId: uuid('series_id'),
    /** idempotência da recorrência: uma ocorrência por série e data */
    recurrenceKey: text('recurrence_key'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    approverId: uuid('approver_id').references(() => users.id),
    approvedAt: ts('approved_at'),
    approvedBy: uuid('approved_by').references(() => users.id),
    arpId: uuid('arp_id'),
    /** ABM Fase 6: pessoas da conta (stakeholders) com quem foi a interação */
    stakeholderIds: uuid('stakeholder_ids').array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => ({
    csCadenceUq: uniqueIndex('activities_cs_cadence_uq').on(t.tenantId, t.contactId, t.csCadenceKey).where(sql`cs_cadence_key is not null`),
    csIdx: index('activities_cs_idx').on(t.tenantId, t.contactId, t.csPlannedAt),
    typeCk: check('activities_type_ck', inList('type', ['tarefa', 'ligacao', 'reuniao', 'email', 'whatsapp', 'visita'])),
    priorityCk: check('activities_priority_ck', inList('priority', ['baixa', 'media', 'alta'])),
    ownerDueIdx: index('activities_owner_due_idx').on(t.tenantId, t.ownerId, t.dueAt),
    oppIdx: index('activities_opp_idx').on(t.tenantId, t.opportunityId),
    projectIdx: index('activities_project_idx').on(t.tenantId, t.projectId, t.projectStageId, t.position),
    statusCk: check('activities_status_ck', inList('status', ['a_fazer', 'em_andamento', 'aguardando', 'em_aprovacao', 'concluida', 'cancelada'])),
    parentIdx: index('activities_parent_idx').on(t.tenantId, t.parentId),
    recurrenceUq: uniqueIndex('activities_recurrence_uq').on(t.tenantId, t.recurrenceKey).where(sql`recurrence_key is not null`),
    linksIdx: index('activities_links_idx').on(t.tenantId, t.contractId, t.arpId),
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
    contractId: uuid('contract_id'),
    ccAddress: text('cc_address'),
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

/** Campos personalizados da ficha do cliente (iguais para toda a empresa). */
export const customerFields = pgTable(
  'customer_fields',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull().default('texto'),
    options: text('options').array().notNull().default(sql`'{}'::text[]`),
    required: boolean('required').notNull().default(false),
    position: integer('position').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    uq: uniqueIndex('customer_fields_uq').on(t.tenantId, t.key),
    typeCk: check('customer_fields_type_ck', inList('type', ['texto', 'texto_longo', 'numero', 'moeda', 'data', 'lista', 'sim_nao'])),
  }),
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
    /** Total de portas da CTO que atende o condomínio. Venda fechada ocupa uma; cancelamento libera. */
    ctoPorts: integer('cto_ports'),
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
    /** Percentual sobre a mensalidade menos estes parceiros (ex.: ISS sobre o que sobra após a UPNET). */
    baseExcludeIds: uuid('base_exclude_ids').array().notNull().default(sql`'{}'::uuid[]`),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({
    catCk: check('viability_deductions_cat_ck', inList('category', ['tributo', 'parceiro'])),
    kindCk: check('viability_deductions_kind_ck', inList('kind', ['percent', 'fixed', 'per_plan'])),
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
  /** condominio | rua: caminho padrão para esse tipo de endereço. */
  appliesTo: text('applies_to'),
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
  /** Limite de autonomia da operação (acima: viabilidade da engenharia). */
  autonomyMaxMeters: integer('autonomy_max_meters').default(100),
  autonomyMaxMbps: integer('autonomy_max_mbps').default(500),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

// ------------------------------------------------------------------ integrações (IXC, WhatsApp, Meta, Site)
export const integrations = pgTable(
  'integrations',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** Configuração sem segredo (endereço, ids, responsável e origem padrão dos leads). */
    config: jsonb('config').$type<Record<string, string | null>>().notNull().default({}),
    /** Segredos cifrados (AES-256-GCM), por nome. Nunca voltam para a tela. */
    secrets: jsonb('secrets').$type<Record<string, string>>().notNull().default({}),
    /** Código secreto na URL do webhook (recebimento). */
    webhookToken: text('webhook_token').notNull(),
    lastEventAt: ts('last_event_at'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.kind] }),
    tokenUq: uniqueIndex('integrations_token_uq').on(t.webhookToken),
    kindCk: check('integrations_kind_ck', inList('kind', ['ixc', 'zapi', 'zapsign', 'whatsapp', 'meta', 'site'])),
  }),
);

export const integrationEvents = pgTable(
  'integration_events',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    /** recebido | lead_criado | duplicado | ignorado | erro */
    status: text('status').notNull(),
    summary: text('summary').notNull(),
    leadId: uuid('lead_id'),
    createdAt: createdAt(),
  },
  (t) => ({ byTenant: index('integration_events_tenant_idx').on(t.tenantId, t.createdAt) }),
);

// ------------------------------------------------------------------ modelos de proposta (arte do Canva + campos variáveis)
export type ProposalField = { id: string; page: number; x: number; y: number; w: number; size: number; color: string; align: 'left' | 'center' | 'right'; bold: boolean; text: string; strike?: boolean };
export type ProposalVariable = { key: string; label: string; type: 'texto' | 'texto_longo' | 'moeda'; default: string };
export const proposalTemplates = pgTable('proposal_templates', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  /** Tipos de deal que usam este modelo (ex.: empresarial = Yepempresa). */
  segments: text('segments').array().notNull().default(sql`'{}'::text[]`),
  fields: jsonb('fields').$type<ProposalField[]>().notNull().default([]),
  variables: jsonb('variables').$type<ProposalVariable[]>().notNull().default([]),
  /** proposta (oportunidade) ou contrato (Gestão de Contratos): mesmo editor de arte + campos. */
  purpose: text('purpose').notNull().default('proposta'),
  /** Para modelos de contrato: tipo de contrato que usa o modelo (vazio = todos). */
  billingType: text('billing_type'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const proposalTemplatePages = pgTable('proposal_template_pages', {
  id: id(),
  tenantId: tenantId(),
  templateId: uuid('template_id').notNull().references(() => proposalTemplates.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  mime: text('mime').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

// --------------------------------------------------------------- gestão de contratos

export const contractSettings = pgTable('contract_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
});

/** Cabeçalho do contrato. Dados contratuais ficam em contract_versions (só INSERT). Cliente vem de contacts (sem cópia). */
export const contracts = pgTable(
  'contracts',
  {
    id: id(),
    tenantId: tenantId(),
    code: serial('code').notNull(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    customerId: uuid('customer_id').references(() => customers.id),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    /** Contratação decorrente de ata de registro de preços (registro jurídico próprio, vinculado à ARP). */
    arpId: uuid('arp_id'),
    kind: text('kind').notNull().default('privado'),
    legalRegime: text('legal_regime').notNull().default('privado'),
    /** Recorrente (mensalidade fixa), Frequente (lançamentos por ocorrência) ou Medição (consumo de saldo). */
    billingType: text('billing_type').notNull().default('recorrente'),
    stage: text('stage').notNull().default('cadastro_validacao'),
    stageChangedAt: ts('stage_changed_at').notNull().defaultNow(),
    currentVersion: integer('current_version').notNull().default(1),
    commercialOwnerId: uuid('commercial_owner_id').notNull().references(() => users.id),
    operationalOwnerId: uuid('operational_owner_id').references(() => users.id),
    csmId: uuid('csm_id').references(() => users.id),
    validatedAt: ts('validated_at'),
    validatedBy: uuid('validated_by').references(() => users.id),
    erpRef: text('erp_ref'),
    renewed: boolean('renewed').notNull().default(false),
    /** Encerramento previsto (sem renovação, limite legal ou decisão registrada). Nunca encerra sozinho. */
    closureExpected: boolean('closure_expected').notNull().default(false),
    closureReason: text('closure_reason'),
    closureAt: date('closure_at', { mode: 'string' }),
    /** Limite total de vigência informado e validado por uma pessoa (sugestão pelo regime). */
    legalLimitAt: date('legal_limit_at', { mode: 'string' }),
    closedAt: ts('closed_at'),
    archivedAt: ts('archived_at'),
    archiveLocation: text('archive_location'),
    archiveResponsibleId: uuid('archive_responsible_id').references(() => users.id),
    finalNote: text('final_note'),
    nextAction: text('next_action'),
    nextActionAt: date('next_action_at', { mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    stageCk: check('contracts_stage_ck', inList('stage', ['cadastro_validacao', 'implantacao', 'vigente', 'renovacao', 'reajuste', 'encerramento', 'arquivado'])),
    kindCk: check('contracts_kind_ck', inList('kind', ['privado', 'publico'])),
    billingCk: check('contracts_billing_ck', inList('billing_type', ['recorrente', 'frequente', 'medicao'])),
    regimeCk: check('contracts_regime_ck', inList('legal_regime', ['privado', 'lei_8666', 'lei_14133', 'outro'])),
    codeUq: uniqueIndex('contracts_code_uq').on(t.code),
    oppUq: uniqueIndex('contracts_opp_uq').on(t.opportunityId),
    tenantStageIdx: index('contracts_tenant_stage_idx').on(t.tenantId, t.stage),
    contactIdx: index('contracts_contact_idx').on(t.tenantId, t.contactId),
  }),
);

export type ContractItem = { planId: string | null; description: string; qty: number; unitCents: number };
export type ContractGuarantee = { type: string; amountCents: number | null; insurer: string | null; policy: string | null; expiresAt: string | null; renewalAt: string | null };
export type ContractPublicTerms = { agency: string | null; processNumber: string | null; modality: string | null; commitmentNote: string | null; budgetLine: string | null; extensionMaxMonths: number | null };

/** Versões do contrato: append-only. Cada alteração relevante é um INSERT com motivo. */
export const contractVersions = pgTable(
  'contract_versions',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    version: integer('version').notNull(),
    changeKind: text('change_kind').notNull().default('cadastro'),
    reason: text('reason'),
    number: text('number').notNull(),
    object: text('object').notNull(),
    signedAt: date('signed_at', { mode: 'string' }),
    startAt: date('start_at', { mode: 'string' }),
    endAt: date('end_at', { mode: 'string' }),
    termMonths: integer('term_months'),
    activationAt: date('activation_at', { mode: 'string' }),
    billingStartAt: date('billing_start_at', { mode: 'string' }),
    renewalAt: date('renewal_at', { mode: 'string' }),
    monthlyCents: bigint('monthly_cents', { mode: 'number' }).notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }),
    billingDay: integer('billing_day'),
    billingTerms: text('billing_terms'),
    items: jsonb('items').$type<ContractItem[]>().notNull().default([]),
    guarantee: jsonb('guarantee').$type<ContractGuarantee | null>(),
    publicTerms: jsonb('public_terms').$type<ContractPublicTerms | null>(),
    adjustmentIndex: text('adjustment_index'),
    adjustmentBaseDate: date('adjustment_base_date', { mode: 'string' }),
    adjustmentRule: text('adjustment_rule'),
    specialConditions: text('special_conditions'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    uq: uniqueIndex('contract_versions_uq').on(t.contractId, t.version),
    changeCk: check('contract_versions_change_ck', inList('change_kind', ['cadastro', 'edicao', 'ativacao', 'renovacao', 'reajuste', 'encerramento'])),
    valueCk: check('contract_versions_value_ck', sql`monthly_cents >= 0`),
  }),
);

/** Linha do tempo do contrato: append-only. */
export const contractEvents = pgTable(
  'contract_events',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    type: text('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => ({ idx: index('contract_events_idx').on(t.tenantId, t.contractId, t.occurredAt) }),
);

export type ProcessStepState = { doneAt: string; doneBy: string; doneByName: string; note: string | null; value: unknown; skipped?: boolean };
/** Processos paralelos (implantação, renovação, reajuste, encerramento), cada um com o próprio roteiro. */
export const contractProcesses = pgTable(
  'contract_processes',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    kind: text('kind').notNull(),
    cycleKey: text('cycle_key').notNull(),
    status: text('status').notNull().default('aberto'),
    steps: jsonb('steps').$type<Record<string, ProcessStepState>>().notNull().default({}),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    ownerId: uuid('owner_id').references(() => users.id),
    dueAt: date('due_at', { mode: 'string' }),
    outcome: text('outcome'),
    openedBy: uuid('opened_by').references(() => users.id),
    openedAt: ts('opened_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by').references(() => users.id),
    rowVersion: rowVersion(),
  },
  (t) => ({
    uq: uniqueIndex('contract_processes_uq').on(t.contractId, t.kind, t.cycleKey),
    kindCk: check('contract_processes_kind_ck', inList('kind', ['implantacao', 'renovacao', 'reajuste', 'encerramento'])),
    statusCk: check('contract_processes_status_ck', inList('status', ['aberto', 'concluido', 'cancelado'])),
  }),
);

/** Documentos do contrato. Nova versão = novo registro no mesmo grupo; nada é sobrescrito. */
export const contractDocuments = pgTable(
  'contract_documents',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    processId: uuid('process_id').references(() => contractProcesses.id),
    groupId: uuid('group_id').notNull(),
    version: integer('version').notNull().default(1),
    category: text('category').notNull(),
    name: text('name').notNull(),
    docDate: date('doc_date', { mode: 'string' }).notNull(),
    summary: text('summary').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    data: bytea('data').notNull(),
    folder: text('folder').notNull().default('Ativos'),
    /** Setores que podem abrir. Vazio = todos com acesso ao contrato. */
    restrictedTo: text('restricted_to').array().notNull().default(sql`'{}'::text[]`),
    signed: boolean('signed').notNull().default(false),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by'),
  },
  (t) => ({
    idx: index('contract_documents_idx').on(t.tenantId, t.contractId),
    groupUq: uniqueIndex('contract_documents_group_uq').on(t.groupId, t.version),
    folderCk: check('contract_documents_folder_ck', inList('folder', ['Ativos', 'Encerrados'])),
  }),
);

/** Alertas/notificações do contrato: um por evento (contrato + tipo + ciclo). */
export const contractAlerts = pgTable(
  'contract_alerts',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    kind: text('kind').notNull(),
    cycleKey: text('cycle_key').notNull(),
    dueAt: date('due_at', { mode: 'string' }),
    ownerId: uuid('owner_id').references(() => users.id),
    status: text('status').notNull().default('aberto'),
    detail: text('detail'),
    activityIds: uuid('activity_ids').array().notNull().default(sql`'{}'::uuid[]`),
    emails: jsonb('emails').$type<{ to: string; status: string; error: string | null }[]>().notNull().default([]),
    createdAt: createdAt(),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolution: text('resolution'),
  },
  (t) => ({
    uq: uniqueIndex('contract_alerts_uq').on(t.contractId, t.kind, t.cycleKey),
    statusCk: check('contract_alerts_status_ck', inList('status', ['aberto', 'concluido', 'cancelado'])),
    openIdx: index('contract_alerts_open_idx').on(t.tenantId, t.status, t.dueAt),
  }),
);

/** Extrato do contrato (append-only): créditos de saldo, consumos, estornos e lançamentos de faturamento. */
export const contractLedger = pgTable(
  'contract_ledger',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    kind: text('kind').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    reversesId: uuid('reverses_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    idx: index('contract_ledger_idx').on(t.tenantId, t.contractId, t.occurredOn),
    kindCk: check('contract_ledger_kind_ck', inList('kind', ['credito', 'consumo', 'estorno', 'faturamento'])),
    amountCk: check('contract_ledger_amount_ck', sql`amount_cents > 0`),
    oppIdx: index('contract_ledger_opp_idx').on(t.opportunityId),
  }),
);

/** Modelos de contrato (Word com {{variáveis}}). */
export const contractTemplates = pgTable(
  'contract_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    billingType: text('billing_type'),
    docType: text('doc_type').notNull().default('CONTRATO'),
    variables: jsonb('variables').$type<{ key: string; label: string; type: 'texto' | 'moeda' | 'data' | 'numero'; default: string }[]>().notNull().default([]),
    detected: text('detected').array().notNull().default(sql`'{}'::text[]`),
    fileName: text('file_name').notNull(),
    size: integer('size').notNull(),
    data: bytea('data').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({ idx: index('contract_templates_idx').on(t.tenantId) }),
);

/** Envio para assinatura eletrônica (ZapSign). */
export const contractSignatures = pgTable(
  'contract_signatures',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    documentId: uuid('document_id').notNull().references(() => contractDocuments.id),
    provider: text('provider').notNull().default('zapsign'),
    providerToken: text('provider_token'),
    status: text('status').notNull().default('enviado'),
    signers: jsonb('signers').$type<{ name: string; email: string | null; phone: string | null; token: string | null; signUrl: string | null; status: string; signedAt: string | null }[]>().notNull().default([]),
    signedDocumentId: uuid('signed_document_id').references(() => contractDocuments.id),
    error: text('error'),
    sandbox: boolean('sandbox').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    idx: index('contract_signatures_idx').on(t.tenantId, t.contractId),
    tokenIdx: index('contract_signatures_token_idx').on(t.providerToken),
    statusCk: check('contract_signatures_status_ck', inList('status', ['enviado', 'assinado', 'recusado', 'cancelado', 'erro'])),
  }),
);

// --------------------------------------------------------------- análise e aprovação da negociação

/** Parâmetros das aprovações por empresa: alçadas, opções da classificação e aviso por WhatsApp/e-mail. */
export const approvalSettings = pgTable('approval_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  policy: jsonb('policy').$type<{ limits: { level: string; maxDiscountBp: number; minMarginBp: number | null }[] }>(),
  classificationOptions: jsonb('classification_options').$type<Record<string, string[]>>(),
  notifyEmail: boolean('notify_email').notNull().default(true),
  notifyWhatsapp: boolean('notify_whatsapp').notNull().default(false),
  /** Mostrar a classe estratégica no aviso por WhatsApp/e-mail. */
  notifyShowClass: boolean('notify_show_class').notNull().default(false),
  template: text('template'),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

/** Classificação estratégica do cliente. Append-only: a vigente é a mais recente. */
export const contactClassifications = pgTable(
  'contact_classifications',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    classKey: text('class_key'),
    category: text('category'),
    profile: text('profile'),
    payerProfile: text('payer_profile'),
    potential: text('potential'),
    risk: text('risk'),
    notes: text('notes'),
    classifiedBy: uuid('classified_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('contact_classifications_idx').on(t.tenantId, t.contactId, t.createdAt) }),
);

/** Identidades possivelmente duplicadas: a decisão (mesmo cliente ou não) é de uma pessoa. Append-only; vale a mais recente. */
export const contactIdentityLinks = pgTable(
  'contact_identity_links',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    otherContactId: uuid('other_contact_id').notNull().references(() => contacts.id),
    decision: text('decision').notNull(),
    note: text('note'),
    decidedBy: uuid('decided_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    idx: index('contact_identity_links_idx').on(t.tenantId, t.contactId),
    decisionCk: check('contact_identity_links_decision_ck', inList('decision', ['mesmo', 'diferente'])),
  }),
);

/** Pedido de aprovação = uma versão da proposta. Imutável; a decisão fica em approval_decisions. */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    tenantId: tenantId(),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    version: integer('version').notNull(),
    requestedBy: uuid('requested_by').notNull().references(() => users.id),
    negotiationType: text('negotiation_type').notNull(),
    listMonthlyCents: bigint('list_monthly_cents', { mode: 'number' }),
    proposedMonthlyCents: bigint('proposed_monthly_cents', { mode: 'number' }).notNull(),
    discountBp: integer('discount_bp').notNull().default(0),
    activationFeeCents: bigint('activation_fee_cents', { mode: 'number' }),
    replacesMonthlyCents: bigint('replaces_monthly_cents', { mode: 'number' }).notNull().default(0),
    termMonths: integer('term_months'),
    conditions: text('conditions'),
    justification: text('justification').notNull(),
    risks: text('risks'),
    proposalAttachmentId: uuid('proposal_attachment_id'),
    proposalSha256: text('proposal_sha256'),
    requiredLevel: text('required_level').notNull(),
    exceptional: boolean('exceptional').notNull().default(false),
    /** Resumo financeiro e de contexto no momento do pedido (o que o aprovador viu). */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    fingerprint: jsonb('fingerprint').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    uq: uniqueIndex('approval_requests_uq').on(t.opportunityId, t.version),
    tenantIdx: index('approval_requests_tenant_idx').on(t.tenantId, t.createdAt),
    levelCk: check('approval_requests_level_ck', inList('required_level', ['supervisor', 'gerencia', 'diretoria'])),
  }),
);

/** Decisão sobre uma versão: aprovada, reprovada, correção ou substituída por nova versão. Uma por pedido; append-only. */
export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: id(),
    tenantId: tenantId(),
    requestId: uuid('request_id').notNull().references(() => approvalRequests.id),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    decision: text('decision').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    level: text('level'),
    comment: text('comment'),
    financialSummary: jsonb('financial_summary').$type<Record<string, unknown>>(),
    dataVersion: jsonb('data_version').$type<Record<string, unknown>>(),
    materialChanges: jsonb('material_changes').$type<string[]>().notNull().default([]),
    approvedConditions: jsonb('approved_conditions').$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
  },
  (t) => ({
    uq: uniqueIndex('approval_decisions_uq').on(t.requestId),
    oppIdx: index('approval_decisions_opp_idx').on(t.tenantId, t.opportunityId),
    decisionCk: check('approval_decisions_decision_ck', inList('decision', ['aprovada', 'reprovada', 'correcao', 'substituida'])),
  }),
);

/** Chat da negociação: conversa interna da oportunidade (não entra no histórico do relacionamento). Append-only. */
export const negotiationMessages = pgTable(
  'negotiation_messages',
  {
    id: id(),
    tenantId: tenantId(),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    authorId: uuid('author_id').references(() => users.id),
    kind: text('kind').notNull().default('mensagem'),
    body: text('body').notNull(),
    requestId: uuid('request_id'),
    /** Usuários mencionados com @ (recebem aviso). */
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => ({
    idx: index('negotiation_messages_idx').on(t.tenantId, t.opportunityId, t.createdAt),
    kindCk: check('negotiation_messages_kind_ck', inList('kind', ['mensagem', 'sistema'])),
  }),
);

/** Até onde cada pessoa leu o chat e os comentários de cada negociação (não lidas e menções). */
export const negotiationReads = pgTable(
  'negotiation_reads',
  {
    tenantId: tenantId(),
    userId: uuid('user_id').notNull().references(() => users.id),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    lastReadAt: ts('last_read_at').notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.opportunityId] }) }),
);

// --------------------------------------------------------------- atas de registro de preços (ARP)

/** Regras legais por regime, versionadas (append-only): cada alteração é uma nova versão; decisões guardam a versão usada. */
export const arpRuleSets = pgTable(
  'arp_rule_sets',
  {
    id: id(),
    tenantId: tenantId(),
    regime: text('regime').notNull(),
    version: integer('version').notNull(),
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('arp_rule_sets_uq').on(t.tenantId, t.regime, t.version) }),
);

export const arps = pgTable(
  'arps',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    object: text('object').notNull(),
    processNumber: text('process_number'),
    regime: text('regime').notNull().default('federal'),
    supplierName: text('supplier_name').notNull(),
    supplierDocument: text('supplier_document'),
    status: text('status').notNull().default('rascunho'),
    signedAt: date('signed_at', { mode: 'string' }),
    startAt: date('start_at', { mode: 'string' }),
    endAt: date('end_at', { mode: 'string' }),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    uq: uniqueIndex('arps_number_uq').on(t.tenantId, sql`lower(${t.number})`),
    statusCk: check('arps_status_ck', inList('status', ['rascunho', 'vigente', 'encerrada', 'cancelada'])),
    regimeCk: check('arps_regime_ck', inList('regime', ['federal', 'estadual', 'municipal', 'distrital', 'estatal'])),
  }),
);

export const arpAgencies = pgTable(
  'arp_agencies',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    document: text('document'),
    contactId: uuid('contact_id').references(() => contacts.id),
    /** data de ingresso (participação/formalização) e de início da eficácia, quando distinta */
    joinedOn: date('joined_on', { mode: 'string' }),
    effectiveOn: date('effective_on', { mode: 'string' }),
    notes: text('notes'),
    documentId: uuid('document_id'),
    createdAt: createdAt(),
  },
  (t) => ({
    uq: uniqueIndex('arp_agencies_uq').on(t.arpId, sql`lower(${t.name})`),
    kindCk: check('arp_agencies_kind_ck', inList('kind', ['gerenciador', 'participante', 'nao_participante'])),
  }),
);

export const arpItems = pgTable(
  'arp_items',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    itemNumber: text('item_number').notNull(),
    lot: text('lot'),
    code: text('code'),
    description: text('description').notNull(),
    specification: text('specification'),
    unit: text('unit').notNull(),
    /** quantidade registrada em milésimos (oficial: muda só por operação formal no ledger) */
    registeredMilli: bigint('registered_milli', { mode: 'number' }).notNull(),
    unitCents: bigint('unit_cents', { mode: 'number' }).notNull(),
    brandModel: text('brand_model'),
    notes: text('notes'),
    classification: text('classification'),
    /** versão do cadastro do item (sobe a cada alteração autorizada) */
    version: integer('version').notNull().default(1),
    extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    uq: uniqueIndex('arp_items_uq').on(t.arpId, sql`lower(coalesce(${t.lot}, ''))`, sql`lower(${t.itemNumber})`),
    qtyCk: check('arp_items_qty_ck', sql`registered_milli > 0 and unit_cents > 0`),
  }),
);

/** Alterações cadastrais/oficiais de item (append-only), com motivo, origem e documento. */
export const arpItemChanges = pgTable(
  'arp_item_changes',
  {
    id: id(),
    tenantId: tenantId(),
    itemId: uuid('item_id').notNull().references(() => arpItems.id),
    field: text('field').notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    reason: text('reason').notNull(),
    origin: text('origin').notNull(),
    documentId: uuid('document_id'),
    operationId: uuid('operation_id'),
    version: integer('version'),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('arp_item_changes_idx').on(t.itemId, t.createdAt) }),
);

/** Distribuição inicial de quantitativos por órgão participante (o restante é do gerenciador). */
export const arpAllocations = pgTable(
  'arp_allocations',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    itemId: uuid('item_id').notNull().references(() => arpItems.id),
    agencyId: uuid('agency_id').notNull().references(() => arpAgencies.id),
    qtyMilli: bigint('qty_milli', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('arp_allocations_uq').on(t.itemId, t.agencyId), qtyCk: check('arp_allocations_qty_ck', sql`qty_milli > 0`) }),
);

/** Livro de movimentações da ata: imutável, idempotente; correções são lançamentos compensatórios. */
export const arpLedger = pgTable(
  'arp_ledger',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    itemId: uuid('item_id').notNull().references(() => arpItems.id),
    agencyId: uuid('agency_id').notNull().references(() => arpAgencies.id),
    kind: text('kind').notNull(),
    dir: text('dir'),
    qtyMilli: bigint('qty_milli', { mode: 'number' }).notNull(),
    unit: text('unit').notNull(),
    unitCents: bigint('unit_cents', { mode: 'number' }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    origin: text('origin').notNull(),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    contractId: uuid('contract_id').references(() => contracts.id),
    adhesionId: uuid('adhesion_id'),
    operationId: uuid('operation_id'),
    documentId: uuid('document_id'),
    actorId: uuid('actor_id').references(() => users.id),
    justification: text('justification'),
    approvalRef: text('approval_ref'),
    ruleVersion: integer('rule_version').notNull().default(0),
    reversesId: uuid('reverses_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** data do lançamento no sistema (sempre agora) */
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    /** data de eficácia (pode ser retroativa, autorizada) */
    effectiveOn: date('effective_on', { mode: 'string' }),
  },
  (t) => ({
    idemUq: uniqueIndex('arp_ledger_idem_uq').on(t.tenantId, t.idempotencyKey),
    arpIdx: index('arp_ledger_arp_idx').on(t.arpId, t.occurredAt),
    oppIdx: index('arp_ledger_opp_idx').on(t.opportunityId),
    kindCk: check('arp_ledger_kind_ck', inList('kind', ['reserva', 'liberacao', 'consumo', 'estorno', 'remanejamento', 'conversao_proposta', 'conversao', 'ajuste', 'cancelamento', 'adesao', 'execucao', 'faturamento'])),
    dirCk: check('arp_ledger_dir_ck', sql`dir is null or dir in ('saida','entrada')`),
  }),
);

/** Itens da ata pedidos numa oportunidade (o saldo vem das reservas e consumos no ledger). */
export const arpOpportunityLines = pgTable(
  'arp_opportunity_lines',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
    itemId: uuid('item_id').notNull().references(() => arpItems.id),
    agencyId: uuid('agency_id').notNull().references(() => arpAgencies.id),
    qtyMilli: bigint('qty_milli', { mode: 'number' }).notNull(),
    unitCents: bigint('unit_cents', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('reservada'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    uq: uniqueIndex('arp_opp_lines_uq').on(t.opportunityId, t.itemId, t.agencyId),
    statusCk: check('arp_opp_lines_status_ck', inList('status', ['reservada', 'formalizada', 'liberada'])),
  }),
);

export const arpAdhesions = pgTable(
  'arp_adhesions',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    agencyId: uuid('agency_id').notNull().references(() => arpAgencies.id),
    requestedAt: date('requested_at', { mode: 'string' }).notNull(),
    justification: text('justification').notNull(),
    items: jsonb('items').$type<{ itemId: string; qtyMilli: number; unitCents: number }[]>().notNull(),
    status: text('status').notNull().default('solicitada'),
    supplierAcceptedAt: ts('supplier_accepted_at'),
    supplierAcceptedBy: uuid('supplier_accepted_by').references(() => users.id),
    managerAuthorizedAt: ts('manager_authorized_at'),
    /** data real da autorização do gerenciador e de início da participação (podem ser retroativas) */
    authorizedOn: date('authorized_on', { mode: 'string' }),
    startOn: date('start_on', { mode: 'string' }),
    managerAuthorizationRef: text('manager_authorization_ref'),
    authorizedBy: uuid('authorized_by').references(() => users.id),
    deadlineAt: date('deadline_at', { mode: 'string' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    contractId: uuid('contract_id').references(() => contracts.id),
    /** limites calculados na autorização (não mudam se a regra mudar depois) */
    limitsSnapshot: jsonb('limits_snapshot').$type<Record<string, unknown>>(),
    ruleVersion: integer('rule_version'),
    /** exceção legal validada pelo Jurídico (fundamento, documento, quem e quando) */
    exception: jsonb('exception').$type<Record<string, unknown> | null>(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    idx: index('arp_adhesions_idx').on(t.arpId),
    statusCk: check('arp_adhesions_status_ck', inList('status', ['solicitada', 'aceita_fornecedor', 'autorizada', 'contratada', 'recusada', 'expirada', 'cancelada'])),
  }),
);

/** Operações entre itens: simulação não é gravada; pedido → aprovação → efetivação (gera o ledger). */
export const arpOperations = pgTable(
  'arp_operations',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('solicitada'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    simulation: jsonb('simulation').$type<Record<string, unknown>>().notNull(),
    justification: text('justification').notNull(),
    documentId: uuid('document_id'),
    requestedBy: uuid('requested_by').notNull().references(() => users.id),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    effectedBy: uuid('effected_by').references(() => users.id),
    effectedAt: ts('effected_at'),
    effectiveOn: date('effective_on', { mode: 'string' }),
    ruleVersion: integer('rule_version').notNull().default(0),
    exception: jsonb('exception').$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    idx: index('arp_operations_idx').on(t.arpId, t.createdAt),
    kindCk: check('arp_operations_kind_ck', inList('kind', ['conversao', 'remanejamento', 'correcao', 'alteracao_preco', 'cancelamento', 'alteracao_item'])),
    statusCk: check('arp_operations_status_ck', inList('status', ['solicitada', 'aprovada', 'reprovada', 'efetivada', 'cancelada'])),
  }),
);

export const arpDocuments = pgTable(
  'arp_documents',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    category: text('category').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    data: bytea('data').notNull(),
    adhesionId: uuid('adhesion_id'),
    operationId: uuid('operation_id'),
    opportunityId: uuid('opportunity_id'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('arp_documents_idx').on(t.arpId, t.createdAt) }),
);

export const arpEvents = pgTable(
  'arp_events',
  {
    id: id(),
    tenantId: tenantId(),
    arpId: uuid('arp_id').notNull().references(() => arps.id),
    type: text('type').notNull(),
    summary: text('summary').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => ({ idx: index('arp_events_idx').on(t.arpId, t.occurredAt) }),
);

/** Modelos de mapeamento de colunas salvos para importações futuras. */
export const arpImportMappings = pgTable('arp_import_mappings', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});


// ------------------------------------------------------------------ Sucesso do Cliente

/** Configuração versionada (gatilho, modelos, Tier, IPC, saúde, criticidade, cadência, cobertura, alertas). Append-only. */
export const csSettings = pgTable('cs_settings', {
  id: id(),
  tenantId: tenantId(),
  version: integer('version').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  note: text('note').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
}, (t) => ({ uq: uniqueIndex('cs_settings_uq').on(t.tenantId, t.version) }));

/** Estado atual da conta no Sucesso do Cliente (CSM, prioridade manual, último cálculo). O histórico fica em cs_assessments. */
export const csAccounts = pgTable('cs_accounts', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  csmId: uuid('csm_id').references(() => users.id),
  churnRisk: text('churn_risk'),
  manualLevel: text('manual_level'),
  manualReason: text('manual_reason'),
  manualBy: uuid('manual_by').references(() => users.id),
  manualAt: ts('manual_at'),
  manualReviewAt: date('manual_review_at', { mode: 'string' }),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
  computedAt: ts('computed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ uq: uniqueIndex('cs_accounts_uq').on(t.tenantId, t.contactId), csmIdx: index('cs_accounts_csm_idx').on(t.tenantId, t.csmId) }));

/** Histórico de ACV/Tier, IPC, saúde, criticidade, prioridade manual e troca de CSM. Append-only. */
export const csAssessments = pgTable('cs_assessments', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  kind: text('kind').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  score: integer('score'),
  level: text('level'),
  justification: text('justification'),
  evidence: text('evidence'),
  ruleVersion: integer('rule_version').notNull().default(0),
  actorId: uuid('actor_id').references(() => users.id),
  createdAt: createdAt(),
}, (t) => ({ idx: index('cs_assessments_idx').on(t.tenantId, t.contactId, t.kind, t.createdAt) }));

export const csJourneys = pgTable('cs_journeys', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  contractId: uuid('contract_id').references(() => contracts.id),
  opportunityId: uuid('opportunity_id').references(() => opportunities.id),
  /** idempotência do gatilho: contrato:<id> (ou oportunidade:<id> sem contrato) */
  triggerKey: text('trigger_key').notNull(),
  templateKey: text('template_key').notNull(),
  templateName: text('template_name').notNull(),
  csmId: uuid('csm_id').references(() => users.id),
  isNewCustomer: boolean('is_new_customer').notNull().default(true),
  status: text('status').notNull().default('ativa'),
  startedAt: date('started_at', { mode: 'string' }).notNull(),
  ruleVersion: integer('rule_version').notNull().default(0),
  shareTokenHash: text('share_token_hash'),
  shareExpiresAt: ts('share_expires_at'),
  kickoffAt: ts('kickoff_at'),
  kickoffNotes: text('kickoff_notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ uq: uniqueIndex('cs_journeys_trigger_uq').on(t.tenantId, t.triggerKey), contactIdx: index('cs_journeys_contact_idx').on(t.tenantId, t.contactId) }));

export const csMilestones = pgTable('cs_milestones', {
  id: id(),
  tenantId: tenantId(),
  journeyId: uuid('journey_id').notNull().references(() => csJourneys.id),
  phase: text('phase').notNull(),
  key: text('key').notNull(),
  title: text('title').notNull(),
  plannedAt: date('planned_at', { mode: 'string' }),
  doneAt: ts('done_at'),
  doneBy: uuid('done_by').references(() => users.id),
  ownerId: uuid('owner_id').references(() => users.id),
  activityId: uuid('activity_id').references(() => activities.id),
  notes: text('notes'),
  position: integer('position').notNull().default(0),
}, (t) => ({ uq: uniqueIndex('cs_milestones_uq').on(t.journeyId, t.key) }));

/** Versões da apresentação de kickoff (slides web). Append-only: a mais recente vale. */
export const csPresentations = pgTable('cs_presentations', {
  id: id(),
  tenantId: tenantId(),
  journeyId: uuid('journey_id').notNull().references(() => csJourneys.id),
  version: integer('version').notNull(),
  slides: jsonb('slides').$type<Record<string, unknown>[]>().notNull(),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
}, (t) => ({ uq: uniqueIndex('cs_presentations_uq').on(t.journeyId, t.version) }));

export const csSlideTemplates = pgTable('cs_slide_templates', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  slides: jsonb('slides').$type<Record<string, unknown>[]>().notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

/** Respostas de pesquisas (NPS, CSAT, experiência…). Append-only. */
export const csSurveys = pgTable('cs_surveys', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  kind: text('kind').notNull(),
  score: integer('score').notNull(),
  scale: integer('scale').notNull(),
  respondent: text('respondent'),
  comment: text('comment'),
  respondedAt: date('responded_at', { mode: 'string' }).notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  createdAt: createdAt(),
}, (t) => ({ idx: index('cs_surveys_idx').on(t.tenantId, t.contactId, t.respondedAt) }));

export const csVisits = pgTable('cs_visits', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  contractIds: uuid('contract_ids').array().notNull().default(sql`'{}'::uuid[]`),
  csmId: uuid('csm_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  modality: text('modality').notNull().default('presencial'),
  participants: text('participants'),
  objective: text('objective').notNull(),
  plannedAt: ts('planned_at').notNull(),
  doneAt: ts('done_at'),
  summary: text('summary'),
  demands: text('demands'),
  risks: text('risks'),
  opportunities: text('opportunities'),
  nextSteps: text('next_steps'),
  status: text('status').notNull().default('agendada'),
  activityId: uuid('activity_id').references(() => activities.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ idx: index('cs_visits_idx').on(t.tenantId, t.contactId, t.plannedAt), statusCk: check('cs_visits_status_ck', inList('status', ['agendada', 'realizada', 'cancelada'])) }));

export const csFiles = pgTable('cs_files', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  visitId: uuid('visit_id').references(() => csVisits.id),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: createdAt(),
});

/** Planos de ação e ocorrências da conta. Os passos são atividades (activities.cs_plan_id). */
export const csActionPlans = pgTable('cs_action_plans', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  kind: text('kind').notNull().default('plano'),
  severity: text('severity'),
  title: text('title').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('aberto'),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  dueAt: date('due_at', { mode: 'string' }),
  alertKey: text('alert_key'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  closedAt: ts('closed_at'),
  closedNote: text('closed_note'),
}, (t) => ({ idx: index('cs_action_plans_idx').on(t.tenantId, t.contactId, t.status), kindCk: check('cs_action_plans_kind_ck', inList('kind', ['plano', 'ocorrencia'])) }));

/** Alertas preventivos vigentes por conta (um por chave; resolvido some da lista, reaparece se voltar). */
export const csAlerts = pgTable('cs_alerts', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id),
  key: text('key').notNull(),
  category: text('category').notNull(),
  level: text('level').notNull(),
  text: text('text').notNull(),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
  notifiedAt: ts('notified_at'),
  escalatedAt: ts('escalated_at'),
}, (t) => ({ uq: uniqueIndex('cs_alerts_uq').on(t.tenantId, t.contactId, t.key) }));

// --------------------------------------------------------------- tarefas: colaboração

export const activityDependencies = pgTable(
  'activity_dependencies',
  {
    tenantId: tenantId(),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
    dependsOnId: uuid('depends_on_id').notNull().references(() => activities.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.activityId, t.dependsOnId] }), revIdx: index('activity_deps_rev_idx').on(t.dependsOnId) }),
);

/** Comentários de tarefa (append-only), com menções. */
export const activityComments = pgTable(
  'activity_comments',
  {
    id: id(),
    tenantId: tenantId(),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('activity_comments_idx').on(t.tenantId, t.activityId, t.createdAt) }),
);

/** Tempo registrado (append-only; estorno por lançamento negativo que aponta o original). */
export const activityTimeEntries = pgTable(
  'activity_time_entries',
  {
    id: id(),
    tenantId: tenantId(),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    minutes: integer('minutes').notNull(),
    workedOn: date('worked_on', { mode: 'string' }).notNull(),
    note: text('note'),
    reversesId: uuid('reverses_id'),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('activity_time_idx').on(t.tenantId, t.activityId), userIdx: index('activity_time_user_idx').on(t.tenantId, t.userId, t.workedOn) }),
);

/** Arquivos de tarefa ou de projeto (até 3 MB cada). */
export const workFiles = pgTable(
  'work_files',
  {
    id: id(),
    tenantId: tenantId(),
    activityId: uuid('activity_id').references(() => activities.id),
    projectId: uuid('project_id'),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by'),
  },
  (t) => ({ actIdx: index('work_files_act_idx').on(t.tenantId, t.activityId), projIdx: index('work_files_proj_idx').on(t.tenantId, t.projectId) }),
);

/** Última leitura de uma tarefa (comentários e avisos não lidos). */
export const activityReads = pgTable(
  'activity_reads',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
    lastReadAt: ts('last_read_at').notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.activityId] }) }),
);

export const taskTemplates = pgTable(
  'task_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    priority: text('priority').notNull().default('media'),
    checklist: jsonb('checklist').$type<{ text: string }[]>().notNull().default(sql`'[]'::jsonb`),
    estimateMinutes: integer('estimate_minutes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    category: text('category'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('task_templates_idx').on(t.tenantId, t.active) }),
);

// --------------------------------------------------------------- projetos

export const projects = pgTable(
  'projects',
  {
    id: id(),
    tenantId: tenantId(),
    code: serial('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').notNull().default('interno'),
    status: text('status').notNull().default('planejamento'),
    priority: text('priority').notNull().default('media'),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    teamId: uuid('team_id'),
    startOn: date('start_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }),
    completedAt: ts('completed_at'),
    /** vínculos (validados por empresa na API; sem FK para não travar a limpeza da base) */
    contactId: uuid('contact_id'),
    opportunityId: uuid('opportunity_id'),
    contractId: uuid('contract_id'),
    arpId: uuid('arp_id'),
    campaignId: uuid('campaign_id'),
    objective: text('objective'),
    category: text('category'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    templateKey: text('template_key'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
    rowVersion: rowVersion(),
  },
  (t) => ({
    statusCk: check('projects_status_ck', inList('status', ['planejamento', 'em_andamento', 'pausado', 'concluido', 'cancelado'])),
    kindCk: check('projects_kind_ck', inList('kind', ['implantacao', 'comercial', 'sucesso_cliente', 'interno', 'contrato_publico', 'outro'])),
    priorityCk: check('projects_priority_ck', inList('priority', ['baixa', 'media', 'alta'])),
    tenantIdx: index('projects_tenant_idx').on(t.tenantId, t.status),
    linkIdx: index('projects_links_idx').on(t.tenantId, t.contactId, t.opportunityId, t.contractId, t.arpId),
  }),
);

export const projectStages = pgTable(
  'project_stages',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    done: boolean('done').notNull().default(false),
    wipLimit: integer('wip_limit'),
    archivedAt: ts('archived_at'),
  },
  (t) => ({ idx: index('project_stages_idx').on(t.projectId, t.position) }),
);

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    name: text('name').notNull(),
    dueOn: date('due_on', { mode: 'string' }),
    completedAt: ts('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id),
    notes: text('notes'),
    position: integer('position').notNull().default(0),
    deletedAt: ts('deleted_at'),
  },
  (t) => ({ idx: index('project_milestones_idx').on(t.projectId, t.dueOn) }),
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    tenantId: tenantId(),
    role: text('role').notNull().default('membro'),
    addedAt: createdAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId] }),
    roleCk: check('project_members_role_ck', inList('role', ['gerente', 'membro', 'observador'])),
    userIdx: index('project_members_user_idx').on(t.tenantId, t.userId),
  }),
);

export const projectTemplates = pgTable(
  'project_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').notNull().default('interno'),
    def: jsonb('def').$type<import('@isp/domain').ProjectTemplateDef>().notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('project_templates_idx').on(t.tenantId, t.active) }),
);

/** Histórico do projeto (append-only). */
export const projectEvents = pgTable(
  'project_events',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    type: text('type').notNull(),
    summary: text('summary').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => ({ idx: index('project_events_idx').on(t.tenantId, t.projectId, t.occurredAt) }),
);

// --------------------------------------------------------------- desempenho: motor de eventos de negócio

/** Fato de negócio derivado das tabelas de origem (idempotente pela chave). Imutável, exceto a validação. */
export const businessEvents = pgTable(
  'business_events',
  {
    id: id(),
    tenantId: tenantId(),
    type: text('type').notNull(),
    module: text('module').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    ownerId: uuid('owner_id').references(() => users.id),
    participants: uuid('participants').array().notNull().default(sql`'{}'::uuid[]`),
    teamId: uuid('team_id'),
    occurredAt: ts('occurred_at').notNull(),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
    outcome: text('outcome'),
    valueCents: bigint('value_cents', { mode: 'number' }),
    quantity: integer('quantity'),
    validation: text('validation').notNull().default('valido'),
    validatedAt: ts('validated_at'),
    validatedBy: uuid('validated_by'),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    idemKey: text('idem_key').notNull(),
    ruleVersion: integer('rule_version').notNull().default(0),
  },
  (t) => ({
    idemUq: uniqueIndex('business_events_idem_uq').on(t.tenantId, t.idemKey),
    typeIdx: index('business_events_type_idx').on(t.tenantId, t.type, t.occurredAt),
    ownerIdx: index('business_events_owner_idx').on(t.tenantId, t.ownerId, t.occurredAt),
    sourceIdx: index('business_events_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
    validationCk: check('business_events_validation_ck', inList('validation', ['valido', 'pendente', 'invalidado'])),
  }),
);

/** Créditos de reconhecimento por evento (fixados na criação, com a versão da regra). */
export const businessEventCredits = pgTable(
  'business_event_credits',
  {
    eventId: uuid('event_id').notNull().references(() => businessEvents.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    shareBp: integer('share_bp').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.userId, t.kind] }),
    userIdx: index('business_event_credits_user_idx').on(t.tenantId, t.userId),
    kindCk: check('business_event_credits_kind_ck', inList('kind', ['direto', 'participacao', 'gestao'])),
  }),
);

/** Histórico de validação dos eventos (append-only). */
export const businessEventReviews = pgTable(
  'business_event_reviews',
  {
    id: id(),
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull().references(() => businessEvents.id),
    fromValidation: text('from_validation').notNull(),
    toValidation: text('to_validation').notNull(),
    reason: text('reason').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    automatic: boolean('automatic').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('business_event_reviews_idx').on(t.tenantId, t.eventId) }),
);

/** Configuração de desempenho versionada (append-only): atribuição, validação e, nas próximas etapas, pontos e níveis. */
export const performanceSettings = pgTable(
  'performance_settings',
  {
    id: id(),
    tenantId: tenantId(),
    version: integer('version').notNull(),
    config: jsonb('config').$type<import('@isp/domain').PerformanceConfig>().notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('performance_settings_uq').on(t.tenantId, t.version) }),
);

/** Última execução do projetor por empresa. */
export const businessEventSync = pgTable('business_event_sync', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  lastRunAt: ts('last_run_at').notNull(),
  stats: jsonb('stats').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
});

// --------------------------------------------------------------- desempenho: indicadores, metas/OKRs e scorecards

export const indicators = pgTable(
  'indicators',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    active: boolean('active').notNull().default(true),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('indicators_key_uq').on(t.tenantId, t.key) }),
);

/** Definição do indicador por versão (append-only): mudar a fórmula não reescreve resultados já fechados. */
export const indicatorVersions = pgTable(
  'indicator_versions',
  {
    id: id(),
    tenantId: tenantId(),
    indicatorId: uuid('indicator_id').notNull().references(() => indicators.id),
    version: integer('version').notNull(),
    def: jsonb('def').$type<import('@isp/domain').IndicatorDef>().notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('indicator_versions_uq').on(t.indicatorId, t.version) }),
);

/** Objetivos estratégicos, táticos e operacionais, encadeados (OKR = objetivo + metas como resultados-chave). */
export const objectives = pgTable(
  'objectives',
  {
    id: id(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    description: text('description'),
    level: text('level').notNull().default('estrategico'),
    parentId: uuid('parent_id').references((): AnyPgColumn => objectives.id),
    area: text('area'),
    teamId: uuid('team_id'),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    sponsorId: uuid('sponsor_id').references(() => users.id),
    priority: text('priority').notNull().default('media'),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('ativo'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    levelCk: check('objectives_level_ck', inList('level', ['estrategico', 'tatico', 'operacional'])),
    statusCk: check('objectives_status_ck', inList('status', ['ativo', 'encerrado', 'cancelado'])),
    priorityCk: check('objectives_priority_ck', inList('priority', ['baixa', 'media', 'alta'])),
    idx: index('objectives_idx').on(t.tenantId, t.periodEnd),
  }),
);

export const goals = pgTable(
  'goals',
  {
    id: id(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    scope: text('scope').notNull(),
    category: text('category').notNull().default('comercial'),
    indicatorId: uuid('indicator_id').references(() => indicators.id),
    /** meta manual (sem indicador): progresso por apontamentos; unidade livre */
    manualUnit: text('manual_unit'),
    userId: uuid('user_id').references(() => users.id),
    teamId: uuid('team_id'),
    /** meta de área/unidade (Gestão de Resultados) */
    orgUnitId: uuid('org_unit_id'),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    periodType: text('period_type').notNull(),
    /** meta mensal que se repete: cada mês é uma meta da mesma série (competências consecutivas) */
    recurring: boolean('recurring').notNull().default(false),
    seriesId: uuid('series_id'),
    /** metas da empresa/unidade nascem como proposta até a Diretoria aprovar */
    approvalStatus: text('approval_status').notNull().default('aprovada'),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    target: doublePrecision('target').notNull(),
    objectiveId: uuid('objective_id').references(() => objectives.id),
    /** desdobramento em cascata: meta superior (Diretoria → Gestão → Liderança → pessoa) */
    parentGoalId: uuid('parent_goal_id').references((): AnyPgColumn => goals.id),
    weight: integer('weight').notNull().default(1),
    /** como as metas filhas consolidam nesta (nem tudo se soma) */
    consolidation: text('consolidation').notNull().default('indicador'),
    /** alvo original: alterações depois do início exigem motivo e autorização e não apagam o original */
    originalTarget: doublePrecision('original_target').notNull(),
    version: integer('version').notNull().default(1),
    notes: text('notes'),
    status: text('status').notNull().default('ativa'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    scopeCk: check('goals_scope_ck', inList('scope', ['individual', 'equipe', 'unidade', 'empresa'])),
    approvalCk: check('goals_approval_ck', inList('approval_status', ['proposta', 'aprovada', 'rejeitada'])),
    seriesUq: uniqueIndex('goals_series_uq').on(t.tenantId, t.seriesId, t.periodStart).where(sql`series_id is not null`),
    statusCk: check('goals_status_ck', inList('status', ['ativa', 'cancelada'])),
    periodCk: check('goals_period_ck', inList('period_type', ['semana', 'mes', 'trimestre', 'ano', 'personalizado'])),
    consolidationCk: check('goals_consolidation_ck', inList('consolidation', ['indicador', 'soma', 'media_ponderada', 'media_simples', 'nao_agregavel'])),
    parentIdx: index('goals_parent_idx').on(t.tenantId, t.parentGoalId),
    idx: index('goals_idx').on(t.tenantId, t.periodEnd, t.userId),
  }),
);

/** Histórico da meta (append-only): criação, alterações de alvo, cancelamento. */
export const goalEvents = pgTable(
  'goal_events',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id').notNull().references(() => goals.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('goal_events_idx').on(t.tenantId, t.goalId) }),
);

/** Apontamentos de metas manuais (append-only). */
export const goalCheckins = pgTable(
  'goal_checkins',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id').notNull().references(() => goals.id),
    value: doublePrecision('value').notNull(),
    note: text('note'),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('goal_checkins_idx').on(t.tenantId, t.goalId) }),
);

/** Resultado fechado da meta ao fim do período (append-only; uma por meta). */
export const goalResults = pgTable(
  'goal_results',
  {
    goalId: uuid('goal_id').primaryKey().references(() => goals.id),
    tenantId: tenantId(),
    value: doublePrecision('value'),
    target: doublePrecision('target').notNull(),
    attainment: doublePrecision('attainment'),
    status: text('status').notNull(),
    indicatorVersion: integer('indicator_version'),
    computedAt: createdAt(),
  },
);

export const scorecards = pgTable(
  'scorecards',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    appliesProfiles: text('applies_profiles').array().notNull().default(sql`'{}'::text[]`),
    appliesJobTitles: text('applies_job_titles').array().notNull().default(sql`'{}'::text[]`),
    appliesTeamIds: uuid('applies_team_ids').array().notNull().default(sql`'{}'::uuid[]`),
    periodicity: text('periodicity').notNull().default('mes'),
    active: boolean('active').notNull().default(true),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('scorecards_idx').on(t.tenantId, t.active) }),
);

export const scorecardVersions = pgTable(
  'scorecard_versions',
  {
    id: id(),
    tenantId: tenantId(),
    scorecardId: uuid('scorecard_id').notNull().references(() => scorecards.id),
    version: integer('version').notNull(),
    def: jsonb('def').$type<import('@isp/domain').ScorecardDef>().notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('scorecard_versions_uq').on(t.scorecardId, t.version) }),
);

/** Composição explícita para quem tem mais de uma função (pesos normalizados). */
export const scorecardAssignments = pgTable(
  'scorecard_assignments',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    scorecardId: uuid('scorecard_id').notNull().references(() => scorecards.id),
    tenantId: tenantId(),
    weight: integer('weight').notNull().default(100),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.scorecardId] }) }),
);

// --------------------------------------------------------------- gestão de resultados: estrutura organizacional

/**
 * Unidades acima dos times (diretoria → área → unidade). O responsável define a perspectiva
 * (Diretoria ou Gestão) e o escopo; o acesso continua pela matriz de segurança (cargo ≠ permissão).
 */
export const orgUnits = pgTable(
  'org_units',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => orgUnits.id),
    responsibleId: uuid('responsible_id').references(() => users.id),
    substituteId: uuid('substitute_id').references(() => users.id),
    /** alçada para aprovar investimentos e intervenções (em centavos; null = sem alçada) */
    approvalLimitCents: bigint('approval_limit_cents', { mode: 'number' }),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    kindCk: check('org_units_kind_ck', inList('kind', ['diretoria', 'area', 'unidade'])),
    idx: index('org_units_idx').on(t.tenantId, t.parentId),
  }),
);

/** Histórico da estrutura (append-only): quem mudou responsável, substituto, vínculo de time… */
export const orgEvents = pgTable(
  'org_events',
  {
    id: id(),
    tenantId: tenantId(),
    unitId: uuid('unit_id'),
    teamId: uuid('team_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('org_events_idx').on(t.tenantId, t.createdAt) }),
);

/** Pedido de revisão de meta feito por quem não tem alçada; o superior decide. */
export const goalRevisionRequests = pgTable(
  'goal_revision_requests',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id').notNull().references(() => goals.id),
    requestedBy: uuid('requested_by').notNull().references(() => users.id),
    fromTarget: doublePrecision('from_target').notNull(),
    toTarget: doublePrecision('to_target').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pendente'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => ({ statusCk: check('goal_revision_requests_status_ck', inList('status', ['pendente', 'aprovada', 'recusada'])), idx: index('goal_revision_requests_idx').on(t.tenantId, t.status) }),
);

/**
 * Apuração oficial por meta e competência (YYYY-MM), versionada e imutável:
 * v1 consolidado (fechamento do período) → validado (gestor confirma) → retificado (valor corrigido, com motivo).
 * A versão mais alta é a vigente; parciais nunca entram aqui.
 */
export const resultClosings = pgTable(
  'result_closings',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id').notNull().references(() => goals.id),
    seriesId: uuid('series_id'),
    competencia: text('competencia').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    value: doublePrecision('value'),
    target: doublePrecision('target').notNull(),
    attainment: doublePrecision('attainment'),
    color: text('color').notNull(),
    indicatorVersion: integer('indicator_version'),
    sample: integer('sample'),
    quality: text('quality').notNull().default('ok'),
    reason: text('reason'),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    uq: uniqueIndex('result_closings_uq').on(t.goalId, t.version),
    seriesIdx: index('result_closings_series_idx').on(t.tenantId, t.seriesId, t.competencia),
    statusCk: check('result_closings_status_ck', inList('status', ['consolidado', 'validado', 'retificado'])),
    colorCk: check('result_closings_color_ck', inList('color', ['verde', 'amarelo', 'vermelho', 'sem_dado'])),
  }),
);

// --------------------------------------------------------------- marketing: ABM (contas-alvo)

/** Conta-alvo do ABM: um contato/cliente existente marcado como alvo, com tier, situação, responsável e motivo. */
export const abmAccounts = pgTable(
  'abm_accounts',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    tier: text('tier').notNull().default('1_muitos'),
    status: text('status').notNull().default('candidata'),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    priority: text('priority').notNull().default('media'),
    reason: text('reason').notNull(),
    nextStep: text('next_step'),
    nextStepOn: date('next_step_on', { mode: 'string' }),
    /** de onde veio a conta (indicação, edital, evento…) e o objetivo principal do programa para ela */
    origin: text('origin'),
    objective: text('objective'),
    notes: text('notes'),
    /** motivo da última pausa/encerramento */
    statusReason: text('status_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    uq: uniqueIndex('abm_accounts_contact_uq').on(t.tenantId, t.contactId),
    tierCk: check('abm_accounts_tier_ck', inList('tier', ['1_1', '1_poucos', '1_muitos'])),
    statusCk: check('abm_accounts_status_ck', inList('status', ['candidata', 'selecionada', 'em_planejamento', 'ativa', 'em_acompanhamento', 'pausada', 'encerrada'])),
    priorityCk: check('abm_accounts_priority_ck', inList('priority', ['critica', 'alta', 'media', 'baixa'])),
  }),
);

/** Histórico da conta-alvo (append-only). */
export const abmEvents = pgTable(
  'abm_events',
  {
    id: id(),
    tenantId: tenantId(),
    abmId: uuid('abm_id').notNull().references(() => abmAccounts.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('abm_events_idx').on(t.tenantId, t.abmId) }),
);

// ---------------------------------------------------------------- Gestão de Times — Fase 5: intervenções
export const interventions = pgTable(
  'interventions',
  {
    id: id(),
    tenantId: tenantId(),
    /** série da meta (mensal recorrente) ou a própria meta; uma intervenção aberta por série */
    seriesId: uuid('series_id'),
    /** meta ligada (opcional na intervenção manual) */
    goalId: uuid('goal_id').references(() => goals.id),
    /** indicador acompanhado (intervenção manual escolhe o indicador; a ficha mostra a evolução no escopo) */
    indicatorId: uuid('indicator_id').references(() => indicators.id),
    /** intervenção manual: o problema/oportunidade e por que foi aberta */
    title: text('title'),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id),
    closingId: uuid('closing_id').references(() => resultClosings.id),
    kind: text('kind').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('aberta'),
    /** competências ruins que esta intervenção cobre (a primeira e as reincidências) */
    competencias: text('competencias').array().notNull(),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    subjectUserId: uuid('subject_user_id').references(() => users.id),
    teamId: uuid('team_id'),
    orgUnitId: uuid('org_unit_id'),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    escalationLevel: integer('escalation_level').notNull().default(0),
    /** cadeia de responsáveis acima do dono (calculada na abertura) e quem já foi acionado */
    escalationChain: uuid('escalation_chain').array().notNull().default(sql`'{}'::uuid[]`),
    diagnosis: text('diagnosis'),
    actionPlan: text('action_plan'),
    planDueOn: date('plan_due_on', { mode: 'string' }),
    reviewCause: text('review_cause'),
    reviewDecision: text('review_decision'),
    conclusion: text('conclusion'),
    /** Fase 7: projeto que executa o plano (opcional) */
    projectId: uuid('project_id'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    openUq: uniqueIndex('interventions_open_uq').on(t.tenantId, t.seriesId).where(sql`status in ('aberta', 'em_andamento')`),
    idx: index('interventions_idx').on(t.tenantId, t.status, t.ownerId),
    kindCk: check('interventions_kind_ck', inList('kind', ['plano', 'revisao'])),
    triggerCk: check('interventions_trigger_ck', inList('trigger', ['vermelho', 'amarelos_consecutivos', 'primeiro_amarelo', 'manual'])),
    manualCk: check('interventions_manual_ck', sql`trigger <> 'manual' or (title is not null and reason is not null)`),
    autoCk: check('interventions_auto_ck', sql`trigger = 'manual' or (series_id is not null and goal_id is not null)`),
    statusCk: check('interventions_status_ck', inList('status', ['aberta', 'em_andamento', 'concluida', 'dispensada'])),
    decisionCk: check('interventions_decision_ck', sql`review_decision is null or review_decision in ('manter', 'plano')`),
  }),
);

export const interventionEvents = pgTable(
  'intervention_events',
  {
    id: id(),
    tenantId: tenantId(),
    interventionId: uuid('intervention_id').notNull().references(() => interventions.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** quem deve ser avisado (aparece no sino de Menções) */
    notify: uuid('notify').array().notNull().default(sql`'{}'::uuid[]`),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('intervention_events_idx').on(t.tenantId, t.interventionId) }),
);

export const interventionReads = pgTable(
  'intervention_reads',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    interventionId: uuid('intervention_id').notNull().references(() => interventions.id),
    lastReadAt: ts('last_read_at').notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.interventionId] }) }),
);

/** Fase 6: jornada de análise da intervenção (problema, Pareto, Ishikawa, 5 Porquês, conclusão). Ações ficam em intervention_events. */
export const interventionAnalyses = pgTable(
  'intervention_analyses',
  {
    id: id(),
    tenantId: tenantId(),
    interventionId: uuid('intervention_id').notNull().references(() => interventions.id),
    status: text('status').notNull().default('rascunho'),
    content: jsonb('content').$type<import('@isp/domain').AnalysisContent>().notNull(),
    conclusion: text('conclusion'),
    concludedBy: uuid('concluded_by').references(() => users.id),
    concludedAt: ts('concluded_at'),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('intervention_analyses_uq').on(t.interventionId),
    statusCk: check('intervention_analyses_status_ck', inList('status', ['rascunho', 'concluida'])),
  }),
);

/** Fase 7: ações 5W2H do plano. Cada ação nasce como tarefa (fonte da verdade de quem, quando e situação). */
export const interventionActions = pgTable(
  'intervention_actions',
  {
    id: id(),
    tenantId: tenantId(),
    interventionId: uuid('intervention_id').notNull().references(() => interventions.id),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
    what: text('what').notNull(),
    why: text('why').notNull(),
    rootCause: text('root_cause'),
    where: text('where_at').notNull().default(''),
    how: text('how').notNull(),
    howMuchCents: bigint('how_much_cents', { mode: 'number' }),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('intervention_actions_idx').on(t.tenantId, t.interventionId), actUq: uniqueIndex('intervention_actions_activity_uq').on(t.activityId) }),
);

// ---------------------------------------------------------------- Gestão de Times — Fase 8: rituais, reuniões, decisões e impedimentos
export const rituals = pgTable(
  'rituals',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    perspective: text('perspective').notNull(),
    /** escopo: time, unidade (com as filhas) ou empresa (ambos nulos) */
    teamId: uuid('team_id'),
    orgUnitId: uuid('org_unit_id'),
    cadence: text('cadence').notNull(),
    weekday: integer('weekday').notNull().default(1),
    monthDay: integer('month_day').notNull().default(1),
    time: text('time').notNull(),
    durationMin: integer('duration_min').notNull(),
    anchorOn: date('anchor_on', { mode: 'string' }).notNull(),
    facilitatorId: uuid('facilitator_id').notNull().references(() => users.id),
    participants: uuid('participants').array().notNull().default(sql`'{}'::uuid[]`),
    agenda: text('agenda').array().notNull().default(sql`'{}'::text[]`),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    idx: index('rituals_idx').on(t.tenantId, t.active),
    cadenceCk: check('rituals_cadence_ck', inList('cadence', ['diaria', 'semanal', 'quinzenal', 'mensal'])),
    perspectiveCk: check('rituals_perspective_ck', inList('perspective', ['diretoria', 'gestao', 'lideranca'])),
  }),
);

export const ritualMeetings = pgTable(
  'ritual_meetings',
  {
    id: id(),
    tenantId: tenantId(),
    ritualId: uuid('ritual_id').notNull().references(() => rituals.id),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('agendada'),
    attendees: uuid('attendees').array().notNull().default(sql`'{}'::uuid[]`),
    /** anotações por item de pauta (chave = item) */
    notes: jsonb('notes').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    minutes: text('minutes'),
    /** fotografia da pauta automática no momento da finalização */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
    activityId: uuid('activity_id').references(() => activities.id),
    cancelReason: text('cancel_reason'),
    finalizedBy: uuid('finalized_by').references(() => users.id),
    finalizedAt: ts('finalized_at'),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('ritual_meetings_uq').on(t.ritualId, t.date),
    idx: index('ritual_meetings_idx').on(t.tenantId, t.date),
    statusCk: check('ritual_meetings_status_ck', inList('status', ['agendada', 'realizada', 'cancelada'])),
  }),
);

export const decisions = pgTable(
  'decisions',
  {
    id: id(),
    tenantId: tenantId(),
    text: text('text').notNull(),
    rationale: text('rationale'),
    meetingId: uuid('meeting_id').references(() => ritualMeetings.id),
    interventionId: uuid('intervention_id').references(() => interventions.id),
    teamId: uuid('team_id'),
    orgUnitId: uuid('org_unit_id'),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    effectiveOn: date('effective_on', { mode: 'string' }).notNull(),
    followUpTaskId: uuid('follow_up_task_id').references(() => activities.id),
    status: text('status').notNull().default('vigente'),
    revokedReason: text('revoked_reason'),
    revokedBy: uuid('revoked_by').references(() => users.id),
    revokedAt: ts('revoked_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    idx: index('decisions_idx').on(t.tenantId, t.status),
    statusCk: check('decisions_status_ck', inList('status', ['vigente', 'revogada'])),
  }),
);

export const impediments = pgTable(
  'impediments',
  {
    id: id(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    description: text('description'),
    severity: text('severity').notNull().default('media'),
    status: text('status').notNull().default('aberto'),
    raisedBy: uuid('raised_by').notNull().references(() => users.id),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    teamId: uuid('team_id'),
    orgUnitId: uuid('org_unit_id'),
    meetingId: uuid('meeting_id').references(() => ritualMeetings.id),
    interventionId: uuid('intervention_id').references(() => interventions.id),
    dueOn: date('due_on', { mode: 'string' }),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    escalations: integer('escalations').notNull().default(0),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    idx: index('impediments_idx').on(t.tenantId, t.status, t.ownerId),
    statusCk: check('impediments_status_ck', inList('status', ['aberto', 'em_tratamento', 'removido', 'aceito'])),
    sevCk: check('impediments_severity_ck', inList('severity', ['alta', 'media', 'baixa'])),
  }),
);

/** histórico append-only de rituais, reuniões, decisões e impedimentos; notify alimenta o sino de Menções */
export const governanceEvents = pgTable(
  'governance_events',
  {
    id: id(),
    tenantId: tenantId(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    notify: uuid('notify').array().notNull().default(sql`'{}'::uuid[]`),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('governance_events_idx').on(t.tenantId, t.entity, t.entityId) }),
);

export const governanceReads = pgTable(
  'governance_reads',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    entityId: uuid('entity_id').notNull(),
    lastReadAt: ts('last_read_at').notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.entityId] }) }),
);

// ---------------------------------------------------------------- ABM Fase 3: Conta 360 — objetivos por conta e estrutura organizacional
export const abmObjectives = pgTable(
  'abm_objectives',
  {
    id: id(),
    tenantId: tenantId(),
    abmId: uuid('abm_id').notNull().references(() => abmAccounts.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    dueOn: date('due_on', { mode: 'string' }),
    status: text('status').notNull().default('planejado'),
    /** como saber que foi atingido (indicador/critério) */
    successCriteria: text('success_criteria'),
    result: text('result'),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    idx: index('abm_objectives_idx').on(t.tenantId, t.abmId),
    statusCk: check('abm_objectives_status_ck', inList('status', ['planejado', 'em_andamento', 'atingido', 'nao_atingido', 'cancelado'])),
  }),
);

/** Estrutura interna da organização (unidades, secretarias, departamentos…). Pertence à conta, não ao programa ABM. */
export const accountOrgUnits = pgTable(
  'account_org_units',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    idx: index('account_org_units_idx').on(t.tenantId, t.contactId),
    kindCk: check('account_org_units_kind_ck', inList('kind', ['unidade', 'filial', 'diretoria', 'secretaria', 'departamento', 'setor', 'equipe', 'orgao_relacionado'])),
  }),
);

// ---------------------------------------------------------------- ABM Fase 4: stakeholders (pessoas), influência manual e relações
/** Pessoa única: a mesma pessoa pode estar ligada a várias organizações. */
export const people = pgTable(
  'people',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    notes: text('notes'),
    sourceSystem: text('source_system').notNull().default('crm'),
    externalId: text('external_id'),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({ nameIdx: index('people_name_idx').on(t.tenantId, t.name), emailIdx: index('people_email_idx').on(t.tenantId, t.email) }),
);

/** Vínculo da pessoa com a conta: cargo, departamento, papéis e classificações independentes. A influência fica em stakeholder_influence. */
export const accountStakeholders = pgTable(
  'account_stakeholders',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    personId: uuid('person_id').notNull().references(() => people.id),
    title: text('title'),
    unitId: uuid('unit_id').references(() => accountOrgUnits.id),
    roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
    customRoles: text('custom_roles').array().notNull().default(sql`'{}'::text[]`),
    interest: text('interest').notNull().default('desconhecido'),
    stance: text('stance').notNull().default('desconhecido'),
    relationshipStrength: text('relationship_strength').notNull().default('nao_avaliado'),
    access: text('access').notNull().default('nao_avaliado'),
    participation: text('participation').notNull().default('nao_avaliado'),
    priority: text('priority').notNull().default('media'),
    relationshipOwnerId: uuid('relationship_owner_id').references(() => users.id),
    nextInteractionOn: date('next_interaction_on', { mode: 'string' }),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('account_stakeholders_uq').on(t.contactId, t.personId),
    idx: index('account_stakeholders_idx').on(t.tenantId, t.contactId),
    interestCk: check('account_stakeholders_interest_ck', inList('interest', ['alto', 'medio', 'baixo', 'desconhecido'])),
    stanceCk: check('account_stakeholders_stance_ck', inList('stance', ['defensor', 'favoravel', 'neutro', 'resistente', 'opositor', 'desconhecido'])),
    relCk: check('account_stakeholders_rel_ck', inList('relationship_strength', ['forte', 'moderado', 'fraco', 'inexistente', 'nao_avaliado'])),
    accessCk: check('account_stakeholders_access_ck', inList('access', ['direto', 'indireto', 'sem_acesso', 'nao_avaliado'])),
    partCk: check('account_stakeholders_part_ck', inList('participation', ['ativo', 'ocasional', 'inativo', 'nao_avaliado'])),
    prioCk: check('account_stakeholders_prio_ck', inList('priority', ['critica', 'alta', 'media', 'baixa'])),
  }),
);

/** Influência atual por contexto (conta, unidade, oportunidade, projeto, processo). Ausência = não avaliado. Só muda por ação manual. */
export const stakeholderInfluence = pgTable(
  'stakeholder_influence',
  {
    id: id(),
    tenantId: tenantId(),
    stakeholderId: uuid('stakeholder_id').notNull().references(() => accountStakeholders.id),
    contextType: text('context_type').notNull(),
    /** id do contexto; '' para a conta */
    contextKey: text('context_key').notNull().default(''),
    contextLabel: text('context_label'),
    level: text('level').notNull(),
    updatedBy: uuid('updated_by').notNull().references(() => users.id),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (t) => ({
    uq: uniqueIndex('stakeholder_influence_uq').on(t.stakeholderId, t.contextType, t.contextKey),
    levelCk: check('stakeholder_influence_level_ck', inList('level', ['muito_alto', 'alto', 'medio', 'baixo', 'muito_baixo', 'nao_avaliado'])),
    ctxCk: check('stakeholder_influence_ctx_ck', inList('context_type', ['conta', 'unidade', 'oportunidade', 'projeto', 'processo'])),
  }),
);

/** Auditoria append-only das avaliações de influência (aplicadas). */
export const stakeholderInfluenceHistory = pgTable(
  'stakeholder_influence_history',
  {
    id: id(),
    tenantId: tenantId(),
    stakeholderId: uuid('stakeholder_id').notNull().references(() => accountStakeholders.id),
    contextType: text('context_type').notNull(),
    contextKey: text('context_key').notNull().default(''),
    contextLabel: text('context_label'),
    fromLevel: text('from_level').notNull(),
    toLevel: text('to_level').notNull(),
    justification: text('justification').notNull(),
    evidence: text('evidence'),
    actorId: uuid('actor_id').notNull().references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('stakeholder_influence_history_idx').on(t.tenantId, t.stakeholderId) }),
);

/** Pedidos de mudança de influência quando a empresa exige aprovação. */
export const influenceChangeRequests = pgTable(
  'influence_change_requests',
  {
    id: id(),
    tenantId: tenantId(),
    stakeholderId: uuid('stakeholder_id').notNull().references(() => accountStakeholders.id),
    contextType: text('context_type').notNull(),
    contextKey: text('context_key').notNull().default(''),
    contextLabel: text('context_label'),
    fromLevel: text('from_level').notNull(),
    toLevel: text('to_level').notNull(),
    justification: text('justification').notNull(),
    evidence: text('evidence'),
    requestedBy: uuid('requested_by').notNull().references(() => users.id),
    status: text('status').notNull().default('pendente'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => ({
    idx: index('influence_change_requests_idx').on(t.tenantId, t.status),
    openUq: uniqueIndex('influence_change_requests_open_uq').on(t.stakeholderId, t.contextType, t.contextKey).where(sql`status = 'pendente'`),
    statusCk: check('influence_change_requests_status_ck', inList('status', ['pendente', 'aprovada', 'recusada'])),
  }),
);

/** Histórico append-only das demais mudanças do stakeholder (cargo, papéis, classificações…). */
export const stakeholderEvents = pgTable(
  'stakeholder_events',
  {
    id: id(),
    tenantId: tenantId(),
    stakeholderId: uuid('stakeholder_id').notNull().references(() => accountStakeholders.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('stakeholder_events_idx').on(t.tenantId, t.stakeholderId) }),
);

/** Relações profissionais registradas entre stakeholders da conta (nada é inferido). */
export const stakeholderRelations = pgTable(
  'stakeholder_relations',
  {
    id: id(),
    tenantId: tenantId(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    fromId: uuid('from_id').notNull().references(() => accountStakeholders.id),
    toId: uuid('to_id').notNull().references(() => accountStakeholders.id),
    kind: text('kind').notNull(),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    idx: index('stakeholder_relations_idx').on(t.tenantId, t.contactId),
    kindCk: check('stakeholder_relations_kind_ck', inList('kind', ['reporta_a', 'influencia', 'aliado', 'conflito', 'indicou', 'outro'])),
    selfCk: check('stakeholder_relations_self_ck', sql`from_id <> to_id`),
  }),
);

/** Configurações do ABM (versionadas, append-only): política de influência e rótulos. */
export const abmSettings = pgTable(
  'abm_settings',
  {
    id: id(),
    tenantId: tenantId(),
    version: integer('version').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('abm_settings_uq').on(t.tenantId, t.version) }),
);

// ---------------------------------------------------------------- ABM — Fase 5: plays
/** Play da empresa (cópia editável de um modelo ou criado do zero). A definição (etapas, público, critério) é versionada. */
export const abmPlays = pgTable(
  'abm_plays',
  {
    id: id(),
    tenantId: tenantId(),
    /** modelo de origem (abertura_conta…), nulo quando criado do zero */
    templateKey: text('template_key'),
    name: text('name').notNull(),
    category: text('category').notNull(),
    objective: text('objective').notNull().default(''),
    target: text('target').notNull(),
    active: boolean('active').notNull().default(true),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('abm_plays_name_uq').on(t.tenantId, t.name),
    tplUq: uniqueIndex('abm_plays_template_uq').on(t.tenantId, t.templateKey).where(sql`template_key is not null`),
    catCk: check('abm_plays_category_ck', inList('category', ['abertura', 'mapeamento', 'aproximacao', 'conversao', 'defensores', 'expansao', 'renovacao', 'reativacao', 'institucional', 'outro'])),
    targetCk: check('abm_plays_target_ck', inList('target', ['conta', 'stakeholder'])),
  }),
);
/** Versões da definição (append-only): o que estava valendo quando cada execução começou. */
export const abmPlayVersions = pgTable(
  'abm_play_versions',
  {
    id: id(),
    tenantId: tenantId(),
    playId: uuid('play_id').notNull().references(() => abmPlays.id),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<import('@isp/domain').PlayDefinition>().notNull(),
    note: text('note').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('abm_play_versions_uq').on(t.playId, t.version) }),
);
/** Execução de um play numa conta (e, se for o caso, para uma pessoa). As etapas são tarefas reais. */
export const abmPlayRuns = pgTable(
  'abm_play_runs',
  {
    id: id(),
    tenantId: tenantId(),
    playId: uuid('play_id').notNull().references(() => abmPlays.id),
    playVersion: integer('play_version').notNull(),
    abmId: uuid('abm_id').notNull().references(() => abmAccounts.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    stakeholderId: uuid('stakeholder_id').references(() => accountStakeholders.id),
    /** Fase 8: oportunidade da conta a que o play serve (as tarefas aparecem nela) */
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    status: text('status').notNull().default('em_andamento'),
    startOn: date('start_on', { mode: 'string' }).notNull(),
    /** por que foi aplicado (motivos da sugestão ou justificativa de quem aplicou) */
    reason: text('reason').notNull(),
    fromSuggestion: boolean('from_suggestion').notNull().default(false),
    outcome: text('outcome'),
    successAchieved: boolean('success_achieved'),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    idx: index('abm_play_runs_idx').on(t.tenantId, t.contactId),
    openUq: uniqueIndex('abm_play_runs_open_uq').on(t.playId, t.contactId, sql`coalesce(stakeholder_id, '00000000-0000-0000-0000-000000000000'::uuid)`).where(sql`status = 'em_andamento'`),
    statusCk: check('abm_play_runs_status_ck', inList('status', ['em_andamento', 'concluido', 'cancelado'])),
  }),
);
export const abmPlayRunSteps = pgTable(
  'abm_play_run_steps',
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid('run_id').notNull().references(() => abmPlayRuns.id),
    stepKey: text('step_key').notNull(),
    position: integer('position').notNull(),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
  },
  (t) => ({ uq: uniqueIndex('abm_play_run_steps_uq').on(t.runId, t.stepKey), act: index('abm_play_run_steps_act_idx').on(t.activityId) }),
);

// ---------------------------------------------------------------- Funcionalidade 01: Trilha Visual da Jornada
/** Link externo da trilha: vários por jornada, com destinatário, prazo, código opcional (hash) e revogação. */
export const csJourneyLinks = pgTable(
  'cs_journey_links',
  {
    id: id(),
    tenantId: tenantId(),
    journeyId: uuid('journey_id').notNull().references(() => csJourneys.id),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull(),
    codeHash: text('code_hash'),
    showNotes: boolean('show_notes').notNull().default(false),
    expiresAt: ts('expires_at').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: ts('locked_until'),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessAt: ts('last_access_at'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => users.id),
    revokeReason: text('revoke_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ tokenUq: uniqueIndex('cs_journey_links_token_uq').on(t.tokenHash), idx: index('cs_journey_links_idx').on(t.tenantId, t.journeyId) }),
);
/** Registro de cada uso do link (append-only): criado, acesso, código incorreto, bloqueado, revogado. */
export const csJourneyLinkEvents = pgTable(
  'cs_journey_link_events',
  {
    id: id(),
    tenantId: tenantId(),
    linkId: uuid('link_id').notNull().references(() => csJourneyLinks.id),
    type: text('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('cs_journey_link_events_idx').on(t.linkId, t.createdAt), typeCk: check('cs_journey_link_events_type_ck', inList('type', ['criado', 'acesso', 'codigo_incorreto', 'bloqueado', 'revogado'])) }),
);
/** Histórico dos marcos da jornada (append-only): conclusão, reabertura, data, responsável e observações, com antes e depois. */
export const csMilestoneEvents = pgTable(
  'cs_milestone_events',
  {
    id: id(),
    tenantId: tenantId(),
    journeyId: uuid('journey_id').notNull().references(() => csJourneys.id),
    milestoneId: uuid('milestone_id').notNull().references(() => csMilestones.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('cs_milestone_events_idx').on(t.journeyId, t.createdAt), typeCk: check('cs_milestone_events_type_ck', inList('type', ['concluido', 'reaberto', 'reprogramado', 'responsavel', 'observacao'])) }),
);

// ---------------------------------------------------------------- ABM — Fase 8: vínculos de pessoas com oportunidades, contratos e leads
/** Pessoa da conta ligada a um registro (oportunidade, contrato ou lead) com o papel que tem nele. Remover é marcar, com motivo. */
export const stakeholderLinks = pgTable(
  'stakeholder_links',
  {
    id: id(),
    tenantId: tenantId(),
    stakeholderId: uuid('stakeholder_id').notNull().references(() => accountStakeholders.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    role: text('role').notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    removedAt: ts('removed_at'),
    removedBy: uuid('removed_by').references(() => users.id),
    removeReason: text('remove_reason'),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (t) => ({
    activeUq: uniqueIndex('stakeholder_links_active_uq').on(t.stakeholderId, t.entityType, t.entityId).where(sql`removed_at is null`),
    entityIdx: index('stakeholder_links_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    entityCk: check('stakeholder_links_entity_ck', inList('entity_type', ['oportunidade', 'contrato', 'lead'])),
  }),
);

// ---------------------------------------------------------------- Funcionalidade 02: Pesquisas por link
export const surveys = pgTable(
  'surveys',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => ({ uq: uniqueIndex('surveys_name_uq').on(t.tenantId, t.name) }),
);
/** Versões da pesquisa (append-only): o convite responde sempre à versão em que foi enviado. */
export const surveyVersions = pgTable(
  'survey_versions',
  {
    id: id(),
    tenantId: tenantId(),
    surveyId: uuid('survey_id').notNull().references(() => surveys.id),
    version: integer('version').notNull(),
    definition: jsonb('definition').$type<import('@isp/domain').SurveyDefinition>().notNull(),
    note: text('note').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('survey_versions_uq').on(t.surveyId, t.version) }),
);
/** Convite individual (uma resposta por link), para uma conta e, se for o caso, uma pessoa da conta. */
export const surveyInvites = pgTable(
  'survey_invites',
  {
    id: id(),
    tenantId: tenantId(),
    surveyId: uuid('survey_id').notNull().references(() => surveys.id),
    version: integer('version').notNull(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    stakeholderId: uuid('stakeholder_id').references(() => accountStakeholders.id),
    respondentName: text('respondent_name'),
    respondentEmail: text('respondent_email'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    openedAt: ts('opened_at'),
    respondedAt: ts('responded_at'),
    emailedAt: ts('emailed_at'),
    canceledAt: ts('canceled_at'),
    canceledBy: uuid('canceled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ tokenUq: uniqueIndex('survey_invites_token_uq').on(t.tokenHash), idx: index('survey_invites_idx').on(t.tenantId, t.surveyId), contactIdx: index('survey_invites_contact_idx').on(t.tenantId, t.contactId) }),
);
/** Resposta (append-only), uma por convite. */
export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: id(),
    tenantId: tenantId(),
    inviteId: uuid('invite_id').notNull().references(() => surveyInvites.id),
    surveyId: uuid('survey_id').notNull().references(() => surveys.id),
    version: integer('version').notNull(),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    stakeholderId: uuid('stakeholder_id').references(() => accountStakeholders.id),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull(),
    npsScore: integer('nps_score'),
    createdAt: createdAt(),
  },
  (t) => ({ inviteUq: uniqueIndex('survey_responses_invite_uq').on(t.inviteId), idx: index('survey_responses_idx').on(t.tenantId, t.surveyId) }),
);
/** O que a resposta muda no cadastro: aplicado na hora (automática) ou aguardando revisão (pendente). */
export const surveyUpdates = pgTable(
  'survey_updates',
  {
    id: id(),
    tenantId: tenantId(),
    responseId: uuid('response_id').notNull().references(() => surveyResponses.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    stakeholderId: uuid('stakeholder_id').references(() => accountStakeholders.id),
    destination: text('destination').notNull(),
    value: jsonb('value').notNull(),
    previous: jsonb('previous'),
    status: text('status').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => ({
    idx: index('survey_updates_idx').on(t.tenantId, t.status),
    statusCk: check('survey_updates_status_ck', inList('status', ['aplicada', 'pendente', 'rejeitada', 'sem_alvo'])),
    destCk: check('survey_updates_dest_ck', inList('destination', ['cs_nps', 'cs_csat', 'stakeholder_interesse', 'stakeholder_posicionamento', 'pessoa_email', 'pessoa_telefone'])),
  }),
);

// ---------------------------------------------------------------- ABM — Fase 6: sinais, cadências e interações
/** Sinal: situação que pede ação numa conta do ABM (detectada pelos dados ou registrada pela equipe). */
export const abmSignals = pgTable(
  'abm_signals',
  {
    id: id(),
    tenantId: tenantId(),
    abmId: uuid('abm_id').notNull().references(() => abmAccounts.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    detail: text('detail'),
    ref: jsonb('ref').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('novo'),
    ownerId: uuid('owner_id').references(() => users.id),
    detectedAt: ts('detected_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by').references(() => users.id),
    resolution: text('resolution'),
    suppressUntil: ts('suppress_until'),
    taskId: uuid('task_id').references(() => activities.id),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (t) => ({
    openUq: uniqueIndex('abm_signals_open_uq').on(t.abmId, t.key).where(sql`status in ('novo', 'em_analise')`),
    idx: index('abm_signals_idx').on(t.tenantId, t.status),
    statusCk: check('abm_signals_status_ck', inList('status', ['novo', 'em_analise', 'tratado', 'descartado', 'resolvido'])),
    sevCk: check('abm_signals_sev_ck', inList('severity', ['alta', 'media', 'baixa'])),
  }),
);
export const abmSignalEvents = pgTable(
  'abm_signal_events',
  {
    id: id(),
    tenantId: tenantId(),
    signalId: uuid('signal_id').notNull().references(() => abmSignals.id),
    type: text('type').notNull(),
    note: text('note'),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('abm_signal_events_idx').on(t.signalId, t.createdAt) }),
);
/** Cadência de contato com a conta ou com uma pessoa: a próxima tarefa nasce sozinha. */
export const abmCadences = pgTable(
  'abm_cadences',
  {
    id: id(),
    tenantId: tenantId(),
    abmId: uuid('abm_id').notNull().references(() => abmAccounts.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    stakeholderId: uuid('stakeholder_id').references(() => accountStakeholders.id),
    title: text('title').notNull(),
    type: text('type').notNull(),
    everyDays: integer('every_days').notNull(),
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    startOn: date('start_on', { mode: 'string' }).notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    rowVersion: integer('row_version').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('abm_cadences_idx').on(t.tenantId, t.contactId), typeCk: check('abm_cadences_type_ck', inList('type', ['ligacao', 'reuniao', 'visita', 'email', 'whatsapp', 'tarefa'])) }),
);
export const abmCadenceTasks = pgTable(
  'abm_cadence_tasks',
  {
    id: id(),
    tenantId: tenantId(),
    cadenceId: uuid('cadence_id').notNull().references(() => abmCadences.id),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    activityId: uuid('activity_id').notNull().references(() => activities.id),
    createdAt: createdAt(),
  },
  (t) => ({ uq: uniqueIndex('abm_cadence_tasks_uq').on(t.cadenceId, t.dueOn) }),
);

// --------------------------------------------------------------- e-mail corporativo (Gmail / Google Workspace)

/** Configuração do e-mail por empresa: domínios que podem ser conectados e quanto buscar na primeira sincronização. */
export const mailSettings = pgTable('mail_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  allowedDomains: text('allowed_domains').array().notNull().default(sql`'{}'::text[]`),
  syncDays: integer('sync_days').notNull().default(30),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

/** Caixa do Gmail. Pessoal = só a dona vê. Compartilhada = vista por quem está nas filas dela (ou com acesso total). Tokens cifrados. */
export const mailboxes = pgTable(
  'mailboxes',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    address: text('address').notNull(),
    displayName: text('display_name'),
    ownerId: uuid('owner_id').references(() => users.id),
    status: text('status').notNull().default('desconectada'),
    refreshTokenEnc: text('refresh_token_enc'),
    accessTokenEnc: text('access_token_enc'),
    accessExpiresAt: ts('access_expires_at'),
    grantedScopes: text('granted_scopes'),
    historyId: text('history_id'),
    lastSyncAt: ts('last_sync_at'),
    lastError: text('last_error'),
    connectedBy: uuid('connected_by').references(() => users.id),
    connectedAt: ts('connected_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    addrUq: uniqueIndex('mailboxes_addr_uq').on(t.tenantId, t.address),
    kindCk: check('mailboxes_kind_ck', inList('kind', ['pessoal', 'compartilhada'])),
    statusCk: check('mailboxes_status_ck', inList('status', ['desconectada', 'conectada', 'erro', 'pausada'])),
  }),
);

export const mailQueues = pgTable(
  'mail_queues',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    mailboxId: uuid('mailbox_id').references(() => mailboxes.id),
    routing: text('routing').notNull().default('rodizio'),
    slaHours: integer('sla_hours').notNull().default(8),
    members: uuid('members').array().notNull().default(sql`'{}'::uuid[]`),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    idx: index('mail_queues_idx').on(t.tenantId),
    routingCk: check('mail_queues_routing_ck', inList('routing', ['manual', 'rodizio', 'carteira'])),
  }),
);

export const mailRules = pgTable(
  'mail_rules',
  {
    id: id(),
    tenantId: tenantId(),
    mailboxId: uuid('mailbox_id').references(() => mailboxes.id),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    def: jsonb('def').$type<Record<string, unknown>>().notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({ idx: index('mail_rules_idx').on(t.tenantId, t.position) }),
);

export const mailThreads = pgTable(
  'mail_threads',
  {
    id: id(),
    tenantId: tenantId(),
    mailboxId: uuid('mailbox_id').notNull().references(() => mailboxes.id),
    gmailThreadId: text('gmail_thread_id').notNull(),
    subject: text('subject').notNull().default(''),
    snippet: text('snippet'),
    participants: text('participants').array().notNull().default(sql`'{}'::text[]`),
    lastMessageAt: ts('last_message_at').notNull(),
    firstInboundAt: ts('first_inbound_at'),
    firstReplyAt: ts('first_reply_at'),
    firstReplyBy: uuid('first_reply_by').references(() => users.id),
    status: text('status').notNull().default('nova'),
    queueId: uuid('queue_id').references(() => mailQueues.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    assignedAt: ts('assigned_at'),
    priority: text('priority').notNull().default('normal'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    ruleId: uuid('rule_id').references(() => mailRules.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id),
    contractId: uuid('contract_id'),
    linkSource: text('link_source'),
    linkAmbiguous: boolean('link_ambiguous').notNull().default(false),
    unread: boolean('unread').notNull().default(true),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    createdAt: createdAt(),
    rowVersion: rowVersion(),
  },
  (t) => ({
    gUq: uniqueIndex('mail_threads_gmail_uq').on(t.mailboxId, t.gmailThreadId),
    listIdx: index('mail_threads_list_idx').on(t.tenantId, t.status, t.lastMessageAt),
    contactIdx: index('mail_threads_contact_idx').on(t.tenantId, t.contactId),
    statusCk: check('mail_threads_status_ck', inList('status', ['nova', 'em_atendimento', 'aguardando_cliente', 'resolvida', 'arquivada'])),
    prioCk: check('mail_threads_prio_ck', inList('priority', ['alta', 'normal', 'baixa'])),
  }),
);

/** Cada mensagem sincronizada (ou enviada pelo CRM). Imutável. */
export const mailMessages = pgTable(
  'mail_messages',
  {
    id: id(),
    tenantId: tenantId(),
    threadId: uuid('thread_id').notNull().references(() => mailThreads.id),
    mailboxId: uuid('mailbox_id').notNull().references(() => mailboxes.id),
    gmailId: text('gmail_id').notNull(),
    rfcMessageId: text('rfc_message_id'),
    direction: text('direction').notNull(),
    fromAddr: text('from_addr').notNull(),
    fromName: text('from_name'),
    toAddrs: text('to_addrs').array().notNull().default(sql`'{}'::text[]`),
    ccAddrs: text('cc_addrs').array().notNull().default(sql`'{}'::text[]`),
    subject: text('subject').notNull().default(''),
    sentAt: ts('sent_at').notNull(),
    snippet: text('snippet'),
    bodyText: text('body_text'),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    sentBy: uuid('sent_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    gUq: uniqueIndex('mail_messages_gmail_uq').on(t.mailboxId, t.gmailId),
    threadIdx: index('mail_messages_thread_idx').on(t.threadId, t.sentAt),
    dirCk: check('mail_messages_dir_ck', inList('direction', ['entrada', 'saida'])),
  }),
);

export const mailThreadEvents = pgTable(
  'mail_thread_events',
  {
    id: id(),
    tenantId: tenantId(),
    threadId: uuid('thread_id').notNull().references(() => mailThreads.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('mail_thread_events_idx').on(t.threadId, t.createdAt) }),
);

/** Registro de cada sincronização e conexão (auditoria técnica). */
export const mailSyncRuns = pgTable(
  'mail_sync_runs',
  {
    id: id(),
    tenantId: tenantId(),
    mailboxId: uuid('mailbox_id').notNull().references(() => mailboxes.id),
    kind: text('kind').notNull(),
    ok: boolean('ok').notNull(),
    fetched: integer('fetched').notNull().default(0),
    stored: integer('stored').notNull().default(0),
    error: text('error'),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index('mail_sync_runs_idx').on(t.mailboxId, t.createdAt) }),
);

// --------------------------------------------------------------- Etapa 1: módulos de negócio, liberação e ações sensíveis

/** Módulo de negócio por empresa (teto). Sem linha = ligado para todos (comportamento anterior). */
export const tenantModules = pgTable(
  'tenant_modules',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    module: text('module').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    mode: text('mode').notNull().default('todos'),
    disabledFeatures: text('disabled_features').array().notNull().default(sql`'{}'::text[]`),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.module] }),
    moduleCk: check('tenant_modules_module_ck', inList('module', ['crm', 'marketing', 'produto', 'gestao_time', 'contratos', 'projetos', 'relatorios'])),
    modeCk: check('tenant_modules_mode_ck', inList('mode', ['todos', 'liberados'])),
  }),
);

/** Liberação ou bloqueio de um módulo para uma equipe ou uma pessoa (com motivo e validade). */
export const moduleGrants = pgTable(
  'module_grants',
  {
    id: id(),
    tenantId: tenantId(),
    module: text('module').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    effect: text('effect').notNull(),
    reason: text('reason').notNull(),
    validUntil: date('valid_until'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => ({
    uq: uniqueIndex('module_grants_uq').on(t.tenantId, t.module, t.subjectType, t.subjectId),
    subjCk: check('module_grants_subject_ck', inList('subject_type', ['equipe', 'usuario'])),
    effCk: check('module_grants_effect_ck', inList('effect', ['liberar', 'bloquear'])),
  }),
);

/** Ações sensíveis por perfil. Sem linha = padrão do perfil (DEFAULT_ACTIONS). */
export const actionPolicies = pgTable(
  'action_policies',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    allowed: boolean('allowed').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roleId, t.action] }) }),
);
