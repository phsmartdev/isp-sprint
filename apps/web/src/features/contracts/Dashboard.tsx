import { MoneyToggle } from '../../lib/privacy';
/**
 * Painel da Gestão de Contratos: carteira estratificada, vencimentos, faturamento por tipo no período e visão executiva.
 * A ordem e as seções visíveis vêm de Configurações → Módulos e liberação → Contratos (padrão: faturamento e visão executiva no fim).
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BILLING_TYPE_HINTS, DEFAULT_DASHBOARD, type BillingType, type ContractStage, type DashboardConfig, type DashboardSection } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtBRLCompact, fmtDate, fmtInt, fmtPct } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { ErrorState, LoadingRows } from '../../components/ui/primitives';
import { DateRange } from '../../components/ui/DateRange';
import { DaysLeft, MoneyRows, TYPE_COLOR, type ContractRow } from './shared';
import { FitText } from '../../components/ui/FitText';
import { ContractLifeDrawer } from './ContractLife';
import { useState } from 'react';

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

type Ops = {
  erp: { byStatus: Record<string, number>; withoutRecord: number };
  divergence: { n: number; share: number | null };
  adjustments: { eligible: number; applied: number };
  overdueTasks: { n: number; items: { id: string; title: string; contractId: string; clientName: string; dueAt: string; ownerName: string }[] };
  pendingAccept: { n: number; returned: number };
  atRisk: { id: string; clientName: string; number: string; endAt: string | null; daysLeft: number | null; monthlyCents: number; reason: string }[];
};
type Health = 'em_dia' | 'pendencia' | 'divergente' | 'em_risco';
type Renewal = 'renovado' | 'em_renovacao' | 'sem_acao' | 'encerramento';
type ActionRow = { id: string; clientName: string; number: string; ownerName: string | null; monthlyCents: number; endAt: string | null; daysLeft: number | null; nextAction: string | null; nextActionAt: string | null; health: Health; renewal: Renewal; overdue: number; overdueTasks: number; erpStatus: string | null };
type Decision = {
  health: { key: Health; label: string; n: number; monthlyCents: number }[];
  expiringPlan: ({ month: string; n: number } & Record<Renewal, number> & Record<`${Renewal}N`, number>)[];
  pareto: { totalCents: number; clients: number; clientsFor80: number | null; items: { key: string; name: string; cents: number; share: number; cumulative: number }[] };
  byOwner: { name: string; n: number; monthlyCents: number; riskCents: number; overdueTasks: number; pendencias: number; erpPending: number }[];
  adjustmentsDue: { id: string; date: string; days: number; index: string | null; monthlyCents: number; status: 'aplicado' | 'em_andamento' | 'a_iniciar'; clientName: string; number: string }[];
  actionList: ActionRow[]; mrrTotal: number;
};
type Perf = { key: string; label: string; value: number | null; unit: 'pct' | 'dias' | 'horas' | 'brl'; num?: number; den?: number; hint: string; goodHigh: boolean };
type Dash = {
  performance: { windowDays: number; metrics: Perf[] };
  decision: Decision;
  operations: Ops; expiringCents: { d30: number; d60: number; d90: number };
  executive: Exec;
  period: { from: string; to: string; prevFrom: string; prevTo: string };
  billing: { totalCents: number; prevTotalCents: number; note: string; byType: { type: BillingType; label: string; active: number; billedCents: number; billedPrevCents: number; monthlyCents: number; balance?: { credited: number; consumed: number; available: number } }[] };
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

/** Cores de estado (saúde e renovação): verde = em dia, amarelo/laranja = atenção, vermelho = risco. Sempre com rótulo. */
const HEALTH_COLOR: Record<Health, string> = { em_dia: '#16A34A', pendencia: '#E0A400', divergente: '#EA7A0C', em_risco: '#DC2626' };
const HEALTH_SHORT: Record<Health, string> = { em_dia: 'Em dia', pendencia: 'Pendência vencida', divergente: 'Divergente do IXC', em_risco: 'Receita em risco' };
const RENEWAL_ORDER: Renewal[] = ['sem_acao', 'em_renovacao', 'renovado', 'encerramento'];
const RENEWAL_COLOR: Record<Renewal, string> = { sem_acao: '#DC2626', em_renovacao: '#2F5986', renovado: '#16A34A', encerramento: '#64748B' };
const RENEWAL_LABEL: Record<Renewal, string> = { sem_acao: 'Sem renovação iniciada', em_renovacao: 'Renovação em andamento', renovado: 'Renovação concluída', encerramento: 'Encerramento previsto' };
const ERP_ORDER: [string, string][] = [
  ['nao_iniciado', 'Não iniciado'], ['em_preenchimento', 'Em preenchimento'], ['aguardando_conferencia', 'Aguardando conferência'], ['devolvido', 'Devolvido'],
  ['aprovado', 'Aprovado'], ['aguardando_lancamento', 'Aguardando lançamento'], ['lancado', 'Lançado no IXC'], ['divergente', 'Divergente'], ['conferido_ixc', 'Conferido no IXC'],
];
const pct = (a: number, b: number) => (b ? fmtPct(a / b) : '—');
const monthShort = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '');

