/**
 * Propostas por modelo: a arte (páginas exportadas do Canva em PNG/JPG) vira o fundo e os campos
 * variáveis são escritos por cima nas posições marcadas. Gera PDF e anexa como proposta.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
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
      title: s.opportunities.title, valueCents: s.opportunities.valueCents, fee: s.opportunities.activationFeeCents,
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
    'oportunidade.taxa_ativacao': o.fee == null ? 'R$ 0,00' : brl(o.fee), 'oportunidade.titulo': o.title,
    'vendedor.nome': o.ownerName, 'vendedor.email': o.ownerEmail, 'empresa.nome': o.tenantName,
    'data.hoje': new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date()),
  } as Record<string, string>;
}

export const fill = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');

/** Largura de referência: tamanho da fonte é guardado em milésimos da largura da página. */
const A4_W = 595.28;

function safeText(font: PDFFont, t: string) {
  // Helvetica só tem WinAnsi: troca o que não dá para escrever
  return [...t].map((ch) => { try { font.encodeText(ch); return ch; } catch { return ch === '•' ? '-' : '?'; } }).join('');
}
function wrap(font: PDFFont, text: string, size: number, maxW: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
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

export async function buildProposalPdf(db: DbOrTx, tenantId: string, templateId: string, vars: Record<string, string>) {
  const [t] = await db.select().from(s.proposalTemplates).where(and(eq(s.proposalTemplates.id, templateId), eq(s.proposalTemplates.tenantId, tenantId))).limit(1);
  if (!t) return null;
  const pages = await db.select().from(s.proposalTemplatePages).where(and(eq(s.proposalTemplatePages.templateId, t.id), eq(s.proposalTemplatePages.tenantId, tenantId))).orderBy(asc(s.proposalTemplatePages.position));
  if (!pages.length) return null;
  const doc = await PDFDocument.create();
  doc.setTitle(fill('Proposta {{cliente.nome}}', vars));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const [i, pg] of pages.entries()) {
    const img = pg.mime === 'image/png' ? await doc.embedPng(pg.data) : await doc.embedJpg(pg.data);
    const W = A4_W, H = (pg.height / pg.width) * W;
    const page = doc.addPage([W, H]);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
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
  }
  return { pdf: Buffer.from(await doc.save()), name: t.name };
}
