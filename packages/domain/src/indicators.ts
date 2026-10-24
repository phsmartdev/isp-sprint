/**
 * Indicadores, metas/OKRs e scorecards (Etapa 6, 21/10/2026).
 *
 * Indicadores são calculados sobre os eventos de negócio válidos (Etapa 5), com o crédito de cada pessoa.
 * Fórmulas administrativas usam um interpretador próprio e restrito (números, variáveis declaradas,
 * + − × ÷, parênteses, min/max/abs/round): nenhum código é executado.
 */
import { EVENT_TYPE_KEYS } from './performance';

// ------------------------------------------------------------------ definição
export const INDICATOR_CALCS = ['contagem', 'soma', 'media', 'percentual', 'taxa', 'tempo', 'valor', 'razao', 'formula', 'informado'] as const;
export type IndicatorCalc = (typeof INDICATOR_CALCS)[number];
export const INDICATOR_CALC_LABELS: Record<IndicatorCalc, string> = {
  contagem: 'Contagem', soma: 'Soma', media: 'Média', percentual: 'Percentual (parte ÷ total × 100)', taxa: 'Taxa (por 100)', tempo: 'Tempo médio', valor: 'Valor monetário', razao: 'Razão (A ÷ B)', formula: 'Fórmula', informado: 'Informado por período (até a fonte ser integrada)',
};
export const INDICATOR_UNITS = ['quantidade', 'reais', 'percentual', 'horas', 'dias', 'minutos', 'indice'] as const;
export type IndicatorUnit = (typeof INDICATOR_UNITS)[number];
export const INDICATOR_UNIT_LABELS: Record<IndicatorUnit, string> = { quantidade: 'Quantidade', reais: 'R$', percentual: '%', horas: 'Horas', dias: 'Dias', minutos: 'Minutos', indice: 'Índice' };
export const PERIOD_TYPES = ['semana', 'mes', 'trimestre', 'ano', 'personalizado'] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];
export const PERIOD_LABELS: Record<PeriodType, string> = { semana: 'Semanal', mes: 'Mensal', trimestre: 'Trimestral', ano: 'Anual', personalizado: 'Personalizado' };
export const INDICATOR_CATEGORIES = ['comercial', 'contratos', 'atas', 'projetos', 'tarefas', 'aprovacoes', 'sucesso_cliente', 'abm', 'email', 'qualidade', 'prazos', 'colaboracao'] as const;
export const INDICATOR_CATEGORY_LABELS: Record<(typeof INDICATOR_CATEGORIES)[number], string> = {
  comercial: 'Comercial', contratos: 'Contratos', atas: 'Atas', projetos: 'Projetos', tarefas: 'Tarefas', aprovacoes: 'Aprovações', sucesso_cliente: 'Sucesso do Cliente', abm: 'ABM', email: 'E-mail', qualidade: 'Qualidade', prazos: 'Prazos', colaboracao: 'Colaboração',
};

/** Medidas sobre os eventos. `peso` = crédito de resultado da pessoa (1 venda dividida meio a meio conta 0,5 para cada). */
export const MEASURES = ['contagem', 'soma_valor', 'media_valor', 'media_campo'] as const;
export type Measure = (typeof MEASURES)[number];
/** Campos numéricos do contexto que podem ser medidos (lista fechada). */
export const NUMERIC_FIELDS = { minutesToComplete: 'Minutos entre criar e concluir', hoursToDecide: 'Horas para decidir', cycleDays: 'Dias do ciclo (criação → evento)', checklist: 'Itens de checklist', hoursToResolve: 'Horas até tratar', minutesToReply: 'Minutos até a primeira resposta' } as const;
export type NumericField = keyof typeof NUMERIC_FIELDS;
/** Filtros permitidos (lista fechada; valor sempre parametrizado). */
export const FILTER_FIELDS = {
  onTime: { label: 'No prazo', type: 'bool' }, selfCreated: { label: 'Criada pela própria pessoa', type: 'bool' }, approved: { label: 'Entrega aprovada', type: 'bool' }, hadDue: { label: 'Tinha prazo', type: 'bool' },
  saleType: { label: 'Tipo de venda', type: 'text' }, priority: { label: 'Prioridade', type: 'text' }, kind: { label: 'Tipo', type: 'text' }, outcome: { label: 'Resultado', type: 'text' }, level: { label: 'Alçada', type: 'text' }, severity: { label: 'Severidade', type: 'text' },
} as const;
export type FilterField = keyof typeof FILTER_FIELDS;
export type SourceFilter = { field: FilterField; op: 'eq' | 'ne'; value: string | boolean };
export type CreditScope = 'direto' | 'participacao' | 'gestao' | 'qualquer';
export type Source = { event: string; measure: Measure; field?: NumericField; filters?: SourceFilter[]; credit?: CreditScope };

export type IndicatorDef = {
  name: string;
  description?: string;
  category: (typeof INDICATOR_CATEGORIES)[number];
  calc: IndicatorCalc;
  unit: IndicatorUnit;
  direction: 'maior' | 'menor';
  period: Exclude<PeriodType, 'personalizado'>;
  /** contagem/soma/media/tempo/valor usam `base`; percentual/taxa/razao usam `numerator` e `denominator`; fórmula usa `vars` + `expr`. */
  base?: Source;
  numerator?: Source;
  denominator?: Source;
  vars?: Record<string, Source>;
  expr?: string;
  /** perfis a que se aplica (vazio = todos) */
  profiles?: string[];
  /** meta e peso padrão (usados quando a meta ou o scorecard não informam) */
  target?: number | null;
  weight?: number;
  /** abaixo desta amostra o resultado aparece como incompleto */
  minSample?: number;
  /** ficha do KPI (formulário de criação): metas desdobradas, limites, fonte e responsáveis */
  sheet?: KpiSheet;
};

