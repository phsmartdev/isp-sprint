/** Gestão de Times → Férias: regras da empresa, quem gerencia quem, contexto de validação e aviso N dias antes. */
import { seesAllTeams } from './results';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { isoAddDays, vacationEnd, vacationNeedsAlert, vacationSettingsErrors, type TeamMap, type Vacation, type VacationSettings } from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { level } from './scope';
import { publicLink } from './alerts';
import { sendAlert, smtpConfig } from './email';

/** Ponto de partida quando a empresa ainda não publicou regras (CLT): fica gravado como versão 1, editável em Configurações. */
const CLT_START: VacationSettings = { daysPerPeriod: 30, maxSplits: 3, minMainBlockDays: 14, minBlockDays: 5, alertDaysBefore: 30, blockedStartWeekdays: [5, 6], preferredStartWeekday: 1 };

export async function vacationSettingsOf(db: DbOrTx, tenantId: string): Promise<{ settings: VacationSettings; version: number }> {
  const [cur] = await db.select().from(s.vacationSettings).where(eq(s.vacationSettings.tenantId, tenantId)).orderBy(desc(s.vacationSettings.version)).limit(1);
  if (cur) return { settings: { ...CLT_START, ...(cur.config as Partial<VacationSettings>) }, version: cur.version };
  await db.insert(s.vacationSettings).values({ tenantId, version: 1, config: CLT_START as unknown as Record<string, unknown>, note: 'Ponto de partida (regras da CLT)' }).onConflictDoNothing();
  return { settings: CLT_START, version: 1 };
}
export { vacationSettingsErrors };

export type VacationOrg = { teams: TeamMap; leads: Record<string, string[]>; teamNames: Record<string, string>; people: { id: string; name: string; teamIds: string[] }[]; /** gestores do time e responsáveis (e substitutos) das unidades acima dele */ managers: Record<string, string[]> };

/** Times ativos, membros, líderes (e substitutos) da empresa. */
export async function vacationOrg(db: DbOrTx, tenantId: string): Promise<VacationOrg> {
  const rows = await db.select({ teamId: s.teams.id, teamName: s.teams.name, sub: s.teams.substituteLeadId, userId: s.teamMemberships.userId, isLead: s.teamMemberships.isLead, name: s.users.name })
    .from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).innerJoin(s.users, eq(s.users.id, s.teamMemberships.userId))
    .where(and(eq(s.teams.tenantId, tenantId), eq(s.teams.active, true), eq(s.users.active, true))).orderBy(asc(s.users.name));
  const teams: TeamMap = {}, leads: Record<string, string[]> = {}, teamNames: Record<string, string> = {};
  const people = new Map<string, { id: string; name: string; teamIds: string[] }>();
  for (const r of rows) {
    teamNames[r.teamId] = r.teamName;
    (teams[r.userId] ??= []).push(r.teamId);
    leads[r.teamId] ??= [];
    if (r.isLead) leads[r.teamId]!.push(r.userId);
    if (r.sub && !leads[r.teamId]!.includes(r.sub)) leads[r.teamId]!.push(r.sub);
    const p = people.get(r.userId) ?? { id: r.userId, name: r.name, teamIds: [] };
    p.teamIds.push(r.teamId);
    people.set(r.userId, p);
  }
  const [tms, units] = await Promise.all([
    db.select({ id: s.teams.id, orgUnitId: s.teams.orgUnitId, managerIds: s.teams.managerIds }).from(s.teams).where(eq(s.teams.tenantId, tenantId)),
    db.select({ id: s.orgUnits.id, parentId: s.orgUnits.parentId, responsibleId: s.orgUnits.responsibleId, substituteId: s.orgUnits.substituteId, active: s.orgUnits.active }).from(s.orgUnits).where(eq(s.orgUnits.tenantId, tenantId)),
  ]);
  const managers: Record<string, string[]> = {};
  for (const t of tms) {
    const out = new Set(t.managerIds);
    let u = t.orgUnitId;
    for (let i = 0; u && i < 20; i++) { const x = units.find((y) => y.id === u); if (!x) break; if (x.active) { if (x.responsibleId) out.add(x.responsibleId); if (x.substituteId) out.add(x.substituteId); } u = x.parentId; }
    managers[t.id] = [...out];
  }
  return { teams, leads, teamNames, people: [...people.values()], managers };
}

/** Quem lidera a pessoa: líderes e substitutos dos times dela, gestores desses times e responsáveis pelas áreas acima (menos ela mesma). */
export const leadersOf = (org: VacationOrg, userId: string) => [...new Set((org.teams[userId] ?? []).flatMap((t) => [...(org.leads[t] ?? []), ...(org.managers[t] ?? [])]))].filter((u) => u !== userId);
/** Lidera ou gere o time (inclui responsáveis pelas áreas acima). */
export const leadsOrManages = (org: VacationOrg, teamId: string, userId: string) => (org.leads[teamId] ?? []).includes(userId) || (org.managers[teamId] ?? []).includes(userId);

