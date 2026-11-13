/**
 * Slide "Rede POL" da apresentação institucional: o MESMO prédio de vidro à noite (perspectiva de 2 pontos, verticais
 * retas como foto de arquitetura) com duas camadas de infraestrutura sobre ele:
 *  - L-trad: LAN tradicional (rack central, prumada de cobre, rack com switch e energia em cada andar, um cabo por ponto);
 *  - L-pol: rede óptica passiva (OLT, prumada de fibra, splitter passivo por andar, ONT nos mesmos pontos).
 * A troca entre as duas é feita só por CSS, pelo atributo data-mode ("trad" | "pol") num ancestral: cada elemento tem
 * --in (atraso ao entrar) e --out (atraso ao sair), e assim a transição de ~3 s roda nos dois sentidos sem trocar de cena.
 * Gera o SVG como texto (palco de 1600 × 900); classes em styles/index.css (pol-* da cena, nx-* da transição).
 */

export type PolCallout = { mode: NetMode; top: number; title: string; text: string };

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
const T = 3.4, TC = 4.4;          // período dos pulsos de luz (fibra) e de dados no cobre
export type NetMode = 'trad' | 'pol';

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
        g += mirror ? `<g opacity=".7">${row}</g>` : row;
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


  /* ================= infraestrutura (camadas sobre o mesmo prédio) ================= */
  const RX = X0 + 5, RY = Y0 + 4;                        // prumada no núcleo, perto da quina
  const PTS: [number, number][] = [[X0 + 14, Y0 + 0.8], [X1 - 4, Y0 + 0.8], [X0 + 0.8, Y1 - 4]]; // pontos atendidos por andar
  const OLT: V3 = [RX, RY, 0.6];
  const zn = (k: number) => zf(k) + 0.25;               // altura das bandejas no andar k
  const tm = (inn: number, out: number, dur?: number) => `--in:${inn.toFixed(2)}s;--out:${out.toFixed(2)}s${dur ? `;--dur:${dur}s` : ''}`;
  const route = (k: number, xo: number, yo: number, d = 0): V3[] => {
    const z = zn(k);
    return xo < RX + 1 ? [[RX + d, RY, z], [RX + d, yo + d, z], [xo, yo + d, z]] : [[RX, RY + d, z], [xo + d, RY + d, z], [xo + d, yo, z]];
  };
  // traço que "se desenha" ao entrar e se recolhe ao sair (stroke-dashoffset)
  const seg = (d: string, w: number, c: string, o: number, inn: number, out: number, dur = 0.7) =>
    `<path d="${d}" pathLength="100" class="nx nx-line" style="${tm(inn, out, dur)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-opacity="${o}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const run = (d: string, len: number, dash: string, w: number, c: string, per: number, phase: number) =>
    `<path d="${d}" pathLength="${len}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" fill="none" stroke-dasharray="${dash}" class="pol-run" style="--t:${per}s;animation-delay:${phase.toFixed(2)}s"/>`;
  const ping = (p: [number, number], r: number, c: string, per: number, delay: number) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${r}" fill="none" stroke="${c}" stroke-width="1.1" class="pol-ping" style="--t:${per}s;animation-delay:${delay.toFixed(2)}s"/>`;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    `<polygon points="${q([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]])}" fill="#141A22" stroke="#7D8794" stroke-width=".8"/>` +
    `<polygon points="${q([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]])}" fill="#1E2630" stroke="#A3ADB9" stroke-width=".8"/>`;
  const leds = (x0: number, x1: number, y: number, z0: number, z1: number, rows: number) => {
    let g = '';
    for (let r = 0; r < rows; r++) for (let n = 0; n < 4; n++) {
      const p = P(x0 + ((n + 0.6) * (x1 - x0)) / 4.4, y, z1 - ((r + 0.7) * (z1 - z0)) / (rows + 0.4));
      g += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="1" fill="#7CFFB2" class="pol-blink" style="animation-delay:${((r * 4 + n) * 0.37) % 2.4}s"/>`;
    }
    return g;
  };
  const bolt = (p: [number, number]) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="6.5" fill="#2A2006" stroke="#FFD24A" stroke-width="1.1"/><path d="M${f1(p[0] + 0.8)} ${f1(p[1] - 4)} L${f1(p[0] - 2.2)} ${f1(p[1] + 0.6)} L${f1(p[0] + 0.2)} ${f1(p[1] + 0.6)} L${f1(p[0] - 0.8)} ${f1(p[1] + 4)} L${f1(p[0] + 2.2)} ${f1(p[1] - 0.6)} L${f1(p[0] - 0.2)} ${f1(p[1] - 0.6)} Z" fill="#FFD24A"/>`;

  /* comum às duas redes: a fibra da operadora chega da rua à sala técnica */
  const backbone = pth([[X0 - 10, Y0 - 10, 0.05], [RX, Y0 - 10, 0.05], [RX, RY, 0.05], OLT]);
  s += `<g class="pol-in" style="animation-delay:.4s;mix-blend-mode:screen"><path d="${backbone}" fill="none" stroke="#4FBBFF" stroke-width="6" stroke-opacity=".45" filter="url(#pol-glow)"/><path d="${backbone}" fill="none" stroke="#CFF0FF" stroke-width="1.8" stroke-linejoin="round"/>${run(backbone, 100, '5 95', 2.6, '#fff', T, 0)}</g>`;

  /* ---------- camada REDE TRADICIONAL (cobre + switches de andar + energia) ---------- */
  const CU = '#FF8A3D', CUG = '#C8571B', PW = '#FFD24A';
  let tg = '', tl = '', tp = '', tn = '';
  const coreTop = 2.3, riserTop = zf(NF) + 1.2;
  for (const dx of [-0.36, -0.12, 0.12, 0.36]) {
    const r = pth([[RX + dx, RY, coreTop], [RX + dx, RY, riserTop]]);
    tl += seg(r, 1.3, CU, 0.95, 1.2, 1.0, 0.8);
    if (dx === -0.12) tp += run(r, 100, '3 97', 2.6, '#FFE0C2', TC, 0);
  }
  tg += seg(pth([[RX, RY, coreTop], [RX, RY, riserTop]]), 9, CUG, 0.5, 1.2, 1.0, 0.8);
  for (let k = 1; k <= NF; k++) {
    const z = zf(k), up = (NF - k) * 0.04;
    // cabeamento horizontal: um cabo por ponto (feixe de 3 por rota)
    for (const [xo, yo] of PTS) {
      tg += seg(pth(route(k, xo, yo)), 6, CUG, 0.35, 1.6 + k * 0.06, 0.1 + up, 0.6);
      for (const d of [-0.32, 0, 0.32]) tl += seg(pth(route(k, xo, yo, d)), 0.9, CU, 0.85, 1.6 + k * 0.06, 0.1 + up, 0.6);
      tp += run(pth(route(k, xo, yo)), 200, '7 193', 1.8, '#FFE0C2', TC, (k * 0.37) % TC);
      const e = P(xo, yo, zn(k));
      tn += `<g class="nx nx-pop" style="${tm(2.0 + k * 0.06, 0.05 + up)}"><rect x="${f1(e[0] - 3)}" y="${f1(e[1] - 3)}" width="6" height="6" fill="#2A1406" stroke="${CU}" stroke-width="1.3"/></g>`;
    }
    // rack com switch de acesso no andar (ativo) + cabo de energia até a tomada
    const rx0 = RX - 0.5, rx1 = RX + 0.5, ry0 = RY - 0.4, ry1 = RY + 0.4, rz0 = z + 0.12, rz1 = z + 1.75;
    const cord = pth([[rx0, RY, z + 0.5], [rx0 - 2.2, RY, z + 0.5], [rx0 - 2.2, RY, z + 0.15]]);
    tl += seg(cord, 1.4, PW, 0.95, 1.7 + k * 0.06, 0.3 + up, 0.5);
    tp += run(cord, 100, '8 92', 2.2, '#FFF4C2', 1.6, -(k * 0.29) % 1.6);
    const out = P(rx0 - 2.2, RY, z + 0.15);
    tn += `<g class="nx nx-pop" style="${tm(1.4 + k * 0.06, 0.6 + up)}">${box(rx0, rx1, ry0, ry1, rz0, rz1)}${leds(rx0, rx1, ry0, rz0, rz1, 3)}${bolt(P(rx1 + 0.2, ry0, rz1 + 0.6))}<rect x="${f1(out[0] - 2.5)}" y="${f1(out[1] - 2.5)}" width="5" height="5" fill="${PW}"/></g>`;
    // pontos que pedem manutenção/substituição (ventilação, fonte, troca de switch)
    if (k === 3 || k === 7 || k === 10) { const c = P(RX, ry0, (rz0 + rz1) / 2); tn += `<g class="nx nx-fade" style="${tm(2.6, 0)}">${ping(c, 9, '#FFB020', 2.8, k * 0.4)}${ping(c, 9, '#FFB020', 2.8, k * 0.4 + 1.4)}</g>`; }
  }
  // rack central (core) na sala técnica
  tn += `<g class="nx nx-pop" style="${tm(1.2, 1.0)}">${box(RX - 1.1, RX + 1.1, RY - 0.6, RY + 0.6, 0.1, coreTop)}${leds(RX - 1.1, RX + 1.1, RY - 0.6, 0.1, coreTop, 5)}${bolt(P(RX + 1.3, RY - 0.6, coreTop + 0.6))}</g>`;
  s += `<g class="L-trad pol-in" style="animation-delay:.6s"><g style="mix-blend-mode:screen"><g filter="url(#pol-glow)">${tg}</g>${tl}<g class="nx nx-fade" style="${tm(2.6, 0)}">${tp}</g></g>${tn}</g>`;

  /* ---------- camada REDE POL (fibra + splitters passivos + ONTs nos mesmos pontos) ---------- */
  let pg = '', pl = '', pp = '', pn = '';
  const riser = pth([OLT, [RX, RY, zf(NF) + 1]]);
  pg += seg(riser, 8, '#4FBBFF', 0.55, 1.2, 0.9, 0.8);
  pl += seg(riser, 2.2, '#EAF8FF', 1, 1.2, 0.9, 0.8);
  for (const o of [0, 1, 2]) pp += run(riser, 100, '3 97', 3, '#fff', T, (-o * T) / 3);
  for (let k = 1; k <= NF; k++) {
    const tf = (zf(k) / zf(NF)) * T, up = (NF - k) * 0.04;
    for (const [xo, yo] of PTS) {
      const br = pth(route(k, xo, yo));
      pg += seg(br, 4, '#4FBBFF', 0.28, 1.6 + k * 0.06, 0.2 + up, 0.6);
      pl += seg(br, 1, '#BFE8FF', 0.6, 1.6 + k * 0.06, 0.2 + up, 0.6);
      for (const o of [0, 1, 2]) pp += run(br, 200, '7 193', 2, '#fff', T, tf - (o * T) / 3);
      const p = P(xo, yo, zn(k));
      pn += `<g class="nx nx-pop" style="${tm(2.0 + k * 0.06, 0.1 + up)}"><circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="9" fill="url(#pol-halo)"/><circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="2.6" fill="#fff"/>${[0, 1, 2].map((o) => ping(p, 4, '#8FD6FF', T, tf + T / 2 - (o * T) / 3)).join('')}</g>`;
    }
    const sp = P(RX, RY, zn(k));
    pn += `<g class="nx nx-pop" style="${tm(1.9 + k * 0.06, 0.1 + up)}"><circle cx="${f1(sp[0])}" cy="${f1(sp[1])}" r="13" fill="url(#pol-halo)"/><rect x="${f1(sp[0] - 3.6)}" y="${f1(sp[1] - 3.6)}" width="7.2" height="7.2" transform="rotate(45 ${f1(sp[0])} ${f1(sp[1])})" fill="#0B121A" stroke="#EAF8FF" stroke-width="1.4"/>${[0, 1, 2].map((o) => ping(sp, 5, '#EAF8FF', T, tf - (o * T) / 3)).join('')}</g>`;
  }
  const op = P(...OLT);
  pn += `<g class="nx nx-pop" style="${tm(1.2, 0.9)}"><circle cx="${f1(op[0])}" cy="${f1(op[1])}" r="30" fill="url(#pol-halo)"/><rect x="${f1(op[0] - 9)}" y="${f1(op[1] - 6)}" width="18" height="12" rx="2" fill="#0B1A2A" stroke="#EAF8FF" stroke-width="1.4"/>${[0, 1, 2, 3].map((n) => `<circle cx="${f1(op[0] - 5 + n * 3.4)}" cy="${f1(op[1] + 2)}" r="1.1" fill="#7CFFB2" class="pol-blink" style="animation-delay:${n * 0.3}s"/>`).join('')}</g>`;
  s += `<g class="L-pol pol-in" style="animation-delay:.6s"><g style="mix-blend-mode:screen"><g filter="url(#pol-glow)">${pg}</g>${pl}<g class="nx nx-fade" style="${tm(2.6, 0)}">${pp}</g></g>${pn}</g>`;

  /* legendas: haste do elemento até o cartão à direita (uma trinca por rede) */
  const top = P(...PTS[1]!, zn(NF)), mid = P(RX, RY, zn(6)), rackMid = P(RX - 0.5, RY - 0.4, zf(6) + 1);
  const callouts: PolCallout[] = [
    { mode: 'trad', top: 120, title: 'Ponto de rede (RJ45)', text: 'Um cabo de cobre por ponto, até 100 m do switch.' },
    { mode: 'trad', top: 400, title: 'Switch de andar', text: 'Ativo em rack, com energia, ventilação e manutenção.' },
    { mode: 'trad', top: 690, title: 'Rack central', text: 'Núcleo da rede na sala técnica, no térreo.' },
    { mode: 'pol', top: 120, title: 'ONT no ponto de uso', text: 'Dados, voz, Wi-Fi e CFTV em cada sala.' },
    { mode: 'pol', top: 400, title: 'Splitter óptico', text: 'Divide a luz para o andar, sem energia elétrica.' },
    { mode: 'pol', top: 690, title: 'OLT · sala técnica', text: 'O único equipamento ativo da distribuição, no térreo.' },
  ];
  const anchors: Record<NetMode, [number, number][]> = { trad: [top, rackMid, P(RX - 1.1, RY - 0.6, 1.2)], pol: [top, mid, op] };
  for (const mode of ['trad', 'pol'] as const) {
    let g = '';
    anchors[mode].forEach((a, n) => {
      const ly = [120, 400, 690][n]! + 34;
      g += `<path d="M${f1(a[0])} ${f1(a[1])} L${f1(a[0] + 20)} ${ly} L${POL_CALLOUT_X} ${ly}" fill="none" stroke="#8FD6FF" stroke-opacity=".6" stroke-width="1"/><circle cx="${f1(a[0])}" cy="${f1(a[1])}" r="7" fill="none" stroke="#8FD6FF" stroke-opacity=".6"/>`;
    });
    s += `<g class="L-${mode}"><g class="nx nx-fade" style="${tm(2.4, 0)}">${g}</g></g>`;
  }
  return { svg: s, callouts };
}
