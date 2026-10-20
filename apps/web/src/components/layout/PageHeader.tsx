import type { ReactNode } from 'react';
import type { BrandSlot } from '@isp/shared';

/** Cabeçalho das telas: ícone + título grande, subtítulo, mascote com balão fixo e ações. */
export function PageHeader({ icon, title, subtitle, actions }: { icon: ReactNode; title: string; subtitle: string; mascot?: { slot: BrandSlot; lines: string[]; highlight: ReactNode }; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-navy text-lime [&>svg]:h-7 [&>svg]:w-7" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <h1 className="font-display text-[1.65rem] font-bold leading-tight tracking-wide text-ink">{title}</h1>
          <p className="mt-0.5 text-md text-muted">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}
