import { createContext, useContext, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import type { BrandSlot } from '@isp/shared';

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
export function Hexagons({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const stroke = tone === 'dark' ? 'rgba(79,187,255,0.28)' : 'rgba(47,89,134,0.16)';
  const fill = tone === 'dark' ? 'rgba(47,89,134,0.55)' : 'rgba(47,89,134,0.08)';
  const hex = (cx: number, cy: number, r: number) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i + Math.PI / 6; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
  return (
    <svg className={className} viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <polygon points={hex(300, 120, 150)} fill={fill} />
      <polygon points={hex(300, 120, 110)} fill="none" stroke={stroke} strokeWidth="2" />
      <polygon points={hex(110, 330, 90)} fill="none" stroke={stroke} strokeWidth="2" transform="rotate(15 110 330)" />
      <polygon points={hex(360, 360, 60)} fill="none" stroke={stroke} strokeWidth="1.5" transform="rotate(-12 360 360)" />
      <polygon points={hex(60, 90, 34)} fill={fill} transform="rotate(8 60 90)" />
    </svg>
  );
}

/** Balões de mascote e slogan saíram na identidade BKT (sem slogan). Mantidos vazios para compatibilidade. */
export function MascotBubble(_: { slot: BrandSlot; lines: string[]; highlight: ReactNode }) {
  return null;
}
export const ConfiarFacil = () => null;
export const ConfiarFacilPartial = () => null;
