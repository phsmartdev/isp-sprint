import { formatBRL } from '@isp/domain';

let tz = 'America/Sao_Paulo';
export const setTimezone = (t: string) => { tz = t; };
export const getTimezone = () => tz;

const d = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);

export function fmtDate(v?: string | Date | null) {
  if (!v) return '—';
  // data sem hora (AAAA-MM-DD) é um dia do calendário: não converte fuso (senão volta um dia)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return d(v).toLocaleDateString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtDateTime(v?: string | Date | null) {
  if (!v) return '—';
  return d(v).toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function fmtRelative(v?: string | Date | null) {
  if (!v) return '—';
  const diff = d(v).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}
export const fmtBRL = (cents?: number | null) => formatBRL(cents ?? null);
export const fmtPct = (r?: number | null) => (r === null || r === undefined ? 'N/D' : `${(r * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const fmtInt = (n?: number | null) => (n === null || n === undefined ? 'N/D' : n.toLocaleString('pt-BR'));
export function fmtDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Converte valor de <input type="datetime-local"> (fuso local do navegador) para ISO UTC. */
export function localInputToIso(v: string) {
  return v ? new Date(v).toISOString() : null;
}
export function isoToLocalInput(v?: string | null) {
  if (!v) return '';
  const x = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function fmtTime(v?: string | Date | null) {
  if (!v) return '—';
  return d(v).toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
}

const dayKey = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: tz });

/** "Hoje, 10:30" · "Ontem, 16:45" · "Amanhã, 09:00" · "12/05/2026" (como nos designs). */
export function fmtRelativeShort(v?: string | Date | null) {
  if (!v) return '—';
  const x = d(v);
  const now = new Date();
  const k = dayKey(x);
  if (k === dayKey(now)) return `Hoje, ${fmtTime(x)}`;
  if (k === dayKey(new Date(now.getTime() - 86_400_000))) return `Ontem, ${fmtTime(x)}`;
  if (k === dayKey(new Date(now.getTime() + 86_400_000))) return `Amanhã, ${fmtTime(x)}`;
  return fmtDate(x);
}

export function fmtLongDate(v: Date) {
  return v.toLocaleDateString('pt-BR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtDayHeading(v: Date) {
  const now = new Date();
  const k = dayKey(v);
  const label = v.toLocaleDateString('pt-BR', { timeZone: tz, day: 'numeric', month: 'long' });
  if (k === dayKey(now)) return `Hoje, ${label}`;
  if (k === dayKey(new Date(now.getTime() + 86_400_000))) return `Amanhã, ${label}`;
  if (k === dayKey(new Date(now.getTime() - 86_400_000))) return `Ontem, ${label}`;
  const wd = v.toLocaleDateString('pt-BR', { timeZone: tz, weekday: 'long' });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${label}`;
}

/** Data local (AAAA-MM-DD) no fuso da empresa. */
export const localDayKey = (v: string | Date) => dayKey(d(v));
