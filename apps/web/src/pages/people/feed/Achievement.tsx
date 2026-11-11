/**
 * Cartões animados do feed (como as celebrações do LinkedIn): venda fechada, badge conquistado e reconhecimento.
 * Mostram pessoa, pontos e badges — nunca valores de venda. A animação roda ao aparecer na tela.
 */
import { useEffect, useRef, useState } from 'react';
import { Trophy } from 'lucide-react';
import { Avatar } from '../../../components/ui/primitives';
import type { FeedPost } from './api';

type Badge = { key: string; name: string; tier: string; tierIndex?: number };
type Meta =
  | { type: 'venda'; points: number | null; client: string | null; badges: Badge[] }
  | { type: 'badge'; badge: Badge & { description?: string }; year: number }
  | { type: 'reconhecimento'; to: { id: string; name: string }; category: { name: string; emoji: string } };

export const BADGE_LOOK: Record<string, { emoji: string; from: string; to: string }> = {
  humanizacao: { emoji: '🤝', from: '#F472B6', to: '#BE185D' },
  excelencia: { emoji: '🏅', from: '#FBBF24', to: '#B45309' },
  dinamismo: { emoji: '⚡', from: '#4FBBFF', to: '#2F5986' },
  crescimento: { emoji: '🚀', from: '#34D399', to: '#047857' },
  compromisso: { emoji: '🎯', from: '#A78BFA', to: '#6D28D9' },
};
const look = (k: string) => BADGE_LOOK[k] ?? { emoji: '🏆', from: '#FBBF24', to: '#B45309' };

const CSS = `
@keyframes ach-burst { 0% { transform: translate(0,0) scale(.2); opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0 } }
@keyframes ach-pop { 0% { transform: scale(.4); opacity: 0 } 60% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1) } }
@keyframes ach-rise { 0% { transform: translateY(18px); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
@keyframes ach-float { 0%,100% { transform: translateY(0) rotate(var(--r)) } 50% { transform: translateY(-10px) rotate(var(--r)) } }
@keyframes ach-spin { 0% { transform: rotateY(90deg) scale(.6); opacity: 0 } 70% { transform: rotateY(-12deg) scale(1.05); opacity: 1 } 100% { transform: rotateY(0) scale(1) } }
@keyframes ach-shine { 0% { transform: translateX(-120%) skewX(-20deg) } 100% { transform: translateX(220%) skewX(-20deg) } }
@keyframes ach-twinkle { 0%,100% { opacity: .2; transform: scale(.7) } 50% { opacity: 1; transform: scale(1.1) } }
.ach-run .ach-burst i { animation: ach-burst 1.4s var(--d) ease-out both }
.ach-run .ach-pop { animation: ach-pop .7s .15s cubic-bezier(.2,.9,.3,1.2) both }
.ach-run .ach-rise { animation: ach-rise .6s var(--d, .35s) ease-out both }
.ach-run .ach-spin { animation: ach-spin 1s .1s ease-out both }
.ach-run .ach-shine::after { content: ''; position: absolute; inset: 0; width: 40%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent); animation: ach-shine 1.6s .9s ease-in-out both }
.ach-hex { animation: ach-float 6s ease-in-out infinite }
.ach-star { animation: ach-twinkle 2.4s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .ach-run *, .ach-run .ach-shine::after, .ach-hex, .ach-star { animation: none !important } .ach-burst { display: none } }
`;

/** Roda a animação quando o cartão aparece na tela (uma vez). */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setOn(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on] as const;
}

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 1200); setN(to * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  return <>{n.toLocaleString('pt-BR', { maximumFractionDigits: to % 1 ? 1 : 0 })}</>;
}

