/**
 * Pessoas & Cultura — Etapa 4 (cultura e comunicação): reconhecimento entre colegas e comunicados oficiais.
 * Reconhecimento não dá pontos nesta fase e não vira indicador individual de desempenho.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { peopleCaps, peopleSettingsOf } from '../services/people/settings';
import { communityPerms, loadCommunity } from '../services/people/communities';
import { institutionalOf, publicCard } from '../services/people/profiles';
import { eligibleMembers, inAudience, memberOf, type Audience } from '../services/people/audience';
import { todayIn } from '../services/vacations';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';

const M = { tag: 'Pessoas & Cultura', module: 'pessoas' as const };
const Id = z.object({ id: z.string().uuid('ID inválido') });
const capsOf = async (db: DbOrTx, auth: AuthContext) => peopleCaps(auth, await peopleSettingsOf(db, auth.tenantId));

const DEFAULT_CATEGORIES = [
  { name: 'Colaboração', emoji: '🤝', description: 'Somou forças com o time e ajudou a fazer acontecer.' },
  { name: 'Iniciativa', emoji: '💡', description: 'Viu o que precisava ser feito e tomou a frente.' },
  { name: 'Excelência no atendimento', emoji: '⭐', description: 'Cuidou do cliente de um jeito que faz diferença.' },
  { name: 'Inovação', emoji: '🚀', description: 'Trouxe uma ideia nova que melhorou o nosso jeito de trabalhar.' },
  { name: 'Compartilhamento de conhecimento', emoji: '📚', description: 'Ensinou, explicou e deixou todo mundo mais forte.' },
  { name: 'Compromisso com resultados', emoji: '🎯', description: 'Foi até o fim para entregar o combinado.' },
];
async function categoriesOf(db: DbOrTx, tenantId: string) {
  let rows = await db.select().from(s.peopleRecognitionCategories).where(eq(s.peopleRecognitionCategories.tenantId, tenantId)).orderBy(asc(s.peopleRecognitionCategories.position), asc(s.peopleRecognitionCategories.name));
  if (!rows.length) {
    await db.insert(s.peopleRecognitionCategories).values(DEFAULT_CATEGORIES.map((c, position) => ({ tenantId, ...c, position }))).onConflictDoNothing();
    rows = await db.select().from(s.peopleRecognitionCategories).where(eq(s.peopleRecognitionCategories.tenantId, tenantId)).orderBy(asc(s.peopleRecognitionCategories.position));
  }
  return rows;
}

const CategoryBody = z.object({ name: z.string().trim().min(2).max(60), description: z.string().trim().max(200).nullable().default(null), emoji: z.string().trim().min(1).max(8).default('⭐'), active: z.boolean().default(true), position: z.number().int().min(0).max(100).default(0) });
const AudienceBody = z.object({ all: z.boolean().default(false), orgUnitIds: z.array(z.string().uuid()).max(100).default([]), jobTitles: z.array(z.string().trim().min(2).max(80)).max(50).default([]), teamIds: z.array(z.string().uuid()).max(100).default([]), userIds: z.array(z.string().uuid()).max(500).default([]) })
  .refine((a) => a.all || a.orgUnitIds.length || a.jobTitles.length || a.teamIds.length || a.userIds.length, { message: 'Escolha o público do comunicado' });
const AnnBody = z.object({
  title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(10_000), category: z.string().trim().max(60).nullable().default(null),
  priority: z.enum(['informativo', 'importante', 'urgente']).default('informativo'), audience: AudienceBody,
  publishAt: z.string().datetime({ offset: true }).nullable().default(null), expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  requireAck: z.boolean().default(false), pinned: z.boolean().default(true), mediaIds: z.array(z.string().uuid()).max(10).default([]),
});

/** Comunicado vale para a pessoa? (publicado, dentro da vigência e no público) */
const liveNow = () => and(eq(s.peopleAnnouncements.status, 'publicado'), or(isNull(s.peopleAnnouncements.publishAt), lte(s.peopleAnnouncements.publishAt, new Date())), or(isNull(s.peopleAnnouncements.expiresAt), gte(s.peopleAnnouncements.expiresAt, new Date())))!;
async function visibleAnnouncement(db: DbOrTx, auth: AuthContext, id: string) {
  const [a] = await db.select().from(s.peopleAnnouncements).where(and(eq(s.peopleAnnouncements.id, id), eq(s.peopleAnnouncements.tenantId, auth.tenantId))).limit(1);
  if (!a) throw notFound('Comunicado não encontrado.');
  if ((await capsOf(db, auth)).communicate) return a;
  const me = await memberOf(db, auth.tenantId, { id: auth.userId, jobTitle: auth.jobTitle, teamIds: auth.teamIds });
  const live = a.status === 'publicado' && (!a.publishAt || a.publishAt <= new Date()) && (!a.expiresAt || a.expiresAt >= new Date());
  if (!live || !inAudience(a.audience as Audience, me)) throw notFound('Comunicado não encontrado.');
  return a;
}
/** Mídia de comunicado: quem é do público (ou da Comunicação) abre. */
export async function visibleAnnouncementMedia(db: DbOrTx, auth: AuthContext, id: string) { await visibleAnnouncement(db, auth, id); }

