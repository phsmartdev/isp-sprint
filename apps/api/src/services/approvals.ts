/**
 * Análise e aprovação da negociação: junta Cliente 360, Gestão de Contratos, viabilidade e histórico
 * numa leitura só (sem base financeira paralela). Pagamentos, inadimplência e pontualidade dependem
 * da leitura do IXC, que ainda não existe: aparecem como "Aguardando IXC", nunca estimados.
 */
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  ALERT_LABELS, APPROVAL_LEVEL_LABELS, DEFAULT_APPROVAL_POLICY, PROCESS_LABELS, type AlertKind, type ProcessKind, DEFAULT_APPROVAL_TEMPLATE, DEFAULT_CLASSIFICATION_OPTIONS, NEGOTIATION_TYPE_LABELS,
  buildOpinion, canDecide, customerKind, discountBp, materialChanges, monthsBetween, negotiationMargin, requiredApproval, userApprovalLevel,
  type AnalysisFingerprint, type ApprovalLevel, type ApprovalPolicy, type ClassificationOptions, type NegotiationType, type ServiceLine,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { notFound } from '../http/errors';
import { level } from './scope';
import { loadOpportunity, opportunityQuery, type OpportunityRow } from './opportunities';
import { viabilityFor } from './viability';

const ACTIVE_CONTRACT = ['implantacao', 'vigente', 'renovacao', 'reajuste', 'encerramento'];
const today = () => new Date().toISOString().slice(0, 10);
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const day = (d: Date | string | null | undefined) => (d ? (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);

// ------------------------------------------------------------------ parâmetros

export async function approvalSettingsOf(db: DbOrTx, tenantId: string) {
  const [r] = await db.select().from(s.approvalSettings).where(eq(s.approvalSettings.tenantId, tenantId)).limit(1);
  const policy: ApprovalPolicy = r?.policy?.limits?.length ? (r.policy as ApprovalPolicy) : DEFAULT_APPROVAL_POLICY;
  const options: ClassificationOptions = { ...DEFAULT_CLASSIFICATION_OPTIONS, ...((r?.classificationOptions ?? {}) as Partial<ClassificationOptions>) };
  return {
    policy,
    classificationOptions: options,
    notifyEmail: r?.notifyEmail ?? true,
    notifyWhatsapp: r?.notifyWhatsapp ?? false,
    notifyShowClass: r?.notifyShowClass ?? false,
    template: r?.template ?? DEFAULT_APPROVAL_TEMPLATE,
  };
}

export const approvalLevelOf = (auth: Pick<AuthContext, 'profiles' | 'sectors'>): ApprovalLevel => userApprovalLevel(auth.profiles, auth.sectors);

// ------------------------------------------------------------------ classificação e identidade

export async function classificationHistory(db: DbOrTx, tenantId: string, contactId: string) {
  return db
    .select({
      id: s.contactClassifications.id, classKey: s.contactClassifications.classKey, category: s.contactClassifications.category, profile: s.contactClassifications.profile,
      payerProfile: s.contactClassifications.payerProfile, potential: s.contactClassifications.potential, risk: s.contactClassifications.risk, notes: s.contactClassifications.notes,
      classifiedAt: s.contactClassifications.createdAt, classifiedById: s.contactClassifications.classifiedBy, classifiedBy: s.users.name,
    })
    .from(s.contactClassifications)
    .leftJoin(s.users, eq(s.users.id, s.contactClassifications.classifiedBy))
    .where(and(eq(s.contactClassifications.tenantId, tenantId), eq(s.contactClassifications.contactId, contactId)))
    .orderBy(desc(s.contactClassifications.createdAt));
}
export type Classification = Awaited<ReturnType<typeof classificationHistory>>[number];

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/** Possíveis duplicidades (mesmo CPF/CNPJ, telefone ou e-mail) e decisões já registradas. Nada é consolidado sem decisão "mesmo". */
export async function identityOf(db: DbOrTx, tenantId: string, contact: { id: string; document: string | null; phone: string | null; email: string | null }) {
  const doc = digits(contact.document);
  const phone = digits(contact.phone).slice(-10);
  const email = (contact.email ?? '').trim().toLowerCase();
  const conds = [
    doc.length >= 11 ? sql`regexp_replace(coalesce(${s.contacts.document}, ''), '\\D', '', 'g') = ${doc}` : null,
    phone.length >= 10 ? sql`right(regexp_replace(coalesce(${s.contacts.phone}, ''), '\\D', '', 'g'), 10) = ${phone}` : null,
    email ? sql`lower(${s.contacts.email}) = ${email}` : null,
  ].filter(Boolean) as ReturnType<typeof sql>[];
  const candidates = conds.length
    ? await db
        .select({ id: s.contacts.id, name: s.contacts.name, document: s.contacts.document, phone: s.contacts.phone, email: s.contacts.email, city: s.contacts.city, lifecycle: s.customers.lifecycle })
        .from(s.contacts)
        .leftJoin(s.customers, eq(s.customers.contactId, s.contacts.id))
        .where(and(eq(s.contacts.tenantId, tenantId), ne(s.contacts.id, contact.id), isNull(s.contacts.deletedAt), or(...conds)))
        .limit(10)
    : [];
  const links = await db
    .select()
    .from(s.contactIdentityLinks)
    .where(and(eq(s.contactIdentityLinks.tenantId, tenantId), or(eq(s.contactIdentityLinks.contactId, contact.id), eq(s.contactIdentityLinks.otherContactId, contact.id))))
    .orderBy(asc(s.contactIdentityLinks.createdAt));
  const decision = new Map<string, 'mesmo' | 'diferente'>();
  for (const l of links) decision.set(l.contactId === contact.id ? l.otherContactId : l.contactId, l.decision as 'mesmo' | 'diferente');
  const sameIds = [...decision].filter(([, d]) => d === 'mesmo').map(([id]) => id);
  // vinculados que não casam mais pelos dados também entram (a decisão vale)
  const extra = sameIds.filter((id) => !candidates.some((c) => c.id === id));
  const extraRows = extra.length ? await db.select({ id: s.contacts.id, name: s.contacts.name, document: s.contacts.document, phone: s.contacts.phone, email: s.contacts.email, city: s.contacts.city, lifecycle: s.customers.lifecycle }).from(s.contacts).leftJoin(s.customers, eq(s.customers.contactId, s.contacts.id)).where(and(eq(s.contacts.tenantId, tenantId), inArray(s.contacts.id, extra))) : [];
  const all = [...candidates, ...extraRows].map((c) => ({
    ...c,
    match: [doc.length >= 11 && digits(c.document) === doc ? 'CPF/CNPJ' : null, phone.length >= 10 && digits(c.phone).slice(-10) === phone ? 'telefone' : null, email && (c.email ?? '').toLowerCase() === email ? 'e-mail' : null].filter(Boolean) as string[],
    decision: decision.get(c.id) ?? null,
  }));
  return { contactIds: [contact.id, ...sameIds], candidates: all, unresolved: all.filter((c) => !c.decision).length };
}

// ------------------------------------------------------------------ acesso

/** Quem pode abrir a análise: quem vê a oportunidade, ou quem tem alçada para decidir o pedido pendente. */
export async function loadForAnalysis(db: DbOrTx, auth: AuthContext, oppId: string) {
  try {
    const opp = await loadOpportunity(db, auth, oppId);
    return { opp, viaApproval: false };
  } catch (e) {
    const [req] = await db.select({ level: s.approvalRequests.requiredLevel }).from(s.approvalRequests).where(and(eq(s.approvalRequests.tenantId, auth.tenantId), eq(s.approvalRequests.opportunityId, oppId))).orderBy(desc(s.approvalRequests.version)).limit(1);
    if (!req || !canDecide(approvalLevelOf(auth), req.level as ApprovalLevel)) throw e;
    const [opp] = await opportunityQuery(db).where(and(eq(s.opportunities.id, oppId), eq(s.opportunities.tenantId, auth.tenantId), isNull(s.opportunities.deletedAt))).limit(1);
    if (!opp) throw notFound('Oportunidade não encontrada.');
    return { opp, viaApproval: true };
  }
}

// ------------------------------------------------------------------ pedidos e decisões

export async function requestsOf(db: DbOrTx, tenantId: string, oppIds: string[]) {
  if (!oppIds.length) return [];
  const req = await db
    .select({ r: s.approvalRequests, requester: s.users.name })
    .from(s.approvalRequests)
    .innerJoin(s.users, eq(s.users.id, s.approvalRequests.requestedBy))
    .where(and(eq(s.approvalRequests.tenantId, tenantId), inArray(s.approvalRequests.opportunityId, oppIds)))
    .orderBy(desc(s.approvalRequests.createdAt));
  const ids = req.map((x) => x.r.id);
  const decs = ids.length
    ? await db.select({ d: s.approvalDecisions, decider: s.users.name }).from(s.approvalDecisions).leftJoin(s.users, eq(s.users.id, s.approvalDecisions.decidedBy)).where(inArray(s.approvalDecisions.requestId, ids))
    : [];
  const byReq = new Map(decs.map((x) => [x.d.requestId, x]));
  return req.map(({ r, requester }) => {
    const d = byReq.get(r.id);
    return {
      id: r.id, opportunityId: r.opportunityId, version: r.version, requestedBy: r.requestedBy, requesterName: requester, createdAt: r.createdAt,
      negotiationType: r.negotiationType as NegotiationType, negotiationLabel: NEGOTIATION_TYPE_LABELS[r.negotiationType as NegotiationType] ?? r.negotiationType,
      listMonthlyCents: r.listMonthlyCents, proposedMonthlyCents: r.proposedMonthlyCents, discountBp: r.discountBp, activationFeeCents: r.activationFeeCents,
      replacesMonthlyCents: r.replacesMonthlyCents, termMonths: r.termMonths, conditions: r.conditions, justification: r.justification, risks: r.risks,
      proposalAttachmentId: r.proposalAttachmentId, requiredLevel: r.requiredLevel as ApprovalLevel, requiredLabel: APPROVAL_LEVEL_LABELS[r.requiredLevel as ApprovalLevel], exceptional: r.exceptional,
      snapshot: r.snapshot, fingerprint: r.fingerprint as unknown as AnalysisFingerprint,
      status: (d?.d.decision ?? 'pendente') as 'pendente' | 'aprovada' | 'reprovada' | 'correcao' | 'substituida',
      decision: d ? { decision: d.d.decision, by: d.decider, level: d.d.level, comment: d.d.comment, at: d.d.createdAt, materialChanges: d.d.materialChanges, approvedConditions: d.d.approvedConditions, dataVersion: d.d.dataVersion, financialSummary: d.d.financialSummary } : null,
    };
  });
}
export type RequestView = Awaited<ReturnType<typeof requestsOf>>[number];

// ------------------------------------------------------------------ análise

export type Terms = { proposedMonthlyCents: number | null; activationFeeCents: number | null; replacesMonthlyCents: number; negotiationType: NegotiationType };

export async function buildAnalysis(db: DbOrTx, auth: AuthContext, opp: OpportunityRow, overrides: Partial<Terms> = {}, opts: { viaApproval?: boolean } = {}) {
  const t = auth.tenantId;
  const settings = await approvalSettingsOf(db, t);
  const [contact] = await db.select().from(s.contacts).where(and(eq(s.contacts.id, opp.contactId), eq(s.contacts.tenantId, t))).limit(1);
  const identity = await identityOf(db, t, contact!);
  const ids = identity.contactIds;
  const requests = await requestsOf(db, t, [opp.id]);
  const latest = requests[0] ?? null;
  const pending = latest?.status === 'pendente' ? latest : null;
  const userLevel = approvalLevelOf(auth);
  const isApprover = !!pending && canDecide(userLevel, pending.requiredLevel) && pending.requestedBy !== auth.userId;
  const see = {
    customer: opts.viaApproval || isApprover || level(auth, 'clientes') !== 'nenhum',
    contracts: opts.viaApproval || isApprover || level(auth, 'contratos') !== 'nenhum',
  };

  // cadastro do cliente (todos os contatos confirmados como o mesmo cliente)
  const custs = await db.select().from(s.customers).where(and(eq(s.customers.tenantId, t), inArray(s.customers.contactId, ids)));
  const main = custs.find((c) => c.contactId === opp.contactId) ?? custs[0] ?? null;
  const [plan] = main?.planId ? await db.select().from(s.plans).where(eq(s.plans.id, main.planId)).limit(1) : [];

  // contratos
  const contractRows = await db
    .select({ c: s.contracts, v: s.contractVersions })
    .from(s.contracts)
    .innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion)))
    .where(and(eq(s.contracts.tenantId, t), inArray(s.contracts.contactId, ids)))
    .orderBy(desc(s.contracts.createdAt));
  const contractIds = contractRows.map((x) => x.c.id);
  const versions = contractIds.length
    ? await db.select({ contractId: s.contractVersions.contractId, version: s.contractVersions.version, changeKind: s.contractVersions.changeKind, reason: s.contractVersions.reason, monthlyCents: s.contractVersions.monthlyCents, startAt: s.contractVersions.startAt, signedAt: s.contractVersions.signedAt, endAt: s.contractVersions.endAt, createdAt: s.contractVersions.createdAt }).from(s.contractVersions).where(inArray(s.contractVersions.contractId, contractIds)).orderBy(asc(s.contractVersions.version))
    : [];
  const openProcs = contractIds.length ? await db.select({ contractId: s.contractProcesses.contractId, kind: s.contractProcesses.kind, dueAt: s.contractProcesses.dueAt }).from(s.contractProcesses).where(and(inArray(s.contractProcesses.contractId, contractIds), eq(s.contractProcesses.status, 'aberto'))) : [];
  const openAlerts = contractIds.length ? await db.select({ contractId: s.contractAlerts.contractId, kind: s.contractAlerts.kind, dueAt: s.contractAlerts.dueAt }).from(s.contractAlerts).where(and(inArray(s.contractAlerts.contractId, contractIds), eq(s.contractAlerts.status, 'aberto'))) : [];

  // vendas do cliente (fora esta)
  const otherOpps = await db
    .select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, valueCents: s.opportunities.valueCents, marginCents: s.opportunities.marginCents, cacCents: s.opportunities.cacCents, wonAt: s.opportunities.wonAt, lostAt: s.opportunities.lostAt, lossReason: s.opportunities.lossReason, createdAt: s.opportunities.createdAt, portReleasedAt: s.opportunities.portReleasedAt, planName: s.plans.name, ownerName: s.users.name })
    .from(s.opportunities)
    .leftJoin(s.plans, eq(s.plans.id, s.opportunities.planId))
    .leftJoin(s.users, eq(s.users.id, s.opportunities.ownerId))
    .where(and(eq(s.opportunities.tenantId, t), inArray(s.opportunities.contactId, ids), ne(s.opportunities.id, opp.id), isNull(s.opportunities.deletedAt)))
    .orderBy(desc(s.opportunities.createdAt));
  const won = otherOpps.filter((o) => o.stage === 'ganha');
  const oppById = new Map(otherOpps.map((o) => [o.id, o]));

  const kind = customerKind({ lifecycle: main?.lifecycle ?? null, contracts: contractRows.filter((x) => x.c.opportunityId !== opp.id).length, wonOpportunities: won.length, importedFromErp: custs.some((c) => c.sourceSystem !== 'crm') });

  // serviços atuais (sem duplicar: venda com contrato conta pelo contrato)
  const services: (ServiceLine & { contractId?: string; opportunityId?: string; billingType?: string })[] = [];
  const nonRecurring: { contractId: string; label: string; billingType: string; monthlyCents: number }[] = [];
  const contracted = new Set(contractRows.map((x) => x.c.opportunityId).filter(Boolean) as string[]);
  /** Custo mensal estimado na venda. Se o valor atual se afastou mais de 20% do vendido (reajuste, itens), o custo deixa de valer. */
  const costFromOpp = (oid: string | null, currentMonthly?: number) => {
    const o = oid ? oppById.get(oid) : null;
    if (!o || o.valueCents === null || o.marginCents === null || o.valueCents <= 0) return null;
    if (currentMonthly !== undefined && Math.abs(currentMonthly - o.valueCents) > o.valueCents * 0.2) return null;
    return Math.max(0, o.valueCents - o.marginCents);
  };
  for (const { c, v } of contractRows) {
    if (c.opportunityId === opp.id || !ACTIVE_CONTRACT.includes(c.stage) || c.closedAt) continue;
    if (c.billingType !== 'recorrente') { nonRecurring.push({ contractId: c.id, label: `${v.number} — ${v.object}`, billingType: c.billingType, monthlyCents: v.monthlyCents }); continue; }
    services.push({ ref: `contrato:${c.id}`, contractId: c.id, label: `Contrato ${v.number} — ${v.object}`, source: 'contrato', monthlyCents: v.monthlyCents, monthlyCostCents: costFromOpp(c.opportunityId, v.monthlyCents), billingType: c.billingType });
  }
  const customerActive = main && ['ativo', 'inadimplente', 'suspenso', 'reativado', 'em_implantacao'].includes(main.lifecycle);
  if (customerActive) {
    for (const o of won) {
      if (contracted.has(o.id) || o.portReleasedAt || !o.valueCents) continue;
      services.push({ ref: `venda:${o.id}`, opportunityId: o.id, label: `Venda OP-${o.code} — ${o.planName ?? o.title}`, source: 'venda', monthlyCents: o.valueCents, monthlyCostCents: costFromOpp(o.id) });
    }
    if (!services.length && plan?.priceCents) services.push({ ref: `cadastro:${main!.id}`, label: `Plano no cadastro — ${plan.name}`, source: 'cadastro', monthlyCents: plan.priceCents, monthlyCostCents: null });
  }

  // condições da proposta (pedido existente ou o que está sendo montado)
  const base = pending ?? latest;
  const terms: Terms = {
    proposedMonthlyCents: overrides.proposedMonthlyCents ?? base?.proposedMonthlyCents ?? opp.valueCents ?? null,
    activationFeeCents: overrides.activationFeeCents !== undefined ? overrides.activationFeeCents : base?.activationFeeCents ?? opp.activationFeeCents ?? null,
    replacesMonthlyCents: overrides.replacesMonthlyCents ?? base?.replacesMonthlyCents ?? 0,
    negotiationType: overrides.negotiationType ?? base?.negotiationType ?? (kind.kind === 'novo' ? 'novo_servico' : 'novo_servico'),
  };
  const [planRow] = opp.planId ? await db.select({ priceCents: s.plans.priceCents, name: s.plans.name }).from(s.plans).where(eq(s.plans.id, opp.planId)).limit(1) : [];
  const listMonthly = planRow?.priceCents ?? opp.valueCents ?? null;
  const viab = terms.proposedMonthlyCents !== null
    ? (await viabilityFor(db, t, { valueCents: terms.proposedMonthlyCents, planId: opp.planId, cableMeters: opp.cableMeters, activationFeeCents: terms.activationFeeCents, saleType: opp.saleType, equipment: opp.equipment, routeId: opp.routeId, condominiumId: opp.condominiumId, installStreet: opp.installStreet })).result
    : null;
  const newCost = viab && terms.proposedMonthlyCents !== null && viab.revenue.monthlyCents > 0 ? terms.proposedMonthlyCents - viab.marginMonthlyCents : null;
  const margin = negotiationMargin(services, {
    listMonthlyCents: listMonthly,
    proposedMonthlyCents: terms.proposedMonthlyCents,
    monthlyCostCents: newCost,
    investmentCents: viab ? viab.cacCents : null,
    replacesMonthlyCents: terms.replacesMonthlyCents,
  });
  const required = requiredApproval(settings.policy, margin.discount.bp, margin.after.marginBp ?? (services.length === 0 && viab && terms.proposedMonthlyCents ? Math.round((viab.marginMonthlyCents * 10_000) / Math.max(1, terms.proposedMonthlyCents)) : null));

  // classificação
  const classHist = await classificationHistory(db, t, opp.contactId);
  const cls = classHist[0] ?? null;

  // relacionamento
  const starts = [main?.contractStart ?? null, ...versions.filter((v) => v.version === 1).map((v) => v.signedAt ?? v.startAt), ...won.map((o) => day(o.wonAt))].filter(Boolean) as string[];
  const relationshipStart = starts.sort()[0] ?? null;
  const relationshipMonths = relationshipStart ? monthsBetween(relationshipStart, today()) : null;
  const activeContracts = contractRows.filter((x) => x.c.opportunityId !== opp.id && ACTIVE_CONTRACT.includes(x.c.stage) && !x.c.closedAt).length;

  // faturamento lançado em Contratos (frequente/medição); recebimentos dependem do IXC
  const billing = contractIds.length
    ? await db.select({ occurredOn: s.contractLedger.occurredOn, amountCents: s.contractLedger.amountCents, description: s.contractLedger.description, contractId: s.contractLedger.contractId }).from(s.contractLedger).where(and(inArray(s.contractLedger.contractId, contractIds), eq(s.contractLedger.kind, 'faturamento'))).orderBy(desc(s.contractLedger.occurredOn)).limit(60)
    : [];
  const cacKnown = won.filter((o) => o.cacCents !== null);
  const cacHistorical = cacKnown.length ? cacKnown.reduce((a, o) => a + (o.cacCents ?? 0), 0) : null;
  const ltvMonths = viab?.ltv.months ?? null;
  const currentMargin = margin.current.marginCents;

  const fingerprint: AnalysisFingerprint = {
    proposedMonthlyCents: terms.proposedMonthlyCents,
    listMonthlyCents: listMonthly,
    investmentCents: viab?.cacCents ?? null,
    newServiceMarginCents: viab?.marginMonthlyCents ?? null,
    currentRevenueCents: margin.current.revenueCents,
    activeContracts,
    classificationId: cls?.id ?? null,
    lifecycle: main?.lifecycle ?? null,
    proposalSha: (await latestProposal(db, t, opp.id))?.sha256 ?? null,
  };
  const changes = pending ? materialChanges({ ...pending.fingerprint, proposalSha: pending.fingerprint.proposalSha ?? null }, { ...fingerprint, proposedMonthlyCents: pending.proposedMonthlyCents, proposalSha: fingerprint.proposalSha }) : [];

  const lead = opp.leadId ? (await db.select({ createdAt: s.leads.createdAt, firstContactAt: s.leads.firstContactAt, status: s.leads.status, channel: s.leads.channel, interests: s.leads.interests, notes: s.leads.notes, lastInteractionNote: s.leads.lastInteractionNote }).from(s.leads).where(eq(s.leads.id, opp.leadId)).limit(1))[0] ?? null : null;

  const opinion = buildOpinion({
    kind: kind.kind,
    customerName: opp.contactName,
    classification: cls ? { classKey: cls.classKey, payerProfile: cls.payerProfile, risk: cls.risk, potential: cls.potential, classifiedAt: cls.classifiedAt.toLocaleDateString('pt-BR', { timeZone: auth.timezone }), classifiedBy: cls.classifiedBy } : null,
    lifecycle: main?.lifecycle ?? null,
    relationshipMonths,
    activeContracts,
    margin,
    required,
    paymentsAvailable: false,
    viability: viab ? { complete: viab.complete, missing: viab.missing, engineeringRequired: viab.engineering.required, engineeringStatus: opp.engineeringStatus, alerts: viab.alerts } : null,
    coverageStatus: opp.coverageStatus,
    justification: pending?.justification ?? latest?.justification ?? null,
    risks: pending?.risks ?? null,
    leadSource: opp.sourceName ?? opp.campaignName ?? null,
    negotiationLabel: NEGOTIATION_TYPE_LABELS[terms.negotiationType],
  });

  const contracts = see.contracts
    ? contractRows.map(({ c, v }) => {
        const vs = versions.filter((x) => x.contractId === c.id);
        return {
          id: c.id, number: v.number, object: v.object, stage: c.stage, billingType: c.billingType, kind: c.kind,
          status: c.closedAt || c.stage === 'arquivado' ? 'encerrado' : c.stage === 'cadastro_validacao' ? 'em_validacao' : main?.lifecycle === 'suspenso' ? 'suspenso' : 'ativo',
          monthlyCents: v.monthlyCents, totalCents: v.totalCents, startAt: v.startAt, endAt: v.endAt, signedAt: v.signedAt,
          items: v.items.map((i) => ({ description: i.description, qty: i.qty, unitCents: i.unitCents })),
          adjustments: vs.filter((x) => x.changeKind === 'reajuste').map((x) => ({ version: x.version, at: day(x.createdAt), monthlyCents: x.monthlyCents, reason: x.reason })),
          renewals: vs.filter((x) => x.changeKind === 'renovacao').map((x) => ({ version: x.version, at: day(x.createdAt), endAt: x.endAt, reason: x.reason })),
          closure: c.closedAt || c.closureExpected ? { expected: c.closureExpected, reason: c.closureReason, at: c.closureAt ?? day(c.closedAt) } : null,
          pendencies: [
            ...openProcs.filter((p) => p.contractId === c.id).map((p) => `${PROCESS_LABELS[p.kind as ProcessKind] ?? p.kind} em andamento${p.dueAt ? ` (prazo ${br(p.dueAt)})` : ''}`),
            ...openAlerts.filter((a) => a.contractId === c.id).map((a) => `${ALERT_LABELS[a.kind as AlertKind] ?? a.kind}${a.dueAt ? ` até ${br(a.dueAt)}` : ''}`),
          ],
          isThisNegotiation: c.opportunityId === opp.id,
        };
      })
    : null;

  const attachments = await db
    .select({ id: s.opportunityAttachments.id, kind: s.opportunityAttachments.kind, filename: s.opportunityAttachments.filename, sizeBytes: s.opportunityAttachments.sizeBytes, createdAt: s.opportunityAttachments.createdAt })
    .from(s.opportunityAttachments)
    .where(and(eq(s.opportunityAttachments.opportunityId, opp.id), eq(s.opportunityAttachments.tenantId, t), isNull(s.opportunityAttachments.deletedAt)))
    .orderBy(desc(s.opportunityAttachments.createdAt));

  const proj = (v: number | null, months: number) => (v === null ? null : v * months);
  const waiting = { kind: 'indisponivel' as const, source: 'IXC (leitura de faturas e baixas ainda não integrada)' };

  return {
    generatedAt: new Date().toISOString(),
    kind,
    viewer: { level: userLevel, levelLabel: APPROVAL_LEVEL_LABELS[userLevel], isApprover, isRequester: !!pending && pending.requestedBy === auth.userId, canRequest: opp.ownerId === auth.userId || level(auth, 'oportunidades') !== 'proprio', see },
    opportunity: {
      id: opp.id, code: opp.code, title: opp.title, stage: opp.stage, stageName: opp.stageName, pipelineName: opp.pipelineName, ownerId: opp.ownerId, ownerName: opp.ownerName,
      planName: opp.planName, valueCents: opp.valueCents, coverageStatus: opp.coverageStatus, engineeringStatus: opp.engineeringStatus, proposalStatus: opp.proposalStatus,
      segment: opp.contactSegment, region: opp.regionName, condominium: opp.condominiumName, city: opp.installCity ?? opp.contactCity, saleType: opp.saleType, channel: opp.channel,
      sourceName: opp.sourceName, campaignName: opp.campaignName, createdAt: opp.createdAt, reasons: opp.reasons,
    },
    customer: see.customer
      ? {
          contactId: opp.contactId, name: opp.contactName, document: contact!.document, phone: opp.contactPhone, email: opp.contactEmail, city: contact!.city, segment: contact!.segment,
          lifecycle: main?.lifecycle ?? 'prospect', sourceSystem: main?.sourceSystem ?? 'crm', externalId: main?.externalId ?? null, planName: plan?.name ?? null,
          custom: contact!.custom, lead,
        }
      : null,
    identity: see.customer ? identity : null,
    classification: see.customer ? { current: cls, history: classHist.slice(0, 10), options: settings.classificationOptions } : null,
    terms: { ...terms, listMonthlyCents: listMonthly, discountBp: discountBp(listMonthly, terms.proposedMonthlyCents), planName: planRow?.name ?? opp.planName },
    viability: viab ? { complete: viab.complete, missing: viab.missing, route: viab.route, revenue: viab.revenue, monthlyDeductions: viab.monthlyDeductions, oneTimeCosts: viab.oneTimeCosts, investmentCents: viab.oneTimeCosts.reduce((a, l) => a + l.cents, 0), commissionCents: viab.commission.cents, marginMonthlyCents: viab.marginMonthlyCents, cacCents: viab.cacCents, paybackMonths: viab.paybackMonths, ltv: viab.ltv, alerts: viab.alerts, engineering: viab.engineering } : null,
    projections: {
      revenue12mCents: proj(terms.proposedMonthlyCents, 12),
      revenueLifetimeCents: ltvMonths && terms.proposedMonthlyCents !== null ? Math.round(terms.proposedMonthlyCents * ltvMonths) : null,
      ltvMonths,
    },
    intelligence: kind.kind === 'base' && see.customer
      ? {
          relationshipStart, relationshipMonths, lifecycle: main?.lifecycle ?? null,
          monthlyRevenueCents: { value: margin.current.revenueCents, kind: 'contratado' as const, source: services.length ? `Soma de ${services.length} serviço(s) recorrente(s) ativo(s): ${[...new Set(services.map((x) => x.source))].join(', ')}` : 'Sem serviço recorrente ativo' },
          nonRecurring,
          services: services.map((x) => ({ label: x.label, source: x.source, monthlyCents: x.monthlyCents, monthlyCostCents: x.monthlyCostCents, contractId: x.contractId ?? null, opportunityId: x.opportunityId ?? null })),
          totalPaid: waiting, paidInstallments: waiting, delinquency: { ...waiting, cadastro: main?.lifecycle === 'inadimplente' ? 'Cadastro marcado como inadimplente' : null }, lateHistory: waiting, punctuality: waiting,
          billingHistory: billing.map((b) => ({ ...b, contract: contractRows.find((x) => x.c.id === b.contractId)?.v.number ?? null })),
          billedInCrmCents: billing.reduce((a, b) => a + b.amountCents, 0),
          ltvRealized: waiting,
          ltvProjectedCents: currentMargin !== null && ltvMonths ? { value: Math.round(currentMargin * ltvMonths), kind: 'projetado' as const, source: `Margem mensal atual × vida média de ${ltvMonths} meses (${viab?.ltv.source === 'base' ? 'carteira' : 'parâmetro'})` } : null,
          cacHistoricalCents: cacHistorical === null ? null : { value: cacHistorical, kind: 'estimado' as const, source: `CAC calculado na venda de ${cacKnown.length} de ${won.length} venda(s) fechada(s)` },
          cacPaybackMonths: cacHistorical !== null && currentMargin && currentMargin > 0 ? Math.round((cacHistorical / currentMargin) * 10) / 10 : null,
          profitabilityRealized: waiting,
          wonOpportunities: won.length,
          activeContracts,
        }
      : null,
    margin,
    policy: { limits: settings.policy.limits, required },
    opinion,
    executive: {
      customer: opp.contactName,
      kindLabel: kind.label,
      classKey: cls?.classKey ?? null,
      payerProfile: cls?.payerProfile ?? null,
      relationshipMonths: kind.kind === 'base' ? relationshipMonths : null,
      totalPaid: kind.kind === 'base' ? waiting : null,
      monthlyRevenueCents: kind.kind === 'base' ? margin.current.revenueCents : null,
      activeContracts: kind.kind === 'base' ? activeContracts : null,
      incrementalRevenueCents: margin.incremental.revenueCents,
      investmentCents: margin.incremental.investmentCents,
      marginBeforeBp: kind.kind === 'base' ? margin.current.marginBp : null,
      marginAfterBp: margin.after.marginBp,
      newMarginBp: viab && terms.proposedMonthlyCents ? Math.round((viab.marginMonthlyCents * 10_000) / Math.max(1, terms.proposedMonthlyCents)) : null,
      paybackMonths: margin.incremental.paybackMonths,
      potential: cls?.potential ?? null,
      viabilityComplete: viab?.complete ?? false,
      risk: [cls?.risk ? `Risco ${cls.risk}` : null, main?.lifecycle === 'inadimplente' || main?.lifecycle === 'suspenso' ? `Cliente ${main.lifecycle}` : null, required.exceptional ? 'Fora da política comercial' : null, pending?.risks ?? null].filter(Boolean) as string[],
      justification: pending?.justification ?? latest?.justification ?? null,
      decisionAsked: pending ? `Aprovar ${NEGOTIATION_TYPE_LABELS[pending.negotiationType]?.toLowerCase()} por ${(pending.proposedMonthlyCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês${pending.discountBp ? ` com ${(pending.discountBp / 100).toLocaleString('pt-BR')}% de desconto` : ''} — alçada ${pending.requiredLabel}${pending.exceptional ? ' (excepcional)' : ''}` : null,
    },
    requests,
    pending,
    materialChanges: changes,
    fingerprint,
    attachments,
    otherOpportunities: see.customer ? otherOpps.map((o) => ({ id: o.id, code: o.code, title: o.title, stage: o.stage, valueCents: o.valueCents, createdAt: o.createdAt, wonAt: o.wonAt, lostAt: o.lostAt, lossReason: o.lossReason, planName: o.planName, ownerName: o.ownerName })) : null,
    contracts,
    dataReference: [
      { label: 'Cadastro, oportunidades e contratos', asOf: new Date().toISOString(), source: 'CRM (tempo real)' },
      ...(main?.sourceSystem && main.sourceSystem !== 'crm' ? [{ label: 'Cadastro importado', asOf: main.ingestedAt?.toISOString() ?? null, source: main.sourceSystem }] : []),
      { label: 'Pagamentos e inadimplência', asOf: null, source: 'Aguardando integração de leitura do IXC' },
    ],
  };
}
export type Analysis = Awaited<ReturnType<typeof buildAnalysis>>;

