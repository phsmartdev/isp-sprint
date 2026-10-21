/**
 * Análise e aprovação da negociação: regras puras (sem banco).
 * - Quem é o cliente (novo × base) sem depender só do status atual.
 * - Margem e capacidade de negociação: atual, incremental e depois da proposta. Nunca usa o total pago como margem.
 * - Alçadas de desconto por nível e necessidade de aprovação excepcional.
 * - Parecer de apoio à decisão montado só com os dados recebidos (cada frase diz de onde veio).
 * - Mudança material entre o pedido e a decisão.
 */

// ------------------------------------------------------------------ alçadas

export const APPROVAL_LEVELS = ['vendedor', 'supervisor', 'gerencia', 'diretoria'] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];
export const APPROVAL_LEVEL_LABELS: Record<ApprovalLevel, string> = { vendedor: 'Vendedor', supervisor: 'Supervisão', gerencia: 'Gerência', diretoria: 'Diretoria' };

export type ApprovalLimit = { level: ApprovalLevel; maxDiscountBp: number; /** Margem mínima depois do desconto (pontos-base sobre a mensalidade). null = sem exigência. */ minMarginBp: number | null };
export type ApprovalPolicy = { limits: ApprovalLimit[] };

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  limits: [
    { level: 'vendedor', maxDiscountBp: 0, minMarginBp: null },
    { level: 'supervisor', maxDiscountBp: 500, minMarginBp: null },
    { level: 'gerencia', maxDiscountBp: 1500, minMarginBp: null },
    { level: 'diretoria', maxDiscountBp: 3000, minMarginBp: null },
  ],
};

const rank = (l: ApprovalLevel) => APPROVAL_LEVELS.indexOf(l);

/** Alçada do usuário: setor Diretoria vale como Diretoria; senão o maior perfil. */
export function userApprovalLevel(profiles: readonly string[], sectors: readonly string[]): ApprovalLevel {
  if (sectors.includes('diretoria')) return 'diretoria';
  if (profiles.includes('gerencia')) return 'gerencia';
  if (profiles.includes('supervisor')) return 'supervisor';
  return 'vendedor';
}

export const canDecide = (user: ApprovalLevel, required: ApprovalLevel) => rank(user) >= rank(required) && user !== 'vendedor';

export type RequiredLevel = { level: ApprovalLevel; exceptional: boolean; maxAllowedBp: number; reasons: string[] };

/**
 * Menor alçada que comporta o desconto (e a margem mínima, quando a política exige).
 * Acima do limite da Diretoria: aprovação excepcional (só Diretoria decide).
 * Quem aprova é sempre Supervisão ou acima, mesmo quando o desconto cabe na alçada do vendedor.
 */
export function requiredApproval(policy: ApprovalPolicy, discountBp: number, marginAfterBp: number | null): RequiredLevel {
  const limits = APPROVAL_LEVELS.map((l) => policy.limits.find((x) => x.level === l) ?? { level: l, maxDiscountBp: 0, minMarginBp: null });
  const reasons: string[] = [];
  const top = limits[limits.length - 1]!;
  for (const lim of limits) {
    if (discountBp > lim.maxDiscountBp) continue;
    if (lim.minMarginBp !== null) {
      if (marginAfterBp === null) { reasons.push(`A alçada ${APPROVAL_LEVEL_LABELS[lim.level]} exige margem mínima de ${fmtPct(lim.minMarginBp)}, e a margem não pôde ser calculada.`); continue; }
      if (marginAfterBp < lim.minMarginBp) { reasons.push(`Margem depois da proposta (${fmtPct(marginAfterBp)}) abaixo do mínimo de ${fmtPct(lim.minMarginBp)} da alçada ${APPROVAL_LEVEL_LABELS[lim.level]}.`); continue; }
    }
    const level: ApprovalLevel = lim.level === 'vendedor' ? 'supervisor' : lim.level;
    if (lim.level === 'vendedor') reasons.push('Desconto dentro da alçada do vendedor; a aprovação é registrada pela Supervisão.');
    else reasons.push(`Desconto de ${fmtPct(discountBp)} cabe na alçada ${APPROVAL_LEVEL_LABELS[lim.level]} (até ${fmtPct(lim.maxDiscountBp)}).`);
    return { level, exceptional: false, maxAllowedBp: top.maxDiscountBp, reasons };
  }
  reasons.push(discountBp > top.maxDiscountBp ? `Desconto de ${fmtPct(discountBp)} acima do limite da Diretoria (${fmtPct(top.maxDiscountBp)}): aprovação excepcional.` : 'Nenhuma alçada comporta a proposta pelas regras de margem: aprovação excepcional.');
  return { level: 'diretoria', exceptional: true, maxAllowedBp: top.maxDiscountBp, reasons };
}

