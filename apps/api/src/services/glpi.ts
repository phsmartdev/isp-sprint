/**
 * GLPI 11 — API de alto nível (/api.php) com OAuth 2.0 (concessão por senha de um usuário de integração).
 *
 * Rotas conferidas no código-fonte do GLPI 11.0 (src/Glpi/Api/HL/Controller):
 *   POST /api.php/token                                      → access_token (escopo "api")
 *   GET  /api.php/Administration/Entity | /Group              → entidades e grupos (filtro RSQL em `filter`)
 *   GET  /api.php/Dropdowns/ITILCategory                      → categorias
 *   POST /api.php/Assistance/Ticket                           → { id, href } (201)
 *   GET  /api.php/Assistance/Ticket/{id}                      → chamado (status = { id, name })
 *   GET  /api.php/Assistance/Ticket/{id}/Timeline             → [{ type, item }] (Followup, Task, Solution, Document, Validation)
 *   POST /api.php/Assistance/Ticket/{id}/Timeline/Followup    → acompanhamento
 *   POST /api.php/Assistance/Ticket/{id}/TeamMember           → { type: 'Group', id, role: 'assigned' }
 * Entidade do chamado: cabeçalho GLPI-Entity (o campo `entity` do Ticket é somente leitura na API).
 * Versão pedida pelo cabeçalho GLPI-API-Version: 2 (o GLPI usa a 2.x mais nova que tiver).
 * Webhook nativo: cabeçalhos X-GLPI-signature = HMAC-SHA256(corpo + X-GLPI-timestamp, segredo) e X-GLPI-timestamp;
 * na validação do endereço o GLPI faz GET ?crc_token=… e espera HMAC-SHA256(crc_token, segredo) no corpo.
 *
 * Validação real pendente: exige uma instância GLPI 11 alcançável pela internet, um cliente OAuth e um usuário de integração.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { glpiStatusLabel, parseTimeline, textToHtml } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { decryptSecret } from './email';
import { integrationRow, logEvent } from './integrations';
import { unprocessable } from '../http/errors';

export type GlpiCfg = { tenantId: string; baseUrl: string; clientId: string; clientSecret: string; username: string; password: string; webhookSecret: string | null };
export class GlpiError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

const isProd = () => process.env.NODE_ENV === 'production';

/** Endereço do GLPI: em produção, só https e nunca rede interna/local (o servidor não pode ser usado para sondar a rede). */
export function assertGlpiUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw unprocessable('Endereço do GLPI inválido.', [{ path: 'baseUrl', message: 'Use o endereço completo, ex.: https://glpi.suaempresa.com.br' }]); }
  const host = u.hostname.toLowerCase();
  if (isProd()) {
    const privateHost = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')
      || (isIP(host) === 4 && /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
      || (isIP(host) === 6);
    if (u.protocol !== 'https:') throw unprocessable('O GLPI precisa estar em https.', [{ path: 'baseUrl', message: 'Endereço sem https' }]);
    if (privateHost) throw unprocessable('O GLPI precisa estar acessível pela internet.', [{ path: 'baseUrl', message: 'Endereço interno não é alcançável pelo servidor' }]);
  } else if (!/^https?:$/.test(u.protocol)) throw unprocessable('Endereço do GLPI inválido.');
  return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/api\.php.*$/, '')}`;
}

export async function glpiConfig(db: DbOrTx, tenantId: string, opts: { requireEnabled?: boolean } = {}): Promise<GlpiCfg> {
  const r = await integrationRow(db, tenantId, 'glpi');
  const sec = (k: string) => (r.secrets[k] ? decryptSecret(r.secrets[k]!) : null);
  const clientSecret = sec('clientSecret');
  const password = sec('password');
  if ((opts.requireEnabled ?? true) && !r.enabled) throw unprocessable('A integração com o GLPI está desligada. Ligue em Configurações → Integrações.');
  if (!r.config.baseUrl || !r.config.clientId || !clientSecret || !r.config.username || !password) throw unprocessable('Integração com o GLPI incompleta: informe endereço, cliente OAuth, usuário e senha em Configurações → Integrações.');
  return { tenantId, baseUrl: assertGlpiUrl(r.config.baseUrl), clientId: r.config.clientId, clientSecret, username: r.config.username, password, webhookSecret: sec('webhookSecret') };
}

// ------------------------------------------------------------------ chamadas

const tokens = new Map<string, { token: string; exp: number }>();
const cacheKey = (c: GlpiCfg) => createHash('sha256').update(`${c.tenantId}|${c.baseUrl}|${c.clientId}|${c.username}|${c.password}|${c.clientSecret}`).digest('hex');

async function hfetch(url: string, init: RequestInit) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try { return await fetch(url, { ...init, redirect: 'manual', signal: ctl.signal }); }
  catch (e) { throw new GlpiError((e as Error).name === 'AbortError' ? 'O GLPI não respondeu a tempo.' : 'Não foi possível falar com o GLPI (endereço fora do ar ou inacessível).'); }
  finally { clearTimeout(t); }
}

async function accessToken(c: GlpiCfg, fresh = false): Promise<string> {
  const k = cacheKey(c);
  const hit = tokens.get(k);
  if (!fresh && hit && hit.exp > Date.now() + 30_000) return hit.token;
  const r = await hfetch(`${c.baseUrl}/api.php/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'password', client_id: c.clientId, client_secret: c.clientSecret, username: c.username, password: c.password, scope: 'api' }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    throw new GlpiError(j.error === 'invalid_client' ? 'O GLPI recusou o cliente OAuth (ID ou segredo).' : j.error === 'invalid_grant' ? 'O GLPI recusou o usuário ou a senha de integração.' : `O GLPI recusou a autenticação (${j.error ?? r.status}).`, 502);
  }
  tokens.set(k, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

export async function glpiCall<T>(c: GlpiCfg, method: 'GET' | 'POST' | 'PATCH', path: string, opts: { body?: unknown; query?: Record<string, string | number | undefined>; entityId?: number } = {}): Promise<T> {
  const q = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()}` : '';
  const go = async (fresh: boolean) => hfetch(`${c.baseUrl}/api.php${path}${q}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken(c, fresh)}`, accept: 'application/json', 'GLPI-API-Version': '2', ...(opts.entityId !== undefined ? { 'GLPI-Entity': String(opts.entityId) } : {}), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let r = await go(false);
  if (r.status === 401) r = await go(true);
  const text = await r.text();
  let j: unknown = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* não-JSON */ }
  if (!r.ok) {
    const b = (j ?? {}) as { title?: string; detail?: unknown };
    const detail = typeof b.detail === 'string' ? b.detail : b.title ?? text.slice(0, 200);
    if (r.status === 403) throw new GlpiError(`O usuário de integração não tem permissão no GLPI para isso (${detail}).`, 502);
    if (r.status === 404) throw new GlpiError('Não encontrado no GLPI.', 404);
    throw new GlpiError(`O GLPI respondeu ${r.status}: ${detail}`, 502);
  }
  return j as T;
}

type Named = { id: number; name: string; completename?: string | null };
const like = (q?: string) => (q && q.trim() ? `name=ilike="*${q.trim().replace(/["\\]/g, '')}*"` : undefined);

