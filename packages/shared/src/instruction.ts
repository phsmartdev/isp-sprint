/**
 * Modelo de instrução da inteligência do negócio.
 *
 * Um único documento JSON, versionado por empresa, que define:
 *  - jornadas de venda (cada uma com seu pipeline e etapas, e o que cada etapa exige para entrar);
 *  - roteiro do Sprint (perguntas por etapa, dicas e objeções);
 *  - regras dos insights da tela Inteligência;
 *  - modelos de e-mail.
 *
 * A gerência exporta o modelo ativo, adapta (à mão ou com ajuda de uma IA) e envia de volta.
 * O sistema valida, mostra a prévia do que muda e só aplica quando alguém clica em Ativar.
 */
import { z } from 'zod';

export const INSTRUCTION_SCHEMA_ID = 'isp-sprint/instrucao@1';

const SEGMENTS = ['residencial', 'empresarial', 'governamental', 'institucional'] as const;
const slug = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use letras minúsculas, números e _ (2 a 40 caracteres, começando por letra)');
const text = (max: number) => z.string().trim().min(1, 'Não pode ficar vazio').max(max);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor no formato #RRGGBB').optional();

export const EMAIL_TEMPLATE_KEYS = ['proposta', 'followup', 'convite_usuario', 'nova_senha', 'alerta_atividades', 'alerta_lead_atribuido', 'alerta_venda_fechada'] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];
export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  proposta: 'Proposta ao cliente',
  followup: 'Follow-up ao cliente',
  convite_usuario: 'Convite de usuário',
  nova_senha: 'Nova senha de usuário',
  alerta_atividades: 'Alerta de atividades vencidas',
  alerta_lead_atribuido: 'Alerta de lead atribuído',
  alerta_venda_fechada: 'Alerta de venda fechada',
};

/** Variáveis disponíveis em cada modelo de e-mail ({{variavel}}). */
export const EMAIL_VARIABLES: Record<EmailTemplateKey, string[]> = {
  proposta: ['cliente.nome', 'vendedor.nome', 'vendedor.email', 'plano.nome', 'plano.valor', 'empresa.nome'],
  followup: ['cliente.nome', 'vendedor.nome', 'vendedor.email', 'plano.nome', 'plano.valor', 'empresa.nome'],
  convite_usuario: ['usuario.nome', 'usuario.email', 'senha_temporaria', 'link', 'empresa.nome'],
  nova_senha: ['usuario.nome', 'senha_temporaria', 'link', 'empresa.nome'],
  alerta_atividades: ['usuario.nome', 'quantidade', 'lista', 'link', 'empresa.nome'],
  alerta_lead_atribuido: ['usuario.nome', 'lead.nome', 'lead.telefone', 'atribuido_por', 'link', 'empresa.nome'],
  alerta_venda_fechada: ['usuario.nome', 'cliente.nome', 'vendedor.nome', 'plano.nome', 'plano.valor', 'link', 'empresa.nome'],
};

export const QuestionSchema = z.object({
  id: slug,
  texto: text(300),
  ajuda: z.string().trim().max(500).optional(),
  tipo: z.enum(['texto', 'sim_nao', 'opcoes']).default('texto'),
  opcoes: z.array(text(80)).max(12).optional(),
  obrigatoria: z.boolean().default(false),
});

export const StageSchema = z.object({
  chave: slug,
  nome: text(40),
  tipo: z.enum(['aberta', 'ganha', 'perdida']).default('aberta'),
  cor: color,
  /** O que a oportunidade precisa ter para ENTRAR nesta etapa. */
  exige: z
    .object({
      proposta: z.boolean().default(false),
      plano: z.boolean().default(false),
      proximaAcao: z.boolean().default(false),
      respostasObrigatorias: z.boolean().default(false),
    })
    .default({}),
  perguntas: z.array(QuestionSchema).max(30).default([]),
  dicas: z.array(text(300)).max(10).default([]),
});

// ------------------------------------------------------------------ campos personalizados e automações
export const FIELD_TYPES = ['texto', 'texto_longo', 'numero', 'moeda', 'data', 'lista', 'sim_nao'] as const;
export const FIELD_TYPE_LABELS: Record<(typeof FIELD_TYPES)[number], string> = { texto: 'Texto', texto_longo: 'Texto longo', numero: 'Número', moeda: 'Valor (R$)', data: 'Data', lista: 'Lista de opções', sim_nao: 'Sim/Não' };
/** Tipos de venda: opções de formulário dentro do funil (não são funis). Cada campo pode valer para alguns tipos. */
export const SALE_TYPE_KEYS = ['licitacao', 'adesao_ata', 'consumo_contrato', 'venda_consultiva'] as const;
export type SaleTypeKey = (typeof SALE_TYPE_KEYS)[number];
export const SALE_TYPE_LABELS: Record<SaleTypeKey, string> = { licitacao: 'Licitação', adesao_ata: 'Adesão à Ata', consumo_contrato: 'Consumo de Contrato', venda_consultiva: 'Venda Consultiva' };
export const SALE_TYPE_HINTS: Record<SaleTypeKey, string> = {
  licitacao: 'Disputas em pregão, dispensa ou inexigibilidade.', adesao_ata: 'Adesão de outro órgão a uma ata de registro de preços.',
  consumo_contrato: 'Nova demanda dentro de um contrato que já existe.', venda_consultiva: 'Clientes privados: necessidade, expansão, modernização ou relacionamento.',
};
export const FieldSchema = z.object({
  chave: slug,
  rotulo: text(60),
  tipo: z.enum(FIELD_TYPES).default('texto'),
  opcoes: z.array(text(60)).max(30).default([]),
  obrigatorio: z.boolean().default(false),
  /** Tipos de venda em que o campo aparece. Vazio = todos. */
  tiposVenda: z.array(z.enum(SALE_TYPE_KEYS)).default([]),
});
export type CustomField = z.infer<typeof FieldSchema>;

