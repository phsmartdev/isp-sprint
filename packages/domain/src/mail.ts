/**
 * E-mail corporativo (Gmail / Google Workspace) dentro do CRM: caixas pessoais e compartilhadas, conversas ligadas
 * às contas, regras de entrada, filas com direcionamento e prazo de primeira resposta. Funções puras.
 */

export const MAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'] as const;

export const MAILBOX_KINDS = ['pessoal', 'compartilhada'] as const;
export type MailboxKind = (typeof MAILBOX_KINDS)[number];
export const MAILBOX_KIND_LABELS: Record<MailboxKind, string> = { pessoal: 'Pessoal', compartilhada: 'Compartilhada' };
export const MAILBOX_STATUSES = ['desconectada', 'conectada', 'erro', 'pausada'] as const;
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];
export const MAILBOX_STATUS_LABELS: Record<MailboxStatus, string> = { desconectada: 'Não conectada', conectada: 'Conectada', erro: 'Com erro', pausada: 'Pausada' };

export const THREAD_STATUSES = ['nova', 'em_atendimento', 'aguardando_cliente', 'resolvida', 'arquivada'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export const THREAD_STATUS_LABELS: Record<ThreadStatus, string> = { nova: 'Nova', em_atendimento: 'Em atendimento', aguardando_cliente: 'Aguardando cliente', resolvida: 'Resolvida', arquivada: 'Arquivada' };
export const OPEN_THREAD: ThreadStatus[] = ['nova', 'em_atendimento', 'aguardando_cliente'];

export const MAIL_PRIORITIES = ['alta', 'normal', 'baixa'] as const;
export type MailPriority = (typeof MAIL_PRIORITIES)[number];
export const MAIL_PRIORITY_LABELS: Record<MailPriority, string> = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };

export const ROUTING_MODES = ['manual', 'rodizio', 'carteira'] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];
export const ROUTING_MODE_LABELS: Record<RoutingMode, string> = {
  manual: 'Manual (alguém da fila assume)',
  rodizio: 'Rodízio entre os membros (quem tem menos conversas abertas primeiro)',
  carteira: 'Responsável pela conta (se for da fila); senão, rodízio',
};

// ------------------------------------------------------------------ endereços

export type Address = { name: string | null; email: string };
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
export const isEmail = (v: string) => EMAIL_RE.test(v.trim());
export const domainOf = (email: string) => (email.split('@')[1] ?? '').toLowerCase();

/** Lê um cabeçalho From/To/Cc ("Nome <a@b.com>, c@d.com"). Ignora o que não for e-mail. */
export function parseAddresses(header: string | null | undefined): Address[] {
  if (!header) return [];
  const out: Address[] = [];
  // separa por vírgula fora de aspas
  const parts: string[] = [];
  let cur = '', q = false;
  for (const ch of header) {
    if (ch === '"') q = !q;
    if (ch === ',' && !q) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(/^(.*)<([^>]+)>\s*$/);
    const email = (m ? m[2]! : p).trim().toLowerCase();
    if (!isEmail(email)) continue;
    const name = m ? m[1]!.trim().replace(/^"|"$/g, '').trim() || null : null;
    out.push({ name, email });
  }
  return out;
}

/** Domínios permitidos para conectar caixas (vazio = nenhum: a empresa precisa dizer quais são os seus). */
export function domainAllowed(email: string, domains: string[]) {
  const d = domainOf(email);
  return !!d && domains.map((x) => x.trim().toLowerCase().replace(/^@/, '')).includes(d);
}

export function mailSettingsErrors(s: { allowedDomains: string[]; syncDays: number }) {
  const e: string[] = [];
  if (!s.allowedDomains.length) e.push('Informe pelo menos um domínio da empresa (ex.: yepnet.com.br).');
  for (const d of s.allowedDomains) if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d.trim().toLowerCase().replace(/^@/, ''))) e.push(`Domínio inválido: ${d}`);
  if (!Number.isInteger(s.syncDays) || s.syncDays < 1 || s.syncDays > 90) e.push('A primeira sincronização busca de 1 a 90 dias.');
  return e;
}

// ------------------------------------------------------------------ regras de entrada

