/**
 * Pessoas & Gestão · F1 — Feedback situacional (Situação–Comportamento–Impacto).
 *
 * Quem vê o quê (no backend, sempre):
 *  - Descendente (liderança → liderado): quem enviou e quem recebeu. Ninguém acima na hierarquia, nem o RH, nem a
 *    administração técnica lê o conteúdo.
 *  - Ascendente identificado (se a política permitir): quem enviou e a liderança que recebeu.
 *  - Ascendente confidencial: quem enviou e o RH (mediação). A liderança recebe só a síntese que o RH liberar, sem
 *    saber quem enviou. Não gera avaliação automática.
 * Só a liderança vigente envia feedback descendente; só para a própria liderança vigente vai o ascendente.
 * Notificações e eventos não levam o conteúdo — só o link autenticado.
 */
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { peopleCaps, peopleSettingsOf } from '../services/people/settings';
import { institutionalOf, publicCard } from '../services/people/profiles';
import { managersOf, reportsOf, syncReportingLines } from '../services/people/reporting';
import { currentDevPolicy, DevPolicyConfig, FEEDBACK_MODALITIES, type FeedbackModality } from '../services/people/devPolicy';
import { emitDomainEvent } from '../services/domainEvents';
import { notifyPeople } from '../services/people/notify';
import { todayIn } from '../services/vacations';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';

const M = { tag: 'Pessoas & Gestão', module: 'pessoas' as const };
const Id = z.object({ id: z.string().uuid() });
type Fb = typeof s.peopleFeedbacks.$inferSelect;
const LINK = (id: string) => `/pessoas/desenvolvimento/feedbacks/${id}`;

async function capsOf(db: DbOrTx, auth: AuthContext) { return peopleCaps(auth, await peopleSettingsOf(db, auth.tenantId)); }

/** Papel de quem consulta em relação ao feedback (ou null = sem acesso). */
function roleIn(f: Fb, auth: AuthContext, hr: boolean): 'remetente' | 'destinatario' | 'rh' | null {
  if (f.senderId === auth.userId) return 'remetente';
  if (f.status === 'rascunho') return null;
  if (f.recipientId === auth.userId) {
    if (f.direction === 'ascendente' && f.mode === 'confidencial') return f.status === 'repassado' ? 'destinatario' : null;
    return 'destinatario';
  }
  if (hr && f.direction === 'ascendente' && f.mode === 'confidencial') return 'rh';
  return null;
}

async function dto(db: DbOrTx, auth: AuthContext, rows: Fb[], hr: boolean, withHistory = false) {
  const people = await institutionalOf(db, auth.tenantId, rows.flatMap((r) => [r.senderId, r.recipientId, r.mediatorId].filter(Boolean) as string[]));
  const card = (id: string | null) => (id && people.get(id) ? publicCard(people.get(id)!) : null);
  const events = withHistory && rows.length ? await db.select().from(s.peopleFeedbackEvents).where(inArray(s.peopleFeedbackEvents.feedbackId, rows.map((r) => r.id))).orderBy(s.peopleFeedbackEvents.createdAt) : [];
  return rows.map((f) => {
    const role = roleIn(f, auth, hr)!;
    const synthesisOnly = role === 'destinatario' && f.mode === 'confidencial';
    const base = {
      id: f.id, direction: f.direction, modality: f.modality, modalityLabel: FEEDBACK_MODALITIES[f.modality as FeedbackModality], mode: f.mode, status: f.status,
      occurredOn: f.occurredOn, sentAt: f.sentAt, createdAt: f.createdAt, acknowledgedAt: f.acknowledgedAt, response: f.response, respondedAt: f.respondedAt,
      myRole: role, recipient: card(f.recipientId),
      // no confidencial, a liderança nunca sabe quem enviou
      sender: synthesisOnly ? null : card(f.senderId),
      mediatedAt: f.mediatedAt, mediationNote: role === 'destinatario' ? null : f.mediationNote,
    };
    if (synthesisOnly) return { ...base, synthesis: f.synthesis, situation: null, behavior: null, impact: null, guidance: null, nextSteps: null, history: [] };
    return {
      ...base, situation: f.situation, behavior: f.behavior, impact: f.impact, guidance: f.guidance, nextSteps: f.nextSteps, synthesis: f.synthesis,
      // o histórico mostra quem fez o quê — exceto para a liderança no confidencial (filtrado acima)
      history: events.filter((e) => e.feedbackId === f.id).map((e) => ({ type: e.type, at: e.createdAt, actor: card(e.actorId)?.name ?? '', note: e.note })),
    };
  });
}

