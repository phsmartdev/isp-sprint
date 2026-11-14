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
const ENV = [{ x0: -2, x1: 44, name: 'ONBOARDING', sub: 'referência: 90 dias' }, { x0: 49, x1: 77, name: 'ONGOING', sub: 'referência: 180 dias' }, { x0: 82, x1: 110, name: 'EXPANSÃO', sub: 'antes da renovação' }];
/** forma de cada edifício: largura, profundidade, altura */
const SHAPE: [number, number, number][] = [[4, 4, 3], [5, 4, 4.5], [5, 5, 6.5], [5, 4, 5.5], [6, 5, 9], [6, 6, 12], [6, 6, 7]];
export const HEALTH_COLOR: Record<HealthState, string> = { saudavel: '#2E8B57', atencao: '#C27A12', risco: '#C23B3B', sem_dados: '#9AA3AD' };
/** maquete: volumes claros, um único azul de marca para o que está em curso, status em tons sóbrios */
const K = { bg0: '#F7F6F3', bg1: '#ECEAE5', plate: '#E9E7E2', plateNow: '#E3E8EE', plateSide: '#D9D6CF', plateEdge: '#CFCBC3', wall: '#F4F3F0', top: '#FFFFFF', edge: '#B9B5AD', ghost: '#B7BDC5', blue: '#2F5986', blueSoft: '#DCE6F0', ink: '#2D3339', muted: '#7D8791', line: '#A9AFB6', ok: '#2E8B57', warn: '#C27A12', bad: '#C23B3B' };
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
        return <polygon key={i} points={pts(f.q.map((v) => P(...v)))} fill={b.side} style={{ filter: `brightness(${(0.9 + lx * 0.08).toFixed(3)})` }} {...st} />;
      })}
      <polygon points={pts(([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] as V3[]).map((v) => P(...v)))} fill={b.top} {...st} />
    </g>
  );
}



