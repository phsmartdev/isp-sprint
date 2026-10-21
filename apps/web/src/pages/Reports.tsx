import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowRight, ArrowUp, BarChart3, Clock3, Download, Filter, Handshake, MoreVertical } from 'lucide-react';
import { type ActivityType } from '@isp/domain';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtDate, fmtInt } from '../lib/format';
import { MASK, moneyHidden } from '../lib/privacy';
import { defaultPeriod, useLookups, useUrlState } from '../lib/hooks';
import type { Kpi } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Button, Chip, EmptyState, ErrorState, KpiCard, LoadingRows, Select, Tabs } from '../components/ui/primitives';
import { DateRange } from '../components/ui/DateRange';
import { PageHeader } from '../components/layout/PageHeader';
import { BarRows, CHART, ComboChart, Donut, FunnelShape, Legend } from '../components/charts/charts';
import { stageColor } from '../components/badges';
import { PortsReport } from '../features/PortsReport';
import { CommissionsReport } from '../features/CommissionsReport';
import { MoneyToggle } from '../lib/privacy';
import { TvArea, TvBar, TvButton, useTvMode } from '../features/TvMode';

type Overview = {
  kpis: Kpi[];
  evolution: { month: string; sales: number; revenueCents: number; leads: number }[];
  origins: { total: number; items: { source: string; n: number; share: number | null }[] };
  status: { pipeline: { id: string; name: string }; total: number; items: { stage: string; label: string; color: string | null; n: number; share: number | null }[] };
  plans: { total: number; items: { plan: string; n: number; share: number | null }[] };
  team: { ranking: boolean; items: { userId: string; name: string; hasAvatar: boolean; won: number; wonPrev: number; delta: number | null }[] };
  latest: { id: string; contactName: string; segmentLabel: string; planName: string | null; valueCents: number | null; ownerName: string; ownerId: string; ownerHasAvatar: boolean; wonAt: string; contractRequestStatus: string }[];
};

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const monthLabel = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]!;
export const monthYear = (m: string) => `${monthLabel(m)}/${m.slice(0, 4)}`;
export const brlShort = (cents: number) => (moneyHidden() ? MASK : `R$ ${Math.round(cents / 100).toLocaleString('pt-BR')}`);

const KPI_LOOK = [
  { icon: <BarChart3 className="h-7 w-7" />, tone: 'green' as const },
  { icon: <Handshake className="h-7 w-7" />, tone: 'blue' as const },
  { icon: <Filter className="h-7 w-7" />, tone: 'purple' as const },
  { icon: <Clock3 className="h-7 w-7" />, tone: 'orange' as const },
];

