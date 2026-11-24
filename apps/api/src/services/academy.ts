/**
 * Academia RevOps — regras de servidor: quem gere, quem vê, fotografia da estrutura, progresso por pessoa e público elegível.
 * Reaproveita o público, a liderança por time e os papéis da Central de Playbooks.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  audienceAllows, effectiveMinPct, enrollmentStatus, lockedLessons, playableState, snapshotLessons, trackProgress,
  type Audience, type ContentState, type LessonState, type ProgressMethod, type TrackQuiz, type TrackSnapshot, type Viewer,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { canCreate, isDirector, isManager } from './playbooks';
import { leadsOrManages, todayIn, vacationOrg } from './vacations';

export type TrackRow = typeof s.academyTracks.$inferSelect;
export type VersionRow = typeof s.academyTrackVersions.$inferSelect;
/** Regras da trilha guardadas na versão (o que vale para quem entrou nela). */
export type TrackMeta = {
  title: string; description: string | null; mode: string; level: string; workloadMinutes: number | null; dueDays: number | null;
  minWatchPct: number; progressMethod: ProgressMethod; sequential: boolean; objectives: string[]; competencies: string[];
  prerequisiteIds: string[]; certificate: boolean; validityMonths: number | null; recycleMonths: number | null;
  /** prova ao final; ausente nas versões sem prova (e nas anteriores a ela) */
  quiz?: TrackQuiz | null;
};
export const metaOf = (t: TrackRow): TrackMeta => ({
  title: t.title, description: t.description, mode: t.mode, level: t.level, workloadMinutes: t.workloadMinutes, dueDays: t.dueDays,
  minWatchPct: t.minWatchPct, progressMethod: t.progressMethod as ProgressMethod, sequential: t.sequential, objectives: t.objectives, competencies: t.competencies,
  prerequisiteIds: t.prerequisiteIds, certificate: t.certificate, validityMonths: t.validityMonths, recycleMonths: t.recycleMonths,
  // só quando há prova: assim as versões já publicadas sem prova não parecem “alteradas”
  ...(t.quiz ? { quiz: t.quiz as unknown as TrackQuiz } : {}),
});
/** Tentativas da pessoa na prova da versão em que está, da mais antiga para a mais nova. */
export const quizAttemptsOf = (db: DbOrTx, userId: string, trackId: string, versionId: string) =>
  db.select().from(s.academyQuizAttempts).where(and(eq(s.academyQuizAttempts.trackId, trackId), eq(s.academyQuizAttempts.userId, userId), eq(s.academyQuizAttempts.versionId, versionId))).orderBy(asc(s.academyQuizAttempts.createdAt));
/** A trilha conclui com as aulas obrigatórias assistidas e, se houver prova, a aprovação nela. */
export async function quizPassed(db: DbOrTx, userId: string, trackId: string, versionId: string, meta: TrackMeta) {
  if (!meta.quiz) return true;
  const [x] = await db.select({ id: s.academyQuizAttempts.id }).from(s.academyQuizAttempts)
    .where(and(eq(s.academyQuizAttempts.trackId, trackId), eq(s.academyQuizAttempts.userId, userId), eq(s.academyQuizAttempts.versionId, versionId), eq(s.academyQuizAttempts.passed, true))).limit(1);
  return !!x;
}
export const audOf = (t: TrackRow): Audience => ({ visibility: t.visibility as Audience['visibility'], teamIds: t.teamIds, costCenterIds: t.costCenterIds, profiles: t.profiles, userIds: t.userIds });

/** Gere a Academia (cria trilhas): quem cria playbooks — liderança de time, Supervisão, Gerência, Diretoria. */
export const canManageAcademy = (db: DbOrTx, auth: AuthContext) => canCreate(db, auth);
/** Edita a trilha: Gerência, Diretoria, quem criou, o curador e a liderança do time responsável. */
export async function canEditTrack(db: DbOrTx, auth: AuthContext, t: TrackRow) {
  if (isDirector(auth) || isManager(auth)) return true;
  if ([t.createdBy, t.curatorId].includes(auth.userId)) return true;
  if (!t.ownerTeamId) return false;
  return leadsOrManages(await vacationOrg(db, auth.tenantId), t.ownerTeamId, auth.userId);
}
/** Etapa de aprovação: Gerência decide; se quem enviou é Gerência ou Diretoria, decide a Diretoria (outra pessoa). */
export const stageFor = (profiles: string[]) => (profiles.includes('gerencia') || profiles.includes('diretoria') || profiles.includes('administrador') ? 'homologacao_diretoria' : 'revisao_gerencia');
export function decidesVersion(auth: AuthContext, v: VersionRow) {
  if (v.submittedBy === auth.userId) return false;
  if (v.status === 'homologacao_diretoria') return isDirector(auth);
  if (v.status === 'revisao_gerencia') return isManager(auth) || isDirector(auth);
  return false;
}

