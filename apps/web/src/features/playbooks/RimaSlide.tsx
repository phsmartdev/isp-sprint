/**
 * Slide RIMA — Rede Integrada Municipal de Aracaju (apresentação institucional, palco 1600 × 900).
 * Um único mapa isométrico de Aracaju (OpenStreetMap) e duas leituras sobre ele, sem trocar de cena:
 *  - REDE FRAGMENTADA (simulação conceitual): cada unidade com sua própria conexão, sem visão unificada;
 *  - REDE INTEGRADA — RIMA, em etapas: 1 backbone e POPs → 2 secretarias, escolas e saúde → 3 câmeras, semáforos e
 *    serviços urbanos + telemetria ao NOC → 4 cidade integrada e benefícios.
 * Sozinho, roda em loop (0–6 s fragmentada, 6–12, 12–20, 20–27, 27–34, volta em 34–38). Qualquer clique pausa e,
 * após 15 s sem interação, o ciclo segue do estado atual. Tudo o que é rede aqui é DEMONSTRATIVO (ver aracajuRima.ts).
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Activity, Cctv, Expand, Gauge, GraduationCap, HeartPulse, Landmark, Lightbulb, Network, RotateCcw, Route, ShieldCheck, TrafficCone, Unplug, X } from 'lucide-react';
import { RIMA_BKT, RIMA_BLDS, RIMA_CITY_LABEL, RIMA_CUT, RIMA_GEO, RIMA_LABELS, RIMA_POINTS, RIMA_POPS, RIMA_PROJ, RIMA_RING, RIMA_SPLITTERS, RIMA_TILE, type RimaCat, type RimaPoint } from './aracajuRima';

/**
 * Parâmetros do projeto. Enquanto forem null, o painel mostra "a definir" (nada de números inventados).
 * A sede da BKT (NOC) e os 4 POPs estão nos endereços reais (aracajuRima.ts).
 */
export const RIMA_PARAMS: { capacidadeAgregada: string | null; utilizacaoBanda: string | null; capacidadePop: string | null } = {
  capacidadeAgregada: '10 Gbit/s',
  utilizacaoBanda: null,
  capacidadePop: '10 Gbit/s',
};

type Stage = 0 | 1 | 2 | 3 | 4;
type Fail = null | 'ring' | 'access';
const CATS: { k: RimaCat; label: string; color: string; icon: typeof Landmark; stage: 2 | 3 }[] = [
  { k: 'adm', label: 'Administração', color: '#6FA8FF', icon: Landmark, stage: 2 },
  { k: 'seg', label: 'Segurança', color: '#FFD84B', icon: Cctv, stage: 3 },
  { k: 'mob', label: 'Mobilidade', color: '#FF9F5A', icon: TrafficCone, stage: 3 },
  { k: 'sau', label: 'Saúde', color: '#FF8FB1', icon: HeartPulse, stage: 2 },
  { k: 'edu', label: 'Educação', color: '#9BE36D', icon: GraduationCap, stage: 2 },
  { k: 'urb', label: 'Serviços urbanos', color: '#B39DFF', icon: Lightbulb, stage: 3 },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.k, c])) as Record<RimaCat, (typeof CATS)[number]>;
const PROV = ['#7E8796', '#A9846A', '#7489AE', '#977CAF'];
const FIBER = '#8FD6FF', TELE = '#E879F9', FAILC = '#FF4D4D', REROUTE = '#5BFFA8';
const FAIL_SEG = Math.max(0, RIMA_RING.findIndex((r) => r.a === 1));   // trecho POP SEPLOG → POP SMTT
const CUT_SET = new Set(RIMA_CUT.units.map((i) => RIMA_POINTS[i]!));     // unidades depois da fibra rompida
const CUT_POP = RIMA_CUT.pop;
const NOC_G = RIMA_BKT, NOC_T: [number, number] = [RIMA_BKT[0], RIMA_BKT[1] - 30], NOC_B: [number, number] = [968, 262];
const BIG = (p: RimaPoint) => !['Câmera', 'Semáforo'].includes(p.kind);

const HOLD: Record<Stage, number> = { 0: 6000, 1: 6000, 2: 8000, 3: 7000, 4: 7000 };
const IDLE = 15000;
const CAPTION: Record<Stage, [string, string]> = {
  0: ['Rede fragmentada · simulação conceitual', 'Cada órgão com sua própria conexão, contratos e ambientes separados, sem visão operacional unificada.'],
  1: ['1 · Backbone e POPs', 'O anel óptico metropolitano percorre as principais avenidas e conecta os POPs.'],
  2: ['2 · Órgãos públicos', 'A fibra se expande pelos bairros até secretarias, escolas e unidades de saúde.'],
  3: ['3 · Cidade inteligente', 'Câmeras, semáforos e serviços urbanos conectados; a telemetria chega ao NOC da BKT.'],
  4: ['RIMA ativa', 'Uma cidade conectada. Uma gestão integrada. Infinitas possibilidades.'],
};
const BENEFITS = [
  { icon: Network, t: 'Integração municipal', d: 'Uma infraestrutura para conectar os serviços públicos.' },
  { icon: Activity, t: 'Gerenciamento centralizado', d: 'Visibilidade dos circuitos e equipamentos.' },
  { icon: Route, t: 'Alta disponibilidade', d: 'Redundância e continuidade dos serviços.' },
  { icon: Expand, t: 'Escalabilidade', d: 'Mais cobertura, capacidade e pontos.' },
  { icon: ShieldCheck, t: 'Segurança', d: 'Segmentação, controle de acesso e proteção.' },
  { icon: Gauge, t: 'Eficiência operacional', d: 'Otimização de custos e da gestão.' },
];

