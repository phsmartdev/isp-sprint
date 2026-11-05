/**
 * Botão "Confirmar recebimento" dos avisos de atividades de contrato (e-mail e WhatsApp).
 * Público pelo token do aviso (aleatório, um por pessoa e canal): mostra o essencial e registra a confirmação,
 * a data, o IP e, para o ator externo, a resposta. Nada além do aviso é exposto.
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { RACI_LETTER_LABELS, type RaciLetter } from '@isp/domain';
import { defineRoute } from '../http/route';
import { notFound } from '../http/errors';
import * as s from '../db/schema';
import { addEvent } from '../services/contracts';

const Token = z.object({ token: z.string().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/) });

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Registra uma abertura (pixel do e-mail ou visita ao link): primeira, última e contagem. */
async function markOpen(db: Parameters<typeof addEvent>[0], token: string, ua: string | undefined) {
  const [n] = await db.update(s.contractNotifications).set({
    openedAt: sql`coalesce(${s.contractNotifications.openedAt}, now())`, lastOpenedAt: new Date(), openCount: sql`${s.contractNotifications.openCount} + 1`, openUa: (ua ?? '').slice(0, 300) || null,
  }).where(eq(s.contractNotifications.token, token)).returning({ id: s.contractNotifications.id, openCount: s.contractNotifications.openCount, tenantId: s.contractNotifications.tenantId, contractId: s.contractNotifications.contractId, activityId: s.contractNotifications.activityId, recipientName: s.contractNotifications.recipientName, title: s.contractNotifications.title, userId: s.contractNotifications.userId, channel: s.contractNotifications.channel });
  // só a primeira abertura vai para o histórico (as demais ficam na contagem)
  if (n && n.openCount === 1) {
    if (n.activityId) await db.insert(s.activityEvents).values({ tenantId: n.tenantId, activityId: n.activityId, type: 'aviso_aberto', actorId: n.userId, payload: { recipient: n.recipientName, channel: n.channel } });
    if (n.contractId) await addEvent(db, n.tenantId, n.contractId, n.userId, 'aviso_aberto', `${n.recipientName} abriu "${n.title}"`, { notificationId: n.id });
  }
}

export const publicNoticeRoutes = [
  defineRoute({
    method: 'GET',
    url: '/public/open/:token',
    summary: 'Pixel de abertura do e-mail (imagem 1×1): registra que o e-mail foi aberto',
    tag: 'Público',
    public: true,
    params: Token,
    rateLimit: () => ({ max: 120, timeWindow: '1 minute' }),
    handler: async ({ app, params, req, reply }) => {
      await markOpen(app.db, params.token, req.headers['user-agent']).catch(() => undefined);
      reply.header('content-type', 'image/gif').header('cache-control', 'no-store, no-cache, must-revalidate, max-age=0').header('pragma', 'no-cache');
      return reply.send(GIF);
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/public/notices/:token',
    summary: 'Aviso de atividade de contrato pelo link de confirmação',
    tag: 'Público',
    public: true,
    params: Token,
    rateLimit: () => ({ max: 60, timeWindow: '1 minute' }),
    handler: async ({ app, params, req }) => {
      await markOpen(app.db, params.token, req.headers['user-agent']).catch(() => undefined);
      const [n] = await app.db.select({ title: s.contractNotifications.title, recipientName: s.contractNotifications.recipientName, raciLetter: s.contractNotifications.raciLetter, actorId: s.contractNotifications.actorId, userId: s.contractNotifications.userId, sentAt: s.contractNotifications.sentAt, confirmedAt: s.contractNotifications.confirmedAt, responseText: s.contractNotifications.responseText, activityId: s.contractNotifications.activityId })
        .from(s.contractNotifications).where(eq(s.contractNotifications.token, params.token)).limit(1);
      if (!n) throw notFound('Link inválido ou expirado.');
      const [a] = n.activityId ? await app.db.select({ title: s.activities.title, dueAt: s.activities.dueAt, completedAt: s.activities.completedAt }).from(s.activities).where(eq(s.activities.id, n.activityId)).limit(1) : [];
      return {
        title: n.title, recipientName: n.recipientName, role: n.raciLetter ? RACI_LETTER_LABELS[n.raciLetter as RaciLetter] : null,
        activity: a ? { title: a.title, dueAt: a.dueAt, done: !!a.completedAt } : null,
        sentAt: n.sentAt, confirmedAt: n.confirmedAt, responseText: n.responseText, canRespond: !n.userId,
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/public/notices/:token/confirm',
    summary: 'Confirma o recebimento do aviso (e registra a resposta do ator externo)',
    tag: 'Público',
    public: true,
    params: Token,
    body: z.object({ response: z.string().trim().max(2000).optional() }),
    rateLimit: () => ({ max: 20, timeWindow: '1 minute' }),
    handler: async ({ app, params, body, req }) => {
      const [n] = await app.db.select().from(s.contractNotifications).where(eq(s.contractNotifications.token, params.token)).limit(1);
      if (!n) throw notFound('Link inválido ou expirado.');
      const now = new Date();
      // quem está fora do sistema (ator externo, cliente, e-mail avulso) pode responder pelo link
      const response = !n.userId && body.response ? body.response : null;
      await app.db.update(s.contractNotifications).set({
        confirmedAt: n.confirmedAt ?? now, confirmIp: n.confirmIp ?? req.ip,
        ...(response ? { responseText: response, respondedAt: now } : {}),
      }).where(eq(s.contractNotifications.id, n.id));
      if (n.activityId) await app.db.insert(s.activityEvents).values({ tenantId: n.tenantId, activityId: n.activityId, type: response ? 'aviso_respondido' : 'aviso_confirmado', actorId: n.userId, payload: { recipient: n.recipientName, channel: n.channel, event: n.event, response } });
      if (n.contractId && (response || !n.confirmedAt)) await addEvent(app.db, n.tenantId, n.contractId, n.userId, response ? 'aviso_respondido' : 'aviso_confirmado', `${n.recipientName} ${response ? `respondeu ao aviso "${n.title}": ${response}` : `confirmou o recebimento de "${n.title}"`}`, { notificationId: n.id });
      return { confirmedAt: n.confirmedAt ?? now, responseText: response ?? n.responseText };
    },
  }),
];
