/**
 * Revisões e remanejamentos do orçamento aprovado (prompt master, item 18) e projeção até o fim do exercício (item 19).
 * - Remanejamento move saldo livre (aprovado − consumo) de um lançamento para outro: a soma é zero, não cria dinheiro.
 *   No mesmo centro decide a Gerência (ou a Diretoria); entre centros, só a Diretoria.
 * - Revisão muda o aprovado de lançamentos (reduzir até o já consumido; aumentar só com a Diretoria).
 * - Cada pedido vira uma versão numerada no ano, com valores antes e depois; quem pede não decide. O original fica no lançamento.
 * - Projeção: realizado nos meses passados, aprovado ou consumido nos futuros, compromissos a vencer, recorrentes e contratos ainda não planejados.
 */
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isApproved, resourceMonths, type ApprovalState } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import { brl } from '../services/email';
import { decidesStages } from '../services/budget';
import { assertOpenPeriod, deciders, notifyBudget } from '../services/budgetClosing';
import { todayIn } from '../services/vacations';
import { loadLine, logLine, visibleCostCenters } from './budgetCentral';

const M = { module: 'orcamento' as const, tag: 'Orçamento' };
const cents = z.number().int().positive().max(100_000_000_000);

/** Consumo do lançamento (maior entre contratado e realizado). */
async function consumptionOf(db: DbOrTx, lineId: string, contracted: number | null) {
  const [{ v }] = await db.select({ v: sql<number>`coalesce(sum(${s.budgetExpenses.amountCents}), 0)::bigint` }).from(s.budgetExpenses).where(and(eq(s.budgetExpenses.lineId, lineId), eq(s.budgetExpenses.status, 'valido'))) as [{ v: number }];
  return Math.max(Number(contracted ?? 0), Number(v));
}

type Item = { lineId: string; code: string | null; costCenterId: string; accountId: string; beforeCents: number; afterCents: number };
/** Confere os itens contra o estado atual (dentro da transação, com as linhas travadas). */
async function validateItems(tx: DbOrTx, auth: AuthContext, kind: 'revisao' | 'remanejamento', changes: { lineId: string; delta: number }[]) {
  const items: Item[] = [];
  for (const c of changes) {
    const { l, access } = await loadLine(tx, auth, c.lineId, true);
    if (!access.plan) throw forbidden(`Só o Dono do orçamento do centro de ${l.code} pede revisão ou remanejamento.`);
    if (!isApproved(l.approvalState as ApprovalState)) throw unprocessable(`${l.code} ainda não está aprovado.`);
    await assertOpenPeriod(tx, auth.tenantId, l.month);
    const before = l.approvedCents ?? 0, after = before + c.delta;
    const used = await consumptionOf(tx, l.id, l.contractedCents);
    if (after < used) throw unprocessable(`${l.code}: o aprovado não pode ficar abaixo do já consumido (${brl(used)}). Saldo livre: ${brl(Math.max(0, before - used))}.`);
    if (after <= 0) throw unprocessable(`${l.code}: o aprovado precisa continuar maior que zero (para zerar, encerre o lançamento).`);
    items.push({ lineId: l.id, code: l.code, costCenterId: l.costCenterId, accountId: l.accountId, beforeCents: before, afterCents: after });
  }
  if (kind === 'remanejamento' && items.reduce((t, i) => t + i.afterCents - i.beforeCents, 0) !== 0) throw unprocessable('No remanejamento, o que sai de um lançamento entra no outro: a soma precisa ser zero.');
  return items;
}
const needsDirector = (kind: string, items: Item[]) => kind === 'revisao' ? items.some((i) => i.afterCents > i.beforeCents) : new Set(items.map((i) => i.costCenterId)).size > 1;

