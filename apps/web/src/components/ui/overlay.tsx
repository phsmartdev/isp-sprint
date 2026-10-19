import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { Button } from './primitives';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Foco preso no diálogo, Esc fecha, foco volta ao gatilho ao fechar. */
function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose costuma ser uma função nova a cada render (a cada tecla digitada). Guardado em ref,
  // o efeito só roda ao abrir/fechar: não rouba o foco do campo nem "reabre" o diálogo.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const a = items[0]!, b = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);
  return ref;
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useDialogFocus(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" className={clsx('flex max-h-[92vh] w-full flex-col rounded-t-lg bg-surface shadow-overlay sm:rounded-lg', size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-3xl' : size === 'xl' ? 'sm:max-w-6xl' : 'sm:max-w-xl')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="modal-title" className="text-lg font-bold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: 'md' | 'lg' }) {
  const ref = useDialogFocus(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="drawer-title" className={clsx('flex h-full w-full flex-col bg-surface shadow-overlay', width === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="drawer-title" className="text-lg font-bold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel, tone = 'primary', loading, confirmDisabled }: { open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; tone?: 'primary' | 'danger'; loading?: boolean; confirmDisabled?: boolean }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm" footer={<><Button onClick={onCancel}>Cancelar</Button><Button variant={tone} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>{confirmLabel}</Button></>}>
      <div className="space-y-3 text-base">{children}</div>
    </Modal>
  );
}

type ToastItem = { id: number; tone: 'success' | 'error'; message: string };
const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2.5 shadow-overlay">
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />}
            <p className="flex-1 text-sm">{t.message}</p>
            <button className="text-muted hover:text-ink" aria-label="Dispensar" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
