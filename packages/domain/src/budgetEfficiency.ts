/**
 * Inteligência de Eficiência Orçamentária (prompt master, itens 12 e 13): quanto resultado cada área produz com o que gasta.
 * Regras:
 * - custo por resultado = custo realizado ÷ resultados válidos; resultado por real = resultado em R$ atribuível ÷ custo realizado;
 * - variação de eficiência = (eficiência atual ÷ anterior − 1) × 100; desvio = realizado − aprovado; desvio % = desvio ÷ aprovado × 100;
 * - denominador zero ou dado ausente → null (nunca "infinito" nem zero inventado);
 * - redução de gasto sozinha NUNCA é chamada de eficiência; investimento pode amadurecer em períodos seguintes.
 */
export const ratio = (num: number | null | undefined, den: number | null | undefined) => (num === null || num === undefined || !den ? null : num / den);
export const pctChange = (cur: number | null | undefined, prev: number | null | undefined) => (cur === null || cur === undefined || prev === null || prev === undefined || prev === 0 ? null : Math.round(((cur / prev) - 1) * 1000) / 10);
export const deviationOf = (realized: number, approved: number) => ({ abs: realized - approved, pct: approved ? Math.round(((realized - approved) / approved) * 1000) / 10 : null });

/** Atribuição: direta (o resultado nasceu do item pago), influenciada (aconteceu com quem recebeu a ação) ou só correlação. */
export const ATTRIBUTIONS = ['direta', 'influenciada', 'correlacao'] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];
export const ATTRIBUTION_LABELS: Record<Attribution, string> = { direta: 'Atribuição direta', influenciada: 'Influenciado', correlacao: 'Correlação (não é causa)' };

export const EFFICIENCY_SITUATIONS = ['custo_sobe_resultado_cai', 'custo_cai_resultado_sobe', 'resultado_cresce_mais_que_custo', 'custo_cresce_mais_que_resultado', 'economia_com_perda', 'orcamento_ocioso', 'alto_investimento_baixo_retorno', 'sem_base'] as const;
export type EfficiencySituation = (typeof EFFICIENCY_SITUATIONS)[number];
export const EFFICIENCY_SITUATION_INFO: Record<EfficiencySituation, { label: string; tone: 'bom' | 'atencao' | 'neutro'; hint: string }> = {
  custo_sobe_resultado_cai: { label: 'Custo subindo e resultado caindo', tone: 'atencao', hint: 'Revise o que mudou no período; considere abrir um plano de ação.' },
  custo_cai_resultado_sobe: { label: 'Custo caindo e resultado subindo', tone: 'bom', hint: 'Ganho de produtividade: registre o que funcionou.' },
  resultado_cresce_mais_que_custo: { label: 'Resultado cresce mais que o custo', tone: 'bom', hint: 'O investimento extra está rendendo proporcionalmente mais.' },
  custo_cresce_mais_que_resultado: { label: 'Custo cresce mais que o resultado', tone: 'atencao', hint: 'O resultado acompanha, mas abaixo do aumento de gasto.' },
  economia_com_perda: { label: 'Economia com perda de resultado', tone: 'atencao', hint: 'Gastar menos não foi eficiência: o resultado também caiu.' },
  orcamento_ocioso: { label: 'Orçamento ocioso', tone: 'atencao', hint: 'Menos de 50% do aprovado executado (faixa de subexecução da política).' },
  alto_investimento_baixo_retorno: { label: 'Alto investimento e baixo retorno', tone: 'atencao', hint: 'Gasto acima da mediana dos centros e resultado por real abaixo da mediana.' },
  sem_base: { label: 'Sem base de comparação', tone: 'neutro', hint: 'Falta custo ou resultado no período anterior para comparar.' },
};

/** Situações de um centro/área no período, comparando com o período anterior de mesmo tamanho. */
export function diagnose(cur: { cost: number; result: number | null; approved: number }, prev: { cost: number; result: number | null }): EfficiencySituation[] {
  const out: EfficiencySituation[] = [];
  if (cur.approved > 0 && cur.cost / cur.approved < 0.5) out.push('orcamento_ocioso');
  const cv = pctChange(cur.cost, prev.cost), rv = pctChange(cur.result, prev.result);
  if (cv === null || rv === null) return out.length ? out : ['sem_base'];
  if (cv > 0 && rv < 0) out.push('custo_sobe_resultado_cai');
  else if (cv < 0 && rv > 0) out.push('custo_cai_resultado_sobe');
  else if (cv < 0 && rv < 0) out.push('economia_com_perda');
  else if (cv > 0 && rv > cv) out.push('resultado_cresce_mais_que_custo');
  else if (cv > 0 && rv >= 0 && rv < cv) out.push('custo_cresce_mais_que_resultado');
  return out;
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
/** Marca quem gasta acima da mediana e devolve abaixo da mediana (só entre centros com resultado comparável). */
export function lowReturn<T extends { cost: number; efficiency: number | null }>(rows: T[]) {
  const comparable = rows.filter((r) => r.efficiency !== null && r.cost > 0);
  const mc = median(comparable.map((r) => r.cost)), me = median(comparable.map((r) => r.efficiency!));
  return new Set(comparable.filter((r) => mc !== null && me !== null && r.cost > mc && r.efficiency! < me));
}

/** Índice base 100 (primeiro período com valor) para comparar séries de unidades diferentes no mesmo gráfico. */
export function indexBase100(values: (number | null)[]) {
  const base = values.find((v) => v !== null && v !== 0);
  return values.map((v) => (v === null || base === undefined || base === null ? null : Math.round((v / base) * 1000) / 10));
}
