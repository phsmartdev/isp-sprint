/** Inteligência geral: indicadores por visão (Comercial, Negócio, Relacionamento) e cohort de retenção. */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtDate, fmtInt } from '../lib/format';
import { ErrorState, LoadingRows } from '../components/ui/primitives';
import { BarRows } from '../components/charts/charts';
import { AracajuZonesMap } from '../components/charts/AracajuZonesMap';
import { FitText } from '../components/ui/FitText';

const ZONE_LABEL: Record<string, string> = { norte: 'Zona Norte', sul: 'Zona Sul', leste: 'Zona Leste', oeste: 'Zona Oeste', outras: 'Outras regiões' };

type Reason = { label: string; n: number; share: number };
type Data = {
  negocio: { activeCustomers: number; activeOn: { date: string; n: number; dayBefore: { date: string; n: number }; monthBefore: { date: string; n: number } }; cancelledCustomers: number; cancelledInPeriod: number; billingCents: number; ticketCents: number | null; plans: { name: string; customers: number; billingCents: number }[]; portsTotal: number; portsUsed: number; portsRate: number | null };
  relacionamento: { overdueCustomers: number; overdueRate: number | null; openInvoicesCents: number; churnRate: number | null; cancelReasons: Reason[]; cancelReasonsScope: 'periodo' | 'todos' };
  comercial: { leads: number; won: number; wonCents: number; lost: number; lostCents: number; openOpportunities: number; lossReasons: Reason[] };
  cohorts: { month: string; size: number; active: number; cancelled: number; retention: (number | null)[] }[];
};
export type InsightView = 'geral' | 'comercial' | 'negocio' | 'relacionamento';

