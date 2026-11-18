/**
 * Academia RevOps (dentro da Central de Playbooks): gestão de trilhas, conteúdos do YouTube, aprovação e publicação,
 * atribuição, catálogo, Minha Aprendizagem, página da trilha e da aula, sessões e envios do player, acompanhamento.
 * Toda permissão é conferida aqui; o progresso só cresce pelo que o servidor aceita de cada envio do player.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MIN_WATCH_PCTS, PROGRESS_METHODS, TRACK_LEVELS, TRACK_MODES, VISIBILITIES, audienceAllows, audienceErrors, creditIntervals, effectiveMinPct,
  isoAddDays, lessonDone, lockedLessons, parseYoutube, snapshotLessons, snapshotMinutes, structureErrors, trackProgress, youtubeThumb,
  type ContentState, type Interval, type LessonState, type TrackSnapshot,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { decodeImage } from '../services/images';
import { isDirector, isManager, viewerOf } from '../services/playbooks';
import { todayIn } from '../services/vacations';
import { playlistInfo, videoInfo, type VideoInfo } from '../services/youtube';
import {
  audOf, canEditTrack, canManageAcademy, contentsById, decidesVersion, eligibleUserIds, followedUserIds, metaOf, peopleContext, progressOf,
  stageFor, statusOf, trackEvent, usersWithProfiles, versionMeta, versionSnap, workingSnapshot, type TrackRow, type VersionRow,
} from '../services/academy';

const A = { tag: 'Academia', anyAuthenticated: true as const };
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TrackParams = z.object({ id: uuid, lessonId: uuid });

const TrackBody = z.object({
  title: z.string().trim().min(3).max(160), description: z.string().trim().max(2000).nullable().default(null),
  objectives: z.array(z.string().trim().min(1).max(200)).max(20).default([]), competencies: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  ownerTeamId: uuid.nullable().default(null), curatorId: uuid.nullable().default(null),
  visibility: z.enum(VISIBILITIES).default('corporativo'), teamIds: z.array(uuid).max(100).default([]), costCenterIds: z.array(uuid).max(100).default([]),
  profiles: z.array(z.string().max(30)).max(10).default([]), userIds: z.array(uuid).max(500).default([]),
  mode: z.enum(TRACK_MODES).default('livre'), level: z.enum(TRACK_LEVELS).default('basico'),
  workloadMinutes: z.number().int().min(1).max(100_000).nullable().default(null), dueDays: z.number().int().min(1).max(730).nullable().default(null),
  prerequisiteIds: z.array(uuid).max(20).default([]),
  minWatchPct: z.number().int().refine((n) => (MIN_WATCH_PCTS as readonly number[]).includes(n), 'Use 50, 75, 90 ou 100%.').default(90),
  progressMethod: z.enum(PROGRESS_METHODS).default('quantidade'), sequential: z.boolean().default(false),
  certificate: z.boolean().default(false), validityMonths: z.number().int().min(1).max(120).nullable().default(null), recycleMonths: z.number().int().min(1).max(120).nullable().default(null),
  /** capa: imagem em base64 (data URL); null remove; ausente mantém */
  cover: z.string().min(16).max(3_000_000).nullable().optional(),
});
const pctOrNull = z.number().int().refine((n) => (MIN_WATCH_PCTS as readonly number[]).includes(n), 'Use 50, 75, 90 ou 100%.').nullable().default(null);
const StructureBody = z.object({
  rowVersion: z.number().int(),
  courses: z.array(z.object({
    id: uuid.optional(), title: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).nullable().default(null), minWatchPct: pctOrNull,
    modules: z.array(z.object({
      id: uuid.optional(), title: z.string().trim().min(1).max(160), playlistId: uuid.nullable().default(null),
      lessons: z.array(z.object({ id: uuid.optional(), contentId: uuid, title: z.string().trim().max(200).nullable().default(null), description: z.string().trim().max(2000).nullable().default(null), required: z.boolean().default(true), minWatchPct: pctOrNull })).max(300),
    })).max(60),
  })).max(40),
});

async function loadTrack(db: DbOrTx, auth: AuthContext, id: string) {
  const [t] = await db.select().from(s.academyTracks).where(and(eq(s.academyTracks.id, id), eq(s.academyTracks.tenantId, auth.tenantId)));
  if (!t) throw notFound('Trilha não encontrada.');
  return t;
}
async function loadVersion(db: DbOrTx, auth: AuthContext, id: string) {
  const [v] = await db.select().from(s.academyTrackVersions).where(and(eq(s.academyTrackVersions.id, id), eq(s.academyTrackVersions.tenantId, auth.tenantId)));
  if (!v) throw notFound('Versão não encontrada.');
  return v;
}
async function mustEdit(db: DbOrTx, auth: AuthContext, t: TrackRow) {
  if (!(await canEditTrack(db, auth, t))) throw forbidden('Só quem cria a trilha, o curador, a liderança do time responsável, a Gerência e a Diretoria editam.');
}
const coverOf = (t: TrackRow, snap: TrackSnapshot | null) => {
  if (t.cover) return `/api/v1/academia/trilhas/${t.id}/capa?v=${t.rowVersion}`;
  const first = snap ? snapshotLessons(snap).find((l) => l.thumbnailUrl || l.externalId) : null;
  return first ? first.thumbnailUrl ?? (first.externalId ? youtubeThumb(first.externalId) : null) : null;
};
const minutesOf = (t: { workloadMinutes: number | null }, snap: TrackSnapshot | null) => t.workloadMinutes ?? (snap ? snapshotMinutes(snap) : 0);

/** Conteúdo do YouTube (ou link) gravado uma vez por empresa e atualizado a cada consulta. */
async function upsertVideo(db: DbOrTx, auth: AuthContext, v: VideoInfo) {
  const values = { title: v.title, channel: v.channel, thumbnailUrl: v.thumbnailUrl, state: v.state, lastSyncedAt: new Date(), ...(v.durationSeconds ? { durationSeconds: v.durationSeconds, durationSource: 'api' } : {}) };
  const [row] = await db.insert(s.academyContents).values({ tenantId: auth.tenantId, kind: 'youtube_video', externalId: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, createdBy: auth.userId, ...values })
    .onConflictDoUpdate({ target: [s.academyContents.tenantId, s.academyContents.kind, s.academyContents.externalId], targetWhere: sql`external_id is not null`, set: values }).returning();
  return row!;
}
const contentView = (c: typeof s.academyContents.$inferSelect) => ({ id: c.id, kind: c.kind, externalId: c.externalId, url: c.url, title: c.title, channel: c.channel, durationSeconds: c.durationSeconds, thumbnailUrl: c.thumbnailUrl, state: c.state as ContentState });

/** Estado de uma pessoa numa trilha: versão em que está (ou a vigente), inscrição, progresso e bloqueios. */
async function learnerState(db: DbOrTx, auth: AuthContext, t: TrackRow) {
  const [enr] = await db.select().from(s.academyEnrollments).where(and(eq(s.academyEnrollments.trackId, t.id), eq(s.academyEnrollments.userId, auth.userId)));
  const versionId = enr?.versionId ?? t.currentVersionId;
  if (!versionId) return null;
  const v = await loadVersion(db, auth, versionId);
  const snap = versionSnap(v), meta = versionMeta(v);
  const pr = await progressOf(db, auth.userId, t.id, snap, meta);
  return { enr: enr ?? null, v, snap, meta, pr };
}
async function canSee(db: DbOrTx, auth: AuthContext, t: TrackRow) {
  if (t.status !== 'publicada' && t.status !== 'arquivada') return false;
  const [enr] = await db.select({ id: s.academyEnrollments.id }).from(s.academyEnrollments).where(and(eq(s.academyEnrollments.trackId, t.id), eq(s.academyEnrollments.userId, auth.userId)));
  if (enr) return true;
  return t.status === 'publicada' && audienceAllows(audOf(t), await viewerOf(db, auth));
}

