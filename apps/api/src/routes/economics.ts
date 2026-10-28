/** Viabilidade econômica: parâmetros do motor, documentos fiscais por filial e o cálculo de cada oportunidade. */
import { and, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { ECON_MODES, econInputErrors, econSettingsErrors, fiscalDocErrors, TERMINAL_STAGES, type EconInput } from '@isp/domain';
import { FISCAL_KINDS, FISCAL_KIND_LABELS } from '@isp/shared';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { loadOpportunity } from '../services/opportunities';
import { computeEconomics, econSettingsOf, economicsContext, economicsHistory, fiscalDocsOf, saveEconomics } from '../services/economics';

const ADMIN = { module: 'configuracoes', min: 'total' } as const;
const bp = z.number().int().min(0).max(9_999);
const Tax = z.object({ name: z.string().trim().min(1).max(60), percentBp: z.number().int().min(0).max(10_000), fixedCents: z.number().int().min(0).max(100_000_000), active: z.boolean(), validFrom: z.string().date().nullable().optional(), validTo: z.string().date().nullable().optional() });
const Line = z.object({ description: z.string().trim().min(2).max(160), qtyMilli: z.number().int().min(1).max(1_000_000_000), unitCents: z.number().int().min(0).max(10_000_000_000) });
const EconBody = z.object({
  mode: z.enum(ECON_MODES), termMonths: z.number().int().min(1).max(240), receiveMonth: z.number().int().min(0).max(60),
  capex: z.array(Line).max(100), extraInitialCents: z.number().int().min(0).max(10_000_000_000), opex: z.array(Line).max(100),
  commissionBp: bp.nullable(), lossBp: bp.nullable(), marginTargetBp: bp.nullable(), priceCents: z.number().int().min(0).max(10_000_000_000).nullable(),
});

export const economicsRoutes = [
  // ------------------------------------------------------------------ parâmetros (Configurações → Viabilidade)
  defineRoute({
    method: 'GET', url: '/admin/viability/econ', summary: 'Parâmetros do motor financeiro: margem alvo, TMA, comissão, perda/glosa e payback máximo por segmento', tag: 'Viabilidade', ...ADMIN,
    handler: async ({ app, auth }) => econSettingsOf(app.db, auth.tenantId),
  }),
  defineRoute({
    method: 'PUT', url: '/admin/viability/econ', summary: 'Salva os parâmetros do motor financeiro (auditado)', tag: 'Viabilidade', ...ADMIN,
    body: z.object({ marginTargetBp: bp, tmaMonthlyBp: bp, commissionBp: bp, lossBp: bp, paybackMaxPrivate: z.number().int().min(1).max(120), paybackMaxPublic: z.number().int().min(1).max(120), blockOutsidePolicy: z.boolean() }),
    handler: async ({ app, auth, body, req }) => {
      const e = econSettingsErrors(body);
      if (e.length) throw unprocessable(e.join(' '));
      const before = await econSettingsOf(app.db, auth.tenantId);
      await app.db.insert(s.viabilitySettings).values({ tenantId: auth.tenantId, econ: body, updatedBy: auth.userId }).onConflictDoUpdate({ target: s.viabilitySettings.tenantId, set: { econ: body, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'viability.econ', entityType: 'viability', entityId: 'econ', metadata: { from: before, to: body } });
      return body;
    },
  }),

  // ------------------------------------------------------------------ documentos fiscais por filial (Configurações → Filiais)
  defineRoute({
    method: 'GET', url: '/admin/fiscal-docs', summary: 'Documentos fiscais de todas as filiais, com os tributos', tag: 'Configurações', ...ADMIN,
    handler: async ({ app, auth }) => ({ items: await fiscalDocsOf(app.db, auth.tenantId) }),
  }),
  defineRoute({
    method: 'PUT', url: '/admin/fiscal-docs/:id', summary: 'Salva os documentos fiscais de uma filial por tipo fiscal (venda, prestação de serviço, aluguel); o código é único no tipo fiscal da filial', tag: 'Configurações', ...ADMIN, params: IdParams,
    body: z.object({ items: z.array(z.object({ id: z.string().uuid().nullable(), fiscalKind: z.enum(FISCAL_KINDS), code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(80), active: z.boolean(), taxes: z.array(Tax).max(20) })).max(30) }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const [br] = await tx.select({ id: s.salesBranches.id, name: s.salesBranches.name, fiscalKinds: s.salesBranches.fiscalKinds }).from(s.salesBranches).where(and(eq(s.salesBranches.id, params.id), eq(s.salesBranches.tenantId, auth.tenantId))).limit(1);
      if (!br) throw notFound('Filial não encontrada.');
      const codes = body.items.map((i) => `${i.fiscalKind}|${i.code.toUpperCase()}`);
      if (new Set(codes).size !== codes.length) throw unprocessable('Há documentos com o mesmo código no mesmo tipo fiscal.');
      const notAllowed = br.fiscalKinds.length ? body.items.filter((i) => i.active && !br.fiscalKinds.includes(i.fiscalKind)) : [];
      if (notAllowed.length) throw unprocessable(`A filial ${br.name} não aceita ${[...new Set(notAllowed.map((i) => FISCAL_KIND_LABELS[i.fiscalKind]))].join(', ')}: libere o tipo fiscal na filial antes.`);
      for (const [i, d] of body.items.entries()) { const e = fiscalDocErrors(d); if (e.length) throw unprocessable(`Documento ${i + 1}: ${e.join(' ')}`); }
      const kept: string[] = [];
      for (const [position, d] of body.items.entries()) {
        const values = { fiscalKind: d.fiscalKind, code: d.code.toUpperCase(), name: d.name, active: d.active, taxes: d.taxes, position, updatedBy: auth.userId, updatedAt: new Date() };
        if (d.id) {
          const [u] = await tx.update(s.fiscalDocTypes).set(values).where(and(eq(s.fiscalDocTypes.id, d.id), eq(s.fiscalDocTypes.tenantId, auth.tenantId), eq(s.fiscalDocTypes.branchId, br.id))).returning({ id: s.fiscalDocTypes.id });
          if (!u) throw unprocessable('Documento não pertence a esta filial.');
          kept.push(u.id);
        } else {
          const [n] = await tx.insert(s.fiscalDocTypes).values({ tenantId: auth.tenantId, branchId: br.id, ...values }).returning({ id: s.fiscalDocTypes.id });
          kept.push(n!.id);
        }
      }
      // documento tirado da lista só é desativado: itens antigos continuam apontando para ele
      await tx.update(s.fiscalDocTypes).set({ active: false, updatedBy: auth.userId, updatedAt: new Date() })
        .where(and(eq(s.fiscalDocTypes.tenantId, auth.tenantId), eq(s.fiscalDocTypes.branchId, br.id), ...(kept.length ? [notInArray(s.fiscalDocTypes.id, kept)] : [])));
      await audit(tx, req, { action: 'fiscal_docs.update', entityType: 'sales_branch', entityId: br.id, metadata: { branch: br.name, items: body.items.map((d) => ({ fiscalKind: d.fiscalKind, code: d.code, active: d.active, taxes: d.taxes.map((t) => `${t.name} ${t.percentBp / 100}%${t.fixedCents ? ` + R$ ${t.fixedCents / 100}` : ''}${t.active ? '' : ' (inativo)'}`) })) } });
      return { items: await fiscalDocsOf(tx, auth.tenantId, br.id) };
    }),
  }),
  defineRoute({
    method: 'GET', url: '/fiscal-docs', summary: 'Documentos fiscais ativos (para escolher no item e no produto)', tag: 'Oportunidades', module: 'oportunidades',
    handler: async ({ app, auth }) => ({ items: (await fiscalDocsOf(app.db, auth.tenantId)).filter((d) => d.active) }),
  }),

  // ------------------------------------------------------------------ viabilidade econômica da oportunidade
  defineRoute({
    method: 'GET', url: '/opportunities/:id/economics', summary: 'Viabilidade econômica: entradas salvas, itens com tributos, parâmetros e o resultado calculado agora', tag: 'Oportunidades', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const ctx = await economicsContext(app.db, { ...opp, tenantId: auth.tenantId });
      return { ...ctx, result: computeEconomics(ctx), history: await economicsHistory(app.db, auth.tenantId, opp.id), editable: !TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number]) };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/opportunities/:id/economics', summary: 'Salva a viabilidade econômica (calcula no servidor e guarda a fotografia auditável)', tag: 'Oportunidades', module: 'oportunidades', params: IdParams,
    body: EconBody,
    handler: async ({ app, auth, params, body, req }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      if (TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number])) throw unprocessable('Oportunidade encerrada: a viabilidade fica como estava no fechamento.');
      const input = body as EconInput;
      const e = econInputErrors(input);
      if (e.length) throw unprocessable(e.join(' '));
      const result = await saveEconomics(app.db, { ...opp, tenantId: auth.tenantId }, input, auth.userId);
      await audit(app.db, req, { action: 'opportunity.economics', entityType: 'opportunity', entityId: opp.id, metadata: { verdict: result.verdict, priceCents: result.priceCents, minCents: result.floor.minCents, recommendedCents: result.recommendedCents, paybackMonths: result.kpi?.paybackMonths ?? null } });
      return { result, history: await economicsHistory(app.db, auth.tenantId, opp.id) };
    },
  }),
];
