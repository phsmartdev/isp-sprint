/**
 * Gmail com senha de app (sem Google Cloud): lê pela IMAP do Gmail (pasta "Todos os e-mails", com os ids de mensagem
 * e de conversa do próprio Gmail — X-GM-MSGID/X-GM-THRID, os mesmos da Gmail API) e envia pelo SMTP do Gmail.
 * As mensagens entram pelo mesmo `ingestMessage` da Gmail API: conversas, vínculo com contas e situação iguais.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';

export type ImapMsg = { uid: number; emailId: string; threadId: string; labels: string[]; internalDate: Date; raw: Buffer };
export type ImapFetch = { uidValidity: string; lastUid: number; messages: ImapMsg[] };
export type OutMail = { from: string; fromName?: string | null; to: string[]; cc?: string[]; subject: string; text: string; inReplyTo?: string | null; references?: string | null };
export type GmailPasswordGateway = {
  verify(user: string, pass: string): Promise<void>;
  fetch(user: string, pass: string, opts: { since: Date; afterUid?: number; uidValidity?: string; max: number }): Promise<ImapFetch>;
  send(user: string, pass: string, mail: OutMail): Promise<{ messageId: string }>;
  /** Fonte original (RFC 822) de uma mensagem pelo id do Gmail (hexadecimal). */
  fetchRaw(user: string, pass: string, emailIdHex: string): Promise<Buffer | null>;
};

export class GmailPasswordError extends Error {
  constructor(message: string, public auth = false) { super(message); }
}

const IMAP = { host: 'imap.gmail.com', port: 993, secure: true } as const;
const SMTP = { host: 'smtp.gmail.com', port: 465, secure: true } as const;
/** ids do Gmail em hexadecimal, como a Gmail API devolve */
const hex = (v: unknown) => { try { return BigInt(String(v)).toString(16); } catch { return String(v ?? ''); } };

function friendly(e: unknown): GmailPasswordError {
  const m = (e as { responseText?: string; message?: string }).responseText ?? (e as Error).message ?? String(e);
  if (/AUTHENTICATIONFAILED|Invalid credentials|535|Username and Password not accepted|authentication failed/i.test(m)) {
    return new GmailPasswordError('O Gmail recusou o acesso. Use a senha de app de 16 letras (myaccount.google.com/apppasswords), não a senha normal da conta.', true);
  }
  if (/Web login required|Application-specific password required/i.test(m)) return new GmailPasswordError('O Gmail pede senha de app: ligue a verificação em duas etapas e crie uma em myaccount.google.com/apppasswords.', true);
  if (/IMAP access is disabled|\[ALERT\].*IMAP/i.test(m)) return new GmailPasswordError('O acesso IMAP está desligado nesta conta Gmail. Ligue em Gmail → Configurações → Encaminhamento e POP/IMAP.', true);
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(m)) return new GmailPasswordError('Não foi possível falar com o Gmail agora. Tente de novo em instantes.');
  return new GmailPasswordError(m.slice(0, 300));
}

const client = (user: string, pass: string) => new ImapFlow({ ...IMAP, auth: { user, pass }, logger: false, socketTimeout: 60_000, greetingTimeout: 15_000, connectionTimeout: 15_000 } as ConstructorParameters<typeof ImapFlow>[0]);

