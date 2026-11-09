/**
 * Gamificação colaborativa, sem ranking nem pódio (decisão: comparação pública pode constranger quem não fica em primeiro).
 * Só o primeiro lugar do ano é reconhecido, com o Badge Ouro. Cada pessoa vê a própria nota; a liderança vê o próprio time.
 */
import type { BadgeDef, BadgeProgress } from '@isp/domain';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, Circle, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, LoadingRows } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

export type DispersionTone = 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';
export type MemberScore = {
  userId: string; levelKey: string; levelName: string; lead: boolean;
  direct: number; participation: number; journey: number; extra: number; points: number; expected: number;
  attainment: number; extraAttainment: number; own: number; teamAverage: number; dispersionScore: number; area: number; score: number;
  tasks: number; wins: number;
};
export type Member = MemberScore & { name: string; hasPhoto: boolean };
export type TeamRow = { teamId: string; name: string; points: number; average: number; canManage: boolean; dispersion: { cv: number | null; tone: DispersionTone; min: number; max: number } | null; members: Member[] | null };
export type Board = { teams: TeamRow[]; me: MemberScore | null };
export type JourneyComponentDef = { key: string; name: string; stageKey: string | null; points: number; dueDays: number; level?: string | null };
export type JourneyDef = { key: string; name: string; pipelineId: string; wonPoints: number; components: JourneyComponentDef[] };
export type CompetencyLevel = { key: string; name: string; rank: number; expectedMonthlyPoints: number; scoresTasks: boolean; weights: { ownBp: number; teamBp: number; dispersionBp: number; areaBp: number } };
export type Bonuses = { onTimeBp: number; adherenceBp: number; extraPerLevelBp: number; extraCapBp: number; scoreCapBp: number };
export type GamSettings = {
  journeys: JourneyDef[]; teamIds: string[]; points: Record<string, number>; participationMultiplierBp: number;
  competencyLevels: CompetencyLevel[]; assignments: Record<string, string>; defaultLevelKey: string; defaultLeadLevelKey: string; bonuses: Bonuses;
  dispersionYellowBp: number; dispersionRedBp: number; levels: { name: string; minPoints: number }[];
  performanceWeights: Record<string, { activity: number; individual: number; team: number; unit: number; company: number }>;
  performanceBands: { greenBp: number; yellowBp: number };
  /** Pedido de Apoio */
  support?: { helperMultiplierBp: number; basePoints: number; requesterPoints: number; monthlyCapPoints: number };
  certificates?: { pointsPerCertificate: number; pointsPerHourTenths: number; maxHoursCounted: number; monthlyCapPoints: number };
  badges?: BadgeDef[];
};
/** "60% próprio + 40% time + …" */
export const compositionText = (l: CompetencyLevel) => [[l.weights.ownBp, 'próprio'], [l.weights.teamBp, 'média do time'], [l.weights.dispersionBp, 'dispersão do time'], [l.weights.areaBp, 'área']].filter(([w]) => (w as number) > 0).map(([w, n]) => `${(w as number) / 100}% ${n}`).join(' + ');
export const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export type GamData = {
  pending: boolean; proposal: { version: number; note: string; canDecide: boolean } | null;
  settings: GamSettings | null; settingsVersion: number | null; canConfigure: boolean; month: string; year: number; monthBoard: Board | null; yearBoard: Board | null;
  gold: { userId: string; name: string }[]; me: { score: number; level: string | null; gold: boolean } | null; myBadges?: BadgeProgress[]; eventTypes: string[];
};

export const useGamification = (month?: string) => useQuery({ queryKey: ['gamificacao', month ?? ''], queryFn: () => api<GamData>(`/times/gamificacao${month ? `?month=${month}` : ''}`), staleTime: 60_000 });
export const useSelo = () => useQuery({ queryKey: ['selo'], queryFn: () => api<{ gold: boolean; year: number; score: number | null }>('/me/selo'), staleTime: 5 * 60_000 });

