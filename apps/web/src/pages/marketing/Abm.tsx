/**
 * Marketing → ABM — Contas Estratégicas. Camada estratégica sobre as contas existentes (sem cadastro paralelo):
 * contas novas para prospectar e contas já cadastradas, com status ABM, status comercial derivado dos dados reais, prioridade e histórico.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Crosshair, Plus, Search } from 'lucide-react';
import {
  ABM_ORIGIN_LABELS, ABM_PRIORITY_LABELS, ABM_STATUS_LABELS, ABM_TIER_LABELS, COMMERCIAL_STATUS_LABELS, abmTransition,
  type AbmOrigin, type AbmPriority, type AbmStatus, type AbmTier, type CommercialStatus,
} from '@isp/domain';
import { api, ApiError, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { useDebounced, useLookups, useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { WorkLinks } from '../../features/tasks/WorkLinks';
import { StakeholdersDirectory } from '../../features/abm/stakeholders';
import { PlaysLibrary } from '../../features/abm/plays';
import { AbmFields, CommercialChip, PriorityChip, StatusChip, abmFormBody, blankAbmForm } from '../../features/abm/shared';

type Account = {
  id: string; contactId: string; name: string; segment: string; city: string | null; nature: 'publica' | 'privada' | null; tier: AbmTier; status: AbmStatus; priority: AbmPriority;
  ownerId: string; ownerName: string; reason: string; objective: string | null; origin: AbmOrigin | null; notes: string | null; statusReason: string | null; nextStep: string | null; nextStepOn: string | null;
  commercial: CommercialStatus; isCustomer: boolean; activeContracts: number; openOpportunities: number; openValueCents: number; pendingActivities: number; lastContactAt: string | null; rowVersion: number;
};
const NATURE = { publica: 'Pública', privada: 'Privada' } as const;

export function AbmPage() {
  const [u, setU] = useUrlState({ tab: 'contas', status: '', priority: '', commercial: '', owner: '', q: '', id: '' });
  return (
    <div>
      <PageHeader icon={<Crosshair />} title="ABM — Contas Estratégicas" subtitle="Prospecção e desenvolvimento de contas escolhidas, novas ou já cadastradas, sobre o mesmo cadastro do CRM." />
      <Tabs label="ABM" value={(['stakeholders', 'plays'].includes(u.tab) ? u.tab : 'contas') as 'contas' | 'stakeholders' | 'plays'} onChange={(k) => setU({ tab: k })} tabs={[{ key: 'contas', label: 'Contas' }, { key: 'stakeholders', label: 'Stakeholders' }, { key: 'plays', label: 'Plays' }]} className="mb-4" />
      {u.tab === 'stakeholders' ? <StakeholdersDirectory /> : u.tab === 'plays' ? <PlaysLibrary /> : <AccountsTab u={u} setU={setU} />}
      <AccountDrawer id={u.id || null} onClose={() => setU({ id: '' }, { resetPage: false })} />
    </div>
  );
}

function AccountsTab({ u, setU }: { u: Record<string, string>; setU: (p: Record<string, string>, o?: { resetPage?: boolean }) => void }) {
  const q = useQuery({
    queryKey: ['abm', u.status, u.priority, u.commercial, u.owner, u.q], placeholderData: keepPreviousData,
    queryFn: () => api<{ items: Account[]; counts: Record<AbmStatus, number> }>(`/abm${qs({ status: u.status || undefined, priority: u.priority || undefined, commercial: u.commercial || undefined, ownerId: u.owner || undefined, q: u.q || undefined })}`),
  });
  const users = useLookups().data?.users ?? [];
  const [mode, setMode] = useState<'nova' | 'existente' | null>(null);
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Status ABM">
          <button type="button" aria-pressed={!u.status} onClick={() => setU({ status: '' })} className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', !u.status ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink')}>Todas</button>
          {(Object.keys(ABM_STATUS_LABELS) as AbmStatus[]).map((s) => <button key={s} type="button" aria-pressed={u.status === s} onClick={() => setU({ status: s })} className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', u.status === s ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink')}>{ABM_STATUS_LABELS[s]} <span className="num">{q.data?.counts[s] ?? 0}</span></button>)}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" icon={<Search className="h-4 w-4" />} onClick={() => setMode('existente')}>Adicionar conta existente</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setMode('nova')}>Nova conta</Button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Buscar conta" htmlFor="abm-q"><Input id="abm-q" className="w-56" value={u.q} onChange={(e) => setU({ q: e.target.value })} /></FormField>
        <FormField label="Prioridade" htmlFor="abm-p"><Select id="abm-p" value={u.priority} onChange={(e) => setU({ priority: e.target.value })}><option value="">Todas</option>{(Object.keys(ABM_PRIORITY_LABELS) as AbmPriority[]).map((p) => <option key={p} value={p}>{ABM_PRIORITY_LABELS[p]}</option>)}</Select></FormField>
        <FormField label="Status comercial" htmlFor="abm-c"><Select id="abm-c" value={u.commercial} onChange={(e) => setU({ commercial: e.target.value })}><option value="">Todos</option>{(Object.keys(COMMERCIAL_STATUS_LABELS) as CommercialStatus[]).map((c) => <option key={c} value={c}>{COMMERCIAL_STATUS_LABELS[c]}</option>)}</Select></FormField>
        <FormField label="Responsável" htmlFor="abm-owner"><Select id="abm-owner" value={u.owner} onChange={(e) => setU({ owner: e.target.value })}><option value="">Todos</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
      </div>
      <section className="card overflow-hidden">
        {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? (
          <EmptyState title="Nenhuma conta no ABM" description="Cadastre uma organização nova para prospectar ou traga uma conta que já está no CRM." action={<Button variant="primary" onClick={() => setMode('nova')}>Nova conta</Button>} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Conta', 'Status ABM', 'Status comercial', 'Responsável', 'Oportunidades abertas', 'Último contato', 'Próximo passo'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.items.map((a) => (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="px-3 py-2.5">
                      <Link to={`/abm/contas/${a.id}`} className="text-left font-semibold text-primary hover:underline">{a.name}</Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5"><PriorityChip p={a.priority} />{a.nature && <span className="text-xs text-muted">{NATURE[a.nature]}</span>}{a.city && <span className="text-xs text-muted">· {a.city}</span>}</span>
                    </td>
                    <td className="px-3 py-2.5"><StatusChip s={a.status} /><span className="block text-xs text-muted">{ABM_TIER_LABELS[a.tier]}</span></td>
                    <td className="px-3 py-2.5"><CommercialChip s={a.commercial} /></td>
                    <td className="px-3 py-2.5">{a.ownerName}</td>
                    <td className="num px-3 py-2.5">{a.openOpportunities}{a.openOpportunities > 0 && <span className="block text-xs text-muted">{fmtBRL(a.openValueCents)}/mês</span>}</td>
                    <td className="num px-3 py-2.5">{a.lastContactAt ? fmtDate(a.lastContactAt) : '—'}</td>
                    <td className="max-w-[240px] px-3 py-2.5 text-xs">{a.nextStep ?? '—'}{a.nextStepOn && <span className={clsx('num block', a.nextStepOn < today ? 'font-semibold text-danger' : 'text-muted')}>{fmtDate(a.nextStepOn)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <NewAccount open={mode === 'nova'} onClose={() => setMode(null)} onLinkExisting={() => setMode('existente')} onCreated={(id) => { setMode(null); setU({ id }, { resetPage: false }); }} />
      <AddExisting open={mode === 'existente'} onClose={() => setMode(null)} />
    </>
  );
}

type Dup = { id: string; name: string; city: string | null; reasons: string[]; score: number; inAbm: boolean; visible: boolean };
/** Nova organização para prospectar: confere duplicidades antes de criar (CNPJ igual bloqueia; nome parecido pede confirmação). */
function NewAccount({ open, onClose, onCreated, onLinkExisting }: { open: boolean; onClose: () => void; onCreated: (abmId: string) => void; onLinkExisting: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const blank = { name: '', nature: '' as '' | 'publica' | 'privada', segment: 'empresarial', city: '', document: '', notes: '' };
  const [org, setOrg] = useState(blank);
  const [f, setF] = useState(blankAbmForm());
  const [ignore, setIgnore] = useState<{ ids: string[]; justification: string }>({ ids: [], justification: '' });
  const name = useDebounced(org.name, 350);
  const doc = useDebounced(org.document, 350);
  const dups = useQuery({ queryKey: ['abm', 'dedup', name, doc, org.city], enabled: open && name.trim().length >= 3, queryFn: () => api<{ items: Dup[] }>(`/abm/dedup${qs({ name, document: doc || undefined, city: org.city || undefined })}`) });
  const list = dups.data?.items ?? [];
  const pending = list.filter((d) => !ignore.ids.includes(d.id));
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/abm/new-account', { method: 'POST', body: {
      name: org.name, nature: org.nature || null, segment: org.segment, city: org.city || null, document: org.document || null, notes: org.notes || null, ...abmFormBody(f, me?.user.id),
      ...(ignore.ids.length ? { ignoreDuplicates: ignore } : {}),
    } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['abm'] }); setOrg(blank); setF(blankAbmForm()); setIgnore({ ids: [], justification: '' }); toast({ tone: 'success', message: 'Conta cadastrada e incluída no ABM como candidata' }); onCreated(r.id); },
    onError: (e) => { if (e instanceof ApiError && e.status === 422) void dups.refetch(); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const exact = list.some((d) => d.reasons.includes('mesmo CNPJ/CPF'));
  const valid = org.name.trim().length >= 3 && f.reason.trim().length >= 5 && !exact && (pending.length === 0) && (!ignore.ids.length || ignore.justification.trim().length >= 10);
  return (
    <Modal open={open} onClose={onClose} title="Nova conta para prospectar" size="xl" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Cadastrar e incluir no ABM</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Só o nome e o motivo são obrigatórios. CNPJ, estrutura e contatos podem ser completados depois.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Nome da organização" htmlFor="na-name" required><Input id="na-name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} autoFocus /></FormField>
          <FormField label="CNPJ" htmlFor="na-doc" hint="Opcional"><Input id="na-doc" inputMode="numeric" value={org.document} onChange={(e) => setOrg({ ...org, document: e.target.value })} /></FormField>
          <FormField label="Natureza" htmlFor="na-nat"><Select id="na-nat" value={org.nature} onChange={(e) => setOrg({ ...org, nature: e.target.value as typeof org.nature })}><option value="">Não informada</option><option value="publica">Pública</option><option value="privada">Privada</option></Select></FormField>
          <FormField label="Segmento" htmlFor="na-seg"><Select id="na-seg" value={org.segment} onChange={(e) => setOrg({ ...org, segment: e.target.value })}><option value="empresarial">Empresarial</option><option value="governamental">Governamental</option><option value="institucional">Institucional</option></Select></FormField>
          <FormField label="Cidade" htmlFor="na-city"><Input id="na-city" value={org.city} onChange={(e) => setOrg({ ...org, city: e.target.value })} /></FormField>
        </div>
        {!!list.length && (
          <section aria-label="Possíveis duplicidades" className={clsx('rounded-lg border p-3', exact ? 'border-danger/40 bg-danger-soft/40' : 'border-warning/40 bg-warning-soft/40')}>
            <h3 className="font-bold text-ink">{exact ? 'Esta organização já está cadastrada' : 'Contas parecidas já cadastradas'}</h3>
            <p className="mb-2 text-sm">{exact ? 'Não crie outra: adicione a conta existente ao ABM.' : 'Confira antes de criar. Se for a mesma organização, use a conta existente.'}</p>
            <ul className="space-y-2">
              {list.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1"><b>{d.name}</b>{d.city && <span className="text-muted"> · {d.city}</span>}<span className="block text-xs text-muted">{d.reasons.join(' · ')}{d.inAbm && ' · já está no ABM'}{!d.visible && ' · de outra carteira'}</span></span>
                  {d.visible && !d.inAbm && <Button size="sm" variant="secondary" onClick={onLinkExisting}>Usar esta conta</Button>}
                  {!exact && !d.reasons.some((r) => r.startsWith('mesmo')) && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={ignore.ids.includes(d.id)} onChange={(e) => setIgnore({ ...ignore, ids: e.target.checked ? [...ignore.ids, d.id] : ignore.ids.filter((x) => x !== d.id) })} />É outra organização</label>}
                </li>
              ))}
            </ul>
            {!!ignore.ids.length && <FormField label="Por que não é a mesma organização" htmlFor="na-just" required className="mt-2"><Input id="na-just" value={ignore.justification} onChange={(e) => setIgnore({ ...ignore, justification: e.target.value })} /></FormField>}
          </section>
        )}
        <AbmFields f={f} set={setF} idp="na" />
        <FormField label="Observações" htmlFor="na-notes"><Textarea id="na-notes" rows={2} value={org.notes} onChange={(e) => setOrg({ ...org, notes: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function AddExisting({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 250);
  const found = useQuery({ queryKey: ['contacts', 'search', term], enabled: open && term.trim().length >= 2, queryFn: () => api<{ items: { id: string; name: string; segment: string; customerId: string | null }[] }>(`/contacts${qs({ q: term })}`) });
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState(blankAbmForm('base_existente'));
  const m = useMutation({
    mutationFn: () => api('/abm', { method: 'POST', body: { contactId: pick!.id, status: 'candidata', ...abmFormBody(f, me?.user.id) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['abm'] }); onClose(); setPick(null); setSearch(''); setF(blankAbmForm('base_existente')); toast({ tone: 'success', message: 'Conta adicionada ao ABM' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Adicionar conta existente ao ABM" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!pick || f.reason.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Adicionar</Button></>}>
      <div className="space-y-4">
        {pick ? <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">Conta: <span className="font-semibold text-ink">{pick.name}</span> <button type="button" className="ml-2 text-primary hover:underline" onClick={() => setPick(null)}>trocar</button></p> : (
          <FormField label="Conta" htmlFor="ae-search" hint="Busque pelo nome, telefone ou e-mail"><Input id="ae-search" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus /></FormField>
        )}
        {!pick && !!found.data?.items.length && <ul className="max-h-48 overflow-y-auto rounded-md border border-line">{found.data.items.map((c) => <li key={c.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setPick({ id: c.id, name: c.name })}>{c.name} <span className="text-xs text-muted">{c.customerId ? '· cliente' : '· prospect'}</span></button></li>)}</ul>}
        <AbmFields f={f} set={setF} idp="ae" />
      </div>
    </Modal>
  );
}

type Detail = Account & { document: string | null; facts: { activeContracts: number; endedContracts: number; openOpportunities: number; daysSinceInteraction: number | null }; opportunities: { id: string; code: number; title: string; stage: string; valueCents: number | null; ownerName: string }[]; events: { id: string; type: string; createdAt: string; actorName: string | null; payload: Record<string, unknown> }[] };
export function AccountDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const q = useQuery({ queryKey: ['abm', 'one', id], enabled: !!id, queryFn: () => api<Detail>(`/abm/${id}`) });
  const [f, setF] = useState<Partial<Account> & { statusReason?: string } | null>(null);
  const a = q.data;
  const cur = { ...a, ...f } as Account & { statusReason?: string };
  const tErr = a && f?.status && f.status !== a.status ? abmTransition(a.status, f.status, f.statusReason) : null;
  const m = useMutation({
    mutationFn: () => api(`/abm/${id}`, { method: 'PATCH', body: { rowVersion: a!.rowVersion, ...f } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['abm'] }); setF(null); toast({ tone: 'success', message: 'Conta atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ev = (e: Detail['events'][number]) => e.type === 'criada' ? (e.payload.origin === 'nova_conta' ? 'cadastrou a conta e incluiu no ABM' : 'incluiu a conta no ABM') : e.type === 'situacao' ? `mudou o status para ${ABM_STATUS_LABELS[(e.payload.to as Record<string, string>)?.status as AbmStatus] ?? ''}${e.payload.reason ? `: ${String(e.payload.reason)}` : ''}` : 'atualizou';
  return (
    <Drawer open={!!id} onClose={() => { setF(null); onClose(); }} title="Conta ABM" width="lg">
      {!a ? <LoadingRows rows={5} /> : (
        <div className="space-y-5">
          <div>
            <h3 className="text-lg font-bold text-ink">{a.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2"><StatusChip s={a.status} /><CommercialChip s={a.commercial} /><PriorityChip p={a.priority} /></div>
            <p className="mt-1 text-xs text-muted">{a.nature ? NATURE[a.nature] : 'Natureza não informada'} · {a.segment}{a.city && ` · ${a.city}`}{a.document && ` · ${a.document}`}{a.origin && ` · origem: ${ABM_ORIGIN_LABELS[a.origin]}`}</p>
            <p className="mt-1 text-xs text-muted">Status comercial calculado pelos dados: <span className="num">{a.facts.activeContracts}</span> contrato(s) ativo(s), <span className="num">{a.facts.openOpportunities}</span> oportunidade(s) aberta(s), último contato {a.facts.daysSinceInteraction === null ? 'nunca' : `há ${a.facts.daysSinceInteraction} dia(s)`}.</p>
            <span className="flex flex-wrap gap-3"><Link to={`/abm/contas/${a.id}`} className="text-sm font-semibold text-primary hover:underline">Abrir Conta 360</Link><Link to={`/customers/${a.contactId}`} className="text-sm font-semibold text-primary hover:underline">Abrir a conta no CRM</Link></span>
          </div>
          {a.statusReason && (a.status === 'pausada' || a.status === 'encerrada') && <Notice tone="info">{a.status === 'pausada' ? 'Pausada' : 'Encerrada'}: {a.statusReason}</Notice>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Status ABM" htmlFor="ad-s"><Select id="ad-s" value={cur.status} onChange={(e) => setF({ ...f, status: e.target.value as AbmStatus })}>{(Object.keys(ABM_STATUS_LABELS) as AbmStatus[]).map((s) => <option key={s} value={s} disabled={s !== a.status && !!abmTransition(a.status, s, 'x'.repeat(20))}>{ABM_STATUS_LABELS[s]}</option>)}</Select></FormField>
            <FormField label="Prioridade" htmlFor="ad-p"><Select id="ad-p" value={cur.priority} onChange={(e) => setF({ ...f, priority: e.target.value as AbmPriority })}>{(Object.keys(ABM_PRIORITY_LABELS) as AbmPriority[]).map((p) => <option key={p} value={p}>{ABM_PRIORITY_LABELS[p]}</option>)}</Select></FormField>
            <FormField label="Responsável" htmlFor="ad-o"><Select id="ad-o" value={cur.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
          </div>
          {f?.status && f.status !== a.status && (f.status === 'pausada' || f.status === 'encerrada') && <FormField label={f.status === 'pausada' ? 'Por que pausar' : 'Por que encerrar'} htmlFor="ad-why" required><Input id="ad-why" value={f.statusReason ?? ''} onChange={(e) => setF({ ...f, statusReason: e.target.value })} /></FormField>}
          <FormField label="Objetivo principal" htmlFor="ad-obj"><Input id="ad-obj" value={cur.objective ?? ''} onChange={(e) => setF({ ...f, objective: e.target.value || null })} /></FormField>
          <FormField label="Motivo da seleção" htmlFor="ad-r"><Textarea id="ad-r" rows={2} value={cur.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <FormField label="Próximo passo" htmlFor="ad-n"><Input id="ad-n" value={cur.nextStep ?? ''} onChange={(e) => setF({ ...f, nextStep: e.target.value || null })} /></FormField>
            <FormField label="Até" htmlFor="ad-d"><Input id="ad-d" type="date" value={cur.nextStepOn ?? ''} onChange={(e) => setF({ ...f, nextStepOn: e.target.value || null })} /></FormField>
          </div>
          {f && <div className="flex items-center gap-3"><Button variant="primary" disabled={!!tErr} loading={m.isPending} onClick={() => m.mutate()}>Salvar alterações</Button>{tErr && <span className="text-sm text-danger">{tErr}</span>}</div>}
          <section>
            <h4 className="mb-1 font-bold text-ink">Oportunidades</h4>
            {!a.opportunities.length ? <p className="text-sm text-muted">Nenhuma oportunidade com esta conta.</p> : <ul className="divide-y divide-line">{a.opportunities.map((o) => <li key={o.id} className="flex items-center gap-2 py-2 text-sm"><Link to={`/opportunities/${o.id}`} className="min-w-0 flex-1 truncate font-semibold text-primary hover:underline">OP-{o.code} · {o.title}</Link><span className="text-xs text-muted">{o.stage} · {o.ownerName}</span>{o.valueCents !== null && <span className="num text-xs">{fmtBRL(o.valueCents)}</span>}</li>)}</ul>}
          </section>
          <WorkLinks prefill={{ contactId: a.contactId, label: a.name }} />
          <section>
            <h4 className="mb-1 font-bold text-ink">Histórico</h4>
            <ol className="space-y-1 text-sm">{a.events.map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · {e.actorName}: {ev(e)}</li>)}</ol>
          </section>
        </div>
      )}
    </Drawer>
  );
}
