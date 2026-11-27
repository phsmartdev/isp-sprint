/**
 * Quadro de Tarefas — Etapa 6: fura-fila (inclusão extraordinária numa Sprint aberta), 27/11/2026.
 *
 * Regra central, no backend: capacidade livre primeiro; depois 10% hipóteses → 20% internas → 70% comercial, nessa
 * ordem. Tocar o comercial exige aprovação da gerência (a liderança não aprova). Nada muda na Sprint enquanto a decisão
 * não sai; a aprovação revalida a análise; a efetivação é uma transação só (tudo ou nada); nada é excluído; prazos de
 * oportunidades, contratos e projetos não são alterados.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { FURA_FILA_ORDER, FURA_FILA_STATUS_LABELS, analyzeFuraFila, taskCategory, type BoardKey, type CapacityCategory, type FuraFilaStatus } from '@isp/domain';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { taskEvent } from '../services/tasks';
import { dueAtOf } from '../services/projects';
import { warnDependents } from '../services/dependencies';
import { ymd } from './workBoards';
import { Board, boardOpenTasks, context, isoDay, loadSprint, peopleCapacity, sprintEvent } from './workSprints';

type Ctx = Awaited<ReturnType<typeof context>>;
const OPEN: FuraFilaStatus[] = ['pendente', 'ajustes', 'aguardando_gerencia'];
const LAYER_LABEL: Record<CapacityCategory, string> = { hipotese: 'Testes de hipóteses (10%)', interno: 'Atividades internas (20%)', comercial: 'Estratégia comercial (70%)' };

async function loadRequest(db: DbOrTx, auth: AuthContext, board: BoardKey, id: string) {
  const [r] = await db.select({ r: s.workSprintRequests, sprint: s.workSprints }).from(s.workSprintRequests).innerJoin(s.workSprints, eq(s.workSprints.id, s.workSprintRequests.sprintId))
    .where(and(eq(s.workSprintRequests.id, id), eq(s.workSprintRequests.tenantId, auth.tenantId), eq(s.workSprints.boardKey, board))).limit(1);
  if (!r) throw notFound('Solicitação de fura-fila não encontrada.');
  return r;
}

/** Liderança e gestão das equipes do quadro (quem decide), e só a gestão (quem aprova o comercial). */
async function deciders(db: DbOrTx, teamIds: string[]) {
  if (!teamIds.length) return { leads: [] as string[], managers: [] as string[] };
  const teams = await db.select({ managerIds: s.teams.managerIds, directorIds: s.teams.directorIds }).from(s.teams).where(and(inArray(s.teams.id, teamIds), isNull(s.teams.deletedAt)));
  const managers = [...new Set(teams.flatMap((t) => [...(t.managerIds ?? []), ...(t.directorIds ?? [])]))];
  const leads = (await db.select({ u: s.teamMemberships.userId }).from(s.teamMemberships).where(and(inArray(s.teamMemberships.teamId, teamIds), eq(s.teamMemberships.isLead, true)))).map((x) => x.u);
  return { leads: [...new Set([...leads, ...managers])], managers };
}
async function notify(db: DbOrTx, tenantId: string, userIds: (string | null | undefined)[], ev: { event: string; title: string; body?: string | null; link: string; key: string; actorId: string }) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== ev.actorId))];
  if (!ids.length) return;
  await db.insert(s.userNotifications).values(ids.map((userId) => ({ tenantId, userId, module: 'quadro', event: ev.event, title: ev.title.slice(0, 200), body: ev.body ?? null, link: ev.link, actorId: ev.actorId, dedupeKey: `ff:${ev.key}` }))).onConflictDoNothing();
}

/**
 * Análise de impacto ao vivo: capacidade original e livre, o que a Sprint tem comprometido (horas executadas não voltam),
 * as tarefas que podem ser deslocadas na ordem obrigatória e o efeito da seleção.
 */
