/**
 * Envio pelo WhatsApp.
 *  - API (WhatsApp Cloud): envia o PDF pelo número da empresa. O WhatsApp só deixa a empresa mandar
 *    mensagem livre para quem falou com ela nas últimas 24 h; fora disso a API recusa.
 *  - Z-API (licença usada pela empresa): manda o PDF pelo número conectado à instância, sem a janela de 24 h.
 *    Docs: https://developer.z-api.io (send-document/{extensão}, status; cabeçalho Client-Token).
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

// ------------------------------------------------------------------ Z-API
const ZAPI = 'https://api.z-api.io/instances';
export type ZapiCfg = { instanceId: string; instanceToken: string; clientToken: string | null };
async function zapi<T>(cfg: ZapiCfg, path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.clientToken) headers['client-token'] = cfg.clientToken;
    const r = await fetch(`${ZAPI}/${encodeURIComponent(cfg.instanceId)}/token/${encodeURIComponent(cfg.instanceToken)}/${path}`, { method: init.method, headers, body: init.body ? JSON.stringify(init.body) : undefined, signal: ctl.signal });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!r.ok || (path !== 'status' && j.error)) {
      const why = j.error ?? j.message ?? `HTTP ${r.status}`;
      throw new Error(/client-token/i.test(why) ? 'Token de segurança (Client-Token) ausente ou errado.' : why);
    }
    return j;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('A Z-API não respondeu a tempo.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Conexão da instância com o celular (status). */
export async function zapiStatus(cfg: ZapiCfg) {
  return zapi<{ connected?: boolean; error?: string; smartphoneConnected?: boolean }>(cfg, 'status', { method: 'GET' });
}

/** Envia documento em Base64 (o PDF não precisa ficar público). */
export async function sendZapiDocument(cfg: ZapiCfg, to: string, file: { data: Buffer; filename: string; mime: string }, caption: string) {
  const ext = (file.filename.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  const r = await zapi<{ zaapId?: string; messageId?: string; id?: string }>(cfg, `send-document/${ext}`, {
    method: 'POST',
    body: { phone: to, document: `data:${file.mime};base64,${file.data.toString('base64')}`, fileName: file.filename.replace(/\.[^.]+$/, ''), caption: caption.slice(0, 1000) || undefined },
  });
  return r.messageId ?? r.id ?? null;
}

/** Mensagem de texto pela Z-API (avisos internos). */
export async function sendZapiText(cfg: ZapiCfg, to: string, message: string) {
  const r = await zapi<{ zaapId?: string; messageId?: string; id?: string }>(cfg, 'send-text', { method: 'POST', body: { phone: to, message: message.slice(0, 4000) } });
  return r.messageId ?? r.id ?? null;
}