const realGateway: GmailPasswordGateway = {
  async verify(user, pass) {
    const c = client(user, pass);
    try { await c.connect(); } catch (e) { throw friendly(e); } finally { await c.logout().catch(() => undefined); }
    const t = nodemailer.createTransport({ ...SMTP, auth: { user, pass }, connectionTimeout: 15_000 });
    try { await t.verify(); } catch (e) { throw friendly(e); }
  },
  async fetch(user, pass, opts) {
    const c = client(user, pass);
    try {
      await c.connect();
      const boxes = await c.list();
      const all = boxes.find((b) => b.specialUse === '\\All')?.path ?? 'INBOX';
      const lock = await c.getMailboxLock(all, { readOnly: true });
      try {
        const mb = c.mailbox as { uidValidity: bigint | number; uidNext: number };
        const uidValidity = String(mb.uidValidity);
        let uids: number[];
        if (opts.afterUid && opts.uidValidity === uidValidity) {
          uids = ((await c.search({ uid: `${opts.afterUid + 1}:*` }, { uid: true })) || []).filter((u) => u > opts.afterUid!);
          uids.sort((a, b) => a - b);
          uids = uids.slice(0, opts.max); // as mais antigas primeiro; o resto vem na próxima rodada
        } else {
          uids = ((await c.search({ since: opts.since }, { uid: true })) || []).sort((a, b) => a - b).slice(-opts.max); // janela inicial: as mais recentes
        }
        const messages: ImapMsg[] = [];
        if (uids.length) {
          for await (const m of c.fetch(uids.join(','), { uid: true, source: true, internalDate: true, threadId: true, labels: true }, { uid: true })) {
            messages.push({ uid: m.uid, emailId: hex(m.emailId), threadId: hex(m.threadId ?? m.emailId), labels: [...(m.labels ?? [])], internalDate: new Date(m.internalDate ?? Date.now()), raw: m.source as Buffer });
          }
        }
        const lastUid = uids.length ? Math.max(...uids, opts.afterUid ?? 0) : opts.afterUid && opts.uidValidity === uidValidity ? opts.afterUid : Math.max(0, (mb.uidNext ?? 1) - 1);
        return { uidValidity, lastUid, messages };
      } finally { lock.release(); }
    } catch (e) { throw e instanceof GmailPasswordError ? e : friendly(e); } finally { await c.logout().catch(() => undefined); }
  },
  async fetchRaw(user, pass, emailIdHex) {
    const c = client(user, pass);
    try {
      await c.connect();
      const all = (await c.list()).find((b) => b.specialUse === '\\All')?.path ?? 'INBOX';
      const lock = await c.getMailboxLock(all, { readOnly: true });
      try {
        const dec = (() => { try { return BigInt(`0x${emailIdHex}`).toString(); } catch { return null; } })();
        if (!dec) return null;
        const uids = (await c.search({ emailId: dec } as Parameters<typeof c.search>[0], { uid: true })) || [];
        if (!uids.length) return null;
        const m = await c.fetchOne(String(uids[0]), { source: true }, { uid: true });
        return m && m.source ? (m.source as Buffer) : null;
      } finally { lock.release(); }
    } catch (e) { throw e instanceof GmailPasswordError ? e : friendly(e); } finally { await c.logout().catch(() => undefined); }
  },
  async send(user, pass, m) {
    const t = nodemailer.createTransport({ ...SMTP, auth: { user, pass }, connectionTimeout: 15_000, socketTimeout: 30_000 });
    try {
      const info = await t.sendMail({ from: m.fromName ? { name: m.fromName, address: m.from } : m.from, to: m.to, cc: m.cc?.length ? m.cc : undefined, subject: m.subject, text: m.text, inReplyTo: m.inReplyTo ?? undefined, references: m.references ?? undefined });
      return { messageId: String(info.messageId) };
    } catch (e) { throw friendly(e); }
  },
};

let gateway: GmailPasswordGateway = realGateway;
/** Testes trocam o Gmail real por um simulado. */
export function setGmailPasswordGateway(g: GmailPasswordGateway | null) { gateway = g ?? realGateway; }
export const gmailPassword = () => gateway;

/** Senha de app vem com espaços ("abcd efgh ijkl mnop"); o Gmail aceita sem eles. */
export const normalizeAppPassword = (v: string) => v.replace(/\s+/g, '');

const addrText = (a: AddressObject | AddressObject[] | undefined) => (!a ? '' : Array.isArray(a) ? a.map((x) => x.text).join(', ') : a.text);
const b64u = (v: string) => Buffer.from(v, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const LABELS: Record<string, string> = { '\\Sent': 'SENT', '\\Draft': 'DRAFT', '\\Spam': 'SPAM', '\\Trash': 'TRASH', '\\Inbox': 'INBOX' };

/** Converte a mensagem da IMAP no formato que o `ingestMessage` já entende (o mesmo da Gmail API). */
export async function imapToGMessage(m: ImapMsg) {
  const p = await simpleParser(m.raw);
  const text = (p.text ?? (typeof p.html === 'string' ? p.html.replace(/<[^>]+>/g, ' ') : '') ?? '').trim();
  const headers = [
    { name: 'From', value: addrText(p.from) },
    { name: 'To', value: addrText(p.to) },
    ...(p.cc ? [{ name: 'Cc', value: addrText(p.cc) }] : []),
    { name: 'Subject', value: p.subject ?? '' },
    ...(p.messageId ? [{ name: 'Message-ID', value: p.messageId }] : []),
  ];
  return {
    id: m.emailId, threadId: m.threadId, labelIds: m.labels.map((l) => LABELS[l] ?? l), snippet: text.replace(/\s+/g, ' ').slice(0, 200), internalDate: String(m.internalDate.getTime()),
    payload: { mimeType: 'multipart/mixed', headers, parts: [{ mimeType: 'text/plain', body: { data: b64u(text) } }, ...p.attachments.map((a) => ({ mimeType: a.contentType, filename: a.filename || 'anexo', body: { size: a.size || 1 } }))] },
  };
}