async function analysisFor(db: DbOrTx, auth: AuthContext, board: BoardKey, ctx: Ctx, sprint: typeof s.workSprints.$inferSelect, req: { activityId: string; estimateMinutes: number; ownerId: string }, selection?: string[]) {
  const owner = alias(s.users, 'owner');
  const [people, items] = await Promise.all([
    peopleCapacity(db, auth.tenantId, board, sprint.weekStart, ctx.members, ctx.byUser, ctx.boards),
    db.select({ i: s.workSprintItems, title: s.activities.title, status: s.activities.status, remaining: s.activities.remainingMinutes, protectedCommitment: s.activities.protectedCommitment, dueAt: s.activities.dueAt,
      ownerName: owner.name, oppId: s.activities.opportunityId, oppCode: s.opportunities.code, oppTitle: s.opportunities.title, client: s.contacts.name, projectName: s.projects.name })
      .from(s.workSprintItems).innerJoin(s.activities, eq(s.activities.id, s.workSprintItems.activityId)).leftJoin(owner, eq(owner.id, s.workSprintItems.ownerId))
      .leftJoin(s.opportunities, eq(s.opportunities.id, s.activities.opportunityId)).leftJoin(s.contacts, eq(s.contacts.id, s.activities.contactId)).leftJoin(s.projects, eq(s.projects.id, s.activities.projectId))
      .where(and(eq(s.workSprintItems.sprintId, sprint.id), isNull(s.workSprintItems.removedAt))).orderBy(asc(s.workSprintItems.position)),
  ]);
  // dependentes em aberto de cada tarefa (deslocá-la pode atrasar o trabalho de outros, inclusive de outros times)
  const depCount = new Map<string, number>();
  if (items.length) for (const d of await db.select({ id: s.activityDependencies.dependsOnId, n: sql<number>`count(*)::int` }).from(s.activityDependencies).innerJoin(s.activities, eq(s.activities.id, s.activityDependencies.activityId))
    .where(and(inArray(s.activityDependencies.dependsOnId, items.map((x) => x.i.activityId)), isNull(s.activities.deletedAt), sql`${s.activities.status} not in ('concluida','cancelada')`)).groupBy(s.activityDependencies.dependsOnId)) depCount.set(d.id, d.n);
  const totalNet = people.reduce((t, p) => t + (p.netMinutes ?? 0), 0);
  const committed = items.reduce((t, x) => t + x.i.committedMinutes, 0);
  const free = Math.max(0, totalNet - committed);
  const ownerCap = people.find((p) => p.userId === req.ownerId);
  const ownerCommitted = items.filter((x) => x.i.ownerId === req.ownerId).reduce((t, x) => t + x.i.committedMinutes, 0);
  const candidates = items.filter((x) => x.i.activityId !== req.activityId).map((x) => ({
    id: x.i.activityId, category: x.i.category as CapacityCategory, remainingMinutes: x.remaining ?? x.i.committedMinutes, protectedCommitment: x.protectedCommitment, done: x.status === 'concluida',
  }));
  const a = analyzeFuraFila({ neededMinutes: req.estimateMinutes, freeMinutes: free, candidates, selectedIds: selection });
  const byCat = (f: (x: (typeof items)[number]) => boolean) => Object.fromEntries((['comercial', 'interno', 'hipotese'] as const).map((c) => [c, items.filter((x) => x.i.category === c && f(x)).reduce((t, x) => t + (x.remaining ?? x.i.committedMinutes), 0)])) as Record<CapacityCategory, number>;
  const remainingByCategory = byCat((x) => x.status !== 'concluida');
  const chosen = new Set(selection ?? a.suggestedIds);
  const after = Object.fromEntries((['comercial', 'interno', 'hipotese'] as const).map((c) => [c, remainingByCategory[c] - a.selected[c]])) as Record<CapacityCategory, number>;
  const fingerprint = createHash('sha256').update(JSON.stringify([totalNet, req.estimateMinutes, candidates.map((c) => [c.id, c.remainingMinutes, c.done, c.protectedCommitment]).sort()])).digest('hex').slice(0, 32);
  return {
    fingerprint, analysis: a,
    capacity: { totalNetMinutes: totalNet, committedMinutes: committed, freeMinutes: free, neededMinutes: a.neededMinutes, toRecoverMinutes: a.toRecoverMinutes, remainingByCategory, afterByCategory: after,
      owner: ownerCap ? { name: ownerCap.name, netMinutes: ownerCap.netMinutes, committedMinutes: ownerCommitted } : null },
    layers: FURA_FILA_ORDER.map((cat) => ({
      category: cat, label: LAYER_LABEL[cat], recoverableMinutes: a.recoverable[cat], selectedMinutes: a.selected[cat],
      tasks: items.filter((x) => x.i.category === cat && x.i.activityId !== req.activityId).map((x) => ({
        activityId: x.i.activityId, title: x.title, ownerName: x.ownerName, remainingMinutes: x.remaining ?? x.i.committedMinutes, dueDay: x.dueAt ? ymd(x.dueAt, auth.timezone) : null,
        link: x.oppId ? `OP-${x.oppCode} · ${x.client ?? x.oppTitle ?? ''}` : x.projectName ? `Projeto ${x.projectName}` : null, furaFila: x.i.entry === 'fura_fila',
        selected: chosen.has(x.i.activityId), blockedReason: a.blocked.find((b) => b.id === x.i.activityId)?.reason ?? null,
        dependents: depCount.get(x.i.activityId) ?? 0,
        impact: (cat === 'comercial' ? (x.oppId ? 'Atividade comercial: renegociar com a gerência e com o cliente' : 'Atividade comercial: renegociar com a gerência') : 'Volta para as pendentes do time, com o histórico')
          + (depCount.get(x.i.activityId) ? ` · ${depCount.get(x.i.activityId)} tarefa(s) dependem desta e serão avisadas` : ''),
      })),
    })),
  };
}

