/**
 * "Olhinho" dos valores: oculta os valores em R$ (faturamento, receita, comissões) para apresentar
 * em reunião ou TV. Preferência do navegador; quem chama useMoneyHidden() redesenha ao trocar.
 */
import { useSyncExternalStore } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';

const KEY = 'isp.hideMoney';
let hidden = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
const listeners = new Set<() => void>();

export const moneyHidden = () => hidden;
export function setMoneyHidden(v: boolean) {
  hidden = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* navegador sem armazenamento: vale só nesta aba */ }
  listeners.forEach((l) => l());
}
export function useMoneyHidden() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => hidden, () => false);
}
export const MASK = 'R$ •••••';

export function MoneyToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const h = useMoneyHidden();
  return (
    <button
      type="button"
      onClick={() => setMoneyHidden(!h)}
      aria-pressed={h}
      aria-label={h ? 'Mostrar valores' : 'Ocultar valores'}
      title={h ? 'Mostrar valores' : 'Ocultar valores'}
      className={clsx('inline-flex h-12 items-center gap-2 rounded-md border border-line bg-surface px-4 text-md font-semibold text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary', compact && 'h-10 px-3 text-sm', className)}
    >
      {h ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
      <span className={compact ? 'sr-only sm:not-sr-only' : ''}>{h ? 'Mostrar valores' : 'Ocultar valores'}</span>
    </button>
  );
}
