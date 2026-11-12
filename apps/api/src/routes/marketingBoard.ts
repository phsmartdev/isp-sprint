/**
 * Marketing → Quadro de tarefas (Anexos V, VI e VII): Sprint quinzenal, colunas, um responsável e observadores,
 * prazos com alerta, etiquetas que relacionam outras atividades da ferramenta, consumo de orçamento e brindes no cartão,
 * fura-fila com aprovação da liderança, limite de tarefas simultâneas e comunicações oficiais da Sprint.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  FURA_FILA_CRITERIA, MKT_ALLOCATIONS, MKT_COLUMNS, MKT_LINK_TYPES, MKT_PRIORITIES, MKT_SPRINT_DAYS, MKT_VERTICALS, MKT_WIP_LIMIT, MKT_COLUMN_LABELS,
  addDaysIso, atLeast, boardStats, dueState, sprintEmail, type MktLinkType,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable, conflict } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { audit } from '../services/audit';
import { todayIn } from '../services/vacations';
import { sendEmail } from '../services/email';
import { costCentersOf } from '../services/budget';

const M = { tag: 'Marketing', module: 'campanhas' as const };
const uuid = z.string().uuid();
/** Liderança de Marketing: abre e encerra a Sprint, aprova fura-fila e edita qualquer cartão. */
const isLead = (auth: AuthContext) => atLeast(level(auth, 'campanhas'), 'equipe');
const canEditCard = (auth: AuthContext, c: { ownerId: string; createdBy: string | null; observerIds: string[] }) => isLead(auth) || c.ownerId === auth.userId || c.createdBy === auth.userId;

async function loadCard(db: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await db.select().from(s.mktCards).where(and(eq(s.mktCards.id, id), eq(s.mktCards.tenantId, auth.tenantId), isNull(s.mktCards.archivedAt)));
  if (!c) throw notFound('Tarefa não encontrada.');
  return c;
}
async function assertPeople(db: DbOrTx, tenantId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), inArray(s.users.id, ids)));
  if (rows.length !== new Set(ids).size) throw unprocessable('Escolha pessoas ativas da empresa.', [{ path: 'ownerId', message: 'Pessoa inválida' }]);
}
const event = (db: DbOrTx, auth: AuthContext, cardId: string, type: string, text: string | null) => db.insert(s.mktCardEvents).values({ tenantId: auth.tenantId, cardId, type, text, actorId: auth.userId });

/** Avisa responsável e observadores (aviso interno, sem repetir). */
async function notifyCard(db: DbOrTx, auth: AuthContext, card: { id: string; code: number; title: string; ownerId: string; observerIds: string[] }, eventKey: string, title: string, onlyOwner = false) {
  const to = [...new Set([card.ownerId, ...(onlyOwner ? [] : card.observerIds)])].filter((u) => u !== auth.userId);
  for (const u of to) {
    await db.insert(s.userNotifications).values({ tenantId: auth.tenantId, userId: u, module: 'marketing', event: eventKey, title: title.slice(0, 200), body: `MKT-${card.code} · ${card.title}`.slice(0, 300), link: `/marketing/quadro?tarefa=${card.id}`, actorId: auth.userId, dedupeKey: `mkt:${eventKey}:${card.id}:${Date.now()}` }).onConflictDoNothing();
  }
}

/** Prazos: avisa (uma vez por dia) quem é responsável por tarefa atrasada ou que vence hoje/amanhã. Roda na rotina diária. */
export async function runMarketingDueAlerts(db: DbOrTx, tenantId: string, today: string) {
  const cards = await db.select().from(s.mktCards).where(and(eq(s.mktCards.tenantId, tenantId), isNull(s.mktCards.archivedAt), sql`${s.mktCards.column} <> 'concluido'`, sql`${s.mktCards.dueOn} is not null`, sql`${s.mktCards.dueOn} <= ${addDaysIso(today, 1)}::date`));
  let n = 0;
  for (const c of cards) {
    const st = dueState(c, today);
    const title = st === 'atrasada' ? `Tarefa de Marketing atrasada: ${c.title}` : st === 'vence_hoje' ? `Tarefa de Marketing vence hoje: ${c.title}` : `Tarefa de Marketing vence amanhã: ${c.title}`;
    for (const u of [...new Set([c.ownerId, ...c.observerIds])]) {
      const r = await db.insert(s.userNotifications).values({ tenantId, userId: u, module: 'marketing', event: 'mkt_prazo', title: title.slice(0, 200), body: `MKT-${c.code}`, link: `/marketing/quadro?tarefa=${c.id}`, dedupeKey: `mkt:prazo:${c.id}:${today}` }).onConflictDoNothing().returning({ id: s.userNotifications.id });
      n += r.length;
    }
  }
  return n;
}

const CardBody = z.object({
  title: z.string().trim().min(2).max(200),
  briefing: z.string().trim().max(8000).nullable().optional(),
  ownerId: uuid,
  observerIds: z.array(uuid).max(20).default([]),
  dueOn: z.string().date().nullable().optional(),
  priority: z.enum(MKT_PRIORITIES).default('media'),
  verticals: z.array(z.enum(MKT_VERTICALS)).max(5).default([]),
  allocation: z.enum(MKT_ALLOCATIONS).nullable().optional(),
  requester: z.string().trim().max(120).nullable().optional(),
  column: z.enum(MKT_COLUMNS).default('backlog'),
  sprintId: uuid.nullable().optional(),
  tagIds: z.array(uuid).max(20).default([]),
  costCenterId: uuid.nullable().optional(),
  budgetLineId: uuid.nullable().optional(),
  budgetCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  gifts: z.array(z.object({ itemId: uuid, qty: z.number().int().min(1).max(100_000) })).max(30).default([]),
  furaFila: z.object({ criterion: z.enum(FURA_FILA_CRITERIA), reason: z.string().trim().min(10).max(2000) }).nullable().optional(),
});

