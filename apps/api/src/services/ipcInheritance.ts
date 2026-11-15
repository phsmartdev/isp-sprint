/**
 * IPC herdado: ao relacionar uma conta com outra (ou com uma estrutura), a equipe decide se ela assume o IPC da
 * conta principal (ou da estrutura, que é o IPC da conta gestora) ou se mantém o próprio IPC. Quem assume passa a ter
 * sempre o mesmo score da principal (acompanhamento igual); remover a relação devolve o IPC próprio.
 * Uma conta segue no máximo uma principal; cadeias valem (A segue B, que segue C → A tem o IPC de C); ciclos não.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export type IpcLink = { followerId: string; principalId: string; via: 'conta' | 'estrutura'; relationId?: string; structureId?: string; structureName?: string };

/** Quem segue o IPC de quem (follower → principal direta). */
export async function ipcLinks(db: DbOrTx, tenantId: string): Promise<Map<string, IpcLink>> {
  const out = new Map<string, IpcLink>();
  const rels = await db.select({ id: s.accountRelations.id, fromId: s.accountRelations.fromContactId, toId: s.accountRelations.toContactId, follower: s.accountRelations.ipcFollowerId })
    .from(s.accountRelations).where(and(eq(s.accountRelations.tenantId, tenantId), eq(s.accountRelations.active, true)));
  for (const r of rels) {
    if (!r.follower || (r.follower !== r.fromId && r.follower !== r.toId)) continue;
    out.set(r.follower, { followerId: r.follower, principalId: r.follower === r.fromId ? r.toId : r.fromId, via: 'conta', relationId: r.id });
  }
  const members = await db.select({ structureId: s.structureMembers.structureId, contactId: s.structureMembers.contactId, role: s.structureMembers.role, inherits: s.structureMembers.inheritsIpc, createdAt: s.structureMembers.createdAt, name: s.accountStructures.name, stActive: s.accountStructures.active })
    .from(s.structureMembers).innerJoin(s.accountStructures, eq(s.accountStructures.id, s.structureMembers.structureId))
    .where(and(eq(s.structureMembers.tenantId, tenantId), eq(s.structureMembers.active, true)));
  for (const m of members) {
    if (!m.inherits || m.role === 'gestor' || !m.stActive || out.has(m.contactId)) continue;
    const gestor = structureGestor(members.filter((x) => x.structureId === m.structureId));
    if (gestor && gestor !== m.contactId) out.set(m.contactId, { followerId: m.contactId, principalId: gestor, via: 'estrutura', structureId: m.structureId, structureName: m.name });
  }
  return out;
}

/** A conta gestora da estrutura (o IPC da estrutura é o dela); a mais antiga se houver mais de uma. */
export function structureGestor(members: { contactId: string; role: string; createdAt: Date }[]) {
  return [...members].filter((m) => m.role === 'gestor').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.contactId ?? null;
}

/** Principal no topo da cadeia (a conta cujo IPC vale de fato); null se a conta não segue ninguém. */
export function ipcRoot(links: Map<string, IpcLink>, id: string): string | null {
  let cur = links.get(id)?.principalId ?? null; const seen = new Set([id]);
  while (cur && links.has(cur) && !seen.has(cur)) { seen.add(cur); cur = links.get(cur)!.principalId; }
  return cur;
}

/** Profundidade na cadeia (0 = não segue ninguém): o cálculo vai do topo para baixo. */
export function ipcDepth(links: Map<string, IpcLink>, id: string) {
  let d = 0, cur: string | undefined = id; const seen = new Set<string>();
  while (cur && links.has(cur) && !seen.has(cur)) { seen.add(cur); d++; cur = links.get(cur)!.principalId; }
  return d;
}

/** Todas as contas que seguem (direta ou indiretamente) a conta informada. */
export function ipcFollowers(links: Map<string, IpcLink>, id: string) {
  const out = new Set<string>(); const queue = [id];
  while (queue.length) { const c = queue.pop()!; for (const l of links.values()) if (l.principalId === c && !out.has(l.followerId) && l.followerId !== id) { out.add(l.followerId); queue.push(l.followerId); } }
  return [...out];
}

/** Motivo para recusar "follower assume o IPC de principal" (null = pode). */
export async function ipcFollowError(db: DbOrTx, tenantId: string, followerId: string, principalId: string): Promise<string | null> {
  const links = await ipcLinks(db, tenantId);
  const cur = links.get(followerId);
  if (cur) {
    const [p] = await db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, cur.principalId)).limit(1);
    return `Esta conta já assume o IPC de ${cur.via === 'estrutura' ? `${cur.structureName} (estrutura)` : p?.name ?? 'outra conta'}. Uma conta segue o IPC de uma só principal: desfaça a relação atual antes, ou registre esta com IPC individualizado.`;
  }
  // ciclo: subindo a partir da principal não pode chegar na conta que vai seguir
  let c: string | undefined = principalId; const seen = new Set<string>();
  while (c) { if (c === followerId) return 'A conta principal já segue o IPC desta conta: isso criaria um ciclo. Registre com IPC individualizado.'; if (seen.has(c)) break; seen.add(c); c = links.get(c)?.principalId; }
  return null;
}

/** Nomes das contas (para mostrar "segue o IPC de …"). */
export async function contactNames(db: DbOrTx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: s.contacts.id, name: s.contacts.name }).from(s.contacts).where(inArray(s.contacts.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
