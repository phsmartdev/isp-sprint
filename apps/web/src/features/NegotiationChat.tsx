/** Chat interno da negociação: mensagens do time, menções com @, separador de novas e leitura automática. */
import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { MessageSquare, Send } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';
import { errMsg } from './contracts/shared';
import { MentionInput, WithMentions, mentionsIn, type Participant } from './MentionInput';

export type ChatMessage = { id: string; kind: 'mensagem' | 'sistema'; body: string; authorId: string | null; authorName: string | null; requestId: string | null; createdAt: string; mentions: { id: string; name: string }[] };

export const useUnread = (oppId: string) => useQuery({ queryKey: ['unread', oppId], queryFn: () => api<{ chat: number; comments: number; mentions: number }>(`/opportunities/${oppId}/unread`), refetchInterval: 30_000 });

export function NegotiationChat({ oppId, title = true, className }: { oppId: string; title?: boolean; className?: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Participant[]>([]);
  const q = useQuery({ queryKey: ['chat', oppId], queryFn: () => api<{ items: ChatMessage[]; lastReadAt: string | null }>(`/opportunities/${oppId}/chat`), refetchInterval: 15_000 });
  // separador "novas": fixo na abertura, para não pular enquanto a pessoa lê
  const [seenAt, setSeenAt] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (q.data && seenAt === undefined) setSeenAt(q.data.lastReadAt); }, [q.data, seenAt]);
  const read = useMutation({ mutationFn: () => api(`/opportunities/${oppId}/read`, { method: 'POST' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['unread', oppId] }); qc.invalidateQueries({ queryKey: ['mentions'] }); } });
  const count = q.data?.items.length ?? 0;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!count) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    if (!document.hidden) read.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
  const send = useMutation({
    mutationFn: () => api(`/opportunities/${oppId}/chat`, { method: 'POST', body: { body: text.trim(), mentions: mentionsIn(text, picked) } }),
    onSuccess: () => { setText(''); setPicked([]); setSeenAt(new Date().toISOString()); qc.invalidateQueries({ queryKey: ['chat', oppId] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const submit = () => { if (text.trim() && !send.isPending) send.mutate(); };
  const items = q.data?.items ?? [];
  const firstNew = seenAt === undefined ? -1 : items.findIndex((m) => m.kind === 'mensagem' && m.authorId !== me?.user.id && (!seenAt || m.createdAt > seenAt));
  return (
    <section className={clsx('flex flex-col', className)} aria-label="Chat da negociação">
      {title && <h2 className="flex items-center gap-2 px-5 pb-2 pt-4 text-md font-bold text-ink"><MessageSquare className="h-5 w-5 text-primary" aria-hidden />Chat da negociação</h2>}
      <ol ref={listRef} className="scroll-thin min-h-[160px] flex-1 space-y-2 overflow-y-auto px-5 pb-3" aria-live="polite">
        {items.length === 0 && !q.isLoading && <li className="text-sm text-muted">Converse com o time sobre esta negociação. Use @ para chamar alguém. Nada aqui vai para o cliente.</li>}
        {items.map((m, i) => (
          <Fragment key={m.id}>
            {i === firstNew && <li className="flex items-center gap-2 py-1 text-2xs font-bold uppercase tracking-wide text-primary" aria-label="Mensagens novas"><span className="h-px flex-1 bg-primary/40" />Novas<span className="h-px flex-1 bg-primary/40" /></li>}
            {m.kind === 'sistema' ? (
              <li className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted"><span className="num">{fmtDateTime(m.createdAt)}</span> · {m.body}</li>
            ) : (
              <li className={clsx('max-w-[88%] rounded-lg px-3 py-2 text-sm', m.authorId === me?.user.id ? 'ml-auto bg-primary text-white' : m.mentions.some((x) => x.id === me?.user.id) ? 'bg-[#FFF6D6] text-ink ring-1 ring-[#F5B400]' : 'bg-primary-soft text-ink')}>
                <p className={clsx('text-2xs font-semibold', m.authorId === me?.user.id ? 'text-white/80' : 'text-muted')}>{m.authorName} · {fmtDateTime(m.createdAt)}</p>
                <p className="whitespace-pre-wrap break-words"><WithMentions text={m.body} names={m.mentions.map((x) => x.name)} mine={me?.user.name} /></p>
              </li>
            )}
          </Fragment>
        ))}
      </ol>
      <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <MentionInput oppId={oppId} value={text} onChange={setText} picked={picked} onPick={(p) => setPicked((x) => [...x, p])} onSubmit={submit} enterSends label="Mensagem para o time" placeholder="Escreva para o time… use @ para mencionar" rows={1} />
        <Button type="submit" variant="primary" aria-label="Enviar mensagem" loading={send.isPending} icon={<Send className="h-4 w-4" />} />
      </form>
      <p className="px-3 pb-2 text-2xs text-faint">Enter envia · Shift+Enter quebra linha · quem é mencionado recebe aviso</p>
    </section>
  );
}