async function attachAnnouncementMedia(db: DbOrTx, auth: AuthContext, annId: string, ids: string[]) {
  if (ids.length) {
    const own = await db.select({ id: s.peopleMedia.id }).from(s.peopleMedia).where(and(eq(s.peopleMedia.tenantId, auth.tenantId), inArray(s.peopleMedia.id, ids), isNull(s.peopleMedia.postId), isNull(s.peopleMedia.communityId), or(eq(s.peopleMedia.announcementId, annId), and(isNull(s.peopleMedia.announcementId), eq(s.peopleMedia.ownerId, auth.userId)))));
    if (own.length !== new Set(ids).size) throw unprocessable('Alguma mídia não pode ser usada neste comunicado.');
  }
  await db.update(s.peopleMedia).set({ announcementId: null }).where(and(eq(s.peopleMedia.announcementId, annId), ids.length ? sql`${s.peopleMedia.id} <> all(${sql`array[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]`})` : undefined));
  for (const [position, id] of ids.entries()) await db.update(s.peopleMedia).set({ announcementId: annId, position }).where(eq(s.peopleMedia.id, id));
}
async function annMedia(db: DbOrTx, ids: string[]) {
  if (!ids.length) return [];
  return db.select({ id: s.peopleMedia.id, announcementId: s.peopleMedia.announcementId, kind: s.peopleMedia.kind, mime: s.peopleMedia.mime, filename: s.peopleMedia.filename, sizeBytes: s.peopleMedia.sizeBytes }).from(s.peopleMedia).where(inArray(s.peopleMedia.announcementId, ids)).orderBy(asc(s.peopleMedia.position));
}

