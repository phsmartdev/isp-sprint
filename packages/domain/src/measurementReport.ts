/**
 * Relatório de Medição (contas com obrigação de envio): histórico das propostas enviadas no mês pelas oportunidades
 * de consumo dos contratos da conta + consolidado dos itens consumidos. O MESMO HTML é a prévia na tela e o corpo do e-mail.
 */

export type MeasurementProposal = {
  opportunityId: string; code: number; number?: string | null; title: string; sentOn: string; valueCents: number;
  attachment: { id: string; filename: string; sizeBytes: number } | null; contractNumber: string | null; included: boolean;
};
export type MeasurementLine = { description: string; unit: string; qtyMilli: number; unitCents: number; totalCents: number };
export type ConsolidatedItem = { item: string | null; description: string; unit: string; unitLabel?: string | null; qtyMilli: number; unitCents: number; totalCents: number };
export type MeasurementTexts = { greeting: string; intro: string; closing: string };

export const DEFAULT_MEASUREMENT_TEXTS: MeasurementTexts = {
  greeting: 'Bom dia, prezados.',
  intro: 'Segue em anexo as propostas comerciais executadas durante o mês de {mes} e o relatório de medição.',
  closing: 'Em breve nosso financeiro enviará as notas fiscais para conferência.\n\nQualquer dúvida estamos à disposição.',
};

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
export const monthLabel = (ym: string) => `${monthName(ym)} de ${ym.slice(0, 4)}`;
export const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
export const monthRange = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }; };

