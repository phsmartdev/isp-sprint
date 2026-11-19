import { Link, useNavigate } from 'react-router-dom';
import { SeloHighlight, fmtPts } from '../features/gamification/Gamification';
import { BadgeIcon } from '../features/gamification/Badges';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, BarChart3, ClipboardList, Clock3, Home as HomeIcon, Mail, MoreVertical, Phone, Plus, Send, ShoppingBag, Users, Video, MessageCircle, CheckSquare, MapPin } from 'lucide-react';
import { BUSINESS_EVENT_TYPES, type ActivityType, type BadgeProgress } from '@isp/domain';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtRelativeShort, fmtTime, fmtLongDate } from '../lib/format';
import type { Kpi, Opportunity } from '../lib/types';
import { defaultPeriod, useStageInfo, useUrlState } from '../lib/hooks';
import { DateRange } from '../components/ui/DateRange';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Chip, Delta, ErrorState, LoadingRows, formatKpi } from '../components/ui/primitives';
import { BrandArt, Hexagons } from '../components/brand';
import { useLookups } from '../lib/hooks';
import { Progress } from '../components/charts/charts';
import { StageChip, inkOf, productLabel, stageColor } from '../components/badges';
import { useToast } from '../components/ui/overlay';
import { FitText } from '../components/ui/FitText';

type HomeData = {
  kpis: Kpi[];
  goal: { sales: number; target: number; progress: number | null; delta: number | null; formula: string };
  performance: { key: string; label: string; value: number; target: number; progress: number | null }[];
  agenda: { id: string; type: ActivityType; title: string; notes: string | null; dueAt: string | null; completedAt: string | null; rowVersion: number; opportunityId: string | null; overdue: boolean }[];
  pipelineName: string;
  pipeline: { stage: string; name: string; color: string | null; count: number; valueCents: number }[];
  recent: Opportunity[];
  strategy?: Record<string, Contribution | null>;
};
type Contribution = {
  goalId: string; goal: string; objective: { id: string; title: string; level: string } | null; unit: string; target: number; periodStart: string; periodEnd: string;
  company: { value: number | null; attainment: number | null; status: string }; mine: number | null; share: number | null; others: number;
};

export const ACT_ICON: Record<ActivityType, React.ReactNode> = {
  ligacao: <Phone className="h-[18px] w-[18px] text-success" />,
  whatsapp: <MessageCircle className="h-[18px] w-[18px] text-success" />,
  reuniao: <Video className="h-[18px] w-[18px] text-primary" />,
  email: <Send className="h-[18px] w-[18px] text-primary" />,
  tarefa: <CheckSquare className="h-[18px] w-[18px] text-primary" />,
  visita: <MapPin className="h-[18px] w-[18px] text-purple" />,
};

const KPI_LOOK: Record<string, { icon: React.ReactNode; tone: string; label?: string }> = {
  abertas: { icon: <ShoppingBag className="h-6 w-6" />, tone: 'bg-primary-soft text-primary', label: 'Oportunidades' },
  valor: { icon: <BarChart3 className="h-6 w-6" />, tone: 'bg-sky-soft text-sky', label: 'R$ Oportunidades' },
  atividades_hoje: { icon: <Clock3 className="h-6 w-6" />, tone: 'bg-primary-soft text-primary', label: 'Atividades' },
  propostas: { icon: <Send className="h-6 w-6" />, tone: 'bg-sky-soft text-sky', label: 'Propostas' },
};

const fmtGoal = (v: number | null, unit: string) => (v === null ? '—' : unit === 'reais' ? fmtBRL(Math.round(v * 100)) : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));

