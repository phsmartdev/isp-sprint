/**
 * Recursos e Orçamento — ferramentas e equipamentos, softwares e licenças, contratos e assinaturas, compras e fornecedores.
 * Licenças: credenciais NÃO ficam aqui (política 9: cofre corporativo/Vault); registra-se que está no Vault e a referência.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ASSET_CATEGORIES, ASSET_STATUS, CURRENCIES, PAYMENT_METHODS, PURCHASE_KINDS, PURCHASE_STATUS, RESOURCE_KINDS, RESOURCE_PERIODS, bookValueCents, monthlyBrlCents, purchasePending } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { brl } from '../services/email';
import { costCentersOf, isBudgetAdmin, loadCostCenter, logBudget } from '../services/budget';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const uuid = z.string().uuid();
const M = { module: 'orcamento' as const };
const today = () => new Date().toISOString().slice(0, 10);

const SupplierBody = z.object({ name: z.string().trim().min(2).max(160), document: z.string().trim().max(30).nullable().optional(), category: z.string().trim().max(80).nullable().optional(), email: z.string().trim().email().max(160).nullable().optional().or(z.literal('').transform(() => null)), phone: z.string().trim().max(40).nullable().optional(), notes: z.string().trim().max(1000).nullable().optional(), active: z.boolean().optional() });
const AssetBody = z.object({
  costCenterId: uuid, accountId: uuid.nullable().optional(), name: z.string().trim().min(2).max(160), tag: z.string().trim().max(60).nullable().optional(), serial: z.string().trim().max(80).nullable().optional(),
  category: z.enum(ASSET_CATEGORIES).default('outro'), holderId: uuid.nullable().optional(), supplierId: uuid.nullable().optional(), acquiredOn: day, valueCents: z.number().int().min(0).max(10_000_000_000),
  usefulLifeMonths: z.number().int().min(1).max(240).nullable().optional(), status: z.enum(ASSET_STATUS).default('em_uso'), notes: z.string().trim().max(1000).nullable().optional(),
});
const ResourceBody = z.object({
  kind: z.enum(RESOURCE_KINDS), costCenterId: uuid, accountId: uuid.nullable().optional(), supplierId: uuid.nullable().optional(), name: z.string().trim().min(2).max(160), object: z.string().trim().max(1000).nullable().optional(),
  seats: z.number().int().min(1).max(100_000).nullable().optional(), currency: z.enum(CURRENCIES).default('BRL'), amountCents: z.number().int().min(0).max(10_000_000_000), fxRate: z.number().positive().max(100).nullable().optional(),
  period: z.enum(RESOURCE_PERIODS).default('mensal'), startOn: day, endOn: day.nullable().optional(), renewalOn: day.nullable().optional(), paymentDay: z.number().int().min(1).max(31).nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(), vaultRegistered: z.boolean().default(false), vaultRef: z.string().trim().max(200).nullable().optional(), ownerId: uuid.nullable().optional(),
  legalReviewed: z.boolean().default(false), directorSigned: z.boolean().default(false), reviewOn: day.nullable().optional(), notes: z.string().trim().max(2000).nullable().optional(),
});
const QuoteBody = z.object({ supplier: z.string().trim().min(2).max(160), amountCents: z.number().int().positive().max(10_000_000_000), deliveryDays: z.number().int().min(0).max(365).nullable().default(null), note: z.string().trim().max(500).nullable().default(null), chosen: z.boolean().default(false) });
const PurchaseBody = z.object({
  costCenterId: uuid, accountId: uuid.nullable().optional(), lineId: uuid.nullable().optional(), title: z.string().trim().min(3).max(160), specification: z.string().trim().min(10, 'Envie as especificações completas para Compras').max(4000),
  kind: z.enum(PURCHASE_KINDS).default('consumo'), estimatedCents: z.number().int().positive().max(10_000_000_000), neededBy: day.nullable().optional(),
});

/** Bloqueia texto que pareça senha/credencial nos campos livres das licenças (a credencial fica só no cofre). */
function noSecrets(...texts: (string | null | undefined)[]) {
  if (texts.some((t) => t && /(senha|password|passwd|pwd)\s*[:=]/i.test(t))) throw unprocessable('Não registre senha aqui. Credenciais ficam só no cofre de senhas corporativo (Vault); informe apenas a referência.');
}

