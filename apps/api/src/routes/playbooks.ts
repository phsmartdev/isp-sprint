import { ensureTeamCostCenters } from '../services/budget';
/**
 * Central de Playbooks: biblioteca (busca, "para você", categorias, filtros), leitura (progresso, favoritos, ciência, sugestões),
 * editor de rascunhos (salvamento com controle de concorrência), aprovação Gerência → Diretoria, versões (histórico, comparação,
 * restauração, publicação programada), revisões, suspensão, arquivos e indicadores. Toda permissão é conferida aqui.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  PLAYBOOK_TYPES, REVIEW_PERIODS, SUGGESTION_STATUSES, VISIBILITIES, approvalStagesFor, audienceErrors, contentErrors, contentText,
  BUSINESS_EVENT_TYPES, levelFor, diffContent, nextVersion, playbookCode, reviewState, sectionsOf, type PlaybookContent, type VersionStatus,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { canCreate, canEditPb, ensurePlaybookJobs, ensurePlaybookSetup, isDirector, isManager, publishVersion, readerAllows, viewerOf, type PlaybookMeta } from '../services/playbooks';
import { leadsOrManages, todayIn, vacationOrg } from '../services/vacations';
import { detectAttachment } from './sprint';
import { gamificationSettingsOf } from '../services/gamification';

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const A = { tag: 'Playbooks', anyAuthenticated: true as const };
const OPEN: VersionStatus[] = ['rascunho', 'revisao_gerencia', 'homologacao_diretoria', 'aprovada'];

const Meta = z.object({
  title: z.string().trim().min(3).max(160), description: z.string().trim().min(3).max(1000), keywords: z.array(z.string().trim().max(40)).max(20).default([]),
  type: z.enum(PLAYBOOK_TYPES), criticality: z.enum(['baixa', 'media', 'alta']).default('media'),
  ownerTeamId: uuid.nullable(), costCenterId: uuid.nullable(), maintainerId: uuid.nullable(),
  visibility: z.enum(VISIBILITIES), teamIds: z.array(uuid).max(100).default([]), costCenterIds: z.array(uuid).max(100).default([]),
  profiles: z.array(z.string().max(30)).max(10).default([]), userIds: z.array(uuid).max(500).default([]),
  reviewPeriod: z.enum(REVIEW_PERIODS), reviewCustomDays: z.number().int().min(7).max(1095).nullable().default(null), nextReviewOn: day.nullable().default(null),
  requiresAck: z.boolean().default(false), contexts: z.array(z.string().trim().max(60)).max(20).default([]),
});
/** Blocos chegam como JSON e passam pela checagem de integridade do domínio (tipos, ids, links seguros). */
const Content = z.object({ blocks: z.array(z.record(z.unknown())).max(400) });
const checkContent = (c: unknown) => { const e = contentErrors(c as PlaybookContent); if (e.length) throw unprocessable(e.slice(0, 5).join(' ')); return c as PlaybookContent; };
const checkMeta = async (db: DbOrTx, auth: AuthContext, m: z.infer<typeof Meta>) => {
  const e = audienceErrors(m);
  if (m.reviewPeriod === 'personalizada' && !m.reviewCustomDays) e.push('Periodicidade personalizada: informe a quantidade de dias.');
  if (e.length) throw unprocessable(e.join(' '));
  const ids = [m.ownerTeamId, ...m.teamIds].filter((x): x is string => !!x);
  if (ids.length) { const ok = await db.select({ id: s.teams.id }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), inArray(s.teams.id, ids))); if (ok.length !== new Set(ids).size) throw unprocessable('Time não encontrado.'); }
  const cc = [m.costCenterId, ...m.costCenterIds].filter((x): x is string => !!x);
  if (cc.length) { const ok = await db.select({ id: s.costCenters.id }).from(s.costCenters).where(and(eq(s.costCenters.tenantId, auth.tenantId), inArray(s.costCenters.id, cc))); if (ok.length !== new Set(cc).size) throw unprocessable('Centro de custo não encontrado.'); }
  const us = [m.maintainerId, ...m.userIds].filter((x): x is string => !!x);
  if (us.length) { const ok = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, us))); if (ok.length !== new Set(us).size) throw unprocessable('Pessoa não encontrada.'); }
};

async function loadPb(db: DbOrTx, auth: AuthContext, id: string) {
  const [p] = await db.select().from(s.playbooks).where(and(eq(s.playbooks.id, id), eq(s.playbooks.tenantId, auth.tenantId)));
  if (!p) throw notFound('Playbook não encontrado.');
  return p;
}
async function loadVersion(db: DbOrTx, auth: AuthContext, id: string) {
  const [v] = await db.select().from(s.playbookVersions).where(and(eq(s.playbookVersions.id, id), eq(s.playbookVersions.tenantId, auth.tenantId)));
  if (!v) throw notFound('Versão não encontrada.');
  return v;
}
/** Quem decide cada etapa: Gerência (perfil Gerência; de preferência quem gere o time dono) e Diretoria. Ninguém aprova o que enviou. */
async function decides(db: DbOrTx, auth: AuthContext, stage: string, p: typeof s.playbooks.$inferSelect, v: typeof s.playbookVersions.$inferSelect) {
  if (v.submittedBy === auth.userId || v.authorId === auth.userId) return false;
  if (stage === 'diretoria') return isDirector(auth);
  if (stage === 'gerencia') {
    if (!isManager(auth)) return false;
    const team = (v.meta as unknown as PlaybookMeta).ownerTeamId ?? p.ownerTeamId;
    // a Gerência responsável pelo time dono decide; sem gestor definido no time, qualquer Gerência
    if (!team) return true;
    const org = await vacationOrg(db, auth.tenantId);
    return leadsOrManages(org, team, auth.userId) || !(org.managers[team] ?? []).length;
  }
  return false;
}
const stageOf = (st: string) => (st === 'revisao_gerencia' ? 'gerencia' : st === 'homologacao_diretoria' ? 'diretoria' : null);
async function ev(db: DbOrTx, auth: AuthContext, playbookId: string, versionId: string | null, type: string, note: string | null, notify: (string | null | undefined)[] = [], title?: string) {
  await db.insert(s.playbookEvents).values({ tenantId: auth.tenantId, playbookId, versionId, type, note, actorId: auth.userId });
  const to = [...new Set(notify.filter((x): x is string => !!x && x !== auth.userId))];
  if (to.length) await db.insert(s.governanceEvents).values({ tenantId: auth.tenantId, entity: 'playbook', entityId: playbookId, type, notify: to, payload: { title: title ?? note ?? '' }, actorId: auth.userId });
}
async function usersWith(db: DbOrTx, tenantId: string, profiles: string[]) {
  const r = await db.execute<{ id: string }>(sql`select distinct u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where u.tenant_id = ${tenantId} and u.active and r.key in ${profiles}`);
  return r.rows.map((x) => x.id);
}

/** Cartão da biblioteca. */
async function cards(db: DbOrTx, auth: AuthContext, rows: (typeof s.playbooks.$inferSelect)[]) {
  if (!rows.length) return [];
  const [cats, teams, ccs, users, vers, favs, reads] = await Promise.all([
    db.select().from(s.playbookCategories).where(eq(s.playbookCategories.tenantId, auth.tenantId)),
    db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(eq(s.teams.tenantId, auth.tenantId)),
    db.select({ id: s.costCenters.id, code: s.costCenters.code, name: s.costCenters.name }).from(s.costCenters).where(eq(s.costCenters.tenantId, auth.tenantId)),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId)),
    db.select({ id: s.playbookVersions.id, playbookId: s.playbookVersions.playbookId, number: s.playbookVersions.number, status: s.playbookVersions.status, publishedAt: s.playbookVersions.publishedAt, type: sql<string>`${s.playbookVersions.meta}->>'type'` })
      .from(s.playbookVersions).where(and(inArray(s.playbookVersions.playbookId, rows.map((r) => r.id)), inArray(s.playbookVersions.status, ['vigente', ...OPEN]))),
    db.select({ id: s.playbookFavorites.playbookId }).from(s.playbookFavorites).where(eq(s.playbookFavorites.userId, auth.userId)),
    db.select({ id: s.playbookReads.playbookId, lastAt: s.playbookReads.lastAt, versionId: s.playbookReads.versionId }).from(s.playbookReads).where(eq(s.playbookReads.userId, auth.userId)),
  ]);
  const today = todayIn(auth.timezone);
  return rows.map((p) => {
    const live = vers.find((v) => v.playbookId === p.id && v.status === 'vigente');
    const open = vers.find((v) => v.playbookId === p.id && OPEN.includes(v.status as VersionStatus));
    const cat = cats.find((c) => c.id === p.categoryId);
    const cc = ccs.find((c) => c.id === p.costCenterId);
    const read = reads.find((r) => r.id === p.id);
    const published = live?.publishedAt ? live.publishedAt.toISOString().slice(0, 10) : null;
    return {
      id: p.id, code: p.code, title: p.title, description: p.description, status: p.status,
      category: cat ? { id: cat.id, name: cat.name, icon: cat.icon } : null,
      team: teams.find((t) => t.id === p.ownerTeamId)?.name ?? null, costCenter: cc ? `${cc.code} · ${cc.name}` : null, maintainer: users.find((u) => u.id === p.maintainerId)?.name ?? null,
      version: live?.number ?? null, openVersion: open ? { number: open.number, status: open.status } : null, type: live?.type ?? null,
      updatedOn: published, recent: !!published && Date.parse(`${today}T12:00:00Z`) - Date.parse(`${published}T12:00:00Z`) <= 15 * 86_400_000,
      unreadUpdate: !!read && !!live && read.versionId !== live.id,
      favorite: favs.some((f) => f.id === p.id), lastReadAt: read?.lastAt ?? null,
      review: reviewState(p.nextReviewOn, today, (open?.status as VersionStatus) ?? null), nextReviewOn: p.nextReviewOn,
    };
  });
}

