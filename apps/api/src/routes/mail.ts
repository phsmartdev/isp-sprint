/**
 * E-mail corporativo (Gmail): configuração, caixas e conexão com o Google, filas, regras, conversas (lista, leitura,
 * atribuição, situação, vínculo com o CRM, resposta) e números das filas.
 *
 * Visibilidade: caixa pessoal só para a dona. Caixa compartilhada: quem tem acesso total ao E-mail, quem está numa fila
 * da caixa ou da conversa, e quem vê a pessoa atribuída (Equipe = times que lidera).
 */
import { simpleParser, type AddressObject } from 'mailparser';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  MAIL_PRIORITIES, MAIL_SCOPES, OPEN_THREAD, ROUTING_MODES, RULE_FIELDS, RULE_OPS, THREAD_STATUSES, atLeast, domainAllowed, evaluateRules, isEmail,
  buildEml, emlFilename, conditionsMatch, folderErrors, mailSettingsErrors, queueErrors, replySubject, type FolderDef, ruleErrors, slaState, threadTransitionError, type MailRuleDef, type ThreadStatus,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level, visibleUserIds } from '../services/scope';
import { audit } from '../services/audit';
import { encryptSecret } from '../services/email';
import { OpportunityCreate } from '@isp/shared';
import { createOpportunity, loadOpportunity } from '../services/opportunities';
import { runAutomations } from '../services/automations';
import { gmailPassword, GmailPasswordError, normalizeAppPassword } from '../services/gmailPassword';
import { exchangeCode, fetchOriginalRaw, GmailError, revokeToken, sendFromBox, syncMailbox, syncTenantMail } from '../services/gmail';

const STATE_COOKIE = 'isp_mail_oauth';
const COOKIE_PATH = '/api/v1/mail/oauth';
const callbackUrl = (publicUrl: string) => `${publicUrl.replace(/\/$/, '')}/api/v1/mail/oauth/callback`;
const sign = (secret: string, body: string) => createHmac('sha256', `${secret}:mail-oauth`).update(body).digest('base64url');
function readState(secret: string, raw: string | undefined) {
  if (!raw) return null;
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const a = Buffer.from(mac), b = Buffer.from(sign(secret, body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString()) as { state: string; boxId: string; userId: string; exp: number };
    return v.exp > Date.now() ? v : null;
  } catch { return null; }
}

const isTotal = (auth: AuthContext) => atLeast(level(auth, 'email'), 'total');
const canConfigure = (auth: AuthContext) => atLeast(level(auth, 'configuracoes'), 'total');
const gmailOn = (cfg: { gmail: unknown }) => { if (!cfg.gmail) throw new AppError(503, 'Gmail não configurado', 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (o mesmo cliente do login com Google, com os escopos do Gmail).'); };

async function myQueues(db: DbOrTx, auth: AuthContext) {
  return db.select({ id: s.mailQueues.id, mailboxId: s.mailQueues.mailboxId }).from(s.mailQueues).where(and(eq(s.mailQueues.tenantId, auth.tenantId), sql`${auth.userId}::uuid = any(${s.mailQueues.members})`));
}

/** Condição SQL das conversas que a pessoa vê. */
async function threadScope(db: DbOrTx, auth: AuthContext): Promise<SQL> {
  const own = sql`(${s.mailboxes.kind} = 'pessoal' and ${s.mailboxes.ownerId} = ${auth.userId})`;
  if (isTotal(auth)) return sql`(${own} or ${s.mailboxes.kind} = 'compartilhada')`;
  const qs = await myQueues(db, auth);
  const qIds = qs.map((q) => q.id), bIds = qs.map((q) => q.mailboxId).filter(Boolean) as string[];
  const users = visibleUserIds(auth, 'email');
  const parts: SQL[] = [own];
  const shared: SQL[] = [];
  if (qIds.length) shared.push(inArray(s.mailThreads.queueId, qIds));
  if (bIds.length) shared.push(inArray(s.mailThreads.mailboxId, bIds));
  if (users !== 'all' && users.length) shared.push(inArray(s.mailThreads.assigneeId, users));
  if (shared.length) parts.push(sql`(${s.mailboxes.kind} = 'compartilhada' and (${sql.join(shared, sql` or `)}))`);
  return sql`(${sql.join(parts, sql` or `)})`;
}

async function loadThread(db: DbOrTx, auth: AuthContext, id: string) {
  const scope = await threadScope(db, auth);
  const [r] = await db.select({ t: s.mailThreads, box: s.mailboxes }).from(s.mailThreads).innerJoin(s.mailboxes, eq(s.mailboxes.id, s.mailThreads.mailboxId))
    .where(and(eq(s.mailThreads.id, id), eq(s.mailThreads.tenantId, auth.tenantId), scope)).limit(1);
  if (!r) throw notFound('Conversa não encontrada.');
  return r;
}

/** Pode mexer na conversa: dona da caixa pessoal; na compartilhada, quem está atribuído, quem está na fila ou tem total. */
async function canWork(db: DbOrTx, auth: AuthContext, t: typeof s.mailThreads.$inferSelect, box: typeof s.mailboxes.$inferSelect) {
  if (box.kind === 'pessoal') return box.ownerId === auth.userId;
  if (isTotal(auth) || t.assigneeId === auth.userId) return true;
  const qs = await myQueues(db, auth);
  if (qs.some((q) => q.id === t.queueId || q.mailboxId === t.mailboxId)) return true;
  return atLeast(level(auth, 'email'), 'equipe') && !!t.assigneeId && auth.teamMemberIds.includes(t.assigneeId);
}

async function visibleBoxes(db: DbOrTx, auth: AuthContext) {
  const all = await db.select().from(s.mailboxes).where(eq(s.mailboxes.tenantId, auth.tenantId)).orderBy(asc(s.mailboxes.kind), asc(s.mailboxes.address));
  if (isTotal(auth) || canConfigure(auth)) return all.filter((b) => b.kind === 'compartilhada' || b.ownerId === auth.userId);
  const qs = await myQueues(db, auth);
  return all.filter((b) => (b.kind === 'pessoal' ? b.ownerId === auth.userId : qs.some((q) => q.mailboxId === b.id)));
}
/** Assinatura da pessoa no fim do texto (separador padrão "-- "). */
async function withSignature(db: DbOrTx, auth: AuthContext, text: string, include: boolean | undefined) {
  if (include === false) return text;
  const [sig] = await db.select({ text: s.mailSignatures.text }).from(s.mailSignatures).where(eq(s.mailSignatures.userId, auth.userId)).limit(1);
  return sig?.text.trim() ? `${text.trimEnd()}\n\n-- \n${sig.text.trim()}` : text;
}
/** Envia pela caixa: a pessoal só a dona; a compartilhada quem tem total no E-mail, configura, ou está numa fila dela. */
async function canSendFrom(db: DbOrTx, auth: AuthContext, b: typeof s.mailboxes.$inferSelect) {
  if (b.kind === 'pessoal') return b.ownerId === auth.userId;
  if (isTotal(auth) || canConfigure(auth)) return true;
  return (await myQueues(db, auth)).some((q) => q.mailboxId === b.id);
}

const FolderBody = z.object({ match: z.enum(['todas', 'qualquer']), conditions: z.array(z.object({ field: z.enum(RULE_FIELDS), op: z.enum(RULE_OPS), value: z.string().trim().max(200) })).max(10) });
/** Pasta da caixa pessoal: a dona; da compartilhada: quem tem acesso total em Configurações. */
const canManageBox = (auth: AuthContext, b: typeof s.mailboxes.$inferSelect) => (b.kind === 'pessoal' ? b.ownerId === auth.userId : canConfigure(auth));

/** Aplica a regra da pasta às conversas da caixa que estão na Entrada (sem pasta), olhando a primeira mensagem. */
async function applyFolder(db: DbOrTx, auth: AuthContext, folderId: string, mailboxId: string, def: FolderDef) {
  const rows = (await db.execute(sql`
    select t.id, m.from_addr, m.to_addrs, m.subject, coalesce(m.body_text, m.snippet, '') as text
      from mail_threads t
      join lateral (select * from mail_messages mm where mm.thread_id = t.id order by (mm.direction = 'entrada') desc, mm.sent_at asc limit 1) m on true
     where t.tenant_id = ${auth.tenantId} and t.mailbox_id = ${mailboxId} and t.folder_id is null`)).rows as { id: string; from_addr: string; to_addrs: string[]; subject: string; text: string }[];
  const hit = rows.filter((r) => conditionsMatch(def, { from: r.from_addr, to: r.to_addrs ?? [], subject: r.subject, text: r.text, mailboxId }));
  if (!hit.length) return 0;
  await db.update(s.mailThreads).set({ folderId }).where(inArray(s.mailThreads.id, hit.map((h) => h.id)));
  await db.insert(s.mailThreadEvents).values(hit.map((h) => ({ tenantId: auth.tenantId, threadId: h.id, type: 'pasta', payload: { folderId, automatic: true, existente: true }, actorId: auth.userId })));
  return hit.length;
}

const publicBox = (b: typeof s.mailboxes.$inferSelect) => ({
  id: b.id, kind: b.kind, provider: b.provider, address: b.address, displayName: b.displayName, ownerId: b.ownerId, status: b.status, lastSyncAt: b.lastSyncAt, lastError: b.lastError, connectedAt: b.connectedAt, rowVersion: b.rowVersion,
  scopes: b.grantedScopes ? b.grantedScopes.split(' ').filter((x) => x.includes('gmail')) : [],
});

async function settingsOf(db: DbOrTx, tenantId: string) {
  const [st] = await db.select().from(s.mailSettings).where(eq(s.mailSettings.tenantId, tenantId)).limit(1);
  return { allowedDomains: st?.allowedDomains ?? [], syncDays: st?.syncDays ?? 30 };
}

const RuleDef = z.object({
  match: z.enum(['todas', 'qualquer']),
  conditions: z.array(z.object({ field: z.enum(RULE_FIELDS), op: z.enum(RULE_OPS), value: z.string().trim().max(200) })).max(10),
  actions: z.object({ queueId: z.string().uuid().nullable().optional(), assignTo: z.string().uuid().nullable().optional(), priority: z.enum(MAIL_PRIORITIES).nullable().optional(), tag: z.string().trim().max(40).nullable().optional(), ignore: z.boolean().optional() }),
});

async function checkRuleRefs(db: DbOrTx, tenantId: string, def: MailRuleDef) {
  if (def.actions.queueId) { const [q] = await db.select({ id: s.mailQueues.id }).from(s.mailQueues).where(and(eq(s.mailQueues.id, def.actions.queueId), eq(s.mailQueues.tenantId, tenantId))).limit(1); if (!q) throw unprocessable('Fila não encontrada.'); }
  if (def.actions.assignTo) { const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, def.actions.assignTo), eq(s.users.tenantId, tenantId))).limit(1); if (!u) throw unprocessable('Pessoa não encontrada.'); }
}

