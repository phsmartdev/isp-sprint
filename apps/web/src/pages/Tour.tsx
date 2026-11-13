/**
 * Tour RevOps: apresentação em tela cheia, slide a slide, seguindo a jornada do cliente e depois a camada de gestão.
 * Palco fixo de 1600×900 escalado para a janela (como um PPT). Setas, espaço, Home/End, F (tela cheia), I (índice), Esc (fechar).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, LayoutGrid, Maximize2, Minimize2, X } from 'lucide-react';
import { BrandSymbol } from '../components/brand';
import { FOUNDATION, MODULES, REVOPS_PILLARS, SLIDES, START_BY_PROFILE, STATIONS, type ModuleSlide, type Slide, type StationKey } from '../features/tour/content';

const W = 1600, H = 900;
const total = SLIDES.length;
const firstModuleOf = (k: StationKey) => SLIDES.findIndex((s) => s.kind === 'module' && s.stations.includes(k));
const titleOf = (s: Slide) => (s.kind === 'module' ? s.title : { cover: 'Abertura', revops: 'O que é RevOps', journey: 'A jornada do cliente', foundation: 'Os fundamentos', layer: 'A camada de gestão', start: 'Por onde começar' }[s.kind]);

/** Palco escalado: mantém a proporção 16:9 e o texto do mesmo tamanho relativo em qualquer tela. */
function Stage({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(Math.min(el.clientWidth / W, el.clientHeight / H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div style={{ width: W * k, height: H * k }} className="relative shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        <div style={{ width: W, height: H, transform: `scale(${k})`, transformOrigin: 'top left' }} className="absolute left-0 top-0 overflow-hidden bg-white text-ink">{children}</div>
      </div>
    </div>
  );
}

/** Linha da jornada: hexágonos ligados por um trilho; as paradas do slide atual ficam acesas. */
function JourneyLine({ on = [], big = false, onPick }: { on?: StationKey[]; big?: boolean; onPick?: (k: StationKey) => void }) {
  return (
    <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${STATIONS.length}, minmax(0, 1fr))` }}>
      <span aria-hidden className={clsx('absolute left-[6.25%] right-[6.25%] h-[3px] bg-[#D5DCE4]', big ? 'top-[34px]' : 'top-[15px]')} />
      {STATIONS.map((st, i) => {
        const lit = on.includes(st.key);
        const node = (
          <span className="relative flex flex-col items-center text-center">
            <svg viewBox="0 0 100 100" className={clsx(big ? 'h-[70px] w-[70px]' : 'h-8 w-8')} aria-hidden>
              <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill={lit || big ? '#2F5986' : '#fff'} stroke={lit || big ? '#2F5986' : '#AEB8C3'} strokeWidth="5" />
              <text x="50" y="62" textAnchor="middle" fontSize="34" fontWeight="700" fill={lit || big ? '#fff' : '#7D8791'} fontFamily="inherit">{i + 1}</text>
            </svg>
            <span className={clsx('mt-2 font-semibold leading-tight', big ? 'text-[22px] text-navy' : 'text-[13px]', !big && (lit ? 'text-primary' : 'text-[#7D8791]'))}>{st.label}</span>
            {big && <span className="mt-1.5 max-w-[170px] text-[16px] leading-snug text-[#5A6570]">{st.hint}</span>}
          </span>
        );
        return <li key={st.key} className="relative">{onPick ? <button type="button" onClick={() => onPick(st.key)} className="w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Ir para ${st.label}`}>{node}</button> : node}</li>;
      })}
    </ol>
  );
}

function Cover({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative h-full bg-navy text-white">
      <BrandSymbol variant="negativo" className="absolute -right-[150px] top-1/2 h-[1000px] w-[1000px] -translate-y-1/2 opacity-[0.13]" />
      <div className="relative flex h-full flex-col justify-between px-[110px] py-[90px]">
        <div className="flex items-center gap-5">
          <img src="/brand/bkt-logo-white.png" alt="BKT" className="h-[46px] w-auto" draggable={false} />
          <span className="border-l border-white/30 pl-5 font-display text-[26px] font-semibold text-white/75">RevOps</span>
        </div>
        <div>
          <p className="mb-6 text-[26px] font-medium text-[#9CC4EA]">Tour RevOps · Revenue Operations</p>
          <h1 className="max-w-[1100px] font-display text-[92px] font-extrabold leading-[0.98] tracking-[-0.01em]">A gestão comercial da BKT, centralizada.</h1>
          <p className="mt-8 max-w-[900px] text-[26px] leading-[1.45] text-white/80">Marketing, vendas, licitações, contratos, pós-venda, times, orçamento e conhecimento sob a mesma gestão e com os mesmos dados, do primeiro contato à renovação.</p>
        </div>
        <div className="flex items-end justify-between">
          <button type="button" onClick={onStart} className="bg-white px-9 py-4 text-[22px] font-bold text-navy hover:bg-[#E8EEF5] focus-visible:outline focus-visible:outline-4 focus-visible:outline-[#9CC4EA]">Começar a apresentação</button>
          <p className="text-[18px] text-white/55">{total} slides · {MODULES.length} módulos · setas do teclado para navegar</p>
        </div>
      </div>
    </div>
  );
}

