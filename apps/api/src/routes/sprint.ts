/** Sprint: roteiro (respostas), anexos de proposta e e-mail ao cliente a partir da oportunidade. */
import { randomBytes } from 'node:crypto';
import { textToHtml } from '../services/email';
import { ensureProposalNumber } from '../services/proposalNumber';
import { todayIn } from '../services/vacations';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AnswersPut, AttachmentChunk, AttachmentComplete, AttachmentUpload, ATTACHMENT_CHUNK_BYTES, ATTACHMENT_DOWNLOAD_PART_BYTES, MAX_LARGE_ATTACHMENT_BYTES, OpportunityEmail } from '@isp/shared';
import { decryptSecret } from '../services/email';
import { integrationRow, logEvent } from '../services/integrations';
import { publicLink } from '../services/alerts';
import { signFileToken, verifyFileToken, waPhone, sendWhatsAppDocument, sendZapiDocument } from '../services/whatsapp';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { Tx } from '../db/client';
import { loadOpportunity } from '../services/opportunities';
import { getActiveInstruction } from '../services/instructions';
import { brl, renderEmail, sendEmail, tenantName } from '../services/email';
import { atLeast } from '@isp/domain';
import { level } from '../services/scope';
import { audit } from '../services/audit';

export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const AttachParams = z.object({ id: z.string().uuid(), aid: z.string().uuid() });
const ChunkParams = z.object({ id: z.string().uuid(), uploadId: z.string().uuid(), n: z.coerce.number().int().min(0).max(Math.ceil(MAX_LARGE_ATTACHMENT_BYTES / ATTACHMENT_CHUNK_BYTES) - 1) });
const UploadParams = z.object({ id: z.string().uuid(), uploadId: z.string().uuid() });
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

const fromBase64 = (b64: string) => {
  const clean = b64.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw unprocessable('Arquivo inválido.', [{ path: 'data', message: 'Conteúdo não está em base64' }]);
  return Buffer.from(clean, 'base64');
};

