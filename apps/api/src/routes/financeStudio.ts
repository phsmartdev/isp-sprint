/**
 * Financial Studio (Motor Financeiro → Financial Studio): catálogo das fórmulas reais do motor, simulação de impacto
 * e versionamento com governança (rascunho → simulada → em validação → validada → aprovada → publicada; ou devolvida).
 * Editar e simular: quem administra as configurações e vê valores financeiros. Aprovar e publicar: quem aprova a
 * viabilidade (gestão/diretoria), nunca quem criou a versão.
 */
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildModel, finFormulaRefs, FIN_CATEGORIES, FIN_CATEGORY_LABELS, FIN_FORMULAS, FIN_VARIABLES, FORMULA_FUNCTIONS, isValidFormulaCode, parseFinFormula, printFinFormula,
  validateModel, type FinModel, type FinOverride, type FinUnit,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { loadOpportunity, oppVisibility } from '../services/opportunities';
import { requireAction } from '../services/modules';
import { economicsContext, today } from '../services/economics';
import { catalogOf, customDefs, modelFor, nextVersion, simulateOn, type PublishedFormula } from '../services/financeStudio';

const ADMIN = { module: 'configuracoes', min: 'total' } as const;
const UNITS = ['R$', '%', 'meses', 'mês', 'sim/não', 'fator'] as const;
const Change = z.object({ code: z.string().trim().min(2).max(48), expression: z.string().trim().min(1).max(4000), name: z.string().trim().max(80).optional(), category: z.enum(FIN_CATEGORIES).optional(), unit: z.enum(UNITS).optional() });
const EDITABLE = ['rascunho', 'simulada', 'devolvida'];
const STATUS_LABELS: Record<string, string> = { rascunho: 'Rascunho', simulada: 'Simulada', em_validacao: 'Em validação', validada: 'Validada', aprovada: 'Aprovada', publicada: 'Publicada', devolvida: 'Devolvida' };

const canEdit = (auth: AuthContext) => auth.actions.ver_financeiro;
const canApprove = (auth: AuthContext) => auth.actions.aprovar_viabilidade && auth.actions.ver_financeiro;
function requireEditor(auth: AuthContext) { requireAction(auth, 'ver_financeiro', 'O Financial Studio mostra valores financeiros que seu perfil não vê.'); }

/** Modelo candidato: o vigente com as alterações (sintaxe conferida; erros voltam com o código da fórmula). */
function candidateOf(published: PublishedFormula[], customs: { code: string; name: string; category: string; unit: string; description: string | null }[], changes: FinOverride[]) {
  const byCode = new Map<string, FinOverride>(published.map((p) => [p.code, p]));
  for (const c of changes) {
    const prev = byCode.get(c.code);
    const def = customs.find((x) => x.code === c.code);
    byCode.set(c.code, { ...prev, ...(def ? { name: def.name, category: def.category as FinOverride['category'], unit: def.unit as FinUnit, desc: def.description ?? '' } : {}), ...c, version: null, versionId: null });
  }
  return buildModel([...byCode.values()]);
}
function modelIssues(model: FinModel, changed: string[]) {
  return validateModel(model).filter((i) => i.level === 'erro' || changed.includes(i.code));
}

async function versionOr404(db: DbOrTx, tenantId: string, id: string) {
  const [v] = await db.select().from(s.financialFormulaVersions).where(and(eq(s.financialFormulaVersions.id, id), eq(s.financialFormulaVersions.tenantId, tenantId))).limit(1);
  if (!v) throw notFound('Versão da fórmula não encontrada.');
  return v;
}
async function logEvent(db: DbOrTx, auth: AuthContext, v: { id: string; code: string }, action: string, note: string | null = null) {
  await db.insert(s.financialFormulaEvents).values({ tenantId: auth.tenantId, versionId: v.id, code: v.code, action, note, actorId: auth.userId });
}
const knownCode = async (db: DbOrTx, tenantId: string, code: string) => FIN_FORMULAS.some((f) => f.code === code) || (await customDefs(db, tenantId)).some((c) => c.code === code);