export const RULE_FIELDS = ['de', 'dominio', 'para', 'assunto', 'texto'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export const RULE_FIELD_LABELS: Record<RuleField, string> = { de: 'Remetente', dominio: 'Domínio do remetente', para: 'Destinatário', assunto: 'Assunto', texto: 'Texto da mensagem' };
export const RULE_OPS = ['contem', 'igual', 'termina_com', 'nao_contem'] as const;
export type RuleOp = (typeof RULE_OPS)[number];
export const RULE_OP_LABELS: Record<RuleOp, string> = { contem: 'contém', igual: 'é igual a', termina_com: 'termina com', nao_contem: 'não contém' };

export type RuleCondition = { field: RuleField; op: RuleOp; value: string };
export type RuleActions = { queueId?: string | null; assignTo?: string | null; priority?: MailPriority | null; tag?: string | null; ignore?: boolean };
export type MailRuleDef = { match: 'todas' | 'qualquer'; conditions: RuleCondition[]; actions: RuleActions };
export type MailRule = { id: string; name: string; position: number; active: boolean; mailboxId: string | null; def: MailRuleDef };
export type IncomingFacts = { from: string; to: string[]; subject: string; text: string; mailboxId: string };

export function ruleErrors(r: { name: string; def: MailRuleDef }) {
  const e: string[] = [];
  if (r.name.trim().length < 3) e.push('Dê um nome à regra.');
  if (!r.def.conditions.length) e.push('Inclua pelo menos uma condição.');
  if (r.def.conditions.length > 10) e.push('Use no máximo 10 condições.');
  for (const c of r.def.conditions) if (!c.value.trim()) e.push(`Preencha o valor da condição "${RULE_FIELD_LABELS[c.field]}".`);
  const a = r.def.actions;
  if (!a.ignore && !a.queueId && !a.assignTo && !a.priority && !a.tag) e.push('Escolha pelo menos uma ação (fila, pessoa, prioridade, etiqueta ou ignorar).');
  if (a.ignore && (a.queueId || a.assignTo)) e.push('Uma regra que ignora a mensagem não pode direcionar para fila ou pessoa.');
  if (a.tag && a.tag.trim().length > 40) e.push('A etiqueta tem no máximo 40 caracteres.');
  return e;
}

function condMatches(c: RuleCondition, f: IncomingFacts) {
  const v = c.value.trim().toLowerCase();
  const subjects: string[] =
    c.field === 'de' ? [f.from] : c.field === 'dominio' ? [domainOf(f.from)] : c.field === 'para' ? f.to : c.field === 'assunto' ? [f.subject] : [f.text];
  const vals = subjects.map((x) => (x ?? '').toLowerCase());
  const val = c.field === 'dominio' ? v.replace(/^@/, '') : v;
  switch (c.op) {
    case 'contem': return vals.some((x) => x.includes(val));
    case 'nao_contem': return vals.every((x) => !x.includes(val));
    case 'igual': return vals.some((x) => x === val);
    case 'termina_com': return vals.some((x) => x.endsWith(val));
  }
}

/** Primeira regra ativa (na ordem) que casa vence. Regras de outra caixa não valem. */
export function evaluateRules(rules: MailRule[], f: IncomingFacts): { rule: MailRule; actions: RuleActions } | null {
  const sorted = [...rules].filter((r) => r.active && (!r.mailboxId || r.mailboxId === f.mailboxId)).sort((a, b) => a.position - b.position);
  for (const r of sorted) {
    const hits = r.def.conditions.map((c) => condMatches(c, f));
    if (r.def.match === 'todas' ? hits.every(Boolean) : hits.some(Boolean)) return { rule: r, actions: r.def.actions };
  }
  return null;
}

// ------------------------------------------------------------------ direcionamento

/**
 * Quem recebe a conversa. Rodízio = membro com menos conversas abertas; empate decide quem recebeu há mais tempo
 * (e depois a ordem da fila). Carteira = responsável pela conta, se estiver na fila.
 */
export function pickAssignee(q: { mode: RoutingMode; members: string[]; openLoad: Record<string, number>; lastAssignedAt: Record<string, string | null>; accountOwnerId: string | null; available?: string[] }) {
  const pool = q.members.filter((m) => !q.available || q.available.includes(m));
  if (q.mode === 'manual' || !pool.length) return null;
  if (q.mode === 'carteira' && q.accountOwnerId && pool.includes(q.accountOwnerId)) return q.accountOwnerId;
  return [...pool].sort((a, b) => (q.openLoad[a] ?? 0) - (q.openLoad[b] ?? 0) || (q.lastAssignedAt[a] ?? '').localeCompare(q.lastAssignedAt[b] ?? '') || pool.indexOf(a) - pool.indexOf(b))[0]!;
}

export function queueErrors(q: { name: string; mode: RoutingMode; members: string[]; slaHours: number }) {
  const e: string[] = [];
  if (q.name.trim().length < 3) e.push('Dê um nome à fila (ex.: Comercial empresarial).');
  if (!q.members.length) e.push('Inclua pelo menos uma pessoa na fila.');
  if (!Number.isInteger(q.slaHours) || q.slaHours < 1 || q.slaHours > 720) e.push('O prazo de primeira resposta vai de 1 a 720 horas.');
  return e;
}

// ------------------------------------------------------------------ prazo de primeira resposta

export type SlaState = 'sem_prazo' | 'no_prazo' | 'vencendo' | 'vencido' | 'respondida_no_prazo' | 'respondida_fora';
export const SLA_LABELS: Record<SlaState, string> = { sem_prazo: 'Sem prazo', no_prazo: 'No prazo', vencendo: 'Vence em breve', vencido: 'Prazo vencido', respondida_no_prazo: 'Respondida no prazo', respondida_fora: 'Respondida fora do prazo' };

/** "Vence em breve" = últimos 20% do prazo. Horas corridas. */
export function slaState(t: { firstInboundAt: string | null; firstReplyAt: string | null; slaHours: number | null }, now: string): { state: SlaState; dueAt: string | null } {
  if (!t.firstInboundAt || !t.slaHours) return { state: 'sem_prazo', dueAt: null };
  const start = Date.parse(t.firstInboundAt);
  const due = start + t.slaHours * 3_600_000;
  const dueAt = new Date(due).toISOString();
  if (t.firstReplyAt) return { state: Date.parse(t.firstReplyAt) <= due ? 'respondida_no_prazo' : 'respondida_fora', dueAt };
  const n = Date.parse(now);
  if (n > due) return { state: 'vencido', dueAt };
  return { state: due - n <= t.slaHours * 3_600_000 * 0.2 ? 'vencendo' : 'no_prazo', dueAt };
}

// ------------------------------------------------------------------ estados da conversa

/** Nova mensagem muda o estado: cliente escreveu → volta para atendimento; nós respondemos → aguardando cliente. */
export function statusAfterMessage(cur: ThreadStatus, direction: 'entrada' | 'saida', hasAssignee: boolean): ThreadStatus {
  if (direction === 'saida') return cur === 'arquivada' ? cur : cur === 'resolvida' ? 'resolvida' : 'aguardando_cliente';
  if (cur === 'nova') return 'nova';
  return hasAssignee ? 'em_atendimento' : 'nova';
}

export function threadTransitionError(from: ThreadStatus, to: ThreadStatus) {
  if (from === to) return 'A conversa já está nessa situação.';
  if (to === 'nova') return 'Uma conversa só volta a "nova" quando chega mensagem do cliente.';
  return null;
}

/** Endereços externos da conversa (fora dos domínios da empresa), para ligar à conta certa. */
export function externalParticipants(addresses: string[], companyDomains: string[]) {
  const own = companyDomains.map((d) => d.toLowerCase().replace(/^@/, ''));
  return [...new Set(addresses.map((a) => a.toLowerCase()))].filter((a) => isEmail(a) && !own.includes(domainOf(a)));
}

/** Escolha automática da conta: só quando todos os endereços conhecidos apontam para a mesma conta. */
export function autoLinkContact(matches: { email: string; contactId: string }[]): { contactId: string | null; ambiguous: boolean } {
  const ids = [...new Set(matches.map((m) => m.contactId))];
  if (ids.length === 1) return { contactId: ids[0]!, ambiguous: false };
  return { contactId: null, ambiguous: ids.length > 1 };
}

/** Assunto de resposta (sem repetir "Re:"). */
export const replySubject = (s: string) => (/^\s*re\s*:/i.test(s) ? s.trim() : `Re: ${s.trim() || '(sem assunto)'}`);

// ------------------------------------------------------------------ pastas com regra de armazenamento
export type FolderDef = { match: 'todas' | 'qualquer'; conditions: RuleCondition[] };
export type MailFolder = { id: string; mailboxId: string; position: number; active: boolean; def: FolderDef };

/** As condições batem com a mensagem? (mesma leitura das regras de entrada) */
export function conditionsMatch(def: FolderDef, f: IncomingFacts) {
  if (!def.conditions.length) return false;
  const hits = def.conditions.map((c) => condMatches(c, f));
  return def.match === 'todas' ? hits.every(Boolean) : hits.some(Boolean);
}

/** Primeira pasta ativa da caixa (na ordem) cuja regra bate; pasta sem condição só recebe à mão. */
export function folderFor(folders: MailFolder[], f: IncomingFacts): MailFolder | null {
  return [...folders].filter((x) => x.active && x.mailboxId === f.mailboxId).sort((a, b) => a.position - b.position).find((x) => conditionsMatch(x.def, f)) ?? null;
}

export function folderErrors(x: { name: string; def: FolderDef }) {
  const e: string[] = [];
  if (x.name.trim().length < 2) e.push('Dê um nome à pasta.');
  if (x.name.trim().length > 60) e.push('Nome da pasta com até 60 caracteres.');
  for (const c of x.def.conditions) if (!c.value.trim()) e.push('Preencha o valor de cada condição.');
  return e;
}
