/**
 * Fechamento mensal do orçamento e distribuição do relatório por e-mail.
 * Estados: aberto → em conferência → aguardando validação → fechado; reaberto só pela Diretoria, com justificativa.
 * Quem envia para validação não valida. Fechado = fotografia gravada e período travado para alterações retroativas.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import type { Config } from '../config';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { sendEmail } from '../services/email';
import { publicLink } from '../services/alerts';
import { decidesStages, isBudgetAdmin, logBudget } from '../services/budget';
import { closingSnapshot, notifyBudget, reportRecipients, type ClosingSnapshot, type ClosingTotals } from '../services/budgetClosing';
import { budgetReportSubject, budgetReportText, renderBudgetReport } from '../services/budgetReport';
import { visibleCostCenters } from './budgetCentral';

const M = { module: 'orcamento' as const, tag: 'Orçamento' };
const MonthParams = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM') });
const STATUS_LABEL: Record<string, string> = { aberto: 'Aberto', em_conferencia: 'Em conferência', aguardando_validacao: 'Aguardando validação', fechado: 'Fechado', reaberto: 'Reaberto excepcionalmente' };
const TRANSITIONS: Record<string, string[]> = { aberto: ['em_conferencia'], reaberto: ['em_conferencia'], em_conferencia: ['aguardando_validacao', 'aberto'], aguardando_validacao: ['fechado', 'em_conferencia'], fechado: ['reaberto'] };
const isDirector = (auth: AuthContext) => auth.profiles.includes('diretoria') && decidesStages(auth).includes('diretoria');
const canConduct = (auth: AuthContext) => decidesStages(auth).length > 0 || auth.sectors.includes('financeiro');
const prevMonth = (m: string) => { const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 2; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };

async function closingRow(db: DbOrTx, tenantId: string, month: string, lock = false) {
  await db.insert(s.budgetClosings).values({ tenantId, month }).onConflictDoNothing();
  const q = db.select().from(s.budgetClosings).where(and(eq(s.budgetClosings.tenantId, tenantId), eq(s.budgetClosings.month, month))).limit(1);
  return (lock ? await q.for('update') : await q)[0]!;
}
/** Recorta a fotografia ao que a pessoa vê (centros do escopo) e recompõe os totais. */
function scoped(snap: ClosingSnapshot, ccIds: string[]): ClosingSnapshot {
  const centers = snap.centers.filter((c) => ccIds.includes(c.id));
  if (centers.length === snap.centers.length) return snap;
  const sums = Object.fromEntries(Object.keys(snap.total).filter((k) => k !== 'deviationPct').map((k) => [k, centers.reduce((t, c) => t + (Number((c as unknown as Record<string, number>)[k]) || 0), 0)])) as Omit<ClosingTotals, 'deviationPct'>;
  const total: ClosingTotals = { ...sums, deviationPct: sums.approved ? Math.round(((sums.realized - sums.approved) / sums.approved) * 1000) / 10 : null };
  return { ...snap, centers, total, performance: { wins: 0, resultCents: 0, efficiency: null } };
}

async function buildReports(db: DbOrTx, config: Config, tenantId: string, closing: typeof s.budgetClosings.$inferSelect, actorId: string | null, requireApproval: boolean) {
  const [tenant] = await db.select({ name: s.tenants.name }).from(s.tenants).where(eq(s.tenants.id, tenantId));
  const snap = closing.snapshot as ClosingSnapshot;
  const prev = await closingSnapshot(db, tenantId, prevMonth(closing.month));
  const months = Array.from({ length: 6 }, (_, i) => { let m = closing.month; for (let k = 0; k < 5 - i; k++) m = prevMonth(m); return m; });
  const recipients = await reportRecipients(db, tenantId);
  const out = [];
  for (const r of recipients) {
    const mine = scoped(snap, r.costCenterIds);
    if (!mine.centers.length) continue;
    const myPrev = scoped(prev, r.costCenterIds);
    const history = [];
    for (const m of months) { const h = m === closing.month ? mine : scoped(await closingSnapshot(db, tenantId, m, r.costCenterIds), r.costCenterIds); history.push({ month: m, realized: h.total.realized, approved: h.total.approved }); }
    const html = renderBudgetReport({ company: tenant?.name ?? 'Empresa', recipient: r, month: closing.month, generatedAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), link: publicLink(config, '/orcamento?t=central'), snap: mine, prev: myPrev, history });
    const [d] = await db.insert(s.budgetReportDispatches).values({ tenantId, closingId: closing.id, month: closing.month, userId: r.userId, email: r.email, role: r.role, costCenterIds: r.costCenterIds, subject: budgetReportSubject(closing.month), html, status: requireApproval ? 'aguardando_aprovacao' : 'aprovado', createdBy: actorId }).returning();
    out.push(d!);
  }
  return out;
}

