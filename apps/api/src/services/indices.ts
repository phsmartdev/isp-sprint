/**
 * Índices de reajuste pela série oficial do Banco Central (SGS): IPCA 433, INPC 188, IGP-M 189, IGP-DI 190.
 * Endereço público: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{código}/dados?formato=json&dataInicial=dd/MM/aaaa&dataFinal=dd/MM/aaaa
 * Resposta: [{ "data": "01/03/2025", "valor": "0.56" }, …] (variação mensal em %).
 */
import { accumulatedPct, addDays, addMonths, adjustmentWindow, indexCodeOf } from '@isp/domain';

export type MonthlyValue = { month: string; pct: number };
type Fetcher = (code: number, from: string, to: string) => Promise<MonthlyValue[]>;

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const realFetcher: Fetcher = async (code, from, to) => {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${br(from)}&dataFinal=${br(to)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`Banco Central respondeu ${r.status}`);
    const j = (await r.json()) as { data: string; valor: string }[];
    return j.map((x) => ({ month: `${x.data.slice(6, 10)}-${x.data.slice(3, 5)}`, pct: Number(x.valor) })).filter((x) => Number.isFinite(x.pct));
  } finally { clearTimeout(timer); }
};
let fetcher: Fetcher = realFetcher;
/** Testes trocam o Banco Central por uma série simulada. */
export function setIndexFetcher(f: Fetcher | null) { fetcher = f ?? realFetcher; }

/** Sugestão de reajuste: acumulado dos 12 meses antes do aniversário pelo índice do contrato. */
export async function adjustmentSuggestion(indexName: string | null, anniversary: string, currentCents: number) {
  const idx = indexCodeOf(indexName);
  const w = adjustmentWindow(anniversary);
  if (!idx) return { ok: false as const, reason: indexName ? `O índice "${indexName}" não tem série oficial automática (ex.: IST da Anatel). Informe o percentual à mão.` : 'O contrato não tem índice de reajuste informado.', window: w };
  let series: MonthlyValue[];
  try { series = await fetcher(idx.code, w.from, addDays(addMonths(w.to, 1), -1)); }
  catch (e) { return { ok: false as const, reason: `Não foi possível buscar o ${idx.key} no Banco Central agora (${(e as Error).message}). Tente de novo ou informe à mão.`, window: w }; }
  const months: string[] = [];
  for (let m = w.from; m <= w.to; m = addMonths(m, 1)) months.push(m.slice(0, 7));
  const values = months.map((m) => series.find((x) => x.month === m)?.pct ?? null);
  const missing = months.filter((_, i) => values[i] === null);
  if (missing.length) return { ok: false as const, reason: `O ${idx.key} ainda não foi divulgado para ${missing.join(', ')}.`, window: w, index: idx.key };
  const pct = accumulatedPct(values as number[]);
  return { ok: true as const, index: idx.key, code: idx.code, window: w, monthly: months.map((m, i) => ({ month: m, pct: values[i]! })), pct, currentCents, newCents: Math.round(currentCents * (1 + pct / 100)), source: 'Banco Central (SGS)' };
}
