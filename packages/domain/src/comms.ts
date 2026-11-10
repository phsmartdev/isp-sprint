/**
 * Esteira de comunicação de contratos: um FLUXO desenhado pela empresa (gatilho → esperas → envios → condições →
 * tarefas → fim), ligado por setas. Todo envio passa por APROVAÇÃO antes de sair (decisão de 05/11/2026), seja
 * para o cliente, atores externos ou equipe interna. Sem esteiras prontas: a empresa monta as suas.
 */

export const COMM_TRIGGERS = ['renovacao', 'reajuste', 'garantia', 'encerramento', 'validacao'] as const;
export type CommTrigger = (typeof COMM_TRIGGERS)[number];
export const COMM_TRIGGER_LABELS: Record<CommTrigger, string> = {
  renovacao: 'Término da vigência (renovação)',
  reajuste: 'Data-base do reajuste',
  garantia: 'Vencimento da garantia',
  encerramento: 'Encerramento previsto',
  validacao: 'Contrato validado (início da implantação)',
};
/** A data que ancora a esteira em cada contrato. */
export const COMM_TRIGGER_ANCHOR: Record<CommTrigger, string> = {
  renovacao: 'data de término da vigência', reajuste: 'próxima data-base do reajuste', garantia: 'data de vencimento da garantia',
  encerramento: 'data prevista de encerramento', validacao: 'data da validação do cadastro',
};

export const COMM_NODE_TYPES = ['gatilho', 'espera', 'envio', 'condicao', 'tarefa', 'fim'] as const;
export type CommNodeType = (typeof COMM_NODE_TYPES)[number];
export const COMM_NODE_LABELS: Record<CommNodeType, string> = { gatilho: 'Gatilho', espera: 'Espera', envio: 'Enviar comunicação', condicao: 'Condição', tarefa: 'Criar tarefa', fim: 'Fim' };

export const COMM_CHANNELS = ['email', 'whatsapp'] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];

/** Quem recebe: papéis do Playbook, responsáveis do contrato, cliente, atores externos ou e-mail fixo. */
export const COMM_RECIPIENT_KINDS = ['papel', 'responsavel', 'cliente', 'ator', 'email'] as const;
export type CommRecipientKind = (typeof COMM_RECIPIENT_KINDS)[number];
export const CONTRACT_OWNERS = ['comercial', 'administrativo', 'operacional', 'csm'] as const;
export type ContractOwner = (typeof CONTRACT_OWNERS)[number];
export const CONTRACT_OWNER_LABELS: Record<ContractOwner, string> = { comercial: 'Responsável comercial', administrativo: 'Responsável administrativo', operacional: 'Responsável operacional', csm: 'Sucesso do Cliente (CSM)' };
export type CommRecipient = { kind: CommRecipientKind; value: string };

export const COMM_CONDITIONS = ['confirmado', 'respondido', 'processo_concluido', 'renovado'] as const;
export type CommCondition = (typeof COMM_CONDITIONS)[number];
export const COMM_CONDITION_LABELS: Record<CommCondition, string> = {
  confirmado: 'O último e-mail foi aberto (ou o link acessado)?',
  respondido: 'O último envio foi respondido?',
  processo_concluido: 'O processo do contrato deste ciclo foi concluído?',
  renovado: 'O contrato já foi renovado neste ciclo?',
};

export type WaitMode = 'antes' | 'depois' | 'aguardar';
export type CommNodeData = {
  label?: string;
  // gatilho
  trigger?: CommTrigger;
  // espera
  mode?: WaitMode; days?: number;
  // envio
  channels?: CommChannel[]; templateId?: string | null; recipients?: CommRecipient[]; approverRole?: string | null; requireConfirmation?: boolean;
  // condição
  condition?: CommCondition;
  // tarefa
  taskTitle?: string; taskOwner?: ContractOwner; taskDays?: number;
};
export type CommNode = { id: string; type: CommNodeType; x: number; y: number; data: CommNodeData };
/** `handle` só existe na saída da condição: 'sim' ou 'nao'. */
export type CommEdge = { id: string; source: string; target: string; handle?: 'sim' | 'nao' | null };
export type CommGraph = { nodes: CommNode[]; edges: CommEdge[] };

export type GraphIssue = { nodeId: string | null; message: string };

