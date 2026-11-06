/**
 * Gamificação colaborativa: Selo BK de Qualidade (medalha de ouro da maior nota do ano), pódio animado e o resumo do time
 * (média e dispersão) — o pódio nunca aparece sozinho: o resultado do time vem junto.
 */
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { Avatar } from '../../components/ui/primitives';

export type DispersionTone = 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';
export type Role = 'colaborador' | 'lideranca';
export type Member = { userId: string; name: string; hasPhoto: boolean; role: Role; own: number; direct: number; participation: number; teamAverage: number; score: number; level?: string | null };
export type TeamRow = { teamId: string; name: string; points: number; average: number; leads: string[]; dispersion: { cv: number | null; tone: DispersionTone; min: number; max: number } | null; members: Member[] };
export type Board = { teams: TeamRow[]; people: Member[]; podium: (Member & { place: number })[] };
export type GamSettings = { hierarchyWeights: Record<Role, { ownBp: number; teamBp: number }>; participationMultiplierBp: number; dispersionYellowBp: number; dispersionRedBp: number; points: Record<string, number>; levels: { name: string; minPoints: number }[]; teamIds: string[] };
export type GamData = {
  pending: boolean; proposal: { version: number; note: string; canDecide: boolean } | null;
  settings: GamSettings | null; settingsVersion: number | null; canConfigure: boolean; month: string; year: number; monthBoard: Board | null; yearBoard: Board | null;
  gold: { userId: string; name: string; score: number }[]; me: { score: number; level: string | null; rank: number; gold: boolean } | null; eventTypes: string[];
};

export const useGamification = (month?: string) => useQuery({ queryKey: ['gamificacao', month ?? ''], queryFn: () => api<GamData>(`/times/gamificacao${month ? `?month=${month}` : ''}`), staleTime: 60_000 });
export const useSelo = () => useQuery({ queryKey: ['selo'], queryFn: () => api<{ gold: boolean; year: number; score: number | null }>('/me/selo'), staleTime: 5 * 60_000 });

export const fmtPts = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
export const DISPERSION_LABEL: Record<DispersionTone, string> = { verde: 'Time nivelado', amarelo: 'Atenção: time desigual', vermelho: 'Problema: time muito desigual', sem_dados: 'Sem dados suficientes' };
export const DISPERSION_STYLE: Record<DispersionTone, string> = { verde: 'border-[#15803D] bg-[#ECFDF3] text-[#166534]', amarelo: 'border-[#B45309] bg-[#FFF7E6] text-[#92400E]', vermelho: 'border-danger bg-danger-soft text-danger', sem_dados: 'border-line bg-surface-2 text-muted' };