/** Simulação na oportunidade escolhida e um resumo na carteira (viabilidades salvas, até 200). */
async function simulate(db: DbOrTx, auth: AuthContext, changes: FinOverride[], opportunityId: string | null, focus: string | null, portfolio: boolean) {
  const { model: current, overrides } = await modelFor(db, auth.tenantId);
  const customs = await customDefs(db, auth.tenantId);
  let candidate: FinModel;
  try { candidate = candidateOf(overrides, customs, changes); } catch (e) { return { issues: [{ code: changes[0]?.code ?? '', message: (e as Error).message, level: 'erro' as const }] }; }
  const changed = changes.map((c) => c.code);
  const issues = modelIssues(candidate, changed);
  if (issues.some((i) => i.level === 'erro')) return { issues };
  let focusResult: ReturnType<typeof simulateOn> | null = null;
  if (opportunityId) {
    const opp = await loadOpportunity(db, auth, opportunityId);
    const ctx = await economicsContext(db, { ...opp, tenantId: auth.tenantId });
    if (!ctx.settings) throw unprocessable('Sem parâmetros vigentes em Configurações → Viabilidade: não há como calcular.');
    focusResult = simulateOn(ctx, current, candidate, changed, focus);
  }
  type BookItem = { id: string; code: number; title: string | null; before: string; after: string; autoBefore: boolean; autoAfter: boolean; npvBefore: number | null; npvAfter: number | null };
  let book: null | { total: number; verdictChanged: number; autoChanged: number; items: BookItem[] } = null;
  if (portfolio) {
    const rows = await db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, ownerId: s.opportunities.ownerId, contactId: s.opportunities.contactId, branchId: s.opportunities.branchId, saleKind: s.opportunities.saleKind })
      .from(s.opportunityEconomics).innerJoin(s.opportunities, eq(s.opportunities.id, s.opportunityEconomics.opportunityId)).innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
      .where(and(eq(s.opportunityEconomics.tenantId, auth.tenantId), oppVisibility(auth))).orderBy(desc(s.opportunityEconomics.updatedAt)).limit(200);
    const items: BookItem[] = [];
    for (const o of rows) {
      const ctx = await economicsContext(db, { ...o, tenantId: auth.tenantId });
      if (!ctx.settings) continue;
      const r = simulateOn(ctx, current, candidate, changed, null);
      items.push({ id: o.id, code: o.code, title: o.title, before: r.viability.before.verdict, after: r.viability.after.verdict, autoBefore: r.viability.before.autoApproval, autoAfter: r.viability.after.autoApproval, npvBefore: r.viability.before.npvCents, npvAfter: r.viability.after.npvCents });
    }
    book = { total: items.length, verdictChanged: items.filter((i) => i.before !== i.after).length, autoChanged: items.filter((i) => i.autoBefore !== i.autoAfter).length, items: items.filter((i) => i.before !== i.after || i.autoBefore !== i.autoAfter).slice(0, 30) };
  }
  return { issues, changed, affected: focusResult?.affected ?? [], result: focusResult, portfolio: book, models: { current: current.key, candidate: candidate.key } };
}

