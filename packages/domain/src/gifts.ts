/**
 * Marketing → Brindes: itens em estoque (custo por item), kits (custo = soma dos itens) com categoria,
 * entradas por fornecedor (custo médio ponderado), envios de kit para a conta e stakeholders, e o consolidado por conta.
 * Dinheiro sempre em centavos.
 */

export type GiftKitLine = { itemId: string; qty: number };
export type GiftItemCost = { id: string; name: string; unitCostCents: number; stock: number };

/** Custo de um kit: soma de quantidade × custo atual de cada item. Item que não existe mais entra como 0 e vai em `missing`. */
export function kitCost(lines: GiftKitLine[], items: GiftItemCost[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const missing: string[] = [];
  let cents = 0;
  const detail = lines.map((l) => {
    const it = byId.get(l.itemId);
    if (!it) missing.push(l.itemId);
    const unit = it?.unitCostCents ?? 0;
    cents += unit * l.qty;
    return { itemId: l.itemId, name: it?.name ?? 'Item removido', qty: l.qty, unitCostCents: unit, totalCents: unit * l.qty };
  });
  return { cents, detail, missing };
}

/** Quantos kits completos dá para montar com o estoque atual. */
export function kitsAvailable(lines: GiftKitLine[], items: GiftItemCost[]) {
  if (!lines.length) return 0;
  const byId = new Map(items.map((i) => [i.id, i]));
  return Math.min(...lines.map((l) => (l.qty > 0 ? Math.floor(Math.max(0, byId.get(l.itemId)?.stock ?? 0) / l.qty) : Infinity)));
}

/** Custo médio ponderado depois de uma entrada: (estoque × custo atual + quantidade × custo da compra) ÷ novo estoque. Estoque zerado: vale o custo da compra. */
export function weightedCost(stock: number, currentCents: number, qty: number, purchaseUnitCents: number) {
  const s = Math.max(0, stock);
  if (s + qty <= 0) return purchaseUnitCents;
  if (s === 0) return purchaseUnitCents;
  return Math.round((s * currentCents + qty * purchaseUnitCents) / (s + qty));
}

/** Itens que o envio consome (kit × quantidade + avulsos), somados por item. */
export function deliveryNeeds(kit: GiftKitLine[] | null, kits: number, extra: GiftKitLine[] = []) {
  const need = new Map<string, number>();
  for (const l of kit ?? []) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty * kits);
  for (const l of extra) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty);
  return [...need.entries()].filter(([, q]) => q > 0).map(([itemId, qty]) => ({ itemId, qty }));
}

/** Itens sem estoque suficiente para o envio. */
export function stockShortages(needs: GiftKitLine[], items: GiftItemCost[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return needs.filter((n) => (byId.get(n.itemId)?.stock ?? 0) < n.qty).map((n) => ({ itemId: n.itemId, name: byId.get(n.itemId)?.name ?? 'Item removido', need: n.qty, stock: byId.get(n.itemId)?.stock ?? 0 }));
}

export type GiftDeliveryLine = { itemId: string; name: string; qty: number; unitCostCents: number };
export type GiftDeliverySummary = {
  id: string; occurredOn: string; kitId: string | null; kitName: string | null; categoryName: string | null; kits: number;
  items: GiftDeliveryLine[]; totalCents: number; stakeholderIds: string[]; cancelled: boolean;
};

/** Consolidado da conta: total gasto, por kit, por categoria, por item e por stakeholder (envios cancelados ficam fora). */
export function giftConsolidated(deliveries: GiftDeliverySummary[]) {
  const live = deliveries.filter((d) => !d.cancelled);
  const add = <K extends string>(m: Map<K, { key: K; name: string; qty: number; totalCents: number; deliveries: number }>, key: K, name: string, qty: number, cents: number) => {
    const cur = m.get(key) ?? { key, name, qty: 0, totalCents: 0, deliveries: 0 };
    cur.qty += qty; cur.totalCents += cents; cur.deliveries += 1;
    m.set(key, cur);
  };
  const byKit = new Map<string, { key: string; name: string; qty: number; totalCents: number; deliveries: number }>();
  const byCategory = new Map<string, { key: string; name: string; qty: number; totalCents: number; deliveries: number }>();
  const byItem = new Map<string, { key: string; name: string; qty: number; totalCents: number; deliveries: number }>();
  const byStakeholder = new Map<string, { key: string; name: string; qty: number; totalCents: number; deliveries: number }>();
  let totalCents = 0, kits = 0;
  for (const d of live) {
    totalCents += d.totalCents;
    kits += d.kitId ? d.kits : 0;
    add(byKit, d.kitId ?? 'avulso', d.kitName ?? 'Itens avulsos', d.kitId ? d.kits : 0, d.totalCents);
    add(byCategory, d.categoryName ?? 'sem', d.categoryName ?? 'Sem categoria', d.kitId ? d.kits : 0, d.totalCents);
    for (const l of d.items) add(byItem, l.itemId, l.name, l.qty, l.qty * l.unitCostCents);
    for (const sid of d.stakeholderIds) add(byStakeholder, sid, sid, d.kitId ? d.kits : 0, 0);
  }
  const list = <T extends { totalCents: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.totalCents - a.totalCents);
  return { totalCents, kits, deliveries: live.length, byKit: list(byKit), byCategory: list(byCategory), byItem: list(byItem), byStakeholder: list(byStakeholder) };
}
