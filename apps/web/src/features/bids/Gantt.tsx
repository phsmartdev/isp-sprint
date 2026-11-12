/**
 * Gantt do projeto de licitação: estrutura (etapas → macrotarefas) à esquerda e, à direita, a régua de tempo
 * com zoom (dia, semana, mês), barra-resumo de cada etapa, barras das macrotarefas com o progresso das tarefas,
 * marcos do edital, linha de hoje e as setas de dependência. Quem planeja arrasta a barra (move) ou a ponta
 * direita (muda a entrega); a alteração vale só para este projeto.
 */
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ChevronDown, ChevronRight, Diamond } from 'lucide-react';
import { BID_AREA_LABELS, OFFICIAL_DATES, type BidArea, type OfficialDates, type ProjectTaskSpec } from '@isp/domain';
import { fmtDate } from '../../lib/format';

export type GanttRow = { id: string; parentId: string | null; title: string; ownerName: string; startOn: string | null; dueOn: string | null; done: boolean; spec: ProjectTaskSpec | null; milestoneId: string | null; dependsOn: string[] };
export type GanttPhase = { id: string; name: string; dueOn: string | null };
type Zoom = 'dia' | 'semana' | 'mes';
const PX: Record<Zoom, number> = { dia: 34, semana: 14, mes: 5 };
const ROW = 34;
const DAY = 86_400_000;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const t = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const AREA_COLOR: Record<BidArea, string> = {
  comercial: '#2563EB', engenharia: '#0891B2', operacoes: '#0D9488', juridico: '#7C3AED', financeiro: '#CA8A04', fiscal: '#EA580C', compras: '#DB2777', diretoria: '#334155',
};

