/**
 * Ofícios — motor do documento: blocos posicionados (mm) sobre o timbrado da filial, {{variáveis}} da negociação,
 * **negrito**, __sublinhado__ e _itálico_, texto justificado com recuo de parágrafo, imagem da assinatura e quebra
 * de página. Devolve o PDF e a caixa de cada bloco (para o editor arrastar os blocos por cima da prévia).
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import * as s from '../db/schema';
import type { OfficeBlock } from '../db/schema';
import type { DbOrTx } from '../db/client';
import { letterheadForBranch } from './contractErp';
import { letterheadPainter } from './economicsExport';
import { safeText } from './proposals';
import { dataUrlImage, pngIntact } from './images';
import type { OfficeTable } from './officeAdjust';

export const OFFICE_VARS: { key: string; label: string; sample: string }[] = [
  { key: 'oficio.numero', label: 'Número do ofício (gerado ao emitir)', sample: '71/2026' },
  { key: 'data.extenso', label: 'Data por extenso', sample: '05 de novembro de 2026' },
  { key: 'data.curta', label: 'Data (dd/mm/aaaa)', sample: '05/11/2026' },
  { key: 'filial.cidade', label: 'Cidade da filial', sample: 'Aracaju' },
  { key: 'filial.uf', label: 'UF da filial', sample: 'SE' },
  { key: 'filial.nome', label: 'Nome da filial', sample: 'BKT Sergipe' },
  { key: 'filial.razao_social', label: 'Razão social da filial', sample: 'BKT SOLUÇÕES E TECNOLOGIA LTDA' },
  { key: 'filial.cnpj', label: 'CNPJ da filial', sample: '18.929.415/0001-00' },
  { key: 'assinante.nome', label: 'Quem assina', sample: 'José Welliton Sá da Silva' },
  { key: 'assinante.cargo', label: 'Cargo de quem assina', sample: 'Diretor Executivo' },
  { key: 'destinatario.saudacao', label: 'Saudação (Ao Senhor / À Senhora)', sample: 'Ao Senhor' },
  { key: 'destinatario.tratamento', label: 'Tratamento (Senhor / Senhora)', sample: 'Senhor' },
  { key: 'destinatario.nome', label: 'Destinatário', sample: 'Luciano Gois Paul' },
  { key: 'destinatario.cargo', label: 'Cargo do destinatário', sample: 'Diretor-Presidente' },
  { key: 'orgao.nome', label: 'Órgão / cliente', sample: 'Companhia de Saneamento de Sergipe - DESO' },
  { key: 'contrato.numero', label: 'Número do contrato', sample: '171/2022' },
  { key: 'contrato.objeto', label: 'Objeto do contrato', sample: 'a contratação de empresa especializada na prestação de serviços de tecnologia da informação e comunicação - TIC' },
  { key: 'contrato.processo', label: 'Número do processo', sample: '2022.01.0001' },
  { key: 'contrato.assinatura', label: 'Data de assinatura do contrato', sample: '24 de novembro de 2022' },
  { key: 'contrato.indice', label: 'Índice de reajuste', sample: 'Índice Nacional de Preços ao Consumidor Amplo – IPCA' },
  { key: 'contrato.clausula_renovacao', label: 'Cláusula de renovação do contrato', sample: 'Cláusula Sexta – O presente contrato poderá ser prorrogado por iguais e sucessivos períodos, até o limite de 120 meses.' },
  { key: 'contrato.vigencia', label: 'Vigência atual do contrato', sample: '24/11/2025 a 23/11/2026' },
  { key: 'reajuste.percentual', label: 'Reajuste: percentual (médio ponderado)', sample: '4,68%' },
  { key: 'reajuste.indice', label: 'Reajuste: índice', sample: 'IPCA' },
  { key: 'reajuste.data_base', label: 'Reajuste: aniversário da data-base', sample: '24 de novembro de 2026' },
  { key: 'reajuste.mensal_atual', label: 'Reajuste: valor mensal atual', sample: 'R$ 10.000,00' },
  { key: 'reajuste.mensal_novo', label: 'Reajuste: valor mensal reajustado', sample: 'R$ 10.468,00' },
  { key: 'renovacao.inicio', label: 'Renovação: início da nova vigência', sample: '24 de novembro de 2026' },
  { key: 'renovacao.termino', label: 'Renovação: término da nova vigência', sample: '23 de novembro de 2027' },
  { key: 'renovacao.prazo', label: 'Renovação: prazo', sample: '12 (doze) meses' },
  { key: 'tabela.reajuste', label: 'Tabela: reajuste por item (atual × reajustado)', sample: '' },
  { key: 'tabela.indices', label: 'Tabela: índices de referência (Banco Central)', sample: '' },
  { key: 'negociacao.codigo', label: 'Código da negociação', sample: 'OP-1024' },
  { key: 'negociacao.titulo', label: 'Título da negociação', sample: 'Reajuste DESO' },
];
const VAR_LABEL = new Map(OFFICE_VARS.map((v) => [v.key, v.label]));
export const SAMPLE_VARS = Object.fromEntries(OFFICE_VARS.map((v) => [v.key, v.sample]));

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const dateLong = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d} de ${MONTHS[Number(m) - 1]} de ${y}`; };
const INDEX_LABEL: Record<string, string> = { IPCA: 'Índice Nacional de Preços ao Consumidor Amplo – IPCA', INPC: 'Índice Nacional de Preços ao Consumidor – INPC', 'IGP-M': 'Índice Geral de Preços do Mercado – IGP-M', 'IGP-DI': 'Índice Geral de Preços – Disponibilidade Interna – IGP-DI' };

/** Modelo inicial: o ofício de reajuste, já com as variáveis no lugar (a empresa ajusta o texto e a posição). */
export const DEFAULT_BLOCKS: OfficeBlock[] = [
  { id: 'cabecalho', kind: 'texto', label: 'Número e data', x: 20, y: 40, w: 170, align: 'right', size: 11, lineGap: 1.35, indent: 0, paraGap: 0, text: '**OFÍCIO Nº {{oficio.numero}}**\n{{filial.cidade}}, {{data.extenso}}.' },
  { id: 'destinatario', kind: 'texto', label: 'Destinatário', x: 20, y: 58, w: 170, align: 'left', size: 11, lineGap: 1.35, indent: 0, paraGap: 0, text: '{{destinatario.saudacao}}\n**{{destinatario.nome}}**\n{{destinatario.cargo}} da {{orgao.nome}}' },
  { id: 'assunto', kind: 'texto', label: 'Assunto', x: 20, y: 80, w: 170, align: 'left', size: 11, lineGap: 1.35, indent: 0, paraGap: 0, text: '**Assunto: __Solicitação de Reajuste do Contrato nº {{contrato.numero}}__.**' },
  {
    id: 'corpo', kind: 'texto', label: 'Corpo', x: 20, y: 92, w: 170, align: 'justify', size: 11, lineGap: 1.45, indent: 12, paraGap: 3.5,
    text: '{{destinatario.tratamento}} {{destinatario.cargo}},\n\nEm atenção ao contrato de __nº {{contrato.numero}}__ que tem por objeto {{contrato.objeto}}, **__solicitamos o reajuste do referido instrumento contratual, tendo em vista o intervalo temporal superior a 12 meses__**.\n\nFrisa-se que, conforme cláusula nona do citado documento, o preço consignado no contrato será corrigido anualmente, observado o interregno mínimo de um ano, contado da data limite para apresentação da proposta, aplicando-se o **__{{contrato.indice}}__**.\n\nAinda, segundo a Lei n.º 13.303/2016, art. 81, § 7º, **_“__a variação do valor contratual para fazer face ao reajuste de preços previsto no próprio contrato__,_** as atualizações, compensações ou penalizações financeiras decorrentes das condições de pagamento nele previstas, bem como o empenho de dotações orçamentárias suplementares até o limite do seu valor corrigido, **__não caracterizam alteração do mesmo, podendo ser registrados por simples apostila, dispensando a celebração de aditamento__**”.\n\nAtenciosamente,',
  },
  { id: 'assinatura', kind: 'assinatura', label: 'Assinatura', x: 55, y: 228, w: 100, align: 'center', size: 8.5, lineGap: 1.3, indent: 0, paraGap: 0, text: '{{filial.razao_social}}\nCNPJ: {{filial.cnpj}}\n{{assinatura}}\n_{{assinante.nome}}_\n{{assinante.cargo}}' },
];