export const glpiEntities = (c: GlpiCfg, q?: string) => glpiCall<Named[]>(c, 'GET', '/Administration/Entity', { query: { limit: 50, filter: like(q), sort: 'name' } });
export const glpiCategories = (c: GlpiCfg, q?: string) => glpiCall<Named[]>(c, 'GET', '/Dropdowns/ITILCategory', { query: { limit: 100, filter: like(q), sort: 'name' } });
export const glpiGroups = (c: GlpiCfg, q?: string) => glpiCall<Named[]>(c, 'GET', '/Administration/Group', { query: { limit: 100, filter: like(q), sort: 'name' } });

export async function glpiCreateTicket(c: GlpiCfg, t: { title: string; content: string; type: number; urgency: number; entityId: number; categoryId?: number | null; groupId?: number | null }) {
  const r = await glpiCall<{ id: number }>(c, 'POST', '/Assistance/Ticket', {
    // no GLPI 11 a entidade do chamado é somente leitura no corpo: vale a entidade ativa da sessão, escolhida pelo cabeçalho GLPI-Entity (Router::handleAuth)
    body: { name: t.title, content: textToHtml(t.content), type: t.type, urgency: t.urgency, impact: t.urgency, ...(t.categoryId ? { category: t.categoryId } : {}) },
    entityId: t.entityId,
  });
  if (!r?.id) throw new GlpiError('O GLPI não devolveu o número do chamado.');
  let groupWarning: string | null = null;
  if (t.groupId) {
    try { await glpiCall(c, 'POST', `/Assistance/Ticket/${r.id}/TeamMember`, { body: { type: 'Group', id: t.groupId, role: 'assigned' }, entityId: t.entityId }); }
    catch (e) { groupWarning = (e as Error).message; }
  }
  return { id: r.id, groupWarning };
}

