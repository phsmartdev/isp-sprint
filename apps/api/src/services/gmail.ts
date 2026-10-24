/**
 * E-mail corporativo pela Gmail API (Google Workspace).
 *
 * - Conexão por caixa com OAuth (acesso offline); tokens cifrados no banco, nunca enviados ao navegador.
 * - Sincronização incremental pelo histórico do Gmail (history.list); sem histórico válido, refaz a janela configurada.
 * - Cada mensagem nova passa pelas regras, vira/atualiza a conversa, é ligada à conta do CRM quando não há dúvida
 *   e entra na fila com o direcionamento da fila.
 * - Resposta enviada pelo CRM sai pelo próprio Gmail da caixa (messages.send), na mesma conversa.
 *
 * Validação real pendente: exige projeto no Google Cloud com a Gmail API ativa e os escopos aprovados.
 * Nos testes, `GOOGLE_FAKE_BASE` aponta para um servidor simulado (só fora de produção).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  autoLinkContact, domainAllowed, evaluateRules, externalParticipants, parseAddresses, pickAssignee, statusAfterMessage,
  type MailRule, type MailRuleDef, type RoutingMode, type ThreadStatus,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { Config } from '../config';
import { decryptSecret, encryptSecret } from './email';
import { gmailPassword, GmailPasswordError, imapToGMessage } from './gmailPassword';

type GmailCfg = NonNullable<Config['gmail']>;
type Box = typeof s.mailboxes.$inferSelect;

export class GmailError extends Error {
  constructor(message: string, public readonly status: number, public readonly reauth = false) { super(message); }
}

async function gfetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 15_000);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// ------------------------------------------------------------------ OAuth

export async function exchangeCode(cfg: GmailCfg, code: string, redirectUri: string) {
  const r = await gfetch(cfg.endpoints.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!r.ok || !j.access_token) throw new GmailError(`O Google recusou a troca do código (${j.error ?? r.status}).`, r.status);
  const ui = await gfetch(cfg.endpoints.userinfo, { headers: { authorization: `Bearer ${j.access_token}` } });
  const info = (await ui.json().catch(() => ({}))) as { email?: string; email_verified?: boolean };
  if (!ui.ok || !info.email) throw new GmailError('Não foi possível confirmar o e-mail da conta Google.', ui.status);
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? null, expiresIn: j.expires_in ?? 3600, scope: j.scope ?? '', email: info.email.toLowerCase(), verified: info.email_verified === true };
}

async function accessToken(db: DbOrTx, cfg: GmailCfg, box: Box): Promise<string> {
  if (box.accessTokenEnc && box.accessExpiresAt && box.accessExpiresAt.getTime() > Date.now() + 60_000) {
    const t = decryptSecret(box.accessTokenEnc);
    if (t) return t;
  }
  const refresh = box.refreshTokenEnc ? decryptSecret(box.refreshTokenEnc) : null;
  if (!refresh) throw new GmailError('A caixa precisa ser conectada de novo (acesso ao Google ausente).', 401, true);
  const r = await gfetch(cfg.endpoints.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refresh, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) throw new GmailError(j.error === 'invalid_grant' ? 'O acesso foi revogado no Google. Conecte a caixa de novo.' : `Falha ao renovar o acesso (${j.error ?? r.status}).`, r.status, j.error === 'invalid_grant');
  await db.update(s.mailboxes).set({ accessTokenEnc: encryptSecret(j.access_token), accessExpiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000) }).where(eq(s.mailboxes.id, box.id));
  return j.access_token;
}

async function gmailApi<T>(db: DbOrTx, cfg: GmailCfg, box: Box, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(db, cfg, box);
  const r = await gfetch(`${cfg.endpoints.gmail}/users/me${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GmailError(j.error?.message ?? `Gmail respondeu ${r.status}`, r.status, r.status === 401);
  }
  return (await r.json()) as T;
}

export async function revokeToken(cfg: GmailCfg, box: Box) {
  const t = box.refreshTokenEnc ? decryptSecret(box.refreshTokenEnc) : null;
  if (!t) return;
  await gfetch(`${cfg.endpoints.revoke}?token=${encodeURIComponent(t)}`, { method: 'POST', timeoutMs: 8000 }).catch(() => undefined);
}

// ------------------------------------------------------------------ mensagens do Gmail

type GPart = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GPart[] };
export type GMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; historyId?: string; internalDate?: string; payload?: GPart };

const b64d = (v: string) => Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
function header(p: GPart | undefined, name: string) { return p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null; }
function walk(p: GPart | undefined, f: (x: GPart) => void) { if (!p) return; f(p); for (const c of p.parts ?? []) walk(c, f); }
const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();

/** Extrai o que guardamos: cabeçalhos, texto (preferindo text/plain), se tem anexo. */
export function parseGmailMessage(m: GMessage) {
  let plain: string | null = null, html: string | null = null, attach = false;
  walk(m.payload, (x) => {
    if (x.filename && (x.body?.attachmentId || (x.body?.size ?? 0) > 0)) attach = true;
    else if (x.mimeType === 'text/plain' && x.body?.data && plain === null) plain = b64d(x.body.data);
    else if (x.mimeType === 'text/html' && x.body?.data && html === null) html = b64d(x.body.data);
  });
  const from = parseAddresses(header(m.payload, 'From'))[0] ?? null;
  const date = m.internalDate ? new Date(Number(m.internalDate)) : new Date(header(m.payload, 'Date') ?? Date.now());
  return {
    from, to: parseAddresses(header(m.payload, 'To')).map((a) => a.email), cc: parseAddresses(header(m.payload, 'Cc')).map((a) => a.email),
    subject: (header(m.payload, 'Subject') ?? '').slice(0, 500), rfcId: header(m.payload, 'Message-ID') ?? header(m.payload, 'Message-Id'),
    sentAt: Number.isNaN(date.getTime()) ? new Date() : date,
    text: ((plain ?? (html ? stripHtml(html) : '')) as string).slice(0, 100_000), snippet: (m.snippet ?? '').slice(0, 300), hasAttachments: attach, labels: m.labelIds ?? [],
  };
}