/** Inscreve (ou atribui) na versão vigente, com o prazo da trilha ou o informado. Não duplica quem já está. */
async function enroll(db: DbOrTx, auth: AuthContext, t: TrackRow, userIds: string[], source: 'livre' | 'obrigatoria' | 'atribuida', dueOn: string | null) {
  if (!t.currentVersionId || !userIds.length) return [];
  const due = dueOn ?? (t.dueDays ? isoAddDays(todayIn(auth.timezone), t.dueDays) : null);
  const rows = await db.insert(s.academyEnrollments).values(userIds.map((u) => ({ tenantId: auth.tenantId, trackId: t.id, versionId: t.currentVersionId!, userId: u, source, assignedBy: source === 'livre' ? null : auth.userId, dueOn: due })))
    .onConflictDoNothing().returning({ userId: s.academyEnrollments.userId });
  return rows.map((r) => r.userId);
}

/** Cartão do catálogo e de Minha Aprendizagem. */
async function card(db: DbOrTx, auth: AuthContext, t: TrackRow, teams: Map<string, string>, users: Map<string, string>) {
  const ls = await learnerState(db, auth, t);
  const snap = ls?.snap ?? null;
  const lessons = snap ? snapshotLessons(snap) : [];
  return {
    id: t.id, title: t.title, description: t.description, cover: coverOf(t, snap), mode: t.mode, level: t.level, minutes: minutesOf(t, snap),
    lessons: lessons.length, competencies: t.competencies, team: t.ownerTeamId ? teams.get(t.ownerTeamId) ?? null : null, curator: t.curatorId ? users.get(t.curatorId) ?? null : null,
    dueDays: t.dueDays, status: t.status,
    me: ls?.enr ? { enrolled: true, source: ls.enr.source, dueOn: ls.enr.dueOn, status: statusOf(ls.enr, ls.pr.started, auth.timezone), pct: ls.pr.progress.pct, done: ls.pr.progress.doneRequired, total: ls.pr.progress.totalRequired, nextLessonId: ls.pr.nextLessonId, completedAt: ls.enr.completedAt, lastLessonId: ls.enr.lastLessonId } : null,
  };
}
async function names(db: DbOrTx, auth: AuthContext) {
  const [teams, users] = await Promise.all([
    db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(eq(s.teams.tenantId, auth.tenantId)),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId)),
  ]);
  return { teams: new Map(teams.map((x) => [x.id, x.name])), users: new Map(users.map((x) => [x.id, x.name])) };
}

