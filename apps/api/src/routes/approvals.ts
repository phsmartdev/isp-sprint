/**
 * Análise e aprovação da negociação: análise por perfil (novo × base), pedido vinculado à versão da proposta,
 * decisão por alçada, chat da negociação e avisos por WhatsApp/e-mail com resumo seguro.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  APPROVAL_LEVELS, APPROVAL_LEVEL_LABELS, CLASSIFICATION_DIMENSIONS, DECISIONS, DECISION_LABELS, NEGOTIATION_TYPES, NEGOTIATION_TYPE_LABELS,
  canDecide, renderApprovalTemplate, userApprovalLevel, type ApprovalLevel,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { FastifyInstance } from 'fastify';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import { audit } from '../services/audit';
import { decryptSecret, sendAlert, smtpConfig } from '../services/email';
import { integrationRow, logEvent } from '../services/integrations';
import { publicLink } from '../services/alerts';
import { sendZapiText, waPhone } from '../services/whatsapp';
import { level, ownerScope } from '../services/scope';
import { chatOf } from '../services/negotiation';
import { loadOpportunity } from '../services/opportunities';
import { computeEconomics, economicsContext, isStale } from '../services/economics';
import {
  approvalLevelOf, approvalSettingsOf, buildAnalysis, classificationHistory, financialSummary, latestProposal, loadForAnalysis, requestsOf, timelines, type Analysis, type RequestView,
} from '../services/approvals';

const money = (c: number | null | undefined) => (c === null || c === undefined ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const cents = z.number().int().min(0).max(1_000_000_000);
const AnalysisQuery = z.object({
  proposed: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  activation: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  replaces: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  type: z.enum(NEGOTIATION_TYPES).optional(),
});
const RequestBody = z.object({
  negotiationType: z.enum(NEGOTIATION_TYPES),
  proposedMonthlyCents: cents,
  activationFeeCents: cents.nullable().default(null),
  replacesMonthlyCents: cents.default(0),
  termMonths: z.number().int().min(1).max(120).nullable().default(null),
  conditions: z.string().trim().max(2000).nullable().default(null),
  justification: z.string().trim().min(10, 'Explique a justificativa comercial (ao menos 10 caracteres)').max(2000),
  risks: z.string().trim().max(1000).nullable().default(null),
});
const DecisionBody = z.object({
  decision: z.enum(DECISIONS),
  comment: z.string().trim().max(2000).default(''),
  acknowledgeChanges: z.boolean().default(false),
  /** Analisado com estes dados (impressão digital): se mudaram depois, pede confirmação. */
  analysisAt: z.string().max(40).optional(),
});
const Classification = z.object(Object.fromEntries(CLASSIFICATION_DIMENSIONS.map((k) => [k, z.string().trim().max(80).nullable().default(null)])) as Record<(typeof CLASSIFICATION_DIMENSIONS)[number], z.ZodDefault<z.ZodNullable<z.ZodString>>>).extend({ notes: z.string().trim().max(2000).nullable().default(null) });

const postSystem = (db: DbOrTx, tenantId: string, oppId: string, body: string, requestId: string | null, authorId: string | null = null) =>
  db.insert(s.negotiationMessages).values({ tenantId, opportunityId: oppId, kind: 'sistema', body: body.slice(0, 4000), requestId, authorId });

/** Usuários ativos com alçada para decidir (menos quem pediu). */
async function approversFor(db: DbOrTx, tenantId: string, required: ApprovalLevel, exceptId: string) {
  const rows = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone, sectors: s.users.sectors, role: s.roles.key }).from(s.users).leftJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).leftJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true)));
  const byUser = new Map<string, { id: string; name: string; email: string; phone: string | null; sectors: string[]; profiles: string[] }>();
  for (const r of rows) {
    const u = byUser.get(r.id) ?? { id: r.id, name: r.name, email: r.email, phone: r.phone, sectors: r.sectors, profiles: [] };
    if (r.role) u.profiles.push(r.role);
    byUser.set(r.id, u);
  }
  return [...byUser.values()].filter((u) => u.id !== exceptId && canDecide(userApprovalLevel(u.profiles, u.sectors), required));
}