async function hrUserIds(db: DbOrTx, tenantId: string) {
  const st = await peopleSettingsOf(db, tenantId);
  if (!st.roles.pessoasCultura.length) return [];
  const rows = await db.execute<{ id: string }>(sql`select id from users where tenant_id = ${tenantId} and active and sectors && ${sql`array[${sql.join(st.roles.pessoasCultura.map((k) => sql`${k}`), sql`, `)}]::text[]`}`);
  return rows.rows.map((r) => r.id);
}

const FeedbackBody = z.object({
  recipientId: z.string().uuid(),
  modality: z.enum(Object.keys(FEEDBACK_MODALITIES) as [FeedbackModality]),
  mode: z.enum(['identificado', 'confidencial']).default('identificado'),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data do acontecimento'),
  situation: z.string().trim().max(2000),
  behavior: z.string().trim().max(2000),
  impact: z.string().trim().max(2000),
  guidance: z.string().trim().max(2000).nullable().default(null),
  nextSteps: z.string().trim().max(2000).nullable().default(null),
  send: z.boolean().default(false),
});

/** Direção pelo vínculo vigente; modo pela política. */
async function resolveDirection(db: DbOrTx, auth: AuthContext, recipientId: string, mode: 'identificado' | 'confidencial') {
  await syncReportingLines(db, auth.tenantId);
  const policy = await currentDevPolicy(db, auth.tenantId);
  if ((await reportsOf(db, auth.tenantId, auth.userId)).includes(recipientId)) return { direction: 'descendente' as const, mode: 'identificado' as const, policy };
  if ((await managersOf(db, auth.tenantId, auth.userId)).includes(recipientId)) {
    if (!policy.config.feedback.ascendingModes.includes(mode)) throw unprocessable(mode === 'identificado' ? 'A política da empresa pede que o feedback para a liderança seja confidencial (mediado pelo RH).' : 'A política da empresa não prevê feedback confidencial para a liderança.');
    return { direction: 'ascendente' as const, mode, policy };
  }
  throw unprocessable('Você só registra feedback para seus liderados ou para a sua liderança atual.');
}

function validateContent(b: { situation: string; behavior: string; impact: string; modality: FeedbackModality }, policy: DevPolicyConfig, sending: boolean) {
  if (!policy.feedback.modalities.includes(b.modality)) throw unprocessable('Modalidade não disponível na política vigente.');
  if (!sending) return;
  const min = policy.feedback.minChars;
  const errors = (['situation', 'behavior', 'impact'] as const).filter((k) => b[k].length < min).map((k) => ({ path: k, message: `Descreva com pelo menos ${min} caracteres` }));
  if (errors.length) throw unprocessable('Descreva a situação, o comportamento observado e o impacto (sem registros genéricos).', errors);
}

