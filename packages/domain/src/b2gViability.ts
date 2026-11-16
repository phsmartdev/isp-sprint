/**
 * Viabilidade comercial B2G (licitações e atas de registro de preço): liga "Produtos e serviços" à "Viabilidade econômica".
 *
 * Mesmas definições de margem do motor FINANCE (só muda a base das despesas fixas, como aprovado):
 *   Margem de contribuição (MC) = receita − tributos − despesas variáveis − custo
 *   Margem de operação (MO)     = MC − glosa/inadimplência − despesas fixas rateadas (só na Implantação, venda única)
 *   Margem líquida (ML)         = MO − IR/CSLL (sobre MO positiva)
 *
 * Perfis de custo (cestas): Fornecimento (venda pura) não recebe rateio; Implantação recebe.
 *   Venda única + Implantação: rateio = % do PREÇO (na etapa do markup; MC 35% com rateio 35% zera a MO).
 *   Recorrente: rateio = % do CUSTO DIRETO da implantação, somado ao investimento inicial antes do payback.
 * Recorrente: Mensalidade = (Investimento ÷ payback + custo mensal) ÷ (1 − tributos − despesas variáveis).
 * Modo A: custo → preço (margem desejada ou target seek). Modo B: preço do edital → margens, piso, desconto e faixa de lance.
 * Decisão global, com alerta por produto (nenhum produto negativo compensado por outro). Alerta, nunca bloqueio.
 * Dinheiro em centavos; percentuais em frações (0,35 = 35%).
 */
import { applyFiscalEnvelope, type CostLine, type DealKind, type EngineArgs } from './finance';

export type CostProfile = 'fornecimento' | 'implantacao';
export const COST_PROFILES: CostProfile[] = ['fornecimento', 'implantacao'];
export const COST_PROFILE_LABELS: Record<CostProfile, string> = { fornecimento: 'Fornecimento (venda pura)', implantacao: 'Implantação (instalação ou fornecimento + instalação)' };
export const COST_PROFILE_SHORT: Record<CostProfile, string> = { fornecimento: 'Fornecimento', implantacao: 'Implantação' };
/** Perfil padrão pelo tipo do produto: venda = fornecimento; serviço, recorrência e locação = implantação (alterável na oportunidade). */
export const defaultCostProfile = (k: DealKind): CostProfile => (k === 'venda' ? 'fornecimento' : 'implantacao');
export type RevenueKind = 'unica' | 'recorrente';
export const revenueOf = (k: DealKind): RevenueKind => (k === 'venda' || k === 'servico' ? 'unica' : 'recorrente');

export type B2gProduct = {
  id: string; description: string; kind: DealKind; profile: CostProfile;
  /** valor estimado do órgão: total do produto (unitário × quantidade); no recorrente, por mês */ estimatedCents: number;
  /** lance simulado (Modo B); sem ele vale o estimado */ bidCents?: number | null;
  doc: { name: string; taxBp: number; fixedCents: number } | null;
};
export type B2gParams = {
  mode: 'A' | 'B';
  /** despesas variáveis (% do preço), glosa + inadimplência (% da receita), IR/CSLL sobre o lucro */
  variableBp: number; riskBp: number; incomeTaxBp: number | null;
  /** despesas fixas rateadas (padrão das Configurações, editável na oportunidade) */ overheadBp: number;
  /** margem líquida mínima (Configurações, definida pela diretoria); null = não configurada */ netMinBp: number | null;
  /** alvo de margem líquida do target seek (venda única e recorrente) */ netTargetBp?: number | null;
  /** margem de contribuição manual por cesta (venda única); sem ela, vem do target seek */ contributionBp?: Partial<Record<CostProfile, number | null>>;
  /** contingências das Configurações, sobre custo direto e custo mensal */ contingencyCapexBp?: number; contingencyOpexBp?: number;
  /** vigência (meses) e payback (meses, entrada ou resolvido pelo target seek) */ termMonths: number; paybackMonths?: number | null;
  /** resolver o payback pela margem líquida alvo (recorrente) */ solvePayback?: boolean;
  /** prazo médio de pagamento do órgão (dias), só informativo: payback de caixa */ paymentTermDays?: number | null;
  /** peso manual (fração 0..1) dentro da cesta, por produto: exceção */ weights?: Record<string, number>;
};

