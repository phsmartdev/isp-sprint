/**
 * Central de Playbooks: conteúdo em blocos, público (corporativo, compartilhado, restrito), versões imutáveis,
 * aprovação Gerência → Diretoria, revisão periódica, ciência por versão e comparação de versões.
 * Funções puras; o servidor é quem autoriza.
 */

// ------------------------------------------------------------------ blocos
export const BLOCK_TYPES = ['heading', 'text', 'callout', 'steps', 'checklist', 'table', 'faq', 'image', 'video', 'pdf', 'file', 'link', 'feature', 'flow', 'decision', 'divider'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: 'Título de seção', text: 'Texto', callout: 'Bloco de destaque', steps: 'Etapas numeradas', checklist: 'Checklist', table: 'Tabela', faq: 'Perguntas frequentes',
  image: 'Imagem', video: 'Vídeo', pdf: 'PDF', file: 'Arquivo para download', link: 'Link', feature: 'Link para tela do ISP Sprint', flow: 'Fluxograma', decision: 'Árvore de decisão', divider: 'Separador',
};
export const CALLOUT_KINDS = ['atencao', 'importante', 'exemplo', 'dica'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
export const CALLOUT_LABELS: Record<CalloutKind, string> = { atencao: 'Atenção', importante: 'Importante', exemplo: 'Exemplo prático', dica: 'Dica' };

export type FlowNode = { id: string; kind: 'inicio' | 'etapa' | 'decisao' | 'fim'; label: string; guidance?: string; x: number; y: number };
export type FlowEdge = { id: string; from: string; to: string; label?: string };
export type DecisionNode = { id: string; question: string; options: { label: string; next: string | null; result?: string }[] };

export type Block =
  | { id: string; type: 'heading'; text: string; level: 1 | 2 }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'callout'; kind: CalloutKind; title?: string; text: string }
  | { id: string; type: 'steps'; items: { title: string; text?: string }[] }
  | { id: string; type: 'checklist'; mode: 'aprendizagem' | 'operacional'; title?: string; items: { id: string; text: string }[] }
  | { id: string; type: 'table'; rows: string[][]; header: boolean }
  | { id: string; type: 'faq'; items: { q: string; a: string }[] }
  | { id: string; type: 'image' | 'pdf' | 'file'; fileId: string; name: string; caption?: string }
  | { id: string; type: 'video'; url: string; caption?: string }
  | { id: string; type: 'link'; url: string; label: string }
  | { id: string; type: 'feature'; path: string; label: string }
  | { id: string; type: 'flow'; title?: string; nodes: FlowNode[]; edges: FlowEdge[] }
  | { id: string; type: 'decision'; title?: string; start: string; nodes: DecisionNode[] }
  | { id: string; type: 'divider' };
export type PlaybookContent = { blocks: Block[] };

/** Telas do ISP Sprint que podem ser apontadas por um bloco (só caminhos internos). */
export const FEATURE_PATH = /^\/[a-z0-9\-/?=&_.%]*$/i;
/** Vídeo só de fontes conhecidas (incorporado com segurança). */
export function videoEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname)) { const v = u.searchParams.get('v'); return v && /^[\w-]{6,20}$/.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null; }
    if (u.hostname === 'youtu.be') { const v = u.pathname.slice(1); return /^[\w-]{6,20}$/.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null; }
    if (/(^|\.)vimeo\.com$/.test(u.hostname)) { const v = u.pathname.split('/').filter(Boolean).pop() ?? ''; return /^\d{5,12}$/.test(v) ? `https://player.vimeo.com/video/${v}` : null; }
  } catch { /* url inválida */ }
  return null;
}
const httpUrl = (s: string) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };

