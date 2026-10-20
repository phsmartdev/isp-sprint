/**
 * Mapa esquemático de Aracaju em quatro zonas (Norte, Oeste, Leste e Sul), com o rio Sergipe a leste
 * e o mar ao sul. Cada zona é pintada pela quantidade de clientes; cada condomínio vira um círculo
 * proporcional dentro da sua zona. É um esquema para leitura rápida, não um mapa em escala.
 */
import { useMemo, useState } from 'react';

export type ZoneKey = 'norte' | 'sul' | 'leste' | 'oeste';
type Condo = { id: string; name: string; zone: string; n: number };

const ZONES: Record<ZoneKey, { label: string; path: string; box: [number, number, number, number]; labelAt: [number, number] }> = {
  norte: { label: 'Zona Norte', path: 'M70,28 C140,14 230,12 300,22 L318,92 L332,176 C280,186 220,192 176,194 C130,190 96,182 66,172 C58,120 60,70 70,28 Z', box: [90, 92, 300, 176], labelAt: [190, 62] },
  oeste: { label: 'Zona Oeste', path: 'M66,172 C96,182 130,190 176,194 L186,262 L190,334 C150,336 100,332 58,322 C44,290 38,256 42,224 C48,204 56,188 66,172 Z', box: [62, 248, 176, 324], labelAt: [116, 218] },
  leste: { label: 'Zona Leste', path: 'M176,194 C220,192 280,186 332,176 L338,244 L346,312 C300,322 240,330 190,334 L186,262 Z', box: [196, 248, 334, 322], labelAt: [262, 218] },
  sul: { label: 'Zona Sul', path: 'M58,322 C100,332 150,336 190,334 C240,330 300,322 346,312 L356,388 C360,430 350,470 318,500 C270,520 200,520 150,490 C110,466 82,430 66,390 C60,368 58,344 58,322 Z', box: [96, 392, 330, 488], labelAt: [210, 360] },
};

/** Posição estável dentro da zona (mesmo condomínio, mesmo lugar). */
function spot(id: string, i: number, box: [number, number, number, number]) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rx = ((h >>> 0) % 1000) / 1000, ry = (((h >>> 10) >>> 0) % 1000) / 1000;
  const [x1, y1, x2, y2] = box;
  return [x1 + 14 + rx * (x2 - x1 - 28), y1 + 10 + ((ry + i * 0.37) % 1) * (y2 - y1 - 20)] as const;
}

export function AracajuZonesMap({ zones, condos, tone = 'blue' }: { zones: { zone: string; n: number }[]; condos: Condo[]; tone?: 'blue' | 'red' }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...zones.filter((z) => z.zone in ZONES).map((z) => z.n));
  const maxCondo = Math.max(1, ...condos.map((c) => c.n));
  const fill = (n: number) => {
    if (!n) return '#E8EEF9';
    const t = Math.sqrt(n / max);
    return tone === 'red' ? `hsl(0 ${60 + t * 20}% ${92 - t * 30}%)` : `hsl(219 ${70 + t * 15}% ${92 - t * 32}%)`;
  };
  const dot = tone === 'red' ? '#B91C1C' : '#2D3339';
  const placed = useMemo(() => {
    const byZone = new Map<string, number>();
    return condos.filter((c) => c.zone in ZONES).slice(0, 60).map((c) => {
      const i = byZone.get(c.zone) ?? 0;
      byZone.set(c.zone, i + 1);
      const [x, y] = spot(c.id, i, ZONES[c.zone as ZoneKey].box);
      return { ...c, x, y, r: 5 + 13 * Math.sqrt(c.n / maxCondo) };
    });
  }, [condos, maxCondo]);
  const hovered = placed.find((c) => c.id === hover);
  return (
    <div className="relative h-full w-full">
      <svg viewBox="20 0 380 530" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label="Mapa esquemático de Aracaju por zona">
        {/* rio Sergipe e mar */}
        <path d="M318,0 L400,0 L400,530 L300,530 C340,500 362,450 360,390 L350,300 L340,180 L330,90 Z" fill="#CFE3F7" />
        <text x="372" y="150" fontSize="11" fill="#5B7FA6" transform="rotate(90 372 150)">Rio Sergipe</text>
        <text x="300" y="525" fontSize="11" fill="#5B7FA6">Oceano Atlântico</text>
        {(Object.keys(ZONES) as ZoneKey[]).map((k) => {
          const z = ZONES[k];
          const n = zones.find((x) => x.zone === k)?.n ?? 0;
          return (
            <g key={k}>
              <path d={z.path} fill={fill(n)} stroke="#FFFFFF" strokeWidth={3}><title>{`${z.label}: ${n} cliente(s)`}</title></path>
              <text x={z.labelAt[0]} y={z.labelAt[1]} textAnchor="middle" fontSize="15" fontWeight={800} fill="#2D3339" stroke="#FFFFFF" strokeWidth={4} paintOrder="stroke">{z.label}</text>
              <text x={z.labelAt[0]} y={z.labelAt[1] + 18} textAnchor="middle" fontSize="13" fontWeight={700} fill="#2D3339" stroke="#FFFFFF" strokeWidth={4} paintOrder="stroke">{n} cliente(s)</text>
            </g>
          );
        })}
        {placed.map((c) => (
          <circle key={c.id} cx={c.x} cy={c.y} r={c.r} fill={dot} fillOpacity={hover === c.id ? 0.95 : 0.6} stroke="#FFFFFF" strokeWidth={1.5} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(c.id)} onBlur={() => setHover(null)}>
            <title>{`${c.name}: ${c.n}`}</title>
          </circle>
        ))}
      </svg>
      {hovered && <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-ink px-3 py-1.5 text-sm text-white shadow">{hovered.name}: <strong>{hovered.n}</strong></div>}
      <p className="absolute bottom-2 left-3 text-2xs text-muted">Mapa esquemático · círculos = condomínios</p>
    </div>
  );
}