export async function latestProposal(db: DbOrTx, tenantId: string, oppId: string) {
  const [a] = await db.select({ id: s.opportunityAttachments.id, sha256: s.opportunityAttachments.sha256, filename: s.opportunityAttachments.filename }).from(s.opportunityAttachments).where(and(eq(s.opportunityAttachments.opportunityId, oppId), eq(s.opportunityAttachments.tenantId, tenantId), eq(s.opportunityAttachments.kind, 'proposta'), isNull(s.opportunityAttachments.deletedAt))).orderBy(desc(s.opportunityAttachments.createdAt)).limit(1);
  return a ?? null;
}

/** Linhas do tempo: desta negociação e do relacionamento (sem o chat interno). */
export async function timelines(db: DbOrTx, auth: AuthContext, a: Analysis) {
  const t = auth.tenantId;
  const oppId = a.opportunity.id;
  type Item = { at: string; kind: string; title: string; detail?: string | null; who?: string | null; link?: string | null };
  const negotiation: Item[] = [];
  const evs = await db.select({ e: s.opportunityEvents, who: s.users.name }).from(s.opportunityEvents).leftJoin(s.users, eq(s.users.id, s.opportunityEvents.actorId)).where(and(eq(s.opportunityEvents.tenantId, t), eq(s.opportunityEvents.opportunityId, oppId))).orderBy(desc(s.opportunityEvents.occurredAt)).limit(200);
  for (const { e, who } of evs) negotiation.push({ at: e.occurredAt.toISOString(), kind: e.type, title: eventTitle(e.type, e.fromValue, e.toValue), detail: e.reason, who });
  const acts = await db.select({ a: s.activities, who: s.users.name }).from(s.activities).leftJoin(s.users, eq(s.users.id, s.activities.ownerId)).where(and(eq(s.activities.tenantId, t), eq(s.activities.opportunityId, oppId), isNull(s.activities.deletedAt))).orderBy(desc(s.activities.createdAt)).limit(100);
  for (const { a: x, who } of acts) negotiation.push({ at: (x.completedAt ?? x.createdAt).toISOString(), kind: 'atividade', title: `${x.completedAt ? 'Concluída' : 'Agendada'}: ${x.title}`, detail: x.notes, who });
  for (const r of a.requests) {
    negotiation.push({ at: new Date(r.createdAt).toISOString(), kind: 'aprovacao_pedido', title: `Pedido de aprovação v${r.version} (${r.negotiationLabel}, alçada ${r.requiredLabel})`, detail: r.justification, who: r.requesterName });
    if (r.decision) negotiation.push({ at: new Date(r.decision.at).toISOString(), kind: 'aprovacao_decisao', title: `v${r.version}: ${decisionLabel(r.decision.decision)}`, detail: r.decision.comment, who: r.decision.by });
  }

  const relationship: Item[] = [];
  if (a.customer && a.identity) {
    const ids = a.identity.contactIds;
    for (const o of a.otherOpportunities ?? []) {
      relationship.push({ at: new Date(o.createdAt).toISOString(), kind: 'negociacao', title: `Negociação OP-${o.code}: ${o.title}`, detail: o.planName, who: o.ownerName, link: `/opportunities/${o.id}` });
      if (o.wonAt) relationship.push({ at: new Date(o.wonAt).toISOString(), kind: 'contratacao', title: `Venda fechada OP-${o.code}`, detail: o.valueCents ? `${(o.valueCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês` : null, who: o.ownerName, link: `/opportunities/${o.id}` });
      if (o.lostAt) relationship.push({ at: new Date(o.lostAt).toISOString(), kind: 'perda', title: `Negociação perdida OP-${o.code}`, detail: o.lossReason, who: o.ownerName, link: `/opportunities/${o.id}` });
    }
    const prevReqs = await requestsOf(db, t, (a.otherOpportunities ?? []).map((o) => o.id));
    for (const r of prevReqs) if (r.decision && r.decision.decision !== 'substituida') relationship.push({ at: new Date(r.decision.at).toISOString(), kind: 'aprovacao_anterior', title: `Aprovação anterior (OP de ${r.negotiationLabel}): ${decisionLabel(r.decision.decision)}`, detail: r.decision.comment, who: r.decision.by, link: `/opportunities/${r.opportunityId}/aprovacao` });
    if (a.contracts?.length) {
      const cev = await db.select({ e: s.contractEvents, who: s.users.name, number: s.contractVersions.number }).from(s.contractEvents).leftJoin(s.users, eq(s.users.id, s.contractEvents.actorId)).innerJoin(s.contracts, eq(s.contracts.id, s.contractEvents.contractId)).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion))).where(and(eq(s.contractEvents.tenantId, t), inArray(s.contractEvents.contractId, a.contracts.map((c) => c.id)))).orderBy(desc(s.contractEvents.occurredAt)).limit(200);
      for (const { e, who, number } of cev) relationship.push({ at: e.occurredAt.toISOString(), kind: `contrato_${e.type}`, title: `Contrato ${number}: ${e.summary}`, who, link: `/contracts/${e.contractId}` });
    }
    const cacts = await db.select({ a: s.activities, who: s.users.name }).from(s.activities).leftJoin(s.users, eq(s.users.id, s.activities.ownerId)).where(and(eq(s.activities.tenantId, t), inArray(s.activities.contactId, ids), isNull(s.activities.deletedAt), sql`${s.activities.completedAt} is not null`, or(isNull(s.activities.opportunityId), ne(s.activities.opportunityId, oppId)))).orderBy(desc(s.activities.completedAt)).limit(50);
    for (const { a: x, who } of cacts) relationship.push({ at: x.completedAt!.toISOString(), kind: 'atividade', title: x.title, detail: x.notes, who });
    for (const c of a.classification?.history ?? []) relationship.push({ at: new Date(c.classifiedAt).toISOString(), kind: 'classificacao', title: `Classificação: ${[c.classKey, c.payerProfile, c.risk ? `risco ${c.risk}` : null].filter(Boolean).join(', ') || 'atualizada'}`, detail: c.notes, who: c.classifiedBy });
  }
  const sort = (x: Item[]) => x.sort((p, q) => (p.at < q.at ? 1 : -1));
  return { negotiation: sort(negotiation), relationship: sort(relationship) };
}

