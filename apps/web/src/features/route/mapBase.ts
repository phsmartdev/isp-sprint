/**
 * Base dos mapas da viabilidade técnica (Leaflet): camadas de fundo (satélite com nomes de ruas, ou mapa de ruas),
 * desenho da rede do KMZ e cores. As mesmas URLs de fundo são usadas para gerar a imagem do traçado (exportImage.ts).
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng, NetFeature } from '@isp/domain';

export type BaseKind = 'satelite' | 'ruas';

/** Fundos: {z}/{x}/{y} como no padrão de tiles. Os dois aceitam CORS, então dá para desenhar em canvas na exportação. */
export const BASES: Record<BaseKind, { label: string; tiles: string[]; attribution: string; maxZoom: number }> = {
  satelite: {
    label: 'Satélite',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  ruas: {
    label: 'Ruas',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© colaboradores do OpenStreetMap',
    maxZoom: 19,
  },
};

/** Cores do traçado e da rede (contraste bom sobre satélite e sobre ruas). */
export const COLORS = { route: '#FACC15', routeEdge: '#0A1A4F', cto: '#22C55E', ctoEdge: '#065F46', client: '#EF4444', clientEdge: '#7F1D1D', cable: '#F97316', area: '#38BDF8' } as const;

/** Aracaju: centro padrão quando não há rede nem cliente. */
export const DEFAULT_CENTER: LatLng = [-10.9472, -37.0731];

export function baseLayer(kind: BaseKind): L.LayerGroup {
  const b = BASES[kind];
  return L.layerGroup(b.tiles.map((url, i) => L.tileLayer(url, { maxZoom: b.maxZoom, maxNativeZoom: 19, crossOrigin: 'anonymous', attribution: i === 0 ? b.attribution : undefined })));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Desenha a rede (canvas: aguenta milhares de CTOs sem travar). `onPoint` = clique numa CTO/caixa. */
export function networkLayer(features: NetFeature[], renderer: L.Renderer, onPoint?: (f: Extract<NetFeature, { kind: 'ponto' }>) => void): L.LayerGroup {
  const g = L.layerGroup();
  const tip = (f: NetFeature) => `<b>${esc(f.name)}</b>${f.folder ? `<br><span style="opacity:.75">${esc(f.folder)}</span>` : ''}${f.description ? `<br>${esc(f.description.slice(0, 160))}` : ''}`;
  for (const f of features) {
    if (f.kind === 'area') L.polygon(f.ring, { renderer, color: COLORS.area, weight: 1.5, fillOpacity: 0.12, interactive: false }).addTo(g);
  }
  for (const f of features) {
    if (f.kind === 'linha') L.polyline(f.path, { renderer, color: COLORS.cable, weight: 2.5, opacity: 0.9 }).bindTooltip(tip(f), { sticky: true }).addTo(g);
  }
  for (const f of features) {
    if (f.kind !== 'ponto') continue;
    const m = L.circleMarker(f.at, { renderer, radius: 5.5, color: COLORS.ctoEdge, weight: 1.5, fillColor: COLORS.cto, fillOpacity: 1 }).bindTooltip(tip(f), { direction: 'top', offset: [0, -4] });
    if (onPoint) m.on('click', (e) => { L.DomEvent.stopPropagation(e); onPoint(f); });
    m.addTo(g);
  }
  return g;
}

/** Retângulo que contém a rede (para centralizar o mapa). */
export function networkBounds(features: NetFeature[]): L.LatLngBounds | null {
  const pts: LatLng[] = [];
  for (const f of features) {
    if (f.kind === 'ponto') pts.push(f.at);
    else if (f.kind === 'linha') pts.push(...f.path);
    else pts.push(...f.ring);
  }
  return pts.length ? L.latLngBounds(pts) : null;
}

/** Marcador redondo (cliente, CTO de origem) sem depender das imagens padrão do Leaflet. */
export function dot(color: string, edge: string, size = 18, label?: string) {
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid ${edge};box-shadow:0 1px 4px rgba(0,0,0,.5)"></span>${label ? `<span style="position:absolute;left:${size + 4}px;top:-2px;white-space:nowrap;font:700 12px system-ui;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000">${esc(label)}</span>` : ''}`,
  });
}
