import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, BarChart3, ClipboardList, Clock3, Home as HomeIcon, Lightbulb, Mail, MoreVertical, Phone, Plus, Send, ShoppingBag, Users, Video, MessageCircle, CheckSquare, MapPin } from 'lucide-react';
import { STAGE_LABELS, type ActivityType, type OpportunityStage } from '@isp/domain';
import { api } from '../lib/api';
import { fmtBRL, fmtRelativeShort, fmtTime, fmtLongDate } from '../lib/format';
import type { Kpi, Opportunity } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Chip, Delta, ErrorState, LoadingRows, formatKpi } from '../components/ui/primitives';
import { BrandImage } from '../components/brand';
import { Progress } from '../components/charts/charts';
import { STAGE_STYLE, productLabel } from '../components/badges';
import { useToast } from '../components/ui/overlay';

type HomeData = {
  kpis: Kpi[];
  goal: { sales: number; target: number; progress: number | null; delta: number | null; formula: string };
  performance: { key: string; label: string; value: number; target: number; progress: number | null }[];
  agenda: { id: string; type: ActivityType; title: string; notes: string | null; dueAt: string | null; completedAt: string | null; rowVersion: number; opportunityId: string | null; overdue: boolean }[];
  pipeline: { stage: OpportunityStage; count: number; valueCents: number }[];
  recent: Opportunity[];
};

export const ACT_ICON: Record<ActivityType, React.ReactNode> = {
  ligacao: <Phone className="h-[18px] w-[18px] text-success" />,
  whatsapp: <MessageCircle className="h-[18px] w-[18px] text-success" />,
  reuniao: <Video className="h-[18px] w-[18px] text-primary" />,
  email: <Send className="h-[18px] w-[18px] text-primary" />,
  tarefa: <CheckSquare className="h-[18px] w-[18px] text-primary" />,
  visita: <MapPin className="h-[18px] w-[18px] text-purple" />,
};

