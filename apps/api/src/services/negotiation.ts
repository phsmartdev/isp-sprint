/**
 * Chat interno, comentários e menções da negociação.
 * - Chat: conversa do time (negotiation_messages, append-only), fora do histórico do cliente.
 * - Comentário: registro formal no histórico da oportunidade (opportunity_events tipo 'comment').
 * - Menção (@): só quem tem acesso à negociação; avisa por e-mail/WhatsApp com resumo curto.
 */
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as s from '../db/schema';
import type { DbOrTx, DB } from '../db/client';
import { authForUser, type AuthContext } from '../http/context';
import { unprocessable } from '../http/errors';
import { decryptSecret, sendAlert, smtpConfig } from './email';
import { integrationRow, logEvent } from './integrations';
import { sendZapiText, waPhone } from './whatsapp';
import { approvalSettingsOf, loadForAnalysis } from './approvals';

export async function chatOf(db: DbOrTx, tenantId: string, oppId: string) {
  const rows = await db
    .select({ m: s.negotiationMessages, who: s.users.name })
    .from(s.negotiationMessages)
    .leftJoin(s.users, eq(s.users.id, s.negotiationMessages.authorId))
    .where(and(eq(s.negotiationMessages.tenantId, tenantId), eq(s.negotiationMessages.opportunityId, oppId)))
    .orderBy(s.negotiationMessages.createdAt)
    .limit(1000);
  const ids = [...new Set(rows.flatMap((r) => r.m.mentions))];
  const names = ids.length ? new Map((await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids))).map((u) => [u.id, u.name])) : new Map<string, string>();
  return rows.map(({ m, who }) => ({ id: m.id, kind: m.kind, body: m.body, authorId: m.authorId, authorName: who, requestId: m.requestId, createdAt: m.createdAt, mentions: m.mentions.map((id) => ({ id, name: names.get(id) ?? 'usuário' })) }));
}

/** Quem pode ser mencionado: usuários ativos que conseguem abrir a negociação. */
export async function participants(db: DB, tenantId: string, oppId: string) {
  const users = await db.select({ id: s.users.id, name: s.users.name, jobTitle: s.users.jobTitle, hasAvatar: sql<boolean>`exists(select 1 from user_avatars ua where ua.user_id = "users"."id")` }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true))).orderBy(s.users.name);
  const out: typeof users = [];
  for (const u of users) {
    const ctx = await authForUser(db, tenantId, u.id);
    if (!ctx) continue;
    try { await loadForAnalysis(db, ctx, oppId); out.push(u); } catch { /* sem acesso */ }
  }
  return out;
}

/** Confere as menções: todas precisam ter acesso. Devolve os dados de contato. */
export async function validateMentions(db: DB, tenantId: string, oppId: string, ids: string[], authorId: string) {
  const unique = [...new Set(ids)].filter((id) => id !== authorId);
  if (!unique.length) return [];
  const ok = await participants(db, tenantId, oppId);
  const missing = unique.filter((id) => !ok.some((u) => u.id === id));
  if (missing.length) {
    const names = await db.select({ name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, tenantId), inArray(s.users.id, missing)));
    throw unprocessable(`${names.map((n) => n.name).join(', ') || 'Usuário'} não tem acesso a esta negociação e não pode ser mencionado.`, [{ path: 'mentions', message: 'Sem acesso à negociação' }]);
  }
  return db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone }).from(s.users).where(inArray(s.users.id, unique));
}

/** Avisa por e-mail e/ou WhatsApp conforme Configurações → Aprovações e alçadas. Devolve o relatório de envio. */
export async function notifyPeople(app: FastifyInstance, tenantId: string, oppId: string, to: { name: string; email: string; phone: string | null }[], subject: string, text: string) {
  const st = await approvalSettingsOf(app.db, tenantId);
  const report: string[] = [];
  if (st.notifyEmail) {
    const smtp = await smtpConfig(app.db, tenantId);
    if (!smtp?.enabled) report.push('E-mail não enviado: SMTP desligado.');
    else for (const u of to) {
      const r = await sendAlert(app.db, { tenantId, kind: 'negociacao', to: u.email, subject, text, opportunityId: oppId });
      report.push(r && 'ok' in r && r.ok ? `E-mail para ${u.name}.` : `E-mail para ${u.name} falhou.`);
    }
  }
  if (st.notifyWhatsapp) {
    const z = await integrationRow(app.db, tenantId, 'zapi');
    const tok = z.secrets.instanceToken ? decryptSecret(z.secrets.instanceToken) : null;
    if (!z.enabled || !z.config.instanceId || !tok) report.push('WhatsApp não enviado: Z-API não configurada.');
    else for (const u of to) {
      const ph = waPhone(u.phone);
      if (!ph) { report.push(`WhatsApp para ${u.name}: sem número no cadastro do usuário.`); continue; }
      try {
        await sendZapiText({ instanceId: z.config.instanceId, instanceToken: tok, clientToken: z.secrets.clientToken ? decryptSecret(z.secrets.clientToken) : null }, ph, text);
        await logEvent(app.db, tenantId, 'zapi', 'enviado', `Aviso da negociação para ${u.name}.`);
        report.push(`WhatsApp para ${u.name}.`);
      } catch (e) {
        await logEvent(app.db, tenantId, 'zapi', 'erro', `Aviso da negociação para ${u.name}: ${(e as Error).message}`);
        report.push(`WhatsApp para ${u.name} falhou: ${(e as Error).message}`);
      }
    }
  }
  return report;
}

