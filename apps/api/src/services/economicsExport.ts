/**
 * Exportação de um cálculo salvo da viabilidade econômica (CSV e PDF). Usa só o que foi gravado: nada é recalculado.
 * O desdobramento financeiro sai da mesma função da tela (econDre), e o rodapé traz a versão do motor e o hash do cálculo.
 * Com timbrado na filial, cada página é desenhada sobre ele, dentro das margens configuradas.
 */
import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { ECON_VERDICT_LABELS, econDre, econHeadline, econMemory, type EconResult } from '@isp/domain';
import { TAX_REGIME_LABELS, type TaxRegime } from '@isp/shared';
import { brl } from './email';
import { safeText, wrap } from './proposals';
import type { economicsRun } from './economics';

type Run = NonNullable<Awaited<ReturnType<typeof economicsRun>>>;
/** Memória de cálculo com os fatores históricos da fotografia (os parâmetros da época do cálculo). */
const memoryOf = (run: Run) => { const st = run.settings as { legacyOneTimeX100?: number | null; legacyRecurringX100?: number | null }; return econMemory(run.result, money, { legacy: { oneTimeX100: st.legacyOneTimeX100, recurringX100: st.legacyRecurringX100 } }); };
export type RunHeader = { code: number; title: string; account: string };
export type Letterhead = { mime: string; data: Buffer; topMm: number; bottomMm: number; sideMm: number };
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
      ['Preço da margem mínima', r.marginPriceCents == null ? '—' : money(r.marginPriceCents)],
      ['Margem efetiva', k ? `${pct(k.marginPct, 1)} (mínima ${pct(r.rates.m * 100, 1)})` : '—'],
      ...(k?.margins ? ([['Margem de contribuição', k.margins.contributionPct], ['Margem operacional', k.margins.operatingPct], ['Margem líquida', k.margins.netPct]] as const).map(([l, v]) => [l, v == null ? 'parâmetro não informado' : pct(v, 1)]) : []),
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
    ['Memória de cálculo', 'Fórmula', 'Valor'],
    ...memoryOf(run).flatMap((st, n) => [[`${n + 1}. ${st.title}`], ...st.rows.map((x) => [x.label, x.formula ?? '', x.value]), ...(st.note ? [[st.note]] : [])]),
    [],
    ['Desdobramento financeiro', 'Por mês (R$)', r.mode === 'recorrente' ? `No contrato, ${r.term.N} meses (R$)` : 'Na venda (R$)'],
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

/** Nome do arquivo e título do PDF: Viabilidade-OP-<código>-<DDMMAAAA> (data da emissão, horário de Brasília). */
export function econFileName(code: number, at = new Date()) {
  const [d, m, y] = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(at).split('/');
  return `Viabilidade-OP-${code}-${d}${m}${y}`;
}

const MM = 72 / 25.4;
/** Fundo de cada página: o timbrado da filial (imagem esticada na página A4 ou a 1ª página do PDF). */
async function letterheadPainter(doc: PDFDocument, lh: Letterhead | null | undefined) {
  if (!lh) return null;
  if (lh.mime === 'application/pdf') {
    const [art] = await doc.embedPdf(lh.data, [0]);
    return (p: PDFPage) => p.drawPage(art as PDFEmbeddedPage, { x: 0, y: 0, ...p.getSize() });
  }
  const img: PDFImage = lh.mime === 'image/png' ? await doc.embedPng(lh.data) : await doc.embedJpg(lh.data);
  return (p: PDFPage) => p.drawImage(img, { x: 0, y: 0, ...p.getSize() });
}