export const TRIGGER_TYPES = ['criada', 'entrou_na_etapa', 'ganha', 'perdida', 'parada'] as const;
export const TRIGGER_LABELS: Record<(typeof TRIGGER_TYPES)[number], string> = {
  criada: 'Oportunidade criada',
  entrou_na_etapa: 'Entrou na etapa',
  ganha: 'Venda fechada',
  perdida: 'Marcada como perdida',
  parada: 'Parada na etapa por X dias',
};
export const AutomationTriggerSchema = z.object({
  tipo: z.enum(TRIGGER_TYPES),
  etapa: slug.optional().nullable(),
  dias: z.number().int().min(1).max(365).optional().nullable(),
});
/** Responsável: 'dono' (o da oportunidade) ou o id/e-mail de um usuário. */
const person = z.string().trim().min(3).max(200);
export const ACTION_TYPES = ['criar_tarefa', 'enviar_email', 'mover_etapa', 'duplicar', 'atribuir'] as const;
export const ACTION_LABELS: Record<(typeof ACTION_TYPES)[number], string> = {
  criar_tarefa: 'Criar tarefa',
  enviar_email: 'Enviar e-mail',
  mover_etapa: 'Mover para etapa',
  duplicar: 'Duplicar em outro funil (com histórico)',
  atribuir: 'Trocar responsável',
};
export const AutomationActionSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('criar_tarefa'), titulo: text(200), tipoAtividade: z.enum(['tarefa', 'ligacao', 'reuniao', 'email', 'whatsapp', 'visita']).default('tarefa'), prazoDias: z.number().int().min(0).max(365).default(1), responsavel: person.default('dono') }),
  z.object({ tipo: z.literal('enviar_email'), para: z.enum(['cliente', 'responsavel', 'gerencia']), assunto: text(200), corpo: text(5000) }),
  z.object({ tipo: z.literal('mover_etapa'), etapa: slug }),
  z.object({ tipo: z.literal('duplicar'), jornada: slug, etapa: slug.optional().nullable(), responsavel: person.default('mesmo') }),
  z.object({ tipo: z.literal('atribuir'), responsavel: person }),
]);
export const AutomationSchema = z.object({
  nome: text(80),
  ativo: z.boolean().default(true),
  gatilho: AutomationTriggerSchema,
  acoes: z.array(AutomationActionSchema).min(1).max(10),
});
export type Automation = z.infer<typeof AutomationSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
export const AUTOMATION_EMAIL_VARIABLES = ['cliente.nome', 'cliente.telefone', 'responsavel.nome', 'oportunidade.titulo', 'etapa.nome', 'jornada.nome', 'plano.nome', 'plano.valor', 'link', 'empresa.nome'];

export const JourneySchema = z.object({
  chave: slug,
  nome: text(60),
  descricao: z.string().trim().max(300).optional(),
  padrao: z.boolean().default(false),
  /** Segmentos que usam esta jornada automaticamente ao criar uma oportunidade. */
  segmentos: z.array(z.enum(SEGMENTS)).default([]),
  etapas: z.array(StageSchema).min(3).max(15),
  /** E-mails de quem trabalha nesta jornada. Vazio = todos. A gerência vê todas. */
  membros: z.array(z.string().trim().toLowerCase().email()).max(200).default([]),
  campos: z.array(FieldSchema).max(40).default([]),
  automacoes: z.array(AutomationSchema).max(50).default([]),
});

export const ObjectionSchema = z.object({
  id: slug,
  titulo: text(120),
  resposta: text(1500),
  jornadas: z.array(slug).default([]),
});

export const InsightRulesSchema = z.object({
  amostraMinima: z.number().int().min(3).max(1000).default(10),
  crescimentoLeads: z.object({ ativo: z.boolean().default(true) }).default({}),
  planoMaisVendido: z.object({ ativo: z.boolean().default(true) }).default({}),
  conversao: z.object({ ativo: z.boolean().default(true), metaPercentual: z.number().min(0).max(100).optional() }).default({}),
  regiao: z.object({ ativo: z.boolean().default(true) }).default({}),
});

