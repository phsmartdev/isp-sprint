/**
 * Demonstrativo da governança do orçamento, brindes e patrocínios: 100% do que acontece no período, numa tela só.
 * Filtros discretos (ano, período, centro de custo e visão) no topo; seções que se acendem conforme a visão.
 * Valores em reais, sempre positivos (despesa é despesa; o sinal não precisa repetir isso).
 */
import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, Download } from 'lucide-react';
import { APPROVAL_STATE_LABELS, CONCESSION_KIND_LABELS, type ApprovalState, type ConcessionKind } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/primitives';
import { BandChip, BudgetShell, ExecBar, type Totals } from '../../features/budget/shared';

type Cat = Totals & { accountId: string; code: string; name: string; deviationPct: number | null; needsJustification: boolean };
type Sector = Totals & { costCenter: { id: string; code: string; name: string }; committed: number; paid: number; categories: Cat[] };
type Group = {
  requested: { count: number; cents: number }; approved: { count: number; cents: number }; executed: { count: number; cents: number; accounts: number }; paid: number;
  exceptions: number; rejected: number; cancelled: number; byKind: { kind: string; count: number; cents: number }[]; top: { id: string; name: string; cents: number; n: number }[];
};
type Gov = {
  period: { year: number; quarter: number | null; month: number | null; from: string; to: string; months: string[] };
  costCenters: { id: string; code: string; name: string }[];
  budget: Totals & { committed: number; paid: number; overdueCents: number; overdueCount: number; latePayments: number; charges: number; excess: number; guardianUsed: number; economy: number; pendingApproval: number; openQuestions: number; guardian: { pending: number; approvedCents: number } };
  approval: { state: string; count: number; cents: number }[];
  series: { month: string; planned: number; realized: number; committed: number; paid: number }[];
  sectors: Sector[];
  unplanned: { id: string; code: string | null; what: string; centerCode: string; amountCents: number; approvalState: string; concession: string | null; month: string }[];
  gifts: { plannedCents: number; approvedCents: number; purchasedCents: number; stockCents: number; lowStock: number; deliveries: { count: number; cents: number; accounts: number }; concessions: Group };
  sponsorships: Group;
  compliance: { realizedCents: number; executed: number; accounts: number; exceptions: number; conformityPct: number | null; exceptionPct: number | null; traceabilityPct: number | null; pendencies: number; withPendency: number };
  resources: { recurring: number; monthlyCents: number; withoutVault: number; assets: number; assetsCents: number };
  suppliers: { id: string; name: string; cents: number }[];
  activity: { at: string; area: 'orcamento' | 'concessao'; text: string; who: string | null; ref: string | null }[];
  attention: { level: 'alta' | 'media'; area: string; text: string }[];
};
type View = 'tudo' | 'orcamento' | 'brindes' | 'patrocinios';
const VIEWS: [View, string][] = [['tudo', 'Tudo'], ['orcamento', 'Orçamento'], ['brindes', 'Brindes'], ['patrocinios', 'Apoios e patrocínios']];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;
const pct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

