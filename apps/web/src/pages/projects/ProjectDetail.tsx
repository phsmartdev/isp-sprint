/** Projeto: quadro, lista, calendário, linha do tempo, marcos, equipe e histórico. */
import { useMemo, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Diamond, FolderKanban, Plus, Trash2 } from 'lucide-react';
import {
  PROJECT_KINDS, PROJECT_KIND_LABELS, PROJECT_MEMBER_ROLES, PROJECT_MEMBER_ROLE_LABELS, PROJECT_STATUS_LABELS, PROJECT_TRANSITIONS, addDaysIso,
  type ProjectKind, type ProjectMemberRole, type ProjectStatus,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups, useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { HealthChip, LinkChips, PRIORITY_LABELS, ProgressBar, STATUS_TONE, type Milestone, type ProjectDetail, type Stage, type Task } from '../../features/projects/shared';

type TabKey = 'quadro' | 'lista' | 'calendario' | 'linha' | 'marcos' | 'equipe' | 'historico';
const todayIso = () => new Date().toLocaleDateString('en-CA');
const PRIO_TONE = { baixa: 'neutral', media: 'sky', alta: 'red' } as const;

function useProject(id: string) {
  return useQuery({ queryKey: ['project', id], queryFn: () => api<ProjectDetail>(`/projects/${id}`) });
}
function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ['project', id] }); void qc.invalidateQueries({ queryKey: ['projects'] }); void qc.invalidateQueries({ queryKey: ['activities'] }); };
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const q = useProject(id);
  const [u, setU] = useUrlState({ t: 'quadro' });
  const [task, setTask] = useState<Task | 'new' | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'status' | 'stages' | 'template' | null>(null);
  const { can: canLevel } = useAuth();
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const open = p.tasks.filter((t) => !t.completedAt).length;
  return (
    <div className="space-y-4">
      <Link to="/projetos" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"><ChevronLeft className="h-4 w-4" />Projetos</Link>
      <header className="card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-navy text-lime" aria-hidden><FolderKanban className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            <p className="num text-xs text-muted">PJ-{p.code} · {PROJECT_KIND_LABELS[p.kind]}</p>
            <h1 className="font-display text-[1.6rem] font-bold leading-tight text-ink">{p.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip tone={STATUS_TONE[p.status]}>{p.statusLabel}</Chip>
              <HealthChip p={p.progress} />
              <Chip tone={PRIO_TONE[p.priority]}>Prioridade {PRIORITY_LABELS[p.priority].toLowerCase()}</Chip>
              <LinkChips links={p.links} />
            </div>
            {p.description && <p className="mt-3 max-w-3xl whitespace-pre-line text-sm">{p.description}</p>}
          </div>
          {p.can.manage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDialog('edit')}>Editar</Button>
              <Button variant="secondary" onClick={() => setDialog('status')}>Mudar situação</Button>
              {canLevel('projetos', 'equipe') && <Button variant="outline" onClick={() => setDialog('template')}>Salvar como modelo</Button>}
            </div>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm md:grid-cols-5">
          <div><dt className="text-xs text-muted">Responsável</dt><dd className="font-semibold text-ink">{p.ownerName}</dd></div>
          <div><dt className="text-xs text-muted">Início</dt><dd className="num font-semibold text-ink">{fmtDate(p.startOn)}</dd></div>
          <div><dt className="text-xs text-muted">Prazo final</dt><dd className={clsx('num font-semibold', p.dueOn && p.dueOn < todayIso() && p.status !== 'concluido' ? 'text-danger' : 'text-ink')}>{p.dueOn ? fmtDate(p.dueOn) : '—'}</dd></div>
          <div><dt className="text-xs text-muted">Tarefas</dt><dd className="num font-semibold text-ink">{open} em aberto · {p.progress.lateTasks} atrasada(s)</dd></div>
          <div><dt className="text-xs text-muted">Progresso</dt><dd><ProgressBar p={p.progress} /></dd></div>
        </dl>
        {!!p.progress.reasons.length && p.progress.health !== 'em_dia' && <p className="mt-3 text-sm text-muted">Por que: {p.progress.reasons.join('; ')}.</p>}
      </header>

      <Tabs label="Visões do projeto" value={u.t as TabKey} onChange={(t) => setU({ t }, { resetPage: false })} tabs={[
        { key: 'quadro', label: 'Quadro' }, { key: 'lista', label: 'Lista', count: p.tasks.length }, { key: 'calendario', label: 'Calendário' }, { key: 'linha', label: 'Linha do tempo' },
        { key: 'marcos', label: 'Marcos', count: p.milestones.length }, { key: 'equipe', label: 'Equipe', count: p.members.length }, { key: 'historico', label: 'Histórico' },
      ]} />

      {['quadro', 'lista', 'calendario', 'linha'].includes(u.t) && p.can.work && (
        <div className="flex flex-wrap justify-end gap-2">
          {u.t === 'quadro' && p.can.manage && <Button variant="secondary" onClick={() => setDialog('stages')}>Etapas do quadro</Button>}
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setTask('new')}>Nova tarefa</Button>
        </div>
      )}
      {u.t === 'quadro' && <Board p={p} onOpen={setTask} />}
      {u.t === 'lista' && <TaskList p={p} onOpen={setTask} />}
      {u.t === 'calendario' && <Calendar p={p} onOpen={setTask} />}
      {u.t === 'linha' && <Timeline p={p} onOpen={setTask} />}
      {u.t === 'marcos' && <Milestones p={p} />}
      {u.t === 'equipe' && <Team p={p} />}
      {u.t === 'historico' && <History id={p.id} />}

      <TaskDialog p={p} task={task} onClose={() => setTask(null)} />
      <EditProject p={p} open={dialog === 'edit'} onClose={() => setDialog(null)} />
      <StatusDialog p={p} open={dialog === 'status'} onClose={() => setDialog(null)} />
      <StagesDialog p={p} open={dialog === 'stages'} onClose={() => setDialog(null)} />
      <TemplateDialog p={p} open={dialog === 'template'} onClose={() => setDialog(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ tarefas
function useMoveTask(p: ProjectDetail) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  return useMutation({
    mutationFn: ({ t, stageId, position }: { t: Task; stageId?: string; position?: number }) => api(`/projects/${p.id}/tasks/${t.id}`, { method: 'PATCH', body: { rowVersion: t.rowVersion, stageId, position } }),
    onSuccess: refresh,
    onError: (e) => { refresh(); toast({ tone: 'error', message: errMsg(e) }); },
  });
}

const isLate = (t: Task) => !t.completedAt && !!t.dueOn && t.dueOn < todayIso();

function TaskCard({ t, p, onOpen, draggable }: { t: Task; p: ProjectDetail; onOpen: (t: Task) => void; draggable: boolean }) {
  const ms = p.milestones.find((m) => m.id === t.milestoneId);
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/task', t.id); e.dataTransfer.effectAllowed = 'move'; }}
      className={clsx('rounded-md border bg-surface p-3 shadow-sm', isLate(t) ? 'border-danger/50' : 'border-line', draggable && 'cursor-grab active:cursor-grabbing')}
    >
      <button type="button" className="block w-full text-left" onClick={() => onOpen(t)}>
        <span className={clsx('block text-sm font-semibold', t.completedAt ? 'text-muted line-through' : 'text-ink')}>{t.title}</span>
        {ms && <span className="mt-1 flex items-center gap-1 text-xs text-muted"><Diamond className="h-3 w-3" aria-hidden />{ms.name}</span>}
        <span className="mt-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted"><Avatar name={t.ownerName} size={22} />{t.ownerName.split(' ')[0]}</span>
          <span className={clsx('num text-xs', isLate(t) ? 'font-semibold text-danger' : 'text-muted')}>{t.dueOn ? fmtDate(t.dueOn) : 'sem prazo'}</span>
        </span>
      </button>
    </li>
  );
}

function Board({ p, onOpen }: { p: ProjectDetail; onOpen: (t: Task | 'new') => void }) {
  const move = useMoveTask(p);
  const [over, setOver] = useState<string | null>(null);
  const byStage = (s: Stage) => p.tasks.filter((t) => t.stageId === s.id).sort((a, b) => a.position - b.position);
  const drop = (e: DragEvent, s: Stage, index: number) => {
    e.preventDefault(); setOver(null);
    const t = p.tasks.find((x) => x.id === e.dataTransfer.getData('text/task'));
    if (!t || !p.can.work) return;
    move.mutate({ t, stageId: t.stageId === s.id ? undefined : s.id, position: index });
  };
  if (!p.stages.length) return <EmptyState title="Sem etapas" />;
  return (
    <div className="scroll-thin flex gap-3 overflow-x-auto pb-2">
      {p.stages.map((s) => {
        const tasks = byStage(s);
        const full = !!s.wipLimit && tasks.length >= s.wipLimit;
        return (
          <section key={s.id} aria-label={`Etapa ${s.name}`} className={clsx('flex w-72 shrink-0 flex-col rounded-lg bg-surface-2 p-2', over === s.id && 'ring-2 ring-primary')}
            onDragOver={(e) => { if (p.can.work) { e.preventDefault(); setOver(s.id); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, s, tasks.length)}>
            <h2 className="flex items-center justify-between px-1.5 py-1 text-sm font-bold text-ink">
              <span>{s.name}{s.done && <span className="ml-1.5 text-xs font-normal text-muted">(concluídas)</span>}</span>
              <span className={clsx('num rounded-sm px-1.5 text-xs', full ? 'bg-warning-soft text-[#C2610C]' : 'text-muted')}>{tasks.length}{s.wipLimit ? ` / ${s.wipLimit}` : ''}</span>
            </h2>
            <ul className="mt-1 flex min-h-[80px] flex-col gap-2">
              {tasks.map((t, i) => <div key={t.id} onDragOver={(e) => { if (p.can.work) e.preventDefault(); }} onDrop={(e) => { e.stopPropagation(); drop(e, s, i); }}><TaskCard t={t} p={p} onOpen={onOpen} draggable={p.can.work} /></div>)}
              {!tasks.length && <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-muted">Arraste tarefas para cá</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TaskList({ p, onOpen }: { p: ProjectDetail; onOpen: (t: Task) => void }) {
  const move = useMoveTask(p);
  const doneStage = p.stages.find((s) => s.done);
  const openStage = p.stages.find((s) => !s.done);
  const [sort, setSort] = useState<'prazo' | 'etapa' | 'responsavel'>('prazo');
  const rows = useMemo(() => [...p.tasks].sort((a, b) => sort === 'prazo' ? (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') : sort === 'etapa' ? (p.stages.findIndex((s) => s.id === a.stageId) - p.stages.findIndex((s) => s.id === b.stageId)) || a.position - b.position : a.ownerName.localeCompare(b.ownerName)), [p, sort]);
  if (!rows.length) return <section className="card"><EmptyState title="Nenhuma tarefa" description="Crie a primeira tarefa ou use um modelo ao criar o projeto." /></section>;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-end gap-2 p-3"><FormField label="Ordenar por" htmlFor="tl-sort"><Select id="tl-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="prazo">Prazo</option><option value="etapa">Etapa</option><option value="responsavel">Responsável</option></Select></FormField></div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{['', 'Tarefa', 'Etapa', 'Marco', 'Responsável', 'Início', 'Prazo', 'Prioridade'].map((h, i) => <th key={i} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Concluir ${t.title}`} checked={!!t.completedAt} disabled={!p.can.work || move.isPending} onChange={(e) => move.mutate({ t, stageId: e.target.checked ? doneStage?.id : openStage?.id })} /></td>
                <td className="px-3 py-2"><button type="button" className={clsx('text-left font-semibold hover:underline', t.completedAt ? 'text-muted line-through' : 'text-primary')} onClick={() => onOpen(t)}>{t.title}</button></td>
                <td className="px-3 py-2">{p.stages.find((s) => s.id === t.stageId)?.name ?? '—'}</td>
                <td className="px-3 py-2">{p.milestones.find((m) => m.id === t.milestoneId)?.name ?? '—'}</td>
                <td className="px-3 py-2">{t.ownerName}</td>
                <td className="num px-3 py-2">{t.startOn ? fmtDate(t.startOn) : '—'}</td>
                <td className={clsx('num px-3 py-2', isLate(t) && 'font-semibold text-danger')}>{t.dueOn ? fmtDate(t.dueOn) : '—'}</td>
                <td className="px-3 py-2"><Chip tone={PRIO_TONE[t.priority]}>{PRIORITY_LABELS[t.priority]}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
function Calendar({ p, onOpen }: { p: ProjectDetail; onOpen: (t: Task) => void }) {
  const [month, setMonth] = useState(() => (p.status === 'concluido' ? p.startOn : todayIso()).slice(0, 7));
  const first = new Date(`${month}-01T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const start = addDaysIso(`${month}-01`, -offset);
  const days = Array.from({ length: 42 }, (_, i) => addDaysIso(start, i));
  const shift = (n: number) => { const d = new Date(first); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const raw = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  const today = todayIso();
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">{label}</h2>
        <div className="flex gap-1"><Button size="sm" variant="secondary" aria-label="Mês anterior" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="secondary" onClick={() => setMonth(today.slice(0, 7))}>Hoje</Button><Button size="sm" variant="secondary" aria-label="Próximo mês" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button></div>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7 border-l border-t border-line text-xs">
          {WEEKDAYS.map((w) => <div key={w} className="border-b border-r border-line bg-surface-2 px-2 py-1.5 font-semibold text-muted">{w}</div>)}
          {days.map((d) => {
            const tasks = p.tasks.filter((t) => t.dueOn === d);
            const ms = p.milestones.filter((m) => m.dueOn === d);
            return (
              <div key={d} className={clsx('min-h-[96px] border-b border-r border-line p-1.5', d.slice(0, 7) !== month && 'bg-surface-2/50 text-muted')}>
                <span className={clsx('num inline-flex h-6 w-6 items-center justify-center rounded-full', d === today && 'bg-primary font-bold text-white')}>{Number(d.slice(8))}</span>
                <ul className="mt-1 space-y-1">
                  {ms.map((m) => <li key={m.id} className={clsx('flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-semibold', m.completedAt ? 'bg-success-soft text-[#15803D]' : 'bg-purple-soft text-purple')}><Diamond className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{m.name}</span></li>)}
                  {tasks.map((t) => <li key={t.id}><button type="button" onClick={() => onOpen(t)} className={clsx('block w-full truncate rounded-sm px-1.5 py-0.5 text-left', t.completedAt ? 'bg-surface-2 text-muted line-through' : isLate(t) ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary')}>{t.title}</button></li>)}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Timeline({ p, onOpen }: { p: ProjectDetail; onOpen: (t: Task) => void }) {
  const dates = [p.startOn, p.dueOn, ...p.tasks.flatMap((t) => [t.startOn, t.dueOn]), ...p.milestones.map((m) => m.dueOn)].filter(Boolean) as string[];
  if (!p.tasks.length && !p.milestones.length) return <section className="card"><EmptyState title="Nada para mostrar" description="Tarefas com início e prazo e marcos com data aparecem na linha do tempo." /></section>;
  const min = dates.reduce((a, b) => (b < a ? b : a));
  const max = dates.reduce((a, b) => (b > a ? b : a));
  const dayN = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${min}T12:00:00Z`)) / 86_400_000);
  const span = dayN(max) + 1;
  const W = span <= 45 ? 28 : span <= 120 ? 14 : 6;
  const today = todayIso();
  const weeks = Array.from({ length: Math.ceil(span / 7) }, (_, i) => addDaysIso(min, i * 7));
  const rows = [...p.tasks].sort((a, b) => (a.startOn ?? a.dueOn ?? '9999').localeCompare(b.startOn ?? b.dueOn ?? '9999'));
  return (
    <section className="card p-4">
      <p className="mb-3 text-sm text-muted">Cada barra vai do início ao prazo da tarefa. Losangos são marcos; a linha vertical é hoje.</p>
      <div className="scroll-thin overflow-x-auto">
        <div className="relative" style={{ width: 260 + span * W }}>
          <div className="flex border-b border-line text-xs text-muted" style={{ paddingLeft: 260 }}>
            {weeks.map((w) => <div key={w} className="num shrink-0 border-l border-line px-1 py-1" style={{ width: 7 * W }}>{fmtDate(w).slice(0, 5)}</div>)}
          </div>
          <div className="relative h-8 border-b border-line" style={{ marginLeft: 260 }}>
            {p.milestones.filter((m) => m.dueOn).map((m) => (
              <span key={m.id} title={`${m.name} · ${fmtDate(m.dueOn)}`} className={clsx('absolute top-1.5', m.completedAt ? 'text-success' : m.dueOn! < today ? 'text-danger' : 'text-purple')} style={{ left: dayN(m.dueOn!) * W + W / 2 - 8 }}><Diamond className="h-4 w-4 fill-current" aria-label={`Marco ${m.name}`} /></span>
            ))}
          </div>
          {rows.map((t) => {
            const a = t.startOn ?? t.dueOn; const b = t.dueOn ?? t.startOn;
            return (
              <div key={t.id} className="flex h-9 items-center border-b border-line/60">
                <button type="button" onClick={() => onOpen(t)} className={clsx('w-[260px] shrink-0 truncate pr-3 text-left text-sm hover:underline', t.completedAt ? 'text-muted line-through' : 'text-ink')}>{t.title}</button>
                <div className="relative h-full flex-1">
                  {a && b && <span className={clsx('absolute top-2 h-5 rounded-sm', t.completedAt ? 'bg-success/60' : isLate(t) ? 'bg-danger/70' : 'bg-primary/70')} style={{ left: dayN(a) * W, width: Math.max(W, (dayN(b) - dayN(a) + 1) * W) }} title={`${fmtDate(a)} → ${fmtDate(b)} · ${t.ownerName}`} />}
                </div>
              </div>
            );
          })}
          {today >= min && today <= max && <span className="pointer-events-none absolute bottom-0 top-0 w-px bg-danger" style={{ left: 260 + dayN(today) * W + W / 2 }} aria-hidden />}
        </div>
      </div>
    </section>
  );
}

function TaskDialog({ p, task, onClose }: { p: ProjectDetail; task: Task | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const { me } = useAuth();
  const editing = task && task !== 'new' ? task : null;
  const assignable = [{ userId: p.ownerId, name: p.ownerName ?? '' }, ...p.members.filter((m) => m.role !== 'observador' && m.userId !== p.ownerId)];
  const blank = { title: '', notes: '', stageId: p.stages.find((s) => !s.done)?.id ?? '', milestoneId: '', ownerId: assignable.some((a) => a.userId === me?.user.id) ? me!.user.id : p.ownerId, startOn: '', dueOn: '', priority: 'media' as Task['priority'] };
  const [f, setF] = useState(blank);
  const [key, setKey] = useState<string | null>(null);
  const k = editing ? editing.id : task === 'new' ? 'new' : null;
  if (k !== key) {
    setKey(k);
    setF(editing ? { title: editing.title, notes: editing.notes ?? '', stageId: editing.stageId ?? '', milestoneId: editing.milestoneId ?? '', ownerId: editing.ownerId, startOn: editing.startOn ?? '', dueOn: editing.dueOn ?? '', priority: editing.priority } : blank);
  }
  const body = () => ({ title: f.title, notes: f.notes || null, stageId: f.stageId || undefined, milestoneId: f.milestoneId || null, ownerId: f.ownerId, startOn: f.startOn || null, dueOn: f.dueOn || null, priority: f.priority });
  const save = useMutation({
    mutationFn: () => (editing ? api(`/projects/${p.id}/tasks/${editing.id}`, { method: 'PATCH', body: { ...body(), stageId: f.stageId !== editing.stageId ? f.stageId : undefined, rowVersion: editing.rowVersion } }) : api(`/projects/${p.id}/tasks`, { method: 'POST', body: body() })),
    onSuccess: () => { refresh(); onClose(); toast({ tone: 'success', message: editing ? 'Tarefa salva' : 'Tarefa criada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/projects/${p.id}/tasks/${editing!.id}`, { method: 'PATCH', body: { rowVersion: editing!.rowVersion, remove: true } }),
    onSuccess: () => { refresh(); onClose(); toast({ tone: 'success', message: 'Tarefa removida' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ro = !p.can.work;
  return (
    <Modal open={!!task} onClose={onClose} title={editing ? 'Tarefa do projeto' : 'Nova tarefa'} size="lg"
      footer={<>
        {editing && p.can.work && <Button variant="danger" className="mr-auto" loading={remove.isPending} onClick={() => remove.mutate()}>Remover</Button>}
        <Button variant="secondary" onClick={onClose}>{ro ? 'Fechar' : 'Cancelar'}</Button>
        {!ro && <Button variant="primary" disabled={f.title.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>{editing ? 'Salvar' : 'Criar tarefa'}</Button>}
      </>}>
      <fieldset disabled={ro} className="space-y-4">
        <FormField label="Título" htmlFor="tk-title" required><Input id="tk-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Etapa" htmlFor="tk-stage"><Select id="tk-stage" value={f.stageId} onChange={(e) => setF({ ...f, stageId: e.target.value })}>{p.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></FormField>
          <FormField label="Marco" htmlFor="tk-ms"><Select id="tk-ms" value={f.milestoneId} onChange={(e) => setF({ ...f, milestoneId: e.target.value })}><option value="">Nenhum</option>{p.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></FormField>
          <FormField label="Responsável" htmlFor="tk-owner" hint="Só quem está na equipe (exceto observadores)"><Select id="tk-owner" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{assignable.map((a) => <option key={a.userId} value={a.userId}>{a.name}</option>)}</Select></FormField>
          <FormField label="Prioridade" htmlFor="tk-prio"><Select id="tk-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Task['priority'] })}>{Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          <FormField label="Início" htmlFor="tk-start"><Input id="tk-start" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></FormField>
          <FormField label="Prazo" htmlFor="tk-due" hint="Aparece na agenda do responsável"><Input id="tk-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
        </div>
        <FormField label="Descrição" htmlFor="tk-notes"><Textarea id="tk-notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
        {editing?.completedAt && <p className="text-sm text-muted">Concluída em {fmtDateTime(editing.completedAt)}.</p>}
      </fieldset>
    </Modal>
  );
}

// ------------------------------------------------------------------ marcos, equipe, histórico
function Milestones({ p }: { p: ProjectDetail }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const [edit, setEdit] = useState<Milestone | 'new' | null>(null);
  const [f, setF] = useState({ name: '', dueOn: '', notes: '' });
  const openEdit = (m: Milestone | 'new') => { setEdit(m); setF(m === 'new' ? { name: '', dueOn: '', notes: '' } : { name: m.name, dueOn: m.dueOn ?? '', notes: m.notes ?? '' }); };
  const mut = useMutation({
    mutationFn: ({ m, body }: { m: Milestone | 'new'; body: Record<string, unknown> }) => (m === 'new' ? api(`/projects/${p.id}/milestones`, { method: 'POST', body }) : api(`/projects/${p.id}/milestones/${m.id}`, { method: 'PATCH', body })),
    onSuccess: () => { refresh(); setEdit(null); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const today = todayIso();
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <div><h2 className="text-lg font-bold text-ink">Marcos</h2><p className="text-sm text-muted">Entregas que marcam o avanço. Um marco só é atingido quando as tarefas ligadas a ele estão concluídas.</p></div>
        {p.can.manage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openEdit('new')}>Novo marco</Button>}
      </div>
      {!p.milestones.length ? <div className="border-t border-line"><EmptyState title="Nenhum marco" /></div> : (
        <ul className="divide-y divide-line border-t border-line">
          {p.milestones.map((m) => {
            const tasks = p.tasks.filter((t) => t.milestoneId === m.id);
            const done = tasks.filter((t) => t.completedAt).length;
            const late = !m.completedAt && m.dueOn && m.dueOn < today;
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Diamond className={clsx('h-5 w-5 shrink-0 fill-current', m.completedAt ? 'text-success' : late ? 'text-danger' : 'text-purple')} aria-hidden />
                <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{m.name}</p><p className="text-xs text-muted">{done} de {tasks.length} tarefa(s) concluída(s){m.notes ? ` · ${m.notes}` : ''}</p></div>
                <span className={clsx('num text-sm', late ? 'font-semibold text-danger' : 'text-ink')}><CalendarDays className="mr-1 inline h-4 w-4" aria-hidden />{m.dueOn ? fmtDate(m.dueOn) : 'sem data'}</span>
                {m.completedAt ? <Chip tone="green">Atingido em {fmtDate(m.completedAt)}</Chip> : late ? <Chip tone="red">Vencido</Chip> : <Chip tone="neutral">Em aberto</Chip>}
                {p.can.manage && (
                  <span className="flex gap-1.5">
                    <Button size="sm" variant={m.completedAt ? 'secondary' : 'primary'} loading={mut.isPending && mut.variables?.m === m} onClick={() => mut.mutate({ m, body: { completed: !m.completedAt } })}>{m.completedAt ? 'Reabrir' : 'Marcar atingido'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(m)}>Editar</Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Novo marco' : 'Editar marco'}
        footer={<>
          {edit && edit !== 'new' && <Button variant="danger" className="mr-auto" onClick={() => mut.mutate({ m: edit, body: { remove: true } })}>Remover</Button>}
          <Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button>
          <Button variant="primary" disabled={f.name.trim().length < 2} loading={mut.isPending} onClick={() => edit && mut.mutate({ m: edit, body: { name: f.name, dueOn: f.dueOn || null, notes: f.notes || null } })}>Salvar</Button>
        </>}>
        <div className="space-y-4">
          <FormField label="Nome" htmlFor="ms-name" required><Input id="ms-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <FormField label="Data prevista" htmlFor="ms-due"><Input id="ms-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
          <FormField label="Observação" htmlFor="ms-notes"><Textarea id="ms-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
          {edit && edit !== 'new' && <p className="text-xs text-muted">Remover o marco mantém as tarefas, só desfaz a ligação.</p>}
        </div>
      </Modal>
    </section>
  );
}

function Team({ p }: { p: ProjectDetail }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const users = useLookups().data?.users ?? [];
  const [list, setList] = useState<{ userId: string; role: ProjectMemberRole }[] | null>(null);
  const [add, setAdd] = useState('');
  const cur = list ?? p.members.map((m) => ({ userId: m.userId, role: m.role }));
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? p.members.find((m) => m.userId === id)?.name ?? '—';
  const save = useMutation({
    mutationFn: () => api(`/projects/${p.id}/members`, { method: 'PUT', body: { members: cur } }),
    onSuccess: () => { refresh(); setList(null); toast({ tone: 'success', message: 'Equipe salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const open = (id: string) => p.tasks.filter((t) => t.ownerId === id && !t.completedAt).length;
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Equipe</h2>
      <p className="mb-4 text-sm text-muted">Gerentes editam o projeto; membros criam e movem tarefas; observadores acompanham. Quem é responsável pelo projeto é sempre gerente.</p>
      <ul className="divide-y divide-line">
        {cur.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center gap-3 py-2.5">
            <Avatar name={name(m.userId)} size={32} />
            <span className="min-w-[160px] flex-1 font-semibold text-ink">{name(m.userId)}</span>
            <span className="num text-xs text-muted">{open(m.userId)} tarefa(s) em aberto</span>
            {p.can.manage && m.userId !== p.ownerId ? (
              <>
                <Select aria-label={`Papel de ${name(m.userId)}`} className="w-auto" value={m.role} onChange={(e) => setList(cur.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as ProjectMemberRole } : x)))}>{PROJECT_MEMBER_ROLES.map((r) => <option key={r} value={r}>{PROJECT_MEMBER_ROLE_LABELS[r]}</option>)}</Select>
                <button type="button" className="rounded p-1.5 text-muted hover:text-danger" aria-label={`Tirar ${name(m.userId)} da equipe`} onClick={() => setList(cur.filter((x) => x.userId !== m.userId))}><Trash2 className="h-4 w-4" /></button>
              </>
            ) : <Chip tone={m.role === 'gerente' ? 'blue' : 'neutral'}>{PROJECT_MEMBER_ROLE_LABELS[m.role]}</Chip>}
          </li>
        ))}
      </ul>
      {p.can.manage && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select aria-label="Pessoa para a equipe" className="w-auto min-w-[220px]" value={add} onChange={(e) => setAdd(e.target.value)}><option value="">Adicionar pessoa</option>{users.filter((u) => !cur.some((c) => c.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <Button variant="secondary" disabled={!add} onClick={() => { setList([...cur, { userId: add, role: 'membro' }]); setAdd(''); }}>Adicionar</Button>
          {list && <Button variant="primary" className="ml-auto" loading={save.isPending} onClick={() => save.mutate()}>Salvar equipe</Button>}
        </div>
      )}
    </section>
  );
}

function History({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['project', id, 'events'], queryFn: () => api<{ items: { id: string; summary: string; occurredAt: string; actorName: string | null }[] }>(`/projects/${id}/events`) });
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Histórico</h2>
      {q.isLoading ? <LoadingRows rows={4} /> : !q.data?.items.length ? <p className="text-sm text-muted">Sem eventos.</p> : (
        <ol className="space-y-3 border-l-2 border-line pl-4">
          {q.data.items.map((e) => <li key={e.id} className="relative"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden /><p className="text-sm text-ink">{e.summary}</p><p className="text-xs text-muted">{e.actorName ?? 'Sistema'} · {fmtDateTime(e.occurredAt)}</p></li>)}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ diálogos do projeto
function EditProject({ p, open, onClose }: { p: ProjectDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const users = useLookups().data?.users ?? [];
  const init = () => ({ name: p.name, description: p.description ?? '', kind: p.kind, priority: p.priority, startOn: p.startOn, dueOn: p.dueOn ?? '', ownerId: p.ownerId });
  const [f, setF] = useState(init);
  const [was, setWas] = useState(false);
  if (open !== was) { setWas(open); if (open) setF(init()); }
  const m = useMutation({
    mutationFn: () => api(`/projects/${p.id}`, { method: 'PATCH', body: { rowVersion: p.rowVersion, ...f, description: f.description || null, dueOn: f.dueOn || null } }),
    onSuccess: () => { refresh(); onClose(); toast({ tone: 'success', message: 'Projeto salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Editar projeto" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.name.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Salvar</Button></>}>
      <div className="space-y-4">
        <FormField label="Nome" htmlFor="ep-name" required><Input id="ep-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Tipo" htmlFor="ep-kind"><Select id="ep-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ProjectKind })}>{PROJECT_KINDS.map((k) => <option key={k} value={k}>{PROJECT_KIND_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Prioridade" htmlFor="ep-prio"><Select id="ep-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}>{Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          <FormField label="Início" htmlFor="ep-start"><Input id="ep-start" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></FormField>
          <FormField label="Prazo final" htmlFor="ep-due"><Input id="ep-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
          <FormField label="Responsável" htmlFor="ep-owner" hint="Entra na equipe como gerente"><Select id="ep-owner" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        </div>
        <FormField label="Descrição" htmlFor="ep-desc"><Textarea id="ep-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function StatusDialog({ p, open, onClose }: { p: ProjectDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const options = PROJECT_TRANSITIONS[p.status];
  const [to, setTo] = useState<ProjectStatus | ''>('');
  const [reason, setReason] = useState('');
  const needsReason = ['concluido', 'cancelado'].includes(p.status) || to === 'cancelado';
  const openTasks = p.tasks.filter((t) => !t.completedAt).length;
  const m = useMutation({
    mutationFn: () => api(`/projects/${p.id}`, { method: 'PATCH', body: { rowVersion: p.rowVersion, status: to, reason: reason || undefined } }),
    onSuccess: () => { refresh(); onClose(); setTo(''); setReason(''); toast({ tone: 'success', message: 'Situação atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Mudar situação" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!to || (needsReason && reason.trim().length < 5)} loading={m.isPending} onClick={() => m.mutate()}>Confirmar</Button></>}>
      <div className="space-y-4">
        <p className="text-sm">Agora: <span className="font-semibold text-ink">{PROJECT_STATUS_LABELS[p.status]}</span></p>
        <FormField label="Nova situação" htmlFor="st-to"><Select id="st-to" value={to} onChange={(e) => setTo(e.target.value as ProjectStatus)}><option value="">Escolha</option>{options.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}</Select></FormField>
        {to === 'concluido' && openTasks > 0 && <Notice tone="warning">{openTasks} tarefa(s) ainda em aberto. Elas continuam na agenda dos responsáveis.</Notice>}
        {needsReason && <FormField label="Motivo" htmlFor="st-reason" required hint="Mínimo 5 caracteres; fica no histórico"><Textarea id="st-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>}
      </div>
    </Modal>
  );
}

function StagesDialog({ p, open, onClose }: { p: ProjectDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  type Row = { id?: string; name: string; done: boolean; wipLimit: string };
  const init = (): Row[] => p.stages.map((s) => ({ id: s.id, name: s.name, done: s.done, wipLimit: s.wipLimit ? String(s.wipLimit) : '' }));
  const [rows, setRows] = useState<Row[]>(init);
  const [moveTo, setMoveTo] = useState<Record<string, number>>({});
  const [was, setWas] = useState(false);
  if (open !== was) { setWas(open); if (open) { setRows(init()); setMoveTo({}); } }
  const removed = p.stages.filter((s) => !rows.some((r) => r.id === s.id));
  const count = (id: string) => p.tasks.filter((t) => t.stageId === id).length;
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const swap = (i: number, j: number) => { const n = [...rows]; [n[i], n[j]] = [n[j]!, n[i]!]; setRows(n); };
  const m = useMutation({
    mutationFn: () => api(`/projects/${p.id}/stages`, { method: 'PUT', body: { stages: rows.map((r) => ({ id: r.id, name: r.name, done: r.done, wipLimit: r.wipLimit ? Number(r.wipLimit) : null })), moveTo } }),
    onSuccess: () => { refresh(); onClose(); toast({ tone: 'success', message: 'Etapas salvas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const pending = removed.some((s) => count(s.id) > 0 && moveTo[s.id] === undefined);
  return (
    <Modal open={open} onClose={onClose} title="Etapas do quadro" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!rows.length || rows.some((r) => !r.name.trim()) || !rows.some((r) => r.done) || pending} loading={m.isPending} onClick={() => m.mutate()}>Salvar etapas</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Tarefas que entram numa etapa marcada como concluída ficam concluídas. O limite avisa quando a coluna enche.</p>
        {rows.map((r, i) => (
          <div key={r.id ?? `n${i}`} className="flex flex-wrap items-center gap-2">
            <span className="flex flex-col"><button type="button" className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} aria-label={`Subir ${r.name}`} onClick={() => swap(i, i - 1)}><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30" disabled={i === rows.length - 1} aria-label={`Descer ${r.name}`} onClick={() => swap(i, i + 1)}><ArrowDown className="h-3.5 w-3.5" /></button></span>
            <Input aria-label={`Nome da etapa ${i + 1}`} className="w-auto flex-1" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={r.done} onChange={(e) => set(i, { done: e.target.checked })} />Concluída</label>
            <Input aria-label={`Limite da etapa ${i + 1}`} className="w-24" inputMode="numeric" placeholder="Limite" value={r.wipLimit} onChange={(e) => set(i, { wipLimit: e.target.value.replace(/\D/g, '') })} />
            <button type="button" className="rounded p-1.5 text-muted hover:text-danger disabled:opacity-30" disabled={rows.length === 1} aria-label={`Remover etapa ${r.name}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <Button variant="secondary" size="sm" disabled={rows.length >= 12} onClick={() => setRows([...rows, { name: '', done: false, wipLimit: '' }])}>Adicionar etapa</Button>
        {removed.filter((s) => count(s.id) > 0).map((s) => (
          <FormField key={s.id} label={`"${s.name}" tem ${count(s.id)} tarefa(s). Para onde vão?`} htmlFor={`mv-${s.id}`}>
            <Select id={`mv-${s.id}`} value={moveTo[s.id] ?? ''} onChange={(e) => setMoveTo({ ...moveTo, [s.id]: Number(e.target.value) })}><option value="">Escolha</option>{rows.map((r, i) => <option key={i} value={i}>{r.name || `Etapa ${i + 1}`}</option>)}</Select>
          </FormField>
        ))}
      </div>
    </Modal>
  );
}

function TemplateDialog({ p, open, onClose }: { p: ProjectDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const m = useMutation({
    mutationFn: () => api('/project-templates', { method: 'POST', body: { name, kind: p.kind, description: p.description, fromProjectId: p.id } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['project-templates'] }); onClose(); setName(''); toast({ tone: 'success', message: 'Modelo salvo. Ele aparece ao criar um novo projeto.' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Salvar como modelo" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={name.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Salvar modelo</Button></>}>
      <div className="space-y-4">
        <p className="text-sm">Etapas, marcos e tarefas deste projeto viram um modelo. As datas passam a contar em dias a partir do início ({fmtDate(p.startOn)}).</p>
        <FormField label="Nome do modelo" htmlFor="tp-name" required><Input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}
