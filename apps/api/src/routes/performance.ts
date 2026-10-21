/** Desempenho — Etapa 5: catálogo e consulta dos eventos de negócio, validação, atribuição e reprocessamento. */
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  BUSINESS_EVENT_TYPES, EVENT_TYPE_KEYS, EVENT_VALIDATION, UNAVAILABLE_EVENT_TYPES, atLeast, validatePerformanceConfig, type PerformanceConfig,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { ensureFreshEvents, eventCountsByType, performanceConfig, syncBusinessEvents } from '../services/businessEvents';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

/** Quem o usuário pode ver no desempenho: ele (Próprio), os times que lidera (Equipe) ou todos (Total). */
export function performanceUsers(auth: AuthContext): string[] | 'all' {
  const l = level(auth, 'desempenho');
  if (l === 'total') return 'all';
  if (l === 'equipe') return [...new Set([auth.userId, ...auth.teamMemberIds])];
  if (l === 'proprio') return [auth.userId];
  return [];
}
export const creditScope = (auth: AuthContext): SQL => {
  const u = performanceUsers(auth);
  if (u === 'all') return sql`true`;
  if (!u.length) return sql`false`;
  return sql`exists (select 1 from business_event_credits c where c.event_id = ${s.businessEvents.id} and c.user_id in ${u})`;
};

