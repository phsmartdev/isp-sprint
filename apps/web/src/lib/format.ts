import { formatBRL } from '@isp/domain';
import { MASK, moneyHidden } from './privacy';

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
/** Valor em R$; com o olhinho fechado, mostra a máscara (o número não aparece). */
let financeRestricted = false;
/** Perfil sem "ver valores financeiros": o servidor já manda os valores ocultos; aqui as somas feitas na tela também somem. */
export const setFinanceRestricted = (v: boolean) => { financeRestricted = v; };
export const fmtBRL = (cents?: number | null) => (financeRestricted ? '—' : moneyHidden() && cents !== null && cents !== undefined ? MASK : formatBRL(cents ?? null));
/**
 * Valor de indicador em R$ com a medida pelo tamanho: até R$ 9.999,99 inteiro; depois "mil", "mi" e "bi"
 * (R$ 151,1 mil · R$ 30,05 mi · R$ 1,2 bi). O valor completo vai no title de quem usa (fmtBRL).
 */
export function fmtBRLCompact(cents?: number | null) {
  if (financeRestricted) return '—';
  if (cents === null || cents === undefined) return formatBRL(null);
  if (moneyHidden()) return MASK;
  const v = cents / 100;
  const a = Math.abs(v);
  const unit = a >= 1e9 ? [1e9, 'bi'] as const : a >= 1e6 ? [1e6, 'mi'] as const : a >= 1e4 ? [1e3, 'mil'] as const : null;
  if (!unit) return formatBRL(cents);
  const n = v / unit[0];
  const digits = Math.abs(n) >= 100 ? 1 : 2;
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits })} ${unit[1]}`;
}
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
