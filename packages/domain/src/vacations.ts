/**
 * Gestão de Times → Férias. Regras puras (sem banco):
 * - período aquisitivo de 12 meses a partir da admissão; o gozo vai até o fim do período concessivo (12 meses seguintes);
 * - fracionamento conforme as configurações (quantidade de blocos, bloco principal mínimo, bloco mínimo);
 * - sem choque de gozo: duas pessoas que dividem um time não podem ter férias sobrepostas;
 * - sugestão automática: o mais urgente primeiro (fim do concessivo), no primeiro dia de início permitido sem choque.
 * Nenhum número de regra fica no código: tudo vem de VacationSettings (a empresa ajusta em Configurações).
 */

export type VacationSettings = {
  /** dias de férias por período aquisitivo */
  daysPerPeriod: number;
  /** em quantos blocos o período pode ser dividido */
  maxSplits: number;
  /** pelo menos um bloco com este mínimo de dias */
  minMainBlockDays: number;
  /** nenhum bloco abaixo deste mínimo */
  minBlockDays: number;
  /** aviso para a pessoa e a liderança, dias antes do início */
  alertDaysBefore: number;
  /** dias da semana em que as férias não podem começar (0 = domingo … 6 = sábado) */
  blockedStartWeekdays: number[];
  /** dia da semana preferido para a sugestão começar */
  preferredStartWeekday: number;
};

export const VACATION_STATUSES = ['sugerida', 'programada', 'cancelada'] as const;
export type VacationStatus = (typeof VACATION_STATUSES)[number];
export const VACATION_STATUS_LABELS: Record<VacationStatus, string> = { sugerida: 'Sugerida', programada: 'Programada', cancelada: 'Cancelada' };
export const VACATION_WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

export type Vacation = { id?: string; userId: string; startDate: string; days: number; periodStart: string; status: VacationStatus };

export function vacationSettingsErrors(s: VacationSettings): string[] {
  const e: string[] = [];
  const int = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!int(s.daysPerPeriod, 1, 60)) e.push('Dias por período: entre 1 e 60.');
  if (!int(s.maxSplits, 1, 6)) e.push('Quantidade de blocos: entre 1 e 6.');
  if (!int(s.minBlockDays, 1, 60)) e.push('Bloco mínimo inválido.');
  if (!int(s.minMainBlockDays, 1, 60) || s.minMainBlockDays < s.minBlockDays) e.push('O bloco principal deve ser maior ou igual ao bloco mínimo.');
  if (s.minMainBlockDays > s.daysPerPeriod) e.push('O bloco principal não cabe nos dias do período.');
  if (!int(s.alertDaysBefore, 0, 180)) e.push('Aviso: entre 0 e 180 dias antes.');
  if (!s.blockedStartWeekdays.every((d) => int(d, 0, 6)) || s.blockedStartWeekdays.length >= 7) e.push('Dias de início bloqueados inválidos.');
  if (!int(s.preferredStartWeekday, 0, 6) || s.blockedStartWeekdays.includes(s.preferredStartWeekday)) e.push('O dia preferido de início não pode estar bloqueado.');
  return e;
}

// ---------------------------------------------------------------- datas (ISO yyyy-mm-dd, sem fuso)
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const isoAddDays = (iso: string, n: number) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
export const addYears = (iso: string, n: number) => {
  const d = toDate(iso);
  const m = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + n);
  if (d.getUTCMonth() !== m) d.setUTCDate(0); // 29/02 → 28/02
  return toIso(d);
};
export const weekday = (iso: string) => toDate(iso).getUTCDay();
export const isoDaysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
/** último dia de gozo (inclusive) */
export const vacationEnd = (v: { startDate: string; days: number }) => isoAddDays(v.startDate, v.days - 1);
export const overlaps = (a: { startDate: string; days: number }, b: { startDate: string; days: number }) => a.startDate <= vacationEnd(b) && b.startDate <= vacationEnd(a);

