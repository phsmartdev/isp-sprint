import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Button } from './primitives';

const br = (iso: string) => iso.split('-').reverse().join('/');
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Seletor de período (datas locais). Botão no formato do design: "01/05/2025 - 31/05/2025".
 * Com `emptyLabel`, o período pode ficar vazio (ex.: "Todo o período"), com um atalho para limpar.
 */
export function DateRange({ from, to, onChange, emptyLabel, label }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void; emptyLabel?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setF(from); setT(to); }, [from, to]);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const now = new Date();
  const presets = [
    { label: 'Este mês', from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) },
    { label: 'Mês passado', from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) },
    { label: 'Últimos 30 dias', from: iso(new Date(now.getTime() - 29 * 86_400_000)), to: iso(now) },
    { label: 'Últimos 90 dias', from: iso(new Date(now.getTime() - 89 * 86_400_000)), to: iso(now) },
  ];
  return (
    <div className="relative" ref={ref}>
      <button
        className="flex h-12 items-center gap-3 rounded-md border border-line bg-surface px-4 text-sm text-text shadow-card hover:border-line-strong"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label ? `${label}: ${from && to ? `${br(from)} a ${br(to)}` : emptyLabel ?? ''}` : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarDays className="h-5 w-5 text-ink" aria-hidden />
        {label && <span className="text-muted">{label}</span>}
        <span className="num">{from && to ? `${br(from)} - ${br(to)}` : emptyLabel}</span>
        <ChevronDown className="h-4 w-4 text-ink" aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label="Escolher período" className="absolute right-0 z-30 mt-2 w-[300px] rounded-md border border-line bg-surface p-4 shadow-overlay">
          <div className="mb-3 flex flex-wrap gap-2">
            {emptyLabel && <button className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:border-primary hover:text-primary" onClick={() => { onChange({ from: '', to: '' }); setOpen(false); }}>{emptyLabel}</button>}
            {presets.map((p) => (
              <button key={p.label} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:border-primary hover:text-primary" onClick={() => { onChange({ from: p.from, to: p.to }); setOpen(false); }}>{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-ink">De<input type="date" className="field-input mt-1 h-9" value={f} max={t} onChange={(e) => setF(e.target.value)} /></label>
            <label className="text-xs font-semibold text-ink">Até<input type="date" className="field-input mt-1 h-9" value={t} min={f} onChange={(e) => setT(e.target.value)} /></label>
          </div>
          <Button variant="primary" size="sm" className="mt-3 w-full" disabled={!f || !t || f > t} onClick={() => { onChange({ from: f, to: t }); setOpen(false); }}>Aplicar período</Button>
        </div>
      )}
    </div>
  );
}
