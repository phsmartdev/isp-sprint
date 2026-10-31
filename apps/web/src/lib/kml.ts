/**
 * Leitura de KMZ/KML no navegador (Google Earth, OZmap, GeoGrid e afins), sem biblioteca externa.
 * KMZ = ZIP com um .kml dentro: lemos o diretório central do ZIP e descompactamos com DecompressionStream('deflate-raw').
 * Do KML saem pontos (CTOs, caixas), linhas (cabos) e polígonos (áreas), com nome, pasta e descrição.
 */
import { NET_LIMITS, type LatLng, type NetFeature } from '@isp/domain';

// ------------------------------------------------------------------ ZIP (KMZ)
type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf);
  // fim do diretório central: assinatura 0x06054b50, procurada de trás para frente (pode haver comentário)
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Arquivo KMZ inválido (não é um ZIP).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Arquivo KMZ corrompido.');
    const method = v.getUint16(p + 10, true);
    const compressedSize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    out.push({ name: dec.decode(new Uint8Array(buf, p + 46, nameLen)), method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function zipRead(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array> {
  const v = new DataView(buf);
  if (v.getUint32(e.offset, true) !== 0x04034b50) throw new Error('Arquivo KMZ corrompido.');
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const data = new Uint8Array(buf, start, e.compressedSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error('KMZ com compactação não suportada. Exporte de novo pelo Google Earth.');
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não abre KMZ. Use Chrome, Edge ou Firefox atualizados, ou envie o .kml.');
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data.slice()); c.close(); } });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Texto do KML de dentro de um KMZ (o doc.kml, ou o primeiro .kml). */
export async function kmzToKml(buf: ArrayBuffer): Promise<string> {
  const entries = zipEntries(buf).filter((e) => /\.kml$/i.test(e.name));
  if (!entries.length) throw new Error('O KMZ não tem nenhum arquivo .kml dentro.');
  const main = entries.find((e) => /(^|\/)doc\.kml$/i.test(e.name)) ?? entries[0]!;
  return new TextDecoder().decode(await zipRead(buf, main));
}

// ------------------------------------------------------------------ KML
const local = (el: Element) => el.localName;
const child = (el: Element, name: string) => Array.from(el.children).find((c) => local(c) === name) ?? null;
const textOf = (el: Element | null) => (el?.textContent ?? '').trim();

/** "lng,lat[,alt] lng,lat…" → [[lat, lng], …] (o KML guarda longitude primeiro). */
export function parseCoords(s: string): LatLng[] {
  const out: LatLng[] = [];
  for (const tuple of s.trim().split(/\s+/)) {
    if (!tuple) continue;
    const [lng, lat] = tuple.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180) out.push([round(lat!), round(lng!)]);
  }
  return out;
}
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Descrição do KML costuma vir em HTML: fica só o texto. */
function plain(html: string): string | null {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const t = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, NET_LIMITS.descriptionChars) : null;
}

/** Nome da pasta mais próxima (ex.: "CTOs", "Cabos 12FO", "Área Centro"). */
function folderOf(pm: Element): string | null {
  for (let p = pm.parentElement; p; p = p.parentElement) {
    if (local(p) === 'Folder' || local(p) === 'Document') {
      const n = textOf(child(p, 'name'));
      if (n) return n.slice(0, NET_LIMITS.nameChars);
    }
  }
  return null;
}

/** Geometrias de um Placemark (inclusive dentro de MultiGeometry). */
function geometries(pm: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      const n = local(c);
      if (n === 'Point' || n === 'LineString' || n === 'Polygon' || n === 'LinearRing') out.push(c);
      else if (n === 'MultiGeometry') walk(c);
    }
  };
  walk(pm);
  return out;
}

export type KmlResult = { features: NetFeature[]; skipped: number; folders: string[] };

export function parseKml(text: string): KmlResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('O arquivo KML não pôde ser lido (XML inválido).');
  const features: NetFeature[] = [];
  let skipped = 0;
  const placemarks = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'));
  for (const pm of placemarks) {
    const name = (textOf(child(pm, 'name')) || 'Sem nome').slice(0, NET_LIMITS.nameChars);
    const folder = folderOf(pm);
    const description = plain(textOf(child(pm, 'description')));
    const geos = geometries(pm);
    if (!geos.length) { skipped++; continue; }
    for (const g of geos) {
      const kind = local(g);
      if (kind === 'Point') {
        const c = parseCoords(textOf(child(g, 'coordinates')));
        if (c[0]) features.push({ kind: 'ponto', name, folder, description, at: c[0] }); else skipped++;
      } else if (kind === 'LineString') {
        const c = parseCoords(textOf(child(g, 'coordinates')));
        if (c.length >= 2) features.push({ kind: 'linha', name, folder, description, path: c }); else skipped++;
      } else {
        // Polygon: só o contorno externo (furos não importam para cobertura)
        const ring = kind === 'LinearRing' ? g : g.getElementsByTagNameNS('*', 'outerBoundaryIs')[0]?.getElementsByTagNameNS('*', 'LinearRing')[0];
        const c = ring ? parseCoords(textOf(child(ring, 'coordinates'))) : [];
        if (c.length >= 3) features.push({ kind: 'area', name, folder, description, ring: c }); else skipped++;
      }
    }
  }
  const folders = [...new Set(features.map((f) => f.folder).filter((f): f is string => !!f))];
  return { features, skipped, folders };
}

/** Lê .kml ou .kmz. */
export async function readNetworkFile(file: File): Promise<KmlResult> {
  const buf = await file.arrayBuffer();
  const isZip = buf.byteLength > 4 && new DataView(buf).getUint32(0, true) === 0x04034b50;
  const text = isZip || /\.kmz$/i.test(file.name) ? await kmzToKml(buf) : new TextDecoder().decode(buf);
  return parseKml(text);
}

/** Parte a lista para caber no limite de envio (a Vercel recusa corpo acima de 4,5 MB). */
export function chunkFeatures(fs: NetFeature[], maxBytes = 3_000_000): NetFeature[][] {
  const out: NetFeature[][] = [];
  let cur: NetFeature[] = [];
  let size = 0;
  for (const f of fs) {
    const n = JSON.stringify(f).length + 1;
    if (cur.length && size + n > maxBytes) { out.push(cur); cur = []; size = 0; }
    cur.push(f); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
