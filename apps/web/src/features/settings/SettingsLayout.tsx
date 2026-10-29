/** Moldura de Configurações: título e descrição da página, as páginas irmãs do grupo e o índice da página. As telas carregam sob demanda. */
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Settings } from 'lucide-react';
import { LoadingRows } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';
import { settingsLocate } from './nav';

export function SettingsLayout() {
  const loc = useLocation();
  const hit = settingsLocate(loc.pathname);
  const group = hit?.group;
  return (
    <div className="w-full">
      <PageHeader icon={<Settings className="h-9 w-9" strokeWidth={2.2} />} title={hit?.item.label ?? 'Configuração'} subtitle={hit?.item.desc ?? 'Gerencie os parâmetros da plataforma.'} />
      {group && (
        <nav aria-label={`Páginas de ${group.label}`} className="scroll-thin mb-5 flex items-end gap-5 overflow-x-auto border-b border-line">
          <span className="whitespace-nowrap pb-3 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</span>
          {group.items.map((t) => (
            <NavLink key={t.to} to={t.to} end className={({ isActive }) => clsx('-mb-px whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-md', isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-ink')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
      <PageSections key={loc.pathname} />
      <div id="settings-page"><Suspense fallback={<div className="card"><LoadingRows rows={6} /></div>}><Outlet /></Suspense></div>
    </div>
  );
}

/**
 * Índice da página: quando ela tem 4 ou mais seções (títulos de card), mostra atalhos para pular até cada uma.
 * Lê os títulos depois que a página carrega (e quando ela muda), sem cada página precisar declarar nada.
 */
function PageSections() {
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    const root = document.getElementById('settings-page');
    if (!root) return;
    const scan = () => {
      const seen = new Set<string>();
      const found = [...root.querySelectorAll<HTMLElement>('section h2, section h3')]
        .filter((h) => !h.closest('[role="dialog"]') && h.textContent && h.textContent.trim().length <= 60)
        .map((h) => {
          const label = h.textContent!.trim();
          if (!h.id) h.id = `sec-${label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
          return { id: h.id, label };
        })
        .filter((x) => (seen.has(x.label) ? false : (seen.add(x.label), true)));
      setItems((cur) => (JSON.stringify(cur) === JSON.stringify(found) ? cur : found));
    };
    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  if (items.length < 4) return null;
  return (
    <nav aria-label="Nesta página" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-semibold text-muted">Nesta página:</span>
      {items.map((x) => (
        <a key={x.id} href={`#${x.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="border border-line bg-surface px-2.5 py-1 text-text hover:border-primary hover:text-primary">{x.label}</a>
      ))}
    </nav>
  );
}

