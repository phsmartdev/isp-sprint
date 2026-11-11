/**
 * Notificações de Pessoas & Cultura sobre o mecanismo genérico (user_notifications), que aparece no ícone de avisos
 * do topo junto com as menções dos outros módulos.
 *  - Interna é o canal principal. E-mail e WhatsApp só quando a empresa liga para o evento e a pessoa não desligou;
 *    o texto externo é genérico (título + link): o conteúdo de publicações, comentários e comunidades nunca sai do sistema.
 *  - GLPI e IXC não recebem avisos sociais (não é a finalidade deles).
 *  - Cada aviso tem chave de deduplicação; cada canal tentado fica registrado (notification_deliveries).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';
import type { Config } from '../../config';
import { sendAlert } from '../email';
import { publicLink } from '../alerts';
import { zapiCfg } from '../contractNotify';
import { sendZapiText, waPhone } from '../whatsapp';
import { peopleSettingsOf } from './settings';
import { eligibleMembers, inAudience, type Audience } from './audience';

export const PEOPLE_EVENTS = {
  mencao: { label: 'Menção em publicação ou comentário', mandatory: false },
  comentario: { label: 'Comentário na minha publicação', mandatory: false },
  resposta: { label: 'Resposta ao meu comentário', mandatory: false },
  reconhecimento: { label: 'Reconhecimento recebido', mandatory: false },
  convite_comunidade: { label: 'Convite para comunidade', mandatory: false },
  participacao_aprovada: { label: 'Participação em comunidade aprovada', mandatory: false },
  comunicado: { label: 'Comunicado oficial', mandatory: false },
  comunicado_urgente: { label: 'Comunicado oficial urgente', mandatory: true },
  comunicado_pendente: { label: 'Comunicado com confirmação de leitura pendente', mandatory: true },
  moderacao: { label: 'Atualização de moderação', mandatory: true },
} as const;
export type PeopleEvent = keyof typeof PEOPLE_EVENTS;
export const CHANNELS = ['interna', 'email', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

export type NotifyItem = { userId: string; event: PeopleEvent; title: string; body?: string | null; link: string; actorId?: string | null; dedupeKey: string };

/** Preferências: obrigatório não desliga a interna; sem linha = ligado. */
export async function prefsOf(db: DbOrTx, tenantId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, boolean>();
  const rows = await db.select().from(s.userNotificationPrefs).where(and(eq(s.userNotificationPrefs.tenantId, tenantId), inArray(s.userNotificationPrefs.userId, userIds)));
  return new Map(rows.map((r) => [`${r.userId}:${r.event}:${r.channel}`, r.enabled]));
}

