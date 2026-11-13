/**
 * Inteligência → Eficiência orçamentária: quanto resultado cada área produz com o que gasta.
 * Cada bloco diz a fonte e o tipo de atribuição (direta, influenciada ou correlação). Redução de gasto sozinha não é eficiência.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ATTRIBUTION_LABELS, EFFICIENCY_SITUATION_INFO, indexBase100, type Attribution, type EfficiencySituation } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { BarRows, LineChart } from '../../components/charts/charts';
import { Chip, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';

type Totals = { invested: number; approved: number; result: number; wins: number; leads: number; qualifiedLeads: number; opportunities: number; efficiency: number | null; costPerSale: number | null; costPerLead: number | null; costPerQualifiedLead: number | null; costPerOpportunity: number | null; costVariation: number | null; performanceVariation: number | null; efficiencyVariation: number | null; deviation: { abs: number; pct: number | null }; marginalProductivity: number | null; attribution: Attribution };
type Center = { id: string; code: string; name: string; cost: number; approved: number; executionPct: number | null; result: number | null; wins: number | null; efficiency: number | null; costPerSale: number | null; attribution: string; situations: EfficiencySituation[] };
type Data = {
  period: { from: string; to: string; previous: { from: string; to: string } }; totals: Totals;
  series: { month: string; cost: number; approved: number; result: number; wins: number; leads: number; efficiency: number | null; costPerSale: number | null }[];
  centers: Center[];
  campaigns: { id: string; name: string; cost: number; leads: number; qualifiedLeads: number; opportunities: number; wins: number; revenue: number; costPerLead: number | null; costPerQualifiedLead: number | null; costPerOpportunity: number | null; revenuePerReal: number | null }[];
  relationship: { accounts: number; invested: number; influencedRevenue: number; influencedWins: number; investmentPerAccount: number | null };
  alerts: { costCenterId: string; code: string; situation: EfficiencySituation; label: string; hint: string }[];
  sources: Record<string, string>;
};
const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const money = (v: number | null) => (v === null ? '—' : fmtBRL(Math.round(v)));
const times = (v: number | null) => (v === null ? '—' : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`);
const mShort = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

export function EfficiencyPanel() {
  const y = new Date().getFullYear(), cur = `${y}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [f, setF] = useState({ from: `${y}-01`, to: cur, costCenterId: '' });
  const [index, setIndex] = useState(false);
  const q = useQuery({ queryKey: ['intelligence', 'budget-efficiency', f], queryFn: () => api<Data>(`/intelligence/budget-efficiency${qs({ from: f.from, to: f.to, costCenterId: f.costCenterId || undefined })}`) });
  const cats = q.data?.series.map((p) => mShort(p.month)) ?? [];
  return (
    <div className="space-y-5">
      <section className="card flex flex-wrap items-end gap-3 p-4" aria-label="Período da eficiência">
        <FormField label="De" htmlFor="ef-from"><Input id="ef-from" type="month" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></FormField>
        <FormField label="Até" htmlFor="ef-to"><Input id="ef-to" type="month" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></FormField>
        <FormField label="Centro de custos" htmlFor="ef-cc"><Select id="ef-cc" value={f.costCenterId} onChange={(e) => setF({ ...f, costCenterId: e.target.value })}><option value="">Todos que vejo</option>{q.data?.centers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></FormField>
        {q.data && <p className="text-xs text-muted">Comparado com {q.data.period.previous.from} a {q.data.period.previous.to} (mesmo tamanho).</p>}
      </section>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
        const d = q.data!, t = d.totals;
        const kpis: [string, string, string][] = [
          ['Total investido', fmtBRL(t.invested), `Variação do custo ${pct(t.costVariation)}`],
          ['Resultado produzido', fmtBRL(t.result), `${t.wins} venda(s) · variação ${pct(t.performanceVariation)}`],
          ['Eficiência (resultado por real)', times(t.efficiency), `Variação ${pct(t.efficiencyVariation)}`],
          ['Custo por venda', money(t.costPerSale), `Custo por oportunidade ${money(t.costPerOpportunity)}`],
          ['Custo por lead qualificado', money(t.costPerQualifiedLead), `${t.qualifiedLeads} de ${t.leads} leads`],
          ['Desvio do orçamento', fmtBRL(t.deviation.abs), `Realizado − aprovado (${pct(t.deviation.pct)})`],
          ['Produtividade marginal', times(t.marginalProductivity), 'Resultado extra por real extra'],
        ];
        return (
          <>
            <section aria-label="Indicadores de eficiência" className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
              {kpis.map(([l, v, h]) => <div key={l} className="bg-surface px-3.5 py-3"><p className="text-xs text-muted">{l}</p><p className="num mt-1 text-lg font-bold text-ink">{v}</p><p className="text-2xs text-faint">{h}</p></div>)}
            </section>
            <p className="text-xs text-muted">Atribuição dos totais: <b>{ATTRIBUTION_LABELS[t.attribution]}</b>. {d.sources['maturação']}</p>
            {d.alerts.length > 0 && (
              <section className="card p-4" aria-label="Análise gerencial">
                <h2 className="mb-2 font-display text-base font-bold text-ink">Análise gerencial</h2>
                <ul className="space-y-1.5 text-sm">{d.alerts.map((a, i) => <li key={i}><Chip tone="orange">{a.code}</Chip> <b className="text-ink">{a.label}.</b> <span className="text-text">{a.hint}</span></li>)}</ul>
              </section>
            )}
            <div className="grid gap-5 xl:grid-cols-2">
              <section className="card p-4" aria-label="Custos versus resultados">
                <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-display text-base font-bold text-ink">Custos × resultados</h2><label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={index} onChange={(e) => setIndex(e.target.checked)} /> Índice (base 100)</label></div>
                {index ? <LineChart categories={cats} ariaLabel="Custos e resultados em índice base 100" format={(v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} tooltipTitle={(i) => d.series[i]!.month} series={[{ key: 'c', label: 'Custo (índice)', color: '#D4752C', values: indexBase100(d.series.map((s) => s.cost)).map((v) => v ?? 0) }, { key: 'r', label: 'Resultado (índice)', color: '#2F5986', values: indexBase100(d.series.map((s) => s.result)).map((v) => v ?? 0) }]} />
                  : <LineChart categories={cats} ariaLabel="Custo realizado e resultado em reais" format={(v) => fmtBRL(Math.round(v))} tooltipTitle={(i) => d.series[i]!.month} series={[{ key: 'c', label: 'Custo realizado (R$)', color: '#D4752C', values: d.series.map((s) => s.cost) }, { key: 'r', label: 'Resultado: vendas (R$)', color: '#2F5986', values: d.series.map((s) => s.result) }]} />}
              </section>
              <section className="card p-4" aria-label="Planejado versus realizado versus resultado">
                <h2 className="mb-2 font-display text-base font-bold text-ink">Aprovado × realizado × resultado</h2>
                <LineChart categories={cats} ariaLabel="Aprovado, realizado e resultado por mês" format={(v) => fmtBRL(Math.round(v))} tooltipTitle={(i) => d.series[i]!.month} series={[{ key: 'a', label: 'Aprovado', color: '#7D8791', dashed: true, values: d.series.map((s) => s.approved) }, { key: 'c', label: 'Realizado', color: '#D4752C', values: d.series.map((s) => s.cost) }, { key: 'r', label: 'Resultado', color: '#2F5986', values: d.series.map((s) => s.result) }]} />
              </section>
              <section className="card p-4" aria-label="Custo por resultado">
                <h2 className="mb-2 font-display text-base font-bold text-ink">Custo por venda</h2>
                {d.series.every((s) => s.costPerSale === null) ? <p className="py-10 text-center text-sm text-muted">Sem custo realizado com venda no mesmo mês: não há custo por venda para mostrar.</p> : <LineChart categories={cats} ariaLabel="Custo por venda por mês" format={(v) => fmtBRL(Math.round(v))} tooltipTitle={(i) => d.series[i]!.month} series={[{ key: 'cps', label: 'Custo por venda', color: '#8F6BB8', values: d.series.map((s) => s.costPerSale ?? 0) }]} />}
                <p className="mt-1 text-xs text-muted">Meses sem venda aparecem como zero no gráfico (sem custo por venda calculável).</p>
              </section>
              <section className="card p-4" aria-label="Tendência de eficiência">
                <h2 className="mb-2 font-display text-base font-bold text-ink">Tendência de eficiência</h2>
                {d.series.every((s) => s.efficiency === null) ? <p className="py-10 text-center text-sm text-muted">Sem custo realizado no período: a eficiência precisa de custo para ser calculada.</p> : <LineChart categories={cats} ariaLabel="Resultado por real investido por mês" format={(v) => `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`} tooltipTitle={(i) => d.series[i]!.month} series={[{ key: 'e', label: 'Resultado por real', color: '#16A34A', values: d.series.map((s) => s.efficiency ?? 0) }]} />}
              </section>
            </div>
            <section className="card overflow-x-auto p-4" aria-label="Eficiência por centro de custos">
              <h2 className="mb-1 font-display text-base font-bold text-ink">Eficiência por centro de custos</h2>
              <p className="mb-3 text-xs text-muted">Só centros ligados a um time têm resultado próprio (vendas do time). Os demais aparecem só com custo e execução, para não comparar o que não é comparável.</p>
              <BarRows items={d.centers.filter((c) => c.efficiency !== null).map((c) => ({ label: `${c.code} · ${times(c.efficiency)} por real`, value: c.efficiency!, share: null }))} />
              <table className="mt-4 w-full min-w-[800px] text-sm">
                <thead className="bg-surface-2 text-left text-xs text-muted"><tr>{['Centro', 'Aprovado', 'Realizado', 'Execução', 'Resultado', 'Custo por venda', 'Eficiência', 'Situação'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>{d.centers.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-3 py-2"><b className="text-ink">{c.code}</b> <span className="text-muted">{c.name}</span></td>
                    <td className="num px-3 py-2">{fmtBRL(c.approved)}</td><td className="num px-3 py-2">{fmtBRL(c.cost)}</td>
                    <td className="num px-3 py-2">{c.executionPct === null ? '—' : `${c.executionPct.toLocaleString('pt-BR')}%`}</td>
                    <td className="num px-3 py-2">{c.result === null ? <span className="text-xs text-muted">sem resultado próprio</span> : `${fmtBRL(c.result)} (${c.wins})`}</td>
                    <td className="num px-3 py-2">{money(c.costPerSale)}</td><td className="num px-3 py-2">{times(c.efficiency)}</td>
                    <td className="px-3 py-2">{c.situations.map((x) => <span key={x} className={clsx('mr-1 inline-block text-xs', EFFICIENCY_SITUATION_INFO[x].tone === 'atencao' ? 'text-[#C2610C]' : EFFICIENCY_SITUATION_INFO[x].tone === 'bom' ? 'text-[#15803D]' : 'text-muted')}>{EFFICIENCY_SITUATION_INFO[x].label}</span>)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </section>
            <div className="grid gap-5 xl:grid-cols-2">
              <section className="card overflow-x-auto p-4" aria-label="Marketing: campanhas">
                <h2 className="mb-1 font-display text-base font-bold text-ink">Marketing: campanhas <span className="text-xs font-normal text-muted">({ATTRIBUTION_LABELS.direta})</span></h2>
                <p className="mb-3 text-xs text-muted">{d.sources.campanhas}</p>
                {!d.campaigns.length ? <p className="text-sm text-muted">Nenhum lançamento ligado a campanha com despesa no período.</p> : (
                  <table className="w-full min-w-[600px] text-sm"><thead className="bg-surface-2 text-left text-xs text-muted"><tr>{['Campanha', 'Custo', 'Leads', 'Custo/lead qualif.', 'Custo/oport.', 'Vendas', 'Receita por real'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                    <tbody>{d.campaigns.map((c) => <tr key={c.id} className="border-t border-line"><td className="px-3 py-2 text-ink">{c.name}</td><td className="num px-3 py-2">{fmtBRL(c.cost)}</td><td className="num px-3 py-2">{c.leads} ({c.qualifiedLeads} qualif.)</td><td className="num px-3 py-2">{money(c.costPerQualifiedLead)}</td><td className="num px-3 py-2">{money(c.costPerOpportunity)}</td><td className="num px-3 py-2">{c.wins} · {fmtBRL(c.revenue)}</td><td className="num px-3 py-2">{times(c.revenuePerReal)}</td></tr>)}</tbody></table>
                )}
              </section>
              <section className="card p-4" aria-label="Relacionamento e ABM">
                <h2 className="mb-1 font-display text-base font-bold text-ink">Relacionamento e ABM <span className="text-xs font-normal text-muted">({ATTRIBUTION_LABELS.influenciada})</span></h2>
                <p className="mb-3 text-xs text-muted">{d.sources.relacionamento}</p>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-muted">Contas que receberam</dt><dd className="num font-bold text-ink">{d.relationship.accounts}</dd></div>
                  <div><dt className="text-xs text-muted">Investimento em brindes</dt><dd className="num font-bold text-ink">{fmtBRL(d.relationship.invested)}</dd></div>
                  <div><dt className="text-xs text-muted">Investimento por conta</dt><dd className="num font-bold text-ink">{money(d.relationship.investmentPerAccount)}</dd></div>
                  <div><dt className="text-xs text-muted">Receita influenciada</dt><dd className="num font-bold text-ink">{fmtBRL(d.relationship.influencedRevenue)} ({d.relationship.influencedWins})</dd></div>
                </dl>
              </section>
            </div>
            <section className="card p-4 text-xs text-muted" aria-label="Fontes dos números">
              <h2 className="mb-1 text-sm font-semibold text-ink">De onde vem cada número</h2>
              <ul className="list-disc space-y-0.5 pl-5">{Object.entries(d.sources).map(([k, v]) => <li key={k}><b>{k[0]!.toUpperCase() + k.slice(1)}:</b> {v}</li>)}</ul>
            </section>
          </>
        );
      })()}
    </div>
  );
}
