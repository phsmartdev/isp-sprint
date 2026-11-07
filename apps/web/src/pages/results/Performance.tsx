/**
 * Gestão de Times → Performance por nível hierárquico: atividade (gamificação) e metas (individual, time, área, empresa)
 * com os pesos do nível de cada pessoa. A pessoa vê a própria; a liderança vê o time; quem responde pela área vê a área.
 * Sem ranking: times e pessoas em ordem alfabética.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { TrendingUp } from 'lucide-react';
import { api } from '../../lib/api';
import { Avatar, Chip, EmptyState, ErrorState, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';
import { fmtPct } from '../../features/gamification/Gamification';

type Tone = 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';
type Comp = { key: string; label: string; value: number | null; weightBp: number; effectiveBp: number; goals: number };
type Perf = { userId: string; name: string; levelKey: string; levelName: string; lead: boolean; score: number | null; tone: Tone; components: Comp[]; hasPhoto?: boolean };
type Data = {
  pending: boolean; month: string; settingsVersion?: number; bands?: { greenBp: number; yellowBp: number };
  weights?: { key: string; name: string; weights: Record<string, number> | null }[];
  me?: Perf | null; teams?: { teamId: string; name: string; unitName: string | null; average: number | null; members: Perf[] }[]; units?: { id: string; name: string; average: number | null }[];
};
const TONE: Record<Tone, string> = { verde: 'border-[#15803D] bg-[#ECFDF3] text-[#166534]', amarelo: 'border-[#B45309] bg-[#FFF7E6] text-[#92400E]', vermelho: 'border-danger bg-danger-soft text-danger', sem_dados: 'border-line bg-surface-2 text-muted' };
const TONE_LABEL: Record<Tone, string> = { verde: 'No alvo', amarelo: 'Atenção', vermelho: 'Abaixo', sem_dados: 'Sem dados' };
const COLS = ['activity', 'individual', 'team', 'unit', 'company'] as const;
const COL_SHORT: Record<(typeof COLS)[number], string> = { activity: 'Atividade', individual: 'Metas individuais', team: 'Metas do time', unit: 'Metas da área', company: 'Metas da empresa' };
const toneOf = (v: number | null, b?: Data['bands']): Tone => (v == null || !b ? 'sem_dados' : v * 100 >= b.greenBp ? 'verde' : v * 100 >= b.yellowBp ? 'amarelo' : 'vermelho');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ScoreBadge({ v, tone }: { v: number | null; tone: Tone }) {
  return <span className={clsx('num inline-block border-l-4 px-2 py-0.5 text-sm font-bold', TONE[tone])}>{v == null ? '—' : fmtPct(v)}</span>;
}

export function PerformancePage() {
  const [month, setMonth] = useState('');
  const q = useQuery({ queryKey: ['performance-hier', month], queryFn: () => api<Data>(`/times/performance${month ? `?month=${month}` : ''}`) });
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const monthName = cap(new Date(`${d.month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const header = <PageHeader icon={<TrendingUp />} title="Performance" subtitle="Por nível hierárquico: cada nível compõe a performance com pesos próprios entre atividade e metas. Quem sobe na hierarquia pesa mais o coletivo." actions={!d.pending ? <Input aria-label="Mês" type="month" className="h-10 w-[170px]" value={month || d.month} onChange={(e) => setMonth(e.target.value)} /> : undefined} />;
  if (d.pending) return <div>{header}<Notice tone="info">A regra (pontuação e pesos de performance) ainda está aguardando aprovação em Gestão de Times → Gamificação.</Notice></div>;
  const me = d.me;
  return (
    <div>
      {header}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section aria-label="Minha performance" className="card p-4">
            {!me ? <p className="text-sm text-muted">Você não está num time que participa da gestão de performance.</p> : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm text-muted">Minha performance em {monthName.toLowerCase()} · {me.levelName}</p>
                    <p className="font-display text-3xl font-extrabold text-ink"><span className="num">{me.score == null ? '—' : fmtPct(me.score)}</span></p>
                  </div>
                  <span className={clsx('border-l-4 px-2 py-1 text-sm font-semibold', TONE[me.tone])}>{TONE_LABEL[me.tone]}</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {me.components.map((c) => (
                    <li key={c.key}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-ink">{c.label}<span className="text-xs text-muted"> · peso {c.weightBp / 100}%{c.value != null && c.effectiveBp !== c.weightBp ? ` (vale ${c.effectiveBp / 100}% no mês)` : ''}{c.goals ? ` · ${c.goals} meta${c.goals > 1 ? 's' : ''}` : ''}</span></span>
                        <span className="num font-semibold">{c.value == null ? 'sem meta no mês' : fmtPct(c.value)}</span>
                      </div>
                      <div className="mt-1 h-2 bg-surface-2"><div className={clsx('h-2', toneOf(c.value, d.bands) === 'verde' ? 'bg-[#15803D]' : toneOf(c.value, d.bands) === 'amarelo' ? 'bg-[#B45309]' : 'bg-danger')} style={{ width: `${Math.min(100, ((c.value ?? 0) / 130) * 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">Componente sem meta no mês não pesa contra você: o peso dele vai para os demais. <Link className="font-semibold text-primary hover:underline" to="/meus-pontos">De onde vieram meus pontos de atividade</Link>.</p>
              </>
            )}
          </section>

          {(d.teams ?? []).length > 0 && (d.units ?? []).length > 0 && (
            <section aria-label="Áreas" className="card p-4">
              <h2 className="mb-2 text-lg font-bold text-ink">Áreas</h2>
              <ul className="flex flex-wrap gap-3">{d.units!.map((u) => <li key={u.id} className="border border-line px-3 py-2 text-sm"><span className="font-semibold text-ink">{u.name}</span> <ScoreBadge v={u.average} tone={toneOf(u.average, d.bands)} /></li>)}</ul>
            </section>
          )}
          {(d.teams ?? []).map((t) => (
            <section key={t.teamId} aria-label={`Performance do time ${t.name}`} className="card p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold text-ink">{t.name}{t.unitName && <span className="ml-2 text-sm font-normal text-muted">{t.unitName}</span>}</h2>
                <span className="text-sm text-muted">Média do time <ScoreBadge v={t.average} tone={toneOf(t.average, d.bands)} /></span>
              </div>
              <p className="mb-1 text-xs text-muted">Visível só para a liderança e a gestão, como apoio à gestão do time.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="text-xs text-muted"><tr>{['Pessoa', 'Nível', ...COLS.map((c) => COL_SHORT[c]), 'Performance'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {t.members.map((m) => (
                      <tr key={m.userId} className="border-t border-line">
                        <td className="px-2 py-1.5"><span className="flex items-center gap-2"><Avatar name={m.name} userId={m.userId} hasPhoto={m.hasPhoto} size={28} /><span className="font-semibold text-ink">{m.name}</span>{m.lead && <Chip tone="blue">Liderança</Chip>}</span></td>
                        <td className="px-2 py-1.5 text-xs">{m.levelName}</td>
                        {COLS.map((c) => { const x = m.components.find((y) => y.key === c); return <td key={c} className="num px-2 py-1.5">{!x ? <span className="text-muted">—</span> : x.value == null ? <span className="text-xs text-muted">sem meta</span> : fmtPct(x.value)}</td>; })}
                        <td className="px-2 py-1.5"><ScoreBadge v={m.score} tone={m.tone} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {!me && !(d.teams ?? []).length && <EmptyState title="Nada para mostrar" description="Você ainda não está num time participante." />}
        </div>
        <aside className="space-y-4">
          <section aria-label="Pesos por nível" className="card p-4 text-sm">
            <h2 className="mb-2 font-display text-lg font-bold text-ink">Pesos por nível</h2>
            <ul className="space-y-2">
              {(d.weights ?? []).map((l) => (
                <li key={l.key} className={clsx('border border-line p-2', me?.levelKey === l.key && 'border-primary')}>
                  <p className="font-semibold text-ink">{l.name}</p>
                  <p className="text-xs text-muted">{l.weights ? COLS.filter((c) => (l.weights![c] ?? 0) > 0).map((c) => `${COL_SHORT[c]} ${l.weights![c]! / 100}%`).join(' · ') : 'sem pesos'}</p>
                </li>
              ))}
            </ul>
            {d.bands && <p className="mt-2 text-xs text-muted">No alvo a partir de {d.bands.greenBp / 100}%; atenção a partir de {d.bands.yellowBp / 100}%. Regra aprovada v{d.settingsVersion}.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
