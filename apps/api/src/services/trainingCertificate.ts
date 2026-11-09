/**
 * Certificado de treinamento em PDF (A4 deitado, marca BKT: cantos retos, azul, grafite e lima).
 * Gerado uma vez na aprovação e guardado: o arquivo não muda se a prova mudar depois.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { safeText } from './proposals';

const BLUE = rgb(0x2f / 255, 0x59 / 255, 0x86 / 255);
const NAVY = rgb(0x2d / 255, 0x33 / 255, 0x39 / 255);
const LIME = rgb(0xb5 / 255, 0xd3 / 255, 0x34 / 255);
const MUTED = rgb(0.4, 0.43, 0.47);

export async function trainingCertificatePdf(c: { company: string; person: string; course: string; playbook: string; hours: number; scorePct: number; issuedOn: string; code: string }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificado ${c.code}`);
  const page = doc.addPage([842, 595]);
  const W = 842, H = 595;
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const center = (t: string, y: number, size: number, font = reg, color = NAVY) => {
    const s = safeText(font, t);
    let sz = size;
    while (font.widthOfTextAtSize(s, sz) > W - 160 && sz > 9) sz -= 1;
    page.drawText(s, { x: (W - font.widthOfTextAtSize(s, sz)) / 2, y, size: sz, font, color });
  };
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: BLUE, borderWidth: 2 });
  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: NAVY });
  page.drawRectangle({ x: 0, y: H - 76, width: W, height: 6, color: LIME });
  page.drawText(safeText(bold, c.company), { x: 48, y: H - 45, size: 16, font: bold, color: rgb(1, 1, 1) });
  const tag = 'TREINAMENTO INTERNO';
  page.drawText(tag, { x: W - 48 - bold.widthOfTextAtSize(tag, 10), y: H - 42, size: 10, font: bold, color: LIME });
  center('CERTIFICADO', 420, 40, bold, BLUE);
  center('Certificamos que', 380, 14, reg, MUTED);
  center(c.person, 340, 30, bold);
  center('concluiu com aprovação o treinamento', 300, 14, reg, MUTED);
  center(c.course, 265, 22, bold);
  center(`Playbook ${c.playbook}`, 240, 11, reg, MUTED);
  const [y, m, d] = c.issuedOn.split('-');
  center(`Carga horária: ${c.hours} h  ·  Aproveitamento: ${c.scorePct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%  ·  Emitido em ${d}/${m}/${y}`, 190, 13);
  page.drawRectangle({ x: 48, y: 48, width: W - 96, height: 0.8, color: MUTED });
  page.drawText(`Código de verificação: ${c.code}`, { x: 48, y: 58 + 4, size: 10, font: bold, color: NAVY });
  const note = 'Emitido automaticamente pela aprovação na prova do treinamento na Central de Playbooks.';
  page.drawText(safeText(reg, note), { x: W - 48 - reg.widthOfTextAtSize(safeText(reg, note), 9), y: 62, size: 9, font: reg, color: MUTED });
  return Buffer.from(await doc.save());
}