export function validateSource(s: Source | undefined, path: string): string[] {
  if (!s) return [`${path}: informe a origem dos dados.`];
  const e: string[] = [];
  if (!(EVENT_TYPE_KEYS as string[]).includes(s.event)) e.push(`${path}: evento desconhecido.`);
  if (!MEASURES.includes(s.measure)) e.push(`${path}: medida inválida.`);
  if (s.measure === 'media_campo' && (!s.field || !(s.field in NUMERIC_FIELDS))) e.push(`${path}: escolha o campo da média.`);
  for (const f of s.filters ?? []) {
    if (!(f.field in FILTER_FIELDS)) e.push(`${path}: filtro desconhecido.`);
    else if (FILTER_FIELDS[f.field].type === 'bool' && typeof f.value !== 'boolean') e.push(`${path}: o filtro "${FILTER_FIELDS[f.field].label}" aceita só sim/não.`);
    if (!['eq', 'ne'].includes(f.op)) e.push(`${path}: operador inválido.`);
  }
  if (s.credit && !['direto', 'participacao', 'gestao', 'qualquer'].includes(s.credit)) e.push(`${path}: crédito inválido.`);
  return e;
}

export function validateIndicator(d: IndicatorDef): string[] {
  const e: string[] = [];
  if (!d.name || d.name.trim().length < 3) e.push('Dê um nome ao indicador (mínimo 3 caracteres).');
  if (!INDICATOR_CALCS.includes(d.calc)) e.push('Tipo de cálculo inválido.');
  if (!INDICATOR_UNITS.includes(d.unit)) e.push('Unidade inválida.');
  if (!['maior', 'menor'].includes(d.direction)) e.push('Direção inválida.');
  if (['contagem', 'soma', 'media', 'tempo', 'valor'].includes(d.calc)) e.push(...validateSource(d.base, 'Origem'));
  if (['percentual', 'taxa', 'razao'].includes(d.calc)) e.push(...validateSource(d.numerator, 'Parte (numerador)'), ...validateSource(d.denominator, 'Total (denominador)'));
  if (d.calc === 'informado' && d.sheet && d.sheet.quarterTargets.length !== 4) e.push('Informe as 4 metas trimestrais (ou deixe vazias).');
  if (d.calc === 'formula') {
    const names = Object.keys(d.vars ?? {});
    if (!names.length) e.push('A fórmula precisa de pelo menos uma variável.');
    for (const n of names) {
      if (!/^[a-z][a-z0-9_]{0,19}$/.test(n)) e.push(`Variável "${n}": use letras minúsculas, números e _ (começando por letra).`);
      e.push(...validateSource(d.vars![n], `Variável ${n}`));
    }
    const p = parseFormula(d.expr ?? '', names);
    if (!p.ok) e.push(`Fórmula: ${p.error}`);
  }
  if (d.weight !== undefined && (!(d.weight >= 0) || d.weight > 100)) e.push('Peso entre 0 e 100.');
  if (d.minSample !== undefined && (!Number.isInteger(d.minSample) || d.minSample < 0)) e.push('Amostra mínima deve ser inteira ≥ 0.');
  return e;
}

// ------------------------------------------------------------------ fórmula segura
type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };
export type Ast = { k: 'num'; v: number } | { k: 'var'; v: string } | { k: 'neg'; a: Ast } | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Ast; b: Ast } | { k: 'fn'; f: 'min' | 'max' | 'abs' | 'round'; args: Ast[] };
const FUNCS = { min: [2, 2], max: [2, 2], abs: [1, 1], round: [1, 2] } as const;

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      // vírgula só é decimal entre dígitos ("1,5"); com espaço ou ";" separa argumentos
      while (j < src.length && (/[0-9.]/.test(src[j]!) || (src[j] === ',' && /[0-9]/.test(src[j - 1] ?? '') && /[0-9]/.test(src[j + 1] ?? '')))) j++;
      const raw = src.slice(i, j).replace(',', '.');
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(raw)) return `número inválido "${src.slice(i, j)}"`;
      out.push({ t: 'num', v: Number(raw) });
      i = j;
      continue;
    }
    if (/[a-z_]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z0-9_]/i.test(src[j]!)) j++;
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/()×÷;'.includes(c)) { out.push({ t: 'op', v: c === '×' ? '*' : c === '÷' ? '/' : c === ';' ? ',' : c }); i++; continue; }
    if (c === ',') { out.push({ t: 'op', v: ',' }); i++; continue; }
    return `caractere não permitido "${c}"`;
  }
  return out;
}

