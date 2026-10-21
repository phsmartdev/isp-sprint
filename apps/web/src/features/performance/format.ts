/** Formatação de valores de indicador pela unidade (reais em centavos, percentuais, tempo). */
import { fmtBRL } from '../../lib/format';
import type { IndicatorUnit, TrafficColor } from '@isp/domain';
import type { Tone } from '../../components/ui/primitives';

const n = (v: number, d = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: d });
export function fmtIndicator(v: number | null | undefined, unit: IndicatorUnit | string) {
  if (v === null || v === undefined) return '—';
  switch (unit) {
    case 'reais': return fmtBRL(Math.round(v));
    case 'percentual': return `${n(v)}%`;
    case 'horas': return `${n(v)} h`;
    case 'dias': return `${n(v)} dias`;
    case 'minutos': return `${n(v, 0)} min`;
    case 'quantidade': return n(v, 1);
    default: return n(v, 2);
  }
}
export const fmtAtt = (a: number | null | undefined) => (a === null || a === undefined ? '—' : `${n(a * 100, 0)}%`);
export const TRAFFIC_TONE: Record<TrafficColor, Tone> = { verde: 'green', amarelo: 'yellow', vermelho: 'red', sem_dado: 'neutral' };
