/**
 * Certificados de cursos complementares (Gestão de Times → Gamificação): a pessoa envia o certificado de um curso
 * da sua área; a liderança do time valida (ninguém valida o próprio); validado, vira pontos extras pela regra aprovada.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { atLeast, certificateCredits, certificateRawPoints, sectorLabel, type GamificationSettings } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { audit } from '../services/audit';
import { gamificationSettingsOf } from '../services/gamification';
import { todayIn, vacationOrg } from '../services/vacations';
import { detectAttachment } from './sprint';

const canConfigure = (auth: AuthContext) => atLeast(level(auth, 'configuracoes'), 'total') || level(auth, 'resultados') === 'total';

/** Créditos de certificados validados no período (teto mensal desde o início do mês). */
export async function certificateCreditsBetween(db: DbOrTx, tenantId: string, from: string, to: string, st: GamificationSettings) {
  if (!st.certificates) return [];
  const rows = await db.select({ id: s.gamificationCertificates.id, userId: s.gamificationCertificates.userId, hours: s.gamificationCertificates.hours, approvedOn: s.gamificationCertificates.approvedOn, title: s.gamificationCertificates.title })
    .from(s.gamificationCertificates).where(and(eq(s.gamificationCertificates.tenantId, tenantId), eq(s.gamificationCertificates.status, 'aprovado'), sql`${s.gamificationCertificates.approvedOn} between ${`${from.slice(0, 7)}-01`}::date and ${to}::date`));
  return certificateCredits(rows.map((r) => ({ id: r.id, userId: r.userId, hours: r.hours, approvedOn: r.approvedOn! })), st.certificates)
    .map((c) => { const r = rows.find((x) => x.id === c.certificateId)!; return { ...c, title: r.title, approvedOn: r.approvedOn! }; })
    .filter((c) => c.approvedOn >= from);
}

/** Áreas da pessoa: setores do cadastro e times de que participa. */
async function areasOf(db: DbOrTx, tenantId: string, userId: string) {
  const [u] = await db.select({ sectors: s.users.sectors }).from(s.users).where(and(eq(s.users.id, userId), eq(s.users.tenantId, tenantId)));
  const org = await vacationOrg(db, tenantId);
  return [...new Set([...(u?.sectors ?? []).map((k) => sectorLabel(k)), ...(org.teams[userId] ?? []).map((t) => org.teamNames[t] ?? '').filter(Boolean)])];
}

/** Quem valida: liderança de um time da pessoa ou quem administra a gamificação; nunca a própria pessoa. */
async function canValidate(db: DbOrTx, auth: AuthContext, ownerId: string) {
  if (ownerId === auth.userId) return false;
  if (canConfigure(auth)) return true;
  const org = await vacationOrg(db, auth.tenantId);
  return (org.teams[ownerId] ?? []).some((t) => (org.leads[t] ?? []).includes(auth.userId));
}

const view = (r: typeof s.gamificationCertificates.$inferSelect, names: Map<string, string>, points: number | null) => ({
  id: r.id, userId: r.userId, userName: names.get(r.userId) ?? '', title: r.title, institution: r.institution, area: r.area, hours: r.hours, completedOn: r.completedOn,
  fileName: r.fileName, status: r.status, decidedBy: r.decidedBy ? names.get(r.decidedBy) ?? '' : null, decidedAt: r.decidedAt, approvedOn: r.approvedOn, decisionNote: r.decisionNote, createdAt: r.createdAt, points,
});

