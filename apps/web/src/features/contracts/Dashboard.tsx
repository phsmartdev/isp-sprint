import { MoneyToggle } from '../../lib/privacy';
/**
 * Painel da Gestão de Contratos: carteira estratificada, vencimentos, faturamento por tipo no período e visão executiva.
 * A ordem e as seções visíveis vêm de Configurações → Contratos (padrão: faturamento e visão executiva no fim).
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CalendarDays, FileSignature, Wallet } from 'lucide-react';
import { BILLING_TYPES, BILLING_TYPE_HINTS, DEFAULT_DASHBOARD, type BillingType, type ContractStage, type DashboardConfig, type DashboardSection } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtBRLCompact, fmtDate, fmtInt, fmtPct } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { ErrorState, LoadingRows } from '../../components/ui/primitives';
import { DateRange } from '../../components/ui/DateRange';
import { DaysLeft, MoneyRows, TYPE_COLOR, type ContractRow } from './shared';
import { FitText } from '../../components/ui/FitText';

type Strat = { key: string; label: string; n: number; monthlyCents: number; billedCents: number };
type Exec = {
  contractedAnnualCents: number; backlogCents: number; publicAnnualCents: number;
  backlogByType: { type: BillingType; label: string; cents: number }[];
  risk: { days: number; n: number; monthlyCents: number; annualCents: number }[];
  concentration: { totalCents: number; top1: { key: string; name: string; cents: number } | null; top1Share: number | null; top5Share: number | null; hhi: number | null; level: 'baixa' | 'moderada' | 'alta' | null };
};
const CONC_LABEL = { baixa: 'Concentração baixa', moderada: 'Concentração moderada', alta: 'Concentração alta' } as const;
const CONC_TONE = { baixa: 'text-success', moderada: 'text-[#C2610C]', alta: 'text-danger' } as const;

/** Visão executiva: carteira, backlog, receita em risco por janela e dependência dos maiores clientes. */
type Money = (cents?: number | null) => string;

