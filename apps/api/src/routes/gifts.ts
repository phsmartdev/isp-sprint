/**
 * Marketing → Brindes: estoque de itens (custo por item, fornecedor, mínimo), kits com categoria (custo = soma dos itens),
 * entradas por compra, envios para a conta e os stakeholders que receberam, consumo e o consolidado por conta.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { deliveryNeeds, giftConsolidated, kitCost, kitsAvailable, stockShortages, weightedCost } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { assertAccount } from './stakeholders';

const READ = { tag: 'Marketing', module: 'campanhas' as const };
const WRITE = { ...READ, min: 'equipe' as const };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const Line = z.object({ itemId: z.string().uuid(), qty: z.number().int().min(1).max(100_000) });
const lock = (db: DbOrTx, tenantId: string) => db.execute(sql`select pg_advisory_xact_lock(hashtext(${`brindes:${tenantId}`}))`);
const today = () => new Date().toISOString().slice(0, 10);

const itemsOf = (db: DbOrTx, tenantId: string) => db.select().from(s.giftItems).where(eq(s.giftItems.tenantId, tenantId)).orderBy(asc(s.giftItems.name));

async function sameTenant(db: DbOrTx, auth: AuthContext, ids: { supplierId?: string | null; categoryId?: string | null; itemIds?: string[] }) {
  if (ids.supplierId) { const [x] = await db.select({ id: s.suppliers.id }).from(s.suppliers).where(and(eq(s.suppliers.id, ids.supplierId), eq(s.suppliers.tenantId, auth.tenantId))); if (!x) throw unprocessable('Fornecedor não encontrado.'); }
  if (ids.categoryId) { const [x] = await db.select({ id: s.giftKitCategories.id }).from(s.giftKitCategories).where(and(eq(s.giftKitCategories.id, ids.categoryId), eq(s.giftKitCategories.tenantId, auth.tenantId))); if (!x) throw unprocessable('Categoria não encontrada.'); }
  if (ids.itemIds?.length) {
    const found = await db.select({ id: s.giftItems.id }).from(s.giftItems).where(and(inArray(s.giftItems.id, ids.itemIds), eq(s.giftItems.tenantId, auth.tenantId)));
    if (found.length !== new Set(ids.itemIds).size) throw unprocessable('Item não encontrado.');
  }
}
const dup = (e: unknown, what: string) => { if ((e as { code?: string }).code === '23505') throw unprocessable(`Já existe ${what} com esse nome.`); throw e; };

/** Envios da conta com nomes dos stakeholders + consolidado. */
export async function accountGifts(db: DbOrTx, tenantId: string, contactId: string) {
  const rows = await db.select({ d: s.giftDeliveries, by: s.users.name }).from(s.giftDeliveries).leftJoin(s.users, eq(s.users.id, s.giftDeliveries.createdBy))
    .where(and(eq(s.giftDeliveries.tenantId, tenantId), eq(s.giftDeliveries.contactId, contactId))).orderBy(desc(s.giftDeliveries.occurredOn), desc(s.giftDeliveries.createdAt));
  const sids = [...new Set(rows.flatMap((r) => r.d.stakeholderIds))];
  const people = sids.length ? await db.select({ id: s.accountStakeholders.id, name: s.people.name, title: s.accountStakeholders.title }).from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(inArray(s.accountStakeholders.id, sids)) : [];
  const pname = (id: string) => people.find((p) => p.id === id)?.name ?? 'Stakeholder removido';
  const deliveries = rows.map(({ d, by }) => ({ id: d.id, occurredOn: d.occurredOn, kitId: d.kitId, kitName: d.kitName, categoryName: d.categoryName, kits: d.kits, items: d.items, totalCents: d.totalCents, stakeholderIds: d.stakeholderIds, stakeholders: d.stakeholderIds.map((id) => ({ id, name: pname(id) })), note: d.note, by, cancelled: !!d.cancelledAt, cancelReason: d.cancelReason }));
  const c = giftConsolidated(deliveries);
  return { consolidated: { ...c, byStakeholder: c.byStakeholder.map((x) => ({ ...x, name: pname(x.key) })) }, deliveries };
}

