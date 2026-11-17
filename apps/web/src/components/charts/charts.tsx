import { useState, type ReactNode } from 'react';
import clsx from 'clsx';

/* Gráficos em SVG próprios, fiéis ao visual dos designs. Todos têm alternativa textual (tabela sr-only). */

export const CHART = {
  leads: '#4FBBFF',
  sales: '#2F5986',
  revenue: '#2D3339',
  value: '#3885D3',
  donut: ['#2F5986', '#3885D3', '#4FBBFF', '#677680', '#00A9C6', '#AAAAAA'],
};

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10;
  return step * exp;
}

type Series = { key: string; label: string; color: string; values: number[] };

/** Barras (uma ou duas séries) + linha opcional em eixo próprio, com legenda e tooltip. */
export function ComboChart({
  categories, bars, line, leftFormat = (v) => String(v), rightFormat, tooltipTitle, height = 220, ariaLabel, tooltipRows,
}: {
  categories: string[];
  bars: Series[];
  line?: Series & { axis: 'right' | 'hidden' };
  leftFormat?: (v: number) => string;
  rightFormat?: (v: number) => string;
  tooltipTitle: (i: number) => string;
  tooltipRows: (i: number) => { color: string; text: string }[];
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, padL = leftFormat(1).startsWith("R$") ? 70 : 48, padR = line?.axis === 'right' ? 84 : 16, padT = 16, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const leftMax = niceMax(Math.max(...bars.flatMap((b) => b.values), 0));
  const rightMax = line ? niceMax(Math.max(...line.values, 0)) : 1;
  const slot = innerW / Math.max(1, categories.length);
  const groupW = Math.min(slot * 0.62, 26 * bars.length + 8);
  const barW = (groupW - (bars.length - 1) * 4) / bars.length;
  const y = (v: number, max: number) => padT + innerH - (v / max) * innerH;
  const cx = (i: number) => padL + slot * i + slot / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const points = line?.values.map((v, i) => `${cx(i)},${line.axis === 'right' ? y(v, rightMax) : y(v, rightMax)}`).join(' ');
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(leftMax * t, leftMax)} y2={y(leftMax * t, leftMax)} stroke="#E8EDF5" />
            <text x={padL - 10} y={y(leftMax * t, leftMax) + 4} textAnchor="end" fontSize="11" fill="#5C6A8A">{leftFormat(leftMax * t)}</text>
            {line?.axis === 'right' && rightFormat && <text x={W - padR + 10} y={y(rightMax * t, rightMax) + 4} fontSize="11" fill="#5C6A8A">{rightFormat(rightMax * t)}</text>}
          </g>
        ))}
        {categories.map((c, i) => (
          <g key={c} onMouseEnter={() => setHover(i)}>
            <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill={hover === i ? '#F3F6FC' : 'transparent'} />
            {bars.map((b, j) => {
              const v = b.values[i] ?? 0;
              const h = (v / leftMax) * innerH;
              return <rect key={b.key} x={cx(i) - groupW / 2 + j * (barW + 4)} y={padT + innerH - h} width={barW} height={h} rx="3" fill={b.color} />;
            })}
            <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="#5C6A8A">{c}</text>
          </g>
        ))}
        {line && points && (
          <g pointerEvents="none">
            <polyline points={points} fill="none" stroke={line.color} strokeWidth="2.5" />
            {line.values.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v, rightMax)} r="4.5" fill={line.color} stroke="#fff" strokeWidth="1.5" />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-md border border-line bg-surface px-3.5 py-2.5 shadow-overlay" style={{ left: `min(${((cx(hover) + 14) / W) * 100}%, calc(100% - 170px))` }}>
          <p className="mb-1 font-semibold text-ink">{tooltipTitle(hover)}</p>
          {tooltipRows(hover).map((r) => (
            <p key={r.text} className="flex items-center gap-2 text-sm text-text"><span className="h-3 w-3 rounded-circle" style={{ background: r.color }} />{r.text}</p>
          ))}
        </div>
      )}
      <div className="sr-only"><table>
        <caption>{ariaLabel}</caption>
        <thead><tr><th>Período</th>{bars.map((b) => <th key={b.key}>{b.label}</th>)}{line && <th>{line.label}</th>}</tr></thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={c}><td>{c}</td>{bars.map((b) => <td key={b.key}>{b.values[i]}</td>)}{line && <td>{line.values[i]}</td>}</tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-5 text-sm text-muted">
      {items.map((i) => <li key={i.label} className="flex items-center gap-2"><span className="h-3 w-3 rounded-circle" style={{ background: i.color }} aria-hidden />{i.label}</li>)}
    </ul>
  );
}

