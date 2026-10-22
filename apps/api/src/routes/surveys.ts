/**
 * Funcionalidade 02 — Pesquisas por link: construtor versionado, convites individuais (conta e pessoa), respostas e
 * destino de cada resposta (automático ou com revisão). Influência nunca é destino (ADR-056). NPS/CSAT entram no
 * registro de pesquisas do Sucesso do Cliente, que já alimenta a saúde da conta; a jornada é atualizada.
 */
import { randomBytes, createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  QUESTION_TYPES, SURVEY_DESTINATION_LABELS, answerErrors, atLeast, inviteStatus, npsOf, updatesFrom, validateSurvey,
  type AnswerValue, type SurveyDefinition,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level, ownerScope } from '../services/scope';
import { audit } from '../services/audit';
import { sendEmail } from '../services/email';
import { addDays, recomputeAccounts, todayIso } from '../services/cs';
import { logMilestone } from '../services/journeyTrail';
import { assertAccount } from './stakeholders';

const canManage = (auth: AuthContext) => atLeast(level(auth, 'clientes'), 'equipe');
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
const contactVisible = (auth: AuthContext) => ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt });

const OptionBody = z.object({ key: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(200), maps: z.string().max(40).nullable().optional() });
const QuestionBody = z.object({ key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i), type: z.enum(QUESTION_TYPES), text: z.string().trim().max(500), required: z.boolean(), options: z.array(OptionBody).max(20).optional(), destination: z.string().max(60), mode: z.enum(['automatica', 'pendente']) });
const DefinitionBody = z.object({ title: z.string().trim().max(200), intro: z.string().trim().max(2000).default(''), thanks: z.string().trim().max(500).default('Obrigado! Sua resposta foi registrada.'), questions: z.array(QuestionBody).min(1).max(40) });
function checkDef(d: z.infer<typeof DefinitionBody>) {
  const errs = validateSurvey(d as SurveyDefinition);
  if (errs.length) throw unprocessable(errs[0]!, errs.map((m) => ({ path: 'definition', message: m })));
}
async function current(db: DbOrTx, tenantId: string, id: string) {
  const [r] = await db.select({ s: s.surveys, def: s.surveyVersions.definition }).from(s.surveys).innerJoin(s.surveyVersions, and(eq(s.surveyVersions.surveyId, s.surveys.id), eq(s.surveyVersions.version, s.surveys.currentVersion))).where(and(eq(s.surveys.id, id), eq(s.surveys.tenantId, tenantId))).limit(1);
  if (!r) throw notFound('Pesquisa não encontrada.');
  return { ...r.s, definition: r.def };
}