const RequestBody = z.object({
  activityId: z.string().uuid(), origin: z.string().trim().min(2).max(200), justification: z.string().trim().min(10, 'Explique a necessidade').max(2000),
  urgency: z.string().trim().min(5, 'Explique a urgência').max(1000), consequence: z.string().trim().min(5, 'Diga o que acontece se não fizer').max(1000),
  neededBy: isoDay, estimateMinutes: z.number().int().min(15).max(60 * 200), ownerId: z.string().uuid(),
});

/**
 * Efetiva o replanejamento numa transação: confirma a capacidade, retira as tarefas escolhidas (sem excluir), aplica os
 * novos prazos dessas tarefas, inclui a nova como fura-fila, registra a revisão e avisa os envolvidos. O plano original
 * (fotografia) continua intacto.
 */
async function apply(tx: DbOrTx, auth: AuthContext, board: BoardKey, ctx: Ctx, rid: string, selection: { activityId: string; newDueOn: string | null }[], approval: { approved: boolean; reason: string | null }) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sprint-ff:${rid}`}))`);
  const { r, sprint } = await loadRequest(tx, auth, board, rid);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sprint:${sprint.id}`}))`);
  if (sprint.status !== 'andamento') throw unprocessable('A Sprint não está em andamento.');
  const live = await analysisFor(tx, auth, board, ctx, sprint, r, selection.map((x) => x.activityId));
  const a = live.analysis;
  if (a.issues.length) throw unprocessable(a.issues.join(' '));
  if (!a.sufficient) throw unprocessable('Capacidade insuficiente: a solicitação fica aguardando decisão, renegociação ou outra alternativa.');
  if (a.requiresManagerApproval && !approval.approved) throw forbidden('Aprovação gerencial obrigatória: a inclusão compromete atividades comerciais planejadas.');
  const [act] = await tx.select().from(s.activities).where(eq(s.activities.id, r.activityId)).limit(1);
  const category = act ? taskCategory(act) : null;
  if (!act || !category) throw unprocessable('A tarefa precisa de categoria (a natureza do trabalho não muda por ser fura-fila).');
  const today = ymd(new Date(), auth.timezone);
  const titles: string[] = [];
  const displacedOwners: string[] = [];
  for (const sel of selection) {
    if (sel.newDueOn && sel.newDueOn < today) throw unprocessable('Novo prazo proposto no passado.');
    const [it] = await tx.update(s.workSprintItems).set({ removedAt: new Date(), removedBy: auth.userId, removedReason: `Replanejada para o fura-fila “${act.title}”`, requestId: rid })
      .where(and(eq(s.workSprintItems.sprintId, sprint.id), eq(s.workSprintItems.activityId, sel.activityId), isNull(s.workSprintItems.removedAt))).returning();
    if (!it) throw unprocessable('Uma tarefa escolhida já saiu da Sprint: refaça a análise.');
    const [t] = await tx.update(s.activities).set({
      plannedWeek: null, planOrder: null, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1`,
      ...(sel.newDueOn ? { dueAt: dueAtOf(auth, sel.newDueOn) as unknown as Date } : {}),
    }).where(eq(s.activities.id, sel.activityId)).returning({ title: s.activities.title, ownerId: s.activities.ownerId });
    titles.push(t!.title);
    displacedOwners.push(t!.ownerId);
    await taskEvent(tx, auth, sel.activityId, 'replanejada', { sprint: sprint.weekStart, furaFila: rid, motivo: `fura-fila “${act.title}”`, novoPrazo: sel.newDueOn });
  }
  // quem depende das tarefas deslocadas é avisado (os prazos delas não mudam sem análise)
  for (const sel of selection) await warnDependents(tx, auth, sel.activityId, `saiu da Sprint para o fura-fila “${act.title}”${sel.newDueOn ? ` e tem novo prazo em ${sel.newDueOn.split('-').reverse().join('/')}` : ''}`);
  const [{ pos } = { pos: 0 }] = await tx.select({ pos: sql<number>`coalesce(max(position), 0)::int + 1` }).from(s.workSprintItems).where(eq(s.workSprintItems.sprintId, sprint.id));
  await tx.insert(s.workSprintItems).values({ tenantId: auth.tenantId, sprintId: sprint.id, activityId: r.activityId, entry: 'fura_fila', committedMinutes: r.estimateMinutes, category, ownerId: r.ownerId, dueAt: dueAtOf(auth, r.neededBy) as unknown as Date, position: pos, addedBy: auth.userId, requestId: rid });
  await tx.update(s.activities).set({ plannedWeek: sprint.weekStart, planOrder: pos, ownerId: r.ownerId, estimateMinutes: act.estimateMinutes ?? r.estimateMinutes, dueAt: dueAtOf(auth, r.neededBy) as unknown as Date, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1` }).where(eq(s.activities.id, r.activityId));
  await taskEvent(tx, auth, r.activityId, 'fura_fila', { sprint: sprint.weekStart, solicitacao: rid, esforco: r.estimateMinutes, prazo: r.neededBy });
  const payload = { requestId: rid, activityId: r.activityId, title: act.title, category, minutes: r.estimateMinutes, freeUsedMinutes: a.freeUsedMinutes, displaced: a.selected, displacedTasks: selection, approvedByManager: a.requiresManagerApproval };
  await sprintEvent(tx, auth, sprint.id, 'fura_fila', payload, approval.reason ?? r.justification);
  await tx.update(s.workSprintRequests).set({ status: 'aprovada', selection, fingerprint: live.fingerprint, analysis: payload, decidedBy: r.decidedBy ?? auth.userId, decidedAt: r.decidedAt ?? new Date(),
    ...(approval.approved && a.requiresManagerApproval ? { approvedBy: auth.userId, approvedAt: new Date(), approvalReason: approval.reason } : {}), updatedAt: new Date() }).where(eq(s.workSprintRequests.id, rid));
  await notify(tx, auth.tenantId, [r.requestedBy, r.ownerId, ...displacedOwners], { event: 'fura_fila_incluida', title: `Fura-fila incluído na Sprint: ${act.title}`, body: titles.length ? `Replanejadas: ${titles.join(', ')}` : 'Usou capacidade livre; nada foi deslocado.', link: `/quadro/${board}?week=${sprint.weekStart}`, key: `${rid}:aprovada`, actorId: auth.userId });
  return { ok: true, displaced: titles.length, freeUsedMinutes: a.freeUsedMinutes, requiresManagerApproval: a.requiresManagerApproval };
}

