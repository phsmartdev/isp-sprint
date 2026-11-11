/**
 * Pessoas & Cultura — Etapa 3 (comunidades): cadastro, participação (entrar, pedir, convidar, aprovar),
 * papéis (responsável, moderador, membro), fixar publicações e arquivar. Tudo verificado no servidor.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { Config } from '../config';
import { notifyPeople } from '../services/people/notify';
import { audit } from '../services/audit';
import { peopleCaps, peopleSettingsOf } from '../services/people/settings';
import { canCreateCommunity, communityPerms, KIND_LABEL, loadCommunity, refreshMemberCount, type CommunityRole } from '../services/people/communities';
import { institutionalOf, publicCard } from '../services/people/profiles';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';

const M = { tag: 'Pessoas & Cultura', module: 'pessoas' as const };
const Id = z.object({ id: z.string().uuid('ID inválido') });
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const Body = z.object({
  name: z.string().trim().min(3, 'Nome com ao menos 3 letras').max(80),
  description: text(600), rules: text(2000), category: text(60),
  kind: z.enum(['publica', 'privada', 'institucional']).default('publica'),
  coverMediaId: z.string().uuid().nullable().optional(), avatarMediaId: z.string().uuid().nullable().optional(),
});

async function caps(db: DbOrTx, auth: AuthContext) { return peopleCaps(auth, await peopleSettingsOf(db, auth.tenantId)); }

/** Capa/avatar: imagem enviada pela própria pessoa, ainda solta (ou já desta comunidade). */
async function useImage(db: DbOrTx, auth: AuthContext, communityId: string, mediaId: string | null | undefined) {
  if (!mediaId) return;
  const [m] = await db.select({ id: s.peopleMedia.id }).from(s.peopleMedia).where(and(eq(s.peopleMedia.id, mediaId), eq(s.peopleMedia.tenantId, auth.tenantId), eq(s.peopleMedia.kind, 'imagem'), isNull(s.peopleMedia.postId),
    or(and(eq(s.peopleMedia.ownerId, auth.userId), isNull(s.peopleMedia.communityId)), eq(s.peopleMedia.communityId, communityId)))).limit(1);
  if (!m) throw unprocessable('Imagem inválida para a comunidade.');
  await db.update(s.peopleMedia).set({ communityId }).where(eq(s.peopleMedia.id, m.id));
}

function dto(c: typeof s.peopleCommunities.$inferSelect, role: CommunityRole | null, perms: ReturnType<typeof communityPerms>, pending: { id: string; kind: string } | null) {
  return {
    id: c.id, name: c.name, description: c.description, rules: c.rules, category: c.category, kind: c.kind, kindLabel: KIND_LABEL[c.kind], status: c.status,
    coverMediaId: c.coverMediaId, avatarMediaId: c.avatarMediaId, memberCount: c.memberCount, createdAt: c.createdAt, archivedAt: c.archivedAt,
    myRole: role, perms, pending,
  };
}