// ------------------------------------------------------------------ entrada de mensagem

type Ctx = { domains: string[]; rules: MailRule[]; queues: Map<string, typeof s.mailQueues.$inferSelect> };

async function loadCtx(db: DbOrTx, tenantId: string): Promise<Ctx> {
  const [st] = await db.select().from(s.mailSettings).where(eq(s.mailSettings.tenantId, tenantId)).limit(1);
  const rules = await db.select().from(s.mailRules).where(eq(s.mailRules.tenantId, tenantId));
  const queues = await db.select().from(s.mailQueues).where(and(eq(s.mailQueues.tenantId, tenantId), eq(s.mailQueues.active, true)));
  return {
    domains: st?.allowedDomains ?? [],
    rules: rules.map((r) => ({ id: r.id, name: r.name, position: r.position, active: r.active, mailboxId: r.mailboxId, def: r.def as MailRuleDef })),
    queues: new Map(queues.map((q) => [q.id, q])),
  };
}

async function matchContacts(db: DbOrTx, tenantId: string, emails: string[]) {
  if (!emails.length) return [];
  const list = sql.join(emails.map((e) => sql`${e}`), sql`, `);
  const r = await db.execute(sql`
    select lower(c.email) as email, c.id as contact_id from contacts c where c.tenant_id = ${tenantId} and c.deleted_at is null and lower(c.email) in (${list})
    union
    select lower(p.email), st.contact_id from people p join account_stakeholders st on st.person_id = p.id and st.active
      join contacts c on c.id = st.contact_id and c.deleted_at is null
     where p.tenant_id = ${tenantId} and lower(p.email) in (${list})`);
  return (r.rows as { email: string; contact_id: string }[]).map((x) => ({ email: x.email, contactId: x.contact_id }));
}

