/**
 * Ofício de reajuste e de renovação: período em que cada ação vale, reajuste por item do contrato, tabela de
 * referência dos índices oficiais (Banco Central, SGS) e as tabelas/variáveis que entram no documento.
 */
import { addDays, addMonths, daysBetween, endFromTerm, nextAnniversary } from '@isp/domain';
import type { OfficeAdjustment, OfficeRenewal } from '../db/schema';
import { brl } from './email';
import { adjustmentSuggestion } from './indices';
import { dateLong } from './officeLetters';

/** Antes do aniversário da data-base (90 dias) até 120 dias depois: é quando o "Aplicar reajuste" aparece. */
export const ADJUST_BEFORE = 90, ADJUST_AFTER = 120;
/** Renovação: a partir de 120 dias antes do término até 60 dias depois. */
export const RENEW_BEFORE = 120, RENEW_AFTER = 60;

export function adjustmentPeriod(baseDate: string | null, today: string) {
  if (!baseDate) return { inPeriod: false, anniversary: null as string | null };
  const anniversary = nextAnniversary(baseDate, addDays(today, -ADJUST_AFTER));
  // o primeiro "aniversário" é a própria data-base: não há reajuste antes de completar 12 meses
  const inPeriod = anniversary > baseDate && daysBetween(today, anniversary) <= ADJUST_BEFORE;
  return { inPeriod, anniversary: anniversary > baseDate ? anniversary : addMonths(baseDate, 12) };
}
export function renewalPeriod(endAt: string | null, today: string) {
  if (!endAt) return { inPeriod: false };
  const d = daysBetween(today, endAt);
  return { inPeriod: d <= RENEW_BEFORE && d >= -RENEW_AFTER };
}
export function suggestedRenewal(endAt: string | null, termMonths: number | null, today: string) {
  const startAt = endAt ? addDays(endAt, 1) : today;
  const months = termMonths && termMonths > 0 ? termMonths : 12;
  return { startAt, endAt: endFromTerm(startAt, months), termMonths: months };
}

const ym = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export type IndexRef = { index: string; label: string; from: string; to: string; pct: number | null; note: string | null; source: string };
const INDEX_NAMES: Record<string, string> = { IPCA: 'IPCA (IBGE)', INPC: 'INPC (IBGE)', 'IGP-M': 'IGP-M (FGV)', 'IGP-DI': 'IGP-DI (FGV)' };
/**
 * Acumulado de 12 meses antes do aniversário, só do índice indicado no contrato, direto do Banco Central.
 * Índice sem série oficial automática (ex.: IST da Anatel) ou ainda não divulgado volta sem percentual, com o motivo.
 */
export async function indexReferences(anniversary: string, contractIndex: string | null): Promise<IndexRef[]> {
  const r = await adjustmentSuggestion(contractIndex, anniversary, 0);
  const key = r.ok ? r.index : (r as { index?: string }).index ?? (contractIndex ?? 'Índice não informado');
  const base = { index: key, label: INDEX_NAMES[key] ?? key, from: r.window.from, to: r.window.to, source: 'Banco Central do Brasil (SGS)' };
  return [r.ok ? { ...base, pct: r.pct, note: null } : { ...base, pct: null, note: r.reason }];
}

export type AdjustItemIn = { description: string; qty: number; unitCents: number; pct: number };
/** Reajuste por item: novo unitário de cada item, mensal antes/depois e o percentual médio ponderado. */
export function buildAdjustment(input: { anniversary: string; index: string | null; items: AdjustItemIn[] }, currentMonthlyCents: number): OfficeAdjustment {
  const items = input.items.map((i) => ({ ...i, newUnitCents: Math.round(i.unitCents * (1 + i.pct / 100)) }));
  const before = items.reduce((a, i) => a + i.qty * i.unitCents, 0);
  const after = items.reduce((a, i) => a + i.qty * i.newUnitCents, 0);
  const pct = before ? Math.round(((after / before) - 1) * 1_000_000) / 10_000 : 0;
  // o mensal do contrato acompanha a variação dos itens (contratos com mensal diferente da soma dos itens seguem proporcionais)
  const base = currentMonthlyCents || before;
  const newMonthlyCents = before ? Math.round(base * (after / before)) : base;
  return { anniversary: input.anniversary, index: input.index, pct, items, currentMonthlyCents: base, newMonthlyCents };
}

