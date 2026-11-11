/**
 * Pessoas & Gestão · Ficha do colaborador — o consolidado da pessoa, para qualquer área (não só a comercial):
 * dados e perfil, liderança atual e histórico, indicadores da função (scorecard por cargo/time/perfil), contribuições
 * registradas em todos os módulos, gamificação (pontos, nota e badges), metas, treinamentos, reconhecimentos,
 * feedback (só números), férias, intervenções e a linha do tempo da jornada.
 *
 * Quem abre: a própria pessoa, a liderança vigente (liderados diretos) e o RH. Conteúdo de feedback nunca entra aqui
 * (nem para o RH): só contagens e prazos. Toda consulta de terceiros fica na auditoria.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { forbidden, notFound } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { peopleCaps, peopleSettingsOf } from '../services/people/settings';
import { institutionalOf, publicCard } from '../services/people/profiles';
import { eligibleMembers } from '../services/people/audience';
import { reportsOf, syncReportingLines } from '../services/people/reporting';
import { gamificationSettingsOf } from '../services/gamification';
import { activityScores, badgesBetween, monthBounds } from './gamification';
import { FEEDBACK_MODALITIES, type FeedbackModality } from '../services/people/devPolicy';
import { todayIn } from '../services/vacations';
import { scorecardsFor } from '../services/indicators';
import { eventTypeDef } from '@isp/domain';

const MODULE_LABEL: Record<string, string> = { comercial: 'Comercial', email: 'Atendimento por e-mail', aprovacoes: 'Aprovações', contratos: 'Contratos', atas: 'Atas de registro de preços', tarefas: 'Tarefas e entregas', projetos: 'Projetos', sucesso_cliente: 'Sucesso do Cliente', abm: 'ABM', outros: 'Outros' };
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';

const M = { tag: 'Pessoas & Gestão', module: 'pessoas' as const };

/** Quem a pessoa pode consultar: ela mesma; liderados diretos vigentes; RH, todos com o módulo. */
async function scopeOf(db: DbOrTx, auth: AuthContext) {
  await syncReportingLines(db, auth.tenantId);
  const caps = peopleCaps(auth, await peopleSettingsOf(db, auth.tenantId));
  const reports = await reportsOf(db, auth.tenantId, auth.userId);
  return { hr: caps.hr, reports: new Set(reports) };
}