/** Número do Início + a parte da pessoa na meta da empresa do planejamento estratégico (sem meta ligada, diz isso). */
function StrategicKpi({ k, c }: { k: Kpi; c: Contribution | null }) {
  const look = KPI_LOOK[k.key];
  const pct = (x: number | null) => (x === null ? '—' : `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
  return (
    <div className="card grid grid-cols-[minmax(0,1fr)_minmax(150px,44%)]" data-testid={`kpi-${k.key}`}>
      <div className="flex items-center gap-4 px-5 py-4" title={k.formula}>
        <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center', look?.tone)}>{look?.icon}</span>
        <div className="min-w-0 flex-1">
          <FitText className="num text-xl font-extrabold leading-tight text-ink" title={formatKpi(k, true)}>{formatKpi(k)}</FitText>
          <p className="text-md text-text">{look?.label ?? k.label}</p>
          {look?.label && look.label !== k.label && <p className="text-xs text-muted">{k.label}</p>}
          <span className="mt-1 inline-block"><Delta k={k} compact /></span>
        </div>
      </div>
      <div className="flex flex-col justify-center border-l border-line bg-surface-2 px-4 py-3" aria-label={`Contribuição de ${look?.label ?? k.label} para o planejamento estratégico`}>
        {c ? (
          <>
            <p className="text-xs text-muted">Sua parte na meta da empresa</p>
            <p className="num font-display text-2xl font-bold text-primary" data-testid="kpi-share">{pct(c.share)}</p>
            <div className="mt-1 h-1.5 w-full bg-line" role="progressbar" aria-label="Atingimento da empresa" aria-valuenow={c.company.attainment ?? 0} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-sky" style={{ width: `${Math.min(100, c.company.attainment ?? 0)}%` }} /></div>
            <p className="mt-1 text-xs text-text">Empresa: <b className="num">{pct(c.company.attainment)}</b> de {fmtGoal(c.target, c.unit)}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted" title={`${c.goal}${c.objective ? ` · ${c.objective.title}` : ''}`}>Você: {fmtGoal(c.mine, c.unit)} · {c.objective ? c.objective.title : c.goal}</p>
          </>
        ) : (
          <>
            <p className="text-xs text-muted">Planejamento estratégico</p>
            <p className="text-sm text-text">Nenhuma meta da empresa mede isso no período.</p>
            <Link to="/times/metas" className="mt-1 text-xs font-semibold text-primary hover:underline">Ver metas</Link>
          </>
        )}
      </div>
    </div>
  );
}

/** Funil das etapas abertas: estreita etapa a etapa (formato de funil); a quantidade e o valor vêm escritos. */
function Funnel({ stages }: { stages: HomeData['pipeline'] }) {
  if (!stages.length) return <p className="py-6 text-center text-sm text-muted">Sem etapas abertas.</p>;
  return (
    <ul className="space-y-1.5" aria-label="Funil de oportunidades">
      {stages.map((p, i) => {
        const c = stageColor(p.stage, p.color, i);
        const w = 100 - (i * 55) / Math.max(1, stages.length - 1);
        return (
          <li key={p.stage} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="flex justify-center"><span className="flex h-9 items-center justify-between gap-2 px-3 text-sm font-semibold text-white" style={{ width: `${Math.min(100, Math.max(30, w))}%`, background: c }}><span className="truncate">{p.name}</span><span className="num">{p.count}</span></span></span>
            <span className="num w-24 whitespace-nowrap text-right text-sm text-ink">{fmtBRL(p.valueCents)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Minhas conquistas: badges (hexágonos) e de onde vieram os pontos do mês (Gamificação). */
function Achievements() {
  const q = useQuery({ queryKey: ['meus-pontos', ''], queryFn: () => api<{ pending: boolean; participates?: boolean; badges?: BadgeProgress[]; events?: { type: string; points: number }[]; items?: { points: number }[]; support?: { points: number }[]; certificates?: { points: number }[] }>('/me/pontos'), staleTime: 60_000 });
  const d = q.data;
  const lines: { label: string; points: number }[] = [];
  if (d && !d.pending) {
    const byType = new Map<string, number>();
    for (const e of d.events ?? []) byType.set(e.type, (byType.get(e.type) ?? 0) + e.points);
    for (const [t, pts] of byType) lines.push({ label: BUSINESS_EVENT_TYPES.find((x) => x.key === t)?.label ?? t, points: pts });
    const sum = (xs?: { points: number }[]) => (xs ?? []).reduce((a, x) => a + x.points, 0);
    if (sum(d.items)) lines.push({ label: 'Tarefas das jornadas', points: sum(d.items) });
    if (sum(d.support)) lines.push({ label: 'Ajuda a colegas', points: sum(d.support) });
    if (sum(d.certificates)) lines.push({ label: 'Certificados', points: sum(d.certificates) });
    lines.sort((a, b) => b.points - a.points);
  }
  const total = lines.reduce((a, l) => a + l.points, 0);
  return (
    <aside className="card flex flex-col p-5" aria-label="Minhas conquistas">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-md font-bold tracking-wide text-ink">Minhas conquistas</h2>
        <Link to="/meus-pontos" className="text-sm font-semibold text-primary hover:underline">Ver tudo</Link>
      </div>
      {!d ? <LoadingRows rows={4} /> : d.pending ? <p className="text-sm text-muted">A regra de pontuação ainda está aguardando aprovação.</p> : (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Badges">
            {(d.badges ?? []).map((b) => <span key={b.key} title={`${b.name}${b.tier ? `: ${b.tier}` : ': ainda sem faixa'}${b.next ? ` · faltam ${b.next.missing} pts para ${b.next.name}` : ''}`}><BadgeIcon badgeKey={b.key} tierIndex={b.tierIndex} size={52} label={`Badge ${b.name}${b.tier ? `: ${b.tier}` : ': ainda sem faixa'}`} /></span>)}
            {!d.badges?.length && <p className="text-sm text-muted">Os badges aparecem quando a regra da gamificação tiver badges.</p>}
          </div>
          <h3 className="mb-1 mt-5 text-sm font-semibold text-ink">Pontos do mês</h3>
          {!lines.length ? <p className="text-sm text-muted">Nenhum ponto ainda neste mês.</p> : (
            <ul className="divide-y divide-line" data-testid="points">
              {lines.map((l) => <li key={l.label} className="flex items-center gap-3 py-1.5 text-sm"><span className="num w-14 font-bold text-primary">+{fmtPts(l.points)}</span><span className="text-text">{l.label}</span></li>)}
            </ul>
          )}
          {!!lines.length && <p className="mt-auto flex items-center justify-between border-t border-line pt-3 text-sm"><span className="text-muted">Total no mês</span><span className="num font-display text-lg font-bold text-ink">{fmtPts(total)}</span></p>}
        </>
      )}
    </aside>
  );
}

function GoalRing({ value, target }: { value: number; target: number }) {
  const p = target ? Math.min(1, value / target) : 0;
  const R = 58, C = 2 * Math.PI * R;
  return (
    <div className="relative h-[140px] w-[140px] shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="70" cy="70" r={R} fill="none" stroke="#E5EAF3" strokeWidth="12" />
        <circle cx="70" cy="70" r={R} fill="none" stroke="#22A447" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${C * p} ${C}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[30px] font-extrabold leading-none text-ink">{value}</span>
        <span className="text-sm text-muted">de {target}</span>
      </div>
    </div>
  );
}

export function HomePage() {
  const stageInfo = useStageInfo();
  const { me } = useAuth();
  const nav = useNavigate();
  const brandBanner = !!useLookups().data?.brand?.banner_inicio;
  const qc = useQueryClient();
  const toast = useToast();
  const p0 = defaultPeriod();
  const [f, setF] = useUrlState({ from: p0.from, to: p0.to });
  const isMonth = f.from === p0.from && f.to === p0.to;
  const q = useQuery({ queryKey: ['home', f.from, f.to], queryFn: () => api<HomeData>(`/home${qs({ from: f.from, to: f.to })}`), placeholderData: (x) => x });
  const done = useMutation({
    mutationFn: (a: HomeData['agenda'][number]) => api(`/activities/${a.id}`, { method: 'PATCH', body: { completed: !a.completedAt, rowVersion: a.rowVersion } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: ['activities'] }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const d = q.data;
  const first = me?.user.name.split(' ')[0] ?? '';

  return (
    <div className="w-full">
      <SeloHighlight />
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.65rem] font-bold leading-tight text-ink">Olá, {first}!</h1>
          <p className="mt-0.5 text-md text-muted">Resumo do seu dia de vendas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted first-letter:uppercase">{fmtLongDate(new Date())}</p>
          <DateRange from={f.from} to={f.to} onChange={(r) => setF(r)} />
        </div>
      </header>

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {/* topo: os 4 números, cada um com a sua parte na meta estratégica da empresa */}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section aria-label="Indicadores" className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
            {(d?.kpis ?? Array.from({ length: 4 }).map(() => null)).map((k, i) =>
              k ? <StrategicKpi key={k.key} k={k} c={d!.strategy?.[k.key] ?? null} /> : <div key={i} className="card h-[124px] animate-pulse" />,
            )}
          </section>

          {/* nova oportunidade */}
          <section className="relative overflow-hidden bg-gradient-to-r from-navy to-primary text-white" aria-label="Nova oportunidade">
            <BrandArt slot="banner_inicio" className="absolute inset-0 h-full w-full" fallback={<Hexagons className="absolute inset-y-0 right-0 h-full w-[60%]" />} />
            {brandBanner && <div className="absolute inset-0 bg-gradient-to-r from-navy/85 via-navy/50 to-transparent" aria-hidden />}
            <div className="relative z-10 flex flex-wrap items-center gap-5 px-6 py-5">
              <button onClick={() => nav('/opportunities/new')} aria-label="Nova oportunidade" className="flex h-14 w-14 shrink-0 items-center justify-center bg-white text-primary hover:bg-primary-soft"><Plus className="h-7 w-7" /></button>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl font-bold tracking-wide">Nova oportunidade</h2>
                <p className="text-sm text-white/85">Qualifique o cliente, consulte a cobertura e monte a proposta em um passo a passo guiado.</p>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            {/* tarefas de hoje */}
            <section className="card p-5" aria-labelledby="h-agenda">
              <div className="mb-2 flex items-center justify-between">
                <h2 id="h-agenda" className="flex items-center gap-2 whitespace-nowrap text-md font-bold text-ink"><ClipboardList className="h-5 w-5" />Tarefas de hoje</h2>
                <Link to="/activities" className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-primary hover:underline">Ver todas <ArrowRight className="h-4 w-4" /></Link>
              </div>
              {!d ? <LoadingRows rows={4} /> : d.agenda.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">Nenhuma tarefa para hoje.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.agenda.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-3">
                      <input type="checkbox" className="h-5 w-5 rounded border-line" checked={!!a.completedAt} onChange={() => done.mutate(a)} aria-label={`Concluir: ${a.title}`} />
                      <span className={clsx('num w-12 text-sm', a.overdue ? 'font-semibold text-danger' : 'text-text')}>{fmtTime(a.dueAt)}</span>
                      <span aria-hidden>{ACT_ICON[a.type]}</span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => a.opportunityId && nav(`/opportunities/${a.opportunityId}`)}>
                        <span className={clsx('block truncate text-sm font-semibold text-ink', a.completedAt && 'text-muted line-through')}>{a.title}</span>
                        <span className="block truncate text-xs text-muted">{a.notes ?? ''}</span>
                      </button>
                      <MoreVertical className="h-4 w-4 text-muted" aria-hidden />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* funil */}
            <section className="card p-5" aria-labelledby="h-pipe">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="h-pipe" className="flex items-center gap-2 whitespace-nowrap text-md font-bold text-ink"><BarChart3 className="h-5 w-5" />Funil · {d?.pipelineName ?? 'oportunidades'}</h2>
                <Link to="/opportunities" className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-primary hover:underline">Ver pipeline <ArrowRight className="h-4 w-4" /></Link>
              </div>
              {!d ? <LoadingRows rows={5} /> : <Funnel stages={d.pipeline} />}
            </section>
          </div>
        </div>

        {/* coluna da direita: minhas conquistas e pontos */}
        <Achievements />
      </div>

      {/* mais do período: meta, desempenho e recentes */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <section className="card p-5" aria-labelledby="h-meta">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="h-meta" className="flex items-center gap-2 text-md font-bold text-ink"><HomeIcon className="h-5 w-5" />{isMonth ? 'Meta do mês' : 'Meta no período'}</h2>
            <Link to="/reports" className="text-sm font-semibold text-primary hover:underline">Ver detalhes</Link>
          </div>
          {d ? (
            d.goal.target > 0 ? (
              <div className="flex items-center gap-6" title={d.goal.formula}>
                <GoalRing value={d.goal.sales} target={d.goal.target} />
                <div className="flex-1">
                  <p className="flex items-center justify-between text-md text-text">Vendas fechadas <span className="num text-xl font-extrabold text-ink">{d.goal.progress === null ? 'N/D' : `${Math.round(d.goal.progress * 100)}%`}</span></p>
                  <p className="mt-2 text-right"><Delta k={{ delta: d.goal.delta }} /></p>
                  <p className="mt-2 text-right text-sm text-muted">{isMonth ? 'em relação ao mês passado' : 'em relação ao período anterior'}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Nenhuma meta cadastrada. A gerência define as metas em Configurações → Usuários.</p>
            )
          ) : <LoadingRows rows={3} />}
        </section>
        <section className="card p-5" aria-labelledby="h-perf">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="h-perf" className="flex items-center gap-2 text-md font-bold text-ink"><BarChart3 className="h-5 w-5" />Meu desempenho</h2>
            <span className="border border-line px-3 py-1.5 text-sm text-text">{isMonth ? 'Este mês' : 'No período'}</span>
          </div>
          {!d ? <LoadingRows rows={3} /> : (
            <ul className="space-y-3">
              {d.performance.map((p, i) => (
                <li key={p.key} className="grid grid-cols-[14px_1fr_32px_120px_40px] items-center gap-2 text-sm" title={`Meta: ${p.target}`}>
                  <span className={clsx('h-2.5 w-2.5', ['bg-primary', 'bg-sky', 'bg-lime'][i])} aria-hidden />
                  <span className="text-text">{p.label}</span>
                  <span className="num text-right font-bold text-ink">{p.value}</span>
                  <Progress value={p.progress} />
                  <span className="num text-right text-xs text-muted">{p.progress === null ? 'N/D' : `${Math.round(p.progress * 100)}%`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5" aria-labelledby="h-recent">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="h-recent" className="flex items-center gap-2 text-md font-bold text-ink"><Users className="h-5 w-5" />Oportunidades recentes</h2>
            <Link to="/opportunities?view=lista" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">Ver todas <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {!d ? <LoadingRows rows={5} /> : (
            <ul className="divide-y divide-line">
              {d.recent.map((o) => (
                <li key={o.id}>
                  <Link to={`/opportunities/${o.id}`} className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3 py-2.5 hover:bg-surface-2/60">
                    <Avatar name={o.contactName} size={34} tone={0} />
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{o.contactName}</span><span className="block truncate text-2xs text-muted">{productLabel(o.contactSegment)}</span></span>
                    <span className="num whitespace-nowrap text-sm font-semibold text-ink">{o.valueCents !== null ? fmtBRL(o.valueCents) : '—'}</span>
                    <span className="flex flex-col items-end gap-1"><StageChip stage={o.stage} name={o.stageName} color={stageInfo(o.pipelineId, o.stage).color} /><span className="text-2xs text-muted">{fmtRelativeShort(o.updatedAt)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