async function giftsOf(db: DbOrTx, tenantId: string, list: { itemId: string; qty: number }[]) {
  if (!list.length) return [];
  const items = await db.select().from(s.giftItems).where(and(eq(s.giftItems.tenantId, tenantId), inArray(s.giftItems.id, list.map((g) => g.itemId))));
  return list.map((g) => {
    const it = items.find((x) => x.id === g.itemId);
    if (!it) throw unprocessable('Brinde não encontrado no catálogo.', [{ path: 'gifts', message: 'Brinde inválido' }]);
    return { itemId: it.id, name: it.name, qty: g.qty, unitCostCents: it.unitCostCents };
  });
}

async function checkBudget(db: DbOrTx, auth: AuthContext, b: { costCenterId?: string | null; budgetLineId?: string | null }) {
  if (!b.costCenterId && !b.budgetLineId) return;
  const ccs = await costCentersOf(db, auth, true);
  const ccId = b.costCenterId ?? null;
  if (ccId && !ccs.some((c) => c.id === ccId)) throw unprocessable('Centro de custo fora dos seus.', [{ path: 'costCenterId', message: 'Escolha um centro de custo seu' }]);
  if (b.budgetLineId) {
    const [l] = await db.select({ cc: s.budgetLines.costCenterId }).from(s.budgetLines).where(and(eq(s.budgetLines.id, b.budgetLineId), eq(s.budgetLines.tenantId, auth.tenantId)));
    if (!l || (ccId && l.cc !== ccId) || !ccs.some((c) => c.id === l.cc)) throw unprocessable('Item do orçamento inválido para este centro de custo.', [{ path: 'budgetLineId', message: 'Item inválido' }]);
  }
}

/** Limite de tarefas simultâneas em execução por pessoa. */
async function assertWip(db: DbOrTx, tenantId: string, ownerId: string, exceptId: string | null) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.mktCards).where(and(eq(s.mktCards.tenantId, tenantId), eq(s.mktCards.ownerId, ownerId), eq(s.mktCards.column, 'em_execucao'), isNull(s.mktCards.archivedAt), exceptId ? sql`${s.mktCards.id} <> ${exceptId}` : undefined));
  if ((r?.n ?? 0) >= MKT_WIP_LIMIT) throw unprocessable(`Esta pessoa já tem ${MKT_WIP_LIMIT} tarefas em execução (limite do rito). Conclua ou devolva uma antes.`, [{ path: 'column', message: 'Limite de tarefas simultâneas' }]);
}

async function boardOf(db: DbOrTx, auth: AuthContext, sprintId: string | null) {
  const today = todayIn(auth.timezone);
  const sprints = await db.select().from(s.mktSprints).where(eq(s.mktSprints.tenantId, auth.tenantId)).orderBy(desc(s.mktSprints.startOn)).limit(30);
  const current = sprintId ? sprints.find((x) => x.id === sprintId) ?? null : sprints.find((x) => x.status === 'aberta') ?? sprints.find((x) => x.status === 'planejamento') ?? null;
  const cards = await db.select().from(s.mktCards).where(and(eq(s.mktCards.tenantId, auth.tenantId), isNull(s.mktCards.archivedAt))).orderBy(asc(s.mktCards.position), asc(s.mktCards.createdAt));
  // concluídas de Sprints anteriores saem do quadro (ficam no histórico)
  const visible = cards.filter((c) => c.column !== 'concluido' || !current || c.sprintId === current.id || (!c.sprintId && c.completedAt && today.slice(0, 7) === c.completedAt.toISOString().slice(0, 7)));
  const ids = visible.map((c) => c.id);
  const [tags, cardTags, links, users] = await Promise.all([
    db.select().from(s.mktTags).where(eq(s.mktTags.tenantId, auth.tenantId)).orderBy(asc(s.mktTags.name)),
    ids.length ? db.select().from(s.mktCardTags).where(inArray(s.mktCardTags.cardId, ids)) : Promise.resolve([]),
    ids.length ? db.select({ cardId: s.mktLinks.cardId, n: sql<number>`count(*)::int` }).from(s.mktLinks).where(inArray(s.mktLinks.cardId, ids)).groupBy(s.mktLinks.cardId) : Promise.resolve([]),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).orderBy(asc(s.users.name)),
  ]);
  const stats = boardStats(visible.map((c) => ({ ownerId: c.ownerId, column: c.column, dueOn: c.dueOn, allocation: c.allocation, furaFila: c.furaFila, sprintId: c.sprintId })), current, today);
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    today, wipLimit: MKT_WIP_LIMIT, canLead: isLead(auth), me: auth.userId,
    sprints: sprints.map((x) => ({ id: x.id, name: x.name, startOn: x.startOn, endOn: x.endOn, status: x.status, objective: x.objective, highlights: x.highlights })),
    sprint: current ? { id: current.id, name: current.name, startOn: current.startOn, endOn: current.endOn, status: current.status, objective: current.objective, highlights: current.highlights } : null,
    stats: { ...stats, overLimit: stats.overLimit.map((o) => ({ ...o, name: name.get(o.ownerId) ?? '' })), wip: stats.wip.map((o) => ({ ...o, name: name.get(o.ownerId) ?? '' })) },
    tags, users,
    cards: visible.map((c) => ({
      id: c.id, code: c.code, title: c.title, column: c.column, position: c.position, ownerId: c.ownerId, ownerName: name.get(c.ownerId) ?? '', observerIds: c.observerIds,
      dueOn: c.dueOn, due: dueState(c, today), priority: c.priority, verticals: c.verticals, allocation: c.allocation, sprintId: c.sprintId, requester: c.requester,
      furaFila: c.furaFila, furaFilaStatus: c.furaFilaStatus, tagIds: cardTags.filter((t) => t.cardId === c.id).map((t) => t.tagId), links: links.find((l) => l.cardId === c.id)?.n ?? 0,
      budgetCents: c.budgetCents, giftCents: c.gifts.reduce((t, g) => t + g.qty * g.unitCostCents, 0), giftQty: c.gifts.reduce((t, g) => t + g.qty, 0),
      rowVersion: c.rowVersion, canEdit: canEditCard(auth, c),
    })),
  };
}

