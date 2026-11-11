/**
 * Ofícios: modelos (Configurações → Modelos → Ofícios), assinatura e numeração por filial, prévia exata em PDF e
 * emissão a partir do contrato. O fundo é o timbrado da filial (a da negociação de origem, ou a escolhida). Número sequencial por filial
 * e ano, atribuído só ao emitir; o ofício emitido guarda o texto e os valores usados e não se altera.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { OfficeBlock } from '../db/schema';
import { audit } from '../services/audit';
import { dataUrlImage, decodeImage } from '../services/images';
import { loadContract } from '../services/contracts';
import { branchArt, DEFAULT_BLOCKS, OFFICE_VARS, officeDefaults, renderOffice, SAMPLE_VARS, usedVars } from '../services/officeLetters';
import { todayIn } from '../services/vacations';

const ADMIN = { tag: 'Ofícios', module: 'configuracoes' as const, min: 'total' as const };
const CTR = { tag: 'Ofícios', module: 'contratos' as const };

const Block = z.object({
  id: z.string().min(1).max(40), kind: z.enum(['texto', 'assinatura']), label: z.string().max(60).optional(),
  x: z.number().min(0).max(200), y: z.number().min(0).max(290), w: z.number().min(10).max(210),
  align: z.enum(['left', 'right', 'center', 'justify']), size: z.number().min(6).max(28), lineGap: z.number().min(1).max(3),
  indent: z.number().min(0).max(60), paraGap: z.number().min(0).max(30), text: z.string().max(10000),
  // assinatura digitalizada no próprio bloco (até ~600 KB) e o ajuste dela
  sigImage: z.string().max(820_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Assinatura em PNG ou JPG').refine((v) => dataUrlImage(v) !== null, 'Imagem da assinatura corrompida. Exporte o arquivo novamente.').nullable().optional(),
  sigH: z.number().min(5).max(60).optional(), sigDx: z.number().min(-80).max(80).optional(), sigDy: z.number().min(-40).max(40).optional(),
});
const Blocks = z.array(Block).min(1).max(30);
const Vars = z.record(z.string().max(60), z.string().max(2000));

export const officeLetterRoutes = [
  // ------------------------------------------------------------------ modelos
  defineRoute({
    method: 'GET', url: '/admin/oficios', summary: 'Modelos de ofício, filiais (assinatura e numeração) e as variáveis disponíveis', ...ADMIN,
    handler: async ({ app, auth }) => {
      const year = Number(todayIn(auth.timezone).slice(0, 4));
      const [templates, branches, signers, seqs] = await Promise.all([
        app.db.select({ id: s.officeTemplates.id, name: s.officeTemplates.name, description: s.officeTemplates.description, branchIds: s.officeTemplates.branchIds, blocks: s.officeTemplates.blocks, active: s.officeTemplates.active, version: s.officeTemplates.version, updatedAt: s.officeTemplates.updatedAt }).from(s.officeTemplates).where(eq(s.officeTemplates.tenantId, auth.tenantId)).orderBy(asc(s.officeTemplates.name)),
        app.db.select({ id: s.salesBranches.id, name: s.salesBranches.name, cnpj: s.salesBranches.cnpj, city: s.salesBranches.city, state: s.salesBranches.state, active: s.salesBranches.active }).from(s.salesBranches).where(eq(s.salesBranches.tenantId, auth.tenantId)).orderBy(asc(s.salesBranches.position)),
        app.db.select({ branchId: s.branchSigners.branchId, legalName: s.branchSigners.legalName, signerName: s.branchSigners.signerName, signerRole: s.branchSigners.signerRole, hasSignature: sql<boolean>`${s.branchSigners.signatureData} is not null` }).from(s.branchSigners).where(eq(s.branchSigners.tenantId, auth.tenantId)),
        app.db.select().from(s.officeLetterSeq).where(and(eq(s.officeLetterSeq.tenantId, auth.tenantId), eq(s.officeLetterSeq.year, year))),
        ]);
      const lh = await app.db.select({ branchId: s.branchLetterheads.branchId }).from(s.branchLetterheads).where(eq(s.branchLetterheads.tenantId, auth.tenantId));
      return {
        templates, vars: OFFICE_VARS, defaultBlocks: DEFAULT_BLOCKS, year,
        branches: branches.map((b) => ({ ...b, hasLetterhead: lh.some((l) => l.branchId === b.id), signer: signers.find((x) => x.branchId === b.id) ?? null, nextNumber: seqs.find((q) => q.branchId === b.id)?.nextNumber ?? 1 })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/oficios', bodyLimit: 2_000_000, summary: 'Cria modelo de ofício (começa do modelo de reajuste, se não vierem blocos)', ...ADMIN,
    body: z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullable().default(null), branchIds: z.array(z.string().uuid()).max(50).default([]), blocks: Blocks.optional() }),
    handler: async ({ app, auth, body, req, reply }) => {
      const [t] = await app.db.insert(s.officeTemplates).values({ tenantId: auth.tenantId, name: body.name, description: body.description, branchIds: body.branchIds, blocks: (body.blocks ?? DEFAULT_BLOCKS) as OfficeBlock[], createdBy: auth.userId, updatedBy: auth.userId }).returning({ id: s.officeTemplates.id });
      await audit(app.db, req, { action: 'office.template.create', entityType: 'office_template', entityId: t!.id, metadata: { name: body.name } });
      reply.code(201);
      return { id: t!.id };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/admin/oficios/:id', bodyLimit: 2_000_000, summary: 'Edita o modelo (texto, posição dos blocos, filiais); cada gravação é uma nova versão', ...ADMIN, params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(500).nullable().optional(), branchIds: z.array(z.string().uuid()).max(50).optional(), blocks: Blocks.optional(), active: z.boolean().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const [t] = await app.db.update(s.officeTemplates).set({ ...body, ...(body.blocks ? { blocks: body.blocks as OfficeBlock[] } : {}), version: sql`${s.officeTemplates.version} + 1`, updatedBy: auth.userId, updatedAt: new Date() })
        .where(and(eq(s.officeTemplates.tenantId, auth.tenantId), eq(s.officeTemplates.id, params.id))).returning({ id: s.officeTemplates.id, version: s.officeTemplates.version });
      if (!t) throw notFound('Modelo não encontrado.');
      await audit(app.db, req, { action: 'office.template.update', entityType: 'office_template', entityId: t.id, metadata: { version: t.version, fields: Object.keys(body) } });
      return t;
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/admin/oficios/:id', summary: 'Exclui o modelo (os ofícios já emitidos continuam)', ...ADMIN, params: IdParams,
    handler: async ({ app, auth, params, req, reply }) => {
      const r = await app.db.delete(s.officeTemplates).where(and(eq(s.officeTemplates.tenantId, auth.tenantId), eq(s.officeTemplates.id, params.id))).returning({ id: s.officeTemplates.id });
      if (!r.length) throw notFound('Modelo não encontrado.');
      await audit(app.db, req, { action: 'office.template.delete', entityType: 'office_template', entityId: params.id });
      return reply.code(204).send();
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/oficios/previa', summary: 'Prévia do modelo em PDF com valores de exemplo, no timbrado da filial escolhida', ...ADMIN,
    body: z.object({ blocks: Blocks, branchId: z.string().uuid().nullable().default(null) }), bodyLimit: 2_000_000,
    handler: async ({ app, auth, body }) => {
      const art = await branchArt(app.db, auth.tenantId, body.branchId);
      const r = await renderOffice({ blocks: body.blocks as OfficeBlock[], vars: SAMPLE_VARS, ...art });
      return { pdf: r.pdf.toString('base64'), boxes: r.boxes, pages: r.pages };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/oficios/filiais/:id', summary: 'Razão social, quem assina e o próximo número do ano na filial', ...ADMIN, params: IdParams,
    body: z.object({ legalName: z.string().trim().max(200).nullable(), signerName: z.string().trim().max(120).nullable(), signerRole: z.string().trim().max(120).nullable(), nextNumber: z.number().int().min(1).max(999999) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [b] = await app.db.select({ id: s.salesBranches.id }).from(s.salesBranches).where(and(eq(s.salesBranches.tenantId, auth.tenantId), eq(s.salesBranches.id, params.id))).limit(1);
      if (!b) throw notFound('Filial não encontrada.');
      const year = Number(todayIn(auth.timezone).slice(0, 4));
      const [used] = await app.db.select({ max: sql<number>`coalesce(max(${s.officeLetters.number}), 0)` }).from(s.officeLetters).where(and(eq(s.officeLetters.branchId, b.id), eq(s.officeLetters.year, year)));
      if (body.nextNumber <= Number(used?.max ?? 0)) throw unprocessable(`O ofício nº ${used!.max}/${year} já foi emitido nesta filial: o próximo precisa ser maior.`, [{ path: 'nextNumber', message: 'Número já usado' }]);
      await app.db.insert(s.branchSigners).values({ branchId: b.id, tenantId: auth.tenantId, legalName: body.legalName, signerName: body.signerName, signerRole: body.signerRole, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: s.branchSigners.branchId, set: { legalName: body.legalName, signerName: body.signerName, signerRole: body.signerRole, updatedBy: auth.userId, updatedAt: new Date() } });
      await app.db.insert(s.officeLetterSeq).values({ tenantId: auth.tenantId, branchId: b.id, year, nextNumber: body.nextNumber })
        .onConflictDoUpdate({ target: [s.officeLetterSeq.branchId, s.officeLetterSeq.year], set: { nextNumber: body.nextNumber } });
      await audit(app.db, req, { action: 'office.branch.update', entityType: 'branch', entityId: b.id, metadata: { year, nextNumber: body.nextNumber, signer: body.signerName } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/oficios/filiais/:id/assinatura', summary: 'Imagem da assinatura de quem assina pela filial (PNG ou JPG)', ...ADMIN, params: IdParams,
    body: z.object({ data: z.string().min(16).max(3_000_000) }), bodyLimit: 3_200_000,
    handler: async ({ app, auth, params, body, req }) => {
      const img = decodeImage(body.data);
      if (img.mime === 'image/webp') throw unprocessable('Envie a assinatura em PNG (de preferência com fundo transparente) ou JPG.');
      const [b] = await app.db.select({ id: s.salesBranches.id }).from(s.salesBranches).where(and(eq(s.salesBranches.tenantId, auth.tenantId), eq(s.salesBranches.id, params.id))).limit(1);
      if (!b) throw notFound('Filial não encontrada.');
      await app.db.insert(s.branchSigners).values({ branchId: b.id, tenantId: auth.tenantId, signatureMime: img.mime, signatureData: img.data, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: s.branchSigners.branchId, set: { signatureMime: img.mime, signatureData: img.data, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'office.branch.signature', entityType: 'branch', entityId: b.id, metadata: { sha256: img.sha256 } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/admin/oficios/filiais/:id/assinatura', summary: 'Remove a imagem da assinatura', ...ADMIN, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      await app.db.update(s.branchSigners).set({ signatureMime: null, signatureData: null, updatedAt: new Date() }).where(and(eq(s.branchSigners.tenantId, auth.tenantId), eq(s.branchSigners.branchId, params.id)));
      return reply.code(204).send();
    },
  }),

  // ------------------------------------------------------------------ no contrato
  defineRoute({
    method: 'GET', url: '/contracts/:id/oficios', summary: 'Modelos da filial, valores iniciais do contrato, destinatários e ofícios já emitidos', ...CTR, params: IdParams,
    query: z.object({ destinatario: z.string().uuid().optional(), filial: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, query }) => {
      const c = await loadContract(app.db, auth, params.id);
      const d = await officeDefaults(app.db, auth.tenantId, c.id, todayIn(auth.timezone), { recipientPersonId: query.destinatario, branchId: query.filial });
      const [templates, issued, branches] = await Promise.all([
        app.db.select({ id: s.officeTemplates.id, name: s.officeTemplates.name, description: s.officeTemplates.description, branchIds: s.officeTemplates.branchIds, blocks: s.officeTemplates.blocks, version: s.officeTemplates.version }).from(s.officeTemplates)
          .where(and(eq(s.officeTemplates.tenantId, auth.tenantId), eq(s.officeTemplates.active, true))).orderBy(asc(s.officeTemplates.name)),
        app.db.select({ id: s.officeLetters.id, label: s.officeLetters.label, subject: s.officeLetters.subject, createdAt: s.officeLetters.createdAt, by: s.users.name }).from(s.officeLetters).leftJoin(s.users, eq(s.users.id, s.officeLetters.createdBy))
          .where(and(eq(s.officeLetters.tenantId, auth.tenantId), eq(s.officeLetters.contractId, c.id))).orderBy(desc(s.officeLetters.createdAt)),
        app.db.select({ id: s.salesBranches.id, name: s.salesBranches.name }).from(s.salesBranches).where(and(eq(s.salesBranches.tenantId, auth.tenantId), eq(s.salesBranches.active, true))).orderBy(asc(s.salesBranches.position)),
      ]);
      return {
        branchId: d.branchId, branchFromOpportunity: !query.filial && !!d.branchId, branches, vars: d.vars, varDefs: OFFICE_VARS, recipients: d.recipients, recipientPersonId: d.recipientPersonId ?? null, issued,
        // modelos da filial (ou de todas as filiais)
        templates: templates.filter((t) => !t.branchIds.length || (d.branchId && t.branchIds.includes(d.branchId))).map((t) => ({ ...t, usedVars: usedVars(t.blocks) })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/oficios/previa', summary: 'Prévia exata do ofício (não numera nem guarda)', ...CTR, params: IdParams,
    body: z.object({ blocks: Blocks, vars: Vars, branchId: z.string().uuid().nullable().default(null) }), bodyLimit: 2_000_000,
    handler: async ({ app, auth, params, body }) => {
      const c = await loadContract(app.db, auth, params.id);
      const d = await officeDefaults(app.db, auth.tenantId, c.id, todayIn(auth.timezone), { branchId: body.branchId });
      const art = await branchArt(app.db, auth.tenantId, d.branchId);
      const r = await renderOffice({ blocks: body.blocks as OfficeBlock[], vars: { ...body.vars, 'oficio.numero': d.vars['oficio.numero'] ?? '' }, ...art });
      return { pdf: r.pdf.toString('base64'), boxes: r.boxes, pages: r.pages };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/oficios', summary: 'Emite o ofício: número sequencial da filial no ano, PDF guardado e o texto como saiu', ...CTR, params: IdParams,
    body: z.object({ templateId: z.string().uuid().nullable().default(null), blocks: Blocks, vars: Vars, subject: z.string().trim().max(200).nullable().default(null), branchId: z.string().uuid().nullable().default(null) }), bodyLimit: 2_000_000,
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      const today = todayIn(auth.timezone);
      const d = await officeDefaults(app.db, auth.tenantId, c.id, today, { branchId: body.branchId });
      if (!d.branchId) throw unprocessable('Escolha a filial que emite o ofício (o fundo é o timbrado dela).', [{ path: 'branchId', message: 'Obrigatória' }]);
      const [tpl] = body.templateId ? await app.db.select({ version: s.officeTemplates.version }).from(s.officeTemplates).where(and(eq(s.officeTemplates.tenantId, auth.tenantId), eq(s.officeTemplates.id, body.templateId))).limit(1) : [];
      const year = Number(today.slice(0, 4));
      const branchId = d.branchId;
      const art = await branchArt(app.db, auth.tenantId, branchId);
      const letter = await app.db.transaction(async (tx) => {
        // reserva o número (a linha da sequência trava até o fim da transação: dois ofícios nunca saem com o mesmo número)
        await tx.insert(s.officeLetterSeq).values({ tenantId: auth.tenantId, branchId, year, nextNumber: 1 }).onConflictDoNothing();
        const [seq] = await tx.update(s.officeLetterSeq).set({ nextNumber: sql`${s.officeLetterSeq.nextNumber} + 1` }).where(and(eq(s.officeLetterSeq.branchId, branchId), eq(s.officeLetterSeq.year, year))).returning({ next: s.officeLetterSeq.nextNumber });
        const number = seq!.next - 1;
        const label = `${number}/${year}`;
        const vars = { ...body.vars, 'oficio.numero': label };
        const r = await renderOffice({ blocks: body.blocks as OfficeBlock[], vars, ...art });
        const [l] = await tx.insert(s.officeLetters).values({ tenantId: auth.tenantId, branchId, templateId: body.templateId, templateVersion: tpl?.version ?? null, opportunityId: d.opportunityId, contractId: c.id, year, number, label, subject: body.subject, vars, blocks: body.blocks as OfficeBlock[], pdf: r.pdf, sizeBytes: r.pdf.length, createdBy: auth.userId }).returning({ id: s.officeLetters.id, label: s.officeLetters.label });
        return l!;
      });
      await audit(app.db, req, { action: 'office.letter.issue', entityType: 'office_letter', entityId: letter.id, metadata: { label: letter.label, contractId: c.id, templateId: body.templateId } });
      reply.code(201);
      return letter;
    },
  }),
  defineRoute({
    method: 'GET', url: '/oficios/:id/pdf', summary: 'Baixa o ofício emitido', ...CTR, params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [l] = await app.db.select({ pdf: s.officeLetters.pdf, label: s.officeLetters.label, contractId: s.officeLetters.contractId }).from(s.officeLetters).where(and(eq(s.officeLetters.tenantId, auth.tenantId), eq(s.officeLetters.id, params.id))).limit(1);
      if (!l) throw notFound('Ofício não encontrado.');
      if (l.contractId) await loadContract(app.db, auth, l.contractId);
      const name = `Oficio-${l.label.replace('/', '-')}.pdf`;
      return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${name}"`).send(Buffer.from(l.pdf as unknown as Uint8Array));
    },
  }),
];
