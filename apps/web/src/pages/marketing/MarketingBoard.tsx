/**
 * Marketing → Quadro de tarefas: Sprint quinzenal em kanban, resumo em cima, alertas de prazo, etiquetas que ligam
 * outras atividades da ferramenta, orçamento e brindes no cartão, um responsável e observadores, fura-fila.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import clsx from 'clsx';
import { AlarmClock, CalendarRange, Eye, Gift, KanbanSquare, Link2, Plus, Search, Tag, Trash2, Wallet, Zap } from 'lucide-react';
import {
  FURA_FILA_CRITERIA, FURA_FILA_LABELS, MKT_ALLOCATIONS, MKT_ALLOCATION_LABELS, MKT_COLUMNS, MKT_COLUMN_LABELS, MKT_LINK_LABELS, MKT_PRIORITIES, MKT_PRIORITY_LABELS,
  MKT_VERTICALS, MKT_VERTICAL_LABELS, type MktColumn, type MktVertical,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { Avatar, Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Due = 'atrasada' | 'vence_hoje' | 'vence_em_breve' | 'no_prazo' | 'sem_prazo' | 'concluida';
type Card = {
  id: string; code: number; title: string; column: MktColumn; position: number; ownerId: string; ownerName: string; observerIds: string[]; dueOn: string | null; due: Due;
  priority: string; verticals: MktVertical[]; allocation: string | null; sprintId: string | null; requester: string | null; furaFila: boolean; furaFilaStatus: string | null;
  tagIds: string[]; links: number; budgetCents: number | null; giftCents: number; giftQty: number; rowVersion: number; canEdit: boolean;
};
type Sprint = { id: string; name: string; startOn: string; endOn: string; status: 'planejamento' | 'aberta' | 'encerrada'; objective: string | null; highlights: string | null };
type TagT = { id: string; name: string; color: string };
type Board = {
  today: string; wipLimit: number; canLead: boolean; me: string; sprints: Sprint[]; sprint: Sprint | null; tags: TagT[]; users: { id: string; name: string }[]; cards: Card[];
  stats: { total: number; done: number; donePct: number; overdue: number; dueToday: number; dueSoon: number; inProgress: number; furaFila: number; daysLeft: number | null; elapsedPct: number | null;
    overLimit: { ownerId: string; n: number; name: string }[]; wip: { ownerId: string; n: number; name: string }[]; allocation: { key: string; label: string; n: number; pct: number; target: number }[] };
};
type Detail = Card & {
  briefing: string | null; costCenterId: string | null; budgetLineId: string | null; gifts: { itemId: string; name: string; qty: number; unitCostCents: number }[]; createdBy: string | null;
  furaFilaCriterion: string | null; furaFilaReason: string | null; canLead: boolean;
  links: { id: string; entityType: string; entityId: string; label: string; url: string }[];
  tagLinks: { id: string; tagId: string; entityType: string; label: string; url: string }[];
  budgetLine: { what: string; amountCents: number; month: string } | null;
  events: { id: string; type: string; text: string | null; createdAt: string; actor: string | null }[];
};

const VERTICAL_STYLE: Record<MktVertical, string> = {
  arte: 'bg-[#F3E8FF] text-[#6B21A8]', ciencia: 'bg-[#DBEAFE] text-[#1E3A8A]', disciplina: 'bg-[#CCFBF1] text-[#115E59]', interno: 'bg-[#E2E8F0] text-[#334155]', trafego: 'bg-[#FFEDD5] text-[#9A3412]',
};
const DUE_STYLE: Record<Due, { label: (d: string | null) => string; cls: string } | null> = {
  atrasada: { label: (d) => `Atrasada · ${fmtDate(d)}`, cls: 'bg-danger text-white' },
  vence_hoje: { label: () => 'Vence hoje', cls: 'bg-[#B45309] text-white' },
  vence_em_breve: { label: (d) => `Vence ${fmtDate(d)}`, cls: 'bg-[#FEF3C7] text-[#92400E]' },
  no_prazo: { label: (d) => fmtDate(d), cls: 'bg-surface-2 text-muted' },
  sem_prazo: { label: () => 'Sem prazo', cls: 'bg-surface-2 text-muted' },
  concluida: null,
};
const PRIO_DOT: Record<string, string> = { alta: 'bg-danger', media: 'bg-[#B45309]', baixa: 'bg-[#94A3B8]' };
const KEY = ['marketing', 'board'];

export function MarketingBoardPage() {
  const [search, setSearch] = useSearchParams();
  const [sprintId, setSprintId] = useState<string>('');
  const q = useQuery({ queryKey: [...KEY, sprintId], queryFn: () => api<Board>(`/marketing/quadro${qs({ sprintId: sprintId || undefined })}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<{ owner: string; tag: string; vertical: string; q: string }>({ owner: '', tag: '', vertical: '', q: '' });
  const [creating, setCreating] = useState<MktColumn | null>(null);
  const [sprintModal, setSprintModal] = useState<'nova' | 'abrir' | 'encerrar' | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const open = search.get('tarefa');
  const setOpen = (id: string | null) => setSearch(id ? { tarefa: id } : {}, { replace: true });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const move = useMutation({
    mutationFn: (v: { c: Card; to: MktColumn }) => api(`/marketing/quadro/cards/${v.c.id}`, { method: 'PATCH', body: { rowVersion: v.c.rowVersion, column: v.to } }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: KEY }); toast({ tone: 'success', message: `Movida para ${MKT_COLUMN_LABELS[v.to]}` }); },
    onError: (e) => { void qc.invalidateQueries({ queryKey: KEY }); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const d = q.data;
  const cards = useMemo(() => (d?.cards ?? []).filter((c) => (!filter.owner || c.ownerId === filter.owner || (filter.owner === 'eu' && (c.ownerId === d!.me || c.observerIds.includes(d!.me))))
    && (!filter.tag || c.tagIds.includes(filter.tag)) && (!filter.vertical || c.verticals.includes(filter.vertical as MktVertical))
    && (!filter.q || `${c.title} MKT-${c.code}`.toLowerCase().includes(filter.q.toLowerCase()))), [d, filter]);
  if (!d) return <div className="card"><LoadingRows rows={8} /></div>;
  const st = d.stats;
  const onDragEnd = (e: DragEndEvent) => {
    const c = e.active.data.current?.card as Card | undefined;
    const to = e.over?.id as MktColumn | undefined;
    if (c && to && to !== c.column) move.mutate({ c, to });
  };
  const tagOf = (id: string) => d.tags.find((t) => t.id === id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink"><KanbanSquare className="h-6 w-6 text-primary" aria-hidden />Quadro do Marketing</h1>
          <p className="text-sm text-muted">Sprint quinzenal, um responsável por tarefa e observadores. No máximo {d.wipLimit} tarefas em execução por pessoa.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Sprint" value={sprintId || d.sprint?.id || ''} onChange={(e) => setSprintId(e.target.value)} className="w-64">
            {!d.sprints.length && <option value="">Sem Sprint planejada</option>}
            {d.sprints.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.status === 'aberta' ? 'aberta' : s.status === 'planejamento' ? 'em planejamento' : 'encerrada'}</option>)}
          </Select>
          <Button icon={<Tag className="h-4 w-4" />} onClick={() => setTagsOpen(true)}>Etiquetas</Button>
          {d.canLead && <Button icon={<CalendarRange className="h-4 w-4" />} onClick={() => setSprintModal('nova')}>Planejar Sprint</Button>}
          {d.canLead && d.sprint?.status === 'planejamento' && <Button variant="primary" onClick={() => setSprintModal('abrir')}>Abrir Sprint</Button>}
          {d.canLead && d.sprint?.status === 'aberta' && <Button onClick={() => setSprintModal('encerrar')}>Encerrar Sprint</Button>}
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating('backlog')}>Nova tarefa</Button>
        </div>
      </div>

      {/* resumo em cima do quadro */}
      <section aria-label="Resumo da Sprint" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_repeat(4,1fr)_1.6fr]">
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">{d.sprint ? `${d.sprint.name}${d.sprint.status === 'aberta' ? ' · escopo fechado' : d.sprint.status === 'planejamento' ? ' · em planejamento' : ' · encerrada'}` : 'Sem Sprint: mostrando todas as tarefas fora do backlog'}</p>
          <p className="mt-1 text-2xl font-bold text-ink"><span className="num">{st.done}</span><span className="text-base font-semibold text-muted"> de {st.total} entregues</span></p>
          <div className="mt-2 h-2 bg-line" aria-hidden><div className="h-2 bg-success" style={{ width: `${st.donePct}%` }} /></div>
          <p className="mt-1 text-xs text-muted">{st.donePct}% concluído{st.daysLeft != null ? ` · ${st.daysLeft} dia(s) restante(s) · ${st.elapsedPct}% do tempo` : ''}</p>
          {d.sprint?.objective && <p className="mt-1 line-clamp-2 text-xs text-ink">Objetivo: {d.sprint.objective}</p>}
        </div>
        <Stat label="Atrasadas" value={st.overdue} tone={st.overdue ? 'danger' : 'ok'} icon={<AlarmClock className="h-4 w-4" />} />
        <Stat label="Vencem hoje" value={st.dueToday} tone={st.dueToday ? 'warn' : 'ok'} />
        <Stat label="Vencem em 2 dias" value={st.dueSoon} tone={st.dueSoon ? 'soft' : 'ok'} />
        <Stat label="Fura-filas" value={st.furaFila} tone={st.furaFila ? 'soft' : 'ok'} icon={<Zap className="h-4 w-4" />} />
        <div className="card p-4">
          <p className="text-xs font-semibold text-muted">Esforço da Sprint (meta 70 · 20 · 10)</p>
          <div className="mt-2 flex h-3 w-full overflow-hidden bg-line" aria-hidden>
            {st.allocation.map((a, i) => <div key={a.key} style={{ width: `${a.pct}%` }} className={['bg-primary', 'bg-[#0F766E]', 'bg-[#B45309]'][i]} />)}
          </div>
          <ul className="mt-1.5 space-y-0.5 text-xs">{st.allocation.map((a, i) => (
            <li key={a.key} className="flex justify-between gap-2"><span className="flex items-center gap-1.5"><span className={clsx('h-2 w-2', ['bg-primary', 'bg-[#0F766E]', 'bg-[#B45309]'][i])} />{a.label}</span><span className={clsx('num', Math.abs(a.pct - a.target) > 10 && a.n > 0 ? 'font-semibold text-[#B45309]' : 'text-muted')}>{a.pct}% / {a.target}%</span></li>
          ))}</ul>
          <p className="mt-1.5 text-xs text-muted">Em execução: {st.wip.length ? st.wip.map((w) => `${w.name.split(' ')[0]} ${w.n}`).join(' · ') : 'ninguém'}</p>
          {!!st.overLimit.length && <p className="mt-1 text-xs font-semibold text-danger">Acima do limite: {st.overLimit.map((o) => `${o.name} (${o.n})`).join(', ')}</p>}
        </div>
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden /><Input aria-label="Buscar tarefa" placeholder="Buscar tarefa" className="pl-8" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} /></div>
        <Select aria-label="Responsável" className="w-52" value={filter.owner} onChange={(e) => setFilter({ ...filter, owner: e.target.value })}><option value="">Todas as pessoas</option><option value="eu">Minhas e que acompanho</option>{d.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <Select aria-label="Etiqueta" className="w-48" value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value })}><option value="">Todas as etiquetas</option>{d.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Select aria-label="Vertical" className="w-40" value={filter.vertical} onChange={(e) => setFilter({ ...filter, vertical: e.target.value })}><option value="">Todas as verticais</option>{MKT_VERTICALS.map((v) => <option key={v} value={v}>{MKT_VERTICAL_LABELS[v]}</option>)}</Select>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="scroll-thin flex gap-3 overflow-x-auto pb-2">
          {MKT_COLUMNS.map((col) => {
            const list = cards.filter((c) => c.column === col);
            return (
              <Column key={col} col={col} count={list.length} onAdd={() => setCreating(col)}>
                {list.map((c) => <CardView key={c.id} c={c} tagOf={tagOf} onOpen={() => setOpen(c.id)} />)}
                {!list.length && <p className="px-1 py-4 text-center text-xs text-muted">Arraste tarefas para cá</p>}
              </Column>
            );
          })}
        </div>
      </DndContext>

      {(creating || open) && <CardDrawer key={open ?? 'novo'} id={open} board={d} initialColumn={creating ?? 'backlog'} onClose={() => { setCreating(null); setOpen(null); }} />}
      {sprintModal && <SprintModal kind={sprintModal} board={d} onClose={() => setSprintModal(null)} />}
      {tagsOpen && <TagsModal onClose={() => setTagsOpen(false)} />}
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone: 'danger' | 'warn' | 'soft' | 'ok'; icon?: React.ReactNode }) {
  return (
    <div className={clsx('card p-4', tone === 'danger' && 'border-danger/50 bg-danger-soft', tone === 'warn' && 'border-[#B45309]/40 bg-[#FFF7E6]')}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">{icon}{label}</p>
      <p className={clsx('num mt-1 text-3xl font-bold', tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-[#92400E]' : 'text-ink')}>{value}</p>
    </div>
  );
}

function Column({ col, count, onAdd, children }: { col: MktColumn; count: number; onAdd: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: col });
  return (
    <section ref={setNodeRef} aria-label={MKT_COLUMN_LABELS[col]} className={clsx('flex w-72 shrink-0 flex-col border border-line bg-surface-2/60', isOver && 'ring-2 ring-primary/40')}>
      <header className="flex items-center justify-between border-b border-line bg-surface px-3 py-2">
        <h2 className="text-sm font-bold text-ink">{MKT_COLUMN_LABELS[col]} <span className="num font-normal text-muted">{count}</span></h2>
        <button type="button" aria-label={`Nova tarefa em ${MKT_COLUMN_LABELS[col]}`} className="text-muted hover:text-primary" onClick={onAdd}><Plus className="h-4 w-4" /></button>
      </header>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">{children}</div>
    </section>
  );
}

function CardView({ c, tagOf, onOpen }: { c: Card; tagOf: (id: string) => TagT | undefined; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: c.id, data: { card: c }, disabled: !c.canEdit || (c.furaFila && c.furaFilaStatus === 'pendente') });
  const due = DUE_STYLE[c.due];
  return (
    <article ref={setNodeRef} {...attributes} {...listeners} aria-label={`MKT-${c.code} ${c.title}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={clsx('cursor-pointer border bg-surface p-2.5 shadow-sm hover:border-primary/50', c.due === 'atrasada' ? 'border-danger/60' : 'border-line', isDragging && 'opacity-70 shadow-overlay')}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="flex items-start gap-1.5">
        <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', PRIO_DOT[c.priority])} title={`Prioridade ${MKT_PRIORITY_LABELS[c.priority as keyof typeof MKT_PRIORITY_LABELS] ?? ''}`} />
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink">{c.title}</p>
      </div>
      {!!c.verticals.length && <div className="mt-1.5 flex flex-wrap gap-1">{c.verticals.map((v) => <span key={v} className={clsx('px-1.5 py-0.5 text-2xs font-semibold', VERTICAL_STYLE[v])}>{MKT_VERTICAL_LABELS[v]}</span>)}</div>}
      {!!c.tagIds.length && <div className="mt-1 flex flex-wrap gap-1">{c.tagIds.map((t) => { const tg = tagOf(t); return tg ? <span key={t} className="inline-flex items-center gap-1 text-2xs text-muted"><span className="h-2 w-2" style={{ background: tg.color }} />{tg.name}</span> : null; })}</div>}
      {c.furaFila && <p className={clsx('mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 text-2xs font-semibold', c.furaFilaStatus === 'pendente' ? 'bg-[#FEF3C7] text-[#92400E]' : c.furaFilaStatus === 'aprovado' ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted')}><Zap className="h-3 w-3" aria-hidden />Fura-fila {c.furaFilaStatus === 'pendente' ? 'aguardando liderança' : c.furaFilaStatus}</p>}
      <div className="mt-2 flex items-center gap-2 text-2xs text-muted">
        <span className="num font-semibold">MKT-{c.code}</span>
        {due && <span className={clsx('px-1.5 py-0.5 font-semibold', due.cls)}>{due.label(c.dueOn)}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {c.budgetCents ? <Wallet className="h-3.5 w-3.5" aria-label={`Orçamento ${fmtBRL(c.budgetCents)}`} /> : null}
          {c.giftQty ? <Gift className="h-3.5 w-3.5" aria-label={`${c.giftQty} brinde(s)`} /> : null}
          {c.links ? <span className="flex items-center gap-0.5"><Link2 className="h-3.5 w-3.5" aria-hidden />{c.links}</span> : null}
          {c.observerIds.length ? <span className="flex items-center gap-0.5" title="Observadores"><Eye className="h-3.5 w-3.5" aria-hidden />{c.observerIds.length}</span> : null}
          <Avatar name={c.ownerName} userId={c.ownerId} size={22} />
        </span>
      </div>
    </article>
  );
}

type Form = {
  title: string; briefing: string; ownerId: string; observerIds: string[]; dueOn: string; priority: string; verticals: MktVertical[]; allocation: string; requester: string;
  column: MktColumn; sprintId: string; tagIds: string[]; costCenterId: string; budgetLineId: string; budget: string; gifts: { itemId: string; qty: number }[];
  furaCriterion: string; furaReason: string;
};

function CardDrawer({ id, board, initialColumn, onClose }: { id: string | null; board: Board; initialColumn: MktColumn; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const det = useQuery({ queryKey: ['marketing', 'card', id], enabled: !!id, queryFn: () => api<Detail>(`/marketing/quadro/cards/${id}`) });
  const res = useQuery({ queryKey: ['marketing', 'recursos'], queryFn: () => api<{ costCenters: { id: string; code: string; name: string }[]; lines: { id: string; costCenterId: string; what: string; month: string; amountCents: number }[]; gifts: { id: string; name: string; unitCostCents: number }[] }>('/marketing/quadro/recursos') });
  const planning = board.sprints.find((s) => s.status === 'planejamento');
  const [f, setF] = useState<Form>({ title: '', briefing: '', ownerId: board.me, observerIds: [], dueOn: '', priority: 'media', verticals: [], allocation: 'comercial', requester: '', column: initialColumn, sprintId: board.sprint && board.sprint.status !== 'encerrada' ? board.sprint.id : planning?.id ?? '', tagIds: [], costCenterId: '', budgetLineId: '', budget: '', gifts: [], furaCriterion: '', furaReason: '' });
  useEffect(() => {
    const c = det.data;
    if (c) setF({ title: c.title, briefing: c.briefing ?? '', ownerId: c.ownerId, observerIds: c.observerIds, dueOn: c.dueOn ?? '', priority: c.priority, verticals: c.verticals, allocation: c.allocation ?? '', requester: c.requester ?? '', column: c.column, sprintId: c.sprintId ?? '', tagIds: c.tagIds, costCenterId: c.costCenterId ?? '', budgetLineId: c.budgetLineId ?? '', budget: c.budgetCents ? (c.budgetCents / 100).toFixed(2).replace('.', ',') : '', gifts: c.gifts.map((g) => ({ itemId: g.itemId, qty: g.qty })), furaCriterion: '', furaReason: '' });
  }, [det.data]);
  const [tab, setTab] = useState<'detalhes' | 'relacionados' | 'recursos' | 'historico'>('detalhes');
  const c = det.data;
  const editable = !id || !!c?.canEdit;
  const targetSprint = board.sprints.find((s) => s.id === f.sprintId);
  const fura = !id && targetSprint?.status === 'aberta';
  const cents = (v: string) => (v.trim() ? Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100) : null);
  const payload = () => ({
    title: f.title, briefing: f.briefing || null, ownerId: f.ownerId, observerIds: f.observerIds, dueOn: f.dueOn || null, priority: f.priority, verticals: f.verticals, allocation: f.allocation || null,
    requester: f.requester || null, column: f.column, sprintId: f.sprintId || null, tagIds: f.tagIds, costCenterId: f.costCenterId || null, budgetLineId: f.budgetLineId || null, budgetCents: cents(f.budget), gifts: f.gifts,
  });
  const done = (msg: string, close = true) => { void qc.invalidateQueries({ queryKey: ['marketing'] }); toast({ tone: 'success', message: msg }); if (close) onClose(); };
  const save = useMutation({
    mutationFn: () => (id ? api(`/marketing/quadro/cards/${id}`, { method: 'PATCH', body: { ...payload(), rowVersion: c!.rowVersion } }) : api('/marketing/quadro/cards', { method: 'POST', body: { ...payload(), furaFila: fura ? { criterion: f.furaCriterion, reason: f.furaReason } : null } })),
    onSuccess: () => done(id ? 'Tarefa salva' : fura ? 'Fura-fila enviado para a liderança' : 'Tarefa criada'),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const archive = useMutation({ mutationFn: () => api(`/marketing/quadro/cards/${id}`, { method: 'DELETE' }), onSuccess: () => done('Tarefa arquivada'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const users = board.users;
  const giftCost = f.gifts.reduce((t, g) => t + g.qty * (res.data?.gifts.find((x) => x.id === g.itemId)?.unitCostCents ?? 0), 0);
  return (
    <Drawer open onClose={onClose} width="lg" title={id ? (c ? `MKT-${c.code} · ${c.title}` : 'Tarefa') : 'Nova tarefa de Marketing'}
      footer={<>
        {id && c?.canEdit && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="h-4 w-4" />} loading={archive.isPending} onClick={() => archive.mutate()}>Arquivar</Button>}
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
        {editable && <Button variant="primary" loading={save.isPending} disabled={!f.title.trim() || !f.ownerId || (fura && (!f.furaCriterion || f.furaReason.trim().length < 10))} onClick={() => save.mutate()}>{id ? 'Salvar' : fura ? 'Pedir fura-fila' : 'Criar tarefa'}</Button>}
      </>}>
      {id && !c ? <LoadingRows /> : (
        <div className="space-y-4">
          {c?.furaFila && <FuraFilaBox c={c} board={board} onDone={() => done('Decisão registrada', false)} />}
          {id && <div role="tablist" aria-label="Seções da tarefa" className="flex gap-1 border-b border-line">
            {(['detalhes', 'relacionados', 'recursos', 'historico'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={clsx('px-3 py-2 text-sm font-semibold', tab === k ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-ink')} onClick={() => setTab(k)}>
                {{ detalhes: 'Detalhes', relacionados: 'Relacionados', recursos: 'Orçamento e brindes', historico: 'Histórico' }[k]}
              </button>
            ))}
          </div>}
          {(!id || tab === 'detalhes') && (
            <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
              <FormField label="Título" htmlFor="mk-t" required className="sm:col-span-2"><Input id="mk-t" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
              <FormField label="Briefing" htmlFor="mk-b" className="sm:col-span-2" hint="O que, para quem, por quê, formato e referências."><Textarea id="mk-b" rows={4} value={f.briefing} onChange={(e) => setF({ ...f, briefing: e.target.value })} /></FormField>
              <FormField label="Responsável" htmlFor="mk-o" required><Select id="mk-o" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value, observerIds: f.observerIds.filter((x) => x !== e.target.value) })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
              <FormField label="Prazo" htmlFor="mk-d"><Input id="mk-d" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
              <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-semibold text-ink">Observadores</legend>
                <div className="flex flex-wrap gap-1.5">{users.filter((u) => u.id !== f.ownerId).map((u) => {
                  const on = f.observerIds.includes(u.id);
                  return <button key={u.id} type="button" aria-pressed={on} className={clsx('border px-2 py-1 text-xs', on ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line text-muted hover:text-ink')} onClick={() => setF({ ...f, observerIds: on ? f.observerIds.filter((x) => x !== u.id) : [...f.observerIds, u.id] })}>{u.name}</button>;
                })}</div>
              </fieldset>
              <FormField label="Prioridade" htmlFor="mk-p"><Select id="mk-p" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{MKT_PRIORITIES.map((p) => <option key={p} value={p}>{MKT_PRIORITY_LABELS[p]}</option>)}</Select></FormField>
              <FormField label="Esforço (70/20/10)" htmlFor="mk-a"><Select id="mk-a" value={f.allocation} onChange={(e) => setF({ ...f, allocation: e.target.value })}><option value="">Não classificado</option>{MKT_ALLOCATIONS.map((a) => <option key={a} value={a}>{MKT_ALLOCATION_LABELS[a]}</option>)}</Select></FormField>
              <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-semibold text-ink">Verticais</legend>
                <div className="flex flex-wrap gap-1.5">{MKT_VERTICALS.map((v) => {
                  const on = f.verticals.includes(v);
                  return <button key={v} type="button" aria-pressed={on} className={clsx('px-2 py-1 text-xs font-semibold', on ? VERTICAL_STYLE[v] : 'border border-line text-muted')} onClick={() => setF({ ...f, verticals: on ? f.verticals.filter((x) => x !== v) : [...f.verticals, v] })}>{MKT_VERTICAL_LABELS[v]}</button>;
                })}</div>
              </fieldset>
              <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-semibold text-ink">Etiquetas</legend>
                {!board.tags.length ? <p className="text-xs text-muted">Crie etiquetas em “Etiquetas”, no topo do quadro.</p> : (
                  <div className="flex flex-wrap gap-1.5">{board.tags.map((t) => {
                    const on = f.tagIds.includes(t.id);
                    return <button key={t.id} type="button" aria-pressed={on} className={clsx('inline-flex items-center gap-1.5 border px-2 py-1 text-xs', on ? 'border-ink font-semibold text-ink' : 'border-line text-muted')} onClick={() => setF({ ...f, tagIds: on ? f.tagIds.filter((x) => x !== t.id) : [...f.tagIds, t.id] })}><span className="h-2.5 w-2.5" style={{ background: t.color }} />{t.name}</button>;
                  })}</div>
                )}
              </fieldset>
              <FormField label="Quem pediu" htmlFor="mk-r" hint="Comercial, CS, RH, Diretoria…"><Input id="mk-r" value={f.requester} maxLength={120} onChange={(e) => setF({ ...f, requester: e.target.value })} /></FormField>
              <FormField label="Sprint" htmlFor="mk-s"><Select id="mk-s" value={f.sprintId} onChange={(e) => setF({ ...f, sprintId: e.target.value })}><option value="">Sem Sprint (backlog)</option>{board.sprints.filter((s) => s.status !== 'encerrada').map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'aberta' ? ' (fechada: fura-fila)' : ''}</option>)}</Select></FormField>
              {!id && !fura && <FormField label="Coluna" htmlFor="mk-c"><Select id="mk-c" value={f.column} onChange={(e) => setF({ ...f, column: e.target.value as MktColumn })}>{MKT_COLUMNS.map((k) => <option key={k} value={k}>{MKT_COLUMN_LABELS[k]}</option>)}</Select></FormField>}
              {fura && (
                <div className="space-y-2 border border-[#B45309]/40 bg-[#FFF7E6] p-3 sm:col-span-2">
                  <p className="text-sm font-semibold text-[#92400E]">Sprint fechada: esta demanda entra como fura-fila e precisa da aprovação da liderança.</p>
                  <FormField label="Critério" htmlFor="mk-fc" required><Select id="mk-fc" value={f.furaCriterion} onChange={(e) => setF({ ...f, furaCriterion: e.target.value })}><option value="">Escolha</option>{FURA_FILA_CRITERIA.map((k) => <option key={k} value={k}>{FURA_FILA_LABELS[k]}</option>)}</Select></FormField>
                  <FormField label="Justificativa" htmlFor="mk-fr" required><Textarea id="mk-fr" rows={2} value={f.furaReason} onChange={(e) => setF({ ...f, furaReason: e.target.value })} /></FormField>
                </div>
              )}
            </fieldset>
          )}
          {id && tab === 'relacionados' && c && <Related c={c} />}
          {id && tab === 'recursos' && (
            <fieldset disabled={!editable} className="space-y-4">
              <section aria-label="Consumo de orçamento" className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Wallet className="h-4 w-4 text-primary" aria-hidden />Consumo de orçamento</h3>
                {!res.data?.costCenters.length ? <p className="text-xs text-muted">Você não tem centro de custo no módulo Recursos e Orçamento. Informe só o valor previsto.</p> : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <FormField label="Centro de custo" htmlFor="mk-cc"><Select id="mk-cc" value={f.costCenterId} onChange={(e) => setF({ ...f, costCenterId: e.target.value, budgetLineId: '' })}><option value="">Sem vínculo</option>{res.data.costCenters.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select></FormField>
                    <FormField label="Item aprovado do orçamento" htmlFor="mk-bl"><Select id="mk-bl" value={f.budgetLineId} onChange={(e) => setF({ ...f, budgetLineId: e.target.value })}><option value="">Sem item</option>{res.data.lines.filter((l) => !f.costCenterId || l.costCenterId === f.costCenterId).map((l) => <option key={l.id} value={l.id}>{l.what} · {l.month} · {fmtBRL(l.amountCents)}</option>)}</Select></FormField>
                  </div>
                )}
                <FormField label="Valor previsto para esta ação (R$)" htmlFor="mk-bv"><Input id="mk-bv" inputMode="decimal" className="num w-48" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></FormField>
                {c?.budgetLine && <p className="text-xs text-muted">Item do orçamento: {c.budgetLine.what} ({c.budgetLine.month}) · aprovado {fmtBRL(c.budgetLine.amountCents)}</p>}
              </section>
              <section aria-label="Brindes" className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Gift className="h-4 w-4 text-primary" aria-hidden />Brindes da ação</h3>
                {!res.data?.gifts.length ? <p className="text-xs text-muted">Nenhum brinde no catálogo (Marketing → Brindes).</p> : (
                  <>
                    <ul className="space-y-1">{f.gifts.map((g, i) => {
                      const it = res.data!.gifts.find((x) => x.id === g.itemId);
                      return (
                        <li key={g.itemId} className="flex items-center gap-2 text-sm">
                          <span className="flex-1">{it?.name}</span>
                          <Input aria-label={`Quantidade de ${it?.name}`} inputMode="numeric" className="num w-20" value={String(g.qty)} onChange={(e) => setF({ ...f, gifts: f.gifts.map((x, k) => (k === i ? { ...x, qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) } : x)) })} />
                          <span className="num w-24 text-right text-muted">{fmtBRL((it?.unitCostCents ?? 0) * g.qty)}</span>
                          <button type="button" aria-label={`Tirar ${it?.name}`} className="text-muted hover:text-danger" onClick={() => setF({ ...f, gifts: f.gifts.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button>
                        </li>
                      );
                    })}</ul>
                    <Select aria-label="Adicionar brinde" value="" onChange={(e) => e.target.value && setF({ ...f, gifts: [...f.gifts, { itemId: e.target.value, qty: 1 }] })}>
                      <option value="">Adicionar brinde…</option>{res.data.gifts.filter((g) => !f.gifts.some((x) => x.itemId === g.id)).map((g) => <option key={g.id} value={g.id}>{g.name} · {fmtBRL(g.unitCostCents)}</option>)}
                    </Select>
                    {!!f.gifts.length && <p className="text-sm text-ink">Custo dos brindes: <b className="num">{fmtBRL(giftCost)}</b></p>}
                  </>
                )}
              </section>
            </fieldset>
          )}
          {id && tab === 'historico' && c && <History c={c} />}
        </div>
      )}
    </Drawer>
  );
}

function FuraFilaBox({ c, board, onDone }: { c: Detail; board: Board; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [resched, setResched] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (approve: boolean) => api(`/marketing/quadro/cards/${c.id}/fura-fila`, { method: 'POST', body: { approve, note: note || null, rescheduled: Object.entries(resched).filter(([, d]) => d).map(([cardId, dueOn]) => ({ cardId, dueOn })) } }),
    onSuccess: onDone, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const sprintCards = board.cards.filter((x) => x.sprintId === c.sprintId && x.id !== c.id && x.column !== 'concluido');
  return (
    <section aria-label="Fura-fila" className="space-y-2 border border-[#B45309]/40 bg-[#FFF7E6] p-3 text-sm">
      <p className="font-semibold text-[#92400E]"><Zap className="mr-1 inline h-4 w-4" aria-hidden />Fura-fila {c.furaFilaStatus === 'pendente' ? 'aguardando a liderança' : c.furaFilaStatus}</p>
      <p><b>{FURA_FILA_LABELS[c.furaFilaCriterion as keyof typeof FURA_FILA_LABELS] ?? ''}</b>{c.furaFilaReason ? ` — ${c.furaFilaReason}` : ''}</p>
      {c.furaFilaStatus === 'pendente' && c.canLead && (
        <>
          {!!sprintCards.length && (
            <details><summary className="cursor-pointer font-semibold text-primary">Reprogramar tarefas impactadas</summary>
              <ul className="mt-1 space-y-1">{sprintCards.map((x) => (
                <li key={x.id} className="flex items-center gap-2"><span className="flex-1">{x.title} <span className="text-muted">({fmtDate(x.dueOn)})</span></span><Input aria-label={`Novo prazo de ${x.title}`} type="date" className="w-40" value={resched[x.id] ?? ''} onChange={(e) => setResched({ ...resched, [x.id]: e.target.value })} /></li>
              ))}</ul>
            </details>
          )}
          <FormField label="Observação (obrigatória para recusar)" htmlFor="ff-n"><Input id="ff-n" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <div className="flex gap-2"><Button variant="primary" loading={decide.isPending} onClick={() => decide.mutate(true)}>Aprovar fura-fila</Button><Button variant="ghost" onClick={() => decide.mutate(false)}>Recusar</Button></div>
        </>
      )}
    </section>
  );
}

function Related({ c }: { c: Detail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const found = useQuery({ queryKey: ['marketing', 'relacionaveis', q], enabled: q.trim().length >= 2, queryFn: () => api<{ items: { entityType: string; entityId: string; label: string }[] }>(`/marketing/quadro/relacionaveis${qs({ q })}`) });
  const add = useMutation({ mutationFn: (x: { entityType: string; entityId: string }) => api('/marketing/quadro/links', { method: 'POST', body: { cardId: c.id, ...x } }), onSuccess: () => { setQ(''); void qc.invalidateQueries({ queryKey: ['marketing'] }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const del = useMutation({ mutationFn: (id: string) => api(`/marketing/quadro/links/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['marketing'] }) });
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">Relacione oportunidades, contas, leads, campanhas, contratos e tarefas da ferramenta a esta ação. As etiquetas do cartão também trazem o que está relacionado a elas.</p>
      {c.canEdit && (
        <div>
          <Input aria-label="Buscar para relacionar" placeholder="Buscar oportunidade, conta, lead, campanha, contrato ou tarefa" value={q} onChange={(e) => setQ(e.target.value)} />
          {!!found.data?.items.length && (
            <ul className="mt-1 max-h-56 overflow-auto border border-line">{found.data.items.map((x) => (
              <li key={`${x.entityType}${x.entityId}`}><button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2" onClick={() => add.mutate(x)}><span className="w-24 shrink-0 text-xs text-muted">{MKT_LINK_LABELS[x.entityType as keyof typeof MKT_LINK_LABELS]}</span>{x.label}</button></li>
            ))}</ul>
          )}
        </div>
      )}
      <ul aria-label="Relacionados" className="divide-y divide-line border border-line">
        {!c.links.length && !c.tagLinks.length && <li className="px-3 py-3 text-muted">Nada relacionado ainda.</li>}
        {c.links.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-3 py-2"><span className="w-24 shrink-0 text-xs text-muted">{MKT_LINK_LABELS[l.entityType as keyof typeof MKT_LINK_LABELS]}</span><a className="flex-1 font-semibold text-primary hover:underline" href={l.url}>{l.label}</a>{c.canEdit && <button type="button" aria-label={`Desfazer ${l.label}`} className="text-muted hover:text-danger" onClick={() => del.mutate(l.id)}><Trash2 className="h-4 w-4" /></button>}</li>
        ))}
        {c.tagLinks.map((l) => (
          <li key={`t${l.id}`} className="flex items-center gap-2 px-3 py-2"><span className="w-24 shrink-0 text-xs text-muted">{MKT_LINK_LABELS[l.entityType as keyof typeof MKT_LINK_LABELS]}</span><a className="flex-1 text-primary hover:underline" href={l.url}>{l.label}</a><span className="text-2xs text-muted">pela etiqueta</span></li>
        ))}
      </ul>
    </div>
  );
}

