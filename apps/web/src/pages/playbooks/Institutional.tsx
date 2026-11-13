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
import { SE_LINKS, SE_MUNICIPIOS, SE_OUTLINE, SE_VIEW } from '../../features/playbooks/sergipeMap';

const HOME = 'Porto da Folha';
const CITY_ORDER = ['Aracaju', 'Nossa Senhora do Socorro', 'Laranjeiras', 'Estância', 'Porto da Folha'];

/**
 * Mapa de Sergipe em perspectiva, em linguagem de rede: placa escura com espessura, os 75 municípios em traço fino,
 * a rede de presença em linhas com brilho e pulsos de dados saindo de Aracaju; Porto da Folha em destaque.
 * Uma única animação (os pulsos), desligada para quem prefere menos movimento.
 */
const TILT = 'rotateX(52deg) rotateZ(-10deg)';
const UNTILT = 'rotateZ(10deg) rotateX(-52deg)';
const CALLOUT: Record<string, { h: number; side: 'esq' | 'dir' }> = {
  Aracaju: { h: 64, side: 'dir' }, 'Nossa Senhora do Socorro': { h: 40, side: 'esq' }, Laranjeiras: { h: 92, side: 'esq' }, 'Estância': { h: 46, side: 'dir' }, 'Porto da Folha': { h: 78, side: 'dir' },
};
function SergipeMap({ className }: { className?: string }) {
  const W = 720, k = W / SE_VIEW.w, H = SE_VIEW.h * k;
  const hub = SE_MUNICIPIOS.findIndex((m) => m.name === 'Aracaju');
  const plate = (fill: string, stroke = 'none', sw = 2) => (
    <svg viewBox={`0 0 ${SE_VIEW.w} ${SE_VIEW.h}`} width={W} height={H} className="absolute inset-0" aria-hidden><path d={SE_OUTLINE} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" /></svg>
  );
  return (
    <div className={className} style={{ perspective: '1800px' }} role="img" aria-label={`Mapa de Sergipe com os 75 municípios ligados em rede; ${CITY_ORDER.join(', ')} identificados e ${HOME} em destaque`}>
      <div className="absolute left-1/2 top-1/2" style={{ width: W, height: H, marginLeft: -W / 2, marginTop: -H / 2, transform: TILT, transformStyle: 'preserve-3d' }}>
        {/* sombra no chão e espessura da placa */}
        <div className="absolute inset-0" style={{ transform: 'translateZ(-70px)', filter: 'blur(28px)', opacity: 0.55 }}>{plate('#000000')}</div>
        {Array.from({ length: 12 }, (_, n) => <div key={n} className="absolute inset-0" style={{ transform: `translateZ(${-(n + 1) * 2.5}px)` }}>{plate(n === 11 ? '#050B12' : '#0C1B2B', n === 11 ? 'none' : '#16314C', 2)}</div>)}
        <div className="absolute inset-0">
          <svg viewBox={`0 0 ${SE_VIEW.w} ${SE_VIEW.h}`} width={W} height={H} className="absolute inset-0 overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="se-top" x1="0" y1="0" x2="0.9" y2="1"><stop offset="0" stopColor="#14314F" /><stop offset="1" stopColor="#0B1D30" /></linearGradient>
              <filter id="se-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" /></filter>
              <radialGradient id="se-halo"><stop offset="0" stopColor="#4FBBFF" stopOpacity="0.45" /><stop offset="1" stopColor="#4FBBFF" stopOpacity="0" /></radialGradient>
            </defs>
            <path d={SE_OUTLINE} fill="url(#se-top)" />
            {/* divisão territorial */}
            {SE_MUNICIPIOS.map((m) => <path key={m.name} d={m.d} fill="none" stroke="#3B6E9E" strokeOpacity="0.55" strokeWidth="1.1" strokeLinejoin="round" />)}
            {/* borda do estado com brilho */}
            <path d={SE_OUTLINE} fill="none" stroke="#4FBBFF" strokeOpacity="0.55" strokeWidth="7" filter="url(#se-glow)" />
            <path d={SE_OUTLINE} fill="none" stroke="#8FD6FF" strokeWidth="2" strokeLinejoin="round" />
            {/* rede: brilho largo + traço fino + pulsos */}
            <g filter="url(#se-glow)">{SE_LINKS.map(([a, b]) => { const p = SE_MUNICIPIOS[a]!, q = SE_MUNICIPIOS[b]!; return <line key={`g${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#4FBBFF" strokeOpacity="0.35" strokeWidth="5" />; })}</g>
            {SE_LINKS.map(([a, b]) => { const p = SE_MUNICIPIOS[a]!, q = SE_MUNICIPIOS[b]!; return <line key={`l${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#9BDCFF" strokeOpacity="0.75" strokeWidth="1.4" />; })}
            {SE_LINKS.map(([a, b], n) => { const p = SE_MUNICIPIOS[a]!, q = SE_MUNICIPIOS[b]!; return n % 3 ? null : <line key={`p${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="5 95" pathLength={100} className="inst-pulse" style={{ animationDelay: `${(n * 137) % 2400}ms` }} />; })}
            {/* pontos de presença */}
            {SE_MUNICIPIOS.map((m, i) => {
              const home = m.name === HOME, named = CITY_ORDER.includes(m.name);
              if (home) return <g key={m.name}><circle cx={m.x} cy={m.y} r="110" fill="url(#se-halo)" /><circle cx={m.x} cy={m.y} r="34" fill="none" stroke="#8FD6FF" strokeWidth="2" /><circle cx={m.x} cy={m.y} r="56" fill="none" stroke="#8FD6FF" strokeOpacity="0.35" strokeWidth="1.5" /><circle cx={m.x} cy={m.y} r="10" fill="#FFFFFF" /></g>;
              if (i === hub) return <g key={m.name}><circle cx={m.x} cy={m.y} r="70" fill="url(#se-halo)" /><circle cx={m.x} cy={m.y} r="22" fill="none" stroke="#8FD6FF" strokeWidth="1.8" /><circle cx={m.x} cy={m.y} r="8" fill="#FFFFFF" /></g>;
              return <g key={m.name}><circle cx={m.x} cy={m.y} r={named ? 9 : 6} fill="#4FBBFF" fillOpacity="0.35" filter="url(#se-glow)" /><circle cx={m.x} cy={m.y} r={named ? 5.5 : 3.6} fill={named ? '#FFFFFF' : '#CDEEFF'} /></g>;
            })}
          </svg>
        </div>
        {/* identificação das cidades: haste fina e nome em pé */}
        {SE_MUNICIPIOS.filter((m) => CITY_ORDER.includes(m.name)).map((c) => {
          const home = c.name === HOME, cfg = CALLOUT[c.name]!;
          return (
            <div key={c.name} className="absolute" style={{ left: c.x * k, top: c.y * k, transform: `translateZ(1px) ${UNTILT}`, transformOrigin: '0 0' }}>
              <div className={clsx('absolute bottom-0 flex items-end', cfg.side === 'dir' ? 'left-0' : 'right-0 flex-row-reverse')}>
                <span className="w-px bg-gradient-to-t from-[#8FD6FF] to-[#8FD6FF]/30" style={{ height: cfg.h }} />
                <span className={clsx('whitespace-nowrap border-[#8FD6FF]/40 bg-[#0B121A]/75 px-2.5 py-1 backdrop-blur-sm', cfg.side === 'esq' ? 'border-r text-right' : 'border-l')} style={{ marginBottom: cfg.h - 26 }}>
                  <span className={clsx('block font-semibold leading-tight', home ? 'text-[22px] text-white' : 'text-[15px] text-white/90')}>{c.name}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlidePresence({ canConfigure }: { canConfigure: boolean }) {
  return (
    <div className="relative h-full overflow-hidden bg-[#0B121A] text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_48%,rgba(47,89,134,0.42),transparent_60%)]" />
      <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(143,214,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(143,214,255,1)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_70%_50%,black,transparent_70%)]" />
      <SergipeMap className="absolute right-[10px] top-[30px] h-[820px] w-[860px]" />
      <div className="relative flex h-full flex-col px-[90px] pb-[56px] pt-[64px]">
        <img src="/brand/bkt-logo-white.png" alt="BKT" className="h-[52px] w-fit" draggable={false} />
        <div className="mt-[44px] max-w-[760px]">
          <h1 className="mt-2 font-display text-[52px] font-extrabold leading-[1.06]">Tecnologia que nasceu em Sergipe<span className="block text-[#9CC4EA]">e cresce com ele.</span></h1>
          <p className="mt-5 max-w-[640px] text-[22px] leading-[1.5] text-white/80">Conectividade, computação em nuvem, soluções de energia e infraestrutura para cidades inteligentes, em todo o estado de Sergipe.</p>
        </div>
        <section aria-label="Selos e certificações" className="mt-auto max-w-[760px] border border-white/10 bg-white/[0.03] px-8 py-5">
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

const SLIDES = [{ key: 'presenca', title: 'A BKT em Sergipe' }];

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