const lastMsgOfThread = async (db: DbOrTx, threadId: string, dir?: 'entrada' | 'saida') => {
  const [m] = await db.select().from(s.mailMessages).where(and(eq(s.mailMessages.threadId, threadId), ...(dir ? [eq(s.mailMessages.direction, dir)] : []))).orderBy(desc(s.mailMessages.sentAt)).limit(1);
  return m ?? null;
};


type ReplyApp = { db: DbOrTx; config: Parameters<typeof gmailOn>[0] & { gmail: Parameters<typeof sendFromBox>[1] | null | undefined } };
/** Resposta pela caixa da conversa (sai pelo Gmail, na mesma conversa). Usada no E-mail e na negociação que nasceu do e-mail. */
async function replyOnThread(app: ReplyApp, auth: AuthContext, req: Parameters<typeof audit>[1], t: typeof s.mailThreads.$inferSelect, box: typeof s.mailboxes.$inferSelect, body: { text: string; to?: string[]; cc?: string[]; resolve?: boolean; signature?: boolean }) {
      if (box.provider !== 'gmail_senha') gmailOn(app.config);
      if (!(await canWork(app.db, auth, t, box))) throw forbidden(`Só quem atende a caixa ${box.address} responde esta conversa.`);
      if (box.status !== 'conectada') throw unprocessable('A caixa desta conversa não está conectada.');
      const lastIn = await lastMsgOfThread(app.db, t.id, 'entrada');
      const last = await lastMsgOfThread(app.db, t.id);
      const to = (body.to?.length ? body.to : lastIn ? [lastIn.fromAddr] : t.participants.filter((p) => p !== box.address)).map((x) => x.toLowerCase());
      const cc = (body.cc ?? []).map((x) => x.toLowerCase());
      if (!to.length || [...to, ...cc].some((x) => !isEmail(x))) throw unprocessable('Confira os destinatários.');
      try {
        await sendFromBox(app.db, app.config.gmail ?? null, box, { threadGmailId: t.gmailThreadId, to, cc, subject: replySubject(t.subject), text: await withSignature(app.db, auth, body.text, body.signature), inReplyTo: last?.rfcMessageId ?? null, references: last?.rfcMessageId ?? null, fromName: box.kind === 'pessoal' ? auth.name : box.displayName }, auth.userId);
      } catch (e) {
        if (e instanceof GmailError) throw new AppError(502, 'O Gmail não enviou', e.message);
        throw e;
      }
      const [fresh] = await app.db.select().from(s.mailThreads).where(eq(s.mailThreads.id, t.id)).limit(1);
      if (body.resolve && fresh && fresh.status !== 'resolvida') {
        await app.db.update(s.mailThreads).set({ status: 'resolvida', resolvedAt: new Date(), resolvedBy: auth.userId, rowVersion: fresh.rowVersion + 1 }).where(eq(s.mailThreads.id, t.id));
        await app.db.insert(s.mailThreadEvents).values({ tenantId: auth.tenantId, threadId: t.id, type: 'situacao', payload: { from: fresh.status, to: 'resolvida', note: 'Respondida e resolvida' }, actorId: auth.userId });
      }
      if (!fresh?.assigneeId && box.kind === 'compartilhada') {
        await app.db.update(s.mailThreads).set({ assigneeId: auth.userId, assignedAt: new Date() }).where(eq(s.mailThreads.id, t.id));
        await app.db.insert(s.mailThreadEvents).values({ tenantId: auth.tenantId, threadId: t.id, type: 'atribuida', payload: { from: null, to: auth.userId, how: 'respondeu' }, actorId: auth.userId });
      }
      await audit(app.db, req, { action: 'mail.reply', entityType: 'mail_thread', entityId: t.id });
}

