/** Gmail com senha de app SIMULADO (IMAP/SMTP em memória) para os testes. */
import { randomBytes } from 'node:crypto';
import { GmailPasswordError, type GmailPasswordGateway, type ImapMsg, type OutMail } from '../src/services/gmailPassword';

export function fakeGmailPassword(appPassword = 'abcdefghijklmnop') {
  const boxes = new Map<string, { uidValidity: string; msgs: (ImapMsg & { rfcId: string })[] }>();
  let uid = 0, gid = 1000n;
  const sent: (OutMail & { user: string; messageId: string })[] = [];
  const box = (u: string) => { let b = boxes.get(u); if (!b) { b = { uidValidity: '777', msgs: [] }; boxes.set(u, b); } return b; };
  const check = (p: string) => { if (p !== appPassword) throw new GmailPasswordError('O Gmail recusou o acesso. Use a senha de app de 16 letras (myaccount.google.com/apppasswords), não a senha normal da conta.', true); };
  const add = (user: string, m: { from: string; to: string; subject: string; text: string; inReplyTo?: string | null; rfcId?: string; labels?: string[]; at?: number }) => {
    const b = box(user);
    const rfcId = m.rfcId ?? `<${randomBytes(6).toString('hex')}@remetente.test>`;
    const parent = m.inReplyTo ? b.msgs.find((x) => x.rfcId === m.inReplyTo) : undefined;
    gid += 1n;
    const raw = [`From: ${m.from}`, `To: ${m.to}`, `Subject: ${m.subject}`, `Message-ID: ${rfcId}`, ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []), `Date: ${new Date(m.at ?? Date.now()).toUTCString()}`, 'Content-Type: text/plain; charset=UTF-8', '', m.text].join('\r\n');
    b.msgs.push({ uid: ++uid, emailId: gid.toString(16), threadId: parent?.threadId ?? gid.toString(16), labels: m.labels ?? ['\\Inbox'], internalDate: new Date(m.at ?? Date.now()), raw: Buffer.from(raw), rfcId });
    return rfcId;
  };
  const gateway: GmailPasswordGateway = {
    async verify(_u, p) { check(p); },
    async fetch(user, p, o) {
      check(p);
      const b = box(user);
      const incremental = !!o.afterUid && o.uidValidity === b.uidValidity;
      const list = (incremental ? b.msgs.filter((m) => m.uid > o.afterUid!) : b.msgs.filter((m) => m.internalDate >= o.since)).slice(0, o.max);
      const lastUid = list.length ? Math.max(...list.map((m) => m.uid), o.afterUid ?? 0) : incremental ? o.afterUid! : (b.msgs.at(-1)?.uid ?? 0);
      return { uidValidity: b.uidValidity, lastUid, messages: list };
    },
    async send(user, p, m) {
      check(p);
      const messageId = `<${randomBytes(6).toString('hex')}@gmail.test>`;
      sent.push({ ...m, user, messageId });
      // o Gmail guarda a enviada em "Todos os e-mails", na mesma conversa
      add(user, { from: m.from, to: m.to.join(', '), subject: m.subject, text: m.text, inReplyTo: m.inReplyTo, rfcId: messageId, labels: ['\\Sent'] });
      return { messageId };
    },
  };
  return { gateway, sent, deliver: add };
}
