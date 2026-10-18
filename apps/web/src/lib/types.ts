import type { ViabilityResult } from '@isp/domain';
import type { AccessLevel, ActivityPriority, ActivityType, CoverageStatus, ContractRequestStatus, CustomerLifecycle, LeadStatus, Module, OpportunityReason, OpportunityStage, ProposalStatus, Segment } from '@isp/domain';

export type Me = {
  user: { id: string; name: string; email: string; jobTitle: string | null; hasAvatar: boolean };
  tenant: { id: string; name: string; timezone: string };
  profiles: string[];
  access: Record<Module, AccessLevel>;
  teamIds: string[];
  teamMemberIds: string[];
};

export type Paged<T> = { items: T[]; page: number; pageSize: number; total: number };

export type Lookups = {
  users: { id: string; name: string; hasAvatar: boolean }[];
  sources: { id: string; name: string }[];
  campaigns: { id: string; name: string; sourceId: string | null }[];
  pipelines: LookupPipeline[];
  /** Etapas da jornada padrão (compatibilidade). */
  stages: LookupStage[];
  teams: { id: string; name: string }[];
  plans: { id: string; name: string; line: string | null; segment: Segment; priceCents: number; speedMbps: number | null }[];
};
export type StageRequirements = { proposta?: boolean; plano?: boolean; proximaAcao?: boolean; respostasObrigatorias?: boolean };
export type LookupStage = { id: string; key: string; name: string; position: number; kind: 'open' | 'won' | 'lost'; isTerminal: boolean; color: string | null; requirements: StageRequirements };
export type LookupField = { key: string; label: string; type: 'texto' | 'texto_longo' | 'numero' | 'moeda' | 'data' | 'lista' | 'sim_nao'; options: string[]; required: boolean };
export type LookupPipeline = { id: string; key: string; name: string; description: string | null; segments: Segment[]; isDefault: boolean; allowed: boolean; fields: LookupField[]; stages: LookupStage[] };

export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  delta: number | null;
  deltaAbs?: number | null;
  unit?: 'count' | 'brl_cents' | 'ratio' | 'days';
  lowerIsBetter?: boolean;
  formula: string;
};

export type Lead = {
  id: string;
  status: LeadStatus;
  interests: string[];
  channel: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  firstContactAt: string | null;
  lastContactAt: string | null;
  lastInteractionNote: string | null;
  notes: string | null;
  convertedOpportunityId: string | null;
  createdAt: string;
  rowVersion: number;
  contactId: string;
  name: string;
  phone: string | null;
  email: string | null;
  segment: Segment;
  city: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerHasAvatar: boolean;
  sourceId: string | null;
  sourceName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  temperature: { level: 'quente' | 'morno' | 'frio'; score: number; reasons: string[] };
  sla: { state: 'cumprido' | 'cumprido_atrasado' | 'violado' | 'no_prazo'; deadline: string };
};

export type Opportunity = {
  id: string;
  code: number;
  title: string;
  stage: string;
  pipelineId: string;
  pipelineName: string;
  stageName: string | null;
  attachmentCount: number;
  proposalCount: number;
  installCep: string | null;
  installStreet: string | null;
  installNumber: string | null;
  installDistrict: string | null;
  installCity: string | null;
  condominiumId: string | null;
  condominiumName: string | null;
  regionName: string | null;
  installBlock: string | null;
  installUnit: string | null;
  saleType: 'ativa' | 'receptiva' | null;
  cableMeters: number | null;
  activationFeeCents: number | null;
  equipment: { equipmentId: string; qty: number }[] | null;
  routeId: string | null;
  viability: ViabilityResult | null;
  commissionCents: number | null;
  cacCents: number | null;
  marginCents: number | null;
  paybackMonths: string | null;
  custom: Record<string, string | number | boolean>;
  duplicatedFromId: string | null;
  proposalStatus: ProposalStatus;
  contractRequestStatus: ContractRequestStatus;
  coverageStatus: CoverageStatus;
  reasons: OpportunityReason[];
  channel: string | null;
  valueCents: number | null;
  planId: string | null;
  planName: string | null;
  planLine: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  notes: string | null;
  lossReason: string | null;
  stageChangedAt: string;
  wonAt: string | null;
  lostAt: string | null;
  sprintStartedAt: string | null;
  sprintElapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  leadId: string | null;
  customerId: string | null;
  customerLifecycle: CustomerLifecycle | null;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  contactSegment: Segment;
  contactCity: string | null;
  contactProvisional: boolean;
  ownerId: string;
  ownerName: string;
  ownerHasAvatar: boolean;
  sourceId: string | null;
  sourceName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  ageDays: number;
  daysInStage: number;
  overdue: boolean;
  missingNextAction: boolean;
};


export type Activity = {
  id: string;
  type: ActivityType;
  title: string;
  notes: string | null;
  dueAt: string | null;
  priority: ActivityPriority;
  completedAt: string | null;
  createdAt: string;
  rowVersion: number;
  ownerId: string;
  ownerName: string;
  opportunityId: string | null;
  opportunityTitle: string | null;
  opportunityCode: number | null;
  contactId: string | null;
  contactName: string | null;
  contactSegment: Segment | null;
  overdue: boolean;
};

export type TimelineItem = {
  kind: 'opportunity' | 'activity';
  id: string;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt: string;
  observedAt: string;
  sourceSystem: string;
  actorName: string | null;
  title?: string;
  activityType?: string;
};

export type { ViabilityResult };
export type PipelineStage = { key: string; name: string; color: string | null; requirements: StageRequirements; isTerminal: boolean; count: number; valueCents: number; cards: Opportunity[] };
