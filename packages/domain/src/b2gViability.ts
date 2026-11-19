/**
 * Viabilidade comercial B2G (licitações e atas de registro de preço): liga "Produtos e serviços" à "Viabilidade econômica".
 *
 * Mesmas definições de margem do motor FINANCE (só muda a base das despesas fixas, como aprovado):
 *   Margem de contribuição (MC) = receita − tributos − despesas variáveis − custo
 *   Margem de operação (MO)     = MC − glosa/inadimplência − despesas fixas rateadas dos serviços
 *   Margem líquida (ML)         = MO − IR/CSLL (sobre MO positiva)
 *
 * Perfis: Fornecimento (venda), Instalação (serviço único), Implantação (recorrência/locação).
 *   Serviço único + Instalação: rateio = % do PREÇO (na etapa do markup; MC 35% com rateio 35% zera a MO).
 *   Recorrente: despesas fixas rateadas sobre a mensalidade, fora do investimento inicial.
 * Recorrente: Mensalidade = (Investimento ÷ payback + custo mensal) ÷ (1 − tributos − despesas variáveis).
 * Modo A: custo → preço (margem desejada ou target seek). Modo B: preço do edital → margens, piso, desconto e faixa de lance.
 * Decisão global, com alerta por produto (nenhum produto negativo compensado por outro). Alerta, nunca bloqueio.
 * Dinheiro em centavos; percentuais em frações (0,35 = 35%).
 */
import { annuityFactor, paybackMonths as paybackOf } from './formula';
import { econPaybackLimit, financeEngine, type EconResult, serviceInvestmentExtra, SERVICE_INVESTMENT_BP, applyFiscalEnvelope, type CostLine, type DealKind, type EngineArgs } from './finance';

export type CostProfile = 'fornecimento' | 'implantacao' | 'instalacao';
export const COST_PROFILES: CostProfile[] = ['fornecimento', 'instalacao', 'implantacao'];
export const COST_PROFILE_LABELS: Record<CostProfile, string> = { fornecimento: 'Fornecimento', instalacao: 'Serviço de Instalação (Sem recorrência)', implantacao: 'Serviço Fornecimento + Instalação' };
export const COST_PROFILE_SHORT: Record<CostProfile, string> = { fornecimento: 'Fornecimento', instalacao: 'Instalação', implantacao: 'Implantação' };
/** Perfil fixo pelo tipo: venda = fornecimento; serviço único = instalação; recorrência/locação = implantação. */
export const defaultCostProfile = (k: DealKind): CostProfile => (k === 'venda' ? 'fornecimento' : k === 'servico' ? 'instalacao' : 'implantacao');
export type RevenueKind = 'unica' | 'recorrente';
export const revenueOf = (k: DealKind): RevenueKind => (k === 'venda' || k === 'servico' ? 'unica' : 'recorrente');