export const EmailTemplateSchema = z.object({ assunto: text(200), corpo: text(5000) });

export const InstructionSchema = z.object({
  schema: z.literal(INSTRUCTION_SCHEMA_ID),
  _leia_me: z.array(z.string()).optional(),
  versao: z.number().int().optional(),
  descricao: z.string().trim().max(500).optional(),
  jornadas: z.array(JourneySchema).min(1).max(20),
  objecoes: z.array(ObjectionSchema).max(100).default([]),
  insights: InsightRulesSchema.default({}),
  emails: z.object({ modelos: z.object(Object.fromEntries(EMAIL_TEMPLATE_KEYS.map((k) => [k, EmailTemplateSchema])) as Record<EmailTemplateKey, typeof EmailTemplateSchema>) }),
});
export type Instruction = z.infer<typeof InstructionSchema>;
export type InstructionJourney = z.infer<typeof JourneySchema>;
export type InstructionStage = z.infer<typeof StageSchema>;
export type InstructionQuestion = z.infer<typeof QuestionSchema>;

export type InstructionIssue = { path: string; message: string };

/** Regras que o schema sozinho não expressa. Retorna lista vazia quando está tudo certo. */
export function checkInstruction(i: Instruction): InstructionIssue[] {
  const issues: InstructionIssue[] = [];
  const dup = <T>(arr: T[], key: (x: T) => string) => arr.map(key).filter((k, idx, all) => all.indexOf(k) !== idx);
  for (const k of dup(i.jornadas, (j) => j.chave)) issues.push({ path: 'jornadas', message: `Chave de jornada repetida: ${k}` });
  const defaults = i.jornadas.filter((j) => j.padrao).length;
  if (defaults !== 1) issues.push({ path: 'jornadas', message: `Marque exatamente uma jornada como padrao (hoje: ${defaults})` });
  const segOwners = new Map<string, string>();
  i.jornadas.forEach((j, ji) => {
    const base = `jornadas[${ji}] (${j.chave})`;
    for (const s of j.segmentos) {
      if (segOwners.has(s)) issues.push({ path: base, message: `Segmento ${s} já está na jornada ${segOwners.get(s)}` });
      else segOwners.set(s, j.chave);
    }
    for (const k of dup(j.etapas, (e) => e.chave)) issues.push({ path: base, message: `Chave de etapa repetida: ${k}` });
    const won = j.etapas.filter((e) => e.tipo === 'ganha');
    const lost = j.etapas.filter((e) => e.tipo === 'perdida');
    if (won.length !== 1 || won[0]!.chave !== 'ganha') issues.push({ path: base, message: 'Cada jornada precisa de exatamente uma etapa tipo "ganha", com chave "ganha"' });
    if (lost.length !== 1 || lost[0]!.chave !== 'perdida') issues.push({ path: base, message: 'Cada jornada precisa de exatamente uma etapa tipo "perdida", com chave "perdida"' });
    j.etapas.forEach((e, ei) => {
      if (e.tipo === 'aberta' && (e.chave === 'ganha' || e.chave === 'perdida')) issues.push({ path: `${base}.etapas[${ei}]`, message: `A chave ${e.chave} é reservada` });
      for (const q of dup(e.perguntas, (x) => x.id)) issues.push({ path: `${base}.etapas[${ei}]`, message: `Pergunta repetida: ${q}` });
      e.perguntas.forEach((q, qi) => {
        if (q.tipo === 'opcoes' && (!q.opcoes || q.opcoes.length < 2)) issues.push({ path: `${base}.etapas[${ei}].perguntas[${qi}]`, message: 'Pergunta do tipo opcoes precisa de ao menos 2 opções' });
      });
    });
    for (const k of dup(j.campos, (c) => c.chave)) issues.push({ path: base, message: `Campo repetido: ${k}` });
    j.campos.forEach((c, ci) => { if (c.tipo === 'lista' && c.opcoes.length < 2) issues.push({ path: `${base}.campos[${ci}]`, message: 'Campo do tipo lista precisa de ao menos 2 opções' }); });
    j.automacoes.forEach((a, ai) => {
      for (const m of checkAutomation(a, j, i.jornadas)) issues.push({ path: `${base}.automacoes[${ai}] (${a.nome})`, message: m });
    });
    if (j.etapas.filter((e) => e.tipo === 'aberta').length < 1) issues.push({ path: base, message: 'A jornada precisa de ao menos uma etapa aberta' });
    if (j.etapas[0]?.tipo !== 'aberta') issues.push({ path: base, message: 'A primeira etapa precisa ser aberta' });
  });
  const allQ = i.jornadas.flatMap((j) => j.etapas.flatMap((e) => e.perguntas.map((q) => `${j.chave}.${q.id}`)));
  for (const q of dup(allQ, (x) => x)) issues.push({ path: 'jornadas', message: `Pergunta repetida na mesma jornada: ${q}` });
  for (const k of dup(i.objecoes, (o) => o.id)) issues.push({ path: 'objecoes', message: `Objeção repetida: ${k}` });
  const keys = new Set(i.jornadas.map((j) => j.chave));
  i.objecoes.forEach((o, oi) => o.jornadas.forEach((j) => { if (!keys.has(j)) issues.push({ path: `objecoes[${oi}]`, message: `Jornada inexistente: ${j}` }); }));
  for (const k of EMAIL_TEMPLATE_KEYS) {
    const t = i.emails.modelos[k];
    const used = [...`${t.assunto} ${t.corpo}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
    for (const v of used) if (!EMAIL_VARIABLES[k].includes(v)) issues.push({ path: `emails.modelos.${k}`, message: `Variável desconhecida {{${v}}}. Disponíveis: ${EMAIL_VARIABLES[k].join(', ')}` });
  }
  return issues;
}

/** Coerência de uma automação com a jornada dela e as demais. */
export function checkAutomation(a: Automation, j: { chave: string; etapas: { chave: string; tipo: string }[] }, all: { chave: string; etapas: { chave: string; tipo: string }[] }[]) {
  const out: string[] = [];
  const stage = (jj: typeof j, k?: string | null) => !!k && jj.etapas.some((e) => e.chave === k);
  if ((a.gatilho.tipo === 'entrou_na_etapa') && !stage(j, a.gatilho.etapa)) out.push('Gatilho "entrou na etapa" precisa de uma etapa desta jornada');
  if (a.gatilho.tipo === 'parada' && (!a.gatilho.dias || (a.gatilho.etapa && !stage(j, a.gatilho.etapa)))) out.push('Gatilho "parada" precisa de dias (e, se informar etapa, uma etapa desta jornada)');
  for (const ac of a.acoes) {
    if (ac.tipo === 'mover_etapa' && !stage(j, ac.etapa)) out.push(`Etapa inexistente para mover: ${ac.etapa}`);
    if (ac.tipo === 'duplicar') {
      const target = all.find((x) => x.chave === ac.jornada);
      if (!target) out.push(`Jornada de destino inexistente: ${ac.jornada}`);
      else if (ac.etapa && !target.etapas.some((e) => e.chave === ac.etapa && e.tipo === 'aberta')) out.push(`Etapa de destino precisa ser aberta na jornada ${ac.jornada}`);
    }
    if (ac.tipo === 'enviar_email') {
      const used = [...`${ac.assunto} ${ac.corpo}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!);
      for (const v of used) if (!AUTOMATION_EMAIL_VARIABLES.includes(v)) out.push(`Variável desconhecida {{${v}}}`);
    }
  }
  if (a.gatilho.tipo === 'perdida' && a.acoes.some((x) => x.tipo === 'mover_etapa')) out.push('Oportunidade perdida não pode ser movida na mesma jornada; use "duplicar"');
  return out;
}

