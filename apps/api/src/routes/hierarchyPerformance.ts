/**
 * Gestão de Times → Performance por nível hierárquico (mês): atividade (gamificação) + metas individuais, do time, da área e da empresa,
 * com os pesos do nível de cada pessoa (regra aprovada). Visibilidade: a própria; a liderança, os times que lidera;
 * quem responde pela área, os times da área; nível Total, todos. Sem ranking (lista em ordem alfabética).
 */
import { and, eq, lte, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { goalsAttainment, groupPerformance, levelFor, performanceScore, PERFORMANCE_COMPONENT_LABELS, type PerformanceComponent } from '@isp/domain';
import { defineRoute } from '../http/route';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { gamificationSettingsOf } from '../services/gamification';
import { goalProgress } from '../services/indicators';
import { vacationOrg, todayIn } from '../services/vacations';
import { activityScores, monthBounds } from './gamification';
import { ensureFreshEvents } from '../services/businessEvents';

export const hierarchyPerformanceRoutes = [
  defineRoute({
    method: 'GET', url: '/times/performance', summary: 'Performance por nível hierárquico no mês: atividade e metas (individual, time, área, empresa) com os pesos do nível; a própria, o time que lidera ou a área que responde', tag: 'Gestão de Times', anyAuthenticated: true,
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
    handler: async ({ app, auth, query }) => {
      await ensureFreshEvents(app.db, auth.tenantId);
      const today = todayIn(auth.timezone);
      const month = query.month ?? today.slice(0, 7);
      const { settings, version } = await gamificationSettingsOf(app.db, auth.tenantId);
      if (!settings) return { pending: true, month };
      const { from, to } = monthBounds(month);
      const org = await vacationOrg(app.db, auth.tenantId);
      const leads = new Set(Object.values(org.leads).flat());
      const units = await app.db.select({ id: s.orgUnits.id, name: s.orgUnits.name, parentId: s.orgUnits.parentId, responsibleId: s.orgUnits.responsibleId }).from(s.orgUnits).where(eq(s.orgUnits.tenantId, auth.tenantId));
      const teamRows = await app.db.select({ id: s.teams.id, orgUnitId: s.teams.orgUnitId }).from(s.teams).where(eq(s.teams.tenantId, auth.tenantId));
      const unitOfTeam = new Map(teamRows.map((t) => [t.id, t.orgUnitId]));
      // área de um time e as áreas acima (quem responde por uma área vê os times abaixo dela)
      const chain = (unitId: string | null) => { const out: string[] = []; let u = unitId; for (let i = 0; u && i < 20; i++) { out.push(u); u = units.find((x) => x.id === u)?.parentId ?? null; } return out; };
      const unitsOfUser = (u: string) => [...new Set((org.teams[u] ?? []).map((t) => unitOfTeam.get(t)).filter((x): x is string => !!x).concat(units.filter((x) => x.responsibleId === u).map((x) => x.id)))];

      // metas do mês (ativas, com período que cruza o mês) e o atingimento de cada uma
      const goals = await app.db.select().from(s.goals).where(and(eq(s.goals.tenantId, auth.tenantId), eq(s.goals.status, 'ativa'), lte(s.goals.periodStart, to), gte(s.goals.periodEnd, from), sql`coalesce(${s.goals.approvalStatus}, 'aprovada') <> 'proposta'`));
      const att = new Map<string, number | null>();
      for (const g of goals) att.set(g.id, (await goalProgress(app.db, auth.timezone, today, g)).attainment);
      const cap = settings.bonuses.scoreCapBp;
      const activity = await activityScores(app.db, auth, settings, from, to);

      const perf = (u: string) => {
        const lv = levelFor(settings, u, leads.has(u));
        const w = settings.performanceWeights[lv.key] ?? { activity: 10_000, individual: 0, team: 0, unit: 0, company: 0 };
        const myTeams = org.teams[u] ?? [];
        const myUnits = unitsOfUser(u);
        const pick = (f: (g: (typeof goals)[number]) => boolean) => { const gs = goals.filter(f); return { value: goalsAttainment(gs.map((g) => att.get(g.id) ?? null), cap), goals: gs.length }; };
        const a = activity.get(u);
        const values: Record<PerformanceComponent, { value: number | null; goals: number }> = {
          activity: { value: a ? a.score : null, goals: 0 },
          individual: pick((g) => g.scope === 'individual' && g.userId === u),
          team: pick((g) => g.scope === 'equipe' && !!g.teamId && myTeams.includes(g.teamId)),
          unit: pick((g) => g.scope === 'unidade' && !!g.orgUnitId && myUnits.includes(g.orgUnitId)),
          company: pick((g) => g.scope === 'empresa'),
        };
        const r = performanceScore(values, w, settings.performanceBands);
        const person = org.people.find((p) => p.id === u);
        return { userId: u, name: person?.name ?? '', levelKey: lv.key, levelName: lv.name, lead: leads.has(u), ...r, components: r.components.map((c) => ({ ...c, label: PERFORMANCE_COMPONENT_LABELS[c.key] })) };
      };

      const total = level(auth, 'resultados') === 'total';
      const myRespUnits = units.filter((x) => x.responsibleId === auth.userId).map((x) => x.id);
      const seesTeam = (teamId: string) => total || (org.leads[teamId] ?? []).includes(auth.userId) || chain(unitOfTeam.get(teamId) ?? null).some((x) => myRespUnits.includes(x));
      const visibleTeams = Object.keys(org.teamNames).filter(seesTeam);
      const photos = new Set((await app.db.execute<{ user_id: string }>(sql`select user_id from user_avatars ua join users u on u.id = ua.user_id where u.tenant_id = ${auth.tenantId}`)).rows.map((r) => r.user_id));
      const teams = visibleTeams.map((id) => {
        const members = org.people.filter((p) => p.teamIds.includes(id)).map((p) => ({ ...perf(p.id), hasPhoto: photos.has(p.id) })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        const unitId = unitOfTeam.get(id) ?? null;
        return { teamId: id, name: org.teamNames[id]!, unitId, unitName: units.find((x) => x.id === unitId)?.name ?? null, average: groupPerformance(members.filter((m) => settings.competencyLevels.find((l) => l.key === m.levelKey)?.scoresTasks).map((m) => m.score)), members };
      }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      // escalonado: área = média dos times da área (e das áreas abaixo)
      const unitsOut = units.filter((un) => teams.some((t) => chain(t.unitId).includes(un.id))).map((un) => ({ id: un.id, name: un.name, average: groupPerformance(teams.filter((t) => chain(t.unitId).includes(un.id)).map((t) => t.average)) }));
      const me = org.people.some((p) => p.id === auth.userId) || activity.has(auth.userId) ? perf(auth.userId) : null;
      return {
        pending: false, month, settingsVersion: version, bands: settings.performanceBands,
        weights: settings.competencyLevels.map((l) => ({ key: l.key, name: l.name, weights: settings.performanceWeights[l.key] ?? null })),
        me, teams, units: unitsOut,
      };
    },
  }),
];