export type B2gProduct = {
  id: string; description: string; kind: DealKind; profile: CostProfile;
  /** valor estimado do órgão: total do produto (unitário × quantidade); no recorrente, por mês */ estimatedCents: number; priceDefined?: boolean;
  /** lance simulado (Modo B); sem ele vale o estimado */ bidCents?: number | null;
  doc: { name: string; taxBp: number; fixedCents: number } | null;
};
export type B2gParams = {
  mode: 'A' | 'B';
  netPricing?: boolean; reference?: { investments: Map<string, number>; monthly: Map<string, number>; suggested: Map<string, number>; prices?: Map<string, number>; proposedProfiles?: Set<CostProfile>; totals?: Partial<Record<CostProfile, { contribution: number; operating: number; net: number }>>; baskets: NonNullable<B2gResult['baskets']> }; tmaRate?: number; inflationAnnualBp?: number | null;
  /** Valor do produto quando informado; sugerido quando em branco. */ autoPrice?: boolean;
  /** despesas variáveis (% do preço), glosa + inadimplência (% da receita), IR/CSLL sobre o lucro */
  variableBp: number; riskBp: number; incomeTaxBp: number | null;
  /** despesas fixas rateadas (padrão das Configurações, editável na oportunidade) */ overheadBp: number;
  /** margem líquida mínima (Configurações, definida pela diretoria); null = não configurada */ netMinBp: number | null;
  /** alvo de margem líquida do target seek (venda única e recorrente) */ netTargetBp?: number | null;
  /** margem de contribuição manual por cesta (venda única); sem ela, vem do target seek */ contributionBp?: Partial<Record<CostProfile, number | null>>;
  /** contingências das Configurações, sobre custo direto e custo mensal */ contingencyCapexBp?: number; contingencyOpexBp?: number; serviceCostBp?: number | null;
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
  const c = { unica: { fornecimento: 0, implantacao: 0, instalacao: 0 }, recorrente: { fornecimento: 0, implantacao: 0, instalacao: 0 }, mensal: 0, variavel: 0, semCesta: 0 };
  for (const l of capex) {
    const v = lineTotal(l);
    if (isVarFixed(l)) { c.variavel += v; continue; }
    if (!l.kind) { c.semCesta += v; continue; }
    // O bloco da engenharia identifica o perfil; material também pode ser custo da Implantação.
    const profile = defaultCostProfile(l.kind);
    c[revenueOf(l.kind)][profile] += v;
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
  const incomplete = products.some((p) => !(p.priceDefined ?? p.estimatedCents > 0));
  const base = incomplete ? 0 : rest.reduce((t, p) => t + Math.max(0, p.estimatedCents), 0);
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
  suggestedCents?: number | null; priceDefined?: boolean; priceBasis?: 'informado' | 'sugerido' | 'lance';
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
  baskets?: { profile: CostProfile; investmentCents: number; baseCents?: number; contingencyCents?: number; serviceInvestmentCents?: number; serviceMonthlyCents?: number; serviceCostBp?: number; variableFixedCents?: number; monthlyCostCents: number; costCents: number; allocatedCents: number }[];
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
  // O tipo define o perfil; um perfil legado divergente nunca altera o rateio.
  products = products.map((x) => ({ ...x, profile: defaultCostProfile(x.kind) }));
  const costs = b2gCosts(capex, opex, extraInitialCents);
  const alerts: string[] = [], notes: string[] = [];
  const blocked = products.filter((x) => !x.doc).map((x) => ({ id: x.id, description: x.description }));
  const kinds = { unica: products.some((x) => revenueOf(x.kind) === 'unica'), recorrente: products.some((x) => revenueOf(x.kind) === 'recorrente') };
  const investmentOf = (baseCents: number, profile: CostProfile) => Math.round(baseCents * (1 + bp(p.contingencyCapexBp))) + ((profile === 'instalacao' || (!p.netPricing && profile === 'implantacao')) ? serviceInvestmentExtra(baseCents, p.serviceCostBp) : 0);
  const initialBaskets = p.reference?.baskets ?? COST_PROFILES.map((profile) => { const baseCents = costs.unica[profile] + costs.recorrente[profile]; const contingencyCents = Math.round(baseCents * bp(p.contingencyCapexBp)); const serviceInvestmentCents = (profile === 'instalacao' || (!p.netPricing && profile === 'implantacao')) ? serviceInvestmentExtra(baseCents, p.serviceCostBp) : 0; const investmentCents = investmentOf(baseCents, profile); const monthlyCostCents = profile === 'implantacao' ? Math.round(costs.mensal * (1 + bp(p.contingencyOpexBp))) + (p.netPricing ? serviceInvestmentExtra(baseCents, p.serviceCostBp) : 0) : 0; return { profile, baseCents, contingencyCents, serviceInvestmentCents, serviceMonthlyCents: p.netPricing && profile === 'implantacao' ? serviceInvestmentExtra(baseCents, p.serviceCostBp) : 0, serviceCostBp: p.serviceCostBp ?? SERVICE_INVESTMENT_BP, investmentCents, monthlyCostCents, costCents: investmentCents + monthlyCostCents * Math.max(1, p.termMonths), allocatedCents: 0 }; });
  const empty: B2gResult = { mode: p.mode, blocked, kinds, unica: null, recorrente: null, global: { priceCents: 0, costCents: initialBaskets.reduce((t, b) => t + b.costCents, 0) + costs.semCesta + costs.variavel, markup: null, netCents: 0, netPct: null, floorCents: null, estimatedCents: 0, maxDiscountPct: null }, byDoc: [], verdict: 'bloqueado', alerts, notes, costs, baskets: initialBaskets };
  if (blocked.length) { alerts.push(`${blocked.length} produto(s) sem documento fiscal: informe em Produtos e serviços para calcular (sem documento, o produto ficaria sem tributos).`); return empty; }
  if (!products.length) return { ...empty, verdict: 'sem_minimo' };

  const ir = bp(p.incomeTaxBp), v = bp(p.variableBp), r = bp(p.riskBp), f = bp(p.overheadBp), Lmin = p.netMinBp == null ? null : bp(p.netMinBp);
  const opC = 1 + bp(p.contingencyOpexBp);
  if (Lmin == null) alerts.push('Configure a margem líquida mínima em Configurações → Viabilidade: sem ela, o piso não é calculado.');
  const target = p.netTargetBp != null ? bp(p.netTargetBp) : null;
  if (target != null && Lmin != null && target < Lmin) alerts.push(`A margem líquida alvo (${(target * 100).toFixed(1)}%) está abaixo da mínima das Configurações (${(Lmin * 100).toFixed(1)}%).`);
  const N = Math.max(1, p.termMonths);
  const contractMultiplier = p.netPricing ? Array.from({ length: N }, (_, k) => (1 + bp(p.inflationAnnualBp)) ** (Math.max(0, k + 1 - 12) / 12)).reduce((t, x) => t + x, 0) : N;

  // custo sem cesta: rateado pela receita entre os blocos/cestas que existem (aviso)
  const unicaP = products.filter((x) => revenueOf(x.kind) === 'unica'), recP = products.filter((x) => revenueOf(x.kind) === 'recorrente');
  // Custo identificado fica no seu perfil, sem transferência para outro tipo de produto.
  for (const profile of COST_PROFILES) {
    if ((costs.unica[profile] || costs.recorrente[profile]) && !products.some((x) => x.profile === profile)) alerts.push(`Custo de ${COST_PROFILE_SHORT[profile]} sem produto correspondente: não foi distribuído para outros perfis.`);
  }
  if (costs.semCesta) {
    const weighted = products.map((x) => ({ ...x, estimatedCents: x.estimatedCents * (revenueOf(x.kind) === 'recorrente' ? N : 1) }));
    const shared = distribute(weighted, costs.semCesta, p.weights);
    for (const x of products) costs[revenueOf(x.kind)][x.profile] += shared.get(x.id) ?? 0;
    alerts.push('Há custo comum sem perfil: distribuído entre os produtos. Classifique os custos antigos na cesta correta para separar os perfis.');
  }
  // ------------------------------------------------------------------ venda única
  let unica: B2gBlock | null = null;
  if (unicaP.length) {
    const lines: B2gLine[] = [];
    const cascade: B2gBlock['cascade'] = [];
    const varShare = distribute(unicaP, costs.variavel, p.weights);
    for (const prof of COST_PROFILES) {
      const ps = unicaP.filter((x) => x.profile === prof);
      if (!ps.length) { if (costs.unica[prof]) alerts.push(`Custo de ${COST_PROFILE_SHORT[prof]} (venda única) sem produto nessa cesta.`); continue; }
      const cost = p.reference ? ps.reduce((t, x) => t + (p.reference!.investments.get(`${x.profile}:${x.id}`) ?? 0), 0) : investmentOf(costs.unica[prof], prof);
      const dist = p.reference ? new Map(ps.map((x) => [x.id, p.reference!.investments.get(`${x.profile}:${x.id}`) ?? 0])) : distribute(ps, cost, p.weights);
      const oh = prof === 'fornecimento' ? 0 : f;
      // margem de contribuição: manual por cesta ou target seek (mesma ML alvo em cada cesta)
      const manual = p.contributionBp?.[prof];
      const seek = target != null ? target / (1 - ir) + r + oh : null;
      const mc = p.netPricing ? seek : manual != null ? bp(manual) : seek;
      if ((p.mode === 'A' || p.autoPrice) && mc == null) alerts.push(`Informe a margem de contribuição de ${COST_PROFILE_SHORT[prof]} ou a margem líquida alvo.`);
      if (!p.netPricing && manual != null && seek != null && bp(manual) < seek - 1e-9) alerts.push(`${COST_PROFILE_SHORT[prof]}: a margem de contribuição manual (${(bp(manual) * 100).toFixed(1)}%) fica abaixo da necessária para a margem líquida alvo (${(seek * 100).toFixed(1)}%).`);
      for (const x of ps) {
        const a = bp(x.doc!.taxBp), fixed = x.doc!.fixedCents;
        const c = (dist.get(x.id) ?? 0) + (p.reference ? 0 : varShare.get(x.id) ?? 0);
        const divisor = mc == null ? 0 : 1 - a - v - mc;
        const suggested = p.reference ? p.reference.suggested.get(`${x.profile}:${x.id}`) ?? null : divisor > 0 ? (c + fixed) / divisor : null;
        if (mc != null && divisor <= 0) alerts.push(`${x.description}: tributos, despesas variáveis e margem somam 100% ou mais: nenhum preço fecha o markup.`);
        const defined = x.priceDefined ?? x.estimatedCents > 0;
        const P = p.autoPrice ? x.bidCents ?? p.reference?.prices?.get(x.profile + ':' + x.id) ?? (defined ? x.estimatedCents : suggested) : p.mode === 'A' ? suggested : x.bidCents ?? x.estimatedCents;
        const floor = Lmin == null ? null : oneTimeFloor(c, a, fixed, p, oh, Lmin);
        const ch = P != null && P > 0 ? chain(P, c, a, fixed, p, oh) : null;
        const line: B2gLine = {
          suggestedCents: suggested == null ? null : Math.round(suggested), priceDefined: defined, priceBasis: p.reference?.proposedProfiles?.has(x.profile) ? 'informado' : x.bidCents != null ? 'lance' : (p.autoPrice ? defined : p.mode === 'B') ? 'informado' : 'sugerido',
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
    const impl = investmentOf(costs.recorrente.implantacao, 'implantacao'), mat = investmentOf(costs.recorrente.fornecimento, 'fornecimento');
    // despesas fixas rateadas: % da mensalidade (só produtos de Implantação), não entram no investimento
    const overheadOnCost = 0;
    const ohOf = (x: B2gProduct) => (x.profile === 'implantacao' ? f : 0);
    const monthly = Math.round(costs.mensal * opC) + (p.netPricing ? serviceInvestmentExtra(costs.recorrente.implantacao, p.serviceCostBp) : 0);
    const implTargets = recP.filter((x) => x.profile === 'implantacao'), matTargets = recP.filter((x) => x.profile === 'fornecimento');
    const dImpl = p.reference ? new Map(recP.map((x) => [x.id, p.reference!.investments.get(`${x.profile}:${x.id}`) ?? 0])) : distribute(implTargets.length ? implTargets : recP, impl + overheadOnCost, p.weights);
    const dMat = p.reference ? new Map<string, number>() : distribute(matTargets.length ? matTargets : recP, mat, p.weights);
    const dOpex = p.reference ? new Map(recP.map((x) => [x.id, p.reference!.monthly.get(`${x.profile}:${x.id}`) ?? 0])) : distribute(recP, monthly, p.weights);
    const inv = (id: string) => (dImpl.get(id) ?? 0) + (dMat.get(id) ?? 0);
    const totalInv = p.reference ? recP.reduce((t, x) => t + (p.reference!.investments.get(`${x.profile}:${x.id}`) ?? 0), 0) : impl + mat + overheadOnCost;
    // payback: entrada ou target seek (ML ao longo da vigência = alvo); 1 ≤ payback ≤ vigência
    const mensal = (D: number) => recP.map((x) => { const a = bp(x.doc!.taxBp); const k = 1 - a - v - ohOf(x); return k > 0 ? (inv(x.id) / D + (dOpex.get(x.id) ?? 0) + x.doc!.fixedCents) / k : null; });
    const netPctAt = (prices: (number | null)[]) => {
      let R = 0, NET = 0;
      recP.forEach((x, k) => { const M = prices[k]; if (M == null) return; const s = recurringChain(M, x, inv(x.id), dOpex.get(x.id) ?? 0, N, p, ohOf(x)); R += s.revenue; NET += s.net; });
      return R > 0 ? NET / R : null;
    };
    let D: number | null = p.paybackMonths ?? null;
    let status: string | null = null;
    if (!p.netPricing && (p.mode === 'A' || p.autoPrice) && (p.solvePayback || D == null) && target != null) {
      const at = (d: number) => netPctAt(mensal(d)) ?? -Infinity;
      if (at(N) >= target) { D = N; status = 'O alvo já é atingido com o payback igual à vigência.'; }
      else if (at(1) < target) { D = null; status = 'Não há payback entre 1 mês e a vigência que entregue a margem líquida alvo.'; alerts.push(`Recorrente: ${status}`); }
      else { let lo = 1, hi = N; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (at(mid) >= target) lo = mid; else hi = mid; } D = lo; status = 'Payback resolvido pela margem líquida alvo ao longo da vigência.'; }
    }
    if (D != null && (D < 1 || D > N)) { alerts.push(`O payback precisa ficar entre 1 mês e a vigência (${N} meses).`); D = Math.min(N, Math.max(1, D)); }
    if ((p.mode === 'A' || p.autoPrice) && D == null && status == null) alerts.push('Informe o payback (meses) ou a margem líquida alvo para precificar a recorrência.');
    const suggestions = p.reference ? recP.map((x) => p.reference!.suggested.get(`${x.profile}:${x.id}`) ?? null) : p.netPricing ? recP.map((x) => target == null ? null : recurringFloor(x, inv(x.id), dOpex.get(x.id) ?? 0, N, p, target, ohOf(x))) : D != null ? mensal(D) : recP.map(() => null);
    const prices = recP.map((x, k) => p.autoPrice ? x.bidCents ?? p.reference?.prices?.get(x.profile + ':' + x.id) ?? ((x.priceDefined ?? x.estimatedCents > 0) ? x.estimatedCents : suggestions[k]) : p.mode === 'A' ? suggestions[k] : x.bidCents ?? x.estimatedCents);
    const lines: B2gLine[] = recP.map((x, k) => {
      const a = bp(x.doc!.taxBp), M = prices[k] ?? null, I = inv(x.id), O = dOpex.get(x.id) ?? 0, F = x.doc!.fixedCents;
      const oh = ohOf(x);
      const s = M != null && M > 0 ? recurringChain(M, x, I, O, N, p, oh) : null;
      const den = M != null ? M * (1 - a - v - oh) - O - F : 0;
      const pb = p.netPricing && s ? paybackOf(s.cashflow, p.tmaRate ?? 0) : M != null ? (den > 0 ? I / den : null) : null;
      const floor = Lmin == null ? null : recurringFloor(x, I, O, N, p, Lmin, oh);
      return {
        suggestedCents: suggestions[k] == null ? null : Math.round(suggestions[k]!), priceDefined: x.priceDefined ?? x.estimatedCents > 0, priceBasis: p.reference?.proposedProfiles?.has(x.profile) ? 'informado' : x.bidCents != null ? 'lance' : (p.autoPrice ? (x.priceDefined ?? x.estimatedCents > 0) : p.mode === 'B') ? 'informado' : 'sugerido',
        id: x.id, description: x.description, profile: x.profile, revenue: 'recorrente', doc: x.doc!.name, taxPct: a * 100, estimatedCents: x.estimatedCents, costCents: Math.round(I + O * N),
        weightPct: totalInv > 0 ? (I / totalInv) * 100 : 0, priceCents: M == null ? null : Math.round(M), markup: M != null && I + O * N > 0 ? (M * N) / (I + O * N) : null,
        contributionCents: s ? Math.round(s.contribution) : null, contributionPct: s ? (s.contribution / s.revenue) * 100 : null, overheadCents: s ? Math.round(s.overhead / N) : 0, overheadBase: oh ? 'preco' : null,
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
    Object.assign(recorrente, { investmentCents: totalInv, directImplCents: impl, overheadOnCostCents: overheadOnCost, monthlyCostCents: monthly, monthlyPriceCents: Mtot, termMonths: N, paybackMonths: p.netPricing ? blockPayback(lines) : p.mode === 'A' ? D : blockPayback(lines), paybackStatus: status });
    if (p.mode === 'A' && estM > 0 && Mtot > estM) {
      const pbEst = blockPayback(recP.map((x, k) => ({ ...lines[k]!, priceCents: x.estimatedCents, paybackMonths: (() => { const a = bp(x.doc!.taxBp); const den = x.estimatedCents * (1 - a - v - ohOf(x)) - (dOpex.get(x.id) ?? 0) - x.doc!.fixedCents; return den > 0 ? inv(x.id) / den : null; })() })));
      alerts.push(`A mensalidade calculada (${(Mtot / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) passa do valor estimado do órgão (${(estM / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}). Com o valor estimado, o payback seria ${pbEst == null ? 'inviável' : `${pbEst.toFixed(1).replace('.', ',')} meses`}.`);
    }
    if (D != null && D > N) alerts.push('O payback não pode exceder a vigência.');
  }

  // ------------------------------------------------------------------ consolidado (de baixo para cima; a decisão é global)
  if (p.reference?.totals) {
    // No modo global, os resultados da cesta são a referência; os itens recebem seu rateio em centavos.
    for (const profile of COST_PROFILES) {
      const total = p.reference.totals[profile];
      if (!total) continue;
      const same = products.filter((x) => x.profile === profile);
      const mc = distribute(same, total.contribution, p.weights), op = distribute(same, total.operating, p.weights), net = distribute(same, total.net, p.weights);
      for (const block of [unica, recorrente]) if (block) {
        for (const line of block.lines.filter((l) => l.profile === profile)) {
          const revenue = (line.priceCents ?? 0) * (line.revenue === 'recorrente' ? contractMultiplier : 1);
          line.contributionCents = mc.get(line.id) ?? 0; line.operatingCents = op.get(line.id) ?? 0; line.netCents = net.get(line.id) ?? 0;
          line.contributionPct = revenue > 0 ? line.contributionCents / revenue * 100 : null;
          line.operatingPct = revenue > 0 ? line.operatingCents / revenue * 100 : null;
          line.netPct = revenue > 0 ? line.netCents / revenue * 100 : null;
        }
        block.contributionCents = block.lines.reduce((n, l) => n + (l.contributionCents ?? 0), 0);
        block.operatingCents = block.lines.reduce((n, l) => n + (l.operatingCents ?? 0), 0);
        block.netCents = block.lines.reduce((n, l) => n + (l.netCents ?? 0), 0);
        block.netPct = block.priceCents > 0 ? block.netCents / block.priceCents * 100 : null;
      }
    }
  }
  const all = [...(unica?.lines ?? []), ...(recorrente?.lines ?? [])];
  const revOf = (l: B2gLine) => Math.round((l.priceCents ?? 0) * (l.revenue === 'recorrente' ? contractMultiplier : 1));
  const estOf = (l: B2gLine) => Math.round(l.estimatedCents * (l.revenue === 'recorrente' ? contractMultiplier : 1));
  const baskets = p.reference?.baskets ?? COST_PROFILES.map((profile) => {
    const baseCents = costs.unica[profile] + costs.recorrente[profile];
    const contingencyCents = Math.round(baseCents * bp(p.contingencyCapexBp));
    const serviceInvestmentCents = (profile === 'instalacao' || (!p.netPricing && profile === 'implantacao')) ? serviceInvestmentExtra(baseCents, p.serviceCostBp) : 0;
    const investmentCents = investmentOf(baseCents, profile);
    const monthlyCostCents = profile === 'implantacao' ? Math.round(costs.mensal * opC) + (p.netPricing ? serviceInvestmentExtra(baseCents, p.serviceCostBp) : 0) : 0;
    return { profile, baseCents, contingencyCents, serviceInvestmentCents, serviceMonthlyCents: p.netPricing && profile === 'implantacao' ? serviceInvestmentExtra(baseCents, p.serviceCostBp) : 0, serviceCostBp: p.serviceCostBp ?? SERVICE_INVESTMENT_BP, investmentCents, monthlyCostCents, costCents: investmentCents + monthlyCostCents * N, allocatedCents: all.filter((l) => l.profile === profile).reduce((t, l) => t + l.costCents, 0) };
  });
  const priceT = all.reduce((t, l) => t + revOf(l), 0), costT = baskets.reduce((t, b) => t + b.costCents, 0) + (p.reference ? 0 : costs.variavel);
  const netT = all.reduce((t, l) => t + (l.netCents ?? 0), 0) - Math.max(0, costT - all.reduce((t, l) => t + l.costCents, 0));
  const unallocated = costT - all.reduce((t, l) => t + l.costCents, 0);
  if (unallocated > 0) alerts.push('Existem custos sem produto no mesmo perfil. O custo global inclui esses valores; corrija as cestas antes de aprovar.');
  const floorOk = all.every((l) => l.floorCents != null);
  const floorT = floorOk ? all.reduce((t, l) => t + Math.round(l.floorCents! * (l.revenue === 'recorrente' ? contractMultiplier : 1)), 0) : null;
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
  else if (unallocated > 0) verdict = 'abaixo_minimo';
  else if (netPct == null || netPct < Lmin * 100 - 1e-6) verdict = 'abaixo_minimo';
  else if (all.some((l) => l.netPct != null && l.netPct < 0)) verdict = 'produto_negativo';
  else if (all.some((l) => l.alerts.length)) verdict = 'produto_abaixo';
  if (p.mode === 'B' && floorT != null && estT < floorT) alerts.push('O valor estimado do órgão fica abaixo do piso global: inviável no preço do edital.');
  notes.push('Dentro de cada cesta, o custo é distribuído pelo valor informado; quando falta algum valor, usa pesos iguais (ajustáveis): a relação custo/preço é a mesma para todos os produtos da cesta (salvo peso manual). A decisão de viabilidade é global, com alerta por produto.');
  if (f) notes.push(`Despesas fixas rateadas de ${(f * 100).toLocaleString('pt-BR')}%: na venda única, sobre o preço dos serviços de Instalação; no recorrente, sobre a mensalidade da Implantação (todo mês). Não incidem no Fornecimento.`);
  return {
    mode: p.mode, blocked, kinds, unica, recorrente,
    global: { priceCents: priceT, costCents: costT, markup: costT > 0 ? priceT / costT : null, netCents: netT, netPct, floorCents: floorT, estimatedCents: estT, maxDiscountPct: floorT != null && estT > 0 ? Math.max(0, (1 - floorT / estT) * 100) : null },
    byDoc, verdict, alerts, notes, costs, baskets,
  };

  function blockOf(revenue: RevenueKind, lines: B2gLine[]): B2gBlock {
    const mult = revenue === 'recorrente' ? contractMultiplier : 1;
    const price = lines.reduce((t, l) => t + Math.round((l.priceCents ?? 0) * mult), 0);
    const net = lines.reduce((t, l) => t + (l.netCents ?? 0), 0);
    return {
      revenue, lines, priceCents: price, costCents: lines.reduce((t, l) => t + l.costCents, 0), contributionCents: lines.reduce((t, l) => t + (l.contributionCents ?? 0), 0),
      overheadCents: lines.reduce((t, l) => t + l.overheadCents, 0), operatingCents: lines.reduce((t, l) => t + (l.operatingCents ?? 0), 0), netCents: net, netPct: price > 0 ? (net / price) * 100 : null,
    };
  }
}

/** Recorrente ao longo da vigência: receita N×M; o investimento (com o rateio) entra uma vez; sem despesas fixas mensais. */
/** Cadeia do contrato recorrente; `oh` = despesas fixas rateadas em % da mensalidade (só Implantação). */
export function recurringChain(M: number, x: Pick<B2gProduct, 'doc'>, inv: number, opexMonthly: number, N: number, p: Pick<B2gParams, 'variableBp' | 'riskBp' | 'incomeTaxBp' | 'netPricing' | 'paybackMonths' | 'tmaRate' | 'inflationAnnualBp'>, oh = 0) {
  const a = bp(x.doc!.taxBp), v = bp(p.variableBp), r = bp(p.riskBp), ir = bp(p.incomeTaxBp), F = x.doc!.fixedCents;
  if (p.netPricing) {
    const D = Math.max(1, Math.min(p.paybackMonths ?? N, N));
    const parcel = inv / annuityFactor(p.tmaRate ?? 0, D);
    const inflation = (1 + bp(p.inflationAnnualBp)) ** (1 / 12) - 1;
    let revenue = 0, contribution = 0, overhead = 0, operating = 0, net = 0;
    const cashflow = [-inv];
    for (let k = 1; k <= N; k++) {
      const receipt = M * (1 + inflation) ** Math.max(0, k - 12);
      const mc = receipt * (1 - a - v) - F - opexMonthly - (k <= D ? parcel : 0);
      const fixed = oh * receipt, op = mc - r * receipt - fixed;
      cashflow.push(receipt * (1 - a - v - r - oh) - F - opexMonthly - ir * Math.max(0, op));
      revenue += receipt; contribution += mc; overhead += fixed; operating += op; net += op - ir * Math.max(0, op);
    }
    return { revenue, contribution, overhead, operating, net, cashflow };
  }
  const cashflow: number[] = [];
  const revenue = M * N;
  const contribution = revenue - N * (a * M + F) - N * v * M - N * opexMonthly - inv;
  const overhead = oh * revenue;
  const operating = contribution - r * revenue - overhead;
  const net = operating - ir * Math.max(0, operating);
  return { revenue, contribution, overhead, operating, net, cashflow };
}
/** Mensalidade em que a margem líquida ao longo da vigência é exatamente `L`. */
function recurringFloor(x: B2gProduct, inv: number, opex: number, N: number, p: B2gParams, L: number, oh = 0) {
  if (p.netPricing) {
    const at = (price: number) => { const s = recurringChain(price, x, inv, opex, N, p, oh); return s.revenue > 0 ? s.net / s.revenue : null; };
    let lo = 0, hi = Math.max(1, inv / Math.max(1, N) + opex + x.doc!.fixedCents);
    for (let k = 0; k < 48 && (at(hi) ?? -Infinity) < L; k++) { lo = hi; hi *= 2; }
    if ((at(hi) ?? -Infinity) < L) return null;
    for (let k = 0; k < 70 && hi - lo > 0.001; k++) { const mid = (lo + hi) / 2; if ((at(mid) ?? -Infinity) >= L) hi = mid; else lo = mid; }
    return hi;
  }
  const a = bp(x.doc!.taxBp), v = bp(p.variableBp), r = bp(p.riskBp), ir = bp(p.incomeTaxBp), F = x.doc!.fixedCents;
  const k = 1 - a - v - r - oh;
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
export function b2gFromEconomics(args: Omit<EngineArgs, 'model'>, profitTaxBp?: number | null, mainReference?: EconResult | null): B2gResult {
  const st = args.settings, inp = args.input;
  const fx = applyFiscalEnvelope(args);
  const key = (d: string) => d.trim().toLowerCase();
  const b = inp.b2g ?? {};
  const target = b.netTargetBp ?? st.netMarginTargetBp ?? null;
  const defaultMargin = inp.marginTargetBp ?? st.marginSuggestedBp ?? st.marginTargetBp;
  const contribution = Object.fromEntries(COST_PROFILES.map((profile) => [profile, b.contributionBp?.[profile] ?? (target == null ? defaultMargin : null)]));
  const globalMode = inp.pricingMode === 'global';
  const products: B2gProduct[] = fx.args.items.map((i, index) => {
    const kind = (i.kind ?? 'recorrencia') as DealKind;
    return { id: globalMode ? 'global:' + index : key(i.description), description: i.description, kind, profile: defaultCostProfile(kind), estimatedCents: i.revenueCents, priceDefined: i.priceDefined, bidCents: globalMode ? null : b.bids?.[key(i.description)] ?? null, doc: i.doc && i.doc.complete ? { name: i.doc.name, taxBp: i.doc.percentBp, fixedCents: i.doc.fixedCents } : null };
  });
  const sourceWeights = b.weights;
  const weights = globalMode ? Object.fromEntries(products.flatMap((p) => {
    const value = sourceWeights?.[p.id] ?? sourceWeights?.[key(p.description)];
    return value == null ? [] : [[p.id, value]];
  })) : sourceWeights;
  if (target != null) for (const profile of COST_PROFILES) {
    const same = products.filter((x) => x.profile === profile);
    const top = same.map((x) => x.doc).filter((d): d is NonNullable<B2gProduct['doc']> => !!d).sort((a, b) => b.taxBp - a.taxBp || b.fixedCents - a.fixedCents)[0];
    if (!top) continue;
    const fixed = distribute(same, top.fixedCents, weights);
    for (const x of same) if (x.doc) x.doc = { ...top, fixedCents: fixed.get(x.id) ?? 0 };
  }
  let reference: B2gParams['reference'];
  if (target != null) {
    const main = mainReference ?? financeEngine(args);
    reference = { investments: new Map(), monthly: new Map(), suggested: new Map(), prices: globalMode ? new Map() : undefined, proposedProfiles: globalMode ? new Set() : undefined, totals: globalMode ? {} : undefined, baskets: [] };
    for (const profile of COST_PROFILES) {
      const same = products.filter((x) => x.profile === profile);
      if (!same.length) {
        const raw = b2gCosts(inp.capex, inp.opex, inp.extraInitialCents);
        const baseCents = raw.unica[profile] + raw.recorrente[profile];
        const contingencyCents = Math.round(baseCents * st.contingencyCapexBp / 10000);
        const serviceInvestmentCents = profile === 'instalacao' ? serviceInvestmentExtra(baseCents, st.serviceCostBp) : 0;
        const investmentCents = baseCents + contingencyCents + serviceInvestmentCents;
        const monthlyCostCents = profile === 'implantacao' ? Math.round(raw.mensal * (1 + st.contingencyOpexBp / 10000)) + serviceInvestmentExtra(baseCents, st.serviceCostBp) : 0;
        reference.baskets.push({ profile, baseCents, contingencyCents, serviceInvestmentCents, serviceMonthlyCents: profile === 'implantacao' ? serviceInvestmentExtra(baseCents, st.serviceCostBp) : 0, serviceCostBp: st.serviceCostBp ?? SERVICE_INVESTMENT_BP, investmentCents, monthlyCostCents, costCents: investmentCents + monthlyCostCents * Math.min(inp.termMonths, st.horizonMaxMonths ?? inp.termMonths), allocatedCents: 0 });
        continue;
      }
      const lot = profile === 'fornecimento' ? 'venda' : profile === 'instalacao' ? 'instalacao' : 'servico';
      const cell = main.deal?.cells.find((c) => c.lot === lot);
      const result = cell?.result ?? (!main.deal ? main : null);
      if (!result) continue;
      const investmentCents = result.investmentCents ?? result.initialCents;
      const monthlyCostCents = profile === 'implantacao' ? result.monthlyCostCents : 0;
      for (const [id, value] of distribute(same, investmentCents, weights)) reference.investments.set(`${profile}:${id}`, value);
      for (const [id, value] of distribute(same, monthlyCostCents, weights)) reference.monthly.set(`${profile}:${id}`, value);
      const suggested = cell?.suggestedCents ?? result.suggestedCents;
      if (suggested != null) for (const [id, value] of distribute(same, suggested, weights)) reference.suggested.set(`${profile}:${id}`, value);
      if (globalMode) {
        const proposed = cell?.proposedResult ?? (!main.deal ? main.proposedResult : null);
        const total = (proposed ?? result).statement?.total;
        if (total?.operating != null && total.net != null) reference.totals![profile] = { contribution: total.contribution, operating: total.operating, net: total.net };
        const price = proposed?.priceCents ?? suggested;
        if (proposed) reference.proposedProfiles!.add(profile);
        if (price != null) for (const [id, value] of distribute(same, price, weights)) reference.prices!.set(profile + ':' + id, value);
      }
      reference.baskets.push({ profile, investmentCents, monthlyCostCents, baseCents: result.capexBaseCents, contingencyCents: result.capexContingencyCents, serviceInvestmentCents: result.serviceInvestmentCents, serviceMonthlyCents: result.serviceMonthlyCents, serviceCostBp: result.serviceCostBp, variableFixedCents: result.variableFixedCents, costCents: investmentCents + monthlyCostCents * result.term.N, allocatedCents: investmentCents + monthlyCostCents * result.term.N });
    }
  }
  return b2gViability(products, inp.capex, inp.opex, {
    reference, netPricing: target != null, tmaRate: st.tmaAnnualBp != null ? (1 + st.tmaAnnualBp / 10000) ** (1 / 12) - 1 : st.tmaMonthlyBp / 10000, inflationAnnualBp: st.inflationAnnualBp, autoPrice: true, mode: b.mode ?? 'A', variableBp: inp.variableBp ?? st.variableExpenseBp ?? 0,
    riskBp: (inp.lossBp ?? (args.publicSector ? st.lossPublicBp : st.lossPrivateBp)) + (st.badDebtBp ?? 0),
    incomeTaxBp: profitTaxBp ?? fx.args.settings.incomeTaxBp ?? null, overheadBp: b.overheadBp ?? st.overheadBp ?? 0, netMinBp: st.netMarginMinBp ?? null,
    netTargetBp: target, contributionBp: target != null ? undefined : contribution, solvePayback: false,
    serviceCostBp: st.serviceCostBp, contingencyCapexBp: st.contingencyCapexBp, contingencyOpexBp: st.contingencyOpexBp, termMonths: Math.min(inp.termMonths, st.horizonMaxMonths ?? inp.termMonths), paybackMonths: Math.min(inp.baskets?.implantacao?.paybackMonths ?? inp.paybackMonths ?? econPaybackLimit(inp, st, args.publicSector), econPaybackLimit(inp, st, args.publicSector)),
    paymentTermDays: st.paymentTermDays ?? null, weights: weights,
  }, inp.extraInitialCents);
}
