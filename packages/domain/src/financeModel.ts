/**
 * Modelo financeiro do Financial Studio: as fórmulas do motor financeiro (FINANCE-2.x) escritas na linguagem de fórmulas,
 * com a origem de cada variável e o grafo de dependências. É este modelo que o motor executa: a versão padrão reproduz
 * exatamente o motor anterior (testado), e as versões publicadas pela diretoria substituem fórmulas sem mexer no código.
 *
 * Variáveis de entrada vêm dos dados reais (planilha de custos, produtos e documentos fiscais da oportunidade,
 * parâmetros publicados em Configurações → Viabilidade). Valores em R$ estão em centavos; taxas em fração (0,15 = 15%).
 */
import { checkFinFormula, evalFinFormula, finFormulaRefs, parseFinFormula, printFinFormula, FormulaError, type FNode, type FType, type FValue } from './formula';

export type FinUnit = 'R$' | '%' | 'meses' | 'mês' | 'sim/não' | 'fator';
export const FIN_CATEGORIES = ['tributos', 'receitas', 'custos_operacionais', 'custos_implantacao', 'despesas', 'margens', 'investimentos', 'precos', 'fluxo', 'indicadores', 'decisao', 'personalizadas'] as const;
export type FinCategory = (typeof FIN_CATEGORIES)[number];
export const FIN_CATEGORY_LABELS: Record<FinCategory, string> = {
  tributos: 'Tributos e impostos', receitas: 'Receitas', custos_operacionais: 'Custos operacionais', custos_implantacao: 'Custos de implantação', despesas: 'Despesas',
  margens: 'Margens', investimentos: 'Investimentos e CAPEX', precos: 'Preços', fluxo: 'Fluxo de caixa', indicadores: 'TMA, TIR, VPL, ROI e payback', decisao: 'Indicadores de decisão', personalizadas: 'Fórmulas personalizadas',
};

/** Variável de entrada: de onde vem o valor (módulo, entidade, tabela e campo) e como é atualizado. */
export type FinVariable = { code: string; name: string; type: FType; unit: FinUnit; module: string; origin: string; source?: string; rule: string };