export const glpiFollowup = (c: GlpiCfg, ticketId: number, text: string) =>
  glpiCall<{ id: number }>(c, 'POST', `/Assistance/Ticket/${ticketId}/Timeline/Followup`, { body: { content: textToHtml(text), is_private: false } });

// ------------------------------------------------------------------ assinatura do webhook

const hmac = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('hex');
export const crcAnswer = (crcToken: string, secret: string) => hmac(crcToken, secret);
/** Confere X-GLPI-signature (HMAC-SHA256 de corpo + timestamp) e recusa entregas com mais de 15 minutos. */
export function validWebhookSignature(rawBody: string, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()) {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 15 * 60) return false;
  const exp = Buffer.from(hmac(rawBody + timestamp, secret));
  const got = Buffer.from(signature.trim().toLowerCase());
  return exp.length === got.length && timingSafeEqual(exp, got);
}

// ------------------------------------------------------------------ sincronização

type TicketRow = typeof s.glpiTickets.$inferSelect;
type GlpiTicket = { id: number; status?: { id: number; name?: string } | number; date_mod?: string; date_solve?: string | null; date_close?: string | null };

/**
 * Datas do GLPI vêm como "AAAA-MM-DD HH:MM:SS" no fuso do próprio GLPI (sem indicação de fuso).
 * Lemos no fuso da empresa, que é o mesmo do GLPI dela; datas com fuso explícito (RFC 3339) são respeitadas.
 */
export function glpiDate(v: string | null | undefined, tz = 'America/Sao_Paulo'): Date | null {
  if (!v) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(v) && /T/.test(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]));
  const shown = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return new Date(asUtc - (shown - asUtc));
}

/**
 * Lê o chamado e a linha do tempo no GLPI e grava o que for novo (sem duplicar, append-only).
 * Solução ou fechamento geram uma tarefa para o dono da oportunidade dar o retorno ao cliente.
 */
