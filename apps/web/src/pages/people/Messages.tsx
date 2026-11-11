/**
 * Mensagens diretas entre colegas (como no Instagram): conversas à esquerda, a conversa aberta à direita.
 * Privadas: só as duas pessoas leem. Atualiza sozinho enquanto a tela está aberta.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, PenSquare, Search, Send, Trash2, UsersRound } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { Avatar, Button, EmptyState, ErrorState, Input, LoadingRows } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { orgLine, type PersonCard } from './shared';
import { useStartConversation } from './FeedHome';
import { mediaUrl } from './feed/api';

type Conv = { id: string; kind: 'direta' | 'grupo'; title: string; with: PersonCard | null; members: PersonCard[]; lastAt: string | null; last: string | null; unread: number };
type SharedPost = { id: string; unavailable: true } | { id: string; unavailable: false; author: PersonCard | null; excerpt: string; kind: string; imageId: string | null; meta: Record<string, unknown> | null };
type Msg = { id: string; authorId: string; body: string; createdAt: string; mine: boolean; seen: boolean; author: PersonCard | null; post: SharedPost | null };

export function MessagesPage() {
  const { id } = useParams();
  const list = useQuery({ queryKey: ['pessoas', 'mensagens'], queryFn: () => api<{ items: Conv[] }>('/pessoas/mensagens'), refetchInterval: 15_000 });
  const [picking, setPicking] = useState(false);
  return (
    <div className="card flex h-[calc(100vh-168px)] min-h-[480px] overflow-hidden md:h-[calc(100vh-120px)]">
      <section aria-label="Conversas" className={clsx('flex w-full flex-col border-r border-line md:w-[340px] md:shrink-0', id && 'hidden md:flex')}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h1 className="text-lg font-bold text-ink">Mensagens</h1>
          <button type="button" aria-label="Nova mensagem" className="rounded-sm p-1.5 hover:bg-surface-2" onClick={() => setPicking(true)}><PenSquare className="h-5 w-5" /></button>
        </div>
        {list.isLoading ? <LoadingRows rows={5} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data!.items.length ? (
          <EmptyState title="Nenhuma conversa ainda" description="Mande uma mensagem para um colega." action={<Button variant="primary" size="sm" onClick={() => setPicking(true)}>Nova mensagem</Button>} />
        ) : (
          <ul className="flex-1 overflow-y-auto">{list.data!.items.map((c) => (
            <li key={c.id}>
              <Link to={`/pessoas/mensagens/${c.id}`} className={clsx('flex items-center gap-3 px-4 py-3 hover:bg-surface-2', c.id === id && 'bg-surface-2')}>
                <ConvAvatar c={c} size={52} />
                <span className="min-w-0 flex-1">
                  <span className={clsx('block truncate text-sm text-ink', c.unread > 0 && 'font-bold')}>{c.title}</span>
                  <span className={clsx('block truncate text-xs', c.unread > 0 ? 'font-semibold text-ink' : 'text-muted')}>{c.last}{c.lastAt && ` · ${fmtRelative(c.lastAt)}`}</span>
                </span>
                {c.unread > 0 && <span className="h-2.5 w-2.5 rounded-circle bg-primary" aria-label={`${c.unread} não lidas`} />}
              </Link>
            </li>
          ))}</ul>
        )}
      </section>
      <section aria-label="Conversa" className={clsx('min-w-0 flex-1 flex-col', id ? 'flex' : 'hidden md:flex')}>
        {id ? <Thread id={id} /> : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-circle border-2 border-ink"><Send className="h-9 w-9" aria-hidden /></span>
            <p className="text-lg font-semibold text-ink">Suas mensagens</p>
            <p className="text-sm text-muted">Converse em particular com um colega. Só vocês dois leem.</p>
            <Button variant="primary" onClick={() => setPicking(true)}>Enviar mensagem</Button>
          </div>
        )}
      </section>
      <PickColleague open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}

function Thread({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['pessoas', 'mensagens', id], queryFn: () => api<{ kind: 'direta' | 'grupo'; title: string; with: PersonCard | null; members: PersonCard[]; items: Msg[]; more: boolean }>(`/pessoas/mensagens/conversas/${id}`), refetchInterval: 5_000 });
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const count = q.data?.items.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [count]);
  useEffect(() => { if (q.data) { void qc.invalidateQueries({ queryKey: ['pessoas', 'contadores'] }); void qc.invalidateQueries({ queryKey: ['pessoas', 'mensagens'], exact: true }); } }, [q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useMutation({
    mutationFn: () => api(`/pessoas/mensagens/conversas/${id}`, { method: 'POST', body: { body: text } }),
    onSuccess: () => { setText(''); void qc.invalidateQueries({ queryKey: ['pessoas', 'mensagens'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const leave = useMutation({ mutationFn: () => api(`/pessoas/mensagens/conversas/${id}/sair`, { method: 'POST' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas', 'mensagens'] }); nav('/pessoas/mensagens'); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const del = useMutation({ mutationFn: (mid: string) => api(`/pessoas/mensagens/${mid}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['pessoas', 'mensagens'] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const w = q.data!.with;
  const lastMine = [...q.data!.items].reverse().find((m) => m.mine);
  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button type="button" className="rounded-sm p-1 md:hidden" aria-label="Voltar às conversas" onClick={() => nav('/pessoas/mensagens')}><ArrowLeft className="h-5 w-5" /></button>
        {w ? <Link to={`/pessoas/perfil/${w.id}`} className="flex min-w-0 items-center gap-3"><Avatar name={w.name} userId={w.id} hasPhoto={w.hasPhoto} size={40} /><span className="min-w-0"><span className="block truncate font-semibold text-ink">{w.name}</span><span className="block truncate text-xs text-muted">{orgLine(w)}</span></span></Link> : (
          <div className="flex min-w-0 flex-1 items-center gap-3"><ConvAvatar c={{ kind: 'grupo', members: q.data!.members, with: null, title: q.data!.title }} size={40} /><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink">{q.data!.title}</span><span className="block truncate text-xs text-muted">{q.data!.members.map((m) => m.name.split(' ')[0]).join(', ')} e você</span></span>
            <Button size="sm" variant="ghost" onClick={() => leave.mutate()}>Sair do grupo</Button></div>
        )}
      </header>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4" aria-live="polite">
        {!q.data!.items.length && <p className="py-10 text-center text-sm text-muted">Diga oi para {w?.name.split(' ')[0] ?? 'seu colega'} 👋</p>}
        {q.data!.items.map((m, i) => {
          const group = q.data!.kind === 'grupo';
          const firstOfRun = !m.mine && (i === 0 || q.data!.items[i - 1]!.authorId !== m.authorId);
          return (
            <div key={m.id} className={clsx('group flex items-end gap-2', m.mine ? 'justify-end' : 'justify-start')}>
              {m.mine && <button type="button" className="invisible rounded-sm p-1 text-muted hover:text-danger group-hover:visible" aria-label="Apagar mensagem" onClick={() => del.mutate(m.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
              {group && !m.mine && <span className="w-7 shrink-0">{firstOfRun && m.author && <Avatar name={m.author.name} userId={m.author.id} hasPhoto={m.author.hasPhoto} size={28} />}</span>}
              <div className={clsx('flex max-w-[75%] flex-col gap-1', m.mine ? 'items-end' : 'items-start')}>
                {group && firstOfRun && m.author && <span className="px-3 text-xs text-muted">{m.author.name.split(' ')[0]}</span>}
                {m.post && <SharedPostCard post={m.post} />}
                {m.body && <p title={fmtDateTime(m.createdAt)} className={clsx('whitespace-pre-wrap break-words rounded-[22px] px-4 py-2 text-sm', m.mine ? 'bg-primary text-white' : 'bg-surface-2 text-ink')}>{m.body}</p>}
              </div>
            </div>
          );
        })}
        {lastMine?.seen && <p className="pr-1 text-right text-xs text-muted">Visto</p>}
        <div ref={end} />
      </div>
      <form className="flex items-center gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
        <Input aria-label="Escrever mensagem" className="h-11 flex-1 rounded-full px-4" placeholder="Mensagem…" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <Button type="submit" variant="ghost" loading={send.isPending} disabled={!text.trim()} className="font-semibold text-primary">Enviar</Button>
      </form>
    </>
  );
}

function PickColleague({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState<PersonCard[]>([]);
  const [title, setTitle] = useState('');
  const dq = useDebounced(term.trim(), 250);
  const q = useQuery({ queryKey: ['pessoas', 'colaboradores', 'dm', dq], enabled: open, queryFn: () => api<{ items: PersonCard[] }>(`/pessoas/colaboradores${qs({ q: dq || undefined, limit: 12 })}`), placeholderData: (p) => p });
  const start = useStartConversation();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const group = useMutation({
    mutationFn: () => api<{ id: string }>('/pessoas/mensagens/grupos', { method: 'POST', body: { title: title.trim(), userIds: sel.map((p) => p.id) } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['pessoas', 'mensagens'] }); close(); nav(`/pessoas/mensagens/${r.id}`); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const close = () => { setSel([]); setTerm(''); setTitle(''); onClose(); };
  const toggle = (p: PersonCard) => setSel((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p]));
  const go = () => { if (sel.length === 1) { start.mutate(sel[0]!.id); close(); } else group.mutate(); };
  return (
    <Modal open={open} onClose={close} title="Nova mensagem" size="sm"
      footer={<div className="flex w-full flex-col gap-2">
        {sel.length > 1 && <Input aria-label="Nome do grupo" placeholder="Nome do grupo" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />}
        <Button variant="primary" disabled={!sel.length || (sel.length > 1 && title.trim().length < 2)} loading={start.isPending || group.isPending} onClick={go}>{sel.length > 1 ? 'Criar grupo' : 'Conversar'}</Button>
      </div>}>
      {sel.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{sel.map((p) => <button key={p.id} type="button" className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary" onClick={() => toggle(p)} aria-label={`Tirar ${p.name}`}>{p.name.split(' ')[0]} ×</button>)}</div>}
      <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Para" className="pl-9" placeholder="Pesquisar colega (escolha mais de um para criar um grupo)" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus /></div>
      <ul className="max-h-80 overflow-y-auto">{(q.data?.items ?? []).map((p) => {
        const on = sel.some((x) => x.id === p.id);
        return (
          <li key={p.id}><button type="button" role="checkbox" aria-checked={on} aria-label={p.name} className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-surface-2" onClick={() => toggle(p)}>
            <Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={40} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{p.name}</span><span className="block truncate text-xs text-muted">{orgLine(p)}</span></span>
            <span className={clsx('flex h-6 w-6 items-center justify-center rounded-circle border-2', on ? 'border-primary bg-primary text-white' : 'border-line-strong')}>{on && <Check className="h-4 w-4" aria-hidden />}</span>
          </button></li>
        );
      })}</ul>
    </Modal>
  );
}

/** Foto da conversa: a do colega ou, no grupo, duas fotos sobrepostas. */
function ConvAvatar({ c, size }: { c: Pick<Conv, 'kind' | 'with' | 'members' | 'title'>; size: number }) {
  if (c.kind === 'direta' && c.with) return <Avatar name={c.with.name} userId={c.with.id} hasPhoto={c.with.hasPhoto} size={size} />;
  const [a, b] = c.members;
  if (!a) return <span className="flex shrink-0 items-center justify-center rounded-circle bg-primary-soft text-primary" style={{ width: size, height: size }}><UsersRound className="h-1/2 w-1/2" aria-hidden /></span>;
  const s = Math.round(size * 0.72);
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span className="absolute right-0 top-0"><Avatar name={a.name} userId={a.id} hasPhoto={a.hasPhoto} size={s} /></span>
      {b && <span className="absolute bottom-0 left-0 rounded-circle ring-2 ring-surface"><Avatar name={b.name} userId={b.id} hasPhoto={b.hasPhoto} size={s} /></span>}
    </span>
  );
}

