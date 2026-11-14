/**
 * Jornada do cliente como uma MONTANHA: a trilha sobe da base (Onboarding) ao cume (Expansão) passando pelas 7 etapas
 * do playbook. Feita para ser mostrada ao cliente: pouco texto, o cliente vê na hora onde está. Só consulta.
 * A etapa vem do registro real (card da conta no funil Sucesso do Cliente); sem registro, ninguém é marcado como atual.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { fmtDate } from '../../../lib/format';
import { MACRO, MICRO, type JModel } from './model';

const C = { ink: '#2D3339', muted: '#6B7682', blue: '#2F5986', sky0: '#F4F7FB', sky1: '#E3EBF4', m1: '#C9D6E4', m2: '#9DB3CB', m3: '#6F8DAE', m4: '#3E5F84', ok: '#2E8B57' };
/** posição de cada etapa na trilha (palco 1600 × 900) e o lado da etiqueta */
const PT = [{ x: 300, y: 760, l: true }, { x: 470, y: 690, l: false }, { x: 640, y: 640, l: true }, { x: 770, y: 560, l: false }, { x: 900, y: 470, l: true }, { x: 1020, y: 360, l: false }, { x: 1110, y: 235, l: true }];
const curve = (pts: { x: number; y: number }[]) => {
  let d = `M${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, b = pts[i]!, mx = (a.x + b.x) / 2; d += ` C${mx} ${a.y + (i % 2 ? 20 : -10)} ${mx} ${b.y + (i % 2 ? 20 : -10)} ${b.x} ${b.y}`; }
  return d;
};

export function JourneyMountain({ model }: { model: JModel }) {
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const cur = model.stage.micro;
  const done = cur === null ? [] : PT.slice(0, cur + 1);
  const toggleFull = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    void box.current?.requestFullscreen?.().then(() => setFull(true)).catch(() => undefined);
  };
  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const sub = [model.account.name, model.account.contracts.length ? `Contrato ${model.account.contracts.map((c) => c.number).join(', ')}` : null].filter(Boolean).join(' · ');

  return (
    <div ref={box} className={clsx('relative w-full bg-white', full && 'flex items-center justify-center bg-[#F4F7FB]')}>
      <div className={clsx('relative w-full', full ? 'aspect-video max-h-screen' : 'aspect-video')}>
        <svg viewBox="0 0 1600 900" className="absolute inset-0 h-full w-full" role="img" aria-label={`Jornada de ${model.account.name}: ${cur === null ? 'etapa atual não registrada' : `etapa atual ${MICRO[cur]!.name}`}`}>
          <defs>
            <linearGradient id="mt-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.sky0} /><stop offset="1" stopColor={C.sky1} /></linearGradient>
            <linearGradient id="mt-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.m3} /><stop offset="1" stopColor={C.m4} /></linearGradient>
            <linearGradient id="mt-light" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient>
          </defs>
          <rect width="1600" height="900" fill="url(#mt-sky)" />
          <path d="M0 720 L220 520 L380 610 L560 430 L760 600 L980 470 L1200 560 L1400 420 L1600 540 L1600 900 L0 900Z" fill={C.m1} />
          <path d="M0 800 L180 660 L330 720 L1500 720 L1600 680 L1600 900 L0 900Z" fill={C.m2} opacity=".7" />
          <path d="M120 900 L560 560 L720 610 L1110 180 L1300 420 L1380 380 L1600 640 L1600 900Z" fill="url(#mt-body)" />
          <path d="M1110 180 L1300 420 L1380 380 L1600 640 L1600 900 L1110 900Z" fill="#000" opacity=".12" />
          <path d="M120 900 L560 560 L720 610 L1110 180 L1110 900Z" fill="url(#mt-light)" />
          <path d="M1110 180 L1175 252 L1150 248 L1132 270 L1112 246 L1090 268 L1072 238 L1052 246Z" fill="#fff" />
          {/* trilha completa (pontilhada) e o trecho percorrido, que se desenha ao abrir */}
          <path d={curve(PT)} fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" opacity=".9" />
          {done.length > 1 && <path d={curve(done)} pathLength={100} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" className="mt-draw" />}
          <line x1="1110" y1="180" x2="1110" y2="128" stroke={C.ink} strokeWidth="2.5" />
          <path d="M1110 130 L1150 142 L1110 154Z" fill="#F5B400" />
          {PT.map((p, i) => {
            const st = cur === null ? 'next' : i < cur ? 'done' : i === cur ? 'cur' : 'next';
            const label = `${i + 1}. ${MICRO[i]!.name}`, fs = st === 'cur' ? 17 : 15, w = label.length * fs * 0.56 + 28, h = st === 'cur' ? 56 : 34;
            const bx = p.l ? p.x - 30 - w : p.x + 30, by = p.y - h / 2;
            const delay = cur === null ? 0 : (i / Math.max(1, cur)) * 1.6;
            return (
              <g key={i} className="mt-pop cursor-pointer" style={{ animationDelay: `${st === 'next' ? 1.8 : delay}s` }} onClick={() => setSel(sel === i ? null : i)} role="button" aria-label={`${label}${st === 'cur' ? ' · etapa atual' : st === 'done' ? ' · concluída' : ''}`}>
                {st === 'done' && <><circle cx={p.x} cy={p.y} r="14" fill="#fff" /><path d={`M${p.x - 6} ${p.y} L${p.x - 1.5} ${p.y + 4.5} L${p.x + 6.5} ${p.y - 4.5}`} fill="none" stroke={C.ok} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></>}
                {st === 'cur' && <><circle cx={p.x} cy={p.y} r="24" fill="#fff" opacity=".35" className="mt-pulse" /><circle cx={p.x} cy={p.y} r="16" fill="#fff" /><circle cx={p.x} cy={p.y} r="9" fill={C.blue} /></>}
                {st === 'next' && <circle cx={p.x} cy={p.y} r="10" fill="#fff" stroke={C.m3} strokeWidth="3" />}
                <rect x={bx + 2} y={by + 3} width={w} height={h} fill="#0B1A2A" opacity=".18" />
                <rect x={bx} y={by} width={w} height={h} fill={st === 'cur' ? C.blue : '#fff'} stroke={sel === i ? C.ink : 'none'} strokeWidth="2" />
                <text x={bx + 14} y={by + (st === 'cur' ? 24 : 22)} fontSize={fs} fontWeight={st === 'next' ? 500 : 600} fill={st === 'cur' ? '#fff' : st === 'next' ? C.muted : C.ink}>{label}</text>
                {st === 'cur' && <text x={bx + 14} y={by + 45} fontSize="13" fill="#CFE0F2">Estamos aqui</text>}
              </g>
            );
          })}
          <text x="80" y="120" fontSize="44" fontWeight="700" fill={C.ink}>Nossa jornada juntos</text>
          <text x="80" y="160" fontSize="20" fill={C.muted}>{sub.length > 70 ? sub.slice(0, 69) + '…' : sub}</text>
          <g transform="translate(80 230)">
            <circle cx="8" cy="0" r="8" fill="#fff" stroke={C.ok} strokeWidth="2" /><text x="26" y="5" fontSize="15" fill={C.ink}>Etapas concluídas</text>
            <circle cx="8" cy="34" r="8" fill={C.blue} /><text x="26" y="39" fontSize="15" fill={C.ink}>Etapa atual</text>
            <circle cx="8" cy="68" r="7" fill="#fff" stroke={C.m3} strokeWidth="2" /><text x="26" y="73" fontSize="15" fill={C.ink}>Próximas etapas</text>
          </g>
          <g transform="translate(80 370)" fontSize="14">
            <text fontWeight="600" fill={C.ink}>Base</text><text y="20" fill={C.muted}>{MACRO[0]!.name} · etapas 1 a 4</text>
            <text y="56" fontWeight="600" fill={C.ink}>Subida</text><text y="76" fill={C.muted}>{MACRO[1]!.name} · etapas 5 e 6</text>
            <text y="112" fontWeight="600" fill={C.ink}>Cume</text><text y="132" fill={C.muted}>{MACRO[2]!.name} e renovação · etapa 7</text>
          </g>
          {cur === null && <text x="80" y="560" fontSize="14" fill={C.muted}>{model.stage.name ? `Etapa registrada (“${model.stage.name}”) fora das 7 etapas do playbook.` : 'Etapa atual ainda não registrada.'}</text>}
          {model.demo && <text x="1520" y="870" textAnchor="end" fontSize="12" fill="#fff" opacity=".85">Dados fictícios</text>}
        </svg>

        <button type="button" onClick={toggleFull} className="absolute right-3 top-3 inline-flex items-center gap-1.5 border border-line bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-white" aria-label={full ? 'Sair da tela cheia' : 'Apresentar em tela cheia'}>
          {full ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}{full ? 'Sair' : 'Apresentar'}
        </button>

        {sel !== null && <StepCard i={sel} model={model} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

/** cartão de uma etapa: situação, data de entrada e marcos (datas). Adequado para mostrar ao cliente. */
function StepCard({ i, model, onClose }: { i: number; model: JModel; onClose: () => void }) {
  const cur = model.stage.micro;
  const entries = model.stageHistory.filter((h) => h.micro === i);
  const entered = i === cur ? model.stage.enteredAt ?? entries[entries.length - 1]?.at ?? null : entries[entries.length - 1]?.at ?? null;
  const ms = model.milestones.filter((m) => m.micro === i);
  const status = cur === null ? 'Sem registro' : i < cur ? 'Concluída' : i === cur ? 'Em andamento' : 'Próxima etapa';
  return (
    <div className="absolute bottom-4 right-4 w-[340px] border border-line bg-white p-4 shadow-[0_12px_32px_rgba(45,51,57,0.18)]">
      <button type="button" onClick={onClose} className="absolute right-2 top-2 p-1 text-muted hover:text-ink" aria-label="Fechar"><X className="h-4 w-4" /></button>
      <p className="text-xs text-muted">{MACRO[MICRO[i]!.macro]!.name} · etapa {i + 1}</p>
      <p className="mt-0.5 text-lg font-semibold text-ink">{MICRO[i]!.name}</p>
      <p className="mt-1 text-sm text-text">{MICRO[i]!.goal}</p>
      <div className="mt-3 flex justify-between border-t border-line pt-2 text-sm"><span className="text-muted">Situação</span><span className="font-semibold text-ink">{status}</span></div>
      <div className="flex justify-between border-t border-line py-2 text-sm"><span className="text-muted">Início da etapa</span><span className="text-ink">{entered ? fmtDate(entered) : 'Dado não disponível'}</span></div>
      {ms.length > 0 && (
        <ul className="border-t border-line pt-2 text-sm">
          {ms.map((m) => <li key={m.id} className="flex justify-between gap-3 py-0.5"><span className={m.doneAt ? 'text-ink' : 'text-muted'}>{m.doneAt ? '✓ ' : ''}{m.title}</span><span className="flex-none text-muted">{m.doneAt ? fmtDate(m.doneAt) : m.plannedAt ? `prev. ${fmtDate(m.plannedAt)}` : '—'}</span></li>)}
        </ul>
      )}
    </div>
  );
}
