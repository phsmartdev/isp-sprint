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
 * Reduz uma imagem no navegador antes de enviar (a hospedagem aceita até ~4,5 MB por envio, e o base64 aumenta 33%).
 * Mantém PNG se já couber; senão redimensiona (lado maior até maxDim) e usa JPG com fundo branco, baixando a qualidade até caber.
 * Arquivos que não são PNG/JPG voltam como estão.
 */
export async function compressImage(file: File, opts: { maxBytes?: number; maxDim?: number; keepAlpha?: boolean } = {}): Promise<File> {
  const maxBytes = opts.maxBytes ?? 3_000_000;
  const maxDim = opts.maxDim ?? 3508; // A4 a 300 dpi
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return file;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const big = Math.max(bmp.width, bmp.height);
  if (file.size <= maxBytes && big <= maxDim) { bmp.close(); return file; }
  let scale = Math.min(1, maxDim / big);
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    if (opts.keepAlpha) {
      // logo/arte com transparência: continua PNG, só diminui
      ctx.drawImage(bmp, 0, 0, w, h);
      const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (png && png.size <= maxBytes) { bmp.close(); return new File([png], file.name.replace(/\.\w+$/, '') + '.png', { type: 'image/png' }); }
      scale *= 0.8;
      continue;
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    for (const q of [0.92, 0.85, 0.78]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= maxBytes) { bmp.close(); return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }); }
    }
    scale *= 0.8;
  }
  bmp.close();
  return file;
}