/** Envio: muda o estado, registra histórico e evento, avisa sem conteúdo. */
async function sendFeedback(db: DbOrTx, app: { config: Parameters<typeof notifyPeople>[1] }, auth: AuthContext, f: Fb) {
  const confidential = f.direction === 'ascendente' && f.mode === 'confidencial';
  const now = new Date();
  await db.update(s.peopleFeedbacks).set({ status: confidential ? 'em_mediacao' : 'enviado', sentAt: now, updatedAt: now }).where(eq(s.peopleFeedbacks.id, f.id));
  await db.insert(s.peopleFeedbackEvents).values({ tenantId: auth.tenantId, feedbackId: f.id, type: confidential ? 'enviado_ao_rh' : 'enviado', actorId: auth.userId });
  await emitDomainEvent(db, { tenantId: auth.tenantId, type: 'feedback.sent', entityType: 'feedback', entityId: f.id, source: 'pessoas', idemKey: `feedback.sent:${f.id}`, payload: { direction: f.direction, mode: f.mode, modality: f.modality } });
  if (confidential) {
    const hr = (await hrUserIds(db, auth.tenantId)).filter((u) => u !== auth.userId && u !== f.recipientId);
    await notifyPeople(db, app.config, auth.tenantId, hr.map((u) => ({ userId: u, event: 'feedback_mediacao' as const, title: 'Novo feedback confidencial para mediação', link: LINK(f.id), actorId: null, dedupeKey: `feedback:${f.id}:mediacao` })));
  } else {
    await notifyPeople(db, app.config, auth.tenantId, [{ userId: f.recipientId, event: 'feedback' as const, title: f.direction === 'descendente' ? `${auth.name.split(' ')[0]} registrou um feedback para você` : `Você recebeu um feedback de ${auth.name.split(' ')[0]}`, link: LINK(f.id), actorId: auth.userId, dedupeKey: `feedback:${f.id}:recebido` }]);
  }
}

