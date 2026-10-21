/**
 * Gestão de Resultados — estrutura e escopo (Fase 2).
 * Perspectiva vem de responsabilidade explícita na estrutura, nunca do cargo:
 *  - Diretoria: responsável ou substituto de uma unidade do tipo diretoria;
 *  - Gestão: responsável ou substituto de uma área/unidade;
 *  - Liderança: líder ou líder substituto de um time.
 * Quem tem nível Total no módulo vê tudo e pode abrir as três perspectivas (autorização explícita na matriz).
 * O escopo de dados é a união das unidades sob responsabilidade (com as filhas) e dos times liderados.
 */
import { and, eq } from 'drizzle-orm';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from './scope';

export type Perspective = 'diretoria' | 'gestao' | 'lideranca';
export const PERSPECTIVE_LABELS: Record<Perspective, string> = { diretoria: 'Diretoria', gestao: 'Gestão', lideranca: 'Liderança' };

export function descendants(units: { id: string; parentId: string | null }[], roots: string[]): string[] {
  const out = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) if (u.parentId && out.has(u.parentId) && !out.has(u.id)) { out.add(u.id); grew = true; }
  }
  return [...out];
}

/** Recusa ciclos: o novo pai não pode estar abaixo da própria unidade. */
export function createsUnitCycle(units: { id: string; parentId: string | null }[], id: string, parentId: string | null) {
  if (!parentId) return false;
  return descendants(units, [id]).includes(parentId);
}

export async function orgData(db: DbOrTx, tenantId: string) {
  const [units, teams, members] = await Promise.all([
    db.select().from(s.orgUnits).where(eq(s.orgUnits.tenantId, tenantId)),
    db.select().from(s.teams).where(eq(s.teams.tenantId, tenantId)),
    db.select({ teamId: s.teamMemberships.teamId, userId: s.teamMemberships.userId, isLead: s.teamMemberships.isLead }).from(s.teamMemberships).innerJoin(s.teams, and(eq(s.teams.id, s.teamMemberships.teamId), eq(s.teams.tenantId, tenantId))),
  ]);
  return { units, teams, members };
}

export type ResultsScope = {
  perspectives: Perspective[];
  all: boolean;
  unitIds: string[];
  teamIds: string[];
  userIds: string[];
  /** por perspectiva: onde a pessoa responde */
  roles: { perspective: Perspective; unitId: string | null; teamId: string | null; name: string; substitute: boolean }[];
};

export async function resultsScope(db: DbOrTx, auth: AuthContext): Promise<ResultsScope> {
  const { units, teams, members } = await orgData(db, auth.tenantId);
  const active = units.filter((u) => u.active);
  const roles: ResultsScope['roles'] = [];
  for (const u of active) {
    const mine = u.responsibleId === auth.userId ? 'resp' : u.substituteId === auth.userId ? 'sub' : null;
    if (mine) roles.push({ perspective: u.kind === 'diretoria' ? 'diretoria' : 'gestao', unitId: u.id, teamId: null, name: u.name, substitute: mine === 'sub' });
  }
  for (const t of teams) {
    const lead = members.some((m) => m.teamId === t.id && m.userId === auth.userId && m.isLead);
    if (lead || t.substituteLeadId === auth.userId) roles.push({ perspective: 'lideranca', unitId: t.orgUnitId, teamId: t.id, name: t.name, substitute: !lead });
  }
  const all = level(auth, 'resultados') === 'total';
  if (all) {
    const allUsers = [...new Set(members.map((m) => m.userId).concat(auth.userId))];
    return { perspectives: ['diretoria', 'gestao', 'lideranca'], all: true, unitIds: active.map((u) => u.id), teamIds: teams.map((t) => t.id), userIds: allUsers, roles };
  }
  const unitIds = descendants(active, roles.filter((r) => r.unitId && r.perspective !== 'lideranca').map((r) => r.unitId!));
  const teamIds = [...new Set([...teams.filter((t) => t.orgUnitId && unitIds.includes(t.orgUnitId)).map((t) => t.id), ...roles.filter((r) => r.teamId).map((r) => r.teamId!)])];
  // nível Equipe na matriz também cobre os times que a pessoa lidera (mesmo sem estar na estrutura)
  const userIds = [...new Set([auth.userId, ...members.filter((m) => teamIds.includes(m.teamId)).map((m) => m.userId), ...(level(auth, 'resultados') === 'equipe' ? auth.teamMemberIds : [])])];
  const perspectives = (['diretoria', 'gestao', 'lideranca'] as const).filter((p) => roles.some((r) => r.perspective === p));
  return { perspectives, all: false, unitIds, teamIds, userIds, roles };
}

/** Times e pessoas de uma unidade (com as unidades filhas). */
export function unitPeople(org: Awaited<ReturnType<typeof orgData>>, unitId: string) {
  const ids = descendants(org.units, [unitId]);
  const teamIds = org.teams.filter((t) => t.orgUnitId && ids.includes(t.orgUnitId)).map((t) => t.id);
  return { unitIds: ids, teamIds, userIds: [...new Set(org.members.filter((m) => teamIds.includes(m.teamId)).map((m) => m.userId))] };
}