/** Valor curto para os cartões: R$ 48,8 mil, R$ 1,2 mi. O valor exato aparece ao passar o mouse. */
const brlCompact = (c: number | null | undefined) => {
  if (c == null) return 'N/D';
  const v = c / 100;
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(v) >= 10_000) return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return fmtBRL(c);
};
const pct = (r: number | null | undefined, digits = 1) => (r == null ? 'N/D' : `${(r * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthName = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;

function Stat({ label, value, hint, tone, title }: { label: string; value: string; hint?: string; tone?: 'danger' | 'success'; title?: string }) {
  return (
    <div className="card min-w-0 p-4" title={title}>
      <p className="truncate text-sm text-muted">{label}</p>
      <FitText className={`num truncate whitespace-nowrap text-xl font-extrabold leading-tight sm:text-[26px] ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink'}`}>{value}</FitText>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
function Block({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card min-w-0 p-5">
      <h2 className="text-md font-bold text-ink">{title}</h2>
      {desc && <p className="mb-3 text-sm text-muted">{desc}</p>}
      {children}
    </section>
  );
}
const reasonBars = (r: Reason[]) => (r.length ? <BarRows items={r.slice(0, 8).map((x) => ({ label: `${x.label} (${x.n})`, value: x.n, share: x.share }))} /> : <p className="text-sm text-muted">Sem registros no período.</p>);

/** Cor da célula: verde (retém) → vermelho (perde). */
const heat = (v: number) => `hsl(${Math.round(v * 120)} 65% ${92 - v * 30}%)`;

function Cohort({ cohorts }: { cohorts: Data['cohorts'] }) {
  const max = Math.max(0, ...cohorts.map((c) => c.retention.length));
  return (
    <Block title="Análise de cohort" desc="Clientes agrupados pelo mês em que entraram. Cada célula mostra quantos % ainda estavam ativos ao fim de cada mês de vida. Ativos e cancelados à direita.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-separate border-spacing-0.5 text-center text-xs">
          <thead className="text-muted">
            <tr><th className="px-2 py-1 text-left font-medium">Entrada</th><th className="px-2 py-1 font-medium">Clientes</th>{Array.from({ length: max }, (_, k) => <th key={k} className="px-1 py-1 font-medium">M{k}</th>)}<th className="px-2 py-1 font-medium">Ativos</th><th className="px-2 py-1 font-medium">Cancelados</th></tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.month}>
                <td className="px-2 py-1 text-left font-semibold text-ink">{monthName(c.month)}</td>
                <td className="num px-2 py-1 text-ink">{c.size}</td>
                {Array.from({ length: max }, (_, k) => {
                  const v = c.retention[k];
                  return <td key={k} className="num rounded px-1 py-1 text-ink" style={v == null || !c.size ? undefined : { background: heat(v) }}>{v == null || !c.size ? '' : `${Math.round(v * 100)}%`}</td>;
                })}
                <td className="num px-2 py-1 text-success">{c.active}</td>
                <td className="num px-2 py-1 text-danger">{c.cancelled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

type Heat = { zones: { zone: string; n: number; condos: number }[]; condos: { id: string; name: string; region: string; zone: string; n: number; ports: number | null }[]; inCondos: number; status: 'ativos' | 'cancelados'; date: string; total: number; cities: { city: string; n: number }[]; districts: { city: string; district: string; n: number }[]; withoutAddress: number };

function Heatmap({ from, to }: { from: string; to: string }) {
  const [status, setStatus] = useState<'ativos' | 'cancelados'>('ativos');
  const q = useQuery({ queryKey: ['intelligence-heat', status, from, to], queryFn: () => api<Heat>(`/intelligence/heatmap${qs({ from, to, status })}`), placeholderData: (x) => x });
  const d = q.data;
  return (
    <section className="card min-w-0 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-md font-bold text-ink">Mapa de calor da base</h2>
          <p className="text-sm text-muted">{status === 'ativos' ? `Clientes ativos em ${d ? fmtDate(d.date) : '…'}, por zona de Aracaju e condomínio.` : 'Clientes que cancelaram no período, por zona e condomínio.'}</p>
        </div>
        <div className="flex rounded-md border border-line bg-surface p-1" role="radiogroup" aria-label="Clientes no mapa">
          {(['ativos', 'cancelados'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={status === k} onClick={() => setStatus(k)} className={`rounded-sm px-4 py-1.5 text-sm ${status === k ? (k === 'ativos' ? 'bg-primary font-semibold text-white' : 'bg-danger font-semibold text-white') : 'text-ink hover:bg-surface-2'}`}>{k === 'ativos' ? 'Ativos' : 'Cancelados'}</button>)}
        </div>
      </div>
      {!d ? <LoadingRows rows={4} /> : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="h-[480px] rounded-md bg-[#F3F7FE] p-2 sm:h-[560px]"><AracajuZonesMap zones={d.zones} condos={d.condos} tone={status === 'cancelados' ? 'red' : 'blue'} /></div>
          <div className="min-w-0 space-y-4">
            <p className="text-sm text-text"><span className="num text-xl font-extrabold text-ink">{fmtInt(d.total)}</span> clientes · <span className="num font-semibold text-ink">{fmtInt(d.inCondos)}</span> em condomínios cadastrados</p>
            <div><h3 className="mb-2 text-sm font-semibold text-muted">Por zona</h3><BarRows items={d.zones.filter((z) => z.zone !== 'outras' || z.n > 0).map((z) => ({ label: `${ZONE_LABEL[z.zone] ?? z.zone} (${z.condos} cond.)`, value: z.n, share: d.inCondos ? z.n / d.inCondos : null }))} /></div>
            <div><h3 className="mb-2 text-sm font-semibold text-muted">Condomínios com mais clientes</h3>{d.condos.length ? <BarRows items={d.condos.slice(0, 10).map((c) => ({ label: c.name, value: c.n, share: d.inCondos ? c.n / d.inCondos : null }))} /> : <p className="text-sm text-muted">Nenhum cliente ligado a condomínio. Informe o condomínio na oportunidade ou na planilha de importação.</p>}</div>
            {d.zones.find((z) => z.zone === 'outras')?.n ? <p className="text-xs text-muted">"Outras": condomínios em regiões sem Norte, Sul, Leste ou Oeste no nome. Renomeie as regiões em Área de atendimento.</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}

export function GeneralInsights({ from, to, view }: { from: string; to: string; view: InsightView }) {
  const q = useQuery({ queryKey: ['intelligence-general', from, to], queryFn: () => api<Data>(`/intelligence/general${qs({ from, to })}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { negocio: n, relacionamento: r, comercial: c, cohorts } = q.data!;
  const show = (v: InsightView) => view === 'geral' || view === v;
  return (
    <div className="min-w-0 space-y-4">
      {show('negocio') && (
        <>
          {view === 'geral' && <h2 className="text-lg font-bold text-ink">Negócio</h2>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
            <Stat label="Clientes ativos" value={fmtInt(n.activeOn.n)} title={`Posição da base em ${fmtDate(n.activeOn.date)} (data final do filtro). Escolha hoje para ver a base atual.`} hint={`Mês anterior ${fmtInt(n.activeOn.monthBefore.n)}`} tone={n.activeOn.n < n.activeOn.monthBefore.n ? 'danger' : undefined} />
            <Stat label="Clientes cancelados" value={fmtInt(n.cancelledCustomers)} hint={`${fmtInt(n.cancelledInPeriod)} no período`} />
            <Stat label="Base de faturamento" value={brlCompact(n.billingCents)} title={fmtBRL(n.billingCents)} hint={`${fmtBRL(n.billingCents)}/mês`} />
            <Stat label="Ticket médio" value={fmtBRL(n.ticketCents)} hint="Por cliente ativo" />
            <Stat label="Planos ativos" value={fmtInt(n.plans.length)} />
            <Stat label="Ocupação das portas" value={n.portsTotal ? pct(n.portsRate) : '—'} hint={n.portsTotal ? `${n.portsUsed} de ${n.portsTotal} portas` : 'Cadastre as portas da CTO'} />
          </div>
          <Block title="Planos ativos" desc="Clientes e faturamento mensal por plano.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Plano</th><th className="px-4 py-2 font-medium">Clientes</th><th className="px-4 py-2 font-medium">Faturamento/mês</th><th className="px-4 py-2 font-medium">% da base</th></tr></thead>
                <tbody>{n.plans.map((p) => <tr key={p.name} className="border-t border-line"><td className="px-4 py-2 font-semibold text-ink">{p.name}</td><td className="num px-4 py-2">{fmtInt(p.customers)}</td><td className="num px-4 py-2">{fmtBRL(p.billingCents)}</td><td className="num px-4 py-2">{pct(n.billingCents ? p.billingCents / n.billingCents : null)}</td></tr>)}</tbody>
              </table>
            </div>
          </Block>
        </>
      )}
      {show('relacionamento') && (
        <>
          {view === 'geral' && <h2 className="pt-2 text-lg font-bold text-ink">Relacionamento com o cliente</h2>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Inadimplência" value={pct(r.overdueRate)} tone={r.overdueRate && r.overdueRate > 0.05 ? 'danger' : undefined} hint={`${fmtInt(r.overdueCustomers)} inadimplentes`} />
            <Stat label="Faturas em aberto" value={brlCompact(r.openInvoicesCents)} title={fmtBRL(r.openInvoicesCents)} hint="Estimado pelos inadimplentes" />
            <Stat label="Cancelamento no período" value={pct(r.churnRate)} />
            <Stat label="Cancelados no período" value={fmtInt(n.cancelledInPeriod)} />
          </div>
          <Block title="Motivos de cancelamento" desc={r.cancelReasonsScope === 'periodo' ? 'Cancelamentos do período.' : 'Sem cancelamentos no período: mostrando todos os cancelados.'}>{reasonBars(r.cancelReasons)}</Block>
        </>
      )}
      {show('comercial') && (
        <>
          {view === 'geral' && <h2 className="pt-2 text-lg font-bold text-ink">Comercial</h2>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat label="Leads no período" value={fmtInt(c.leads)} />
            <Stat label="Oportunidades abertas" value={fmtInt(c.openOpportunities)} />
            <Stat label="Vendas fechadas" value={fmtInt(c.won)} tone="success" hint={`${brlCompact(c.wonCents)}/mês`} />
            <Stat label="Vendas perdidas" value={fmtInt(c.lost)} tone="danger" hint={`${brlCompact(c.lostCents)}/mês`} />
            <Stat label="Taxa de ganho" value={pct(c.won + c.lost ? c.won / (c.won + c.lost) : null)} hint="Fechadas ÷ (fechadas + perdidas)" />
          </div>
          <Block title="Motivos de objeção e perda" desc="Por que as oportunidades foram perdidas no período.">{reasonBars(c.lossReasons)}</Block>
        </>
      )}
      {(view === 'geral' || view === 'negocio' || view === 'relacionamento') && <Heatmap from={from} to={to} />}
      {(view === 'geral' || view === 'negocio' || view === 'relacionamento') && <Cohort cohorts={cohorts} />}
    </div>
  );
}