export const peopleDevelopmentRoutes = [
  defineRoute({
    method: 'GET', url: '/pessoas/desenvolvimento/contexto', summary: 'Meus liderados e minhas lideranças vigentes, a política vigente e o que posso fazer', ...M,
    handler: async ({ app, auth }) => {
      await syncReportingLines(app.db, auth.tenantId);
      const [reports, managers, policy, caps] = await Promise.all([reportsOf(app.db, auth.tenantId, auth.userId), managersOf(app.db, auth.tenantId, auth.userId), currentDevPolicy(app.db, auth.tenantId), capsOf(app.db, auth)]);
      const people = await institutionalOf(app.db, auth.tenantId, [...reports, ...managers]);
      const cards = (ids: string[]) => ids.map((i) => people.get(i)).filter(Boolean).map((p) => publicCard(p!)).sort((a, b) => a.name.localeCompare(b.name));
      return { reports: cards(reports), managers: cards(managers), policy: { version: policy.version, ...policy.config }, modalities: FEEDBACK_MODALITIES, hr: caps.hr };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/desenvolvimento/politica', summary: 'Política de desenvolvimento vigente e versões anteriores (RH)', ...M,
    handler: async ({ app, auth }) => {
      const caps = await capsOf(app.db, auth);
      const cur = await currentDevPolicy(app.db, auth.tenantId);
      const versions = caps.hr ? await app.db.select({ version: s.devPolicies.version, note: s.devPolicies.note, effectiveFrom: s.devPolicies.effectiveFrom, by: s.users.name }).from(s.devPolicies).leftJoin(s.users, eq(s.users.id, s.devPolicies.createdBy)).where(eq(s.devPolicies.tenantId, auth.tenantId)).orderBy(desc(s.devPolicies.version)) : [];
      return { ...cur, versions, canEdit: caps.hr };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/pessoas/desenvolvimento/politica', summary: 'Publica nova versão da política (RH); a anterior fica no histórico', ...M,
    body: z.object({ config: DevPolicyConfig, note: z.string().trim().min(3, 'Diga o que mudou').max(500) }),
    handler: async ({ app, auth, body, req }) => {
      if (!(await capsOf(app.db, auth)).hr) throw forbidden('Só o RH (setor de Pessoas e Cultura) altera a política.');
      const cur = await currentDevPolicy(app.db, auth.tenantId);
      const [p] = await app.db.insert(s.devPolicies).values({ tenantId: auth.tenantId, version: cur.version + 1, config: body.config, note: body.note, createdBy: auth.userId }).returning();
      await audit(app.db, req, { action: 'dev.policy.publish', entityType: 'dev_policy', entityId: p!.id, metadata: { version: p!.version, note: body.note } });
      await emitDomainEvent(app.db, { tenantId: auth.tenantId, type: 'dev_policy.published', entityType: 'dev_policy', entityId: p!.id, source: 'pessoas', idemKey: `dev_policy:${p!.version}`, payload: { version: p!.version } });
      return { version: p!.version };
    },
  }),

  defineRoute({
    method: 'GET', url: '/pessoas/desenvolvimento/feedbacks', summary: 'Feedbacks recebidos, enviados ou em mediação (RH)', ...M,
    query: z.object({ caixa: z.enum(['recebidos', 'enviados', 'mediacao']).default('recebidos') }),
    handler: async ({ app, auth, query }) => {
      const caps = await capsOf(app.db, auth);
      const F = s.peopleFeedbacks;
      let where;
      if (query.caixa === 'enviados') where = and(eq(F.tenantId, auth.tenantId), eq(F.senderId, auth.userId));
      else if (query.caixa === 'recebidos') where = and(eq(F.tenantId, auth.tenantId), eq(F.recipientId, auth.userId), ne(F.status, 'rascunho'), or(eq(F.mode, 'identificado'), eq(F.direction, 'descendente'), eq(F.status, 'repassado')));
      else {
        if (!caps.hr) throw forbidden('Só o RH faz a mediação.');
        where = and(eq(F.tenantId, auth.tenantId), eq(F.direction, 'ascendente'), eq(F.mode, 'confidencial'), ne(F.status, 'rascunho'), ne(F.senderId, auth.userId));
      }
      const rows = await app.db.select().from(F).where(where).orderBy(desc(sql`coalesce(${F.sentAt}, ${F.createdAt})`)).limit(200);
      return { items: await dto(app.db, auth, rows.filter((r) => roleIn(r, auth, caps.hr)), caps.hr) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/desenvolvimento/feedbacks/:id', summary: 'Feedback com o histórico (conforme o papel de quem consulta)', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const caps = await capsOf(app.db, auth);
      const [f] = await app.db.select().from(s.peopleFeedbacks).where(and(eq(s.peopleFeedbacks.tenantId, auth.tenantId), eq(s.peopleFeedbacks.id, params.id))).limit(1);
      if (!f || !roleIn(f, auth, caps.hr)) throw notFound('Feedback não encontrado.');
      return (await dto(app.db, auth, [f], caps.hr, true))[0];
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/desenvolvimento/feedbacks', summary: 'Registra feedback (rascunho ou enviado) para liderado ou para a liderança', ...M,
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }), body: FeedbackBody,
    handler: async ({ app, auth, body, req, reply }) => {
      const { direction, mode, policy } = await resolveDirection(app.db, auth, body.recipientId, body.mode);
      validateContent(body, policy.config, body.send);
      if (body.occurredOn > todayIn(auth.timezone)) throw unprocessable('A data do acontecimento não pode ser no futuro.', [{ path: 'occurredOn', message: 'Data futura' }]);
      const f = await app.db.transaction(async (tx) => {
        const [f] = await tx.insert(s.peopleFeedbacks).values({
          tenantId: auth.tenantId, senderId: auth.userId, recipientId: body.recipientId, direction, mode, modality: body.modality, occurredOn: body.occurredOn,
          situation: body.situation, behavior: body.behavior, impact: body.impact, guidance: body.guidance, nextSteps: body.nextSteps, policyVersion: policy.version,
        }).returning();
        await tx.insert(s.peopleFeedbackEvents).values({ tenantId: auth.tenantId, feedbackId: f!.id, type: 'criado', actorId: auth.userId });
        if (body.send) await sendFeedback(tx, app, auth, f!);
        return f!;
      });
      await audit(app.db, req, { action: body.send ? 'dev.feedback.send' : 'dev.feedback.draft', entityType: 'people_feedback', entityId: f.id, metadata: { direction, mode, modality: body.modality } });
      reply.code(201);
      return { id: f.id, direction, mode, status: body.send ? (direction === 'ascendente' && mode === 'confidencial' ? 'em_mediacao' : 'enviado') : 'rascunho' };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/pessoas/desenvolvimento/feedbacks/:id', summary: 'Edita o rascunho (e envia, se pedido)', ...M, params: Id, body: FeedbackBody,
    handler: async ({ app, auth, params, body, req }) => {
      const [cur] = await app.db.select().from(s.peopleFeedbacks).where(and(eq(s.peopleFeedbacks.tenantId, auth.tenantId), eq(s.peopleFeedbacks.id, params.id), eq(s.peopleFeedbacks.senderId, auth.userId))).limit(1);
      if (!cur) throw notFound('Feedback não encontrado.');
      if (cur.status !== 'rascunho') throw unprocessable('Feedback enviado não se edita: fica como registro. Se precisar complementar, registre um novo.');
      const { direction, mode, policy } = await resolveDirection(app.db, auth, body.recipientId, body.mode);
      validateContent(body, policy.config, body.send);
      await app.db.transaction(async (tx) => {
        const [f] = await tx.update(s.peopleFeedbacks).set({ recipientId: body.recipientId, direction, mode, modality: body.modality, occurredOn: body.occurredOn, situation: body.situation, behavior: body.behavior, impact: body.impact, guidance: body.guidance, nextSteps: body.nextSteps, policyVersion: policy.version, updatedAt: new Date() }).where(eq(s.peopleFeedbacks.id, cur.id)).returning();
        if (body.send) await sendFeedback(tx, app, auth, f!);
      });
      if (body.send) await audit(app.db, req, { action: 'dev.feedback.send', entityType: 'people_feedback', entityId: cur.id, metadata: { direction, mode } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/pessoas/desenvolvimento/feedbacks/:id', summary: 'Descarta o rascunho', ...M, params: Id,
    handler: async ({ app, auth, params, reply }) => {
      const r = await app.db.delete(s.peopleFeedbacks).where(and(eq(s.peopleFeedbacks.tenantId, auth.tenantId), eq(s.peopleFeedbacks.id, params.id), eq(s.peopleFeedbacks.senderId, auth.userId), eq(s.peopleFeedbacks.status, 'rascunho'))).returning({ id: s.peopleFeedbacks.id });
      if (!r.length) throw notFound('Rascunho não encontrado.');
      return reply.code(204).send();
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/desenvolvimento/feedbacks/:id/ciencia', summary: 'Ciência do destinatário (não é concordância), com manifestação opcional', ...M, params: Id,
    body: z.object({ response: z.string().trim().max(2000).nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [f] = await app.db.select().from(s.peopleFeedbacks).where(and(eq(s.peopleFeedbacks.tenantId, auth.tenantId), eq(s.peopleFeedbacks.id, params.id), eq(s.peopleFeedbacks.recipientId, auth.userId))).limit(1);
      if (!f || !roleIn(f, auth, false)) throw notFound('Feedback não encontrado.');
      if (!['enviado', 'repassado', 'ciente'].includes(f.status)) throw unprocessable('Este feedback não aguarda ciência.');
      if (f.status === 'ciente' && (f.response || !body.response)) throw unprocessable('A ciência já foi registrada.');
      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx.update(s.peopleFeedbacks).set({
          ...(f.status !== 'ciente' ? { acknowledgedAt: now, status: f.status === 'repassado' ? 'repassado' : 'ciente' } : {}),
          ...(body.response ? { response: body.response, respondedAt: now } : {}), updatedAt: now,
        }).where(eq(s.peopleFeedbacks.id, f.id));
        if (f.status !== 'ciente' && !f.acknowledgedAt) await tx.insert(s.peopleFeedbackEvents).values({ tenantId: auth.tenantId, feedbackId: f.id, type: 'ciencia', actorId: auth.userId });
        if (body.response) await tx.insert(s.peopleFeedbackEvents).values({ tenantId: auth.tenantId, feedbackId: f.id, type: 'manifestacao', actorId: auth.userId });
        await emitDomainEvent(tx, { tenantId: auth.tenantId, type: 'feedback.acknowledged', entityType: 'feedback', entityId: f.id, source: 'pessoas', idemKey: `feedback.ack:${f.id}`, payload: { withResponse: !!body.response } });
      });
      await audit(app.db, req, { action: 'dev.feedback.ack', entityType: 'people_feedback', entityId: f.id, metadata: { response: !!body.response } });
      // quem enviou sabe que houve ciência (no confidencial, quem enviou continua anônimo para a liderança)
      if (f.mode === 'identificado' || f.direction === 'descendente') await notifyPeople(app.db, app.config, auth.tenantId, [{ userId: f.senderId, event: 'feedback_ciencia', title: body.response ? `${auth.name.split(' ')[0]} registrou ciência e uma manifestação no seu feedback` : `${auth.name.split(' ')[0]} registrou ciência do seu feedback`, link: LINK(f.id), actorId: auth.userId, dedupeKey: `feedback:${f.id}:ciencia:${body.response ? 'm' : 'c'}` }]).catch(() => undefined);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/desenvolvimento/feedbacks/:id/mediacao', summary: 'RH: repassa uma síntese à liderança (sem identificar quem enviou) ou trata sem repasse', ...M, params: Id,
    body: z.object({ action: z.enum(['repassar', 'tratar_sem_repasse']), synthesis: z.string().trim().max(2000).nullable().default(null), note: z.string().trim().min(10, 'Registre a justificativa da mediação').max(2000) }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!(await capsOf(app.db, auth)).hr) throw forbidden('Só o RH faz a mediação.');
      const [f] = await app.db.select().from(s.peopleFeedbacks).where(and(eq(s.peopleFeedbacks.tenantId, auth.tenantId), eq(s.peopleFeedbacks.id, params.id), eq(s.peopleFeedbacks.direction, 'ascendente'), eq(s.peopleFeedbacks.mode, 'confidencial'))).limit(1);
      if (!f) throw notFound('Feedback não encontrado.');
      if (f.senderId === auth.userId || f.recipientId === auth.userId) throw forbidden('Você está envolvido neste feedback: outra pessoa do RH faz a mediação.');
      if (f.status !== 'em_mediacao') throw unprocessable('Este feedback não está em mediação.');
      if (body.action === 'repassar' && (!body.synthesis || body.synthesis.length < 20)) throw unprocessable('Escreva a síntese que a liderança vai receber (sem identificar quem enviou).', [{ path: 'synthesis', message: 'Obrigatória' }]);
      const now = new Date();
      await app.db.transaction(async (tx) => {
        await tx.update(s.peopleFeedbacks).set({ status: body.action === 'repassar' ? 'repassado' : 'tratado_sem_repasse', mediatorId: auth.userId, synthesis: body.action === 'repassar' ? body.synthesis : null, mediationNote: body.note, mediatedAt: now, updatedAt: now }).where(eq(s.peopleFeedbacks.id, f.id));
        await tx.insert(s.peopleFeedbackEvents).values({ tenantId: auth.tenantId, feedbackId: f.id, type: body.action === 'repassar' ? 'repassado' : 'tratado_sem_repasse', actorId: auth.userId, note: body.note });
        await emitDomainEvent(tx, { tenantId: auth.tenantId, type: 'feedback.mediated', entityType: 'feedback', entityId: f.id, source: 'pessoas', idemKey: `feedback.mediated:${f.id}`, payload: { action: body.action } });
      });
      await audit(app.db, req, { action: 'dev.feedback.mediate', entityType: 'people_feedback', entityId: f.id, metadata: { action: body.action } });
      await notifyPeople(app.db, app.config, auth.tenantId, [
        { userId: f.senderId, event: 'feedback_mediacao', title: body.action === 'repassar' ? 'O RH repassou uma síntese do seu feedback à liderança' : 'O RH concluiu a mediação do seu feedback', link: LINK(f.id), actorId: null, dedupeKey: `feedback:${f.id}:mediado:remetente` },
        ...(body.action === 'repassar' ? [{ userId: f.recipientId, event: 'feedback' as const, title: 'Você recebeu uma devolutiva do seu time, mediada pelo RH', link: LINK(f.id), actorId: null, dedupeKey: `feedback:${f.id}:recebido` }] : []),
      ]).catch(() => undefined);
      return { ok: true };
    },
  }),
];

