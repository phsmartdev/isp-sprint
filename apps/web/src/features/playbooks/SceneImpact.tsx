/**
 * CENA 04 — O IMPACTO HUMANO. Uma única composição contínua: a câmera percorre quatro dioramas isométricos
 * (educação, saúde, desenvolvimento regional, sustentabilidade) ligados pela mesma fibra luminosa.
 * São cenas ILUSTRATIVAS de possibilidades de impacto, não registros de projetos.
 * Auto: 7,5 s por diorama; os pontos embaixo levam a cada um e pausam o avanço por 15 s.
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Particles } from './CityScenes';

type Pt = [number, number];
const U = 44, C = 0.866;
const SP = 1600, CX = 1060, OY = 250;          // distância entre dioramas e posição do primeiro
const W = 9, D = 7, H = 5;
const ox = (i: number) => CX + i * SP;
const iso = (i: number) => (x: number, y: number, z = 0): Pt => [ox(i) + (x - y) * C * U, OY + (x + y) * 0.5 * U - z * U];
const pts = (a: Pt[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

type P3 = ReturnType<typeof iso>;
const poly = (k: string, P: P3, a: [number, number, number][], fill: string, extra: Record<string, unknown> = {}) => <polygon key={k} points={pts(a.map((v) => P(...v)))} fill={fill} {...extra} />;
/** caixa isométrica: topo + faces da frente (y = y1 e x = x1) */
function box(k: string, P: P3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, top: string, left: string, right: string, stroke?: string) {
  const s = stroke ? { stroke, strokeWidth: 0.6, strokeOpacity: 0.5 } : {};
  return (
    <g key={k}>
      {poly('l', P, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], left, s)}
      {poly('r', P, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], right, s)}
      {poly('t', P, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top, s)}
    </g>
  );
}
/** pessoa estilizada (voxel), de pé ou sentada; skin/shirt/pants/hair em cores */
function person(k: string, P: P3, x: number, y: number, o: { skin: string; shirt: string; pants: string; hair: string; seated?: boolean; scale?: number; coat?: boolean; gray?: boolean }) {
  const s = o.scale ?? 1, hip = o.seated ? 0.62 : 0.86 * s;
  const shade = (c: string) => `color-mix(in srgb, ${c} 72%, #000)`;
  const head = P(x, y, hip + 0.78 * s + 0.24 * s);
  return (
    <g key={k}>
      <ellipse cx={P(x, y, 0)[0]} cy={P(x, y, 0)[1]} rx={0.42 * U * s} ry={0.2 * U * s} fill="#000" opacity=".3" />
      {o.seated
        ? box('lg', P, x - 0.16, x + 0.16, y - 0.05, y + 0.62, 0.42, 0.62, o.pants, shade(o.pants), shade(o.pants))
        : box('lg', P, x - 0.17 * s, x + 0.17 * s, y - 0.11 * s, y + 0.11 * s, 0, hip, o.pants, shade(o.pants), shade(o.pants))}
      {o.seated && box('sh', P, x - 0.16, x + 0.16, y + 0.5, y + 0.66, 0, 0.42, o.pants, shade(o.pants), shade(o.pants))}
      {box('tr', P, x - 0.23 * s, x + 0.23 * s, y - 0.14 * s, y + 0.14 * s, hip, hip + 0.78 * s, o.coat ? '#F2F5F8' : o.shirt, o.coat ? '#C9D2DC' : shade(o.shirt), o.coat ? '#DDE4EB' : shade(o.shirt))}
      {box('ar', P, x + 0.23 * s, x + 0.33 * s, y - 0.06 * s, y + 0.08 * s, hip + 0.18 * s, hip + 0.74 * s, o.coat ? '#F2F5F8' : o.shirt, o.coat ? '#C9D2DC' : shade(o.shirt), o.coat ? '#DDE4EB' : shade(o.shirt))}
      <circle cx={head[0]} cy={head[1]} r={0.26 * U * s} fill={o.skin} />
      <path d={`M${head[0] - 0.27 * U * s} ${head[1] - 0.02 * U} a${0.27 * U * s} ${0.27 * U * s} 0 0 1 ${0.54 * U * s} 0 q${-0.27 * U * s} ${-0.1 * U * s} ${-0.54 * U * s} 0z`} fill={o.gray ? '#C8CDD3' : o.hair} />
    </g>
  );
}
/** sala/diorama: plataforma com espessura e duas paredes ao fundo */
function room(i: number, floor: string, wallL: string, wallR: string, walls = true) {
  const P = iso(i);
  return (
    <g key="room">
      <polygon points={pts([P(0, D, 0), P(W, D, 0), P(W, D, -0.5), P(0, D, -0.5)])} fill="#0A1622" stroke="#1F4060" strokeWidth=".8" />
      <polygon points={pts([P(W, 0, 0), P(W, D, 0), P(W, D, -0.5), P(W, 0, -0.5)])} fill="#0C1B2A" stroke="#1F4060" strokeWidth=".8" />
      {poly('f', P, [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]], floor)}
      {walls && poly('wl', P, [[0, 0, 0], [0, D, 0], [0, D, H], [0, 0, H]], wallL)}
      {walls && poly('wr', P, [[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]], wallR)}
      {walls && <path d={`M${pts([P(0, D, H), P(0, 0, H), P(W, 0, H)])}`} fill="none" stroke="#8FD6FF" strokeOpacity=".35" strokeWidth="1" />}
      <path d={`M${pts([P(0, D, 0), P(W, D, 0), P(W, 0, 0)])}`} fill="none" stroke="#8FD6FF" strokeOpacity=".5" strokeWidth="1.2" />
    </g>
  );
}
/** ONT na parede (x = 0) com fibra descendo até o chão */
function ont(P: P3, y: number, z: number) {
  const a = P(0.02, y, z), b = P(0.02, y, 0);
  return (
    <g key="ont">
      <path d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]}`} stroke="#8FD6FF" strokeWidth="1.4" />
      {poly('o', P, [[0.02, y - 0.35, z - 0.2], [0.02, y + 0.35, z - 0.2], [0.02, y + 0.35, z + 0.25], [0.02, y - 0.35, z + 0.25]], '#E8EEF4', { stroke: '#8FD6FF', strokeWidth: 0.8 })}
      <circle cx={P(0.02, y + 0.15, z)[0]} cy={P(0.02, y + 0.15, z)[1]} r="1.8" fill="#7CFFB2" className="pol-blink" />
    </g>
  );
}
const lamp = (P: P3, x: number, y: number, z: number, r: number, c = '#FFD9A0', o = 0.35) => { const p = P(x, y, z); return <ellipse key={`lamp${x}${y}`} cx={p[0]} cy={p[1]} rx={r} ry={r * 0.6} fill={c} opacity={o} filter="url(#im-blur)" />; };

const SKIN = ['#8D5524', '#C68642', '#E0AC69', '#F1C27D', '#5C3A1E'];

function Education() {
  const P = iso(0);
  const books = ['#E07A5F', '#81B29A', '#F2CC8F', '#3D85C6', '#C77DFF', '#E9C46A'];
  return (
    <g>
      {room(0, '#1E2A36', '#18324C', '#1C3A57')}
      {/* janela com a cidade ao fundo */}
      {poly('win', P, [[1.2, 0.02, 1.8], [4.6, 0.02, 1.8], [4.6, 0.02, 4], [1.2, 0.02, 4]], '#0B2038', { stroke: '#8FD6FF', strokeWidth: 1, strokeOpacity: 0.5 })}
      {[...Array(18)].map((_, k) => { const p = P(1.4 + (k % 6) * 0.55, 0.02, 2 + Math.floor(k / 6) * 0.55); return <rect key={k} x={p[0]} y={p[1]} width="3" height="2.4" fill={k % 3 ? '#FFD9A0' : '#9FD8FF'} opacity=".7" />; })}
      {/* quadro */}
      {poly('wb', P, [[5.4, 0.02, 1.6], [8.4, 0.02, 1.6], [8.4, 0.02, 3.5], [5.4, 0.02, 3.5]], '#E9EEF2', { stroke: '#9AA8B5', strokeWidth: 1 })}
      <path d={`M${pts([P(5.8, 0.02, 3.1), P(6.6, 0.02, 3.1)])} M${pts([P(5.8, 0.02, 2.7), P(7.6, 0.02, 2.7)])} M${pts([P(5.8, 0.02, 2.3), P(7.0, 0.02, 2.3)])}`} stroke="#3D85C6" strokeWidth="1.6" fill="none" />
      <path d={`M${pts([P(7.2, 0.02, 2.0), P(7.6, 0.02, 2.5), P(8.0, 0.02, 2.2)])}`} stroke="#E07A5F" strokeWidth="1.6" fill="none" />
      {/* estante */}
      {box('shelf', P, 0, 0.6, 0.6, 3.2, 0, 3, '#3A2A1E', '#2A1E15', '#4A3526')}
      {[0, 1, 2].map((r) => books.map((c, b) => { const y0 = 0.75 + b * 0.38, z0 = 0.25 + r * 0.95; return poly(`bk${r}${b}`, P, [[0.6, y0, z0], [0.6, y0 + 0.28, z0], [0.6, y0 + 0.28, z0 + 0.6 - (b % 2) * 0.12], [0.6, y0, z0 + 0.6 - (b % 2) * 0.12]], c); }))}
      {ont(P, 5.6, 2.4)}
      {lamp(P, 4.5, 3.5, 2.6, 190)}
      {/* mesa e estudantes */}
      {box('d1', P, 3, 5.2, 3.6, 4.6, 0.72, 0.82, '#C9A27A', '#8E6E50', '#A88663')}
      {box('d1l', P, 3.05, 3.15, 4.45, 4.55, 0, 0.72, '#555', '#444', '#555')}
      {box('d1r', P, 5.05, 5.15, 4.45, 4.55, 0, 0.72, '#555', '#444', '#555')}
      {person('s1', P, 4.1, 3.0, { skin: SKIN[1]!, shirt: '#3D85C6', pants: '#2B3A55', hair: '#1B1B1B', seated: false, scale: 0.82 })}
      {/* notebook voltado para a estudante: a tela ilumina o rosto */}
      {box('lb', P, 3.6, 4.6, 3.75, 4.35, 0.82, 0.86, '#B8C2CC', '#8A96A3', '#A2ADB8')}
      {poly('ls', P, [[3.6, 3.75, 0.86], [4.6, 3.75, 0.86], [4.6, 3.6, 1.5], [3.6, 3.6, 1.5]], '#2A3A4A')}
      {lamp(P, 4.1, 3.4, 1.4, 60, '#7FD3FF', 0.5)}
      {box('d2', P, 6, 8.2, 4.4, 5.4, 0.72, 0.82, '#C9A27A', '#8E6E50', '#A88663')}
      {person('s2', P, 7.1, 3.8, { skin: SKIN[3]!, shirt: '#E9C46A', pants: '#334', hair: '#5A3A22', scale: 0.78 })}
      {box('tb', P, 6.6, 7.4, 4.55, 5.1, 0.82, 0.86, '#2A3A4A', '#1F2C38', '#253340')}
      {lamp(P, 7.0, 4.8, 1.0, 40, '#7FD3FF', 0.55)}
      {person('t', P, 7.6, 1.4, { skin: SKIN[0]!, shirt: '#81B29A', pants: '#2E3440', hair: '#111' })}
    </g>
  );
}

function Health() {
  const P = iso(1);
  return (
    <g>
      {room(1, '#1C2C33', '#173840', '#1A4049')}
      {poly('win', P, [[1.0, 0.02, 1.8], [3.6, 0.02, 1.8], [3.6, 0.02, 4], [1.0, 0.02, 4]], '#0B2A38', { stroke: '#8FD6FF', strokeWidth: 1, strokeOpacity: 0.5 })}
      {/* cruz de saúde */}
      {poly('cr1', P, [[0.02, 2.2, 3.2], [0.02, 2.5, 3.2], [0.02, 2.5, 4.1], [0.02, 2.2, 4.1]], '#5CE1C6')}
      {poly('cr2', P, [[0.02, 1.9, 3.5], [0.02, 2.8, 3.5], [0.02, 2.8, 3.8], [0.02, 1.9, 3.8]], '#5CE1C6')}
      {/* monitor com ECG */}
      {poly('mon', P, [[4.4, 0.02, 2.0], [6.4, 0.02, 2.0], [6.4, 0.02, 3.4], [4.4, 0.02, 3.4]], '#06141C', { stroke: '#8FD6FF', strokeWidth: 1 })}
      <path d={`M${pts([P(4.6, 0.02, 2.7), P(5.0, 0.02, 2.7), P(5.15, 0.02, 3.15), P(5.3, 0.02, 2.35), P(5.45, 0.02, 2.7), P(6.2, 0.02, 2.7)])}`} pathLength={200} fill="none" stroke="#7CFFB2" strokeWidth="1.8" className="cine-ecg" />
      {ont(P, 5.2, 2.4)}
      {lamp(P, 5, 3, 2.8, 200, '#CFF4FF', 0.22)}
      {/* maca e paciente */}
      {box('bed', P, 4.6, 7.6, 1.2, 2.6, 0, 0.62, '#C9D2DC', '#8D99A6', '#A9B4C0')}
      {box('mat', P, 4.6, 7.6, 1.2, 2.6, 0.62, 0.8, '#F4F7FA', '#D5DCE3', '#E3E8EE')}
      {box('pil', P, 6.9, 7.5, 1.35, 2.45, 0.8, 0.95, '#FFFFFF', '#DDE3E8', '#EEF2F5')}
      {person('pt', P, 5.6, 2.2, { skin: SKIN[2]!, shirt: '#8FB8DE', pants: '#3A4A5A', hair: '#222', gray: true, seated: true })}
      {/* profissional de saúde com tablet */}
      {person('dr', P, 4.2, 3.6, { skin: SKIN[4]!, shirt: '#5CE1C6', pants: '#2F5D62', hair: '#111', coat: true })}
      {box('tab', P, 4.45, 4.75, 3.3, 3.75, 1.25, 1.3, '#2A3A4A', '#1F2C38', '#253340')}
      {lamp(P, 4.6, 3.5, 1.4, 34, '#7FD3FF', 0.6)}
      {box('cab', P, 0, 0.7, 4.2, 6.4, 0, 1.6, '#DDE4EB', '#B9C4CF', '#CBD4DD')}
    </g>
  );
}

function City() {
  const P = iso(2);
  const lit = (k: string, x0: number, x1: number, z0: number, z1: number, warm = true) => poly(k, P, [[x0, 2.21, z0], [x1, 2.21, z0], [x1, 2.21, z1], [x0, 2.21, z1]], warm ? '#FFD9A0' : '#BFE6FF', { opacity: 0.85 });
  return (
    <g>
      {room(2, '#1A2430', '#000', '#000', false)}
      {/* calçada e rua */}
      {poly('side', P, [[0, 2.2, 0.01], [W, 2.2, 0.01], [W, 4, 0.01], [0, 4, 0.01]], '#2A3644')}
      {poly('road', P, [[0, 4, 0.01], [W, 4, 0.01], [W, D, 0.01], [0, D, 0.01]], '#141B24')}
      {[0, 1, 2, 3, 4].map((k) => poly(`ln${k}`, P, [[0.4 + k * 1.8, 5.45, 0.02], [1.3 + k * 1.8, 5.45, 0.02], [1.3 + k * 1.8, 5.55, 0.02], [0.4 + k * 1.8, 5.55, 0.02]], '#E9C46A', { opacity: 0.7 }))}
      {/* comércio e escritório */}
      {box('shop', P, 0.2, 4.2, 0, 2.2, 0, 3.6, '#2B3A4C', '#33475C', '#26384A')}
      {lit('sw1', 0.5, 2.0, 0.2, 1.8)}{lit('sw2', 2.4, 3.9, 0.2, 1.8)}
      {poly('awn', P, [[0.3, 2.2, 2.0], [4.1, 2.2, 2.0], [4.1, 2.75, 1.8], [0.3, 2.75, 1.8]], '#E07A5F')}
      {lit('up1', 0.6, 1.6, 2.4, 3.2, false)}{lit('up2', 2.8, 3.8, 2.4, 3.2)}
      {box('off', P, 4.7, 8.8, 0, 2.2, 0, 5.4, '#23344A', '#2C4360', '#203248')}
      {[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => (r + c) % 3 !== 1 && lit(`ow${r}${c}`, 5.0 + c * 1.25, 5.9 + c * 1.25, 0.4 + r * 1.25, 1.2 + r * 1.25, (r + c) % 2 === 0)))}
      {person('ow', P, 6.3, 2.0, { skin: SKIN[1]!, shirt: '#3D85C6', pants: '#2B3A55', hair: '#222', scale: 0.7 })}
      {lamp(P, 2.2, 2.6, 1.0, 160, '#FFD9A0', 0.35)}
      {/* armário óptico na calçada */}
      {box('cab', P, 8.2, 8.7, 3.2, 3.6, 0, 1.1, '#9AA8B5', '#7C8A97', '#8C9AA7')}
      <circle cx={P(8.7, 3.4, 0.8)[0]} cy={P(8.7, 3.4, 0.8)[1]} r="1.8" fill="#7CFFB2" className="pol-blink" />
      {/* poste */}
      {box('pole', P, 7.6, 7.7, 3.8, 3.9, 0, 3.4, '#5E6B7A', '#4A5662', '#55626F')}
      {lamp(P, 7.65, 3.85, 3.3, 70, '#FFE7B8', 0.6)}
      {/* pessoas em movimento */}
      <g className="cine-walk" style={{ ['--wx' as string]: `${3.2 * C * U}px`, ['--wy' as string]: `${3.2 * 0.5 * U}px`, ['--dur' as string]: '8s' }}>{person('w1', P, 1.2, 3.0, { skin: SKIN[3]!, shirt: '#C77DFF', pants: '#2E3440', hair: '#6B3E26' })}</g>
      <g className="cine-walk" style={{ ['--wx' as string]: `${-2.6 * C * U}px`, ['--wy' as string]: `${-2.6 * 0.5 * U}px`, ['--dur' as string]: '10s' }}>{person('w2', P, 6.4, 3.4, { skin: SKIN[0]!, shirt: '#81B29A', pants: '#3A3A3A', hair: '#111' })}{person('w3', P, 6.9, 3.6, { skin: SKIN[0]!, shirt: '#F2CC8F', pants: '#3A4A5A', hair: '#111', scale: 0.62 })}</g>
    </g>
  );
}

function Nature() {
  const P = iso(3);
  const tree = (k: string, x: number, y: number, h: number, c: string) => {
    const t = P(x, y, h);
    return <g key={k}>{box(`${k}t`, P, x - 0.12, x + 0.12, y - 0.12, y + 0.12, 0, h * 0.55, '#6B4A2F', '#4E3522', '#5C3F28')}<circle cx={t[0]} cy={t[1] + 6} r={h * 15} fill={c} opacity=".9" /><circle cx={t[0] - h * 6} cy={t[1] + h * 8} r={h * 11} fill={c} /><circle cx={t[0] + h * 7} cy={t[1] + h * 9} r={h * 10} fill={`color-mix(in srgb, ${c} 80%, #000)`} /></g>;
  };
  return (
    <g>
      {room(3, '#16302A', '#000', '#000', false)}
      {poly('path', P, [[3.6, 0, 0.01], [4.6, 0, 0.01], [4.6, D, 0.01], [3.6, D, 0.01]], '#3A4A3E')}
      {/* prédio eficiente com painéis solares */}
      {box('bld', P, 0.3, 3.2, 0.3, 2.6, 0, 3.2, '#2C4360', '#33475C', '#26384A')}
      {[0, 1].map((r) => [0, 1, 2].map((c) => poly(`bw${r}${c}`, P, [[0.6 + c * 0.9, 2.61, 0.5 + r * 1.3], [1.2 + c * 0.9, 2.61, 0.5 + r * 1.3], [1.2 + c * 0.9, 2.61, 1.3 + r * 1.3], [0.6 + c * 0.9, 2.61, 1.3 + r * 1.3]], '#FFD9A0', { opacity: 0.8 })))}
      {[0, 1, 2].map((c) => poly(`sol${c}`, P, [[0.5 + c * 0.9, 0.6, 3.25], [1.25 + c * 0.9, 0.6, 3.25], [1.25 + c * 0.9, 2.2, 3.7], [0.5 + c * 0.9, 2.2, 3.7]], '#1F5FA8', { stroke: '#8FD6FF', strokeWidth: 0.7 }))}
      {ont(P, 1.6, 1.6)}
      {tree('t1', 6.2, 1.0, 2.6, '#2E8B57')}{tree('t2', 8.0, 2.4, 2.1, '#3BA36A')}{tree('t3', 1.0, 5.6, 2.3, '#2E8B57')}{tree('t4', 7.6, 5.6, 1.8, '#46B07A')}
      {/* banco */}
      {box('bench', P, 5.2, 6.8, 4.2, 4.6, 0.4, 0.5, '#8E6E50', '#6E5440', '#7E6048')}
      {/* adulto e criança plantando uma muda */}
      {person('ad', P, 5.6, 2.9, { skin: SKIN[2]!, shirt: '#E07A5F', pants: '#2E3440', hair: '#3A2A1E' })}
      {person('ch', P, 6.5, 3.5, { skin: SKIN[2]!, shirt: '#F2CC8F', pants: '#3D85C6', hair: '#3A2A1E', scale: 0.62 })}
      {box('soil', P, 6.0, 6.5, 3.9, 4.3, 0, 0.08, '#4E3522', '#3A2718', '#45301F')}
      {(() => { const b = P(6.25, 4.1, 0.08); return <g><path d={`M${b[0]} ${b[1]} l0 -16`} stroke="#5FBF6A" strokeWidth="2" /><ellipse cx={b[0] - 5} cy={b[1] - 14} rx="6" ry="3" fill="#7CD67F" /><ellipse cx={b[0] + 5} cy={b[1] - 18} rx="6" ry="3" fill="#7CD67F" /></g>; })()}
      {lamp(P, 6, 3.6, 0.5, 150, '#FFE7B8', 0.25)}
    </g>
  );
}

