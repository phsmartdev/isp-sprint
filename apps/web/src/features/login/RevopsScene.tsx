/**
 * Fundo "RevOps animado" do login: o Cliente no centro e as três frentes (Marketing, Vendas e Sucesso do Cliente)
 * num ciclo contínuo. Só SVG + animação nativa, lenta e sem piscar (fica animada mesmo com "reduzir movimento").
 */
const cx = 470, cy = 400, R = 230;
const B = '#7CC4F2';
const W = (a: number) => `rgba(255,255,255,${a})`;
const hex = (r: number, x: number, y: number) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const pol = (deg: number, r = R): [number, number] => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
const C = 2 * Math.PI * R;
/** fontes da marca: Orbitron nos títulos, Work Sans nos textos */
const DISPLAY = 'Orbitron, "Work Sans", system-ui, sans-serif';
const SANS = '"Work Sans", system-ui, sans-serif';

const ICON = {
  mkt: <path d="M-9 -3 L4 -9 L4 9 L-9 3 Z M-9 -3 L-9 3 M-6 3 L-4 10" />,
  vnd: <path d="M-10 2 L-4 -4 L1 1 L10 -8 M4 -8 L10 -8 L10 -2" />,
  cs: <path d="M0 9 C-12 1 -10 -9 -4 -9 C-2 -9 0 -7 0 -5 C0 -7 2 -9 4 -9 C10 -9 12 1 0 9 Z" />,
};
const NODES = [
  { a: -90, k: '01', t: 'Marketing', s: 'atrai e qualifica', i: 'mkt', dx: 0 },
  { a: 30, k: '02', t: 'Vendas', s: 'negocia e fecha', i: 'vnd', dx: 34 },
  { a: 150, k: '03', t: 'Sucesso do Cliente', s: 'entrega, retém e expande', i: 'cs', dx: -34 },
] as const;
const TICKS = Array.from({ length: 60 }, (_, i) => i * 6);
const ty = cy + R + 150;

