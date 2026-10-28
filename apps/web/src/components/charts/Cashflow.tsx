/**
 * Fluxo de caixa mensal: entradas para cima, saídas para baixo a partir do zero e a linha do saldo acumulado
 * (mesma escala em R$, um eixo só). Marca o mês em que o acumulado volta a ficar positivo.
 */
import { useEffect, useRef, useState } from 'react';
import { fmtBRL } from '../../lib/format';

const IN = 'rgb(var(--chart-in))';
const OUT = 'rgb(var(--chart-out))';
const INK = 'rgb(var(--ink))';

function niceStep(span: number) {
  const raw = span / 4 || 1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * exp;
}
const short = (cents: number) => {
  const v = Math.abs(cents) / 100, sign = cents < 0 ? '−' : '';
  return v >= 1_000_000 ? `${sign}R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1000 ? `${sign}R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `${sign}R$ ${Math.round(v)}`;
};

export function CashflowChart({ labels, inflow, outflow, cumulative, ariaLabel, height = 240 }: { labels: string[]; inflow: number[]; outflow: number[]; cumulative: number[]; ariaLabel: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // desenha na largura real: textos com tamanho de tela em qualquer largura
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const n = labels.length;
  if (!n) return null;
  const H = height, padL = 76, padR = 12, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const lo0 = Math.min(0, ...outflow, ...cumulative), hi0 = Math.max(0, ...inflow, ...cumulative);
  const step = niceStep(hi0 - lo0);
  const lo = Math.floor(lo0 / step) * step, hi = Math.max(step, Math.ceil(hi0 / step) * step);
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * innerH;
  const ticks: number[] = []; for (let t = lo; t <= hi + 1e-6; t += step) ticks.push(t);
  const slot = innerW / n;
  const bw = Math.max(2, Math.min(slot * 0.62, 22));
  const cx = (i: number) => padL + slot * i + slot / 2;
  const every = Math.ceil(n / Math.max(2, Math.floor(innerW / 64)));
  const back = cumulative.findIndex((v, k) => v >= 0 && cumulative.slice(0, k).some((x) => x < 0));
  const line = cumulative.map((v, i) => `${cx(i)},${y(v)}`).join(' ');
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-text">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5" style={{ background: IN }} />Entradas</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5" style={{ background: OUT }} />Saídas</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: INK }} />Saldo acumulado</span>
        </div>
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTable(!table)}>{table ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>
      {table ? (
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface text-muted"><tr><th className="py-1 text-left font-medium">Mês</th><th className="py-1 text-right font-medium">Entradas</th><th className="py-1 text-right font-medium">Saídas</th><th className="py-1 text-right font-medium">Saldo do mês</th><th className="py-1 text-right font-medium">Acumulado</th></tr></thead>
            <tbody>{labels.map((l, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{l}</td>
                <td className="num py-1 text-right">{fmtBRL(inflow[i] ?? 0)}</td>
                <td className="num py-1 text-right">{outflow[i] ? `−${fmtBRL(-outflow[i]!)}` : fmtBRL(0)}</td>
                <td className="num py-1 text-right">{fmtBRL((inflow[i] ?? 0) + (outflow[i] ?? 0))}</td>
                <td className={`num py-1 text-right font-semibold ${(cumulative[i] ?? 0) < 0 ? 'text-danger' : 'text-ink'}`}>{fmtBRL(cumulative[i] ?? 0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative" ref={box}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgb(var(--line-strong))' : 'rgb(var(--line))'} strokeWidth={t === 0 ? 1.5 : 1} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="rgb(var(--muted))">{short(t)}</text>
              </g>
            ))}
            {back > 0 && (
              <g>
                <line x1={cx(back)} x2={cx(back)} y1={padT} y2={padT + innerH} stroke="rgb(var(--muted))" strokeDasharray="4 4" />
                <text x={cx(back) + 5} y={padT + 10} fontSize="11" fill="rgb(var(--text))">Retorno do investimento</text>
              </g>
            )}
            {labels.map((l, i) => (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill={hover === i ? 'rgb(var(--surface-2))' : 'transparent'} />
                {(inflow[i] ?? 0) > 0 && <rect x={cx(i) - bw / 2} y={y(inflow[i]!)} width={bw} height={Math.max(1, y(0) - y(inflow[i]!) - 1)} fill={IN} />}
                {(outflow[i] ?? 0) < 0 && <rect x={cx(i) - bw / 2} y={y(0) + 1} width={bw} height={Math.max(1, y(outflow[i]!) - y(0) - 1)} fill={OUT} />}
                {i % every === 0 && <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="rgb(var(--muted))">{l}</text>}
              </g>
            ))}
            <polyline points={line} fill="none" stroke={INK} strokeWidth="2" pointerEvents="none" />
            {hover !== null && <circle cx={cx(hover)} cy={y(cumulative[hover]!)} r="4.5" fill={INK} stroke="rgb(var(--surface))" strokeWidth="2" pointerEvents="none" />}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-2 z-10 min-w-[190px] border border-line bg-surface px-3 py-2 text-xs shadow-overlay" style={{ left: `min(${((cx(hover) + 14) / W) * 100}%, calc(100% - 200px))` }}>
              <p className="mb-1 font-semibold text-ink">{labels[hover]}</p>
              <p className="flex justify-between gap-3 text-text"><span className="flex items-center gap-1.5"><span className="h-2 w-2" style={{ background: IN }} />Entradas</span><span className="num">{fmtBRL(inflow[hover] ?? 0)}</span></p>
              <p className="flex justify-between gap-3 text-text"><span className="flex items-center gap-1.5"><span className="h-2 w-2" style={{ background: OUT }} />Saídas</span><span className="num">{outflow[hover] ? `−${fmtBRL(-outflow[hover]!)}` : fmtBRL(0)}</span></p>
              <p className="mt-1 flex justify-between gap-3 border-t border-line pt-1 font-semibold text-ink"><span>Acumulado</span><span className="num">{fmtBRL(cumulative[hover] ?? 0)}</span></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Fluxo de uma oportunidade (mês 0 = investimento) nas três séries do gráfico. */
export function flowSeries(flows: number[]) {
  let acc = 0;
  return { inflow: flows.map((f) => Math.max(0, f)), outflow: flows.map((f) => Math.min(0, f)), cumulative: flows.map((f) => (acc += f)) };
}
