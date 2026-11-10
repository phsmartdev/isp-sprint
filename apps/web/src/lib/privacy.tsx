/**
 * "Olhinho" dos valores: os valores em R$ começam OCULTOS sempre que o sistema é aberto (ou recarregado);
 * o botão no topo de todas as telas mostra/oculta. A escolha vale só enquanto a aba está aberta (não é guardada).
 * Quem chama useMoneyHidden() redesenha ao trocar.
 * Navegador automatizado (testes E2E, navigator.webdriver) começa com os valores à mostra, salvo se o teste pedir
 * o padrão real com localStorage "isp.e2e.hideMoney" = "1".
 */
import { useSyncExternalStore } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';

let hidden = (() => {
  try { if (navigator.webdriver) return localStorage.getItem('isp.e2e.hideMoney') === '1'; } catch { /* sem armazenamento */ }
  return true;
})();
const listeners = new Set<() => void>();

export const moneyHidden = () => hidden;
export function setMoneyHidden(v: boolean) {
  hidden = v;
  listeners.forEach((l) => l());
}
export function useMoneyHidden() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => hidden, () => true);
}
export const MASK = 'R$ •••••';

/** Botão do topo (todas as telas): só o ícone, no padrão do sino. */
export function HeaderMoneyToggle() {
  const h = useMoneyHidden();
  const label = h ? 'Mostrar valores' : 'Ocultar valores';
  return (
    <button type="button" onClick={() => setMoneyHidden(!h)} aria-pressed={h} aria-label={label} title={`${label} em R$`}
      className="flex h-11 w-11 items-center justify-center rounded-circle text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      {h ? <EyeOff className="h-6 w-6" strokeWidth={1.6} aria-hidden /> : <Eye className="h-6 w-6" strokeWidth={1.6} aria-hidden />}
    </button>
  );
}

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
