/** Inteligência → Contratos: indicadores da carteira contratada com filtros de cliente, categoria, plano, região, ciclo e período. */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SEGMENTS, SEGMENT_LABELS } from '@isp/domain';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtDate, fmtInt, fmtPct } from '../lib/format';
import { useLookups, useUrlState } from '../lib/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ErrorState, LoadingRows, Select } from '../components/ui/primitives';
import { MoneyRows } from './contracts/shared';
import { useArea } from './DealFields';

type G = { key: string; label: string; n: number; monthlyCents: number };
type D = {
  active: number; closed: number; closedInPeriod: number;
  revenue: { contractedMonthlyCents: number; contractedGlobalCents: number; billedCents: number | null; receivedCents: number | null; note: string };
  expiring: { d30: number; d60: number; d90: number; monthlyCents90: number }; atRisk: { n: number; monthlyCents: number };
  renewal: { renewed: number; notRenewed: number; rate: number | null; renewedMonthlyCents: number; closedMonthlyCents: number };
  adjustments: { forecast: number; done: number; increaseCents: number }; guarantees: { expired: number; expiring30: number };
  implantation: { n: number; avgDays: number | null }; pendencies: { alerts: number; overdue: number; openProcesses: number };
  byStage: G[]; byKind: G[]; bySegment: G[]; byPlan: G[]; byRegion: G[]; expiringByMonth: { month: string; n: number; monthlyCents: number }[];
  topRisk: { id: string; number: string; clientName: string; endAt: string | null; monthlyCents: number; closureExpected: boolean }[];
};

function Tile({ label, value, sub, tone = 'text-ink' }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className="card p-4"><p className="text-sm text-muted">{label}</p><p className={`num mt-1 text-xl font-extrabold ${tone}`}>{value}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>;
}
function Breakdown({ title, items }: { title: string; items: G[] }) {
  const total = items.reduce((a, x) => a + x.monthlyCents, 0);
  return (
    <section className="card p-5">
      <h3 className="mb-3 font-bold text-ink">{title}</h3>
      {!items.length ? <p className="text-sm text-muted">Sem contratos ativos.</p> : <MoneyRows items={items.slice(0, 8)} />}
      {items.length > 0 && <p className="mt-3 text-xs text-muted">Total {fmtBRL(total)}/mês</p>}
    </section>
  );
}