async function sendDispatch(db: DbOrTx, tenantId: string, d: typeof s.budgetReportDispatches.$inferSelect, actorId: string | null) {
  const r = await sendEmail(db, { tenantId, kind: 'orcamento_relatorio', to: d.email, subject: d.subject, text: budgetReportText(d.html), html: d.html, createdBy: actorId });
  const ok = r.ok;
  await db.update(s.budgetReportDispatches).set({ status: ok ? 'enviado' : 'falhou', attempts: d.attempts + 1, lastError: ok ? null : r.error, sentAt: ok ? new Date() : d.sentAt, emailMessageId: r.id }).where(eq(s.budgetReportDispatches.id, d.id));
  if (ok) await notifyBudget(db, tenantId, [d.userId], { event: 'relatorio_enviado', title: `Relatório do orçamento de ${d.month.slice(5)}/${d.month.slice(0, 4)} enviado para o seu e-mail`, link: '/orcamento?t=central', key: `relatorio:${d.id}` });
  return ok;
}

/** Rotina diária: relatório automático dos meses fechados (com ou sem aprovação, conforme a política). */
export async function runBudgetReports(db: DbOrTx, config: Config, tenantId: string) {
  const [pol] = await db.select().from(s.budgetPolicies).where(eq(s.budgetPolicies.tenantId, tenantId)).limit(1);
  if (!pol?.reportAutoSend) return { prepared: 0, sent: 0 };
  const closed = await db.select().from(s.budgetClosings).where(and(eq(s.budgetClosings.tenantId, tenantId), eq(s.budgetClosings.status, 'fechado')));
  let prepared = 0, sent = 0;
  for (const c of closed) {
    const [any] = await db.select({ id: s.budgetReportDispatches.id }).from(s.budgetReportDispatches).where(eq(s.budgetReportDispatches.closingId, c.id)).limit(1);
    if (!any) prepared += (await buildReports(db, config, tenantId, c, null, pol.reportRequireApproval)).length;
    if (!pol.reportRequireApproval) {
      const ready = await db.select().from(s.budgetReportDispatches).where(and(eq(s.budgetReportDispatches.closingId, c.id), eq(s.budgetReportDispatches.status, 'aprovado')));
      for (const d of ready) if (await sendDispatch(db, tenantId, d, null)) sent++;
    }
  }
  return { prepared, sent };
}

