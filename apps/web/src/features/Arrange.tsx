/**
 * Organizar painel: cada pessoa escolhe a ordem e o que aparece (lembrado neste navegador, por usuário).
 * Modo "Organizar": setas para subir/descer e olho para ocultar cada bloco; "Restaurar" volta ao padrão.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, RotateCcw } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';

type Saved = { order: string[]; hidden: string[] };
const read = (k: string): Saved | null => { try { const v = JSON.parse(localStorage.getItem(k) ?? 'null') as Saved | null; return v && Array.isArray(v.order) && Array.isArray(v.hidden) ? v : null; } catch { return null; } };
const write = (k: string, v: Saved | null) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch { /* sem armazenamento */ } };

export function useArrangement(name: string, keys: readonly string[], labels: Record<string, string>) {
  const { me } = useAuth();
  const storeKey = `isp:arrange:${name}:${me?.user.id ?? 'anon'}`;
  const [saved, setSaved] = useState<Saved | null>(() => read(storeKey));
  const [editing, setEditing] = useState(false);
  const order = useMemo(() => {
    const base = saved ? saved.order.filter((k) => keys.includes(k)) : [];
    return [...base, ...keys.filter((k) => !base.includes(k))];
  }, [saved, keys]);
  const hidden = saved?.hidden.filter((k) => keys.includes(k)) ?? [];
  const persist = (v: Saved | null) => { setSaved(v); write(storeKey, v); };
  const move = (k: string, dir: -1 | 1) => {
    const i = order.indexOf(k), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    persist({ order: next, hidden });
  };
  const toggle = (k: string) => persist({ order, hidden: hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k] });
  const isHidden = (k: string) => hidden.includes(k);
  return {
    editing, setEditing, order, hidden, move, toggle, isHidden, customized: !!saved,
    reset: () => persist(null),
    /** Ordem visual dentro de uma grade (CSS order). */
    style: (k: string): CSSProperties => ({ order: order.indexOf(k) }),
    /** Oculto some fora do modo "Organizar"; dentro dele fica esmaecido. */
    cls: (k: string) => (isHidden(k) ? (editing ? 'opacity-40' : 'hidden') : undefined),
    /** Barra de controles do bloco (só no modo "Organizar"). */
    bar: (k: string) => (editing ? <ArrangeBar k={k} label={labels[k] ?? k} first={order.indexOf(k) === 0} last={order.indexOf(k) === order.length - 1} hidden={isHidden(k)} onMove={(d) => move(k, d)} onToggle={() => toggle(k)} /> : null),
  };
}
export type Arrangement = ReturnType<typeof useArrangement>;

function ArrangeBar({ k, label, first, last, hidden, onMove, onToggle }: { k: string; label: string; first: boolean; last: boolean; hidden: boolean; onMove: (d: -1 | 1) => void; onToggle: () => void }) {
  const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line bg-surface text-ink hover:border-primary disabled:opacity-40';
  return (
    <div data-arrange={k} className="mb-2 flex items-center justify-between gap-2 rounded-sm border border-dashed border-primary/60 bg-primary-soft/60 px-2 py-1.5 text-sm">
      <span className="truncate font-semibold text-primary">{label}{hidden ? ' (oculto)' : ''}</span>
      <span className="flex gap-1">
        <button type="button" className={btn} disabled={first} aria-label={`Subir ${label}`} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" /></button>
        <button type="button" className={btn} disabled={last} aria-label={`Descer ${label}`} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" /></button>
        <button type="button" className={btn} aria-label={hidden ? `Mostrar ${label}` : `Ocultar ${label}`} onClick={onToggle}>{hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
      </span>
    </div>
  );
}

/** Botões "Organizar painel" / "Concluir" e "Restaurar padrão". */
export function ArrangeButton({ a, className }: { a: Arrangement; className?: string }): ReactNode {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      {a.editing && a.customized && <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2" onClick={a.reset}><RotateCcw className="h-4 w-4" />Restaurar padrão</button>}
      <button type="button" aria-pressed={a.editing} className={clsx('inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold', a.editing ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink hover:bg-surface-2')} onClick={() => a.setEditing(!a.editing)}>
        <LayoutGrid className="h-4 w-4" />{a.editing ? 'Concluir' : 'Organizar painel'}
      </button>
    </span>
  );
}
