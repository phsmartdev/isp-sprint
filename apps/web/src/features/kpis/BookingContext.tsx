/**
 * O que move o Booking: contratos fechados no trimestre, negociações em andamento e saúde das contas.
 * Dados do próprio CRM, nas cores da marca (azul BKT e grafite; vermelho só para risco).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { MASK, MoneyToggle, moneyHidden, useMoneyHidden } from '../../lib/privacy';
import type { KpiItem } from './KpiBoard';

export type BookingCtx = {
  period: { from: string; to: string; quarter: number; year: number; today: string };
  contracts: { n: number; acvCents: number; amendments: { n: number; cents: number }; bySegment: { key: string; label: string; n: number; cents: number }[]; months: { month: string; n: number; cents: number }[]; top: { id: string; client: string; acvCents: number; signedAt: string }[] };
  pipeline: { n: number; cents: number; newN: number; stages: { key: string; name: string; n: number; cents: number; newN: number }[]; won: number; lost: number; winRate: number | null };
  bookingMonths: { month: string; n: number; contractsCents: number; amendmentsCents: number; cents: number }[];
  health: { total: number; acvCents: number; bands: { key: 'saudavel' | 'atencao' | 'risco' | 'sem_dado'; label: string; n: number; acvCents: number }[]; healthyShare: number | null; atRisk: { contactId: string; name: string; score: number | null; acvCents: number }[] };
};
export const useBookingContext = (year?: number, quarter?: number | null) =>
  useQuery({ queryKey: ['kpis', 'context', year ?? 'atual', quarter ?? 'atual'], queryFn: () => api<BookingCtx>(`/intelligence/kpis/context${qs({ year, quarter: quarter ?? undefined })}`), refetchInterval: 120_000, refetchIntervalInBackground: true, retry: 2 });

const BRAND = { blue: '#2F5986', blue2: '#3885D3', light: '#4FBBFF', ink: '#2D3339', grey: '#C9CFD6', risk: '#D23434' };
const HEALTH_COLOR = { saudavel: BRAND.blue, atencao: BRAND.light, risco: BRAND.risk, sem_dado: BRAND.grey } as const;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const brlShort = (c: number) => { if (moneyHidden()) return MASK; const v = c / 100; return v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : fmtBRL(c); };

function Card({ title, sub, children, label, action }: { title: string; sub?: string; children: React.ReactNode; label: string; action?: React.ReactNode }) {
  return (
    <section className="card flex h-full min-w-0 flex-col p-5" aria-label={label}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-md font-bold text-ink">{title}</h3>{sub && <p className="text-xs text-muted">{sub}</p>}</div>{action}</div>
      {children}
    </section>
  );
}

/** Contratos novos (1ª assinatura no trimestre) e aditivos de acréscimo, em valor anualizado. */
export function ClosedContracts({ c, link }: { c: BookingCtx; link?: boolean }) {
  useMoneyHidden(); // redesenha ao ocultar/mostrar valores
  const k = c.contracts;
  const maxM = Math.max(1, ...k.months.map((m) => m.cents));
  const maxS = Math.max(1, ...k.bySegment.map((x) => x.cents));
  return (
    <Card label="Contratos fechados no trimestre" title={`Contratos fechados no ${c.period.quarter}º trimestre`} sub="Novos contratos validados, em valor anual" action={link ? <Link to="/contracts?t=lista" className="shrink-0 text-xs font-semibold text-primary hover:underline">Ver contratos</Link> : undefined}>
      <p className="num mt-3 text-2xl font-extrabold leading-none text-ink">{brlShort(k.acvCents)}<span className="ml-1 text-sm font-semibold text-muted">/ano</span></p>
      <p className="mt-1 text-xs text-muted">{k.n} contrato(s) novo(s){k.amendments.n ? ` · +${brlShort(k.amendments.cents)} em ${k.amendments.n} aditivo(s)` : ''}</p>
      <div className="mt-4 grid grid-cols-3 items-end gap-3" aria-hidden>
        {k.months.map((m) => (
          <div key={m.month} className="flex flex-col items-center gap-1">
            <span className="num text-2xs font-semibold text-muted">{m.cents ? brlShort(m.cents) : '—'}</span>
            <span className="block w-full bg-surface-2" style={{ height: 56 }}><span className="block w-full" style={{ height: `${(m.cents / maxM) * 100}%`, marginTop: `${56 - (m.cents / maxM) * 56}px`, background: m.month <= c.period.today.slice(0, 7) ? BRAND.blue : BRAND.grey }} /></span>
            <span className="text-2xs text-muted">{MONTHS[Number(m.month.slice(5)) - 1]}</span>
          </div>
        ))}
      </div>
      {k.bySegment.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line pt-3">
          {k.bySegment.map((x) => (
            <li key={x.key} className="text-xs">
              <span className="flex justify-between gap-2"><span className="text-text">{x.label} <span className="text-faint">({x.n})</span></span><span className="num font-semibold text-ink">{brlShort(x.cents)}</span></span>
              <span className="mt-1 block h-1 bg-surface-2"><span className="block h-full" style={{ width: `${(x.cents / maxS) * 100}%`, background: BRAND.blue2 }} /></span>
            </li>
          ))}
        </ul>
      )}
      {k.top.length > 0 && (
        <div className="mt-auto border-t border-line pt-3">
          <p className="text-xs font-semibold text-ink">Maiores contratos do trimestre</p>
          <ul className="mt-1.5 space-y-1 text-xs">{k.top.map((t) => <li key={t.id} className="flex justify-between gap-2">{link ? <Link to={`/contracts/${t.id}`} className="truncate text-text hover:text-primary hover:underline">{t.client}</Link> : <span className="truncate text-text">{t.client}</span>}<span className="num shrink-0 text-muted">{brlShort(t.acvCents)}/ano</span></li>)}</ul>
        </div>
      )}
      {!k.n && <p className="mt-3 text-sm text-muted">Nenhum contrato novo validado no trimestre ainda.</p>}
    </Card>
  );
}

