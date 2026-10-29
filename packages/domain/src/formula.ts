/**
 * Linguagem de fórmulas do Financial Studio: expressões tipadas, interpretadas com segurança (sem eval).
 *
 * Sintaxe: números (1.5, 15% = 0,15), VERDADEIRO, FALSO, NULO, variáveis (snake_case), + − * / ^,
 * comparações (> >= < <= == !=), parênteses e funções:
 *   SE(cond; sim; não) · E(...) · OU(...) · NAO(x) · MIN(...) · MAX(...) · ABS(x) · ARRED(x; casas) · VAZIO(x) · SE_VAZIO(x; padrão)
 *   ANUIDADE(taxa; n) · TAXA_MENSAL(anual) · TAXA_ANUAL(mensal) · VPL(série; taxa) · TIR(série) · PAYBACK(série; taxa) · SOMA(série)
 * O separador de argumentos pode ser ";" ou ",".
 * Nulos: aritmética com NULO dá NULO; divisão por zero dá NULO (com aviso); MIN/MAX ignoram nulos.
 */

export type FNode =
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'var'; name: string }
  | { k: 'neg'; a: FNode }
  | { k: 'bin'; op: BinOp; a: FNode; b: FNode }
  | { k: 'call'; fn: string; args: FNode[] };
export type BinOp = '+' | '-' | '*' | '/' | '^' | '>' | '>=' | '<' | '<=' | '==' | '!=';
export type FValue = number | boolean | null | number[];
export type FType = 'num' | 'bool' | 'serie' | 'any';

export class FormulaError extends Error {
  constructor(message: string, public pos = -1) { super(message); }
}

/** Funções disponíveis: aridade, tipo dos argumentos e do resultado (o que a lousa e o autocompletar mostram). */
export const FORMULA_FUNCTIONS: Record<string, { min: number; max: number; args: FType[] | 'nums' | 'bools'; ret: FType; desc: string; group: 'logica' | 'matematica' | 'financeira' }> = {
  SE: { min: 3, max: 3, args: ['bool', 'any', 'any'], ret: 'any', desc: 'SE(condição; valor se sim; valor se não)', group: 'logica' },
  E: { min: 1, max: 20, args: 'bools', ret: 'bool', desc: 'Verdadeiro se todas as condições forem verdadeiras', group: 'logica' },
  OU: { min: 1, max: 20, args: 'bools', ret: 'bool', desc: 'Verdadeiro se alguma condição for verdadeira', group: 'logica' },
  NAO: { min: 1, max: 1, args: ['bool'], ret: 'bool', desc: 'Inverte a condição', group: 'logica' },
  VAZIO: { min: 1, max: 1, args: ['any'], ret: 'bool', desc: 'Verdadeiro se o valor for NULO (não informado)', group: 'logica' },
  SE_VAZIO: { min: 2, max: 2, args: ['any', 'any'], ret: 'any', desc: 'SE_VAZIO(valor; padrão): o padrão quando o valor for NULO', group: 'logica' },
  MIN: { min: 1, max: 20, args: 'nums', ret: 'num', desc: 'Menor valor (ignora nulos)', group: 'matematica' },
  MAX: { min: 1, max: 20, args: 'nums', ret: 'num', desc: 'Maior valor (ignora nulos)', group: 'matematica' },
  ABS: { min: 1, max: 1, args: ['num'], ret: 'num', desc: 'Valor absoluto', group: 'matematica' },
  ARRED: { min: 1, max: 2, args: ['num', 'num'], ret: 'num', desc: 'ARRED(valor; casas): arredonda (meio para cima)', group: 'matematica' },
  ANUIDADE: { min: 2, max: 2, args: ['num', 'num'], ret: 'num', desc: 'Fator de anuidade: soma de 1/(1+taxa)^t, t = 1..n', group: 'financeira' },
  TAXA_MENSAL: { min: 1, max: 1, args: ['num'], ret: 'num', desc: 'Converte taxa anual em mensal: (1 + anual)^(1/12) − 1', group: 'financeira' },
  TAXA_ANUAL: { min: 1, max: 1, args: ['num'], ret: 'num', desc: 'Converte taxa mensal em anual: (1 + mensal)^12 − 1', group: 'financeira' },
  VPL: { min: 2, max: 2, args: ['serie', 'num'], ret: 'num', desc: 'Valor presente líquido da série à taxa (mês 0 sem desconto)', group: 'financeira' },
  TIR: { min: 1, max: 1, args: ['serie'], ret: 'num', desc: 'Taxa interna de retorno (mensal) da série; NULO sem troca de sinal', group: 'financeira' },
  PAYBACK: { min: 2, max: 2, args: ['serie', 'num'], ret: 'num', desc: 'Meses até a soma dos fluxos descontados ficar positiva (com fração do mês)', group: 'financeira' },
  SOMA: { min: 1, max: 1, args: ['serie'], ret: 'num', desc: 'Soma dos valores da série', group: 'financeira' },
};
const KEYWORDS: Record<string, FNode> = { VERDADEIRO: { k: 'bool', v: true }, FALSO: { k: 'bool', v: false }, NULO: { k: 'null' } };