export async function buildEconPdf(run: Run, h: RunHeader, letterhead?: Letterhead | null, sample = false) {
  const r: EconResult = run.result;
  const sm = summary(run, h);
  const doc = await PDFDocument.create();
  const title = econFileName(h.code);
  doc.setTitle(title); doc.setSubject(`Viabilidade econômica OP-${h.code}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, ink = rgb(0.18, 0.2, 0.22), muted = rgb(0.42, 0.45, 0.5), line = rgb(0.85, 0.87, 0.9);
  // área do texto: margens do timbrado (ou 17 mm sem timbrado)
  const M = letterhead ? letterhead.sideMm * MM : 48, TOP = letterhead ? letterhead.topMm * MM : 48, BOT = letterhead ? letterhead.bottomMm * MM : 48;
  const paint = await letterheadPainter(doc, letterhead);
  const newPage = () => { const p = doc.addPage([W, H]); paint?.(p); if (sample) p.drawRectangle({ x: M, y: BOT, width: W - 2 * M, height: H - TOP - BOT, borderColor: rgb(0.2, 0.45, 0.85), borderWidth: 0.8, borderDashArray: [4, 3] }); return p; };
  let page: PDFPage = newPage();
  let y = H - TOP - 14;
  const need = (h2: number) => { if (y - h2 < BOT + 26) { page = newPage(); y = H - TOP - 14; } };
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
  {
    // duas colunas: indicador à esquerda, número alinhado à direita; linhas alternadas para leitura
    const valW = (W - 2 * M) * 0.5, labW = W - 2 * M - valW - 12;
    sm.kpis.forEach(([k, v], idx) => {
      const ls = wrap(font, k, 9.5, labW), vs = wrap(font, v, 10, valW);
      const n = Math.max(ls.length, vs.length), hgt = n * 13 + 5;
      need(hgt);
      if (idx % 2 === 0) page.drawRectangle({ x: M, y: y - hgt + 13, width: W - 2 * M, height: hgt, color: rgb(0.96, 0.97, 0.98) });
      for (let i = 0; i < n; i++) { if (ls[i]) text(ls[i]!, M + 6, 9.5, font, muted); if (vs[i]) right(vs[i]!, W - M - 6, 10, i === 0 ? bold : font); y -= 13; }
      y -= 5;
    });
  }

  // memória de cálculo: passo, linha, fórmula (miúda) e valor à direita
  section('Memória de cálculo');
  const pdfSafe = (s: string) => s.replace(/≈/g, '~').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/−/g, '-');
  memoryOf(run).forEach((st, n) => {
    need(34);
    text(`${n + 1}. ${st.title}`, M, 10.5, bold); y -= 12;
    for (const l of wrap(font, st.desc, 8, W - 2 * M)) { need(10); text(l, M, 8, font, muted); y -= 10; }
    y -= 2;
    for (const row of st.rows) {
      const valW = 150, fl = row.formula ? wrap(font, pdfSafe(row.formula), 7.5, W - 2 * M - valW - 20) : [];
      need(13 + fl.length * 9);
      text(pdfSafe(row.label), M + 8, 9.5, row.strong ? bold : font);
      right(pdfSafe(row.value), W - M, 9.5, row.strong ? bold : font, row.ok === true ? rgb(0.1, 0.55, 0.3) : row.ok === false ? rgb(0.82, 0.2, 0.2) : ink);
      y -= 11;
      for (const l of fl) { text(l, M + 8, 7.5, font, muted); y -= 9; }
      y -= 4;
    }
    if (st.note) for (const l of wrap(font, pdfSafe(st.note), 8.5, W - 2 * M - 8)) { need(11); text(l, M + 8, 8.5, font, rgb(0.55, 0.33, 0.05)); y -= 11; }
    y -= 6;
  });

  const dre = econDre(r, money);
  if (dre.length) {
    section('Desdobramento financeiro');
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
    const fl = wrap(font, `${sm.footer} · página ${i + 1} de ${pages.length}`, 7.5, W - 2 * M);
    // com timbrado, o rodapé do sistema fica logo acima da área do rodapé da arte
    const y0 = letterhead ? BOT + 6 + (fl.length - 1) * 9 : 28;
    fl.forEach((l, n) => p.drawText(safeText(font, l), { x: M, y: y0 - n * 9, size: 7.5, font, color: muted }));
  });
  return Buffer.from(await doc.save());
}

/** Prévia do timbrado: a arte com a área do texto tracejada e um texto de exemplo, para conferir as margens. */
export async function letterheadSample(lh: Letterhead, branchName: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const paint = (await letterheadPainter(doc, lh))!;
  const W = 595.28, H = 841.89, M = lh.sideMm * MM, TOP = lh.topMm * MM, BOT = lh.bottomMm * MM;
  const p = doc.addPage([W, H]);
  paint(p);
  p.drawRectangle({ x: M, y: BOT, width: W - 2 * M, height: H - TOP - BOT, borderColor: rgb(0.2, 0.45, 0.85), borderWidth: 0.8, borderDashArray: [4, 3] });
  let y = H - TOP - 14;
  p.drawText(safeText(bold, 'Viabilidade econômica'), { x: M, y, size: 18, font: bold, color: rgb(0.18, 0.2, 0.22) }); y -= 24;
  for (const l of wrap(font, `Prévia do timbrado da filial ${branchName}. O texto dos documentos fica dentro da área tracejada; ajuste as margens se ele encostar no cabeçalho ou no rodapé da arte.`, 10, W - 2 * M)) { p.drawText(safeText(font, l), { x: M, y, size: 10, font, color: rgb(0.42, 0.45, 0.5) }); y -= 14; }
  return Buffer.from(await doc.save());
}

/** Confere o arquivo do timbrado: PNG, JPG ou PDF legível. */
export async function letterheadMime(data: Buffer) {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') {
    const d = await PDFDocument.load(data, { ignoreEncryption: true });
    return d.getPageCount() > 0 ? 'application/pdf' : null;
  }
  return null;
}
