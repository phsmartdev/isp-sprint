/**
 * Recursos e Orçamento (Política de Orçamento — Anexo I: Planejamento e Execução Orçamentária).
 *
 * Estrutura: Centro de custo › Categoria › Subcategoria, num plano de contas analítico hierárquico
 * (3 Despesas › 3.1 Ferramentas › 3.1.02 Plataforma de CRM). Despesa sempre aparece negativa (−).
 * Planejamento trimestral (validado pela Diretoria), revisão mensal, % de execução com faixas da política,
 * justificativa de desvio acima de 15% e Budget Guardião para ajustes dentro do trimestre.
 */

// ------------------------------------------------------------------ plano de contas
export const ACCOUNT_NATURES = ['despesa', 'receita'] as const;
export type AccountNature = (typeof ACCOUNT_NATURES)[number];
export const ACCOUNT_NATURE_LABELS: Record<AccountNature, string> = { despesa: 'Despesa (−)', receita: 'Receita (+)' };

/** Código da conta: números separados por ponto (3, 3.1, 3.1.02). */
export const ACCOUNT_CODE_RE = /^\d{1,4}(\.\d{1,4}){0,5}$/;
export const accountLevel = (code: string) => code.split('.').length;
export const parentCode = (code: string) => (code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : null);

/** Valida o código de uma conta nova (ou alterada) contra o pai e as que já existem. */
export function accountCodeError(code: string, parent: { code: string } | null, existing: string[]): string | null {
  if (!ACCOUNT_CODE_RE.test(code)) return 'Use números separados por ponto, ex.: 3.1.02';
  if (existing.includes(code)) return 'Já existe uma conta com este código';
  if (parent && !code.startsWith(`${parent.code}.`)) return `O código precisa começar com o da conta-mãe (${parent.code}.)`;
  if (parent && accountLevel(code) !== accountLevel(parent.code) + 1) return 'A conta precisa estar um nível abaixo da conta-mãe';
  if (!parent && accountLevel(code) !== 1) return 'Conta sem conta-mãe precisa ser de primeiro nível (ex.: 3)';
  return null;
}

/** Valor com o sinal da natureza: despesa negativa, receita positiva (centavos). */
export const signed = (nature: AccountNature, cents: number) => (nature === 'despesa' ? -Math.abs(cents) : Math.abs(cents));

