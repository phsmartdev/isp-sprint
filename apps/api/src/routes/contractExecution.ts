/**
 * Execução do contrato (fase 5): SLA contratado × realizado, ocorrências e penalidades, fiscal e gestor do órgão,
 * cláusulas críticas e atestados de capacidade técnica. Tudo só INSERT; mudar substitui e guarda o anterior.
 */
import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  CERT_STATUS, CERT_STATUS_LABELS, CLAUSE_KINDS, CLAUSE_LABELS, OCCURRENCE_KINDS, OCCURRENCE_LABELS, OCCURRENCE_OPEN, OCCURRENCE_STATUS, OCCURRENCE_STATUS_LABELS,
  PARTY_ROLES, PARTY_ROLE_LABELS, PENALTY_KINDS, SLA_DEFAULTS, SLA_METRICS, SLA_METRIC_LABELS, certificateDue, slaStatus, type OccurrenceKind, type OccurrenceStatus, type SlaMetric,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { brl } from '../services/email';
import { addEvent, contractScope, currentVersion, hasSector, isAdmin, loadContract } from '../services/contracts';
import { level } from '../services/scope';
import { todayLocal } from '../services/projects';
import { detectAttachment } from './sprint';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const canManage = (auth: AuthContext) => isAdmin(auth) || level(auth, 'contratos') === 'total' || hasSector(auth, ['administracao', 'inteligencia_comercial', 'juridico', 'diretoria']);
/** Quem cuida do dia a dia do contrato também registra ocorrência, medição de SLA e atestado. */
const canOperate = (auth: AuthContext, c: { commercialOwnerId: string | null; operationalOwnerId: string | null; csmId: string | null }) =>
  canManage(auth) || hasSector(auth, ['sucesso_cliente', 'implantacao', 'financeiro']) || [c.commercialOwnerId, c.operationalOwnerId, c.csmId].includes(auth.userId);
const SubParams = z.object({ id: z.string().uuid(), sub: z.string().uuid() });

