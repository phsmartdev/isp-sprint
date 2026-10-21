/** Eventos de negócio: lista filtrável com créditos, origem e validação. Base do detalhamento de indicadores. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BUSINESS_EVENT_TYPES, CREDIT_KIND_LABELS, EVENT_MODULES, EVENT_MODULE_LABELS, EVENT_VALIDATION, EVENT_VALIDATION_LABELS, type CreditKind, type EventValidation } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Pagination, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Drawer, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

export type EventCredit = { userId: string; kind: CreditKind; shareBp: number; name: string };
export type BizEvent = {
  id: string; type: string; label: string; module: string; sourceType: string; sourceId: string; ownerId: string | null; ownerName: string | null; participants: string[];
  occurredAt: string; recordedAt: string; outcome: string | null; valueCents: number | null; quantity: number | null; validation: EventValidation; context: Record<string, unknown>; ruleVersion: number; credits: EventCredit[];
};
export type EventFilters = { type?: string; module?: string; userId?: string; creditKind?: CreditKind; from?: string; to?: string; validation?: EventValidation | ''; teamId?: string };

export const VALIDATION_TONE: Record<EventValidation, Tone> = { valido: 'green', pendente: 'yellow', invalidado: 'red' };

/** Link para o registro de origem do evento (mesma tela onde o fato aconteceu). */
export function sourceLink(e: Pick<BizEvent, 'sourceType' | 'sourceId' | 'context'>): string | null {
  const c = e.context as Record<string, string | undefined>;
  switch (e.sourceType) {
    case 'opportunity': return `/opportunities/${e.sourceId}`;
    case 'lead': return c.opportunityId ? `/opportunities/${c.opportunityId}` : '/leads';
    case 'approval_request': return c.opportunityId ? `/opportunities/${c.opportunityId}/aprovacao` : null;
    case 'contract': return `/contracts/${e.sourceId}`;
    case 'contract_process': return c.contractId ? `/contracts/${c.contractId}` : null;
    case 'arp_operation': case 'arp_adhesion': return c.arpId ? `/contracts/atas/${c.arpId}` : null;
    case 'activity': return c.contactId && !c.projectId ? `/customers/${c.contactId}?t=sucesso` : `/tarefas?task=${e.sourceId}`;
    case 'project_milestone': return c.projectId ? `/projetos/${c.projectId}?t=marcos` : null;
    case 'project': return `/projetos/${e.sourceId}`;
    default: return null;
  }
}