export function RevopsScene({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 920 860" role="img" fontFamily={SANS} aria-label="Uma única experiência: do primeiro contato à renovação, cada passo pensado para o cliente">
      <style>{`
        .ro-spin { animation: ro-spin 90s linear infinite; transform-origin: ${cx}px ${cy}px; }
        .ro-spin-r { animation: ro-spin 140s linear infinite reverse; transform-origin: ${cx}px ${cy}px; }
        .ro-breath { animation: ro-breath 4.8s ease-in-out infinite; }
        .ro-halo { animation: ro-halo 4.8s ease-in-out infinite; opacity: 0; }
        @keyframes ro-spin { to { transform: rotate(360deg); } }
        @keyframes ro-breath { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes ro-halo { 0%,100% { opacity: 0; } 50% { opacity: .9; } }
      `}</style>
      <defs>
        <linearGradient id="ro-ring" gradientUnits="userSpaceOnUse" x1={cx - R} y1={cy - R} x2={cx + R} y2={cy + R}>
          <stop offset="0" stopColor={B} stopOpacity=".9" /><stop offset=".5" stopColor="#fff" stopOpacity=".35" /><stop offset="1" stopColor={B} stopOpacity=".9" />
        </linearGradient>
        <linearGradient id="ro-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2E4A68" stopOpacity=".95" /><stop offset="1" stopColor="#15212E" stopOpacity=".95" /></linearGradient>
        <linearGradient id="ro-edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".5" stopColor={B} stopOpacity=".25" /><stop offset="1" stopColor="#fff" stopOpacity=".08" /></linearGradient>
        <radialGradient id="ro-aura" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor={B} stopOpacity=".3" /><stop offset=".6" stopColor={B} stopOpacity=".06" /><stop offset="1" stopColor={B} stopOpacity="0" /></radialGradient>
        <radialGradient id="ro-dot" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fff" /><stop offset=".35" stopColor="#CFEBFF" stopOpacity=".9" /><stop offset="1" stopColor={B} stopOpacity="0" /></radialGradient>
        <filter id="ro-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" /></filter>
        <path id="ro-path" d={`M${cx} ${cy - R} A${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R}`} />
      </defs>

      {/* órbitas finas, girando devagar */}
      <g className="ro-spin-r"><circle cx={cx} cy={cy} r={R + 95} fill="none" stroke={W(0.06)} strokeDasharray="1 7" /></g>
      <g className="ro-spin">
        <circle cx={cx} cy={cy} r={R + 48} fill="none" stroke={W(0.07)} />
        {TICKS.map((d) => { const [x1, y1] = pol(d, R + 44), [x2, y2] = pol(d, R + (d % 30 ? 48 : 54)); return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke={W(d % 30 ? 0.1 : 0.22)} />; })}
      </g>
      <circle cx={cx} cy={cy} r={R - 70} fill="none" stroke={W(0.05)} />

      {/* o ciclo */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={W(0.06)} strokeWidth="18" />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="url(#ro-ring)" strokeWidth="1.2" opacity=".7" />
      <circle className="ro-move" cx={cx} cy={cy} r={R} fill="none" stroke={B} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${C * 0.16} ${C}`} transform={`rotate(-90 ${cx} ${cy})`}>
        <animate attributeName="stroke-dashoffset" from={C * 0.16} to={-C * 0.84} dur="9s" repeatCount="indefinite" />
      </circle>
      {Array.from({ length: 6 }, (_, i) => (
        <circle key={i} className="ro-move" r="7" fill="url(#ro-dot)">
          <animateMotion dur="18s" begin={`${-i * 3}s`} repeatCount="indefinite"><mpath href="#ro-path" /></animateMotion>
        </circle>
      ))}

      {/* fios: cada frente olha para o cliente */}
      {NODES.map((n, i) => {
        const [x, y] = pol(n.a, R - 46), [x0, y0] = pol(n.a, 86);
        return (
          <g key={n.k}>
            <line x1={x0} y1={y0} x2={x} y2={y} stroke={W(0.14)} strokeDasharray="2 6" />
            {/* começa já em movimento (begin negativo) e invisível: nada aparece no canto antes da animação */}
            <circle className="ro-move" r="2.4" fill="#fff" cx={x} cy={y} opacity="0">
              <animateMotion dur="3.2s" begin={`${-i * 1.07}s`} repeatCount="indefinite" path={`M0 0 L${x0 - x} ${y0 - y}`} />
              <animate attributeName="opacity" values="0;1;0" dur="3.2s" begin={`${-i * 1.07}s`} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}

      {/* centro: o cliente */}
      <circle cx={cx} cy={cy} r="150" fill="url(#ro-aura)" />
      <circle className="ro-breath" cx={cx} cy={cy} r="96" fill={B} opacity=".18" filter="url(#ro-soft)" />
      <polygon points={hex(84, cx, cy)} fill="url(#ro-glass)" />
      <polygon points={hex(84, cx, cy)} fill="none" stroke="url(#ro-edge)" strokeWidth="1.4" />
      <polygon points={hex(72, cx, cy)} fill="none" stroke={W(0.08)} />
      <g transform={`translate(${cx} ${cy - 22})`} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="0" cy="-6" r="6" /><path d="M-12 13 C-12 4 -6 1 0 1 C6 1 12 4 12 13" />
      </g>
      <text x={cx} y={cy + 24} textAnchor="middle" fontFamily={DISPLAY} fontSize="18" fontWeight="700" fill="#fff" letterSpacing="1">Cliente</text>
      <text x={cx} y={cy + 44} textAnchor="middle" fontSize="10.5" fill={W(0.55)} letterSpacing="2.4">NO CENTRO</text>

      {/* frentes */}
      {NODES.map((n, i) => {
        const [x, y] = pol(n.a);
        const top = n.a === -90, lx = x + n.dx, ly = top ? y - 92 : y + 72;
        return (
          <g key={n.k}>
            <polygon className="ro-halo" style={{ animationDelay: `${i * 1.6}s` }} points={hex(44, x, y)} fill="none" stroke={B} />
            <polygon points={hex(34, x, y)} fill="url(#ro-glass)" />
            <polygon points={hex(34, x, y)} fill="none" stroke="url(#ro-edge)" strokeWidth="1.2" />
            <g transform={`translate(${x} ${y})`} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{ICON[n.i]}</g>
            <text x={lx} y={ly} textAnchor="middle" fontSize="10.5" fill={B} letterSpacing="2.4">{n.k}</text>
            <text x={lx} y={ly + 22} textAnchor="middle" fontFamily={DISPLAY} fontSize="15" fontWeight="700" fill="#fff" letterSpacing=".6">{n.t}</text>
            <text x={lx} y={ly + 42} textAnchor="middle" fontSize="13.5" fill={W(0.62)}>{n.s}</text>
          </g>
        );
      })}

      {/* assinatura */}
      <line x1={cx - 18} y1={ty - 44} x2={cx + 18} y2={ty - 44} stroke={B} />
      <text x={cx} y={ty} textAnchor="middle" fontFamily={DISPLAY} fontSize="30" fontWeight="700" fill="#fff" letterSpacing="1.5"><tspan fill={W(0.7)}>Uma </tspan>única experiência</text>
      <text x={cx} y={ty + 34} textAnchor="middle" fontSize="16" fill={W(0.62)}>Do primeiro contato à renovação, cada passo pensado para o cliente.</text>
    </svg>
  );
}