/** Medalha de ouro com o Selo BK de Qualidade (SVG próprio; cores da marca + ouro). */
export function BkGoldMedal({ size = 64, year, title = 'Selo BK de Qualidade' }: { size?: number; year?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size * 1.3} viewBox="0 0 100 130" role="img" aria-label={`${title}${year ? ` ${year}` : ''}`}>
      <title>{`${title}${year ? ` ${year}` : ''}`}</title>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F8E08E" /><stop offset=".45" stopColor="#D4A62A" /><stop offset="1" stopColor="#9A7212" /></linearGradient>
        <linearGradient id={`r${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2F5986" /><stop offset="1" stopColor="#1F3D5E" /></linearGradient>
      </defs>
      {/* fitas */}
      <path d="M30 0 L48 0 L56 46 L40 50 Z" fill={`url(#r${id})`} />
      <path d="M70 0 L52 0 L44 46 L60 50 Z" fill="#2D3339" />
      {/* medalha */}
      <circle cx="50" cy="82" r="40" fill={`url(#g${id})`} stroke="#8A6610" strokeWidth="2" />
      <circle cx="50" cy="82" r="31" fill="none" stroke="#FFF3C4" strokeWidth="1.5" strokeDasharray="2 3" />
      <text x="50" y="90" textAnchor="middle" fontFamily="Saira, Arial, sans-serif" fontWeight="800" fontSize="26" fill="#2D3339">BK</text>
      <text x="50" y="104" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="7" letterSpacing=".6" fill="#2D3339">QUALIDADE</text>
      {year && <text x="50" y="70" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="8" fill="#2D3339">{year}</text>}
    </svg>
  );
}

/** Selo pequeno ao lado do nome (topo do sistema), só para quem tem a maior nota do ano. */
export function HeaderSelo() {
  const q = useSelo();
  if (!q.data?.gold) return null;
  return <Link to="/times/gamificacao" className="hidden items-center md:flex" title={`Selo BK de Qualidade ${q.data.year}: maior nota do ano`}><BkGoldMedal size={26} year={q.data.year} /></Link>;
}

/** Destaque na tela inicial da pessoa com a medalha de ouro. */
export function SeloHighlight() {
  const q = useSelo();
  if (!q.data?.gold) return null;
  return (
    <section aria-label="Selo BK de Qualidade" className="selo-card mb-4 flex items-center gap-4 border border-[#D4A62A] bg-gradient-to-r from-[#FFF8E1] to-surface p-4">
      <BkGoldMedal size={56} year={q.data.year} />
      <div>
        <p className="font-display text-lg font-bold text-ink">Medalha de ouro · Selo BK de Qualidade {q.data.year}</p>
        <p className="text-sm text-muted">Maior nota do ano na gamificação ({fmtPts(q.data.score ?? 0)} pontos), que soma o seu resultado e o do seu time. Obrigado por puxar o time junto.</p>
      </div>
    </section>
  );
}

/** Pódio animado: barras sobem em sequência (3º, 2º, 1º); respeita "reduzir movimento". */
export function Podium({ people, label }: { people: (Member & { place: number })[]; label: string }) {
  const order = [people.find((p, i) => i === 1), people[0], people.find((p, i) => i === 2)];
  const H = { 1: 120, 2: 88, 3: 64 } as Record<number, number>;
  const color = { 1: 'bg-[#D4A62A]', 2: 'bg-[#A7B0BA]', 3: 'bg-[#B87333]' } as Record<number, string>;
  if (!people.length) return <p className="py-6 text-center text-sm text-muted">Ainda sem pontos em {label}.</p>;
  return (
    <div className="podium flex items-end justify-center gap-2 pt-4" role="list" aria-label={`Pódio de ${label}`}>
      {order.map((p, i) => p ? (
        <div key={p.userId} role="listitem" aria-label={`${p.place}º lugar: ${p.name}, ${fmtPts(p.score)} pontos`} className="flex w-[30%] flex-col items-center">
          <span className={clsx('podium-name mb-1', `podium-d${i}`)}><Avatar name={p.name} userId={p.userId} hasPhoto={p.hasPhoto} size={p.place === 1 ? 52 : 42} className={p.place === 1 ? 'ring-2 ring-[#D4A62A]' : ''} /></span>
          <span className={clsx('podium-name mb-1 line-clamp-2 text-center text-xs font-semibold text-ink', `podium-d${i}`)}>{p.name}</span>
          <span className={clsx('podium-name num mb-1 text-xs text-muted', `podium-d${i}`)}>{fmtPts(p.score)} pts</span>
          <div className={clsx('podium-bar flex w-full items-start justify-center pt-1 font-display text-xl font-extrabold text-white', color[p.place] ?? color[3], `podium-d${i}`)} style={{ height: H[p.place] ?? 64 }}>{p.place}º</div>
        </div>
      ) : <div key={`v${i}`} className="w-[30%]" />)}
    </div>
  );
}

/** Lateral direita da Visão geral: pódio do mês + resumo colaborativo de cada time (média e, para a liderança, dispersão). */
export function TeamPodiumAside() {
  const q = useGamification();
  if (q.isLoading || q.isError || !q.data) return null;
  const d = q.data;
  if (d.pending || !d.monthBoard || !d.settings) return (
    <aside aria-label="Gamificação do time"><section className="card p-4">
      <h2 className="font-display text-lg font-bold text-ink">Gamificação</h2>
      <p className="mt-1 text-sm text-muted">A regra de pontuação está aguardando aprovação. O pódio aparece assim que ela for aprovada.</p>
      <Link to="/times/gamificacao" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">{d.proposal?.canDecide ? 'Revisar e aprovar a regra' : 'Ver a proposta'}</Link>
    </section></aside>
  );
  const monthName = new Date(`${d.month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  return (
    <aside aria-label="Gamificação do time" className="space-y-4">
      <section className="card p-4">
        <div className="flex items-baseline justify-between"><h2 className="font-display text-lg font-bold text-ink">Pódio de {monthName}</h2><Link to="/times/gamificacao" className="text-sm font-semibold text-primary hover:underline">Ver tudo</Link></div>
        <Podium people={d.monthBoard.podium} label={monthName} />
        <p className="mt-3 text-xs text-muted">A média do time entra na nota de todos ({d.settings.hierarchyWeights.colaborador.teamBp / 100}% para colaboradores, {d.settings.hierarchyWeights.lideranca.teamBp / 100}% para a liderança). Ajudar colega vale {fmtPts(d.settings.participationMultiplierBp / 10_000)}×.</p>
      </section>
      <section className="card p-4" aria-label="Times no mês">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Times no mês</h2>
        <ul className="space-y-2">
          {d.monthBoard.teams.map((t) => (
            <li key={t.teamId} className="border border-line p-2">
              <p className="flex items-baseline justify-between text-sm"><span className="font-semibold text-ink">{t.name}</span><span className="num text-muted">média {fmtPts(t.average)}</span></p>
              {t.dispersion && <p className={clsx('mt-1 border-l-4 px-2 py-0.5 text-xs font-semibold', DISPERSION_STYLE[t.dispersion.tone])}>{DISPERSION_LABEL[t.dispersion.tone]}{t.dispersion.cv != null && ` · dispersão ${Math.round(t.dispersion.cv * 100)}%`}</p>}
            </li>
          ))}
        </ul>
      </section>
      {d.gold.length > 0 && (
        <section className="card flex items-center gap-3 p-4" aria-label="Medalha de ouro do ano">
          <BkGoldMedal size={40} year={d.year} />
          <p className="text-sm"><span className="font-semibold text-ink">{d.gold.map((g) => g.name).join(', ')}</span><br /><span className="text-muted">Selo BK de Qualidade {d.year}</span></p>
        </section>
      )}
    </aside>
  );
}