/** tempos de cada elemento: ds (passo a passo), dj (salto direto para a RIMA), out (volta à fragmentada) */
const T = (() => {
  const ring = RIMA_RING.map((_, i) => ({ ds: 0.6 + i * 0.6, dj: 0.3 + i * 0.25, out: 2.6 - i * 0.15 }));
  const pops = RIMA_POPS.map((_, i) => ({ ds: 3.2 + i * 0.35, dj: 1.4 + i * 0.15, out: 2.8 }));
  const rank: Record<number, number> = {};
  for (const st of [2, 3]) {
    const ids = RIMA_POINTS.map((p, i) => [p, i] as const).filter(([p]) => CAT[p.cat].stage === st).sort((x, y) => x[0].len - y[0].len);
    ids.forEach(([, i], n) => { rank[i] = n / Math.max(1, ids.length - 1); });
  }
  const pts = RIMA_POINTS.map((p, i) => {
    const st = CAT[p.cat].stage, r = rank[i] ?? 0;
    return st === 2 ? { ds: 0.3 + r * 4.2, dj: 2.4 + r * 1.4, out: 0.8 + r * 0.6 } : { ds: 0.3 + r * 3.6, dj: 3.6 + r * 1.2, out: 0.1 + r * 0.5 };
  });
  return { ring, pops, pts };
})();

const run = (d: string, len: number, dash: string, w: number, c: string, per: number, phase: number, key: string) => (
  <path key={key} d={d} pathLength={len} stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" strokeDasharray={dash} className="pol-run" style={{ ['--t' as string]: `${per}s`, animationDelay: `${phase}s` }} />
);

/** cenário permanente: chapa, água, mangues, ruas, ponte, prédios e nomes (memorizado; nunca muda) */
const Base = memo(function Base() {
  const tp = RIMA_TILE.map((p) => p.join(',')).join(' ');
  return (
    <g>
      <defs>
        <clipPath id="rm-clip"><polygon points={tp} /></clipPath>
        <linearGradient id="rm-sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0A1D30" /><stop offset="1" stopColor="#051020" /></linearGradient>
        <linearGradient id="rm-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#24476B" /><stop offset="1" stopColor="#0F2236" /></linearGradient>
        <radialGradient id="rm-halo"><stop offset="0" stopColor="#4FBBFF" stopOpacity=".55" /><stop offset="1" stopColor="#4FBBFF" stopOpacity="0" /></radialGradient>
        <filter id="rm-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.6" /></filter>
        <filter id="rm-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14" /></filter>
      </defs>
      <polygon points={RIMA_TILE.map(([x, y]) => `${x},${y + 30}`).join(' ')} fill="#000" opacity=".6" filter="url(#rm-soft)" />
      {RIMA_TILE.map((p, i) => { const q = RIMA_TILE[(i + 1) % RIMA_TILE.length]!; return <polygon key={i} points={`${p[0]},${p[1]} ${q[0]},${q[1]} ${q[0]},${q[1] + 20} ${p[0]},${p[1] + 20}`} fill="#081422" stroke="#1F4060" strokeWidth=".8" />; })}
      <polygon points={tp} fill="url(#rm-sea)" />
      <g clipPath="url(#rm-clip)">
        <path d={RIMA_GEO.neigh} fill="#0B1826" />
        <path d={RIMA_GEO.aju} fill="#0F2438" />
        <path d={RIMA_GEO.wet} fill="#0D2A2E" opacity=".75" />
        <path d={RIMA_GEO.parks} fill="#123A3C" opacity=".75" />
        <path d={RIMA_GEO.beach} fill="#2A3B4A" opacity=".55" />
        <path d={RIMA_GEO.water} fill="#06182A" />
        <path d={RIMA_GEO.minor} fill="none" stroke="#3B6E9E" strokeOpacity=".26" strokeWidth=".5" />
        <path d={RIMA_GEO.major} fill="none" stroke="#6FA8D8" strokeOpacity=".5" strokeWidth=".9" />
        <path d={RIMA_GEO.aju} fill="none" stroke="#8FD6FF" strokeOpacity=".4" strokeWidth="1.1" />
        <path d={RIMA_GEO.bridge} fill="none" stroke="#CFF0FF" strokeWidth="2.2" />
        {RIMA_BLDS.map(([w, top], i) => <g key={i}><path d={w} fill="url(#rm-wall)" /><path d={top} fill="#3A6A96" stroke="#8FD6FF" strokeOpacity=".3" strokeWidth=".4" /></g>)}
      </g>
      {RIMA_LABELS.map((l) => <text key={l.t} x={l.x} y={l.y} fill="#9CC4EA" fillOpacity=".75" fontSize={l.t === 'Oceano Atlântico' ? 13 : 11.5} fontStyle={l.t.startsWith('Rio') || l.t.startsWith('Oceano') ? 'italic' : undefined} textAnchor="middle" style={{ paintOrder: 'stroke' }} stroke="#06101A" strokeWidth="3">{l.t}</text>)}
      <text x={RIMA_CITY_LABEL[0]} y={RIMA_CITY_LABEL[1]} fill="#fff" fillOpacity=".9" fontSize="30" fontWeight="800" letterSpacing="10" textAnchor="middle" className="font-display" style={{ paintOrder: 'stroke' }} stroke="#06101A" strokeWidth="5">ARACAJU</text>
    </g>
  );
});

