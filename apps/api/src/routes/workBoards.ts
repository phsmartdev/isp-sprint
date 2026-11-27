/**
 * Quadro de Tarefas dos departamentos (27/11/2026) — Etapas 2 a 4 da especificação.
 *
 * O quadro é uma VISÃO sobre as tarefas que já existem (tabela activities): CRM, Contratos, Sucesso do Cliente,
 * Projetos e avulsas. Nada é copiado: abrir, mover e concluir usam a mesma tarefa (o drawer e o PATCH /tasks/:id).
 * O departamento da tarefa é o escolhido nela ou o da equipe do responsável. No Marketing, os cartões do quadro
 * próprio aparecem espelhados (só leitura aqui; editar é no quadro do Marketing).
 */
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  BOARD_FEATURE, BOARD_KEYS, BOARD_LABELS, CAPACITY_CATEGORIES, DEFAULT_CAPACITY_POLICY, boardColumn, boardOfTask, taskCategory, taskOrigin, weekStart,
  type BoardKey, type CapacityCategory,
} from '@isp/domain';
import { assertModuleOpen, defineRoute } from '../http/route';
import { forbidden, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { audit } from '../services/audit';
import { activityScope, loadTask, taskEvent } from '../services/tasks';
import { notifyTask } from '../services/contractNotify';

const Board = z.object({ board: z.enum(BOARD_KEYS) });
const GESTAO = ['diretoria', 'gerencia', 'administrador'];

/** Configuração dos quadros (equipes, limite em execução); sem registro, o padrão. */
export async function boardsConfig(db: DbOrTx, tenantId: string) {
  const rows = await db.select().from(s.taskBoards).where(eq(s.taskBoards.tenantId, tenantId));
  return BOARD_KEYS.map((key) => {
    const r = rows.find((x) => x.key === key);
    return { key, label: BOARD_LABELS[key], teamIds: r?.teamIds ?? [], wipLimit: r?.wipLimit ?? 3, wipCountsWaiting: r?.wipCountsWaiting ?? false };
  });
}

/** Diretriz 70/20/10 vigente do quadro (a última versão) ou o padrão. */
export async function capacityPolicy(db: DbOrTx, tenantId: string, board: BoardKey) {
  const [p] = await db.select().from(s.capacityPolicies).where(and(eq(s.capacityPolicies.tenantId, tenantId), eq(s.capacityPolicies.boardKey, board))).orderBy(desc(s.capacityPolicies.version)).limit(1);
  return p ? { version: p.version, comercial: p.commercialBp, interno: p.internalBp, hipotese: p.hypothesisBp, reason: p.reason, createdAt: p.createdAt } : { version: 0, ...DEFAULT_CAPACITY_POLICY, reason: 'Padrão 70/20/10', createdAt: null };
}

/**
 * Papel da pessoa no quadro, pela hierarquia das equipes do quadro (cada time faz a gestão só do seu):
 * gestão = gerente ou diretor de uma equipe do quadro; liderança = líder de uma equipe do quadro; senão colaborador.
 * Quem gere os dois times (a mesma gestão) faz nos dois. Perfil de administrador só configura o quadro.
 */
export async function boardRole(db: DbOrTx, auth: AuthContext, teamIds: string[]): Promise<'gestao' | 'lideranca' | 'colaborador'> {
  if (!teamIds.length) return 'colaborador';
  const [mgr] = await db.select({ n: sql<number>`count(*)::int` }).from(s.teams).where(and(inArray(s.teams.id, teamIds), isNull(s.teams.deletedAt), sql`(${auth.userId}::uuid = any(${s.teams.managerIds}) or ${auth.userId}::uuid = any(${s.teams.directorIds}))`));
  if ((mgr?.n ?? 0) > 0) return 'gestao';
  const [lead] = await db.select({ n: sql<number>`count(*)::int` }).from(s.teamMemberships).where(and(inArray(s.teamMemberships.teamId, teamIds), eq(s.teamMemberships.userId, auth.userId), eq(s.teamMemberships.isLead, true)));
  return (lead?.n ?? 0) > 0 ? 'lideranca' : 'colaborador';
}

/** Quadro em que a tarefa está agora (o escolhido nela ou o da equipe do responsável). */
export async function currentBoardOf(db: DbOrTx, tenantId: string, t: { boardKey: string | null; ownerId: string }) {
  const boards = await boardsConfig(db, tenantId);
  const byUser = await teamsByUser(db, tenantId);
  return { board: boardOfTask({ boardKey: t.boardKey, ownerTeamIds: byUser.get(t.ownerId) ?? [] }, boards), boards };
}

/**
 * Gestão da tarefa (responsável, prazo, planejamento): só a liderança ou a gestão do quadro em que ela está.
 * Quem enviou de outro time acompanha, mas não gere — a não ser que seja da mesma gestão.
 */
export async function assertBoardManagement(db: DbOrTx, auth: AuthContext, t: { boardKey: string | null; ownerId: string; originBoard: string | null }) {
  if (!t.originBoard) return; // tarefa do próprio time: valem as regras de sempre da tarefa
  const { board, boards } = await currentBoardOf(db, auth.tenantId, t);
  if (!board || board === t.originBoard) return;
  const role = await boardRole(db, auth, boards.find((b) => b.key === board)!.teamIds);
  if (role === 'colaborador') throw forbidden(`Esta tarefa foi enviada para ${BOARD_LABELS[board]}: quem planeja, distribui e muda o prazo é a liderança desse time.`);
}

export function assertBoardOpen(auth: AuthContext, board: BoardKey) {
  assertModuleOpen(auth, board === 'marketing' ? 'campanhas' : 'atividades', BOARD_FEATURE[board]);
  if (level(auth, 'atividades') === 'nenhum') throw forbidden('Seu perfil não tem acesso a tarefas.');
}

/** Equipes de cada pessoa (para achar o quadro da tarefa pelo responsável). */
export async function teamsByUser(db: DbOrTx, tenantId: string) {
  const rows = await db.select({ userId: s.teamMemberships.userId, teamId: s.teamMemberships.teamId }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(and(eq(s.teams.tenantId, tenantId), isNull(s.teams.deletedAt)));
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.userId, [...(m.get(r.userId) ?? []), r.teamId]);
  return m;
}

export const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export const workBoardRoutes = [
  defineRoute({
    method: 'GET', url: '/quadros', summary: 'Quadros de Tarefas que a pessoa vê (ligados na empresa e com acesso), com as equipes de cada um', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      const all = await boardsConfig(app.db, auth.tenantId);
      const open = all.filter((b) => { try { assertBoardOpen(auth, b.key); return true; } catch { return false; } });
      return { items: await Promise.all(open.map(async (b) => ({ ...b, role: await boardRole(app.db, auth, b.teamIds) }))) };
    },
  }),

  defineRoute({
    method: 'GET', url: '/quadros/:board', summary: 'Quadro do departamento: tarefas de todos os módulos (sem cópia), visões, filtros e indicadores', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board,
    query: z.object({
      view: z.enum(['todas', 'semana', 'nao_planejadas', 'minhas', 'enviadas']).default('todas'),
      week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      q: z.string().trim().max(100).optional(), ownerId: z.string().uuid().optional(),
      origin: z.string().max(40).optional(), category: z.enum([...CAPACITY_CATEGORIES, 'sem']).optional(), priority: z.enum(['baixa', 'media', 'alta']).optional(),
      blocked: z.coerce.boolean().optional(), includeDone: z.coerce.boolean().optional(),
    }),
    handler: async ({ app, auth, params, query }) => {
      const board = params.board as BoardKey;
      assertBoardOpen(auth, board);
      const boards = await boardsConfig(app.db, auth.tenantId);
      const cfg = boards.find((b) => b.key === board)!;
      const role = await boardRole(app.db, auth, cfg.teamIds);
      const byUser = await teamsByUser(app.db, auth.tenantId);
      const members = [...byUser.entries()].filter(([, ts]) => ts.some((t) => cfg.teamIds.includes(t))).map(([u]) => u);
      const today = ymd(new Date(), auth.timezone);
      const week = weekStart(query.week ?? today);
      const owner = alias(s.users, 'owner');
      const w: SQL[] = [activityScope(auth), isNull(s.activities.parentId), sql`${s.activities.status} <> 'cancelada'`,
        or(eq(s.activities.boardKey, board), and(isNull(s.activities.boardKey), members.length ? inArray(s.activities.ownerId, members) : sql`false`))!];
      // concluídas: só com o filtro, ou as concluídas da semana escolhida (para o progresso)
      if (!query.includeDone) w.push(or(isNull(s.activities.completedAt), sql`${s.activities.completedAt} >= ${week}::date`)!);
      const rows = await app.db.select({
        a: s.activities, ownerName: owner.name, oppCode: s.opportunities.code, oppTitle: s.opportunities.title, oppValue: s.opportunities.valueCents, oppStage: s.opportunities.stage,
        contactName: s.contacts.name, contractCode: s.contracts.code, projectName: s.projects.name,
      }).from(s.activities)
        .leftJoin(owner, eq(owner.id, s.activities.ownerId))
        .leftJoin(s.opportunities, eq(s.opportunities.id, s.activities.opportunityId))
        .leftJoin(s.contacts, eq(s.contacts.id, s.activities.contactId))
        .leftJoin(s.contracts, eq(s.contracts.id, s.activities.contractId))
        .leftJoin(s.projects, eq(s.projects.id, s.activities.projectId))
        .where(and(...w)).orderBy(sql`${s.activities.planOrder} asc nulls last`, sql`${s.activities.dueAt} asc nulls last`).limit(1500);
      const now = Date.now();
      let items = rows
        .filter((r) => boardOfTask({ boardKey: r.a.boardKey, ownerTeamIds: byUser.get(r.a.ownerId) ?? [] }, boards) === board)
        .map((r) => {
          const a = r.a;
          const planned = a.plannedWeek === week;
          const category = taskCategory(a);
          const dueDay = a.dueAt ? ymd(a.dueAt, auth.timezone) : null;
          const done = a.status === 'concluida';
          return {
            id: a.id, ref: `T-${a.id.slice(0, 6).toUpperCase()}`, title: a.title, type: a.type, status: a.status, column: boardColumn({ status: a.status, planned }), rowVersion: a.rowVersion,
            ownerId: a.ownerId, ownerName: r.ownerName, priority: a.priority, dueAt: a.dueAt, dueDay, agreedDueAt: a.agreedDueAt,
            category, categoryAuto: !a.capacityCategory && !!category, estimateMinutes: a.estimateMinutes, remainingMinutes: a.remainingMinutes,
            origin: taskOrigin(a), commercial: !!a.opportunityId, plannedWeek: a.plannedWeek, planned, planOrder: a.planOrder,
            blocked: a.status === 'aguardando', waitingOn: a.waitingOn, protectedCommitment: a.protectedCommitment, observer: a.participants.includes(auth.userId), observers: a.participants.length,
            overdue: !done && !!a.dueAt && a.dueAt.getTime() < now, dueToday: !done && dueDay === today,
            link: a.opportunityId ? { kind: 'oportunidade', label: `OP-${r.oppCode} · ${r.contactName ?? r.oppTitle ?? ''}`, to: `/opportunities/${a.opportunityId}`, valueCents: r.oppValue, stage: r.oppStage }
              : a.contractId ? { kind: 'contrato', label: `Contrato ${r.contractCode ?? ''}`, to: `/contracts/${a.contractId}` }
              : a.projectId ? { kind: 'projeto', label: r.projectName ?? 'Projeto', to: `/projetos/${a.projectId}` }
              : a.contactId ? { kind: 'conta', label: r.contactName ?? 'Conta', to: `/customers/${a.contactId}` } : null,
            readOnly: false, completedAt: a.completedAt,
          };
        });
      // Marketing: os cartões do quadro do Marketing aparecem espelhados (editar é lá)
      if (board === 'marketing') {
        const cards = await app.db.select({ c: s.mktCards, ownerName: owner.name }).from(s.mktCards).leftJoin(owner, eq(owner.id, s.mktCards.ownerId))
          .where(and(eq(s.mktCards.tenantId, auth.tenantId), isNull(s.mktCards.archivedAt), query.includeDone ? undefined : sql`(${s.mktCards.column} <> 'concluido' or ${s.mktCards.completedAt} >= ${week}::date)`));
        const visible = level(auth, 'atividades') === 'total' || role !== 'colaborador' ? cards : cards.filter((x) => x.c.ownerId === auth.userId || x.c.observerIds.includes(auth.userId));
        items = items.concat(visible.map(({ c, ownerName }) => ({
          id: `mkt:${c.id}`, ref: `MKT-${c.code}`, title: c.title, type: 'tarefa', status: c.column === 'concluido' ? 'concluida' : c.column === 'em_execucao' ? 'em_andamento' : c.column === 'revisao' ? 'em_aprovacao' : 'a_fazer',
          column: (c.column === 'revisao' ? 'em_revisao' : c.column) as ReturnType<typeof boardColumn>, rowVersion: c.rowVersion, ownerId: c.ownerId, ownerName, priority: c.priority,
          dueAt: c.dueOn ? new Date(`${c.dueOn}T12:00:00Z`) : null, dueDay: c.dueOn, agreedDueAt: null, category: null, categoryAuto: false, estimateMinutes: null, remainingMinutes: null,
          origin: 'marketing' as const, commercial: false, plannedWeek: null, planned: !!c.sprintId, planOrder: c.position, blocked: false, waitingOn: null, protectedCommitment: false,
          observer: c.observerIds.includes(auth.userId), observers: c.observerIds.length, overdue: c.column !== 'concluido' && !!c.dueOn && c.dueOn < today, dueToday: c.column !== 'concluido' && c.dueOn === today,
          link: { kind: 'marketing', label: c.furaFila ? 'Quadro do Marketing · fura-fila' : 'Quadro do Marketing', to: `/marketing/quadro?card=${c.id}`, valueCents: null, stage: null },
          readOnly: true, completedAt: c.completedAt,
        })));
      }
      // enviadas para outros times: acompanha a execução (só leitura) — quem é do quadro de origem
      let sent: typeof items = [];
      if (query.view === 'enviadas') {
        const isMember = members.includes(auth.userId) || role !== 'colaborador';
        const srows = !isMember ? [] : await app.db.select({ a: s.activities, ownerName: owner.name }).from(s.activities).leftJoin(owner, eq(owner.id, s.activities.ownerId))
          .where(and(eq(s.activities.tenantId, auth.tenantId), isNull(s.activities.deletedAt), eq(s.activities.originBoard, board), sql`${s.activities.boardKey} is distinct from ${board}`, sql`${s.activities.status} <> 'cancelada'`))
          .orderBy(desc(s.activities.sentAt)).limit(300);
        sent = srows.map(({ a, ownerName }) => {
          const done = a.status === 'concluida';
          const dueDay = a.dueAt ? ymd(a.dueAt, auth.timezone) : null;
          return {
            id: a.id, ref: `T-${a.id.slice(0, 6).toUpperCase()}`, title: a.title, type: a.type, status: a.status, column: boardColumn({ status: a.status, planned: !!a.plannedWeek }), rowVersion: a.rowVersion,
            ownerId: a.ownerId, ownerName, priority: a.priority, dueAt: a.dueAt, dueDay, agreedDueAt: a.agreedDueAt, category: taskCategory(a), categoryAuto: false, estimateMinutes: a.estimateMinutes, remainingMinutes: a.remainingMinutes,
            origin: taskOrigin(a), commercial: !!a.opportunityId, plannedWeek: a.plannedWeek, planned: !!a.plannedWeek, planOrder: a.planOrder, blocked: a.status === 'aguardando', waitingOn: a.waitingOn,
            protectedCommitment: a.protectedCommitment, observer: true, observers: a.participants.length, overdue: !done && !!a.dueAt && a.dueAt.getTime() < now, dueToday: !done && dueDay === today,
            link: { kind: 'enviada', label: `Com ${BOARD_LABELS[a.boardKey as BoardKey] ?? 'outro time'}`, to: '', valueCents: null, stage: null }, readOnly: true, completedAt: a.completedAt,
          };
        });
      }
      const all = items;
      // visões e filtros
      if (query.view === 'semana') items = items.filter((i) => i.planned);
      if (query.view === 'nao_planejadas') items = items.filter((i) => !i.planned && i.status !== 'concluida');
      if (query.view === 'minhas') items = items.filter((i) => i.ownerId === auth.userId || i.observer);
      if (query.view === 'enviadas') items = sent;
      if (query.ownerId) items = items.filter((i) => i.ownerId === query.ownerId);
      if (query.origin) items = items.filter((i) => i.origin === query.origin);
      if (query.category) items = items.filter((i) => (query.category === 'sem' ? !i.category : i.category === query.category));
      if (query.priority) items = items.filter((i) => i.priority === query.priority);
      if (query.blocked) items = items.filter((i) => i.blocked);
      if (query.q) { const t = query.q.toLowerCase(); items = items.filter((i) => i.title.toLowerCase().includes(t) || i.ref.toLowerCase().includes(t) || (i.link?.label ?? '').toLowerCase().includes(t)); }
      // indicadores (sobre o quadro todo, não sobre o filtro): esforço estimado, nunca horas trabalhadas
      const open = all.filter((i) => i.status !== 'concluida');
      const plannedAll = all.filter((i) => i.planned);
      const minutes = (l: typeof all) => l.reduce((t, i) => t + (i.estimateMinutes ?? 0), 0);
      const dist = (l: typeof all) => Object.fromEntries(CAPACITY_CATEGORIES.map((c) => [c, minutes(l.filter((i) => i.category === c))])) as Record<CapacityCategory, number>;
      // mesmo critério do Quadro do Marketing: vence em até 2 dias
      const soon = new Date(now + 2 * 86_400_000);
      const kpis = {
        overdue: open.filter((i) => i.overdue).length,
        dueToday: open.filter((i) => i.dueToday).length,
        dueSoon: open.filter((i) => !i.overdue && !i.dueToday && i.dueAt && i.dueAt.getTime() <= soon.getTime()).length,
        blocked: open.filter((i) => i.blocked).length,
        uncategorized: open.filter((i) => !i.category && !i.readOnly).length,
        withoutEstimate: open.filter((i) => !i.estimateMinutes && !i.readOnly).length,
        commercialUnplanned: open.filter((i) => i.commercial && !i.planned).length,
        inExecution: [...open.filter((i) => i.status === 'em_andamento' && !i.readOnly).reduce((m, i) => m.set(i.ownerName ?? '—', (m.get(i.ownerName ?? '—') ?? 0) + 1), new Map<string, number>())].map(([name, n]) => ({ name, n })),
        week: { plannedMinutes: minutes(plannedAll), doneMinutes: minutes(plannedAll.filter((i) => i.status === 'concluida')), plannedCount: plannedAll.length, doneCount: plannedAll.filter((i) => i.status === 'concluida').length, distribution: dist(plannedAll) },
        openDistribution: dist(open),
      };
      const owners = [...new Map(all.map((i) => [i.ownerId, i.ownerName ?? ''])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      return { board: { ...cfg, role }, week, today, policy: await capacityPolicy(app.db, auth.tenantId, board), kpis, owners, items, total: all.length };
    },
  }),

  defineRoute({
    method: 'PUT', url: '/quadros/:board/config', summary: 'Equipes do departamento e limite de tarefas em execução (gestão)', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board,
    body: z.object({ teamIds: z.array(z.string().uuid()).max(30), wipLimit: z.number().int().min(1).max(20), wipCountsWaiting: z.boolean() }),
    handler: async ({ app, auth, params, body, req }) => {
      const board = params.board as BoardKey;
      assertBoardOpen(auth, board);
      const cfgNow = (await boardsConfig(app.db, auth.tenantId)).find((b) => b.key === board)!;
      if (!auth.profiles.includes('administrador') && (await boardRole(app.db, auth, cfgNow.teamIds)) !== 'gestao' && !(cfgNow.teamIds.length === 0 && auth.profiles.some((p) => GESTAO.includes(p))))
        throw forbidden('Quem configura o quadro é a gestão do departamento ou o administrador.');
      if (body.teamIds.length) {
        const ok = await app.db.select({ id: s.teams.id }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), isNull(s.teams.deletedAt), inArray(s.teams.id, body.teamIds)));
        if (ok.length !== new Set(body.teamIds).size) throw unprocessable('Equipe não encontrada.');
      }
      const before = (await boardsConfig(app.db, auth.tenantId)).find((b) => b.key === board)!;
      await app.db.insert(s.taskBoards).values({ tenantId: auth.tenantId, key: board, teamIds: [...new Set(body.teamIds)], wipLimit: body.wipLimit, wipCountsWaiting: body.wipCountsWaiting, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: [s.taskBoards.tenantId, s.taskBoards.key], set: { teamIds: [...new Set(body.teamIds)], wipLimit: body.wipLimit, wipCountsWaiting: body.wipCountsWaiting, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'task_board.config', entityType: 'task_board', entityId: board, metadata: { from: before, to: body } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET', url: '/quadros/:board/politica', summary: 'Diretriz de capacidade 70/20/10 do departamento: vigente e histórico de versões', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board,
    handler: async ({ app, auth, params }) => {
      assertBoardOpen(auth, params.board as BoardKey);
      const versions = await app.db.select({ version: s.capacityPolicies.version, comercial: s.capacityPolicies.commercialBp, interno: s.capacityPolicies.internalBp, hipotese: s.capacityPolicies.hypothesisBp, reason: s.capacityPolicies.reason, createdAt: s.capacityPolicies.createdAt, by: s.users.name })
        .from(s.capacityPolicies).leftJoin(s.users, eq(s.users.id, s.capacityPolicies.createdBy)).where(and(eq(s.capacityPolicies.tenantId, auth.tenantId), eq(s.capacityPolicies.boardKey, params.board))).orderBy(desc(s.capacityPolicies.version));
      return { current: await capacityPolicy(app.db, auth.tenantId, params.board as BoardKey), versions };
    },
  }),

  defineRoute({
    method: 'POST', url: '/quadros/:board/politica', summary: 'Nova versão da diretriz 70/20/10 (gerência ou diretoria); não muda planejamentos encerrados', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: Board,
    body: z.object({ comercial: z.number().int().min(0).max(10_000), interno: z.number().int().min(0).max(10_000), hipotese: z.number().int().min(0).max(10_000), reason: z.string().trim().min(10, 'Explique o motivo da mudança').max(500) })
      .refine((b) => b.comercial + b.interno + b.hipotese === 10_000, 'As três categorias somam 100%.'),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const board = params.board as BoardKey;
      assertBoardOpen(auth, board);
      const teamIds = (await boardsConfig(app.db, auth.tenantId)).find((b) => b.key === board)!.teamIds;
      if ((await boardRole(app.db, auth, teamIds)) !== 'gestao') throw forbidden('A diretriz de capacidade do departamento é definida pela gerência ou pela diretoria dele.');
      const cur = await capacityPolicy(app.db, auth.tenantId, board);
      const [r] = await app.db.insert(s.capacityPolicies).values({ tenantId: auth.tenantId, boardKey: board, version: cur.version + 1, commercialBp: body.comercial, internalBp: body.interno, hypothesisBp: body.hipotese, reason: body.reason, createdBy: auth.userId }).returning();
      await audit(app.db, req, { action: 'capacity_policy.create', entityType: 'task_board', entityId: board, metadata: { from: cur, to: body } });
      reply.code(201);
      return { version: r!.version };
    },
  }),

  defineRoute({
    method: 'POST', url: '/quadros/tarefas/:id/enviar', summary: 'Envia a tarefa para o quadro de outro time: entra no backlog dele, com a liderança de lá; quem enviou acompanha em "Enviadas"', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ to: z.enum(BOARD_KEYS), note: z.string().trim().max(1000).optional() }),
    handler: async ({ app, auth, params, body }) => {
      const to = body.to as BoardKey;
      assertBoardOpen(auth, to);
      const out = await app.db.transaction(async (tx) => {
        const { t, can } = await loadTask(tx, auth, params.id);
        if (!can.edit) throw forbidden('Só quem pode alterar a tarefa a envia para outro time.');
        if (t.status === 'concluida') throw unprocessable('Tarefa concluída não é enviada.');
        const { board: from, boards } = await currentBoardOf(tx, auth.tenantId, t);
        if (from === to) throw unprocessable(`A tarefa já está em ${BOARD_LABELS[to]}.`);
        if (t.originBoard && from !== t.originBoard) await assertBoardManagement(tx, auth, t); // reenviar de quem recebeu é decisão de quem recebeu
        // chega para a liderança do time de destino, que distribui e planeja
        const target = boards.find((b) => b.key === to)!;
        if (!target.teamIds.length) throw unprocessable(`O quadro ${BOARD_LABELS[to]} ainda não tem equipes configuradas.`);
        const [lead] = await tx.select({ userId: s.teamMemberships.userId }).from(s.teamMemberships).innerJoin(s.users, eq(s.users.id, s.teamMemberships.userId))
          .where(and(inArray(s.teamMemberships.teamId, target.teamIds), eq(s.teamMemberships.isLead, true), eq(s.users.active, true))).limit(1);
        const [mgr] = lead ? [] : await tx.select({ ids: s.teams.managerIds }).from(s.teams).where(and(inArray(s.teams.id, target.teamIds), sql`cardinality(${s.teams.managerIds}) > 0`)).limit(1);
        const newOwner = lead?.userId ?? mgr?.ids[0];
        if (!newOwner) throw unprocessable(`O quadro ${BOARD_LABELS[to]} não tem líder nem gestor nas equipes: configure antes de enviar.`);
        // acompanham (observadores): quem enviou, o responsável anterior e a liderança do time de origem
        const originTeams = boards.find((b) => b.key === (t.originBoard ?? from))?.teamIds ?? [];
        const originLeads = originTeams.length ? (await tx.select({ id: s.teamMemberships.userId }).from(s.teamMemberships).where(and(inArray(s.teamMemberships.teamId, originTeams), eq(s.teamMemberships.isLead, true)))).map((r) => r.id) : [];
        const watchers = [...new Set([...t.participants, auth.userId, t.ownerId, ...originLeads])].filter((u) => u !== newOwner);
        await tx.update(s.activities).set({
          boardKey: to, originBoard: t.originBoard ?? from ?? null, sentBy: auth.userId, sentAt: new Date(), ownerId: newOwner, participants: watchers,
          plannedWeek: null, planOrder: null, status: t.status === 'em_andamento' || t.status === 'aguardando' ? 'a_fazer' : t.status,
          updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1`,
        }).where(eq(s.activities.id, t.id));
        await taskEvent(tx, auth, t.id, 'enviada', { from, to, toOwner: newOwner, note: body.note ?? null });
        return { owner: newOwner };
      });
      await notifyTask(app.db, app.config, params.id, 'criada', { cycle: `enviada:${to}:${Date.now()}` }).catch(() => undefined);
      return { ok: true, ...out };
    },
  }),

  defineRoute({
    method: 'PATCH', url: '/quadros/tarefas/:id/planejamento', summary: 'Departamento, categoria 70/20/10 (mudar a automática exige justificativa), esforço, prazo acordado e compromisso protegido', tag: 'Quadro de Tarefas', anyAuthenticated: true,
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      rowVersion: z.number().int(),
      boardKey: z.enum(BOARD_KEYS).nullable().optional(),
      capacityCategory: z.enum(CAPACITY_CATEGORIES).nullable().optional(), categoryReason: z.string().trim().max(500).optional(),
      estimateMinutes: z.number().int().min(0).max(60 * 400).nullable().optional(), remainingMinutes: z.number().int().min(0).max(60 * 400).nullable().optional(),
      agreedDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), protectedCommitment: z.boolean().optional(),
    }),
    handler: async ({ app, auth, params, body }) => {
      if (level(auth, 'atividades') === 'nenhum') throw forbidden('Seu perfil não tem acesso a tarefas.');
      return app.db.transaction(async (tx) => {
        const { t, can } = await loadTask(tx, auth, params.id);
        // pode planejar: quem pode alterar a tarefa ou a liderança/gestão do quadro em que ela está
        if (!can.edit) {
          const { board, boards } = await currentBoardOf(tx, auth.tenantId, t);
          if (!board || (await boardRole(tx, auth, boards.find((b) => b.key === board)!.teamIds)) === 'colaborador') throw forbidden('Você pode comentar, mas não alterar esta tarefa.');
        }
        if (body.boardKey !== undefined && body.boardKey !== t.boardKey) throw unprocessable('Para passar a tarefa a outro time, use "Enviar para outro time".');
        // o responsável estima o próprio esforço; o resto do planejamento é da liderança do quadro em que a tarefa está
        const onlyEffort = Object.keys(body).every((k) => ['rowVersion', 'estimateMinutes', 'remainingMinutes'].includes(k));
        if (!(onlyEffort && t.ownerId === auth.userId)) await assertBoardManagement(tx, auth, t);
        if (t.rowVersion !== body.rowVersion) throw unprocessable('A tarefa foi alterada por outra pessoa. Recarregue.');
        const before = { boardKey: t.boardKey, category: taskCategory(t), estimateMinutes: t.estimateMinutes, remainingMinutes: t.remainingMinutes, agreedDueAt: t.agreedDueAt, protectedCommitment: t.protectedCommitment };
        // tarefa de oportunidade nasce comercial: tirar dessa categoria (ou trocar uma escolhida) pede justificativa
        if (body.capacityCategory !== undefined && body.capacityCategory !== before.category && before.category && (body.categoryReason ?? '').length < 10)
          throw unprocessable('Explique por que a categoria muda (mínimo 10 caracteres).', [{ path: 'categoryReason', message: 'Obrigatório' }]);
        const agreedDueAt = body.agreedDueOn === undefined ? undefined : body.agreedDueOn === null ? null : new Date(`${body.agreedDueOn}T23:59:00${tzOffset(auth.timezone)}`);
        await tx.update(s.activities).set({
          boardKey: body.boardKey, capacityCategory: body.capacityCategory, estimateMinutes: body.estimateMinutes, remainingMinutes: body.remainingMinutes,
          agreedDueAt, protectedCommitment: body.protectedCommitment, updatedAt: new Date(), rowVersion: sql`${s.activities.rowVersion} + 1`,
        }).where(eq(s.activities.id, t.id));
        const changed = Object.entries({ boardKey: body.boardKey, category: body.capacityCategory, estimateMinutes: body.estimateMinutes, remainingMinutes: body.remainingMinutes, agreedDueAt: body.agreedDueOn, protectedCommitment: body.protectedCommitment })
          .filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify((before as Record<string, unknown>)[k === 'agreedDueAt' ? 'agreedDueAt' : k]));
        if (changed.length) await taskEvent(tx, auth, t.id, 'planejamento', { from: before, to: Object.fromEntries(changed), reason: body.categoryReason ?? null });
        return { ok: true };
      });
    },
  }),
];

/** Deslocamento do fuso (só para gravar o fim do dia do prazo acordado). */
function tzOffset(tz: string) {
  const d = new Date();
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const min = Math.round((local.getTime() - utc.getTime()) / 60_000);
  const sign = min >= 0 ? '+' : '-';
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

