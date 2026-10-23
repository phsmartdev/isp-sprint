/**
 * Chamados no GLPI 11 (API de alto nível, /api.php, OAuth 2.0). Regras puras: situação, validação do chamado,
 * leitura da linha do tempo e do webhook. Rotas conferidas no código-fonte do GLPI 11.0
 * (src/Glpi/Api/HL/Controller/ITILController.php e src/Webhook.php).
 */

/** Situação do chamado no GLPI (Ticket::getAllStatusArray). */
export const GLPI_STATUS_LABELS: Record<number, string> = {
  1: 'Novo', 2: 'Em atendimento (atribuído)', 3: 'Em atendimento (planejado)', 4: 'Pendente', 5: 'Solucionado', 6: 'Fechado',
};
export const glpiStatusLabel = (n: number | null | undefined) => (n ? GLPI_STATUS_LABELS[n] ?? `Situação ${n}` : '—');
export const glpiOpen = (n: number | null | undefined) => !n || n < 5;

/** Tipo do chamado (Ticket::INCIDENT_TYPE = 1, Ticket::DEMAND_TYPE = 2). */
export const GLPI_TYPES = [1, 2] as const;
export const GLPI_TYPE_LABELS: Record<number, string> = { 1: 'Incidente', 2: 'Requisição' };
export const GLPI_URGENCY_LABELS: Record<number, string> = { 1: 'Muito baixa', 2: 'Baixa', 3: 'Média', 4: 'Alta', 5: 'Muito alta' };

/** Itens da linha do tempo que trazemos de volta. */
export const GLPI_TIMELINE_KINDS = ['Followup', 'Task', 'Solution', 'Document', 'Validation'] as const;
export type GlpiTimelineKind = (typeof GLPI_TIMELINE_KINDS)[number] | 'Status';
export const GLPI_KIND_LABELS: Record<GlpiTimelineKind, string> = {
  Followup: 'Acompanhamento', Task: 'Tarefa', Solution: 'Solução', Document: 'Documento', Validation: 'Validação', Status: 'Situação',
};

export type GlpiTicketInput = { entityId: number | null; title: string; content: string; type: number; urgency: number; categoryId?: number | null; groupId?: number | null };
export function glpiTicketErrors(t: GlpiTicketInput) {
  const e: { path: string; message: string }[] = [];
  if (t.entityId == null || !Number.isInteger(t.entityId) || t.entityId < 0) e.push({ path: 'entityId', message: 'Escolha a entidade do cliente no GLPI.' });
  if (t.title.trim().length < 5) e.push({ path: 'title', message: 'Título com pelo menos 5 caracteres.' });
  if (t.content.trim().length < 10) e.push({ path: 'content', message: 'Descreva o pedido (mínimo de 10 caracteres).' });
  if (!(GLPI_TYPES as readonly number[]).includes(t.type)) e.push({ path: 'type', message: 'Tipo inválido.' });
  if (!Number.isInteger(t.urgency) || t.urgency < 1 || t.urgency > 5) e.push({ path: 'urgency', message: 'Urgência de 1 a 5.' });
  return e;
}

/** HTML do GLPI → texto legível (sem marcação), para mostrar e guardar no histórico. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Texto digitado no CRM → HTML simples para o GLPI (escapa e quebra linhas). */
/**
 * Cabeçalhos que identificam, no GLPI, o que foi enviado pela integração e quem do comercial fez (pedidos do Paulo, 23/10).
 * No GLPI tudo fica em nome do usuário de integração; o nome real vai no cabeçalho.
 */
export const glpiTicketHeader = (name: string) => `Ticket gerado a partir do RevOps por ${name}:`;
export const glpiReplyHeader = (name: string) => `Resposta enviada pelo RevOps por ${name}:`;
export const glpiValidationHeader = (approved: boolean, name: string) => `${approved ? 'Aprovado' : 'Recusado'} no RevOps por ${name}`;
const escHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Corpo enviado ao GLPI: cabeçalho em destaque e, abaixo, o texto escrito na ferramenta. */
export const glpiBody = (header: string, text: string) => `<p><strong>${escHtml(header)}</strong></p>${text.trim() ? textToHtml(text) : ''}`;

export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return esc.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

type Ref = { id?: number | null; name?: string | null } | null | undefined;
export type GlpiTimelineEntry = { kind: GlpiTimelineKind; externalId: string; author: string | null; text: string; isPrivate: boolean; occurredAt: string | null; validationId?: number; validationStatus?: number };