const bp = (v: number | null | undefined) => (v == null ? 0 : v / 10_000);
const lineTotal = (l: CostLine) => Math.round((l.qtyMilli * l.unitCents) / 1000);
const isVarFixed = (l: CostLine) => l.impact === 'entrega' || l.impact === 'taxa_venda';

/** Custo direto da engenharia por bloco e cesta (cada linha de custo diz de qual tipo de negociação sai). */
export function b2gCosts(capex: CostLine[], opex: CostLine[], extraInitialCents = 0) {
  const c = { unica: { fornecimento: 0, implantacao: 0 }, recorrente: { fornecimento: 0, implantacao: 0 }, mensal: 0, variavel: 0, semCesta: 0 };
  for (const l of capex) {
    const v = lineTotal(l);
    if (isVarFixed(l)) { c.variavel += v; continue; }
    if (!l.kind) { c.semCesta += v; continue; }
    if (revenueOf(l.kind) === 'unica') c.unica[l.kind === 'venda' ? 'fornecimento' : 'implantacao'] += v;
    // no recorrente, material/equipamento é fornecimento (sem rateio); o resto é implantação
    else c.recorrente[l.impact === 'material' ? 'fornecimento' : 'implantacao'] += v;
  }
  c.semCesta += extraInitialCents;
  for (const l of opex) c.mensal += lineTotal(l);
  return c;
}

type Group = { products: B2gProduct[]; cost: number };
/** Distribui o custo da cesta entre os produtos: peso = valor estimado (unit. × qtd), com override manual como exceção. */
export function distribute(products: B2gProduct[], cost: number, weights?: Record<string, number>) {
  if (!products.length) return new Map<string, number>();
  const fixed = products.filter((p) => weights?.[p.id] != null);
  const fixedSum = fixed.reduce((t, p) => t + Math.max(0, weights![p.id]!), 0);
  const scale = fixedSum > 1 ? 1 / fixedSum : 1;
  const rest = products.filter((p) => weights?.[p.id] == null);
  const restShare = Math.max(0, 1 - fixedSum * scale);
  const base = rest.reduce((t, p) => t + Math.max(0, p.estimatedCents), 0);
  const w = new Map<string, number>();
  for (const p of fixed) w.set(p.id, Math.max(0, weights![p.id]!) * scale);
  for (const p of rest) w.set(p.id, restShare * (base > 0 ? Math.max(0, p.estimatedCents) / base : 1 / rest.length));
  // soma exata: o último recebe a diferença de arredondamento
  const out = new Map<string, number>();
  let left = cost;
  products.forEach((p, k) => { const v = k === products.length - 1 ? left : Math.round(cost * w.get(p.id)!); out.set(p.id, v); left -= v; });
  return out;
}

export type B2gLine = {
  id: string; description: string; profile: CostProfile; revenue: RevenueKind; doc: string | null; taxPct: number;
  estimatedCents: number; costCents: number; weightPct: number;
  /** preço avaliado (único; no recorrente, mensal) */ priceCents: number | null;
  /** markup por produto = preço ÷ custo */ markup: number | null;
  contributionCents: number | null; contributionPct: number | null; overheadCents: number; overheadBase: 'preco' | 'custo' | null;
  operatingCents: number | null; operatingPct: number | null; netCents: number | null; netPct: number | null;
  floorCents: number | null; maxDiscountPct: number | null; bidRange: { from: number; to: number } | null;
  /** recorrente */ investmentCents?: number; monthlyCostCents?: number; paybackMonths?: number | null; cashPaybackMonths?: number | null;
  alerts: string[];
};
export type B2gBlock = {
  revenue: RevenueKind; lines: B2gLine[];
  priceCents: number; costCents: number; contributionCents: number; overheadCents: number; operatingCents: number; netCents: number; netPct: number | null;
  /** recorrente */ investmentCents?: number; directImplCents?: number; overheadOnCostCents?: number; monthlyCostCents?: number; monthlyPriceCents?: number; termMonths?: number; paybackMonths?: number | null; paybackStatus?: string | null;
  cascade?: { profile: CostProfile; contributionPct: number | null; overheadPct: number; operatingPct: number | null }[];
};
export type B2gResult = {
  mode: 'A' | 'B'; blocked: { id: string; description: string }[];
  kinds: { unica: boolean; recorrente: boolean };
  unica: B2gBlock | null; recorrente: B2gBlock | null;
  global: { priceCents: number; costCents: number; markup: number | null; netCents: number; netPct: number | null; floorCents: number | null; estimatedCents: number; maxDiscountPct: number | null };
  byDoc: { doc: string; priceCents: number; costCents: number; markup: number | null }[];
  verdict: 'viavel' | 'abaixo_minimo' | 'produto_abaixo' | 'produto_negativo' | 'sem_minimo' | 'bloqueado';
  alerts: string[]; notes: string[];
  costs: ReturnType<typeof b2gCosts>;
};

