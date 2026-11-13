/**
 * Slide "Rede POL" da apresentação institucional: prédio de vidro à noite, em perspectiva de 2 pontos
 * (verticais retas, como foto de arquitetura), com a rede óptica passiva desenhada em "raio-x".
 * Entrada: a fibra chega da rua à OLT no térreo, sobe pela prumada e, em cada andar, o splitter se abre até as
 * ONTs e as janelas daquele andar acendem. Depois os pulsos de luz ficam em loop.
 * Gera o SVG como texto (palco de 1600 × 900); as animações são as classes pol-* de styles/index.css.
 */

export type PolCallout = { x: number; y: number; top: number; title: string; text: string; delay: number };

const TH = (32 * Math.PI) / 180, CO = Math.cos(TH), SI = Math.sin(TH);
const DIST = 95, CAMH = 7, F = 1100, CX0 = 1115, HZ = 612;
type V3 = [number, number, number];
const P = (x: number, y: number, z: number): [number, number] => { const u = x * CO - y * SI, v = x * SI + y * CO, Z = v + DIST; return [CX0 + (F * u) / Z, HZ - (F * (z - CAMH)) / Z]; };
const f1 = (n: number) => n.toFixed(1);
const q = (pts: V3[]) => pts.map((p) => P(...p).map(f1).join(',')).join(' ');
const pth = (pts: V3[]) => 'M' + pts.map((p) => P(...p).map(f1).join(' ')).join(' L');

/* prédio: 30 m × 18 m, térreo de 5,2 m + 11 andares de 3,5 m */
const W = 30, D = 18, X0 = -W / 2, X1 = W / 2, Y0 = -D / 2, Y1 = D / 2;
const LOBBY = 5.2, FL = 3.5, NF = 11, H = LOBBY + NF * FL;
const zf = (k: number) => (k === 0 ? 0 : LOBBY + (k - 1) * FL);
const INTRO = 1.4, RISE = 2.6, T = 3.4;
const arrive = (k: number) => INTRO + 0.9 + RISE * (zf(k) / zf(NF));
const START = INTRO + 0.9 + RISE + 0.6; // os pulsos em loop começam depois da entrada

export const POL_CALLOUT_X = 1360;

