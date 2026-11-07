/**
 * Gestão de Times → Gamificação colaborativa, sem ranking nem pódio (evita comparação pública e constrangimento):
 * cada pessoa vê só a própria nota; a liderança vê o próprio time (média, dispersão e notas, para gestão);
 * só o primeiro lugar do ano é reconhecido, com o Selo BK de Qualidade.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { atLeast, EVENT_TYPE_KEYS, gamificationSettingsErrors, goldMedalists, levelOf, teamBoards, type CreditSum, type GamificationSettings } from '@isp/domain';
import { asExtra, journeyCreditsBetween } from '../services/scoreJourneys';
import { defineRoute } from '../http/route';
import { forbidden, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { ensureFreshEvents } from '../services/businessEvents';
import { vacationOrg, todayIn } from '../services/vacations';
import { gamificationSettingsOf, GAMIFICATION_START as START } from '../services/gamification';
export { gamificationSettingsOf };
async function pipelinesWithStages(db: DbOrTx, tenantId: string) {
  const rows = await db.select({ id: s.pipelines.id, name: s.pipelines.name, stageKey: s.pipelineStages.key, stageName: s.pipelineStages.name, position: s.pipelineStages.position })
    .from(s.pipelines).innerJoin(s.pipelineStages, eq(s.pipelineStages.pipelineId, s.pipelines.id)).where(eq(s.pipelines.tenantId, tenantId)).orderBy(s.pipelines.name, s.pipelineStages.position);
  const out = new Map<string, { id: string; name: string; stages: { key: string; name: string }[] }>();
  for (const r of rows) { const p = out.get(r.id) ?? { id: r.id, name: r.name, stages: [] }; p.stages.push({ key: r.stageKey, name: r.stageName }); out.set(r.id, p); }
  return [...out.values()];
}
const canConfigure = (auth: AuthContext) => atLeast(level(auth, 'configuracoes'), 'total') || level(auth, 'resultados') === 'total';


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

/** Meses do ano que a meta cobre: o ano corrente até o mês atual; anos passados, 12. */
const monthsOfYear = (year: string, today: string) => (today.slice(0, 4) === year ? Number(today.slice(5, 7)) : today.slice(0, 4) > year ? 12 : 1);
const monthBounds = (ym: string) => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }; };