function Tile({ label, value, full, sub, children, accent }: { label: string; value?: React.ReactNode; full?: string; sub?: React.ReactNode; children?: React.ReactNode; accent?: string }) {
  return (
    <div className="card relative min-w-0 overflow-hidden p-4">
      {accent && <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} aria-hidden />}
      <p className="text-sm font-semibold text-muted">{label}</p>
      {value !== undefined && <FitText className="num mt-1 text-[28px] font-extrabold leading-tight text-ink" title={full}>{value}</FitText>}
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
      {children}
    </div>
  );
}

/** Desempenho da operação: indicadores de resultado do processo (sem meta definida, sem cor de julgamento). */
function Performance({ p, money }: { p: Dash['performance']; money: Money }) {
  const fmt = (m: Perf) => (m.value == null ? '—' : m.unit === 'pct' ? fmtPct(m.value) : m.unit === 'brl' ? money(m.value) : `${(Math.round(m.value * 10) / 10).toLocaleString('pt-BR')} ${m.unit === 'dias' ? 'dias' : 'h'}`);
  const main = p.metrics.filter((m) => ['renovacao_prazo', 'reajuste'].includes(m.key));
  const rest = p.metrics.filter((m) => !['renovacao_prazo', 'reajuste'].includes(m.key));
  return (
    <section className="card p-5" aria-label="Desempenho da operação de contratos">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-ink">Desempenho da operação de contratos</h3>
        <p className="text-xs text-muted">Últimos 12 meses · passe o mouse para ver como cada um é calculado</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid grid-cols-2 gap-3">{main.map((m) => (
          <div key={m.key} className="min-w-0 rounded-md border border-line p-4" title={m.hint}>
            <p className="text-sm font-semibold text-muted">{m.label}</p>
            <p className="num mt-1 text-3xl font-extrabold text-ink">{fmt(m)}</p>
            {m.den != null && <p className="num text-xs text-muted">{m.den ? `${m.num} de ${m.den}` : 'sem base na janela'}</p>}
            {m.value != null && m.unit === 'pct' && <span className="mt-2 block h-1.5 rounded-full bg-surface-2" aria-hidden><span className="block h-1.5 rounded-full bg-[#2F5986]" style={{ width: `${Math.min(100, m.value * 100)}%` }} /></span>}
            <p className="mt-2 text-[11px] leading-snug text-muted">{m.hint}</p>
          </div>
        ))}</div>
        <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-3">{rest.map((m) => (
          <div key={m.key} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line py-2" title={m.hint}>
            <dt className="min-w-0 text-sm text-text">{m.label}{m.den != null && m.den > 0 && <span className="num block text-[11px] text-muted">{m.num} de {m.den}</span>}</dt>
            <dd className="num shrink-0 text-lg font-extrabold text-ink">{fmt(m)}</dd>
          </div>
        ))}</dl>
      </div>
    </section>
  );
}

