import { useRef } from 'react';
import { ArpDashboard } from '../features/arp/AtasTab';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowUp, BarChart3, CalendarDays, ChevronRight, DollarSign, Download, Filter, Lightbulb, Mail, MapPin, Phone, Trophy, Users } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtDate, fmtInt } from '../lib/format';
import { defaultPeriod, useUrlState } from '../lib/hooks';
import type { Kpi } from '../lib/types';
import { Avatar, ErrorState, KpiCard, LoadingRows, Tabs } from '../components/ui/primitives';
import { GeneralInsights, type InsightView } from '../features/GeneralInsights';
import { ContractInsights } from '../features/ContractInsights';
import { DateRange } from '../components/ui/DateRange';
import { PageHeader } from '../components/layout/PageHeader';
import { BarRows, CHART, ComboChart, Donut, Legend } from '../components/charts/charts';
import { SergipeMap } from '../components/charts/SergipeMap';
import { brlShort, monthLabel, monthYear } from './Reports';
import { MoneyToggle } from '../lib/privacy';
import { TvArea, TvBar, TvButton, useTvMode } from '../features/TvMode';
import { useAuth } from '../auth/AuthProvider';
import { FrontsPanel } from '../features/projects/fronts';

type Data = {
  kpis: Kpi[];
  series: { month: string; sales: number; revenueCents: number; leads: number }[];
  origins: { total: number; items: { source: string; n: number; share: number | null }[] };
  funnel: { key: string; label: string; n: number; share: number | null }[];
  plans: { total: number; items: { plan: string; n: number; share: number | null }[] };
  regions: { total: number; items: { city: string; n: number; share: number }[]; map: { city: string; n: number }[] };
  team: { userId: string; name: string; hasAvatar: boolean; calls: number; emails: number; meetings: number; total: number }[];
  insights: { kind: 'crescimento' | 'plano' | 'conversao' | 'regiao'; title: string; detail: string; n: number }[];
  minSample: number;
};

const INSIGHT_LOOK = {
  crescimento: { icon: <ArrowUp className="h-5 w-5" />, cls: 'border-success/40 text-success' },
  plano: { icon: <Trophy className="h-5 w-5" />, cls: 'border-purple/40 text-purple' },
  conversao: { icon: <Users className="h-5 w-5" />, cls: 'border-[#F59E0B]/50 text-[#F59E0B]' },
  regiao: { icon: <MapPin className="h-5 w-5" />, cls: 'border-primary/40 text-primary' },
};
const KPI_LOOK = [
  { icon: <Users className="h-7 w-7" />, tone: 'blue' as const },
  { icon: <Filter className="h-7 w-7" />, tone: 'purple' as const },
  { icon: <BarChart3 className="h-7 w-7" />, tone: 'green' as const },
  { icon: <DollarSign className="h-7 w-7" />, tone: 'yellow' as const },
];

