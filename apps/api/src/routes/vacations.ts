/** Gestão de Times → Férias: calendário por time, sugestão automática sem choque, ajustes da liderança, regras e aviso antes do gozo. */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { acquisitivePeriods, isoAddDays, atLeast, periodBalance, suggestVacations, vacationErrors, vacationSettingsErrors, type VacationSettings } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { admissions, asVacation, canManageVacation, canSeeVacation, ensureVacationAlerts, vacationOrg, vacationRows, vacationSettingsOf, todayIn } from '../services/vacations';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const canConfigure = (auth: AuthContext) => atLeast(level(auth, 'configuracoes'), 'total') || level(auth, 'resultados') === 'total';
const lock = (db: DbOrTx, tenantId: string) => db.execute(sql`select pg_advisory_xact_lock(hashtext(${`ferias:${tenantId}`}))`);
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

async function history(db: DbOrTx, auth: AuthContext, vacationId: string, type: string, payload: Record<string, unknown>, notify: string[]) {
  await db.insert(s.governanceEvents).values({ tenantId: auth.tenantId, entity: 'ferias', entityId: vacationId, type, actorId: auth.userId, payload, notify: notify.filter((u) => u !== auth.userId) });
}

/** Valida o bloco contra as regras e o time; lança 422 com as mensagens. */
async function check(db: DbOrTx, auth: AuthContext, v: { id?: string; userId: string; periodStart: string; startDate: string; days: number; status: 'sugerida' | 'programada' }, settings: VacationSettings) {
  const [org, all, adm] = await Promise.all([vacationOrg(db, auth.tenantId), vacationRows(db, auth.tenantId), admissions(db, auth.tenantId)]);
  if (!adm[v.userId]) throw unprocessable('Informe a admissão da pessoa antes de programar as férias.');
  const names = Object.fromEntries(org.people.map((p) => [p.id, p.name]));
  const r = vacationErrors({ ...v }, { others: all.map(asVacation), teams: org.teams, admission: adm[v.userId]!, settings, today: todayIn(auth.timezone), names });
  if (r.errors.length) throw unprocessable(r.errors.join(' '), r.errors.map((m) => ({ path: 'startDate', message: m })));
  return { org, names };
}