export type AccountNode = { id: string; parentId: string | null; code: string; name: string; nature: AccountNature; active: boolean };
/** Ordena as contas pelo código (3 < 3.1 < 3.1.2 < 3.1.10 < 3.2), comparando cada nível como número. */
export function sortAccounts<T extends { code: string }>(list: T[]): T[] {
  const key = (c: string) => c.split('.').map(Number);
  return [...list].sort((a, b) => {
    const x = key(a.code), y = key(b.code);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return -1;
      if (y[i] === undefined) return 1;
      if (x[i] !== y[i]) return x[i]! - y[i]!;
    }
    return 0;
  });
}
/** Conta analítica = sem filhas (só nela se planeja e se lança). */
export const isLeaf = (id: string, all: { parentId: string | null }[]) => !all.some((a) => a.parentId === id);
/** Cadeia de contas da raiz até a conta (para "Categoria › Subcategoria"). */
export function accountPath<T extends { id: string; parentId: string | null }>(id: string, all: T[]): T[] {
  const byId = new Map(all.map((a) => [a.id, a]));
  const out: T[] = [];
  let cur = byId.get(id);
  for (let guard = 0; cur && guard < 10; guard++) { out.unshift(cur); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
  return out;
}

/** Plano de contas sugerido para a área comercial (exemplos da política); a gestão ajusta à vontade. */
export const DEFAULT_ACCOUNTS: { code: string; name: string }[] = [
  { code: '3', name: 'Despesas da área comercial' },
  { code: '3.1', name: 'Comunicação' }, { code: '3.1.01', name: 'Mídia paga' }, { code: '3.1.02', name: 'Produção de conteúdo' }, { code: '3.1.03', name: 'Brindes e materiais impressos' },
  { code: '3.2', name: 'Ferramentas' }, { code: '3.2.01', name: 'Plataforma de CRM' }, { code: '3.2.02', name: 'Softwares e licenças' }, { code: '3.2.03', name: 'Equipamentos e ferramentas de trabalho' },
  { code: '3.3', name: 'Viagens' }, { code: '3.3.01', name: 'Passagens' }, { code: '3.3.02', name: 'Hospedagem' }, { code: '3.3.03', name: 'Alimentação e deslocamento' },
  { code: '3.4', name: 'Serviços' }, { code: '3.4.01', name: 'Consultoria técnica' }, { code: '3.4.02', name: 'Agência e parceiros' }, { code: '3.4.03', name: 'Treinamentos' },
  { code: '3.5', name: 'Eventos e relacionamento' }, { code: '3.5.01', name: 'Feiras e eventos' }, { code: '3.5.02', name: 'Relacionamento com clientes' },
];
/** Centros de custo da política (8.1). */
export const DEFAULT_COST_CENTERS = [
  { code: 'MKT', name: 'Marketing' }, { code: 'COM', name: 'Comercial' }, { code: 'CS', name: 'Sucesso do Cliente' }, { code: 'YEP', name: 'YepNet' }, { code: 'PRD', name: 'Produto' },
];

// ------------------------------------------------------------------ período
export const quarterOfMonth = (month: string) => Math.ceil(Number(month.slice(5, 7)) / 3);
export const monthsOfQuarter = (year: number, q: number) => [0, 1, 2].map((i) => `${year}-${String((q - 1) * 3 + i + 1).padStart(2, '0')}`);
export const quarterLabel = (year: number, q: number) => `${q}º tri/${year}`;

// ------------------------------------------------------------------ execução (3.4)
export const EXECUTION_BANDS = ['subexecucao', 'adequada', 'risco', 'excedente'] as const;
export type ExecutionBand = (typeof EXECUTION_BANDS)[number];
export const EXECUTION_BAND_INFO: Record<ExecutionBand, { label: string; action: string }> = {
  subexecucao: { label: 'Subexecução', action: 'Avaliar replanejamento' },
  adequada: { label: 'Execução adequada', action: 'Acompanhar evolução mensal' },
  risco: { label: 'Risco de estouro', action: 'Avaliar se é necessário acionar o Budget Guardião' },
  excedente: { label: 'Execução excedente', action: 'Somente com Budget Guardião' },
};
/** % de execução = realizado ÷ planejado × 100 (null quando não há planejado). */
export const executionPct = (planned: number, realized: number) => (planned > 0 ? (realized / planned) * 100 : realized > 0 ? Infinity : null);
export function executionBand(pct: number | null): ExecutionBand | null {
  if (pct === null) return null;
  if (pct > 100) return 'excedente';
  if (pct > 90) return 'risco';
  if (pct >= 50) return 'adequada';
  return 'subexecucao';
}

/** Desvio acima de 15% por categoria exige justificativa na revisão mensal (5 e 8.2). */
export const DEVIATION_LIMIT_PCT = 15;
export function deviationPct(planned: number, realized: number) {
  if (planned <= 0) return realized > 0 ? Infinity : 0;
  return ((realized - planned) / planned) * 100;
}
export const needsJustification = (planned: number, realized: number) => Math.abs(deviationPct(planned, realized)) > DEVIATION_LIMIT_PCT;

// ------------------------------------------------------------------ Budget Guardião (6.2)
export const GUARDIAN_LIMIT_PCT = 15;
/**
 * Ajuste dentro do trimestre: até 15% do valor trimestral do centro de custo (somando os ajustes já feitos no trimestre)
 * entra com justificativa e registro; acima disso precisa da Diretoria Comercial. Tudo é reportado à Diretoria.
 */
export function guardianRoute(quarterApprovedCents: number, previousAdjustmentsAbsCents: number, deltaCents: number) {
  const used = previousAdjustmentsAbsCents + Math.abs(deltaCents);
  const pct = quarterApprovedCents > 0 ? (used / quarterApprovedCents) * 100 : Infinity;
  return { pct, needsDirector: pct > GUARDIAN_LIMIT_PCT };
}

/**
 * Gasto contra o orçamento: cabe no planejado aprovado (com ajustes) da subcategoria no trimestre?
 * Acima de 100% só com Budget Guardião (3.4).
 */
export function spendCheck(availableCents: number, amountCents: number) {
  return { ok: amountCents <= availableCents, missingCents: Math.max(0, amountCents - availableCents) };
}

// ------------------------------------------------------------------ planejamento: estados
export const PLAN_STATUS = ['rascunho', 'em_aprovacao', 'aprovado', 'devolvido'] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];
export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = { rascunho: 'Em planejamento', em_aprovacao: 'Aguardando a Diretoria', aprovado: 'Aprovado', devolvido: 'Devolvido para ajuste' };
export const LINE_STATUS = ['rascunho', 'em_aprovacao', 'aprovado', 'recusado'] as const;
export type LineStatus = (typeof LINE_STATUS)[number];
export const LINE_STATUS_LABELS: Record<LineStatus, string> = { rascunho: 'Rascunho', em_aprovacao: 'Em aprovação', aprovado: 'Aprovado', recusado: 'Recusado' };
/** Situação do plano a partir das linhas: tudo decidido e algo aprovado = aprovado; algo em aprovação = em aprovação. */
export function planStatusOf(lines: { status: LineStatus }[], current: PlanStatus): PlanStatus {
  if (current === 'devolvido' && lines.some((l) => l.status === 'rascunho')) return 'devolvido';
  if (lines.some((l) => l.status === 'em_aprovacao')) return 'em_aprovacao';
  if (lines.length && lines.every((l) => l.status === 'aprovado' || l.status === 'recusado') && lines.some((l) => l.status === 'aprovado')) return 'aprovado';
  return current === 'aprovado' ? 'aprovado' : 'rascunho';
}

