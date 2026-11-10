/** Publicação aberta: o cartão e a conversa (comentários com um nível de resposta, editar e remover os próprios). */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../../lib/api';
import { fmtDateTime, fmtRelative } from '../../../lib/format';
import { Avatar, Button, EmptyState, ErrorState, LoadingRows, Textarea } from '../../../components/ui/primitives';
import { useToast } from '../../../components/ui/overlay';
import { MentionInput, mentionsIn, type MentionHandle, type Participant } from '../../../features/MentionInput';
import { RichText } from '../../../features/RichText';
import { errMsg } from '../../../features/contracts/shared';
import { usePeopleMe } from '../shared';
import type { Comment, FeedPost } from './api';
import { PostCard } from './PostCard';
import { usePeoplePeople } from './PostEditor';

export function PostPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['pessoas', 'post', id], queryFn: () => api<{ post: FeedPost; comments: Comment[] }>(`/pessoas/posts/${id}`) });
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError || !q.data) return (
    <div className="mx-auto max-w-2xl"><ErrorState error={q.error} /><p className="mt-2 text-sm"><Link to="/pessoas" className="link">Voltar ao Meu Espaço</Link></p></div>
  );
  const top = q.data.comments.filter((c) => !c.parentId);
  const replies = (cid: string) => q.data!.comments.filter((c) => c.parentId === cid);
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      <Link to="/pessoas" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Meu Espaço</Link>
      {q.data.post.status === 'publicado' ? <PostCard post={q.data.post} detail /> : <div className="card p-4 text-sm text-muted">Rascunho: só você vê. Publique pelo editor em Meu Espaço → Rascunhos.</div>}
      {q.data.post.status === 'publicado' && (
        <section className="card p-4" aria-label="Comentários">
          <h2 className="mb-3 text-md font-bold text-ink">Comentários ({q.data.post.commentCount})</h2>
          <CommentBox postId={id} />
          {!top.length ? <EmptyState title="Seja o primeiro a comentar" description="Reconheça, pergunte ou complemente." /> : (
            <ol className="mt-4 space-y-4">
              {top.map((c) => (
                <li key={c.id}>
                  <CommentItem c={c} postId={id} onReply={() => setReplyTo(c)} />
                  {(replies(c.id).length > 0 || replyTo?.id === c.id) && (
                    <ol className="ml-11 mt-2 space-y-3 border-l border-line pl-3">
                      {replies(c.id).map((r) => <li key={r.id}><CommentItem c={r} postId={id} onReply={() => setReplyTo(c)} /></li>)}
                      {replyTo?.id === c.id && <li><CommentBox postId={id} parentId={c.id} autoFocus onDone={() => setReplyTo(null)} placeholder={`Responder a ${c.author.name.split(' ')[0]}…`} /></li>}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

function CommentItem({ c, postId, onReply }: { c: Comment; postId: string; onReply: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['pessoas', 'post', postId] }); void qc.invalidateQueries({ queryKey: ['pessoas', 'feed'] }); };
  const save = useMutation({ mutationFn: () => api(`/pessoas/comentarios/${c.id}`, { method: 'PATCH', body: { body: edit, mentions: c.mentions.map((m) => m.id) } }), onSuccess: () => { setEdit(null); refresh(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const del = useMutation({ mutationFn: () => api(`/pessoas/comentarios/${c.id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Comentário removido' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <div className="flex gap-3">
      <Link to={`/pessoas/perfil/${c.author.id}`}><Avatar name={c.author.name} userId={c.author.id} hasPhoto={c.author.hasPhoto} size={32} /></Link>
      <div className="min-w-0 flex-1">
        <div className="bg-surface-2 px-3 py-2">
          <p className="text-sm"><Link to={`/pessoas/perfil/${c.author.id}`} className="font-semibold text-ink hover:underline">{c.author.name}</Link></p>
          {edit !== null ? (
            <div className="mt-1 space-y-2">
              <Textarea aria-label="Editar comentário" rows={2} maxLength={2000} value={edit} onChange={(e) => setEdit(e.target.value)} />
              <div className="flex gap-2"><Button size="sm" variant="primary" loading={save.isPending} disabled={!edit.trim()} onClick={() => save.mutate()}>Salvar</Button><Button size="sm" onClick={() => setEdit(null)}>Cancelar</Button></div>
            </div>
          ) : <RichText text={c.body} names={c.mentions.map((m) => m.name)} />}
        </div>
        <p className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
          <time dateTime={c.createdAt} title={fmtDateTime(c.createdAt)}>{fmtRelative(c.createdAt)}</time>{c.editedAt && <span>editado</span>}
          <button type="button" className="font-semibold hover:text-ink" onClick={onReply}>Responder</button>
          {c.mine && edit === null && <button type="button" className="font-semibold hover:text-ink" onClick={() => setEdit(c.body)}>Editar</button>}
          {c.mine && <button type="button" className="font-semibold hover:text-danger" onClick={() => del.mutate()}>Remover</button>}
        </p>
      </div>
    </div>
  );
}

function CommentBox({ postId, parentId, onDone, autoFocus, placeholder }: { postId: string; parentId?: string; onDone?: () => void; autoFocus?: boolean; placeholder?: string }) {
  const me = usePeopleMe().data;
  const people = usePeoplePeople().data ?? [];
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Participant[]>([]);
  const ref = useRef<MentionHandle>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const send = useMutation({
    mutationFn: () => api(`/pessoas/posts/${postId}/comentarios`, { method: 'POST', body: { body: text.trim(), parentId: parentId ?? null, mentions: mentionsIn(text, picked) } }),
    onSuccess: () => { setText(''); setPicked([]); void qc.invalidateQueries({ queryKey: ['pessoas', 'post', postId] }); void qc.invalidateQueries({ queryKey: ['pessoas', 'feed'] }); onDone?.(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <form className="flex items-start gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
      {me && <Avatar name={me.me.name} userId={me.me.id} hasPhoto={me.me.hasPhoto} size={32} />}
      <MentionInput ref={ref} people={people} value={text} onChange={setText} picked={picked} onPick={(p) => setPicked((x) => [...x, p])} label={parentId ? 'Responder comentário' : 'Escrever comentário'} placeholder={placeholder ?? 'Escreva um comentário… use @ para mencionar'} rows={2} maxLength={2000} />
      <Button type="submit" variant="primary" size="sm" loading={send.isPending} disabled={!text.trim()}>{parentId ? 'Responder' : 'Comentar'}</Button>
    </form>
  );
}
