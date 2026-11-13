/**
 * Central de Playbooks → Apresentação institucional da BKT (tela cheia, 16:9, setas para navegar).
 * Slide 1: logo, presença em Sergipe (mapa em pontos com Porto da Folha em destaque) e os selos e certificações,
 * que entram como imagem em Configuração → Personalização (espaço "Selos e certificações").
 */
import { useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ImagePlus, X } from 'lucide-react';
import { BrandArt } from '../../components/brand';
import { useAuth } from '../../auth/AuthProvider';
import { Stage } from '../Tour';
import { SE_CITIES, SE_DOTS, SE_OUTLINE, SE_VIEW } from '../../features/playbooks/sergipeMap';

const HOME = 'Porto da Folha';
const CITY_ORDER = ['Aracaju', 'Nossa Senhora do Socorro', 'Laranjeiras', 'Estância', 'Porto da Folha'];

/** Mapa de Sergipe em malha de pontos; cidades com marcador e Porto da Folha em destaque. */
function SergipeMap({ className }: { className?: string }) {
  const label: Record<string, { dx: number; dy: number; anchor: 'start' | 'end' }> = {
    Aracaju: { dx: 30, dy: 10, anchor: 'start' }, 'Nossa Senhora do Socorro': { dx: -30, dy: 4, anchor: 'end' }, Laranjeiras: { dx: -30, dy: -14, anchor: 'end' },
    'Estância': { dx: -30, dy: 10, anchor: 'end' }, 'Porto da Folha': { dx: 44, dy: 12, anchor: 'start' },
  };
  return (
    <svg viewBox={`-260 -40 ${SE_VIEW.w + 560} ${SE_VIEW.h + 80}`} className={className} role="img" aria-label={`Mapa de Sergipe com ${CITY_ORDER.join(', ')}; ${HOME} em destaque, onde nasceu o fundador`}>
      <defs>
        <radialGradient id="se-glow"><stop offset="0" stopColor="#4FA3E8" stopOpacity="0.55" /><stop offset="1" stopColor="#4FA3E8" stopOpacity="0" /></radialGradient>
      </defs>
      <path d={SE_OUTLINE} fill="#2F5986" fillOpacity="0.12" stroke="#5E8FC0" strokeOpacity="0.45" strokeWidth="2" />
      {SE_DOTS.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4.2" fill="#6FA4D8" fillOpacity="0.45" />)}
      {SE_CITIES.map((c) => {
        const home = c.name === HOME;
        const l = label[c.name]!;
        return (
          <g key={c.name}>
            {home && <circle cx={c.x} cy={c.y} r="120" fill="url(#se-glow)" />}
            {home && <circle cx={c.x} cy={c.y} r="40" fill="none" stroke="#9CC4EA" strokeWidth="2.5" />}
            <circle cx={c.x} cy={c.y} r={home ? 20 : 12} fill={home ? '#FFFFFF' : '#9CC4EA'} stroke="#1B2A3A" strokeWidth="4" />
            <text x={c.x + l.dx} y={c.y + l.dy} textAnchor={l.anchor} fontSize={home ? 34 : 25} fontWeight={home ? 700 : 600} fill="#FFFFFF" fillOpacity={home ? 1 : 0.85} fontFamily="inherit">{c.name}</text>
            {home && <text x={c.x + l.dx} y={c.y + l.dy + 34} textAnchor="start" fontSize="22" fill="#9CC4EA" fontFamily="inherit">onde nasceu o nosso fundador</text>}
          </g>
        );
      })}
    </svg>
  );
}

function SlidePresence({ canConfigure }: { canConfigure: boolean }) {
  return (
    <div className="relative h-full overflow-hidden bg-[#141C25] text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,rgba(47,89,134,0.45),transparent_62%)]" />
      <SergipeMap className="absolute right-[30px] top-[30px] h-[600px] w-[820px]" />
      <div className="relative flex h-full flex-col px-[90px] pb-[56px] pt-[64px]">
        <img src="/brand/bkt-logo-white.png" alt="BKT" className="h-[52px] w-fit" draggable={false} />
        <div className="mt-[44px] max-w-[760px]">
          <p className="inline-block border border-white/20 bg-white/[0.06] px-4 py-2 text-[17px] font-semibold text-[#9CC4EA]">Presença em Sergipe</p>
          <h1 className="mt-7 font-display text-[52px] font-extrabold leading-[1.06]">Tecnologia que nasceu em Sergipe<span className="block text-[#9CC4EA]">e cresce com ele.</span></h1>
          <p className="mt-5 max-w-[640px] text-[22px] leading-[1.5] text-white/80">Conectividade, computação em nuvem, soluções de energia e infraestrutura para cidades inteligentes.</p>
          <ul className="mt-6 flex max-w-[760px] flex-wrap gap-2">{CITY_ORDER.map((c) => <li key={c} className={clsx('border px-3.5 py-1.5 text-[16px]', c === HOME ? 'border-[#9CC4EA] bg-[#9CC4EA]/15 font-semibold text-white' : 'border-white/20 text-white/80')}>{c}</li>)}</ul>
        </div>
        <section aria-label="Selos e certificações" className="mt-auto border border-white/12 bg-white/[0.04] px-8 py-5">
          <p className="text-[15px] font-semibold text-[#9CC4EA]">Selos e certificações</p>
          <div className="mt-3 h-[92px]">
            <BrandArt slot="selos_certificacoes" className="h-full w-full object-contain object-left" fallback={
              <div className="flex h-full items-center gap-4 border border-dashed border-white/25 px-6 text-white/60">
                <ImagePlus className="h-8 w-8 shrink-0" aria-hidden />
                <p className="text-[18px] leading-snug">Espaço para a imagem dos selos e certificações.{canConfigure ? ' Envie em Configuração → Personalização → Selos e certificações.' : ' A administração envia a imagem em Personalização.'}</p>
              </div>
            } />
          </div>
        </section>
      </div>
    </div>
  );
}

const SLIDES = [{ key: 'presenca', title: 'Presença em Sergipe' }];

export function InstitutionalPresentation() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const i = Math.min(SLIDES.length - 1, Math.max(0, Number(sp.get('s') ?? 1) - 1 || 0));
  const go = useCallback((n: number) => setSp({ s: String(Math.min(SLIDES.length, Math.max(1, n + 1))) }, { replace: true }), [setSp]);
  const close = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen(); nav('/playbooks'); }, [nav]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(i + 1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(i - 1); }
      else if (e.key === 'f' || e.key === 'F') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }
      else if (e.key === 'Escape' && !document.fullscreenElement) close();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [i, go, close]);
  const btn = 'flex h-10 items-center gap-2 px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30';
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0E141B]" role="region" aria-label="Apresentação institucional" aria-roledescription="apresentação">
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-6 sm:py-5"><Stage>{SLIDES[i]!.key === 'presenca' && <SlidePresence canConfigure={can('configuracoes', 'total')} />}</Stage></div>
      <nav aria-label="Controles da apresentação" className="flex items-center justify-between border-t border-white/10 px-3 py-2 sm:px-6">
        <button type="button" className={btn} onClick={close}><X className="h-4 w-4" aria-hidden />Fechar</button>
        <p className="text-sm text-white/60"><span className="num text-white">{i + 1}</span> / {SLIDES.length} · {SLIDES[i]!.title}</p>
        <div className="flex gap-1"><button type="button" className={btn} onClick={() => go(i - 1)} disabled={i === 0} aria-label="Slide anterior"><ChevronLeft className="h-5 w-5" /></button><button type="button" className={btn} onClick={() => go(i + 1)} disabled={i === SLIDES.length - 1} aria-label="Próximo slide"><ChevronRight className="h-5 w-5" /></button></div>
      </nav>
    </div>
  );
}
