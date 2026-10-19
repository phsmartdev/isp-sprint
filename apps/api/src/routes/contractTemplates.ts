/** Modelos de contrato (.docx com variáveis), geração do contrato preenchido e assinatura eletrônica pela ZapSign. */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BILLING_TYPES, CONTRACT_TEMPLATE_VARIABLES, CONTRACT_ITEM_LOOP, DOC_TYPES, documentName, type ProcessKind } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import type { DB, DbOrTx } from '../db/client';
import { audit } from '../services/audit';
import { level } from '../services/scope';
import { addEvent, hasSector, isAdmin, loadContract, pendingRequired, setStage, type ContractRow } from '../services/contracts';
import { contractTemplateValues, customKeys, inspectTemplate, renderTemplate } from '../services/contractTemplates';
import { createZapsignDoc, downloadFile, getZapsignDoc, zapsignConfig, type ZapDoc } from '../services/zapsign';
import { logEvent } from '../services/integrations';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const canManage = (auth: AuthContext) => isAdmin(auth) || level(auth, 'contratos') === 'total' || hasSector(auth, ['administracao', 'inteligencia_comercial', 'diretoria', 'juridico']);
const canSend = (auth: AuthContext, c: ContractRow) => canManage(auth) || c.commercialOwnerId === auth.userId || (level(auth, 'contratos') === 'equipe' && auth.teamMemberIds.includes(c.commercialOwnerId));
const Var = z.object({ key: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(80), type: z.enum(['texto', 'moeda', 'data', 'numero']).default('texto'), default: z.string().max(500).default('') });
const b64 = (v: string) => Buffer.from(v.replace(/^data:[^;]+;base64,/, ''), 'base64');

async function templateRow(db: DbOrTx, tenantId: string, id: string) {
  const [t] = await db.select().from(s.contractTemplates).where(and(eq(s.contractTemplates.id, id), eq(s.contractTemplates.tenantId, tenantId))).limit(1);
  if (!t) throw notFound('Modelo não encontrado.');
  return t;
}
function mergeVariables(detected: string[], loops: string[], given: z.infer<typeof Var>[]) {
  const custom = customKeys(detected, loops);
  return custom.map((k) => given.find((g) => g.key === k) ?? { key: k, label: k.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), type: 'texto' as const, default: '' });
}