/** Estrutura de trabalho (tabelas) → fotografia, com os dados atuais de cada conteúdo. */
export async function workingSnapshot(db: DbOrTx, trackId: string): Promise<TrackSnapshot> {
  const [courses, modules, lessons] = await Promise.all([
    db.select().from(s.academyCourses).where(eq(s.academyCourses.trackId, trackId)).orderBy(asc(s.academyCourses.position)),
    db.select().from(s.academyModules).where(eq(s.academyModules.trackId, trackId)).orderBy(asc(s.academyModules.position)),
    db.select({ l: s.academyLessons, c: s.academyContents }).from(s.academyLessons).innerJoin(s.academyContents, eq(s.academyContents.id, s.academyLessons.contentId)).where(eq(s.academyLessons.trackId, trackId)).orderBy(asc(s.academyLessons.position)),
  ]);
  return {
    courses: courses.map((c) => ({
      id: c.id, title: c.title, description: c.description, minWatchPct: c.minWatchPct,
      modules: modules.filter((m) => m.courseId === c.id).map((m) => ({
        id: m.id, title: m.title, playlistId: m.playlistId,
        lessons: lessons.filter((x) => x.l.moduleId === m.id).map(({ l, c: ct }) => ({
          id: l.id, title: l.title || ct.title, description: l.description ?? ct.description, contentId: ct.id, kind: ct.kind as 'youtube_video' | 'link',
          externalId: ct.externalId, url: ct.url, durationSeconds: ct.durationSeconds, thumbnailUrl: ct.thumbnailUrl, required: l.required, minWatchPct: l.minWatchPct,
        })),
      })),
    })),
  };
}

