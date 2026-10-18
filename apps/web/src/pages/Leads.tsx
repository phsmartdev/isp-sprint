import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Columns3, List, MoreVertical, Phone, Plus, Search, SlidersHorizontal, Upload, UserPlus, UsersRound, XCircle, Filter } from 'lucide-react';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, SEGMENTS, SEGMENT_LABELS, type LeadStatus, type Segment } from '@isp/domain';
import { api, ApiError, qs } from '../lib/api';
import { fmtDateTime, fmtRelative, fmtRelativeShort, isoToLocalInput, localInputToIso } from '../lib/format';
import { useDebounced, useLookups, useUrlState } from '../lib/hooks';
import type { Kpi, Lead, Paged } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Button, Chip, EmptyState, ErrorState, FormField, Input, KpiCard, LoadingRows, Notice, Pagination, Select, Tabs, Textarea } from '../components/ui/primitives';
import { ConfirmDialog, Drawer, Modal, useToast } from '../components/ui/overlay';
import { PageHeader } from '../components/layout/PageHeader';
import { ConfiarFacilPartial } from '../components/brand';
import { InterestTag, LeadStatusChip, SourceChip, productLabel } from '../components/badges';

const INTERESTS = ['Oferta', 'Velocidade', 'Benefícios', 'Curiosidade', 'Preço', 'Estabilidade'];
const CHANNELS = ['WhatsApp', 'Telefone', 'Site', 'Instagram', 'Presencial'];

export function WhatsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={clsx('h-[18px] w-[18px] shrink-0', className)} aria-hidden>
      <path fill="#22A447" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1.1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

