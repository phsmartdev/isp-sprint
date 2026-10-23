/**
 * Reação ao encerrar a oportunidade: comemora a venda fechada (confete) e lamenta a perda.
 * Some sozinha em alguns segundos, fecha com clique ou Esc e respeita "reduzir movimento".
 */
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Frown, PartyPopper } from 'lucide-react';

export type Outcome = { kind: 'won' | 'lost'; who: string; deal: string } | null;
const COLORS = ['#22C55E', '#3885D3', '#F5B400', '#8B5CF6', '#EF4444', '#0EA5E9'];

export function OutcomeCelebration({ outcome, onClose }: { outcome: Outcome; onClose: () => void }) {
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(onClose, outcome.kind === 'won' ? 4500 : 3500);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => { clearTimeout(t); window.removeEventListener('keydown', k); };
  }, [outcome, onClose]);
  const pieces = useMemo(() => Array.from({ length: 90 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.8, dur: 2.4 + Math.random() * 1.8, size: 6 + Math.random() * 6,
    color: COLORS[i % COLORS.length], rot: Math.random() * 360, round: Math.random() > 0.6,
  })), [outcome]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!outcome) return null;
  const won = outcome.kind === 'won';
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose} role="status" aria-live="assertive" aria-label={won ? 'Venda fechada' : 'Venda perdida'}>
      <style>{`
        @keyframes isp-confetti { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1 } 100% { transform: translateY(110vh) rotate(720deg); opacity: .9 } }
        @keyframes isp-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.06); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes isp-sink { 0% { transform: translateY(-12px); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
        @media (prefers-reduced-motion: reduce) { .isp-motion { animation: none !important } .isp-confetti { display: none } }
      `}</style>
      <div className={won ? 'absolute inset-0 bg-ink/20' : 'absolute inset-0 bg-ink/45 backdrop-grayscale'} aria-hidden />
      {won && (
        <div className="isp-confetti pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {pieces.map((p, i) => (
            <span key={i} className="isp-motion absolute top-0 block" style={{ left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? '50%' : 2, transform: `rotate(${p.rot}deg)`, animation: `isp-confetti ${p.dur}s ${p.delay}s ease-in forwards` }} />
          ))}
        </div>
      )}
      <div className="isp-motion relative w-full max-w-sm rounded-lg bg-surface p-6 text-center shadow-xl" style={{ animation: won ? 'isp-pop .45s ease-out' : 'isp-sink .5s ease-out' }}>
        <span className={won ? 'mx-auto flex h-16 w-16 items-center justify-center rounded-circle bg-success-soft text-success' : 'mx-auto flex h-16 w-16 items-center justify-center rounded-circle bg-danger-soft text-danger'} aria-hidden>
          {won ? <PartyPopper className="h-9 w-9" /> : <Frown className="h-9 w-9" />}
        </span>
        <p className="mt-3 font-display text-2xl font-bold text-ink">{won ? 'Venda fechada!' : 'Venda perdida'}</p>
        <p className="mt-1 text-sm text-text">{won ? `Parabéns, ${outcome.who}! ${outcome.deal} é nosso.` : `Que pena, ${outcome.who}. O motivo ficou registrado para a próxima abordagem.`}</p>
        <p className="mt-3 text-xs text-muted">Clique em qualquer lugar para continuar</p>
      </div>
    </div>,
    document.body,
  );
}