/** Rosca com valor central e legenda (nome, quantidade, %). */
export function Donut({ items, centerValue, centerLabel, ariaLabel }: { items: { label: string; value: number; share: number | null }[]; centerValue: ReactNode; centerLabel: string; ariaLabel: string }) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const R = 70, r = 46, C = 90;
  let acc = 0;
  const arcs = items.map((it, idx) => {
    const start = total ? (acc / total) * Math.PI * 2 : 0;
    acc += it.value;
    const end = total ? (acc / total) * Math.PI * 2 : 0;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${C + rad * Math.sin(a)} ${C - rad * Math.cos(a)}`;
    const d = end - start >= Math.PI * 2 - 1e-6
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
      : `M ${p(start, R)} A ${R} ${R} 0 ${large} 1 ${p(end, R)} L ${p(end, r)} A ${r} ${r} 0 ${large} 0 ${p(start, r)} Z`;
    return <path key={it.label} d={d} fill={CHART.donut[idx % CHART.donut.length]} stroke="#fff" strokeWidth="2" />;
  });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <svg viewBox="0 0 180 180" className="h-full w-full" role="img" aria-label={ariaLabel}>
          {total ? arcs : <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#E8EDF5" strokeWidth={R - r} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-[28px] font-extrabold leading-none text-ink">{centerValue}</span>
          <span className="text-sm text-text">{centerLabel}</span>
        </div>
      </div>
      <ul className="min-w-[200px] flex-1 space-y-2.5">
        {items.map((it, idx) => (
          <li key={it.label} className="grid grid-cols-[1fr_auto_52px] items-center gap-3 text-sm">
            <span className="flex items-center gap-2 text-text"><span className="h-3 w-3 rounded-circle" style={{ background: CHART.donut[idx % CHART.donut.length] }} aria-hidden />{it.label}</span>
            <span className="num font-bold text-ink">{it.value}</span>
            <span className="num text-right text-muted">{it.share === null ? 'N/D' : `${Math.round(it.share * 100)}%`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lista de barras horizontais (rótulo, barra, valor, %), como "Vendas por plano" e "Conversão por etapa". */
export function BarRows({ items, color = '#2F5986', track = '#EEF2F9', gradient }: { items: { label: string; value: number; share: number | null; color?: string }[]; color?: string; track?: string; gradient?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3.5">
      {items.map((it, idx) => (
        <li key={it.label} className="grid grid-cols-[minmax(96px,120px)_1fr_auto_48px] items-center gap-3 text-sm">
          <span className="truncate text-text">{it.label}</span>
          <span className="h-[18px] overflow-hidden rounded-none" style={{ background: track }}>
            <span
              className="block h-full rounded-none"
              style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? (gradient ? `rgba(29,95,230,${Math.max(0.35, 1 - idx * 0.16)})` : color) }}
            />
          </span>
          <span className="num min-w-[28px] text-right font-bold text-ink">{it.value}</span>
          <span className="num text-right text-muted">{it.share === null ? 'N/D' : `${Math.round(it.share * 100)}%`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Funil em trapézios coloridos (Status das oportunidades). */
export function FunnelShape({ colors }: { colors: string[] }) {
  const n = colors.length;
  return (
    <svg viewBox="0 0 140 150" className="h-[150px] w-[130px] shrink-0" aria-hidden>
      {colors.map((c, i) => {
        const top = 6 + i * 23, h = 21;
        const wTop = 128 - i * 14, wBot = 128 - (i + 1) * 14;
        const x0 = (140 - wTop) / 2, x1 = (140 - wBot) / 2;
        return <path key={i} d={`M${x0} ${top} H${x0 + wTop} L${x1 + wBot} ${top + h} H${x1} Z`} fill={c} rx="3" opacity={i === n - 1 ? 0.95 : 1} />;
      })}
    </svg>
  );
}

export function Progress({ value, className, color = '#5B9BFF' }: { value: number | null; className?: string; color?: string }) {
  return (
    <span className={clsx('block h-2.5 overflow-hidden rounded-full bg-[#E9EEF7]', className)}>
      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, (value ?? 0) * 100))}%`, background: color }} />
    </span>
  );
}