export const peopleRecordRoutes = [
  defineRoute({
    method: 'GET', url: '/pessoas/desenvolvimento/pessoas', summary: 'Colaboradores cuja ficha posso abrir (liderados diretos; RH: todos com o módulo)', ...M,
    query: z.object({ q: z.string().trim().max(80).optional() }),
    handler: async ({ app, auth, query }) => {
      const sc = await scopeOf(app.db, auth);
      const ids = sc.hr ? [...(await eligibleMembers(app.db, auth.tenantId, todayIn(auth.timezone))).keys()] : [...sc.reports];
      const people = await institutionalOf(app.db, auth.tenantId, [...new Set([auth.userId, ...ids])]);
      const term = (query.q ?? '').toLowerCase();
      const items = [...people.values()].filter((p) => p.active && (!term || p.name.toLowerCase().includes(term) || (p.jobTitle ?? '').toLowerCase().includes(term)))
        .map((p) => ({ ...publicCard(p), relation: p.id === auth.userId ? 'eu' : sc.reports.has(p.id) ? 'liderado' : 'rh' }))
        .sort((a, b) => (a.relation === 'eu' ? -1 : b.relation === 'eu' ? 1 : a.name.localeCompare(b.name)));
      return { items, hr: sc.hr };
    },
  }),
  defineRoute({
    method: 'GET', url: '/pessoas/desenvolvimento/pessoas/:userId', summary: 'Ficha consolidada do colaborador', ...M,
    params: z.object({ userId: z.string().uuid() }),
    handler: async ({ app, auth, params, req }) => {
      const sc = await scopeOf(app.db, auth);
      const self = params.userId === auth.userId;
      const relation = self ? 'eu' : sc.reports.has(params.userId) ? 'liderado' : sc.hr ? 'rh' : null;
      if (!relation) throw forbidden('A ficha é da própria pessoa, da liderança direta e do RH.');
      const db = app.db;
      const t = auth.tenantId;
      const uid = params.userId;
      const [u] = await db.select({ id: s.users.id, createdAt: s.users.createdAt, active: s.users.active }).from(s.users).where(and(eq(s.users.tenantId, t), eq(s.users.id, uid))).limit(1);
      if (!u) throw notFound('Colaborador não encontrado.');
      if (!self) await audit(db, req, { action: 'dev.record.view', entityType: 'user', entityId: uid, metadata: { relation } });
      const today = todayIn(auth.timezone);
      const year = today.slice(0, 4);
      const month = today.slice(0, 7);

      const [lines, profile, goals, trainings, courses, recog, fbRecv, fbSent, vacations, ivs, awards, wins] = await Promise.all([
        db.select().from(s.reportingLines).where(and(eq(s.reportingLines.tenantId, t), eq(s.reportingLines.userId, uid))).orderBy(desc(s.reportingLines.validFrom)).limit(30),
        db.select().from(s.peopleProfiles).where(eq(s.peopleProfiles.userId, uid)).limit(1),
        db.select({ id: s.goals.id, title: s.goals.title, target: s.goals.target, unit: s.goals.manualUnit, periodStart: s.goals.periodStart, periodEnd: s.goals.periodEnd, category: s.goals.category }).from(s.goals)
          .where(and(eq(s.goals.tenantId, t), eq(s.goals.userId, uid), eq(s.goals.status, 'ativa'), sql`${s.goals.periodEnd} >= ${`${year}-01-01`}`)).orderBy(desc(s.goals.periodStart)).limit(24),
        db.select({ id: s.trainingCertificates.id, title: s.trainingCertificates.title, hours: s.trainingCertificates.hours, issuedOn: s.trainingCertificates.issuedOn, code: s.trainingCertificates.code }).from(s.trainingCertificates).where(and(eq(s.trainingCertificates.tenantId, t), eq(s.trainingCertificates.userId, uid))).orderBy(desc(s.trainingCertificates.issuedOn)).limit(50),
        db.select({ id: s.gamificationCertificates.id, title: s.gamificationCertificates.title, institution: s.gamificationCertificates.institution, hours: s.gamificationCertificates.hours, completedOn: s.gamificationCertificates.completedOn, status: s.gamificationCertificates.status }).from(s.gamificationCertificates).where(and(eq(s.gamificationCertificates.tenantId, t), eq(s.gamificationCertificates.userId, uid))).orderBy(desc(s.gamificationCertificates.completedOn)).limit(50),
        db.select({ id: s.peopleRecognitions.id, fromUserId: s.peopleRecognitions.fromUserId, message: s.peopleRecognitions.message, visibility: s.peopleRecognitions.visibility, createdAt: s.peopleRecognitions.createdAt, category: s.peopleRecognitionCategories.name, emoji: s.peopleRecognitionCategories.emoji })
          .from(s.peopleRecognitions).innerJoin(s.peopleRecognitionCategories, eq(s.peopleRecognitionCategories.id, s.peopleRecognitions.categoryId))
          .where(and(eq(s.peopleRecognitions.tenantId, t), eq(s.peopleRecognitions.toUserId, uid), eq(s.peopleRecognitions.status, 'valido'))).orderBy(desc(s.peopleRecognitions.createdAt)).limit(100),
        db.select({ modality: s.peopleFeedbacks.modality, direction: s.peopleFeedbacks.direction, mode: s.peopleFeedbacks.mode, status: s.peopleFeedbacks.status, sentAt: s.peopleFeedbacks.sentAt, acknowledgedAt: s.peopleFeedbacks.acknowledgedAt })
          .from(s.peopleFeedbacks).where(and(eq(s.peopleFeedbacks.tenantId, t), eq(s.peopleFeedbacks.recipientId, uid), inArray(s.peopleFeedbacks.status, ['enviado', 'ciente', 'repassado']))),
        db.select({ direction: s.peopleFeedbacks.direction, n: sql<number>`count(*)::int` }).from(s.peopleFeedbacks).where(and(eq(s.peopleFeedbacks.tenantId, t), eq(s.peopleFeedbacks.senderId, uid), sql`${s.peopleFeedbacks.status} <> 'rascunho'`)).groupBy(s.peopleFeedbacks.direction),
        db.select({ id: s.vacations.id, startDate: s.vacations.startDate, days: s.vacations.days, status: s.vacations.status }).from(s.vacations).where(and(eq(s.vacations.tenantId, t), eq(s.vacations.userId, uid))).orderBy(desc(s.vacations.startDate)).limit(10),
        db.select({ id: s.interventions.id, title: s.interventions.title, status: s.interventions.status, dueOn: s.interventions.dueOn, kind: s.interventions.kind }).from(s.interventions).where(and(eq(s.interventions.tenantId, t), eq(s.interventions.subjectUserId, uid))).orderBy(desc(s.interventions.dueOn)).limit(20),
        db.select().from(s.peopleBadgeAwards).where(and(eq(s.peopleBadgeAwards.tenantId, t), eq(s.peopleBadgeAwards.userId, uid))).orderBy(desc(s.peopleBadgeAwards.awardedAt)),
        // contribuições do ano em todos os módulos (CRM, contratos, projetos, tarefas, Sucesso do Cliente, e-mail…)
        db.execute<{ type: string; n: number }>(sql`select type, count(*)::int as n from business_events where tenant_id = ${t} and (owner_id = ${uid} or ${uid}::uuid = any(participants)) and validation = 'valido' and occurred_at >= ${`${year}-01-01`}::date group by type`),
      ]);
      const closings = goals.length ? await db.execute<{ goal_id: string; competencia: string; value: number | null; attainment: number | null; color: string }>(sql`
        select distinct on (goal_id) goal_id, competencia, value, attainment, color from result_closings where tenant_id = ${t} and goal_id in (${sql.join(goals.map((g) => sql`${g.id}::uuid`), sql`, `)}) order by goal_id, competencia desc, version desc`) : { rows: [] };

      // gamificação: pontos e nota do mês e do ano, badges do ano (mesmas fontes da tela de pontos)
      const { settings } = await gamificationSettingsOf(db, t);
      let gamification: unknown = null;
      if (settings) {
        const mb = monthBounds(month);
        const [m, y, badges] = await Promise.all([
          activityScores(db, auth, settings, mb.from, mb.to),
          activityScores(db, auth, settings, `${year}-01-01`, `${year}-12-31`, Number(month.slice(5, 7))),
          badgesBetween(db, auth, settings, `${year}-01-01`, `${year}-12-31`, [uid]),
        ]);
        const pm = m.get(uid);
        const py = y.get(uid);
        gamification = {
          month: pm ? { points: pm.points, score: pm.score, level: pm.levelName } : null,
          year: py ? { points: py.points, score: py.score } : null,
          badges: (badges.get(uid) ?? []).map((b) => ({ key: b.key, name: b.name, description: b.description, points: b.points, tier: b.tier, tierIndex: b.tierIndex, next: b.next })),
        };
      }

      // indicadores da função (scorecard por cargo, time ou perfil): vale para qualquer área
      const scorecards = await scorecardsFor(db, t, auth.timezone, uid, today).catch(() => ({ cards: [], composite: null }));
      const others = [...new Set([...lines.map((l) => l.managerId), ...recog.map((r) => r.fromUserId)])];
      const people = await institutionalOf(db, t, [uid, ...others]);
      const me = people.get(uid);
      if (!me) throw notFound('Colaborador não encontrado.');
      const name = (id: string) => people.get(id)?.name ?? 'Colaborador';
      const recv = fbRecv;
      const byMod = Object.fromEntries((Object.keys(FEEDBACK_MODALITIES) as FeedbackModality[]).map((k) => [k, recv.filter((f) => f.modality === k).length]));
      // reconhecimento privado: só aparece para a própria pessoa
      const recognitions = recog.filter((r) => r.visibility === 'publica' || self);

      type Ev = { at: string; kind: string; title: string; detail?: string | null };
      const timeline: Ev[] = [
        { at: u.createdAt.toISOString(), kind: 'entrada', title: 'Entrou na ISP-SPRINT' },
        ...lines.map((l) => ({ at: l.validFrom.toISOString(), kind: 'lideranca', title: `Liderança: ${name(l.managerId)}`, detail: l.validTo ? `até ${l.validTo.toISOString().slice(0, 10).split('-').reverse().join('/')}` : 'atual' })),
        ...awards.map((a) => ({ at: a.awardedAt.toISOString(), kind: 'badge', title: `Badge ${a.badgeKey.charAt(0).toUpperCase()}${a.badgeKey.slice(1)} · ${a.tierName}`, detail: String(a.year) })),
        ...trainings.map((c) => ({ at: `${c.issuedOn}T12:00:00Z`, kind: 'treinamento', title: `Certificado: ${c.title}`, detail: `${c.hours} h` })),
        ...courses.filter((c) => c.status === 'aprovado').map((c) => ({ at: `${c.completedOn}T12:00:00Z`, kind: 'curso', title: `Curso: ${c.title}`, detail: `${c.institution} · ${c.hours} h` })),
        ...recognitions.slice(0, 30).map((r) => ({ at: r.createdAt.toISOString(), kind: 'reconhecimento', title: `${r.emoji} Reconhecido(a) por ${name(r.fromUserId)}`, detail: r.category })),
        ...recv.filter((f) => f.sentAt).map((f) => ({ at: f.sentAt!.toISOString(), kind: 'feedback', title: `Feedback recebido: ${FEEDBACK_MODALITIES[f.modality as FeedbackModality]}`, detail: f.direction === 'ascendente' ? 'do time' : 'da liderança' })),
        ...vacations.map((v) => ({ at: `${v.startDate}T12:00:00Z`, kind: 'ferias', title: `Férias (${v.days} dias)`, detail: v.status })),
      ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);

      return {
        relation,
        contributions: (() => {
          const by = new Map<string, { module: string; label: string; items: { type: string; label: string; count: number }[]; total: number }>();
          for (const r of wins.rows) {
            const def = eventTypeDef(r.type);
            const mod = def?.module ?? 'outros';
            const g = by.get(mod) ?? { module: mod, label: MODULE_LABEL[mod] ?? mod, items: [], total: 0 };
            g.items.push({ type: r.type, label: def?.label ?? r.type, count: Number(r.n) });
            g.total += Number(r.n);
            by.set(mod, g);
          }
          return [...by.values()].sort((a, b) => b.total - a.total);
        })(),
        scorecards,
        person: { ...publicCard(me), email: me.email, phone: me.phone, teams: me.teams, memberSince: u.createdAt, bio: profile[0]?.bio ?? null, interests: profile[0]?.interests ?? [], skills: profile[0]?.skills ?? [] },
        leadership: {
          current: lines.filter((l) => !l.validTo).map((l) => people.get(l.managerId)).filter(Boolean).map((p) => publicCard(p!)),
          history: lines.map((l) => ({ manager: name(l.managerId), from: l.validFrom, to: l.validTo, source: l.source })),
        },
        gamification,
        awards: awards.map((a) => ({ badgeKey: a.badgeKey, year: a.year, tier: a.tierName, at: a.awardedAt })),
        goals: goals.map((g) => { const c = closings.rows.find((x) => x.goal_id === g.id); return { ...g, last: c ? { competencia: c.competencia, value: c.value, attainment: c.attainment, color: c.color } : null }; }),
        trainings, courses,
        recognitions: { total: recognitions.length, items: recognitions.slice(0, 10).map((r) => ({ id: r.id, from: name(r.fromUserId), category: r.category, emoji: r.emoji, message: r.visibility === 'publica' || self ? r.message : null, at: r.createdAt })) },
        feedback: {
          received: recv.length, byModality: byMod, pendingAck: recv.filter((f) => !f.acknowledgedAt).length,
          fromLeadership: recv.filter((f) => f.direction === 'descendente').length, fromTeam: recv.filter((f) => f.direction === 'ascendente').length,
          sentToTeam: Number(fbSent.find((x) => x.direction === 'descendente')?.n ?? 0), sentToLeadership: Number(fbSent.find((x) => x.direction === 'ascendente')?.n ?? 0),
          lastReceivedAt: recv.map((f) => f.sentAt).filter(Boolean).sort().at(-1) ?? null,
        },
        vacations, interventions: ivs,
        timeline,
      };
    },
  }),
];