/** Analisa a fórmula. Só aceita as variáveis declaradas. Nunca executa código. */
export function parseFormula(src: string, vars: string[]): { ok: true; ast: Ast } | { ok: false; error: string } {
  if (!src.trim()) return { ok: false, error: 'escreva a fórmula' };
  if (src.length > 300) return { ok: false, error: 'fórmula longa demais (máximo 300 caracteres)' };
  const toks = tokenize(src);
  if (typeof toks === 'string') return { ok: false, error: toks };
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const take = (v?: string) => { const t = toks[p]; if (v && !(t?.t === 'op' && t.v === v)) throw new Error(`esperava "${v}"`); p++; return t; };
  const expr = (): Ast => {
    let a = term();
    while (peek()?.t === 'op' && ['+', '-'].includes(peek()!.v as string)) { const op = take()!.v as '+' | '-'; a = { k: 'bin', op, a, b: term() }; }
    return a;
  };
  const term = (): Ast => {
    let a = unary();
    while (peek()?.t === 'op' && ['*', '/'].includes(peek()!.v as string)) { const op = take()!.v as '*' | '/'; a = { k: 'bin', op, a, b: unary() }; }
    return a;
  };
  const unary = (): Ast => {
    if (peek()?.t === 'op' && peek()!.v === '-') { take(); return { k: 'neg', a: unary() }; }
    if (peek()?.t === 'op' && peek()!.v === '+') { take(); return unary(); }
    return atom();
  };
  const atom = (): Ast => {
    const t = peek();
    if (!t) throw new Error('fórmula incompleta');
    if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
    if (t.t === 'id') {
      p++;
      if (t.v in FUNCS) {
        if (++depth > 20) throw new Error('aninhamento demais');
        take('(');
        const args = [expr()];
        while (peek()?.t === 'op' && peek()!.v === ',') { take(); args.push(expr()); }
        take(')');
        depth--;
        const [lo, hi] = FUNCS[t.v as keyof typeof FUNCS];
        if (args.length < lo || args.length > hi) throw new Error(`${t.v} recebe ${lo === hi ? lo : `${lo} ou ${hi}`} valor(es) — separe com "; " (a vírgula entre dígitos é decimal)`);
        return { k: 'fn', f: t.v as keyof typeof FUNCS, args };
      }
      if (!vars.includes(t.v)) throw new Error(`variável "${t.v}" não declarada`);
      return { k: 'var', v: t.v };
    }
    if (t.v === '(') {
      if (++depth > 20) throw new Error('aninhamento demais');
      take();
      const a = expr();
      take(')');
      depth--;
      return a;
    }
    throw new Error(`símbolo inesperado "${t.v}"`);
  };
  try {
    const ast = expr();
    if (p < toks.length) return { ok: false, error: `símbolo inesperado "${(toks[p] as { v: unknown }).v}"` };
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Avalia; divisão por zero ou variável sem dado → null (o indicador fica "sem base", nunca inventado). */
export function evalFormula(ast: Ast, vars: Record<string, number | null>): number | null {
  const ev = (n: Ast): number | null => {
    switch (n.k) {
      case 'num': return n.v;
      case 'var': return vars[n.v] ?? null;
      case 'neg': { const a = ev(n.a); return a === null ? null : -a; }
      case 'bin': {
        const a = ev(n.a); const b = ev(n.b);
        if (a === null || b === null) return null;
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        return b === 0 ? null : a / b;
      }
      case 'fn': {
        const xs = n.args.map(ev);
        if (xs.some((x) => x === null)) return null;
        const v = xs as number[];
        if (n.f === 'min') return Math.min(v[0]!, v[1]!);
        if (n.f === 'max') return Math.max(v[0]!, v[1]!);
        if (n.f === 'abs') return Math.abs(v[0]!);
        const d = Math.max(0, Math.min(6, Math.trunc(v[1] ?? 0)));
        return Math.round(v[0]! * 10 ** d) / 10 ** d;
      }
    }
  };
  const r = ev(ast);
  return r === null || !Number.isFinite(r) ? null : r;
}

/** Combina as partes já apuradas no valor final do indicador. */
export function combine(d: Pick<IndicatorDef, 'calc' | 'expr' | 'vars'>, parts: { base?: number | null; num?: number | null; den?: number | null; vars?: Record<string, number | null> }): number | null {
  switch (d.calc) {
    case 'percentual': return parts.den ? ((parts.num ?? 0) / parts.den) * 100 : null;
    case 'taxa': return parts.den ? ((parts.num ?? 0) / parts.den) * 100 : null;
    case 'razao': return parts.den ? (parts.num ?? 0) / parts.den : null;
    case 'formula': { const p = parseFormula(d.expr ?? '', Object.keys(d.vars ?? {})); return p.ok ? evalFormula(p.ast, parts.vars ?? {}) : null; }
    default: return parts.base ?? null;
  }
}

// ------------------------------------------------------------------ períodos
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T12:00:00Z`);
export function periodRange(type: Exclude<PeriodType, 'personalizado'>, ref: string): { from: string; to: string } {
  const d = utc(ref);
  if (type === 'semana') {
    const wd = (d.getUTCDay() + 6) % 7;
    const from = new Date(d); from.setUTCDate(d.getUTCDate() - wd);
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + 6);
    return { from: iso(from), to: iso(to) };
  }
  if (type === 'mes') return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))) };
  if (type === 'trimestre') { const q = Math.floor(d.getUTCMonth() / 3) * 3; return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), q, 1, 12))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), q + 3, 0, 12))) }; }
  return { from: `${d.getUTCFullYear()}-01-01`, to: `${d.getUTCFullYear()}-12-31` };
}
/** Período imediatamente anterior, de mesmo tamanho (para "atual × anterior"). */
export function previousRange(r: { from: string; to: string }, type?: PeriodType): { from: string; to: string } {
  if (type && type !== 'personalizado') { const before = utc(r.from); before.setUTCDate(before.getUTCDate() - 1); return periodRange(type, iso(before)); }
  const days = Math.round((utc(r.to).getTime() - utc(r.from).getTime()) / 86_400_000) + 1;
  const to = utc(r.from); to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to); from.setUTCDate(to.getUTCDate() - days + 1);
  return { from: iso(from), to: iso(to) };
}

// ------------------------------------------------------------------ metas
export const GOAL_SCOPES = ['individual', 'equipe', 'unidade', 'empresa'] as const;
export type GoalScope = (typeof GOAL_SCOPES)[number];
export const GOAL_SCOPE_LABELS: Record<GoalScope, string> = { individual: 'Individual', equipe: 'Equipe', unidade: 'Área / unidade', empresa: 'Empresa' };
/** ordem do desdobramento: empresa → área/unidade → equipe → pessoa */
export const GOAL_SCOPE_ORDER: GoalScope[] = ['empresa', 'unidade', 'equipe', 'individual'];
export const GOAL_CATEGORIES = ['comercial', 'projetos', 'operacional', 'qualidade', 'okr'] as const;
export const GOAL_CATEGORY_LABELS: Record<(typeof GOAL_CATEGORIES)[number], string> = { comercial: 'Comercial', projetos: 'Projetos', operacional: 'Operacional', qualidade: 'Qualidade', okr: 'Resultado-chave (OKR)' };
export type GoalStatus = 'atingida' | 'no_ritmo' | 'em_risco' | 'abaixo' | 'nao_atingida' | 'indisponivel' | 'nao_iniciada';
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = { atingida: 'Atingida', no_ritmo: 'No ritmo', em_risco: 'Em risco', abaixo: 'Abaixo do ritmo', nao_atingida: 'Não atingida', indisponivel: 'Sem dados', nao_iniciada: 'Não iniciada' };

/** Quanto do alvo foi cumprido (0–∞). Para "menor é melhor", estar abaixo do alvo é 100%+. */
export function attainment(value: number | null, target: number | null, direction: 'maior' | 'menor'): number | null {
  if (value === null || target === null) return null;
  if (direction === 'maior') return target === 0 ? (value >= 0 ? 1 : 0) : value / target;
  if (value <= 0) return value <= target ? 1.2 : 0;
  return target / value;
}

/**
 * Situação da meta pelo ritmo: compara o cumprido com a fração do período já decorrida.
 * Para "menor é melhor" (tempo, retrabalho) vale o valor atual contra o alvo, sem ritmo.
 */
export function goalStatus(value: number | null, target: number, direction: 'maior' | 'menor', range: { from: string; to: string }, today: string): { status: GoalStatus; attainment: number | null; expected: number | null } {
  if (today < range.from) return { status: 'nao_iniciada', attainment: null, expected: null };
  if (value === null) return { status: 'indisponivel', attainment: null, expected: null };
  const att = attainment(value, target, direction);
  const total = (utc(range.to).getTime() - utc(range.from).getTime()) / 86_400_000 + 1;
  const elapsed = Math.min(total, (utc(today).getTime() - utc(range.from).getTime()) / 86_400_000 + 1);
  const frac = Math.max(0, Math.min(1, elapsed / total));
  const ended = today > range.to;
  if (att !== null && att >= 1 && (direction === 'maior' || ended)) return { status: 'atingida', attainment: att, expected: direction === 'maior' ? target * frac : target };
  if (ended) return { status: att !== null && att >= 1 ? 'atingida' : 'nao_atingida', attainment: att, expected: target };
  if (direction === 'menor') return { status: att !== null && att >= 1 ? 'no_ritmo' : att !== null && att >= 0.85 ? 'em_risco' : 'abaixo', attainment: att, expected: target };
  const expected = target * frac;
  const pace = expected > 0 ? value / expected : 1;
  return { status: pace >= 0.95 ? 'no_ritmo' : pace >= 0.75 ? 'em_risco' : 'abaixo', attainment: att, expected };
}

// ------------------------------------------------------------------ scorecards
export type ScorecardItem = { indicatorId: string; weight: number; target?: number | null; cap?: number };
export type ScorecardDef = { items: ScorecardItem[]; cap: number };
export const DEFAULT_CAP = 1.2;

export function validateScorecard(d: ScorecardDef): string[] {
  const e: string[] = [];
  if (!d.items.length) e.push('Inclua pelo menos um indicador.');
  if (new Set(d.items.map((i) => i.indicatorId)).size !== d.items.length) e.push('Indicador repetido no scorecard.');
  if (d.items.some((i) => !(i.weight > 0) || i.weight > 100)) e.push('Cada peso deve ser maior que 0 e no máximo 100.');
  if (!(d.cap >= 1 && d.cap <= 2)) e.push('O teto de cumprimento deve ficar entre 100% e 200%.');
  return e;
}

/** Pesos normalizados: somam 1, qualquer que seja a escala digitada. */
export function normalizeWeights<T extends { weight: number }>(items: T[]): (T & { norm: number })[] {
  const sum = items.reduce((a, i) => a + Math.max(0, i.weight), 0);
  return items.map((i) => ({ ...i, norm: sum ? Math.max(0, i.weight) / sum : 0 }));
}

/**
 * Nota do scorecard (0–100 × teto). Indicadores sem dado ficam de fora e os pesos dos demais são renormalizados;
 * a nota é marcada como incompleta quando isso acontece.
 */
export function scorecardScore(items: { weight: number; attainment: number | null; cap?: number }[], cap = DEFAULT_CAP) {
  const usable = items.filter((i) => i.attainment !== null);
  const norm = normalizeWeights(usable);
  const score = usable.length ? norm.reduce((a, i) => a + Math.min(i.cap ?? cap, Math.max(0, i.attainment!)) * i.norm, 0) * 100 : null;
  return { score: score === null ? null : Math.round(score * 10) / 10, incomplete: usable.length < items.length, used: usable.length, total: items.length };
}

/** Pessoa com mais de uma função: nota composta pelos pesos explícitos de cada scorecard (normalizados). */
export function compositeScore(parts: { score: number | null; weight: number }[]) {
  const usable = parts.filter((p) => p.score !== null);
  const norm = normalizeWeights(usable);
  return usable.length ? Math.round(norm.reduce((a, p) => a + p.score! * p.norm, 0) * 10) / 10 : null;
}

// ------------------------------------------------------------------ sugestões
export const SUGGESTED_INDICATORS: (IndicatorDef & { key: string })[] = [
  { key: 'vendas_ganhas', name: 'Vendas ganhas', category: 'comercial', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'negociacao_ganha', measure: 'contagem' }, target: 10, weight: 30 },
  { key: 'receita_contratada', name: 'Receita mensal contratada', description: 'Soma do valor mensal dos contratos validados (crédito de resultado).', category: 'comercial', calc: 'valor', unit: 'reais', direction: 'maior', period: 'mes', base: { event: 'venda_validada', measure: 'soma_valor' }, weight: 30 },
  { key: 'conversao', name: 'Taxa de conversão', description: 'Ganhas ÷ (ganhas + perdidas) no período.', category: 'comercial', calc: 'formula', unit: 'percentual', direction: 'maior', period: 'mes', vars: { ganhas: { event: 'negociacao_ganha', measure: 'contagem' }, perdidas: { event: 'negociacao_perdida', measure: 'contagem' } }, expr: 'ganhas / (ganhas + perdidas) * 100', target: 30, weight: 20, minSample: 5 },
  { key: 'ciclo_venda', name: 'Ciclo médio de venda', description: 'Dias entre criar a oportunidade e ganhar.', category: 'comercial', calc: 'tempo', unit: 'dias', direction: 'menor', period: 'mes', base: { event: 'negociacao_ganha', measure: 'media_campo', field: 'cycleDays' }, target: 30, weight: 10, minSample: 3 },
  { key: 'propostas_enviadas', name: 'Propostas enviadas', category: 'comercial', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'proposta_enviada', measure: 'contagem' }, target: 20, weight: 10 },
  { key: 'tarefas_no_prazo', name: 'Tarefas concluídas no prazo', description: 'Só tarefas com prazo; as criadas e concluídas pela própria pessoa sem prazo não contam.', category: 'prazos', calc: 'percentual', unit: 'percentual', direction: 'maior', period: 'mes', numerator: { event: 'tarefa_concluida', measure: 'contagem', filters: [{ field: 'hadDue', op: 'eq', value: true }, { field: 'onTime', op: 'eq', value: true }] }, denominator: { event: 'tarefa_concluida', measure: 'contagem', filters: [{ field: 'hadDue', op: 'eq', value: true }] }, target: 90, weight: 20, minSample: 5 },
  { key: 'entregas_aprovadas', name: 'Entregas aprovadas', category: 'qualidade', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'entrega_validada', measure: 'contagem' }, weight: 20 },
  { key: 'marcos_no_prazo', name: 'Marcos de projeto no prazo', category: 'projetos', calc: 'percentual', unit: 'percentual', direction: 'maior', period: 'trimestre', numerator: { event: 'marco_concluido', measure: 'contagem', filters: [{ field: 'onTime', op: 'eq', value: true }] }, denominator: { event: 'marco_concluido', measure: 'contagem' }, target: 85, weight: 30, minSample: 2 },
  { key: 'tempo_aprovacao', name: 'Tempo médio para decidir aprovações', category: 'aprovacoes', calc: 'tempo', unit: 'horas', direction: 'menor', period: 'mes', base: { event: 'aprovacao_concluida', measure: 'media_campo', field: 'hoursToDecide' }, target: 24, weight: 20, minSample: 3 },
  { key: 'processos_contrato', name: 'Processos de contrato concluídos no prazo', category: 'contratos', calc: 'percentual', unit: 'percentual', direction: 'maior', period: 'mes', numerator: { event: 'processo_contrato_concluido', measure: 'contagem', filters: [{ field: 'onTime', op: 'eq', value: true }] }, denominator: { event: 'processo_contrato_concluido', measure: 'contagem' }, target: 90, weight: 30, minSample: 2 },
  { key: 'acompanhamentos', name: 'Acompanhamentos de clientes com resultado', category: 'sucesso_cliente', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'acompanhamento_registrado', measure: 'contagem' }, target: 20, weight: 30 },
  { key: 'movimentacoes_ata', name: 'Movimentações de ata efetivadas', description: 'Mede o processo concluído com documento, não o volume movimentado.', category: 'atas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'movimentacao_ata_autorizada', measure: 'contagem' }, weight: 20 },
  { key: 'abm_interacoes', name: 'Interações com contas do ABM', category: 'abm', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'abm_interacao', measure: 'contagem' }, target: 20, weight: 25 },
  { key: 'abm_stakeholders', name: 'Stakeholders mapeados', description: 'Pessoas incluídas nas contas do ABM.', category: 'abm', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'abm_stakeholder_mapeado', measure: 'contagem' }, target: 10, weight: 15 },
  { key: 'abm_decisores', name: 'Decisores mapeados', category: 'abm', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'abm_stakeholder_mapeado', measure: 'contagem', filters: [{ field: 'kind', op: 'eq', value: 'decisor' }] }, target: 3, weight: 15 },
  { key: 'abm_influencia', name: 'Avaliações de influência feitas', description: 'Conta o ato de avaliar (manual, com justificativa); o nível avaliado não entra na meta.', category: 'abm', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'abm_influencia_avaliada', measure: 'contagem' }, target: 10, weight: 10 },
  { key: 'abm_plays_sucesso', name: 'Plays encerrados com sucesso', description: 'Plays que atingiram o critério ÷ plays encerrados.', category: 'abm', calc: 'percentual', unit: 'percentual', direction: 'maior', period: 'trimestre', numerator: { event: 'abm_play_concluido', measure: 'contagem', filters: [{ field: 'outcome', op: 'eq', value: 'sucesso' }] }, denominator: { event: 'abm_play_concluido', measure: 'contagem' }, target: 60, weight: 15, minSample: 3 },
  { key: 'abm_tempo_sinal', name: 'Tempo médio para tratar sinais', category: 'abm', calc: 'tempo', unit: 'horas', direction: 'menor', period: 'mes', base: { event: 'abm_sinal_tratado', measure: 'media_campo', field: 'hoursToResolve' }, target: 72, weight: 10, minSample: 3 },
  { key: 'abm_pipeline', name: 'Pipeline gerado em contas do ABM', description: 'Valor mensal das oportunidades criadas em contas do ABM.', category: 'abm', calc: 'valor', unit: 'reais', direction: 'maior', period: 'mes', base: { event: 'abm_oportunidade_gerada', measure: 'soma_valor' }, weight: 10 },
  { key: 'email_primeira_resposta', name: 'Tempo de primeira resposta no e-mail', description: 'Média, em minutos, entre a chegada e a primeira resposta nas caixas compartilhadas.', category: 'email', calc: 'tempo', unit: 'minutos', direction: 'menor', period: 'mes', base: { event: 'email_respondido', measure: 'media_campo', field: 'minutesToReply' }, target: 240, weight: 15, minSample: 5 },
  { key: 'email_no_prazo', name: 'E-mails respondidos no prazo', description: 'Primeiras respostas dentro do prazo da fila ÷ primeiras respostas.', category: 'email', calc: 'percentual', unit: 'percentual', direction: 'maior', period: 'mes', numerator: { event: 'email_respondido', measure: 'contagem', filters: [{ field: 'outcome', op: 'eq', value: 'no_prazo' }] }, denominator: { event: 'email_respondido', measure: 'contagem' }, target: 90, weight: 15, minSample: 5 },
  { key: 'email_resolvidas', name: 'Conversas de e-mail resolvidas', category: 'email', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'email_resolvido', measure: 'contagem' }, weight: 10 },
];

// ------------------------------------------------------------------ objetivos, cascata e semáforo
export const OBJECTIVE_LEVELS = ['estrategico', 'tatico', 'operacional'] as const;
export type ObjectiveLevel = (typeof OBJECTIVE_LEVELS)[number];
export const OBJECTIVE_LEVEL_LABELS: Record<ObjectiveLevel, string> = { estrategico: 'Estratégico', tatico: 'Tático', operacional: 'Operacional' };
/** Um objetivo só se vincula a um superior de nível acima (estratégico → tático → operacional). */
export const canLinkObjective = (child: ObjectiveLevel, parent: ObjectiveLevel) => OBJECTIVE_LEVELS.indexOf(parent) < OBJECTIVE_LEVELS.indexOf(child);

export const CONSOLIDATIONS = ['indicador', 'soma', 'media_ponderada', 'media_simples', 'nao_agregavel'] as const;
export type Consolidation = (typeof CONSOLIDATIONS)[number];
export const CONSOLIDATION_LABELS: Record<Consolidation, string> = {
  indicador: 'Recalcular o indicador no conjunto (correto para taxas: numerador e denominador somados)',
  soma: 'Soma das metas filhas', media_ponderada: 'Média ponderada pelos pesos', media_simples: 'Média simples', nao_agregavel: 'Não agregável (cada meta vale por si)',
};
/** Consolida o realizado das filhas quando a meta superior não é recalculada pelo indicador. */
export function consolidate(method: Consolidation, children: { value: number | null; weight: number }[]): number | null {
  const v = children.filter((c) => c.value !== null) as { value: number; weight: number }[];
  if (!v.length || method === 'nao_agregavel' || method === 'indicador') return null;
  if (method === 'soma') return v.reduce((a, c) => a + c.value, 0);
  if (method === 'media_simples') return v.reduce((a, c) => a + c.value, 0) / v.length;
  const w = v.reduce((a, c) => a + Math.max(0, c.weight), 0);
  return w ? v.reduce((a, c) => a + c.value * Math.max(0, c.weight), 0) / w : null;
}

export type TrafficBands = { green: number; yellow: number };
export const DEFAULT_TRAFFIC_BANDS: TrafficBands = { green: 0.9, yellow: 0.85 };
export type TrafficColor = 'verde' | 'amarelo' | 'vermelho' | 'sem_dado';
export const TRAFFIC_LABELS: Record<TrafficColor, string> = { verde: 'Verde', amarelo: 'Amarelo', vermelho: 'Vermelho', sem_dado: 'Sem dado' };
/** Semáforo pelo atingimento (≥ verde; ≥ amarelo; abaixo, vermelho). Sem dado nunca vira cor. */
export function trafficLight(att: number | null, bands: TrafficBands = DEFAULT_TRAFFIC_BANDS): TrafficColor {
  if (att === null || !Number.isFinite(att)) return 'sem_dado';
  return att >= bands.green ? 'verde' : att >= bands.yellow ? 'amarelo' : 'vermelho';
}
export function validateBands(b: TrafficBands): string[] {
  return b.green > 0 && b.yellow > 0 && b.yellow <= b.green && b.green <= 2 ? [] : ['As faixas precisam de amarelo ≤ verde, ambos entre 0% e 200%.'];
}

// ------------------------------------------------------------------ apuração mensal e tendência
export const competenciaOf = (iso: string) => iso.slice(0, 7);
export function nextCompetencia(c: string) { const [y, m] = c.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
export const isConsecutive = (a: string, b: string) => nextCompetencia(a) === b;
export const CLOSING_STATUS_LABELS = { consolidado: 'Consolidado', validado: 'Validado', retificado: 'Retificado' } as const;

/** Tendência pelos últimos fechamentos (mais antigo → mais recente): compara a média da metade recente com a da metade anterior. */
export function trendOf(values: (number | null)[], direction: 'maior' | 'menor'): 'melhorando' | 'piorando' | 'estavel' | 'sem_historico' {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return 'sem_historico';
  const half = Math.floor(v.length / 2);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const old = avg(v.slice(0, half)); const recent = avg(v.slice(half));
  const base = Math.abs(old) || 1;
  const delta = (recent - old) / base;
  if (Math.abs(delta) < 0.03) return 'estavel';
  return (delta > 0) === (direction === 'maior') ? 'melhorando' : 'piorando';
}
export const TREND_LABELS = { melhorando: 'Melhorando', piorando: 'Piorando', estavel: 'Estável', sem_historico: 'Sem histórico' } as const;
/** Variação percentual entre dois valores (null se não dá para calcular). */
export const variation = (prev: number | null, cur: number | null) => (prev === null || cur === null || prev === 0 ? null : (cur - prev) / Math.abs(prev));

// ------------------------------------------------------------------ ficha do KPI (formulário de criação de indicadores)
export const KPI_AGGREGATIONS = ['media', 'ultimo', 'soma'] as const;
export type KpiAggregation = (typeof KPI_AGGREGATIONS)[number];
export const KPI_AGGREGATION_LABELS: Record<KpiAggregation, string> = { media: 'Média dos meses lançados', ultimo: 'Último mês lançado', soma: 'Soma dos meses' };
export type KpiSheet = {
  area: string | null; objective: string | null; formulaText: string | null; sourceSystem: string | null;
  owner: string | null; collector: string | null; tool: string | null;
  measureFreq: 'mes' | 'trimestre'; reviewFreq: string | null; audience: string | null;
  strategicObjective: string | null; process: string | null; impact: string | null; related: string | null;
  startDate: string | null; notes: string | null;
  /** meta de cada trimestre (1T a 4T), na unidade do indicador; null = usa a anual */
  quarterTargets: (number | null)[];
  /** mínimo aceitável (valor) ou como fração da meta (ex.: 0,8 = 80% da meta) */
  minAcceptable: number | null; minOfTarget: number | null;
  maxDesirable: number | null;
  /** como o trimestre e o ano consolidam os meses lançados */
  aggregation: KpiAggregation;
  featured: boolean; paused: boolean;
  /** indicador principal da área: é o do gráfico de evolução no painel */
  main?: boolean;
};
export const KPI_STATUS = ['atingido', 'atencao', 'abaixo', 'sem_dado'] as const;
export type KpiStatus = (typeof KPI_STATUS)[number];
export const KPI_STATUS_LABELS: Record<KpiStatus, string> = { atingido: 'Meta atingida', atencao: 'Dentro do limite', abaixo: 'Fora do limite', sem_dado: 'Sem resultado' };

/** Meta do período: trimestre (1 a 4) usa a meta trimestral da ficha; sem ela (ou no ano), a anual. */
export function kpiTarget(def: Pick<IndicatorDef, 'target' | 'sheet'>, quarter: number | null) {
  if (quarter && def.sheet?.quarterTargets?.[quarter - 1] != null) return def.sheet.quarterTargets[quarter - 1]!;
  return def.target ?? null;
}
/**
 * Farol do KPI. Maior é melhor: atingido ≥ meta; atenção ≥ mínimo aceitável; abaixo do mínimo.
 * Menor é melhor: atingido ≤ meta; atenção ≤ máximo desejável; acima disso, fora.
 */
/** Faixas do farol na unidade do KPI (as mesmas regras de kpiStatus), para desenhar a régua. */
export function kpiBands(def: Pick<IndicatorDef, 'direction' | 'sheet'>, target: number) {
  const sh = def.sheet;
  if (def.direction === 'menor') return { direction: 'menor' as const, target, limit: sh?.maxDesirable != null && sh.maxDesirable > target ? sh.maxDesirable : target * 1.2 };
  return { direction: 'maior' as const, target, limit: sh?.minOfTarget != null ? target * sh.minOfTarget : sh?.minAcceptable != null && sh.minAcceptable < target ? sh.minAcceptable : target * 0.8 };
}
export function kpiStatus(def: Pick<IndicatorDef, 'direction' | 'sheet'>, value: number | null, target: number | null): KpiStatus {
  if (value === null || value === undefined || target === null) return 'sem_dado';
  const sh = def.sheet;
  if (def.direction === 'menor') {
    if (value <= target) return 'atingido';
    const ceiling = sh?.maxDesirable != null && sh.maxDesirable > target ? sh.maxDesirable : target * 1.2;
    return value <= ceiling ? 'atencao' : 'abaixo';
  }
  if (value >= target) return 'atingido';
  const floor = sh?.minOfTarget != null ? target * sh.minOfTarget : sh?.minAcceptable != null && sh.minAcceptable < target ? sh.minAcceptable : target * 0.8;
  return value >= floor ? 'atencao' : 'abaixo';
}
/** Atingimento (% da meta): menor é melhor inverte a razão. */
export function kpiAttainment(direction: 'maior' | 'menor', value: number | null, target: number | null) {
  if (value === null || target === null || target === 0) return null;
  if (direction === 'menor') return value === 0 ? 1 : target / value;
  return value / target;
}
export function aggregate(values: number[], how: KpiAggregation) {
  if (!values.length) return null;
  if (how === 'soma') return values.reduce((t, v) => t + v, 0);
  if (how === 'ultimo') return values[values.length - 1]!;
  return Math.round((values.reduce((t, v) => t + v, 0) / values.length) * 1000) / 1000;
}

// ------------------------------------------------------------------ leitura do formulário (.xlsx) de criação de KPI
type Cell = string | number | null;
const norm = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const num = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
/** "45%", 0.45 (célula em %), "2 dias", "80% da meta" → número na unidade do indicador. */
function parseAmount(v: Cell, unit: IndicatorUnit): number | null {
  if (v === null || v === '') return null;
  if (typeof v === 'number') return unit === 'percentual' && Math.abs(v) <= 1.5 ? Math.round(v * 10000) / 100 : v;
  const m = String(v).match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = num(m[0]);
  if (unit === 'percentual' && !/%/.test(String(v)) && Math.abs(n) <= 1.5) return Math.round(n * 10000) / 100;
  return n;
}
/** "1T e 4T - 35% / 2T - 60% / 3T - 50%" → [35, 60, 50, 35]; número único vale para os quatro. */
export function parseQuarterTargets(v: Cell, unit: IndicatorUnit): (number | null)[] {
  const out: (number | null)[] = [null, null, null, null];
  if (v === null || v === '') return out;
  if (typeof v === 'number' || !/[1-4]\s*T/i.test(String(v))) { const n = parseAmount(v, unit); return [n, n, n, n]; }
  const re = /((?:[1-4]\s*T\s*(?:e|,|\/)?\s*)+)\s*[-–:]?\s*(\d+(?:[.,]\d+)?)\s*(%|dias?)?/gi;
  for (const m of String(v).matchAll(re)) {
    const val = num(m[2]!);
    for (const q of m[1]!.matchAll(/([1-4])\s*T/gi)) out[Number(q[1]) - 1] = val;
  }
  return out;
}
const LABELS: Record<string, string> = {
  'nome do kpi': 'name', 'departamento/area': 'area', 'objetivo do kpi': 'objective', 'descricao detalhada': 'description', 'formula de calculo': 'formula',
  'unidade de medida': 'unit', 'fonte de dados': 'source', 'meta anual': 'annual', 'meta trimestral': 'quarterly', 'limite minimo aceitavel': 'min', 'limite maximo desejavel': 'max',
  'frequencia de medicao': 'freq', 'objetivo estrategico': 'strategic', 'processo relacionado': 'process', 'impacto esperado': 'impact', 'kpis relacionados': 'related',
  'data de inicio': 'start', 'responsavel pela coleta de dados': 'collector', 'ferramenta de acompanhamento': 'tool', 'frequencia de revisao': 'review', 'publico-alvo para relatorio': 'audience',
  'observacoes adicionais': 'notes', responsavel: 'owner',
};
const CATEGORY_OF = (area: string): IndicatorDef['category'] => {
  const a = norm(area);
  if (a.includes('sucesso')) return 'sucesso_cliente';
  if (a.includes('marketing') || a.includes('abm')) return 'abm';
  if (a.includes('contrat')) return 'contratos';
  return 'comercial';
};
export type ParsedKpi = { key: string; sheetName: string; def: IndicatorDef; warnings: string[] };
/**
 * Uma aba do formulário de criação de KPI (rótulo numa célula, valor na seguinte) vira a definição do indicador.
 * Datas chegam como ISO (aaaa-mm-dd). Nome da aba com "pausar" marca o KPI como pausado.
 */
export function parseKpiForm(sheetName: string, rows: Cell[][]): ParsedKpi | null {
  const f: Record<string, Cell> = {};
  for (const r of rows) {
    const cells = r.filter((c) => c !== null && c !== '');
    if (cells.length < 2 || typeof cells[0] !== 'string') continue;
    const k = LABELS[norm(cells[0])];
    if (k && !(k in f)) f[k] = cells[1]!;
  }
  if (!f.name || typeof f.name !== 'string') return null;
  const warnings: string[] = [];
  const text = (k: string) => (f[k] === undefined || f[k] === null || String(f[k]).trim() === '' ? null : String(f[k]).trim());
  const name = String(f.name).replace(/\s+/g, ' ').trim();
  const unitRaw = norm(text('unit') ?? '');
  const annualRaw = text('annual') ?? '';
  const unit: IndicatorUnit = unitRaw.includes('%') || unitRaw.includes('percent') ? 'percentual' : unitRaw.includes('dia') || /dias?/.test(norm(annualRaw)) || unitRaw === 'data' ? 'dias' : unitRaw.includes('r$') || unitRaw.includes('reais') ? 'reais' : unitRaw.includes('hora') ? 'horas' : 'quantidade';
  const target = parseAmount(f.annual ?? null, unit);
  if (target === null) warnings.push('Meta anual não encontrada: informe antes de acompanhar.');
  const quarterTargets = parseQuarterTargets(f.quarterly ?? null, unit);
  const minText = text('min');
  const minOfTarget = minText && /meta/i.test(minText) ? (parseAmount(minText, 'quantidade') ?? 0) / 100 : null;
  const minAcceptable = minOfTarget === null ? parseAmount(f.min ?? null, unit) : null;
  const maxText = text('max');
  const maxDesirable = maxText && /qual/i.test(maxText) ? null : parseAmount(f.max ?? null, unit);
  const blob = norm(`${name} ${text('objective') ?? ''}`);
  const direction: 'maior' | 'menor' = /concentra|lead time|tempo|prazo|dependencia/.test(blob) || unit === 'dias' ? 'menor' : 'maior';
  const freq = norm(text('freq') ?? '');
  const sheet: KpiSheet = {
    area: text('area'), objective: text('objective'), formulaText: text('formula'), sourceSystem: text('source'), owner: text('owner'), collector: text('collector'), tool: text('tool'),
    measureFreq: freq.includes('trimes') ? 'trimestre' : 'mes', reviewFreq: text('review'), audience: text('audience'), strategicObjective: text('strategic'), process: text('process'),
    impact: text('impact'), related: text('related'), startDate: typeof f.start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f.start) ? f.start.slice(0, 10) : null, notes: text('notes'),
    quarterTargets, minAcceptable, minOfTarget, maxDesirable, aggregation: 'media', featured: true, paused: /\(?\s*paus/i.test(sheetName),
  };
  const key = `kpi_${norm(name).replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 40);
  const def: IndicatorDef = { name: name.slice(0, 120), description: text('description')?.slice(0, 1000), category: CATEGORY_OF(sheet.area ?? ''), calc: 'informado', unit, direction, period: sheet.measureFreq, target, sheet };
  return { key, sheetName, def, warnings };
}
