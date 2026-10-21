/** Tarefas: Minhas tarefas, Equipe, Quadro, Calendário e Lista — os mesmos registros, visões diferentes. */
import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ListChecks, Plus } from 'lucide-react';
import { MY_TASK_BUCKETS, MY_TASK_BUCKET_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, addDaysIso, type MyTaskBucket, type TaskStatus } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useLookups, useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Tabs } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { NewTaskDialog, PRIO_LABEL, PRIO_TONE, STATUS_TONE, TaskLine, TaskStatusChip, useInvalidateTasks, type TaskItem, type TaskList } from '../../features/tasks/shared';
import { TaskDrawer } from '../../features/tasks/TaskDrawer';

type View = 'minhas' | 'equipe' | 'quadro' | 'calendario' | 'lista';
type GroupBy = 'responsavel' | 'projeto' | 'prazo' | 'prioridade' | 'situacao';
const todayLocal = () => new Date().toLocaleDateString('en-CA');
const OPEN_BUCKETS: MyTaskBucket[] = ['atrasadas', 'hoje', 'proximas', 'sem_prazo', 'aguardando', 'delegadas'];

export function TasksPage() {
  const { can } = useAuth();
  const team = can('atividades', 'equipe');
  const [u, setU] = useUrlState({ v: 'minhas', b: '', q: '', owner: '', prio: '', tag: '', task: '', done: '' });
  const [creating, setCreating] = useState(false);
  const view = u.v as View;
  const apiView = view === 'minhas' ? 'minhas' : view === 'equipe' ? 'equipe' : 'todas';
  const q = useQuery({
    queryKey: ['tasks', 'page', apiView, u.q, u.owner, u.prio, u.tag, u.done],
    placeholderData: keepPreviousData,
    queryFn: () => api<TaskList>(`/tasks${qs({ view: apiView, q: u.q || undefined, ownerId: u.owner || undefined, priority: u.prio || undefined, tag: u.tag || undefined, includeDone: u.done ? 'true' : undefined })}`),
  });
  const open = (id: string) => setU({ task: id }, { resetPage: false });
  const tabs: { key: View; label: string }[] = [{ key: 'minhas', label: 'Minhas tarefas' }, ...(team ? [{ key: 'equipe' as View, label: 'Equipe' }] : []), { key: 'quadro', label: 'Quadro' }, { key: 'calendario', label: 'Calendário' }, { key: 'lista', label: 'Lista' }];
  return (
    <div>
      <PageHeader icon={<ListChecks />} title="Tarefas" subtitle="Avulsas ou ligadas a clientes, negociações, contratos, atas e projetos. Uma tarefa, várias visões." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova tarefa</Button>} />
      <Tabs label="Visões de tarefas" value={view} onChange={(v) => setU({ v, b: '' })} tabs={tabs} className="mb-4" />
      <Filters u={u} setU={setU} data={q.data} showOwner={view !== 'minhas'} showDone={view !== 'minhas' && view !== 'calendario'} />
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          {view === 'minhas' && <Mine data={q.data!} bucket={u.b as MyTaskBucket | ''} setBucket={(b) => setU({ b }, { resetPage: false })} onOpen={open} />}
          {view === 'equipe' && <Team items={q.data!.items} onOpen={open} />}
          {view === 'quadro' && <Board items={q.data!.items} onOpen={open} />}
          {view === 'calendario' && <Calendar items={q.data!.items} onOpen={open} />}
          {view === 'lista' && <ListView items={q.data!.items} onOpen={open} />}
        </>
      )}
      <NewTaskDialog open={creating} onClose={() => setCreating(false)} onCreated={open} />
      <TaskDrawer id={u.task || null} onClose={() => setU({ task: '' }, { resetPage: false })} onOpen={open} />
    </div>
  );
}