function Headline({ d, money }: { d: Dash; money: Money }) {
  const mrr = d.monthlyCents || 1;
  return (
    <section aria-label="Indicadores principais" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Tile label="Contratos ativos" value={fmtInt(d.active)} sub={`${d.pendingValidation} aguardando validação · ${d.archived} arquivados`} accent="#2F5986" />
      <Tile label="MRR contratos" value={money(d.monthlyCents)} full={fmtBRL(d.monthlyCents)} sub={`ticket médio ${money(d.portfolio.avgTicketCents)} · carteira 12 meses ${money(d.executive.contractedAnnualCents)}`} accent="#16A34A" />
      <div className="sm:col-span-2 xl:col-span-2"><Tile label="Vencendo (clique para ver a lista)" accent="#E0A400">
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([30, 60, 90] as const).map((n) => (
            <Link key={n} to={`/contracts?t=lista&exp=${n}`} className="group min-w-0 rounded-md border border-line p-2 hover:border-primary" aria-label={`${d.expiring[`d${n}`]} contratos vencendo em até ${n} dias: ver lista`}>
              <p className="text-[11px] font-semibold text-muted">até {n} dias</p>
              <p className="num text-xl font-extrabold text-ink">{d.expiring[`d${n}`]}</p>
              <p className="num truncate text-[11px] text-muted" title={`${fmtBRL(d.expiringCents[`d${n}`])}/mês`}>{money(d.expiringCents[`d${n}`])}/mês</p>
              <span className="mt-1 block h-1 rounded-full bg-surface-2"><span className="block h-1 rounded-full bg-[#E0A400]" style={{ width: `${Math.min(100, (d.expiringCents[`d${n}`] / mrr) * 100)}%` }} /></span>
            </Link>
          ))}
        </div>
      </Tile></div>
      <Tile label="Receita em risco" value={<>{money(d.atRisk.monthlyCents)}<span className="text-sm font-semibold text-muted">/mês</span></>} full={fmtBRL(d.atRisk.monthlyCents)} accent="#DC2626"
        sub={<>{d.atRisk.n} contrato(s) · <strong className="text-danger">{pct(d.atRisk.monthlyCents, d.monthlyCents)}</strong> do MRR</>}>
        <span className="mt-2 block h-1.5 rounded-full bg-surface-2" aria-hidden><span className="block h-1.5 rounded-full bg-danger" style={{ width: `${Math.min(100, (d.atRisk.monthlyCents / mrr) * 100)}%` }} /></span>
        <p className="mt-1 text-[11px] text-muted">vence em até 90 dias sem renovação concluída, ou encerramento previsto</p>
      </Tile>
    </section>
  );
}

