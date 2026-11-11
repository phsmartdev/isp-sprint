/**
 * Cartão de publicação no formato do Instagram (familiar para todos): cabeçalho com foto e nome, mídia de ponta a
 * ponta em carrossel (proporção 4:5, 1:1 ou 1,91:1 pela primeira imagem), ações logo abaixo (curtir, comentar,
 * salvar), reações, legenda com o nome em negrito, "ver comentários" e o tempo. Duplo toque na mídia curte.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bookmark, Building2, ChevronLeft, ChevronRight, Download, EyeOff, FileText, Flag, Heart, Link2, MessageCircle, MoreHorizontal, Pencil, Pin, Send, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { fmtBytes } from '../../../lib/files';
import { fmtDateTime, fmtRelative } from '../../../lib/format';
import { Avatar, Chip } from '../../../components/ui/primitives';
import { ConfirmDialog, useToast } from '../../../components/ui/overlay';
import { RichText } from '../../../features/RichText';
import { errMsg } from '../../../features/contracts/shared';
import { mediaUrl, REACTIONS, igRatio, type FeedPost, type Reaction } from './api';
import { PostEditor } from './PostEditor';
import { AchievementArt, isAchievement } from './Achievement';
import { ReportDialog } from '../Report';
import { CommentsThread } from './Comments';
import { ShareDialog } from './ShareDialog';

const MEASURE_TEXT: Record<string, string> = {
  ocultar: 'ocultou esta publicação temporariamente', remover: 'removeu esta publicação', solicitar_edicao: 'pediu que você edite esta publicação; ao salvar a edição, ela volta a aparecer', encaminhar: 'encaminhou esta publicação para a instância responsável',
};

function Carousel({ post, onLike }: { post: FeedPost; onLike: () => void }) {
  const items = post.media.filter((m) => m.kind !== 'arquivo');
  const [i, setI] = useState(0);
  const [heart, setHeart] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const ratio = igRatio(items[0]!.width, items[0]!.height);
  const go = (n: number) => { const el = ref.current; if (el) el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' }); };
  return (
    <div className="relative bg-black" onDoubleClick={() => { onLike(); setHeart((h) => h + 1); }}>
      <div ref={ref} className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ aspectRatio: String(ratio) }}
        onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))} aria-roledescription="carrossel">
        {items.map((m, n) => (
          <div key={m.id} className="relative h-full w-full shrink-0 snap-center" aria-label={`${n + 1} de ${items.length}`}>
            {m.kind === 'imagem'
              ? <img src={mediaUrl(m.id)} alt={m.filename} loading="lazy" draggable={false} className="h-full w-full object-cover" />
              : <video src={mediaUrl(m.id)} controls playsInline preload="metadata" className="h-full w-full object-contain" aria-label={m.filename} />}
          </div>
        ))}
      </div>
      {heart > 0 && <Heart key={heart} className="ig-heart pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 fill-white text-white drop-shadow-lg" aria-hidden />}
      {items.length > 1 && (
        <>
          <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{i + 1}/{items.length}</span>
          {i > 0 && <button type="button" aria-label="Mídia anterior" onClick={() => go(i - 1)} className="absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-circle bg-white/85 text-ink shadow"><ChevronLeft className="h-4 w-4" /></button>}
          {i < items.length - 1 && <button type="button" aria-label="Próxima mídia" onClick={() => go(i + 1)} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-circle bg-white/85 text-ink shadow"><ChevronRight className="h-4 w-4" /></button>}
        </>
      )}
      {items.length > 1 && (
        <div className="absolute -bottom-5 left-0 right-0 flex justify-center gap-1" aria-hidden>
          {items.map((m, n) => <span key={m.id} className={clsx('h-1.5 w-1.5 rounded-circle', n === i ? 'bg-primary' : 'bg-line-strong')} />)}
        </div>
      )}
    </div>
  );
}

export function PostCard({ post, detail = false, canPin = false }: { post: FeedPost; detail?: boolean; canPin?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [picker, setPicker] = useState(false);
  const [report, setReport] = useState(false);
  const [more, setMore] = useState(detail);
  const [comments, setComments] = useState(false);
  const [focus, setFocus] = useState(0);
  const [share, setShare] = useState(false);
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
  const pin = useMutation({
    mutationFn: () => api(`/pessoas/posts/${post.id}/fixar`, { method: 'PUT', body: { pinned: !post.pinnedAt } }),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: post.pinnedAt ? 'Publicação desafixada' : 'Publicação fixada no topo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/pessoas/publicacao/${post.id}`); toast({ tone: 'success', message: 'Link copiado. Só quem pode ver a publicação consegue abrir.' }); } catch { toast({ tone: 'error', message: 'Não foi possível copiar o link.' }); }
  };
  if (editing) return <PostEditor initial={post} onDone={() => setEditing(false)} />;
  const institutional = post.kind === 'institucional';
  const mine = REACTIONS.find((r) => r.key === post.myReaction);
  const top = REACTIONS.filter((r) => (post.reactions[r.key] ?? 0) > 0);
  const visual = post.media.some((m) => m.kind !== 'arquivo');
  const files = post.media.filter((m) => m.kind === 'arquivo');
  const art = isAchievement(post);
  const at = post.publishedAt ?? post.createdAt;
  const long = post.body.length > 220 || post.body.split('\n').length > 3;
  const caption = post.body && (
    <div className="px-4 pt-1 text-sm text-ink">
      <div className={clsx(!more && long && 'line-clamp-2')}>
        <Link to={`/pessoas/perfil/${post.author.id}`} className="float-left mr-1.5 font-semibold hover:underline">{post.author.name.split(' ').slice(0, 2).join(' ')}</Link>
        <RichText text={post.body} names={post.mentions.map((m) => m.name)} />
      </div>
      {!more && long && <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setMore(true)}>mais</button>}
    </div>
  );
  const textOnly = !visual && !art;
  return (
    <article className={clsx('card overflow-visible', institutional && 'border-t-4 border-t-primary')} aria-label={`Publicação de ${institutional ? 'a empresa' : post.author.name}`}>
      <header className="flex items-center gap-3 px-3 py-2.5">
        <Link to={`/pessoas/perfil/${post.author.id}`} className="rounded-circle bg-gradient-to-tr from-[#F5B400] via-[#E1306C] to-[#833AB4] p-[2px]" aria-label={post.author.name}>
          <span className="block rounded-circle bg-surface p-[2px]"><Avatar name={post.author.name} userId={post.author.id} hasPhoto={post.author.hasPhoto} size={34} /></span>
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
            <Link to={`/pessoas/perfil/${post.author.id}`} className="font-semibold text-ink hover:underline">{post.author.name}</Link>
            {institutional && <Chip tone="blue"><Building2 className="mr-1 inline h-3 w-3" aria-hidden />Institucional</Chip>}
            <span className="text-muted">·</span>
            <time className="text-muted" dateTime={at} title={fmtDateTime(at)}>{fmtRelative(at)}</time>
          </p>
          <p className="truncate text-xs text-muted">
            {post.community ? <Link to={`/pessoas/comunidades/${post.community.id}`} className="hover:underline">{post.community.name}</Link> : post.author.jobTitle ?? post.audienceLabel}
            {post.editedAt ? ' · editada' : ''}
          </p>
          {post.pinnedAt && <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-primary"><Pin className="h-3 w-3" aria-hidden />Fixada</p>}
        </div>
        <div className="relative">
          <button type="button" className="rounded-sm p-1.5 text-ink hover:bg-surface-2" aria-label="Ações da publicação" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><MoreHorizontal className="h-5 w-5" /></button>
          {menu && (
            <ul className="absolute right-0 z-20 mt-1 w-48 border border-line bg-surface py-1 shadow-overlay" role="menu" onMouseLeave={() => setMenu(false)}>
              <li><button role="menuitem" type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setMenu(false); void copyLink(); }}><Link2 className="h-4 w-4" aria-hidden />Copiar link</button></li>
              {canPin && post.community && <li><button role="menuitem" type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setMenu(false); pin.mutate(); }}><Pin className="h-4 w-4" aria-hidden />{post.pinnedAt ? 'Desafixar' : 'Fixar no topo'}</button></li>}
              {post.mine && <li><button role="menuitem" type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { setMenu(false); setEditing(true); }}><Pencil className="h-4 w-4" aria-hidden />Editar</button></li>}
              {post.mine && <li><button role="menuitem" type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft" onClick={() => { setMenu(false); setConfirmDel(true); }}><Trash2 className="h-4 w-4" aria-hidden />Excluir</button></li>}
              {!post.mine && post.status === 'publicado' && <li><button role="menuitem" type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft" onClick={() => { setMenu(false); setReport(true); }}><Flag className="h-4 w-4" aria-hidden />Denunciar</button></li>}
            </ul>
          )}
        </div>
      </header>
      {post.mine && post.moderation && (
        <p className="mx-3 mb-2 flex gap-2 border border-warning bg-warning-soft px-3 py-2 text-sm text-ink" role="status">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>A moderação {MEASURE_TEXT[post.moderation.measure] ?? 'aplicou uma medida a esta publicação'}.{post.moderation.note && <> Motivo: “{post.moderation.note}”.</>} <Link to="/pessoas/denuncias" className="font-semibold text-primary hover:underline">Ver ou pedir revisão</Link></span>
        </p>
      )}
      {textOnly && post.body && <div className="px-4 pb-1 text-[15px] text-ink"><RichText text={post.body} names={post.mentions.map((m) => m.name)} /></div>}
      {art && <AchievementArt post={post} />}
      {visual && <Carousel post={post} onLike={() => { if (!post.myReaction) react.mutate('curtir'); }} />}
      <footer className={clsx('flex items-center gap-1 px-2', visual && post.media.filter((m) => m.kind !== 'arquivo').length > 1 ? 'pt-4' : 'pt-1')}>
        <button type="button" className="flex items-center gap-1 rounded-sm p-2 hover:bg-surface-2" aria-label={mine?.label ?? 'Curtir'} aria-pressed={!!mine}
          onClick={() => react.mutate(mine ? null : 'curtir')} onContextMenu={(e) => { e.preventDefault(); setPicker(true); }}>
          {mine && mine.key !== 'curtir' ? <span className="text-[22px] leading-none" aria-hidden>{mine.emoji}</span> : <Heart className={clsx('h-6 w-6', mine ? 'fill-[#ED4956] text-[#ED4956]' : 'text-ink')} aria-hidden />}
        </button>
        <button type="button" className="-ml-1 rounded-sm px-1 py-2 text-xs text-muted hover:bg-surface-2" aria-label="Escolher reação" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>▾</button>
        {picker && (
          <div className="flex gap-1" role="group" aria-label="Reações">
            {REACTIONS.map((r) => <button key={r.key} type="button" title={r.label} aria-label={r.label} className={clsx('rounded-circle px-1.5 py-1 text-lg hover:bg-surface-2', post.myReaction === r.key && 'bg-primary-soft')} onClick={() => { setPicker(false); react.mutate(post.myReaction === r.key ? null : r.key); }}>{r.emoji}</button>)}
          </div>
        )}
        {!detail && <button type="button" aria-label="Comentar" aria-expanded={comments} className="rounded-sm p-2 text-ink hover:bg-surface-2" onClick={() => { setComments(true); setFocus((f) => f + 1); }}><MessageCircle className="h-6 w-6 -scale-x-100" aria-hidden /></button>}
        {post.status === 'publicado' && <button type="button" aria-label="Enviar por mensagem" className="rounded-sm p-2 text-ink hover:bg-surface-2" onClick={() => setShare(true)}><Send className="h-6 w-6" aria-hidden /></button>}
        <button type="button" className="ml-auto rounded-sm p-2 hover:bg-surface-2" aria-label={post.saved ? 'Salva' : 'Salvar'} aria-pressed={post.saved} onClick={() => save.mutate()}>
          <Bookmark className={clsx('h-6 w-6', post.saved ? 'fill-ink text-ink' : 'text-ink')} aria-hidden />
        </button>
      </footer>
      {post.reactionCount > 0 && (
        <p className="px-4 text-sm font-semibold text-ink"><span aria-hidden>{top.map((r) => r.emoji).join('')} </span>{post.reactionCount} {post.reactionCount === 1 ? 'reação' : 'reações'}</p>
      )}
      {!textOnly && caption}
      {files.length > 0 && (
        <ul className="space-y-1 px-4 pt-2">{files.map((m) => (
          <li key={m.id}><a href={mediaUrl(m.id)} className="flex items-center gap-2 border border-line px-3 py-2 text-sm hover:bg-surface-2"><FileText className="h-4 w-4 text-primary" aria-hidden /><span className="min-w-0 flex-1 truncate text-ink">{m.filename}</span><span className="text-xs text-muted">{fmtBytes(m.sizeBytes)}</span><Download className="h-4 w-4 text-muted" aria-hidden /></a></li>
        ))}</ul>
      )}
      {/* comentários no próprio feed: recolhidos (2 últimos), "ver todos" abre ali mesmo */}
      {!detail && !comments && post.commentCount > 0 && (
        <button type="button" className="block px-4 pt-1 text-left text-sm text-muted hover:text-ink" onClick={() => setComments(true)}>{post.commentCount === 1 ? 'Ver 1 comentário' : `Ver todos os ${post.commentCount} comentários`}</button>
      )}
      {!detail && comments && <div className="px-4 pt-2" role="region" aria-label="Comentários"><CommentsThread key={focus} postId={post.id} collapsed autoFocus={focus > 0} /></div>}
      <p className="px-4 pb-3 pt-1 text-2xs uppercase tracking-wide text-muted">{fmtRelative(at)}</p>
      <style>{`@keyframes ig-heart { 0% { transform: translate(-50%,-50%) scale(0); opacity: 0 } 15% { transform: translate(-50%,-50%) scale(1.2); opacity: .95 } 30% { transform: translate(-50%,-50%) scale(.95) } 45%,80% { transform: translate(-50%,-50%) scale(1); opacity: .95 } 100% { transform: translate(-50%,-50%) scale(1); opacity: 0 } } .ig-heart { animation: ig-heart 1s ease-out forwards } @media (prefers-reduced-motion: reduce) { .ig-heart { animation: none; opacity: 0 } }`}</style>
      <ConfirmDialog open={confirmDel} title="Excluir publicação" tone="danger" confirmLabel="Excluir" loading={del.isPending} onCancel={() => setConfirmDel(false)} onConfirm={() => del.mutate()}>
        <p>A publicação sai do feed para todos, com os comentários e reações. Esta ação não pode ser desfeita por você.</p>
      </ConfirmDialog>
      <ReportDialog target={report ? { targetType: 'publicacao', targetId: post.id } : null} onClose={() => setReport(false)} />
      {share && <ShareDialog postId={post.id} open={share} onClose={() => setShare(false)} />}
    </article>
  );
}