export async function notifyPeople(db: DbOrTx, config: Config | null, tenantId: string, items: NotifyItem[]) {
  const list = items.filter((i) => i.userId !== i.actorId);
  if (!list.length) return { created: 0 };
  const st = await peopleSettingsOf(db, tenantId);
  const userIds = [...new Set(list.map((i) => i.userId))];
  const [prefs, users] = await Promise.all([
    prefsOf(db, tenantId, userIds),
    db.select({ id: s.users.id, email: s.users.email, phone: s.users.phone, active: s.users.active }).from(s.users).where(and(eq(s.users.tenantId, tenantId), inArray(s.users.id, userIds))),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const on = (i: NotifyItem, ch: Channel) => {
    if (ch === 'interna') return PEOPLE_EVENTS[i.event].mandatory || prefs.get(`${i.userId}:${i.event}:interna`) !== false;
    const company = st.notifications[i.event]?.[ch] ?? false;
    return company && prefs.get(`${i.userId}:${i.event}:${ch}`) !== false;
  };
  let zapi: Awaited<ReturnType<typeof zapiCfg>> | undefined;
  let created = 0;
  for (const i of list) {
    const u = byId.get(i.userId);
    if (!u?.active) continue;
    const internal = on(i, 'interna');
    const external = (['email', 'whatsapp'] as const).filter((c) => on(i, c));
    if (!internal && !external.length) continue;
    const [n] = await db.insert(s.userNotifications).values({
      tenantId, userId: i.userId, module: 'pessoas', event: i.event, title: i.title.slice(0, 200), body: i.body?.slice(0, 300) ?? null, link: i.link, actorId: i.actorId ?? null, dedupeKey: i.dedupeKey,
      readAt: internal ? null : new Date(),
    }).onConflictDoNothing().returning({ id: s.userNotifications.id });
    if (!n) continue; // já avisado
    created++;
    const log = (channel: Channel, status: typeof s.notificationDeliveries.$inferInsert.status, detail: string | null = null) =>
      db.insert(s.notificationDeliveries).values({ tenantId, notificationId: n.id, channel, status, detail: detail?.slice(0, 300) ?? null });
    await log('interna', internal ? 'entregue' : 'desativado', internal ? null : 'Desligado pela pessoa');
    const text = `${i.title}\n\nAbrir: ${config ? publicLink(config, i.link) : i.link}`;
    for (const ch of external) {
      if (ch === 'email') {
        if (!u.email) { await log('email', 'sem_contato', 'Sem e-mail cadastrado.'); continue; }
        const r = await sendAlert(db, { tenantId, kind: 'pessoas_aviso', to: u.email, subject: i.title, text });
        await log('email', r?.ok ? 'enviado' : r && 'notConfigured' in r && r.notConfigured ? 'nao_configurado' : 'falhou', r && !r.ok ? r.error : null);
      } else {
        const to = waPhone(u.phone);
        if (!to) { await log('whatsapp', 'sem_contato', 'Sem WhatsApp cadastrado.'); continue; }
        if (zapi === undefined) zapi = await zapiCfg(db, tenantId);
        if (!zapi) { await log('whatsapp', 'nao_configurado', 'WhatsApp (Z-API) não configurado.'); continue; }
        try { await sendZapiText(zapi, to, text); await log('whatsapp', 'enviado'); } catch (e) { await log('whatsapp', 'falhou', (e as Error).message); }
      }
    }
  }
  return { created };
}

/** Quem pode ver uma publicação (para não avisar alguém sobre conteúdo de comunidade privada da qual não participa). */
export async function canSeePost(db: DbOrTx, post: { communityId: string | null }, userIds: string[]) {
  if (!post.communityId || !userIds.length) return new Set(userIds);
  const [c] = await db.select({ kind: s.peopleCommunities.kind }).from(s.peopleCommunities).where(eq(s.peopleCommunities.id, post.communityId)).limit(1);
  if (c?.kind !== 'privada') return new Set(userIds);
  const ms = await db.select({ userId: s.peopleCommunityMembers.userId }).from(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, post.communityId), inArray(s.peopleCommunityMembers.userId, userIds)));
  return new Set(ms.map((m) => m.userId));
}

/** Avisos do módulo para o ícone do topo. */
export async function myPeopleNotifications(db: DbOrTx, tenantId: string, userId: string, limit = 30) {
  return db.select({ id: s.userNotifications.id, event: s.userNotifications.event, title: s.userNotifications.title, body: s.userNotifications.body, link: s.userNotifications.link, at: s.userNotifications.createdAt, readAt: s.userNotifications.readAt, author: s.users.name })
    .from(s.userNotifications).leftJoin(s.users, eq(s.users.id, s.userNotifications.actorId))
    .where(and(eq(s.userNotifications.tenantId, tenantId), eq(s.userNotifications.userId, userId)))
    .orderBy(sql`${s.userNotifications.createdAt} desc`).limit(limit);
}

const firstName = (n: string) => n.split(' ')[0] ?? n;

/** Menções numa publicação: avisa só quem consegue ver a publicação. */
export async function notifyPostMentions(db: DbOrTx, config: Config | null, tenantId: string, post: { id: string; communityId: string | null; mentions: string[]; status: string }, actor: { id: string; name: string }) {
  if (post.status !== 'publicado' || !post.mentions.length) return;
  const ok = await canSeePost(db, post, post.mentions);
  await notifyPeople(db, config, tenantId, [...ok].map((u) => ({ userId: u, event: 'mencao' as const, title: `${firstName(actor.name)} mencionou você numa publicação`, link: `/pessoas/publicacao/${post.id}`, actorId: actor.id, dedupeKey: `mencao:post:${post.id}` })));
}

/** Comentário: menções, autor da publicação e autor do comentário respondido (cada pessoa recebe um aviso só). */
export async function notifyComment(db: DbOrTx, config: Config | null, tenantId: string, post: { id: string; communityId: string | null; authorId: string }, comment: { id: string; parentId: string | null; mentions: string[] }, actor: { id: string; name: string }) {
  const items: NotifyItem[] = [];
  const seen = new Set<string>([actor.id]);
  const link = `/pessoas/publicacao/${post.id}`;
  const fn = firstName(actor.name);
  const visible = await canSeePost(db, post, comment.mentions);
  for (const u of comment.mentions) if (visible.has(u) && !seen.has(u)) { seen.add(u); items.push({ userId: u, event: 'mencao', title: `${fn} mencionou você num comentário`, link, actorId: actor.id, dedupeKey: `mencao:comentario:${comment.id}` }); }
  if (comment.parentId) {
    const [parent] = await db.select({ authorId: s.peopleComments.authorId }).from(s.peopleComments).where(eq(s.peopleComments.id, comment.parentId)).limit(1);
    if (parent && !seen.has(parent.authorId)) { seen.add(parent.authorId); items.push({ userId: parent.authorId, event: 'resposta', title: `${fn} respondeu ao seu comentário`, link, actorId: actor.id, dedupeKey: `resposta:${comment.id}` }); }
  }
  if (!seen.has(post.authorId)) items.push({ userId: post.authorId, event: 'comentario', title: `${fn} comentou na sua publicação`, link, actorId: actor.id, dedupeKey: `comentario:${comment.id}` });
  await notifyPeople(db, config, tenantId, items);
}

