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

const COLS: Record<keyof Omit<ItemInput, 'qtyMilli' | 'unitCents' | 'discountCents' | 'surchargeCents' | 'bidUnitCents'> | 'qty' | 'unitValue' | 'discount' | 'surcharge' | 'bid', string[]> = {
  description: ['produto/serviço', 'produto/servico', 'produto', 'serviço', 'servico', 'item', 'descrição', 'descricao'],
  unitValue: ['valor', 'valor unitário', 'valor unitario', 'preço', 'preco', 'valor unit'],
  unit: ['medida', 'unidade', 'un'],
  qty: ['quantidade', 'qtd', 'qtde', 'quant'],
  discount: ['desconto'],
  surcharge: ['acréscimo', 'acrescimo'],
  notes: ['observação', 'observacao', 'obs'],
  bid: ['lance', 'valor do lance', 'lance unitário', 'lance unitario'],
};

/**
 * Lê uma tabela (planilha, CSV ou colado do Excel). A primeira linha precisa ter os títulos das colunas.
 * Devolve os itens válidos e, para cada linha recusada, o motivo — nada é inventado.
 */
export function parseItemsTable(rows: (string | number | null)[][]): { items: ItemInput[]; errors: { row: number; message: string }[]; missing: string[] } {
  const clean = rows.filter((r) => r.some((c) => String(c ?? '').trim()));
  if (!clean.length) return { items: [], errors: [], missing: ['Produto/Serviço', 'Valor', 'Quantidade'] };
  const head = clean[0]!.map((c) => String(c ?? '').trim().toLowerCase());
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))])) as Record<keyof typeof COLS, number>;
  const missing = [idx.description < 0 && 'Produto/Serviço', idx.unitValue < 0 && 'Valor', idx.qty < 0 && 'Quantidade'].filter(Boolean) as string[];
  if (missing.length) return { items: [], errors: [], missing };
  const items: ItemInput[] = [];
  const errors: { row: number; message: string }[] = [];
  clean.slice(1).forEach((r, k) => {
    const cell = (i: number) => (i < 0 ? null : r[i] ?? null);
    const unit = parseUnit(cell(idx.unit) == null ? '' : String(cell(idx.unit)));
    const qty = parseQty(cell(idx.qty) as string | number | null);
    const unitCents = parseMoney(cell(idx.unitValue) as string | number | null);
    const discountCents = parseMoney(cell(idx.discount) as string | number | null);
    const surchargeCents = parseMoney(cell(idx.surcharge) as string | number | null);
    const bidRaw = cell(idx.bid);
    const bidUnitCents = bidRaw == null || bidRaw === '' ? null : parseMoney(bidRaw as string | number);
    const row = k + 2;
    if (!unit) return errors.push({ row, message: `Medida “${cell(idx.unit)}” não reconhecida (use Un, Km, R$ ou H).` });
    if (qty == null) return errors.push({ row, message: 'Quantidade inválida.' });
    if (unitCents == null || discountCents == null || surchargeCents == null || (bidRaw != null && bidRaw !== '' && bidUnitCents == null)) return errors.push({ row, message: 'Valor, desconto, acréscimo ou lance em formato inválido.' });
    const it: ItemInput = { description: String(cell(idx.description) ?? '').trim(), unit, qtyMilli: qty, unitCents, discountCents, surchargeCents, notes: cell(idx.notes) == null ? null : String(cell(idx.notes)).trim() || null, bidUnitCents };
    const err = itemErrors(it);
    if (err) return errors.push({ row, message: err });
    items.push(it);
  });
  return { items, errors, missing: [] };
}
