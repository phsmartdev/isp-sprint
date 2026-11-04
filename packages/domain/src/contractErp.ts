/**
 * Cadastro ERP do contrato: preparação, conferência independente e acompanhamento do lançamento no IXC.
 *
 * - O grupo A (cliente) segue as telas de cadastro do IXC usadas pela BKT (Cadastro, Outras informações,
 *   Endereço, Endereço de cobrança, Contato e Central do assinante), enviadas em 04/11/2026.
 * - Os nomes de campo do IXC (`ixc`) vêm da documentação da API e não foram conferidos num registro real;
 *   a conferência automática só compara o que a leitura do IXC devolver e marca o resto para conferência manual.
 * - Campo herdado não é copiado: o valor é lido do contrato/conta/oportunidade na hora. Só a aprovação
 *   congela uma fotografia (com hash) de todos os valores.
 * - O token do IXC é só leitura: o lançamento é manual, com registro do código.
 */

export const ERP_STATUSES = ['nao_iniciado', 'em_preenchimento', 'aguardando_conferencia', 'devolvido', 'aprovado', 'aguardando_lancamento', 'lancado', 'conferido_ixc', 'divergente'] as const;
export type ErpStatus = (typeof ERP_STATUSES)[number];
export const ERP_STATUS_LABELS: Record<ErpStatus, string> = {
  nao_iniciado: 'Não iniciado',
  em_preenchimento: 'Em preenchimento',
  aguardando_conferencia: 'Aguardando conferência',
  devolvido: 'Devolvido para correção',
  aprovado: 'Aprovado',
  aguardando_lancamento: 'Aguardando lançamento no IXC',
  lancado: 'Lançado no IXC',
  conferido_ixc: 'Conferido no IXC',
  divergente: 'Divergente',
};

export const ERP_CYCLES = ['implantacao', 'aditivo', 'reajuste', 'renovacao'] as const;
export type ErpCycle = (typeof ERP_CYCLES)[number];
export const ERP_CYCLE_LABELS: Record<ErpCycle, string> = { implantacao: 'Implantação', aditivo: 'Aditivo', reajuste: 'Reajuste', renovacao: 'Renovação' };

export const ERP_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export type ErpGroup = (typeof ERP_GROUPS)[number];
export const ERP_GROUP_LABELS: Record<ErpGroup, string> = {
  A: 'Identificação do cliente',
  B: 'Identificação contratual',
  C: 'Produtos e serviços',
  D: 'Condições financeiras',
  E: 'Reajustes',
  F: 'Informações operacionais',
  G: 'Informações complementares',
};

export type ErpFieldType = 'text' | 'textarea' | 'int' | 'money' | 'date' | 'month' | 'email' | 'phone' | 'cep' | 'doc' | 'uf' | 'choice' | 'secret';
export type ErpOption = { value: string; label: string };

/** Fonte de um valor herdado (resolvida pela API a partir do contrato, conta, endereço e oportunidade). */
export const ERP_INHERIT_SOURCES = [
  'contact.name', 'contact.document', 'contact.email', 'contact.phone', 'contact.personType',
  'address.postalCode', 'address.street', 'address.number', 'address.complement', 'address.district', 'address.city', 'address.state',
  'version.number', 'version.signedAt', 'version.startAt', 'version.endAt', 'version.monthlyCents', 'version.totalCents', 'version.billingDay',
  'version.billingStartAt', 'version.adjustmentIndex', 'version.adjustmentBaseDate', 'version.specialConditions',
  'contract.kind', 'contract.billingType', 'contract.commercialOwner', 'contract.operationalOwner', 'branch.name',
] as const;
export type ErpInheritSource = (typeof ERP_INHERIT_SOURCES)[number];
export type InheritedValues = Partial<Record<ErpInheritSource, string | number | null>>;

