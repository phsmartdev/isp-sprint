/**
 * Lê o texto do PDF no navegador (pdf.js, carregado só quando usado): cada linha com tamanho da fonte,
 * negrito e posição, para o domínio montar a estrutura do playbook. Nada sai do navegador até criar.
 */
import type { PdfLine } from '@isp/domain';

export async function readPdfLines(file: File): Promise<{ lines: PdfLine[]; pages: number }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: PdfLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const styles = tc.styles as Record<string, { fontFamily?: string }>;
    // nome real da fonte (ex.: Helvetica-Bold) para reconhecer negrito: as fontes carregam com a lista de operações
    await page.getOperatorList().catch(() => undefined);
    const realName = (f: string) => { try { return String((page.commonObjs.get(f) as { name?: string } | undefined)?.name ?? ''); } catch { return ''; } };
    // junta os pedaços de texto da mesma linha (mesma altura)
    const rows = new Map<number, { x: number; text: string; size: number; bold: boolean }[]>();
    for (const it of tc.items as { str: string; transform: number[]; fontName: string; hasEOL?: boolean }[]) {
      if (!it.str?.trim()) continue;
      const size = Math.hypot(it.transform[2]!, it.transform[3]!) || Math.abs(it.transform[3]!);
      const y = Math.round(it.transform[5]! * 2) / 2;
      const font = `${it.fontName} ${realName(it.fontName)} ${styles[it.fontName]?.fontFamily ?? ''}`;
      const key = [...rows.keys()].find((k) => Math.abs(k - y) < size * 0.4) ?? y;
      rows.set(key, [...(rows.get(key) ?? []), { x: it.transform[4]!, text: it.str, size, bold: /bold|black|heavy|semibold|-bd/i.test(font) }]);
    }
    for (const [y, parts] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      parts.sort((a, b) => a.x - b.x);
      const text = parts.map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim();
      const size = Math.max(...parts.map((x) => x.size));
      const letters = parts.reduce((t, x) => t + x.text.length, 0);
      const boldLetters = parts.filter((x) => x.bold).reduce((t, x) => t + x.text.length, 0);
      lines.push({ text, size: Math.round(size * 10) / 10, bold: boldLetters > letters * 0.6, page: p, y });
    }
  }
  return { lines, pages: doc.numPages };
}
