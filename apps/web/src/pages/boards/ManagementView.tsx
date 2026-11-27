/**
 * Visão da gerência e diretoria sobre os departamentos que gere: capacidade, Sprints, cumprimento, 70/20/10,
 * fura-filas, comercial deslocado e — o que importa à diretoria — quais compromissos de negócio estão afetados
 * (oportunidades, projetos, dependências entre times), não só quantas tarefas atrasaram.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, Building2 } from 'lucide-react';
import { CAPACITY_CATEGORIES, CAPACITY_CATEGORY_LABELS, SPRINT_STATUS_LABELS, STAGE_LABELS, fmtMinutes, type CapacityCategory, type OpportunityStage, type SprintStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { PageHeader } from '../../components/layout/PageHeader';
import { Chip, EmptyState, ErrorState, LoadingRows } from '../../components/ui/primitives';

const h = (m: number | null | undefined) => (m == null ? '—' : fmtMinutes(m) || '0h');
const p = (v: number | null | undefined) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);
const CAT_BAR: Record<CapacityCategory, string> = { comercial: 'bg-primary', interno: 'bg-[#0F766E]', hipotese: 'bg-[#B45309]' };
type Dept = {
  key: string; label: string; role: string;
  capacity: { totalNetMinutes: number; committedMinutes: number; withoutSchedule: string[] };
  sprint: { id: string; status: SprintStatus; objective: string | null; progressPct: number | null; planned: Record<CapacityCategory, number> | null; deviationPp: number | null; furaFilas: number } | null;
  lastClosed: { weekStart: string; originalPct: number | null; revisedPct: number | null } | null;
  displacedComercialMinutes: number; furaFilas: number; overload: { name: string; net: number | null; committed: number }[];
  pendingApprovals: { id: string; title: string; since: string }[]; pendingDecisions: number; overdue: number; blocked: number;
};
type Data = {
  week: string; departments: Dept[];
  business: { opportunities: { id: string; label: string; valueCents: number | null; stage: string | null; ownerName: string | null; reasons: string[]; departments: string[] }[]; opportunitiesCount: number; valueCents: number };
  projectsAtRisk: { id: string; label: string; overdue: number; blocked: number; depRisk: number; departments: string[] }[];
  dependencies: { predecessor: { id: string; title: string; board: string }; dependent: { id: string; title: string; board: string; link: string | null }; state: string }[];
};

export function ManagementViewPage() {
  const q = useQuery({ queryKey: ['quadros', 'visao-geral'], queryFn: () => api<Data>('/quadros/visao-geral') });
  const d = q.data;
  return (
    <div className="space-y-4">
      <PageHeader icon={<Building2 className="h-9 w-9" strokeWidth={2.2} />} title="Visão da gerência" subtitle={d ? `Departamentos sob a sua gestão · semana de ${fmtDate(d.week)} · esforço estimado/comprometido, não horas trabalhadas` : 'Departamentos sob a sua gestão'} />
      {q.isLoading ? <LoadingRows rows={8} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && (
        <>
          <section aria-label="Departamentos" className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {d.departments.map((x) => {
              const total = x.sprint?.planned ? CAPACITY_CATEGORIES.reduce((t, c) => t + x.sprint!.planned![c], 0) : 0;
              return (
                <article key={x.key} aria-label={`Departamento ${x.label}`} className="card space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-bold text-ink">{x.label}</h2>
                    <Link to={`/quadro/${x.key}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">Abrir quadro <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted">Sprint da semana</dt><dd>{x.sprint ? `${SPRINT_STATUS_LABELS[x.sprint.status]}${x.sprint.progressPct != null ? ` · ${p(x.sprint.progressPct)} entregue` : ''}` : 'Não planejada'}</dd>
                    <dt className="text-muted">Capacidade</dt><dd className={clsx(x.capacity.committedMinutes > x.capacity.totalNetMinutes && 'font-semibold text-danger')}>{h(x.capacity.committedMinutes)} de {h(x.capacity.totalNetMinutes)}</dd>
                    <dt className="text-muted">Última Sprint encerrada</dt><dd>{x.lastClosed ? `${fmtDate(x.lastClosed.weekStart)}: original ${p(x.lastClosed.originalPct)} · revisado ${p(x.lastClosed.revisedPct)}` : '—'}</dd>
                    <dt className="text-muted">Fura-filas (8 semanas)</dt><dd>{x.furaFilas}{x.displacedComercialMinutes ? <span className="font-semibold text-danger"> · {h(x.displacedComercialMinutes)} do comercial deslocadas</span> : ''}</dd>
                    <dt className="text-muted">Atrasadas · bloqueadas</dt><dd className={clsx(x.overdue && 'font-semibold text-danger')}>{x.overdue} · {x.blocked}</dd>
                  </dl>
                  {x.sprint?.planned && total > 0 && (
                    <div>
                      <div className="flex h-2 w-full overflow-hidden bg-surface-2" aria-hidden>{CAPACITY_CATEGORIES.map((c) => <div key={c} className={CAT_BAR[c]} style={{ width: `${(x.sprint!.planned![c] / total) * 100}%` }} />)}</div>
                      <p className="mt-0.5 text-xs text-muted">{CAPACITY_CATEGORIES.map((c) => `${CAPACITY_CATEGORY_LABELS[c]} ${Math.round((x.sprint!.planned![c] / total) * 100)}%`).join(' · ')}{x.sprint.deviationPp != null ? ` · desvio ${String(x.sprint.deviationPp).replace('.', ',')} p.p.` : ''}</p>
                    </div>
                  )}
                  {!!x.overload.length && <p className="text-sm text-danger">Sobrecarga: {x.overload.map((o) => `${o.name} (${h(o.committed)} de ${o.net == null ? 'sem jornada' : h(o.net)})`).join(', ')}</p>}
                  {!!x.capacity.withoutSchedule.length && <p className="text-xs text-muted">Sem jornada cadastrada: {x.capacity.withoutSchedule.join(', ')}</p>}
                  {(x.pendingApprovals.length > 0 || x.pendingDecisions > 0) && (
                    <div className="border-l-4 border-l-danger bg-danger-soft px-3 py-2 text-sm">
                      {x.pendingApprovals.map((a) => <p key={a.id}><b>Aprovação gerencial pendente:</b> <Link className="underline" to={`/quadro/${x.key}?furafila=${a.id}`}>{a.title}</Link></p>)}
                      {x.pendingDecisions > 0 && <p>{x.pendingDecisions} fura-fila(s) aguardando a liderança</p>}
                    </div>
                  )}
                </article>
              );
            })}
          </section>

          <section aria-label="Compromissos de negócio afetados" className="card overflow-hidden">
            <header className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-4 py-3"><h2 className="text-base font-bold text-ink">Oportunidades afetadas</h2><span className="text-sm text-muted">{d.business.opportunitiesCount} · {fmtBRL(d.business.valueCents)} (cada oportunidade conta uma vez)</span></header>
            {!d.business.opportunities.length ? <p className="px-4 py-3 text-sm text-muted">Nenhuma oportunidade com tarefa atrasada, bloqueada ou replanejada por fura-fila.</p> : (
              <table className="w-full text-sm"><thead className="bg-surface-2 text-left text-xs text-muted"><tr>{['Oportunidade', 'Valor', 'Etapa', 'Responsável', 'Motivo', 'Departamentos'].map((x) => <th key={x} className="px-4 py-1.5 font-semibold">{x}</th>)}</tr></thead>
                <tbody>{d.business.opportunities.map((o) => <tr key={o.id} className="border-t border-line"><td className="px-4 py-1.5"><Link to={`/opportunities/${o.id}`} className="font-semibold text-primary hover:underline">{o.label}</Link></td><td className="num px-4 py-1.5">{o.valueCents ? fmtBRL(o.valueCents) : '—'}</td><td className="px-4 py-1.5">{o.stage ? STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage : '—'}</td><td className="px-4 py-1.5">{o.ownerName ?? '—'}</td><td className="px-4 py-1.5">{o.reasons.map((r) => <Chip key={r} tone="red">{r}</Chip>)}</td><td className="px-4 py-1.5 text-xs">{o.departments.join(', ')}</td></tr>)}</tbody>
              </table>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-label="Projetos em risco" className="card overflow-hidden">
              <h2 className="border-b border-line px-4 py-3 text-base font-bold text-ink">Projetos em risco</h2>
              {!d.projectsAtRisk.length ? <p className="px-4 py-3 text-sm text-muted">Nenhum.</p> : <ul className="divide-y divide-line text-sm">{d.projectsAtRisk.map((x) => <li key={x.id} className="px-4 py-2"><Link to={`/projetos/${x.id}?t=departamentos`} className="font-semibold text-primary hover:underline">{x.label}</Link><span className="block text-xs text-muted">{[x.overdue ? `${x.overdue} atrasada(s)` : '', x.blocked ? `${x.blocked} bloqueada(s)` : '', x.depRisk ? `${x.depRisk} dependência(s) em risco` : ''].filter(Boolean).join(' · ')} · {x.departments.join(', ')}</span></li>)}</ul>}
            </section>
            <section aria-label="Dependências entre departamentos em risco" className="card overflow-hidden">
              <h2 className="border-b border-line px-4 py-3 text-base font-bold text-ink">Dependências entre departamentos em risco</h2>
              {!d.dependencies.length ? <p className="px-4 py-3 text-sm text-muted">Nenhuma.</p> : <ul className="divide-y divide-line text-sm">{d.dependencies.map((x) => <li key={`${x.predecessor.id}-${x.dependent.id}`} className="px-4 py-2"><span className="font-semibold text-ink">{x.predecessor.title}</span> <span className="text-xs text-muted">({x.predecessor.board})</span> <ArrowRight className="inline h-3.5 w-3.5 text-muted" aria-label="libera" /> <span className="font-semibold text-ink">{x.dependent.title}</span> <span className="text-xs text-muted">({x.dependent.board}{x.dependent.link ? ` · ${x.dependent.link}` : ''})</span> <Chip tone="red">{x.state === 'atrasada' ? 'Atrasada' : 'Em risco'}</Chip></li>)}</ul>}
            </section>
          </div>
        </>
      )}
      {q.isError && <EmptyState title="Sem departamentos para consolidar" description="A visão é da gerência e da diretoria dos times configurados nos Quadros de Tarefas." />}
    </div>
  );
}
