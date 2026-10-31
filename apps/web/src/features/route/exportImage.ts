/**
 * Imagem do traçado (PNG) para anexar no chamado de viabilidade: mapa com a rota, a CTO, o cliente e as metragens
 * por trecho, e abaixo o quadro com endereço, coordenadas, CTO, porta, metragem, sobra e total.
 * Desenhada direto em canvas (projeção Web Mercator, mesmos tiles do mapa), sem captura de tela.
 * Se o fundo não puder ser desenhado (tile sem CORS ou fora do ar), a imagem sai sem fundo, com o traçado e o quadro.
 */
import { fmtLatLng, fmtMeters, segmentLengthsM, type LatLng, type NetFeature } from '@isp/domain';
import { BASES, COLORS, type BaseKind } from './mapBase';

export type RouteImageInput = {
  base: BaseKind;
  route: LatLng[];
  client: LatLng;
  cto: { name: string | null; at: LatLng | null };
  network: NetFeature[];
  info: { title: string; address: string | null; port: string | null; lengthM: number; slackM: number; notes: string | null; author: string; app: string };
};

const W = 1280;
const MAP_H = 820;
const TILE = 256;

const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

function loadImage(url: string, ms = 9000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => resolve(null), ms);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}

/** Zoom mais próximo em que todos os pontos cabem na área do mapa com margem. */
function fitZoom(pts: LatLng[]): number {
  for (let z = 19; z >= 3; z--) {
    const xs = pts.map((p) => worldX(p[1], z));
    const ys = pts.map((p) => worldY(p[0], z));
    if (Math.max(...xs) - Math.min(...xs) <= W * 0.7 && Math.max(...ys) - Math.min(...ys) <= MAP_H * 0.68) return z;
  }
  return 3;
}

