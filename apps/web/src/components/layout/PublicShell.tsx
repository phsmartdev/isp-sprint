/**
 * Moldura das páginas abertas ao cliente (pesquisa, avisos, trilha da jornada): identidade BKT com a marca oficial,
 * faixa azul com o grafismo de hexágonos e rodapé discreto.
 */
import type { ReactNode } from 'react';
import { Hexagons, Logo } from '../brand';

export function PublicShell({ children, kicker, width = 'max-w-2xl' }: { children: ReactNode; kicker?: string; width?: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="relative overflow-hidden bg-gradient-to-br from-navy to-navy-active">
        <Hexagons className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 opacity-70 sm:h-80 sm:w-80" />
        <div className={`relative mx-auto flex ${width} items-center justify-between gap-4 px-4 py-6 sm:px-8 sm:py-8`}>
          <Logo variant="white" className="!h-9 sm:!h-11" />
          {kicker && <p className="text-right text-sm font-semibold text-white/80">{kicker}</p>}
        </div>
        <span className="block h-1 bg-lime" aria-hidden />
      </header>
      <main className={`mx-auto w-full ${width} flex-1 p-4 sm:p-8`}>{children}</main>
      <footer className="border-t border-line py-4"><Logo variant="color" className="mx-auto !h-5 opacity-70" /></footer>
    </div>
  );
}