export function IntelligencePage() {
  const p0 = defaultPeriod();
  const [f, setF] = useUrlState({ from: p0.from, to: p0.to, v: 'geral', tag: '' });
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['intelligence', f.from, f.to], enabled: f.v === 'comercial', queryFn: () => api<Data>(`/intelligence/overview${qs({ from: f.from, to: f.to })}`) });
  const d = q.data;
  const exportHref = `/api/v1/reports/export${qs({ from: f.from, to: f.to, kind: 'leads' })}`;
  const tvRef = useRef<HTMLDivElement>(null);
  const tv = useTvMode(tvRef);
  const TABS = [{ key: 'geral', label: 'Geral' }, { key: 'comercial', label: 'Comercial' }, { key: 'negocio', label: 'Negócio' }, { key: 'relacionamento', label: 'Relacionamento com o cliente' }, { key: 'contratos', label: 'Contratos' }, { key: 'atas', label: 'Atas de registro de preços' }, ...(can('projetos') ? [{ key: 'projetos', label: 'Projetos' }] : [])];
  return (
    <div className="w-full">
      <PageHeader
        icon={<Lightbulb className="h-9 w-9" strokeWidth={2.2} />}
        title="Inteligência"
        subtitle="Transforme dados em oportunidades e tome decisões mais estratégicas."
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
      {tv.active && <TvBar title="Inteligência" period={`${fmtDate(f.from)} a ${fmtDate(f.to)}`} tabs={TABS} tab={f.v} onTab={(v) => setF({ v })} onExit={tv.exit} queryKeys={[['intelligence'], ['insights'], ['contract-insights'], ['arps']]} />}
      <Tabs<string>
        label="Visão do relatório"
        className="mb-5"
        value={f.v}
        onChange={(v) => setF({ v })}
        tabs={TABS}
      />
      {f.v === 'projetos' ? <FrontsPanel tag={f.tag} onTag={(tag) => setF({ tag })} allowCreate={false} /> : f.v === 'atas' ? <ArpDashboard from={f.from} to={f.to} /> : f.v === 'contratos' ? <ContractInsights from={f.from} to={f.to} /> : <GeneralInsights from={f.from} to={f.to} view={f.v as InsightView} />}
      {f.v === 'comercial' && (<div className="mt-6">
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      <section aria-label="Indicadores" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {d ? d.kpis.map((k, i) => <KpiCard key={k.key} k={k} icon={KPI_LOOK[i]!.icon} tone={KPI_LOOK[i]!.tone} />) : Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-[92px] animate-pulse" />)}
      </section>
      {!d ? (q.isLoading ? <div className="card"><LoadingRows rows={8} /></div> : null) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <section className="card p-5 xl:col-span-7" aria-labelledby="h-perf">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h2 id="h-perf" className="text-lg font-bold text-ink">Desempenho comercial</h2>
              <Legend items={[{ label: 'Leads', color: CHART.leads }, { label: 'Vendas', color: CHART.sales }, { label: 'Receita (R$)', color: CHART.revenue }]} />
            </div>
            <ComboChart
              ariaLabel="Leads, vendas e receita por mês"
              categories={d.series.map((s) => monthLabel(s.month))}
              bars={[{ key: 'l', label: 'Leads', color: CHART.leads, values: d.series.map((s) => s.leads) }, { key: 'v', label: 'Vendas', color: CHART.sales, values: d.series.map((s) => s.sales) }]}
              line={{ key: 'r', label: 'Receita', color: CHART.revenue, values: d.series.map((s) => s.revenueCents), axis: 'right' }}
              rightFormat={(v) => brlShort(v)}
              tooltipTitle={(i) => monthYear(d.series[i]!.month)}
              tooltipRows={(i) => [
                { color: CHART.leads, text: `${d.series[i]!.leads} leads` },
                { color: CHART.revenue, text: `${d.series[i]!.sales} vendas` },
                { color: CHART.revenue, text: fmtBRL(d.series[i]!.revenueCents) },
              ]}
            />
          </section>
          <section className="card p-5 xl:col-span-5" aria-labelledby="h-orig">
            <h2 id="h-orig" className="mb-3 text-lg font-bold text-ink">Origem dos leads</h2>
            <Donut ariaLabel="Origem dos leads do período" items={d.origins.items.map((o) => ({ label: o.source, value: o.n, share: o.share }))} centerValue={fmtInt(d.origins.total)} centerLabel="leads" />
          </section>

          <section className="card p-5 xl:col-span-4" aria-labelledby="h-conv">
            <h2 id="h-conv" className="mb-1 text-lg font-bold text-ink">Conversão por etapa</h2>
            <p className="mb-3 text-xs text-muted">Leads criados no período e até onde chegaram (n={d.funnel[0]?.n ?? 0})</p>
            <BarRows gradient items={d.funnel.map((x) => ({ label: x.label, value: x.n, share: x.share }))} />
          </section>
          <section className="card p-5 xl:col-span-4" aria-labelledby="h-plans">
            <h2 id="h-plans" className="mb-4 text-lg font-bold text-ink">Vendas por plano</h2>
            {d.plans.total === 0 ? <p className="text-sm text-muted">Nenhuma venda no período.</p> : <BarRows color="#2F5986" items={d.plans.items.map((x) => ({ label: x.plan, value: x.n, share: x.share }))} />}
          </section>
          <section className="card p-5 xl:col-span-4" aria-labelledby="h-reg">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="h-reg" className="text-lg font-bold text-ink">Leads por região</h2>
              <span className="rounded-sm border border-line px-3 py-1.5 text-xs text-primary">Mapa de calor</span>
            </div>
            <div className="flex gap-4">
              <div className="shrink-0 rounded-md bg-[#F3F7FE] p-2"><SergipeMap data={d.regions.map} /></div>
              <ul className="min-w-0 flex-1 space-y-2">
                {d.regions.items.map((r) => (
                  <li key={r.city} className="grid grid-cols-[1fr_auto_40px] items-center gap-2 text-sm">
                    <span className="truncate text-primary">{r.city}</span>
                    <span className="num font-bold text-ink">{r.n}</span>
                    <span className="num text-right text-muted">{Math.round(r.share * 100)}%</span>
                  </li>
                ))}
                {!d.regions.items.length && <li className="text-sm text-muted">Sem cidade informada nos leads do período.</li>}
              </ul>
            </div>
          </section>

          <section className="card p-5 xl:col-span-5" aria-labelledby="h-team">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="h-team" className="text-lg font-bold text-ink">Atividades da equipe</h2>
              <span className="flex items-center gap-2 rounded-sm border border-line px-3 py-1.5 text-xs text-text"><CalendarDays className="h-3.5 w-3.5" />Período selecionado</span>
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">Atividades concluídas por pessoa no período</caption>
              <thead className="sr-only"><tr><th>Pessoa</th><th>Ligações</th><th>E-mails e mensagens</th><th>Reuniões</th><th>Total</th></tr></thead>
              <tbody>
                {d.team.map((u) => (
                  <tr key={u.userId} className="border-b border-line last:border-0">
                    <td className="py-2.5"><span className="flex items-center gap-3"><Avatar name={u.name} userId={u.userId} hasPhoto={u.hasAvatar} size={34} /><span className="text-text">{u.name}</span></span></td>
                    <td className="py-2.5"><span className="num flex items-center gap-2 text-text"><Phone className="h-4 w-4 text-success" aria-hidden />{u.calls}</span></td>
                    <td className="py-2.5"><span className="num flex items-center gap-2 text-text"><Mail className="h-4 w-4 text-primary" aria-hidden />{u.emails}</span></td>
                    <td className="py-2.5"><span className="num flex items-center gap-2 text-text"><CalendarDays className="h-4 w-4 text-purple" aria-hidden />{u.meetings}</span></td>
                    <td className="num py-2.5 text-right font-bold text-ink">{u.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card p-5 xl:col-span-7" aria-labelledby="h-ins">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="h-ins" className="text-lg font-bold text-ink">Principais insights</h2>
              <span className="text-xs text-muted">Gerados com base nos seus dados</span>
            </div>
            {d.insights.length === 0 ? (
              <p className="py-6 text-sm text-muted">Ainda não há volume suficiente no período para gerar insights (mínimo de {d.minSample} registros por análise).</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.insights.map((i) => (
                  <li key={i.kind} className="flex items-center gap-4 py-3">
                    <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-circle border-2 bg-surface', INSIGHT_LOOK[i.kind].cls)}>{INSIGHT_LOOK[i.kind].icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink">{i.title}</span>
                      <span className="block text-xs text-muted">{i.detail} <span className="text-faint">(n={i.n})</span></span>
                    </span>
                    <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-2xs text-faint">Frases geradas por regras fixas a partir dos números acima. Mostram associação, não causa.</p>
          </section>
        </div>
      )}
      </div>)}
      </TvArea>
    </div>
  );
}
