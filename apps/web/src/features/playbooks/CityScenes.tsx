/**
 * Abertura e encerramento da apresentação institucional, sobre o MESMO mapa 3D de Aracaju da cena RIMA (RimaBase).
 * Abertura: a cidade à noite ganha vida a partir da sede da BKT; a câmera se aproxima e a rede se acende.
 * Encerramento: a câmera se afasta, a cidade conectada reaparece e as conexões convergem para a marca BKT.
 * Tudo em CSS (classes cine-* em styles/index.css), reiniciado a cada vez que a cena fica visível.
 */
import { useMemo } from 'react';
import { RimaBase } from './RimaSlide';
import { RIMA_BKT, RIMA_POINTS, RIMA_POPS, RIMA_RING } from './aracajuRima';

const ORIGIN = '1150px 430px';
const dist = (x: number, y: number) => Math.hypot(x - RIMA_BKT[0], y - RIMA_BKT[1]);
const MAXD = Math.max(...RIMA_POINTS.map((p) => dist(p.x, p.y)));
const d = (s: number) => ({ animationDelay: `${s.toFixed(2)}s` });

/** partículas sutis subindo (determinísticas) */
export function Particles({ n = 38, warm = false }: { n?: number; warm?: boolean }) {
  const ps = useMemo(() => { let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; return Array.from({ length: n }, () => ({ x: r() * 1600, y: 200 + r() * 700, sz: 1 + r() * 2.2, dur: 9 + r() * 10, del: -r() * 18, o: 0.25 + r() * 0.5 })); }, [n]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {ps.map((p, i) => <span key={i} className="cine-float absolute rounded-full" style={{ left: p.x, top: p.y, width: p.sz, height: p.sz, opacity: p.o, background: warm && i % 3 === 0 ? '#FFD9A0' : '#9FD8FF', boxShadow: `0 0 ${p.sz * 3}px ${warm && i % 3 === 0 ? '#FFB86B' : '#4FBBFF'}`, animationDuration: `${p.dur}s`, animationDelay: `${p.del}s` }} />)}
    </div>
  );
}

