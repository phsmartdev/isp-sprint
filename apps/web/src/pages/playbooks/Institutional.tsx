/**
 * Central de Playbooks → Apresentação institucional da BKT (tela cheia, 16:9, setas para navegar).
 * Slide 1: logo, presença em Sergipe (mapa em pontos com Porto da Folha em destaque) e os selos e certificações,
 * que entram como imagem em Configuração → Personalização (espaço "Selos e certificações").
 * Slide 2: o mesmo prédio com rede tradicional × rede POL, em transição animada (features/playbooks/polScene).
 * Cenas novas: abertura e encerramento sobre o mapa de Aracaju (features/playbooks/CityScenes) e impacto humano (SceneImpact).
 * Slide 3: RIMA, Aracaju em 3D com rede fragmentada × rede integrada, NOC da BKT e simulação de falha (features/playbooks/RimaSlide).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../components/ui/overlay';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, Copy, Feather, Link2, Gauge, Hourglass, Maximize2, Minimize2, Move, Pause, Play, Server, ShieldCheck, X, Zap } from 'lucide-react';
import { ODS_BKT, ODS_POL, OdsBar } from '../../features/playbooks/Ods';
import { api } from '../../lib/api';
import { Stage } from '../Tour';
import { SE_LINKS, SE_MUNICIPIOS, SE_OUTLINE, SE_VIEW } from '../../features/playbooks/sergipeMap';
import { buildPolScene, POL_CALLOUT_X } from '../../features/playbooks/polScene';

/** Slide 3 (RIMA): mapa de Aracaju com ~800 KB de geometria, carregado só quando o slide abre. */
const RimaSlide = lazy(() => import('../../features/playbooks/RimaSlide'));
/** Abertura e encerramento reutilizam o mapa de Aracaju da RIMA (mesmo pacote carregado sob demanda). */
const SceneOpening = lazy(() => import('../../features/playbooks/CityScenes').then((m) => ({ default: m.SceneOpening })));
const SceneClosing = lazy(() => import('../../features/playbooks/CityScenes').then((m) => ({ default: m.SceneClosing })));
const SceneImpact = lazy(() => import('../../features/playbooks/SceneImpact'));

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
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const hm = hover === null ? null : SE_MUNICIPIOS[hover]!;
  const plate = (fill: string, stroke = 'none', sw = 2) => (
    <svg viewBox={`0 0 ${SE_VIEW.w} ${SE_VIEW.h}`} width={W} height={H} className="absolute inset-0" aria-hidden><path d={SE_OUTLINE} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" /></svg>
  );
  return (
    <div className={className} style={{ perspective: '1800px' }} role="img" aria-label={`Mapa de Sergipe com os 75 municípios ligados em rede; ${CITY_ORDER.join(', ')} identificados e ${HOME} em destaque`}>
      <div className="absolute left-1/2 top-1/2" style={{ width: W, height: H, marginLeft: -W / 2, marginTop: -H / 2, transform: TILT, transformStyle: 'preserve-3d' }}>
        {/* sombra no chão e espessura da placa */}
        <div className="pointer-events-none absolute inset-0" style={{ transform: 'translateZ(-70px)', filter: 'blur(28px)', opacity: 0.55 }}>{plate('#000000')}</div>
        {Array.from({ length: 12 }, (_, n) => <div key={n} className="pointer-events-none absolute inset-0" style={{ transform: `translateZ(${-(n + 1) * 2.5}px)` }}>{plate(n === 11 ? '#050B12' : '#0C1B2B', n === 11 ? 'none' : '#16314C', 2)}</div>)}
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
            <g filter="url(#se-glow)" pointerEvents="none">{SE_LINKS.map(([a, b]) => { const p = SE_MUNICIPIOS[a]!, q = SE_MUNICIPIOS[b]!; return <line key={`g${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#4FBBFF" strokeOpacity="0.35" strokeWidth="5" />; })}</g>
            <g pointerEvents="none">{SE_LINKS.map(([a, b]) => { const p = SE_MUNICIPIOS[a]!, q = SE_MUNICIPIOS[b]!; return <line key={`l${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#9BDCFF" strokeOpacity="0.75" strokeWidth="1.4" />; })}</g>
            <g pointerEvents="none">{SE_LINKS.map(([a, b], n) => { const p = SE_MUNICIPIOS[a]!, q = SE_MUNICIPIOS[b]!; return n % 3 ? null : <line key={`p${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="5 95" pathLength={100} className="inst-pulse" style={{ animationDelay: `${(n * 137) % 2400}ms` }} />; })}</g>
            {/* pontos de presença */}
            <g pointerEvents="none">{SE_MUNICIPIOS.map((m, i) => {
              const home = m.name === HOME, named = CITY_ORDER.includes(m.name);
              if (home) return <g key={m.name}><circle cx={m.x} cy={m.y} r="110" fill="url(#se-halo)" /><circle cx={m.x} cy={m.y} r="34" fill="none" stroke="#8FD6FF" strokeWidth="2" /><circle cx={m.x} cy={m.y} r="56" fill="none" stroke="#8FD6FF" strokeOpacity="0.35" strokeWidth="1.5" /><circle cx={m.x} cy={m.y} r="10" fill="#FFFFFF" /></g>;
              if (i === hub) return <g key={m.name}><circle cx={m.x} cy={m.y} r="70" fill="url(#se-halo)" /><circle cx={m.x} cy={m.y} r="22" fill="none" stroke="#8FD6FF" strokeWidth="1.8" /><circle cx={m.x} cy={m.y} r="8" fill="#FFFFFF" /></g>;
              return <g key={m.name}><circle cx={m.x} cy={m.y} r={named ? 9 : 6} fill="#4FBBFF" fillOpacity="0.35" filter="url(#se-glow)" /><circle cx={m.x} cy={m.y} r={named ? 5.5 : 3.6} fill={named ? '#FFFFFF' : '#CDEEFF'} /></g>;
            })}</g>
            {/* município sob o mouse: sombra, amplia e acende */}
            {hm && (
              <g key={hm.name} className="inst-pop" pointerEvents="none" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
                <path d={hm.d} fill="#000" fillOpacity="0.45" transform="translate(12 18)" filter="url(#se-glow)" />
                <path d={hm.d} fill="#2A6FB0" stroke="#4FBBFF" strokeWidth="12" strokeOpacity="0.35" filter="url(#se-glow)" />
                <path d={hm.d} fill="#2F7BC4" fillOpacity="0.95" stroke="#CFF0FF" strokeWidth="2.5" strokeLinejoin="round" />
                <circle cx={hm.x} cy={hm.y} r="7" fill="#FFFFFF" />
              </g>
            )}
            {/* área de cada município para o passar do mouse */}
            {SE_MUNICIPIOS.map((m, i) => <path key={`h${m.name}`} d={m.d} fill="transparent" pointerEvents="all" className="cursor-pointer" onPointerEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top }); setHover(i); }} onPointerLeave={() => { setHover((h) => (h === i ? null : h)); }}><title>{m.name}</title></path>)}
          </svg>
        </div>
        {/* identificação das cidades: haste fina e nome em pé */}
        {SE_MUNICIPIOS.filter((m) => CITY_ORDER.includes(m.name)).map((c) => {
          const home = c.name === HOME, cfg = CALLOUT[c.name]!;
          return (
            <div key={c.name} className={clsx('pointer-events-none absolute', hm?.name === c.name && 'invisible')} style={{ left: c.x * k, top: c.y * k, transform: `translateZ(1px) ${UNTILT}`, transformOrigin: '0 0' }}>
              <div className={clsx('absolute bottom-0 flex items-end transition-opacity duration-200', cfg.side === 'dir' ? 'left-0' : 'right-0 flex-row-reverse', hm && hm.name !== c.name && 'opacity-30')}>
                <span className="w-px bg-gradient-to-t from-[#8FD6FF] to-[#8FD6FF]/30" style={{ height: cfg.h }} />
                <span className={clsx('whitespace-nowrap border-[#8FD6FF]/40 bg-[#0B121A]/75 px-2.5 py-1 backdrop-blur-sm', cfg.side === 'esq' ? 'border-r text-right' : 'border-l')} style={{ marginBottom: cfg.h - 26 }}>
                  <span className={clsx('block font-semibold leading-tight', home ? 'text-[22px] text-white' : 'text-[15px] text-white/90')}>{c.name}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {hm && tip && createPortal(<span className="pointer-events-none fixed z-[95] -translate-x-1/2 -translate-y-full whitespace-nowrap border border-[#8FD6FF]/60 bg-[#0B121A]/95 px-3 py-1.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.5)]" style={{ left: tip.x, top: tip.y - 6 }}>{hm.name}</span>, document.fullscreenElement ?? document.body)}
    </div>
  );
}

type Rect = { x: number; y: number; w: number; h: number; scale?: number };
type Layout = { blocks: Record<'logo' | 'texto' | 'mapa' | 'selos', Rect>; texts: { title: string; accent: string; body: string } };
/** Posição padrão dos blocos no palco de 1600 × 900. */
export const DEFAULT_LAYOUT: Layout = {
  blocks: { logo: { x: 90, y: 64, w: 230, h: 56 }, texto: { x: 90, y: 160, w: 760, h: 300, scale: 1 }, mapa: { x: 730, y: 30, w: 860, h: 820 }, selos: { x: 90, y: 772, w: 900, h: 82 } },
  texts: { title: 'Tecnologia que nasceu em Sergipe', accent: 'e cresce com ele.', body: 'Conectividade, computação em nuvem, soluções de energia e infraestrutura para cidades inteligentes, em todo o estado de Sergipe.' },
};
const LABELS: Record<keyof Layout['blocks'], string> = { logo: 'Logo', texto: 'Texto', mapa: 'Mapa', selos: 'Selos e certificações' };

/** Bloco posicionado no palco; no modo de edição: arrastar move, o canto redimensiona. */
function Block({ id, r, edit, onChange, children }: { id: keyof Layout['blocks']; r: Rect; edit: boolean; onChange: (r: Rect) => void; children: React.ReactNode }) {
  const start = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if (!edit) return;
    if ((e.target as HTMLElement).isContentEditable) return;
    e.preventDefault(); e.stopPropagation();
    const stage = (e.currentTarget as HTMLElement).closest('[data-stage]') as HTMLElement;
    const k = stage.getBoundingClientRect().width / 1600;
    const x0 = e.clientX, y0 = e.clientY, base = { ...r };
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
      onChange(mode === 'move' ? { ...base, x: Math.round(base.x + dx), y: Math.round(base.y + dy) } : { ...base, w: Math.max(80, Math.round(base.w + dx)), h: Math.max(40, Math.round(base.h + dy)) });
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <div className={clsx('absolute', edit && 'cursor-move outline outline-1 outline-dashed outline-[#8FD6FF]/70 hover:outline-2')} style={{ left: r.x, top: r.y, width: r.w, height: r.h }} onPointerDown={(e) => start(e, 'move')} data-block={id}>
      {children}
      {edit && <span className="pointer-events-none absolute -top-7 left-0 bg-[#8FD6FF] px-2 py-0.5 text-[13px] font-semibold text-navy">{LABELS[id]}</span>}
      {edit && <span role="presentation" aria-label={`Redimensionar ${LABELS[id]}`} className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize border-2 border-navy bg-[#8FD6FF]" onPointerDown={(e) => start(e, 'size')} />}
    </div>
  );
}

type Seal = { id: string; name: string; sha256: string };
function SlidePresence({ layout, edit, setLayout, seals, sealSrc }: { layout: Layout; edit: boolean; setLayout: (l: Layout) => void; seals: Seal[]; sealSrc: (x: Seal) => string }) {
  const b = layout.blocks, t = layout.texts, sc = b.texto.scale ?? 1;
  const set = (id: keyof Layout['blocks']) => (r: Rect) => setLayout({ ...layout, blocks: { ...b, [id]: r } });
  const txt = (k: keyof Layout['texts']) => ({ contentEditable: edit, suppressContentEditableWarning: true, onBlur: (e: React.FocusEvent<HTMLElement>) => setLayout({ ...layout, texts: { ...t, [k]: e.currentTarget.innerText.trim() } }), className: clsx(edit && 'cursor-text outline-none focus:bg-white/5') });
  return (
    <div data-stage className="relative h-full overflow-hidden bg-[#0B121A] text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_48%,rgba(47,89,134,0.42),transparent_60%)]" />
      <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(143,214,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(143,214,255,1)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_70%_50%,black,transparent_70%)]" />
      <Block id="mapa" r={b.mapa} edit={edit} onChange={set('mapa')}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: 860, height: 820, transform: `scale(${Math.min(b.mapa.w / 860, b.mapa.h / 820)})` }}><SergipeMap className="absolute inset-0" /></div>
      </Block>
      <Block id="logo" r={b.logo} edit={edit} onChange={set('logo')}><img src="/brand/bkt-logo-white.png" alt="BKT" className="h-full w-full object-contain object-left" draggable={false} /></Block>
      <Block id="texto" r={b.texto} edit={edit} onChange={set('texto')}>
        <div className="h-full overflow-hidden" style={{ fontSize: `${sc}px` }}>
          <h1 className="font-display font-extrabold leading-[1.06]" style={{ fontSize: '52em' }}><span {...txt('title')}>{t.title}</span><span {...txt('accent')} className={clsx('block text-[#9CC4EA]', edit && 'cursor-text outline-none focus:bg-white/5')}>{t.accent}</span></h1>
          <p {...txt('body')} className={clsx('mt-[0.9em] leading-[1.5] text-white/80', edit && 'cursor-text outline-none focus:bg-white/5')} style={{ fontSize: '22em' }}>{t.body}</p>
        </div>
      </Block>
      {/* rodapé à direita: ODS pequenos (os selos e certificações ficam à esquerda, maiores) */}
      <OdsBar items={ODS_BKT} show size={34} align="right" className="bottom-[46px] right-[60px]" />
      {(seals.length > 0 || edit) && (
        <Block id="selos" r={b.selos} edit={edit} onChange={set('selos')}>
          {/* rodapé discreto: rótulo pequeno e selos baixos, sem quadro */}
          <section aria-label="Selos e certificações" className="flex h-full items-center gap-5 border-t border-white/10 pt-3">
            <p className="flex-none text-[10.5px] font-semibold uppercase leading-[1.5] tracking-[0.18em] text-white/40">Selos e<br />certificações</p>
            {seals.length ? <ul className="flex h-full min-w-0 flex-1 items-center gap-5">{seals.map((x) => <li key={x.id} className="flex h-full flex-none items-center"><img src={sealSrc(x)} alt={x.name} title={x.name} className="h-[60px] w-auto max-w-[150px] object-contain opacity-85 transition-opacity hover:opacity-100" draggable={false} /></li>)}</ul>
              : <p className="text-[12px] text-white/40">Sem selos enviados (Configuração → Personalização). Na apresentação, o rodapé só aparece quando houver selos.</p>}
          </section>
        </Block>
      )}
    </div>
  );
}

type NetMode = 'trad' | 'pol';
/** Seis benefícios. Os números são contagens da própria ilustração (11 andares, 33 pontos); nada de percentuais inventados. */
const BENEFITS: { icon: typeof Server; title: string; trad: string; pol: string; num?: { trad: number; pol: number }; detail: string }[] = [
  { icon: Feather, title: 'Cabos mais leves', num: { trad: 11, pol: 1 }, trad: 'cabos de cobre na prumada', pol: 'cabo de fibra na prumada', detail: 'A fibra é fina e leve e substitui feixes de cobre na prumada e em trechos horizontais. Quanto o peso total cai depende do projeto.' },
  { icon: Server, title: 'Menos ativos', num: { trad: 11, pol: 0 }, trad: 'switches nos andares', pol: 'switches nos andares', detail: 'Uma OLT central substitui os switches intermediários. As ONTs nos pontos de uso continuam sendo equipamentos ativos.' },
  { icon: Zap, title: 'Menos energia', num: { trad: 11, pol: 0 }, trad: 'pontos de energia nos andares', pol: 'pontos de energia nos andares', detail: 'Os splitters são passivos e não usam eletricidade. A OLT e as ONTs continuam consumindo; a economia real depende do projeto.' },
  { icon: Hourglass, title: 'Mais longevidade', trad: 'Novas velocidades podem exigir novo cabo', pol: 'Upgrade trocando só as pontas', detail: 'A fibra monomodo instalada atende as próximas gerações de PON. Os eletrônicos (OLT e ONTs) evoluem; o cabo permanece.' },
  { icon: Gauge, title: 'Mais banda', trad: 'Cobre: até 100 m por lance', pol: 'GPON 2,5 → XGS-PON 10 Gbit/s', detail: 'A mesma fibra evolui de GPON para XGS-PON. A banda é compartilhada pelos pontos de cada splitter e depende do dimensionamento.' },
  { icon: ShieldCheck, title: 'Mais segurança', trad: 'Cobre sujeito a interferência', pol: 'Fibra imune a interferência', detail: 'A fibra não sofre interferência eletromagnética nem emite sinal. A segurança dos dados também depende de criptografia, autenticação, segmentação e configuração.' },
];
const MSG: Record<NetMode, string> = {
  trad: 'Uma infraestrutura com múltiplos equipamentos, cabeamento metálico e pontos de distribuição.',
  pol: 'Menos infraestrutura ativa. Mais eficiência, capacidade de evolução e longevidade.',
};
const HOLD: Record<NetMode, number> = { trad: 6000, pol: 8000 }, MORPH = 3000, IDLE = 15000;

/** Número que conta até o alvo (depois do atraso, para acompanhar a transição da cena). */
function CountTo({ value, delay }: { value: number; delay: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    let raf = 0; const from = shown, t0 = performance.now() + delay;
    const step = (t: number) => { const k = Math.min(1, Math.max(0, (t - t0) / 900)); setShown(Math.round(from + (value - from) * (1 - (1 - k) ** 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{shown}</>;
}

/**
 * Slide 2: o mesmo prédio com a rede tradicional ou a POL. Sozinho, alterna em loop (tradicional 6 s → transição 3 s →
 * POL 8 s → transição 3 s); um clique nos botões fixa a rede escolhida e, após 15 s sem interação, o ciclo segue de onde está.
 */
function SlidePol() {
  const scene = useMemo(buildPolScene, []);
  const [mode, setMode] = useState<NetMode>('trad');
  const [touch, setTouch] = useState(0);   // > 0: o usuário interagiu há menos de 15 s
  const [open, setOpen] = useState<number | null>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (touch) { const t = setTimeout(() => { setTouch(0); setMode((m) => (m === 'trad' ? 'pol' : 'trad')); }, IDLE); return () => clearTimeout(t); }
    const t = setTimeout(() => { moved.current = true; setMode((m) => (m === 'trad' ? 'pol' : 'trad')); }, HOLD[mode] + (moved.current ? MORPH : 0));
    return () => clearTimeout(t);
  }, [mode, touch]);
  const poke = () => { moved.current = true; setTouch((n) => n + 1); };
  const pick = (m: NetMode) => { setMode(m); poke(); };
  const pol = mode === 'pol';
  return (
    <div data-mode={mode} className="relative h-full overflow-hidden bg-[#070D15] text-white">
      <svg viewBox="0 0 1600 900" width={1600} height={900} className="absolute inset-0" role="img" aria-label={pol ? 'Prédio com rede POL: OLT no térreo, uma fibra na prumada, splitter passivo em cada andar e ONT nos pontos de uso' : 'Prédio com rede tradicional: rack central no térreo, prumada de cobre, rack com switch e energia em cada andar e um cabo de cobre por ponto'} dangerouslySetInnerHTML={{ __html: scene.svg }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(6,11,18,0.92)_0%,rgba(6,11,18,0.78)_40%,rgba(6,11,18,0)_62%)]" />
      {scene.callouts.map((c) => (
        <div key={c.mode + c.title} aria-hidden={c.mode !== mode} className="absolute w-[200px] rounded-[14px] border border-[#8FD6FF]/30 bg-[#09101A]/75 px-[18px] py-3.5 shadow-[0_0_0_5px_rgba(143,214,255,0.05)] backdrop-blur-md transition-opacity duration-700 motion-reduce:transition-none" style={{ left: POL_CALLOUT_X, top: c.top, opacity: c.mode === mode ? 1 : 0, transitionDelay: c.mode === mode ? '2.4s' : '0s' }}>
          <p className="text-[15px] font-semibold">{c.title}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-white/70">{c.text}</p>
        </div>
      ))}
      {/* seletor de arquitetura */}
      <div role="group" aria-label="Arquitetura de rede" className="absolute right-10 top-10 flex rounded-full border border-white/15 bg-[#09101A]/70 p-1 backdrop-blur-md">
        {(['trad', 'pol'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => pick(m)} className={clsx('flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold tracking-[0.14em] transition-colors duration-500', mode === m ? (m === 'pol' ? 'bg-[#4FBBFF]/20 text-white shadow-[inset_0_0_0_1px_rgba(143,214,255,0.6),0_0_18px_rgba(79,187,255,0.35)]' : 'bg-[#FF8A3D]/20 text-white shadow-[inset_0_0_0_1px_rgba(255,138,61,0.6),0_0_18px_rgba(255,138,61,0.3)]') : 'text-white/55 hover:text-white')}>
            <span className={clsx('h-2 w-2 rounded-full', m === 'pol' ? 'bg-[#4FBBFF]' : 'bg-[#FF8A3D]')} />{m === 'pol' ? 'REDE POL' : 'REDE TRADICIONAL'}
          </button>
        ))}
      </div>
      <img src="/brand/bkt-logo-white.png" alt="BKT" className="absolute left-[90px] top-14 h-12 w-[200px] object-contain object-left" draggable={false} />
      <h1 className="absolute left-[90px] top-[146px] w-[780px] font-display text-[44px] font-extrabold leading-[1.12]">Menos recursos.<span className="block text-[#9CC4EA]">Mais possibilidades.</span></h1>
      <p className="absolute left-[90px] top-[262px] w-[620px] text-[18px] leading-[1.45] text-white/70">Inovar também é fazer mais com menos, pensando na eficiência de hoje e nos recursos de amanhã.</p>
      <div className="absolute left-[90px] top-[340px] h-[84px] w-[640px]" aria-live="polite">
        {(['trad', 'pol'] as const).map((m) => (
          <p key={m} aria-hidden={m !== mode} className="absolute inset-0 flex gap-3 text-[20px] leading-[1.45] text-white/85 transition-opacity duration-700 motion-reduce:transition-none" style={{ opacity: m === mode ? 1 : 0, transitionDelay: m === mode ? '1.2s' : '0s' }}>
            <span className={clsx('mt-[11px] h-2.5 w-2.5 flex-none rounded-full', m === 'pol' ? 'bg-[#4FBBFF] shadow-[0_0_10px_#4FBBFF]' : 'bg-[#FF8A3D] shadow-[0_0_10px_#FF8A3D]')} />{MSG[m]}
          </p>
        ))}
      </div>
      {/* legenda de cores */}
      <p className="absolute left-[90px] top-[434px] flex gap-6 text-[13px] text-white/60">
        <span className="flex items-center gap-2"><span className="h-0.5 w-6 bg-[#8FD6FF]" />Fibra óptica</span>
        <span className="flex items-center gap-2"><span className="h-0.5 w-6 bg-[#FF8A3D]" />Cabo de cobre</span>
        <span className="flex items-center gap-2"><span className="h-0.5 w-6 bg-[#FFD24A]" />Energia elétrica</span>
      </p>
      <ul className="absolute left-[90px] top-[472px] grid w-[790px] grid-cols-3 gap-2.5" aria-label="Vantagens da rede POL">
        {BENEFITS.map(({ icon: Icon, title, num, trad, pol: polText, detail }, n) => (
          <li key={title} className="relative">
            <button type="button" aria-expanded={open === n} onClick={() => { setOpen(open === n ? null : n); poke(); }} onPointerEnter={() => setOpen(n)} onPointerLeave={() => setOpen((o) => (o === n ? null : o))}
              className={clsx('flex h-[112px] w-full gap-3 rounded-2xl border px-4 py-3.5 text-left backdrop-blur-md transition-[border-color,background-color,box-shadow] duration-700 motion-reduce:transition-none', pol ? 'border-[#8FD6FF]/45 bg-[#0E2236]/70 shadow-[0_0_24px_-6px_rgba(79,187,255,0.45)]' : 'border-white/10 bg-[#0A121C]/60')}
              style={{ transitionDelay: pol ? `${2.4 + n * 0.12}s` : '0s' }}>
              <span className={clsx('grid h-[38px] w-[38px] flex-none place-items-center rounded-full border transition-colors duration-700', pol ? 'border-[#8FD6FF]/60 bg-[#4FBBFF]/15' : 'border-white/15 bg-white/[0.04]')}><Icon className={clsx('h-[18px] w-[18px] transition-colors duration-700', pol ? 'text-[#8FD6FF]' : 'text-white/60')} aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-[16px] font-semibold">{title}</span>
                {num ? (
                  <span className="mt-1 flex items-baseline gap-2"><span className={clsx('num text-[30px] font-bold leading-none tabular-nums transition-colors duration-700', pol ? 'text-[#8FD6FF]' : 'text-[#FFB27A]')}><CountTo value={num[mode]} delay={pol ? 2400 : 1200} /></span><span className="text-[12.5px] leading-tight text-white/65">{pol ? polText : trad}{pol && <span className="text-white/40"> · antes {num.trad}</span>}</span></span>
                ) : (
                  <span className={clsx('mt-1.5 block text-[14px] leading-snug transition-colors duration-700', pol ? 'text-[#BFE8FF]' : 'text-white/60')}>{pol ? polText : trad}</span>
                )}
              </span>
            </button>
            {open === n && <p role="tooltip" className="absolute bottom-[calc(100%+8px)] left-0 z-10 w-[300px] rounded-xl border border-[#8FD6FF]/40 bg-[#09101A]/95 px-4 py-3 text-[13.5px] leading-snug text-white/85 shadow-[0_12px_32px_rgba(0,0,0,0.5)]">{detail}</p>}
          </li>
        ))}
      </ul>
      {/* ODS: surgem discretamente depois da transformação para a POL */}
      <OdsBar items={ODS_POL} show={pol} delay={3.2} size={52} align="right" className="right-[40px] top-[800px]" onTouch={poke} />
      <p className="absolute left-[90px] top-[812px] text-[12px] text-white/40">Contagens desta ilustração: 11 andares e 33 pontos atendidos nas duas redes. Resultados reais dependem do projeto.</p>
    </div>
  );
}

/**
 * Roteiro: abertura → BKT em Sergipe → Rede POL → RIMA → impacto humano → encerramento (≈ 2 min 30 s no automático).
 * dur: segundos de cada cena no modo automático (cobre um ciclo completo das demonstrações POL e RIMA).
 */
const SLIDES = [
  { key: 'abertura', title: 'O futuro não se espera. Se constrói.', dur: 16 },
  { key: 'presenca', title: 'A BKT em Sergipe', dur: 14 },
  { key: 'pol', title: 'Rede POL · Menos recursos. Mais possibilidades.', dur: 24 },
  { key: 'rima', title: 'RIMA · Rede Integrada Municipal de Aracaju', dur: 40 },
  { key: 'impacto', title: 'O impacto humano', dur: 31 },
  { key: 'encerramento', title: 'O que nos move', dur: 18 },
] as const;
type SlideKey = (typeof SLIDES)[number]['key'];
const IDLE_MS = 15000;

/** Link público (administração): gerar, copiar e desativar. O link completo só aparece logo após gerar. */
function ShareControl({ btn }: { btn: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const st = useQuery({ queryKey: ['institucional', 'compartilhamento'], enabled: open, queryFn: () => api<{ link: { createdAt: string; accessCount: number; lastAccessAt: string | null } | null }>('/institucional/compartilhamento') });
  const gen = useMutation({
    mutationFn: () => api<{ token: string }>('/institucional/compartilhamento', { method: 'POST', body: {} }),
    onSuccess: (r) => { setUrl(`${window.location.origin}/a/${r.token}`); setCopied(false); void qc.invalidateQueries({ queryKey: ['institucional', 'compartilhamento'] }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const off = useMutation({
    mutationFn: () => api('/institucional/compartilhamento', { method: 'DELETE' }),
    onSuccess: () => { setUrl(null); void qc.invalidateQueries({ queryKey: ['institucional', 'compartilhamento'] }); toast({ tone: 'success', message: 'Link público desativado' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const copy = async () => { if (!url) return; try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } };
  const l = st.data?.link;
  const fmt = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="relative">
      <button type="button" className={btn} aria-expanded={open} onClick={() => setOpen(!open)}><Link2 className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Link público</span></button>
      {open && (
        <div className="absolute bottom-[calc(100%+10px)] right-0 z-[80] w-[380px] border border-white/15 bg-[#0B121A] p-4 text-left text-white shadow-[0_18px_40px_rgba(0,0,0,0.55)]" role="dialog" aria-label="Link público da apresentação">
          <p className="text-sm font-semibold">Link público da apresentação</p>
          <p className="mt-1 text-[12.5px] leading-snug text-white/60">Quem tiver o link vê a apresentação inteira, sem login e só para leitura. Gerar um novo link desativa o anterior.</p>
          {url && (
            <div className="mt-3">
              <div className="flex gap-1.5"><input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 border border-white/15 bg-black/30 px-2 py-1.5 text-[12px] text-white" aria-label="Link público" /><button type="button" onClick={() => void copy()} className="flex items-center gap-1.5 bg-[#4FBBFF]/20 px-3 text-[12px] font-semibold text-white hover:bg-[#4FBBFF]/30">{copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}{copied ? 'Copiado' : 'Copiar'}</button></div>
              <p className="mt-1.5 text-[11.5px] text-[#FFD24A]/80">Copie agora: por segurança, o link completo não é exibido de novo.</p>
            </div>
          )}
          <p className="mt-3 text-[12.5px] text-white/70">{st.isLoading ? 'Carregando…' : l ? <>Ativo desde {fmt(l.createdAt)} · {l.accessCount} acesso{l.accessCount === 1 ? '' : 's'}{l.lastAccessAt ? ` · último em ${fmt(l.lastAccessAt)}` : ''}</> : 'Nenhum link ativo.'}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={gen.isPending} onClick={() => gen.mutate()} className="bg-white/10 px-3 py-2 text-[12.5px] font-semibold hover:bg-white/15 disabled:opacity-50">{l ? 'Gerar novo link' : 'Gerar link'}</button>
            {l && <button type="button" disabled={off.isPending} onClick={() => off.mutate()} className="px-3 py-2 text-[12.5px] font-semibold text-[#FF8A8A] hover:bg-[#FF4D4D]/10 disabled:opacity-50">Desativar</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Apresentação em tela cheia. Com publicToken, é o LINK PÚBLICO: só leitura, sem login, sem editar nem compartilhar;
 * layout e selos vêm de /public/apresentacao/:token.
 */
export function InstitutionalPresentation({ publicToken }: { publicToken?: string } = {}) {
  const isPublic = !!publicToken;
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const i = Math.min(SLIDES.length - 1, Math.max(0, Number(sp.get('s') ?? 1) - 1 || 0));
  const go = useCallback((n: number) => setSp({ s: String(Math.min(SLIDES.length, Math.max(1, n + 1))) }, { replace: true }), [setSp]);
  // modo automático: avança as cenas sozinho; qualquer interação suspende por 15 s (sem reiniciar a cena)
  const [auto, setAuto] = useState(true);
  const [prog, setProg] = useState(0);
  const [held, setHeld] = useState(false);
  const elapsed = useRef(0), last = useRef(0);
  const touch = useCallback(() => { last.current = Date.now(); setHeld(true); }, []);
  // cenas já visitadas ficam montadas (escondidas): o estado de POL e RIMA se mantém ao navegar
  const [seen, setSeen] = useState<Set<SlideKey>>(() => new Set([SLIDES[i]!.key]));
  const wraps = useRef<Partial<Record<SlideKey, HTMLDivElement | null>>>({});
  useEffect(() => {
    const k = SLIDES[i]!.key;
    setSeen((v) => (v.has(k) ? v : new Set(v).add(k)));
    elapsed.current = 0; setProg(0);
    const el = wraps.current[k];
    if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) el.animate([{ opacity: 0, filter: 'blur(10px) brightness(.4)', transform: 'scale(1.035)' }, { opacity: 1, filter: 'none', transform: 'none' }], { duration: 1200, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }, [i]);
  const close = useCallback(() => { if (isPublic) return; if (document.fullscreenElement) void document.exitFullscreen(); nav('/playbooks'); }, [nav, isPublic]);
  const [full, setFull] = useState(!!document.fullscreenElement);
  const toggleFull = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => undefined); }, []);
  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); touch(); go(i + 1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); touch(); go(i - 1); }
      else if (e.key === 'f' || e.key === 'F') toggleFull();
      else if (e.key === 'Escape' && !document.fullscreenElement) close();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [i, go, close, toggleFull, touch]);
  const btn = 'flex h-10 items-center gap-2 px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30';
  const toast = useToast();
  const qc = useQueryClient();
  const slide = SLIDES[i]!.key;
  const pub = useQuery({ queryKey: ['institucional', 'publico', publicToken], enabled: isPublic, retry: false, queryFn: () => api<{ layouts: Record<string, Partial<Layout>>; seals: Seal[] }>(`/public/apresentacao/${encodeURIComponent(publicToken!)}`) });
  const savedPriv = useQuery({ queryKey: ['institucional', 'layout', 'presenca'], enabled: !isPublic, queryFn: () => api<{ layout: Partial<Layout> | null; canManage: boolean }>('/institucional/layout/presenca') });
  const saved = isPublic ? { data: pub.data ? { layout: pub.data.layouts.presenca ?? null, canManage: false } : undefined } : savedPriv;
  const sealsPriv = useQuery({ queryKey: ['institucional', 'selos'], enabled: !isPublic, queryFn: () => api<{ items: Seal[] }>('/institucional/selos') }).data?.items;
  const seals = (isPublic ? pub.data?.seals : sealsPriv) ?? [];
  const sealSrc = (x: Seal) => (isPublic ? `/api/v1/public/apresentacao/${encodeURIComponent(publicToken!)}/selos/${x.id}/imagem?v=${x.sha256.slice(0, 12)}` : `/api/v1/institucional/selos/${x.id}/imagem?v=${x.sha256.slice(0, 12)}`);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Layout | null>(null);
  const savedBlocks = saved.data?.layout?.blocks;
  const legacySeals = (savedBlocks?.selos?.h ?? 0) > 100;   // quadro antigo de 190 px: passa a usar o rodapé discreto
  const current: Layout = draft ?? { blocks: { ...DEFAULT_LAYOUT.blocks, ...(savedBlocks ?? {}), ...(legacySeals ? { selos: DEFAULT_LAYOUT.blocks.selos } : {}) }, texts: { ...DEFAULT_LAYOUT.texts, ...(saved.data?.layout?.texts ?? {}) } };
  const save = useMutation({
    mutationFn: (l: Layout | null) => api('/institucional/layout/presenca', { method: 'PUT', body: { layout: l } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['institucional', 'layout', 'presenca'] }); setEdit(false); setDraft(null); toast({ tone: 'success', message: 'Layout salvo' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  useEffect(() => {
    if (!auto || edit) return;
    const id = setInterval(() => {
      const idle = Date.now() - last.current >= IDLE_MS;
      setHeld(!idle);
      if (!idle) return;
      elapsed.current += 250;
      const d = SLIDES[i]!.dur * 1000;
      setProg(Math.min(1, elapsed.current / d));
      if (elapsed.current >= d) go((i + 1) % SLIDES.length);
    }, 250);
    return () => clearInterval(id);
  }, [auto, edit, i, go]);
  const textScale = (d: number) => setDraft({ ...current, blocks: { ...current.blocks, texto: { ...current.blocks.texto, scale: Math.max(0.6, Math.min(1.6, Math.round(((current.blocks.texto.scale ?? 1) + d) * 100) / 100)) } } });
  if (isPublic && pub.isError) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#04080E] px-6 text-center text-white">
      <img src="/brand/bkt-logo-white.png" alt="BKT" className="h-10 w-[170px] object-contain" />
      <p className="text-lg font-semibold">Este link da apresentação não está mais disponível.</p>
      <p className="max-w-md text-sm text-white/60">Ele pode ter sido desativado ou substituído por um novo. Peça o link atualizado à BKT.</p>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0E141B]" role="region" aria-label="Apresentação institucional" aria-roledescription="apresentação">
      <div className={clsx('flex min-h-0 flex-1 flex-col', !full && 'px-3 py-3 sm:px-6 sm:py-5')}><Stage>
        <div className="relative h-full w-full bg-[#04080E]" onPointerDownCapture={touch}>
          {SLIDES.map(({ key }) => seen.has(key) && (
            <div key={key} ref={(el) => { wraps.current[key] = el; }} className={clsx('absolute inset-0', key !== slide && 'hidden')} aria-hidden={key !== slide}>
              <Suspense fallback={<div className="h-full bg-[#04080E]" />}>
                {key === 'abertura' && <SceneOpening />}
                {key === 'presenca' && <SlidePresence layout={current} edit={edit} setLayout={setDraft} seals={seals} sealSrc={sealSrc} />}
                {key === 'pol' && <SlidePol />}
                {key === 'rima' && <RimaSlide />}
                {key === 'impacto' && <SceneImpact active={key === slide} />}
                {key === 'encerramento' && <SceneClosing />}
              </Suspense>
            </div>
          ))}
          {/* acabamento de filme: vinheta e grão sutil */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_62%,rgba(0,0,0,0.42))]" />
          <div aria-hidden className="cine-grain pointer-events-none absolute inset-0" />
        </div>
      </Stage></div>
      <nav aria-label="Controles da apresentação" className="relative flex items-center justify-between border-t border-white/10 px-3 py-2 sm:px-6">
        <span aria-hidden className="absolute left-0 top-[-1px] h-px bg-[#8FD6FF] transition-[width] duration-200 ease-linear" style={{ width: `${auto ? prog * 100 : 0}%` }} />
        {isPublic ? <img src="/brand/bkt-logo-white.png" alt="BKT" className="h-6 w-[100px] object-contain object-left opacity-80" /> : <button type="button" className={btn} onClick={close}><X className="h-4 w-4" aria-hidden />Fechar</button>}
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className={btn} onClick={() => { setAuto(!auto); last.current = 0; }} aria-pressed={auto} aria-label={auto ? 'Pausar o modo automático' : 'Retomar o modo automático'}>{auto ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}<span className="hidden md:inline">{auto ? (held ? 'Automático · pausado pela interação' : 'Automático') : 'Manual'}</span></button>
          <p className="truncate text-sm text-white/60">Cena <span className="num text-white">{i + 1}</span> / {SLIDES.length} · {SLIDES[i]!.title}</p>
        </div>
        <div className="flex gap-1">
          {!isPublic && savedPriv.data?.canManage && !full && <ShareControl btn={btn} />}
          {slide === 'presenca' && saved.data?.canManage && !full && (edit ? <>
            <button type="button" className={btn} onClick={() => textScale(-0.05)} aria-label="Diminuir o texto">A−</button>
            <button type="button" className={btn} onClick={() => textScale(0.05)} aria-label="Aumentar o texto">A+</button>
            <button type="button" className={btn} onClick={() => save.mutate(null)}>Restaurar padrão</button>
            <button type="button" className={btn} onClick={() => { setEdit(false); setDraft(null); }}>Cancelar</button>
            <button type="button" className={clsx(btn, 'bg-white/10 text-white')} onClick={() => save.mutate(current)}>Salvar layout</button>
          </> : <button type="button" className={btn} onClick={() => { setDraft(current); setEdit(true); }}><Move className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Editar layout</span></button>)}
          <button type="button" className={btn} onClick={toggleFull} aria-label={full ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}>{full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}<span className="hidden sm:inline">{full ? 'Sair da tela cheia' : 'Tela cheia'}</span></button><button type="button" className={btn} onClick={() => { touch(); go(i - 1); }} disabled={i === 0} aria-label="Cena anterior"><ChevronLeft className="h-5 w-5" /></button><button type="button" className={btn} onClick={() => { touch(); go(i + 1); }} disabled={i === SLIDES.length - 1} aria-label="Próxima cena"><ChevronRight className="h-5 w-5" /></button></div>
      </nav>
    </div>
  );
}