// ------------------------------------------------------------------ assinatura: sincronização (webhook ou botão)
const STEP_FOR: Record<string, { kind: ProcessKind; step: string }[]> = {
  CONTRATO: [{ kind: 'implantacao', step: 'documento_assinado' }],
  ADITIVO: [{ kind: 'renovacao', step: 'pdf_assinado' }, { kind: 'renovacao', step: 'formalizacao' }],
};
export async function syncSignature(db: DB, sigId: string, doc: ZapDoc) {
  const [sig] = await db.select().from(s.contractSignatures).where(eq(s.contractSignatures.id, sigId)).limit(1);
  if (!sig) return null;
  const signers = sig.signers.map((x) => { const z2 = doc.signers.find((y) => y.token === x.token); return z2 ? { ...x, status: z2.status, signedAt: z2.signed_at, signUrl: z2.sign_url ?? x.signUrl } : x; });
  const refused = doc.status === 'refused' || doc.signers.some((x) => x.status === 'refused');
  let status = sig.status;
  if (refused) status = 'recusado';
  await db.update(s.contractSignatures).set({ signers, status, updatedAt: new Date() }).where(eq(s.contractSignatures.id, sig.id));
  if (refused && sig.status !== 'recusado') await addEvent(db, sig.tenantId, sig.contractId, null, 'assinatura', 'Assinatura recusada na ZapSign.', { signatureId: sig.id });
  if (doc.status !== 'signed' || sig.signedDocumentId || !doc.signed_file) return { status, signers };
  const file = await downloadFile(doc.signed_file);
  const [src] = await db.select().from(s.contractDocuments).where(eq(s.contractDocuments.id, sig.documentId)).limit(1);
  const [c] = await db.select().from(s.contracts).where(eq(s.contracts.id, sig.contractId)).limit(1);
  const [last] = await db.select({ version: s.contractDocuments.version }).from(s.contractDocuments).where(eq(s.contractDocuments.groupId, src!.groupId)).orderBy(desc(s.contractDocuments.version)).limit(1);
  await db.transaction(async (tx) => {
    const [d] = await tx.insert(s.contractDocuments).values({
      tenantId: sig.tenantId, contractId: sig.contractId, processId: src!.processId, groupId: src!.groupId, version: (last?.version ?? 1) + 1, category: src!.category,
      name: `${src!.name} - ASSINADO`.slice(0, 200), docDate: new Date().toISOString().slice(0, 10), summary: `${src!.summary} (assinado)`, mime: 'application/pdf', size: file.length,
      sha256: createHash('sha256').update(file).digest('hex'), data: file, signed: true, restrictedTo: src!.restrictedTo, folder: src!.folder,
    }).returning({ id: s.contractDocuments.id });
    await tx.update(s.contractSignatures).set({ status: 'assinado', signedDocumentId: d!.id, updatedAt: new Date() }).where(eq(s.contractSignatures.id, sig.id));
    await addEvent(tx, sig.tenantId, sig.contractId, null, 'assinatura', `Documento assinado por todos na ZapSign: ${src!.name}. PDF assinado anexado como nova versão.`, { signatureId: sig.id, documentId: d!.id });
    // etapas que pedem este documento assinado são concluídas pela ZapSign
    for (const target of STEP_FOR[src!.category] ?? []) {
      const [p] = await tx.select().from(s.contractProcesses).where(and(eq(s.contractProcesses.contractId, sig.contractId), eq(s.contractProcesses.kind, target.kind), eq(s.contractProcesses.status, 'aberto'))).limit(1);
      if (!p || p.steps[target.step] || (target.step === 'formalizacao' && c!.kind === 'publico') || (target.step === 'pdf_assinado' && c!.kind !== 'publico')) continue;
      const steps = { ...p.steps, [target.step]: { doneAt: new Date().toISOString(), doneBy: 'zapsign', doneByName: 'ZapSign', note: 'Assinado eletronicamente', value: { documentId: d!.id } } };
      await tx.update(s.contractProcesses).set({ steps }).where(eq(s.contractProcesses.id, p.id));
      await addEvent(tx, sig.tenantId, sig.contractId, null, 'etapa_processo', `Etapa concluída pela assinatura eletrônica: ${target.step.replace(/_/g, ' ')}`, { processId: p.id });
      if (p.kind === 'implantacao' && !pendingRequired({ kind: p.kind, steps }, c!.kind).length) {
        await tx.update(s.contractProcesses).set({ status: 'concluido', outcome: 'implantado', closedAt: new Date() }).where(eq(s.contractProcesses.id, p.id));
        if (c!.stage === 'implantacao') await setStage(tx, c!, null, 'vigente', 'implantação concluída');
      }
    }
  });
  return { status: 'assinado', signers };
}

