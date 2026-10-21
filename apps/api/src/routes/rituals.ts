/** Gestão de Times — Fase 8: rituais de gestão, reuniões com pauta automática e ata, decisões e impedimentos. */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  OPEN_IMPEDIMENT, OPEN_INTERVENTION, RITUAL_TEMPLATES, impedimentTransition, nextOccurrences, validateRitual,
  type ImpedimentStatus, type RitualCadence,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { dueAtOf, todayLocal } from '../services/projects';
import { taskEvent } from '../services/tasks';
import { orgData, resultsScope, unitPeople, type ResultsScope } from '../services/results';
import { ancestorsResponsibles, teamLead } from '../services/interventions';
import { performanceConfig } from '../services/businessEvents';
import { goalDto } from './indicators';

type Org = Awaited<ReturnType<typeof orgData>>;
type Scoped = { teamId: string | null; orgUnitId: string | null };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Escopo de dados de um ritual/decisão/impedimento: time, unidade (com filhas) ou empresa. */
function scopeData(org: Org, x: Scoped) {
  if (x.teamId) return { all: false, teamIds: [x.teamId], unitIds: [] as string[], userIds: org.members.filter((m) => m.teamId === x.teamId).map((m) => m.userId) };
  if (x.orgUnitId) { const p = unitPeople(org, x.orgUnitId); return { all: false, ...p }; }
  return { all: true, teamIds: [] as string[], unitIds: [] as string[], userIds: [] as string[] };
}
/** Quem vê algo de um escopo pela estrutura (além de quem participa diretamente). */
const inScope = (sc: ResultsScope, x: Scoped) => sc.all || (x.teamId ? sc.teamIds.includes(x.teamId) : x.orgUnitId ? sc.unitIds.includes(x.orgUnitId) : sc.perspectives.includes('diretoria'));
/** Gerir (criar/alterar ritual, revogar decisão): responder pela estrutura daquele escopo. */
const manages = (sc: ResultsScope, x: Scoped) => sc.all || (sc.perspectives.length > 0 && inScope(sc, x));

async function gov(db: DbOrTx, auth: AuthContext, entity: 'ritual' | 'reuniao' | 'decisao' | 'impedimento', entityId: string, type: string, payload: Record<string, unknown>, notify: (string | null | undefined)[] = []) {
  await db.insert(s.governanceEvents).values({ tenantId: auth.tenantId, entity, entityId, type, payload, actorId: auth.userId, notify: [...new Set(notify.filter((x): x is string => !!x && x !== auth.userId))] });
}
async function assertActiveUsers(db: DbOrTx, auth: AuthContext, ids: string[], path: string) {
  if (!ids.length) return;
  const rows = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), inArray(s.users.id, ids)));
  if (rows.length !== new Set(ids).size) throw unprocessable('Pessoa inválida.', [{ path, message: 'Usuário inativo ou de outra empresa' }]);
}
async function assertScopeAllowed(db: DbOrTx, auth: AuthContext, sc: ResultsScope, x: Scoped) {
  if (x.teamId && x.orgUnitId) throw unprocessable('Escolha um time ou uma unidade, não os dois.');
  const org = await orgData(db, auth.tenantId);
  if (x.teamId && !org.teams.some((t) => t.id === x.teamId)) throw unprocessable('Time inválido.');
  if (x.orgUnitId && !org.units.some((u) => u.id === x.orgUnitId)) throw unprocessable('Unidade inválida.');
  if (!manages(sc, x)) throw forbidden('Você só cria rituais para os escopos pelos quais responde na estrutura.');
}

// ---------------------------------------------------------------- reuniões: materialização na agenda
async function ensureMeetings(db: DbOrTx, auth: AuthContext, r: typeof s.rituals.$inferSelect, today: string, count = 2) {
  if (!r.active) return;
  const dates = nextOccurrences({ cadence: r.cadence as RitualCadence, weekday: r.weekday, monthDay: r.monthDay, anchor: r.anchorOn }, today, count);
  for (const d of dates) {
    const [m] = await db.insert(s.ritualMeetings).values({ tenantId: auth.tenantId, ritualId: r.id, date: d }).onConflictDoNothing().returning({ id: s.ritualMeetings.id });
    if (!m) continue;
    // a reunião entra na agenda do facilitador e dos participantes
    const [a] = await db.insert(s.activities).values({
      tenantId: auth.tenantId, type: 'reuniao', title: r.name, notes: `Ritual de gestão. Pauta: ${r.agenda.join('; ')}.`, priority: 'media', ownerId: r.facilitatorId, createdBy: r.createdBy ?? r.facilitatorId,
      dueAt: sql`((${d}::date + ${r.time}::time) at time zone ${auth.timezone})` as unknown as Date, status: 'a_fazer', category: 'Ritual de gestão',
      participants: r.participants.filter((p) => p !== r.facilitatorId), estimateMinutes: r.durationMin,
    }).returning({ id: s.activities.id });
    await db.update(s.ritualMeetings).set({ activityId: a!.id }).where(eq(s.ritualMeetings.id, m.id));
  }
}

