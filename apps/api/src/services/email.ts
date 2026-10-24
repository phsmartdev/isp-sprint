/**
 * Envio de e-mail pelo SMTP da empresa (Configurações → Integrações).
 * Todo envio fica registrado em email_messages, com sucesso ou erro.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { and, eq } from 'drizzle-orm';
import { renderTemplate, type EmailTemplateKey } from '@isp/shared';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { getActiveInstruction } from './instructions';

// ------------------------------------------------------------------ cifra da senha SMTP

function key() {
  const raw = process.env.APP_ENCRYPTION_KEY ?? process.env.COOKIE_SECRET ?? 'dev-only-cookie-secret-change-me-0123456789';
  return createHash('sha256').update(`isp-sprint:smtp:${raw}`).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob: string): string | null {
  try {
    const [v, iv, tag, data] = blob.split(':');
    if (v !== 'v1' || !iv || !tag || !data) return null;
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    // chave mudou (COOKIE_SECRET trocado): a senha precisa ser cadastrada de novo
    return null;
  }
}

// ------------------------------------------------------------------ envio

export type MailAttachment = { filename: string; content: Buffer; contentType: string };
export type SendInput = {
  tenantId: string;
  kind: string;
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
  opportunityId?: string | null;
  attachmentId?: string | null;
  contractId?: string | null;
  cc?: string | null;
  createdBy?: string | null;
  replyTo?: string | null;
};
export type SendResult = { ok: true; messageId: string; id: string } | { ok: false; error: string; id: string; notConfigured?: boolean };

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const textToHtml = (t: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0A1A4F">${t
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;

export async function smtpConfig(db: DbOrTx, tenantId: string) {
  const [c] = await db.select().from(s.smtpSettings).where(eq(s.smtpSettings.tenantId, tenantId)).limit(1);
  return c ?? null;
}

/** Sobrescreve o transporte nos testes (servidor SMTP falso). */
let transportFactory: ((opts: nodemailer.TransportOptions & Record<string, unknown>) => nodemailer.Transporter) | null = null;
export function setTransportFactory(f: typeof transportFactory) {
  transportFactory = f;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_r, rej) => setTimeout(() => rej(new Error(`Tempo esgotado após ${ms / 1000}s falando com o servidor SMTP`)), ms))]);

export function smtpTls(port: number, secure: boolean) {
  if (port === 465) return { secure: true, requireTLS: false };
  if ([587, 25, 2525].includes(port)) return { secure: false, requireTLS: secure || port === 587 };
  return { secure, requireTLS: false };
}

/** Erros de TLS/conexão em português, com o que fazer. */
export function smtpErrorText(raw: string) {
  if (/wrong version number|tls_validate_record_header/i.test(raw)) return 'A porta e a segurança não combinam: use a porta 465 com SSL/TLS ou a porta 587 com STARTTLS.';
  if (/ECONNREFUSED/i.test(raw)) return 'O servidor SMTP recusou a conexão: confira o endereço e a porta.';
  if (/ETIMEDOUT|timeout/i.test(raw)) return 'O servidor SMTP não respondeu a tempo: confira o endereço, a porta e se o provedor libera o acesso externo.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) return 'Endereço do servidor SMTP não encontrado: confira o host.';
  if (/535|Invalid login|authentication failed|Username and Password not accepted/i.test(raw)) return 'Usuário ou senha do SMTP recusados. No Gmail/Google Workspace, use uma senha de app.';
  if (/self.signed|certificate/i.test(raw)) return 'O certificado do servidor SMTP não é válido para este endereço: confira o host.';
  return raw;
}