export const workFuraFilaRoutes = [
  defineRoute({
    method: 'POST', url: '/quadros/:board/sprints/:id/fura-filas', summary: 'Solicita a inclusão extraordinária de uma tarefa na Sprint aberta (qualquer pessoa do time). Nada muda até a decisão.', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ id: z.string().uuid() }), body: RequestBody,
    handler: async ({ app, auth, params, body, reply }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      const sprint = await loadSprint(app.db, auth, board, params.id);
      if (sprint.status !== 'andamento') throw unprocessable('Fura-fila é para Sprint em andamento. Antes de abrir, inclua a tarefa no planejamento.');
      const open = await boardOpenTasks(app.db, auth, board, ctx);
      const t = open.find((x) => x.a.id === body.activityId);
      if (!t) throw unprocessable('A tarefa precisa estar aberta e no quadro deste time.');
      if (!taskCategory(t.a)) throw unprocessable('Classifique a tarefa (estratégia comercial, interna ou hipótese) antes de pedir o fura-fila.');
      if (!ctx.members.includes(body.ownerId)) throw unprocessable('O responsável precisa ser de uma equipe deste quadro.');
      const [inSprint] = await app.db.select({ id: s.workSprintItems.id }).from(s.workSprintItems).where(and(eq(s.workSprintItems.sprintId, sprint.id), eq(s.workSprintItems.activityId, body.activityId), isNull(s.workSprintItems.removedAt))).limit(1);
      if (inSprint) throw unprocessable('A tarefa já está na Sprint.');
      const [dup] = await app.db.select({ id: s.workSprintRequests.id }).from(s.workSprintRequests).where(and(eq(s.workSprintRequests.sprintId, sprint.id), eq(s.workSprintRequests.activityId, body.activityId), inArray(s.workSprintRequests.status, OPEN))).limit(1);
      if (dup) throw unprocessable('Já existe uma solicitação em aberto para esta tarefa.');
      const [r] = await app.db.insert(s.workSprintRequests).values({ tenantId: auth.tenantId, sprintId: sprint.id, ...body, requestedBy: auth.userId }).returning({ id: s.workSprintRequests.id });
      await sprintEvent(app.db, auth, sprint.id, 'fura_fila_solicitado', { requestId: r!.id, activityId: body.activityId, minutes: body.estimateMinutes }, body.justification);
      await taskEvent(app.db, auth, body.activityId, 'fura_fila_solicitado', { sprint: sprint.weekStart, esforco: body.estimateMinutes, prazo: body.neededBy });
      const { leads } = await deciders(app.db, ctx.cfg.teamIds);
      await notify(app.db, auth.tenantId, leads, { event: 'fura_fila_solicitado', title: `Fura-fila solicitado: ${t.a.title}`, body: body.justification, link: `/quadro/${board}?week=${sprint.weekStart}&furafila=${r!.id}`, key: `${r!.id}:solicitado`, actorId: auth.userId });
      reply.code(201);
      return { id: r!.id };
    },
  }),

  defineRoute({
    method: 'GET', url: '/quadros/:board/fura-filas', summary: 'Solicitações de fura-fila da Sprint', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board, query: z.object({ sprintId: z.string().uuid() }),
    handler: async ({ app, auth, params, query }) => {
      const ctx = await context(app.db, auth, params.board as BoardKey);
      const req = alias(s.users, 'req');
      const own = alias(s.users, 'own');
      const rows = await app.db.select({ r: s.workSprintRequests, title: s.activities.title, requestedByName: req.name, ownerName: own.name }).from(s.workSprintRequests)
        .innerJoin(s.workSprints, eq(s.workSprints.id, s.workSprintRequests.sprintId)).innerJoin(s.activities, eq(s.activities.id, s.workSprintRequests.activityId))
        .leftJoin(req, eq(req.id, s.workSprintRequests.requestedBy)).leftJoin(own, eq(own.id, s.workSprintRequests.ownerId))
        .where(and(eq(s.workSprintRequests.tenantId, auth.tenantId), eq(s.workSprintRequests.sprintId, query.sprintId), eq(s.workSprints.boardKey, params.board))).orderBy(desc(s.workSprintRequests.createdAt));
      // colaborador vê as próprias; liderança e gestão, todas
      const visible = ctx.role === 'colaborador' ? rows.filter((x) => x.r.requestedBy === auth.userId || x.r.ownerId === auth.userId) : rows;
      return { role: ctx.role, items: visible.map((x) => ({ id: x.r.id, activityId: x.r.activityId, title: x.title, status: x.r.status, statusLabel: FURA_FILA_STATUS_LABELS[x.r.status as FuraFilaStatus], estimateMinutes: x.r.estimateMinutes, neededBy: x.r.neededBy, requestedByName: x.requestedByName, ownerName: x.ownerName, createdAt: x.r.createdAt })) };
    },
  }),

  defineRoute({
    method: 'GET', url: '/quadros/:board/fura-filas/:rid', summary: 'Solicitação de fura-fila com a análise de impacto ao vivo (capacidade livre, camadas 10/20/70 e tarefas que podem ser deslocadas)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ rid: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      const { r, sprint } = await loadRequest(app.db, auth, board, params.rid);
      if (ctx.role === 'colaborador' && r.requestedBy !== auth.userId && r.ownerId !== auth.userId) throw forbidden('A análise do fura-fila é da liderança e da gestão do time.');
      const [act] = await app.db.select({ title: s.activities.title, opportunityId: s.activities.opportunityId, capacityCategory: s.activities.capacityCategory, oppCode: s.opportunities.code, client: s.contacts.name })
        .from(s.activities).leftJoin(s.opportunities, eq(s.opportunities.id, s.activities.opportunityId)).leftJoin(s.contacts, eq(s.contacts.id, s.activities.contactId)).where(eq(s.activities.id, r.activityId)).limit(1);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, [r.requestedBy, r.ownerId, r.decidedBy, r.approvedBy].filter((x): x is string => !!x)));
      const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
      const stored = r.selection?.map((x) => x.activityId);
      const live = OPEN.includes(r.status as FuraFilaStatus) && sprint.status === 'andamento' ? await analysisFor(app.db, auth, board, ctx, sprint, r, stored) : null;
      return {
        role: ctx.role, sprint: { id: sprint.id, weekStart: sprint.weekStart, status: sprint.status },
        request: { ...r, statusLabel: FURA_FILA_STATUS_LABELS[r.status as FuraFilaStatus], title: act?.title, opportunity: act?.opportunityId ? `OP-${act.oppCode} · ${act.client ?? ''}` : null,
          requestedByName: name(r.requestedBy), ownerName: name(r.ownerId), decidedByName: name(r.decidedBy), approvedByName: name(r.approvedBy) },
        // análise mudou desde o pedido de aprovação? (a gerência não aprova sobre números velhos)
        stale: !!(live && r.status === 'aguardando_gerencia' && r.fingerprint && r.fingerprint !== live.fingerprint),
        live, storedSelection: r.selection ?? null,
      };
    },
  }),

  defineRoute({
    method: 'PATCH', url: '/quadros/:board/fura-filas/:rid', summary: 'Ajusta a solicitação (quem pediu), quando a liderança pediu ajustes ou ainda está pendente', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ rid: z.string().uuid() }), body: RequestBody.omit({ activityId: true }).partial(),
    handler: async ({ app, auth, params, body }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      const { r } = await loadRequest(app.db, auth, board, params.rid);
      if (r.requestedBy !== auth.userId && ctx.role === 'colaborador') throw forbidden('Só quem pediu ajusta a solicitação.');
      if (!['pendente', 'ajustes'].includes(r.status)) throw unprocessable('A solicitação já está com a gerência ou foi decidida.');
      if (body.ownerId && !ctx.members.includes(body.ownerId)) throw unprocessable('O responsável precisa ser de uma equipe deste quadro.');
      await app.db.update(s.workSprintRequests).set({ ...body, status: 'pendente', selection: null, fingerprint: null, updatedAt: new Date() }).where(eq(s.workSprintRequests.id, r.id));
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST', url: '/quadros/:board/fura-filas/:rid/decisao', summary: 'Decide o fura-fila: autorizar e replanejar, pedir aprovação gerencial, aprovar (gerência), pedir ajustes, rejeitar, manter no backlog ou cancelar', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board.extend({ rid: z.string().uuid() }),
    body: z.object({
      action: z.enum(['autorizar', 'solicitar_aprovacao', 'aprovar', 'ajustes', 'rejeitar', 'manter_backlog', 'cancelar']),
      selection: z.array(z.object({ activityId: z.string().uuid(), newDueOn: isoDay.nullable().default(null) })).max(100).optional(),
      reason: z.string().trim().max(2000).optional(),
    }),
    handler: async ({ app, auth, params, body, req }) => {
      const board = params.board as BoardKey;
      const ctx = await context(app.db, auth, board);
      const { r, sprint } = await loadRequest(app.db, auth, board, params.rid);
      const reason = body.reason?.trim() ?? '';
      const needReason = (min = 10) => { if (reason.length < min) throw unprocessable('Registre a justificativa da decisão.', [{ path: 'reason', message: 'Obrigatória' }]); };
      const leads = ctx.role !== 'colaborador';
      const status = r.status as FuraFilaStatus;
      if (!OPEN.includes(status)) throw unprocessable(`Solicitação já ${FURA_FILA_STATUS_LABELS[status].toLowerCase()}.`);
      const set = (patch: Partial<typeof s.workSprintRequests.$inferInsert>) => app.db.update(s.workSprintRequests).set({ ...patch, updatedAt: new Date() }).where(eq(s.workSprintRequests.id, r.id));
      const [act] = await app.db.select({ title: s.activities.title }).from(s.activities).where(eq(s.activities.id, r.activityId)).limit(1);
      const link = `/quadro/${board}?week=${sprint.weekStart}&furafila=${r.id}`;
      let out: Record<string, unknown> = { ok: true };

      if (body.action === 'cancelar') {
        if (r.requestedBy !== auth.userId && !leads) throw forbidden('Só quem pediu, a liderança ou a gestão cancelam.');
        await set({ status: 'cancelada', decidedBy: auth.userId, decidedAt: new Date(), decisionReason: reason || null });
      } else if (body.action === 'aprovar') {
        if (ctx.role !== 'gestao') throw forbidden('Aprovar o deslocamento da capacidade comercial é da gerência ou da diretoria do time.');
        if (status !== 'aguardando_gerencia') throw unprocessable('Não há pedido de aprovação gerencial nesta solicitação.');
        needReason();
        const live = await analysisFor(app.db, auth, board, ctx, sprint, r, r.selection?.map((x) => x.activityId));
        if (live.fingerprint !== r.fingerprint) {
          // a capacidade ou as tarefas mudaram: volta para a liderança refazer a análise (não aprova sobre números velhos)
          await set({ status: 'pendente', fingerprint: null });
          await sprintEvent(app.db, auth, sprint.id, 'fura_fila_revalidar', { requestId: r.id });
          throw unprocessable('A capacidade ou as tarefas da Sprint mudaram desde o pedido de aprovação. A solicitação voltou para a liderança refazer a análise.');
        }
        out = await app.db.transaction((tx) => apply(tx, auth, board, ctx, r.id, r.selection ?? [], { approved: true, reason }));
      } else {
        if (!leads) throw forbidden('A decisão sobre o fura-fila é da liderança ou da gestão do time.');
        if (status === 'aguardando_gerencia' && ctx.role !== 'gestao') throw forbidden('A solicitação está com a gerência.');
        if (body.action === 'autorizar') {
          const selection = body.selection ?? [];
          // a gestão pode autorizar direto mesmo tocando o comercial (é a própria aprovação gerencial, com justificativa)
          const preview = (await analysisFor(app.db, auth, board, ctx, sprint, r, selection.map((x) => x.activityId))).analysis;
          if (preview.requiresManagerApproval && ctx.role === 'gestao') needReason();
          out = await app.db.transaction(async (tx) => {
            await tx.update(s.workSprintRequests).set({ decidedBy: auth.userId, decidedAt: new Date(), decisionReason: reason || null }).where(eq(s.workSprintRequests.id, r.id));
            return apply(tx, auth, board, ctx, r.id, selection, { approved: ctx.role === 'gestao', reason: reason || null });
          });
        } else if (body.action === 'solicitar_aprovacao') {
          const selection = body.selection ?? [];
          const live = await analysisFor(app.db, auth, board, ctx, sprint, r, selection.map((x) => x.activityId));
          if (live.analysis.issues.length) throw unprocessable(live.analysis.issues.join(' '));
          if (!live.analysis.sufficient) throw unprocessable('A seleção não libera o esforço necessário.');
          if (!live.analysis.requiresManagerApproval) throw unprocessable('Esta seleção não toca o comercial: a liderança pode autorizar direto.');
          // propor novos prazos das atividades comerciais é obrigatório para a renegociação
          const commercial = live.layers.find((l) => l.category === 'comercial')!.tasks.filter((t) => t.selected).map((t) => t.activityId);
          if (commercial.some((id) => !selection.find((x) => x.activityId === id)?.newDueOn)) throw unprocessable('Proponha o novo prazo de cada atividade comercial deslocada.');
          await set({ status: 'aguardando_gerencia', selection, fingerprint: live.fingerprint, analysis: { selected: live.analysis.selected, freeUsedMinutes: live.analysis.freeUsedMinutes }, decidedBy: auth.userId, decidedAt: new Date(), decisionReason: reason || null });
          const { managers } = await deciders(app.db, ctx.cfg.teamIds);
          await notify(app.db, auth.tenantId, managers, { event: 'fura_fila_aprovacao', title: `Aprovação gerencial: fura-fila ${act?.title ?? ''}`, body: `Desloca ${Math.round(live.analysis.selected.comercial / 6) / 10}h de atividades comerciais planejadas.`, link, key: `${r.id}:aprovacao:${live.fingerprint}`, actorId: auth.userId });
          out = { ok: true, status: 'aguardando_gerencia' };
        } else {
          if (body.action !== 'manter_backlog') needReason();
          const next = { ajustes: 'ajustes', rejeitar: 'rejeitada', manter_backlog: 'mantida_backlog' }[body.action] as FuraFilaStatus;
          await set({ status: next, decidedBy: auth.userId, decidedAt: new Date(), decisionReason: reason || null });
          await notify(app.db, auth.tenantId, [r.requestedBy], { event: `fura_fila_${next}`, title: `Fura-fila ${FURA_FILA_STATUS_LABELS[next].toLowerCase()}: ${act?.title ?? ''}`, body: reason || null, link, key: `${r.id}:${next}:${Date.now()}`, actorId: auth.userId });
        }
      }
      if (!['autorizar', 'aprovar'].includes(body.action)) await sprintEvent(app.db, auth, sprint.id, `fura_fila_${body.action}`, { requestId: r.id }, reason || null);
      await audit(app.db, req, { action: `work_sprint.fura_fila.${body.action}`, entityType: 'work_sprint_request', entityId: r.id, metadata: { selection: body.selection ?? null } });
      return out;
    },
  }),
];
