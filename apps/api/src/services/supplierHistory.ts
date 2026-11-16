/**
 * Ficha do fornecedor: o que já compramos dele, como, com que frequência, a que custo e o que ele tem de vantagem.
 * Só registros do sistema (lançamentos do orçamento contratados, pedidos de compra, entradas de brinde, contratos,
 * equipamentos, despesas e pagamentos). Nada é estimado: o que não existe aparece como "sem dado".
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export type SupplierPurchase = {
  kind: 'orcamento' | 'pedido' | 'brinde' | 'despesa' | 'contrato' | 'equipamento';
  on: string; /** data e hora do registro (desempate de compras no mesmo dia) */ at: string; what: string; qty: number | null; unitCents: number | null; amountCents: number; how: string; ref: string | null;
  /** referência para comparar (cotação ou aprovado) e a economia em relação a ela */
  referenceCents: number | null; deliveryDays: number | null;
};
export const PURCHASE_KIND_LABELS: Record<SupplierPurchase['kind'], string> = {
  orcamento: 'Lançamento do orçamento', pedido: 'Pedido de compra', brinde: 'Entrada de brinde no estoque', despesa: 'Despesa lançada', contrato: 'Contrato / assinatura', equipamento: 'Equipamento',
};

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Onde o fornecedor é usado (para bloquear a exclusão). */
export async function supplierUsage(db: DbOrTx, tenantId: string, id: string) {
  const c = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const [lines, payables, expenses, assets, contracts, purchases, gifts, moves] = await Promise.all([
    c(db.select({ n }).from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, tenantId), eq(s.budgetLines.supplierId, id), isNull(s.budgetLines.deletedAt)))),
    c(db.select({ n }).from(s.budgetPayables).where(and(eq(s.budgetPayables.tenantId, tenantId), eq(s.budgetPayables.supplierId, id)))),
    c(db.select({ n }).from(s.budgetExpenses).where(and(eq(s.budgetExpenses.tenantId, tenantId), eq(s.budgetExpenses.supplierId, id)))),
    c(db.select({ n }).from(s.resourceAssets).where(and(eq(s.resourceAssets.tenantId, tenantId), eq(s.resourceAssets.supplierId, id)))),
    c(db.select({ n }).from(s.resourceContracts).where(and(eq(s.resourceContracts.tenantId, tenantId), eq(s.resourceContracts.supplierId, id)))),
    c(db.select({ n }).from(s.purchaseRequests).where(and(eq(s.purchaseRequests.tenantId, tenantId), eq(s.purchaseRequests.supplierId, id)))),
    c(db.select({ n }).from(s.giftItems).where(and(eq(s.giftItems.tenantId, tenantId), eq(s.giftItems.supplierId, id)))),
    c(db.select({ n }).from(s.giftMovements).where(and(eq(s.giftMovements.tenantId, tenantId), eq(s.giftMovements.supplierId, id)))),
  ]);
  const parts: [number, string][] = [[lines, 'lançamento(s) do orçamento'], [payables, 'título(s) a pagar'], [expenses, 'despesa(s)'], [purchases, 'pedido(s) de compra'], [contracts, 'contrato(s)/assinatura(s)'], [assets, 'equipamento(s)'], [moves, 'movimentação(ões) de estoque'], [gifts, 'brinde(s) com este fornecedor padrão']];
  const used = parts.filter(([k]) => k > 0).map(([k, l]) => `${k} ${l}`);
  return { total: parts.reduce((t, [k]) => t + k, 0), used };
}