export async function markRead(db: DbOrTx, auth: AuthContext, oppId: string) {
  const now = new Date();
  await db.insert(s.negotiationReads).values({ tenantId: auth.tenantId, userId: auth.userId, opportunityId: oppId, lastReadAt: now }).onConflictDoUpdate({ target: [s.negotiationReads.userId, s.negotiationReads.opportunityId], set: { lastReadAt: now } });
  return now;
}

export async function lastReadAt(db: DbOrTx, userId: string, oppId: string) {
  const [r] = await db.select({ at: s.negotiationReads.lastReadAt }).from(s.negotiationReads).where(and(eq(s.negotiationReads.userId, userId), eq(s.negotiationReads.opportunityId, oppId))).limit(1);
  return r?.at ?? null;
}

/** Não lidas desta negociação: mensagens do chat e comentários de outras pessoas depois da última leitura. */
export async function unreadOf(db: DbOrTx, auth: AuthContext, oppId: string) {
  const since = (await lastReadAt(db, auth.userId, oppId)) ?? new Date(0);
  const [chat] = await db
    .select({ n: sql<number>`count(*)::int`, m: sql<number>`count(*) filter (where ${auth.userId}::uuid = any(${s.negotiationMessages.mentions}))::int` })
    .from(s.negotiationMessages)
    .where(and(eq(s.negotiationMessages.opportunityId, oppId), eq(s.negotiationMessages.kind, 'mensagem'), gt(s.negotiationMessages.createdAt, since), or(isNull(s.negotiationMessages.authorId), ne(s.negotiationMessages.authorId, auth.userId))));
  const [com] = await db
    .select({ n: sql<number>`count(*)::int`, m: sql<number>`count(*) filter (where ${s.opportunityEvents.payload}->'mentions' ? ${auth.userId})::int` })
    .from(s.opportunityEvents)
    .where(and(eq(s.opportunityEvents.opportunityId, oppId), eq(s.opportunityEvents.type, 'comment'), gt(s.opportunityEvents.occurredAt, since), or(isNull(s.opportunityEvents.actorId), ne(s.opportunityEvents.actorId, auth.userId))));
  return { chat: chat?.n ?? 0, comments: com?.n ?? 0, mentions: (chat?.m ?? 0) + (com?.m ?? 0), lastReadAt: since.getTime() ? since : null };
}

/** Menções a mim ainda não lidas, em todas as negociações. */
export async function myMentions(db: DbOrTx, auth: AuthContext) {
  const rows = await db.execute<{ opportunity_id: string; code: number; contact_name: string; source: string; body: string; author: string | null; at: Date; unread: boolean }>(sql`
    with m as (
      select nm.opportunity_id, 'chat' as source, nm.body, nm.author_id, nm.created_at as at
        from negotiation_messages nm
       where nm.tenant_id = ${auth.tenantId} and ${auth.userId}::uuid = any(nm.mentions)
      union all
      select oe.opportunity_id, 'comentario', oe.reason, oe.actor_id, oe.occurred_at
        from opportunity_events oe
       where oe.tenant_id = ${auth.tenantId} and oe.type = 'comment' and oe.payload->'mentions' ? ${auth.userId}
    )
    select m.opportunity_id, o.code, c.name as contact_name, m.source, m.body, u.name as author, m.at,
           (r.last_read_at is null or m.at > r.last_read_at) as unread
      from m
      join opportunities o on o.id = m.opportunity_id and o.deleted_at is null
      join contacts c on c.id = o.contact_id
      left join users u on u.id = m.author_id
      left join negotiation_reads r on r.user_id = ${auth.userId} and r.opportunity_id = m.opportunity_id
     order by m.at desc
     limit 30`);
  const items = rows.rows.map((r) => ({ opportunityId: r.opportunity_id, code: r.code, contactName: r.contact_name, source: r.source as 'chat' | 'comentario', body: r.body, author: r.author, at: r.at, unread: r.unread }));
  return { items, unread: items.filter((i) => i.unread).length };
}

/** Texto do aviso de menção: curto, sem dados financeiros. */
export const mentionText = (author: string, code: number, customer: string, where: 'chat' | 'comentário', body: string, link: string) =>
  `${author} mencionou você no ${where} da OP-${code} (${customer}):\n"${body.length > 280 ? `${body.slice(0, 277)}...` : body}"\nAbrir: ${link}`;
