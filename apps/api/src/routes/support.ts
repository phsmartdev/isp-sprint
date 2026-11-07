/**
 * Pedido de Apoio: pedir ajuda ao time ou a um colega de qualquer tela; quem assume atende, quem pediu confirma.
 * Pontos (só depois da confirmação) vêm da regra aprovada da gamificação: ver supportCredits no domínio.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { componentRef, supportCredits, SUPPORT_NEXT, type GamificationSettings, type SupportStatus } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { gamificationSettingsOf } from '../services/gamification';
import { seesAllTeams } from '../services/results';
import { leadsOrManages, vacationOrg, type VacationOrg } from '../services/vacations';

const ENTITY = ['oportunidade', 'contrato', 'conta', 'tarefa', 'projeto'] as const;
type Entity = (typeof ENTITY)[number];

/** Rótulo do item onde a pessoa estava e, se for tarefa de jornada, os pontos dela (congelados no pedido). */
async function entityOf(db: DbOrTx, tenantId: string, type: Entity, id: string, st: GamificationSettings | null): Promise<{ label: string; taskPoints: number | null }> {
  if (type === 'oportunidade') {
    const r = await db.execute<{ code: number; name: string }>(sql`select o.code, c.name from opportunities o join contacts c on c.id = o.contact_id where o.id = ${id} and o.tenant_id = ${tenantId}`);
    if (!r.rows[0]) throw unprocessable('Oportunidade não encontrada.');
    return { label: `OP-${r.rows[0].code} · ${r.rows[0].name}`, taskPoints: null };
  }
  if (type === 'contrato') {
    const r = await db.execute<{ code: number; name: string }>(sql`select k.code, c.name from contracts k join contacts c on c.id = k.contact_id where k.id = ${id} and k.tenant_id = ${tenantId}`);
    if (!r.rows[0]) throw unprocessable('Contrato não encontrado.');
    return { label: `Contrato ${r.rows[0].code} · ${r.rows[0].name}`, taskPoints: null };
  }
  if (type === 'conta') {
    const [c] = await db.select({ name: s.contacts.name }).from(s.contacts).where(and(eq(s.contacts.id, id), eq(s.contacts.tenantId, tenantId)));
    if (!c) throw unprocessable('Conta não encontrada.');
    return { label: c.name, taskPoints: null };
  }
  if (type === 'projeto') {
    const r = await db.execute<{ name: string }>(sql`select name from projects where id = ${id} and tenant_id = ${tenantId}`);
    if (!r.rows[0]) throw unprocessable('Projeto não encontrado.');
    return { label: r.rows[0].name, taskPoints: null };
  }
  const [a] = await db.select({ title: s.activities.title, ref: s.activities.scoreComponent }).from(s.activities).where(and(eq(s.activities.id, id), eq(s.activities.tenantId, tenantId)));
  if (!a) throw unprocessable('Tarefa não encontrada.');
  let pts: number | null = null;
  if (a.ref && st) for (const j of st.journeys) for (const c of j.components) if (componentRef(j.key, c.key) === a.ref) pts = c.points;
  return { label: a.title, taskPoints: pts };
}

type Row = typeof s.supportRequests.$inferSelect;
const inTeam = (org: VacationOrg, teamId: string | null, userId: string) => !!teamId && (org.teams[userId] ?? []).includes(teamId);
const canSee = (auth: AuthContext, org: VacationOrg, r: Row) =>
  r.requesterId === auth.userId || r.helperId === auth.userId || r.targetUserId === auth.userId || inTeam(org, r.teamId, auth.userId) || seesAllTeams(auth) || (!!r.teamId && leadsOrManages(org, r.teamId, auth.userId));
const canTake = (auth: AuthContext, org: VacationOrg, r: Row) => r.requesterId !== auth.userId && (r.targetUserId ? r.targetUserId === auth.userId : inTeam(org, r.teamId, auth.userId) || (!!r.teamId && leadsOrManages(org, r.teamId, auth.userId)));

async function load(db: DbOrTx, auth: AuthContext, id: string) {
  const [r] = await db.select().from(s.supportRequests).where(and(eq(s.supportRequests.id, id), eq(s.supportRequests.tenantId, auth.tenantId)));
  const org = await vacationOrg(db, auth.tenantId);
  if (!r || !canSee(auth, org, r)) throw notFound('Pedido de apoio não encontrado.');
  return { r, org };
}

async function event(db: DbOrTx, auth: AuthContext, r: Row, type: string, notify: (string | null)[], note?: string | null) {
  await db.insert(s.supportRequestEvents).values({ tenantId: auth.tenantId, requestId: r.id, type, note: note ?? null, actorId: auth.userId });
  const to = [...new Set(notify.filter((x): x is string => !!x && x !== auth.userId))];
  if (to.length) await db.insert(s.governanceEvents).values({ tenantId: auth.tenantId, entity: 'apoio', entityId: r.id, type, notify: to, payload: { title: r.title }, actorId: auth.userId });
}