async function route(db: DbOrTx, tenantId: string, queue: typeof s.mailQueues.$inferSelect, contactId: string | null) {
  if (!queue.members.length || queue.routing === 'manual') return null;
  const loads = (await db.execute(sql`select assignee_id, count(*)::int n, max(assigned_at) last from mail_threads where tenant_id = ${tenantId} and assignee_id = any(${`{${queue.members.join(',')}}`}::uuid[]) and status in ('nova','em_atendimento','aguardando_cliente') group by assignee_id`)).rows as { assignee_id: string; n: number; last: string | null }[];
  const active = (await db.select({ id: s.users.id }).from(s.users).where(and(inArray(s.users.id, queue.members), eq(s.users.active, true)))).map((u) => u.id);
  let owner: string | null = null;
  if (contactId) { const [c] = await db.select({ o: s.contacts.ownerId }).from(s.contacts).where(eq(s.contacts.id, contactId)).limit(1); owner = c?.o ?? null; }
  const lastAll = (await db.execute(sql`select assignee_id, max(assigned_at) last from mail_threads where tenant_id = ${tenantId} and assignee_id is not null group by assignee_id`)).rows as { assignee_id: string; last: string | null }[];
  return pickAssignee({
    mode: queue.routing as RoutingMode, members: queue.members, available: active, accountOwnerId: owner,
    openLoad: Object.fromEntries(loads.map((l) => [l.assignee_id, l.n])),
    lastAssignedAt: Object.fromEntries(lastAll.map((l) => [l.assignee_id, l.last ? new Date(l.last).toISOString() : null])),
  });
}

const ev = (tenantId: string, threadId: string, type: string, payload: Record<string, unknown> = {}, actorId: string | null = null) => ({ tenantId, threadId, type, payload, actorId });

