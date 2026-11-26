/** Dados Planejados: painel de SLA dos chamados do GLPI atribuídos ao Comercial, configuração da régua e rotina. */
import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_SLA_SETTINGS, SITUATION_LABELS, dueText, isOpenStatus, localParts, serviceLevel, ticketDue, ticketSituation, type Situation } from '@isp/domain';
import { defineRoute } from '../http/route';
import { AppError, unauthorized } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { level } from '../services/scope';
import { glpiConfig, glpiGroups, glpiUsers } from '../services/glpi';
import { glpiPeople, isMonitored, runGlpiSla, runGlpiSlaAll, settingsOf, slaSettingsRow } from '../services/glpiSla';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const H = 3_600_000;

const SettingsBody = z.object({
  enabled: z.boolean(),
  rootEntityId: z.number().int().min(0).max(1_000_000).default(0),
  managerIds: z.array(z.string().uuid()).max(30).default([]),
  groupLeaders: z.record(z.string().regex(/^\d+$/), z.array(z.string().uuid()).max(20)).default({}),
  settings: z.object({
    goalPct: z.number().min(1).max(100), slaSource: z.enum(['universal', 'glpi']), solveHours: z.number().min(0).max(2000), ownHours: z.number().min(0).max(2000), businessHoursOnly: z.boolean(),
    businessStart: z.number().int().min(0).max(23), businessEnd: z.number().int().min(1).max(24), businessDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    warnHours: z.array(z.number().min(0.25).max(168)).max(4), unassignedMinutes: z.number().int().min(5).max(10_080), repeatLateHours: z.number().min(0.5).max(72),
    escalateAfterHours: z.number().min(0).max(720), digestHour: z.number().int().min(0).max(23), email: z.boolean(), whatsapp: z.boolean(),
  }),
});

