/**
 * Dados Planejados: chamados do GLPI atribuídos aos grupos (ou às pessoas) do Comercial, com o prazo do SLA de cada um.
 * Aqui ficam as regras puras: situação do chamado (no prazo, a vencer, atrasado), cumprimento do SLA e quais avisos
 * já deveriam ter saído (a régua). O envio, a leitura do GLPI e o registro dos avisos ficam no servidor.
 */

export type SlaSettings = {
  /** meta do nível de serviço, em % (resolvidos no prazo ÷ resolvidos) */
  goalPct: number;
  /** horário comercial: avisos só saem dentro dele (menos o escalonamento) */
  businessStart: number; businessEnd: number; businessDays: number[];
  /** avisos antes do prazo, em horas (ex.: [4, 1]) */
  warnHours: number[];
  /** sem responsável há X minutos: avisa o líder do grupo, e repete a cada hora */
  unassignedMinutes: number;
  /** depois de vencido, repete a cada X horas */
  repeatLateHours: number;
  /** X horas depois de vencido, avisa a gestão */
  escalateAfterHours: number;
  /** hora do resumo diário */
  digestHour: number;
  email: boolean; whatsapp: boolean;
  /**
   * SLA que conta o nível de serviço: "universal" = o mesmo prazo para todos os grupos (abaixo), "glpi" = o SLA de cada
   * chamado no GLPI (sem SLA lá, vale o universal).
   */
  slaSource: 'universal' | 'glpi';
  /** SLA universal: horas para solucionar e para assumir, contadas desde a abertura */
  solveHours: number;
  ownHours: number;
  /** contar só as horas do horário comercial (horas úteis) */
  businessHoursOnly: boolean;
};

export const DEFAULT_SLA_SETTINGS: SlaSettings = {
  goalPct: 95, businessStart: 8, businessEnd: 18, businessDays: [1, 2, 3, 4, 5], warnHours: [4, 1], unassignedMinutes: 60,
  repeatLateHours: 2, escalateAfterHours: 4, digestHour: 8, email: true, whatsapp: true,
  slaSource: 'universal', solveHours: 24, ownHours: 4, businessHoursOnly: true,
};


export type SlaTicket = {
  status: number | null;
  openedAt: Date;
  /** prazo para solucionar (SLA/OLA do GLPI) */
  dueSolveAt: Date | null;
  /** prazo para assumir (atender) */
  dueOwnAt: Date | null;
  takenAt: Date | null;
  solvedAt: Date | null;
  /** pessoas atribuídas no GLPI (ids do GLPI) */
  assignedUserIds: number[];
};

export type Situation = 'atrasado' | 'a_vencer' | 'no_prazo' | 'sem_prazo' | 'resolvido_no_prazo' | 'resolvido_fora' | 'resolvido_sem_prazo';
export const SITUATION_LABELS: Record<Situation, string> = {
  atrasado: 'Atrasado', a_vencer: 'A vencer', no_prazo: 'No prazo', sem_prazo: 'Sem prazo',
  resolvido_no_prazo: 'Resolvido no prazo', resolvido_fora: 'Resolvido fora do prazo', resolvido_sem_prazo: 'Resolvido (sem prazo)',
};

const H = 3_600_000;
export const isOpenStatus = (status: number | null) => status === null || status < 5;

type DueSettings = Pick<SlaSettings, 'slaSource' | 'solveHours' | 'ownHours' | 'businessHoursOnly' | 'businessStart' | 'businessEnd' | 'businessDays'>;

/** Soma horas a partir de uma data; em horas úteis, só conta o horário comercial (no fuso da empresa). */
export function addSlaHours(from: Date, hours: number, tz: string, s: Pick<SlaSettings, 'businessHoursOnly' | 'businessStart' | 'businessEnd' | 'businessDays'>): Date {
  if (!s.businessHoursOnly) return new Date(from.getTime() + hours * H);
  let left = hours * 60; // minutos
  let cur = new Date(from.getTime());
  cur.setUTCSeconds(0, 0);
  // anda de 15 em 15 minutos pelo horário comercial (limite de 2 anos para não travar com configuração vazia)
  for (let i = 0; left > 0 && i < 70_000; i++) {
    if (inBusinessHours(cur, tz, s)) left -= 15;
    cur = new Date(cur.getTime() + 15 * 60_000);
  }
  return cur;
}

/** Prazo para solucionar que conta o nível de serviço: o universal, ou o do GLPI (sem SLA lá, o universal). */
export function ticketDue(t: Pick<SlaTicket, 'dueSolveAt' | 'openedAt'>, s: DueSettings, tz = 'America/Sao_Paulo'): Date | null {
  if (s.slaSource === 'glpi' && t.dueSolveAt) return t.dueSolveAt;
  return s.solveHours > 0 ? addSlaHours(t.openedAt, s.solveHours, tz, s) : null;
}

/** Prazo para assumir (atender): o universal, ou o do GLPI. */
export function ticketOwnDue(t: Pick<SlaTicket, 'dueOwnAt' | 'openedAt'>, s: DueSettings, tz = 'America/Sao_Paulo'): Date | null {
  if (s.slaSource === 'glpi' && t.dueOwnAt) return t.dueOwnAt;
  return s.ownHours > 0 ? addSlaHours(t.openedAt, s.ownHours, tz, s) : null;
}

