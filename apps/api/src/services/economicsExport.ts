/**
 * Exportação de um cálculo salvo da viabilidade econômica (CSV e PDF). Usa só o que foi gravado: nada é recalculado.
 * O DRE sai da mesma função da tela (econDre), e o rodapé traz a versão do motor e o hash do cálculo.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { ECON_VERDICT_LABELS, econDre, econHeadline, type EconResult } from '@isp/domain';
import { TAX_REGIME_LABELS, type TaxRegime } from '@isp/shared';
import { brl } from './email';
import { safeText, wrap } from './proposals';
import type { economicsRun } from './economics';

type Run = NonNullable<Awaited<ReturnType<typeof economicsRun>>>;
export type RunHeader = { code: number; title: string; account: string };
type Emitter = { name: string; cnpj: string | null; taxRegime: string | null; city: string | null; state: string | null } | null;

const pct = (v: number, d = 2) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}%`;
const money = (c: number) => (c < 0 ? `-${brl(-c)}` : brl(c));
const months = (m: number | null | undefined) => (m == null ? 'não atingido' : `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`);
const when = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d);
const cnpjFmt = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const emitterText = (e: Emitter) => (!e ? 'Filial não informada' : [e.name, e.cnpj ? `CNPJ ${cnpjFmt(e.cnpj)}` : null, e.taxRegime ? TAX_REGIME_LABELS[e.taxRegime as TaxRegime] : null, e.city ? `${e.city}${e.state ? `/${e.state}` : ''}` : null].filter(Boolean).join(' · '));

/** Linhas de resumo comuns ao CSV e ao PDF. */
function summary(run: Run, h: RunHeader) {
  const r = run.result;
  const k = r.kpi;
  const emitter = (run.settings as { emitter?: Emitter }).emitter ?? null;
  return {
    head: [
      ['Oportunidade', `OP-${h.code} · ${h.title}`],
      ['Conta', h.account],
      ['Emitente', emitterText(emitter)],
      ['Calculado em', `${when(run.createdAt)} por ${run.actorName ?? 'sistema'}${run.reason === 'ganha' ? ' (fechamento)' : ''}`],
      ['Tipo', r.mode === 'recorrente' ? `Contrato mensal, ${r.term.N} meses` : `Pagamento único, recebe no mês ${r.term.d}`],
      ['Segmento', r.publicSector ? 'Público' : 'Privado'],
      ['Resultado', ECON_VERDICT_LABELS[r.verdict]],
    ] as [string, string][],
    kpis: [
      ['Preço', r.priceCents == null ? '—' : `${money(r.priceCents)}${r.mode === 'recorrente' ? '/mês' : ''}`],
      ['Preço mínimo', r.floor.minCents == null ? '—' : money(r.floor.minCents)],
      ['Preço mínimo sugerido', r.suggestedMinCents == null ? '—' : money(r.suggestedMinCents)],
      ['Preço da margem mínima', r.recommendedCents == null ? '—' : money(r.recommendedCents)],
      ['Margem efetiva', k ? `${pct(k.marginPct, 1)} (mínima ${pct(r.rates.m * 100, 1)})` : '—'],
      ['Margens (contribuição / operacional / líquida)', k?.margins ? [k.margins.contributionPct, k.margins.operatingPct, k.margins.netPct].map((v) => (v == null ? 'não informada' : pct(v, 1))).join(' / ') : '—'],
      ['Payback descontado', k ? `${months(k.paybackMonths)} (limite ${r.term.Dalvo}; simples ${months(k.simplePaybackMonths)})` : '—'],
      ['VPL', k ? money(k.npvCents) : '—'],
      ['TIR', k?.irrAnnual == null ? '—' : k.irrAnnual > 10 ? 'acima de 1.000% ao ano' : `${pct(k.irrAnnual * 100, 1)} ao ano`],
      ['Premissas', `TMA ${pct(r.rates.r * 100)} ao mês · comissão ${pct(r.rates.c * 100)} · glosa ${pct(r.rates.g * 100)} · tributos ${pct(r.rates.a * 100)}${r.fixedTaxCents ? ` + ${money(r.fixedTaxCents)} por fatura` : ''}`],
    ] as [string, string][],
    footer: `Motor ${run.engineVersion ?? r.engineVersion ?? 'anterior'} · ${run.sha256 ? `SHA-256 ${run.sha256}${run.verified ? ' (conferido)' : ' (NÃO confere)'}` : 'cálculo anterior à assinatura (não verificado)'}`,
  };
}

