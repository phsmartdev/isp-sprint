/**
 * Funcionalidade 01 — Trilha Visual da Jornada. Um caminho em serpentina com os marcos reais como paradas:
 * o trecho percorrido se desenha até "onde estamos"; concluídos, atrasados, o atual e os próximos ficam distintos.
 * Desenhado na largura real do contêiner (texto legível no celular). Respeita "reduzir movimento".
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { STOP_STATUS_LABELS, type JourneyPhase, type StopStatus } from '@isp/domain';
import { fmtDate } from '../../lib/format';

export type TrailStop = { id: string; title: string; phase: JourneyPhase; status: StopStatus; plannedAt: string | null; doneAt: string | null; notes?: string | null; ownerName?: string | null };
export type TrailData = { stops: TrailStop[]; phases: { key: JourneyPhase; label: string }[]; currentIndex: number | null; done: number; total: number; late: number; pct: number; finished: boolean };

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (!e) return; const nw = Math.round(e.contentRect.width); if (nw > 0) setW((o) => (Math.abs(o - nw) > 2 ? nw : o)); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
/** Quebra o título em até 2 linhas de ~n caracteres (com reticências). */
function wrap(t: string, n: number) {
  const words = t.split(/\s+/); const lines: string[] = [''];
  for (const w of words) { const cur = lines[lines.length - 1]!; if ((cur + ' ' + w).trim().length <= n) lines[lines.length - 1] = (cur + ' ' + w).trim(); else if (lines.length < 2) lines.push(w); else { lines[1] = `${lines[1]!.slice(0, n - 1)}…`; break; } }
  return lines;
}
const dateLine = (s: TrailStop) => (s.doneAt ? `feito ${fmtDate(s.doneAt).slice(0, 5)}` : s.plannedAt ? `prev. ${fmtDate(s.plannedAt).slice(0, 5)}` : 'sem data');

