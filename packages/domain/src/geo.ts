/**
 * Viabilidade técnica (Yepnet): mapa da rede (KMZ/KML) e traçado da CTO até o cliente.
 * Regras puras de geometria, usadas na tela (medida ao vivo) e no servidor (a medida gravada é a do servidor).
 * Coordenadas sempre [latitude, longitude] em graus decimais (WGS-84, como no KML/Google Earth).
 */

export type LatLng = [number, number];

/** Elemento da rede lido do KMZ/KML: ponto (CTO, caixa, poste), linha (cabo) ou área (cobertura). */
export type NetFeature =
  | { kind: 'ponto'; name: string; folder: string | null; description: string | null; at: LatLng }
  | { kind: 'linha'; name: string; folder: string | null; description: string | null; path: LatLng[] }
  | { kind: 'area'; name: string; folder: string | null; description: string | null; ring: LatLng[] };

/** Limites do mapa da rede (um KMZ de provedor regional tem de centenas a poucos milhares de elementos). */
export const NET_LIMITS = { features: 30_000, vertices: 400_000, routeVertices: 400, nameChars: 200, descriptionChars: 1_000 } as const;

const R = 6_371_008.8; // raio médio da Terra (m)
const rad = (d: number) => (d * Math.PI) / 180;

/** Distância em metros entre dois pontos (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Comprimento de um traçado em metros (soma dos trechos). */
export function pathLengthM(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distanceM(path[i - 1]!, path[i]!);
  return total;
}

/** Comprimento de cada trecho, em metros (para rotular o traçado). */
export const segmentLengthsM = (path: LatLng[]) => path.slice(1).map((p, i) => distanceM(path[i]!, p));

/** Ponto da rede mais próximo de `at`, dentro de `maxM` metros (ou null). */
export function nearestPoint<T extends { at: LatLng }>(points: T[], at: LatLng, maxM = Infinity): { point: T; distanceM: number } | null {
  let best: { point: T; distanceM: number } | null = null;
  for (const p of points) {
    const d = distanceM(p.at, at);
    if (d <= maxM && (!best || d < best.distanceM)) best = { point: p, distanceM: d };
  }
  return best;
}

/** Ponto dentro de uma área (ray casting; bom para áreas de bairro, sem cruzar o antimeridiano). */
export function insideRing(at: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    if (yi > at[0] !== yj > at[0] && at[1] < ((xj - xi) * (at[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const validLatLng = (p: unknown): p is LatLng =>
  Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

/** Metragem para exibir: "182 m", "1,24 km". */
export function fmtMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

/** Coordenada legível: "-10.94712, -37.07301". */
export const fmtLatLng = (p: LatLng) => `${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;

/** Link do Google Maps para o ponto (vai no chamado, para a engenharia abrir no celular). */
export const mapsLink = (p: LatLng) => `https://www.google.com/maps?q=${p[0].toFixed(6)},${p[1].toFixed(6)}`;

/** Texto do chamado de viabilidade: tudo que a engenharia precisa, sem depender da imagem. */
export function routeTicketText(r: {
  code: number | string; client: string; address: string | null; clientAt: LatLng; ctoName: string | null; ctoAt: LatLng | null; port: string | null;
  lengthM: number; slackM: number; notes: string | null; vertices: number;
}): string {
  const total = r.lengthM + r.slackM;
  return [
    `Pedido de viabilidade técnica — OP-${r.code} · ${r.client}`,
    '',
    `Endereço: ${r.address || 'não informado'}`,
    `Localização do cliente: ${fmtLatLng(r.clientAt)} (${mapsLink(r.clientAt)})`,
    `CTO de origem: ${r.ctoName || 'não identificada'}${r.ctoAt ? ` — ${fmtLatLng(r.ctoAt)} (${mapsLink(r.ctoAt)})` : ''}`,
    `Porta: ${r.port || 'a definir pela engenharia'}`,
    `Metragem traçada: ${fmtMeters(r.lengthM)} (${r.vertices} pontos)`,
    `Sobra técnica: ${fmtMeters(r.slackM)}`,
    `Total estimado de cabo: ${fmtMeters(total)}`,
    ...(r.notes ? ['', `Observações: ${r.notes}`] : []),
    '',
    'A distância é medida no mapa, pelo caminho traçado pelo vendedor. Confirme em campo.',
  ].join('\n');
}
