/**
 * Assinatura de e-mail de cada pessoa: texto (versão sem formatação) e, opcionalmente, a imagem que a empresa usa na
 * caixa do Gmail. A imagem vai embutida (cid) no HTML, sem depender de link externo, como faz o Gmail.
 */
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { MailAttachment } from './email';

export const SIGNATURE_CID = 'assinatura@revops';
export const SIGNATURE_MAX_WIDTH = 600;

export type Signature = { text: string; image: { mime: string; data: Buffer; width: number } | null };

export async function signatureOf(db: DbOrTx, userId: string): Promise<Signature> {
  const [r] = await db.select().from(s.mailSignatures).where(eq(s.mailSignatures.userId, userId)).limit(1);
  if (!r) return { text: '', image: null };
  return { text: r.text.trim(), image: r.imageData && r.imageMime ? { mime: r.imageMime, data: r.imageData, width: Math.min(r.imageWidth ?? SIGNATURE_MAX_WIDTH, SIGNATURE_MAX_WIDTH) } : null };
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Bloco HTML da assinatura: a imagem (quando há) ou o texto. */
export function signatureHtml(sig: Signature) {
  if (sig.image) return `<img src="cid:${SIGNATURE_CID}" width="${sig.image.width}" alt="${esc(sig.text.split('\n')[0] ?? 'Assinatura')}" style="display:block;border:0;max-width:100%;width:${sig.image.width}px;height:auto">`;
  if (!sig.text) return '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#5F6B76">${esc(sig.text).replace(/\n/g, '<br>')}</div>`;
}

export function signatureAttachment(sig: Signature): MailAttachment[] {
  if (!sig.image) return [];
  return [{ filename: `assinatura.${sig.image.mime === 'image/png' ? 'png' : 'jpg'}`, content: sig.image.data, contentType: sig.image.mime, cid: SIGNATURE_CID }];
}

/** Texto do e-mail com a assinatura no fim; com imagem, também o HTML (texto do e-mail + imagem embutida). */
export function withSignatureParts(body: string, sig: Signature) {
  const text = sig.text ? `${body.trimEnd()}\n\n-- \n${sig.text}` : body;
  if (!sig.image) return { text, html: undefined, attachments: [] as MailAttachment[] };
  const bodyHtml = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#2D3339">${esc(body.trimEnd()).replace(/\n/g, '<br>')}</div>`;
  return { text, html: `<!doctype html><html><body>${bodyHtml}<br><div>-- </div>${signatureHtml(sig)}</body></html>`, attachments: signatureAttachment(sig) };
}