export const financeStudioRoutes = [
  defineRoute({
    method: 'GET', url: '/finance-studio/catalog', summary: 'Catálogo do Financial Studio: fórmulas reais do motor (vigentes e padrão), variáveis com origem, funções, dependências e versões em andamento', tag: 'Financial Studio', ...ADMIN,
    handler: async ({ app, auth }) => {
      requireEditor(auth);
      const { model, overrides } = await modelFor(app.db, auth.tenantId);
      const open = await app.db.select({ id: s.financialFormulaVersions.id, code: s.financialFormulaVersions.code, version: s.financialFormulaVersions.version, status: s.financialFormulaVersions.status })
        .from(s.financialFormulaVersions).where(and(eq(s.financialFormulaVersions.tenantId, auth.tenantId), sql`${s.financialFormulaVersions.status} <> 'publicada'`));
      return {
        formulas: catalogOf(model, overrides), variables: FIN_VARIABLES, categories: FIN_CATEGORIES.map((k) => ({ key: k, label: FIN_CATEGORY_LABELS[k] })),
        functions: Object.entries(FORMULA_FUNCTIONS).map(([name, f]) => ({ name, ...f })), open, modelKey: model.key,
        can: { edit: canEdit(auth), approve: canApprove(auth) }, statusLabels: STATUS_LABELS,
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/finance-studio/opportunities', summary: 'Oportunidades com viabilidade salva para simular (as que você enxerga)', tag: 'Financial Studio', ...ADMIN,
    query: z.object({ q: z.string().trim().max(80).optional() }),
    handler: async ({ app, auth, query }) => {
      requireEditor(auth);
      const term = query.q ? `%${query.q}%` : null;
      const rows = await app.db.select({ id: s.opportunities.id, code: s.opportunities.code, title: s.opportunities.title, account: s.contacts.name, result: s.opportunityEconomics.result, updatedAt: s.opportunityEconomics.updatedAt })
        .from(s.opportunityEconomics).innerJoin(s.opportunities, eq(s.opportunities.id, s.opportunityEconomics.opportunityId)).innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
        .where(and(eq(s.opportunityEconomics.tenantId, auth.tenantId), oppVisibility(auth), term ? or(ilike(s.opportunities.title, term), ilike(s.contacts.name, term), sql`${s.opportunities.code}::text = ${query.q}`) : undefined))
        .orderBy(desc(s.opportunityEconomics.updatedAt)).limit(30);
      return { items: rows.map(({ result, ...r }) => ({ ...r, verdict: (result as { verdict?: string } | null)?.verdict ?? null })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/finance-studio/simulate', summary: 'Simula alterações de fórmulas: resultado anterior e novo, diferença absoluta e percentual, indicadores impactados e efeito na viabilidade (nada é gravado)', tag: 'Financial Studio', ...ADMIN,
    body: z.object({ changes: z.array(Change).max(20), opportunityId: z.string().uuid().nullable().optional(), focus: z.string().max(48).nullable().optional(), portfolio: z.boolean().optional() }),
    handler: async ({ app, auth, body }) => {
      requireEditor(auth);
      return simulate(app.db, auth, body.changes, body.opportunityId ?? null, body.focus ?? null, body.portfolio ?? false);
    },
  }),
  defineRoute({
    method: 'POST', url: '/finance-studio/validate', summary: 'Valida uma expressão: sintaxe, variáveis, tipos, unidades e referências circulares no modelo', tag: 'Financial Studio', ...ADMIN,
    body: Change,
    handler: async ({ app, auth, body }) => {
      requireEditor(auth);
      let ast;
      try { ast = parseFinFormula(body.expression); } catch (e) { return { ok: false, issues: [{ code: body.code, message: (e as Error).message, level: 'erro' }], refs: [] }; }
      const { overrides } = await modelFor(app.db, auth.tenantId);
      const model = candidateOf(overrides, await customDefs(app.db, auth.tenantId), [body]);
      const issues = modelIssues(model, [body.code]);
      return { ok: !issues.some((i) => i.level === 'erro'), issues, refs: finFormulaRefs(ast), canonical: printFinFormula(ast) };
    },
  }),

  // ------------------------------------------------------------------ versões
  defineRoute({
    method: 'GET', url: '/finance-studio/formulas/:code/versions', summary: 'Versões de uma fórmula (com quem fez, quando, justificativa, simulação e o histórico de governança)', tag: 'Financial Studio', ...ADMIN,
    params: z.object({ code: z.string().max(48) }),
    handler: async ({ app, auth, params }) => {
      requireEditor(auth);
      const u = s.users;
      const vs = await app.db.select({ v: s.financialFormulaVersions, author: u.name }).from(s.financialFormulaVersions).leftJoin(u, eq(u.id, s.financialFormulaVersions.createdBy))
        .where(and(eq(s.financialFormulaVersions.tenantId, auth.tenantId), eq(s.financialFormulaVersions.code, params.code))).orderBy(desc(s.financialFormulaVersions.version));
      const evs = vs.length ? await app.db.select({ e: s.financialFormulaEvents, actor: u.name }).from(s.financialFormulaEvents).leftJoin(u, eq(u.id, s.financialFormulaEvents.actorId))
        .where(inArray(s.financialFormulaEvents.versionId, vs.map((x) => x.v.id))).orderBy(desc(s.financialFormulaEvents.createdAt)) : [];
      const def = FIN_FORMULAS.find((f) => f.code === params.code);
      return {
        code: params.code, defaultExpression: def?.expression ?? null, today: today(),
        versions: vs.map(({ v, author }) => ({ ...v, author, statusLabel: STATUS_LABELS[v.status], mine: v.createdBy === auth.userId, events: evs.filter((x) => x.e.versionId === v.id).map(({ e, actor }) => ({ action: e.action, note: e.note, actor, createdAt: e.createdAt })) })),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/finance-studio/formulas', summary: 'Cria uma fórmula personalizada (código, nome, categoria, unidade e expressão) como rascunho', tag: 'Financial Studio', ...ADMIN,
    body: z.object({ code: z.string().trim().max(48), name: z.string().trim().min(2).max(80), category: z.enum(FIN_CATEGORIES), unit: z.enum(UNITS), description: z.string().trim().max(300).optional(), expression: z.string().trim().min(1).max(4000), justification: z.string().trim().max(1000).optional() }),
    handler: async ({ app, auth, body, req, reply }) => app.db.transaction(async (tx) => {
      requireEditor(auth);
      if (!isValidFormulaCode(body.code)) throw unprocessable('Código: letras minúsculas, números e _ (ex.: taxa_cartao), começando por letra.', [{ path: 'code', message: 'Código inválido' }]);
      if (await knownCode(tx, auth.tenantId, body.code) || FIN_VARIABLES.some((v) => v.code === body.code)) throw unprocessable('Já existe uma fórmula ou variável com esse código.', [{ path: 'code', message: 'Código em uso' }]);
      try { parseFinFormula(body.expression); } catch (e) { throw unprocessable((e as Error).message, [{ path: 'expression', message: 'Sintaxe' }]); }
      await tx.insert(s.financialFormulas).values({ tenantId: auth.tenantId, code: body.code, name: body.name, category: body.category, unit: body.unit, description: body.description ?? null, createdBy: auth.userId });
      const [v] = await tx.insert(s.financialFormulaVersions).values({ tenantId: auth.tenantId, code: body.code, version: 1, expression: body.expression, refs: finFormulaRefs(parseFinFormula(body.expression)), justification: body.justification ?? null, createdBy: auth.userId }).returning();
      await logEvent(tx, auth, v!, 'criada', body.justification ?? null);
      await audit(tx, req, { action: 'finance_studio.create', entityType: 'financial_formula', entityId: v!.id, metadata: { code: body.code, expression: body.expression } });
      reply.code(201);
      return v;
    }),
  }),
  defineRoute({
    method: 'POST', url: '/finance-studio/formulas/:code/versions', summary: 'Abre uma nova versão (rascunho) de uma fórmula a partir da vigente, de uma versão anterior ou da padrão do sistema (restaurar gera nova revisão)', tag: 'Financial Studio', ...ADMIN,
    params: z.object({ code: z.string().max(48) }),
    body: z.object({ expression: z.string().trim().min(1).max(4000).optional(), justification: z.string().trim().max(1000).optional(), restoreFrom: z.union([z.string().uuid(), z.literal('padrao')]).optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => app.db.transaction(async (tx) => {
      requireEditor(auth);
      if (!(await knownCode(tx, auth.tenantId, params.code))) throw notFound('Fórmula não encontrada.');
      const [openV] = await tx.select({ id: s.financialFormulaVersions.id, status: s.financialFormulaVersions.status }).from(s.financialFormulaVersions)
        .where(and(eq(s.financialFormulaVersions.tenantId, auth.tenantId), eq(s.financialFormulaVersions.code, params.code), sql`${s.financialFormulaVersions.status} <> 'publicada'`)).limit(1);
      if (openV) throw unprocessable(`Esta fórmula já tem uma versão em andamento (${STATUS_LABELS[openV.status]}). Continue nela ou devolva antes de abrir outra.`, [{ path: 'versionId', message: openV.id }]);
      let expression = body.expression ?? null, restoredFromId: string | null = null;
      if (body.restoreFrom === 'padrao') {
        expression = FIN_FORMULAS.find((f) => f.code === params.code)?.expression ?? null;
        if (!expression) throw unprocessable('Fórmula personalizada não tem versão padrão do sistema.');
      } else if (body.restoreFrom) {
        const src = await versionOr404(tx, auth.tenantId, body.restoreFrom);
        if (src.code !== params.code) throw unprocessable('A versão escolhida é de outra fórmula.');
        expression = src.expression; restoredFromId = src.id;
      }
      if (!expression) {
        const { model } = await modelFor(tx, auth.tenantId);
        expression = model.formulas.get(params.code)?.expression ?? null;
      }
      if (!expression) throw unprocessable('Informe a expressão.');
      let refs: string[];
      try { refs = finFormulaRefs(parseFinFormula(expression)); } catch (e) { throw unprocessable((e as Error).message, [{ path: 'expression', message: 'Sintaxe' }]); }
      const { overrides } = await modelFor(tx, auth.tenantId);
      const [v] = await tx.insert(s.financialFormulaVersions).values({ tenantId: auth.tenantId, code: params.code, version: await nextVersion(tx, auth.tenantId, params.code), expression, refs, justification: body.justification ?? null, baseVersionId: overrides.find((o) => o.code === params.code)?.versionId ?? null, restoredFromId, createdBy: auth.userId }).returning();
      await logEvent(tx, auth, v!, body.restoreFrom ? 'restaurada' : 'criada', body.restoreFrom ? `A partir da ${body.restoreFrom === 'padrao' ? 'fórmula padrão do sistema' : 'versão anterior'}${body.justification ? ` · ${body.justification}` : ''}` : body.justification ?? null);
      await audit(tx, req, { action: 'finance_studio.version', entityType: 'financial_formula', entityId: v!.id, metadata: { code: params.code, version: v!.version, restoreFrom: body.restoreFrom ?? null } });
      reply.code(201);
      return v;
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/finance-studio/versions/:id', summary: 'Altera a expressão ou a justificativa de uma versão em rascunho, simulada ou devolvida (volta a rascunho e pede nova simulação)', tag: 'Financial Studio', ...ADMIN, params: IdParams,
    body: z.object({ expression: z.string().trim().min(1).max(4000).optional(), justification: z.string().trim().max(1000).optional() }),
    handler: async ({ app, auth, params, body }) => {
      requireEditor(auth);
      const v = await versionOr404(app.db, auth.tenantId, params.id);
      if (!EDITABLE.includes(v.status)) throw unprocessable(`Versão ${STATUS_LABELS[v.status]?.toLowerCase()} não muda: devolva para ajuste ou crie outra.`);
      const changesExpr = body.expression !== undefined && body.expression !== v.expression;
      let refs = v.refs;
      if (changesExpr) { try { refs = finFormulaRefs(parseFinFormula(body.expression!)); } catch (e) { throw unprocessable((e as Error).message, [{ path: 'expression', message: 'Sintaxe' }]); } }
      const [n] = await app.db.update(s.financialFormulaVersions).set({ ...(changesExpr ? { expression: body.expression!, refs, status: 'rascunho', simulation: null } : {}), ...(body.justification !== undefined ? { justification: body.justification } : {}), updatedAt: new Date() })
        .where(eq(s.financialFormulaVersions.id, v.id)).returning();
      if (changesExpr) await logEvent(app.db, auth, v, 'editada');
      return n;
    },
  }),
  defineRoute({
    method: 'POST', url: '/finance-studio/versions/:id/simulate', summary: 'Simula a versão numa oportunidade real e na carteira; guarda o resultado (anterior, novo, impactos) e marca como simulada', tag: 'Financial Studio', ...ADMIN, params: IdParams,
    body: z.object({ opportunityId: z.string().uuid() }),
    handler: async ({ app, auth, params, body }) => {
      requireEditor(auth);
      const v = await versionOr404(app.db, auth.tenantId, params.id);
      if (!EDITABLE.includes(v.status)) throw unprocessable('Só versões em rascunho, simuladas ou devolvidas são simuladas de novo.');
      const r = await simulate(app.db, auth, [{ code: v.code, expression: v.expression }], body.opportunityId, v.code, true);
      if (r.issues.some((i) => i.level === 'erro')) throw unprocessable(`A fórmula tem erros: ${r.issues.filter((i) => i.level === 'erro').map((i) => i.message).join(' ')}`);
      const res = r.result!;
      const focus = res.values.find((x) => x.code === v.code);
      const simulation = {
        at: new Date().toISOString(), by: auth.name, opportunityId: body.opportunityId,
        before: focus?.before ?? null, after: focus?.after ?? null, beforeText: focus?.beforeText ?? null, afterText: focus?.afterText ?? null, diffAbs: focus?.diffAbs ?? null, diffPct: focus?.diffPct ?? null,
        impacted: res.values.filter((x) => x.impacted && x.changed).map(({ code, name, unit, beforeText, afterText, diffAbs, diffPct }) => ({ code, name, unit, beforeText, afterText, diffAbs, diffPct })),
        viability: res.viability, portfolio: r.portfolio ? { total: r.portfolio.total, verdictChanged: r.portfolio.verdictChanged, autoChanged: r.portfolio.autoChanged } : null, models: r.models,
      };
      const [n] = await app.db.update(s.financialFormulaVersions).set({ status: 'simulada', simulation, updatedAt: new Date() }).where(eq(s.financialFormulaVersions.id, v.id)).returning();
      await logEvent(app.db, auth, v, 'simulada', `${focus?.beforeText ?? '—'} → ${focus?.afterText ?? '—'}${res.viability.changed ? ' · muda a viabilidade' : ''}`);
      return { version: n, simulation: r };
    },
  }),
  defineRoute({
    method: 'POST', url: '/finance-studio/versions/:id/transition', summary: 'Avança a governança: enviar para validação, validar, aprovar, publicar (com vigência) ou devolver (com motivo)', tag: 'Financial Studio', ...ADMIN, params: IdParams,
    body: z.object({ action: z.enum(['enviar', 'validar', 'aprovar', 'publicar', 'devolver']), note: z.string().trim().max(1000).optional(), validFrom: z.string().date().optional() }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      requireEditor(auth);
      const v = await versionOr404(tx, auth.tenantId, params.id);
      const mine = v.createdBy === auth.userId;
      const now = new Date();
      let set: Partial<typeof s.financialFormulaVersions.$inferInsert> = {};
      switch (body.action) {
        case 'enviar':
          if (v.status !== 'simulada') throw unprocessable('Simule a versão numa oportunidade antes de enviar para validação.');
          if ((v.justification ?? body.note ?? '').trim().length < 10) throw unprocessable('Escreva a justificativa da alteração (pelo menos 10 caracteres).', [{ path: 'justification', message: 'Obrigatória' }]);
          set = { status: 'em_validacao', submittedBy: auth.userId, submittedAt: now, ...(body.note && !v.justification ? { justification: body.note } : {}) };
          break;
        case 'validar':
          if (v.status !== 'em_validacao') throw unprocessable('Só versões em validação podem ser validadas.');
          if (mine) throw forbidden('Quem criou a versão não valida a própria alteração.');
          set = { status: 'validada', validatedBy: auth.userId, validatedAt: now };
          break;
        case 'aprovar':
          if (v.status !== 'validada') throw unprocessable('A versão precisa ser validada antes da aprovação.');
          if (!canApprove(auth)) throw forbidden('Aprovar fórmulas é da gestão e da diretoria (permissão de aprovar a viabilidade).');
          if (mine) throw forbidden('Quem criou a versão não aprova a própria alteração.');
          set = { status: 'aprovada', approvedBy: auth.userId, approvedAt: now };
          break;
        case 'publicar': {
          if (v.status !== 'aprovada') throw unprocessable('Só versões aprovadas são publicadas.');
          if (!canApprove(auth)) throw forbidden('Publicar fórmulas é da gestão e da diretoria.');
          const from = body.validFrom ?? today();
          if (from < today()) throw unprocessable('A vigência começa hoje ou numa data futura: cálculos já salvos não mudam.');
          // o modelo inteiro precisa continuar válido com esta versão
          const { overrides } = await modelFor(tx, auth.tenantId);
          const issues = modelIssues(candidateOf(overrides, await customDefs(tx, auth.tenantId), [{ code: v.code, expression: v.expression }]), [v.code]).filter((i) => i.level === 'erro');
          if (issues.length) throw unprocessable(`O modelo fica inválido com esta versão: ${issues.map((i) => `${i.code}: ${i.message}`).join(' ')}`);
          set = { status: 'publicada', publishedBy: auth.userId, publishedAt: now, validFrom: from };
          break;
        }
        case 'devolver':
          if (!['em_validacao', 'validada', 'aprovada'].includes(v.status)) throw unprocessable('Nada a devolver nesta versão.');
          if ((body.note ?? '').length < 5) throw unprocessable('Diga o motivo da devolução.', [{ path: 'note', message: 'Motivo obrigatório' }]);
          set = { status: 'devolvida' };
          break;
      }
      const [n] = await tx.update(s.financialFormulaVersions).set({ ...set, updatedAt: now }).where(eq(s.financialFormulaVersions.id, v.id)).returning();
      const actionName = { enviar: 'enviada', validar: 'validada', aprovar: 'aprovada', publicar: 'publicada', devolver: 'devolvida' }[body.action];
      await logEvent(tx, auth, v, actionName, body.action === 'publicar' ? `Vigência a partir de ${n!.validFrom}${body.note ? ` · ${body.note}` : ''}` : body.note ?? null);
      await audit(tx, req, { action: `finance_studio.${body.action}`, entityType: 'financial_formula', entityId: v.id, metadata: { code: v.code, version: v.version, expression: v.expression, validFrom: n!.validFrom } });
      return n;
    }),
  }),
];