async function loadRitual(db: DbOrTx, auth: AuthContext, id: string) {
  const [r] = await db.select().from(s.rituals).where(and(eq(s.rituals.id, id), eq(s.rituals.tenantId, auth.tenantId))).limit(1);
  if (!r) throw notFound('Ritual não encontrado.');
  const sc = await resultsScope(db, auth);
  const member = r.facilitatorId === auth.userId || r.participants.includes(auth.userId);
  if (!member && !inScope(sc, r)) throw notFound('Ritual não encontrado.');
  return { r, sc, member, canManage: r.facilitatorId === auth.userId || manages(sc, r) };
}
async function loadMeeting(db: DbOrTx, auth: AuthContext, id: string, forUpdate = false) {
  const q = db.select().from(s.ritualMeetings).where(and(eq(s.ritualMeetings.id, id), eq(s.ritualMeetings.tenantId, auth.tenantId))).limit(1);
  const [m] = forUpdate ? await q.for('update') : await q;
  if (!m) throw notFound('Reunião não encontrada.');
  const ctx = await loadRitual(db, auth, m.ritualId);
  return { m, ...ctx, canWrite: ctx.member || ctx.canManage };
}

/** Pauta automática da reunião: metas fora da faixa, intervenções, impedimentos, decisões a acompanhar e ações atrasadas do escopo. */
async function autoAgenda(db: DbOrTx, auth: AuthContext, r: typeof s.rituals.$inferSelect, date: string) {
  const org = await orgData(db, auth.tenantId);
  const sd = scopeData(org, r);
  const today = todayLocal(auth);
  const goalWhere = sd.all ? sql`true` : or(
    sd.teamIds.length ? and(eq(s.goals.scope, 'equipe'), inArray(s.goals.teamId, sd.teamIds)) : sql`false`,
    sd.unitIds.length ? and(eq(s.goals.scope, 'unidade'), inArray(s.goals.orgUnitId, sd.unitIds)) : sql`false`,
    sd.userIds.length ? and(eq(s.goals.scope, 'individual'), inArray(s.goals.userId, sd.userIds)) : sql`false`,
  )!;
  const gs = await db.select().from(s.goals).where(and(eq(s.goals.tenantId, auth.tenantId), eq(s.goals.status, 'ativa'), eq(s.goals.approvalStatus, 'aprovada'), sql`${s.goals.periodStart} <= ${date}::date and ${s.goals.periodEnd} >= ${date}::date`, goalWhere)).limit(80);
  const { config } = await performanceConfig(db, auth.tenantId);
  const users = await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
  const uname = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const goals = (await Promise.all(gs.map(async (g) => { const d = await goalDto(db, auth, g, config.traffic); return { id: g.id, title: g.title, who: g.scope === 'individual' ? uname(g.userId) : g.scope === 'equipe' ? org.teams.find((t) => t.id === g.teamId)?.name ?? null : g.scope === 'unidade' ? org.units.find((u) => u.id === g.orgUnitId)?.name ?? null : 'Empresa', color: d.progress.color as string, attainment: d.progress.attainment, partial: d.progress.partial }; })));
  const colors = { verde: 0, amarelo: 0, vermelho: 0, sem_dado: 0 } as Record<string, number>;
  for (const g of goals) colors[g.color] = (colors[g.color] ?? 0) + 1;

  const ivWhere = sd.all ? sql`true` : or(
    sd.teamIds.length ? inArray(s.interventions.teamId, sd.teamIds) : sql`false`, sd.unitIds.length ? inArray(s.interventions.orgUnitId, sd.unitIds) : sql`false`, sd.userIds.length ? inArray(s.interventions.subjectUserId, sd.userIds) : sql`false`,
  )!;
  const ivs = await db.select({ i: s.interventions, goalTitle: sql<string>`coalesce(${s.interventions.title}, ${s.goals.title})` }).from(s.interventions).leftJoin(s.goals, eq(s.goals.id, s.interventions.goalId)).where(and(eq(s.interventions.tenantId, auth.tenantId), inArray(s.interventions.status, OPEN_INTERVENTION), ivWhere)).limit(50);
  const lateActions = ivs.length ? await db.select({ id: s.interventionActions.id, what: s.interventionActions.what, taskId: s.activities.id, ownerId: s.activities.ownerId, due: sql<string>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')`, interventionId: s.interventionActions.interventionId })
    .from(s.interventionActions).innerJoin(s.activities, eq(s.activities.id, s.interventionActions.activityId))
    .where(and(inArray(s.interventionActions.interventionId, ivs.map((x) => x.i.id)), sql`${s.activities.status} not in ('concluida', 'cancelada')`, sql`(${s.activities.dueAt} at time zone ${auth.timezone})::date < ${today}::date`)) : [];

  const scopeWhere = <T extends { teamId: unknown; orgUnitId: unknown }>(tbl: T) => sd.all ? sql`true` : or(sd.teamIds.length ? inArray(tbl.teamId as typeof s.impediments.teamId, sd.teamIds) : sql`false`, sd.unitIds.length ? inArray(tbl.orgUnitId as typeof s.impediments.orgUnitId, sd.unitIds) : sql`false`)!;
  const ritualMeetingIds = db.select({ id: s.ritualMeetings.id }).from(s.ritualMeetings).where(eq(s.ritualMeetings.ritualId, r.id));
  const imps = await db.select().from(s.impediments).where(and(eq(s.impediments.tenantId, auth.tenantId), inArray(s.impediments.status, OPEN_IMPEDIMENT), or(scopeWhere(s.impediments), inArray(s.impediments.meetingId, ritualMeetingIds)))).orderBy(desc(s.impediments.createdAt)).limit(50);
  const decs = await db.select({ d: s.decisions, taskStatus: s.activities.status }).from(s.decisions).leftJoin(s.activities, eq(s.activities.id, s.decisions.followUpTaskId))
    .where(and(eq(s.decisions.tenantId, auth.tenantId), eq(s.decisions.status, 'vigente'), inArray(s.decisions.meetingId, ritualMeetingIds))).orderBy(desc(s.decisions.createdAt)).limit(30);
  return {
    goals: { colors, offTrack: goals.filter((g) => g.color === 'vermelho' || g.color === 'amarelo').sort((a, b) => (a.color === b.color ? 0 : a.color === 'vermelho' ? -1 : 1)) },
    interventions: ivs.map((x) => ({ id: x.i.id, goalTitle: x.goalTitle, kind: x.i.kind, status: x.i.status, ownerName: uname(x.i.ownerId), dueOn: x.i.status === 'aberta' ? x.i.dueOn : x.i.planDueOn ?? x.i.dueOn, overdue: (x.i.status === 'aberta' ? x.i.dueOn : x.i.planDueOn ?? x.i.dueOn) < today })),
    lateActions: lateActions.map((a) => ({ ...a, ownerName: uname(a.ownerId) })),
    impediments: imps.map((i) => ({ id: i.id, title: i.title, severity: i.severity, status: i.status, ownerName: uname(i.ownerId), dueOn: i.dueOn, overdue: !!i.dueOn && i.dueOn < today })),
    decisions: decs.map((x) => ({ id: x.d.id, text: x.d.text, effectiveOn: x.d.effectiveOn, ownerName: uname(x.d.ownerId), followUpStatus: x.taskStatus, meetingId: x.d.meetingId })),
  };
}

// ---------------------------------------------------------------- impedimentos: escalonamento pela estrutura
function escalationChain(org: Org, x: Scoped) {
  const roots = org.units.filter((u) => u.active && u.kind === 'diretoria' && !u.parentId).map((u) => u.responsibleId).filter(Boolean) as string[];
  const unit = x.teamId ? org.teams.find((t) => t.id === x.teamId)?.orgUnitId ?? null : x.orgUnitId;
  return [...new Set([x.teamId ? teamLead(org, x.teamId) : null, ...ancestorsResponsibles(org, unit), ...roots].filter((p): p is string => !!p))];
}

const RitualBody = z.object({
  name: z.string().trim().max(120), perspective: z.enum(['diretoria', 'gestao', 'lideranca']), teamId: z.string().uuid().nullable().default(null), orgUnitId: z.string().uuid().nullable().default(null),
  cadence: z.enum(['diaria', 'semanal', 'quinzenal', 'mensal']), weekday: z.number().int().default(1), monthDay: z.number().int().default(1), time: z.string(), durationMin: z.number().int(),
  facilitatorId: z.string().uuid().optional(), participants: z.array(z.string().uuid()).max(60), agenda: z.array(z.string().trim().max(200)).max(20), anchorOn: isoDate.optional(),
});
const DecisionBody = z.object({
  text: z.string().trim().min(5).max(1000), rationale: z.string().trim().max(2000).nullable().default(null), meetingId: z.string().uuid().nullable().default(null), interventionId: z.string().uuid().nullable().default(null),
  effectiveOn: isoDate.optional(), followUp: z.object({ title: z.string().trim().min(3).max(200), ownerId: z.string().uuid(), dueOn: isoDate }).nullable().default(null),
});
const ImpedimentBody = z.object({
  title: z.string().trim().min(5).max(200), description: z.string().trim().max(2000).nullable().default(null), severity: z.enum(['alta', 'media', 'baixa']).default('media'),
  ownerId: z.string().uuid(), dueOn: isoDate.nullable().default(null), meetingId: z.string().uuid().nullable().default(null), interventionId: z.string().uuid().nullable().default(null),
  teamId: z.string().uuid().nullable().default(null), orgUnitId: z.string().uuid().nullable().default(null),
});

/** Contexto herdado (escopo) da reunião ou da intervenção de origem; quem cria precisa poder escrever nela. */
async function originScope(db: DbOrTx, auth: AuthContext, b: { meetingId: string | null; interventionId: string | null; teamId?: string | null; orgUnitId?: string | null }) {
  if (b.meetingId) {
    const ctx = await loadMeeting(db, auth, b.meetingId);
    if (!ctx.canWrite) throw forbidden('Só participantes e quem conduz o ritual registram na reunião.');
    if (ctx.m.status !== 'agendada') throw unprocessable('A ata desta reunião já foi encerrada.');
    return { teamId: ctx.r.teamId, orgUnitId: ctx.r.orgUnitId };
  }
  if (b.interventionId) {
    const [i] = await db.select().from(s.interventions).where(and(eq(s.interventions.id, b.interventionId), eq(s.interventions.tenantId, auth.tenantId))).limit(1);
    if (!i) throw notFound('Intervenção não encontrada.');
    const sc = await resultsScope(db, auth);
    if (!(sc.all || i.ownerId === auth.userId || i.escalationChain.includes(auth.userId))) throw forbidden('Só quem conduz a intervenção registra nela.');
    return { teamId: i.teamId, orgUnitId: i.orgUnitId };
  }
  return { teamId: b.teamId ?? null, orgUnitId: b.orgUnitId ?? null };
}
const seeItem = (sc: ResultsScope, auth: AuthContext, x: Scoped & { ownerId: string; createdBy?: string | null; raisedBy?: string }) =>
  x.ownerId === auth.userId || x.createdBy === auth.userId || x.raisedBy === auth.userId || inScope(sc, x);

export const ritualRoutes = [
  // ------------------------------------------------------------ rituais
  defineRoute({
    method: 'GET', url: '/rituals', summary: 'Rituais de gestão visíveis (de que participo ou no meu escopo) e as próximas reuniões', tag: 'Gestão de Times', module: 'resultados',
    handler: async ({ app, auth }) => {
      const sc = await resultsScope(app.db, auth);
      const today = todayLocal(auth);
      const all = await app.db.select().from(s.rituals).where(eq(s.rituals.tenantId, auth.tenantId)).orderBy(s.rituals.name);
      const vis = all.filter((r) => r.facilitatorId === auth.userId || r.participants.includes(auth.userId) || inScope(sc, r));
      for (const r of vis) await ensureMeetings(app.db, auth, r, today);
      const ids = vis.map((r) => r.id);
      const meetings = ids.length ? await app.db.select().from(s.ritualMeetings).where(and(inArray(s.ritualMeetings.ritualId, ids), sql`${s.ritualMeetings.date} >= (${today}::date - 45)`)).orderBy(s.ritualMeetings.date) : [];
      const org = await orgData(app.db, auth.tenantId);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      return {
        today, templates: RITUAL_TEMPLATES, canCreate: sc.all || sc.perspectives.length > 0,
        rituals: vis.map((r) => ({
          ...r, facilitatorName: users.find((u) => u.id === r.facilitatorId)?.name ?? null,
          scopeName: r.teamId ? org.teams.find((t) => t.id === r.teamId)?.name ?? null : r.orgUnitId ? org.units.find((u) => u.id === r.orgUnitId)?.name ?? null : 'Empresa',
          canManage: r.facilitatorId === auth.userId || manages(sc, r),
          next: meetings.find((m) => m.ritualId === r.id && m.date >= today && m.status === 'agendada') ?? null,
          last: [...meetings].reverse().find((m) => m.ritualId === r.id && m.status === 'realizada') ?? null,
        })),
        meetings: meetings.map((m) => ({ ...m, ritualName: vis.find((r) => r.id === m.ritualId)!.name })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/rituals', summary: 'Cria ritual (escopo pelo qual a pessoa responde); as próximas reuniões entram na agenda', tag: 'Gestão de Times', module: 'resultados', body: RitualBody,
    handler: async ({ app, auth, body, reply }) => {
      const errs = validateRitual(body);
      if (errs.length) throw unprocessable(errs[0]!.message, errs);
      const id = await app.db.transaction(async (tx) => {
        const sc = await resultsScope(tx, auth);
        await assertScopeAllowed(tx, auth, sc, body);
        const facilitatorId = body.facilitatorId ?? auth.userId;
        await assertActiveUsers(tx, auth, [facilitatorId, ...body.participants], 'participants');
        const [r] = await tx.insert(s.rituals).values({ ...body, agenda: body.agenda.filter((a) => a.trim()), participants: [...new Set(body.participants)], facilitatorId, anchorOn: body.anchorOn ?? todayLocal(auth), tenantId: auth.tenantId, createdBy: auth.userId }).returning();
        await ensureMeetings(tx, auth, r!, todayLocal(auth));
        await gov(tx, auth, 'ritual', r!.id, 'criado', { name: r!.name, cadence: r!.cadence }, r!.participants);
        return r!.id;
      });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/rituals/:id', summary: 'Altera ritual (vale para as próximas reuniões ainda não criadas) ou desativa', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: RitualBody.partial().extend({ rowVersion: z.number().int(), active: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { r, canManage, sc } = await loadRitual(tx, auth, params.id);
      if (!canManage) throw forbidden('Só quem conduz o ritual ou responde pelo escopo altera o ritual.');
      if (r.rowVersion !== body.rowVersion) throw conflict(r.rowVersion);
      const next = { ...r, ...body };
      const errs = validateRitual(next as Parameters<typeof validateRitual>[0]);
      if (errs.length) throw unprocessable(errs[0]!.message, errs);
      if (body.teamId !== undefined || body.orgUnitId !== undefined) await assertScopeAllowed(tx, auth, sc, next);
      await assertActiveUsers(tx, auth, [next.facilitatorId, ...next.participants], 'participants');
      const { rowVersion: _rv, ...rest } = body;
      await tx.update(s.rituals).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.rituals.rowVersion} + 1` }).where(eq(s.rituals.id, r.id));
      await gov(tx, auth, 'ritual', r.id, body.active === false ? 'desativado' : 'alterado', { fields: Object.keys(rest) });
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ reuniões
  defineRoute({
    method: 'GET', url: '/rituals/meetings/:id', summary: 'Reunião: pauta do ritual, pauta automática do escopo (ou a fotografia, se encerrada), presença, anotações e o que foi registrado', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const { m, r, canWrite, canManage } = await loadMeeting(app.db, auth, params.id);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const decisions = await app.db.select().from(s.decisions).where(eq(s.decisions.meetingId, m.id)).orderBy(s.decisions.createdAt);
      const impediments = await app.db.select().from(s.impediments).where(eq(s.impediments.meetingId, m.id)).orderBy(s.impediments.createdAt);
      const prev = await app.db.select({ id: s.ritualMeetings.id, date: s.ritualMeetings.date }).from(s.ritualMeetings).where(and(eq(s.ritualMeetings.ritualId, r.id), eq(s.ritualMeetings.status, 'realizada'), sql`${s.ritualMeetings.date} < ${m.date}::date`)).orderBy(desc(s.ritualMeetings.date)).limit(1);
      const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
      return {
        ...m, ritual: { id: r.id, name: r.name, perspective: r.perspective, agenda: r.agenda, time: r.time, durationMin: r.durationMin, facilitatorId: r.facilitatorId, facilitatorName: name(r.facilitatorId), participants: r.participants.map((id) => ({ id, name: name(id) })), teamId: r.teamId, orgUnitId: r.orgUnitId },
        auto: m.status === 'realizada' && m.snapshot ? m.snapshot : await autoAgenda(app.db, auth, r, m.date),
        decisions: decisions.map((d) => ({ ...d, ownerName: name(d.ownerId) })), impediments: impediments.map((i) => ({ ...i, ownerName: name(i.ownerId) })),
        previous: prev[0] ?? null, finalizedByName: name(m.finalizedBy),
        can: { write: canWrite && m.status === 'agendada', finalize: (canManage || r.facilitatorId === auth.userId) && m.status === 'agendada' },
      };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/rituals/meetings/:id', summary: 'Presença, anotações por item de pauta e ata (enquanto a reunião não for encerrada)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), attendees: z.array(z.string().uuid()).max(80).optional(), notes: z.record(z.string().max(200), z.string().max(4000)).optional(), minutes: z.string().max(20000).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { m, canWrite } = await loadMeeting(tx, auth, params.id, true);
      if (!canWrite) throw forbidden('Só participantes e quem conduz o ritual registram a reunião.');
      if (m.status !== 'agendada') throw unprocessable('A ata desta reunião já foi encerrada.');
      if (m.rowVersion !== body.rowVersion) throw conflict(m.rowVersion);
      if (body.attendees) await assertActiveUsers(tx, auth, body.attendees, 'attendees');
      const { rowVersion: _rv, ...rest } = body;
      const [r] = await tx.update(s.ritualMeetings).set({ ...rest, updatedAt: new Date(), rowVersion: sql`${s.ritualMeetings.rowVersion} + 1` }).where(eq(s.ritualMeetings.id, m.id)).returning({ rowVersion: s.ritualMeetings.rowVersion });
      return { rowVersion: r!.rowVersion };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/rituals/meetings/:id/finalize', summary: 'Encerra a ata: fotografa a pauta automática, trava edição e avisa os participantes', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { m, r, canManage } = await loadMeeting(tx, auth, params.id, true);
      if (!(canManage || r.facilitatorId === auth.userId)) throw forbidden('Só quem conduz o ritual encerra a ata.');
      if (m.status !== 'agendada') throw unprocessable('A reunião já foi encerrada ou cancelada.');
      if (m.rowVersion !== body.rowVersion) throw conflict(m.rowVersion);
      if (!m.attendees.length) throw unprocessable('Marque quem participou antes de encerrar a ata.');
      if (m.date > todayLocal(auth)) throw unprocessable('A reunião ainda não aconteceu.');
      const snapshot = await autoAgenda(tx, auth, r, m.date);
      await tx.update(s.ritualMeetings).set({ status: 'realizada', snapshot, finalizedBy: auth.userId, finalizedAt: new Date(), updatedAt: new Date(), rowVersion: sql`${s.ritualMeetings.rowVersion} + 1` }).where(eq(s.ritualMeetings.id, m.id));
      if (m.activityId) await tx.update(s.activities).set({ status: 'concluida', completedAt: new Date(), completedBy: auth.userId, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(and(eq(s.activities.id, m.activityId), sql`${s.activities.status} <> 'concluida'`));
      await gov(tx, auth, 'reuniao', m.id, 'ata_encerrada', { ritual: r.name, date: m.date }, [r.facilitatorId, ...r.participants]);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/rituals/meetings/:id/cancel', summary: 'Cancela a reunião com motivo (sai da agenda)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ reason: z.string().trim().min(5).max(500) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const { m, r, canManage } = await loadMeeting(tx, auth, params.id, true);
      if (!(canManage || r.facilitatorId === auth.userId)) throw forbidden('Só quem conduz o ritual cancela a reunião.');
      if (m.status !== 'agendada') throw unprocessable('A reunião já foi encerrada ou cancelada.');
      await tx.update(s.ritualMeetings).set({ status: 'cancelada', cancelReason: body.reason, updatedAt: new Date(), rowVersion: sql`${s.ritualMeetings.rowVersion} + 1` }).where(eq(s.ritualMeetings.id, m.id));
      if (m.activityId) await tx.update(s.activities).set({ status: 'cancelada', updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, m.activityId));
      await gov(tx, auth, 'reuniao', m.id, 'cancelada', { ritual: r.name, date: m.date, reason: body.reason }, [r.facilitatorId, ...r.participants]);
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ decisões
  defineRoute({
    method: 'GET', url: '/decisions', summary: 'Decisões visíveis (vigentes por padrão), com origem e acompanhamento', tag: 'Gestão de Times', module: 'resultados',
    query: z.object({ status: z.enum(['vigente', 'revogada', 'todas']).default('vigente') }),
    handler: async ({ app, auth, query: q }) => {
      const sc = await resultsScope(app.db, auth);
      const rows = await app.db.select({ d: s.decisions, ownerName: s.users.name, taskStatus: s.activities.status, ritualName: s.rituals.name, meetingDate: s.ritualMeetings.date, goalTitle: sql<string | null>`coalesce(${s.interventions.title}, ${s.goals.title})` })
        .from(s.decisions).innerJoin(s.users, eq(s.users.id, s.decisions.ownerId)).leftJoin(s.activities, eq(s.activities.id, s.decisions.followUpTaskId))
        .leftJoin(s.ritualMeetings, eq(s.ritualMeetings.id, s.decisions.meetingId)).leftJoin(s.rituals, eq(s.rituals.id, s.ritualMeetings.ritualId))
        .leftJoin(s.interventions, eq(s.interventions.id, s.decisions.interventionId)).leftJoin(s.goals, eq(s.goals.id, s.interventions.goalId))
        .where(and(eq(s.decisions.tenantId, auth.tenantId), q.status === 'todas' ? sql`true` : eq(s.decisions.status, q.status))).orderBy(desc(s.decisions.createdAt)).limit(500);
      return { items: rows.filter((r) => seeItem(sc, auth, r.d)).map((r) => ({ ...r.d, ownerName: r.ownerName, followUpStatus: r.taskStatus, origin: r.ritualName ? `${r.ritualName} (${r.meetingDate!.split('-').reverse().join('/')})` : r.goalTitle ? `Intervenção: ${r.goalTitle}` : null })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/decisions', summary: 'Registra decisão (na reunião, na intervenção ou avulsa no escopo); pode criar tarefa de acompanhamento', tag: 'Gestão de Times', module: 'resultados', body: DecisionBody,
    handler: async ({ app, auth, body, reply }) => {
      const id = await app.db.transaction(async (tx) => {
        const scope = await originScope(tx, auth, body);
        if (!body.meetingId && !body.interventionId) { const sc = await resultsScope(tx, auth); if (!manages(sc, scope)) throw forbidden('Decisão avulsa só no escopo pelo qual você responde.'); }
        let followUpTaskId: string | null = null;
        if (body.followUp) {
          if (body.followUp.dueOn < todayLocal(auth)) throw unprocessable('O prazo do acompanhamento não pode estar no passado.', [{ path: 'followUp.dueOn', message: 'Data passada' }]);
          await assertActiveUsers(tx, auth, [body.followUp.ownerId], 'followUp.ownerId');
          const [t] = await tx.insert(s.activities).values({ tenantId: auth.tenantId, type: 'tarefa', title: body.followUp.title, notes: `Acompanhamento da decisão: ${body.text}`, priority: 'media', ownerId: body.followUp.ownerId, createdBy: auth.userId, dueAt: dueAtOf(auth, body.followUp.dueOn) as unknown as Date, status: 'a_fazer', category: 'Decisão', tags: ['decisão'] }).returning({ id: s.activities.id });
          await taskEvent(tx, auth, t!.id, 'created', { delegatedTo: body.followUp.ownerId !== auth.userId ? body.followUp.ownerId : null });
          followUpTaskId = t!.id;
        }
        const [d] = await tx.insert(s.decisions).values({ tenantId: auth.tenantId, text: body.text, rationale: body.rationale, meetingId: body.meetingId, interventionId: body.interventionId, ...scope, ownerId: auth.userId, effectiveOn: body.effectiveOn ?? todayLocal(auth), followUpTaskId, createdBy: auth.userId }).returning({ id: s.decisions.id });
        await gov(tx, auth, 'decisao', d!.id, 'registrada', { text: body.text });
        return d!.id;
      });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/decisions/:id/revoke', summary: 'Revoga decisão vigente com motivo (a decisão continua no histórico)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ reason: z.string().trim().min(10).max(1000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [d] = await tx.select().from(s.decisions).where(and(eq(s.decisions.id, params.id), eq(s.decisions.tenantId, auth.tenantId))).limit(1).for('update');
      const sc = await resultsScope(tx, auth);
      if (!d || !seeItem(sc, auth, d)) throw notFound('Decisão não encontrada.');
      if (!(d.ownerId === auth.userId || manages(sc, d))) throw forbidden('Só quem registrou ou quem responde pelo escopo revoga a decisão.');
      if (d.status !== 'vigente') throw unprocessable('A decisão já foi revogada.');
      await tx.update(s.decisions).set({ status: 'revogada', revokedReason: body.reason, revokedBy: auth.userId, revokedAt: new Date() }).where(eq(s.decisions.id, d.id));
      await gov(tx, auth, 'decisao', d.id, 'revogada', { reason: body.reason, text: d.text }, [d.ownerId]);
      return { ok: true };
    }),
  }),

  // ------------------------------------------------------------ impedimentos
  defineRoute({
    method: 'GET', url: '/impediments', summary: 'Impedimentos visíveis (abertos por padrão), com atraso e escalonamentos', tag: 'Gestão de Times', module: 'resultados',
    query: z.object({ status: z.enum(['abertos', 'aberto', 'em_tratamento', 'removido', 'aceito', 'todos']).default('abertos'), mine: z.coerce.boolean().optional() }),
    handler: async ({ app, auth, query: q }) => {
      const sc = await resultsScope(app.db, auth);
      const today = todayLocal(auth);
      const rows = await app.db.select({ i: s.impediments, ownerName: s.users.name }).from(s.impediments).innerJoin(s.users, eq(s.users.id, s.impediments.ownerId)).where(eq(s.impediments.tenantId, auth.tenantId)).orderBy(desc(s.impediments.createdAt)).limit(1000);
      const org = await orgData(app.db, auth.tenantId);
      const vis = rows.filter((r) => seeItem(sc, auth, r.i));
      const open = (st: string) => OPEN_IMPEDIMENT.includes(st as ImpedimentStatus);
      return {
        today,
        counts: { abertos: vis.filter((r) => open(r.i.status)).length, atrasados: vis.filter((r) => open(r.i.status) && !!r.i.dueOn && r.i.dueOn < today).length, altos: vis.filter((r) => open(r.i.status) && r.i.severity === 'alta').length, comigo: vis.filter((r) => open(r.i.status) && r.i.ownerId === auth.userId).length },
        items: vis.filter((r) => (q.status === 'todos' ? true : q.status === 'abertos' ? open(r.i.status) : r.i.status === q.status)).filter((r) => !q.mine || r.i.ownerId === auth.userId)
          .map((r) => ({ ...r.i, ownerName: r.ownerName, overdue: open(r.i.status) && !!r.i.dueOn && r.i.dueOn < today, scopeName: r.i.teamId ? org.teams.find((t) => t.id === r.i.teamId)?.name ?? null : r.i.orgUnitId ? org.units.find((u) => u.id === r.i.orgUnitId)?.name ?? null : null, canEdit: r.i.ownerId === auth.userId || r.i.raisedBy === auth.userId || manages(sc, r.i) })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/impediments', summary: 'Registra impedimento com responsável por remover (avisado no sino)', tag: 'Gestão de Times', module: 'resultados', body: ImpedimentBody,
    handler: async ({ app, auth, body, reply }) => {
      const id = await app.db.transaction(async (tx) => {
        const scope = await originScope(tx, auth, body);
        if (!body.meetingId && !body.interventionId && (scope.teamId || scope.orgUnitId)) { const sc = await resultsScope(tx, auth); if (!inScope(sc, scope)) throw forbidden('Escopo fora do seu alcance.'); }
        await assertActiveUsers(tx, auth, [body.ownerId], 'ownerId');
        const [i] = await tx.insert(s.impediments).values({ tenantId: auth.tenantId, title: body.title, description: body.description, severity: body.severity, ownerId: body.ownerId, dueOn: body.dueOn, meetingId: body.meetingId, interventionId: body.interventionId, ...scope, raisedBy: auth.userId }).returning({ id: s.impediments.id });
        await gov(tx, auth, 'impedimento', i!.id, 'registrado', { title: body.title, severity: body.severity }, [body.ownerId]);
        return i!.id;
      });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/impediments/:id', summary: 'Muda situação (encerrar exige como foi resolvido), responsável ou prazo', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), status: z.enum(['aberto', 'em_tratamento', 'removido', 'aceito']).optional(), resolution: z.string().trim().max(2000).optional(), ownerId: z.string().uuid().optional(), dueOn: isoDate.nullable().optional(), severity: z.enum(['alta', 'media', 'baixa']).optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [i] = await tx.select().from(s.impediments).where(and(eq(s.impediments.id, params.id), eq(s.impediments.tenantId, auth.tenantId))).limit(1).for('update');
      const sc = await resultsScope(tx, auth);
      if (!i || !seeItem(sc, auth, i)) throw notFound('Impedimento não encontrado.');
      if (!(i.ownerId === auth.userId || i.raisedBy === auth.userId || manages(sc, i))) throw forbidden('Só quem registrou, o responsável ou quem responde pelo escopo altera o impedimento.');
      if (i.rowVersion !== body.rowVersion) throw conflict(i.rowVersion);
      const set: Partial<typeof s.impediments.$inferInsert> = {};
      if (body.status && body.status !== i.status) {
        const err = impedimentTransition(i.status as ImpedimentStatus, body.status, body.resolution);
        if (err) throw unprocessable(err, [{ path: 'resolution', message: err }]);
        set.status = body.status;
        const closing = body.status === 'removido' || body.status === 'aceito';
        set.resolution = closing ? body.resolution! : null; set.resolvedBy = closing ? auth.userId : null; set.resolvedAt = closing ? new Date() : null;
      }
      if (body.ownerId && body.ownerId !== i.ownerId) { await assertActiveUsers(tx, auth, [body.ownerId], 'ownerId'); set.ownerId = body.ownerId; }
      if (body.dueOn !== undefined) set.dueOn = body.dueOn;
      if (body.severity) set.severity = body.severity;
      await tx.update(s.impediments).set({ ...set, updatedAt: new Date(), rowVersion: sql`${s.impediments.rowVersion} + 1` }).where(eq(s.impediments.id, i.id));
      if (set.status) await gov(tx, auth, 'impedimento', i.id, set.status, { from: i.status, resolution: set.resolution ?? null, title: i.title }, [i.raisedBy, i.ownerId]);
      if (set.ownerId) await gov(tx, auth, 'impedimento', i.id, 'reatribuido', { from: i.ownerId, to: set.ownerId, title: i.title }, [set.ownerId]);
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/impediments/:id/escalate', summary: 'Escala o impedimento para o próximo responsável acima na estrutura (avisado no sino)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), reason: z.string().trim().min(5).max(1000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [i] = await tx.select().from(s.impediments).where(and(eq(s.impediments.id, params.id), eq(s.impediments.tenantId, auth.tenantId))).limit(1).for('update');
      const sc = await resultsScope(tx, auth);
      if (!i || !seeItem(sc, auth, i)) throw notFound('Impedimento não encontrado.');
      if (!(i.ownerId === auth.userId || i.raisedBy === auth.userId || manages(sc, i))) throw forbidden('Só quem registrou, o responsável ou quem responde pelo escopo escala.');
      if (!OPEN_IMPEDIMENT.includes(i.status as ImpedimentStatus)) throw unprocessable('O impedimento já foi encerrado.');
      if (i.rowVersion !== body.rowVersion) throw conflict(i.rowVersion);
      const chain = escalationChain(await orgData(tx, auth.tenantId), i);
      const pos = chain.indexOf(i.ownerId);
      const to = chain.slice(pos + 1).find((p) => p !== i.ownerId);
      if (!to) throw unprocessable('Não há ninguém acima na estrutura para escalar.');
      await tx.update(s.impediments).set({ ownerId: to, escalations: sql`${s.impediments.escalations} + 1`, updatedAt: new Date(), rowVersion: sql`${s.impediments.rowVersion} + 1` }).where(eq(s.impediments.id, i.id));
      await gov(tx, auth, 'impedimento', i.id, 'escalado', { from: i.ownerId, to, reason: body.reason, title: i.title }, [to, i.ownerId, i.raisedBy]);
      return { ok: true, ownerId: to };
    }),
  }),
  defineRoute({
    method: 'GET', url: '/governance/:id/history', summary: 'Histórico (append-only) de um ritual, reunião, decisão ou impedimento', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const rows = await app.db.select({ e: s.governanceEvents, actorName: s.users.name }).from(s.governanceEvents).leftJoin(s.users, eq(s.users.id, s.governanceEvents.actorId)).where(and(eq(s.governanceEvents.tenantId, auth.tenantId), eq(s.governanceEvents.entityId, params.id))).orderBy(desc(s.governanceEvents.createdAt));
      if (!rows.length) return { items: [] };
      // visibilidade: só devolve se a pessoa vê a entidade
      const ent = rows[0]!.e.entity;
      if (ent === 'reuniao') await loadMeeting(app.db, auth, params.id);
      else if (ent === 'ritual') await loadRitual(app.db, auth, params.id);
      else {
        const sc = await resultsScope(app.db, auth);
        const [x] = ent === 'decisao' ? await app.db.select().from(s.decisions).where(eq(s.decisions.id, params.id)) : await app.db.select().from(s.impediments).where(eq(s.impediments.id, params.id));
        if (!x || !seeItem(sc, auth, x as never)) throw notFound('Registro não encontrado.');
      }
      await app.db.insert(s.governanceReads).values({ userId: auth.userId, entityId: params.id }).onConflictDoUpdate({ target: [s.governanceReads.userId, s.governanceReads.entityId], set: { lastReadAt: new Date() } });
      return { items: rows.map((r) => ({ ...r.e, actorName: r.actorName })) };
    },
  }),
];

