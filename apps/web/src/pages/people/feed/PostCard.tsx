/** Cartão de publicação: autor, conteúdo, mídias, reações, comentários, salvar, copiar link e ações do autor. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bookmark, BookmarkCheck, Building2, Download, FileText, Link2, MessageCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { fmtBytes } from '../../../lib/files';
import { fmtDateTime, fmtRelative } from '../../../lib/format';
import { Avatar, Chip } from '../../../components/ui/primitives';
import { ConfirmDialog, useToast } from '../../../components/ui/overlay';
import { RichText } from '../../../features/RichText';
import { errMsg } from '../../../features/contracts/shared';
import { orgLine } from '../shared';
import { mediaUrl, REACTIONS, type FeedPost, type Reaction } from './api';
import { PostEditor } from './PostEditor';

export function PostCard({ post, detail = false }: { post: FeedPost; detail?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [picker, setPicker] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['pessoas', 'feed'] }); void qc.invalidateQueries({ queryKey: ['pessoas', 'post', post.id] }); };
  const react = useMutation({
    mutationFn: (k: Reaction | null) => (k ? api(`/pessoas/posts/${post.id}/reacao`, { method: 'PUT', body: { kind: k } }) : api(`/pessoas/posts/${post.id}/reacao`, { method: 'DELETE' })),
    onSuccess: refresh, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const save = useMutation({
    mutationFn: () => api(`/pessoas/posts/${post.id}/salvo`, { method: post.saved ? 'DELETE' : 'PUT' }),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: post.saved ? 'Removida dos salvos' : 'Publicação salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const del = useMutation({
    mutationFn: () => api(`/pessoas/posts/${post.id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); setConfirmDel(false); toast({ tone: 'success', message: 'Publicação excluída' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/pessoas/publicacao/${post.id}`); toast({ tone: 'success', message: 'Link copiado. Só quem pode ver a publicação consegue abrir.' }); } catch { toast({ tone: 'error', message: 'Não foi possível copiar o link.' }); }
  };
  if (editing) return <PostEditor initial={post} onDone={() => setEditing(false)} />;
  const institutional = post.kind === 'institucional';
  const mine = REACTIONS.find((r) => r.key === post.myReaction);
  const top = REACTIONS.filter((r) => (post.reactions[r.key] ?? 0) > 0);
  const images = post.media.filter((m) => m.kind === 'imagem');
  const videos = post.media.filter((m) => m.kind === 'video');
  const files = post.media.filter((m) => m.kind === 'arquivo');
  return (
    <article className={clsx('card', institutional && 'border-l-4 border-l-primary')} aria-label={`Publicação de ${institutional ? 'a empresa' : post.author.name}`}>
      <header className="flex items-start gap-3 p-4 pb-2">
        <Link to={`/pessoas/perfil/${post.author.id}`}><Avatar name={post.author.name} userId={post.author.id} hasPhoto={post.author.hasPhoto} size={44} /></Link>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm"><Link to={`/pessoas/perfil/${post.author.id}`} className="font-semibold text-ink hover:underline">{post.author.name}</Link>{institutional && <Chip tone="blue"><Building2 className="mr-1 inline h-3 w-3" aria-hidden />Institucional</Chip>}</p>
          {orgLine(post.author) && <p className="truncate text-xs text-muted">{orgLine(post.author)}</p>}
          <p className="text-xs text-muted"><time dateTime={post.publishedAt ?? post.createdAt} title={fmtDateTime(post.publishedAt ?? post.createdAt)}>{fmtRelative(post.publishedAt ?? post.createdAt)}</time> · {post.audienceLabel}{post.editedAt ? ' · editada' : ''}</p>
        </div>
        <div className="relative">
          <button type="button" className="rounded-sm p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Ações da publicação" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><MoreHorizontal className="h-5 w-5" /></button>
          {menu && (
            <ul className="absolute right-0 z-20 mt-1 w-48 border border-line bg-surface py-1 shadow-overlay" role="menu" onMouseLeave={() => setMenu(false)}>
              <li><button role="menuitem" type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setMenu(false); void copyLink(); }}><Link2 className="h-4 w-4" aria-hidden />Copiar link</button></li>
              {post.mine && <li><button role="menuitem" type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setMenu(false); setEditing(true); }}><Pencil className="h-4 w-4" aria-hidden />Editar</button></li>}
              {post.mine && <li><button role="menuitem" type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft" onClick={() => { setMenu(false); setConfirmDel(true); }}><Trash2 className="h-4 w-4" aria-hidden />Excluir</button></li>}
            </ul>
          )}
        </div>
      </header>
      {post.body && <div className="px-4 pb-2"><RichText text={post.body} names={post.mentions.map((m) => m.name)} /></div>}
      {images.length > 0 && (
        <div className={clsx('grid gap-0.5', images.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {images.slice(0, 4).map((m, i) => (
            <a key={m.id} href={mediaUrl(m.id)} target="_blank" rel="noopener" className="relative block bg-surface-2">
              <img src={mediaUrl(m.id)} alt={m.filename} loading="lazy" className={clsx('w-full object-cover', images.length === 1 ? 'max-h-[520px]' : 'h-56')} />
              {i === 3 && images.length > 4 && <span className="absolute inset-0 flex items-center justify-center bg-ink/50 text-2xl font-bold text-white">+{images.length - 4}</span>}
            </a>
          ))}
        </div>
      )}
      {videos.map((m) => <video key={m.id} src={mediaUrl(m.id)} controls preload="metadata" className="max-h-[520px] w-full bg-black" aria-label={m.filename} />)}
      {files.length > 0 && (
        <ul className="space-y-1 px-4 pt-2">{files.map((m) => (
          <li key={m.id}><a href={mediaUrl(m.id)} className="flex items-center gap-2 border border-line px-3 py-2 text-sm hover:bg-surface-2"><FileText className="h-4 w-4 text-primary" aria-hidden /><span className="min-w-0 flex-1 truncate text-ink">{m.filename}</span><span className="text-xs text-muted">{fmtBytes(m.sizeBytes)}</span><Download className="h-4 w-4 text-muted" aria-hidden /></a></li>
        ))}</ul>
      )}
      {(post.reactionCount > 0 || post.commentCount > 0) && (
        <div className="flex items-center justify-between px-4 pt-2 text-xs text-muted">
          <span>{top.map((r) => r.emoji).join('')} {post.reactionCount > 0 ? post.reactionCount : ''}</span>
          {post.commentCount > 0 && <Link to={`/pessoas/publicacao/${post.id}`} className="hover:underline">{post.commentCount} {post.commentCount === 1 ? 'comentário' : 'comentários'}</Link>}
        </div>
      )}
      <footer className="mt-2 flex items-center gap-1 border-t border-line px-2 py-1">
        <div className="relative">
          <button type="button" className={clsx('flex items-center gap-1.5 rounded-sm px-3 py-2 text-sm font-semibold hover:bg-surface-2', mine ? 'text-primary' : 'text-text')} aria-pressed={!!mine}
            onClick={() => react.mutate(mine ? null : 'curtir')} onContextMenu={(e) => { e.preventDefault(); setPicker(true); }}>
            <span aria-hidden>{mine?.emoji ?? '👍'}</span>{mine?.label ?? 'Curtir'}
          </button>
        </div>
        <button type="button" className="rounded-sm px-2 py-2 text-xs text-muted hover:bg-surface-2" aria-label="Escolher reação" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>▾</button>
        {picker && (
          <div className="flex gap-1" role="group" aria-label="Reações">
            {REACTIONS.map((r) => <button key={r.key} type="button" title={r.label} aria-label={r.label} className={clsx('rounded-circle px-1.5 py-1 text-lg hover:bg-surface-2', post.myReaction === r.key && 'bg-primary-soft')} onClick={() => { setPicker(false); react.mutate(post.myReaction === r.key ? null : r.key); }}>{r.emoji}</button>)}
          </div>
        )}
        {!detail && <Link to={`/pessoas/publicacao/${post.id}`} className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-sm font-semibold text-text hover:bg-surface-2"><MessageCircle className="h-4 w-4" aria-hidden />Comentar</Link>}
        <button type="button" className={clsx('ml-auto flex items-center gap-1.5 rounded-sm px-3 py-2 text-sm font-semibold hover:bg-surface-2', post.saved ? 'text-primary' : 'text-text')} aria-pressed={post.saved} onClick={() => save.mutate()}>
          {post.saved ? <BookmarkCheck className="h-4 w-4" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}{post.saved ? 'Salva' : 'Salvar'}
        </button>
      </footer>
      <ConfirmDialog open={confirmDel} title="Excluir publicação" tone="danger" confirmLabel="Excluir" loading={del.isPending} onCancel={() => setConfirmDel(false)} onConfirm={() => del.mutate()}>
        <p>A publicação sai do feed para todos, com os comentários e reações. Esta ação não pode ser desfeita por você.</p>
      </ConfirmDialog>
    </article>
  );
}