export async function supplierHistory(db: DbOrTx, tenantId: string, id: string, today: string) {
  const [lines, purchases, moves, expenses, contracts, assets, pays] = await Promise.all([
    db.select().from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, tenantId), eq(s.budgetLines.supplierId, id), isNull(s.budgetLines.deletedAt))),
    db.select().from(s.purchaseRequests).where(and(eq(s.purchaseRequests.tenantId, tenantId), eq(s.purchaseRequests.supplierId, id))),
    db.select({ m: s.giftMovements, item: s.giftItems.name }).from(s.giftMovements).innerJoin(s.giftItems, eq(s.giftItems.id, s.giftMovements.itemId)).where(and(eq(s.giftMovements.tenantId, tenantId), eq(s.giftMovements.supplierId, id), eq(s.giftMovements.kind, 'entrada'))),
    db.select().from(s.budgetExpenses).where(and(eq(s.budgetExpenses.tenantId, tenantId), eq(s.budgetExpenses.supplierId, id))),
    db.select().from(s.resourceContracts).where(and(eq(s.resourceContracts.tenantId, tenantId), eq(s.resourceContracts.supplierId, id))),
    db.select().from(s.resourceAssets).where(and(eq(s.resourceAssets.tenantId, tenantId), eq(s.resourceAssets.supplierId, id))),
    db.select({ p: s.budgetPayments, dueOn: s.budgetPayables.dueOn }).from(s.budgetPayments).innerJoin(s.budgetPayables, eq(s.budgetPayables.id, s.budgetPayments.payableId)).where(and(eq(s.budgetPayables.tenantId, tenantId), eq(s.budgetPayables.supplierId, id))),
  ]);
  const out: SupplierPurchase[] = [];
  // 1) lançamentos do orçamento contratados com o fornecedor (a compra "oficial")
  for (const l of lines.filter((x) => x.contractedCents != null)) {
    const qty = l.contractedQtyMilli ? l.contractedQtyMilli / 1000 : null;
    const ref = l.quoteCents ?? l.approvedCents ?? null;
    const on = l.contractedOn ?? l.plannedOn ?? `${l.month}-01`;
    out.push({ kind: 'orcamento', on, at: l.updatedAt.toISOString(), what: l.what, qty, unitCents: qty ? Math.round(l.contractedCents! / qty) : null, amountCents: l.contractedCents!, how: [l.expenseType === 'recorrente' ? 'Recorrente' : 'Pontual', l.poNumber ? `pedido ${l.poNumber}` : null, l.quoteCents ? 'com cotação' : null].filter(Boolean).join(' · '), ref: l.code, referenceCents: ref, deliveryDays: l.deliveredOn && l.contractedOn ? days(l.contractedOn, l.deliveredOn) : null });
  }
  const lineIds = new Set(lines.map((l) => l.id));
  // 2) pedidos de compra comprados/recebidos (os ligados a um lançamento já contam no lançamento)
  for (const p of purchases.filter((x) => (x.status === 'comprado' || x.status === 'recebido') && !(x.lineId && lineIds.has(x.lineId)))) {
    const chosen = p.quotes.find((q) => q.chosen);
    out.push({ kind: 'pedido', on: p.updatedAt.toISOString().slice(0, 10), at: p.updatedAt.toISOString(), what: p.title, qty: null, unitCents: null, amountCents: chosen?.amountCents ?? p.estimatedCents, how: p.quotes.length > 1 ? `Cotação com ${p.quotes.length} fornecedores` : p.kind === 'especifica' ? 'Compra específica (Jurídico e Diretoria)' : 'Compra direta', ref: null, referenceCents: p.estimatedCents, deliveryDays: chosen?.deliveryDays ?? null });
  }
  // 3) entradas de brinde no estoque (as de uma compra planejada no orçamento já contam no lançamento)
  for (const x of moves.filter((m) => !(m.m.lineId && lineIds.has(m.m.lineId)))) {
    out.push({ kind: 'brinde', on: x.m.createdAt.toISOString().slice(0, 10), at: x.m.createdAt.toISOString(), what: x.item, qty: x.m.qty, unitCents: x.m.unitCostCents, amountCents: x.m.qty * x.m.unitCostCents, how: 'Entrada no estoque de brindes', ref: x.m.note, referenceCents: null, deliveryDays: null });
  }
  // 4) despesas lançadas sem lançamento do orçamento
  for (const e of expenses.filter((x) => !(x.lineId && lineIds.has(x.lineId)))) out.push({ kind: 'despesa', on: e.occurredOn, at: e.createdAt.toISOString(), what: e.description, qty: null, unitCents: null, amountCents: e.amountCents, how: e.paymentMethod ? `Despesa · ${e.paymentMethod}` : 'Despesa', ref: null, referenceCents: null, deliveryDays: null });
  // 5) contratos e assinaturas; 6) equipamentos
  for (const c of contracts) out.push({ kind: 'contrato', on: c.startOn, at: c.createdAt.toISOString(), what: c.name, qty: c.seats, unitCents: null, amountCents: c.amountCents, how: `${c.period === 'mensal' ? 'Mensal' : c.period === 'anual' ? 'Anual' : c.period}${c.currency !== 'BRL' ? ` (${c.currency})` : ''}${c.endOn ? ` até ${c.endOn.split('-').reverse().join('/')}` : ''}`, ref: null, referenceCents: null, deliveryDays: null });
  for (const a of assets) out.push({ kind: 'equipamento', on: a.acquiredOn, at: a.createdAt.toISOString(), what: a.name, qty: 1, unitCents: a.valueCents, amountCents: a.valueCents, how: 'Aquisição de equipamento', ref: null, referenceCents: null, deliveryDays: null });
  out.sort((a, b) => b.on.localeCompare(a.on) || b.at.localeCompare(a.at));

  // indicadores
  const dates = out.map((p) => p.on).sort();
  const gaps = dates.slice(1).map((d, i) => days(dates[i]!, d)).filter((g) => g >= 0);
  const total = out.reduce((t, p) => t + p.amountCents, 0);
  const year = new Date(Date.parse(`${today}T12:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const withRef = out.filter((p) => p.referenceCents != null && p.referenceCents > 0);
  const saved = withRef.reduce((t, p) => t + (p.referenceCents! - p.amountCents), 0);
  const deliveries = out.map((p) => p.deliveryDays).filter((d): d is number => d != null);
  // custo médio por item (o que tem quantidade)
  const byItem = new Map<string, { qty: number; cents: number; n: number; last: { on: string; at: string; unitCents: number } | null }>();
  for (const p of out.filter((x) => x.qty && x.unitCents != null)) {
    const k = p.what.trim().toLowerCase();
    const c = byItem.get(k) ?? { qty: 0, cents: 0, n: 0, last: null };
    c.qty += p.qty!; c.cents += p.unitCents! * p.qty!; c.n++;
    if (!c.last || p.on > c.last.on || (p.on === c.last.on && p.at > c.last.at)) c.last = { on: p.on, at: p.at, unitCents: p.unitCents! };
    byItem.set(k, c);
  }
  const items = [...byItem.entries()].map(([k, v]) => ({ item: out.find((p) => p.what.trim().toLowerCase() === k)!.what, purchases: v.n, qty: v.qty, avgUnitCents: Math.round(v.cents / v.qty), lastUnitCents: v.last?.unitCents ?? null, lastOn: v.last?.on ?? null }));
  const howCounts = new Map<string, number>();
  for (const p of out) howCounts.set(p.kind, (howCounts.get(p.kind) ?? 0) + 1);
  const paid = pays.reduce((t, x) => t + (x.p.kind === 'estorno' ? -1 : 1) * x.p.amountCents, 0);
  const onTime = pays.filter((x) => x.p.kind === 'pagamento');
  return {
    purchases: out,
    kpis: {
      count: out.length, totalCents: total, avgTicketCents: out.length ? Math.round(total / out.length) : null,
      firstOn: dates[0] ?? null, lastOn: dates.at(-1) ?? null, avgDaysBetween: gaps.length ? Math.round(gaps.reduce((t, g) => t + g, 0) / gaps.length) : null,
      last12m: { count: out.filter((p) => p.on >= year).length, cents: out.filter((p) => p.on >= year).reduce((t, p) => t + p.amountCents, 0) },
      paidCents: paid, paymentsOnTimePct: onTime.length ? Math.round((onTime.filter((x) => x.p.paidOn <= x.dueOn).length / onTime.length) * 100) : null,
    },
    how: [...howCounts.entries()].map(([kind, n]) => ({ kind, label: PURCHASE_KIND_LABELS[kind as SupplierPurchase['kind']], n })).sort((a, b) => b.n - a.n),
    items: items.sort((a, b) => b.qty - a.qty),
    // vantagens medidas pelos registros (a equipe complementa no campo "vantagens")
    measured: {
      savingsCents: withRef.length ? saved : null, savingsPct: withRef.length ? Math.round((saved / withRef.reduce((t, p) => t + p.referenceCents!, 0)) * 1000) / 10 : null, savingsBase: withRef.length,
      avgDeliveryDays: deliveries.length ? Math.round(deliveries.reduce((t, d) => t + d, 0) / deliveries.length) : null, deliveryBase: deliveries.length,
      quoteWins: purchases.filter((p) => p.quotes.length > 1 && p.quotes.some((q) => q.chosen)).length,
    },
  };
}