/** Valida o desenho antes de publicar: um gatilho, tudo ligado, sem ciclo, cada passo completo. */
export function validateCommGraph(g: CommGraph): GraphIssue[] {
  const out: GraphIssue[] = [];
  const triggers = g.nodes.filter((n) => n.type === 'gatilho');
  if (triggers.length !== 1) out.push({ nodeId: null, message: 'A esteira precisa de exatamente um gatilho.' });
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) if (!ids.has(e.source) || !ids.has(e.target)) out.push({ nodeId: null, message: 'Há uma seta solta (sem passo numa das pontas).' });
  const outs = (id: string) => g.edges.filter((e) => e.source === id);
  const ins = (id: string) => g.edges.filter((e) => e.target === id);
  for (const n of g.nodes) {
    const name = n.data.label || COMM_NODE_LABELS[n.type];
    if (n.type === 'gatilho') {
      if (!n.data.trigger) out.push({ nodeId: n.id, message: 'Escolha o evento do gatilho.' });
      if (ins(n.id).length) out.push({ nodeId: n.id, message: 'Nada pode apontar para o gatilho.' });
    } else if (!ins(n.id).length) out.push({ nodeId: n.id, message: `"${name}" não está ligado a nenhum passo anterior.` });
    if (n.type === 'fim') { if (outs(n.id).length) out.push({ nodeId: n.id, message: 'O fim não tem saída.' }); continue; }
    if (n.type === 'condicao') {
      if (!n.data.condition) out.push({ nodeId: n.id, message: 'Escolha a pergunta da condição.' });
      const hs = outs(n.id).map((e) => e.handle);
      if (!hs.includes('sim') || !hs.includes('nao')) out.push({ nodeId: n.id, message: `"${name}" precisa de uma saída "sim" e uma "não".` });
    } else {
      if (outs(n.id).length !== 1) out.push({ nodeId: n.id, message: `"${name}" precisa de exatamente uma seta de saída.` });
    }
    if (n.type === 'espera') {
      if (!n.data.mode || !(Number.isInteger(n.data.days) && n.data.days! >= 0 && n.data.days! <= 730)) out.push({ nodeId: n.id, message: 'Espera: informe quantos dias (0 a 730) e se é antes/depois da data ou a partir do passo anterior.' });
    }
    if (n.type === 'envio') {
      if (!n.data.templateId) out.push({ nodeId: n.id, message: `"${name}": escolha o template.` });
      if (!n.data.channels?.length) out.push({ nodeId: n.id, message: `"${name}": escolha ao menos um canal.` });
      if (!n.data.recipients?.length) out.push({ nodeId: n.id, message: `"${name}": escolha quem recebe.` });
      if (!n.data.approverRole) out.push({ nodeId: n.id, message: `"${name}": escolha quem aprova o envio (todo envio passa por aprovação).` });
    }
    if (n.type === 'tarefa' && (!n.data.taskTitle?.trim() || !n.data.taskOwner)) out.push({ nodeId: n.id, message: 'Tarefa: informe o título e o responsável.' });
  }
  // ciclo (a esteira anda sempre para frente)
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const e of outs(id)) if (visit(e.target)) return true;
    state.set(id, 2);
    return false;
  };
  if (g.nodes.some((n) => visit(n.id))) out.push({ nodeId: null, message: 'A esteira tem um ciclo (uma seta volta a um passo anterior).' });
  // tudo alcançável a partir do gatilho
  if (triggers.length === 1) {
    const seen = new Set<string>([triggers[0]!.id]);
    const q = [triggers[0]!.id];
    while (q.length) { const id = q.shift()!; for (const e of outs(id)) if (!seen.has(e.target)) { seen.add(e.target); q.push(e.target); } }
    for (const n of g.nodes) if (!seen.has(n.id) && n.type !== 'gatilho') out.push({ nodeId: n.id, message: `"${n.data.label || COMM_NODE_LABELS[n.type]}" não é alcançado a partir do gatilho.` });
  }
  return out;
}

/** Próximo passo pela seta (na condição, pela resposta). */
export function nextNode(g: CommGraph, fromId: string, answer?: boolean): string | null {
  const es = g.edges.filter((e) => e.source === fromId);
  const e = answer === undefined ? es[0] : es.find((x) => x.handle === (answer ? 'sim' : 'nao'));
  return e?.target ?? null;
}

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Quando a espera termina: relativa à data do gatilho (antes/depois) ou ao término do passo anterior. */
export function waitUntil(mode: WaitMode, days: number, anchor: string, previousDoneAt: string): string {
  if (mode === 'antes') return addDaysIso(anchor, -days);
  if (mode === 'depois') return addDaysIso(anchor, days);
  return addDaysIso(previousDoneAt, days);
}

