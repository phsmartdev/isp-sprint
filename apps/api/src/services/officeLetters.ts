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
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_m, k: string) => (k === 'assinatura' ? '{{assinatura}}' : vars[k]?.trim() ? vars[k]! : `[${VAR_LABEL.get(k) ?? k}]`));
}
export const usedVars = (blocks: OfficeBlock[]) => [...new Set(blocks.flatMap((b) => [...b.text.matchAll(/\{\{\s*([a-z_.]+)\s*\}\}/g)].map((m) => m[1]!)))].filter((k) => k !== 'assinatura');

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
};

export async function renderOffice(input: OfficeRenderInput) {
  const doc = await PDFDocument.create();
  const fonts: Fonts = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold), i: await doc.embedFont(StandardFonts.HelveticaOblique), bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique) };
  const paint = await letterheadPainter(doc, input.letterhead);
  let sigImg: PDFImage | null = null;
  if (input.signature) { try { sigImg = input.signature.mime === 'image/png' ? await doc.embedPng(input.signature.data) : await doc.embedJpg(input.signature.data); } catch { sigImg = null; } }
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
        const h = 13 * MM;
        if (sigImg) {
          const ratio = sigImg.width / sigImg.height;
          const w = Math.min(width, h * ratio);
          const x = b.align === 'left' ? left : b.align === 'right' ? left + width - w : left + (width - w) / 2;
          if (y - h < bottomMm * MM) { pg++; page(pg); y = H - topMm * MM; }
          page(pg).drawImage(sigImg, { x, y: y - h, width: w, height: h });
        }
        y -= h;
        continue;
      }
      const words = parseLine(safeLine(raw, fonts));
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

/** Caracteres que a Helvetica não escreve viram equivalentes (preservando os marcadores de estilo). */
function safeLine(line: string, fonts: Fonts) { return safeText(fonts.r, line); }

/**
 * Valores iniciais a partir do contrato (versão vigente: número, objeto, órgão, processo, assinatura, índice) e da
 * negociação de origem (filial, código). Destinatários: pessoas ligadas ao contrato e à negociação. Tudo é ajustável.
 */
export async function officeDefaults(db: DbOrTx, tenantId: string, contractId: string, today: string, opts: { recipientPersonId?: string | null; branchId?: string | null } = {}) {
  const [c] = await db.select().from(s.contracts).where(and(eq(s.contracts.tenantId, tenantId), eq(s.contracts.id, contractId))).limit(1);
  if (!c) return { vars: {} as Record<string, string>, branchId: null as string | null, opportunityId: null as string | null, recipients: [] as { personId: string; name: string; title: string | null; role: string }[], recipientPersonId: null as string | null };
  const [o] = c.opportunityId ? await db.select().from(s.opportunities).where(eq(s.opportunities.id, c.opportunityId)).limit(1) : [];
  // filial do contrato; sem ela, a da negociação de origem (ou a escolhida na emissão)
  const branchId = opts.branchId ?? c.branchId ?? o?.branchId ?? null;
  const [contact] = await db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
  const [branch] = branchId ? await db.select().from(s.salesBranches).where(and(eq(s.salesBranches.tenantId, tenantId), eq(s.salesBranches.id, branchId))).limit(1) : [];
  const [signer] = branchId ? await db.select({ legalName: s.branchSigners.legalName, signerName: s.branchSigners.signerName, signerRole: s.branchSigners.signerRole }).from(s.branchSigners).where(eq(s.branchSigners.branchId, branchId)).limit(1) : [];
  const [ver] = await db.select().from(s.contractVersions).where(eq(s.contractVersions.contractId, c.id)).orderBy(desc(s.contractVersions.version)).limit(1);
  const links = async (entityType: string, entityId: string) => db.select({ personId: s.people.id, name: s.people.name, title: s.accountStakeholders.title, role: s.stakeholderLinks.role })
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
    'negociacao.codigo': o ? `OP-${o.code}` : '', 'negociacao.titulo': o?.title ?? '',
  };
  return { vars, branchId, opportunityId: o?.id ?? null, recipients: recipients.map((r) => ({ personId: r.personId, name: r.name, title: r.title, role: r.role })), recipientPersonId: pick?.personId ?? null };
}

/** Timbrado e assinatura da filial (para a prévia e a emissão). */
export async function branchArt(db: DbOrTx, tenantId: string, branchId: string | null) {
  const letterhead = await letterheadForBranch(db, tenantId, branchId);
  const [sig] = branchId ? await db.select({ mime: s.branchSigners.signatureMime, data: s.branchSigners.signatureData }).from(s.branchSigners).where(and(eq(s.branchSigners.tenantId, tenantId), eq(s.branchSigners.branchId, branchId))).limit(1) : [];
  return { letterhead, signature: sig?.mime && sig.data ? { mime: sig.mime, data: Buffer.from(sig.data as unknown as Uint8Array) } : null };
}
