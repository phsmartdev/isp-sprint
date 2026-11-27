/**
 * Quadro de Tarefas do departamento (Comercial e Contratos, Sucesso do Cliente, Produto). Cada time tem o seu.
 * Mostra as tarefas que já existem nos módulos (sem cópia): abrir abre a mesma tarefa; mover muda a situação dela.
 * Backlog = ainda não planejada para a semana (não muda a situação). Tarefas enviadas a outro time: visão "Enviadas".
 */
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import clsx from 'clsx';
import { AlarmClock, BarChart3, Briefcase, Building2, CalendarRange, Eye, KanbanSquare, Link2, Lock, Plus, Search, ShieldCheck, Users, Zap } from 'lucide-react';
import {
  BOARD_COLUMNS, BOARD_COLUMN_LABELS, BOARD_KEYS, BOARD_LABELS, CAPACITY_CATEGORIES, CAPACITY_CATEGORY_LABELS, CAPACITY_CATEGORY_SHORT, COLUMN_STATUS, TASK_ORIGINS, TASK_ORIGIN_LABELS,
  SPRINT_STATUS_LABELS, fmtMinutes, type BoardColumn, type BoardKey, type CapacityCategory, type TaskOrigin,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar, Button, EmptyState, ErrorState, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { TaskDrawer } from '../../features/tasks/TaskDrawer';
import { CapacityModal, CloseModal, PlannerModal, usePlan, type Plan } from '../../features/boards/SprintPlanner';
import { NewTaskDialog } from '../../features/tasks/shared';
import { FuraFilaAnalysisModal, FuraFilaListModal } from '../../features/boards/FuraFila';
import { IndicatorsModal } from '../../features/boards/Indicators';
import { useAuth } from '../../auth/AuthProvider';

type Item = {
  id: string; ref: string; title: string; type: string; status: string; column: BoardColumn; rowVersion: number; ownerId: string; ownerName: string | null; priority: string;
  dueAt: string | null; dueDay: string | null; agreedDueAt: string | null; category: CapacityCategory | null; categoryAuto: boolean; estimateMinutes: number | null; remainingMinutes: number | null;
  origin: TaskOrigin; commercial: boolean; planned: boolean; blocked: boolean; waitingOn: string | null; protectedCommitment: boolean; overdue: boolean; dueToday: boolean; observers?: number; depOpen?: number; depRisk?: boolean;
  link: { kind: string; label: string; to: string; valueCents?: number | null; stage?: string | null } | null; readOnly: boolean;
};
type Data = {
  board: { key: BoardKey; label: string; teamIds: string[]; wipLimit: number; role: 'gestao' | 'lideranca' | 'colaborador' };
  week: string; today: string; policy: Record<CapacityCategory, number> & { version: number };
  kpis: { overdue: number; dueToday: number; dueSoon: number; blocked: number; uncategorized: number; withoutEstimate: number; commercialUnplanned: number; inExecution: { name: string; n: number }[];
    week: { plannedMinutes: number; doneMinutes: number; plannedCount: number; doneCount: number; distribution: Record<CapacityCategory, number> }; openDistribution: Record<CapacityCategory, number> };
  owners: { id: string; name: string }[]; items: Item[]; total: number;
};
type View = 'todas' | 'semana' | 'nao_planejadas' | 'minhas' | 'enviadas';
const VIEWS: [View, string][] = [['todas', 'Todas'], ['semana', 'Semana'], ['nao_planejadas', 'Não planejadas'], ['minhas', 'Minhas'], ['enviadas', 'Enviadas a outros times']];
const CAT_COLOR: Record<CapacityCategory, string> = { comercial: 'bg-primary text-white', interno: 'bg-[#E8EEF5] text-ink', hipotese: 'bg-[#FFF1D6] text-[#7A4B00]' };
const CAT_BAR: Record<CapacityCategory, string> = { comercial: 'bg-primary', interno: 'bg-[#8FA7C2]', hipotese: 'bg-[#E0A526]' };
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const hours = (m: number) => fmtMinutes(m) || '0h';

export function WorkBoardPage() {
  const board = useLocation().pathname.split('/')[2] ?? 'comercial';
  const key = (BOARD_KEYS as readonly string[]).includes(board) ? (board as BoardKey) : 'comercial';
  const [u, setU] = useUrlState({ view: 'todas', week: '', q: '', owner: '', origin: '', cat: '', prio: '', blocked: '', furafila: '' });
  const { me } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [modal, setModal] = useState<'planejar' | 'encerrar' | 'capacidade' | 'furafilas' | 'indicadores' | null>(null);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['quadro', key, u],
    queryFn: () => api<Data>(`/quadros/${key}${qs({ view: u.view, week: u.week || undefined, q: u.q || undefined, ownerId: u.owner || undefined, origin: u.origin || undefined, category: u.cat || undefined, priority: u.prio || undefined, blocked: u.blocked || undefined })}`),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const plan = usePlan(key, d?.week);
  const p = plan.data;
  const leads = !!d && d.board.role !== 'colaborador';
  const st = p?.sprint?.status;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink"><KanbanSquare className="h-6 w-6 text-primary" aria-hidden />Quadro do {BOARD_LABELS[key]}</h1>
          <p className="text-sm text-muted">Sprint semanal, um responsável por tarefa e observadores. No máximo {d?.board.wipLimit ?? 3} tarefas em execução por pessoa.{d && d.board.role !== 'colaborador' ? ` Você ${d.board.role === 'gestao' ? 'faz a gestão deste time' : 'lidera este time'}.` : ''}</p>
        </div>
        {d && (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Sprint" className="w-80" value={d.week} onChange={(e) => setU({ week: e.target.value === d.today ? '' : e.target.value })}>
              {(p?.weeks ?? [{ week: d.week, status: null }]).map((w) => <option key={w.week} value={w.week}>Sprint {fmtDayMonth(w.week)} a {fmtDayMonth(addDays(w.week, 4))} · {w.status ? SPRINT_STATUS_LABELS[w.status].toLowerCase() : 'não planejada'}</option>)}
            </Select>
            <Button icon={<Users className="h-4 w-4" />} onClick={() => setModal('capacidade')}>Capacidade</Button>
            <Button icon={<BarChart3 className="h-4 w-4" />} onClick={() => setModal('indicadores')}>Indicadores</Button>
            {d.board.role === 'gestao' && <Button icon={<Building2 className="h-4 w-4" />} onClick={() => nav('/quadro/gestao')}>Visão da gerência</Button>}
            {leads && p && st !== 'andamento' && st !== 'encerrada' && <Button icon={<CalendarRange className="h-4 w-4" />} onClick={() => setModal('planejar')}>Planejar Sprint</Button>}
            {leads && p && st === 'planejamento' && <Button variant="primary" onClick={() => setModal('planejar')}>Abrir Sprint</Button>}
            {leads && p && st === 'andamento' && <Button onClick={() => setModal('planejar')}>Ver o compromisso</Button>}
            {p && st === 'andamento' && <Button icon={<Zap className="h-4 w-4" />} onClick={() => setModal('furafilas')}>Fura-fila{p.furaFilaPending ? ` (${p.furaFilaPending})` : ''}</Button>}
            {leads && p && st === 'andamento' && <Button onClick={() => setModal('encerrar')}>Encerrar Sprint</Button>}
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova tarefa</Button>
          </div>
        )}
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? <div className="card"><LoadingRows rows={8} /></div> : (
        <>
          {d.board.teamIds.length === 0 && <p className="border-l-4 border-l-[#B45309] bg-[#FFF7E6] px-3 py-2 text-sm text-ink">Este quadro ainda não tem equipes. A gestão do departamento ou o administrador define as equipes em Configurações → Quadros de Tarefas; até lá aparecem só as tarefas enviadas para cá.</p>}
          <Summary d={d} p={p} onFuraFilas={p?.sprint?.status === 'andamento' ? () => setModal('furafilas') : undefined} />
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative w-56"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden /><Input aria-label="Buscar tarefas" className="pl-8" value={u.q} onChange={(e) => setU({ q: e.target.value })} placeholder="Buscar tarefa" /></div>
            <Select aria-label="Responsável" className="w-48" value={u.view === 'minhas' ? 'eu' : u.owner} onChange={(e) => (e.target.value === 'eu' ? setU({ view: 'minhas', owner: '' }) : setU({ owner: e.target.value, view: u.view === 'minhas' ? 'todas' : u.view }))}><option value="">Todas as pessoas</option><option value="eu">Minhas e que acompanho</option>{d.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
            <Select aria-label="Categoria" className="w-44" value={u.cat} onChange={(e) => setU({ cat: e.target.value })}><option value="">Todas as categorias</option>{CAPACITY_CATEGORIES.map((c) => <option key={c} value={c}>{CAPACITY_CATEGORY_LABELS[c]}</option>)}<option value="sem">Sem categoria</option></Select>
            <Select aria-label="Origem" className="w-40" value={u.origin} onChange={(e) => setU({ origin: e.target.value })}><option value="">Todas as origens</option>{TASK_ORIGINS.filter((o) => o !== 'marketing').map((o) => <option key={o} value={o}>{TASK_ORIGIN_LABELS[o]}</option>)}</Select>
            <Select aria-label="Mostrar" className="w-48" value={u.view === 'minhas' ? 'todas' : u.view} onChange={(e) => setU({ view: e.target.value })}>
              <option value="todas">Todas as tarefas</option><option value="semana">Só as da Sprint</option><option value="nao_planejadas">Fora da Sprint</option><option value="enviadas">Enviadas a outros times</option>
            </Select>
            <label className="flex h-10 items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!u.blocked} onChange={(e) => setU({ blocked: e.target.checked ? '1' : '' })} />Bloqueadas</label>
          </div>
          {u.view === 'enviadas'
            ? <SentList items={d.items} onOpen={setOpen} />
            : <Kanban d={d} onAdd={() => setCreating(true)} onOpen={(i) => (i.readOnly && i.link?.to ? nav(i.link.to) : setOpen(i.id))} />}
        </>
      )}
      <TaskDrawer id={open} onClose={() => { setOpen(null); void q.refetch(); void plan.refetch(); }} onOpen={setOpen} />
      <NewTaskDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void q.refetch(); void plan.refetch(); setOpen(id); }} />
      {modal === 'planejar' && p && <PlannerModal board={key} plan={p} onClose={() => setModal(null)} />}
      {modal === 'encerrar' && p?.sprint && <CloseModal board={key} sprintId={p.sprint.id} onClose={() => setModal(null)} />}
      {modal === 'indicadores' && d && <IndicatorsModal board={key} week={d.week} people={d.owners} onClose={() => setModal(null)} />}
      {modal === 'capacidade' && d && <CapacityModal board={key} week={d.week} leads={leads} onClose={() => setModal(null)} />}
      {modal === 'furafilas' && p?.sprint && <FuraFilaListModal board={key} plan={p} onClose={() => setModal(null)} onOpen={(id) => { setModal(null); setU({ furafila: id }); }} />}
      {u.furafila && me && <FuraFilaAnalysisModal board={key} rid={u.furafila} meId={me.user.id} onClose={() => { setU({ furafila: '' }); void plan.refetch(); void q.refetch(); }} />}
    </div>
  );
}

const fmtDayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const CAT_DOT: Record<CapacityCategory, string> = { comercial: 'bg-primary', interno: 'bg-[#0F766E]', hipotese: 'bg-[#B45309]' };

function Stat({ label, value, tone, icon, onClick }: { label: string; value: number; tone: 'danger' | 'warn' | 'soft' | 'ok'; icon?: React.ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={clsx('card p-4 text-left', onClick && 'hover:border-primary', tone === 'danger' && 'border-danger/50 bg-danger-soft', tone === 'warn' && 'border-[#B45309]/40 bg-[#FFF7E6]')}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">{icon}{label}</p>
      <p className={clsx('num mt-1 text-3xl font-bold', tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-[#92400E]' : 'text-ink')}>{value}</p>
    </Tag>
  );
}

/** Resumo em cima do quadro, no mesmo formato do Quadro do Marketing; esforço em horas estimadas, nunca contagem. */
function Summary({ d, p, onFuraFilas }: { d: Data; p: Plan | undefined; onFuraFilas?: () => void }) {
  const k = d.kpis;
  const w = k.week;
  const pct = w.plannedMinutes ? Math.round((w.doneMinutes / w.plannedMinutes) * 100) : 0;
  const total = CAPACITY_CATEGORIES.reduce((t, c) => t + w.distribution[c], 0);
  // dias úteis da semana (seg–sex) que ainda faltam, e quanto do tempo já passou
  const elapsed = Math.min(5, Math.max(0, Math.round((Date.parse(`${d.today}T12:00:00Z`) - Date.parse(`${d.week}T12:00:00Z`)) / 86_400_000)));
  const st = p?.sprint?.status;
  const statusLabel = st ? SPRINT_STATUS_LABELS[st].toLowerCase() : 'não planejada';
  return (
    <section aria-label="Resumo da Sprint" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_repeat(4,1fr)_1.6fr]">
      <div className="card p-4">
        <p className="text-xs font-semibold text-muted">Sprint {fmtDayMonth(d.week)} a {fmtDayMonth(addDays(d.week, 4))} · {statusLabel}</p>
        <p className="mt-1 text-2xl font-bold text-ink"><span className="num">{w.doneCount}</span><span className="text-base font-semibold text-muted"> de {w.plannedCount} entregues</span></p>
        <div className="mt-2 h-2 bg-line" aria-hidden><div className="h-2 bg-success" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-xs text-muted">{pct}% do esforço ({hours(w.doneMinutes)} de {hours(w.plannedMinutes)}){d.today >= d.week && d.today <= addDays(d.week, 6) ? ` · ${5 - elapsed} dia(s) restante(s) · ${elapsed * 20}% do tempo` : ''}</p>
        {p?.sprint?.objective && <p className="mt-1 line-clamp-2 text-xs text-ink">Objetivo: {p.sprint.objective}</p>}
        {p && <p className="mt-1 text-xs text-muted">Capacidade: {hours(p.capacity.selectedMinutes)} de {hours(p.capacity.totalNetMinutes)}{p.capacity.withoutSchedule.length ? ` · sem jornada: ${p.capacity.withoutSchedule.join(', ')}` : ''}</p>}
      </div>
      <Stat label="Atrasadas" value={k.overdue} tone={k.overdue ? 'danger' : 'ok'} icon={<AlarmClock className="h-4 w-4" />} />
      <Stat label="Vencem hoje" value={k.dueToday} tone={k.dueToday ? 'warn' : 'ok'} />
      <Stat label="Vencem em 2 dias" value={k.dueSoon} tone={k.dueSoon ? 'soft' : 'ok'} />
      <Stat label={p?.furaFilaPending ? `Fura-filas · ${p.furaFilaPending} aguardando` : 'Fura-filas'} value={p?.furaFilas ?? 0} tone={p?.furaFilaPending ? 'warn' : p?.furaFilas ? 'soft' : 'ok'} icon={<Zap className="h-4 w-4" />} onClick={onFuraFilas} />
      <div className="card p-4" aria-label="Esforço da Sprint">
        <p className="text-xs font-semibold text-muted">Esforço da Sprint (meta {d.policy.comercial / 100} · {d.policy.interno / 100} · {d.policy.hipotese / 100})</p>
        <div className="mt-2 flex h-3 w-full overflow-hidden bg-line" aria-hidden>{total ? CAPACITY_CATEGORIES.map((c) => <div key={c} className={CAT_DOT[c]} style={{ width: `${(w.distribution[c] / total) * 100}%` }} />) : null}</div>
        <ul className="mt-1.5 space-y-0.5 text-xs">{CAPACITY_CATEGORIES.map((c) => { const v = total ? Math.round((w.distribution[c] / total) * 100) : 0; const t = d.policy[c] / 100; return (
          <li key={c} className="flex justify-between gap-2"><span className="flex items-center gap-1.5"><span className={clsx('h-2 w-2', CAT_DOT[c])} />{CAPACITY_CATEGORY_LABELS[c]}</span><span className={clsx('num', Math.abs(v - t) > 10 && w.distribution[c] > 0 ? 'font-semibold text-[#B45309]' : 'text-muted')}>{v}% / {t}%</span></li>
        ); })}</ul>
        <p className="mt-1.5 text-xs text-muted">Em execução: {k.inExecution.length ? k.inExecution.map((x) => `${x.name.split(' ')[0]} ${x.n}`).join(' · ') : 'ninguém'}</p>
        {(k.uncategorized > 0 || k.withoutEstimate > 0) && <p className="mt-1 text-xs text-[#92400E]">{[k.uncategorized ? `${k.uncategorized} sem categoria` : '', k.withoutEstimate ? `${k.withoutEstimate} sem esforço` : ''].filter(Boolean).join(' · ')}</p>}
      </div>
    </section>
  );
}

function Kanban({ d, onOpen, onAdd }: { d: Data; onOpen: (i: Item) => void; onAdd: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const move = useMutation({
    mutationFn: ({ i, status }: { i: Item; status: string }) => api(`/tasks/${i.id}`, { method: 'PATCH', body: { rowVersion: i.rowVersion, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quadro'] }),
    onError: (e) => { toast({ tone: 'error', message: errMsg(e) }); void qc.invalidateQueries({ queryKey: ['quadro'] }); },
  });
  const by = useMemo(() => Object.fromEntries(BOARD_COLUMNS.map((c) => [c, d.items.filter((i) => i.column === c)])) as Record<BoardColumn, Item[]>, [d.items]);
  const end = (e: DragEndEvent) => {
    const i = e.active.data.current?.item as Item | undefined;
    const to = e.over?.id as BoardColumn | undefined;
    if (!i || !to || to === i.column) return;
    if ((to === 'a_fazer' && i.column === 'backlog') || to === 'backlog') return toast({ tone: 'error', message: 'Entrar ou sair da semana é planejamento: use Planejar Semana.' });
    // limite de tarefas em execução por pessoa
    if (to === 'em_execucao' && by.em_execucao.filter((x) => x.ownerId === i.ownerId && !x.blocked).length >= d.board.wipLimit)
      return toast({ tone: 'error', message: `${i.ownerName ?? 'A pessoa'} já tem ${d.board.wipLimit} tarefas em execução. Conclua ou bloqueie uma antes.` });
    const status = COLUMN_STATUS[to];
    if (status) move.mutate({ i, status });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={end}>
      <div className="scroll-thin flex gap-3 overflow-x-auto pb-2">
        {BOARD_COLUMNS.map((c) => (
          <Column key={c} col={c} count={by[c].length} onAdd={c === 'backlog' ? onAdd : undefined}>
            {by[c].map((i) => <CardView key={i.id} i={i} onOpen={() => onOpen(i)} />)}
            {!by[c].length && <p className="px-1 py-4 text-center text-xs text-muted">{c === 'backlog' ? 'Nada pendente fora da Sprint' : c === 'a_fazer' ? 'Entra pelo Planejar Sprint' : 'Arraste tarefas para cá'}</p>}
          </Column>
        ))}
      </div>
    </DndContext>
  );
}

function Column({ col, count, onAdd, children }: { col: BoardColumn; count: number; onAdd?: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: col });
  return (
    <section ref={setNodeRef} aria-label={BOARD_COLUMN_LABELS[col]} className={clsx('flex w-72 shrink-0 flex-col border border-line bg-surface-2/60', isOver && 'ring-2 ring-primary/40')}>
      <header className="flex items-center justify-between border-b border-line bg-surface px-3 py-2">
        <h2 className="text-sm font-bold text-ink">{BOARD_COLUMN_LABELS[col]} <span className="num font-normal text-muted">{count}</span></h2>
        {onAdd && <button type="button" aria-label={`Nova tarefa em ${BOARD_COLUMN_LABELS[col]}`} className="text-muted hover:text-primary" onClick={onAdd}><Plus className="h-4 w-4" /></button>}
      </header>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">{children}</div>
    </section>
  );
}

function CardView({ i, onOpen }: { i: Item; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: i.id, data: { item: i }, disabled: i.readOnly });
  return (
    <article ref={setNodeRef} {...attributes} {...listeners} aria-label={`${i.ref} ${i.title}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={clsx('cursor-pointer border bg-surface p-2.5 shadow-sm hover:border-primary/50', i.overdue ? 'border-danger/60' : 'border-line', isDragging && 'opacity-70 shadow-overlay')}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="flex flex-wrap items-center gap-1">
        {i.category ? <span className={clsx('px-1.5 py-0.5 text-2xs font-bold', CAT_COLOR[i.category])} title={i.categoryAuto ? 'Automática: ligada a oportunidade' : undefined}>{CAPACITY_CATEGORY_SHORT[i.category]}</span> : <span className="bg-surface-2 px-1.5 py-0.5 text-2xs font-semibold text-muted">Sem categoria</span>}
        {i.commercial && <span className="inline-flex items-center gap-0.5 bg-primary-soft px-1.5 py-0.5 text-2xs font-bold text-primary"><Briefcase className="h-3 w-3" aria-hidden />CRM</span>}
        {i.blocked && <span className="inline-flex items-center gap-0.5 bg-[#FEF3C7] px-1.5 py-0.5 text-2xs font-bold text-[#92400E]" title={i.waitingOn ?? undefined}><Lock className="h-3 w-3" aria-hidden />Bloqueada</span>}
        {i.depRisk ? <span className="inline-flex items-center gap-0.5 bg-danger-soft px-1.5 py-0.5 text-2xs font-bold text-danger" title="Uma predecessora está atrasada ou termina depois do prazo desta"><Link2 className="h-3 w-3" aria-hidden />Dependência em risco</span>
          : i.depOpen ? <span className="inline-flex items-center gap-0.5 bg-surface-2 px-1.5 py-0.5 text-2xs font-bold text-ink" title="Aguarda tarefas de que depende"><Link2 className="h-3 w-3" aria-hidden />Depende de {i.depOpen}</span> : null}
        {i.protectedCommitment && <span className="inline-flex items-center gap-0.5 bg-surface-2 px-1.5 py-0.5 text-2xs font-bold text-ink" title="Compromisso protegido"><ShieldCheck className="h-3 w-3" aria-hidden />Protegido</span>}
        {i.priority === 'alta' && <span className="bg-danger-soft px-1.5 py-0.5 text-2xs font-bold text-danger">Alta</span>}
      </div>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-ink">{i.title}</p>
      {i.link && <p className="mt-1 truncate text-xs text-muted">{i.link.label}{i.link.valueCents ? ` · ${fmtBRL(i.link.valueCents)}/mês` : ''}</p>}
      <div className="mt-2 flex items-center gap-2 whitespace-nowrap text-2xs text-muted">
        <span className="num font-semibold">{i.ref}</span>
        <span className="min-w-0 truncate">{TASK_ORIGIN_LABELS[i.origin]}</span>
        {i.estimateMinutes ? <span className="num">{fmtMinutes(i.remainingMinutes ?? i.estimateMinutes)}</span> : null}
        <span className={clsx('px-1.5 py-0.5 font-semibold', i.overdue ? 'bg-danger-soft text-danger' : i.dueToday ? 'bg-[#FFF7E6] text-[#92400E]' : 'bg-surface-2')}>{i.dueDay ? (i.overdue ? `Atrasada · ${fmtDate(i.dueDay)}` : i.dueToday ? 'Vence hoje' : fmtDate(i.dueDay)) : 'Sem prazo'}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {i.observers ? <span className="flex items-center gap-0.5" title="Observadores"><Eye className="h-3.5 w-3.5" aria-hidden />{i.observers}</span> : null}
          <Avatar name={i.ownerName ?? '?'} userId={i.ownerId} size={22} />
        </span>
      </div>
    </article>
  );
}

/** Enviadas: o que este time mandou para outros, com o andamento lá (só leitura). */
function SentList({ items, onOpen }: { items: Item[]; onOpen: (id: string) => void }) {
  if (!items.length) return <EmptyState title="Nada enviado a outros times" description="Na tarefa, use “Enviar para outro time”. O outro time planeja quando executa; aqui você acompanha." />;
  return (
    <table className="w-full border border-line bg-surface text-left text-sm" aria-label="Tarefas enviadas a outros times">
      <thead className="bg-surface-2 text-xs text-muted"><tr>{['Tarefa', 'Com', 'Responsável', 'Situação', 'Prazo'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
      <tbody>{items.map((i) => (
        <tr key={i.id} className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => onOpen(i.id)}>
          <td className="px-3 py-2"><span className="num mr-2 text-xs text-muted">{i.ref}</span><span className="font-semibold text-ink">{i.title}</span></td>
          <td className="px-3 py-2">{i.link?.label.replace(/^Com /, '')}</td>
          <td className="px-3 py-2">{i.ownerName}</td>
          <td className="px-3 py-2">{BOARD_COLUMN_LABELS[i.column]}{i.planned ? ' · planejada' : ' · aguardando planejamento'}{i.blocked ? ' · bloqueada' : ''}</td>
          <td className={clsx('px-3 py-2', i.overdue && 'font-semibold text-danger')}>{i.dueDay ? fmtDate(i.dueDay) : '—'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