export const peopleCommunityRoutes = [
  defineRoute({
    method: 'GET', url: '/pessoas/comunidades', summary: 'Comunidades: todas as ativas (nome e descrição) ou só as minhas, com busca e categoria', ...M,
    query: z.object({ q: z.string().trim().max(80).optional(), categoria: z.string().trim().max(60).optional(), minhas: z.coerce.boolean().optional(), arquivadas: z.coerce.boolean().optional() }),
    handler: async ({ app, auth, query }) => {
      const cp = await caps(app.db, auth);
      const t = query.q ? `%${query.q.replace(/[%_\\]/g, '\\$&')}%` : null;
      const rows = await app.db.select({ c: s.peopleCommunities, role: s.peopleCommunityMembers.role }).from(s.peopleCommunities)
        .leftJoin(s.peopleCommunityMembers, and(eq(s.peopleCommunityMembers.communityId, s.peopleCommunities.id), eq(s.peopleCommunityMembers.userId, auth.userId)))
        .where(and(
          eq(s.peopleCommunities.tenantId, auth.tenantId),
          query.arquivadas ? eq(s.peopleCommunities.status, 'arquivada') : eq(s.peopleCommunities.status, 'ativa'),
          query.minhas ? sql`${s.peopleCommunityMembers.userId} is not null` : undefined,
          t ? or(ilike(s.peopleCommunities.name, t), ilike(s.peopleCommunities.description, t)) : undefined,
          query.categoria ? eq(s.peopleCommunities.category, query.categoria) : undefined,
        )).orderBy(asc(s.peopleCommunities.name)).limit(200);
      const pend = rows.length ? await app.db.select({ id: s.peopleCommunityRequests.id, communityId: s.peopleCommunityRequests.communityId, kind: s.peopleCommunityRequests.kind }).from(s.peopleCommunityRequests)
        .where(and(eq(s.peopleCommunityRequests.userId, auth.userId), eq(s.peopleCommunityRequests.status, 'pendente'), inArray(s.peopleCommunityRequests.communityId, rows.map((r) => r.c.id)))) : [];
      const cats = await app.db.selectDistinct({ category: s.peopleCommunities.category }).from(s.peopleCommunities).where(and(eq(s.peopleCommunities.tenantId, auth.tenantId), eq(s.peopleCommunities.status, 'ativa'), sql`${s.peopleCommunities.category} is not null`));
      return {
        items: rows.map((r) => { const role = r.role as CommunityRole | null; const p = pend.find((x) => x.communityId === r.c.id); return dto(r.c, role, communityPerms(r.c, role, cp), p ? { id: p.id, kind: p.kind } : null); }),
        categories: cats.map((x) => x.category!).sort(),
        canCreate: canCreateCommunity(auth, cp, 'publica'), canCreateInstitutional: canCreateCommunity(auth, cp, 'institucional'),
      };
    },
  }),

  defineRoute({
    method: 'POST', url: '/pessoas/comunidades', summary: 'Cria comunidade (quem cria vira responsável)', ...M, body: Body,
    rateLimit: () => ({ max: 10, timeWindow: '1 minute' }),
    handler: async ({ app, auth, body, req, reply }) => {
      const cp = await caps(app.db, auth);
      if (!canCreateCommunity(auth, cp, body.kind)) throw forbidden(body.kind === 'institucional' ? 'Comunidade institucional só pela Comunicação Interna ou por Pessoas e Cultura.' : 'Seu perfil não cria comunidades.');
      const [dup] = await app.db.select({ id: s.peopleCommunities.id }).from(s.peopleCommunities).where(and(eq(s.peopleCommunities.tenantId, auth.tenantId), sql`lower(${s.peopleCommunities.name}) = lower(${body.name})`)).limit(1);
      if (dup) throw unprocessable('Já existe uma comunidade com este nome.', [{ path: 'name', message: 'Nome em uso' }]);
      const c = await app.db.transaction(async (tx) => {
        const [c] = await tx.insert(s.peopleCommunities).values({ tenantId: auth.tenantId, name: body.name, description: body.description, rules: body.rules, category: body.category, kind: body.kind, createdBy: auth.userId, memberCount: 1 }).returning();
        await tx.insert(s.peopleCommunityMembers).values({ communityId: c!.id, userId: auth.userId, tenantId: auth.tenantId, role: 'responsavel' });
        await useImage(tx, auth, c!.id, body.coverMediaId); await useImage(tx, auth, c!.id, body.avatarMediaId);
        const [u] = await tx.update(s.peopleCommunities).set({ coverMediaId: body.coverMediaId ?? null, avatarMediaId: body.avatarMediaId ?? null }).where(eq(s.peopleCommunities.id, c!.id)).returning();
        return u!;
      });
      await audit(app.db, req, { action: 'people.community.create', entityType: 'people_community', entityId: c.id, metadata: { name: c.name, kind: c.kind } });
      reply.code(201);
      return dto(c, 'responsavel', communityPerms(c, 'responsavel', await caps(app.db, auth)), null);
    },
  }),

  defineRoute({
    method: 'GET', url: '/pessoas/comunidades/:id', summary: 'Comunidade: dados, meu papel, o que posso fazer e os responsáveis', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      const cp = await caps(app.db, auth);
      const [pend] = await app.db.select({ id: s.peopleCommunityRequests.id, kind: s.peopleCommunityRequests.kind }).from(s.peopleCommunityRequests).where(and(eq(s.peopleCommunityRequests.communityId, c.id), eq(s.peopleCommunityRequests.userId, auth.userId), eq(s.peopleCommunityRequests.status, 'pendente'))).limit(1);
      const staff = await app.db.select({ userId: s.peopleCommunityMembers.userId, role: s.peopleCommunityMembers.role }).from(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), ne(s.peopleCommunityMembers.role, 'membro')));
      const people = await institutionalOf(app.db, auth.tenantId, staff.map((x) => x.userId));
      const perms = communityPerms(c, role, cp);
      const [pendingCount] = perms.moderate ? await app.db.select({ n: sql<number>`count(*)::int` }).from(s.peopleCommunityRequests).where(and(eq(s.peopleCommunityRequests.communityId, c.id), eq(s.peopleCommunityRequests.kind, 'pedido'), eq(s.peopleCommunityRequests.status, 'pendente'))) : [{ n: 0 }];
      return { ...dto(c, role, perms, pend ?? null), staff: staff.map((x) => ({ role: x.role, ...publicCard(people.get(x.userId)!) })).filter((x) => x.name), pendingRequests: pendingCount?.n ?? 0 };
    },
  }),

  defineRoute({
    method: 'PATCH', url: '/pessoas/comunidades/:id', summary: 'Edita a comunidade (responsável ou administração do módulo)', ...M, params: Id, body: Body.partial(),
    handler: async ({ app, auth, params, body, req }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      const cp = await caps(app.db, auth);
      if (!communityPerms(c, role, cp).manage) throw forbidden('Só o responsável pela comunidade ou a administração do módulo edita.');
      if (body.kind && body.kind !== c.kind && (body.kind === 'institucional' || c.kind === 'institucional') && !canCreateCommunity(auth, cp, 'institucional')) throw forbidden('Comunidade institucional só pela Comunicação Interna ou por Pessoas e Cultura.');
      if (body.name && body.name.toLowerCase() !== c.name.toLowerCase()) {
        const [dup] = await app.db.select({ id: s.peopleCommunities.id }).from(s.peopleCommunities).where(and(eq(s.peopleCommunities.tenantId, auth.tenantId), sql`lower(${s.peopleCommunities.name}) = lower(${body.name})`, ne(s.peopleCommunities.id, c.id))).limit(1);
        if (dup) throw unprocessable('Já existe uma comunidade com este nome.');
      }
      const u = await app.db.transaction(async (tx) => {
        if (body.coverMediaId !== undefined) await useImage(tx, auth, c.id, body.coverMediaId);
        if (body.avatarMediaId !== undefined) await useImage(tx, auth, c.id, body.avatarMediaId);
        const { coverMediaId, avatarMediaId, ...rest } = body;
        const [u] = await tx.update(s.peopleCommunities).set({ ...rest, ...(coverMediaId !== undefined ? { coverMediaId } : {}), ...(avatarMediaId !== undefined ? { avatarMediaId } : {}), updatedAt: new Date() }).where(eq(s.peopleCommunities.id, c.id)).returning();
        return u!;
      });
      await audit(app.db, req, { action: 'people.community.update', entityType: 'people_community', entityId: c.id, metadata: { fields: Object.keys(body) } });
      return dto(u, role, communityPerms(u, role, cp), null);
    },
  }),

  defineRoute({
    method: 'POST', url: '/pessoas/comunidades/:id/arquivo', summary: 'Arquiva ou reativa a comunidade (arquivada: só leitura, some da lista)', ...M, params: Id,
    body: z.object({ archived: z.boolean() }),
    handler: async ({ app, auth, params, body, req }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      if (!communityPerms(c, role, await caps(app.db, auth)).manage) throw forbidden('Só o responsável ou a administração do módulo arquiva.');
      await app.db.update(s.peopleCommunities).set({ status: body.archived ? 'arquivada' : 'ativa', archivedAt: body.archived ? new Date() : null, updatedAt: new Date() }).where(eq(s.peopleCommunities.id, c.id));
      await audit(app.db, req, { action: body.archived ? 'people.community.archive' : 'people.community.unarchive', entityType: 'people_community', entityId: c.id });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ participação
  defineRoute({
    method: 'POST', url: '/pessoas/comunidades/:id/participar', summary: 'Entra (pública/institucional), aceita convite ou pede para participar (privada)', ...M, params: Id,
    body: z.object({ message: text(300) }).default({}),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      if (c.status !== 'ativa') throw unprocessable('Comunidade arquivada.');
      if (role) return { status: 'membro' as const };
      const [invite] = await app.db.select({ id: s.peopleCommunityRequests.id }).from(s.peopleCommunityRequests).where(and(eq(s.peopleCommunityRequests.communityId, c.id), eq(s.peopleCommunityRequests.userId, auth.userId), eq(s.peopleCommunityRequests.kind, 'convite'), eq(s.peopleCommunityRequests.status, 'pendente'))).limit(1);
      if (c.kind !== 'privada' || invite) {
        await app.db.transaction(async (tx) => {
          await tx.insert(s.peopleCommunityMembers).values({ communityId: c.id, userId: auth.userId, tenantId: auth.tenantId }).onConflictDoNothing();
          if (invite) await tx.update(s.peopleCommunityRequests).set({ status: 'aprovado', decidedBy: auth.userId, decidedAt: new Date() }).where(eq(s.peopleCommunityRequests.id, invite.id));
          await refreshMemberCount(tx, c.id);
        });
        return { status: 'membro' as const };
      }
      await app.db.insert(s.peopleCommunityRequests).values({ tenantId: auth.tenantId, communityId: c.id, userId: auth.userId, kind: 'pedido', message: body.message, createdBy: auth.userId }).onConflictDoNothing();
      return { status: 'pendente' as const };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/comunidades/:id/sair', summary: 'Sai da comunidade (ou cancela o próprio pedido)', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      await app.db.update(s.peopleCommunityRequests).set({ status: 'cancelado', decidedBy: auth.userId, decidedAt: new Date() }).where(and(eq(s.peopleCommunityRequests.communityId, c.id), eq(s.peopleCommunityRequests.userId, auth.userId), eq(s.peopleCommunityRequests.kind, 'pedido'), eq(s.peopleCommunityRequests.status, 'pendente')));
      if (!role) return { ok: true };
      if (role === 'responsavel') {
        const [{ n }] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.role, 'responsavel'))) as [{ n: number }];
        if (n <= 1) throw unprocessable('Defina outro responsável antes de sair.');
      }
      await app.db.transaction(async (tx) => {
        await tx.delete(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.userId, auth.userId)));
        await refreshMemberCount(tx, c.id);
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET', url: '/pessoas/comunidades/:id/membros', summary: 'Membros da comunidade (privada: só membros e quem gerencia)', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      const perms = communityPerms(c, role, await caps(app.db, auth));
      if (!perms.read && !perms.manage) throw forbidden('Só membros veem quem participa desta comunidade.');
      const rows = await app.db.select({ userId: s.peopleCommunityMembers.userId, role: s.peopleCommunityMembers.role, joinedAt: s.peopleCommunityMembers.joinedAt }).from(s.peopleCommunityMembers).where(eq(s.peopleCommunityMembers.communityId, c.id)).limit(2000);
      const people = await institutionalOf(app.db, auth.tenantId, rows.map((r) => r.userId));
      const order: Record<string, number> = { responsavel: 0, moderador: 1, membro: 2 };
      return { items: rows.filter((r) => people.get(r.userId)?.active).map((r) => ({ ...publicCard(people.get(r.userId)!), role: r.role, joinedAt: r.joinedAt })).sort((a, b) => order[a.role]! - order[b.role]! || a.name.localeCompare(b.name, 'pt-BR')) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/comunidades/:id/convites', summary: 'Convida colegas (responsável, moderador ou administração do módulo)', ...M, params: Id,
    body: z.object({ userIds: z.array(z.string().uuid()).min(1).max(50) }),
    handler: async ({ app, auth, params, body, req }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      if (!communityPerms(c, role, await caps(app.db, auth)).moderate) throw forbidden('Só responsável e moderadores convidam.');
      const valid = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), inArray(s.users.id, body.userIds)));
      const members = new Set((await app.db.select({ u: s.peopleCommunityMembers.userId }).from(s.peopleCommunityMembers).where(eq(s.peopleCommunityMembers.communityId, c.id))).map((x) => x.u));
      const to = valid.map((v) => v.id).filter((id) => !members.has(id));
      let invited = 0;
      for (const userId of to) {
        // pedido pendente da própria pessoa + convite = entra direto
        const [req0] = await app.db.select({ id: s.peopleCommunityRequests.id }).from(s.peopleCommunityRequests).where(and(eq(s.peopleCommunityRequests.communityId, c.id), eq(s.peopleCommunityRequests.userId, userId), eq(s.peopleCommunityRequests.kind, 'pedido'), eq(s.peopleCommunityRequests.status, 'pendente'))).limit(1);
        if (req0) { await decide(app.db, auth, req0.id, true, app.config); continue; }
        const r = await app.db.insert(s.peopleCommunityRequests).values({ tenantId: auth.tenantId, communityId: c.id, userId, kind: 'convite', createdBy: auth.userId }).onConflictDoNothing().returning({ id: s.peopleCommunityRequests.id });
        invited += r.length;
        if (r.length) await notifyPeople(app.db, app.config, auth.tenantId, [{ userId, event: 'convite_comunidade', title: `${auth.name.split(' ')[0]} convidou você para a comunidade ${c.name}`, link: '/pessoas/comunidades', actorId: auth.userId, dedupeKey: `convite:${r[0]!.id}` }]).catch((e) => console.error('aviso de convite', e));
      }
      await audit(app.db, req, { action: 'people.community.invite', entityType: 'people_community', entityId: c.id, metadata: { invited, userIds: to } });
      return { invited };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/comunidades/:id/pedidos', summary: 'Pedidos de participação pendentes (moderação)', ...M, params: Id,
    handler: async ({ app, auth, params }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      if (!communityPerms(c, role, await caps(app.db, auth)).moderate) throw forbidden('Só responsável e moderadores veem os pedidos.');
      const rows = await app.db.select().from(s.peopleCommunityRequests).where(and(eq(s.peopleCommunityRequests.communityId, c.id), eq(s.peopleCommunityRequests.status, 'pendente'))).orderBy(asc(s.peopleCommunityRequests.createdAt));
      const people = await institutionalOf(app.db, auth.tenantId, rows.map((r) => r.userId));
      return { items: rows.map((r) => ({ id: r.id, kind: r.kind, message: r.message, createdAt: r.createdAt, person: publicCard(people.get(r.userId)!) })) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/comunidades-convites', summary: 'Meus convites pendentes', ...M,
    handler: async ({ app, auth }) => {
      const rows = await app.db.select({ id: s.peopleCommunityRequests.id, createdAt: s.peopleCommunityRequests.createdAt, communityId: s.peopleCommunities.id, name: s.peopleCommunities.name, kind: s.peopleCommunities.kind, invitedBy: s.peopleCommunityRequests.createdBy })
        .from(s.peopleCommunityRequests).innerJoin(s.peopleCommunities, eq(s.peopleCommunities.id, s.peopleCommunityRequests.communityId))
        .where(and(eq(s.peopleCommunityRequests.tenantId, auth.tenantId), eq(s.peopleCommunityRequests.userId, auth.userId), eq(s.peopleCommunityRequests.kind, 'convite'), eq(s.peopleCommunityRequests.status, 'pendente'), eq(s.peopleCommunities.status, 'ativa')))
        .orderBy(desc(s.peopleCommunityRequests.createdAt));
      const people = await institutionalOf(app.db, auth.tenantId, rows.map((r) => r.invitedBy));
      return { items: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, community: { id: r.communityId, name: r.name, kind: r.kind, kindLabel: KIND_LABEL[r.kind] }, invitedBy: people.get(r.invitedBy)?.name ?? null })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/pessoas/comunidades-pedidos/:id/decisao', summary: 'Decide pedido (moderação) ou convite (a própria pessoa)', ...M, params: Id,
    body: z.object({ approve: z.boolean() }),
    handler: async ({ app, auth, params, body, req }) => {
      const r = await decide(app.db, auth, params.id, body.approve, app.config);
      await audit(app.db, req, { action: body.approve ? 'people.community.request.approve' : 'people.community.request.reject', entityType: 'people_community', entityId: r.communityId, metadata: { requestId: params.id, kind: r.kind, userId: r.userId } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'PATCH', url: '/pessoas/comunidades/:id/membros/:userId', summary: 'Define o papel do membro (responsável da comunidade ou administração do módulo)', ...M,
    params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }), body: z.object({ role: z.enum(['responsavel', 'moderador', 'membro']) }),
    handler: async ({ app, auth, params, body, req }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      if (!communityPerms(c, role, await caps(app.db, auth)).manage) throw forbidden('Só o responsável ou a administração do módulo define papéis.');
      const [m] = await app.db.select({ role: s.peopleCommunityMembers.role }).from(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.userId, params.userId))).limit(1);
      if (!m) throw notFound('Membro não encontrado.');
      if (m.role === 'responsavel' && body.role !== 'responsavel') {
        const [{ n }] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.role, 'responsavel'))) as [{ n: number }];
        if (n <= 1) throw unprocessable('A comunidade precisa de ao menos um responsável.');
      }
      await app.db.update(s.peopleCommunityMembers).set({ role: body.role }).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.userId, params.userId)));
      await audit(app.db, req, { action: 'people.community.role', entityType: 'people_community', entityId: c.id, metadata: { userId: params.userId, from: m.role, to: body.role } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/pessoas/comunidades/:id/membros/:userId', summary: 'Remove membro (moderação remove membros; responsáveis só pelo responsável ou administração)', ...M,
    params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
    handler: async ({ app, auth, params, req, reply }) => {
      const { c, role } = await loadCommunity(app.db, auth, params.id);
      const perms = communityPerms(c, role, await caps(app.db, auth));
      const [m] = await app.db.select({ role: s.peopleCommunityMembers.role }).from(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.userId, params.userId))).limit(1);
      if (!m) throw notFound('Membro não encontrado.');
      if (!(m.role === 'membro' ? perms.moderate : perms.manage)) throw forbidden('Sem permissão para remover este membro.');
      if (m.role === 'responsavel') {
        const [{ n }] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.role, 'responsavel'))) as [{ n: number }];
        if (n <= 1) throw unprocessable('A comunidade precisa de ao menos um responsável.');
      }
      await app.db.transaction(async (tx) => {
        await tx.delete(s.peopleCommunityMembers).where(and(eq(s.peopleCommunityMembers.communityId, c.id), eq(s.peopleCommunityMembers.userId, params.userId)));
        await refreshMemberCount(tx, c.id);
      });
      await audit(app.db, req, { action: 'people.community.remove', entityType: 'people_community', entityId: c.id, metadata: { userId: params.userId } });
      return reply.code(204).send();
    },
  }),

  defineRoute({
    method: 'PUT', url: '/pessoas/posts/:id/fixar', summary: 'Fixa ou desafixa a publicação no topo da comunidade (responsável/moderador)', ...M, params: Id,
    body: z.object({ pinned: z.boolean() }),
    handler: async ({ app, auth, params, body, req }) => {
      const [p] = await app.db.select({ id: s.peoplePosts.id, communityId: s.peoplePosts.communityId, status: s.peoplePosts.status }).from(s.peoplePosts).where(and(eq(s.peoplePosts.id, params.id), eq(s.peoplePosts.tenantId, auth.tenantId), isNull(s.peoplePosts.deletedAt))).limit(1);
      if (!p || !p.communityId || p.status !== 'publicado') throw notFound('Publicação de comunidade não encontrada.');
      const { c, role } = await loadCommunity(app.db, auth, p.communityId);
      const perms = communityPerms(c, role, await caps(app.db, auth));
      if (!perms.read) throw notFound('Publicação de comunidade não encontrada.');
      if (!perms.moderate) throw forbidden('Só responsável e moderadores fixam publicações.');
      if (body.pinned) {
        const [{ n }] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.peoplePosts).where(and(eq(s.peoplePosts.communityId, c.id), sql`${s.peoplePosts.pinnedAt} is not null`, isNull(s.peoplePosts.deletedAt), ne(s.peoplePosts.id, p.id))) as [{ n: number }];
        if (n >= 3) throw unprocessable('No máximo 3 publicações fixadas. Desafixe uma antes.');
      }
      await app.db.update(s.peoplePosts).set({ pinnedAt: body.pinned ? new Date() : null }).where(eq(s.peoplePosts.id, p.id));
      await audit(app.db, req, { action: body.pinned ? 'people.post.pin' : 'people.post.unpin', entityType: 'people_post', entityId: p.id, metadata: { communityId: c.id } });
      return { ok: true };
    },
  }),
];

