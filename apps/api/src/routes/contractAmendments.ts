/** Termos aditivos com o limite legal de alteração e a sugestão de reajuste pelo índice oficial (Banco Central). */
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AMENDMENT_KINDS, AMENDMENT_LABELS, CONTRACT_ITEM_KINDS, addDays, amendmentError, amendmentLimits, contractValuesFromItems, itemKindOf, originalValue, type AmendmentKind } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { brl } from '../services/email';
import { addEvent, currentVersion, hasSector, isAdmin, loadContract, newVersion } from '../services/contracts';
import { level } from '../services/scope';
import { adjustmentSuggestion } from '../services/indices';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().min(0).max(1_000_000_000_000);
const Delta = z.object({ valueCents: money.default(0), monthlyCents: money.default(0) });
const ItemIn = z.object({ planId: z.string().uuid().nullable().default(null), description: z.string().trim().min(2).max(200), qty: z.number().int().min(1).max(100_000), unitCents: money, kind: z.enum(CONTRACT_ITEM_KINDS).optional(), recurring: z.boolean().optional() });
/** Aditivo: uma ou mais finalidades. Aceita também o formato antigo (uma finalidade em "kind"). */
const AmendmentBody = z.object({
  number: z.string().trim().min(1).max(40), signedOn: day, description: z.string().trim().min(5).max(1000), reforma: z.boolean().default(false), acordo: z.boolean().default(false),
  purposes: z.object({
    acrescimo: Delta.optional(), supressao: Delta.optional(), reequilibrio: Delta.optional(),
    prazo: z.object({ newEndAt: day }).optional(), reajuste: z.object({ pct: z.number().min(-100).max(1000) }).optional(),
    itens: z.literal(true).optional(), outro: z.literal(true).optional(),
  }).optional(),
  items: z.array(ItemIn).max(50).optional(),
  // formato antigo
  kind: z.enum(AMENDMENT_KINDS).optional(), valueDeltaCents: money.optional(), monthlyDeltaCents: money.optional(), newEndAt: day.nullable().optional(),
});
type Purposes = NonNullable<z.infer<typeof AmendmentBody>['purposes']>;
function purposesOf(b: z.infer<typeof AmendmentBody>): Purposes {
  if (b.purposes && Object.keys(b.purposes).length) return Object.fromEntries(Object.entries(b.purposes).filter(([, v]) => v !== undefined)) as Purposes;
  if (!b.kind) return {};
  const d = { valueCents: b.valueDeltaCents ?? 0, monthlyCents: b.monthlyDeltaCents ?? 0 };
  if (b.kind === 'acrescimo' || b.kind === 'supressao' || b.kind === 'reequilibrio') return { [b.kind]: d, ...(b.newEndAt ? { prazo: { newEndAt: b.newEndAt } } : {}) } as Purposes;
  if (b.kind === 'prazo') return { prazo: { newEndAt: b.newEndAt ?? '' } };
  return { [b.kind]: true } as Purposes;
}
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
    method: 'POST', url: '/contracts/:id/amendments', summary: 'Registra termo aditivo com uma ou mais finalidades (acréscimo, supressão, prorrogação, reajuste, reequilíbrio, itens) e gera uma nova versão do contrato', tag: 'Contratos', module: 'contratos', params: IdParams,
    body: AmendmentBody,
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!canManage(auth)) throw forbidden('Aditivos são registrados pela gestão de contratos, Inteligência Comercial, Jurídico ou Diretoria.');
      if (c.stage === 'arquivado' || c.stage === 'cadastro_validacao') throw unprocessable('Aditivo só em contrato validado e não arquivado.');
      const p = purposesOf(body);
      const kinds = Object.keys(p) as AmendmentKind[];
      if (!kinds.length) throw unprocessable('Escolha ao menos uma finalidade do aditivo.', [{ path: 'purposes', message: 'Obrigatório' }]);
      if (p.acrescimo && !p.acrescimo.valueCents) throw unprocessable('Informe o valor do acréscimo.', [{ path: 'purposes.acrescimo.valueCents', message: 'Obrigatório' }]);
      if (p.supressao && !p.supressao.valueCents) throw unprocessable('Informe o valor da supressão.', [{ path: 'purposes.supressao.valueCents', message: 'Obrigatório' }]);
      if (p.prazo && !p.prazo.newEndAt) throw unprocessable('Informe o novo término.', [{ path: 'purposes.prazo.newEndAt', message: 'Obrigatório' }]);
      if (p.reajuste && !p.reajuste.pct) throw unprocessable('Informe o percentual do reajuste.', [{ path: 'purposes.reajuste.pct', message: 'Obrigatório' }]);
      if (p.itens && !body.items?.length) throw unprocessable('Informe os itens do contrato depois do aditivo.', [{ path: 'items', message: 'Obrigatório' }]);
      const groupId = randomUUID();
      const out = await app.db.transaction(async (tx) => {
        const r = await summary(tx, c);
        const limits = body.reforma ? amendmentLimits(r.limits.baseCents, r.list, true) : r.limits;
        for (const k of ['acrescimo', 'supressao'] as const) {
          const x = p[k];
          if (!x) continue;
          const err = amendmentError(r.legalLimit, limits, { kind: k, valueDeltaCents: x.valueCents ?? 0, acordo: body.acordo });
          if (err) throw unprocessable(err, [{ path: `purposes.${k}.valueCents`, message: 'Acima do limite legal' }]);
        }
        const cur = await currentVersion(tx, c);
        const newEndAt = p.prazo?.newEndAt ?? null;
        if (newEndAt && cur.endAt && newEndAt <= cur.endAt) throw unprocessable('O novo término precisa ser depois do atual.');
        if (newEndAt && c.legalLimitAt && newEndAt > c.legalLimitAt) throw unprocessable(`O novo término passa do limite total de vigência (${c.legalLimitAt}).`);
        // valores: itens novos (se houver) → reajuste → acréscimos/supressões/reequilíbrio
        let items = body.items?.length ? body.items.map((i) => ({ ...i, kind: itemKindOf(i) })) : cur.items;
        let monthly = body.items?.length ? contractValuesFromItems(items, null).monthlyCents : cur.monthlyCents;
        let total = cur.totalCents;
        let adjDelta = 0;
        if (p.reajuste?.pct) {
          const f = 1 + p.reajuste.pct / 100;
          const before = monthly;
          items = items.map((i) => ({ ...i, unitCents: Math.round(i.unitCents * f) }));
          monthly = Math.round(monthly * f);
          adjDelta = monthly - before;
        }
        const add = (k: 'acrescimo' | 'supressao' | 'reequilibrio', sign: 1 | -1) => {
          const x = p[k];
          if (!x) return;
          if (x.monthlyCents) monthly = Math.max(0, monthly + sign * x.monthlyCents);
          if (x.valueCents && total !== null) total = Math.max(0, total + sign * x.valueCents);
        };
        add('acrescimo', 1); add('supressao', -1); add('reequilibrio', 1);
        const patch: Parameters<typeof newVersion>[3] = { effectiveFrom: body.signedOn };
        if (monthly !== cur.monthlyCents) patch.monthlyCents = monthly;
        if (total !== cur.totalCents) patch.totalCents = total;
        if (JSON.stringify(items) !== JSON.stringify(cur.items)) patch.items = items;
        if (newEndAt) { patch.endAt = newEndAt; patch.renewalAt = addDays(newEndAt, 1); }
        const labels = kinds.map((k) => AMENDMENT_LABELS[k]).join(' + ');
        const v = await newVersion(tx, c, auth.userId, patch, 'aditivo', `Termo aditivo ${body.number} (${labels}): ${body.description}`);
        const sign = (k: AmendmentKind) => (k === 'supressao' ? -1 : 1);
        const rows = kinds.map((k) => {
          const x = p[k] as { valueCents?: number; monthlyCents?: number } | undefined;
          return {
            tenantId: auth.tenantId, contractId: c.id, number: body.number, kind: k, signedOn: body.signedOn, groupId, version: v.version, createdBy: auth.userId,
            valueDeltaCents: sign(k) * (x?.valueCents ?? 0), monthlyDeltaCents: k === 'reajuste' ? adjDelta : sign(k) * (x?.monthlyCents ?? 0),
            newEndAt: k === 'prazo' ? newEndAt : null, adjustmentPct: k === 'reajuste' ? p.reajuste!.pct : null,
            reforma: k === 'acrescimo' && body.reforma, acordo: k === 'supressao' && body.acordo, description: body.description,
          };
        });
        const ins = await tx.insert(s.contractAmendments).values(rows).returning({ id: s.contractAmendments.id });
        // medição: o acréscimo vira crédito de saldo
        if (c.billingType === 'medicao' && p.acrescimo?.valueCents) {
          await tx.insert(s.contractLedger).values({ tenantId: auth.tenantId, contractId: c.id, kind: 'credito', amountCents: p.acrescimo.valueCents, occurredOn: body.signedOn, description: `Termo aditivo ${body.number} (acréscimo)`, createdBy: auth.userId });
        }
        const parts = [
          p.acrescimo?.valueCents ? `acréscimo de ${brl(p.acrescimo.valueCents)}` : '', p.supressao?.valueCents ? `supressão de ${brl(p.supressao.valueCents)}` : '',
          p.reajuste ? `reajuste de ${p.reajuste.pct.toLocaleString('pt-BR')}%` : '', p.reequilibrio?.valueCents ? `reequilíbrio de ${brl(p.reequilibrio.valueCents)}` : '',
          newEndAt ? `novo término ${newEndAt}` : '', patch.items ? 'itens atualizados' : '',
        ].filter(Boolean).join('; ');
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'aditivo', `Termo aditivo ${body.number} (${labels})${parts ? `: ${parts}` : ''}. Versão ${v.version}.`, { amendmentIds: ins.map((x) => x.id), groupId, version: v.version });
        return ins[0]!.id;
      });
      await audit(app.db, req, { action: 'contract.amendment', entityType: 'contract', entityId: c.id, metadata: { kinds, number: body.number } });
      reply.code(201);
      return { id: out, groupId };
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