/** Pontos de apoio confirmados no período (para a gamificação e Meus pontos). */
export async function supportCreditsBetween(db: DbOrTx, tenantId: string, from: string, to: string, st: GamificationSettings) {
  if (!st.support) return [];
  const rows = await db.select({ id: s.supportRequests.id, requesterId: s.supportRequests.requesterId, helperId: s.supportRequests.helperId, taskPoints: s.supportRequests.taskPoints, confirmedOn: s.supportRequests.confirmedOn, title: s.supportRequests.title })
    .from(s.supportRequests).where(and(eq(s.supportRequests.tenantId, tenantId), eq(s.supportRequests.status, 'confirmado'), sql`${s.supportRequests.confirmedOn} between ${from}::date and ${to}::date`));
  // o teto é mensal: conta desde o início do mês do período
  const credits = supportCredits(rows.filter((r) => r.helperId && r.confirmedOn).map((r) => ({ id: r.id, requesterId: r.requesterId, helperId: r.helperId!, taskPoints: r.taskPoints, confirmedOn: r.confirmedOn! })), st.support);
  return credits.map((c) => ({ ...c, title: rows.find((r) => r.id === c.requestId)?.title ?? '' }));
}

const Act = z.object({ note: z.string().trim().max(1000).nullable().optional() });

