/**
 * Envio pelo WhatsApp.
 *  - API (WhatsApp Cloud): envia o PDF pelo número da empresa. O WhatsApp só deixa a empresa mandar
 *    mensagem livre para quem falou com ela nas últimas 24 h; fora disso a API recusa.
 *  - Link: abre o WhatsApp do vendedor com a mensagem pronta e um link seguro (expira) para o PDF.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Link público assinado para um anexo (padrão: 15 dias). */
export function signFileToken(secret: string, attachmentId: string, days = 15) {
  const exp = Math.floor(Date.now() / 1000) + days * 86_400;
  const payload = `${attachmentId}.${exp}`;
  const sig = createHmac('sha256', secret).update(`file:${payload}`).digest();
  return `${b64u(payload)}.${b64u(sig.subarray(0, 20))}`;
}
export function verifyFileToken(secret: string, token: string): string | null {
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const payload = Buffer.from(p, 'base64url').toString();
  const [id, exp] = payload.split('.');
  if (!id || !exp || Number(exp) < Date.now() / 1000) return null;
  const expected = createHmac('sha256', secret).update(`file:${payload}`).digest().subarray(0, 20);
  const given = Buffer.from(sig, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

/** Telefone para o WhatsApp: só dígitos, com 55 quando vier só com DDD. */
export function waPhone(raw: string | null | undefined) {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d.length >= 12 ? d : null;
}

const GRAPH = 'https://graph.facebook.com/v21.0';
async function call(url: string, init: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const j = (await r.json().catch(() => ({}))) as { id?: string; messages?: { id: string }[]; error?: { message?: string; code?: number; error_data?: { details?: string } } };
    if (!r.ok || j.error) {
      const code = j.error?.code;
      const why = code === 131047 || code === 131026
        ? 'o cliente não falou com a empresa nas últimas 24 h (regra do WhatsApp). Use “Abrir no meu WhatsApp”.'
        : j.error?.error_data?.details ?? j.error?.message ?? `HTTP ${r.status}`;
      throw new Error(why);
    }
    return j;
  } finally {
    clearTimeout(t);
  }
}

export async function sendWhatsAppDocument(cfg: { phoneNumberId: string; accessToken: string }, to: string, file: { data: Buffer; filename: string; mime: string }, caption: string) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', file.mime);
  form.append('file', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.filename);
  const media = await call(`${GRAPH}/${encodeURIComponent(cfg.phoneNumberId)}/media`, { method: 'POST', headers: { authorization: `Bearer ${cfg.accessToken}` }, body: form });
  const msg = await call(`${GRAPH}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'document', document: { id: media.id, filename: file.filename, caption: caption.slice(0, 1000) } }),
  });
  return msg.messages?.[0]?.id ?? null;
}