export const fmtPct = (bp: number) => `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export const fmtMoney = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Desconto em pontos-base entre o preço de tabela e o proposto (0 quando não há desconto). */
export function discountBp(listCents: number | null, proposedCents: number | null) {
  if (!listCents || listCents <= 0 || proposedCents === null || proposedCents >= listCents) return 0;
  return Math.round(((listCents - proposedCents) * 10_000) / listCents);
}

// ------------------------------------------------------------------ quem é o cliente

export type RelationshipEvidence = {
  lifecycle: string | null;
  contracts: number;
  /** Vendas fechadas anteriores (fora esta negociação). */
  wonOpportunities: number;
  importedFromErp: boolean;
};
export type CustomerKind = { kind: 'novo' | 'base'; label: string; reasons: string[] };

const LIFECYCLE_LABEL: Record<string, string> = { em_implantacao: 'em implantação', ativo: 'ativo', inadimplente: 'inadimplente', suspenso: 'suspenso', cancelado: 'cancelado', reativado: 'reativado' };

/** Cliente da base = qualquer relacionamento contratual, atual ou passado. Cancelado continua sendo da base. */
export function customerKind(e: RelationshipEvidence): CustomerKind {
  const reasons: string[] = [];
  if (e.lifecycle && e.lifecycle !== 'prospect') reasons.push(`Situação no cadastro: ${LIFECYCLE_LABEL[e.lifecycle] ?? e.lifecycle}.`);
  if (e.contracts > 0) reasons.push(`${e.contracts} contrato(s) em Gestão de Contratos.`);
  if (e.wonOpportunities > 0) reasons.push(`${e.wonOpportunities} venda(s) fechada(s) anteriores.`);
  if (e.importedFromErp) reasons.push('Cadastro importado do ERP/IXC.');
  if (!reasons.length) return { kind: 'novo', label: 'Novo cliente', reasons: ['Sem contrato, venda fechada ou cadastro no ERP.'] };
  const lc = e.lifecycle && e.lifecycle !== 'prospect' ? LIFECYCLE_LABEL[e.lifecycle] : null;
  return { kind: 'base', label: lc ? `Cliente da base (${lc})` : 'Cliente da base', reasons };
}

// ------------------------------------------------------------------ margem e capacidade

export type ServiceLine = {
  ref: string;
  label: string;
  source: 'contrato' | 'venda' | 'cadastro';
  monthlyCents: number;
  /** Custo mensal atribuível (estimado na venda). null = desconhecido. */
  monthlyCostCents: number | null;
};

export type ProposalTerms = {
  listMonthlyCents: number | null;
  proposedMonthlyCents: number | null;
  /** Custo mensal do novo serviço no preço proposto (viabilidade). */
  monthlyCostCents: number | null;
  /** Investimento de implantação (CAC: comissão, cabo, instalação, equipamentos menos a taxa de ativação). */
  investmentCents: number | null;
  /** Receita atual que esta proposta substitui (upgrade, renovação, troca). 0 = serviço adicional. */
  replacesMonthlyCents: number;
};

export type MarginAnalysis = {
  current: { revenueCents: number; costCents: number | null; marginCents: number | null; marginBp: number | null; servicesWithCost: number; services: number };
  incremental: { revenueCents: number | null; costCents: number | null; marginCents: number | null; investmentCents: number | null; paybackMonths: number | null };
  after: { revenueCents: number | null; marginCents: number | null; marginBp: number | null };
  variation: { marginCents: number | null; marginBpPoints: number | null };
  discount: { bp: number; listCents: number | null; proposedCents: number | null };
  reliable: boolean;
  warnings: string[];
};

const bpOf = (part: number, whole: number) => (whole > 0 ? Math.round((part * 10_000) / whole) : null);

export function negotiationMargin(services: ServiceLine[], p: ProposalTerms): MarginAnalysis {
  const warnings: string[] = [];
  const revenue = services.reduce((a, s) => a + s.monthlyCents, 0);
  const withCost = services.filter((s) => s.monthlyCostCents !== null);
  const costKnown = withCost.length === services.length;
  const cost = costKnown ? withCost.reduce((a, s) => a + s.monthlyCostCents!, 0) : null;
  if (!costKnown) warnings.push(`Faltam custos de ${services.length - withCost.length} de ${services.length} serviço(s) atuais: a margem atual não pode ser calculada com segurança.`);
  const currentMargin = cost === null ? null : revenue - cost;

  const replaces = Math.max(0, p.replacesMonthlyCents);
  if (replaces > revenue) warnings.push('A receita substituída informada é maior que a receita recorrente atual do cliente.');
  // custo da parte substituída: proporcional à margem atual (só quando o custo atual é conhecido)
  const replacedCost = replaces === 0 ? 0 : cost === null || revenue === 0 ? null : Math.round((cost * Math.min(replaces, revenue)) / revenue);
  const incRevenue = p.proposedMonthlyCents === null ? null : p.proposedMonthlyCents - replaces;
  if (p.proposedMonthlyCents === null) warnings.push('Valor mensal proposto não informado.');
  if (p.monthlyCostCents === null && p.proposedMonthlyCents !== null) warnings.push('Custo mensal do novo serviço indisponível: complete a viabilidade (plano, metragem, caminho).');
  const incCost = p.monthlyCostCents === null || replacedCost === null ? null : p.monthlyCostCents - replacedCost;
  const incMargin = incRevenue === null || incCost === null ? null : incRevenue - incCost;
  const payback = incMargin !== null && incMargin > 0 && p.investmentCents !== null ? Math.round((p.investmentCents / incMargin) * 10) / 10 : null;
  if (incMargin !== null && incMargin <= 0) warnings.push('A margem incremental é zero ou negativa: o investimento não se paga com esta proposta.');
  if (p.investmentCents === null) warnings.push('Investimento de implantação indisponível.');

  const afterRevenue = incRevenue === null ? null : revenue + incRevenue;
  const afterMargin = currentMargin === null || incMargin === null ? null : currentMargin + incMargin;
  const currentBp = currentMargin === null ? null : bpOf(currentMargin, revenue);
  const afterBp = afterMargin === null || afterRevenue === null ? null : bpOf(afterMargin, afterRevenue);
  return {
    current: { revenueCents: revenue, costCents: cost, marginCents: currentMargin, marginBp: currentBp, servicesWithCost: withCost.length, services: services.length },
    incremental: { revenueCents: incRevenue, costCents: incCost, marginCents: incMargin, investmentCents: p.investmentCents, paybackMonths: payback },
    after: { revenueCents: afterRevenue, marginCents: afterMargin, marginBp: afterBp },
    variation: {
      marginCents: afterMargin === null || currentMargin === null ? null : afterMargin - currentMargin,
      marginBpPoints: afterBp === null || currentBp === null || services.length === 0 ? null : afterBp - currentBp,
    },
    discount: { bp: discountBp(p.listMonthlyCents, p.proposedMonthlyCents), listCents: p.listMonthlyCents, proposedCents: p.proposedMonthlyCents },
    reliable: costKnown && incMargin !== null,
    warnings,
  };
}

// ------------------------------------------------------------------ parecer

export type OpinionItem = { text: string; source: string };
export type Opinion = {
  summary: string;
  favorable: OpinionItem[];
  attention: OpinionItem[];
  financial: OpinionItem[];
  strategic: OpinionItem[];
  pending: OpinionItem[];
  authority: OpinionItem[];
};

export type OpinionInput = {
  kind: 'novo' | 'base';
  customerName: string;
  classification: { classKey: string | null; payerProfile: string | null; risk: string | null; potential: string | null; classifiedAt: string | null; classifiedBy: string | null } | null;
  lifecycle: string | null;
  relationshipMonths: number | null;
  activeContracts: number;
  margin: MarginAnalysis;
  required: RequiredLevel;
  /** Pagamentos/inadimplência do ERP disponíveis? */
  paymentsAvailable: boolean;
  viability: { complete: boolean; missing: string[]; engineeringRequired: boolean; engineeringStatus: string; alerts: string[] } | null;
  coverageStatus: string;
  justification: string | null;
  risks: string | null;
  leadSource: string | null;
  negotiationLabel: string;
};

const RISK_HIGH = /alto|elevado|cr[ií]tico/i;
const PAYER_GOOD = /pontual|adimplente|em dia/i;
const PAYER_BAD = /atras|inadimpl|irregular/i;

export function buildOpinion(i: OpinionInput): Opinion {
  const o: Opinion = { summary: '', favorable: [], attention: [], financial: [], strategic: [], pending: [], authority: [] };
  const cls = i.classification;
  const m = i.margin;

  if (i.kind === 'base') {
    if (cls?.classKey) o.strategic.push({ text: `Cliente classificado como ${cls.classKey}${cls.classifiedAt ? ` (classificação de ${cls.classifiedAt}${cls.classifiedBy ? ` por ${cls.classifiedBy}` : ''})` : ''}.`, source: 'Classificação estratégica do cadastro' });
    else o.pending.push({ text: 'Cliente sem classificação estratégica (Não classificado).', source: 'Cadastro do cliente' });
    if (cls?.payerProfile) (PAYER_GOOD.test(cls.payerProfile) ? o.favorable : PAYER_BAD.test(cls.payerProfile) ? o.attention : o.strategic).push({ text: `Perfil pagador: ${cls.payerProfile}.`, source: 'Classificação estratégica do cadastro' });
    if (i.lifecycle === 'inadimplente' || i.lifecycle === 'suspenso') o.attention.push({ text: `Situação atual do cliente: ${i.lifecycle}.`, source: 'Cadastro do cliente' });
    if (i.lifecycle === 'cancelado') o.strategic.push({ text: 'Cliente cancelado retornando: há histórico anterior a considerar.', source: 'Cadastro do cliente' });
    if (i.activeContracts > 0) o.favorable.push({ text: `${i.activeContracts} contrato(s) ativo(s).`, source: 'Gestão de Contratos' });
    if (i.relationshipMonths !== null && i.relationshipMonths >= 12) o.favorable.push({ text: `Relacionamento de ${fmtMonths(i.relationshipMonths)}.`, source: 'Cadastro, contratos e vendas' });
    if (!i.paymentsAvailable) o.pending.push({ text: 'Total pago, pontualidade e inadimplência aguardam a integração com o IXC.', source: 'Financeiro' });
  } else {
    if (i.leadSource) o.strategic.push({ text: `Novo cliente vindo de ${i.leadSource}.`, source: 'Origem do lead' });
    if (cls?.potential) o.strategic.push({ text: `Potencial comercial: ${cls.potential}.`, source: 'Classificação estratégica do cadastro' });
  }
  if (cls?.risk) (RISK_HIGH.test(cls.risk) ? o.attention : o.strategic).push({ text: `Risco classificado: ${cls.risk}.`, source: 'Classificação estratégica do cadastro' });

  // financeiro
  const inc = m.incremental;
  if (inc.revenueCents !== null) {
    if (inc.revenueCents > 0) o.financial.push({ text: `A proposta ${i.kind === 'base' ? 'amplia' : 'gera'} a receita recorrente em ${fmtMoney(inc.revenueCents)}/mês (projeção).`, source: 'Condições propostas' });
    else o.attention.push({ text: `A proposta ${inc.revenueCents === 0 ? 'não altera' : 'reduz'} a receita recorrente (${fmtMoney(inc.revenueCents)}/mês).`, source: 'Condições propostas' });
  }
  if (inc.investmentCents !== null && inc.investmentCents > 0) o.financial.push({ text: `Exige investimento de implantação de ${fmtMoney(inc.investmentCents)} (estimado).`, source: 'Viabilidade' });
  if (inc.paybackMonths !== null) (inc.paybackMonths <= 12 ? o.favorable : inc.paybackMonths > 24 ? o.attention : o.financial).push({ text: `Payback incremental estimado em ${inc.paybackMonths.toLocaleString('pt-BR')} meses.`, source: 'Viabilidade' });
  if (m.current.marginBp !== null && m.after.marginBp !== null && i.kind === 'base') {
    const delta = m.after.marginBp - m.current.marginBp;
    (delta < 0 ? o.attention : o.financial).push({ text: `Margem consolidada de ${fmtPct(m.current.marginBp)} para ${fmtPct(m.after.marginBp)} (estimativa).`, source: 'Margem e capacidade de negociação' });
  } else if (i.kind === 'novo' && m.after.marginBp !== null) {
    o.financial.push({ text: `Margem prevista de ${fmtPct(m.after.marginBp)} sobre a mensalidade (estimativa).`, source: 'Viabilidade' });
  }
  for (const w of m.warnings) o.pending.push({ text: w, source: 'Margem e capacidade de negociação' });

  // viabilidade e cobertura
  if (i.viability) {
    if (!i.viability.complete && i.viability.missing.length) o.pending.push({ text: `Viabilidade incompleta: falta ${i.viability.missing.join(', ')}.`, source: 'Viabilidade' });
    if (i.viability.engineeringRequired && i.viability.engineeringStatus !== 'aprovada') o.attention.push({ text: 'Fora da autonomia da operação: viabilidade da engenharia ainda não aprovada.', source: 'Viabilidade técnica' });
  }
  if (i.coverageStatus === 'inelegivel') o.attention.push({ text: 'Endereço sem cobertura.', source: 'Cobertura' });

  // alçada
  if (m.discount.bp > 0) o.authority.push({ text: `Desconto solicitado de ${fmtPct(m.discount.bp)} sobre a tabela (${fmtMoney(m.discount.listCents ?? 0)} → ${fmtMoney(m.discount.proposedCents ?? 0)}).`, source: 'Condições propostas' });
  else o.authority.push({ text: 'Sem desconto sobre o preço de tabela.', source: 'Condições propostas' });
  for (const r of i.required.reasons) o.authority.push({ text: r, source: 'Política de alçadas' });
  o.authority.push({ text: `Alçada necessária: ${APPROVAL_LEVEL_LABELS[i.required.level]}${i.required.exceptional ? ' (excepcional)' : ''}.`, source: 'Política de alçadas' });
  if (i.required.exceptional) o.attention.push({ text: 'Proposta fora da política comercial: exige aprovação excepcional.', source: 'Política de alçadas' });

  if (!i.justification?.trim()) o.pending.push({ text: 'Justificativa comercial não informada.', source: 'Pedido de aprovação' });
  if (i.risks?.trim()) o.attention.push({ text: `Riscos apontados pelo vendedor: ${i.risks.trim()}`, source: 'Pedido de aprovação' });

  o.summary = summarize(i, o);
  return o;
}

function summarize(i: OpinionInput, o: Opinion) {
  const parts: string[] = [];
  const cls = i.classification;
  if (i.kind === 'base') {
    const who = [cls?.classKey ? `classificado como ${cls.classKey}` : 'sem classificação estratégica', cls?.payerProfile ? `perfil pagador ${cls.payerProfile.toLowerCase()}` : null, i.activeContracts ? `${i.activeContracts} contrato(s) ativo(s)` : 'sem contrato ativo'].filter(Boolean).join(', ');
    parts.push(`Cliente da base ${who}.`);
  } else {
    parts.push(`Novo cliente${i.leadSource ? ` vindo de ${i.leadSource}` : ''}, sem histórico de pagamentos.`);
  }
  const inc = i.margin.incremental;
  if (inc.revenueCents !== null) parts.push(inc.revenueCents > 0 ? `A proposta (${i.negotiationLabel.toLowerCase()}) ${i.kind === 'base' ? 'amplia' : 'gera'} a receita recorrente em ${fmtMoney(inc.revenueCents)}/mês` : `A proposta (${i.negotiationLabel.toLowerCase()}) não amplia a receita recorrente`);
  if (inc.investmentCents) parts[parts.length - 1] += `${inc.revenueCents !== null ? ',' : ''} mas exige investimento estimado de ${fmtMoney(inc.investmentCents)}`;
  if (inc.revenueCents !== null || inc.investmentCents) parts[parts.length - 1] += '.';
  parts.push(i.margin.discount.bp > 0
    ? `O desconto de ${fmtPct(i.margin.discount.bp)} deve ser avaliado pela alçada ${APPROVAL_LEVEL_LABELS[i.required.level]}${i.required.exceptional ? ', em caráter excepcional' : ''}${i.margin.reliable ? ', considerando a margem incremental' : '; a margem não pôde ser calculada com segurança'}.`
    : `Sem desconto; alçada ${APPROVAL_LEVEL_LABELS[i.required.level]}.`);
  if (o.pending.length) parts.push(`${o.pending.length} informação(ões) pendente(s).`);
  return parts.join(' ');
}

export const fmtMonths = (m: number) => (m >= 12 ? `${Math.floor(m / 12)} ano(s)${m % 12 ? ` e ${m % 12} mês(es)` : ''}` : `${m} mês(es)`);

/** Meses inteiros entre duas datas AAAA-MM-DD. */
export function monthsBetween(from: string, to: string) {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number) as [number, number, number];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

// ------------------------------------------------------------------ mudança material

export type AnalysisFingerprint = {
  proposedMonthlyCents: number | null;
  listMonthlyCents: number | null;
  investmentCents: number | null;
  newServiceMarginCents: number | null;
  currentRevenueCents: number;
  activeContracts: number;
  classificationId: string | null;
  lifecycle: string | null;
  proposalSha: string | null;
};

/** Diferenças que pedem nova análise. Valores mudam materialmente acima de 5%. */
export function materialChanges(before: AnalysisFingerprint, now: AnalysisFingerprint): string[] {
  const out: string[] = [];
  const moved = (a: number | null, b: number | null) => (a === null) !== (b === null) || (a !== null && b !== null && Math.abs(a - b) > Math.max(100, Math.abs(a) * 0.05));
  if (before.proposedMonthlyCents !== now.proposedMonthlyCents) out.push('O valor proposto mudou.');
  if (moved(before.listMonthlyCents, now.listMonthlyCents)) out.push('O preço de tabela do plano mudou.');
  if (moved(before.investmentCents, now.investmentCents)) out.push('O investimento de implantação mudou.');
  if (moved(before.newServiceMarginCents, now.newServiceMarginCents)) out.push('A margem do novo serviço mudou (viabilidade recalculada).');
  if (moved(before.currentRevenueCents, now.currentRevenueCents)) out.push('A receita recorrente atual do cliente mudou.');
  if (before.activeContracts !== now.activeContracts) out.push('A quantidade de contratos ativos mudou.');
  if (before.classificationId !== now.classificationId) out.push('A classificação estratégica do cliente foi atualizada.');
  if (before.lifecycle !== now.lifecycle) out.push('A situação do cliente no cadastro mudou.');
  if (before.proposalSha !== now.proposalSha) out.push('A proposta anexada mudou.');
  return out;
}

// ------------------------------------------------------------------ classificação estratégica

export const CLASSIFICATION_DIMENSIONS = ['classKey', 'category', 'profile', 'payerProfile', 'potential', 'risk'] as const;
export type ClassificationDimension = (typeof CLASSIFICATION_DIMENSIONS)[number];
export const CLASSIFICATION_LABELS: Record<ClassificationDimension, string> = {
  classKey: 'Classe estratégica',
  category: 'Categoria',
  profile: 'Perfil do cliente',
  payerProfile: 'Perfil pagador',
  potential: 'Potencial comercial',
  risk: 'Risco',
};
export type ClassificationOptions = Record<ClassificationDimension, string[]>;
/** Opções iniciais (editáveis em Configurações → Aprovações). */
export const DEFAULT_CLASSIFICATION_OPTIONS: ClassificationOptions = {
  classKey: ['Reputação', 'Potencial', 'Expansão', 'Aposta Estratégica'],
  category: ['Residencial', 'Pequena empresa', 'Média empresa', 'Grande conta', 'Governo'],
  profile: ['Estratégico', 'Crescimento', 'Manutenção', 'Retenção'],
  payerProfile: ['Pontual', 'Atrasos eventuais', 'Atrasos recorrentes', 'Inadimplente'],
  potential: ['Alto', 'Médio', 'Baixo'],
  risk: ['Baixo', 'Médio', 'Alto'],
};

export const NEGOTIATION_TYPES = ['novo_servico', 'upgrade', 'renovacao', 'downgrade', 'retencao', 'outro'] as const;
export type NegotiationType = (typeof NEGOTIATION_TYPES)[number];
export const NEGOTIATION_TYPE_LABELS: Record<NegotiationType, string> = {
  novo_servico: 'Novo serviço',
  upgrade: 'Upgrade',
  renovacao: 'Renovação',
  downgrade: 'Downgrade',
  retencao: 'Retenção',
  outro: 'Outro',
};

export const DECISIONS = ['aprovada', 'reprovada', 'correcao'] as const;
export type Decision = (typeof DECISIONS)[number];
export const DECISION_LABELS: Record<Decision | 'pendente' | 'substituida', string> = { aprovada: 'Aprovada', reprovada: 'Reprovada', correcao: 'Correção solicitada', pendente: 'Aguardando decisão', substituida: 'Substituída por nova versão' };

/** Mensagem de aviso (WhatsApp/e-mail): só o resumo seguro. Variáveis {{chave}}. */
export const DEFAULT_APPROVAL_TEMPLATE =
  'Aprovação solicitada: {{cliente}}\nOportunidade: {{oportunidade}}\nResponsável: {{responsavel}}\nTipo: {{tipo}}\n{{classe_linha}}Valor proposto: {{valor}}\nJustificativa: {{justificativa}}\nAnalisar: {{link}}';

export function renderApprovalTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}
