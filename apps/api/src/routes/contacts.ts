import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { ContactCreate, CustomerListQuery } from '@isp/shared';
import { onlyDigits, SEGMENTS } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable, forbidden } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { assertAssignableUser, level, ownerScope } from '../services/scope';
import { opportunityDto, opportunityQuery, oppVisibility } from '../services/opportunities';
import { ratio } from '../services/metrics';
import { freshSnapshot } from '../services/cs';

const like = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;
const owner = alias(s.users, 'cust_owner');
/** Carteira de clientes: o nível do módulo Clientes filtra pelo responsável do contato. */
const scope = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });
/** As contas são da empresa (26/11/2026): quem acessa Clientes lê todas na lista, na busca e na ficha. Alterar e excluir seguem o nível. */
const readScope = (auth: AuthContext) => (level(auth, 'clientes') === 'nenhum' ? scope(auth) : and(eq(s.contacts.tenantId, auth.tenantId), isNull(s.contacts.deletedAt))!);

export const contactRoutes = [
  defineRoute({
    method: 'PATCH',
    url: '/contacts/:id',
    summary: 'Edita a conta: nome, telefone, e-mail, segmento, cidade e natureza (conta do ERP: o nome vem do sistema de origem); auditado',
    tag: 'Clientes',
    module: 'clientes',
    params: IdParams,
    body: z.object({
      name: z.string().trim().min(2, 'Informe ao menos 2 caracteres').max(160).optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      email: z.string().trim().email('E-mail inválido').max(200).nullable().optional().or(z.literal('').transform(() => null)),
      segment: z.enum(SEGMENTS).optional(),
      city: z.string().trim().max(80).nullable().optional(),
      nature: z.enum(['publica', 'privada']).nullable().optional(),
      ownerId: z.string().uuid().optional(),
    }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const [c] = await tx.select().from(s.contacts).where(and(eq(s.contacts.id, params.id), scope(auth))).limit(1).for('update');
      if (!c) throw notFound('Cliente não encontrado.');
      if (body.name !== undefined && body.name !== c.name && c.sourceSystem !== 'crm') throw unprocessable('Conta vinda de integração: o nome é mantido pelo sistema de origem.', [{ path: 'name', message: 'Vem do ERP' }]);
      if (body.ownerId && body.ownerId !== c.ownerId) await assertAssignableUser(tx, auth, 'clientes', body.ownerId);
      const set: Partial<typeof s.contacts.$inferInsert> = {};
      const from: Record<string, unknown> = {}, to: Record<string, unknown> = {};
      for (const k of ['name', 'phone', 'email', 'segment', 'city', 'nature', 'ownerId'] as const) {
        const v = body[k];
        if (v === undefined) continue;
        const nv = typeof v === 'string' ? v.trim() || null : v;
        if ((nv ?? null) === (c[k] ?? null)) continue;
        (set as Record<string, unknown>)[k] = nv; from[k] = c[k]; to[k] = nv;
      }
      if (set.name === null) throw unprocessable('Informe o nome da conta.', [{ path: 'name', message: 'Obrigatório' }]);
      if (Object.keys(set).length) {
        await tx.update(s.contacts).set({ ...set, updatedAt: new Date(), rowVersion: sql`${s.contacts.rowVersion} + 1` }).where(eq(s.contacts.id, c.id));
        await audit(tx, req, { action: 'contact.update', entityType: 'contact', entityId: c.id, metadata: { from, to } });
      }
      const [u] = await tx.select({ id: s.contacts.id, name: s.contacts.name, phone: s.contacts.phone, email: s.contacts.email, segment: s.contacts.segment, city: s.contacts.city, nature: s.contacts.nature, ownerId: s.contacts.ownerId }).from(s.contacts).where(eq(s.contacts.id, c.id));
      return u!;
    }),
  }),

  defineRoute({
    method: 'DELETE',
    url: '/contacts/:id',
    summary: 'Exclui a conta cadastrada por engano (sem oportunidade, contrato ou registro do ERP); auditado',
    tag: 'Clientes',
    module: 'clientes',
    params: IdParams,
    handler: async ({ app, auth, params, req }) => app.db.transaction(async (tx) => {
      const [c] = await tx.select().from(s.contacts).where(and(eq(s.contacts.id, params.id), scope(auth))).limit(1).for('update');
      if (!c) throw notFound('Cliente não encontrado.');
      if (level(auth, 'clientes') === 'proprio' && c.ownerId !== auth.userId) throw forbidden('Só o responsável pela conta (ou quem tem nível maior em Clientes) exclui a conta.');
      if (c.sourceSystem !== 'crm') throw unprocessable('Conta vinda de integração (ERP): não pode ser excluída aqui.');
      const [[o], [k], [cu]] = await Promise.all([
        tx.select({ n: sql<number>`count(*)::int` }).from(s.opportunities).where(and(eq(s.opportunities.contactId, c.id), isNull(s.opportunities.deletedAt))),
        tx.select({ n: sql<number>`count(*)::int` }).from(s.contracts).where(eq(s.contracts.contactId, c.id)),
        tx.select({ n: sql<number>`count(*)::int` }).from(s.customers).where(eq(s.customers.contactId, c.id)),
      ]);
      const why = [o!.n ? `${o!.n} oportunidade(s)` : '', k!.n ? `${k!.n} contrato(s)` : '', cu!.n ? 'cliente ativo no ERP' : ''].filter(Boolean);
      if (why.length) throw unprocessable(`A conta tem ${why.join(', ')}: não pode ser excluída. Edite os dados que estiverem errados.`);
      await tx.update(s.contacts).set({ deletedAt: new Date(), updatedAt: new Date(), rowVersion: sql`${s.contacts.rowVersion} + 1` }).where(eq(s.contacts.id, c.id));
      await audit(tx, req, { action: 'contact.delete', entityType: 'contact', entityId: c.id, metadata: { name: c.name } });
      return { ok: true };
    }),
  }),

  defineRoute({
    method: 'GET',
    url: '/contacts',
    summary: 'Busca de contatos da carteira (combobox da nova oportunidade)',
    tag: 'Clientes',
    module: 'clientes',
    query: z.object({ q: z.string().trim().min(2).max(100) }),
    handler: async ({ app, auth, query }) => {
      const rows = await app.db
        .select({ id: s.contacts.id, name: s.contacts.name, phone: s.contacts.phone, email: s.contacts.email, segment: s.contacts.segment, customerId: s.customers.id, lifecycle: s.customers.lifecycle, externalId: s.customers.externalId })
        .from(s.contacts)
        .leftJoin(s.customers, eq(s.customers.contactId, s.contacts.id))
        .where(and(readScope(auth), or(ilike(s.contacts.name, like(query.q)), ilike(s.contacts.phone, like(query.q)), ilike(s.contacts.email, like(query.q)), eq(s.customers.externalId, query.q))))
        .orderBy(sql`${s.customers.id} is null`, s.contacts.name)
        .limit(10);
      return { items: rows };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contacts',
    summary: 'Cadastra cliente/contato na carteira (prospect até haver contrato no IXC)',
    tag: 'Clientes',
    module: 'clientes',
    body: ContactCreate,
    handler: async ({ app, auth, body, reply, req }) => {
      const ownerId = body.ownerId ?? auth.userId;
      await assertAssignableUser(app.db, auth, 'clientes', ownerId);
      const [c] = await app.db
        .insert(s.contacts)
        .values({ tenantId: auth.tenantId, name: body.name, phone: body.phone, email: body.email, segment: body.segment, city: body.city, ownerId, createdBy: auth.userId })
        .returning();
      await audit(app.db, req, { action: 'contact.create', entityType: 'contact', entityId: c!.id });
      reply.code(201);
      return { id: c!.id, name: c!.name, phone: c!.phone, email: c!.email, segment: c!.segment };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/customers/summary',
    summary: 'Indicadores da carteira de clientes',
    tag: 'Clientes',
    module: 'clientes',
    handler: async ({ app, auth }) => {
      const [r] = (
        await app.db.execute<{ ativos: number; cancelados: number; implantacao: number; vencer: number }>(sql`
          select count(*) filter (where cu.lifecycle in ('ativo','reativado'))::int ativos,
                 count(*) filter (where cu.lifecycle = 'cancelado')::int cancelados,
                 count(*) filter (where cu.lifecycle = 'em_implantacao')::int implantacao,
                 count(*) filter (where cu.lifecycle in ('ativo','reativado','inadimplente') and cu.next_due_on between current_date and current_date + 30)::int vencer
          from ${s.contacts} join ${s.customers} cu on cu.contact_id = ${s.contacts.id}
          where ${readScope(auth)}`)
      ).rows;
      const noHistory = 'Sem histórico para comparar: a evolução da base chega com a sincronização do IXC.';
      return {
        kpis: [
          { key: 'ativos', label: 'Clientes ativos', value: r!.ativos, delta: null, unit: 'count', formula: `Clientes com situação Ativo ou Reativado. ${noHistory}` },
          { key: 'retencao', label: 'Taxa de retenção', value: ratio(r!.ativos, r!.ativos + r!.cancelados), delta: null, unit: 'ratio', formula: `Ativos ÷ (ativos + cancelados) da carteira (n=${r!.ativos + r!.cancelados}). ${noHistory}` },
          { key: 'implantacao', label: 'Em implantação', value: r!.implantacao, delta: null, unit: 'count', formula: `Clientes com situação Em implantação. ${noHistory}` },
          { key: 'vencer', label: 'Com contratos a vencer', value: r!.vencer, delta: null, unit: 'count', formula: `Contratos com próximo vencimento nos próximos 30 dias. ${noHistory}` },
        ],
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/customers',
    summary: 'Lista clientes e contatos da carteira com plano, situação e contrato',
    tag: 'Clientes',
    module: 'clientes',
    query: CustomerListQuery,
    handler: async ({ app, auth, query }) => {
      const where: SQL[] = [readScope(auth)];
      if (query.q) where.push(or(ilike(s.contacts.name, like(query.q)), ilike(s.contacts.phone, like(query.q)), eq(s.customers.externalId, query.q))!);
      if (query.lifecycle === 'prospect') where.push(isNull(s.customers.id));
      else if (query.lifecycle) where.push(eq(s.customers.lifecycle, query.lifecycle));
      if (query.segment) where.push(eq(s.contacts.segment, query.segment));
      if (query.planId) where.push(eq(s.customers.planId, query.planId));
      if (query.ownerId) where.push(eq(s.contacts.ownerId, query.ownerId));
      const cond = and(...where);
      const [rows, [{ total } = { total: 0 }]] = await Promise.all([
        app.db
          .select({
            id: s.contacts.id,
            name: s.contacts.name,
            phone: s.contacts.phone,
            email: s.contacts.email,
            segment: s.contacts.segment,
            city: s.contacts.city,
            isProvisional: s.contacts.isProvisional,
            createdAt: s.contacts.createdAt,
            customerId: s.customers.id,
            lifecycle: s.customers.lifecycle,
            externalId: s.customers.externalId,
            sourceSystem: s.customers.sourceSystem,
            contractStart: s.customers.contractStart,
            nextDueOn: s.customers.nextDueOn,
            planName: s.plans.name,
            planLine: s.plans.line,
            ownerId: s.contacts.ownerId,
            ownerName: owner.name,
            ownerHasAvatar: sql<boolean>`exists(select 1 from user_avatars ua where ua.user_id = "contacts"."owner_id")`,
          })
          .from(s.contacts)
          .leftJoin(s.customers, eq(s.customers.contactId, s.contacts.id))
          .leftJoin(s.plans, eq(s.plans.id, s.customers.planId))
          .leftJoin(owner, eq(owner.id, s.contacts.ownerId))
          .where(cond)
          .orderBy(sql`${s.customers.id} is null`, sql`${s.customers.contractStart} asc nulls last`, s.contacts.name)
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        app.db.select({ total: sql<number>`count(*)::int` }).from(s.contacts).leftJoin(s.customers, eq(s.customers.contactId, s.contacts.id)).where(cond),
      ]);
      return { items: rows.map((r) => ({ ...r, lifecycle: r.lifecycle ?? 'prospect' })), page: query.page, pageSize: query.pageSize, total };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contacts/:id',
    summary: 'Ficha do cliente: identidade, plano, contrato, oportunidades e interações',
    tag: 'Clientes',
    module: 'clientes',
    params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      const [c] = await app.db
        .select({
          id: s.contacts.id,
          name: s.contacts.name,
          document: s.contacts.document,
          contactSource: s.contacts.sourceSystem,
          phone: s.contacts.phone,
          email: s.contacts.email,
          segment: s.contacts.segment,
          city: s.contacts.city,
          nature: s.contacts.nature,
          isProvisional: s.contacts.isProvisional,
          custom: s.contacts.custom,
          createdAt: s.contacts.createdAt,
          ownerId: s.contacts.ownerId,
          ownerName: owner.name,
          customerId: s.customers.id,
          lifecycle: s.customers.lifecycle,
          sourceSystem: s.customers.sourceSystem,
          externalId: s.customers.externalId,
          contractStart: s.customers.contractStart,
          nextDueOn: s.customers.nextDueOn,
          planName: s.plans.name,
          planLine: s.plans.line,
          planPriceCents: s.plans.priceCents,
          sourceUpdatedAt: s.customers.sourceUpdatedAt,
          ingestedAt: s.customers.ingestedAt,
        })
        .from(s.contacts)
        .leftJoin(s.customers, eq(s.customers.contactId, s.contacts.id))
        .leftJoin(s.plans, eq(s.plans.id, s.customers.planId))
        .leftJoin(owner, eq(owner.id, s.contacts.ownerId))
        .where(and(eq(s.contacts.id, params.id), readScope(auth)))
        .limit(1);
      if (!c) throw notFound('Cliente não encontrado.');
      const externalIds = c.customerId
        ? await app.db.select({ system: s.customerExternalIds.system, externalId: s.customerExternalIds.externalId }).from(s.customerExternalIds).where(and(eq(s.customerExternalIds.customerId, c.customerId), eq(s.customerExternalIds.tenantId, auth.tenantId)))
        : [];
      const opps = await opportunityQuery(app.db).where(and(eq(s.opportunities.contactId, params.id), oppVisibility(auth))).orderBy(desc(s.opportunities.updatedAt));
      const addresses = await app.db
        .select()
        .from(s.addresses)
        .where(and(eq(s.addresses.tenantId, auth.tenantId), or(eq(s.addresses.contactId, params.id), c.customerId ? eq(s.addresses.customerId, c.customerId) : undefined)))
        .orderBy(desc(s.addresses.validFrom));
      const staleHours = c.ingestedAt ? (Date.now() - c.ingestedAt.getTime()) / 3_600_000 : null;
      // Tier e IPC do Sucesso do Cliente, recalculados se algo mudou depois do último cálculo
      const sn = await freshSnapshot(app.db, auth.tenantId, params.id).catch((e) => { req.log.error(e, 'tier da conta'); return null; });
      const strategic = sn ? {
        tier: sn.tier, acvCents: sn.groupAcvCents, ownAcvCents: sn.acvCents, groupContacts: sn.groupContacts,
        acvParts: sn.acvParts ?? null, acvExcluded: sn.acvExcluded ?? null, classKey: sn.classKey,
        ipc: { total: sn.ipc.total, partial: sn.ipc.partial, pending: sn.ipc.pending.length }, computedAt: sn.computedAt,
      } : null;
      await audit(app.db, req, { action: 'customer.view', entityType: 'contact', entityId: params.id });
      return {
        ...c,
        lifecycle: c.lifecycle ?? 'prospect',
        externalIds,
        addresses,
        freshness: c.ingestedAt ? { ingestedAt: c.ingestedAt, stale: (staleHours ?? 0) > 24, staleHours } : null,
        opportunities: opps.map((o) => opportunityDto(o)),
        strategic,
      };
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/contacts/:id/document',
    summary: 'CNPJ/CPF da conta (11 ou 14 dígitos; duplicado é recusado; auditado)',
    tag: 'Clientes',
    module: 'clientes',
    params: IdParams,
    body: z.object({ document: z.string().trim().max(30).nullable() }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const [c] = await tx.select({ id: s.contacts.id, document: s.contacts.document, sourceSystem: s.contacts.sourceSystem }).from(s.contacts).where(and(eq(s.contacts.id, params.id), scope(auth))).limit(1).for('update');
      if (!c) throw notFound('Cliente não encontrado.');
      if (c.sourceSystem !== 'crm') throw unprocessable('Conta vinda de integração: o CNPJ/CPF é mantido pelo sistema de origem.');
      const d = body.document ? onlyDigits(body.document) : '';
      if (body.document && d.length !== 11 && d.length !== 14) throw unprocessable('CNPJ/CPF incompleto.', [{ path: 'document', message: 'Informe 11 (CPF) ou 14 (CNPJ) dígitos' }]);
      if (d) {
        const [dup] = await tx.select({ name: s.contacts.name }).from(s.contacts).where(and(eq(s.contacts.tenantId, auth.tenantId), sql`${s.contacts.id} <> ${c.id}`, isNull(s.contacts.deletedAt), sql`regexp_replace(coalesce(${s.contacts.document}, ''), '[^0-9]', '', 'g') = ${d}`)).limit(1);
        if (dup) throw unprocessable(`Este CNPJ/CPF já pertence à conta ${dup.name}. Unir cadastros exige revisão.`, [{ path: 'document', message: 'Duplicado' }]);
      }
      const document = body.document?.trim() || null;
      if (document !== c.document) {
        await tx.update(s.contacts).set({ document, updatedAt: new Date(), rowVersion: sql`${s.contacts.rowVersion} + 1` }).where(eq(s.contacts.id, c.id));
        await audit(tx, req, { action: 'contact.update', entityType: 'contact', entityId: c.id, metadata: { from: { document: c.document }, to: { document } } });
      }
      return { document };
    }),
  }),
];