/** Busca do que pode ser relacionado (oportunidades, contas, leads, campanhas, contratos e tarefas). */
async function searchLinkables(db: DbOrTx, auth: AuthContext, q: string) {
  const term = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const [opps, accs, leads, camps, ctrs, tasks] = await Promise.all([
    db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, auth.tenantId), isNull(s.opportunities.deletedAt), ilike(s.opportunities.title, term))).limit(6),
    db.select({ id: s.contacts.id, name: s.contacts.name }).from(s.contacts).where(and(eq(s.contacts.tenantId, auth.tenantId), isNull(s.contacts.deletedAt), ilike(s.contacts.name, term))).limit(6),
    db.select({ id: s.leads.id, name: s.contacts.name }).from(s.leads).innerJoin(s.contacts, eq(s.contacts.id, s.leads.contactId)).where(and(eq(s.leads.tenantId, auth.tenantId), ilike(s.contacts.name, term))).limit(6),
    db.select({ id: s.campaigns.id, name: s.campaigns.name }).from(s.campaigns).where(and(eq(s.campaigns.tenantId, auth.tenantId), ilike(s.campaigns.name, term))).limit(6),
    db.select({ id: s.contracts.id, code: s.contracts.code }).from(s.contracts).innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId)).where(and(eq(s.contracts.tenantId, auth.tenantId), ilike(s.contacts.name, term))).limit(6),
    db.select({ id: s.activities.id, title: s.activities.title }).from(s.activities).where(and(eq(s.activities.tenantId, auth.tenantId), eq(s.activities.type, 'tarefa'), ilike(s.activities.title, term))).limit(6),
  ]);
  const out: { entityType: MktLinkType; entityId: string; label: string }[] = [
    ...opps.map((o) => ({ entityType: 'oportunidade' as const, entityId: o.id, label: `OP-${o.code} · ${o.title}` })),
    ...accs.map((o) => ({ entityType: 'conta' as const, entityId: o.id, label: o.name })),
    ...leads.map((o) => ({ entityType: 'lead' as const, entityId: o.id, label: o.name })),
    ...camps.map((o) => ({ entityType: 'campanha' as const, entityId: o.id, label: o.name })),
    ...ctrs.map((o) => ({ entityType: 'contrato' as const, entityId: o.id, label: `Contrato ${o.code}` })),
    ...tasks.map((o) => ({ entityType: 'tarefa' as const, entityId: o.id, label: o.title })),
  ];
  return out;
}

async function linkLabel(db: DbOrTx, tenantId: string, type: MktLinkType, id: string): Promise<string | null> {
  const one = async <T>(p: Promise<T[]>) => (await p)[0] ?? null;
  switch (type) {
    case 'oportunidade': { const r = await one(db.select({ code: s.opportunities.code, title: s.opportunities.title }).from(s.opportunities).where(and(eq(s.opportunities.id, id), eq(s.opportunities.tenantId, tenantId)))); return r ? `OP-${r.code} · ${r.title}` : null; }
    case 'conta': { const r = await one(db.select({ name: s.contacts.name }).from(s.contacts).where(and(eq(s.contacts.id, id), eq(s.contacts.tenantId, tenantId)))); return r?.name ?? null; }
    case 'lead': { const r = await one(db.select({ name: s.contacts.name }).from(s.leads).innerJoin(s.contacts, eq(s.contacts.id, s.leads.contactId)).where(and(eq(s.leads.id, id), eq(s.leads.tenantId, tenantId)))); return r?.name ?? null; }
    case 'campanha': { const r = await one(db.select({ name: s.campaigns.name }).from(s.campaigns).where(and(eq(s.campaigns.id, id), eq(s.campaigns.tenantId, tenantId)))); return r?.name ?? null; }
    case 'contrato': { const r = await one(db.select({ code: s.contracts.code }).from(s.contracts).where(and(eq(s.contracts.id, id), eq(s.contracts.tenantId, tenantId)))); return r ? `Contrato ${r.code}` : null; }
    case 'tarefa': { const r = await one(db.select({ title: s.activities.title }).from(s.activities).where(and(eq(s.activities.id, id), eq(s.activities.tenantId, tenantId)))); return r?.title ?? null; }
  }
}
const linkUrl = (t: string, id: string) => ({ oportunidade: `/opportunities/${id}`, conta: `/customers/${id}`, lead: `/leads?lead=${id}`, campanha: `/campaigns?c=${id}`, contrato: `/contracts/${id}`, tarefa: `/tarefas?tarefa=${id}` } as Record<string, string>)[t] ?? '#';