/** Integridade do conteúdo (servidor e editor): ids únicos, campos obrigatórios, links seguros, fluxos coerentes. */
export function contentErrors(c: PlaybookContent): string[] {
  const e: string[] = [];
  if (!Array.isArray(c?.blocks)) return ['Conteúdo inválido.'];
  if (c.blocks.length > 400) e.push('No máximo 400 blocos.');
  const ids = new Set<string>();
  c.blocks.forEach((b, i) => {
    const at = `Bloco ${i + 1}`;
    if (!b?.id || ids.has(b.id)) e.push(`${at}: identificador repetido.`);
    ids.add(b?.id);
    if (!BLOCK_TYPES.includes(b?.type)) { e.push(`${at}: tipo desconhecido.`); return; }
    switch (b.type) {
      case 'heading': if (!b.text?.trim()) e.push(`${at}: título vazio.`); break;
      case 'text': case 'callout': if (!b.text?.trim()) e.push(`${at}: texto vazio.`); if (b.text?.length > 20_000) e.push(`${at}: texto muito longo.`); break;
      case 'steps': if (!b.items?.length || b.items.some((x) => !x.title?.trim())) e.push(`${at}: cada etapa precisa de título.`); break;
      case 'checklist': if (!b.items?.length || b.items.some((x) => !x.text?.trim() || !x.id)) e.push(`${at}: itens do checklist vazios.`); break;
      case 'table': if (!b.rows?.length || b.rows.length > 200 || b.rows.some((r) => r.length > 12)) e.push(`${at}: tabela inválida.`); break;
      case 'faq': if (!b.items?.length || b.items.some((x) => !x.q?.trim() || !x.a?.trim())) e.push(`${at}: pergunta ou resposta vazia.`); break;
      case 'image': case 'pdf': case 'file': if (!b.fileId) e.push(`${at}: envie o arquivo.`); break;
      case 'video': if (!videoEmbed(b.url ?? '')) e.push(`${at}: use um link do YouTube ou Vimeo.`); break;
      case 'link': if (!httpUrl(b.url ?? '') || !b.label?.trim()) e.push(`${at}: link inválido.`); break;
      case 'feature': if (!FEATURE_PATH.test(b.path ?? '') || !b.label?.trim()) e.push(`${at}: tela do sistema inválida.`); break;
      case 'flow': {
        const nids = new Set(b.nodes?.map((n) => n.id));
        if (!b.nodes?.some((n) => n.kind === 'inicio')) e.push(`${at}: o fluxograma precisa de um início.`);
        if (!b.nodes?.some((n) => n.kind === 'fim')) e.push(`${at}: o fluxograma precisa de um fim.`);
        if (b.edges?.some((x) => !nids.has(x.from) || !nids.has(x.to))) e.push(`${at}: ligação para etapa que não existe.`);
        if (b.nodes?.some((n) => !n.label?.trim())) e.push(`${at}: etapa sem nome.`);
        break;
      }
      case 'decision': {
        const nids = new Set(b.nodes?.map((n) => n.id));
        if (!nids.has(b.start)) e.push(`${at}: a árvore precisa de uma pergunta inicial.`);
        if (b.nodes?.some((n) => !n.question?.trim() || !n.options?.length || n.options.some((o) => !o.label?.trim() || (o.next !== null && !nids.has(o.next)) || (o.next === null && !o.result?.trim())))) e.push(`${at}: cada opção leva a outra pergunta ou a um resultado.`);
        break;
      }
    }
  });
  return e;
}

/** Seções (títulos de nível 1) para o índice e a jornada guiada. */
export function sectionsOf(c: PlaybookContent) {
  const out: { id: string; title: string; start: number; end: number }[] = [];
  c.blocks.forEach((b, i) => {
    if (b.type === 'heading' && b.level === 1) { if (out.length) out[out.length - 1]!.end = i; out.push({ id: b.id, title: b.text, start: i, end: c.blocks.length }); }
  });
  return out;
}