export const fmtPts = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
export const DISPERSION_LABEL: Record<DispersionTone, string> = { verde: 'Time nivelado', amarelo: 'Atenção: time desigual', vermelho: 'Problema: time muito desigual', sem_dados: 'Sem dados suficientes' };
export const DISPERSION_STYLE: Record<DispersionTone, string> = { verde: 'border-[#15803D] bg-[#ECFDF3] text-[#166534]', amarelo: 'border-[#B45309] bg-[#FFF7E6] text-[#92400E]', vermelho: 'border-danger bg-danger-soft text-danger', sem_dados: 'border-line bg-surface-2 text-muted' };

/** Badge Ouro: badge hexagonal em ouro, no mesmo formato das demais badges (sem medalha nem fita). */
export function BkGoldMedal({ size = 64, year, title = 'Badge Ouro' }: { size?: number; year?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  const hex = '50,4 90,27 90,73 50,96 10,73 10,27';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${title}${year ? ` ${year}` : ''}`}>
      <title>{`${title}${year ? ` ${year}` : ''}`}</title>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F8E08E" /><stop offset=".45" stopColor="#D4A62A" /><stop offset="1" stopColor="#9A7212" /></linearGradient>
      </defs>
      <polygon points={hex} fill={`url(#g${id})`} stroke="#8A6610" strokeWidth="3" />
      <polygon points="50,14 81,32 81,68 50,86 19,68 19,32" fill="none" stroke="#FFF3C4" strokeWidth="1.5" strokeDasharray="2 3" />
      <path d="M36 31 L42 37 L50 27 L58 37 L64 31 L62 42 L38 42 Z" fill="#2D3339" />
      <text x="50" y="64" textAnchor="middle" fontFamily="Saira, Arial, sans-serif" fontWeight="800" fontSize="22" fill="#2D3339">BK</text>
      {year ? <text x="50" y="77" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="8" letterSpacing=".6" fill="#2D3339">OURO {year}</text>
        : <text x="50" y="77" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="8" letterSpacing="1.2" fill="#2D3339">OURO</text>}
    </svg>
  );
}

/** Selo pequeno ao lado do nome (topo do sistema), só para quem tem a maior nota do ano. */
export function HeaderSelo() {
  const q = useSelo();
  if (!q.data?.gold) return null;
  return <Link to="/times/pessoas?aba=gamificacao" className="hidden items-center md:flex" title={`Badge Ouro ${q.data.year}: vencedor do ano`}><BkGoldMedal size={26} year={q.data.year} /></Link>;
}

/** Destaque na tela inicial da pessoa com o Badge Ouro. */
export function SeloHighlight() {
  const q = useSelo();
  if (!q.data?.gold) return null;
  return (
    <section aria-label="Badge Ouro" className="selo-card mb-4 flex items-center gap-4 border border-[#D4A62A] bg-gradient-to-r from-[#FFF8E1] to-surface p-4">
      <BkGoldMedal size={56} year={q.data.year} />
      <div>
        <p className="font-display text-lg font-bold text-ink">Badge Ouro {q.data.year}</p>
        <p className="text-sm text-muted">Maior nota do ano ({fmtPts(q.data.score ?? 0)} pontos), que soma o seu resultado e o do seu time. Obrigado por puxar o time junto.</p>
      </div>
    </section>
  );
}

/** Lateral direita da Visão geral: resultado de cada time (média; dispersão para a liderança) e o selo do ano. Sem pódio. */
export function TeamPodiumAside() {
  const q = useGamification();
  if (q.isLoading || q.isError || !q.data) return null;
  const d = q.data;
  if (d.pending || !d.monthBoard || !d.settings) return (
    <aside aria-label="Gamificação do time"><section className="card p-4">
      <h2 className="font-display text-lg font-bold text-ink">Gamificação</h2>
      <p className="mt-1 text-sm text-muted">A regra de pontuação está aguardando aprovação.</p>
      <Link to="/times/pessoas?aba=gamificacao" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">{d.proposal?.canDecide ? 'Revisar e aprovar a regra' : 'Ver a proposta'}</Link>
    </section></aside>
  );
  const monthName = new Date(`${d.month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  return (
    <aside aria-label="Gamificação do time" className="space-y-4">
      {d.gold.length > 0 && (
        <section className="card flex items-center gap-3 p-4" aria-label="Badge Ouro do ano">
          <BkGoldMedal size={44} year={d.year} />
          <p className="text-sm"><span className="font-semibold text-ink">{d.gold.map((g) => g.name).join(', ')}</span><br /><span className="text-muted">Badge Ouro {d.year}: vencedor do ano</span></p>
        </section>
      )}
      <section className="card p-4" aria-label="Times no mês">
        <div className="flex items-baseline justify-between"><h2 className="font-display text-lg font-bold text-ink">Times em {monthName}</h2><Link to="/times/pessoas?aba=gamificacao" className="text-sm font-semibold text-primary hover:underline">Minha nota</Link></div>
        <ul className="mt-2 space-y-2">
          {d.monthBoard.teams.map((t) => (
            <li key={t.teamId} className="border border-line p-2">
              <p className="flex items-baseline justify-between text-sm"><span className="font-semibold text-ink">{t.name}</span><span className="num text-muted">média {fmtPct(t.average)}</span></p>
              {t.dispersion && <p className={clsx('mt-1 border-l-4 px-2 py-0.5 text-xs font-semibold', DISPERSION_STYLE[t.dispersion.tone])}>{DISPERSION_LABEL[t.dispersion.tone]}{t.dispersion.cv != null && ` · dispersão ${Math.round(t.dispersion.cv * 100)}%`}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">A média do time entra na nota de todos. Sem ranking: cada pessoa vê a própria nota.</p>
      </section>
    </aside>
  );
}

type ScoreData = {
  journey: { key: string; name: string; wonPoints: number } | null;
  components?: { key: string; name: string; stageKey: string | null; points: number; level: string | null; task: { id: string; title: string; done: boolean; completedAt: string | null; dueAt: string | null; by: string | null; qualification: 'aprovada' | 'reprovada' | null; canQualify: boolean; earned: number; extra: boolean; bonus: { onTime: boolean; adherence: boolean; levelsAbove: number } | null } | null }[];
  earned?: number; won?: boolean; winShare?: { userId: string; name: string | null; points: number }[];
};

/** Oportunidade → Tarefas: pontos da jornada (cada tarefa com peso, situação e quem fez; peso do ganho e a divisão). */
export function JourneyScore({ oppId, onOpen, editable }: { oppId: string; onOpen: (id: string) => void; editable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['tasks', 'score', oppId], queryFn: () => api<ScoreData>(`/opportunities/${oppId}/score`) });
  const add = useMutation({
    mutationFn: (componentKey: string) => api(`/opportunities/${oppId}/score/tasks`, { method: 'POST', body: { componentKey } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tasks', 'score', oppId] }); void qc.invalidateQueries({ queryKey: ['opp-tasks'] }); void qc.invalidateQueries({ queryKey: ['tasks'] }); toast({ tone: 'success', message: 'Tarefa da jornada criada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const qualify = useMutation({
    mutationFn: ({ taskId, result }: { taskId: string; result: 'aprovada' | 'reprovada' | null }) => api(`/opportunities/${oppId}/score/tasks/${taskId}/qualify`, { method: 'POST', body: { result } }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['tasks'] }); toast({ tone: 'success', message: v.result === 'aprovada' ? 'Tarefa aprovada: bônus de aderência' : v.result === 'reprovada' ? 'Tarefa reprovada (os pontos da tarefa ficam)' : 'Qualificação retirada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <LoadingRows rows={2} />;
  if (!q.data?.journey) return null;
  const d = q.data;
  return (
    <section aria-label="Pontos da jornada" className="border border-line p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Pontos da jornada · {d.journey!.name}</h3>
        <span className="text-sm text-muted">feitos <span className="num font-bold text-ink">{fmtPts(d.earned ?? 0)}</span> pts · ganho vale <span className="num">{d.journey!.wonPoints}</span></span>
      </div>
      <ul className="divide-y divide-line text-sm">
        {d.components!.map((c) => (
          <li key={c.key} className="flex items-center gap-2 py-1.5">
            {c.task?.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#15803D]" aria-label="concluída" /> : <Circle className="h-4 w-4 shrink-0 text-muted" aria-label="pendente" />}
            <span className="min-w-0 flex-1">
              {c.task ? <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => onOpen(c.task!.id)}>{c.name}</button> : <span className="font-semibold text-ink">{c.name}</span>}
              <span className="block text-xs text-muted">{c.task ? (c.task.done ? `Concluída por ${c.task.by ?? '—'}${c.task.completedAt ? ` em ${fmtDate(c.task.completedAt)}` : ''}` : `Com ${c.task.by ?? '—'}${c.task.dueAt ? `, prazo ${fmtDate(c.task.dueAt)}` : ''}`) : 'Ainda não criada (nasce quando a oportunidade entra na etapa)'}{c.level && ` · alçada ${c.level}`}</span>
              {c.task?.done && (
                <span className="mt-0.5 flex flex-wrap gap-1 text-2xs font-semibold">
                  {c.task.bonus?.onTime && <span className="bg-[#ECFDF3] px-1.5 py-0.5 text-[#166534]">no prazo</span>}
                  {c.task.qualification === 'aprovada' && <span className="bg-[#ECFDF3] px-1.5 py-0.5 text-[#166534]">aprovada: aderência</span>}
                  {c.task.qualification === 'reprovada' && <span className="bg-surface-2 px-1.5 py-0.5 text-muted">reprovada</span>}
                  {c.task.extra && <span className="bg-[#FFF7E6] px-1.5 py-0.5 text-[#92400E]">crédito extra: acima da alçada</span>}
                </span>
              )}
              {c.task?.canQualify && (
                <span className="mt-1 flex gap-2 text-xs">
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => qualify.mutate({ taskId: c.task!.id, result: c.task!.qualification === 'aprovada' ? null : 'aprovada' })}>{c.task.qualification === 'aprovada' ? 'Tirar aprovação' : 'Aprovar'}</button>
                  {c.task.qualification !== 'reprovada' && <button type="button" className="font-semibold text-muted hover:underline" onClick={() => qualify.mutate({ taskId: c.task!.id, result: 'reprovada' })}>Reprovar</button>}
                </span>
              )}
            </span>
            <span className="num shrink-0 text-right font-bold text-ink" aria-label={`${c.points} pontos`}>{c.task?.done && c.task.earned !== c.points ? <>+{fmtPts(c.task.earned)} pts<span className="block text-2xs font-normal text-muted">base {c.points}</span></> : `+${c.points} pts`}</span>
            {!c.task && editable && <Button size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} loading={add.isPending} onClick={() => add.mutate(c.key)}>Criar</Button>}
          </li>
        ))}
      </ul>
      {d.won && d.winShare && d.winShare.length > 0 && <p className="mt-2 text-xs text-muted">Negócio ganho: {d.journey!.wonPoints} pts divididos entre {d.winShare.map((w) => `${w.name ?? '—'} (${fmtPts(w.points)})`).join(', ')}.</p>}
      <p className="mt-1 text-xs text-muted">Concluir a tarefa pontua quem concluiu (mais bônus se for no prazo ou aprovada pela gerência); excluir ou reabrir tira os pontos.</p>
    </section>
  );
}