export function ProjectGantt({ phases, rows, dates, editable, onMove }: { phases: GanttPhase[]; rows: GanttRow[]; dates: OfficialDates; editable: boolean; onMove?: (id: string, startOn: string, dueOn: string) => void }) {
  const [zoom, setZoom] = useState<Zoom>('semana');
  const [closed, setClosed] = useState<string[]>([]);
  const [color, setColor] = useState<'area' | 'situacao'>('area');
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'end'; x0: number; dd: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const today = iso(Date.now());
  const macros = rows.filter((r) => !r.parentId);
  const progress = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of macros) {
      const subs = rows.filter((x) => x.parentId === r.id);
      m.set(r.id, r.done ? 1 : subs.length ? subs.filter((x) => x.done).length / subs.length : 0);
    }
    return m;
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const marks = OFFICIAL_DATES.flatMap((d) => { const date = dates[d.key]?.date; return date ? [{ key: d.key as string, label: d.label as string, date, ok: !!dates[d.key]?.validated }] : []; });
  const all = [...macros.flatMap((r) => [r.startOn, r.dueOn]), ...marks.map((m) => m.date), today].filter(Boolean).sort() as string[];
  const start = t(all[0]!) - 3 * DAY, end = t(all.at(-1)!) + 7 * DAY;
  const days = Math.round((end - start) / DAY);
  const px = PX[zoom];
  const width = days * px;
  const x = (d: string) => ((t(d) - start) / DAY) * px;

  // linhas visíveis: etapa (resumo) e, aberta, suas macrotarefas
  type Line = { kind: 'phase'; ph: GanttPhase; items: GanttRow[] } | { kind: 'task'; r: GanttRow };
  const lines: Line[] = [];
  for (const ph of phases) {
    const items = macros.filter((r) => r.milestoneId === ph.id);
    lines.push({ kind: 'phase', ph, items });
    if (!closed.includes(ph.id)) for (const r of items) lines.push({ kind: 'task', r });
  }
  const rowOf = new Map(lines.flatMap((l, i) => (l.kind === 'task' ? [[l.r.id, i] as const] : [])));

  // régua: meses em cima; dias ou semanas embaixo
  const months: { label: string; left: number; w: number }[] = [];
  const ticks: { label: string; left: number; weekend?: boolean }[] = [];
  for (let d = start; d < end; d += DAY) {
    const dt = new Date(d);
    if (dt.getUTCDate() === 1 || d === start) {
      const next = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1, 12);
      months.push({ label: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, left: ((d - start) / DAY) * px, w: ((Math.min(next, end) - d) / DAY) * px });
    }
    if (zoom === 'dia') ticks.push({ label: `${WD[dt.getUTCDay()]}${dt.getUTCDate()}`, left: ((d - start) / DAY) * px, weekend: dt.getUTCDay() === 0 || dt.getUTCDay() === 6 });
    else if (zoom === 'semana' && dt.getUTCDay() === 1) ticks.push({ label: `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`, left: ((d - start) / DAY) * px });
  }

  const shown = (r: GanttRow) => {
    if (!drag || drag.id !== r.id || !r.startOn || !r.dueOn) return { s: r.startOn, e: r.dueOn };
    return drag.mode === 'move' ? { s: iso(t(r.startOn) + drag.dd * DAY), e: iso(t(r.dueOn) + drag.dd * DAY) } : { s: r.startOn, e: iso(Math.max(t(r.startOn), t(r.dueOn) + drag.dd * DAY)) };
  };
  const down = (e: RPointerEvent, r: GanttRow, mode: 'move' | 'end') => {
    if (!editable || !r.startOn || !r.dueOn || r.done) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: r.id, mode, x0: e.clientX, dd: 0 });
  };
  const moveP = (e: RPointerEvent) => { if (drag) setDrag({ ...drag, dd: Math.round((e.clientX - drag.x0) / px) }); };
  const up = (r: GanttRow) => {
    if (drag && drag.id === r.id && drag.dd && onMove) { const v = shown(r); onMove(r.id, v.s!, v.e!); }
    setDrag(null);
  };
  const late = (r: GanttRow) => !r.done && !!r.dueOn && r.dueOn < today;
  const barColor = (r: GanttRow) => (color === 'area' ? AREA_COLOR[(r.spec?.area ?? 'comercial') as BidArea] : r.done ? '#16A34A' : late(r) ? '#DC2626' : r.spec?.required ? '#2563EB' : '#93A3B8');

  // setas de dependência (fim da predecessora → início da sucessora)
  const arrows = lines.flatMap((l, i) => {
    if (l.kind !== 'task') return [];
    const to = shown(l.r);
    return l.r.dependsOn.flatMap((dep) => {
      const j = rowOf.get(dep);
      const from = macros.find((m) => m.id === dep);
      if (j === undefined || !from?.dueOn || !to.s) return [];
      const fx = x(shown(from).e!) + px, fy = j * ROW + ROW / 2, tx = x(to.s), ty = i * ROW + ROW / 2;
      const conflict = to.s < shown(from).e!;
      const mid = Math.max(fx + 8, tx - 8);
      return [{ d: `M${fx},${fy} H${mid} V${ty} H${tx - 2}`, conflict, key: `${dep}-${l.r.id}` }];
    });
  });

  return (
    <section className="card p-0" aria-label="Gantt do projeto">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <div role="group" aria-label="Zoom do cronograma" className="inline-flex overflow-hidden rounded-md border border-line">
          {(['dia', 'semana', 'mes'] as Zoom[]).map((z) => <button key={z} type="button" aria-pressed={zoom === z} className={`px-3 py-1 text-xs font-semibold ${zoom === z ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2'}`} onClick={() => setZoom(z)}>{z === 'dia' ? 'Dia' : z === 'semana' ? 'Semana' : 'Mês'}</button>)}
        </div>
        <div role="group" aria-label="Cor das barras" className="inline-flex overflow-hidden rounded-md border border-line">
          <button type="button" aria-pressed={color === 'area'} className={`px-3 py-1 text-xs font-semibold ${color === 'area' ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2'}`} onClick={() => setColor('area')}>Por área</button>
          <button type="button" aria-pressed={color === 'situacao'} className={`px-3 py-1 text-xs font-semibold ${color === 'situacao' ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2'}`} onClick={() => setColor('situacao')}>Por situação</button>
        </div>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => { const el = scroller.current; if (el) el.scrollTo({ left: Math.max(0, x(today) - 200), behavior: 'smooth' }); }}>Ir para hoje</button>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setClosed(closed.length ? [] : phases.map((p) => p.id))}>{closed.length ? 'Abrir todas as etapas' : 'Recolher etapas'}</button>
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          {color === 'area' ? (Object.keys(AREA_COLOR) as BidArea[]).filter((a) => macros.some((r) => r.spec?.area === a)).map((a) => <span key={a} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: AREA_COLOR[a] }} />{BID_AREA_LABELS[a]}</span>)
            : [['#2563EB', 'Obrigatória'], ['#93A3B8', 'Opcional'], ['#DC2626', 'Atrasada'], ['#16A34A', 'Concluída']].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
          <span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-danger" />Hoje</span>
          <span className="inline-flex items-center gap-1"><Diamond className="h-3 w-3 fill-warning text-warning" />Marco do edital</span>
        </div>
      </div>

      {/* cabeçalho fora da área que rola (fica sempre visível); a rolagem horizontal acompanha */}
      <div className="flex border-b border-line">
        <div className="grid h-12 w-[22rem] shrink-0 grid-cols-[1fr_6.5rem_4.5rem] items-end gap-2 border-r border-line bg-surface px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted"><span>Etapa / macrotarefa</span><span>Responsável</span><span className="text-right">Entrega</span></div>
        <div className="min-w-0 flex-1 overflow-hidden" ref={head}>
          <div className="relative h-12 bg-surface" style={{ width }}>
            {months.map((m, i) => <div key={i} className="absolute top-0 h-6 truncate border-l border-line px-1.5 text-[11px] font-semibold capitalize text-ink" style={{ left: m.left, width: m.w }}>{m.label}</div>)}
            {ticks.map((k, i) => <div key={i} className={`absolute top-6 h-6 border-l border-line/70 pl-0.5 text-[10px] ${k.weekend ? 'text-muted/60' : 'text-muted'}`} style={{ left: k.left }}>{k.label}</div>)}
            {marks.map((m) => <div key={m.key} className="absolute top-0 -ml-1.5" style={{ left: x(m.date) + px / 2 }} title={`${m.label}: ${fmtDate(m.date)}${m.ok ? ' (validada)' : ' (não validada)'}`}><Diamond className={`h-3 w-3 ${m.ok ? 'fill-warning text-warning' : 'fill-surface text-warning'}`} aria-label={m.label} /></div>)}
          </div>
        </div>
      </div>
      <div className="flex max-h-[70vh] overflow-auto" ref={scroller} onScroll={(e) => { if (head.current) head.current.scrollLeft = e.currentTarget.scrollLeft; }}>
        {/* estrutura */}
        <div className="sticky left-0 z-20 w-[22rem] shrink-0 border-r border-line bg-surface">
          {lines.map((l) => l.kind === 'phase' ? (
            <div key={l.ph.id} className="flex items-center gap-1 border-b border-line bg-surface-2 px-2 text-xs font-bold text-ink" style={{ height: ROW }}>
              <button type="button" aria-label={`${closed.includes(l.ph.id) ? 'Abrir' : 'Recolher'} ${l.ph.name}`} className="text-muted" onClick={() => setClosed(closed.includes(l.ph.id) ? closed.filter((c) => c !== l.ph.id) : [...closed, l.ph.id])}>{closed.includes(l.ph.id) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
              <span className="truncate" title={l.ph.name}>{l.ph.name}</span>
              <span className="ml-auto text-[11px] font-normal text-muted">{l.items.filter((r) => r.done).length}/{l.items.length}</span>
            </div>
          ) : (
            <div key={l.r.id} className="grid grid-cols-[1fr_6.5rem_4.5rem] items-center gap-2 border-b border-line px-3 pl-8 text-xs" style={{ height: ROW }}>
              <span className={`truncate ${l.r.done ? 'text-muted line-through' : 'text-ink'}`} title={l.r.title}>{l.r.title}</span>
              <span className="truncate text-muted" title={l.r.ownerName}>{l.r.ownerName.split(' ')[0]}</span>
              <span className={`text-right tabular-nums ${late(l.r) ? 'font-semibold text-danger' : 'text-muted'}`}>{l.r.dueOn ? fmtDate(l.r.dueOn).slice(0, 5) : '—'}</span>
            </div>
          ))}
        </div>

        {/* linha do tempo */}
        <div className="relative shrink-0" style={{ width }}>
          <div className="relative" style={{ height: lines.length * ROW }}>
            {/* fundo: fins de semana (zoom dia), hoje e marcos */}
            {zoom === 'dia' && ticks.filter((k) => k.weekend).map((k, i) => <div key={i} className="absolute inset-y-0 bg-surface-2/70" style={{ left: k.left, width: px }} aria-hidden />)}
            {lines.map((l, i) => <div key={i} className={`absolute inset-x-0 border-b border-line/60 ${l.kind === 'phase' ? 'bg-surface-2/40' : ''}`} style={{ top: i * ROW, height: ROW }} aria-hidden />)}
            {marks.map((m) => <div key={m.key} className="absolute inset-y-0 w-px bg-warning/70" style={{ left: x(m.date) + px / 2 }} aria-hidden />)}
            <div className="absolute inset-y-0 z-[1] w-0.5 bg-danger" style={{ left: x(today) + px / 2 }} title={`Hoje, ${fmtDate(today)}`} aria-hidden />
            <svg className="pointer-events-none absolute inset-0 z-[2]" width={width} height={lines.length * ROW} aria-hidden>
              <defs><marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#64748B" /></marker><marker id="gantt-arrow-bad" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#DC2626" /></marker></defs>
              {arrows.map((a) => <path key={a.key} d={a.d} fill="none" stroke={a.conflict ? '#DC2626' : '#64748B'} strokeWidth="1.25" strokeDasharray={a.conflict ? '3 2' : undefined} markerEnd={`url(#${a.conflict ? 'gantt-arrow-bad' : 'gantt-arrow'})`} />)}
            </svg>
            {lines.map((l, i) => {
              if (l.kind === 'phase') {
                const ds = l.items.flatMap((r) => [shown(r).s, shown(r).e]).filter(Boolean).sort() as string[];
                if (!ds.length) return null;
                const a = x(ds[0]!), b = x(ds.at(-1)!) + px;
                const done = l.items.length ? l.items.filter((r) => r.done).length / l.items.length : 0;
                return (
                  <div key={`p${l.ph.id}`} className="absolute z-[3]" style={{ top: i * ROW + 11, left: a, width: Math.max(4, b - a), height: 12 }} title={`${l.ph.name}: ${fmtDate(ds[0])} a ${fmtDate(ds.at(-1))}`}>
                    <div className="absolute inset-x-0 top-0 h-2 rounded-sm bg-ink/75"><div className="h-2 rounded-sm bg-success" style={{ width: `${done * 100}%` }} /></div>
                    <div className="absolute left-0 top-0 h-3 w-1 bg-ink/75" /><div className="absolute right-0 top-0 h-3 w-1 bg-ink/75" />
                    {l.ph.dueOn && <Diamond className="absolute -top-0.5 h-3 w-3 fill-ink text-ink" style={{ left: x(l.ph.dueOn) - a + px / 2 - 6 }} aria-hidden />}
                  </div>
                );
              }
              const r = l.r;
              const v = shown(r);
              if (!v.s && !v.e) return null;
              const a = x(v.s ?? v.e!), b = x(v.e ?? v.s!) + px;
              const pr = progress.get(r.id) ?? 0;
              const c = barColor(r);
              return (
                <div key={r.id} className={`group absolute z-[3] flex items-center rounded ${editable && !r.done ? 'cursor-grab active:cursor-grabbing' : ''} ${drag?.id === r.id ? 'ring-2 ring-primary/50' : ''}`}
                  style={{ top: i * ROW + 7, left: a, width: Math.max(6, b - a), height: ROW - 14, background: `${c}33`, border: `1px solid ${c}` }}
                  title={`${r.title}\n${fmtDate(v.s)} a ${fmtDate(v.e)} · ${r.ownerName}${r.spec?.area ? ` · ${BID_AREA_LABELS[r.spec.area]}` : ''} · ${Math.round(pr * 100)}%`}
                  role="img" aria-label={`${r.title}: ${fmtDate(v.s)} a ${fmtDate(v.e)}`}
                  onPointerDown={(e) => down(e, r, 'move')} onPointerMove={moveP} onPointerUp={() => up(r)}>
                  <div className="h-full rounded-l" style={{ width: `${pr * 100}%`, background: c }} />
                  {b - a > 70 && <span className="pointer-events-none absolute left-1.5 truncate text-[10px] font-semibold" style={{ color: pr > 0.5 ? '#fff' : c, maxWidth: b - a - 10 }}>{r.title}</span>}
                  {editable && !r.done && <span className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r opacity-0 group-hover:opacity-100" style={{ background: c }} onPointerDown={(e) => down(e, r, 'end')} onPointerMove={moveP} onPointerUp={() => up(r)} aria-hidden />}
                  {drag?.id === r.id && <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-white">{fmtDate(v.s)} → {fmtDate(v.e)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {editable && <p className="border-t border-line px-4 py-2 text-xs text-muted">Arraste a barra para mover a macrotarefa ou a ponta direita para mudar a entrega. Setas vermelhas tracejadas: a tarefa começa antes da predecessora terminar.</p>}
    </section>
  );
}