export const contractExecutionRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/:id/execution', summary: 'Execução do contrato: SLA contratado × realizado, ocorrências e penalidades, fiscal/gestor, cláusulas críticas e atestados', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const today = todayLocal(auth);
      const slas = await app.db.select().from(s.contractSlas).where(and(eq(s.contractSlas.contractId, c.id), isNull(s.contractSlas.supersededAt))).orderBy(s.contractSlas.createdAt);
      const meas = slas.length ? await app.db.select().from(s.contractSlaMeasurements).where(and(inArray(s.contractSlaMeasurements.slaId, slas.map((x) => x.id)), isNull(s.contractSlaMeasurements.supersededAt))).orderBy(desc(s.contractSlaMeasurements.period)) : [];
      const occ = await app.db.select({ o: s.contractOccurrences, owner: s.users.name }).from(s.contractOccurrences).leftJoin(s.users, eq(s.users.id, s.contractOccurrences.ownerId)).where(eq(s.contractOccurrences.contractId, c.id)).orderBy(desc(s.contractOccurrences.occurredOn));
      const upd = occ.length ? await app.db.select({ u: s.contractOccurrenceUpdates, by: s.users.name }).from(s.contractOccurrenceUpdates).leftJoin(s.users, eq(s.users.id, s.contractOccurrenceUpdates.createdBy)).where(inArray(s.contractOccurrenceUpdates.occurrenceId, occ.map((x) => x.o.id))).orderBy(s.contractOccurrenceUpdates.createdAt) : [];
      const parties = await app.db.select().from(s.contractParties).where(eq(s.contractParties.contractId, c.id)).orderBy(desc(s.contractParties.createdAt));
      const clauses = await app.db.select().from(s.contractClauses).where(and(eq(s.contractClauses.contractId, c.id), isNull(s.contractClauses.supersededAt))).orderBy(s.contractClauses.deadline);
      const certs = await app.db.select({ id: s.technicalCertificates.id, status: s.technicalCertificates.status, issuer: s.technicalCertificates.issuer, issuedOn: s.technicalCertificates.issuedOn, services: s.technicalCertificates.services, quantities: s.technicalCertificates.quantities, note: s.technicalCertificates.note, filename: s.technicalCertificates.filename, size: s.technicalCertificates.size, createdAt: s.technicalCertificates.createdAt, supersededAt: s.technicalCertificates.supersededAt, by: s.users.name })
        .from(s.technicalCertificates).leftJoin(s.users, eq(s.users.id, s.technicalCertificates.createdBy)).where(eq(s.technicalCertificates.contractId, c.id)).orderBy(desc(s.technicalCertificates.createdAt));
      const v = await currentVersion(app.db, c);
      const occurrences = occ.map(({ o, owner }) => {
        const ups = upd.filter((x) => x.u.occurrenceId === o.id);
        const last = ups[ups.length - 1]?.u;
        const status = (last?.status ?? 'aberta') as OccurrenceStatus;
        const amount = [...ups].reverse().find((x) => x.u.amountCents !== null)?.u.amountCents ?? o.amountCents;
        return { ...o, ownerName: owner, kindLabel: OCCURRENCE_LABELS[o.kind as OccurrenceKind] ?? o.kind, status, statusLabel: OCCURRENCE_STATUS_LABELS[status], amountCents: amount, open: OCCURRENCE_OPEN.includes(status), updates: ups.map((x) => ({ ...x.u, by: x.by })) };
      });
      const activeCert = certs.find((x) => !x.supersededAt) ?? null;
      return {
        slas: slas.map((x) => {
          const ms = meas.filter((m) => m.slaId === x.id).slice(0, 12);
          return { ...x, metricLabel: SLA_METRIC_LABELS[x.metric as SlaMetric] ?? x.metric, measurements: ms.map((m) => ({ ...m, status: slaStatus(x.direction as 'maior' | 'menor', x.target, m.value) })), last: ms[0] ? { period: ms[0].period, value: ms[0].value, status: slaStatus(x.direction as 'maior' | 'menor', x.target, ms[0].value) } : null };
        }),
        occurrences,
        parties: { current: PARTY_ROLES.map((r) => ({ role: r, label: PARTY_ROLE_LABELS[r], person: parties.find((p) => p.role === r && !p.supersededAt) ?? null, history: parties.filter((p) => p.role === r && p.supersededAt).length })) },
        clauses: clauses.map((x) => ({ ...x, kindLabel: CLAUSE_LABELS[x.kind as keyof typeof CLAUSE_LABELS] ?? x.kind, daysLeft: x.deadline ? Math.round((Date.parse(x.deadline) - Date.parse(today)) / 86_400_000) : null })),
        certificates: certs.map((x) => ({ ...x, statusLabel: CERT_STATUS_LABELS[x.status as keyof typeof CERT_STATUS_LABELS] ?? x.status })),
        certificateDue: certificateDue({ startAt: v.startAt, endAt: v.endAt, hasReceived: certs.some((x) => x.status === 'recebido'), hasRequested: activeCert?.status === 'solicitado' }, today),
        summary: {
          penaltiesCents: occurrences.filter((o) => PENALTY_KINDS.includes(o.kind as OccurrenceKind) && o.status !== 'revertida').reduce((t, o) => t + (o.amountCents ?? 0), 0),
          openOccurrences: occurrences.filter((o) => o.open).length,
          slaViolations: meas.filter((m) => { const x = slas.find((y) => y.id === m.slaId)!; return slaStatus(x.direction as 'maior' | 'menor', x.target, m.value) === 'violado'; }).length,
        },
        canManage: canManage(auth), canOperate: canOperate(auth, c),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/slas', summary: 'Cadastra (ou substitui) uma meta de SLA do contrato', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ metric: z.enum(SLA_METRICS), label: z.string().trim().max(80).optional(), target: z.number().finite(), unit: z.string().trim().max(10).optional(), direction: z.enum(['maior', 'menor']).optional(), penaltyNote: z.string().trim().max(500).nullable().optional(), replaces: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canManage(auth)) throw forbidden('O SLA contratado é cadastrado pela gestão de contratos, Inteligência Comercial, Jurídico ou Diretoria.');
      const d = SLA_DEFAULTS[body.metric];
      const id = await app.db.transaction(async (tx) => {
        if (body.replaces) await tx.update(s.contractSlas).set({ supersededAt: new Date() }).where(and(eq(s.contractSlas.id, body.replaces), eq(s.contractSlas.contractId, c.id)));
        const [r] = await tx.insert(s.contractSlas).values({ tenantId: auth.tenantId, contractId: c.id, metric: body.metric, label: body.label || SLA_METRIC_LABELS[body.metric], target: body.target, unit: body.unit ?? d.unit, direction: body.direction ?? d.direction, penaltyNote: body.penaltyNote ?? null, createdBy: auth.userId }).returning({ id: s.contractSlas.id });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'sla', `SLA ${body.replaces ? 'alterado' : 'cadastrado'}: ${body.label || SLA_METRIC_LABELS[body.metric]} ${(body.direction ?? d.direction) === 'maior' ? '≥' : '≤'} ${body.target}${body.unit ?? d.unit}.`, { slaId: r!.id });
        return r!.id;
      });
      await audit(app.db, req, { action: 'contract.sla', entityType: 'contract', entityId: c.id, metadata: { metric: body.metric, target: body.target } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/slas/:sub/measurements', summary: 'Registra o SLA realizado no mês (corrigir substitui o valor do mesmo mês)', tag: 'Contratos', module: 'contratos', params: SubParams,
    body: z.object({ period: month, value: z.number().finite(), note: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canOperate(auth, c)) throw forbidden();
      const [sla] = await app.db.select().from(s.contractSlas).where(and(eq(s.contractSlas.id, params.sub), eq(s.contractSlas.contractId, c.id))).limit(1);
      if (!sla) throw notFound('SLA não encontrado.');
      if (`${body.period}-01` > todayLocal(auth)) throw unprocessable('O mês ainda não começou.');
      const st = slaStatus(sla.direction as 'maior' | 'menor', sla.target, body.value);
      await app.db.transaction(async (tx) => {
        await tx.update(s.contractSlaMeasurements).set({ supersededAt: new Date() }).where(and(eq(s.contractSlaMeasurements.slaId, sla.id), eq(s.contractSlaMeasurements.period, body.period), isNull(s.contractSlaMeasurements.supersededAt)));
        await tx.insert(s.contractSlaMeasurements).values({ tenantId: auth.tenantId, contractId: c.id, slaId: sla.id, period: body.period, value: body.value, note: body.note ?? null, createdBy: auth.userId });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'sla_medicao', `SLA ${sla.label} em ${body.period}: ${body.value}${sla.unit} (meta ${sla.direction === 'maior' ? '≥' : '≤'} ${sla.target}${sla.unit}) — ${st === 'cumprido' ? 'cumprido' : 'VIOLADO'}.`, { slaId: sla.id, period: body.period, status: st });
      });
      await audit(app.db, req, { action: 'contract.sla.measure', entityType: 'contract', entityId: c.id, metadata: { slaId: sla.id, period: body.period, value: body.value } });
      reply.code(201);
      return { status: st };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/occurrences', summary: 'Registra ocorrência ou penalidade (falha, notificação do órgão, advertência, multa, glosa...)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ kind: z.enum(OCCURRENCE_KINDS), occurredOn: day, title: z.string().trim().min(3).max(160), description: z.string().trim().max(3000).nullable().optional(), amountCents: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(), responseDueAt: day.nullable().optional(), reference: z.string().trim().max(120).nullable().optional(), ownerId: z.string().uuid().nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canOperate(auth, c)) throw forbidden();
      if (PENALTY_KINDS.includes(body.kind) && !body.amountCents) throw unprocessable('Informe o valor da multa ou da glosa.', [{ path: 'amountCents', message: 'Obrigatório' }]);
      const id = await app.db.transaction(async (tx) => {
        const [r] = await tx.insert(s.contractOccurrences).values({ tenantId: auth.tenantId, contractId: c.id, kind: body.kind, occurredOn: body.occurredOn, title: body.title, description: body.description ?? null, amountCents: body.amountCents ?? null, responseDueAt: body.responseDueAt ?? null, reference: body.reference ?? null, ownerId: body.ownerId ?? auth.userId, createdBy: auth.userId }).returning({ id: s.contractOccurrences.id });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'ocorrencia', `${OCCURRENCE_LABELS[body.kind]}: ${body.title}${body.amountCents ? ` (${brl(body.amountCents)})` : ''}${body.responseDueAt ? `; resposta até ${body.responseDueAt}` : ''}.`, { occurrenceId: r!.id, kind: body.kind });
        return r!.id;
      });
      await audit(app.db, req, { action: 'contract.occurrence', entityType: 'contract', entityId: c.id, metadata: { kind: body.kind, amountCents: body.amountCents ?? null } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/occurrences/:sub/updates', summary: 'Atualiza a situação da ocorrência (defesa enviada, penalidade aceita, revertida, encerrada)', tag: 'Contratos', module: 'contratos', params: SubParams,
    body: z.object({ status: z.enum(OCCURRENCE_STATUS), note: z.string().trim().min(3).max(2000), amountCents: z.number().int().min(0).max(1_000_000_000_000).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canOperate(auth, c)) throw forbidden();
      const [o] = await app.db.select().from(s.contractOccurrences).where(and(eq(s.contractOccurrences.id, params.sub), eq(s.contractOccurrences.contractId, c.id))).limit(1);
      if (!o) throw notFound('Ocorrência não encontrada.');
      await app.db.transaction(async (tx) => {
        await tx.insert(s.contractOccurrenceUpdates).values({ tenantId: auth.tenantId, occurrenceId: o.id, status: body.status, note: body.note, amountCents: body.amountCents ?? null, createdBy: auth.userId });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'ocorrencia', `${o.title}: ${OCCURRENCE_STATUS_LABELS[body.status]} — ${body.note}${body.amountCents !== undefined && body.amountCents !== null ? ` (valor ${brl(body.amountCents)})` : ''}.`, { occurrenceId: o.id, status: body.status });
      });
      await audit(app.db, req, { action: 'contract.occurrence.update', entityType: 'contract', entityId: c.id, metadata: { occurrenceId: o.id, status: body.status } });
      reply.code(201);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/parties', summary: 'Define o gestor, os fiscais do órgão ou o preposto (substitui quem estava no papel e guarda o histórico)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ role: z.enum(PARTY_ROLES), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200).nullable().optional(), phone: z.string().trim().max(30).nullable().optional(), appointment: z.string().trim().max(120).nullable().optional(), since: day.nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canOperate(auth, c)) throw forbidden();
      await app.db.transaction(async (tx) => {
        await tx.update(s.contractParties).set({ supersededAt: new Date() }).where(and(eq(s.contractParties.contractId, c.id), eq(s.contractParties.role, body.role), isNull(s.contractParties.supersededAt)));
        await tx.insert(s.contractParties).values({ tenantId: auth.tenantId, contractId: c.id, role: body.role, name: body.name, email: body.email ?? null, phone: body.phone ?? null, appointment: body.appointment ?? null, since: body.since ?? null, createdBy: auth.userId });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'fiscal', `${PARTY_ROLE_LABELS[body.role]}: ${body.name}${body.appointment ? ` (${body.appointment})` : ''}.`, { role: body.role });
      });
      await audit(app.db, req, { action: 'contract.party', entityType: 'contract', entityId: c.id, metadata: { role: body.role } });
      reply.code(201);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/clauses', summary: 'Registra cláusula crítica com prazo e aviso (ou substitui/retira uma)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ kind: z.enum(CLAUSE_KINDS), reference: z.string().trim().max(60).nullable().optional(), title: z.string().trim().min(3).max(160), excerpt: z.string().trim().max(3000).nullable().optional(), deadline: day.nullable().optional(), remindDays: z.number().int().min(0).max(365).default(15), replaces: z.string().uuid().optional(), remove: z.boolean().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canManage(auth)) throw forbidden('Cláusulas críticas são registradas pela gestão de contratos, Inteligência Comercial, Jurídico ou Diretoria.');
      await app.db.transaction(async (tx) => {
        if (body.replaces) await tx.update(s.contractClauses).set({ supersededAt: new Date() }).where(and(eq(s.contractClauses.id, body.replaces), eq(s.contractClauses.contractId, c.id)));
        if (body.remove) { await addEvent(tx, auth.tenantId, c.id, auth.userId, 'clausula', `Cláusula retirada do acompanhamento: ${body.title}.`, {}); return; }
        await tx.insert(s.contractClauses).values({ tenantId: auth.tenantId, contractId: c.id, kind: body.kind, reference: body.reference ?? null, title: body.title, excerpt: body.excerpt ?? null, deadline: body.deadline ?? null, remindDays: body.remindDays, createdBy: auth.userId });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'clausula', `Cláusula crítica${body.reference ? ` ${body.reference}` : ''}: ${body.title}${body.deadline ? `; prazo ${body.deadline}` : ''}.`, { kind: body.kind });
      });
      await audit(app.db, req, { action: 'contract.clause', entityType: 'contract', entityId: c.id, metadata: { kind: body.kind, remove: !!body.remove } });
      reply.code(201);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/certificates', summary: 'Atestado de capacidade técnica: pedido, recebimento (com o arquivo) ou recusa', tag: 'Contratos', module: 'contratos', params: IdParams, bodyLimit: 6_000_000,
    body: z.object({ status: z.enum(CERT_STATUS), issuer: z.string().trim().max(160).nullable().optional(), issuedOn: day.nullable().optional(), services: z.string().trim().max(2000).nullable().optional(), quantities: z.string().trim().max(1000).nullable().optional(), note: z.string().trim().max(1000).nullable().optional(), filename: z.string().trim().min(3).max(160).optional(), data: z.string().min(8).max(5_600_000).optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canOperate(auth, c)) throw forbidden();
      let file: { filename: string; mime: string; size: number; data: Buffer } | null = null;
      if (body.data && body.filename) {
        const data = Buffer.from(body.data, 'base64');
        if (data.length > 4_000_000) throw unprocessable('Arquivo acima de 4 MB.');
        const mime = detectAttachment(body.filename, data);
        if (!mime || !['application/pdf', 'image/png', 'image/jpeg'].includes(mime)) throw unprocessable('Envie o atestado em PDF, PNG ou JPG.');
        file = { filename: body.filename, mime, size: data.length, data };
      }
      if (body.status === 'recebido' && !file) throw unprocessable('Anexe o atestado recebido (PDF ou imagem).');
      const id = await app.db.transaction(async (tx) => {
        await tx.update(s.technicalCertificates).set({ supersededAt: new Date() }).where(and(eq(s.technicalCertificates.contractId, c.id), isNull(s.technicalCertificates.supersededAt), inArray(s.technicalCertificates.status, ['a_solicitar', 'solicitado'])));
        const [r] = await tx.insert(s.technicalCertificates).values({ tenantId: auth.tenantId, contractId: c.id, contactId: c.contactId, status: body.status, issuer: body.issuer ?? null, issuedOn: body.issuedOn ?? null, services: body.services ?? null, quantities: body.quantities ?? null, note: body.note ?? null, ...(file ?? {}), createdBy: auth.userId }).returning({ id: s.technicalCertificates.id });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'atestado', `Atestado de capacidade técnica: ${CERT_STATUS_LABELS[body.status]}${body.issuer ? ` (${body.issuer})` : ''}.`, { certificateId: r!.id });
        return r!.id;
      });
      await audit(app.db, req, { action: 'contract.certificate', entityType: 'contract', entityId: c.id, metadata: { status: body.status } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/certificates', summary: 'Acervo de atestados de capacidade técnica recebidos (para montar habilitação técnica em licitações)', tag: 'Contratos', module: 'contratos',
    query: z.object({ q: z.string().trim().max(100).optional() }),
    handler: async ({ app, auth, query }) => {
      const like = query.q ? `%${query.q}%` : null;
      const rows = await app.db.select({ id: s.technicalCertificates.id, issuer: s.technicalCertificates.issuer, issuedOn: s.technicalCertificates.issuedOn, services: s.technicalCertificates.services, quantities: s.technicalCertificates.quantities, filename: s.technicalCertificates.filename, size: s.technicalCertificates.size, contractId: s.technicalCertificates.contractId, client: s.contacts.name, number: s.contractVersions.number })
        .from(s.technicalCertificates)
        .innerJoin(s.contacts, eq(s.contacts.id, s.technicalCertificates.contactId))
        .leftJoin(s.contracts, eq(s.contracts.id, s.technicalCertificates.contractId))
        .leftJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion)))
        .where(and(eq(s.technicalCertificates.tenantId, auth.tenantId), eq(s.technicalCertificates.status, 'recebido'), isNull(s.technicalCertificates.supersededAt), contractScope(auth),
          like ? or(ilike(s.contacts.name, like), ilike(s.technicalCertificates.services, like), ilike(s.technicalCertificates.issuer, like)) : undefined))
        .orderBy(desc(s.technicalCertificates.issuedOn)).limit(300);
      return { items: rows };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/certificates/:id/download', summary: 'Baixa o arquivo do atestado', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [r] = await app.db.select().from(s.technicalCertificates).where(and(eq(s.technicalCertificates.id, params.id), eq(s.technicalCertificates.tenantId, auth.tenantId))).limit(1);
      if (!r || !r.data) throw notFound('Arquivo não encontrado.');
      if (r.contractId) await loadContract(app.db, auth, r.contractId);
      reply.header('content-type', r.mime ?? 'application/octet-stream').header('content-disposition', `attachment; filename="${encodeURIComponent(r.filename ?? 'atestado')}"`);
      return reply.send(r.data);
    },
  }),
];