/** Troca as {{variáveis}}; o que faltar aparece entre colchetes (fica visível na prévia, ninguém emite sem perceber). */
export function fillVars(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_m, k: string) => (k === 'assinatura' || k.startsWith('tabela.') ? `{{${k}}}` : vars[k]?.trim() ? vars[k]! : `[${VAR_LABEL.get(k) ?? k}]`));
}
export const usedVars = (blocks: OfficeBlock[]) => [...new Set(blocks.flatMap((b) => [...b.text.matchAll(/\{\{\s*([a-z_.]+)\s*\}\}/g)].map((m) => m[1]!)))].filter((k) => k !== 'assinatura' && !k.startsWith('tabela.'));

type Style = { b: boolean; i: boolean; u: boolean };
type Seg = { text: string; st: Style };
type Word = Seg[];

/** **negrito**, __sublinhado__ e _itálico_ (o "_" só conta na borda de palavra, para não quebrar nomes com sublinhado). */
function parseLine(line: string): Word[] {
  const st: Style = { b: false, i: false, u: false };
  const words: Word[] = [];
  let word: Word = [];
  let cur = '';
  const pushSeg = () => { if (cur) { word.push({ text: cur, st: { ...st } }); cur = ''; } };
  const pushWord = () => { pushSeg(); if (word.length) words.push(word); word = []; };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (line.startsWith('**', i)) { pushSeg(); st.b = !st.b; i++; continue; }
    if (line.startsWith('__', i)) { pushSeg(); st.u = !st.u; i++; continue; }
    if (ch === '_') {
      const prev = line[i - 1] ?? ' ', next = line[i + 1] ?? ' ';
      if (/[\s(“"'*]/.test(prev) || /[\s.,;:!?)”"'*]/.test(next)) { pushSeg(); st.i = !st.i; continue; }
    }
    if (/\s/.test(ch)) { pushWord(); continue; }
    cur += ch;
  }
  pushWord();
  return words;
}

type Fonts = Record<'r' | 'b' | 'i' | 'bi', PDFFont>;
const fontOf = (f: Fonts, st: Style) => (st.b && st.i ? f.bi : st.b ? f.b : st.i ? f.i : f.r);
const MM = 72 / 25.4;

export type OfficeRenderInput = {
  blocks: OfficeBlock[]; vars: Record<string, string>;
  letterhead: Awaited<ReturnType<typeof letterheadForBranch>>;
  signature?: { mime: string; data: Buffer } | null;
  /** tabelas de {{tabela.x}} (reajuste por item, índices de referência) */
  tables?: Record<string, OfficeTable>;
};

export async function renderOffice(input: OfficeRenderInput) {
  const doc = await PDFDocument.create();
  const fonts: Fonts = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold), i: await doc.embedFont(StandardFonts.HelveticaOblique), bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique) };
  const paint = await letterheadPainter(doc, input.letterhead);
  let sigImg: PDFImage | null = null;
  if (input.signature && (input.signature.mime !== 'image/png' || pngIntact(input.signature.data))) { try { sigImg = input.signature.mime === 'image/png' ? await doc.embedPng(input.signature.data) : await doc.embedJpg(input.signature.data); } catch { sigImg = null; } }
  const pages: PDFPage[] = [];
  const page = (n: number) => { while (pages.length <= n) { const p = doc.addPage([595.28, 841.89]); paint?.(p); pages.push(p); } return pages[n]!; };
  page(0);
  const H = 841.89;
  const topMm = input.letterhead?.topMm ?? 20;
  const bottomMm = input.letterhead?.bottomMm ?? 20;
  const boxes: { id: string; page: number; x: number; y: number; w: number; h: number }[] = [];
  const ink = rgb(0.1, 0.1, 0.12);

  for (const b of input.blocks) {
    const size = Math.max(6, Math.min(28, b.size));
    const lineH = size * Math.max(1, b.lineGap);
    const width = Math.max(10, b.w) * MM;
    const left = b.x * MM;
    let pg = 0;
    let y = H - b.y * MM; // linha de base desce a partir do topo do bloco
    const startY = y;
    const ensure = () => { if (y - lineH < bottomMm * MM) { pg++; page(pg); y = H - topMm * MM; } };
    const text = fillVars(b.text, input.vars).replace(/\r/g, '');
    const lines = text.split('\n');
    let paraStart = true;
    for (const raw of lines) {
      if (!raw.trim()) { y -= b.paraGap * MM + lineH * 0.35; paraStart = true; continue; }
      if (raw.trim() === '{{assinatura}}') {
        const h = (b.sigH ?? 13) * MM;
        // a imagem inserida no bloco vale mais que a da filial
        let img = sigImg;
        if (b.sigImage) { const im = dataUrlImage(b.sigImage); if (im) { try { img = im.mime === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes); } catch { /* imagem inválida: segue sem */ } } }
        if (img) {
          const sigImgUse = img;
          const ratio = sigImgUse.width / sigImgUse.height;
          const w = Math.min(width, h * ratio);
          const x = (b.align === 'left' ? left : b.align === 'right' ? left + width - w : left + (width - w) / 2) + (b.sigDx ?? 0) * MM;
          if (y - h < bottomMm * MM) { pg++; page(pg); y = H - topMm * MM; }
          page(pg).drawImage(sigImgUse, { x, y: y - h - (b.sigDy ?? 0) * MM, width: w, height: h });
        }
        y -= h;
        continue;
      }
      const tm = /^\{\{tabela\.([a-z_]+)\}\}$/.exec(raw.trim());
      if (tm) {
        const tbl = input.tables?.[tm[1]!];
        if (tbl) {
          const r = drawTable(tbl, { page, pg, y, left, width, size, fonts, top: H - topMm * MM, bottom: bottomMm * MM });
          pg = r.pg; y = r.y - b.paraGap * MM; paraStart = true;
          continue;
        }
      }
      const words = parseLine(safeLine(tm ? `[${VAR_LABEL.get(`tabela.${tm[1]}`) ?? 'Tabela'}: preenchida na emissão]` : raw, fonts));
      const wW = (w: Word) => w.reduce((a, s2) => a + fontOf(fonts, s2.st).widthOfTextAtSize(s2.text, size), 0);
      const space = fonts.r.widthOfTextAtSize(' ', size);
      // quebra de linha gulosa; o recuo vale só para a primeira linha do parágrafo
      const out: { words: Word[]; avail: number; indent: number }[] = [];
      let curWords: Word[] = [];
      let curW = 0;
      let indent = paraStart && b.indent ? b.indent * MM : 0;
      for (const w of words) {
        const ww = wW(w);
        const avail = width - indent;
        if (curWords.length && curW + space + ww > avail) { out.push({ words: curWords, avail, indent }); curWords = []; curW = 0; indent = 0; }
        curW += (curWords.length ? space : 0) + ww;
        curWords.push(w);
      }
      if (curWords.length) out.push({ words: curWords, avail: width - indent, indent });
      out.forEach((ln, li) => {
        ensure();
        y -= lineH;
        const lw = ln.words.reduce((a, w, k) => a + wW(w) + (k ? space : 0), 0);
        const last = li === out.length - 1;
        let gap = space;
        let x = left + ln.indent;
        if (b.align === 'justify' && !last && ln.words.length > 1) gap = space + (ln.avail - lw) / (ln.words.length - 1);
        else if (b.align === 'right') x = left + width - lw;
        else if (b.align === 'center') x = left + ln.indent + (ln.avail - lw) / 2;
        const p = page(pg);
        ln.words.forEach((w, k) => {
          for (const sg of w) {
            const f = fontOf(fonts, sg.st);
            const sw = f.widthOfTextAtSize(sg.text, size);
            p.drawText(sg.text, { x, y, size, font: f, color: ink });
            if (sg.st.u) p.drawLine({ start: { x, y: y - size * 0.14 }, end: { x: x + sw, y: y - size * 0.14 }, thickness: Math.max(0.5, size * 0.055), color: ink });
            x += sw;
          }
          const next = ln.words[k + 1];
          if (next && w.at(-1)?.st.u && next[0]?.st.u) p.drawLine({ start: { x, y: y - size * 0.14 }, end: { x: x + gap, y: y - size * 0.14 }, thickness: Math.max(0.5, size * 0.055), color: ink });
          x += gap;
        });
      });
      paraStart = false;
    }
    const h = pg === 0 ? (startY - y) / MM + 1.5 : (H - b.y * MM - (bottomMm * MM)) / MM;
    boxes.push({ id: b.id, page: 0, x: b.x, y: b.y, w: b.w, h: Math.max(6, h) });
  }
  const bytes = await doc.save();
  return { pdf: Buffer.from(bytes), boxes, pages: pages.length };
}

