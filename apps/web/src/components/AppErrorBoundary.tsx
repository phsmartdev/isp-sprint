/**
 * Rede de segurança da tela: um erro de renderização (ou um arquivo de página que sumiu depois de uma publicação nova)
 * não deixa mais a tela em branco. Arquivo de versão antiga → recarrega sozinho uma vez; outro erro → aviso com Recarregar.
 */
import { Component, type ReactNode } from 'react';

const RELOAD_KEY = 'isp:chunk-reload-at';
const isChunkError = (e: unknown) => /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically|ChunkLoadError|Unable to preload CSS/i.test(String((e as Error)?.message ?? e));

/** Recarrega a página uma vez por minuto no máximo (evita laço se o servidor estiver fora). */
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* sem storage: recarrega assim mesmo */ }
  window.location.reload();
  return true;
}

if (typeof window !== 'undefined') {
  // Vite avisa quando um arquivo pré-carregado de uma versão antiga não existe mais
  window.addEventListener('vite:preloadError', (ev) => { if (reloadForNewVersion()) ev.preventDefault(); });
}

export class AppErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown) {
    console.error('[tela]', error);
    if (isChunkError(error)) reloadForNewVersion();
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = isChunkError(this.state.error);
    return (
      <div role="alert" className="m-4 border-l-4 border-primary bg-surface p-5">
        <p className="font-bold text-ink">{chunk ? 'O sistema foi atualizado' : 'Esta tela encontrou um erro'}</p>
        <p className="mt-1 text-sm text-muted">{chunk ? 'Recarregue para usar a versão nova.' : 'Recarregue a página. Se continuar, avise o suporte com o horário e a tela.'}</p>
        {!chunk && <p className="mt-2 font-mono text-2xs text-muted">{String((this.state.error as Error)?.message ?? this.state.error).slice(0, 300)}</p>}
        <button type="button" className="mt-3 bg-primary px-4 py-2 text-sm font-semibold text-white" onClick={() => window.location.reload()}>Recarregar</button>
      </div>
    );
  }
}