/** Saúde: a receita mensal repartida pela situação que mais pede atenção em cada contrato. */
function HealthSection({ d, money, filter, setFilter }: { d: Dash; money: Money; filter: Health | null; setFilter: (h: Health | null) => void }) {
  const h = d.decision.health;
  const total = h.reduce((a, x) => a + x.monthlyCents, 0) || 1;
  const o = d.operations;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <section className="card p-5 xl:col-span-2" aria-label="Saúde da carteira">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold text-ink">Saúde da carteira</h3>
          <p className="text-xs text-muted">Receita mensal por situação · clique para filtrar os contratos abaixo</p>
        </div>
        <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={h.map((x) => `${x.label}: ${pct(x.monthlyCents, total)}`).join('; ')}>
          {h.map((x) => x.monthlyCents > 0 && (
            <button key={x.key} type="button" title={`${x.label}: ${fmtBRL(x.monthlyCents)}/mês · ${x.n} contrato(s)`} onClick={() => setFilter(filter === x.key ? null : x.key)}
              className={clsx('h-full transition-opacity first:rounded-l last:rounded-r', filter && filter !== x.key && 'opacity-30')} style={{ width: `${(x.monthlyCents / total) * 100}%`, background: HEALTH_COLOR[x.key], minWidth: 6 }} aria-label={`Filtrar: ${x.label}`} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {h.map((x) => (
            <button key={x.key} type="button" onClick={() => setFilter(filter === x.key ? null : x.key)} aria-pressed={filter === x.key}
              className={clsx('min-w-0 rounded-md border p-3 text-left transition', filter === x.key ? 'border-primary bg-primary-soft/40' : 'border-line hover:border-line-strong')}>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-text"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: HEALTH_COLOR[x.key] }} aria-hidden />{HEALTH_SHORT[x.key]}</span>
              <span className="num mt-1 block text-lg font-extrabold text-ink" title={fmtBRL(x.monthlyCents)}>{money(x.monthlyCents)}</span>
              <span className="num text-xs text-muted">{x.n} contrato(s) · {pct(x.monthlyCents, total)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="card p-5" aria-label="Indicadores operacionais">
        <h3 className="mb-3 font-bold text-ink">Indicadores operacionais</h3>
        <dl className="space-y-3">
          {[
            ['Contratos com divergência', o.divergence.share == null ? '—' : fmtPct(o.divergence.share), `${o.divergence.n} com Cadastro ERP divergente do IXC`, o.divergence.n > 0],
            ['Reajustes elegíveis efetivados', pct(o.adjustments.applied, o.adjustments.eligible), `${o.adjustments.applied} de ${o.adjustments.eligible} com data-base nos últimos 12 meses`, o.adjustments.eligible > o.adjustments.applied],
            ['Pendências com prazo vencido', fmtInt(o.overdueTasks.n), 'tarefas ligadas a contratos', o.overdueTasks.n > 0],
            ['Transferências sem aceite', fmtInt(o.pendingAccept.n), `${o.pendingAccept.returned} devolvida(s) aguardando tratamento`, o.pendingAccept.n > 0],
          ].map(([l, v, hint, warn]) => (
            <div key={l as string} className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-0">
              <div className="min-w-0"><dt className="text-sm text-text">{l}</dt><dd className="text-xs text-muted">{hint}</dd></div>
              <span className={clsx('num shrink-0 text-xl font-extrabold', warn ? 'text-danger' : 'text-ink')}>{v}</span>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function ActionList({ rows, filter, setFilter, money, onOpen }: { rows: ActionRow[]; filter: Health | null; setFilter: (h: Health | null) => void; money: Money; onOpen: (id: string) => void }) {
  const list = filter ? rows.filter((r) => r.health === filter) : rows;
  return (
    <section className="card p-5" aria-label="Contratos que pedem ação">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-bold text-ink">Contratos que pedem ação</h3><p className="text-xs text-muted">Risco primeiro, depois maior receita. Clique para ver a vida do contrato.</p></div>
        {filter && <button type="button" className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary" onClick={() => setFilter(null)}>{HEALTH_SHORT[filter]} ✕</button>}
      </div>
      {!list.length ? <p className="py-6 text-center text-sm text-muted">{filter ? 'Nenhum contrato nesta situação.' : 'Nenhum contrato pedindo ação. Carteira em dia.'}</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-2 pr-3 font-medium">Cliente · contrato</th><th className="py-2 pr-3 font-medium">Situação</th><th className="py-2 pr-3 font-medium">Renovação</th><th className="py-2 pr-3 text-right font-medium">MRR</th><th className="py-2 pr-3 font-medium">Vence</th><th className="py-2 pr-3 font-medium">Responsável</th><th className="py-2 font-medium">Próxima ação</th></tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id} tabIndex={0} className="cursor-pointer border-t border-line hover:bg-surface-2/60 focus:bg-surface-2/60 focus:outline-none" onClick={() => onOpen(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.id); }}>
              <td className="py-2.5 pr-3"><span className="block font-semibold text-ink">{r.clientName}</span><span className="text-xs text-muted">{r.number}</span></td>
              <td className="py-2.5 pr-3"><span className="inline-flex items-center gap-1.5 text-xs font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: HEALTH_COLOR[r.health] }} aria-hidden />{HEALTH_SHORT[r.health]}</span>
                {(r.overdue > 0 || r.overdueTasks > 0) && <span className="block text-[11px] text-muted">{r.overdue + r.overdueTasks} prazo(s) vencido(s)</span>}</td>
              <td className="py-2.5 pr-3 text-xs">{r.daysLeft != null && r.daysLeft <= 120 ? <span style={{ color: r.renewal === 'sem_acao' ? '#B91C1C' : undefined }}>{RENEWAL_LABEL[r.renewal]}</span> : <span className="text-muted">—</span>}</td>
              <td className="num py-2.5 pr-3 text-right font-semibold" title={fmtBRL(r.monthlyCents)}>{money(r.monthlyCents)}</td>
              <td className="py-2.5 pr-3"><span className="block text-xs text-muted">{fmtDate(r.endAt)}</span><DaysLeft days={r.daysLeft} /></td>
              <td className="py-2.5 pr-3 text-xs">{r.ownerName ?? '—'}</td>
              <td className="py-2.5 text-xs">{r.nextAction ?? <span className="text-muted">não definida</span>}{r.nextActionAt && <span className="block text-muted">{fmtDate(r.nextActionAt)}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

/** Receita que vence por mês, empilhada pela situação da renovação: mostra onde agir antes de perder receita. */
function ExpiringChart({ plan, money }: { plan: Decision['expiringPlan']; money: Money }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = plan.map((m) => RENEWAL_ORDER.reduce((a, k) => a + m[k], 0));
  const max = Math.max(1, ...totals);
  const sixNoAction = plan.slice(0, 6).reduce((a, m) => a + m.sem_acao, 0);
  const sel = hover ?? totals.findIndex((t) => t > 0);
  const m = sel >= 0 ? plan[sel] : null;
  return (
    <section className="card p-5" aria-label="Receita que vence nos próximos 12 meses">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-bold text-ink">Receita que vence nos próximos 12 meses</h3>
          <p className="text-xs text-muted">Receita mensal dos contratos que terminam em cada mês, pela situação da renovação.</p></div>
        <div className="flex flex-wrap gap-3 text-xs text-text">{RENEWAL_ORDER.map((k) => <span key={k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: RENEWAL_COLOR[k] }} aria-hidden />{RENEWAL_LABEL[k]}</span>)}</div>
      </div>
      {sixNoAction > 0 && <p className="mb-2 text-sm"><strong className="text-danger" title={fmtBRL(sixNoAction)}>{money(sixNoAction)}/mês</strong> vencem nos próximos 6 meses sem renovação iniciada.</p>}
      <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: 180 }} onMouseLeave={() => setHover(null)}>
        {plan.map((mm, i) => (
          <button key={mm.month} type="button" className={clsx('flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary', sel === i && 'bg-surface-2')}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} aria-label={`${monthShort(mm.month)}: ${fmtBRL(totals[i]!)}/mês em ${mm.n} contrato(s)`}>
            <span className="num mb-1 block text-center text-[11px] font-semibold text-ink">{mm.n || ''}</span>
            <span className="flex w-full flex-col-reverse gap-[2px]" style={{ height: `${(totals[i]! / max) * 140}px` }}>
              {RENEWAL_ORDER.map((k) => mm[k] > 0 && <span key={k} className="block w-full first:rounded-b-none last:rounded-t" style={{ height: `${(mm[k] / Math.max(1, totals[i]!)) * 100}%`, background: RENEWAL_COLOR[k], minHeight: 3 }} />)}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 border-t border-line pt-1 sm:gap-2">{plan.map((mm) => <span key={mm.month} className="min-w-0 flex-1 truncate text-center text-[11px] capitalize text-muted">{monthShort(mm.month)}</span>)}</div>
      <div className="mt-3 min-h-[44px] rounded-md bg-surface-2 px-3 py-2 text-sm" aria-live="polite">
        {!m || !totals[sel] ? <span className="text-muted">Nenhum vencimento nos próximos 12 meses.</span> : (
          <><span className="font-semibold capitalize text-ink">{monthShort(m.month)}</span> · <span className="num">{fmtBRL(totals[sel]!)}/mês</span> em {m.n} contrato(s):{' '}
            {RENEWAL_ORDER.filter((k) => m[k] > 0).map((k, j) => <span key={k}>{j ? ' · ' : ''}<span style={{ color: RENEWAL_COLOR[k] }}>●</span> {RENEWAL_LABEL[k].toLowerCase()} {m[`${k}N`]} ({money(m[k])})</span>)}</>
        )}
      </div>
    </section>
  );
}

const ADJ_LABEL = { a_iniciar: 'A iniciar', em_andamento: 'Em andamento', aplicado: 'Aplicado' } as const;
function Adjustments({ list, money, onOpen }: { list: Decision['adjustmentsDue']; money: Money; onOpen: (id: string) => void }) {
  const base = list.filter((a) => a.status !== 'aplicado').reduce((s, a) => s + a.monthlyCents, 0);
  return (
    <section className="card p-5" aria-label="Reajustes dos próximos 90 dias">
      <h3 className="font-bold text-ink">Reajustes dos próximos 90 dias</h3>
      <p className="mb-2 text-xs text-muted">{list.length ? <>Base de <strong className="text-ink">{money(base)}/mês</strong> ainda a reajustar. Prepare o cálculo antes da data-base.</> : 'Aniversários da data-base nos próximos 90 dias.'}</p>
      {!list.length ? <p className="py-4 text-sm text-muted">Nenhum reajuste na janela.</p> : (
        <ul className="divide-y divide-line">{list.slice(0, 10).map((a) => (
          <li key={a.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-1 py-2 text-left hover:bg-surface-2" onClick={() => onOpen(a.id)}>
            <span className="min-w-0"><span className="block truncate font-semibold text-ink">{a.clientName}</span><span className="text-xs text-muted">{a.number} · {a.index ?? 'índice não informado'} · {fmtDate(a.date)}</span></span>
            <span className="flex items-center gap-3"><span className="num text-sm" title={fmtBRL(a.monthlyCents)}>{money(a.monthlyCents)}</span>
              <span className={clsx('w-24 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold', a.status === 'a_iniciar' ? (a.days <= 30 ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-[#C2610C]') : a.status === 'em_andamento' ? 'bg-primary-soft text-primary' : 'bg-success-soft text-success')}>{ADJ_LABEL[a.status]} · {a.days}d</span></span>
          </button></li>
        ))}</ul>
      )}
    </section>
  );
}

function Owners({ list, money }: { list: Decision['byOwner']; money: Money }) {
  const max = Math.max(1, ...list.map((o) => o.monthlyCents));
  return (
    <section className="card p-5" aria-label="Carteira por responsável">
      <h3 className="font-bold text-ink">Carteira por responsável</h3>
      <p className="mb-2 text-xs text-muted">Quanto cada um carrega e onde está o risco.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-xs text-muted"><tr><th className="py-1.5 pr-2 font-medium">Responsável</th><th className="py-1.5 pr-2 font-medium">MRR (em risco)</th><th className="py-1.5 pr-2 text-right font-medium">Contratos</th><th className="py-1.5 pr-2 text-right font-medium">Pedem ação</th><th className="py-1.5 pr-2 text-right font-medium">Tarefas vencidas</th><th className="py-1.5 text-right font-medium">ERP a concluir</th></tr></thead>
        <tbody>{list.map((o) => (
          <tr key={o.name} className="border-t border-line">
            <td className="py-2 pr-2 font-semibold text-ink">{o.name}</td>
            <td className="py-2 pr-2">
              <span className="num text-xs" title={`${fmtBRL(o.monthlyCents)} · em risco ${fmtBRL(o.riskCents)}`}>{money(o.monthlyCents)}{o.riskCents > 0 && <span className="text-danger"> ({money(o.riskCents)})</span>}</span>
              <span className="mt-1 flex h-1.5 w-full max-w-[180px] gap-[2px]" aria-hidden><span className="h-full rounded-l bg-[#2F5986]" style={{ width: `${((o.monthlyCents - o.riskCents) / max) * 100}%` }} />{o.riskCents > 0 && <span className="h-full rounded-r bg-danger" style={{ width: `${(o.riskCents / max) * 100}%` }} />}</span>
            </td>
            <td className="num py-2 pr-2 text-right">{o.n}</td>
            <td className={clsx('num py-2 pr-2 text-right', o.pendencias && 'font-semibold text-danger')}>{o.pendencias}</td>
            <td className={clsx('num py-2 pr-2 text-right', o.overdueTasks && 'font-semibold text-danger')}>{o.overdueTasks}</td>
            <td className="num py-2 text-right">{o.erpPending}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function Concentration({ d, money }: { d: Dash; money: Money }) {
  const p = d.decision.pareto;
  const max = Math.max(0.0001, ...p.items.map((x) => x.share));
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <section className="card p-5 xl:col-span-2" aria-label="Concentração por cliente">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div><h3 className="font-bold text-ink">Concentração por cliente</h3><p className="text-xs text-muted">Participação de cada cliente no MRR e o acumulado.</p></div>
          {p.clientsFor80 != null && <p className="text-sm"><strong className="text-ink">{p.clientsFor80}</strong> de {p.clients} clientes fazem 80% da receita</p>}
        </div>
        {!p.items.length ? <p className="text-sm text-muted">Sem receita contratada.</p> : (
          <ul className="space-y-2">{p.items.map((x) => (
            <li key={x.key} className="grid grid-cols-[minmax(0,160px)_1fr_auto] items-center gap-3 text-sm">
              <Link to={`/customers/${x.key}`} className="link truncate" title={x.name}>{x.name}</Link>
              <span className="h-3 rounded-r bg-surface-2" aria-hidden><span className="block h-3 rounded-r bg-[#2F5986]" style={{ width: `${(x.share / max) * 100}%` }} /></span>
              <span className="num whitespace-nowrap text-right text-xs"><strong className="text-ink">{fmtPct(x.share)}</strong> <span className="text-muted">· {money(x.cents)} · acum. {fmtPct(x.cumulative)}</span></span>
            </li>
          ))}</ul>
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
  );
}

function ErpPipeline({ o }: { o: Ops }) {
  const total = ERP_ORDER.reduce((a, [k]) => a + (o.erp.byStatus[k] ?? 0), 0);
  return (
    <section className="card p-5" aria-label="Cadastro ERP por situação">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-ink">Cadastro ERP por situação</h3>
        <p className="text-xs text-muted">{total} cadastro(s) · {o.erp.withoutRecord} contrato(s) ativo(s) sem cadastro</p>
      </div>
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
        {ERP_ORDER.map(([k, l]) => {
          const n = o.erp.byStatus[k] ?? 0;
          const tone = k === 'divergente' ? 'border-danger text-danger' : k === 'conferido_ixc' ? 'border-success text-success' : ['aguardando_conferencia', 'devolvido', 'aguardando_lancamento'].includes(k) ? 'border-[#E0A400] text-[#C2610C]' : 'border-line text-ink';
          return <li key={k} className={clsx('min-w-0 rounded-md border-t-4 bg-surface-2/60 p-2', n ? tone : 'border-line text-muted')}><span className="num block text-xl font-extrabold">{n}</span><span className="block text-[11px] leading-tight text-text">{l}</span></li>;
        })}
      </ol>
    </section>
  );
}

export function ContractsDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useUrlState({ from: `${today.slice(0, 7)}-01`, to: today });
  const q = useQuery({ queryKey: ['contracts', 'dashboard', f.from, f.to], queryFn: () => api<Dash>(`/contracts/dashboard${qs({ from: f.from, to: f.to })}`) });
  const [health, setHealth] = useState<Health | null>(null);
  const [life, setLife] = useState<string | null>(null);
  const view = useQuery({ queryKey: ['contracts', 'view'], queryFn: () => api<{ dashboard: DashboardConfig }>('/contracts/view'), staleTime: 60_000 });
  if (q.isLoading || view.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const cfg = view.data?.dashboard ?? DEFAULT_DASHBOARD;
  // valores dos cartões na medida do tamanho (mil, mi, bi); o valor inteiro fica no title
  const money: Money = cfg.compactValues ? fmtBRLCompact : fmtBRL;
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
    indicadores: () => <Headline d={d} money={money} />,
    desempenho: () => <Performance p={d.performance} money={money} />,
    saude: () => <HealthSection d={d} money={money} filter={health} setFilter={setHealth} />,
    acao: () => <ActionList rows={d.decision.actionList} filter={health} setFilter={setHealth} money={money} onOpen={setLife} />,
    vencimentos: () => <ExpiringChart plan={d.decision.expiringPlan} money={money} />,
    reajustes: () => <Adjustments list={d.decision.adjustmentsDue} money={money} onOpen={setLife} />,
    responsaveis: () => <Owners list={d.decision.byOwner} money={money} />,
    operacao: () => <ErpPipeline o={d.operations} />,
    clientes: () => <Concentration d={d} money={money} />,
    etapas: () => (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="card p-5">
          <h3 className="mb-3 font-bold text-ink">Contratos por etapa</h3>
          <MoneyRows items={d.byStage.map((s) => ({ key: s.stage, label: s.label, n: s.n, monthlyCents: s.monthlyCents }))} colorOf={(k) => STAGE_COLOR[k as ContractStage]} />
        </section>
        <section className="card p-5">
          <h3 className="mb-1 font-bold text-ink">Próximos vencimentos</h3>
          {!d.nextExpiring.length ? <p className="py-4 text-sm text-muted">Nenhum nos próximos 120 dias.</p> : (
            <ul className="divide-y divide-line">{d.nextExpiring.map((r) => <li key={r.id}><button type="button" onClick={() => setLife(r.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-1 py-2.5 text-left hover:bg-surface-2"><span className="min-w-0"><span className="block truncate font-semibold text-ink">{r.clientName}</span><span className="text-xs text-muted">{r.number} · vence {fmtDate(r.endAt)}</span></span><span className="flex items-center gap-3"><span className="num text-sm font-semibold">{fmtBRL(r.monthlyCents)}</span><DaysLeft days={r.daysLeft} /></span></button></li>)}</ul>
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
      <ContractLifeDrawer id={life} onClose={() => setLife(null)} />
    </div>
  );
}
