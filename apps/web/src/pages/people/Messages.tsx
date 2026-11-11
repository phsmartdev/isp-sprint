/**
 * Mensagens diretas entre colegas (como no Instagram): conversas à esquerda, a conversa aberta à direita.
 * Privadas: só as duas pessoas leem. Atualiza sozinho enquanto a tela está aberta.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, PenSquare, Search, Send, Trash2 } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { Avatar, Button, EmptyState, ErrorState, Input, LoadingRows } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { orgLine, type PersonCard } from './shared';
import { useStartConversation } from './FeedHome';

type Conv = { id: string; with: PersonCard; lastAt: string | null; last: string | null; unread: number };
type Msg = { id: string; authorId: string; body: string; createdAt: string; mine: boolean; seen: boolean };

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
                <Avatar name={c.with.name} userId={c.with.id} hasPhoto={c.with.hasPhoto} size={52} />
                <span className="min-w-0 flex-1">
                  <span className={clsx('block truncate text-sm text-ink', c.unread > 0 && 'font-bold')}>{c.with.name}</span>
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
  const q = useQuery({ queryKey: ['pessoas', 'mensagens', id], queryFn: () => api<{ with: PersonCard | null; items: Msg[]; more: boolean }>(`/pessoas/mensagens/conversas/${id}`), refetchInterval: 5_000 });
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
  const del = useMutation({ mutationFn: (mid: string) => api(`/pessoas/mensagens/${mid}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['pessoas', 'mensagens'] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const w = q.data!.with;
  const lastMine = [...q.data!.items].reverse().find((m) => m.mine);
  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button type="button" className="rounded-sm p-1 md:hidden" aria-label="Voltar às conversas" onClick={() => nav('/pessoas/mensagens')}><ArrowLeft className="h-5 w-5" /></button>
        {w && <Link to={`/pessoas/perfil/${w.id}`} className="flex min-w-0 items-center gap-3"><Avatar name={w.name} userId={w.id} hasPhoto={w.hasPhoto} size={40} /><span className="min-w-0"><span className="block truncate font-semibold text-ink">{w.name}</span><span className="block truncate text-xs text-muted">{orgLine(w)}</span></span></Link>}
      </header>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4" aria-live="polite">
        {!q.data!.items.length && <p className="py-10 text-center text-sm text-muted">Diga oi para {w?.name.split(' ')[0] ?? 'seu colega'} 👋</p>}
        {q.data!.items.map((m) => (
          <div key={m.id} className={clsx('group flex items-end gap-2', m.mine ? 'justify-end' : 'justify-start')}>
            {m.mine && <button type="button" className="invisible rounded-sm p-1 text-muted hover:text-danger group-hover:visible" aria-label="Apagar mensagem" onClick={() => del.mutate(m.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
            <p title={fmtDateTime(m.createdAt)} className={clsx('max-w-[75%] whitespace-pre-wrap break-words rounded-[22px] px-4 py-2 text-sm', m.mine ? 'bg-primary text-white' : 'bg-surface-2 text-ink')}>{m.body}</p>
          </div>
        ))}
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
  const dq = useDebounced(term.trim(), 250);
  const q = useQuery({ queryKey: ['pessoas', 'colaboradores', 'dm', dq], enabled: open, queryFn: () => api<{ items: PersonCard[] }>(`/pessoas/colaboradores${qs({ q: dq || undefined, limit: 12 })}`), placeholderData: (p) => p });
  const start = useStartConversation();
  return (
    <Modal open={open} onClose={onClose} title="Nova mensagem" size="sm">
      <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Para" className="pl-9" placeholder="Pesquisar colega" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus /></div>
      <ul className="max-h-80 overflow-y-auto">{(q.data?.items ?? []).map((p) => (
        <li key={p.id}><button type="button" className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-surface-2" onClick={() => { start.mutate(p.id); onClose(); }}>
          <Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={40} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{p.name}</span><span className="block truncate text-xs text-muted">{orgLine(p)}</span></span>
        </button></li>
      ))}</ul>
    </Modal>
  );
}