/**
 * Tabela clean para documento corporativo: régua superior fina em azul-escuro, cabeçalho em versalete cinza, linhas
 * separadas por fio claro, números à direita, total com régua e negrito. Quebra de página entre linhas, repetindo o cabeçalho.
 */
function drawTable(t: OfficeTable, o: { page: (n: number) => PDFPage; pg: number; y: number; left: number; width: number; size: number; fonts: Fonts; top: number; bottom: number }) {
  const fs = Math.max(7, Math.min(9.5, o.size * 0.82));
  const navy = rgb(0.04, 0.1, 0.31), muted = rgb(0.38, 0.41, 0.48), ink = rgb(0.1, 0.1, 0.12), hair = rgb(0.84, 0.86, 0.9), soft = rgb(0.965, 0.97, 0.98);
  const sumW = t.columns.reduce((a, c) => a + c.w, 0);
  const cols = t.columns.map((c) => ({ ...c, px: (c.w / sumW) * o.width }));
  const pad = 5;
  let { pg } = o;
  let y = o.y - o.size * 0.55; // respiro abaixo da linha de texto anterior (descendentes)
  const fit = (txt: string, f: PDFFont, w: number, size: number) => {
    // quebra em até 3 linhas na largura da coluna
    const words = safeText(f, txt).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w2 of words) { const tryL = cur ? `${cur} ${w2}` : w2; if (f.widthOfTextAtSize(tryL, size) <= w - pad * 2 || !cur) cur = tryL; else { lines.push(cur); cur = w2; } }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  };
  const cellX = (k: number) => o.left + cols.slice(0, k).reduce((a, c) => a + c.px, 0);
  const lh = fs * 1.3;
  const header = () => {
    const hs = fs * 0.86;
    const hl = cols.map((c) => fit(c.label.toUpperCase(), o.fonts.b, c.px, hs));
    const h = Math.max(...hl.map((l) => l.length)) * hs * 1.25 + 9;
    if (y - h - lh * 2 < o.bottom) { pg++; o.page(pg); y = o.top; }
    const p = o.page(pg);
    p.drawLine({ start: { x: o.left, y }, end: { x: o.left + o.width, y }, thickness: 1.1, color: navy });
    const maxL = Math.max(...hl.map((l) => l.length));
    hl.forEach((ls, k) => ls.forEach((l, li) => {
      const w = o.fonts.b.widthOfTextAtSize(l, hs);
      const x = cols[k]!.align === 'right' ? cellX(k) + cols[k]!.px - pad - w : cellX(k) + pad;
      // cabeçalhos alinhados pela base (o de uma linha fica junto do fio, como os de duas)
      p.drawText(l, { x, y: y - 5 - hs - (li + maxL - ls.length) * hs * 1.25, size: hs, font: o.fonts.b, color: muted });
    }));
    y -= h;
    p.drawLine({ start: { x: o.left, y }, end: { x: o.left + o.width, y }, thickness: 0.5, color: navy });
  };
  header();
  const row = (cells: string[], bold: boolean, kind: 'row' | 'total', zebra: boolean) => {
    const f = bold ? o.fonts.b : o.fonts.r;
    const ls = cells.map((c, k) => fit(c, f, cols[k]!.px, fs));
    const h = Math.max(1, ...ls.map((l) => l.length)) * lh + 7;
    if (y - h < o.bottom) { pg++; o.page(pg); y = o.top; header(); }
    const p = o.page(pg);
    if (kind === 'total') p.drawLine({ start: { x: o.left, y }, end: { x: o.left + o.width, y }, thickness: 0.8, color: navy });
    else if (zebra) p.drawRectangle({ x: o.left, y: y - h, width: o.width, height: h, color: soft });
    ls.forEach((lines, k) => lines.forEach((l, li) => {
      const w = f.widthOfTextAtSize(l, fs);
      const x = cols[k]!.align === 'right' ? cellX(k) + cols[k]!.px - pad - w : cellX(k) + pad;
      p.drawText(l, { x, y: y - 4 - fs - li * lh, size: fs, font: f, color: kind === 'total' ? navy : ink });
    }));
    y -= h;
    if (kind === 'row') p.drawLine({ start: { x: o.left, y }, end: { x: o.left + o.width, y }, thickness: 0.35, color: hair });
  };
  t.rows.forEach((r, i) => row(r, !!t.strong?.includes(i), 'row', i % 2 === 1));
  if (t.total) row(t.total, true, 'total', false);
  else { const p = o.page(pg); p.drawLine({ start: { x: o.left, y }, end: { x: o.left + o.width, y }, thickness: 0.8, color: navy }); }
  if (t.note) {
    const ns = fs * 0.85;
    const lines = fit(t.note, o.fonts.i, o.width + pad * 2, ns);
    for (const l of lines) { y -= ns * 1.4; if (y < o.bottom) { pg++; o.page(pg); y = o.top - ns; } o.page(pg).drawText(l, { x: o.left, y, size: ns, font: o.fonts.i, color: muted }); }
    y -= ns * 0.6;
  }
  return { pg, y: y - fs * 0.8 };
}

