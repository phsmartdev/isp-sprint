/** Termos aditivos com o limite legal de alteração e a sugestão de reajuste pelo índice oficial (Banco Central). */
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { AMENDMENT_KINDS, AMENDMENT_LABELS, amendmentError, amendmentLimits, originalValue } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { brl } from '../services/email';
import { addEvent, currentVersion, hasSector, isAdmin, loadContract, newVersion } from '../services/contracts';
import { level } from '../services/scope';
import { adjustmentSuggestion } from '../services/indices';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const canManage = (auth: Parameters<typeof isAdmin>[0]) => isAdmin(auth) || level(auth, 'contratos') === 'total' || hasSector(auth, ['administracao', 'inteligencia_comercial', 'juridico', 'diretoria']);
const publicRegime = (c: { kind: string; legalRegime: string }) => c.kind === 'publico' && (c.legalRegime === 'lei_14133' || c.legalRegime === 'lei_8666');

async function summary(db: Parameters<typeof currentVersion>[0], c: { id: string; kind: string; legalRegime: string }) {
  const [first] = await db.select().from(s.contractVersions).where(eq(s.contractVersions.contractId, c.id)).orderBy(asc(s.contractVersions.version)).limit(1);
  const list = await db.select().from(s.contractAmendments).where(eq(s.contractAmendments.contractId, c.id)).orderBy(asc(s.contractAmendments.signedOn), asc(s.contractAmendments.createdAt));
  const base = first ? originalValue({ totalCents: first.totalCents, monthlyCents: first.monthlyCents, termMonths: first.termMonths }) : 0;
  const reforma = list.some((a) => a.reforma);
  return { list, limits: amendmentLimits(base, list, reforma), legalLimit: publicRegime(c) };
}

