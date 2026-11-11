/** Feedback aberto: o registro SBI (ou a síntese do RH), ciência e manifestação, mediação (RH) e histórico. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, Lock } from 'lucide-react';
import { api } from '../../../lib/api';
import { fmtDateTime } from '../../../lib/format';
import { Avatar, Button, Chip, ErrorState, FormField, LoadingRows, Textarea } from '../../../components/ui/primitives';
import { useToast } from '../../../components/ui/overlay';
import { errMsg } from '../../../features/contracts/shared';
import { day, HISTORY, STATUS, type Feedback } from './api';

export function FeedbackDetailPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['pessoas', 'dev', 'feedback', id], queryFn: () => api<Feedback>(`/pessoas/desenvolvimento/feedbacks/${id}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const f = q.data;
  const viaRh = f.myRole === 'destinatario' && f.mode === 'confidencial';
  const block = (label: string, text: string | null) => text ? <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p><p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{text}</p></div> : null;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/pessoas/desenvolvimento/feedbacks" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Feedbacks</Link>
      <article className="card space-y-4 p-5" aria-label="Feedback">
        <header className="flex flex-wrap items-center gap-3">
          {viaRh ? <span className="flex h-11 w-11 items-center justify-center rounded-circle bg-primary-soft text-primary"><Lock className="h-5 w-5" aria-hidden /></span>
            : f.sender && <Avatar name={f.sender.name} userId={f.sender.id} hasPhoto={f.sender.hasPhoto} size={44} />}
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{viaRh ? <b>Devolutiva do time, mediada pelo RH</b> : <><b>{f.sender?.name}</b> → <b>{f.recipient?.name}</b></>}</p>
            <p className="text-xs text-muted">Aconteceu em {day(f.occurredOn)}{f.sentAt && ` · enviado em ${fmtDateTime(f.sentAt)}`}</p>
          </div>
          <div className="flex flex-wrap gap-1.5"><Chip>{f.modalityLabel}</Chip>{f.mode === 'confidencial' && !viaRh && <Chip tone="purple">Confidencial</Chip>}<Chip tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Chip></div>
        </header>
        {viaRh ? (
          <div className="space-y-2 border-l-4 border-primary bg-primary-soft/40 p-4">
            <p className="whitespace-pre-wrap text-sm text-ink">{f.synthesis}</p>
            <p className="text-xs text-muted">O RH preparou esta síntese a partir de um feedback confidencial do seu time. Ela não identifica quem enviou e não gera avaliação automática.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3 grid gap-4 sm:grid-cols-3">{block('Situação', f.situation)}{block('Comportamento observado', f.behavior)}{block('Impacto', f.impact)}</div>
            {(f.guidance || f.nextSteps) && <div className="grid gap-4 border-t border-line pt-4 sm:col-span-3 sm:grid-cols-2">{block('Orientação', f.guidance)}{block('Próximos passos', f.nextSteps)}</div>}
          </div>
        )}
        {f.myRole !== 'destinatario' && f.synthesis && <div className="border-t border-line pt-3">{block('Síntese repassada à liderança', f.synthesis)}</div>}
        {f.mediationNote && <div className="border-t border-line pt-3">{block('Registro do RH', f.mediationNote)}</div>}
        {(f.acknowledgedAt || f.response) && (
          <div className="border-t border-line pt-3">
            {f.acknowledgedAt && <p className="flex items-center gap-1.5 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Ciência em {fmtDateTime(f.acknowledgedAt)}</p>}
            {f.response && <div className="mt-2">{block('Manifestação de quem recebeu', f.response)}</div>}
          </div>
        )}
      </article>
      {f.myRole === 'destinatario' && (!f.acknowledgedAt || !f.response) && <AckBox f={f} />}
      {f.myRole === 'rh' && f.status === 'em_mediacao' && <MediationBox f={f} />}
      {f.history.length > 0 && (
        <section className="card p-4" aria-label="Histórico">
          <h2 className="mb-2 text-sm font-bold text-ink">Histórico</h2>
          <ol className="space-y-1.5 border-l-2 border-line pl-4 text-sm">{f.history.map((h, i) => <li key={i}><span className="text-ink">{HISTORY[h.type] ?? h.type}</span> <span className="text-muted">· {h.actor} · {fmtDateTime(h.at)}</span>{h.note && <p className="text-text">{h.note}</p>}</li>)}</ol>
        </section>
      )}
    </div>
  );
}

function AckBox({ f }: { f: Feedback }) {
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const send = useMutation({
    mutationFn: () => api(`/pessoas/desenvolvimento/feedbacks/${f.id}/ciencia`, { method: 'POST', body: { response: text.trim() || null } }),
    onSuccess: () => { setText(''); void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: f.acknowledgedAt ? 'Manifestação registrada' : 'Ciência registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className={clsx('card space-y-3 p-4', !f.acknowledgedAt && 'border-l-4 border-l-[#F5B400]')} aria-label="Ciência e manifestação">
      <p className="text-sm text-ink">{f.acknowledgedAt ? 'Quer registrar sua perspectiva sobre este feedback?' : 'Registre que você leu este feedback.'} <span className="text-muted">Ciência não significa concordância: você pode registrar comentários ou divergências.</span></p>
      <FormField label="Sua manifestação (opcional)" htmlFor="fb-resp"><Textarea id="fb-resp" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></FormField>
      <div className="flex justify-end"><Button variant="primary" loading={send.isPending} disabled={!!f.acknowledgedAt && !text.trim()} onClick={() => send.mutate()}>{f.acknowledgedAt ? 'Registrar manifestação' : text.trim() ? 'Registrar ciência e manifestação' : 'Registrar ciência'}</Button></div>
    </section>
  );
}

function MediationBox({ f }: { f: Feedback }) {
  const [action, setAction] = useState<'repassar' | 'tratar_sem_repasse'>('repassar');
  const [synthesis, setSynthesis] = useState('');
  const [note, setNote] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const send = useMutation({
    mutationFn: () => api(`/pessoas/desenvolvimento/feedbacks/${f.id}/mediacao`, { method: 'POST', body: { action, synthesis: action === 'repassar' ? synthesis : null, note } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: 'Mediação registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className="card space-y-3 p-4" aria-label="Mediação do RH">
      <h2 className="text-sm font-bold text-ink">Mediação do RH</h2>
      <div className="flex flex-wrap gap-2 text-sm">
        {([['repassar', 'Repassar uma síntese à liderança'], ['tratar_sem_repasse', 'Tratar sem repassar']] as const).map(([k, l]) => (
          <label key={k} className={clsx('cursor-pointer border px-3 py-2', action === k ? 'border-primary bg-primary-soft' : 'border-line')}><input type="radio" name="acao" className="sr-only" checked={action === k} onChange={() => setAction(k)} aria-label={l} />{l}</label>
        ))}
      </div>
      {action === 'repassar' && <FormField label="Síntese para a liderança" htmlFor="md-syn" required hint="Sem nomes nem detalhes que identifiquem quem enviou"><Textarea id="md-syn" rows={3} maxLength={2000} value={synthesis} onChange={(e) => setSynthesis(e.target.value)} /></FormField>}
      <FormField label="Registro da mediação" htmlFor="md-note" required hint="Quem enviou vê este registro; a liderança não"><Textarea id="md-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      <div className="flex justify-end"><Button variant="primary" loading={send.isPending} disabled={note.trim().length < 10 || (action === 'repassar' && synthesis.trim().length < 20)} onClick={() => send.mutate()}>Registrar mediação</Button></div>
    </section>
  );
}
