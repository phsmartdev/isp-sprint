import { describe, expect, it } from 'vitest';
import { chunkFeatures, parseCoords, parseKml } from './kml';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Rede Yepnet</name>
  <Folder><name>CTOs</name>
    <Placemark><name>CTO-01</name><description><![CDATA[<b>Portas:</b> 16]]></description><Point><coordinates>-37.0500,-10.9000,0</coordinates></Point></Placemark>
    <Placemark><name>CTO-02</name><Point><coordinates>-37.0510,-10.9010</coordinates></Point></Placemark>
  </Folder>
  <Folder><name>Cabos</name>
    <Placemark><name>Cabo 12FO</name><LineString><coordinates>-37.05,-10.9,0 -37.051,-10.901,0 -37.052,-10.902,0</coordinates></LineString></Placemark>
  </Folder>
  <Placemark><name>Área Centro</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-37.06,-10.89 -37.04,-10.89 -37.04,-10.91 -37.06,-10.91 -37.06,-10.89</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  <Placemark><name>Multi</name><MultiGeometry><Point><coordinates>-37.03,-10.93</coordinates></Point><LineString><coordinates>-37.03,-10.93 -37.031,-10.931</coordinates></LineString></MultiGeometry></Placemark>
  <Placemark><name>Vazio</name></Placemark>
</Document></kml>`;

describe('leitura de KML da rede', () => {
  it('lê pontos, linhas e áreas com nome, pasta e descrição', () => {
    const r = parseKml(KML);
    expect(r.features.filter((f) => f.kind === 'ponto')).toHaveLength(3);
    expect(r.features.filter((f) => f.kind === 'linha')).toHaveLength(2);
    expect(r.features.filter((f) => f.kind === 'area')).toHaveLength(1);
    const cto = r.features[0]!;
    expect(cto).toMatchObject({ kind: 'ponto', name: 'CTO-01', folder: 'CTOs', description: 'Portas: 16', at: [-10.9, -37.05] });
    expect(r.features.find((f) => f.name === 'Área Centro')?.folder).toBe('Rede Yepnet');
    expect(r.skipped).toBe(1);
    expect(r.folders).toEqual(expect.arrayContaining(['CTOs', 'Cabos']));
  });
  it('inverte longitude/latitude e ignora coordenadas inválidas', () => {
    expect(parseCoords('-37.05,-10.9,12 bad 200,95')).toEqual([[-10.9, -37.05]]);
  });
  it('recusa XML inválido', () => {
    expect(() => parseKml('<kml><Document>')).toThrow(/KML/);
  });
  it('parte o envio em pedaços menores que o limite', () => {
    const r = parseKml(KML);
    const parts = chunkFeatures(r.features, 200);
    expect(parts.flat()).toHaveLength(r.features.length);
    expect(parts.length).toBeGreaterThan(1);
  });
});

// KMZ de verdade: ZIP com doc.kml compactado (deflate), montado aqui como o Google Earth faz
import { deflateRawSync } from 'node:zlib';
import { kmzToKml } from './kml';
function zip(name: string, text: string): ArrayBuffer {
  const raw = Buffer.from(text, 'utf8');
  const data = deflateRawSync(raw);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = 30 + n.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(cdOffset, 16);
  const all = Buffer.concat([local, n, data, central, n, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}
describe('leitura de KMZ', () => {
  it('descompacta o doc.kml de dentro do KMZ', async () => {
    const kml = await kmzToKml(zip('doc.kml', KML));
    expect(parseKml(kml).features).toHaveLength(6);
  });
  it('avisa quando não é ZIP', async () => {
    await expect(kmzToKml(new TextEncoder().encode('não é zip').buffer as ArrayBuffer)).rejects.toThrow(/ZIP/);
  });
});
