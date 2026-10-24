/**
 * Painel dos indicadores principais (Inteligência e TV da diretoria).
 * Em cima, os indicadores lado a lado em cartões compactos com a barra de avanço contra a meta.
 * Embaixo, as outras visões: evolução do indicador escolhido, atingimento de todos no trimestre,
 * desdobramento das metas por trimestre e o que pede atenção.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { kpiBands, type IndicatorDef, type KpiStatus } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { AccountHealth, BookingChart, ClosedContracts, OpenPipeline, useBookingContext } from './BookingContext';
import './kpiBoard.css';

export type KpiQuarter = { q: number; target: number | null; value: number | null; status: KpiStatus; attainment: number | null; months: { period: string; value: number | null; status: KpiStatus }[] | null; phase: 'fechado' | 'atual' | 'futuro'; entries: number };
export type KpiItem = {
  id: string; key: string; version: number; def: IndicatorDef; quarters: KpiQuarter[]; current: KpiQuarter | null;
  annual: { target: number | null; value: number | null; status: KpiStatus; attainment: number | null }; lastEntryAt: string | null; lastPeriod: string | null;
};
export type KpiData = { year: number; today: string; quarter: number | null; items: KpiItem[]; canEnter: boolean; canImport: boolean; demoEntries: number; summary: { total: number; atingido: number; atencao: number; abaixo: number; sem_dado: number } };

export const useKpis = (year?: number, refetchMs = 60_000) => useQuery({ queryKey: ['kpis', year ?? 'atual'], queryFn: () => api<KpiData>(`/intelligence/kpis${qs({ year })}`), refetchInterval: refetchMs, refetchIntervalInBackground: true, retry: 2 });

export const ST_LABEL: Record<KpiStatus, string> = { atingido: 'Na meta', atencao: 'No limite', abaixo: 'Fora do limite', sem_dado: 'Sem resultado' };
export const ST_COLOR: Record<KpiStatus, string> = { atingido: '#16A34A', atencao: '#EA7A12', abaixo: '#D23434', sem_dado: '#C9CFD6' };
const ST_TEXT: Record<KpiStatus, string> = { atingido: 'text-success', atencao: 'text-[#C2610C]', abaixo: 'text-danger', sem_dado: 'text-faint' };
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthName = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]}/${p.slice(2, 4)}`;

const nf = (v: number, d = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export function kpiParts(v: number | null, unit: IndicatorDef['unit']): [string, string] {
  if (v === null || v === undefined) return ['—', ''];
  if (unit === 'percentual') return [nf(v), '%'];
  if (unit === 'dias') return [nf(v), Math.abs(v) === 1 ? ' dia' : ' dias'];
  if (unit === 'horas') return [nf(v), ' h'];
  if (unit === 'minutos') return [nf(v, 0), ' min'];
  if (unit === 'reais') return [v >= 1e6 ? `R$ ${nf(v / 1e6)} mi` : v >= 1e3 ? `R$ ${nf(v / 1e3)} mil` : `R$ ${nf(v, 2)}`, ''];
  return [nf(v), ''];
}
export const kpiText = (v: number | null, unit: IndicatorDef['unit']) => kpiParts(v, unit).join('');
const short = (v: number | null, unit: IndicatorDef['unit']) => (unit === 'dias' && v !== null ? `${nf(v)} d` : kpiText(v, unit));
const goalText = (it: KpiItem, v: number | null) => `${it.def.direction === 'menor' ? '≤ ' : ''}${short(v, it.def.unit)}`;
const live = (d: KpiData) => d.items.filter((i) => !i.def.sheet!.paused);

function gap(it: KpiItem) {
  const c = it.current;
  if (!c || c.value === null || c.target === null) return null;
  const d = c.value - c.target;
  const amt = it.def.unit === 'percentual' ? `${nf(Math.abs(d))} p.p.` : kpiText(Math.abs(d), it.def.unit);
  if (it.def.direction === 'menor') return d > 0 ? `${amt} acima da meta` : `${amt} abaixo da meta`;
  return d < 0 ? `faltam ${amt} para a meta` : `${amt} acima da meta`;
}

const Dot = ({ st, className }: { st: KpiStatus; className?: string }) => <span aria-hidden className={clsx('inline-block h-2 w-2 shrink-0 rounded-circle', className)} style={{ background: ST_COLOR[st] }} />;

/** Barra de avanço: resultado na cor do status, marca escura na meta e marca clara no limite aceitável. */
function ProgressBar({ it }: { it: KpiItem }) {
  const c = it.current;
  const target = c?.target ?? it.annual.target;
  if (target === null) return <div className="mt-3 h-1.5 bg-surface-2" />;
  const b = kpiBands(it.def, target);
  const v = c?.value ?? null;
  const max = Math.max(b.direction === 'menor' ? b.limit * 1.25 : target * 1.25, (v ?? 0) * 1.05, 1e-9);
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`;
  return (
    <span className="relative mt-3 block h-1.5 bg-surface-2" aria-hidden>
      {v !== null && <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: pct(v) }} />}
      <span className="absolute -inset-y-1 w-px bg-line-strong" style={{ left: pct(b.limit) }} />
      <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-ink" style={{ left: pct(target) }} />
    </span>
  );
}

function KpiCardTile({ it, selected, onSelect }: { it: KpiItem; selected: boolean; onSelect?: () => void }) {
  const c = it.current;
  const st: KpiStatus = c?.status ?? 'sem_dado';
  const [num, suf] = kpiParts(c?.value ?? null, it.def.unit);
  return (
    <button type="button" onClick={onSelect} disabled={!onSelect} aria-label={`${it.def.name}: ${ST_LABEL[st]}${selected ? ' (indicador principal)' : ''}`}
      className={clsx('card flex min-w-0 flex-col border-t-[3px] p-4 text-left transition-colors enabled:hover:bg-surface-2/40 disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary', selected ? 'border-t-primary' : 'border-t-transparent')}>
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 h-[2.5em] overflow-hidden text-sm font-semibold leading-tight text-ink" title={it.def.name}>{it.def.name}</span>
        <Dot st={st} className="mt-1" />
      </span>
      <span className="num mt-1 whitespace-nowrap text-2xl font-extrabold leading-none text-ink">{num}{suf && <span className="ml-0.5 text-md font-semibold text-muted">{suf.trim()}</span>}</span>
      <span className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted">
        <span>meta {c ? `${c.q}T ` : ''}{goalText(it, c?.target ?? it.annual.target)}</span>
        {c?.attainment != null && <span className={clsx('num font-semibold', ST_TEXT[st])}>{Math.round(c.attainment * 100)}%</span>}
      </span>
      <ProgressBar it={it} />
      <span className="mt-2 text-2xs text-faint">No ano <b className="num font-semibold text-muted">{short(it.annual.value, it.def.unit)}</b> · meta {goalText(it, it.annual.target)}</span>
    </button>
  );
}

/** Evolução do indicador escolhido: barras do resultado por mês ou trimestre, meta e limite de cada período. */
/** Tamanho real da área do gráfico: o desenho usa os pixels de verdade (nítido e sem distorcer, na TV ou no sistema). */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 720, h: 240 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { const r = e!.contentRect; if (r.width > 0) setBox({ w: Math.round(r.width), h: Math.round(Math.max(200, r.height)) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

function Evolution({ it, year, onOpen, wide }: { it: KpiItem; year: number; onOpen?: (it: KpiItem) => void; wide?: boolean }) {
  const [boxRef, box] = useBox<HTMLDivElement>();
  const monthly = it.def.period === 'mes';
  const points = monthly
    ? it.quarters.flatMap((q) => (q.months ?? []).map((m) => ({ label: MONTHS[Number(m.period.slice(5)) - 1]!, value: m.value, target: q.target, status: m.status, future: q.phase === 'futuro' || (q.phase === 'atual' && m.value === null) })))
    : it.quarters.map((q) => ({ label: `${q.q}T`, value: q.value, target: q.target, status: q.status, future: q.phase === 'futuro' }));
  const limits = points.map((p) => (p.target === null ? null : kpiBands(it.def, p.target).limit));
  const top = Math.max(1e-9, ...points.map((p) => p.value ?? 0), ...points.map((p) => p.target ?? 0), ...limits.map((l) => l ?? 0)) * 1.15;
  const fs = Math.max(10, Math.min(15, box.w / 70));
  const W = box.w, H = wide ? box.h : Math.min(box.h, 260), L = fs * 4.4, R = 8, T = fs * 1.8, B = fs * 2.4;
  const slot = (W - L - R) / points.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => top * k);
  const sh = it.def.sheet!;
  return (
    <section className="card flex h-full flex-col p-5" aria-label={`Evolução de ${it.def.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-md font-bold text-ink">{it.def.name} <span className="ml-1 align-middle text-2xs font-semibold text-primary">indicador principal</span></h3>
          <p className="text-xs text-muted">{monthly ? 'Mês a mês' : 'Trimestre a trimestre'} em {year} · {it.def.direction === 'menor' ? 'quanto menor, melhor' : 'quanto maior, melhor'}{sh.sourceSystem ? ` · fonte ${sh.sourceSystem}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" aria-hidden />Resultado</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ink" aria-hidden />Meta</span>
          <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-muted" aria-hidden />{it.def.direction === 'menor' ? 'Teto' : 'Mínimo'}</span>
          {onOpen && <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpen(it)}>Ver ficha</button>}
        </div>
      </div>
      <div ref={boxRef} className={clsx('mt-3 w-full', wide ? 'min-h-[200px] flex-1' : 'h-[260px]')}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`Resultado e meta de ${it.def.name} por ${monthly ? 'mês' : 'trimestre'}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#E1E5EA" />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={fs * 0.9} fill="#7D8791">{short(Math.round(t * 10) / 10, it.def.unit)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = L + i * slot + slot / 2;
          const bw = Math.min(fs * 5, slot * 0.56);
          return (
            <g key={p.label}>
              {p.value !== null && <rect x={cx - bw / 2} y={y(p.value)} width={bw} height={Math.max(0, y(0) - y(p.value))} fill={p.future ? '#3885D3' : '#2F5986'} />}
              {p.value !== null && <text x={cx} y={y(p.value) - 5} textAnchor="middle" fontSize={fs} fontWeight="700" fill="#2D3339">{short(p.value, it.def.unit)}</text>}
              {p.target !== null && <line x1={cx - slot * 0.42} x2={cx + slot * 0.42} y1={y(p.target)} y2={y(p.target)} stroke="#2D3339" strokeWidth="2" />}
              {limits[i] !== null && <line x1={cx - slot * 0.42} x2={cx + slot * 0.42} y1={y(limits[i]!)} y2={y(limits[i]!)} stroke="#5F6B76" strokeWidth="1" strokeDasharray="3 3" />}
              <text x={cx} y={H - fs * 0.7} textAnchor="middle" fontSize={fs} fill={p.future ? '#B4BCC4' : '#5F6B76'}>{p.label}</text>
            </g>
          );
        })}
      </svg>
      </div>
    </section>
  );
}

