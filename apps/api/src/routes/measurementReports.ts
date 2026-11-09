/** Relatório de Medição da conta: configuração, prévia ao vivo (qualquer mês), rascunho do mês fechado e envio por e-mail. */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { emailListOk, officialPeriod } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { ownerScope } from '../services/scope';
import { todayIn } from '../services/vacations';
import { buildReport, renderReport, sendReport, settingsOf, subjectOf, upsertDraft, type ReportData } from '../services/measurementReports';

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Emails = z.string().max(1000).refine((v) => !v.trim() || emailListOk(v), 'E-mail inválido (separe vários por vírgula ou ponto e vírgula)');
const Texts = z.object({ greeting: z.string().max(500), intro: z.string().max(2000), closing: z.string().max(3000) });

async function contactOr404(db: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await db.select({ id: s.contacts.id, name: s.contacts.name, email: s.contacts.email }).from(s.contacts)
    .where(and(eq(s.contacts.id, id), ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt })));
  if (!c) throw notFound('Conta não encontrada.');
  return c;
}
async function reportOr404(db: DbOrTx, auth: AuthContext, id: string) {
  const [r] = await db.select().from(s.measurementReports).where(and(eq(s.measurementReports.id, id), eq(s.measurementReports.tenantId, auth.tenantId)));
  if (!r) throw notFound('Relatório não encontrado.');
  await contactOr404(db, auth, r.contactId);
  return r;
}
const attachBytes = (d: ReportData) => d.proposals.filter((p) => p.included && p.attachment).reduce((t, p) => t + p.attachment!.sizeBytes, 0);
const totals = (d: ReportData) => ({ proposals: d.proposals.filter((p) => p.included).length, proposalsCents: d.proposals.filter((p) => p.included).reduce((t, p) => t + p.valueCents, 0), itemsCents: d.items.reduce((t, i) => t + i.totalCents, 0), attachmentsBytes: attachBytes(d), withoutAttachment: d.proposals.filter((p) => p.included && !p.attachment).length });
const view = (r: typeof s.measurementReports.$inferSelect) => { const d = r.data as unknown as ReportData; return { id: r.id, referenceMonth: r.referenceMonth, dueOn: r.dueOn, status: r.status, subject: r.subject, generatedAt: r.generatedAt, automatic: !r.generatedBy, sentAt: r.sentAt, sentTo: r.sentTo, sentCc: r.sentCc, error: r.error, totals: totals(d) }; };