export async function syncTicket(db: DbOrTx, c: GlpiCfg, row: TicketRow): Promise<{ added: number; status: number | null }> {
  try {
    const [tn] = await db.select({ tz: s.tenants.timezone }).from(s.tenants).where(eq(s.tenants.id, row.tenantId)).limit(1);
    const tz = tn?.tz ?? 'America/Sao_Paulo';
    const t = await glpiCall<GlpiTicket>(c, 'GET', `/Assistance/Ticket/${row.glpiId}`);
    const timeline = parseTimeline(await glpiCall<unknown>(c, 'GET', `/Assistance/Ticket/${row.glpiId}/Timeline`));
    const status = typeof t.status === 'object' ? t.status?.id ?? null : typeof t.status === 'number' ? t.status : null;
    const statusName = typeof t.status === 'object' && t.status?.name ? t.status.name : glpiStatusLabel(status);
    const entries = timeline.map((e) => ({
      tenantId: row.tenantId, ticketId: row.id, kind: e.kind, externalId: e.externalId, direction: 'entrada', author: e.author, text: e.text, isPrivate: e.isPrivate,
      occurredAt: glpiDate(e.occurredAt, tz) ?? new Date(),
    }));
    if (status && status !== row.status) {
      entries.push({ tenantId: row.tenantId, ticketId: row.id, kind: 'Status', externalId: `Status:${status}:${t.date_mod ?? Date.now()}`, direction: 'entrada', author: null, text: statusName, isPrivate: false, occurredAt: glpiDate(t.date_mod, tz) ?? new Date() });
    }
    const added = entries.length ? await db.insert(s.glpiTicketEvents).values(entries).onConflictDoNothing().returning({ id: s.glpiTicketEvents.id, kind: s.glpiTicketEvents.kind, direction: s.glpiTicketEvents.direction }) : [];
    // o que nós mesmos enviamos (acompanhamento do CRM) volta pelo GLPI com o mesmo id: não conta como novo
    const fresh = added.filter((a) => a.direction === 'entrada').length;
    await db.update(s.glpiTickets).set({
      status, statusName, solvedAt: glpiDate(t.date_solve, tz), closedAt: glpiDate(t.date_close, tz), glpiUpdatedAt: t.date_mod ?? null,
      lastSyncAt: new Date(), syncError: null, unseen: sql`${s.glpiTickets.unseen} + ${fresh}`, updatedAt: new Date(),
    }).where(eq(s.glpiTickets.id, row.id));
    const solvedNow = status && (status === 5 || status === 6) && (row.status ?? 0) < 5;
    if (solvedNow) await taskForOwner(db, row, status!);
    return { added: fresh, status };
  } catch (e) {
    await db.update(s.glpiTickets).set({ lastSyncAt: new Date(), syncError: (e as Error).message.slice(0, 300) }).where(eq(s.glpiTickets.id, row.id));
    throw e;
  }
}

async function taskForOwner(db: DbOrTx, row: TicketRow, status: number) {
  const [o] = await db.select({ ownerId: s.opportunities.ownerId, code: s.opportunities.code, contactId: s.opportunities.contactId }).from(s.opportunities).where(eq(s.opportunities.id, row.opportunityId)).limit(1);
  if (!o) return;
  await db.insert(s.activities).values({
    tenantId: row.tenantId, type: 'tarefa', title: `Dar retorno ao cliente: chamado GLPI #${row.glpiId} ${status === 6 ? 'fechado' : 'solucionado'}`,
    notes: `“${row.title}”. Veja a solução na aba Chamados GLPI da OP-${o.code}.`, priority: 'media', ownerId: o.ownerId, dueAt: new Date(),
    opportunityId: row.opportunityId, contactId: o.contactId, createdBy: row.openedBy,
  });
}

/** Rotina: relê os chamados ainda abertos (rede de segurança caso algum webhook se perca). */
export async function syncOpenTickets(db: DbOrTx, tenantId: string, max = 40) {
  const r = await integrationRow(db, tenantId, 'glpi');
  if (!r.enabled) return { skipped: 'desligado' };
  let cfg: GlpiCfg;
  try { cfg = await glpiConfig(db, tenantId); } catch (e) { return { skipped: (e as Error).message }; }
  const rows = await db.select().from(s.glpiTickets).where(and(eq(s.glpiTickets.tenantId, tenantId), or(isNull(s.glpiTickets.status), lt(s.glpiTickets.status, 6)))).orderBy(s.glpiTickets.lastSyncAt).limit(max);
  let ok = 0, failed = 0;
  for (const row of rows) {
    try { await syncTicket(db, cfg, row); ok++; } catch { failed++; }
  }
  if (failed) await logEvent(db, tenantId, 'glpi', 'erro', `Releitura dos chamados: ${failed} com erro, ${ok} atualizados.`);
  return { ok, failed };
}

