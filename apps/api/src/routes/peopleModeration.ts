/**
 * Pessoas & Cultura · Etapa 5 — denúncias e moderação.
 * Fluxo: registro → triagem (assumir) → análise → decisão com justificativa → medida aplicada → aviso → revisão.
 * Não substitui o Canal de Confiança nem o CIEI: casos confidenciais são encaminhados, nunca expostos no feed.
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { AppError, forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { peopleCaps, peopleSettingsOf } from '../services/people/settings';
import { postVisible } from '../services/people/posts';
import { applyMeasure, contentState, MEASURES, REASONS, reportScope, type Measure, type TargetType } from '../services/people/moderation';
import { notifyPeople } from '../services/people/notify';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';

const M = { tag: 'Pessoas & Cultura', module: 'pessoas' as const };
const Id = z.object({ id: z.string().uuid() });
const REVIEW_DAYS = 30;
const LINK = '/pessoas/denuncias';

type Target = { authorId: string; postId: string | null; communityId: string | null; body: string; createdAt: Date | null; kind: string };

/** O que a pessoa pode denunciar é só o que ela consegue ver. */
async function resolveTarget(db: DbOrTx, auth: AuthContext, type: TargetType, id: string): Promise<Target> {
  if (type === 'publicacao') {
    const [p] = await db.select().from(s.peoplePosts).where(and(eq(s.peoplePosts.id, id), postVisible(auth), eq(s.peoplePosts.status, 'publicado'))).limit(1);
    if (!p) throw notFound('Publicação não encontrada.');
    return { authorId: p.authorId, postId: p.id, communityId: p.communityId, body: p.body, createdAt: p.publishedAt, kind: p.kind };
  }
  if (type === 'comentario') {
    const [c] = await db.select().from(s.peopleComments).where(and(eq(s.peopleComments.tenantId, auth.tenantId), eq(s.peopleComments.id, id), eq(s.peopleComments.status, 'publicado'), isNull(s.peopleComments.deletedAt))).limit(1);
    if (!c) throw notFound('Comentário não encontrado.');
    const [p] = await db.select({ id: s.peoplePosts.id, communityId: s.peoplePosts.communityId }).from(s.peoplePosts).where(and(eq(s.peoplePosts.id, c.postId), postVisible(auth))).limit(1);
    if (!p) throw notFound('Comentário não encontrado.');
    return { authorId: c.authorId, postId: p.id, communityId: p.communityId, body: c.body, createdAt: c.createdAt, kind: 'comentario' };
  }
  const [r] = await db.select().from(s.peopleRecognitions).where(and(eq(s.peopleRecognitions.tenantId, auth.tenantId), eq(s.peopleRecognitions.id, id), eq(s.peopleRecognitions.status, 'valido'))).limit(1);
  if (!r) throw notFound('Reconhecimento não encontrado.');
  let communityId: string | null = null;
  if (r.fromUserId !== auth.userId && r.toUserId !== auth.userId) {
    if (r.visibility !== 'publica' || !r.postId) throw notFound('Reconhecimento não encontrado.');
    const [p] = await db.select({ communityId: s.peoplePosts.communityId }).from(s.peoplePosts).where(and(eq(s.peoplePosts.id, r.postId), postVisible(auth))).limit(1);
    if (!p) throw notFound('Reconhecimento não encontrado.');
    communityId = p.communityId;
  }
  return { authorId: r.fromUserId, postId: r.postId, communityId, body: r.message, createdAt: r.createdAt, kind: 'reconhecimento' };
}

async function caps(db: DbOrTx, auth: AuthContext) { return peopleCaps(auth, await peopleSettingsOf(db, auth.tenantId)); }

async function loadForModeration(db: DbOrTx, auth: AuthContext, id: string) {
  const scope = await reportScope(db, auth, await caps(db, auth));
  if (!scope) throw forbidden('Só a moderação trata denúncias.');
  const [r] = await db.select().from(s.peopleReports).where(and(eq(s.peopleReports.tenantId, auth.tenantId), eq(s.peopleReports.id, id), scope)).limit(1);
  if (!r) throw notFound('Denúncia não encontrada.');
  return r;
}