export const budgetResourceRoutes = [
  // ------------------------------------------------------------------ fornecedores
  defineRoute({
    method: 'GET', url: '/budget/suppliers', summary: 'Fornecedores', tag: 'Orçamento', ...M,
    handler: async ({ app, auth }) => ({ items: await app.db.select().from(s.suppliers).where(eq(s.suppliers.tenantId, auth.tenantId)).orderBy(asc(s.suppliers.name)) }),
  }),
  defineRoute({
    method: 'POST', url: '/budget/suppliers', summary: 'Cadastra fornecedor', tag: 'Orçamento', ...M, body: SupplierBody,
    handler: async ({ app, auth, body, reply }) => {
      const [f] = await app.db.insert(s.suppliers).values({ tenantId: auth.tenantId, ...body, email: body.email || null }).returning();
      await logBudget(app.db, auth, null, 'fornecedor', f!.id, 'criado', `Fornecedor ${f!.name} cadastrado.`);
      reply.code(201);
      return f;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/budget/suppliers/:id', summary: 'Altera fornecedor', tag: 'Orçamento', ...M, params: IdParams, body: SupplierBody.partial(),
    handler: async ({ app, auth, params, body }) => {
      const [f] = await app.db.update(s.suppliers).set({ ...body, updatedAt: new Date() }).where(and(eq(s.suppliers.id, params.id), eq(s.suppliers.tenantId, auth.tenantId))).returning();
      if (!f) throw notFound();
      return f;
    },
  }),

  // ------------------------------------------------------------------ ferramentas e equipamentos
  defineRoute({
    method: 'GET', url: '/budget/assets', summary: 'Ferramentas e equipamentos dos centros visíveis, com valor contábil (depreciação linear)', tag: 'Orçamento', ...M,
    query: z.object({ costCenterId: uuid.optional() }),
    handler: async ({ app, auth, query }) => {
      const ccs = (await costCentersOf(app.db, auth, true)).filter((c) => !query.costCenterId || c.id === query.costCenterId);
      if (!ccs.length) return { items: [] };
      const rows = await app.db.select({ a: s.resourceAssets, holder: s.users.name }).from(s.resourceAssets).leftJoin(s.users, eq(s.users.id, s.resourceAssets.holderId)).where(inArray(s.resourceAssets.costCenterId, ccs.map((c) => c.id))).orderBy(asc(s.resourceAssets.name));
      return { items: rows.map((r) => ({ ...r.a, holderName: r.holder, bookValueCents: bookValueCents(r.a.valueCents, r.a.acquiredOn, r.a.usefulLifeMonths, today()) })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/assets', summary: 'Cadastra ferramenta ou equipamento', tag: 'Orçamento', ...M, body: AssetBody,
    handler: async ({ app, auth, body, reply }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      const [a] = await app.db.insert(s.resourceAssets).values({ tenantId: auth.tenantId, ...body, createdBy: auth.userId }).returning();
      await logBudget(app.db, auth, cc.id, 'ativo', a!.id, 'criado', `${cc.code}: ${a!.name}${a!.tag ? ` (${a!.tag})` : ''} cadastrado, ${brl(a!.valueCents)}.`);
      reply.code(201);
      return a;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/budget/assets/:id', summary: 'Altera responsável, situação (em uso, estoque, manutenção, baixado) e dados do equipamento', tag: 'Orçamento', ...M, params: IdParams, body: AssetBody.partial(),
    handler: async ({ app, auth, params, body }) => {
      const [cur] = await app.db.select().from(s.resourceAssets).where(and(eq(s.resourceAssets.id, params.id), eq(s.resourceAssets.tenantId, auth.tenantId))).limit(1);
      if (!cur) throw notFound();
      const cc = await loadCostCenter(app.db, auth, cur.costCenterId);
      if (body.costCenterId) await loadCostCenter(app.db, auth, body.costCenterId);
      const [a] = await app.db.update(s.resourceAssets).set({ ...body, updatedAt: new Date() }).where(eq(s.resourceAssets.id, cur.id)).returning();
      const what = [body.status && body.status !== cur.status && `situação ${cur.status} → ${body.status}`, body.holderId !== undefined && body.holderId !== cur.holderId && 'responsável alterado', body.costCenterId && body.costCenterId !== cur.costCenterId && 'centro de custo alterado'].filter(Boolean).join('; ');
      await logBudget(app.db, auth, cc.id, 'ativo', cur.id, 'alterado', `${cc.code}: ${cur.name} — ${what || 'dados alterados'}.`);
      return a;
    },
  }),

  // ------------------------------------------------------------------ softwares, licenças, contratos e assinaturas
  defineRoute({
    method: 'GET', url: '/budget/resources', summary: 'Softwares e licenças (kind=software) ou contratos e assinaturas (kind=contratos), com custo mensal em reais e pendências', tag: 'Orçamento', ...M,
    query: z.object({ kind: z.enum(['software', 'contratos']), costCenterId: uuid.optional() }),
    handler: async ({ app, auth, query }) => {
      const ccs = (await costCentersOf(app.db, auth, true)).filter((c) => !query.costCenterId || c.id === query.costCenterId);
      if (!ccs.length) return { items: [] };
      const kinds = query.kind === 'software' ? ['software'] : ['contrato', 'assinatura'];
      const rows = await app.db.select({ r: s.resourceContracts, owner: s.users.name, supplier: s.suppliers.name }).from(s.resourceContracts).leftJoin(s.users, eq(s.users.id, s.resourceContracts.ownerId)).leftJoin(s.suppliers, eq(s.suppliers.id, s.resourceContracts.supplierId))
        .where(and(inArray(s.resourceContracts.costCenterId, ccs.map((c) => c.id)), inArray(s.resourceContracts.kind, kinds))).orderBy(asc(s.resourceContracts.status), asc(s.resourceContracts.name));
      const t = today();
      return {
        items: rows.map(({ r, owner, supplier }) => {
          const pend: string[] = [];
          if (r.kind === 'software' && !r.vaultRegistered) pend.push('Registrar no cofre de senhas (Vault)');
          if (!r.paymentMethod) pend.push('Informar forma de pagamento');
          if (r.kind !== 'software' && !r.legalReviewed) pend.push('Análise do Jurídico');
          if (r.kind !== 'software' && !r.directorSigned) pend.push('Assinatura da Diretoria');
          if (r.reviewOn && r.reviewOn <= t && r.status === 'ativo') pend.push('Avaliar continuidade');
          if (r.currency === 'USD' && !r.fxRate) pend.push('Informar cotação do dólar');
          return { ...r, ownerName: owner, supplierName: supplier, monthlyBrlCents: monthlyBrlCents({ amountCents: r.amountCents, currency: r.currency as 'BRL', fxRate: r.fxRate, period: r.period as 'mensal' }), pending: r.status === 'ativo' ? pend : [], renewsSoon: !!r.renewalOn && r.renewalOn >= t && r.renewalOn <= new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10) };
        }),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/resources', summary: 'Cadastra software/licença, contrato de serviço ou assinatura (sem credenciais)', tag: 'Orçamento', ...M, body: ResourceBody,
    handler: async ({ app, auth, body, req, reply }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      noSecrets(body.notes, body.vaultRef, body.object);
      if (body.currency === 'USD' && !body.fxRate) throw unprocessable('Informe a cotação do dólar usada no planejamento.', [{ path: 'fxRate', message: 'Obrigatório em dólar' }]);
      if (body.vaultRegistered && !body.vaultRef) throw unprocessable('Informe a referência do registro no Vault (nome da pasta/entrada, sem a senha).', [{ path: 'vaultRef', message: 'Obrigatório' }]);
      const [r] = await app.db.insert(s.resourceContracts).values({ tenantId: auth.tenantId, ...body, ownerId: body.ownerId ?? auth.userId, createdBy: auth.userId }).returning();
      await logBudget(app.db, auth, cc.id, body.kind, r!.id, 'criado', `${cc.code}: ${r!.name} cadastrado (${r!.currency === 'USD' ? 'US$' : 'R$'} ${(r!.amountCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${r!.period}).`);
      await audit(app.db, req, { action: 'budget.resource.create', entityType: 'resource_contract', entityId: r!.id });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/budget/resources/:id', summary: 'Atualiza valor, cotação, forma de pagamento, Vault, revisão ou situação', tag: 'Orçamento', ...M, params: IdParams,
    body: ResourceBody.partial().extend({ status: z.enum(['ativo', 'suspenso', 'cancelado']).optional(), cancelReason: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => {
      const [cur] = await app.db.select().from(s.resourceContracts).where(and(eq(s.resourceContracts.id, params.id), eq(s.resourceContracts.tenantId, auth.tenantId))).limit(1);
      if (!cur) throw notFound();
      const cc = await loadCostCenter(app.db, auth, cur.costCenterId);
      noSecrets(body.notes, body.vaultRef, body.object);
      if (body.status === 'cancelado' && !body.cancelReason) throw unprocessable('Informe o motivo do cancelamento (uso e retorno da solução).', [{ path: 'cancelReason', message: 'Obrigatório' }]);
      const [r] = await app.db.update(s.resourceContracts).set({ ...body, ...(body.status === 'cancelado' ? { cancelledAt: new Date() } : {}), updatedAt: new Date() }).where(eq(s.resourceContracts.id, cur.id)).returning();
      const changes = [body.amountCents !== undefined && body.amountCents !== cur.amountCents && `valor ${(cur.amountCents / 100).toFixed(2)} → ${(body.amountCents / 100).toFixed(2)}`, body.status && body.status !== cur.status && `situação ${cur.status} → ${body.status}${body.cancelReason ? ` (${body.cancelReason})` : ''}`, body.vaultRegistered !== undefined && body.vaultRegistered !== cur.vaultRegistered && (body.vaultRegistered ? 'registrado no Vault' : 'retirado do Vault'), body.paymentMethod !== undefined && body.paymentMethod !== cur.paymentMethod && 'forma de pagamento alterada'].filter(Boolean).join('; ');
      await logBudget(app.db, auth, cc.id, cur.kind, cur.id, 'alterado', `${cc.code}: ${cur.name} — ${changes || 'dados alterados'}.`);
      return r;
    },
  }),

  // ------------------------------------------------------------------ compras
  defineRoute({
    method: 'GET', url: '/budget/purchases', summary: 'Pedidos de compra com o que falta pela política (Financeiro, cotação, Jurídico, Diretoria)', tag: 'Orçamento', ...M,
    query: z.object({ costCenterId: uuid.optional() }),
    handler: async ({ app, auth, query }) => {
      const ccs = (await costCentersOf(app.db, auth, true)).filter((c) => !query.costCenterId || c.id === query.costCenterId);
      if (!ccs.length) return { items: [] };
      const rows = await app.db.select({ p: s.purchaseRequests, requester: s.users.name }).from(s.purchaseRequests).leftJoin(s.users, eq(s.users.id, s.purchaseRequests.requestedBy)).where(inArray(s.purchaseRequests.costCenterId, ccs.map((c) => c.id))).orderBy(desc(s.purchaseRequests.createdAt));
      return { items: rows.map(({ p, requester }) => ({ ...p, requesterName: requester, pending: ['cancelado', 'recebido', 'comprado'].includes(p.status) ? [] : purchasePending({ kind: p.kind as 'consumo', financeCheck: p.financeCheck, legalReview: p.legalReview, directorSigned: p.directorSigned || !!p.directorRelease, quotes: p.quotes.length }) })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/purchases', summary: 'Abre pedido de compra (especificação completa)', tag: 'Orçamento', ...M, body: PurchaseBody,
    handler: async ({ app, auth, body, reply }) => {
      const cc = await loadCostCenter(app.db, auth, body.costCenterId);
      const [p] = await app.db.insert(s.purchaseRequests).values({ tenantId: auth.tenantId, ...body, requestedBy: auth.userId }).returning();
      await logBudget(app.db, auth, cc.id, 'compra', p!.id, 'solicitada', `${cc.code}: pedido de compra “${p!.title}” (estimado ${brl(p!.estimatedCents)}).`);
      reply.code(201);
      return p;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/budget/purchases/:id', summary: 'Andamento da compra: cotações, checagens, fornecedor escolhido e situação', tag: 'Orçamento', ...M, params: IdParams,
    body: z.object({
      status: z.enum(PURCHASE_STATUS).optional(), quotes: z.array(QuoteBody).max(10).optional(), supplierId: uuid.nullable().optional(), financeCheck: z.boolean().optional(), legalReview: z.boolean().optional(),
      directorSigned: z.boolean().optional(), directorRelease: z.string().trim().max(500).nullable().optional(), specification: z.string().trim().min(10).max(4000).optional(), estimatedCents: z.number().int().positive().optional(),
    }),
    handler: async ({ app, auth, params, body }) => {
      const [cur] = await app.db.select().from(s.purchaseRequests).where(and(eq(s.purchaseRequests.id, params.id), eq(s.purchaseRequests.tenantId, auth.tenantId))).limit(1);
      if (!cur) throw notFound();
      const cc = await loadCostCenter(app.db, auth, cur.costCenterId);
      if ((body.directorSigned !== undefined && body.directorSigned !== cur.directorSigned) && !isBudgetAdmin(auth)) throw unprocessable('Só a Diretoria marca a assinatura. Sem ela, registre a liberação por escrito (e-mail ou WhatsApp).');
      const next = { ...cur, ...body };
      if (body.status && ['comprado', 'recebido'].includes(body.status)) {
        const pend = purchasePending({ kind: next.kind as 'consumo', financeCheck: next.financeCheck, legalReview: next.legalReview, directorSigned: next.directorSigned || !!next.directorRelease, quotes: next.quotes.length });
        if (pend.length) throw unprocessable(`Antes de comprar, falta: ${pend.join('; ')}.`);
      }
      if (body.quotes && body.quotes.filter((q) => q.chosen).length > 1) throw unprocessable('Escolha uma cotação só.');
      const [p] = await app.db.update(s.purchaseRequests).set({ ...body, updatedAt: new Date() }).where(eq(s.purchaseRequests.id, cur.id)).returning();
      const changes = [body.status && body.status !== cur.status && `situação ${cur.status} → ${body.status}`, body.quotes && `${body.quotes.length} cotação(ões)`, body.financeCheck && !cur.financeCheck && 'checagem com o Financeiro feita', body.legalReview && !cur.legalReview && 'Jurídico analisou', body.directorSigned && !cur.directorSigned && 'assinado pela Diretoria', body.directorRelease && 'liberação por escrito registrada'].filter(Boolean).join('; ');
      await logBudget(app.db, auth, cc.id, 'compra', cur.id, 'alterada', `${cc.code}: compra “${cur.title}” — ${changes || 'dados alterados'}.`);
      return p;
    },
  }),
];
