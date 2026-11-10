/**
 * Certificado de treinamento em PDF, com a cara do sistema (marca BKT: cantos retos, grafite e azul)
 * e a Badge Crescimento, que é onde o curso conta na gamificação.
 * Gerado uma vez na aprovação e guardado: o arquivo não muda se a prova mudar depois.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { safeText } from './proposals';

const BLUE = rgb(0x2f / 255, 0x59 / 255, 0x86 / 255);
const NAVY = rgb(0x2d / 255, 0x33 / 255, 0x39 / 255);
const NAVY_DARK = rgb(0x26 / 255, 0x2b / 255, 0x30 / 255);
const SKY = rgb(0x8f / 255, 0xa9 / 255, 0xc4 / 255);
const INK = rgb(0x2d / 255, 0x33 / 255, 0x39 / 255);
const MUTED = rgb(0x5b / 255, 0x65 / 255, 0x70 / 255);
const LINE = rgb(0xdc / 255, 0xe1 / 255, 0xe6 / 255);
const SOFT = rgb(0xa9 / 255, 0xb4 / 255, 0xbf / 255);
const WHITE = rgb(1, 1, 1);

// mesmos desenhos da Badge Crescimento na tela (caixa 100 × 100)
const HEX = 'M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z';
const ARROW = 'M27 70 L45 52 L54 61 L67 46 L67 56 L73 56 L73 34 L51 34 L51 40 L61 40 L54 48 L45 39 L23 61 Z';

/** Badge Crescimento (faixa alcançada: grafite com detalhe lima), canto superior esquerdo em (x, top). */
function drawGrowthBadge(page: PDFPage, x: number, top: number, size: number) {
  const s = size / 100;
  page.drawSvgPath(HEX, { x, y: top, scale: s, color: BLUE, borderColor: WHITE, borderWidth: 3 * s });
  page.drawSvgPath(ARROW, { x, y: top, scale: s, color: WHITE });
  for (let i = 0; i < 3; i++) page.drawRectangle({ x: x + (35 + i * 11) * s, y: top + 6, width: 7 * s, height: 5 * s, color: SKY });
}

function fit(font: PDFFont, text: string, size: number, max: number, min = 9) {
  const t = safeText(font, text);
  let sz = size;
  while (font.widthOfTextAtSize(t, sz) > max && sz > min) sz -= 0.5;
  return { t, sz };
}

/** Quebra o texto em até `lines` linhas na largura dada. */
function wrap(font: PDFFont, text: string, size: number, max: number, lines: number) {
  const out: string[] = [];
  let cur = '';
  for (const w of safeText(font, text).split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > max && cur) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; out[lines - 1] = `${out[lines - 1]!.replace(/\s+\S*$/, '')}…`; }
  return out;
}

export async function trainingCertificatePdf(c: { company: string; person: string; course: string; playbook: string; hours: number; scorePct: number; issuedOn: string; code: string; gamification?: boolean }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificado ${c.code}`);
  doc.setAuthor(c.company);
  const W = 842, H = 595;
  const page = doc.addPage([W, H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // coluna da marca (grafite) com a Badge Crescimento
  const SIDE = 270;
  page.drawRectangle({ x: 0, y: 0, width: SIDE, height: H, color: NAVY });
  page.drawRectangle({ x: SIDE, y: 0, width: 6, height: H, color: BLUE });
  page.drawText('RevOps', { x: 36, y: H - 62, size: 24, font: bold, color: WHITE });
  page.drawText('Central de Playbooks', { x: 36, y: H - 82, size: 11, font: reg, color: SOFT });
  const bs = 150;
  drawGrowthBadge(page, (SIDE - bs) / 2, H - 150, bs);
  const bl = 'Badge Crescimento';
  page.drawText(bl, { x: (SIDE - bold.widthOfTextAtSize(bl, 18)) / 2, y: H - 340, size: 18, font: bold, color: WHITE });
  const sub = c.gamification ? 'Curso complementar validado:' : 'Treinamento interno concluído';
  page.drawText(sub, { x: (SIDE - reg.widthOfTextAtSize(sub, 10)) / 2, y: H - 360, size: 10, font: reg, color: SOFT });
  if (c.gamification) {
    const sub2 = 'conta na gamificação';
    page.drawText(sub2, { x: (SIDE - reg.widthOfTextAtSize(sub2, 10)) / 2, y: H - 374, size: 10, font: reg, color: SOFT });
  }
  // código de verificação no pé da coluna
  page.drawRectangle({ x: 0, y: 0, width: SIDE, height: 76, color: NAVY_DARK });
  page.drawText('Código de verificação', { x: 36, y: 46, size: 9, font: reg, color: SOFT });
  page.drawText(c.code, { x: 36, y: 26, size: 15, font: bold, color: WHITE });

  // conteúdo
  const L = SIDE + 6 + 56, R = W - 56, MAXW = R - L;
  page.drawText('CERTIFICADO DE CONCLUSÃO', { x: L, y: H - 70, size: 11, font: bold, color: BLUE });
  page.drawRectangle({ x: L, y: H - 82, width: 48, height: 3, color: BLUE });
  page.drawText('Certificamos que', { x: L, y: H - 130, size: 13, font: reg, color: MUTED });
  const name = fit(bold, c.person, 34, MAXW, 18);
  page.drawText(name.t, { x: L, y: H - 172, size: name.sz, font: bold, color: INK });
  page.drawText('concluiu com aprovação o treinamento', { x: L, y: H - 206, size: 13, font: reg, color: MUTED });
  const courseLines = wrap(bold, c.course, 22, MAXW, 2);
  courseLines.forEach((ln, i) => page.drawText(ln, { x: L, y: H - 240 - i * 28, size: 22, font: bold, color: BLUE }));
  const afterCourse = H - 240 - (courseLines.length - 1) * 28;
  page.drawText(safeText(reg, `Playbook ${c.playbook} · Central de Playbooks`), { x: L, y: afterCourse - 22, size: 10, font: reg, color: MUTED });

  // três dados em caixas retas
  const [y, m, d] = c.issuedOn.split('-');
  const boxes: [string, string][] = [['Carga horária', `${c.hours} h`], ['Aproveitamento', `${c.scorePct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`], ['Emitido em', `${d}/${m}/${y}`]];
  const gap = 12, bw = (MAXW - gap * 2) / 3, by = 150, bh = 64;
  boxes.forEach(([k, v], i) => {
    const x = L + i * (bw + gap);
    page.drawRectangle({ x, y: by, width: bw, height: bh, borderColor: LINE, borderWidth: 1, color: WHITE });
    page.drawRectangle({ x, y: by + bh - 3, width: bw, height: 3, color: BLUE });
    page.drawText(k, { x: x + 14, y: by + bh - 22, size: 9, font: reg, color: MUTED });
    page.drawText(v, { x: x + 14, y: by + 14, size: 20, font: bold, color: INK });
  });

  // rodapé: empresa e validação
  page.drawRectangle({ x: L, y: 104, width: MAXW, height: 0.8, color: LINE });
  const co = fit(bold, c.company, 12, MAXW / 2);
  page.drawText(co.t, { x: L, y: 80, size: co.sz, font: bold, color: INK });
  page.drawText('Validado pela aprovação na prova do treinamento.', { x: L, y: 64, size: 9, font: reg, color: MUTED });
  return Buffer.from(await doc.save());
}