async function render(i: RouteImageInput, withTiles: boolean): Promise<HTMLCanvasElement> {
  const pts = [...i.route, i.client, ...(i.cto.at ? [i.cto.at] : [])];
  const z = fitZoom(pts);
  const cx = (Math.min(...pts.map((p) => worldX(p[1], z))) + Math.max(...pts.map((p) => worldX(p[1], z)))) / 2;
  const cy = (Math.min(...pts.map((p) => worldY(p[0], z))) + Math.max(...pts.map((p) => worldY(p[0], z)))) / 2;
  const ox = cx - W / 2;
  const oy = cy - MAP_H / 2;
  const px = (p: LatLng): [number, number] => [worldX(p[1], z) - ox, worldY(p[0], z) - oy];

  const notesLines = i.info.notes ? wrapCount(i.info.notes, 150) : 0;
  // quadro: título + 4 linhas de dados (262 px), observações (título + linhas) e rodapé
  const H = MAP_H + 262 + (notesLines ? 34 + notesLines * 22 : 0) + 46;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1F2937'; g.fillRect(0, 0, W, MAP_H);

  // fundo
  let tilesOk = false;
  if (withTiles) {
    const n = 2 ** z;
    // desenha na ordem (fundo antes das camadas de nomes): carrega tudo e pinta camada por camada
    const layers = await Promise.all(BASES[i.base].tiles.map(async (tpl) => {
      const tiles: { img: HTMLImageElement | null; x: number; y: number }[] = [];
      const loads: Promise<void>[] = [];
      for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++) {
        for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + MAP_H) / TILE); ty++) {
          if (ty < 0 || ty >= n) continue;
          const wx = ((tx % n) + n) % n;
          const url = tpl.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty));
          loads.push(loadImage(url).then((img) => { tiles.push({ img, x: tx * TILE - ox, y: ty * TILE - oy }); }));
        }
      }
      await Promise.all(loads);
      return tiles;
    }));
    for (const layer of layers) for (const t of layer) if (t.img) { g.drawImage(t.img, t.x, t.y, TILE, TILE); tilesOk = true; }
  }
  if (!tilesOk) {
    g.fillStyle = '#E5E7EB'; g.fillRect(0, 0, W, MAP_H);
    g.strokeStyle = '#D1D5DB'; g.lineWidth = 1;
    for (let x = 0; x < W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, MAP_H); g.stroke(); }
    for (let y = 0; y < MAP_H; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }

  // rede próxima (áreas, cabos, CTOs) só dentro do quadro
  const inView = ([x, y]: [number, number]) => x > -50 && x < W + 50 && y > -50 && y < MAP_H + 50;
  g.save();
  g.beginPath(); g.rect(0, 0, W, MAP_H); g.clip();
  for (const f of i.network) {
    if (f.kind !== 'area') continue;
    const ring = f.ring.map(px);
    if (!ring.some(inView)) continue;
    g.beginPath(); ring.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.fillStyle = 'rgba(56,189,248,0.12)'; g.fill(); g.strokeStyle = COLORS.area; g.lineWidth = 1.5; g.stroke();
  }
  for (const f of i.network) {
    if (f.kind !== 'linha') continue;
    const path = f.path.map(px);
    if (!path.some(inView)) continue;
    g.beginPath(); path.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = COLORS.cable; g.lineWidth = 2.5; g.stroke();
  }
  const ctoKey = i.cto.at ? i.cto.at.join() : '';
  for (const f of i.network) {
    if (f.kind !== 'ponto' || f.at.join() === ctoKey) continue;
    const p = px(f.at);
    if (!inView(p)) continue;
    circle(g, p, 5, COLORS.cto, COLORS.ctoEdge, 1.5);
    label(g, f.name, p[0] + 8, p[1] - 6, 11, 'rgba(255,255,255,0.9)');
  }

  // traçado
  const route = i.route.map(px);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); route.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = COLORS.routeEdge; g.lineWidth = 10; g.stroke();
  g.beginPath(); route.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = COLORS.route; g.lineWidth = 5; g.stroke();
  for (const p of route.slice(1, -1)) circle(g, p, 4, '#FFFFFF', COLORS.routeEdge, 2);
  const segs = segmentLengthsM(i.route);
  if (segs.length <= 40) {
    segs.forEach((m, k) => {
      if (m < 8) return;
      const a = route[k]!; const b = route[k + 1]!;
      pill(g, `${Math.round(m)} m`, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    });
  }
  if (i.cto.at) { const p = px(i.cto.at); circle(g, p, 10, COLORS.cto, COLORS.ctoEdge, 3); label(g, i.cto.name ?? 'CTO', p[0] + 14, p[1] - 10, 15, '#FFFFFF'); }
  { const p = px(i.client); circle(g, p, 10, COLORS.client, COLORS.clientEdge, 3); label(g, 'Cliente', p[0] + 14, p[1] - 10, 15, '#FFFFFF'); }
  g.restore();

  // escala e norte
  const lat = i.client[0];
  const mPerPx = (156_543.033_92 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((m) => m / mPerPx >= 90) ?? 5000;
  const len = nice / mPerPx;
  g.fillStyle = 'rgba(255,255,255,0.88)'; roundRect(g, 16, MAP_H - 50, len + 70, 34, 6); g.fill();
  g.strokeStyle = '#111827'; g.lineWidth = 3; g.beginPath(); g.moveTo(26, MAP_H - 26); g.lineTo(26 + len, MAP_H - 26); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.moveTo(26, MAP_H - 32); g.lineTo(26, MAP_H - 20); g.moveTo(26 + len, MAP_H - 32); g.lineTo(26 + len, MAP_H - 20); g.stroke();
  g.fillStyle = '#111827'; g.font = '600 13px system-ui, sans-serif'; g.fillText(fmtMeters(nice), 34 + len, MAP_H - 22);
  g.fillStyle = 'rgba(255,255,255,0.88)'; roundRect(g, W - 56, 16, 40, 52, 6); g.fill();
  g.fillStyle = '#111827'; g.beginPath(); g.moveTo(W - 36, 24); g.lineTo(W - 46, 48); g.lineTo(W - 36, 42); g.lineTo(W - 26, 48); g.closePath(); g.fill();
  g.font = '700 12px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('N', W - 36, 62); g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '11px system-ui, sans-serif';
  g.fillText(tilesOk ? BASES[i.base].attribution : 'Fundo do mapa indisponível no momento da geração', W - g.measureText(tilesOk ? BASES[i.base].attribution : 'Fundo do mapa indisponível no momento da geração').width - 12, MAP_H - 8);

  // quadro de informações
  const y0 = MAP_H;
  g.fillStyle = '#FFFFFF'; g.fillRect(0, y0, W, H - y0);
  g.fillStyle = '#0A1A4F'; g.fillRect(0, y0, W, 6);
  g.fillStyle = '#0A1A4F'; g.font = '800 24px system-ui, sans-serif'; g.fillText(i.info.title, 28, y0 + 44);
  const total = i.info.lengthM + i.info.slackM;
  const left: [string, string][] = [
    ['Endereço', i.info.address || 'não informado'],
    ['Cliente', fmtLatLng(i.client)],
    ['CTO de origem', `${i.cto.name ?? 'não identificada'}${i.cto.at ? `  (${fmtLatLng(i.cto.at)})` : ''}`],
    ['Porta', i.info.port || 'a definir pela engenharia'],
  ];
  const right: [string, string][] = [
    ['Metragem traçada', fmtMeters(i.info.lengthM)],
    ['Sobra técnica', fmtMeters(i.info.slackM)],
    ['Total estimado de cabo', fmtMeters(total)],
  ];
  const row = (k: string, v: string, x: number, y: number, maxW: number, strong = false) => {
    g.fillStyle = '#5C6A8A'; g.font = '600 14px system-ui, sans-serif'; g.fillText(k, x, y);
    g.fillStyle = '#0A1A4F'; g.font = `${strong ? 800 : 600} ${strong ? 22 : 17}px system-ui, sans-serif`; g.fillText(clip(g, v, maxW), x, y + (strong ? 26 : 22));
  };
  left.forEach(([k, v], n) => row(k, v, 28, y0 + 78 + n * 44, 700));
  right.forEach(([k, v], n) => row(k, v, 820, y0 + 78 + n * 48, 430, n === 2));
  let yy = y0 + 78 + 4 * 44 + 8;
  if (i.info.notes) {
    g.fillStyle = '#5C6A8A'; g.font = '600 14px system-ui, sans-serif'; g.fillText('Observações', 28, yy);
    g.fillStyle = '#1E2949'; g.font = '15px system-ui, sans-serif';
    for (const l of wrap(i.info.notes, 150)) { yy += 22; g.fillText(l, 28, yy); }
    yy += 12;
  }
  g.fillStyle = '#808DA8'; g.font = '13px system-ui, sans-serif';
  g.fillText(`${i.info.app} · gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} por ${i.info.author} · metragem medida no mapa, confirme em campo`, 28, H - 18);
  return c;
}

/** Gera o PNG (data URL). Se o navegador bloquear o fundo (CORS), gera de novo sem ele. */
export async function routeImage(i: RouteImageInput): Promise<{ dataUrl: string; withMap: boolean }> {
  try {
    const c = await render(i, true);
    return { dataUrl: c.toDataURL('image/png'), withMap: true };
  } catch {
    const c = await render(i, false);
    return { dataUrl: c.toDataURL('image/png'), withMap: false };
  }
}

// ------------------------------------------------------------------ desenho
function circle(g: CanvasRenderingContext2D, [x, y]: [number, number], r: number, fill: string, stroke: string, w: number) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.lineWidth = w; g.stroke();
}
function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
  g.font = `700 ${size}px system-ui, sans-serif`;
  g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y);
}
function pill(g: CanvasRenderingContext2D, text: string, x: number, y: number) {
  g.font = '700 13px system-ui, sans-serif';
  const w = g.measureText(text).width + 14;
  g.fillStyle = 'rgba(10,26,79,0.92)'; roundRect(g, x - w / 2, y - 12, w, 24, 12); g.fill();
  g.fillStyle = '#FACC15'; g.textAlign = 'center'; g.fillText(text, x, y + 5); g.textAlign = 'left';
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function clip(g: CanvasRenderingContext2D, text: string, maxW: number) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}
function wrap(text: string, chars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > chars) { out.push(line.trim()); line = w; } else line += ` ${w}`;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out.slice(0, 4);
}
const wrapCount = (t: string, chars: number) => wrap(t, chars).length;
