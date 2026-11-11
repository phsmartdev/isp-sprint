/** Lê um arquivo do navegador como base64 (sem o prefixo data:). */
export async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const ATTACHMENT_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
/** Limite real por envio na hospedagem (4,5 MB com o base64 ≈ 3,3 MB de arquivo). */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

/**
 * Desenha a imagem reduzida com qualidade: suavização alta e, em reduções grandes, em etapas de metade
 * (reduzir de uma vez 4× ou mais deixa bordas serrilhadas e aparência pixelada).
 */
export function drawScaled(src: CanvasImageSource & { width: number; height: number }, w: number, h: number, fill?: string, crop?: { sx: number; sy: number; sw: number; sh: number }) {
  let cur: CanvasImageSource = src;
  let cw = crop?.sw ?? src.width, ch = crop?.sh ?? src.height;
  let sx = crop?.sx ?? 0, sy = crop?.sy ?? 0;
  while (cw / 2 >= w && ch / 2 >= h) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const step = document.createElement('canvas');
    step.width = nw; step.height = nh;
    const sc = step.getContext('2d')!;
    sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = 'high';
    sc.drawImage(cur, sx, sy, cw, ch, 0, 0, nw, nh);
    cur = step; cw = nw; ch = nh; sx = 0; sy = 0;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, sx, sy, cw, ch, 0, 0, w, h);
  return canvas;
}

/** O navegador gera WebP? (Chrome, Edge, Firefox e Safari recentes; os demais ficam no JPG.) */
let webpOk: boolean | null = null;
export async function canEncodeWebp() {
  if (webpOk !== null) return webpOk;
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.9));
  return (webpOk = b?.type === 'image/webp');
}

/**
 * Reduz uma imagem no navegador antes de enviar (a hospedagem aceita até ~4,5 MB por envio, e o base64 aumenta 33%).
 * Mantém o arquivo original se já couber. Senão redimensiona (lado maior até maxDim) com suavização de alta qualidade e
 * gera, por padrão, JPG com fundo branco, ou WebP quando `format: 'webp'` e o navegador suporta (mesma nitidez em menos
 * bytes, sem faixas nos degradês escuros). A qualidade desce aos poucos (0,95 → 0,82) antes de reduzir o tamanho.
 * Arquivos que não são PNG/JPG/WebP voltam como estão.
 */
export async function compressImage(file: File, opts: { maxBytes?: number; maxDim?: number; keepAlpha?: boolean; format?: 'jpeg' | 'webp' } = {}): Promise<File> {
  const maxBytes = opts.maxBytes ?? 3_000_000;
  const maxDim = opts.maxDim ?? 3508; // A4 a 300 dpi
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return file;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const big = Math.max(bmp.width, bmp.height);
  if (file.size <= maxBytes && big <= maxDim) { bmp.close(); return file; }
  const webp = opts.format === 'webp' && (await canEncodeWebp());
  const base = file.name.replace(/\.\w+$/, '');
  let scale = Math.min(1, maxDim / big);
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    if (opts.keepAlpha) {
      // logo/arte com transparência: PNG (ou WebP com transparência), só diminui
      const canvas = drawScaled(bmp, w, h);
      if (webp) {
        const wb = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.95));
        if (wb && wb.type === 'image/webp' && wb.size <= maxBytes) { bmp.close(); return new File([wb], `${base}.webp`, { type: 'image/webp' }); }
      }
      const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (png && png.size <= maxBytes) { bmp.close(); return new File([png], `${base}.png`, { type: 'image/png' }); }
      scale *= 0.85;
      continue;
    }
    const canvas = drawScaled(bmp, w, h, '#fff');
    const type = webp ? 'image/webp' : 'image/jpeg';
    for (const q of [0.95, 0.92, 0.88, 0.85, 0.82]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
      if (blob && blob.size <= maxBytes) { bmp.close(); return new File([blob], `${base}.${webp ? 'webp' : 'jpg'}`, { type }); }
    }
    scale *= 0.85;
  }
  bmp.close();
  return file;
}