export type ErpFieldDef = {
  key: string;
  group: ErpGroup;
  /** subtítulo dentro do grupo (ex.: Endereço de cobrança) */
  section?: string;
  label: string;
  type: ErpFieldType;
  /** obrigatório para enviar à conferência */
  required: boolean;
  /** alteração depois da aprovação exige nova conferência */
  critical: boolean;
  /** campo correspondente no IXC (tabela.campo), conforme a documentação da API */
  ixc?: string;
  inherit?: ErpInheritSource;
  options?: readonly ErpOption[];
  hint?: string;
  /** nunca vai ao IXC nem à ficha de lançamento */
  internal?: boolean;
};

const SIM_NAO: ErpOption[] = [{ value: 'S', label: 'Sim' }, { value: 'N', label: 'Não' }];

/** Convênio ICMS 115/03 — classe de consumo ("Tipo de cliente - fiscal" no IXC). */
export const IXC_TIPO_CLIENTE_FISCAL: ErpOption[] = [
  { value: '01', label: '01 - Comercial' }, { value: '02', label: '02 - Industrial' }, { value: '03', label: '03 - Residencial/Pessoa física' },
  { value: '04', label: '04 - Produtor rural' }, { value: '05', label: '05 - Órgão da administração pública estadual' },
  { value: '06', label: '06 - Prestador de serviço de telecomunicação' }, { value: '07', label: '07 - Missões diplomáticas e organismos internacionais' },
  { value: '08', label: '08 - Igrejas e templos' }, { value: '99', label: '99 - Outros' },
];
/** Convênio ICMS 115/03 — tipo de assinante ("Tipo de assinante" no IXC). */
export const IXC_TIPO_ASSINANTE: ErpOption[] = [
  { value: '1', label: 'Comercial/Industrial' }, { value: '2', label: 'Poder público' }, { value: '3', label: 'Residencial/Pessoa física' },
  { value: '4', label: 'Público' }, { value: '5', label: 'Semi-público' }, { value: '6', label: 'Outros' },
];

const f = (group: ErpGroup, key: string, label: string, type: ErpFieldType, required: boolean, critical: boolean, extra: Partial<ErpFieldDef> = {}): ErpFieldDef => ({ key, group, label, type, required, critical, ...extra });

