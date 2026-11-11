/**
 * Fila de moderação: triagem (assumir), análise sobre a cópia do item denunciado, decisão com justificativa,
 * medida aplicada e trilha completa. Quem está envolvido (autor ou quem denunciou) não decide.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { History, ShieldAlert } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, Input, LoadingRows, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { useReportOptions } from './Report';

type Row = {
  id: string; targetType: string; targetId: string; postId: string | null; community: { id: string; name: string } | null;
  author: { id: string; name: string }; reporter: { id: string; name: string }; reason: string; reasonLabel: string; details: string | null;
  snapshot: { body: string; createdAt: string | null; kind?: string }; status: string; assignee: { id: string; name: string } | null;
  measure: string | null; measureLabel: string | null; justification: string | null; forwardedTo: string | null; decidedBy: string | null; decidedAt: string | null;
  reviewReason: string | null; createdAt: string; sameTarget: number; contentStatus: string; conflict: boolean;
};
const STATUS: Record<string, { label: string; tone: Tone }> = { aberta: { label: 'Nova', tone: 'red' }, em_analise: { label: 'Em análise', tone: 'blue' }, em_revisao: { label: 'Revisão pedida', tone: 'orange' }, decidida: { label: 'Decidida', tone: 'green' }, revisada: { label: 'Revista', tone: 'green' } };
const CONTENT: Record<string, string> = { publicado: 'No ar', oculto: 'Oculto', removido: 'Removido', excluido: 'Excluído pelo autor' };
const TYPE: Record<string, string> = { publicacao: 'Publicação', comentario: 'Comentário', reconhecimento: 'Reconhecimento' };
const ACTION: Record<string, string> = { registro: 'Denúncia registrada', triagem: 'Assumiu a análise', decisao: 'Decisão', pedido_revisao: 'Pedido de revisão', revisao: 'Revisão', acao_direta: 'Ação direta', edicao_autor: 'Autor editou' };

export function AdminModerationPage() {
  const [sit, setSit] = useState<'pendentes' | 'decididas' | 'todas'>('pendentes');
  const q = useQuery({ queryKey: ['pessoas', 'moderacao', sit], queryFn: () => api<{ items: Row[] }>(`/pessoas/moderacao/denuncias${qs({ situacao: sit })}`) });
  const [deciding, setDeciding] = useState<Row | null>(null);
  const [hist, setHist] = useState<Row | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const take = useMutation({ mutationFn: (id: string) => api(`/pessoas/moderacao/denuncias/${id}/assumir`, { method: 'POST' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas', 'moderacao'] }); toast({ tone: 'success', message: 'Denúncia assumida' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Situação" className="flex border border-line bg-surface text-sm">
          {(['pendentes', 'decididas', 'todas'] as const).map((s) => <button key={s} role="tab" type="button" aria-selected={sit === s} onClick={() => setSit(s)} className={clsx('px-3 py-1.5 capitalize', sit === s ? 'bg-primary text-white' : 'hover:bg-surface-2')}>{s}</button>)}
        </div>
        <p className="text-xs text-muted">Você vê só o item denunciado, como estava quando foi denunciado. Não substitui o Canal de Confiança nem o CIEI.</p>
      </div>
      {q.isLoading ? <div className="card"><LoadingRows rows={5} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? (
        <div className="card"><EmptyState title={sit === 'pendentes' ? 'Nenhuma denúncia pendente' : 'Nada por aqui'} description="As denúncias de publicações, comentários e reconhecimentos chegam aqui." /></div>
      ) : (
        <ul className="space-y-2">{q.data!.items.map((r) => (
          <li key={r.id} className="card p-4" aria-label={`Denúncia de ${TYPE[r.targetType]}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Chip tone={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Chip>
              <Chip>{TYPE[r.targetType]}</Chip>
              <Chip tone={r.reason === 'assedio' ? 'red' : 'neutral'}>{r.reasonLabel}</Chip>
              {r.sameTarget > 1 && <Chip tone="purple">{r.sameTarget} denúncias sobre este conteúdo</Chip>}
              <span className="text-muted">Conteúdo: {CONTENT[r.contentStatus] ?? r.contentStatus}</span>
              <span className="ml-auto text-muted" title={fmtDateTime(r.createdAt)}>{fmtRelative(r.createdAt)}</span>
            </div>
            <blockquote className="mt-2 whitespace-pre-wrap border-l-4 border-line bg-surface-2 px-3 py-2 text-sm text-ink">{r.snapshot.body || '(sem texto: só mídia)'}</blockquote>
            <p className="mt-2 text-xs text-muted">
              Autor: <b className="text-ink">{r.author.name}</b> · Denunciado por: <b className="text-ink">{r.reporter.name}</b> (não é mostrado ao autor){r.community && <> · Comunidade: {r.community.name}</>}
              {r.postId && r.targetType !== 'reconhecimento' && !r.community && <> · <Link className="text-primary hover:underline" to={`/pessoas/publicacao/${r.postId}`}>abrir</Link></>}
            </p>
            {r.details && <p className="mt-1 text-sm text-text"><b>Detalhe:</b> {r.details}</p>}
            {r.reviewReason && <p className="mt-1 text-sm text-text"><b>Pedido de revisão:</b> {r.reviewReason}</p>}
            {r.measureLabel && <p className="mt-1 text-sm text-text"><b>Decisão{r.decidedBy ? ` (${r.decidedBy})` : ''}:</b> {r.measureLabel} — {r.justification}{r.forwardedTo && <> · Encaminhado para {r.forwardedTo}</>}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {r.conflict ? <span className="flex items-center gap-1 text-xs text-muted"><ShieldAlert className="h-4 w-4" aria-hidden />Você está envolvido: outra pessoa da moderação decide.</span> : <>
                {['aberta', 'em_analise', 'em_revisao'].includes(r.status) && !r.assignee && <Button size="sm" loading={take.isPending && take.variables === r.id} onClick={() => take.mutate(r.id)}>Assumir</Button>}
                {['aberta', 'em_analise', 'em_revisao'].includes(r.status) && <Button size="sm" variant="primary" onClick={() => setDeciding(r)}>{r.status === 'em_revisao' ? 'Revisar' : 'Decidir'}</Button>}
              </>}
              {r.assignee && <span className="text-xs text-muted">Com {r.assignee.name}</span>}
              <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => setHist(r)}>Histórico</Button>
            </div>
          </li>
        ))}</ul>
      )}
      <DecisionModal row={deciding} onClose={() => setDeciding(null)} />
      <HistoryModal row={hist} onClose={() => setHist(null)} />
    </div>
  );
}

function DecisionModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const opts = useReportOptions();
  const [measure, setMeasure] = useState('');
  const [just, setJust] = useState('');
  const [fwd, setFwd] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const send = useMutation({
    mutationFn: () => api<{ reports: number }>(`/pessoas/moderacao/denuncias/${row!.id}/decisao`, { method: 'POST', body: { measure, justification: just, forwardedTo: measure === 'encaminhar' ? fwd : null } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: r.reports > 1 ? `Decisão registrada para ${r.reports} denúncias deste conteúdo` : 'Decisão registrada' }); setMeasure(''); setJust(''); setFwd(''); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!row} onClose={onClose} title={row?.status === 'em_revisao' ? 'Revisar decisão' : 'Decidir denúncia'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={send.isPending} disabled={!measure || just.trim().length < 10 || (measure === 'encaminhar' && !fwd.trim())} onClick={() => send.mutate()}>Registrar decisão</Button></>}>
      <fieldset className="space-y-1.5">
        <legend className="mb-2 text-sm font-semibold text-ink">Medida</legend>
        {(opts.data?.measures ?? []).map((m) => (
          <label key={m.key} className={clsx('flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm', measure === m.key ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2')}>
            <input type="radio" name="medida" className="accent-primary" checked={measure === m.key} onChange={() => setMeasure(m.key)} />{m.label}
          </label>
        ))}
      </fieldset>
      {measure === 'encaminhar' && <div className="mt-3"><label htmlFor="dc-fwd" className="mb-1 block text-sm font-semibold text-ink">Encaminhado para</label><Input id="dc-fwd" maxLength={200} placeholder="Ex.: Canal de Confiança (CIEI), Pessoas e Cultura" value={fwd} onChange={(e) => setFwd(e.target.value)} /></div>}
      <label htmlFor="dc-just" className="mb-1 mt-3 block text-sm font-semibold text-ink">Justificativa (vai para o autor quando há medida)</label>
      <Textarea id="dc-just" rows={4} maxLength={2000} value={just} onChange={(e) => setJust(e.target.value)} />
      <p className="mt-1 text-xs text-muted">A decisão vale para todas as denúncias abertas sobre este conteúdo. Quem denunciou recebe um aviso; a identidade dele não é mostrada ao autor.</p>
    </Modal>
  );
}

function HistoryModal({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['pessoas', 'moderacao', 'historico', row?.id], enabled: !!row, queryFn: () => api<{ items: { id: string; action: string; measureLabel: string | null; note: string | null; actor: string; at: string }[] }>(`/pessoas/moderacao/denuncias/${row!.id}/historico`) });
  return (
    <Modal open={!!row} onClose={onClose} title="Histórico da moderação" size="sm">
      {q.isLoading ? <LoadingRows rows={3} /> : (
        <ol className="space-y-3 border-l-2 border-line pl-4">{q.data?.items.map((a) => (
          <li key={a.id}><p className="text-sm font-semibold text-ink">{ACTION[a.action] ?? a.action}{a.measureLabel && `: ${a.measureLabel}`}</p><p className="text-xs text-muted">{a.actor} · {fmtDateTime(a.at)}</p>{a.note && <p className="whitespace-pre-wrap text-sm text-text">{a.note}</p>}</li>
        ))}</ol>
      )}
    </Modal>
  );
}
