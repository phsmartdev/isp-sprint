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
 * Mapa de Sergipe em perspectiva (quase 3D): o estado é uma placa com espessura, coberta pela malha de pontos,
 * inclinada como uma mesa; os marcadores ficam em pé, com o nome no alto. Porto da Folha em destaque.
 */
const TILT = 'rotateX(50deg) rotateZ(-12deg)';
const UNTILT = 'rotateZ(12deg) rotateX(-50deg)';
const STEM: Record<string, number> = { Aracaju: 120, 'Nossa Senhora do Socorro': 70, Laranjeiras: 170, 'Estância': 70, 'Porto da Folha': 110 };
/** lado do nome em relação à haste: as três cidades da Grande Aracaju ficam afastadas para os lados */
const SIDE: Record<string, 'esq' | 'dir' | 'centro'> = { Aracaju: 'dir', 'Nossa Senhora do Socorro': 'esq', Laranjeiras: 'esq', 'Estância': 'centro', 'Porto da Folha': 'centro' };
function SergipeMap({ className }: { className?: string }) {
  const W = 900, k = W / SE_VIEW.w, H = SE_VIEW.h * k;
  const plate = (fill: string, stroke?: string) => (
    <svg viewBox={`0 0 ${SE_VIEW.w} ${SE_VIEW.h}`} width={W} height={H} className="absolute inset-0" aria-hidden><path d={SE_OUTLINE} fill={fill} stroke={stroke ?? 'none'} strokeWidth="3" strokeLinejoin="round" /></svg>
  );
  return (
    <div className={className} style={{ perspective: '1600px' }} role="img" aria-label={`Mapa de Sergipe com os 75 municípios ligados em rede; ${CITY_ORDER.join(', ')} identificados e ${HOME} em destaque`}>
      <div className="absolute left-1/2 top-1/2" style={{ width: W, height: H, marginLeft: -W / 2, marginTop: -H / 2, transform: TILT, transformStyle: 'preserve-3d' }}>
        {/* espessura da placa: camadas mais escuras abaixo do topo */}
        {Array.from({ length: 16 }, (_, n) => (
          <div key={n} className="absolute inset-0" style={{ transform: `translateZ(${-(n + 1) * 3}px)` }}>{plate(n === 15 ? '#06101A' : '#1B3E63', n === 15 ? undefined : '#2A5683')}</div>
        ))}
        {/* topo: preenchimento, contorno e pontos */}
        <div className="absolute inset-0" style={{ transform: 'translateZ(0)' }}>
          {plate('#1A3858', '#7FB0E0')}
          <svg viewBox={`0 0 ${SE_VIEW.w} ${SE_VIEW.h}`} width={W} height={H} className="absolute inset-0" aria-hidden>
            <defs><radialGradient id="se-home"><stop offset="0" stopColor="#9CC4EA" stopOpacity="0.7" /><stop offset="1" stopColor="#9CC4EA" stopOpacity="0" /></radialGradient></defs>
            {/* divisão territorial: os 75 municípios */}
            <defs><linearGradient id="se-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3A6FA6" /><stop offset="1" stopColor="#24507F" /></linearGradient></defs>
            {SE_MUNICIPIOS.map((m, n) => <path key={m.name} d={m.d} fill="url(#se-fill)" fillOpacity={0.78 + ((n * 37) % 23) / 100} stroke="#9CC4EA" strokeOpacity="0.55" strokeWidth="1.4" strokeLinejoin="round" />)}
            {/* rede ligando os pontos de presença */}
            {SE_LINKS.map(([a, b]) => { const p = SE_MUNICIPIOS[a]!, q = SE_MUNICIPIOS[b]!; return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#D6E9FB" strokeOpacity="0.7" strokeWidth="2.4" />; })}
            {SE_MUNICIPIOS.map((m) => {
              const named = CITY_ORDER.includes(m.name), home = m.name === HOME;
              return home
                ? <g key={m.name}><circle cx={m.x} cy={m.y} r="140" fill="url(#se-home)" /><circle cx={m.x} cy={m.y} r="46" fill="none" stroke="#FFFFFF" strokeOpacity="0.75" strokeWidth="4" /><circle cx={m.x} cy={m.y} r="15" fill="#FFFFFF" /></g>
                : <g key={m.name}><circle cx={m.x} cy={m.y} r={named ? 11 : 7} fill={named ? '#FFFFFF' : '#CFE3F7'} /><circle cx={m.x} cy={m.y} r={named ? 20 : 13} fill="none" stroke="#9CC4EA" strokeOpacity="0.35" strokeWidth="2" /></g>;
            })}
          </svg>
        </div>
        {/* marcadores em pé */}
        {SE_MUNICIPIOS.filter((m) => CITY_ORDER.includes(m.name)).map((c) => {
          const home = c.name === HOME;
          return (
            <div key={c.name} className="absolute" style={{ left: c.x * k, top: c.y * k, transform: `translateZ(1px) ${UNTILT}`, transformOrigin: '0 0', transformStyle: 'preserve-3d' }}>
              <div className={clsx('absolute bottom-0 flex flex-col', SIDE[c.name] === 'dir' ? 'left-0 items-start' : SIDE[c.name] === 'esq' ? 'right-0 items-end' : 'left-0 -translate-x-1/2 items-center')}>
                <span className={home ? 'whitespace-nowrap bg-white px-4 py-2 font-display text-[26px] font-bold text-navy shadow-[0_10px_30px_rgba(0,0,0,0.45)]' : 'whitespace-nowrap border border-white/25 bg-[#0E1A27]/85 px-3 py-1.5 text-[18px] font-semibold text-white'}>{c.name}</span>
                <span className={home ? 'w-[3px] bg-white' : 'w-[2px] bg-[#9CC4EA]/80'} style={{ height: STEM[c.name] ?? 80 }} />
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
    <div className="relative h-full overflow-hidden bg-[#141C25] text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,rgba(47,89,134,0.45),transparent_62%)]" />
      <SergipeMap className="absolute -right-[200px] -top-[40px] h-[1000px] w-[1160px]" />
      <div className="relative flex h-full flex-col px-[90px] pb-[56px] pt-[64px]">
        <img src="/brand/bkt-logo-white.png" alt="BKT" className="h-[52px] w-fit" draggable={false} />
        <div className="mt-[44px] max-w-[760px]">
          <h1 className="mt-2 font-display text-[52px] font-extrabold leading-[1.06]">Tecnologia que nasceu em Sergipe<span className="block text-[#9CC4EA]">e cresce com ele.</span></h1>
          <p className="mt-5 max-w-[640px] text-[22px] leading-[1.5] text-white/80">Conectividade, computação em nuvem, soluções de energia e infraestrutura para cidades inteligentes, em todo o estado de Sergipe.</p>
        </div>
        <section aria-label="Selos e certificações" className="mt-auto max-w-[760px] border border-white/12 bg-white/[0.04] px-8 py-5">
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
