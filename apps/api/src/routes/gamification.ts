/** Gestão de Times → Gamificação colaborativa: placar por time e pessoa, pódio, dispersão (liderança), níveis e Selo BK de Qualidade. */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { atLeast, EVENT_TYPE_KEYS, gamificationSettingsErrors, goldMedalists, levelOf, podium, teamBoards, type CreditSum, type GamificationSettings } from '@isp/domain';
import { defineRoute } from '../http/route';
import { forbidden, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { ensureFreshEvents } from '../services/businessEvents';
import { vacationOrg, todayIn } from '../services/vacations';

/** Proposta inicial (versão 1, status proposta): só vale depois de aprovada. Reconhece venda e ajuda ao colega; liderança pesa mais o time. */
const START: GamificationSettings = {
  teamIds: [],
  points: { lead_qualificado: 5, oportunidade_criada: 2, proposta_enviada: 5, negociacao_ganha: 30, venda_validada: 20, contrato_assinado: 10, contrato_renovado: 15, acompanhamento_registrado: 3, abm_interacao: 2, abm_oportunidade_gerada: 10 },
  participationMultiplierBp: 15_000, hierarchyWeights: { colaborador: { ownBp: 5_000, teamBp: 5_000 }, lideranca: { ownBp: 2_000, teamBp: 8_000 } }, dispersionYellowBp: 3_000, dispersionRedBp: 5_000,
  levels: [{ name: 'Bronze', minPoints: 0 }, { name: 'Prata', minPoints: 300 }, { name: 'Ouro', minPoints: 800 }, { name: 'Diamante', minPoints: 1500 }],
};
const canConfigure = (auth: AuthContext) => atLeast(level(auth, 'configuracoes'), 'total') || level(auth, 'resultados') === 'total';

const asSettings = (c: Record<string, unknown>) => ({ ...START, ...(c as Partial<GamificationSettings>) });
/** Regra vigente = a aprovada mais recente (null enquanto nenhuma foi aprovada) e a proposta pendente, se houver. */
export async function gamificationSettingsOf(db: DbOrTx, tenantId: string) {
  let rows = await db.select().from(s.gamificationSettings).where(eq(s.gamificationSettings.tenantId, tenantId)).orderBy(desc(s.gamificationSettings.version));
  if (!rows.length) {
    await db.insert(s.gamificationSettings).values({ tenantId, version: 1, config: START as unknown as Record<string, unknown>, note: 'Proposta inicial', status: 'proposta' }).onConflictDoNothing();
    rows = await db.select().from(s.gamificationSettings).where(eq(s.gamificationSettings.tenantId, tenantId)).orderBy(desc(s.gamificationSettings.version));
  }
  const approved = rows.find((r) => r.status === 'aprovada') ?? null;
  const pending = rows.find((r) => r.status === 'proposta' && (!approved || r.version > approved.version)) ?? null;
  return {
    settings: approved ? asSettings(approved.config) : null, version: approved?.version ?? null,
    proposal: pending ? { version: pending.version, settings: asSettings(pending.config), note: pending.note, createdBy: pending.createdBy, createdAt: pending.createdAt } : null,
    lastVersion: rows[0]!.version,
  };
}

async function participants(db: DbOrTx, tenantId: string, st: GamificationSettings) {
  const org = await vacationOrg(db, tenantId);
  const ids = Object.keys(org.teamNames).filter((t) => !st.teamIds.length || st.teamIds.includes(t));
  const teams = ids.map((id) => ({ id, name: org.teamNames[id]!, memberIds: org.people.filter((p) => p.teamIds.includes(id)).map((p) => p.id), leadIds: org.leads[id] ?? [] }));
  return { org, teams };
}

async function creditsBetween(db: DbOrTx, tenantId: string, from: string, to: string, tz: string, userIds: string[]): Promise<CreditSum[]> {
  if (!userIds.length) return [];
  const rows = await db.execute<{ user_id: string; type: string; kind: string; share: number }>(sql`
    select c.user_id, e.type, c.kind, sum(c.share_bp)::int as share
      from business_event_credits c join business_events e on e.id = c.event_id
     where e.tenant_id = ${tenantId} and e.validation = 'valido' and c.user_id in ${userIds}
       and (e.occurred_at at time zone ${tz})::date between ${from}::date and ${to}::date
     group by c.user_id, e.type, c.kind`);
  return rows.rows.map((r) => ({ userId: r.user_id, type: r.type, kind: r.kind, shareBp: r.share }));
}

const monthBounds = (ym: string) => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }; };