export const certificateRoutes = [
  defineRoute({
    method: 'GET', url: '/times/certificados', summary: 'Meus certificados (com pontos) e os que eu valido; regra vigente dos certificados', tag: 'Gestão de Times', anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      const { settings } = await gamificationSettingsOf(app.db, auth.tenantId);
      const rule = settings?.certificates ?? null;
      const org = await vacationOrg(app.db, auth.tenantId);
      const led = Object.entries(org.leads).filter(([, l]) => l.includes(auth.userId)).map(([t]) => t);
      const people = canConfigure(auth) ? null : [...new Set(Object.entries(org.teams).filter(([, ts]) => ts.some((t) => led.includes(t))).map(([u]) => u))].filter((u) => u !== auth.userId);
      const mine = await app.db.select().from(s.gamificationCertificates).where(and(eq(s.gamificationCertificates.tenantId, auth.tenantId), eq(s.gamificationCertificates.userId, auth.userId))).orderBy(desc(s.gamificationCertificates.createdAt)).limit(50);
      const toValidate = people && !people.length ? [] : await app.db.select().from(s.gamificationCertificates).where(and(eq(s.gamificationCertificates.tenantId, auth.tenantId), eq(s.gamificationCertificates.status, 'pendente'), people ? inArray(s.gamificationCertificates.userId, people) : sql`${s.gamificationCertificates.userId} <> ${auth.userId}`)).orderBy(s.gamificationCertificates.createdAt).limit(100);
      const ids = [...new Set([...mine, ...toValidate].flatMap((r) => [r.userId, r.decidedBy].filter(Boolean) as string[]))];
      const names = new Map((ids.length ? await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids)) : []).map((u) => [u.id, u.name]));
      // pontos dos meus validados (com o teto do mês aplicado na ordem de validação)
      const credits = rule ? certificateCredits(mine.filter((r) => r.status === 'aprovado').map((r) => ({ id: r.id, userId: r.userId, hours: r.hours, approvedOn: r.approvedOn! })), rule) : [];
      return {
        rule, areas: await areasOf(app.db, auth.tenantId, auth.userId), canValidate: canConfigure(auth) || led.length > 0,
        mine: mine.map((r) => view(r, names, r.status === 'aprovado' ? credits.find((c) => c.certificateId === r.id)?.points ?? 0 : rule ? certificateRawPoints(r.hours, rule) : null)),
        toValidate: toValidate.map((r) => view(r, names, rule ? certificateRawPoints(r.hours, rule) : null)),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/times/certificados', summary: 'Envia certificado de curso complementar da sua área (PDF, PNG ou JPG até 3 MB) para validação', tag: 'Gestão de Times', anyAuthenticated: true, bodyLimit: 4_400_000,
    body: z.object({ title: z.string().trim().min(3).max(200), institution: z.string().trim().min(2).max(200), area: z.string().trim().min(2).max(120), hours: z.number().int().min(1).max(2000), completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fileName: z.string().trim().min(1).max(200), data: z.string().min(8).max(4_200_000) }),
    handler: async ({ app, auth, body, req, reply }) => {
      const { settings } = await gamificationSettingsOf(app.db, auth.tenantId);
      if (!settings?.certificates) throw unprocessable('A regra aprovada da gamificação ainda não dá pontos por certificado.');
      const areas = await areasOf(app.db, auth.tenantId, auth.userId);
      if (!areas.includes(body.area)) throw unprocessable('Escolha uma das suas áreas (setor do cadastro ou time).', [{ path: 'area', message: 'Área fora das suas' }]);
      if (body.completedOn > todayIn(auth.timezone)) throw unprocessable('A data de conclusão não pode ser no futuro.');
      const buf = Buffer.from(body.data, 'base64');
      if (buf.length > 3 * 1024 * 1024) throw unprocessable('Certificado acima de 3 MB.');
      const mime = detectAttachment(body.fileName, buf);
      if (!mime || !['application/pdf', 'image/png', 'image/jpeg'].includes(mime)) throw unprocessable('Envie o certificado em PDF, PNG ou JPG.');
      const [r] = await app.db.insert(s.gamificationCertificates).values({ tenantId: auth.tenantId, userId: auth.userId, title: body.title, institution: body.institution, area: body.area, hours: body.hours, completedOn: body.completedOn, fileName: body.fileName.replace(/[\\/:*?"<>|\r\n]+/g, '_'), mime, data: buf }).returning({ id: s.gamificationCertificates.id });
      await audit(app.db, req, { action: 'certificate.submit', entityType: 'certificate', entityId: r!.id, metadata: { title: body.title, hours: body.hours } });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/times/certificados/:id/decisao', summary: 'Valida ou recusa o certificado (liderança do time ou administração da gamificação; nunca o próprio)', tag: 'Gestão de Times', anyAuthenticated: true, params: IdParams,
    body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const [r] = await app.db.select().from(s.gamificationCertificates).where(and(eq(s.gamificationCertificates.id, params.id), eq(s.gamificationCertificates.tenantId, auth.tenantId)));
      if (!r) throw notFound('Certificado não encontrado.');
      if (!(await canValidate(app.db, auth, r.userId))) throw forbidden(r.userId === auth.userId ? 'Ninguém valida o próprio certificado.' : 'Quem valida é a liderança do time da pessoa.');
      if (r.status !== 'pendente') throw unprocessable('Este certificado já foi decidido.');
      if (!body.approve && !body.note?.trim()) throw unprocessable('Diga o motivo da recusa.', [{ path: 'note', message: 'Obrigatório' }]);
      await app.db.update(s.gamificationCertificates).set({ status: body.approve ? 'aprovado' : 'recusado', decidedBy: auth.userId, decidedAt: new Date(), approvedOn: body.approve ? todayIn(auth.timezone) : null, decisionNote: body.note?.trim() || null }).where(eq(s.gamificationCertificates.id, r.id));
      await audit(app.db, req, { action: body.approve ? 'certificate.approve' : 'certificate.refuse', entityType: 'certificate', entityId: r.id, metadata: { owner: r.userId } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/times/certificados/:id/arquivo', summary: 'Abre o certificado (a própria pessoa, quem valida ou a administração)', tag: 'Gestão de Times', anyAuthenticated: true, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [r] = await app.db.select().from(s.gamificationCertificates).where(and(eq(s.gamificationCertificates.id, params.id), eq(s.gamificationCertificates.tenantId, auth.tenantId)));
      if (!r || (r.userId !== auth.userId && !(await canValidate(app.db, auth, r.userId)))) throw notFound('Certificado não encontrado.');
      return reply.header('content-type', r.mime).header('content-disposition', `inline; filename="${encodeURIComponent(r.fileName)}"`).header('cache-control', 'private, no-store').send(r.data);
    },
  }),
];