const csvCell = (v: string | number | null | undefined) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const cents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

export function buildEconCsv(run: Run, h: RunHeader) {
  const r = run.result;
  const sm = summary(run, h);
  const rows: (string | number | null)[][] = [
    ['Viabilidade econômica'], ...sm.head, [], ...sm.kpis, [],
    ['DRE', 'Por mês (R$)', r.mode === 'recorrente' ? `No contrato, ${r.term.N} meses (R$)` : 'Na venda (R$)'],
    ...econDre(r, money).map((d) => [`${d.sign} ${d.label}`, cents(d.month), cents(d.total)]),
    [], ['Produto', 'Documento fiscal', 'Versão dos tributos', 'Peso na receita', 'Tributos %', 'Tributo fixo (R$)'],
    ...r.items.map((i) => [i.description, i.doc ?? 'sem documento', i.docVersion ?? '', pct(i.weight * 100), pct(i.percentBp / 100), cents(i.fixedCents)]),
    [], ['Custo', 'Tipo', 'Quantidade', 'Valor unitário (R$)', 'Origem'],
    ...[...run.input.capex.map((l) => ({ l, t: 'Investimento' })), ...run.input.opex.map((l) => ({ l, t: 'Mensal' }))].map(({ l, t }) => [l.description, t, `${(l.qtyMilli / 1000).toLocaleString('pt-BR')}${l.unit ? ` ${l.unit}` : ''}`, cents(l.unitCents), l.costItemId ? (l.manual ? 'catálogo, valor alterado' : 'catálogo') : 'manual']),
    [], ['Mês', 'Fluxo do mês (R$)', 'Acumulado (R$)'],
    ...(() => { let acc = 0; return r.cashflow.map((f, i) => { acc += f; return [i === 0 ? 'Início' : `M${i}`, cents(f), cents(acc)]; }); })(),
    [], [sm.footer],
  ];
  return `﻿${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

export async function buildEconPdf(run: Run, h: RunHeader) {
  const r: EconResult = run.result;
  const sm = summary(run, h);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 48, ink = rgb(0.18, 0.2, 0.22), muted = rgb(0.42, 0.45, 0.5), line = rgb(0.85, 0.87, 0.9);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const need = (h2: number) => { if (y - h2 < M + 24) { page = doc.addPage([W, H]); y = H - M; } };
  const text = (t: string, x: number, size = 10, f: PDFFont = font, color = ink) => page.drawText(safeText(f, t), { x, y, size, font: f, color });
  const right = (t: string, xr: number, size = 10, f: PDFFont = font, color = ink) => { const s = safeText(f, t); page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y, size, font: f, color }); };
  const para = (t: string, size = 10, f: PDFFont = font, color = ink) => { for (const l of wrap(f, t, size, W - 2 * M)) { need(size + 4); text(l, M, size, f, color); y -= size + 4; } };
  const rule = () => { page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: line }); };
  const section = (t: string) => { y -= 8; need(28); text(t, M, 12, bold); y -= 8; rule(); y -= 10; };

  text('Viabilidade econômica', M, 18, bold); y -= 26;
  for (const [k, v] of sm.head) { need(14); text(k, M, 9, font, muted); for (const [i, l] of wrap(font, v, 10, W - 2 * M - 110).entries()) { if (i) { y -= 13; need(14); } text(l, M + 110, 10, k === 'Resultado' ? bold : font); } y -= 14; }
  y -= 4;
  para(econHeadline(r, (c) => (c == null ? '—' : money(c))), 10.5, font);

  section('Indicadores');
  for (const [k, v] of sm.kpis) { for (const [i, l] of wrap(font, v, 10, W - 2 * M - 150).entries()) { need(14); if (!i) text(k, M, 9, font, muted); text(l, M + 150, 10); y -= 14; } }

  const dre = econDre(r, money);
  if (dre.length) {
    section('DRE da oportunidade');
    const c1 = W - M - 130, c2 = W - M;
    need(14); if (r.mode === 'recorrente') right('Por mês', c1, 9, font, muted); right(r.mode === 'recorrente' ? `No contrato (${r.term.N} meses)` : 'Na venda', c2, 9, font, muted); y -= 15;
    for (const d of dre) {
      need(15);
      if (d.sign === '=') page.drawLine({ start: { x: M, y: y + 11 }, end: { x: W - M, y: y + 11 }, thickness: 0.6, color: line });
      const f = d.strong ? bold : font;
      // Helvetica (WinAnsi) não tem o sinal de menos tipográfico
      text(d.sign === '−' ? '-' : d.sign, M, 10, bold, d.sign === '+' ? rgb(0.22, 0.52, 0.83) : d.sign === '−' ? rgb(0.83, 0.46, 0.17) : muted);
      text(`${d.label}${d.note ? `  (${d.note})` : ''}`.replace(/−/g, '-'), M + 16, 10, f);
      if (r.mode === 'recorrente') right(d.month == null ? '—' : money(d.month), c1, 10, f);
      right(money(d.total), c2, 10, f, d.tone ? (d.total < 0 ? rgb(0.82, 0.2, 0.2) : rgb(0.1, 0.55, 0.3)) : ink);
      y -= 15;
    }
  }

  if (r.items.length) {
    section('Produtos e tributos');
    for (const i of r.items) { need(14); text(i.description.slice(0, 48), M, 9.5); text(`${i.doc ?? 'sem documento'}${i.docVersion ? ` v${i.docVersion}` : ''}`.slice(0, 40), M + 230, 9.5, font, i.pending ? rgb(0.76, 0.38, 0.05) : ink); right(`${pct(i.weight * 100, 1)} · ${pct(i.percentBp / 100)}`, W - M, 9.5); y -= 14; }
  }
  const costs = [...run.input.capex.map((l) => ({ l, t: 'Investimento' })), ...run.input.opex.map((l) => ({ l, t: 'Mensal' }))];
  if (costs.length) {
    section('Custos');
    for (const { l, t } of costs) { need(14); text(l.description.slice(0, 50), M, 9.5); text(`${t} · ${l.costItemId ? (l.manual ? 'catálogo, alterado' : 'catálogo') : 'manual'}`, M + 250, 9, font, muted); right(`${(l.qtyMilli / 1000).toLocaleString('pt-BR')}${l.unit ? ` ${l.unit}` : ''} × ${money(l.unitCents)}`, W - M, 9.5); y -= 14; }
  }
  if (r.cashflow.length > 1) {
    section('Fluxo de caixa');
    let acc = 0;
    const cols = 3, colW = (W - 2 * M) / cols;
    const rows = r.cashflow.map((f, i) => { acc += f; return [i === 0 ? 'Início' : `M${i}`, money(f), money(acc)] as const; });
    const per = Math.ceil(rows.length / cols);
    need(Math.min(per, 40) * 12 + 14);
    for (let c = 0; c < cols; c++) { const x = M + c * colW; page.drawText('Mês     Fluxo / Acumulado', { x, y, size: 8, font, color: muted }); }
    y -= 12;
    for (let k = 0; k < per; k++) {
      need(12);
      for (let c = 0; c < cols; c++) { const row = rows[c * per + k]; if (!row) continue; const x = M + c * colW; page.drawText(safeText(font, row[0]), { x, y, size: 8.5, font, color: muted }); const t = safeText(font, `${row[1]} / ${row[2]}`); page.drawText(t, { x: x + colW - 8 - font.widthOfTextAtSize(t, 8.5), y, size: 8.5, font, color: ink }); }
      y -= 12;
    }
  }
  if (r.warnings.length) { section('Avisos'); for (const w of r.warnings) para(`- ${w}`, 9.5); }
  // rodapé em todas as páginas
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    for (const [n, l] of wrap(font, `${sm.footer} · página ${i + 1} de ${pages.length}`, 7.5, W - 2 * M).entries()) p.drawText(safeText(font, l), { x: M, y: 28 - n * 9, size: 7.5, font, color: muted });
  });
  return Buffer.from(await doc.save());
}