export const ITEM_TYPES = ['ativo', 'software', 'material', 'servico', 'midia', 'viagem', 'evento', 'outro'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_TYPE_LABELS: Record<ItemType, string> = { ativo: 'Ativo / equipamento', software: 'Software / licença', material: 'Material', servico: 'Serviço', midia: 'Mídia', viagem: 'Viagem', evento: 'Evento', outro: 'Outro' };

/** O mesmo item não pode ser registrado sob categorias distintas no mesmo trimestre (3.3). */
export const normItem = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
export function sameItemConflict(what: string, categoryId: string, others: { what: string; categoryId: string }[]) {
  const n = normItem(what);
  return others.find((o) => normItem(o.what) === n && o.categoryId !== categoryId) ?? null;
}

// ------------------------------------------------------------------ recursos
export const PAYMENT_METHODS = ['cartao_corporativo', 'boleto', 'pix', 'transferencia', 'debito_automatico', 'reembolso'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { cartao_corporativo: 'Cartão corporativo', boleto: 'Boleto', pix: 'Pix', transferencia: 'Transferência', debito_automatico: 'Débito automático', reembolso: 'Reembolso' };

export const RESOURCE_KINDS = ['software', 'contrato', 'assinatura'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = { software: 'Software / licença', contrato: 'Contrato de serviço', assinatura: 'Assinatura' };
export const RESOURCE_PERIODS = ['mensal', 'trimestral', 'anual', 'unico'] as const;
export type ResourcePeriod = (typeof RESOURCE_PERIODS)[number];
export const RESOURCE_PERIOD_LABELS: Record<ResourcePeriod, string> = { mensal: 'Mensal', trimestral: 'Trimestral', anual: 'Anual', unico: 'Pagamento único' };
export const CURRENCIES = ['BRL', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Custo mensal em reais (centavos) de uma licença/contrato: dólar pela cotação informada, anual ÷ 12, trimestral ÷ 3. */
export function monthlyBrlCents(r: { amountCents: number; currency: Currency; fxRate: number | null; period: ResourcePeriod }) {
  const brl = r.currency === 'USD' ? Math.round(r.amountCents * (r.fxRate ?? 0)) : r.amountCents;
  return r.period === 'anual' ? Math.round(brl / 12) : r.period === 'trimestral' ? Math.round(brl / 3) : r.period === 'unico' ? 0 : brl;
}
/** Quanto a licença/contrato custa em cada mês do trimestre (para trazer ao planejamento). */
export function resourceMonths(r: { amountCents: number; currency: Currency; fxRate: number | null; period: ResourcePeriod; startOn: string; endOn: string | null }, months: string[]) {
  const brl = r.currency === 'USD' ? Math.round(r.amountCents * (r.fxRate ?? 0)) : r.amountCents;
  return months.map((m) => {
    const active = r.startOn.slice(0, 7) <= m && (!r.endOn || r.endOn.slice(0, 7) >= m);
    if (!active) return { month: m, cents: 0 };
    if (r.period === 'mensal') return { month: m, cents: brl };
    if (r.period === 'unico') return { month: m, cents: r.startOn.slice(0, 7) === m ? brl : 0 };
    const step = r.period === 'anual' ? 12 : 3;
    const diff = (Number(m.slice(0, 4)) - Number(r.startOn.slice(0, 4))) * 12 + Number(m.slice(5, 7)) - Number(r.startOn.slice(5, 7));
    return { month: m, cents: diff >= 0 && diff % step === 0 ? brl : 0 };
  });
}

export const ASSET_STATUS = ['em_uso', 'estoque', 'manutencao', 'baixado'] as const;
export type AssetStatus = (typeof ASSET_STATUS)[number];
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = { em_uso: 'Em uso', estoque: 'Em estoque', manutencao: 'Em manutenção', baixado: 'Baixado' };
export const ASSET_CATEGORIES = ['notebook', 'celular', 'monitor', 'equipamento_demo', 'ferramenta', 'mobiliario', 'veiculo', 'material_ponto_venda', 'outro'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = { notebook: 'Notebook', celular: 'Celular', monitor: 'Monitor', equipamento_demo: 'Equipamento de demonstração', ferramenta: 'Ferramenta', mobiliario: 'Mobiliário', veiculo: 'Veículo', material_ponto_venda: 'Material de ponto de venda', outro: 'Outro' };
/** Valor contábil pela depreciação linear (centavos), sem ficar negativo. */
export function bookValueCents(valueCents: number, acquiredOn: string, usefulLifeMonths: number | null, at: string) {
  if (!usefulLifeMonths) return valueCents;
  const months = Math.max(0, (Number(at.slice(0, 4)) - Number(acquiredOn.slice(0, 4))) * 12 + Number(at.slice(5, 7)) - Number(acquiredOn.slice(5, 7)));
  return Math.max(0, Math.round(valueCents * (1 - months / usefulLifeMonths)));
}

// ------------------------------------------------------------------ compras (11.3 e 11.4)
export const PURCHASE_KINDS = ['consumo', 'especifica'] as const;
export type PurchaseKind = (typeof PURCHASE_KINDS)[number];
export const PURCHASE_KIND_LABELS: Record<PurchaseKind, string> = { consumo: 'Bens de consumo / insumos (Compras cota)', especifica: 'Compra específica, grande escala ou prestador (negociação + Jurídico + Diretoria)' };
export const PURCHASE_STATUS = ['solicitado', 'em_cotacao', 'aprovado', 'comprado', 'recebido', 'cancelado'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUS)[number];
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = { solicitado: 'Solicitado', em_cotacao: 'Em cotação', aprovado: 'Aprovado', comprado: 'Comprado', recebido: 'Recebido', cancelado: 'Cancelado' };
/** O que falta para executar a compra conforme a política (checagem com o Financeiro; Jurídico e assinatura da Diretoria nas específicas). */
export function purchasePending(p: { kind: PurchaseKind; financeCheck: boolean; legalReview: boolean; directorSigned: boolean; quotes: number }) {
  const out: string[] = [];
  if (!p.financeCheck) out.push('Checagem prévia com o Financeiro');
  if (p.kind === 'consumo' && p.quotes < 1) out.push('Cotação do setor de Compras');
  if (p.kind === 'especifica' && !p.legalReview) out.push('Análise do Jurídico');
  if (p.kind === 'especifica' && !p.directorSigned) out.push('Assinatura da Diretoria Comercial (ou liberação por escrito)');
  return out;
}