/** Playbooks que a pessoa pode ler (vigentes) + os que ela edita ou aprova (mesmo sem vigente). */
async function visibleRows(db: DbOrTx, auth: AuthContext) {
  const all = await db.select().from(s.playbooks).where(eq(s.playbooks.tenantId, auth.tenantId)).orderBy(asc(s.playbooks.title));
  const v = await viewerOf(db, auth);
  const manage = isDirector(auth) || isManager(auth);
  const org = await vacationOrg(db, auth.tenantId);
  const edits = (p: (typeof all)[number]) => manage || [p.maintainerId, p.createdBy].includes(auth.userId) || (!!p.ownerTeamId && leadsOrManages(org, p.ownerTeamId, auth.userId));
  return { read: all.filter((p) => readerAllows(p, v)), editable: all.filter(edits), viewer: v };
}

export const playbookCentralRoutes = [
  // ------------------------------------------------------------------ biblioteca
  defineRoute({
    method: 'GET', url: '/playbooks', summary: 'Biblioteca: para você, categorias e cartões autorizados (busca por título, descrição, palavras-chave, categoria, time, centro e texto)', ...A,
    query: z.object({
      q: z.string().trim().max(120).optional(), categoryId: uuid.optional(), teamId: uuid.optional(), costCenterId: uuid.optional(), type: z.enum(PLAYBOOK_TYPES).optional(),
      maintainerId: uuid.optional(), updatedFrom: day.optional(), scope: z.enum(['todos', 'favoritos', 'meus']).default('todos'),
    }),
    handler: async ({ app, auth, query }) => {
      await ensurePlaybookSetup(app.db, auth.tenantId);
      await ensurePlaybookJobs(app.db, auth.tenantId, auth.timezone);
      const { read, editable, viewer } = await visibleRows(app.db, auth);
      const ids = new Set([...read, ...(query.scope === 'meus' ? editable : [])].map((p) => p.id));
      let rows = [...new Map([...read, ...editable].map((p) => [p.id, p])).values()].filter((p) => ids.has(p.id));
      if (query.scope === 'meus') rows = editable;
      if (query.categoryId) rows = rows.filter((p) => p.categoryId === query.categoryId);
      if (query.teamId) rows = rows.filter((p) => p.ownerTeamId === query.teamId || p.teamIds.includes(query.teamId!));
      if (query.costCenterId) rows = rows.filter((p) => p.costCenterId === query.costCenterId || p.costCenterIds.includes(query.costCenterId!));
      if (query.maintainerId) rows = rows.filter((p) => p.maintainerId === query.maintainerId);
      let list = await cards(app.db, auth, rows);
      if (query.type) list = list.filter((c) => c.type === query.type);
      if (query.updatedFrom) list = list.filter((c) => c.updatedOn && c.updatedOn >= query.updatedFrom!);
      if (query.scope === 'favoritos') list = list.filter((c) => c.favorite);
      if (query.q) {
        const q = `%${query.q.replace(/[%_]/g, '')}%`;
        const pids = list.map((c) => c.id);
        const hits = pids.length ? await app.db.select({ id: s.playbooks.id }).from(s.playbooks)
          .leftJoin(s.playbookVersions, eq(s.playbookVersions.id, s.playbooks.currentVersionId))
          .leftJoin(s.playbookCategories, eq(s.playbookCategories.id, s.playbooks.categoryId))
          .leftJoin(s.teams, eq(s.teams.id, s.playbooks.ownerTeamId)).leftJoin(s.costCenters, eq(s.costCenters.id, s.playbooks.costCenterId))
          .where(and(inArray(s.playbooks.id, pids), or(ilike(s.playbooks.title, q), ilike(s.playbooks.description, q), ilike(s.playbooks.code, q), ilike(s.playbookCategories.name, q), ilike(s.teams.name, q), ilike(s.costCenters.name, q), ilike(s.playbookVersions.searchText, q), sql`(${s.playbookVersions.meta}->>'keywords') ilike ${q}`))) : [];
        const hit = new Set(hits.map((h) => h.id));
        list = list.filter((c) => hit.has(c.id));
      }
      const readIds = new Set(read.map((p) => p.id));
      const readable = list.filter((c) => readIds.has(c.id));
      const forYou = (await cards(app.db, auth, read.filter((p) => p.ownerTeamId && viewer.teamIds.includes(p.ownerTeamId) || viewer.teamIds.some((t) => p.teamIds.includes(t)) || (p.costCenterId && viewer.costCenterIds.includes(p.costCenterId)) || viewer.costCenterIds.some((c) => p.costCenterIds.includes(c)))));
      const all = await cards(app.db, auth, read);
      const cats = await app.db.select().from(s.playbookCategories).where(and(eq(s.playbookCategories.tenantId, auth.tenantId), eq(s.playbookCategories.active, true))).orderBy(asc(s.playbookCategories.name));
      // pendências de ciência da pessoa
      const ackNeeded = read.filter((p) => p.requiresAck && p.currentVersionId);
      const acks = ackNeeded.length ? await app.db.select({ v: s.playbookAcks.versionId }).from(s.playbookAcks).where(and(eq(s.playbookAcks.userId, auth.userId), inArray(s.playbookAcks.versionId, ackNeeded.map((p) => p.currentVersionId!)))) : [];
      return {
        items: (query.scope === 'meus' ? list : readable).slice(0, 300),
        total: (query.scope === 'meus' ? list : readable).length,
        forYou: {
          team: forYou.slice(0, 12),
          favorites: all.filter((c) => c.favorite).slice(0, 12),
          recent: all.filter((c) => c.lastReadAt).sort((a, b) => +new Date(b.lastReadAt!) - +new Date(a.lastReadAt!)).slice(0, 8),
          updates: all.filter((c) => c.recent || c.unreadUpdate).slice(0, 8),
          ackPending: (await cards(app.db, auth, ackNeeded.filter((p) => !acks.some((a) => a.v === p.currentVersionId)))).slice(0, 12),
        },
        categories: cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon, description: c.description, prefix: c.prefix, approval: c.approval, count: all.filter((x) => x.category?.id === c.id).length })),
        can: { create: await canCreate(app.db, auth), manage: isDirector(auth) || isManager(auth), director: isDirector(auth), manager: isManager(auth) },
      };
    },
  }),

  // ------------------------------------------------------------------ leitura
  defineRoute({
    method: 'GET', url: '/playbooks/:id', summary: 'Página do playbook: versão vigente (ou a versão pedida, para quem edita ou aprova), índice, progresso, favorito, ciência', ...A,
    params: IdParams, query: z.object({ versionId: uuid.optional(), view: z.enum(['1', '0']).default('1') }),
    handler: async ({ app, auth, params, query }) => {
      await ensurePlaybookJobs(app.db, auth.tenantId, auth.timezone);
      const p = await loadPb(app.db, auth, params.id);
      const viewer = await viewerOf(app.db, auth);
      const editor = await canEditPb(app.db, auth, p);
      const approver = isDirector(auth) || isManager(auth);
      const reader = readerAllows(p, viewer);
      if (!reader && !editor && !approver) throw notFound('Playbook não encontrado.'); // não revela a existência
      const wanted = query.versionId ?? p.currentVersionId;
      if (!wanted) {
        if (!editor && !approver) throw notFound('Playbook não encontrado.');
      }
      const v = wanted ? await loadVersion(app.db, auth, wanted) : null;
      if (v && v.playbookId !== p.id) throw notFound('Versão não encontrada.');
      if (v && v.id !== p.currentVersionId && !editor && !approver) throw notFound('Versão não encontrada.');
      if (p.status === 'suspenso' && !editor && !approver) throw notFound('Playbook não encontrado.');
      const [cat] = await app.db.select().from(s.playbookCategories).where(eq(s.playbookCategories.id, p.categoryId));
      const versions = await app.db.select({ id: s.playbookVersions.id, number: s.playbookVersions.number, status: s.playbookVersions.status, publishedAt: s.playbookVersions.publishedAt }).from(s.playbookVersions).where(eq(s.playbookVersions.playbookId, p.id)).orderBy(desc(s.playbookVersions.createdAt));
      const open = versions.find((x) => OPEN.includes(x.status as VersionStatus)) ?? null;
      const [fav] = await app.db.select().from(s.playbookFavorites).where(and(eq(s.playbookFavorites.userId, auth.userId), eq(s.playbookFavorites.playbookId, p.id)));
      let [read] = await app.db.select().from(s.playbookReads).where(and(eq(s.playbookReads.userId, auth.userId), eq(s.playbookReads.playbookId, p.id)));
      if (v && v.id === p.currentVersionId && query.view === '1') {
        // abrir conta como visualização (nunca como ciência); progresso continua salvo
        [read] = await app.db.insert(s.playbookReads).values({ userId: auth.userId, playbookId: p.id, versionId: v.id })
          .onConflictDoUpdate({ target: [s.playbookReads.userId, s.playbookReads.playbookId], set: { views: sql`${s.playbookReads.views} + 1`, lastAt: new Date(), versionId: v.id } }).returning();
      }
      const [ack] = p.currentVersionId ? await app.db.select().from(s.playbookAcks).where(and(eq(s.playbookAcks.userId, auth.userId), eq(s.playbookAcks.versionId, p.currentVersionId))) : [];
      const people = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const nm = (id: string | null | undefined) => (id ? people.find((u) => u.id === id)?.name ?? null : null);
      const [team] = p.ownerTeamId ? await app.db.select({ name: s.teams.name }).from(s.teams).where(eq(s.teams.id, p.ownerTeamId)) : [];
      const [cc] = p.costCenterId ? await app.db.select({ code: s.costCenters.code, name: s.costCenters.name }).from(s.costCenters).where(eq(s.costCenters.id, p.costCenterId)) : [];
      const related = (await visibleRows(app.db, auth)).read.filter((x) => x.id !== p.id && x.categoryId === p.categoryId).slice(0, 5).map((x) => ({ id: x.id, code: x.code, title: x.title }));
      const live = versions.find((x) => x.id === p.currentVersionId);
      const content = (v?.content ?? { blocks: [] }) as unknown as PlaybookContent;
      return {
        playbook: {
          id: p.id, code: p.code, title: p.title, description: p.description, status: p.status, suspendedReason: p.suspendedReason, requiresAck: p.requiresAck,
          category: cat ? { id: cat.id, name: cat.name, icon: cat.icon } : null, team: team?.name ?? null, costCenter: cc ? `${cc.code} · ${cc.name}` : null,
          maintainer: nm(p.maintainerId), lastReviewOn: p.lastReviewOn, nextReviewOn: p.nextReviewOn, publishedAt: live?.publishedAt ?? null,
          review: reviewState(p.nextReviewOn, todayIn(auth.timezone), (open?.status as VersionStatus) ?? null), visibility: p.visibility,
        },
        version: v ? { id: v.id, number: v.number, status: v.status, meta: v.meta, rowVersion: v.rowVersion, changeSummary: v.changeSummary, live: v.id === p.currentVersionId, effectiveFrom: v.effectiveFrom } : null,
        content, sections: sectionsOf(content),
        openVersion: open, currentVersionId: p.currentVersionId,
        me: { favorite: !!fav, progress: read?.progress ?? {}, acked: !!ack, ackedAt: ack?.createdAt ?? null },
        related,
        can: { edit: editor, approve: approver, suspend: isDirector(auth) || isManager(auth), read: reader },
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/playbooks/:id/progress', summary: 'Salva o progresso de leitura (seção atual, checklist de aprendizagem, etapas concluídas). Não altera dados operacionais.', ...A,
    params: IdParams, body: z.object({ section: z.string().max(60).nullable().optional(), checks: z.array(z.string().max(80)).max(500).optional(), done: z.array(z.string().max(60)).max(200).optional() }),
    handler: async ({ app, auth, params, body }) => {
      const p = await loadPb(app.db, auth, params.id);
      if (!readerAllows(p, await viewerOf(app.db, auth))) throw notFound('Playbook não encontrado.');
      const [r] = await app.db.insert(s.playbookReads).values({ userId: auth.userId, playbookId: p.id, versionId: p.currentVersionId!, progress: body })
        .onConflictDoUpdate({ target: [s.playbookReads.userId, s.playbookReads.playbookId], set: { progress: sql`${s.playbookReads.progress} || ${JSON.stringify(body)}::jsonb`, lastAt: new Date() } }).returning();
      return { progress: r!.progress };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbooks/:id/favorite', summary: 'Marca ou desmarca favorito', ...A, params: IdParams, body: z.object({ on: z.boolean() }),
    handler: async ({ app, auth, params, body }) => {
      const p = await loadPb(app.db, auth, params.id);
      if (!readerAllows(p, await viewerOf(app.db, auth)) && !(await canEditPb(app.db, auth, p))) throw notFound('Playbook não encontrado.');
      if (body.on) await app.db.insert(s.playbookFavorites).values({ userId: auth.userId, playbookId: p.id }).onConflictDoNothing();
      else await app.db.delete(s.playbookFavorites).where(and(eq(s.playbookFavorites.userId, auth.userId), eq(s.playbookFavorites.playbookId, p.id)));
      return { favorite: body.on };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbooks/:id/ack', summary: 'Registra a ciência da versão vigente (ação explícita; abrir a página não conta)', ...A, params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      const p = await loadPb(app.db, auth, params.id);
      if (!readerAllows(p, await viewerOf(app.db, auth))) throw notFound('Playbook não encontrado.');
      if (!p.requiresAck) throw unprocessable('Este playbook não pede confirmação de ciência.');
      await app.db.insert(s.playbookAcks).values({ tenantId: auth.tenantId, userId: auth.userId, playbookId: p.id, versionId: p.currentVersionId! }).onConflictDoNothing();
      await audit(app.db, req, { action: 'playbook.ack', entityType: 'playbook', entityId: p.id, metadata: { versionId: p.currentVersionId } });
      return { acked: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbooks/:id/suggestions', summary: 'Sugere melhoria ou reporta conteúdo desatualizado (vai para quem mantém; não muda o conteúdo vigente)', ...A, params: IdParams,
    body: z.object({ kind: z.enum(['melhoria', 'desatualizado']).default('melhoria'), description: z.string().trim().min(10).max(4000), excerpt: z.string().trim().max(1000).nullable().optional(), reason: z.string().trim().max(1000).nullable().optional(), fileId: uuid.nullable().optional() }),
    handler: async ({ app, auth, params, body, reply }) => {
      const p = await loadPb(app.db, auth, params.id);
      if (!readerAllows(p, await viewerOf(app.db, auth)) && !(await canEditPb(app.db, auth, p))) throw notFound('Playbook não encontrado.');
      if (body.fileId) { const [f] = await app.db.select({ id: s.playbookFiles.id }).from(s.playbookFiles).where(and(eq(s.playbookFiles.id, body.fileId), eq(s.playbookFiles.playbookId, p.id))); if (!f) throw unprocessable('Anexo não encontrado.'); }
      const [r] = await app.db.insert(s.playbookSuggestions).values({ tenantId: auth.tenantId, playbookId: p.id, versionId: p.currentVersionId, authorId: auth.userId, kind: body.kind, description: body.description, excerpt: body.excerpt ?? null, reason: body.reason ?? null, fileId: body.fileId ?? null }).returning();
      const org = await vacationOrg(app.db, auth.tenantId);
      await ev(app.db, auth, p.id, p.currentVersionId, body.kind === 'desatualizado' ? 'reporte_desatualizado' : 'sugestao', body.description.slice(0, 200), [p.maintainerId, ...(p.ownerTeamId ? org.leads[p.ownerTeamId] ?? [] : [])], `${body.kind === 'desatualizado' ? 'Conteúdo desatualizado' : 'Sugestão'} em ${p.code}: ${p.title}`);
      reply.code(201);
      return r;
    },
  }),

  // ------------------------------------------------------------------ arquivos
  defineRoute({
    method: 'POST', url: '/playbooks/:id/files', summary: 'Envia arquivo (PDF, imagem PNG/JPG ou Office) para o conteúdo ou para uma sugestão', ...A, params: IdParams, bodyLimit: 15_000_000,
    body: z.object({ name: z.string().trim().min(1).max(200), data: z.string().min(8).max(13_500_000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const p = await loadPb(app.db, auth, params.id);
      if (!(await canEditPb(app.db, auth, p)) && !readerAllows(p, await viewerOf(app.db, auth))) throw notFound('Playbook não encontrado.');
      const buf = Buffer.from(body.data, 'base64');
      if (buf.length > 10 * 1024 * 1024) throw unprocessable('Arquivo acima de 10 MB.');
      const mime = detectAttachment(body.name, buf);
      if (!mime) throw unprocessable('Envie PDF, imagem (PNG ou JPG) ou arquivo do Office.');
      const [f] = await app.db.insert(s.playbookFiles).values({ tenantId: auth.tenantId, playbookId: p.id, name: body.name.replace(/[\\/:*?"<>|\r\n]+/g, '_'), mime, size: buf.length, data: buf, createdBy: auth.userId }).returning({ id: s.playbookFiles.id, name: s.playbookFiles.name, mime: s.playbookFiles.mime, size: s.playbookFiles.size });
      reply.code(201);
      return f;
    },
  }),
  defineRoute({
    method: 'GET', url: '/playbook-files/:id', summary: 'Baixa ou exibe arquivo do playbook (só para quem pode ler ou editar o playbook)', ...A, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [f] = await app.db.select().from(s.playbookFiles).where(and(eq(s.playbookFiles.id, params.id), eq(s.playbookFiles.tenantId, auth.tenantId)));
      if (!f) throw notFound('Arquivo não encontrado.');
      const p = await loadPb(app.db, auth, f.playbookId);
      if (!readerAllows(p, await viewerOf(app.db, auth)) && !(await canEditPb(app.db, auth, p)) && !isDirector(auth) && !isManager(auth)) throw notFound('Arquivo não encontrado.');
      const inline = f.mime === 'application/pdf' || f.mime.startsWith('image/');
      reply.header('content-type', f.mime).header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name)}"`).header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=300');
      return reply.send(f.data);
    },
  }),

  // ------------------------------------------------------------------ categorias, modelos e configuração
  defineRoute({
    method: 'GET', url: '/playbooks/gamification-rule', summary: 'Regra aprovada da gamificação para a calculadora de meta dos playbooks (regra é pública para o time: metas, pontos, bônus; sem notas de ninguém)', ...A,
    handler: async ({ app, auth }) => {
      const { settings: st, version } = await gamificationSettingsOf(app.db, auth.tenantId);
      if (!st) return { approved: false as const };
      const org = await vacationOrg(app.db, auth.tenantId);
      const isLead = Object.values(org.leads).some((l) => l.includes(auth.userId));
      const mine = levelFor(st, auth.userId, isLead);
      const lv = new Map(st.competencyLevels.map((l) => [l.key, l]));
      const label = new Map(BUSINESS_EVENT_TYPES.map((e) => [e.key, e.label]));
      return {
        approved: true as const, version,
        myLevel: { key: mine.key, name: mine.name, rank: mine.rank, expectedMonthlyPoints: mine.expectedMonthlyPoints, scoresTasks: mine.scoresTasks },
        levels: st.competencyLevels.map((l) => ({ key: l.key, name: l.name, rank: l.rank, expectedMonthlyPoints: l.expectedMonthlyPoints, scoresTasks: l.scoresTasks, weights: l.weights })),
        dispersionYellowBp: st.dispersionYellowBp, dispersionRedBp: st.dispersionRedBp,
        bonuses: st.bonuses,
        journeys: (st.journeys ?? []).map((j) => ({ key: j.key, name: j.name, wonPoints: j.wonPoints, tasks: j.components.map((c) => ({ key: c.key, name: c.name, points: c.points, dueDays: c.dueDays, level: c.level ?? null, levelName: c.level ? lv.get(c.level)?.name ?? null : null, levelRank: c.level ? lv.get(c.level)?.rank ?? null : null })) })),
        events: Object.entries(st.points).filter(([, v]) => v > 0).map(([k, v]) => ({ key: k, label: label.get(k as never) ?? k, points: v })),
        participationMultiplierBp: st.participationMultiplierBp,
        support: st.support ?? null,
        yearBands: st.levels,
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/playbooks/setup', summary: 'Categorias, modelos, configuração e cadastros para o editor (times, centros, pessoas, perfis)', ...A,
    handler: async ({ app, auth }) => {
      await ensurePlaybookSetup(app.db, auth.tenantId);
      await ensureTeamCostCenters(app.db, auth.tenantId); // cada time é um centro de custo
      const [cats, tpls, [st], teams, ccs, users] = await Promise.all([
        app.db.select().from(s.playbookCategories).where(eq(s.playbookCategories.tenantId, auth.tenantId)).orderBy(asc(s.playbookCategories.name)),
        app.db.select({ id: s.playbookTemplates.id, name: s.playbookTemplates.name, type: s.playbookTemplates.type, description: s.playbookTemplates.description, system: s.playbookTemplates.system }).from(s.playbookTemplates).where(eq(s.playbookTemplates.tenantId, auth.tenantId)).orderBy(desc(s.playbookTemplates.system), asc(s.playbookTemplates.name)),
        app.db.select().from(s.playbookSettings).where(eq(s.playbookSettings.tenantId, auth.tenantId)),
        app.db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), eq(s.teams.active, true))).orderBy(asc(s.teams.name)),
        app.db.select({ id: s.costCenters.id, code: s.costCenters.code, name: s.costCenters.name, teamId: s.costCenters.teamId }).from(s.costCenters).where(and(eq(s.costCenters.tenantId, auth.tenantId), eq(s.costCenters.active, true))).orderBy(asc(s.costCenters.code)),
        app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).orderBy(asc(s.users.name)),
      ]);
      return { categories: cats, templates: tpls, settings: st, teams, costCenters: ccs, users, can: { categories: isDirector(auth) || isManager(auth), create: await canCreate(app.db, auth) } };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbooks/categories', summary: 'Cria ou altera categoria (Gerência e Diretoria): nome, prefixo do código, ícone, descrição e alçada', ...A,
    body: z.object({ id: uuid.optional(), name: z.string().trim().min(2).max(60), prefix: z.string().trim().regex(/^[A-Za-z]{2,5}$/, 'Prefixo de 2 a 5 letras'), icon: z.string().max(30).default('book'), description: z.string().trim().max(300).nullable().optional(), approval: z.object({ gerencia: z.boolean(), diretoria: z.boolean() }), active: z.boolean().default(true) }),
    handler: async ({ app, auth, body }) => {
      if (!isDirector(auth) && !isManager(auth)) throw forbidden('Categorias são administradas pela Gerência e pela Diretoria.');
      const vals = { name: body.name, prefix: body.prefix.toUpperCase(), icon: body.icon, description: body.description ?? null, approval: body.approval, active: body.active };
      const dup = (e: unknown) => { if ((e as { code?: string }).code === '23505') throw unprocessable('Já existe uma categoria com esse nome.'); throw e; };
      if (body.id) { const [c] = await app.db.update(s.playbookCategories).set(vals).where(and(eq(s.playbookCategories.id, body.id), eq(s.playbookCategories.tenantId, auth.tenantId))).returning().catch(dup); if (!c) throw notFound(); return c; }
      const [c] = await app.db.insert(s.playbookCategories).values({ tenantId: auth.tenantId, ...vals }).returning().catch(dup);
      return c;
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/playbooks/categories/:id', summary: 'Exclui categoria sem playbooks (Gerência e Diretoria); com playbooks, só desativar', ...A,
    params: z.object({ id: uuid }),
    handler: async ({ app, auth, params }) => {
      if (!isDirector(auth) && !isManager(auth)) throw forbidden('Categorias são administradas pela Gerência e pela Diretoria.');
      const [c] = await app.db.select().from(s.playbookCategories).where(and(eq(s.playbookCategories.id, params.id), eq(s.playbookCategories.tenantId, auth.tenantId)));
      if (!c) throw notFound();
      const n = (await app.db.select({ n: sql<number>`count(*)::int` }).from(s.playbooks).where(and(eq(s.playbooks.tenantId, auth.tenantId), eq(s.playbooks.categoryId, c.id))))[0]!.n;
      if (n > 0) throw unprocessable(`A categoria “${c.name}” tem ${n} playbook(s), inclusive arquivados ou em rascunho. Para tirá-la de uso, desative a categoria em Editar: os playbooks continuam disponíveis e ela deixa de aparecer para novos playbooks.`);
      await app.db.delete(s.playbookCategories).where(and(eq(s.playbookCategories.id, c.id), eq(s.playbookCategories.tenantId, auth.tenantId)));
      return { ok: true, id: c.id };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/playbooks/settings', summary: 'Convenção do código e dias dos alertas de revisão (Gerência e Diretoria)', ...A,
    body: z.object({ codePattern: z.string().trim().max(40).refine((x) => x.includes('{NUM}'), 'Inclua {NUM} no padrão'), alertDays: z.array(z.number().int().min(0).max(365)).min(1).max(6) }),
    handler: async ({ app, auth, body }) => {
      if (!isDirector(auth) && !isManager(auth)) throw forbidden();
      await app.db.insert(s.playbookSettings).values({ tenantId: auth.tenantId, ...body }).onConflictDoUpdate({ target: s.playbookSettings.tenantId, set: { ...body, updatedAt: new Date() } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbooks/templates', summary: 'Salva o conteúdo de uma versão como modelo reutilizável', ...A,
    body: z.object({ versionId: uuid, name: z.string().trim().min(3).max(80), description: z.string().trim().max(300).nullable().optional() }),
    handler: async ({ app, auth, body, reply }) => {
      const v = await loadVersion(app.db, auth, body.versionId);
      const p = await loadPb(app.db, auth, v.playbookId);
      if (!(await canEditPb(app.db, auth, p))) throw forbidden();
      const [t] = await app.db.insert(s.playbookTemplates).values({ tenantId: auth.tenantId, name: body.name, type: (v.meta as unknown as PlaybookMeta).type, description: body.description ?? null, content: v.content, createdBy: auth.userId }).returning()
        .catch((e) => { if ((e as { code?: string }).code === '23505') throw unprocessable('Já existe um modelo com esse nome.'); throw e; });
      reply.code(201);
      return t;
    },
  }),

  // ------------------------------------------------------------------ criação e rascunhos
  defineRoute({
    method: 'POST', url: '/playbooks/new', summary: 'Cria playbook (código automático) com o primeiro rascunho, a partir de um modelo ou de outro playbook (duplicar)', ...A,
    body: z.object({ categoryId: uuid, meta: Meta, templateId: uuid.nullable().optional(), duplicateOf: uuid.nullable().optional() }),
    handler: async ({ app, auth, body, req, reply }) => {
      if (!(await canCreate(app.db, auth))) throw forbidden('Quem cria playbooks é a liderança, a Gerência e a Diretoria.');
      await ensurePlaybookSetup(app.db, auth.tenantId);
      await checkMeta(app.db, auth, body.meta);
      const [cat] = await app.db.select().from(s.playbookCategories).where(and(eq(s.playbookCategories.id, body.categoryId), eq(s.playbookCategories.tenantId, auth.tenantId), eq(s.playbookCategories.active, true)));
      if (!cat) throw unprocessable('Categoria não encontrada.');
      let content: PlaybookContent = { blocks: [] };
      if (body.templateId) { const [t] = await app.db.select().from(s.playbookTemplates).where(and(eq(s.playbookTemplates.id, body.templateId), eq(s.playbookTemplates.tenantId, auth.tenantId))); if (!t) throw unprocessable('Modelo não encontrado.'); content = t.content as unknown as PlaybookContent; }
      if (body.duplicateOf) {
        const src = await loadPb(app.db, auth, body.duplicateOf);
        if (!readerAllows(src, await viewerOf(app.db, auth)) && !(await canEditPb(app.db, auth, src))) throw notFound('Playbook não encontrado.');
        const [v] = src.currentVersionId ? await app.db.select().from(s.playbookVersions).where(eq(s.playbookVersions.id, src.currentVersionId)) : [];
        if (v) content = v.content as unknown as PlaybookContent;
      }
      const r = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`playbook-code:${auth.tenantId}`}))`);
        const [st] = await tx.select().from(s.playbookSettings).where(eq(s.playbookSettings.tenantId, auth.tenantId));
        const pattern = st?.codePattern ?? '{CAT}-PB-{NUM}';
        const n = (await tx.select({ n: sql<number>`count(*)::int` }).from(s.playbooks).where(and(eq(s.playbooks.tenantId, auth.tenantId), eq(s.playbooks.categoryId, cat.id))))[0]!.n;
        let k = n + 1, code = playbookCode(pattern, cat.prefix, k);
        while ((await tx.select({ id: s.playbooks.id }).from(s.playbooks).where(and(eq(s.playbooks.tenantId, auth.tenantId), eq(s.playbooks.code, code)))).length) code = playbookCode(pattern, cat.prefix, ++k);
        const m = body.meta;
        const [p] = await tx.insert(s.playbooks).values({ tenantId: auth.tenantId, code, categoryId: cat.id, title: m.title, description: m.description, ownerTeamId: m.ownerTeamId, costCenterId: m.costCenterId, maintainerId: m.maintainerId ?? auth.userId, visibility: m.visibility, teamIds: m.teamIds, costCenterIds: m.costCenterIds, profiles: m.profiles, userIds: m.userIds, reviewPeriod: m.reviewPeriod, reviewCustomDays: m.reviewCustomDays, nextReviewOn: m.nextReviewOn, requiresAck: m.requiresAck, createdBy: auth.userId }).returning();
        const [v] = await tx.insert(s.playbookVersions).values({ tenantId: auth.tenantId, playbookId: p!.id, number: '1.0', meta: { ...m, maintainerId: m.maintainerId ?? auth.userId }, content, searchText: contentText(content), authorId: auth.userId }).returning();
        await ev(tx, auth, p!.id, v!.id, 'criado', `${code} criado${body.duplicateOf ? ' (duplicado de outro playbook)' : body.templateId ? ' a partir de modelo' : ''}.`);
        return { id: p!.id, code, versionId: v!.id };
      });
      await audit(app.db, req, { action: 'playbook.create', entityType: 'playbook', entityId: r.id, metadata: { code: r.code } });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbooks/:id/drafts', summary: 'Abre rascunho da próxima versão a partir da vigente ou de uma versão anterior (restaurar): não sobrescreve o histórico nem entra em vigor sem aprovação', ...A,
    params: IdParams, body: z.object({ fromVersionId: uuid.nullable().optional(), relevant: z.boolean().default(false) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const p = await loadPb(app.db, auth, params.id);
      if (!(await canEditPb(app.db, auth, p))) throw forbidden('Você não edita este playbook.');
      return app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`playbook:${p.id}`}))`);
        const [open] = await tx.select().from(s.playbookVersions).where(and(eq(s.playbookVersions.playbookId, p.id), inArray(s.playbookVersions.status, OPEN)));
        if (open) throw unprocessable(`Já existe a versão ${open.number} em andamento. Continue nela.`);
        const srcId = body.fromVersionId ?? p.currentVersionId;
        if (!srcId) throw unprocessable('Não há versão para usar como base.');
        const src = await loadVersion(tx, auth, srcId);
        if (src.playbookId !== p.id) throw notFound('Versão não encontrada.');
        const [live] = p.currentVersionId ? await tx.select({ number: s.playbookVersions.number }).from(s.playbookVersions).where(eq(s.playbookVersions.id, p.currentVersionId)) : [];
        const all = await tx.select({ number: s.playbookVersions.number }).from(s.playbookVersions).where(eq(s.playbookVersions.playbookId, p.id));
        let number = nextVersion(live?.number ?? null, body.relevant);
        while (all.some((x) => x.number === number)) number = nextVersion(number, false);
        const [v] = await tx.insert(s.playbookVersions).values({ tenantId: auth.tenantId, playbookId: p.id, number, meta: src.meta, content: src.content, searchText: src.searchText, relevant: body.relevant, basedOnVersionId: src.id, authorId: auth.userId }).returning();
        await ev(tx, auth, p.id, v!.id, body.fromVersionId ? 'restaurado' : 'rascunho', body.fromVersionId ? `Rascunho ${number} aberto a partir da versão ${src.number}.` : `Rascunho ${number} aberto.`);
        reply.code(201);
        return { versionId: v!.id, number };
      });
    },
  }),
  defineRoute({
    method: 'PUT', url: '/playbook-versions/:id', summary: 'Salva o rascunho (automático): metadados e blocos; recusa se outra pessoa salvou antes (versão de linha)', ...A,
    params: IdParams, body: z.object({ rowVersion: z.number().int(), meta: Meta, content: Content }),
    handler: async ({ app, auth, params, body }) => {
      const v = await loadVersion(app.db, auth, params.id);
      const p = await loadPb(app.db, auth, v.playbookId);
      if (!(await canEditPb(app.db, auth, p))) throw forbidden('Você não edita este playbook.');
      if (v.status !== 'rascunho') throw unprocessable('Só rascunhos podem ser alterados. Depois do envio, devolva para rascunho.');
      await checkMeta(app.db, auth, body.meta);
      const content = checkContent(body.content);
      const [u] = await app.db.update(s.playbookVersions).set({ meta: body.meta, content, searchText: contentText(content), rowVersion: sql`${s.playbookVersions.rowVersion} + 1`, updatedAt: new Date() })
        .where(and(eq(s.playbookVersions.id, v.id), eq(s.playbookVersions.rowVersion, body.rowVersion), eq(s.playbookVersions.status, 'rascunho'))).returning({ rowVersion: s.playbookVersions.rowVersion, updatedAt: s.playbookVersions.updatedAt });
      if (!u) throw unprocessable('Outra pessoa salvou este rascunho antes. Recarregue para ver a versão mais recente.', [{ path: 'rowVersion', message: 'conflito' }]);
      return u;
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbook-versions/:id/submit', summary: 'Envia o rascunho para aprovação (alçada da categoria e criticidade: Gerência e/ou Diretoria)', ...A,
    params: IdParams, body: z.object({ changeSummary: z.string().trim().min(5, 'Descreva as alterações').max(2000), relevant: z.boolean().default(false), effectiveFrom: day.nullable().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const v = await loadVersion(app.db, auth, params.id);
      const p = await loadPb(app.db, auth, v.playbookId);
      if (!(await canEditPb(app.db, auth, p))) throw forbidden('Você não edita este playbook.');
      if (v.status !== 'rascunho') throw unprocessable('Esta versão já foi enviada.');
      const meta = Meta.parse(v.meta);
      await checkMeta(app.db, auth, meta);
      const content = checkContent(v.content);
      if (!content.blocks.length) throw unprocessable('Inclua o conteúdo antes de enviar.');
      const [cat] = await app.db.select().from(s.playbookCategories).where(eq(s.playbookCategories.id, p.categoryId));
      const stages = approvalStagesFor(cat?.approval ?? { gerencia: true, diretoria: true }, meta.criticality);
      const status = stages[0] === 'gerencia' ? 'revisao_gerencia' : 'homologacao_diretoria';
      // mudança relevante muda o número (2.3 → 3.0) e pede nova ciência
      const [live] = p.currentVersionId ? await app.db.select({ number: s.playbookVersions.number }).from(s.playbookVersions).where(eq(s.playbookVersions.id, p.currentVersionId)) : [];
      const number = live && body.relevant !== v.relevant ? nextVersion(live.number, body.relevant) : v.number;
      await app.db.update(s.playbookVersions).set({ status, stages, changeSummary: body.changeSummary, relevant: body.relevant, number, effectiveFrom: body.effectiveFrom ?? null, submittedAt: new Date(), submittedBy: auth.userId, managerApprovedBy: null, managerApprovedAt: null, directorApprovedBy: null, directorApprovedAt: null, updatedAt: new Date() }).where(eq(s.playbookVersions.id, v.id));
      const approvers = await usersWith(app.db, auth.tenantId, stages[0] === 'gerencia' ? ['gerencia'] : ['diretoria', 'administrador']);
      await ev(app.db, auth, p.id, v.id, 'enviado', `Versão ${number} enviada à ${stages[0] === 'gerencia' ? 'Gerência' : 'Diretoria'}: ${body.changeSummary}`, approvers, `Aprovar ${p.code} v${number}: ${meta.title}`);
      await audit(app.db, req, { action: 'playbook.submit', entityType: 'playbook_version', entityId: v.id, metadata: { stages } });
      return { status, stages, number };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbook-versions/:id/decide', summary: 'Gerência aprova (segue à Diretoria) ou devolve; Diretoria homologa (com data de vigência), rejeita ou devolve. Autor não decide a própria versão.', ...A,
    params: IdParams, body: z.object({ decision: z.enum(['aprovar', 'devolver', 'rejeitar']), note: z.string().trim().max(2000).nullable().optional(), effectiveFrom: day.nullable().optional(), rowVersion: z.number().int().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const v0 = await loadVersion(app.db, auth, params.id);
      const p = await loadPb(app.db, auth, v0.playbookId);
      const stage = stageOf(v0.status);
      if (!stage) throw unprocessable('Esta versão não está aguardando decisão.');
      if (!(await decides(app.db, auth, stage, p, v0))) throw forbidden(v0.submittedBy === auth.userId || v0.authorId === auth.userId ? 'Quem enviou não decide a própria versão.' : stage === 'gerencia' ? 'Esta etapa é da Gerência.' : 'Esta etapa é da Diretoria.');
      if (body.decision !== 'aprovar' && (body.note ?? '').length < 5) throw unprocessable('Explique a decisão.');
      if (body.decision === 'rejeitar' && stage !== 'diretoria') throw unprocessable('Rejeitar é decisão da Diretoria; a Gerência devolve para ajustes.');
      const today = todayIn(auth.timezone);
      const r = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`playbook:${p.id}`}))`);
        const [v] = await tx.select().from(s.playbookVersions).where(eq(s.playbookVersions.id, v0.id));
        if (v!.status !== v0.status || (body.rowVersion !== undefined && body.rowVersion !== v!.rowVersion)) throw unprocessable('A versão mudou enquanto você analisava. Recarregue.');
        await tx.insert(s.playbookDecisions).values({ tenantId: auth.tenantId, playbookId: p.id, versionId: v!.id, stage, decision: body.decision, note: body.note ?? null, actorId: auth.userId });
        const notify = [v!.authorId, v!.submittedBy, p.maintainerId];
        if (body.decision === 'devolver') {
          // devolver reinicia o fluxo: aprovações anteriores caem
          await tx.update(s.playbookVersions).set({ status: 'rascunho', managerApprovedBy: null, managerApprovedAt: null, directorApprovedBy: null, directorApprovedAt: null, updatedAt: new Date() }).where(eq(s.playbookVersions.id, v!.id));
          await ev(tx, auth, p.id, v!.id, 'devolvido', `${stage === 'gerencia' ? 'Gerência' : 'Diretoria'} devolveu a versão ${v!.number}: ${body.note}`, notify, `${p.code} v${v!.number} devolvido para ajustes`);
          return { status: 'rascunho' };
        }
        if (body.decision === 'rejeitar') {
          await tx.update(s.playbookVersions).set({ status: 'rejeitada', updatedAt: new Date() }).where(eq(s.playbookVersions.id, v!.id));
          await ev(tx, auth, p.id, v!.id, 'rejeitado', `Diretoria rejeitou a versão ${v!.number}: ${body.note}`, notify, `${p.code} v${v!.number} rejeitado`);
          return { status: 'rejeitada' };
        }
        if (stage === 'gerencia' && v!.stages.includes('diretoria')) {
          await tx.update(s.playbookVersions).set({ status: 'homologacao_diretoria', managerApprovedBy: auth.userId, managerApprovedAt: new Date(), updatedAt: new Date() }).where(eq(s.playbookVersions.id, v!.id));
          await ev(tx, auth, p.id, v!.id, 'aprovado_gerencia', `Gerência aprovou a versão ${v!.number} e enviou à Diretoria${body.note ? `: ${body.note}` : ''}.`, [...notify, ...(await usersWith(tx, auth.tenantId, ['diretoria', 'administrador']))], `Homologar ${p.code} v${v!.number}`);
          return { status: 'homologacao_diretoria' };
        }
        const effective = body.effectiveFrom ?? v!.effectiveFrom ?? today;
        if (effective < today) throw unprocessable('A vigência não pode começar no passado.');
        await tx.update(s.playbookVersions).set({ status: 'aprovada', effectiveFrom: effective, ...(stage === 'gerencia' ? { managerApprovedBy: auth.userId, managerApprovedAt: new Date() } : { directorApprovedBy: auth.userId, directorApprovedAt: new Date() }), updatedAt: new Date() }).where(eq(s.playbookVersions.id, v!.id));
        await ev(tx, auth, p.id, v!.id, 'homologado', `${stage === 'diretoria' ? 'Diretoria homologou' : 'Gerência aprovou'} a versão ${v!.number}; vigência a partir de ${effective.split('-').reverse().join('/')}${body.note ? `: ${body.note}` : ''}.`, notify, `${p.code} v${v!.number} aprovado`);
        if (effective <= today) await publishVersion(tx, auth.tenantId, v!.id, today, auth.userId);
        return { status: effective <= today ? 'vigente' : 'aprovada', effectiveFrom: effective };
      });
      if (r.status === 'vigente' && p.requiresAck) {
        // ciência pendente avisada a quem recebe o playbook
        const [np] = await app.db.select().from(s.playbooks).where(eq(s.playbooks.id, p.id));
        await notifyAudience(app.db, auth, np!, `Nova versão de ${np!.code}: confirme a ciência`);
      }
      await audit(app.db, req, { action: `playbook.${body.decision}`, entityType: 'playbook_version', entityId: v0.id, metadata: { stage, status: r.status } });
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbook-versions/:id/reopen', summary: 'Volta a versão enviada para rascunho para alterar (as aprovações já dadas caem e o fluxo recomeça)', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const v = await loadVersion(app.db, auth, params.id);
      const p = await loadPb(app.db, auth, v.playbookId);
      if (!(await canEditPb(app.db, auth, p))) throw forbidden();
      if (!['revisao_gerencia', 'homologacao_diretoria', 'aprovada'].includes(v.status)) throw unprocessable('Só versões em aprovação ou aprovadas (ainda sem vigor) voltam para rascunho.');
      await app.db.update(s.playbookVersions).set({ status: 'rascunho', managerApprovedBy: null, managerApprovedAt: null, directorApprovedBy: null, directorApprovedAt: null, updatedAt: new Date() }).where(eq(s.playbookVersions.id, v.id));
      await ev(app.db, auth, p.id, v.id, 'reaberto', `Versão ${v.number} voltou para rascunho; o fluxo de aprovação recomeça.`);
      return { status: 'rascunho' };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbook-versions/:id/discard', summary: 'Descarta rascunho (fica no histórico como descartado)', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const v = await loadVersion(app.db, auth, params.id);
      const p = await loadPb(app.db, auth, v.playbookId);
      if (!(await canEditPb(app.db, auth, p))) throw forbidden();
      if (v.status !== 'rascunho') throw unprocessable('Só rascunhos podem ser descartados.');
      await app.db.update(s.playbookVersions).set({ status: 'descartada', updatedAt: new Date() }).where(eq(s.playbookVersions.id, v.id));
      await ev(app.db, auth, p.id, v.id, 'descartado', `Rascunho ${v.number} descartado.`);
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbook-versions/:id/comments', summary: 'Comenta a versão em aprovação (histórico de comentários)', ...A, params: IdParams, body: z.object({ note: z.string().trim().min(2).max(2000) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const v = await loadVersion(app.db, auth, params.id);
      const p = await loadPb(app.db, auth, v.playbookId);
      if (!(await canEditPb(app.db, auth, p)) && !isDirector(auth) && !isManager(auth)) throw forbidden();
      await app.db.insert(s.playbookDecisions).values({ tenantId: auth.tenantId, playbookId: p.id, versionId: v.id, stage: stageOf(v.status) ?? 'rascunho', decision: 'comentario', note: body.note, actorId: auth.userId });
      reply.code(201);
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ versões e comparação
  defineRoute({
    method: 'GET', url: '/playbooks/:id/versions', summary: 'Histórico de versões (autor, publicação, alterações, aprovadores, vigência) e eventos', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const p = await loadPb(app.db, auth, params.id);
      const editor = await canEditPb(app.db, auth, p);
      if (!editor && !isDirector(auth) && !isManager(auth) && !readerAllows(p, await viewerOf(app.db, auth))) throw notFound('Playbook não encontrado.');
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const nm = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? null : null);
      const vs = await app.db.select().from(s.playbookVersions).where(eq(s.playbookVersions.playbookId, p.id)).orderBy(desc(s.playbookVersions.createdAt));
      const decisions = await app.db.select().from(s.playbookDecisions).where(eq(s.playbookDecisions.playbookId, p.id)).orderBy(asc(s.playbookDecisions.createdAt));
      const events = await app.db.select({ type: s.playbookEvents.type, note: s.playbookEvents.note, at: s.playbookEvents.createdAt, actorId: s.playbookEvents.actorId }).from(s.playbookEvents).where(eq(s.playbookEvents.playbookId, p.id)).orderBy(desc(s.playbookEvents.createdAt)).limit(200);
      // quem só lê vê as versões publicadas; quem edita ou aprova vê todas
      const visible = editor || isDirector(auth) || isManager(auth) ? vs : vs.filter((v) => ['vigente', 'encerrada'].includes(v.status));
      return {
        items: visible.map((v) => ({ id: v.id, number: v.number, status: v.status, author: nm(v.authorId), createdAt: v.createdAt, submittedAt: v.submittedAt, publishedAt: v.publishedAt, validTo: v.validTo, effectiveFrom: v.effectiveFrom, changeSummary: v.changeSummary, relevant: v.relevant, manager: nm(v.managerApprovedBy), managerAt: v.managerApprovedAt, director: nm(v.directorApprovedBy), directorAt: v.directorApprovedAt, decisions: decisions.filter((d) => d.versionId === v.id).map((d) => ({ stage: d.stage, decision: d.decision, note: d.note, by: nm(d.actorId), at: d.createdAt })) })),
        events: editor || isDirector(auth) || isManager(auth) ? events.map((e) => ({ ...e, by: nm(e.actorId) })) : [],
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/playbook-versions/:id/compare', summary: 'Compara duas versões lado a lado (blocos adicionados, removidos e alterados, com as palavras)', ...A,
    params: IdParams, query: z.object({ with: uuid.optional() }),
    handler: async ({ app, auth, params, query }) => {
      const b = await loadVersion(app.db, auth, params.id);
      const p = await loadPb(app.db, auth, b.playbookId);
      const editor = await canEditPb(app.db, auth, p) || isDirector(auth) || isManager(auth);
      const okFor = (st: string) => editor || ['vigente', 'encerrada'].includes(st);
      if (!okFor(b.status) || (!editor && !readerAllows(p, await viewerOf(app.db, auth)))) throw notFound('Versão não encontrada.');
      const aId = query.with ?? b.basedOnVersionId ?? p.currentVersionId;
      const a = aId && aId !== b.id ? await loadVersion(app.db, auth, aId) : null;
      if (a && (a.playbookId !== p.id || !okFor(a.status))) throw notFound('Versão não encontrada.');
      const metaChanges = a ? Object.keys(b.meta).filter((k) => JSON.stringify((a.meta as Record<string, unknown>)[k]) !== JSON.stringify((b.meta as Record<string, unknown>)[k])) : [];
      return { before: a ? { id: a.id, number: a.number, status: a.status } : null, after: { id: b.id, number: b.number, status: b.status }, metaChanges, blocks: diffContent((a?.content ?? null) as PlaybookContent | null, b.content as unknown as PlaybookContent) };
    },
  }),

  // ------------------------------------------------------------------ gestão
  defineRoute({
    method: 'POST', url: '/playbooks/:id/suspend', summary: 'Suspensão administrativa (risco operacional, normativo ou de segurança) ou reativação — Gerência e Diretoria', ...A,
    params: IdParams, body: z.object({ suspend: z.boolean(), reason: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!isDirector(auth) && !isManager(auth)) throw forbidden('Suspensão é decisão da Gerência ou da Diretoria.');
      const p = await loadPb(app.db, auth, params.id);
      if (body.suspend && (body.reason ?? '').length < 10) throw unprocessable('Explique o risco que motiva a suspensão.');
      await app.db.update(s.playbooks).set(body.suspend ? { status: 'suspenso', suspendedReason: body.reason!, suspendedBy: auth.userId, suspendedAt: new Date() } : { status: 'ativo', suspendedReason: null, suspendedBy: null, suspendedAt: null }).where(eq(s.playbooks.id, p.id));
      await ev(app.db, auth, p.id, p.currentVersionId, body.suspend ? 'suspenso' : 'reativado', body.suspend ? `Suspenso: ${body.reason}` : 'Reativado.', [p.maintainerId]);
      await audit(app.db, req, { action: body.suspend ? 'playbook.suspend' : 'playbook.reactivate', entityType: 'playbook', entityId: p.id });
      return { status: body.suspend ? 'suspenso' : 'ativo' };
    },
  }),
  defineRoute({
    method: 'POST', url: '/playbooks/:id/request-ack', summary: 'Pede de novo a ciência da versão vigente a quem recebe o playbook (Gerência e Diretoria)', ...A, params: IdParams,
    handler: async ({ app, auth, params }) => {
      if (!isDirector(auth) && !isManager(auth)) throw forbidden();
      const p = await loadPb(app.db, auth, params.id);
      if (!p.currentVersionId) throw unprocessable('Sem versão vigente.');
      if (!p.requiresAck) await app.db.update(s.playbooks).set({ requiresAck: true }).where(eq(s.playbooks.id, p.id));
      const n = await notifyAudience(app.db, auth, { ...p, requiresAck: true }, `Confirme a ciência de ${p.code}: ${p.title}`);
      await ev(app.db, auth, p.id, p.currentVersionId, 'ciencia_solicitada', `Ciência solicitada a ${n} pessoa(s).`);
      return { notified: n };
    },
  }),
  defineRoute({
    method: 'GET', url: '/playbooks/approvals', summary: 'Painel de aprovação: o que espera a minha decisão, com justificativa, versão anterior, comentários', ...A,
    handler: async ({ app, auth }) => {
      const st: string[] = [...(isManager(auth) ? ['revisao_gerencia'] : []), ...(isDirector(auth) ? ['homologacao_diretoria'] : [])];
      const mine = await app.db.select({ v: s.playbookVersions, p: s.playbooks }).from(s.playbookVersions).innerJoin(s.playbooks, eq(s.playbooks.id, s.playbookVersions.playbookId))
        .where(and(eq(s.playbookVersions.tenantId, auth.tenantId), or(st.length ? inArray(s.playbookVersions.status, st) : sql`false`, and(inArray(s.playbookVersions.status, ['revisao_gerencia', 'homologacao_diretoria', 'aprovada']), or(eq(s.playbookVersions.submittedBy, auth.userId), eq(s.playbookVersions.authorId, auth.userId))))))
        .orderBy(asc(s.playbookVersions.submittedAt));
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const nm = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? null : null);
      const items = [];
      for (const { v, p } of mine) {
        const [base] = p.currentVersionId ? await app.db.select({ number: s.playbookVersions.number }).from(s.playbookVersions).where(eq(s.playbookVersions.id, p.currentVersionId)) : [];
        const comments = await app.db.select().from(s.playbookDecisions).where(eq(s.playbookDecisions.versionId, v.id)).orderBy(asc(s.playbookDecisions.createdAt));
        const stage = stageOf(v.status);
        items.push({
          versionId: v.id, playbookId: p.id, code: p.code, title: (v.meta as unknown as PlaybookMeta).title, number: v.number, previous: base?.number ?? null, status: v.status, stage,
          requestedBy: nm(v.submittedBy), requestedAt: v.submittedAt, changeSummary: v.changeSummary, relevant: v.relevant, effectiveFrom: v.effectiveFrom, rowVersion: v.rowVersion,
          canDecide: !!stage && (await decides(app.db, auth, stage, p, v)), mine: v.submittedBy === auth.userId || v.authorId === auth.userId,
          comments: comments.map((c) => ({ stage: c.stage, decision: c.decision, note: c.note, by: nm(c.actorId), at: c.createdAt })),
        });
      }
      return { items };
    },
  }),
  defineRoute({
    method: 'GET', url: '/playbooks/manage', summary: 'Gestão: meus playbooks e da área, revisões, sugestões e indicadores de disseminação (por time e centro de custo)', ...A,
    handler: async ({ app, auth }) => {
      await ensurePlaybookJobs(app.db, auth.tenantId, auth.timezone);
      const { editable } = await visibleRows(app.db, auth);
      const list = await cards(app.db, auth, editable);
      const ids = editable.map((p) => p.id);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true)));
      const roles = await app.db.execute<{ user_id: string; key: string }>(sql`select ur.user_id, r.key from user_roles ur join roles r on r.id = ur.role_id where r.tenant_id = ${auth.tenantId}`);
      const memb = await app.db.select({ userId: s.teamMemberships.userId, teamId: s.teamMemberships.teamId }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(and(eq(s.teams.tenantId, auth.tenantId), eq(s.teams.active, true)));
      const ccs = await app.db.select({ id: s.costCenters.id, code: s.costCenters.code, name: s.costCenters.name, teamId: s.costCenters.teamId, leaderId: s.costCenters.leaderId, memberIds: s.costCenters.memberIds }).from(s.costCenters).where(and(eq(s.costCenters.tenantId, auth.tenantId), eq(s.costCenters.active, true)));
      const teams = await app.db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), eq(s.teams.active, true)));
      const viewerFor = (u: string) => {
        const t = memb.filter((m) => m.userId === u).map((m) => m.teamId);
        return { userId: u, teamIds: t, costCenterIds: ccs.filter((c) => (c.teamId && t.includes(c.teamId)) || c.leaderId === u || c.memberIds.includes(u)).map((c) => c.id), profiles: roles.rows.filter((r) => r.user_id === u).map((r) => r.key) };
      };
      const reads = ids.length ? await app.db.select().from(s.playbookReads).where(inArray(s.playbookReads.playbookId, ids)) : [];
      const acks = ids.length ? await app.db.select().from(s.playbookAcks).where(inArray(s.playbookAcks.playbookId, ids)) : [];
      const sugg = ids.length ? await app.db.select().from(s.playbookSuggestions).where(and(inArray(s.playbookSuggestions.playbookId, ids), inArray(s.playbookSuggestions.status, ['recebida', 'em_analise']))).orderBy(desc(s.playbookSuggestions.createdAt)) : [];
      const live = editable.filter((p) => p.currentVersionId);
      const indicators = live.map((p) => {
        const recipients = users.filter((u) => readerAllows(p, viewerFor(u.id)));
        const viewed = reads.filter((r) => r.playbookId === p.id && recipients.some((u) => u.id === r.userId));
        const acked = acks.filter((a) => a.versionId === p.currentVersionId && recipients.some((u) => u.id === a.userId));
        const pend = recipients.filter((u) => p.requiresAck && !acked.some((a) => a.userId === u.id));
        const pendTeams = teams.map((t) => ({ id: t.id, name: t.name, n: pend.filter((u) => memb.some((m) => m.userId === u.id && m.teamId === t.id)).length })).filter((x) => x.n);
        const pendCcs = ccs.map((c) => ({ id: c.id, name: `${c.code} · ${c.name}`, n: pend.filter((u) => viewerFor(u.id).costCenterIds.includes(c.id)).length })).filter((x) => x.n);
        return { id: p.id, code: p.code, title: p.title, requiresAck: p.requiresAck, recipients: recipients.length, viewed: viewed.length, views: viewed.reduce((t, r) => t + r.views, 0), acked: acked.length, pending: pend.length, pendingByTeam: pendTeams, pendingByCostCenter: pendCcs };
      });
      const today = todayIn(auth.timezone);
      return {
        items: list,
        reviews: { vencida: list.filter((c) => c.review === 'vencida').length, proxima: list.filter((c) => c.review === 'proxima').length, em_revisao: list.filter((c) => c.review === 'em_revisao').length, aguardando_aprovacao: list.filter((c) => c.review === 'aguardando_aprovacao').length, em_dia: list.filter((c) => c.review === 'em_dia').length },
        indicators,
        mostViewed: [...indicators].sort((a, b) => b.views - a.views).slice(0, 5),
        leastViewed: [...indicators].sort((a, b) => a.views - b.views).slice(0, 5),
        suggestions: sugg.map((x) => ({ id: x.id, playbookId: x.playbookId, code: editable.find((p) => p.id === x.playbookId)?.code, kind: x.kind, description: x.description, excerpt: x.excerpt, reason: x.reason, status: x.status, fileId: x.fileId, author: users.find((u) => u.id === x.authorId)?.name ?? null, at: x.createdAt })),
        today,
        can: { director: isDirector(auth), manager: isManager(auth) },
      };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/playbook-suggestions/:id', summary: 'Responde sugestão: em análise, aceita, rejeitada ou incorporada em nova versão (não muda o conteúdo vigente)', ...A,
    params: IdParams, body: z.object({ status: z.enum(SUGGESTION_STATUSES), response: z.string().trim().max(2000).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => {
      const [x] = await app.db.select().from(s.playbookSuggestions).where(and(eq(s.playbookSuggestions.id, params.id), eq(s.playbookSuggestions.tenantId, auth.tenantId)));
      if (!x) throw notFound('Sugestão não encontrada.');
      const p = await loadPb(app.db, auth, x.playbookId);
      if (!(await canEditPb(app.db, auth, p))) throw forbidden();
      if (body.status === 'rejeitada' && (body.response ?? '').length < 5) throw unprocessable('Explique a recusa para quem sugeriu.');
      await app.db.update(s.playbookSuggestions).set({ status: body.status, response: body.response ?? x.response, decidedBy: auth.userId, updatedAt: new Date() }).where(eq(s.playbookSuggestions.id, x.id));
      await ev(app.db, auth, p.id, null, 'sugestao_respondida', `Sugestão ${body.status}${body.response ? `: ${body.response}` : ''}.`, [x.authorId], `Sua sugestão em ${p.code}: ${body.status}`);
      return { ok: true };
    },
  }),
];

/** Avisa quem recebe o playbook (público autorizado) que há ciência a confirmar. */
async function notifyAudience(db: DbOrTx, auth: AuthContext, p: typeof s.playbooks.$inferSelect, title: string) {
  const users = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true)));
  const roles = await db.execute<{ user_id: string; key: string }>(sql`select ur.user_id, r.key from user_roles ur join roles r on r.id = ur.role_id where r.tenant_id = ${auth.tenantId}`);
  const memb = await db.select({ userId: s.teamMemberships.userId, teamId: s.teamMemberships.teamId }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(eq(s.teams.tenantId, auth.tenantId));
  const ccs = await db.select({ id: s.costCenters.id, teamId: s.costCenters.teamId, leaderId: s.costCenters.leaderId, memberIds: s.costCenters.memberIds }).from(s.costCenters).where(eq(s.costCenters.tenantId, auth.tenantId));
  const to = users.map((u) => u.id).filter((u) => {
    const t = memb.filter((m) => m.userId === u).map((m) => m.teamId);
    return readerAllows(p, { userId: u, teamIds: t, costCenterIds: ccs.filter((c) => (c.teamId && t.includes(c.teamId)) || c.leaderId === u || c.memberIds.includes(u)).map((c) => c.id), profiles: roles.rows.filter((r) => r.user_id === u).map((r) => r.key) });
  }).filter((u) => u !== auth.userId);
  if (to.length) await db.insert(s.governanceEvents).values({ tenantId: auth.tenantId, entity: 'playbook', entityId: p.id, type: 'ciencia', notify: to, payload: { title }, actorId: auth.userId });
  return to.length;
}
