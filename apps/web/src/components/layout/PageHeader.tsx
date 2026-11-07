import { createContext, useContext, type ReactNode } from 'react';
import type { BrandSlot } from '@isp/shared';

/** Dentro de uma tela com abas (ex.: Gestão de Times → Pessoas), a tela embutida não repete o cabeçalho: mostra só as ações. */
export const EmbeddedPage = createContext(false);

/** Cabeçalho das telas: ícone + título grande, subtítulo, mascote com balão fixo e ações. */
export function PageHeader({ icon, title, subtitle, actions }: { icon: ReactNode; title: string; subtitle: string; mascot?: { slot: BrandSlot; lines: string[]; highlight: ReactNode }; actions?: ReactNode }) {
  const embedded = useContext(EmbeddedPage);
  if (embedded) return actions ? <div className="mb-4 flex flex-wrap items-center justify-end gap-3">{actions}</div> : null;
  return (
    <header className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex min-w-[min(100%,20rem)] flex-1 items-start gap-3 sm:gap-4">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 sm:h-12 sm:w-12 items-center justify-center rounded-md bg-navy text-lime [&>svg]:h-7 [&>svg]:w-7" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <h1 className="break-words font-display text-[1.35rem] font-bold leading-tight tracking-wide text-ink sm:text-[1.65rem]">{title}</h1>
          <p className="mt-0.5 text-sm text-muted sm:text-md">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3 sm:ml-auto">{actions}</div>}
    </header>
  );
}
