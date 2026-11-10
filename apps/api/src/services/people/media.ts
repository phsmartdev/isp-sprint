/**
 * Mídias do feed: o tipo é decidido pelos bytes do arquivo, nunca pelo nome ou pelo que o navegador diz.
 * Aceita imagens (PNG, JPG, WebP, GIF), vídeos (MP4/MOV, WebM) e documentos (PDF, Word, Excel, PowerPoint).
 * Tudo o mais (executáveis, scripts, SVG, HTML) é recusado.
 */
const OFFICE: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export type MediaKind = 'imagem' | 'video' | 'arquivo';

export function detectMedia(filename: string, head: Buffer): { kind: MediaKind; mime: string } | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const ascii = (a: number, b: number) => head.subarray(a, b).toString('latin1');
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'imagem', mime: 'image/png' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'imagem', mime: 'image/jpeg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'imagem', mime: 'image/webp' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { kind: 'imagem', mime: 'image/gif' };
  if (ascii(4, 8) === 'ftyp') return { kind: 'video', mime: ascii(8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4' };
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { kind: 'video', mime: 'video/webm' };
  if (ascii(0, 5) === '%PDF-') return { kind: 'arquivo', mime: 'application/pdf' };
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 && OFFICE[ext]) return { kind: 'arquivo', mime: OFFICE[ext]! };
  return null;
}

export const safeFilename = (n: string) => n.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/^\.+/, '').slice(0, 160) || 'arquivo';