export const marketingBoardRoutes = [
  defineRoute({
    method: 'GET', url: '/marketing/quadro', summary: 'Quadro de tarefas do Marketing: Sprint, colunas, cartões com prazos e resumo', ...M,
    query: z.object({ sprintId: uuid.optional() }),
    handler: async ({ app, auth, query }) => boardOf(app.db, auth, query.sprintId ?? null),
  }),
  defineRoute({
    method: 'GET', url: '/marketing/quadro/cards/:id', summary: 'Detalhe do cartão: briefing, observadores, etiquetas, relacionados, orçamento, brindes e histórico', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadCard(app.db, auth, params.id);
      const [tags, links, events, line] = await Promise.all([
        app.db.select({ tagId: s.mktCardTags.tagId }).from(s.mktCardTags).where(eq(s.mktCardTags.cardId, c.id)),
        app.db.select().from(s.mktLinks).where(eq(s.mktLinks.cardId, c.id)).orderBy(asc(s.mktLinks.createdAt)),
        app.db.select({ id: s.mktCardEvents.id, type: s.mktCardEvents.type, text: s.mktCardEvents.text, createdAt: s.mktCardEvents.createdAt, actor: s.users.name }).from(s.mktCardEvents).leftJoin(s.users, eq(s.users.id, s.mktCardEvents.actorId)).where(eq(s.mktCardEvents.cardId, c.id)).orderBy(desc(s.mktCardEvents.createdAt)).limit(100),
        c.budgetLineId ? app.db.select({ what: s.budgetLines.what, amountCents: s.budgetLines.amountCents, month: s.budgetLines.month }).from(s.budgetLines).where(eq(s.budgetLines.id, c.budgetLineId)) : Promise.resolve([]),
      ]);
      const tagIds = tags.map((t) => t.tagId);
      // relacionados pelas etiquetas do cartão
      const viaTags = tagIds.length ? await app.db.select({ id: s.mktLinks.id, tagId: s.mktLinks.tagId, entityType: s.mktLinks.entityType, entityId: s.mktLinks.entityId, label: s.mktLinks.label }).from(s.mktLinks).where(inArray(s.mktLinks.tagId, tagIds)) : [];
      return {
        ...c, tagIds, canEdit: canEditCard(auth, c), canLead: isLead(auth),
        links: links.map((l) => ({ id: l.id, entityType: l.entityType, entityId: l.entityId, label: l.label, url: linkUrl(l.entityType, l.entityId) })),
        tagLinks: viaTags.map((l) => ({ ...l, url: linkUrl(l.entityType, l.entityId) })),
        budgetLine: line[0] ?? null,
        events,
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/marketing/quadro/cards', summary: 'Cria tarefa (um responsável e observadores); dentro de Sprint aberta entra como fura-fila para a liderança aprovar', ...M, body: CardBody,
    handler: async ({ app, auth, body, req, reply }) => {
      await assertPeople(app.db, auth.tenantId, [body.ownerId, ...body.observerIds]);
      await checkBudget(app.db, auth, body);
      const gifts = await giftsOf(app.db, auth.tenantId, body.gifts);
      const id = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mkt-code:${auth.tenantId}`}))`);
        let sprint: typeof s.mktSprints.$inferSelect | null = null;
        if (body.sprintId) {
          sprint = (await tx.select().from(s.mktSprints).where(and(eq(s.mktSprints.id, body.sprintId), eq(s.mktSprints.tenantId, auth.tenantId))))[0] ?? null;
          if (!sprint || sprint.status === 'encerrada') throw unprocessable('Sprint inválida ou encerrada.', [{ path: 'sprintId', message: 'Sprint inválida' }]);
        }
        // Sprint fechada: nova demanda só pela regra de fura-fila
        const fura = sprint?.status === 'aberta';
        if (fura && !body.furaFila) throw unprocessable('A Sprint está fechada: para entrar nela, use a regra de fura-fila (critério e justificativa).', [{ path: 'furaFila', message: 'Obrigatório' }]);
        if (body.column === 'em_execucao') await assertWip(tx, auth.tenantId, body.ownerId, null);
        const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${s.mktCards.code}), 0)::int` }).from(s.mktCards).where(eq(s.mktCards.tenantId, auth.tenantId)) as [{ n: number }];
        const [{ p }] = await tx.select({ p: sql<number>`coalesce(max(${s.mktCards.position}), 0)::int` }).from(s.mktCards).where(and(eq(s.mktCards.tenantId, auth.tenantId), eq(s.mktCards.column, body.column))) as [{ p: number }];
        const [c] = await tx.insert(s.mktCards).values({
          tenantId: auth.tenantId, code: n + 1, title: body.title, briefing: body.briefing ?? null, column: fura ? 'backlog' : body.column, position: p + 1,
          ownerId: body.ownerId, observerIds: [...new Set(body.observerIds.filter((u) => u !== body.ownerId))], dueOn: body.dueOn ?? null, priority: body.priority,
          verticals: body.verticals, allocation: body.allocation ?? null, requester: body.requester ?? null, sprintId: body.sprintId ?? null,
          furaFila: fura, furaFilaStatus: fura ? 'pendente' : null, furaFilaCriterion: fura ? body.furaFila!.criterion : null, furaFilaReason: fura ? body.furaFila!.reason : null,
          costCenterId: body.costCenterId ?? null, budgetLineId: body.budgetLineId ?? null, budgetCents: body.budgetCents ?? null, gifts, createdBy: auth.userId,
        }).returning();
        if (body.tagIds.length) await tx.insert(s.mktCardTags).values(body.tagIds.map((tagId) => ({ tenantId: auth.tenantId, cardId: c!.id, tagId }))).onConflictDoNothing();
        await event(tx, auth, c!.id, 'criado', fura ? `Criada como fura-fila: ${body.furaFila!.reason}` : null);
        await notifyCard(tx, auth, c!, 'mkt_atribuida', `Nova tarefa de Marketing para você: ${c!.title}`);
        if (fura) {
          const leads = await tx.select({ userId: s.userRoles.userId }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).innerJoin(s.users, eq(s.users.id, s.userRoles.userId)).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.roles.key, ['supervisor', 'gerencia'])));
          for (const l of leads) if (l.userId !== auth.userId) await tx.insert(s.userNotifications).values({ tenantId: auth.tenantId, userId: l.userId, module: 'marketing', event: 'mkt_fura_fila', title: `Fura-fila para aprovar: ${c!.title}`.slice(0, 200), body: body.furaFila!.reason.slice(0, 300), link: `/marketing/quadro?tarefa=${c!.id}`, actorId: auth.userId, dedupeKey: `mkt:fura:${c!.id}` }).onConflictDoNothing();
        }
        return c!.id;
      });
      await audit(app.db, req, { action: 'mkt.card.create', entityType: 'mkt_card', entityId: id, metadata: { title: body.title } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/marketing/quadro/cards/:id', summary: 'Altera ou move a tarefa (responsável, criador ou liderança); respeita o limite de tarefas em execução', ...M, params: IdParams,
    body: CardBody.partial().omit({ furaFila: true }).extend({ rowVersion: z.number().int(), position: z.number().int().min(0).optional() }),
    handler: async ({ app, auth, params, body }) => {
      await app.db.transaction(async (tx) => {
        const c = await loadCard(tx, auth, params.id);
        if (c.rowVersion !== body.rowVersion) throw conflict(c.rowVersion);
        if (!canEditCard(auth, c)) throw forbidden('Só o responsável, quem criou a tarefa ou a liderança de Marketing alteram.');
        if (body.ownerId && body.ownerId !== c.ownerId && !isLead(auth) && c.ownerId !== auth.userId) throw forbidden('Trocar o responsável é com o próprio responsável ou a liderança.');
        if (c.furaFila && c.furaFilaStatus === 'pendente' && body.column && body.column !== 'backlog') throw unprocessable('Fura-fila aguardando a liderança: a tarefa só anda depois de aprovada.');
        await assertPeople(tx, auth.tenantId, [...(body.ownerId ? [body.ownerId] : []), ...(body.observerIds ?? [])]);
        await checkBudget(tx, auth, { costCenterId: body.costCenterId === undefined ? c.costCenterId : body.costCenterId, budgetLineId: body.budgetLineId === undefined ? c.budgetLineId : body.budgetLineId });
        const owner = body.ownerId ?? c.ownerId;
        const col = body.column ?? c.column;
        if (col === 'em_execucao' && (c.column !== 'em_execucao' || owner !== c.ownerId)) await assertWip(tx, auth.tenantId, owner, c.id);
        if (body.sprintId && body.sprintId !== c.sprintId) {
          const [sp] = await tx.select().from(s.mktSprints).where(and(eq(s.mktSprints.id, body.sprintId), eq(s.mktSprints.tenantId, auth.tenantId)));
          if (!sp || sp.status === 'encerrada') throw unprocessable('Sprint inválida ou encerrada.');
          if (sp.status === 'aberta' && !isLead(auth)) throw unprocessable('A Sprint está fechada: para colocar a tarefa nela, peça fura-fila à liderança.');
        }
        const gifts = body.gifts ? await giftsOf(tx, auth.tenantId, body.gifts) : undefined;
        const { rowVersion: _rv, tagIds, gifts: _g, ...rest } = body;
        await tx.update(s.mktCards).set({
          ...rest, ...(gifts ? { gifts } : {}),
          ...(body.observerIds ? { observerIds: [...new Set(body.observerIds.filter((u) => u !== owner))] } : {}),
          completedAt: col === 'concluido' ? (c.completedAt ?? new Date()) : null,
          updatedAt: new Date(), rowVersion: c.rowVersion + 1,
        }).where(eq(s.mktCards.id, c.id));
        if (tagIds) {
          await tx.delete(s.mktCardTags).where(eq(s.mktCardTags.cardId, c.id));
          if (tagIds.length) await tx.insert(s.mktCardTags).values(tagIds.map((tagId) => ({ tenantId: auth.tenantId, cardId: c.id, tagId }))).onConflictDoNothing();
        }
        if (body.column && body.column !== c.column) {
          await event(tx, auth, c.id, 'movido', `${MKT_COLUMN_LABELS[c.column as keyof typeof MKT_COLUMN_LABELS]} → ${MKT_COLUMN_LABELS[body.column]}`);
          if (body.column === 'concluido') await notifyCard(tx, auth, { ...c, ownerId: owner }, 'mkt_concluida', `Tarefa de Marketing concluída: ${c.title}`);
        }
        if (body.ownerId && body.ownerId !== c.ownerId) {
          await event(tx, auth, c.id, 'responsavel', 'Responsável alterado');
          await notifyCard(tx, auth, { ...c, ownerId: body.ownerId }, 'mkt_atribuida', `Tarefa de Marketing passou para você: ${c.title}`, true);
        }
        if (body.dueOn !== undefined && body.dueOn !== c.dueOn) await event(tx, auth, c.id, 'prazo', `Prazo: ${c.dueOn ?? 'sem prazo'} → ${body.dueOn ?? 'sem prazo'}`);
      });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/marketing/quadro/cards/:id/comentarios', summary: 'Comenta no cartão (avisa responsável e observadores)', ...M, params: IdParams,
    body: z.object({ text: z.string().trim().min(1).max(4000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const c = await loadCard(app.db, auth, params.id);
      await event(app.db, auth, c.id, 'comentario', body.text);
      await notifyCard(app.db, auth, c, 'mkt_comentario', `Comentário em tarefa de Marketing: ${c.title}`);
      reply.code(201);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/marketing/quadro/cards/:id/fura-fila', summary: 'Liderança aprova (entra na Sprint) ou recusa o fura-fila; tudo fica registrado no cartão', ...M, params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).nullable().default(null), rescheduled: z.array(z.object({ cardId: uuid, dueOn: z.string().date() })).max(20).default([]) }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!isLead(auth)) throw forbidden('Fura-fila é aprovado só pela liderança de Marketing.');
      await app.db.transaction(async (tx) => {
        const c = await loadCard(tx, auth, params.id);
        if (!c.furaFila || c.furaFilaStatus !== 'pendente') throw unprocessable('Esta tarefa não está aguardando fura-fila.');
        if (!body.approve && (!body.note || body.note.length < 5)) throw unprocessable('Diga o motivo da recusa.', [{ path: 'note', message: 'Obrigatório' }]);
        await tx.update(s.mktCards).set({ furaFilaStatus: body.approve ? 'aprovado' : 'recusado', furaFilaDecidedBy: auth.userId, furaFilaDecidedAt: new Date(), column: body.approve ? 'a_fazer' : 'backlog', sprintId: body.approve ? c.sprintId : null, updatedAt: new Date(), rowVersion: c.rowVersion + 1 }).where(eq(s.mktCards.id, c.id));
        const moved: string[] = [];
        for (const r of body.rescheduled) {
          const [o] = await tx.update(s.mktCards).set({ dueOn: r.dueOn, updatedAt: new Date(), rowVersion: sql`${s.mktCards.rowVersion} + 1` }).where(and(eq(s.mktCards.id, r.cardId), eq(s.mktCards.tenantId, auth.tenantId))).returning({ id: s.mktCards.id, title: s.mktCards.title });
          if (o) { moved.push(`${o.title} → ${r.dueOn}`); await event(tx, auth, o.id, 'reprogramada', `Reprogramada pelo fura-fila "${c.title}": novo prazo ${r.dueOn}`); }
        }
        await event(tx, auth, c.id, 'fura_fila', `${body.approve ? 'Fura-fila aprovado' : 'Fura-fila recusado'}${body.note ? `: ${body.note}` : ''}${moved.length ? ` · reprogramadas: ${moved.join('; ')}` : ''}`);
        await notifyCard(tx, auth, c, 'mkt_fura_fila', `Fura-fila ${body.approve ? 'aprovado' : 'recusado'}: ${c.title}`);
      });
      await audit(app.db, req, { action: body.approve ? 'mkt.fura_fila.approve' : 'mkt.fura_fila.refuse', entityType: 'mkt_card', entityId: params.id, metadata: { note: body.note } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/marketing/quadro/cards/:id', summary: 'Arquiva a tarefa (responsável, criador ou liderança)', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadCard(app.db, auth, params.id);
      if (!canEditCard(auth, c)) throw forbidden('Só o responsável, quem criou ou a liderança arquivam.');
      await app.db.update(s.mktCards).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(s.mktCards.id, c.id));
      await event(app.db, auth, c.id, 'arquivada', null);
      return { ok: true };
    },
  }),

  // ---------------------------------------------------------------- relacionados e etiquetas
  defineRoute({
    method: 'GET', url: '/marketing/quadro/relacionaveis', summary: 'Busca oportunidades, contas, leads, campanhas, contratos e tarefas para relacionar', ...M,
    query: z.object({ q: z.string().trim().min(2).max(80) }),
    handler: async ({ app, auth, query }) => ({ items: await searchLinkables(app.db, auth, query.q) }),
  }),
  defineRoute({
    method: 'POST', url: '/marketing/quadro/links', summary: 'Relaciona uma atividade da ferramenta a uma etiqueta ou a um cartão', ...M,
    body: z.object({ tagId: uuid.nullable().default(null), cardId: uuid.nullable().default(null), entityType: z.enum(MKT_LINK_TYPES), entityId: uuid }),
    handler: async ({ app, auth, body, reply }) => {
      if (!!body.tagId === !!body.cardId) throw unprocessable('Relacione a uma etiqueta ou a um cartão.');
      if (body.cardId) await loadCard(app.db, auth, body.cardId);
      if (body.tagId) { const [t] = await app.db.select().from(s.mktTags).where(and(eq(s.mktTags.id, body.tagId), eq(s.mktTags.tenantId, auth.tenantId))); if (!t) throw notFound('Etiqueta não encontrada.'); }
      const label = await linkLabel(app.db, auth.tenantId, body.entityType, body.entityId);
      if (!label) throw unprocessable('Item não encontrado.');
      await app.db.insert(s.mktLinks).values({ tenantId: auth.tenantId, tagId: body.tagId, cardId: body.cardId, entityType: body.entityType, entityId: body.entityId, label: label.slice(0, 200), createdBy: auth.userId }).onConflictDoNothing();
      if (body.cardId) await event(app.db, auth, body.cardId, 'relacionado', label);
      reply.code(201);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/marketing/quadro/links/:id', summary: 'Desfaz a relação', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      await app.db.delete(s.mktLinks).where(and(eq(s.mktLinks.id, params.id), eq(s.mktLinks.tenantId, auth.tenantId)));
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/marketing/quadro/tags', summary: 'Etiquetas com o que está relacionado a cada uma (cartões e atividades da ferramenta)', ...M,
    handler: async ({ app, auth }) => {
      const tags = await app.db.select().from(s.mktTags).where(eq(s.mktTags.tenantId, auth.tenantId)).orderBy(asc(s.mktTags.name));
      const ids = tags.map((t) => t.id);
      const [links, cards] = await Promise.all([
        ids.length ? app.db.select().from(s.mktLinks).where(inArray(s.mktLinks.tagId, ids)) : Promise.resolve([]),
        ids.length ? app.db.select({ tagId: s.mktCardTags.tagId, id: s.mktCards.id, code: s.mktCards.code, title: s.mktCards.title, column: s.mktCards.column }).from(s.mktCardTags).innerJoin(s.mktCards, eq(s.mktCards.id, s.mktCardTags.cardId)).where(and(inArray(s.mktCardTags.tagId, ids), isNull(s.mktCards.archivedAt))) : Promise.resolve([]),
      ]);
      return { items: tags.map((t) => ({ ...t, links: links.filter((l) => l.tagId === t.id).map((l) => ({ id: l.id, entityType: l.entityType, entityId: l.entityId, label: l.label, url: linkUrl(l.entityType, l.entityId) })), cards: cards.filter((c) => c.tagId === t.id) })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/marketing/quadro/tags', summary: 'Cria etiqueta (ex.: nome de campanha ou ação)', ...M,
    body: z.object({ name: z.string().trim().min(2).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2F5986') }),
    handler: async ({ app, auth, body, reply }) => {
      const [dup] = await app.db.select({ id: s.mktTags.id }).from(s.mktTags).where(and(eq(s.mktTags.tenantId, auth.tenantId), sql`lower(${s.mktTags.name}) = lower(${body.name})`));
      if (dup) throw unprocessable('Já existe uma etiqueta com este nome.', [{ path: 'name', message: 'Nome em uso' }]);
      const [t] = await app.db.insert(s.mktTags).values({ tenantId: auth.tenantId, name: body.name, color: body.color, createdBy: auth.userId }).returning();
      reply.code(201);
      return t;
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/marketing/quadro/tags/:id', summary: 'Exclui a etiqueta (sai dos cartões; as atividades relacionadas não mudam)', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      await app.db.delete(s.mktTags).where(and(eq(s.mktTags.id, params.id), eq(s.mktTags.tenantId, auth.tenantId)));
      return { ok: true };
    },
  }),

  // ---------------------------------------------------------------- orçamento e brindes para o cartão
  defineRoute({
    method: 'GET', url: '/marketing/quadro/recursos', summary: 'Centros de custo e itens aprovados do orçamento que a pessoa usa, e o catálogo de brindes', ...M,
    handler: async ({ app, auth }) => {
      const ccs = auth.modules.orcamento ? await costCentersOf(app.db, auth).catch(() => []) : [];
      const lines = ccs.length ? await app.db.select({ id: s.budgetLines.id, costCenterId: s.budgetLines.costCenterId, what: s.budgetLines.what, month: s.budgetLines.month, amountCents: s.budgetLines.amountCents, status: s.budgetLines.status })
        .from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, auth.tenantId), inArray(s.budgetLines.costCenterId, ccs.map((c) => c.id)), eq(s.budgetLines.status, 'aprovado'))).orderBy(desc(s.budgetLines.month)).limit(200) : [];
      const gifts = await app.db.select({ id: s.giftItems.id, name: s.giftItems.name, unitCostCents: s.giftItems.unitCostCents }).from(s.giftItems).where(eq(s.giftItems.tenantId, auth.tenantId)).orderBy(asc(s.giftItems.name));
      return { costCenters: ccs.map((c) => ({ id: c.id, code: c.code, name: c.name })), lines, gifts };
    },
  }),

  // ---------------------------------------------------------------- Sprint
  defineRoute({
    method: 'POST', url: '/marketing/quadro/sprints', summary: 'Planeja a próxima Sprint (15 dias)', ...M,
    body: z.object({ name: z.string().trim().max(80).nullable().default(null), startOn: z.string().date(), objective: z.string().trim().max(500).nullable().default(null) }),
    handler: async ({ app, auth, body, reply }) => {
      if (!isLead(auth)) throw forbidden('A Sprint é planejada pela liderança de Marketing.');
      const endOn = addDaysIso(body.startOn, MKT_SPRINT_DAYS - 1);
      const [sp] = await app.db.insert(s.mktSprints).values({ tenantId: auth.tenantId, name: body.name || `Sprint ${body.startOn.split('-').reverse().slice(0, 2).join('/')} a ${endOn.split('-').reverse().slice(0, 2).join('/')}`, startOn: body.startOn, endOn, objective: body.objective, createdBy: auth.userId }).returning();
      reply.code(201);
      return sp;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/marketing/quadro/sprints/:id', summary: 'Objetivo e destaques da Sprint', ...M, params: IdParams,
    body: z.object({ objective: z.string().trim().max(500).nullable().optional(), highlights: z.string().trim().max(3000).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => {
      if (!isLead(auth)) throw forbidden('Só a liderança de Marketing altera a Sprint.');
      const [sp] = await app.db.update(s.mktSprints).set(body).where(and(eq(s.mktSprints.id, params.id), eq(s.mktSprints.tenantId, auth.tenantId))).returning();
      if (!sp) throw notFound('Sprint não encontrada.');
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/marketing/quadro/sprints/:id/abrir', summary: 'Abre a Sprint (escopo congelado: novas demandas só por fura-fila) e devolve a comunicação oficial de abertura', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      if (!isLead(auth)) throw forbidden('A Sprint é aberta pela liderança de Marketing.');
      const [sp] = await app.db.select().from(s.mktSprints).where(and(eq(s.mktSprints.id, params.id), eq(s.mktSprints.tenantId, auth.tenantId)));
      if (!sp) throw notFound('Sprint não encontrada.');
      if (sp.status !== 'planejamento') throw unprocessable('Esta Sprint já foi aberta.');
      const [open] = await app.db.select({ id: s.mktSprints.id }).from(s.mktSprints).where(and(eq(s.mktSprints.tenantId, auth.tenantId), eq(s.mktSprints.status, 'aberta')));
      if (open) throw unprocessable('Encerre a Sprint em andamento antes de abrir outra.');
      const cards = await app.db.select().from(s.mktCards).where(and(eq(s.mktCards.sprintId, sp.id), isNull(s.mktCards.archivedAt)));
      if (!cards.length) throw unprocessable('Coloque na Sprint as tarefas que serão entregues antes de abrir.');
      const noOwnerDue = cards.filter((c) => !c.dueOn);
      if (noOwnerDue.length) throw unprocessable(`Defina o prazo de todas as tarefas da Sprint (faltam ${noOwnerDue.length}).`);
      await app.db.update(s.mktSprints).set({ status: 'aberta', openedAt: new Date(), openedBy: auth.userId }).where(eq(s.mktSprints.id, sp.id));
      return { ok: true, email: sprintEmail('abertura', sp, cards, auth.name) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/marketing/quadro/sprints/:id/encerrar', summary: 'Encerra a Sprint: pendentes voltam para A fazer sem Sprint; devolve a comunicação de encerramento', ...M, params: IdParams,
    body: z.object({ highlights: z.string().trim().max(3000).nullable().default(null) }),
    handler: async ({ app, auth, params, body }) => {
      if (!isLead(auth)) throw forbidden('A Sprint é encerrada pela liderança de Marketing.');
      const [sp] = await app.db.select().from(s.mktSprints).where(and(eq(s.mktSprints.id, params.id), eq(s.mktSprints.tenantId, auth.tenantId)));
      if (!sp) throw notFound('Sprint não encontrada.');
      if (sp.status !== 'aberta') throw unprocessable('Só uma Sprint aberta pode ser encerrada.');
      const cards = await app.db.select().from(s.mktCards).where(and(eq(s.mktCards.sprintId, sp.id), isNull(s.mktCards.archivedAt)));
      const email = sprintEmail('encerramento', { ...sp, highlights: body.highlights ?? sp.highlights }, cards, auth.name);
      await app.db.transaction(async (tx) => {
        await tx.update(s.mktSprints).set({ status: 'encerrada', closedAt: new Date(), closedBy: auth.userId, highlights: body.highlights ?? sp.highlights }).where(eq(s.mktSprints.id, sp.id));
        for (const c of cards.filter((x) => x.column !== 'concluido')) {
          await tx.update(s.mktCards).set({ sprintId: null, column: c.column === 'em_execucao' || c.column === 'revisao' ? c.column : 'a_fazer', updatedAt: new Date(), rowVersion: c.rowVersion + 1 }).where(eq(s.mktCards.id, c.id));
          await event(tx, auth, c.id, 'reprogramada', `Não concluída na ${sp.name}: segue para a próxima Sprint.`);
        }
      });
      return { ok: true, email };
    },
  }),
  defineRoute({
    method: 'POST', url: '/marketing/quadro/sprints/:id/comunicar', summary: 'Envia a comunicação oficial da Sprint por e-mail (SMTP da empresa)', ...M, params: IdParams,
    body: z.object({ to: z.array(z.string().email()).min(1).max(30), subject: z.string().trim().min(3).max(200), text: z.string().trim().min(10).max(20_000) }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!isLead(auth)) throw forbidden('A comunicação oficial é enviada pela liderança de Marketing.');
      const [sp] = await app.db.select({ id: s.mktSprints.id }).from(s.mktSprints).where(and(eq(s.mktSprints.id, params.id), eq(s.mktSprints.tenantId, auth.tenantId)));
      if (!sp) throw notFound('Sprint não encontrada.');
      const r = await sendEmail(app.db, { tenantId: auth.tenantId, kind: 'mkt_sprint', to: body.to.join(', '), subject: body.subject, text: body.text });
      await audit(app.db, req, { action: 'mkt.sprint.email', entityType: 'mkt_sprint', entityId: sp.id, metadata: { to: body.to, ok: r.ok } });
      if (!r.ok) throw unprocessable('notConfigured' in r && r.notConfigured ? 'E-mail da empresa (SMTP) não configurado: copie o texto e envie pelo seu e-mail.' : `Falha no envio: ${'error' in r ? r.error : ''}`);
      return { ok: true };
    },
  }),
];