export type AcquisitivePeriod = { start: string; end: string; concessiveEnd: string };
/** Períodos aquisitivos desde a admissão até o que contém a data limite. */
export function acquisitivePeriods(admission: string, until: string): AcquisitivePeriod[] {
  const out: AcquisitivePeriod[] = [];
  for (let k = 0; k < 80; k++) {
    const start = addYears(admission, k);
    if (start > until) break;
    const end = isoAddDays(addYears(admission, k + 1), -1);
    out.push({ start, end, concessiveEnd: isoAddDays(addYears(admission, k + 2), -1) });
  }
  return out;
}

const active = (v: Vacation) => v.status !== 'cancelada';

/** Saldo de dias de um período aquisitivo (descontadas as férias sugeridas e programadas). */
export function periodBalance(vacs: Vacation[], userId: string, periodStart: string, st: VacationSettings) {
  return st.daysPerPeriod - vacs.filter((v) => active(v) && v.userId === userId && v.periodStart === periodStart).reduce((t, v) => t + v.days, 0);
}

/** Colegas de time (quem divide pelo menos um time com a pessoa). */
export type TeamMap = Record<string, string[]>; // userId → teamIds
export const shareTeam = (teams: TeamMap, a: string, b: string) => a !== b && (teams[a] ?? []).some((t) => (teams[b] ?? []).includes(t));

export type VacationConflict = { userId: string; startDate: string; days: number };

/**
 * Valida uma férias (nova ou alterada) contra as regras. `others` = todas as férias da empresa (a própria, se já existe, é ignorada pelo id).
 * Devolve mensagens de erro e o choque (quem do time já está de férias no período).
 */
export function vacationErrors(v: Vacation, ctx: { others: Vacation[]; teams: TeamMap; admission: string | null; settings: VacationSettings; today: string; names?: Record<string, string> }) {
  const st = ctx.settings;
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.startDate) || Number.isNaN(toDate(v.startDate).getTime())) return { errors: ['Data de início inválida.'], conflicts: [] as VacationConflict[] };
  if (!Number.isInteger(v.days) || v.days < st.minBlockDays) errors.push(`Cada bloco de férias tem no mínimo ${st.minBlockDays} dias.`);
  if (st.blockedStartWeekdays.includes(weekday(v.startDate))) errors.push(`As férias não podem começar em ${st.blockedStartWeekdays.map((d) => VACATION_WEEKDAYS[d]).join(' ou ')}.`);
  const others = ctx.others.filter((o) => active(o) && (!v.id || o.id !== v.id));
  if (ctx.admission) {
    const p = acquisitivePeriods(ctx.admission, v.startDate).find((x) => x.start === v.periodStart);
    if (!p) errors.push('Período aquisitivo inválido para a admissão da pessoa.');
    else {
      if (v.startDate <= p.end) errors.push(`O período aquisitivo ${fmtBr(p.start)} a ${fmtBr(p.end)} ainda não terminou no início das férias.`);
      if (vacationEnd(v) > p.concessiveEnd) errors.push(`As férias passam do fim do período concessivo (${fmtBr(p.concessiveEnd)}).`);
    }
  }
  const same = others.filter((o) => o.userId === v.userId && o.periodStart === v.periodStart);
  const blocks = [...same.map((o) => o.days), v.days];
  const total = blocks.reduce((t, d) => t + d, 0);
  if (total > st.daysPerPeriod) errors.push(`O período tem ${st.daysPerPeriod} dias; já há ${total - v.days} dias marcados.`);
  if (blocks.length > st.maxSplits) errors.push(`O período pode ser dividido em até ${st.maxSplits} blocos.`);
  // o bloco principal: quando o período fecha (ou não cabe mais um bloco principal), um dos blocos precisa ter o mínimo
  const remaining = st.daysPerPeriod - total;
  const canStillHaveMain = remaining >= st.minMainBlockDays && blocks.length < st.maxSplits;
  if (!blocks.some((d) => d >= st.minMainBlockDays) && !canStillHaveMain) errors.push(`Um dos blocos precisa ter pelo menos ${st.minMainBlockDays} dias.`);
  if (others.some((o) => o.userId === v.userId && overlaps(o, v))) errors.push('A pessoa já tem férias nesse período.');
  const conflicts = others.filter((o) => shareTeam(ctx.teams, v.userId, o.userId) && overlaps(o, v)).map((o) => ({ userId: o.userId, startDate: o.startDate, days: o.days }));
  if (conflicts.length) errors.push(`Choque de férias no time: ${conflicts.map((c) => `${ctx.names?.[c.userId] ?? 'colega'} (${fmtBr(c.startDate)} a ${fmtBr(vacationEnd(c))})`).join('; ')}.`);
  return { errors, conflicts };
}

const fmtBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export type VacationSuggestion = { userId: string; periodStart: string; startDate: string; days: number; concessiveEnd: string } | { userId: string; periodStart: string; startDate: null; days: number; concessiveEnd: string; reason: string };

/**
 * Sugestão automática para quem tem saldo: um bloco com o saldo inteiro (ou o que couber nas regras), o mais urgente primeiro,
 * no primeiro dia preferido a partir de hoje + aviso, depois do aquisitivo, sem choque com o time e dentro do concessivo.
 */
export function suggestVacations(args: { people: { userId: string; admission: string }[]; existing: Vacation[]; teams: TeamMap; settings: VacationSettings; today: string; horizonDays?: number }): VacationSuggestion[] {
  const st = args.settings;
  const horizon = isoAddDays(args.today, args.horizonDays ?? 365);
  const placed: Vacation[] = args.existing.filter(active);
  const wants: { userId: string; period: AcquisitivePeriod; days: number }[] = [];
  for (const p of args.people) {
    for (const period of acquisitivePeriods(p.admission, horizon)) {
      if (period.concessiveEnd < args.today || period.end >= horizon) continue;
      const bal = periodBalance(placed, p.userId, period.start, st);
      const blocks = placed.filter((v) => v.userId === p.userId && v.periodStart === period.start).length;
      if (bal < st.minBlockDays || blocks >= st.maxSplits) continue;
      wants.push({ userId: p.userId, period, days: bal });
    }
  }
  wants.sort((a, b) => a.period.concessiveEnd.localeCompare(b.period.concessiveEnd) || a.userId.localeCompare(b.userId));
  const out: VacationSuggestion[] = [];
  for (const w of wants) {
    // primeiro com a antecedência do aviso; se o concessivo não deixar, o quanto antes (a partir de amanhã)
    const search = (from: string) => {
      let d = [from, isoAddDays(w.period.end, 1)].sort().at(-1)!;
      while (weekday(d) !== st.preferredStartWeekday) d = isoAddDays(d, 1);
      for (; d <= w.period.concessiveEnd; d = isoAddDays(d, 7)) {
        const cand = { startDate: d, days: w.days };
        if (vacationEnd(cand) > w.period.concessiveEnd) return null;
        if (placed.some((o) => (o.userId === w.userId || shareTeam(args.teams, w.userId, o.userId)) && overlaps(o, cand))) continue;
        return d;
      }
      return null;
    };
    const found = search(isoAddDays(args.today, st.alertDaysBefore)) ?? search(isoAddDays(args.today, 1));
    if (found) {
      const v: Vacation = { userId: w.userId, periodStart: w.period.start, startDate: found, days: w.days, status: 'sugerida' };
      placed.push(v);
      out.push({ userId: w.userId, periodStart: w.period.start, startDate: found, days: w.days, concessiveEnd: w.period.concessiveEnd });
    } else {
      out.push({ userId: w.userId, periodStart: w.period.start, startDate: null, days: w.days, concessiveEnd: w.period.concessiveEnd, reason: `Sem janela livre no time até ${fmtBr(w.period.concessiveEnd)} (fim do concessivo).` });
    }
  }
  return out;
}

/** Férias que pedem o aviso agora: começam dentro do prazo de aviso e ainda não avisadas. */
export const vacationNeedsAlert = (v: { startDate: string; status: VacationStatus; alertedAt: string | Date | null }, today: string, st: VacationSettings) =>
  v.status === 'programada' && !v.alertedAt && v.startDate >= today && isoDaysBetween(today, v.startDate) <= st.alertDaysBefore;