export default function RimaSlide() {
  const [stage, setStage] = useState<Stage>(0);
  const [flow, setFlow] = useState<'step' | 'jump'>('step');
  const [touch, setTouch] = useState(0);
  const [cat, setCat] = useState<RimaCat | null>(null);
  const [sel, setSel] = useState<{ t: 'unit'; i: number } | { t: 'pop'; i: number } | { t: 'noc' } | null>(null);
  const [fail, setFail] = useState<Fail>(null);
  const [failMenu, setFailMenu] = useState(false);
  const looped = useRef(false);

  // loop automático e retomada após 15 s sem interação
  useEffect(() => {
    if (touch) {
      const t = setTimeout(() => { setTouch(0); setFail(null); setCat(null); setSel(null); setFailMenu(false); setFlow('step'); setStage((s) => ((s + 1) % 5) as Stage); }, IDLE);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => { setFlow('step'); setStage((s) => { const n = ((s + 1) % 5) as Stage; if (n === 0) looped.current = true; return n; }); }, HOLD[stage] + (stage === 0 && looped.current ? 4000 : 0));
    return () => clearTimeout(t);
  }, [stage, touch]);
  const poke = () => setTouch((n) => n + 1);
  useEffect(() => { if (!fail) return; const t = setTimeout(() => setSel({ t: 'noc' }), 1600); return () => clearTimeout(t); }, [fail]);
  const go = (s: Stage) => { setFlow('jump'); setStage(s); if (s === 0) { setFail(null); } poke(); };

  const on = (s: number) => stage >= s && stage > 0;
  const delay = (show: boolean, t: { ds: number; dj: number; out: number }) => ({ transitionDelay: `${show ? (flow === 'jump' ? t.dj : t.ds) : stage === 0 ? t.out : 0}s` });
  const down = (p: RimaPoint) => fail === 'access' && CUT_SET.has(p);
  const connected = (p: RimaPoint) => on(CAT[p.cat].stage);
  const focus = (p: RimaPoint, i: number) => (cat ? p.cat === cat : true) && (sel?.t === 'pop' ? p.pop === sel.i : true) && (sel?.t === 'unit' ? sel.i === i : true);
  const dimmed = !!cat || sel?.t === 'pop' || sel?.t === 'unit';

  // indicadores do NOC (apenas contagens da própria simulação)
  const units = RIMA_POINTS.filter(connected);
  const unitsDown = units.filter(down).length;
  const links = stage >= 1 ? RIMA_RING.length : 0;
  const monitored = units.length + links;
  const incidents = unitsDown + (fail ? 1 : 0);
  const active = monitored - incidents;
  const popsOn = stage >= 1 ? RIMA_POPS.length : 0;

  const pick = (s: typeof sel) => { setSel(s); poke(); };
  const arc = (p: { x: number; y: number }) => `M${p.x} ${p.y - 18} Q${(p.x + NOC_T[0]) / 2} ${Math.min(p.y, NOC_T[1]) - 110} ${NOC_T[0]} ${NOC_T[1]}`;
  const alarmPops = fail === 'ring' ? [RIMA_RING[FAIL_SEG]!.a, RIMA_RING[FAIL_SEG]!.b] : fail === 'access' ? [CUT_POP] : [];
  const startFail = (f: Exclude<Fail, null>) => { setFailMenu(false); setSel(null); setFlow(stage === 4 ? 'step' : 'jump'); setStage(4); setFail(f); poke(); };

  const cap = CAPTION[stage];
  const selUnit = sel?.t === 'unit' ? RIMA_POINTS[sel.i]! : null;
  const selPop = sel?.t === 'pop' ? sel.i : null;

  return (
    <div className="relative h-full overflow-hidden bg-[#050A11] text-white" data-rima-stage={stage}>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_68%_48%,rgba(47,89,134,0.35),transparent_62%)]" />
      <svg viewBox="0 0 1600 900" width={1600} height={900} className="absolute inset-0" role="img" aria-label={`Mapa isométrico de Aracaju. ${cap[0]}: ${cap[1]}`}>
        <Base />

        {/* REDE FRAGMENTADA: cada unidade com um enlace próprio (provedores/ambientes diferentes) */}
        <g className={clsx('rm-fade', stage !== 0 && 'off')} style={{ transitionDelay: stage === 0 ? `${flow === 'jump' ? 1.2 : 2.6}s` : '0s' }}>
          {RIMA_POINTS.map((p, i) => (
            <g key={i} opacity={focus(p, i) || !dimmed ? 1 : 0.2}>
              <path d={`M${p.x} ${p.y} L${p.x + 6} ${p.y - 16}`} stroke={PROV[p.prov]} strokeWidth="1" strokeDasharray="2 2.5" fill="none" />
              <rect x={p.x + 3.5} y={p.y - 21} width="5" height="5" fill="#0B121A" stroke={PROV[p.prov]} strokeWidth="1.2" />
            </g>
          ))}
        </g>

        {/* acesso óptico: do POP até cada unidade, pelas ruas */}
        <g style={{ mixBlendMode: 'screen' }}>
          {RIMA_POINTS.map((p, i) => {
            const show = connected(p), f = focus(p, i), dn = down(p);
            const col = dn ? FAILC : p.ded ? '#CFF0FF' : FIBER;
            return (
              <g key={i} opacity={!dimmed || f ? 1 : 0.12} className="transition-opacity duration-500">
                <path d={p.d} pathLength={100} className={clsx('rm-line', !show && 'off')} style={delay(show, T.pts[i]!)} fill="none" stroke={col} strokeOpacity=".22" strokeWidth="4" filter="url(#rm-glow)" />
                <path d={p.d} pathLength={100} className={clsx('rm-line', !show && 'off')} style={delay(show, T.pts[i]!)} fill="none" stroke={col} strokeOpacity={dimmed && f ? 1 : 0.85} strokeWidth={p.ded ? 1.8 : dimmed && f ? 1.8 : 1.25} />
                {p.ded && <path d={p.d} pathLength={100} className={clsx('rm-line', !show && 'off')} style={delay(show, T.pts[i]!)} fill="none" stroke="#050A11" strokeWidth=".6" />}
              </g>
            );
          })}
        </g>

        {/* backbone: anel metropolitano + ramal */}
        <g style={{ mixBlendMode: 'screen' }}>
          {RIMA_RING.map((r, i) => {
            const show = on(1), broken = fail === 'ring' && i === FAIL_SEG, alt = fail === 'ring' && i !== FAIL_SEG;
            const c = broken ? FAILC : alt ? REROUTE : '#7DF9FF';
            return (
              <g key={i}>
                <path d={r.d} pathLength={100} className={clsx('rm-line', !show && 'off')} style={{ ...delay(show, T.ring[i]!), ['--dur' as string]: '1.1s' }} fill="none" stroke={c} strokeWidth="9" strokeOpacity=".35" filter="url(#rm-glow)" />
                <path d={r.d} pathLength={100} className={clsx('rm-line', !show && 'off', broken && 'rm-blink')} style={{ ...delay(show, T.ring[i]!), ['--dur' as string]: '1.1s' }} fill="none" stroke={broken ? FAILC : '#E6FBFF'} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })}
        </g>

        {/* pulsos de dados (fibra) */}
        <g className={clsx('rm-fade', !on(1) && 'off')} style={{ transitionDelay: on(1) ? `${flow === 'jump' ? 2.2 : 4.6}s` : '0s', mixBlendMode: 'screen' }}>
          {RIMA_RING.map((r, i) => {
            if (fail === 'ring' && i === FAIL_SEG) return null;
            return [0, 1, 2].map((o) => run(r.d, 100, '2 98', 3, fail === 'ring' ? REROUTE : '#fff', 3.2, -o * 1.07 - i * 0.3, `r${i}${o}`));
          })}
        </g>
        <g style={{ mixBlendMode: 'screen' }}>
          {RIMA_POINTS.map((p, i) => {
            const show = connected(p) && !down(p);
            return <g key={i} className={clsx('rm-fade', !show && 'off')} style={{ transitionDelay: show ? `${(flow === 'jump' ? T.pts[i]!.dj : T.pts[i]!.ds) + 1.2}s` : '0s' }} opacity={!dimmed || focus(p, i) ? 1 : 0.1}>{run(p.d, 200, '5 195', 1.8, '#fff', 2.6, -((i * 0.37) % 2.6), 'a')}</g>;
          })}
        </g>

        {/* splitters ópticos passivos */}
        {RIMA_SPLITTERS.map((s, i) => {
          const show = on(2);
          return <g key={i} className={clsx('rm-pop', !show && 'off')} style={{ transitionDelay: show ? `${flow === 'jump' ? 2.6 + i * 0.05 : 1 + i * 0.12}s` : '0s' }} opacity={dimmed && !(selPop === s.pop) ? 0.25 : 1}><rect x={s.x - 2.6} y={s.y - 2.6} width="5.2" height="5.2" transform={`rotate(45 ${s.x} ${s.y})`} fill="#0B121A" stroke="#E6FBFF" strokeWidth="1.1" /></g>;
        })}

        {/* telemetria: POPs → NOC da BKT (plano de gerenciamento, separado dos dados) */}
        <g className={clsx('rm-fade', !on(3) && 'off')} style={{ transitionDelay: on(3) ? `${flow === 'jump' ? 4.6 : 4.2}s` : '0s' }}>
          {RIMA_POPS.map((p, i) => <path key={i} d={arc(p)} fill="none" stroke={TELE} strokeOpacity=".8" strokeWidth="1.5" strokeDasharray="1.5 6" strokeLinecap="round" className="rm-flow" />)}
        </g>

        {/* alerta de rompimento chegando ao NOC da BKT */}
        {fail && alarmPops.map((i) => <g key={`al${i}`} className="pointer-events-none">
          <path d={arc(RIMA_POPS[i]!)} fill="none" stroke={FAILC} strokeOpacity=".35" strokeWidth="5" filter="url(#rm-glow)" />
          <path d={arc(RIMA_POPS[i]!)} fill="none" stroke="#FF8A8A" strokeWidth="2" strokeDasharray="5 9" strokeLinecap="round" className="rm-alarm" />
        </g>)}

        {/* unidades públicas */}
        {RIMA_POINTS.map((p, i) => {
          const c = CAT[p.cat], show = connected(p), dn = down(p), f = focus(p, i), big = BIG(p), s = sel?.t === 'unit' && sel.i === i;
          const col = dn ? FAILC : show ? c.color : '#5E6B7A';
          const h = big ? 12 : 0;
          return (
            p.atPop && stage >= 1 ? null : <g key={i} opacity={!dimmed || f ? 1 : 0.22} className="cursor-pointer transition-opacity duration-500" onClick={() => pick({ t: 'unit', i })}>
              <title>{`${p.name} · ${p.kind}`}</title>
              {big && <line x1={p.x} y1={p.y} x2={p.x} y2={p.y - h} stroke={col} strokeOpacity=".7" strokeWidth="1" />}
              <circle cx={p.x} cy={p.y - h} r={big ? 9 : 6} fill={col} fillOpacity={show ? 0.22 : 0} className="transition-[fill-opacity] duration-700" style={{ transitionDelay: show ? `${(flow === 'jump' ? T.pts[i]!.dj : T.pts[i]!.ds) + 0.8}s` : '0s' }} />
              <circle cx={p.x} cy={p.y - h} r={big ? 3.8 : 2.4} fill={col} stroke="#050A11" strokeWidth="1" className="transition-[fill] duration-700" style={{ transitionDelay: show ? `${(flow === 'jump' ? T.pts[i]!.dj : T.pts[i]!.ds) + 0.8}s` : '0s' }} />
              {s && <circle cx={p.x} cy={p.y - h} r="11" fill="none" stroke="#fff" strokeWidth="1.4" className="rm-beacon" />}
              {s && <text x={p.x + 8} y={p.y - h - 6} fontSize="11" fill="#fff" style={{ paintOrder: 'stroke' }} stroke="#050A11" strokeWidth="3">{p.name.length > 34 ? p.name.slice(0, 33) + '…' : p.name}</text>}
              <circle cx={p.x} cy={p.y - h} r="10" fill="transparent" />
            </g>
          );
        })}

        {/* POPs */}
        {RIMA_POPS.map((p, i) => {
          const show = on(1), dn = false, s = selPop === i;
          return (
            <g key={i} className={clsx('rm-pop cursor-pointer', !show && 'off')} style={{ transitionDelay: show ? `${flow === 'jump' ? T.pops[i]!.dj : T.pops[i]!.ds}s` : `${stage === 0 ? T.pops[i]!.out : 0}s` }} onClick={() => pick({ t: 'pop', i })} opacity={dimmed && !s && !(sel?.t === 'unit' && RIMA_POINTS[sel.i]!.pop === i) ? 0.45 : 1}>
              <title>{`${p.name} · ${p.site}`}</title>
              <circle cx={p.x} cy={p.y} r="22" fill="url(#rm-halo)" />
              <line x1={p.x} y1={p.y} x2={p.x} y2={p.y - 18} stroke={dn ? FAILC : '#E6FBFF'} strokeWidth="1.4" />
              <polygon points={[0, 1, 2, 3, 4, 5].map((k) => `${p.x + 8 * Math.cos((Math.PI / 3) * k + Math.PI / 6)},${p.y - 18 + 8 * Math.sin((Math.PI / 3) * k + Math.PI / 6)}`).join(' ')} fill={dn ? '#3A0B0B' : '#0B1A2A'} stroke={dn ? FAILC : '#E6FBFF'} strokeWidth="1.6" />
              <circle cx={p.x} cy={p.y - 18} r="2.4" fill={dn ? FAILC : '#7DF9FF'} />
              {s && <circle cx={p.x} cy={p.y - 18} r="12" fill="none" stroke="#fff" strokeWidth="1.4" className="rm-beacon" />}
              <text x={p.x + 12} y={p.y - 24} fontSize="12" fontWeight="600" fill="#fff" style={{ paintOrder: 'stroke' }} stroke="#050A11" strokeWidth="3.5">{p.name}</text>
            </g>
          );
        })}

        {/* rompimento na fibra de distribuição: trechos a jusante em vermelho */}
        {fail === 'access' && <g className="pointer-events-none">{RIMA_CUT.d.map((d, k) => <path key={k} d={d} fill="none" stroke={FAILC} strokeWidth="1.8" className="rm-blink" />)}</g>}
        {/* rompimento: marcador no ponto da falha */}
        {fail && (() => { const r = fail === 'ring' ? { mx: RIMA_RING[FAIL_SEG]!.mx, my: RIMA_RING[FAIL_SEG]!.my } : { mx: RIMA_CUT.x, my: RIMA_CUT.y }; return (
          <g className="pointer-events-none">
            <circle cx={r.mx} cy={r.my} r="16" fill={FAILC} fillOpacity=".25" className="rm-beacon" />
            <circle cx={r.mx} cy={r.my} r="9" fill="#2A0707" stroke={FAILC} strokeWidth="1.8" />
            <path d={`M${r.mx - 3.5} ${r.my - 3.5} L${r.mx + 3.5} ${r.my + 3.5} M${r.mx + 3.5} ${r.my - 3.5} L${r.mx - 3.5} ${r.my + 3.5}`} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        ); })()}

        {/* BKT · centro de gerenciamento (NOC) na sede: R. Pedro Paes Mendonça, Suíssa */}
        <g className="cursor-pointer" onClick={() => pick(sel?.t === 'noc' ? null : { t: 'noc' })}>
          <title>BKT · Centro de Operações de Rede · R. Pedro Paes Mendonça, Suíssa</title>
          <circle cx={NOC_G[0]} cy={NOC_G[1]} r="34" fill="url(#rm-halo)" opacity={stage >= 1 ? 1 : 0.3} className="transition-opacity duration-1000" />
          {stage >= 1 && <circle cx={NOC_G[0]} cy={NOC_G[1]} r="12" fill="none" stroke={fail ? FAILC : TELE} strokeWidth="1.4" className="rm-beacon" />}
          <path d={`M${NOC_T[0]} ${NOC_T[1]} L${NOC_B[0] + 80} ${NOC_B[1] + 24} L${NOC_B[0]} ${NOC_B[1] + 24}`} fill="none" stroke={fail ? FAILC : '#8FD6FF'} strokeOpacity=".7" strokeWidth="1" />
          <rect x={NOC_G[0] - 3.5} y={NOC_T[1]} width="7" height={NOC_G[1] - NOC_T[1]} fill="#0B1420" stroke={fail ? FAILC : '#8FD6FF'} strokeWidth="1.2" />
          <circle cx={NOC_T[0]} cy={NOC_T[1]} r="5" fill={fail ? FAILC : stage >= 1 ? '#fff' : '#5E6B7A'} className={fail ? 'rm-blink' : undefined} />
          <rect x={NOC_B[0] - 122} y={NOC_B[1] - 24} width="244" height="48" rx="10" fill={fail ? '#2A0707' : '#0B1420'} stroke={fail ? FAILC : stage >= 1 ? '#8FD6FF' : '#3B4B5E'} strokeWidth="1.6" className={clsx('transition-[stroke,fill] duration-700', fail && 'rm-blink')} />
          <image href="/brand/bkt-symbol-white.png" x={NOC_B[0] - 113} y={NOC_B[1] - 15} width="30" height="30" preserveAspectRatio="xMidYMid meet" opacity={stage >= 1 ? 1 : 0.5} />
          <text x={NOC_B[0] - 75} y={NOC_B[1] - 2} fontSize="15" fontWeight="800" fill="#fff" className="font-display" letterSpacing="1">BKT</text>
          <text x={NOC_B[0] - 75} y={NOC_B[1] + 13} fontSize="9.5" fontWeight="600" fill={fail ? '#FF8A8A' : '#9CC4EA'} letterSpacing="1.2">{fail ? 'ALERTA · ROMPIMENTO DETECTADO' : 'CENTRO DE GERENCIAMENTO'}</text>
        </g>
      </svg>

      {/* ---------- interface ---------- */}
      <img src="/brand/bkt-logo-white.png" alt="BK Telecom" className="absolute left-[60px] top-9 h-10 w-[170px] object-contain object-left" draggable={false} />
      <p className="absolute left-[60px] top-[94px] text-[12px] font-semibold tracking-[0.2em] text-[#8FD6FF]">RIMA · REDE INTEGRADA MUNICIPAL DE ARACAJU</p>
      <h1 className="absolute left-[60px] top-[120px] w-[430px] font-display text-[27px] font-extrabold leading-[1.16]">RIMA — <span className="text-[#9CC4EA]">a infraestrutura que conecta uma cidade inteira.</span></h1>
      <p className="absolute left-[60px] top-[250px] w-[420px] text-[14.5px] leading-[1.45] text-white/70">Uma rede óptica metropolitana para integrar serviços públicos, ampliar a capacidade de gestão e preparar Aracaju para o futuro.</p>

      {/* etapa atual */}
      <div className="absolute left-[60px] top-[340px] w-[420px]" aria-live="polite">
        <div className="mb-2 flex gap-1.5" aria-hidden>{([0, 1, 2, 3, 4] as Stage[]).map((s) => <span key={s} className={clsx('h-1 flex-1 transition-colors duration-500', s <= stage ? (stage === 0 ? 'bg-[#7E8796]' : 'bg-[#8FD6FF]') : 'bg-white/10')} />)}</div>
        <p className={clsx('text-[12px] font-semibold uppercase tracking-[0.16em]', stage === 0 ? 'text-[#C9B39E]' : 'text-[#8FD6FF]')}>{cap[0]}</p>
        <p className={clsx('mt-1 leading-snug', stage === 4 ? 'text-[17px] font-semibold text-white' : 'text-[15px] text-white/85')}>{cap[1]}</p>
      </div>

      {/* categorias */}
      <div className="absolute left-[60px] top-[462px] grid w-[420px] grid-cols-2 gap-1.5" role="group" aria-label="Filtrar por categoria">
        <button type="button" aria-pressed={!cat} onClick={() => { setCat(null); setSel(null); poke(); }} className={clsx('col-span-2 flex items-center gap-2 border px-3 py-1.5 text-left text-[12.5px] font-semibold tracking-[0.08em] transition-colors', !cat ? 'border-[#8FD6FF]/60 bg-[#8FD6FF]/10 text-white' : 'border-white/10 bg-white/[0.03] text-white/65 hover:text-white')}>
          <Network className="h-3.5 w-3.5" aria-hidden />REDE COMPLETA<span className="ml-auto text-white/45">{RIMA_POINTS.length} unidades · {RIMA_POPS.length} POPs</span>
        </button>
        {CATS.map((c) => {
          const n = RIMA_POINTS.filter((p) => p.cat === c.k).length, a = cat === c.k;
          return (
            <button key={c.k} type="button" aria-pressed={a} onClick={() => { setCat(a ? null : c.k); setSel(null); if (stage < c.stage) { setFlow('jump'); setStage(4); } poke(); }} className={clsx('flex items-center gap-2 border px-3 py-1.5 text-left text-[12.5px] font-semibold transition-colors', a ? 'text-white' : 'border-white/10 bg-white/[0.03] text-white/70 hover:text-white')} style={a ? { borderColor: c.color, background: `${c.color}22` } : undefined}>
              <c.icon className="h-3.5 w-3.5" style={{ color: c.color }} aria-hidden />{c.label.toUpperCase()}<span className="ml-auto font-normal text-white/45">{n}</span>
            </button>
          );
        })}
      </div>

      {/* legenda */}
      <ul className="absolute left-[60px] top-[640px] grid w-[420px] grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] text-white/60" aria-label="Legenda">
        <li className="flex items-center gap-2"><span className="h-[3px] w-6 bg-[#E6FBFF] shadow-[0_0_6px_#7DF9FF]" />Backbone (anel)</li>
        <li className="flex items-center gap-2"><span className="h-px w-6 bg-[#8FD6FF]" />Acesso óptico (PON)</li>
        <li className="flex items-center gap-2"><svg width="24" height="6" aria-hidden><line x1="0" y1="3" x2="24" y2="3" stroke={TELE} strokeWidth="1.4" strokeDasharray="1.5 4" /></svg>Telemetria ao NOC</li>
        <li className="flex items-center gap-2"><svg width="12" height="12" aria-hidden><rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" fill="#0B121A" stroke="#E6FBFF" /></svg>Splitter passivo</li>
        <li className="flex items-center gap-2"><svg width="24" height="6" aria-hidden><line x1="0" y1="3" x2="24" y2="3" stroke="#A9846A" strokeWidth="1.2" strokeDasharray="2 2.5" /></svg>Conexão independente</li>
        <li className="flex items-center gap-2"><span className="h-[3px] w-6 bg-[#FF4D4D]" />Falha</li>
      </ul>
      <p className="absolute left-[60px] top-[722px] w-[420px] text-[10.5px] leading-snug text-white/35">Simulação conceitual. POPs e sede da BKT nos endereços reais; unidades públicas nas posições do OpenStreetMap; rotas, splitters e aplicações são ilustrativos. Mapa © colaboradores do OpenStreetMap.</p>

      {/* modos e falha */}
      <div className="absolute right-[248px] top-7 flex border border-white/15 bg-[#09101A]/80 p-1 backdrop-blur-md" role="group" aria-label="Modo de visualização">
        {([[0, 'REDE FRAGMENTADA'], [4, 'REDE INTEGRADA — RIMA']] as const).map(([s, label]) => {
          const a = s === 0 ? stage === 0 : stage > 0;
          return <button key={s} type="button" aria-pressed={a} onClick={() => go(s)} className={clsx('px-4 py-2 text-[12px] font-semibold tracking-[0.12em] transition-colors duration-500', a ? (s === 0 ? 'bg-[#A9846A]/25 text-white shadow-[inset_0_0_0_1px_rgba(201,179,158,0.6)]' : 'bg-[#4FBBFF]/20 text-white shadow-[inset_0_0_0_1px_rgba(143,214,255,0.6),0_0_18px_rgba(79,187,255,0.3)]') : 'text-white/55 hover:text-white')}>{label}</button>;
        })}
      </div>
      <div className="absolute right-6 top-7">
        {fail ? (
          <button type="button" onClick={() => { setFail(null); poke(); }} className="flex items-center gap-2 border border-[#5BFFA8]/50 bg-[#09101A]/80 px-3.5 py-[11px] text-[12px] font-semibold tracking-[0.1em] text-[#5BFFA8] backdrop-blur-md"><RotateCcw className="h-3.5 w-3.5" aria-hidden />RESTAURAR</button>
        ) : (
          <button type="button" aria-expanded={failMenu} onClick={() => { setFailMenu(!failMenu); poke(); }} className="flex items-center gap-2 border border-[#FF4D4D]/50 bg-[#09101A]/80 px-3.5 py-[11px] text-[12px] font-semibold tracking-[0.1em] text-[#FF8A8A] backdrop-blur-md hover:bg-[#FF4D4D]/10"><Unplug className="h-3.5 w-3.5" aria-hidden />SIMULAR ROMPIMENTO</button>
        )}
        {failMenu && !fail && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[280px] border border-white/15 bg-[#09101A]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
            <button type="button" onClick={() => startFail('ring')} className="block w-full px-3 py-2 text-left hover:bg-white/5"><span className="block text-[13px] font-semibold">No anel, entre {RIMA_POPS[RIMA_RING[FAIL_SEG]!.a]!.name} e {RIMA_POPS[RIMA_RING[FAIL_SEG]!.b]!.name}</span><span className="block text-[11.5px] text-white/55">Com redundância: o tráfego segue pelo outro lado do anel.</span></button>
            <button type="button" onClick={() => startFail('access')} className="block w-full px-3 py-2 text-left hover:bg-white/5"><span className="block text-[13px] font-semibold">Na fibra de distribuição ({RIMA_POPS[CUT_POP]!.name})</span><span className="block text-[11.5px] text-white/55">Sem redundância: as unidades depois do ponto rompido ficam indisponíveis até o reparo.</span></button>
          </div>
        )}
      </div>

      {/* aviso de falha */}
      {fail && (
        <div className={clsx('absolute left-1/2 top-[92px] flex -translate-x-[10%] items-center gap-3 border px-4 py-2 text-[13px] backdrop-blur-md', fail === 'ring' ? 'border-[#5BFFA8]/50 bg-[#06261A]/80 text-[#CFFFE4]' : 'border-[#FF4D4D]/60 bg-[#2A0707]/80 text-[#FFD0D0]')} role="status">
          {fail === 'ring' ? <><Route className="h-4 w-4 flex-none text-[#5BFFA8]" aria-hidden /><span><b>BKT alertada.</b> Rompimento entre {RIMA_POPS[RIMA_RING[FAIL_SEG]!.a]!.name} e {RIMA_POPS[RIMA_RING[FAIL_SEG]!.b]!.name}: tráfego redirecionado pelo anel, serviços preservados.</span></>
            : <><Unplug className="h-4 w-4 flex-none text-[#FF4D4D]" aria-hidden /><span><b>BKT alertada.</b> Rompimento na fibra de distribuição do {RIMA_POPS[CUT_POP]!.name}: sem rota redundante, {unitsDown} unidades indisponíveis.</span></>}
        </div>
      )}

      {/* painéis: NOC, POP ou unidade */}
      {sel && (
        <aside className="absolute right-6 top-[430px] z-10 w-[372px] border border-[#8FD6FF]/35 bg-[#07101A]/92 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-md" aria-label="Detalhes">
          <button type="button" onClick={() => pick(null)} className="absolute right-2 top-2 p-1 text-white/60 hover:text-white" aria-label="Fechar"><X className="h-4 w-4" /></button>
          {sel.t === 'noc' && (
            <div className="p-4">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-[#E879F9]">BKT — CENTRO DE OPERAÇÕES DE REDE</p>
              {stage === 0 ? <p className="mt-3 text-[13.5px] text-white/70">Na rede fragmentada não há visão operacional unificada: cada conexão é acompanhada por um fornecedor diferente.</p> : (
                <>
                  <dl className="mt-3 grid grid-cols-3 gap-px bg-white/10 text-center">
                    {([['Circuitos monitorados', monitored], ['Circuitos ativos', active], ['Com incidente', incidents], ['Disponibilidade', monitored ? `${((active / monitored) * 100).toFixed(1)}%` : '—'], ['POPs operando', `${popsOn}/${RIMA_POPS.length}`], ['Pontos conectados', units.length - unitsDown], ['Capacidade agregada', RIMA_PARAMS.capacidadeAgregada ?? 'a definir'], ['Utilização de banda', RIMA_PARAMS.utilizacaoBanda ?? 'a definir'], ['Incidentes em atendimento', fail ? 1 : 0]] as const).map(([k, v], n) => (
                      <div key={k} className="bg-[#07101A] px-1.5 py-2"><dd className={clsx('num text-[19px] font-bold leading-tight', typeof v === 'string' && v.startsWith('a definir') ? 'text-[13px] font-semibold text-white/45' : n === 2 && incidents ? 'text-[#FF6B6B]' : 'text-white')}>{v}</dd><dt className="mt-0.5 text-[10px] leading-tight text-white/55">{k}</dt></div>
                    ))}
                  </dl>
                  <p className="mt-2 text-[10px] text-white/40">Valores desta simulação; capacidade e utilização vêm do projeto.</p>
                  <ul className="mt-2 max-h-[118px] overflow-y-auto pr-1 text-[12px]" aria-label="Circuitos">
                    {fail && <li className="flex items-center gap-2 py-1 font-semibold text-[#FF8A8A]"><span className="h-2 w-2 flex-none rounded-full bg-[#FF4D4D] rm-blink" />ALERTA · {fail === 'ring' ? `backbone ${RIMA_POPS[RIMA_RING[FAIL_SEG]!.a]!.name} ↔ ${RIMA_POPS[RIMA_RING[FAIL_SEG]!.b]!.name} rompido · rota redundante ativa` : `fibra de distribuição do ${RIMA_POPS[CUT_POP]!.name} rompida · ${unitsDown} unidades`}</li>}
                    {RIMA_POINTS.map((p, i) => connected(p) && (
                      <li key={i}><button type="button" onClick={() => pick({ t: 'unit', i })} className="flex w-full items-center gap-2 py-1 text-left text-white/75 hover:text-white"><span className="h-2 w-2 flex-none rounded-full" style={{ background: down(p) ? FAILC : '#5BFFA8' }} /><span className="truncate">{p.name}</span><span className="ml-auto flex-none text-white/40">{RIMA_POPS[p.pop]!.name.replace('POP ', '')}</span></button></li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {sel.t === 'pop' && (() => { const p = RIMA_POPS[sel.i]!, mine = RIMA_POINTS.filter((x) => x.pop === sel.i), dn = false; return (
            <div className="p-4">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-[#7DF9FF]">PONTO DE PRESENÇA</p>
              <p className="mt-1 text-[18px] font-bold">{p.name}</p>
              <p className="text-[12px] text-white/55">{p.site}</p>
              <p className={clsx('mt-2 text-[13px] font-semibold', !on(1) ? 'text-white/50' : dn ? 'text-[#FF6B6B]' : 'text-[#5BFFA8]')}>{!on(1) ? 'Fora da rede fragmentada' : dn ? 'Isolado' : 'Operacional · no anel (duas rotas)'}</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 text-[12px] text-white/75">{CATS.map((c) => { const n = mine.filter((x) => x.cat === c.k).length; return n ? <li key={c.k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.label}: {n}</li> : null; })}</ul>
              <p className="mt-2 text-[12px] text-white/55">Capacidade de transporte: {RIMA_PARAMS.capacidadePop ?? 'a definir no projeto'}</p>
            </div>
          ); })()}
          {selUnit && (() => { const c = CAT[selUnit.cat], ok = connected(selUnit), dn = down(selUnit); return (
            <div className="p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.18em]" style={{ color: c.color }}><c.icon className="h-3.5 w-3.5" aria-hidden />{c.label.toUpperCase()}</p>
              <p className="mt-1 pr-6 text-[16px] font-bold leading-snug">{selUnit.name}</p>
              <p className="text-[12px] text-white/55">{selUnit.kind}</p>
              <p className={clsx('mt-2 text-[13px] font-semibold', dn ? 'text-[#FF6B6B]' : ok ? 'text-[#5BFFA8]' : 'text-[#C9B39E]')}>{dn ? 'Indisponível: fibra de distribuição rompida (BKT alertada)' : ok ? `Conectada ao ${RIMA_POPS[selUnit.pop]!.name}${selUnit.ded ? ' · circuito dedicado' : ' · acesso PON'}` : 'Conexão independente (cenário fragmentado)'}</p>
              <p className="mt-2 text-[11px] text-white/40">Aplicação demonstrativa · posição: OpenStreetMap ({selUnit.osm})</p>
            </div>
          ); })()}
        </aside>
      )}

      {/* benefícios (surgem com a RIMA ativa) */}
      <ul className="absolute bottom-[40px] left-[60px] grid w-[1480px] grid-cols-6 gap-2" aria-label="Benefícios da RIMA">
        {BENEFITS.map((b, n) => (
          <li key={b.t} className={clsx('flex gap-2.5 border px-3 py-2.5 transition-[opacity,transform,border-color,background-color] duration-700 motion-reduce:transition-none', stage === 4 ? 'translate-y-0 border-[#8FD6FF]/40 bg-[#0E2236]/70 opacity-100' : 'translate-y-2 border-white/5 bg-white/[0.02] opacity-30')} style={{ transitionDelay: stage === 4 ? `${(flow === 'jump' ? 4.6 : 0.6) + n * 0.25}s` : '0s' }}>
            <b.icon className={clsx('mt-0.5 h-[18px] w-[18px] flex-none', stage === 4 ? 'text-[#8FD6FF]' : 'text-white/40')} aria-hidden />
            <span><span className="block text-[13px] font-semibold leading-tight">{b.t}</span><span className="mt-0.5 block text-[11px] leading-snug text-white/60">{b.d}</span></span>
          </li>
        ))}
      </ul>
      <p className={clsx('pointer-events-none absolute left-[560px] top-[744px] w-[1000px] text-center font-display text-[19px] font-extrabold tracking-[0.12em] transition-opacity duration-1000', stage === 4 ? 'opacity-100' : 'opacity-0')} style={{ transitionDelay: stage === 4 ? `${flow === 'jump' ? 5.4 : 2}s` : '0s', textShadow: '0 0 18px rgba(79,187,255,0.6)' }}>UMA REDE. TODA A CIDADE. INFINITAS POSSIBILIDADES.</p>
      <p className="absolute bottom-[12px] right-6 text-[10.5px] font-semibold tracking-[0.2em] text-white/45">BK TELECOM — TECNOLOGIA QUE ENTREGA RESULTADOS.</p>
    </div>
  );
}