/** Aplica o que a resposta muda no cadastro. Nunca toca na influência. */
async function applyUpdate(db: DbOrTx, u: typeof s.surveyUpdates.$inferSelect, respondent: string | null, actorId: string | null) {
  const v = u.value as string | number;
  if (u.destination === 'cs_nps' || u.destination === 'cs_csat') {
    await db.insert(s.csSurveys).values({ tenantId: u.tenantId, contactId: u.contactId, kind: u.destination === 'cs_nps' ? 'NPS' : 'CSAT', score: Number(v), scale: u.destination === 'cs_nps' ? 10 : 5, respondent: respondent ? `${respondent} (pesquisa por link)` : 'Pesquisa por link', comment: null, respondedAt: todayIso(), actorId });
    // pesquisa prevista na jornada fica cumprida (com registro no histórico do marco)
    const done = await db.update(s.csMilestones).set({ doneAt: new Date(), doneBy: actorId }).where(and(isNull(s.csMilestones.doneAt), sql`${s.csMilestones.key} in ('pesquisa','satisfacao_ren')`, sql`${s.csMilestones.journeyId} in (select id from cs_journeys where contact_id = ${u.contactId} and status = 'ativa')`, sql`${s.csMilestones.plannedAt} <= ${addDays(todayIso(), 30)}`)).returning({ id: s.csMilestones.id, journeyId: s.csMilestones.journeyId });
    for (const m of done) await logMilestone(db, u.tenantId, m.journeyId, m.id, [{ type: 'concluido', from: null, to: new Date(), via: 'pesquisa' }], actorId);
    return null;
  }
  if (!u.stakeholderId) return 'sem_alvo' as const;
  const [st] = await db.select().from(s.accountStakeholders).where(eq(s.accountStakeholders.id, u.stakeholderId)).limit(1);
  if (!st) return 'sem_alvo' as const;
  if (u.destination === 'stakeholder_interesse' || u.destination === 'stakeholder_posicionamento') {
    const field = u.destination === 'stakeholder_interesse' ? 'interest' : 'stance';
    await db.update(s.accountStakeholders).set({ [field]: String(v), rowVersion: st.rowVersion + 1, updatedAt: new Date() }).where(eq(s.accountStakeholders.id, st.id));
    await db.insert(s.stakeholderEvents).values({ tenantId: u.tenantId, stakeholderId: st.id, type: 'alterado', payload: { fields: [field], from: st[field], to: v, via: 'pesquisa', surveyUpdateId: u.id }, actorId });
  } else {
    const field = u.destination === 'pessoa_email' ? 'email' : 'phone';
    await db.update(s.people).set({ [field]: field === 'email' ? String(v).toLowerCase() : String(v), updatedAt: new Date(), rowVersion: sql`${s.people.rowVersion} + 1` }).where(eq(s.people.id, st.personId));
    await db.insert(s.stakeholderEvents).values({ tenantId: u.tenantId, stakeholderId: st.id, type: 'alterado', payload: { fields: [field], to: v, via: 'pesquisa', surveyUpdateId: u.id }, actorId });
  }
  return null;
}
async function previousOf(db: DbOrTx, destination: string, stakeholderId: string | null) {
  if (!stakeholderId || destination.startsWith('cs_')) return null;
  const [r] = await db.select({ interest: s.accountStakeholders.interest, stance: s.accountStakeholders.stance, email: s.people.email, phone: s.people.phone }).from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(eq(s.accountStakeholders.id, stakeholderId)).limit(1);
  if (!r) return null;
  return destination === 'stakeholder_interesse' ? r.interest : destination === 'stakeholder_posicionamento' ? r.stance : destination === 'pessoa_email' ? r.email : r.phone;
}

async function inviteByToken(db: DbOrTx, token: string, lock = false) {
  const q = db.select().from(s.surveyInvites).where(eq(s.surveyInvites.tokenHash, hash(token))).limit(1);
  const [i] = lock ? await q.for('update') : await q;
  const st = i ? inviteStatus(i) : null;
  if (!i || st === 'cancelado' || st === 'expirado') throw new AppError(404, 'Link expirado ou cancelado', 'Este convite não está mais disponível. Peça um novo link a quem enviou.');
  if (st === 'respondido') throw new AppError(409, 'Pesquisa já respondida', 'Este convite já foi respondido. Obrigado!');
  return i;
}
/** Versão pública da pergunta: sem destino, modo ou valores internos. */
const publicQuestions = (d: SurveyDefinition) => d.questions.map((q) => ({ key: q.key, type: q.type, text: q.text, required: q.required, options: q.options?.map((o) => ({ key: o.key, label: o.label })) }));

function statsOf(def: SurveyDefinition, responses: { answers: Record<string, unknown>; npsScore: number | null }[]) {
  const nps = npsOf(responses.map((r) => r.npsScore).filter((x): x is number => x !== null));
  const csatQ = def.questions.find((q) => q.type === 'csat');
  const csat = csatQ ? responses.map((r) => r.answers[csatQ.key]).filter((x): x is number => typeof x === 'number') : [];
  const perQuestion = def.questions.map((q) => {
    const vals = responses.map((r) => r.answers[q.key]).filter((v) => v !== undefined && v !== null && v !== '');
    const dist: Record<string, number> = {};
    for (const v of vals) for (const k of Array.isArray(v) ? v : [v]) dist[String(k)] = (dist[String(k)] ?? 0) + 1;
    return { key: q.key, text: q.text, type: q.type, answered: vals.length, distribution: q.type === 'texto' ? {} : dist, texts: q.type === 'texto' ? (vals as string[]).slice(-20) : [], options: q.options?.map((o) => ({ key: o.key, label: o.label })) };
  });
  return { nps, csatAvg: csat.length ? Math.round((csat.reduce((a, b) => a + b, 0) / csat.length) * 10) / 10 : null, perQuestion };
}

