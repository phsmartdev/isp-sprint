/**
 * Estruturas: a macro entidade (programa, projeto, rede, consórcio, convênio, grupo) que reúne contas e contratos.
 * Configurações → Modelos → Estruturas cria e mantém; na conta, "Contas relacionadas" vincula a uma estrutura existente.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Plus, Trash2 } from 'lucide-react';
import { STRUCTURE_KIND_LABELS, STRUCTURE_ROLE_LABELS, type StructureKind, type StructureRole } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useDebounced, useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Member = { id: string; structureId: string; contactId: string; role: StructureRole; roleLabel: string; notes: string | null; name: string; visible: boolean; segment: string | null; city: string | null; abmId: string | null };
type Ctr = { linkId: string; structureId: string; id: string; code: number; stage: string; contactId: string; clientName: string; number: string | null; object: string | null; endAt: string | null; monthlyCents: number | null; notes: string | null };
type ListItem = { id: string; name: string; kind: StructureKind; kindLabel: string; description: string | null; ownerId: string | null; ownerName: string | null; active: boolean; accounts: number; contracts: number; monthlyCents: number; rowVersion: number };
type Detail = ListItem & { canManage: boolean; seesContracts: boolean; members: Member[]; contracts: Ctr[]; hiddenContracts: number; suggestedContracts: { id: string; code: number; clientName: string; number: string | null; object: string | null; monthlyCents: number | null }[] };

const accLink = (m: Pick<Member, 'contactId' | 'abmId'>) => `/customers/${m.contactId}?t=relacoes`;
const ctrLabel = (c: { code: number; number: string | null }) => `CT-${c.code}${c.number ? ` · ${c.number}` : ''}`;

function RemoveDialog({ title, text, url, onClose }: { title: string; text: string; url: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(url, { method: 'POST', body: { reason } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['structures'] }); toast({ tone: 'success', message: 'Vínculo removido (fica no histórico)' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Desvincular</Button></>}>
      <p className="mb-3 text-sm">{text}</p>
      <FormField label="Motivo" htmlFor="st-rm" required><Input id="st-rm" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
    </Modal>
  );
}

function StructureForm({ initial, onClose }: { initial: ListItem | null; onClose: (id?: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useLookups().data?.users ?? [];
  const [f, setF] = useState({ name: initial?.name ?? '', kind: (initial?.kind ?? 'programa') as StructureKind, description: initial?.description ?? '', ownerId: initial?.ownerId ?? '', active: initial?.active ?? true });
  const m = useMutation({
    mutationFn: () => initial
      ? api<{ rowVersion: number }>(`/structures/${initial.id}`, { method: 'PATCH', body: { name: f.name, kind: f.kind, description: f.description || null, ownerId: f.ownerId || null, active: f.active, rowVersion: initial.rowVersion } }).then(() => ({ id: initial.id }))
      : api<{ id: string }>('/structures', { method: 'POST', body: { name: f.name, kind: f.kind, description: f.description || null, ownerId: f.ownerId || null } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['structures'] }); toast({ tone: 'success', message: initial ? 'Estrutura salva' : 'Estrutura criada' }); onClose(r.id); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={() => onClose()} title={initial ? 'Editar estrutura' : 'Nova estrutura'} footer={<><Button variant="secondary" onClick={() => onClose()}>Cancelar</Button><Button variant="primary" disabled={f.name.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>{initial ? 'Salvar' : 'Criar estrutura'}</Button></>}>
      <div className="space-y-3">
        <FormField label="Nome" htmlFor="st-n" hint="Ex.: o nome do programa, da rede ou do projeto"><Input id="st-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Tipo" htmlFor="st-k"><Select id="st-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as StructureKind })}>{(Object.keys(STRUCTURE_KIND_LABELS) as StructureKind[]).map((k) => <option key={k} value={k}>{STRUCTURE_KIND_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Responsável" htmlFor="st-o"><Select id="st-o" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">Ninguém</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        </div>
        <FormField label="Descrição" htmlFor="st-d"><Textarea id="st-d" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormField>
        {initial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Estrutura ativa (desativada não recebe novos vínculos)</label>}
      </div>
    </Modal>
  );
}

function LinkAccount({ structureId, roles, onDone }: { structureId: string; roles: [StructureRole, string][]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const term = useDebounced(q, 250);
  const found = useQuery({ queryKey: ['contacts-search', term], enabled: term.trim().length >= 2, queryFn: () => api<{ items: { id: string; name: string; segment: string }[] }>(`/contacts?q=${encodeURIComponent(term)}`) });
  const [role, setRole] = useState<StructureRole>('participante');
  const m = useMutation({
    mutationFn: (contactId: string) => api(`/structures/${structureId}/members`, { method: 'POST', body: { contactId, role } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['structures'] }); setQ(''); toast({ tone: 'success', message: 'Conta vinculada' }); onDone(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-2 bg-surface-2 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
        <FormField label="Procurar conta" htmlFor="st-acc"><Input id="st-acc" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, telefone ou e-mail" /></FormField>
        <FormField label="Papel na estrutura" htmlFor="st-role"><Select id="st-role" value={role} onChange={(e) => setRole(e.target.value as StructureRole)}>{roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
      </div>
      {!!found.data?.items.length && <ul className="max-h-44 overflow-y-auto border border-line bg-surface">{found.data.items.map((c) => <li key={c.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => m.mutate(c.id)}>{c.name}<span className="text-xs text-muted"> · {c.segment}</span></button></li>)}</ul>}
    </div>
  );
}

function LinkContract({ structureId, onDone }: { structureId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const term = useDebounced(q, 250);
  const found = useQuery({ queryKey: ['contracts-search', term], enabled: term.trim().length >= 2, queryFn: () => api<{ items: { id: string; code: number; number: string | null; clientName: string; object: string | null }[] }>(`/contracts?q=${encodeURIComponent(term)}&pageSize=10`) });
  const m = useMutation({
    mutationFn: (contractId: string) => api(`/structures/${structureId}/contracts`, { method: 'POST', body: { contractId } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['structures'] }); setQ(''); toast({ tone: 'success', message: 'Contrato vinculado' }); onDone(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-2 bg-surface-2 p-3">
      <FormField label="Procurar contrato" htmlFor="st-ct" hint="Número, CT, cliente ou objeto"><Input id="st-ct" value={q} onChange={(e) => setQ(e.target.value)} /></FormField>
      {!!found.data?.items.length && <ul className="max-h-44 overflow-y-auto border border-line bg-surface">{found.data.items.map((c) => <li key={c.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => m.mutate(c.id)}>{ctrLabel(c)} · {c.clientName}<span className="block text-xs text-muted">{c.object ?? ''}</span></button></li>)}</ul>}
    </div>
  );
}

export function StructureDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['structures', 'one', id], enabled: !!id, queryFn: () => api<Detail>(`/structures/${id}`) });
  const [adding, setAdding] = useState<'conta' | 'contrato' | null>(null);
  const [editing, setEditing] = useState(false);
  const [rm, setRm] = useState<{ title: string; text: string; url: string } | null>(null);
  const link = useMutation({
    mutationFn: (contractId: string) => api(`/structures/${id}/contracts`, { method: 'POST', body: { contractId } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['structures'] }); toast({ tone: 'success', message: 'Contrato vinculado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const d = q.data;
  const roles = Object.entries(STRUCTURE_ROLE_LABELS) as [StructureRole, string][];
  return (
    <Drawer open={!!id} onClose={onClose} title="Estrutura" width="lg">
      {!d ? <LoadingRows rows={6} /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="text-lg font-bold text-ink">{d.name}</h3><p className="text-sm text-muted">{d.kindLabel}{d.ownerName ? ` · responsável ${d.ownerName}` : ''}{!d.active && ' · desativada'}</p>{d.description && <p className="mt-1 max-w-prose text-sm">{d.description}</p>}</div>
            {d.canManage && <Button size="sm" onClick={() => setEditing(true)}>Editar</Button>}
          </div>
          <dl className="grid grid-cols-3 gap-2">
            {[['Contas', d.members.length], ['Contratos', d.contracts.length], ['Mensal dos contratos ativos', fmtBRL(d.monthlyCents)]].map(([l, v]) => <div key={String(l)} className="border-l-2 border-primary/60 bg-surface-2 px-3 py-2"><dt className="text-xs text-muted">{l}</dt><dd className="num text-lg font-bold text-ink">{v}</dd></div>)}
          </dl>

          <section aria-label="Contas da estrutura" className="space-y-2">
            <div className="flex items-center justify-between"><h4 className="font-bold text-ink">Contas</h4>{d.active && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(adding === 'conta' ? null : 'conta')}>Vincular conta</Button>}</div>
            {adding === 'conta' && <LinkAccount structureId={d.id} roles={roles} onDone={() => setAdding(null)} />}
            {!d.members.length ? <p className="text-sm text-muted">Nenhuma conta vinculada.</p> : (
              <ul className="divide-y divide-line border border-line">{d.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>{m.visible ? <Link to={accLink(m)} className="font-semibold text-primary hover:underline">{m.name}</Link> : <span className="text-muted">{m.name}</span>} <Chip tone={m.role === 'gestor' ? 'blue' : 'neutral'}>{m.roleLabel}</Chip><span className="block text-xs text-muted">{[m.segment, m.city].filter(Boolean).join(' · ')}</span></span>
                  {m.visible && <Button size="sm" icon={<Trash2 className="h-4 w-4" />} aria-label={`Desvincular ${m.name}`} onClick={() => setRm({ title: 'Desvincular conta', text: `${m.name} sai de ${d.name}.`, url: `/structure-members/${m.id}/remove` })} />}
                </li>
              ))}</ul>
            )}
          </section>

          <section aria-label="Contratos da estrutura" className="space-y-2">
            <div className="flex items-center justify-between"><h4 className="font-bold text-ink">Contratos</h4>{d.active && d.seesContracts && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(adding === 'contrato' ? null : 'contrato')}>Vincular contrato</Button>}</div>
            {!d.seesContracts && <Notice tone="info">Seu perfil não acessa contratos.</Notice>}
            {adding === 'contrato' && <LinkContract structureId={d.id} onDone={() => setAdding(null)} />}
            {!!d.suggestedContracts.length && d.active && (
              <div className="border border-dashed border-warning/70 p-2 text-sm" aria-label="Contratos das contas ainda fora da estrutura">
                <p className="mb-1 text-xs font-semibold text-muted">Contratos das contas desta estrutura ainda não vinculados</p>
                <ul className="space-y-1">{d.suggestedContracts.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2"><span>{ctrLabel(c)} · {c.clientName}<span className="block text-xs text-muted">{c.object ?? ''}{c.monthlyCents != null && ` · ${fmtBRL(c.monthlyCents)}/mês`}</span></span><Button size="sm" loading={link.isPending && link.variables === c.id} onClick={() => link.mutate(c.id)}>Vincular</Button></li>)}</ul>
              </div>
            )}
            {!d.contracts.length ? <p className="text-sm text-muted">Nenhum contrato vinculado.</p> : (
              <ul className="divide-y divide-line border border-line">{d.contracts.map((c) => (
                <li key={c.linkId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0"><Link to={`/contracts/${c.id}`} className="font-semibold text-primary hover:underline">{ctrLabel(c)}</Link> · {c.clientName}<span className="block text-xs text-muted">{c.object ?? ''}{c.monthlyCents != null && ` · ${fmtBRL(c.monthlyCents)}/mês`}{c.endAt && ` · até ${fmtDate(c.endAt)}`}{c.stage === 'arquivado' && ' · encerrado'}</span></span>
                  <Button size="sm" icon={<Trash2 className="h-4 w-4" />} aria-label={`Desvincular ${ctrLabel(c)}`} onClick={() => setRm({ title: 'Desvincular contrato', text: `${ctrLabel(c)} sai de ${d.name}.`, url: `/structure-contracts/${c.linkId}/remove` })} />
                </li>
              ))}</ul>
            )}
            {d.hiddenContracts > 0 && <p className="text-xs text-muted">+ {d.hiddenContracts} contrato(s) fora da sua carteira.</p>}
          </section>
          {editing && <StructureForm initial={d} onClose={() => setEditing(false)} />}
          {rm && <RemoveDialog {...rm} onClose={() => setRm(null)} />}
        </div>
      )}
    </Drawer>
  );
}

/** Configurações → Modelos → Estruturas. */
export function StructuresAdmin() {
  const q = useQuery({ queryKey: ['structures', 'list'], queryFn: () => api<{ items: ListItem[]; canManage: boolean }>('/structures?all=true') });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <section className="card overflow-hidden" aria-label="Estruturas">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div><h3 className="font-bold text-ink">Estruturas</h3><p className="max-w-3xl text-sm text-muted">A macro entidade que reúne várias contas e contratos: um programa, projeto, rede, consórcio ou convênio. Crie aqui; nas contas, vincule a uma estrutura existente.</p></div>
        {d.canManage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova estrutura</Button>}
      </div>
      {!d.items.length ? <div className="border-t border-line"><EmptyState title="Nenhuma estrutura" description="Crie a primeira (ex.: a rede ou o programa que reúne vários órgãos) e vincule as contas e os contratos dela." /></div> : (
        <div className="scroll-thin overflow-x-auto border-t border-line">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Estrutura', 'Tipo', 'Contas', 'Contratos', 'Mensal dos contratos', 'Responsável'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{d.items.map((s) => (
              <tr key={s.id} className={s.active ? 'border-t border-line' : 'border-t border-line opacity-60'}>
                <td className="px-4 py-2"><button type="button" className="inline-flex items-center gap-1.5 text-left font-semibold text-primary hover:underline" onClick={() => setOpen(s.id)}><Network className="h-4 w-4" aria-hidden />{s.name}</button>{!s.active && <span className="ml-2 text-xs text-muted">desativada</span>}</td>
                <td className="px-4 py-2">{s.kindLabel}</td>
                <td className="num px-4 py-2">{s.accounts}</td>
                <td className="num px-4 py-2">{s.contracts}</td>
                <td className="num px-4 py-2">{fmtBRL(s.monthlyCents)}</td>
                <td className="px-4 py-2">{s.ownerName ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && <StructureForm initial={null} onClose={(id) => { setCreating(false); if (id) setOpen(id); }} />}
      <StructureDrawer id={open} onClose={() => setOpen(null)} />
    </section>
  );
}

/** Na conta: estruturas a que pertence (com as outras contas e os contratos) e vincular a uma existente. */
export function AccountStructuresPanel({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['structures', 'account', contactId], queryFn: () => api<{ items: (ListItem & { me: Member | null; members: Member[]; contracts: Ctr[] })[]; available: { id: string; name: string; kindLabel: string }[] }>(`/accounts/${contactId}/structures`) });
  const [sel, setSel] = useState({ id: '', role: 'participante' as StructureRole });
  const [open, setOpen] = useState<string | null>(null);
  const [rm, setRm] = useState<{ title: string; text: string; url: string } | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/structures/${sel.id}/members`, { method: 'POST', body: { contactId, role: sel.role } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['structures'] }); setSel({ id: '', role: 'participante' }); toast({ tone: 'success', message: 'Conta vinculada à estrutura' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <section className="card space-y-3 p-4" aria-label="Estruturas da conta">
      <div><h3 className="font-bold text-ink">Estruturas</h3><p className="text-sm text-muted">Programas, projetos, redes ou consórcios de que esta conta faz parte, com as outras contas e os contratos de cada um.</p></div>
      {!d.items.length ? <p className="text-sm text-muted">A conta não está em nenhuma estrutura.</p> : (
        <ul className="space-y-3">{d.items.map((s) => (
          <li key={s.id} className="border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><button type="button" className="inline-flex items-center gap-1.5 font-bold text-primary hover:underline" onClick={() => setOpen(s.id)}><Network className="h-4 w-4" aria-hidden />{s.name}</button> <span className="text-xs text-muted">{s.kindLabel}</span>{s.me && <> · <Chip tone={s.me.role === 'gestor' ? 'blue' : 'neutral'}>{s.me.roleLabel}</Chip></>}</span>
              {s.me && <Button size="sm" icon={<Trash2 className="h-4 w-4" />} aria-label={`Sair de ${s.name}`} onClick={() => setRm({ title: 'Desvincular da estrutura', text: `Esta conta sai de ${s.name}.`, url: `/structure-members/${s.me!.id}/remove` })} />}
            </div>
            <p className="mt-1 text-xs text-muted">Contas: {s.members.filter((x) => x.contactId !== contactId).map((x) => `${x.name} (${x.roleLabel.toLowerCase()})`).join(', ') || 'só esta'}</p>
            <p className="text-xs text-muted">{s.contracts.length} contrato(s){s.contracts.length ? ` · ${fmtBRL(s.contracts.reduce((t, c) => t + (c.stage === 'arquivado' ? 0 : c.monthlyCents ?? 0), 0))}/mês` : ''}</p>
          </li>
        ))}</ul>
      )}
      {d.available.length ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <FormField label="Vincular a uma estrutura" htmlFor="as-s"><Select id="as-s" className="min-w-[240px]" value={sel.id} onChange={(e) => setSel({ ...sel, id: e.target.value })}><option value="">Escolha</option>{d.available.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kindLabel})</option>)}</Select></FormField>
          <FormField label="Papel" htmlFor="as-r"><Select id="as-r" value={sel.role} onChange={(e) => setSel({ ...sel, role: e.target.value as StructureRole })}>{(Object.keys(STRUCTURE_ROLE_LABELS) as StructureRole[]).map((k) => <option key={k} value={k}>{STRUCTURE_ROLE_LABELS[k]}</option>)}</Select></FormField>
          <Button variant="primary" disabled={!sel.id} loading={m.isPending} onClick={() => m.mutate()}>Vincular</Button>
        </div>
      ) : <p className="text-xs text-muted">Para criar uma estrutura, vá em Configurações → Modelos → Estruturas.</p>}
      <StructureDrawer id={open} onClose={() => setOpen(null)} />
      {rm && <RemoveDialog {...rm} onClose={() => setRm(null)} />}
    </section>
  );
}
