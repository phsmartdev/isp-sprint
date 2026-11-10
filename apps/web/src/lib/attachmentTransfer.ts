/**
 * Anexos da oportunidade: até 3 MB vão numa requisição só; maiores (editais, termos de referência…) vão em partes
 * e o servidor monta. O download dos grandes também vem em pedaços (a hospedagem limita cada resposta).
 */
import { ATTACHMENT_CHUNK_BYTES, ATTACHMENT_DOWNLOAD_PART_BYTES, MAX_LARGE_ATTACHMENT_BYTES } from '@isp/shared';
import { api, ApiError } from './api';
import { MAX_ATTACHMENT_BYTES, fileToBase64, fmtBytes } from './files';

export const MAX_OPP_ATTACHMENT_BYTES = MAX_LARGE_ATTACHMENT_BYTES;
export const OPP_ATTACHMENT_LIMIT_LABEL = fmtBytes(MAX_LARGE_ATTACHMENT_BYTES).replace(',0', '');


async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      // erro de validação não melhora tentando de novo; queda de rede ou 5xx, sim
      if (i >= tries || (e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}

/** Envia o arquivo como anexo da oportunidade; onProgress recebe de 0 a 1. */
export async function uploadOppAttachment<T = unknown>(oppId: string, kind: 'proposta' | 'outro', file: File, onProgress?: (p: number) => void): Promise<T> {
  if (file.size > MAX_LARGE_ATTACHMENT_BYTES) throw new Error(`O arquivo tem ${fmtBytes(file.size)}: o limite é ${OPP_ATTACHMENT_LIMIT_LABEL}.`);
  if (file.size <= MAX_ATTACHMENT_BYTES) {
    const r = await api<T>(`/opportunities/${oppId}/attachments`, { method: 'POST', body: { kind, filename: file.name, data: await fileToBase64(file) } });
    onProgress?.(1);
    return r;
  }
  const uploadId = crypto.randomUUID();
  const parts = Math.ceil(file.size / ATTACHMENT_CHUNK_BYTES);
  for (let n = 0; n < parts; n++) {
    const blob = file.slice(n * ATTACHMENT_CHUNK_BYTES, (n + 1) * ATTACHMENT_CHUNK_BYTES);
    const data = await fileToBase64(new File([blob], file.name));
    await withRetry(() => api(`/opportunities/${oppId}/attachments/uploads/${uploadId}/parts/${n}`, { method: 'PUT', body: { data } }));
    onProgress?.((n + 1) / (parts + 1));
  }
  const r = await withRetry(() => api<T>(`/opportunities/${oppId}/attachments/uploads/${uploadId}/complete`, { method: 'POST', body: { kind, filename: file.name, parts, sizeBytes: file.size } }), 2);
  onProgress?.(1);
  return r;
}

export const attachmentUrl = (oppId: string, id: string) => `/api/v1/opportunities/${oppId}/attachments/${id}/download`;
/** Arquivo grande demais para vir numa resposta só: baixa em partes. */
export const needsPartedDownload = (sizeBytes: number) => sizeBytes > ATTACHMENT_DOWNLOAD_PART_BYTES;

/** Baixa um anexo grande em partes e entrega ao navegador como um arquivo só. */
export async function downloadOppAttachment(oppId: string, a: { id: string; filename: string; mime: string; sizeBytes: number }, onProgress?: (p: number) => void) {
  const parts = Math.max(1, Math.ceil(a.sizeBytes / ATTACHMENT_DOWNLOAD_PART_BYTES));
  const chunks: ArrayBuffer[] = [];
  for (let p = 0; p < parts; p++) {
    const buf = await withRetry(async () => {
      let res: Response;
      try { res = await fetch(`${attachmentUrl(oppId, a.id)}?part=${p}`, { credentials: 'same-origin' }); } catch { throw new ApiError(0, { type: 'network', title: 'Sem conexão', status: 0, detail: 'Não foi possível baixar o arquivo. Verifique a conexão.' }); }
      if (!res.ok) throw new ApiError(res.status, { type: 'about:blank', title: 'Erro', status: res.status, detail: res.status === 404 ? 'Anexo não encontrado.' : 'Não foi possível baixar o arquivo.' });
      return res.arrayBuffer();
    });
    chunks.push(buf);
    onProgress?.((p + 1) / parts);
  }
  const url = URL.createObjectURL(new Blob(chunks, { type: a.mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = a.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