/** Avisa por e-mail e WhatsApp com o resumo seguro; o resultado vai para o chat da negociação. */
async function notify(app: FastifyInstance, tenantId: string, oppId: string, requestId: string, to: { name: string; email: string; phone: string | null }[], subject: string, text: string) {
  const st = await approvalSettingsOf(app.db, tenantId);
  const report: string[] = [];
  if (st.notifyEmail) {
    const smtp = await smtpConfig(app.db, tenantId);
    if (!smtp?.enabled) report.push('E-mail não enviado: SMTP desligado.');
    else for (const u of to) {
      const r = await sendAlert(app.db, { tenantId, kind: 'aprovacao', to: u.email, subject, text, opportunityId: oppId });
      report.push(r && 'ok' in r && r.ok ? `E-mail para ${u.name}.` : `E-mail para ${u.name} falhou.`);
    }
  }
  if (st.notifyWhatsapp) {
    const z = await integrationRow(app.db, tenantId, 'zapi');
    const tok = z.secrets.instanceToken ? decryptSecret(z.secrets.instanceToken) : null;
    if (!z.enabled || !z.config.instanceId || !tok) report.push('WhatsApp não enviado: Z-API não configurada.');
    else for (const u of to) {
      const ph = waPhone(u.phone);
      if (!ph) { report.push(`WhatsApp para ${u.name}: sem número no cadastro do usuário.`); continue; }
      try {
        await sendZapiText({ instanceId: z.config.instanceId, instanceToken: tok, clientToken: z.secrets.clientToken ? decryptSecret(z.secrets.clientToken) : null }, ph, text);
        await logEvent(app.db, tenantId, 'zapi', 'enviado', `Aviso de aprovação para ${u.name}.`);
        report.push(`WhatsApp para ${u.name}.`);
      } catch (e) {
        await logEvent(app.db, tenantId, 'zapi', 'erro', `Aviso de aprovação para ${u.name}: ${(e as Error).message}`);
        report.push(`WhatsApp para ${u.name} falhou: ${(e as Error).message}`);
      }
    }
  }
  if (!to.length) report.push('Nenhum usuário com alçada para receber o aviso.');
  if (report.length) await postSystem(app.db, tenantId, oppId, `Avisos: ${report.join(' ')}`, requestId);
  return report;
}

function safeMessage(tpl: string, a: Analysis, r: Pick<RequestView, 'negotiationLabel' | 'proposedMonthlyCents' | 'justification'>, link: string, showClass: boolean) {
  const cls = showClass ? a.classification?.current?.classKey ?? null : null;
  return renderApprovalTemplate(tpl, {
    cliente: a.opportunity.title && a.customer ? a.customer.name : a.opportunity.title,
    oportunidade: `OP-${a.opportunity.code}`,
    responsavel: a.opportunity.ownerName,
    tipo: r.negotiationLabel,
    classe: cls ?? '',
    classe_linha: cls ? `Classe: ${cls}\n` : '',
    valor: `${money(r.proposedMonthlyCents)}/mês`,
    justificativa: r.justification.length > 280 ? `${r.justification.slice(0, 277)}...` : r.justification,
    link,
  });
}