export const FIN_VARIABLES: FinVariable[] = [
  { code: 'recorrente', name: 'Contrato recorrente', type: 'bool', unit: 'sim/não', module: 'Oportunidade → Viabilidade econômica', origin: 'Tipo de receita (mensal ou pagamento único)', source: 'opportunity_economics.input.mode', rule: 'Escolhido pelo vendedor na aba Viabilidade econômica' },
  { code: 'preco', name: 'Preço avaliado', type: 'num', unit: 'R$', module: 'CRM → Oportunidade', origin: 'Preço informado na viabilidade; sem ele, o total dos produtos; sem produtos, o preço recomendado do motor', source: 'opportunity_economics.input.priceCents · opportunity_items (qtd × valor − desconto + acréscimo)', rule: 'Atualiza ao salvar a viabilidade ou mudar os produtos' },
  { code: 'receita_produtos', name: 'Total dos produtos', type: 'num', unit: 'R$', module: 'CRM → Oportunidade → Produtos', origin: 'Soma dos produtos da oportunidade', source: 'opportunity_items', rule: 'Muda com os produtos da oportunidade' },
  { code: 'investimento_base', name: 'Investimento (planilha)', type: 'num', unit: 'R$', module: 'Motor Financeiro → Custos', origin: 'Linhas de valor único da planilha com impacto Material/Equipamento ou Serviço/Mão de obra (qtd × custo unit.)', source: 'opportunity_economics.input.capex', rule: 'Planilha da oportunidade; preço do catálogo aprendido por descrição + unidade' },
  { code: 'despesas_variaveis', name: 'Despesas variáveis em R$', type: 'num', unit: 'R$', module: 'Motor Financeiro → Custos', origin: 'Linhas com impacto Despesa de entrega ou Taxa fixa de venda, mais "outras despesas de entrega e taxas"', source: 'opportunity_economics.input.capex (impact) · extraInitialCents', rule: 'Planilha da oportunidade' },
  { code: 'custo_mensal_base', name: 'Custos mensais (planilha)', type: 'num', unit: 'R$', module: 'Motor Financeiro → Custos', origin: 'Linhas mensais da planilha (custo operacional)', source: 'opportunity_economics.input.opex', rule: 'Planilha da oportunidade; só na venda recorrente' },
  { code: 'aliq_contingencia_capex', name: 'Contingência do investimento', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Contingências → sobre o investimento', source: 'econ_settings_versions.values.contingencyCapexBp', rule: 'Versão de parâmetros vigente' },
  { code: 'aliq_contingencia_opex', name: 'Contingência dos custos mensais', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Contingências → sobre os custos mensais', source: 'econ_settings_versions.values.contingencyOpexBp', rule: 'Versão de parâmetros vigente' },
  { code: 'aliq_tributos', name: 'Tributos sobre o preço', type: 'num', unit: '%', module: 'Motor Financeiro → Tributação', origin: 'Filial → Documento fiscal de cada produto → tributos vigentes, ponderados pela receita do produto', source: 'fiscal_doc_types.taxes · opportunity_items.fiscal_doc_type_id', rule: 'Vigência dos tributos do documento na data do cálculo' },
  { code: 'tributo_fixo', name: 'Tributo fixo por fatura', type: 'num', unit: 'R$', module: 'Motor Financeiro → Tributação', origin: 'Valor fixo dos tributos, uma vez por documento fiscal (fatura)', source: 'fiscal_doc_types.taxes (fixedCents)', rule: 'Vigência dos tributos do documento' },
  { code: 'tributos_completos', name: 'Tributos de todos os produtos', type: 'bool', unit: 'sim/não', module: 'Motor Financeiro → Tributação', origin: 'Todo produto tem documento fiscal com tributos vigentes', source: 'opportunity_items · fiscal_doc_types', rule: 'Recalculado com os produtos e documentos' },
  { code: 'aliq_comissao', name: 'Comissão', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Comissão padrão ou o ajuste da negociação', source: 'econ_settings_versions.values.commissionBp · input.commissionBp', rule: 'Parâmetro vigente; o vendedor pode ajustar' },
  { code: 'aliq_glosa', name: 'Glosa', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Glosa do setor (público ou privado) ou o ajuste da negociação', source: 'econ_settings_versions.values.lossPrivateBp / lossPublicBp · input.lossBp', rule: 'Setor pela conta (natureza, segmento governamental ou licitação)' },
  { code: 'aliq_inadimplencia', name: 'Inadimplência', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Inadimplência esperada sobre o faturamento', source: 'econ_settings_versions.values.badDebtBp', rule: 'Versão de parâmetros vigente (0 quando não informada)' },
  { code: 'margem', name: 'Margem escolhida', type: 'num', unit: '%', module: 'Oportunidade → Viabilidade econômica', origin: 'Margem do vendedor, limitada ao piso e ao teto; sem escolha, a sugestão', source: 'input.marginTargetBp · values.marginSuggestedBp', rule: 'Ajuste fino do vendedor' },
  { code: 'margem_piso', name: 'Piso da margem', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Política de aprovação → piso da margem de contribuição', source: 'econ_settings_versions.values.marginTargetBp', rule: 'Versão de parâmetros vigente' },
  { code: 'tma_anual', name: 'TMA anual', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Premissas da projeção → TMA anual', source: 'econ_settings_versions.values.tmaAnnualBp', rule: 'Versão de parâmetros vigente (NULO nas versões antigas)' },
  { code: 'tma_mensal_informada', name: 'TMA mensal (versões antigas)', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'TMA mensal guardada na versão de parâmetros', source: 'econ_settings_versions.values.tmaMonthlyBp', rule: 'Usada só quando a TMA anual não foi informada' },
  { code: 'inflacao_anual', name: 'Inflação anual', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Premissas da projeção → inflação anual (reajuste)', source: 'econ_settings_versions.values.inflationAnnualBp', rule: 'Versão de parâmetros vigente (NULO = sem reajuste)' },
  { code: 'aliq_despesas_fixas', name: 'Despesas fixas rateadas', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Margem operacional e líquida → despesas fixas rateadas', source: 'econ_settings_versions.values.overheadBp', rule: 'NULO quando não informada' },
  { code: 'aliq_ir', name: 'IR/CSLL', type: 'num', unit: '%', module: 'Configurações → Viabilidade', origin: 'Margem operacional e líquida → IR/CSLL', source: 'econ_settings_versions.values.incomeTaxBp', rule: 'NULO quando não informado' },
  { code: 'prazo', name: 'Meses projetados', type: 'num', unit: 'meses', module: 'Oportunidade → Viabilidade econômica', origin: 'Vigência do contrato limitada ao prazo máximo de previsão', source: 'input.termMonths · values.horizonMaxMonths', rule: 'Recorrente; 0 na venda pontual' },
  { code: 'payback', name: 'Payback do vendedor', type: 'num', unit: 'meses', module: 'Oportunidade → Viabilidade econômica', origin: 'Payback escolhido, até o teto do setor e o prazo projetado', source: 'input.paybackMonths · values.paybackMaxPrivate / paybackMaxPublic', rule: 'Ajuste fino do vendedor; sem escolha, o teto' },
  { code: 'teto_payback', name: 'Teto de payback do setor', type: 'num', unit: 'meses', module: 'Configurações → Viabilidade', origin: 'Teto de payback do setor público ou privado', source: 'econ_settings_versions.values.paybackMaxPrivate / paybackMaxPublic', rule: 'Setor pela conta' },
  { code: 'mes_recebimento', name: 'Mês do recebimento', type: 'num', unit: 'mês', module: 'Oportunidade → Viabilidade econômica', origin: 'Venda pontual: mês em que o dinheiro entra (0 = à vista)', source: 'input.receiveMonth', rule: 'Escolhido pelo vendedor' },
  { code: 'mes', name: 'Mês da projeção', type: 'num', unit: 'mês', module: 'Motor Financeiro → Fluxo de caixa', origin: 'Mês t da projeção (1 = primeiro mês; nas colunas "por mês" vale 1)', rule: 'Percorre 1 até o prazo ao montar o fluxo de caixa' },
  { code: 'fluxo', name: 'Fluxo de caixa (série)', type: 'serie', unit: 'R$', module: 'Motor Financeiro → Fluxo de caixa', origin: 'Mês 0 = fluxo_inicial; meses 1..prazo = fluxo_caixa no mês (na pontual, o fluxo entra no mês do recebimento)', rule: 'Montada a partir das fórmulas fluxo_inicial e fluxo_caixa' },
];

export type FinFormulaDef = { code: string; name: string; category: FinCategory; unit: FinUnit; expression: string; desc: string };

/** Fórmulas do motor financeiro (versão padrão = motor FINANCE-2.0, conferida nos testes de compatibilidade). */
export const FIN_FORMULAS: FinFormulaDef[] = [
  { code: 'tma_mensal', name: 'TMA mensal', category: 'indicadores', unit: '%', expression: 'SE(VAZIO(tma_anual); tma_mensal_informada; TAXA_MENSAL(tma_anual))', desc: 'Taxa de desconto do VPL e do payback' },
  { code: 'inflacao_mensal', name: 'Inflação mensal', category: 'receitas', unit: '%', expression: 'SE(VAZIO(inflacao_anual); 0; TAXA_MENSAL(inflacao_anual))', desc: 'Reajuste mensal equivalente' },
  { code: 'receita', name: 'Receita do mês', category: 'receitas', unit: 'R$', expression: 'preco * (1 + inflacao_mensal) ^ MAX(0; mes - 12)', desc: 'Preço com reajuste a partir do 13º mês' },
  { code: 'tributos', name: 'Tributos', category: 'tributos', unit: 'R$', expression: 'receita * aliq_tributos + tributo_fixo', desc: 'Tributos da nota fiscal (alíquota ponderada + fixo por fatura)' },
  { code: 'comissao', name: 'Comissão', category: 'despesas', unit: 'R$', expression: 'receita * aliq_comissao', desc: 'Despesa variável sobre o preço' },
  { code: 'risco', name: 'Glosa e inadimplência', category: 'despesas', unit: 'R$', expression: 'receita * (aliq_glosa + aliq_inadimplencia)', desc: 'Perdas esperadas sobre o faturamento' },
  { code: 'despesas_fixas', name: 'Despesas fixas rateadas', category: 'despesas', unit: 'R$', expression: 'SE(VAZIO(aliq_despesas_fixas); NULO; receita * aliq_despesas_fixas)', desc: 'Estrutura e administrativo' },
  { code: 'custo_mensal', name: 'Custo operacional mensal', category: 'custos_operacionais', unit: 'R$', expression: 'SE(recorrente; custo_mensal_base * (1 + aliq_contingencia_opex); 0)', desc: 'Custos mensais com contingência' },
  { code: 'investimento', name: 'Investimento inicial', category: 'investimentos', unit: 'R$', expression: 'investimento_base * (1 + aliq_contingencia_capex)', desc: 'CAPEX com contingência' },
  { code: 'investimento_total', name: 'Investimento total', category: 'investimentos', unit: 'R$', expression: 'investimento + despesas_variaveis', desc: 'Investimento + despesas variáveis em R$ (sem contingência)' },
  { code: 'amortizacao', name: 'Amortização do investimento', category: 'custos_implantacao', unit: 'R$', expression: 'SE(recorrente; SE(mes <= payback; investimento_total / payback; 0); investimento_total)', desc: 'Investimento diluído no payback (na pontual, de uma vez)' },
  { code: 'margem_contribuicao', name: 'Margem de contribuição', category: 'margens', unit: 'R$', expression: 'receita - tributos - comissao - custo_mensal - amortizacao', desc: 'Margem da precificação (com o investimento amortizado)' },
  { code: 'margem_contribuicao_pct', name: 'Margem de contribuição (%)', category: 'margens', unit: '%', expression: 'margem_contribuicao / receita', desc: 'Sobre a receita' },
  { code: 'margem_operacional', name: 'Margem operacional', category: 'margens', unit: 'R$', expression: 'margem_contribuicao - risco - despesas_fixas', desc: 'Depois de glosa, inadimplência e despesas fixas' },
  { code: 'ir_csll', name: 'IR/CSLL', category: 'tributos', unit: 'R$', expression: 'SE(OU(VAZIO(aliq_ir); VAZIO(margem_operacional)); NULO; MAX(0; margem_operacional) * aliq_ir)', desc: 'Sobre a margem operacional positiva (fora da nota)' },
  { code: 'margem_liquida', name: 'Margem líquida', category: 'margens', unit: 'R$', expression: 'margem_operacional - ir_csll', desc: 'Depois do IR/CSLL' },
  { code: 'fluxo_inicial', name: 'Fluxo do mês 0', category: 'fluxo', unit: 'R$', expression: '-investimento_total', desc: 'Desembolso do investimento' },
  { code: 'fluxo_caixa', name: 'Fluxo de caixa do mês', category: 'fluxo', unit: 'R$', expression: 'receita - risco - tributos - comissao - custo_mensal', desc: 'O que entra no caixa no mês' },
  { code: 'base_caixa', name: 'Base líquida de caixa', category: 'precos', unit: '%', expression: '1 - aliq_tributos - aliq_comissao - aliq_glosa - aliq_inadimplencia', desc: 'Parte do preço que sobra depois das deduções' },
  { code: 'base_markup', name: 'Base do markup', category: 'precos', unit: '%', expression: '1 - aliq_tributos - aliq_comissao', desc: 'Denominador do markup divisor antes da margem' },
  { code: 'custo_preco', name: 'Custos a cobrir no preço', category: 'precos', unit: 'R$', expression: 'SE(recorrente; custo_mensal + tributo_fixo + investimento_total / payback; investimento_total + tributo_fixo)', desc: 'Numerador do markup (valores em R$)' },
  { code: 'preco_caixa', name: 'Preço que cobre o caixa', category: 'precos', unit: 'R$', expression: 'SE(base_caixa > 0; custo_preco / base_caixa; NULO)', desc: 'Piso de caixa' },
  { code: 'preco_tma', name: 'Preço que cobre a TMA', category: 'precos', unit: 'R$', expression: 'SE(base_caixa > 0; SE(recorrente; (custo_mensal + tributo_fixo + investimento_total / ANUIDADE(tma_mensal; payback)) / base_caixa; (investimento_total * (1 + tma_mensal) ^ mes_recebimento + tributo_fixo) / base_caixa); NULO)', desc: 'Piso econômico (investimento remunerado pela TMA)' },
  { code: 'preco_minimo', name: 'Preço mínimo', category: 'precos', unit: 'R$', expression: 'MAX(preco_caixa; preco_tma)', desc: 'Maior dos pisos' },
  { code: 'preco_exato', name: 'Preço exato (markup divisor)', category: 'precos', unit: 'R$', expression: 'SE(base_markup - margem > 0; custo_preco / (base_markup - margem); NULO)', desc: 'Preço que entrega a margem escolhida' },
  { code: 'preco_margem_minima', name: 'Preço na margem mínima', category: 'precos', unit: 'R$', expression: 'SE(base_markup - margem_piso > 0; custo_preco / (base_markup - margem_piso); NULO)', desc: 'Preço que entrega o piso da margem' },
  { code: 'preco_recomendado', name: 'Preço recomendado', category: 'precos', unit: 'R$', expression: 'SE(VAZIO(preco_exato); NULO; MAX(preco_minimo; preco_exato))', desc: 'Preço exato, nunca abaixo do mínimo' },
  { code: 'preco_margem_operacional_zero', name: 'Preço da margem operacional zero', category: 'precos', unit: 'R$', expression: 'SE(VAZIO(aliq_despesas_fixas); NULO; SE(base_markup - aliq_glosa - aliq_inadimplencia - aliq_despesas_fixas > 0; custo_preco / (base_markup - aliq_glosa - aliq_inadimplencia - aliq_despesas_fixas); NULO))', desc: 'Preço em que a margem operacional zera' },
  { code: 'preco_minimo_sugerido', name: 'Preço mínimo sugerido', category: 'precos', unit: 'R$', expression: 'MAX(preco_minimo; preco_margem_minima; preco_margem_operacional_zero)', desc: 'Maior entre os pisos' },
  { code: 'vpl', name: 'VPL', category: 'indicadores', unit: 'R$', expression: 'VPL(fluxo; tma_mensal)', desc: 'Valor presente líquido pela TMA' },
  { code: 'tir', name: 'TIR mensal', category: 'indicadores', unit: '%', expression: 'TIR(fluxo)', desc: 'Taxa interna de retorno ao mês' },
  { code: 'tir_anual', name: 'TIR anual', category: 'indicadores', unit: '%', expression: 'SE(VAZIO(tir); NULO; TAXA_ANUAL(tir))', desc: 'TIR ao ano' },
  { code: 'payback_descontado', name: 'Payback descontado', category: 'indicadores', unit: 'meses', expression: 'PAYBACK(fluxo; tma_mensal)', desc: 'Meses para recuperar o investimento, descontada a TMA' },
  { code: 'payback_simples', name: 'Payback simples', category: 'indicadores', unit: 'meses', expression: 'PAYBACK(fluxo; 0)', desc: 'Sem descontar a TMA' },
  { code: 'roi', name: 'ROI', category: 'indicadores', unit: '%', expression: 'SE(investimento_total > 0; SOMA(fluxo) / investimento_total; NULO)', desc: '(soma dos fluxos − investimento) ÷ investimento' },
  { code: 'atende_preco_minimo', name: 'Preço no mínimo ou acima', category: 'decisao', unit: 'sim/não', expression: 'SE(VAZIO(preco_minimo); VERDADEIRO; preco >= ARRED(preco_minimo; 0))', desc: 'Preço avaliado ≥ preço mínimo' },
  { code: 'atende_margem', name: 'Margem no piso ou acima', category: 'decisao', unit: 'sim/não', expression: 'margem_contribuicao_pct >= margem_piso - 0.00000000001', desc: 'Margem de contribuição ≥ piso' },
  { code: 'atende_payback', name: 'Payback dentro do teto', category: 'decisao', unit: 'sim/não', expression: 'SE(recorrente; OU(investimento_total == 0; E(NAO(VAZIO(payback_descontado)); payback_descontado <= teto_payback)); VERDADEIRO)', desc: 'Payback descontado ≤ teto do setor' },
  { code: 'tir_acima_tma', name: 'TIR acima da TMA', category: 'decisao', unit: 'sim/não', expression: 'SE(VAZIO(tir); E(investimento_total == 0; ARRED(vpl; 0) > 0); tir > tma_mensal)', desc: 'Sem investimento, basta o VPL positivo' },
  { code: 'aprovacao_automatica', name: 'Aprovação automática', category: 'decisao', unit: 'sim/não', expression: 'E(ARRED(vpl; 0) > 0; tir_acima_tma; atende_payback; atende_margem; atende_preco_minimo; base_caixa > 0; tributos_completos)', desc: 'Todas as regras passam; senão, alçada superior' },
];
export const FIN_FORMULA_CODES = FIN_FORMULAS.map((f) => f.code);
/** Fórmulas do desdobramento (por mês e somadas no contrato) e da cadeia de margens. */
export const STATEMENT_CODES = ['receita', 'tributos', 'comissao', 'custo_mensal', 'amortizacao', 'margem_contribuicao', 'risco', 'despesas_fixas', 'margem_operacional', 'ir_csll', 'margem_liquida', 'fluxo_caixa'] as const;
/** Fórmulas que o motor lê para montar o resultado (não podem deixar de existir). */
export const ENGINE_OUTPUTS = [...new Set([...STATEMENT_CODES, 'fluxo_inicial', 'tma_mensal', 'inflacao_mensal', 'base_caixa', 'base_markup', 'preco_caixa', 'preco_tma', 'preco_minimo', 'preco_exato', 'preco_margem_minima', 'preco_recomendado', 'preco_margem_operacional_zero', 'preco_minimo_sugerido', 'vpl', 'tir', 'payback_descontado', 'payback_simples', 'roi', 'atende_preco_minimo', 'atende_margem', 'atende_payback', 'tir_acima_tma', 'aprovacao_automatica', 'margem_contribuicao_pct', 'investimento', 'investimento_total'])];

export const isValidFormulaCode = (c: string) => /^[a-z][a-z0-9_]{1,47}$/.test(c);

// ------------------------------------------------------------------ modelo
export type FinFormula = FinFormulaDef & { ast: FNode; refs: string[]; version?: number | null; versionId?: string | null; custom?: boolean };
export type FinModel = { formulas: Map<string, FinFormula>; key: string };
/** Fórmula publicada (ou em simulação) que substitui a padrão ou cria uma personalizada. */
export type FinOverride = { code: string; expression: string; name?: string; category?: FinCategory; unit?: FinUnit; desc?: string; version?: number | null; versionId?: string | null };

const VAR_INDEX = new Map(FIN_VARIABLES.map((v) => [v.code, v]));
export const finVariable = (code: string) => VAR_INDEX.get(code);

/** Chave curta e estável do modelo (identifica a versão das fórmulas usada em cada cálculo). */
export function modelKey(formulas: Iterable<FinFormula>) {
  const s = [...formulas].sort((a, b) => a.code.localeCompare(b.code)).map((f) => `${f.code}=${printFinFormula(f.ast)}`).join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `FM-${h.toString(16).padStart(8, '0')}`;
}

/** Monta o modelo: padrão do sistema + fórmulas publicadas/simuladas. Erros de sintaxe viram exceção com o código da fórmula. */
export function buildModel(overrides: FinOverride[] = []): FinModel {
  const map = new Map<string, FinFormula>();
  const put = (d: FinFormulaDef & { version?: number | null; versionId?: string | null; custom?: boolean }) => {
    let ast: FNode;
    try { ast = parseFinFormula(d.expression); } catch (e) { throw new FormulaError(`${d.code}: ${(e as Error).message}`); }
    map.set(d.code, { ...d, ast, refs: finFormulaRefs(ast) });
  };
  for (const f of FIN_FORMULAS) put({ ...f, version: 0 });
  for (const o of overrides) {
    const base = map.get(o.code);
    put({ code: o.code, name: o.name ?? base?.name ?? o.code, category: o.category ?? base?.category ?? 'personalizadas', unit: o.unit ?? base?.unit ?? 'R$', desc: o.desc ?? base?.desc ?? '', expression: o.expression, version: o.version ?? null, versionId: o.versionId ?? null, custom: !base || base.custom });
  }
  return { formulas: map, key: modelKey(map.values()) };
}

/** Dependências diretas de um nó (fórmula, variável ou a série "fluxo", que depende de fluxo_inicial e fluxo_caixa). */
const depsOf = (model: FinModel, code: string): string[] => (code === 'fluxo' ? ['fluxo_inicial', 'fluxo_caixa'] : model.formulas.get(code)?.refs ?? []);

/** Todas as dependências (transitivas) de um código. */
export function dependenciesOf(model: FinModel, code: string): string[] {
  const seen = new Set<string>();
  const go = (c: string) => { for (const d of depsOf(model, c)) if (!seen.has(d)) { seen.add(d); go(d); } };
  go(code);
  return [...seen];
}
/** Quem depende (direta ou indiretamente) dos códigos: os indicadores impactados por uma alteração. */
export function dependentsOf(model: FinModel, codes: string[]): string[] {
  const out = new Set<string>();
  const nodes = [...model.formulas.keys(), 'fluxo'];
  let frontier = new Set(codes);
  while (frontier.size) {
    const next = new Set<string>();
    for (const n of nodes) if (!out.has(n) && !codes.includes(n) && depsOf(model, n).some((d) => frontier.has(d))) { out.add(n); next.add(n); }
    frontier = next;
  }
  out.delete('fluxo');
  return [...out];
}
/** Referência circular: devolve o ciclo encontrado (a → b → … → a) ou null. */
export function findCycle(model: FinModel): string[] | null {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (c: string): string[] | null => {
    if (state.get(c) === 2) return null;
    if (state.get(c) === 1) return [...stack.slice(stack.indexOf(c)), c];
    state.set(c, 1); stack.push(c);
    for (const d of depsOf(model, c)) if (model.formulas.has(d) || d === 'fluxo') { const cyc = visit(d); if (cyc) return cyc; }
    stack.pop(); state.set(c, 2);
    return null;
  };
  for (const c of model.formulas.keys()) { const cyc = visit(c); if (cyc) return cyc; }
  return null;
}

/** Tipo de um código no modelo (variável, fórmula ou série). */
function typeIn(model: FinModel, code: string, seen = new Set<string>()): FType | undefined {
  const v = VAR_INDEX.get(code);
  if (v) return v.type;
  const f = model.formulas.get(code);
  if (!f || seen.has(code)) return f ? 'any' : undefined;
  seen.add(code);
  return checkFinFormula(f.ast, (n) => typeIn(model, n, seen)).type;
}

export type ModelIssue = { code: string; message: string; level: 'erro' | 'aviso' };
/** Validação do modelo inteiro: sintaxe já conferida em buildModel; aqui tipos, variáveis, ciclos, unidades e saídas obrigatórias. */
export function validateModel(model: FinModel): ModelIssue[] {
  const issues: ModelIssue[] = [];
  for (const f of model.formulas.values()) {
    if (VAR_INDEX.has(f.code)) issues.push({ code: f.code, message: `"${f.code}" é uma variável de entrada; escolha outro código.`, level: 'erro' });
    const { type, errors } = checkFinFormula(f.ast, (n) => typeIn(model, n));
    for (const m of errors) issues.push({ code: f.code, message: m, level: 'erro' });
    if (type === 'serie') issues.push({ code: f.code, message: 'O resultado da fórmula não pode ser uma série.', level: 'erro' });
    const want: FType = f.unit === 'sim/não' ? 'bool' : 'num';
    if (type !== 'any' && type !== want && type !== 'serie') issues.push({ code: f.code, message: `A fórmula devolve ${type === 'bool' ? 'uma condição' : 'um número'}, mas a unidade é ${f.unit}.`, level: 'erro' });
    for (const w of unitWarnings(model, f)) issues.push({ code: f.code, message: w, level: 'aviso' });
  }
  for (const c of ENGINE_OUTPUTS) if (!model.formulas.has(c)) issues.push({ code: c, message: `O motor precisa da fórmula ${c}.`, level: 'erro' });
  const cyc = findCycle(model);
  if (cyc) issues.push({ code: cyc[0]!, message: `Referência circular: ${cyc.join(' → ')}.`, level: 'erro' });
  return issues;
}

/** Unidades: soma e subtração só entre R$ e R$ ou % e % (aviso, não erro: taxas podem ser somadas a fatores). */
function unitWarnings(model: FinModel, f: FinFormula): string[] {
  const unitOf = (c: string): FinUnit | null => VAR_INDEX.get(c)?.unit ?? model.formulas.get(c)?.unit ?? null;
  const out: string[] = [];
  const walk = (n: FNode): FinUnit | 'num' | null => {
    if (n.k === 'num') return 'num';
    if (n.k === 'var') return unitOf(n.name);
    if (n.k === 'neg') return walk(n.a);
    if (n.k === 'call') { n.args.forEach(walk); return null; }
    if (n.k === 'bin') {
      const a = walk(n.a), b = walk(n.b);
      if ((n.op === '+' || n.op === '-') && a && b && a !== 'num' && b !== 'num' && a !== b && !(a === 'R$' && b === 'R$')) {
        const pair = [a, b].sort().join(' e ');
        if (pair === '% e R$') out.push(`Soma/subtração de R$ com % (${printFinFormula(n)}): confira se não falta multiplicar por um valor.`);
      }
      if (n.op === '*' || n.op === '/') return a === 'R$' || b === 'R$' ? (n.op === '/' && a === 'R$' && b === 'R$' ? '%' : 'R$') : a === 'num' ? b : a;
      return a === 'num' ? b : a;
    }
    return null;
  };
  walk(f.ast);
  return [...new Set(out)];
}

// ------------------------------------------------------------------ execução
export type FinBase = Record<string, FValue>;
export type FinTraceNode = { code: string; name: string; kind: 'variavel' | 'formula'; expression?: string; memory?: string; value: FValue; unit: FinUnit; children?: FinTraceNode[] };
export type ModelRun = {
  /** valores no mês 1 (colunas "por mês") e dos indicadores globais */
  values: Record<string, FValue>;
  /** valores de cada fórmula do desdobramento em cada mês (1..prazo; pontual = só o mês 1) */
  periods: Record<string, FValue[]>;
  fluxo: number[];
  warnings: string[];
};

/**
 * Executa o modelo: memoriza cada fórmula por mês só quando ela depende do mês (recálculo incremental) e monta a série
 * do fluxo de caixa a partir de fluxo_inicial e fluxo_caixa. Divisão por zero e valores ausentes viram NULO com aviso.
 */
export function runModel(model: FinModel, base: FinBase, codes: readonly string[] = [...model.formulas.keys()]): ModelRun {
  const warnings = new Set<string>();
  const monthDep = new Map<string, boolean>();
  const dependsOnMonth = (c: string): boolean => {
    if (c === 'mes') return true;
    if (monthDep.has(c)) return monthDep.get(c)!;
    monthDep.set(c, false);
    const r = c !== 'fluxo' && depsOf(model, c).some(dependsOnMonth);
    monthDep.set(c, r);
    return r;
  };
  const cache = new Map<string, FValue>();
  let fluxo: number[] | null = null;
  const value = (code: string, mes: number, path: string[] = []): FValue => {
    if (code === 'mes') return mes;
    if (code === 'fluxo') return buildFluxo();
    if (!model.formulas.has(code)) { const v = base[code]; return v === undefined ? null : v; }
    const key = dependsOnMonth(code) ? `${code}@${mes}` : code;
    if (cache.has(key)) return cache.get(key)!;
    if (path.includes(code)) throw new FormulaError(`Referência circular: ${[...path, code].join(' → ')}.`);
    const f = model.formulas.get(code)!;
    const v = evalFinFormula(f.ast, { get: (n) => value(n, mes, [...path, code]), warn: (m) => warnings.add(`${code}: ${m}`) });
    const out = typeof v === 'number' && !Number.isFinite(v) ? null : v;
    cache.set(key, out);
    return out;
  };
  const num = (code: string, mes: number) => { const v = value(code, mes); return typeof v === 'number' ? v : null; };
  function buildFluxo(): number[] {
    if (fluxo) return fluxo;
    fluxo = [];
    const rec = base.recorrente === true;
    const fc0 = num('fluxo_inicial', 0);
    if (rec) {
      const N = Math.max(0, Math.round(Number(base.prazo ?? 0)));
      const ms: (number | null)[] = Array.from({ length: N }, (_, k) => num('fluxo_caixa', k + 1));
      if (fc0 === null || ms.some((x) => x === null)) { fluxo = []; return fluxo; }
      fluxo = [fc0, ...(ms as number[])];
    } else {
      const d = Math.max(0, Math.round(Number(base.mes_recebimento ?? 0)));
      const fc = num('fluxo_caixa', 1);
      if (fc0 === null || fc === null) { fluxo = []; return fluxo; }
      fluxo = Array.from({ length: d + 1 }, () => 0);
      fluxo[0] = fc0; fluxo[d] = fluxo[d]! + fc;
    }
    return fluxo;
  }
  const values: Record<string, FValue> = {};
  // todas as fórmulas (as pedidas primeiro): a memória de cálculo lê qualquer parcela
  for (const c of [...codes, ...model.formulas.keys()]) if (!(c in values)) values[c] = value(c, 1);
  const periods: Record<string, FValue[]> = {};
  const N = base.recorrente === true ? Math.max(0, Math.round(Number(base.prazo ?? 0))) : 1;
  for (const c of STATEMENT_CODES) if (model.formulas.has(c)) periods[c] = Array.from({ length: N }, (_, k) => value(c, k + 1));
  return { values, periods, fluxo: buildFluxo(), warnings: [...warnings] };
}

/** Árvore de cálculo de um código: a fórmula, a memória com os números e cada parcela (para expandir na tela). */
export function traceOf(model: FinModel, base: FinBase, run: ModelRun, code: string, depth = 4, seen = new Set<string>()): FinTraceNode {
  const v = finVariable(code);
  if (v || !model.formulas.has(code)) {
    const val = code === 'fluxo' ? run.fluxo : code === 'mes' ? 1 : (base[code] ?? null);
    return { code, name: v?.name ?? code, kind: 'variavel', value: val, unit: v?.unit ?? 'R$' };
  }
  const f = model.formulas.get(code)!;
  const val = run.values[code] ?? null;
  const memory = substitute(f.ast, (n) => (finVariable(n) ? (n === 'fluxo' ? null : n === 'mes' ? 1 : base[n] ?? null) : run.values[n] ?? null), (n) => finVariable(n)?.unit ?? model.formulas.get(n)?.unit ?? 'R$');
  const node: FinTraceNode = { code, name: f.name, kind: 'formula', expression: printFinFormula(f.ast), memory, value: val, unit: f.unit };
  if (depth > 0 && !seen.has(code)) {
    seen.add(code);
    node.children = f.refs.filter((r) => r !== 'mes').map((r) => traceOf(model, base, run, r, depth - 1, seen));
  }
  return node;
}

/** Valor formatado conforme a unidade (centavos → R$; fração → %). */
export function fmtFin(v: FValue, unit: FinUnit): string {
  if (v === null) return 'NULO';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (Array.isArray(v)) return `série de ${v.length} meses`;
  const n = (x: number, d = 2) => x.toLocaleString('pt-BR', { minimumFractionDigits: d === 2 ? 2 : 0, maximumFractionDigits: d });
  if (unit === 'R$') return `R$ ${n(v / 100)}`;
  if (unit === '%') return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  if (unit === 'meses' || unit === 'mês' || unit === 'fator') return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return String(v);
}

/** Expressão com os valores no lugar das variáveis (a memória de cálculo da fórmula). */
export function substitute(n: FNode, valueOf: (name: string) => FValue, unitOf: (name: string) => FinUnit): string {
  const lit = (x: FNode): FNode => {
    if (x.k === 'var') {
      if (x.name === 'fluxo') return x;
      const v = valueOf(x.name), u = unitOf(x.name);
      return { k: 'var', name: v === null ? 'NULO' : typeof v === 'boolean' ? (v ? 'VERDADEIRO' : 'FALSO') : Array.isArray(v) ? x.name : u === 'R$' ? (v / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : u === '%' ? `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%` : v.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) };
    }
    if (x.k === 'neg') return { ...x, a: lit(x.a) };
    if (x.k === 'bin') return { ...x, a: lit(x.a), b: lit(x.b) };
    if (x.k === 'call') return { ...x, args: x.args.map(lit) };
    return x;
  };
  return printFinFormula(lit(n));
}