const pctTxt = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
export type OfficeTable = { columns: { label: string; align: 'left' | 'right'; w: number }[]; rows: string[][]; strong?: number[]; total?: string[]; note?: string };

/** Tabelas que o modelo usa com {{tabela.reajuste}} e {{tabela.indices}}. */
export function officeTables(adj: OfficeAdjustment | null, refs: IndexRef[] | null, _contractIndex?: string | null): Record<string, OfficeTable> {
  const t: Record<string, OfficeTable> = {};
  if (adj) {
    const sumA = adj.items.reduce((a, i) => a + i.qty * i.unitCents, 0), sumB = adj.items.reduce((a, i) => a + i.qty * i.newUnitCents, 0);
    t.reajuste = {
      columns: [{ label: 'Item', align: 'left', w: 2.5 }, { label: 'Qtd.', align: 'right', w: 0.55 }, { label: 'Unitário atual', align: 'right', w: 1.45 }, { label: 'Reajuste', align: 'right', w: 1.1 }, { label: 'Unitário reajustado', align: 'right', w: 1.55 }, { label: 'Total atual', align: 'right', w: 1.45 }, { label: 'Total reajustado', align: 'right', w: 1.55 }],
      rows: adj.items.map((i) => [i.description, i.qty.toLocaleString('pt-BR'), brl(i.unitCents), pctTxt(i.pct), brl(i.newUnitCents), brl(i.qty * i.unitCents), brl(i.qty * i.newUnitCents)]),
      total: ['Total mensal', '', '', pctTxt(adj.pct), '', brl(sumA), brl(sumB)],
    };
  }
  if (refs?.length) {
    t.indices = {
      columns: [{ label: 'Índice', align: 'left', w: 2.2 }, { label: 'Período (12 meses)', align: 'left', w: 2.4 }, { label: 'Acumulado', align: 'right', w: 1.3 }, { label: 'Fonte', align: 'left', w: 3 }],
      rows: refs.map((r) => [`${r.label}`, `${ym(r.from)} a ${ym(r.to)}`, r.pct === null ? 'não divulgado' : pctTxt(r.pct), r.source]),
      note: `Índice de reajuste previsto no contrato. Variação acumulada nos 12 meses anteriores ao aniversário da data-base, consultada em ${dateLong(new Date().toISOString().slice(0, 10))}.`,
    };
  }
  return t;
}

/** Variáveis do reajuste e da renovação (para o texto do ofício). */
export function adjustRenewVars(adj: OfficeAdjustment | null, ren: Pick<OfficeRenewal, 'startAt' | 'endAt' | 'termMonths'> | null): Record<string, string> {
  const v: Record<string, string> = {};
  if (adj) Object.assign(v, { 'reajuste.percentual': pctTxt(adj.pct), 'reajuste.indice': adj.index ?? '', 'reajuste.data_base': dateLong(adj.anniversary), 'reajuste.mensal_atual': brl(adj.currentMonthlyCents), 'reajuste.mensal_novo': brl(adj.newMonthlyCents) });
  if (ren) Object.assign(v, { 'renovacao.inicio': dateLong(ren.startAt), 'renovacao.termino': dateLong(ren.endAt), 'renovacao.prazo': `${ren.termMonths} (${ren.termMonths === 12 ? 'doze' : ren.termMonths === 24 ? 'vinte e quatro' : ren.termMonths === 6 ? 'seis' : ren.termMonths === 36 ? 'trinta e seis' : String(ren.termMonths)}) meses` });
  return v;
}