export const ERP_FIELDS: readonly ErpFieldDef[] = [
  // A. Cliente — telas do IXC (Cadastro)
  f('A', 'a_ativo', 'Ativo', 'choice', true, false, { section: 'Cadastro', options: SIM_NAO, ixc: 'cliente.ativo' }),
  f('A', 'a_tipo_cliente', 'Tipo cliente', 'text', false, false, { section: 'Cadastro', ixc: 'cliente.id_tipo_cliente', hint: 'Código do tipo de cliente no IXC.' }),
  f('A', 'a_tipo_cliente_fiscal', 'Tipo de cliente - fiscal', 'choice', false, false, { section: 'Cadastro', options: IXC_TIPO_CLIENTE_FISCAL, ixc: 'cliente.tipo_cliente_scm' }),
  f('A', 'a_tipo_pessoa', 'Tipo pessoa', 'choice', true, true, { section: 'Cadastro', options: [{ value: 'F', label: 'Física' }, { value: 'J', label: 'Jurídica' }, { value: 'E', label: 'Estrangeiro' }], ixc: 'cliente.tipo_pessoa', inherit: 'contact.personType' }),
  f('A', 'a_razao', 'Razão social/nome', 'text', true, true, { section: 'Cadastro', ixc: 'cliente.razao', inherit: 'contact.name' }),
  f('A', 'a_nome_social', 'Nome social', 'text', false, false, { section: 'Cadastro', ixc: 'cliente.nome_social' }),
  f('A', 'a_cnpj_cpf', 'CNPJ/CPF', 'doc', true, true, { section: 'Cadastro', ixc: 'cliente.cnpj_cpf', inherit: 'contact.document' }),
  f('A', 'a_cadunico', 'Cadastro no CadÚnico', 'choice', false, false, { section: 'Cadastro', options: SIM_NAO, ixc: 'cliente.cadastro_cadunico' }),
  f('A', 'a_ie_rg', 'IE/RG', 'text', false, false, { section: 'Cadastro', ixc: 'cliente.ie_identidade' }),
  f('A', 'a_contribuinte_icms', 'Contribuinte ICMS', 'choice', true, false, { section: 'Cadastro', options: [{ value: 'S', label: 'Sim' }, { value: 'N', label: 'Não' }, { value: 'I', label: 'Isento' }], ixc: 'cliente.contribuinte_icms', hint: 'Em operações interestaduais, várias UFs não aceitam "Isento" (Nota Técnica 2025.001).' }),
  // A. Outras informações
  f('A', 'a_tipo_assinante', 'Tipo de assinante', 'choice', true, false, { section: 'Outras informações', options: IXC_TIPO_ASSINANTE, ixc: 'cliente.tipo_assinante' }),
  f('A', 'a_filial', 'Filial (código no IXC)', 'int', true, true, { section: 'Outras informações', ixc: 'cliente.filial_id', inherit: 'branch.name', hint: 'Informe o código da filial no IXC; o nome ao lado vem da filial da venda.' }),
  // A. Endereço
  f('A', 'a_cep', 'CEP', 'cep', true, false, { section: 'Endereço', ixc: 'cliente.cep', inherit: 'address.postalCode' }),
  f('A', 'a_cif', 'CIF', 'text', false, false, { section: 'Endereço', ixc: 'cliente.cif' }),
  f('A', 'a_endereco', 'Endereço', 'text', true, false, { section: 'Endereço', ixc: 'cliente.endereco', inherit: 'address.street' }),
  f('A', 'a_numero', 'Número', 'text', true, false, { section: 'Endereço', ixc: 'cliente.numero', inherit: 'address.number' }),
  f('A', 'a_complemento', 'Complemento', 'text', false, false, { section: 'Endereço', ixc: 'cliente.complemento', inherit: 'address.complement' }),
  f('A', 'a_bairro', 'Bairro', 'text', true, false, { section: 'Endereço', ixc: 'cliente.bairro', inherit: 'address.district' }),
  f('A', 'a_cidade', 'Cidade', 'text', true, false, { section: 'Endereço', ixc: 'cliente.cidade', inherit: 'address.city', hint: 'No IXC a cidade é escolhida na lista; a UF vem dela.' }),
  f('A', 'a_uf', 'UF', 'uf', true, false, { section: 'Endereço', ixc: 'cliente.uf', inherit: 'address.state' }),
  f('A', 'a_referencia', 'Referência', 'text', false, false, { section: 'Endereço', ixc: 'cliente.referencia' }),
  // A. Endereço de cobrança (opcional no IXC)
  f('A', 'a_cob_cep', 'CEP cob.', 'cep', false, false, { section: 'Endereço de cobrança', ixc: 'cliente.cep_cob' }),
  f('A', 'a_cob_endereco', 'Endereço cob.', 'text', false, false, { section: 'Endereço de cobrança', ixc: 'cliente.endereco_cob' }),
  f('A', 'a_cob_numero', 'Número cob.', 'text', false, false, { section: 'Endereço de cobrança', ixc: 'cliente.numero_cob' }),
  f('A', 'a_cob_bairro', 'Bairro cob.', 'text', false, false, { section: 'Endereço de cobrança', ixc: 'cliente.bairro_cob' }),
  f('A', 'a_cob_cidade', 'Cidade cob.', 'text', false, false, { section: 'Endereço de cobrança', ixc: 'cliente.cidade_cob' }),
  f('A', 'a_cob_complemento', 'Complemento cob.', 'text', false, false, { section: 'Endereço de cobrança', ixc: 'cliente.complemento_cob' }),
  f('A', 'a_cob_referencia', 'Referência cob.', 'text', false, false, { section: 'Endereço de cobrança', ixc: 'cliente.referencia_cob' }),
  // A. Contato e Central do assinante
  f('A', 'a_celular', 'Telefone celular', 'phone', true, false, { section: 'Contato', ixc: 'cliente.telefone_celular', inherit: 'contact.phone' }),
  f('A', 'a_email', 'E-mail principal', 'email', true, false, { section: 'Contato', ixc: 'cliente.email', inherit: 'contact.email' }),
  f('A', 'a_login', 'Login da Central do assinante', 'text', true, false, { section: 'Central do assinante', ixc: 'cliente.hotsite_email' }),
  f('A', 'a_senha', 'Senha da Central do assinante', 'secret', true, false, { section: 'Central do assinante', ixc: 'cliente.senha', hint: 'Guardada criptografada; só aparece para quem lança, com registro no histórico.' }),

  // B. Contrato
  f('B', 'b_numero', 'Número do contrato', 'text', true, true, { inherit: 'version.number', ixc: 'cliente_contrato.contrato' }),
  f('B', 'b_unidade_negocio', 'Unidade de negócio', 'text', false, false),
  f('B', 'b_tipo', 'Tipo de contrato', 'text', true, false, { inherit: 'contract.billingType' }),
  f('B', 'b_modelo', 'Modelo contratual (código no IXC)', 'int', true, false, { ixc: 'cliente_contrato.id_modelo' }),
  f('B', 'b_assinatura', 'Data de assinatura', 'date', true, true, { inherit: 'version.signedAt', ixc: 'cliente_contrato.data_assinatura' }),
  f('B', 'b_inicio', 'Data de início', 'date', true, true, { inherit: 'version.startAt', ixc: 'cliente_contrato.data_ativacao' }),
  f('B', 'b_termino', 'Data de término', 'date', true, true, { inherit: 'version.endAt', ixc: 'cliente_contrato.data_expiracao' }),
  f('B', 'b_resp_comercial', 'Responsável comercial', 'text', true, false, { inherit: 'contract.commercialOwner' }),
  f('B', 'b_vendedor', 'Vendedor (código no IXC)', 'int', false, false, { ixc: 'cliente_contrato.id_vendedor' }),
  f('B', 'b_obs', 'Observações do contrato', 'textarea', false, false, { ixc: 'cliente_contrato.obs' }),

  // D. Financeiro
  f('D', 'd_instalacao', 'Valor de instalação ou ativação', 'money', false, true, { ixc: 'cliente_contrato.taxa_instalacao' }),
  f('D', 'd_recorrente', 'Valor recorrente (mensal)', 'money', true, true, { inherit: 'version.monthlyCents' }),
  f('D', 'd_total', 'Valor total contratado', 'money', false, true, { inherit: 'version.totalCents' }),
  f('D', 'd_desconto', 'Descontos', 'money', false, true),
  f('D', 'd_acrescimo', 'Acréscimos', 'money', false, true),
  f('D', 'd_vencimento', 'Dia de vencimento', 'int', true, true, { inherit: 'version.billingDay' }),
  f('D', 'd_forma_pagamento', 'Forma de pagamento', 'text', true, true),
  f('D', 'd_periodicidade', 'Periodicidade de cobrança', 'text', true, true),
  f('D', 'd_primeira_competencia', 'Primeira competência de faturamento', 'month', true, true),
  f('D', 'd_inicio_faturamento', 'Data de início do faturamento', 'date', true, true, { inherit: 'version.billingStartAt' }),
  f('D', 'd_prorata', 'Pró-rata', 'choice', false, true, { options: SIM_NAO }),
  f('D', 'd_carteira', 'Carteira de cobrança (código no IXC)', 'int', true, true, { ixc: 'cliente_contrato.id_carteira_cobranca' }),
  f('D', 'd_centro_custo', 'Centro de custo', 'text', false, false),
  f('D', 'd_tributario', 'Informações tributárias', 'textarea', false, false),
  f('D', 'd_obs', 'Observações financeiras', 'textarea', false, false),

  // E. Reajustes (o IXC não tem campo próprio; o ISP-SPRINT acompanha)
  f('E', 'e_indice', 'Índice contratual', 'text', true, true, { inherit: 'version.adjustmentIndex' }),
  f('E', 'e_data_base', 'Data-base', 'date', true, true, { inherit: 'version.adjustmentBaseDate' }),
  f('E', 'e_periodicidade', 'Periodicidade (meses)', 'int', true, true),
  f('E', 'e_proximo', 'Data do próximo reajuste', 'date', false, true),
  f('E', 'e_percentual', 'Percentual aplicável, quando definido', 'text', false, true),
  f('E', 'e_condicoes', 'Condições especiais', 'textarea', false, false),
  f('E', 'e_formalizacao', 'Exige formalização', 'choice', false, false, { options: SIM_NAO }),

  // F. Operação
  f('F', 'f_endereco_instalacao', 'Endereço de instalação', 'text', true, false),
  f('F', 'f_unidade', 'Unidade ou local atendido', 'text', false, false),
  f('F', 'f_servico', 'Identificação do serviço (login/circuito)', 'text', true, false),
  f('F', 'f_tecnologia', 'Tecnologia', 'text', true, false),
  f('F', 'f_banda', 'Banda contratada', 'text', false, false),
  f('F', 'f_ativacao', 'Informações de ativação', 'textarea', false, false),
  f('F', 'f_parametros', 'Parâmetros técnicos', 'textarea', false, false),
  f('F', 'f_resp_implantacao', 'Responsável pela implantação', 'text', true, false, { inherit: 'contract.operationalOwner' }),
  f('F', 'f_obs', 'Observações operacionais', 'textarea', false, false),

  // G. Complementares
  f('G', 'g_ids_externos', 'Identificadores externos', 'textarea', false, false),
  f('G', 'g_obs_internas', 'Observações internas', 'textarea', false, false, { internal: true, hint: 'Não vai para o IXC nem para a ficha de lançamento.' }),
];

