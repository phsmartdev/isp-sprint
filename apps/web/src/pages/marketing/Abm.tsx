/** Marketing → ABM: contas-alvo escolhidas entre as contas existentes, com tier, situação, responsável, próximo passo e o trabalho ligado a elas. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Crosshair, Plus } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { useDebounced, useLookups, useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { WorkLinks } from '../../features/tasks/WorkLinks';

type Tier = '1_1' | '1_poucos' | '1_muitos';
type Status = 'identificada' | 'engajando' | 'oportunidade' | 'cliente' | 'pausada';
const TIER_LABELS: Record<Tier, string> = { '1_1': '1:1 (estratégica)', '1_poucos': '1:poucos (cluster)', '1_muitos': '1:muitos (escala)' };
const STATUS_LABELS: Record<Status, string> = { identificada: 'Identificada', engajando: 'Engajando', oportunidade: 'Em oportunidade', cliente: 'Cliente', pausada: 'Pausada' };
const STATUS_TONE: Record<Status, Tone> = { identificada: 'neutral', engajando: 'sky', oportunidade: 'blue', cliente: 'green', pausada: 'orange' };
const PRIO_TONE = { alta: 'red', media: 'sky', baixa: 'neutral' } as const;
type Account = { id: string; contactId: string; name: string; segment: string; city: string | null; tier: Tier; status: Status; priority: 'alta' | 'media' | 'baixa'; ownerId: string; ownerName: string; reason: string; nextStep: string | null; nextStepOn: string | null; isCustomer: boolean; openOpportunities: number; openValueCents: number; pendingActivities: number; lastContactAt: string | null; rowVersion: number };

export function AbmPage() {
  const [u, setU] = useUrlState({ tier: '', status: '', owner: '', q: '', id: '' });
  const q = useQuery({ queryKey: ['abm', u.tier, u.status, u.owner, u.q], placeholderData: keepPreviousData, queryFn: () => api<{ items: Account[]; counts: Record<Status, number> }>(`/abm${qs({ tier: u.tier || undefined, status: u.status || undefined, ownerId: u.owner || undefined, q: u.q || undefined })}`) });
  const users = useLookups().data?.users ?? [];
  const [adding, setAdding] = useState(false);
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <div>
      <PageHeader icon={<Crosshair />} title="ABM" subtitle="Contas-alvo do marketing baseado em contas: quem priorizar, por quê, em que estágio e qual o próximo passo." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Adicionar conta-alvo</Button>} />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Situação">
        <button type="button" aria-pressed={!u.status} onClick={() => setU({ status: '' })} className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', !u.status ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink')}>Todas</button>
        {(Object.keys(STATUS_LABELS) as Status[]).map((s) => <button key={s} type="button" aria-pressed={u.status === s} onClick={() => setU({ status: s })} className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', u.status === s ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink')}>{STATUS_LABELS[s]} <span className="num">{q.data?.counts[s] ?? 0}</span></button>)}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Buscar conta" htmlFor="abm-q"><Input id="abm-q" className="w-60" value={u.q} onChange={(e) => setU({ q: e.target.value })} /></FormField>
        <FormField label="Tier" htmlFor="abm-tier"><Select id="abm-tier" value={u.tier} onChange={(e) => setU({ tier: e.target.value })}><option value="">Todos</option>{(Object.keys(TIER_LABELS) as Tier[]).map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}</Select></FormField>
        <FormField label="Responsável" htmlFor="abm-owner"><Select id="abm-owner" value={u.owner} onChange={(e) => setU({ owner: e.target.value })}><option value="">Todos</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
      </div>
      <section className="card overflow-hidden">
        {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <EmptyState title="Nenhuma conta-alvo" description="Escolha contas da sua carteira que merecem abordagem dedicada e registre o motivo." action={<Button variant="primary" onClick={() => setAdding(true)}>Adicionar conta-alvo</Button>} /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Conta', 'Tier', 'Situação', 'Responsável', 'Oportunidades abertas', 'Pendências', 'Último contato', 'Próximo passo'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.items.map((a) => (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="px-3 py-2.5"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => setU({ id: a.id }, { resetPage: false })}>{a.name}</button><span className="mt-0.5 flex flex-wrap gap-1.5"><Chip tone={PRIO_TONE[a.priority]}>Prioridade {a.priority}</Chip>{a.isCustomer && <Chip tone="green">Já é cliente</Chip>}</span></td>
                    <td className="px-3 py-2.5 text-xs">{TIER_LABELS[a.tier]}</td>
                    <td className="px-3 py-2.5"><Chip tone={STATUS_TONE[a.status]}>{STATUS_LABELS[a.status]}</Chip></td>
                    <td className="px-3 py-2.5">{a.ownerName}</td>
                    <td className="num px-3 py-2.5">{a.openOpportunities}{a.openOpportunities > 0 && <span className="block text-xs text-muted">{fmtBRL(a.openValueCents)}/mês</span>}</td>
                    <td className="num px-3 py-2.5">{a.pendingActivities}</td>
                    <td className="num px-3 py-2.5">{a.lastContactAt ? fmtDate(a.lastContactAt) : '—'}</td>
                    <td className="max-w-[240px] px-3 py-2.5 text-xs">{a.nextStep ?? '—'}{a.nextStepOn && <span className={clsx('num block', a.nextStepOn < today ? 'font-semibold text-danger' : 'text-muted')}>{fmtDate(a.nextStepOn)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AddAccount open={adding} onClose={() => setAdding(false)} />
      <AccountDrawer id={u.id || null} onClose={() => setU({ id: '' }, { resetPage: false })} />
    </div>
  );
}

function AddAccount({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 250);
  const found = useQuery({ queryKey: ['contacts', 'search', term], enabled: open && term.trim().length >= 2, queryFn: () => api<{ items: { id: string; name: string; segment: string; customerId: string | null }[] }>(`/contacts${qs({ q: term })}`) });
  const [f, setF] = useState({ contactId: '', contactName: '', tier: '1_muitos' as Tier, priority: 'media', ownerId: '', reason: '', nextStep: '', nextStepOn: '' });
  const m = useMutation({
    mutationFn: () => api('/abm', { method: 'POST', body: { contactId: f.contactId, tier: f.tier, priority: f.priority, ownerId: f.ownerId || me?.user.id, reason: f.reason, nextStep: f.nextStep || null, nextStepOn: f.nextStepOn || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['abm'] }); onClose(); setF({ ...f, contactId: '', contactName: '', reason: '', nextStep: '', nextStepOn: '' }); setSearch(''); toast({ tone: 'success', message: 'Conta-alvo adicionada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Adicionar conta-alvo" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.contactId || f.reason.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Adicionar</Button></>}>
      <div className="space-y-4">
        {f.contactId ? <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">Conta: <span className="font-semibold text-ink">{f.contactName}</span> <button type="button" className="ml-2 text-primary hover:underline" onClick={() => setF({ ...f, contactId: '', contactName: '' })}>trocar</button></p> : (
          <FormField label="Conta" htmlFor="abm-search" hint="Busque na sua carteira pelo nome, telefone ou e-mail"><Input id="abm-search" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus /></FormField>
        )}
        {!f.contactId && !!found.data?.items.length && <ul className="max-h-48 overflow-y-auto rounded-md border border-line">{found.data.items.map((c) => <li key={c.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setF({ ...f, contactId: c.id, contactName: c.name })}>{c.name} <span className="text-xs text-muted">{c.customerId ? '· cliente' : '· prospect'}</span></button></li>)}</ul>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Tier" htmlFor="abm-t"><Select id="abm-t" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value as Tier })}>{(Object.keys(TIER_LABELS) as Tier[]).map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}</Select></FormField>
          <FormField label="Prioridade" htmlFor="abm-p"><Select id="abm-p" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></Select></FormField>
          <FormField label="Responsável" htmlFor="abm-o"><Select id="abm-o" value={f.ownerId || me?.user.id || ''} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
        </div>
        <FormField label="Por que é alvo" htmlFor="abm-r" required><Textarea id="abm-r" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Potencial, momento, encaixe com a oferta…" /></FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <FormField label="Próximo passo" htmlFor="abm-n"><Input id="abm-n" value={f.nextStep} onChange={(e) => setF({ ...f, nextStep: e.target.value })} /></FormField>
          <FormField label="Até" htmlFor="abm-d"><Input id="abm-d" type="date" value={f.nextStepOn} onChange={(e) => setF({ ...f, nextStepOn: e.target.value })} /></FormField>
        </div>
      </div>
    </Modal>
  );
}

function AccountDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['abm', 'one', id], enabled: !!id, queryFn: () => api<Account & { segment: string; opportunities: { id: string; code: number; title: string; stage: string; valueCents: number | null; ownerName: string }[]; events: { id: string; type: string; createdAt: string; actorName: string | null; payload: Record<string, unknown> }[] }>(`/abm/${id}`) });
  const [f, setF] = useState<Partial<Account> | null>(null);
  const a = q.data;
  const cur = { ...a, ...f } as Account;
  const m = useMutation({
    mutationFn: () => api(`/abm/${id}`, { method: 'PATCH', body: { rowVersion: a!.rowVersion, ...f } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['abm'] }); setF(null); toast({ tone: 'success', message: 'Conta-alvo atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Drawer open={!!id} onClose={() => { setF(null); onClose(); }} title="Conta-alvo" width="lg">
      {!a ? <LoadingRows rows={5} /> : (
        <div className="space-y-5">
          <div><h3 className="text-lg font-bold text-ink">{a.name}</h3><Link to={`/customers/${a.contactId}`} className="text-sm font-semibold text-primary hover:underline">Abrir a conta</Link></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Situação" htmlFor="ad-s"><Select id="ad-s" value={cur.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>{(Object.keys(STATUS_LABELS) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select></FormField>
            <FormField label="Tier" htmlFor="ad-t"><Select id="ad-t" value={cur.tier} onChange={(e) => setF({ ...f, tier: e.target.value as Tier })}>{(Object.keys(TIER_LABELS) as Tier[]).map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}</Select></FormField>
            <FormField label="Prioridade" htmlFor="ad-p"><Select id="ad-p" value={cur.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Account['priority'] })}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></Select></FormField>
          </div>
          <FormField label="Por que é alvo" htmlFor="ad-r"><Textarea id="ad-r" rows={2} value={cur.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <FormField label="Próximo passo" htmlFor="ad-n"><Input id="ad-n" value={cur.nextStep ?? ''} onChange={(e) => setF({ ...f, nextStep: e.target.value || null })} /></FormField>
            <FormField label="Até" htmlFor="ad-d"><Input id="ad-d" type="date" value={cur.nextStepOn ?? ''} onChange={(e) => setF({ ...f, nextStepOn: e.target.value || null })} /></FormField>
          </div>
          {f && <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Salvar alterações</Button>}
          <section>
            <h4 className="mb-1 font-bold text-ink">Oportunidades</h4>
            {!a.opportunities.length ? <p className="text-sm text-muted">Nenhuma oportunidade com esta conta.</p> : <ul className="divide-y divide-line">{a.opportunities.map((o) => <li key={o.id} className="flex items-center gap-2 py-2 text-sm"><Link to={`/opportunities/${o.id}`} className="min-w-0 flex-1 truncate font-semibold text-primary hover:underline">OP-{o.code} · {o.title}</Link><span className="text-xs text-muted">{o.stage} · {o.ownerName}</span>{o.valueCents !== null && <span className="num text-xs">{fmtBRL(o.valueCents)}</span>}</li>)}</ul>}
          </section>
          <WorkLinks prefill={{ contactId: a.contactId, label: a.name }} />
          <section>
            <h4 className="mb-1 font-bold text-ink">Histórico</h4>
            <ol className="space-y-1 text-sm">{a.events.map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · {e.actorName}: {e.type === 'criada' ? 'adicionou como conta-alvo' : e.type === 'situacao' ? `mudou a situação para ${STATUS_LABELS[(e.payload.to as Record<string, string>)?.status as Status] ?? ''}` : 'atualizou'}</li>)}</ol>
          </section>
        </div>
      )}
    </Drawer>
  );
}
