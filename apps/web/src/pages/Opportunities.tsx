import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type Announcements, type DragEndEvent } from '@dnd-kit/core';
import { BarChart3, CheckCircle2, ClipboardList, Clock3, Columns3, List, Maximize2, Minimize2, MoreVertical, Plus, Search, Send, SlidersHorizontal, UserRound } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtRelativeShort } from '../lib/format';
import { useDebounced, useLookups, useUrlState } from '../lib/hooks';
import type { Kpi, LookupStage, Opportunity, Paged, PipelineStage } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Button, Chip, EmptyState, ErrorState, FormField, Input, KpiCard, LoadingRows, Pagination, Select } from '../components/ui/primitives';
import { DateRange } from '../components/ui/DateRange';
import { PageHeader } from '../components/layout/PageHeader';
import { CLOSING_TAG, SourceChip, StageChip, inkOf, productLabel, stageColor } from '../components/badges';
import { TransitionDialog, needsDialog, type TransitionRequest } from '../features/TransitionDialog';
import { useTransitionMutation } from '../features/useTransition';

function CardMenu({ opp, onMove, stages }: { opp: Opportunity; onMove: (to: string) => void; stages: LookupStage[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button className="rounded-sm p-0.5 text-ink hover:bg-surface-2" aria-label={`Mover ${opp.contactName} para outra etapa`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreVertical className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-line bg-surface py-1 text-sm shadow-overlay">
          <li className="px-3 py-1 text-xs text-muted">Mover para</li>
          {stages.filter((s) => s.key !== opp.stage).map((s, i) => (
            <li key={s.key}>
              <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2" onClick={() => { setOpen(false); onMove(s.key); }}>
                <span className="h-2.5 w-2.5 rounded-circle" style={{ background: stageColor(s.key, s.color, i) }} aria-hidden />
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({ opp, onMove, canMove, stages, compact }: { opp: Opportunity; onMove: (o: Opportunity, to: string) => void; canMove: boolean; stages: LookupStage[]; compact?: boolean }) {
  const nav = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: opp.id, data: { opp }, disabled: !canMove });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const tag = opp.stage === 'fechamento' ? CLOSING_TAG[opp.contractRequestStatus] : null;
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-roledescription="cartão arrastável"
      aria-label={`${opp.contactName}, ${opp.planName ?? 'sem plano'}. Espaço para pegar e setas para mover; Enter abre.`}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter' && !isDragging) nav(`/opportunities/${opp.id}`);
      }}
      onClick={() => nav(`/opportunities/${opp.id}`)}
      className={clsx('cursor-pointer rounded-md bg-surface shadow-card ring-1 ring-line/70 hover:ring-line-strong', compact ? 'p-2' : 'p-3', isDragging && 'z-30 opacity-90 shadow-overlay')}
    >
      {compact ? (
        // ajustado à tela (como no RD Station): negociação, responsável, valor, tempo em aberto e a tarefa
        <>
          <div className="flex items-start gap-1">
            <p className="line-clamp-2 min-w-0 flex-1 break-words text-xs font-semibold leading-snug text-ink" title={opp.title}>{opp.title || opp.contactName}</p>
            {canMove && <CardMenu opp={opp} stages={stages} onMove={(to) => onMove(opp, to)} />}
          </div>
          {opp.title && opp.title !== opp.contactName && <p className="truncate text-2xs text-muted" title={opp.contactName}>{opp.contactName}</p>}
          <div className="mt-1.5 flex items-center gap-1.5 text-2xs text-muted">
            <Avatar name={opp.ownerName} userId={opp.ownerId} hasPhoto={opp.ownerHasAvatar} size={18} />
            <span className="num min-w-0 truncate text-xs text-text">{opp.valueCents !== null ? fmtBRL(opp.valueCents) : 'Sem valor'}</span>
            <span className="ml-auto flex shrink-0 items-center gap-0.5" title={`Aberta há ${opp.ageDays} dia(s) · ${opp.daysInStage} dia(s) nesta etapa`}><Clock3 className="h-3 w-3" aria-hidden />{opp.ageDays}d</span>
          </div>
          <div className={clsx('mt-1.5 flex items-center gap-1 border-t border-line pt-1.5 text-2xs', opp.overdue ? 'text-danger' : opp.missingNextAction ? 'text-[#C2610C]' : 'text-muted')}>
            <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={opp.nextAction ?? undefined}>{opp.nextAction ?? 'Sem tarefa'}</span>
            {opp.nextActionAt && <span className="num shrink-0 whitespace-nowrap">{fmtRelativeShort(opp.nextActionAt)}</span>}
          </div>
          {tag && <div className="mt-1"><Chip tone={tag.tone}>{tag.label}</Chip></div>}
        </>
      ) : (<>
      <div className="flex items-start gap-2">
        <Avatar name={opp.contactName} size={34} tone={0} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-sm font-bold leading-tight text-ink">{opp.contactName}</p>
          <p className="truncate text-xs text-muted">{productLabel(opp.contactSegment)}</p>
          <p className="num mt-1 text-sm font-bold text-ink">{opp.valueCents !== null ? fmtBRL(opp.valueCents) : <span className="font-medium text-muted">Sem plano</span>}</p>
        </div>
        <Avatar name={opp.ownerName} userId={opp.ownerId} hasPhoto={opp.ownerHasAvatar} size={24} />
        {canMove && <CardMenu opp={opp} stages={stages} onMove={(to) => onMove(opp, to)} />}
      </div>
      {opp.accountContracts && (
        <div className="mt-2.5 border-t border-line pt-2" aria-label={`Contratos de ${opp.contactName}`}>
          <p className="mb-1 text-2xs font-semibold text-muted">{opp.accountContracts.length ? `${opp.accountContracts.length} contrato${opp.accountContracts.length > 1 ? 's' : ''} vigente${opp.accountContracts.length > 1 ? 's' : ''}` : 'Sem contrato vigente'}</p>
          <ul className="space-y-1">
            {opp.accountContracts.slice(0, 4).map((c) => (
              <li key={c.id}>
                <a href={`/contracts/${c.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); nav(`/contracts/${c.id}`); }} onPointerDown={(e) => e.stopPropagation()} className="flex items-baseline justify-between gap-2 text-xs hover:text-primary" title={c.object}>
                  <span className="min-w-0 truncate text-ink">{c.number} · {c.object.replace(/ \(fictício\)$/, '')}</span>
                  <span className="num shrink-0 text-muted">{c.billingType === 'recorrente' ? `${fmtBRL(c.monthlyCents)}/mês` : c.billingType === 'medicao' ? 'medição' : 'frequente'}</span>
                </a>
              </li>
            ))}
          </ul>
          {opp.accountContracts.length > 4 && <p className="mt-1 text-2xs text-muted">+{opp.accountContracts.length - 4} contrato(s)</p>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {tag ? <Chip tone={tag.tone}>{tag.label}</Chip> : opp.accountContracts ? <span className="text-2xs text-muted">Conta</span> : <SourceChip name={opp.sourceName} />}
        <span className={clsx('ml-auto shrink-0 whitespace-nowrap text-xs', opp.overdue ? 'font-semibold text-danger' : 'text-muted')}>{fmtRelativeShort(opp.nextActionAt ?? opp.updatedAt)}</span>
      </div>
      </>)}
    </li>
  );
}

function Column({ stage, children, onAdd, index, compact }: { stage: PipelineStage; children: React.ReactNode; onAdd: () => void; index: number; compact?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  const c = stageColor(stage.key, stage.color, index);
  return (
    <section ref={setNodeRef} aria-labelledby={`col-${stage.key}`} style={{ background: `${c}14` }} className={clsx('flex flex-1 basis-0 flex-col rounded-lg', compact ? 'min-w-[128px] p-1.5' : 'min-w-[214px] p-2.5', isOver && 'ring-2 ring-primary')}>
      <header className={clsx('px-1', compact ? 'mb-2' : 'mb-3')}>
        <div className="flex items-center justify-between gap-1">
          <h2 id={`col-${stage.key}`} className={clsx('flex min-w-0 items-center gap-1.5 font-bold text-ink', compact ? 'text-sm' : 'text-lg')}>
            <span className="truncate" title={stage.name}>{stage.name}</span>
            <span className={clsx('num inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white', compact ? 'h-5 min-w-5 px-1 text-2xs' : 'h-6 min-w-6 px-1.5 text-xs')} style={{ background: c }}>{stage.count}</span>
          </h2>
          <button onClick={onAdd} className="shrink-0 rounded-sm p-1 hover:bg-white/60" style={{ color: inkOf(c) }} aria-label={`Nova oportunidade (${stage.name})`}><Plus className={compact ? 'h-4 w-4' : 'h-5 w-5'} /></button>
        </div>
        <p className={clsx('num mt-0.5 truncate text-muted', compact ? 'text-xs' : 'mt-1 text-md')}>{fmtBRL(stage.valueCents)}</p>
      </header>
      {children}
    </section>
  );
}

export function OpportunitiesPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const nav = useNavigate();
  const [f, setF] = useUrlState({ q: '', ownerId: '', sourceId: '', planId: '', pipelineId: '', from: '', to: '', view: 'kanban', status: 'abertas', page: '1', size: '10' });
  const [advanced, setAdvanced] = useState(false);
  const advRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!advanced) return;
    const close = (e: MouseEvent) => { if (!advRef.current?.contains(e.target as Node)) setAdvanced(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [advanced]);
  const journeys = (lookups.data?.pipelines ?? []).filter((p) => p.allowed);
  const [search, setSearch] = useState(f.q);
  const dq = useDebounced(search);
  useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const kanban = f.view === 'kanban';
  // Kanban ajustado à tela (todas as etapas visíveis): padrão ligado, escolha lembrada neste navegador
  const [fit, setFit] = useState(() => { try { return localStorage.getItem('isp:kanban-fit') !== '0'; } catch { return true; } });
  const setFitPersist = (v: boolean) => { setFit(v); try { localStorage.setItem('isp:kanban-fit', v ? '1' : '0'); } catch { /* sem armazenamento */ } };
  const filters = { q: f.q, ownerId: f.ownerId, sourceId: f.sourceId, planId: f.planId, pipelineId: f.pipelineId, from: f.from, to: f.to };
  const advancedCount = [f.ownerId, f.sourceId, f.planId, !kanban && f.status !== 'abertas' ? f.status : ''].filter(Boolean).length;
  const summary = useQuery({ queryKey: ['opportunities', 'summary'], queryFn: () => api<{ kpis: Kpi[] }>('/opportunities/summary') });
  const pipe = useQuery({ queryKey: ['pipeline', filters], enabled: kanban, queryFn: () => api<{ pipeline: { id: string; name: string }; stages: PipelineStage[] }>(`/pipeline${qs(filters)}`) });
  const currentPipelineId = f.pipelineId || pipe.data?.pipeline.id || journeys.find((p) => p.isDefault)?.id || '';
  const stageList = (pipelineId: string) => lookups.data?.pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
  const list = useQuery({ queryKey: ['opportunities', 'list', f], enabled: !kanban, placeholderData: keepPreviousData, queryFn: () => api<Paged<Opportunity>>(`/opportunities${qs({ ...filters, status: f.status, page: f.page, pageSize: f.size })}`) });
  const transition = useTransitionMutation();
  const [pending, setPending] = useState<TransitionRequest | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const stages = pipe.data?.stages ?? [];

  const requestMove = (opp: Opportunity, to: string) => {
    if (opp.stage === to) return;
    const list = stageList(opp.pipelineId);
    const target = list.find((x) => x.key === to);
    if (!target) return;
    const req: TransitionRequest = { opp, from: opp.stage, to, fromName: list.find((x) => x.key === opp.stage)?.name ?? opp.stage, toName: target.name, toKind: target.kind, requirements: target.requirements ?? {}, title: opp.contactName };
    if (needsDialog(req)) setPending(req);
    else transition.mutate({ opp, payload: { toStage: to } });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const opp = e.active.data.current?.opp as Opportunity | undefined;
    const to = e.over?.id as string | undefined;
    if (opp && to) requestMove(opp, to);
  };
  const nameOf = (k: string) => stages.find((x) => x.key === k)?.name ?? k;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Pegou ${(active.data.current?.opp as Opportunity).contactName}.`,
    onDragOver: ({ over }) => (over ? `Sobre a coluna ${nameOf(String(over.id))}.` : 'Fora das colunas.'),
    onDragEnd: ({ over }) => (over ? `Solto em ${nameOf(String(over.id))}.` : 'Movimento cancelado.'),
    onDragCancel: () => 'Movimento cancelado.',
  };
  const kpiLook = [
    { icon: <UserRound className="h-7 w-7" />, tone: 'blue' as const },
    { icon: <BarChart3 className="h-7 w-7" />, tone: 'green' as const },
    { icon: <Clock3 className="h-7 w-7" />, tone: 'orange' as const },
    { icon: <Send className="h-7 w-7" />, tone: 'purple' as const },
    { icon: <CheckCircle2 className="h-7 w-7" />, tone: 'green' as const },
  ];

  return (
    <div className="w-full">
      <PageHeader
        icon={<ClipboardList className="h-9 w-9" strokeWidth={2.2} />}
        title="Oportunidades"
        subtitle="Visualize e gerencie seu funil de vendas de forma simples."
        actions={<Button variant="primary" size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => nav(`/opportunities/new${qs({ pipelineId: f.pipelineId })}`)}>Nova oportunidade</Button>}
      />

      <section aria-label="Indicadores" className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {(summary.data?.kpis ?? []).map((k, i) => <KpiCard key={k.key} k={k} icon={kpiLook[i]!.icon} tone={kpiLook[i]!.tone} />)}
        {!summary.data && Array.from({ length: 5 }).map((_, i) => <div key={i} className="card h-[92px] animate-pulse" />)}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-3" role="search">
        <div className="flex rounded-md border border-line bg-surface p-1" role="group" aria-label="Visualização">
          <button aria-pressed={kanban} onClick={() => setF({ view: 'kanban' })} className={clsx('flex items-center gap-2 rounded-sm px-4 py-2 text-md', kanban ? 'bg-primary-soft font-semibold text-primary' : 'text-ink')}><Columns3 className="h-5 w-5" />Kanban</button>
          <button aria-pressed={!kanban} onClick={() => setF({ view: 'lista' })} className={clsx('flex items-center gap-2 rounded-sm px-4 py-2 text-md', !kanban ? 'bg-primary-soft font-semibold text-primary' : 'text-ink')}><List className="h-5 w-5" />Lista</button>
        </div>
        {kanban && <Button size="lg" aria-pressed={fit} aria-label={fit ? 'Colunas largas' : 'Ajustar à tela'} icon={fit ? <Maximize2 className="h-5 w-5" /> : <Minimize2 className="h-5 w-5" />} onClick={() => setFitPersist(!fit)} title={fit ? 'Colunas largas (rolagem para o lado)' : 'Ajustar à tela: todas as etapas numa tela só'} />}
        {journeys.length > 1 && (
          <Select aria-label="Funil" className="h-12 w-auto min-w-[200px] font-semibold" value={kanban ? currentPipelineId : f.pipelineId || 'todas'} onChange={(e) => (e.target.value === 'todas' ? setF({ pipelineId: '', view: 'lista' }) : setF({ pipelineId: e.target.value }))}>
            {journeys.map((p) => <option key={p.id} value={p.id}>Funil: {p.name}</option>)}
            <option value="todas">Todos os funis (lista)</option>
          </Select>
        )}
        <div className="relative min-w-[180px] flex-1 lg:max-w-[320px]">
          <label htmlFor="op-q" className="sr-only">Buscar oportunidades</label>
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden />
          <Input id="op-q" className="h-12 pl-10" placeholder="Buscar oportunidades..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <DateRange label="Criadas" emptyLabel="Todo o período" from={f.from} to={f.to} onChange={(r) => setF(r)} />
        <div className="relative ml-auto" ref={advRef}>
          <Button size="lg" aria-expanded={advanced} icon={<SlidersHorizontal className="h-5 w-5" />} onClick={() => setAdvanced((v) => !v)}>Filtro avançado{advancedCount ? ` (${advancedCount})` : ''}</Button>
          {advanced && (
            <div role="dialog" aria-label="Filtro avançado" className="absolute right-0 z-30 mt-2 w-[320px] space-y-3 border border-line bg-surface p-4 shadow-overlay">
              {can('oportunidades', 'equipe') && (
                <FormField label="Responsável" htmlFor="af-owner">
                  <Select id="af-owner" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value })}>
                    <option value="">Todos os responsáveis</option>
                    <option value="me">Minhas</option>
                    {lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </FormField>
              )}
              <FormField label="Origem" htmlFor="af-source">
                <Select id="af-source" value={f.sourceId} onChange={(e) => setF({ sourceId: e.target.value })}>
                  <option value="">Todas as origens</option>
                  {lookups.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Plano" htmlFor="af-plan">
                <Select id="af-plan" value={f.planId} onChange={(e) => setF({ planId: e.target.value })}>
                  <option value="">Todos os planos</option>
                  {lookups.data?.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </FormField>
              {!kanban && (
                <FormField label="Situação" htmlFor="af-status">
                  <Select id="af-status" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
                    <option value="abertas">Abertas</option>
                    <option value="encerradas">Encerradas</option>
                    <option value="todas">Todas</option>
                  </Select>
                </FormField>
              )}
              <div className="flex justify-between gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setF({ q: '', ownerId: '', sourceId: '', planId: '', from: '', to: '', status: 'abertas' }); }}>Limpar todos os filtros</Button>
                <Button size="sm" variant="primary" onClick={() => setAdvanced(false)}>Fechar</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {kanban ? (
        pipe.isLoading ? <div className="card"><LoadingRows /></div> : pipe.isError ? <ErrorState error={pipe.error} onRetry={() => pipe.refetch()} /> : (
          <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ announcements, screenReaderInstructions: { draggable: 'Pressione espaço para pegar o cartão, use as setas para escolher a coluna e espaço para soltar. Esc cancela. Também é possível usar o menu do cartão.' } }}>
            <div className={clsx('scroll-thin -mx-4 flex overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6', fit ? 'gap-1.5' : 'gap-3')}>
              {stages.map((s, i) => (
                <Column key={s.key} stage={s} index={i} compact={fit} onAdd={() => nav(`/opportunities/new${qs({ pipelineId: currentPipelineId })}`)}>
                  <ul className={clsx('flex min-h-[120px] flex-col', fit ? 'gap-1.5' : 'gap-3')}>
                    {s.cards.map((c) => <Card key={c.id} opp={c} compact={fit} onMove={requestMove} canMove={can('oportunidades')} stages={stageList(c.pipelineId)} />)}
                    {s.cards.length === 0 && <li className="rounded-md border border-dashed border-line-strong/60 px-3 py-6 text-center text-sm text-muted">Nenhuma oportunidade</li>}
                  </ul>
                </Column>
              ))}
            </div>
          </DndContext>
        )
      ) : list.isLoading ? <div className="card"><LoadingRows /></div> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.items.length ? (
        <div className="card"><EmptyState title="Nenhuma oportunidade encontrada" description="Ajuste os filtros ou abra um novo Sprint." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left">
              <caption className="sr-only">Lista de oportunidades</caption>
              <thead className="bg-surface-2 text-sm text-muted">
                <tr>{['Cliente', 'Plano', 'Valor', 'Jornada · etapa', 'Origem', 'Responsável', 'Próxima ação'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {list.data.items.map((o) => (
                  <tr key={o.id} className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={() => nav(`/opportunities/${o.id}`)}>
                    <td className="px-4 py-3"><span className="flex items-center gap-3"><Avatar name={o.contactName} size={38} tone={0} /><span><span className="block font-semibold text-ink">{o.contactName}</span><span className="block text-xs text-muted">OP-{o.code} · {productLabel(o.contactSegment)}</span></span></span></td>
                    <td className="px-4 py-3 text-sm"><span className="block font-semibold text-ink">{o.planName ?? '—'}</span><span className="block text-xs text-muted">{o.planLine ?? ''}</span></td>
                    <td className="num px-4 py-3 text-sm font-semibold text-ink">{o.valueCents !== null ? fmtBRL(o.valueCents) : '—'}</td>
                    <td className="px-4 py-3"><span className="block text-xs text-muted">{o.pipelineName}</span><StageChip stage={o.stage} name={o.stageName} color={stageList(o.pipelineId).find((x) => x.key === o.stage)?.color} /></td>
                    <td className="px-4 py-3"><SourceChip name={o.sourceName} /></td>
                    <td className="px-4 py-3"><span className="flex items-center gap-2 whitespace-nowrap text-sm"><Avatar name={o.ownerName} userId={o.ownerId} hasPhoto={o.ownerHasAvatar} size={28} />{o.ownerName}</span></td>
                    <td className={clsx('px-4 py-3 text-sm', o.overdue ? 'font-semibold text-danger' : 'text-text')}>{o.nextActionAt ? fmtRelativeShort(o.nextActionAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination noun="oportunidades" page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => setF({ page: String(p) }, { resetPage: false })} onPageSize={(s) => setF({ size: String(s) })} />
        </div>
      )}

      <TransitionDialog
        request={pending}
        loading={transition.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(payload) => { if (pending) transition.mutate({ opp: pending.opp, payload }, { onSettled: () => setPending(null) }); }}
      />
    </div>
  );
}