export const peopleCultureRoutes = [
  // ------------------------------------------------------------------ reconhecimento
  defineRoute({
    method: 'GET', url: '/pessoas/reconhecimentos/categorias', summary: 'Categorias de reconhecimento (ativas; administração vê todas)', ...M,
    handler: async ({ app, auth }) => {
      const rows = await categoriesOf(app.db, auth.tenantId);
      const admin = (await capsOf(app.db, auth)).administer;
      return { items: rows.filter((c) => admin || c.active).map(({ tenantId: _t, ...c }) => c), canManage: admin };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/reconhecimentos/categorias', summary: 'Cria categoria (Pessoas e Cultura)', ...M, body: CategoryBody,
    handler: async ({ app, auth, body, req, reply }) => {
      if (!(await capsOf(app.db, auth)).administer) throw forbidden('Só Pessoas e Cultura configura as categorias.');
      const [c] = await app.db.insert(s.peopleRecognitionCategories).values({ tenantId: auth.tenantId, ...body }).onConflictDoNothing().returning();
      if (!c) throw unprocessable('Já existe uma categoria com este nome.');
      await audit(app.db, req, { action: 'people.recognition.category.create', entityType: 'people_recognition_category', entityId: c.id, metadata: { name: c.name } });
      reply.code(201);
      return c;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/pessoas/reconhecimentos/categorias/:id', summary: 'Edita, ativa ou desativa categoria (Pessoas e Cultura)', ...M, params: Id, body: CategoryBody.partial(),
    handler: async ({ app, auth, params, body, req }) => {
      if (!(await capsOf(app.db, auth)).administer) throw forbidden('Só Pessoas e Cultura configura as categorias.');
      const [c] = await app.db.update(s.peopleRecognitionCategories).set(body).where(and(eq(s.peopleRecognitionCategories.id, params.id), eq(s.peopleRecognitionCategories.tenantId, auth.tenantId))).returning();
      if (!c) throw notFound('Categoria não encontrada.');
      await audit(app.db, req, { action: 'people.recognition.category.update', entityType: 'people_recognition_category', entityId: c.id, metadata: body });
      return c;
    },
  }),

  defineRoute({
    method: 'POST', url: '/pessoas/reconhecimentos', summary: 'Reconhece um colega (público vai para o feed; privado só entre os dois). Sem pontos nesta fase.', ...M,
    body: z.object({ toUserId: z.string().uuid(), categoryId: z.string().uuid(), message: z.string().trim().min(10, 'Conte em ao menos 10 caracteres o que a pessoa fez').max(1000), visibility: z.enum(['publica', 'privada']).default('publica'), communityId: z.string().uuid().nullable().default(null) }),
    rateLimit: () => ({ max: 20, timeWindow: '1 minute' }),
    handler: async ({ app, auth, body, req, reply }) => {
      if (body.toUserId === auth.userId) throw unprocessable('O reconhecimento é para um colega (não dá para reconhecer a si mesmo).', [{ path: 'toUserId', message: 'Escolha outra pessoa' }]);
      const [to] = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.id, body.toUserId), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).limit(1);
      if (!to) throw unprocessable('Colega não encontrado.', [{ path: 'toUserId', message: 'Pessoa inválida' }]);
      const cat = (await categoriesOf(app.db, auth.tenantId)).find((c) => c.id === body.categoryId && c.active);
      if (!cat) throw unprocessable('Categoria inválida.', [{ path: 'categoryId', message: 'Escolha uma categoria ativa' }]);
      // clique duplo / envio repetido: mesma pessoa, mesma categoria, nos últimos 10 minutos
      const [dup] = await app.db.select({ id: s.peopleRecognitions.id }).from(s.peopleRecognitions).where(and(eq(s.peopleRecognitions.fromUserId, auth.userId), eq(s.peopleRecognitions.toUserId, to.id), eq(s.peopleRecognitions.categoryId, cat.id), sql`${s.peopleRecognitions.createdAt} > now() - interval '10 minutes'`)).limit(1);
      if (dup) throw unprocessable('Você acabou de reconhecer esta pessoa nesta categoria.');
      if (body.communityId && body.visibility === 'publica') {
        const { c, role } = await loadCommunity(app.db, auth, body.communityId);
        if (!communityPerms(c, role, await capsOf(app.db, auth)).post) throw forbidden('Você não publica nesta comunidade.');
      }
      const r = await app.db.transaction(async (tx) => {
        const [r] = await tx.insert(s.peopleRecognitions).values({ tenantId: auth.tenantId, fromUserId: auth.userId, toUserId: to.id, categoryId: cat.id, message: body.message, visibility: body.visibility }).returning();
        if (body.visibility === 'publica') {
          const [p] = await tx.insert(s.peoplePosts).values({
            tenantId: auth.tenantId, authorId: auth.userId, kind: 'reconhecimento', audience: body.communityId ? 'comunidade' : 'organizacao', communityId: body.communityId,
            body: body.message, mentions: [to.id], status: 'publicado', publishedAt: new Date(),
            meta: { type: 'reconhecimento', recognitionId: r!.id, to: { id: to.id, name: to.name }, category: { name: cat.name, emoji: cat.emoji } }, sourceKey: `reconhecimento:${r!.id}`,
          }).returning({ id: s.peoplePosts.id });
          await tx.update(s.peopleRecognitions).set({ postId: p!.id }).where(eq(s.peopleRecognitions.id, r!.id));
          return { ...r!, postId: p!.id };
        }
        return r!;
      });
      // registro para integração futura com gamificação/medalhas (sem pontos agora)
      await audit(app.db, req, { action: 'people.recognition.create', entityType: 'people_recognition', entityId: r.id, metadata: { to: to.id, category: cat.name, visibility: body.visibility } });
      reply.code(201);
      return { id: r.id, postId: r.postId ?? null };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/reconhecimentos', summary: 'Reconhecimentos recebidos ou enviados (privados só para quem enviou e quem recebeu)', ...M,
    query: z.object({ pessoa: z.string().uuid().optional(), tipo: z.enum(['recebidos', 'enviados']).default('recebidos'), limite: z.coerce.number().int().min(1).max(100).default(30) }),
    handler: async ({ app, auth, query }) => {
      const who = query.pessoa ?? auth.userId;
      const col = query.tipo === 'recebidos' ? s.peopleRecognitions.toUserId : s.peopleRecognitions.fromUserId;
      const rows = await app.db.select({ r: s.peopleRecognitions, cat: s.peopleRecognitionCategories }).from(s.peopleRecognitions).innerJoin(s.peopleRecognitionCategories, eq(s.peopleRecognitionCategories.id, s.peopleRecognitions.categoryId))
        .where(and(eq(s.peopleRecognitions.tenantId, auth.tenantId), eq(col, who), eq(s.peopleRecognitions.status, 'valido'),
          or(eq(s.peopleRecognitions.visibility, 'publica'), eq(s.peopleRecognitions.fromUserId, auth.userId), eq(s.peopleRecognitions.toUserId, auth.userId))))
        .orderBy(desc(s.peopleRecognitions.createdAt)).limit(query.limite);
      const people = await institutionalOf(app.db, auth.tenantId, rows.flatMap((x) => [x.r.fromUserId, x.r.toUserId]));
      const card = (id: string) => (people.get(id) ? publicCard(people.get(id)!) : null);
      return { items: rows.map(({ r, cat }) => ({ id: r.id, message: r.message, visibility: r.visibility, createdAt: r.createdAt, postId: r.postId, category: { name: cat.name, emoji: cat.emoji }, from: card(r.fromUserId), to: card(r.toUserId) })) };
    },
  }),

  // ------------------------------------------------------------------ comunicados (colaborador)
  defineRoute({
    method: 'GET', url: '/pessoas/comunicados', summary: 'Comunicados vigentes para mim (prioridade, não lidos e confirmações pendentes)', ...M,
    handler: async ({ app, auth }) => {
      const me = await memberOf(app.db, auth.tenantId, { id: auth.userId, jobTitle: auth.jobTitle, teamIds: auth.teamIds });
      const rows = (await app.db.select().from(s.peopleAnnouncements).where(and(eq(s.peopleAnnouncements.tenantId, auth.tenantId), liveNow())).orderBy(desc(s.peopleAnnouncements.publishAt)).limit(100))
        .filter((a) => inAudience(a.audience as Audience, me));
      const reads = rows.length ? await app.db.select().from(s.peopleAnnouncementReads).where(and(eq(s.peopleAnnouncementReads.userId, auth.userId), inArray(s.peopleAnnouncementReads.announcementId, rows.map((a) => a.id)))) : [];
      const media = await annMedia(app.db, rows.map((a) => a.id));
      const rank: Record<string, number> = { urgente: 0, importante: 1, informativo: 2 };
      const items = rows.map((a) => {
        const r = reads.find((x) => x.announcementId === a.id);
        return {
          id: a.id, title: a.title, body: a.body, category: a.category, priority: a.priority, requireAck: a.requireAck, pinned: a.pinned, version: a.version,
          publishedAt: a.publishAt ?? a.createdAt, expiresAt: a.expiresAt, viewed: !!r, acknowledged: !!r?.acknowledgedAt && r.ackVersion === a.version,
          media: media.filter((m) => m.announcementId === a.id).map(({ announcementId: _a, ...m }) => m),
        };
      }).sort((x, y) => Number(x.acknowledged || !x.requireAck) - Number(y.acknowledged || !y.requireAck) || rank[x.priority]! - rank[y.priority]! || +new Date(y.publishedAt) - +new Date(x.publishedAt));
      return { items, unread: items.filter((i) => !i.viewed).length, pendingAck: items.filter((i) => i.requireAck && !i.acknowledged).length };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/comunicados/:id/visto', summary: 'Registra que a pessoa abriu o comunicado (alcance)', ...M, params: Id,
    handler: async ({ app, auth, params, reply }) => {
      const a = await visibleAnnouncement(app.db, auth, params.id);
      await app.db.insert(s.peopleAnnouncementReads).values({ announcementId: a.id, userId: auth.userId, tenantId: auth.tenantId }).onConflictDoNothing();
      return reply.code(204).send();
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/comunicados/:id/confirmar', summary: 'Confirma a leitura (vale para a versão atual; não é aceite formal de política)', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const a = await visibleAnnouncement(app.db, auth, params.id);
      if (!a.requireAck) throw unprocessable('Este comunicado não pede confirmação de leitura.');
      const now = new Date();
      await app.db.insert(s.peopleAnnouncementReads).values({ announcementId: a.id, userId: auth.userId, tenantId: auth.tenantId, ackVersion: a.version, acknowledgedAt: now })
        .onConflictDoUpdate({ target: [s.peopleAnnouncementReads.announcementId, s.peopleAnnouncementReads.userId], set: { ackVersion: a.version, acknowledgedAt: now } });
      return { acknowledgedAt: now, version: a.version };
    },
  }),

  // ------------------------------------------------------------------ comunicados (gestão: Comunicação Interna)
  defineRoute({
    method: 'GET', url: '/pessoas/admin/comunicados', summary: 'Comunicados (todos os status) com alcance e confirmações', ...M,
    handler: async ({ app, auth }) => {
      if (!(await capsOf(app.db, auth)).communicate) throw forbidden('Só a Comunicação Interna gerencia comunicados.');
      const rows = await app.db.select().from(s.peopleAnnouncements).where(eq(s.peopleAnnouncements.tenantId, auth.tenantId)).orderBy(desc(s.peopleAnnouncements.createdAt)).limit(200);
      const eligible = await eligibleMembers(app.db, auth.tenantId, todayIn(auth.timezone));
      const reads = rows.length ? await app.db.select().from(s.peopleAnnouncementReads).where(inArray(s.peopleAnnouncementReads.announcementId, rows.map((a) => a.id))) : [];
      const media = await annMedia(app.db, rows.map((a) => a.id));
      return {
        items: rows.map((a) => {
          const target = [...eligible.values()].filter((m) => inAudience(a.audience as Audience, m)).map((m) => m.id);
          const set = new Set(target);
          const mine = reads.filter((r) => r.announcementId === a.id && set.has(r.userId));
          const acked = mine.filter((r) => r.acknowledgedAt && r.ackVersion === a.version).length;
          return {
            ...a, media: media.filter((m) => m.announcementId === a.id).map(({ announcementId: _a, ...m }) => m),
            reach: { eligible: target.length, viewed: mine.length, acknowledged: acked, viewedPct: target.length ? mine.length / target.length : null, ackPct: a.requireAck && target.length ? acked / target.length : null },
          };
        }),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/admin/publicos', summary: 'Opções de público para comunicados: unidades/áreas, times e cargos', ...M,
    handler: async ({ app, auth }) => {
      if (!(await capsOf(app.db, auth)).communicate) throw forbidden('Só a Comunicação Interna segmenta comunicados.');
      const [units, teams, titles] = await Promise.all([
        app.db.select({ id: s.orgUnits.id, name: s.orgUnits.name, kind: s.orgUnits.kind, parentId: s.orgUnits.parentId }).from(s.orgUnits).where(and(eq(s.orgUnits.tenantId, auth.tenantId), eq(s.orgUnits.active, true))).orderBy(asc(s.orgUnits.name)),
        app.db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), eq(s.teams.active, true), isNull(s.teams.deletedAt))).orderBy(asc(s.teams.name)),
        app.db.selectDistinct({ t: s.users.jobTitle }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), sql`coalesce(trim(${s.users.jobTitle}), '') <> ''`)),
      ]);
      return { units, teams, jobTitles: titles.map((x) => x.t!).sort((a, b) => a.localeCompare(b, 'pt-BR')) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/admin/comunicados/:id/pendentes', summary: 'Quem ainda não confirmou a leitura (versão atual)', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      if (!(await capsOf(app.db, auth)).communicate) throw forbidden('Só a Comunicação Interna gerencia comunicados.');
      const [a] = await app.db.select().from(s.peopleAnnouncements).where(and(eq(s.peopleAnnouncements.id, params.id), eq(s.peopleAnnouncements.tenantId, auth.tenantId))).limit(1);
      if (!a) throw notFound('Comunicado não encontrado.');
      const target = [...(await eligibleMembers(app.db, auth.tenantId, todayIn(auth.timezone))).values()].filter((m) => inAudience(a.audience as Audience, m));
      const reads = await app.db.select().from(s.peopleAnnouncementReads).where(eq(s.peopleAnnouncementReads.announcementId, a.id));
      const ok = new Set(reads.filter((r) => r.acknowledgedAt && r.ackVersion === a.version).map((r) => r.userId));
      return { items: target.filter((m) => !ok.has(m.id)).map((m) => ({ id: m.id, name: m.name, jobTitle: m.jobTitle, viewed: reads.some((r) => r.userId === m.id) })).sort((x, y) => x.name.localeCompare(y.name, 'pt-BR')) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/admin/comunicados', summary: 'Cria comunicado (rascunho ou publicado)', ...M,
    body: AnnBody.extend({ publish: z.boolean().default(false) }),
    handler: async ({ app, auth, body, req, reply }) => {
      if (!(await capsOf(app.db, auth)).communicate) throw forbidden('Só a Comunicação Interna publica comunicados oficiais.');
      if (body.expiresAt && body.publishAt && body.expiresAt <= body.publishAt) throw unprocessable('A expiração precisa ser depois da publicação.');
      const a = await app.db.transaction(async (tx) => {
        const [a] = await tx.insert(s.peopleAnnouncements).values({
          tenantId: auth.tenantId, title: body.title, body: body.body, category: body.category, priority: body.priority, audience: body.audience,
          publishAt: body.publishAt ? new Date(body.publishAt) : body.publish ? new Date() : null, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          requireAck: body.requireAck, pinned: body.pinned, status: body.publish ? 'publicado' : 'rascunho', createdBy: auth.userId,
        }).returning();
        await attachAnnouncementMedia(tx, auth, a!.id, body.mediaIds);
        return a!;
      });
      await audit(app.db, req, { action: body.publish ? 'people.announcement.publish' : 'people.announcement.create', entityType: 'people_announcement', entityId: a.id, metadata: { title: a.title, priority: a.priority, audience: a.audience, requireAck: a.requireAck } });
      reply.code(201);
      return a;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/pessoas/admin/comunicados/:id', summary: 'Edita comunicado; mudar título/texto de um publicado gera nova versão (confirmações voltam a ser pedidas)', ...M, params: Id,
    body: AnnBody.partial().extend({ status: z.enum(['publicado', 'encerrado']).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!(await capsOf(app.db, auth)).communicate) throw forbidden('Só a Comunicação Interna gerencia comunicados.');
      const [cur] = await app.db.select().from(s.peopleAnnouncements).where(and(eq(s.peopleAnnouncements.id, params.id), eq(s.peopleAnnouncements.tenantId, auth.tenantId))).limit(1);
      if (!cur) throw notFound('Comunicado não encontrado.');
      if (cur.status === 'encerrado' && body.status !== 'publicado') throw unprocessable('Comunicado encerrado: reabra para editar.');
      const changedText = cur.status === 'publicado' && ((body.title !== undefined && body.title !== cur.title) || (body.body !== undefined && body.body !== cur.body));
      const { mediaIds, publishAt, expiresAt, status, ...rest } = body;
      const a = await app.db.transaction(async (tx) => {
        if (mediaIds) await attachAnnouncementMedia(tx, auth, cur.id, mediaIds);
        const [a] = await tx.update(s.peopleAnnouncements).set({
          ...rest, updatedBy: auth.userId, updatedAt: new Date(),
          ...(publishAt !== undefined ? { publishAt: publishAt ? new Date(publishAt) : null } : {}),
          ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
          ...(status === 'publicado' ? { status, closedAt: null, publishAt: cur.publishAt ?? new Date() } : status === 'encerrado' ? { status, closedAt: new Date() } : {}),
          ...(changedText ? { version: cur.version + 1 } : {}),
        }).where(eq(s.peopleAnnouncements.id, cur.id)).returning();
        return a!;
      });
      await audit(app.db, req, { action: status === 'encerrado' ? 'people.announcement.close' : status === 'publicado' ? 'people.announcement.publish' : 'people.announcement.update', entityType: 'people_announcement', entityId: cur.id, metadata: { version: a.version, fields: Object.keys(body) } });
      return a;
    },
  }),
];