/** Negociações em andamento por etapa: é o que pode virar Booking. */
export function OpenPipeline({ c, link }: { c: BookingCtx; link?: boolean }) {
  useMoneyHidden(); // redesenha ao ocultar/mostrar valores
  const p = c.pipeline;
  const max = Math.max(1, ...p.stages.map((x) => x.cents));
  return (
    <Card label="Negociações em andamento" title="Negociações em andamento" sub="O que pode virar Booking, por etapa (valor anual)" action={link ? <Link to="/opportunities" className="shrink-0 text-xs font-semibold text-primary hover:underline">Ver funil</Link> : undefined}>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p><span className="num text-2xl font-extrabold leading-none text-ink">{brlShort(p.cents)}</span><span className="ml-1 text-sm font-semibold text-muted">/ano</span></p>
        <p className="text-xs text-muted"><b className="num text-ink">{p.n}</b> negociações · <b className="num text-ink">{p.newN}</b> abertas no trimestre</p>
      </div>
      <ul className="mt-4 space-y-2.5">
        {p.stages.map((x) => (
          <li key={x.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-xs">
            <span className="truncate text-text" title={x.name}>{x.name}</span>
            <span className="block h-2 bg-surface-2"><span className="block h-full" style={{ width: `${Math.max(x.cents ? 2 : 0, (x.cents / max) * 100)}%`, background: BRAND.blue }} /></span>
            <span className="num w-28 text-right"><b className="text-ink">{brlShort(x.cents)}</b> <span className="text-faint">· {x.n}</span></span>
          </li>
        ))}
        {!p.stages.length && <li className="text-sm text-muted">Nenhuma negociação aberta.</li>}
      </ul>
      <p className="mt-auto border-t border-line pt-3 text-xs text-muted">No trimestre: <b className="num text-ink">{p.won}</b> ganha(s), <b className="num text-ink">{p.lost}</b> perdida(s){p.winRate !== null ? <> · conversão <b className="num text-ink">{Math.round(p.winRate * 100)}%</b></> : null}</p>
    </Card>
  );
}

/** Saúde da carteira (Sucesso do Cliente): contas e valor anual em cada faixa. */
export function AccountHealth({ c, link }: { c: BookingCtx; link?: boolean }) {
  useMoneyHidden(); // redesenha ao ocultar/mostrar valores
  const h = c.health;
  const known = h.bands.filter((b) => b.key !== 'sem_dado').reduce((t, b) => t + b.n, 0);
  return (
    <Card label="Saúde das contas" title="Saúde das contas" sub="Carteira do Sucesso do Cliente" action={link ? <Link to="/sucesso" className="shrink-0 text-xs font-semibold text-primary hover:underline">Ver carteira</Link> : undefined}>
      {h.healthyShare === null ? <p className="mt-3 text-sm text-muted">Ainda sem contas com saúde calculada.</p> : <p className="mt-3"><span className="num text-2xl font-extrabold leading-none text-ink">{Math.round(h.healthyShare * 100)}%</span><span className="ml-1.5 text-sm text-muted">das contas saudáveis</span></p>}
      <div className="mt-3 flex h-2.5 w-full overflow-hidden bg-surface-2" aria-hidden>
        {h.bands.filter((b) => b.n).map((b) => <span key={b.key} style={{ width: `${(b.n / Math.max(1, h.total)) * 100}%`, background: HEALTH_COLOR[b.key] }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {h.bands.map((b) => (
          <li key={b.key} className="flex items-start gap-2"><span className="mt-1 h-2 w-2 shrink-0" style={{ background: HEALTH_COLOR[b.key] }} aria-hidden /><span><span className="text-text">{b.label}</span><span className="num block text-faint"><b className="text-ink">{b.n}</b> · {brlShort(b.acvCents)}/ano</span></span></li>
        ))}
      </ul>
      {h.atRisk.length > 0 && (
        <div className="mt-auto border-t border-line pt-3">
          <p className="text-xs font-semibold text-ink">Maiores contas em risco</p>
          <ul className="mt-1.5 space-y-1 text-xs">{h.atRisk.map((a) => <li key={a.contactId} className="flex justify-between gap-2"><span className="truncate text-text">{a.name}</span><span className="num shrink-0 text-muted">{brlShort(a.acvCents)}/ano</span></li>)}</ul>
        </div>
      )}
      {!known && !h.atRisk.length && <p className="mt-auto pt-3 text-xs text-muted">{h.total ? 'Faltam dados para calcular a saúde da maioria das contas.' : 'Nenhuma conta na carteira do Sucesso do Cliente ainda.'}</p>}
    </Card>
  );
}

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 720, h: 260 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { const r = e!.contentRect; if (r.width > 0) setBox({ w: Math.round(r.width), h: Math.round(Math.max(200, r.height)) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

const ST_DOT = { atingido: '#16A34A', atencao: '#EA7A12', abaixo: '#D23434', sem_dado: '#C9CFD6' } as const;

export type Revenue = {
  year: number; upTo: number;
  months: { month: string; recorrente: number; reajuste: number; medicao: number; frequente: number; total: number; comparavel: number }[];
  prevMonths: Revenue['months'];
  quarters: { q: number; months: number; base: number; real: number; comparable: number; growthComparable: number | null; growthReal: number | null }[];
  ytd: { base: number; real: number; comparable: number; reajuste: number; growthReal: number | null; growthComparable: number | null } | null;
  totals: Record<string, number>; missingHistory: number;
};
export const useRevenue = (year?: number) => useQuery({ queryKey: ['kpis', 'revenue', year ?? 'atual'], queryFn: () => api<Revenue>(`/intelligence/revenue${qs({ year })}`), refetchInterval: 120_000, refetchIntervalInBackground: true, retry: 2 });
const pctTxt = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

/**
 * Booking: receita da base de contratos mês a mês (recorrente + medição + frequente) contra o ano anterior.
 * A parte clara da barra é reajuste (não é crescimento); embaixo, o crescimento sem reajuste.
 * O olhinho esconde os valores em R$ (reunião, TV): as barras continuam, só os números somem.
 */
export function BookingChart({ it, r, onOpen, fill }: { it: KpiItem; r: Revenue; onOpen?: (it: KpiItem) => void; fill?: boolean }) {
  const hidden = useMoneyHidden();
  const [ref, box] = useBox<HTMLDivElement>();
  const y = r.year;
  const fs = Math.max(10, Math.min(15, box.w / 70));
  const W = box.w, H = fill ? box.h : Math.min(box.h, 270), L = hidden ? 8 : fs * 5.2, R = 8, T = fs * 1.9, B = fs * 3.6;
  const top = Math.max(1, ...r.months.map((m) => m.total), ...r.prevMonths.map((m) => m.total)) * 1.15;
  const slot = (W - L - R) / 12;
  const yy = (v: number) => T + (H - T - B) * (1 - v / top);
  const bw = Math.min(fs * 2.6, slot * 0.32);
  const g = r.ytd;
  return (
    <section className="card flex h-full flex-col p-5" aria-label={`Evolução de ${it.def.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-md font-bold text-ink">{it.def.name} <span className="ml-1 align-middle text-2xs font-semibold text-primary">indicador principal</span></h3>
          <p className="text-xs text-muted">Receita da base de contratos (recorrente + medição + frequente), {y} contra {y - 1}. Crescimento sem o efeito do reajuste.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-right text-xs text-muted">{y - 1} (ano todo)<b className="num block text-md text-ink">{brlShort(r.totals[String(y - 1)] ?? 0)}</b></span>
          <span className="text-right text-xs text-muted">{y} até {r.upTo ? MONTHS[r.upTo - 1] : '—'}<b className="num block text-md text-ink">{brlShort(r.totals[`${y}_ate_mes`] ?? 0)}</b></span>
          <span className="text-right text-xs text-muted">Crescimento sem reajuste<b className="num block text-md text-primary">{pctTxt(g?.growthComparable ?? null)}</b></span>
          <MoneyToggle compact />
          {onOpen && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onOpen(it)}>Ver ficha</button>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5" style={{ background: BRAND.grey }} aria-hidden />{y - 1}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5" style={{ background: BRAND.blue }} aria-hidden />{y}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5" style={{ background: BRAND.light }} aria-hidden />Reajuste</span>
        {g && <span>Com reajuste: <b className="num text-ink">{pctTxt(g.growthReal)}</b></span>}
      </div>
      {(() => { const gaps = r.months.slice(0, r.upTo).filter((m, i) => m.total > 0 && !r.prevMonths[i]!.total).length; return gaps > 0 ? <p className="mt-2 bg-warning-soft px-3 py-1.5 text-xs text-[#9A4B07]">{y - 1} sem receita no CRM em {gaps} mês(es) em que {y} tem: a base do ano anterior está incompleta e o crescimento fica exagerado. Cadastre os contratos de {y - 1} com as datas certas ou informe o valor de {y - 1} nos contratos.</p> : null; })()}
      {r.missingHistory > 0 && <p className="mt-2 bg-warning-soft px-3 py-1.5 text-xs text-[#9A4B07]">{r.missingHistory} contrato(s) cadastrado(s) já reajustado(s), sem o valor de {y - 1}: informe na aba Aditivos do contrato para o reajuste não contar como crescimento.</p>}
      <div ref={ref} className={fill ? 'mt-2 min-h-[200px] w-full flex-1' : 'mt-2 h-[270px] w-full'}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`Receita por mês: ${y} contra ${y - 1}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((k) => (
            <g key={k}>
              <line x1={L} x2={W - R} y1={yy(top * k)} y2={yy(top * k)} stroke="#E1E5EA" />
              {!hidden && <text x={L - 6} y={yy(top * k) + 3.5} textAnchor="end" fontSize={fs * 0.85} fill="#7D8791">{k === 0 ? 'R$ 0' : brlShort(top * k)}</text>}
            </g>
          ))}
          {r.months.map((m, i) => {
            const p = r.prevMonths[i]!;
            const cx = L + i * slot + slot / 2;
            const future = i >= r.upTo;
            const growth = !future && p.total ? (m.comparavel / p.total - 1) * 100 : null;
            const base = m.total - m.reajuste;
            return (
              <g key={m.month}>
                {p.total > 0 && <rect x={cx - bw - 1} y={yy(p.total)} width={bw} height={Math.max(0, yy(0) - yy(p.total))} fill={BRAND.grey} />}
                {!future && m.total > 0 && <>
                  <rect x={cx + 1} y={yy(base)} width={bw} height={Math.max(0, yy(0) - yy(base))} fill={BRAND.blue} />
                  {m.reajuste > 0 && <rect x={cx + 1} y={yy(m.total)} width={bw} height={Math.max(0, yy(base) - yy(m.total))} fill={BRAND.light} />}
                </>}
                <text x={cx} y={H - fs * 2.1} textAnchor="middle" fontSize={fs} fill={future ? '#B4BCC4' : '#5F6B76'}>{MONTHS[i]}</text>
                {growth !== null && <text x={cx} y={H - fs * 0.45} textAnchor="middle" fontSize={fs * 0.85} fontWeight="700" fill={growth >= 0 ? BRAND.blue : BRAND.risk}>{pctTxt(Math.round(growth))}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
