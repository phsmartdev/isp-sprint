/**
 * ABM Fase 6 — acompanhamento: central de sinais (com estados), cadências de contato (geram tarefas) e o histórico
 * único de interações da conta (atividades concluídas, e-mails, pesquisas e visitas), com registro rápido.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CADENCE_TYPES, SIGNAL_SEVERITIES, SUPPRESS_DAYS, cadenceErrors, nextCadence, signalTransition, type SignalStatus } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { assertAssignableUser, ownerScope } from '../services/scope';
import { dueAtOf } from '../services/projects';
import { taskEvent } from '../services/tasks';
import { ensureFreshAbm, generateAbmCadences, syncAbmSignals } from '../services/abmFollowup';
import { assertAccount } from './stakeholders';

const vis = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.abmAccounts.tenantId, ownerId: s.abmAccounts.ownerId });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const todayOf = (auth: AuthContext) => new Intl.DateTimeFormat('en-CA', { timeZone: auth.timezone }).format(new Date());
async function abmOf(db: DbOrTx, auth: AuthContext, contactId: string) {
  await assertAccount(db, auth, contactId);
  const [a] = await db.select().from(s.abmAccounts).where(and(eq(s.abmAccounts.contactId, contactId), eq(s.abmAccounts.tenantId, auth.tenantId))).limit(1);
  if (!a) throw unprocessable('A conta precisa estar no ABM.');
  return a;
}
async function loadSignal(db: DbOrTx, auth: AuthContext, id: string) {
  const [x] = await db.select().from(s.abmSignals).where(and(eq(s.abmSignals.id, id), eq(s.abmSignals.tenantId, auth.tenantId))).limit(1).for('update');
  if (!x) throw notFound('Sinal não encontrado.');
  await assertAccount(db, auth, x.contactId);
  return x;
}

export const abmFollowupRoutes = [
  // ------------------------------------------------------------ central de sinais
  defineRoute({
    method: 'GET', url: '/abm/signals', summary: 'Central de sinais das contas do ABM visíveis (abertos por padrão), com contagens', tag: 'Marketing', module: 'clientes',
    query: z.object({ status: z.enum(['abertos', 'encerrados']).default('abertos'), severity: z.enum(SIGNAL_SEVERITIES).optional(), owner: z.string().uuid().optional(), contactId: z.string().uuid().optional(), mine: z.enum(['0', '1']).default('0') }),
    handler: async ({ app, auth, query: q }) => {
      if (q.contactId) { await assertAccount(app.db, auth, q.contactId); await syncAbmSignals(app.db, auth.tenantId, todayOf(auth), q.contactId); } else await ensureFreshAbm(app.db, auth.tenantId, todayOf(auth), auth.timezone);
      const rows = await app.db.select({ x: s.abmSignals, account: s.contacts.name, owner: s.users.name, abmPriority: s.abmAccounts.priority })
        .from(s.abmSignals).innerJoin(s.abmAccounts, eq(s.abmAccounts.id, s.abmSignals.abmId)).innerJoin(s.contacts, eq(s.contacts.id, s.abmSignals.contactId)).leftJoin(s.users, eq(s.users.id, s.abmSignals.ownerId))
        .where(and(vis(auth), q.status === 'abertos' ? inArray(s.abmSignals.status, ['novo', 'em_analise']) : inArray(s.abmSignals.status, ['tratado', 'descartado', 'resolvido']),
          q.severity ? eq(s.abmSignals.severity, q.severity) : undefined, q.owner ? eq(s.abmSignals.ownerId, q.owner) : undefined, q.contactId ? eq(s.abmSignals.contactId, q.contactId) : undefined, q.mine === '1' ? eq(s.abmSignals.ownerId, auth.userId) : undefined))
        .orderBy(sql`case ${s.abmSignals.severity} when 'alta' then 0 when 'media' then 1 else 2 end`, desc(s.abmSignals.detectedAt)).limit(400);
      const items = rows.map(({ x, ...r }) => ({ ...x, ...r }));
      const by = (k: 'severity' | 'kind') => items.reduce<Record<string, number>>((m, i) => ({ ...m, [i[k]]: (m[i[k]] ?? 0) + 1 }), {});
      return { items, counts: { total: items.length, bySeverity: by('severity'), byKind: by('kind'), novos: items.filter((i) => i.status === 'novo').length } };
    },
  }),
  defineRoute({
    method: 'GET', url: '/abm/signals/:id', summary: 'Sinal com o histórico de estados', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [x] = await app.db.select().from(s.abmSignals).where(and(eq(s.abmSignals.id, params.id), eq(s.abmSignals.tenantId, auth.tenantId))).limit(1);
      if (!x) throw notFound('Sinal não encontrado.');
      await assertAccount(app.db, auth, x.contactId);
      const ev = await app.db.select({ e: s.abmSignalEvents, by: s.users.name }).from(s.abmSignalEvents).leftJoin(s.users, eq(s.users.id, s.abmSignalEvents.actorId)).where(eq(s.abmSignalEvents.signalId, x.id)).orderBy(desc(s.abmSignalEvents.createdAt));
      return { ...x, events: ev.map(({ e, by }) => ({ ...e, actorName: by ?? 'Sistema' })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/abm/signals', summary: 'Registra um sinal observado pela equipe (ex.: troca de gestor, edital publicado)', tag: 'Marketing', module: 'clientes',
    body: z.object({ contactId: z.string().uuid(), title: z.string().trim().min(5).max(200), detail: z.string().trim().max(2000).nullable().default(null), severity: z.enum(SIGNAL_SEVERITIES) }),
    handler: async ({ app, auth, body, reply }) => {
      const a = await abmOf(app.db, auth, body.contactId);
      const [x] = await app.db.insert(s.abmSignals).values({ tenantId: auth.tenantId, abmId: a.id, contactId: a.contactId, kind: 'manual', key: `manual:${crypto.randomUUID()}`, severity: body.severity, title: body.title, detail: body.detail, ownerId: a.ownerId, createdBy: auth.userId }).returning({ id: s.abmSignals.id });
      await app.db.insert(s.abmSignalEvents).values({ tenantId: auth.tenantId, signalId: x!.id, type: 'registrado', note: body.title, actorId: auth.userId });
      reply.code(201);
      return { id: x!.id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/abm/signals/:id/transition', summary: 'Muda o estado: em análise, tratado (o que foi feito) ou descartado (motivo)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ to: z.enum(['em_analise', 'tratado', 'descartado']), note: z.string().trim().max(2000).default('') }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const x = await loadSignal(tx, auth, params.id);
      const err = signalTransition(x.status as SignalStatus, body.to, body.note);
      if (err) throw unprocessable(err);
      const closing = body.to !== 'em_analise';
      const suppress = closing ? new Date(Date.now() + SUPPRESS_DAYS[body.to as 'tratado' | 'descartado'] * 86_400_000) : null;
      await tx.update(s.abmSignals).set({ status: body.to, ...(closing ? { closedAt: new Date(), closedBy: auth.userId, resolution: body.note, suppressUntil: x.kind === 'manual' ? null : suppress } : {}), rowVersion: x.rowVersion + 1 }).where(eq(s.abmSignals.id, x.id));
      await tx.insert(s.abmSignalEvents).values({ tenantId: auth.tenantId, signalId: x.id, type: body.to, note: body.note || null, actorId: auth.userId });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/abm/signals/:id/task', summary: 'Cria uma tarefa para tratar o sinal (o sinal passa para em análise)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ title: z.string().trim().min(3).max(200), dueOn: isoDate, ownerId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, body, reply }) => {
      const ownerId = body.ownerId ?? auth.userId;
      await assertAssignableUser(app.db, auth, 'clientes', ownerId);
      const id = await app.db.transaction(async (tx) => {
        const x = await loadSignal(tx, auth, params.id);
        if (!['novo', 'em_analise'].includes(x.status)) throw unprocessable('Este sinal já foi encerrado.');
        const ref = x.ref as { stakeholderId?: string; opportunityId?: string; contractId?: string };
        const [a] = await tx.insert(s.activities).values({ tenantId: auth.tenantId, type: 'tarefa', title: body.title, notes: `Sinal: ${x.title}${x.detail ? `\n${x.detail}` : ''}`, priority: x.severity === 'alta' ? 'alta' : 'media', ownerId, createdBy: auth.userId, contactId: x.contactId, opportunityId: ref.opportunityId ?? null, dueAt: dueAtOf(auth, body.dueOn) as unknown as Date, status: 'a_fazer', category: 'Sinal ABM', tags: ['abm', 'sinal'], stakeholderIds: ref.stakeholderId ? [ref.stakeholderId] : [] }).returning({ id: s.activities.id });
        await taskEvent(tx, auth, a!.id, 'created', { delegatedTo: ownerId !== auth.userId ? ownerId : null, signalId: x.id });
        await tx.update(s.abmSignals).set({ taskId: a!.id, status: 'em_analise', rowVersion: x.rowVersion + 1 }).where(eq(s.abmSignals.id, x.id));
        await tx.insert(s.abmSignalEvents).values({ tenantId: auth.tenantId, signalId: x.id, type: 'tarefa_criada', note: body.title, actorId: auth.userId });
        return a!.id;
      });
      reply.code(201);
      return { taskId: id };
    },
  }),

  // ------------------------------------------------------------ cadências
  defineRoute({
    method: 'GET', url: '/accounts/:id/cadences', summary: 'Cadências da conta com próximo contato e tarefa em aberto', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      const rows = await app.db.select({ c: s.abmCadences, owner: s.users.name, person: s.people.name }).from(s.abmCadences).innerJoin(s.users, eq(s.users.id, s.abmCadences.ownerId))
        .leftJoin(s.accountStakeholders, eq(s.accountStakeholders.id, s.abmCadences.stakeholderId)).leftJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(eq(s.abmCadences.contactId, params.id)).orderBy(s.abmCadences.createdAt);
      const out = [];
      for (const { c, owner, person } of rows) {
        const st = await app.db.execute<{ last_done: string | null; open_id: string | null; open_due: string | null; done: number }>(sql`select max(a.completed_at)::date::text as last_done,
          (array_agg(a.id order by t.due_on desc) filter (where a.deleted_at is null and a.status not in ('concluida', 'cancelada')))[1] as open_id,
          (array_agg(t.due_on::text order by t.due_on desc) filter (where a.deleted_at is null and a.status not in ('concluida', 'cancelada')))[1] as open_due,
          count(a.completed_at)::int as done from abm_cadence_tasks t join activities a on a.id = t.activity_id where t.cadence_id = ${c.id}`);
        const r = st.rows[0];
        out.push({ ...c, ownerName: owner, personName: person, lastDoneOn: r?.last_done ?? null, openTaskId: r?.open_id ?? null, openDueOn: r?.open_due ?? null, doneCount: r?.done ?? 0, nextDueOn: r?.open_due ?? nextCadence({ startOn: c.startOn, everyDays: c.everyDays, lastDoneOn: r?.last_done ?? null, hasOpen: false }, todayOf(auth)).dueOn });
      }
      return { items: out };
    },
  }),
  defineRoute({
    method: 'POST', url: '/accounts/:id/cadences', summary: 'Cria cadência de contato (conta ou pessoa); a primeira tarefa nasce na hora se já estiver perto', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ title: z.string().trim().max(200), type: z.enum(CADENCE_TYPES), everyDays: z.number().int(), startOn: isoDate, stakeholderId: z.string().uuid().nullable().default(null), ownerId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, body, reply }) => {
      const errs = cadenceErrors(body);
      if (errs.length) throw unprocessable(errs[0]!);
      const a = await abmOf(app.db, auth, params.id);
      const ownerId = body.ownerId ?? auth.userId;
      await assertAssignableUser(app.db, auth, 'clientes', ownerId);
      if (body.stakeholderId) {
        const [st] = await app.db.select({ contactId: s.accountStakeholders.contactId, active: s.accountStakeholders.active }).from(s.accountStakeholders).where(eq(s.accountStakeholders.id, body.stakeholderId)).limit(1);
        if (!st || st.contactId !== params.id || !st.active) throw unprocessable('Escolha uma pessoa ativa desta conta.');
      }
      const [c] = await app.db.insert(s.abmCadences).values({ tenantId: auth.tenantId, abmId: a.id, contactId: params.id, stakeholderId: body.stakeholderId, title: body.title, type: body.type, everyDays: body.everyDays, ownerId, startOn: body.startOn, createdBy: auth.userId }).returning({ id: s.abmCadences.id });
      await app.db.insert(s.abmEvents).values({ tenantId: auth.tenantId, abmId: a.id, type: 'cadencia_criada', payload: { title: body.title, everyDays: body.everyDays }, actorId: auth.userId });
      const g = await generateAbmCadences(app.db, auth.tenantId, todayOf(auth), auth.timezone, c!.id);
      reply.code(201);
      return { id: c!.id, tasksCreated: g.created };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/abm/cadences/:id', summary: 'Ajusta ou pausa a cadência (tarefas já criadas continuam)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), title: z.string().trim().max(200).optional(), everyDays: z.number().int().optional(), active: z.boolean().optional(), ownerId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, body }) => {
      const [c] = await app.db.select().from(s.abmCadences).where(and(eq(s.abmCadences.id, params.id), eq(s.abmCadences.tenantId, auth.tenantId))).limit(1);
      if (!c) throw notFound('Cadência não encontrada.');
      await assertAccount(app.db, auth, c.contactId);
      if (c.rowVersion !== body.rowVersion) throw unprocessable('A cadência foi alterada por outra pessoa. Recarregue.');
      const next = { title: body.title ?? c.title, everyDays: body.everyDays ?? c.everyDays, startOn: c.startOn };
      const errs = cadenceErrors(next);
      if (errs.length) throw unprocessable(errs[0]!);
      if (body.ownerId) await assertAssignableUser(app.db, auth, 'clientes', body.ownerId);
      await app.db.update(s.abmCadences).set({ title: next.title, everyDays: next.everyDays, active: body.active ?? c.active, ownerId: body.ownerId ?? c.ownerId, rowVersion: c.rowVersion + 1 }).where(eq(s.abmCadences.id, c.id));
      if (body.active !== false) await generateAbmCadences(app.db, auth.tenantId, todayOf(auth), auth.timezone, c.id);
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------ interações
  defineRoute({
    method: 'GET', url: '/accounts/:id/interactions', summary: 'Histórico único de interações da conta (atividades concluídas, e-mails, pesquisas, visitas), opcionalmente de uma pessoa', tag: 'Marketing', module: 'clientes', params: IdParams,
    query: z.object({ stakeholderId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, query: q }) => {
      await assertAccount(app.db, auth, params.id);
      const sid = q.stakeholderId;
      const acts = await app.db.execute<{ id: string; type: string; title: string; notes: string | null; result: string | null; at: string; owner: string | null; stakeholder_ids: string[]; category: string | null }>(sql`
        select a.id, a.type, a.title, a.notes, a.cs_result as result, a.completed_at as at, u.name as owner, a.stakeholder_ids, a.category from activities a left join users u on u.id = a.owner_id
        where a.contact_id = ${params.id} and a.deleted_at is null and a.status = 'concluida' and a.completed_at is not null ${sid ? sql`and ${sid}::uuid = any(a.stakeholder_ids)` : sql``} order by a.completed_at desc limit 200`);
      const emails = sid ? { rows: [] } : await app.db.execute<{ id: string; subject: string; to_address: string; at: string; kind: string; by: string | null }>(sql`
        select e.id, e.subject, e.to_address, e.created_at as at, e.kind, u.name as by from email_messages e left join users u on u.id = e.created_by
        where e.status = 'enviado' and (e.opportunity_id in (select id from opportunities where contact_id = ${params.id}) or e.contract_id in (select id from contracts where contact_id = ${params.id})) order by e.created_at desc limit 100`);
      // e-mails do Gmail ligados à conta: caixas compartilhadas e a caixa pessoal de quem está vendo
      const gmail = await app.db.execute<{ id: string; at: string; subject: string; direction: string; from_addr: string; from_name: string | null; snippet: string | null; by: string | null }>(sql`
        select m.id, m.sent_at as at, m.subject, m.direction, m.from_addr, m.from_name, m.snippet, u.name as by from mail_messages m join mail_threads t on t.id = m.thread_id join mailboxes b on b.id = m.mailbox_id left join users u on u.id = m.sent_by
        where t.contact_id = ${params.id} and (b.kind = 'compartilhada' or b.owner_id = ${auth.userId})
        ${sid ? sql`and exists (select 1 from account_stakeholders st join people p on p.id = st.person_id where st.id = ${sid} and p.email is not null and (lower(p.email) = m.from_addr or lower(p.email) = any(m.to_addrs) or lower(p.email) = any(m.cc_addrs)))` : sql``}
        order by m.sent_at desc limit 100`);
      const surveys = await app.db.execute<{ id: string; at: string; survey: string; nps: number | null; person: string | null }>(sql`
        select r.id, r.created_at as at, sv.name as survey, r.nps_score as nps, p.name as person from survey_responses r join surveys sv on sv.id = r.survey_id left join account_stakeholders st on st.id = r.stakeholder_id left join people p on p.id = st.person_id
        where r.contact_id = ${params.id} ${sid ? sql`and r.stakeholder_id = ${sid}` : sql``} order by r.created_at desc limit 50`);
      const visits = sid ? { rows: [] } : await app.db.execute<{ id: string; at: string; type: string; summary: string | null; by: string | null }>(sql`
        select v.id, coalesce(v.done_at, v.created_at) as at, v.type, v.summary, u.name as by from cs_visits v left join users u on u.id = v.csm_id where v.contact_id = ${params.id} and v.status = 'realizada' order by at desc limit 50`);
      const peopleIds = [...new Set(acts.rows.flatMap((a) => a.stakeholder_ids ?? []))];
      const names = new Map((peopleIds.length ? await app.db.select({ id: s.accountStakeholders.id, name: s.people.name }).from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(inArray(s.accountStakeholders.id, peopleIds)) : []).map((p) => [p.id, p.name]));
      const items = [
        ...acts.rows.map((a) => ({ id: `a:${a.id}`, source: 'atividade' as const, kind: a.type, title: a.title, text: a.result ?? (a.category === 'Interação registrada' ? a.notes : null), at: a.at, by: a.owner, people: (a.stakeholder_ids ?? []).map((x) => names.get(x)).filter(Boolean), activityId: a.id, category: a.category })),
        ...emails.rows.map((e) => ({ id: `e:${e.id}`, source: 'email' as const, kind: 'email', title: e.subject, text: `Para ${e.to_address}`, at: e.at, by: e.by, people: [], activityId: null, category: e.kind })),
        ...gmail.rows.map((m) => ({ id: `g:${m.id}`, source: 'gmail' as const, kind: 'email', title: m.subject || '(sem assunto)', text: m.direction === 'entrada' ? `De ${m.from_name ?? m.from_addr}: ${m.snippet ?? ''}` : `Enviado: ${m.snippet ?? ''}`, at: m.at, by: m.by, people: [], activityId: null, category: m.direction })),
        ...surveys.rows.map((r) => ({ id: `p:${r.id}`, source: 'pesquisa' as const, kind: 'pesquisa', title: `Respondeu "${r.survey}"`, text: r.nps !== null ? `NPS ${r.nps}` : null, at: r.at, by: null, people: r.person ? [r.person] : [], activityId: null, category: null })),
        ...visits.rows.map((v) => ({ id: `v:${v.id}`, source: 'visita' as const, kind: 'visita', title: `Visita: ${v.type}`, text: v.summary, at: v.at, by: v.by, people: [], activityId: null, category: null })),
      ].sort((x, y) => String(y.at).localeCompare(String(x.at)));
      return { items };
    },
  }),
  defineRoute({
    method: 'POST', url: '/accounts/:id/interactions', summary: 'Registra uma interação que já aconteceu (com quais pessoas da conta)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ type: z.enum(['ligacao', 'reuniao', 'visita', 'email', 'whatsapp']), at: z.string().datetime({ offset: true }), summary: z.string().trim().min(10).max(4000), stakeholderIds: z.array(z.string().uuid()).max(30).default([]) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const acc = await assertAccount(app.db, auth, params.id);
      const at = new Date(body.at);
      if (at.getTime() > Date.now() + 3600_000) throw unprocessable('Registre só interações que já aconteceram.');
      if (body.stakeholderIds.length) {
        const ok = await app.db.select({ id: s.accountStakeholders.id }).from(s.accountStakeholders).where(and(inArray(s.accountStakeholders.id, body.stakeholderIds), eq(s.accountStakeholders.contactId, params.id)));
        if (ok.length !== new Set(body.stakeholderIds).size) throw unprocessable('Só pessoas desta conta.');
      }
      const LABEL = { ligacao: 'Ligação', reuniao: 'Reunião', visita: 'Visita', email: 'E-mail', whatsapp: 'WhatsApp' } as const;
      const [a] = await app.db.insert(s.activities).values({ tenantId: auth.tenantId, type: body.type, title: `${LABEL[body.type]} · ${acc.name}`.slice(0, 200), notes: body.summary, priority: 'media', ownerId: auth.userId, createdBy: auth.userId, contactId: params.id, dueAt: at, completedAt: at, completedBy: auth.userId, status: 'concluida', category: 'Interação registrada', tags: ['abm', 'interacao'], stakeholderIds: body.stakeholderIds }).returning({ id: s.activities.id });
      await app.db.insert(s.activityEvents).values({ tenantId: auth.tenantId, activityId: a!.id, type: 'completed', actorId: auth.userId, payload: { interaction: true } });
      reply.code(201);
      return { id: a!.id };
    },
  }),
];