export const contractAmendmentRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/:id/year-values', summary: 'Valor mensal do contrato por ano (para comparar receita sem o efeito do reajuste)', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const rows = await app.db.select({ id: s.contractYearValues.id, year: s.contractYearValues.year, monthlyCents: s.contractYearValues.monthlyCents, onlyAdjustment: s.contractYearValues.onlyAdjustment, note: s.contractYearValues.note, createdAt: s.contractYearValues.createdAt, supersededAt: s.contractYearValues.supersededAt, by: s.users.name })
        .from(s.contractYearValues).leftJoin(s.users, eq(s.users.id, s.contractYearValues.createdBy)).where(eq(s.contractYearValues.contractId, c.id)).orderBy(desc(s.contractYearValues.year), desc(s.contractYearValues.createdAt));
      return { items: rows, canManage: canManage(auth) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/year-values', summary: 'Informa quanto o contrato valia por mês num ano (corrigir grava novo valor e guarda o anterior)', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({ year: z.number().int().min(2000).max(2100), monthlyCents: z.number().int().min(0).max(1_000_000_000_000), onlyAdjustment: z.boolean().default(true), note: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canManage(auth)) throw forbidden('O valor por ano é informado pela gestão de contratos, Inteligência Comercial, Jurídico ou Diretoria.');
      if (body.year >= Number(new Date().toISOString().slice(0, 4)) + 1) throw unprocessable('Informe um ano que já passou ou o atual.');
      const id = await app.db.transaction(async (tx) => {
        await tx.update(s.contractYearValues).set({ supersededAt: new Date() }).where(and(eq(s.contractYearValues.contractId, c.id), eq(s.contractYearValues.year, body.year), isNull(s.contractYearValues.supersededAt)));
        const [r] = await tx.insert(s.contractYearValues).values({ tenantId: auth.tenantId, contractId: c.id, year: body.year, monthlyCents: body.monthlyCents, onlyAdjustment: body.onlyAdjustment, note: body.note ?? null, createdBy: auth.userId }).returning({ id: s.contractYearValues.id });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'valor_ano', `Valor mensal em ${body.year} informado: ${brl(body.monthlyCents)}${body.onlyAdjustment ? ' (diferença para o valor atual é reajuste)' : ''}.`, { year: body.year, monthlyCents: body.monthlyCents });
        return r!.id;
      });
      await audit(app.db, req, { action: 'contract.year_value', entityType: 'contract', entityId: c.id, metadata: { year: body.year, monthlyCents: body.monthlyCents } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/:id/amendments', summary: 'Aditivos do contrato e o uso do limite legal de acréscimo e supressão', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const r = await summary(app.db, c);
      return { items: r.list.map((a) => ({ ...a, label: AMENDMENT_LABELS[a.kind as keyof typeof AMENDMENT_LABELS] })), limits: r.limits, legalLimit: r.legalLimit, canManage: canManage(auth) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/contracts/:id/amendments', summary: 'Registra termo aditivo (bloqueia acima do limite legal em contrato público) e gera nova versão do contrato', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: z.object({
      number: z.string().trim().min(1).max(40), kind: z.enum(AMENDMENT_KINDS), signedOn: day, valueDeltaCents: z.number().int().min(0).max(1_000_000_000_000).default(0),
      monthlyDeltaCents: z.number().int().min(0).max(1_000_000_000_000).default(0), newEndAt: day.nullable().optional(), reforma: z.boolean().default(false), acordo: z.boolean().default(false), description: z.string().trim().min(5).max(1000),
    }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canManage(auth)) throw forbidden('Aditivos são registrados pela gestão de contratos, Inteligência Comercial, Jurídico ou Diretoria.');
      if (c.stage === 'arquivado' || c.stage === 'cadastro_validacao') throw unprocessable('Aditivo só em contrato validado e não arquivado.');
      if ((body.kind === 'acrescimo' || body.kind === 'supressao') && !body.valueDeltaCents) throw unprocessable('Informe o valor do acréscimo ou da supressão.', [{ path: 'valueDeltaCents', message: 'Obrigatório' }]);
      if (body.kind === 'prazo' && !body.newEndAt) throw unprocessable('Informe o novo término.', [{ path: 'newEndAt', message: 'Obrigatório' }]);
      const out = await app.db.transaction(async (tx) => {
        const r = await summary(tx, c);
        const limits = body.reforma ? amendmentLimits(r.limits.baseCents, r.list, true) : r.limits;
        const err = amendmentError(r.legalLimit, limits, body);
        if (err) throw unprocessable(err, [{ path: 'valueDeltaCents', message: 'Acima do limite legal' }]);
        const cur = await currentVersion(tx, c);
        if (body.newEndAt && cur.endAt && body.newEndAt <= cur.endAt && body.kind === 'prazo') throw unprocessable('O novo término precisa ser depois do atual.');
        if (body.newEndAt && c.legalLimitAt && body.newEndAt > c.legalLimitAt) throw unprocessable(`O novo término passa do limite total de vigência (${c.legalLimitAt}).`);
        const sign = body.kind === 'supressao' ? -1 : 1;
        const patch: Parameters<typeof newVersion>[3] = { effectiveFrom: body.signedOn };
        if (body.monthlyDeltaCents) patch.monthlyCents = Math.max(0, cur.monthlyCents + sign * body.monthlyDeltaCents);
        if (body.valueDeltaCents && cur.totalCents !== null) patch.totalCents = Math.max(0, cur.totalCents + sign * body.valueDeltaCents);
        if (body.newEndAt) { patch.endAt = body.newEndAt; patch.renewalAt = body.newEndAt; }
        const v = await newVersion(tx, c, auth.userId, patch, 'aditivo', `Termo aditivo ${body.number} (${AMENDMENT_LABELS[body.kind]}): ${body.description}`);
        const [a] = await tx.insert(s.contractAmendments).values({ tenantId: auth.tenantId, contractId: c.id, number: body.number, kind: body.kind, signedOn: body.signedOn, valueDeltaCents: sign * body.valueDeltaCents, monthlyDeltaCents: sign * body.monthlyDeltaCents, newEndAt: body.newEndAt ?? null, reforma: body.reforma, acordo: body.acordo, description: body.description, version: v.version, createdBy: auth.userId }).returning({ id: s.contractAmendments.id });
        // medição: o acréscimo vira crédito de saldo
        if (c.billingType === 'medicao' && body.kind === 'acrescimo') {
          await tx.insert(s.contractLedger).values({ tenantId: auth.tenantId, contractId: c.id, kind: 'credito', amountCents: body.valueDeltaCents, occurredOn: body.signedOn, description: `Termo aditivo ${body.number} (acréscimo)`, createdBy: auth.userId });
        }
        const pct = r.limits.baseCents ? Math.round((Math.abs(body.valueDeltaCents) / r.limits.baseCents) * 1000) / 10 : null;
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'aditivo', `Termo aditivo ${body.number}: ${AMENDMENT_LABELS[body.kind]}${body.valueDeltaCents ? ` de ${brl(body.valueDeltaCents)}${pct !== null ? ` (${pct.toLocaleString('pt-BR')}% do valor inicial)` : ''}` : ''}${body.newEndAt ? `; novo término ${body.newEndAt}` : ''}.`, { amendmentId: a!.id, version: v.version });
        return a!.id;
      });
      await audit(app.db, req, { action: 'contract.amendment', entityType: 'contract', entityId: c.id, metadata: { kind: body.kind, valueDeltaCents: body.valueDeltaCents } });
      reply.code(201);
      return { id: out };
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/:id/adjustment-suggestion', summary: 'Reajuste sugerido: acumulado do índice do contrato nos 12 meses antes do aniversário (Banco Central)', tag: 'Contratos', module: 'contratos', params: IdParams,
    query: z.object({ anniversary: day }),
    handler: async ({ app, auth, params, query }) => {
      const c = await loadContract(app.db, auth, params.id);
      const v = await currentVersion(app.db, c);
      return adjustmentSuggestion(v.adjustmentIndex, query.anniversary, v.monthlyCents);
    },
  }),
];