export const JourneyScene = memo(function JourneyScene({ cam, st, sel, onPick, reduced }: { cam: Cam; st: SceneState; sel: Pick | null; onPick: (p: Pick) => void; reduced: boolean }) {
  const pj = proj(cam);
  const { P, depth, S } = pj;
  const items: { d: number; el: ReactNode }[] = [];
  const add = (d: number, el: ReactNode) => items.push({ d, el });
  const labels: ReactNode[] = [];   // nomes das etapas por cima dos volumes
  const hs = healthState(st.healthScore);
  const curMacro = st.micro === null ? null : MICRO[st.micro]!.macro;

  // plataformas dos três ambientes
  const plats = ENV.map((e, i) => boxEls(pj, { x: (e.x0 + e.x1) / 2, y: 0, w: e.x1 - e.x0, d: 22, z0: -0.7, h: 0.7, top: i === curMacro ? K.plateNow : K.plate, side: K.plateSide, stroke: K.plateEdge, sw: 0.8 }, `pl${i}`));
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
      ? boxEls(pj, { x, y, w, d, z0: 0, h, top: 'rgba(255,255,255,0.35)', side: 'rgba(255,255,255,0.2)', stroke: isSel ? K.blue : K.ghost, sw: isSel ? 1.4 : 0.9, dash: possible ? '3 3' : undefined }, `b${i}`)
      : boxEls(pj, { x, y, w, d, z0: 0, h, top: state === 'current' ? K.blueSoft : K.top, side: state === 'current' ? '#E6ECF2' : K.wall, stroke: isSel || state === 'current' ? K.blue : K.edge, sw: isSel ? 1.5 : state === 'current' ? 1.2 : 0.7 }, `b${i}`);
    const top = P(x, y, h), base = P(x, y, 0), fr = P(x, y + d / 2, 0);
    const floors: ReactNode[] = [];
    if (state !== 'future') for (let k = 1; k < Math.floor(h / 1.4); k++) {
      const z = k * 1.4, a = P(x - w / 2, y + d / 2, z), b2 = P(x + w / 2, y + d / 2, z);
      floors.push(<line key={k} x1={a[0]} y1={a[1]} x2={b2[0]} y2={b2[1]} stroke={state === 'current' ? K.blue : K.edge} strokeOpacity={state === 'current' ? 0.35 : 0.45} strokeWidth="0.6" />);
    }
    // andaime na Entrega enquanto não concluída (implantação em curso)
    const scaffold: ReactNode[] = [];
    if (i === 2 && state !== 'done') for (let k = 0; k <= 4; k++) { const a = P(x - w / 2 - 0.4 + (k * (w + 0.8)) / 4, y + d / 2 + 0.4, 0), b2 = P(x - w / 2 - 0.4 + (k * (w + 0.8)) / 4, y + d / 2 + 0.4, h * 0.85); scaffold.push(<line key={k} x1={a[0]} y1={a[1]} x2={b2[0]} y2={b2[1]} stroke={K.muted} strokeOpacity=".55" strokeWidth=".7" />); }
    labels.push(<text key={`lb${i}`} x={fr[0]} y={fr[1] + 17} textAnchor="middle" fontSize="11" fontWeight={state === 'current' ? 600 : 400} fill={state === 'future' ? K.muted : K.ink} style={{ paintOrder: 'stroke', pointerEvents: 'none' }} stroke={K.plate} strokeWidth="4" strokeLinejoin="round">{MICRO[i]!.name}</text>);
    add(depth(x, y), (
      <g key={`st${i}`} className="cursor-pointer" onClick={() => onPick({ t: 'micro', i })} role="button" aria-label={`${i + 1}. ${MICRO[i]!.name}`}>
        <title>{`${i + 1}. ${MICRO[i]!.name}`}</title>
        <ellipse cx={base[0] + w * S * 0.25} cy={base[1] + 2} rx={w * S * 0.85} ry={w * S * 0.3} fill="#000" opacity={state === 'future' ? 0.03 : 0.08} filter="url(#j3-soft)" />
        {body}{floors}{scaffold}
        {state === 'current' && <>
          <line x1={top[0]} y1={top[1]} x2={top[0]} y2={top[1] - 34} stroke={K.blue} strokeWidth="1" />
          <rect x={top[0] - 30} y={top[1] - 52} width="60" height="18" fill={K.blue} />
          <text x={top[0]} y={top[1] - 39.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#fff">Etapa atual</text>
        </>}
        {state === 'done' && <g transform={`translate(${top[0]} ${top[1] - 12})`}><circle r="6" fill="#fff" stroke={K.ok} strokeWidth="1" /><path d="M-2.6 0 L-0.8 2 L2.8 -2" fill="none" stroke={K.ok} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></g>}
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
      const col = done ? K.ok : late ? K.warn : next ? K.blue : K.line;
      const b = P(mx, my, 0), t = P(mx, my, 1.6), isSel = sel?.t === 'milestone' && sel.id === m.id;
      add(depth(mx, my), (
        <g key={`m${m.id}`} className="cursor-pointer" onClick={() => onPick({ t: 'milestone', id: m.id })} role="button" aria-label={`Marco: ${m.title}`}>
          <title>{`${m.title}${done ? ' · concluído' : late ? ' · atrasado' : ''}`}</title>
          <line x1={b[0]} y1={b[1]} x2={t[0]} y2={t[1]} stroke={K.line} strokeWidth="0.8" />
          <circle cx={t[0]} cy={t[1]} r={isSel ? 5 : 3.6} fill={done ? col : '#fff'} stroke={isSel ? K.ink : col} strokeWidth={isSel ? 1.6 : 1.3} />
          {late && !reduced && <circle cx={t[0]} cy={t[1]} r="3.6" fill="none" stroke={col} strokeWidth="1" className="j3-ping" />}
          <circle cx={t[0]} cy={t[1]} r="10" fill="transparent" />
        </g>
      ));
    });
  });

  // indicador de saúde (Ongoing)
  {
    const x = 75, y = -7, b = P(x, y, 0), t = P(x, y, 5.2), col = HEALTH_COLOR[hs];
    add(depth(x, y), (
      <g key="health" className="cursor-pointer" onClick={() => onPick({ t: 'health' })} role="button" aria-label={`Saúde da conta: ${st.healthScore ?? 'dado não disponível'}`}>
        <title>Health Score</title>
        <ellipse cx={b[0] + 6} cy={b[1] + 2} rx="14" ry="5" fill="#000" opacity=".08" filter="url(#j3-soft)" />
        {boxEls(pj, { x, y, w: 1.1, d: 1.1, z0: 0, h: 4.4, top: K.top, side: K.wall, stroke: K.edge, sw: 0.7 }, 'hp')}
        <circle cx={t[0]} cy={t[1]} r={13} fill="#fff" stroke={sel?.t === 'health' ? K.ink : col} strokeWidth={sel?.t === 'health' ? 1.8 : 1.4} />
        <text x={t[0]} y={t[1] + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill={col}>{st.healthScore ?? '—'}</text>
      </g>
    ));
  }
  // risco: sinal sobre a etapa atual (só quando há alerta/ocorrência aberta)
  if (st.riskLevel && st.micro !== null && !st.historical) {
    const [x, y] = ST[st.micro]!, h = SHAPE[st.micro]![2], t = P(x + 3.4, y, h + 1.2), col = st.riskLevel === 'risco' ? K.bad : K.warn;
    add(depth(x, y) + 0.2, (
      <g key="risk" className="cursor-pointer" onClick={() => onPick({ t: 'risks' })} role="button" aria-label="Riscos abertos">
        <title>Riscos abertos</title>
        <circle cx={t[0]} cy={t[1]} r="8" fill={col} />
        <text x={t[0]} y={t[1] + 3.6} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff">!</text>
      </g>
    ));
  }
  // marco de renovação (portal) e módulos de expansão (possibilidades × contratados)
  {
    const x = 84.5, y = 0, a = P(x, y - 3.2, 0), b = P(x, y + 3.2, 0), a2 = P(x, y - 3.2, 6), b2 = P(x, y + 3.2, 6), col = st.renewalNear ? K.warn : K.ghost;
    add(depth(x, y), (
      <g key="ren" className="cursor-pointer" onClick={() => onPick({ t: 'renewal' })} role="button" aria-label="Marco de renovação">
        <title>Renovação</title>
        <path d={`M${a[0]} ${a[1]} L${a2[0]} ${a2[1]} L${b2[0]} ${b2[1]} L${b[0]} ${b[1]}`} fill="none" stroke={col} strokeWidth={st.renewalNear ? 2 : 1.2} />
        <text x={(a2[0] + b2[0]) / 2} y={Math.min(a2[1], b2[1]) - 7} textAnchor="middle" fontSize="10.5" fill={st.renewalNear ? K.warn : K.muted}>Renovação</text>
      </g>
    ));
    st.expansion.slice(0, 4).forEach((e, k) => {
      const ex = 101 + (k % 2) * 6, ey = k < 2 ? -5 : 5, solid = e.state === 'contratada' || e.state === 'novo_ciclo';
      if (e.state === 'renovacao') return;
      const strong = e.state === 'avaliacao';
      add(depth(ex, ey), (
        <g key={`x${k}`} className="cursor-pointer" onClick={() => onPick({ t: 'expansion', i: k })} role="button" aria-label={e.title}>
          <title>{e.title}</title>
          {boxEls(pj, solid ? { x: ex, y: ey, w: 4, d: 4, z0: 0, h: 4, top: K.top, side: K.wall, stroke: K.ok, sw: 1 } : { x: ex, y: ey, w: 4, d: 4, z0: 0, h: 4, top: 'rgba(255,255,255,0.3)', side: 'rgba(255,255,255,0.15)', stroke: strong ? K.blue : K.ghost, sw: 0.9, dash: '3 3' }, `xb${k}`)}
        </g>
      ));
      // caminho de crescimento até o módulo
      const p0 = P(96, 0, 0.03), p1 = P(ex, ey, 0.03);
      add(-999, <path key={`xp${k}`} d={`M${p0[0]} ${p0[1]} L${p1[0]} ${p1[1]}`} stroke={solid ? K.ok : K.ghost} strokeWidth="1" strokeDasharray={solid ? undefined : '4 4'} fill="none" />);
    });
  }
  items.sort((a, b) => a.d - b.d);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label="Jornada do cliente em 3D: Onboarding, Ongoing e Expansão">
      <defs>
        <filter id="j3-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
        <radialGradient id="j3-sky" cx=".5" cy=".3" r=".9"><stop offset="0" stopColor={K.bg0} /><stop offset="1" stopColor={K.bg1} /></radialGradient>
      </defs>
      <rect width={VW} height={VH} fill="url(#j3-sky)" />
      {plats}
      {ENV.map((e, i) => { const p = P(e.x0 + 1.5, 11.6, -0.7); return <g key={`lab${i}`} style={{ paintOrder: 'stroke' }} stroke={K.bg1} strokeWidth="3"><text x={p[0]} y={p[1] + 20} fontSize="13" fontWeight="600" fill={i === curMacro ? K.ink : K.muted}>{e.name.charAt(0) + e.name.slice(1).toLowerCase()}</text><text x={p[0]} y={p[1] + 34} fontSize="10" fill={K.muted}>{e.sub}</text></g>; })}
      <path d={wayD} fill="none" stroke={K.line} strokeWidth="1" strokeDasharray="2 3" strokeLinecap="round" strokeLinejoin="round" />
      {reached >= 0 && <path d={wayDone} fill="none" stroke={K.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      {items.map((x) => x.el)}
      {labels}
    </svg>
  );
});