export const vacationRoutes = [
  defineRoute({
    method: 'GET', url: '/times/ferias', summary: 'Férias: pessoas dos meus times (admissão, períodos e saldo), blocos sugeridos e programados, e o que eu posso gerenciar', tag: 'Gestão de Times', module: 'resultados',
    handler: async ({ app, auth }) => {
      const today = todayIn(auth.timezone);
      await ensureVacationAlerts(app.db, app.config, auth.tenantId, today);
      const [{ settings, version }, org, rows, adm] = await Promise.all([vacationSettingsOf(app.db, auth.tenantId), vacationOrg(app.db, auth.tenantId), vacationRows(app.db, auth.tenantId), admissions(app.db, auth.tenantId)]);
      const all = rows.map(asVacation);
      const people = org.people.filter((p) => canSeeVacation(auth, org, p.id)).map((p) => {
        const a = adm[p.id] ?? null;
        const periods = a ? acquisitivePeriods(a, isoAddDays(today, 400)).filter((x) => x.concessiveEnd >= isoAddDays(today, -365)).map((x) => ({ ...x, balance: periodBalance(all, p.id, x.start, settings), expired: x.concessiveEnd < today })) : [];
        return { id: p.id, name: p.name, teamIds: p.teamIds, admissionDate: a, canManage: canManageVacation(auth, org, p.id), periods };
      });
      const seen = new Set(people.map((p) => p.id));
      return {
        today, settings, settingsVersion: version, canConfigure: canConfigure(auth),
        teams: Object.entries(org.teamNames).map(([id, name]) => ({ id, name, leads: org.leads[id] ?? [] })).filter((t) => people.some((p) => p.teamIds.includes(t.id))),
        people,
        vacations: rows.filter((r) => seen.has(r.userId)).map((r) => ({ id: r.id, userId: r.userId, periodStart: r.periodStart, startDate: r.startDate, endDate: isoAddDays(r.startDate, r.days - 1), days: r.days, status: r.status, source: r.source, note: r.note, alertedAt: r.alertedAt })),
      };
    },
  }),

  defineRoute({
    method: 'PUT', url: '/times/ferias/people/:id/admission', summary: 'Admissão da pessoa (base dos períodos aquisitivos)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ admissionDate: isoDate }),
    handler: async ({ app, auth, params, body }) => {
      const org = await vacationOrg(app.db, auth.tenantId);
      if (!canManageVacation(auth, org, params.id)) throw forbidden('Só a liderança da pessoa (ou quem tem nível Total) informa a admissão.');
      if (body.admissionDate > todayIn(auth.timezone)) throw unprocessable('A admissão não pode ser no futuro.');
      await app.db.insert(s.vacationPeople).values({ tenantId: auth.tenantId, userId: params.id, admissionDate: body.admissionDate, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: [s.vacationPeople.tenantId, s.vacationPeople.userId], set: { admissionDate: body.admissionDate, updatedBy: auth.userId, updatedAt: new Date() } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST', url: '/times/ferias/suggest', summary: 'Sugestão automática (sem choque no time): refaz as sugeridas das pessoas que eu gerencio; as programadas ficam', tag: 'Gestão de Times', module: 'resultados',
    body: z.object({ teamId: z.string().uuid().nullable().optional() }),
    handler: async ({ app, auth, body, reply }) => {
      const today = todayIn(auth.timezone);
      const out = await app.db.transaction(async (tx) => {
        await lock(tx, auth.tenantId);
        const [{ settings }, org, adm] = await Promise.all([vacationSettingsOf(tx, auth.tenantId), vacationOrg(tx, auth.tenantId), admissions(tx, auth.tenantId)]);
        const targets = org.people.filter((p) => canManageVacation(auth, org, p.id) && (!body.teamId || p.teamIds.includes(body.teamId)));
        if (!targets.length) throw forbidden('Você não gerencia férias de ninguém neste time.');
        const ids = targets.map((p) => p.id);
        // as sugestões antigas dessas pessoas saem (canceladas, ficam no histórico) e são refeitas
        const old = await tx.update(s.vacations).set({ status: 'cancelada', updatedAt: new Date() })
          .where(and(eq(s.vacations.tenantId, auth.tenantId), inArray(s.vacations.userId, ids), eq(s.vacations.status, 'sugerida'))).returning({ id: s.vacations.id });
        for (const o of old) await history(tx, auth, o.id, 'cancelada', { title: 'Sugestão refeita' }, []);
        const existing = (await vacationRows(tx, auth.tenantId)).map(asVacation);
        const withAdm = targets.filter((p) => adm[p.id]);
        const sug = suggestVacations({ people: withAdm.map((p) => ({ userId: p.id, admission: adm[p.id]! })), existing, teams: org.teams, settings, today });
        const names = Object.fromEntries(org.people.map((p) => [p.id, p.name]));
        const created: string[] = [];
        for (const x of sug) {
          if (!x.startDate) continue;
          const [row] = await tx.insert(s.vacations).values({ tenantId: auth.tenantId, userId: x.userId, periodStart: x.periodStart, startDate: x.startDate, days: x.days, status: 'sugerida', source: 'automatica', createdBy: auth.userId }).returning();
          await history(tx, auth, row!.id, 'sugerida', { title: `Férias sugeridas para ${names[x.userId]}: ${br(x.startDate)}, ${x.days} dias` }, [x.userId]);
          created.push(row!.id);
        }
        return {
          created: created.length,
          unplaced: sug.filter((x) => !x.startDate).map((x) => ({ userId: x.userId, name: names[x.userId], periodStart: x.periodStart, days: x.days, concessiveEnd: x.concessiveEnd, reason: 'reason' in x ? x.reason : '' })),
          withoutAdmission: targets.filter((p) => !adm[p.id]).map((p) => ({ userId: p.id, name: p.name })),
        };
      });
      reply.code(201);
      return out;
    },
  }),

  defineRoute({
    method: 'POST', url: '/times/ferias', summary: 'Programa um bloco de férias manualmente (valida regras e choque no time)', tag: 'Gestão de Times', module: 'resultados',
    body: z.object({ userId: z.string().uuid(), periodStart: isoDate, startDate: isoDate, days: z.number().int().min(1).max(60), status: z.enum(['sugerida', 'programada']).default('programada'), note: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, body, reply }) => {
      const row = await app.db.transaction(async (tx) => {
        await lock(tx, auth.tenantId);
        const org = await vacationOrg(tx, auth.tenantId);
        if (!canManageVacation(auth, org, body.userId)) throw forbidden('Só a liderança da pessoa (ou quem tem nível Total) programa as férias.');
        const { settings } = await vacationSettingsOf(tx, auth.tenantId);
        const { names } = await check(tx, auth, { userId: body.userId, periodStart: body.periodStart, startDate: body.startDate, days: body.days, status: body.status }, settings);
        const [r] = await tx.insert(s.vacations).values({ tenantId: auth.tenantId, userId: body.userId, periodStart: body.periodStart, startDate: body.startDate, days: body.days, status: body.status, source: 'manual', note: body.note ?? null, createdBy: auth.userId }).returning();
        await history(tx, auth, r!.id, body.status, { title: `Férias ${body.status === 'programada' ? 'programadas' : 'sugeridas'} para ${names[body.userId]}: ${br(body.startDate)}, ${body.days} dias` }, [body.userId]);
        return r!;
      });
      reply.code(201);
      return row;
    },
  }),

  defineRoute({
    method: 'PATCH', url: '/times/ferias/:id', summary: 'Muda datas ou dias, confirma (programada) ou cancela um bloco; tudo fica no histórico', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    body: z.object({ startDate: isoDate.optional(), days: z.number().int().min(1).max(60).optional(), status: z.enum(['sugerida', 'programada', 'cancelada']).optional(), note: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      await lock(tx, auth.tenantId);
      const [cur] = await tx.select().from(s.vacations).where(and(eq(s.vacations.id, params.id), eq(s.vacations.tenantId, auth.tenantId))).limit(1);
      if (!cur) throw notFound('Férias não encontradas.');
      const org = await vacationOrg(tx, auth.tenantId);
      if (!canManageVacation(auth, org, cur.userId)) throw forbidden('Só a liderança da pessoa (ou quem tem nível Total) altera as férias.');
      if (cur.status === 'cancelada') throw unprocessable('Férias canceladas não mudam: programe um novo bloco.');
      const next = { startDate: body.startDate ?? cur.startDate, days: body.days ?? cur.days, status: body.status ?? cur.status };
      const names = Object.fromEntries(org.people.map((p) => [p.id, p.name]));
      if (next.status !== 'cancelada') {
        const { settings } = await vacationSettingsOf(tx, auth.tenantId);
        await check(tx, auth, { id: cur.id, userId: cur.userId, periodStart: cur.periodStart, startDate: next.startDate, days: next.days, status: next.status as 'sugerida' | 'programada' }, settings);
      }
      const datesChanged = next.startDate !== cur.startDate || next.days !== cur.days;
      const [r] = await tx.update(s.vacations).set({ ...next, note: body.note === undefined ? cur.note : body.note, ...(datesChanged ? { alertedAt: null } : {}), updatedAt: new Date() }).where(eq(s.vacations.id, cur.id)).returning();
      const type = next.status === 'cancelada' ? 'cancelada' : next.status === 'programada' && cur.status !== 'programada' ? 'programada' : 'alterada';
      const what = `${br(next.startDate)}, ${next.days} dias`;
      await history(tx, auth, cur.id, type, { title: type === 'cancelada' ? `Férias de ${names[cur.userId]} canceladas (${br(cur.startDate)})` : type === 'programada' ? `Férias de ${names[cur.userId]} programadas: ${what}` : `Férias de ${names[cur.userId]} alteradas: ${br(cur.startDate)}, ${cur.days} dias → ${what}` }, [cur.userId]);
      return r!;
    }),
  }),

  defineRoute({
    method: 'GET', url: '/times/ferias/:id/history', summary: 'Histórico do bloco de férias (append-only)', tag: 'Gestão de Times', module: 'resultados', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [cur] = await app.db.select().from(s.vacations).where(and(eq(s.vacations.id, params.id), eq(s.vacations.tenantId, auth.tenantId))).limit(1);
      if (!cur) throw notFound('Férias não encontradas.');
      if (!canSeeVacation(auth, await vacationOrg(app.db, auth.tenantId), cur.userId)) throw notFound('Férias não encontradas.');
      const items = await app.db.select({ type: s.governanceEvents.type, payload: s.governanceEvents.payload, at: s.governanceEvents.createdAt, by: s.users.name }).from(s.governanceEvents).leftJoin(s.users, eq(s.users.id, s.governanceEvents.actorId))
        .where(and(eq(s.governanceEvents.tenantId, auth.tenantId), eq(s.governanceEvents.entity, 'ferias'), eq(s.governanceEvents.entityId, cur.id))).orderBy(desc(s.governanceEvents.createdAt));
      return { items };
    },
  }),

  defineRoute({
    method: 'GET', url: '/times/ferias/settings', summary: 'Regras de férias vigentes e histórico de versões', tag: 'Gestão de Times', module: 'resultados',
    handler: async ({ app, auth }) => {
      const cur = await vacationSettingsOf(app.db, auth.tenantId);
      const history = await app.db.select({ version: s.vacationSettings.version, config: s.vacationSettings.config, note: s.vacationSettings.note, createdAt: s.vacationSettings.createdAt, by: s.users.name }).from(s.vacationSettings).leftJoin(s.users, eq(s.users.id, s.vacationSettings.createdBy))
        .where(eq(s.vacationSettings.tenantId, auth.tenantId)).orderBy(desc(s.vacationSettings.version));
      return { ...cur, history, canConfigure: canConfigure(auth) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/times/ferias/settings', summary: 'Publica nova versão das regras de férias', tag: 'Gestão de Times', module: 'resultados',
    body: z.object({ daysPerPeriod: z.number().int(), maxSplits: z.number().int(), minMainBlockDays: z.number().int(), minBlockDays: z.number().int(), alertDaysBefore: z.number().int(), blockedStartWeekdays: z.array(z.number().int()).max(6), preferredStartWeekday: z.number().int(), note: z.string().trim().min(3).max(300) }),
    handler: async ({ app, auth, body, reply }) => {
      if (!canConfigure(auth)) throw forbidden('Só quem administra a Gestão de Times publica as regras de férias.');
      const { note, ...cfg } = body;
      const errs = vacationSettingsErrors(cfg);
      if (errs.length) throw unprocessable(errs.join(' '));
      const cur = await vacationSettingsOf(app.db, auth.tenantId);
      await app.db.insert(s.vacationSettings).values({ tenantId: auth.tenantId, version: cur.version + 1, config: cfg as unknown as Record<string, unknown>, note, createdBy: auth.userId });
      reply.code(201);
      return { settings: cfg, version: cur.version + 1 };
    },
  }),
];
