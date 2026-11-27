/**
 * Projeto → Departamentos (Etapa 7 do Quadro de Tarefas): as atividades do projeto em cada departamento executor
 * (na Sprint, planejadas ou no backlog do time), as dependências entre times com o risco e o avanço pelos entregáveis.
 * As tarefas são as mesmas dos quadros dos times: abrir aqui abre a mesma tarefa.
 */
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Chip, EmptyState, ErrorState, LoadingRows } from '../../components/ui/primitives';

type DepSide = { id: string; title: string; status: string; ownerName: string; dueDay: string | null; boardLabel: string; inProject: boolean };
type Data = {
  progress: { done: number; total: number; pct: number; basis: 'homologados' | 'concluidos' };
  currentMilestone: { name: string; dueOn: string | null; late: boolean } | null;
  nextAction: { kind: string; text: string };
  tasks: { total: number; done: number };
  departments: { key: string; label: string; total: number; done: number; overdue: number; blocked: number; inSprint: number; planned: number; backlog: number;
    tasks: { id: string; ref: string; title: string; ownerName: string; dueDay: string | null; done: boolean; overdue: boolean; blocked: boolean; planning: 'na_sprint' | 'planejada' | 'backlog' | 'concluida'; plannedWeek: string | null }[] }[];
  dependencies: { predecessor: DepSide; dependent: DepSide; state: string; stateLabel: string; atRisk: boolean }[];
};
const PLANNING: Record<Data['departments'][number]['tasks'][number]['planning'], string> = { na_sprint: 'Na Sprint', planejada: 'Planejada', backlog: 'No backlog do time', concluida: 'Concluída' };

export function ProjectDepartments({ projectId, onOpen }: { projectId: string; onOpen: (taskId: string) => void }) {
  const q = useQuery({ queryKey: ['project', projectId, 'departamentos'], queryFn: () => api<Data>(`/projects/${projectId}/departamentos`) });
  if (q.isLoading) return <section className="card"><LoadingRows rows={5} /></section>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section aria-label="Avanço do projeto" className="card grid gap-4 p-4 sm:grid-cols-[1fr_1fr_1.4fr]">
        <div>
          <p className="text-xs font-semibold text-muted">Avanço pelos entregáveis</p>
          <p className="mt-1 text-2xl font-bold text-ink"><span className="num">{d.progress.pct}%</span> <span className="text-base font-semibold text-muted">{d.progress.done} de {d.progress.total} marcos {d.progress.basis === 'homologados' ? 'homologados' : 'concluídos'}</span></p>
          <div className="mt-2 h-2 bg-line" aria-hidden><div className="h-2 bg-success" style={{ width: `${d.progress.pct}%` }} /></div>
          {!d.progress.total && <p className="mt-1 text-xs text-muted">Sem marcos: cadastre os entregáveis em Marcos para medir o avanço.</p>}
        </div>
        <div>
          <p className="text-xs font-semibold text-muted">Tarefas (referência)</p>
          <p className="num mt-1 text-2xl font-bold text-ink">{d.tasks.done}/{d.tasks.total}</p>
          <p className="text-xs text-muted">O avanço não depende só da quantidade de tarefas.</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted">Marco atual e próxima ação</p>
          {!d.progress.total ? <p className="mt-1 text-sm text-muted">Sem marcos cadastrados.</p> : <>
            <p className={clsx('mt-1 text-sm font-semibold', d.currentMilestone?.late ? 'text-danger' : 'text-ink')}>{d.currentMilestone ? `${d.currentMilestone.name}${d.currentMilestone.dueOn ? ` · ${fmtDate(d.currentMilestone.dueOn)}` : ''}${d.currentMilestone.late ? ' · atrasado' : ''}` : 'Nenhum marco em aberto'}</p>
            <p className="text-sm text-muted">{d.nextAction.text}</p>
          </>}
        </div>
      </section>

      <section aria-label="Dependências entre departamentos" className="card p-4">
        <h2 className="text-base font-bold text-ink">Dependências entre departamentos</h2>
        {!d.dependencies.length ? <p className="mt-1 text-sm text-muted">Nenhuma tarefa deste projeto depende de outro time (ou é aguardada por outro time).</p> : (
          <ul className="mt-2 divide-y divide-line">{d.dependencies.map((x) => (
            <li key={`${x.predecessor.id}-${x.dependent.id}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <button type="button" className="min-w-0 text-left hover:underline" onClick={() => onOpen(x.predecessor.id)}><span className="block font-semibold text-ink">{x.predecessor.title}</span><span className="text-xs text-muted">{x.predecessor.boardLabel} · {x.predecessor.ownerName}{x.predecessor.dueDay ? ` · ${fmtDate(x.predecessor.dueDay)}` : ' · sem prazo'}</span></button>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-label="libera" />
              <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => onOpen(x.dependent.id)}><span className="block font-semibold text-ink">{x.dependent.title}</span><span className="text-xs text-muted">{x.dependent.boardLabel} · {x.dependent.ownerName}{x.dependent.dueDay ? ` · prazo ${fmtDate(x.dependent.dueDay)}` : ''}</span></button>
              <Chip tone={x.atRisk ? 'red' : x.state === 'concluida' ? 'blue' : 'neutral'}>{x.stateLabel}</Chip>
            </li>
          ))}</ul>
        )}
      </section>

      {!d.departments.length ? <section className="card"><EmptyState title="Nenhuma atividade no projeto" description="Crie as tarefas do projeto com o responsável de cada departamento: elas aparecem sozinhas no quadro do time dele." /></section> : d.departments.map((dep) => (
        <section key={dep.key} aria-label={`Departamento ${dep.label}`} className="card overflow-hidden">
          <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-4 py-3">
            <h2 className="text-base font-bold text-ink">{dep.label}</h2>
            <span className="text-sm text-muted"><b className="num text-ink">{dep.done}/{dep.total}</b> concluídas · {dep.inSprint} na Sprint · {dep.planned} planejadas · {dep.backlog} no backlog{dep.overdue ? ` · ${dep.overdue} atrasada(s)` : ''}{dep.blocked ? ` · ${dep.blocked} bloqueada(s)` : ''}</span>
          </header>
          <ul className="divide-y divide-line">{dep.tasks.map((t) => (
            <li key={t.id}><button type="button" className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left text-sm hover:bg-surface-2" onClick={() => onOpen(t.id)}>
              <span className={clsx('min-w-0 flex-1 font-semibold', t.done ? 'text-muted line-through' : 'text-ink')}>{t.title} <span className="num text-xs font-normal text-muted">{t.ref}</span></span>
              <span className="text-xs text-muted">{t.ownerName}</span>
              <span className={clsx('text-xs', t.overdue ? 'font-semibold text-danger' : 'text-muted')}>{t.dueDay ? fmtDate(t.dueDay) : 'sem prazo'}</span>
              {t.blocked && <Chip tone="red">Bloqueada</Chip>}
              <Chip tone={t.planning === 'na_sprint' ? 'blue' : t.planning === 'planejada' ? 'sky' : 'neutral'}>{PLANNING[t.planning]}{t.planning === 'planejada' && t.plannedWeek ? ` · ${fmtDate(t.plannedWeek)}` : ''}</Chip>
            </button></li>
          ))}</ul>
        </section>
      ))}
      <p className="text-xs text-muted">Cada liderança planeja estas atividades na capacidade do seu departamento. Para mudar responsável, prazo ou planejamento, abra a tarefa.</p>
    </div>
  );
}
