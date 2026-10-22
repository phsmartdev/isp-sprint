/**
 * Funcionalidade 01 — Trilha Visual da Jornada: dados da trilha (sobre os marcos reais), histórico dos marcos e
 * links externos com destinatário, prazo, código opcional, revogação e registro de acessos.
 */
import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { JOURNEY_PHASES, JOURNEY_PHASE_LABELS, MAX_CODE_ATTEMPTS, afterWrongCode, linkRequestErrors, linkState, trailStops, type JourneyPhase } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { AppError, notFound, unprocessable } from '../http/errors';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { hashPassword, verifyPassword } from '../auth/password';
import { hashToken, newShareToken, todayIso } from '../services/cs';
import { account, requireEdit } from './cs';

async function loadJourney(db: DbOrTx, tenantId: string, id: string) {
  const [j] = await db.select().from(s.csJourneys).where(and(eq(s.csJourneys.id, id), eq(s.csJourneys.tenantId, tenantId))).limit(1);
  if (!j) throw notFound('Jornada não encontrada.');
  return j;
}

/** O que o cliente vê pelo link: marcos (título, fase, datas, situação). Observações internas só se o link permitir; nada de responsáveis internos. */
async function publicTrail(db: DbOrTx, journeyId: string, showNotes: boolean) {
  const [j] = await db.select({ j: s.csJourneys, client: s.contacts.name, csm: s.users.name }).from(s.csJourneys).innerJoin(s.contacts, eq(s.contacts.id, s.csJourneys.contactId)).leftJoin(s.users, eq(s.users.id, s.csJourneys.csmId)).where(eq(s.csJourneys.id, journeyId)).limit(1);
  const ms = await db.select().from(s.csMilestones).where(eq(s.csMilestones.journeyId, journeyId)).orderBy(asc(s.csMilestones.position));
  const t = trailStops(ms.map((m) => ({ id: m.id, phase: m.phase as JourneyPhase, title: m.title, plannedAt: m.plannedAt, doneAt: m.doneAt ? m.doneAt.toISOString().slice(0, 10) : null, notes: showNotes ? m.notes : null })), todayIso());
  return {
    client: j!.client, templateName: j!.j.templateName, startedAt: j!.j.startedAt, csmName: j!.csm, status: j!.j.status,
    phases: JOURNEY_PHASES.map((p) => ({ key: p, label: JOURNEY_PHASE_LABELS[p] })),
    ...t, generatedAt: new Date().toISOString(),
  };
}

const linkEvent = (db: DbOrTx, l: { id: string; tenantId: string }, type: 'criado' | 'acesso' | 'codigo_incorreto' | 'bloqueado' | 'revogado', actorId: string | null, meta: Record<string, unknown> = {}) =>
  db.insert(s.csJourneyLinkEvents).values({ tenantId: l.tenantId, linkId: l.id, type, actorId, meta });

async function openLink(db: DbOrTx, token: string) {
  const [l] = await db.select().from(s.csJourneyLinks).where(eq(s.csJourneyLinks.tokenHash, hashToken(token))).limit(1);
  const st = l ? linkState(l) : null;
  if (!l || st === 'revogado' || st === 'expirado') throw new AppError(404, 'Link expirado ou revogado', 'Peça um novo link ao seu gerente de sucesso.');
  if (st === 'bloqueado') throw new AppError(429, 'Muitas tentativas', `O acesso foi bloqueado por segurança. Tente de novo depois de ${l.lockedUntil!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' })}.`);
  return l;
}
async function grant(db: DbOrTx, l: typeof s.csJourneyLinks.$inferSelect) {
  await db.update(s.csJourneyLinks).set({ accessCount: l.accessCount + 1, lastAccessAt: new Date(), failedAttempts: 0, lockedUntil: null }).where(eq(s.csJourneyLinks.id, l.id));
  await linkEvent(db, l, 'acesso', null);
  return { needsCode: false as const, trail: await publicTrail(db, l.journeyId, l.showNotes), expiresAt: l.expiresAt };
}