export function ReportsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const p0 = defaultPeriod();
  const [f, setF] = useUrlState({ from: p0.from, to: p0.to, tab: 'geral', pipelineId: '' });
  const lookups = useLookups();
  const q = useQuery({ queryKey: ['reports', f.from, f.to, f.pipelineId], enabled: f.tab !== 'comissoes' && f.tab !== 'portas', queryFn: () => api<Overview>(`/reports/overview${qs({ from: f.from, to: f.to, pipelineId: f.pipelineId })}`) });
  const customers = useQuery({ queryKey: ['customers', 'summary'], enabled: f.tab === 'clientes' && can('clientes'), queryFn: () => api<{ kpis: Kpi[] }>('/customers/summary') });
  const days = Math.min(31, Math.round((new Date(f.to).getTime() - new Date(f.from).getTime()) / 86_400_000) + 1);
  const acts = useQuery({ queryKey: ['activities', 'report', f.from, days], enabled: f.tab === 'atividades', queryFn: () => api<{ typeCounts: Record<ActivityType, number>; total: number }>(`/activities${qs({ scope: can('atividades', 'equipe') ? 'equipe' : 'minhas', status: 'concluidas', from: f.from, days, pageSize: 1 })}`) });
  const [teamMetric] = useState('vendas');
  const d = q.data;
  const exportHref = `/api/v1/reports/export${qs({ from: f.from, to: f.to, kind: f.tab === 'leads' ? 'leads' : f.tab === 'oportunidades' ? 'oportunidades' : f.tab === 'comissoes' ? 'comissoes' : 'vendas' })}`;
  const show = (s: string) => f.tab === 'geral' || f.tab === s;
  const tvRef = useRef<HTMLDivElement>(null);
  const tv = useTvMode(tvRef);
  const TABS = [{ key: 'geral', label: 'Visão geral' }, { key: 'vendas', label: 'Vendas' }, { key: 'leads', label: 'Leads' }, { key: 'oportunidades', label: 'Oportunidades' }, { key: 'clientes', label: 'Contas' }, { key: 'atividades', label: 'Atividades' }, { key: 'comissoes', label: 'Comissões' }, { key: 'portas', label: 'Portas CTO' }];
  const TV_TABS = TABS.filter((t) => ['geral', 'vendas', 'leads', 'oportunidades', 'atividades'].includes(t.key) || (t.key === 'clientes' && can('clientes')));

  return (
    <div className="w-full">
      <PageHeader
        icon={<BarChart3 className="h-9 w-9" strokeWidth={2.4} />}
        title="Relatórios"
        subtitle="Acompanhe seus resultados e tome decisões com mais segurança."
        actions={
          <>
            <DateRange from={f.from} to={f.to} onChange={(r) => setF(r)} />
            <MoneyToggle />
            <TvButton onClick={() => void tv.enter()} />
            <a href={exportHref} download className="inline-flex h-12 items-center gap-2 rounded-md border border-primary/60 bg-surface px-5 text-md font-semibold text-primary hover:bg-primary-soft"><Download className="h-5 w-5" />Exportar</a>
          </>
        }
      />
      <TvArea innerRef={tvRef} active={tv.active} fallback={tv.fallback}>
      {tv.active && <TvBar title="Relatórios" period={`${fmtDate(f.from)} a ${fmtDate(f.to)}`} tabs={TV_TABS} tab={f.tab} onTab={(t) => setF({ tab: t }, { resetPage: false })} onExit={tv.exit} queryKeys={[['reports'], ['customers', 'summary'], ['activities', 'report']]} />}
      <Tabs<string>
        label="Relatórios"
        className="mb-5"
        value={f.tab}
        onChange={(t) => setF({ tab: t }, { resetPage: false })}
        tabs={TABS}
      />
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {f.tab === 'comissoes' && <CommissionsReport from={f.from} to={f.to} />}
      {f.tab === 'portas' && <PortsReport />}
      {f.tab !== 'clientes' && f.tab !== 'atividades' && f.tab !== 'comissoes' && f.tab !== 'portas' && (
        <section aria-label="Indicadores" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {d ? d.kpis.map((k, i) => <KpiCard key={k.key} k={k} icon={KPI_LOOK[i]!.icon} tone={KPI_LOOK[i]!.tone} />) : Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-[92px] animate-pulse" />)}
        </section>
      )}

      {f.tab === 'clientes' && (
        <section className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {customers.data?.kpis.map((k, i) => <KpiCard key={k.key} k={k} icon={KPI_LOOK[i]!.icon} tone={KPI_LOOK[i]!.tone} />) ?? <div className="card col-span-full"><EmptyState title={can('clientes') ? 'Carregando…' : 'Sem acesso a Clientes'} /></div>}
        </section>
      )}
      {f.tab === 'atividades' && (
        <section className="card mb-4 p-5">
          <h2 className="mb-3 text-md font-bold text-ink">Atividades concluídas no período {days === 31 ? '(primeiros 31 dias)' : ''}</h2>
          {!acts.data ? <LoadingRows rows={3} /> : (
            <BarRows items={(['ligacao', 'email', 'reuniao', 'whatsapp', 'tarefa', 'visita'] as ActivityType[]).map((t) => ({ label: { ligacao: 'Ligações', email: 'E-mails', reuniao: 'Reuniões', whatsapp: 'WhatsApp', tarefa: 'Tarefas', visita: 'Visitas' }[t], value: acts.data.typeCounts[t] ?? 0, share: acts.data.total ? (acts.data.typeCounts[t] ?? 0) / Math.max(1, Object.values(acts.data.typeCounts).reduce((a, b) => a + b, 0)) : null }))} />
          )}
        </section>
      )}

      {d && f.tab !== 'clientes' && f.tab !== 'atividades' && f.tab !== 'comissoes' && f.tab !== 'portas' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          {show('vendas') && (
            <section className="card p-5 xl:col-span-7" aria-labelledby="h-evo">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <h2 id="h-evo" className="text-lg font-bold text-ink">Evolução de vendas</h2>
                <Legend items={[{ label: 'Valor vendido (R$)', color: CHART.value }, { label: 'Quantidade de vendas', color: CHART.revenue }]} />
              </div>
              <ComboChart
                ariaLabel="Evolução mensal do valor vendido e da quantidade de vendas"
                categories={d.evolution.map((e) => monthLabel(e.month))}
                bars={[{ key: 'v', label: 'Valor vendido', color: CHART.value, values: d.evolution.map((e) => e.revenueCents) }]}
                line={{ key: 'q', label: 'Quantidade de vendas', color: CHART.revenue, values: d.evolution.map((e) => e.sales), axis: 'hidden' }}
                leftFormat={(v) => brlShort(v)}
                tooltipTitle={(i) => monthYear(d.evolution[i]!.month)}
                tooltipRows={(i) => [{ color: CHART.value, text: fmtBRL(d.evolution[i]!.revenueCents) }, { color: CHART.revenue, text: `${d.evolution[i]!.sales} vendas` }]}
              />
            </section>
          )}
          {show('leads') && (
            <section className="card p-5 xl:col-span-5" aria-labelledby="h-orig">
              <h2 id="h-orig" className="mb-3 text-lg font-bold text-ink">Origem dos leads</h2>
              <Donut ariaLabel="Origem dos leads do período" items={d.origins.items.map((o) => ({ label: o.source, value: o.n, share: o.share }))} centerValue={fmtInt(d.origins.total)} centerLabel="leads" />
            </section>
          )}
          {show('oportunidades') && (
            <section className="card p-5 xl:col-span-4" aria-labelledby="h-status">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 id="h-status" className="text-lg font-bold text-ink">Status das oportunidades</h2>
                {(lookups.data?.pipelines.filter((x) => x.allowed).length ?? 0) > 1 && (
                  <Select aria-label="Jornada" className="h-9 w-auto text-sm" value={f.pipelineId || d.status.pipeline.id} onChange={(e) => setF({ pipelineId: e.target.value }, { resetPage: false })}>
                    {lookups.data?.pipelines.filter((x) => x.allowed).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                )}
              </div>
              <p className="-mt-2 mb-2 text-xs text-muted">Criadas no período, pela etapa atual · {d.status.pipeline.name}</p>
              <div className="flex items-center gap-4">
                <FunnelShape colors={d.status.items.map((s, i) => stageColor(s.stage, s.color, i))} />
                <ul className="flex-1 space-y-2.5">
                  {d.status.items.map((s) => (
                    <li key={s.stage} className="grid grid-cols-[1fr_auto_44px] items-center gap-3 text-sm">
                      <span className="flex items-center gap-2 text-text"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: stageColor(s.stage, s.color, d.status.items.indexOf(s)) }} />{s.label}</span>
                      <span className="num font-bold text-ink">{s.n}</span>
                      <span className="num text-right text-muted">{s.share === null ? 'N/D' : `${Math.round(s.share * 100)}%`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          {show('vendas') && (
            <section className="card p-5 xl:col-span-4" aria-labelledby="h-plan">
              <h2 id="h-plan" className="mb-4 text-lg font-bold text-ink">Vendas por plano</h2>
              {d.plans.total === 0 ? <p className="text-sm text-muted">Nenhuma venda no período.</p> : <BarRows color="#8DB7FF" items={d.plans.items.map((x) => ({ label: x.plan, value: x.n, share: x.share }))} />}
            </section>
          )}
          {show('vendas') && (
            <section className="card p-5 xl:col-span-4" aria-labelledby="h-team">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="h-team" className="text-lg font-bold text-ink">{d.team.ranking ? 'Desempenho da equipe' : 'Meu desempenho'}</h2>
                <span className="rounded-sm border border-line px-3 py-1.5 text-xs text-text">{teamMetric === 'vendas' ? 'Vendas fechadas' : ''}</span>
              </div>
              <ol className="space-y-2.5">
                {d.team.items.map((u, i) => (
                  <li key={u.userId} className="grid grid-cols-[18px_32px_1fr_32px_68px] items-center gap-3 text-sm">
                    <span className="num text-muted">{d.team.ranking ? i + 1 : ''}</span>
                    <Avatar name={u.name} userId={u.userId} hasPhoto={u.hasAvatar} size={30} />
                    <span className="truncate text-text">{u.name}</span>
                    <span className="num text-right font-bold text-ink">{u.won}</span>
                    <span className={clsx('num inline-flex items-center justify-end gap-0.5 text-sm font-semibold', u.delta === null ? 'text-faint' : u.delta > 0 ? 'text-success' : u.delta < 0 ? 'text-danger' : 'text-muted')}>
                      {u.delta === null ? '—' : <>{u.delta > 0 ? <ArrowUp className="h-3.5 w-3.5" /> : u.delta < 0 ? <ArrowDown className="h-3.5 w-3.5" /> : null}{Math.abs(Math.round(u.delta * 100))}%</>}
                    </span>
                  </li>
                ))}
              </ol>
              {!d.team.ranking && <p className="mt-3 text-xs text-muted">Seu perfil vê apenas os próprios números.</p>}
            </section>
          )}
          {show('vendas') && (
            <section className="card overflow-hidden xl:col-span-12" aria-labelledby="h-latest">
              <div className="flex items-center justify-between px-5 pb-2 pt-4">
                <h2 id="h-latest" className="text-lg font-bold text-ink">Últimas vendas</h2>
                <Link to="/opportunities?view=lista&status=encerradas" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">Ver todas <ArrowRight className="h-4 w-4" /></Link>
              </div>
              {d.latest.length === 0 ? <EmptyState title="Nenhuma venda fechada no período" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-surface-2 text-xs text-muted"><tr>{['Cliente', 'Plano', 'Valor', 'Status', 'Responsável', 'Data de fechamento', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {d.latest.map((s) => (
                        <tr key={s.id} className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={() => nav(`/opportunities/${s.id}`)}>
                          <td className="px-5 py-2.5"><span className="flex items-center gap-3"><Avatar name={s.contactName} size={32} tone={0} /><span><span className="block font-semibold text-ink">{s.contactName}</span><span className="block text-xs text-muted">{s.segmentLabel}</span></span></span></td>
                          <td className="px-5 py-2.5 text-text">{s.planName ?? '—'}</td>
                          <td className="num px-5 py-2.5 text-ink">{s.valueCents !== null ? `${fmtBRL(s.valueCents)}/mês` : '—'}</td>
                          <td className="px-5 py-2.5"><Chip tone="green" className="min-w-[96px] justify-center" title="Venda fechada (ganho comercial). Contrato confirmado só após validação no IXC.">Fechada</Chip></td>
                          <td className="px-5 py-2.5"><span className="flex items-center gap-2 text-text"><Avatar name={s.ownerName} userId={s.ownerId} hasPhoto={s.ownerHasAvatar} size={28} />{s.ownerName}</span></td>
                          <td className="num px-5 py-2.5 text-text">{fmtDate(s.wonAt)}</td>
                          <td className="px-5 py-2.5 text-right"><MoreVertical className="ml-auto h-4 w-4 text-primary" aria-hidden /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      {!d && q.isLoading && <div className="card"><LoadingRows rows={8} /></div>}
      {d && <Button variant="ghost" className="sr-only" onClick={() => q.refetch()}>Atualizar</Button>}
      </TvArea>
    </div>
  );
}