type U = { v: string; b: string; q: string; owner: string; prio: string; tag: string; task: string; done: string };
function Filters({ u, setU, data, showOwner, showDone }: { u: U; setU: (p: Partial<U>, o?: { resetPage?: boolean }) => void; data?: TaskList; showOwner: boolean; showDone: boolean }) {
  const users = useLookups().data?.users ?? [];
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <FormField label="Buscar" htmlFor="tk-q"><Input id="tk-q" className="w-60" value={u.q} onChange={(e) => setU({ q: e.target.value })} placeholder="Tarefa, cliente ou projeto" /></FormField>
      {showOwner && <FormField label="Responsável" htmlFor="tk-owner"><Select id="tk-owner" value={u.owner} onChange={(e) => setU({ owner: e.target.value })}><option value="">Todos</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>}
      <FormField label="Prioridade" htmlFor="tk-prio"><Select id="tk-prio" value={u.prio} onChange={(e) => setU({ prio: e.target.value })}><option value="">Todas</option>{Object.entries(PRIO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
      <FormField label="Etiqueta" htmlFor="tk-tag"><Select id="tk-tag" value={u.tag} onChange={(e) => setU({ tag: e.target.value })}><option value="">Todas</option>{(data?.tags ?? (u.tag ? [u.tag] : [])).map((t) => <option key={t} value={t}>#{t}</option>)}</Select></FormField>
      {showDone && <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!u.done} onChange={(e) => setU({ done: e.target.checked ? '1' : '' })} />Incluir concluídas</label>}
    </div>
  );
}

// ------------------------------------------------------------------ Minhas tarefas
function QuickAdd() {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<'hoje' | 'amanha' | 'sem'>('hoje');
  const m = useMutation({
    mutationFn: () => api('/tasks', { method: 'POST', body: { title: title.trim(), dueOn: when === 'sem' ? null : when === 'hoje' ? todayLocal() : addDaysIso(todayLocal(), 1) } }),
    onSuccess: () => { invalidate(); setTitle(''); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <form className="card mb-4 flex flex-wrap items-center gap-2 p-3" onSubmit={(e) => { e.preventDefault(); if (title.trim().length >= 2) m.mutate(); }}>
      <Input aria-label="Tarefa rápida" className="min-w-[220px] flex-1" placeholder="Adicionar tarefa rápida e apertar Enter" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Select aria-label="Para quando" className="w-auto" value={when} onChange={(e) => setWhen(e.target.value as typeof when)}><option value="hoje">Hoje</option><option value="amanha">Amanhã</option><option value="sem">Sem prazo</option></Select>
      <Button type="submit" variant="secondary" disabled={title.trim().length < 2} loading={m.isPending}>Adicionar</Button>
    </form>
  );
}

function Mine({ data, bucket, setBucket, onOpen }: { data: TaskList; bucket: MyTaskBucket | ''; setBucket: (b: MyTaskBucket | '') => void; onOpen: (id: string) => void }) {
  const by = (b: MyTaskBucket) => data.items.filter((t) => t.bucket === b);
  const shown = bucket ? [bucket] : OPEN_BUCKETS;
  const openCount = OPEN_BUCKETS.reduce((a, b) => a + (data.counts[b] ?? 0), 0);
  return (
    <div>
      <QuickAdd />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Grupos">
        <Pill on={!bucket} onClick={() => setBucket('')}>Em aberto <span className="num">{openCount}</span></Pill>
        {MY_TASK_BUCKETS.map((b) => <Pill key={b} on={bucket === b} tone={b === 'atrasadas' && (data.counts[b] ?? 0) > 0 ? 'danger' : undefined} onClick={() => setBucket(b)}>{MY_TASK_BUCKET_LABELS[b]} <span className="num">{data.counts[b] ?? 0}</span></Pill>)}
      </div>
      {shown.every((b) => !by(b).length) ? <section className="card"><EmptyState title={bucket ? `Nada em ${MY_TASK_BUCKET_LABELS[bucket]}` : 'Tudo em dia'} description="Crie uma tarefa rápida acima ou peça uma tarefa a alguém em Nova tarefa." /></section> : (
        <div className="space-y-4">
          {shown.filter((b) => by(b).length).map((b) => (
            <section key={b} className="card px-5 py-3" aria-label={MY_TASK_BUCKET_LABELS[b]}>
              <h2 className={clsx('mb-1 flex items-center gap-2 text-md font-bold', b === 'atrasadas' ? 'text-danger' : 'text-ink')}>{MY_TASK_BUCKET_LABELS[b]} <span className="num text-sm font-normal text-muted">{by(b).length}</span></h2>
              <ul className="divide-y divide-line">{by(b).map((t) => <TaskLine key={t.id} t={t} onOpen={onOpen} showOwner={b === 'delegadas'} />)}</ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
const Pill = ({ on, onClick, children, tone }: { on: boolean; onClick: () => void; children: ReactNode; tone?: 'danger' }) => (
  <button type="button" aria-pressed={on} onClick={onClick} className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold', on ? 'border-primary bg-primary text-white' : tone === 'danger' ? 'border-danger/40 bg-danger-soft text-danger' : 'border-line bg-surface text-ink hover:bg-surface-2')}>{children}</button>
);

// ------------------------------------------------------------------ Equipe
const GROUP_LABELS: Record<GroupBy, string> = { responsavel: 'Responsável', projeto: 'Projeto', prazo: 'Prazo', prioridade: 'Prioridade', situacao: 'Situação' };
function groupKey(t: TaskItem, g: GroupBy, today: string): [string, string] {
  if (g === 'responsavel') return [t.ownerId, t.ownerName];
  if (g === 'projeto') return [t.projectId ?? '-', t.projectName ?? 'Sem projeto'];
  if (g === 'prioridade') return [String(['alta', 'media', 'baixa'].indexOf(t.priority)), PRIO_LABEL[t.priority]];
  if (g === 'situacao') return [String(TASK_STATUSES.indexOf(t.status)), TASK_STATUS_LABELS[t.status]];
  if (!t.dueOn) return ['4', 'Sem prazo'];
  if (t.overdue) return ['0', 'Atrasadas'];
  if (t.dueOn === today) return ['1', 'Hoje'];
  if (t.dueOn <= addDaysIso(today, 7)) return ['2', 'Próximos 7 dias'];
  return ['3', 'Mais adiante'];
}
function grouped(items: TaskItem[], g: GroupBy) {
  const today = todayLocal();
  const map = new Map<string, { label: string; items: TaskItem[] }>();
  for (const t of items) { const [k, label] = groupKey(t, g, today); map.set(k, { label, items: [...(map.get(k)?.items ?? []), t] }); }
  return [...map.entries()].sort(([a, x], [b, y]) => (g === 'responsavel' || g === 'projeto' ? x.label.localeCompare(y.label) : a.localeCompare(b))).map(([k, v]) => ({ key: k, ...v }));
}
function Team({ items, onOpen }: { items: TaskItem[]; onOpen: (id: string) => void }) {
  const [g, setG] = useState<GroupBy>('responsavel');
  const groups = useMemo(() => grouped(items, g), [items, g]);
  return (
    <div>
      <div className="mb-3 flex items-end gap-3"><FormField label="Agrupar por" htmlFor="tm-group"><Select id="tm-group" value={g} onChange={(e) => setG(e.target.value as GroupBy)}>{Object.entries(GROUP_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField></div>
      {!groups.length ? <section className="card"><EmptyState title="Nenhuma tarefa em aberto na equipe" /></section> : (
        <div className="space-y-4">
          {groups.map((gr) => {
            const late = gr.items.filter((t) => t.overdue).length;
            return (
              <section key={gr.key} className="card px-5 py-3" aria-label={gr.label}>
                <h2 className="mb-1 flex flex-wrap items-center gap-2 text-md font-bold text-ink">{g === 'responsavel' && <Avatar name={gr.label} size={26} />}{gr.label}<span className="num text-sm font-normal text-muted">{gr.items.length} tarefa(s){late ? ` · ${late} atrasada(s)` : ''}</span></h2>
                <ul className="divide-y divide-line">{gr.items.map((t) => <TaskLine key={t.id} t={t} onOpen={onOpen} showOwner={g !== 'responsavel'} />)}</ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Quadro
type Cols = 'situacao' | 'prioridade' | 'responsavel';
function Board({ items, onOpen }: { items: TaskItem[]; onOpen: (id: string) => void }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const users = useLookups().data?.users ?? [];
  const [cols, setCols] = useState<Cols>('situacao');
  const [over, setOver] = useState<string | null>(null);
  const columns: { key: string; label: string; droppable: boolean; match: (t: TaskItem) => boolean; body: (t: TaskItem) => Record<string, unknown> }[] =
    cols === 'situacao' ? TASK_STATUSES.map((s) => ({ key: s, label: TASK_STATUS_LABELS[s], droppable: s !== 'em_aprovacao', match: (t) => t.status === s, body: () => ({ status: s }) }))
    : cols === 'prioridade' ? (['alta', 'media', 'baixa'] as const).map((p) => ({ key: p, label: PRIO_LABEL[p], droppable: true, match: (t) => t.priority === p, body: () => ({ priority: p }) }))
    : [...new Set(items.map((t) => t.ownerId))].map((id) => ({ key: id, label: items.find((t) => t.ownerId === id)?.ownerName ?? users.find((x) => x.id === id)?.name ?? '—', droppable: true, match: (t) => t.ownerId === id, body: () => ({ ownerId: id }) }));
  const move = useMutation({
    mutationFn: ({ t, body }: { t: TaskItem; body: Record<string, unknown> }) => api<{ status: string }>(`/tasks/${t.id}`, { method: 'PATCH', body: { rowVersion: t.rowVersion, ...body } }),
    onSuccess: (r, v) => { invalidate(); if (v.body.status === 'concluida' && r.status === 'em_aprovacao') toast({ tone: 'success', message: 'Entrega enviada para aprovação' }); },
    onError: (e) => { invalidate(); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const drop = (e: DragEvent, c: (typeof columns)[number]) => {
    e.preventDefault(); setOver(null);
    const t = items.find((x) => x.id === e.dataTransfer.getData('text/task'));
    if (t && c.droppable && !c.match(t)) move.mutate({ t, body: c.body(t) });
  };
  return (
    <div>
      <div className="mb-3 flex items-end gap-3"><FormField label="Colunas" htmlFor="bd-cols"><Select id="bd-cols" value={cols} onChange={(e) => setCols(e.target.value as Cols)}><option value="situacao">Por situação</option><option value="prioridade">Por prioridade</option><option value="responsavel">Por responsável</option></Select></FormField><p className="pb-2 text-sm text-muted">Arraste o cartão para mudar {cols === 'situacao' ? 'a situação' : cols === 'prioridade' ? 'a prioridade' : 'o responsável'}.</p></div>
      <div className="scroll-thin flex gap-3 overflow-x-auto pb-2">
        {columns.map((c) => {
          const list = items.filter(c.match);
          return (
            <section key={c.key} aria-label={`Coluna ${c.label}`} className={clsx('flex w-72 shrink-0 flex-col rounded-lg bg-surface-2 p-2', over === c.key && 'ring-2 ring-primary')}
              onDragOver={(e) => { if (c.droppable) { e.preventDefault(); setOver(c.key); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, c)}>
              <h2 className="flex items-center justify-between px-1.5 py-1 text-sm font-bold text-ink">{c.label}<span className="num text-xs text-muted">{list.length}</span></h2>
              <ul className="mt-1 flex min-h-[80px] flex-col gap-2">
                {list.map((t) => (
                  <li key={t.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/task', t.id); e.dataTransfer.effectAllowed = 'move'; }} className={clsx('cursor-grab rounded-md border bg-surface p-3 shadow-sm active:cursor-grabbing', t.overdue ? 'border-danger/50' : 'border-line')}>
                    <button type="button" className="block w-full text-left" onClick={() => onOpen(t.id)}>
                      <span className={clsx('block text-sm font-semibold', t.completedAt ? 'text-muted line-through' : 'text-ink')}>{t.title}</span>
                      <span className="mt-1 flex flex-wrap gap-1">{cols !== 'situacao' && <TaskStatusChip s={t.status} />}{cols !== 'prioridade' && <Chip tone={PRIO_TONE[t.priority]}>{PRIO_LABEL[t.priority]}</Chip>}{t.blockedBy > 0 && <Chip tone="orange">Bloqueada</Chip>}</span>
                      <span className="mt-2 flex items-center justify-between text-xs text-muted"><span className="flex items-center gap-1.5"><Avatar name={t.ownerName} size={20} />{t.ownerName.split(' ')[0]}</span><span className={clsx('num', t.overdue && 'font-semibold text-danger')}>{t.dueOn ? fmtDate(t.dueOn) : 'sem prazo'}</span></span>
                    </button>
                  </li>
                ))}
                {!list.length && <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-muted">{c.droppable ? 'Arraste tarefas para cá' : 'Entra aqui ao concluir uma tarefa que exige aprovação'}</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Calendário
type CalMode = 'dia' | 'semana' | 'mes';
const WD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
function Calendar({ items, onOpen }: { items: TaskItem[]; onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<CalMode>('semana');
  const [anchor, setAnchor] = useState(todayLocal());
  const today = todayLocal();
  const monday = (iso: string) => addDaysIso(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
  const days = mode === 'dia' ? [anchor] : mode === 'semana' ? Array.from({ length: 7 }, (_, i) => addDaysIso(monday(anchor), i)) : Array.from({ length: 42 }, (_, i) => addDaysIso(monday(`${anchor.slice(0, 7)}-01`), i));
  const step = (n: number) => {
    if (mode === 'dia') setAnchor(addDaysIso(anchor, n));
    else if (mode === 'semana') setAnchor(addDaysIso(anchor, 7 * n));
    else { const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setAnchor(d.toISOString().slice(0, 10)); }
  };
  const raw = mode === 'mes' ? new Date(`${anchor}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : mode === 'semana' ? `Semana de ${fmtDate(days[0])} a ${fmtDate(days[6])}` : new Date(`${anchor}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const noDate = items.filter((t) => !t.dueOn && !t.completedAt).length;
  const cell = (d: string, big: boolean) => {
    const list = items.filter((t) => t.dueOn === d);
    return (
      <div key={d} className={clsx('border-b border-r border-line p-1.5', big ? 'min-h-[220px]' : 'min-h-[96px]', mode === 'mes' && d.slice(0, 7) !== anchor.slice(0, 7) && 'bg-surface-2/50 text-muted')}>
        <span className={clsx('num inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs', d === today && 'bg-primary font-bold text-white')}>{mode === 'mes' ? Number(d.slice(8)) : `${WD[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]} ${Number(d.slice(8))}`}</span>
        <ul className="mt-1 space-y-1">{list.map((t) => <li key={t.id}><button type="button" onClick={() => onOpen(t.id)} className={clsx('block w-full truncate rounded-sm px-1.5 py-0.5 text-left text-xs', t.completedAt ? 'bg-surface-2 text-muted line-through' : t.overdue ? 'bg-danger-soft text-danger' : t.priority === 'alta' ? 'bg-warning-soft text-[#C2610C]' : 'bg-primary-soft text-primary')} title={`${t.title} · ${t.ownerName}`}>{t.title}{mode !== 'mes' && <span className="block text-2xs opacity-80">{t.ownerName.split(' ')[0]}</span>}</button></li>)}</ul>
      </div>
    );
  };
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Período" className="flex overflow-hidden rounded-md border border-line">{(['dia', 'semana', 'mes'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={clsx('px-3 py-1.5 text-sm font-semibold', mode === m ? 'bg-primary text-white' : 'bg-surface text-ink hover:bg-surface-2')}>{m === 'dia' ? 'Dia' : m === 'semana' ? 'Semana' : 'Mês'}</button>)}</div>
          <Button size="sm" variant="secondary" aria-label="Anterior" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(today)}>Hoje</Button>
          <Button size="sm" variant="secondary" aria-label="Próximo" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      {noDate > 0 && <p className="mb-2 text-sm text-muted">{noDate} tarefa(s) em aberto sem prazo não aparecem no calendário.</p>}
      <div className="scroll-thin overflow-x-auto">
        {mode === 'dia' ? <div className="border-l border-t border-line">{cell(anchor, true)}</div> : (
          <div className={clsx('grid grid-cols-7 border-l border-t border-line', 'min-w-[760px]')}>
            {mode === 'mes' && WD.map((w) => <div key={w} className="border-b border-r border-line bg-surface-2 px-2 py-1.5 text-xs font-semibold text-muted">{w}</div>)}
            {days.map((d) => cell(d, mode === 'semana'))}
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Lista
type SortKey = 'titulo' | 'responsavel' | 'prazo' | 'prioridade' | 'situacao' | 'projeto';
function ListView({ items, onOpen }: { items: TaskItem[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'prazo', asc: true });
  const [g, setG] = useState<GroupBy | ''>('');
  const cmp = (a: TaskItem, b: TaskItem) => {
    const v = (t: TaskItem) => sort.k === 'titulo' ? t.title : sort.k === 'responsavel' ? t.ownerName : sort.k === 'prazo' ? t.dueOn ?? '9999' : sort.k === 'prioridade' ? String(['alta', 'media', 'baixa'].indexOf(t.priority)) : sort.k === 'situacao' ? String(TASK_STATUSES.indexOf(t.status)) : t.projectName ?? '~';
    return v(a).localeCompare(v(b)) * (sort.asc ? 1 : -1);
  };
  const groups = g ? grouped(items, g).map((x) => ({ ...x, items: [...x.items].sort(cmp) })) : [{ key: 'all', label: '', items: [...items].sort(cmp) }];
  const th = (k: SortKey, label: string) => <th className="px-3 py-2.5 font-medium" aria-sort={sort.k === k ? (sort.asc ? 'ascending' : 'descending') : 'none'}><button type="button" className="hover:text-ink" onClick={() => setSort({ k, asc: sort.k === k ? !sort.asc : true })}>{label}{sort.k === k ? (sort.asc ? ' ↑' : ' ↓') : ''}</button></th>;
  if (!items.length) return <section className="card"><EmptyState title="Nenhuma tarefa com esses filtros" /></section>;
  return (
    <section className="card overflow-hidden">
      <div className="flex justify-end p-3"><FormField label="Agrupar por" htmlFor="ls-group"><Select id="ls-group" value={g} onChange={(e) => setG(e.target.value as GroupBy | '')}><option value="">Sem agrupamento</option>{Object.entries(GROUP_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField></div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{th('titulo', 'Tarefa')}{th('responsavel', 'Responsável')}{th('projeto', 'Projeto / vínculo')}{th('situacao', 'Situação')}{th('prioridade', 'Prioridade')}{th('prazo', 'Prazo')}<th className="px-3 py-2.5 font-medium">Etiquetas</th></tr></thead>
          {groups.map((gr) => (
            <tbody key={gr.key}>
              {g && <tr className="border-t border-line bg-surface-2/60"><td colSpan={7} className="px-3 py-1.5 text-xs font-bold text-ink">{gr.label} <span className="num font-normal text-muted">({gr.items.length})</span></td></tr>}
              {gr.items.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-3 py-2"><button type="button" onClick={() => onOpen(t.id)} className={clsx('text-left font-semibold hover:underline', t.completedAt ? 'text-muted line-through' : 'text-primary')}>{t.title}</button>{t.subTotal > 0 && <span className="num ml-2 text-xs text-muted">{t.subDone}/{t.subTotal}</span>}</td>
                  <td className="px-3 py-2">{t.ownerName}</td>
                  <td className="px-3 py-2 text-xs">{t.links.project?.name ?? t.links.contact?.name ?? t.links.arp?.name ?? t.links.contract?.name ?? t.links.opportunity?.name ?? '—'}</td>
                  <td className="px-3 py-2"><Chip tone={STATUS_TONE[t.status]}>{TASK_STATUS_LABELS[t.status as TaskStatus]}</Chip></td>
                  <td className="px-3 py-2"><Chip tone={PRIO_TONE[t.priority]}>{PRIO_LABEL[t.priority]}</Chip></td>
                  <td className={clsx('num whitespace-nowrap px-3 py-2', t.overdue && 'font-semibold text-danger')}>{t.dueOn ? fmtDate(t.dueOn) : '—'}</td>
                  <td className="px-3 py-2 text-xs text-primary">{t.tags.map((x) => `#${x}`).join(' ')}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
