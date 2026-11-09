/**
 * Calculadora de meta da gamificação: quantas tarefas (ou eventos) faltam para chegar a uma meta de pontos,
 * pelas regras aprovadas (pontos da tarefa + bônus de pontualidade e aderência + crédito por nível acima).
 * Mesma conta do cálculo oficial (scoreJourneys): bônus somam sobre a base; acima da alçada multiplica.
 */
import type { GamificationBonuses } from './gamification';

export type TaskConditions = { onTime: boolean; adherence: boolean; levelsAbove?: number };

/** Pontos de uma tarefa da jornada com as condições escolhidas. */
export function taskPointsWith(points: number, c: TaskConditions, b: Pick<GamificationBonuses, 'onTimeBp' | 'adherenceBp' | 'extraPerLevelBp'>): number {
  const base = points * (1 + (c.onTime ? b.onTimeBp / 10_000 : 0) + (c.adherence ? b.adherenceBp / 10_000 : 0));
  const above = Math.max(0, Math.floor(c.levelsAbove ?? 0));
  return Math.round((above > 0 ? base * (1 + (b.extraPerLevelBp * above) / 10_000) : base) * 10) / 10;
}

/** Quantas unidades (de pontos `each`) faltam para ir de `current` até `target`. */
export function unitsNeeded(target: number, current: number, each: number): number | null {
  if (!(each > 0) || !Number.isFinite(target)) return null;
  return Math.max(0, Math.ceil((Math.max(0, target - Math.max(0, current)) - 1e-9) / each));
}

export type PlanItem = { points: number; qty: number };
/** Plano com várias tarefas: total de pontos, quanto falta e o percentual da meta. */
export function planSummary(items: PlanItem[], target: number, current = 0) {
  const planned = Math.round(items.reduce((t, x) => t + Math.max(0, x.points) * Math.max(0, Math.floor(x.qty || 0)), 0) * 10) / 10;
  const total = Math.round((Math.max(0, current) + planned) * 10) / 10;
  const missing = Math.max(0, Math.round((target - total) * 10) / 10);
  return { planned, total, missing, pct: target > 0 ? Math.round((total / target) * 1000) / 10 : 0, reached: target > 0 && total >= target };
}

/**
 * Simulador da nota do mês (mesma fórmula de teamBoards): atingimento (com teto) + crédito extra (com teto) = próprio;
 * nota = próprio × peso + média do time × peso + nivelamento × peso + área × peso.
 */
export function simulateScore(a: {
  level: { expectedMonthlyPoints: number; scoresTasks: boolean; weights: { ownBp: number; teamBp: number; dispersionBp: number; areaBp: number } };
  bonuses: Pick<GamificationBonuses, 'scoreCapBp' | 'extraCapBp'>; dispersionRedBp: number;
  regular: number; extra: number; teamAverage: number; dispersionPct: number | null; area: number; months?: number;
}) {
  const expected = a.level.expectedMonthlyPoints * (a.months ?? 1);
  const ok = a.level.scoresTasks && expected > 0;
  const attainment = ok ? Math.min(a.bonuses.scoreCapBp / 10_000, Math.max(0, a.regular) / expected) * 100 : 0;
  const extraAttainment = ok ? Math.min(a.bonuses.extraCapBp / 10_000, Math.max(0, a.extra) / expected) * 100 : 0;
  const own = attainment + extraAttainment;
  const dispersion = a.dispersionPct == null ? 100 : Math.max(0, 1 - (a.dispersionPct * 100) / a.dispersionRedBp) * 100;
  const w = a.level.weights;
  const score = (own * w.ownBp + a.teamAverage * w.teamBp + dispersion * w.dispersionBp + a.area * w.areaBp) / 10_000;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { expected, attainment: r(attainment), extraAttainment: r(extraAttainment), own: r(own), dispersion: r(dispersion), score: r(score) };
}