export const budgetRevisionRoutes = [
  defineRoute({
    method: 'GET', url: '/budget/revisions', summary: 'Revisões e remanejamentos do ano: versão, justificativa, valores antes e depois, centros e contas afetados, situação e quem decidiu', ...M,
    query: z.object({ year: z.coerce.number().int().min(2020).max(2100) }),
    handler: async ({ app, auth, query }) => {
      const ccs = new Set((await visibleCostCenters(app.db, auth)).map((c) => c.id));
      const rows = await app.db.select({ r: s.budgetRevisions, by: s.users.name }).from(s.budgetRevisions).leftJoin(s.users, eq(s.users.id, s.budgetRevisions.requestedBy)).where(and(eq(s.budgetRevisions.tenantId, auth.tenantId), eq(s.budgetRevisions.year, query.year))).orderBy(desc(s.budgetRevisions.version));
      const deciders = rows.filter((x) => x.r.decidedBy).map((x) => x.r.decidedBy!);
      const names = deciders.length ? await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, deciders)) : [];
      return {
        items: rows.filter(({ r }) => r.items.some((i) => ccs.has(i.costCenterId))).map(({ r, by }) => ({ ...r, requestedByName: by, decidedByName: names.find((n) => n.id === r.decidedBy)?.name ?? null, needsDirector: needsDirector(r.kind, r.items), canDecide: r.status === 'pendente' && r.requestedBy !== auth.userId && (needsDirector(r.kind, r.items) ? decidesStages(auth).includes('diretoria') : decidesStages(auth).length > 0) })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/revisions', summary: 'Pede revisão (novos valores aprovados) ou remanejamento (de um lançamento para outro, soma zero) com justificativa; vira uma versão do ano', ...M,
    body: z.object({
      kind: z.enum(['revisao', 'remanejamento']), justification: z.string().trim().min(10).max(2000),
      changes: z.array(z.object({ lineId: z.string().uuid(), newApprovedCents: cents })).max(100).default([]),
      moves: z.array(z.object({ fromLineId: z.string().uuid(), toLineId: z.string().uuid(), cents })).max(50).default([]),
    }),
    handler: async ({ app, auth, body, reply }) => {
      const r = await app.db.transaction(async (tx) => {
        let changes: { lineId: string; delta: number }[];
        if (body.kind === 'remanejamento') {
          if (!body.moves.length) throw unprocessable('Informe de onde sai e para onde vai o valor.');
          if (body.moves.some((m) => m.fromLineId === m.toLineId)) throw unprocessable('Origem e destino precisam ser lançamentos diferentes.');
          const acc = new Map<string, number>();
          for (const m of body.moves) { acc.set(m.fromLineId, (acc.get(m.fromLineId) ?? 0) - m.cents); acc.set(m.toLineId, (acc.get(m.toLineId) ?? 0) + m.cents); }
          changes = [...acc.entries()].map(([lineId, delta]) => ({ lineId, delta }));
        } else {
          if (!body.changes.length) throw unprocessable('Informe os novos valores.');
          changes = [];
          for (const c of body.changes) { const { l } = await loadLine(tx, auth, c.lineId); changes.push({ lineId: c.lineId, delta: c.newApprovedCents - (l.approvedCents ?? 0) }); }
          if (changes.every((c) => c.delta === 0)) throw unprocessable('Nenhum valor mudou.');
        }
        const items = await validateItems(tx, auth, body.kind, changes);
        const year = Number((await tx.select({ m: s.budgetLines.month }).from(s.budgetLines).where(eq(s.budgetLines.id, items[0]!.lineId)))[0]!.m.slice(0, 4));
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`budget-rev:${auth.tenantId}:${year}`}))`);
        const [{ v }] = await tx.select({ v: sql<number>`coalesce(max(${s.budgetRevisions.version}), 0) + 1` }).from(s.budgetRevisions).where(and(eq(s.budgetRevisions.tenantId, auth.tenantId), eq(s.budgetRevisions.year, year))) as [{ v: number }];
        const [rev] = await tx.insert(s.budgetRevisions).values({ tenantId: auth.tenantId, year, version: Number(v), kind: body.kind, justification: body.justification, items, requestedBy: auth.userId }).returning();
        for (const i of items) await logLine(tx, auth, { id: i.lineId, costCenterId: i.costCenterId, code: i.code }, `${body.kind}_pedido`, `${body.kind === 'remanejamento' ? 'remanejamento' : 'revisão'} v${v} pedida: ${brl(i.beforeCents)} → ${brl(i.afterCents)}. ${body.justification}`, { revisionId: rev!.id, before: i.beforeCents, after: i.afterCents });
        const dir = needsDirector(body.kind, items);
        await notifyBudget(tx, auth.tenantId, await deciders(tx, auth.tenantId, dir ? 'diretoria' : 'gerencia'), { event: 'revisao_pedida', title: `${body.kind === 'remanejamento' ? 'Remanejamento' : 'Revisão'} do orçamento v${v} aguardando decisão`, body: body.justification, link: '/orcamento?t=revisoes', key: `rev:${rev!.id}`, actorId: auth.userId });
        return rev!;
      });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/revisions/:id/decide', summary: 'Decide a revisão ou o remanejamento: aprovar aplica os novos valores (conferindo de novo o saldo) ou recusar com motivo; quem pediu não decide', ...M, params: IdParams,
    body: z.object({ decision: z.enum(['aprovar', 'recusar']), note: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [r] = await tx.select().from(s.budgetRevisions).where(and(eq(s.budgetRevisions.id, params.id), eq(s.budgetRevisions.tenantId, auth.tenantId))).for('update').limit(1);
      if (!r) throw notFound();
      if (r.status !== 'pendente') throw unprocessable('Já decidido.');
      if (r.requestedBy === auth.userId) throw forbidden('Quem pediu não decide.');
      const dir = needsDirector(r.kind, r.items);
      if (dir ? !decidesStages(auth).includes('diretoria') : !decidesStages(auth).length) throw forbidden(dir ? (r.kind === 'remanejamento' ? 'Remanejamento entre centros de custo é decidido pela Diretoria.' : 'Aumento do aprovado é decidido pela Diretoria.') : 'Quem decide é a Gerência ou a Diretoria.');
      if (body.decision === 'recusar') {
        if (!body.note) throw unprocessable('Explique a recusa.', [{ path: 'note', message: 'Obrigatório' }]);
        await tx.update(s.budgetRevisions).set({ status: 'recusado', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note }).where(eq(s.budgetRevisions.id, r.id));
        await notifyBudget(tx, auth.tenantId, [r.requestedBy], { event: 'revisao_recusada', title: `Revisão v${r.version} recusada`, body: body.note, link: '/orcamento?t=revisoes', key: `rev-dec:${r.id}`, actorId: auth.userId });
        return { status: 'recusado' };
      }
      // confere de novo com as linhas travadas (o saldo pode ter mudado desde o pedido)
      for (const i of r.items) {
        const [l] = await tx.select().from(s.budgetLines).where(eq(s.budgetLines.id, i.lineId)).for('update').limit(1);
        if (!l || (l.approvedCents ?? 0) !== i.beforeCents) throw unprocessable(`${i.code}: o aprovado mudou desde o pedido (${brl(l?.approvedCents ?? 0)}). Recuse e peça de novo.`);
        await assertOpenPeriod(tx, auth.tenantId, l.month);
        const used = await consumptionOf(tx, l.id, l.contractedCents);
        if (i.afterCents < used) throw unprocessable(`${i.code}: o consumo já passou do novo valor (${brl(used)}).`);
        const delta = i.afterCents - i.beforeCents;
        const limit = l.limitCents === null ? null : delta > 0 ? l.limitCents + delta : Math.min(l.limitCents, i.afterCents);
        await tx.update(s.budgetLines).set({ approvedCents: i.afterCents, limitCents: limit, updatedAt: new Date(), rowVersion: l.rowVersion + 1 }).where(eq(s.budgetLines.id, l.id));
        await logLine(tx, auth, l, r.kind === 'remanejamento' ? 'remanejado' : 'revisado', `${r.kind === 'remanejamento' ? 'remanejamento' : 'revisão'} v${r.version} aprovada: ${brl(i.beforeCents)} → ${brl(i.afterCents)}${body.note ? `. ${body.note}` : ''}.`, { revisionId: r.id, before: { approvedCents: i.beforeCents, limitCents: l.limitCents }, after: { approvedCents: i.afterCents, limitCents: limit } });
      }
      await tx.update(s.budgetRevisions).set({ status: 'aprovado', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note ?? null }).where(eq(s.budgetRevisions.id, r.id));
      await notifyBudget(tx, auth.tenantId, [r.requestedBy], { event: 'revisao_aprovada', title: `Revisão v${r.version} aprovada`, link: '/orcamento?t=revisoes', key: `rev-dec:${r.id}`, actorId: auth.userId });
      return { status: 'aprovado' };
    }),
  }),

  // ------------------------------------------------------------------ projeção (item 19)
  defineRoute({
    method: 'GET', url: '/budget/projection', summary: 'Projeção até o fim do exercício: realizado nos meses passados, aprovado ou consumido nos futuros, compromissos a vencer, recorrentes e contratos ainda não planejados; risco de excedente', ...M,
    query: z.object({ year: z.coerce.number().int().min(2020).max(2100), costCenterId: z.string().uuid().optional() }),
    handler: async ({ app, auth, query }) => {
      const today = todayIn(auth.timezone ?? 'America/Sao_Paulo'), cur = today.slice(0, 7);
      const ccs = (await visibleCostCenters(app.db, auth)).filter((c) => !query.costCenterId || c.id === query.costCenterId);
      const ids = ccs.map((c) => c.id);
      const months = Array.from({ length: 12 }, (_, i) => `${query.year}-${String(i + 1).padStart(2, '0')}`);
      if (!ids.length) return { months: months.map((m) => ({ month: m, approved: 0, realized: 0, committed: 0, projected: 0, unplanned: 0, future: m > cur })), totals: { approved: 0, realized: 0, projected: 0, futureCommitments: 0, recurringFuture: 0, unplannedRecurring: 0, risk: 0 } };
      const lines = await app.db.select().from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, auth.tenantId), inArray(s.budgetLines.costCenterId, ids), isNull(s.budgetLines.deletedAt), sql`${s.budgetLines.month} like ${`${query.year}-%`}`));
      const exps = await app.db.select({ lineId: s.budgetExpenses.lineId, m: sql<string>`to_char(${s.budgetExpenses.occurredOn}, 'YYYY-MM')`, v: s.budgetExpenses.amountCents }).from(s.budgetExpenses)
        .where(and(eq(s.budgetExpenses.tenantId, auth.tenantId), inArray(s.budgetExpenses.costCenterId, ids), eq(s.budgetExpenses.status, 'valido'), sql`extract(year from ${s.budgetExpenses.occurredOn}) = ${query.year}`));
      const adj = await app.db.select().from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.tenantId, auth.tenantId), inArray(s.budgetAdjustments.costCenterId, ids), eq(s.budgetAdjustments.year, query.year), eq(s.budgetAdjustments.kind, 'guardiao'), inArray(s.budgetAdjustments.status, ['aprovado', 'registrado'])));
      const futurePay = await app.db.select({ v: sql<number>`coalesce(sum(${s.budgetPayables.amountCents}), 0)::bigint` }).from(s.budgetPayables).where(and(eq(s.budgetPayables.tenantId, auth.tenantId), inArray(s.budgetPayables.costCenterId, ids), eq(s.budgetPayables.status, 'aberto'), gt(s.budgetPayables.dueOn, today)));
      const resources = await app.db.select().from(s.resourceContracts).where(and(eq(s.resourceContracts.tenantId, auth.tenantId), inArray(s.resourceContracts.costCenterId, ids), eq(s.resourceContracts.status, 'ativo'))).orderBy(asc(s.resourceContracts.name));
      const approvedL = lines.filter((l) => isApproved(l.approvalState as ApprovalState));
      const realizedOf = (lineId: string) => exps.filter((e) => e.lineId === lineId).reduce((t, e) => t + e.v, 0);
      const rows = months.map((m) => {
        const ls = approvedL.filter((l) => l.month === m);
        const approved = ls.reduce((t, l) => t + (l.approvedCents ?? 0), 0) + adj.filter((a) => a.month === m).reduce((t, a) => t + a.deltaCents, 0);
        const realized = exps.filter((e) => e.m === m).reduce((t, e) => t + e.v, 0);
        const committed = ls.reduce((t, l) => t + (l.contractedCents ?? 0), 0);
        // contratos e assinaturas ativos sem lançamento no mês: custo que vai acontecer e não está planejado
        const unplanned = m > cur ? resources.filter((r) => !lines.some((l) => l.resourceId === r.id && l.month === m)).reduce((t, r) => t + (resourceMonths({ amountCents: r.amountCents, currency: r.currency as 'BRL', fxRate: r.fxRate, period: r.period as 'mensal', startOn: r.startOn, endOn: r.endOn }, [m])[0]?.cents ?? 0), 0) : 0;
        const projected = m < cur ? realized : ls.reduce((t, l) => t + (l.executionState === 'encerrado' ? Math.max(l.contractedCents ?? 0, realizedOf(l.id)) : Math.max(l.approvedCents ?? 0, l.contractedCents ?? 0, realizedOf(l.id))), 0) + exps.filter((e) => e.m === m && !e.lineId).reduce((t, e) => t + e.v, 0) + unplanned;
        return { month: m, approved, realized, committed, projected, unplanned, future: m > cur };
      });
      const sum = (k: 'approved' | 'realized' | 'projected' | 'unplanned') => rows.reduce((t, r) => t + r[k], 0);
      const recurringFuture = approvedL.filter((l) => l.expenseType === 'recorrente' && l.month > cur).reduce((t, l) => t + (l.approvedCents ?? 0), 0);
      return {
        months: rows,
        totals: { approved: sum('approved'), realized: sum('realized'), projected: sum('projected'), futureCommitments: Number(futurePay[0]?.v ?? 0), recurringFuture, unplannedRecurring: sum('unplanned'), risk: Math.max(0, sum('projected') - sum('approved')) },
        notes: 'Projeção = realizado nos meses que já passaram; nos meses à frente, o maior entre aprovado, contratado e já realizado, mais contratos e assinaturas ativos ainda sem lançamento. Projeção não é obrigação: compromisso é o contratado, despesa é o realizado.',
      };
    },
  }),
];