/** rede acesa sobre o mapa: unidades a partir da BKT, anel do backbone, acesso e pulsos */
function CityLights({ t0, uid }: { t0: number; uid: string }) {
  return (
    <g>
      <g style={{ mixBlendMode: 'screen' }}>
        {RIMA_POINTS.map((p, i) => <path key={`a${i}`} d={p.d} pathLength={100} className="cine-draw" style={{ ...d(t0 + 2.6 + (dist(p.x, p.y) / MAXD) * 2.4), animationDuration: '1.6s' }} fill="none" stroke="#8FD6FF" strokeOpacity=".55" strokeWidth="1" />)}
        {RIMA_RING.map((r, i) => <g key={`r${i}`}>
          <path d={r.d} pathLength={100} className="cine-draw" style={{ ...d(t0 + 1.6 + i * 0.35), animationDuration: '2.2s' }} fill="none" stroke="#7DF9FF" strokeWidth="8" strokeOpacity=".35" filter={`url(#${uid}-glow)`} />
          <path d={r.d} pathLength={100} className="cine-draw" style={{ ...d(t0 + 1.6 + i * 0.35), animationDuration: '2.2s' }} fill="none" stroke="#E6FBFF" strokeWidth="2.6" strokeLinecap="round" />
        </g>)}
        <g className="cine-rise" style={d(t0 + 4.2)}>
          {RIMA_RING.map((r, i) => [0, 1, 2].map((o) => <path key={`p${i}${o}`} d={r.d} pathLength={100} stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" strokeDasharray="2 98" className="pol-run" style={{ ['--t' as string]: '3.2s', animationDelay: `${-o * 1.07 - i * 0.4}s` }} />))}
          {RIMA_POINTS.filter((_, i) => i % 2 === 0).map((p, i) => <path key={`q${i}`} d={p.d} pathLength={200} stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" strokeDasharray="5 195" className="pol-run" style={{ ['--t' as string]: '2.6s', animationDelay: `${-((i * 0.37) % 2.6)}s` }} />)}
        </g>
      </g>
      {RIMA_POINTS.map((p, i) => (
        <g key={`u${i}`} className="cine-dot" style={d(t0 + 0.8 + (dist(p.x, p.y) / MAXD) * 3.2)}>
          <circle cx={p.x} cy={p.y} r="7" fill={`url(#${uid}-halo)`} />
          <circle cx={p.x} cy={p.y} r="2.2" fill={i % 4 === 0 ? '#FFE2B0' : '#E6FBFF'} />
        </g>
      ))}
      {RIMA_POPS.map((p, i) => <g key={`pop${i}`} className="cine-dot" style={d(t0 + 1.4 + i * 0.3)}><circle cx={p.x} cy={p.y} r="16" fill={`url(#${uid}-halo)`} /><circle cx={p.x} cy={p.y} r="3.6" fill="#7DF9FF" /></g>)}
      {/* a luz nasce na sede da BKT */}
      <g className="cine-dot" style={d(t0 + 0.2)}>
        <circle cx={RIMA_BKT[0]} cy={RIMA_BKT[1]} r="46" fill={`url(#${uid}-halo)`} />
        <circle cx={RIMA_BKT[0]} cy={RIMA_BKT[1]} r="12" fill="none" stroke="#E879F9" strokeWidth="1.4" className="rm-beacon" />
        <circle cx={RIMA_BKT[0]} cy={RIMA_BKT[1]} r="4.5" fill="#fff" />
      </g>
    </g>
  );
}

/** CENA 01 — ABERTURA */
export function SceneOpening() {
  return (
    <div className="relative h-full overflow-hidden bg-[#04080E] text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_45%,rgba(47,89,134,0.42),transparent_62%)]" />
      <div className="cine-push absolute inset-0" style={{ transformOrigin: ORIGIN }}>
        <svg viewBox="0 0 1600 900" width={1600} height={900} className="cine-reveal absolute inset-0" role="img" aria-label="Aracaju à noite: a partir da sede da BKT, a rede óptica se acende e liga a cidade">
          <RimaBase uid="op" labels={false} />
          <CityLights t0={0.6} uid="op" />
        </svg>
      </div>
      {/* profundidade de campo: bordas levemente desfocadas */}
      <div aria-hidden className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_66%_52%,transparent_38%,black_80%)] [backdrop-filter:blur(2.5px)]" />
      <Particles />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(4,8,14,0.94)_0%,rgba(4,8,14,0.7)_36%,rgba(4,8,14,0)_60%)]" />
      <img src="/brand/bkt-logo-white.png" alt="BKT" className="cine-rise absolute left-[96px] top-[84px] h-11 w-[190px] object-contain object-left" style={d(4.6)} draggable={false} />
      <h1 className="absolute left-[96px] top-[300px] w-[720px] font-display text-[52px] font-extrabold leading-[1.1]">
        <span className="cine-rise block" style={d(1.2)}>O futuro não se espera.</span>
        <span className="cine-rise block text-[#9CC4EA]" style={d(2.3)}>Se constrói.</span>
      </h1>
      <p className="cine-rise absolute left-[96px] top-[470px] w-[560px] text-[21px] leading-[1.5] text-white/80" style={d(3.4)}>Acreditamos na tecnologia como força para desenvolver pessoas, negócios e toda uma região.</p>
      <p className="cine-rise absolute bottom-[54px] left-[96px] text-[12px] font-semibold tracking-[0.24em] text-white/45" style={d(5.4)}>ARACAJU · SERGIPE</p>
    </div>
  );
}

/** CENA 05 — ENCERRAMENTO: a câmera se afasta e as conexões convergem para a marca */
const FOCUS: [number, number] = [1055, 167];   // ponto no mapa que termina no centro-alto da tela (ver cine-pull)
export function SceneClosing() {
  const lines = RIMA_POINTS.filter((_, i) => i % 3 === 0);
  return (
    <div className="relative h-full overflow-hidden bg-[#04080E] text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgba(47,89,134,0.45),transparent_60%)]" />
      <div className="cine-pull absolute inset-0" style={{ transformOrigin: ORIGIN }}>
        <svg viewBox="0 0 1600 900" width={1600} height={900} className="absolute inset-0" role="img" aria-label="A cidade conectada vista de longe; as conexões convergem para a marca BKT">
          <g className="cine-dim"><RimaBase uid="cl" labels={false} /><CityLights t0={-4} uid="cl" /></g>
          <g style={{ mixBlendMode: 'screen' }}>
            {lines.map((p, i) => {
              const c = `M${p.x} ${p.y} Q${(p.x + FOCUS[0]) / 2} ${Math.min(p.y, FOCUS[1]) - 40} ${FOCUS[0]} ${FOCUS[1]}`;
              return <g key={i}>
                <path d={c} pathLength={100} className="cine-draw" style={{ ...d(2.2 + (i % 12) * 0.16), animationDuration: '2.4s' }} fill="none" stroke="#8FD6FF" strokeOpacity=".5" strokeWidth="1" />
                <g className="cine-rise" style={d(4.4)}><path d={c} pathLength={100} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" strokeDasharray="3 97" className="pol-run" style={{ ['--t' as string]: '2.4s', animationDelay: `${-(i % 7) * 0.3}s` }} /></g>
              </g>;
            })}
          </g>
        </svg>
      </div>
      <Particles warm />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,rgba(4,8,14,0.82),rgba(4,8,14,0.35)_45%,transparent_70%)]" />
      {/* marca: brilho contido e revelação por varredura de luz */}
      <div aria-hidden className="cine-rise absolute inset-x-0 top-[226px] mx-auto h-[180px] w-[520px] rounded-full bg-[radial-gradient(ellipse,rgba(79,187,255,0.35),transparent_70%)] blur-xl" style={d(5)} />
      <img src="/brand/bkt-logo-white.png" alt="BKT" className="cine-sweep absolute inset-x-0 top-[250px] mx-auto h-[78px] w-[330px] object-contain drop-shadow-[0_0_24px_rgba(143,214,255,0.45)]" style={d(5.4)} draggable={false} />
      <h1 className="absolute inset-x-0 top-[380px] mx-auto w-[1100px] text-center font-display text-[38px] font-extrabold leading-[1.18]">
        <span className="cine-rise block" style={d(6.6)}>O que nos move não é apenas conectar.</span>
        <span className="cine-rise block text-[#9CC4EA]" style={d(7.6)}>É transformar.</span>
      </h1>
      <p className="cine-rise absolute inset-x-0 top-[505px] mx-auto w-[900px] text-center text-[21px] leading-[1.5] text-white/80" style={d(8.8)}>BKT. Tecnologia que entrega resultados. E ajuda a construir o futuro da nossa gente.</p>
    </div>
  );
}
