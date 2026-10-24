/** Extrato do contrato (saldo, consumos, estornos, lançamentos) e vínculo da oportunidade com um contrato por medição. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { LEDGER_LABELS } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { brl } from '../services/email';
import { addEvent, hasSector, isAdmin, loadContract } from '../services/contracts';
import { commitmentsOf, consumptionOf, ledgerOf, ledgerTotalsFor, pickCommitment } from '../services/contractLedger';
import { loadOpportunity } from '../services/opportunities';
import { level } from '../services/scope';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const isManager = (auth: Parameters<typeof isAdmin>[0]) => isAdmin(auth) || level(auth, 'contratos') === 'total' || hasSector(auth, ['administracao', 'inteligencia_comercial', 'diretoria']);

export const contractLedgerRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/:id/consumption', summary: 'Indicador de consumo (ritmo × tempo, esgotamento, consumo mensal) e empenhos com saldo', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const [v] = await app.db.select({ startAt: s.contractVersions.startAt, endAt: s.contractVersions.endAt }).from(s.contractVersions).where(and(eq(s.contractVersions.contractId, c.id), eq(s.contractVersions.version, c.currentVersion))).limit(1);
      const r = await consumptionOf(app.db, c, { startAt: v?.startAt ?? null, endAt: v?.endAt ?? null });
      return { ...r, kind: c.kind, billingType: c.billingType, startAt: v?.startAt ?? null, endAt: v?.endAt ?? null, canManage: isManager(auth) || hasSector(auth, ['financeiro']) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitments', summary: 'Registra nota de empenho (contrato público)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ number: z.string().trim().min(3).max(40), issuedOn: day, amountCents: z.number().int().min(1).max(1_000_000_000_000), notes: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!(isManager(auth) || hasSector(auth, ['financeiro']))) throw forbidden('Empenhos são do Financeiro ou da gestão de contratos.');
      if (c.kind !== 'publico') throw unprocessable('Empenho é de contrato público.');
      const [dup] = await app.db.select({ id: s.contractCommitments.id }).from(s.contractCommitments).where(and(eq(s.contractCommitments.contractId, c.id), eq(s.contractCommitments.number, body.number))).limit(1);
      if (dup) throw unprocessable('Este empenho já está registrado no contrato.', [{ path: 'number', message: 'Duplicado' }]);
      const [e] = await app.db.insert(s.contractCommitments).values({ tenantId: auth.tenantId, contractId: c.id, number: body.number, issuedOn: body.issuedOn, fiscalYear: Number(body.issuedOn.slice(0, 4)), amountCents: body.amountCents, notes: body.notes ?? null, createdBy: auth.userId }).returning({ id: s.contractCommitments.id });
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'empenho', `Empenho ${body.number} de ${brl(body.amountCents)} (${body.issuedOn}).`, { commitmentId: e!.id, amountCents: body.amountCents });
      await audit(app.db, req, { action: 'contract.commitment', entityType: 'contract', entityId: c.id, metadata: { number: body.number, amountCents: body.amountCents } });
      reply.code(201);
      return { id: e!.id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/commitments/:cid/cancel', summary: 'Anula um empenho (fica no histórico, sem saldo)', tag: 'Contratos', module: 'contratos',
    params: z.object({ id: z.string().uuid(), cid: z.string().uuid() }), body: z.object({ reason: z.string().trim().min(5).max(300) }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!(isManager(auth) || hasSector(auth, ['financeiro']))) throw forbidden('Empenhos são do Financeiro ou da gestão de contratos.');
      const [e] = await app.db.select().from(s.contractCommitments).where(and(eq(s.contractCommitments.id, params.cid), eq(s.contractCommitments.contractId, c.id))).limit(1);
      if (!e) throw notFound('Empenho não encontrado.');
      if (e.cancelledAt) throw unprocessable('Empenho já anulado.');
      await app.db.update(s.contractCommitments).set({ cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: body.reason }).where(eq(s.contractCommitments.id, e.id));
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'empenho', `Empenho ${e.number} anulado: ${body.reason}`, { commitmentId: e.id });
      await audit(app.db, req, { action: 'contract.commitment_cancel', entityType: 'contract', entityId: c.id, metadata: { number: e.number } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/contracts/:id/ledger',
    summary: 'Extrato do contrato com saldo (medição) e lançamentos de faturamento',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const { entries, totals } = await ledgerOf(app.db, c.id);
      const users = entries.length ? await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, [...new Set(entries.map((e) => e.createdBy).filter((x): x is string => !!x))])) : [];
      const opps = entries.some((e) => e.opportunityId) ? await app.db.select({ id: s.opportunities.id, code: s.opportunities.code }).from(s.opportunities).where(inArray(s.opportunities.id, entries.map((e) => e.opportunityId).filter((x): x is string => !!x))) : [];
      let running = 0;
      const items = entries.map((e) => {
        if (e.kind === 'credito' || e.kind === 'estorno') running += e.amountCents;
        if (e.kind === 'consumo') running -= e.amountCents;
        return { ...e, label: LEDGER_LABELS[e.kind as keyof typeof LEDGER_LABELS], createdByName: users.find((u) => u.id === e.createdBy)?.name ?? null, opportunityCode: opps.find((o) => o.id === e.opportunityId)?.code ?? null, balanceAfter: e.kind === 'faturamento' ? null : running };
      });
      return { billingType: c.billingType, totals, items: items.reverse() };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contracts/:id/ledger',
    summary: 'Lança no extrato: crédito de saldo, consumo manual, estorno de um consumo ou lançamento de faturamento (frequente)',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    body: z.object({ kind: z.enum(['credito', 'consumo', 'estorno', 'faturamento']), amountCents: z.number().int().min(1).max(1_000_000_000_000).optional(), occurredOn: day, description: z.string().trim().min(3).max(300), reversesId: z.string().uuid().optional(), commitmentId: z.string().uuid().nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!c.validatedAt && body.kind !== 'credito') throw unprocessable('Valide o cadastro antes de lançar consumos e faturamento.');
      if (c.stage === 'arquivado') throw unprocessable('Contrato arquivado.');
      const manager = isAdmin(auth) || level(auth, 'contratos') === 'total' || hasSector(auth, ['administracao', 'inteligencia_comercial', 'diretoria']);
      if (body.kind === 'credito' && !(manager || hasSector(auth, ['financeiro']))) throw forbidden('Crédito de saldo é com Financeiro, Administração ou gestão de contratos.');
      if (body.kind === 'faturamento' && !(manager || hasSector(auth, ['financeiro']))) throw forbidden('Lançamentos de faturamento são do Financeiro.');
      if ((body.kind === 'consumo' || body.kind === 'estorno') && !(manager || hasSector(auth, ['financeiro']) || c.commercialOwnerId === auth.userId)) throw forbidden();
      if (body.kind !== 'faturamento' && c.billingType !== 'medicao') throw unprocessable('Saldo, consumo e estorno são de contratos por medição.');
      if (body.kind === 'faturamento' && c.billingType === 'medicao') throw unprocessable('Em contratos por medição, o faturamento é o próprio consumo.');
      const out = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select id from contracts where id = ${c.id} for update`);
        const { totals, entries } = await ledgerOf(tx, c.id);
        let amount = body.amountCents ?? 0;
        let reversesId: string | null = null;
        let commitmentId: string | null = null;
        if (body.kind === 'estorno') {
          const src = entries.find((e) => e.id === body.reversesId && e.kind === 'consumo');
          if (!src) throw unprocessable('Escolha o consumo a estornar.', [{ path: 'reversesId', message: 'Consumo não encontrado' }]);
          const already = entries.filter((e) => e.kind === 'estorno' && e.reversesId === src.id).reduce((a, e) => a + e.amountCents, 0);
          amount = body.amountCents ?? src.amountCents - already;
          if (amount <= 0 || amount > src.amountCents - already) throw unprocessable('Valor maior que o consumo ainda não estornado.');
          reversesId = src.id;
          commitmentId = src.commitmentId ?? null;
        }
        if (amount <= 0) throw unprocessable('Informe o valor.', [{ path: 'amountCents', message: 'Obrigatório' }]);
        if (body.kind === 'consumo' && amount > totals.available) throw unprocessable(`Saldo insuficiente: disponível ${brl(totals.available)}.`, [{ path: 'amountCents', message: 'Saldo insuficiente' }]);
        // contrato público: o faturamento sai de um empenho (o escolhido ou o mais antigo com saldo)
        if (c.kind === 'publico' && (body.kind === 'consumo' || body.kind === 'faturamento')) {
          if (body.commitmentId) {
            const list = await commitmentsOf(tx, c.id);
            const ch = list.find((x) => x.id === body.commitmentId && !x.cancelledAt);
            if (!ch) throw unprocessable('Empenho não encontrado ou anulado.', [{ path: 'commitmentId', message: 'Empenho inválido' }]);
            if (amount > ch.available) throw unprocessable(`Saldo do empenho ${ch.number} insuficiente: ${brl(ch.available)}.`, [{ path: 'commitmentId', message: 'Saldo insuficiente' }]);
            commitmentId = ch.id;
          } else commitmentId = await pickCommitment(tx, c.id, amount);
        }
        const [e] = await tx.insert(s.contractLedger).values({ tenantId: auth.tenantId, contractId: c.id, kind: body.kind, amountCents: amount, occurredOn: body.occurredOn, description: body.description, reversesId, commitmentId, createdBy: auth.userId }).returning({ id: s.contractLedger.id });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, body.kind, `${LEDGER_LABELS[body.kind]} de ${brl(amount)}: ${body.description}`, { ledgerId: e!.id, amountCents: amount });
        return e!.id;
      });
      await audit(app.db, req, { action: `contract.ledger.${body.kind}`, entityType: 'contract', entityId: c.id, metadata: { amountCents: body.amountCents } });
      reply.code(201);
      return { id: out };
    },
  }),

  // ------------------------------------------------------------------ oportunidade → contrato por medição
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/measurement-options',
    summary: 'Contratos por medição do cliente da oportunidade, com saldo disponível',
    tag: 'Oportunidades',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select({ id: s.contracts.id, code: s.contracts.code, stage: s.contracts.stage, number: s.contractVersions.number, object: s.contractVersions.object, endAt: s.contractVersions.endAt })
        .from(s.contracts).innerJoin(s.contractVersions, and(eq(s.contractVersions.contractId, s.contracts.id), eq(s.contractVersions.version, s.contracts.currentVersion)))
        .where(and(eq(s.contracts.tenantId, auth.tenantId), eq(s.contracts.contactId, o.contactId), eq(s.contracts.billingType, 'medicao'), sql`${s.contracts.stage} not in ('arquivado','cadastro_validacao')`));
      const totals = await ledgerTotalsFor(app.db, rows.map((r) => r.id));
      return { items: rows.map((r) => ({ ...r, ...totals.get(r.id)! })) };
    },
  }),
  defineRoute({
    method: 'PUT',
    url: '/opportunities/:id/measurement',
    summary: 'Vincula a oportunidade a um contrato por medição (o consumo acontece quando a venda fecha)',
    tag: 'Oportunidades',
    module: 'oportunidades',
    params: IdParams,
    body: z.object({ contractId: z.string().uuid().nullable(), amountCents: z.number().int().min(1).max(1_000_000_000_000).nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      if (o.stage === 'ganha' || o.stage === 'perdida') throw unprocessable('Oportunidade encerrada: reabra para mudar o consumo.');
      if (body.contractId) {
        const [c] = await app.db.select({ id: s.contracts.id, contactId: s.contracts.contactId, billingType: s.contracts.billingType, stage: s.contracts.stage }).from(s.contracts).where(and(eq(s.contracts.id, body.contractId), eq(s.contracts.tenantId, auth.tenantId))).limit(1);
        if (!c) throw notFound('Contrato não encontrado.');
        if (c.contactId !== o.contactId || c.billingType !== 'medicao' || ['arquivado', 'cadastro_validacao'].includes(c.stage)) throw unprocessable('Escolha um contrato por medição ativo deste cliente.');
        const { totals } = await ledgerOf(app.db, c.id);
        const amount = body.amountCents ?? o.valueCents ?? 0;
        if (amount > totals.available) throw unprocessable(`Saldo insuficiente: disponível ${brl(totals.available)}.`, [{ path: 'amountCents', message: 'Saldo insuficiente' }]);
      }
      await app.db.update(s.opportunities).set({ measurementContractId: body.contractId, measurementCents: body.contractId ? body.amountCents : null, updatedAt: new Date(), rowVersion: sql`${s.opportunities.rowVersion} + 1` }).where(eq(s.opportunities.id, o.id));
      await app.db.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'medicao_vinculada', actorId: auth.userId, payload: { contractId: body.contractId, amountCents: body.amountCents } });
      await audit(app.db, req, { action: 'opportunity.measurement', entityType: 'opportunity', entityId: o.id, metadata: body });
      return { ok: true };
    },
  }),
];
