/**
 * Pessoas & Cultura — Etapa 1 (fundação): Meu Espaço, perfil social, diretório de colegas e configurações.
 * Toda rota passa pelo módulo técnico "pessoas" e pela funcionalidade do módulo de negócio (liberação por equipe/pessoa).
 */
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { PeopleSettings, peopleCaps, peopleSettingsOf } from '../services/people/settings';
import { institutionalOf, publicCard } from '../services/people/profiles';

const UserParams = z.object({ userId: z.string().uuid('ID inválido') });
const tag = 'Pessoas & Cultura';
const words = (max: number, each: number) => z.array(z.string().trim().min(2).max(each)).max(max).transform((xs) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()]);

export const peopleRoutes = [
  defineRoute({
    method: 'GET', url: '/pessoas/me', summary: 'Meu Espaço: quem sou, o que posso fazer no módulo e o estado do meu perfil', tag, module: 'pessoas',
    handler: async ({ app, auth }) => {
      const st = await peopleSettingsOf(app.db, auth.tenantId);
      const [inst, [prof]] = await Promise.all([
        institutionalOf(app.db, auth.tenantId, [auth.userId]),
        app.db.select().from(s.peopleProfiles).where(eq(s.peopleProfiles.userId, auth.userId)).limit(1),
      ]);
      const me = inst.get(auth.userId)!;
      return {
        me: { ...publicCard(me), firstName: me.name.split(' ')[0] },
        caps: peopleCaps(auth, st),
        limits: st.limits,
        profileComplete: !!(prof?.bio?.trim() && (prof.interests.length || prof.skills.length)),
      };
    },
  }),

  defineRoute({
    method: 'GET', url: '/pessoas/perfis/:userId', summary: 'Perfil social de um colaborador da empresa (institucional + o que ele escolheu mostrar)', tag, module: 'pessoas', params: UserParams,
    handler: async ({ app, auth, params }) => {
      const inst = (await institutionalOf(app.db, auth.tenantId, [params.userId])).get(params.userId);
      // outra empresa ou usuário desligado: não existe para quem consulta
      if (!inst || !inst.active) throw notFound('Perfil não encontrado.');
      const [prof] = await app.db.select().from(s.peopleProfiles).where(and(eq(s.peopleProfiles.userId, params.userId), eq(s.peopleProfiles.tenantId, auth.tenantId))).limit(1);
      const self = params.userId === auth.userId;
      // comunidades da pessoa: privadas só aparecem para quem também é membro
      const comms = await app.db.execute<{ id: string; name: string; kind: string; role: string }>(sql`
        select c.id, c.name, c.kind, m.role from people_community_members m join people_communities c on c.id = m.community_id
        where m.user_id = ${params.userId} and c.tenant_id = ${auth.tenantId} and c.status = 'ativa'
          and (c.kind <> 'privada' or exists (select 1 from people_community_members me where me.community_id = c.id and me.user_id = ${auth.userId}))
        order by c.name limit 50`);
      return {
        communities: comms.rows,
        ...publicCard(inst),
        teams: inst.teams,
        bio: prof?.bio ?? null,
        interests: prof?.interests ?? [],
        skills: prof?.skills ?? [],
        contact: { email: self || prof?.showEmail ? inst.email : null, phone: self || prof?.showPhone ? inst.phone : null },
        privacy: self ? { showEmail: prof?.showEmail ?? false, showPhone: prof?.showPhone ?? false } : undefined,
        self,
      };
    },
  }),

  defineRoute({
    method: 'PUT', url: '/pessoas/perfil', summary: 'Edita os campos opcionais do próprio perfil (cargo, área e unidade vêm do cadastro oficial)', tag, module: 'pessoas',
    body: z.object({ bio: z.string().trim().max(600).nullable().default(null), interests: words(15, 40).default([]), skills: words(20, 40).default([]), showEmail: z.boolean().default(false), showPhone: z.boolean().default(false) }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, body, req }) => {
      const v = { bio: body.bio || null, interests: body.interests, skills: body.skills, showEmail: body.showEmail, showPhone: body.showPhone, updatedAt: new Date() };
      await app.db.insert(s.peopleProfiles).values({ userId: auth.userId, tenantId: auth.tenantId, ...v }).onConflictDoUpdate({ target: s.peopleProfiles.userId, set: v });
      await audit(app.db, req, { action: 'people.profile.update', entityType: 'people_profile', entityId: auth.userId, metadata: { showEmail: v.showEmail, showPhone: v.showPhone } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET', url: '/pessoas/colaboradores', summary: 'Busca de colegas da empresa (nome e cargo) para perfis, menções e reconhecimento', tag, module: 'pessoas',
    query: z.object({ q: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(300).default(20) }),
    handler: async ({ app, auth, query }) => {
      const t = query.q ? `%${query.q.replace(/[%_\\]/g, '\\$&')}%` : null;
      const rows = await app.db.select({ id: s.users.id }).from(s.users)
        .where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), t ? or(ilike(s.users.name, t), ilike(s.users.jobTitle, t)) : undefined))
        .orderBy(asc(s.users.name)).limit(query.limit);
      const inst = await institutionalOf(app.db, auth.tenantId, rows.map((r) => r.id));
      return { items: rows.map((r) => inst.get(r.id)).filter(Boolean).map((i) => publicCard(i!)) };
    },
  }),

  defineRoute({
    method: 'GET', url: '/pessoas/config', summary: 'Parâmetros do módulo (papéis por setor e limites de envio)', tag, module: 'pessoas',
    handler: async ({ app, auth }) => {
      const st = await peopleSettingsOf(app.db, auth.tenantId);
      if (!peopleCaps(auth, st).configure) throw forbidden('Só a administração do módulo (Pessoas e Cultura) ou do sistema altera os parâmetros.');
      const [r] = await app.db.select({ updatedAt: s.peopleSettings.updatedAt, by: s.users.name }).from(s.peopleSettings).leftJoin(s.users, eq(s.users.id, s.peopleSettings.updatedBy)).where(eq(s.peopleSettings.tenantId, auth.tenantId)).limit(1);
      return { settings: st, updatedAt: r?.updatedAt ?? null, updatedBy: r?.by ?? null };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/pessoas/config', summary: 'Salva os parâmetros do módulo', tag, module: 'pessoas', body: PeopleSettings,
    handler: async ({ app, auth, body, req }) => {
      const before = await peopleSettingsOf(app.db, auth.tenantId);
      if (!peopleCaps(auth, before).configure) throw forbidden('Só a administração do módulo (Pessoas e Cultura) ou do sistema altera os parâmetros.');
      // a marca de implantação das celebrações é do servidor (a tela não apaga)
      const next = { ...body, badgeBaselineAt: before.badgeBaselineAt };
      await app.db.insert(s.peopleSettings).values({ tenantId: auth.tenantId, settings: next, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: s.peopleSettings.tenantId, set: { settings: next, updatedBy: auth.userId, updatedAt: sql`now()` } });
      await audit(app.db, req, { action: 'people.settings.update', entityType: 'people_settings', entityId: auth.tenantId, metadata: { before, after: body } });
      return { settings: next };
    },
  }),
];