const VIG = [
  { k: 'Educação', t: 'Acesso ao conhecimento e a novas oportunidades.', c: '#9BE36D' },
  { k: 'Saúde', t: 'Cuidado mais ágil, mais perto de quem precisa.', c: '#FF8FB1' },
  { k: 'Desenvolvimento regional', t: 'Negócios funcionando e uma região em movimento.', c: '#FFB86B' },
  { k: 'Sustentabilidade', t: 'Infraestrutura eficiente e responsabilidade com as próximas gerações.', c: '#5CE1C6' },
];
const STEP = 7500, IDLE = 15000;

export default function SceneImpact({ active }: { active: boolean }) {
  const [idx, setIdx] = useState(0);
  const [touch, setTouch] = useState(0);
  useEffect(() => { if (active) { setIdx(0); setTouch(0); } }, [active]);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => { if (touch) setTouch(0); else setIdx((i) => (i + 1) % VIG.length); }, touch ? IDLE : STEP);
    return () => clearTimeout(t);
  }, [active, idx, touch]);
  // a fibra que liga as quatro cenas, pelo chão em primeiro plano, subindo até cada ONT
  const fiber = `M-400 700 ${VIG.map((_, i) => { const a = iso(i)(W, D, 0), x = ox(i); return `C${x - 700} 700 ${x - 520} ${a[1] + 60} ${x - 260} ${a[1] + 50} S${x + 300} 690 ${x + 700} 700`; }).join(' ')} L${ox(3) + 1400} 700`;
  return (
    <div className="relative h-full overflow-hidden bg-[#05090F] text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_66%_46%,rgba(255,184,107,0.10),transparent_55%),radial-gradient(ellipse_at_70%_60%,rgba(47,89,134,0.35),transparent_65%)]" />
      <div className="absolute inset-0 transition-transform duration-[2600ms] ease-[cubic-bezier(.65,0,.35,1)] motion-reduce:transition-none" style={{ transform: `translateX(${-idx * SP}px)` }}>
        <svg viewBox={`0 0 ${SP * 4} 900`} width={SP * 4} height={900} className="absolute left-0 top-0" role="img" aria-label="Cenas ilustrativas: estudantes em sala de aula conectada, atendimento de saúde, comércio e escritórios em uma rua, e pessoas plantando uma árvore ao lado de um prédio com painéis solares">
          <defs><filter id="im-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22" /></filter><filter id="im-glow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="3" /></filter></defs>
          <g style={{ mixBlendMode: 'screen' }}>
            <path d={fiber} fill="none" stroke="#4FBBFF" strokeWidth="7" strokeOpacity=".35" filter="url(#im-glow)" />
            <path d={fiber} fill="none" stroke="#CFF0FF" strokeWidth="1.6" />
            {[0, 1, 2, 3, 4, 5].map((o) => <path key={o} d={fiber} pathLength={600} stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" strokeDasharray="4 596" className="pol-run" style={{ ['--t' as string]: '9s', animationDelay: `${-o * 1.5}s` }} />)}
          </g>
          <Education /><Health /><City /><Nature />
        </svg>
      </div>
      <Particles n={30} warm />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,9,15,0.95)_0%,rgba(5,9,15,0.7)_34%,rgba(5,9,15,0)_56%)]" />
      <h1 className="cine-rise absolute left-[90px] top-[110px] w-[600px] font-display text-[38px] font-extrabold leading-[1.16]">Por trás de cada conexão, <span className="text-[#9CC4EA]">existe uma vida em movimento.</span></h1>
      <p className="cine-rise absolute left-[90px] top-[290px] w-[500px] text-[20px] leading-[1.5] text-white/80" style={{ animationDelay: '.8s' }}>Nossa tecnologia não termina nos equipamentos. Ela encontra seu propósito na vida das pessoas.</p>
      {/* legenda da cena atual */}
      <div className="absolute left-[90px] top-[560px] h-[110px] w-[460px]" aria-live="polite">
        {VIG.map((v, i) => (
          <div key={v.k} aria-hidden={i !== idx} className="absolute inset-0 transition-[opacity,transform] duration-700 motion-reduce:transition-none" style={{ opacity: i === idx ? 1 : 0, transform: i === idx ? 'none' : 'translateY(10px)', transitionDelay: i === idx ? '1.4s' : '0s' }}>
            <p className="flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-[0.2em]" style={{ color: v.c }}><span className="h-px w-8" style={{ background: v.c }} />{v.k}</p>
            <p className="mt-2 text-[24px] font-semibold leading-snug text-white">{v.t}</p>
          </div>
        ))}
      </div>
      <div className="absolute bottom-[52px] left-[90px] flex gap-2" role="group" aria-label="Cenas">
        {VIG.map((v, i) => <button key={v.k} type="button" aria-pressed={i === idx} aria-label={v.k} onClick={() => { setIdx(i); setTouch((n) => n + 1); }} className={clsx('h-1.5 transition-all duration-500', i === idx ? 'w-12' : 'w-6 bg-white/25 hover:bg-white/50')} style={i === idx ? { background: v.c } : undefined} />)}
      </div>
      <p className="absolute bottom-[46px] right-[60px] text-[11px] text-white/40">Cenas ilustrativas de possibilidades de impacto.</p>
    </div>
  );
}