async function board(db: DbOrTx, auth: AuthContext, st: GamificationSettings, from: string, to: string, months = 1) {
  const { org, teams } = await participants(db, auth.tenantId, st);
  const memberIds = [...new Set(teams.flatMap((t) => t.memberIds))];
  const [credits, journey] = await Promise.all([creditsBetween(db, auth.tenantId, from, to, auth.timezone, memberIds), journeyCreditsBetween(db, auth.tenantId, from, to, auth.timezone, st)]);
  const r = teamBoards({ teams, credits, settings: st, extra: asExtra(journey.filter((c) => memberIds.includes(c.userId))), months });
  const name = Object.fromEntries(org.people.map((p) => [p.id, p.name]));
  const photos = new Set((await db.execute<{ user_id: string }>(sql`select user_id from user_avatars where user_id in ${memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000']}`)).rows.map((x) => x.user_id));
  const who = (u: string) => ({ name: name[u] ?? '', hasPhoto: photos.has(u) });
  // o time em detalhe (notas de cada pessoa e dispersão) é ferramenta da liderança: quem lidera o time ou tem nível Total
  const leadsTeam = (teamId: string) => level(auth, 'resultados') === 'total' || (org.leads[teamId] ?? []).includes(auth.userId);
  const myTeams = org.teams[auth.userId] ?? [];
  const mine = r.people.find((p) => p.userId === auth.userId) ?? null;
  const fromJourney = (u: string, src: 'tarefa' | 'ganho') => Math.round(journey.filter((c) => c.userId === u && c.source === src && !c.extra).reduce((t, c) => t + c.points, 0) * 10) / 10;
  return {
    teams: r.boards.filter((b) => leadsTeam(b.teamId) || myTeams.includes(b.teamId)).map((b) => {
      const lead = leadsTeam(b.teamId);
      return { teamId: b.teamId, name: teams.find((t) => t.id === b.teamId)!.name, average: b.average, points: b.points, canManage: lead, dispersion: lead ? b.dispersion : null, members: lead ? b.members.map((m) => ({ ...m, ...who(m.userId), tasks: fromJourney(m.userId, 'tarefa'), wins: fromJourney(m.userId, 'ganho') })) : null };
    }),
    me: mine ? { ...mine, tasks: fromJourney(auth.userId, 'tarefa'), wins: fromJourney(auth.userId, 'ganho') } : null,
    people: r.people,
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
      const [m, y] = await Promise.all([board(app.db, auth, settings, mb.from, mb.to), board(app.db, auth, settings, `${year}-01-01`, `${year}-12-31`, monthsOfYear(year, todayIn(auth.timezone)))]);
      const gold = goldMedalists(y.people);
      const goldNames = (await vacationOrg(app.db, auth.tenantId)).people.filter((p) => gold.includes(p.id)).map((p) => ({ userId: p.id, name: p.name }));
      const strip = (b: typeof m) => ({ teams: b.teams, me: b.me });
      return {
        pending: false, proposal: pendingInfo, settings, settingsVersion: version, canConfigure: canConfigure(auth), month, year: Number(year),
        monthBoard: strip(m), yearBoard: strip(y),
        // só o primeiro lugar do ano é reconhecido (sem posições, sem pódio)
        gold: goldNames,
        me: y.me ? { score: y.me.score, level: levelOf(y.me.score, settings)?.name ?? null, gold: gold.includes(auth.userId) } : null,
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
      const journey = await journeyCreditsBetween(app.db, auth.tenantId, `${year}-01-01`, `${year}-12-31`, auth.timezone, settings);
      const r = teamBoards({ teams, credits: await creditsBetween(app.db, auth.tenantId, `${year}-01-01`, `${year}-12-31`, auth.timezone, memberIds), settings, extra: asExtra(journey.filter((c) => memberIds.includes(c.userId))), months: monthsOfYear(year, todayIn(auth.timezone)) });
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
      const org = await vacationOrg(app.db, auth.tenantId);
      const leadSet = new Set(Object.values(org.leads).flat());
      return { ...cur, people: org.people.map((p) => ({ id: p.id, name: p.name, teamIds: p.teamIds, lead: leadSet.has(p.id) })), pipelines: await pipelinesWithStages(app.db, auth.tenantId), proposal: cur.proposal ? { ...cur.proposal, canDecide: canConfigure(auth) && cur.proposal.createdBy !== auth.userId } : null, start: START, history, teams, canConfigure: canConfigure(auth) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/times/gamificacao/settings', summary: 'Propõe nova versão das regras da gamificação (vale só depois de aprovada; substitui a proposta pendente)', tag: 'Gestão de Times', module: 'resultados',
    body: z.object({
      teamIds: z.array(z.string().uuid()).max(100), points: z.record(z.string(), z.number().int()), participationMultiplierBp: z.number().int(),
      competencyLevels: z.array(z.object({ key: z.string().trim().max(30), name: z.string().trim().max(60), rank: z.number().int(), expectedMonthlyPoints: z.number().int(), scoresTasks: z.boolean(), weights: z.object({ ownBp: z.number().int(), teamBp: z.number().int(), dispersionBp: z.number().int(), areaBp: z.number().int() }) })).min(1).max(10),
      assignments: z.record(z.string().uuid(), z.string().max(30)).default({}),
      defaultLevelKey: z.string().max(30), defaultLeadLevelKey: z.string().max(30),
      bonuses: z.object({ onTimeBp: z.number().int(), adherenceBp: z.number().int(), extraPerLevelBp: z.number().int(), extraCapBp: z.number().int(), scoreCapBp: z.number().int() }),
      journeys: z.array(z.object({
        key: z.string().trim().max(40), name: z.string().trim().max(80), pipelineId: z.string().uuid(), wonPoints: z.number().int(),
        components: z.array(z.object({ key: z.string().trim().max(40), name: z.string().trim().max(120), stageKey: z.string().trim().max(60).nullable(), points: z.number().int(), dueDays: z.number().int(), level: z.string().max(30).nullable().optional() })).max(60),
      })).max(30).default([]),
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
      // pessoas com nível cadastrado: da empresa
      const assigned = Object.keys(cfg.assignments);
      if (assigned.length) {
        const found = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, assigned)));
        if (found.length !== assigned.length) throw unprocessable('Pessoa inválida no cadastro de níveis.');
      }
      // jornada: funil da empresa e etapas que existem nele
      const pipes = await pipelinesWithStages(app.db, auth.tenantId);
      for (const j of cfg.journeys) {
        const p = pipes.find((x) => x.id === j.pipelineId);
        if (!p) throw unprocessable(`Jornada "${j.name}": funil inválido.`);
        const bad = j.components.filter((c) => c.stageKey && !p.stages.some((st) => st.key === c.stageKey));
        if (bad.length) throw unprocessable(`Jornada "${j.name}": etapa inexistente no funil ${p.name} (${bad.map((c) => c.name).join(', ')}).`);
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
  defineRoute({
    method: 'GET', url: '/me/pontos', summary: 'Meus pontos (qualquer pessoa logada): nota do mês e do ano, de onde veio cada ponto e a média dos meus times. Nunca mostra colegas', tag: 'Gestão de Times', anyAuthenticated: true,
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
    handler: async ({ app, auth, query }) => {
      await ensureFreshEvents(app.db, auth.tenantId);
      const { settings, version } = await gamificationSettingsOf(app.db, auth.tenantId);
      const month = query.month ?? todayIn(auth.timezone).slice(0, 7);
      const year = month.slice(0, 4);
      if (!settings) return { pending: true, month, year: Number(year) };
      const mb = monthBounds(month);
      const [m, y] = await Promise.all([board(app.db, auth, settings, mb.from, mb.to), board(app.db, auth, settings, `${year}-01-01`, `${year}-12-31`, monthsOfYear(year, todayIn(auth.timezone)))]);
      const participates = !!m.me || (await participants(app.db, auth.tenantId, settings)).teams.some((t) => t.memberIds.includes(auth.userId));
      // de onde vieram os pontos do mês: tarefas da jornada e ganhos (com a oportunidade) e eventos por tipo
      const journey = (await journeyCreditsBetween(app.db, auth.tenantId, mb.from, mb.to, auth.timezone, settings)).filter((c) => c.userId === auth.userId);
      const oppIds = [...new Set(journey.map((c) => c.opportunityId))];
      const opps = oppIds.length ? (await app.db.execute<{ id: string; code: number; contact: string }>(sql`select o.id, o.code, c.name as contact from opportunities o join contacts c on c.id = o.contact_id where o.id in ${oppIds}`)).rows : [];
      const jName = (k: string) => settings.journeys.find((j) => j.key === k)?.name ?? k;
      const items = journey.map((c) => { const o = opps.find((x) => x.id === c.opportunityId); return { source: c.source, journey: jName(c.journeyKey), opportunityId: c.opportunityId, code: o?.code ?? null, contact: o?.contact ?? null, points: c.points, extra: c.extra, bonus: c.bonus ?? null }; });
      const credits = (await creditsBetween(app.db, auth.tenantId, mb.from, mb.to, auth.timezone, [auth.userId])).filter((c) => (settings.points[c.type] ?? 0) > 0 && (c.kind === 'direto' || c.kind === 'participacao'));
      const events = credits.map((c) => ({ type: c.type, kind: c.kind, points: Math.round(((settings.points[c.type] ?? 0) * c.shareBp * (c.kind === 'participacao' ? settings.participationMultiplierBp / 10_000 : 1)) / 1000) / 10 }));
      const gold = goldMedalists(y.people);
      return {
        pending: false, participates, month, year: Number(year), settingsVersion: version,
        participationMultiplierBp: settings.participationMultiplierBp, bonuses: settings.bonuses,
        myLevel: m.me ? settings.competencyLevels.find((l) => l.key === m.me!.levelKey) ?? null : null,
        monthScore: m.me, yearScore: y.me, level: y.me ? levelOf(y.me.score, settings)?.name ?? null : null, gold: gold.includes(auth.userId),
        myTeams: m.teams.map((t) => ({ name: t.name, average: t.average })),
        items, events,
      };
    },
  }),
];