/** Situação do chamado agora. "A vencer" = prazo nas próximas 24 h. */
export function ticketSituation(t: SlaTicket, now: Date, s: DueSettings, tz = 'America/Sao_Paulo'): Situation {
  const due = ticketDue(t, s, tz);
  if (!isOpenStatus(t.status)) {
    if (!due) return 'resolvido_sem_prazo';
    const done = t.solvedAt ?? now;
    return done.getTime() <= due.getTime() ? 'resolvido_no_prazo' : 'resolvido_fora';
  }
  if (!due) return 'sem_prazo';
  const left = due.getTime() - now.getTime();
  if (left < 0) return 'atrasado';
  return left <= 24 * H ? 'a_vencer' : 'no_prazo';
}

/** Nível de serviço: resolvidos no prazo ÷ resolvidos com prazo, em %. Null quando nada com prazo foi resolvido. */
export function serviceLevel(situations: Situation[]): number | null {
  const ok = situations.filter((x) => x === 'resolvido_no_prazo').length;
  const all = ok + situations.filter((x) => x === 'resolvido_fora').length;
  return all ? Math.round((ok / all) * 1000) / 10 : null;
}

/** Tempo até o prazo, por extenso e curto: "venceu há 1 d 3 h", "vence em 2 h 10". */
export function dueText(due: Date | null, now: Date): string {
  if (!due) return 'sem prazo';
  const diff = due.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const d = Math.floor(abs / (24 * H)), h = Math.floor((abs % (24 * H)) / H), m = Math.floor((abs % H) / 60_000);
  const span = d ? `${d} d${h ? ` ${h} h` : ''}` : h ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${Math.max(1, m)} min`;
  return diff < 0 ? `venceu há ${span}` : `vence em ${span}`;
}

/** Partes da data no fuso da empresa (dia da semana 0 = domingo, hora 0–23). */
const fmts = new Map<string, Intl.DateTimeFormat>();
export function localParts(d: Date, tz: string) {
  let f = fmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }); fmts.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!);
  return { weekday: wd, hour: Number(p.hour) % 24, date: `${p.year}-${p.month}-${p.day}` };
}

export function inBusinessHours(d: Date, tz: string, s: Pick<SlaSettings, 'businessStart' | 'businessEnd' | 'businessDays'>) {
  const p = localParts(d, tz);
  return s.businessDays.includes(p.weekday) && p.hour >= s.businessStart && p.hour < s.businessEnd;
}

export type AlertStage = 'chegou' | 'sem_dono' | 'vence' | 'venceu' | 'escalado';
export const ALERT_STAGE_LABELS: Record<AlertStage, string> = { chegou: 'Chegou', sem_dono: 'Sem responsável', vence: 'A vencer', venceu: 'Venceu', escalado: 'Escalado para a gestão' };

/**
 * Avisos que já deveriam ter saído para o chamado agora. Cada um tem uma chave estável (o registro de envio usa a chave
 * para não repetir). Fora do horário comercial só o escalonamento sai; o resto espera o próximo horário.
 * `fresh` = o chamado chegou há pouco (não manda "chegou" para o que já estava aberto quando o monitoramento começou).
 */
export function slaDueAlerts(t: SlaTicket, now: Date, s: SlaSettings, tz: string, fresh: boolean): { stage: AlertStage; key: string; hours?: number }[] {
  if (!isOpenStatus(t.status)) return [];
  const out: { stage: AlertStage; key: string; hours?: number }[] = [];
  const due = ticketDue(t, s, tz);
  const business = inBusinessHours(now, tz, s);
  const age = now.getTime() - t.openedAt.getTime();
  if (business && fresh) out.push({ stage: 'chegou', key: 'chegou' });
  if (business && !t.assignedUserIds.length && age >= s.unassignedMinutes * 60_000) {
    out.push({ stage: 'sem_dono', key: `sem_dono:${Math.floor((age - s.unassignedMinutes * 60_000) / H)}` });
  }
  if (due) {
    const left = due.getTime() - now.getTime();
    if (left > 0) {
      // só o aviso mais próximo do prazo (quem entra já perto do prazo não recebe os anteriores)
      const crossed = [...s.warnHours].sort((a, b) => a - b).find((h) => left <= h * H);
      if (business && crossed !== undefined) out.push({ stage: 'vence', key: `vence:${crossed}`, hours: crossed });
    } else {
      const late = -left;
      if (business) out.push({ stage: 'venceu', key: `venceu:${Math.floor(late / (Math.max(1, s.repeatLateHours) * H))}` });
      if (late >= s.escalateAfterHours * H) out.push({ stage: 'escalado', key: 'escalado' });
    }
  }
  return out;
}

/** Hora cheia de abertura e dia da semana, para o mapa "hora a hora". */
export function openedBucket(openedAt: Date, tz: string) {
  const p = localParts(openedAt, tz);
  return { weekday: p.weekday, hour: p.hour, date: p.date };
}
