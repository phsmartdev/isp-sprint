/** Contatos da oportunidade: várias pessoas, cada uma com o papel nesta negociação. Não depende do ABM e não duplica pessoas. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Phone, Plus, UsersRound, X } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Button, FormField, Input, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Item = { id: string; stakeholderId: string; role: string; roleLabel: string; name: string; email: string | null; phone: string | null; title: string | null; rowVersion: number };
type Data = { roles: { key: string; label: string }[]; items: Item[]; available: { stakeholderId: string; name: string; title: string | null; email: string | null }[] };
type Hit = { id: string; name: string; email: string | null; phone: string | null; accounts: { account: string; title: string | null }[] };

export function OpportunityContacts({ oppId, editable }: { oppId: string; editable: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['opp-contacts', oppId], queryFn: () => api<Data>(`/opportunities/${oppId}/contacts`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['opp-contacts', oppId] }); void qc.invalidateQueries({ queryKey: ['timeline', oppId] }); };
  const [adding, setAdding] = useState(false);
  const setRole = useMutation({
    mutationFn: ({ it, role }: { it: Item; role: string }) => api(`/opportunities/${oppId}/contacts/${it.id}`, { method: 'PATCH', body: { rowVersion: it.rowVersion, role } }),
    onSuccess: refresh, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const remove = useMutation({
    mutationFn: (it: Item) => api(`/opportunities/${oppId}/contacts/${it.id}/remove`, { method: 'POST' }),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Contato retirado da oportunidade' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const items = q.data?.items ?? [];
  return (
    <section className="card p-5" aria-label="Contatos">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-md font-bold text-ink"><UsersRound className="h-5 w-5 text-primary" aria-hidden />Contatos</h2>
        {editable && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Adicionar</Button>}
      </div>
      {!items.length ? <p className="text-sm text-muted">{q.isLoading ? 'Carregando…' : 'Nenhum contato nesta oportunidade. Adicione quem participa da negociação.'}</p> : (
        <ul className="divide-y divide-line">
          {items.map((it) => (
            <li key={it.id} className="py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{it.name}</p>
                  {it.title && <p className="text-xs text-muted">{it.title}</p>}
                  {it.phone && <p className="num flex items-center gap-1.5 text-xs text-text"><Phone className="h-3.5 w-3.5 text-success" aria-hidden />{it.phone}</p>}
                  {it.email && <p className="flex items-center gap-1.5 break-all text-xs text-text"><Mail className="h-3.5 w-3.5 text-primary" aria-hidden />{it.email}</p>}
                </div>
                {editable && <button type="button" className="rounded-sm p-1 text-muted hover:bg-surface-2 hover:text-danger" aria-label={`Retirar ${it.name} dos contatos`} onClick={() => remove.mutate(it)}><X className="h-4 w-4" /></button>}
              </div>
              <Select aria-label={`Papel de ${it.name}`} className="mt-1.5 h-8 text-sm" value={it.role} disabled={!editable || setRole.isPending} onChange={(e) => setRole.mutate({ it, role: e.target.value })}>
                {(q.data?.roles ?? []).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </Select>
            </li>
          ))}
        </ul>
      )}
      <AddContactDialog open={adding} onClose={() => setAdding(false)} oppId={oppId} data={q.data} onDone={refresh} />
    </section>
  );
}

function AddContactDialog({ open, onClose, oppId, data, onDone }: { open: boolean; onClose: () => void; oppId: string; data: Data | undefined; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'conta' | 'novo'>('conta');
  const [stakeholderId, setStakeholderId] = useState('');
  const [search, setSearch] = useState('');
  const [personId, setPersonId] = useState<Hit | null>(null);
  const [f, setF] = useState({ name: '', title: '', email: '', phone: '' });
  const [role, setRole] = useState('');
  const dq = useDebounced(search.trim(), 250);
  const hits = useQuery({ queryKey: ['people-search', dq], enabled: open && mode === 'novo' && dq.length >= 2, queryFn: () => api<{ items: Hit[] }>(`/people/search${qs({ q: dq })}`) });
  const reset = () => { setStakeholderId(''); setSearch(''); setPersonId(null); setF({ name: '', title: '', email: '', phone: '' }); setRole(''); };
  const add = useMutation({
    mutationFn: () => api(`/opportunities/${oppId}/contacts`, {
      method: 'POST',
      body: {
        ...(mode === 'conta' ? { stakeholderId } : personId ? { personId: personId.id, title: f.title || null } : { person: { name: f.name, email: f.email || null, phone: f.phone || null }, title: f.title || null }),
        ...(role ? { role } : {}),
      },
    }),
    onSuccess: () => { onDone(); toast({ tone: 'success', message: 'Contato adicionado' }); reset(); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const available = data?.available ?? [];
  const effMode = available.length ? mode : 'novo';
  const ok = effMode === 'conta' ? !!stakeholderId : !!personId || f.name.trim().length >= 2;
  return (
    <Modal open={open} onClose={onClose} title="Adicionar contato"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={add.isPending} onClick={() => { if (effMode !== mode) setMode(effMode); add.mutate(); }}>Adicionar contato</Button></>}>
      <div className="space-y-4">
        {available.length > 0 && (
          <div role="radiogroup" aria-label="Origem do contato" className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={mode === 'conta'} onChange={() => setMode('conta')} />Pessoa da conta</label>
            <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={mode === 'novo'} onChange={() => setMode('novo')} />Outra pessoa</label>
          </div>
        )}
        {effMode === 'conta' ? (
          <FormField label="Pessoa da conta" htmlFor="oc-st" required>
            <Select id="oc-st" value={stakeholderId} onChange={(e) => setStakeholderId(e.target.value)}>
              <option value="">Escolha…</option>
              {available.map((a) => <option key={a.stakeholderId} value={a.stakeholderId}>{a.name}{a.title ? ` · ${a.title}` : ''}</option>)}
            </Select>
          </FormField>
        ) : personId ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 p-3 text-sm">
            <span><span className="font-semibold text-ink">{personId.name}</span>{personId.email ? ` · ${personId.email}` : ''}</span>
            <Button size="sm" variant="secondary" onClick={() => setPersonId(null)}>Trocar</Button>
          </div>
        ) : (
          <>
            <FormField label="Buscar pessoa já cadastrada" htmlFor="oc-q" hint="Evita duplicar: digite nome ou e-mail. Se não achar, preencha abaixo.">
              <Input id="oc-q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou e-mail" />
            </FormField>
            {!!hits.data?.items.length && (
              <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-md border border-line text-sm" aria-label="Pessoas encontradas">
                {hits.data.items.map((h) => (
                  <li key={h.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => setPersonId(h)}><span className="font-semibold text-ink">{h.name}</span>{h.email ? ` · ${h.email}` : ''}{h.accounts.length ? <span className="block text-xs text-muted">{h.accounts.map((a) => a.account).join(', ')}</span> : null}</button></li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Nome" htmlFor="oc-name" required><Input id="oc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
              <FormField label="Cargo" htmlFor="oc-title"><Input id="oc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
              <FormField label="Telefone" htmlFor="oc-phone"><Input id="oc-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormField>
              <FormField label="E-mail" htmlFor="oc-email"><Input id="oc-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormField>
            </div>
          </>
        )}
        <FormField label="Papel nesta negociação" htmlFor="oc-role" hint="Em branco: o primeiro contato vira o principal">
          <Select id="oc-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Automático</option>
            {(data?.roles ?? []).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Select>
        </FormField>
      </div>
    </Modal>
  );
}