/** Pedido: moderação decide. Convite: a própria pessoa aceita ou recusa. */
async function decide(db: DbOrTx, auth: AuthContext, requestId: string, approve: boolean, config: Config) {
  const [r] = await db.select().from(s.peopleCommunityRequests).where(and(eq(s.peopleCommunityRequests.id, requestId), eq(s.peopleCommunityRequests.tenantId, auth.tenantId), eq(s.peopleCommunityRequests.status, 'pendente'))).limit(1);
  if (!r) throw notFound('Pedido não encontrado ou já decidido.');
  const { c, role } = await loadCommunity(db, auth, r.communityId);
  if (r.kind === 'convite' ? r.userId !== auth.userId : !communityPerms(c, role, await caps(db, auth)).moderate) throw forbidden(r.kind === 'convite' ? 'Só a pessoa convidada responde ao convite.' : 'Só responsável e moderadores decidem pedidos.');
  await (db as typeof db).transaction(async (tx) => {
    await tx.update(s.peopleCommunityRequests).set({ status: approve ? 'aprovado' : 'recusado', decidedBy: auth.userId, decidedAt: new Date() }).where(eq(s.peopleCommunityRequests.id, r.id));
    if (approve) { await tx.insert(s.peopleCommunityMembers).values({ communityId: c.id, userId: r.userId, tenantId: auth.tenantId }).onConflictDoNothing(); await refreshMemberCount(tx, c.id); }
  });
  if (approve && r.kind === 'pedido') await notifyPeople(db, config, auth.tenantId, [{ userId: r.userId, event: 'participacao_aprovada', title: `Sua participação na comunidade ${c.name} foi aprovada`, link: `/pessoas/comunidades/${c.id}`, actorId: auth.userId, dedupeKey: `participacao:${r.id}` }]).catch((e) => console.error('aviso de comunidade', e));
  return r;
}