/** Lê e valida um JSON enviado. Erros com caminho legível. */
export function parseInstruction(raw: unknown): { ok: true; value: Instruction } | { ok: false; issues: InstructionIssue[] } {
  const r = InstructionSchema.safeParse(raw);
  if (!r.success) return { ok: false, issues: r.error.issues.map((x) => ({ path: x.path.join('.') || '(raiz)', message: x.message })) };
  const issues = checkInstruction(r.data);
  return issues.length ? { ok: false, issues } : { ok: true, value: r.data };
}

export const INSTRUCTION_README = [
  'Modelo de instrução do RevOps. Edite e envie em Configurações → Modelo de instrução.',
  'Nada muda até você revisar a prévia e clicar em Ativar. As versões anteriores ficam guardadas.',
  'jornadas: cada jornada é um pipeline. "padrao": true em exatamente uma. "segmentos" escolhe a jornada automaticamente pelo segmento do cliente.',
  'etapas: na ordem do funil. tipo "aberta", e no fim uma etapa tipo "ganha" (chave "ganha") e uma tipo "perdida" (chave "perdida").',
  'Não renomeie a chave de uma etapa que tem oportunidades abertas; mude só o "nome". Chaves: letras minúsculas, números e _.',
  'exige: o que a oportunidade precisa ter para ENTRAR na etapa (proposta anexada, plano escolhido, próxima ação, perguntas obrigatórias respondidas).',
  'perguntas: roteiro mostrado no Sprint daquela etapa. tipo texto, sim_nao ou opcoes (com "opcoes").',
  'objecoes: respostas sugeridas; "jornadas" vazio vale para todas.',
  'membros: e-mails de quem trabalha na jornada (vazio = todos). campos: campos personalizados do cadastro (texto, texto_longo, numero, moeda, data, lista, sim_nao).',
  'automacoes: gatilho (criada, entrou_na_etapa, ganha, perdida, parada) e ações (criar_tarefa, enviar_email, mover_etapa, duplicar, atribuir). Em responsavel use "dono", "mesmo" ou o e-mail do usuário.',
  'insights: amostraMinima é o mínimo de registros para gerar uma frase; cada regra pode ser desligada.',
  'emails.modelos: use {{variavel}}; o sistema recusa variáveis que não existem para aquele modelo.',
];