export const plannedDataRoutes = [
  defineRoute({
    method: 'GET', url: '/dados-planejados', summary: 'Chamados do GLPI atribuídos aos grupos e pessoas do Comercial: pendências, prazos, nível de serviço e volume', tag: 'Dados Planejados', module: 'inicio',
    query: z.object({ group: z.coerce.number().int().optional(), userId: z.string().uuid().optional(), from: day.optional(), to: day.optional() }),
    handler: async ({ app, auth, query }) => {
      const st = await slaSettingsRow(app.db, auth.tenantId);
      const set = settingsOf(st);
      const [tn] = await app.db.select({ tz: s.tenants.timezone }).from(s.tenants).where(eq(s.tenants.id, auth.tenantId)).limit(1);
      const tz = tn?.tz ?? 'America/Sao_Paulo';
      const now = new Date();
      const today = localParts(now, tz).date;
      const to = query.to ?? today;
      const from = query.from ?? new Date(new Date(`${to}T12:00:00Z`).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
      const { people, groups } = await glpiPeople(app.db, auth.tenantId);
      const [me] = await app.db.select({ glpiGroupIds: s.users.glpiGroupIds }).from(s.users).where(eq(s.users.id, auth.userId)).limit(1);
      const all = level(auth, 'inicio') === 'total';
      // abertos (qualquer data) + os do período (abertos ou resolvidos nele)
      const fromTs = new Date(new Date(`${from}T00:00:00Z`).getTime() - 86_400_000);
      const rows = (await app.db.select().from(s.glpiQueueTickets).where(and(eq(s.glpiQueueTickets.tenantId, auth.tenantId),
        or(isNull(s.glpiQueueTickets.status), lt(s.glpiQueueTickets.status, 5), gte(s.glpiQueueTickets.openedAt, fromTs), gte(s.glpiQueueTickets.solvedAt, fromTs)))))
        .filter((r) => isMonitored(r, groups))
        // quem não vê tudo: os seus e os dos seus grupos
        .filter((r) => all || r.userIds.includes(auth.userId) || r.groupIds.some((g) => me?.glpiGroupIds.includes(g)))
        .filter((r) => query.group === undefined || r.groupIds.includes(query.group))
        .filter((r) => !query.userId || r.userIds.includes(query.userId));
      const inPeriod = (d: Date | null) => { if (!d) return false; const x = localParts(d, tz).date; return x >= from && x <= to; };
      const enriched = rows.map((r) => {
        const due = ticketDue(r, set, tz);
        const sit = ticketSituation({ ...r, assignedUserIds: r.glpiUserIds }, now, set, tz);
        return { r, due, sit };
      });
      const open = enriched.filter((x) => isOpenStatus(x.r.status));
      const solved = enriched.filter((x) => !isOpenStatus(x.r.status) && inPeriod(x.r.solvedAt ?? x.r.closedAt));
      const soonIn = (x: (typeof open)[number], h: number) => x.due && x.due.getTime() - now.getTime() <= h * H && x.due.getTime() > now.getTime();
      // último aviso de cada chamado
      const ids = open.map((x) => x.r.id);
      const alerts = ids.length ? await app.db.select({ ticketId: s.glpiSlaAlerts.ticketId, stage: s.glpiSlaAlerts.stage, channel: s.glpiSlaAlerts.channel, ok: s.glpiSlaAlerts.ok, sentAt: s.glpiSlaAlerts.sentAt, userName: s.users.name })
        .from(s.glpiSlaAlerts).innerJoin(s.users, eq(s.users.id, s.glpiSlaAlerts.userId)).where(and(eq(s.glpiSlaAlerts.tenantId, auth.tenantId), inArray(s.glpiSlaAlerts.ticketId, ids))).orderBy(desc(s.glpiSlaAlerts.sentAt)) : [];
      const lastAlert = new Map<string, { stage: string; channels: string[]; names: string[]; sentAt: Date }>();
      for (const a of alerts) {
        if (!a.ticketId || !a.ok) continue;
        const cur = lastAlert.get(a.ticketId);
        if (!cur) lastAlert.set(a.ticketId, { stage: a.stage, channels: [a.channel], names: [a.userName], sentAt: a.sentAt });
        else if (cur.stage === a.stage && Math.abs(cur.sentAt.getTime() - a.sentAt.getTime()) < 10 * 60_000) {
          if (!cur.channels.includes(a.channel)) cur.channels.push(a.channel);
          if (!cur.names.includes(a.userName)) cur.names.push(a.userName);
        }
      }
      const order: Record<string, number> = { atrasado: 0, a_vencer: 1, no_prazo: 2, sem_prazo: 3 };
      const cfg = await glpiConfig(app.db, auth.tenantId).catch(() => null);
      const pending = open.sort((a, b) => (order[a.sit]! - order[b.sit]!) || ((a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity))).map((x) => ({
        id: x.r.id, glpiId: x.r.glpiId, title: x.r.title, client: x.r.entityName, groups: x.r.groupNames, situation: x.sit, situationLabel: SITUATION_LABELS[x.sit],
        assignees: x.r.glpiUserNames, unassigned: !x.r.glpiUserIds.length, statusName: x.r.statusName, openedAt: x.r.openedAt, due: x.due, dueText: dueText(x.due, now),
        todo: x.r.takenAt ? 'solucionar' : 'assumir e solucionar', glpiUrl: cfg ? `${cfg.baseUrl}/front/ticket.form.php?id=${x.r.glpiId}` : null,
        lastAlert: lastAlert.get(x.r.id) ?? null,
      }));
      const sits = (list: typeof enriched) => list.map((x) => x.sit);
      const kpi = {
        open: open.length, ok: open.filter((x) => x.sit === 'no_prazo' || x.sit === 'sem_prazo').length, soon: open.filter((x) => x.sit === 'a_vencer').length,
        soon4h: open.filter((x) => soonIn(x, 4)).length, late: open.filter((x) => x.sit === 'atrasado').length,
        unassigned: open.filter((x) => !x.r.glpiUserIds.length).length,
        serviceLevel: serviceLevel(sits(solved)), solved: solved.length, solvedLate: solved.filter((x) => x.sit === 'resolvido_fora').length,
        firstResponseMin: (() => { const xs = enriched.filter((x) => x.r.takenAt && inPeriod(x.r.openedAt)).map((x) => (x.r.takenAt!.getTime() - x.r.openedAt.getTime()) / 60_000).filter((m) => m >= 0); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null; })(),
        oldestLate: (() => { const l = open.filter((x) => x.sit === 'atrasado').sort((a, b) => a.due!.getTime() - b.due!.getTime())[0]; return l ? { glpiId: l.r.glpiId, dueText: dueText(l.due, now), unassigned: !l.r.glpiUserIds.length, group: l.r.groupNames.join(', ') } : null; })(),
      };
      // volume por dia (abertos e resolvidos no período)
      const days: { date: string; opened: number; solved: number; solvedLate: number }[] = [];
      for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to && days.length < 92; d = new Date(d.getTime() + 86_400_000)) days.push({ date: d.toISOString().slice(0, 10), opened: 0, solved: 0, solvedLate: 0 });
      const byDate = new Map(days.map((d) => [d.date, d]));
      for (const x of enriched) {
        const o = byDate.get(localParts(x.r.openedAt, tz).date); if (o) o.opened++;
        const sd = x.r.solvedAt ?? x.r.closedAt;
        if (!isOpenStatus(x.r.status) && sd) { const v = byDate.get(localParts(sd, tz).date); if (v) { v.solved++; if (x.sit === 'resolvido_fora') v.solvedLate++; } }
      }
      // hora a hora (dia da semana × hora da abertura) no período
      const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
      for (const x of enriched) if (inPeriod(x.r.openedAt)) { const p = localParts(x.r.openedAt, tz); heat[p.weekday]![p.hour]!++; }
      // por grupo e pessoa
      const line = (list: typeof enriched) => {
        const o = list.filter((x) => isOpenStatus(x.r.status));
        const sv = list.filter((x) => !isOpenStatus(x.r.status) && inPeriod(x.r.solvedAt ?? x.r.closedAt));
        return { open: o.length, ok: o.filter((x) => x.sit === 'no_prazo' || x.sit === 'sem_prazo').length, soon: o.filter((x) => x.sit === 'a_vencer').length, late: o.filter((x) => x.sit === 'atrasado').length, solved: sv.length, serviceLevel: serviceLevel(sits(sv)) };
      };
      const byGroup = [...groups].filter(([g]) => query.group === undefined || g === query.group).map(([g, name]) => {
        const list = enriched.filter((x) => x.r.groupIds.includes(g));
        const ppl = people.filter((p) => p.glpiGroupIds.includes(g)).map((p) => ({ userId: p.id, name: p.name, ...line(list.filter((x) => x.r.userIds.includes(p.id))) }));
        const noOwner = list.filter((x) => !x.r.glpiUserIds.length);
        return { groupId: g, name, ...line(list), people: [...ppl.filter((p) => p.open || p.solved), ...(noOwner.length ? [{ userId: null, name: 'Sem responsável', ...line(noOwner) }] : [])] };
      }).filter((g) => all || me?.glpiGroupIds.includes(g.groupId));
      return {
        configured: { enabled: st.enabled, glpi: !!cfg, people: people.length, groups: groups.size }, lastSyncAt: st.lastSyncAt, lastError: st.lastError,
        period: { from, to }, sla: { source: set.slaSource, solveHours: set.solveHours, ownHours: set.ownHours, businessHoursOnly: set.businessHoursOnly, goalPct: set.goalPct },
        kpi, pending, days, heat, byGroup,
        filters: { groups: [...groups].map(([id, name]) => ({ id, name })).filter((g) => all || me?.glpiGroupIds.includes(g.id)), people: (all ? people : people.filter((p) => p.glpiGroupIds.some((g) => me?.glpiGroupIds.includes(g)))).map((p) => ({ id: p.id, name: p.name })) },
        canConfigure: level(auth, 'configuracoes') === 'total',
      };
    },
  }),

  defineRoute({
    method: 'POST', url: '/dados-planejados/tick', summary: 'Lê o GLPI e manda os avisos que venceram (no máximo a cada 4 minutos por empresa; chamado pela tela aberta)', tag: 'Dados Planejados', anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      const r = await runGlpiSla(app.db, app.config, auth.tenantId);
      return { ran: !('skipped' in r) };
    },
  }),

  defineRoute({
    method: 'GET', url: '/admin/dados-planejados', summary: 'Configuração dos Dados Planejados: SLA universal, régua de avisos, líderes dos grupos e gestão', tag: 'Dados Planejados', ...ADMIN,
    handler: async ({ app, auth }) => {
      const st = await slaSettingsRow(app.db, auth.tenantId);
      const { people, groups } = await glpiPeople(app.db, auth.tenantId);
      const recent = await app.db.select({ stage: s.glpiSlaAlerts.stage, channel: s.glpiSlaAlerts.channel, ok: s.glpiSlaAlerts.ok, error: s.glpiSlaAlerts.error, sentAt: s.glpiSlaAlerts.sentAt, alertKey: s.glpiSlaAlerts.alertKey, userName: s.users.name })
        .from(s.glpiSlaAlerts).innerJoin(s.users, eq(s.users.id, s.glpiSlaAlerts.userId)).where(eq(s.glpiSlaAlerts.tenantId, auth.tenantId)).orderBy(desc(s.glpiSlaAlerts.sentAt)).limit(30);
      return {
        enabled: st.enabled, rootEntityId: st.rootEntityId, managerIds: st.managerIds, groupLeaders: st.groupLeaders, settings: settingsOf(st), defaults: DEFAULT_SLA_SETTINGS,
        groups: [...groups].map(([id, name]) => ({ id, name, members: people.filter((p) => p.glpiGroupIds.includes(id)).map((p) => p.name) })),
        people: people.map((p) => ({ id: p.id, name: p.name, hasPhone: !!p.phone })), lastSyncAt: st.lastSyncAt, lastRunAt: st.lastRunAt, lastError: st.lastError, recent,
      };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/dados-planejados', summary: 'Salva a configuração dos Dados Planejados', tag: 'Dados Planejados', ...ADMIN, body: SettingsBody,
    handler: async ({ app, auth, body, req }) => {
      if (body.settings.businessEnd <= body.settings.businessStart) throw new AppError(422, 'Horário inválido', 'O fim do horário comercial precisa ser depois do início.');
      const ids = [...new Set([...body.managerIds, ...Object.values(body.groupLeaders).flat()])];
      if (ids.length) {
        const ok = await app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), inArray(s.users.id, ids)));
        if (ok.length !== ids.length) throw new AppError(422, 'Pessoa inválida', 'Escolha pessoas da empresa.');
      }
      await slaSettingsRow(app.db, auth.tenantId);
      await app.db.update(s.glpiSlaSettings).set({ enabled: body.enabled, rootEntityId: body.rootEntityId, managerIds: body.managerIds, groupLeaders: body.groupLeaders, settings: body.settings, updatedBy: auth.userId, updatedAt: new Date() })
        .where(eq(s.glpiSlaSettings.tenantId, auth.tenantId));
      await audit(app.db, req, { action: 'dados_planejados.config', entityType: 'tenant', entityId: auth.tenantId, metadata: { enabled: body.enabled, sla: body.settings.slaSource, solveHours: body.settings.solveHours } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/dados-planejados/run', summary: 'Lê o GLPI e confere os avisos agora', tag: 'Dados Planejados', ...ADMIN,
    // releitura completa (45 dias): pega o que uma leitura incremental anterior possa ter deixado de fora
    handler: async ({ app, auth }) => runGlpiSla(app.db, app.config, auth.tenantId, { force: true, full: true }),
  }),
  defineRoute({
    method: 'GET', url: '/admin/glpi/users', summary: 'Usuários do GLPI (para o cadastro de usuários)', tag: 'Dados Planejados', ...ADMIN, query: z.object({ q: z.string().max(80).optional() }),
    handler: async ({ app, auth, query }) => ({ items: await glpiUsers(await glpiConfig(app.db, auth.tenantId), query.q) }),
  }),
  defineRoute({
    method: 'GET', url: '/admin/glpi/groups', summary: 'Grupos do GLPI (para o cadastro de usuários)', tag: 'Dados Planejados', ...ADMIN, query: z.object({ q: z.string().max(80).optional() }),
    handler: async ({ app, auth, query }) => ({ items: (await glpiGroups(await glpiConfig(app.db, auth.tenantId), query.q)).map((g) => ({ id: g.id, name: g.completename ?? g.name })) }),
  }),
  defineRoute({
    method: 'GET', url: '/cron/glpi-sla', summary: 'Rotina dos Dados Planejados para um agendador externo (a cada 5 min). Exige Authorization: Bearer CRON_SECRET.', tag: 'Dados Planejados', public: true,
    handler: async ({ app, req }) => {
      const secret = app.config.cronSecret;
      if (!secret) throw new AppError(503, 'Agendamento desligado', 'Defina CRON_SECRET.');
      const given = Buffer.from(String(req.headers.authorization ?? ''));
      const expected = Buffer.from(`Bearer ${secret}`);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized();
      return runGlpiSlaAll(app.db, app.config);
    },
  }),
];
