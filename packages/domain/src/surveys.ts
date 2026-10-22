/**
 * Funcionalidade 02 — Pesquisas por link. Construtor versionado, convites individuais e destino das respostas.
 * REGRA: o poder de influência NUNCA é destino de pesquisa (ADR-056). Posicionamento e dados de contato só mudam
 * depois de revisão humana; NPS/CSAT entram no registro de pesquisas do Sucesso do Cliente.
 */
export const QUESTION_TYPES = ['nps', 'csat', 'escala', 'escolha', 'multipla', 'sim_nao', 'texto'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = { nps: 'NPS (0 a 10)', csat: 'Satisfação (1 a 5)', escala: 'Escala (1 a 5)', escolha: 'Escolha única', multipla: 'Múltipla escolha', sim_nao: 'Sim ou não', texto: 'Texto livre' };

/** Onde a resposta pode ir. Influência não está (nem pode estar) aqui. */
export const SURVEY_DESTINATIONS = ['nenhum', 'cs_nps', 'cs_csat', 'stakeholder_interesse', 'stakeholder_posicionamento', 'pessoa_email', 'pessoa_telefone'] as const;
export type SurveyDestination = (typeof SURVEY_DESTINATIONS)[number];
export const SURVEY_DESTINATION_LABELS: Record<SurveyDestination, string> = {
  nenhum: 'Só guardar a resposta', cs_nps: 'NPS da conta (Sucesso do Cliente)', cs_csat: 'Satisfação (CSAT) da conta', stakeholder_interesse: 'Interesse da pessoa',
  stakeholder_posicionamento: 'Posicionamento da pessoa', pessoa_email: 'E-mail da pessoa', pessoa_telefone: 'Telefone da pessoa',
};
/** Destinos que sempre passam por revisão humana antes de mudar o cadastro. */
export const REVIEW_ONLY: SurveyDestination[] = ['stakeholder_posicionamento', 'pessoa_email', 'pessoa_telefone'];
const DEST_TYPES: Record<SurveyDestination, QuestionType[]> = {
  nenhum: [...QUESTION_TYPES], cs_nps: ['nps'], cs_csat: ['csat'], stakeholder_interesse: ['escolha'], stakeholder_posicionamento: ['escolha'], pessoa_email: ['texto'], pessoa_telefone: ['texto'],
};
/** Valores aceitos para destinos de escolha (a opção precisa apontar para um deles). */
export const DEST_VALUES: Partial<Record<SurveyDestination, readonly string[]>> = {
  stakeholder_interesse: ['alto', 'medio', 'baixo'],
  stakeholder_posicionamento: ['defensor', 'favoravel', 'neutro', 'resistente', 'opositor'],
};

export type SurveyOption = { key: string; label: string; maps?: string | null };
export type SurveyQuestion = { key: string; type: QuestionType; text: string; required: boolean; options?: SurveyOption[]; destination: SurveyDestination; mode: 'automatica' | 'pendente' };
export type SurveyDefinition = { title: string; intro: string; thanks: string; questions: SurveyQuestion[] };

/** Erros do construtor (vazio = válido). Qualquer tentativa de destino ligado à influência é recusada. */
export function validateSurvey(d: SurveyDefinition) {
  const e: string[] = [];
  if (d.title.trim().length < 3) e.push('Dê um título à pesquisa.');
  if (!d.questions.length) e.push('Inclua pelo menos uma pergunta.');
  if (d.questions.length > 40) e.push('Uma pesquisa tem no máximo 40 perguntas.');
  const keys = new Set<string>();
  const used = new Set<string>();
  d.questions.forEach((q, i) => {
    const n = `Pergunta ${i + 1}`;
    if (/influ/i.test(String(q.destination))) { e.push(`${n}: o poder de influência é sempre avaliado pela equipe e não pode vir de pesquisa.`); return; }
    if (!(SURVEY_DESTINATIONS as readonly string[]).includes(q.destination)) e.push(`${n}: destino inválido.`);
    if (q.text.trim().length < 3) e.push(`${n}: escreva a pergunta.`);
    if (keys.has(q.key)) e.push(`${n}: identificador repetido.`);
    keys.add(q.key);
    if ((q.type === 'escolha' || q.type === 'multipla') && (q.options?.length ?? 0) < 2) e.push(`${n}: inclua pelo menos duas opções.`);
    const okTypes = DEST_TYPES[q.destination] ?? [];
    if (!okTypes.includes(q.type)) e.push(`${n}: "${SURVEY_DESTINATION_LABELS[q.destination] ?? q.destination}" só aceita pergunta do tipo ${okTypes.map((t) => QUESTION_TYPE_LABELS[t]).join(' ou ')}.`);
    const vals = DEST_VALUES[q.destination];
    if (vals && q.options?.some((o) => o.maps && !vals.includes(o.maps))) e.push(`${n}: opção ligada a um valor inválido.`);
    if (vals && !q.options?.some((o) => o.maps)) e.push(`${n}: diga a que valor cada opção corresponde.`);
    if (q.destination !== 'nenhum') { if (used.has(q.destination)) e.push(`${n}: outra pergunta já usa este destino.`); used.add(q.destination); }
    if (REVIEW_ONLY.includes(q.destination) && q.mode === 'automatica') e.push(`${n}: "${SURVEY_DESTINATION_LABELS[q.destination]}" sempre passa por revisão antes de mudar o cadastro.`);
  });
  return e;
}

export type AnswerValue = number | string | string[] | boolean | null;
/** Valida as respostas contra a versão da pesquisa; devolve erros por pergunta. */
export function answerErrors(d: SurveyDefinition, answers: Record<string, AnswerValue>) {
  const e: Record<string, string> = {};
  for (const q of d.questions) {
    const v = answers[q.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) { if (q.required) e[q.key] = 'Responda esta pergunta.'; continue; }
    const opts = (q.options ?? []).map((o) => o.key);
    const ok = q.type === 'nps' ? Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10
      : q.type === 'csat' || q.type === 'escala' ? Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5
      : q.type === 'escolha' ? typeof v === 'string' && opts.includes(v)
      : q.type === 'multipla' ? Array.isArray(v) && v.every((x) => opts.includes(x))
      : q.type === 'sim_nao' ? typeof v === 'boolean'
      : typeof v === 'string' && v.length <= 4000;
    if (!ok) e[q.key] = 'Resposta inválida.';
  }
  return e;
}

/** O que cada resposta faz no cadastro: valor final por destino (nunca influência). */
export function updatesFrom(d: SurveyDefinition, answers: Record<string, AnswerValue>) {
  const out: { questionKey: string; destination: Exclude<SurveyDestination, 'nenhum'>; value: string | number; mode: 'automatica' | 'pendente' }[] = [];
  for (const q of d.questions) {
    if (q.destination === 'nenhum') continue;
    const v = answers[q.key];
    if (v === undefined || v === null || v === '') continue;
    const mode = REVIEW_ONLY.includes(q.destination) ? 'pendente' : q.mode;
    if (q.destination === 'cs_nps' || q.destination === 'cs_csat') out.push({ questionKey: q.key, destination: q.destination, value: v as number, mode });
    else if (DEST_VALUES[q.destination]) { const m = q.options?.find((o) => o.key === v)?.maps; if (m) out.push({ questionKey: q.key, destination: q.destination, value: m, mode }); }
    else if (typeof v === 'string' && v.trim()) out.push({ questionKey: q.key, destination: q.destination, value: v.trim(), mode });
  }
  return out;
}

/** NPS = % promotores (9–10) − % detratores (0–6). */
export function npsOf(scores: number[]) {
  if (!scores.length) return null;
  const p = scores.filter((s) => s >= 9).length, d = scores.filter((s) => s <= 6).length;
  return Math.round(((p - d) / scores.length) * 100);
}
export const npsGroup = (s: number) => (s >= 9 ? 'promotor' : s >= 7 ? 'neutro' : 'detrator');
export type InviteStatus = 'enviado' | 'aberto' | 'respondido' | 'expirado' | 'cancelado';
export const INVITE_STATUS_LABELS: Record<InviteStatus, string> = { enviado: 'Enviado', aberto: 'Aberto', respondido: 'Respondido', expirado: 'Expirado', cancelado: 'Cancelado' };
export function inviteStatus(i: { respondedAt: unknown; canceledAt: unknown; expiresAt: Date | string; openedAt: unknown }, now = new Date()): InviteStatus {
  if (i.respondedAt) return 'respondido';
  if (i.canceledAt) return 'cancelado';
  if (new Date(i.expiresAt) <= now) return 'expirado';
  return i.openedAt ? 'aberto' : 'enviado';
}

/** Modelo inicial sugerido no construtor. */
export const SURVEY_STARTER: SurveyDefinition = {
  title: 'Como está a nossa parceria?', intro: 'São 3 perguntas rápidas. Suas respostas ajudam a melhorar o serviço.', thanks: 'Obrigado! Sua resposta foi registrada.',
  questions: [
    { key: 'nps', type: 'nps', text: 'De 0 a 10, quanto você recomendaria nossos serviços a um colega?', required: true, destination: 'cs_nps', mode: 'automatica' },
    { key: 'csat', type: 'csat', text: 'Qual a sua satisfação com o atendimento nos últimos meses?', required: false, destination: 'cs_csat', mode: 'automatica' },
    { key: 'comentario', type: 'texto', text: 'O que podemos melhorar?', required: false, destination: 'nenhum', mode: 'automatica' },
  ],
};
