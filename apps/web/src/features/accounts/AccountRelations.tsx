/**
 * Contas relacionadas: relações registradas (matriz/filial, órgão superior/vinculado, consórcio, parceria, fornecimento,
 * concorrência, influência), sugestões (mesma raiz de CNPJ e pessoas em comum) e o mapa visual do grupo.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, Lightbulb, Plus, Trash2 } from 'lucide-react';
import { ACCOUNT_RELATION_LABELS, hierarchyTree, type AccountRelationKind } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

export type NetNode = { contactId: string; name: string; visible: boolean; segment: string | null; city: string | null; abmId: string | null; inAbm?: boolean };
export type NetEdge = { id: string; fromId: string; toId: string; kind: AccountRelationKind };
type Item = { id: string; kind: AccountRelationKind; direction: 'saida' | 'entrada'; label: string; group: string; other: NetNode; notes: string | null; createdByName: string | null; createdAt: string };
type Data = { account: { contactId: string; name: string }; items: Item[]; network: { nodes: NetNode[]; edges: NetEdge[] }; suggestions: { contactId: string; name: string; reasons: string[]; kind: AccountRelationKind }[] };

export const accountPath = (n: Pick<NetNode, 'contactId' | 'abmId'>, prefer: 'crm' | 'abm' = 'crm') => (prefer === 'abm' && n.abmId ? `/abm/contas/${n.abmId}?t=relacoes` : `/customers/${n.contactId}?t=relacoes`);
const KIND_TONE: Record<AccountRelationKind, string> = { matriz: 'border-primary', orgao_superior: 'border-primary', membro: 'border-sky', parceira: 'border-success', fornecedora: 'border-[#C2610C]', concorrente: 'border-danger', influencia: 'border-warning', outro: 'border-line-strong' };

function AccNode({ n, focus, prefer }: { n: NetNode; focus?: boolean; prefer: 'crm' | 'abm' }) {
  const body = (
    <>
      <span className="flex items-center gap-1 truncate text-sm font-bold text-ink" title={n.name}><Building2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />{n.name}</span>
      <span className="block truncate text-2xs text-muted">{[n.segment, n.city].filter(Boolean).join(' · ') || '—'}{n.abmId ? ' · ABM' : ''}</span>
    </>
  );
  const cls = clsx('block w-[190px] border-2 bg-surface p-2 text-left shadow-card', focus ? 'border-primary bg-primary/5' : 'border-line-strong', n.visible && 'hover:bg-surface-2');
  return n.visible && !focus ? <Link to={accountPath(n, prefer)} className={cls}>{body}</Link> : <div className={cls} aria-current={focus ? 'true' : undefined}>{body}</div>;
}

/** Mapa do grupo: hierarquia (matriz/órgão superior) como árvore; as demais relações como ligações rotuladas. */
export function RelationMap({ nodes, edges, focusId, prefer = 'crm' }: { nodes: NetNode[]; edges: NetEdge[]; focusId?: string; prefer?: 'crm' | 'abm' }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.contactId, n])), [nodes]);
  const tree = useMemo(() => hierarchyTree(nodes.map((n) => n.contactId), edges), [nodes, edges]);
  const others = edges.filter((e) => !ACCOUNT_RELATION_LABELS[e.kind].hierarchy);
  const loose = nodes.filter((n) => !tree.inTree.has(n.contactId));
  const Branch = ({ id, kind }: { id: string; kind?: AccountRelationKind }) => (
    <li>
      {kind && <span className="mb-1 bg-surface-2 px-1 text-2xs text-muted">{ACCOUNT_RELATION_LABELS[kind].in}</span>}
      <AccNode n={byId.get(id)!} focus={id === focusId} prefer={prefer} />
      {!!tree.children.get(id)?.length && <ul>{tree.children.get(id)!.map((c) => <Branch key={c.id} id={c.id} kind={c.kind} />)}</ul>}
    </li>
  );
  return (
    <div className="space-y-3">
      {!!tree.roots.length && (
        <div className="orgchart scroll-thin overflow-x-auto border border-line bg-surface-2/40 p-4" role="tree" aria-label="Hierarquia entre as contas">
          <ul>{tree.roots.map((r) => <Branch key={r} id={r} />)}</ul>
        </div>
      )}
      {(!!others.length || (!!loose.length && !tree.roots.length)) && (
        <div className="border border-line p-3" aria-label="Outras relações entre as contas">
          {!tree.roots.length && loose.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{loose.map((n) => <AccNode key={n.contactId} n={n} focus={n.contactId === focusId} prefer={prefer} />)}</div>}
          {!!others.length && (
            <ul className="space-y-2">
              {others.map((e) => {
                const a = byId.get(e.fromId)!, b = byId.get(e.toId)!;
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={clsx('border-l-4 px-2 py-0.5 font-semibold', KIND_TONE[e.kind], a.contactId === focusId ? 'bg-primary/10 text-ink' : 'bg-surface-2')}>{a.name}</span>
                    <span className="text-xs text-muted">— {ACCOUNT_RELATION_LABELS[e.kind].out} →</span>
                    <span className={clsx('border-l-4 px-2 py-0.5 font-semibold', KIND_TONE[e.kind], b.contactId === focusId ? 'bg-primary/10 text-ink' : 'bg-surface-2')}>{b.name}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AddRelation({ contactId, preset, onClose }: { contactId: string; preset: { contactId: string; name: string; kind: AccountRelationKind } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const term = useDebounced(q, 250);
  const found = useQuery({ queryKey: ['contacts-search', term], enabled: term.trim().length >= 2, queryFn: () => api<{ items: { id: string; name: string; segment: string }[] }>(`/contacts?q=${encodeURIComponent(term)}`) });
  const [other, setOther] = useState<{ id: string; name: string } | null>(preset ? { id: preset.contactId, name: preset.name } : null);
  const [kind, setKind] = useState<AccountRelationKind>(preset?.kind ?? 'parceira');
  const [inverse, setInverse] = useState(false);
  const [notes, setNotes] = useState('');
  const L = ACCOUNT_RELATION_LABELS[kind];
  const m = useMutation({
    mutationFn: () => api(`/accounts/${contactId}/account-relations`, { method: 'POST', body: { otherContactId: other!.id, kind, inverse: !L.symmetric && inverse, notes: notes.trim() || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['account-relations'] }); toast({ tone: 'success', message: 'Relação registrada' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Relacionar com outra conta" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!other} loading={m.isPending} onClick={() => m.mutate()}>Registrar relação</Button></>}>
      <div className="space-y-4">
        {other ? <p className="bg-surface-2 px-3 py-2 text-sm">Outra conta: <b>{other.name}</b> {!preset && <button type="button" className="ml-2 text-primary hover:underline" onClick={() => setOther(null)}>trocar</button>}</p> : (
          <>
            <FormField label="Procurar a outra conta" htmlFor="ar-q" hint="Nome, telefone ou e-mail (contas da sua carteira)"><Input id="ar-q" value={q} onChange={(e) => setQ(e.target.value)} /></FormField>
            {!!found.data?.items.length && <ul className="max-h-48 overflow-y-auto border border-line">{found.data.items.filter((c) => c.id !== contactId).map((c) => <li key={c.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setOther({ id: c.id, name: c.name })}>{c.name}<span className="text-xs text-muted"> · {c.segment}</span></button></li>)}</ul>}
          </>
        )}
        <FormField label="Tipo de relação" htmlFor="ar-k"><Select id="ar-k" value={kind} onChange={(e) => setKind(e.target.value as AccountRelationKind)}>{(Object.keys(ACCOUNT_RELATION_LABELS) as AccountRelationKind[]).map((k) => <option key={k} value={k}>{ACCOUNT_RELATION_LABELS[k].group} — {ACCOUNT_RELATION_LABELS[k].out}</option>)}</Select></FormField>
        {!L.symmetric && (
          <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Sentido</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!inverse} onChange={() => setInverse(false)} />Esta conta <b>{L.out}</b> {other?.name ?? 'a outra'}</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={inverse} onChange={() => setInverse(true)} />Esta conta <b>{L.in}</b> {other?.name ?? 'a outra'}</label>
          </fieldset>
        )}
        <FormField label="Observação" htmlFor="ar-n"><Textarea id="ar-n" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

export function AccountRelationsPanel({ contactId, prefer = 'crm' }: { contactId: string; prefer?: 'crm' | 'abm' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['account-relations', contactId], queryFn: () => api<Data>(`/accounts/${contactId}/account-relations`) });
  const [adding, setAdding] = useState<{ preset: Data['suggestions'][number] | null } | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [reason, setReason] = useState('');
  const rm = useMutation({
    mutationFn: () => api(`/account-relations/${removing!.id}/remove`, { method: 'POST', body: { reason } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['account-relations'] }); setRemoving(null); setReason(''); toast({ tone: 'success', message: 'Relação removida (fica no histórico)' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const groups = [...new Set(d.items.map((i) => i.group))];
  return (
    <section className="card space-y-4 p-4" aria-label="Contas relacionadas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-bold text-ink">Contas relacionadas</h3><p className="max-w-3xl text-sm text-muted">Grupo econômico, estrutura pública, consórcios, parcerias, fornecimento e concorrência. O sistema sugere quando acha relação; quem registra é você.</p></div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding({ preset: null })}>Relacionar conta</Button>
      </div>

      {!!d.suggestions.length && (
        <section className="border border-dashed border-warning/70 p-3" aria-label="Relações sugeridas">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink"><Lightbulb className="h-4 w-4 text-warning" aria-hidden />Possíveis relações</p>
          <ul className="space-y-1.5">{d.suggestions.map((s) => (
            <li key={s.contactId} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><b>{s.name}</b><span className="block text-xs text-muted">{s.reasons.join(' · ')}</span></span><Button size="sm" onClick={() => setAdding({ preset: s })}>Relacionar</Button></li>
          ))}</ul>
        </section>
      )}

      {!d.items.length ? <EmptyState title="Nenhuma conta relacionada" description="Registre se esta conta é matriz ou filial, órgão superior ou vinculado, membro de consórcio, parceira, fornecedora ou concorrente de outra." /> : (
        <>
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g}><h4 className="mb-1 text-xs font-semibold text-muted">{g}</h4>
                <ul className="divide-y divide-line border border-line">{d.items.filter((i) => i.group === g).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0">Esta conta <b>{i.label}</b> {i.other.visible ? <Link to={accountPath(i.other, prefer)} className="font-semibold text-primary hover:underline">{i.other.name}</Link> : <span className="text-muted">{i.other.name}</span>}
                      {i.notes && <span className="block text-xs text-muted">{i.notes}</span>}<span className="block text-2xs text-muted">{i.createdByName ?? '—'} · {fmtDate(i.createdAt)}</span></span>
                    <Button size="sm" icon={<Trash2 className="h-4 w-4" />} aria-label={`Remover relação com ${i.other.name}`} onClick={() => setRemoving(i)} />
                  </li>
                ))}</ul>
              </div>
            ))}
          </div>
          <div><h4 className="mb-2 text-sm font-bold text-ink">Mapa do grupo <Chip>{d.network.nodes.length} contas</Chip></h4><RelationMap nodes={d.network.nodes} edges={d.network.edges} focusId={contactId} prefer={prefer} /></div>
        </>
      )}

      {adding && <AddRelation contactId={contactId} preset={adding.preset} onClose={() => setAdding(null)} />}
      {removing && (
        <Modal open onClose={() => setRemoving(null)} title="Remover relação" footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={rm.isPending} onClick={() => rm.mutate()}>Remover</Button></>}>
          <p className="mb-3 text-sm">Esta conta {removing.label} <b>{removing.other.name}</b>. A relação sai do mapa e fica no histórico.</p>
          <FormField label="Motivo" htmlFor="ar-r" required><Input id="ar-r" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
        </Modal>
      )}
    </section>
  );
}

/** ABM → Relações: todos os grupos de contas relacionadas do programa. */
export function AbmRelationsMap() {
  const q = useQuery({ queryKey: ['account-relations', 'abm'], queryFn: () => api<{ groups: { nodes: NetNode[]; edges: NetEdge[] }[]; withoutRelations: number }>('/abm/account-relations') });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{d.groups.length} grupo(s) de contas relacionadas · {d.withoutRelations} conta(s) do ABM sem relação registrada. Para relacionar, abra a conta e use "Contas relacionadas".</p>
      {!d.groups.length ? <EmptyState title="Nenhuma relação entre contas" description="Abra uma conta do ABM e registre se ela é matriz, filial, órgão superior, vinculada, membro de consórcio, parceira, fornecedora ou concorrente de outra." /> : d.groups.map((g, k) => (
        <section key={k} className="card p-4" aria-label={`Grupo ${k + 1}`}>
          <h3 className="mb-2 text-sm font-bold text-ink">{g.nodes.filter((n) => n.inAbm).map((n) => n.name).slice(0, 3).join(', ')}{g.nodes.length > 3 ? ` e mais ${g.nodes.length - 3}` : ''}</h3>
          <RelationMap nodes={g.nodes} edges={g.edges} prefer="abm" />
        </section>
      ))}
    </div>
  );
}