/** Desdobramento: cada indicador, a meta e o resultado de cada trimestre e do ano. */
function Breakdown({ items, year, onSelect }: { items: KpiItem[]; year: number; onSelect?: (it: KpiItem) => void }) {
  const cur = items[0]?.quarters.find((q) => q.phase === 'atual')?.q;
  return (
    <section className="card h-full overflow-hidden" aria-label="Desdobramento das metas">
      <div className="px-5 pt-5"><h3 className="text-md font-bold text-ink">Desdobramento das metas · {year}</h3><p className="text-xs text-muted">Resultado e meta de cada trimestre. Em azul, o trimestre atual.</p></div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-5 py-2 text-left font-medium">Indicador</th>{[1, 2, 3, 4].map((q) => <th key={q} className={clsx('px-3 py-2 text-left font-medium', q === cur && 'text-primary')}>{q}º trimestre</th>)}<th className="px-5 py-2 text-left font-medium">Ano</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className={clsx('border-t border-line', onSelect && 'cursor-pointer hover:bg-surface-2/50')} onClick={() => onSelect?.(it)}>
                <td className="px-5 py-2 font-semibold text-ink">{it.def.name}</td>
                {it.quarters.map((q) => (
                  <td key={q.q} className={clsx('px-3 py-2', q.phase === 'atual' && 'bg-primary-soft/60')}>
                    {q.phase === 'futuro' ? <span className="whitespace-nowrap text-xs text-faint">meta {goalText(it, q.target)}</span> : (
                      <span className="flex items-center gap-2"><Dot st={q.status} /><span className="leading-tight"><b className="num text-ink">{short(q.value, it.def.unit)}</b><span className="block whitespace-nowrap text-2xs text-faint">meta {goalText(it, q.target)}</span></span></span>
                    )}
                  </td>
                ))}
                <td className="px-5 py-2"><span className="flex items-center gap-2"><Dot st={it.annual.status} /><span className="leading-tight"><b className="num text-ink">{short(it.annual.value, it.def.unit)}</b><span className="block whitespace-nowrap text-2xs text-faint">meta {goalText(it, it.annual.target)}</span></span></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Attention({ items }: { items: KpiItem[] }) {
  const off = items.filter((i) => i.current?.status === 'abaixo' || i.current?.status === 'atencao').sort((a, b) => (a.current!.status === 'abaixo' ? 0 : 1) - (b.current!.status === 'abaixo' ? 0 : 1));
  const missing = items.filter((i) => !i.current || i.current.status === 'sem_dado');
  return (
    <section className="card flex h-full flex-col p-5" aria-label="O que pede atenção">
      <h3 className="text-md font-bold text-ink">Pede atenção</h3>
      {off.length ? (
        <ul className="mt-3 space-y-2.5">{off.map((i) => <li key={i.id} className="flex gap-2.5"><Dot st={i.current!.status} className="mt-1.5" /><span><b className="block text-sm font-semibold text-ink">{i.def.name}</b><span className="text-xs text-muted">{gap(i)}</span></span></li>)}</ul>
      ) : <p className="mt-3 text-sm text-muted">{items.length && missing.length < items.length ? 'Todos os indicadores com resultado estão na meta.' : 'Nenhum resultado lançado neste trimestre.'}</p>}
      {missing.length > 0 && <p className="mt-3 text-xs text-muted">Sem resultado no trimestre: {missing.map((i) => i.def.name).join(', ')}.</p>}
      <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs text-muted">{(['atingido', 'atencao', 'abaixo', 'sem_dado'] as KpiStatus[]).map((s) => <span key={s} className="flex items-center gap-1.5"><Dot st={s} />{ST_LABEL[s]}</span>)}</div>
    </section>
  );
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Summary({ d, updatedAt, stale }: { d: KpiData; updatedAt: number; stale: boolean }) {
  const q = d.quarter, y = d.year;
  const qStart = q ? Date.UTC(y, (q - 1) * 3, 1) : 0;
  const total = q ? Math.round((Date.UTC(y, q * 3, 1) - qStart) / 86_400_000) : 0;
  const day = q ? Math.min(total, Math.floor((Date.parse(`${d.today}T12:00:00Z`) - qStart) / 86_400_000) + 1) : 0;
  const s = d.summary;
  return (
    <section className="card flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3.5" aria-label="Resumo do trimestre">
      <div className="min-w-[220px] max-w-md flex-1">
        <p className="flex items-baseline justify-between gap-3 text-sm"><b className="text-ink">{q ? `${q}º trimestre de ${y}` : `Ano de ${y}`}</b>{q ? <span className="text-xs text-muted">dia {day} de {total}</span> : null}</p>
        {q ? <div className="mt-2 h-1 bg-surface-2" aria-hidden><div className="h-full bg-primary" style={{ width: `${(day / Math.max(1, total)) * 100}%` }} /></div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex gap-1.5" aria-hidden>{live(d).map((i) => <Dot key={i.id} st={i.current?.status ?? 'sem_dado'} className="h-2.5 w-2.5" />)}</span>
        <span className="text-sm text-muted"><b className="text-ink">{s.atingido} de {s.total}</b> na meta{s.atencao ? ` · ${s.atencao} no limite` : ''}{s.abaixo ? ` · ${s.abaixo} fora` : ''}{s.sem_dado ? ` · ${s.sem_dado} sem resultado` : ''}</span>
      </div>
      {d.demoEntries > 0 && <p className="bg-warning-soft px-2.5 py-1 text-xs font-semibold text-[#9A4B07]">Resultados de demonstração (fictícios)</p>}
      <p className={clsx('ml-auto text-xs', stale ? 'font-semibold text-[#C2610C]' : 'text-muted')}>{stale ? 'Sem conexão desde' : 'Dados de'} {new Date(updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
    </section>
  );
}

function TvTitle({ onExit }: { onExit?: () => void }) {
  const now = useNow();
  return (
    <header className="mb-5 flex items-end justify-between gap-6">
      <div className="flex items-center gap-4">
        <img src="/brand/bkt-symbol.png" alt="BKT" className="h-12 w-auto" />
        <div><h1 className="font-display text-[1.9rem] font-bold leading-tight tracking-wide text-ink">Resultados da área</h1><p className="text-md text-muted">Indicadores principais</p></div>
      </div>
      <div className="text-right">
        <time className="num block text-[2.4rem] font-semibold leading-none text-ink" dateTime={now.toISOString()}>{now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
        <p className="mt-1 text-sm text-muted"><span className="capitalize">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>{onExit && <button type="button" className="kb-exit ml-3 border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:text-ink" onClick={onExit}>Sair</button>}</p>
      </div>
    </header>
  );
}

export function KpiBoard({ d, updatedAt, error, tv, onOpen, onExit, className }: { d: KpiData; updatedAt: number; error: boolean; tv?: boolean; onOpen?: (it: KpiItem) => void; onExit?: () => void; className?: string }) {
  const items = useMemo(() => live(d), [d]);
  const stale = error || Date.now() - updatedAt > 10 * 60_000;
  // o gráfico de evolução é sempre do indicador principal da área (marcado na ficha; sem marca, o primeiro)
  const sel = items.find((i) => i.def.sheet!.main) ?? items[0];
  const ctx = useBookingContext(d.year, d.quarter);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!tv) return;
    const t = setInterval(() => setPage((p) => (p + 1) % 3), 20_000);
    return () => clearInterval(t);
  }, [tv]);
  const wide = items.length >= 7 ? '2xl:grid-cols-7' : items.length === 6 ? '2xl:grid-cols-6' : items.length === 5 ? '2xl:grid-cols-5' : '2xl:grid-cols-4';
  return (
    <div className={clsx(tv && 'kb-tv', className)} role="region" aria-label="Painel de indicadores principais">
      {tv && <TvTitle onExit={onExit} />}
      {!items.length ? (
        <div className="card p-8"><p className="text-md font-bold text-ink">Nenhum indicador principal cadastrado</p><p className="mt-1 text-sm text-muted">Importe as fichas dos KPIs (formulário .xlsx) para o painel começar.</p></div>
      ) : (
        <div className={clsx(tv ? 'flex h-full flex-col gap-4' : 'space-y-4')}>
          <Summary d={d} updatedAt={updatedAt} stale={stale} />
          <section aria-label="Indicadores" className={clsx('grid gap-3', tv ? 'grid-cols-7' : `grid-cols-2 md:grid-cols-4 ${items.length >= 7 ? 'min-[1400px]:grid-cols-7' : wide}`)}>
            {items.map((it) => <KpiCardTile key={it.id} it={it} selected={sel?.id === it.id} onSelect={onOpen && !tv ? () => onOpen(it) : undefined} />)}
          </section>
          {/* em volta do Booking, o que o move: contratos fechados, negociações em andamento e saúde das contas.
              Na TV a parte de baixo alterna entre duas visões para caber numa tela só. */}
          <div className={clsx('grid grid-cols-1 gap-4 xl:grid-cols-12', tv && 'min-h-0 flex-1 xl:grid-rows-1')}>
            {(!tv || page === 0) && <>
              <div className="xl:col-span-8">{sel && (ctx.data && sel.def.period === 'mes' ? <BookingChart it={sel} c={ctx.data} onOpen={tv ? undefined : onOpen} fill={tv} /> : <Evolution it={sel} year={d.year} onOpen={tv ? undefined : onOpen} wide={tv} />)}</div>
              <div className="xl:col-span-4">{ctx.data ? <ClosedContracts c={ctx.data} link={!tv} /> : <div className="card h-full min-h-[200px]" />}</div>
            </>}
            {(!tv || page === 1) && <>
              <div className="xl:col-span-5">{ctx.data ? <OpenPipeline c={ctx.data} link={!tv} /> : <div className="card h-full min-h-[200px]" />}</div>
              <div className="xl:col-span-4">{ctx.data ? <AccountHealth c={ctx.data} link={!tv} /> : <div className="card h-full min-h-[200px]" />}</div>
              <div className="xl:col-span-3"><Attention items={items} /></div>
            </>}
            {!tv && <div className="xl:col-span-12"><Breakdown items={items} year={d.year} onSelect={onOpen} /></div>}
            {tv && page === 2 && <div className="xl:col-span-12"><Breakdown items={items} year={d.year} /></div>}
          </div>
          {tv && <p className="flex items-center justify-center gap-2 text-xs text-faint" aria-hidden>{[0, 1, 2].map((k) => <span key={k} className={clsx('h-1 w-8', page === k ? 'bg-primary' : 'bg-line-strong')} />)}</p>}
        </div>
      )}
    </div>
  );
}
