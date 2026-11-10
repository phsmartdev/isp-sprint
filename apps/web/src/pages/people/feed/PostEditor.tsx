/**
 * Editor de publicações (reutilizável): texto com formatação e menções, fotos, vídeos e documentos com pré-visualização,
 * remoção antes de publicar, rascunho e, só para quem tem o papel de Comunicação, publicar em nome da empresa.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ImagePlus, Loader2, Paperclip, Video, X } from 'lucide-react';
import { api } from '../../../lib/api';
import { fmtBytes } from '../../../lib/files';
import { Avatar, Button } from '../../../components/ui/primitives';
import { useToast } from '../../../components/ui/overlay';
import { MentionInput, mentionsIn, type MentionHandle, type Participant } from '../../../features/MentionInput';
import { FormatToolbar, formatShortcut, hasFormatting, RichText } from '../../../features/RichText';
import { errMsg } from '../../../features/contracts/shared';
import { usePeopleMe, type PersonCard } from '../shared';
import { mediaUrl, uploadMedia, useDrafts, type FeedPost, type Media } from './api';

type Item = { key: string; media?: Media; preview?: string; name: string; kind: Media['kind']; progress?: number; error?: string };
const kindOf = (f: File): Media['kind'] => (f.type.startsWith('image/') ? 'imagem' : f.type.startsWith('video/') ? 'video' : 'arquivo');

export function usePeoplePeople() {
  return useQuery({
    queryKey: ['pessoas', 'colaboradores', 'todos'], staleTime: 5 * 60_000,
    queryFn: async () => (await api<{ items: PersonCard[] }>('/pessoas/colaboradores?limit=300')).items.map((p): Participant => ({ id: p.id, name: p.name, jobTitle: p.jobTitle, hasAvatar: p.hasPhoto })),
  });
}

export function PostEditor({ initial, onDone, compact = false }: { initial?: FeedPost; onDone?: () => void; compact?: boolean }) {
  const me = usePeopleMe().data;
  const people = usePeoplePeople().data ?? [];
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(initial?.body ?? '');
  const [picked, setPicked] = useState<Participant[]>(() => (initial?.mentions ?? []).map((m) => ({ id: m.id, name: m.name, jobTitle: null, hasAvatar: false })));
  const [items, setItems] = useState<Item[]>(() => (initial?.media ?? []).map((m) => ({ key: m.id, media: m, name: m.filename, kind: m.kind, preview: m.kind === 'imagem' ? mediaUrl(m.id) : undefined })));
  const [asCompany, setAsCompany] = useState(initial?.kind === 'institucional');
  const [open, setOpen] = useState(!!initial || !compact);
  const mention = useRef<MentionHandle>(null);
  const taRef = useMemo(() => ({ get current() { return mention.current?.textarea() ?? null; } }), []);
  const fileIn = useRef<HTMLInputElement>(null);
  const limits = me?.limits ?? { imageMb: 5, videoMb: 50, mediaPerPost: 6, postChars: 3000 };
  const busy = items.some((i) => i.progress !== undefined && !i.media && !i.error);
  const editingPublished = initial?.status === 'publicado';

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = limits.mediaPerPost - items.length;
    if (files.length > room) toast({ tone: 'error', message: `No máximo ${limits.mediaPerPost} mídias por publicação.` });
    for (const f of [...files].slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      const kind = kindOf(f);
      const it: Item = { key, name: f.name, kind, progress: 0, preview: kind !== 'arquivo' ? URL.createObjectURL(f) : undefined };
      setItems((xs) => [...xs, it]);
      uploadMedia(f, limits, (p) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, progress: p } : x))))
        .then((m) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, media: m, progress: undefined } : x))))
        .catch((e) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, error: errMsg(e), progress: undefined } : x))));
    }
  };
  const remove = (it: Item) => {
    setItems((xs) => xs.filter((x) => x.key !== it.key));
    // mídia enviada e ainda solta é descartada no servidor (a já publicada só sai ao salvar a edição)
    if (it.media && !initial?.media.some((m) => m.id === it.media!.id)) void api(`/pessoas/midias/${it.media.id}`, { method: 'DELETE' }).catch(() => {});
  };
  const reset = () => { setText(''); setPicked([]); setItems([]); setAsCompany(false); if (compact) setOpen(false); };
  const body = (status: 'publicado' | 'rascunho') => ({ body: text.trim(), mediaIds: items.filter((i) => i.media).map((i) => i.media!.id), mentions: mentionsIn(text, picked), kind: asCompany ? 'institucional' : 'social', ...(editingPublished ? {} : { status }) });
  const send = useMutation({
    mutationFn: (status: 'publicado' | 'rascunho') => initial
      ? api<FeedPost>(`/pessoas/posts/${initial.id}`, { method: 'PATCH', body: body(status) })
      : api<FeedPost>('/pessoas/posts', { method: 'POST', body: body(status) }),
    onSuccess: (_p, status) => {
      void qc.invalidateQueries({ queryKey: ['pessoas', 'feed'] });
      void qc.invalidateQueries({ queryKey: ['pessoas', 'rascunhos'] });
      if (initial) void qc.invalidateQueries({ queryKey: ['pessoas', 'post', initial.id] });
      toast({ tone: 'success', message: editingPublished ? 'Publicação atualizada' : status === 'rascunho' ? 'Rascunho salvo' : 'Publicado!' });
      reset();
      onDone?.();
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const empty = !text.trim() && !items.some((i) => i.media);
  const over = text.length > limits.postChars;

  if (!open) {
    return (
      <section className="card flex items-center gap-3 p-4" aria-label="Nova publicação">
        {me && <Avatar name={me.me.name} userId={me.me.id} hasPhoto={me.me.hasPhoto} size={40} />}
        <button type="button" className="h-11 flex-1 rounded-sm border border-line bg-surface-2 px-4 text-left text-sm text-muted hover:border-primary" onClick={() => setOpen(true)}>Compartilhe algo com os colegas…</button>
        <button type="button" className="rounded-sm p-2 text-primary hover:bg-surface-2" aria-label="Adicionar foto ou vídeo" onClick={() => { setOpen(true); setTimeout(() => fileIn.current?.click(), 0); }}><ImagePlus className="h-5 w-5" /></button>
        <input ref={fileIn} type="file" multiple className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.pdf,.docx,.xlsx,.pptx" onChange={(e) => { setOpen(true); addFiles(e.target.files); e.target.value = ''; }} />
      </section>
    );
  }
  return (
    <section className="card p-4" aria-label={initial ? 'Editar publicação' : 'Nova publicação'}>
      <div className="mb-2 flex items-center gap-3">
        {me && <Avatar name={asCompany ? 'Empresa' : me.me.name} userId={asCompany ? undefined : me.me.id} hasPhoto={!asCompany && me.me.hasPhoto} size={36} />}
        <div className="min-w-0 flex-1 text-sm"><span className="font-semibold text-ink">{asCompany ? 'Publicação institucional' : me?.me.name}</span><span className="block text-xs text-muted">Visível para toda a empresa</span></div>
        {!initial && <DraftsButton />}
      </div>
      <FormatToolbar target={taRef} onChange={setText} disabled={send.isPending} />
      <MentionInput ref={mention} people={people} value={text} onChange={setText} picked={picked} onPick={(p) => setPicked((x) => [...x, p])} label="Texto da publicação" placeholder="Compartilhe uma conquista, uma ideia, um aprendizado… use @ para mencionar colegas" rows={compact ? 3 : 4} maxLength={5000} onKeyDownExtra={(e) => formatShortcut(e, setText)} />
      <p className={`mt-1 text-right text-2xs ${over ? 'text-danger' : 'text-muted'}`}>{text.length}/{limits.postChars}</p>
      {hasFormatting(text) && <div className="mt-1 rounded-sm border border-dashed border-line px-3 py-2" aria-label="Pré-visualização"><RichText text={text} names={picked.map((p) => p.name)} /></div>}

      {items.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Mídias da publicação">
          {items.map((it) => (
            <li key={it.key} className="relative overflow-hidden border border-line bg-surface-2">
              {it.kind === 'imagem' && it.preview ? <img src={it.preview} alt={it.name} className="h-28 w-full object-cover" />
                : it.kind === 'video' && it.preview ? <video src={it.preview} className="h-28 w-full object-cover" muted aria-label={it.name} />
                : <div className="flex h-28 flex-col items-center justify-center gap-1 px-2 text-center text-xs text-text"><FileText className="h-6 w-6 text-primary" aria-hidden /><span className="line-clamp-2 break-all">{it.name}</span>{it.media && <span className="text-muted">{fmtBytes(it.media.sizeBytes)}</span>}</div>}
              {it.progress !== undefined && !it.media && !it.error && <span className="absolute inset-0 flex items-center justify-center gap-1 bg-ink/50 text-xs font-semibold text-white"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{Math.round(it.progress * 100)}%</span>}
              {it.error && <span className="absolute inset-x-0 bottom-0 bg-danger px-2 py-1 text-2xs text-white">{it.error}</span>}
              <button type="button" className="absolute right-1 top-1 rounded-circle bg-ink/70 p-1 text-white hover:bg-ink" aria-label={`Remover ${it.name}`} onClick={() => remove(it)}><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button size="sm" variant="ghost" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileIn.current?.click()}>Foto</Button>
        <Button size="sm" variant="ghost" icon={<Video className="h-4 w-4" />} onClick={() => fileIn.current?.click()}>Vídeo</Button>
        <Button size="sm" variant="ghost" icon={<Paperclip className="h-4 w-4" />} onClick={() => fileIn.current?.click()}>Anexo</Button>
        <input ref={fileIn} type="file" multiple className="sr-only" aria-label="Escolher fotos, vídeos ou anexos" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.pdf,.docx,.xlsx,.pptx" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        {me?.caps.communicate && (
          <label className="ml-1 flex items-center gap-2 text-sm text-text"><input type="checkbox" className="h-4 w-4 accent-primary" checked={asCompany} onChange={(e) => setAsCompany(e.target.checked)} />Publicar em nome da empresa</label>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {(compact || initial) && <Button size="sm" onClick={() => { if (!initial) { items.forEach((i) => i.media && remove(i)); reset(); } onDone?.(); }}>Cancelar</Button>}
          {!editingPublished && <Button size="sm" variant="secondary" disabled={empty || busy || over} loading={send.isPending && send.variables === 'rascunho'} onClick={() => send.mutate('rascunho')}>Salvar rascunho</Button>}
          <Button size="sm" variant="primary" disabled={empty || busy || over} loading={send.isPending && send.variables === 'publicado'} onClick={() => send.mutate('publicado')}>{editingPublished ? 'Salvar alterações' : 'Publicar'}</Button>
        </div>
      </div>
      {busy && <p className="mt-2 text-xs text-muted">Enviando mídias… a publicação libera quando terminar.</p>}
    </section>
  );
}

/** Rascunhos salvos: abre um deles no editor para continuar. */
function DraftsButton() {
  const q = useDrafts();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FeedPost | null>(null);
  const n = q.data?.items.length ?? 0;
  if (!n && !editing) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>Rascunhos ({n})</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-20" role="dialog" aria-modal="true" aria-label="Rascunhos">
          <div className="w-full max-w-2xl space-y-3">
            {editing ? <PostEditor initial={editing} onDone={() => { setEditing(null); setOpen(false); }} /> : (
              <section className="card p-4">
                <div className="mb-2 flex items-center justify-between"><h2 className="text-md font-bold text-ink">Meus rascunhos</h2><Button size="sm" onClick={() => setOpen(false)}>Fechar</Button></div>
                <ul className="divide-y divide-line">{q.data?.items.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1 truncate text-sm text-ink">{d.body || `${d.media.length} mídia(s)`}</span><Button size="sm" variant="secondary" onClick={() => setEditing(d)}>Continuar</Button></li>
                ))}</ul>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}

