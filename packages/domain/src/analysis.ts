/**
 * Gestão de Times — Fase 6: jornada de análise da intervenção.
 * Etapas: 1) Problema (o quê, onde, quando, quanto) → 2) Pareto (onde está a maior parte) → 3) Ishikawa (causas possíveis por categoria)
 * → 4) 5 Porquês sobre as causas escolhidas → 5) Conclusão (causas raiz confirmadas com evidência). A conclusão alimenta o plano de ação.
 */

export const ISHIKAWA_CATEGORIES = [
  { key: 'metodo', label: 'Método', hint: 'Processo, roteiro, abordagem, etapas do funil' },
  { key: 'mao_de_obra', label: 'Pessoas', hint: 'Capacidade, treinamento, distribuição da carteira' },
  { key: 'maquina', label: 'Ferramentas', hint: 'Sistemas, CRM, equipamentos, viabilidade técnica' },
  { key: 'material', label: 'Oferta', hint: 'Planos, preço, condições, cobertura' },
  { key: 'medida', label: 'Medição', hint: 'Meta, indicador, qualidade do dado' },
  { key: 'meio', label: 'Mercado', hint: 'Concorrência, sazonalidade, clima, economia' },
] as const;
export type IshikawaKey = (typeof ISHIKAWA_CATEGORIES)[number]['key'];

export type AnalysisProblem = { what: string; where: string; when: string; howMuch: string };
export type ParetoItem = { label: string; value: number };
export type AnalysisPareto = { title: string; source: 'manual' | 'motivos_perda' | 'motivos_perda_valor'; items: ParetoItem[] };
export type IshikawaCause = { id: string; category: IshikawaKey; text: string; selected: boolean };
export type WhyChain = { causeId: string; whys: string[]; rootCause: string; evidence: string; confirmed: boolean };
export type AnalysisContent = { problem: AnalysisProblem; pareto: AnalysisPareto | null; causes: IshikawaCause[]; whys: WhyChain[] };

export const EMPTY_ANALYSIS: AnalysisContent = { problem: { what: '', where: '', when: '', howMuch: '' }, pareto: null, causes: [], whys: [] };
export const ANALYSIS_STEPS = [
  { key: 'problema', label: 'Problema' },
  { key: 'pareto', label: 'Pareto' },
  { key: 'ishikawa', label: 'Ishikawa' },
  { key: 'porques', label: '5 Porquês' },
  { key: 'conclusao', label: 'Conclusão' },
] as const;

/** Pareto: ordena do maior para o menor, calcula participação e acumulado; "poucos vitais" são os itens até cruzar 80% (inclusive). */
export function paretoRows(items: ParetoItem[], cut = 0.8) {
  const pos = items.filter((i) => i.label.trim() && Number.isFinite(i.value) && i.value > 0);
  const total = pos.reduce((a, i) => a + i.value, 0);
  const sorted = [...pos].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  let acc = 0;
  let crossed = false;
  return {
    total,
    rows: sorted.map((i) => {
      const vital = !crossed;
      acc += i.value;
      const cumulative = total ? acc / total : 0;
      if (cumulative >= cut - 1e-9) crossed = true;
      return { ...i, share: total ? i.value / total : 0, cumulative, vital };
    }),
  };
}

const filled = (s: string | undefined, min = 3) => !!s && s.trim().length >= min;

/** Pendências para cada etapa; a conclusão exige todas resolvidas. */
export function analysisGaps(a: AnalysisContent) {
  const gaps: { step: (typeof ANALYSIS_STEPS)[number]['key']; message: string }[] = [];
  const p = a.problem;
  if (!filled(p.what, 10)) gaps.push({ step: 'problema', message: 'Descreva o problema (o quê) com pelo menos 10 caracteres.' });
  if (!filled(p.howMuch)) gaps.push({ step: 'problema', message: 'Informe o tamanho do desvio (quanto).' });
  if (!a.pareto || paretoRows(a.pareto.items).rows.length < 2) gaps.push({ step: 'pareto', message: 'Monte o Pareto com pelo menos 2 itens com valor.' });
  const selected = a.causes.filter((c) => c.selected && filled(c.text));
  if (a.causes.filter((c) => filled(c.text)).length < 3) gaps.push({ step: 'ishikawa', message: 'Liste pelo menos 3 causas possíveis no Ishikawa.' });
  if (!selected.length) gaps.push({ step: 'ishikawa', message: 'Escolha ao menos uma causa provável para investigar.' });
  const chains = a.whys.filter((w) => selected.some((c) => c.id === w.causeId));
  for (const c of selected) {
    const w = chains.find((x) => x.causeId === c.id);
    if (!w || w.whys.filter((x) => filled(x)).length < 3) gaps.push({ step: 'porques', message: `"${c.text}": responda pelo menos 3 porquês.` });
    else if (!filled(w.rootCause, 5)) gaps.push({ step: 'porques', message: `"${c.text}": registre a causa raiz encontrada.` });
  }
  if (!chains.some((w) => w.confirmed && filled(w.rootCause, 5) && filled(w.evidence, 5))) gaps.push({ step: 'conclusao', message: 'Confirme ao menos uma causa raiz com a evidência que a sustenta.' });
  return gaps;
}

/** Causas raiz confirmadas (texto + evidência), na ordem das causas escolhidas. */
export function confirmedRoots(a: AnalysisContent) {
  return a.whys.filter((w) => w.confirmed && filled(w.rootCause, 5)).map((w) => ({ causeId: w.causeId, category: a.causes.find((c) => c.id === w.causeId)?.category ?? null, rootCause: w.rootCause.trim(), evidence: w.evidence.trim() }));
}

/** Texto de diagnóstico para o plano, a partir da análise concluída. */
export function diagnosisFrom(a: AnalysisContent) {
  const cats = Object.fromEntries(ISHIKAWA_CATEGORIES.map((c) => [c.key, c.label]));
  const roots = confirmedRoots(a).map((r) => `- ${r.rootCause}${r.category ? ` (${cats[r.category]})` : ''} — evidência: ${r.evidence}`);
  const top = a.pareto ? paretoRows(a.pareto.items).rows.filter((r) => r.vital).map((r) => r.label) : [];
  return [`Problema: ${a.problem.what.trim().replace(/\.$/, '')}${a.problem.howMuch ? ` — tamanho do desvio: ${a.problem.howMuch.trim()}` : ''}.`, top.length ? `Concentração (Pareto): ${top.join(', ')}.` : '', 'Causas raiz:', ...roots].filter(Boolean).join('\n');
}