function chain(P: number, cost: number, a: number, fixed: number, p: B2gParams, overheadPct: number) {
  const v = bp(p.variableBp), r = bp(p.riskBp), ir = bp(p.incomeTaxBp);
  const contribution = P - a * P - fixed - v * P - cost;
  const overhead = overheadPct * P;
  const operating = contribution - r * P - overhead;
  const net = operating - ir * Math.max(0, operating);
  return { contribution, overhead, operating, net };
}
/** Preço em que a margem líquida (venda única) é exatamente `L`. */
function oneTimeFloor(cost: number, a: number, fixed: number, p: B2gParams, overheadPct: number, L: number) {
  const v = bp(p.variableBp), r = bp(p.riskBp), ir = bp(p.incomeTaxBp);
  const k = 1 - a - v - r - overheadPct;
  const d = L >= 0 ? k - L / (1 - ir) : k - L;
  return d > 0 ? (cost + fixed) / d : null;
}

export function b2gViability(products: B2gProduct[], capex: CostLine[], opex: CostLine[], p: B2gParams, extraInitialCents = 0): B2gResult {
  const costs = b2gCosts(capex, opex, extraInitialCents);
  const alerts: string[] = [], notes: string[] = [];
  const blocked = products.filter((x) => !x.doc).map((x) => ({ id: x.id, description: x.description }));
  const kinds = { unica: products.some((x) => revenueOf(x.kind) === 'unica'), recorrente: products.some((x) => revenueOf(x.kind) === 'recorrente') };
  const empty: B2gResult = { mode: p.mode, blocked, kinds, unica: null, recorrente: null, global: { priceCents: 0, costCents: 0, markup: null, netCents: 0, netPct: null, floorCents: null, estimatedCents: 0, maxDiscountPct: null }, byDoc: [], verdict: 'bloqueado', alerts, notes, costs };
  if (blocked.length) { alerts.push(`${blocked.length} produto(s) sem documento fiscal: informe em Produtos e serviços para calcular (sem documento, o produto ficaria sem tributos).`); return empty; }
  if (!products.length) return { ...empty, verdict: 'sem_minimo' };

  const ir = bp(p.incomeTaxBp), v = bp(p.variableBp), r = bp(p.riskBp), f = bp(p.overheadBp), Lmin = p.netMinBp == null ? null : bp(p.netMinBp);
  const capC = 1 + bp(p.contingencyCapexBp), opC = 1 + bp(p.contingencyOpexBp);
  if (Lmin == null) alerts.push('Configure a margem líquida mínima em Configurações → Viabilidade: sem ela, o piso não é calculado.');
  const target = p.netTargetBp != null ? bp(p.netTargetBp) : null;
  if (target != null && Lmin != null && target < Lmin) alerts.push(`A margem líquida alvo (${(target * 100).toFixed(1)}%) está abaixo da mínima das Configurações (${(Lmin * 100).toFixed(1)}%).`);
  const N = Math.max(1, p.termMonths);

  // custo sem cesta: rateado pela receita entre os blocos/cestas que existem (aviso)
  const unicaP = products.filter((x) => revenueOf(x.kind) === 'unica'), recP = products.filter((x) => revenueOf(x.kind) === 'recorrente');
  if (costs.semCesta) {
    const ru = unicaP.reduce((t, x) => t + x.estimatedCents, 0), rr = recP.reduce((t, x) => t + x.estimatedCents, 0) * N;
    const tot = ru + rr || 1;
    const toU = Math.round(costs.semCesta * (ru / tot));
    const uImpl = unicaP.some((x) => x.profile === 'implantacao');
    if (toU) costs.unica[uImpl ? 'implantacao' : 'fornecimento'] += toU;
    if (costs.semCesta - toU) costs.recorrente.implantacao += costs.semCesta - toU;
    alerts.push('Há custo sem cesta (sem tipo de negociação): foi distribuído pela receita. Indique a cesta na planilha da engenharia.');
  }
  // negócio só mensal (ou só venda única): o custo lançado no outro bloco pertence ao único bloco que existe
  const moved = (from: 'unica' | 'recorrente', to: 'unica' | 'recorrente') => {
    const tot = costs[from].fornecimento + costs[from].implantacao;
    if (!tot) return;
    for (const prof of COST_PROFILES) { costs[to][prof] += costs[from][prof]; costs[from][prof] = 0; }
    notes.push(to === 'recorrente' ? 'Todos os produtos são mensais: o custo direto lançado entra no investimento da mensalidade.' : 'Todos os produtos são de venda única: o custo direto lançado entra no preço da venda única.');
  };
  if (!unicaP.length && recP.length) moved('unica', 'recorrente');
  if (!recP.length && unicaP.length) moved('recorrente', 'unica');

  // ------------------------------------------------------------------ venda única
  let unica: B2gBlock | null = null;
  if (unicaP.length) {
    const lines: B2gLine[] = [];
    const cascade: B2gBlock['cascade'] = [];
    const varShare = distribute(unicaP, costs.variavel, p.weights);
    // custo numa cesta sem produto vai para a outra cesta da venda única (o perfil escolhido no produto manda)
    for (const prof of COST_PROFILES) {
      const other: CostProfile = prof === 'fornecimento' ? 'implantacao' : 'fornecimento';
      if (costs.unica[prof] && !unicaP.some((x) => x.profile === prof) && unicaP.some((x) => x.profile === other)) {
        notes.push(`Custo lançado como ${COST_PROFILE_SHORT[prof]} entrou na ${COST_PROFILE_SHORT[other]}, porque os produtos de venda única estão com esse perfil.`);
        costs.unica[other] += costs.unica[prof]; costs.unica[prof] = 0;
      }
    }
    for (const prof of COST_PROFILES) {
      const ps = unicaP.filter((x) => x.profile === prof);
      if (!ps.length) { if (costs.unica[prof]) alerts.push(`Custo de ${COST_PROFILE_SHORT[prof]} (venda única) sem produto nessa cesta.`); continue; }
      const cost = Math.round(costs.unica[prof] * capC);
      const dist = distribute(ps, cost, p.weights);
      const oh = prof === 'implantacao' ? f : 0;
      // margem de contribuição: manual por cesta ou target seek (mesma ML alvo em cada cesta)
      const manual = p.contributionBp?.[prof];
      const seek = target != null ? target / (1 - ir) + r + oh : null;
      const mc = manual != null ? bp(manual) : seek;
      if (p.mode === 'A' && mc == null) alerts.push(`Informe a margem de contribuição de ${COST_PROFILE_SHORT[prof]} ou a margem líquida alvo.`);
      if (manual != null && seek != null && bp(manual) < seek - 1e-9) alerts.push(`${COST_PROFILE_SHORT[prof]}: a margem de contribuição manual (${(bp(manual) * 100).toFixed(1)}%) fica abaixo da necessária para a margem líquida alvo (${(seek * 100).toFixed(1)}%).`);
      for (const x of ps) {
        const a = bp(x.doc!.taxBp), fixed = x.doc!.fixedCents;
        const c = (dist.get(x.id) ?? 0) + (varShare.get(x.id) ?? 0);
        let P: number | null;
        if (p.mode === 'A') { const D = mc == null ? 0 : 1 - a - v - mc; P = D > 0 ? (c + fixed) / D : null; if (mc != null && D <= 0) alerts.push(`${x.description}: tributos, despesas variáveis e margem somam 100% ou mais: nenhum preço fecha o markup.`); }
        else P = x.bidCents ?? x.estimatedCents;
        const floor = Lmin == null ? null : oneTimeFloor(c, a, fixed, p, oh, Lmin);
        const ch = P != null && P > 0 ? chain(P, c, a, fixed, p, oh) : null;
        const line: B2gLine = {
          id: x.id, description: x.description, profile: prof, revenue: 'unica', doc: x.doc!.name, taxPct: a * 100, estimatedCents: x.estimatedCents, costCents: c,
          weightPct: cost > 0 ? ((dist.get(x.id) ?? 0) / cost) * 100 : 0,
          priceCents: P == null ? null : Math.round(P), markup: P != null && c > 0 ? P / c : null,
          contributionCents: ch ? Math.round(ch.contribution) : null, contributionPct: ch ? (ch.contribution / P!) * 100 : null,
          overheadCents: ch ? Math.round(ch.overhead) : 0, overheadBase: oh ? 'preco' : null,
          operatingCents: ch ? Math.round(ch.operating) : null, operatingPct: ch ? (ch.operating / P!) * 100 : null,
          netCents: ch ? Math.round(ch.net) : null, netPct: ch ? (ch.net / P!) * 100 : null,
          floorCents: floor == null ? null : Math.ceil(floor - 1e-6), maxDiscountPct: floor != null && x.estimatedCents > 0 ? Math.max(0, (1 - Math.ceil(floor - 1e-6) / x.estimatedCents) * 100) : null,
          bidRange: floor != null && x.estimatedCents > 0 ? { from: Math.ceil(floor - 1e-6), to: x.estimatedCents } : null,
          alerts: [],
        };
        lines.push(line);
      }
      const ls = lines.filter((l) => l.profile === prof);
      const pr = ls.reduce((t, l) => t + (l.priceCents ?? 0), 0);
      cascade.push({ profile: prof, contributionPct: pr ? (ls.reduce((t, l) => t + (l.contributionCents ?? 0), 0) / pr) * 100 : null, overheadPct: oh * 100, operatingPct: pr ? (ls.reduce((t, l) => t + (l.operatingCents ?? 0), 0) / pr) * 100 : null });
    }
    unica = blockOf('unica', lines);
    unica.cascade = cascade;
  }

  // ------------------------------------------------------------------ recorrente
  let recorrente: B2gBlock | null = null;
  if (recP.length) {
    const impl = Math.round(costs.recorrente.implantacao * capC), mat = Math.round(costs.recorrente.fornecimento * capC);
    const overheadOnCost = Math.round(costs.recorrente.implantacao * f);
    const monthly = Math.round(costs.mensal * opC);
    const implTargets = recP.filter((x) => x.profile === 'implantacao'), matTargets = recP.filter((x) => x.profile === 'fornecimento');
    const dImpl = distribute(implTargets.length ? implTargets : recP, impl + overheadOnCost, p.weights);
    const dMat = distribute(matTargets.length ? matTargets : recP, mat, p.weights);
    const dOpex = distribute(recP, monthly, p.weights);
    const inv = (id: string) => (dImpl.get(id) ?? 0) + (dMat.get(id) ?? 0);
    const totalInv = impl + mat + overheadOnCost;
    // payback: entrada ou target seek (ML ao longo da vigência = alvo); 1 ≤ payback ≤ vigência
    const mensal = (D: number) => recP.map((x) => { const a = bp(x.doc!.taxBp); const k = 1 - a - v; return k > 0 ? (inv(x.id) / D + (dOpex.get(x.id) ?? 0) + x.doc!.fixedCents) / k : null; });
    const netPctAt = (prices: (number | null)[]) => {
      let R = 0, NET = 0;
      recP.forEach((x, k) => { const M = prices[k]; if (M == null) return; const s = recurringChain(M, x, inv(x.id), dOpex.get(x.id) ?? 0, N, p); R += s.revenue; NET += s.net; });
      return R > 0 ? NET / R : null;
    };
    let D: number | null = p.paybackMonths ?? null;
    let status: string | null = null;
    if (p.mode === 'A' && (p.solvePayback || D == null) && target != null) {
      const at = (d: number) => netPctAt(mensal(d)) ?? -Infinity;
      if (at(N) >= target) { D = N; status = 'O alvo já é atingido com o payback igual à vigência.'; }
      else if (at(1) < target) { D = null; status = 'Não há payback entre 1 mês e a vigência que entregue a margem líquida alvo.'; alerts.push(`Recorrente: ${status}`); }
      else { let lo = 1, hi = N; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (at(mid) >= target) lo = mid; else hi = mid; } D = lo; status = 'Payback resolvido pela margem líquida alvo ao longo da vigência.'; }
    }
    if (D != null && (D < 1 || D > N)) { alerts.push(`O payback precisa ficar entre 1 mês e a vigência (${N} meses).`); D = Math.min(N, Math.max(1, D)); }
    if (p.mode === 'A' && D == null && status == null) alerts.push('Informe o payback (meses) ou a margem líquida alvo para precificar a recorrência.');
    const prices = p.mode === 'A' ? (D != null ? mensal(D) : recP.map(() => null)) : recP.map((x) => x.bidCents ?? x.estimatedCents);
    const lines: B2gLine[] = recP.map((x, k) => {
      const a = bp(x.doc!.taxBp), M = prices[k] ?? null, I = inv(x.id), O = dOpex.get(x.id) ?? 0, F = x.doc!.fixedCents;
      const s = M != null && M > 0 ? recurringChain(M, x, I, O, N, p) : null;
      const den = M != null ? M * (1 - a - v) - O - F : 0;
      const pb = M != null ? (den > 0 ? I / den : null) : null;
      const floor = Lmin == null ? null : recurringFloor(x, I, O, N, p, Lmin);
      return {
        id: x.id, description: x.description, profile: x.profile, revenue: 'recorrente', doc: x.doc!.name, taxPct: a * 100, estimatedCents: x.estimatedCents, costCents: Math.round(I + O * N),
        weightPct: totalInv > 0 ? (I / totalInv) * 100 : 0, priceCents: M == null ? null : Math.round(M), markup: M != null && I + O * N > 0 ? (M * N) / (I + O * N) : null,
        contributionCents: s ? Math.round(s.contribution) : null, contributionPct: s ? (s.contribution / s.revenue) * 100 : null, overheadCents: Math.round(dImpl.get(x.id) && impl + overheadOnCost ? ((dImpl.get(x.id) ?? 0) * overheadOnCost) / (impl + overheadOnCost) : 0), overheadBase: overheadOnCost ? 'custo' : null,
        operatingCents: s ? Math.round(s.operating) : null, operatingPct: s ? (s.operating / s.revenue) * 100 : null, netCents: s ? Math.round(s.net) : null, netPct: s ? (s.net / s.revenue) * 100 : null,
        floorCents: floor == null ? null : Math.ceil(floor - 1e-6), maxDiscountPct: floor != null && x.estimatedCents > 0 ? Math.max(0, (1 - Math.ceil(floor - 1e-6) / x.estimatedCents) * 100) : null,
        bidRange: floor != null && x.estimatedCents > 0 ? { from: Math.ceil(floor - 1e-6), to: x.estimatedCents } : null,
        investmentCents: Math.round(I), monthlyCostCents: Math.round(O), paybackMonths: pb, cashPaybackMonths: pb != null && p.paymentTermDays ? pb + p.paymentTermDays / 30 : null,
        alerts: M != null && pb == null ? ['Inviável: a mensalidade não cobre tributos, despesas variáveis e o custo mensal (payback não fecha).'] : [],
      };
    });
    recorrente = blockOf('recorrente', lines);
    const Mtot = lines.reduce((t, l) => t + (l.priceCents ?? 0), 0);
    const estM = recP.reduce((t, x) => t + x.estimatedCents, 0);
    Object.assign(recorrente, { investmentCents: totalInv, directImplCents: impl, overheadOnCostCents: overheadOnCost, monthlyCostCents: monthly, monthlyPriceCents: Mtot, termMonths: N, paybackMonths: p.mode === 'A' ? D : blockPayback(lines), paybackStatus: status });
    if (p.mode === 'A' && estM > 0 && Mtot > estM) {
      const pbEst = blockPayback(recP.map((x, k) => ({ ...lines[k]!, priceCents: x.estimatedCents, paybackMonths: (() => { const a = bp(x.doc!.taxBp); const den = x.estimatedCents * (1 - a - v) - (dOpex.get(x.id) ?? 0) - x.doc!.fixedCents; return den > 0 ? inv(x.id) / den : null; })() })));
      alerts.push(`A mensalidade calculada (${(Mtot / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) passa do valor estimado do órgão (${(estM / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}). Com o valor estimado, o payback seria ${pbEst == null ? 'inviável' : `${pbEst.toFixed(1).replace('.', ',')} meses`}.`);
    }
    if (D != null && D > N) alerts.push('O payback não pode exceder a vigência.');
  }

  // ------------------------------------------------------------------ consolidado (de baixo para cima; a decisão é global)
  const all = [...(unica?.lines ?? []), ...(recorrente?.lines ?? [])];
  const revOf = (l: B2gLine) => (l.priceCents ?? 0) * (l.revenue === 'recorrente' ? N : 1);
  const estOf = (l: B2gLine) => l.estimatedCents * (l.revenue === 'recorrente' ? N : 1);
  const priceT = all.reduce((t, l) => t + revOf(l), 0), costT = all.reduce((t, l) => t + l.costCents, 0);
  const netT = all.reduce((t, l) => t + (l.netCents ?? 0), 0);
  const floorOk = all.every((l) => l.floorCents != null);
  const floorT = floorOk ? all.reduce((t, l) => t + l.floorCents! * (l.revenue === 'recorrente' ? N : 1), 0) : null;
  const estT = all.reduce((t, l) => t + estOf(l), 0);
  const docs = [...new Set(all.map((l) => l.doc ?? ''))];
  const byDoc = docs.map((d) => { const ls = all.filter((l) => (l.doc ?? '') === d); const pr = ls.reduce((t, l) => t + revOf(l), 0), co = ls.reduce((t, l) => t + l.costCents, 0); return { doc: d || 'Sem documento', priceCents: pr, costCents: co, markup: co > 0 ? pr / co : null }; });
  // alertas por produto: nenhum produto negativo compensado por outro
  for (const l of all) {
    if (l.netPct != null && l.netPct < 0) l.alerts.push('Margem líquida negativa: o preço deste produto não se sustenta sozinho (risco de inexequibilidade).');
    else if (Lmin != null && l.netPct != null && l.netPct < Lmin * 100 - 1e-6) l.alerts.push(`Abaixo da margem líquida mínima (${(Lmin * 100).toFixed(1)}%).`);
    if (p.mode === 'B' && l.floorCents != null && (l.priceCents ?? 0) < l.floorCents) l.alerts.push('Valor abaixo do piso.');
  }
  const netPct = priceT > 0 ? (netT / priceT) * 100 : null;
  let verdict: B2gResult['verdict'] = 'viavel';
  if (Lmin == null) verdict = 'sem_minimo';
  else if (netPct == null || netPct < Lmin * 100 - 1e-6) verdict = 'abaixo_minimo';
  else if (all.some((l) => l.netPct != null && l.netPct < 0)) verdict = 'produto_negativo';
  else if (all.some((l) => l.alerts.length)) verdict = 'produto_abaixo';
  if (p.mode === 'B' && floorT != null && estT < floorT) alerts.push('O valor estimado do órgão fica abaixo do piso global: inviável no preço do edital.');
  notes.push('Dentro de cada cesta, o custo é distribuído pelo valor estimado (unitário × quantidade): a relação custo/preço é a mesma para todos os produtos da cesta (salvo peso manual). A decisão de viabilidade é global, com alerta por produto.');
  if (f) notes.push(`Despesas fixas rateadas de ${(f * 100).toLocaleString('pt-BR')}%: na venda única, sobre o preço da Implantação; no recorrente, sobre o custo direto da implantação (somadas ao investimento). Não incidem no Fornecimento.`);
  return {
    mode: p.mode, blocked, kinds, unica, recorrente,
    global: { priceCents: priceT, costCents: costT, markup: costT > 0 ? priceT / costT : null, netCents: netT, netPct, floorCents: floorT, estimatedCents: estT, maxDiscountPct: floorT != null && estT > 0 ? Math.max(0, (1 - floorT / estT) * 100) : null },
    byDoc, verdict, alerts, notes, costs,
  };

  function blockOf(revenue: RevenueKind, lines: B2gLine[]): B2gBlock {
    const mult = revenue === 'recorrente' ? N : 1;
    const price = lines.reduce((t, l) => t + (l.priceCents ?? 0) * mult, 0);
    const net = lines.reduce((t, l) => t + (l.netCents ?? 0), 0);
    return {
      revenue, lines, priceCents: price, costCents: lines.reduce((t, l) => t + l.costCents, 0), contributionCents: lines.reduce((t, l) => t + (l.contributionCents ?? 0), 0),
      overheadCents: lines.reduce((t, l) => t + l.overheadCents, 0), operatingCents: lines.reduce((t, l) => t + (l.operatingCents ?? 0), 0), netCents: net, netPct: price > 0 ? (net / price) * 100 : null,
    };
  }
}