/** Maior antecedência de uma esteira (para saber quando começar a acompanhar um contrato). */
export function leadDays(g: CommGraph): number {
  return Math.max(0, ...g.nodes.filter((n) => n.type === 'espera' && n.data.mode === 'antes').map((n) => n.data.days ?? 0));
}

// ------------------------------------------------------------------ templates
export const COMM_VARIABLES = [
  ['cliente', 'Nome do cliente'], ['contrato', 'Número do contrato'], ['codigo', 'Código CT'], ['objeto', 'Objeto do contrato'],
  ['inicio_vigencia', 'Início da vigência'], ['fim_vigencia', 'Término da vigência'], ['dias_para_vencer', 'Dias para vencer'],
  ['valor_mensal', 'Valor mensal'], ['valor_global', 'Valor global'], ['indice_reajuste', 'Índice de reajuste'], ['data_base', 'Próxima data-base'],
  ['data_evento', 'Data do gatilho'], ['responsavel', 'Responsável comercial'], ['responsavel_administrativo', 'Responsável administrativo'],
  ['destinatario', 'Nome de quem recebe'], ['empresa', 'Nome da empresa'],
] as const;
export type CommVariable = (typeof COMM_VARIABLES)[number][0];
export const COMM_VARIABLE_KEYS = COMM_VARIABLES.map(([k]) => k) as readonly string[];

/** Variáveis {{chave}} usadas no texto que não existem. */
export function unknownVariables(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!COMM_VARIABLE_KEYS.includes(m[1]!) && m[1] !== 'botao_confirmacao' && m[1] !== 'link_resposta') out.add(m[1]!);
  return [...out];
}
/** Preenche {{chave}}; valor ausente vira traço (nunca inventa). */
export function renderComm(text: string, vars: Partial<Record<string, string | null | undefined>>, escapeHtml = false): string {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => { const v = vars[k]; const s = v == null || v === '' ? '—' : String(v); return escapeHtml ? esc(s) : s; });
}

/**
 * texto = texto formatado na moldura institucional · html = HTML da empresa ·
 * modelo = modelo genérico: cabeçalho e rodapé em imagem, assunto = nome do modelo (com variáveis), só o corpo é digitado.
 */
export const COMM_FORMATS = ['texto', 'html', 'modelo'] as const;
export const COMM_FORMAT_LABELS: Record<(typeof COMM_FORMATS)[number], string> = { texto: 'Texto formatado', html: 'HTML', modelo: 'Modelo com imagens' };
/** Limites da área do corpo no modelo com imagens (altura em px no e-mail de 600 px de largura). */
export const FRAME_HEIGHT = { min: 120, max: 1200, default: 320 } as const;
export type CommFormat = (typeof COMM_FORMATS)[number];
export type CommTemplateContent = { subject: string; body: string; whatsapp: string; format?: CommFormat };

/** HTML do template: tira o que não pode ir num e-mail (scripts, eventos, iframes, javascript:). */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}
export function templateIssues(c: CommTemplateContent, channels: readonly CommChannel[]): string[] {
  const out: string[] = [];
  if (channels.includes('email') && (!c.subject.trim() || !c.body.trim())) out.push('E-mail: informe assunto e corpo.');
  if (channels.includes('whatsapp') && !c.whatsapp.trim()) out.push('WhatsApp: informe a mensagem.');
  const unk = unknownVariables(`${c.subject}\n${c.body}\n${c.whatsapp}`);
  if (unk.length) out.push(`Variáveis inexistentes: ${unk.map((u) => `{{${u}}}`).join(', ')}.`);
  return out;
}

export const COMM_STEP_STATUSES = ['agendado', 'aguardando_aprovacao', 'enviado', 'rejeitado', 'concluido', 'falhou', 'cancelado'] as const;
export type CommStepStatus = (typeof COMM_STEP_STATUSES)[number];
export const COMM_STEP_STATUS_LABELS: Record<CommStepStatus, string> = {
  agendado: 'Agendado', aguardando_aprovacao: 'Aguardando aprovação', enviado: 'Enviado', rejeitado: 'Não aprovado', concluido: 'Concluído', falhou: 'Falhou', cancelado: 'Cancelado',
};
