/**
 * Pessoas & Gestão — vínculo de liderança com vigência, derivado dos times e das unidades (sem cadastro paralelo).
 *  - Membro do time → líder(es) do time (source "time").
 *  - Líder do time → gestores do time ou, sem gestor, o responsável da unidade acima (source "gestao").
 * A sincronização fecha os vínculos que deixaram de existir (valid_to) e abre os novos (valid_from). Assim a nova
 * liderança só enxerga o que for registrado a partir do vínculo dela.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';

type Line = { userId: string; managerId: string; source: 'time' | 'gestao'; teamId: string | null; orgUnitId: string | null };
const lastSync = new Map<string, number>();

export async function expectedLines(db: DbOrTx, tenantId: string): Promise<Line[]> {
  const [teams, members, units, users] = await Promise.all([
    db.select({ id: s.teams.id, orgUnitId: s.teams.orgUnitId, managerIds: s.teams.managerIds }).from(s.teams).where(and(eq(s.teams.tenantId, tenantId), eq(s.teams.active, true), isNull(s.teams.deletedAt))),
    db.select({ teamId: s.teamMemberships.teamId, userId: s.teamMemberships.userId, isLead: s.teamMemberships.isLead }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(eq(s.teams.tenantId, tenantId)),
    db.select({ id: s.orgUnits.id, parentId: s.orgUnits.parentId, responsibleId: s.orgUnits.responsibleId, active: s.orgUnits.active }).from(s.orgUnits).where(eq(s.orgUnits.tenantId, tenantId)),
    db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true))),
  ]);
  const active = new Set(users.map((u) => u.id));
  const unit = new Map(units.map((u) => [u.id, u]));
  const out = new Map<string, Line>();
  const add = (l: Line) => { if (l.userId !== l.managerId && active.has(l.userId) && active.has(l.managerId)) out.set(`${l.userId}:${l.managerId}`, out.get(`${l.userId}:${l.managerId}`) ?? l); };
  /** responsável da unidade (subindo até achar alguém diferente da própria pessoa) */
  const unitHead = (unitId: string | null, not: string) => { for (let c = unitId, g = 0; c && g < 30; g++) { const u = unit.get(c); if (!u) break; if (u.active && u.responsibleId && u.responsibleId !== not) return { id: u.responsibleId, unitId: u.id }; c = u.parentId; } return null; };
  for (const t of teams) {
    const ms = members.filter((m) => m.teamId === t.id);
    const leads = ms.filter((m) => m.isLead).map((m) => m.userId);
    for (const m of ms.filter((x) => !x.isLead)) for (const l of leads) add({ userId: m.userId, managerId: l, source: 'time', teamId: t.id, orgUnitId: t.orgUnitId });
    for (const l of leads) {
      const managers = t.managerIds.filter((g) => g !== l);
      if (managers.length) for (const g of managers) add({ userId: l, managerId: g, source: 'gestao', teamId: t.id, orgUnitId: t.orgUnitId });
      else { const h = unitHead(t.orgUnitId, l); if (h) add({ userId: l, managerId: h.id, source: 'gestao', teamId: t.id, orgUnitId: h.unitId }); }
    }
  }
  return [...out.values()];
}

/** Ajusta os vínculos abertos ao que os times e as unidades dizem hoje. Barata o bastante para rodar sob demanda. */
export async function syncReportingLines(db: DbOrTx, tenantId: string, opts: { force?: boolean } = {}) {
  const now = Date.now();
  if (!opts.force && now - (lastSync.get(tenantId) ?? 0) < 60_000) return { opened: 0, closed: 0 };
  lastSync.set(tenantId, now);
  const want = await expectedLines(db, tenantId);
  const open = await db.select().from(s.reportingLines).where(and(eq(s.reportingLines.tenantId, tenantId), isNull(s.reportingLines.validTo)));
  const wantKeys = new Set(want.map((l) => `${l.userId}:${l.managerId}`));
  const openKeys = new Set(open.map((l) => `${l.userId}:${l.managerId}`));
  const toClose = open.filter((l) => !wantKeys.has(`${l.userId}:${l.managerId}`));
  const toOpen = want.filter((l) => !openKeys.has(`${l.userId}:${l.managerId}`));
  for (const l of toClose) await db.update(s.reportingLines).set({ validTo: new Date() }).where(eq(s.reportingLines.id, l.id));
  if (toOpen.length) await db.insert(s.reportingLines).values(toOpen.map((l) => ({ tenantId, ...l }))).onConflictDoNothing();
  return { opened: toOpen.length, closed: toClose.length };
}

/** Lideranças vigentes da pessoa. */
export async function managersOf(db: DbOrTx, tenantId: string, userId: string) {
  return (await db.select({ managerId: s.reportingLines.managerId }).from(s.reportingLines).where(and(eq(s.reportingLines.tenantId, tenantId), eq(s.reportingLines.userId, userId), isNull(s.reportingLines.validTo)))).map((r) => r.managerId);
}

/** Liderados diretos vigentes. */
export async function reportsOf(db: DbOrTx, tenantId: string, managerId: string) {
  return (await db.select({ userId: s.reportingLines.userId }).from(s.reportingLines).where(and(eq(s.reportingLines.tenantId, tenantId), eq(s.reportingLines.managerId, managerId), isNull(s.reportingLines.validTo)))).map((r) => r.userId);
}

/** O vínculo valia na data? (para não abrir histórico a quem chegou depois) */
export async function wasManagerAt(db: DbOrTx, tenantId: string, managerId: string, userId: string, at: Date) {
  const [r] = await db.select({ id: s.reportingLines.id }).from(s.reportingLines)
    .where(and(eq(s.reportingLines.tenantId, tenantId), eq(s.reportingLines.managerId, managerId), eq(s.reportingLines.userId, userId), sql`${s.reportingLines.validFrom} <= ${at}`, sql`(${s.reportingLines.validTo} is null or ${s.reportingLines.validTo} > ${at})`)).limit(1);
  return !!r;
}