export const budgetClosingRoutes = [
  defineRoute({
    method: 'GET', url: '/budget/closings', summary: 'Fechamentos do ano: situação de cada competência e o resumo gravado', ...M,
    query: z.object({ year: z.coerce.number().int().min(2020).max(2100) }),
    handler: async ({ app, auth, query }) => {
      const rows = await app.db.select().from(s.budgetClosings).where(and(eq(s.budgetClosings.tenantId, auth.tenantId), sql`${s.budgetClosings.month} like ${`${query.year}-%`}`));
      return {
        items: Array.from({ length: 12 }, (_, i) => { const m = `${query.year}-${String(i + 1).padStart(2, '0')}`; const r = rows.find((x) => x.month === m); return { month: m, status: r?.status ?? 'aberto', label: STATUS_LABEL[r?.status ?? 'aberto'], closedAt: r?.closedAt ?? null, reopenReason: r?.reopenReason ?? null }; }),
        can: { conduct: canConduct(auth), validate: isDirector(auth) },
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/budget/closings/:month', summary: 'Demonstrativo da competência (gravado se fechada; ao vivo se aberta), por centro e consolidado, com os disparos do relatório', ...M, params: MonthParams,
    handler: async ({ app, auth, params }) => {
      const c = await closingRow(app.db, auth.tenantId, params.month);
      const ccs = await visibleCostCenters(app.db, auth);
      const full = c.status === 'fechado' && c.snapshot ? (c.snapshot as ClosingSnapshot) : await closingSnapshot(app.db, auth.tenantId, params.month);
      const snap = isBudgetAdmin(auth) || isDirector(auth) ? full : scoped(full, ccs.map((x) => x.id));
      const dispatches = canConduct(auth) || isDirector(auth) ? await app.db.select({ id: s.budgetReportDispatches.id, email: s.budgetReportDispatches.email, role: s.budgetReportDispatches.role, status: s.budgetReportDispatches.status, attempts: s.budgetReportDispatches.attempts, lastError: s.budgetReportDispatches.lastError, sentAt: s.budgetReportDispatches.sentAt, createdAt: s.budgetReportDispatches.createdAt, name: s.users.name })
        .from(s.budgetReportDispatches).innerJoin(s.users, eq(s.users.id, s.budgetReportDispatches.userId)).where(eq(s.budgetReportDispatches.closingId, c.id)).orderBy(desc(s.budgetReportDispatches.createdAt)) : [];
      const events = await app.db.select({ summary: s.budgetEvents.summary, at: s.budgetEvents.createdAt, actor: s.users.name }).from(s.budgetEvents).leftJoin(s.users, eq(s.users.id, s.budgetEvents.actorId)).where(and(eq(s.budgetEvents.tenantId, auth.tenantId), eq(s.budgetEvents.entity, 'fechamento'), eq(s.budgetEvents.entityId, c.id))).orderBy(desc(s.budgetEvents.createdAt));
      return { closing: { ...c, snapshot: undefined, label: STATUS_LABEL[c.status], live: c.status !== 'fechado' }, snapshot: snap, dispatches, events, can: { conduct: canConduct(auth), validate: isDirector(auth) && c.submittedBy !== auth.userId, reopen: isDirector(auth), next: TRANSITIONS[c.status] ?? [] } };
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/closings/:month/transition', summary: 'Muda a situação do fechamento: conferência, validação, fechar (Diretoria, grava a fotografia e trava o período) ou reabrir excepcionalmente (Diretoria, com justificativa)', ...M, params: MonthParams,
    body: z.object({ to: z.enum(['aberto', 'em_conferencia', 'aguardando_validacao', 'fechado', 'reaberto']), reason: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const r = await app.db.transaction(async (tx) => {
        const c = await closingRow(tx, auth.tenantId, params.month, true);
        if (!(TRANSITIONS[c.status] ?? []).includes(body.to)) throw unprocessable(`De "${STATUS_LABEL[c.status]}" não dá para ir para "${STATUS_LABEL[body.to]}".`);
        if ((body.to === 'fechado' || body.to === 'reaberto') && !isDirector(auth)) throw forbidden('Fechar e reabrir a competência é da Diretoria.');
        if (body.to !== 'fechado' && body.to !== 'reaberto' && !canConduct(auth)) throw forbidden('Quem conduz o fechamento é a Gerência, a Diretoria ou o Financeiro.');
        if (body.to === 'fechado' && c.submittedBy === auth.userId) throw forbidden('Quem enviou para validação não valida o próprio fechamento.');
        if (body.to === 'reaberto' && (body.reason ?? '').length < 10) throw unprocessable('Explique a reabertura (mínimo de 10 caracteres).', [{ path: 'reason', message: 'Obrigatória' }]);
        const set: Partial<typeof s.budgetClosings.$inferInsert> = { status: body.to, updatedAt: new Date(), rowVersion: c.rowVersion + 1 };
        if (body.to === 'aguardando_validacao') Object.assign(set, { submittedBy: auth.userId, submittedAt: new Date() });
        if (body.to === 'fechado') Object.assign(set, { closedBy: auth.userId, closedAt: new Date(), snapshot: await closingSnapshot(tx, auth.tenantId, params.month) });
        if (body.to === 'reaberto') Object.assign(set, { reopenedBy: auth.userId, reopenedAt: new Date(), reopenReason: body.reason });
        await tx.update(s.budgetClosings).set(set).where(eq(s.budgetClosings.id, c.id));
        await tx.insert(s.budgetEvents).values({ tenantId: auth.tenantId, entity: 'fechamento', entityId: c.id, action: body.to, summary: `Competência ${params.month}: ${STATUS_LABEL[c.status]} → ${STATUS_LABEL[body.to]}${body.reason ? `. ${body.reason}` : ''}.`, data: { from: c.status, to: body.to, reason: body.reason ?? null }, actorId: auth.userId });
        if (body.to === 'aguardando_validacao') {
          const dirs = await tx.select({ id: s.users.id }).from(s.users).innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.roles.key, 'diretoria'), eq(s.users.active, true)));
          await notifyBudget(tx, auth.tenantId, dirs.map((d) => d.id), { event: 'fechamento_validacao', title: `Fechamento de ${params.month} aguardando a sua validação`, link: '/orcamento?t=fechamento', key: `fech:${c.id}:validar:${c.rowVersion}`, actorId: auth.userId });
        }
        if (body.to === 'fechado') {
          const ccs = await tx.select().from(s.costCenters).where(and(eq(s.costCenters.tenantId, auth.tenantId), eq(s.costCenters.active, true)));
          const people = ccs.flatMap((x) => [...x.ownerIds, ...x.executorIds, x.leaderId, x.managerId, x.directorId]);
          await notifyBudget(tx, auth.tenantId, people, { event: 'fechamento_disponivel', title: `Fechamento orçamentário de ${params.month} disponível`, link: '/orcamento?t=fechamento', key: `fech:${c.id}:fechado:${c.rowVersion}`, actorId: auth.userId });
        }
        return { status: body.to };
      });
      await audit(app.db, req, { action: `budget.closing.${body.to}`, entityType: 'budget_closing', entityId: params.month, metadata: r });
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/closings/:month/reports/prepare', summary: 'Prepara o relatório mensal por destinatário (responsável, gestor, Diretoria, Financeiro), cada um só com os centros que pode ver', ...M, params: MonthParams,
    body: z.object({ regenerate: z.boolean().default(false) }).default({}),
    handler: async ({ app, auth, params, body }) => {
      if (!canConduct(auth) && !isDirector(auth)) throw forbidden('Quem prepara o relatório é a Gerência, a Diretoria ou o Financeiro.');
      return app.db.transaction(async (tx) => {
        const c = await closingRow(tx, auth.tenantId, params.month, true);
        if (c.status !== 'fechado' || !c.snapshot) throw unprocessable('O relatório sai depois do fechamento da competência.');
        const existing = await tx.select().from(s.budgetReportDispatches).where(and(eq(s.budgetReportDispatches.closingId, c.id), inArray(s.budgetReportDispatches.status, ['aguardando_aprovacao', 'aprovado', 'falhou', 'enviado'])));
        if (existing.length && !body.regenerate) return { created: 0, existing: existing.length };
        if (body.regenerate) await tx.update(s.budgetReportDispatches).set({ status: 'cancelado' }).where(and(eq(s.budgetReportDispatches.closingId, c.id), inArray(s.budgetReportDispatches.status, ['aguardando_aprovacao', 'aprovado', 'falhou'])));
        const [pol] = await tx.select().from(s.budgetPolicies).where(eq(s.budgetPolicies.tenantId, auth.tenantId)).limit(1);
        const out = await buildReports(tx, app.config, auth.tenantId, c, auth.userId, pol?.reportRequireApproval ?? true);
        await logBudget(tx, auth, null, 'fechamento', c.id, 'relatorio', `Relatório de ${params.month} preparado para ${out.length} destinatário(s).`);
        return { created: out.length, existing: existing.length };
      });
    },
  }),
  defineRoute({
    method: 'GET', url: '/budget/reports/:id/preview', summary: 'Pré-visualização do relatório de um destinatário (HTML)', ...M, params: z.object({ id: z.string().uuid() }),
    handler: async ({ app, auth, params, reply }) => {
      const [d] = await app.db.select().from(s.budgetReportDispatches).where(and(eq(s.budgetReportDispatches.id, params.id), eq(s.budgetReportDispatches.tenantId, auth.tenantId))).limit(1);
      if (!d) throw notFound();
      if (d.userId !== auth.userId && !canConduct(auth) && !isDirector(auth)) throw forbidden();
      reply.header('content-type', 'text/html; charset=utf-8').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      return reply.send(d.html);
    },
  }),
  defineRoute({
    method: 'POST', url: '/budget/closings/:month/reports/send', summary: 'Aprova e envia o relatório (todos os pendentes ou os escolhidos); falhas ficam registradas para reenviar', ...M, params: MonthParams,
    body: z.object({ ids: z.array(z.string().uuid()).max(500).optional() }).default({}),
    handler: async ({ app, auth, params, body, req }) => {
      if (!isDirector(auth) && !decidesStages(auth).includes('gerencia')) throw forbidden('Quem aprova o envio do relatório é a Gerência ou a Diretoria.');
      const c = await closingRow(app.db, auth.tenantId, params.month);
      const list = await app.db.select().from(s.budgetReportDispatches).where(and(eq(s.budgetReportDispatches.closingId, c.id), inArray(s.budgetReportDispatches.status, ['aguardando_aprovacao', 'aprovado', 'falhou']), body.ids ? inArray(s.budgetReportDispatches.id, body.ids) : sql`true`));
      let sent = 0, failed = 0;
      for (const d of list) {
        // trava a linha: dois cliques simultâneos não mandam o mesmo e-mail duas vezes
        const [locked] = await app.db.update(s.budgetReportDispatches).set({ status: 'aprovado', approvedBy: d.approvedBy ?? auth.userId, approvedAt: d.approvedAt ?? new Date() }).where(and(eq(s.budgetReportDispatches.id, d.id), inArray(s.budgetReportDispatches.status, ['aguardando_aprovacao', 'aprovado', 'falhou']), eq(s.budgetReportDispatches.attempts, d.attempts))).returning();
        if (!locked) continue;
        if (await sendDispatch(app.db, auth.tenantId, { ...locked, attempts: d.attempts }, auth.userId)) sent++; else failed++;
      }
      await audit(app.db, req, { action: 'budget.report.send', entityType: 'budget_closing', entityId: params.month, metadata: { sent, failed } });
      return { sent, failed };
    },
  }),
];
