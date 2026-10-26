/** Sucesso do Cliente por conta: contratos da conta com o CS responsável de cada um (troca só daquele contrato). */
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { accountContracts, CS_KEY } from '../services/customerSuccess';
import { account, requireEdit } from './cs';

export const csContractRoutes = [
  defineRoute({
    method: 'GET', url: '/cs/accounts/:contactId/contracts', summary: 'Contratos vigentes da conta com o CS responsável de cada um (o do contrato ou, sem ele, o da conta)', tag: 'Sucesso do Cliente', module: 'clientes',
    params: z.object({ contactId: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const x = await account(app.db, auth, params.contactId);
      const list = await accountContracts(app.db, auth.tenantId, [params.contactId]);
      const ids = [...new Set([x.acc?.csmId, ...list.map((c) => c.csmId)].filter(Boolean) as string[])];
      const people = ids.length ? await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids)) : [];
      const name = (id: string | null | undefined) => people.find((p) => p.id === id)?.name ?? null;
      return {
        canEdit: x.canEdit,
        accountCsm: { id: x.acc?.csmId ?? null, name: name(x.acc?.csmId) },
        items: list.map((c) => ({ id: c.id, number: c.number, object: c.object, monthlyCents: c.monthlyCents, billingType: c.billingType, kind: c.kind, stage: c.stage, endAt: c.endAt, csmId: c.csmId, csmName: name(c.csmId), ownCsm: !!c.csmId && c.csmId !== (x.acc?.csmId ?? null) })),
      };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/cs/contracts/:id/csm', summary: 'Troca o CS responsável só deste contrato (a conta mantém o seu); a jornada e as tarefas abertas do contrato passam para a pessoa nova', tag: 'Sucesso do Cliente', module: 'clientes',
    params: IdParams, body: z.object({ csmId: z.string().uuid().nullable(), justification: z.string().trim().max(500).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const [c] = await app.db.select({ id: s.contracts.id, contactId: s.contracts.contactId, csmId: s.contracts.csmId }).from(s.contracts).where(and(eq(s.contracts.id, params.id), eq(s.contracts.tenantId, auth.tenantId))).limit(1);
      if (!c) throw notFound('Contrato não encontrado.');
      const x = await account(app.db, auth, c.contactId);
      requireEdit(x);
      // sem pessoa = volta a seguir o CS da conta
      const target = body.csmId ?? x.acc?.csmId ?? null;
      if (body.csmId) {
        const [u] = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.id, body.csmId), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).limit(1);
        if (!u) throw unprocessable('Pessoa inválida.');
      }
      const people = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, [c.csmId, target].filter(Boolean) as string[]));
      const nm = (id: string | null) => people.find((p) => p.id === id)?.name ?? 'CS da conta';
      const [num] = await app.db.select({ number: s.contractVersions.number }).from(s.contractVersions).innerJoin(s.contracts, and(eq(s.contracts.id, s.contractVersions.contractId), eq(s.contractVersions.version, s.contracts.currentVersion))).where(eq(s.contracts.id, c.id)).limit(1);
      await app.db.transaction(async (tx) => {
        await tx.update(s.contracts).set({ csmId: body.csmId, updatedAt: new Date() }).where(eq(s.contracts.id, c.id));
        if (target) {
          await tx.update(s.csJourneys).set({ csmId: target }).where(and(eq(s.csJourneys.tenantId, auth.tenantId), eq(s.csJourneys.contractId, c.id), eq(s.csJourneys.status, 'ativa')));
          await tx.update(s.activities).set({ ownerId: target, updatedAt: new Date() }).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.contractId, c.id), isNotNull(s.activities.csKind), isNull(s.activities.completedAt), isNull(s.activities.deletedAt)));
        }
        const summary = `CS responsável do contrato ${num?.number ?? ''}: ${nm(c.csmId)} → ${body.csmId ? nm(target) : 'CS da conta'}${body.justification ? ` (${body.justification})` : ''}.`;
        await tx.insert(s.contractEvents).values({ tenantId: auth.tenantId, contractId: c.id, type: 'cs_responsavel', actorId: auth.userId, summary, payload: { from: c.csmId, to: body.csmId } });
        await tx.insert(s.csAssessments).values({ tenantId: auth.tenantId, contactId: c.contactId, kind: 'csm_contrato', data: { contractId: c.id, number: num?.number ?? null, from: c.csmId, to: body.csmId }, justification: body.justification ?? null, actorId: auth.userId });
        const [card] = await tx.select({ id: s.opportunities.id }).from(s.opportunities).innerJoin(s.pipelines, eq(s.pipelines.id, s.opportunities.pipelineId))
          .where(and(eq(s.opportunities.tenantId, auth.tenantId), eq(s.opportunities.contactId, c.contactId), eq(s.pipelines.key, CS_KEY), isNull(s.opportunities.deletedAt))).limit(1);
        if (card) await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: card.id, type: 'csm_contrato', actorId: auth.userId, payload: { contractId: c.id, number: num?.number ?? null, from: c.csmId, to: body.csmId } });
      });
      await audit(app.db, req, { action: 'cs.contract.csm', entityType: 'contract', entityId: c.id, metadata: { from: c.csmId, to: body.csmId } });
      return { ok: true };
    },
  }),
];
