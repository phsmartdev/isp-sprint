/** Sprint: roteiro (respostas), anexos de proposta e e-mail ao cliente a partir da oportunidade. */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AnswersPut, AttachmentUpload, OpportunityEmail } from '@isp/shared';
import { decryptSecret } from '../services/email';
import { integrationRow, logEvent } from '../services/integrations';
import { publicLink } from '../services/alerts';
import { signFileToken, verifyFileToken, waPhone, sendWhatsAppDocument } from '../services/whatsapp';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { loadOpportunity } from '../services/opportunities';
import { getActiveInstruction } from '../services/instructions';
import { brl, renderEmail, sendEmail, tenantName } from '../services/email';
import { atLeast } from '@isp/domain';
import { level } from '../services/scope';
import { audit } from '../services/audit';

export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const AttachParams = z.object({ id: z.string().uuid(), aid: z.string().uuid() });

const OFFICE: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Tipo pelo conteúdo (bytes), nunca só pela extensão. Aceita PDF, Word/Excel/PowerPoint, PNG e JPG. */
export function detectAttachment(filename: string, data: Buffer) {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04 && OFFICE[ext]) return OFFICE[ext]!;
  return null;
}

const safeName = (n: string) => n.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 160);

async function canEditAttachments(auth: Parameters<typeof level>[0], uploadedBy: string | null) {
  return uploadedBy === auth.userId || atLeast(level(auth, 'oportunidades'), 'equipe');
}

