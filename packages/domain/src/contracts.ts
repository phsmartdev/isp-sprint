/**
 * Gestão de Contratos: regras puras (sem banco).
 * - Etapas do funil, setores, regimes jurídicos, tipos de documento e roteiros de cada processo.
 * - Datas de alerta (renovação, encerramento, garantia, reajuste) e cálculo de reajuste.
 * O sistema sugere datas e prazos; a decisão jurídica (prorrogar ou não) é sempre de uma pessoa responsável.
 */

export const CONTRACT_STAGES = ['cadastro_validacao', 'implantacao', 'vigente', 'renovacao', 'reajuste', 'encerramento', 'arquivado'] as const;
export type ContractStage = (typeof CONTRACT_STAGES)[number];
export const CONTRACT_STAGE_LABELS: Record<ContractStage, string> = {
  cadastro_validacao: 'Cadastro e validação',
  implantacao: 'Implantação',
  vigente: 'Contrato vigente',
  renovacao: 'Renovação',
  reajuste: 'Reajuste',
  encerramento: 'Encerramento',
  arquivado: 'Arquivado',
};

export const SECTORS = ['comercial', 'inteligencia_comercial', 'financeiro', 'juridico', 'sucesso_cliente', 'diretoria', 'administracao', 'implantacao'] as const;
export type Sector = (typeof SECTORS)[number];
export const SECTOR_LABELS: Record<Sector, string> = {
  comercial: 'Comercial',
  inteligencia_comercial: 'Inteligência Comercial',
  financeiro: 'Financeiro',
  juridico: 'Jurídico',
  sucesso_cliente: 'Sucesso do Cliente',
  diretoria: 'Diretoria',
  administracao: 'Administração',
  implantacao: 'Implantação e entrega',
};

export const CONTRACT_KINDS = ['privado', 'publico'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];
export const LEGAL_REGIMES = ['privado', 'lei_8666', 'lei_14133', 'outro'] as const;
export type LegalRegime = (typeof LEGAL_REGIMES)[number];
export const LEGAL_REGIME_LABELS: Record<LegalRegime, string> = {
  privado: 'Direito privado (Código Civil)',
  lei_8666: 'Lei 8.666/1993',
  lei_14133: 'Lei 14.133/2021',
  outro: 'Outro regime',
};
/**
 * Prazo total de referência para serviços contínuos, só como SUGESTÃO para o campo "limite legal":
 * Lei 8.666 art. 57, II (até 60 meses) e Lei 14.133 art. 107 (até 10 anos). Quem valida é o responsável.
 */
export const LEGAL_REFERENCE_MONTHS: Partial<Record<LegalRegime, number>> = { lei_8666: 60, lei_14133: 120 };

export const DOC_TYPES = ['CONTRATO', 'ADITIVO', 'OFICIO', 'PROPOSTA', 'GARANTIA', 'APOSTILAMENTO', 'NOTA DE EMPENHO', 'TERMO DE ENCERRAMENTO', 'PARECER JURIDICO', 'COMUNICADO', 'OUTRO'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_FOLDERS = ['Ativos', 'Encerrados'] as const;

const clean = (v: string) => v.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Nome padrão: AAMMDD - TIPO DO DOCUMENTO - CLIENTE - RESUMO DO OBJETO */
export function documentName(dateIso: string, type: string, client: string, summary: string) {
  const [y, m, d] = dateIso.slice(0, 10).split('-');
  return `${y!.slice(2)}${m}${d} - ${clean(type).toUpperCase()} - ${clean(client).toUpperCase()} - ${clean(summary).toUpperCase()}`.slice(0, 200);
}

// ------------------------------------------------------------------ datas
const DAY = 86_400_000;
const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);
export function addDays(iso: string, days: number) { return isoDate(toUtc(iso) + days * DAY); }
export function daysBetween(from: string, to: string) { return Math.round((toUtc(to) - toUtc(from)) / DAY); }
export function addMonths(iso: string, months: number) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + months, d = +iso.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return isoDate(Date.UTC(y, m, Math.min(d, last)));
}
/** Término a partir do início e do prazo em meses (último dia de vigência). */
export function endFromTerm(start: string, months: number) { return addDays(addMonths(start, months), -1); }
/** Próximo aniversário da data-base a partir de hoje (inclusive). */
export function nextAnniversary(baseDate: string, today: string) {
  let y = +today.slice(0, 4);
  let cand = `${y}-${baseDate.slice(5)}`;
  if (cand.slice(5) === '02-29') cand = addDays(`${y}-03-01`, -1);
  if (cand < today) { y++; cand = `${y}-${baseDate.slice(5)}`; if (cand.slice(5) === '02-29') cand = addDays(`${y}-03-01`, -1); }
  return cand < baseDate ? baseDate : cand;
}

