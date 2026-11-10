/** Página da comunidade: capa, participação, publicações (com fixadas), membros e papéis, pedidos, convites e regras. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Archive, ArrowLeft, Lock, Pencil, UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import { Avatar, Button, Chip, EmptyState, ErrorState, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { ConfirmDialog, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { orgLine, usePeopleMe, type PersonCard } from './shared';
import type { Community } from './feed/api';
import { Feed } from './feed/Feed';
import { PostEditor, usePeoplePeople } from './feed/PostEditor';
import { CommunityCover, KindIcon, useJoin } from './Communities';
import { CommunityForm } from './CommunityForm';

type Detail = Community & { staff: (PersonCard & { role: string })[]; pendingRequests: number };
type Member = PersonCard & { role: 'responsavel' | 'moderador' | 'membro'; joinedAt: string };
const ROLE_LABEL = { responsavel: 'Responsável', moderador: 'Moderador', membro: 'Membro' } as const;

export function CommunityPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['pessoas', 'comunidade', id], queryFn: () => api<Detail>(`/pessoas/comunidades/${id}`) });
  const [tab, setTab] = useState<'publicacoes' | 'membros' | 'pedidos' | 'sobre'>('publicacoes');
  const [editing, setEditing] = useState(false);
  const [archive, setArchive] = useState(false);
  const join = useJoin();
  const qc = useQueryClient();
  const toast = useToast();
  const arch = useMutation({
    mutationFn: (archived: boolean) => api(`/pessoas/comunidades/${id}/arquivo`, { method: 'POST', body: { archived } }),
    onSuccess: (_r, a) => { setArchive(false); void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: a ? 'Comunidade arquivada' : 'Comunidade reativada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const tabs = [['publicacoes', 'Publicações'], ['membros', `Membros (${c.memberCount})`], ...(c.perms.moderate ? [['pedidos', `Pedidos${c.pendingRequests ? ` (${c.pendingRequests})` : ''}`]] : []), ['sobre', 'Sobre']] as [typeof tab, string][];
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <Link to="/pessoas/comunidades" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Comunidades</Link>
      {editing ? <CommunityForm initial={c} canInstitutional={c.kind === 'institucional' || c.perms.manage} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} /> : (
        <section className="card overflow-hidden" aria-label={c.name}>
          <CommunityCover c={c} className="h-32 sm:h-40" />
          <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-bold tracking-wide text-ink">{c.name}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted"><span className="inline-flex items-center gap-1"><KindIcon kind={c.kind} />{c.kindLabel}</span>· {c.memberCount} {c.memberCount === 1 ? 'membro' : 'membros'}{c.category && <Chip>{c.category}</Chip>}{c.status === 'arquivada' && <Chip tone="neutral">Arquivada</Chip>}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.myRole ? <Button size="sm" onClick={() => join.mutate({ id: c.id, leave: true })} loading={join.isPending}>Sair</Button>
                  : c.pending?.kind === 'pedido' ? <Button size="sm" onClick={() => join.mutate({ id: c.id, leave: true })}>Cancelar pedido</Button>
                  : c.perms.join ? <Button size="sm" variant="primary" loading={join.isPending} onClick={() => join.mutate({ id: c.id })}>{c.pending?.kind === 'convite' ? 'Aceitar convite' : c.kind === 'privada' ? 'Pedir para participar' : 'Participar'}</Button> : null}
                {c.perms.manage && <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>}
                {c.perms.manage && <Button size="sm" icon={<Archive className="h-4 w-4" />} onClick={() => (c.status === 'ativa' ? setArchive(true) : arch.mutate(false))}>{c.status === 'ativa' ? 'Arquivar' : 'Reativar'}</Button>}
              </div>
            </div>
            {c.description && <p className="mt-3 text-sm text-text">{c.description}</p>}
          </div>
          <nav aria-label="Seções da comunidade" className="scroll-thin flex gap-5 overflow-x-auto border-t border-line px-5">
            {tabs.map(([k, l]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)} className={clsx('-mb-px whitespace-nowrap border-b-2 py-3 text-sm', tab === k ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}
          </nav>
        </section>
      )}

      {tab === 'publicacoes' && (!c.perms.read ? (
        <div className="card"><EmptyState title="Comunidade privada" description={c.pending?.kind === 'pedido' ? 'Seu pedido está com a moderação. Quando for aprovado, as publicações aparecem aqui.' : 'Só membros veem as publicações. Peça para participar.'} /></div>
      ) : (
        <div className="space-y-3">
          {c.status === 'arquivada' && <Notice tone="warning">Comunidade arquivada: as publicações continuam visíveis, mas não recebem novas publicações, comentários ou reações.</Notice>}
          {c.perms.post ? <PostEditor compact communityId={c.id} /> : c.myRole && c.kind === 'institucional' ? <Notice tone="info">Nesta comunidade institucional só responsável e moderadores publicam.</Notice> : null}
          <Feed filter={{ comunidade: c.id }} canPin={c.perms.moderate} emptyTitle="Nenhuma publicação ainda" emptyText={c.perms.post ? 'Comece a conversa: compartilhe algo com a comunidade.' : 'Quando houver publicações, elas aparecem aqui.'} />
        </div>
      ))}
      {tab === 'membros' && <Members c={c} />}
      {tab === 'pedidos' && c.perms.moderate && <Requests c={c} />}
      {tab === 'sobre' && (
        <section className="card space-y-4 p-5" aria-label="Sobre a comunidade">
          <div><h3 className="mb-1 text-md font-bold text-ink">Regras</h3>{c.rules ? <p className="whitespace-pre-wrap text-sm text-text">{c.rules}</p> : <p className="text-sm text-muted">Sem regras específicas. Valem as regras de convivência da empresa.</p>}</div>
          <div><h3 className="mb-2 text-md font-bold text-ink">Responsáveis e moderadores</h3>
            <ul className="space-y-2">{c.staff.map((p) => <li key={p.id} className="flex items-center gap-3"><Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={32} /><Link to={`/pessoas/perfil/${p.id}`} className="text-sm font-semibold text-ink hover:underline">{p.name}</Link><Chip tone={p.role === 'responsavel' ? 'blue' : 'neutral'}>{ROLE_LABEL[p.role as keyof typeof ROLE_LABEL]}</Chip></li>)}</ul>
          </div>
        </section>
      )}
      <ConfirmDialog open={archive} title="Arquivar comunidade" confirmLabel="Arquivar" loading={arch.isPending} onCancel={() => setArchive(false)} onConfirm={() => arch.mutate(true)}>
        <p>A comunidade sai da lista e fica só para leitura: sem novas publicações, comentários ou reações. Dá para reativar depois.</p>
      </ConfirmDialog>
    </div>
  );
}

function Members({ c }: { c: Detail }) {
  const me = usePeopleMe().data;
  const q = useQuery({ queryKey: ['pessoas', 'comunidade', c.id, 'membros'], queryFn: () => api<{ items: Member[] }>(`/pessoas/comunidades/${c.id}/membros`), enabled: c.perms.read || c.perms.manage });
  const qc = useQueryClient();
  const toast = useToast();
  const done = (msg: string) => { void qc.invalidateQueries({ queryKey: ['pessoas', 'comunidade', c.id] }); toast({ tone: 'success', message: msg }); };
  const role = useMutation({ mutationFn: ({ userId, r }: { userId: string; r: string }) => api(`/pessoas/comunidades/${c.id}/membros/${userId}`, { method: 'PATCH', body: { role: r } }), onSuccess: () => done('Papel atualizado'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const remove = useMutation({ mutationFn: (userId: string) => api(`/pessoas/comunidades/${c.id}/membros/${userId}`, { method: 'DELETE' }), onSuccess: () => done('Membro removido'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (!c.perms.read && !c.perms.manage) return <div className="card"><EmptyState title="Comunidade privada" description="Só membros veem quem participa." /></div>;
  return (
    <section className="card p-4" aria-label="Membros">
      {c.perms.moderate && <Invite c={c} />}
      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} /> : (
        <ul className="divide-y divide-line">{q.data!.items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Avatar name={m.name} userId={m.id} hasPhoto={m.hasPhoto} size={36} />
            <span className="min-w-0 flex-1"><Link to={`/pessoas/perfil/${m.id}`} className="block truncate text-sm font-semibold text-ink hover:underline">{m.name}</Link><span className="block truncate text-xs text-muted">{orgLine(m) || 'Colaborador'}</span></span>
            {c.perms.manage && m.id !== me?.me.id ? (
              <Select aria-label={`Papel de ${m.name}`} className="h-8 w-auto text-sm" value={m.role} onChange={(e) => role.mutate({ userId: m.id, r: e.target.value })}>
                {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            ) : <Chip tone={m.role === 'responsavel' ? 'blue' : 'neutral'}>{ROLE_LABEL[m.role]}</Chip>}
            {((m.role === 'membro' && c.perms.moderate) || (m.role !== 'membro' && c.perms.manage)) && m.id !== me?.me.id && <Button size="sm" variant="ghost" onClick={() => remove.mutate(m.id)}>Remover</Button>}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function Invite({ c }: { c: Detail }) {
  const people = usePeoplePeople().data ?? [];
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const qc = useQueryClient();
  const toast = useToast();
  const send = useMutation({
    mutationFn: () => api<{ invited: number }>(`/pessoas/comunidades/${c.id}/convites`, { method: 'POST', body: { userIds: picked.map((p) => p.id) } }),
    onSuccess: (r) => { setPicked([]); setTerm(''); void qc.invalidateQueries({ queryKey: ['pessoas', 'comunidade', c.id] }); toast({ tone: 'success', message: r.invited ? `${r.invited} convite(s) enviado(s)` : 'Essas pessoas já participam ou já foram convidadas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const hits = term.trim().length >= 2 ? people.filter((p) => p.name.toLowerCase().includes(term.trim().toLowerCase()) && !picked.some((x) => x.id === p.id)).slice(0, 6) : [];
  return (
    <div className="mb-4 border-b border-line pb-4">
      <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink"><UserPlus className="h-4 w-4 text-primary" aria-hidden />Convidar colegas{c.kind === 'privada' && <span className="inline-flex items-center gap-1 text-xs font-normal text-muted"><Lock className="h-3 w-3" aria-hidden />entram quando aceitarem</span>}</p>
      <div className="flex flex-wrap items-center gap-2">
        {picked.map((p) => <Chip key={p.id}>{p.name} <button type="button" aria-label={`Tirar ${p.name}`} className="ml-1" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>×</button></Chip>)}
        <div className="relative min-w-[200px] flex-1">
          <Input aria-label="Buscar colega para convidar" className="h-9" placeholder="Nome do colega" value={term} onChange={(e) => setTerm(e.target.value)} />
          {hits.length > 0 && <ul className="absolute z-20 mt-1 w-full border border-line bg-surface shadow-overlay">{hits.map((p) => <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setPicked([...picked, { id: p.id, name: p.name }]); setTerm(''); }}>{p.name}{p.jobTitle ? <span className="text-muted"> · {p.jobTitle}</span> : null}</button></li>)}</ul>}
        </div>
        <Button size="sm" variant="primary" disabled={!picked.length} loading={send.isPending} onClick={() => send.mutate()}>Convidar</Button>
      </div>
    </div>
  );
}

function Requests({ c }: { c: Detail }) {
  const q = useQuery({ queryKey: ['pessoas', 'comunidade', c.id, 'pedidos'], queryFn: () => api<{ items: { id: string; kind: string; message: string | null; createdAt: string; person: PersonCard }[] }>(`/pessoas/comunidades/${c.id}/pedidos`) });
  const qc = useQueryClient();
  const toast = useToast();
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api(`/pessoas/comunidades-pedidos/${id}/decisao`, { method: 'POST', body: { approve } }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: ['pessoas', 'comunidade', c.id] }); toast({ tone: 'success', message: v.approve ? 'Participação aprovada' : 'Pedido recusado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const items = q.data?.items ?? [];
  return (
    <section className="card p-4" aria-label="Pedidos e convites pendentes">
      {q.isLoading ? <LoadingRows rows={3} /> : !items.length ? <EmptyState title="Nenhum pedido pendente" description="Pedidos de participação aparecem aqui para aprovar ou recusar." /> : (
        <ul className="divide-y divide-line">{items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Avatar name={r.person.name} userId={r.person.id} hasPhoto={r.person.hasPhoto} size={36} />
            <span className="min-w-0 flex-1 text-sm"><span className="font-semibold text-ink">{r.person.name}</span>{r.kind === 'convite' ? <span className="text-muted"> · convidado, aguardando resposta</span> : r.message ? <span className="block text-muted">“{r.message}”</span> : null}</span>
            {r.kind === 'pedido' && <><Button size="sm" variant="primary" onClick={() => decide.mutate({ id: r.id, approve: true })}>Aprovar</Button><Button size="sm" onClick={() => decide.mutate({ id: r.id, approve: false })}>Recusar</Button></>}
          </li>
        ))}</ul>
      )}
    </section>
  );
}
