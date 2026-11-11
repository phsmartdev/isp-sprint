/** Minhas denúncias e decisões sobre o meu conteúdo (quem denunciou nunca aparece). Revisão: uma vez, em até 30 dias. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, LoadingRows, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Mine = { id: string; targetType: string; reasonLabel: string; excerpt: string; status: string; measureLabel: string | null; justification: string | null; createdAt: string; decidedAt: string | null; canRequestReview: boolean };
type About = { id: string; targetType: string; excerpt: string; measureLabel: string; justification: string | null; status: string; decidedAt: string; canRequestReview: boolean };
const STATUS: Record<string, { label: string; tone: Tone }> = {
  aberta: { label: 'Recebida', tone: 'neutral' }, em_analise: { label: 'Em análise', tone: 'blue' }, decidida: { label: 'Decidida', tone: 'green' }, em_revisao: { label: 'Em revisão', tone: 'orange' }, revisada: { label: 'Revista', tone: 'green' },
};
const TYPE: Record<string, string> = { publicacao: 'Publicação', comentario: 'Comentário', reconhecimento: 'Reconhecimento' };

export function MyReportsPage() {
  const q = useQuery({ queryKey: ['pessoas', 'denuncias', 'minhas'], queryFn: () => api<{ reports: Mine[]; aboutMe: About[] }>('/pessoas/denuncias') });
  const [tab, setTab] = useState<'feitas' | 'sobre'>('feitas');
  const [review, setReview] = useState<string | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const list = tab === 'feitas' ? q.data!.reports : q.data!.aboutMe;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <p className="text-sm text-muted">A moderação analisa cada denúncia, registra a decisão com justificativa e avisa as pessoas envolvidas. Casos confidenciais (assédio, discriminação) também podem ir ao Canal de Confiança.</p>
      <div role="tablist" aria-label="Denúncias" className="flex w-fit border border-line bg-surface text-sm">
        <button role="tab" type="button" aria-selected={tab === 'feitas'} onClick={() => setTab('feitas')} className={clsx('px-3 py-1.5', tab === 'feitas' ? 'bg-primary text-white' : 'hover:bg-surface-2')}>Minhas denúncias ({q.data!.reports.length})</button>
        <button role="tab" type="button" aria-selected={tab === 'sobre'} onClick={() => setTab('sobre')} className={clsx('px-3 py-1.5', tab === 'sobre' ? 'bg-primary text-white' : 'hover:bg-surface-2')}>Sobre meu conteúdo ({q.data!.aboutMe.length})</button>
      </div>
      {!list.length ? <div className="card"><EmptyState title={tab === 'feitas' ? 'Você não fez denúncias' : 'Nenhuma medida sobre o seu conteúdo'} description={tab === 'feitas' ? 'Para denunciar, use o menu “…” de uma publicação ou o link “Denunciar” de um comentário.' : 'Quando a moderação aplicar uma medida a algo seu, o motivo aparece aqui.'} /></div> : (
        <ul className="space-y-2">{list.map((r) => (
          <li key={r.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Chip>{TYPE[r.targetType] ?? r.targetType}</Chip>
              <Chip tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Chip>
              {'reasonLabel' in r && <span>Motivo: {r.reasonLabel}</span>}
              <span className="ml-auto">{fmtDateTime(('createdAt' in r ? r.createdAt : r.decidedAt)!)}</span>
            </div>
            <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm text-text">{r.excerpt || '(sem texto)'}</blockquote>
            {r.measureLabel && <p className="mt-2 text-sm"><b className="text-ink">Decisão:</b> {r.measureLabel}{r.justification && <> — <span className="text-text">{r.justification}</span></>}</p>}
            {r.canRequestReview && <div className="mt-2"><Button size="sm" onClick={() => setReview(r.id)}>Pedir revisão</Button></div>}
          </li>
        ))}</ul>
      )}
      <ReviewModal id={review} onClose={() => setReview(null)} />
    </div>
  );
}

function ReviewModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const send = useMutation({
    mutationFn: () => api(`/pessoas/denuncias/${id}/revisao`, { method: 'POST', body: { reason } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas', 'denuncias'] }); toast({ tone: 'success', message: 'Pedido de revisão enviado. Outra pessoa da moderação vai analisar.' }); setReason(''); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!id} onClose={onClose} title="Pedir revisão da decisão" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={send.isPending} disabled={reason.trim().length < 10} onClick={() => send.mutate()}>Enviar pedido</Button></>}>
      <label htmlFor="rv-reason" className="mb-1 block text-sm font-semibold text-ink">Por que a decisão deve ser revista?</label>
      <Textarea id="rv-reason" rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="mt-1 text-xs text-muted">A revisão é feita por outra pessoa da moderação e pode ser pedida uma vez.</p>
    </Modal>
  );
}
