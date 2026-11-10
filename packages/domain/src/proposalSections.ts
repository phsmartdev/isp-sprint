/**
 * Seções automáticas da proposta (páginas geradas sobre a arte de fundo do modelo):
 * 1. Serviços propostos (texto + fotos em grade justificada, sem cortar nem distorcer);
 * 2. Composição do investimento (itens da aba Produto da oportunidade, com total);
 * 3. Condição da proposta (prazo de validade).
 */
import { itemTotal } from './items';

export type ProposalSectionsConfig = {
  enabled: boolean;
  /** Página da arte usada como fundo das páginas geradas (sai só como fundo); null = página branca. */
  backgroundPage: number | null;
  /** As páginas geradas entram depois desta página da arte (índice, 0 = depois da capa). */
  insertAfter: number;
  /** Margens da área de conteúdo, em % da página. */
  margins: { top: number; bottom: number; left: number; right: number };
  color: string;
  titles: { services: string; investment: string; condition: string };
  validityDays: number;
  conditionText: string;
};

export const DEFAULT_PROPOSAL_SECTIONS: ProposalSectionsConfig = {
  enabled: false, backgroundPage: null, insertAfter: 0,
  margins: { top: 14, bottom: 10, left: 8, right: 8 }, color: '#2F5986',
  titles: { services: 'SERVIÇOS PROPOSTOS', investment: 'COMPOSIÇÃO DO INVESTIMENTO', condition: 'CONDIÇÃO DA PROPOSTA' },
  validityDays: 15,
  conditionText: 'Proposta válida por {{proposta.validade_dias}} dias, até {{proposta.validade_data}}.',
};

export function normalizeSections(v: unknown): ProposalSectionsConfig {
  const x = (v && typeof v === 'object' ? v : {}) as Partial<ProposalSectionsConfig>;
  const d = DEFAULT_PROPOSAL_SECTIONS;
  const pct = (n: unknown, def: number) => (typeof n === 'number' && n >= 0 && n <= 40 ? n : def);
  return {
    enabled: !!x.enabled,
    backgroundPage: typeof x.backgroundPage === 'number' && x.backgroundPage >= 0 ? Math.floor(x.backgroundPage) : null,
    insertAfter: typeof x.insertAfter === 'number' && x.insertAfter >= -1 ? Math.floor(x.insertAfter) : d.insertAfter,
    margins: { top: pct(x.margins?.top, d.margins.top), bottom: pct(x.margins?.bottom, d.margins.bottom), left: pct(x.margins?.left, d.margins.left), right: pct(x.margins?.right, d.margins.right) },
    color: typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : d.color,
    titles: { services: x.titles?.services?.trim() || d.titles.services, investment: x.titles?.investment?.trim() || d.titles.investment, condition: x.titles?.condition?.trim() || d.titles.condition },
    validityDays: typeof x.validityDays === 'number' && x.validityDays >= 1 && x.validityDays <= 365 ? Math.floor(x.validityDays) : d.validityDays,
    conditionText: typeof x.conditionText === 'string' && x.conditionText.trim() ? x.conditionText.slice(0, 2000) : d.conditionText,
  };
}

/** Quantas fotos por linha: até 3 numa linha; depois linhas de 3 e 2 equilibradas (nunca uma foto sozinha no fim, se der). */
export function photoRows(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 3) return [n];
  if (n === 4) return [2, 2];
  const rows: number[] = [];
  let left = n;
  while (left > 0) {
    if (left === 4) { rows.push(2, 2); break; }
    if (left <= 3) { rows.push(left); break; }
    rows.push(3); left -= 3;
  }
  return rows;
}

export type PhotoBox = { index: number; x: number; y: number; w: number; h: number };
/**
 * Grade justificada: cada linha tem a mesma altura e ocupa a largura toda, respeitando a proporção de cada foto.
 * Linha alta demais (fotos em pé) é limitada a `maxRowH` e centralizada. y cresce para baixo, a partir de 0.
 */
export function layoutPhotos(aspects: number[], width: number, gap: number, maxRowH: number): { boxes: PhotoBox[]; rows: { y: number; h: number; indexes: number[] }[]; height: number } {
  const boxes: PhotoBox[] = [];
  const rows: { y: number; h: number; indexes: number[] }[] = [];
  let y = 0, i = 0;
  for (const k of photoRows(aspects.length)) {
    const idx = Array.from({ length: k }, (_, j) => i + j);
    const ar = idx.map((j) => (aspects[j]! > 0 ? aspects[j]! : 1.5));
    let h = (width - gap * (k - 1)) / ar.reduce((a, b) => a + b, 0);
    h = Math.min(h, maxRowH);
    const used = ar.reduce((a, b) => a + b * h, 0) + gap * (k - 1);
    let x = (width - used) / 2;
    for (const [j, a] of ar.entries()) { boxes.push({ index: idx[j]!, x, y, w: a * h, h }); x += a * h + gap; }
    rows.push({ y, h, indexes: idx });
    y += h + gap; i += k;
  }
  return { boxes, rows, height: rows.length ? y - gap : 0 };
}

export type InvestmentItem = { description: string; unit: string; qtyMilli: number; unitCents: number; discountCents: number; surchargeCents: number };
const UNIT: Record<string, string> = { un: 'Und', km: 'Km', h: 'HH', rs: 'R$' };
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
const qty = (m: number) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Linhas da tabela de investimento (texto pronto) e o total. */
export function investmentTable(items: InvestmentItem[]) {
  const rows = items.map((it, i) => {
    const total = itemTotal(it);
    return { cells: [String(i + 1), it.description, UNIT[it.unit] ?? it.unit, qty(it.qtyMilli), brl(it.unitCents), brl(total)], totalCents: total };
  });
  const totalCents = rows.reduce((t, r) => t + r.totalCents, 0);
  return { header: ['Item', 'Descrição', 'Und', 'Qtd', 'Valor unitário', 'Valor total'], rows: rows.map((r) => r.cells), total: brl(totalCents), totalCents };
}

/** Data de validade (ISO) = hoje + dias. */
export const validityDate = (today: string, days: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