/** Recorrente ao longo da vigência: receita N×M; o investimento (com o rateio) entra uma vez; sem despesas fixas mensais. */
export function recurringChain(M: number, x: Pick<B2gProduct, 'doc'>, inv: number, opexMonthly: number, N: number, p: Pick<B2gParams, 'variableBp' | 'riskBp' | 'incomeTaxBp'>) {
  const a = bp(x.doc!.taxBp), v = bp(p.variableBp), r = bp(p.riskBp), ir = bp(p.incomeTaxBp), F = x.doc!.fixedCents;
  const revenue = M * N;
  const contribution = revenue - N * (a * M + F) - N * v * M - N * opexMonthly - inv;
  const operating = contribution - r * revenue;
  const net = operating - ir * Math.max(0, operating);
  return { revenue, contribution, operating, net };
}
/** Mensalidade em que a margem líquida ao longo da vigência é exatamente `L`. */
function recurringFloor(x: B2gProduct, inv: number, opex: number, N: number, p: B2gParams, L: number) {
  const a = bp(x.doc!.taxBp), v = bp(p.variableBp), r = bp(p.riskBp), ir = bp(p.incomeTaxBp), F = x.doc!.fixedCents;
  const k = 1 - a - v - r;
  const costs = N * (opex + F) + inv;
  const d = L >= 0 ? N * (k * (1 - ir) - L) : N * (k - L);
  return d > 0 ? (L >= 0 ? costs * (1 - ir) : costs) / d : null;
}
function blockPayback(lines: Pick<B2gLine, 'investmentCents' | 'paybackMonths' | 'priceCents'>[]) {
  // payback do bloco: investimento total ÷ geração mensal total (só faz sentido se todos fecham)
  if (lines.some((l) => l.paybackMonths == null)) return null;
  const inv = lines.reduce((t, l) => t + (l.investmentCents ?? 0), 0);
  const gen = lines.reduce((t, l) => t + (l.paybackMonths! > 0 ? (l.investmentCents ?? 0) / l.paybackMonths! : 0), 0);
  return gen > 0 ? inv / gen : null;
}