export const supportRoutes = [
  defineRoute({
    method: 'GET', url: '/apoio', summary: 'Pedidos de apoio: para mim e meus times, os que assumi e os que pedi; com a regra de pontos vigente', tag: 'Gestão de Times', anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      const org = await vacationOrg(app.db, auth.tenantId);
      const myTeams = org.teams[auth.userId] ?? [];
      const rows = await app.db.select().from(s.supportRequests).where(and(eq(s.supportRequests.tenantId, auth.tenantId), or(
        eq(s.supportRequests.requesterId, auth.userId), eq(s.supportRequests.helperId, auth.userId), eq(s.supportRequests.targetUserId, auth.userId),
        myTeams.length ? inArray(s.supportRequests.teamId, myTeams) : sql`false`,
      ), sql`(${s.supportRequests.status} in ('aberto','assumido','atendido') or ${s.supportRequests.createdAt} > now() - interval '60 days')`)).orderBy(desc(s.supportRequests.createdAt)).limit(300);
      const users = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, auth.tenantId));
      const nm = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? null : null);
      const { settings } = await gamificationSettingsOf(app.db, auth.tenantId);
      const dto = (r: Row) => ({
        id: r.id, title: r.title, description: r.description, dueOn: r.dueOn, status: r.status as SupportStatus,
        requester: { id: r.requesterId, name: nm(r.requesterId) }, helper: r.helperId ? { id: r.helperId, name: nm(r.helperId) } : null,
        target: r.teamId ? { kind: 'time' as const, id: r.teamId, name: org.teamNames[r.teamId] ?? 'Time' } : { kind: 'pessoa' as const, id: r.targetUserId!, name: nm(r.targetUserId) },
        entity: r.entityType ? { type: r.entityType, id: r.entityId, label: r.entityLabel } : null, taskPoints: r.taskPoints,
        doneNote: r.doneNote, createdAt: r.createdAt, canTake: r.status === 'aberto' && canTake(auth, org, r),
        actions: SUPPORT_NEXT[r.status as SupportStatus].filter((a) => (a === 'assumir' ? canTake(auth, org, r) : a === 'atendido' || a === 'desistir' ? r.helperId === auth.userId : r.requesterId === auth.userId)),
      });
      const visible = rows.filter((r) => canSee(auth, org, r));
      const toMe = visible.filter((r) => r.status === 'aberto' && canTake(auth, org, r)).map(dto);
      const taken = visible.filter((r) => r.helperId === auth.userId && ['assumido', 'atendido'].includes(r.status)).map(dto);
      const mine = visible.filter((r) => r.requesterId === auth.userId).map(dto);
      const helped = visible.filter((r) => r.helperId === auth.userId && r.status === 'confirmado').map(dto);
      return { toMe, taken, mine, helped, rule: settings?.support ?? null, waiting: mine.filter((r) => r.status === 'atendido').length };
    },
  }),
  defineRoute({
    method: 'POST', url: '/apoio', summary: 'Pede apoio ao time (grupo) ou a uma pessoa, opcionalmente ligado ao item onde está', tag: 'Gestão de Times', anyAuthenticated: true,
    body: z.object({
      title: z.string().trim().min(3, 'Diga em poucas palavras o que precisa').max(160), description: z.string().trim().max(2000).nullable().optional(),
      dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      teamId: z.string().uuid().nullable().optional(), targetUserId: z.string().uuid().nullable().optional(),
      entityType: z.enum(ENTITY).nullable().optional(), entityId: z.string().uuid().nullable().optional(),
    }).refine((b) => !!b.teamId !== !!b.targetUserId, 'Escolha o time ou uma pessoa.'),
    handler: async ({ app, auth, body, reply }) => {
      if (body.targetUserId === auth.userId) throw unprocessable('Peça apoio a outra pessoa.');
      const org = await vacationOrg(app.db, auth.tenantId);
      if (body.teamId && !org.teamNames[body.teamId]) throw unprocessable('Time não encontrado.');
      if (body.targetUserId) { const [u] = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, body.targetUserId), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))); if (!u) throw unprocessable('Pessoa não encontrada.'); }
      const { settings } = await gamificationSettingsOf(app.db, auth.tenantId);
      const ent = body.entityType && body.entityId ? await entityOf(app.db, auth.tenantId, body.entityType, body.entityId, settings) : null;
      return app.db.transaction(async (tx) => {
        const [r] = await tx.insert(s.supportRequests).values({
          tenantId: auth.tenantId, requesterId: auth.userId, teamId: body.teamId ?? null, targetUserId: body.targetUserId ?? null, title: body.title, description: body.description || null, dueOn: body.dueOn ?? null,
          entityType: ent ? body.entityType! : null, entityId: ent ? body.entityId! : null, entityLabel: ent?.label ?? null, taskPoints: ent?.taskPoints ?? null,
        }).returning();
        const to = body.targetUserId ? [body.targetUserId] : org.people.filter((p) => p.teamIds.includes(body.teamId!)).map((p) => p.id);
        await event(tx, auth, r!, 'pedido', to, body.description);
        reply.code(201);
        return r;
      });
    },
  }),
  defineRoute({
    method: 'POST', url: '/apoio/:id/:acao', summary: 'Assumir, marcar como atendido, desistir, confirmar (dá os pontos), reabrir ou cancelar o pedido', tag: 'Gestão de Times', anyAuthenticated: true,
    params: IdParams.extend({ acao: z.enum(['assumir', 'atendido', 'desistir', 'confirmar', 'reabrir', 'cancelar']) }), body: Act,
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`apoio:${params.id}`}))`);
      const { r, org } = await load(tx, auth, params.id);
      const a = params.acao;
      if (!SUPPORT_NEXT[r.status as SupportStatus].includes(a)) throw unprocessable('Este pedido não está numa situação que permita isso.');
      const me = auth.userId;
      const set: Partial<typeof s.supportRequests.$inferInsert> = {};
      let notify: (string | null)[] = [];
      if (a === 'assumir') { if (!canTake(auth, org, r)) throw forbidden('Este pedido é para outra pessoa ou outro time.'); Object.assign(set, { status: 'assumido', helperId: me, acceptedAt: new Date() }); notify = [r.requesterId]; }
      else if (a === 'atendido') { if (r.helperId !== me) throw forbidden('Só quem assumiu marca como atendido.'); Object.assign(set, { status: 'atendido', doneAt: new Date(), doneNote: body.note || null }); notify = [r.requesterId]; }
      else if (a === 'desistir') { if (r.helperId !== me) throw forbidden('Só quem assumiu pode devolver.'); Object.assign(set, { status: 'aberto', helperId: null, acceptedAt: null }); notify = [r.requesterId]; }
      else {
        if (r.requesterId !== me) throw forbidden('Só quem pediu faz isso.');
        if (a === 'confirmar') { const day = (await tx.execute<{ d: string }>(sql`select (now() at time zone ${auth.timezone})::date::text as d`)).rows[0]!.d; Object.assign(set, { status: 'confirmado', confirmedAt: new Date(), confirmedOn: day }); notify = [r.helperId]; }
        else if (a === 'reabrir') { if (!body.note || body.note.length < 5) throw unprocessable('Diga o que ainda falta.'); Object.assign(set, { status: 'assumido', doneAt: null }); notify = [r.helperId]; }
        else { if (!body.note || body.note.length < 5) throw unprocessable('Diga por que está cancelando.'); Object.assign(set, { status: 'cancelado', cancelledAt: new Date(), cancelReason: body.note }); notify = [r.helperId, r.targetUserId]; }
      }
      const [u] = await tx.update(s.supportRequests).set(set).where(eq(s.supportRequests.id, r.id)).returning();
      await event(tx, auth, u!, a === 'atendido' ? 'atendido' : a === 'confirmar' ? 'confirmado' : a === 'assumir' ? 'assumido' : a === 'reabrir' ? 'reaberto' : a === 'desistir' ? 'devolvido' : 'cancelado', notify, body.note);
      return u;
    }),
  }),
  defineRoute({
    method: 'GET', url: '/apoio/:id/historico', summary: 'Histórico do pedido de apoio', tag: 'Gestão de Times', anyAuthenticated: true, params: IdParams,
    handler: async ({ app, auth, params }) => {
      await load(app.db, auth, params.id);
      const items = await app.db.select({ type: s.supportRequestEvents.type, note: s.supportRequestEvents.note, at: s.supportRequestEvents.createdAt, by: s.users.name }).from(s.supportRequestEvents).leftJoin(s.users, eq(s.users.id, s.supportRequestEvents.actorId)).where(eq(s.supportRequestEvents.requestId, params.id)).orderBy(s.supportRequestEvents.createdAt);
      return { items };
    },
  }),
];
