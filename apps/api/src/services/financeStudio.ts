/**
 * Financial Studio: fórmulas publicadas pela diretoria (por vigência), modelo usado pelo motor e simulação de impacto.
 * Nada aqui altera cálculos salvos: a simulação só lê; a publicação vale para os próximos cálculos (os salvos ficam
 * marcados como desatualizados até alguém salvar de novo).
 */
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  buildModel, dependentsOf, ECON_VERDICT_LABELS, financeEngineDetailed, finVariable, FIN_FORMULAS, FIN_VARIABLES, fmtFin, traceOf, validateModel,
  type EconResult, type FinModel, type FinOverride, type FValue,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { EconContext } from './economics';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export type PublishedFormula = FinOverride & { versionId: string; version: number; validFrom: string };

/** Fórmulas publicadas e vigentes na data (por código, a de maior vigência e, empatando, a versão mais nova). */
export async function publishedFormulas(db: DbOrTx, tenantId: string, on = today()): Promise<PublishedFormula[]> {
  const rows = await db.selectDistinctOn([s.financialFormulaVersions.code], { id: s.financialFormulaVersions.id, code: s.financialFormulaVersions.code, version: s.financialFormulaVersions.version, expression: s.financialFormulaVersions.expression, validFrom: s.financialFormulaVersions.validFrom })
    .from(s.financialFormulaVersions)
    .where(and(eq(s.financialFormulaVersions.tenantId, tenantId), eq(s.financialFormulaVersions.status, 'publicada'), lte(s.financialFormulaVersions.validFrom, on)))
    .orderBy(s.financialFormulaVersions.code, desc(s.financialFormulaVersions.validFrom), desc(s.financialFormulaVersions.version));
  if (!rows.length) return [];
  const defs = await db.select().from(s.financialFormulas).where(and(eq(s.financialFormulas.tenantId, tenantId), inArray(s.financialFormulas.code, rows.map((r) => r.code))));
  return rows.map((r) => {
    const d = defs.find((x) => x.code === r.code);
    return { code: r.code, expression: r.expression, version: r.version, versionId: r.id, validFrom: r.validFrom!, ...(d ? { name: d.name, category: d.category as FinOverride['category'], unit: d.unit as FinOverride['unit'], desc: d.description ?? '' } : {}) };
  });
}

/** Modelo do motor na data: padrão do sistema + fórmulas publicadas. Um modelo publicado inválido cai no padrão (e avisa). */
export async function modelFor(db: DbOrTx, tenantId: string, on = today()): Promise<{ model: FinModel; overrides: PublishedFormula[] }> {
  const overrides = await publishedFormulas(db, tenantId, on);
  if (!overrides.length) return { model: buildModel(), overrides };
  try {
    const model = buildModel(overrides);
    if (validateModel(model).some((i) => i.level === 'erro')) return { model: buildModel(), overrides: [] };
    return { model, overrides };
  } catch { return { model: buildModel(), overrides: [] }; }
}

/** Custom formulas (definições) para montar o modelo de simulação. */
export async function customDefs(db: DbOrTx, tenantId: string) {
  return db.select().from(s.financialFormulas).where(eq(s.financialFormulas.tenantId, tenantId)).orderBy(asc(s.financialFormulas.code));
}

const engineArgs = (ctx: EconContext, model: FinModel) => ({ input: ctx.input, items: ctx.items, settings: ctx.settings!, publicSector: ctx.publicSector, model });

const viabilityOf = (r: EconResult) => ({
  verdict: r.verdict, label: ECON_VERDICT_LABELS[r.verdict], autoApproval: r.autoApproval?.ok ?? false, withinPolicy: r.withinPolicy,
  priceCents: r.priceCents, minCents: r.floor.minCents, recommendedCents: r.recommendedCents, marginPct: r.kpi?.marginPct ?? null,
  npvCents: r.kpi?.npvCents ?? null, irrMonthly: r.kpi?.irrMonthly ?? null, paybackMonths: r.kpi?.paybackMonths ?? null, roiPct: r.kpi?.roiPct ?? null,
  checks: r.autoApproval?.checks ?? [],
});

const diff = (a: FValue, b: FValue) => {
  if (typeof a === 'number' && typeof b === 'number') { const abs = b - a; return { abs, pct: a !== 0 ? (abs / Math.abs(a)) * 100 : b === 0 ? 0 : null, changed: Math.abs(abs) > 1e-9 }; }
  return { abs: null, pct: null, changed: a !== b && !(Array.isArray(a) && Array.isArray(b)) };
};