/**
 * Campos de cada tipo de venda (diretriz de UX de 23/10), dentro do funil Corporativo. Configuração inicial:
 * rótulos, ordem, opções, obrigatoriedade e tipos de cada campo mudam em Configurações → Jornadas.
 */
export function saleTypeFields(): CustomField[] {
  const f = (chave: string, rotulo: string, tiposVenda: SaleTypeKey[], tipo: (typeof FIELD_TYPES)[number] = 'texto', opcoes: string[] = []): CustomField => ({ chave, rotulo, tipo, opcoes, obrigatorio: false, tiposVenda });
  const L: SaleTypeKey[] = ['licitacao'], A: SaleTypeKey[] = ['adesao_ata'], C: SaleTypeKey[] = ['consumo_contrato'], V: SaleTypeKey[] = ['venda_consultiva'];
  return [
    f('tipo_lancamento', 'Tipo de lançamento', L, 'lista', ['Licitação publicada', 'Análise de TR', 'Pedido de cotação', 'Apoio ao TR']),
    f('tipo_disputa', 'Tipo de disputa', L, 'lista', ['Licitação', 'Dispensa', 'Inexigibilidade', 'Outros']),
    // modalidade do pregão logo abaixo do tipo de disputa; classificação interna, separada do "tipo de disputa" que o comercial vê (Lei 14.133: modalidades e contratação direta)
    f('modalidade_interna', 'Modalidade (classificação interna)', L, 'lista', ['Pregão', 'Concorrência', 'Concurso', 'Leilão', 'Diálogo competitivo', 'Dispensa', 'Inexigibilidade']),
    f('objeto', 'Objeto', ['licitacao', 'adesao_ata'], 'texto_longo'),
    f('numero_edital', 'Número do edital', L),
    f('orgao_contratante', 'Órgão contratante', L),
    f('numero_processo', 'Número do processo', L),
    f('link_edital', 'Link do edital', L),
    f('data_sessao', 'Data da sessão', L, 'data'),
    f('prazo_proposta', 'Prazo de envio da proposta', L, 'data'),
    f('lotes_interesse', 'Itens ou lotes de interesse', L, 'texto_longo'),
    f('documento_servidor', 'Documento do servidor', L),
    f('valor_pregao', 'Valor do pregão', L, 'moeda'),
    f('valor_vitorioso', 'Valor vitorioso', L, 'moeda'),
    f('numero_ata', 'Número da ata', A),
    f('orgao_gerenciador', 'Órgão gerenciador', A),
    f('fornecedor_registrado', 'Fornecedor registrado', A),
    f('vigencia_ata', 'Vigência da ata', A, 'data'),
    f('situacao_autorizacao', 'Situação da autorização de adesão', A, 'lista', ['Não solicitada', 'Solicitada ao órgão gerenciador', 'Aceita pelo fornecedor', 'Autorizada', 'Negada']),
    f('objeto_item', 'Objeto ou item contratual', C, 'texto_longo'),
    f('tipo_demanda', 'Tipo de demanda', C, 'lista', ['Nova instalação', 'Ampliação', 'Mudança de endereço', 'Serviço adicional', 'Outro']),
    f('localidade', 'Localidade', C),
    f('prazo_solicitado', 'Prazo solicitado', C, 'data'),
    f('origem', 'De onde surgiu', V, 'lista', ['Necessidade do cliente', 'Expansão', 'Modernização', 'Relacionamento', 'Interesse estratégico']),
    f('necessidade', 'Necessidade ou objetivo do cliente', V, 'texto_longo'),
    f('solucoes_interesse', 'Soluções de interesse', V),
    f('escopo_preliminar', 'Escopo preliminar', V, 'texto_longo'),
    f('prazo_esperado', 'Prazo esperado', V, 'data'),
  ];
}
/** Chaves das antigas jornadas por tipo de venda (23/10), que viraram opções de formulário do funil Corporativo. */
export const LEGACY_SALE_TYPE_JOURNEYS = SALE_TYPE_KEYS;

const t = (assunto: string, corpo: string) => ({ assunto, corpo });