export const approvalRoutes = [
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/approval',
    summary: 'Análise da negociação para aprovação (novo cliente × cliente da base), com parecer, históricos e chat',
    tag: 'Aprovações',
    anyAuthenticated: true,
    params: IdParams,
    query: AnalysisQuery,
    handler: async ({ app, auth, params, query, req }) => {
      const { opp, viaApproval } = await loadForAnalysis(app.db, auth, params.id);
      const a = await buildAnalysis(app.db, auth, opp, { proposedMonthlyCents: query.proposed, activationFeeCents: query.activation, replacesMonthlyCents: query.replaces, negotiationType: query.type }, { viaApproval });
      const [tl, chat] = await Promise.all([timelines(app.db, auth, a), chatOf(app.db, auth.tenantId, opp.id)]);
      await audit(app.db, req, { action: 'approval.view', entityType: 'opportunity', entityId: opp.id });
      return { ...a, timelines: tl, chat, labels: { decisions: DECISION_LABELS, levels: APPROVAL_LEVEL_LABELS, negotiationTypes: NEGOTIATION_TYPE_LABELS } };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/approval/requests',
    summary: 'Solicita aprovação (nova versão das condições; substitui a pendente)',
    tag: 'Aprovações',
    module: 'oportunidades',
    params: IdParams,
    body: RequestBody,
    rateLimit: () => ({ max: 20, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      if (opp.stage === 'perdida') throw unprocessable('Oportunidade perdida: reabra antes de pedir aprovação.');
      // trava de segmento do motor financeiro: com a viabilidade econômica preenchida, retorno fora da política não vai para aprovação
      const [econ] = await app.db.select({ opportunityId: s.opportunityEconomics.opportunityId }).from(s.opportunityEconomics).where(eq(s.opportunityEconomics.opportunityId, opp.id)).limit(1);
      if (econ) {
        // decide pelo cálculo salvo; desatualizado, sem parâmetros ou com tributo faltando, pede para resolver antes
        const ctx = await economicsContext(app.db, { ...opp, tenantId: auth.tenantId });
        const er = ctx.savedResult!;
        const fresh = computeEconomics(ctx);
        if (!fresh || !ctx.settings) throw unprocessable('A empresa ainda não informou os parâmetros da viabilidade econômica (Configurações → Viabilidade).');
        if (isStale(er, fresh)) throw unprocessable('A viabilidade econômica mudou desde que foi salva (produtos, tributos ou parâmetros). Abra a aba Viabilidade econômica, confira e salve de novo antes de pedir aprovação.');
        if (er.withReservations) throw unprocessable('Viabilidade econômica: todos os produtos precisam de documento fiscal com tributos vigentes cadastrados na filial antes de pedir aprovação.');
        if (ctx.settings.blockOutsidePolicy && er.verdict !== 'viavel') {
          const pb = er.kpi?.paybackMonths;
          throw unprocessable({
            inviavel: 'Viabilidade econômica: tributos, comissão e perdas consomem a receita. Revise antes de pedir aprovação.',
            sem_preco: 'Viabilidade econômica sem preço: lance os produtos ou informe o preço.',
            abaixo_minimo: 'Viabilidade econômica abaixo do preço mínimo: o preço não cobre custos, tributos e o investimento no prazo da política.',
            fora_politica: `Viabilidade econômica fora da política: o investimento volta em ${pb == null ? 'mais que a vigência' : `${pb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`} (payback descontado) e o limite para ${ctx.publicSector ? 'setor público' : 'setor privado'} é ${er.term.Dalvo}. Ajuste preço, investimento ou vigência.`,
            abaixo_recomendado: `Viabilidade econômica abaixo da margem mínima: ${(er.kpi?.marginPct ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% contra ${(er.rates.m * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% exigidos.`,
          }[er.verdict as 'inviavel']);
        }
      }
      const a = await buildAnalysis(app.db, auth, opp, { proposedMonthlyCents: body.proposedMonthlyCents, activationFeeCents: body.activationFeeCents, replacesMonthlyCents: body.replacesMonthlyCents, negotiationType: body.negotiationType });
      const prop = await latestProposal(app.db, auth.tenantId, opp.id);
      const created = await app.db.transaction(async (tx) => {
        // um pedido por vez: trava a oportunidade e numera a versão
        await tx.execute(sql`select id from opportunities where id = ${opp.id} for update`);
        const prev = await requestsOf(tx, auth.tenantId, [opp.id]);
        const pending = prev.find((p) => p.status === 'pendente');
        const version = (prev[0]?.version ?? 0) + 1;
        const [r] = await tx.insert(s.approvalRequests).values({
          tenantId: auth.tenantId, opportunityId: opp.id, version, requestedBy: auth.userId, negotiationType: body.negotiationType,
          listMonthlyCents: a.terms.listMonthlyCents, proposedMonthlyCents: body.proposedMonthlyCents, discountBp: a.margin.discount.bp, activationFeeCents: body.activationFeeCents,
          replacesMonthlyCents: body.replacesMonthlyCents, termMonths: body.termMonths, conditions: body.conditions, justification: body.justification, risks: body.risks,
          proposalAttachmentId: prop?.id ?? null, proposalSha256: prop?.sha256 ?? null, requiredLevel: a.policy.required.level, exceptional: a.policy.required.exceptional,
          snapshot: financialSummary(a), fingerprint: a.fingerprint as unknown as Record<string, unknown>,
        }).returning();
        if (pending) {
          await tx.insert(s.approvalDecisions).values({ tenantId: auth.tenantId, requestId: pending.id, opportunityId: opp.id, decision: 'substituida', decidedBy: auth.userId, comment: `Substituída pela versão ${version}.` });
        }
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'approval_requested', actorId: auth.userId, toValue: `v${version}`, reason: body.justification.slice(0, 500), payload: { requestId: r!.id, requiredLevel: r!.requiredLevel, exceptional: r!.exceptional, proposedMonthlyCents: r!.proposedMonthlyCents, discountBp: r!.discountBp }, rowVersion: opp.rowVersion });
        await tx.insert(s.negotiationMessages).values({ tenantId: auth.tenantId, opportunityId: opp.id, authorId: auth.userId, kind: 'sistema', requestId: r!.id, body: `Aprovação solicitada (v${version}): ${NEGOTIATION_TYPE_LABELS[body.negotiationType]}, ${money(body.proposedMonthlyCents)}/mês${r!.discountBp ? `, desconto de ${(r!.discountBp / 100).toLocaleString('pt-BR')}%` : ''}. Alçada: ${APPROVAL_LEVEL_LABELS[r!.requiredLevel as ApprovalLevel]}${r!.exceptional ? ' (excepcional)' : ''}.` });
        return r!;
      });
      await audit(app.db, req, { action: 'approval.request', entityType: 'opportunity', entityId: opp.id, metadata: { requestId: created.id, version: created.version, requiredLevel: created.requiredLevel } });
      const st = await approvalSettingsOf(app.db, auth.tenantId);
      const link = publicLink(app.config, `/opportunities/${opp.id}/aprovacao`);
      const view = { negotiationLabel: NEGOTIATION_TYPE_LABELS[body.negotiationType], proposedMonthlyCents: body.proposedMonthlyCents, justification: body.justification };
      const text = safeMessage(st.template, a, view, link, st.notifyShowClass);
      const approvers = await approversFor(app.db, auth.tenantId, created.requiredLevel as ApprovalLevel, auth.userId);
      const notified = await notify(app, auth.tenantId, opp.id, created.id, approvers, `Aprovação: ${a.customer?.name ?? opp.contactName} — OP-${opp.code}`, text);
      reply.code(201);
      return { id: created.id, version: created.version, requiredLevel: created.requiredLevel, exceptional: created.exceptional, notified };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/approval-requests/:id/decision',
    summary: 'Aprova, reprova ou pede correção (alçada conferida no servidor; registra o resumo considerado)',
    tag: 'Aprovações',
    anyAuthenticated: true,
    params: IdParams,
    body: DecisionBody,
    handler: async ({ app, auth, params, body, req }) => {
      const [r] = await app.db.select().from(s.approvalRequests).where(and(eq(s.approvalRequests.id, params.id), eq(s.approvalRequests.tenantId, auth.tenantId))).limit(1);
      if (!r) throw notFound('Pedido de aprovação não encontrado.');
      const myLevel = approvalLevelOf(auth);
      if (r.requestedBy === auth.userId) throw forbidden('Quem pediu a aprovação não pode decidir o próprio pedido.');
      if (!canDecide(myLevel, r.requiredLevel as ApprovalLevel)) throw forbidden(`Este pedido exige a alçada ${APPROVAL_LEVEL_LABELS[r.requiredLevel as ApprovalLevel]}; a sua é ${APPROVAL_LEVEL_LABELS[myLevel]}.`);
      if (body.decision !== 'aprovada' && body.comment.trim().length < 5) throw unprocessable('Escreva o motivo para reprovar ou pedir correção.', [{ path: 'comment', message: 'Explique o motivo' }]);
      const { opp, viaApproval } = await loadForAnalysis(app.db, auth, r.opportunityId);
      const a = await buildAnalysis(app.db, auth, opp, {}, { viaApproval });
      if (!a.pending || a.pending.id !== r.id) throw unprocessable('Este pedido já foi decidido ou substituído por uma nova versão.');
      if (a.materialChanges.length && body.decision === 'aprovada' && !body.acknowledgeChanges) {
        throw unprocessable(`Os dados mudaram desde o pedido: ${a.materialChanges.join(' ')} Atualize a análise ou confirme que considerou as mudanças.`, [{ path: 'acknowledgeChanges', message: 'Dados mudaram' }]);
      }
      const summary = financialSummary(a);
      const conditions = body.decision === 'aprovada'
        ? { negotiationType: r.negotiationType, proposedMonthlyCents: r.proposedMonthlyCents, listMonthlyCents: r.listMonthlyCents, discountBp: r.discountBp, activationFeeCents: r.activationFeeCents, replacesMonthlyCents: r.replacesMonthlyCents, termMonths: r.termMonths, conditions: r.conditions, proposalAttachmentId: r.proposalAttachmentId, proposalSha256: r.proposalSha256 }
        : null;
      const label = DECISION_LABELS[body.decision];
      await app.db.transaction(async (tx) => {
        await tx.insert(s.approvalDecisions).values({
          tenantId: auth.tenantId, requestId: r.id, opportunityId: r.opportunityId, decision: body.decision, decidedBy: auth.userId, level: myLevel, comment: body.comment || null,
          financialSummary: summary, dataVersion: { fingerprint: a.fingerprint, generatedAt: a.generatedAt, requestVersion: r.version, analysisAt: body.analysisAt ?? null },
          materialChanges: a.materialChanges, approvedConditions: conditions,
        });
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: r.opportunityId, type: 'approval_decided', actorId: auth.userId, fromValue: `v${r.version}`, toValue: label, reason: body.comment || null, payload: { requestId: r.id, decision: body.decision, level: myLevel, materialChanges: a.materialChanges } });
        await tx.insert(s.negotiationMessages).values({ tenantId: auth.tenantId, opportunityId: r.opportunityId, authorId: auth.userId, kind: 'sistema', requestId: r.id, body: `${label} (v${r.version}) por ${auth.name} — alçada ${APPROVAL_LEVEL_LABELS[myLevel]}.${body.comment ? ` Comentário: ${body.comment}` : ''}${a.materialChanges.length ? ` Mudanças consideradas: ${a.materialChanges.join(' ')}` : ''}` });
      });
      await audit(app.db, req, { action: 'approval.decide', entityType: 'opportunity', entityId: r.opportunityId, metadata: { requestId: r.id, decision: body.decision, level: myLevel } });
      // avisa quem pediu
      const [who] = await app.db.select({ name: s.users.name, email: s.users.email, phone: s.users.phone }).from(s.users).where(eq(s.users.id, r.requestedBy)).limit(1);
      if (who) await notify(app, auth.tenantId, r.opportunityId, r.id, [who], `${label}: OP-${opp.code} — ${opp.contactName}`, `${label}: OP-${opp.code} (${opp.contactName}), versão ${r.version}, por ${auth.name}.${body.comment ? `\nComentário: ${body.comment}` : ''}\nVer: ${publicLink(app.config, `/opportunities/${opp.id}/aprovacao`)}`);
      return { ok: true, decision: body.decision };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/approvals',
    summary: 'Fila de aprovações: pendentes na minha alçada e meus pedidos',
    tag: 'Aprovações',
    anyAuthenticated: true,
    query: z.object({ status: z.enum(['pendentes', 'todas']).default('pendentes') }),
    handler: async ({ app, auth, query }) => {
      const myLevel = approvalLevelOf(auth);
      const rows = await app.db
        .select({ id: s.approvalRequests.id, oppId: s.approvalRequests.opportunityId, version: s.approvalRequests.version, requiredLevel: s.approvalRequests.requiredLevel, exceptional: s.approvalRequests.exceptional, proposedMonthlyCents: s.approvalRequests.proposedMonthlyCents, discountBp: s.approvalRequests.discountBp, negotiationType: s.approvalRequests.negotiationType, requestedBy: s.approvalRequests.requestedBy, createdAt: s.approvalRequests.createdAt, decision: s.approvalDecisions.decision, decidedAt: s.approvalDecisions.createdAt, code: s.opportunities.code, title: s.opportunities.title, contactName: s.contacts.name, requesterName: s.users.name, ownerId: s.opportunities.ownerId })
        .from(s.approvalRequests)
        .innerJoin(s.opportunities, eq(s.opportunities.id, s.approvalRequests.opportunityId))
        .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
        .innerJoin(s.users, eq(s.users.id, s.approvalRequests.requestedBy))
        .leftJoin(s.approvalDecisions, eq(s.approvalDecisions.requestId, s.approvalRequests.id))
        .where(and(eq(s.approvalRequests.tenantId, auth.tenantId), isNull(s.opportunities.deletedAt), query.status === 'pendentes' ? isNull(s.approvalDecisions.id) : sql`true`))
        .orderBy(desc(s.approvalRequests.createdAt))
        .limit(300);
      const items = rows
        .filter((r) => r.requestedBy === auth.userId || r.ownerId === auth.userId || canDecide(myLevel, r.requiredLevel as ApprovalLevel) || level(auth, 'oportunidades') === 'total')
        .filter((r) => r.decision !== 'substituida')
        .map((r) => ({ ...r, status: r.decision ?? 'pendente', canDecide: !r.decision && r.requestedBy !== auth.userId && canDecide(myLevel, r.requiredLevel as ApprovalLevel), requiredLabel: APPROVAL_LEVEL_LABELS[r.requiredLevel as ApprovalLevel], negotiationLabel: NEGOTIATION_TYPE_LABELS[r.negotiationType as keyof typeof NEGOTIATION_TYPE_LABELS] ?? r.negotiationType }));
      return { items, myLevel, myLevelLabel: APPROVAL_LEVEL_LABELS[myLevel], toDecide: items.filter((i) => i.canDecide).length };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/approval/identity',
    summary: 'Registra se um cadastro parecido é o mesmo cliente (entra na análise) ou outro (fica de fora)',
    tag: 'Aprovações',
    module: 'clientes',
    params: IdParams,
    body: z.object({ otherContactId: z.string().uuid(), decision: z.enum(['mesmo', 'diferente']), note: z.string().trim().max(500).nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      const { opp } = await loadForAnalysis(app.db, auth, params.id);
      if (body.otherContactId === opp.contactId) throw unprocessable('Escolha outro cadastro.');
      const [other] = await app.db.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.id, body.otherContactId), eq(s.contacts.tenantId, auth.tenantId))).limit(1);
      if (!other) throw notFound('Cadastro não encontrado.');
      await app.db.insert(s.contactIdentityLinks).values({ tenantId: auth.tenantId, contactId: opp.contactId, otherContactId: other.id, decision: body.decision, note: body.note, decidedBy: auth.userId });
      await audit(app.db, req, { action: 'customer.identity', entityType: 'contact', entityId: opp.contactId, metadata: { other: other.id, decision: body.decision } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/approval/attachments/:aid',
    summary: 'Baixa um documento da negociação a partir da tela de aprovação',
    tag: 'Aprovações',
    anyAuthenticated: true,
    params: z.object({ id: z.string().uuid(), aid: z.string().uuid() }),
    handler: async ({ app, auth, params, reply }) => {
      const { opp } = await loadForAnalysis(app.db, auth, params.id);
      const [a] = await app.db.select().from(s.opportunityAttachments).where(and(eq(s.opportunityAttachments.id, params.aid), eq(s.opportunityAttachments.opportunityId, opp.id), eq(s.opportunityAttachments.tenantId, auth.tenantId), isNull(s.opportunityAttachments.deletedAt))).limit(1);
      if (!a) throw notFound('Documento não encontrado.');
      reply.header('content-type', a.mime).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`).header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-store');
      return reply.send(a.data);
    },
  }),

  // ------------------------------------------------------------------ classificação estratégica
  defineRoute({
    method: 'GET',
    url: '/contacts/:id/classification',
    summary: 'Classificação estratégica do cliente (vigente e histórico) e opções',
    tag: 'Clientes',
    module: 'clientes',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await contactInScope(app.db, auth, params.id);
      const hist = await classificationHistory(app.db, auth.tenantId, params.id);
      return { current: hist[0] ?? null, history: hist, options: (await approvalSettingsOf(app.db, auth.tenantId)).classificationOptions };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contacts/:id/classification',
    summary: 'Registra nova classificação (a anterior fica no histórico)',
    tag: 'Clientes',
    module: 'clientes',
    min: 'equipe',
    params: IdParams,
    body: Classification,
    handler: async ({ app, auth, params, body, req, reply }) => {
      await contactInScope(app.db, auth, params.id);
      const opts = (await approvalSettingsOf(app.db, auth.tenantId)).classificationOptions;
      for (const k of CLASSIFICATION_DIMENSIONS) {
        const v = body[k];
        if (v && !opts[k].includes(v)) throw unprocessable(`Valor fora das opções cadastradas: ${v}.`, [{ path: k, message: 'Escolha uma opção da lista' }]);
      }
      // Classe Estratégica: definida e revisada pela liderança Comercial e pela Diretoria
      const [prevCls] = await app.db.select({ classKey: s.contactClassifications.classKey }).from(s.contactClassifications).where(and(eq(s.contactClassifications.tenantId, auth.tenantId), eq(s.contactClassifications.contactId, params.id))).orderBy(desc(s.contactClassifications.createdAt)).limit(1);
      if ((prevCls?.classKey ?? null) !== (body.classKey ?? null) && !(auth.sectors.includes('diretoria') || auth.sectors.includes('comercial') || auth.access.configuracoes === 'total')) throw forbidden('A Classe Estratégica é definida pela liderança Comercial ou pela Diretoria.');
      const [r] = await app.db.insert(s.contactClassifications).values({ tenantId: auth.tenantId, contactId: params.id, ...body, classifiedBy: auth.userId }).returning({ id: s.contactClassifications.id });
      await audit(app.db, req, { action: 'customer.classify', entityType: 'contact', entityId: params.id, metadata: { ...body } });
      reply.code(201);
      return { id: r!.id };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contacts/:id/classification/request-update',
    summary: 'Cria tarefa para atualizar a classificação do cliente',
    tag: 'Clientes',
    anyAuthenticated: true,
    params: IdParams,
    body: z.object({ opportunityId: z.string().uuid().optional(), note: z.string().trim().max(500).default('') }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const [c] = await app.db.select({ id: s.contacts.id, name: s.contacts.name, ownerId: s.contacts.ownerId }).from(s.contacts).where(and(eq(s.contacts.id, params.id), eq(s.contacts.tenantId, auth.tenantId))).limit(1);
      if (!c) throw notFound('Cliente não encontrado.');
      if (body.opportunityId) await loadForAnalysis(app.db, auth, body.opportunityId);
      else await contactInScope(app.db, auth, params.id);
      // responsável: dono da carteira; senão alguém de Inteligência Comercial; senão quem pediu
      const intel = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), sql`'inteligencia_comercial' = any(${s.users.sectors})`)).limit(1);
      const ownerId = c.ownerId ?? intel[0]?.id ?? auth.userId;
      const due = new Date(Date.now() + 2 * 86_400_000);
      const [a] = await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type: 'tarefa', title: `Atualizar classificação estratégica: ${c.name}`, notes: `Pedido por ${auth.name} na análise de aprovação.${body.note ? ` ${body.note}` : ''}`, dueAt: due, priority: 'alta', ownerId, contactId: c.id, opportunityId: body.opportunityId ?? null, createdBy: auth.userId }).returning({ id: s.activities.id });
      await audit(app.db, req, { action: 'customer.classification_requested', entityType: 'contact', entityId: c.id, metadata: { activityId: a!.id } });
      reply.code(201);
      return { activityId: a!.id };
    },
  }),

  // ------------------------------------------------------------------ configurações
  defineRoute({
    method: 'GET',
    url: '/admin/approval-settings',
    summary: 'Alçadas de desconto, opções da classificação e aviso de aprovação',
    tag: 'Aprovações',
    module: 'configuracoes',
    min: 'total',
    handler: async ({ app, auth }) => approvalSettingsOf(app.db, auth.tenantId),
  }),
  defineRoute({
    method: 'PUT',
    url: '/admin/approval-settings',
    summary: 'Salva alçadas, opções da classificação e aviso de aprovação',
    tag: 'Aprovações',
    module: 'configuracoes',
    min: 'total',
    body: z.object({
      policy: z.object({ limits: z.array(z.object({ level: z.enum(APPROVAL_LEVELS), maxDiscountBp: z.number().int().min(0).max(10_000), minMarginBp: z.number().int().min(-10_000).max(10_000).nullable() })).length(4) }),
      classificationOptions: z.object(Object.fromEntries(CLASSIFICATION_DIMENSIONS.map((k) => [k, z.array(z.string().trim().min(1).max(80)).max(30)])) as Record<(typeof CLASSIFICATION_DIMENSIONS)[number], z.ZodArray<z.ZodString>>),
      notifyEmail: z.boolean(),
      notifyWhatsapp: z.boolean(),
      notifyShowClass: z.boolean(),
      template: z.string().trim().min(10).max(2000),
    }),
    handler: async ({ app, auth, body, req }) => {
      const lims = APPROVAL_LEVELS.map((l) => body.policy.limits.find((x) => x.level === l));
      if (lims.some((x) => !x)) throw unprocessable('Informe as quatro alçadas.');
      for (let i = 1; i < lims.length; i++) if (lims[i]!.maxDiscountBp < lims[i - 1]!.maxDiscountBp) throw unprocessable(`O limite de ${APPROVAL_LEVEL_LABELS[lims[i]!.level]} não pode ser menor que o de ${APPROVAL_LEVEL_LABELS[lims[i - 1]!.level]}.`, [{ path: `policy.${lims[i]!.level}`, message: 'Limite menor que a alçada anterior' }]);
      if (/\{\{\s*(total_pago|contratos|margem|inadimplencia)\s*\}\}/.test(body.template)) throw unprocessable('O aviso só pode levar o resumo seguro: dados financeiros e contratos ficam na página autenticada.');
      const values = { policy: { limits: lims as { level: string; maxDiscountBp: number; minMarginBp: number | null }[] }, classificationOptions: body.classificationOptions, notifyEmail: body.notifyEmail, notifyWhatsapp: body.notifyWhatsapp, notifyShowClass: body.notifyShowClass, template: body.template, updatedBy: auth.userId, updatedAt: new Date() };
      await app.db.insert(s.approvalSettings).values({ tenantId: auth.tenantId, ...values }).onConflictDoUpdate({ target: s.approvalSettings.tenantId, set: values });
      await audit(app.db, req, { action: 'approval.settings', entityType: 'tenant', entityId: auth.tenantId, metadata: { limits: lims } });
      return approvalSettingsOf(app.db, auth.tenantId);
    },
  }),
];

/** Mesmo filtro da ficha do cliente (nível do módulo Clientes). */
async function contactInScope(db: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await db.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.id, id), ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt }))).limit(1);
  if (!c) throw notFound('Cliente não encontrado.');
}