export const giftRoutes = [
  defineRoute({
    method: 'GET', url: '/brindes', summary: 'Brindes: itens com estoque e custo, kits com custo e categoria, fornecedores', ...READ,
    handler: async ({ app, auth }) => {
      const t = auth.tenantId;
      const [items, kits, categories, suppliers, purchases] = await Promise.all([
        itemsOf(app.db, t),
        app.db.select().from(s.giftKits).where(eq(s.giftKits.tenantId, t)).orderBy(asc(s.giftKits.name)),
        app.db.select().from(s.giftKitCategories).where(eq(s.giftKitCategories.tenantId, t)).orderBy(asc(s.giftKitCategories.name)),
        app.db.select({ id: s.suppliers.id, name: s.suppliers.name, phone: s.suppliers.phone, email: s.suppliers.email, active: s.suppliers.active }).from(s.suppliers).where(eq(s.suppliers.tenantId, t)).orderBy(asc(s.suppliers.name)),
        app.db.select({ supplierId: s.giftMovements.supplierId, qty: sql<number>`sum(${s.giftMovements.qty})::int`, cents: sql<number>`sum(${s.giftMovements.qty} * ${s.giftMovements.unitCostCents})::bigint`, last: sql<string>`max(${s.giftMovements.createdAt})` })
          .from(s.giftMovements).where(and(eq(s.giftMovements.tenantId, t), eq(s.giftMovements.kind, 'entrada'))).groupBy(s.giftMovements.supplierId),
      ]);
      const cat = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null;
      const sup = (id: string | null) => suppliers.find((x) => x.id === id)?.name ?? null;
      return {
        items: items.map((i) => ({ ...i, supplierName: sup(i.supplierId), low: i.active && i.stock <= i.minStock })),
        kits: kits.map((k) => { const c = kitCost(k.items, items); return { id: k.id, name: k.name, categoryId: k.categoryId, categoryName: cat(k.categoryId), active: k.active, items: c.detail, costCents: c.cents, available: kitsAvailable(k.items, items) }; }),
        categories,
        suppliers: suppliers.map((x) => { const p = purchases.find((q) => q.supplierId === x.id); return { ...x, purchasedQty: p?.qty ?? 0, purchasedCents: Number(p?.cents ?? 0), lastPurchaseAt: p?.last ?? null, items: items.filter((i) => i.supplierId === x.id).map((i) => i.name) }; }),
      };
    },
  }),

  // ------------------------------------------------------------------ cadastros
  defineRoute({
    method: 'POST', url: '/brindes/categorias', summary: 'Nova categoria de kit', ...WRITE, body: z.object({ name: z.string().trim().min(2).max(60) }),
    handler: async ({ app, auth, body, reply }) => {
      const [c] = await app.db.insert(s.giftKitCategories).values({ tenantId: auth.tenantId, name: body.name }).returning().catch((e) => dup(e, 'categoria'));
      reply.code(201);
      return c;
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/fornecedores', summary: 'Cadastra fornecedor (o mesmo cadastro de Recursos e Orçamento)', ...WRITE,
    body: z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(40).nullable().optional(), email: z.string().trim().email().max(200).nullable().optional().or(z.literal('')) }),
    handler: async ({ app, auth, body, reply }) => {
      const [f] = await app.db.insert(s.suppliers).values({ tenantId: auth.tenantId, name: body.name, phone: body.phone || null, email: body.email || null, category: 'Brindes' }).returning();
      reply.code(201);
      return f;
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/itens', summary: 'Novo item (custo por unidade, fornecedor, estoque mínimo; estoque inicial vira uma entrada)', ...WRITE,
    body: z.object({ name: z.string().trim().min(2).max(120), supplierId: z.string().uuid().nullable().optional(), unitCostCents: z.number().int().min(0), minStock: z.number().int().min(0).default(0), initialStock: z.number().int().min(0).default(0) }),
    handler: async ({ app, auth, body, reply }) => {
      await sameTenant(app.db, auth, { supplierId: body.supplierId });
      const it = await app.db.transaction(async (tx) => {
        const [i] = await tx.insert(s.giftItems).values({ tenantId: auth.tenantId, name: body.name, supplierId: body.supplierId ?? null, unitCostCents: body.unitCostCents, minStock: body.minStock, stock: body.initialStock }).returning().catch((e) => dup(e, 'item'));
        if (body.initialStock) await tx.insert(s.giftMovements).values({ tenantId: auth.tenantId, itemId: i!.id, kind: 'entrada', qty: body.initialStock, unitCostCents: body.unitCostCents, supplierId: body.supplierId ?? null, note: 'Estoque inicial', actorId: auth.userId });
        return i!;
      });
      reply.code(201);
      return it;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/brindes/itens/:id', summary: 'Altera item (nome, fornecedor, custo, mínimo, ativo)', ...WRITE, params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(120).optional(), supplierId: z.string().uuid().nullable().optional(), unitCostCents: z.number().int().min(0).optional(), minStock: z.number().int().min(0).optional(), active: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => {
      await sameTenant(app.db, auth, { supplierId: body.supplierId });
      const [i] = await app.db.update(s.giftItems).set({ ...body, updatedAt: new Date() }).where(and(eq(s.giftItems.id, params.id), eq(s.giftItems.tenantId, auth.tenantId))).returning().catch((e) => dup(e, 'item'));
      if (!i) throw notFound('Item não encontrado.');
      return i;
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/itens/:id/movimento', summary: 'Entrada (compra: quantidade, custo e fornecedor; atualiza o custo médio) ou ajuste de estoque (com motivo)', ...WRITE, params: IdParams,
    body: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('entrada'), qty: z.number().int().min(1).max(1_000_000), unitCostCents: z.number().int().min(0), supplierId: z.string().uuid().nullable().optional(), note: z.string().trim().max(300).nullable().optional() }),
      z.object({ kind: z.literal('ajuste'), qty: z.number().int().refine((n) => n !== 0, 'Informe a diferença'), note: z.string().trim().min(5, 'Explique o ajuste').max(300) }),
    ]),
    handler: async ({ app, auth, params, body }) => {
      if (body.kind === 'entrada') await sameTenant(app.db, auth, { supplierId: body.supplierId });
      return app.db.transaction(async (tx) => {
        await lock(tx, auth.tenantId);
        const [i] = await tx.select().from(s.giftItems).where(and(eq(s.giftItems.id, params.id), eq(s.giftItems.tenantId, auth.tenantId)));
        if (!i) throw notFound('Item não encontrado.');
        const stock = i.stock + body.qty;
        if (stock < 0) throw unprocessable(`O estoque de ${i.name} é ${i.stock}: o ajuste deixaria negativo.`);
        const cost = body.kind === 'entrada' ? weightedCost(i.stock, i.unitCostCents, body.qty, body.unitCostCents) : i.unitCostCents;
        await tx.insert(s.giftMovements).values({ tenantId: auth.tenantId, itemId: i.id, kind: body.kind, qty: body.qty, unitCostCents: body.kind === 'entrada' ? body.unitCostCents : i.unitCostCents, supplierId: body.kind === 'entrada' ? body.supplierId ?? i.supplierId : null, note: body.note ?? null, actorId: auth.userId });
        const [u] = await tx.update(s.giftItems).set({ stock, unitCostCents: cost, ...(body.kind === 'entrada' && body.supplierId ? { supplierId: body.supplierId } : {}), updatedAt: new Date() }).where(eq(s.giftItems.id, i.id)).returning();
        return u;
      });
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/kits', summary: 'Novo kit (itens e quantidades, categoria)', ...WRITE,
    body: z.object({ name: z.string().trim().min(2).max(120), categoryId: z.string().uuid().nullable().optional(), items: z.array(Line).min(1, 'Coloque ao menos um item').max(50) }),
    handler: async ({ app, auth, body, reply }) => {
      await sameTenant(app.db, auth, { categoryId: body.categoryId, itemIds: body.items.map((l) => l.itemId) });
      const [k] = await app.db.insert(s.giftKits).values({ tenantId: auth.tenantId, name: body.name, categoryId: body.categoryId ?? null, items: body.items }).returning().catch((e) => dup(e, 'kit'));
      reply.code(201);
      return k;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/brindes/kits/:id', summary: 'Altera kit (envios já feitos guardam a composição e o custo da época)', ...WRITE, params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(120).optional(), categoryId: z.string().uuid().nullable().optional(), items: z.array(Line).min(1).max(50).optional(), active: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => {
      await sameTenant(app.db, auth, { categoryId: body.categoryId, itemIds: body.items?.map((l) => l.itemId) });
      const [k] = await app.db.update(s.giftKits).set({ ...body, updatedAt: new Date() }).where(and(eq(s.giftKits.id, params.id), eq(s.giftKits.tenantId, auth.tenantId))).returning().catch((e) => dup(e, 'kit'));
      if (!k) throw notFound('Kit não encontrado.');
      return k;
    },
  }),

  // ------------------------------------------------------------------ envios
  defineRoute({
    method: 'GET', url: '/brindes/envios', summary: 'Envios no período (todas as contas visíveis em Marketing)', ...READ,
    query: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
    handler: async ({ app, auth, query }) => {
      const conds = [eq(s.giftDeliveries.tenantId, auth.tenantId)];
      if (query.from) conds.push(gte(s.giftDeliveries.occurredOn, query.from));
      if (query.to) conds.push(lte(s.giftDeliveries.occurredOn, query.to));
      const rows = await app.db.select({ d: s.giftDeliveries, account: s.contacts.name, by: s.users.name }).from(s.giftDeliveries).innerJoin(s.contacts, eq(s.contacts.id, s.giftDeliveries.contactId)).leftJoin(s.users, eq(s.users.id, s.giftDeliveries.createdBy)).where(and(...conds)).orderBy(desc(s.giftDeliveries.occurredOn), desc(s.giftDeliveries.createdAt)).limit(500);
      return { items: rows.map(({ d, account, by }) => ({ id: d.id, contactId: d.contactId, account, occurredOn: d.occurredOn, kitName: d.kitName, categoryName: d.categoryName, kits: d.kits, items: d.items, totalCents: d.totalCents, recipients: d.stakeholderIds.length, by, cancelled: !!d.cancelledAt, cancelReason: d.cancelReason })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/envios', summary: 'Registra envio de kit (e/ou itens avulsos) para a conta e os stakeholders que receberam; baixa o estoque', ...WRITE,
    body: z.object({
      contactId: z.string().uuid(), kitId: z.string().uuid().nullable().optional(), kits: z.number().int().min(0).max(10_000).default(1),
      extra: z.array(Line).max(50).default([]), stakeholderIds: z.array(z.string().uuid()).max(200).default([]),
      occurredOn: isoDate.optional(), note: z.string().trim().max(500).nullable().optional(),
    }),
    handler: async ({ app, auth, body, reply }) => {
      await assertAccount(app.db, auth, body.contactId);
      if (!body.kitId && !body.extra.length) throw unprocessable('Escolha um kit ou itens avulsos.');
      if (body.kitId && body.kits < 1) throw unprocessable('Informe quantos kits.');
      if (body.stakeholderIds.length) {
        const ok = await app.db.select({ id: s.accountStakeholders.id }).from(s.accountStakeholders).where(and(inArray(s.accountStakeholders.id, body.stakeholderIds), eq(s.accountStakeholders.contactId, body.contactId)));
        if (ok.length !== new Set(body.stakeholderIds).size) throw unprocessable('Escolha stakeholders desta conta.');
      }
      const d = await app.db.transaction(async (tx) => {
        await lock(tx, auth.tenantId);
        const [kit] = body.kitId ? await tx.select().from(s.giftKits).where(and(eq(s.giftKits.id, body.kitId), eq(s.giftKits.tenantId, auth.tenantId))) : [];
        if (body.kitId && (!kit || !kit.active)) throw unprocessable('Kit não encontrado ou inativo.');
        const [cat] = kit?.categoryId ? await tx.select({ name: s.giftKitCategories.name }).from(s.giftKitCategories).where(eq(s.giftKitCategories.id, kit.categoryId)) : [];
        const items = await itemsOf(tx, auth.tenantId);
        const needs = deliveryNeeds(kit?.items ?? null, kit ? body.kits : 0, body.extra);
        if (needs.some((n) => !items.some((i) => i.id === n.itemId))) throw unprocessable('Item não encontrado.');
        const short = stockShortages(needs, items);
        if (short.length) throw unprocessable(`Estoque insuficiente: ${short.map((x) => `${x.name} (precisa ${x.need}, tem ${x.stock})`).join('; ')}.`);
        const lines = needs.map((n) => { const i = items.find((x) => x.id === n.itemId)!; return { itemId: i.id, name: i.name, qty: n.qty, unitCostCents: i.unitCostCents }; });
        const total = lines.reduce((t, l) => t + l.qty * l.unitCostCents, 0);
        const [row] = await tx.insert(s.giftDeliveries).values({ tenantId: auth.tenantId, contactId: body.contactId, kitId: kit?.id ?? null, kitName: kit?.name ?? null, categoryName: cat?.name ?? null, kits: kit ? body.kits : 0, items: lines, totalCents: total, stakeholderIds: [...new Set(body.stakeholderIds)], occurredOn: body.occurredOn ?? today(), note: body.note ?? null, createdBy: auth.userId }).returning();
        for (const l of lines) {
          await tx.insert(s.giftMovements).values({ tenantId: auth.tenantId, itemId: l.itemId, kind: 'saida', qty: -l.qty, unitCostCents: l.unitCostCents, deliveryId: row!.id, actorId: auth.userId });
          await tx.update(s.giftItems).set({ stock: sql`${s.giftItems.stock} - ${l.qty}`, updatedAt: new Date() }).where(eq(s.giftItems.id, l.itemId));
        }
        return row!;
      });
      reply.code(201);
      return d;
    },
  }),
  defineRoute({
    method: 'POST', url: '/brindes/envios/:id/cancelar', summary: 'Cancela envio (devolve os itens ao estoque; o envio fica no histórico como cancelado)', ...WRITE, params: IdParams,
    body: z.object({ reason: z.string().trim().min(5, 'Explique o cancelamento').max(300) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      await lock(tx, auth.tenantId);
      const [d] = await tx.select().from(s.giftDeliveries).where(and(eq(s.giftDeliveries.id, params.id), eq(s.giftDeliveries.tenantId, auth.tenantId), isNull(s.giftDeliveries.cancelledAt)));
      if (!d) throw notFound('Envio não encontrado ou já cancelado.');
      await assertAccount(tx, auth, d.contactId);
      for (const l of d.items) {
        await tx.insert(s.giftMovements).values({ tenantId: auth.tenantId, itemId: l.itemId, kind: 'devolucao', qty: l.qty, unitCostCents: l.unitCostCents, deliveryId: d.id, note: body.reason, actorId: auth.userId });
        await tx.update(s.giftItems).set({ stock: sql`${s.giftItems.stock} + ${l.qty}`, updatedAt: new Date() }).where(eq(s.giftItems.id, l.itemId));
      }
      const [u] = await tx.update(s.giftDeliveries).set({ cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: body.reason }).where(eq(s.giftDeliveries.id, d.id)).returning();
      return u;
    }),
  }),

  // ------------------------------------------------------------------ consumo e conta
  defineRoute({
    method: 'GET', url: '/brindes/consumo', summary: 'Consumo no período: por item, por kit, por categoria e por conta; compras por fornecedor', ...READ,
    query: z.object({ from: isoDate, to: isoDate }),
    handler: async ({ app, auth, query }) => {
      const t = auth.tenantId;
      const dels = await app.db.select({ d: s.giftDeliveries, account: s.contacts.name }).from(s.giftDeliveries).innerJoin(s.contacts, eq(s.contacts.id, s.giftDeliveries.contactId))
        .where(and(eq(s.giftDeliveries.tenantId, t), isNull(s.giftDeliveries.cancelledAt), gte(s.giftDeliveries.occurredOn, query.from), lte(s.giftDeliveries.occurredOn, query.to)));
      const c = giftConsolidated(dels.map(({ d }) => ({ ...d, cancelled: false })));
      const acc = new Map<string, { contactId: string; name: string; deliveries: number; kits: number; totalCents: number }>();
      for (const { d, account } of dels) { const a = acc.get(d.contactId) ?? { contactId: d.contactId, name: account, deliveries: 0, kits: 0, totalCents: 0 }; a.deliveries += 1; a.kits += d.kits; a.totalCents += d.totalCents; acc.set(d.contactId, a); }
      const buys = await app.db.select({ supplierId: s.giftMovements.supplierId, name: s.suppliers.name, qty: sql<number>`sum(${s.giftMovements.qty})::int`, cents: sql<number>`sum(${s.giftMovements.qty} * ${s.giftMovements.unitCostCents})::bigint` })
        .from(s.giftMovements).leftJoin(s.suppliers, eq(s.suppliers.id, s.giftMovements.supplierId))
        .where(and(eq(s.giftMovements.tenantId, t), eq(s.giftMovements.kind, 'entrada'), sql`${s.giftMovements.createdAt}::date between ${query.from} and ${query.to}`)).groupBy(s.giftMovements.supplierId, s.suppliers.name);
      return {
        totalCents: c.totalCents, kits: c.kits, deliveries: c.deliveries, accounts: acc.size,
        byItem: c.byItem, byKit: c.byKit, byCategory: c.byCategory,
        byAccount: [...acc.values()].sort((a, b) => b.totalCents - a.totalCents),
        purchases: buys.map((b) => ({ supplierId: b.supplierId, name: b.name ?? 'Sem fornecedor', qty: b.qty, totalCents: Number(b.cents) })).sort((a, b) => b.totalCents - a.totalCents),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/accounts/:id/brindes', summary: 'Brindes da conta: total gasto, por kit, por item, por stakeholder e os envios', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      return accountGifts(app.db, auth.tenantId, params.id);
    },
  }),
  defineRoute({
    method: 'GET', url: '/stakeholders/:id/brindes', summary: 'Brindes que o stakeholder recebeu', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [st] = await app.db.select({ contactId: s.accountStakeholders.contactId }).from(s.accountStakeholders).where(and(eq(s.accountStakeholders.id, params.id), eq(s.accountStakeholders.tenantId, auth.tenantId)));
      if (!st) throw notFound('Stakeholder não encontrado.');
      await assertAccount(app.db, auth, st.contactId);
      const all = await accountGifts(app.db, auth.tenantId, st.contactId);
      const mine = all.deliveries.filter((d) => d.stakeholderIds.includes(params.id));
      return { deliveries: mine, totalKits: mine.filter((d) => !d.cancelled).reduce((t, d) => t + d.kits, 0) };
    },
  }),
];
