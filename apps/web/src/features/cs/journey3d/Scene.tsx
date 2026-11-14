/**
 * Cena 3D da Jornada Viva (SVG com projeção própria: rotação em torno do eixo vertical, perspectiva elevada, ordem de
 * profundidade). Um único ecossistema contínuo: Onboarding → Ongoing → Expansão, ligados por um caminho luminoso.
 * Sem bibliotecas 3D: mesma técnica das cenas da apresentação institucional, leve e sem WebGL.
 */
import { memo, type ReactNode } from 'react';
import { MICRO, healthState, type JExpansion, type JMilestone, type HealthState } from './model';

export type Cam = { cx: number; zoom: number; yaw: number };
export type Pick = { t: 'micro'; i: number } | { t: 'milestone'; id: string } | { t: 'health' } | { t: 'risks' } | { t: 'renewal' } | { t: 'expansion'; i: number };
export type SceneState = {
  micro: number | null;            // microetapa atual (null = sem registro)
  healthScore: number | null;
  doneIds: Set<string>;
  milestones: JMilestone[];
  riskLevel: 'atencao' | 'risco' | null;
  renewalNear: boolean;
  expansion: JExpansion[];
  nextMilestoneId: string | null;
  today: string;
  historical: boolean;
};

export const VW = 1200, VH = 620;
/** posição de cada microetapa no mundo (x ao longo da jornada, y profundidade) */
export const ST: [number, number][] = [[6, -3], [16, 3], [26, -3], [37, 3], [57, -3], [69, 3], [92, 0]];
const ENV = [{ x0: -2, x1: 44, name: 'ONBOARDING', sub: '90 dias · referência' }, { x0: 49, x1: 77, name: 'ONGOING', sub: '180 dias · referência' }, { x0: 82, x1: 110, name: 'EXPANSÃO', sub: 'antes da renovação' }];
/** forma de cada edifício: largura, profundidade, altura */
const SHAPE: [number, number, number][] = [[4, 4, 3], [5, 4, 4.5], [5, 5, 6.5], [5, 4, 5.5], [6, 5, 9], [6, 6, 12], [6, 6, 7]];
export const HEALTH_COLOR: Record<HealthState, string> = { saudavel: '#34D399', atencao: '#FBBF24', risco: '#F87171', sem_dados: '#94A3B8' };
export const ENV_CX = [20, 63, 96];

type V3 = [number, number, number];
function proj(cam: Cam) {
  const a = (cam.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), S = 9.2 * cam.zoom;
  const r = (x: number, y: number) => { const dx = x - cam.cx; return [dx * c - y * s, dx * s + y * c] as const; };
  const P = (x: number, y: number, z: number): [number, number] => { const [X, Y] = r(x, y); return [VW / 2 + X * S, VH * 0.56 + Y * S * 0.52 - z * S * 0.92]; };
  const depth = (x: number, y: number) => r(x, y)[1];
  return { P, depth, c, s, S };
}
const pts = (a: [number, number][]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

type Box = { x: number; y: number; w: number; d: number; z0: number; h: number; top: string; side: string; stroke?: string; sw?: number; op?: number; dash?: string; glow?: boolean };
function boxEls(pj: ReturnType<typeof proj>, b: Box, key: string): ReactNode {
  const { P, s, c } = pj;
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.d / 2, y1 = b.y + b.d / 2, z0 = b.z0, z1 = b.z0 + b.h;
  // faces verticais: normal (nx, ny) → visível se aponta para a câmera (componente y rotacionada > 0)
  const faces: { n: [number, number]; q: V3[] }[] = [
    { n: [0, 1], q: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, -1], q: [[x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]] },
    { n: [1, 0], q: [[x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]] },
    { n: [-1, 0], q: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]] },
  ];
  const st = { stroke: b.stroke ?? 'none', strokeWidth: b.sw ?? 0.8, strokeDasharray: b.dash, strokeLinejoin: 'round' as const };
  return (
    <g key={key} opacity={b.op ?? 1}>
      {faces.filter((f) => f.n[0] * s + f.n[1] * c > 0.001).map((f, i) => {
        const lx = f.n[0] * c - f.n[1] * s;     // luz vinda da esquerda
        return <polygon key={i} points={pts(f.q.map((v) => P(...v)))} fill={b.side} style={{ filter: `brightness(${(0.78 + lx * 0.22).toFixed(2)})` }} {...st} />;
      })}
      <polygon points={pts(([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] as V3[]).map((v) => P(...v)))} fill={b.top} {...st} />
    </g>
  );
}