export const contractTemplateRoutes = [
  defineRoute({
    method: 'GET',
    url: '/contract-templates',
    summary: 'Modelos de contrato e variáveis disponíveis',
    tag: 'Contratos',
    module: 'contratos',
    handler: async ({ app, auth }) => {
      const items = await app.db.select({ id: s.contractTemplates.id, name: s.contractTemplates.name, description: s.contractTemplates.description, billingType: s.contractTemplates.billingType, docType: s.contractTemplates.docType, variables: s.contractTemplates.variables, detected: s.contractTemplates.detected, fileName: s.contractTemplates.fileName, size: s.contractTemplates.size, active: s.contractTemplates.active, updatedAt: s.contractTemplates.updatedAt })
        .from(s.contractTemplates).where(eq(s.contractTemplates.tenantId, auth.tenantId)).orderBy(desc(s.contractTemplates.active), s.contractTemplates.name);
      return { items, systemVariables: CONTRACT_TEMPLATE_VARIABLES, itemLoop: CONTRACT_ITEM_LOOP, canManage: canManage(auth) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contract-templates',
    summary: 'Sobe um modelo (.docx) com campos {{variável}}; o arquivo é conferido e os campos são listados',
    tag: 'Contratos',
    module: 'contratos',
    bodyLimit: 9_000_000,
    body: z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullable().default(null), billingType: z.enum(BILLING_TYPES).nullable().default(null), docType: z.enum(DOC_TYPES).default('CONTRATO'), fileName: z.string().trim().min(1).max(200), data: z.string().min(8).max(8_500_000), variables: z.array(Var).max(80).default([]) }),
    handler: async ({ app, auth, body, req, reply }) => {
      if (!canManage(auth)) throw forbidden('Modelos de contrato são da gestão de contratos (Administração, Inteligência Comercial, Jurídico ou Diretoria).');
      const data = b64(body.data);
      if (data.length > 6_000_000) throw unprocessable('Modelo maior que 6 MB.');
      const { keys, loops } = inspectTemplate(data);
      const variables = mergeVariables(keys, loops, body.variables);
      const [t] = await app.db.insert(s.contractTemplates).values({ tenantId: auth.tenantId, name: body.name, description: body.description, billingType: body.billingType, docType: body.docType, variables, detected: keys, fileName: body.fileName, size: data.length, data, createdBy: auth.userId }).returning({ id: s.contractTemplates.id });
      await audit(app.db, req, { action: 'contract.template.create', entityType: 'contract_template', entityId: t!.id, metadata: { name: body.name, fields: keys.length } });
      reply.code(201);
      return { id: t!.id, detected: keys, variables };
    },
  }),
  defineRoute({
    method: 'PUT',
    url: '/contract-templates/:id',
    summary: 'Edita nome, tipo, rótulos e padrões das variáveis; com data troca o arquivo',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    bodyLimit: 9_000_000,
    body: z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullable().default(null), billingType: z.enum(BILLING_TYPES).nullable().default(null), docType: z.enum(DOC_TYPES).default('CONTRATO'), active: z.boolean().default(true), variables: z.array(Var).max(80).default([]), fileName: z.string().trim().min(1).max(200).optional(), data: z.string().min(8).max(8_500_000).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      if (!canManage(auth)) throw forbidden();
      const t = await templateRow(app.db, auth.tenantId, params.id);
      let detected = t.detected, loops: string[] = [], data = t.data, fileName = t.fileName;
      if (body.data) { data = b64(body.data); const r = inspectTemplate(data); detected = r.keys; loops = r.loops; fileName = body.fileName ?? fileName; }
      else loops = detected.filter((k) => k === 'itens');
      const variables = mergeVariables(detected, loops, body.variables);
      await app.db.update(s.contractTemplates).set({ name: body.name, description: body.description, billingType: body.billingType, docType: body.docType, active: body.active, variables, detected, data, fileName, size: data.length, updatedAt: new Date() }).where(eq(s.contractTemplates.id, t.id));
      await audit(app.db, req, { action: 'contract.template.update', entityType: 'contract_template', entityId: t.id, metadata: { name: body.name, newFile: !!body.data } });
      return { ok: true, detected, variables };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/contract-templates/:id/download',
    summary: 'Baixa o arquivo do modelo',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const t = await templateRow(app.db, auth.tenantId, params.id);
      return reply.header('content-type', DOCX).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(t.fileName)}`).send(t.data);
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts/:id/generate',
    summary: 'Gera o documento do contrato pelo modelo, com as variáveis preenchidas, e anexa à ficha (Word)',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    body: z.object({ templateId: z.string().uuid(), values: z.record(z.string(), z.string().max(4000)).default({}), summary: z.string().trim().min(2).max(120).optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canSend(auth, c)) throw forbidden();
      const t = await templateRow(app.db, auth.tenantId, body.templateId);
      if (!t.active) throw unprocessable('Modelo inativo.');
      const custom = Object.fromEntries(t.variables.map((v) => [v.key, body.values[v.key] ?? v.default ?? '']));
      const vals = await contractTemplateValues(app.db, auth, c, custom);
      const file = renderTemplate(t.data, vals);
      const summary = body.summary ?? String(vals['contrato.objeto']).slice(0, 80);
      const name = documentName(new Date().toISOString().slice(0, 10), t.docType, String(vals._client), summary);
      const [d] = await app.db.insert(s.contractDocuments).values({ tenantId: auth.tenantId, contractId: c.id, groupId: randomUUID(), version: 1, category: t.docType, name, docDate: new Date().toISOString().slice(0, 10), summary, mime: DOCX, size: file.length, sha256: createHash('sha256').update(file).digest('hex'), data: file, folder: c.stage === 'arquivado' ? 'Encerrados' : 'Ativos', uploadedBy: auth.userId }).returning({ id: s.contractDocuments.id });
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'documento', `Documento gerado pelo modelo “${t.name}”: ${name}`, { documentId: d!.id, templateId: t.id });
      await audit(app.db, req, { action: 'contract.generate', entityType: 'contract', entityId: c.id, metadata: { templateId: t.id } });
      reply.code(201);
      return { id: d!.id, name };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts/:id/documents/:docId/signature',
    summary: 'Envia o documento para assinatura na ZapSign (cada signatário recebe o link por e-mail)',
    tag: 'Contratos',
    module: 'contratos',
    params: z.object({ id: z.string().uuid(), docId: z.string().uuid() }),
    body: z.object({
      signers: z.array(z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200).nullable().default(null), phone: z.string().trim().max(30).nullable().default(null), authMode: z.enum(['assinaturaTela', 'tokenEmail', 'assinaturaTela-tokenEmail', 'tokenSms', 'assinaturaTela-tokenSms']).default('assinaturaTela') })).min(1).max(10),
      message: z.string().trim().max(500).default(''),
      dateLimit: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canSend(auth, c)) throw forbidden();
      if (body.signers.some((x) => !x.email && !x.phone)) throw unprocessable('Cada signatário precisa de e-mail ou celular.');
      const [d] = await app.db.select().from(s.contractDocuments).where(and(eq(s.contractDocuments.id, params.docId), eq(s.contractDocuments.contractId, c.id), isNull(s.contractDocuments.deletedAt))).limit(1);
      if (!d) throw notFound('Documento não encontrado.');
      if (d.signed) throw unprocessable('Este documento já está assinado.');
      if (![DOCX, 'application/pdf'].includes(d.mime)) throw unprocessable('A ZapSign recebe PDF ou Word (.docx).');
      const [open] = await app.db.select({ id: s.contractSignatures.id }).from(s.contractSignatures).where(and(eq(s.contractSignatures.documentId, d.id), eq(s.contractSignatures.status, 'enviado'))).limit(1);
      if (open) throw unprocessable('Este documento já está em assinatura. Atualize o status ou aguarde.');
      const cfg = await zapsignConfig(app.db, auth.tenantId);
      let doc: ZapDoc;
      try {
        doc = await createZapsignDoc(cfg, { name: d.name, file: d.data, mime: d.mime, externalId: `contrato:${c.id}:${d.id}`, signers: body.signers, message: body.message, dateLimit: body.dateLimit });
      } catch (e) {
        await logEvent(app.db, auth.tenantId, 'zapsign', 'erro', `Envio de ${d.name}: ${(e as Error).message}`);
        await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'assinatura', `Falha ao enviar para a ZapSign: ${(e as Error).message}`, { documentId: d.id });
        throw unprocessable(`A ZapSign não aceitou o envio: ${(e as Error).message}`);
      }
      const signers = body.signers.map((x, i) => ({ name: x.name, email: x.email, phone: x.phone, token: doc.signers[i]?.token ?? null, signUrl: doc.signers[i]?.sign_url ?? null, status: doc.signers[i]?.status ?? 'new', signedAt: null }));
      const [row] = await app.db.insert(s.contractSignatures).values({ tenantId: auth.tenantId, contractId: c.id, documentId: d.id, providerToken: doc.token, status: 'enviado', signers, sandbox: cfg.sandbox, createdBy: auth.userId }).returning({ id: s.contractSignatures.id });
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'assinatura', `Enviado para assinatura na ZapSign${cfg.sandbox ? ' (sandbox, sem validade jurídica)' : ''}: ${d.name} — ${body.signers.map((x) => x.name).join(', ')}`, { signatureId: row!.id, documentId: d.id });
      await logEvent(app.db, auth.tenantId, 'zapsign', 'enviado', `${d.name} enviado para ${body.signers.length} signatário(s).`);
      await audit(app.db, req, { action: 'contract.signature.send', entityType: 'contract', entityId: c.id, metadata: { documentId: d.id, signers: body.signers.length } });
      reply.code(201);
      return { id: row!.id, signers };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/contracts/:id/signatures',
    summary: 'Envios para assinatura deste contrato',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const rows = await app.db.select({ id: s.contractSignatures.id, documentId: s.contractSignatures.documentId, status: s.contractSignatures.status, signers: s.contractSignatures.signers, signedDocumentId: s.contractSignatures.signedDocumentId, sandbox: s.contractSignatures.sandbox, createdAt: s.contractSignatures.createdAt, updatedAt: s.contractSignatures.updatedAt, documentName: s.contractDocuments.name })
        .from(s.contractSignatures).innerJoin(s.contractDocuments, eq(s.contractDocuments.id, s.contractSignatures.documentId))
        .where(eq(s.contractSignatures.contractId, c.id)).orderBy(desc(s.contractSignatures.createdAt));
      return { items: rows };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contracts/:id/signatures/:sid/sync',
    summary: 'Consulta a ZapSign e atualiza o status (traz o PDF assinado quando todos assinarem)',
    tag: 'Contratos',
    module: 'contratos',
    params: z.object({ id: z.string().uuid(), sid: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const [sig] = await app.db.select().from(s.contractSignatures).where(and(eq(s.contractSignatures.id, params.sid), eq(s.contractSignatures.contractId, c.id))).limit(1);
      if (!sig?.providerToken) throw notFound('Envio não encontrado.');
      const cfg = await zapsignConfig(app.db, auth.tenantId);
      try {
        return (await syncSignature(app.db, sig.id, await getZapsignDoc(cfg, sig.providerToken))) ?? { status: sig.status };
      } catch (e) {
        throw unprocessable(`Não foi possível consultar a ZapSign: ${(e as Error).message}`);
      }
    },
  }),

  // ------------------------------------------------------------------ webhook da ZapSign (público, por código secreto)
  defineRoute({
    method: 'POST',
    url: '/hooks/zapsign/:token',
    summary: 'Eventos da ZapSign (doc_signed, doc_refused...). Confirma o status consultando a própria ZapSign.',
    tag: 'Integrações',
    public: true,
    params: z.object({ token: z.string().min(20).max(64) }),
    body: z.record(z.string(), z.unknown()),
    rateLimit: () => ({ max: 300, timeWindow: '1 minute' }),
    handler: async ({ app, params, body }) => {
      const [r] = await app.db.select().from(s.integrations).where(and(eq(s.integrations.kind, 'zapsign'), sql`length(${s.integrations.webhookToken}) = ${params.token.length}`, eq(s.integrations.webhookToken, params.token))).limit(1);
      if (!r || !timingSafeEqual(Buffer.from(r.webhookToken), Buffer.from(params.token))) throw notFound('Endereço de integração inválido.');
      const docToken = typeof body.token === 'string' ? body.token : null;
      if (!r.enabled || !docToken) return { ok: true };
      const [sig] = await app.db.select().from(s.contractSignatures).where(and(eq(s.contractSignatures.tenantId, r.tenantId), eq(s.contractSignatures.providerToken, docToken))).limit(1);
      if (!sig) { await logEvent(app.db, r.tenantId, 'zapsign', 'ignorado', `Evento ${String(body.event_type ?? '')} de documento que não é do CRM.`); return { ok: true }; }
      try {
        const cfg = await zapsignConfig(app.db, r.tenantId);
        const res = await syncSignature(app.db, sig.id, await getZapsignDoc(cfg, docToken));
        await logEvent(app.db, r.tenantId, 'zapsign', 'recebido', `${String(body.event_type ?? 'evento')}: ${res?.status ?? sig.status}`);
      } catch (e) {
        await logEvent(app.db, r.tenantId, 'zapsign', 'erro', `Evento ${String(body.event_type ?? '')}: ${(e as Error).message}`);
      }
      return { ok: true };
    },
  }),
];