/** Grava uma mensagem (idempotente pelo id do Gmail) e atualiza a conversa. Devolve true se era nova. */
export async function ingestMessage(db: DbOrTx, box: Box, ctx: Ctx, m: GMessage, sentBy: string | null = null): Promise<boolean> {
  const p = parseGmailMessage(m);
  if (p.labels.some((l) => ['DRAFT', 'SPAM', 'TRASH', 'CHAT'].includes(l))) return false;
  const fromEmail = p.from?.email ?? '';
  const direction: 'entrada' | 'saida' = fromEmail === box.address || p.labels.includes('SENT') ? 'saida' : 'entrada';
  const participants = [...new Set([fromEmail, ...p.to, ...p.cc].filter(Boolean))];
  const tenantId = box.tenantId;
  // a mesma mensagem por outro caminho (ex.: enviada pelo SMTP e depois lida na IMAP) não entra duas vezes
  if (p.rfcId) {
    const [dup] = await db.select({ id: s.mailMessages.id }).from(s.mailMessages).where(and(eq(s.mailMessages.mailboxId, box.id), eq(s.mailMessages.rfcMessageId, p.rfcId))).limit(1);
    if (dup) return false;
  }

  let [thread] = await db.select().from(s.mailThreads).where(and(eq(s.mailThreads.mailboxId, box.id), eq(s.mailThreads.gmailThreadId, m.threadId))).limit(1);
  const isNewThread = !thread;
  if (!thread) {
    [thread] = await db.insert(s.mailThreads).values({
      tenantId, mailboxId: box.id, gmailThreadId: m.threadId, subject: p.subject, snippet: p.snippet, participants, lastMessageAt: p.sentAt,
      status: direction === 'saida' ? 'aguardando_cliente' : 'nova', unread: direction === 'entrada',
      assigneeId: box.kind === 'pessoal' ? box.ownerId : null, assignedAt: box.kind === 'pessoal' ? new Date() : null,
    }).onConflictDoNothing().returning();
    if (!thread) [thread] = await db.select().from(s.mailThreads).where(and(eq(s.mailThreads.mailboxId, box.id), eq(s.mailThreads.gmailThreadId, m.threadId))).limit(1);
  }
  const t = thread!;
  const [ins] = await db.insert(s.mailMessages).values({
    tenantId, threadId: t.id, mailboxId: box.id, gmailId: m.id, rfcMessageId: p.rfcId, direction, fromAddr: fromEmail || '(desconhecido)', fromName: p.from?.name ?? null,
    toAddrs: p.to, ccAddrs: p.cc, subject: p.subject, sentAt: p.sentAt, snippet: p.snippet, bodyText: p.text, hasAttachments: p.hasAttachments, sentBy,
  }).onConflictDoNothing().returning({ id: s.mailMessages.id });
  if (!ins) return false;

  const patch: Partial<typeof s.mailThreads.$inferInsert> = { participants: [...new Set([...t.participants, ...participants])] };
  const newer = p.sentAt.getTime() >= t.lastMessageAt.getTime();
  if (newer) { patch.lastMessageAt = p.sentAt; patch.snippet = p.snippet; if (!t.subject && p.subject) patch.subject = p.subject; }
  const events: (typeof s.mailThreadEvents.$inferInsert)[] = [];
  if (direction === 'entrada') {
    if (!t.firstInboundAt || p.sentAt < t.firstInboundAt) patch.firstInboundAt = p.sentAt;
    if (newer) patch.unread = true;
  } else if (t.firstInboundAt && !t.firstReplyAt && p.sentAt > t.firstInboundAt) {
    patch.firstReplyAt = p.sentAt; patch.firstReplyBy = sentBy ?? (box.kind === 'pessoal' ? box.ownerId : t.assigneeId);
  }
  if (newer && !isNewThread) {
    const next = statusAfterMessage(t.status as ThreadStatus, direction, !!t.assigneeId);
    if (next !== t.status) { patch.status = next; events.push(ev(tenantId, t.id, 'situacao', { from: t.status, to: next, reason: direction === 'entrada' ? 'mensagem do cliente' : 'resposta enviada' })); }
  }

  // primeira mensagem de uma conversa nova: regras, conta e fila
  if (isNewThread) {
    events.push(ev(tenantId, t.id, 'recebida', { direction }));
    const ext = externalParticipants(participants, ctx.domains.length ? ctx.domains : [box.address.split('@')[1]!]);
    if (!t.contactId) {
      const link = autoLinkContact(await matchContacts(db, tenantId, ext));
      if (link.contactId) { patch.contactId = link.contactId; patch.linkSource = 'automatico'; events.push(ev(tenantId, t.id, 'vinculada', { contactId: link.contactId, automatic: true })); }
      if (link.ambiguous) patch.linkAmbiguous = true;
    }
    if (box.kind === 'compartilhada' && direction === 'entrada') {
      const hit = evaluateRules(ctx.rules, { from: fromEmail, to: p.to, subject: p.subject, text: p.text, mailboxId: box.id });
      let queueId: string | null = null, assignee: string | null = null;
      if (hit) {
        patch.ruleId = hit.rule.id;
        if (hit.actions.priority) patch.priority = hit.actions.priority;
        if (hit.actions.tag) patch.tags = [hit.actions.tag.trim()];
        if (hit.actions.ignore) { patch.status = 'arquivada'; patch.unread = false; }
        if (hit.actions.queueId && ctx.queues.has(hit.actions.queueId)) queueId = hit.actions.queueId;
        if (hit.actions.assignTo) assignee = hit.actions.assignTo;
        events.push(ev(tenantId, t.id, 'regra', { ruleId: hit.rule.id, name: hit.rule.name }));
      }
      if (!queueId && !hit?.actions.ignore) queueId = [...ctx.queues.values()].find((q) => q.mailboxId === box.id)?.id ?? null;
      if (queueId) { patch.queueId = queueId; if (!assignee) assignee = await route(db, tenantId, ctx.queues.get(queueId)!, patch.contactId ?? t.contactId); }
      if (assignee && !hit?.actions.ignore) {
        patch.assigneeId = assignee; patch.assignedAt = new Date();
        events.push(ev(tenantId, t.id, 'atribuida', { to: assignee, how: hit?.actions.assignTo ? 'regra' : (ctx.queues.get(queueId ?? '')?.routing ?? 'fila') }));
      }
    }
  }
  await db.update(s.mailThreads).set({ ...patch, rowVersion: sql`${s.mailThreads.rowVersion} + 1` }).where(eq(s.mailThreads.id, t.id));
  if (events.length) await db.insert(s.mailThreadEvents).values(events);
  return true;
}