export const performanceRoutes = [
  defineRoute({
    method: 'GET',
    url: '/performance/catalog',
    summary: 'Catálogo de eventos de negócio: origem, responsável, contagem e o que ainda não tem fonte confiável',
    tag: 'Desempenho',
    module: 'desempenho',
    handler: async ({ app, auth }) => {
      await ensureFreshEvents(app.db, auth.tenantId);
      const [counts, [sync], { version, config }] = await Promise.all([
        eventCountsByType(app.db, auth.tenantId),
        app.db.select().from(s.businessEventSync).where(eq(s.businessEventSync.tenantId, auth.tenantId)).limit(1),
        performanceConfig(app.db, auth.tenantId),
      ]);
      return {
        types: BUSINESS_EVENT_TYPES.map((t) => ({ ...t, counts: Object.fromEntries(EVENT_VALIDATION.map((v) => [v, counts.find((c) => c.type === t.key && c.validation === v)?.n ?? 0])), rule: config.attribution[t.key], validationRequired: config.validationRequired.includes(t.key) })),
        unavailable: UNAVAILABLE_EVENT_TYPES,
        lastSync: sync ? { at: sync.lastRunAt, stats: sync.stats } : null,
        settingsVersion: version,
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/performance/events',
    summary: 'Eventos de negócio com créditos (filtros por tipo, módulo, pessoa, período, validação e origem); base do detalhamento dos indicadores',
    tag: 'Desempenho',
    module: 'desempenho',
    query: z.object({
      type: z.string().max(400).optional(),
      module: z.string().max(40).optional(),
      userId: z.string().uuid().optional(),
      creditKind: z.enum(['direto', 'participacao', 'gestao']).optional(),
      teamId: z.string().uuid().optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      validation: z.enum(EVENT_VALIDATION).optional(),
      sourceId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }),
    handler: async ({ app, auth, query: q }) => {
      await ensureFreshEvents(app.db, auth.tenantId);
      const w: SQL[] = [eq(s.businessEvents.tenantId, auth.tenantId), creditScope(auth)];
      if (q.type) { const ts = q.type.split(',').filter((x) => (EVENT_TYPE_KEYS as string[]).includes(x)); if (ts.length) w.push(inArray(s.businessEvents.type, ts)); }
      if (q.module) w.push(eq(s.businessEvents.module, q.module));
      if (q.validation) w.push(eq(s.businessEvents.validation, q.validation));
      if (q.sourceId) w.push(eq(s.businessEvents.sourceId, q.sourceId));
      if (q.teamId) w.push(eq(s.businessEvents.teamId, q.teamId));
      if (q.userId) w.push(sql`exists (select 1 from business_event_credits c where c.event_id = ${s.businessEvents.id} and c.user_id = ${q.userId}${q.creditKind ? sql` and c.kind = ${q.creditKind}` : sql``})`);
      const tz = auth.timezone;
      if (q.from) w.push(gte(sql`(${s.businessEvents.occurredAt} at time zone ${tz})::date`, sql`${q.from}::date`));
      if (q.to) w.push(lte(sql`(${s.businessEvents.occurredAt} at time zone ${tz})::date`, sql`${q.to}::date`));
      const where = and(...w);
      const [items, [{ total } = { total: 0 }]] = await Promise.all([
        app.db.select({ e: s.businessEvents, ownerName: s.users.name }).from(s.businessEvents).leftJoin(s.users, eq(s.users.id, s.businessEvents.ownerId)).where(where).orderBy(desc(s.businessEvents.occurredAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        app.db.select({ total: sql<number>`count(*)::int` }).from(s.businessEvents).where(where),
      ]);
      const ids = items.map((i) => i.e.id);
      const credits = ids.length ? await app.db.select({ eventId: s.businessEventCredits.eventId, userId: s.businessEventCredits.userId, kind: s.businessEventCredits.kind, shareBp: s.businessEventCredits.shareBp, name: s.users.name }).from(s.businessEventCredits).innerJoin(s.users, eq(s.users.id, s.businessEventCredits.userId)).where(inArray(s.businessEventCredits.eventId, ids)) : [];
      return {
        items: items.map(({ e, ownerName }) => ({ ...e, ownerName, label: BUSINESS_EVENT_TYPES.find((t) => t.key === e.type)?.label ?? e.type, credits: credits.filter((c) => c.eventId === e.id) })),
        total, page: q.page, pageSize: q.pageSize,
        canReview: atLeast(level(auth, 'desempenho'), 'equipe'),
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/performance/events/:id',
    summary: 'Evento com créditos e histórico de validação',
    tag: 'Desempenho',
    module: 'desempenho',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [r] = await app.db.select({ e: s.businessEvents, ownerName: s.users.name }).from(s.businessEvents).leftJoin(s.users, eq(s.users.id, s.businessEvents.ownerId)).where(and(eq(s.businessEvents.id, params.id), eq(s.businessEvents.tenantId, auth.tenantId), creditScope(auth))).limit(1);
      if (!r) throw notFound('Evento não encontrado.');
      const [credits, reviews] = await Promise.all([
        app.db.select({ userId: s.businessEventCredits.userId, kind: s.businessEventCredits.kind, shareBp: s.businessEventCredits.shareBp, name: s.users.name }).from(s.businessEventCredits).innerJoin(s.users, eq(s.users.id, s.businessEventCredits.userId)).where(eq(s.businessEventCredits.eventId, params.id)),
        app.db.select({ id: s.businessEventReviews.id, from: s.businessEventReviews.fromValidation, to: s.businessEventReviews.toValidation, reason: s.businessEventReviews.reason, automatic: s.businessEventReviews.automatic, createdAt: s.businessEventReviews.createdAt, actorName: s.users.name }).from(s.businessEventReviews).leftJoin(s.users, eq(s.users.id, s.businessEventReviews.actorId)).where(eq(s.businessEventReviews.eventId, params.id)).orderBy(desc(s.businessEventReviews.createdAt)),
      ]);
      return { ...r.e, ownerName: r.ownerName, label: BUSINESS_EVENT_TYPES.find((t) => t.key === r.e.type)?.label ?? r.e.type, credits, reviews };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/performance/events/:id/review',
    summary: 'Valida, invalida ou devolve para validação um evento (com motivo; quem recebeu crédito de resultado não valida o próprio evento)',
    tag: 'Desempenho',
    module: 'desempenho',
    min: 'equipe',
    params: IdParams,
    body: z.object({ to: z.enum(EVENT_VALIDATION), reason: z.string().trim().min(5).max(1000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const [e] = await tx.select().from(s.businessEvents).where(and(eq(s.businessEvents.id, params.id), eq(s.businessEvents.tenantId, auth.tenantId), creditScope(auth))).for('update').limit(1);
      if (!e) throw notFound('Evento não encontrado.');
      if (e.validation === body.to) throw unprocessable('O evento já está nessa situação.');
      const [own] = await tx.select({ x: sql`1` }).from(s.businessEventCredits).where(and(eq(s.businessEventCredits.eventId, e.id), eq(s.businessEventCredits.userId, auth.userId), eq(s.businessEventCredits.kind, 'direto'))).limit(1);
      if (own) throw forbidden('Quem recebeu crédito de resultado não valida o próprio evento.');
      await tx.update(s.businessEvents).set({ validation: body.to, validatedAt: new Date(), validatedBy: auth.userId }).where(eq(s.businessEvents.id, e.id));
      await tx.insert(s.businessEventReviews).values({ tenantId: auth.tenantId, eventId: e.id, fromValidation: e.validation, toValidation: body.to, reason: body.reason, actorId: auth.userId });
      return { ok: true };
    }),
  }),

  defineRoute({
    method: 'POST',
    url: '/performance/sync',
    summary: 'Reprocessa os eventos a partir das tabelas de origem (idempotente; também usado na carga histórica)',
    tag: 'Desempenho',
    module: 'desempenho',
    min: 'total',
    handler: async ({ app, auth }) => syncBusinessEvents(app.db, auth.tenantId),
  }),

  defineRoute({
    method: 'GET',
    url: '/performance/settings',
    summary: 'Configuração de desempenho vigente (atribuição e validação) e histórico de versões',
    tag: 'Desempenho',
    module: 'configuracoes',
    min: 'total',
    handler: async ({ app, auth }) => {
      const cur = await performanceConfig(app.db, auth.tenantId);
      const history = await app.db.select({ version: s.performanceSettings.version, note: s.performanceSettings.note, createdAt: s.performanceSettings.createdAt, by: s.users.name }).from(s.performanceSettings).leftJoin(s.users, eq(s.users.id, s.performanceSettings.createdBy)).where(eq(s.performanceSettings.tenantId, auth.tenantId)).orderBy(desc(s.performanceSettings.version));
      return { ...cur, history };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/performance/settings',
    summary: 'Salva nova versão da configuração (vale para eventos novos; os já criados mantêm a regra da época)',
    tag: 'Desempenho',
    module: 'configuracoes',
    min: 'total',
    body: z.object({
      config: z.object({
        attribution: z.record(z.string(), z.object({ ownerShareBp: z.number().int(), participants: z.boolean(), managers: z.boolean() })),
        validationRequired: z.array(z.string()).max(50),
      }).passthrough(),
      note: z.string().trim().min(3).max(500),
    }),
    handler: async ({ app, auth, body }) => {
      const cfg = body.config as PerformanceConfig;
      const errs = validatePerformanceConfig(cfg);
      if (errs.length) throw unprocessable(errs[0]!, errs.map((m) => ({ path: 'config', message: m })));
      const { version, config: prev } = await performanceConfig(app.db, auth.tenantId);
      const [r] = await app.db.insert(s.performanceSettings).values({ tenantId: auth.tenantId, version: version + 1, config: { ...prev, ...cfg }, note: body.note, createdBy: auth.userId }).returning({ version: s.performanceSettings.version });
      return r!;
    },
  }),
];
