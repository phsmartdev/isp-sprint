import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Clock3, FileText, MoreVertical, Plus, Search, SlidersHorizontal, Users, Wifi } from 'lucide-react';
import { CUSTOMER_LIFECYCLES, LIFECYCLE_LABELS, SEGMENTS, SEGMENT_LABELS, csvSafe, type CustomerLifecycle, type Segment } from '@isp/domain';
import { api, ApiError, qs } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useDebounced, useLookups, useUrlState } from '../lib/hooks';
import type { Kpi, Paged } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Button, EmptyState, ErrorState, FormField, Input, KpiCard, LoadingRows, Pagination, Select } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';
import { PageHeader } from '../components/layout/PageHeader';
import { LifecycleChip, segmentLabel } from '../components/badges';
import { WhatsIcon } from './Leads';

type Row = {
  id: string; name: string; phone: string | null; email: string | null; segment: Segment; city: string | null; createdAt: string;
  customerId: string | null; lifecycle: CustomerLifecycle; externalId: string | null; contractStart: string | null; nextDueOn: string | null;
  planName: string | null; planLine: string | null; ownerId: string | null; ownerName: string | null; ownerHasAvatar: boolean;
};

function NewCustomer({ onDone }: { onDone: (id: string) => void }) {
  const { me, can } = useAuth();
  const lookups = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', phone: '', email: '', segment: 'residencial' as Segment, city: '', ownerId: me?.user.id ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/contacts', { method: 'POST', body: { ...form, phone: form.phone || null, email: form.email || null, city: form.city || null } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['customers'] }); toast({ tone: 'success', message: 'Cliente cadastrado' }); onDone(r.id); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: 'error', message: (e as Error).message }); },
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <form id="new-customer" className="space-y-3" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); if (!m.isPending) m.mutate(); }}>
      <FormField label="Nome ou razão social" htmlFor="nc-name" required error={errors.name}><Input id="nc-name" value={form.name} onChange={(e) => set('name', e.target.value)} data-autofocus /></FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Telefone / WhatsApp" htmlFor="nc-phone" error={errors.phone}><Input id="nc-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></FormField>
        <FormField label="E-mail" htmlFor="nc-email" error={errors.email}><Input id="nc-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></FormField>
        <FormField label="Segmento" htmlFor="nc-seg"><Select id="nc-seg" value={form.segment} onChange={(e) => set('segment', e.target.value)}>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</Select></FormField>
        <FormField label="Cidade" htmlFor="nc-city"><Input id="nc-city" value={form.city} onChange={(e) => set('city', e.target.value)} /></FormField>
        {can('clientes', 'equipe') && <FormField label="Responsável" htmlFor="nc-owner"><Select id="nc-owner" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>{lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}
      </div>
      <p className="text-xs text-muted">Entra como prospect na carteira. Plano, contrato e situação passam a vir do IXC quando a integração estiver ativa.</p>
    </form>
  );
}