export const mailRoutes = [
  // ---------------------------------------------------------------- configuração
  defineRoute({
    method: 'GET', url: '/mail/settings', summary: 'Configuração do e-mail corporativo (domínios, janela de sincronização) e situação da integração com o Google', tag: 'E-mail', module: 'email',
    handler: async ({ app, auth }) => ({
      ...(await settingsOf(app.db, auth.tenantId)), canEdit: canConfigure(auth),
      google: { configured: !!app.config.gmail, simulated: !!app.config.gmail?.simulated, redirectUri: callbackUrl(app.config.publicUrl), scopes: MAIL_SCOPES },
    }),
  }),
  defineRoute({
    method: 'PUT', url: '/mail/settings', summary: 'Salva domínios permitidos e janela da primeira sincronização', tag: 'E-mail', module: 'configuracoes', min: 'total',
    body: z.object({ allowedDomains: z.array(z.string().trim().max(120)).max(20), syncDays: z.number().int() }),
    handler: async ({ app, auth, req, body }) => {
      const domains = [...new Set(body.allowedDomains.map((d) => d.toLowerCase().replace(/^@/, '')).filter(Boolean))];
      const errs = mailSettingsErrors({ allowedDomains: domains, syncDays: body.syncDays });
      if (errs.length) throw unprocessable(errs[0]!);
      await app.db.insert(s.mailSettings).values({ tenantId: auth.tenantId, allowedDomains: domains, syncDays: body.syncDays, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: s.mailSettings.tenantId, set: { allowedDomains: domains, syncDays: body.syncDays, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'mail.settings', metadata: { domains, syncDays: body.syncDays } });
      return { ok: true };
    },
  }),

  // ---------------------------------------------------------------- caixas
  defineRoute({
    method: 'GET', url: '/mail/mailboxes', summary: 'Caixas que a pessoa vê (a própria pessoal e as compartilhadas das suas filas)', tag: 'E-mail', module: 'email',
    handler: async ({ app, auth }) => {
      const boxes = await visibleBoxes(app.db, auth);
      const runs = boxes.length ? (await app.db.execute(sql`select distinct on (mailbox_id) mailbox_id, kind, ok, fetched, stored, error, created_at from mail_sync_runs where mailbox_id = any(${`{${boxes.map((b) => b.id).join(',')}}`}::uuid[]) order by mailbox_id, created_at desc`)).rows as { mailbox_id: string }[] : [];
      return { items: boxes.map((b) => ({ ...publicBox(b), lastRun: runs.find((r) => r.mailbox_id === b.id) ?? null })), canConfigure: canConfigure(auth), me: { email: auth.email } };
    },
  }),
  defineRoute({
    method: 'POST', url: '/mail/mailboxes', summary: 'Cadastra uma caixa: compartilhada (só Configurações total) ou a própria pessoal', tag: 'E-mail', module: 'email',
    body: z.object({ kind: z.enum(['pessoal', 'compartilhada']), address: z.string().trim().max(200).optional(), displayName: z.string().trim().max(120).nullable().optional() }),
    handler: async ({ app, auth, req, body, reply }) => {
      const st = await settingsOf(app.db, auth.tenantId);
      // pessoal: a corporativa do login (padrão) ou um Gmail particular da própria pessoa (fora do domínio da empresa)
      const address = (body.kind === 'pessoal' ? body.address?.trim() || auth.email : body.address ?? '').toLowerCase();
      const particular = body.kind === 'pessoal' && address !== auth.email.toLowerCase();
      if (body.kind === 'compartilhada' && !canConfigure(auth)) throw forbidden('Só quem tem acesso total em Configurações cadastra caixas compartilhadas.');
      if (!isEmail(address)) throw unprocessable('Informe o endereço da caixa.');
      if (particular) {
        const mine = await app.db.select({ id: s.mailboxes.id }).from(s.mailboxes).where(and(eq(s.mailboxes.tenantId, auth.tenantId), eq(s.mailboxes.kind, 'pessoal'), eq(s.mailboxes.ownerId, auth.userId)));
        if (mine.length >= 3) throw unprocessable('Cada pessoa conecta no máximo 3 caixas pessoais.');
      }
      if (!particular && !domainAllowed(address, st.allowedDomains)) throw unprocessable(st.allowedDomains.length ? `Só caixas dos domínios da empresa (${st.allowedDomains.join(', ')}).` : 'Configure antes os domínios da empresa em Configurações → E-mail.');
      const [dup] = await app.db.select({ id: s.mailboxes.id }).from(s.mailboxes).where(and(eq(s.mailboxes.tenantId, auth.tenantId), eq(s.mailboxes.address, address))).limit(1);
      if (dup) throw unprocessable('Esta caixa já está cadastrada.');
      const [b] = await app.db.insert(s.mailboxes).values({ tenantId: auth.tenantId, kind: body.kind, address, displayName: body.displayName ?? (body.kind === 'pessoal' ? auth.name : null), ownerId: body.kind === 'pessoal' ? auth.userId : null, createdBy: auth.userId }).returning();
      await audit(app.db, req, { action: 'mail.mailbox_created', entityType: 'mailbox', entityId: b!.id, metadata: { kind: body.kind, particular } });
      reply.code(201);
      return publicBox(b!);
    },
  }),
  defineRoute({
    method: 'POST', url: '/mail/mailboxes/:id/connect', summary: 'Inicia a conexão com o Google (devolve o endereço de autorização; o estado fica num cookie assinado)', tag: 'E-mail', module: 'email', params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      gmailOn(app.config);
      const [b] = await app.db.select().from(s.mailboxes).where(and(eq(s.mailboxes.id, params.id), eq(s.mailboxes.tenantId, auth.tenantId))).limit(1);
      if (!b || (b.kind === 'pessoal' && b.ownerId !== auth.userId)) throw notFound('Caixa não encontrada.');
      if (b.kind === 'compartilhada' && !canConfigure(auth)) throw forbidden('Só quem tem acesso total em Configurações conecta caixas compartilhadas.');
      const state = randomBytes(24).toString('base64url');
      const body = Buffer.from(JSON.stringify({ state, boxId: b.id, userId: auth.userId, exp: Date.now() + 10 * 60_000 })).toString('base64url');
      reply.setCookie(STATE_COOKIE, `${body}.${sign(app.config.cookieSecret, body)}`, { httpOnly: true, sameSite: 'lax', secure: app.config.cookieSecure, path: COOKIE_PATH, maxAge: 600 });
      const p = new URLSearchParams({ client_id: app.config.gmail!.clientId, redirect_uri: callbackUrl(app.config.publicUrl), response_type: 'code', scope: MAIL_SCOPES.join(' '), state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', login_hint: b.address, hd: b.address.split('@')[1]! });
      return { url: `${app.config.gmail!.endpoints.auth}?${p}` };
    },
  }),
  defineRoute({
    method: 'GET', url: '/mail/oauth/callback', summary: 'Retorno do Google: confere o estado, troca o código, confere que a conta é a da caixa e guarda o acesso cifrado', tag: 'E-mail', module: 'email',
    query: z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, req, reply, query }) => {
      const back = (r: string) => { reply.clearCookie(STATE_COOKIE, { path: COOKIE_PATH }); return reply.redirect(`/email/caixas?conexao=${r}`); };
      if (!app.config.gmail) return back('google_desligado');
      if (query.error) return back('cancelada');
      const st = readState(app.config.cookieSecret, req.cookies[STATE_COOKIE]);
      if (!st || !query.state || st.state !== query.state || st.userId !== auth.userId || !query.code) return back('estado');
      const [b] = await app.db.select().from(s.mailboxes).where(and(eq(s.mailboxes.id, st.boxId), eq(s.mailboxes.tenantId, auth.tenantId))).limit(1);
      if (!b) return back('estado');
      let tok: Awaited<ReturnType<typeof exchangeCode>>;
      try { tok = await exchangeCode(app.config.gmail, query.code, callbackUrl(app.config.publicUrl)); } catch (e) { req.log.warn({ err: (e as Error).message }, 'gmail oauth'); return back('falhou'); }
      if (tok.email !== b.address || !tok.verified) { await audit(app.db, req, { action: 'mail.connect_refused', entityType: 'mailbox', entityId: b.id, metadata: { reason: 'other_account' } }); return back('outra_conta'); }
      if (!MAIL_SCOPES.filter((x) => x.includes('gmail')).every((x) => tok.scope.split(' ').includes(x))) return back('escopos');
      if (!tok.refreshToken && !b.refreshTokenEnc) return back('sem_acesso_offline');
      await app.db.update(s.mailboxes).set({
        status: 'conectada', accessTokenEnc: encryptSecret(tok.accessToken), accessExpiresAt: new Date(Date.now() + tok.expiresIn * 1000),
        ...(tok.refreshToken ? { refreshTokenEnc: encryptSecret(tok.refreshToken) } : {}), grantedScopes: tok.scope, connectedBy: auth.userId, connectedAt: new Date(), lastError: null,
        rowVersion: sql`${s.mailboxes.rowVersion} + 1`,
      }).where(eq(s.mailboxes.id, b.id));
      await audit(app.db, req, { action: 'mail.connected', entityType: 'mailbox', entityId: b.id });
      await syncMailbox(app.db, app.config.gmail, b.id, auth.userId, 'completa');
      return back('ok');
    },
  }),
  defineRoute({
    method: 'POST', url: '/mail/mailboxes/:id/sync', summary: 'Sincroniza agora (incremental pelo histórico do Gmail)', tag: 'E-mail', module: 'email', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const b = (await visibleBoxes(app.db, auth)).find((x) => x.id === params.id);
      if (!b) throw notFound('Caixa não encontrada.');
      if (b.provider !== 'gmail_senha') gmailOn(app.config);
      if (b.status !== 'conectada' && b.status !== 'erro') throw unprocessable('Conecte a caixa antes de sincronizar.');
      return syncMailbox(app.db, app.config.gmail, b.id, auth.userId, 'manual');
    },
  }),
  defineRoute({
    method: 'POST', url: '/mail/mailboxes/:id/app-password', summary: 'Conecta a caixa pessoal com a senha de app do Gmail (IMAP/SMTP, sem Google Cloud); a senha fica cifrada', tag: 'E-mail', module: 'email', params: IdParams,
    body: z.object({ password: z.string().trim().min(8).max(64) }),
    rateLimit: () => ({ max: 10, timeWindow: '10 minutes' }),
    handler: async ({ app, auth, req, params, body }) => {
      const [b] = await app.db.select().from(s.mailboxes).where(and(eq(s.mailboxes.id, params.id), eq(s.mailboxes.tenantId, auth.tenantId))).limit(1);
      if (!b || b.kind !== 'pessoal' || b.ownerId !== auth.userId) throw notFound('Caixa não encontrada.');
      const pass = normalizeAppPassword(body.password);
      if (!/^[a-z]{16}$/i.test(pass)) throw unprocessable('A senha de app do Gmail tem 16 letras (o Google mostra em 4 grupos de 4). Copie de myaccount.google.com/apppasswords.', [{ path: 'password', message: '16 letras' }]);
      try { await gmailPassword().verify(b.address, pass); } catch (e) {
        throw unprocessable(e instanceof GmailPasswordError ? e.message : 'O Gmail não aceitou a conexão.', [{ path: 'password', message: 'Recusada pelo Gmail' }]);
      }
      // trocar de forma de conexão recomeça a leitura (os ids de mensagem são os do Gmail nos dois casos)
      await app.db.update(s.mailboxes).set({ provider: 'gmail_senha', appPasswordEnc: encryptSecret(pass), refreshTokenEnc: null, accessTokenEnc: null, accessExpiresAt: null, grantedScopes: null, historyId: null, status: 'conectada', lastError: null, connectedBy: auth.userId, connectedAt: new Date(), rowVersion: sql`${s.mailboxes.rowVersion} + 1` }).where(eq(s.mailboxes.id, b.id));
      await audit(app.db, req, { action: 'mail.connected', entityType: 'mailbox', entityId: b.id, metadata: { provider: 'gmail_senha' } });
      const r = await syncMailbox(app.db, app.config.gmail, b.id, auth.userId, 'completa');
      return { ok: true, sync: r };
    },
  }),
  defineRoute({
    method: 'POST', url: '/mail/mailboxes/:id/state', summary: 'Pausa, retoma ou desconecta a caixa (desconectar revoga o acesso no Google e apaga os tokens; as conversas ficam)', tag: 'E-mail', module: 'email', params: IdParams,
    body: z.object({ action: z.enum(['pausar', 'retomar', 'desconectar']) }),
    handler: async ({ app, auth, req, params, body }) => {
      const [b] = await app.db.select().from(s.mailboxes).where(and(eq(s.mailboxes.id, params.id), eq(s.mailboxes.tenantId, auth.tenantId))).limit(1);
      if (!b || (b.kind === 'pessoal' && b.ownerId !== auth.userId)) throw notFound('Caixa não encontrada.');
      if (b.kind === 'compartilhada' && !canConfigure(auth)) throw forbidden('Só quem tem acesso total em Configurações altera caixas compartilhadas.');
      if (body.action === 'desconectar') {
        if (app.config.gmail && b.provider !== 'gmail_senha') await revokeToken(app.config.gmail, b);
        await app.db.update(s.mailboxes).set({ status: 'desconectada', refreshTokenEnc: null, accessTokenEnc: null, accessExpiresAt: null, appPasswordEnc: null, historyId: null, rowVersion: sql`${s.mailboxes.rowVersion} + 1` }).where(eq(s.mailboxes.id, b.id));
      } else {
        if (!b.refreshTokenEnc && !b.appPasswordEnc) throw unprocessable('Conecte a caixa primeiro.');
        await app.db.update(s.mailboxes).set({ status: body.action === 'pausar' ? 'pausada' : 'conectada', rowVersion: sql`${s.mailboxes.rowVersion} + 1` }).where(eq(s.mailboxes.id, b.id));
      }
      await audit(app.db, req, { action: `mail.${body.action}`, entityType: 'mailbox', entityId: b.id });
      return { ok: true };
    },
  }),

  // ---------------------------------------------------------------- e-mail novo e assinatura
  defineRoute({
    method: 'GET', url: '/mail/signature', summary: 'Minha assinatura de e-mail', tag: 'E-mail', module: 'email',
    handler: async ({ app, auth }) => {
      const [sig] = await app.db.select({ text: s.mailSignatures.text, updatedAt: s.mailSignatures.updatedAt }).from(s.mailSignatures).where(eq(s.mailSignatures.userId, auth.userId)).limit(1);
      return { text: sig?.text ?? '', updatedAt: sig?.updatedAt ?? null };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/mail/signature', summary: 'Salva a minha assinatura (vai no fim dos e-mails novos e das respostas)', tag: 'E-mail', module: 'email',
    body: z.object({ text: z.string().max(2000) }),
    handler: async ({ app, auth, body }) => {
      const text = body.text.replace(/\r\n/g, '\n').replace(/^\s*--\s*\n/, '').trimEnd();
      await app.db.insert(s.mailSignatures).values({ userId: auth.userId, tenantId: auth.tenantId, text, updatedAt: new Date() }).onConflictDoUpdate({ target: s.mailSignatures.userId, set: { text, updatedAt: new Date() } });
      return { text };
    },
  }),
  defineRoute({
    method: 'POST', url: '/mail/compose', summary: 'Envia um e-mail novo por uma caixa (abre uma conversa nova)', tag: 'E-mail', module: 'email',
    body: z.object({ mailboxId: z.string().uuid(), to: z.array(z.string().trim().max(200)).min(1).max(20), cc: z.array(z.string().trim().max(200)).max(20).default([]), subject: z.string().trim().min(1).max(250), text: z.string().trim().min(1).max(20_000), signature: z.boolean().optional() }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, req, body, reply }) => {
      const b = (await visibleBoxes(app.db, auth)).find((x) => x.id === body.mailboxId);
      if (!b) throw notFound('Caixa não encontrada.');
      if (!(await canSendFrom(app.db, auth, b))) throw forbidden(`Você não envia pela caixa ${b.address}.`);
      if (b.status !== 'conectada') throw unprocessable('A caixa não está conectada.');
      if (b.provider !== 'gmail_senha') gmailOn(app.config);
      const to = body.to.map((x) => x.toLowerCase()), cc = body.cc.map((x) => x.toLowerCase());
      if ([...to, ...cc].some((x) => !isEmail(x))) throw unprocessable('Confira os destinatários.');
      let sent: { id: string; threadId: string };
      try {
        sent = await sendFromBox(app.db, app.config.gmail ?? null, b, { to, cc, subject: body.subject, text: await withSignature(app.db, auth, body.text, body.signature), fromName: b.kind === 'pessoal' ? auth.name : b.displayName }, auth.userId);
      } catch (e) {
        if (e instanceof GmailError) throw new AppError(502, 'O Gmail não enviou', e.message);
        throw e;
      }
      const [t] = await app.db.select({ id: s.mailThreads.id }).from(s.mailThreads).where(and(eq(s.mailThreads.mailboxId, b.id), eq(s.mailThreads.gmailThreadId, sent.threadId))).limit(1);
      if (t && b.kind === 'compartilhada') await app.db.update(s.mailThreads).set({ assigneeId: auth.userId, assignedAt: new Date() }).where(and(eq(s.mailThreads.id, t.id), sql`${s.mailThreads.assigneeId} is null`));
      await audit(app.db, req, { action: 'mail.compose', entityType: 'mail_thread', entityId: t?.id ?? undefined });
      reply.code(201);
      return { threadId: t?.id ?? null };
    },
  }),

  // ---------------------------------------------------------------- pastas com regra de armazenamento
  defineRoute({
    method: 'GET', url: '/mail/folders', summary: 'Pastas das caixas que a pessoa vê, com a regra e quantas conversas abertas há em cada uma', tag: 'E-mail', module: 'email',
    handler: async ({ app, auth }) => {
      const boxes = await visibleBoxes(app.db, auth);
      if (!boxes.length) return { items: [] };
      const rows = await app.db.select().from(s.mailFolders).where(and(eq(s.mailFolders.tenantId, auth.tenantId), eq(s.mailFolders.active, true), inArray(s.mailFolders.mailboxId, boxes.map((b) => b.id)))).orderBy(asc(s.mailFolders.position), asc(s.mailFolders.name));
      const counts = rows.length ? (await app.db.execute(sql`select folder_id, count(*) filter (where status in ('nova','em_atendimento','aguardando_cliente'))::int open, count(*) filter (where unread)::int unread from mail_threads where tenant_id = ${auth.tenantId} and folder_id = any(${`{${rows.map((r) => r.id).join(',')}}`}::uuid[]) group by folder_id`)).rows as { folder_id: string; open: number; unread: number }[] : [];
      return { items: rows.map((r) => { const b = boxes.find((x) => x.id === r.mailboxId)!; const c = counts.find((x) => x.folder_id === r.id); return { id: r.id, mailboxId: r.mailboxId, name: r.name, position: r.position, def: r.def, open: c?.open ?? 0, unread: c?.unread ?? 0, canEdit: canManageBox(auth, b) }; }) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/mail/folders', summary: 'Cria pasta na caixa com regra de armazenamento; pode aplicar às conversas que já estão na Entrada', tag: 'E-mail', module: 'email',
    body: z.object({ mailboxId: z.string().uuid(), name: z.string().trim().max(60), def: FolderBody, applyExisting: z.boolean().default(false) }),
    handler: async ({ app, auth, req, body, reply }) => {
      const b = (await visibleBoxes(app.db, auth)).find((x) => x.id === body.mailboxId);
      if (!b) throw notFound('Caixa não encontrada.');
      if (!canManageBox(auth, b)) throw forbidden('Pastas da caixa compartilhada são criadas por quem tem acesso total em Configurações.');
      const errs = folderErrors({ name: body.name, def: body.def });
      if (errs.length) throw unprocessable(errs[0]!);
      const [dup] = await app.db.select({ id: s.mailFolders.id }).from(s.mailFolders).where(and(eq(s.mailFolders.mailboxId, b.id), eq(s.mailFolders.active, true), sql`lower(${s.mailFolders.name}) = lower(${body.name})`)).limit(1);
      if (dup) throw unprocessable('Já existe uma pasta com este nome nesta caixa.');
      const [m] = await app.db.select({ v: sql<number>`coalesce(max(${s.mailFolders.position}), -1)` }).from(s.mailFolders).where(eq(s.mailFolders.mailboxId, b.id));
      const [f] = await app.db.insert(s.mailFolders).values({ tenantId: auth.tenantId, mailboxId: b.id, name: body.name, position: (m?.v ?? -1) + 1, def: body.def, createdBy: auth.userId }).returning();
      const moved = body.applyExisting ? await applyFolder(app.db, auth, f!.id, b.id, body.def) : 0;
      await audit(app.db, req, { action: 'mail.folder_created', entityType: 'mail_folder', entityId: f!.id, metadata: { moved } });
      reply.code(201);
      return { id: f!.id, moved };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/mail/folders/:id', summary: 'Renomeia, muda a regra ou a ordem, reaplica a regra ou exclui a pasta (as conversas voltam para a Entrada)', tag: 'E-mail', module: 'email', params: IdParams,
    body: z.object({ name: z.string().trim().max(60).optional(), def: FolderBody.optional(), position: z.number().int().min(0).max(999).optional(), active: z.literal(false).optional(), applyExisting: z.boolean().optional() }),
    handler: async ({ app, auth, req, params, body }) => {
      const [f] = await app.db.select().from(s.mailFolders).where(and(eq(s.mailFolders.id, params.id), eq(s.mailFolders.tenantId, auth.tenantId), eq(s.mailFolders.active, true))).limit(1);
      const b = f ? (await visibleBoxes(app.db, auth)).find((x) => x.id === f.mailboxId) : undefined;
      if (!f || !b) throw notFound('Pasta não encontrada.');
      if (!canManageBox(auth, b)) throw forbidden('Só quem administra esta caixa altera as pastas.');
      if (body.active === false) {
        await app.db.update(s.mailFolders).set({ active: false }).where(eq(s.mailFolders.id, f.id));
        await app.db.update(s.mailThreads).set({ folderId: null }).where(eq(s.mailThreads.folderId, f.id));
        await audit(app.db, req, { action: 'mail.folder_removed', entityType: 'mail_folder', entityId: f.id });
        return { ok: true, moved: 0 };
      }
      const next = { name: body.name ?? f.name, def: body.def ?? (f.def as FolderDef) };
      const errs = folderErrors(next);
      if (errs.length) throw unprocessable(errs[0]!);
      await app.db.update(s.mailFolders).set({ name: next.name, def: next.def, ...(body.position !== undefined ? { position: body.position } : {}) }).where(eq(s.mailFolders.id, f.id));
      const moved = body.applyExisting ? await applyFolder(app.db, auth, f.id, f.mailboxId, next.def) : 0;
      return { ok: true, moved };
    },
  }),

  // ---------------------------------------------------------------- filas e regras
  defineRoute({
    method: 'GET', url: '/mail/queues', summary: 'Filas de atendimento por e-mail', tag: 'E-mail', module: 'email',
    handler: async ({ app, auth }) => {
      const items = await app.db.select().from(s.mailQueues).where(eq(s.mailQueues.tenantId, auth.tenantId)).orderBy(asc(s.mailQueues.name));
      return { items: isTotal(auth) || canConfigure(auth) ? items : items.filter((q) => q.members.includes(auth.userId)), canEdit: canConfigure(auth) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/mail/queues', summary: 'Cria fila (nome, caixa, direcionamento, prazo de 1ª resposta, membros)', tag: 'E-mail', module: 'configuracoes', min: 'total',
    body: z.object({ name: z.string().trim().max(120), mailboxId: z.string().uuid().nullable(), routing: z.enum(ROUTING_MODES), slaHours: z.number().int(), members: z.array(z.string().uuid()).max(50) }),
    handler: async ({ app, auth, req, body, reply }) => {
      const errs = queueErrors({ name: body.name, mode: body.routing, members: body.members, slaHours: body.slaHours });
      if (errs.length) throw unprocessable(errs[0]!);
      if (body.mailboxId) { const [b] = await app.db.select({ k: s.mailboxes.kind }).from(s.mailboxes).where(and(eq(s.mailboxes.id, body.mailboxId), eq(s.mailboxes.tenantId, auth.tenantId))).limit(1); if (!b || b.k !== 'compartilhada') throw unprocessable('A fila só pode usar uma caixa compartilhada.'); }
      const us = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, body.members)));
      if (us.length !== new Set(body.members).size) throw unprocessable('Pessoa não encontrada.');
      const [q] = await app.db.insert(s.mailQueues).values({ tenantId: auth.tenantId, name: body.name, mailboxId: body.mailboxId, routing: body.routing, slaHours: body.slaHours, members: [...new Set(body.members)], createdBy: auth.userId }).returning();
      await audit(app.db, req, { action: 'mail.queue_created', entityType: 'mail_queue', entityId: q!.id });
      reply.code(201);
      return q;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/mail/queues/:id', summary: 'Altera a fila', tag: 'E-mail', module: 'configuracoes', min: 'total', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), name: z.string().trim().max(120).optional(), routing: z.enum(ROUTING_MODES).optional(), slaHours: z.number().int().optional(), members: z.array(z.string().uuid()).max(50).optional(), active: z.boolean().optional() }),
    handler: async ({ app, auth, req, params, body }) => {
      const [q] = await app.db.select().from(s.mailQueues).where(and(eq(s.mailQueues.id, params.id), eq(s.mailQueues.tenantId, auth.tenantId))).limit(1);
      if (!q) throw notFound();
      if (q.rowVersion !== body.rowVersion) throw conflict(q.rowVersion);
      const next = { name: body.name ?? q.name, mode: body.routing ?? (q.routing as (typeof ROUTING_MODES)[number]), members: body.members ?? q.members, slaHours: body.slaHours ?? q.slaHours };
      const errs = queueErrors(next);
      if (errs.length) throw unprocessable(errs[0]!);
      if (body.members) { const us = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, body.members))); if (us.length !== new Set(body.members).size) throw unprocessable('Pessoa não encontrada.'); }
      await app.db.update(s.mailQueues).set({ name: next.name, routing: next.mode, members: [...new Set(next.members)], slaHours: next.slaHours, active: body.active ?? q.active, rowVersion: q.rowVersion + 1 }).where(eq(s.mailQueues.id, q.id));
      await audit(app.db, req, { action: 'mail.queue_updated', entityType: 'mail_queue', entityId: q.id });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/mail/rules', summary: 'Regras de entrada (na ordem em que são avaliadas)', tag: 'E-mail', module: 'configuracoes', min: 'total',
    handler: async ({ app, auth }) => ({ items: await app.db.select().from(s.mailRules).where(eq(s.mailRules.tenantId, auth.tenantId)).orderBy(asc(s.mailRules.position), asc(s.mailRules.createdAt)) }),
  }),
  defineRoute({
    method: 'POST', url: '/mail/rules', summary: 'Cria regra (vai para o fim da lista)', tag: 'E-mail', module: 'configuracoes', min: 'total',
    body: z.object({ name: z.string().trim().max(120), mailboxId: z.string().uuid().nullable(), def: RuleDef }),
    handler: async ({ app, auth, req, body, reply }) => {
      const def = body.def as MailRuleDef;
      const errs = ruleErrors({ name: body.name, def });
      if (errs.length) throw unprocessable(errs[0]!);
      await checkRuleRefs(app.db, auth.tenantId, def);
      const [{ n }] = (await app.db.execute(sql`select coalesce(max(position), -1) + 1 as n from mail_rules where tenant_id = ${auth.tenantId}`)).rows as [{ n: number }];
      const [r] = await app.db.insert(s.mailRules).values({ tenantId: auth.tenantId, mailboxId: body.mailboxId, name: body.name, position: Number(n), def, createdBy: auth.userId }).returning();
      await audit(app.db, req, { action: 'mail.rule_created', entityType: 'mail_rule', entityId: r!.id });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/mail/rules/:id', summary: 'Altera, ativa/desativa ou reordena a regra', tag: 'E-mail', module: 'configuracoes', min: 'total', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), name: z.string().trim().max(120).optional(), def: RuleDef.optional(), active: z.boolean().optional(), move: z.enum(['subir', 'descer']).optional() }),
    handler: async ({ app, auth, req, params, body }) => app.db.transaction(async (tx) => {
      const [r] = await tx.select().from(s.mailRules).where(and(eq(s.mailRules.id, params.id), eq(s.mailRules.tenantId, auth.tenantId))).limit(1);
      if (!r) throw notFound();
      if (r.rowVersion !== body.rowVersion) throw conflict(r.rowVersion);
      const def = (body.def ?? r.def) as MailRuleDef;
      const errs = ruleErrors({ name: body.name ?? r.name, def });
      if (errs.length) throw unprocessable(errs[0]!);
      await checkRuleRefs(tx, auth.tenantId, def);
      if (body.move) {
        const all = await tx.select({ id: s.mailRules.id }).from(s.mailRules).where(eq(s.mailRules.tenantId, auth.tenantId)).orderBy(asc(s.mailRules.position), asc(s.mailRules.createdAt));
        const ids = all.map((x) => x.id); const i = ids.indexOf(r.id); const j = body.move === 'subir' ? i - 1 : i + 1;
        if (j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j]!, ids[i]!]; for (const [k, id] of ids.entries()) await tx.update(s.mailRules).set({ position: k }).where(eq(s.mailRules.id, id)); }
      }
      await tx.update(s.mailRules).set({ name: body.name ?? r.name, def, active: body.active ?? r.active, rowVersion: r.rowVersion + 1 }).where(eq(s.mailRules.id, r.id));
      await audit(tx, req, { action: 'mail.rule_updated', entityType: 'mail_rule', entityId: r.id });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/mail/rules/test', summary: 'Testa as regras ativas com uma mensagem de exemplo (sem gravar nada)', tag: 'E-mail', module: 'configuracoes', min: 'total',
    body: z.object({ mailboxId: z.string().uuid(), from: z.string().max(200), to: z.string().max(500).default(''), subject: z.string().max(500).default(''), text: z.string().max(5000).default('') }),
    handler: async ({ app, auth, body }) => {
      const rules = await app.db.select().from(s.mailRules).where(eq(s.mailRules.tenantId, auth.tenantId));
      const hit = evaluateRules(rules.map((r) => ({ id: r.id, name: r.name, position: r.position, active: r.active, mailboxId: r.mailboxId, def: r.def as MailRuleDef })), { from: body.from.toLowerCase(), to: body.to.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean), subject: body.subject, text: body.text, mailboxId: body.mailboxId });
      return { rule: hit ? { id: hit.rule.id, name: hit.rule.name } : null, actions: hit?.actions ?? null };
    },
  }),

  // ---------------------------------------------------------------- conversas
  defineRoute({
    method: 'GET', url: '/mail/threads', summary: 'Conversas visíveis com filtros (caixa, fila, situação, minhas, sem responsável, prazo, conta, busca)', tag: 'E-mail', module: 'email',
    query: z.object({ mailboxId: z.string().uuid().optional(), queueId: z.string().uuid().optional(), status: z.enum(['abertas', 'todas', ...THREAD_STATUSES]).default('abertas'), view: z.enum(['todas', 'minhas', 'sem_responsavel', 'prazo']).default('todas'), contactId: z.string().uuid().optional(), folderId: z.union([z.literal('entrada'), z.string().uuid()]).optional(), q: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).default(1) }),
    handler: async ({ app, auth, query: f }) => {
      {
        // caixas pela Gmail API e pela senha de app (IMAP) se atualizam ao abrir a lista
        const boxes = (await visibleBoxes(app.db, auth)).map((b) => b.id);
        await syncTenantMail(app.db, app.config.gmail ?? null, auth.tenantId, 2 * 60_000, boxes).catch(() => undefined);
      }
      const conds: SQL[] = [eq(s.mailThreads.tenantId, auth.tenantId), await threadScope(app.db, auth)];
      if (f.mailboxId) conds.push(eq(s.mailThreads.mailboxId, f.mailboxId));
      if (f.queueId) conds.push(eq(s.mailThreads.queueId, f.queueId));
      if (f.contactId) conds.push(eq(s.mailThreads.contactId, f.contactId));
      if (f.folderId === 'entrada') conds.push(sql`${s.mailThreads.folderId} is null`); else if (f.folderId) conds.push(eq(s.mailThreads.folderId, f.folderId));
      if (f.status === 'abertas') conds.push(inArray(s.mailThreads.status, OPEN_THREAD)); else if (f.status !== 'todas') conds.push(eq(s.mailThreads.status, f.status));
      if (f.view === 'minhas') conds.push(eq(s.mailThreads.assigneeId, auth.userId));
      if (f.view === 'sem_responsavel') conds.push(sql`${s.mailThreads.assigneeId} is null`);
      if (f.view === 'prazo') conds.push(sql`${s.mailThreads.firstReplyAt} is null and ${s.mailThreads.firstInboundAt} is not null and ${s.mailThreads.queueId} is not null`);
      if (f.q) { const like = `%${f.q.replace(/[%_]/g, '')}%`; conds.push(sql`(${s.mailThreads.subject} ilike ${like} or array_to_string(${s.mailThreads.participants}, ' ') ilike ${like} or exists (select 1 from mail_messages mm where mm.thread_id = ${s.mailThreads.id} and mm.body_text ilike ${like}))`); }
      const rows = await app.db.select({ t: s.mailThreads, sender: sql<string | null>`(select coalesce(m.from_name, m.from_addr) from mail_messages m where m.thread_id = ${s.mailThreads.id} and m.direction = 'entrada' order by m.sent_at desc limit 1)`, box: { address: s.mailboxes.address, kind: s.mailboxes.kind }, queue: { name: s.mailQueues.name, slaHours: s.mailQueues.slaHours }, contact: { name: s.contacts.name }, assignee: { name: s.users.name } })
        .from(s.mailThreads).innerJoin(s.mailboxes, eq(s.mailboxes.id, s.mailThreads.mailboxId)).leftJoin(s.mailQueues, eq(s.mailQueues.id, s.mailThreads.queueId))
        .leftJoin(s.contacts, eq(s.contacts.id, s.mailThreads.contactId)).leftJoin(s.users, eq(s.users.id, s.mailThreads.assigneeId))
        .where(and(...conds)).orderBy(desc(s.mailThreads.lastMessageAt)).limit(51).offset((f.page - 1) * 50);
      const now = new Date().toISOString();
      const items = rows.slice(0, 50).map((r) => ({
        id: r.t.id, sender: r.sender, subject: r.t.subject, snippet: r.t.snippet, participants: r.t.participants, lastMessageAt: r.t.lastMessageAt, status: r.t.status, priority: r.t.priority, tags: r.t.tags, unread: r.t.unread,
        mailbox: r.box, queue: r.t.queueId ? { id: r.t.queueId, name: r.queue?.name } : null, assignee: r.t.assigneeId ? { id: r.t.assigneeId, name: r.assignee?.name } : null,
        contact: r.t.contactId ? { id: r.t.contactId, name: r.contact?.name } : null, linkAmbiguous: r.t.linkAmbiguous, folderId: r.t.folderId,
        sla: slaState({ firstInboundAt: r.t.firstInboundAt?.toISOString() ?? null, firstReplyAt: r.t.firstReplyAt?.toISOString() ?? null, slaHours: r.t.queueId ? r.queue?.slaHours ?? null : null }, now),
      }));
      return { items, hasMore: rows.length > 50 };
    },
  }),
  defineRoute({
    method: 'GET', url: '/mail/threads/:id', summary: 'Conversa com mensagens, histórico e sugestões de conta', tag: 'E-mail', module: 'email', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { t, box } = await loadThread(app.db, auth, params.id);
      const messages = await app.db.select({ m: s.mailMessages, by: s.users.name }).from(s.mailMessages).leftJoin(s.users, eq(s.users.id, s.mailMessages.sentBy)).where(eq(s.mailMessages.threadId, t.id)).orderBy(asc(s.mailMessages.sentAt));
      const events = await app.db.select({ e: s.mailThreadEvents, actor: s.users.name }).from(s.mailThreadEvents).leftJoin(s.users, eq(s.users.id, s.mailThreadEvents.actorId)).where(eq(s.mailThreadEvents.threadId, t.id)).orderBy(desc(s.mailThreadEvents.createdAt));
      const [q] = t.queueId ? await app.db.select().from(s.mailQueues).where(eq(s.mailQueues.id, t.queueId)).limit(1) : [];
      const [c] = t.contactId ? await app.db.select({ id: s.contacts.id, name: s.contacts.name, ownerId: s.contacts.ownerId }).from(s.contacts).where(eq(s.contacts.id, t.contactId)).limit(1) : [];
      const st = await settingsOf(app.db, auth.tenantId);
      const ext = t.participants.filter((p) => !st.allowedDomains.includes(p.split('@')[1] ?? ''));
      const suggestions = !t.contactId && ext.length ? (await app.db.execute(sql`
        select distinct c.id, c.name, lower(c.email) as via from contacts c where c.tenant_id = ${auth.tenantId} and c.deleted_at is null and lower(c.email) = any(${`{${ext.join(',')}}`}::text[])
        union select distinct c.id, c.name, lower(p.email) from people p join account_stakeholders st on st.person_id = p.id and st.active join contacts c on c.id = st.contact_id and c.deleted_at is null
         where p.tenant_id = ${auth.tenantId} and lower(p.email) = any(${`{${ext.join(',')}}`}::text[]) limit 10`)).rows : [];
      const opps = t.contactId ? await app.db.select({ id: s.opportunities.id, label: s.opportunities.title, stage: s.opportunities.stage }).from(s.opportunities).where(and(eq(s.opportunities.contactId, t.contactId), sql`${s.opportunities.deletedAt} is null`)).orderBy(desc(s.opportunities.createdAt)).limit(20) : [];
      if (t.unread && (await canWork(app.db, auth, t, box))) await app.db.update(s.mailThreads).set({ unread: false }).where(eq(s.mailThreads.id, t.id));
      return {
        id: t.id, subject: t.subject, status: t.status, priority: t.priority, tags: t.tags, rowVersion: t.rowVersion, participants: t.participants,
        mailbox: { id: box.id, address: box.address, kind: box.kind, status: box.status }, queue: q ? { id: q.id, name: q.name, slaHours: q.slaHours, members: q.members } : null,
        assigneeId: t.assigneeId, contact: c ?? null, opportunityId: t.opportunityId, folderId: t.folderId,
        folders: (await app.db.select({ id: s.mailFolders.id, name: s.mailFolders.name }).from(s.mailFolders).where(and(eq(s.mailFolders.mailboxId, box.id), eq(s.mailFolders.active, true))).orderBy(asc(s.mailFolders.position), asc(s.mailFolders.name))), contractId: t.contractId, linkSource: t.linkSource, linkAmbiguous: t.linkAmbiguous,
        sla: slaState({ firstInboundAt: t.firstInboundAt?.toISOString() ?? null, firstReplyAt: t.firstReplyAt?.toISOString() ?? null, slaHours: q?.slaHours ?? null }, new Date().toISOString()),
        messages: messages.map(({ m, by }) => ({ id: m.id, direction: m.direction, from: m.fromAddr, fromName: m.fromName, to: m.toAddrs, cc: m.ccAddrs, subject: m.subject, sentAt: m.sentAt, text: m.bodyText ?? m.snippet ?? '', hasAttachments: m.hasAttachments, sentBy: by })),
        events: events.map(({ e, actor }) => ({ id: e.id, type: e.type, payload: e.payload, actor, at: e.createdAt })),
        suggestions, opportunities: opps, canWork: await canWork(app.db, auth, t, box),
      };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/mail/threads/:id', summary: 'Situação, responsável, prioridade, fila, etiquetas e vínculo com conta/oportunidade', tag: 'E-mail', module: 'email', params: IdParams,
    body: z.object({
      rowVersion: z.number().int(), status: z.enum(THREAD_STATUSES).optional(), assigneeId: z.string().uuid().nullable().optional(), priority: z.enum(MAIL_PRIORITIES).optional(),
      queueId: z.string().uuid().nullable().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
      contactId: z.string().uuid().nullable().optional(), opportunityId: z.string().uuid().nullable().optional(), folderId: z.string().uuid().nullable().optional(), note: z.string().trim().max(500).optional(),
    }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { t, box } = await loadThread(tx, auth, params.id);
      if (!(await canWork(tx, auth, t, box))) throw forbidden('Você não atende esta conversa.');
      if (t.rowVersion !== body.rowVersion) throw conflict(t.rowVersion);
      const patch: Partial<typeof s.mailThreads.$inferInsert> = {};
      const evs: (typeof s.mailThreadEvents.$inferInsert)[] = [];
      const e = (type: string, payload: Record<string, unknown>) => evs.push({ tenantId: auth.tenantId, threadId: t.id, type, payload, actorId: auth.userId });
      if (body.status && body.status !== t.status) {
        const err = threadTransitionError(t.status as ThreadStatus, body.status);
        if (err) throw unprocessable(err);
        patch.status = body.status;
        if (body.status === 'resolvida') { patch.resolvedAt = new Date(); patch.resolvedBy = auth.userId; }
        e('situacao', { from: t.status, to: body.status, note: body.note ?? null });
      }
      if (body.queueId !== undefined && body.queueId !== t.queueId) {
        if (box.kind !== 'compartilhada') throw unprocessable('Conversas de caixa pessoal não entram em fila.');
        if (body.queueId) { const [q] = await tx.select({ id: s.mailQueues.id }).from(s.mailQueues).where(and(eq(s.mailQueues.id, body.queueId), eq(s.mailQueues.tenantId, auth.tenantId))).limit(1); if (!q) throw unprocessable('Fila não encontrada.'); }
        patch.queueId = body.queueId; e('fila', { from: t.queueId, to: body.queueId });
      }
      if (body.assigneeId !== undefined && body.assigneeId !== t.assigneeId) {
        if (box.kind !== 'compartilhada') throw unprocessable('Conversas de caixa pessoal ficam com a dona da caixa.');
        if (body.assigneeId) {
          const qid = patch.queueId ?? t.queueId;
          const [q] = qid ? await tx.select({ members: s.mailQueues.members }).from(s.mailQueues).where(eq(s.mailQueues.id, qid)).limit(1) : [];
          if (body.assigneeId !== auth.userId && !isTotal(auth) && !(q?.members ?? []).includes(auth.userId)) throw forbidden('Só quem está na fila (ou tem acesso total) direciona para outra pessoa.');
          if (q && !q.members.includes(body.assigneeId) && !isTotal(auth)) throw unprocessable('A pessoa não está nesta fila.');
          const [u] = await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, body.assigneeId), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).limit(1);
          if (!u) throw unprocessable('Pessoa não encontrada ou inativa.');
        }
        patch.assigneeId = body.assigneeId; patch.assignedAt = body.assigneeId ? new Date() : null;
        if (body.assigneeId && t.status === 'nova' && !body.status) patch.status = 'em_atendimento';
        e('atribuida', { from: t.assigneeId, to: body.assigneeId, how: body.assigneeId === auth.userId ? 'assumiu' : 'manual' });
      }
      if (body.folderId !== undefined && body.folderId !== t.folderId) {
        if (body.folderId) { const [fo] = await tx.select({ id: s.mailFolders.id }).from(s.mailFolders).where(and(eq(s.mailFolders.id, body.folderId), eq(s.mailFolders.mailboxId, t.mailboxId), eq(s.mailFolders.active, true))).limit(1); if (!fo) throw unprocessable('Pasta não encontrada nesta caixa.'); }
        patch.folderId = body.folderId; e('pasta', { from: t.folderId, folderId: body.folderId, automatic: false });
      }
      if (body.priority && body.priority !== t.priority) { patch.priority = body.priority; e('prioridade', { from: t.priority, to: body.priority }); }
      if (body.tags) patch.tags = [...new Set(body.tags)];
      if (body.contactId !== undefined && body.contactId !== t.contactId) {
        if (body.contactId) { const [c] = await tx.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.id, body.contactId), eq(s.contacts.tenantId, auth.tenantId), sql`${s.contacts.deletedAt} is null`)).limit(1); if (!c) throw unprocessable('Conta não encontrada.'); }
        patch.contactId = body.contactId; patch.linkSource = body.contactId ? 'manual' : null; patch.linkAmbiguous = false;
        if (!body.contactId) patch.opportunityId = null;
        e('vinculada', { contactId: body.contactId, automatic: false });
      }
      if (body.opportunityId !== undefined && body.opportunityId !== t.opportunityId) {
        const cid = patch.contactId !== undefined ? patch.contactId : t.contactId;
        if (body.opportunityId) {
          const [o] = await tx.select({ id: s.opportunities.id, c: s.opportunities.contactId }).from(s.opportunities).where(and(eq(s.opportunities.id, body.opportunityId), eq(s.opportunities.tenantId, auth.tenantId))).limit(1);
          if (!o || o.c !== cid) throw unprocessable('A oportunidade precisa ser da conta ligada à conversa.');
        }
        patch.opportunityId = body.opportunityId; e('oportunidade', { opportunityId: body.opportunityId });
      }
      if (!Object.keys(patch).length) return { ok: true, rowVersion: t.rowVersion };
      await tx.update(s.mailThreads).set({ ...patch, rowVersion: t.rowVersion + 1 }).where(eq(s.mailThreads.id, t.id));
      if (evs.length) await tx.insert(s.mailThreadEvents).values(evs);
      return { ok: true, rowVersion: t.rowVersion + 1 };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/mail/threads/:id/reply', summary: 'Responde pela caixa da conversa (sai pelo Gmail, na mesma conversa)', tag: 'E-mail', module: 'email', params: IdParams,
    body: z.object({ text: z.string().trim().min(1).max(20_000), to: z.array(z.string().trim().max(200)).max(20).optional(), cc: z.array(z.string().trim().max(200)).max(20).optional(), resolve: z.boolean().optional(), signature: z.boolean().optional() }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, req, params, body }) => {
      const { t, box } = await loadThread(app.db, auth, params.id);
      await replyOnThread(app, auth, req, t, box, body);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/mail/stats', summary: 'Números das filas: abertas, sem responsável, prazo vencido, tempo médio de 1ª resposta e resolvidas no período', tag: 'E-mail', module: 'email',
    query: z.object({ days: z.coerce.number().int().min(1).max(180).default(30) }),
    handler: async ({ app, auth, query }) => {
      const scope = await threadScope(app.db, auth);
      const r = await app.db.execute(sql`
        select q.id as queue_id, coalesce(q.name, 'Sem fila') as queue,
          count(*) filter (where t.status in ('nova','em_atendimento','aguardando_cliente'))::int as abertas,
          count(*) filter (where t.status in ('nova','em_atendimento','aguardando_cliente') and t.assignee_id is null)::int as sem_responsavel,
          count(*) filter (where t.first_reply_at is null and t.first_inbound_at is not null and q.id is not null and t.status in ('nova','em_atendimento','aguardando_cliente') and now() > t.first_inbound_at + make_interval(hours => q.sla_hours))::int as vencidas,
          round(avg(extract(epoch from (t.first_reply_at - t.first_inbound_at)) / 60) filter (where t.first_reply_at >= now() - make_interval(days => ${query.days})))::int as minutos_primeira_resposta,
          count(*) filter (where t.first_reply_at >= now() - make_interval(days => ${query.days}) and q.id is not null and t.first_reply_at <= t.first_inbound_at + make_interval(hours => q.sla_hours))::int as no_prazo,
          count(*) filter (where t.first_reply_at >= now() - make_interval(days => ${query.days}))::int as respondidas,
          count(*) filter (where t.resolved_at >= now() - make_interval(days => ${query.days}))::int as resolvidas
        from mail_threads t join mailboxes on mailboxes.id = t.mailbox_id left join mail_queues q on q.id = t.queue_id
        where t.tenant_id = ${auth.tenantId} and mailboxes.kind = 'compartilhada' and ${scope}
        group by q.id, q.name order by abertas desc`);
      return { days: query.days, items: r.rows };
    },
  }),
  defineRoute({
    method: 'GET', url: '/accounts/:id/emails', summary: 'Conversas de e-mail ligadas à conta (somente as que a pessoa vê)', tag: 'E-mail', module: 'email', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const rows = await app.db.select({ t: s.mailThreads, address: s.mailboxes.address }).from(s.mailThreads).innerJoin(s.mailboxes, eq(s.mailboxes.id, s.mailThreads.mailboxId))
        .where(and(eq(s.mailThreads.tenantId, auth.tenantId), eq(s.mailThreads.contactId, params.id), await threadScope(app.db, auth))).orderBy(desc(s.mailThreads.lastMessageAt)).limit(50);
      return { items: rows.map(({ t, address }) => ({ id: t.id, subject: t.subject, snippet: t.snippet, lastMessageAt: t.lastMessageAt, status: t.status, mailbox: address })) };
    },
  }),
  // ---------------------------------------------------------------- e-mail que vira negociação
  defineRoute({
    method: 'POST', url: '/mail/threads/:id/opportunity', summary: 'Transforma a conversa (de qualquer caixa) em negociação: o e-mail vira anexo e a resposta sai por esta conversa', tag: 'E-mail', module: 'email', params: IdParams,
    body: z.object({ opportunity: OpportunityCreate }),
    handler: async ({ app, auth, req, params, body, reply }) => {
      if (!atLeast(level(auth, 'oportunidades'), 'proprio')) throw forbidden('Seu perfil não cria oportunidades.');
      // cópia exata do e-mail original (como está no Gmail); busca antes da transação
      const pre = await loadThread(app.db, auth, params.id);
      const preMsgs = await app.db.select({ gmailId: s.mailMessages.gmailId, direction: s.mailMessages.direction }).from(s.mailMessages).where(eq(s.mailMessages.threadId, pre.t.id)).orderBy(asc(s.mailMessages.sentAt));
      const origin = preMsgs.find((m) => m.direction === 'entrada') ?? preMsgs[0];
      const originalRaw = origin ? await fetchOriginalRaw(app.db, app.config.gmail ?? null, pre.box, origin.gmailId) : null;
      const created = await app.db.transaction(async (tx) => {
        const { t, box } = await loadThread(tx, auth, params.id);
        if (!(await canWork(tx, auth, t, box))) throw forbidden('Você não atende esta conversa.');
        const [cur] = await tx.select({ opportunityId: s.mailThreads.opportunityId, rowVersion: s.mailThreads.rowVersion }).from(s.mailThreads).where(eq(s.mailThreads.id, t.id)).for('update');
        if (cur?.opportunityId) {
          const [o] = await tx.select({ code: s.opportunities.code, origin: s.opportunities.originMailThreadId }).from(s.opportunities).where(eq(s.opportunities.id, cur.opportunityId)).limit(1);
          if (o?.origin === t.id) throw unprocessable(`Esta conversa já virou a negociação OP-${o.code}.`);
        }
        const opp = await createOpportunity(tx, auth, req, body.opportunity);
        const [o] = await tx.select({ contactId: s.opportunities.contactId, rowVersion: s.opportunities.rowVersion }).from(s.opportunities).where(eq(s.opportunities.id, opp.id)).limit(1);
        await tx.update(s.opportunities).set({ originMailThreadId: t.id }).where(eq(s.opportunities.id, opp.id));
        // o e-mail que deu origem vira anexo (.eml); vale a primeira mensagem recebida (ou a primeira da conversa)
        const msgs = await tx.select().from(s.mailMessages).where(eq(s.mailMessages.threadId, t.id)).orderBy(asc(s.mailMessages.sentAt));
        const first = msgs.find((m) => m.direction === 'entrada') ?? msgs[0];
        if (first) {
          const data = first.gmailId === origin?.gmailId && originalRaw && originalRaw.length <= 20 * 1024 * 1024 ? originalRaw : Buffer.from(buildEml({ from: first.fromAddr, fromName: first.fromName, to: first.toAddrs, cc: first.ccAddrs, subject: first.subject || t.subject, date: first.sentAt, messageId: first.rfcMessageId, text: first.bodyText ?? first.snippet ?? '' }), 'utf8');
          await tx.insert(s.opportunityAttachments).values({ tenantId: auth.tenantId, opportunityId: opp.id, kind: 'email', filename: emlFilename(t.subject), mime: 'message/rfc822', sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), data, uploadedBy: auth.userId });
        }
        await tx.update(s.mailThreads).set({ contactId: o!.contactId, opportunityId: opp.id, linkSource: 'negociacao', linkAmbiguous: false, rowVersion: (cur?.rowVersion ?? t.rowVersion) + 1 }).where(eq(s.mailThreads.id, t.id));
        await tx.insert(s.mailThreadEvents).values({ tenantId: auth.tenantId, threadId: t.id, type: 'oportunidade', payload: { opportunityId: opp.id, criada: true }, actorId: auth.userId });
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'updated', actorId: auth.userId, rowVersion: o!.rowVersion, payload: { changed: { origem: { from: null, to: `e-mail "${t.subject || '(sem assunto)'}" da caixa ${box.address}` } } } });
        return opp;
      });
      await runAutomations(app.db, app.config, auth.tenantId, auth.userId, created.id, { type: 'criada' });
      await audit(app.db, req, { action: 'mail.to_opportunity', entityType: 'mail_thread', entityId: params.id, metadata: { opportunityId: created.id } });
      reply.code(201);
      return { id: created.id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/opportunities/:id/origin-email', summary: 'E-mail que deu origem à negociação (mensagens) e se quem vê pode responder por ele', tag: 'E-mail', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const [o] = await app.db.select({ tid: s.opportunities.originMailThreadId }).from(s.opportunities).where(eq(s.opportunities.id, opp.id)).limit(1);
      if (!o?.tid) return { thread: null };
      const [r] = await app.db.select({ t: s.mailThreads, box: s.mailboxes }).from(s.mailThreads).innerJoin(s.mailboxes, eq(s.mailboxes.id, s.mailThreads.mailboxId)).where(and(eq(s.mailThreads.id, o.tid), eq(s.mailThreads.tenantId, auth.tenantId))).limit(1);
      if (!r) return { thread: null };
      const messages = await app.db.select({ m: s.mailMessages, by: s.users.name }).from(s.mailMessages).leftJoin(s.users, eq(s.users.id, s.mailMessages.sentBy)).where(eq(s.mailMessages.threadId, r.t.id)).orderBy(asc(s.mailMessages.sentAt));
      const canReply = r.box.status === 'conectada' && (await canWork(app.db, auth, r.t, r.box));
      const [att] = await app.db.select({ id: s.opportunityAttachments.id }).from(s.opportunityAttachments).where(and(eq(s.opportunityAttachments.opportunityId, opp.id), eq(s.opportunityAttachments.kind, 'email'), sql`${s.opportunityAttachments.deletedAt} is null`)).orderBy(asc(s.opportunityAttachments.createdAt)).limit(1);
      return {
        thread: {
          id: r.t.id, subject: r.t.subject, mailbox: r.box.address, originalAttachmentId: att?.id ?? null, mailboxKind: r.box.kind, mailboxConnected: r.box.status === 'conectada', canReply,
          messages: messages.map(({ m, by }) => ({ id: m.id, direction: m.direction, from: m.fromAddr, fromName: m.fromName, to: m.toAddrs, cc: m.ccAddrs, sentAt: m.sentAt, text: m.bodyText ?? m.snippet ?? '', hasAttachments: m.hasAttachments, sentBy: by })),
        },
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/origin-email/reply', summary: 'Responde o e-mail que deu origem à negociação, pela mesma caixa e na mesma conversa', tag: 'E-mail', module: 'oportunidades', params: IdParams,
    body: z.object({ text: z.string().trim().min(1).max(20_000), cc: z.array(z.string().trim().max(200)).max(20).optional(), signature: z.boolean().optional() }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, req, params, body }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const [o] = await app.db.select({ tid: s.opportunities.originMailThreadId }).from(s.opportunities).where(eq(s.opportunities.id, opp.id)).limit(1);
      if (!o?.tid) throw unprocessable('Esta negociação não nasceu de um e-mail.');
      const [r] = await app.db.select({ t: s.mailThreads, box: s.mailboxes }).from(s.mailThreads).innerJoin(s.mailboxes, eq(s.mailboxes.id, s.mailThreads.mailboxId)).where(and(eq(s.mailThreads.id, o.tid), eq(s.mailThreads.tenantId, auth.tenantId))).limit(1);
      if (!r) throw notFound('Conversa de origem não encontrada.');
      await replyOnThread(app, auth, req, r.t, r.box, { text: body.text, cc: body.cc, signature: body.signature });
      const [cur] = await app.db.select({ rowVersion: s.opportunities.rowVersion }).from(s.opportunities).where(eq(s.opportunities.id, opp.id)).limit(1);
      await app.db.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'updated', actorId: auth.userId, rowVersion: cur!.rowVersion, payload: { changed: { 'e-mail de origem': { from: null, to: `resposta enviada pela caixa ${r.box.address}` } } } });
      return { ok: true };
    },
  }),
  // ---------------------------------------------------------------- e-mail anexado à negociação: leitura para quem vê a negociação
  defineRoute({
    method: 'GET', url: '/opportunities/:id/attachments/:aid/email', summary: 'Abre o e-mail anexado (cópia do original): cabeçalhos, texto, HTML e lista de anexos', tag: 'Oportunidades', module: 'oportunidades',
    params: z.object({ id: z.string().uuid(), aid: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const a = await emailAttachment(app.db, auth, params.id, params.aid);
      const p = await simpleParser(a.data);
      const list = (v: AddressObject | AddressObject[] | undefined) => (!v ? [] : (Array.isArray(v) ? v : [v]).flatMap((x) => x.value.map((y) => ({ name: y.name || null, address: y.address ?? '' }))));
      return {
        filename: a.filename, subject: p.subject ?? '', date: p.date ?? null, from: list(p.from)[0] ?? null, to: list(p.to), cc: list(p.cc),
        text: p.text ?? null, html: typeof p.html === 'string' ? p.html : null,
        attachments: p.attachments.filter((x) => x.contentDisposition !== 'inline' || !x.cid).map((x, i) => ({ index: i, filename: x.filename || `anexo-${i + 1}`, contentType: x.contentType, size: x.size })),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/opportunities/:id/attachments/:aid/email/parts/:n', summary: 'Baixa um anexo de dentro do e-mail anexado', tag: 'Oportunidades', module: 'oportunidades',
    params: z.object({ id: z.string().uuid(), aid: z.string().uuid(), n: z.coerce.number().int().min(0).max(500) }),
    handler: async ({ app, auth, params, reply }) => {
      const a = await emailAttachment(app.db, auth, params.id, params.aid);
      const p = await simpleParser(a.data);
      const part = p.attachments.filter((x) => x.contentDisposition !== 'inline' || !x.cid)[params.n];
      if (!part) throw notFound('Anexo não encontrado no e-mail.');
      const name = part.filename || `anexo-${params.n + 1}`;
      return reply.header('content-type', 'application/octet-stream').header('x-content-type-options', 'nosniff').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).send(part.content);
    },
  }),
];

async function emailAttachment(db: DbOrTx, auth: AuthContext, oppId: string, aid: string) {
  const opp = await loadOpportunity(db, auth, oppId);
  const [a] = await db.select({ data: s.opportunityAttachments.data, filename: s.opportunityAttachments.filename, kind: s.opportunityAttachments.kind }).from(s.opportunityAttachments)
    .where(and(eq(s.opportunityAttachments.id, aid), eq(s.opportunityAttachments.opportunityId, opp.id), eq(s.opportunityAttachments.tenantId, auth.tenantId), sql`${s.opportunityAttachments.deletedAt} is null`)).limit(1);
  if (!a || a.kind !== 'email') throw notFound('E-mail anexado não encontrado.');
  return a;
}