export function buildPolScene(): { svg: string; callouts: PolCallout[] } {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let s = `<defs>
 <linearGradient id="pol-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03070D"/><stop offset=".55" stop-color="#0B1A2C"/><stop offset=".68" stop-color="#1D3654"/><stop offset=".72" stop-color="#2B4766"/><stop offset="1" stop-color="#05090F"/></linearGradient>
 <radialGradient id="pol-cityglow" cx=".72" cy=".68" r=".5"><stop offset="0" stop-color="#3E6E9E" stop-opacity=".55"/><stop offset="1" stop-color="#3E6E9E" stop-opacity="0"/></radialGradient>
 <linearGradient id="pol-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E1B2A"/><stop offset="1" stop-color="#04070C"/></linearGradient>
 <linearGradient id="pol-glassR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2C4A6B"/><stop offset=".5" stop-color="#16283D"/><stop offset="1" stop-color="#0D1826"/></linearGradient>
 <linearGradient id="pol-glassL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A2E46"/><stop offset=".5" stop-color="#0D1A2A"/><stop offset="1" stop-color="#08111C"/></linearGradient>
 <linearGradient id="pol-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset=".25" stop-color="#BFE6FF" stop-opacity="0"/><stop offset=".45" stop-color="#BFE6FF" stop-opacity=".10"/><stop offset=".55" stop-color="#BFE6FF" stop-opacity="0"/><stop offset=".7" stop-color="#BFE6FF" stop-opacity=".05"/><stop offset=".78" stop-color="#BFE6FF" stop-opacity="0"/></linearGradient>
 <linearGradient id="pol-warm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE9C4"/><stop offset="1" stop-color="#E9B87A"/></linearGradient>
 <linearGradient id="pol-cool" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E6F4FF"/><stop offset="1" stop-color="#9FC4E6"/></linearGradient>
 <linearGradient id="pol-lobby" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1D6"/><stop offset="1" stop-color="#C99A5E"/></linearGradient>
 <linearGradient id="pol-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <mask id="pol-refl"><rect x="0" y="${HZ}" width="1600" height="${900 - HZ}" fill="url(#pol-fade)"/></mask>
 <radialGradient id="pol-halo"><stop offset="0" stop-color="#4FBBFF" stop-opacity=".6"/><stop offset="1" stop-color="#4FBBFF" stop-opacity="0"/></radialGradient>
 <filter id="pol-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5"/></filter>
 <filter id="pol-blur1"><feGaussianBlur stdDeviation="1.1"/></filter>
 <filter id="pol-blur6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
 <filter id="pol-bloom" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;

  /* céu, estrelas e brilho da cidade */
  s += `<rect width="1600" height="900" fill="url(#pol-sky)"/><rect width="1600" height="900" fill="url(#pol-cityglow)"/>`;
  for (let i = 0; i < 90; i++) s += `<circle cx="${f1(rnd() * 1600)}" cy="${f1(rnd() * 420)}" r="${f1(0.4 + rnd() * 0.8)}" fill="#fff" opacity="${(0.15 + rnd() * 0.5).toFixed(2)}"/>`;

  /* skyline distante, desfocada, com janelas pontuais */
  let sky = '', dots = '';
  for (let x = 560; x < 1640;) {
    const w = 22 + rnd() * 46, h = 18 + Math.pow(rnd(), 1.6) * 120, y = HZ + 2 - h;
    sky += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h + 4)}"/>`;
    for (let wy = y + 5; wy < HZ - 4; wy += 6) for (let wx = x + 4; wx < x + w - 3; wx += 5) if (rnd() < 0.16) dots += `<rect x="${f1(wx)}" y="${f1(wy)}" width="1.6" height="2" fill="${rnd() < 0.6 ? '#F3D29B' : '#BFDDF5'}" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
    x += w + rnd() * 8;
  }
  s += `<g filter="url(#pol-blur1)" class="pol-in"><g fill="#0A1522">${sky}</g>${dots}</g>`;
  s += `<rect x="0" y="${HZ - 40}" width="1600" height="60" fill="#2B4766" opacity=".25" filter="url(#pol-blur6)"/>`;
  s += `<rect x="0" y="${HZ}" width="1600" height="${900 - HZ}" fill="url(#pol-ground)"/>`;

  /* fachadas visíveis: esquerda (x = X0) e direita (y = Y0) */
  const faces: { a: [number, number]; b: [number, number]; bays: number; fill: string; k: number }[] = [
    { a: [X0, Y1], b: [X0, Y0], bays: 6, fill: 'url(#pol-glassL)', k: 0.55 },
    { a: [X0, Y0], b: [X1, Y0], bays: 10, fill: 'url(#pol-glassR)', k: 1 },
  ];
  const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const building = (mirror: boolean) => {
    const zz = (z: number) => (mirror ? -z : z);
    let g = '';
    for (const fc of faces) {
      const A = fc.a, B = fc.b;
      g += `<polygon points="${q([[...A, zz(0)], [...B, zz(0)], [...B, zz(H)], [...A, zz(H)]])}" fill="${fc.fill}"/>`;
      g += `<polygon points="${q([[...A, zz(0.2)], [...B, zz(0.2)], [...B, zz(LOBBY - 0.5)], [...A, zz(LOBBY - 0.5)]])}" fill="url(#pol-lobby)" opacity="${(0.55 * fc.k).toFixed(2)}"/>`;
      for (let k = 1; k <= NF; k++) {
        const z0 = zf(k) + 0.95, z1 = zf(k) + FL - 0.12;
        let row = '';
        for (let i = 0; i < fc.bays; i++) {
          const r = rnd(), p0 = lerp(A, B, (i + 0.04) / fc.bays), p1 = lerp(A, B, (i + 0.96) / fc.bays);
          const lit = r < 0.5, warm = rnd() < 0.6, o = lit ? (0.3 + rnd() * 0.55) * fc.k : 0.04;
          row += `<polygon points="${q([[...p0, zz(z0)], [...p1, zz(z0)], [...p1, zz(z1)], [...p0, zz(z1)]])}" fill="url(#pol-${warm ? 'warm' : 'cool'})" opacity="${o.toFixed(2)}"/>`;
        }
        // o andar acende quando a fibra chega a ele
        g += mirror ? `<g opacity=".7">${row}</g>` : `<g class="pol-on" style="--o0:.12;--o1:1;animation-delay:${arrive(k).toFixed(2)}s">${row}</g>`;
        g += `<polygon points="${q([[...A, zz(zf(k))], [...B, zz(zf(k))], [...B, zz(zf(k) + 0.95)], [...A, zz(zf(k) + 0.95)]])}" fill="#0A131E"/>`;
        if (!mirror) g += `<path d="${pth([[...A, zf(k) + 0.95], [...B, zf(k) + 0.95]])}" stroke="#6E93B5" stroke-opacity=".35" stroke-width=".8" fill="none"/>`;
      }
      for (let i = 0; i <= fc.bays; i++) { const p = lerp(A, B, i / fc.bays); g += `<path d="${pth([[...p, zz(0)], [...p, zz(H)]])}" stroke="#05090F" stroke-opacity=".85" stroke-width="1.3" fill="none"/>`; }
      if (!mirror) g += `<polygon points="${q([[...A, 0], [...B, 0], [...B, H], [...A, H]])}" fill="url(#pol-sheen)"/>`;
    }
    g += `<polygon points="${q([[X0, Y1, zz(H)], [X0, Y0, zz(H)], [X1, Y0, zz(H)], [X1, Y0, zz(H + 1.6)], [X0, Y0, zz(H + 1.6)], [X0, Y1, zz(H + 1.6)]])}" fill="#0B141F"/>`;
    if (!mirror) {
      g += `<path d="${pth([[X0, Y1, H + 1.6], [X0, Y0, H + 1.6], [X1, Y0, H + 1.6]])}" stroke="#8FD6FF" stroke-width="1.6" fill="none" filter="url(#pol-bloom)" opacity=".9"/>`;
      g += `<path d="${pth([[X0, Y0, 0], [X0, Y0, H + 1.6]])}" stroke="#9FC4E6" stroke-opacity=".55" stroke-width="1.2" fill="none"/>`;
    }
    return g;
  };
  s += `<g mask="url(#pol-refl)" filter="url(#pol-blur6)" opacity=".55">${building(true)}</g>`;
  seed = 1007;
  s += `<g class="pol-in">${building(false)}</g>`;
  const m0 = P(X0 + 4, Y0 + 4, H + 1.6), m1 = P(X0 + 4, Y0 + 4, H + 8);
  s += `<path d="M${f1(m0[0])} ${f1(m0[1])} L${f1(m1[0])} ${f1(m1[1])}" stroke="#5E7A96" stroke-width="1.4"/><circle cx="${f1(m1[0])}" cy="${f1(m1[1])}" r="2.6" fill="#FF4D4D" class="pol-blink" filter="url(#pol-bloom)"/>`;

  /* rede POL em "raio-x": backbone → OLT → prumada → splitter por andar → ONTs junto às fachadas */
  const RX = X0 + 5, RY = Y0 + 4;
  const ONTS: [number, number][] = [[X0 + 14, Y0 + 0.8], [X1 - 4, Y0 + 0.8], [X0 + 0.8, Y1 - 4]];
  const OLT: V3 = [RX, RY, 0.6];
  const line = (d: string, w: number, c: string, o: number, extra = '') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-opacity="${o}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const drawn = (d: string, w: number, c: string, o: number, delay: number, dur: number) => line(d, w, c, o, `pathLength="100" class="pol-draw" style="--d:${dur}s;animation-delay:${delay.toFixed(2)}s"`);
  const pulse = (d: string, len: number, dash: string, w: number, phase: number) => `<path d="${d}" pathLength="${len}" stroke="#fff" stroke-width="${w}" stroke-linecap="round" fill="none" stroke-dasharray="${dash}" class="pol-run" style="--t:${T}s;animation-delay:${(START + phase).toFixed(2)}s,${START}s"/>`;
  const ping = (p: [number, number], r: number, c: string, delay: number) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${r}" fill="none" stroke="${c}" stroke-width="1.1" class="pol-ping" style="--t:${T}s;animation-delay:${delay.toFixed(2)}s"/>`;
  let glow = '', net = '', pulses = '', nodes = '';
  const backbone = pth([[X0 - 10, Y0 - 10, 0.05], [RX, Y0 - 10, 0.05], [RX, RY, 0.05], OLT]);
  const riser = pth([OLT, [RX, RY, zf(NF) + 1]]);
  glow += drawn(backbone, 6, '#4FBBFF', 0.5, INTRO - 0.4, 1.3) + drawn(riser, 8, '#4FBBFF', 0.55, INTRO + 0.9, RISE);
  net += drawn(backbone, 1.8, '#CFF0FF', 1, INTRO - 0.4, 1.3) + drawn(riser, 2.2, '#EAF8FF', 1, INTRO + 0.9, RISE);
  pulses += pulse(backbone, 100, '5 95', 2.6, 0);
  for (const o of [0, 1, 2]) pulses += pulse(riser, 100, '3 97', 3, (-o * T) / 3);
  for (let k = 1; k <= NF; k++) {
    const z = zf(k) + 0.25, t0 = arrive(k), tf = (zf(k) / zf(NF)) * T;
    for (const [xo, yo] of ONTS) {
      const br = pth(xo < RX + 1 ? [[RX, RY, z], [RX, yo, z], [xo, yo, z]] : [[RX, RY, z], [xo, RY, z], [xo, yo, z]]);
      glow += drawn(br, 4, '#4FBBFF', 0.28, t0, 0.9);
      net += drawn(br, 1, '#BFE8FF', 0.6, t0, 0.9);
      for (const o of [0, 1, 2]) pulses += pulse(br, 200, '7 193', 2, tf - (o * T) / 3);
      const p = P(xo, yo, z);
      nodes += `<g class="pol-in" style="animation-delay:${(t0 + 0.8).toFixed(2)}s"><circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="9" fill="url(#pol-halo)"/><circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="2.6" fill="#fff"/></g>`;
      for (const o of [0, 1, 2]) nodes += ping(p, 4, '#8FD6FF', START + tf + T / 2 - (o * T) / 3);
    }
    const sp = P(RX, RY, z);
    nodes += `<g class="pol-in" style="animation-delay:${t0.toFixed(2)}s"><circle cx="${f1(sp[0])}" cy="${f1(sp[1])}" r="13" fill="url(#pol-halo)"/><rect x="${f1(sp[0] - 3.6)}" y="${f1(sp[1] - 3.6)}" width="7.2" height="7.2" transform="rotate(45 ${f1(sp[0])} ${f1(sp[1])})" fill="#0B121A" stroke="#EAF8FF" stroke-width="1.4"/></g>`;
    for (const o of [0, 1, 2]) nodes += ping(sp, 5, '#EAF8FF', START + tf - (o * T) / 3);
  }
  const op = P(...OLT);
  nodes += `<g class="pol-in" style="animation-delay:${INTRO + 0.6}s"><circle cx="${f1(op[0])}" cy="${f1(op[1])}" r="30" fill="url(#pol-halo)"/><rect x="${f1(op[0] - 9)}" y="${f1(op[1] - 6)}" width="18" height="12" rx="2" fill="#0B1A2A" stroke="#EAF8FF" stroke-width="1.4"/>${[0, 1, 2, 3].map((n) => `<circle cx="${f1(op[0] - 5 + n * 3.4)}" cy="${f1(op[1] + 2)}" r="1.1" fill="#7CFFB2" class="pol-blink" style="animation-delay:${n * 0.3}s"/>`).join('')}</g>`;
  s += `<g style="mix-blend-mode:screen"><g filter="url(#pol-glow)">${glow}</g>${net}${pulses}</g>${nodes}`;

  /* legendas: haste do elemento até o cartão à direita */
  const ont = P(...ONTS[1]!, zf(NF) + 0.25), split = P(RX, RY, zf(6) + 0.25);
  const callouts: PolCallout[] = [
    { x: ont[0], y: ont[1], top: 120, title: 'ONT no ponto de uso', text: 'Dados, voz, Wi-Fi e CFTV em cada sala.', delay: arrive(NF) + 1 },
    { x: split[0], y: split[1], top: 400, title: 'Splitter óptico', text: 'Divide a luz para o andar, sem energia elétrica.', delay: arrive(6) + 0.6 },
    { x: op[0], y: op[1], top: 690, title: 'OLT · sala técnica', text: 'O único equipamento ativo da rede, no térreo.', delay: INTRO + 0.8 },
  ];
  for (const c of callouts) {
    const ly = c.top + 34;
    s += `<g class="pol-in" style="animation-delay:${c.delay.toFixed(2)}s"><path d="M${f1(c.x)} ${f1(c.y)} L${f1(c.x + 20)} ${ly} L${POL_CALLOUT_X} ${ly}" fill="none" stroke="#8FD6FF" stroke-opacity=".6" stroke-width="1"/><circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="7" fill="none" stroke="#8FD6FF" stroke-opacity=".6"/></g>`;
  }
  return { svg: s, callouts };
}