const decisionLabel = (d: string) => ({ aprovada: 'Aprovada', reprovada: 'Reprovada', correcao: 'Correção solicitada', substituida: 'Substituída por nova versão' })[d] ?? d;
function eventTitle(type: string, from: string | null, to: string | null) {
  const map: Record<string, string> = {
    created: 'Oportunidade criada', stage_changed: `Etapa: ${from ?? '—'} → ${to ?? '—'}`, attachment_added: 'Anexo adicionado', attachment_removed: 'Anexo removido', assigned: 'Responsável alterado',
    whatsapp_sent: 'Enviado por WhatsApp', email_sent: 'E-mail enviado', duplicated_to: 'Duplicada em outro funil', duplicated_from: 'Criada por duplicação', automation_ran: 'Automação executada',
    port_released: 'Porta da CTO liberada', medicao_vinculada: 'Contrato por medição vinculado', erp_atualizado: 'ERP atualizado', contrato_cadastrado: 'Contrato cadastrado', contrato_encerrado: 'Contrato encerrado',
    sucesso_cliente_decisao: 'Decisão sobre Sucesso do Cliente', approval_requested: 'Aprovação solicitada', approval_decided: `Decisão de aprovação: ${to ?? ''}`,
  };
  return map[type] ?? type.replace(/_/g, ' ');
}

/** Resumo financeiro gravado com o pedido e com a decisão (o que foi considerado). */
export function financialSummary(a: Analysis) {
  return {
    kind: a.kind.kind,
    listMonthlyCents: a.terms.listMonthlyCents,
    proposedMonthlyCents: a.terms.proposedMonthlyCents,
    discountBp: a.margin.discount.bp,
    replacesMonthlyCents: a.terms.replacesMonthlyCents,
    currentRevenueCents: a.margin.current.revenueCents,
    currentMarginBp: a.margin.current.marginBp,
    incrementalRevenueCents: a.margin.incremental.revenueCents,
    incrementalMarginCents: a.margin.incremental.marginCents,
    investmentCents: a.margin.incremental.investmentCents,
    paybackMonths: a.margin.incremental.paybackMonths,
    marginAfterBp: a.margin.after.marginBp,
    reliable: a.margin.reliable,
    requiredLevel: a.policy.required.level,
    exceptional: a.policy.required.exceptional,
    classKey: a.classification?.current?.classKey ?? null,
    activeContracts: a.intelligence?.activeContracts ?? 0,
    warnings: a.margin.warnings,
    opinion: a.opinion.summary,
    generatedAt: a.generatedAt,
  };
}
