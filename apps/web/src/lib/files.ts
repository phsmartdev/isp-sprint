/** Lê um arquivo do navegador como base64 (sem o prefixo data:). */
export async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const ATTACHMENT_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
