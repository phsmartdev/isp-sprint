/** Comentário com @ num item (contrato, conta, projeto): cada pessoa mencionada recebe um pedido de apoio ligado ao item. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SUPPORT_STATUS_LABELS, type SupportStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { fmtRelative } from '../../lib/format';
import { Button, LoadingRows } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { MentionInput, mentionsIn, type Participant } from '../MentionInput';
import { errMsg } from '../contracts/shared';

type Entity = 'contrato' | 'conta' | 'projeto' | 'oportunidade' | 'tarefa';
type Item = { id: string; title: string; description: string | null; status: SupportStatus; createdAt: string; requester: string | null; target: string | null; helper: string | null; doneNote: string | null };

export function EntitySupport({ entityType, entityId }: { entityType: Entity; entityId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useLookups().data?.users ?? [];
  const people: Participant[] = users.map((u) => ({ id: u.id, name: u.name, jobTitle: null, hasAvatar: u.hasAvatar }));
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Participant[]>([]);
  const key = ['apoio', 'item', entityType, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ items: Item[] }>(`/apoio/item/${entityType}/${entityId}`) });
  const ids = mentionsIn(text, picked);
  const send = useMutation({
    mutationFn: () => api<{ ids: string[] }>('/apoio/mencao', { method: 'POST', body: { entityType, entityId, text: text.trim(), userIds: ids } }),
    onSuccess: (r) => { setText(''); setPicked([]); void qc.invalidateQueries({ queryKey: ['apoio'] }); toast({ tone: 'success', message: r.ids.length === 1 ? 'Pedido de apoio enviado' : `${r.ids.length} pedidos de apoio enviados` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section aria-label="Comentários e apoio" className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-ink">Comentários e apoio</h2>
        <p className="text-sm text-muted">Use @ para chamar alguém: cada pessoa mencionada recebe um pedido de apoio ligado a este item e acompanha em Pedidos de apoio.</p>
      </div>
      <MentionInput people={people} value={text} onChange={setText} picked={picked} onPick={(p) => setPicked((x) => [...x, p])} label="Comentário" placeholder="Ex.: @Maria pode revisar a cláusula de reajuste?" rows={3} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{ids.length ? `Vai para: ${picked.filter((p) => ids.includes(p.id)).map((p) => p.name).join(', ')}` : 'Mencione ao menos uma pessoa com @.'}</p>
        <Button variant="primary" size="sm" disabled={!ids.length || text.trim().length < 3} loading={send.isPending} onClick={() => send.mutate()}>Enviar pedido de apoio</Button>
      </div>
      {q.isLoading ? <LoadingRows rows={2} /> : !q.data?.items.length ? <p className="text-sm text-muted">Nenhum comentário ou pedido de apoio neste item.</p> : (
        <ul className="divide-y divide-line border-y border-line">
          {q.data.items.map((r) => (
            <li key={r.id} className="py-2.5">
              <p className="text-xs text-muted"><b className="text-ink">{r.requester}</b> pediu a {r.target ?? 'um time'} · {fmtRelative(r.createdAt)} · <span className="font-semibold">{SUPPORT_STATUS_LABELS[r.status]}</span>{r.helper && r.status !== 'aberto' ? ` · apoio de ${r.helper}` : ''}</p>
              <p className="whitespace-pre-line text-sm text-ink">{r.description ?? r.title}</p>
              {r.doneNote && <p className="mt-1 border-l-2 border-line pl-2 text-sm text-text">{r.doneNote}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
