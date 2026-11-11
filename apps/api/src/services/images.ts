import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { unprocessable } from '../http/errors';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Valida imagem enviada em base64 pelos BYTES (não pela extensão nem pelo tipo declarado).
 * Aceita PNG, JPEG e WebP. SVG é recusado: pode conter script.
 */
export function decodeImage(b64: string, maxBytes = MAX_IMAGE_BYTES): { data: Buffer; mime: 'image/png' | 'image/jpeg' | 'image/webp'; sha256: string } {
  const clean = b64.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw unprocessable('Arquivo inválido.', [{ path: 'data', message: 'Conteúdo não está em base64' }]);
  const data = Buffer.from(clean, 'base64');
  if (data.length === 0) throw unprocessable('Arquivo vazio.');
  if (data.length > maxBytes) { const mb = Math.round(maxBytes / 1024 / 1024); throw unprocessable(`Arquivo maior que ${mb} MB.`, [{ path: 'data', message: `Limite de ${mb} MB por imagem` }]); }
  let mime: 'image/png' | 'image/jpeg' | 'image/webp' | null = null;
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mime = 'image/png';
  else if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) mime = 'image/jpeg';
  else if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') mime = 'image/webp';
  if (!mime) throw unprocessable('Formato não aceito. Envie PNG, JPG ou WebP.', [{ path: 'data', message: 'Formato não reconhecido (SVG não é aceito)' }]);
  if (mime === 'image/png' && !pngIntact(data)) throw unprocessable('Imagem PNG corrompida. Exporte o arquivo novamente.', [{ path: 'data', message: 'PNG corrompido' }]);
  return { data, mime, sha256: createHash('sha256').update(data).digest('hex') };
}

/**
 * Confere a estrutura do PNG (blocos com tamanho coerente, IHDR, IDAT que descompacta e IEND).
 * Necessário porque o leitor de PNG do pdf-lib entra em laço infinito com arquivo truncado/corrompido.
 */
export function pngIntact(data: Buffer): boolean {
  try {
    if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false;
    let o = 8; let first = true; let ended = false; const idat: Buffer[] = [];
    while (o + 12 <= data.length) {
      const len = data.readUInt32BE(o); const type = data.toString('ascii', o + 4, o + 8);
      if (o + 12 + len > data.length) return false;
      if (first && (type !== 'IHDR' || len !== 13)) return false;
      first = false;
      if (type === 'IDAT') idat.push(data.subarray(o + 8, o + 8 + len));
      o += 12 + len;
      if (type === 'IEND') { ended = true; break; }
    }
    if (!ended || idat.length === 0) return false;
    const w = data.readUInt32BE(16); const h = data.readUInt32BE(20);
    if (w === 0 || h === 0 || w * h > 40_000_000) return false;
    return inflateSync(Buffer.concat(idat)).length > 0;
  } catch { return false; }
}

/** Imagem em data URL (PNG/JPG) que pode ir para o PDF sem travar o servidor. */
export function dataUrlImage(url: string): { mime: 'png' | 'jpeg'; bytes: Buffer } | null {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(url);
  if (!m) return null;
  const bytes = Buffer.from(m[2]!, 'base64');
  if (m[1] === 'png') return pngIntact(bytes) ? { mime: 'png', bytes } : null;
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? { mime: 'jpeg', bytes } : null;
}
