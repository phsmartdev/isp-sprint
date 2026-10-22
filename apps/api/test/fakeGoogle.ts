/**
 * Servidor SIMULADO do Google (OAuth 2.0 + Gmail API v1) para testes. Não é usado em produção:
 * a API só aceita `GOOGLE_FAKE_BASE` fora de produção.
 *
 * Implementa o mínimo que o CRM usa, no formato da API real: autorização (consentimento automático),
 * token (código e renovação), userinfo, revoke, profile, messages.list/get/send e history.list.
 * Ganchos de teste em /__test/* para entregar mensagens, expirar o histórico e trocar a conta autorizada.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

type Msg = { id: string; threadId: string; labelIds: string[]; internalDate: number; headers: Record<string, string>; text: string; html?: string; attachment?: string; historyId: number };
type Box = { email: string; messages: Msg[]; history: { id: number; messageId: string; threadId: string; labelIds: string[] }[]; historyId: number; minHistory: number };

export type FakeGoogle = {
  url: string;
  close: () => Promise<void>;
  deliver: (to: string, m: { from: string; subject: string; text: string; html?: string; threadOf?: string; cc?: string; attachment?: string; at?: number; messageId?: string }) => Msg;
  box: (email: string) => Box;
  expireHistory: (email: string) => void;
  setNextAccount: (email: string | null) => void;
  setGrantScopes: (scope: string | null) => void;
  revokeAll: () => void;
  sent: { from: string; raw: string; threadId?: string }[];
};

const b64u = (v: string) => Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (v: string) => Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const id = () => randomBytes(8).toString('hex');

function parseRaw(raw: string) {
  const txt = fromB64u(raw);
  const [head, ...rest] = txt.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of (head ?? '').split('\r\n')) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const body = rest.join('\r\n\r\n');
  const decodeWord = (v: string) => v.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  for (const k of Object.keys(headers)) headers[k] = decodeWord(headers[k]!);
  const text = /base64/i.test(headers['Content-Transfer-Encoding'] ?? '') ? Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') : body;
  return { headers, text };
}

export async function startFakeGoogle(port = 0): Promise<FakeGoogle> {
  const boxes = new Map<string, Box>();
  const codes = new Map<string, { email: string; scope: string }>();
  const access = new Map<string, string>(); // token -> email
  const refresh = new Map<string, { email: string; scope: string }>();
  let nextAccount: string | null = null;
  let grantScopes: string | null = null;
  const sent: FakeGoogle['sent'] = [];

  const box = (email: string) => {
    const e = email.toLowerCase();
    if (!boxes.has(e)) boxes.set(e, { email: e, messages: [], history: [], historyId: 1000, minHistory: 0 });
    return boxes.get(e)!;
  };
  const store = (b: Box, m: Omit<Msg, 'historyId'>) => {
    b.historyId += 1;
    const msg = { ...m, historyId: b.historyId };
    b.messages.push(msg);
    b.history.push({ id: b.historyId, messageId: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
    return msg;
  };
  const threadFor = (b: Box, subject: string, threadOf?: string) => {
    if (threadOf) { const m = b.messages.find((x) => x.id === threadOf || x.threadId === threadOf || x.headers['Message-ID'] === threadOf); if (m) return m.threadId; }
    const base = subject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, '').trim();
    const same = b.messages.find((x) => (x.headers.Subject ?? '').replace(/^\s*(re|fw|fwd)\s*:\s*/i, '').trim() === base && base);
    return same?.threadId ?? `t${id()}`;
  };
  const deliver: FakeGoogle['deliver'] = (to, m) => {
    const b = box(to);
    const messageId = m.messageId ?? `<${id()}@remetente.test>`;
    return store(b, {
      id: id(), threadId: threadFor(b, m.subject, m.threadOf), labelIds: ['INBOX', 'UNREAD'], internalDate: m.at ?? Date.now(),
      headers: { From: m.from, To: to, ...(m.cc ? { Cc: m.cc } : {}), Subject: m.subject, Date: new Date(m.at ?? Date.now()).toUTCString(), 'Message-ID': messageId },
      text: m.text, html: m.html, attachment: m.attachment,
    });
  };

  const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req: IncomingMessage) => new Promise<string>((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d)); });
  const who = (req: IncomingMessage) => { const t = (req.headers.authorization ?? '').replace(/^Bearer /, ''); return access.get(t) ?? null; };

  const payloadOf = (m: Msg) => {
    const headers = Object.entries(m.headers).map(([name, value]) => ({ name, value }));
    const parts = [{ mimeType: 'text/plain', body: { data: b64u(m.text), size: m.text.length } }, ...(m.html ? [{ mimeType: 'text/html', body: { data: b64u(m.html), size: m.html.length } }] : [])];
    const alt = { mimeType: 'multipart/alternative', parts };
    return m.attachment ? { mimeType: 'multipart/mixed', headers, parts: [alt, { mimeType: 'application/pdf', filename: m.attachment, body: { attachmentId: 'att1', size: 1234 } }] } : { ...alt, headers };
  };

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://fake');
    const p = u.pathname;
    try {
      // ------------------------------------------------ OAuth
      if (p === '/o/oauth2/v2/auth') {
        const email = (nextAccount ?? u.searchParams.get('login_hint') ?? 'ninguem@exemplo.test').toLowerCase();
        const code = id();
        codes.set(code, { email, scope: grantScopes ?? (u.searchParams.get('scope') ?? '') });
        const back = new URL(u.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', code); back.searchParams.set('state', u.searchParams.get('state') ?? '');
        res.writeHead(302, { location: back.toString() }); return res.end();
      }
      if (p === '/token' && req.method === 'POST') {
        const f = new URLSearchParams(await readBody(req));
        if (f.get('grant_type') === 'authorization_code') {
          const c = codes.get(f.get('code') ?? '');
          if (!c) return json(res, 400, { error: 'invalid_grant' });
          codes.delete(f.get('code')!);
          const at = `at_${id()}`, rt = `rt_${id()}`;
          access.set(at, c.email); refresh.set(rt, c);
          return json(res, 200, { access_token: at, refresh_token: rt, expires_in: 3599, scope: c.scope, token_type: 'Bearer' });
        }
        if (f.get('grant_type') === 'refresh_token') {
          const r = refresh.get(f.get('refresh_token') ?? '');
          if (!r) return json(res, 400, { error: 'invalid_grant' });
          const at = `at_${id()}`; access.set(at, r.email);
          return json(res, 200, { access_token: at, expires_in: 3599, scope: r.scope, token_type: 'Bearer' });
        }
        return json(res, 400, { error: 'unsupported_grant_type' });
      }
      if (p === '/v1/userinfo') { const e = who(req); return e ? json(res, 200, { email: e, email_verified: true, sub: `g-${e}` }) : json(res, 401, { error: 'invalid_token' }); }
      if (p === '/revoke') { const t = u.searchParams.get('token') ?? ''; refresh.delete(t); return json(res, 200, {}); }

      // ------------------------------------------------ ganchos de teste
      if (p === '/__test/deliver' && req.method === 'POST') { const b = JSON.parse(await readBody(req)); return json(res, 200, deliver(b.to, b)); }
      if (p === '/__test/sent') return json(res, 200, { sent: sent.map((x) => ({ ...x, parsed: parseRaw(x.raw) })) });
      if (p === '/__test/next-account' && req.method === 'POST') { nextAccount = JSON.parse(await readBody(req)).email ?? null; return json(res, 200, {}); }

      // ------------------------------------------------ Gmail API v1
      const g = p.match(/^\/gmail\/v1\/users\/me(\/.*)$/);
      if (g) {
        const email = who(req);
        if (!email) return json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
        const b = box(email);
        const rest = g[1]!;
        if (rest === '/profile') return json(res, 200, { emailAddress: email, messagesTotal: b.messages.length, historyId: String(b.historyId) });
        if (rest === '/messages' && req.method === 'GET') {
          const days = Number((u.searchParams.get('q') ?? '').match(/newer_than:(\d+)d/)?.[1] ?? 3650);
          const since = Date.now() - days * 86_400_000;
          const list = b.messages.filter((m) => m.internalDate >= since).sort((x, y) => y.internalDate - x.internalDate);
          const max = Number(u.searchParams.get('maxResults') ?? 100), start = Number(u.searchParams.get('pageToken') ?? 0);
          const page = list.slice(start, start + max);
          return json(res, 200, { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })), resultSizeEstimate: list.length, ...(start + max < list.length ? { nextPageToken: String(start + max) } : {}) });
        }
        const mm = rest.match(/^\/messages\/([^/]+)$/);
        if (mm && req.method === 'GET') {
          const m = b.messages.find((x) => x.id === mm[1]);
          if (!m) return json(res, 404, { error: { code: 404, message: 'Requested entity was not found.' } });
          return json(res, 200, { id: m.id, threadId: m.threadId, labelIds: m.labelIds, snippet: m.text.slice(0, 120), historyId: String(m.historyId), internalDate: String(m.internalDate), payload: payloadOf(m) });
        }
        if (rest === '/history') {
          const start = Number(u.searchParams.get('startHistoryId'));
          if (!start || start < b.minHistory) return json(res, 404, { error: { code: 404, message: 'Requested entity was not found.' } });
          const h = b.history.filter((x) => x.id > start);
          return json(res, 200, { history: h.map((x) => ({ id: String(x.id), messagesAdded: [{ message: { id: x.messageId, threadId: x.threadId, labelIds: x.labelIds } }] })), historyId: String(b.historyId) });
        }
        if (rest === '/messages/send' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req)) as { raw: string; threadId?: string };
          const { headers, text } = parseRaw(body.raw);
          sent.push({ from: email, raw: body.raw, threadId: body.threadId });
          const threadId = body.threadId && b.messages.some((m) => m.threadId === body.threadId) ? body.threadId : `t${id()}`;
          const msg = store(b, { id: id(), threadId, labelIds: ['SENT'], internalDate: Date.now(), headers: { ...headers, 'Message-ID': `<${id()}@${email.split('@')[1]}>` }, text });
          return json(res, 200, { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
        }
        return json(res, 404, { error: { code: 404, message: 'Not found' } });
      }
      json(res, 404, { error: 'not_found' });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((ok) => server.listen(port, '127.0.0.1', ok));
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`;
  return {
    url, sent, deliver, box,
    close: () => new Promise((ok) => server.close(() => ok())),
    expireHistory: (email) => { const b = box(email); b.minHistory = b.historyId + 1; },
    setNextAccount: (e) => { nextAccount = e; },
    setGrantScopes: (s) => { grantScopes = s; },
    revokeAll: () => { refresh.clear(); access.clear(); },
  };
}