/** Depois de gravar o anexo: proposta muda o status da proposta, e o histórico registra. */
async function afterAttach(tx: Tx, auth: { tenantId: string; userId: string }, opp: { id: string; proposalStatus: string; rowVersion: number }, row: { filename: string }, kind: string, sizeBytes: number) {
  if (kind === 'proposta' && opp.proposalStatus === 'nao_criada') {
    await tx.update(s.opportunities).set({ proposalStatus: 'rascunho', updatedAt: new Date(), rowVersion: sql`${s.opportunities.rowVersion} + 1` }).where(eq(s.opportunities.id, opp.id));
  }
  await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'attachment_added', actorId: auth.userId, payload: { filename: row.filename, kind, sizeBytes }, rowVersion: opp.rowVersion });
}

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
      const data = fromBase64(body.data);
      if (!data.length) throw unprocessable('Arquivo vazio.');
      if (data.length > MAX_ATTACHMENT_BYTES) throw unprocessable('Arquivo maior que 3 MB.', [{ path: 'data', message: 'Limite de 3 MB por arquivo' }]);
      const mime = detectAttachment(body.filename, data);
      if (!mime) throw unprocessable('Formato não aceito. Envie PDF, Word, Excel, PowerPoint, PNG ou JPG.', [{ path: 'data', message: 'Formato não reconhecido' }]);
      const [row] = await app.db.transaction(async (tx) => {
        const r = await tx
          .insert(s.opportunityAttachments)
          .values({ tenantId: auth.tenantId, opportunityId: params.id, kind: body.kind, filename: safeName(body.filename), mime, sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), data, uploadedBy: auth.userId })
          .returning({ id: s.opportunityAttachments.id, kind: s.opportunityAttachments.kind, filename: s.opportunityAttachments.filename, mime: s.opportunityAttachments.mime, sizeBytes: s.opportunityAttachments.sizeBytes, createdAt: s.opportunityAttachments.createdAt });
        await afterAttach(tx, auth, opp, r[0]!, body.kind, data.length);
        return r;
      });
      await audit(app.db, req, { action: 'attachment.upload', entityType: 'opportunity', entityId: params.id, metadata: { filename: row!.filename, kind: body.kind } });
      reply.code(201);
      return row;
    },
  }),

  // anexo grande: as partes chegam uma a uma (cada requisição cabe no limite da hospedagem) e o servidor monta no fim
  defineRoute({
    method: 'PUT',
    url: '/opportunities/:id/attachments/uploads/:uploadId/parts/:n',
    summary: `Envia uma parte de um anexo grande (até ${mb(MAX_LARGE_ATTACHMENT_BYTES)} no total, em partes de ${(ATTACHMENT_CHUNK_BYTES / 1_000_000).toFixed(1)} MB)`,
    tag: 'Sprint',
    module: 'oportunidades',
    params: ChunkParams,
    body: AttachmentChunk,
    bodyLimit: 4_400_000,
    handler: async ({ app, auth, params, body, reply }) => {
      await loadOpportunity(app.db, auth, params.id);
      const data = fromBase64(body.data);
      if (!data.length) throw unprocessable('Parte vazia.');
      if (data.length > ATTACHMENT_CHUNK_BYTES) throw unprocessable('Parte maior que o permitido.');
      // partes esquecidas (envio interrompido) saem depois de um dia
      await app.db.delete(s.opportunityAttachmentChunks).where(sql`${s.opportunityAttachmentChunks.createdAt} < now() - interval '1 day'`);
      const r = await app.db.execute(sql`
        insert into opportunity_attachment_chunks (tenant_id, opportunity_id, upload_id, n, data, uploaded_by)
        values (${auth.tenantId}, ${params.id}, ${params.uploadId}, ${params.n}, ${data}, ${auth.userId})
        on conflict (upload_id, n) do update set data = excluded.data, created_at = now()
          where opportunity_attachment_chunks.uploaded_by = excluded.uploaded_by and opportunity_attachment_chunks.opportunity_id = excluded.opportunity_id
        returning n`);
      if (!r.rows.length) throw forbidden('Este envio é de outra pessoa ou de outra oportunidade.');
      return reply.code(204).send();
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/attachments/uploads/:uploadId/complete',
    summary: 'Conclui o anexo grande: confere as partes, monta o arquivo e registra o anexo',
    tag: 'Sprint',
    module: 'oportunidades',
    params: UploadParams,
    body: AttachmentComplete,
    handler: async ({ app, auth, params, body, req, reply }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const mine = and(eq(s.opportunityAttachmentChunks.uploadId, params.uploadId), eq(s.opportunityAttachmentChunks.opportunityId, params.id), eq(s.opportunityAttachmentChunks.tenantId, auth.tenantId), eq(s.opportunityAttachmentChunks.uploadedBy, auth.userId));
      const [st] = await app.db
        .select({ count: sql<number>`count(*)::int`, maxN: sql<number>`coalesce(max(${s.opportunityAttachmentChunks.n}), -1)::int`, bytes: sql<number>`coalesce(sum(octet_length(${s.opportunityAttachmentChunks.data})), 0)::bigint` })
        .from(s.opportunityAttachmentChunks).where(mine);
      if (!st || st.count !== body.parts || st.maxN !== body.parts - 1) throw unprocessable('O envio ficou incompleto. Tente anexar de novo.', [{ path: 'parts', message: `Recebidas ${st?.count ?? 0} de ${body.parts} partes` }]);
      if (Number(st.bytes) !== body.sizeBytes) throw unprocessable('O arquivo chegou diferente do enviado. Tente anexar de novo.');
      if (body.sizeBytes > MAX_LARGE_ATTACHMENT_BYTES) throw unprocessable(`Arquivo maior que ${mb(MAX_LARGE_ATTACHMENT_BYTES)}.`);
      const [head] = await app.db.select({ data: sql<Buffer>`substring(${s.opportunityAttachmentChunks.data} from 1 for 16)` }).from(s.opportunityAttachmentChunks).where(and(mine, eq(s.opportunityAttachmentChunks.n, 0)));
      const mime = detectAttachment(body.filename, Buffer.from(head!.data));
      if (!mime) {
        await app.db.delete(s.opportunityAttachmentChunks).where(mine);
        throw unprocessable('Formato não aceito. Envie PDF, Word, Excel, PowerPoint, PNG ou JPG.', [{ path: 'data', message: 'Formato não reconhecido' }]);
      }
      const filename = safeName(body.filename);
      const row = await app.db.transaction(async (tx) => {
        // monta no banco (o arquivo inteiro não passa pela memória do servidor)
        const ins = await tx.execute<{ id: string; kind: string; filename: string; mime: string; size_bytes: number; created_at: Date }>(sql`
          insert into opportunity_attachments (tenant_id, opportunity_id, kind, filename, mime, size_bytes, sha256, data, uploaded_by)
          select ${auth.tenantId}, ${params.id}, ${body.kind}, ${filename}, ${mime}, octet_length(f.data), encode(sha256(f.data), 'hex'), f.data, ${auth.userId}
          from (select string_agg(c.data, ''::bytea order by c.n) as data from opportunity_attachment_chunks c
                where c.upload_id = ${params.uploadId} and c.opportunity_id = ${params.id} and c.tenant_id = ${auth.tenantId} and c.uploaded_by = ${auth.userId}) f
          returning id, kind, filename, mime, size_bytes, created_at`);
        await tx.delete(s.opportunityAttachmentChunks).where(mine);
        const r = ins.rows[0]!;
        await afterAttach(tx, auth, opp, r, body.kind, body.sizeBytes);
        return { id: r.id, kind: r.kind, filename: r.filename, mime: r.mime, sizeBytes: Number(r.size_bytes), createdAt: r.created_at };
      });
      await audit(app.db, req, { action: 'attachment.upload', entityType: 'opportunity', entityId: params.id, metadata: { filename: row.filename, kind: body.kind, sizeBytes: body.sizeBytes, parts: body.parts } });
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
    query: z.object({ part: z.coerce.number().int().min(0).max(1000).optional() }),
    handler: async ({ app, auth, params, query, reply }) => {
      await loadOpportunity(app.db, auth, params.id);
      if (query.part !== undefined) {
        // arquivo grande: baixa um pedaço por vez (a resposta também tem limite na hospedagem); a tela junta os pedaços
        const [p] = await app.db
          .select({ data: sql<Buffer>`substring(${s.opportunityAttachments.data} from ${query.part * ATTACHMENT_DOWNLOAD_PART_BYTES + 1} for ${ATTACHMENT_DOWNLOAD_PART_BYTES})`, sizeBytes: s.opportunityAttachments.sizeBytes })
          .from(s.opportunityAttachments)
          .where(and(eq(s.opportunityAttachments.id, params.aid), eq(s.opportunityAttachments.opportunityId, params.id), eq(s.opportunityAttachments.tenantId, auth.tenantId), isNull(s.opportunityAttachments.deletedAt)))
          .limit(1);
        if (!p) throw notFound('Anexo não encontrado.');
        reply
          .header('content-type', 'application/octet-stream')
          .header('x-total-size', String(p.sizeBytes))
          .header('x-part-size', String(ATTACHMENT_DOWNLOAD_PART_BYTES))
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'private, no-store');
        return reply.send(Buffer.from(p.data));
      }
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
      // leitura do e-mail: pixel 1×1 com token próprio (gatilho "Cliente leu o e-mail" das jornadas)
      const openToken = randomBytes(24).toString('base64url');
      const result = await sendEmail(app.db, {
        tenantId: auth.tenantId,
        kind: body.kind,
        to: body.to,
        subject: body.subject,
        text: body.body,
        openToken,
        html: `${textToHtml(body.body)}<img src="${publicLink(app.config, `/api/v1/public/mail-open/${openToken}`)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`,
        attachments: attachment ? [{ filename: attachment.filename, content: attachment.data, contentType: attachment.mime }] : undefined,
        opportunityId: params.id,
        attachmentId: attachment?.id ?? null,
        createdBy: auth.userId,
        replyTo: auth.email,
      });
      if (!result.ok) throw unprocessable(`O e-mail não foi enviado: ${result.error}`, [{ path: 'smtp', message: result.error }]);
      await app.db.transaction(async (tx) => {
        if (body.kind === 'proposta') await ensureProposalNumber(tx, auth.tenantId, params.id, todayIn(auth.timezone));
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
        const file = { data: a.data, filename: a.filename, mime: a.mime };
        const z = await integrationRow(app.db, auth.tenantId, 'zapi');
        const zt = z.secrets.instanceToken ? decryptSecret(z.secrets.instanceToken) : null;
        const integ = await integrationRow(app.db, auth.tenantId, 'whatsapp');
        const token = integ.secrets.accessToken ? decryptSecret(integ.secrets.accessToken) : null;
        const useZapi = z.enabled && !!z.config.instanceId && !!zt;
        if (!useZapi && (!integ.enabled || !integ.config.phoneNumberId || !token)) throw unprocessable('O WhatsApp da empresa não está configurado. Use “Abrir no meu WhatsApp” ou configure a Z-API em Configurações → Integrações.');
        const kind = useZapi ? 'zapi' : 'whatsapp';
        try {
          if (useZapi) await sendZapiDocument({ instanceId: z.config.instanceId!, instanceToken: zt!, clientToken: z.secrets.clientToken ? decryptSecret(z.secrets.clientToken) : null }, to, file, body.message);
          else await sendWhatsAppDocument({ phoneNumberId: integ.config.phoneNumberId!, accessToken: token! }, to, file, body.message);
          await logEvent(app.db, auth.tenantId, kind, 'enviado', `${a.filename} enviado para ${to}.`);
        } catch (e) {
          await logEvent(app.db, auth.tenantId, kind, 'erro', `Envio de ${a.filename} para ${to}: ${(e as Error).message}`);
          throw unprocessable(`O WhatsApp não aceitou o envio: ${(e as Error).message}`);
        }
        result = { mode: 'api', link };
      } else {
        const text = `${body.message ? `${body.message}\n\n` : ''}${a.filename}: ${link}`;
        result = { mode: 'link', link, waUrl: `https://wa.me/${to}?text=${encodeURIComponent(text)}` };
      }
      await app.db.transaction(async (tx) => {
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'whatsapp_sent', actorId: auth.userId, payload: { filename: a.filename, to, mode: body.mode }, rowVersion: o.rowVersion });
        if (a.kind === 'proposta') await ensureProposalNumber(tx, auth.tenantId, o.id, todayIn(auth.timezone));
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
