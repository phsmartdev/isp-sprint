/**
 * ZapSign (https://docs.zapsign.com.br): criar documento (POST /api/v1/docs/), detalhar (GET /api/v1/docs/{token}/).
 * Autenticação: Authorization: Bearer <token>. Sandbox: sandbox.api.zapsign.com.br (sem validade jurídica).
 */
import type { DbOrTx } from '../db/client';
import { decryptSecret } from './email';
import { integrationRow } from './integrations';
import { unprocessable } from '../http/errors';

export type ZapCfg = { token: string; sandbox: boolean };
export type ZapSigner = { token: string; sign_url: string; status: string; name: string; email: string | null; phone_number: string | null; signed_at: string | null };
export type ZapDoc = { token: string; status: string; name: string; original_file: string | null; signed_file: string | null; signers: ZapSigner[] };

export async function zapsignConfig(db: DbOrTx, tenantId: string): Promise<ZapCfg> {
  const r = await integrationRow(db, tenantId, 'zapsign');
  const token = r.secrets.apiToken ? decryptSecret(r.secrets.apiToken) : null;
  if (!r.enabled || !token) throw unprocessable('A ZapSign não está configurada. Ligue a integração e informe o token em Configurações → Integrações.');
  return { token, sandbox: /sandbox/i.test(r.config.environment ?? '') };
}
const base = (cfg: ZapCfg) => (cfg.sandbox ? 'https://sandbox.api.zapsign.com.br' : 'https://api.zapsign.com.br');

async function call<T>(cfg: ZapCfg, path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(`${base(cfg)}${path}`, { method: init.method, headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' }, body: init.body ? JSON.stringify(init.body) : undefined, signal: ctl.signal });
    const text = await r.text();
    let j: unknown = null;
    try { j = JSON.parse(text); } catch { /* resposta não-JSON */ }
    if (!r.ok) {
      const detail = (j && typeof j === 'object' && ('detail' in j || 'message' in j || 'error' in j)) ? String((j as Record<string, unknown>).detail ?? (j as Record<string, unknown>).message ?? (j as Record<string, unknown>).error) : text.slice(0, 200);
      throw new Error(r.status === 401 || r.status === 403 ? 'Token da ZapSign recusado.' : `ZapSign respondeu ${r.status}: ${detail}`);
    }
    return j as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('A ZapSign não respondeu a tempo.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function createZapsignDoc(cfg: ZapCfg, input: { name: string; file: Buffer; mime: string; externalId: string; signers: { name: string; email: string | null; phone: string | null; authMode: string }[]; message?: string; dateLimit?: string | null }) {
  const isPdf = input.mime === 'application/pdf';
  return call<ZapDoc>(cfg, '/api/v1/docs/', {
    method: 'POST',
    body: {
      name: input.name.slice(0, 255),
      [isPdf ? 'base64_pdf' : 'base64_docx']: input.file.toString('base64'),
      lang: 'pt-br',
      external_id: input.externalId,
      date_limit_to_sign: input.dateLimit ?? undefined,
      signers: input.signers.map((sg) => {
        const d = (sg.phone ?? '').replace(/\D/g, '');
        const local = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
        return {
          name: sg.name, email: sg.email ?? '', auth_mode: sg.authMode,
          send_automatic_email: !!sg.email, phone_country: local ? '55' : undefined, phone_number: local || undefined,
          custom_message: input.message || undefined,
        };
      }),
    },
  });
}
export const getZapsignDoc = (cfg: ZapCfg, token: string) => call<ZapDoc>(cfg, `/api/v1/docs/${encodeURIComponent(token)}/`, { method: 'GET' });

/** Baixa o arquivo assinado (link temporário de 60 min da ZapSign). */
export async function downloadFile(url: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`download ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 15_000_000) throw new Error('arquivo assinado grande demais');
    return buf;
  } finally {
    clearTimeout(t);
  }
}
