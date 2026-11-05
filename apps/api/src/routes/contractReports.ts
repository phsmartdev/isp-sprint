/** Relatório mensal do contrato: modelos de mensagem (inclusão na rotina e lembrete) e o que foi enviado em cada contrato. */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { REPORT_CHANNELS, REPORT_MESSAGE_KINDS } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import * as s from '../db/schema';
import { normalizeReportMessages, reportMessagesOf, reportNotices } from '../services/contractReports';
import { loadContract } from '../services/contracts';
import { canManagePlaybook } from './playbook';
import { forbidden } from '../http/errors';

const Message = z.object({
  channels: z.array(z.enum(REPORT_CHANNELS)).max(3),
  subject: z.string().max(300), body: z.string().max(10_000), whatsapp: z.string().max(4000),
  glpi: z.object({ entityId: z.number().int().min(0).nullable(), groupId: z.number().int().positive().nullable(), categoryId: z.number().int().positive().nullable() }),
});

export const contractReportRoutes = [
  defineRoute({
    method: 'GET', url: '/contract-report-messages', summary: 'Modelos das mensagens do relatório mensal (inclusão na rotina e lembrete)', tag: 'Contratos', module: 'contratos',
    handler: async ({ app, auth }) => ({ messages: await reportMessagesOf(app.db, auth.tenantId), canManage: canManagePlaybook(auth) }),
  }),
  defineRoute({
    method: 'PUT', url: '/contract-report-messages', summary: 'Salva os modelos das mensagens do relatório mensal', tag: 'Contratos', module: 'contratos',
    body: z.object({ messages: z.object(Object.fromEntries(REPORT_MESSAGE_KINDS.map((k) => [k, Message.optional()])) as Record<(typeof REPORT_MESSAGE_KINDS)[number], z.ZodOptional<typeof Message>>) }),
    handler: async ({ app, auth, body }) => {
      if (!canManagePlaybook(auth)) throw forbidden('Só a administração ou quem tem nível Total em Contratos altera os modelos.');
      const messages = normalizeReportMessages(body.messages);
      const [r] = await app.db.select({ settings: s.contractSettings.settings }).from(s.contractSettings).where(eq(s.contractSettings.tenantId, auth.tenantId)).limit(1);
      const settings = { ...((r?.settings ?? {}) as Record<string, unknown>), reportMessages: messages };
      await app.db.insert(s.contractSettings).values({ tenantId: auth.tenantId, settings, updatedBy: auth.userId }).onConflictDoUpdate({ target: s.contractSettings.tenantId, set: { settings, updatedBy: auth.userId, updatedAt: new Date() } });
      return { messages };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/:id/report-notices', summary: 'Envios do relatório mensal deste contrato (inclusão na rotina e lembretes)', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      return { items: await reportNotices(app.db, auth.tenantId, c.id) };
    },
  }),
];
