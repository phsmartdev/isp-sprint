/**
 * Produtos e serviços lançados na oportunidade. O total dos itens é o valor da oportunidade.
 * Valores em centavos; quantidade em milésimos (aceita 2,5 h ou 0,750 km).
 */
export const ITEM_UNITS = ['un', 'km', 'rs', 'h'] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];
export const ITEM_UNIT_LABELS: Record<ItemUnit, string> = { un: 'Un', km: 'Km', rs: 'R$', h: 'H' };
export const BID_MODES = ['item', 'global'] as const;
export type BidMode = (typeof BID_MODES)[number];

export type ItemValues = { qtyMilli: number; unitCents: number; discountCents: number; surchargeCents: number };
/** Total da linha: quantidade × valor − desconto + acréscimo (nunca negativo). */
export function itemTotal(i: ItemValues): number {
  return Math.max(0, Math.round((i.qtyMilli * i.unitCents) / 1000) - i.discountCents + i.surchargeCents);
}
export function itemsTotals<T extends ItemValues & { bidUnitCents?: number | null }>(items: T[]) {
  const gross = items.reduce((t, i) => t + Math.round((i.qtyMilli * i.unitCents) / 1000), 0);
  const discount = items.reduce((t, i) => t + i.discountCents, 0);
  const surcharge = items.reduce((t, i) => t + i.surchargeCents, 0);
  const total = items.reduce((t, i) => t + itemTotal(i), 0);
  const withBid = items.filter((i) => i.bidUnitCents != null);
  const bidTotal = withBid.length ? items.reduce((t, i) => t + (i.bidUnitCents != null ? Math.round((i.qtyMilli * i.bidUnitCents) / 1000) : 0), 0) : null;
  return { count: items.length, gross, discount, surcharge, total, bidTotal, bidItems: withBid.length };
}

export type ItemInput = { description: string; unit: ItemUnit; qtyMilli: number; unitCents: number; discountCents: number; surchargeCents: number; notes?: string | null; bidUnitCents?: number | null };
export function itemErrors(i: ItemInput): string | null {
  if (i.description.trim().length < 2) return 'Informe o produto ou serviço.';
  if (!(ITEM_UNITS as readonly string[]).includes(i.unit)) return 'Medida inválida.';
  if (!Number.isInteger(i.qtyMilli) || i.qtyMilli <= 0) return 'Quantidade precisa ser maior que zero.';
  for (const [k, v] of [['Valor', i.unitCents], ['Desconto', i.discountCents], ['Acréscimo', i.surchargeCents]] as const) if (!Number.isInteger(v) || v < 0) return `${k} inválido.`;
  if (i.discountCents > Math.round((i.qtyMilli * i.unitCents) / 1000) + i.surchargeCents) return 'O desconto não pode passar do valor da linha.';
  if (i.bidUnitCents != null && (!Number.isInteger(i.bidUnitCents) || i.bidUnitCents < 0)) return 'Lance inválido.';
  return null;
}

/** "1.234,56", "1234.56", "R$ 10" → centavos; vazio → 0; texto inválido → null. */
export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  const t = raw.replace(/R\$|\s/g, '');
  if (!t) return 0;
  // 1.234,56 (BR) · 1.500 (milhar BR) · 1234.56
  const norm = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(/,/g, '');
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
/** Quantidade "2,5" → 2500 milésimos. */
export function parseQty(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const t = String(raw).trim();
  const n = typeof raw === 'number' ? raw : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}
export function parseUnit(raw: string | null | undefined): ItemUnit | null {
  const t = (raw ?? '').trim().toLowerCase().replace('.', '');
  if (!t || ['un', 'und', 'unid', 'unidade', 'unidades', 'uni', 'pç', 'pc'].includes(t)) return 'un';
  if (['km', 'quilometro', 'quilômetro', 'quilometros', 'quilômetros'].includes(t)) return 'km';
  if (['r$', 'rs', 'real', 'reais', 'valor'].includes(t)) return 'rs';
  if (['h', 'hr', 'hora', 'horas'].includes(t)) return 'h';
  return null;
}