const KPI_LOOK: Record<string, { icon: React.ReactNode; tone: string }> = {
  abertas: { icon: <ShoppingBag className="h-6 w-6" />, tone: 'bg-primary-soft text-primary' },
  valor: { icon: <BarChart3 className="h-6 w-6" />, tone: 'bg-success-soft text-success' },
  atividades_hoje: { icon: <Clock3 className="h-6 w-6" />, tone: 'bg-warning-soft text-[#F59E0B]' },
  propostas: { icon: <Send className="h-6 w-6" />, tone: 'bg-purple-soft text-purple' },
};

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
  const { me } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/home') });
  const done = useMutation({
    mutationFn: (a: HomeData['agenda'][number]) => api(`/activities/${a.id}`, { method: 'PATCH', body: { completed: !a.completedAt, rowVersion: a.rowVersion } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: ['activities'] }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const d = q.data;
  const first = me?.user.name.split(' ')[0] ?? '';

  return (
    <div className="w-full">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Olá, {first}!</h1>
          <p className="mt-0.5 text-md text-muted">Seu dia de vendas, mais simples e produtivo.</p>
        </div>
        <p className="text-sm text-muted first-letter:uppercase">{fmtLongDate(new Date())}</p>
      </header>

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      <section aria-label="Indicadores" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(d?.kpis ?? Array.from({ length: 4 }).map(() => null)).map((k, i) =>
          k ? (
            <div key={k.key} className="card flex items-center gap-4 px-5 py-4" title={k.formula}>
              <span className={clsx('flex h-14 w-14 shrink-0 items-center justify-center rounded-full', KPI_LOOK[k.key]?.tone)}>{KPI_LOOK[k.key]?.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="num text-xl font-extrabold leading-tight text-ink">{formatKpi(k)}</p>
                <p className="text-md text-text">{k.label}</p>
              </div>
              <span className="self-end"><Delta k={k} compact /></span>
            </div>
          ) : (
            <div key={i} className="card h-[92px] animate-pulse" />
          ),
        )}
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(400px,1fr)]">
        {/* Banner */}
        <section className="relative min-h-[300px] overflow-hidden rounded-[18px] bg-gradient-to-br from-[#0F4FD8] via-[#0B3AA6] to-[#0A1F66] text-white xl:col-span-2" aria-label="Destaque">
          <BrandImage slot="banner_inicio" className="absolute inset-y-0 right-0 h-full w-[62%] object-cover object-left" />
          <div className="relative z-10 max-w-[440px] p-8 sm:p-10">
            <p className="text-[38px] font-extrabold leading-[1.1] sm:text-[44px]">
              Uma venda
              <br />
              <span className="text-lime">mais fácil,</span>
              <br />
              do início ao fim.
            </p>
            <p className="mt-4 text-md text-white/90">O ISP Sprint te guia em um passo a passo simples, com perguntas inteligentes e as melhores recomendações para fechar mais vendas.</p>
            <button onClick={() => nav('/opportunities/new')} className="mt-6 inline-flex h-12 items-center gap-2 rounded-md bg-white px-6 text-md font-bold text-primary hover:bg-primary-soft">
              <Plus className="h-5 w-5" /> Nova oportunidade
            </button>
          </div>
          <div className="absolute right-5 top-8 z-10 hidden max-w-[210px] rounded-lg bg-white/95 p-4 text-ink shadow-overlay md:block">
            <p className="flex items-center gap-1.5 text-sm font-bold text-lime-ink"><Lightbulb className="h-4 w-4" />Dica do Dino</p>
            <p className="mt-1 text-xs text-muted">Entenda o que o cliente precisa, consulte a cobertura e apresente a melhor oferta.</p>
          </div>
        </section>

        {/* Meta do mês */}
        <section className="card p-5" aria-labelledby="h-meta">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="h-meta" className="flex items-center gap-2 text-md font-bold text-ink"><HomeIcon className="h-5 w-5" />Meta do mês</h2>
            <Link to="/reports" className="text-sm font-semibold text-primary hover:underline">Ver detalhes</Link>
          </div>
          {d ? (
            d.goal.target > 0 ? (
              <div className="flex items-center gap-6" title={d.goal.formula}>
                <GoalRing value={d.goal.sales} target={d.goal.target} />
                <div className="flex-1">
                  <p className="flex items-center justify-between text-md text-text">Vendas fechadas <span className="num text-xl font-extrabold text-ink">{d.goal.progress === null ? 'N/D' : `${Math.round(d.goal.progress * 100)}%`}</span></p>
                  <p className="mt-2 text-right"><Delta k={{ delta: d.goal.delta }} /></p>
                  <p className="mt-2 text-right text-sm text-muted">em relação ao mês passado</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Nenhuma meta cadastrada. A gerência define as metas em Configurações → Usuários.</p>
            )
          ) : <LoadingRows rows={3} />}
        </section>

        {/* Minhas atividades de hoje */}
        <section className="card p-5" aria-labelledby="h-agenda">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="h-agenda" className="flex items-center gap-2 whitespace-nowrap text-md font-bold text-ink"><ClipboardList className="h-5 w-5" />Minhas atividades de hoje</h2>
            <Link to="/activities" className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-primary hover:underline">Ver todas <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {!d ? <LoadingRows rows={4} /> : d.agenda.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nenhuma atividade para hoje.</p>
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

        {/* Pipeline */}
        <section className="card p-5" aria-labelledby="h-pipe">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="h-pipe" className="flex items-center gap-2 whitespace-nowrap text-md font-bold text-ink"><BarChart3 className="h-5 w-5" />Pipeline de oportunidades</h2>
            <Link to="/opportunities" className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-primary hover:underline">Ver pipeline <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {!d ? <LoadingRows rows={5} /> : (
            <ul className="divide-y divide-line">
              {d.pipeline.map((p) => {
                const max = Math.max(1, ...d.pipeline.map((x) => x.count));
                const st = STAGE_STYLE[p.stage];
                return (
                  <li key={p.stage} className="grid grid-cols-[100px_1fr_auto] items-center gap-3 py-3.5">
                    <span className={clsx('text-md font-medium', p.stage === 'novo_lead' ? 'text-ink' : st.text)}>{STAGE_LABELS[p.stage]}</span>
                    <span className="relative flex h-7 items-center rounded-full" style={{ background: `${st.bar}33` }}>
                      <span className="block h-7 rounded-full" style={{ width: `${Math.max(14, (p.count / max) * 55)}%`, background: st.bar }} />
                      <span className="num absolute right-3 text-sm font-semibold text-primary">{p.count}</span>
                    </span>
                    <span className="num whitespace-nowrap text-right text-md text-ink">{fmtBRL(p.valueCents)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Coluna direita: desempenho + recentes */}
        <div className="flex flex-col gap-4">
          <section className="card p-5" aria-labelledby="h-perf">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="h-perf" className="flex items-center gap-2 text-md font-bold text-ink"><BarChart3 className="h-5 w-5" />Meu desempenho</h2>
              <span className="rounded-sm border border-line px-3 py-1.5 text-sm text-text">Este mês</span>
            </div>
            {!d ? <LoadingRows rows={3} /> : (
              <ul className="space-y-3">
                {d.performance.map((p, i) => (
                  <li key={p.key} className="grid grid-cols-[14px_1fr_32px_120px_40px] items-center gap-2 text-sm" title={`Meta: ${p.target}`}>
                    <span className={clsx('h-2.5 w-2.5 rounded-[3px]', ['bg-success', 'bg-[#F59E0B]', 'bg-[#93B8FF]'][i])} aria-hidden />
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
                      <span className="flex flex-col items-end gap-1"><Chip tone={STAGE_STYLE[o.stage].tone}>{STAGE_LABELS[o.stage]}</Chip><span className="text-2xs text-muted">{fmtRelativeShort(o.updatedAt)}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