async function board(db: DbOrTx, auth: AuthContext, st: GamificationSettings, from: string, to: string) {
  const { org, teams } = await participants(db, auth.tenantId, st);
  const memberIds = [...new Set(teams.flatMap((t) => t.memberIds))];
  const credits = await creditsBetween(db, auth.tenantId, from, to, auth.timezone, memberIds);
  const r = teamBoards({ teams, credits, settings: st });
  const name = Object.fromEntries(org.people.map((p) => [p.id, p.name]));
  const photos = new Set((await db.execute<{ user_id: string }>(sql`select user_id from user_avatars where user_id in ${memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000']}`)).rows.map((r) => r.user_id));
  const who = (u: string) => ({ name: name[u] ?? '', hasPhoto: photos.has(u) });
  // dispersão é indicador da liderança: quem lidera o time (ou tem nível Total) vê
  const seesDispersion = (teamId: string) => level(auth, 'resultados') === 'total' || (org.leads[teamId] ?? []).includes(auth.userId);
  return {
    teams: r.boards.map((b) => ({ ...b, name: teams.find((t) => t.id === b.teamId)!.name, members: b.members.map((m) => ({ ...m, ...who(m.userId) })), dispersion: seesDispersion(b.teamId) ? b.dispersion : null, leads: (org.leads[b.teamId] ?? []).map((u) => name[u] ?? '') })),
    people: r.people.map((p) => ({ ...p, ...who(p.userId) })),
    podium: podium(r.people).map((p) => ({ ...p, ...who(p.userId) })),
  };
}