export function ContractInsights({ from, to }: { from: string; to: string }) {
  const { can } = useAuth();
  const lookups = useLookups();
  const area = useArea();
  const [f, setF] = useUrlState({ segment: '', planId: '', regionId: '', termMonths: '', kind: '', contactId: '' });
  const clients = useQuery({ queryKey: ['contracts', 'clients'], enabled: can('contratos'), queryFn: () => api<{ items: { contactId: string; clientName: string }[] }>(`/contracts${qs({ status: 'todos', pageSize: 500 })}`) });
  const clientList = useMemo(() => [...new Map((clients.data?.items ?? []).map((c) => [c.contactId, c.clientName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [clients.data]);
  const q = useQuery({ queryKey: ['intelligence-contracts', from, to, f], queryFn: () => api<D>(`/intelligence/contracts${qs({ from, to, ...f })}`) });
  const months = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="search" aria-label="Filtros dos contratos">
        {clientList.length > 0 && <Select aria-label="Cliente" className="w-auto" value={f.contactId} onChange={(e) => setF({ contactId: e.target.value })}><option value="">Todos os clientes</option>{clientList.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>}
        <Select aria-label="Categoria" className="w-auto" value={f.segment} onChange={(e) => setF({ segment: e.target.value })}><option value="">Todas as categorias</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</Select>
        <Select aria-label="Plano" className="w-auto" value={f.planId} onChange={(e) => setF({ planId: e.target.value })}><option value="">Todos os planos</option>{lookups.data?.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select aria-label="Região" className="w-auto" value={f.regionId} onChange={(e) => setF({ regionId: e.target.value })}><option value="">Todas as regiões</option>{area.data?.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        <Select aria-label="Ciclo" className="w-auto" value={f.termMonths} onChange={(e) => setF({ termMonths: e.target.value })}><option value="">Todos os ciclos</option>{[12, 24, 36, 48, 60].map((m) => <option key={m} value={m}>{m} meses</option>)}</Select>
        <Select aria-label="Tipo" className="w-auto" value={f.kind} onChange={(e) => setF({ kind: e.target.value })}><option value="">Público e privado</option><option value="publico">Público</option><option value="privado">Privado</option></Select>
      </div>
      {q.isLoading ? <div className="card"><LoadingRows rows={6} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
        const d = q.data!;
        return (
          <>
            <section aria-label="Receita" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Tile label="Receita mensal contratada" value={fmtBRL(d.revenue.contractedMonthlyCents)} sub={`Global contratada ${fmtBRL(d.revenue.contractedGlobalCents)}`} />
              <Tile label="Receita faturada" value={d.revenue.billedCents === null ? 'Aguardando ERP' : fmtBRL(d.revenue.billedCents)} sub="Vem das faturas do ERP/IXC" tone="text-muted" />
              <Tile label="Receita recebida" value={d.revenue.receivedCents === null ? 'Aguardando ERP' : fmtBRL(d.revenue.receivedCents)} sub="Vem das baixas do ERP/IXC" tone="text-muted" />
            </section>
            <p className="-mt-2 text-xs text-muted">{d.revenue.note}</p>
            <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Contratos ativos" value={fmtInt(d.active)} sub={`${d.closed} encerrados (${d.closedInPeriod} no período)`} />
              <Tile label="Vencem em 30 / 60 / 90 dias" value={`${d.expiring.d30} / ${d.expiring.d60} / ${d.expiring.d90}`} sub={`${fmtBRL(d.expiring.monthlyCents90)}/mês em 90 dias`} />
              <Tile label="Receita em risco" value={fmtBRL(d.atRisk.monthlyCents)} sub={`${d.atRisk.n} contrato(s) sem renovação concluída ou com encerramento previsto`} tone="text-danger" />
              <Tile label="Taxa de renovação (período)" value={fmtPct(d.renewal.rate)} sub={`${d.renewal.renewed} renovado(s), ${d.renewal.notRenewed} não renovado(s)`} />
              <Tile label="Valores renovados / encerrados" value={`${fmtBRL(d.renewal.renewedMonthlyCents)} / ${fmtBRL(d.renewal.closedMonthlyCents)}`} sub="Mensal, no período" />
              <Tile label="Reajustes previstos / realizados" value={`${d.adjustments.forecast} / ${d.adjustments.done}`} sub={`Aumento aplicado ${fmtBRL(d.adjustments.increaseCents)}/mês`} />
              <Tile label="Garantias vencidas / a vencer (30 d)" value={`${d.guarantees.expired} / ${d.guarantees.expiring30}`} tone={d.guarantees.expired ? 'text-danger' : 'text-ink'} />
              <Tile label="Tempo médio de implantação" value={d.implantation.avgDays === null ? 'N/D' : `${d.implantation.avgDays} dias`} sub={`${d.implantation.n} ativação(ões) no período`} />
              <Tile label="Pendências contratuais" value={fmtInt(d.pendencies.alerts)} sub={`${d.pendencies.overdue} atrasada(s) · ${d.pendencies.openProcesses} processo(s) aberto(s)`} />
            </section>
            <section className="card p-5">
              <h3 className="mb-3 font-bold text-ink">Vencimentos nos próximos 12 meses</h3>
              <div className="scroll-thin flex items-end gap-2 overflow-x-auto pb-1" role="img" aria-label="Contratos que vencem por mês">
                {(() => { const max = Math.max(1, ...d.expiringByMonth.map((m) => m.monthlyCents)); return d.expiringByMonth.map((m) => (
                  <div key={m.month} className="flex min-w-[52px] flex-1 flex-col items-center gap-1" title={`${months(m.month)}: ${m.n} contrato(s), ${fmtBRL(m.monthlyCents)}/mês`}>
                    <span className="num text-xs font-semibold text-ink">{m.n || ''}</span>
                    <div className="w-full rounded-t-sm bg-primary/80" style={{ height: `${Math.max(m.monthlyCents ? 6 : 2, (m.monthlyCents / max) * 120)}px`, opacity: m.n ? 1 : 0.25 }} />
                    <span className="text-[11px] capitalize text-muted">{months(m.month)}</span>
                  </div>
                )); })()}
              </div>
            </section>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Breakdown title="Por plano/produto" items={d.byPlan} />
              <Breakdown title="Por região" items={d.byRegion} />
              <Breakdown title="Por categoria" items={d.bySegment} />
              <Breakdown title="Público e privado" items={d.byKind} />
            </div>
            <section className="card p-5">
              <h3 className="mb-2 font-bold text-ink">Maior receita em risco</h3>
              {!d.topRisk.length ? <p className="text-sm text-muted">Nenhum contrato em risco.</p> : (
                <ul className="divide-y divide-line">{d.topRisk.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{can('contratos') ? <Link className="link font-semibold" to={`/contracts/${r.id}`}>{r.clientName}</Link> : <span className="font-semibold text-ink">{r.clientName}</span>}<span className="text-sm text-muted"> · {r.number} · vence {fmtDate(r.endAt)}{r.closureExpected ? ' · encerramento previsto' : ''}</span></span><span className="num font-semibold">{fmtBRL(r.monthlyCents)}/mês</span></li>)}</ul>
              )}
            </section>
          </>
        );
      })()}
    </div>
  );
}