// ------------------------------------------------------------------ sincronização

type ListResp = { messages?: { id: string; threadId: string }[]; nextPageToken?: string };
type HistoryResp = { history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[]; historyId?: string; nextPageToken?: string };

export async function syncMailbox(db: DbOrTx, cfg: GmailCfg | null, boxId: string, actorId: string | null = null, kind = 'incremental') {
  const [box] = await db.select().from(s.mailboxes).where(eq(s.mailboxes.id, boxId)).limit(1);
  if (!box || box.status === 'desconectada' || box.status === 'pausada') return { ok: false, fetched: 0, stored: 0, error: 'Caixa não conectada.' };
  if (box.provider === 'gmail_senha') return syncPasswordBox(db, box, actorId, kind);
  if (!cfg) return { ok: false, fetched: 0, stored: 0, error: 'A integração com o Google não está configurada no servidor.' };
  const ctx = await loadCtx(db, box.tenantId);
  const [st] = await db.select().from(s.mailSettings).where(eq(s.mailSettings.tenantId, box.tenantId)).limit(1);
  let fetched = 0, stored = 0;
  try {
    let ids: string[] = [];
    let newHistory: string | null = null;
    let full = !box.historyId;
    if (!full) {
      try {
        let page: string | undefined;
        do {
          const h = await gmailApi<HistoryResp>(db, cfg, box, `/history?${new URLSearchParams({ startHistoryId: box.historyId!, historyTypes: 'messageAdded', maxResults: '500', ...(page ? { pageToken: page } : {}) })}`);
          for (const x of h.history ?? []) for (const a of x.messagesAdded ?? []) ids.push(a.message.id);
          newHistory = h.historyId ?? newHistory; page = h.nextPageToken;
        } while (page);
      } catch (e) {
        if (e instanceof GmailError && e.status === 404) { full = true; kind = 'completa (histórico expirado)'; } else throw e;
      }
    }
    if (full) {
      const prof = await gmailApi<{ historyId: string; emailAddress: string }>(db, cfg, box, '/profile');
      newHistory = prof.historyId;
      let page: string | undefined, guard = 0;
      do {
        const l = await gmailApi<ListResp>(db, cfg, box, `/messages?${new URLSearchParams({ q: `newer_than:${st?.syncDays ?? 30}d`, maxResults: '100', ...(page ? { pageToken: page } : {}) })}`);
        ids.push(...(l.messages ?? []).map((m) => m.id)); page = l.nextPageToken; guard++;
      } while (page && guard < 10);
      if (kind === 'incremental') kind = 'completa';
    }
    ids = [...new Set(ids)];
    const known = ids.length ? new Set((await db.select({ g: s.mailMessages.gmailId }).from(s.mailMessages).where(and(eq(s.mailMessages.mailboxId, box.id), inArray(s.mailMessages.gmailId, ids)))).map((r) => r.g)) : new Set<string>();
    // mais antigas primeiro, para a conversa nascer com a primeira mensagem
    const msgs: GMessage[] = [];
    for (const id of ids.filter((x) => !known.has(x))) { msgs.push(await gmailApi<GMessage>(db, cfg, box, `/messages/${encodeURIComponent(id)}?format=full`)); fetched++; }
    msgs.sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
    for (const m of msgs) if (await ingestMessage(db, box, ctx, m)) stored++;
    await db.update(s.mailboxes).set({ historyId: newHistory ?? box.historyId, lastSyncAt: new Date(), lastError: null, status: 'conectada' }).where(eq(s.mailboxes.id, box.id));
    await db.insert(s.mailSyncRuns).values({ tenantId: box.tenantId, mailboxId: box.id, kind, ok: true, fetched, stored, actorId });
    return { ok: true, fetched, stored, error: null };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await db.update(s.mailboxes).set({ lastError: msg, lastSyncAt: new Date(), ...(e instanceof GmailError && e.reauth ? { status: 'erro' } : {}) }).where(eq(s.mailboxes.id, box.id));
    await db.insert(s.mailSyncRuns).values({ tenantId: box.tenantId, mailboxId: box.id, kind, ok: false, fetched, stored, error: msg, actorId });
    return { ok: false, fetched, stored, error: msg };
  }
}