function History({ c }: { c: Detail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const add = useMutation({ mutationFn: () => api(`/marketing/quadro/cards/${c.id}/comentarios`, { method: 'POST', body: { text } }), onSuccess: () => { setText(''); void qc.invalidateQueries({ queryKey: ['marketing', 'card', c.id] }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-2"><Textarea aria-label="Comentário" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Comente, sinalize bloqueios e riscos" /><Button variant="primary" disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate()}>Comentar</Button></div>
      <ul className="space-y-2">{c.events.map((e) => (
        <li key={e.id} className="border-l-2 border-line pl-3"><p className="text-xs text-muted">{fmtDateTime(e.createdAt)} · {e.actor ?? 'Sistema'} · {e.type.replace('_', ' ')}</p>{e.text && <p className="whitespace-pre-line text-ink">{e.text}</p>}</li>
      ))}</ul>
    </div>
  );
}

function SprintModal({ kind, board, onClose }: { kind: 'nova' | 'abrir' | 'encerrar'; board: Board; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sp = kind === 'abrir' ? board.sprints.find((s) => s.id === board.sprint?.id && s.status === 'planejamento') : board.sprint;
  const next = board.sprints[0] ? new Date(Date.parse(`${board.sprints[0].endOn}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : board.today;
  const [startOn, setStart] = useState(next);
  const [objective, setObjective] = useState(sp?.objective ?? '');
  const [highlights, setHighlights] = useState(sp?.highlights ?? '');
  const [email, setEmail] = useState<{ subject: string; text: string } | null>(null);
  const [to, setTo] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['marketing'] });
  const create = useMutation({ mutationFn: () => api('/marketing/quadro/sprints', { method: 'POST', body: { startOn, objective: objective || null } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Sprint planejada' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const act = useMutation({
    mutationFn: async () => {
      if (kind === 'abrir') { await api(`/marketing/quadro/sprints/${sp!.id}`, { method: 'PATCH', body: { objective: objective || null } }); return api<{ email: { subject: string; text: string } }>(`/marketing/quadro/sprints/${sp!.id}/abrir`, { method: 'POST' }); }
      return api<{ email: { subject: string; text: string } }>(`/marketing/quadro/sprints/${sp!.id}/encerrar`, { method: 'POST', body: { highlights: highlights || null } });
    },
    onSuccess: (r) => { refresh(); setEmail(r.email); toast({ tone: 'success', message: kind === 'abrir' ? 'Sprint aberta: escopo fechado' : 'Sprint encerrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const send = useMutation({ mutationFn: () => api(`/marketing/quadro/sprints/${sp!.id}/comunicar`, { method: 'POST', body: { to: to.split(/[,;\s]+/).filter(Boolean), subject: email!.subject, text: email!.text } }), onSuccess: () => { toast({ tone: 'success', message: 'Comunicação enviada' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const title = kind === 'nova' ? 'Planejar Sprint' : kind === 'abrir' ? 'Abrir Sprint' : 'Encerrar Sprint';
  return (
    <Modal open onClose={onClose} size="lg" title={email ? `Comunicação oficial · ${kind === 'abrir' ? 'abertura' : 'encerramento'}` : title}
      footer={email ? <><Button variant="ghost" onClick={() => { void navigator.clipboard?.writeText(`${email.subject}\n\n${email.text}`); toast({ tone: 'success', message: 'Texto copiado' }); }}>Copiar texto</Button><Button variant="primary" disabled={!to.trim()} loading={send.isPending} onClick={() => send.mutate()}>Enviar por e-mail</Button></>
        : <><Button variant="ghost" onClick={onClose}>Cancelar</Button>{kind === 'nova' ? <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>Planejar</Button> : <Button variant="primary" loading={act.isPending} disabled={!sp} onClick={() => act.mutate()}>{title}</Button>}</>}>
      {email ? (
        <div className="space-y-3">
          <FormField label="Para (e-mails separados por vírgula)" htmlFor="sp-to"><Input id="sp-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="comercial@empresa.test, cs@empresa.test" /></FormField>
          <FormField label="Assunto" htmlFor="sp-s"><Input id="sp-s" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} /></FormField>
          <FormField label="Texto" htmlFor="sp-x"><Textarea id="sp-x" rows={16} value={email.text} onChange={(e) => setEmail({ ...email, text: e.target.value })} /></FormField>
        </div>
      ) : kind === 'nova' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Início" htmlFor="sp-i" hint="A Sprint dura 15 dias."><Input id="sp-i" type="date" value={startOn} onChange={(e) => setStart(e.target.value)} /></FormField>
          <FormField label="Objetivo da Sprint" htmlFor="sp-o" className="sm:col-span-2"><Input id="sp-o" value={objective} maxLength={500} onChange={(e) => setObjective(e.target.value)} placeholder="Em uma frase, o principal objetivo da quinzena" /></FormField>
        </div>
      ) : !sp ? <EmptyState title="Nenhuma Sprint nesta situação" /> : kind === 'abrir' ? (
        <div className="space-y-3 text-sm">
          <p>Ao abrir, o escopo fecha: novas demandas só entram por fura-fila. Todas as tarefas da Sprint precisam de prazo.</p>
          <p className="text-muted">{board.cards.filter((c) => c.sprintId === sp.id).length} tarefa(s) na Sprint.</p>
          <FormField label="Objetivo da Sprint" htmlFor="sp-o2"><Input id="sp-o2" value={objective} maxLength={500} onChange={(e) => setObjective(e.target.value)} /></FormField>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>As tarefas não concluídas saem da Sprint e seguem para a próxima, com o registro no cartão.</p>
          <FormField label="Destaques do período" htmlFor="sp-h"><Textarea id="sp-h" rows={4} value={highlights} onChange={(e) => setHighlights(e.target.value)} placeholder="Resultados, impactos e aprendizados" /></FormField>
        </div>
      )}
    </Modal>
  );
}

function TagsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['marketing', 'tags'], queryFn: () => api<{ items: (TagT & { links: { id: string; entityType: string; label: string; url: string }[]; cards: { id: string; code: number; title: string }[] })[] }>('/marketing/quadro/tags') });
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2F5986');
  const [linking, setLinking] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['marketing', 'relacionaveis', search], enabled: !!linking && search.trim().length >= 2, queryFn: () => api<{ items: { entityType: string; entityId: string; label: string }[] }>(`/marketing/quadro/relacionaveis${qs({ q: search })}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['marketing'] });
  const create = useMutation({ mutationFn: () => api('/marketing/quadro/tags', { method: 'POST', body: { name, color } }), onSuccess: () => { setName(''); refresh(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const del = useMutation({ mutationFn: (id: string) => api(`/marketing/quadro/tags/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const link = useMutation({ mutationFn: (x: { entityType: string; entityId: string }) => api('/marketing/quadro/links', { method: 'POST', body: { tagId: linking, ...x } }), onSuccess: () => { setSearch(''); refresh(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const unlink = useMutation({ mutationFn: (id: string) => api(`/marketing/quadro/links/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  return (
    <Modal open onClose={onClose} size="lg" title="Etiquetas do Marketing" footer={<Button onClick={onClose}>Fechar</Button>}>
      <p className="mb-3 text-sm text-muted">Uma etiqueta junta tarefas do quadro e atividades da ferramenta (oportunidades, contas, leads, campanhas, contratos e tarefas) sob a mesma ação de Marketing.</p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <FormField label="Nova etiqueta" htmlFor="tg-n"><Input id="tg-n" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Campanha Hexa" /></FormField>
        <FormField label="Cor" htmlFor="tg-c"><input id="tg-c" type="color" className="h-10 w-14 border border-line" value={color} onChange={(e) => setColor(e.target.value)} /></FormField>
        <Button variant="primary" disabled={name.trim().length < 2} loading={create.isPending} onClick={() => create.mutate()}>Criar</Button>
      </div>
      {!q.data ? <LoadingRows /> : !q.data.items.length ? <p className="text-sm text-muted">Nenhuma etiqueta ainda.</p> : (
        <ul className="space-y-3">{q.data.items.map((t) => (
          <li key={t.id} aria-label={`Etiqueta ${t.name}`} className="border border-line p-3">
            <div className="flex items-center gap-2"><span className="h-3 w-3" style={{ background: t.color }} /><b className="flex-1 text-ink">{t.name}</b>
              <Button size="sm" variant="ghost" icon={<Link2 className="h-4 w-4" />} onClick={() => { setLinking(linking === t.id ? null : t.id); setSearch(''); }}>Relacionar</Button>
              <button type="button" aria-label={`Excluir etiqueta ${t.name}`} className="text-muted hover:text-danger" onClick={() => del.mutate(t.id)}><Trash2 className="h-4 w-4" /></button>
            </div>
            {linking === t.id && (
              <div className="mt-2">
                <Input aria-label={`Buscar para relacionar a ${t.name}`} placeholder="Buscar oportunidade, conta, lead, campanha, contrato ou tarefa" value={search} onChange={(e) => setSearch(e.target.value)} />
                {!!found.data?.items.length && <ul className="mt-1 max-h-48 overflow-auto border border-line">{found.data.items.map((x) => (
                  <li key={`${x.entityType}${x.entityId}`}><button type="button" className="flex w-full gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => link.mutate(x)}><span className="w-24 shrink-0 text-xs text-muted">{MKT_LINK_LABELS[x.entityType as keyof typeof MKT_LINK_LABELS]}</span>{x.label}</button></li>
                ))}</ul>}
              </div>
            )}
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div><p className="text-xs font-semibold text-muted">Tarefas do quadro ({t.cards.length})</p><ul>{t.cards.map((c) => <li key={c.id}>MKT-{c.code} · {c.title}</li>)}</ul></div>
              <div><p className="text-xs font-semibold text-muted">Atividades relacionadas ({t.links.length})</p><ul>{t.links.map((l) => <li key={l.id} className="flex items-center gap-1"><a className="flex-1 text-primary hover:underline" href={l.url}>{MKT_LINK_LABELS[l.entityType as keyof typeof MKT_LINK_LABELS]}: {l.label}</a><button type="button" aria-label={`Desfazer ${l.label}`} className="text-muted hover:text-danger" onClick={() => unlink.mutate(l.id)}><Trash2 className="h-3.5 w-3.5" /></button></li>)}</ul></div>
            </div>
          </li>
        ))}</ul>
      )}
    </Modal>
  );
}
