import type { ApprovalLevel, NegotiationType } from '@isp/domain';

export type ValueKind = 'contratado' | 'projetado' | 'estimado' | 'observado' | 'indisponivel';
export type Sourced<T = number> = { value: T; kind: ValueKind; source: string };
export type Waiting = { kind: 'indisponivel'; source: string };
export type OpinionItem = { text: string; source: string };
export type Classification = { id: string; classKey: string | null; category: string | null; profile: string | null; payerProfile: string | null; potential: string | null; risk: string | null; notes: string | null; classifiedAt: string; classifiedBy: string | null };
export type RequestStatus = 'pendente' | 'aprovada' | 'reprovada' | 'correcao' | 'substituida';
export type RequestView = {
  id: string; opportunityId: string; version: number; requestedBy: string; requesterName: string; createdAt: string;
  negotiationType: NegotiationType; negotiationLabel: string; listMonthlyCents: number | null; proposedMonthlyCents: number; discountBp: number; activationFeeCents: number | null;
  replacesMonthlyCents: number; termMonths: number | null; conditions: string | null; justification: string; risks: string | null; proposalAttachmentId: string | null;
  requiredLevel: ApprovalLevel; requiredLabel: string; exceptional: boolean; status: RequestStatus;
  snapshot: Record<string, unknown>;
  decision: { decision: RequestStatus; by: string | null; level: string | null; comment: string | null; at: string; materialChanges: string[]; approvedConditions: Record<string, unknown> | null } | null;
};
export type TimelineItem = { at: string; kind: string; title: string; detail?: string | null; who?: string | null; link?: string | null };
export type ChatMessage = { id: string; kind: 'mensagem' | 'sistema'; body: string; authorId: string | null; authorName: string | null; requestId: string | null; createdAt: string };
export type Line = { label: string; cents: number; detail?: string };