/** Caracteres que a Helvetica não escreve viram equivalentes (preservando os marcadores de estilo). */
function safeLine(line: string, fonts: Fonts) { return safeText(fonts.r, line); }

/**
 * Valores iniciais a partir do contrato (versão vigente: número, objeto, órgão, processo, assinatura, índice) e da
 * negociação de origem (filial, código). Destinatários: pessoas ligadas ao contrato e à negociação. Tudo é ajustável.
 */
export async function officeDefaults(db: DbOrTx, tenantId: string, contractId: string, today: string, opts: { recipientPersonId?: string | null; branchId?: string | null } = {}) {
  const [c] = await db.select().from(s.contracts).where(and(eq(s.contracts.tenantId, tenantId), eq(s.contracts.id, contractId))).limit(1);
  if (!c) return { vars: {} as Record<string, string>, branchId: null as string | null, opportunityId: null as string | null, recipients: [] as { personId: string; name: string; email: string | null; title: string | null; role: string }[], recipientPersonId: null as string | null };
  const [o] = c.opportunityId ? await db.select().from(s.opportunities).where(eq(s.opportunities.id, c.opportunityId)).limit(1) : [];
  // filial do contrato; sem ela, a da negociação de origem (ou a escolhida na emissão)
  const branchId = opts.branchId ?? c.branchId ?? o?.branchId ?? null;
  const [contact] = await db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
  const [branch] = branchId ? await db.select().from(s.salesBranches).where(and(eq(s.salesBranches.tenantId, tenantId), eq(s.salesBranches.id, branchId))).limit(1) : [];
  const [signer] = branchId ? await db.select({ legalName: s.branchSigners.legalName, signerName: s.branchSigners.signerName, signerRole: s.branchSigners.signerRole }).from(s.branchSigners).where(eq(s.branchSigners.branchId, branchId)).limit(1) : [];
  const [ver] = await db.select().from(s.contractVersions).where(eq(s.contractVersions.contractId, c.id)).orderBy(desc(s.contractVersions.version)).limit(1);
  const links = async (entityType: string, entityId: string) => db.select({ personId: s.people.id, name: s.people.name, email: s.people.email, title: s.accountStakeholders.title, role: s.stakeholderLinks.role })
    .from(s.stakeholderLinks).innerJoin(s.accountStakeholders, eq(s.accountStakeholders.id, s.stakeholderLinks.stakeholderId)).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId))
    .where(and(eq(s.stakeholderLinks.tenantId, tenantId), eq(s.stakeholderLinks.entityType, entityType), eq(s.stakeholderLinks.entityId, entityId), isNull(s.stakeholderLinks.removedAt)));
  const all = [...(await links('contrato', c.id)), ...(o ? await links('oportunidade', o.id) : [])];
  const recipients = all.filter((r, i) => all.findIndex((x) => x.personId === r.personId) === i);
  const order = ['gestor_contrato', 'decisor', 'contato_principal', 'patrocinador', 'aprovador_financeiro'];
  const pick = recipients.find((r) => r.personId === opts.recipientPersonId) ?? [...recipients].sort((a, b) => (order.indexOf(a.role) + 1 || 99) - (order.indexOf(b.role) + 1 || 99))[0];
  const custom = (o?.custom ?? {}) as Record<string, unknown>;
  const pt = ver?.publicTerms as { agency?: string | null; processNumber?: string | null } | null | undefined;
  const year = Number(today.slice(0, 4));
  const [seq] = branchId ? await db.select({ next: s.officeLetterSeq.nextNumber }).from(s.officeLetterSeq).where(and(eq(s.officeLetterSeq.branchId, branchId), eq(s.officeLetterSeq.year, year))).limit(1) : [];
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const vars: Record<string, string> = {
    'oficio.numero': `${seq?.next ?? 1}/${year}`,
    'data.extenso': dateLong(today), 'data.curta': today.split('-').reverse().join('/'),
    'filial.cidade': branch?.city ?? '', 'filial.uf': branch?.state ?? '', 'filial.nome': branch?.name ?? '',
    'filial.razao_social': signer?.legalName || branch?.name || '', 'filial.cnpj': branch?.cnpj ?? '',
    'assinante.nome': signer?.signerName ?? '', 'assinante.cargo': signer?.signerRole ?? '',
    'destinatario.saudacao': 'Ao Senhor', 'destinatario.tratamento': 'Senhor',
    'destinatario.nome': pick?.name ?? '', 'destinatario.cargo': pick?.title ?? '',
    'orgao.nome': pt?.agency || str(custom.orgao_contratante) || contact?.name || '',
    'contrato.numero': ver?.number ?? '', 'contrato.objeto': ver?.object ?? '',
    'contrato.processo': pt?.processNumber || str(custom.numero_processo),
    'contrato.assinatura': ver?.signedAt ? dateLong(ver.signedAt) : '',
    'contrato.indice': ver?.adjustmentIndex ? (INDEX_LABEL[ver.adjustmentIndex.toUpperCase()] ?? ver.adjustmentIndex) : '',
    'contrato.clausula_renovacao': c.renewalClause ?? '',
    'contrato.vigencia': ver?.startAt && ver?.endAt ? `${ver.startAt.split('-').reverse().join('/')} a ${ver.endAt.split('-').reverse().join('/')}` : '',
    'negociacao.codigo': o ? `OP-${o.code}` : '', 'negociacao.titulo': o?.title ?? '',
  };
  return { vars, branchId, opportunityId: o?.id ?? null, recipients: recipients.map((r) => ({ personId: r.personId, name: r.name, email: r.email, title: r.title, role: r.role })), recipientPersonId: pick?.personId ?? null };
}

/** Timbrado e assinatura da filial (para a prévia e a emissão). */
export async function branchArt(db: DbOrTx, tenantId: string, branchId: string | null) {
  const letterhead = await letterheadForBranch(db, tenantId, branchId);
  const [sig] = branchId ? await db.select({ mime: s.branchSigners.signatureMime, data: s.branchSigners.signatureData }).from(s.branchSigners).where(and(eq(s.branchSigners.tenantId, tenantId), eq(s.branchSigners.branchId, branchId))).limit(1) : [];
  return { letterhead, signature: sig?.mime && sig.data ? { mime: sig.mime, data: Buffer.from(sig.data as unknown as Uint8Array) } : null };
}