/** Gerencia as férias da pessoa: quem administra o sistema, ou lidera/gere um time dela. Ninguém aprova as próprias. */
export function canManageVacation(auth: AuthContext, org: VacationOrg, userId: string) {
  if (seesAllTeams(auth)) return true;
  return userId !== auth.userId && leadersOf(org, userId).includes(auth.userId);
}
/** Vê as férias da pessoa: ela, quem divide time com ela (para planejar sem choque) e quem a gerencia. */
export function canSeeVacation(auth: AuthContext, org: VacationOrg, userId: string) {
  if (userId === auth.userId || canManageVacation(auth, org, userId)) return true;
  return (org.teams[userId] ?? []).some((t) => (org.teams[auth.userId] ?? []).includes(t));
}

export async function vacationRows(db: DbOrTx, tenantId: string) {
  return db.select().from(s.vacations).where(and(eq(s.vacations.tenantId, tenantId), ne(s.vacations.status, 'cancelada'))).orderBy(asc(s.vacations.startDate));
}
export const asVacation = (r: typeof s.vacations.$inferSelect): Vacation => ({ id: r.id, userId: r.userId, startDate: r.startDate, days: r.days, periodStart: r.periodStart, status: r.status as Vacation['status'] });

export async function admissions(db: DbOrTx, tenantId: string) {
  const rows = await db.select().from(s.vacationPeople).where(eq(s.vacationPeople.tenantId, tenantId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.admissionDate])) as Record<string, string>;
}

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Aviso N dias antes (N = configurações): para a pessoa e a liderança, uma vez por bloco programado, com as tarefas abertas que vencem no período.
 * Vai para o sino (eventos de gestão) e, com SMTP configurado, por e-mail. Idempotente: marca alerted_at.
 */
export async function ensureVacationAlerts(db: DbOrTx, config: Config | null, tenantId: string, today: string) {
  const { settings } = await vacationSettingsOf(db, tenantId);
  const due = await db.select({ v: s.vacations, name: s.users.name }).from(s.vacations).innerJoin(s.users, eq(s.users.id, s.vacations.userId))
    .where(and(eq(s.vacations.tenantId, tenantId), eq(s.vacations.status, 'programada'), isNull(s.vacations.alertedAt),
      sql`${s.vacations.startDate} between ${today}::date and (${today}::date + ${settings.alertDaysBefore}::int)`));
  const pending = due.filter((d) => vacationNeedsAlert({ startDate: d.v.startDate, status: 'programada', alertedAt: null }, today, settings));
  if (!pending.length) return 0;
  const org = await vacationOrg(db, tenantId);
  const smtp = config ? await smtpConfig(db, tenantId) : null;
  let n = 0;
  for (const { v, name } of pending) {
    const end = vacationEnd(v);
    // trava por linha: só um processo avisa
    const claimed = await db.update(s.vacations).set({ alertedAt: new Date() }).where(and(eq(s.vacations.id, v.id), isNull(s.vacations.alertedAt))).returning({ id: s.vacations.id });
    if (!claimed.length) continue;
    const tasks = await db.select({ id: s.activities.id, title: s.activities.title, dueAt: s.activities.dueAt }).from(s.activities)
      .where(and(eq(s.activities.tenantId, tenantId), eq(s.activities.ownerId, v.userId), isNull(s.activities.deletedAt),
        sql`${s.activities.status} not in ('concluida','cancelada')`, sql`${s.activities.dueAt} is not null and (${s.activities.dueAt} at time zone 'America/Bahia')::date between ${v.startDate}::date and ${end}::date`))
      .orderBy(asc(s.activities.dueAt)).limit(50);
    const leaders = leadersOf(org, v.userId);
    const title = `Férias de ${name} em ${settings.alertDaysBefore === 0 ? 'breve' : `${Math.max(0, Math.round((Date.parse(v.startDate) - Date.parse(today)) / 86_400_000))} dias`} (${br(v.startDate)} a ${br(end)}): revise as rotinas e tarefas do período`;
    await db.insert(s.governanceEvents).values({ tenantId, entity: 'ferias', entityId: v.id, type: 'alerta', notify: [v.userId, ...leaders], payload: { title, userId: v.userId, startDate: v.startDate, endDate: end, tasks: tasks.length } });
    n++;
    if (smtp && config) {
      const people = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users).where(and(inArray(s.users.id, [v.userId, ...leaders]), eq(s.users.active, true)));
      const list = tasks.length ? `\n\nTarefas abertas com prazo no período (${tasks.length}):\n${tasks.map((t) => `- ${t.title}${t.dueAt ? ` (${br(t.dueAt.toISOString().slice(0, 10))})` : ''}`).join('\n')}` : '\n\nNão há tarefas abertas com prazo no período.';
      for (const p of people) {
        await sendAlert(db, { tenantId, kind: 'alerta_ferias', to: p.email, subject: title, text: `Olá, ${p.name}.\n\n${p.id === v.userId ? 'Suas férias' : `As férias de ${name}`} vão de ${br(v.startDate)} a ${br(end)}. É preciso rever as rotinas e as tarefas desse período: redistribuir, antecipar ou combinar quem cobre.${list}\n\nAbrir: ${publicLink(config, '/times/ferias')}` });
      }
    }
  }
  return n;
}

export const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export { isoAddDays };
