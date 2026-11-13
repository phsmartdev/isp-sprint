import { createContext, useContext, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import type { BrandSlot } from '@isp/shared';
import { useLookups } from '../lib/hooks';

/**
 * Espaços de imagem da Personalização. Nenhuma imagem fica fixa no código:
 * sem upload, o espaço fica vazio ou mostra só o texto, sem quebrar o layout.
 */
const BrandCtx = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => {} });

export function BrandProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(() => Date.now());
  return <BrandCtx.Provider value={{ version, bump: () => setVersion(Date.now()) }}>{children}</BrandCtx.Provider>;
}
export const useBrand = () => useContext(BrandCtx);

export function BrandImage({ slot, alt = '', className, publicAsset, fallback = null }: { slot: BrandSlot; alt?: string; className?: string; publicAsset?: boolean; fallback?: ReactNode }) {
  const { version } = useBrand();
  const [failedFor, setFailedFor] = useState<number | null>(null);
  if (failedFor === version) return <>{fallback}</>;
  return (
    <img
      src={`/api/v1/${publicAsset ? 'public/brand' : 'brand'}/${slot}?v=${version}`}
      alt={alt}
      className={className}
      onError={() => setFailedFor(version)}
    />
  );
}

/** Logotipo oficial BKT (arquivos extraídos do Brand Book: símbolo azul + letras grafite, ou versão negativa branca). */
export function Logo({ className, variant = 'white' }: { publicAsset?: boolean; className?: string; variant?: 'white' | 'color' }) {
  return <img src={variant === 'white' ? '/brand/bkt-logo-white.png' : '/brand/bkt-logo.png'} alt="BKT" className={clsx('h-9 w-auto select-none object-contain', className)} draggable={false} />;
}

/**
 * Grafismo BKT: hexágonos (forma essencial do símbolo) em contorno e preenchimento, em ângulos e escalas diferentes.
 * Só decorativo (aria-hidden). `tone` muda as cores para fundo escuro ou claro.
 */
/**
 * Símbolo BKT (3D) como elemento gráfico. Duas versões, sem deformar nem recolorir a forma:
 * a original (azul, para fundos claros) e a negativa (branca com as faces do 3D, para fundos escuros).
 */
export function BrandSymbol({ className, variant = 'original' }: { className?: string; variant?: 'original' | 'negativo' }) {
  return <img src={variant === 'negativo' ? '/brand/bkt-symbol-3d-white.png' : '/brand/bkt-symbol-3d.png'} alt="" aria-hidden draggable={false} className={clsx('pointer-events-none select-none object-contain', className)} />;
}

/**
 * Marca-d'água de fundo: um único símbolo grande, cortado pela borda e bem discreto.
 * (Mantém o nome antigo "Hexagons" para as telas que já usam o fundo.)
 */
export function Hexagons({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <div className={clsx('overflow-hidden', className)} aria-hidden>
      <BrandSymbol variant={tone === 'dark' ? 'negativo' : 'original'} className={clsx('absolute -right-[16%] top-1/2 h-[140%] max-w-none -translate-y-1/2', tone === 'dark' ? 'opacity-[0.14]' : 'opacity-[0.07]')} />
    </div>
  );
}

/** Balões de mascote e slogan saíram na identidade BKT (sem slogan). Mantidos vazios para compatibilidade. */
export function MascotBubble(_: { slot: BrandSlot; lines: string[]; highlight: ReactNode }) {
  return null;
}
export const ConfiarFacil = () => null;
export const ConfiarFacilPartial = () => null;

/**
 * Arte de um espaço da Personalização (banner do Início, cartão do menu): a imagem enviada, cobrindo o espaço,
 * ou o grafismo padrão quando não há imagem.
 */
export function BrandArt({ slot, className, fallback }: { slot: BrandSlot; className?: string; fallback: ReactNode }) {
  const v = useLookups().data?.brand?.[slot];
  const [failed, setFailed] = useState<string | null>(null);
  if (!v || failed === v) return <>{fallback}</>;
  return <img src={`/api/v1/brand/${slot}?v=${v}`} alt="" aria-hidden className={clsx('object-cover', className)} onError={() => setFailed(v)} draggable={false} />;
}