/**
 * Comunicado publicado (ou que chegou a hora do agendamento): avisa o público uma vez. Nova versão de comunicado com
 * confirmação: avisa de novo quem ainda não confirmou esta versão. Idempotente (dedupe).
 */
export async function announcementFanout(db: DbOrTx, config: Config | null, tenantId: string, annId: string, today: string) {
  const now = new Date();
  const [a] = await db.select().from(s.peopleAnnouncements).where(and(eq(s.peopleAnnouncements.tenantId, tenantId), eq(s.peopleAnnouncements.id, annId), eq(s.peopleAnnouncements.status, 'publicado'))).limit(1);
  if (!a || (a.publishAt && a.publishAt > now) || (a.expiresAt && a.expiresAt <= now)) return 0;
  const members = await eligibleMembers(db, tenantId, today);
  const aud = [...members.values()].filter((m) => inAudience(a.audience as Audience, m)).map((m) => m.id);
  if (!aud.length) return 0;
  const link = '/pessoas';
  const items: NotifyItem[] = aud.map((u) => ({ userId: u, event: a.priority === 'urgente' ? 'comunicado_urgente' : 'comunicado', title: `${a.priority === 'urgente' ? 'Comunicado urgente' : 'Novo comunicado'}: ${a.title}`, link, actorId: a.createdBy, dedupeKey: `comunicado:${a.id}` }));
  if (a.requireAck && a.version > 1) {
    const acked = new Set((await db.select({ userId: s.peopleAnnouncementReads.userId }).from(s.peopleAnnouncementReads).where(and(eq(s.peopleAnnouncementReads.announcementId, a.id), eq(s.peopleAnnouncementReads.ackVersion, a.version)))).map((r) => r.userId));
    for (const u of aud) if (!acked.has(u)) items.push({ userId: u, event: 'comunicado_pendente', title: `Comunicado atualizado: confirme a leitura — ${a.title}`, link, actorId: a.createdBy, dedupeKey: `comunicado:${a.id}:v${a.version}` });
  }
  return (await notifyPeople(db, config, tenantId, items)).created;
}

/** Rotina diária: comunicados agendados que chegaram e lembrete (uma vez por versão) de confirmação pendente há 2+ dias. */
export async function announcementRoutine(db: DbOrTx, config: Config | null, tenantId: string, today: string) {
  const now = new Date();
  const anns = await db.select().from(s.peopleAnnouncements).where(and(eq(s.peopleAnnouncements.tenantId, tenantId), eq(s.peopleAnnouncements.status, 'publicado'), sql`(${s.peopleAnnouncements.expiresAt} is null or ${s.peopleAnnouncements.expiresAt} > now())`, sql`coalesce(${s.peopleAnnouncements.publishAt}, ${s.peopleAnnouncements.createdAt}) <= now()`));
  if (!anns.length) return { published: 0, reminders: 0 };
  let published = 0;
  let reminders = 0;
  const members = await eligibleMembers(db, tenantId, today);
  for (const a of anns) {
    const at = a.publishAt ?? a.createdAt;
    if (now.getTime() - at.getTime() < 3 * 86400000) published += await announcementFanout(db, config, tenantId, a.id, today);
    if (!a.requireAck || now.getTime() - at.getTime() < 2 * 86400000) continue;
    const acked = new Set((await db.select({ userId: s.peopleAnnouncementReads.userId }).from(s.peopleAnnouncementReads).where(and(eq(s.peopleAnnouncementReads.announcementId, a.id), eq(s.peopleAnnouncementReads.ackVersion, a.version)))).map((r) => r.userId));
    const pending = [...members.values()].filter((m) => inAudience(a.audience as Audience, m) && !acked.has(m.id));
    reminders += (await notifyPeople(db, config, tenantId, pending.map((m) => ({ userId: m.id, event: 'comunicado_pendente' as const, title: `Confirme a leitura: ${a.title}`, link: '/pessoas', actorId: a.createdBy, dedupeKey: `pendente:${a.id}:v${a.version}` })))).created;
  }
  return { published, reminders };
}