export function JourneyTrail({ data, selectedId, onSelect, large, dark, animate = true, maxHeight }: { data: TrailData; selectedId?: string | null; onSelect?: (id: string) => void; large?: boolean; dark?: boolean; animate?: boolean; maxHeight?: string }) {
  const [box, W] = useWidth(900);
  const n = data.stops.length;
  const pad = large ? 70 : W < 520 ? 34 : 56;
  const minCell = large ? 210 : W < 520 ? 120 : 150;
  const cols = Math.max(2, Math.min(n || 2, large ? 6 : 7, Math.floor((W - pad * 2) / minCell)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const rowH = large ? 190 : W < 520 ? 140 : 150;
  const top = large ? 70 : 54;
  const H = top + (rows - 1) * rowH + (large ? 110 : 92);
  const cellW = (W - pad * 2) / cols;
  const R = large ? 22 : W < 520 ? 14 : 16;
  const pts = data.stops.map((_, i) => { const r = Math.floor(i / cols); const c = i % cols; const col = r % 2 === 0 ? c : cols - 1 - c; return { x: pad + (col + 0.5) * cellW, y: top + r * rowH, r }; });
  const seg = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }, i: number) => {
    if (a.r === b.r) { const mx = (a.x + b.x) / 2; const wave = (i % 2 ? 1 : -1) * (large ? 16 : 12); return `Q ${mx} ${a.y + wave} ${b.x} ${b.y}`; }
    const dir = a.r % 2 === 0 ? 1 : -1; const out = a.x + dir * Math.min(pad + cellW * 0.35, cellW * 0.6);
    return `C ${out} ${a.y} ${out} ${b.y} ${b.x} ${b.y}`;
  };
  const pathTo = (k: number) => (pts.length ? `M ${pts[0]!.x} ${pts[0]!.y} ${pts.slice(1, k + 1).map((p, i) => seg(pts[i]!, p, i)).join(' ')}` : '');
  const reached = data.finished ? n - 1 : Math.max(0, data.currentIndex ?? 0);
  const firstOfPhase = new Set(data.phases.map((ph) => data.stops.findIndex((s) => s.phase === ph.key)).filter((i) => i >= 0));
  const phaseLabel = (k: JourneyPhase) => data.phases.find((p) => p.key === k)?.label ?? k;
  const chars = Math.max(10, Math.floor((cellW - 12) / (large ? 9.5 : W < 520 ? 7.4 : 7)));
  const ink = dark ? 'fill-white' : 'fill-ink';
  const muted = dark ? 'fill-white/60' : 'fill-muted';
  const anim = animate ? '' : '[&_.trail-progress]:![animation:none] [&_.trail-progress]:![stroke-dashoffset:0] [&_.trail-stop]:![animation:none] [&_.trail-stop]:!opacity-100';
  return (
    <div ref={box} className={clsx('w-full', anim)}>
      {n === 0 ? <p className={clsx('py-8 text-center text-sm', dark ? 'text-white/70' : 'text-muted')}>A jornada ainda não tem marcos.</p> : (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mx-auto block max-w-full select-none" style={maxHeight ? { maxHeight, width: 'auto', height: 'auto' } : undefined} role="group" aria-label={`Trilha da jornada: ${data.done} de ${data.total} marcos concluídos${data.late ? `, ${data.late} atrasado(s)` : ''}`}>
          <path d={pathTo(n - 1)} fill="none" className={dark ? 'stroke-white/25' : 'stroke-line-strong'} strokeWidth={large ? 6 : 4} strokeDasharray={large ? '2 12' : '2 9'} strokeLinecap="round" />
          {reached > 0 && <path key={`p-${reached}-${W}`} d={pathTo(reached)} pathLength={1} fill="none" className={clsx('trail-progress', dark ? 'stroke-lime' : 'stroke-primary')} strokeWidth={large ? 8 : 6} strokeLinecap="round" />}
          {data.stops.map((s, i) => {
            const p = pts[i]!; const sel = s.id === selectedId; const cur = i === data.currentIndex;
            const fill = s.status === 'concluido' ? 'fill-success' : s.status === 'atrasado' ? 'fill-danger' : s.status === 'atual' ? (dark ? 'fill-lime' : 'fill-primary') : dark ? 'fill-navy' : 'fill-surface';
            const stroke = s.status === 'proximo' ? (dark ? 'stroke-white/50' : 'stroke-line-strong') : dark ? 'stroke-navy' : 'stroke-surface';
            const lines = wrap(s.title, chars);
            const label = `${s.title}: ${STOP_STATUS_LABELS[s.status]}${s.doneAt ? `, concluído em ${fmtDate(s.doneAt)}` : s.plannedAt ? `, previsto para ${fmtDate(s.plannedAt)}` : ''}`;
            return (
              <g key={s.id} role={onSelect ? 'button' : 'img'} tabIndex={onSelect ? 0 : undefined} aria-label={label} aria-pressed={onSelect ? sel : undefined}
                className={clsx(onSelect && 'cursor-pointer outline-none [&:focus-visible>circle.ring]:opacity-100')} onClick={() => onSelect?.(s.id)}
                onKeyDown={(e) => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(s.id); } }}>
                {firstOfPhase.has(i) && (
                  <g className="trail-stop" style={{ animationDelay: `${0.2 + i * 0.07}s` }}>
                    <text x={p.x} y={p.y - R - (large ? 18 : 14)} textAnchor="middle" className={clsx('font-display font-bold', large ? 'text-[15px]' : 'text-[11px]', dark ? 'fill-lime' : 'fill-primary')}>{phaseLabel(s.phase)}</text>
                  </g>
                )}
                <g className="trail-stop" style={{ animationDelay: `${0.2 + i * 0.07}s` }}>
                  {cur && !data.finished && <circle cx={p.x} cy={p.y} r={R} className={clsx('trail-pulse', s.status === 'atrasado' ? 'fill-danger' : dark ? 'fill-lime' : 'fill-primary')} />}
                  <circle className={clsx('ring opacity-0 transition-opacity', dark ? 'stroke-white' : 'stroke-focus')} cx={p.x} cy={p.y} r={R + 6} fill="none" strokeWidth={2.5} style={sel ? { opacity: 1 } : undefined} />
                  <circle cx={p.x} cy={p.y} r={sel ? R + 2 : R} className={clsx(fill, stroke, 'transition-all')} strokeWidth={3} />
                  {s.status === 'concluido' ? <path d={`M ${p.x - R * 0.4} ${p.y} l ${R * 0.28} ${R * 0.3} l ${R * 0.52} -${R * 0.6}`} fill="none" className="stroke-white" strokeWidth={large ? 3.5 : 2.8} strokeLinecap="round" strokeLinejoin="round" />
                    : s.status === 'atrasado' ? <text x={p.x} y={p.y + (large ? 6 : 4.5)} textAnchor="middle" className={clsx('fill-white font-bold', large ? 'text-[18px]' : 'text-[13px]')}>!</text>
                    : <text x={p.x} y={p.y + (large ? 5.5 : 4)} textAnchor="middle" className={clsx('num font-bold', large ? 'text-[15px]' : 'text-[11px]', s.status === 'atual' ? (dark ? 'fill-navy' : 'fill-white') : muted)}>{i + 1}</text>}
                  {lines.map((l, k) => <text key={k} x={p.x} y={p.y + R + (large ? 26 : 18) + k * (large ? 20 : 14)} textAnchor="middle" className={clsx(large ? 'text-[16px]' : 'text-[11.5px]', sel || cur ? 'font-bold' : 'font-semibold', s.status === 'concluido' ? muted : ink)}>{l}</text>)}
                  <text x={p.x} y={p.y + R + (large ? 26 : 18) + lines.length * (large ? 20 : 14)} textAnchor="middle" className={clsx('num', large ? 'text-[13px]' : 'text-[10px]', s.status === 'atrasado' ? 'fill-danger font-bold' : muted)}>{s.status === 'atrasado' ? `atrasado · ${dateLine(s)}` : dateLine(s)}</text>
                  {cur && !data.finished && (
                    <g>
                      <rect x={p.x - (large ? 62 : 46)} y={p.y - R - (firstOfPhase.has(i) ? (large ? 58 : 44) : (large ? 40 : 30))} width={large ? 124 : 92} height={large ? 26 : 19} rx={large ? 13 : 9.5} className={s.status === 'atrasado' ? 'fill-danger' : dark ? 'fill-lime' : 'fill-primary'} />
                      <text x={p.x} y={p.y - R - (firstOfPhase.has(i) ? (large ? 58 : 44) : (large ? 40 : 30)) + (large ? 18 : 13.5)} textAnchor="middle" className={clsx('font-bold', large ? 'text-[13px]' : 'text-[10px]', !dark || s.status === 'atrasado' ? 'fill-white' : 'fill-navy')}>Estamos aqui</text>
                    </g>
                  )}
                </g>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Legenda curta das cores da trilha. */
export function TrailLegend({ dark }: { dark?: boolean }) {
  const item = (cls: string, l: string) => <span className="inline-flex items-center gap-1.5"><span className={clsx('inline-block h-2.5 w-2.5 rounded-full', cls)} />{l}</span>;
  return <p className={clsx('flex flex-wrap gap-x-4 gap-y-1 text-xs', dark ? 'text-white/70' : 'text-muted')}>{item('bg-success', 'Concluído')}{item(dark ? 'bg-lime' : 'bg-primary', 'Estamos aqui')}{item('bg-danger', 'Atrasado')}{item(dark ? 'border border-white/50' : 'border border-line-strong bg-surface', 'Próximos')}</p>;
}

/**
 * Modo "Apresentar jornada": tela cheia, passo a passo — visão geral e depois cada marco, com a trilha acompanhando.
 * Observações internas ficam ocultas até quem apresenta escolher mostrar.
 */
export function JourneyPresenter({ data, client, subtitle, onClose, allowNotes = true }: { data: TrailData; client: string; subtitle?: string; onClose: () => void; allowNotes?: boolean }) {
  const [step, setStep] = useState(0); // 0 = visão geral; k = marco k-1
  const [notes, setNotes] = useState(false);
  const last = data.stops.length;
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); setStep((x) => Math.min(last, x + 1)); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setStep((x) => Math.max(0, x - 1));
      if (e.key === 'Home') setStep(0);
      if (e.key === 'End') setStep(last);
      if (e.key === 'Escape') onClose();
    };
    const fs = () => { if (!document.fullscreenElement) onClose(); };
    window.addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', fs);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', fs); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = step > 0 ? data.stops[step - 1] : null;
  const next = data.currentIndex !== null ? data.stops[data.currentIndex] : null;
  const Big = ({ v, l }: { v: ReactNode; l: string }) => <div><p className="num font-display text-4xl font-bold text-white sm:text-5xl">{v}</p><p className="text-sm text-white/70">{l}</p></div>;
  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-navy text-white" role="dialog" aria-modal="true" aria-label="Apresentar jornada">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-10">
        <div className="min-w-0"><p className="font-display text-xl font-bold sm:text-2xl">{client}</p>{subtitle && <p className="text-sm text-white/70">{subtitle}</p>}</div>
        <div className="flex items-center gap-4">
          {allowNotes && <label className="flex items-center gap-2 text-sm text-white/80"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />Mostrar observações internas</label>}
          <button type="button" aria-label="Sair da apresentação" className="rounded-full p-2 hover:bg-white/10" onClick={onClose}><X className="h-6 w-6" /></button>
        </div>
      </header>
      <div className="px-3 sm:px-8"><JourneyTrail data={data} large dark maxHeight="52vh" selectedId={s?.id ?? null} onSelect={(id) => setStep(data.stops.findIndex((x) => x.id === id) + 1)} /></div>
      <section className="mx-auto mt-2 w-full max-w-4xl flex-1 px-5 pb-28 sm:px-10" aria-live="polite">
        {!s ? (
          <div className="space-y-6">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">{data.finished ? 'Jornada concluída' : 'Onde estamos na jornada'}</h2>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4"><Big v={`${data.pct}%`} l="concluído" /><Big v={data.done} l={`de ${data.total} marcos`} /><Big v={data.late} l="atrasado(s)" /><Big v={data.total - data.done} l="pela frente" /></div>
            {next && <p className="text-lg text-white/85">Próximo passo: <b className="text-white">{next.title}</b>{next.plannedAt && ` · ${fmtDate(next.plannedAt)}`}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-display text-sm font-bold text-lime">{data.phases.find((p) => p.key === s.phase)?.label} · marco {step} de {last}</p>
            <h2 className="font-display text-3xl font-bold sm:text-4xl">{s.title}</h2>
            <p className={clsx('text-lg', s.status === 'atrasado' ? 'font-bold text-[#FF8A80]' : 'text-white/85')}>
              {STOP_STATUS_LABELS[s.status]}{s.doneAt ? ` em ${fmtDate(s.doneAt)}` : s.plannedAt ? ` · previsto para ${fmtDate(s.plannedAt)}` : ' · sem data definida'}
            </p>
            {notes && s.notes && <p className="max-w-3xl whitespace-pre-line rounded-md bg-white/10 p-4 text-white/90">{s.notes}</p>}
          </div>
        )}
      </section>
      <nav className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full bg-white/10 px-5 py-2 backdrop-blur" aria-label="Navegação da apresentação">
        <button type="button" aria-label="Anterior" disabled={step === 0} className="disabled:opacity-40" onClick={() => setStep(step - 1)}><ChevronLeft className="h-6 w-6" /></button>
        <span className="num text-sm">{step === 0 ? 'Visão geral' : `${step} / ${last}`}</span>
        <button type="button" aria-label="Próximo" disabled={step >= last} className="disabled:opacity-40" onClick={() => setStep(step + 1)}><ChevronRight className="h-6 w-6" /></button>
      </nav>
    </div>
  );
}