export const ERP_FIELD_MAP = new Map(ERP_FIELDS.map((x) => [x.key, x]));
export const erpField = (key: string) => ERP_FIELD_MAP.get(key) ?? null;

/** Produto ou serviço do grupo C: herdado dos itens da versão vigente, complementado pelo cadastro. */
export type ErpItem = {
  description: string;
  qty: number;
  unitCents: number;
  /** complementos do cadastro */
  ixcCode: string | null;
  unit: string | null;
  periodicity: string | null;
  location: string | null;
  notes: string | null;
};
export const ERP_ITEM_REQUIRED = ['ixcCode', 'unit', 'periodicity'] as const;
export const ERP_ITEM_LABELS: Record<(typeof ERP_ITEM_REQUIRED)[number], string> = { ixcCode: 'código no IXC', unit: 'unidade de medida', periodicity: 'periodicidade' };

/** Campo extra do grupo G (exigido pelo IXC conforme produto ou modalidade). */
export type ErpExtra = { label: string; value: string; ixc: string | null };

export type ErpValueOrigin = 'herdado' | 'manual' | 'vazio';
export type ErpFieldState = 'pendente' | 'preenchido' | 'validado' | 'divergente' | 'sincronizado';

/** Valor efetivo de um campo: o manual vence o herdado. Senha nunca sai daqui (só "definida"). */
export function effectiveValue(def: ErpFieldDef, manual: Record<string, string | null>, inherited: InheritedValues): { value: string | null; origin: ErpValueOrigin } {
  const m = manual[def.key];
  if (m != null && String(m).trim() !== '') return { value: String(m).trim(), origin: 'manual' };
  const h = def.inherit ? inherited[def.inherit] : null;
  if (h != null && String(h).trim() !== '') return { value: String(h).trim(), origin: 'herdado' };
  return { value: null, origin: 'vazio' };
}

