/**
 * Central de Playbooks → Apresentação institucional da BKT (tela cheia, 16:9, setas para navegar).
 * Slide 1: logo, presença em Sergipe (mapa em pontos com Porto da Folha em destaque) e os selos e certificações,
 * que entram como imagem em Configuração → Personalização (espaço "Selos e certificações").
 */
import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../components/ui/overlay';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Move, X } from 'lucide-react';
import { api } from '../../lib/api';
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

type Rect = { x: number; y: number; w: number; h: number; scale?: number };
type Layout = { blocks: Record<'logo' | 'texto' | 'mapa' | 'selos', Rect>; texts: { title: string; accent: string; body: string } };
/** Posição padrão dos blocos no palco de 1600 × 900. */
export const DEFAULT_LAYOUT: Layout = {
  blocks: { logo: { x: 90, y: 64, w: 230, h: 56 }, texto: { x: 90, y: 160, w: 760, h: 300, scale: 1 }, mapa: { x: 730, y: 30, w: 860, h: 820 }, selos: { x: 90, y: 620, w: 760, h: 190 } },
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

function SlidePresence({ layout, edit, setLayout }: { layout: Layout; edit: boolean; setLayout: (l: Layout) => void }) {
  const seals = useQuery({ queryKey: ['institucional', 'selos'], queryFn: () => api<{ items: { id: string; name: string; sha256: string }[] }>('/institucional/selos') }).data?.items ?? [];
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
      {(seals.length > 0 || edit) && (
        <Block id="selos" r={b.selos} edit={edit} onChange={set('selos')}>
          <section aria-label="Selos e certificações" className="flex h-full flex-col border border-white/10 bg-white/[0.03] px-7 py-5">
            <p className="text-[15px] font-semibold text-[#9CC4EA]">Selos e certificações</p>
            {seals.length ? <ul className="mt-3 flex min-h-0 flex-1 items-center gap-6">{seals.map((x) => <li key={x.id} className="flex h-full min-w-0 flex-1 items-center justify-center"><img src={`/api/v1/institucional/selos/${x.id}/imagem?v=${x.sha256.slice(0, 12)}`} alt={x.name} className="max-h-full max-w-full object-contain" draggable={false} /></li>)}</ul>
              : <p className="mt-3 text-[15px] text-white/50">Sem selos enviados (Configuração → Personalização). Na apresentação, este quadro só aparece quando houver selos.</p>}
          </section>
        </Block>
      )}
    </div>
  );
}

const SLIDES = [{ key: 'presenca', title: 'A BKT em Sergipe' }];

export function InstitutionalPresentation() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const i = Math.min(SLIDES.length - 1, Math.max(0, Number(sp.get('s') ?? 1) - 1 || 0));
  const go = useCallback((n: number) => setSp({ s: String(Math.min(SLIDES.length, Math.max(1, n + 1))) }, { replace: true }), [setSp]);
  const close = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen(); nav('/playbooks'); }, [nav]);
  const [full, setFull] = useState(!!document.fullscreenElement);
  const toggleFull = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => undefined); }, []);
  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(i + 1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(i - 1); }
      else if (e.key === 'f' || e.key === 'F') toggleFull();
      else if (e.key === 'Escape' && !document.fullscreenElement) close();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [i, go, close, toggleFull]);
  const btn = 'flex h-10 items-center gap-2 px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30';
  const toast = useToast();
  const qc = useQueryClient();
  const slide = SLIDES[i]!.key;
  const saved = useQuery({ queryKey: ['institucional', 'layout', slide], queryFn: () => api<{ layout: Partial<Layout> | null; canManage: boolean }>(`/institucional/layout/${slide}`) });
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Layout | null>(null);
  const current: Layout = draft ?? { blocks: { ...DEFAULT_LAYOUT.blocks, ...(saved.data?.layout?.blocks ?? {}) }, texts: { ...DEFAULT_LAYOUT.texts, ...(saved.data?.layout?.texts ?? {}) } };
  const save = useMutation({
    mutationFn: (l: Layout | null) => api(`/institucional/layout/${slide}`, { method: 'PUT', body: { layout: l } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['institucional', 'layout', slide] }); setEdit(false); setDraft(null); toast({ tone: 'success', message: 'Layout salvo' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const textScale = (d: number) => setDraft({ ...current, blocks: { ...current.blocks, texto: { ...current.blocks.texto, scale: Math.max(0.6, Math.min(1.6, Math.round(((current.blocks.texto.scale ?? 1) + d) * 100) / 100)) } } });
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0E141B]" role="region" aria-label="Apresentação institucional" aria-roledescription="apresentação">
      <div className={clsx('flex min-h-0 flex-1 flex-col', !full && 'px-3 py-3 sm:px-6 sm:py-5')}><Stage>{slide === 'presenca' && <SlidePresence layout={current} edit={edit} setLayout={setDraft} />}</Stage></div>
      <nav aria-label="Controles da apresentação" className="flex items-center justify-between border-t border-white/10 px-3 py-2 sm:px-6">
        <button type="button" className={btn} onClick={close}><X className="h-4 w-4" aria-hidden />Fechar</button>
        <p className="text-sm text-white/60"><span className="num text-white">{i + 1}</span> / {SLIDES.length} · {SLIDES[i]!.title}</p>
        <div className="flex gap-1">
          {saved.data?.canManage && !full && (edit ? <>
            <button type="button" className={btn} onClick={() => textScale(-0.05)} aria-label="Diminuir o texto">A−</button>
            <button type="button" className={btn} onClick={() => textScale(0.05)} aria-label="Aumentar o texto">A+</button>
            <button type="button" className={btn} onClick={() => save.mutate(null)}>Restaurar padrão</button>
            <button type="button" className={btn} onClick={() => { setEdit(false); setDraft(null); }}>Cancelar</button>
            <button type="button" className={clsx(btn, 'bg-white/10 text-white')} onClick={() => save.mutate(current)}>Salvar layout</button>
          </> : <button type="button" className={btn} onClick={() => { setDraft(current); setEdit(true); }}><Move className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Editar layout</span></button>)}
          <button type="button" className={btn} onClick={toggleFull} aria-label={full ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}>{full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}<span className="hidden sm:inline">{full ? 'Sair da tela cheia' : 'Tela cheia'}</span></button><button type="button" className={btn} onClick={() => go(i - 1)} disabled={i === 0} aria-label="Slide anterior"><ChevronLeft className="h-5 w-5" /></button><button type="button" className={btn} onClick={() => go(i + 1)} disabled={i === SLIDES.length - 1} aria-label="Próximo slide"><ChevronRight className="h-5 w-5" /></button></div>
      </nav>
    </div>
  );
}
