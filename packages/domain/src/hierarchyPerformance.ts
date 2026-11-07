/**
 * Gestão de Times → Performance por nível hierárquico.
 * Cada nível de competência compõe a performance com pesos próprios sobre:
 *  - atividade: a nota da gamificação (tarefas da jornada, bônus, crédito extra, média do time);
 *  - metas individuais, do time, da área/unidade e da empresa (atingimento das metas de Objetivos e metas).
 * Quem sobe na hierarquia pesa mais o coletivo. Componente sem meta no período: o peso vai para os demais, na proporção.
 * Atingimento de cada meta com teto (da regra). Sem ranking: a pessoa vê a própria; a liderança, o time; a gestão, a área.
 * Todos os números vêm da regra aprovada; nada fixo no cálculo.
 */

export const PERFORMANCE_COMPONENTS = ['activity', 'individual', 'team', 'unit', 'company'] as const;
export type PerformanceComponent = (typeof PERFORMANCE_COMPONENTS)[number];
export const PERFORMANCE_COMPONENT_LABELS: Record<PerformanceComponent, string> = {
  activity: 'Atividade (gamificação)', individual: 'Metas individuais', team: 'Metas do time', unit: 'Metas da área', company: 'Metas da empresa',
};
export type PerformanceWeights = Record<PerformanceComponent, number>;
export type PerformanceBands = { greenBp: number; yellowBp: number };
export type PerformanceTone = 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';

export function performanceWeightsErrors(byLevel: Record<string, PerformanceWeights>, levelNames: Record<string, string>, bands: PerformanceBands): string[] {
  const e: string[] = [];
  for (const [k, w] of Object.entries(byLevel)) {
    const vals = PERFORMANCE_COMPONENTS.map((c) => w[c]);
    if (!vals.every((v) => Number.isInteger(v) && v >= 0 && v <= 10_000) || vals.reduce((a, b) => a + b, 0) !== 10_000) e.push(`Performance de ${levelNames[k] ?? k}: os pesos devem somar 100%.`);
    if (!(k in levelNames)) e.push(`Performance: nível inexistente (${k}).`);
  }
  if (!Number.isInteger(bands.greenBp) || !Number.isInteger(bands.yellowBp) || bands.yellowBp <= 0 || bands.greenBp <= bands.yellowBp || bands.greenBp > 20_000) e.push('Faixas da performance: o verde deve ser maior que o amarelo.');
  return e;
}

/** Média dos atingimentos (fração) das metas, em %, com teto por meta. Sem meta com atingimento: null. */
export function goalsAttainment(atts: (number | null)[], capBp: number): number | null {
  const v = atts.filter((a): a is number => a !== null && Number.isFinite(a));
  if (!v.length) return null;
  return Math.round((v.reduce((t, a) => t + Math.min(capBp / 10_000, Math.max(0, a)), 0) / v.length) * 1000) / 10;
}

export type ComponentResult = { key: PerformanceComponent; value: number | null; weightBp: number; effectiveBp: number; goals: number };

/** Performance = Σ peso × componente; componentes sem dado repartem o peso entre os presentes. */
export function performanceScore(values: Record<PerformanceComponent, { value: number | null; goals: number }>, w: PerformanceWeights, bands: PerformanceBands) {
  const present = PERFORMANCE_COMPONENTS.filter((c) => w[c] > 0 && values[c].value !== null);
  const sumPresent = present.reduce((t, c) => t + w[c], 0);
  const components: ComponentResult[] = PERFORMANCE_COMPONENTS.filter((c) => w[c] > 0).map((c) => ({
    key: c, value: values[c].value, weightBp: w[c], goals: values[c].goals,
    effectiveBp: sumPresent && values[c].value !== null ? Math.round((w[c] * 10_000) / sumPresent) : 0,
  }));
  if (!sumPresent) return { score: null, tone: 'sem_dados' as PerformanceTone, components };
  const score = Math.round((present.reduce((t, c) => t + values[c].value! * w[c], 0) / sumPresent) * 10) / 10;
  const tone: PerformanceTone = score * 100 >= bands.greenBp ? 'verde' : score * 100 >= bands.yellowBp ? 'amarelo' : 'vermelho';
  return { score, tone, components };
}

/** Média da performance de um grupo (time, área): só quem tem nota. */
export const groupPerformance = (scores: (number | null)[]) => {
  const v = scores.filter((s): s is number => s !== null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