/** Valor reajustado em centavos (arredondado). */
export function adjustedCents(currentCents: number, pct: number) { return Math.round(currentCents * (1 + pct / 100)); }

export const DEFAULT_CONTRACT_SETTINGS = {
  renewalAlertDays: 60,
  closureNoticeDays: 90,
  closureFinalDays: 30,
  guaranteeAlertDays: 30,
  adjustmentAlertDays: 30,
  provisioningSlaDays: 5,
  implantationSlaDays: 30,
  signatureSlaDays: 10,
  ccEmail: 'contratos@bktele.com.br',
  renewalSubject: 'Ofício de Renovação Contratual – Contrato [Nº] – Cliente [Nome]',
  closureSubject: 'Encerramento Contratual Imediato – Contrato [Nº]',
};
export type ContractSettings = typeof DEFAULT_CONTRACT_SETTINGS & { financeEmail: string | null; deliveryEmail: string | null; oficioTemplate: string };

export const ALERT_KINDS = ['renovacao', 'reajuste', 'garantia', 'documento_pendente', 'assinatura', 'provisionamento', 'implantacao', 'encerramento_90', 'encerramento_30'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_LABELS: Record<AlertKind, string> = {
  renovacao: 'Renovação',
  reajuste: 'Reajuste',
  garantia: 'Garantia/seguro vencendo',
  documento_pendente: 'Documento pendente',
  assinatura: 'Assinatura pendente',
  provisionamento: 'Provisionamento de faturamento',
  implantacao: 'Implantação atrasada',
  encerramento_90: 'Encerramento em 90 dias',
  encerramento_30: 'Encerramento em 30 dias',
};

export type AlertInput = {
  today: string;
  stage: ContractStage;
  endAt: string | null;
  /** Encerramento previsto: sem renovação, limite legal atingido ou decisão registrada. */
  closureExpected: boolean;
  closureAt: string | null;
  guaranteeExpiresAt: string | null;
  adjustmentBaseDate: string | null;
  signedAt: string | null;
  activationAt: string | null;
  validatedAt: string | null;
  hasSignedContractDoc: boolean;
  provisioningDone: boolean;
  openSignatureSince: string | null;
};
export type DueAlert = { kind: AlertKind; cycleKey: string; dueAt: string };

/**
 * Alertas que já deveriam existir hoje. O ciclo (cycleKey) garante um alerta por evento:
 * a mesma renovação não gera dois alertas, mas a próxima vigência gera um novo.
 */
export function dueAlerts(i: AlertInput, cfg: Pick<typeof DEFAULT_CONTRACT_SETTINGS, 'renewalAlertDays' | 'closureNoticeDays' | 'closureFinalDays' | 'guaranteeAlertDays' | 'adjustmentAlertDays' | 'provisioningSlaDays' | 'implantationSlaDays' | 'signatureSlaDays'>): DueAlert[] {
  const out: DueAlert[] = [];
  if (i.stage === 'arquivado') return out;
  const at = (date: string, days: number) => addDays(date, -days);
  const closingDate = i.closureExpected ? i.closureAt ?? i.endAt : null;
  if (i.endAt && !i.closureExpected && i.stage !== 'encerramento' && i.stage !== 'cadastro_validacao') {
    const d = at(i.endAt, cfg.renewalAlertDays);
    if (i.today >= d) out.push({ kind: 'renovacao', cycleKey: i.endAt, dueAt: i.endAt });
  }
  if (closingDate) {
    if (i.today >= at(closingDate, cfg.closureNoticeDays)) out.push({ kind: 'encerramento_90', cycleKey: closingDate, dueAt: closingDate });
    if (i.today >= at(closingDate, cfg.closureFinalDays)) out.push({ kind: 'encerramento_30', cycleKey: closingDate, dueAt: closingDate });
  }
  if (i.guaranteeExpiresAt && i.today >= at(i.guaranteeExpiresAt, cfg.guaranteeAlertDays)) out.push({ kind: 'garantia', cycleKey: i.guaranteeExpiresAt, dueAt: i.guaranteeExpiresAt });
  if (i.adjustmentBaseDate && i.stage !== 'cadastro_validacao' && i.stage !== 'encerramento') {
    const next = nextAnniversary(i.adjustmentBaseDate, addDays(i.today, -cfg.adjustmentAlertDays));
    // o aniversário da própria data-base (ano da assinatura) não gera reajuste
    if (next > i.adjustmentBaseDate && i.today >= at(next, cfg.adjustmentAlertDays)) out.push({ kind: 'reajuste', cycleKey: next, dueAt: next });
  }
  if (i.validatedAt) {
    const v = i.validatedAt.slice(0, 10);
    if (!i.provisioningDone && i.today >= addDays(v, cfg.provisioningSlaDays)) out.push({ kind: 'provisionamento', cycleKey: v, dueAt: addDays(v, cfg.provisioningSlaDays) });
    if (!i.activationAt && i.today >= addDays(v, cfg.implantationSlaDays)) out.push({ kind: 'implantacao', cycleKey: v, dueAt: addDays(v, cfg.implantationSlaDays) });
    if (!i.hasSignedContractDoc) out.push({ kind: 'documento_pendente', cycleKey: `contrato:${v}`, dueAt: addDays(v, 7) });
  }
  if (i.openSignatureSince && i.today >= addDays(i.openSignatureSince.slice(0, 10), cfg.signatureSlaDays)) out.push({ kind: 'assinatura', cycleKey: i.openSignatureSince.slice(0, 10), dueAt: addDays(i.openSignatureSince.slice(0, 10), cfg.signatureSlaDays) });
  return out;
}

// ------------------------------------------------------------------ roteiros dos processos
export type StepRequirement = 'nota' | 'erp' | 'documento' | 'data' | 'decisao' | 'valores';
export type StepDef = { key: string; label: string; sectors: Sector[]; requires?: StepRequirement; docType?: DocType; optional?: boolean; hint?: string };
export const PROCESS_KINDS = ['implantacao', 'renovacao', 'reajuste', 'encerramento'] as const;
export type ProcessKind = (typeof PROCESS_KINDS)[number];
export const PROCESS_LABELS: Record<ProcessKind, string> = { implantacao: 'Implantação', renovacao: 'Renovação', reajuste: 'Reajuste', encerramento: 'Encerramento' };

const IMPLANTACAO: StepDef[] = [
  { key: 'erp_cadastro', label: 'Cadastrar/atualizar no ERP', sectors: ['administracao', 'financeiro'], requires: 'erp', hint: 'Informe o código do cliente/contrato no ERP. A integração automática depende do ERP configurado.' },
  { key: 'provisionamento', label: 'Provisionamento do faturamento (Financeiro)', sectors: ['financeiro'], requires: 'nota' },
  { key: 'documento_assinado', label: 'Anexar contrato assinado', sectors: ['comercial', 'administracao'], requires: 'documento', docType: 'CONTRATO' },
  { key: 'implantacao_entrega', label: 'Implantação e entrega', sectors: ['implantacao', 'sucesso_cliente'], requires: 'nota' },
  { key: 'ativacao_tecnica', label: 'Ativação técnica', sectors: ['implantacao'], requires: 'data' },
  { key: 'inicio_faturamento', label: 'Início do faturamento', sectors: ['financeiro'], requires: 'data' },
];
const RENOVACAO_PUBLICA: StepDef[] = [
  { key: 'verificar_prorrogacao', label: 'Verificar possibilidade de prorrogação e regime jurídico', sectors: ['inteligencia_comercial', 'juridico'], requires: 'decisao', hint: 'Validação de uma pessoa responsável. O sistema não decide a elegibilidade.' },
  { key: 'gerar_oficio', label: 'Gerar ofício de renovação (modelo institucional)', sectors: ['inteligencia_comercial'], requires: 'documento', docType: 'OFICIO' },
  { key: 'enviar_oficio', label: 'Enviar ofício por e-mail ao cliente', sectors: ['inteligencia_comercial'], requires: 'nota' },
  { key: 'manifestacao_cliente', label: 'Registrar manifestação do cliente', sectors: ['inteligencia_comercial', 'comercial'], requires: 'decisao' },
  { key: 'solicitar_aditivo', label: 'Solicitar termo aditivo', sectors: ['inteligencia_comercial'], requires: 'nota' },
  { key: 'analisar_aditivo', label: 'Analisar vigência, partes, valores e objeto do aditivo', sectors: ['inteligencia_comercial', 'juridico'], requires: 'nota' },
  { key: 'juridico', label: 'Encaminhar inconsistências ao Jurídico', sectors: ['juridico'], requires: 'nota', optional: true, hint: 'Pule se não houver inconsistências.' },
  { key: 'assinatura_diretoria', label: 'Assinatura da Diretoria', sectors: ['diretoria'], requires: 'data' },
  { key: 'assinatura_cliente', label: 'Assinatura do cliente', sectors: ['inteligencia_comercial', 'comercial'], requires: 'data' },
  { key: 'pdf_assinado', label: 'Anexar PDF final assinado', sectors: ['inteligencia_comercial', 'administracao'], requires: 'documento', docType: 'ADITIVO' },
  { key: 'erp', label: 'Atualizar dados no ERP', sectors: ['administracao', 'financeiro'], requires: 'erp' },
  { key: 'nova_vigencia', label: 'Registrar nova vigência (Contrato Renovado)', sectors: ['inteligencia_comercial'], requires: 'valores' },
];
const RENOVACAO_PRIVADA: StepDef[] = [
  { key: 'revisao_condicoes', label: 'Revisar condições atuais (Comercial e CSM)', sectors: ['comercial', 'sucesso_cliente'], requires: 'nota' },
  { key: 'proposta_continuidade', label: 'Registrar proposta de continuidade', sectors: ['comercial'], requires: 'nota' },
  { key: 'renegociacao', label: 'Renegociar valores, escopo e condições', sectors: ['comercial'], requires: 'nota', optional: true },
  { key: 'formalizacao', label: 'Formalizar aditivo ou novo contrato', sectors: ['comercial', 'juridico'], requires: 'documento', docType: 'ADITIVO' },
  { key: 'assinatura_diretoria', label: 'Assinatura da Diretoria', sectors: ['diretoria'], requires: 'data' },
  { key: 'assinatura_cliente', label: 'Assinatura do cliente', sectors: ['comercial'], requires: 'data' },
  { key: 'erp', label: 'Atualizar dados no ERP', sectors: ['administracao', 'financeiro'], requires: 'erp' },
  { key: 'nova_vigencia', label: 'Registrar nova vigência e agendar próxima renovação', sectors: ['comercial', 'inteligencia_comercial'], requires: 'valores' },
];
const REAJUSTE: StepDef[] = [
  { key: 'calculo', label: 'Calcular reajuste (índice e percentual)', sectors: ['financeiro', 'inteligencia_comercial'], requires: 'valores' },
  { key: 'aprovacao', label: 'Aprovação', sectors: ['diretoria', 'financeiro'], requires: 'decisao' },
  { key: 'comunicacao', label: 'Comunicar o cliente', sectors: ['comercial', 'inteligencia_comercial'], requires: 'nota' },
  { key: 'documentacao', label: 'Documentação (apostilamento/comunicado)', sectors: ['inteligencia_comercial', 'administracao'], requires: 'documento', docType: 'APOSTILAMENTO', optional: true },
  { key: 'aplicacao', label: 'Aplicar novo valor (data de aplicação)', sectors: ['financeiro'], requires: 'data' },
  { key: 'erp', label: 'Atualizar no ERP', sectors: ['financeiro', 'administracao'], requires: 'erp' },
];
const ENCERRAMENTO: StepDef[] = [
  { key: 'aviso_90', label: 'Aviso de 90 dias a Comercial e Financeiro', sectors: ['comercial', 'financeiro'], requires: 'nota', hint: 'Enviado automaticamente; registre as providências.' },
  { key: 'validacao_cs', label: 'Validação com Sucesso do Cliente', sectors: ['sucesso_cliente'], requires: 'decisao' },
  { key: 'desmobilizacao', label: 'Cancelamento/desmobilização', sectors: ['implantacao', 'sucesso_cliente'], requires: 'nota' },
  { key: 'faturamento_final', label: 'Faturamento final', sectors: ['financeiro'], requires: 'nota' },
  { key: 'baixa_operacional', label: 'Confirmar baixa operacional', sectors: ['implantacao', 'sucesso_cliente'], requires: 'nota' },
  { key: 'baixa_financeira', label: 'Confirmar baixa financeira', sectors: ['financeiro'], requires: 'nota' },
  { key: 'erp', label: 'Atualizar ERP', sectors: ['financeiro', 'administracao'], requires: 'erp' },
  { key: 'arquivamento', label: 'Arquivar documentos (nota final, responsável e local)', sectors: ['administracao', 'inteligencia_comercial'], requires: 'nota' },
];

export function processSteps(kind: ProcessKind, contractKind: ContractKind): StepDef[] {
  if (kind === 'implantacao') return IMPLANTACAO;
  if (kind === 'renovacao') return contractKind === 'publico' ? RENOVACAO_PUBLICA : RENOVACAO_PRIVADA;
  if (kind === 'reajuste') return REAJUSTE;
  return ENCERRAMENTO;
}

/** Texto com variáveis {{chave}} (ofício, e-mails). Variável sem valor fica em branco. */
export function fillTemplate(t: string, vars: Record<string, string | number | null | undefined>) {
  return t.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_m, k: string) => String(vars[k] ?? ''));
}
/** Assunto com [Nº] e [Nome]. */
export function fillSubject(t: string, number: string, client: string) {
  return t.replace(/\[N[ºo°]\]/gi, number).replace(/\[Nome\]/gi, client);
}

