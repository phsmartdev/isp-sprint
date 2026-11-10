/**
 * Dados institucionais de quem aparece no módulo: sempre lidos do cadastro existente
 * (usuário, foto, times e estrutura organizacional), nunca copiados.
 * Não expõe CPF, remuneração nem dados trabalhistas: o módulo só lê nome, cargo, foto, times e unidades.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';

export type Institutional = { id: string; name: string; jobTitle: string | null; hasPhoto: boolean; active: boolean; email: string; phone: string | null; teams: string[]; area: string | null; unit: string | null };

export async function institutionalOf(db: DbOrTx, tenantId: string, userIds: string[]): Promise<Map<string, Institutional>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, Institutional>();
  if (!ids.length) return out;
  const [users, photos, memberships, units] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name, jobTitle: s.users.jobTitle, active: s.users.active, email: s.users.email, phone: s.users.phone }).from(s.users).where(and(eq(s.users.tenantId, tenantId), inArray(s.users.id, ids))),
    db.select({ userId: s.userAvatars.userId }).from(s.userAvatars).where(inArray(s.userAvatars.userId, ids)),
    db.select({ userId: s.teamMemberships.userId, team: s.teams.name, orgUnitId: s.teams.orgUnitId })
      .from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId))
      .where(and(inArray(s.teamMemberships.userId, ids), eq(s.teams.tenantId, tenantId), isNull(s.teams.deletedAt))),
    db.select({ id: s.orgUnits.id, name: s.orgUnits.name, kind: s.orgUnits.kind, parentId: s.orgUnits.parentId }).from(s.orgUnits).where(and(eq(s.orgUnits.tenantId, tenantId), eq(s.orgUnits.active, true))),
  ]);
  const byId = new Map(units.map((u) => [u.id, u]));
  // sobe na estrutura a partir da unidade do time: a primeira "unidade" e a primeira "área" encontradas
  const resolve = (start: string | null) => {
    let unit: string | null = null, area: string | null = null;
    for (let cur = start ? byId.get(start) : undefined, guard = 0; cur && guard < 20; cur = cur.parentId ? byId.get(cur.parentId) : undefined, guard++) {
      if (!unit && cur.kind === 'unidade') unit = cur.name;
      if (!area && cur.kind === 'area') area = cur.name;
    }
    return { unit, area };
  };
  const hasPhoto = new Set(photos.map((p) => p.userId));
  for (const u of users) {
    const mine = memberships.filter((m) => m.userId === u.id);
    const org = mine.map((m) => resolve(m.orgUnitId)).find((x) => x.unit || x.area) ?? { unit: null, area: null };
    out.set(u.id, { ...u, hasPhoto: hasPhoto.has(u.id), teams: [...new Set(mine.map((m) => m.team))].sort(), area: org.area, unit: org.unit });
  }
  return out;
}

/** O que um colega pode ver de outro: institucional + o que a pessoa escolheu mostrar. */
export function publicCard(i: Institutional) {
  return { id: i.id, name: i.name, jobTitle: i.jobTitle, hasPhoto: i.hasPhoto, area: i.area, unit: i.unit };
}
