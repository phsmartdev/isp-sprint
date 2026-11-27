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
import { AlarmClock, ChevronLeft, ChevronRight, KanbanSquare, Lock, Search, ShieldCheck, Briefcase } from 'lucide-react';
import {
  BOARD_COLUMNS, BOARD_COLUMN_LABELS, BOARD_KEYS, BOARD_LABELS, CAPACITY_CATEGORIES, CAPACITY_CATEGORY_LABELS, CAPACITY_CATEGORY_SHORT, COLUMN_STATUS, TASK_ORIGINS, TASK_ORIGIN_LABELS,
  fmtMinutes, type BoardColumn, type BoardKey, type CapacityCategory, type TaskOrigin,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar, EmptyState, ErrorState, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { TaskDrawer } from '../../features/tasks/TaskDrawer';
import { SprintBar } from '../../features/boards/SprintPlanner';

type Item = {
  id: string; ref: string; title: string; type: string; status: string; column: BoardColumn; rowVersion: number; ownerId: string; ownerName: string | null; priority: string;
  dueAt: string | null; dueDay: string | null; agreedDueAt: string | null; category: CapacityCategory | null; categoryAuto: boolean; estimateMinutes: number | null; remainingMinutes: number | null;
  origin: TaskOrigin; commercial: boolean; planned: boolean; blocked: boolean; waitingOn: string | null; protectedCommitment: boolean; overdue: boolean; dueToday: boolean;
  link: { kind: string; label: string; to: string; valueCents?: number | null; stage?: string | null } | null; readOnly: boolean;
};
type Data = {
  board: { key: BoardKey; label: string; teamIds: string[]; wipLimit: number; role: 'gestao' | 'lideranca' | 'colaborador' };
  week: string; today: string; policy: Record<CapacityCategory, number> & { version: number };
  kpis: { overdue: number; dueToday: number; dueSoon: number; blocked: number; uncategorized: number; withoutEstimate: number; commercialUnplanned: number;
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
  const [u, setU] = useUrlState({ view: 'todas', week: '', q: '', owner: '', origin: '', cat: '', prio: '', blocked: '' });
  const [open, setOpen] = useState<string | null>(null);
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['quadro', key, u],
    queryFn: () => api<Data>(`/quadros/${key}${qs({ view: u.view, week: u.week || undefined, q: u.q || undefined, ownerId: u.owner || undefined, origin: u.origin || undefined, category: u.cat || undefined, priority: u.prio || undefined, blocked: u.blocked || undefined })}`),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const week = d?.week ?? '';
  return (
    <div className="space-y-4">
      <PageHeader icon={<KanbanSquare className="h-9 w-9" strokeWidth={2.2} />} title={`Quadro de Tarefas · ${BOARD_LABELS[key]}`}
        subtitle={d ? `Semana de ${fmtDate(d.week)} a ${fmtDate(addDays(d.week, 4))} · diretriz ${d.policy.comercial / 100}/${d.policy.interno / 100}/${d.policy.hipotese / 100}${d.board.role !== 'colaborador' ? ` · você ${d.board.role === 'gestao' ? 'faz a gestão' : 'lidera'} este quadro` : ''}` : 'Tudo o que o time precisa fazer, de todos os módulos.'}
        actions={week ? (
          <div className="flex items-center gap-1" aria-label="Semana">
            <button type="button" aria-label="Semana anterior" className="flex h-10 w-10 items-center justify-center border border-line bg-surface hover:border-primary" onClick={() => setU({ week: addDays(week, -7) })}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className="h-10 border border-line bg-surface px-3 text-sm font-semibold hover:border-primary" onClick={() => setU({ week: '' })}>Semana atual</button>
            <button type="button" aria-label="Próxima semana" className="flex h-10 w-10 items-center justify-center border border-line bg-surface hover:border-primary" onClick={() => setU({ week: addDays(week, 7) })}><ChevronRight className="h-4 w-4" /></button>
          </div>
        ) : undefined} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? <LoadingRows rows={6} /> : (
        <>
          {d.board.teamIds.length === 0 && <p className="border-l-4 border-l-[#B45309] bg-[#FFF7E6] px-3 py-2 text-sm text-ink">Este quadro ainda não tem equipes. A gestão do departamento ou o administrador define as equipes em Configurações → Quadros de Tarefas; até lá aparecem só as tarefas enviadas para cá.</p>}
          {key !== 'marketing' && <SprintBar board={key} week={d.week} />}
          <Indicators d={d} onFilter={(p) => setU(p)} />
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Visão" className="inline-flex flex-wrap border border-line">
              {VIEWS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={u.view === k} onClick={() => setU({ view: k })} className={clsx('px-3 py-1.5 text-sm font-semibold', u.view === k ? 'bg-primary text-white' : 'bg-surface text-ink hover:bg-surface-2')}>{l}</button>)}
            </div>
            <label className="relative ml-auto"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden /><Input aria-label="Buscar tarefas" className="w-56 pl-8" value={u.q} onChange={(e) => setU({ q: e.target.value })} placeholder="Buscar" /></label>
            <Select aria-label="Responsável" className="w-44" value={u.owner} onChange={(e) => setU({ owner: e.target.value })}><option value="">Todos os responsáveis</option>{d.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
            <Select aria-label="Origem" className="w-44" value={u.origin} onChange={(e) => setU({ origin: e.target.value })}><option value="">Todas as origens</option>{TASK_ORIGINS.filter((o) => o !== 'marketing').map((o) => <option key={o} value={o}>{TASK_ORIGIN_LABELS[o]}</option>)}</Select>
            <Select aria-label="Categoria" className="w-44" value={u.cat} onChange={(e) => setU({ cat: e.target.value })}><option value="">Todas as categorias</option>{CAPACITY_CATEGORIES.map((c) => <option key={c} value={c}>{CAPACITY_CATEGORY_LABELS[c]}</option>)}<option value="sem">Sem categoria</option></Select>
            <Select aria-label="Prioridade" className="w-36" value={u.prio} onChange={(e) => setU({ prio: e.target.value })}><option value="">Prioridade</option><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></Select>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!u.blocked} onChange={(e) => setU({ blocked: e.target.checked ? '1' : '' })} />Bloqueadas</label>
          </div>
          {u.view === 'enviadas'
            ? <SentList items={d.items} onOpen={setOpen} />
            : !d.items.length ? <EmptyState title="Nenhuma tarefa aqui" description={u.view === 'semana' ? 'Nada planejado para esta semana ainda.' : 'Tarefas criadas nos módulos (CRM, Contratos, Sucesso do Cliente, Projetos) pelas pessoas das equipes deste quadro aparecem aqui sozinhas.'} />
            : <Kanban d={d} onOpen={(i) => (i.readOnly && i.link?.to ? nav(i.link.to) : setOpen(i.id))} />}
        </>
      )}
      <TaskDrawer id={open} onClose={() => { setOpen(null); void q.refetch(); }} onOpen={setOpen} />
    </div>
  );
}

