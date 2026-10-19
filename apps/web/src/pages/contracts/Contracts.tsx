/** Gestão de Contratos: painel, lista, funil, calendário, renovações, reajustes, encerramentos, notificações e relatórios. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import clsx from 'clsx';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download, FileSignature, Plus, RefreshCw, Search, TrendingUp, Wallet } from 'lucide-react';
import { BILLING_TYPES, BILLING_TYPE_LABELS, CONTRACT_STAGES, CONTRACT_STAGE_LABELS, PROCESS_LABELS, processSteps, type ContractStage } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtInt } from '../../lib/format';
import { useDebounced, useLookups, useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Pagination, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { AlertList } from '../../features/contracts/ContractPanels';
import { ContractsDashboard } from '../../features/contracts/Dashboard';
import { FullReport } from '../../features/contracts/FullReport';
import { TemplatesManager } from '../../features/contracts/SignaturePanels';
import { AdminContractTemplates } from '../admin/ProposalTemplates';
import { DaysLeft, KIND_LABEL, MoneyRows, PendBadge, StageChip, errMsg, todayIso, type Alert, type ContractRow, type Process } from '../../features/contracts/shared';

type View = 'painel' | 'lista' | 'funil' | 'calendario' | 'renovacoes' | 'reajustes' | 'encerramentos' | 'notificacoes' | 'relatorios' | 'modelos';
const TABS: { key: View; label: string }[] = [
  { key: 'painel', label: 'Painel' }, { key: 'lista', label: 'Lista' }, { key: 'funil', label: 'Funil' }, { key: 'calendario', label: 'Calendário' },
  { key: 'renovacoes', label: 'Renovações' }, { key: 'reajustes', label: 'Reajustes' }, { key: 'encerramentos', label: 'Encerramentos' }, { key: 'notificacoes', label: 'Notificações' }, { key: 'relatorios', label: 'Relatórios' }, { key: 'modelos', label: 'Modelos' },
];
const STAGE_COLOR: Record<ContractStage, string> = { cadastro_validacao: '#E0A400', implantacao: '#7C3AED', vigente: '#16A34A', renovacao: '#1D5FE6', reajuste: '#EA7A0C', encerramento: '#DC2626', arquivado: '#64748B' };

// ------------------------------------------------------------------ lista
function Lista() {
  const nav = useNavigate();
  const lookups = useLookups();
  const { can } = useAuth();
  const [f, setF] = useUrlState({ q: '', stage: '', kind: '', btype: '', status: 'ativos', ownerId: '', exp: '', page: '1', size: '25' });
  const [search, setSearch] = useState(f.q);
  const dq = useDebounced(search, 300);
  useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ['contracts', 'list', f], placeholderData: keepPreviousData, queryFn: () => api<{ items: ContractRow[]; total: number }>(`/contracts${qs({ q: f.q, stage: f.stage, kind: f.kind, billingType: f.btype, status: f.status, ownerId: f.ownerId, expiringDays: f.exp, page: f.page, pageSize: f.size })}`) });
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3" role="search">
        <div className="relative min-w-[220px] flex-1 lg:max-w-[300px]">
          <label htmlFor="ct-q" className="sr-only">Buscar contratos</label>
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden />
          <Input id="ct-q" className="h-12 pl-10" placeholder="Número, cliente ou objeto" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Situação" className="h-12 w-auto" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="ativos">Ativos</option><option value="encerrados">Arquivados</option><option value="todos">Todos</option></Select>
        <Select aria-label="Etapa" className="h-12 w-auto" value={f.stage} onChange={(e) => setF({ stage: e.target.value })}><option value="">Todas as etapas</option>{CONTRACT_STAGES.map((s) => <option key={s} value={s}>{CONTRACT_STAGE_LABELS[s]}</option>)}</Select>
        <Select aria-label="Tipo de contrato" className="h-12 w-auto" value={f.btype} onChange={(e) => setF({ btype: e.target.value })}><option value="">Todos os tipos</option>{BILLING_TYPES.map((t) => <option key={t} value={t}>{BILLING_TYPE_LABELS[t]}</option>)}</Select>
        <Select aria-label="Público ou privado" className="h-12 w-auto" value={f.kind} onChange={(e) => setF({ kind: e.target.value })}><option value="">Público e privado</option><option value="publico">Público</option><option value="privado">Privado</option></Select>
        <Select aria-label="Vencimento" className="h-12 w-auto" value={f.exp} onChange={(e) => setF({ exp: e.target.value })}><option value="">Qualquer vencimento</option><option value="30">Vence em 30 dias</option><option value="60">Vence em 60 dias</option><option value="90">Vence em 90 dias</option></Select>
        {can('contratos', 'equipe') && <Select aria-label="Responsável" className="h-12 w-auto" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value })}><option value="">Todos os responsáveis</option>{lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
      </div>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? (
        <div className="card"><EmptyState title="Nenhum contrato encontrado" description="Contratos nascem das oportunidades fechadas (botão Cadastrar contrato) ou de Novo contrato." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Contrato', 'Cliente', 'Etapa', 'Responsável', 'Vigência', 'Valor mensal', 'Dias restantes', 'Pendências', 'Próxima ação'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.items.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={() => nav(`/contracts/${r.id}`)}>
                    <td className="px-4 py-3"><Link to={`/contracts/${r.id}`} className="font-semibold text-ink hover:underline" onClick={(e) => e.stopPropagation()}>{r.number}</Link><span className="block text-xs text-muted">CT-{r.code} · {BILLING_TYPE_LABELS[r.billingType]} · {KIND_LABEL[r.kind]}</span></td>
                    <td className="px-4 py-3 text-ink">{r.clientName}</td>
                    <td className="px-4 py-3"><StageChip stage={r.stage} /></td>
                    <td className="px-4 py-3">{r.ownerName ?? '—'}</td>
                    <td className="num px-4 py-3">{fmtDate(r.startAt)} a {fmtDate(r.endAt)}</td>
                    <td className="num px-4 py-3 font-semibold">{fmtBRL(r.monthlyCents)}</td>
                    <td className="px-4 py-3"><DaysLeft days={r.daysLeft} archived={r.stage === 'arquivado'} /></td>
                    <td className="px-4 py-3"><PendBadge p={r.pendencies} /></td>
                    <td className="px-4 py-3">{r.nextAction ?? '—'}{r.nextActionAt && <span className="block text-xs text-muted">{fmtDate(r.nextActionAt)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3"><Pagination page={Number(f.page)} pageSize={Number(f.size)} total={q.data!.total} onPage={(p) => setF({ page: String(p) }, { resetPage: false })} onPageSize={(s) => setF({ size: String(s) })} noun="contratos" sizes={[25, 50, 100]} /></div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ funil
function BoardCard({ r }: { r: ContractRow }) {
  const nav = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: r.id, data: { r }, disabled: r.stage === 'cadastro_validacao' || r.stage === 'arquivado' });
  return (
    <li ref={setNodeRef} style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined} {...attributes} {...listeners}
      aria-roledescription="cartão arrastável" aria-label={`${r.clientName}, contrato ${r.number}. Enter abre a ficha.`}
      onKeyDown={(e) => { listeners?.onKeyDown?.(e); if (e.key === 'Enter' && !isDragging) nav(`/contracts/${r.id}`); }}
      onClick={() => nav(`/contracts/${r.id}`)}
      className={clsx('cursor-pointer rounded-md bg-surface p-3 shadow-card ring-1 ring-line/70 hover:ring-line-strong', isDragging && 'z-30 opacity-90 shadow-overlay')}>
      <p className="line-clamp-2 text-sm font-bold leading-tight text-ink">{r.clientName}</p>
      <p className="text-xs text-muted">{r.number} · {BILLING_TYPE_LABELS[r.billingType]} · {KIND_LABEL[r.kind]}</p>
      <div className="mt-2 flex items-center justify-between gap-2"><span className="num text-sm font-bold text-ink">{fmtBRL(r.monthlyCents)}</span><DaysLeft days={r.daysLeft} archived={r.stage === 'arquivado'} /></div>
      <p className="mt-1 truncate text-xs text-text">{r.nextAction ?? 'Sem próxima ação'}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs"><span className="truncate text-muted">{r.ownerName}</span>{(r.pendencies.alerts + r.pendencies.steps) > 0 && <span className={clsx('font-semibold', r.pendencies.overdue ? 'text-danger' : 'text-[#C2610C]')}>{r.pendencies.alerts + r.pendencies.steps} pend.</span>}</div>
    </li>
  );
}
function BoardColumn({ stage, rows }: { stage: ContractStage; rows: ContractRow[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: stage === 'cadastro_validacao' || stage === 'arquivado' });
  return (
    <section ref={setNodeRef} aria-labelledby={`cc-${stage}`} style={{ background: `${STAGE_COLOR[stage]}12` }} className={clsx('flex min-w-[230px] flex-1 basis-0 flex-col rounded-lg p-2.5', isOver && 'ring-2 ring-primary')}>
      <header className="mb-3 px-1">
        <h2 id={`cc-${stage}`} className="flex items-center gap-2 text-sm font-bold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_COLOR[stage] }} aria-hidden />{CONTRACT_STAGE_LABELS[stage]} <span className="num font-normal text-muted">({rows.length})</span></h2>
        <p className="num text-xs text-muted">{fmtBRL(rows.reduce((a, r) => a + r.monthlyCents, 0))}/mês</p>
      </header>
      <ul className="flex min-h-[120px] flex-col gap-3">
        {rows.map((r) => <BoardCard key={r.id} r={r} />)}
        {!rows.length && <li className="rounded-md border border-dashed border-line-strong/60 px-3 py-6 text-center text-sm text-muted">Nenhum contrato</li>}
      </ul>
    </section>
  );
}
function Funil() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const q = useQuery({ queryKey: ['contracts', 'board', showArchived], queryFn: () => api<{ items: ContractRow[] }>(`/contracts${qs({ status: showArchived ? 'todos' : 'ativos', pageSize: 500 })}`) });
  const [pending, setPending] = useState<{ r: ContractRow; to: ContractStage } | null>(null);
  const [reason, setReason] = useState('');
  const move = useMutation({
    mutationFn: (p: { r: ContractRow; to: ContractStage; reason?: string }) => api(`/contracts/${p.r.id}/stage`, { method: 'POST', body: { stage: p.to, reason: p.reason } }),
    onSuccess: (_d, p) => { qc.invalidateQueries({ queryKey: ['contracts'] }); setPending(null); setReason(''); toast({ tone: 'success', message: `${p.r.clientName} em ${CONTRACT_STAGE_LABELS[p.to]}` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const onDragEnd = (e: DragEndEvent) => {
    const r = e.active.data.current?.r as ContractRow | undefined;
    const to = e.over?.id as ContractStage | undefined;
    if (!r || !to || r.stage === to) return;
    if (to === 'encerramento') setPending({ r, to }); else move.mutate({ r, to });
  };
  const stages = CONTRACT_STAGES.filter((s) => showArchived || s !== 'arquivado');
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Arraste para mover. Renovação, reajuste e encerramento abrem o processo correspondente; implantação, renovação e reajuste correm em paralelo dentro da ficha.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Mostrar arquivados</label>
      </div>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="scroll-thin -mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
            {stages.map((s) => <BoardColumn key={s} stage={s} rows={q.data!.items.filter((r) => r.stage === s)} />)}
          </div>
        </DndContext>
      )}
      <Modal open={!!pending} onClose={() => setPending(null)} title="Encerramento previsto" size="sm" footer={<><Button onClick={() => setPending(null)}>Cancelar</Button><Button variant="danger" loading={move.isPending} disabled={reason.trim().length < 3} onClick={() => move.mutate({ ...pending!, reason })}>Iniciar encerramento</Button></>}>
        <p className="mb-3 text-sm text-text">{pending?.r.clientName}: abre o processo de encerramento (avisos de 90 e 30 dias, validação com Sucesso do Cliente, desmobilização, faturamento final, baixas e arquivamento). Nada é encerrado sem essas validações.</p>
        <FormField label="Motivo" htmlFor="enc-reason" required><Textarea id="enc-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ calendário
type CalEv = { date: string; kind: string; label: string; contractId: string; number: string; client: string };
const EV_COLOR: Record<string, string> = { termino: 'bg-danger', renovacao: 'bg-primary', encerramento: 'bg-danger', garantia: 'bg-warning', reajuste: 'bg-[#EA7A0C]', acao: 'bg-purple', tarefa: 'bg-success' };
function Calendario() {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const first = new Date(`${month}-01T12:00:00Z`);
  const startDow = first.getUTCDay();
  const gridStart = new Date(first.getTime() - startDow * 86_400_000);
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const q = useQuery({ queryKey: ['contracts', 'calendar', month], queryFn: () => api<{ items: CalEv[] }>(`/contracts/calendar${qs({ from: days[0], to: days[41] })}`) });
  const by = useMemo(() => { const m = new Map<string, CalEv[]>(); for (const e of q.data?.items ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e]); return m; }, [q.data]);
  const shift = (n: number) => { const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const label = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthEvents = (q.data?.items ?? []).filter((e) => e.date.startsWith(month));
  const today = todayIso();
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          <Button variant="ghost" aria-label="Mês anterior" icon={<ChevronLeft className="h-5 w-5" />} onClick={() => shift(-1)} />
          <h2 className="min-w-[130px] text-center text-md font-bold capitalize text-ink sm:min-w-[180px] sm:text-lg">{label}</h2>
          <Button variant="ghost" aria-label="Próximo mês" icon={<ChevronRight className="h-5 w-5" />} onClick={() => shift(1)} />
          <Button size="sm" onClick={() => setMonth(todayIso().slice(0, 7))}>Hoje</Button>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">{[['termino', 'Término'], ['renovacao', 'Renovação'], ['reajuste', 'Reajuste'], ['garantia', 'Garantia'], ['tarefa', 'Tarefa'], ['acao', 'Próxima ação']].map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className={clsx('h-2.5 w-2.5 rounded-full', EV_COLOR[k!])} aria-hidden />{l}</span>)}</div>
      </div>
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-l border-t border-line text-xs">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => <div key={d} className="border-b border-r border-line bg-surface-2 px-2 py-1 font-semibold text-muted">{d}</div>)}
          {days.map((d) => {
            const evs = by.get(d) ?? [];
            return (
              <div key={d} className={clsx('min-h-[96px] border-b border-r border-line p-1.5', !d.startsWith(month) && 'bg-surface-2/50 text-muted', d === today && 'ring-2 ring-inset ring-primary')}>
                <p className="num mb-1 text-xs font-semibold">{+d.slice(8)}</p>
                <ul className="space-y-0.5">
                  {evs.slice(0, 3).map((e, i) => <li key={i}><Link to={`/contracts/${e.contractId}`} title={`${e.label} · ${e.number} · ${e.client}`} className="flex items-center gap-1 truncate rounded px-1 text-[11px] leading-5 text-ink hover:bg-surface-2"><span className={clsx('h-2 w-2 shrink-0 rounded-full', EV_COLOR[e.kind] ?? 'bg-primary')} aria-hidden /><span className="truncate">{e.client}</span></Link></li>)}
                  {evs.length > 3 && <li className="px-1 text-[11px] text-muted">+{evs.length - 3}</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      <ul className="divide-y divide-line md:mt-4">
        {q.isLoading ? <LoadingRows rows={3} /> : !monthEvents.length ? <li className="py-4 text-sm text-muted">Nenhuma obrigação neste mês.</li> : monthEvents.map((e, i) => (
          <li key={i}><Link to={`/contracts/${e.contractId}`} className="flex flex-wrap items-center gap-3 px-1 py-2 hover:bg-surface-2">
            <span className="num w-20 text-sm font-semibold text-ink">{fmtDate(e.date)}</span>
            <span className={clsx('h-2.5 w-2.5 rounded-full', EV_COLOR[e.kind] ?? 'bg-primary')} aria-hidden />
            <span className="min-w-0 flex-1 text-sm"><span className="font-semibold text-ink">{e.label}</span> · {e.number} · {e.client}</span>
          </Link></li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ processos (renovações, reajustes, encerramentos)
type ProcRow = Process & { contractId: string; contractKind: 'publico' | 'privado'; code: number; number: string; clientName: string; monthlyCents: number; endAt: string | null; ownerName: string | null };
function Processos({ kind, intro }: { kind: 'renovacao' | 'reajuste' | 'encerramento'; intro: string }) {
  const [status, setStatus] = useState<'aberto' | 'concluido' | 'todos'>('aberto');
  const q = useQuery({ queryKey: ['contracts', 'processes', kind, status], queryFn: () => api<{ items: ProcRow[] }>(`/contracts/processes${qs({ kind, status })}`) });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">{intro}</p>
        <Select aria-label="Situação" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="aberto">Em andamento</option><option value="concluido">Concluídos</option><option value="todos">Todos</option></Select>
      </div>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : !q.data?.items.length ? <div className="card"><EmptyState title={`Nenhum processo de ${PROCESS_LABELS[kind].toLowerCase()}`} /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Contrato', 'Cliente', 'Prazo', 'Progresso', 'Próxima etapa', kind === 'reajuste' ? 'Valor atual → novo' : 'Valor mensal', 'Situação'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {q.data.items.map((p) => {
                const defs = processSteps(p.kind, p.contractKind);
                const done = defs.filter((d) => p.steps[d.key]).length;
                const next = defs.find((d) => !p.steps[d.key]);
                const data = p.data as { currentCents?: number; newCents?: number };
                return (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-4 py-3"><Link className="font-semibold text-ink hover:underline" to={`/contracts/${p.contractId}`}>{p.number}</Link><span className="block text-xs text-muted">{KIND_LABEL[p.contractKind]}</span></td>
                    <td className="px-4 py-3">{p.clientName}</td>
                    <td className="num px-4 py-3">{fmtDate(p.dueAt ?? p.endAt)}</td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-2 w-24 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${(done / defs.length) * 100}%` }} /></div><span className="num text-xs text-muted">{done}/{defs.length}</span></div></td>
                    <td className="px-4 py-3">{p.status === 'aberto' ? next?.label ?? '—' : '—'}</td>
                    <td className="num px-4 py-3">{kind === 'reajuste' ? `${fmtBRL(data.currentCents ?? p.monthlyCents)}${data.newCents ? ` → ${fmtBRL(data.newCents)}` : ''}` : fmtBRL(p.monthlyCents)}</td>
                    <td className="px-4 py-3"><Chip tone={p.status === 'aberto' ? 'blue' : p.status === 'concluido' ? (p.outcome === 'nao_renovado' ? 'red' : 'green') : 'neutral'}>{p.status === 'aberto' ? 'Em andamento' : p.status === 'concluido' ? (p.outcome === 'nao_renovado' ? 'Não renovado' : 'Concluído') : 'Cancelado'}</Chip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ notificações e relatórios
function Notificacoes() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<'aberto' | 'concluido' | 'todos'>('aberto');
  const q = useQuery({ queryKey: ['contracts', 'alerts', status], queryFn: () => api<{ items: Alert[] }>(`/contracts/alerts${qs({ status })}`) });
  const run = useMutation({ mutationFn: () => api<{ contractAlerts: number; contractAlertsResolved: number }>('/contracts/alerts/run', { method: 'POST' }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['contracts'] }); toast({ tone: 'success', message: `${r.contractAlerts} nova(s) notificação(ões), ${r.contractAlertsResolved} resolvida(s)` }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">O monitoramento roda todo dia: renovação ({'60'} dias antes), reajuste, garantias, documentos, assinaturas, provisionamento, implantação e encerramento (90 e 30 dias). Cada aviso existe uma vez por contrato e ciclo, com responsável, prazo e tarefas.</p>
        <div className="flex gap-2">
          <Select aria-label="Situação" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="aberto">Abertas</option><option value="concluido">Concluídas</option><option value="todos">Todas</option></Select>
          {can('contratos', 'total') && <Button icon={<RefreshCw className="h-4 w-4" />} loading={run.isPending} onClick={() => run.mutate()}>Verificar agora</Button>}
        </div>
      </div>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : !q.data?.items.length ? <div className="card"><EmptyState title="Nenhuma notificação" /></div> : <div className="card p-2"><AlertList alerts={q.data.items} showContract /></div>}
    </div>
  );
}
function Relatorios() {
  const next = (() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString().slice(0, 7); })();
  const [month, setMonth] = useState(next);
  const q = useQuery({ queryKey: ['contracts', 'report', month], queryFn: () => api<{ items: (ContractRow & { renewal: string })[]; monthlyCents: number }>(`/contracts/reports/expiring${qs({ month })}`) });
  return (
    <div className="space-y-4">
      <FullReport />
      <section className="card p-5 print:hidden">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-bold text-ink">Contratos que vencem no mês</h2><p className="text-sm text-muted">Relatório mensal: por padrão, o mês seguinte.</p></div>
          <div className="flex items-end gap-2">
            <FormField label="Mês" htmlFor="rp-month"><Input id="rp-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></FormField>
            <a className="inline-flex h-10 items-center gap-2 rounded-md border border-primary/60 bg-surface px-4 font-semibold text-primary hover:bg-primary-soft" href={`/api/v1/contracts/reports/expiring${qs({ month, format: 'csv' })}`} download><Download className="h-4 w-4" />Planilha (CSV)</a>
          </div>
        </div>
        {q.isLoading ? <LoadingRows rows={3} /> : !q.data?.items.length ? <p className="py-4 text-sm text-muted">Nenhum contrato vence neste mês.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Contrato', 'Cliente', 'Tipo', 'Término', 'Valor mensal', 'Responsável', 'Renovação'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{q.data.items.map((r) => <tr key={r.id} className="border-t border-line"><td className="px-3 py-2"><Link className="font-semibold text-ink hover:underline" to={`/contracts/${r.id}`}>{r.number}</Link></td><td className="px-3 py-2">{r.clientName}</td><td className="px-3 py-2">{KIND_LABEL[r.kind]}</td><td className="num px-3 py-2">{fmtDate(r.endAt)}</td><td className="num px-3 py-2">{fmtBRL(r.monthlyCents)}</td><td className="px-3 py-2">{r.ownerName}</td><td className="px-3 py-2">{r.renewal}</td></tr>)}</tbody>
              <tfoot><tr className="border-t border-line font-semibold"><td className="px-3 py-2" colSpan={4}>{q.data.items.length} contrato(s)</td><td className="num px-3 py-2">{fmtBRL(q.data.monthlyCents)}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
        )}
      </section>
      <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div><h2 className="font-bold text-ink">Indicadores contratuais</h2><p className="text-sm text-muted">Taxa de renovação, receita em risco, reajustes, garantias e tempo de implantação, com filtros, ficam em Inteligência → Contratos.</p></div>
        <Link to="/intelligence?v=contratos" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 font-semibold text-white hover:bg-primary-hover"><TrendingUp className="h-4 w-4" />Abrir indicadores</Link>
      </section>
    </div>
  );
}

export function ContractsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [f, setF] = useUrlState({ t: 'painel' });
  const view = (TABS.some((t) => t.key === f.t) ? f.t : 'painel') as View;
  return (
    <div className="w-full">
      <PageHeader
        icon={<FileSignature className="h-9 w-9" strokeWidth={2.2} />}
        title="Gestão de Contratos"
        subtitle="Vigências, renovações, reajustes e encerramentos com histórico e responsáveis."
        actions={<Button variant="primary" size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => nav('/contracts/new')}>Novo contrato</Button>}
      />
      <Tabs<View> label="Áreas da gestão de contratos" className="mb-5" value={view} onChange={(t) => setF({ t })} tabs={TABS.filter((t) => t.key !== 'modelos' || can('configuracoes', 'total'))} />
      {view === 'painel' && <ContractsDashboard />}
      {view === 'lista' && <Lista />}
      {view === 'funil' && <Funil />}
      {view === 'calendario' && <Calendario />}
      {view === 'renovacoes' && <Processos kind="renovacao" intro="Renovações abertas automaticamente 60 dias antes do término (ou manualmente). Contratos públicos seguem o roteiro com ofício, aditivo e assinaturas; privados, proposta de continuidade e formalização." />}
      {view === 'reajustes' && <Processos kind="reajuste" intro="Fluxo independente da renovação: data-base, índice, cálculo, aprovação, comunicação, aplicação e ERP. Cada reajuste aplicado vira uma nova versão com o histórico de valores." />}
      {view === 'encerramentos' && <Processos kind="encerramento" intro="Encerramentos previstos (sem renovação, limite legal ou decisão registrada): avisos de 90 e 30 dias, validação com Sucesso do Cliente, desmobilização, faturamento final, baixas e arquivamento." />}
      {view === 'notificacoes' && <Notificacoes />}
      {view === 'relatorios' && <Relatorios />}
      {view === 'modelos' && <div className="space-y-4"><AdminContractTemplates /><TemplatesManager /></div>}
    </div>
  );
}