const STATE_COL = { done: '#60D3FF', current: '#8FE3FF', future: '#2A3F57' };

export const JourneyScene = memo(function JourneyScene({ cam, st, sel, onPick, reduced }: { cam: Cam; st: SceneState; sel: Pick | null; onPick: (p: Pick) => void; reduced: boolean }) {
  const pj = proj(cam);
  const { P, depth, S } = pj;
  const items: { d: number; el: ReactNode }[] = [];
  const add = (d: number, el: ReactNode) => items.push({ d, el });
  const hs = healthState(st.healthScore);
  const curMacro = st.micro === null ? null : MICRO[st.micro]!.macro;

  // plataformas dos três ambientes
  const plats = ENV.map((e, i) => boxEls(pj, { x: (e.x0 + e.x1) / 2, y: 0, w: e.x1 - e.x0, d: 22, z0: -0.9, h: 0.9, top: i === curMacro ? '#10263C' : '#0C1C2D', side: '#08121E', stroke: i === curMacro ? '#3E8FD0' : '#1E3A57', sw: 1 }, `pl${i}`));
  // caminho luminoso que liga as microetapas e os ambientes
  const way: [number, number][] = [[-1, 0], ...ST.flatMap(([x, y], i) => (i < 6 ? [[x, y * 0.35], [(x + ST[i + 1]![0]) / 2, (y + ST[i + 1]![1]) * 0.18]] : [[x, 0]]) as [number, number][]), [104, 0]];
  const wayD = 'M' + way.map(([x, y]) => P(x, y + 4.6, 0.02).map((n) => n.toFixed(1)).join(' ')).join(' L');
  const reached = st.micro === null ? -1 : st.micro;
  const reachX = reached >= 0 ? ST[reached]![0] : -1;
  const wayDone = 'M' + way.filter(([x]) => x <= reachX + 0.01).map(([x, y]) => P(x, y + 4.6, 0.02).map((n) => n.toFixed(1)).join(' ')).join(' L');

  // edifícios das sete microetapas
  ST.forEach(([x, y], i) => {
    const [w, d, h] = SHAPE[i]!;
    const state = st.micro === null ? 'future' : i < st.micro ? 'done' : i === st.micro ? 'current' : 'future';
    const possible = i === 6 && state !== 'current' && state !== 'done';
    const isSel = sel?.t === 'micro' && sel.i === i;
    const body = state === 'future'
      ? boxEls(pj, { x, y, w, d, z0: 0, h, top: 'rgba(80,140,200,0.10)', side: 'rgba(40,80,120,0.12)', stroke: possible ? '#6FA8DC' : '#3B5E80', sw: 1, dash: possible || i === 2 ? '4 3' : undefined }, `b${i}`)
      : boxEls(pj, { x, y, w, d, z0: 0, h, top: state === 'current' ? '#2B5B86' : '#1F4568', side: state === 'current' ? '#1E4466' : '#183A59', stroke: isSel ? '#FFFFFF' : STATE_COL[state], sw: isSel ? 1.6 : 0.9 }, `b${i}`);
    const top = P(x, y, h), base = P(x, y, 0), fr = P(x, y + d / 2, 0);
    const floors: ReactNode[] = [];
    if (state !== 'future') for (let k = 1; k < Math.floor(h / 1.4); k++) {
      const z = k * 1.4, a = P(x - w / 2, y + d / 2, z), b2 = P(x + w / 2, y + d / 2, z);
      floors.push(<line key={k} x1={a[0]} y1={a[1]} x2={b2[0]} y2={b2[1]} stroke={state === 'current' ? '#8FE3FF' : '#5FA8D8'} strokeOpacity={state === 'current' ? 0.55 : 0.3} strokeWidth="0.8" />);
    }
    // andaime na Entrega enquanto não concluída (implantação em curso)
    const scaffold: ReactNode[] = [];
    if (i === 2 && state !== 'done') for (let k = 0; k <= 4; k++) { const a = P(x - w / 2 - 0.4 + (k * (w + 0.8)) / 4, y + d / 2 + 0.4, 0), b2 = P(x - w / 2 - 0.4 + (k * (w + 0.8)) / 4, y + d / 2 + 0.4, h * 0.85); scaffold.push(<line key={k} x1={a[0]} y1={a[1]} x2={b2[0]} y2={b2[1]} stroke="#C9A35A" strokeOpacity=".6" strokeWidth=".8" />); }
    add(depth(x, y), (
      <g key={`st${i}`} className="cursor-pointer" onClick={() => onPick({ t: 'micro', i })} role="button" aria-label={`${i + 1}. ${MICRO[i]!.name}`}>
        <title>{`${i + 1}. ${MICRO[i]!.name}`}</title>
        {state === 'current' && <ellipse cx={base[0]} cy={base[1]} rx={w * S * 0.9} ry={w * S * 0.38} fill={HEALTH_COLOR[hs]} opacity=".22" filter="url(#j3-glow)" className={reduced ? undefined : 'j3-breathe'} />}
        {body}{floors}{scaffold}
        {state === 'current' && <>
          <line x1={top[0]} y1={top[1]} x2={top[0]} y2={top[1] - 70} stroke="#8FE3FF" strokeOpacity=".5" strokeWidth="2" filter="url(#j3-glow)" />
          <circle cx={top[0]} cy={top[1] - 70} r="7" fill="#E6FBFF" />
          {!reduced && <circle cx={top[0]} cy={top[1] - 70} r="7" fill="none" stroke="#E6FBFF" strokeWidth="1.5" className="j3-ping" />}
        </>}
        {state === 'done' && <g transform={`translate(${top[0]} ${top[1] - 14})`}><circle r="7" fill="#0B1A12" stroke="#34D399" strokeWidth="1.4" /><path d="M-3 0 L-1 2.4 L3.4 -2.4" fill="none" stroke="#34D399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></g>}
        <text x={fr[0]} y={fr[1] + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill={state === 'future' ? '#6B85A0' : '#DCEBFA'} style={{ paintOrder: 'stroke' }} stroke="#070D15" strokeWidth="3">{i + 1}. {MICRO[i]!.name}</text>
      </g>
    ));
  });

  // marcos da jornada em volta da microetapa correspondente
  const byMicro = new Map<number, JMilestone[]>();
  st.milestones.forEach((m) => byMicro.set(m.micro, [...(byMicro.get(m.micro) ?? []), m]));
  byMicro.forEach((list, mi) => {
    const [x, y] = ST[mi]!;
    list.forEach((m, k) => {
      const ang = Math.PI * (0.15 + (k / Math.max(1, list.length)) * 1.7), r = 4.6;
      const mx = x + Math.cos(ang) * r, my = y + 4 + Math.sin(ang) * 1.6;
      const done = st.doneIds.has(m.id), late = !done && !!m.plannedAt && m.plannedAt < st.today, next = m.id === st.nextMilestoneId;
      const col = done ? '#34D399' : late ? '#FBBF24' : next ? '#E6FBFF' : '#5FA8D8';
      const b = P(mx, my, 0), t = P(mx, my, 1.6), isSel = sel?.t === 'milestone' && sel.id === m.id;
      add(depth(mx, my), (
        <g key={`m${m.id}`} className="cursor-pointer" onClick={() => onPick({ t: 'milestone', id: m.id })} role="button" aria-label={`Marco: ${m.title}`}>
          <title>{`${m.title}${done ? ' · concluído' : late ? ' · atrasado' : ''}`}</title>
          <line x1={b[0]} y1={b[1]} x2={t[0]} y2={t[1]} stroke={col} strokeOpacity=".7" strokeWidth="1.2" />
          <circle cx={t[0]} cy={t[1]} r={isSel ? 5.5 : 4} fill={done ? col : '#0B1520'} stroke={isSel ? '#fff' : col} strokeWidth="1.5" />
          {(late || next) && !reduced && <circle cx={t[0]} cy={t[1]} r="4" fill="none" stroke={col} strokeWidth="1.2" className="j3-ping" />}
          <circle cx={t[0]} cy={t[1]} r="10" fill="transparent" />
        </g>
      ));
    });
  });

  // indicador de saúde (Ongoing)
  {
    const x = 63, y = -8.5, b = P(x, y, 0), t = P(x, y, 5.2), col = HEALTH_COLOR[hs];
    add(depth(x, y), (
      <g key="health" className="cursor-pointer" onClick={() => onPick({ t: 'health' })} role="button" aria-label={`Saúde da conta: ${st.healthScore ?? 'dado não disponível'}`}>
        <title>Health Score</title>
        {boxEls(pj, { x, y, w: 1.4, d: 1.4, z0: 0, h: 4.4, top: '#1B3047', side: '#122437', stroke: '#3E6A93', sw: 0.8 }, 'hp')}
        <circle cx={t[0]} cy={t[1]} r={16} fill={col} opacity=".25" filter="url(#j3-glow)" className={reduced || hs === 'sem_dados' ? undefined : 'j3-breathe'} />
        <circle cx={t[0]} cy={t[1]} r={9} fill={hs === 'sem_dados' ? '#1E293B' : col} stroke={sel?.t === 'health' ? '#fff' : col} strokeWidth="1.6" />
        <text x={t[0]} y={t[1] + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="800" fill={hs === 'sem_dados' ? '#CBD5E1' : '#06210F'}>{st.healthScore ?? '—'}</text>
        <ellipse cx={b[0]} cy={b[1]} rx="16" ry="6" fill={col} opacity=".15" />
      </g>
    ));
  }
  // risco: sinal sobre a etapa atual (só quando há alerta/ocorrência aberta)
  if (st.riskLevel && st.micro !== null && !st.historical) {
    const [x, y] = ST[st.micro]!, h = SHAPE[st.micro]![2], t = P(x + 2.6, y, h + 2.4), col = st.riskLevel === 'risco' ? '#F87171' : '#FBBF24';
    add(depth(x, y) + 0.2, (
      <g key="risk" className="cursor-pointer" onClick={() => onPick({ t: 'risks' })} role="button" aria-label="Riscos abertos">
        <title>Riscos abertos</title>
        <circle cx={t[0]} cy={t[1]} r="15" fill={col} opacity=".2" filter="url(#j3-glow)" className={reduced ? undefined : 'j3-breathe'} />
        <path d={`M${t[0]} ${t[1] - 9} L${t[0] + 9} ${t[1] + 7} L${t[0] - 9} ${t[1] + 7} Z`} fill="#1A0F06" stroke={col} strokeWidth="1.6" strokeLinejoin="round" />
        <text x={t[0]} y={t[1] + 5} textAnchor="middle" fontSize="11" fontWeight="800" fill={col}>!</text>
      </g>
    ));
  }
  // marco de renovação (portal) e módulos de expansão (possibilidades × contratados)
  {
    const x = 84.5, y = 0, a = P(x, y - 3.2, 0), b = P(x, y + 3.2, 0), a2 = P(x, y - 3.2, 6), b2 = P(x, y + 3.2, 6), col = st.renewalNear ? '#FBBF24' : '#3B5E80';
    add(depth(x, y), (
      <g key="ren" className="cursor-pointer" onClick={() => onPick({ t: 'renewal' })} role="button" aria-label="Marco de renovação">
        <title>Renovação</title>
        <path d={`M${a[0]} ${a[1]} L${a2[0]} ${a2[1]} L${b2[0]} ${b2[1]} L${b[0]} ${b[1]}`} fill="none" stroke={col} strokeWidth={st.renewalNear ? 3 : 2} filter={st.renewalNear ? 'url(#j3-glow)' : undefined} />
        <path d={`M${a[0]} ${a[1]} L${a2[0]} ${a2[1]} L${b2[0]} ${b2[1]} L${b[0]} ${b[1]}`} fill="none" stroke={st.renewalNear ? '#FFE7A3' : '#5B7EA0'} strokeWidth="1.2" />
        <text x={(a2[0] + b2[0]) / 2} y={Math.min(a2[1], b2[1]) - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill={st.renewalNear ? '#FDE68A' : '#7D97B2'} letterSpacing="1.5">RENOVAÇÃO</text>
      </g>
    ));
    st.expansion.slice(0, 4).forEach((e, k) => {
      const ex = 101 + (k % 2) * 6, ey = k < 2 ? -5 : 5, solid = e.state === 'contratada' || e.state === 'novo_ciclo';
      if (e.state === 'renovacao') return;
      const strong = e.state === 'avaliacao';
      add(depth(ex, ey), (
        <g key={`x${k}`} className="cursor-pointer" onClick={() => onPick({ t: 'expansion', i: k })} role="button" aria-label={e.title}>
          <title>{e.title}</title>
          {boxEls(pj, solid ? { x: ex, y: ey, w: 4, d: 4, z0: 0, h: 4, top: '#1F4568', side: '#183A59', stroke: '#34D399', sw: 1.2 } : { x: ex, y: ey, w: 4, d: 4, z0: 0, h: 4, top: 'rgba(96,211,255,0.06)', side: 'rgba(96,211,255,0.05)', stroke: strong ? '#8FE3FF' : '#4B7CA8', sw: 1, dash: '3 3' }, `xb${k}`)}
        </g>
      ));
      // caminho de crescimento até o módulo
      const p0 = P(96, 0, 0.03), p1 = P(ex, ey, 0.03);
      add(-999, <path key={`xp${k}`} d={`M${p0[0]} ${p0[1]} L${p1[0]} ${p1[1]}`} stroke={solid ? '#34D399' : '#8FE3FF'} strokeOpacity={solid ? 0.7 : 0.4} strokeWidth="1.4" strokeDasharray={solid ? undefined : '5 5'} fill="none" />);
    });
  }
  items.sort((a, b) => a.d - b.d);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label="Jornada do cliente em 3D: Onboarding, Ongoing e Expansão">
      <defs>
        <filter id="j3-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
        <radialGradient id="j3-sky" cx=".5" cy=".35" r=".8"><stop offset="0" stopColor="#13304D" /><stop offset="1" stopColor="#060B12" /></radialGradient>
      </defs>
      <rect width={VW} height={VH} fill="url(#j3-sky)" />
      {plats}
      {ENV.map((e, i) => { const p = P(e.x0 + 1.5, 10.6, 0); return <g key={`lab${i}`}><text x={p[0]} y={p[1] + 18} fontSize="12" fontWeight="800" letterSpacing="3" fill={i === curMacro ? '#BFE8FF' : '#58779A'}>{e.name}</text><text x={p[0]} y={p[1] + 31} fontSize="9.5" fill="#58779A">{e.sub}</text></g>; })}
      <path d={wayD} fill="none" stroke="#2D5B85" strokeWidth={3.5 * cam.zoom} strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
      {reached >= 0 && <path d={wayDone} fill="none" stroke="#60D3FF" strokeWidth={6 * cam.zoom} strokeOpacity=".35" strokeLinecap="round" strokeLinejoin="round" filter="url(#j3-glow)" />}
      {reached >= 0 && <path d={wayDone} fill="none" stroke="#BFEFFF" strokeWidth={1.6 * cam.zoom} strokeLinecap="round" strokeLinejoin="round" />}
      {reached >= 0 && !reduced && <path d={wayDone} fill="none" stroke="#fff" strokeWidth={2.4 * cam.zoom} strokeLinecap="round" pathLength={100} strokeDasharray="2 18" className="j3-flow" />}
      {items.map((x) => x.el)}
    </svg>
  );
});
