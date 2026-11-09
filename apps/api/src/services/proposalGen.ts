/**
 * Geração da proposta (PDF) usada pela tela e pela entrada na etapa Proposta: número PC AAMMDD da oportunidade,
 * modelo com seções automáticas, anexo "PC AAMMDD - Nome da Conta.pdf" e as escolhas guardadas para editar e regerar.
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeSections, proposalTitle, validityDate } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';
import { ensureProposalNumber } from './proposalNumber';
import { buildProposalPdf, systemValues } from './proposals';
import { todayIn } from './vacations';

const Photo = z.object({ data: z.string().max(1_400_000), mime: z.enum(['image/jpeg', 'image/png']) });
export const GenBody = z.object({
  templateId: z.string().uuid(), values: z.record(z.string(), z.string().max(2000)).default({}),
  services: z.object({ text: z.string().max(6000).default(''), photos: z.array(Photo).max(8).default([]) }).default({ text: '', photos: [] }),
  validityDays: z.number().int().min(1).max(365).optional(),
});
export type GenInput = z.infer<typeof GenBody>;
type Who = { tenantId: string; userId: string; timezone: string };
type Tpl = typeof s.proposalTemplates.$inferSelect;

/** Variáveis + seções automáticas (serviços, itens da aba Produto, validade) e o PDF. */
export async function renderProposal(db: DbOrTx, who: Who, oppId: string, t: Tpl, body: GenInput) {
  const cfg = normalizeSections(t.sections);
  const days = body.validityDays ?? cfg.validityDays;
  const today = todayIn(who.timezone);
  const custom = Object.fromEntries(t.variables.map((v) => [v.key, body.values[v.key] ?? v.default]));
  const vars = { ...(await systemValues(db, who.tenantId, oppId, who.timezone)), 'proposta.validade_dias': String(days), 'proposta.validade_data': validityDate(today, days).split('-').reverse().join('/'), ...custom };
  const items = await db.select().from(s.opportunityItems).where(eq(s.opportunityItems.opportunityId, oppId)).orderBy(asc(s.opportunityItems.position));
  const photos = body.services.photos.map((p) => ({ data: Buffer.from(p.data, 'base64'), mime: p.mime }));
  for (const ph of photos) {
    const ok = ph.mime === 'image/png' ? ph.data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) : ph.data[0] === 0xff && ph.data[1] === 0xd8;
    if (!ok) throw unprocessable('Foto inválida: envie JPG ou PNG.');
  }
  return buildProposalPdf(db, who.tenantId, t.id, vars, { servicesText: body.services.text, photos, items: items.map((i) => ({ description: i.description, unit: i.unit, qtyMilli: Number(i.qtyMilli), unitCents: Number(i.unitCents), discountCents: Number(i.discountCents), surchargeCents: Number(i.surchargeCents) })) });
}

/**
 * Gera e anexa. `bump: false` quando roda dentro da mudança de etapa (a própria mudança confere e sobe a versão da linha).
 * Retorna null quando o modelo não tem páginas.
 */
export async function generateProposal(tx: DbOrTx, who: Who, opp: { id: string; contactName: string; proposalStatus: string; rowVersion: number }, t: Tpl, body: GenInput, opts: { bump: boolean; automatic?: boolean }) {
  const number = await ensureProposalNumber(tx, who.tenantId, opp.id, todayIn(who.timezone));
  const out = await renderProposal(tx, who, opp.id, t, body);
  if (!out) return null;
  const filename = `${proposalTitle(number, opp.contactName)}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 150);
  const [r] = await tx.insert(s.opportunityAttachments).values({ tenantId: who.tenantId, opportunityId: opp.id, kind: 'proposta', filename, mime: 'application/pdf', sizeBytes: out.pdf.length, sha256: createHash('sha256').update(out.pdf).digest('hex'), data: out.pdf, uploadedBy: who.userId })
    .returning({ id: s.opportunityAttachments.id, filename: s.opportunityAttachments.filename, sizeBytes: s.opportunityAttachments.sizeBytes });
  if (opp.proposalStatus === 'nao_criada') await tx.update(s.opportunities).set({ proposalStatus: 'rascunho', updatedAt: new Date(), ...(opts.bump ? { rowVersion: sql`${s.opportunities.rowVersion} + 1` } : {}) }).where(eq(s.opportunities.id, opp.id));
  await tx.insert(s.opportunityEvents).values({ tenantId: who.tenantId, opportunityId: opp.id, type: 'attachment_added', actorId: who.userId, payload: { filename: r!.filename, kind: 'proposta', sizeBytes: out.pdf.length, template: t.name, automatic: !!opts.automatic }, rowVersion: opp.rowVersion });
  const draft = { templateId: t.id, values: body.values, servicesText: body.services.text, photos: body.services.photos, validityDays: body.validityDays ?? null, updatedBy: who.userId, updatedAt: new Date() };
  await tx.insert(s.proposalDrafts).values({ tenantId: who.tenantId, opportunityId: opp.id, ...draft }).onConflictDoUpdate({ target: s.proposalDrafts.opportunityId, set: draft });
  return { ...r!, number, template: t.name };
}

/** Modelo padrão da filial da oportunidade (ativo, de proposta, com páginas). */
async function branchDefaultOnly(db: DbOrTx, tenantId: string, branchId: string | null) {
  if (!branchId) return null;
  const [b] = await db.select({ t: s.salesBranches.defaultProposalTemplateId }).from(s.salesBranches).where(and(eq(s.salesBranches.id, branchId), eq(s.salesBranches.tenantId, tenantId)));
  if (!b?.t) return null;
  const [t] = await db.select().from(s.proposalTemplates).where(and(eq(s.proposalTemplates.id, b.t), eq(s.proposalTemplates.tenantId, tenantId), eq(s.proposalTemplates.active, true), eq(s.proposalTemplates.purpose, 'proposta')));
  return t ?? null;
}

export async function hasProposal(db: DbOrTx, tenantId: string, oppId: string) {
  const [a] = await db.select({ id: s.opportunityAttachments.id }).from(s.opportunityAttachments).where(and(eq(s.opportunityAttachments.tenantId, tenantId), eq(s.opportunityAttachments.opportunityId, oppId), eq(s.opportunityAttachments.kind, 'proposta'), isNull(s.opportunityAttachments.deletedAt))).limit(1);
  return !!a;
}

/** Etapa de proposta: chave "proposta" ou nome "Proposta". */
export const isProposalStage = (st: { key: string; name: string }) => st.key === 'proposta' || st.name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'proposta';

/**
 * Modelo usado na geração automática ao entrar em Proposta: o padrão da filial da oportunidade;
 * sem filial ou sem padrão na filial, o único modelo de proposta ativo da empresa (com mais de um, não adivinha).
 */
export async function branchDefaultTemplate(db: DbOrTx, tenantId: string, branchId: string | null) {
  const own = await branchDefaultOnly(db, tenantId, branchId);
  if (own) return own;
  const all = await db.select().from(s.proposalTemplates).where(and(eq(s.proposalTemplates.tenantId, tenantId), eq(s.proposalTemplates.active, true), eq(s.proposalTemplates.purpose, 'proposta'))).limit(2);
  return all.length === 1 ? all[0]! : null;
}