const names = async (db: DbOrTx, ids: (string | null)[]) => {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (!list.length) return new Map<string, string>();
  return new Map((await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, list))).map((u) => [u.id, u.name]));
};

export const peopleModerationRoutes = [
  defineRoute({
    method: 'GET', url: '/pessoas/denuncias/motivos', summary: 'Motivos de denúncia e medidas possíveis', ...M,
    handler: async () => ({ reasons: Object.entries(REASONS).map(([key, label]) => ({ key, label })), measures: Object.entries(MEASURES).map(([key, label]) => ({ key, label })) }),
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/denuncias', summary: 'Denuncia uma publicação, comentário ou reconhecimento', ...M,
    rateLimit: () => ({ max: 10, timeWindow: '1 minute' }),
    body: z.object({ targetType: z.enum(['publicacao', 'comentario', 'reconhecimento']), targetId: z.string().uuid(), reason: z.enum(Object.keys(REASONS) as [keyof typeof REASONS]), details: z.string().trim().max(1000).nullable().default(null) }),
    handler: async ({ app, auth, body, req, reply }) => {
      const t = await resolveTarget(app.db, auth, body.targetType, body.targetId);
      if (t.authorId === auth.userId) throw unprocessable('Não é possível denunciar o próprio conteúdo. Você pode editá-lo ou excluí-lo.');
      if (body.reason === 'outro' && !body.details) throw unprocessable('Conte o motivo da denúncia.', [{ path: 'details', message: 'Obrigatório para "Outros"' }]);
      const [r] = await app.db.insert(s.peopleReports).values({
        tenantId: auth.tenantId, targetType: body.targetType, targetId: body.targetId, postId: t.postId, communityId: t.communityId, authorId: t.authorId, reporterId: auth.userId,
        reason: body.reason, details: body.details, snapshot: { body: t.body.slice(0, 5000), createdAt: t.createdAt?.toISOString() ?? null, kind: t.kind },
      }).onConflictDoNothing().returning({ id: s.peopleReports.id });
      if (!r) throw new AppError(409, 'Já registrado', 'Você já denunciou este conteúdo; a denúncia está com a moderação.');
      await app.db.insert(s.peopleModerationActions).values({ tenantId: auth.tenantId, reportId: r.id, targetType: body.targetType, targetId: body.targetId, action: 'registro', note: REASONS[body.reason], actorId: auth.userId });
      await audit(app.db, req, { action: 'people.report.create', entityType: 'people_report', entityId: r.id, metadata: { targetType: body.targetType, reason: body.reason } });
      reply.code(201);
      return { id: r.id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/denuncias', summary: 'Minhas denúncias e decisões sobre o meu conteúdo (sem revelar quem denunciou)', ...M,
    handler: async ({ app, auth }) => {
      const mine = await app.db.select().from(s.peopleReports).where(and(eq(s.peopleReports.tenantId, auth.tenantId), eq(s.peopleReports.reporterId, auth.userId))).orderBy(desc(s.peopleReports.createdAt)).limit(50);
      // conteúdo meu com medida aplicada (uma linha por conteúdo: a decisão mais recente)
      const about = await app.db.execute<{ id: string; target_type: string; target_id: string; measure: string; justification: string | null; status: string; decided_at: Date; review_requested_at: Date | null; snapshot: { body: string } }>(sql`
        select distinct on (target_type, target_id) id, target_type, target_id, measure, justification, status, decided_at, review_requested_at, snapshot
          from people_reports where tenant_id = ${auth.tenantId} and author_id = ${auth.userId} and decided_at is not null and measure <> 'manter'
         order by target_type, target_id, decided_at desc limit 50`);
      const canReview = (r: { decided_at: Date | null; review_requested_at: Date | null; status: string }) => !!r.decided_at && !r.review_requested_at && r.status === 'decidida' && Date.now() - new Date(r.decided_at).getTime() < REVIEW_DAYS * 86400000;
      return {
        reports: mine.map((r) => ({ id: r.id, targetType: r.targetType, reason: r.reason, reasonLabel: REASONS[r.reason as keyof typeof REASONS], excerpt: r.snapshot.body.slice(0, 200), status: r.status, measure: r.measure, measureLabel: r.measure ? MEASURES[r.measure as Measure] : null, justification: r.decidedAt ? r.justification : null, createdAt: r.createdAt, decidedAt: r.decidedAt, canRequestReview: canReview({ decided_at: r.decidedAt, review_requested_at: r.reviewRequestedAt, status: r.status }) })),
        aboutMe: about.rows.map((r) => ({ id: r.id, targetType: r.target_type, excerpt: r.snapshot.body.slice(0, 200), measure: r.measure, measureLabel: MEASURES[r.measure as Measure], justification: r.justification, status: r.status, decidedAt: r.decided_at, canRequestReview: canReview(r) })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/denuncias/:id/revisao', summary: 'Pede revisão da decisão (quem denunciou ou o autor do conteúdo)', ...M, params: Id,
    body: z.object({ reason: z.string().trim().min(10, 'Explique o motivo do pedido de revisão').max(1000) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [r] = await app.db.select().from(s.peopleReports).where(and(eq(s.peopleReports.tenantId, auth.tenantId), eq(s.peopleReports.id, params.id), or(eq(s.peopleReports.reporterId, auth.userId), eq(s.peopleReports.authorId, auth.userId)))).limit(1);
      if (!r) throw notFound('Denúncia não encontrada.');
      if (r.status !== 'decidida' || !r.decidedAt) throw unprocessable('Só decisões já tomadas podem ser revistas, uma vez.');
      if (Date.now() - r.decidedAt.getTime() > REVIEW_DAYS * 86400000) throw unprocessable(`O prazo de revisão (${REVIEW_DAYS} dias) terminou.`);
      await app.db.update(s.peopleReports).set({ status: 'em_revisao', reviewRequestedBy: auth.userId, reviewRequestedAt: new Date(), reviewReason: body.reason, updatedAt: new Date() }).where(eq(s.peopleReports.id, r.id));
      await app.db.insert(s.peopleModerationActions).values({ tenantId: auth.tenantId, reportId: r.id, targetType: r.targetType, targetId: r.targetId, action: 'pedido_revisao', note: r.authorId === auth.userId ? 'Pedido do autor do conteúdo' : 'Pedido de quem denunciou', actorId: auth.userId });
      await audit(app.db, req, { action: 'people.report.review_request', entityType: 'people_report', entityId: r.id });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ fila da moderação
  defineRoute({
    method: 'GET', url: '/pessoas/moderacao/denuncias', summary: 'Fila de denúncias sob minha responsabilidade', ...M,
    query: z.object({ situacao: z.enum(['pendentes', 'decididas', 'todas']).default('pendentes') }),
    handler: async ({ app, auth, query }) => {
      const scope = await reportScope(app.db, auth, await caps(app.db, auth));
      if (!scope) throw forbidden('Só a moderação trata denúncias.');
      const st = query.situacao === 'pendentes' ? inArray(s.peopleReports.status, ['aberta', 'em_analise', 'em_revisao']) : query.situacao === 'decididas' ? inArray(s.peopleReports.status, ['decidida', 'revisada']) : undefined;
      const rows = await app.db.select().from(s.peopleReports).where(and(eq(s.peopleReports.tenantId, auth.tenantId), scope, st)).orderBy(desc(s.peopleReports.createdAt)).limit(200);
      const n = await names(app.db, rows.flatMap((r) => [r.authorId, r.reporterId, r.assigneeId, r.decidedBy]));
      const comms = [...new Set(rows.map((r) => r.communityId).filter(Boolean) as string[])];
      const cn = comms.length ? new Map((await app.db.select({ id: s.peopleCommunities.id, name: s.peopleCommunities.name }).from(s.peopleCommunities).where(inArray(s.peopleCommunities.id, comms))).map((c) => [c.id, c.name])) : new Map<string, string>();
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(`${r.targetType}:${r.targetId}`, (counts.get(`${r.targetType}:${r.targetId}`) ?? 0) + 1);
      const states = new Map<string, string>();
      for (const k of counts.keys()) { const [tt, ti] = k.split(':') as [TargetType, string]; states.set(k, await contentState(app.db, tt, ti)); }
      return {
        items: rows.map((r) => ({
          id: r.id, targetType: r.targetType, targetId: r.targetId, postId: r.postId, community: r.communityId ? { id: r.communityId, name: cn.get(r.communityId) ?? '' } : null,
          author: { id: r.authorId, name: n.get(r.authorId) ?? '' }, reporter: { id: r.reporterId, name: n.get(r.reporterId) ?? '' },
          reason: r.reason, reasonLabel: REASONS[r.reason as keyof typeof REASONS], details: r.details, snapshot: r.snapshot,
          status: r.status, assignee: r.assigneeId ? { id: r.assigneeId, name: n.get(r.assigneeId) ?? '' } : null,
          measure: r.measure, measureLabel: r.measure ? MEASURES[r.measure as Measure] : null, justification: r.justification, forwardedTo: r.forwardedTo,
          decidedBy: r.decidedBy ? n.get(r.decidedBy) ?? '' : null, decidedAt: r.decidedAt, reviewReason: r.reviewReason, reviewRequestedAt: r.reviewRequestedAt,
          createdAt: r.createdAt, sameTarget: counts.get(`${r.targetType}:${r.targetId}`) ?? 1, contentStatus: states.get(`${r.targetType}:${r.targetId}`),
          conflict: r.authorId === auth.userId || r.reporterId === auth.userId,
        })),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/moderacao/denuncias/:id/historico', summary: 'Trilha da moderação do conteúdo denunciado', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const r = await loadForModeration(app.db, auth, params.id);
      const rows = await app.db.select().from(s.peopleModerationActions).where(and(eq(s.peopleModerationActions.tenantId, auth.tenantId), eq(s.peopleModerationActions.targetType, r.targetType), eq(s.peopleModerationActions.targetId, r.targetId))).orderBy(s.peopleModerationActions.createdAt);
      const n = await names(app.db, rows.map((a) => a.actorId));
      return { items: rows.map((a) => ({ id: a.id, action: a.action, measure: a.measure, measureLabel: a.measure ? MEASURES[a.measure as Measure] : null, note: a.note, actor: n.get(a.actorId) ?? '', at: a.createdAt })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/moderacao/denuncias/:id/assumir', summary: 'Triagem: assume a análise da denúncia', ...M, params: Id,
    handler: async ({ app, auth, params, req }) => {
      const r = await loadForModeration(app.db, auth, params.id);
      if (r.authorId === auth.userId || r.reporterId === auth.userId) throw forbidden('Você está envolvido nesta denúncia: outra pessoa da moderação analisa.');
      if (!['aberta', 'em_analise', 'em_revisao'].includes(r.status)) throw unprocessable('Esta denúncia já foi decidida.');
      await app.db.update(s.peopleReports).set({ assigneeId: auth.userId, status: r.status === 'em_revisao' ? 'em_revisao' : 'em_analise', updatedAt: new Date() }).where(eq(s.peopleReports.id, r.id));
      await app.db.insert(s.peopleModerationActions).values({ tenantId: auth.tenantId, reportId: r.id, targetType: r.targetType, targetId: r.targetId, action: 'triagem', actorId: auth.userId });
      await audit(app.db, req, { action: 'people.report.assign', entityType: 'people_report', entityId: r.id });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/moderacao/denuncias/:id/decisao', summary: 'Decide a denúncia com justificativa e aplica a medida', ...M, params: Id,
    body: z.object({ measure: z.enum(Object.keys(MEASURES) as [Measure]), justification: z.string().trim().min(10, 'Registre a justificativa da decisão').max(2000), forwardedTo: z.string().trim().max(200).nullable().default(null) }),
    handler: async ({ app, auth, params, body, req }) => {
      const r = await loadForModeration(app.db, auth, params.id);
      if (r.authorId === auth.userId || r.reporterId === auth.userId) throw forbidden('Você está envolvido nesta denúncia: outra pessoa da moderação decide.');
      const review = r.status === 'em_revisao';
      if (!['aberta', 'em_analise', 'em_revisao'].includes(r.status)) throw unprocessable('Esta denúncia já foi decidida.');
      if (review && r.decidedBy === auth.userId) throw forbidden('A revisão é feita por outra pessoa da moderação, não por quem decidiu antes.');
      if (body.measure === 'encaminhar' && !body.forwardedTo) throw unprocessable('Informe para onde o caso foi encaminhado.', [{ path: 'forwardedTo', message: 'Obrigatório' }]);
      const now = new Date();
      // a decisão vale para todas as denúncias abertas sobre o mesmo conteúdo
      const affected = await app.db.transaction(async (tx) => {
        const others = review ? [r] : await tx.select().from(s.peopleReports).where(and(eq(s.peopleReports.tenantId, auth.tenantId), eq(s.peopleReports.targetType, r.targetType), eq(s.peopleReports.targetId, r.targetId), inArray(s.peopleReports.status, ['aberta', 'em_analise'])));
        await tx.update(s.peopleReports).set({ status: review ? 'revisada' : 'decidida', measure: body.measure, justification: body.justification, forwardedTo: body.measure === 'encaminhar' ? body.forwardedTo : null, decidedBy: auth.userId, decidedAt: now, assigneeId: auth.userId, updatedAt: now })
          .where(inArray(s.peopleReports.id, others.map((o) => o.id)));
        await applyMeasure(tx, auth.tenantId, r.targetType as TargetType, r.targetId, body.measure);
        await tx.insert(s.peopleModerationActions).values({ tenantId: auth.tenantId, reportId: r.id, targetType: r.targetType, targetId: r.targetId, action: review ? 'revisao' : 'decisao', measure: body.measure, note: body.forwardedTo ? `${body.justification}\nEncaminhado para: ${body.forwardedTo}` : body.justification, actorId: auth.userId });
        return others;
      });
      await audit(app.db, req, { action: review ? 'people.report.review' : 'people.report.decide', entityType: 'people_report', entityId: r.id, metadata: { measure: body.measure, reports: affected.length, targetType: r.targetType } });
      // avisos: quem denunciou sabe que foi analisado; o autor só quando há medida sobre o conteúdo dele (ou na revisão)
      const what = r.targetType === 'publicacao' ? 'sua publicação' : r.targetType === 'comentario' ? 'seu comentário' : 'seu reconhecimento';
      await notifyPeople(app.db, app.config, auth.tenantId, [
        ...affected.map((o) => ({ userId: o.reporterId, event: 'moderacao' as const, title: `Sua denúncia foi ${review ? 'revista' : 'analisada'}: ${MEASURES[body.measure].toLowerCase()}`, link: LINK, actorId: auth.userId, dedupeKey: `moderacao:${o.id}:${review ? 'revisao' : 'decisao'}:reporter` })),
        ...(body.measure !== 'manter' || review ? [{ userId: r.authorId, event: 'moderacao' as const, title: body.measure === 'solicitar_edicao' ? `A moderação pediu que você edite ${what}` : `Moderação: ${MEASURES[body.measure].toLowerCase()} — ${what}`, body: body.justification, link: LINK, actorId: auth.userId, dedupeKey: `moderacao:${r.targetType}:${r.targetId}:${now.getTime()}:author` }] : []),
      ]).catch((e) => console.error('aviso de moderação', e));
      return { ok: true, reports: affected.length };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/moderacao/acao', summary: 'Ação direta da moderação sobre um conteúdo (sem denúncia), com justificativa', ...M,
    body: z.object({ targetType: z.enum(['publicacao', 'comentario']), targetId: z.string().uuid(), measure: z.enum(['manter', 'ocultar', 'remover']), justification: z.string().trim().min(10, 'Registre a justificativa').max(2000) }),
    handler: async ({ app, auth, body, req }) => {
      if (!(await caps(app.db, auth)).moderate) throw forbidden('Só a moderação aplica medidas.');
      // a moderação só age sobre o que consegue ver (conteúdo de comunidade privada só chega a ela por denúncia)
      let authorId: string;
      if (body.targetType === 'publicacao') {
        const [p] = await app.db.select({ authorId: s.peoplePosts.authorId, status: s.peoplePosts.status }).from(s.peoplePosts).where(and(eq(s.peoplePosts.tenantId, auth.tenantId), eq(s.peoplePosts.id, body.targetId), isNull(s.peoplePosts.deletedAt), sql`${s.peoplePosts.status} <> 'rascunho'`, sql`(${s.peoplePosts.audience} = 'organizacao' or exists (select 1 from people_communities c where c.id = ${s.peoplePosts.communityId} and (c.kind <> 'privada' or exists (select 1 from people_community_members m where m.community_id = c.id and m.user_id = ${auth.userId}))))`)).limit(1);
        if (!p) throw notFound('Publicação não encontrada.');
        authorId = p.authorId;
      } else {
        const [c] = await app.db.select({ authorId: s.peopleComments.authorId, postId: s.peopleComments.postId }).from(s.peopleComments).where(and(eq(s.peopleComments.tenantId, auth.tenantId), eq(s.peopleComments.id, body.targetId), isNull(s.peopleComments.deletedAt))).limit(1);
        const [p] = c ? await app.db.select({ id: s.peoplePosts.id }).from(s.peoplePosts).where(and(eq(s.peoplePosts.id, c.postId), sql`(${s.peoplePosts.audience} = 'organizacao' or exists (select 1 from people_communities pc where pc.id = ${s.peoplePosts.communityId} and (pc.kind <> 'privada' or exists (select 1 from people_community_members m where m.community_id = pc.id and m.user_id = ${auth.userId}))))`)).limit(1) : [];
        if (!c || !p) throw notFound('Comentário não encontrado.');
        authorId = c.authorId;
      }
      if (authorId === auth.userId) throw forbidden('Conteúdo seu: outra pessoa da moderação decide.');
      await applyMeasure(app.db, auth.tenantId, body.targetType, body.targetId, body.measure);
      await app.db.insert(s.peopleModerationActions).values({ tenantId: auth.tenantId, targetType: body.targetType, targetId: body.targetId, action: 'acao_direta', measure: body.measure, note: body.justification, actorId: auth.userId });
      await audit(app.db, req, { action: 'people.moderation.direct', entityType: body.targetType === 'publicacao' ? 'people_post' : 'people_comment', entityId: body.targetId, metadata: { measure: body.measure } });
      const what = body.targetType === 'publicacao' ? 'sua publicação' : 'seu comentário';
      await notifyPeople(app.db, app.config, auth.tenantId, [{ userId: authorId, event: 'moderacao', title: body.measure === 'manter' ? `Moderação: ${what} voltou a aparecer` : `Moderação: ${MEASURES[body.measure].toLowerCase()} — ${what}`, body: body.justification, link: LINK, actorId: auth.userId, dedupeKey: `moderacao:${body.targetType}:${body.targetId}:${Date.now()}:author` }]).catch((e) => console.error('aviso de moderação', e));
      return { ok: true };
    },
  }),
];