const pct = (bp: number) => `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export function EventsExplorer({ initial = {}, lockUser }: { initial?: EventFilters; lockUser?: boolean }) {
  const users = useLookups().data?.users ?? [];
  const [f, setF] = useState<EventFilters>(initial);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const set = (p: Partial<EventFilters>) => { setF({ ...f, ...p }); setPage(1); };
  const q = useQuery({
    queryKey: ['perf-events', f, page],
    placeholderData: keepPreviousData,
    queryFn: () => api<{ items: BizEvent[]; total: number; page: number; pageSize: number; canReview: boolean }>(`/performance/events${qs({ ...f, validation: f.validation || undefined, page, pageSize: 50 })}`),
  });
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 p-4">
        <FormField label="Evento" htmlFor="ev-type"><Select id="ev-type" value={f.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}><option value="">Todos</option>{BUSINESS_EVENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select></FormField>
        <FormField label="Módulo" htmlFor="ev-mod"><Select id="ev-mod" value={f.module ?? ''} onChange={(e) => set({ module: e.target.value || undefined })}><option value="">Todos</option>{EVENT_MODULES.map((m) => <option key={m} value={m}>{EVENT_MODULE_LABELS[m]}</option>)}</Select></FormField>
        {!lockUser && <FormField label="Pessoa" htmlFor="ev-user"><Select id="ev-user" value={f.userId ?? ''} onChange={(e) => set({ userId: e.target.value || undefined })}><option value="">Todas</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}
        <FormField label="De" htmlFor="ev-from"><Input id="ev-from" type="date" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></FormField>
        <FormField label="Até" htmlFor="ev-to"><Input id="ev-to" type="date" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></FormField>
        <FormField label="Validação" htmlFor="ev-val"><Select id="ev-val" value={f.validation ?? ''} onChange={(e) => set({ validation: e.target.value as EventValidation | '' })}><option value="">Todas</option>{EVENT_VALIDATION.map((v) => <option key={v} value={v}>{EVENT_VALIDATION_LABELS[v]}</option>)}</Select></FormField>
      </div>
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <div className="border-t border-line"><EmptyState title="Nenhum evento com esses filtros" description="Eventos nascem dos registros do sistema: vendas, contratos, tarefas, marcos, atas e aprovações." /></div> : (
        <>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Quando', 'Evento', 'Responsável', 'Créditos de resultado', 'Valor', 'Validação', 'Origem'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.items.map((e) => {
                  const link = sourceLink(e);
                  return (
                    <tr key={e.id} className={clsx('border-t border-line align-top', e.validation === 'invalidado' && 'text-muted')}>
                      <td className="num whitespace-nowrap px-3 py-2">{fmtDateTime(e.occurredAt)}</td>
                      <td className="px-3 py-2"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => setOpen(e.id)}>{e.label}</button><span className="block text-xs text-muted">{EVENT_MODULE_LABELS[e.module as keyof typeof EVENT_MODULE_LABELS] ?? e.module}{e.context.onTime === false ? ' · fora do prazo' : ''}</span></td>
                      <td className="px-3 py-2">{e.ownerName ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">{e.credits.filter((c) => c.kind === 'direto').map((c) => `${c.name.split(' ')[0]} ${pct(c.shareBp)}`).join(' · ') || '—'}</td>
                      <td className="num whitespace-nowrap px-3 py-2">{e.valueCents !== null ? fmtBRL(e.valueCents) : '—'}</td>
                      <td className="px-3 py-2"><Chip tone={VALIDATION_TONE[e.validation]}>{EVENT_VALIDATION_LABELS[e.validation]}</Chip></td>
                      <td className="px-3 py-2">{link ? <Link to={link} className="text-xs font-semibold text-primary hover:underline">Abrir</Link> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line p-3"><Pagination page={page} pageSize={50} total={q.data!.total} onPage={setPage} noun="eventos" /></div>
        </>
      )}
      <EventDrawer id={open} onClose={() => setOpen(null)} canReview={!!q.data?.canReview} />
    </section>
  );
}

type Detail = BizEvent & { reviews: { id: string; from: EventValidation; to: EventValidation; reason: string; automatic: boolean; createdAt: string; actorName: string | null }[] };

function EventDrawer({ id, onClose, canReview }: { id: string | null; onClose: () => void; canReview: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['perf-event', id], enabled: !!id, queryFn: () => api<Detail>(`/performance/events/${id}`) });
  const [to, setTo] = useState<EventValidation | ''>('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/performance/events/${id}/review`, { method: 'POST', body: { to, reason } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['perf-event'] }); void qc.invalidateQueries({ queryKey: ['perf-events'] }); void qc.invalidateQueries({ queryKey: ['performance'] }); setTo(''); setReason(''); toast({ tone: 'success', message: 'Validação registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const e = q.data;
  const link = e ? sourceLink(e) : null;
  return (
    <Drawer open={!!id} onClose={onClose} title="Evento de negócio" width="lg">
      {!e ? <LoadingRows rows={5} /> : (
        <div className="space-y-5">
          <div>
            <h3 className="text-lg font-bold text-ink">{e.label}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2"><Chip tone={VALIDATION_TONE[e.validation]}>{EVENT_VALIDATION_LABELS[e.validation]}</Chip>{link && <Link to={link} className="text-sm font-semibold text-primary hover:underline">Abrir registro de origem</Link>}</div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-muted">Aconteceu em</dt><dd className="num text-ink">{fmtDateTime(e.occurredAt)}</dd></div>
            <div><dt className="text-xs text-muted">Registrado em</dt><dd className="num text-ink">{fmtDateTime(e.recordedAt)}</dd></div>
            <div><dt className="text-xs text-muted">Responsável</dt><dd className="text-ink">{e.ownerName ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted">Valor</dt><dd className="num text-ink">{e.valueCents !== null ? `${fmtBRL(e.valueCents)}/mês` : '—'}</dd></div>
            <div><dt className="text-xs text-muted">Resultado</dt><dd className="text-ink">{e.outcome ?? '—'}</dd></div>
            <div><dt className="text-xs text-muted">Regra de atribuição</dt><dd className="text-ink">{e.ruleVersion ? `versão ${e.ruleVersion}` : 'padrão'}</dd></div>
          </dl>
          <section>
            <h4 className="mb-1 font-bold text-ink">Créditos</h4>
            <p className="mb-2 text-xs text-muted">"Resultado" soma 100% entre as pessoas; "Participação" e "Gestão da equipe" reconhecem sem somar no resultado individual.</p>
            <ul className="space-y-1 text-sm">{e.credits.map((c) => <li key={c.userId + c.kind} className="flex justify-between gap-3"><span>{c.name}</span><span className="text-muted">{CREDIT_KIND_LABELS[c.kind]}{c.kind === 'direto' ? ` · ${pct(c.shareBp)}` : ''}</span></li>)}</ul>
          </section>
          {Object.keys(e.context).length > 0 && (
            <section>
              <h4 className="mb-1 font-bold text-ink">Contexto</h4>
              <ul className="space-y-0.5 text-sm">{Object.entries(e.context).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span className="text-muted">{CONTEXT_LABELS[k] ?? k}</span><span className="text-ink">{fmtCtx(k, v)}</span></li>)}</ul>
            </section>
          )}
          <section>
            <h4 className="mb-1 font-bold text-ink">Histórico de validação</h4>
            {!e.reviews.length ? <p className="text-sm text-muted">Sem alterações desde o registro.</p> : <ol className="space-y-1.5 text-sm">{e.reviews.map((r) => <li key={r.id}><span className="num text-xs text-muted">{fmtDateTime(r.createdAt)}</span> · {r.automatic ? 'Automático' : r.actorName}: {EVENT_VALIDATION_LABELS[r.from]} → {EVENT_VALIDATION_LABELS[r.to]} — {r.reason}</li>)}</ol>}
          </section>
          {canReview && (
            <section className="space-y-2 rounded-md border border-line p-3">
              <h4 className="font-bold text-ink">Validar evento</h4>
              <FormField label="Nova situação" htmlFor="rv-to"><Select id="rv-to" value={to} onChange={(x) => setTo(x.target.value as EventValidation)}><option value="">Escolha</option>{EVENT_VALIDATION.filter((v) => v !== e.validation).map((v) => <option key={v} value={v}>{EVENT_VALIDATION_LABELS[v]}</option>)}</Select></FormField>
              <FormField label="Motivo" htmlFor="rv-reason" hint="Fica no histórico; mínimo 5 caracteres"><Textarea id="rv-reason" rows={2} value={reason} onChange={(x) => setReason(x.target.value)} /></FormField>
              <Button variant="primary" disabled={!to || reason.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Registrar</Button>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

const CONTEXT_LABELS: Record<string, string> = {
  onTime: 'No prazo', selfCreated: 'Criada pela própria pessoa', minutesToComplete: 'Minutos entre criar e concluir', hadDue: 'Tinha prazo', priority: 'Prioridade', approved: 'Entrega aprovada', checklist: 'Itens de checklist',
  dueOn: 'Prazo', dueAt: 'Prazo', kind: 'Tipo', level: 'Alçada', hoursToDecide: 'Horas para decidir', saleType: 'Tipo de venda', channel: 'Canal', weight: 'Peso da criticidade', plannedAt: 'Previsto para',
};
function fmtCtx(k: string, v: unknown) {
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (k === 'marginCents' && typeof v === 'number') return fmtBRL(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return fmtDate(v);
  if (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) return 'vinculado';
  return String(v);
}
