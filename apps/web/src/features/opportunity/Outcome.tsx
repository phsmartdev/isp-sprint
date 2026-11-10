/**
 * Reação ao encerrar a oportunidade: comemora a venda fechada (confete, foto de quem vendeu e os pontos que a venda
 * rendeu) e lamenta a perda. Some sozinha em alguns segundos e fecha com clique ou Esc.
 */
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Frown, Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar } from '../../components/ui/primitives';

export type Outcome = { kind: 'won' | 'lost'; who: string; deal: string; oppId?: string } | null;
type Celebration = { owner: { id: string; name: string; hasPhoto: boolean }; points: { enabled: false } | { enabled: true; total: number } };
const COLORS = ['#22C55E', '#3885D3', '#F5B400', '#8B5CF6', '#EF4444', '#0EA5E9', '#C6F432'];
const n1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function OutcomeCelebration({ outcome, onClose }: { outcome: Outcome; onClose: () => void }) {
  const { me } = useAuth();
  const won = outcome?.kind === 'won';
  const cel = useQuery({
    queryKey: ['opportunity', outcome?.oppId ?? '', 'celebration'],
    queryFn: () => api<Celebration>(`/opportunities/${outcome!.oppId}/celebration`),
    enabled: won && !!outcome?.oppId,
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(onClose, outcome.kind === 'won' ? 8000 : 3500);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => { clearTimeout(t); window.removeEventListener('keydown', k); };
  }, [outcome, onClose]);
  // duas levas de confete caindo pela tela inteira
  const pieces = useMemo(() => Array.from({ length: 180 }, (_, i) => ({
    left: Math.random() * 100, delay: (i % 2 ? 1.2 : 0) + Math.random() * 1.2, dur: 2.6 + Math.random() * 2.2, size: 7 + Math.random() * 7,
    color: COLORS[i % COLORS.length], rot: Math.random() * 360, round: Math.random() > 0.6, drift: (Math.random() - 0.5) * 30,
  })), [outcome]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!outcome) return null;
  const owner = cel.data?.owner;
  const name = owner?.name || outcome.who;
  const isMe = !!owner && owner.id === me?.user.id;
  const pts = cel.data?.points;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose} role="status" aria-live="assertive" aria-label={won ? 'Venda fechada' : 'Venda perdida'}>
      <style>{`
        @keyframes isp-confetti { 0% { transform: translate(0, -10vh) rotate(0deg); opacity: 1 } 100% { transform: translate(var(--drift), 110vh) rotate(900deg); opacity: .9 } }
        @keyframes isp-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.06); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes isp-sink { 0% { transform: translateY(-12px); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
        @media (prefers-reduced-motion: reduce) { .isp-motion { animation: none !important } }
      `}</style>
      <div className={won ? 'absolute inset-0 bg-ink/25' : 'absolute inset-0 bg-ink/45 backdrop-grayscale'} aria-hidden />
      {won && (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden data-testid="confetti">
          {pieces.map((p, i) => (
            <span key={i} className="absolute top-0 block" style={{ left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? '50%' : 2, transform: 'translateY(-10vh)', ['--drift' as string]: `${p.drift}vw`, animation: `isp-confetti ${p.dur}s ${p.delay}s ease-in forwards` }} />
          ))}
        </div>
      )}
      <div className="isp-motion relative w-full max-w-md rounded-lg bg-surface p-7 text-center shadow-xl" style={{ animation: won ? 'isp-pop .45s ease-out' : 'isp-sink .5s ease-out' }}>
        {won ? (
          <>
            <div className="relative mx-auto w-fit">
              <Avatar name={name} userId={owner?.id} hasPhoto={owner?.hasPhoto} size={112} className="ring-4 ring-success ring-offset-4 ring-offset-surface" />
              <span className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-circle bg-lime text-navy shadow" aria-hidden><Trophy className="h-5 w-5" /></span>
            </div>
            <p className="mt-5 font-display text-2xl font-bold text-ink">Venda fechada!</p>
            <p className="mt-1 text-lg font-semibold text-ink" data-testid="celebration-name">Parabéns, {name}!</p>
            <p className="mt-1 text-sm text-text">{outcome.deal} é nosso.</p>
            {cel.isLoading && outcome.oppId && <p className="mt-4 text-sm text-muted">Calculando os pontos…</p>}
            {pts?.enabled && (
              <p className="mt-4 rounded-md bg-success-soft px-4 py-3 text-base text-ink" data-testid="celebration-points">
                {isMe ? 'Você ganhou' : `${name.split(' ')[0]} ganhou`} <b className="num text-xl font-extrabold text-success">{n1(pts.total)} {pts.total === 1 ? 'ponto' : 'pontos'}</b> nesta oportunidade
              </p>
            )}
          </>
        ) : (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-circle bg-danger-soft text-danger" aria-hidden><Frown className="h-9 w-9" /></span>
            <p className="mt-3 font-display text-2xl font-bold text-ink">Venda perdida</p>
            <p className="mt-1 text-sm text-text">Que pena, {outcome.who}. O motivo ficou registrado para a próxima abordagem.</p>
          </>
        )}
        <p className="mt-4 text-xs text-muted">Clique em qualquer lugar para continuar</p>
      </div>
    </div>,
    document.body,
  );
}
