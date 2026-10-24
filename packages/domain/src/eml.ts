/**
 * Monta um arquivo .eml (RFC 5322) a partir de uma mensagem guardada: cabeçalhos com acento em RFC 2047
 * e corpo em texto UTF-8 (base64). Usado para anexar à negociação o e-mail que deu origem a ela.
 */
export type EmlInput = { from: string; fromName?: string | null; to: string[]; cc?: string[]; subject: string; date: Date; messageId?: string | null; text: string };

const needsEncoding = (v: string) => /[^\x20-\x7e]/.test(v);
const word = (v: string) => (needsEncoding(v) ? `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=` : v);
const clean = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();
const addr = (email: string, name?: string | null) => (name && clean(name) ? `${word(clean(name).replace(/"/g, "'"))} <${clean(email)}>` : clean(email));
const wrap = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();

export function buildEml(m: EmlInput): string {
  const headers = [
    `From: ${addr(m.from, m.fromName)}`,
    `To: ${m.to.map((x) => addr(x)).join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.map((x) => addr(x)).join(', ')}`] : []),
    `Subject: ${word(clean(m.subject) || '(sem assunto)')}`,
    `Date: ${m.date.toUTCString().replace('GMT', '+0000')}`,
    ...(m.messageId ? [`Message-ID: ${clean(m.messageId)}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${wrap(Buffer.from(m.text ?? '', 'utf8').toString('base64'))}\r\n`;
}

/** Nome de arquivo seguro para o .eml a partir do assunto. */
export const emlFilename = (subject: string) => `E-mail de origem - ${(clean(subject) || 'sem assunto').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80).trim()}.eml`;