/** Relatório oficial: o mês anterior, com envio previsto no dia escolhido do mês corrente (limitado ao fim do mês). */
export function officialPeriod(today: string, dueDay: number) {
  const cur = today.slice(0, 7);
  const { to } = monthRange(cur);
  const day = Math.min(Math.max(1, Math.floor(dueDay)), Number(to.slice(8)));
  return { referenceMonth: prevMonth(cur), dueOn: `${cur}-${String(day).padStart(2, '0')}` };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Soma os itens das propostas incluídas por descrição + unidade + preço. Nº do ITEM e unidade vêm do item do contrato
 * com a mesma descrição (Controle de Empenhos: nº do órgão; senão a posição no contrato).
 */
export function consolidateItems(lines: MeasurementLine[], contractItems: { description: string; number?: string | null; unit?: string | null }[] = []): ConsolidatedItem[] {
  const pos = new Map<string, { n: string; unit: string | null }>();
  contractItems.forEach((c, i) => { const k = norm(c.description); if (k && !pos.has(k)) pos.set(k, { n: c.number?.trim() || String(i + 1), unit: c.unit?.trim() || null }); });
  const map = new Map<string, ConsolidatedItem>();
  for (const l of lines) {
    const key = `${norm(l.description)}|${l.unit}|${l.unitCents}`;
    const cur = map.get(key);
    if (cur) { cur.qtyMilli += l.qtyMilli; cur.totalCents += l.totalCents; continue; }
    const n = pos.get(norm(l.description));
    map.set(key, { item: n ? n.n : null, unitLabel: n?.unit ?? null, description: l.description.trim(), unit: l.unit, qtyMilli: l.qtyMilli, unitCents: l.unitCents, totalCents: l.totalCents });
  }
  return [...map.values()].sort((a, b) => (a.item && b.item ? a.item.localeCompare(b.item, 'pt-BR', { numeric: true }) : a.item ? -1 : b.item ? 1 : a.description.localeCompare(b.description, 'pt-BR')));
}

export const UNIT_LABELS: Record<string, string> = { un: 'Und', km: 'Km', h: 'HH', rs: 'R$' };
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
const qty = (m: number) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const para = (s: string) => s.split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p style="margin:0 0 14px">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
export const proposalLabel = (p: Pick<MeasurementProposal, 'code' | 'number'>) => p.number || `OP-${p.code}`;


/** Tabela editável do e-mail (texto livre em cada célula; linhas e colunas podem ser incluídas). */
export type GridAlign = 'left' | 'center' | 'right';
export type MeasurementGrid = { columns: { label: string; align: GridAlign }[]; rows: string[][]; total: string[] | null };
export type MeasurementTables = { proposals: MeasurementGrid; items: MeasurementGrid };

/** Tabelas montadas a partir do CRM (ponto de partida da edição). */
export function defaultTables(proposals: MeasurementProposal[], items: ConsolidatedItem[]): MeasurementTables {
  const inc = proposals.filter((p) => p.included).sort((x, y) => x.sentOn.localeCompare(y.sentOn) || x.code - y.code);
  return {
    proposals: {
      columns: [{ label: 'Data de envio', align: 'left' }, { label: 'Serviço', align: 'left' }, { label: 'Nº da proposta', align: 'center' }, { label: 'Valor', align: 'right' }],
      rows: inc.map((p) => [dmy(p.sentOn), p.title.toUpperCase(), proposalLabel(p), brl(p.valueCents)]),
      total: ['Valor Total', '', '', brl(inc.reduce((t, p) => t + p.valueCents, 0))],
    },
    items: {
      columns: [{ label: 'ITEM', align: 'center' }, { label: 'DESCRITIVO', align: 'left' }, { label: 'UND', align: 'center' }, { label: 'QTD', align: 'center' }, { label: 'VALOR UNITÁRIO', align: 'right' }, { label: 'VALOR TOTAL', align: 'right' }],
      rows: items.map((i) => [i.item ?? '—', i.description, i.unitLabel || UNIT_LABELS[i.unit] || i.unit, qty(i.qtyMilli), brl(i.unitCents), brl(i.totalCents)]),
      total: ['VALOR TOTAL', '', '', '', '', brl(items.reduce((t, i) => t + i.totalCents, 0))],
    },
  };
}

/** Normaliza uma tabela vinda da edição: mesmo número de células por linha, limites de tamanho. */
export function normalizeGrid(g: MeasurementGrid): MeasurementGrid {
  const cols = g.columns.slice(0, 12).map((c) => ({ label: String(c.label ?? '').slice(0, 120), align: (['left', 'center', 'right'] as const).includes(c.align) ? c.align : 'left' }));
  const fit = (r: string[]) => cols.map((_, i) => String(r[i] ?? '').slice(0, 1000));
  return { columns: cols, rows: g.rows.slice(0, 300).map(fit), total: g.total ? fit(g.total) : null };
}

function gridHtml(g: MeasurementGrid) {
  if (!g.columns.length) return '';
  const td = 'border:1px solid #000;padding:4px 6px;font-size:13px';
  const th = `${td};background:#d9d9d9;font-weight:bold;text-align:center`;
  const al = (i: number) => `text-align:${g.columns[i]?.align ?? 'left'}`;
  const cell = (v: string) => esc(v).replace(/\n/g, '<br>');
  let total = '';
  if (g.total) {
    const cells: string[] = [];
    for (let i = 0; i < g.total.length; i++) {
      let span = 1;
      while (g.total[i] && i + span < g.total.length && !g.total[i + span] && i + span < g.total.length - 1) span++;
      cells.push(`<td${span > 1 ? ` colspan="${span}"` : ''} style="${th}${span === 1 && i > 0 ? `;${al(i)};white-space:nowrap` : ''}">${cell(g.total[i] ?? '')}</td>`);
      i += span - 1;
    }
    total = `<tr>${cells.join('')}</tr>`;
  }
  return `<table style="border-collapse:collapse;margin:0 0 16px;font-family:Times New Roman,serif"><thead><tr>${g.columns.map((c) => `<th style="${th}">${cell(c.label)}</th>`).join('')}</tr></thead><tbody>${g.rows.map((r) => `<tr>${r.map((v, i) => `<td style="${td};${al(i)}">${cell(v)}</td>`).join('')}</tr>`).join('')}${total}</tbody></table>`;
}

/** Corpo do e-mail (HTML com estilos inline, como os clientes de e-mail exigem). Usa as tabelas editadas, se houver. */
export function measurementEmailHtml(a: { referenceMonth: string; texts: MeasurementTexts; proposals: MeasurementProposal[]; items: ConsolidatedItem[]; tables?: MeasurementTables | null }) {
  const tb = a.tables ?? defaultTables(a.proposals, a.items);
  const intro = a.texts.intro.replace(/\{mes\}/g, monthName(a.referenceMonth));
  const props = tb.proposals.rows.length ? gridHtml(tb.proposals) : '<p style="margin:0 0 14px"><em>Nenhuma proposta enviada no período.</em></p>';
  const items = tb.items.rows.length ? gridHtml(tb.items) : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">${para(a.texts.greeting)}${para(intro)}${props}${items}${para(a.texts.closing)}</div>`;
}

/** Texto simples equivalente (clientes sem HTML). */
export function measurementEmailText(a: { referenceMonth: string; texts: MeasurementTexts; proposals: MeasurementProposal[]; items: ConsolidatedItem[]; tables?: MeasurementTables | null }) {
  const tb = a.tables ?? defaultTables(a.proposals, a.items);
  const g = (x: MeasurementGrid) => [x.columns.map((c) => c.label).join(' | '), ...x.rows.map((r) => r.join(' | ')), ...(x.total ? [x.total.filter(Boolean).join(' | ')] : [])];
  return [a.texts.greeting, a.texts.intro.replace(/\{mes\}/g, monthName(a.referenceMonth)), '', ...g(tb.proposals), '', ...(tb.items.rows.length ? g(tb.items) : []), '', a.texts.closing].join('\n');
}

export const emailListOk = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean).every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));

/** Número da proposta gerada no CRM: PC + AAMMDD (data de geração); repetido no dia ganha sufixo -2, -3… */
export const proposalNumberBase = (isoDate: string) => `PC ${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}`;
export function nextProposalNumber(isoDate: string, taken: string[]) {
  const base = proposalNumberBase(isoDate);
  if (!taken.includes(base)) return base;
  let n = 2; while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
export const proposalTitle = (number: string, accountName: string) => `${number} - ${accountName}`;
