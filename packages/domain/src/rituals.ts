/**
 * Gestão de Times — Fase 8: rituais de gestão, reuniões (atas), decisões e impedimentos.
 * Ritual = reunião recorrente de uma perspectiva sobre um escopo (empresa, unidade ou time). Cada ocorrência vira uma reunião
 * com pauta automática (metas fora da faixa, intervenções, impedimentos, decisões a acompanhar) e ata travada ao finalizar.
 */

export type RitualCadence = 'diaria' | 'semanal' | 'quinzenal' | 'mensal';
export const RITUAL_CADENCE_LABELS: Record<RitualCadence, string> = { diaria: 'Diária (dias úteis)', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' };
export type RitualPerspective = 'diretoria' | 'gestao' | 'lideranca';
export const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;

/** Modelos sugeridos por perspectiva (o usuário ajusta nome, cadência e pauta). */
export const RITUAL_TEMPLATES: { key: string; perspective: RitualPerspective; name: string; cadence: RitualCadence; weekday: number; monthDay: number; time: string; durationMin: number; agenda: string[] }[] = [
  { key: 'diretoria_mensal', perspective: 'diretoria', name: 'Reunião mensal de resultados', cadence: 'mensal', weekday: 1, monthDay: 5, time: '09:00', durationMin: 120, agenda: ['Resultado do mês e semáforo', 'Intervenções necessárias', 'Decisões estratégicas', 'Riscos e oportunidades'] },
  { key: 'gestao_semanal', perspective: 'gestao', name: 'Reunião semanal de gestão', cadence: 'semanal', weekday: 1, monthDay: 1, time: '09:00', durationMin: 60, agenda: ['Metas da semana', 'Planos de ação em andamento', 'Impedimentos', 'Decisões'] },
  { key: 'lideranca_checkin', perspective: 'lideranca', name: 'Check-in da equipe', cadence: 'semanal', weekday: 1, monthDay: 1, time: '08:30', durationMin: 30, agenda: ['O que entregamos', 'O que vamos entregar', 'O que está travando'] },
  { key: 'lideranca_diaria', perspective: 'lideranca', name: 'Reunião diária da equipe', cadence: 'diaria', weekday: 1, monthDay: 1, time: '08:30', durationMin: 15, agenda: ['Prioridades do dia', 'Impedimentos'] },
];

const d2 = (n: number) => String(n).padStart(2, '0');
const parse = (iso: string) => new Date(`${iso}T12:00:00Z`);
const fmt = (d: Date) => `${d.getUTCFullYear()}-${d2(d.getUTCMonth() + 1)}-${d2(d.getUTCDate())}`;
const addDays = (iso: string, n: number) => { const d = parse(iso); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const weeksBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / (7 * 86_400_000));

/**
 * Próximas datas do ritual a partir de `from` (inclusive), no máximo `count`.
 * Quinzenal alterna a partir da semana de início (`anchor`); mensal usa o dia do mês (meses curtos caem no último dia).
 */
export function nextOccurrences(r: { cadence: RitualCadence; weekday: number; monthDay: number; anchor: string }, from: string, count: number): string[] {
  const out: string[] = [];
  const start = from < r.anchor ? r.anchor : from;
  if (r.cadence === 'mensal') {
    let d = parse(start);
    for (let k = 0; out.length < count && k < 24; k++) {
      const y = d.getUTCFullYear(); const m = d.getUTCMonth();
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const iso = `${y}-${d2(m + 1)}-${d2(Math.min(r.monthDay, last))}`;
      if (iso >= start) out.push(iso);
      d = new Date(Date.UTC(y, m + 1, 1, 12));
    }
    return out;
  }
  let cur = start;
  for (let k = 0; out.length < count && k < 400; k++, cur = addDays(cur, 1)) {
    const wd = parse(cur).getUTCDay();
    if (r.cadence === 'diaria') { if (wd >= 1 && wd <= 5) out.push(cur); continue; }
    if (wd !== r.weekday) continue;
    if (r.cadence === 'quinzenal' && weeksBetween(r.anchor, cur) % 2 !== 0) continue;
    out.push(cur);
  }
  return out;
}

export function validateRitual(r: { name: string; cadence: RitualCadence; weekday: number; monthDay: number; time: string; durationMin: number; agenda: string[]; participants: string[] }) {
  const e: { path: string; message: string }[] = [];
  if (r.name.trim().length < 3) e.push({ path: 'name', message: 'Dê um nome ao ritual.' });
  if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) e.push({ path: 'weekday', message: 'Dia da semana inválido.' });
  if (!Number.isInteger(r.monthDay) || r.monthDay < 1 || r.monthDay > 31) e.push({ path: 'monthDay', message: 'Dia do mês entre 1 e 31.' });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) e.push({ path: 'time', message: 'Horário no formato HH:MM.' });
  if (!Number.isInteger(r.durationMin) || r.durationMin < 5 || r.durationMin > 480) e.push({ path: 'durationMin', message: 'Duração entre 5 e 480 minutos.' });
  if (!r.agenda.some((a) => a.trim())) e.push({ path: 'agenda', message: 'Inclua pelo menos um item de pauta.' });
  if (!r.participants.length) e.push({ path: 'participants', message: 'Inclua os participantes.' });
  return e;
}

// ---------------------------------------------------------------- impedimentos
export type ImpedimentStatus = 'aberto' | 'em_tratamento' | 'removido' | 'aceito';
export const IMPEDIMENT_STATUS_LABELS: Record<ImpedimentStatus, string> = { aberto: 'Aberto', em_tratamento: 'Em tratamento', removido: 'Removido', aceito: 'Aceito (convivemos)' };
export const OPEN_IMPEDIMENT: ImpedimentStatus[] = ['aberto', 'em_tratamento'];
export const IMPEDIMENT_SEVERITY_LABELS = { alta: 'Alta', media: 'Média', baixa: 'Baixa' } as const;
const IMP_FLOW: Record<ImpedimentStatus, ImpedimentStatus[]> = { aberto: ['em_tratamento', 'removido', 'aceito'], em_tratamento: ['aberto', 'removido', 'aceito'], removido: ['aberto'], aceito: ['aberto'] };
/** Transição permitida; encerrar (removido/aceito) exige registro de como foi resolvido. */
export function impedimentTransition(from: ImpedimentStatus, to: ImpedimentStatus, resolution: string | null | undefined) {
  if (from === to) return null;
  if (!IMP_FLOW[from].includes(to)) return `Não dá para passar de "${IMPEDIMENT_STATUS_LABELS[from]}" para "${IMPEDIMENT_STATUS_LABELS[to]}".`;
  if ((to === 'removido' || to === 'aceito') && (resolution ?? '').trim().length < 10) return to === 'removido' ? 'Diga como o impedimento foi removido.' : 'Diga por que o impedimento foi aceito e como o time convive com ele.';
  return null;
}

/** Duração da reunião em texto curto. */
export const durationLabel = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? d2(min % 60) : ''}`);