export const sprintRoutes = [
  // ------------------------------------------------------------------ roteiro
  defineRoute({
    method: 'GET',
    url: '/meta/playbook',
    summary: 'Roteiro ativo: jornadas, etapas, perguntas, dicas e objeções do modelo de instrução',
    tag: 'Sprint',
    anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      const { version, content } = await getActiveInstruction(app.db, auth.tenantId);
      return { version, jornadas: content.jornadas, objecoes: content.objecoes };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/answers',
    summary: 'Respostas do roteiro desta oportunidade',
    tag: 'Sprint',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await loadOpportunity(app.db, auth, params.id);
      const items = await app.db
        .select({ questionId: s.opportunityAnswers.questionId, answer: s.opportunityAnswers.answer, answeredAt: s.opportunityAnswers.answeredAt, answeredByName: s.users.name })
        .from(s.opportunityAnswers)
        .leftJoin(s.users, eq(s.users.id, s.opportunityAnswers.answeredBy))
        .where(and(eq(s.opportunityAnswers.opportunityId, params.id), eq(s.opportunityAnswers.tenantId, auth.tenantId)));
      return { items };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/opportunities/:id/answers',
    summary: 'Salva respostas do roteiro (resposta vazia apaga)',
    tag: 'Sprint',
    module: 'oportunidades',
    params: IdParams,
    body: AnswersPut,
    handler: async ({ app, auth, params, body }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const { version, content } = await getActiveInstruction(app.db, auth.tenantId);
      const [pipe] = await app.db.select({ key: s.pipelines.key }).from(s.pipelines).where(eq(s.pipelines.id, opp.pipelineId)).limit(1);
      const journey = content.jornadas.find((j) => j.chave === pipe?.key);
      const valid = new Map((journey?.etapas ?? []).flatMap((e) => e.perguntas.map((q) => [q.id, q] as const)));
      for (const a of body.answers) {
        const q = valid.get(a.questionId);
        if (!q) throw unprocessable('Pergunta não existe no roteiro desta jornada.', [{ path: a.questionId, message: 'Pergunta desconhecida' }]);
        if (a.answer && q.tipo === 'sim_nao' && !['sim', 'nao'].includes(a.answer)) throw unprocessable('Resposta inválida.', [{ path: a.questionId, message: 'Use sim ou nao' }]);
        if (a.answer && q.tipo === 'opcoes' && !q.opcoes?.includes(a.answer)) throw unprocessable('Resposta inválida.', [{ path: a.questionId, message: 'Escolha uma das opções' }]);
      }
      await app.db.transaction(async (tx) => {
        for (const a of body.answers) {
          if (!a.answer) {
            await tx.delete(s.opportunityAnswers).where(and(eq(s.opportunityAnswers.opportunityId, params.id), eq(s.opportunityAnswers.questionId, a.questionId)));
          } else {
            await tx
              .insert(s.opportunityAnswers)
              .values({ tenantId: auth.tenantId, opportunityId: params.id, questionId: a.questionId, answer: a.answer, instructionVersion: version, answeredBy: auth.userId })
              .onConflictDoUpdate({ target: [s.opportunityAnswers.opportunityId, s.opportunityAnswers.questionId], set: { answer: a.answer, instructionVersion: version, answeredBy: auth.userId, answeredAt: new Date() } });
          }
        }
      });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ anexos
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/attachments',
    summary: 'Anexos da oportunidade (sem o conteúdo)',
    tag: 'Sprint',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await loadOpportunity(app.db, auth, params.id);
      const items = await app.db
        .select({ id: s.opportunityAttachments.id, kind: s.opportunityAttachments.kind, filename: s.opportunityAttachments.filename, mime: s.opportunityAttachments.mime, sizeBytes: s.opportunityAttachments.sizeBytes, createdAt: s.opportunityAttachments.createdAt, uploadedBy: s.opportunityAttachments.uploadedBy, uploadedByName: s.users.name })
        .from(s.opportunityAttachments)
        .leftJoin(s.users, eq(s.users.id, s.opportunityAttachments.uploadedBy))
        .where(and(eq(s.opportunityAttachments.opportunityId, params.id), eq(s.opportunityAttachments.tenantId, auth.tenantId), isNull(s.opportunityAttachments.deletedAt)))
        .orderBy(desc(s.opportunityAttachments.createdAt));
      return { items };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/attachments',
    summary: 'Anexa proposta ou outro arquivo (PDF, Word, Excel, PowerPoint, PNG, JPG; até 3 MB)',
    tag: 'Sprint',
    module: 'oportunidades',
    params: IdParams,
    body: AttachmentUpload,
    bodyLimit: 4_600_000,
    handler: async ({ app, auth, params, body, req, reply }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const clean = body.data.replace(/^data:[^;]+;base64,/, '');
      if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw unprocessable('Arquivo inválido.', [{ path: 'data', message: 'Conteúdo não está em base64' }]);
      const data = Buffer.from(clean, 'base64');
      if (!data.length) throw unprocessable('Arquivo vazio.');
      if (data.length > MAX_ATTACHMENT_BYTES) throw unprocessable('Arquivo maior que 3 MB.', [{ path: 'data', message: 'Limite de 3 MB por arquivo' }]);
      const mime = detectAttachment(body.filename, data);
      if (!mime) throw unprocessable('Formato não aceito. Envie PDF, Word, Excel, PowerPoint, PNG ou JPG.', [{ path: 'data', message: 'Formato não reconhecido' }]);
      const [row] = await app.db.transaction(async (tx) => {
        const r = await tx
          .insert(s.opportunityAttachments)
          .values({ tenantId: auth.tenantId, opportunityId: params.id, kind: body.kind, filename: safeName(body.filename), mime, sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), data, uploadedBy: auth.userId })
          .returning({ id: s.opportunityAttachments.id, kind: s.opportunityAttachments.kind, filename: s.opportunityAttachments.filename, mime: s.opportunityAttachments.mime, sizeBytes: s.opportunityAttachments.sizeBytes, createdAt: s.opportunityAttachments.createdAt });
        if (body.kind === 'proposta' && opp.proposalStatus === 'nao_criada') {
          await tx.update(s.opportunities).set({ proposalStatus: 'rascunho', updatedAt: new Date(), rowVersion: sql`${s.opportunities.rowVersion} + 1` }).where(eq(s.opportunities.id, params.id));
        }
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: params.id, type: 'attachment_added', actorId: auth.userId, payload: { filename: r[0]!.filename, kind: body.kind, sizeBytes: data.length }, rowVersion: opp.rowVersion });
        return r;
      });
      await audit(app.db, req, { action: 'attachment.upload', entityType: 'opportunity', entityId: params.id, metadata: { filename: row!.filename, kind: body.kind } });
      reply.code(201);
      return row;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/attachments/:aid/download',
    summary: 'Baixa um anexo',
    tag: 'Sprint',
    module: 'oportunidades',
    params: AttachParams,
    handler: async ({ app, auth, params, reply }) => {
      await loadOpportunity(app.db, auth, params.id);
      const [a] = await app.db
        .select()
        .from(s.opportunityAttachments)
        .where(and(eq(s.opportunityAttachments.id, params.aid), eq(s.opportunityAttachments.opportunityId, params.id), eq(s.opportunityAttachments.tenantId, auth.tenantId), isNull(s.opportunityAttachments.deletedAt)))
        .limit(1);
      if (!a) throw notFound('Anexo não encontrado.');
      reply
        .header('content-type', a.mime)
        .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store');
      return reply.send(a.data);
    },
  }),

  defineRoute({
    method: 'DELETE',
    url: '/opportunities/:id/attachments/:aid',
    summary: 'Remove um anexo (quem enviou, ou supervisão/gerência)',
    tag: 'Sprint',
    module: 'oportunidades',
    params: AttachParams,
    handler: async ({ app, auth, params, reply, req }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const [a] = await app.db
        .select({ id: s.opportunityAttachments.id, uploadedBy: s.opportunityAttachments.uploadedBy, filename: s.opportunityAttachments.filename })
        .from(s.opportunityAttachments)
        .where(and(eq(s.opportunityAttachments.id, params.aid), eq(s.opportunityAttachments.opportunityId, params.id), eq(s.opportunityAttachments.tenantId, auth.tenantId), isNull(s.opportunityAttachments.deletedAt)))
        .limit(1);
      if (!a) throw notFound('Anexo não encontrado.');
      if (!(await canEditAttachments(auth, a.uploadedBy))) throw forbidden('Só quem enviou o anexo ou a supervisão pode removê-lo.');
      await app.db.update(s.opportunityAttachments).set({ deletedAt: new Date(), deletedBy: auth.userId }).where(eq(s.opportunityAttachments.id, a.id));
      await app.db.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: params.id, type: 'attachment_removed', actorId: auth.userId, payload: { filename: a.filename }, rowVersion: opp.rowVersion });
      await audit(app.db, req, { action: 'attachment.delete', entityType: 'opportunity', entityId: params.id, metadata: { filename: a.filename } });
      return reply.code(204).send();
    },
  }),

  // ------------------------------------------------------------------ e-mail ao cliente
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/email/preview',
    summary: 'Assunto e texto sugeridos (modelo da instrução ativa) para proposta ou follow-up',
    tag: 'Sprint',
    module: 'oportunidades',
    params: IdParams,
    query: z.object({ kind: z.enum(['proposta', 'followup']) }),
    handler: async ({ app, auth, params, query }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const mail = await renderEmail(app.db, auth.tenantId, query.kind, {
        'cliente.nome': opp.contactName.split(' ')[0], 'vendedor.nome': auth.name, 'vendedor.email': auth.email, 'plano.nome': opp.planName ?? '', 'plano.valor': brl(opp.valueCents), 'empresa.nome': await tenantName(app.db, auth.tenantId),
      });
      return { to: opp.contactEmail ?? '', subject: mail.subject, body: mail.text };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/email',
    summary: 'Envia proposta (com anexo) ou follow-up ao cliente pelo SMTP da empresa',
    tag: 'Sprint',
    module: 'oportunidades',
    params: IdParams,
    body: OpportunityEmail,
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body, req }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      let attachment: { id: string; filename: string; mime: string; data: Buffer } | undefined;
      if (body.kind === 'proposta' && !body.attachmentId) throw unprocessable('Escolha o arquivo da proposta.', [{ path: 'attachmentId', message: 'Anexe ou escolha a proposta' }]);
      if (body.attachmentId) {
        const [a] = await app.db
          .select({ id: s.opportunityAttachments.id, filename: s.opportunityAttachments.filename, mime: s.opportunityAttachments.mime, data: s.opportunityAttachments.data })
          .from(s.opportunityAttachments)
          .where(and(eq(s.opportunityAttachments.id, body.attachmentId), eq(s.opportunityAttachments.opportunityId, params.id), eq(s.opportunityAttachments.tenantId, auth.tenantId), isNull(s.opportunityAttachments.deletedAt)))
          .limit(1);
        if (!a) throw unprocessable('Anexo não encontrado nesta oportunidade.', [{ path: 'attachmentId', message: 'Anexo inválido' }]);
        attachment = a;
      }
      const result = await sendEmail(app.db, {
        tenantId: auth.tenantId,
        kind: body.kind,
        to: body.to,
        subject: body.subject,
        text: body.body,
        attachments: attachment ? [{ filename: attachment.filename, content: attachment.data, contentType: attachment.mime }] : undefined,
        opportunityId: params.id,
        attachmentId: attachment?.id ?? null,
        createdBy: auth.userId,
        replyTo: auth.email,
      });
      if (!result.ok) throw unprocessable(`O e-mail não foi enviado: ${result.error}`, [{ path: 'smtp', message: result.error }]);
      await app.db.transaction(async (tx) => {
        if (body.kind === 'proposta' && ['nao_criada', 'rascunho'].includes(opp.proposalStatus)) {
          await tx.update(s.opportunities).set({ proposalStatus: 'enviada', updatedAt: new Date(), rowVersion: sql`${s.opportunities.rowVersion} + 1` }).where(eq(s.opportunities.id, params.id));
        }
        // registra como atividade concluída (aparece em Atividades e na linha do tempo)
        await tx.insert(s.activities).values({ tenantId: auth.tenantId, type: 'email', title: `E-mail: ${body.subject}`.slice(0, 200), notes: `Para ${body.to}${attachment ? ` · anexo ${attachment.filename}` : ''}`, dueAt: new Date(), completedAt: new Date(), completedBy: auth.userId, ownerId: auth.userId, opportunityId: params.id, contactId: opp.contactId, createdBy: auth.userId });
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: params.id, type: 'email_sent', actorId: auth.userId, payload: { kind: body.kind, to: body.to, subject: body.subject, attachment: attachment?.filename ?? null }, rowVersion: opp.rowVersion });
      });
      await audit(app.db, req, { action: 'email.send', entityType: 'opportunity', entityId: params.id, metadata: { kind: body.kind } });
      return { ok: true, messageId: result.messageId };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/emails',
    summary: 'E-mails enviados a partir desta oportunidade',
    tag: 'Sprint',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await loadOpportunity(app.db, auth, params.id);
      const items = await app.db
        .select({ id: s.emailMessages.id, kind: s.emailMessages.kind, to: s.emailMessages.toAddress, subject: s.emailMessages.subject, status: s.emailMessages.status, error: s.emailMessages.error, createdAt: s.emailMessages.createdAt })
        .from(s.emailMessages)
        .where(and(eq(s.emailMessages.opportunityId, params.id), eq(s.emailMessages.tenantId, auth.tenantId)))
        .orderBy(asc(s.emailMessages.createdAt));
      return { items };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/attachments/:aid/whatsapp',
    summary: 'Envia um anexo (ex.: proposta) pelo WhatsApp: pela API da empresa ou por link no WhatsApp do vendedor',
    tag: 'Sprint',
    module: 'oportunidades',
    params: AttachParams,
    body: z.object({ phone: z.string().trim().min(8).max(30), message: z.string().trim().max(1000).default(''), mode: z.enum(['api', 'link']) }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, auth, params, body, req }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const [a] = await app.db.select().from(s.opportunityAttachments).where(and(eq(s.opportunityAttachments.id, params.aid), eq(s.opportunityAttachments.opportunityId, o.id), eq(s.opportunityAttachments.tenantId, auth.tenantId), isNull(s.opportunityAttachments.deletedAt))).limit(1);
      if (!a) throw notFound('Anexo não encontrado.');
      const to = waPhone(body.phone);
      if (!to) throw unprocessable('Telefone inválido para WhatsApp. Use DDD + número.', [{ path: 'phone', message: 'Telefone inválido' }]);
      const link = publicLink(app.config, `/api/v1/public/files/${signFileToken(app.config.cookieSecret, a.id)}`);
      let result: { mode: 'api' | 'link'; waUrl?: string; link: string };
      if (body.mode === 'api') {
        const integ = await integrationRow(app.db, auth.tenantId, 'whatsapp');
        const token = integ.secrets.accessToken ? decryptSecret(integ.secrets.accessToken) : null;
        if (!integ.enabled || !integ.config.phoneNumberId || !token) throw unprocessable('O WhatsApp Business não está configurado. Use “Abrir no meu WhatsApp” ou configure em Configurações → Integrações.');
        try {
          await sendWhatsAppDocument({ phoneNumberId: integ.config.phoneNumberId, accessToken: token }, to, { data: a.data, filename: a.filename, mime: a.mime }, body.message);
        } catch (e) {
          await logEvent(app.db, auth.tenantId, 'whatsapp', 'erro', `Envio de ${a.filename} para ${to}: ${(e as Error).message}`);
          throw unprocessable(`O WhatsApp não aceitou o envio: ${(e as Error).message}`);
        }
        result = { mode: 'api', link };
      } else {
        const text = `${body.message ? `${body.message}\n\n` : ''}${a.filename}: ${link}`;
        result = { mode: 'link', link, waUrl: `https://wa.me/${to}?text=${encodeURIComponent(text)}` };
      }
      await app.db.transaction(async (tx) => {
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'whatsapp_sent', actorId: auth.userId, payload: { filename: a.filename, to, mode: body.mode }, rowVersion: o.rowVersion });
        if (a.kind === 'proposta' && ['nao_criada', 'rascunho'].includes(o.proposalStatus)) await tx.update(s.opportunities).set({ proposalStatus: 'enviada', updatedAt: new Date(), rowVersion: sql`${s.opportunities.rowVersion} + 1` }).where(eq(s.opportunities.id, o.id));
      });
      await audit(app.db, req, { action: 'attachment.whatsapp', entityType: 'opportunity', entityId: o.id, metadata: { filename: a.filename, mode: body.mode } });
      return result;
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/public/files/:token',
    summary: 'Arquivo compartilhado por link seguro (expira); usado no envio pelo WhatsApp',
    tag: 'Sprint',
    public: true,
    params: z.object({ token: z.string().min(20).max(300) }),
    rateLimit: () => ({ max: 60, timeWindow: '1 minute' }),
    handler: async ({ app, params, reply }) => {
      const id = verifyFileToken(app.config.cookieSecret, params.token);
      if (!id) throw notFound('Link expirado ou inválido. Peça um novo ao seu consultor.');
      const [a] = await app.db.select({ data: s.opportunityAttachments.data, mime: s.opportunityAttachments.mime, filename: s.opportunityAttachments.filename }).from(s.opportunityAttachments).where(and(eq(s.opportunityAttachments.id, id), isNull(s.opportunityAttachments.deletedAt))).limit(1);
      if (!a) throw notFound('Arquivo não encontrado.');
      return reply
        .header('content-type', a.mime)
        .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=300')
        .send(a.data);
    },
  }),
];