/** Curva monotônica: suaviza sem ultrapassar os pontos (um mês zerado continua no zero). */
export function smoothPath(pts: [number, number][]) {
  const n = pts.length;
  if (!n) return '';
  if (n < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1]![1] - pts[i]![1]) / (pts[i + 1]![0] - pts[i]![0] || 1));
  m[0] = d[0]!; m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i]! / d[i]!, b = m[i + 1]! / d[i]!, q = a * a + b * b;
    if (q > 9) { const t = 3 / Math.sqrt(q); m[i] = t * a * d[i]!; m[i + 1] = t * b * d[i]!; }
  }
  let p = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!, h = (x1 - x0) / 3;
    p += ` C${x0 + h},${y0 + h * m[i]!} ${x1 - h},${y1 - h * m[i + 1]!} ${x1},${y1}`;
  }
  return p;
}
/** Eixo curto: 40 mil, 1,2 mi. */
export const compactBRL = (v: number) => {
  const a = Math.abs(v) / 100;
  if (a >= 1_000_000) return `${(v / 100_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1_000) return `${(v / 100_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return (v / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};

/** Linhas (várias séries no mesmo eixo), suaves e finas, com tooltip por período e tabela para leitor de tela. */
export function LineChart({ categories, series, format, axisFormat, ariaLabel, height = 240, width = 640, tooltipTitle, onPick }: {
  /** clique num ponto: detalha os registros que compõem aquele valor */
  onPick?: (i: number) => void;
  categories: string[];
  /** dashed = tracejado; dotted = pontilhado; area = degradê suave embaixo da linha (use em uma série só) */
  series: (Series & { dashed?: boolean; dotted?: boolean; area?: boolean; weight?: number })[];
  format: (v: number) => string;
  /** rótulos do eixo (padrão: o mesmo format) */
  axisFormat?: (v: number) => string;
  ariaLabel: string;
  height?: number;
  /** largura do desenho: mais largo = gráfico mais baixo e texto menor em telas largas */
  width?: number;
  tooltipTitle: (i: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const af = axisFormat ?? format;
  const W = width, H = height, padL = axisFormat ? 48 : 84, padR = 16, padT = 12, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 0));
  const step = categories.length > 1 ? innerW / (categories.length - 1) : 0;
  const x = (i: number) => padL + (categories.length > 1 ? step * i : innerW / 2);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const every = Math.max(1, Math.ceil(categories.length / 12));
  const gid = `lg-${ariaLabel.replace(/\W+/g, '').slice(0, 24)}`;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <defs>{series.filter((s) => s.area).map((s) => (
          <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity="0.14" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>
        ))}</defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke={t === 0 ? '#E3E8EF' : '#EEF1F5'} strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text x={padL - 10} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="#8A94A3">{t === 0 ? '0' : af(max * t)}</text>
          </g>
        ))}
        {categories.map((c, i) => (
          <g key={c} onMouseEnter={() => setHover(i)} onClick={onPick ? () => onPick(i) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
            <rect x={x(i) - Math.max(step, 8) / 2} y={padT} width={Math.max(step, 8)} height={innerH} fill="transparent" />
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={hover === i ? '#4B5563' : '#8A94A3'}>{c}</text>}
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="#C9D1DB" strokeDasharray="3 3" pointerEvents="none" />}
        {series.filter((s) => s.area).map((s) => {
          const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
          return pts.length ? <path key={`a-${s.key}`} d={`${smoothPath(pts)} L${pts.at(-1)![0]},${y(0)} L${pts[0]![0]},${y(0)} Z`} fill={`url(#${gid}-${s.key})`} pointerEvents="none" /> : null;
        })}
        {series.map((s) => (
          <g key={s.key} pointerEvents="none">
            <path d={smoothPath(s.values.map((v, i) => [x(i), y(v)]))} fill="none" stroke={s.color} strokeWidth={s.weight ?? (s.dashed || s.dotted ? 1.5 : 2)} strokeDasharray={s.dotted ? '1 4' : s.dashed ? '5 4' : undefined} strokeLinecap="round" strokeLinejoin="round" />
            {hover !== null && !s.dashed && !s.dotted && <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" />}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 z-10 min-w-[200px] rounded-lg border border-line bg-surface px-3 py-2.5 text-xs shadow-overlay" style={{ left: `min(${((x(hover) + 16) / W) * 100}%, calc(100% - 220px))` }}>
          <p className="mb-1.5 font-semibold text-ink">{tooltipTitle(hover)}</p>
          {series.map((s) => <p key={s.key} className="flex items-center justify-between gap-4 py-0.5 text-text"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span><b className="num font-semibold text-ink">{format(s.values[hover] ?? 0)}</b></p>)}
        </div>
      )}
      <div className="sr-only"><table>
        <caption>{ariaLabel}</caption>
        <thead><tr><th>Mês</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>{categories.map((c, i) => <tr key={c}><td>{c}</td>{series.map((s) => <td key={s.key}>{format(s.values[i] ?? 0)}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  );
}