export const academyRoutes = [
  // ------------------------------------------------------------------ gestão
  defineRoute({
    method: 'GET', url: '/academia/gestao', summary: 'Academia — Gestão: trilhas que a pessoa edita ou decide, com situação, versão e números', ...A,
    handler: async ({ app, auth }) => {
      const manage = await canManageAcademy(app.db, auth);
      const all = await app.db.select().from(s.academyTracks).where(eq(s.academyTracks.tenantId, auth.tenantId)).orderBy(asc(s.academyTracks.title));
      const opens = all.length ? await app.db.select().from(s.academyTrackVersions).where(and(inArray(s.academyTrackVersions.trackId, all.map((t) => t.id)), inArray(s.academyTrackVersions.status, ['revisao_gerencia', 'homologacao_diretoria']))) : [];
      const counts = all.length ? await app.db.select({ trackId: s.academyEnrollments.trackId, n: sql<number>`count(*)::int`, done: sql<number>`count(${s.academyEnrollments.completedAt})::int` }).from(s.academyEnrollments).where(inArray(s.academyEnrollments.trackId, all.map((t) => t.id))).groupBy(s.academyEnrollments.trackId) : [];
      const vers = all.filter((t) => t.currentVersionId).length ? await app.db.select({ id: s.academyTrackVersions.id, number: s.academyTrackVersions.number }).from(s.academyTrackVersions).where(inArray(s.academyTrackVersions.id, all.filter((t) => t.currentVersionId).map((t) => t.currentVersionId!))) : [];
      const { teams, users } = await names(app.db, auth);
      const items = [];
      for (const t of all) {
        const edit = await canEditTrack(app.db, auth, t);
        const open = opens.find((v) => v.trackId === t.id) ?? null;
        const decide = !!open && decidesVersion(auth, open);
        if (!edit && !decide) continue;
        const c = counts.find((x) => x.trackId === t.id);
        items.push({
          id: t.id, title: t.title, status: t.status, mode: t.mode, team: t.ownerTeamId ? teams.get(t.ownerTeamId) ?? null : null, curator: t.curatorId ? users.get(t.curatorId) ?? null : null,
          version: vers.find((v) => v.id === t.currentVersionId)?.number ?? null, open: open ? { id: open.id, number: open.number, status: open.status, submittedBy: open.submittedBy ? users.get(open.submittedBy) ?? null : null, submittedAt: open.submittedAt } : null,
          enrolled: c?.n ?? 0, completed: c?.done ?? 0, can: { edit, decide }, updatedAt: t.updatedAt,
        });
      }
      return { items, can: { create: manage, follow: manage || isDirector(auth) || isManager(auth) } };
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/trilhas', summary: 'Cria uma trilha (rascunho)', ...A, body: TrackBody, bodyLimit: 3_200_000,
    handler: async ({ app, auth, body, req, reply }) => {
      if (!(await canManageAcademy(app.db, auth))) throw forbidden('Só a liderança, a Supervisão, a Gerência e a Diretoria criam trilhas.');
      const e = audienceErrors(body);
      if (e.length) throw unprocessable(e.join(' '));
      const img = body.cover ? decodeImage(body.cover, 2 * 1024 * 1024) : null;
      const { cover: _c, ...rest } = body;
      const [t] = await app.db.insert(s.academyTracks).values({ tenantId: auth.tenantId, ...rest, coverMime: img?.mime ?? null, cover: img?.data ?? null, createdBy: auth.userId, curatorId: body.curatorId ?? auth.userId }).returning();
      await trackEvent(app.db, auth, t!.id, null, 'criada', null);
      await audit(app.db, req, { action: 'academy_track.create', entityType: 'academy_track', entityId: t!.id, metadata: { title: t!.title } });
      reply.code(201);
      return { id: t!.id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/academia/trilhas/:id/editor', summary: 'Editor da trilha: dados, estrutura de trabalho, versões e histórico', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const t = await loadTrack(app.db, auth, params.id);
      const edit = await canEditTrack(app.db, auth, t);
      const versions = await app.db.select().from(s.academyTrackVersions).where(eq(s.academyTrackVersions.trackId, t.id)).orderBy(desc(s.academyTrackVersions.number));
      const open = versions.find((v) => v.status === 'revisao_gerencia' || v.status === 'homologacao_diretoria') ?? null;
      if (!edit && !(open && decidesVersion(auth, open))) throw forbidden('Você não edita nem decide esta trilha.');
      const snap = await workingSnapshot(app.db, t.id);
      const contents = await contentsById(app.db, snapshotLessons(snap).map((l) => l.contentId));
      const events = await app.db.select({ e: s.academyTrackEvents, actor: s.users.name }).from(s.academyTrackEvents).leftJoin(s.users, eq(s.users.id, s.academyTrackEvents.actorId)).where(eq(s.academyTrackEvents.trackId, t.id)).orderBy(desc(s.academyTrackEvents.createdAt)).limit(100);
      const current = versions.find((v) => v.id === t.currentVersionId) ?? null;
      const changed = !current || JSON.stringify(versionSnap(current)) !== JSON.stringify(snap) || JSON.stringify(versionMeta(current)) !== JSON.stringify(metaOf(t));
      const playlists = await app.db.select().from(s.academyPlaylists).where(eq(s.academyPlaylists.tenantId, auth.tenantId));
      const { cover: _c, coverMime: _m, ...track } = t;
      return {
        track: { ...track, cover: coverOf(t, snap), hasCover: !!t.cover }, structure: snap, minutes: snapshotMinutes(snap),
        contents: Object.fromEntries([...contents].map(([k, c]) => [k, contentView(c)])),
        playlists: playlists.map((p) => ({ id: p.id, playlistId: p.playlistId, title: p.title, count: p.videoIds.length, lastSyncedAt: p.lastSyncedAt })),
        versions: versions.map((v) => ({ id: v.id, number: v.number, status: v.status, submittedAt: v.submittedAt, publishedAt: v.publishedAt })),
        open: open ? { id: open.id, number: open.number, status: open.status, canDecide: decidesVersion(auth, open) } : null,
        changed, errors: [...structureErrors(snap), ...audienceErrors(audOf(t))],
        events: events.map((x) => ({ type: x.e.type, note: x.e.note, actor: x.actor, at: x.e.createdAt })),
        can: { edit, submit: edit && !open && changed },
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/academia/trilhas/:id', summary: 'Atualiza os dados da trilha (controle de concorrência)', ...A, params: IdParams,
    body: TrackBody.extend({ rowVersion: z.number().int() }), bodyLimit: 3_200_000,
    handler: async ({ app, auth, params, body, req }) => {
      const t = await loadTrack(app.db, auth, params.id);
      await mustEdit(app.db, auth, t);
      if (t.rowVersion !== body.rowVersion) throw conflict(t.rowVersion);
      const e = audienceErrors(body);
      if (body.prerequisiteIds.includes(t.id)) e.push('A trilha não pode ser pré-requisito dela mesma.');
      if (e.length) throw unprocessable(e.join(' '));
      const { cover, rowVersion: _r, ...rest } = body;
      const img = cover ? decodeImage(cover, 2 * 1024 * 1024) : null;
      await app.db.update(s.academyTracks).set({ ...rest, ...(cover === null ? { cover: null, coverMime: null } : img ? { cover: img.data, coverMime: img.mime } : {}), rowVersion: t.rowVersion + 1, updatedAt: new Date() }).where(eq(s.academyTracks.id, t.id));
      await trackEvent(app.db, auth, t.id, null, 'editada', 'Dados da trilha');
      await audit(app.db, req, { action: 'academy_track.update', entityType: 'academy_track', entityId: t.id });
      return { ok: true, rowVersion: t.rowVersion + 1 };
    },
  }),
  defineRoute({
    method: 'GET', url: '/academia/trilhas/:id/capa', summary: 'Capa da trilha', ...A, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const t = await loadTrack(app.db, auth, params.id);
      if (!t.cover || !t.coverMime) throw notFound('Trilha sem capa.');
      return reply.header('content-type', t.coverMime).header('cache-control', 'private, max-age=300').header('content-security-policy', "default-src 'none'").send(t.cover);
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/conteudos', summary: 'Resolve um link ou código do YouTube (vídeo ou playlist) ou um link externo e grava o conteúdo', ...A,
    body: z.object({ input: z.string().trim().min(3).max(500), title: z.string().trim().max(200).optional() }),
    handler: async ({ app, auth, body }) => {
      if (!(await canManageAcademy(app.db, auth))) throw forbidden('Só quem gere a Academia cadastra conteúdos.');
      const ref = parseYoutube(body.input);
      if (ref?.kind === 'video') return { kind: 'video', content: contentView(await upsertVideo(app.db, auth, await videoInfo(app.db, auth.tenantId, ref.id))) };
      if (ref?.kind === 'playlist') {
        const p = await playlistInfo(app.db, auth.tenantId, ref.id);
        const contents = [];
        for (const v of p.videos) contents.push(contentView(await upsertVideo(app.db, auth, v)));
        const vals = { title: p.title, channel: p.channel, videoIds: p.videos.map((v) => v.id), lastSyncedAt: new Date() };
        const [pl] = await app.db.insert(s.academyPlaylists).values({ tenantId: auth.tenantId, playlistId: p.id, createdBy: auth.userId, ...vals })
          .onConflictDoUpdate({ target: [s.academyPlaylists.tenantId, s.academyPlaylists.playlistId], set: vals }).returning();
        return { kind: 'playlist', playlist: { id: pl!.id, playlistId: p.id, title: p.title, channel: p.channel, missing: p.missing.length }, contents };
      }
      // link externo (material complementar): só http(s)
      let u: URL;
      try { u = new URL(body.input); } catch { throw unprocessable('Cole um link do YouTube (vídeo ou playlist), o código do vídeo, ou um endereço https.'); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw unprocessable('Use um endereço http ou https.');
      if (!body.title) throw unprocessable('Informe o título do link.');
      const [c] = await app.db.insert(s.academyContents).values({ tenantId: auth.tenantId, kind: 'link', url: u.toString(), title: body.title, state: 'disponivel', createdBy: auth.userId }).returning();
      return { kind: 'link', content: contentView(c!) };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/academia/trilhas/:id/estrutura', summary: 'Salva a estrutura de trabalho (cursos, módulos e aulas, na ordem enviada)', ...A, params: IdParams, body: StructureBody, bodyLimit: 2_000_000,
    handler: async ({ app, auth, params, body, req }) => {
      const t = await loadTrack(app.db, auth, params.id);
      await mustEdit(app.db, auth, t);
      if (t.rowVersion !== body.rowVersion) throw conflict(t.rowVersion);
      const contentIds = [...new Set(body.courses.flatMap((c) => c.modules.flatMap((m) => m.lessons.map((l) => l.contentId))))];
      if (contentIds.length) {
        const ok = await app.db.select({ id: s.academyContents.id }).from(s.academyContents).where(and(eq(s.academyContents.tenantId, auth.tenantId), inArray(s.academyContents.id, contentIds)));
        if (ok.length !== contentIds.length) throw unprocessable('Conteúdo não encontrado. Cadastre o vídeo de novo.');
      }
      // ids enviados precisam ser desta trilha (ou novos): nada de mover partes de outra trilha
      const ids = body.courses.flatMap((c) => [c.id, ...c.modules.flatMap((m) => [m.id, ...m.lessons.map((l) => l.id)])]).filter((x): x is string => !!x);
      if (new Set(ids).size !== ids.length) throw unprocessable('Estrutura com identificação repetida.');
      if (ids.length) {
        const foreign = await app.db.execute<{ n: number }>(sql`select count(*)::int as n from (
          select id, track_id from academy_courses union all select id, track_id from academy_modules union all select id, track_id from academy_lessons) x
          where x.id in ${sql.raw(`(${ids.map((i) => `'${i}'`).join(',')})`)} and x.track_id <> ${t.id}`);
        if ((foreign.rows[0]?.n ?? 0) > 0) throw unprocessable('Parte da estrutura pertence a outra trilha.');
      }
      await app.db.transaction(async (tx) => {
        await tx.delete(s.academyCourses).where(eq(s.academyCourses.trackId, t.id));
        for (const [ci, c] of body.courses.entries()) {
          const [cr] = await tx.insert(s.academyCourses).values({ ...(c.id ? { id: c.id } : {}), tenantId: auth.tenantId, trackId: t.id, title: c.title, description: c.description, minWatchPct: c.minWatchPct, position: ci }).returning({ id: s.academyCourses.id });
          for (const [mi, m] of c.modules.entries()) {
            const [mr] = await tx.insert(s.academyModules).values({ ...(m.id ? { id: m.id } : {}), tenantId: auth.tenantId, trackId: t.id, courseId: cr!.id, title: m.title, playlistId: m.playlistId, position: mi }).returning({ id: s.academyModules.id });
            if (m.lessons.length) await tx.insert(s.academyLessons).values(m.lessons.map((l, li) => ({ ...(l.id ? { id: l.id } : {}), tenantId: auth.tenantId, trackId: t.id, moduleId: mr!.id, contentId: l.contentId, title: l.title, description: l.description, required: l.required, minWatchPct: l.minWatchPct, position: li })));
          }
        }
        await tx.update(s.academyTracks).set({ rowVersion: t.rowVersion + 1, updatedAt: new Date() }).where(eq(s.academyTracks.id, t.id));
      });
      await trackEvent(app.db, auth, t.id, null, 'editada', 'Estrutura (cursos, módulos e aulas)');
      await audit(app.db, req, { action: 'academy_track.structure', entityType: 'academy_track', entityId: t.id, metadata: { lessons: contentIds.length } });
      return { ok: true, rowVersion: t.rowVersion + 1 };
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/trilhas/:id/sincronizar', summary: 'Confere de novo os vídeos (situação e duração) e as playlists da trilha no YouTube', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const t = await loadTrack(app.db, auth, params.id);
      await mustEdit(app.db, auth, t);
      const snap = await workingSnapshot(app.db, t.id);
      const vids = [...new Set(snapshotLessons(snap).filter((l) => l.kind === 'youtube_video' && l.externalId).map((l) => l.externalId!))].slice(0, 300);
      const changed: { title: string; state: string }[] = [];
      for (const id of vids) {
        let info: VideoInfo;
        try { info = await videoInfo(app.db, auth.tenantId, id); } catch { info = { id, title: id, channel: null, thumbnailUrl: youtubeThumb(id), durationSeconds: null, state: 'removido', source: 'oembed' }; }
        const [before] = await app.db.select({ state: s.academyContents.state, title: s.academyContents.title }).from(s.academyContents).where(and(eq(s.academyContents.tenantId, auth.tenantId), eq(s.academyContents.kind, 'youtube_video'), eq(s.academyContents.externalId, id)));
        const row = await upsertVideo(app.db, auth, before && info.state === 'removido' ? { ...info, title: before.title } : info);
        if (before && before.state !== row.state) changed.push({ title: row.title, state: row.state });
      }
      const mods = await app.db.select({ m: s.academyModules, p: s.academyPlaylists }).from(s.academyModules).innerJoin(s.academyPlaylists, eq(s.academyPlaylists.id, s.academyModules.playlistId)).where(eq(s.academyModules.trackId, t.id));
      const playlists = [];
      for (const { m, p } of mods) {
        try {
          const info = await playlistInfo(app.db, auth.tenantId, p.playlistId);
          const now = info.videos.map((v) => v.id);
          const inModule = snap.courses.flatMap((c) => c.modules).find((x) => x.id === m.id)?.lessons.map((l) => l.externalId) ?? [];
          await app.db.update(s.academyPlaylists).set({ videoIds: now, title: info.title, lastSyncedAt: new Date() }).where(eq(s.academyPlaylists.id, p.id));
          for (const v of info.videos) await upsertVideo(app.db, auth, v);
          playlists.push({ module: m.title, added: now.filter((x) => !inModule.includes(x)).length, removed: inModule.filter((x) => x && !now.includes(x)).length });
        } catch (e) { playlists.push({ module: m.title, error: (e as Error).message }); }
      }
      await trackEvent(app.db, auth, t.id, null, 'sincronizada', `${vids.length} vídeo(s) conferido(s)`);
      return { videos: vids.length, changed, playlists };
    },
  }),

  // ------------------------------------------------------------------ aprovação e publicação
  defineRoute({
    method: 'POST', url: '/academia/trilhas/:id/enviar', summary: 'Envia a trilha para aprovação (Gerência; se quem envia é Gerência ou Diretoria, a Diretoria)', ...A, params: IdParams,
    body: z.object({ note: z.string().trim().max(1000).nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      const t = await loadTrack(app.db, auth, params.id);
      await mustEdit(app.db, auth, t);
      const snap = await workingSnapshot(app.db, t.id);
      const e = [...structureErrors(snap), ...audienceErrors(audOf(t))];
      const contents = await contentsById(app.db, snapshotLessons(snap).map((l) => l.contentId));
      if (snapshotLessons(snap).some((l) => l.required && l.kind === 'youtube_video' && ['privado', 'removido', 'sem_incorporacao', 'indisponivel'].includes(contents.get(l.contentId)?.state ?? ''))) e.push('Há aula obrigatória com vídeo indisponível (privado, removido ou com incorporação desligada): troque ou marque como opcional.');
      if (e.length) throw unprocessable(e.join(' '));
      const [last] = await app.db.select({ n: sql<number>`coalesce(max(${s.academyTrackVersions.number}), 0)::int` }).from(s.academyTrackVersions).where(eq(s.academyTrackVersions.trackId, t.id));
      const status = stageFor(auth.profiles);
      let v: VersionRow;
      try {
        [v] = (await app.db.insert(s.academyTrackVersions).values({ tenantId: auth.tenantId, trackId: t.id, number: (last?.n ?? 0) + 1, status, structure: snap as unknown as Record<string, unknown>, meta: metaOf(t) as unknown as Record<string, unknown>, stages: [status === 'revisao_gerencia' ? 'gerencia' : 'diretoria'], submittedBy: auth.userId, submittedAt: new Date() }).returning()) as [VersionRow];
      } catch { throw unprocessable('Já existe uma versão desta trilha em aprovação.'); }
      if (t.status === 'rascunho') await app.db.update(s.academyTracks).set({ status, updatedAt: new Date() }).where(eq(s.academyTracks.id, t.id));
      const approvers = await usersWithProfiles(app.db, auth.tenantId, status === 'revisao_gerencia' ? ['gerencia', 'diretoria'] : ['diretoria']);
      await trackEvent(app.db, auth, t.id, v.id, 'academia_enviada', body.note, approvers, t.title);
      await audit(app.db, req, { action: 'academy_track.submit', entityType: 'academy_track', entityId: t.id, metadata: { version: v.number } });
      return { id: v.id, number: v.number, status: v.status };
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/versoes/:id/decidir', summary: 'Aprova (publica), pede ajustes ou rejeita a versão; quem enviou não decide', ...A, params: IdParams,
    body: z.object({ decision: z.enum(['aprovar', 'ajustes', 'rejeitar']), note: z.string().trim().max(1000).nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      const v = await loadVersion(app.db, auth, params.id);
      if (!decidesVersion(auth, v)) throw forbidden(v.submittedBy === auth.userId ? 'Quem enviou não aprova o próprio envio.' : v.status === 'homologacao_diretoria' ? 'Esta versão espera a Diretoria.' : 'Esta versão não está em aprovação ou não é da sua alçada.');
      if (body.decision !== 'aprovar' && !body.note) throw unprocessable('Explique o motivo para pedir ajustes ou rejeitar.');
      const t = await loadTrack(app.db, auth, v.trackId);
      let enrolled: string[] = [];
      await app.db.transaction(async (tx) => {
        if (body.decision === 'aprovar') {
          await tx.update(s.academyTrackVersions).set({ status: 'substituida' }).where(and(eq(s.academyTrackVersions.trackId, t.id), eq(s.academyTrackVersions.status, 'publicada')));
          await tx.update(s.academyTrackVersions).set({ status: 'publicada', publishedAt: new Date() }).where(eq(s.academyTrackVersions.id, v.id));
          await tx.update(s.academyTracks).set({ status: 'publicada', currentVersionId: v.id, updatedAt: new Date() }).where(eq(s.academyTracks.id, t.id));
        } else {
          await tx.update(s.academyTrackVersions).set({ status: body.decision === 'ajustes' ? 'ajustes' : 'rejeitada' }).where(eq(s.academyTrackVersions.id, v.id));
          if (!t.currentVersionId) await tx.update(s.academyTracks).set({ status: 'rascunho', updatedAt: new Date() }).where(eq(s.academyTracks.id, t.id));
        }
      });
      if (body.decision === 'aprovar' && t.mode === 'obrigatoria') {
        const fresh = await loadTrack(app.db, auth, t.id);
        enrolled = await enroll(app.db, auth, fresh, await eligibleUserIds(app.db, auth.tenantId, fresh), 'obrigatoria', null);
        if (enrolled.length) await trackEvent(app.db, auth, t.id, v.id, 'academia_obrigatoria', `${enrolled.length} pessoa(s) receberam a trilha obrigatória`, enrolled, t.title);
      }
      const type = body.decision === 'aprovar' ? 'academia_publicada' : body.decision === 'ajustes' ? 'academia_ajustes' : 'academia_rejeitada';
      await trackEvent(app.db, auth, t.id, v.id, type, body.note, [v.submittedBy, t.createdBy, t.curatorId], t.title);
      await audit(app.db, req, { action: `academy_track.${body.decision}`, entityType: 'academy_track', entityId: t.id, metadata: { version: v.number } });
      return { ok: true, enrolled: enrolled.length };
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/trilhas/:id/arquivar', summary: 'Arquiva a trilha (sai do catálogo; quem está inscrito mantém o histórico)', ...A, params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      const t = await loadTrack(app.db, auth, params.id);
      await mustEdit(app.db, auth, t);
      await app.db.update(s.academyTracks).set({ status: t.status === 'arquivada' ? (t.currentVersionId ? 'publicada' : 'rascunho') : 'arquivada', updatedAt: new Date() }).where(eq(s.academyTracks.id, t.id));
      await trackEvent(app.db, auth, t.id, null, t.status === 'arquivada' ? 'reativada' : 'arquivada', null);
      await audit(app.db, req, { action: 'academy_track.archive', entityType: 'academy_track', entityId: t.id });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/trilhas/:id/atribuir', summary: 'Atribui a trilha publicada a pessoas e times (com prazo)', ...A, params: IdParams,
    body: z.object({ userIds: z.array(uuid).max(500).default([]), teamIds: z.array(uuid).max(50).default([]), dueOn: day.nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      const t = await loadTrack(app.db, auth, params.id);
      if (t.status !== 'publicada' || !t.currentVersionId) throw unprocessable('Só trilhas publicadas podem ser atribuídas.');
      const people = await peopleContext(app.db, auth.tenantId);
      const target = [...new Set([...body.userIds, ...people.filter((p) => p.teamIds.some((x) => body.teamIds.includes(x))).map((p) => p.id)])].filter((u) => people.some((p) => p.id === u));
      if (!target.length) throw unprocessable('Escolha ao menos uma pessoa ou time com pessoas ativas.');
      if (body.dueOn && body.dueOn < todayIn(auth.timezone)) throw unprocessable('O prazo não pode estar no passado.');
      if (!(await canEditTrack(app.db, auth, t))) {
        const f = await followedUserIds(app.db, auth);
        if (!f.all && target.some((u) => !f.ids.has(u))) throw forbidden('A liderança atribui só às pessoas dos times que lidera.');
        if (!f.all && !f.ids.size) throw forbidden('Você não atribui trilhas.');
      }
      const added = await enroll(app.db, auth, t, target, 'atribuida', body.dueOn);
      if (added.length) await trackEvent(app.db, auth, t.id, t.currentVersionId, 'academia_atribuida', `${added.length} pessoa(s)`, added, t.title);
      await audit(app.db, req, { action: 'academy_track.assign', entityType: 'academy_track', entityId: t.id, metadata: { added: added.length, already: target.length - added.length } });
      return { added: added.length, already: target.length - added.length };
    },
  }),

  // ------------------------------------------------------------------ aprendizagem
  defineRoute({
    method: 'GET', url: '/academia/catalogo', summary: 'Trilhas de Aprendizagem: as publicadas que a pessoa pode ver', ...A,
    query: z.object({ q: z.string().trim().max(120).optional() }),
    handler: async ({ app, auth, query }) => {
      const v = await viewerOf(app.db, auth);
      const all = await app.db.select().from(s.academyTracks).where(and(eq(s.academyTracks.tenantId, auth.tenantId), eq(s.academyTracks.status, 'publicada'))).orderBy(asc(s.academyTracks.title));
      const mine = await app.db.select({ trackId: s.academyEnrollments.trackId }).from(s.academyEnrollments).where(eq(s.academyEnrollments.userId, auth.userId));
      const q = query.q?.toLowerCase();
      const rows = all.filter((t) => (audienceAllows(audOf(t), v) || mine.some((m) => m.trackId === t.id)) && (!q || `${t.title} ${t.description ?? ''} ${t.competencies.join(' ')}`.toLowerCase().includes(q)));
      const n = await names(app.db, auth);
      return { items: await Promise.all(rows.map((t) => card(app.db, auth, t, n.teams, n.users))) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/academia/minha', summary: 'Minha Aprendizagem: em andamento, obrigatórias, recomendadas e concluídas', ...A,
    handler: async ({ app, auth }) => {
      const enr = await app.db.select({ t: s.academyTracks }).from(s.academyEnrollments).innerJoin(s.academyTracks, eq(s.academyTracks.id, s.academyEnrollments.trackId)).where(eq(s.academyEnrollments.userId, auth.userId));
      const n = await names(app.db, auth);
      const cards = await Promise.all(enr.map(({ t }) => card(app.db, auth, t, n.teams, n.users)));
      const v = await viewerOf(app.db, auth);
      const free = await app.db.select().from(s.academyTracks).where(and(eq(s.academyTracks.tenantId, auth.tenantId), eq(s.academyTracks.status, 'publicada'), eq(s.academyTracks.mode, 'livre')));
      const recommended = await Promise.all(free.filter((t) => audienceAllows(audOf(t), v) && !enr.some((e) => e.t.id === t.id)).slice(0, 6).map((t) => card(app.db, auth, t, n.teams, n.users)));
      const st = (c: (typeof cards)[number]) => c.me?.status;
      const next = cards.filter((c) => c.me && c.me.status !== 'concluida' && c.me.nextLessonId).sort((a, b) => (a.me!.dueOn ?? '9999').localeCompare(b.me!.dueOn ?? '9999'))[0] ?? null;
      return {
        inProgress: cards.filter((c) => st(c) === 'em_andamento' || st(c) === 'atrasada'),
        required: cards.filter((c) => c.me && c.me.source !== 'livre' && st(c) !== 'concluida'),
        notStarted: cards.filter((c) => st(c) === 'nao_iniciada'),
        completed: cards.filter((c) => st(c) === 'concluida'),
        recommended,
        next: next ? { trackId: next.id, title: next.title, lessonId: next.me!.nextLessonId } : null,
        totals: { enrolled: cards.length, completed: cards.filter((c) => st(c) === 'concluida').length, late: cards.filter((c) => st(c) === 'atrasada').length, minutes: cards.filter((c) => st(c) === 'concluida').reduce((t, c) => t + c.minutes, 0) },
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/trilhas/:id/inscrever', summary: 'Inscreve a pessoa na trilha publicada que ela pode ver', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const t = await loadTrack(app.db, auth, params.id);
      if (t.status !== 'publicada' || !(await canSee(app.db, auth, t))) throw forbidden('Esta trilha não está disponível para você.');
      const pre = t.prerequisiteIds.length ? await app.db.select({ trackId: s.academyEnrollments.trackId, done: s.academyEnrollments.completedAt }).from(s.academyEnrollments).where(and(eq(s.academyEnrollments.userId, auth.userId), inArray(s.academyEnrollments.trackId, t.prerequisiteIds))) : [];
      if (t.prerequisiteIds.some((p) => !pre.find((x) => x.trackId === p)?.done)) throw unprocessable('Conclua antes as trilhas que são pré-requisito.');
      const added = await enroll(app.db, auth, t, [auth.userId], 'livre', null);
      if (added.length) await app.db.insert(s.academyTrackEvents).values({ tenantId: auth.tenantId, trackId: t.id, versionId: t.currentVersionId, type: 'inscricao', note: null, actorId: auth.userId });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/academia/trilhas/:id', summary: 'Página da trilha: dados, jornada (cursos, módulos e aulas) e o progresso da pessoa', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const t = await loadTrack(app.db, auth, params.id);
      if (!(await canSee(app.db, auth, t))) throw forbidden('Esta trilha não está disponível para você.');
      const ls = await learnerState(app.db, auth, t);
      if (!ls) throw notFound('Trilha sem versão publicada.');
      const n = await names(app.db, auth);
      const preTracks = t.prerequisiteIds.length ? await app.db.select({ id: s.academyTracks.id, title: s.academyTracks.title }).from(s.academyTracks).where(inArray(s.academyTracks.id, t.prerequisiteIds)) : [];
      const preDone = t.prerequisiteIds.length ? await app.db.select({ trackId: s.academyEnrollments.trackId, done: s.academyEnrollments.completedAt }).from(s.academyEnrollments).where(and(eq(s.academyEnrollments.userId, auth.userId), inArray(s.academyEnrollments.trackId, t.prerequisiteIds))) : [];
      const lessonView = (l: ReturnType<typeof snapshotLessons>[number]) => {
        const st = ls.pr.byId.get(l.id)!;
        return { id: l.id, title: l.title, kind: l.kind, durationSeconds: st.durationSeconds, thumbnailUrl: l.thumbnailUrl ?? (l.externalId ? youtubeThumb(l.externalId) : null), required: l.required, pct: st.pct, done: st.done, locked: ls.pr.locked.has(l.id), available: st.available, state: st.state, minPct: st.minPct };
      };
      return {
        track: { id: t.id, title: ls.meta.title, description: ls.meta.description, cover: coverOf(t, ls.snap), mode: t.mode, level: ls.meta.level, minutes: minutesOf({ workloadMinutes: ls.meta.workloadMinutes }, ls.snap), objectives: ls.meta.objectives, competencies: ls.meta.competencies, team: t.ownerTeamId ? n.teams.get(t.ownerTeamId) ?? null : null, curator: t.curatorId ? n.users.get(t.curatorId) ?? null : null, minWatchPct: ls.meta.minWatchPct, progressMethod: ls.meta.progressMethod, sequential: ls.meta.sequential, version: ls.v.number, archived: t.status === 'arquivada' },
        courses: ls.snap.courses.map((c) => ({ id: c.id, title: c.title, description: c.description, modules: c.modules.map((m) => ({ id: m.id, title: m.title, lessons: m.lessons.map((l) => lessonView({ ...l, courseId: c.id, moduleId: m.id, courseMinPct: c.minWatchPct })) })) })),
        prerequisites: preTracks.map((p) => ({ id: p.id, title: p.title, done: !!preDone.find((x) => x.trackId === p.id)?.done })),
        me: ls.enr ? { enrolled: true, status: statusOf(ls.enr, ls.pr.started, auth.timezone), dueOn: ls.enr.dueOn, source: ls.enr.source, completedAt: ls.enr.completedAt, lastLessonId: ls.enr.lastLessonId } : null,
        progress: ls.pr.progress, nextLessonId: ls.pr.nextLessonId,
        newerVersion: !!ls.enr && t.currentVersionId !== ls.enr.versionId,
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/academia/trilhas/:id/aulas/:lessonId', summary: 'Página da aula: vídeo, descrição, lista do módulo, progresso e retomada', ...A, params: TrackParams,
    handler: async ({ app, auth, params }) => {
      const t = await loadTrack(app.db, auth, params.id);
      const ls = await learnerState(app.db, auth, t);
      if (!ls?.enr) throw forbidden('Inscreva-se na trilha para assistir às aulas.');
      const all = snapshotLessons(ls.snap);
      const idx = all.findIndex((l) => l.id === params.lessonId);
      if (idx < 0) throw notFound('Aula não encontrada nesta versão da trilha.');
      const l = all[idx]!;
      const st = ls.pr.byId.get(l.id)!;
      const course = ls.snap.courses.find((c) => c.id === l.courseId)!;
      const mod = course.modules.find((m) => m.id === l.moduleId)!;
      const [ct] = await app.db.select().from(s.academyContents).where(eq(s.academyContents.id, l.contentId));
      const item = (x: (typeof all)[number]) => { const p = ls.pr.byId.get(x.id)!; return { id: x.id, title: x.title, durationSeconds: p.durationSeconds, pct: p.pct, done: p.done, locked: ls.pr.locked.has(x.id), available: p.available, required: x.required }; };
      const materials = mod.lessons.filter((x) => x.kind === 'link').map((x) => ({ id: x.id, title: x.title, url: x.url }));
      return {
        track: { id: t.id, title: ls.meta.title, progress: ls.pr.progress, sequential: ls.meta.sequential },
        lesson: { id: l.id, title: l.title, description: l.description, kind: l.kind, videoId: l.kind === 'youtube_video' ? l.externalId : null, url: l.url, required: l.required, minPct: st.minPct, locked: ls.pr.locked.has(l.id), state: st.state, available: st.available, durationSeconds: st.durationSeconds, channel: ct?.channel ?? null },
        progress: { pct: st.pct, watchedSeconds: Math.round(st.watchedSeconds), done: st.done, resumeAt: st.done ? 0 : st.lastPositionSeconds },
        course: { id: course.id, title: course.title }, module: { id: mod.id, title: mod.title, lessons: mod.lessons.filter((x) => x.kind !== 'link').map((x) => item({ ...x, courseId: course.id, moduleId: mod.id, courseMinPct: course.minWatchPct })) },
        modules: ls.snap.courses.flatMap((c) => c.modules.map((m) => { const first = m.lessons.find((x) => x.kind !== 'link'); return { id: m.id, title: m.title, course: c.title, firstLessonId: first?.id ?? null, done: m.lessons.filter((x) => x.required && ls.pr.byId.get(x.id)?.available).every((x) => ls.pr.byId.get(x.id)?.done) }; })),
        materials,
        prevId: all.slice(0, idx).reverse().find((x) => x.kind !== 'link')?.id ?? null,
        nextId: all.slice(idx + 1).find((x) => x.kind !== 'link')?.id ?? null,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/trilhas/:id/aulas/:lessonId/sessao', summary: 'Abre (ou retoma) a sessão do player desta aba para a aula', ...A, params: TrackParams,
    body: z.object({ clientSessionId: z.string().trim().min(8).max(64), device: z.string().trim().max(120).optional() }),
    handler: async ({ app, auth, params, body }) => {
      const t = await loadTrack(app.db, auth, params.id);
      const ls = await learnerState(app.db, auth, t);
      if (!ls?.enr) throw forbidden('Inscreva-se na trilha para assistir às aulas.');
      const l = snapshotLessons(ls.snap).find((x) => x.id === params.lessonId);
      if (!l) throw notFound('Aula não encontrada nesta versão da trilha.');
      if (ls.pr.locked.has(l.id)) throw unprocessable('Conclua as aulas obrigatórias anteriores para liberar esta.');
      const [sess] = await app.db.insert(s.academyPlaySessions).values({ tenantId: auth.tenantId, userId: auth.userId, lessonId: l.id, clientSessionId: body.clientSessionId, device: body.device ?? null })
        .onConflictDoUpdate({ target: [s.academyPlaySessions.userId, s.academyPlaySessions.lessonId, s.academyPlaySessions.clientSessionId], set: { device: body.device ?? null } }).returning();
      await app.db.insert(s.academyLessonProgress).values({ tenantId: auth.tenantId, userId: auth.userId, lessonId: l.id, trackId: t.id }).onConflictDoNothing();
      await app.db.update(s.academyEnrollments).set({ lastLessonId: l.id, ...(ls.enr.startedAt ? {} : { startedAt: new Date() }) }).where(eq(s.academyEnrollments.id, ls.enr.id));
      const st = ls.pr.byId.get(l.id)!;
      return { sessionId: sess!.id, lastSeq: sess!.lastSeq, resumeAt: st.done ? 0 : st.lastPositionSeconds, serverTime: new Date().toISOString() };
    },
  }),
  defineRoute({
    method: 'POST', url: '/academia/sessoes/:id/batida', summary: 'Envio do player: trechos assistidos e posição. Idempotente por sessão e sequência; o servidor limita o crédito pelo relógio', ...A, params: IdParams,
    body: z.object({
      seq: z.number().int().min(1).max(10_000_000),
      intervals: z.array(z.tuple([z.number().min(0).max(86_400), z.number().min(0).max(86_400)])).max(200),
      position: z.number().min(0).max(86_400), duration: z.number().min(1).max(86_400).nullable().default(null), ended: z.boolean().default(false),
    }),
    handler: async ({ app, auth, params, body }) => {
      const [sess] = await app.db.select().from(s.academyPlaySessions).where(and(eq(s.academyPlaySessions.id, params.id), eq(s.academyPlaySessions.userId, auth.userId)));
      if (!sess) throw notFound('Sessão do player não encontrada. Recarregue a aula.');
      return app.db.transaction(async (tx) => {
        const [beat] = await tx.insert(s.academyWatchBeats).values({ tenantId: auth.tenantId, sessionId: sess.id, seq: body.seq, intervals: body.intervals as Interval[], position: Math.round(body.position * 1000) }).onConflictDoNothing().returning({ id: s.academyWatchBeats.id });
        const [p0] = await tx.select().from(s.academyLessonProgress).where(and(eq(s.academyLessonProgress.userId, auth.userId), eq(s.academyLessonProgress.lessonId, sess.lessonId))).for('update');
        if (!p0) throw notFound('Progresso não encontrado. Recarregue a aula.');
        const [t] = await tx.select().from(s.academyTracks).where(eq(s.academyTracks.id, p0.trackId));
        const [enr] = await tx.select().from(s.academyEnrollments).where(and(eq(s.academyEnrollments.trackId, p0.trackId), eq(s.academyEnrollments.userId, auth.userId)));
        if (!t || !enr) throw forbidden('Inscrição não encontrada.');
        const [v] = await tx.select().from(s.academyTrackVersions).where(eq(s.academyTrackVersions.id, enr.versionId));
        const snap = versionSnap(v!), meta = versionMeta(v!);
        const l = snapshotLessons(snap).find((x) => x.id === sess.lessonId)!;
        const [ct] = await tx.select().from(s.academyContents).where(eq(s.academyContents.id, l.contentId)).for('update');
        let dur = ct?.durationSeconds ?? null;
        // sem a Data API, a duração vem do player na primeira reprodução (uma vez; depois só confere)
        if (!dur && body.duration && ct) { dur = Math.round(body.duration); await tx.update(s.academyContents).set({ durationSeconds: dur, durationSource: 'player' }).where(eq(s.academyContents.id, ct.id)); }
        const minPct = effectiveMinPct(l.minWatchPct, snap.courses.find((c) => c.modules.some((m) => m.id === l.moduleId))?.minWatchPct ?? null, meta.minWatchPct);
        if (!beat) {
          const w = p0.watchedMs / 1000;
          return { duplicate: true, credited: 0, watchedSeconds: Math.round(w), pct: dur ? Math.min(100, Math.round((w / dur) * 1000) / 10) : 0, done: !!p0.completedAt, minPct };
        }
        const now = new Date();
        const base = p0.lastCreditAt && p0.lastCreditAt > sess.startedAt ? p0.lastCreditAt : sess.startedAt;
        const cr = creditIntervals({ existing: p0.intervals as Interval[], incoming: body.intervals as Interval[], durationSeconds: dur, elapsedSeconds: (now.getTime() - base.getTime()) / 1000 });
        const done = !!p0.completedAt || lessonDone(cr.watchedSeconds, dur, minPct);
        const pos = Math.round(Math.min(body.position, dur ?? body.position) * 1000);
        await tx.update(s.academyLessonProgress).set({ intervals: cr.merged, watchedMs: Math.round(cr.watchedSeconds * 1000), durationSeconds: dur, lastPositionMs: body.ended ? 0 : pos, lastCreditAt: now, updatedAt: now, ...(done && !p0.completedAt ? { completedAt: now } : {}) })
          .where(and(eq(s.academyLessonProgress.userId, auth.userId), eq(s.academyLessonProgress.lessonId, sess.lessonId)));
        await tx.update(s.academyWatchBeats).set({ creditedMs: Math.round(cr.credited * 1000), rejectedMs: Math.round(cr.rejected * 1000) }).where(eq(s.academyWatchBeats.id, beat.id));
        await tx.update(s.academyPlaySessions).set({ lastSeq: sql`greatest(${s.academyPlaySessions.lastSeq}, ${body.seq})`, lastBeatAt: now }).where(eq(s.academyPlaySessions.id, sess.id));
        // conclusão da trilha (audiovisual): quando todas as obrigatórias disponíveis estão concluídas
        const pr = await progressOf(tx, auth.userId, t.id, snap, meta);
        let trackDone = !!enr.completedAt;
        if (pr.progress.videoComplete && !enr.completedAt) {
          await tx.update(s.academyEnrollments).set({ completedAt: now }).where(and(eq(s.academyEnrollments.id, enr.id), isNull(s.academyEnrollments.completedAt)));
          await tx.insert(s.academyTrackEvents).values({ tenantId: auth.tenantId, trackId: t.id, versionId: enr.versionId, type: 'concluida', note: null, actorId: auth.userId });
          trackDone = true;
        }
        return {
          duplicate: false, credited: cr.credited, rejected: cr.rejected, watchedSeconds: Math.round(cr.watchedSeconds), pct: dur ? Math.min(100, Math.round((cr.watchedSeconds / dur) * 1000) / 10) : 0,
          done, minPct, durationSeconds: dur, track: { pct: pr.progress.pct, complete: trackDone, nextLessonId: pr.nextLessonId },
        };
      });
    },
  }),

  // ------------------------------------------------------------------ acompanhamento
  defineRoute({
    method: 'GET', url: '/academia/acompanhamento', summary: 'Acompanhamento da liderança: elegíveis, inscritos, adesão, conclusão, horas e atrasos; pessoa a pessoa na trilha escolhida', ...A,
    query: z.object({ trilha: uuid.optional(), time: uuid.optional() }),
    handler: async ({ app, auth, query }) => {
      const f = await followedUserIds(app.db, auth);
      if (!f.all && !f.ids.size) throw forbidden('O acompanhamento é da liderança, da Gerência e da Diretoria.');
      const people = await peopleContext(app.db, auth.tenantId);
      const scope = people.filter((p) => (f.all || f.ids.has(p.id)) && (!query.time || p.teamIds.includes(query.time)));
      const scopeIds = new Set(scope.map((p) => p.id));
      const tracks = await app.db.select().from(s.academyTracks).where(and(eq(s.academyTracks.tenantId, auth.tenantId), inArray(s.academyTracks.status, ['publicada', 'arquivada']))).orderBy(asc(s.academyTracks.title));
      const ids = tracks.map((t) => t.id);
      const [enrs, progress, versions, teams] = await Promise.all([
        ids.length ? app.db.select().from(s.academyEnrollments).where(inArray(s.academyEnrollments.trackId, ids)) : Promise.resolve([]),
        ids.length ? app.db.select().from(s.academyLessonProgress).where(inArray(s.academyLessonProgress.trackId, ids)) : Promise.resolve([]),
        ids.length ? app.db.select().from(s.academyTrackVersions).where(inArray(s.academyTrackVersions.trackId, ids)) : Promise.resolve([]),
        app.db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(eq(s.teams.tenantId, auth.tenantId)),
      ]);
      const contents = await contentsById(app.db, versions.flatMap((v) => snapshotLessons(versionSnap(v)).map((l) => l.contentId)));
      const today = todayIn(auth.timezone);
      const personIn = (t: (typeof tracks)[number], e: (typeof enrs)[number]) => {
        const v = versions.find((x) => x.id === e.versionId)!;
        const snap = versionSnap(v), meta = versionMeta(v);
        const mine = progress.filter((p) => p.userId === e.userId && p.trackId === t.id);
        const states: LessonState[] = snapshotLessons(snap).map((l) => {
          const p = mine.find((x) => x.lessonId === l.id), ct = contents.get(l.contentId);
          const state = (ct?.state ?? 'desconhecido') as ContentState;
          return { lessonId: l.id, required: l.required, available: l.kind === 'link' || ['disponivel', 'desconhecido'].includes(state), durationSeconds: ct?.durationSeconds ?? l.durationSeconds, watchedSeconds: (p?.watchedMs ?? 0) / 1000, done: !!p?.completedAt };
        });
        const tp = trackProgress(states, meta.progressMethod);
        const last = mine.reduce<Date | null>((a, p) => (!a || p.updatedAt > a ? p.updatedAt : a), null);
        return { pct: tp.pct, watchedSeconds: mine.reduce((a, p) => a + p.watchedMs / 1000, 0), lastAt: last, status: statusOf(e, mine.some((p) => p.watchedMs > 0) || !!e.startedAt, auth.timezone) };
      };
      const summary = tracks.map((t) => {
        const eligible = new Set(t.mode === 'atribuida' ? [] : scope.filter((p) => audienceAllows(audOf(t), p.viewer)).map((p) => p.id));
        const es = enrs.filter((e) => e.trackId === t.id && scopeIds.has(e.userId));
        for (const e of es) eligible.add(e.userId);
        const per = es.map((e) => personIn(t, e));
        const done = per.filter((x) => x.status === 'concluida').length;
        return {
          id: t.id, title: t.title, mode: t.mode, archived: t.status === 'arquivada',
          eligible: eligible.size, enrolled: es.length, adhesionPct: eligible.size ? Math.round((es.length / eligible.size) * 1000) / 10 : null,
          completed: done, completionPct: es.length ? Math.round((done / es.length) * 1000) / 10 : null,
          inProgress: per.filter((x) => x.status === 'em_andamento').length, late: per.filter((x) => x.status === 'atrasada').length,
          hours: Math.round((per.reduce((a, x) => a + x.watchedSeconds, 0) / 3600) * 10) / 10,
        };
      });
      let people_: unknown[] = [];
      const chosen = query.trilha ? tracks.find((t) => t.id === query.trilha) : null;
      if (chosen) {
        const es = enrs.filter((e) => e.trackId === chosen.id && scopeIds.has(e.userId));
        const elig = chosen.mode === 'atribuida' ? [] : scope.filter((p) => audienceAllows(audOf(chosen), p.viewer) && !es.some((e) => e.userId === p.id));
        people_ = [
          ...es.map((e) => { const p = scope.find((x) => x.id === e.userId)!; const r = personIn(chosen, e); return { userId: e.userId, name: p.name, teams: p.teamIds.map((x) => teams.find((tt) => tt.id === x)?.name).filter(Boolean), source: e.source, dueOn: e.dueOn, ...r, hours: Math.round((r.watchedSeconds / 3600) * 100) / 100, completedAt: e.completedAt }; }),
          ...elig.map((p) => ({ userId: p.id, name: p.name, teams: p.teamIds.map((x) => teams.find((tt) => tt.id === x)?.name).filter(Boolean), source: null, dueOn: null, pct: 0, watchedSeconds: 0, hours: 0, lastAt: null, status: 'nao_inscrito', completedAt: null })),
        ].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      }
      return {
        scope: { all: f.all, people: scope.length }, today,
        totals: {
          eligible: summary.reduce((a, x) => a + x.eligible, 0), enrolled: summary.reduce((a, x) => a + x.enrolled, 0), completed: summary.reduce((a, x) => a + x.completed, 0),
          inProgress: summary.reduce((a, x) => a + x.inProgress, 0), late: summary.reduce((a, x) => a + x.late, 0), hours: Math.round(summary.reduce((a, x) => a + x.hours, 0) * 10) / 10,
        },
        tracks: summary, people: people_,
        teams: teams.filter((t) => f.all || scope.some((p) => p.teamIds.includes(t.id))),
      };
    },
  }),
];