/** Título da coluna sem acento, caixa, pontuação e espaços repetidos ("VALOR UNITÁRIO (R$)" → "valor unitario r$"). */
export const itemHeader = (h: unknown) => String(h ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.:;()\[\]*º°ª]/g, ' ').replace(/\s+/g, ' ').trim();
type ColKey = 'itemNo' | 'description' | 'unitValue' | 'unit' | 'qty' | 'discount' | 'surcharge' | 'notes' | 'bid';
/** Como reconhecer cada coluna pelo título (já normalizado). A ordem das colunas na planilha não importa. */
const COL_MATCH: Record<ColKey, (h: string) => boolean> = {
  itemNo: (h) => ['item', 'itens', 'n', 'no', 'n item', 'item n', 'numero', 'num', 'nr', 'seq', 'sequencia', 'ordem', 'cod', 'codigo', 'lote item'].includes(h),
  description: (h) => /^(descricao|discriminacao|especificacao)/.test(h) || ['produto/servico', 'produto / servico', 'produto', 'servico', 'produtos', 'servicos', 'objeto', 'material', 'nome', 'denominacao'].includes(h),
  unitValue: (h) => !/total/.test(h) && (/^(valor|vlr|vl|preco|custo) ?unit/.test(h) || /^(valor|preco)( r\$| em r\$)?$/.test(h) || ['unitario', 'valor por unidade', 'preco por unidade'].includes(h)),
  unit: (h) => /^(unidade|unid|und)/.test(h) || ['un', 'u', 'um', 'u m', 'medida', 'unidade de medida'].includes(h),
  qty: (h) => /^(quantidade|quant|qtd|qtde|qde)/.test(h) || h === 'qt',
  discount: (h) => h.startsWith('desconto'),
  surcharge: (h) => h.startsWith('acrescimo'),
  notes: (h) => /^(observacao|observacoes|obs)$/.test(h),
  bid: (h) => /^lance/.test(h) || h === 'valor do lance',
};
/** Colunas obrigatórias para incluir itens; Item (número), Unidade, Desconto, Acréscimo, Observação e Lance são opcionais. */
export const ITEM_REQUIRED_COLUMNS = ['Descrição', 'Quantidade', 'Valor unitário'] as const;

/**
 * Lê uma tabela (planilha, CSV ou colado do Excel). A primeira linha precisa ter os títulos das colunas, em qualquer ordem
 * (ex.: ITEM, DESCRIÇÃO, UNIDADE, QUANTIDADE, VALOR UNITÁRIO ou DESCRIÇÃO, QUANTIDADE, UNIDADE, VALOR UNITÁRIO).
 * Obrigatórias: Descrição, Quantidade e Valor unitário. ITEM é o número do item no edital (vai para a observação);
 * sem coluna de descrição, ITEM vale como a descrição. Unidade em branco ou fora de Un/Km/R$/H vira Un e a unidade original
 * fica na observação. Devolve os itens válidos e, para cada linha recusada, o motivo — nada é inventado.
 */
export function parseItemsTable(rows: (string | number | null)[][]): { items: ItemInput[]; errors: { row: number; message: string }[]; missing: string[] } {
  const clean = rows.filter((r) => r.some((c) => String(c ?? '').trim()));
  if (!clean.length) return { items: [], errors: [], missing: [...ITEM_REQUIRED_COLUMNS] };
  const head = clean[0]!.map(itemHeader);
  const used = new Set<number>();
  const find = (k: ColKey) => { const i = head.findIndex((h, j) => !used.has(j) && COL_MATCH[k](h)); if (i >= 0) used.add(i); return i; };
  // a descrição primeiro: "Item" só vira descrição quando não há outra coluna de descrição
  const idx = {} as Record<ColKey, number>;
  idx.description = find('description');
  idx.itemNo = find('itemNo');
  if (idx.description < 0 && idx.itemNo >= 0 && ['item', 'itens'].includes(head[idx.itemNo]!)) { idx.description = idx.itemNo; idx.itemNo = -1; }
  for (const k of ['unitValue', 'qty', 'unit', 'discount', 'surcharge', 'notes', 'bid'] as const) idx[k] = find(k);
  const missing = [idx.description < 0 && 'Descrição', idx.qty < 0 && 'Quantidade', idx.unitValue < 0 && 'Valor unitário'].filter(Boolean) as string[];
  if (missing.length) return { items: [], errors: [], missing };
  const items: ItemInput[] = [];
  const errors: { row: number; message: string }[] = [];
  clean.slice(1).forEach((r, k) => {
    const cell = (i: number) => (i < 0 ? null : r[i] ?? null);
    const rawUnit = cell(idx.unit) == null ? '' : String(cell(idx.unit)).trim();
    const known = parseUnit(rawUnit);
    const unit = known ?? 'un';
    const qty = parseQty(cell(idx.qty) as string | number | null);
    const unitCents = parseMoney(cell(idx.unitValue) as string | number | null);
    const discountCents = parseMoney(cell(idx.discount) as string | number | null);
    const surchargeCents = parseMoney(cell(idx.surcharge) as string | number | null);
    const bidRaw = cell(idx.bid);
    const bidUnitCents = bidRaw == null || bidRaw === '' ? null : parseMoney(bidRaw as string | number);
    const row = k + 2;
    if (qty == null) return errors.push({ row, message: 'Quantidade inválida.' });
    if (unitCents == null || discountCents == null || surchargeCents == null || (bidRaw != null && bidRaw !== '' && bidUnitCents == null)) return errors.push({ row, message: 'Valor, desconto, acréscimo ou lance em formato inválido.' });
    const itemNo = cell(idx.itemNo) == null ? '' : String(cell(idx.itemNo)).trim();
    const notes = [itemNo && `Item ${itemNo}`, !known && rawUnit && `Unidade: ${rawUnit}`, cell(idx.notes) == null ? '' : String(cell(idx.notes)).trim()].filter(Boolean).join(' · ');
    const it: ItemInput = { description: String(cell(idx.description) ?? '').trim(), unit, qtyMilli: qty, unitCents, discountCents, surchargeCents, notes: notes || null, bidUnitCents };
    const err = itemErrors(it);
    if (err) return errors.push({ row, message: err });
    items.push(it);
  });
  return { items, errors, missing: [] };
}