export async function sendEmail(db: DbOrTx, input: SendInput): Promise<SendResult> {
  const cfg = await smtpConfig(db, input.tenantId);
  const subject = input.subject.replace(/[\r\n]+/g, ' ').slice(0, 250);
  const log = async (status: 'enviado' | 'falhou' | 'ignorado', error: string | null, messageId: string | null) => {
    const [row] = await db
      .insert(s.emailMessages)
      .values({ tenantId: input.tenantId, kind: input.kind, toAddress: input.to, subject, status, error, messageId, opportunityId: input.opportunityId ?? null, attachmentId: input.attachmentId ?? null, contractId: input.contractId ?? null, ccAddress: input.cc ?? null, createdBy: input.createdBy ?? null })
      .returning({ id: s.emailMessages.id });
    return row!.id;
  };
  if (!cfg || !cfg.enabled) {
    const error = 'E-mail não configurado. Cadastre o SMTP em Configurações → Integrações.';
    return { ok: false, error, notConfigured: true, id: await log('ignorado', error, null) };
  }
  const password = cfg.passwordEnc ? decryptSecret(cfg.passwordEnc) : null;
  if (cfg.passwordEnc && password === null) {
    const error = 'A senha do SMTP não pôde ser lida (a chave do servidor mudou). Cadastre a senha de novo em Configurações → Integrações.';
    return { ok: false, error, id: await log('falhou', error, null) };
  }
  // TLS pela porta: 465 usa TLS direto; 587/25/2525 começam sem TLS e sobem com STARTTLS (marcar "SSL" na 587 dá "wrong version number")
  const tls = smtpTls(cfg.port, cfg.secure);
  const opts = {
    host: cfg.host,
    port: cfg.port,
    secure: tls.secure,
    requireTLS: tls.requireTLS,
    auth: cfg.username ? { user: cfg.username, pass: password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
  try {
    const transport = transportFactory ? transportFactory(opts as never) : nodemailer.createTransport(opts);
    const info = await withTimeout(
      transport.sendMail({
        from: { name: cfg.fromName, address: cfg.fromEmail },
        to: input.to,
        cc: input.cc ?? undefined,
        replyTo: input.replyTo ?? cfg.replyTo ?? undefined,
        subject,
        text: input.text,
        html: textToHtml(input.text),
        attachments: input.attachments,
      }),
      25_000,
    );
    return { ok: true, messageId: String(info.messageId ?? ''), id: await log('enviado', null, String(info.messageId ?? '')) };
  } catch (e) {
    const error = smtpErrorText((e as Error).message).slice(0, 500);
    return { ok: false, error, id: await log('falhou', error, null) };
  }
}

/** Monta assunto e corpo a partir do modelo de e-mail da instrução ativa. */
export async function renderEmail(db: DbOrTx, tenantId: string, keyName: EmailTemplateKey, vars: Record<string, string | number | null | undefined>) {
  const { content } = await getActiveInstruction(db, tenantId);
  const t = content.emails.modelos[keyName];
  return { subject: renderTemplate(t.assunto, vars), text: renderTemplate(t.corpo, vars) };
}

export async function notificationsOf(db: DbOrTx, tenantId: string) {
  const [n] = await db.select().from(s.notificationSettings).where(eq(s.notificationSettings.tenantId, tenantId)).limit(1);
  return n ?? { tenantId, activityDigest: true, leadAssigned: true, dealWon: true, userAccess: true, updatedBy: null, updatedAt: null };
}

/** Alertas nunca derrubam a ação principal: falhas ficam só no registro de e-mails. */
export async function sendAlert(db: DbOrTx, input: SendInput) {
  try {
    return await sendEmail(db, input);
  } catch (e) {
    console.error('alerta por e-mail falhou', e);
    return null;
  }
}

export async function tenantName(db: DbOrTx, tenantId: string) {
  const [t] = await db.select({ name: s.tenants.name }).from(s.tenants).where(eq(s.tenants.id, tenantId)).limit(1);
  return t?.name ?? '';
}

export async function userBasics(db: DbOrTx, tenantId: string, userId: string) {
  const [u] = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, active: s.users.active }).from(s.users).where(and(eq(s.users.id, userId), eq(s.users.tenantId, tenantId))).limit(1);
  return u ?? null;
}

export const brl = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