/** Sincroniza as caixas conectadas da empresa que não sincronizam há `maxAgeMs`. */
export async function syncTenantMail(db: DbOrTx, cfg: Config['gmail'], tenantId: string, maxAgeMs = 5 * 60_000, onlyIds?: string[]) {
  const boxes = await db.select({ id: s.mailboxes.id, last: s.mailboxes.lastSyncAt, provider: s.mailboxes.provider }).from(s.mailboxes).where(and(eq(s.mailboxes.tenantId, tenantId), eq(s.mailboxes.status, 'conectada'), ...(onlyIds ? [inArray(s.mailboxes.id, onlyIds.length ? onlyIds : ['00000000-0000-0000-0000-000000000000'])] : [])));
  let n = 0;
  for (const b of boxes) {
    if (b.provider !== 'gmail_senha' && !cfg) continue;
    if (!b.last || Date.now() - b.last.getTime() > maxAgeMs) { await syncMailbox(db, cfg, b.id); n++; }
  }
  return { boxes: n };
}

// ------------------------------------------------------------------ envio

const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`);
const clean = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

export function buildRaw(m: { from: string; fromName?: string | null; to: string[]; cc?: string[]; subject: string; text: string; inReplyTo?: string | null; references?: string | null }) {
  const lines = [
    `From: ${m.fromName ? `${encHeader(clean(m.fromName))} <${m.from}>` : m.from}`,
    `To: ${m.to.map(clean).join(', ')}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.map(clean).join(', ')}`] : []),
    `Subject: ${encHeader(clean(m.subject))}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${clean(m.inReplyTo)}`, `References: ${clean(m.references ?? m.inReplyTo)}`] : []),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(m.text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n'),
  ];
  return b64u(lines.join('\r\n'));
}

export async function sendFromBox(db: DbOrTx, cfg: GmailCfg | null, box: Box, input: { threadGmailId?: string; to: string[]; cc?: string[]; subject: string; text: string; inReplyTo?: string | null; references?: string | null; fromName?: string | null }, userId: string) {
  if (box.provider === 'gmail_senha') return sendWithPassword(db, box, input, userId);
  if (!cfg) throw new GmailError('A integração com o Google não está configurada no servidor.', 503);
  const raw = buildRaw({ from: box.address, fromName: input.fromName ?? box.displayName, to: input.to, cc: input.cc, subject: input.subject, text: input.text, inReplyTo: input.inReplyTo, references: input.references });
  const sent = await gmailApi<{ id: string; threadId: string; labelIds?: string[] }>(db, cfg, box, '/messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(input.threadGmailId ? { threadId: input.threadGmailId } : {}) }) });
  // guarda já a mensagem enviada (a próxima sincronização encontra o mesmo id e ignora)
  const ctx = await loadCtx(db, box.tenantId);
  const headers = [{ name: 'From', value: box.address }, { name: 'To', value: input.to.join(', ') }, ...(input.cc?.length ? [{ name: 'Cc', value: input.cc.join(', ') }] : []), { name: 'Subject', value: input.subject }];
  await ingestMessage(db, box, ctx, { id: sent.id, threadId: sent.threadId, labelIds: sent.labelIds ?? ['SENT'], snippet: input.text.slice(0, 200), internalDate: String(Date.now()), payload: { mimeType: 'text/plain', headers, body: { data: b64u(input.text) } } }, userId);
  return sent;
}

export { domainAllowed };

// ------------------------------------------------------------------ Gmail com senha de app (IMAP/SMTP)

function boxPassword(box: Box) {
  const pass = box.appPasswordEnc ? decryptSecret(box.appPasswordEnc) : null;
  if (!pass) throw new GmailPasswordError('A senha de app desta caixa não pôde ser lida. Conecte de novo com a senha de app.', true);
  return pass;
}

async function syncPasswordBox(db: DbOrTx, box: Box, actorId: string | null, kind: string) {
  const ctx = await loadCtx(db, box.tenantId);
  const [st] = await db.select().from(s.mailSettings).where(eq(s.mailSettings.tenantId, box.tenantId)).limit(1);
  let fetched = 0, stored = 0;
  try {
    const [uv, last] = (box.historyId ?? '').split(':');
    const since = new Date(Date.now() - (st?.syncDays ?? 30) * 86_400_000);
    const r = await gmailPassword().fetch(box.address, boxPassword(box), { since, afterUid: last ? Number(last) : undefined, uidValidity: uv || undefined, max: last ? 100 : 50 }); // cabe no tempo da função; o resto vem nas próximas leituras
    if (!last || uv !== r.uidValidity) kind = 'completa';
    fetched = r.messages.length;
    const msgs = await Promise.all(r.messages.map(imapToGMessage));
    msgs.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
    for (const m of msgs) if (await ingestMessage(db, box, ctx, m)) stored++;
    await db.update(s.mailboxes).set({ historyId: `${r.uidValidity}:${r.lastUid}`, lastSyncAt: new Date(), lastError: null, status: 'conectada' }).where(eq(s.mailboxes.id, box.id));
    await db.insert(s.mailSyncRuns).values({ tenantId: box.tenantId, mailboxId: box.id, kind, ok: true, fetched, stored, actorId });
    return { ok: true, fetched, stored, error: null };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await db.update(s.mailboxes).set({ lastError: msg, lastSyncAt: new Date(), ...(e instanceof GmailPasswordError && e.auth ? { status: 'erro' } : {}) }).where(eq(s.mailboxes.id, box.id));
    await db.insert(s.mailSyncRuns).values({ tenantId: box.tenantId, mailboxId: box.id, kind, ok: false, fetched, stored, error: msg, actorId });
    return { ok: false, fetched, stored, error: msg };
  }
}

async function sendWithPassword(db: DbOrTx, box: Box, input: { threadGmailId?: string; to: string[]; cc?: string[]; subject: string; text: string; inReplyTo?: string | null; references?: string | null; fromName?: string | null }, userId: string) {
  let sent: { messageId: string };
  try {
    sent = await gmailPassword().send(box.address, boxPassword(box), { from: box.address, fromName: input.fromName ?? box.displayName, to: input.to, cc: input.cc, subject: input.subject, text: input.text, inReplyTo: input.inReplyTo, references: input.references });
  } catch (e) {
    throw new GmailError((e as Error).message, e instanceof GmailPasswordError && e.auth ? 401 : 502);
  }
  // guarda já a enviada; quando a IMAP trouxer a mesma mensagem (mesmo Message-ID), ela é ignorada
  const ctx = await loadCtx(db, box.tenantId);
  const id = `smtp:${sent.messageId}`;
  const headers = [{ name: 'From', value: box.address }, { name: 'To', value: input.to.join(', ') }, ...(input.cc?.length ? [{ name: 'Cc', value: input.cc.join(', ') }] : []), { name: 'Subject', value: input.subject }, { name: 'Message-ID', value: sent.messageId }];
  await ingestMessage(db, box, ctx, { id, threadId: input.threadGmailId ?? id, labelIds: ['SENT'], snippet: input.text.slice(0, 200), internalDate: String(Date.now()), payload: { mimeType: 'text/plain', headers, body: { data: b64u(input.text) } } }, userId);
  return { id, threadId: input.threadGmailId ?? id };
}