/** Controle segmentado discreto (filtros elegantes: sem caixas pesadas). */
function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-surface-2 p-0.5">
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={clsx('rounded-full px-3 py-1 text-sm transition-colors', value === k ? 'bg-surface font-semibold text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink')}>{l}</button>
      ))}
    </div>
  );
}
function Pill({ label, children }: { label: string; children: ReactNode }) {
  return <label className="inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm"><span className="text-muted">{label}</span>{children}</label>;
}
const pillSelect = 'cursor-pointer rounded-full border-0 bg-surface py-1 pl-2.5 pr-7 text-sm font-semibold text-ink shadow-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-primary';

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'warning' }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={clsx('num mt-0.5 text-lg font-bold', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-[#C2610C]' : 'text-ink')}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
    </div>
  );
}
function Section({ title, hint, children, className, action }: { title: string; hint?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={clsx('card p-0', className)} aria-label={title}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3"><div><h2 className="text-md font-bold text-ink">{title}</h2>{hint && <p className="text-xs text-muted">{hint}</p>}</div>{action}</header>
      <div className="p-5">{children}</div>
    </section>
  );
}
/** Barra horizontal proporcional (fluxo do dinheiro, fornecedores). */
function FlowBar({ label, cents, max, tone = 'bg-primary', note }: { label: string; cents: number; max: number; tone?: string; note?: string }) {
  return (
    <li className="grid grid-cols-[9.5rem_1fr_8rem] items-center gap-3 text-sm">
      <span className="text-text">{label}</span>
      <span className="h-3 bg-surface-2"><span className={clsx('block h-full', tone)} style={{ width: `${max ? Math.max(cents ? 1.5 : 0, (cents / max) * 100) : 0}%` }} /></span>
      <span className="num text-right font-semibold text-ink">{fmtBRL(cents)}{note && <span className="block text-2xs font-normal text-muted">{note}</span>}</span>
    </li>
  );
}

function GroupView({ g, empty }: { g: Group; empty: string }) {
  const max = Math.max(g.requested.cents, g.approved.cents, g.executed.cents, g.paid, 1);
  if (!g.requested.count && !g.approved.count && !g.executed.count && !g.rejected && !g.cancelled) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <ul className="space-y-2.5">
          <FlowBar label="Aguardando decisão" cents={g.requested.cents} max={max} tone="bg-line-strong" note={`${g.requested.count} solicitação(ões)`} />
          <FlowBar label="Aprovado, a executar" cents={g.approved.cents} max={max} tone="bg-primary/50" note={`${g.approved.count} concessão(ões)`} />
          <FlowBar label="Executado" cents={g.executed.cents} max={max} note={`${g.executed.count} · ${g.executed.accounts} conta(s)`} />
          {g.paid > 0 && <FlowBar label="Pago (Financeiro)" cents={g.paid} max={max} tone="bg-[#15803D]" />}
        </ul>
        <p className="mt-3 text-xs text-muted">{g.exceptions} por aprovação excepcional · {g.rejected} rejeitada(s) · {g.cancelled} cancelada(s)</p>
      </div>
      <div className="space-y-4">
        {g.byKind.length > 0 && <div><p className="mb-1 text-xs font-semibold text-muted">Executado por tipo</p><ul className="space-y-1 text-sm">{g.byKind.map((k) => <li key={k.kind} className="flex justify-between gap-2"><span className="text-text">{CONCESSION_KIND_LABELS[k.kind as ConcessionKind] ?? k.kind} <span className="text-muted">· {k.count}</span></span><span className="num font-semibold text-ink">{fmtBRL(k.cents)}</span></li>)}</ul></div>}
        {g.top.length > 0 && <div><p className="mb-1 text-xs font-semibold text-muted">Contas que mais receberam</p><ul className="space-y-1 text-sm">{g.top.map((a) => <li key={a.id} className="flex justify-between gap-2"><Link to={`/customers/${a.id}?t=brindes`} className="truncate text-text hover:text-primary">{a.name} <span className="text-muted">· {a.n}</span></Link><span className="num font-semibold text-ink">{fmtBRL(a.cents)}</span></li>)}</ul></div>}
      </div>
    </div>
  );
}

