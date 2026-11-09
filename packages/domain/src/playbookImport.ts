/**
 * Importação de playbook em PDF: transforma as linhas de texto extraídas do PDF (texto, tamanho da fonte, negrito,
 * página) na estrutura padrão (títulos, parágrafos, listas, passos numerados). Sem IA: regras de tipografia.
 * Cabeçalho/rodapé repetidos e números de página saem. O resultado é um rascunho para revisar no editor.
 */
import type { Block, PlaybookContent } from './playbooks';

export type PdfLine = { text: string; size: number; bold: boolean; page: number; y: number };

const BULLET = /^\s*([•●▪◦‣∙·*✓✔□■–—-])\s+/;
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.+)$/;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Linhas repetidas em muitas páginas (cabeçalho/rodapé) e números de página. */
function noise(lines: PdfLine[]) {
  const pages = new Set(lines.map((l) => l.page)).size;
  const count = new Map<string, Set<number>>();
  for (const l of lines) { const k = norm(l.text).replace(/\d+/g, '#').toLowerCase(); if (!count.has(k)) count.set(k, new Set()); count.get(k)!.add(l.page); }
  return (l: PdfLine) => {
    const t = norm(l.text);
    if (!t) return true;
    if (/^(p[aá]gina\s*)?\d{1,3}(\s*(de|\/)\s*\d{1,3})?$/i.test(t)) return true;
    return pages >= 3 && (count.get(t.replace(/\d+/g, '#').toLowerCase())?.size ?? 0) >= Math.max(3, pages * 0.6);
  };
}

export function structurePdf(raw: PdfLine[], idPrefix = 'imp'): { title: string | null; content: PlaybookContent; stats: Record<string, number> } {
  const isNoise = noise(raw);
  const lines = raw.filter((l) => !isNoise(l)).map((l) => ({ ...l, text: norm(l.text) }));
  if (!lines.length) return { title: null, content: { blocks: [] }, stats: {} };
  // tamanho do corpo: o mais usado (pesado pela quantidade de letras)
  const weight = new Map<number, number>();
  for (const l of lines) { const k = Math.round(l.size * 2) / 2; weight.set(k, (weight.get(k) ?? 0) + l.text.length); }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const bigSizes = [...new Set(lines.filter((l) => l.size >= body * 1.25).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  // o maior tamanho da primeira página é o título do documento; o maior tamanho seguinte é o título de seção (nível 1)
  const firstPage = lines[0]!.page;
  const titleSize = Math.max(...lines.filter((x) => x.page === firstPage).map((x) => x.size));
  const sectionSizes = bigSizes.filter((s) => s < Math.round(titleSize * 2) / 2 || lines.filter((x) => Math.round(x.size * 2) / 2 === s).length > 1);
  const h1Min = sectionSizes.length ? sectionSizes[0]! - 0.01 : body * 1.25;

  let n = 0;
  const id = () => `${idPrefix}${(n++).toString(36)}`;
  const blocks: Block[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let steps: { title: string; text?: string }[] = [];
  const flushPara = () => { if (para.length) blocks.push({ id: id(), type: 'text', text: para.join(' ') }); para = []; };
  const flushBullets = () => { if (bullets.length) blocks.push({ id: id(), type: 'text', text: bullets.map((b) => `- ${b}`).join('\n') }); bullets = []; };
  const flushSteps = () => { if (steps.length >= 2) blocks.push({ id: id(), type: 'steps', items: steps }); else if (steps.length === 1) para.push(steps[0]!.title); steps = []; };
  const flushAll = () => { flushSteps(); flushBullets(); flushPara(); };
  let title: string | null = null;
  let prev: (typeof lines)[number] | null = null;

  for (const l of lines) {
    const isHeading = (l.size >= body * 1.25) || (l.bold && l.text.length <= 80 && !/[.;,]$/.test(l.text) && l.size >= body - 0.5 && /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9]/.test(l.text));
    const bullet = l.text.match(BULLET);
    const num = l.text.match(NUMBERED);
    // continuação da linha anterior (mesmo estilo, logo abaixo, sem marcador)
    const gap = prev && prev.page === l.page ? Math.abs(prev.y - l.y) : Infinity;
    const cont = prev && !isHeading && !bullet && !num && gap < l.size * 1.9 && Math.abs(prev.size - l.size) < 0.6;
    if (isHeading) {
      // título do documento: maior texto da primeira página
      if (!title && l.page === raw[0]!.page && l.size === Math.max(...lines.filter((x) => x.page === l.page).map((x) => x.size))) { title = l.text; prev = l; continue; }
      if (prev && blocks.length && blocks[blocks.length - 1]!.type === 'heading' && prev.page === l.page && gap < l.size * 1.6 && !para.length && !bullets.length && !steps.length) {
        const h = blocks[blocks.length - 1] as Extract<Block, { type: 'heading' }>; h.text = `${h.text} ${l.text}`; prev = l; continue;
      }
      flushAll();
      blocks.push({ id: id(), type: 'heading', level: l.size >= h1Min ? 1 : 2, text: l.text.replace(/^\d+(\.\d+)*\.?\s+/, '') });
    } else if (bullet) {
      flushSteps(); flushPara();
      bullets.push(l.text.replace(BULLET, ''));
    } else if (num) {
      flushBullets(); flushPara();
      steps.push({ title: num[2]! });
    } else if (cont && bullets.length) {
      bullets[bullets.length - 1] += ` ${l.text}`;
    } else if (cont && steps.length) {
      const s = steps[steps.length - 1]!; s.text = s.text ? `${s.text} ${l.text}` : l.text;
    } else if (cont && para.length) {
      para.push(l.text);
    } else {
      flushAll();
      para.push(l.text);
    }
    prev = l;
  }
  flushAll();
  // títulos sem nada embaixo no fim saem; textos muito longos ficam (o editor permite quebrar)
  while (blocks.length && blocks[blocks.length - 1]!.type === 'heading') blocks.pop();
  const stats = blocks.reduce<Record<string, number>>((a, b) => ({ ...a, [b.type]: (a[b.type] ?? 0) + 1 }), {});
  return { title, content: { blocks }, stats };
}
