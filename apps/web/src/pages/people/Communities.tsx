/** Comunidades: convites recebidos, busca, categorias, todas/minhas/arquivadas e criação (para quem pode). */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Lock, Megaphone, Plus, Search, Users } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { Hexagons } from '../../components/brand';
import { errMsg } from '../../features/contracts/shared';
import { mediaUrl, type Community } from './feed/api';
import { CommunityForm } from './CommunityForm';

type List = { items: Community[]; categories: string[]; canCreate: boolean; canCreateInstitutional: boolean };
type Invite = { id: string; createdAt: string; community: { id: string; name: string; kind: string; kindLabel: string }; invitedBy: string | null };

export const KindIcon = ({ kind, className = 'h-3.5 w-3.5' }: { kind: string; className?: string }) => kind === 'privada' ? <Lock className={className} aria-hidden /> : kind === 'institucional' ? <Megaphone className={className} aria-hidden /> : <Users className={className} aria-hidden />;

export function useJoin() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, leave }: { id: string; leave?: boolean }) => api<{ status?: 'membro' | 'pendente' }>(`/pessoas/comunidades/${id}/${leave ? 'sair' : 'participar'}`, { method: 'POST', body: leave ? undefined : {} }),
    onSuccess: (r, v) => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: v.leave ? 'Você saiu da comunidade' : r.status === 'pendente' ? 'Pedido enviado à moderação' : 'Agora você participa da comunidade' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}

export function CommunityCover({ c, className }: { c: Pick<Community, 'coverMediaId' | 'name'>; className?: string }) {
  return (
    <div className={clsx('relative overflow-hidden bg-gradient-to-br from-navy to-primary', className)}>
      {c.coverMediaId ? <img src={mediaUrl(c.coverMediaId)} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Hexagons className="absolute inset-y-0 right-0 h-full w-[70%]" />}
    </div>
  );
}

export function CommunitiesPage() {
  const [tab, setTab] = useState<'todas' | 'minhas' | 'arquivadas'>('todas');
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState('');
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(term.trim(), 250);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['pessoas', 'comunidades', tab, dq, cat], placeholderData: (p) => p, queryFn: () => api<List>(`/pessoas/comunidades${qs({ q: dq || undefined, categoria: cat || undefined, minhas: tab === 'minhas' ? 1 : undefined, arquivadas: tab === 'arquivadas' ? 1 : undefined })}`) });
  const inv = useQuery({ queryKey: ['pessoas', 'comunidades', 'convites'], queryFn: () => api<{ items: Invite[] }>('/pessoas/comunidades-convites') });
  const join = useJoin();
  const answer = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api(`/pessoas/comunidades-pedidos/${id}/decisao`, { method: 'POST', body: { approve } }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: v.approve ? 'Convite aceito' : 'Convite recusado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-4">
      {!!inv.data?.items.length && (
        <section className="card border-l-4 border-l-lime p-4" aria-label="Convites para comunidades">
          <h2 className="mb-2 text-md font-bold text-ink">Convites para você</h2>
          <ul className="divide-y divide-line">{inv.data.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-sm"><Link to={`/pessoas/comunidades/${i.community.id}`} className="font-semibold text-ink hover:underline">{i.community.name}</Link><span className="text-muted"> · {i.community.kindLabel}{i.invitedBy ? ` · convite de ${i.invitedBy}` : ''}</span></span>
              <Button size="sm" variant="primary" onClick={() => answer.mutate({ id: i.id, approve: true })}>Aceitar</Button>
              <Button size="sm" onClick={() => answer.mutate({ id: i.id, approve: false })}>Recusar</Button>
            </li>
          ))}</ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Quais comunidades" className="flex border border-line bg-surface text-sm">
          {(['todas', 'minhas', 'arquivadas'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={clsx('px-3 py-1.5', tab === t ? 'bg-primary text-white' : 'text-text hover:bg-surface-2')}>{t === 'todas' ? 'Todas' : t === 'minhas' ? 'Minhas' : 'Arquivadas'}</button>)}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar comunidades" className="h-9 pl-9" placeholder="Buscar comunidade" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {!!q.data?.categories.length && (
          <Select aria-label="Categoria" className="h-9 w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Todas as categorias</option>{q.data.categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
        )}
        {q.data?.canCreate && <Button className="ml-auto" variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating((v) => !v)} aria-expanded={creating}>Criar comunidade</Button>}
      </div>

      {creating && q.data && <CommunityForm canInstitutional={q.data.canCreateInstitutional} onCancel={() => setCreating(false)} onSaved={(c) => { setCreating(false); nav(`/pessoas/comunidades/${c.id}`); }} />}

      {q.isLoading ? <div className="card"><LoadingRows rows={4} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
        <div className="card"><EmptyState title={tab === 'minhas' ? 'Você ainda não participa de comunidades' : tab === 'arquivadas' ? 'Nenhuma comunidade arquivada' : dq || cat ? 'Nenhuma comunidade encontrada' : 'Nenhuma comunidade ainda'} description={tab === 'minhas' ? 'Veja as comunidades disponíveis e participe das que combinam com você.' : q.data?.canCreate ? 'Crie a primeira e convide os colegas.' : 'Quando houver comunidades, elas aparecem aqui.'} /></div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.items.map((c) => (
            <li key={c.id} className="card flex flex-col overflow-hidden">
              <Link to={`/pessoas/comunidades/${c.id}`} aria-label={`Abrir ${c.name}`}><CommunityCover c={c} className="h-24" /></Link>
              <div className="flex flex-1 flex-col p-4">
                <Link to={`/pessoas/comunidades/${c.id}`} className="font-semibold text-ink hover:underline">{c.name}</Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted"><span className="inline-flex items-center gap-1"><KindIcon kind={c.kind} />{c.kindLabel}</span>· {c.memberCount} {c.memberCount === 1 ? 'membro' : 'membros'}{c.category && <Chip>{c.category}</Chip>}</p>
                {c.description && <p className="mt-2 line-clamp-2 text-sm text-text">{c.description}</p>}
                <div className="mt-auto pt-3">
                  {c.myRole ? <Link to={`/pessoas/comunidades/${c.id}`} className="inline-flex h-8 items-center px-3 text-sm font-semibold text-primary hover:bg-surface-2">{c.myRole === 'responsavel' ? 'Você é responsável' : c.myRole === 'moderador' ? 'Você modera' : 'Você participa'} →</Link>
                    : c.pending?.kind === 'pedido' ? <span className="text-sm text-muted">Pedido enviado</span>
                    : c.perms.join ? <Button size="sm" variant={c.kind === 'privada' && c.pending?.kind !== 'convite' ? 'secondary' : 'primary'} loading={join.isPending && join.variables?.id === c.id} onClick={() => join.mutate({ id: c.id })}>{c.pending?.kind === 'convite' ? 'Aceitar convite' : c.kind === 'privada' ? 'Pedir para participar' : 'Participar'}</Button> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
