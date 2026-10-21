/** Sucesso do Cliente: Minha Carteira, Contas que precisam de atenção, Cobertura, Gestão (capacidade e scorecards) e Jornadas. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, HeartHandshake } from 'lucide-react';
import { CS_LEVELS, CS_LEVEL_LABELS, TIER_LABELS, type CsLevel, type Tier } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtPct } from '../../lib/format';
import { useLookups, useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Tabs } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';
import { MoneyToggle } from '../../lib/privacy';
import { FollowUpDialog, PlanDialog, VisitDialog } from '../../features/cs/Account360';
import { HealthBadge, LevelChip, TierChip, covText, type Coverage } from '../../features/cs/shared';
import { FitText } from '../../components/ui/FitText';

type Acc = {
  contactId: string; name: string; csmId: string | null; csmName: string | null; tier: Tier | null; acvCents: number; ipc: number | null; ipcPending: number; classKey: string | null;
  health: number | null; healthLabel: string; criticality: CsLevel; effective: { level: CsLevel; source: 'calculada' | 'manual' }; lastContactAt: string | null; nextContactAt: string | null;
  daysToEnd: number | null; overdueDays: number; satisfaction: number | null; reason: string; alerts: { key: string; level: string; text: string }[]; coverage: Coverage; expansion: { openCount: number; openValueCents: number };
};
type Portfolio = {
  period: { from: string; to: string }; accounts: Acc[]; coverage: Coverage;
  totals: { accounts: number; acvCents: number; byTier: Record<string, number>; byLevel: Record<string, number>; byClass: Record<string, number>; byIpc: Record<string, number>; withoutContact: number; alerts: number; atRisk: number; renewals90: number; openExpansion: number };
  criticalLate: { count: number; ofCritical: number; share: number | null; accounts: { contactId: string; name: string; csmName: string | null; overdueDays: number; lastContactAt: string | null; nextContactAt: string | null; reason: string }[] };
  priorities: { id: string; title: string; dueAt: string | null; contactId: string | null; kind: string | null; plannedAt: string | null; account: string; level: CsLevel; why: string; late: boolean }[];
  canManage: boolean;
};
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
const Kpi = ({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'danger' }) => <li className="card p-4"><p className="text-sm text-muted">{label}</p><FitText className={clsx('num mt-1 text-xl font-bold', tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</FitText>{hint && <p className="text-xs text-muted">{hint}</p>}</li>;
const Dist = ({ title, data, label }: { title: string; data: Record<string, number>; label?: (k: string) => string }) => (
  <div className="card p-4"><p className="mb-2 text-sm font-semibold text-ink">{title}</p><ul className="space-y-1 text-sm">{Object.entries(data).sort().map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span>{label ? label(k) : k === 'sem' ? 'Não definido' : k}</span><span className="num font-semibold">{v}</span></li>)}</ul></div>
);

function Carteira({ p, onAct }: { p: Portfolio; onAct: (a: { kind: 'followup' | 'visit' | 'plan'; contactId: string; activity?: Portfolio['priorities'][number] }) => void }) {
  const t = p.totals;
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Contas" value={t.accounts} />
        <Kpi label="ACV administrado" value={fmtBRL(t.acvCents)} />
        <Kpi label="Cobertura simples" value={covText(p.coverage)} hint={`${p.coverage.onTime}/${p.coverage.planned} no prazo${p.coverage.extra ? ` · +${p.coverage.extra} extras` : ''}`} />
        <Kpi label="Cobertura ponderada" value={covText(p.coverage, 'weighted')} hint="peso pela criticidade" />
        <Kpi label="Críticas sem acompanhamento" value={`${p.criticalLate.count}/${p.criticalLate.ofCritical}`} tone={p.criticalLate.count ? 'danger' : undefined} />
        <Kpi label="Contas sem contato" value={t.withoutContact} tone={t.withoutContact ? 'danger' : undefined} />
        <Kpi label="Em risco (saúde < 50)" value={t.atRisk} />
        <Kpi label="Alertas abertos" value={t.alerts} />
        <Kpi label="Renovações em 90 dias" value={t.renewals90} />
        <Kpi label="Expansão em aberto" value={fmtBRL(t.openExpansion)} hint="por mês" />
      </ul>
      <section className="card p-5" aria-labelledby="pr-title">
        <h2 id="pr-title" className="mb-1 text-lg font-bold text-ink">Minhas prioridades de hoje</h2>
        <p className="mb-3 text-sm text-muted">Acompanhamentos de hoje e atrasados, ordenados por criticidade da conta e atraso.</p>
        {!p.priorities.length ? <p className="text-sm text-muted">Nada pendente para hoje.</p> : (
          <ul className="divide-y divide-line">{p.priorities.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <LevelChip level={x.level} />
              <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink">{x.title}</p><p className="truncate text-xs text-muted">{x.late ? <span className="font-semibold text-danger">Atrasado desde {fmtDate(x.plannedAt)} · </span> : ''}{x.why}</p></div>
              <button className="text-sm font-semibold text-primary hover:underline" onClick={() => onAct({ kind: 'followup', contactId: x.contactId!, activity: x })}>Registrar</button>
              {x.contactId && <Link className="text-sm text-muted hover:underline" to={`/customers/${x.contactId}?t=sucesso`}>Conta</Link>}
            </li>
          ))}</ul>
        )}
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Dist title="Por Tier" data={t.byTier} label={(k) => (k === 'sem' ? 'Sem Tier' : TIER_LABELS[k as Tier] ?? k)} />
        <Dist title="Por criticidade (efetiva)" data={t.byLevel} label={(k) => CS_LEVEL_LABELS[k as CsLevel] ?? k} />
        <Dist title="Por Score IPC" data={t.byIpc} label={(k) => (k === 'sem' ? 'Incompleto' : k)} />
        <Dist title="Por classe estratégica" data={t.byClass} label={(k) => (k === 'sem' ? 'Não classificada' : k)} />
      </div>
    </div>
  );
}

function Atencao({ p, onAct }: { p: Portfolio; onAct: (a: { kind: 'followup' | 'visit' | 'plan'; contactId: string }) => void }) {
  const nav = useNavigate();
  if (!p.accounts.length) return <div className="card"><EmptyState title="Nenhuma conta na carteira" description="As contas entram com contrato validado ou jornada iniciada." /></div>;
  return (
    <div className="space-y-4">
      {p.criticalLate.count > 0 && (
        <section className="card border-danger/40 p-5" aria-labelledby="cl-title">
          <h2 id="cl-title" className="mb-2 flex items-center gap-2 text-lg font-bold text-danger"><AlertTriangle className="h-5 w-5" aria-hidden />Contas críticas sem acompanhamento no prazo: {p.criticalLate.count} de {p.criticalLate.ofCritical} ({fmtPct(p.criticalLate.share)})</h2>
          <ul className="divide-y divide-line text-sm">{p.criticalLate.accounts.map((a) => <li key={a.contactId} className="flex flex-wrap items-center gap-3 py-2"><Link className="font-semibold text-ink hover:underline" to={`/customers/${a.contactId}?t=sucesso`}>{a.name}</Link><span className="text-muted">{a.csmName ?? 'sem CSM'} · {a.overdueDays ? `${a.overdueDays} dia(s) de atraso` : 'sem contato no prazo'} · último contato {a.lastContactAt ? fmtDate(a.lastContactAt) : 'nenhum'} · próximo {a.nextContactAt ? fmtDate(a.nextContactAt) : '—'}</span><button className="ml-auto font-semibold text-primary hover:underline" onClick={() => onAct({ kind: 'followup', contactId: a.contactId })}>Registrar contato</button></li>)}</ul>
        </section>
      )}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Conta', 'Prioridade', 'Motivo', 'Tier', 'IPC', 'Classe', 'Saúde', 'Último contato', 'Vencimento', 'Ações'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{p.accounts.map((a) => (
              <tr key={a.contactId} className="border-t border-line align-top">
                <td className="px-3 py-3"><button className="text-left font-semibold text-ink hover:underline" onClick={() => nav(`/customers/${a.contactId}?t=sucesso`)}>{a.name}</button><span className="block text-xs text-muted">{a.csmName ?? 'sem CSM'}</span></td>
                <td className="px-3 py-3"><LevelChip level={a.effective.level} manual={a.effective.source === 'manual'} />{a.effective.source === 'manual' && <span className="mt-1 block text-xs text-muted">calculada: {CS_LEVEL_LABELS[a.criticality]}</span>}</td>
                <td className="max-w-[300px] px-3 py-3 text-xs">{a.reason}{a.alerts.length > 0 && <span className="mt-1 block font-semibold text-danger">{a.alerts.length} alerta(s): {a.alerts.slice(0, 2).map((x) => x.text).join(' ')}</span>}</td>
                <td className="px-3 py-3"><TierChip tier={a.tier} /></td>
                <td className="num px-3 py-3">{a.ipc ?? <span className="text-xs text-muted">incompleto</span>}</td>
                <td className="px-3 py-3">{a.classKey ?? '—'}</td>
                <td className="px-3 py-3"><HealthBadge score={a.health} /></td>
                <td className="num px-3 py-3">{a.lastContactAt ? fmtDate(a.lastContactAt) : <span className="text-danger">nenhum</span>}{a.overdueDays > 0 && <span className="block text-xs text-danger">{a.overdueDays} dia(s) de atraso</span>}</td>
                <td className="num px-3 py-3">{a.daysToEnd === null ? '—' : a.daysToEnd < 0 ? <span className="text-danger">vencido</span> : `${a.daysToEnd} dias`}</td>
                <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold">
                  <button className="mr-3 text-primary hover:underline" onClick={() => onAct({ kind: 'followup', contactId: a.contactId })}>Contato</button>
                  <button className="mr-3 text-primary hover:underline" onClick={() => onAct({ kind: 'visit', contactId: a.contactId })}>Visita</button>
                  <button className="mr-3 text-primary hover:underline" onClick={() => onAct({ kind: 'plan', contactId: a.contactId })}>Plano</button>
                  <Link className="text-muted hover:underline" to={`/customers/${a.contactId}?t=sucesso`}>360°</Link>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Cobertura({ csmId }: { csmId: string }) {
  const [f, setF] = useState({ groupBy: 'csm', from: new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  const q = useQuery({ queryKey: ['cs-coverage', f, csmId], placeholderData: keepPreviousData, queryFn: () => api<{ overall: Coverage; groups: ({ key: string } & Coverage)[]; withoutFollowUp: { contactId: string; name: string; csmName: string | null; level: CsLevel }[]; weights: Record<CsLevel, number>; tolerance: number }>(`/cs/coverage${qs({ ...f, csmId: csmId || undefined })}`) });
  const G: Record<string, string> = { csm: 'CSM', equipe: 'Equipe', tier: 'Tier', classe: 'Classe estratégica', criticidade: 'Criticidade', conta: 'Conta', mes: 'Mês' };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Agrupar por" htmlFor="cv-g"><Select id="cv-g" value={f.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })}>{Object.entries(G).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
        <FormField label="De" htmlFor="cv-from"><Input id="cv-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></FormField>
        <FormField label="Até" htmlFor="cv-to"><Input id="cv-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></FormField>
      </div>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (<>
        <p className="text-sm text-muted">Cobertura = acompanhamentos realizados <strong>com resultado registrado</strong> até a data prevista (+{q.data!.tolerance} dia(s)) ÷ previstos. Reagendar não conta como execução; ações além da cadência aparecem como extras e não passam de 100%. Ponderada: pesos {CS_LEVELS.map((l) => `${CS_LEVEL_LABELS[l]} ${q.data!.weights[l]}`).join(', ')} (o peso da época fica gravado).</p>
        <div className="card overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{[G[f.groupBy], 'Previstos', 'No prazo', 'Extras', 'Cobertura simples', 'Cobertura ponderada'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {q.data!.groups.map((g) => <tr key={g.key} className="border-t border-line"><td className="px-3 py-2.5 font-semibold text-ink">{f.groupBy === 'criticidade' ? CS_LEVEL_LABELS[g.key as CsLevel] ?? g.key : g.key}</td><td className="num px-3 py-2.5">{g.planned}</td><td className="num px-3 py-2.5">{g.onTime}</td><td className="num px-3 py-2.5">{g.extra}</td><td className="num px-3 py-2.5">{covText(g)}</td><td className="num px-3 py-2.5 font-semibold">{covText(g, 'weighted')}</td></tr>)}
              <tr className="border-t-2 border-line font-semibold"><td className="px-3 py-2.5">Total</td><td className="num px-3 py-2.5">{q.data!.overall.planned}</td><td className="num px-3 py-2.5">{q.data!.overall.onTime}</td><td className="num px-3 py-2.5">{q.data!.overall.extra}</td><td className="num px-3 py-2.5">{covText(q.data!.overall)}</td><td className="num px-3 py-2.5">{covText(q.data!.overall, 'weighted')}</td></tr>
            </tbody>
          </table>
        </div></div>
        {!!q.data!.withoutFollowUp.length && <section className="card p-5"><h3 className="mb-2 font-bold text-ink">Contas sem acompanhamento realizado no período ({q.data!.withoutFollowUp.length})</h3><ul className="grid grid-cols-1 gap-1 text-sm md:grid-cols-2">{q.data!.withoutFollowUp.map((a) => <li key={a.contactId} className="flex items-center gap-2"><LevelChip level={a.level} /><Link className="text-primary hover:underline" to={`/customers/${a.contactId}?t=sucesso`}>{a.name}</Link><span className="text-muted">· {a.csmName ?? 'sem CSM'}</span></li>)}</ul></section>}
      </>)}
    </div>
  );
}

type TeamRow = {
  csmId: string | null; name: string; accounts: number; acvCents: number; byLevel: Record<CsLevel, number>; coverage: Coverage; criticalCoverage: Coverage; visits: { planned: number; done: number; late: number }; contacts: number; withoutContact: number;
  satisfaction: number | null; renewals: number; newBusiness: number; additionalCents: number; openExpansionCents: number; capacity: { demandHours: number; capacityHours: number; load: number | null };
  scorecard: { operacional: number | null; comercial: number | null; qualidade: number | null; risco: number | null; total: number | null; weights: Record<string, number> }; gamification: { points: number; rule: string };
};
function Gestao() {
  const [f, setF] = useState({ from: monthStart(), to: new Date().toISOString().slice(0, 10) });
  const q = useQuery({ queryKey: ['cs-team', f], placeholderData: keepPreviousData, queryFn: () => api<{ csms: TeamRow[]; note: string }>(`/cs/team${qs(f)}`) });
  const pct = (v: number | null) => (v === null ? '—' : fmtPct(v));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="De" htmlFor="tm-from"><Input id="tm-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></FormField>
        <FormField label="Até" htmlFor="tm-to"><Input id="tm-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></FormField>
      </div>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (<>
        <section className="card overflow-hidden" aria-labelledby="cap-title">
          <h2 id="cap-title" className="px-5 pt-4 text-lg font-bold text-ink">Carteiras e capacidade</h2>
          <p className="px-5 pb-3 text-sm text-muted">{q.data!.note}</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['CSM', 'Contas', 'ACV', 'Críticas/altas', 'Carga mensal', 'Cobertura', 'Ponderada', 'Críticas no prazo', 'Visitas', 'Sem contato', 'Satisfação'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{q.data!.csms.map((c) => (
              <tr key={c.csmId ?? 'none'} className="border-t border-line">
                <td className="px-3 py-2.5 font-semibold text-ink">{c.name}</td><td className="num px-3 py-2.5">{c.accounts}</td><td className="num px-3 py-2.5">{fmtBRL(c.acvCents)}</td>
                <td className="num px-3 py-2.5">{c.byLevel.critica} / {c.byLevel.alta}</td>
                <td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="h-2 w-24 rounded-full bg-surface-2"><div className={clsx('h-2 rounded-full', (c.capacity.load ?? 0) > 1 ? 'bg-danger' : (c.capacity.load ?? 0) > 0.85 ? 'bg-[#F59E0B]' : 'bg-success')} style={{ width: `${Math.min(100, (c.capacity.load ?? 0) * 100)}%` }} /></div><span className="num text-xs">{c.capacity.demandHours}h / {c.capacity.capacityHours}h</span></div>{(c.capacity.load ?? 0) > 1 && <span className="text-xs font-semibold text-danger">sobrecarga</span>}</td>
                <td className="num px-3 py-2.5">{covText(c.coverage)}</td><td className="num px-3 py-2.5 font-semibold">{covText(c.coverage, 'weighted')}</td><td className="num px-3 py-2.5">{covText(c.criticalCoverage, 'weighted')}</td>
                <td className="num px-3 py-2.5">{c.visits.done}/{c.visits.planned}{c.visits.late ? <span className="text-danger"> ({c.visits.late} atrasada)</span> : ''}</td>
                <td className="num px-3 py-2.5">{c.withoutContact}</td><td className="num px-3 py-2.5">{c.satisfaction ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="card overflow-hidden" aria-labelledby="sc-title">
          <h2 id="sc-title" className="px-5 pt-4 text-lg font-bold text-ink">Scorecard dos CSMs</h2>
          <p className="px-5 pb-3 text-sm text-muted">Resultado operacional (cobertura ponderada), comercial (contas com expansão ou novo negócio), qualidade (registros com resultado detalhado) e gestão de risco (contas críticas no prazo). Componente sem dado fica fora da média. A gamificação só pontua o que foi realizado e comprovado.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['CSM', 'Operacional', 'Comercial', 'Qualidade', 'Risco', 'Scorecard', 'Renovações', 'Novos negócios', 'Receita adicional', 'Pontos'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{q.data!.csms.map((c) => <tr key={c.csmId ?? 'none'} className="border-t border-line"><td className="px-3 py-2.5 font-semibold text-ink">{c.name}</td><td className="num px-3 py-2.5">{pct(c.scorecard.operacional)}</td><td className="num px-3 py-2.5">{pct(c.scorecard.comercial)}</td><td className="num px-3 py-2.5">{pct(c.scorecard.qualidade)}</td><td className="num px-3 py-2.5">{pct(c.scorecard.risco)}</td><td className="num px-3 py-2.5 font-bold">{pct(c.scorecard.total)}</td><td className="num px-3 py-2.5">{c.renewals}</td><td className="num px-3 py-2.5">{c.newBusiness}</td><td className="num px-3 py-2.5">{fmtBRL(c.additionalCents)}</td><td className="num px-3 py-2.5" title={c.gamification.rule}>{c.gamification.points}</td></tr>)}</tbody>
          </table></div>
        </section>
      </>)}
    </div>
  );
}

function Jornadas() {
  const q = useQuery({ queryKey: ['cs-journeys'], queryFn: () => api<{ items: { id: string; client: string; csmName: string | null; templateName: string; status: string; startedAt: string; progress: number; done: number; total: number; late: number; next: { title: string; plannedAt: string | null } | null }[] }>('/cs/journeys') });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.items.length) return <div className="card"><EmptyState title="Nenhuma jornada" description="A jornada começa quando a negociação entra na etapa configurada (padrão: Planejamento, no funil Sucesso do Cliente)." /></div>;
  return (
    <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
      <thead className="bg-surface-2 text-xs text-muted"><tr>{['Cliente', 'Modelo', 'CSM', 'Início', 'Progresso', 'Próximo marco', 'Atrasados'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
      <tbody>{q.data!.items.map((j) => <tr key={j.id} className="border-t border-line"><td className="px-3 py-2.5"><Link className="font-semibold text-ink hover:underline" to={`/sucesso/jornadas/${j.id}`}>{j.client}</Link></td><td className="px-3 py-2.5">{j.templateName}</td><td className="px-3 py-2.5">{j.csmName ?? '—'}</td><td className="num px-3 py-2.5">{fmtDate(j.startedAt)}</td><td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="h-2 w-24 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-primary" style={{ width: `${j.progress * 100}%` }} /></div><span className="num text-xs">{j.done}/{j.total}</span></div></td><td className="px-3 py-2.5">{j.next ? `${j.next.title}${j.next.plannedAt ? ` · ${fmtDate(j.next.plannedAt)}` : ''}` : 'Concluída'}</td><td className={clsx('num px-3 py-2.5', j.late && 'font-semibold text-danger')}>{j.late}</td></tr>)}</tbody>
    </table></div></div>
  );
}

type Tab = 'carteira' | 'atencao' | 'cobertura' | 'gestao' | 'jornadas';
export function CustomerSuccessPage() {
  const { me } = useAuth();
  const lookups = useLookups();
  const [f, setF] = useUrlState({ t: 'carteira', csm: '', tier: '', level: '', from: '', to: '' });
  const params = { csmId: f.csm || undefined, tier: f.tier || undefined, level: f.level || undefined, from: f.from || undefined, to: f.to || undefined };
  const q = useQuery({ queryKey: ['cs-portfolio', params], placeholderData: keepPreviousData, queryFn: () => api<Portfolio>(`/cs/portfolio${qs(params)}`) });
  const cfg = useQuery({ queryKey: ['cs-config'], queryFn: () => api<{ config: { visitTypes: string[] } }>('/cs/config') });
  const [act, setAct] = useState<null | { kind: 'followup' | 'visit' | 'plan'; contactId: string; activity?: Portfolio['priorities'][number] }>(null);
  const manage = q.data?.canManage;
  const tabs: { key: Tab; label: string }[] = [{ key: 'carteira', label: 'Minha carteira' }, { key: 'atencao', label: 'Contas que precisam de atenção' }, { key: 'cobertura', label: 'Cobertura' }, ...(manage ? [{ key: 'gestao' as Tab, label: 'Gestão' }] : []), { key: 'jornadas', label: 'Jornadas' }];
  const tab = (tabs.some((t) => t.key === f.t) ? f.t : 'carteira') as Tab;
  return (
    <div className="w-full">
      <PageHeader icon={<HeartHandshake className="h-9 w-9" strokeWidth={2.2} />} title="Sucesso do Cliente" subtitle={`Carteira, prioridades e cobertura${me ? ` · ${me.user.name}` : ''}`} actions={<MoneyToggle />} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {manage && <FormField label="CSM" htmlFor="cs-f-csm"><Select id="cs-f-csm" value={f.csm} onChange={(e) => setF({ csm: e.target.value })}><option value="">Todos</option>{lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}
        <FormField label="Tier" htmlFor="cs-f-tier"><Select id="cs-f-tier" value={f.tier} onChange={(e) => setF({ tier: e.target.value })}><option value="">Todos</option>{(['small', 'middle', 'large'] as Tier[]).map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}</Select></FormField>
        <FormField label="Criticidade" htmlFor="cs-f-level"><Select id="cs-f-level" value={f.level} onChange={(e) => setF({ level: e.target.value })}><option value="">Todas</option>{CS_LEVELS.map((l) => <option key={l} value={l}>{CS_LEVEL_LABELS[l]}</option>)}</Select></FormField>
        {tab === 'carteira' && <><FormField label="Cobertura de" htmlFor="cs-f-from"><Input id="cs-f-from" type="date" value={f.from || monthStart()} onChange={(e) => setF({ from: e.target.value })} /></FormField><FormField label="até" htmlFor="cs-f-to"><Input id="cs-f-to" type="date" value={f.to || new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ to: e.target.value })} /></FormField></>}
      </div>
      <Tabs<Tab> label="Sucesso do Cliente" className="mb-5" value={tab} onChange={(t) => setF({ t })} tabs={tabs} />
      {tab === 'cobertura' ? <Cobertura csmId={f.csm} /> : tab === 'gestao' ? <Gestao /> : tab === 'jornadas' ? <Jornadas /> : q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : tab === 'carteira' ? <Carteira p={q.data!} onAct={setAct} /> : <Atencao p={q.data!} onAct={setAct} />}
      {act?.kind === 'followup' && <FollowUpDialog contactId={act.contactId} activity={act.activity ? { id: act.activity.id, title: act.activity.title, kind: act.activity.kind, dueAt: act.activity.dueAt, plannedAt: act.activity.plannedAt, completedAt: null, result: null, cadence: null, ownerName: null } : null} open onClose={() => setAct(null)} />}
      {act?.kind === 'visit' && <VisitDialog contactId={act.contactId} types={cfg.data?.config.visitTypes ?? ['Relacionamento']} open onClose={() => setAct(null)} />}
      {act?.kind === 'plan' && <PlanDialog contactId={act.contactId} open onClose={() => setAct(null)} />}
    </div>
  );
}
