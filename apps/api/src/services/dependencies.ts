/**
 * Dependências entre atividades, inclusive de departamentos diferentes (Etapa 7 do Quadro de Tarefas, 27/11/2026).
 * Sinaliza predecessora, dependente, departamento, prazo, situação e risco. Nunca altera o prazo de uma dependente:
 * quando uma predecessora é replanejada, avisa quem cuida das dependentes para que a liderança analise.
 */
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BOARD_LABELS, DEPENDENCY_STATE_LABELS, boardOfTask, dependencyAtRisk, dependencyState, type BoardKey } from '@isp/domain';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { boardsConfig, loadBoardTask, teamsByUser, ymd } from '../routes/workBoards';
import { activityScope, taskEvent } from './tasks';
import { AppError } from '../http/errors';

type Side = 'predecessora' | 'dependente';
export type DepLink = {
  id: string; ref: string; title: string; status: string; ownerId: string; ownerName: string; dueDay: string | null;
  board: BoardKey | null; boardLabel: string | null; state: string; stateLabel: string; atRisk: boolean;
};

/** Predecessoras (de quem esta depende) e dependentes (quem depende desta), com departamento, prazo e risco. */
export async function dependencyLinks(db: DbOrTx, auth: AuthContext, activityId: string) {
  const owner = alias(s.users, 'dep_owner');
  const cols = { id: s.activities.id, title: s.activities.title, status: s.activities.status, ownerId: s.activities.ownerId, ownerName: owner.name, dueAt: s.activities.dueAt, boardKey: s.activities.boardKey };
  const [self] = await db.select({ dueAt: s.activities.dueAt, status: s.activities.status }).from(s.activities).where(eq(s.activities.id, activityId)).limit(1);
  const [preds, deps, boards, byUser] = await Promise.all([
    db.select(cols).from(s.activityDependencies).innerJoin(s.activities, eq(s.activities.id, s.activityDependencies.dependsOnId)).innerJoin(owner, eq(owner.id, s.activities.ownerId)).where(and(eq(s.activityDependencies.activityId, activityId), isNull(s.activities.deletedAt))),
    db.select(cols).from(s.activityDependencies).innerJoin(s.activities, eq(s.activities.id, s.activityDependencies.activityId)).innerJoin(owner, eq(owner.id, s.activities.ownerId)).where(and(eq(s.activityDependencies.dependsOnId, activityId), isNull(s.activities.deletedAt))),
    boardsConfig(db, auth.tenantId), teamsByUser(db, auth.tenantId),
  ]);
  const today = ymd(new Date(), auth.timezone);
  const selfDue = self?.dueAt ? ymd(self.dueAt, auth.timezone) : null;
  const shape = (r: (typeof preds)[number], side: Side): DepLink => {
    const dueDay = r.dueAt ? ymd(r.dueAt, auth.timezone) : null;
    // predecessora frente a esta; ou esta (predecessora) frente à dependente
    const state = side === 'predecessora' ? dependencyState({ status: r.status, dueDay }, selfDue, today) : dependencyState({ status: self?.status ?? 'a_fazer', dueDay: selfDue }, dueDay, today);
    const board = boardOfTask({ boardKey: r.boardKey, ownerTeamIds: byUser.get(r.ownerId) ?? [] }, boards);
    return { id: r.id, ref: `T-${r.id.slice(0, 6).toUpperCase()}`, title: r.title, status: r.status, ownerId: r.ownerId, ownerName: r.ownerName, dueDay, board, boardLabel: board ? BOARD_LABELS[board] : null, state, stateLabel: DEPENDENCY_STATE_LABELS[state], atRisk: dependencyAtRisk(state) };
  };
  return { blockedBy: preds.map((r) => shape(r, 'predecessora')), blocking: deps.filter((d) => d.status !== 'cancelada').map((r) => shape(r, 'dependente')) };
}

/**
 * Depois que uma predecessora é replanejada (novo prazo, saiu da Sprint), avisa os responsáveis das dependentes em
 * risco e registra no histórico delas. Não mexe em nenhum prazo.
 */
export async function warnDependents(db: DbOrTx, auth: AuthContext, activityId: string, motivo: string) {
  const { blocking } = await dependencyLinks(db, auth, activityId);
  const atRisk = blocking.filter((d) => d.atRisk && d.status !== 'concluida');
  if (!atRisk.length) return 0;
  const [pred] = await db.select({ title: s.activities.title }).from(s.activities).where(eq(s.activities.id, activityId)).limit(1);
  for (const d of atRisk) await taskEvent(db, auth, d.id, 'dependencia_em_risco', { predecessora: activityId, titulo: pred?.title, motivo, situacao: d.state });
  const ids = [...new Set(atRisk.map((d) => d.ownerId).filter((u) => u !== auth.userId))];
  if (ids.length) {
    const stamp = new Date().toISOString().slice(0, 16);
    await db.insert(s.userNotifications).values(atRisk.filter((d) => ids.includes(d.ownerId)).map((d) => ({
      tenantId: auth.tenantId, userId: d.ownerId, module: 'quadro', event: 'dependencia_em_risco', title: `Dependência em risco: ${d.title}`.slice(0, 200),
      body: `“${pred?.title ?? ''}” ${motivo}. O prazo da sua tarefa não foi alterado: avalie com a liderança.`, link: `/tarefas?tarefa=${d.id}`, actorId: auth.userId, dedupeKey: `dep:${activityId}:${d.id}:${stamp}`,
    }))).onConflictDoNothing();
  }
  return atRisk.length;
}

