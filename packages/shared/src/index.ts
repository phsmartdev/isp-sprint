import { z } from 'zod';
import {
  LEAD_STATUSES, OPPORTUNITY_REASONS, LOSS_REASONS, ACTIVITY_TYPES, ACTIVITY_PRIORITIES, SEGMENTS, CUSTOMER_LIFECYCLES,
  MODULES, ACCESS_LEVELS, PROFILE_KEYS, SECTORS,
} from '@isp/domain';

const trimmed = (max: number) => z.string().trim().max(max);
const optText = (max: number) => trimmed(max).optional().nullable().transform((v) => (v ? v : null));
const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[\d\s()+\-.]*$/, 'Telefone deve conter apenas números e ( ) + - .')
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const email = z.string().trim().toLowerCase().email('E-mail inválido').max(200).optional().nullable().or(z.literal('').transform(() => null));
const cents = z.number().int().min(0).max(100_000_000);
const rowVersion = z.number().int().min(1);
const stageKey = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Etapa inválida');

// ------------------------------------------------------------------ auth
export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

// ------------------------------------------------------------------ paginação
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ------------------------------------------------------------------ contatos
export const ContactCreate = z.object({
  name: trimmed(160).min(2, 'Informe ao menos 2 caracteres'),
  phone,
  email,
  segment: z.enum(SEGMENTS).default('residencial'),
  city: optText(80),
  ownerId: uuid.optional().nullable(),
});
export type ContactCreate = z.infer<typeof ContactCreate>;

