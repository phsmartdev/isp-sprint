/**
 * Certificado da trilha da Academia em PDF (marca BKT: cantos retos, grafite e azul), no mesmo desenho do certificado
 * de treinamento. A carga horária é a soma da duração das aulas que a pessoa concluiu; o arquivo é gerado uma vez e guardado.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fmtWorkload } from '@isp/domain';
import { safeText } from './proposals';
import { drawGrowthBadge, fit, wrap } from './trainingCertificate';

const BLUE = rgb(0x2f / 255, 0x59 / 255, 0x86 / 255);
const NAVY = rgb(0x2d / 255, 0x33 / 255, 0x39 / 255);
const NAVY_DARK = rgb(0x26 / 255, 0x2b / 255, 0x30 / 255);
const INK = NAVY;
const MUTED = rgb(0x5b / 255, 0x65 / 255, 0x70 / 255);
const LINE = rgb(0xdc / 255, 0xe1 / 255, 0xe6 / 255);
const SOFT = rgb(0xa9 / 255, 0xb4 / 255, 0xbf / 255);
const WHITE = rgb(1, 1, 1);

export async function academyCertificatePdf(c: { company: string; person: string; track: string; seconds: number; lessons: number; issuedOn: string; code: string; competencies: string[] }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificado ${c.code}`);
  doc.setAuthor(c.company);
  const W = 842, H = 595;
  const page = doc.addPage([W, H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const SIDE = 270;
  page.drawRectangle({ x: 0, y: 0, width: SIDE, height: H, color: NAVY });
  page.drawRectangle({ x: SIDE, y: 0, width: 6, height: H, color: BLUE });
  page.drawText('RevOps', { x: 36, y: H - 62, size: 24, font: bold, color: WHITE });
  page.drawText('Academia', { x: 36, y: H - 82, size: 11, font: reg, color: SOFT });
  const bs = 150;
  drawGrowthBadge(page, (SIDE - bs) / 2, H - 150, bs);
  const bl = 'Trilha concluída';
  page.drawText(bl, { x: (SIDE - bold.widthOfTextAtSize(bl, 18)) / 2, y: H - 340, size: 18, font: bold, color: WHITE });
  const sub = `${c.lessons} aula(s) assistida(s)`;
  page.drawText(sub, { x: (SIDE - reg.widthOfTextAtSize(sub, 10)) / 2, y: H - 360, size: 10, font: reg, color: SOFT });
  page.drawRectangle({ x: 0, y: 0, width: SIDE, height: 76, color: NAVY_DARK });
  page.drawText('Código de verificação', { x: 36, y: 46, size: 9, font: reg, color: SOFT });
  page.drawText(c.code, { x: 36, y: 26, size: 15, font: bold, color: WHITE });

  const L = SIDE + 6 + 56, R = W - 56, MAXW = R - L;
  page.drawText('CERTIFICADO DE CONCLUSÃO', { x: L, y: H - 70, size: 11, font: bold, color: BLUE });
  page.drawRectangle({ x: L, y: H - 82, width: 48, height: 3, color: BLUE });
  page.drawText('Certificamos que', { x: L, y: H - 130, size: 13, font: reg, color: MUTED });
  const name = fit(bold, c.person, 34, MAXW, 18);
  page.drawText(name.t, { x: L, y: H - 172, size: name.sz, font: bold, color: INK });
  page.drawText('concluiu a trilha de aprendizagem', { x: L, y: H - 206, size: 13, font: reg, color: MUTED });
  const lines = wrap(bold, c.track, 22, MAXW, 2);
  lines.forEach((ln, i) => page.drawText(ln, { x: L, y: H - 240 - i * 28, size: 22, font: bold, color: BLUE }));
  const after = H - 240 - (lines.length - 1) * 28;
  if (c.competencies.length) {
    const comp = wrap(reg, `Competências: ${c.competencies.join(', ')}`, 10, MAXW, 2);
    comp.forEach((ln, i) => page.drawText(ln, { x: L, y: after - 22 - i * 13, size: 10, font: reg, color: MUTED }));
  }

  const [y, m, d] = c.issuedOn.split('-');
  const boxes: [string, string][] = [['Carga horária', fmtWorkload(c.seconds)], ['Aulas concluídas', String(c.lessons)], ['Emitido em', `${d}/${m}/${y}`]];
  const gap = 12, bw = (MAXW - gap * 2) / 3, by = 150, bh = 64;
  boxes.forEach(([k, v], i) => {
    const x = L + i * (bw + gap);
    page.drawRectangle({ x, y: by, width: bw, height: bh, borderColor: LINE, borderWidth: 1, color: WHITE });
    page.drawRectangle({ x, y: by + bh - 3, width: bw, height: 3, color: BLUE });
    page.drawText(k, { x: x + 14, y: by + bh - 22, size: 9, font: reg, color: MUTED });
    const val = fit(bold, v, 20, bw - 28, 11);
    page.drawText(val.t, { x: x + 14, y: by + 14, size: val.sz, font: bold, color: INK });
  });

  page.drawRectangle({ x: L, y: 104, width: MAXW, height: 0.8, color: LINE });
  const co = fit(bold, c.company, 12, MAXW / 2);
  page.drawText(co.t, { x: L, y: 80, size: co.sz, font: bold, color: INK });
  page.drawText(safeText(reg, 'Carga horária: soma da duração das aulas concluídas, com o progresso registrado pelo player.'), { x: L, y: 64, size: 9, font: reg, color: MUTED });
  return Buffer.from(await doc.save());
}