export const gamificationRoutes = [
  defineRoute({
    method: 'GET', url: '/times/gamificacao', summary: 'Gamificação colaborativa: placar do mês e do ano por time e pessoa, pódio, dispersão (para a liderança), níveis e medalha de ouro', tag: 'Gestão de Times', module: 'resultados',
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
    handler: async ({ app, auth, query }) => {
      await ensureFreshEvents(app.db, auth.tenantId);
      const { settings, version, proposal } = await gamificationSettingsOf(app.db, auth.tenantId);
      const today = todayIn(auth.timezone);
      const month = query.month ?? today.slice(0, 7);
      const year = month.slice(0, 4);
      const pendingInfo = proposal ? { version: proposal.version, note: proposal.note, canDecide: canConfigure(auth) && proposal.createdBy !== auth.userId } : null;
      // sem regra aprovada ninguém pontua: o placar espera a aprovação
      if (!settings) return { pending: true, proposal: pendingInfo, canConfigure: canConfigure(auth), month, year: Number(year), settings: null, settingsVersion: null, monthBoard: null, yearBoard: null, gold: [], me: null, eventTypes: EVENT_TYPE_KEYS };
      const mb = monthBounds(month);
      const [m, y] = await Promise.all([board(app.db, auth, settings, mb.from, mb.to), board(app.db, auth, settings, `${year}-01-01`, `${year}-12-31`)]);
      const gold = goldMedalists(y.people);
      const mine = y.people.find((p) => p.userId === auth.userId);
      return {
        pending: false, proposal: pendingInfo, settings, settingsVersion: version, canConfigure: canConfigure(auth), month, year: Number(year),
        monthBoard: m, yearBoard: { ...y, people: y.people.map((p) => ({ ...p, level: levelOf(p.score, settings)?.name ?? null })) },
        gold: gold.map((u) => ({ userId: u, name: y.people.find((p) => p.userId === u)!.name, score: y.people.find((p) => p.userId === u)!.score })),
        me: mine ? { score: mine.score, level: levelOf(mine.score, settings)?.name ?? null, rank: y.people.findIndex((p) => p.userId === auth.userId) + 1, gold: gold.includes(auth.userId) } : null,
        eventTypes: EVENT_TYPE_KEYS,
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/me/selo', summary: 'Selo BK de Qualidade: se a pessoa tem a maior nota do ano na gamificação (medalha de ouro)', tag: 'Gestão de Times', anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      const year = todayIn(auth.timezone).slice(0, 4);
      const { settings } = await gamificationSettingsOf(app.db, auth.tenantId);
      if (!settings) return { gold: false, year: Number(year), score: null };
      const { teams } = await participants(app.db, auth.tenantId, settings);
      if (!teams.some((t) => t.memberIds.includes(auth.userId))) return { gold: false, year: Number(year), score: null };
      const memberIds = [...new Set(teams.flatMap((t) => t.memberIds))];
      const r = teamBoards({ teams, credits: await creditsBetween(app.db, auth.tenantId, `${year}-01-01`, `${year}-12-31`, auth.timezone, memberIds), settings });
      const me = r.people.find((p) => p.userId === auth.userId);
      return { gold: goldMedalists(r.people).includes(auth.userId), year: Number(year), score: me?.score ?? null };
    },
  }),
  defineRoute({
    method: 'GET', url: '/times/gamificacao/settings', summary: 'Regras da gamificação vigentes e histórico', tag: 'Gestão de Times', module: 'resultados',
    handler: async ({ app, auth }) => {
      const cur = await gamificationSettingsOf(app.db, auth.tenantId);
      const history = await app.db.select({ version: s.gamificationSettings.version, note: s.gamificationSettings.note, status: s.gamificationSettings.status, decisionNote: s.gamificationSettings.decisionNote, decidedAt: s.gamificationSettings.decidedAt, createdAt: s.gamificationSettings.createdAt, by: s.users.name }).from(s.gamificationSettings).leftJoin(s.users, eq(s.users.id, s.gamificationSettings.createdBy))
        .where(eq(s.gamificationSettings.tenantId, auth.tenantId)).orderBy(desc(s.gamificationSettings.version));
      const teams = await app.db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), eq(s.teams.active, true)));
      return { ...cur, proposal: cur.proposal ? { ...cur.proposal, canDecide: canConfigure(auth) && cur.proposal.createdBy !== auth.userId } : null, start: START, history, teams, canConfigure: canConfigure(auth) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/times/gamificacao/settings', summary: 'Propõe nova versão das regras da gamificação (vale só depois de aprovada; substitui a proposta pendente)', tag: 'Gestão de Times', module: 'resultados',
    body: z.object({
      teamIds: z.array(z.string().uuid()).max(100), points: z.record(z.string(), z.number().int()), participationMultiplierBp: z.number().int(),
      hierarchyWeights: z.object({ colaborador: z.object({ ownBp: z.number().int(), teamBp: z.number().int() }), lideranca: z.object({ ownBp: z.number().int(), teamBp: z.number().int() }) }),
      dispersionYellowBp: z.number().int(), dispersionRedBp: z.number().int(), levels: z.array(z.object({ name: z.string().trim().min(1).max(40), minPoints: z.number().int().min(0) })).min(1).max(10), note: z.string().trim().min(3).max(300),
    }),
    handler: async ({ app, auth, body, reply }) => {
      if (!canConfigure(auth)) throw forbidden('Só quem administra a Gestão de Times publica as regras da gamificação.');
      const { note, ...cfg } = body;
      const unknown = Object.keys(cfg.points).filter((k) => !(EVENT_TYPE_KEYS as string[]).includes(k));
      if (unknown.length) throw unprocessable(`Tipo de evento desconhecido: ${unknown.join(', ')}.`);
      if (cfg.teamIds.length) {
        const found = await app.db.select({ id: s.teams.id }).from(s.teams).where(and(eq(s.teams.tenantId, auth.tenantId), inArray(s.teams.id, cfg.teamIds)));
        if (found.length !== cfg.teamIds.length) throw unprocessable('Time inválido.');
      }
      const errs = gamificationSettingsErrors(cfg);
      if (errs.length) throw unprocessable(errs.join(' '));
      const cur = await gamificationSettingsOf(app.db, auth.tenantId);
      // uma proposta pendente por vez: a anterior fica recusada (substituída), no histórico
      if (cur.proposal) await app.db.update(s.gamificationSettings).set({ status: 'recusada', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: 'Substituída por nova proposta' })
        .where(and(eq(s.gamificationSettings.tenantId, auth.tenantId), eq(s.gamificationSettings.version, cur.proposal.version), eq(s.gamificationSettings.status, 'proposta')));
      await app.db.insert(s.gamificationSettings).values({ tenantId: auth.tenantId, version: cur.lastVersion + 1, config: cfg as unknown as Record<string, unknown>, note, status: 'proposta', createdBy: auth.userId });
      reply.code(201);
      return { settings: cfg, version: cur.lastVersion + 1, status: 'proposta' };
    },
  }),
  defineRoute({
    method: 'POST', url: '/times/gamificacao/settings/:version/decide', summary: 'Aprova ou recusa a proposta de regra (quem administra; nunca quem propôs). Aprovada passa a valer na hora', tag: 'Gestão de Times', module: 'resultados',
    params: z.object({ version: z.coerce.number().int().min(1) }), body: z.object({ approve: z.boolean(), note: z.string().trim().max(300).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => {
      if (!canConfigure(auth)) throw forbidden('Só quem administra a Gestão de Times aprova as regras da gamificação.');
      const [row] = await app.db.select().from(s.gamificationSettings).where(and(eq(s.gamificationSettings.tenantId, auth.tenantId), eq(s.gamificationSettings.version, params.version))).limit(1);
      if (!row || row.status !== 'proposta') throw unprocessable('Esta versão não está aguardando aprovação.');
      if (row.createdBy === auth.userId) throw forbidden('Quem propôs a regra não aprova a própria proposta.');
      if (!body.approve && !body.note?.trim()) throw unprocessable('Diga o motivo da recusa.');
      await app.db.update(s.gamificationSettings).set({ status: body.approve ? 'aprovada' : 'recusada', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: body.note?.trim() || null })
        .where(and(eq(s.gamificationSettings.id, row.id), eq(s.gamificationSettings.status, 'proposta')));
      return { version: row.version, status: body.approve ? 'aprovada' : 'recusada' };
    },
  }),
];