// ------------------------------------------------------------------ leads
export const LEAD_SORTS = ['created_at', 'name', 'next_action_at', 'last_contact_at', 'status'] as const;
export const LeadListQuery = PageQuery.extend({
  q: trimmed(100).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.union([uuid, z.literal('me'), z.literal('none')]).optional(),
  sourceId: uuid.optional(),
  channel: trimmed(40).optional(),
  sort: z.enum(LEAD_SORTS).default('created_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type LeadListQuery = z.infer<typeof LeadListQuery>;

export const LeadCreate = z.object({
  name: trimmed(160).min(2, 'Informe ao menos 2 caracteres'),
  phone,
  email,
  segment: z.enum(SEGMENTS).default('residencial'),
  city: optText(80),
  channel: optText(40),
  lastInteractionNote: optText(120),
  sourceId: uuid.optional().nullable(),
  campaignId: uuid.optional().nullable(),
  interests: z.array(trimmed(40).min(1)).max(10).default([]),
  ownerId: uuid.optional().nullable(),
  nextAction: optText(200),
  nextActionAt: isoDate.optional().nullable(),
  notes: optText(2000),
});
export type LeadCreate = z.infer<typeof LeadCreate>;

export const LeadUpdate = LeadCreate.partial().extend({
  status: z.enum(LEAD_STATUSES).optional(),
  lastContactAt: isoDate.optional().nullable(),
  rowVersion,
});
export type LeadUpdate = z.infer<typeof LeadUpdate>;

export const BulkAssign = z.object({
  ids: z.array(uuid).min(1).max(200),
  ownerId: uuid,
});

// ------------------------------------------------------------------ oportunidades
export const OPPORTUNITY_SORTS = ['updated_at', 'created_at', 'title', 'value_cents', 'next_action_at', 'stage'] as const;
export const OpportunityListQuery = PageQuery.extend({
  q: trimmed(100).optional(),
  stage: stageKey.optional(),
  pipelineId: uuid.optional(),
  ownerId: z.union([uuid, z.literal('me')]).optional(),
  sourceId: uuid.optional(),
  planId: uuid.optional(),
  status: z.enum(['abertas', 'encerradas', 'todas']).default('abertas'),
  sort: z.enum(OPPORTUNITY_SORTS).default('updated_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type OpportunityListQuery = z.infer<typeof OpportunityListQuery>;

/** Endereço de instalação, viabilidade e campos personalizados (criação e edição). */
export const OpportunityDetails = z.object({
  installCep: z.string().trim().regex(/^\d{5}-?\d{3}$/, 'CEP no formato 00000-000').optional().nullable().or(z.literal('').transform(() => null)),
  installStreet: optText(200),
  installNumber: optText(20),
  installDistrict: optText(100),
  installCity: optText(100),
  condominiumId: uuid.optional().nullable(),
  installBlock: optText(40),
  installUnit: optText(40),
  saleType: z.enum(['ativa', 'receptiva']).optional().nullable(),
  cableMeters: z.number().int().min(0).max(100_000).optional().nullable(),
  activationFeeCents: cents.optional().nullable(),
  equipment: z.array(z.object({ equipmentId: uuid, qty: z.number().int().min(0).max(100_000) })).max(30).optional().nullable(),
  routeId: uuid.optional().nullable(),
  engineeringStatus: z.enum(['nao_necessaria', 'pendente', 'aprovada', 'reprovada']).optional(),
  engineeringTicket: optText(60),
  executiveTicket: optText(60),
  custom: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).optional(),
});
export type OpportunityDetails = z.infer<typeof OpportunityDetails>;

export const OpportunityCreate = z
  .object({
    contactId: uuid.optional().nullable(),
    newContact: ContactCreate.optional().nullable(),
    leadId: uuid.optional().nullable(),
    title: optText(160),
    sourceId: uuid.optional().nullable(),
    campaignId: uuid.optional().nullable(),
    channel: optText(40),
    reasons: z.array(z.enum(OPPORTUNITY_REASONS)).max(6).default([]),
    ownerId: uuid.optional().nullable(),
    planId: uuid.optional().nullable(),
    /** Jornada. Em branco: a do segmento do cliente ou a padrão. */
    pipelineId: uuid.optional().nullable(),
    /** Cliente da base: true duplica a oportunidade no funil Sucesso do Cliente. */
    customerSuccess: z.boolean().optional(),
  })
  .merge(OpportunityDetails)
  .refine((v) => !!v.contactId !== !!v.newContact, {
    message: 'Selecione um contato existente ou informe um novo contato (apenas um).',
    path: ['contactId'],
  });
export type OpportunityCreate = z.infer<typeof OpportunityCreate>;

export const OpportunityUpdate = z.object({
  title: optText(160),
  ownerId: uuid.optional(),
  sourceId: uuid.optional().nullable(),
  campaignId: uuid.optional().nullable(),
  channel: optText(40),
  reasons: z.array(z.enum(OPPORTUNITY_REASONS)).max(6).optional(),
  /** O valor vem do catálogo: escolher o plano define o preço. Não há valor digitado. */
  planId: uuid.optional().nullable(),
  /** Trocar de jornada: a etapa passa para a de mesma chave na nova jornada, ou a primeira. */
  pipelineId: uuid.optional(),
  nextAction: optText(200),
  nextActionAt: isoDate.optional().nullable(),
  notes: optText(4000),
  rowVersion,
}).merge(OpportunityDetails);
export type OpportunityUpdate = z.infer<typeof OpportunityUpdate>;

export const OpportunityTransition = z.object({
  toStage: stageKey,
  reason: optText(500),
  lossReason: z.enum(LOSS_REASONS).optional().nullable(),
  confirm: z.boolean().optional(),
  rowVersion,
});
export type OpportunityTransition = z.infer<typeof OpportunityTransition>;

// ------------------------------------------------------------------ atividades
export const ActivityListQuery = PageQuery.extend({
  scope: z.enum(['minhas', 'equipe']).default('minhas'),
  status: z.enum(['abertas', 'atrasadas', 'hoje', 'concluidas', 'todas']).default('abertas'),
  type: z.enum(ACTIVITY_TYPES).optional(),
  ownerId: uuid.optional(),
  q: trimmed(100).optional(),
  /** Dia de início da agenda (AAAA-MM-DD, fuso da empresa) e quantos dias mostrar. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(31).optional(),
  opportunityId: uuid.optional(),
  leadId: uuid.optional(),
  contactId: uuid.optional(),
});
export type ActivityListQuery = z.infer<typeof ActivityListQuery>;

export const ActivityCreate = z.object({
  type: z.enum(ACTIVITY_TYPES),
  title: trimmed(200).min(2, 'Descreva a atividade'),
  dueAt: isoDate.optional().nullable(),
  priority: z.enum(ACTIVITY_PRIORITIES).default('media'),
  ownerId: uuid.optional().nullable(),
  opportunityId: uuid.optional().nullable(),
  leadId: uuid.optional().nullable(),
  contactId: uuid.optional().nullable(),
  notes: optText(2000),
});
export type ActivityCreate = z.infer<typeof ActivityCreate>;

export const ActivityUpdate = z.object({
  title: trimmed(200).min(2).optional(),
  dueAt: isoDate.optional().nullable(),
  priority: z.enum(ACTIVITY_PRIORITIES).optional(),
  ownerId: uuid.optional(),
  notes: optText(2000),
  completed: z.boolean().optional(),
  rowVersion,
});
export type ActivityUpdate = z.infer<typeof ActivityUpdate>;

// ------------------------------------------------------------------ clientes
export const CustomerListQuery = PageQuery.extend({
  q: trimmed(100).optional(),
  lifecycle: z.enum(CUSTOMER_LIFECYCLES).optional(),
  segment: z.enum(SEGMENTS).optional(),
  planId: uuid.optional(),
  ownerId: uuid.optional(),
});

// ------------------------------------------------------------------ relatórios e inteligência
export const PeriodFields = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const periodOrder = (v: { from: string; to: string }) => v.from <= v.to;
export const PeriodQuery = PeriodFields.refine(periodOrder, { message: 'A data inicial deve ser anterior à final', path: ['from'] });
export const ReportQuery = PeriodFields.extend({ pipelineId: z.string().uuid().optional() }).refine(periodOrder, { message: 'A data inicial deve ser anterior à final', path: ['from'] });

// ------------------------------------------------------------------ administração
export const SecurityUpdate = z.object({
  profile: z.enum(PROFILE_KEYS),
  module: z.enum(MODULES),
  level: z.enum(ACCESS_LEVELS),
});
export const UserCreate = z.object({
  name: trimmed(120).min(2),
  email: z.string().trim().toLowerCase().email().max(200),
  jobTitle: optText(80),
  phone: optText(30),
  profile: z.enum(PROFILE_KEYS),
  teamIds: z.array(uuid).max(20).default([]),
  leadTeamIds: z.array(uuid).max(20).default([]),
  sectors: z.array(z.enum(SECTORS)).max(10).default([]),
});
export const UserUpdate = z.object({
  name: trimmed(120).min(2).optional(),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(200).optional(),
  jobTitle: optText(80),
  /** Ausente = não muda; vazio = apaga. */
  phone: z.string().trim().max(30).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
  profile: z.enum(PROFILE_KEYS).optional(),
  active: z.boolean().optional(),
  teamIds: z.array(uuid).max(20).optional(),
  leadTeamIds: z.array(uuid).max(20).optional(),
  goalSales: z.number().int().min(0).max(100_000).optional(),
  goalProposals: z.number().int().min(0).max(100_000).optional(),
  goalLeads: z.number().int().min(0).max(100_000).optional(),
  sectors: z.array(z.enum(SECTORS)).max(10).optional(),
});
const ProductCommission = z.object({ kind: z.enum(['percent', 'fixo']), value: z.number().int().min(0).max(10_000_000) }).nullable().default(null);
export const PlanProductItem = z.object({
  name: z.string().trim().min(2).max(120),
  qty: z.number().int().min(1).max(100).default(1),
  unitPriceCents: z.number().int().min(0).max(100_000_00),
  commissionAtiva: ProductCommission,
  commissionReceptiva: ProductCommission,
  /** Parceiro que fornece o produto (ex.: PlayHub para o SKY+): o custo entra na margem pelo plano. */
  partnerId: uuid.optional().nullable(),
  /** Custo mensal pago ao parceiro por unidade; em branco = valor unitário do produto. */
  partnerCostCents: z.number().int().min(0).max(100_000_00).optional().nullable(),
});
export const PlanUpsert = z.object({
  name: trimmed(80).min(2),
  line: optText(80),
  segment: z.enum(SEGMENTS),
  /** Com produtos, o servidor usa a soma dos produtos como mensalidade. */
  priceCents: z.number().int().min(0).max(100_000_00),
  speedMbps: z.number().int().min(1).max(100_000).optional().nullable(),
  /** Nome do serviço como sai na fatura do cliente. */
  invoiceServiceName: optText(120),
  products: z.array(PlanProductItem).max(30).default([]),
  /** Valor mensal dos parceiros cobrados por plano (ex.: PlayHub), por id do parceiro. Só planos residenciais. */
  partnerCosts: z.record(uuid, z.number().int().min(0).max(100_000_00)).default({}),
  active: z.boolean().default(true),
});
export const SourceUpsert = z.object({ name: trimmed(60).min(2), active: z.boolean().default(true) });
export const StageRename = z.object({ name: trimmed(40).min(2) });
export const BRAND_SLOTS = [
  'logo_escuro', 'logo_claro', 'favicon', 'login_fundo', 'banner_inicio', 'card_sidebar',
  'mascote_leads', 'mascote_oportunidades', 'mascote_clientes', 'mascote_atividades', 'mascote_relatorios', 'mascote_inteligencia', 'mascote_administracao',
] as const;
export type BrandSlot = (typeof BRAND_SLOTS)[number];
export const ImageUpload = z.object({
  /** Arquivo em base64 (sem prefixo data:). Tipo validado pelos bytes no servidor. */
  data: z.string().min(16).max(3_000_000),
});
export const PasswordChange = z.object({ current: z.string().min(1).max(200), next: z.string().min(10, 'Use ao menos 10 caracteres').max(200) });

// ------------------------------------------------------------------ dashboard
export const DashboardQuery = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
  scope: z.enum(['meu', 'equipe']).default('meu'),
});
export type DashboardQuery = z.infer<typeof DashboardQuery>;

// ------------------------------------------------------------------ erros
export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
  currentRowVersion?: number;
};
export * from './instruction';

// ------------------------------------------------------------------ roteiro, anexos e e-mail da oportunidade
export const AnswersPut = z.object({
  answers: z.array(z.object({ questionId: stageKey, answer: z.string().trim().max(2000) })).min(1).max(60),
});

export const ATTACHMENT_KINDS = ['proposta', 'outro'] as const;
export const AttachmentUpload = z.object({
  kind: z.enum(ATTACHMENT_KINDS).default('proposta'),
  filename: z.string().trim().min(1).max(160),
  /** Conteúdo em base64 (até 3 MB). */
  data: z.string().min(8).max(4_300_000),
});

export const OpportunityEmail = z.object({
  kind: z.enum(['proposta', 'followup']),
  to: z.string().trim().toLowerCase().email('E-mail do cliente inválido').max(200),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(10_000),
  attachmentId: uuid.optional().nullable(),
});

// ------------------------------------------------------------------ SMTP, notificações e modelo de instrução
export const SmtpUpdate = z.object({
  host: z.string().trim().min(3).max(200).regex(/^[a-zA-Z0-9.-]+$/, 'Servidor inválido'),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().max(200).optional().nullable().transform((v) => (v ? v : null)),
  /** undefined = manter a senha atual; '' = remover. */
  password: z.string().max(500).optional(),
  fromName: z.string().trim().min(2).max(120),
  fromEmail: z.string().trim().toLowerCase().email('Remetente inválido').max(200),
  replyTo: z.string().trim().toLowerCase().email('Responder para inválido').max(200).optional().nullable().or(z.literal('').transform(() => null)),
  enabled: z.boolean().default(true),
});
export const SmtpTest = z.object({ to: z.string().trim().toLowerCase().email('E-mail inválido').max(200) });
export const NotificationUpdate = z.object({
  activityDigest: z.boolean(),
  leadAssigned: z.boolean(),
  dealWon: z.boolean(),
  userAccess: z.boolean(),
});
export const InstructionUpload = z.object({ content: z.unknown(), notes: z.string().trim().max(300).optional().nullable() });

// ------------------------------------------------------------------ viabilidade, área e jornadas pelo painel
export const ViabilitySimulate = z.object({
  planId: uuid.optional().nullable(),
  cableMeters: z.number().int().min(0).max(100_000).optional().nullable(),
  activationFeeCents: cents.optional().nullable(),
  saleType: z.enum(['ativa', 'receptiva']).optional().nullable(),
  equipment: z.array(z.object({ equipmentId: uuid, qty: z.number().int().min(0).max(100_000) })).max(30).optional().nullable(),
  routeId: uuid.optional().nullable(),
  location: z.enum(['condominio', 'rua']).optional().nullable(),
});
const optInt = z.number().int().min(0).max(10_000_000).optional().nullable();
export const DeductionItem = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(80),
  /** per_plan: só parceiros; o valor vem do cadastro de cada plano residencial. */
  kind: z.enum(['percent', 'fixed', 'per_plan']),
  percentBp: z.number().int().min(0).max(10_000).default(0),
  amountCents: cents.default(0),
  routeIds: z.array(uuid).max(50).default([]),
  /** Percentual calculado sobre a mensalidade menos estes parceiros. */
  baseExcludeIds: z.array(uuid).max(50).default([]),
  notes: optText(300),
  active: z.boolean().default(true),
});
export const EquipmentItem = z.object({ id: uuid.optional(), name: z.string().trim().min(2).max(80), costCents: cents, active: z.boolean().default(true) });
export const RouteItem = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(80),
  description: optText(300),
  cablePerMeterCents: cents.default(0),
  installCostCents: cents.default(0),
  monthlyCostCents: cents.default(0),
  requiresApproval: z.boolean().default(false),
  appliesTo: z.enum(['condominio', 'rua']).optional().nullable(),
  kit: z.array(z.object({ equipmentId: uuid, qty: z.number().int().min(1).max(100_000) })).max(30).default([]),
  active: z.boolean().default(true),
});
export const RouteRuleItem = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(80),
  minMeters: optInt, maxMeters: optInt, minMbps: optInt, maxMbps: optInt,
  routeId: uuid,
  active: z.boolean().default(true),
});
export const CommissionRuleItem = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(80),
  saleType: z.enum(['ativa', 'receptiva', 'qualquer']),
  minPriceCents: cents.optional().nullable(),
  maxPriceCents: cents.optional().nullable(),
  kind: z.enum(['percent', 'mensalidades', 'fixo']),
  percentBp: z.number().int().min(0).max(100_000).default(0),
  multiplierX100: z.number().int().min(0).max(10_000).default(0),
  amountCents: cents.default(0),
  active: z.boolean().default(true),
});
export const ViabilitySettingsUpdate = z.object({
  defaultRouteId: uuid.optional().nullable(),
  ltvLifetimeMonths: z.number().int().min(1).max(600).optional().nullable(),
  monthlyChurnBp: z.number().int().min(1).max(10_000).optional().nullable(),
  ltvMinSample: z.number().int().min(1).max(100_000).default(30),
  maxPaybackMonths: z.number().int().min(1).max(240).optional().nullable(),
  defaultActivationFeeCents: cents.optional().nullable(),
  autonomyMaxMeters: z.number().int().min(0).max(100_000).optional().nullable(),
  autonomyMaxMbps: z.number().int().min(0).max(100_000).optional().nullable(),
});
export const listOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item).max(200) });