// ------------------------------------------------------------------ itens do contrato a partir da oportunidade ou de planilha
/** Item do contrato: quantidade inteira, valor unitário e cobrança mensal (recorrente) ou única. */
export type ContractItemDraft = { planId: string | null; description: string; qty: number; unitCents: number; recurring: boolean };

const fmtQty = (milli: number) => (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
/**
 * Converte um item da oportunidade (quantidade em milésimos, desconto, acréscimo, lance) para o contrato.
 * Vale o lance quando houver (licitação). Quantidade fracionada ou total que não divide por igual vira 1 × total,
 * com a quantidade original na descrição (o valor da linha nunca muda).
 */
export function contractItemFromOpportunity(i: { description: string; unit?: string | null; qtyMilli: number; unitCents: number; discountCents?: number; surchargeCents?: number; bidUnitCents?: number | null; dealKind?: string | null }): ContractItemDraft {
  const unitCents = i.bidUnitCents ?? i.unitCents;
  const total = itemTotal({ qtyMilli: i.qtyMilli, unitCents, discountCents: i.discountCents ?? 0, surchargeCents: i.surchargeCents ?? 0 });
  const recurring = !(i.dealKind === 'venda' || i.dealKind === 'servico');
  const whole = i.qtyMilli % 1000 === 0 && i.qtyMilli > 0 ? i.qtyMilli / 1000 : null;
  const description = i.description.trim().slice(0, 200);
  if (whole && total % whole === 0) return { planId: null, description, qty: whole, unitCents: total / whole, recurring };
  const unitLabel = i.unit && i.unit !== 'un' ? ` ${ITEM_UNIT_LABELS[i.unit as ItemUnit] ?? i.unit}` : '';
  return { planId: null, description: `${description} (${fmtQty(i.qtyMilli)}${unitLabel})`.slice(0, 200), qty: 1, unitCents: total, recurring };
}

/** "Mensal", "recorrente", "locação" = mensal; "única", "venda", "serviço", "instalação" = cobrança única. */
export function parseRecurring(raw: unknown): boolean | null {
  const t = itemHeader(raw);
  if (!t) return null;
  if (/^(unic|pagamento unico|venda|servico|instalac|avulso|pontual|one)/.test(t)) return false;
  if (/^(mensal|recorr|locac|aluguel|assinatura|mes)/.test(t)) return true;
  return null;
}

/**
 * Lê a planilha (ou o colado do Excel) dos produtos do contrato: mesmas colunas dos itens da oportunidade
 * (Descrição, Quantidade e Valor unitário obrigatórias, em qualquer ordem) e a coluna opcional "Cobrança"
 * (Mensal ou Única; sem a coluna, o item é mensal). Linhas recusadas voltam com o motivo.
 */
export function parseContractItemsTable(rows: (string | number | null)[][]): { items: ContractItemDraft[]; errors: { row: number; message: string }[]; missing: string[] } {
  const clean = rows.filter((r) => r.some((c) => String(c ?? '').trim()));
  const head = (clean[0] ?? []).map(itemHeader);
  const ci = head.findIndex((h) => /^(cobranca|tipo de cobranca|forma de cobranca|recorrencia|periodicidade|tipo)$/.test(h));
  const base = parseItemsTable(ci < 0 ? clean : clean.map((r) => r.filter((_, j) => j !== ci)));
  if (base.missing.length) return { items: [], errors: [], missing: base.missing };
  // as linhas aceitas mantêm a ordem: casa cada item com a sua linha de origem para ler a cobrança
  const rejected = new Set(base.errors.map((e) => e.row));
  const sourceRows = clean.slice(1).map((r, k) => ({ r, row: k + 2 })).filter((x) => !rejected.has(x.row));
  const errors = [...base.errors];
  const items: ContractItemDraft[] = [];
  base.items.forEach((it, k) => {
    const src = sourceRows[k]!;
    const rec = ci < 0 ? true : parseRecurring(src.r[ci]);
    if (ci >= 0 && rec === null && String(src.r[ci] ?? '').trim()) { errors.push({ row: src.row, message: 'Cobrança deve ser Mensal ou Única.' }); return; }
    items.push({ ...contractItemFromOpportunity({ ...it, dealKind: rec === false ? 'venda' : 'recorrencia' }), description: contractItemFromOpportunity(it).description });
  });
  return { items, errors: errors.sort((a, b) => a.row - b.row), missing: [] };
}
