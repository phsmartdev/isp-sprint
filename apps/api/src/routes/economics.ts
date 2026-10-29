/** Viabilidade econômica: parâmetros do motor, documentos fiscais por filial e o cálculo de cada oportunidade. */
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { ECON_MODES, econInputErrors, type EconResult, econSettingsErrors, fiscalDocErrors, TERMINAL_STAGES, type EconInput } from '@isp/domain';
import { FISCAL_KINDS, FISCAL_KIND_LABELS } from '@isp/shared';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { loadOpportunity, oppVisibility } from '../services/opportunities';
import { computeEconomics, costItemsOf, economicsRun, econSettingsHistory, econSettingsOf, econStatus, economicsContext, economicsHistory, fiscalDocsOf, isStale, pendingDecisions, recordFiscalDocVersion, resolveCostLines, saveEconomics, today, type EconContext } from '../services/economics';
import { requireAction } from '../services/modules';
import { buildEconCsv, buildEconPdf } from '../services/economicsExport';

const ADMIN = { module: 'configuracoes', min: 'total' } as const;
const RunParams = z.object({ id: z.string().uuid(), runId: z.union([z.literal('ultimo'), z.string().uuid()]) });
const bp = z.number().int().min(0).max(9_999);
const Tax = z.object({ name: z.string().trim().min(1).max(60), percentBp: z.number().int().min(0).max(10_000), fixedCents: z.number().int().min(0).max(100_000_000), active: z.boolean(), validFrom: z.string().date().nullable().optional(), validTo: z.string().date().nullable().optional() });
const Line = z.object({ description: z.string().trim().min(2).max(160), qtyMilli: z.number().int().min(1).max(1_000_000_000), unitCents: z.number().int().min(0).max(10_000_000_000), unit: z.string().trim().max(12).nullable().optional(), costItemId: z.string().uuid().nullable().optional(), priceId: z.string().uuid().nullable().optional(), manual: z.boolean().optional() });
const EconBody = z.object({
  mode: z.enum(ECON_MODES), termMonths: z.number().int().min(1).max(240), receiveMonth: z.number().int().min(0).max(60),
  capex: z.array(Line).max(300), extraInitialCents: z.number().int().min(0).max(10_000_000_000), opex: z.array(Line).max(300),
  commissionBp: bp.nullable(), lossBp: bp.nullable(), marginTargetBp: bp.nullable(), priceCents: z.number().int().min(0).max(10_000_000_000).nullable(),
});

