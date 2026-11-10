/** Base de clientes: modelo de planilha, importação com prévia e limpeza da base (gerência + senha). */
import { loadMeasurementExample } from '../services/measurementExample';
import { todayIn } from '../services/vacations';
import { customerFieldList } from '../services/customFields';
import { or, and, eq, inArray, isNull, notExists, notInArray, sql } from 'drizzle-orm';
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
    method: 'POST', url: '/admin/demo/measurement-example', summary: 'Carrega o exemplo fictício do Relatório de Medição: 1 contrato por medição com 6 medições pelas oportunidades (sai com Limpar base)', tag: 'Base de dados', ...ADMIN,
    handler: async ({ app, auth, req }) => {
      if (!auth.profiles.some((p) => ['gerencia', 'diretoria', 'administrador'].includes(p))) throw forbidden('Só a administração ou a gerência carrega exemplos.');
      const r = await loadMeasurementExample(app.db, auth.tenantId, auth.userId, todayIn(auth.timezone));
      await audit(app.db, req, { action: 'base.measurement_example', entityType: 'contact', entityId: r.contactId, metadata: { created: r.created } });
      return r;
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/clear-base',
    summary: 'Limpa a base (clientes e/ou comercial). Só gerência, com a própria senha e a frase de confirmação.',
    tag: 'Base de dados',
    ...ADMIN,
    rateLimit: () => ({ max: 5, timeWindow: '10 minutes' }),
    body: z.object({ password: z.string().min(1).max(200), confirm: z.string(), scopes: z.array(z.enum(CLEAR_SCOPES)).min(1), keep: z.object({ opportunityIds: z.array(z.string().uuid()).max(50).default([]), contractIds: z.array(z.string().uuid()).max(50).default([]) }).default({}) }),
    handler: async ({ app, auth, body, req }) => {
      if (!auth.profiles.some((p) => ['gerencia', 'diretoria', 'administrador'].includes(p))) throw forbidden('Só a administração ou a gerência pode limpar a base.');
      if (body.confirm.trim().toUpperCase() !== CONFIRM) throw unprocessable(`Digite exatamente "${CONFIRM}" para confirmar.`, [{ path: 'confirm', message: 'Frase de confirmação incorreta' }]);
      const [u] = await app.db.select({ hash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, auth.userId)).limit(1);
      if (!u || !(await verifyPassword(body.password, u.hash))) {
        await audit(app.db, req, { action: 'base.clear_denied', entityType: 'tenant', entityId: auth.tenantId, metadata: { scopes: body.scopes } });
        throw unprocessable('Senha incorreta.', [{ path: 'password', message: 'Senha incorreta' }]);
      }
      const t = auth.tenantId;
      const counts: Record<string, number> = {};
      // o que fica: oportunidades e contratos escolhidos, com os contratos/oportunidades ligados, o cliente, a conta e as atividades deles
      const kOpps = new Set(body.keep.opportunityIds), kCtrs = new Set(body.keep.contractIds);
      if (kOpps.size || kCtrs.size) {
        const cs = kCtrs.size ? await app.db.select({ id: s.contracts.id, opp: s.contracts.opportunityId }).from(s.contracts).where(and(eq(s.contracts.tenantId, t), inArray(s.contracts.id, [...kCtrs]))) : [];
        if (cs.length !== kCtrs.size) throw unprocessable('Contrato a manter não encontrado.');
        for (const c of cs) if (c.opp) kOpps.add(c.opp);
        const os = kOpps.size ? await app.db.select({ id: s.opportunities.id }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, t), inArray(s.opportunities.id, [...kOpps]))) : [];
        if (os.length !== kOpps.size) throw unprocessable('Oportunidade a manter não encontrada.');
        if (kOpps.size) for (const c of await app.db.select({ id: s.contracts.id }).from(s.contracts).where(and(eq(s.contracts.tenantId, t), inArray(s.contracts.opportunityId, [...kOpps])))) kCtrs.add(c.id);
      }
      const keepO = [...kOpps], keepC = [...kCtrs];
      const people = keepO.length || keepC.length ? await app.db.execute<{ contact_id: string | null; customer_id: string | null; arp_id: string | null }>(sql`
        select contact_id, customer_id, arp_id from opportunities where id = any(${sql.raw(`'{${keepO.join(',')}}'::uuid[]`)})
        union select contact_id, customer_id, arp_id from contracts where id = any(${sql.raw(`'{${keepC.join(',')}}'::uuid[]`)})`) : { rows: [] };
      const keepArps = [...new Set(people.rows.map((r) => r.arp_id).filter((x): x is string => !!x))];
      const keepContacts = [...new Set(people.rows.map((r) => r.contact_id).filter((x): x is string => !!x))];
      const keepCustomers = [...new Set(people.rows.map((r) => r.customer_id).filter((x): x is string => !!x))];
      const keepActs = keepO.length || keepC.length ? (await app.db.select({ id: s.activities.id }).from(s.activities).where(and(eq(s.activities.tenantId, t), or(keepO.length ? inArray(s.activities.opportunityId, keepO) : undefined, keepC.length ? inArray(s.activities.contractId, keepC) : undefined)))).map((r) => r.id) : [];
      // filtro de cada tabela: desta empresa e fora do que fica (linhas sem vínculo continuam saindo)
      const out = (col: unknown, ids: string[]) => (ids.length && col ? or(isNull(col as never), notInArray(col as never, ids)) : undefined);
      const sc = (tbl: object) => {
        const x = tbl as Record<string, unknown>;
        const own = tbl === s.contracts ? out(x.id, keepC) : tbl === s.opportunities ? out(x.id, keepO) : tbl === s.activities ? out(x.id, keepActs) : tbl === s.customers ? out(x.id, keepCustomers) : tbl === s.arps ? out(x.id, keepArps) : undefined;
        return and(eq(x.tenantId as never, t), own, out(x.contractId, keepC), out(x.opportunityId, keepO), out(x.activityId, keepActs), out(x.customerId, keepCustomers), out(x.contactId, keepContacts), out(x.arpId, keepArps));
      };
      await app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('isp.allow_purge', 'on', true)`);
        const del = async (name: string, q: Promise<unknown[]>) => { counts[name] = (await q).length; };
        if (body.scopes.includes('comercial') || body.scopes.includes('clientes')) {
          // contratos dependem de oportunidades e clientes: saem junto, com todo o histórico deles
          const ctrs = tx.select({ id: s.contracts.id }).from(s.contracts).where(sc(s.contracts));
          // e-mails ficam (são correspondência real); só perdem o vínculo com contas e oportunidades apagadas
          await tx.update(s.mailThreads).set({ contactId: null, opportunityId: null, contractId: null, linkSource: null }).where(sc(s.mailThreads));
          // brindes enviados às contas: o estoque baixado continua no histórico de movimentos (só perde o vínculo com o envio)
          await tx.update(s.giftMovements).set({ deliveryId: null }).where(sc(s.giftMovements));
          await tx.delete(s.giftDeliveries).where(sc(s.giftDeliveries));
          // ABM (depende de contatos)
          for (const tbl of [s.accountOccurrences, s.abmSignalEvents, s.abmSignals, s.abmCadenceTasks, s.abmCadences, s.surveyUpdates, s.surveyResponses, s.surveyInvites, s.abmPlayRunSteps, s.abmPlayRuns, s.stakeholderLinks, s.stakeholderRelations, s.accountRelations, s.structureMembers, s.structureContracts, s.influenceChangeRequests, s.stakeholderInfluenceHistory, s.stakeholderInfluence, s.stakeholderEvents, s.accountStakeholders, s.people, s.abmEvents, s.abmObjectives, s.abmAccounts, s.accountOrgUnits]) await tx.delete(tbl).where(sc(tbl));
          // Sucesso do Cliente (depende de contatos, contratos, oportunidades e atividades)
          for (const tbl of [s.csJourneyLinkEvents, s.csJourneyLinks, s.csMilestoneEvents, s.csFiles, s.csVisits, s.csMilestones, s.csPresentations, s.csJourneys, s.csAlerts, s.csActionPlans, s.csSurveys, s.csAssessments, s.csAccounts]) await tx.delete(tbl).where(sc(tbl));
          // atas de registro de preços (dependem de oportunidades, contratos e contatos)
          for (const tbl of [s.arpLedger, s.arpOpportunityLines, s.arpAllocations, s.arpItemChanges, s.arpDocuments, s.arpEvents, s.arpOperations, s.arpAdhesions, s.arpItems, s.arpAgencies]) await tx.delete(tbl).where(sc(tbl));
          counts.atas = (await tx.delete(s.arps).where(sc(s.arps)).returning({ id: s.arps.id })).length;
          await tx.delete(s.contractAlerts).where(sc(s.contractAlerts));
          await tx.delete(s.contractLedger).where(sc(s.contractLedger));
          // controle de empenhos (depende de contratos, oportunidades e NEs)
          for (const tbl of [s.contractOpportunityLines, s.contractAdjustmentRetros, s.contractLinePrices, s.contractMeasurementItems, s.contractMeasurements, s.contractAdjustments, s.contractCommitmentMoves, s.contractCommitmentItems, s.contractLineMoves]) await tx.delete(tbl).where(sc(tbl));
          await tx.delete(s.contractCommitments).where(sc(s.contractCommitments));
          for (const tbl of [s.contractSourceShares, s.contractRevenueSources, s.contractLines]) await tx.delete(tbl).where(sc(tbl));
          await tx.delete(s.contractAmendments).where(sc(s.contractAmendments));
          await tx.delete(s.contractYearValues).where(sc(s.contractYearValues));
          await tx.delete(s.contractSlaMeasurements).where(sc(s.contractSlaMeasurements));
          await tx.delete(s.contractSlas).where(sc(s.contractSlas));
          await tx.delete(s.contractOccurrenceUpdates).where(sc(s.contractOccurrenceUpdates));
          await tx.delete(s.contractOccurrences).where(sc(s.contractOccurrences));
          await tx.delete(s.contractParties).where(sc(s.contractParties));
          await tx.delete(s.contractClauses).where(sc(s.contractClauses));
          await tx.delete(s.technicalCertificates).where(sc(s.technicalCertificates));
          await tx.delete(s.contractDigests).where(sc(s.contractDigests));
          await tx.delete(s.contractNotifications).where(sc(s.contractNotifications));
          await tx.delete(s.commRunSteps).where(sc(s.commRunSteps));
          await tx.delete(s.commRuns).where(sc(s.commRuns));
          await tx.delete(s.contractErpEvents).where(sc(s.contractErpEvents));
          await tx.delete(s.contractErpRecords).where(sc(s.contractErpRecords));
          await tx.delete(s.contractSignatures).where(sc(s.contractSignatures));
          await tx.delete(s.contractDocuments).where(sc(s.contractDocuments));
          await tx.delete(s.contractProcesses).where(sc(s.contractProcesses));
          await tx.delete(s.contractEvents).where(sc(s.contractEvents));
          await tx.delete(s.contractVersions).where(sc(s.contractVersions));
          await tx.delete(s.emailOpens).where(inArray(s.emailOpens.emailMessageId, tx.select({ id: s.emailMessages.id }).from(s.emailMessages).where(and(eq(s.emailMessages.tenantId, t), inArray(s.emailMessages.contractId, ctrs)))));
          await tx.delete(s.emailMessages).where(and(eq(s.emailMessages.tenantId, t), inArray(s.emailMessages.contractId, ctrs)));
          await tx.update(s.activities).set({ contractId: null }).where(sc(s.activities));
          await del('contratos', tx.delete(s.contracts).where(sc(s.contracts)).returning({ id: s.contracts.id }));
        }
        if (body.scopes.includes('comercial')) {
          const opps = tx.select({ id: s.opportunities.id }).from(s.opportunities).where(sc(s.opportunities));
          const acts = tx.select({ id: s.activities.id }).from(s.activities).where(sc(s.activities));
          // eventos de negócio derivados do que está sendo apagado (o projetor recria o que restar)
          for (const tbl of [s.businessEventReviews, s.businessEventCredits]) await tx.delete(tbl).where(sc(tbl));
          await tx.delete(s.businessEvents).where(sc(s.businessEvents));
          await tx.delete(s.businessEventSync).where(sc(s.businessEventSync));
          for (const tbl of [s.activityDependencies, s.activityComments, s.activityTimeEntries, s.workFiles]) await tx.delete(tbl).where(sc(tbl));
          await tx.delete(s.activityReads).where(inArray(s.activityReads.activityId, acts));
          // ações 5W2H das intervenções são as próprias tarefas: saem junto (a intervenção e o histórico dela ficam)
          await tx.delete(s.interventionActions).where(sc(s.interventionActions));
          // reuniões dos rituais e decisões só apontam para a atividade: perdem o vínculo, o registro de gestão fica
          await tx.update(s.ritualMeetings).set({ activityId: null }).where(sc(s.ritualMeetings));
          await tx.update(s.decisions).set({ followUpTaskId: null }).where(sc(s.decisions));
          // impedimentos são registro dos rituais: ficam, só perdem o vínculo com o projeto apagado
          await tx.update(s.impediments).set({ projectId: null, milestoneId: null, taskId: null }).where(sc(s.impediments));
          await tx.delete(s.contractNotifications).where(and(eq(s.contractNotifications.tenantId, t), inArray(s.contractNotifications.activityId, acts)));
          await del('historico_atividades', tx.delete(s.activityEvents).where(inArray(s.activityEvents.activityId, acts)).returning({ id: s.activityEvents.id }));
          await del('atividades', tx.delete(s.activities).where(sc(s.activities)).returning({ id: s.activities.id }));
          // projetos: as tarefas já saíram; marcos, etapas, equipe, modelos e histórico saem junto
          for (const tbl of [s.milestoneHomologations, s.projectRisks]) await tx.delete(tbl).where(sc(tbl));
          for (const tbl of [s.projectEvents, s.projectMilestones, s.projectStages, s.projectMembers]) await tx.delete(tbl).where(sc(tbl));
          counts.projetos = (await tx.delete(s.projects).where(sc(s.projects)).returning({ id: s.projects.id })).length;
          await tx.delete(s.automationRuns).where(sc(s.automationRuns));
          await tx.delete(s.automationQueue).where(and(eq(s.automationQueue.tenantId, t), inArray(s.automationQueue.opportunityId, opps)));
          await tx.delete(s.proposalDrafts).where(and(eq(s.proposalDrafts.tenantId, t), inArray(s.proposalDrafts.opportunityId, opps)));
          await tx.delete(s.emailOpens).where(inArray(s.emailOpens.emailMessageId, tx.select({ id: s.emailMessages.id }).from(s.emailMessages).where(and(eq(s.emailMessages.tenantId, t), inArray(s.emailMessages.opportunityId, opps)))));
          await tx.delete(s.emailMessages).where(and(eq(s.emailMessages.tenantId, t), inArray(s.emailMessages.opportunityId, opps)));
          await tx.delete(s.negotiationReads).where(sc(s.negotiationReads));
          await tx.delete(s.negotiationMessages).where(sc(s.negotiationMessages));
          // chamados do GLPI ligados às oportunidades (o chamado continua existindo no GLPI)
          await tx.delete(s.glpiTicketEvents).where(sc(s.glpiTicketEvents));
          await tx.delete(s.glpiTickets).where(sc(s.glpiTickets));
          await tx.delete(s.approvalDecisions).where(sc(s.approvalDecisions));
          await tx.delete(s.approvalRequests).where(sc(s.approvalRequests));
          await tx.delete(s.opportunityAnswers).where(inArray(s.opportunityAnswers.opportunityId, opps));
          await tx.delete(s.opportunityAttachments).where(inArray(s.opportunityAttachments.opportunityId, opps));
          await tx.delete(s.opportunityEconDecisions).where(sc(s.opportunityEconDecisions));
          await tx.delete(s.opportunityEconomicsSnapshots).where(sc(s.opportunityEconomicsSnapshots));
          await tx.delete(s.opportunityEconomics).where(sc(s.opportunityEconomics));
          await tx.delete(s.opportunityItems).where(sc(s.opportunityItems));
          await tx.delete(s.opportunityDeliveryAddresses).where(sc(s.opportunityDeliveryAddresses));
          // catálogo de produtos: sai o que só existia nas negociações apagadas (o que ficou continua valendo)
          await tx.execute(sql`delete from product_catalog pc where pc.tenant_id = ${t} and not exists (select 1 from opportunity_items i where i.tenant_id = pc.tenant_id and lower(trim(i.description)) = lower(pc.description))`);
          await tx.delete(s.bidParticipants).where(sc(s.bidParticipants));
          await tx.delete(s.bidActions).where(sc(s.bidActions));
          await del('historico_oportunidades', tx.delete(s.opportunityEvents).where(sc(s.opportunityEvents)).returning({ id: s.opportunityEvents.id }));
          await del('oportunidades', tx.delete(s.opportunities).where(sc(s.opportunities)).returning({ id: s.opportunities.id }));
          await tx.update(s.integrationEvents).set({ leadId: null }).where(sc(s.integrationEvents));
          await del('leads', tx.delete(s.leads).where(sc(s.leads)).returning({ id: s.leads.id }));
        }
        if (body.scopes.includes('clientes')) {
          // oportunidades que sobrarem deixam de apontar para o cliente apagado
          await tx.update(s.opportunities).set({ customerId: null }).where(sc(s.opportunities));
          const custs = tx.select({ id: s.customers.id }).from(s.customers).where(sc(s.customers));
          await tx.delete(s.addresses).where(and(eq(s.addresses.tenantId, t), inArray(s.addresses.customerId, custs)));
          await tx.delete(s.customerExternalIds).where(sc(s.customerExternalIds));
          await tx.delete(s.contactIdentityLinks).where(sc(s.contactIdentityLinks));
          await tx.delete(s.contactClassifications).where(sc(s.contactClassifications));
          await del('clientes', tx.delete(s.customers).where(sc(s.customers)).returning({ id: s.customers.id }));
        }
        // contatos que não estão mais em lead, oportunidade, cliente ou atividade
        const used = (tbl: typeof s.leads | typeof s.opportunities | typeof s.customers | typeof s.activities) => tx.select({ x: sql`1` }).from(tbl).where(eq((tbl as typeof s.leads).contactId, s.contacts.id));
        await tx.delete(s.addresses).where(and(eq(s.addresses.tenantId, t), isNull(s.addresses.customerId), notExists(tx.select({ x: sql`1` }).from(s.leads).where(eq(s.leads.contactId, s.addresses.contactId)))));
        await tx.delete(s.ixcOsWatch).where(eq(s.ixcOsWatch.tenantId, t)); // só memória da última leitura do IXC
        // Relatório de Medição das contas que vão sair (configuração e relatórios)
        for (const tb of ['measurement_reports', 'measurement_report_settings']) await tx.execute(sql`delete from ${sql.identifier(tb)} m where m.tenant_id = ${t} and not exists (select 1 from opportunities o where o.contact_id = m.contact_id) and not exists (select 1 from leads l where l.contact_id = m.contact_id) and not exists (select 1 from customers c where c.contact_id = m.contact_id) and not exists (select 1 from activities a where a.contact_id = m.contact_id)`);
        await del('contatos', tx.delete(s.contacts).where(and(eq(s.contacts.tenantId, t), notExists(used(s.leads)), notExists(used(s.opportunities)), notExists(used(s.customers)), notExists(used(s.activities)), notExists(tx.select({ x: sql`1` }).from(s.contactClassifications).where(eq(s.contactClassifications.contactId, s.contacts.id))), notExists(tx.select({ x: sql`1` }).from(s.contactIdentityLinks).where(or(eq(s.contactIdentityLinks.contactId, s.contacts.id), eq(s.contactIdentityLinks.otherContactId, s.contacts.id)))), notExists(tx.select({ x: sql`1` }).from(s.addresses).where(eq(s.addresses.contactId, s.contacts.id))))).returning({ id: s.contacts.id }));
      });
      await audit(app.db, req, { action: 'base.clear', entityType: 'tenant', entityId: t, metadata: { scopes: body.scopes, counts, keep: body.keep } });
      return { ok: true, counts };
    },
  }),
];