const onlyDigits = (v: string) => v.replace(/\D/g, '');

export function validCpf(v: string) {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export function validCnpj(v: string) {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = w.reduce((a, x, i) => a + x * Number(d[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
/** Tipo de pessoa pelo documento (11 dígitos = física, 14 = jurídica). */
export function personTypeOf(doc: string | null | undefined): 'F' | 'J' | null {
  const d = onlyDigits(doc ?? '');
  return d.length === 11 ? 'F' : d.length === 14 ? 'J' : null;
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** Formato do valor (não a obrigatoriedade). Devolve a mensagem do problema ou null. */
export function formatError(def: ErpFieldDef, value: string, ctx: { personType?: string | null } = {}): string | null {
  const v = value.trim();
  switch (def.type) {
    case 'int': return /^\d+$/.test(v) ? (def.key === 'd_vencimento' && (Number(v) < 1 || Number(v) > 31) ? 'Dia entre 1 e 31' : null) : 'Use só números';
    case 'money': return /^\d+$/.test(v) ? null : 'Valor em centavos inválido';
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'Data inválida';
    case 'month': return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? null : 'Mês inválido (AAAA-MM)';
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'E-mail inválido';
    case 'phone': return onlyDigits(v).length >= 10 && onlyDigits(v).length <= 13 ? null : 'Telefone com DDD';
    case 'cep': return onlyDigits(v).length === 8 ? null : 'CEP com 8 dígitos';
    case 'uf': return UFS.includes(v.toUpperCase()) ? null : 'UF inválida';
    case 'choice': return def.options?.some((o) => o.value === v) ? null : 'Opção inválida';
    case 'doc': {
      if (ctx.personType === 'E') return null;
      const d = onlyDigits(v);
      if (d.length === 11) return validCpf(d) ? null : 'CPF inválido';
      if (d.length === 14) return validCnpj(d) ? null : 'CNPJ inválido';
      return 'CPF (11) ou CNPJ (14 dígitos)';
    }
    default: return null;
  }
}

export type ErpIssue = { key: string; group: ErpGroup; label: string; message: string };

/**
 * Pendências que impedem o envio à conferência (e a aprovação): obrigatórios vazios, formatos inválidos,
 * coerência entre tipo de pessoa e documento, e itens do grupo C incompletos.
 */
export function erpIssues(values: Record<string, string | null>, items: readonly ErpItem[], hasSecret: boolean): ErpIssue[] {
  const out: ErpIssue[] = [];
  const pt = values.a_tipo_pessoa ?? null;
  for (const def of ERP_FIELDS) {
    const v = def.type === 'secret' ? (hasSecret ? 'x' : null) : values[def.key];
    if (v == null || String(v).trim() === '') {
      if (def.required) out.push({ key: def.key, group: def.group, label: def.label, message: 'Obrigatório' });
      continue;
    }
    if (def.type === 'secret') continue;
    const e = formatError(def, String(v), { personType: pt });
    if (e) out.push({ key: def.key, group: def.group, label: def.label, message: e });
  }
  const doc = values.a_cnpj_cpf;
  if (doc && pt && pt !== 'E') {
    const t = personTypeOf(doc);
    if (t && t !== pt) out.push({ key: 'a_tipo_pessoa', group: 'A', label: 'Tipo pessoa', message: t === 'J' ? 'O documento é CNPJ: pessoa jurídica' : 'O documento é CPF: pessoa física' });
  }
  if (!items.length) out.push({ key: 'items', group: 'C', label: 'Produtos e serviços', message: 'Inclua ao menos um produto ou serviço no contrato' });
  items.forEach((it, i) => {
    for (const k of ERP_ITEM_REQUIRED) if (!it[k] || !String(it[k]).trim()) out.push({ key: `items.${i}.${k}`, group: 'C', label: `${it.description || `Item ${i + 1}`}`, message: `Informe ${ERP_ITEM_LABELS[k]}` });
  });
  return out;
}

const ITEM_KEYS = ['description', 'qty', 'unitCents', 'ixcCode', 'unit', 'periodicity', 'location', 'notes'] as const;
/** Itens em texto canônico (a ordem das chaves não importa: o banco guarda JSON reordenado). */
export const canonicalItems = (items: readonly ErpItem[]) => JSON.stringify(items.map((i) => ITEM_KEYS.map((k) => i[k] ?? null)));

/** Campos críticos alterados entre duas fotografias (itens do grupo C contam como críticos). */
export function criticalChanges(before: Record<string, string | null>, after: Record<string, string | null>, itemsBefore: readonly ErpItem[], itemsAfter: readonly ErpItem[]): string[] {
  const out: string[] = [];
  for (const def of ERP_FIELDS) if (def.critical && (before[def.key] ?? null) !== (after[def.key] ?? null)) out.push(def.key);
  if (canonicalItems(itemsBefore) !== canonicalItems(itemsAfter)) out.push('items');
  return out;
}

export type ErpAction = 'save' | 'submit' | 'approve' | 'return' | 'release' | 'launch' | 'check' | 'reopen';
export const ERP_ACTION_LABELS: Record<ErpAction, string> = {
  save: 'Salvar', submit: 'Enviar para conferência', approve: 'Aprovar', return: 'Devolver para correção', release: 'Liberar para lançamento',
  launch: 'Registrar lançamento no IXC', check: 'Conferir no IXC', reopen: 'Reabrir',
};

/** De qual status cada ação parte. A API confere também quem pode (segregação de funções). */
export const ERP_TRANSITIONS: Record<Exclude<ErpAction, 'save'>, { from: readonly ErpStatus[]; to: ErpStatus | 'resultado' }> = {
  submit: { from: ['nao_iniciado', 'em_preenchimento', 'devolvido'], to: 'aguardando_conferencia' },
  approve: { from: ['aguardando_conferencia'], to: 'aprovado' },
  return: { from: ['aguardando_conferencia'], to: 'devolvido' },
  release: { from: ['aprovado'], to: 'aguardando_lancamento' },
  launch: { from: ['aprovado', 'aguardando_lancamento'], to: 'lancado' },
  check: { from: ['lancado', 'divergente'], to: 'resultado' },
  reopen: { from: ['divergente'], to: 'em_preenchimento' },
};

export function canTransition(status: ErpStatus, action: Exclude<ErpAction, 'save'>) {
  return ERP_TRANSITIONS[action].from.includes(status);
}

/** Onde é permitido editar: antes da conferência, ou depois da aprovação (com a regra dos campos críticos). Nunca durante a conferência. */
export function canEdit(status: ErpStatus) {
  return status !== 'aguardando_conferencia';
}
/** Depois de aprovado, mudar campo crítico invalida a aprovação. */
export const APPROVED_STATES: readonly ErpStatus[] = ['aprovado', 'aguardando_lancamento', 'lancado', 'conferido_ixc', 'divergente'];

/** Resultado de comparar a fotografia aprovada com o que a leitura do IXC devolveu. */
export type IxcCompare = { key: string; label: string; expected: string; found: string | null; status: 'ok' | 'divergente' | 'nao_lido' };

const norm = (def: ErpFieldDef, v: string) => {
  const t = v.trim();
  if (['doc', 'cep', 'phone'].includes(def.type)) return onlyDigits(t);
  if (def.type === 'date') return t.slice(0, 10);
  if (def.type === 'int') return String(Number(t));
  return t.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
};

/**
 * Compara campo a campo. Só entram campos com correspondência no IXC e valor aprovado;
 * campo que a leitura não trouxe fica "não lido" (conferência manual), nunca "ok".
 */
export function compareWithIxc(approved: Record<string, string | null>, ixc: { cliente?: Record<string, unknown> | null; contrato?: Record<string, unknown> | null }): IxcCompare[] {
  const out: IxcCompare[] = [];
  for (const def of ERP_FIELDS) {
    if (!def.ixc || def.type === 'secret' || def.internal) continue;
    const expected = approved[def.key];
    if (expected == null || expected === '') continue;
    const [table, col] = def.ixc.split('.') as [string, string];
    const rec = table === 'cliente' ? ixc.cliente : ixc.contrato;
    const raw = rec && Object.prototype.hasOwnProperty.call(rec, col) ? rec[col] : undefined;
    if (raw === undefined || raw === null || raw === '') { out.push({ key: def.key, label: def.label, expected, found: null, status: 'nao_lido' }); continue; }
    const found = String(raw);
    out.push({ key: def.key, label: def.label, expected, found, status: norm(def, found) === norm(def, expected) ? 'ok' : 'divergente' });
  }
  return out;
}

/** Texto canônico da fotografia aprovada (a API guarda o SHA-256 dele para detectar mudança posterior). */
export function snapshotText(values: Record<string, string | null>, items: readonly ErpItem[]): string {
  const keys = Object.keys(values).sort();
  return JSON.stringify([keys.map((k) => [k, values[k] ?? null]), canonicalItems(items)]);
}