/**
 * Simulação de uma alteração: o motor roda duas vezes na mesma oportunidade (fórmulas vigentes × alteradas) e devolve
 * resultado anterior e novo de cada fórmula, a diferença absoluta e percentual, os indicadores que dependem da alteração
 * (pelo grafo de dependências) e o efeito na viabilidade e na aprovação automática.
 */
export function simulateOn(ctx: EconContext, current: FinModel, candidate: FinModel, changed: string[], focus?: string | null) {
  const before = financeEngineDetailed(engineArgs(ctx, current));
  const after = financeEngineDetailed(engineArgs(ctx, candidate));
  const affected = dependentsOf(candidate, changed);
  const codes = [...new Set([...changed, ...affected, ...candidate.formulas.keys()])];
  const values = codes.filter((c) => candidate.formulas.has(c) || current.formulas.has(c)).map((code) => {
    const f = candidate.formulas.get(code) ?? current.formulas.get(code)!;
    const a = before.run.values[code] ?? null, b = after.run.values[code] ?? null;
    const d = diff(a, b);
    return { code, name: f.name, unit: f.unit, category: f.category, before: a, after: b, beforeText: fmtFin(a, f.unit), afterText: fmtFin(b, f.unit), diffAbs: d.abs, diffPct: d.pct, changed: d.changed, impacted: affected.includes(code), edited: changed.includes(code) };
  });
  const f = focus && (candidate.formulas.has(focus) || current.formulas.has(focus)) ? focus : changed[0] ?? null;
  return {
    values,
    affected,
    viability: { before: viabilityOf(before.result), after: viabilityOf(after.result), changed: before.result.verdict !== after.result.verdict || (before.result.autoApproval?.ok ?? false) !== (after.result.autoApproval?.ok ?? false) },
    trace: f ? { before: current.formulas.has(f) ? traceOf(current, before.base, before.run, f) : null, after: candidate.formulas.has(f) ? traceOf(candidate, after.base, after.run, f) : null } : null,
    variables: variablesOf(before.base, candidate),
    warnings: [...new Set([...before.result.warnings, ...after.result.warnings])].filter((w) => w.startsWith('Fórmula')),
    models: { before: before.result.model, after: after.result.model },
  };
}

/** Variáveis com origem e o valor atual na oportunidade (as que o modelo usa). */
export function variablesOf(base: Record<string, FValue>, model: FinModel) {
  const used = new Set([...model.formulas.values()].flatMap((f) => f.refs));
  return FIN_VARIABLES.map((v) => ({ ...v, value: v.code === 'fluxo' ? null : v.code === 'mes' ? 1 : base[v.code] ?? null, valueText: v.code === 'fluxo' ? 'série do fluxo' : v.code === 'mes' ? '1' : fmtFin(base[v.code] ?? null, v.unit), used: used.has(v.code), usedBy: [...model.formulas.values()].filter((f) => f.refs.includes(v.code)).map((f) => f.code) }));
}

/** Catálogo para a tela: fórmulas do sistema e personalizadas, com a vigente, a padrão, dependências e dependentes. */
export function catalogOf(model: FinModel, published: PublishedFormula[]) {
  return [...model.formulas.values()].map((f) => {
    const def = FIN_FORMULAS.find((x) => x.code === f.code);
    const pub = published.find((p) => p.code === f.code);
    return {
      code: f.code, name: f.name, category: f.category, unit: f.unit, desc: f.desc, expression: f.expression, defaultExpression: def?.expression ?? null, custom: !def,
      version: pub?.version ?? 0, versionId: pub?.versionId ?? null, validFrom: pub?.validFrom ?? null,
      refs: f.refs, refsInfo: f.refs.map((r) => ({ code: r, kind: model.formulas.has(r) ? 'formula' : finVariable(r) ? 'variavel' : 'desconhecida' })),
      dependents: dependentsOf(model, [f.code]),
    };
  });
}

/** Próximo número de versão de uma fórmula. */
export async function nextVersion(db: DbOrTx, tenantId: string, code: string) {
  const [r] = await db.select({ v: sql<number>`coalesce(max(${s.financialFormulaVersions.version}), 0)::int` }).from(s.financialFormulaVersions).where(and(eq(s.financialFormulaVersions.tenantId, tenantId), eq(s.financialFormulaVersions.code, code)));
  return (r?.v ?? 0) + 1;
}