const COLORS = ['#C6F432', '#4FBBFF', '#FBBF24', '#F472B6', '#FFFFFF', '#34D399'];
function Bursts({ n = 3 }: { n?: number }) {
  return (
    <div className="ach-burst pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: n }).flatMap((_, b) => Array.from({ length: 14 }, (_, i) => {
        const ang = (Math.PI * 2 * i) / 14, dist = 50 + (i % 3) * 18;
        const cx = [22, 78, 52][b % 3]!, cy = [30, 26, 60][b % 3]!;
        return <i key={`${b}-${i}`} className="absolute block h-1.5 w-1.5 rounded-circle" style={{ left: `${cx}%`, top: `${cy}%`, background: COLORS[(i + b) % COLORS.length], ['--dx' as string]: `${Math.cos(ang) * dist}px`, ['--dy' as string]: `${Math.sin(ang) * dist}px`, ['--d' as string]: `${0.2 + b * 0.35}s` }} />;
      }))}
    </div>
  );
}
function Decor() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {[[8, 70, 64, -8], [82, 12, 88, 14], [64, 74, 46, 24]].map(([x, y, s, r], i) => (
        <svg key={i} viewBox="0 0 100 100" className="ach-hex absolute opacity-25" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, ['--r' as string]: `${r}deg`, animationDelay: `${i * 0.8}s` }}><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="none" stroke="#4FBBFF" strokeWidth="5" /></svg>
      ))}
      {[[12, 18], [30, 80], [70, 40], [90, 64], [46, 14]].map(([x, y], i) => <span key={i} className="ach-star absolute text-xs text-white/80" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.5}s` }}>✦</span>)}
    </div>
  );
}

export function isAchievement(p: FeedPost) { return !!p.meta && ['venda', 'badge', 'reconhecimento'].includes((p.meta as { type?: string }).type ?? ''); }

export function AchievementArt({ post }: { post: FeedPost }) {
  const [ref, run] = useInView<HTMLDivElement>();
  const meta = post.meta as unknown as Meta;
  const first = post.author.name.split(' ')[0];
  return (
    <div ref={ref} className={run ? 'ach-run' : ''}>
      <style>{CSS}</style>
      {meta.type === 'venda' && (
        <div className="relative overflow-hidden bg-gradient-to-br from-navy via-[#244a72] to-primary px-6 py-8 text-center text-white" role="img" aria-label={`Venda fechada por ${post.author.name}${meta.points ? `, ${meta.points} pontos` : ''}`}>
          <Decor /><Bursts n={3} />
          <div className="ach-pop relative mx-auto w-fit">
            <Avatar name={post.author.name} userId={post.author.id} hasPhoto={post.author.hasPhoto} size={96} className="ring-4 ring-lime ring-offset-4 ring-offset-navy" />
            <span className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-circle bg-lime text-navy shadow"><Trophy className="h-5 w-5" aria-hidden /></span>
          </div>
          <p className="ach-rise relative mt-4 font-display text-2xl font-bold tracking-wide" style={{ ['--d' as string]: '.45s' }}>Venda fechada!</p>
          <p className="ach-rise relative text-sm text-white/85" style={{ ['--d' as string]: '.6s' }}>Parabéns, {first}!{meta.client ? ` ${meta.client} agora é cliente.` : ''}</p>
          {meta.points != null && meta.points > 0 && (
            <p className="ach-rise relative mt-4 inline-flex items-baseline gap-1.5 bg-white/10 px-4 py-2" style={{ ['--d' as string]: '.75s' }}>
              <span className="num font-display text-3xl font-bold text-lime">+<CountUp to={meta.points} run={run} /></span><span className="text-sm text-white/85">pontos nesta conquista</span>
            </p>
          )}
          {meta.badges?.length > 0 && (
            <div className="ach-rise relative mt-3 flex flex-wrap justify-center gap-2" style={{ ['--d' as string]: '.95s' }}>
              {meta.badges.map((b) => <span key={b.key} className="ach-shine relative overflow-hidden px-3 py-1 text-xs font-bold text-white" style={{ background: `linear-gradient(135deg, ${look(b.key).from}, ${look(b.key).to})` }}>{look(b.key).emoji} Badge {b.name} · {b.tier}</span>)}
            </div>
          )}
        </div>
      )}
      {meta.type === 'badge' && (
        <div className="relative overflow-hidden bg-gradient-to-br from-navy to-[#1b2a3a] px-6 py-8 text-center text-white" role="img" aria-label={`${post.author.name} conquistou o badge ${meta.badge.name}, ${meta.badge.tier}`}>
          <Decor /><Bursts n={2} />
          <div className="ach-spin ach-shine relative mx-auto flex h-32 w-32 items-center justify-center overflow-hidden rounded-circle border-4 border-white/70 shadow-xl" style={{ background: `radial-gradient(circle at 30% 30%, ${look(meta.badge.key).from}, ${look(meta.badge.key).to})`, perspective: 600 }}>
            <span className="text-6xl drop-shadow" aria-hidden>{look(meta.badge.key).emoji}</span>
          </div>
          <p className="ach-rise relative mt-4 font-display text-2xl font-bold tracking-wide" style={{ ['--d' as string]: '.7s' }}>Badge {meta.badge.name}</p>
          <p className="ach-rise relative text-sm text-white/85" style={{ ['--d' as string]: '.85s' }}>{meta.badge.tier} · {meta.year}</p>
        </div>
      )}
      {meta.type === 'reconhecimento' && (
        <div className="relative overflow-hidden bg-gradient-to-br from-primary to-navy px-6 py-6 text-center text-white" role="img" aria-label={`${post.author.name} reconheceu ${meta.to.name} em ${meta.category.name}`}>
          <Decor /><Bursts n={1} />
          <span className="ach-pop relative inline-block text-6xl" aria-hidden>{meta.category.emoji}</span>
          <p className="ach-rise relative mt-2 text-xs font-semibold uppercase tracking-wider text-lime" style={{ ['--d' as string]: '.45s' }}>{meta.category.name}</p>
          <p className="ach-rise relative mt-1 font-display text-xl font-bold tracking-wide" style={{ ['--d' as string]: '.6s' }}>{first} reconheceu {meta.to.name.split(' ')[0]}</p>
        </div>
      )}
      <p className="border-b border-line bg-surface-2 px-4 py-2 text-center text-sm font-semibold text-text">
        {meta.type === 'venda' ? 'Fechou uma nova venda' : meta.type === 'badge' ? `Conquistou o badge ${meta.badge.name}` : `Reconheceu ${meta.to.name}`}
      </p>
    </div>
  );
}