function Indicators({ d, onFilter }: { d: Data; onFilter: (p: Record<string, string>) => void }) {
  const k = d.kpis;
  const pct = k.week.plannedMinutes ? Math.round((k.week.doneMinutes / k.week.plannedMinutes) * 100) : null;
  const total = CAPACITY_CATEGORIES.reduce((t, c) => t + k.week.distribution[c], 0);
  const stat = (label: string, value: number, tone: 'danger' | 'warn' | 'soft', onClick?: () => void) => (
    <button type="button" onClick={onClick} disabled={!onClick} className={clsx('border px-3 py-2 text-left', tone === 'danger' && value ? 'border-danger/50 bg-danger-soft' : tone === 'warn' && value ? 'border-[#B45309]/40 bg-[#FFF7E6]' : 'border-line bg-surface', onClick && 'hover:border-primary')}>
      <span className="block text-xs font-semibold text-muted">{label}</span><span className={clsx('num text-xl font-bold', tone === 'danger' && value ? 'text-danger' : 'text-ink')}>{value}</span>
    </button>
  );
  return (
    <section aria-label="Indicadores do quadro" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <div className="border border-line bg-surface px-3 py-2">
          <span className="block text-xs font-semibold text-muted">Semana</span>
          <span className="num text-xl font-bold text-ink">{k.week.doneCount}/{k.week.plannedCount}</span>
          <span className="block text-xs text-muted">{pct === null ? 'sem esforço planejado' : `${pct}% do esforço (${hours(k.week.doneMinutes)} de ${hours(k.week.plannedMinutes)})`}</span>
        </div>
        {stat('Atrasadas', k.overdue, 'danger')}
        {stat('Vencem hoje', k.dueToday, 'warn')}
        {stat('Próximos 3 dias', k.dueSoon, 'soft')}
        {stat('Bloqueadas', k.blocked, 'warn', () => onFilter({ blocked: '1' }))}
        {stat('Comerciais fora do plano', k.commercialUnplanned, 'warn', () => onFilter({ view: 'nao_planejadas', origin: 'crm' }))}
      </div>
      <div className="border border-line bg-surface px-3 py-2" aria-label="Distribuição 70/20/10 da semana">
        <div className="flex items-center justify-between text-xs font-semibold text-muted"><span>Distribuição da semana (esforço estimado)</span><span>diretriz {d.policy.comercial / 100}/{d.policy.interno / 100}/{d.policy.hipotese / 100}</span></div>
        <div className="mt-1.5 flex h-3 w-full overflow-hidden bg-surface-2">{total ? CAPACITY_CATEGORIES.map((c) => <span key={c} className={CAT_BAR[c]} style={{ width: `${(k.week.distribution[c] / total) * 100}%` }} title={`${CAPACITY_CATEGORY_LABELS[c]}: ${hours(k.week.distribution[c])}`} />) : null}</div>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          {CAPACITY_CATEGORIES.map((c) => <li key={c}><span className={clsx('mr-1 inline-block h-2 w-2', CAT_BAR[c])} />{CAPACITY_CATEGORY_LABELS[c]}: <b className="num">{total ? Math.round((k.week.distribution[c] / total) * 100) : 0}%</b> <span className="text-muted">(meta {d.policy[c] / 100}%)</span></li>)}
        </ul>
        {(k.uncategorized > 0 || k.withoutEstimate > 0) && <p className="mt-1 text-xs text-[#92400E]">{[k.uncategorized ? `${k.uncategorized} sem categoria` : '', k.withoutEstimate ? `${k.withoutEstimate} sem estimativa de esforço` : ''].filter(Boolean).join(' · ')}: classifique antes de planejar a semana.</p>}
      </div>
    </section>
  );
}

