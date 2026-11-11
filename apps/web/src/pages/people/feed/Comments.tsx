/**
 * Comentários de uma publicação: caixa para comentar e a conversa, com um nível de resposta.
 * No feed (recolhido) mostra só os 2 últimos e "Ver todos os N comentários" abre o resto ali mesmo, como no Instagram.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { fmtDateTime, fmtRelative } from '../../../lib/format';
import { Avatar, Button, LoadingRows, Textarea } from '../../../components/ui/primitives';
import { useToast } from '../../../components/ui/overlay';
import { MentionInput, mentionsIn, type MentionHandle, type Participant } from '../../../features/MentionInput';
import { RichText } from '../../../features/RichText';
import { errMsg } from '../../../features/contracts/shared';
import { usePeopleMe } from '../shared';
import type { Comment, FeedPost } from './api';
import { ReportDialog } from '../Report';
import { usePeoplePeople } from './PostEditor';

export function CommentsThread({ postId, collapsed = false, autoFocus = false }: { postId: string; collapsed?: boolean; autoFocus?: boolean }) {
  const q = useQuery({ queryKey: ['pessoas', 'post', postId], queryFn: () => api<{ post: FeedPost; comments: Comment[] }>(`/pessoas/posts/${postId}`) });
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [all, setAll] = useState(!collapsed);
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
  if (q.isLoading) return <LoadingRows rows={2} />;
  if (!q.data) return null;
  const top = q.data.comments.filter((c) => !c.parentId);
  const replies = (cid: string) => q.data!.comments.filter((c) => c.parentId === cid);
  const shown = all ? top : top.slice(-2);
  return (
    <div className="space-y-3">
      {!all && top.length > shown.length && <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setAll(true)}>Ver todos os {q.data.post.commentCount} comentários</button>}
      {shown.length > 0 && (
        <ol className="space-y-3">
          {shown.map((c) => {
            const rs = replies(c.id);
            const open = !collapsed || openReplies[c.id] || replyTo?.id === c.id;
            return (
              <li key={c.id}>
                <CommentItem c={c} postId={postId} onReply={() => { setReplyTo(c); setOpenReplies((o) => ({ ...o, [c.id]: true })); }} />
                {rs.length > 0 && !open && <button type="button" className="ml-11 mt-1 text-xs font-semibold text-muted hover:text-ink" onClick={() => setOpenReplies((o) => ({ ...o, [c.id]: true }))}>── Ver respostas ({rs.length})</button>}
                {open && (rs.length > 0 || replyTo?.id === c.id) && (
                  <ol className="ml-11 mt-2 space-y-3 border-l border-line pl-3">
                    {rs.map((r) => <li key={r.id}><CommentItem c={r} postId={postId} onReply={() => setReplyTo(c)} /></li>)}
                    {replyTo?.id === c.id && <li><CommentBox postId={postId} parentId={c.id} autoFocus onDone={() => setReplyTo(null)} placeholder={`Responder a ${c.author.name.split(' ')[0]}…`} /></li>}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <CommentBox postId={postId} autoFocus={autoFocus} />
    </div>
  );
}

export function CommentItem({ c, postId, onReply }: { c: Comment; postId: string; onReply: () => void }) {
  const [report, setReport] = useState(false);
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
          {!c.mine && <button type="button" className="font-semibold hover:text-danger" onClick={() => setReport(true)}>Denunciar</button>}
          <ReportDialog target={report ? { targetType: 'comentario', targetId: c.id } : null} onClose={() => setReport(false)} />
        </p>
      </div>
    </div>
  );
}

export function CommentBox({ postId, parentId, onDone, autoFocus, placeholder }: { postId: string; parentId?: string; onDone?: () => void; autoFocus?: boolean; placeholder?: string }) {
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