/**
 * Tarefa de outro departamento que pode ser predecessora: aberta e num quadro ligado para quem vincula.
 * Os times se conversam: dá para depender do trabalho de outro time sem passar a geri-lo.
 */
export async function crossBoardTask(db: DbOrTx, auth: AuthContext, id: string, boardOpen: (b: BoardKey) => boolean) {
  const [t] = await db.select().from(s.activities).where(and(eq(s.activities.id, id), eq(s.activities.tenantId, auth.tenantId), isNull(s.activities.deletedAt), notInArray(s.activities.status, ['concluida', 'cancelada']))).limit(1);
  if (!t) return null;
  const board = boardOfTask({ boardKey: t.boardKey, ownerTeamIds: (await teamsByUser(db, auth.tenantId)).get(t.ownerId) ?? [] }, await boardsConfig(db, auth.tenantId));
  return board && boardOpen(board) ? { t, board } : null;
}

/** Busca de predecessoras em todos os quadros ligados (título, código, departamento, responsável e prazo; nada além). */
export async function searchBoardTasks(db: DbOrTx, auth: AuthContext, q: string, openBoards: BoardKey[]) {
  if (!openBoards.length) return [];
  const [boards, byUser] = await Promise.all([boardsConfig(db, auth.tenantId), teamsByUser(db, auth.tenantId)]);
  const members = [...byUser.entries()].filter(([, ts]) => boards.some((b) => openBoards.includes(b.key) && b.teamIds.some((x) => ts.includes(x)))).map(([u]) => u);
  const owner = alias(s.users, 'o');
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = await db.select({ id: s.activities.id, title: s.activities.title, status: s.activities.status, boardKey: s.activities.boardKey, ownerId: s.activities.ownerId, ownerName: owner.name, dueAt: s.activities.dueAt })
    .from(s.activities).innerJoin(owner, eq(owner.id, s.activities.ownerId))
    .where(and(eq(s.activities.tenantId, auth.tenantId), isNull(s.activities.deletedAt), isNull(s.activities.parentId), notInArray(s.activities.status, ['concluida', 'cancelada']),
      sql`(${s.activities.title} ilike ${like} or upper(substr(${s.activities.id}::text, 1, 6)) = ${q.replace(/^T-/i, '').toUpperCase().slice(0, 6)})`,
      members.length ? sql`(${s.activities.boardKey} = any(${`{${openBoards.join(',')}}`}::text[]) or ${inArray(s.activities.ownerId, members)})` : sql`${s.activities.boardKey} = any(${`{${openBoards.join(',')}}`}::text[])`))
    .limit(40);
  return rows.map((r) => {
    const board = boardOfTask({ boardKey: r.boardKey, ownerTeamIds: byUser.get(r.ownerId) ?? [] }, boards);
    return { id: r.id, ref: `T-${r.id.slice(0, 6).toUpperCase()}`, title: r.title, status: r.status, ownerName: r.ownerName, dueDay: r.dueAt ? ymd(r.dueAt, auth.timezone) : null, board, boardLabel: board ? BOARD_LABELS[board] : null };
  }).filter((r) => r.board && openBoards.includes(r.board)).slice(0, 20);
}

/**
 * Abre a tarefa normalmente; se estiver fora do escopo de quem pede, mas ligada por dependência a uma tarefa que essa
 * pessoa vê, abre só para leitura (sem editar, atribuir, aprovar ou comentar).
 */
export async function loadTaskOrDependencyPeer(db: DbOrTx, auth: AuthContext, id: string) {
  try {
    // perfil, ou liderança/gestão do quadro em que a tarefa está
    return await loadBoardTask(db, auth, id);
  } catch (e) {
    if (!(e instanceof AppError) || e.status !== 404) throw e;
    const linked = await db.select({ a: s.activityDependencies.activityId, b: s.activityDependencies.dependsOnId }).from(s.activityDependencies)
      .where(and(eq(s.activityDependencies.tenantId, auth.tenantId), sql`(${s.activityDependencies.activityId} = ${id} or ${s.activityDependencies.dependsOnId} = ${id})`));
    const peers = [...new Set(linked.map((l) => (l.a === id ? l.b : l.a)))];
    if (!peers.length) throw e;
    const [mine] = await db.select({ id: s.activities.id }).from(s.activities).where(and(inArray(s.activities.id, peers), activityScope(auth))).limit(1);
    if (!mine) throw e;
    const [t] = await db.select().from(s.activities).where(and(eq(s.activities.id, id), eq(s.activities.tenantId, auth.tenantId), isNull(s.activities.deletedAt))).limit(1);
    if (!t) throw e;
    return { t, can: { edit: false, assign: false, approve: false, comment: false } };
  }
}