function RevOps() {
  return (
    <div className="grid h-full grid-cols-[600px_1fr]">
      <aside className="relative flex flex-col justify-between overflow-hidden bg-navy px-[70px] py-[80px] text-white">
        <BrandSymbol variant="negativo" className="absolute -bottom-[170px] -left-[170px] h-[520px] w-[520px] opacity-[0.10]" />
        <div className="relative">
          <p className="text-[22px] font-medium text-[#9CC4EA]">O que é RevOps</p>
          <h2 className="mt-4 font-display text-[64px] font-extrabold leading-[1.02]">Revenue Operations</h2>
          <p className="mt-8 text-[25px] leading-[1.5] text-white/85">Toda a operação de receita comandada por uma gestão comercial só: processo, dados e regras iguais para todas as áreas que vendem, entregam e renovam.</p>
        </div>
        <p className="relative border-l-[3px] border-[#9CC4EA] pl-5 text-[24px] font-semibold leading-[1.4]">Não é um CRM de vendas da porta para dentro. É a central de gestão comercial da empresa.</p>
      </aside>
      <section className="flex flex-col justify-center px-[70px] py-[80px]">
        <dl className="divide-y divide-[#DCE2E8] border-y border-[#DCE2E8]">
          {REVOPS_PILLARS.map((p) => (
            <div key={p.t} className="grid grid-cols-[320px_1fr] gap-8 py-8">
              <dt className="font-display text-[30px] font-bold leading-tight text-navy">{p.t}</dt>
              <dd className="text-[21px] leading-[1.5] text-[#4A5560]">{p.d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function Journey({ go }: { go: (i: number) => void }) {
  return (
    <div className="relative flex h-full flex-col px-[100px] py-[80px]">
      <p className="text-[22px] font-semibold text-primary">A jornada do cliente</p>
      <h2 className="mt-3 max-w-[1250px] font-display text-[60px] font-extrabold leading-[1.05] text-navy">A receita em oito paradas, sob uma gestão só.</h2>
      <p className="mt-6 max-w-[1150px] text-[24px] leading-[1.5] text-[#4A5560]">Cada parada tem um módulo responsável e a mesma gestão comercial acompanhando tudo. O que acontece numa vira histórico na seguinte: o lead vira oportunidade, a oportunidade vira contrato, o contrato abre a implantação e o sucesso do cliente prepara a renovação.</p>
      <div className="mt-auto pb-10"><JourneyLine big onPick={(k) => { const i = firstModuleOf(k); if (i >= 0) go(i); }} /></div>
      <p className="text-[17px] text-[#7D8791]">Clique numa parada para ir direto ao módulo.</p>
    </div>
  );
}

function Grid({ items, cols = 3, size = 'md' }: { items: { t: string; d: string }[]; cols?: number; size?: 'md' | 'lg' }) {
  return (
    <dl className="grid border-l border-t border-[#DCE2E8]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {items.map((h) => (
        <div key={h.t} className={clsx('border-b border-r border-[#DCE2E8]', size === 'lg' ? 'px-8 py-7' : 'px-7 py-6')}>
          <dt className={clsx('font-display font-bold leading-tight text-navy', size === 'lg' ? 'text-[27px]' : 'text-[23px]')}>{h.t}</dt>
          <dd className={clsx('mt-2.5 leading-[1.45] text-[#4A5560]', size === 'lg' ? 'text-[20px]' : 'text-[18px]')}>{h.d}</dd>
        </div>
      ))}
    </dl>
  );
}

function Foundation() {
  return (
    <div className="relative flex h-full flex-col px-[100px] py-[80px]">
      <p className="text-[22px] font-semibold text-primary">Os fundamentos</p>
      <h2 className="mt-3 font-display text-[60px] font-extrabold leading-[1.05] text-navy">As regras de gestão que valem em tudo.</h2>
      <div className="mt-auto"><Grid items={FOUNDATION} size="lg" /></div>
    </div>
  );
}

function Layer({ go }: { go: (i: number) => void }) {
  const cross = MODULES.filter((x) => !x.stations.length);
  return (
    <div className="relative flex h-full flex-col bg-[#F3F6F9] px-[100px] py-[80px]">
      <p className="text-[22px] font-semibold text-primary">A camada de gestão</p>
      <h2 className="mt-3 max-w-[1250px] font-display text-[60px] font-extrabold leading-[1.05] text-navy">A gestão comercial que comanda a jornada.</h2>
      <p className="mt-6 max-w-[1150px] text-[24px] leading-[1.5] text-[#4A5560]">Estes módulos não ficam numa parada: é deles que a liderança mede, financia, orienta e governa a operação inteira. É o que faz do RevOps uma central de gestão, e não só uma ferramenta de vendas.</p>
      <div className="mt-auto opacity-70"><JourneyLine /></div>
      <ul className="mt-8 grid grid-cols-7 gap-px bg-[#C9D3DD]">
        {cross.map((x) => (
          <li key={x.key} className="bg-white">
            <button type="button" onClick={() => go(SLIDES.indexOf(x))} className="flex h-[150px] w-full flex-col justify-between p-5 text-left hover:bg-[#EAF0F6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <span className="font-display text-[22px] font-bold leading-tight text-navy">{x.title}</span>
              <span className="text-[15px] leading-snug text-[#7D8791]">{x.who.join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Module({ s, n }: { s: ModuleSlide; n: number }) {
  const cols = s.highlights.length > 4 ? 3 : 2;
  return (
    <div className="grid h-full grid-cols-[560px_1fr]">
      <aside className="relative flex flex-col overflow-hidden bg-navy px-[64px] py-[70px] text-white">
        <BrandSymbol variant="negativo" className="absolute -bottom-[150px] -right-[150px] h-[460px] w-[460px] opacity-[0.10]" />
        <div className="relative">
          <p className="text-[19px] font-medium text-[#9CC4EA]">{s.area}</p>
          <h2 className="mt-4 font-display text-[54px] font-extrabold leading-[1.04]">{s.title}</h2>
          <p className="mt-7 text-[23px] leading-[1.5] text-white/85">{s.purpose}</p>
        </div>
        <div className="relative mt-auto">
          <p className="text-[16px] text-white/55">Quem usa</p>
          <p className="mt-2 text-[20px] font-medium text-white">{s.who.join(' · ')}</p>
          <p className="mt-8 border-l-[3px] border-[#9CC4EA] pl-5 text-[21px] font-medium leading-[1.45] text-white">{s.takeaway}</p>
        </div>
      </aside>
      <section className="flex min-w-0 flex-col px-[64px] py-[64px]">
        <div className="flex items-start justify-between gap-10">
          <div className="min-w-0 flex-1">{s.stations.length ? <JourneyLine on={s.stations} /> : <p className="text-[18px] font-semibold text-[#7D8791]">Atravessa a jornada inteira</p>}</div>
          <span className="num shrink-0 pt-1 text-[18px] text-[#AEB8C3]">{String(n + 1).padStart(2, '0')} / {total}</span>
        </div>
        <div className="my-auto pt-10"><Grid items={s.highlights} cols={cols} /></div>
        <p className="mt-6 text-[17px] text-[#7D8791]">No sistema: <Link to={s.link.to} className="font-semibold text-primary underline-offset-4 hover:underline">{s.link.label}</Link></p>
      </section>
    </div>
  );
}

function Start({ onClose }: { onClose: () => void }) {
  return (
    <div className="grid h-full grid-cols-[1fr_640px]">
      <section className="flex flex-col px-[100px] py-[80px]">
        <p className="text-[22px] font-semibold text-primary">Por onde começar</p>
        <h2 className="mt-3 font-display text-[60px] font-extrabold leading-[1.05] text-navy">Cada perfil tem um primeiro passo.</h2>
        <table className="mt-auto w-full border-t border-[#DCE2E8] text-left">
          <tbody>{START_BY_PROFILE.map(([p, d]) => <tr key={p} className="border-b border-[#DCE2E8]"><th className="w-[230px] py-5 pr-6 align-top font-display text-[24px] font-bold text-navy">{p}</th><td className="py-5 text-[21px] leading-[1.45] text-[#4A5560]">{d}</td></tr>)}</tbody>
        </table>
      </section>
      <aside className="relative flex flex-col justify-end overflow-hidden bg-navy px-[64px] py-[80px] text-white">
        <BrandSymbol variant="negativo" className="absolute -right-[170px] -top-[120px] h-[620px] w-[620px] opacity-[0.14]" />
        <p className="relative font-display text-[34px] font-bold leading-[1.2]">Uma gestão comercial, um lugar só.</p>
        <p className="relative mt-5 text-[22px] leading-[1.5] text-white/80">O detalhe de cada tela, cada regra e cada integração está no Manual do sistema, na Central de Playbooks.</p>
        <div className="relative mt-10 flex flex-col gap-4">
          <Link to="/playbooks" className="bg-white px-8 py-4 text-center text-[21px] font-bold text-navy hover:bg-[#E8EEF5]">Abrir o Manual do sistema</Link>
          <button type="button" onClick={onClose} className="border border-white/40 px-8 py-4 text-[21px] font-semibold text-white hover:bg-white/10">Voltar ao sistema</button>
        </div>
      </aside>
    </div>
  );
}

export function TourPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const i = Math.min(total - 1, Math.max(0, Number(sp.get('s') ?? 1) - 1 || 0));
  const [index, setIndex] = useState(false);
  const [full, setFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const go = useCallback((n: number) => setSp({ s: String(Math.min(total, Math.max(1, n + 1))) }, { replace: true }), [setSp]);
  const close = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen(); if (window.history.length > 1) nav(-1); else nav('/'); }, [nav]);
  const toggleFull = useCallback(() => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.(); }, []);
  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(i + 1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(i - 1); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(total - 1);
      else if (e.key === 'f' || e.key === 'F') toggleFull();
      else if (e.key === 'i' || e.key === 'I') setIndex((x) => !x);
      else if (e.key === 'Escape') { if (index) setIndex(false); else if (!document.fullscreenElement) close(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [i, go, close, toggleFull, index]);
  const s = SLIDES[i]!;
  const body = s.kind === 'cover' ? <Cover onStart={() => go(1)} /> : s.kind === 'revops' ? <RevOps /> : s.kind === 'journey' ? <Journey go={go} /> : s.kind === 'foundation' ? <Foundation /> : s.kind === 'layer' ? <Layer go={go} /> : s.kind === 'start' ? <Start onClose={close} /> : <Module s={s} n={i} />;
  const btn = 'flex h-10 items-center gap-2 px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-30';
  return (
    <div ref={root} className="fixed inset-0 z-[70] flex flex-col bg-[#1E2328]" role="region" aria-label="Tour RevOps" aria-roledescription="apresentação">
      <div className="h-[3px] bg-white/10" aria-hidden><div className="h-full bg-[#9CC4EA] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((i + 1) / total) * 100}%` }} /></div>
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-6 sm:py-5">
        <Stage><div key={s.key} className="h-full animate-[tourIn_260ms_ease-out] motion-reduce:animate-none" aria-live="polite" aria-label={`Slide ${i + 1} de ${total}: ${titleOf(s)}`}>{body}</div></Stage>
      </div>
      <nav aria-label="Controles da apresentação" className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2 sm:px-6">
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={close} aria-label="Fechar o tour (Esc)"><X className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Fechar</span></button>
          <button type="button" className={btn} onClick={() => setIndex(true)} aria-label="Índice dos slides (I)"><LayoutGrid className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Índice</span></button>
        </div>
        <p className="min-w-0 truncate text-center text-sm text-white/60"><span className="num text-white">{i + 1}</span> / {total} · {titleOf(s)}</p>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={toggleFull} aria-label={full ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}>{full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}</button>
          <button type="button" className={btn} onClick={() => go(i - 1)} disabled={i === 0} aria-label="Slide anterior"><ChevronLeft className="h-5 w-5" aria-hidden /></button>
          <button type="button" className={btn} onClick={() => go(i + 1)} disabled={i === total - 1} aria-label="Próximo slide"><ChevronRight className="h-5 w-5" aria-hidden /></button>
        </div>
      </nav>
      {index && (
        <div className="absolute inset-0 z-10 overflow-y-auto bg-[#1E2328]/97 p-6 sm:p-10" role="dialog" aria-modal="true" aria-label="Índice dos slides">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6 flex items-center justify-between"><h2 className="font-display text-2xl font-bold text-white">Índice</h2><button type="button" className={btn} onClick={() => setIndex(false)} aria-label="Fechar índice"><X className="h-5 w-5" aria-hidden /></button></div>
            <ol className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
              {SLIDES.map((x, n) => (
                <li key={x.key} className="bg-[#1E2328]">
                  <button type="button" autoFocus={n === i} onClick={() => { go(n); setIndex(false); }} className={clsx('flex h-full w-full gap-3 p-4 text-left hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white', n === i && 'bg-white/[0.08]')}>
                    <span className="num w-7 shrink-0 text-sm text-white/40">{n + 1}</span>
                    <span><span className="block font-semibold text-white">{titleOf(x)}</span>{x.kind === 'module' && <span className="text-sm text-white/50">{x.area}</span>}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