export async function contentsById(db: DbOrTx, ids: string[]) {
  if (!ids.length) return new Map<string, typeof s.academyContents.$inferSelect>();
  const rows = await db.select().from(s.academyContents).where(inArray(s.academyContents.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Progresso de uma pessoa numa versão: estado de cada aula, bloqueios, progresso da trilha e próxima aula. */
export async function progressOf(db: DbOrTx, userId: string, trackId: string, snap: TrackSnapshot, meta: TrackMeta) {
  const lessons = snapshotLessons(snap);
  const [rows, contents] = await Promise.all([
    lessons.length ? db.select().from(s.academyLessonProgress).where(and(eq(s.academyLessonProgress.userId, userId), inArray(s.academyLessonProgress.lessonId, lessons.map((l) => l.id)))) : Promise.resolve([]),
    contentsById(db, lessons.map((l) => l.contentId)),
  ]);
  const byLesson = new Map(rows.map((r) => [r.lessonId, r]));
  const states: (LessonState & { pct: number; lastPositionSeconds: number; minPct: number; state: ContentState; durationSeconds: number | null })[] = lessons.map((l) => {
    const p = byLesson.get(l.id);
    const ct = contents.get(l.contentId);
    const dur = ct?.durationSeconds ?? l.durationSeconds ?? null;
    const watched = (p?.watchedMs ?? 0) / 1000;
    const state = (ct?.state ?? 'desconhecido') as ContentState;
    return {
      lessonId: l.id, required: l.required, available: l.kind === 'link' || playableState(state), durationSeconds: dur, watchedSeconds: watched, done: !!p?.completedAt,
      pct: dur ? Math.min(100, Math.round((watched / dur) * 1000) / 10) : 0, lastPositionSeconds: Math.floor((p?.lastPositionMs ?? 0) / 1000),
      minPct: effectiveMinPct(l.minWatchPct, l.courseMinPct, meta.minWatchPct), state,
    };
  });
  const tp = trackProgress(states, meta.progressMethod);
  const locked = lockedLessons(states, meta.sequential);
  const next = states.find((x) => x.available && !x.done && !locked.has(x.lessonId)) ?? null;
  return { states, byId: new Map(states.map((x) => [x.lessonId, x])), progress: tp, locked, nextLessonId: next?.lessonId ?? null, started: rows.length > 0 };
}

export const versionSnap = (v: VersionRow) => v.structure as unknown as TrackSnapshot;
export const versionMeta = (v: VersionRow) => v.meta as unknown as TrackMeta;

/** Contexto organizacional de cada pessoa ativa (times, centros de custo e perfis), para o público e o acompanhamento. */
export async function peopleContext(db: DbOrTx, tenantId: string) {
  const [users, roles, members, ccs] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true))).orderBy(asc(s.users.name)),
    db.execute<{ user_id: string; key: string }>(sql`select ur.user_id, r.key from user_roles ur join roles r on r.id = ur.role_id join users u on u.id = ur.user_id where u.tenant_id = ${tenantId}`),
    db.select({ userId: s.teamMemberships.userId, teamId: s.teamMemberships.teamId }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(and(eq(s.teams.tenantId, tenantId), eq(s.teams.active, true))),
    db.select({ id: s.costCenters.id, teamId: s.costCenters.teamId, leaderId: s.costCenters.leaderId, memberIds: s.costCenters.memberIds }).from(s.costCenters).where(and(eq(s.costCenters.tenantId, tenantId), eq(s.costCenters.active, true))),
  ]);
  return users.map((u) => {
    const teamIds = members.filter((m) => m.userId === u.id).map((m) => m.teamId);
    const viewer: Viewer = {
      userId: u.id, teamIds, profiles: roles.rows.filter((r) => r.user_id === u.id).map((r) => r.key),
      costCenterIds: ccs.filter((c) => (c.teamId && teamIds.includes(c.teamId)) || c.leaderId === u.id || (c.memberIds ?? []).includes(u.id)).map((c) => c.id),
    };
    return { id: u.id, name: u.name, teamIds, viewer };
  });
}
export async function eligibleUserIds(db: DbOrTx, tenantId: string, t: TrackRow) {
  const people = await peopleContext(db, tenantId);
  return people.filter((p) => audienceAllows(audOf(t), p.viewer)).map((p) => p.id);
}
/** Quem a pessoa acompanha: Gerência e Diretoria, todos; liderança, os times que lidera ou gere; os demais, ninguém. */
export async function followedUserIds(db: DbOrTx, auth: AuthContext): Promise<{ all: boolean; ids: Set<string> }> {
  if (isDirector(auth) || isManager(auth)) return { all: true, ids: new Set() };
  const org = await vacationOrg(db, auth.tenantId);
  const teams = Object.keys(org.teamNames).filter((t) => leadsOrManages(org, t, auth.userId));
  const ids = new Set<string>();
  for (const [u, ts] of Object.entries(org.teams)) if (ts.some((t) => teams.includes(t))) ids.add(u);
  ids.delete(auth.userId);
  return { all: false, ids };
}
export const statusOf = (e: { completedAt: Date | null; dueOn: string | null }, started: boolean, tz: string) =>
  enrollmentStatus({ complete: !!e.completedAt, started, dueOn: e.dueOn, today: todayIn(tz) });

export async function trackEvent(db: DbOrTx, auth: AuthContext, trackId: string, versionId: string | null, type: string, note: string | null, notify: (string | null | undefined)[] = [], title?: string) {
  await db.insert(s.academyTrackEvents).values({ tenantId: auth.tenantId, trackId, versionId, type, note, actorId: auth.userId });
  const to = [...new Set(notify.filter((x): x is string => !!x && x !== auth.userId))];
  if (to.length) await db.insert(s.governanceEvents).values({ tenantId: auth.tenantId, entity: 'academia', entityId: trackId, type: type.replace(/^academia_/, ''), notify: to, payload: { title: title ?? note ?? '' }, actorId: auth.userId });
}
/** Marca os avisos da trilha como lidos (sino) ao abrir a trilha ou o editor. */
export const markRead = (db: DbOrTx, userId: string, trackId: string) =>
  db.insert(s.governanceReads).values({ userId, entityId: trackId }).onConflictDoUpdate({ target: [s.governanceReads.userId, s.governanceReads.entityId], set: { lastReadAt: new Date() } });
export async function usersWithProfiles(db: DbOrTx, tenantId: string, profiles: string[]) {
  const r = await db.execute<{ id: string }>(sql`select distinct u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where u.tenant_id = ${tenantId} and u.active and r.key in ${sql.raw(`(${profiles.map((p) => `'${p.replace(/'/g, '')}'`).join(',')})`)}`);
  return r.rows.map((x) => x.id);
}
