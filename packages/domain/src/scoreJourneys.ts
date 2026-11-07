/**
 * Jornadas de pontuação: cada funil (tipo de venda) tem componentes = tarefas da etapa, com peso próprio.
 * - Tarefa da jornada concluída no CRM → pontos para quem concluiu; excluída ou reaberta → os pontos saem (cálculo sempre pela situação atual).
 * - Negócio ganho → o peso de "ganho" da jornada é dividido entre quem concluiu tarefas da jornada naquela oportunidade,
 *   na proporção dos pontos de cada um (sem tarefa concluída, não há pontos individuais). Tudo soma na métrica do time.
 * - Bônus sobre a tarefa: pontualidade (concluída até o prazo) e aderência (qualificada como aprovada pela gerência, não obrigatória).
 * - Alçada: tarefa de nível acima do de quem concluiu vira crédito extra, com bônus por nível acima (teto aplicado na nota).
 * Pesos vêm da regra de pontuação aprovada; nada fixo no código.
 */

export type ScoreComponent = { key: string; name: string; stageKey: string | null; points: number; dueDays: number; /** alçada: chave do nível de competência responsável (null = qualquer nível) */ level?: string | null };
export type ScoreJourney = { key: string; name: string; pipelineId: string; wonPoints: number; components: ScoreComponent[] };

export const componentRef = (journeyKey: string, componentKey: string) => `${journeyKey}:${componentKey}`;
export const parseComponentRef = (ref: string) => { const [j, c] = ref.split(':'); return j && c ? { journeyKey: j, componentKey: c } : null; };
const KEY = /^[a-z0-9_]{2,40}$/;

export function scoreJourneyErrors(js: ScoreJourney[]): string[] {
  const e: string[] = [];
  const keys = new Set<string>(), pipes = new Set<string>();
  for (const j of js) {
    if (!KEY.test(j.key)) e.push(`Jornada "${j.name}": chave inválida (minúsculas, números e _).`);
    if (keys.has(j.key)) e.push(`Jornada repetida: ${j.key}.`);
    keys.add(j.key);
    if (pipes.has(j.pipelineId)) e.push(`O funil da jornada "${j.name}" já tem outra jornada.`);
    pipes.add(j.pipelineId);
    if (!j.name.trim()) e.push('Toda jornada precisa de nome.');
    if (!Number.isInteger(j.wonPoints) || j.wonPoints < 0 || j.wonPoints > 10_000) e.push(`Jornada "${j.name}": pontos do ganho inválidos.`);
    if (!j.components.length) e.push(`Jornada "${j.name}": inclua pelo menos uma tarefa.`);
    const ck = new Set<string>();
    for (const c of j.components) {
      if (!KEY.test(c.key) || ck.has(c.key)) e.push(`Jornada "${j.name}": tarefa "${c.name}" com chave inválida ou repetida.`);
      ck.add(c.key);
      if (!c.name.trim()) e.push(`Jornada "${j.name}": tarefa sem nome.`);
      if (!Number.isInteger(c.points) || c.points < 0 || c.points > 10_000) e.push(`Jornada "${j.name}": pontos inválidos em "${c.name}".`);
      if (!Number.isInteger(c.dueDays) || c.dueDays < 0 || c.dueDays > 365) e.push(`Jornada "${j.name}": prazo inválido em "${c.name}".`);
    }
  }
  return e;
}

/** Chave estável a partir do nome (para novas jornadas e tarefas). */
export const slugKey = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';

export type JourneyTaskDone = { opportunityId: string; ref: string; userId: string; inPeriod: boolean; onTime?: boolean; approved?: boolean; taskId?: string };
export type JourneyWin = { opportunityId: string; pipelineId: string; ownerId: string };
export type JourneyCredit = {
  userId: string; points: number; source: 'tarefa' | 'ganho'; journeyKey: string; opportunityId: string;
  /** crédito extra: tarefa acima da alçada de quem concluiu */
  extra: boolean; taskId?: string;
  bonus?: { onTime: boolean; adherence: boolean; levelsAbove: number };
};
/** Contexto de níveis e bônus (regra aprovada); sem ele, só os pesos das tarefas. */
export type JourneyContext = { onTimeBp: number; adherenceBp: number; extraPerLevelBp: number; rankOfUser: (userId: string) => number; rankOfLevel: (key: string) => number | null };

/**
 * Créditos das jornadas no período: tarefas concluídas no período e ganhos do período.
 * `tasks` traz todas as tarefas de jornada concluídas das oportunidades envolvidas (inPeriod marca as do período).
 */
export function journeyCredits(journeys: ScoreJourney[], tasks: JourneyTaskDone[], wins: JourneyWin[], ctx?: JourneyContext): JourneyCredit[] {
  const pointsOf = (ref: string) => {
    const p = parseComponentRef(ref);
    const j = p && journeys.find((x) => x.key === p.journeyKey);
    const c = j?.components.find((x) => x.key === p!.componentKey);
    return j && c ? { journey: j, points: c.points, level: c.level ?? null } : null;
  };
  const out: JourneyCredit[] = [];
  for (const t of tasks) {
    if (!t.inPeriod) continue;
    const p = pointsOf(t.ref);
    if (!p || p.points <= 0) continue;
    const onTime = !!(ctx && t.onTime), adherence = !!(ctx && t.approved);
    const need = ctx && p.level ? ctx.rankOfLevel(p.level) : null;
    const levelsAbove = ctx && need != null ? Math.max(0, need - ctx.rankOfUser(t.userId)) : 0;
    const base = p.points * (1 + (onTime ? ctx!.onTimeBp / 10_000 : 0) + (adherence ? ctx!.adherenceBp / 10_000 : 0));
    const pts = levelsAbove > 0 ? base * (1 + (ctx!.extraPerLevelBp * levelsAbove) / 10_000) : base;
    out.push({ userId: t.userId, points: Math.round(pts * 10) / 10, source: 'tarefa', journeyKey: p.journey.key, opportunityId: t.opportunityId, extra: levelsAbove > 0, taskId: t.taskId, bonus: { onTime, adherence, levelsAbove } });
  }
  for (const w of wins) {
    const j = journeys.find((x) => x.pipelineId === w.pipelineId);
    if (!j || !j.wonPoints) continue;
    const by = new Map<string, number>();
    for (const t of tasks) {
      if (t.opportunityId !== w.opportunityId) continue;
      const p = pointsOf(t.ref);
      if (p && p.journey.key === j.key) by.set(t.userId, (by.get(t.userId) ?? 0) + p.points);
    }
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    // sem tarefa da jornada concluída (ex.: negócio de antes da regra), o ganho não gera pontos individuais
    if (!total) continue;
    for (const [u, pts] of by) out.push({ userId: u, points: Math.round((j.wonPoints * pts * 10) / total) / 10, source: 'ganho', journeyKey: j.key, opportunityId: w.opportunityId, extra: false });
  }
  return out;
}

/** Componentes que nascem como tarefa quando a oportunidade entra na etapa (stageKey null = na criação). */
export const componentsForStage = (j: ScoreJourney, stageKey: string | null, isCreation: boolean) =>
  j.components.filter((c) => (c.stageKey === null ? isCreation : c.stageKey === stageKey));