export const measurementReportRoutes = [
  defineRoute({
    method: 'GET', url: '/contacts/:id/measurement', summary: 'Relatório de Medição da conta: configuração, período oficial e relatórios (gera o rascunho do mês fechado se faltar)', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await contactOr404(app.db, auth, params.id);
      const settings = await settingsOf(app.db, auth.tenantId, c.id);
      const today = todayIn(auth.timezone);
      const official = officialPeriod(today, settings.dueDay);
      if (settings.enabled) await upsertDraft(app.db, auth.tenantId, c.id, official.referenceMonth, official.dueOn, today, null);
      const reports = await app.db.select().from(s.measurementReports).where(and(eq(s.measurementReports.tenantId, auth.tenantId), eq(s.measurementReports.contactId, c.id))).orderBy(desc(s.measurementReports.referenceMonth)).limit(36);
      return { settings, official: settings.enabled ? { ...official, today } : null, defaultTo: c.email ?? '', reports: reports.map(view) };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/contacts/:id/measurement/settings', summary: 'Marca a conta com envio de Relatório de Medição: dia previsto, destinatários e textos do e-mail', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ enabled: z.boolean(), dueDay: z.number().int().min(1).max(31), toAddress: Emails, ccAddress: Emails, texts: Texts }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await contactOr404(app.db, auth, params.id);
      if (body.enabled && !body.toAddress.trim()) throw unprocessable('Informe quem recebe o relatório.', [{ path: 'toAddress', message: 'Obrigatório' }]);
      const v = { enabled: body.enabled, dueDay: body.dueDay, toAddress: body.toAddress.trim() || null, ccAddress: body.ccAddress.trim() || null, texts: body.texts, updatedBy: auth.userId, updatedAt: new Date() };
      await app.db.insert(s.measurementReportSettings).values({ tenantId: auth.tenantId, contactId: c.id, ...v }).onConflictDoUpdate({ target: [s.measurementReportSettings.tenantId, s.measurementReportSettings.contactId], set: v });
      await audit(app.db, req, { action: 'measurement_report.settings', entityType: 'contact', entityId: c.id, metadata: { enabled: body.enabled, dueDay: body.dueDay } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contacts/:id/measurement/preview', summary: 'Prévia ao vivo do relatório de qualquer mês (o mesmo HTML do e-mail), sem gravar nada', tag: 'Contratos', module: 'contratos', params: IdParams,
    query: z.object({ month: Month }),
    handler: async ({ app, auth, params, query }) => {
      const c = await contactOr404(app.db, auth, params.id);
      const st = await settingsOf(app.db, auth.tenantId, c.id);
      const d = await buildReport(app.db, auth.tenantId, c.id, query.month, st.texts, todayIn(auth.timezone));
      return { subject: subjectOf(c.name, query.month), data: d, html: renderReport(d).html, totals: totals(d) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contacts/:id/measurement/reports', summary: 'Gera (ou atualiza, se rascunho) o relatório de um mês para revisar e enviar', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ month: Month }),
    handler: async ({ app, auth, params, body, reply }) => {
      const c = await contactOr404(app.db, auth, params.id);
      const st = await settingsOf(app.db, auth.tenantId, c.id);
      const today = todayIn(auth.timezone);
      const off = officialPeriod(today, st.dueDay);
      const r = await upsertDraft(app.db, auth.tenantId, c.id, body.month, off.referenceMonth === body.month ? off.dueOn : today, today, auth.userId);
      reply.code(201);
      return view(r);
    },
  }),
  defineRoute({
    method: 'GET', url: '/measurement-reports/:id', summary: 'Relatório (rascunho ou enviado) com o HTML exatamente como sai no e-mail', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const r = await reportOr404(app.db, auth, params.id);
      const d = r.data as unknown as ReportData;
      const st = await settingsOf(app.db, auth.tenantId, r.contactId);
      return { ...view(r), data: d, html: renderReport(d).html, to: r.sentTo ?? st.toAddress, cc: r.sentCc ?? st.ccAddress };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/measurement-reports/:id', summary: 'Ajusta o rascunho: assunto, textos e propostas incluídas (refaz o consolidado)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ subject: z.string().min(3).max(250), texts: Texts, excluded: z.array(z.string().uuid()).max(500), refresh: z.boolean().default(false) }),
    handler: async ({ app, auth, params, body }) => {
      const r = await reportOr404(app.db, auth, params.id);
      if (r.status !== 'rascunho') throw unprocessable('Relatório já enviado: o conteúdo fica congelado.');
      const d = await buildReport(app.db, auth.tenantId, r.contactId, r.referenceMonth, body.texts, todayIn(auth.timezone), body.excluded);
      const [u] = await app.db.update(s.measurementReports).set({ subject: body.subject, data: d as unknown as Record<string, unknown>, generatedAt: new Date(), generatedBy: auth.userId }).where(eq(s.measurementReports.id, r.id)).returning();
      return view(u!);
    },
  }),
  defineRoute({
    method: 'POST', url: '/measurement-reports/:id/send', summary: 'Envia o relatório por e-mail com as propostas anexadas e congela o conteúdo', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ to: Emails.refine((v) => !!v.trim(), 'Informe o destinatário'), cc: Emails.default('') }),
    handler: async ({ app, auth, params, body, req }) => {
      const r = await reportOr404(app.db, auth, params.id);
      const d = r.data as unknown as ReportData;
      if (!d.proposals.some((p) => p.included)) throw unprocessable('Nenhuma proposta incluída no relatório.');
      if (attachBytes(d) > 20 * 1024 * 1024) throw unprocessable('Os anexos passam de 20 MB: desmarque propostas ou envie em mais de um e-mail.');
      const res = await sendReport(app.db, auth.tenantId, r.id, auth.userId, auth.email, body.to.trim(), body.cc.trim() || null);
      if (!res.ok) throw unprocessable(`O e-mail não foi enviado: ${res.error}`);
      await audit(app.db, req, { action: 'measurement_report.send', entityType: 'contact', entityId: r.contactId, metadata: { month: r.referenceMonth, to: body.to } });
      return { ok: true };
    },
  }),
];