/** Texto do conteúdo para a busca. */
export function contentText(c: PlaybookContent): string {
  const t: string[] = [];
  for (const b of c.blocks) {
    if ('text' in b && typeof b.text === 'string') t.push(b.text);
    if ('title' in b && typeof b.title === 'string') t.push(b.title);
    if (b.type === 'steps') b.items.forEach((x) => t.push(x.title, x.text ?? ''));
    if (b.type === 'checklist') b.items.forEach((x) => t.push(x.text));
    if (b.type === 'faq') b.items.forEach((x) => t.push(x.q, x.a));
    if (b.type === 'table') b.rows.forEach((r) => t.push(r.join(' ')));
    if (b.type === 'flow') b.nodes.forEach((n) => t.push(n.label, n.guidance ?? ''));
    if (b.type === 'decision') b.nodes.forEach((n) => t.push(n.question, ...n.options.map((o) => `${o.label} ${o.result ?? ''}`)));
    if (b.type === 'link' || b.type === 'feature') t.push(b.label);
  }
  // sem marcação de formatação (negrito, itálico, links) para a busca achar o texto como se lê
  return t.filter(Boolean).join('\n').replace(/\*\*|__|\*|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').slice(0, 200_000);
}

// ------------------------------------------------------------------ público e acesso
export const VISIBILITIES = ['corporativo', 'compartilhado', 'restrito'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = { corporativo: 'Corporativo', compartilhado: 'Compartilhado', restrito: 'Restrito' };
export type Audience = { visibility: Visibility; teamIds: string[]; costCenterIds: string[]; profiles: string[]; userIds: string[] };
export type Viewer = { userId: string; teamIds: string[]; costCenterIds: string[]; profiles: string[] };

/**
 * Quem vê a versão vigente: corporativo = todos; compartilhado = quem é de um time ou centro escolhido (ou foi incluído nominalmente);
 * restrito = só perfis ou pessoas escolhidos. Regra explícita: lista vazia não libera ninguém.
 */
export function audienceAllows(a: Audience, v: Viewer): boolean {
  if (a.visibility === 'corporativo') return true;
  if (a.userIds.includes(v.userId)) return true;
  if (a.visibility === 'compartilhado') return a.teamIds.some((t) => v.teamIds.includes(t)) || a.costCenterIds.some((c) => v.costCenterIds.includes(c));
  return a.profiles.some((p) => v.profiles.includes(p));
}
export function audienceErrors(a: Audience): string[] {
  if (a.visibility === 'compartilhado' && !a.teamIds.length && !a.costCenterIds.length && !a.userIds.length) return ['Compartilhado: escolha ao menos um time ou centro de custo.'];
  if (a.visibility === 'restrito' && !a.profiles.length && !a.userIds.length) return ['Restrito: escolha os perfis ou as pessoas autorizadas.'];
  return [];
}

// ------------------------------------------------------------------ versões
export const VERSION_STATUSES = ['rascunho', 'revisao_gerencia', 'homologacao_diretoria', 'aprovada', 'vigente', 'encerrada', 'rejeitada', 'descartada'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  rascunho: 'Rascunho', revisao_gerencia: 'Revisão da Gerência', homologacao_diretoria: 'Homologação da Diretoria', aprovada: 'Aprovada (vigência programada)',
  vigente: 'Vigente', encerrada: 'Encerrada', rejeitada: 'Rejeitada', descartada: 'Descartada',
};
/** Próxima versão: menor (2.3 → 2.4) ou maior quando a mudança é relevante (2.3 → 3.0). Sem versão publicada: 1.0. */
export function nextVersion(current: string | null, relevant: boolean): string {
  if (!current) return '1.0';
  const [maj, min] = current.split('.').map(Number) as [number, number];
  return relevant ? `${maj + 1}.0` : `${maj}.${min + 1}`;
}
/** Código: padrão configurável com {CAT} (prefixo da categoria) e {NUM} (sequência com 3 dígitos). */
export function playbookCode(pattern: string, catPrefix: string, seq: number) {
  return pattern.replace('{CAT}', catPrefix.toUpperCase()).replace('{NUM}', String(seq).padStart(3, '0'));
}

/** Alçadas: quem precisa aprovar (configurável por categoria e criticidade; padrão Gerência e Diretoria). */
export type PlaybookApprovalPolicy = { gerencia: boolean; diretoria: boolean };
export function approvalStagesFor(policy: PlaybookApprovalPolicy, criticality: 'baixa' | 'media' | 'alta'): ('gerencia' | 'diretoria')[] {
  const st: ('gerencia' | 'diretoria')[] = [];
  if (policy.gerencia || criticality === 'alta') st.push('gerencia');
  if (policy.diretoria || criticality === 'alta' || !st.length) st.push('diretoria');
  return st;
}

// ------------------------------------------------------------------ revisão periódica
export const REVIEW_PERIODS = ['mensal', 'trimestral', 'semestral', 'anual', 'personalizada'] as const;
export type ReviewPeriod = (typeof REVIEW_PERIODS)[number];
export const REVIEW_PERIOD_LABELS: Record<ReviewPeriod, string> = { mensal: 'Mensal', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual', personalizada: 'Personalizada' };
const PERIOD_MONTHS: Record<Exclude<ReviewPeriod, 'personalizada'>, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
function addMonthsPb(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function nextReview(from: string, period: ReviewPeriod, customDays: number | null) {
  if (period === 'personalizada') return new Date(Date.parse(`${from}T12:00:00Z`) + (customDays ?? 90) * 86_400_000).toISOString().slice(0, 10);
  return addMonthsPb(from, PERIOD_MONTHS[period]);
}
export const REVIEW_STATES = ['em_dia', 'proxima', 'vencida', 'em_revisao', 'aguardando_aprovacao'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = { em_dia: 'Revisão em dia', proxima: 'Revisão próxima', vencida: 'Revisão vencida', em_revisao: 'Em revisão', aguardando_aprovacao: 'Aguardando aprovação' };
export function reviewState(nextReviewOn: string | null, today: string, draft: VersionStatus | null, nearDays = 30): ReviewState {
  if (draft === 'revisao_gerencia' || draft === 'homologacao_diretoria' || draft === 'aprovada') return 'aguardando_aprovacao';
  if (draft === 'rascunho') return 'em_revisao';
  if (!nextReviewOn) return 'em_dia';
  if (nextReviewOn < today) return 'vencida';
  const days = Math.round((Date.parse(`${nextReviewOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return days <= nearDays ? 'proxima' : 'em_dia';
}
/** Alertas devidos hoje (dias antes do vencimento configurados; 0 = no dia). */
export function reviewAlertsDue(nextReviewOn: string | null, today: string, alertDays: number[]): number[] {
  if (!nextReviewOn) return [];
  const days = Math.round((Date.parse(`${nextReviewOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return alertDays.filter((d) => days <= d).sort((a, b) => a - b).slice(0, 1);
}

// ------------------------------------------------------------------ comparação de versões
export type BlockDiff = { id: string; type: BlockType; change: 'adicionado' | 'removido' | 'alterado' | 'igual'; before: Block | null; after: Block | null; words?: { text: string; op: 'eq' | 'add' | 'del' }[] };
const blockText = (b: Block) => contentText({ blocks: [b] });
/** Diferença de palavras (LCS, limitada para textos grandes). */
export function wordDiff(a: string, b: string): { text: string; op: 'eq' | 'add' | 'del' }[] {
  const x = a.split(/(\s+)/).filter(Boolean), y = b.split(/(\s+)/).filter(Boolean);
  if (x.length * y.length > 400_000) return [{ text: a, op: 'del' }, { text: b, op: 'add' }];
  const m = x.length, n = y.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { text: string; op: 'eq' | 'add' | 'del' }[] = [];
  const push = (text: string, op: 'eq' | 'add' | 'del') => { const l = out[out.length - 1]; if (l && l.op === op) l.text += text; else out.push({ text, op }); };
  let i = 0, j = 0;
  while (i < m && j < n) { if (x[i] === y[j]) { push(x[i]!, 'eq'); i++; j++; } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { push(x[i]!, 'del'); i++; } else { push(y[j]!, 'add'); j++; } }
  while (i < m) push(x[i++]!, 'del');
  while (j < n) push(y[j++]!, 'add');
  return out;
}
/** Comparação bloco a bloco (pelo identificador do bloco), na ordem da versão nova, com removidos no fim. */
export function diffContent(before: PlaybookContent | null, after: PlaybookContent): BlockDiff[] {
  const old = new Map((before?.blocks ?? []).map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: BlockDiff[] = after.blocks.map((b) => {
    const o = old.get(b.id); seen.add(b.id);
    if (!o) return { id: b.id, type: b.type, change: 'adicionado' as const, before: null, after: b };
    const same = JSON.stringify(o) === JSON.stringify(b);
    return { id: b.id, type: b.type, change: same ? 'igual' as const : 'alterado' as const, before: o, after: b, ...(same ? {} : { words: wordDiff(blockText(o), blockText(b)) }) };
  });
  for (const b of before?.blocks ?? []) if (!seen.has(b.id)) out.push({ id: b.id, type: b.type, change: 'removido', before: b, after: null });
  return out;
}

// ------------------------------------------------------------------ sugestões
export const SUGGESTION_STATUSES = ['recebida', 'em_analise', 'aceita', 'rejeitada', 'incorporada'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = { recebida: 'Recebida', em_analise: 'Em análise', aceita: 'Aceita', rejeitada: 'Rejeitada', incorporada: 'Incorporada em nova versão' };

export const PLAYBOOK_TYPES = ['procedimento', 'comercial', 'atendimento', 'politica', 'checklist', 'fluxo_aprovacao', 'treinamento', 'integracao', 'jornada'] as const;
export type PlaybookType = (typeof PLAYBOOK_TYPES)[number];
export const PLAYBOOK_TYPE_LABELS: Record<PlaybookType, string> = {
  procedimento: 'Procedimento operacional padrão', comercial: 'Playbook comercial', atendimento: 'Manual de atendimento', politica: 'Política interna',
  checklist: 'Checklist operacional', fluxo_aprovacao: 'Fluxo de aprovação', treinamento: 'Treinamento interno', integracao: 'Guia de integração de colaboradores', jornada: 'Jornada guiada',
};

/** Categorias iniciais (a liderança autorizada cria e muda as demais sem código). */
export const DEFAULT_PLAYBOOK_CATEGORIES = [
  { name: 'Comercial e Vendas', prefix: 'COM', icon: 'briefcase', description: 'Prospecção, propostas, negociação e fechamento.' },
  { name: 'Marketing e Comunicação', prefix: 'MKT', icon: 'megaphone', description: 'Campanhas, marca, peças e publicação.' },
  { name: 'Atendimento ao Cliente', prefix: 'ATD', icon: 'headset', description: 'Relacionamento, suporte e sucesso do cliente.' },
  { name: 'Operações e Redes', prefix: 'OPR', icon: 'network', description: 'Implantação, ativação e manutenção da rede.' },
  { name: 'Financeiro', prefix: 'FIN', icon: 'wallet', description: 'Faturamento, cobrança e pagamentos.' },
  { name: 'Administrativo', prefix: 'ADM', icon: 'building', description: 'Compras, fornecedores e rotinas administrativas.' },
  { name: 'Gestão de Pessoas', prefix: 'GPE', icon: 'users', description: 'Integração, férias, desenvolvimento e rotinas do time.' },
  { name: 'Contratos e Projetos', prefix: 'CTP', icon: 'file', description: 'Cadastro, renovação, faturamento e encerramento; metodologia de projetos.' },
  { name: 'Governança e Compliance', prefix: 'GOV', icon: 'shield', description: 'Políticas, alçadas, auditoria e conformidade.' },
] as const;