export type Analysis = {
  generatedAt: string;
  kind: { kind: 'novo' | 'base'; label: string; reasons: string[] };
  viewer: { level: ApprovalLevel; levelLabel: string; isApprover: boolean; isRequester: boolean; canRequest: boolean; see: { customer: boolean; contracts: boolean } };
  opportunity: {
    id: string; code: number; title: string; stage: string; stageName: string | null; pipelineName: string; ownerId: string; ownerName: string; planName: string | null; valueCents: number | null;
    coverageStatus: string; engineeringStatus: string; proposalStatus: string; segment: string; region: string | null; condominium: string | null; city: string | null; saleType: string | null; channel: string | null;
    sourceName: string | null; campaignName: string | null; createdAt: string; reasons: string[];
  };
  customer: null | {
    contactId: string; name: string; document: string | null; phone: string | null; email: string | null; city: string | null; segment: string; lifecycle: string; sourceSystem: string; externalId: string | null; planName: string | null;
    custom: Record<string, unknown>;
    lead: null | { createdAt: string; firstContactAt: string | null; status: string; channel: string | null; interests: string[]; notes: string | null; lastInteractionNote: string | null };
  };
  identity: null | { contactIds: string[]; unresolved: number; candidates: { id: string; name: string; document: string | null; phone: string | null; email: string | null; city: string | null; lifecycle: string | null; match: string[]; decision: 'mesmo' | 'diferente' | null }[] };
  classification: null | { current: Classification | null; history: Classification[]; options: Record<string, string[]> };
  terms: { proposedMonthlyCents: number | null; activationFeeCents: number | null; replacesMonthlyCents: number; negotiationType: NegotiationType; listMonthlyCents: number | null; discountBp: number; planName: string | null };
  viability: null | { complete: boolean; missing: string[]; route: { name: string } | null; revenue: { monthlyCents: number; activationFeeCents: number }; monthlyDeductions: Line[]; oneTimeCosts: Line[]; investmentCents: number; commissionCents: number; marginMonthlyCents: number; cacCents: number; paybackMonths: number | null; ltv: { months: number | null; source: string | null; sample: number }; alerts: string[]; engineering: { required: boolean; reasons: string[] } };
  projections: { revenue12mCents: number | null; revenueLifetimeCents: number | null; ltvMonths: number | null };
  intelligence: null | {
    relationshipStart: string | null; relationshipMonths: number | null; lifecycle: string | null;
    monthlyRevenueCents: Sourced; nonRecurring: { contractId: string; label: string; billingType: string; monthlyCents: number }[];
    services: { label: string; source: string; monthlyCents: number; monthlyCostCents: number | null; contractId: string | null; opportunityId: string | null }[];
    totalPaid: Waiting; paidInstallments: Waiting; delinquency: Waiting & { cadastro: string | null }; lateHistory: Waiting; punctuality: Waiting;
    billingHistory: { occurredOn: string; amountCents: number; description: string; contractId: string; contract: string | null }[]; billedInCrmCents: number;
    ltvRealized: Waiting; ltvProjectedCents: Sourced | null; cacHistoricalCents: Sourced | null; cacPaybackMonths: number | null; profitabilityRealized: Waiting;
    wonOpportunities: number; activeContracts: number;
  };
  margin: {
    current: { revenueCents: number; costCents: number | null; marginCents: number | null; marginBp: number | null; servicesWithCost: number; services: number };
    incremental: { revenueCents: number | null; costCents: number | null; marginCents: number | null; investmentCents: number | null; paybackMonths: number | null };
    after: { revenueCents: number | null; marginCents: number | null; marginBp: number | null };
    variation: { marginCents: number | null; marginBpPoints: number | null };
    discount: { bp: number; listCents: number | null; proposedCents: number | null };
    reliable: boolean; warnings: string[];
  };
  policy: { limits: { level: ApprovalLevel; maxDiscountBp: number; minMarginBp: number | null }[]; required: { level: ApprovalLevel; exceptional: boolean; maxAllowedBp: number; reasons: string[] } };
  opinion: { summary: string; favorable: OpinionItem[]; attention: OpinionItem[]; financial: OpinionItem[]; strategic: OpinionItem[]; pending: OpinionItem[]; authority: OpinionItem[] };
  executive: {
    customer: string; kindLabel: string; classKey: string | null; payerProfile: string | null; relationshipMonths: number | null; totalPaid: Waiting | null; monthlyRevenueCents: number | null; activeContracts: number | null;
    incrementalRevenueCents: number | null; investmentCents: number | null; marginBeforeBp: number | null; marginAfterBp: number | null; newMarginBp: number | null; paybackMonths: number | null; potential: string | null;
    viabilityComplete: boolean; risk: string[]; justification: string | null; decisionAsked: string | null;
  };
  requests: RequestView[];
  pending: RequestView | null;
  materialChanges: string[];
  attachments: { id: string; kind: string; filename: string; sizeBytes: number; createdAt: string }[];
  otherOpportunities: null | { id: string; code: number; title: string; stage: string; valueCents: number | null; createdAt: string; wonAt: string | null; lostAt: string | null; lossReason: string | null; planName: string | null; ownerName: string | null }[];
  contracts: null | {
    id: string; number: string; object: string; stage: string; billingType: string; kind: string; status: 'ativo' | 'encerrado' | 'em_validacao' | 'suspenso';
    monthlyCents: number; totalCents: number | null; startAt: string | null; endAt: string | null; signedAt: string | null;
    items: { description: string; qty: number; unitCents: number }[];
    adjustments: { version: number; at: string | null; monthlyCents: number; reason: string | null }[];
    renewals: { version: number; at: string | null; endAt: string | null; reason: string | null }[];
    closure: { expected: boolean; reason: string | null; at: string | null } | null;
    pendencies: string[]; isThisNegotiation: boolean;
  }[];
  dataReference: { label: string; asOf: string | null; source: string }[];
  timelines: { negotiation: TimelineItem[]; relationship: TimelineItem[] };
  chat: ChatMessage[];
};