export const journeyTrailRoutes = [
  defineRoute({
    method: 'GET', url: '/cs/journeys/:id/trail', summary: 'Trilha da jornada: paradas com situação, histórico dos marcos e links externos', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const j = await loadJourney(app.db, auth.tenantId, params.id);
      const x = await account(app.db, auth, j.contactId);
      const ms = await app.db.select({ m: s.csMilestones, owner: s.users.name }).from(s.csMilestones).leftJoin(s.users, eq(s.users.id, s.csMilestones.ownerId)).where(eq(s.csMilestones.journeyId, j.id)).orderBy(asc(s.csMilestones.position));
      const trail = trailStops(ms.map(({ m, owner }) => ({ ...m, phase: m.phase as JourneyPhase, doneAt: m.doneAt ? m.doneAt.toISOString().slice(0, 10) : null, doneAtFull: m.doneAt, ownerName: owner })), todayIso());
      const ev = await app.db.select({ e: s.csMilestoneEvents, actor: s.users.name }).from(s.csMilestoneEvents).leftJoin(s.users, eq(s.users.id, s.csMilestoneEvents.actorId)).where(eq(s.csMilestoneEvents.journeyId, j.id)).orderBy(desc(s.csMilestoneEvents.createdAt)).limit(500);
      const userIds = [...new Set(ev.flatMap(({ e }) => (e.type === 'responsavel' ? [e.payload.from, e.payload.to] : [])).filter((v): v is string => typeof v === 'string'))];
      const names = new Map((userIds.length ? await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, userIds)) : []).map((u) => [u.id, u.name]));
      const links = await app.db.select({ l: s.csJourneyLinks, by: s.users.name }).from(s.csJourneyLinks).leftJoin(s.users, eq(s.users.id, s.csJourneyLinks.createdBy)).where(eq(s.csJourneyLinks.journeyId, j.id)).orderBy(desc(s.csJourneyLinks.createdAt));
      const lev = links.length ? await app.db.select().from(s.csJourneyLinkEvents).where(inArray(s.csJourneyLinkEvents.linkId, links.map((l) => l.l.id))).orderBy(desc(s.csJourneyLinkEvents.createdAt)).limit(300) : [];
      return {
        canEdit: x.canEdit, client: { id: x.contact.id, name: x.contact.name }, journey: { id: j.id, templateName: j.templateName, startedAt: j.startedAt, status: j.status },
        phases: JOURNEY_PHASES.map((p) => ({ key: p, label: JOURNEY_PHASE_LABELS[p] })),
        ...trail,
        events: ev.map(({ e, actor }) => ({ ...e, actorName: actor ?? 'Sistema', fromName: e.type === 'responsavel' ? names.get(e.payload.from as string) ?? null : undefined, toName: e.type === 'responsavel' ? names.get(e.payload.to as string) ?? null : undefined })),
        links: links.map(({ l, by }) => ({
          id: l.id, label: l.label, expiresAt: l.expiresAt, requiresCode: !!l.codeHash, showNotes: l.showNotes, state: linkState(l), accessCount: l.accessCount, lastAccessAt: l.lastAccessAt,
          failedAttempts: l.failedAttempts, revokedAt: l.revokedAt, revokeReason: l.revokeReason, createdByName: by, createdAt: l.createdAt,
          events: lev.filter((e) => e.linkId === l.id).slice(0, 20).map((e) => ({ type: e.type, createdAt: e.createdAt })),
        })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/cs/journeys/:id/links', summary: 'Cria link externo da trilha (destinatário, prazo, código opcional). O código aparece uma única vez.', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ label: z.string().trim().max(120), days: z.number().int(), requireCode: z.boolean().default(true), showNotes: z.boolean().default(false) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const j = await loadJourney(app.db, auth.tenantId, params.id);
      requireEdit(await account(app.db, auth, j.contactId));
      const errs = linkRequestErrors(body);
      if (errs.length) throw unprocessable(errs[0]!, errs.map((m) => ({ path: 'link', message: m })));
      const t = newShareToken();
      const code = body.requireCode ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null;
      const expiresAt = new Date(Date.now() + body.days * 86_400_000);
      const [l] = await app.db.insert(s.csJourneyLinks).values({ tenantId: auth.tenantId, journeyId: j.id, label: body.label, tokenHash: t.hash, codeHash: code ? await hashPassword(code) : null, showNotes: body.showNotes, expiresAt, createdBy: auth.userId }).returning();
      await linkEvent(app.db, l!, 'criado', auth.userId, { days: body.days, requiresCode: !!code, showNotes: body.showNotes });
      await audit(app.db, req, { action: 'cs.journey_link.created', tenantId: auth.tenantId, actorId: auth.userId, entityType: 'cs_journey', entityId: j.id, metadata: { linkId: l!.id, label: body.label, days: body.days, requiresCode: !!code } });
      reply.code(201);
      return { id: l!.id, url: `/j/${t.token}`, code, expiresAt };
    },
  }),
  defineRoute({
    method: 'POST', url: '/cs/journey-links/:id/revoke', summary: 'Revoga o link externo (motivo obrigatório); o acesso para na hora', tag: 'Sucesso do Cliente', module: 'clientes', params: IdParams,
    body: z.object({ reason: z.string().trim().min(5).max(500) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [l] = await app.db.select().from(s.csJourneyLinks).where(and(eq(s.csJourneyLinks.id, params.id), eq(s.csJourneyLinks.tenantId, auth.tenantId))).limit(1);
      if (!l) throw notFound('Link não encontrado.');
      const j = await loadJourney(app.db, auth.tenantId, l.journeyId);
      requireEdit(await account(app.db, auth, j.contactId));
      if (l.revokedAt) throw unprocessable('Este link já foi revogado.');
      await app.db.update(s.csJourneyLinks).set({ revokedAt: new Date(), revokedBy: auth.userId, revokeReason: body.reason }).where(eq(s.csJourneyLinks.id, l.id));
      await linkEvent(app.db, l, 'revogado', auth.userId, { reason: body.reason });
      await audit(app.db, req, { action: 'cs.journey_link.revoked', tenantId: auth.tenantId, actorId: auth.userId, entityType: 'cs_journey', entityId: j.id, metadata: { linkId: l.id, reason: body.reason } });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------ acesso externo (sem login)
  defineRoute({
    method: 'GET', url: '/public/journey/:token', summary: 'Trilha compartilhada: pede o código quando o link exige; senão mostra a trilha', tag: 'Sucesso do Cliente', public: true,
    params: z.object({ token: z.string().min(20).max(100) }),
    rateLimit: (c) => ({ max: c.loginRateLimitPerMinute * 4, timeWindow: '1 minute' }),
    handler: async ({ app, params }) => {
      const l = await openLink(app.db, params.token);
      if (l.codeHash) return { needsCode: true as const, attemptsLeft: MAX_CODE_ATTEMPTS - l.failedAttempts };
      return grant(app.db, l);
    },
  }),
  defineRoute({
    method: 'POST', url: '/public/journey/:token/unlock', summary: 'Libera a trilha com o código de acesso (bloqueia após tentativas erradas)', tag: 'Sucesso do Cliente', public: true,
    params: z.object({ token: z.string().min(20).max(100) }), body: z.object({ code: z.string().trim().max(12) }),
    rateLimit: (c) => ({ max: c.loginRateLimitPerMinute, timeWindow: '1 minute' }),
    handler: async ({ app, params, body }) => {
      const l = await openLink(app.db, params.token);
      if (!l.codeHash) return grant(app.db, l);
      if (/^\d{6}$/.test(body.code) && (await verifyPassword(body.code, l.codeHash))) return grant(app.db, l);
      const next = afterWrongCode(l.failedAttempts);
      await app.db.update(s.csJourneyLinks).set(next).where(eq(s.csJourneyLinks.id, l.id));
      await linkEvent(app.db, l, next.lockedUntil ? 'bloqueado' : 'codigo_incorreto', null, { attempt: next.failedAttempts });
      if (next.lockedUntil) throw new AppError(429, 'Muitas tentativas', 'Código incorreto. O acesso foi bloqueado por 15 minutos por segurança.');
      throw new AppError(403, 'Código incorreto', `Confira o código de 6 dígitos. Restam ${MAX_CODE_ATTEMPTS - next.failedAttempts} tentativa(s).`);
    },
  }),
];