function LeadForm({ lead, onDone }: { lead?: Lead; onDone: () => void }) {
  const { can, me } = useAuth();
  const lookups = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState({
    name: lead?.name ?? '',
    phone: lead?.phone ?? '',
    email: lead?.email ?? '',
    segment: (lead?.segment ?? 'residencial') as Segment,
    city: lead?.city ?? '',
    channel: lead?.channel ?? '',
    sourceId: lead?.sourceId ?? '',
    ownerId: lead?.ownerId ?? me?.user.id ?? '',
    interests: lead?.interests ?? [],
    status: lead?.status ?? 'novo',
    nextAction: lead?.nextAction ?? '',
    nextActionAt: isoToLocalInput(lead?.nextActionAt),
    notes: lead?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const canAssign = can('leads', 'equipe');

  const save = useMutation({
    mutationFn: async (extra: { registerContact?: boolean } = {}) => {
      const body: Record<string, unknown> = {
        name: form.name, phone: form.phone || null, email: form.email || null, segment: form.segment, city: form.city || null, channel: form.channel || null,
        sourceId: form.sourceId || null, interests: form.interests, nextAction: form.nextAction || null, nextActionAt: localInputToIso(form.nextActionAt), notes: form.notes || null,
      };
      if (canAssign || !lead) body.ownerId = form.ownerId || null;
      if (lead) {
        body.status = form.status;
        body.rowVersion = lead.rowVersion;
        if (extra.registerContact) body.lastContactAt = new Date().toISOString();
        return api<Lead>(`/leads/${lead.id}`, { method: 'PATCH', body });
      }
      return api<Lead>('/leads', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast({ tone: 'success', message: lead ? 'Lead salvo' : 'Lead criado' });
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      toast({ tone: 'error', message: e instanceof ApiError && e.status === 409 ? 'Outra pessoa alterou este lead. Feche e abra de novo.' : (e as Error).message });
    },
  });
  const convert = useMutation({
    mutationFn: () => api<{ opportunityId: string }>(`/leads/${lead!.id}/convert`, { method: 'POST', body: { rowVersion: lead!.rowVersion } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['leads'] }); nav(`/opportunities/${r.opportunityId}`); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (save.isPending) return; setErrors({}); save.mutate({}); };

  return (
    <form id="lead-form" onSubmit={submit} className="space-y-4" noValidate>
      <FormField label="Nome" htmlFor="lf-name" required error={errors.name}>
        <Input id="lf-name" value={form.name} invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} data-autofocus />
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Telefone / WhatsApp" htmlFor="lf-phone" error={errors.phone}><Input id="lf-phone" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></FormField>
        <FormField label="E-mail" htmlFor="lf-email" error={errors.email}><Input id="lf-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></FormField>
        <FormField label="Segmento" htmlFor="lf-seg"><Select id="lf-seg" value={form.segment} onChange={(e) => set('segment', e.target.value)}>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</Select></FormField>
        <FormField label="Cidade" htmlFor="lf-city"><Input id="lf-city" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Ex.: Aracaju" /></FormField>
        <FormField label="Canal" htmlFor="lf-channel"><Select id="lf-channel" value={form.channel} onChange={(e) => set('channel', e.target.value)}><option value="">Não informado</option>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</Select></FormField>
        <FormField label="Origem" htmlFor="lf-source"><Select id="lf-source" value={form.sourceId} onChange={(e) => set('sourceId', e.target.value)}><option value="">Não informada</option>{lookups.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></FormField>
        {(canAssign || !lead) && (
          <FormField label="Responsável" htmlFor="lf-owner" error={errors.ownerId}>
            <Select id="lf-owner" value={form.ownerId} disabled={!canAssign} onChange={(e) => set('ownerId', e.target.value)}>{lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          </FormField>
        )}
        {lead && (
          <FormField label="Status" htmlFor="lf-status">
            <Select id="lf-status" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {LEAD_STATUSES.filter((s) => s !== 'convertido' || lead.status === 'convertido').map((s) => <option key={s} value={s} disabled={s === 'convertido'}>{LEAD_STATUS_LABELS[s]}</option>)}
            </Select>
          </FormField>
        )}
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-ink">Interesse</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const on = form.interests.includes(i);
            return (
              <label key={i} className={`cursor-pointer rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-primary bg-primary-soft text-primary' : 'border-line hover:border-line-strong'}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => set('interests', on ? form.interests.filter((x) => x !== i) : [...form.interests, i])} />
                {i}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Próxima ação" htmlFor="lf-na"><Input id="lf-na" value={form.nextAction} onChange={(e) => set('nextAction', e.target.value)} placeholder="Ex.: ligar para entender o uso" /></FormField>
        <FormField label="Quando" htmlFor="lf-nat"><Input id="lf-nat" type="datetime-local" value={form.nextActionAt} onChange={(e) => set('nextActionAt', e.target.value)} /></FormField>
      </div>
      <FormField label="Observações" htmlFor="lf-notes"><Textarea id="lf-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
      {lead && (
        <div className="space-y-2 rounded-md border border-line bg-surface-2 p-3 text-sm">
          <p className="text-muted">Criado em {fmtDateTime(lead.createdAt)} · último contato {lead.lastContactAt ? fmtRelative(lead.lastContactAt) : 'nunca'}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => save.mutate({ registerContact: true })} loading={save.isPending}>Registrar contato agora</Button>
            {lead.status !== 'convertido' && lead.status !== 'descartado' && can('oportunidades') && <Button size="sm" variant="primary" onClick={() => convert.mutate()} loading={convert.isPending}>Converter em oportunidade</Button>}
            {lead.convertedOpportunityId && <Button size="sm" onClick={() => nav(`/opportunities/${lead.convertedOpportunityId}`)}>Abrir oportunidade</Button>}
          </div>
        </div>
      )}
    </form>
  );
}

function RowMenu({ lead, onEdit, onConvert }: { lead: Lead; onEdit: () => void; onConvert: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="rounded-sm p-1.5 text-ink hover:bg-surface-2" aria-label={`Ações para ${lead.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><MoreVertical className="h-5 w-5" /></button>
      {open && (
        <ul role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-line bg-surface py-1 text-sm shadow-overlay">
          <li><button role="menuitem" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setOpen(false); onEdit(); }}>Abrir e editar</button></li>
          {lead.status !== 'convertido' && lead.status !== 'descartado' && <li><button role="menuitem" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setOpen(false); onConvert(); }}>Converter em oportunidade</button></li>}
        </ul>
      )}
    </div>
  );
}

const STATUS_TABS: ('' | LeadStatus)[] = ['', 'novo', 'em_contato', 'qualificado', 'descartado'];
const TAB_LABEL: Record<string, string> = { '': 'Todos', novo: 'Novos', em_contato: 'Em contato', qualificado: 'Qualificados', descartado: 'Descartados' };

export function LeadsPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useUrlState({ q: '', status: '', sourceId: '', ownerId: '', channel: '', sort: 'last_contact_at', dir: 'desc', page: '1', size: '8', view: 'lista' });
  const [search, setSearch] = useState(f.q);
  const dq = useDebounced(search);
  useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Lead | 'new' | null>(null);
  const [assignTo, setAssignTo] = useState('');
  const [confirmAssign, setConfirmAssign] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const kanban = f.view === 'kanban';

  const summary = useQuery({ queryKey: ['leads', 'summary'], queryFn: () => api<{ counts: Record<string, number>; kpis: Kpi[] }>('/leads/summary') });
  const q = useQuery({
    queryKey: ['leads', f],
    queryFn: () => api<Paged<Lead>>(`/leads${qs({ q: f.q, status: f.status, sourceId: f.sourceId, ownerId: f.ownerId, channel: f.channel, sort: f.sort, dir: f.dir, page: kanban ? 1 : f.page, pageSize: kanban ? 100 : f.size })}`),
    placeholderData: keepPreviousData,
  });
  const convert = useMutation({
    mutationFn: (l: Lead) => api<{ opportunityId: string }>(`/leads/${l.id}/convert`, { method: 'POST', body: { rowVersion: l.rowVersion } }),
    onSuccess: (r) => nav(`/opportunities/${r.opportunityId}`),
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const bulk = useMutation({
    mutationFn: () => api<{ updated: number }>('/leads/bulk-assign', { method: 'POST', body: { ids: [...selected], ownerId: assignTo } }),
    onSuccess: (r) => { toast({ tone: 'success', message: `${r.updated} lead(s) atribuídos` }); setSelected(new Set()); setConfirmAssign(false); qc.invalidateQueries({ queryKey: ['leads'] }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });

  const kpiLook = [
    { icon: <UsersRound className="h-7 w-7" />, tone: 'blue' as const },
    { icon: <Phone className="h-7 w-7" />, tone: 'green' as const },
    { icon: <Filter className="h-7 w-7" />, tone: 'purple' as const },
    { icon: <XCircle className="h-7 w-7" />, tone: 'orange' as const },
  ];
  const counts = summary.data?.counts;
  const items = q.data?.items ?? [];
  const allSelected = items.length > 0 && items.every((l) => selected.has(l.id));

  return (
    <div className="w-full">
      <PageHeader
        icon={<UsersRound className="h-9 w-9" strokeWidth={2.2} />}
        title="Leads"
        subtitle="Gerencie seus leads e transforme interesse em oportunidades."
        mascot={{ slot: 'mascote_leads', lines: ['Mais oportunidades', 'para o seu dia.'], highlight: <ConfiarFacilPartial /> }}
        actions={
          <>
            <Button variant="outline" size="lg" icon={<Upload className="h-5 w-5" />} onClick={() => setImporting(true)}>Importar</Button>
            <Button variant="primary" size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setEditing('new')}>Novo lead</Button>
          </>
        }
      />

      <section aria-label="Indicadores" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(summary.data?.kpis ?? []).map((k, i) => <KpiCard key={k.key} k={k} icon={kpiLook[i]!.icon} tone={kpiLook[i]!.tone} />)}
        {!summary.data && Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-[92px] animate-pulse" />)}
      </section>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs<string>
          label="Status dos leads"
          className="flex-1 border-b-0"
          value={f.status}
          onChange={(s) => setF({ status: s })}
          tabs={STATUS_TABS.map((s) => ({ key: s, label: TAB_LABEL[s]!, count: counts ? (s ? counts[s] : counts.todos) : undefined }))}
        />
        <div className="flex rounded-md border border-line bg-surface p-1" role="group" aria-label="Visualização">
          <button aria-pressed={kanban} onClick={() => setF({ view: 'kanban' })} className={clsx('flex items-center gap-2 rounded-sm px-4 py-2 text-md', kanban ? 'bg-primary-soft font-semibold text-primary' : 'text-ink')}><Columns3 className="h-5 w-5" />Kanban</button>
          <button aria-pressed={!kanban} onClick={() => setF({ view: 'lista' })} className={clsx('flex items-center gap-2 rounded-sm px-4 py-2 text-md', !kanban ? 'bg-primary-soft font-semibold text-primary' : 'text-ink')}><List className="h-5 w-5" />Lista</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3" role="search">
        <div className="relative min-w-[220px] flex-1 lg:max-w-[250px]">
          <label htmlFor="leads-q" className="sr-only">Buscar leads</label>
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden />
          <Input id="leads-q" aria-label="Buscar leads" className="h-12 pl-10" placeholder="Buscar leads..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Canal" className="h-12 w-auto min-w-[170px]" value={f.channel} onChange={(e) => setF({ channel: e.target.value })}>
          <option value="">Todos os canais</option>
          {CHANNELS.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select aria-label="Origem" className="h-12 w-auto min-w-[170px]" value={f.sourceId} onChange={(e) => setF({ sourceId: e.target.value })}>
          <option value="">Todas as origens</option>
          {lookups.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select aria-label="Status" className="h-12 w-auto min-w-[170px]" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="">Todos os status</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
        </Select>
        {can('leads', 'equipe') && (
          <Select aria-label="Responsável" className="h-12 w-auto min-w-[200px]" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value })}>
            <option value="">Todos os responsáveis</option>
            <option value="me">Meus leads</option>
            <option value="none">Sem responsável</option>
            {lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
        <div className="relative ml-auto">
          <Button size="lg" icon={<SlidersHorizontal className="h-5 w-5" />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>Filtros</Button>
          {filtersOpen && (
            <div className="absolute right-0 z-30 mt-2 w-64 space-y-3 rounded-md border border-line bg-surface p-4 shadow-overlay">
              <FormField label="Ordenar por" htmlFor="lf-sort">
                <Select id="lf-sort" value={`${f.sort}:${f.dir}`} onChange={(e) => { const [s, d] = e.target.value.split(':'); setF({ sort: s!, dir: d! }); }}>
                  <option value="last_contact_at:desc">Última interação (recente)</option>
                  <option value="created_at:desc">Mais novos</option>
                  <option value="created_at:asc">Mais antigos</option>
                  <option value="name:asc">Nome (A–Z)</option>
                  <option value="next_action_at:asc">Próxima ação</option>
                </Select>
              </FormField>
              <Button size="sm" className="w-full" onClick={() => { setSearch(''); setF({ q: '', status: '', sourceId: '', ownerId: '', channel: '', sort: 'last_contact_at', dir: 'desc' }); setFiltersOpen(false); }}>Limpar filtros</Button>
            </div>
          )}
        </div>
      </div>

      {selected.size > 0 && can('leads', 'equipe') && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary-soft px-4 py-2 text-sm">
          <span className="font-semibold">{selected.size} selecionado(s)</span>
          <Select aria-label="Atribuir a" className="h-9 w-auto" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">Atribuir a…</option>
            {lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Button size="sm" icon={<UserPlus className="h-4 w-4" />} disabled={!assignTo} onClick={() => setConfirmAssign(true)}>Atribuir</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar seleção</Button>
        </div>
      )}

      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !items.length ? (
        <div className="card"><EmptyState title="Nenhum lead encontrado" description="Ajuste os filtros ou cadastre um novo lead." action={<Button variant="primary" onClick={() => setEditing('new')}>Novo lead</Button>} /></div>
      ) : kanban ? (
        <div className="scroll-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
          {(['novo', 'em_contato', 'qualificado', 'descartado'] as LeadStatus[]).map((st) => (
            <section key={st} className="w-[290px] shrink-0 rounded-lg border border-line bg-surface-2 p-3" aria-label={TAB_LABEL[st]}>
              <h2 className="mb-3 flex items-center gap-2 px-1 text-md font-bold text-ink">{LEAD_STATUS_LABELS[st]} <span className="num rounded-full bg-primary px-2 text-xs text-white">{items.filter((l) => l.status === st).length}</span></h2>
              <ul className="space-y-2.5">
                {items.filter((l) => l.status === st).map((l) => (
                  <li key={l.id}>
                    <button className="card w-full p-3 text-left hover:border-line-strong" onClick={() => setEditing(l)}>
                      <span className="flex items-center gap-2.5"><Avatar name={l.name} size={34} tone={0} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{l.name}</span><span className="block text-2xs text-muted">{productLabel(l.segment)}</span></span></span>
                      <span className="mt-2 flex items-center justify-between"><SourceChip name={l.sourceName} /><span className="text-2xs text-muted">{fmtRelativeShort(l.lastContactAt ?? l.createdAt)}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left">
              <caption className="sr-only">Lista de leads</caption>
              <thead className="bg-surface-2 text-sm text-muted">
                <tr>
                  <th className="w-12 px-4 py-3"><input type="checkbox" className="h-5 w-5" aria-label="Selecionar todos desta página" checked={allSelected} onChange={() => { const n = new Set(selected); items.forEach((l) => (allSelected ? n.delete(l.id) : n.add(l.id))); setSelected(n); }} /></th>
                  {['Nome', 'Contato', 'Origem', 'Interesse', 'Status', 'Responsável', 'Última interação'].map((h) => <th key={h} scope="col" className="px-3 py-3 font-medium">{h}</th>)}
                  <th scope="col" className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className={clsx('cursor-pointer border-t border-line hover:bg-surface-2/60', selected.has(l.id) && 'bg-primary-soft/40')} onClick={() => setEditing(l)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="h-5 w-5" aria-label={`Selecionar ${l.name}`} checked={selected.has(l.id)} onChange={() => { const n = new Set(selected); n.has(l.id) ? n.delete(l.id) : n.add(l.id); setSelected(n); }} /></td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-3"><Avatar name={l.name} size={40} tone={l.status === 'descartado' ? 4 : 0} /><span><span className="block font-semibold text-ink">{l.name}</span><span className="block text-xs text-muted">{productLabel(l.segment)}</span></span></span>
                    </td>
                    <td className="px-3 py-3"><span className="num flex items-center gap-2 whitespace-nowrap text-sm text-text">{l.phone && <WhatsIcon />}{l.phone ?? '—'}</span></td>
                    <td className="px-3 py-3"><SourceChip name={l.sourceName} /></td>
                    <td className="px-3 py-3"><InterestTag value={l.interests[0]} /></td>
                    <td className="px-3 py-3"><LeadStatusChip status={l.status} /></td>
                    <td className="px-3 py-3"><span className="flex items-center gap-2 whitespace-nowrap text-sm text-text">{l.ownerId ? <><Avatar name={l.ownerName} userId={l.ownerId} hasPhoto={l.ownerHasAvatar} size={30} />{l.ownerName}</> : <Chip tone="orange">Sem responsável</Chip>}</span></td>
                    <td className="px-3 py-3"><span className="block whitespace-nowrap text-sm text-text">{fmtRelativeShort(l.lastContactAt ?? l.createdAt)}</span><span className="block text-xs text-muted">{l.lastInteractionNote ?? ''}</span></td>
                    <td className="px-4 py-3 text-right"><RowMenu lead={l} onEdit={() => setEditing(l)} onConvert={() => convert.mutate(l)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination noun="leads" page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={(p) => setF({ page: String(p) }, { resetPage: false })} onPageSize={(s) => setF({ size: String(s) })} />
        </div>
      )}

      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Novo lead' : editing ? editing.name : ''} footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" type="submit" form="lead-form">{editing === 'new' ? 'Criar lead' : 'Salvar lead'}</Button></>}>
        {editing && <LeadForm key={editing === 'new' ? 'new' : editing.id + editing.rowVersion} lead={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Drawer>
      <ConfirmDialog open={confirmAssign} title="Atribuir leads" confirmLabel="Atribuir" loading={bulk.isPending} onCancel={() => setConfirmAssign(false)} onConfirm={() => bulk.mutate()}>
        <p>{selected.size} lead(s) passarão para <strong>{lookups.data?.users.find((u) => u.id === assignTo)?.name}</strong>. A mudança fica registrada no log.</p>
      </ConfirmDialog>
      <Modal open={importing} onClose={() => setImporting(false)} title="Importar leads" size="sm" footer={<Button onClick={() => setImporting(false)}>Fechar</Button>}>
        <Notice>A importação de planilhas (CSV/JSON) com prévia, validação linha a linha e desfazer por lote chega na Fase 3. Por enquanto, cadastre leads pelo botão “Novo lead”.</Notice>
      </Modal>
    </div>
  );
}