// ------------------------------------------------------------------ tokens e análise
type Tok = { t: 'num' | 'id' | 'op' | '(' | ')' | ',' | 'end'; v: string; pos: number };
export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    const start = i;
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < src.length && /[0-9.]/.test(src[i]!)) i++;
      let v = src.slice(start, i);
      if ((v.match(/\./g) ?? []).length > 1) throw new FormulaError(`Número inválido: ${v}`, start);
      if (src[i] === '%') { i++; v = String(Number(v) / 100); }
      out.push({ t: 'num', v, pos: start });
      continue;
    }
    if (/[A-Za-z_À-ú]/.test(ch)) {
      while (i < src.length && /[A-Za-z0-9_À-ú]/.test(src[i]!)) i++;
      out.push({ t: 'id', v: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '<>'].includes(two)) { out.push({ t: 'op', v: two === '<>' ? '!=' : two, pos: start }); i += 2; continue; }
    if ('+-*/^><='.includes(ch)) { out.push({ t: 'op', v: ch === '=' ? '==' : ch, pos: start }); i++; continue; }
    if (ch === '(' || ch === ')') { out.push({ t: ch, v: ch, pos: start }); i++; continue; }
    if (ch === ',' || ch === ';') { out.push({ t: ',', v: ch, pos: start }); i++; continue; }
    throw new FormulaError(`Caractere não permitido: "${ch}"`, start);
  }
  out.push({ t: 'end', v: '', pos: src.length });
  return out;
}