export function CustomersPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const nav = useNavigate();
  const [f, setF] = useUrlState({ q: '', planId: '', lifecycle: '', segment: '', ownerId: '', page: '1', size: '10' });
  const [search, setSearch] = useState(f.q);
  const dq = useDebounced(search);
  useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Map<string, Row>>(new Map());
  const exportSelected = () => {
    const header = ['Cliente', 'Segmento', 'Telefone', 'Plano', 'Status', 'Início do contrato', 'Próximo vencimento', 'Responsável'];
    const lines = [...selected.values()].map((c) => [c.name, SEGMENT_LABELS[c.segment], c.phone, c.planName, LIFECYCLE_LABELS[c.lifecycle], c.contractStart, c.nextDueOn, c.ownerName]);
    const csv = '\ufeff' + [header, ...lines].map((l) => l.map(csvSafe).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'clientes-selecionados.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const summary = useQuery({ queryKey: ['customers', 'summary'], queryFn: () => api<{ kpis: Kpi[] }>('/customers/summary') });
  const q = useQuery({ queryKey: ['customers', f], placeholderData: keepPreviousData, queryFn: () => api<Paged<Row>>(`/customers${qs({ q: f.q, planId: f.planId, lifecycle: f.lifecycle, segment: f.segment, ownerId: f.ownerId, page: f.page, pageSize: f.size })}`) });
  const look = [
    { icon: <Users className="h-7 w-7" />, tone: 'blue' as const },
    { icon: <Wifi className="h-7 w-7" />, tone: 'green' as const },
    { icon: <Clock3 className="h-7 w-7" />, tone: 'orange' as const },
    { icon: <FileText className="h-7 w-7" />, tone: 'purple' as const },
  ];
  return (
    <div className="w-full">
      <PageHeader
        icon={<Users className="h-9 w-9" strokeWidth={2.2} />}
        title="Contas"
        subtitle="Clientes e contas em prospecção, com todo o histórico de relacionamento."
        actions={<Button variant="primary" size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>Novo cliente</Button>}
      />
      <section aria-label="Indicadores" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(summary.data?.kpis ?? []).map((k, i) => <KpiCard key={k.key} k={k} icon={look[i]!.icon} tone={look[i]!.tone} />)}
        {!summary.data && Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-[92px] animate-pulse" />)}
      </section>
      <div className="mb-4 flex flex-wrap items-center gap-3" role="search">
        <div className="relative min-w-[220px] flex-1 lg:max-w-[275px]">
          <label htmlFor="cu-q" className="sr-only">Buscar clientes</label>
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden />
          <Input id="cu-q" className="h-12 pl-10" placeholder="Buscar clientes..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Plano" className="h-12 w-auto min-w-[165px]" value={f.planId} onChange={(e) => setF({ planId: e.target.value })}>
          <option value="">Todos os planos</option>
          {lookups.data?.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select aria-label="Status" className="h-12 w-auto min-w-[175px]" value={f.lifecycle} onChange={(e) => setF({ lifecycle: e.target.value })}>
          <option value="">Todos os status</option>
          {CUSTOMER_LIFECYCLES.map((l) => <option key={l} value={l}>{LIFECYCLE_LABELS[l]}</option>)}
        </Select>
        <Select aria-label="Segmento" className="h-12 w-auto min-w-[200px]" value={f.segment} onChange={(e) => setF({ segment: e.target.value })}>
          <option value="">Todos os segmentos</option>
          {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}
        </Select>
        {can('clientes', 'equipe') && (
          <Select aria-label="Responsável" className="h-12 w-auto min-w-[220px]" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value })}>
            <option value="">Todos os responsáveis</option>
            {lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
        <Button size="lg" className="ml-auto" icon={<SlidersHorizontal className="h-5 w-5" />} onClick={() => { setSearch(''); setF({ q: '', planId: '', lifecycle: '', segment: '', ownerId: '' }); }} title="Limpar filtros">Filtros</Button>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary-soft px-4 py-2 text-sm">
          <span className="font-semibold">{selected.size} selecionado(s)</span>
          <Button size="sm" onClick={exportSelected}>Exportar CSV</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>Limpar seleção</Button>
        </div>
      )}
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
        <div className="card"><EmptyState title="Nenhum cliente encontrado" description="Ajuste os filtros. A base completa chega com a importação do IXC." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <caption className="sr-only">Lista de clientes</caption>
              <thead className="bg-surface-2 text-sm text-muted">
                <tr>
                  <th className="w-12 px-4 py-3"><input type="checkbox" className="h-5 w-5" aria-label="Selecionar todos desta página" checked={q.data.items.every((c) => selected.has(c.id))} onChange={() => { const n = new Map(selected); const all = q.data.items.every((c) => n.has(c.id)); q.data.items.forEach((c) => (all ? n.delete(c.id) : n.set(c.id, c))); setSelected(n); }} /></th>
                  {['Cliente', 'Contato principal', 'Plano atual', 'Status', 'Início do contrato', 'Próximo vencimento', 'Responsável'].map((h) => <th key={h} scope="col" className="px-3 py-3 font-medium">{h}</th>)}
                  <th scope="col" className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={() => nav(`/customers/${c.id}`)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="h-5 w-5" aria-label={`Selecionar ${c.name}`} checked={selected.has(c.id)} onChange={() => { const n = new Map(selected); n.has(c.id) ? n.delete(c.id) : n.set(c.id, c); setSelected(n); }} /></td>
                    <td className="px-3 py-3"><span className="flex items-center gap-3"><Avatar name={c.name} size={42} tone={0} /><span><span className="block font-semibold text-ink">{c.name}</span><span className="block text-xs text-muted">{segmentLabel(c.segment)}</span></span></span></td>
                    <td className="px-3 py-3"><span className="block text-sm text-ink">{c.name}</span><span className="num flex items-center gap-1.5 whitespace-nowrap text-sm text-muted">{c.phone && <WhatsIcon className="h-4 w-4" />}{c.phone ?? '—'}</span></td>
                    <td className="px-3 py-3"><span className="block text-sm font-semibold text-ink">{c.planName ?? '—'}</span><span className="block text-xs text-muted">{c.planLine ?? ''}</span></td>
                    <td className="px-3 py-3"><LifecycleChip s={c.lifecycle} /></td>
                    <td className="num px-3 py-3 text-sm text-text">{c.contractStart ? fmtDate(`${c.contractStart}T12:00:00`) : '—'}</td>
                    <td className={clsx('num px-3 py-3 text-sm', c.nextDueOn && new Date(`${c.nextDueOn}T12:00:00`).getTime() - Date.now() < 30 * 86_400_000 ? 'font-semibold text-[#C2610C]' : 'text-text')}>{c.nextDueOn ? fmtDate(`${c.nextDueOn}T12:00:00`) : '—'}</td>
                    <td className="px-3 py-3"><span className="flex items-center gap-2 whitespace-nowrap text-sm text-text">{c.ownerName ? <><Avatar name={c.ownerName} userId={c.ownerId} hasPhoto={c.ownerHasAvatar} size={32} />{c.ownerName}</> : '—'}</span></td>
                    <td className="px-4 py-3 text-right"><button className="rounded-sm p-1.5 text-ink hover:bg-surface-2" aria-label={`Abrir ${c.name}`} onClick={(e) => { e.stopPropagation(); nav(`/customers/${c.id}`); }}><MoreVertical className="h-5 w-5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination noun="clientes" page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF({ page: String(p) }, { resetPage: false })} onPageSize={(s) => setF({ size: String(s) })} />
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Novo cliente" footer={<><Button onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" type="submit" form="new-customer">Cadastrar cliente</Button></>}>
        <NewCustomer onDone={(id) => { setCreating(false); nav(`/customers/${id}`); }} />
      </Modal>
    </div>
  );
}