/**
 * B2G a partir das entradas da viabilidade econômica (o mesmo cálculo na tela e no servidor): produtos da oportunidade
 * com os tributos da vigência fiscal, planilha da engenharia e parâmetros das Configurações (com os ajustes da negociação).
 * Chave do produto = descrição (os produtos são regravados a cada salvamento).
 */
export function b2gFromEconomics(args: Omit<EngineArgs, 'model'>, profitTaxBp?: number | null): B2gResult {
  const st = args.settings, inp = args.input;
  const fx = applyFiscalEnvelope(args);
  const key = (d: string) => d.trim().toLowerCase();
  const b = inp.b2g ?? {};
  const products: B2gProduct[] = fx.args.items.map((i) => {
    const kind = (i.kind ?? 'recorrencia') as DealKind;
    return { id: key(i.description), description: i.description, kind, profile: i.costProfile ?? defaultCostProfile(kind), estimatedCents: i.revenueCents, bidCents: b.bids?.[key(i.description)] ?? null, doc: i.doc && i.doc.complete ? { name: i.doc.name, taxBp: i.doc.percentBp, fixedCents: i.doc.fixedCents } : null };
  });
  return b2gViability(products, inp.capex, inp.opex, {
    mode: b.mode ?? 'A', variableBp: inp.variableBp ?? st.variableExpenseBp ?? 0,
    riskBp: (inp.lossBp ?? (args.publicSector ? st.lossPublicBp : st.lossPrivateBp)) + (st.badDebtBp ?? 0),
    incomeTaxBp: profitTaxBp ?? fx.args.settings.incomeTaxBp ?? null, overheadBp: b.overheadBp ?? st.overheadBp ?? 0, netMinBp: st.netMarginMinBp ?? null,
    netTargetBp: b.netTargetBp ?? st.netMarginTargetBp ?? null, contributionBp: b.contributionBp, solvePayback: b.solvePayback ?? false,
    contingencyCapexBp: st.contingencyCapexBp, contingencyOpexBp: st.contingencyOpexBp, termMonths: inp.termMonths, paybackMonths: inp.paybackMonths ?? null,
    paymentTermDays: st.paymentTermDays ?? null, weights: b.weights,
  }, inp.extraInitialCents);
}