/** Publicação enviada na conversa: abre a publicação; se a pessoa não pode vê-la, só o aviso. */
function SharedPostCard({ post }: { post: SharedPost }) {
  if (post.unavailable) return <p className="rounded-[18px] border border-line px-4 py-3 text-sm text-muted">Publicação indisponível para você</p>;
  const meta = post.meta as { type?: string } | null;
  return (
    <Link to={`/pessoas/publicacao/${post.id}`} className="block w-64 overflow-hidden rounded-[18px] border border-line bg-surface hover:border-primary" aria-label={`Publicação de ${post.author?.name ?? 'colega'}`}>
      {post.author && <span className="flex items-center gap-2 px-3 py-2"><Avatar name={post.author.name} userId={post.author.id} hasPhoto={post.author.hasPhoto} size={24} /><span className="truncate text-xs font-semibold text-ink">{post.author.name}</span></span>}
      {post.imageId ? <img src={mediaUrl(post.imageId)} alt="" className="aspect-square w-full object-cover" /> : meta?.type ? <span className="flex aspect-[2/1] items-center justify-center bg-gradient-to-br from-navy to-primary text-3xl" aria-hidden>{meta.type === 'venda' ? '🏆' : meta.type === 'badge' ? '🏅' : '👏'}</span> : null}
      {post.excerpt && <span className="line-clamp-3 block px-3 py-2 text-xs text-text">{post.excerpt}</span>}
    </Link>
  );
}