export function BudgetIndicatorsPage() {
  const now = new Date();
  const [f, setF] = useUrlState({ y: String(now.getFullYear()), q: '', m: '', cc: '', v: 'tudo' });
  const view = (VIEWS.some(([k]) => k === f.v) ? f.v : 'tudo') as View;
  const params = { year: f.y, quarter: f.m ? undefined : f.q || undefined, month: f.m || undefined, costCenterId: f.cc || undefined };
  const q = useQuery({ queryKey: ['budget', 'governanca', params], queryFn: () => api<Gov>(`/budget/governanca${qs(params)}`) });
  const [open, setOpen] = useState<string[]>([]);
  const d = q.data;
  const show = (x: View) => view === 'tudo' || view === x;
  const period = f.m ? 'm' : f.q || 'ano';
  const csv = () => {
    if (!d) return;
    const rows: (string | number)[][] = [['Seção', 'Item', 'Planejado (R$)', 'Realizado (R$)', 'Comprometido (R$)', 'Pago (R$)', 'Observação']];
    const r = (c: number) => (c / 100).toFixed(2).replace('.', ',');
    rows.push(['Orçamento', 'Total', r(d.budget.planned), r(d.budget.realized), r(d.budget.committed), r(d.budget.paid), `Saldo ${r(d.budget.available)}`]);
    for (const s of d.sectors) { rows.push(['Centro de custo', `${s.costCenter.code} ${s.costCenter.name}`, r(s.planned), r(s.realized), r(s.committed), r(s.paid), '']); for (const c of s.categories) rows.push(['Categoria', `${s.costCenter.code} · ${c.code} ${c.name}`, r(c.planned), r(c.realized), '', '', c.deviationPct == null ? '' : `desvio ${c.deviationPct}%`]); }
    for (const m of d.series) rows.push(['Mês', m.month, r(m.planned), r(m.realized), r(m.committed), r(m.paid), '']);
    for (const [n, g] of [['Brindes (concessões)', d.gifts.concessions], ['Apoios e patrocínios', d.sponsorships]] as const) rows.push([n, 'Executado', '', r(g.executed.cents), r(g.approved.cents), r(g.paid), `${g.executed.count} executada(s), ${g.exceptions} exceção(ões)`]);
    for (const u of d.unplanned) rows.push(['Concessão não planejada', `${u.code ?? ''} ${u.what}`, r(u.amountCents), '', '', '', `${u.centerCode} ${u.month}`]);
    for (const a of d.attention) rows.push(['Ponto de atenção', a.area, '', '', '', '', a.text]);
    const blob = new Blob([`﻿${rows.map((x) => x.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `demonstrativo-governanca-${d.period.from}-a-${d.period.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const ccName = d?.costCenters.find((c) => c.id === f.cc);
  return (
    <BudgetShell subtitle="Demonstrativo da governança do orçamento, brindes e patrocínios: tudo o que foi planejado, aprovado, comprometido, realizado e pago, com os pontos de atenção.">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtros">
          <Pill label="Ano"><select aria-label="Ano" className={pillSelect} value={f.y} onChange={(e) => setF({ y: e.target.value })}>{[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select></Pill>
          <Segmented label="Período" value={period} onChange={(v) => setF(v === 'ano' ? { q: '', m: '' } : v === 'm' ? { q: '', m: String(now.getMonth() + 1) } : { q: v, m: '' })} options={[['ano', 'Ano'], ['1', '1º tri'], ['2', '2º tri'], ['3', '3º tri'], ['4', '4º tri'], ['m', 'Mês']]} />
          {f.m && <Pill label="Mês"><select aria-label="Mês" className={pillSelect} value={f.m} onChange={(e) => setF({ m: e.target.value })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Pill>}
          <Pill label="Centro"><select aria-label="Centro de custo" className={pillSelect} value={f.cc} onChange={(e) => setF({ cc: e.target.value })}><option value="">Todos</option>{d?.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Pill>
          <Segmented label="Visão" value={view} onChange={(v) => setF({ v })} options={VIEWS} />
          <button type="button" onClick={csv} disabled={!d} className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"><Download className="h-4 w-4" aria-hidden />Exportar</button>
        </div>
        {d && <p className="-mt-2 text-xs text-muted">{fmtDate(d.period.from)} a {fmtDate(d.period.to)} · {ccName ? `${ccName.code} · ${ccName.name}` : 'todos os centros de custo que você acompanha'} · valores em reais</p>}

        {q.isLoading ? <div className="card"><LoadingRows rows={8} /></div> : q.isError || !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            {show('orcamento') && (
              <dl className="grid grid-cols-2 gap-px overflow-hidden border border-line bg-line sm:grid-cols-3 xl:grid-cols-6" aria-label="Resumo do orçamento">
                <Kpi label="Planejado aprovado" value={fmtBRL(d.budget.planned)} sub={d.budget.adjusted ? `inclui ${fmtBRL(d.budget.adjusted)} do Guardião` : 'aprovado + ajustes'} />
                <Kpi label="Comprometido" value={fmtBRL(d.budget.committed)} sub="contratado" />
                <Kpi label="Realizado" value={fmtBRL(d.budget.realized)} sub={<ExecBar t={d.budget} />} />
                <Kpi label="Pago" value={fmtBRL(d.budget.paid)} sub={d.budget.overdueCount ? `${d.budget.overdueCount} vencido(s) em aberto` : 'confirmado pelo Financeiro'} tone={d.budget.overdueCount ? 'warning' : undefined} />
                <Kpi label="Saldo disponível" value={fmtBRL(d.budget.available)} tone={d.budget.available < 0 ? 'danger' : undefined} sub={d.budget.economy ? `economia ${fmtBRL(d.budget.economy)}` : undefined} />
                <Kpi label="Aguardando aprovação" value={fmtBRL(d.budget.pendingApproval)} sub={d.budget.openQuestions ? `${d.budget.openQuestions} questionamento(s)` : undefined} />
              </dl>
            )}

            {d.attention.length > 0 && (
              <section aria-label="Pontos de atenção" className="border-l-4 border-warning bg-warning-soft/40 px-5 py-3">
                <p className="mb-1.5 flex items-center gap-2 text-sm font-bold text-ink"><AlertTriangle className="h-4 w-4 text-[#C2610C]" aria-hidden />Pontos de atenção ({d.attention.length})</p>
                <ul className="space-y-1 text-sm">{d.attention.map((a, i) => <li key={i} className="flex gap-2"><span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.level === 'alta' ? 'bg-danger' : 'bg-warning')} aria-hidden /><span><b className="text-ink">{a.area}:</b> <span className="text-text">{a.text}</span></span></li>)}</ul>
              </section>
            )}

            {show('orcamento') && (
              <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
                <Section title="Evolução no período" hint="Planejado, realizado e pago por mês">
                  {(() => {
                    const max = Math.max(1, ...d.series.map((m) => Math.max(m.planned, m.realized, m.paid)));
                    return (
                      <>
                        <p className="mb-3 flex flex-wrap gap-4 text-xs text-muted"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary-soft ring-1 ring-primary/40" />Planejado</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" />Realizado</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-[#15803D]" />Pago</span></p>
                        <ul className="space-y-2">{d.series.map((m) => (
                          <li key={m.month} className="grid grid-cols-[3.5rem_1fr_9rem] items-center gap-3 text-sm">
                            <span className="text-muted">{mLabel(m.month)}</span>
                            <span className="relative h-5 bg-surface-2" title={`Planejado ${fmtBRL(m.planned)} · realizado ${fmtBRL(m.realized)} · pago ${fmtBRL(m.paid)}`}>
                              <span className="absolute inset-y-0 left-0 bg-primary-soft ring-1 ring-inset ring-primary/30" style={{ width: `${(m.planned / max) * 100}%` }} />
                              <span className={clsx('absolute inset-y-1 left-0', m.realized > m.planned ? 'bg-danger' : 'bg-primary')} style={{ width: `${(m.realized / max) * 100}%` }} />
                              <span className="absolute inset-y-[7px] left-0 bg-[#15803D]" style={{ width: `${(m.paid / max) * 100}%` }} />
                            </span>
                            <span className="num text-right text-ink">{fmtBRL(m.realized)}<span className="block text-2xs text-muted">de {fmtBRL(m.planned)}</span></span>
                          </li>
                        ))}</ul>
                      </>
                    );
                  })()}
                </Section>
                <Section title="Fluxo de aprovação" hint="Lançamentos do período, pela situação">
                  {!d.approval.length ? <p className="text-sm text-muted">Nenhum lançamento no período.</p> : (
                    <ul className="space-y-1.5 text-sm">{d.approval.map((a) => (
                      <li key={a.state} className="flex items-center justify-between gap-2"><span className={clsx('inline-flex items-center gap-2', a.state === 'rejeitado' ? 'text-danger' : 'text-text')}><span className={clsx('h-2 w-2 rounded-full', a.state.startsWith('aprovado') ? 'bg-[#15803D]' : a.state === 'rejeitado' ? 'bg-danger' : ['enviado', 'em_analise', 'questionado'].includes(a.state) ? 'bg-warning' : 'bg-line-strong')} aria-hidden />{APPROVAL_STATE_LABELS[a.state as ApprovalState] ?? a.state} <span className="text-muted">· {a.count}</span></span><span className="num font-semibold text-ink">{fmtBRL(a.cents)}</span></li>
                    ))}</ul>
                  )}
                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                    <div><dt className="text-xs text-muted">Budget Guardião</dt><dd className="font-semibold text-ink">{fmtBRL(d.budget.guardian.approvedCents)} aprovado{d.budget.guardian.pending ? ` · ${d.budget.guardian.pending} pendente(s)` : ''}</dd></div>
                    <div><dt className="text-xs text-muted">Excedentes autorizados</dt><dd className="font-semibold text-ink">{fmtBRL(d.budget.excess)}</dd></div>
                    <div><dt className="text-xs text-muted">Pagos com atraso</dt><dd className="font-semibold text-ink">{d.budget.latePayments}{d.budget.charges ? ` · ${fmtBRL(d.budget.charges)} juros/multa` : ''}</dd></div>
                    <div><dt className="text-xs text-muted">Concessões não planejadas</dt><dd className="font-semibold text-ink">{d.unplanned.length} · {fmtBRL(d.unplanned.reduce((t, u) => t + u.amountCents, 0))}</dd></div>
                  </dl>
                </Section>
              </div>
            )}

            {show('orcamento') && (
              <section className="card overflow-x-auto p-0" aria-label="Por centro de custo">
                <header className="flex items-baseline justify-between border-b border-line px-5 py-3"><h2 className="text-md font-bold text-ink">Por centro de custo</h2><span className="text-xs text-muted">Clique no centro para ver as categorias</span></header>
                {!d.sectors.length ? <EmptyState title="Sem centros de custo" description="Crie a estrutura em Planejamento orçamentário." /> : (
                  <table className="w-full min-w-[980px] text-sm">
                    <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted">{['Centro / categoria', 'Planejado', 'Comprometido', 'Realizado', 'Pago', '% execução', 'Desvio', 'Faixa'].map((h, i) => <th key={h} className={clsx('px-3 py-2.5 font-semibold', i === 0 && 'pl-5', i > 0 && i < 5 && 'text-right')}>{h}</th>)}</tr></thead>
                    <tbody>{d.sectors.map((s) => {
                      const isOpen = open.includes(s.costCenter.id);
                      const toJustify = s.categories.filter((c) => c.needsJustification).length;
                      return (
                        <Fragment key={s.costCenter.id}>
                          <tr className="cursor-pointer border-b border-line hover:bg-surface-2" onClick={() => setOpen((o) => (isOpen ? o.filter((x) => x !== s.costCenter.id) : [...o, s.costCenter.id]))}>
                            <td className="py-3 pl-5 pr-3"><button type="button" aria-expanded={isOpen} className="flex items-center gap-2 text-left font-semibold text-ink"><ChevronDown className={clsx('h-4 w-4 text-muted transition-transform', !isOpen && '-rotate-90')} aria-hidden />{s.costCenter.code} · {s.costCenter.name}</button>{toJustify > 0 && <span className="ml-6 block text-xs text-[#C2610C]">{toJustify} categoria(s) com desvio acima de 15%</span>}</td>
                            {[s.planned, s.committed, s.realized, s.paid].map((v, i) => <td key={i} className="num px-3 py-3 text-right">{fmtBRL(v)}</td>)}
                            <td className="px-3 py-3"><ExecBar t={s} /></td>
                            <td className="num px-3 py-3 text-right text-text">{s.planned ? `${s.realized - s.planned > 0 ? '+' : ''}${(((s.realized - s.planned) / s.planned) * 100).toFixed(1).replace('.', ',')}%` : '—'}</td>
                            <td className="px-3 py-3"><BandChip band={s.band} /></td>
                          </tr>
                          {isOpen && s.categories.map((c) => (
                            <tr key={c.accountId} className="border-b border-line bg-surface-2/50 text-text">
                              <td className="py-2 pl-14 pr-3"><span className="num text-muted">{c.code}</span> {c.name}</td>
                              <td className="num px-3 py-2 text-right">{fmtBRL(c.planned)}</td><td className="px-3 py-2 text-right text-muted">—</td><td className="num px-3 py-2 text-right">{fmtBRL(c.realized)}</td><td className="px-3 py-2 text-right text-muted">—</td>
                              <td className="px-3 py-2"><ExecBar t={c} /></td>
                              <td className={clsx('num px-3 py-2 text-right', c.needsJustification && 'font-semibold text-[#C2610C]')}>{c.deviationPct === null ? '—' : `${c.deviationPct > 0 ? '+' : ''}${c.deviationPct.toFixed(1).replace('.', ',')}%`}</td>
                              <td className="px-3 py-2"><BandChip band={c.band} /></td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}</tbody>
                  </table>
                )}
              </section>
            )}

            {show('brindes') && (
              <Section title="Brindes" hint="Do planejamento no orçamento à entrega às contas">
                <dl className="mb-5 grid grid-cols-2 gap-px overflow-hidden border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
                  <Kpi label="Planejado no orçamento" value={fmtBRL(d.gifts.plannedCents)} />
                  <Kpi label="Aprovado" value={fmtBRL(d.gifts.approvedCents)} />
                  <Kpi label="Comprado" value={fmtBRL(d.gifts.purchasedCents)} />
                  <Kpi label="Em estoque hoje" value={fmtBRL(d.gifts.stockCents)} sub={d.gifts.lowStock ? `${d.gifts.lowStock} abaixo do mínimo` : undefined} tone={d.gifts.lowStock ? 'warning' : undefined} />
                  <Kpi label="Envios às contas" value={fmtBRL(d.gifts.deliveries.cents)} sub={`${d.gifts.deliveries.count} envio(s) · ${d.gifts.deliveries.accounts} conta(s)`} />
                  <Kpi label="Concessões executadas" value={fmtBRL(d.gifts.concessions.executed.cents)} sub={`${d.gifts.concessions.executed.count} · ${d.gifts.concessions.exceptions} exceção(ões)`} />
                </dl>
                <GroupView g={d.gifts.concessions} empty="Nenhuma concessão de brinde, kit ou material no período." />
              </Section>
            )}

            {show('patrocinios') && (
              <Section title="Apoios e patrocínios" hint="Solicitado, aprovado, executado e pago (Compliance)">
                <GroupView g={d.sponsorships} empty="Nenhum apoio ou patrocínio no período." />
              </Section>
            )}

            {(show('brindes') || show('patrocinios')) && (
              <Section title="Controles das concessões" hint="Indicadores do Compliance de brindes no período (só concessões executadas)">
                <dl className="grid grid-cols-2 gap-px overflow-hidden border border-line bg-line sm:grid-cols-4">
                  <Kpi label="Conformidade" value={pct(d.compliance.conformityPct)} sub="executadas sem exceção" />
                  <Kpi label="Exceções" value={pct(d.compliance.exceptionPct)} sub={`${d.compliance.exceptions} autorizada(s)`} />
                  <Kpi label="Rastreabilidade" value={pct(d.compliance.traceabilityPct)} sub="justificativa + decisão + evidência" />
                  <Kpi label="Pendências de controle" value={String(d.compliance.pendencies)} sub={`${d.compliance.withPendency} concessão(ões)`} tone={d.compliance.pendencies ? 'danger' : undefined} />
                </dl>
                <p className="mt-3 text-sm"><Link className="font-semibold text-primary hover:underline" to="/brindes?t=compliance">Abrir o Compliance de brindes</Link></p>
              </Section>
            )}

            {show('orcamento') && (
              <div className="grid gap-5 xl:grid-cols-2">
                <Section title="Recursos" hint="Contratos, licenças e equipamentos ativos">
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div><dt className="text-xs text-muted">Recorrentes por mês</dt><dd className="num text-lg font-bold text-ink">{fmtBRL(d.resources.monthlyCents)}</dd><dd className="text-xs text-muted">{d.resources.recurring} contrato(s)/licença(s){d.resources.withoutVault ? ` · ${d.resources.withoutVault} fora do Vault` : ''}</dd></div>
                    <div><dt className="text-xs text-muted">Equipamentos</dt><dd className="num text-lg font-bold text-ink">{fmtBRL(d.resources.assetsCents)}</dd><dd className="text-xs text-muted">{d.resources.assets} item(ns) ativos</dd></div>
                  </dl>
                </Section>
                <Section title="Fornecedores do período" hint="Contratado e despesas lançadas" action={<Link to="/orcamento/compras?t=fornecedores" className="text-sm font-semibold text-primary hover:underline">Fornecedores</Link>}>
                  {!d.suppliers.length ? <p className="text-sm text-muted">Nenhuma compra com fornecedor informado no período.</p> : <ul className="space-y-2.5">{d.suppliers.map((s) => <FlowBar key={s.id} label={s.name} cents={s.cents} max={d.suppliers[0]!.cents} />)}</ul>}
                </Section>
              </div>
            )}

            {d.unplanned.length > 0 && (show('orcamento') || show('brindes') || show('patrocinios')) && (
              <Section title="Concessões não planejadas" hint="Lançamentos criados a partir do Compliance, fora do planejamento">
                <ul className="divide-y divide-line text-sm">{d.unplanned.map((u) => <li key={u.id} className="flex flex-wrap justify-between gap-2 py-2"><span><b className="text-ink">{u.code}</b> <span className="text-text">{u.what}</span><span className="block text-xs text-muted">{u.centerCode} · {mLabel(u.month)} · {APPROVAL_STATE_LABELS[u.approvalState as ApprovalState] ?? u.approvalState}</span></span><span className="num font-semibold text-ink">{fmtBRL(u.amountCents)}</span></li>)}</ul>
              </Section>
            )}

            <Section title="Atividade no período" hint="Tudo o que foi registrado no orçamento e nas concessões (mais recentes primeiro)">
              {!d.activity.filter((a) => view === 'tudo' || (view === 'orcamento' ? a.area === 'orcamento' : a.area === 'concessao')).length ? <p className="text-sm text-muted">Nenhum registro no período.</p> : (
                <ol className="max-h-[420px] space-y-2 overflow-y-auto pr-1 text-sm">
                  {d.activity.filter((a) => view === 'tudo' || (view === 'orcamento' ? a.area === 'orcamento' : a.area === 'concessao')).map((a, i) => (
                    <li key={i} className="grid grid-cols-[7.5rem_1fr] gap-3">
                      <span className="text-xs text-muted">{fmtDateTime(a.at)}</span>
                      <span><span className={clsx('mr-2 inline-block px-1.5 text-2xs font-semibold', a.area === 'orcamento' ? 'bg-primary-soft text-primary' : 'bg-warning-soft text-[#9A4D06]')}>{a.area === 'orcamento' ? 'Orçamento' : 'Concessão'}{a.ref ? ` · ${a.ref}` : ''}</span><span className="text-text">{a.text}</span>{a.who && <span className="text-xs text-muted"> · {a.who}</span>}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </>
        )}
      </div>
    </BudgetShell>
  );
}