export const DEFAULT_OFICIO = `{{cidade}}, {{data_extenso}}

Ofício nº {{oficio_numero}}

Ao(À) {{cliente.nome}}
{{cliente.endereco}}

Assunto: Renovação do Contrato nº {{contrato.numero}}

Prezados(as),

Cumprimentando-os, a {{empresa.nome}} vem manifestar interesse na prorrogação do Contrato nº {{contrato.numero}}, cujo objeto é {{contrato.objeto}}, com vigência atual de {{contrato.inicio}} a {{contrato.termino}}.

Solicitamos a manifestação dessa instituição quanto à renovação por mais {{renovacao.meses}} meses, mantidas as condições contratuais vigentes, no valor mensal de {{contrato.valor_mensal}}.

Permanecemos à disposição para os esclarecimentos necessários.

Atenciosamente,

{{responsavel.nome}}
{{empresa.nome}}`;

// ------------------------------------------------------------------ tipos de contrato e extrato
export const BILLING_TYPES = ['recorrente', 'frequente', 'medicao'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];
export const BILLING_TYPE_LABELS: Record<BillingType, string> = { recorrente: 'Recorrente', frequente: 'Frequente', medicao: 'Medição' };
export const BILLING_TYPE_HINTS: Record<BillingType, string> = {
  recorrente: 'Mensalidade fixa durante a vigência.',
  frequente: 'Cobranças lançadas a cada ocorrência, com valor variável.',
  medicao: 'Saldo contratado consumido pelas negociações (oportunidades).',
};
export const LEDGER_KINDS = ['credito', 'consumo', 'estorno', 'faturamento'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_LABELS: Record<LedgerKind, string> = { credito: 'Crédito de saldo', consumo: 'Consumo', estorno: 'Estorno', faturamento: 'Lançamento de faturamento' };

/** Saldo do contrato por medição: créditos − consumos + estornos. */
export function ledgerTotals(entries: { kind: string; amountCents: number }[]) {
  const sum = (k: string) => entries.filter((e) => e.kind === k).reduce((a, e) => a + e.amountCents, 0);
  const credited = sum('credito'), consumed = sum('consumo') - sum('estorno'), billed = sum('faturamento');
  return { credited, consumed, billed, available: credited - consumed, usedShare: credited ? consumed / credited : null };
}

/**
 * Faturamento do período por tipo (registrado no CRM até o ERP ser integrado):
 * recorrente = mensalidade × meses de vigência ativos no período (previsto);
 * frequente = lançamentos de faturamento; medição = consumos líquidos.
 */
export function recurringBilledInPeriod(monthlyCents: number, billingStart: string | null, endAt: string | null, from: string, to: string) {
  if (!billingStart || monthlyCents <= 0) return 0;
  let months = 0;
  let cur = `${from.slice(0, 7)}-01`;
  while (cur <= to) {
    const monthEnd = addDays(addMonths(cur, 1), -1);
    if (billingStart <= monthEnd && (!endAt || endAt >= cur)) months++;
    cur = addMonths(cur, 1);
  }
  return months * monthlyCents;
}

/** Variáveis do sistema disponíveis nos modelos de contrato. */
export const CONTRACT_TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: 'cliente.nome', label: 'Nome/razão social do cliente' }, { key: 'cliente.documento', label: 'CPF/CNPJ' }, { key: 'cliente.email', label: 'E-mail do cliente' },
  { key: 'cliente.telefone', label: 'Telefone do cliente' }, { key: 'cliente.endereco', label: 'Endereço do cliente' },
  { key: 'contrato.numero', label: 'Número do contrato' }, { key: 'contrato.codigo', label: 'Código interno (CT-…)' }, { key: 'contrato.objeto', label: 'Objeto' },
  { key: 'contrato.tipo', label: 'Tipo (Recorrente, Frequente, Medição)' }, { key: 'contrato.assinatura', label: 'Data de assinatura' },
  { key: 'contrato.inicio', label: 'Início da vigência' }, { key: 'contrato.termino', label: 'Término da vigência' }, { key: 'contrato.prazo_meses', label: 'Prazo em meses' },
  { key: 'contrato.valor_mensal', label: 'Valor mensal (R$)' }, { key: 'contrato.valor_global', label: 'Valor global (R$)' }, { key: 'contrato.saldo', label: 'Saldo contratado (medição)' },
  { key: 'contrato.dia_faturamento', label: 'Dia de faturamento' }, { key: 'contrato.condicoes_faturamento', label: 'Condições de faturamento' },
  { key: 'contrato.indice_reajuste', label: 'Índice de reajuste' }, { key: 'contrato.data_base', label: 'Data-base do reajuste' }, { key: 'contrato.condicoes_especificas', label: 'Condições específicas' },
  { key: 'contrato.orgao', label: 'Órgão contratante (público)' }, { key: 'contrato.processo', label: 'Processo administrativo' },
  { key: 'contrato.itens_texto', label: 'Itens em texto (uma linha por item)' },
  { key: 'responsavel.nome', label: 'Responsável comercial' }, { key: 'empresa.nome', label: 'Nome da empresa' },
  { key: 'data_hoje', label: 'Data de hoje' }, { key: 'data_extenso', label: 'Data de hoje por extenso' },
];
/** Bloco de repetição para a tabela de itens: {{#itens}} {{descricao}} {{quantidade}} {{valor_unitario}} {{valor_total}} {{/itens}} */
export const CONTRACT_ITEM_LOOP = ['descricao', 'quantidade', 'valor_unitario', 'valor_total'];