/** Expressão → árvore (precedência: comparação < soma < produto < sinal < potência). */
export function parseFinFormula(src: string): FNode {
  if (!src.trim()) throw new FormulaError('Fórmula vazia.', 0);
  if (src.length > 4000) throw new FormulaError('Fórmula longa demais (máximo de 4.000 caracteres).', 0);
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const expect = (t: Tok['t'], what: string) => { const x = next(); if (x.t !== t) throw new FormulaError(`Esperado ${what}${x.t === 'end' ? ' antes do fim' : ` perto de "${x.v}"`}.`, x.pos); return x; };
  let depth = 0;
  const comparison = (): FNode => {
    let a = additive();
    while (peek().t === 'op' && ['>', '>=', '<', '<=', '==', '!='].includes(peek().v)) { const op = next().v as BinOp; a = { k: 'bin', op, a, b: additive() }; }
    return a;
  };
  const additive = (): FNode => {
    let a = multiplicative();
    while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const op = next().v as BinOp; a = { k: 'bin', op, a, b: multiplicative() }; }
    return a;
  };
  const multiplicative = (): FNode => {
    let a = unary();
    while (peek().t === 'op' && (peek().v === '*' || peek().v === '/')) { const op = next().v as BinOp; a = { k: 'bin', op, a, b: unary() }; }
    return a;
  };
  const unary = (): FNode => {
    if (peek().t === 'op' && peek().v === '-') { next(); return { k: 'neg', a: unary() }; }
    if (peek().t === 'op' && peek().v === '+') { next(); return unary(); }
    return power();
  };
  const power = (): FNode => {
    const base = primary();
    if (peek().t === 'op' && peek().v === '^') { next(); return { k: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  };
  const primary = (): FNode => {
    const x = next();
    if (x.t === 'num') { const v = Number(x.v); if (!Number.isFinite(v)) throw new FormulaError(`Número inválido: ${x.v}`, x.pos); return { k: 'num', v }; }
    if (x.t === '(') { if (++depth > 60) throw new FormulaError('Parênteses demais.', x.pos); const e = comparison(); expect(')', '")"'); depth--; return e; }
    if (x.t === 'id') {
      const up = x.v.toUpperCase();
      if (peek().t === '(') {
        if (!FORMULA_FUNCTIONS[up]) throw new FormulaError(`Função desconhecida: ${x.v}`, x.pos);
        next();
        const args: FNode[] = [];
        if (peek().t !== ')') { do { args.push(comparison()); } while (peek().t === ',' && next()); }
        expect(')', '")" para fechar a função');
        return { k: 'call', fn: up, args };
      }
      if (KEYWORDS[up]) return KEYWORDS[up]!;
      return { k: 'var', name: x.v.toLowerCase() };
    }
    throw new FormulaError(x.t === 'end' ? 'A fórmula termina no meio de uma operação.' : `Não esperado: "${x.v}"`, x.pos);
  };
  const ast = comparison();
  if (peek().t !== 'end') throw new FormulaError(`Sobrou "${peek().v}" no fim da fórmula.`, peek().pos);
  return ast;
}

const PREC: Record<BinOp, number> = { '>': 1, '>=': 1, '<': 1, '<=': 1, '==': 1, '!=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '^': 5 };
/** Árvore → texto canônico (o mesmo que o editor mostra e a lousa gera). */
export function printFinFormula(n: FNode, parent = 0, right = false): string {
  switch (n.k) {
    case 'num': return String(Number(n.v.toPrecision(15)));
    case 'bool': return n.v ? 'VERDADEIRO' : 'FALSO';
    case 'null': return 'NULO';
    case 'var': return n.name;
    case 'neg': { const s = `-${printFinFormula(n.a, 4)}`; return parent > 4 ? `(${s})` : s; }
    case 'call': return `${n.fn}(${n.args.map((a) => printFinFormula(a)).join('; ')})`;
    case 'bin': {
      const p = PREC[n.op];
      const s = `${printFinFormula(n.a, p, false)} ${n.op} ${printFinFormula(n.b, p, n.op !== '^')}`;
      return p < parent || (p === parent && (right ? n.op !== '^' : n.op === '^')) ? `(${s})` : s;
    }
  }
}

/** Variáveis referenciadas (sem repetir, na ordem em que aparecem). */
export function finFormulaRefs(n: FNode, out: string[] = []): string[] {
  if (n.k === 'var') { if (!out.includes(n.name)) out.push(n.name); }
  else if (n.k === 'neg') finFormulaRefs(n.a, out);
  else if (n.k === 'bin') { finFormulaRefs(n.a, out); finFormulaRefs(n.b, out); }
  else if (n.k === 'call') n.args.forEach((a) => finFormulaRefs(a, out));
  return out;
}

/** Checagem de tipos: variável conhecida, aridade e tipo dos argumentos; devolve o tipo do resultado. */
export function checkFinFormula(n: FNode, typeOf: (name: string) => FType | undefined): { type: FType; errors: string[] } {
  const errors: string[] = [];
  const walk = (x: FNode): FType => {
    switch (x.k) {
      case 'num': return 'num';
      case 'bool': return 'bool';
      case 'null': return 'any';
      case 'var': { const t = typeOf(x.name); if (!t) { errors.push(`Variável desconhecida: ${x.name}`); return 'any'; } return t; }
      case 'neg': { const t = walk(x.a); if (t === 'bool' || t === 'serie') errors.push('O sinal de menos só vale para números.'); return 'num'; }
      case 'bin': {
        const ta = walk(x.a), tb = walk(x.b);
        if (ta === 'serie' || tb === 'serie') errors.push(`A série só entra em VPL, TIR, PAYBACK ou SOMA (operação "${x.op}").`);
        if (['+', '-', '*', '/', '^', '>', '>=', '<', '<='].includes(x.op) && (ta === 'bool' || tb === 'bool')) errors.push(`"${x.op}" pede números, não condições.`);
        return ['>', '>=', '<', '<=', '==', '!='].includes(x.op) ? 'bool' : 'num';
      }
      case 'call': {
        const f = FORMULA_FUNCTIONS[x.fn]!;
        if (x.args.length < f.min || x.args.length > f.max) errors.push(`${x.fn} pede ${f.min === f.max ? f.min : `${f.min} a ${f.max}`} argumento(s).`);
        const types = x.args.map(walk);
        types.forEach((t, i) => {
          const want = f.args === 'nums' ? 'num' : f.args === 'bools' ? 'bool' : f.args[i] ?? 'any';
          if (want === 'serie' && (x.args[i]!.k !== 'var' || t !== 'serie')) errors.push(`${x.fn}: o ${i + 1}º argumento precisa ser uma série (ex.: fluxo).`);
          else if (want !== 'any' && want !== 'serie' && t !== 'any' && t !== want) errors.push(`${x.fn}: o ${i + 1}º argumento precisa ser ${want === 'num' ? 'número' : 'condição'}.`);
          else if (want !== 'serie' && t === 'serie') errors.push(`${x.fn}: série não é aceita aqui.`);
        });
        if (x.fn === 'SE') { const [, a, b] = types; return a === b ? (a ?? 'any') : a === 'any' ? (b ?? 'any') : b === 'any' ? (a ?? 'any') : 'any'; }
        if (x.fn === 'SE_VAZIO') return types[0] === 'any' ? (types[1] ?? 'any') : (types[0] ?? 'any');
        return f.ret;
      }
    }
  };
  const type = walk(n);
  return { type, errors: [...new Set(errors)] };
}

// ------------------------------------------------------------------ funções financeiras (as mesmas do motor)
export function annuityFactor(r: number, D: number) {
  if (D <= 0) return 0;
  if (r === 0) return D;
  let s = 0;
  for (let t = 1; t <= D; t++) s += 1 / (1 + r) ** t;
  return s;
}
export const npv = (flows: number[], r: number) => flows.reduce((s, f, t) => s + f / (1 + r) ** t, 0);
/** TIR mensal por bisseção (VPL = 0); null sem troca de sinal nos fluxos. */
export function irr(flows: number[]): number | null {
  if (!flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return null;
  let lo = -0.9999, hi = 10;
  let flo = npv(flows, lo);
  const fhi = npv(flows, hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(flows, mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
/**
 * Payback com interpolação: (k − 1) + saldo a recuperar no início do mês k ÷ FCₖ.
 * Com r > 0 é o payback descontado (cada FCₖ trazido a valor presente pela TMA); r = 0 = simples.
 */
export function paybackMonths(flows: number[], r = 0): number | null {
  let cum = flows[0] ?? 0;
  if (cum >= 0) return 0;
  for (let k = 1; k < flows.length; k++) {
    const f = flows[k]! / (1 + r) ** k;
    if (cum + f >= 0) return f > 0 ? k - 1 + -cum / f : k;
    cum += f;
  }
  return null;
}

// ------------------------------------------------------------------ avaliação
export type EvalEnv = { get: (name: string) => FValue; warn?: (msg: string) => void };
const isNum = (v: FValue): v is number => typeof v === 'number';
const ok = (v: number) => (Number.isFinite(v) ? v : null);

/** Avalia a árvore no ambiente (sem acesso a nada além das variáveis entregues pelo ambiente). */
export function evalFinFormula(n: FNode, env: EvalEnv): FValue {
  switch (n.k) {
    case 'num': return n.v;
    case 'bool': return n.v;
    case 'null': return null;
    case 'var': return env.get(n.name);
    case 'neg': { const a = evalFinFormula(n.a, env); return isNum(a) ? -a : null; }
    case 'bin': {
      const a = evalFinFormula(n.a, env), b = evalFinFormula(n.b, env);
      if (n.op === '==' || n.op === '!=') {
        if (a === null || b === null) return null;
        const eq = isNum(a) && isNum(b) ? Math.abs(a - b) < 1e-9 : a === b;
        return n.op === '==' ? eq : !eq;
      }
      if (!isNum(a) || !isNum(b)) return null;
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) { env.warn?.('Divisão por zero: resultado NULO.'); return null; } return a / b;
        case '^': return ok(a ** b);
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
      }
      return null;
    }
    case 'call': return callFn(n, env);
  }
}

function callFn(n: Extract<FNode, { k: 'call' }>, env: EvalEnv): FValue {
  const arg = (i: number) => evalFinFormula(n.args[i]!, env);
  const num = (i: number) => { const v = arg(i); return isNum(v) ? v : null; };
  const serie = (i: number) => { const v = arg(i); return Array.isArray(v) ? v : null; };
  switch (n.fn) {
    case 'SE': { const c = arg(0); return c === null ? null : c === true ? arg(1) : arg(2); }
    case 'E': { let nul = false; for (let i = 0; i < n.args.length; i++) { const v = arg(i); if (v === false) return false; if (v !== true) nul = true; } return nul ? null : true; }
    case 'OU': { let nul = false; for (let i = 0; i < n.args.length; i++) { const v = arg(i); if (v === true) return true; if (v !== false) nul = true; } return nul ? null : false; }
    case 'NAO': { const v = arg(0); return typeof v === 'boolean' ? !v : null; }
    case 'VAZIO': return arg(0) === null;
    case 'SE_VAZIO': { const v = arg(0); return v === null ? arg(1) : v; }
    case 'MIN': case 'MAX': {
      const vs = n.args.map((_, i) => num(i)).filter((v): v is number => v !== null);
      return vs.length ? (n.fn === 'MIN' ? Math.min(...vs) : Math.max(...vs)) : null;
    }
    case 'ABS': { const v = num(0); return v === null ? null : Math.abs(v); }
    case 'ARRED': { const v = num(0), c = n.args.length > 1 ? num(1) : 0; if (v === null || c === null) return null; const f = 10 ** Math.round(c); return (Math.sign(v) * Math.round(Math.abs(v) * f)) / f; }
    case 'ANUIDADE': { const r = num(0), k = num(1); return r === null || k === null ? null : annuityFactor(r, Math.round(k)); }
    case 'TAXA_MENSAL': { const v = num(0); return v === null ? null : ok((1 + v) ** (1 / 12) - 1); }
    case 'TAXA_ANUAL': { const v = num(0); return v === null ? null : ok((1 + v) ** 12 - 1); }
    case 'VPL': { const s = serie(0), r = num(1); return !s || !s.length || r === null ? null : npv(s, r); }
    case 'TIR': { const s = serie(0); return !s || !s.length ? null : irr(s); }
    case 'PAYBACK': { const s = serie(0), r = num(1); return !s || !s.length || r === null ? null : paybackMonths(s, r); }
    case 'SOMA': { const s = serie(0); return !s || !s.length ? null : s.reduce((a, b) => a + b, 0); }
  }
  return null;
}
