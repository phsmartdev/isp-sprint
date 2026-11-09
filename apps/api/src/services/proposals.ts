/**
 * Propostas por modelo: a arte (páginas exportadas do Canva em PNG/JPG) vira o fundo e os campos
 * variáveis são escritos por cima nas posições marcadas. Gera PDF e anexa como proposta.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { investmentTable, layoutPhotos, normalizeSections, type InvestmentItem, type ProposalSectionsConfig } from '@isp/domain';
import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export const SYSTEM_VARIABLES = [
  ['cliente.nome', 'Nome / razão social do cliente'],
  ['cliente.documento', 'CPF / CNPJ'],
  ['cliente.telefone', 'Telefone'],
  ['cliente.email', 'E-mail'],
  ['cliente.endereco', 'Endereço de instalação'],
  ['plano.nome', 'Nome do plano'],
  ['plano.servico_fatura', 'Serviço na fatura'],
  ['plano.velocidade', 'Velocidade (Mbps)'],
  ['plano.valor', 'Mensalidade (R$)'],
  ['plano.valor_numero', 'Mensalidade sem "R$" (ex.: 729,90)'],
  ['plano.produtos', 'Produtos do plano (um por linha)'],
  ['oportunidade.taxa_ativacao', 'Taxa de ativação (R$)'],
  ['proposta.numero', 'Número da proposta (PC AAMMDD)'],
  ['proposta.titulo', 'Número da proposta + nome da conta'],
  ['proposta.validade_dias', 'Prazo da proposta (dias)'],
  ['proposta.validade_data', 'Proposta válida até (data)'],
  ['oportunidade.titulo', 'Nome do deal'],
  ['vendedor.nome', 'Vendedor responsável'],
  ['vendedor.email', 'E-mail do vendedor'],
  ['empresa.nome', 'Nome da sua empresa'],
  ['data.hoje', 'Data de hoje (dd/mm/aaaa)'],
] as const;

const brl = (c: number | null | undefined) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' '));
const num = (c: number | null | undefined) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export async function systemValues(db: DbOrTx, tenantId: string, oppId: string, timezone: string) {
  const [o] = await db
    .select({
      title: s.opportunities.title, proposalNumber: s.opportunities.proposalNumber, valueCents: s.opportunities.valueCents, fee: s.opportunities.activationFeeCents,
      street: s.opportunities.installStreet, number: s.opportunities.installNumber, district: s.opportunities.installDistrict, city: s.opportunities.installCity, block: s.opportunities.installBlock, unit: s.opportunities.installUnit,
      contactName: s.contacts.name, document: s.contacts.document, phone: s.contacts.phone, email: s.contacts.email,
      ownerName: s.users.name, ownerEmail: s.users.email, planName: s.plans.name, invoice: s.plans.invoiceServiceName, speed: s.plans.speedMbps, products: s.plans.products, tenantName: s.tenants.name,
      condoName: s.condominiums.name,
    })
    .from(s.opportunities)
    .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
    .innerJoin(s.users, eq(s.users.id, s.opportunities.ownerId))
    .innerJoin(s.tenants, eq(s.tenants.id, s.opportunities.tenantId))
    .leftJoin(s.plans, eq(s.plans.id, s.opportunities.planId))
    .leftJoin(s.condominiums, eq(s.condominiums.id, s.opportunities.condominiumId))
    .where(and(eq(s.opportunities.id, oppId), eq(s.opportunities.tenantId, tenantId)))
    .limit(1);
  if (!o) return {};
  const addr = [o.condoName, [o.street, o.number].filter(Boolean).join(', '), o.block && `Bl. ${o.block}`, o.unit && `Ap. ${o.unit}`, o.district, o.city].filter(Boolean).join(' · ');
  return {
    'cliente.nome': o.contactName, 'cliente.documento': o.document ?? '', 'cliente.telefone': o.phone ?? '', 'cliente.email': o.email ?? '', 'cliente.endereco': addr,
    'plano.nome': o.planName ?? '', 'plano.servico_fatura': o.invoice ?? o.planName ?? '', 'plano.velocidade': o.speed ? `${o.speed} Mbps` : '',
    'plano.valor': brl(o.valueCents), 'plano.valor_numero': num(o.valueCents),
    'plano.produtos': (o.products ?? []).map((p) => `• ${p.qty > 1 ? `${p.qty}× ` : ''}${p.name}`).join('\n'),
    'oportunidade.taxa_ativacao': o.fee == null ? 'R$ 0,00' : brl(o.fee), 'oportunidade.titulo': o.title, 'proposta.numero': o.proposalNumber ?? '', 'proposta.titulo': o.proposalNumber ? `${o.proposalNumber} - ${o.contactName}` : '',
    'vendedor.nome': o.ownerName, 'vendedor.email': o.ownerEmail, 'empresa.nome': o.tenantName,
    'data.hoje': new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date()),
  } as Record<string, string>;
}

export const fill = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');

/** Largura de referência: tamanho da fonte é guardado em milésimos da largura da página. */
const A4_W = 595.28;

