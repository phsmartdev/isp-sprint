import { z } from 'zod';
import {
  LEAD_STATUSES, OPPORTUNITY_REASONS, LOSS_REASONS, ACTIVITY_TYPES, ACTIVITY_PRIORITIES, SEGMENTS, CUSTOMER_LIFECYCLES,
  MODULES, ACCESS_LEVELS, PROFILE_KEYS,
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
  })
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
});
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
  profile: z.enum(PROFILE_KEYS),
  teamIds: z.array(uuid).max(20).default([]),
  leadTeamIds: z.array(uuid).max(20).default([]),
});
export const UserUpdate = z.object({
  name: trimmed(120).min(2).optional(),
  jobTitle: optText(80),
  profile: z.enum(PROFILE_KEYS).optional(),
  active: z.boolean().optional(),
  teamIds: z.array(uuid).max(20).optional(),
  leadTeamIds: z.array(uuid).max(20).optional(),
  goalSales: z.number().int().min(0).max(100_000).optional(),
  goalProposals: z.number().int().min(0).max(100_000).optional(),
  goalLeads: z.number().int().min(0).max(100_000).optional(),
});
export const PlanUpsert = z.object({
  name: trimmed(80).min(2),
  line: optText(80),
  segment: z.enum(SEGMENTS),
  priceCents: z.number().int().min(0).max(100_000_00),
  active: z.boolean().default(true),
});
export const SourceUpsert = z.object({ name: trimmed(60).min(2), active: z.boolean().default(true) });
export const StageRename = z.object({ name: trimmed(40).min(2) });
export const BRAND_SLOTS = [
  'logo_escuro', 'logo_claro', 'favicon', 'banner_inicio', 'card_sidebar',
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