/** Validação (aprovação) do GLPI 11: status 1 nenhuma, 2 aguardando, 3 aceita, 4 recusada (esquema TicketValidation da API). */
export const GLPI_VALIDATION_LABELS: Record<number, string> = { 1: 'Sem aprovação', 2: 'Aguardando aprovação', 3: 'Aprovada', 4: 'Recusada' };
export const GLPI_VALIDATION_DECISIONS = ['aprovar', 'recusar'] as const;
export type GlpiValidationDecision = (typeof GLPI_VALIDATION_DECISIONS)[number];
/** Recusar exige motivo (o GLPI também pede); aprovar aceita comentário opcional. */
export function glpiValidationError(decision: GlpiValidationDecision, comment: string | null | undefined): string | null {
  if (decision === 'recusar' && (comment ?? '').trim().length < 5) return 'Diga o motivo da recusa (mínimo de 5 caracteres).';
  return null;
}
/** Situação atual de cada validação = a última leitura dela (cada mudança de situação vira um registro novo). */
export function pendingValidations<T extends { validationId?: number | null; validationStatus?: number | null; occurredAt: string }>(events: T[]): T[] {
  const last = new Map<number, T>();
  for (const e of events) if (e.validationId != null) { const cur = last.get(e.validationId); if (!cur || cur.occurredAt <= e.occurredAt) last.set(e.validationId, e); }
  return [...last.values()].filter((e) => e.validationStatus === 2);
}

const refName = (r: Ref) => (r && typeof r === 'object' ? (r.name ?? null) : null);

/** Normaliza a resposta de GET /Assistance/Ticket/{id}/Timeline ([{ type, item }]). Itens desconhecidos são ignorados. */
export function parseTimeline(raw: unknown): GlpiTimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GlpiTimelineEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const type = (row as { type?: unknown }).type;
    const item = (row as { item?: unknown }).item as Record<string, unknown> | undefined;
    if (typeof type !== 'string' || !(GLPI_TIMELINE_KINDS as readonly string[]).includes(type) || !item || item.id == null) continue;
    const kind = type as GlpiTimelineKind;
    if (kind === 'Validation') {
      const st = typeof item.status === 'number' ? item.status : Number(item.status ?? 0);
      const decided = st === 3 || st === 4;
      const comment = htmlToText(String((decided ? item.approval_comment : item.submission_comment) ?? ''));
      const who = decided ? refName(item.approver as Ref) : refName(item.requester as Ref);
      const at = (decided ? item.approval_date ?? item.date_mod : item.submission_date ?? item.date_creation) as string | null;
      // a validação muda de situação no mesmo item: cada situação vira um registro (append-only) com id próprio
      out.push({ kind, externalId: `Validation:${item.id}:${st}`, author: who, text: comment.slice(0, 20_000), isPrivate: false, occurredAt: at ?? null, validationId: Number(item.id), validationStatus: st });
      continue;
    }
    const text = kind === 'Document' ? String(item.filename ?? item.name ?? 'Documento anexado') : htmlToText(String(item.content ?? item.comment ?? ''));
    const author = refName(item.user as Ref) ?? refName(item.user_tech as Ref) ?? refName(item.user_editor as Ref);
    const at = (item.date ?? item.date_creation ?? item.date_mod ?? null) as string | null;
    out.push({ kind, externalId: `${kind}:${item.id}`, author, text: text.slice(0, 20_000), isPrivate: item.is_private === true || item.is_private === 1, occurredAt: at });
  }
  return out.sort((a, b) => (a.occurredAt ?? '').localeCompare(b.occurredAt ?? ''));
}

/**
 * Webhook do GLPI (corpo padrão: { event, item, parent_item? }). Devolve o id do chamado afetado,
 * seja o próprio chamado, seja um item da linha do tempo dele (acompanhamento, solução, tarefa, validação).
 * Acompanhamento e solução de mudança/problema (itemtype ≠ Ticket) são ignorados.
 */
export function webhookTicketId(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { item?: Record<string, unknown> };
  const it = p.item ?? {};
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
  if ('itemtype' in it) return it.itemtype === 'Ticket' ? num(it.items_id) : null;
  if (num(it.tickets_id)) return num(it.tickets_id);
  if (it.status && typeof it.status === 'object' && num(it.id)) return num(it.id); // o próprio chamado
  return null;
}

/** Endereço do chamado na interface do GLPI. */
export const glpiTicketUrl = (baseUrl: string, id: number) => `${baseUrl.replace(/\/+$/, '')}/front/ticket.form.php?id=${id}`;