/** Modelo inicial: jornada Residencial (funil Yepnet) e jornada Empresarial com visita técnica. */
export function defaultInstruction(): Instruction {
  const fim = [
    { chave: 'ganha', nome: 'Venda fechada', tipo: 'ganha' as const, cor: '#22C55E', exige: { proposta: false, plano: true, proximaAcao: false, respostasObrigatorias: false }, perguntas: [], dicas: ['Venda fechada é ganho comercial; o contrato só conta depois da confirmação no IXC.'] },
    { chave: 'perdida', nome: 'Perdido', tipo: 'perdida' as const, cor: '#EF4444', exige: { proposta: false, plano: false, proximaAcao: false, respostasObrigatorias: false }, perguntas: [], dicas: [] },
  ];
  const none = { proposta: false, plano: false, proximaAcao: false, respostasObrigatorias: false };
  return {
    schema: INSTRUCTION_SCHEMA_ID,
    _leia_me: INSTRUCTION_README,
    descricao: 'Modelo inicial do RevOps',
    jornadas: [
      {
        chave: 'residencial',
        nome: 'Residencial',
        descricao: 'Venda de internet para casa, decisão em uma conversa.',
        padrao: true,
        segmentos: ['residencial'],
        membros: [],
        campos: [
          { chave: 'melhor_horario', rotulo: 'Melhor horário para contato', tipo: 'lista', opcoes: ['Manhã', 'Tarde', 'Noite'], obrigatorio: false, tiposVenda: [] },
          { chave: 'provedor_atual', rotulo: 'Provedor atual', tipo: 'texto', opcoes: [], obrigatorio: false, tiposVenda: [] },
        ],
        automacoes: [
          { nome: 'Perdida vai para Recuperação', ativo: true, gatilho: { tipo: 'perdida' }, acoes: [{ tipo: 'duplicar', jornada: 'recuperacao', etapa: null, responsavel: 'mesmo' }] },
          { nome: 'Venda fechada: agendar instalação', ativo: true, gatilho: { tipo: 'ganha' }, acoes: [{ tipo: 'criar_tarefa', titulo: 'Agendar instalação com o cliente', tipoAtividade: 'ligacao', prazoDias: 1, responsavel: 'dono' }] },
          { nome: 'Fechamento: conferir documentos', ativo: true, gatilho: { tipo: 'entrou_na_etapa', etapa: 'fechamento' }, acoes: [{ tipo: 'criar_tarefa', titulo: 'Conferir documentos para o contrato', tipoAtividade: 'tarefa', prazoDias: 0, responsavel: 'dono' }] },
        ],
        etapas: [
          { chave: 'novo_lead', nome: 'Novo lead', tipo: 'aberta', cor: '#3B82F6', exige: none, perguntas: [
            { id: 'motivo', texto: 'O que fez você procurar a gente hoje?', tipo: 'texto', obrigatoria: true, ajuda: 'Curiosidade e comparação também contam. Não presuma problema.' },
            { id: 'quem_usa', texto: 'Quantas pessoas usam a internet em casa?', tipo: 'opcoes', opcoes: ['1', '2 a 3', '4 a 5', '6 ou mais'], obrigatoria: false },
          ], dicas: ['Escute antes de oferecer plano.'] },
          { chave: 'qualificacao', nome: 'Qualificação', tipo: 'aberta', cor: '#F59E0B', exige: none, perguntas: [
            { id: 'uso_principal', texto: 'Para que vocês mais usam a internet?', tipo: 'opcoes', opcoes: ['Streaming', 'Jogos', 'Trabalho remoto', 'Estudo', 'Uso básico'], obrigatoria: true },
            { id: 'provedor_atual', texto: 'Tem internet hoje? Com qual provedor?', tipo: 'texto', obrigatoria: false, ajuda: 'Registre só o que o cliente disser.' },
            { id: 'fidelidade', texto: 'Tem fidelidade no contrato atual?', tipo: 'sim_nao', obrigatoria: false },
          ], dicas: ['Anote o que o cliente valoriza: preço, estabilidade, atendimento.'] },
          { chave: 'cobertura', nome: 'Cobertura', tipo: 'aberta', cor: '#8B5CF6', exige: { ...none, respostasObrigatorias: true }, perguntas: [
            { id: 'endereco_confirmado', texto: 'Endereço de instalação confirmado?', tipo: 'sim_nao', obrigatoria: true },
          ], dicas: ['Sem cobertura confirmada, não prometa plano nem data de instalação.'] },
          { chave: 'proposta', nome: 'Proposta', tipo: 'aberta', cor: '#60A5FA', exige: { ...none, plano: true }, perguntas: [], dicas: ['Compare situação atual × proposta só com dados que o cliente informou.'] },
          { chave: 'fechamento', nome: 'Fechamento', tipo: 'aberta', cor: '#4ADE80', exige: { ...none, proposta: true, plano: true, proximaAcao: true }, perguntas: [
            { id: 'decisor', texto: 'Quem decide a contratação?', tipo: 'texto', obrigatoria: false },
          ], dicas: ['Combine o próximo passo com data e hora.'] },
          ...fim,
        ],
      },
      {
        chave: 'empresarial',
        nome: 'Corporativo',
        descricao: 'Venda consultiva para empresas, governo e instituições, com visita técnica.',
        padrao: false,
        segmentos: ['empresarial', 'governamental', 'institucional'],
        membros: [],
        // CNPJ fica no cadastro da conta; os campos variam pelo tipo de venda
        campos: saleTypeFields(),
        automacoes: [
          { nome: 'Parada há 5 dias: retomar', ativo: true, gatilho: { tipo: 'parada', dias: 5 }, acoes: [{ tipo: 'criar_tarefa', titulo: 'Retomar contato — oportunidade parada', tipoAtividade: 'ligacao', prazoDias: 0, responsavel: 'dono' }] },
        ],
        etapas: [
          { chave: 'novo_lead', nome: 'Novo lead', tipo: 'aberta', cor: '#3B82F6', exige: none, perguntas: [
            { id: 'empresa_porte', texto: 'Quantos colaboradores usam a internet?', tipo: 'texto', obrigatoria: true },
          ], dicas: [] },
          { chave: 'diagnostico', nome: 'Diagnóstico', tipo: 'aberta', cor: '#F59E0B', exige: none, perguntas: [
            { id: 'servicos_criticos', texto: 'Quais serviços não podem parar (ERP, telefonia, câmeras)?', tipo: 'texto', obrigatoria: true },
            { id: 'sla', texto: 'Precisa de SLA contratual?', tipo: 'sim_nao', obrigatoria: false },
          ], dicas: ['Entenda o custo de uma hora parada para o cliente.'] },
          { chave: 'visita_tecnica', nome: 'Visita técnica', tipo: 'aberta', cor: '#8B5CF6', exige: none, perguntas: [
            { id: 'viabilidade', texto: 'Viabilidade técnica confirmada na visita?', tipo: 'sim_nao', obrigatoria: true },
          ], dicas: [] },
          { chave: 'proposta', nome: 'Proposta', tipo: 'aberta', cor: '#60A5FA', exige: { ...none, plano: true }, perguntas: [], dicas: [] },
          { chave: 'negociacao', nome: 'Negociação', tipo: 'aberta', cor: '#4ADE80', exige: { ...none, proposta: true, plano: true }, perguntas: [], dicas: ['Negocie prazo e escopo antes de preço.'] },
          ...fim,
        ],
      },
      {
        chave: 'recuperacao',
        nome: 'Recuperação',
        descricao: 'Oportunidades perdidas que voltam para uma nova abordagem.',
        padrao: false,
        segmentos: [],
        membros: [],
        campos: [],
        automacoes: [],
        etapas: [
          { chave: 'novo_contato', nome: 'Novo contato', tipo: 'aberta', cor: '#3B82F6', exige: none, perguntas: [
            { id: 'motivo_perda_confirmado', texto: 'O motivo da perda ainda vale?', tipo: 'sim_nao', obrigatoria: false },
          ], dicas: ['Retome pelo motivo registrado na perda.'] },
          { chave: 'reapresentacao', nome: 'Reapresentação', tipo: 'aberta', cor: '#F59E0B', exige: none, perguntas: [], dicas: [] },
          { chave: 'proposta', nome: 'Proposta', tipo: 'aberta', cor: '#60A5FA', exige: { ...none, plano: true }, perguntas: [], dicas: [] },
          ...fim,
        ],
      },
    ],
    objecoes: [
      { id: 'preco_alto', titulo: 'Está caro', resposta: 'Entendo. Posso comparar com o que você paga hoje e o que está incluso? Muitas vezes a diferença está na estabilidade e no suporte local.', jornadas: [] },
      { id: 'fidelidade_atual', titulo: 'Tenho fidelidade com outro provedor', resposta: 'Vamos ver quando ela termina. Posso deixar a proposta pronta e agendar o contato para a data certa.', jornadas: [] },
      { id: 'satisfeito', titulo: 'Estou satisfeito com o atual', resposta: 'Ótimo! O que você mais valoriza nele? Assim vejo se faz sentido apresentar algo ou só deixar o contato.', jornadas: [] },
      { id: 'precisa_aprovar', titulo: 'Preciso aprovar internamente', resposta: 'Claro. Quem participa da decisão? Posso preparar um resumo para apresentar e marcar uma conversa com essa pessoa.', jornadas: ['empresarial'] },
    ],
    insights: { amostraMinima: 10, crescimentoLeads: { ativo: true }, planoMaisVendido: { ativo: true }, conversao: { ativo: true, metaPercentual: 20 }, regiao: { ativo: true } },
    emails: {
      modelos: {
        proposta: t('Sua proposta {{empresa.nome}} — {{plano.nome}}', 'Olá, {{cliente.nome}}!\n\nConforme conversamos, segue em anexo a proposta do plano {{plano.nome}} por {{plano.valor}} por mês.\n\nQualquer dúvida, é só responder este e-mail.\n\n{{vendedor.nome}}\n{{empresa.nome}}'),
        followup: t('{{cliente.nome}}, conseguiu ver a proposta?', 'Olá, {{cliente.nome}}!\n\nPassando para saber se ficou alguma dúvida sobre o plano {{plano.nome}}. Posso ajudar com algo?\n\n{{vendedor.nome}}\n{{empresa.nome}}'),
        convite_usuario: t('Seu acesso ao RevOps — {{empresa.nome}}', 'Olá, {{usuario.nome}}!\n\nSeu acesso foi criado.\nE-mail: {{usuario.email}}\nSenha temporária: {{senha_temporaria}}\n\nEntre em {{link}} e troque a senha em Meu perfil.'),
        nova_senha: t('Nova senha temporária — {{empresa.nome}}', 'Olá, {{usuario.nome}}!\n\nSua nova senha temporária é {{senha_temporaria}}.\nEntre em {{link}} e troque a senha em Meu perfil.'),
        alerta_atividades: t('Você tem {{quantidade}} atividade(s) para hoje ou vencida(s)', 'Olá, {{usuario.nome}}!\n\n{{lista}}\n\nVeja em {{link}}'),
        alerta_lead_atribuido: t('Novo lead para você: {{lead.nome}}', 'Olá, {{usuario.nome}}!\n\n{{atribuido_por}} atribuiu o lead {{lead.nome}} ({{lead.telefone}}) para você.\n\nAbra em {{link}}'),
        alerta_venda_fechada: t('Venda fechada: {{cliente.nome}}', 'Olá, {{usuario.nome}}!\n\n{{vendedor.nome}} fechou a venda do plano {{plano.nome}} ({{plano.valor}}/mês) com {{cliente.nome}}.\n\nVeja em {{link}}'),
      },
    },
  };
}