function Kanban({ d, onOpen }: { d: Data; onOpen: (i: Item) => void }) {
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
          <Column key={c} col={c} count={by[c].length}>
            {by[c].map((i) => <CardView key={i.id} i={i} onOpen={() => onOpen(i)} />)}
          </Column>
        ))}
      </div>
    </DndContext>
  );
}

function Column({ col, count, children }: { col: BoardColumn; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: col });
  return (
    <section ref={setNodeRef} aria-label={BOARD_COLUMN_LABELS[col]} className={clsx('flex w-72 shrink-0 flex-col border border-line bg-surface-2/60', isOver && 'ring-2 ring-primary/40')}>
      <header className="border-b border-line bg-surface px-3 py-2"><h2 className="text-sm font-bold text-ink">{BOARD_COLUMN_LABELS[col]} <span className="num font-normal text-muted">{count}</span></h2></header>
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
        {i.protectedCommitment && <span className="inline-flex items-center gap-0.5 bg-surface-2 px-1.5 py-0.5 text-2xs font-bold text-ink" title="Compromisso protegido"><ShieldCheck className="h-3 w-3" aria-hidden />Protegido</span>}
        {i.priority === 'alta' && <span className="bg-danger-soft px-1.5 py-0.5 text-2xs font-bold text-danger">Alta</span>}
      </div>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-ink">{i.title}</p>
      {i.link && <p className="mt-1 truncate text-xs text-muted">{i.link.label}{i.link.valueCents ? ` · ${fmtBRL(i.link.valueCents)}/mês` : ''}</p>}
      <div className="mt-2 flex items-center gap-2 whitespace-nowrap text-2xs text-muted">
        <span className="num font-semibold">{i.ref}</span>
        <span className="min-w-0 truncate">{TASK_ORIGIN_LABELS[i.origin]}</span>
        {i.estimateMinutes ? <span className="num">{fmtMinutes(i.remainingMinutes ?? i.estimateMinutes)}</span> : null}
        {i.dueDay && <span className={clsx('inline-flex items-center gap-0.5 px-1 font-semibold', i.overdue ? 'bg-danger-soft text-danger' : i.dueToday ? 'bg-[#FFF7E6] text-[#92400E]' : '')}><AlarmClock className="h-3 w-3" aria-hidden />{fmtDate(i.dueDay)}</span>}
        <span className="ml-auto shrink-0"><Avatar name={i.ownerName ?? '?'} userId={i.ownerId} size={22} /></span>
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

