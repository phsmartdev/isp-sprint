/** Base de clientes: modelo de planilha, importação com prévia e limpeza da base (gerência + senha). */
import { customerFieldList } from '../services/customFields';
import { or, and, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { verifyPassword } from '../auth/password';
import { audit } from '../services/audit';
import { applyImport, customColumns, importTemplate, IMPORT_COLUMNS, validateImport } from '../services/customerImport';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
export const CLEAR_SCOPES = ['clientes', 'comercial'] as const;
const CONFIRM = 'LIMPAR BASE';

export const dataAdminRoutes = [
  defineRoute({
    method: 'GET',
    url: '/admin/customers/template',
    summary: 'Modelo de planilha (CSV para Excel) com os campos do CRM para preencher a base de clientes',
    tag: 'Base de dados',
    ...ADMIN,
    handler: async ({ app, auth, reply }) =>
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="modelo-clientes-isp-sprint.csv"').send(importTemplate(await customerFieldList(app.db, auth.tenantId))),
  }),
  defineRoute({
    method: 'GET',
    url: '/admin/customers/template/columns',
    summary: 'Explicação de cada coluna do modelo',
    tag: 'Base de dados',
    ...ADMIN,
    handler: async ({ app, auth }) => ({ columns: [...IMPORT_COLUMNS.map(([key, hint, example]) => ({ key, hint, example })), ...customColumns(await customerFieldList(app.db, auth.tenantId))] }),
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/customers/import',
    summary: 'Importa clientes da planilha. dryRun=true só valida e mostra a prévia.',
    tag: 'Base de dados',
    ...ADMIN,
    bodyLimit: 15_000_000,
    body: z.object({ csv: z.string().min(1).max(14_000_000), dryRun: z.boolean().default(true) }),
    handler: async ({ app, auth, body, req }) => {
      const v = await validateImport(app.db, auth.tenantId, body.csv);
      const preview = { total: v.total, valid: v.rows.length, errors: v.errors.slice(0, 200), errorCount: v.errors.length };
      if (body.dryRun || !v.rows.length) return { ...preview, imported: null };
      const r = await app.db.transaction((tx) => applyImport(tx, auth.tenantId, auth.userId, v.rows));
      await audit(app.db, req, { action: 'customers.import', entityType: 'customers', entityId: auth.tenantId, metadata: { ...r, skipped: v.errors.length } });
      return { ...preview, imported: r };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/clear-base',
    summary: 'Limpa a base (clientes e/ou comercial). Só gerência, com a própria senha e a frase de confirmação.',
    tag: 'Base de dados',
    ...ADMIN,
    rateLimit: () => ({ max: 5, timeWindow: '10 minutes' }),
    body: z.object({ password: z.string().min(1).max(200), confirm: z.string(), scopes: z.array(z.enum(CLEAR_SCOPES)).min(1) }),
    handler: async ({ app, auth, body, req }) => {
      if (!auth.profiles.includes('gerencia')) throw forbidden('Só a gerência pode limpar a base.');
      if (body.confirm.trim().toUpperCase() !== CONFIRM) throw unprocessable(`Digite exatamente "${CONFIRM}" para confirmar.`, [{ path: 'confirm', message: 'Frase de confirmação incorreta' }]);
      const [u] = await app.db.select({ hash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, auth.userId)).limit(1);
      if (!u || !(await verifyPassword(body.password, u.hash))) {
        await audit(app.db, req, { action: 'base.clear_denied', entityType: 'tenant', entityId: auth.tenantId, metadata: { scopes: body.scopes } });
        throw unprocessable('Senha incorreta.', [{ path: 'password', message: 'Senha incorreta' }]);
      }
      const t = auth.tenantId;
      const counts: Record<string, number> = {};
      await app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('isp.allow_purge', 'on', true)`);
        const del = async (name: string, q: Promise<unknown[]>) => { counts[name] = (await q).length; };
        if (body.scopes.includes('comercial') || body.scopes.includes('clientes')) {
          // contratos dependem de oportunidades e clientes: saem junto, com todo o histórico deles
          const ctrs = tx.select({ id: s.contracts.id }).from(s.contracts).where(eq(s.contracts.tenantId, t));
          // Sucesso do Cliente (depende de contatos, contratos, oportunidades e atividades)
          for (const tbl of [s.csFiles, s.csVisits, s.csMilestones, s.csPresentations, s.csJourneys, s.csAlerts, s.csActionPlans, s.csSurveys, s.csAssessments, s.csAccounts]) await tx.delete(tbl).where(eq(tbl.tenantId, t));
          // atas de registro de preços (dependem de oportunidades, contratos e contatos)
          for (const tbl of [s.arpLedger, s.arpOpportunityLines, s.arpAllocations, s.arpItemChanges, s.arpDocuments, s.arpEvents, s.arpOperations, s.arpAdhesions, s.arpItems, s.arpAgencies]) await tx.delete(tbl).where(eq(tbl.tenantId, t));
          counts.atas = (await tx.delete(s.arps).where(eq(s.arps.tenantId, t)).returning({ id: s.arps.id })).length;
          await tx.delete(s.contractAlerts).where(eq(s.contractAlerts.tenantId, t));
          await tx.delete(s.contractLedger).where(eq(s.contractLedger.tenantId, t));
          await tx.delete(s.contractSignatures).where(eq(s.contractSignatures.tenantId, t));
          await tx.delete(s.contractDocuments).where(eq(s.contractDocuments.tenantId, t));
          await tx.delete(s.contractProcesses).where(eq(s.contractProcesses.tenantId, t));
          await tx.delete(s.contractEvents).where(eq(s.contractEvents.tenantId, t));
          await tx.delete(s.contractVersions).where(eq(s.contractVersions.tenantId, t));
          await tx.delete(s.emailMessages).where(and(eq(s.emailMessages.tenantId, t), inArray(s.emailMessages.contractId, ctrs)));
          await tx.update(s.activities).set({ contractId: null }).where(eq(s.activities.tenantId, t));
          await del('contratos', tx.delete(s.contracts).where(eq(s.contracts.tenantId, t)).returning({ id: s.contracts.id }));
        }
        if (body.scopes.includes('comercial')) {
          const opps = tx.select({ id: s.opportunities.id }).from(s.opportunities).where(eq(s.opportunities.tenantId, t));
          const acts = tx.select({ id: s.activities.id }).from(s.activities).where(eq(s.activities.tenantId, t));
          await del('historico_atividades', tx.delete(s.activityEvents).where(inArray(s.activityEvents.activityId, acts)).returning({ id: s.activityEvents.id }));
          await del('atividades', tx.delete(s.activities).where(eq(s.activities.tenantId, t)).returning({ id: s.activities.id }));
          // projetos: as tarefas já saíram; marcos, etapas, equipe, modelos e histórico saem junto
          for (const tbl of [s.projectEvents, s.projectMilestones, s.projectStages, s.projectMembers]) await tx.delete(tbl).where(eq(tbl.tenantId, t));
          counts.projetos = (await tx.delete(s.projects).where(eq(s.projects.tenantId, t)).returning({ id: s.projects.id })).length;
          await tx.delete(s.automationRuns).where(eq(s.automationRuns.tenantId, t));
          await tx.delete(s.emailMessages).where(and(eq(s.emailMessages.tenantId, t), inArray(s.emailMessages.opportunityId, opps)));
          await tx.delete(s.negotiationReads).where(eq(s.negotiationReads.tenantId, t));
          await tx.delete(s.negotiationMessages).where(eq(s.negotiationMessages.tenantId, t));
          await tx.delete(s.approvalDecisions).where(eq(s.approvalDecisions.tenantId, t));
          await tx.delete(s.approvalRequests).where(eq(s.approvalRequests.tenantId, t));
          await tx.delete(s.opportunityAnswers).where(inArray(s.opportunityAnswers.opportunityId, opps));
          await tx.delete(s.opportunityAttachments).where(inArray(s.opportunityAttachments.opportunityId, opps));
          await del('historico_oportunidades', tx.delete(s.opportunityEvents).where(eq(s.opportunityEvents.tenantId, t)).returning({ id: s.opportunityEvents.id }));
          await del('oportunidades', tx.delete(s.opportunities).where(eq(s.opportunities.tenantId, t)).returning({ id: s.opportunities.id }));
          await tx.update(s.integrationEvents).set({ leadId: null }).where(eq(s.integrationEvents.tenantId, t));
          await del('leads', tx.delete(s.leads).where(eq(s.leads.tenantId, t)).returning({ id: s.leads.id }));
        }
        if (body.scopes.includes('clientes')) {
          // oportunidades que sobrarem deixam de apontar para o cliente apagado
          await tx.update(s.opportunities).set({ customerId: null }).where(eq(s.opportunities.tenantId, t));
          const custs = tx.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.tenantId, t));
          await tx.delete(s.addresses).where(and(eq(s.addresses.tenantId, t), inArray(s.addresses.customerId, custs)));
          await tx.delete(s.customerExternalIds).where(eq(s.customerExternalIds.tenantId, t));
          await tx.delete(s.contactIdentityLinks).where(eq(s.contactIdentityLinks.tenantId, t));
          await tx.delete(s.contactClassifications).where(eq(s.contactClassifications.tenantId, t));
          await del('clientes', tx.delete(s.customers).where(eq(s.customers.tenantId, t)).returning({ id: s.customers.id }));
        }
        // contatos que não estão mais em lead, oportunidade, cliente ou atividade
        const used = (tbl: typeof s.leads | typeof s.opportunities | typeof s.customers | typeof s.activities) => tx.select({ x: sql`1` }).from(tbl).where(eq((tbl as typeof s.leads).contactId, s.contacts.id));
        await tx.delete(s.addresses).where(and(eq(s.addresses.tenantId, t), isNull(s.addresses.customerId), notExists(tx.select({ x: sql`1` }).from(s.leads).where(eq(s.leads.contactId, s.addresses.contactId)))));
        await del('contatos', tx.delete(s.contacts).where(and(eq(s.contacts.tenantId, t), notExists(used(s.leads)), notExists(used(s.opportunities)), notExists(used(s.customers)), notExists(used(s.activities)), notExists(tx.select({ x: sql`1` }).from(s.contactClassifications).where(eq(s.contactClassifications.contactId, s.contacts.id))), notExists(tx.select({ x: sql`1` }).from(s.contactIdentityLinks).where(or(eq(s.contactIdentityLinks.contactId, s.contacts.id), eq(s.contactIdentityLinks.otherContactId, s.contacts.id)))), notExists(tx.select({ x: sql`1` }).from(s.addresses).where(eq(s.addresses.contactId, s.contacts.id))))).returning({ id: s.contacts.id }));
      });
      await audit(app.db, req, { action: 'base.clear', entityType: 'tenant', entityId: t, metadata: { scopes: body.scopes, counts } });
      return { ok: true, counts };
    },
  }),
];
