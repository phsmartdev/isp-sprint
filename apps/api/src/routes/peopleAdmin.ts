/**
 * Pessoas & Cultura · Etapa 5 — notificações (caixa, preferências, rastreabilidade) e painel administrativo.
 * Indicadores são sempre agregados: nada de ranking ou métrica individual de uso.
 */
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden } from '../http/errors';
import * as s from '../db/schema';
import { peopleCaps, peopleSettingsOf } from '../services/people/settings';
import { eligibleMembers } from '../services/people/audience';
import { CHANNELS, PEOPLE_EVENTS, prefsOf, type PeopleEvent } from '../services/people/notify';
import { institutionalOf, publicCard } from '../services/people/profiles';
import { todayIn } from '../services/vacations';

const M = { tag: 'Pessoas & Cultura', module: 'pessoas' as const };
const dayRe = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export const peopleAdminRoutes = [
  // ------------------------------------------------------------------ notificações da pessoa
  defineRoute({
    method: 'GET', url: '/pessoas/notificacoes', summary: 'Meus avisos do módulo e minhas preferências por evento e canal', ...M,
    handler: async ({ app, auth }) => {
      const [items, st, prefs] = await Promise.all([
        app.db.select({ id: s.userNotifications.id, event: s.userNotifications.event, title: s.userNotifications.title, body: s.userNotifications.body, link: s.userNotifications.link, at: s.userNotifications.createdAt, readAt: s.userNotifications.readAt, actorId: s.userNotifications.actorId })
          .from(s.userNotifications).where(and(eq(s.userNotifications.tenantId, auth.tenantId), eq(s.userNotifications.userId, auth.userId), eq(s.userNotifications.module, 'pessoas'))).orderBy(desc(s.userNotifications.createdAt)).limit(60),
        peopleSettingsOf(app.db, auth.tenantId),
        prefsOf(app.db, auth.tenantId, [auth.userId]),
      ]);
      const people = await institutionalOf(app.db, auth.tenantId, items.map((i) => i.actorId).filter(Boolean) as string[]);
      return {
        items: items.map(({ actorId, ...i }) => ({ ...i, actor: actorId && people.get(actorId) ? publicCard(people.get(actorId)!) : null })),
        events: (Object.keys(PEOPLE_EVENTS) as PeopleEvent[]).map((e) => ({
          key: e, label: PEOPLE_EVENTS[e].label, mandatory: PEOPLE_EVENTS[e].mandatory,
          channels: CHANNELS.map((ch) => ({ channel: ch, available: ch === 'interna' || !!st.notifications[e]?.[ch], enabled: ch === 'interna' && PEOPLE_EVENTS[e].mandatory ? true : prefs.get(`${auth.userId}:${e}:${ch}`) !== false })),
        })),
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/pessoas/notificacoes/preferencias', summary: 'Liga/desliga um canal de um evento (o aviso interno de evento obrigatório não desliga)', ...M,
    body: z.object({ items: z.array(z.object({ event: z.enum(Object.keys(PEOPLE_EVENTS) as [PeopleEvent]), channel: z.enum(CHANNELS), enabled: z.boolean() })).max(60) }),
    handler: async ({ app, auth, body }) => {
      for (const i of body.items) {
        if (i.channel === 'interna' && PEOPLE_EVENTS[i.event].mandatory) continue;
        await app.db.insert(s.userNotificationPrefs).values({ tenantId: auth.tenantId, userId: auth.userId, event: i.event, channel: i.channel, enabled: i.enabled })
          .onConflictDoUpdate({ target: [s.userNotificationPrefs.userId, s.userNotificationPrefs.event, s.userNotificationPrefs.channel], set: { enabled: i.enabled, updatedAt: new Date() } });
      }
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/me/notificacoes/:id/lida', summary: 'Marca um aviso como lido', tag: 'Pessoas & Cultura', anyAuthenticated: true, params: z.object({ id: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const r = await app.db.update(s.userNotifications).set({ readAt: new Date() }).where(and(eq(s.userNotifications.tenantId, auth.tenantId), eq(s.userNotifications.userId, auth.userId), eq(s.userNotifications.id, params.id), isNull(s.userNotifications.readAt))).returning({ id: s.userNotifications.id });
      return { ok: true, changed: r.length };
    },
  }),
  defineRoute({
    method: 'POST', url: '/me/notificacoes/lidas', summary: 'Marca todos os meus avisos como lidos', tag: 'Pessoas & Cultura', anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      await app.db.update(s.userNotifications).set({ readAt: new Date() }).where(and(eq(s.userNotifications.tenantId, auth.tenantId), eq(s.userNotifications.userId, auth.userId), isNull(s.userNotifications.readAt)));
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/admin/entregas', summary: 'Rastreabilidade dos avisos: evento, destinatário, canal, situação e resultado', ...M,
    query: z.object({ canal: z.enum(CHANNELS).optional(), situacao: z.string().max(20).optional() }),
    handler: async ({ app, auth, query }) => {
      if (!peopleCaps(auth, await peopleSettingsOf(app.db, auth.tenantId)).configure) throw forbidden('Só a administração do módulo consulta as entregas.');
      const rows = await app.db.select({ id: s.notificationDeliveries.id, channel: s.notificationDeliveries.channel, status: s.notificationDeliveries.status, detail: s.notificationDeliveries.detail, at: s.notificationDeliveries.createdAt, event: s.userNotifications.event, recipient: s.users.name })
        .from(s.notificationDeliveries).innerJoin(s.userNotifications, eq(s.userNotifications.id, s.notificationDeliveries.notificationId)).innerJoin(s.users, eq(s.users.id, s.userNotifications.userId))
        .where(and(eq(s.notificationDeliveries.tenantId, auth.tenantId), eq(s.userNotifications.module, 'pessoas'), query.canal ? eq(s.notificationDeliveries.channel, query.canal) : undefined, query.situacao ? eq(s.notificationDeliveries.status, query.situacao) : undefined))
        .orderBy(desc(s.notificationDeliveries.createdAt)).limit(200);
      // o título do aviso (que pode citar conteúdo) não aparece aqui: só o evento
      return { items: rows.map((r) => ({ ...r, eventLabel: PEOPLE_EVENTS[r.event as PeopleEvent]?.label ?? r.event })) };
    },
  }),

  // ------------------------------------------------------------------ painel administrativo
  defineRoute({
    method: 'GET', url: '/pessoas/admin/painel', summary: 'Visão geral agregada do módulo no período', ...M,
    query: z.object({ de: dayRe.optional(), ate: dayRe.optional() }),
    handler: async ({ app, auth, query }) => {
      const caps = peopleCaps(auth, await peopleSettingsOf(app.db, auth.tenantId));
      if (!caps.administer && !caps.communicate && !caps.moderate) throw forbidden('Painel para Pessoas e Cultura, Comunicação e Moderação.');
      const today = todayIn(auth.timezone);
      const ate = query.ate ?? today;
      const de = query.de ?? addDays(ate, -29);
      const from = new Date(`${de}T00:00:00-03:00`);
      const to = new Date(`${addDays(ate, 1)}T00:00:00-03:00`);
      const t = auth.tenantId;
      const eligible = await eligibleMembers(app.db, t, today);
      const ids = [...eligible.keys()];
      const n = (r: { rows: unknown[] }) => Number((r.rows[0] as { n: number | string } | undefined)?.n ?? 0);
      const [active, posts, comms, recs, anns, pending, decided] = await Promise.all([
        ids.length ? app.db.execute(sql`select count(distinct user_id) as n from people_activity_days where tenant_id = ${t} and day between ${de} and ${ate} and user_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`) : Promise.resolve({ rows: [{ n: 0 }] }),
        app.db.execute(sql`select count(*) as n from people_posts where tenant_id = ${t} and status in ('publicado','oculto','removido') and deleted_at is null and published_at >= ${from} and published_at < ${to}`),
        app.db.execute(sql`select count(*) as n from people_communities where tenant_id = ${t} and status = 'ativa'`),
        app.db.execute(sql`select count(*) as n from people_recognitions where tenant_id = ${t} and status = 'valido' and created_at >= ${from} and created_at < ${to}`),
        app.db.execute(sql`select count(*) as n from people_announcements where tenant_id = ${t} and status <> 'rascunho' and coalesce(publish_at, created_at) >= ${from} and coalesce(publish_at, created_at) < ${to}`),
        app.db.execute(sql`select count(*) as n from people_reports where tenant_id = ${t} and status in ('aberta','em_analise','em_revisao')`),
        app.db.execute(sql`select count(*) as n, coalesce(avg(extract(epoch from decided_at - created_at)) / 3600, 0) as h from people_reports where tenant_id = ${t} and decided_at >= ${from} and decided_at < ${to}`),
      ]);
      const activeN = n(active);
      const d = decided.rows[0] as { n: string | number; h: string | number };
      return {
        period: { de, ate },
        eligible: ids.length, activeUsers: activeN, adoptionPct: ids.length ? Math.round((activeN / ids.length) * 1000) / 10 : 0,
        posts: n(posts), activeCommunities: n(comms), recognitions: n(recs), announcements: n(anns), pendingReports: n(pending),
        decidedReports: Number(d.n), avgModerationHours: Math.round(Number(d.h) * 10) / 10,
        caps,
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/admin/conteudos', summary: 'Gestão de conteúdo: publicações com filtros (sem abrir comunidade privada de que não participa)', ...M,
    query: z.object({ tipo: z.string().max(20).optional(), situacao: z.enum(['publicado', 'oculto', 'removido']).optional(), comunidade: z.string().uuid().optional(), de: dayRe.optional(), ate: dayRe.optional(), antes: z.string().datetime().optional() }),
    handler: async ({ app, auth, query }) => {
      const caps = peopleCaps(auth, await peopleSettingsOf(app.db, auth.tenantId));
      if (!caps.administer && !caps.communicate && !caps.moderate) throw forbidden('Gestão de conteúdo para Pessoas e Cultura, Comunicação e Moderação.');
      const P = s.peoplePosts;
      const where = and(
        eq(P.tenantId, auth.tenantId), isNull(P.deletedAt), inArray(P.status, query.situacao ? [query.situacao] : ['publicado', 'oculto', 'removido']),
        sql`(${P.audience} = 'organizacao' or exists (select 1 from people_communities c where c.id = ${P.communityId} and (c.kind <> 'privada' or exists (select 1 from people_community_members m where m.community_id = c.id and m.user_id = ${auth.userId}))))`,
        query.tipo ? eq(P.kind, query.tipo) : undefined,
        query.comunidade ? eq(P.communityId, query.comunidade) : undefined,
        query.de ? gte(P.publishedAt, new Date(`${query.de}T00:00:00-03:00`)) : undefined,
        query.ate ? lte(P.publishedAt, new Date(`${query.ate}T23:59:59-03:00`)) : undefined,
        query.antes ? lt(P.publishedAt, new Date(query.antes)) : undefined,
      );
      const rows = await app.db.select({ id: P.id, kind: P.kind, status: P.status, body: P.body, authorId: P.authorId, communityId: P.communityId, publishedAt: P.publishedAt, reactions: P.reactionCount, comments: P.commentCount }).from(P).where(where).orderBy(desc(P.publishedAt)).limit(31);
      const more = rows.length > 30;
      const list = rows.slice(0, 30);
      const people = await institutionalOf(app.db, auth.tenantId, list.map((r) => r.authorId));
      const comms = [...new Set(list.map((r) => r.communityId).filter(Boolean) as string[])];
      const cn = comms.length ? new Map((await app.db.select({ id: s.peopleCommunities.id, name: s.peopleCommunities.name }).from(s.peopleCommunities).where(inArray(s.peopleCommunities.id, comms))).map((c) => [c.id, c.name])) : new Map<string, string>();
      const reports = list.length ? await app.db.execute<{ target_id: string; n: number }>(sql`select target_id, count(*)::int as n from people_reports where tenant_id = ${auth.tenantId} and target_type = 'publicacao' and target_id in (${sql.join(list.map((r) => sql`${r.id}::uuid`), sql`, `)}) group by target_id`) : { rows: [] };
      const rc = new Map(reports.rows.map((r) => [r.target_id, Number(r.n)]));
      return {
        items: list.map((r) => ({ id: r.id, kind: r.kind, status: r.status, excerpt: r.body.slice(0, 240), author: people.get(r.authorId) ? publicCard(people.get(r.authorId)!) : null, community: r.communityId ? { id: r.communityId, name: cn.get(r.communityId) ?? '' } : null, publishedAt: r.publishedAt, reactions: r.reactions, comments: r.comments, reports: rc.get(r.id) ?? 0 })),
        next: more ? list[list.length - 1]!.publishedAt?.toISOString() ?? null : null,
        canModerate: caps.moderate,
      };
    },
  }),
];

/** Uso do módulo no dia (só para a taxa de adoção agregada). */
export async function touchActivity(db: Parameters<typeof eligibleMembers>[0], tenantId: string, userId: string, day: string) {
  await db.insert(s.peopleActivityDays).values({ tenantId, userId, day }).onConflictDoNothing();
}