export const economicsRoutes = [
  // ------------------------------------------------------------------ parâmetros (Configurações → Viabilidade)
  defineRoute({
    method: 'GET', url: '/admin/viability/econ', summary: 'Parâmetros do motor financeiro: versão vigente e histórico de versões com vigência', tag: 'Viabilidade', ...ADMIN,
    handler: async ({ app, auth }) => {
      const cur = await econSettingsOf(app.db, auth.tenantId);
      return { current: cur ? { id: cur.id, validFrom: cur.validFrom, ...cur.settings } : null, versions: await econSettingsHistory(app.db, auth.tenantId), today: today() };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/viability/econ', summary: 'Publica uma versão dos parâmetros com data de vigência (hoje ou futura; versões anteriores ficam no histórico)', tag: 'Viabilidade', ...ADMIN,
    body: z.object({
      marginTargetBp: bp, tmaMonthlyBp: bp, commissionBp: bp, lossPrivateBp: bp, lossPublicBp: bp, contingencyCapexBp: bp, contingencyOpexBp: bp, overheadBp: bp, incomeTaxBp: bp,
      paybackMaxPrivate: z.number().int().min(1).max(120), paybackMaxPublic: z.number().int().min(1).max(120), blockOutsidePolicy: z.boolean(),
      validFrom: z.string().date(),
    }),
    handler: async ({ app, auth, body, req, reply }) => {
      const { validFrom, ...values } = body;
      const e = econSettingsErrors(values);
      if (e.length) throw unprocessable(e.join(' '));
      if (validFrom < today()) throw unprocessable('A vigência começa hoje ou numa data futura: cálculos já salvos não mudam de regra.');
      const before = await econSettingsOf(app.db, auth.tenantId);
      const [v] = await app.db.insert(s.econSettingsVersions).values({ tenantId: auth.tenantId, values, validFrom, createdBy: auth.userId }).returning({ id: s.econSettingsVersions.id });
      await audit(app.db, req, { action: 'viability.econ', entityType: 'viability', entityId: v!.id, metadata: { validFrom, from: before?.settings ?? null, to: values } });
      reply.code(201);
      return { id: v!.id, validFrom, ...values };
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
          await recordFiscalDocVersion(tx, auth.tenantId, u.id, d.taxes, auth.userId);
        } else {
          const [n] = await tx.insert(s.fiscalDocTypes).values({ tenantId: auth.tenantId, branchId: br.id, ...values }).returning({ id: s.fiscalDocTypes.id });
          kept.push(n!.id);
          await recordFiscalDocVersion(tx, auth.tenantId, n!.id, d.taxes, auth.userId);
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

  // ------------------------------------------------------------------ catálogo de custos (Configurações → Viabilidade)
  defineRoute({
    method: 'GET', url: '/admin/cost-items', summary: 'Catálogo de custos: itens de investimento e mensais, preço vigente e histórico de preços', tag: 'Viabilidade', ...ADMIN,
    handler: async ({ app, auth }) => {
      const items = await costItemsOf(app.db, auth.tenantId);
      const prices = items.length ? await app.db.select({ id: s.costItemPrices.id, itemId: s.costItemPrices.itemId, unitCents: s.costItemPrices.unitCents, validFrom: s.costItemPrices.validFrom, createdAt: s.costItemPrices.createdAt, createdByName: s.users.name })
        .from(s.costItemPrices).leftJoin(s.users, eq(s.users.id, s.costItemPrices.createdBy)).where(eq(s.costItemPrices.tenantId, auth.tenantId)).orderBy(desc(s.costItemPrices.validFrom), desc(s.costItemPrices.createdAt)) : [];
      return { items: items.map((i) => ({ ...i, prices: prices.filter((p) => p.itemId === i.id).slice(0, 20) })), today: today() };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/cost-items', summary: 'Salva os itens do catálogo de custos (incluir, renomear, desativar); o preço tem rota própria com vigência', tag: 'Viabilidade', ...ADMIN,
    body: z.object({ items: z.array(z.object({ id: z.string().uuid().nullable(), name: z.string().trim().min(2).max(120), kind: z.enum(['investimento', 'mensal']), unit: z.string().trim().min(1).max(12), active: z.boolean() })).max(500) }),
    handler: async ({ app, auth, body, req }) => app.db.transaction(async (tx) => {
      const keys = body.items.map((i) => `${i.kind}|${i.name.toLowerCase()}`);
      if (new Set(keys).size !== keys.length) throw unprocessable('Há itens com o mesmo nome no mesmo tipo.');
      for (const it of body.items) {
        const v = { name: it.name, kind: it.kind, unit: it.unit, active: it.active, updatedAt: new Date() };
        if (it.id) await tx.update(s.costItems).set(v).where(and(eq(s.costItems.id, it.id), eq(s.costItems.tenantId, auth.tenantId)));
        else await tx.insert(s.costItems).values({ tenantId: auth.tenantId, ...v });
      }
      await audit(tx, req, { action: 'cost_items.update', entityType: 'tenant', entityId: auth.tenantId, metadata: { items: body.items.map((i) => `${i.name} (${i.kind}${i.active ? '' : ', inativo'})`) } });
      return { items: await costItemsOf(tx, auth.tenantId) };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/admin/cost-items/:id/prices', summary: 'Publica o preço de custo de um item com data de vigência (hoje ou futura); os anteriores ficam no histórico', tag: 'Viabilidade', ...ADMIN, params: IdParams,
    body: z.object({ unitCents: z.number().int().min(0).max(10_000_000_000), validFrom: z.string().date() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const [it] = await app.db.select({ id: s.costItems.id, name: s.costItems.name }).from(s.costItems).where(and(eq(s.costItems.id, params.id), eq(s.costItems.tenantId, auth.tenantId))).limit(1);
      if (!it) throw notFound('Item do catálogo não encontrado.');
      if (body.validFrom < today()) throw unprocessable('A vigência começa hoje ou numa data futura: cálculos já salvos não mudam de preço.');
      const [p] = await app.db.insert(s.costItemPrices).values({ tenantId: auth.tenantId, itemId: it.id, unitCents: body.unitCents, validFrom: body.validFrom, createdBy: auth.userId }).returning({ id: s.costItemPrices.id });
      await audit(app.db, req, { action: 'cost_items.price', entityType: 'cost_item', entityId: it.id, metadata: { name: it.name, unitCents: body.unitCents, validFrom: body.validFrom } });
      reply.code(201);
      return { id: p!.id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/cost-items', summary: 'Catálogo de custos ativo com o preço vigente (para lançar na viabilidade)', tag: 'Oportunidades', module: 'oportunidades',
    handler: async ({ app, auth }) => ({ items: (await costItemsOf(app.db, auth.tenantId)).filter((i) => i.active) }),
  }),

  // ------------------------------------------------------------------ viabilidade econômica da oportunidade
  defineRoute({
    method: 'GET', url: '/opportunities/:id/economics', summary: 'Viabilidade econômica: entradas e resultado SALVOS (consultar não recalcula), situação da decisão e histórico', tag: 'Oportunidades', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const ctx = await economicsContext(app.db, { ...opp, tenantId: auth.tenantId });
      const { savedResult, ...rest } = ctx;
      // "stale" só avisa que itens, tributos, parâmetros ou o motor mudaram desde o salvo; nada é gravado
      const stale = savedResult ? isStale(savedResult, computeEconomics(ctx)) : false;
      const [history, st] = await Promise.all([economicsHistory(app.db, auth.tenantId, opp.id), econStatus(app.db, auth.tenantId, opp.id)]);
      const open = !TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number]);
      const decision = { status: st.status, decisions: st.decisions.map(({ actorId: _a, ...d }) => d), canDecide: st.status === 'em_decisao' && auth.actions.aprovar_viabilidade && st.submittedBy !== auth.userId };
      if (!auth.actions.ver_financeiro) {
        // sem "ver financeiro": só o veredito; nada de custos, fluxo, TIR, payback, pesos ou taxas
        return { financeHidden: true, publicSector: ctx.publicSector, saved: ctx.saved, stale, editable: false, history, input: null, items: [], settings: null, settingsVersion: null, branchDocs: [], ...decision, canDecide: false,
          result: savedResult ? { verdict: savedResult.verdict, mode: savedResult.mode, withReservations: savedResult.withReservations, withinPolicy: savedResult.withinPolicy } : null };
      }
      return { ...rest, financeHidden: false, result: savedResult, stale, history, editable: open, ...decision };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/opportunities/:id/economics', summary: 'Salva a viabilidade econômica (calcula no servidor com os parâmetros vigentes e guarda a fotografia auditável)', tag: 'Oportunidades', module: 'oportunidades', params: IdParams,
    body: EconBody,
    handler: async ({ app, auth, params, body, req }) => {
      requireAction(auth, 'ver_financeiro', 'A viabilidade econômica é preenchida por quem vê valores financeiros.');
      const opp = await loadOpportunity(app.db, auth, params.id);
      if (TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number])) throw unprocessable('Oportunidade encerrada: a viabilidade fica como estava no fechamento.');
      const input = await resolveCostLines(app.db, auth.tenantId, body as EconInput);
      const e = econInputErrors(input);
      if (e.length) throw unprocessable(e.join(' '));
      const result = await saveEconomics(app.db, { ...opp, tenantId: auth.tenantId }, input, auth.userId);
      if (!result) throw unprocessable(NO_SETTINGS);
      await audit(app.db, req, { action: 'opportunity.economics', entityType: 'opportunity', entityId: opp.id, metadata: { verdict: result.verdict, priceCents: result.priceCents, minCents: result.floor.minCents, recommendedCents: result.recommendedCents, paybackMonths: result.kpi?.paybackMonths ?? null, engine: result.engineVersion } });
      return { result, history: await economicsHistory(app.db, auth.tenantId, opp.id) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/opportunities/:id/economics/runs/:runId', summary: 'Um cálculo salvo exatamente como foi gravado (sem recalcular), com a conferência do hash; runId "ultimo" = o mais recente', tag: 'Oportunidades', module: 'oportunidades', params: RunParams,
    handler: async ({ app, auth, params }) => {
      requireAction(auth, 'ver_financeiro', 'O cálculo mostra valores financeiros que seu perfil não vê.');
      const opp = await loadOpportunity(app.db, auth, params.id);
      const run = await economicsRun(app.db, auth.tenantId, opp.id, params.runId);
      if (!run) throw notFound('Cálculo não encontrado.');
      return run;
    },
  }),
  defineRoute({
    method: 'GET', url: '/opportunities/:id/economics/runs/:runId/export', summary: 'Exporta um cálculo salvo em CSV ou PDF (DRE, indicadores, custos, tributos, fluxo de caixa, hash); nada é recalculado', tag: 'Oportunidades', module: 'oportunidades', params: RunParams,
    query: z.object({ format: z.enum(['csv', 'pdf']).default('pdf') }),
    handler: async ({ app, auth, params, query, reply, req }) => {
      requireAction(auth, 'exportar');
      requireAction(auth, 'ver_financeiro', 'A exportação traz valores financeiros que seu perfil não vê.');
      const opp = await loadOpportunity(app.db, auth, params.id);
      const run = await economicsRun(app.db, auth.tenantId, opp.id, params.runId);
      if (!run) throw notFound('Cálculo não encontrado.');
      const [acc] = await app.db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, opp.contactId)).limit(1);
      const h = { code: opp.code, title: opp.title ?? '', account: acc?.name ?? '' };
      const name = `viabilidade-OP-${opp.code}-${run.createdAt.toISOString().slice(0, 10)}`;
      await audit(app.db, req, { action: 'opportunity.economics_export', entityType: 'opportunity', entityId: opp.id, metadata: { runId: run.id, format: query.format } });
      if (query.format === 'csv') return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`).send(buildEconCsv(run, h));
      return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${name}.pdf"`).send(await buildEconPdf(run, h));
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/economics/submit', summary: 'Envia a viabilidade salva para decisão da gestão (exige cálculo atualizado e 100% dos tributos parametrizados na filial)', tag: 'Oportunidades', module: 'oportunidades', params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      requireAction(auth, 'ver_financeiro', 'A viabilidade econômica é enviada por quem vê valores financeiros.');
      const opp = await loadOpportunity(app.db, auth, params.id);
      if (TERMINAL_STAGES.includes(opp.stage as (typeof TERMINAL_STAGES)[number])) throw unprocessable('Oportunidade encerrada.');
      const ctx = await economicsContext(app.db, { ...opp, tenantId: auth.tenantId });
      if (!ctx.savedResult) throw unprocessable('Salve a viabilidade econômica antes de enviar.');
      assertDecidable(ctx);
      const st = await econStatus(app.db, auth.tenantId, opp.id);
      if (st.status === 'em_decisao') throw unprocessable('Esta viabilidade já está em decisão.');
      if (st.status === 'aprovada') throw unprocessable('Esta viabilidade já foi aprovada. Para mudar, salve de novo e envie a nova versão.');
      await app.db.insert(s.opportunityEconDecisions).values({ tenantId: auth.tenantId, opportunityId: opp.id, snapshotId: st.snapshotId!, action: 'enviada', actorId: auth.userId });
      await audit(app.db, req, { action: 'opportunity.economics_submit', entityType: 'opportunity', entityId: opp.id, metadata: { snapshotId: st.snapshotId, verdict: ctx.savedResult.verdict } });
      return econStatus(app.db, auth.tenantId, opp.id).then((x) => ({ status: x.status }));
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/economics/decision', summary: 'Aprova ou devolve (com motivo) a viabilidade em decisão — gestão e diretoria; ninguém decide o que enviou', tag: 'Oportunidades', module: 'oportunidades', params: IdParams,
    body: z.object({ decision: z.enum(['aprovar', 'devolver']), reason: z.string().trim().max(1000).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      requireAction(auth, 'aprovar_viabilidade', 'Aprovar a viabilidade econômica é da gestão e da diretoria.');
      requireAction(auth, 'ver_financeiro', 'Para decidir a viabilidade é preciso ver os valores financeiros.');
      const opp = await loadOpportunity(app.db, auth, params.id);
      const st = await econStatus(app.db, auth.tenantId, opp.id);
      if (st.status !== 'em_decisao') throw unprocessable('Não há viabilidade aguardando decisão nesta oportunidade.');
      if (st.submittedBy === auth.userId) throw forbidden('Quem enviou a viabilidade não pode decidir sobre ela.');
      if (body.decision === 'devolver' && (body.reason ?? '').length < 5) throw unprocessable('Diga o motivo da devolução.', [{ path: 'reason', message: 'Motivo obrigatório' }]);
      if (body.decision === 'aprovar') assertDecidable(await economicsContext(app.db, { ...opp, tenantId: auth.tenantId }));
      await app.db.insert(s.opportunityEconDecisions).values({ tenantId: auth.tenantId, opportunityId: opp.id, snapshotId: st.snapshotId!, action: body.decision === 'aprovar' ? 'aprovada' : 'devolvida', reason: body.reason || null, actorId: auth.userId });
      await audit(app.db, req, { action: body.decision === 'aprovar' ? 'opportunity.economics_approve' : 'opportunity.economics_return', entityType: 'opportunity', entityId: opp.id, metadata: { snapshotId: st.snapshotId, reason: body.reason ?? null } });
      return econStatus(app.db, auth.tenantId, opp.id).then((x) => ({ status: x.status }));
    },
  }),
  defineRoute({
    method: 'GET', url: '/economics/pending', summary: 'Viabilidades aguardando decisão, nas oportunidades que você enxerga (gestão e diretoria)', tag: 'Oportunidades', module: 'oportunidades',
    handler: async ({ app, auth }) => {
      if (!auth.actions.aprovar_viabilidade || !auth.actions.ver_financeiro) return { items: [] };
      const sent = await app.db.selectDistinct({ id: s.opportunityEconDecisions.opportunityId }).from(s.opportunityEconDecisions).where(and(eq(s.opportunityEconDecisions.tenantId, auth.tenantId), eq(s.opportunityEconDecisions.action, 'enviada')));
      if (!sent.length) return { items: [] };
      const opps = await app.db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, account: s.contacts.name, result: s.opportunityEconomics.result })
        .from(s.opportunities).innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId)).innerJoin(s.opportunityEconomics, eq(s.opportunityEconomics.opportunityId, s.opportunities.id))
        .where(and(oppVisibility(auth), inArray(s.opportunities.id, sent.map((x) => x.id))));
      const pend = await pendingDecisions(app.db, auth.tenantId, opps.map((o) => o.id));
      return { items: pend.map((p) => { const o = opps.find((x) => x.id === p.opportunityId)!; const r = o.result as unknown as EconResult; return { ...p, code: o.code, title: o.title, account: o.account, verdict: r.verdict, priceCents: r.priceCents, mode: r.mode, paybackMonths: r.kpi?.paybackMonths ?? null, marginPct: r.kpi?.marginPct ?? null, mine: p.submittedBy === auth.userId }; }) };
    },
  }),
];

const NO_SETTINGS = 'A empresa ainda não informou os parâmetros da viabilidade (margem mínima, TMA, glosa, payback…). Quem administra preenche em Configurações → Viabilidade.';

/** Decisão (enviar ou aprovar) só com cálculo atualizado e 100% dos tributos parametrizados na filial. */
function assertDecidable(ctx: EconContext) {
  const fresh = computeEconomics(ctx);
  if (!fresh) throw unprocessable(NO_SETTINGS);
  if (isStale(ctx.savedResult!, fresh)) throw unprocessable('A viabilidade mudou desde que foi salva (produtos, tributos ou parâmetros). Abra a aba Viabilidade econômica, confira e salve de novo.');
  if (fresh.withReservations) throw unprocessable('Todos os produtos precisam de documento fiscal com tributos vigentes cadastrados na filial (Configurações → Filiais e documentos fiscais).');
}
