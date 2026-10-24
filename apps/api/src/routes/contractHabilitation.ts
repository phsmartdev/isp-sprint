/** Gestão de Contratos → Habilitação: certidões e alvarás da empresa por filial, com validade, arquivo e histórico. */
import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { COMPANY_DOC_KINDS, COMPANY_DOC_LABELS, REQUIRED_PUBLIC_DOCS, docStatus, type CompanyDocKind } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { hasSector, isAdmin } from '../services/contracts';
import { level } from '../services/scope';
import { currentCompanyDocs, publicContractsByBranch } from '../services/companyDocs';
import { ensureSalesBranches } from '../services/opportunities';
import { detectAttachment } from './sprint';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const canEdit = (auth: Parameters<typeof isAdmin>[0]) => isAdmin(auth) || level(auth, 'contratos') === 'total' || hasSector(auth, ['administracao', 'juridico', 'inteligencia_comercial', 'financeiro', 'diretoria']);

export const contractHabilitationRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/habilitation', summary: 'Habilitação da empresa por filial: situação de cada certidão exigida, contratos públicos que dependem dela', tag: 'Contratos', module: 'contratos',
    handler: async ({ app, auth }) => {
      const today = new Date().toISOString().slice(0, 10);
      await ensureSalesBranches(app.db, auth.tenantId);
      const branches = await app.db.select({ id: s.salesBranches.id, name: s.salesBranches.name }).from(s.salesBranches).where(and(eq(s.salesBranches.tenantId, auth.tenantId), eq(s.salesBranches.active, true)));
      const docs = (await currentCompanyDocs(app.db, auth.tenantId)).map((d) => ({ ...d, ...docStatus(d.expiresOn, today), kindLabel: d.label || COMPANY_DOC_LABELS[d.kind as CompanyDocKind] || d.kind }));
      const pubs = await publicContractsByBranch(app.db, auth.tenantId);
      // matriz: cada filial × certidão exigida (documento da filial; senão o que vale para todas)
      const matrix = branches.map((b) => ({
        branchId: b.id, branchName: b.name, publicContracts: pubs.filter((p) => p.branch_id === b.id || p.branch_id === null).reduce((t, p) => t + p.n, 0),
        items: REQUIRED_PUBLIC_DOCS.map((k) => {
          const d = docs.find((x) => x.kind === k && x.branchId === b.id) ?? docs.find((x) => x.kind === k && !x.branchId) ?? null;
          return { kind: k, label: COMPANY_DOC_LABELS[k], doc: d, ...(d ? { status: d.status, days: d.days } : { status: 'falta' as const, days: null }) };
        }),
      }));
      return { branches, kinds: COMPANY_DOC_KINDS.map((k) => ({ key: k, label: COMPANY_DOC_LABELS[k], required: REQUIRED_PUBLIC_DOCS.includes(k) })), docs, matrix, canEdit: canEdit(auth) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/habilitation/history', summary: 'Versões anteriores de uma certidão (filial e tipo)', tag: 'Contratos', module: 'contratos',
    query: z.object({ kind: z.enum(COMPANY_DOC_KINDS), branchId: z.string().uuid().optional() }),
    handler: async ({ app, auth, query }) => {
      const rows = await app.db.select({ id: s.companyDocuments.id, number: s.companyDocuments.number, issuedOn: s.companyDocuments.issuedOn, expiresOn: s.companyDocuments.expiresOn, filename: s.companyDocuments.filename, createdAt: s.companyDocuments.createdAt, supersededAt: s.companyDocuments.supersededAt, by: s.users.name })
        .from(s.companyDocuments).leftJoin(s.users, eq(s.users.id, s.companyDocuments.createdBy))
        .where(and(eq(s.companyDocuments.tenantId, auth.tenantId), eq(s.companyDocuments.kind, query.kind), query.branchId ? eq(s.companyDocuments.branchId, query.branchId) : isNull(s.companyDocuments.branchId))).orderBy(desc(s.companyDocuments.createdAt)).limit(50);
      return { items: rows };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/habilitation', summary: 'Cadastra certidão/alvará (substitui o atual da mesma filial e tipo; o anterior fica no histórico)', tag: 'Contratos', module: 'contratos',
    bodyLimit: 6_000_000,
    body: z.object({
      branchId: z.string().uuid().nullable(), kind: z.enum(COMPANY_DOC_KINDS), label: z.string().trim().max(120).nullable().optional(), number: z.string().trim().max(80).nullable().optional(),
      issuedOn: day.nullable().optional(), expiresOn: day.nullable().optional(), filename: z.string().trim().min(3).max(160), data: z.string().min(8).max(5_600_000), notes: z.string().trim().max(500).nullable().optional(),
    }),
    handler: async ({ app, auth, req, body, reply }) => {
      if (!canEdit(auth)) throw forbidden('Habilitação é cadastrada pela Administração, Jurídico, Financeiro ou gestão de contratos.');
      if (body.kind === 'outro' && !body.label?.trim()) throw unprocessable('Dê um nome ao documento.', [{ path: 'label', message: 'Obrigatório' }]);
      if (body.kind !== 'outro' && !body.expiresOn) throw unprocessable('Informe a validade da certidão.', [{ path: 'expiresOn', message: 'Obrigatório' }]);
      if (body.issuedOn && body.expiresOn && body.expiresOn < body.issuedOn) throw unprocessable('A validade não pode ser antes da emissão.', [{ path: 'expiresOn', message: 'Antes da emissão' }]);
      if (body.branchId) { const [b] = await app.db.select({ id: s.salesBranches.id }).from(s.salesBranches).where(and(eq(s.salesBranches.id, body.branchId), eq(s.salesBranches.tenantId, auth.tenantId))).limit(1); if (!b) throw unprocessable('Filial não encontrada.'); }
      const data = Buffer.from(body.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (!data.length || data.length > 4_000_000) throw unprocessable('Arquivo vazio ou maior que 4 MB.');
      const mime = detectAttachment(body.filename, data);
      if (!mime || !['application/pdf', 'image/png', 'image/jpeg'].includes(mime)) throw unprocessable('Envie a certidão em PDF, PNG ou JPG.');
      const id = await app.db.transaction(async (tx) => {
        const same = and(eq(s.companyDocuments.tenantId, auth.tenantId), eq(s.companyDocuments.kind, body.kind), body.branchId ? eq(s.companyDocuments.branchId, body.branchId) : isNull(s.companyDocuments.branchId), isNull(s.companyDocuments.supersededAt), ...(body.kind === 'outro' ? [eq(s.companyDocuments.label, body.label!.trim())] : []));
        await tx.update(s.companyDocuments).set({ supersededAt: new Date() }).where(same);
        const [d] = await tx.insert(s.companyDocuments).values({ tenantId: auth.tenantId, branchId: body.branchId, kind: body.kind, label: body.kind === 'outro' ? body.label!.trim() : null, number: body.number || null, issuedOn: body.issuedOn ?? null, expiresOn: body.expiresOn ?? null, filename: body.filename.replace(/[\\/:*?"<>|\r\n]+/g, '_'), mime, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), data, notes: body.notes || null, createdBy: auth.userId }).returning({ id: s.companyDocuments.id });
        return d!.id;
      });
      await audit(app.db, req, { action: 'company_document.upload', entityType: 'company_document', entityId: id, metadata: { kind: body.kind, expiresOn: body.expiresOn } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/habilitation/:id/download', summary: 'Baixa a certidão', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [d] = await app.db.select({ data: s.companyDocuments.data, mime: s.companyDocuments.mime, filename: s.companyDocuments.filename }).from(s.companyDocuments).where(and(eq(s.companyDocuments.id, params.id), eq(s.companyDocuments.tenantId, auth.tenantId))).limit(1);
      if (!d) throw notFound('Documento não encontrado.');
      return reply.header('content-type', d.mime).header('x-content-type-options', 'nosniff').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`).send(d.data);
    },
  }),
];
