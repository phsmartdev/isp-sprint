/** Projetos: carteira de projetos com situação, saúde, progresso e prazo. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { FolderKanban, Plus } from 'lucide-react';
import { PROJECT_KINDS, PROJECT_KIND_LABELS } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Tabs } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';
import { HealthChip, LinkChips, NewProjectDialog, ProgressBar, STATUS_TONE, type ProjectRow } from '../../features/projects/shared';
import { FitText } from '../../components/ui/FitText';
import { FrontsPanel } from '../../features/projects/fronts';

type View = 'painel' | 'ativos' | 'concluido' | 'todos';

export function ProjectsPage() {
  const [u, setU] = useUrlState({ v: 'ativos', mine: '', kind: '', q: '', tag: '' });
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['projects', u],
    enabled: u.v !== 'painel',
    placeholderData: keepPreviousData,
    queryFn: () => api<{ items: ProjectRow[] }>(`/projects${qs({ status: u.v === 'todos' ? undefined : u.v, mine: u.mine ? 'true' : undefined, kind: u.kind || undefined, q: u.q || undefined })}`),
  });
  const items = q.data?.items ?? [];
  const late = items.filter((p) => p.progress.health === 'atrasado').length;
  const attention = items.filter((p) => p.progress.health === 'atencao').length;
  const lateTasks = items.reduce((a, p) => a + p.progress.lateTasks, 0);
  return (
    <div>
      <PageHeader icon={<FolderKanban />} title="Projetos" subtitle="Implantações, execuções de ata e iniciativas internas, com etapas, marcos e equipe." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Novo projeto</Button>} />
      <Tabs label="Situação" value={u.v as View} onChange={(v) => setU({ v })} tabs={[{ key: 'painel', label: 'Painel das frentes' }, { key: 'ativos', label: 'Ativos' }, { key: 'concluido', label: 'Concluídos' }, { key: 'todos', label: 'Todos' }]} className="mb-4" />
      {u.v === 'painel' ? <FrontsPanel tag={u.tag} onTag={(tag) => setU({ tag })} /> : <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Buscar" htmlFor="pj-q"><Input id="pj-q" className="w-64" value={u.q} onChange={(e) => setU({ q: e.target.value })} placeholder="Nome do projeto" /></FormField>
        <FormField label="Tipo" htmlFor="pj-k"><Select id="pj-k" value={u.kind} onChange={(e) => setU({ kind: e.target.value })}><option value="">Todos</option>{PROJECT_KINDS.map((k) => <option key={k} value={k}>{PROJECT_KIND_LABELS[k]}</option>)}</Select></FormField>
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!u.mine} onChange={(e) => setU({ mine: e.target.checked ? '1' : '' })} />Só onde participo</label>
      </div>
      {u.v === 'ativos' && !!items.length && (
        <ul className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Projetos ativos" value={items.length} />
          <Kpi label="Atrasados" value={late} danger={late > 0} hint="marco ou prazo vencido" />
          <Kpi label="Pedem atenção" value={attention} hint="tarefa atrasada ou marco próximo" />
          <Kpi label="Tarefas atrasadas" value={lateTasks} danger={lateTasks > 0} />
        </ul>
      )}
      <section className="card overflow-hidden">
        {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !items.length ? (
          <EmptyState title="Nenhum projeto aqui" description="Crie um projeto em branco ou a partir de um modelo. Projetos também podem nascer da ficha do cliente, do contrato ou da ata." action={<Button variant="primary" onClick={() => setCreating(true)}>Novo projeto</Button>} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Projeto', 'Tipo', 'Responsável', 'Situação', 'Saúde', 'Progresso', 'Prazo'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <td className="px-4 py-3"><Link to={`/projetos/${p.id}`} className="font-semibold text-primary hover:underline">{p.name}</Link><span className="num block text-xs text-muted">PJ-{p.code}</span><span className="mt-1 block"><LinkChips links={p.links} /></span></td>
                    <td className="px-4 py-3">{PROJECT_KIND_LABELS[p.kind]}</td>
                    <td className="px-4 py-3">{p.ownerName}</td>
                    <td className="px-4 py-3"><Chip tone={STATUS_TONE[p.status]}>{p.statusLabel}</Chip></td>
                    <td className="px-4 py-3"><HealthChip p={p.progress} />{!!p.progress.reasons.length && <span className="mt-1 block max-w-[220px] text-xs text-muted">{p.progress.reasons[0]}</span>}</td>
                    <td className="px-4 py-3"><ProgressBar p={p.progress} className="w-36" /><span className="num text-xs text-muted">{p.progress.done} de {p.progress.total}</span></td>
                    <td className={clsx('num whitespace-nowrap px-4 py-3', p.dueOn && p.progress.health === 'atrasado' && 'font-semibold text-danger')}>{p.dueOn ? fmtDate(p.dueOn) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>}
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

const Kpi = ({ label, value, hint, danger }: { label: string; value: number; hint?: string; danger?: boolean }) => (
  <li className="card p-4"><p className="text-sm text-muted">{label}</p><FitText className={clsx('num mt-1 text-xl font-bold', danger ? 'text-danger' : 'text-ink')}>{value}</FitText>{hint && <p className="text-xs text-muted">{hint}</p>}</li>
);