function Executive({ e, money }: { e: Exec; money: Money }) {
  const maxRisk = Math.max(1, ...e.risk.map((r) => r.monthlyCents));
  const c = e.concentration;
  return (
    <section aria-label="Visão executiva" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm text-muted">Carteira contratada (12 meses)</p>
          <FitText className="num text-2xl font-extrabold text-ink" title={fmtBRL(e.contractedAnnualCents)}>{money(e.contractedAnnualCents)}</FitText>
          <p className="text-xs text-muted">{e.contractedAnnualCents ? `${fmtPct(e.publicAnnualCents / e.contractedAnnualCents)} em contratos públicos` : 'Sem contratos ativos'}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-muted">Backlog: falta faturar do contratado</p>
          <FitText className="num text-2xl font-extrabold text-ink" title={fmtBRL(e.backlogCents)}>{money(e.backlogCents)}</FitText>
          <div className="mt-2 flex h-2 w-full overflow-hidden bg-surface-2" aria-hidden>{e.backlogByType.map((t) => t.cents ? <div key={t.type} style={{ width: `${(t.cents / Math.max(1, e.backlogCents)) * 100}%`, background: TYPE_COLOR[t.type] }} /> : null)}</div>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">{e.backlogByType.map((t) => <span key={t.type} title={fmtBRL(t.cents)}>{t.label} <span className="num">{money(t.cents)}</span></span>)}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-muted">Dependência dos maiores clientes</p>
          {!c.top1 ? <p className="mt-2 text-sm text-muted">Sem dados.</p> : <>
            <p className="num flex flex-wrap items-baseline gap-x-2 text-2xl font-extrabold text-ink">{fmtPct(c.top1Share)} <span className="text-sm font-semibold text-muted">no maior cliente</span></p>
            <p className="truncate text-xs text-muted" title={c.top1.name}>{c.top1.name} · 5 maiores somam {fmtPct(c.top5Share)}</p>
            {c.level && <p className={clsx('mt-1 text-xs font-semibold', CONC_TONE[c.level])}>{CONC_LABEL[c.level]} (HHI {fmtInt(c.hhi ?? 0)})</p>}
          </>}
        </div>
      </div>
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold text-ink">Receita em risco</h3>
          <p className="text-xs text-muted">Contratos que terminam na janela sem renovação concluída, mais os com encerramento previsto.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {e.risk.map((r) => (
            <div key={r.days} className="min-w-0 border border-line p-3">
              <p className="text-xs font-semibold text-muted">Em {r.days} dias</p>
              <FitText className="num text-lg font-extrabold text-ink" title={`${fmtBRL(r.monthlyCents)}/mês`}>{money(r.monthlyCents)}<span className="text-xs font-semibold text-muted">/mês</span></FitText>
              <p className="num text-xs text-muted" title={`${fmtBRL(r.annualCents)}/ano`}>{r.n} contrato(s) · {money(r.annualCents)}/ano</p>
              <div className="mt-2 h-1.5 bg-surface-2" aria-hidden><div className="h-1.5 bg-danger" style={{ width: `${(r.monthlyCents / maxRisk) * 100}%`, opacity: 0.45 + 0.55 * (1 - r.days / 180) }} /></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type Dash = {
  executive: Exec;
  period: { from: string; to: string; prevFrom: string; prevTo: string };
  billing: { totalCents: number; prevTotalCents: number; note: string; byType: { type: BillingType; label: string; active: number; billedCents: number; billedPrevCents: number; monthlyCents: number; balance?: { credited: number; consumed: number; available: number } }[] };
  byBillingType: Strat[]; byKind: Strat[]; bySegment: Strat[]; byOwner: Strat[];
  topClients: { contactId: string; name: string; contracts: number; monthlyCents: number; billedCents: number }[];
  expiringByMonth: ({ month: string; monthlyCents: number } & Record<BillingType, number>)[];
  measurement: { contracts: number; lowBalance: { id: string; number: string; clientName: string; credited: number; available: number; usedShare: number | null }[] };
  portfolio: { avgTicketCents: number | null; avgAgeMonths: number | null; avgRemainingMonths: number | null; renewalPipelineCents: number; publicShare: number | null };
  byStage: { stage: ContractStage; label: string; n: number; monthlyCents: number }[];
  active: number; archived: number; pendingValidation: number; monthlyCents: number; globalCents: number;
  expiring: { d30: number; d60: number; d90: number }; atRisk: { n: number; monthlyCents: number };
  alerts: { open: number; overdue: number; byKind: { kind: string; label: string; n: number }[] };
  nextExpiring: ContractRow[]; attention: ContractRow[];
};
const STAGE_COLOR: Record<ContractStage, string> = { cadastro_validacao: '#E0A400', implantacao: '#7C3AED', vigente: '#16A34A', renovacao: '#2F5986', reajuste: '#EA7A0C', encerramento: '#DC2626', arquivado: '#64748B' };

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="text-xs text-muted">sem base no período anterior</span>;
  const d = (cur - prev) / prev;
  return <span className={clsx('text-xs font-semibold', d >= 0 ? 'text-success' : 'text-danger')}>{d >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(d))} vs. período anterior</span>;
}
function Stat({ icon, label, value, full, sub, tone }: { icon: React.ReactNode; label: string; value: string; full?: string; sub?: React.ReactNode; tone: string }) {
  return (
    <div className="card flex min-w-0 items-center gap-4 p-4">
      <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-circle', tone)}>{icon}</span>
      <div className="min-w-0 flex-1"><p className="text-sm text-muted">{label}</p><FitText className="num text-xl font-extrabold text-ink" title={full}>{value}</FitText>{sub && <div className="break-words text-xs text-muted">{sub}</div>}</div>
    </div>
  );
}
function StratCard({ title, items, colorOf }: { title: string; items: Strat[]; colorOf?: (k: string) => string }) {
  return (
    <section className="card p-5">
      <h3 className="mb-3 font-bold text-ink">{title}</h3>
      {!items.length ? <p className="text-sm text-muted">Sem dados.</p> : (
        <ul className="space-y-2.5">
          {items.slice(0, 8).map((x) => {
            const max = Math.max(1, ...items.map((y) => y.billedCents || y.monthlyCents));
            return (
              <li key={x.key}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span className="min-w-0 text-ink">{x.label} <span className="num text-muted">({x.n})</span></span><span className="num text-ink"><strong>{fmtBRL(x.billedCents)}</strong> <span className="text-muted">no período · {fmtBRL(x.monthlyCents)}/mês</span></span></div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${((x.billedCents || x.monthlyCents) / max) * 100}%`, background: colorOf?.(x.key) ?? '#2F5986', minWidth: x.n ? 4 : 0 }} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ContractsDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useUrlState({ from: `${today.slice(0, 7)}-01`, to: today });
  const q = useQuery({ queryKey: ['contracts', 'dashboard', f.from, f.to], queryFn: () => api<Dash>(`/contracts/dashboard${qs({ from: f.from, to: f.to })}`) });
  const view = useQuery({ queryKey: ['contracts', 'view'], queryFn: () => api<{ dashboard: DashboardConfig }>('/contracts/view'), staleTime: 60_000 });
  if (q.isLoading || view.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const cfg = view.data?.dashboard ?? DEFAULT_DASHBOARD;
  // valores dos cartões na medida do tamanho (mil, mi, bi); o valor inteiro fica no title
  const money: Money = cfg.compactValues ? fmtBRLCompact : fmtBRL;
  const months = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const maxExp = Math.max(1, ...d.expiringByMonth.map((m) => BILLING_TYPES.reduce((a, t) => a + m[t], 0)));
  const sections: Record<DashboardSection, () => React.ReactNode> = {
    faturamento: () => (
      <div className="space-y-3">
        <p className="text-sm text-muted">Faturamento de {fmtDate(d.period.from)} a {fmtDate(d.period.to)}, comparado com {fmtDate(d.period.prevFrom)} a {fmtDate(d.period.prevTo)}.</p>
        <section aria-label="Faturamento por tipo de contrato" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="card min-w-0 border-l-4 border-l-ink p-4">
            <p className="text-sm text-muted">Faturamento total no período</p>
            <FitText className="num text-2xl font-extrabold text-ink" title={fmtBRL(d.billing.totalCents)}>{money(d.billing.totalCents)}</FitText>
            <Delta cur={d.billing.totalCents} prev={d.billing.prevTotalCents} />
          </div>
          {d.billing.byType.map((t) => (
            <div key={t.type} className="card min-w-0 border-l-4 p-4" style={{ borderLeftColor: TYPE_COLOR[t.type] }}>
              <p className="text-sm text-muted">{t.label} <span className="text-xs">· {t.active} ativo(s)</span></p>
              <FitText className="num text-2xl font-extrabold text-ink" title={fmtBRL(t.billedCents)}>{money(t.billedCents)}</FitText>
              <Delta cur={t.billedCents} prev={t.billedPrevCents} />
              <p className="mt-1 text-xs text-muted">{t.type === 'medicao' && t.balance ? `Saldo disponível ${money(t.balance.available)} de ${money(t.balance.credited)}` : t.type === 'recorrente' ? `${money(t.monthlyCents)}/mês contratado` : BILLING_TYPE_HINTS[t.type]}</p>
            </div>
          ))}
        </section>
        <p className="text-xs text-muted">{d.billing.note}</p>
      </div>
    ),
    executivo: () => <Executive e={d.executive} money={money} />,
    indicadores: () => (
      <section aria-label="Indicadores da carteira" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<FileSignature className="h-6 w-6" />} tone="bg-primary-soft text-primary" label="Contratos ativos" value={fmtInt(d.active)} sub={`${d.pendingValidation} aguardando validação · ${d.archived} arquivados`} />
        <Stat icon={<Wallet className="h-6 w-6" />} tone="bg-success-soft text-success" label="Receita mensal contratada" value={money(d.monthlyCents)} full={fmtBRL(d.monthlyCents)} sub={`Global ${money(d.globalCents)} · ticket médio ${money(d.portfolio.avgTicketCents)}`} />
        <Stat icon={<CalendarDays className="h-6 w-6" />} tone="bg-warning-soft text-[#C2610C]" label="Vencem em 30 / 60 / 90 dias" value={`${d.expiring.d30} / ${d.expiring.d60} / ${d.expiring.d90}`} sub={`${money(d.portfolio.renewalPipelineCents)}/mês a renovar em 90 dias`} />
        <Stat icon={<AlertTriangle className="h-6 w-6" />} tone="bg-danger-soft text-danger" label="Receita em risco (90 dias)" value={money(d.atRisk.monthlyCents)} full={fmtBRL(d.atRisk.monthlyCents)} sub={`${d.atRisk.n} contrato(s) · ${d.alerts.open} notificação(ões), ${d.alerts.overdue} atrasada(s)`} />
      </section>
    ),
    perfil: () => (
      <section aria-label="Perfil da carteira" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Idade média dos contratos', d.portfolio.avgAgeMonths === null ? 'N/D' : `${d.portfolio.avgAgeMonths} meses`], ['Vigência restante média', d.portfolio.avgRemainingMonths === null ? 'N/D' : `${d.portfolio.avgRemainingMonths} meses`], ['Contratos públicos', fmtPct(d.portfolio.publicShare)], ['Contratos por medição', fmtInt(d.measurement.contracts)]].map(([l, v]) => (
          <div key={l} className="card p-4"><p className="text-sm text-muted">{l}</p><p className="num text-lg font-extrabold text-ink">{v}</p></div>
        ))}
      </section>
    ),
    estratificacao: () => (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <StratCard title="Por tipo de contrato" items={d.byBillingType} colorOf={(k) => TYPE_COLOR[k as BillingType]} />
        <StratCard title="Por responsável" items={d.byOwner} />
        <StratCard title="Por categoria de cliente" items={d.bySegment} colorOf={() => '#7C3AED'} />
        <StratCard title="Público e privado" items={d.byKind} colorOf={(k) => (k === 'publico' ? '#0E7490' : '#2F5986')} />
      </div>
    ),
    vencimentos: () => (
      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-ink">Vencimentos nos próximos 12 meses por tipo</h3>
          <div className="flex gap-3 text-xs text-muted">{BILLING_TYPES.map((t) => <span key={t} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: TYPE_COLOR[t] }} aria-hidden />{d.billing.byType.find((x) => x.type === t)?.label}</span>)}</div>
        </div>
        <div className="scroll-thin flex items-end gap-2 overflow-x-auto pb-1" role="img" aria-label="Contratos que vencem por mês e tipo">
          {d.expiringByMonth.map((m) => {
            const total = BILLING_TYPES.reduce((a, t) => a + m[t], 0);
            return (
              <div key={m.month} className="flex min-w-[52px] flex-1 flex-col items-center gap-1" title={`${months(m.month)}: ${total} contrato(s), ${fmtBRL(m.monthlyCents)}/mês`}>
                <span className="num text-xs font-semibold text-ink">{total || ''}</span>
                <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${Math.max(2, (total / maxExp) * 110)}px`, background: total ? undefined : '#EEF2F9' }}>
                  {BILLING_TYPES.map((t) => m[t] ? <div key={t} style={{ height: `${(m[t] / total) * 100}%`, background: TYPE_COLOR[t] }} /> : null)}
                </div>
                <span className="text-[11px] capitalize text-muted">{months(m.month)}</span>
              </div>
            );
          })}
        </div>
      </section>
    ),
    clientes: () => (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="card p-5 xl:col-span-2">
          <h3 className="mb-2 font-bold text-ink">Maiores clientes</h3>
          {!d.topClients.length ? <p className="text-sm text-muted">Sem contratos.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-1.5 font-medium">Cliente</th><th className="py-1.5 text-right font-medium">Contratos</th><th className="py-1.5 text-right font-medium">Mensal</th><th className="py-1.5 text-right font-medium">Faturado no período</th></tr></thead>
              <tbody>{d.topClients.map((c) => <tr key={c.contactId} className="border-t border-line"><td className="py-2"><Link className="link" to={`/customers/${c.contactId}`}>{c.name}</Link></td><td className="num py-2 text-right">{c.contracts}</td><td className="num py-2 text-right">{fmtBRL(c.monthlyCents)}</td><td className="num py-2 text-right font-semibold">{fmtBRL(c.billedCents)}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
        <section className="card p-5">
          <h3 className="mb-2 font-bold text-ink">Medição com saldo baixo</h3>
          <p className="mb-2 text-xs text-muted">Menos de 20% do saldo disponível.</p>
          {!d.measurement.lowBalance.length ? <p className="text-sm text-muted">Nenhum contrato com saldo baixo.</p> : (
            <ul className="space-y-2">{d.measurement.lowBalance.map((m) => (
              <li key={m.id}><Link to={`/contracts/${m.id}`} className="block rounded-md p-2 hover:bg-surface-2"><span className="block font-semibold text-ink">{m.clientName}</span><span className="text-xs text-muted">{m.number} · disponível {fmtBRL(m.available)} de {fmtBRL(m.credited)}</span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-danger" style={{ width: `${Math.min(100, (m.usedShare ?? 0) * 100)}%` }} /></span></Link></li>
            ))}</ul>
          )}
        </section>
      </div>
    ),
    etapas: () => (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="card p-5">
          <h3 className="mb-3 font-bold text-ink">Contratos por etapa</h3>
          <MoneyRows items={d.byStage.map((s) => ({ key: s.stage, label: s.label, n: s.n, monthlyCents: s.monthlyCents }))} colorOf={(k) => STAGE_COLOR[k as ContractStage]} />
        </section>
        <section className="card p-5">
          <h3 className="mb-1 font-bold text-ink">Próximos vencimentos</h3>
          {!d.nextExpiring.length ? <p className="py-4 text-sm text-muted">Nenhum nos próximos 120 dias.</p> : (
            <ul className="divide-y divide-line">{d.nextExpiring.map((r) => <li key={r.id}><Link to={`/contracts/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-1 py-2.5 hover:bg-surface-2"><span className="min-w-0"><span className="block truncate font-semibold text-ink">{r.clientName}</span><span className="text-xs text-muted">{r.number} · vence {fmtDate(r.endAt)}</span></span><span className="flex items-center gap-3"><span className="num text-sm font-semibold">{fmtBRL(r.monthlyCents)}</span><DaysLeft days={r.daysLeft} /></span></Link></li>)}</ul>
          )}
        </section>
        <section className="card p-5">
          <h3 className="mb-1 font-bold text-ink">Notificações abertas</h3>
          {!d.alerts.byKind.length ? <p className="py-4 text-sm text-muted">Nenhuma.</p> : <ul className="space-y-1.5 text-sm">{d.alerts.byKind.map((k) => <li key={k.kind} className="flex justify-between"><span>{k.label}</span><span className="num font-semibold">{k.n}</span></li>)}</ul>}
          {d.attention.length > 0 && <><h4 className="mb-1 mt-4 text-sm font-semibold text-danger">Com prazo vencido</h4><ul className="space-y-1 text-sm">{d.attention.map((r) => <li key={r.id}><Link className="link" to={`/contracts/${r.id}`}>{r.clientName}</Link> <span className="text-muted">· {r.number}</span></li>)}</ul></>}
        </section>
      </div>
    ),
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3"><MoneyToggle compact /><DateRange from={f.from} to={f.to} onChange={(r) => setF(r)} /></div>
      {cfg.order.filter((k) => !cfg.hidden.includes(k)).map((k) => <div key={k}>{sections[k]()}</div>)}
    </div>
  );
}
