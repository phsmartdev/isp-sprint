/**
 * Modo TV: tela cheia para apresentar relatórios numa TV.
 * Usa a API de tela cheia do navegador (cai num painel fixo quando ela não existe, ex.: iPhone),
 * atualiza os dados sozinho e pode alternar as abas.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { MoneyToggle } from '../lib/privacy';

export function useTvMode(ref: RefObject<HTMLElement>) {
  const [active, setActive] = useState(false);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const on = () => setActive(document.fullscreenElement === ref.current && !!ref.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [ref]);
  useEffect(() => {
    if (!fallback) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setFallback(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [fallback]);
  const enter = useCallback(async () => {
    const el = ref.current;
    if (el?.requestFullscreen) {
      try { await el.requestFullscreen({ navigationUI: 'hide' }); return; } catch { /* bloqueado: usa o painel fixo */ }
    }
    setFallback(true);
  }, [ref]);
  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    setFallback(false);
  }, []);
  return { active: active || fallback, fallback, enter, exit };
}

export function TvButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-12 items-center gap-2 rounded-md border border-line bg-surface px-4 text-md font-semibold text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <Maximize2 className="h-5 w-5" aria-hidden />Tela cheia
    </button>
  );
}

const ROTATE_SECONDS = 30;
const REFRESH_MINUTES = 5;

/** Barra do modo TV: título, período, relógio, alternar abas, olhinho e sair. */
export function TvBar<T extends string>({ title, period, tabs, tab, onTab, onExit, queryKeys }: { title: string; period: string; tabs: { key: T; label: string }[]; tab: T; onTab: (t: T) => void; onExit: () => void; queryKeys: unknown[][] }) {
  const qc = useQueryClient();
  const [rotate, setRotate] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const t = setInterval(() => { for (const k of queryKeys) void qc.invalidateQueries({ queryKey: k }); setRefreshedAt(new Date()); }, REFRESH_MINUTES * 60_000);
    return () => clearInterval(t);
  }, [qc, queryKeys]);
  useEffect(() => {
    if (!rotate || tabs.length < 2) return;
    const t = setInterval(() => { const i = tabs.findIndex((x) => x.key === tabRef.current); onTab(tabs[(i + 1) % tabs.length]!.key); }, ROTATE_SECONDS * 1000);
    return () => clearInterval(t);
  }, [rotate, tabs, onTab]);
  const time = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg bg-navy px-6 py-4 text-white">
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-extrabold leading-tight">{title} <span className="font-semibold text-lime">· {tabs.find((x) => x.key === tab)?.label}</span></p>
        <p className="text-md text-white/80">{period} · atualizado às {time(refreshedAt)} (a cada {REFRESH_MINUTES} min)</p>
      </div>
      <p className="num text-3xl font-extrabold tabular-nums" aria-label="Hora atual">{time(now)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-white/10 px-3 text-sm font-semibold hover:bg-white/15">
          <input type="checkbox" className="h-4 w-4 accent-[#4FBBFF]" checked={rotate} onChange={(e) => setRotate(e.target.checked)} />
          <RefreshCw className="h-4 w-4" aria-hidden />Alternar abas ({ROTATE_SECONDS}s)
        </label>
        <MoneyToggle compact className="border-white/20 bg-white/10 text-white hover:bg-white/15" />
        <button type="button" onClick={onExit} className="inline-flex h-10 items-center gap-2 rounded-md bg-lime px-3 text-sm font-bold text-navy hover:brightness-95">
          <Minimize2 className="h-4 w-4" aria-hidden />Sair (Esc)
        </button>
      </div>
    </div>
  );
}

/** Área que vira tela cheia. */
export function TvArea({ innerRef, active, fallback, children }: { innerRef: RefObject<HTMLDivElement>; active: boolean; fallback: boolean; children: ReactNode }) {
  return (
    <div
      ref={innerRef}
      className={clsx(active && 'overflow-y-auto bg-bg p-6 [@media(min-width:1800px)]:[zoom:1.2]', fallback && 'fixed inset-0 z-[60]')}
    >
      {children}
    </div>
  );
}