/** Resumo legível das diferenças entre duas instruções (prévia antes de ativar). */
export function diffInstruction(prev: Instruction | null, next: Instruction): string[] {
  const out: string[] = [];
  if (!prev) return ['Primeira versão do modelo.'];
  const pj = new Map(prev.jornadas.map((j) => [j.chave, j]));
  const nj = new Map(next.jornadas.map((j) => [j.chave, j]));
  for (const [k, j] of nj) if (!pj.has(k)) out.push(`Nova jornada “${j.nome}” com ${j.etapas.length} etapas.`);
  for (const [k, j] of pj) if (!nj.has(k)) out.push(`Jornada “${j.nome}” removida.`);
  for (const [k, n] of nj) {
    const p = pj.get(k);
    if (!p) continue;
    if (p.nome !== n.nome) out.push(`Jornada “${p.nome}” renomeada para “${n.nome}”.`);
    if (p.padrao !== n.padrao && n.padrao) out.push(`“${n.nome}” passa a ser a jornada padrão.`);
    if (p.segmentos.join() !== n.segmentos.join()) out.push(`“${n.nome}”: segmentos ${n.segmentos.join(', ') || 'nenhum'}.`);
    const ps = new Map(p.etapas.map((e) => [e.chave, e]));
    const ns = new Map(n.etapas.map((e) => [e.chave, e]));
    for (const [sk, s] of ns) if (!ps.has(sk)) out.push(`“${n.nome}”: nova etapa “${s.nome}”.`);
    for (const [sk, s] of ps) if (!ns.has(sk)) out.push(`“${n.nome}”: etapa “${s.nome}” removida.`);
    if (p.etapas.map((e) => e.chave).filter((x) => ns.has(x)).join() !== n.etapas.map((e) => e.chave).filter((x) => ps.has(x)).join()) out.push(`“${n.nome}”: ordem das etapas alterada.`);
    for (const [sk, s] of ns) {
      const o = ps.get(sk);
      if (!o) continue;
      if (o.nome !== s.nome) out.push(`“${n.nome}”: etapa “${o.nome}” renomeada para “${s.nome}”.`);
      if (JSON.stringify(o.exige) !== JSON.stringify(s.exige)) out.push(`“${n.nome}” › “${s.nome}”: exigências alteradas.`);
      if (JSON.stringify(o.perguntas) !== JSON.stringify(s.perguntas)) out.push(`“${n.nome}” › “${s.nome}”: roteiro de perguntas alterado (${s.perguntas.length} pergunta(s)).`);
      if (JSON.stringify(o.dicas) !== JSON.stringify(s.dicas)) out.push(`“${n.nome}” › “${s.nome}”: dicas alteradas.`);
    }
  }
  if (JSON.stringify(prev.objecoes) !== JSON.stringify(next.objecoes)) out.push(`Objeções: ${next.objecoes.length} cadastrada(s) (antes ${prev.objecoes.length}).`);
  if (JSON.stringify(prev.insights) !== JSON.stringify(next.insights)) out.push('Regras dos insights alteradas.');
  for (const k of EMAIL_TEMPLATE_KEYS) if (JSON.stringify(prev.emails.modelos[k]) !== JSON.stringify(next.emails.modelos[k])) out.push(`Modelo de e-mail “${EMAIL_TEMPLATE_LABELS[k]}” alterado.`);
  return out.length ? out : ['Nenhuma diferença em relação à versão ativa.'];
}

/** Substitui {{variaveis}}; valores ausentes viram vazio. */
export function renderTemplate(tpl: string, vars: Record<string, string | number | null | undefined>) {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => String(vars[k] ?? ''));
}