export const surveyRoutes = [
  // ------------------------------------------------------------ construtor
  defineRoute({
    method: 'GET', url: '/surveys', summary: 'Pesquisas com convites, taxa de resposta, NPS, CSAT e atualizações pendentes', tag: 'Sucesso do Cliente', module: 'clientes',
    handler: async ({ app, auth }) => {
      const rows = await app.db.select({ s: s.surveys, def: s.surveyVersions.definition }).from(s.surveys).innerJoin(s.surveyVersions, and(eq(s.surveyVersions.surveyId, s.surveys.id), eq(s.surveyVersions.version, s.surveys.currentVersion))).where(eq(s.surveys.tenantId, auth.tenantId)).orderBy(asc(s.surveys.name));
      const inv = await app.db.select({ surveyId: s.surveyInvites.surveyId, n: sql<number>`count(*)::int`, r: sql<number>`count(${s.surveyInvites.respondedAt})::int` }).from(s.surveyInvites).where(and(eq(s.surveyInvites.tenantId, auth.tenantId), isNull(s.surveyInvites.canceledAt))).groupBy(s.surveyInvites.surveyId);
      const nps = await app.db.select({ surveyId: s.surveyResponses.surveyId, score: s.surveyResponses.npsScore }).from(s.surveyResponses).where(and(eq(s.surveyResponses.tenantId, auth.tenantId), sql`${s.surveyResponses.npsScore} is not null`));
      const [pend] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.surveyUpdates).where(and(eq(s.surveyUpdates.tenantId, auth.tenantId), eq(s.surveyUpdates.status, 'pendente')));
      return {
        canManage: canManage(auth), pendingUpdates: pend?.n ?? 0,
        items: rows.map(({ s: x, def }) => { const i = inv.find((v) => v.surveyId === x.id); return { ...x, title: def.title, questions: def.questions.length, invites: i?.n ?? 0, responses: i?.r ?? 0, responseRate: i?.n ? Math.round((i.r / i.n) * 100) : null, nps: npsOf(nps.filter((n) => n.surveyId === x.id).map((n) => n.score!)) }; }),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/surveys/:id', summary: 'Pesquisa: definição vigente, versões, convites, respostas e indicadores por pergunta', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const sv = await current(app.db, auth.tenantId, params.id);
      const versions = await app.db.select({ v: s.surveyVersions, by: s.users.name }).from(s.surveyVersions).leftJoin(s.users, eq(s.users.id, s.surveyVersions.createdBy)).where(eq(s.surveyVersions.surveyId, sv.id)).orderBy(desc(s.surveyVersions.version));
      const invites = await app.db.select({ i: s.surveyInvites, account: s.contacts.name, person: s.people.name, by: s.users.name }).from(s.surveyInvites).innerJoin(s.contacts, eq(s.contacts.id, s.surveyInvites.contactId)).innerJoin(s.users, eq(s.users.id, s.surveyInvites.createdBy))
        .leftJoin(s.accountStakeholders, eq(s.accountStakeholders.id, s.surveyInvites.stakeholderId)).leftJoin(s.people, eq(s.people.id, s.accountStakeholders.personId))
        .where(and(eq(s.surveyInvites.surveyId, sv.id), contactVisible(auth))).orderBy(desc(s.surveyInvites.createdAt)).limit(300);
      const responses = await app.db.select().from(s.surveyResponses).where(and(eq(s.surveyResponses.surveyId, sv.id), inArray(s.surveyResponses.inviteId, invites.length ? invites.map((x) => x.i.id) : ['00000000-0000-0000-0000-000000000000']))).orderBy(desc(s.surveyResponses.createdAt));
      const active = invites.filter((x) => !x.i.canceledAt);
      return {
        ...sv, canManage: canManage(auth),
        versions: versions.map((x) => ({ ...x.v, createdByName: x.by })),
        invites: invites.map(({ i, account, person, by }) => ({ id: i.id, version: i.version, contactId: i.contactId, account, stakeholderId: i.stakeholderId, person, respondentName: i.respondentName, respondentEmail: i.respondentEmail, status: inviteStatus(i), expiresAt: i.expiresAt, openedAt: i.openedAt, respondedAt: i.respondedAt, emailedAt: i.emailedAt, cancelReason: i.cancelReason, createdByName: by, createdAt: i.createdAt })),
        responses: responses.map((r) => ({ id: r.id, inviteId: r.inviteId, version: r.version, answers: r.answers, npsScore: r.npsScore, createdAt: r.createdAt, account: invites.find((x) => x.i.id === r.inviteId)?.account, person: invites.find((x) => x.i.id === r.inviteId)?.person ?? invites.find((x) => x.i.id === r.inviteId)?.i.respondentName ?? null })),
        stats: { invites: active.length, responses: responses.length, responseRate: active.length ? Math.round((active.filter((x) => x.i.respondedAt).length / active.length) * 100) : null, ...statsOf(sv.definition, responses) },
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/surveys', summary: 'Cria pesquisa (versão 1)', tag: 'Sucesso do Cliente', module: 'clientes', min: 'equipe',
    body: z.object({ name: z.string().trim().min(3).max(120), definition: DefinitionBody }),
    handler: async ({ app, auth, body, reply }) => {
      checkDef(body.definition);
      const id = await app.db.transaction(async (tx) => {
        const [x] = await tx.insert(s.surveys).values({ tenantId: auth.tenantId, name: body.name, createdBy: auth.userId }).onConflictDoNothing().returning({ id: s.surveys.id });
        if (!x) throw unprocessable('Já existe uma pesquisa com este nome.', [{ path: 'name', message: 'Escolha outro nome' }]);
        await tx.insert(s.surveyVersions).values({ tenantId: auth.tenantId, surveyId: x.id, version: 1, definition: body.definition as SurveyDefinition, note: 'Criação', createdBy: auth.userId });
        return x.id;
      });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/surveys/:id', summary: 'Edita a pesquisa; mudança nas perguntas gera nova versão (convites já enviados seguem a versão deles)', tag: 'Sucesso do Cliente', module: 'clientes', min: 'equipe', params: IdParams,
    body: z.object({ rowVersion: z.number().int(), name: z.string().trim().min(3).max(120), definition: DefinitionBody, note: z.string().trim().min(3).max(300) }),
    handler: async ({ app, auth, params, body }) => {
      checkDef(body.definition);
      return app.db.transaction(async (tx) => {
        const sv = await current(tx, auth.tenantId, params.id);
        if (sv.rowVersion !== body.rowVersion) throw conflict(sv.rowVersion);
        const changed = canonical(sv.definition) !== canonical(body.definition);
        const version = changed ? sv.currentVersion + 1 : sv.currentVersion;
        if (changed) await tx.insert(s.surveyVersions).values({ tenantId: auth.tenantId, surveyId: sv.id, version, definition: body.definition as SurveyDefinition, note: body.note, createdBy: auth.userId });
        const [dup] = await tx.select({ id: s.surveys.id }).from(s.surveys).where(and(eq(s.surveys.tenantId, auth.tenantId), eq(s.surveys.name, body.name), sql`${s.surveys.id} <> ${sv.id}`)).limit(1);
        if (dup) throw unprocessable('Já existe uma pesquisa com este nome.', [{ path: 'name', message: 'Escolha outro nome' }]);
        await tx.update(s.surveys).set({ name: body.name, currentVersion: version, rowVersion: sv.rowVersion + 1, updatedAt: new Date() }).where(eq(s.surveys.id, sv.id));
        return { version };
      });
    },
  }),
  defineRoute({
    method: 'POST', url: '/surveys/:id/active', summary: 'Ativa ou desativa (desativada não recebe novos convites; os enviados continuam valendo)', tag: 'Sucesso do Cliente', module: 'clientes', min: 'equipe', params: IdParams,
    body: z.object({ active: z.boolean() }),
    handler: async ({ app, auth, params, body }) => {
      const r = await app.db.update(s.surveys).set({ active: body.active, updatedAt: new Date(), rowVersion: sql`${s.surveys.rowVersion} + 1` }).where(and(eq(s.surveys.id, params.id), eq(s.surveys.tenantId, auth.tenantId))).returning({ id: s.surveys.id });
      if (!r.length) throw notFound('Pesquisa não encontrada.');
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------ convites
  defineRoute({
    method: 'POST', url: '/surveys/:id/invites', summary: 'Cria convite individual (conta e, opcionalmente, pessoa da conta); pode enviar por e-mail pelo SMTP da empresa', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ contactId: z.string().uuid(), stakeholderId: z.string().uuid().nullable().default(null), respondentName: z.string().trim().max(160).nullable().default(null), respondentEmail: z.string().trim().toLowerCase().email().max(200).nullable().default(null), days: z.number().int().min(1).max(90).default(15), sendEmail: z.boolean().default(false) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const sv = await current(app.db, auth.tenantId, params.id);
      if (!sv.active) throw unprocessable('Esta pesquisa está desativada.');
      const acc = await assertAccount(app.db, auth, body.contactId);
      let name = body.respondentName, email = body.respondentEmail;
      if (body.stakeholderId) {
        const [st] = await app.db.select({ id: s.accountStakeholders.id, contactId: s.accountStakeholders.contactId, active: s.accountStakeholders.active, name: s.people.name, email: s.people.email }).from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(and(eq(s.accountStakeholders.id, body.stakeholderId), eq(s.accountStakeholders.tenantId, auth.tenantId))).limit(1);
        if (!st || st.contactId !== body.contactId || !st.active) throw unprocessable('A pessoa precisa estar ativa nesta conta.', [{ path: 'stakeholderId', message: 'Escolha uma pessoa da conta' }]);
        name = name ?? st.name; email = email ?? st.email;
      } else if (sv.definition.questions.some((q) => q.destination.startsWith('stakeholder_') || q.destination.startsWith('pessoa_'))) {
        throw unprocessable('Esta pesquisa atualiza dados de uma pessoa: escolha a pessoa da conta que vai responder.', [{ path: 'stakeholderId', message: 'Escolha a pessoa' }]);
      }
      if (body.sendEmail && !email) throw unprocessable('Informe o e-mail de quem vai responder para enviar por e-mail.', [{ path: 'respondentEmail', message: 'Informe o e-mail' }]);
      const token = randomBytes(24).toString('base64url');
      const expiresAt = new Date(Date.now() + body.days * 86_400_000);
      const [i] = await app.db.insert(s.surveyInvites).values({ tenantId: auth.tenantId, surveyId: sv.id, version: sv.currentVersion, contactId: body.contactId, stakeholderId: body.stakeholderId, respondentName: name, respondentEmail: email, tokenHash: hash(token), expiresAt, createdBy: auth.userId }).returning({ id: s.surveyInvites.id });
      const url = `/p/${token}`;
      let emailed: { ok: boolean; error?: string } | null = null;
      if (body.sendEmail && email) {
        const r = await sendEmail(app.db, { tenantId: auth.tenantId, kind: 'pesquisa', to: email, subject: sv.definition.title, text: `Olá${name ? `, ${name.split(' ')[0]}` : ''}!\n\n${sv.definition.intro || 'Gostaríamos de ouvir sua opinião.'}\n\nResponda aqui: ${app.config.publicUrl}${url}\n\nO link é pessoal e vale até ${expiresAt.toLocaleDateString('pt-BR')}.`, createdBy: auth.userId });
        emailed = r.ok ? { ok: true } : { ok: false, error: r.error };
        if (r.ok) await app.db.update(s.surveyInvites).set({ emailedAt: new Date() }).where(eq(s.surveyInvites.id, i!.id));
      }
      await audit(app.db, req, { action: 'survey.invite.created', tenantId: auth.tenantId, actorId: auth.userId, entityType: 'survey', entityId: sv.id, metadata: { inviteId: i!.id, contactId: body.contactId, account: acc.name, emailed: emailed?.ok ?? false } });
      reply.code(201);
      return { id: i!.id, url, expiresAt, emailed };
    },
  }),
  defineRoute({
    method: 'POST', url: '/survey-invites/:id/cancel', summary: 'Cancela o convite (motivo obrigatório); o link para de funcionar', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ reason: z.string().trim().min(5).max(500) }),
    handler: async ({ app, auth, params, body }) => {
      const [i] = await app.db.select().from(s.surveyInvites).where(and(eq(s.surveyInvites.id, params.id), eq(s.surveyInvites.tenantId, auth.tenantId))).limit(1);
      if (!i) throw notFound('Convite não encontrado.');
      await assertAccount(app.db, auth, i.contactId);
      const st = inviteStatus(i);
      if (st === 'respondido' || st === 'cancelado') throw unprocessable(st === 'respondido' ? 'Convite já respondido.' : 'Convite já cancelado.');
      await app.db.update(s.surveyInvites).set({ canceledAt: new Date(), canceledBy: auth.userId, cancelReason: body.reason }).where(eq(s.surveyInvites.id, i.id));
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/accounts/:id/surveys', summary: 'Convites e respostas de pesquisa da conta', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      const rows = await app.db.select({ i: s.surveyInvites, survey: s.surveys.name, person: s.people.name, nps: s.surveyResponses.npsScore }).from(s.surveyInvites).innerJoin(s.surveys, eq(s.surveys.id, s.surveyInvites.surveyId))
        .leftJoin(s.accountStakeholders, eq(s.accountStakeholders.id, s.surveyInvites.stakeholderId)).leftJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).leftJoin(s.surveyResponses, eq(s.surveyResponses.inviteId, s.surveyInvites.id))
        .where(eq(s.surveyInvites.contactId, params.id)).orderBy(desc(s.surveyInvites.createdAt)).limit(100);
      return { items: rows.map(({ i, survey, person, nps }) => ({ id: i.id, surveyId: i.surveyId, survey, person: person ?? i.respondentName, status: inviteStatus(i), createdAt: i.createdAt, respondedAt: i.respondedAt, expiresAt: i.expiresAt, npsScore: nps })) };
    },
  }),

  // ------------------------------------------------------------ revisão das atualizações
  defineRoute({
    method: 'GET', url: '/survey-updates', summary: 'Atualizações vindas de pesquisas (pendentes por padrão) nas contas visíveis', tag: 'Sucesso do Cliente', module: 'clientes',
    query: z.object({ status: z.enum(['pendente', 'aplicada', 'rejeitada', 'sem_alvo']).default('pendente') }),
    handler: async ({ app, auth, query: q }) => {
      const rows = await app.db.select({ u: s.surveyUpdates, account: s.contacts.name, person: s.people.name, survey: s.surveys.name, respondedAt: s.surveyResponses.createdAt, by: s.users.name })
        .from(s.surveyUpdates).innerJoin(s.contacts, eq(s.contacts.id, s.surveyUpdates.contactId)).innerJoin(s.surveyResponses, eq(s.surveyResponses.id, s.surveyUpdates.responseId)).innerJoin(s.surveys, eq(s.surveys.id, s.surveyResponses.surveyId))
        .leftJoin(s.accountStakeholders, eq(s.accountStakeholders.id, s.surveyUpdates.stakeholderId)).leftJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).leftJoin(s.users, eq(s.users.id, s.surveyUpdates.decidedBy))
        .where(and(eq(s.surveyUpdates.tenantId, auth.tenantId), eq(s.surveyUpdates.status, q.status), contactVisible(auth))).orderBy(desc(s.surveyUpdates.createdAt)).limit(200);
      return { canDecide: canManage(auth), items: rows.map(({ u, ...x }) => ({ ...u, ...x, destinationLabel: SURVEY_DESTINATION_LABELS[u.destination as keyof typeof SURVEY_DESTINATION_LABELS], decidedByName: x.by })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/survey-updates/:id/decide', summary: 'Aprova (aplica no cadastro) ou rejeita a atualização vinda da pesquisa', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(500).default('') }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      if (!canManage(auth)) throw forbidden('Só a liderança revisa as atualizações vindas de pesquisas.');
      const [u] = await tx.select().from(s.surveyUpdates).where(and(eq(s.surveyUpdates.id, params.id), eq(s.surveyUpdates.tenantId, auth.tenantId))).limit(1).for('update');
      if (!u) throw notFound('Atualização não encontrada.');
      await assertAccount(tx, auth, u.contactId);
      if (u.status !== 'pendente') throw unprocessable('Esta atualização já foi decidida.');
      if (!body.approve && body.note.length < 5) throw unprocessable('Diga por que a atualização foi rejeitada.');
      let status: 'aplicada' | 'rejeitada' | 'sem_alvo' = body.approve ? 'aplicada' : 'rejeitada';
      if (body.approve) { const [inv] = await tx.select({ name: s.surveyInvites.respondentName }).from(s.surveyInvites).innerJoin(s.surveyResponses, eq(s.surveyResponses.inviteId, s.surveyInvites.id)).where(eq(s.surveyResponses.id, u.responseId)).limit(1); status = (await applyUpdate(tx, u, inv?.name ?? null, auth.userId)) ?? 'aplicada'; }
      await tx.update(s.surveyUpdates).set({ status, decidedBy: auth.userId, decidedAt: new Date(), note: body.note || null }).where(eq(s.surveyUpdates.id, u.id));
      if (u.destination.startsWith('cs_')) await recomputeAccounts(tx, auth.tenantId, [u.contactId]);
      return { status };
    }),
  }),

  // ------------------------------------------------------------ resposta pelo link (sem login)
  defineRoute({
    method: 'GET', url: '/public/survey/:token', summary: 'Pesquisa pelo link pessoal (marca como aberta)', tag: 'Sucesso do Cliente', public: true,
    params: z.object({ token: z.string().min(20).max(100) }),
    rateLimit: (c) => ({ max: c.loginRateLimitPerMinute * 4, timeWindow: '1 minute' }),
    handler: async ({ app, params }) => {
      const i = await inviteByToken(app.db, params.token);
      const [v] = await app.db.select({ d: s.surveyVersions.definition }).from(s.surveyVersions).where(and(eq(s.surveyVersions.surveyId, i.surveyId), eq(s.surveyVersions.version, i.version))).limit(1);
      const [c] = await app.db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, i.contactId)).limit(1);
      if (!i.openedAt) await app.db.update(s.surveyInvites).set({ openedAt: new Date() }).where(eq(s.surveyInvites.id, i.id));
      return { title: v!.d.title, intro: v!.d.intro, questions: publicQuestions(v!.d), account: c?.name ?? null, respondentName: i.respondentName, expiresAt: i.expiresAt };
    },
  }),
  defineRoute({
    method: 'POST', url: '/public/survey/:token', summary: 'Envia as respostas (uma vez por link); aplica ou deixa para revisão o que muda no cadastro', tag: 'Sucesso do Cliente', public: true,
    params: z.object({ token: z.string().min(20).max(100) }), body: z.object({ answers: z.record(z.string().max(40), z.union([z.number(), z.string().max(4000), z.array(z.string().max(40)).max(20), z.boolean(), z.null()])) }),
    rateLimit: (c) => ({ max: c.loginRateLimitPerMinute, timeWindow: '1 minute' }),
    handler: async ({ app, params, body }) => {
      const out = await app.db.transaction(async (tx) => {
        const i = await inviteByToken(tx, params.token, true);
        const [v] = await tx.select({ d: s.surveyVersions.definition }).from(s.surveyVersions).where(and(eq(s.surveyVersions.surveyId, i.surveyId), eq(s.surveyVersions.version, i.version))).limit(1);
        const def = v!.d;
        const answers = Object.fromEntries(def.questions.map((q) => [q.key, (body.answers[q.key] ?? null) as AnswerValue]));
        const errs = answerErrors(def, answers);
        if (Object.keys(errs).length) throw unprocessable('Confira as respostas destacadas.', Object.entries(errs).map(([path, message]) => ({ path, message })));
        const npsQ = def.questions.find((q) => q.type === 'nps');
        const npsScore = npsQ && typeof answers[npsQ.key] === 'number' ? (answers[npsQ.key] as number) : null;
        const [r] = await tx.insert(s.surveyResponses).values({ tenantId: i.tenantId, inviteId: i.id, surveyId: i.surveyId, version: i.version, contactId: i.contactId, stakeholderId: i.stakeholderId, answers, npsScore }).returning();
        await tx.update(s.surveyInvites).set({ respondedAt: new Date(), openedAt: i.openedAt ?? new Date() }).where(eq(s.surveyInvites.id, i.id));
        for (const up of updatesFrom(def, answers)) {
          const previous = await previousOf(tx, up.destination, i.stakeholderId);
          const [row] = await tx.insert(s.surveyUpdates).values({ tenantId: i.tenantId, responseId: r!.id, contactId: i.contactId, stakeholderId: i.stakeholderId, destination: up.destination, value: up.value, previous, status: 'pendente' }).returning();
          if (up.mode === 'automatica') { const st = await applyUpdate(tx, row!, i.respondentName, null); await tx.update(s.surveyUpdates).set({ status: st ?? 'aplicada', decidedAt: new Date() }).where(eq(s.surveyUpdates.id, row!.id)); }
        }
        return { tenantId: i.tenantId, contactId: i.contactId, thanks: def.thanks };
      });
      await recomputeAccounts(app.db, out.tenantId, [out.contactId]);
      return { ok: true, thanks: out.thanks };
    },
  }),
];
