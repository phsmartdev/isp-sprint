/**
 * Relatório de Medição (contas com obrigação de envio): histórico das propostas enviadas no mês pelas oportunidades
 * de consumo dos contratos da conta + consolidado dos itens consumidos. O MESMO HTML é a prévia na tela e o corpo do e-mail.
 */

export type MeasurementProposal = {
  opportunityId: string; code: number; title: string; sentOn: string; valueCents: number;
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
export const proposalLabel = (p: Pick<MeasurementProposal, 'code'>) => `OP-${p.code}`;

/** Corpo do e-mail (HTML com estilos inline, como os clientes de e-mail exigem). */
export function measurementEmailHtml(a: { referenceMonth: string; texts: MeasurementTexts; proposals: MeasurementProposal[]; items: ConsolidatedItem[] }) {
  const inc = a.proposals.filter((p) => p.included).sort((x, y) => x.sentOn.localeCompare(y.sentOn) || x.code - y.code);
  const td = 'border:1px solid #000;padding:4px 6px;font-size:13px';
  const th = `${td};background:#d9d9d9;font-weight:bold;text-align:center`;
  const totP = inc.reduce((t, p) => t + p.valueCents, 0);
  const totI = a.items.reduce((t, i) => t + i.totalCents, 0);
  const intro = a.texts.intro.replace(/\{mes\}/g, monthName(a.referenceMonth));
  const props = inc.length ? `<table style="border-collapse:collapse;margin:0 0 16px;font-family:Times New Roman,serif"><thead><tr><th style="${th}">Data de envio</th><th style="${th}">Serviço</th><th style="${th}">Nº da proposta</th><th style="${th}">Valor</th></tr></thead><tbody>${inc.map((p) => `<tr><td style="${td}">${dmy(p.sentOn)}</td><td style="${td}">${esc(p.title.toUpperCase())}</td><td style="${td};text-align:center">${esc(proposalLabel(p))}</td><td style="${td};text-align:right;white-space:nowrap">${brl(p.valueCents)}</td></tr>`).join('')}<tr><td colspan="3" style="${th}">Valor Total</td><td style="${th};text-align:right;white-space:nowrap">${brl(totP)}</td></tr></tbody></table>` : '<p style="margin:0 0 14px"><em>Nenhuma proposta enviada no período.</em></p>';
  const items = a.items.length ? `<table style="border-collapse:collapse;margin:0 0 16px;font-family:Times New Roman,serif"><thead><tr><th style="${th}">ITEM</th><th style="${th}">DESCRITIVO</th><th style="${th}">UND</th><th style="${th}">QTD</th><th style="${th}">VALOR UNITÁRIO</th><th style="${th}">VALOR TOTAL</th></tr></thead><tbody>${a.items.map((i) => `<tr><td style="${td};text-align:center">${i.item ?? '—'}</td><td style="${td}">${esc(i.description)}</td><td style="${td};text-align:center">${esc(i.unitLabel || UNIT_LABELS[i.unit] || i.unit)}</td><td style="${td};text-align:center">${qty(i.qtyMilli)}</td><td style="${td};text-align:right;white-space:nowrap">${brl(i.unitCents)}</td><td style="${td};text-align:right;white-space:nowrap">${brl(i.totalCents)}</td></tr>`).join('')}<tr><td colspan="5" style="${th}">VALOR TOTAL</td><td style="${th};text-align:right;white-space:nowrap">${brl(totI)}</td></tr></tbody></table>` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">${para(a.texts.greeting)}${para(intro)}${props}${items}${para(a.texts.closing)}</div>`;
}

/** Texto simples equivalente (clientes sem HTML). */
export function measurementEmailText(a: { referenceMonth: string; texts: MeasurementTexts; proposals: MeasurementProposal[]; items: ConsolidatedItem[] }) {
  const inc = a.proposals.filter((p) => p.included).sort((x, y) => x.sentOn.localeCompare(y.sentOn) || x.code - y.code);
  return [a.texts.greeting, a.texts.intro.replace(/\{mes\}/g, monthName(a.referenceMonth)),
    ...inc.map((p) => `${dmy(p.sentOn)} · ${p.title} · ${proposalLabel(p)} · ${brl(p.valueCents)}`), `Valor total: ${brl(inc.reduce((t, p) => t + p.valueCents, 0))}`, '',
    ...a.items.map((i) => `${i.item ?? '—'} · ${i.description} · ${i.unitLabel || UNIT_LABELS[i.unit] || i.unit} ${qty(i.qtyMilli)} × ${brl(i.unitCents)} = ${brl(i.totalCents)}`),
    '', a.texts.closing].join('\n');
}

export const emailListOk = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean).every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
