/** E-mail que deu origem à negociação: a conversa e a resposta, que sai pela mesma caixa e na mesma conversa. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Mail, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, LoadingRows, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { EmailViewer } from './EmailViewer';

export type OriginThread = {
  id: string; subject: string; mailbox: string; originalAttachmentId: string | null; mailboxKind: string; mailboxConnected: boolean; canReply: boolean;
  messages: { id: string; direction: string; from: string; fromName: string | null; to: string[]; cc: string[]; sentAt: string; text: string; hasAttachments: boolean; sentBy: string | null }[];
};
export const useOriginEmail = (oppId: string) => useQuery({ queryKey: ['origin-email', oppId], queryFn: () => api<{ thread: OriginThread | null }>(`/opportunities/${oppId}/origin-email`) });

export function OriginEmail({ oppId }: { oppId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useOriginEmail(oppId);
  const [text, setText] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  const [withSig, setWithSig] = useState(true);
  const reply = useMutation({
    mutationFn: () => api(`/opportunities/${oppId}/origin-email/reply`, { method: 'POST', body: { text, signature: withSig } }),
    onSuccess: () => { setText(''); toast({ tone: 'success', message: 'Resposta enviada pelo e-mail de origem' }); void qc.invalidateQueries({ queryKey: ['origin-email', oppId] }); void qc.invalidateQueries({ queryKey: ['timeline', oppId] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <LoadingRows rows={3} />;
  const t = q.data?.thread;
  if (!t) return null;
  return (
    <section aria-label="E-mail de origem" className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-md font-bold text-ink"><Mail className="h-5 w-5 text-primary" aria-hidden />{t.subject || '(sem assunto)'}</h3>
        <p className="text-sm text-muted">Conversa da caixa {t.mailbox}. A resposta sai por ela, na mesma conversa com o cliente.</p>
        {t.originalAttachmentId && <Button size="sm" variant="outline" className="mt-2" icon={<Mail className="h-4 w-4" />} onClick={() => setViewing(t.originalAttachmentId)}>Ver e-mail original</Button>}
        <EmailViewer oppId={oppId} attachmentId={viewing} onClose={() => setViewing(null)} />
      </div>
      <ol className="space-y-2">
        {t.messages.map((m) => (
          <li key={m.id} className={clsx('border p-3', m.direction === 'saida' ? 'ml-6 border-primary/20 bg-primary-soft/40' : 'mr-6 border-line bg-surface')}>
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
              <span><b className="text-ink">{m.direction === 'saida' ? (m.sentBy ?? m.fromName ?? m.from) : (m.fromName ?? m.from)}</b>{m.direction === 'entrada' && m.fromName ? ` <${m.from}>` : ''} para {m.to.join(', ')}{m.cc.length ? ` · cc ${m.cc.join(', ')}` : ''}</span>
              <time className="num" dateTime={m.sentAt}>{fmtDateTime(m.sentAt)}</time>
            </p>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-text">{m.text}</p>
          </li>
        ))}
      </ol>
      {t.canReply ? (
        <div className="space-y-2">
          <Textarea aria-label="Resposta ao e-mail de origem" value={text} placeholder="Escreva a resposta ao cliente" onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center justify-end gap-2"><label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={withSig} onChange={(e) => setWithSig(e.target.checked)} />Incluir assinatura</label><Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={!text.trim()} loading={reply.isPending} onClick={() => reply.mutate()}>Responder e-mail</Button></div>
        </div>
      ) : (
        <p className="bg-surface-2 px-3 py-2 text-sm text-muted">{!t.mailboxConnected ? `A caixa ${t.mailbox} não está conectada; a resposta volta a funcionar quando ela for reconectada.` : `Só quem atende a caixa ${t.mailbox} responde por ela.`}</p>
      )}
    </section>
  );
}