export function safeText(font: PDFFont, t: string) {
  // Helvetica só tem WinAnsi: troca o que não dá para escrever
  const MAP: Record<string, string> = { '•': '-', '→': '->', '←': '<-', '−': '-', '≥': '>=', '≤': '<=', '≈': '~', '×': 'x' };
  return [...t].map((ch) => { try { font.encodeText(ch); return ch; } catch { return MAP[ch] ?? '?'; } }).join('');
}
export function wrap(font: PDFFont, text: string, size: number, maxW: number) {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n').map((x) => safeText(font, x))) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) <= maxW || !line) line = cand;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
const hex = (c: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(c); const n = m ? parseInt(m[1]!, 16) : 0; return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

export async function imageSize(mime: string, data: Buffer) {
  const doc = await PDFDocument.create();
  const img = mime === 'image/png' ? await doc.embedPng(data) : await doc.embedJpg(data);
  return { width: img.width, height: img.height };
}

export type ProposalContent = { servicesText: string; photos: { data: Buffer; mime: string }[]; items: InvestmentItem[] };

/** Páginas geradas (seções automáticas) sobre a arte de fundo, com quebra de página em texto, fotos e tabela. */
async function drawSections(doc: PDFDocument, cfg: ProposalSectionsConfig, bg: { img: PDFImage | null; W: number; H: number; drawFields: (page: PDFPage) => void }, content: ProposalContent, vars: Record<string, string>, fonts: { regular: PDFFont; bold: PDFFont }) {
  const { W, H } = bg;
  const L = (cfg.margins.left / 100) * W, R = W - (cfg.margins.right / 100) * W, TOP = H - (cfg.margins.top / 100) * H, BOT = (cfg.margins.bottom / 100) * H;
  const CW = R - L;
  const color = hex(cfg.color), ink = rgb(0.13, 0.15, 0.17), line = rgb(0.8, 0.82, 0.85);
  let page!: PDFPage; let y = 0;
  const pages: PDFPage[] = [];
  const newPage = () => { page = doc.addPage([W, H]); if (bg.img) page.drawImage(bg.img, { x: 0, y: 0, width: W, height: H }); bg.drawFields(page); pages.push(page); y = TOP; };
  const need = (h: number) => { if (y - h < BOT) newPage(); };
  const heading = (title: string) => {
    need(40);
    if (y < TOP) y -= 10;
    page.drawRectangle({ x: L, y: y - 22, width: 4, height: 22, color });
    page.drawText(safeText(fonts.bold, title.toUpperCase()), { x: L + 12, y: y - 16, size: 13, font: fonts.bold, color });
    y -= 34;
  };
  const paragraph = (text: string, size = 10) => {
    for (const ln of wrap(fonts.regular, text, size, CW)) { need(size * 1.45); page.drawText(ln, { x: L, y: y - size, size, font: fonts.regular, color: ink }); y -= size * 1.45; }
  };
  newPage();
  // 1. serviços propostos
  if (content.servicesText.trim() || content.photos.length) {
    heading(cfg.titles.services);
    if (content.servicesText.trim()) { paragraph(fill(content.servicesText, vars)); y -= 8; }
    if (content.photos.length) {
      const imgs = await Promise.all(content.photos.map((p) => (p.mime === 'image/png' ? doc.embedPng(p.data) : doc.embedJpg(p.data))));
      const gap = 6, maxRow = (TOP - BOT) * 0.45;
      const lay = layoutPhotos(imgs.map((im) => im.width / im.height), CW, gap, maxRow);
      for (const row of lay.rows) {
        need(row.h + gap);
        for (const b of lay.boxes.filter((x) => row.indexes.includes(x.index))) page.drawImage(imgs[b.index]!, { x: L + b.x, y: y - row.h, width: b.w, height: b.h });
        y -= row.h + gap;
      }
      y -= 6;
    }
  }
  // 2. composição do investimento
  const tb = investmentTable(content.items);
  if (tb.rows.length) {
    heading(cfg.titles.investment);
    const widths = [0.07, 0.43, 0.08, 0.1, 0.16, 0.16].map((f) => f * CW);
    const right = [false, false, false, true, true, true];
    const size = 8.5, pad = 4;
    const drawRow = (cells: string[], font: PDFFont, fill?: ReturnType<typeof rgb>, textColor = ink) => {
      const wrapped = cells.map((c, i) => wrap(font, c, size, widths[i]! - pad * 2));
      const h = Math.max(...wrapped.map((w) => w.length)) * size * 1.3 + pad * 2;
      if (y - h < BOT) { newPage(); drawHeader(); }
      let x = L;
      if (fill) page.drawRectangle({ x: L, y: y - h, width: CW, height: h, color: fill });
      wrapped.forEach((lines, i) => {
        lines.forEach((ln, k) => { const lw = font.widthOfTextAtSize(ln, size); page.drawText(ln, { x: right[i] ? x + widths[i]! - pad - lw : x + pad, y: y - pad - size - k * size * 1.3, size, font, color: textColor }); });
        x += widths[i]!;
      });
      page.drawLine({ start: { x: L, y: y - h }, end: { x: R, y: y - h }, thickness: 0.5, color: line });
      y -= h;
    };
    const drawHeader = () => drawRow(tb.header, fonts.bold, color, rgb(1, 1, 1));
    need(60); drawHeader();
    tb.rows.forEach((r, i) => drawRow(r, fonts.regular, i % 2 ? rgb(0.965, 0.97, 0.975) : undefined));
    need(24);
    page.drawRectangle({ x: L, y: y - 22, width: CW, height: 22, color: rgb(0.92, 0.94, 0.96) });
    const tl = safeText(fonts.bold, `TOTAL  ${tb.total}`), tw = fonts.bold.widthOfTextAtSize(tl, 10);
    page.drawText(tl, { x: R - pad - tw, y: y - 15, size: 10, font: fonts.bold, color: ink });
    y -= 34;
  }
  // 3. condição da proposta
  heading(cfg.titles.condition);
  paragraph(fill(cfg.conditionText, vars));
  return pages.length;
}

export async function buildProposalPdf(db: DbOrTx, tenantId: string, templateId: string, vars: Record<string, string>, content?: ProposalContent) {
  const [t] = await db.select().from(s.proposalTemplates).where(and(eq(s.proposalTemplates.id, templateId), eq(s.proposalTemplates.tenantId, tenantId))).limit(1);
  if (!t) return null;
  const pages = await db.select().from(s.proposalTemplatePages).where(and(eq(s.proposalTemplatePages.templateId, t.id), eq(s.proposalTemplatePages.tenantId, tenantId))).orderBy(asc(s.proposalTemplatePages.position));
  if (!pages.length) return null;
  const doc = await PDFDocument.create();
  doc.setTitle(fill('Proposta {{cliente.nome}}', vars));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cfg = normalizeSections(t.sections);
  const useSections = cfg.enabled && t.purpose === 'proposta' && !!content;
  const drawFields = (page: PDFPage, i: number, W: number, H: number) => {
    for (const f of t.fields.filter((x) => x.page === i)) {
      const font = f.bold ? bold : regular;
      const size = (f.size / 1000) * W;
      const maxW = (f.w / 100) * W;
      const lines = wrap(font, safeText(font, fill(f.text, vars)), size, maxW);
      let y = H - (f.y / 100) * H - size;
      for (const line of lines) {
        const lw = font.widthOfTextAtSize(line, size);
        const x0 = (f.x / 100) * W + (f.align === 'center' ? (maxW - lw) / 2 : f.align === 'right' ? maxW - lw : 0);
        page.drawText(line, { x: x0, y, size, font, color: hex(f.color) });
        if (f.strike && line) page.drawLine({ start: { x: x0, y: y + size * 0.32 }, end: { x: x0 + lw, y: y + size * 0.32 }, thickness: Math.max(0.6, size / 14), color: hex(f.color) });
        y -= size * 1.25;
      }
    }
  };
  const bgIdx = useSections && cfg.backgroundPage !== null && cfg.backgroundPage < pages.length ? cfg.backgroundPage : null;
  const after = Math.min(cfg.insertAfter, pages.length - 1);
  const sectionsHere = async () => {
    const bgPg = bgIdx !== null ? pages[bgIdx]! : null;
    const W = A4_W, H = bgPg ? (bgPg.height / bgPg.width) * W : W * 1.4142;
    const img = bgPg ? (bgPg.mime === 'image/png' ? await doc.embedPng(bgPg.data) : await doc.embedJpg(bgPg.data)) : null;
    await drawSections(doc, cfg, { img, W, H, drawFields: (p) => { if (bgIdx !== null) drawFields(p, bgIdx, W, H); } }, content!, vars, { regular, bold });
  };
  if (useSections && after < 0) await sectionsHere();
  for (const [i, pg] of pages.entries()) {
    if (i === bgIdx) { if (useSections && i === after) await sectionsHere(); continue; }
    const img = pg.mime === 'image/png' ? await doc.embedPng(pg.data) : await doc.embedJpg(pg.data);
    const W = A4_W, H = (pg.height / pg.width) * W;
    const page = doc.addPage([W, H]);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
    drawFields(page, i, W, H);
    if (useSections && i === after) await sectionsHere();
  }
  return { pdf: Buffer.from(await doc.save()), name: t.name };
}