export const RegionUpsert = z.object({ name: z.string().trim().min(2).max(80), active: z.boolean().default(true) });
export const CondominiumUpsert = z.object({
  regionId: uuid,
  name: z.string().trim().min(2).max(120),
  cep: z.string().trim().regex(/^\d{5}-?\d{3}$/, 'CEP no formato 00000-000').optional().nullable().or(z.literal('').transform(() => null)),
  street: optText(200), number: optText(20), district: optText(100), city: optText(100),
  blocks: z.array(z.string().trim().min(1).max(40)).max(200).default([]),
  units: z.number().int().min(0).max(100_000).optional().nullable(),
  hasNetwork: z.boolean().default(false),
  ctoPorts: z.number().int().min(0).max(10_000).optional().nullable(),
  notes: optText(500),
  active: z.boolean().default(true),
});

export const PipelineUpsert = z.object({
  name: z.string().trim().min(2).max(60),
  description: optText(300),
  segments: z.array(z.enum(SEGMENTS)).default([]),
  isDefault: z.boolean().default(false),
  memberIds: z.array(uuid).max(200).default([]),
  /** Ao criar: copia as etapas desta jornada; senão usa um funil básico. */
  copyFromId: uuid.optional().nullable(),
});
export const StageItem = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  name: z.string().trim().min(2).max(40),
  kind: z.enum(['open', 'won', 'lost']),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  requirements: z.object({ proposta: z.boolean().default(false), plano: z.boolean().default(false), proximaAcao: z.boolean().default(false), respostasObrigatorias: z.boolean().default(false) }).default({}),
});
export const StagesPut = z.object({ stages: z.array(StageItem).min(3).max(15) });

// ------------------------------------------------------------------ campanhas
export const CAMPAIGN_CHANNELS = ['Instagram', 'Facebook', 'Google', 'WhatsApp', 'Rádio', 'Panfleto', 'Outdoor', 'Porta a porta', 'Evento', 'E-mail', 'Site', 'Indicação'] as const;
export const CampaignUpsert = z.object({
  name: z.string().trim().min(2).max(120),
  objective: optText(1000),
  audience: optText(1000),
  offer: optText(1000),
  message: optText(1000),
  channels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: optText(2000),
  ownerId: uuid.optional().nullable(),
  sourceId: uuid.optional().nullable(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  budgetCents: z.number().int().min(0).max(1_000_000_000_00).optional().nullable(),
  targetLeads: z.number().int().min(0).max(1_000_000).optional().nullable(),
  targetSales: z.number().int().min(0).max(1_000_000).optional().nullable(),
  active: z.boolean().default(true),
});
export const CampaignCostCreate = z.object({
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(2).max(300),
  amountCents: z.number().int().min(1).max(1_000_000_000_00),
});
