import { createContext, useContext, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import type { BrandSlot } from '@isp/shared';
import { BRAND, MASCOT_LINES } from '../brand';

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

/**
 * Logotipo da instância. BKT: arquivo oficial do Brand Book (negativo branco ou colorido).
 * Yepnet: imagem enviada em Personalização (logo para fundo escuro ou claro); sem imagem, "Yepnet" em texto.
 */
export function Logo({ className, variant = 'white', publicAsset }: { publicAsset?: boolean; className?: string; variant?: 'white' | 'color' }) {
  if (!BRAND.uploads) {
    return <img src={variant === 'white' ? '/brand/bkt-logo-white.png' : '/brand/bkt-logo.png'} alt={BRAND.company} className={clsx('h-9 w-auto select-none object-contain', className)} draggable={false} />;
  }
  return (
    <BrandImage
      slot={variant === 'white' ? 'logo_escuro' : 'logo_claro'}
      alt={BRAND.company}
      publicAsset={publicAsset}
      className={clsx('h-11 w-auto max-w-[180px] object-contain', className)}
      fallback={
        <span className={clsx('select-none text-[36px] font-extrabold leading-none tracking-tight', className)} aria-label={BRAND.company}>
          <span className={variant === 'white' ? 'text-white' : 'text-navy'}>Yep</span>
          <span className={variant === 'white' ? 'text-lime' : 'text-lime-ink'}>net</span>
        </span>
      }
    />
  );
}

/** Símbolo da marca (quadros pequenos, modo TV). Yepnet usa o ícone enviado em Personalização. */
export function BrandSymbol({ className, variant = 'color' }: { className?: string; variant?: 'white' | 'color' }) {
  if (!BRAND.uploads) return <img src={variant === 'white' ? '/brand/bkt-symbol-white.png' : '/brand/bkt-symbol.png'} alt={BRAND.company} className={className} draggable={false} />;
  return <BrandImage slot="favicon" alt={BRAND.company} className={clsx('object-contain', className)} />;
}

/** Nome da ferramenta ao lado do logo (RevOps / ISP Sprint). */
export function AppName({ className }: { className?: string }) {
  return <span className={clsx('font-display font-semibold', className)}>{BRAND.app}</span>;
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

/**
 * Arte de fundo das áreas de destaque (login, banner do Início, card do menu).
 * BKT: hexágonos. Yepnet: imagem enviada em Personalização (sem texto; o texto é aplicado pelo sistema).
 */
export function BrandArt({ slot, className, tone = 'dark', publicAsset }: { slot: 'login_fundo' | 'banner_inicio' | 'card_sidebar'; className?: string; tone?: 'dark' | 'light'; publicAsset?: boolean }) {
  if (!BRAND.uploads) return <Hexagons className={className} tone={tone} />;
  return <BrandImage slot={slot} publicAsset={publicAsset} className={clsx('object-cover', className)} />;
}

/** Card do pé do menu lateral. */
export function SidebarCard({ compact }: { compact: boolean }) {
  if (!BRAND.uploads) {
    return (
      <div className={clsx('relative mx-4 mb-4 overflow-hidden rounded-lg bg-gradient-to-br from-navy-2 to-primary', compact ? 'h-[140px] shrink-0 [@media(max-height:960px)]:hidden' : 'h-[200px] min-h-[140px] shrink-0 [@media(max-height:720px)]:hidden')} aria-hidden>
        <Hexagons className="absolute inset-0 h-full w-full" />
        <BrandSymbol variant="white" className="absolute bottom-4 left-5 h-10 w-auto opacity-90" />
      </div>
    );
  }
  return (
    <div className={clsx('relative mx-4 mb-4 overflow-hidden rounded-[18px] bg-gradient-to-br from-[#0E3A9A] via-[#0B2A72] to-[#05174A]', compact ? 'h-[170px] shrink-0 [@media(max-height:960px)]:hidden' : 'h-[300px] min-h-[200px] shrink-0 [@media(max-height:640px)]:hidden')} aria-hidden>
      <BrandImage slot="card_sidebar" className="absolute inset-0 h-full w-full object-cover object-bottom" />
      {BRAND.slogan && (
        <p className="relative px-5 pt-5 text-[30px] font-extrabold leading-[1.05] text-white drop-shadow">
          {BRAND.slogan.before.split(' ').map((w, i) => <span key={i}>{i > 0 && <br />}{w}</span>)} <span className="text-lime">{BRAND.slogan.highlight}</span>
        </p>
      )}
    </div>
  );
}

/** Mascote com o balão de texto fixo da tela (Yepnet). Na BKT não aparece. */
export function MascotBubble({ slot }: { slot: BrandSlot }) {
  const lines = MASCOT_LINES[slot];
  if (!BRAND.mascots || !lines) return null;
  return (
    <div className="hidden items-end gap-0 lg:flex" aria-hidden>
      <BrandImage slot={slot} className="-mb-2 -mt-6 h-[132px] w-[132px] object-contain" />
      <div className="relative rounded-lg bg-primary-soft px-4 py-3 text-md font-bold leading-snug text-ink">
        {lines.map((l) => <span key={l} className="block whitespace-nowrap">{l}</span>)}
        <span className="block whitespace-nowrap"><ConfiarFacil /></span>
      </div>
    </div>
  );
}

/** Slogan da marca ("Confiar ficou fácil."). Vazio quando a marca não tem slogan. */
export const ConfiarFacil = () => (BRAND.slogan ? <span className="text-lime-ink">{BRAND.slogan.before} {BRAND.slogan.highlight}</span> : null);
export const ConfiarFacilPartial = () => (BRAND.slogan ? <>{BRAND.slogan.before} <span className="text-lime-ink">{BRAND.slogan.highlight}</span></> : null);
