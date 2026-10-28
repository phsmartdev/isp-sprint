/**
 * Tema claro ou escuro, escolhido por pessoa neste navegador (conveniência: sem armazenamento vale o claro).
 * "auto" segue o sistema operacional e acompanha a troca dele. O index.html aplica o tema antes da primeira pintura.
 */
import { useEffect, useState } from 'react';

export type ThemeChoice = 'claro' | 'escuro' | 'auto';
const KEY = 'isp:theme';
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function readTheme(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'escuro' || v === 'auto' ? v : 'claro'; } catch { return 'claro'; }
}
function apply(choice: ThemeChoice) {
  const dark = choice === 'escuro' || (choice === 'auto' && !!media()?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'dark' : 'light');
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    apply(choice);
    if (choice !== 'auto') return;
    const m = media();
    const on = () => apply('auto');
    m?.addEventListener('change', on);
    return () => m?.removeEventListener('change', on);
  }, [choice]);
  const set = (c: ThemeChoice) => { try { localStorage.setItem(KEY, c); } catch { /* sem armazenamento: vale só nesta aba */ } setChoice(c); };
  return [choice, set] as const;
}
