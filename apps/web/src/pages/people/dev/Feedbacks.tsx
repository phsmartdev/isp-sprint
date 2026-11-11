/** Meus Feedbacks: recebidos, enviados e (RH) mediação. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Lock, Plus } from 'lucide-react';
import { api, qs } from '../../../lib/api';

import { Avatar, Chip, EmptyState, ErrorState, LoadingRows } from '../../../components/ui/primitives';
import { day, STATUS, useDevContext, type Feedback } from './api';

type Box = 'recebidos' | 'enviados' | 'mediacao';

export function FeedbacksPage() {
  const ctx = useDevContext();
  const [box, setBox] = useState<Box>('recebidos');
  const q = useQuery({ queryKey: ['pessoas', 'dev', 'feedbacks', box], queryFn: () => api<{ items: Feedback[] }>(`/pessoas/desenvolvimento/feedbacks${qs({ caixa: box })}`) });
  const tabs: [Box, string][] = [['recebidos', 'Recebidos'], ['enviados', 'Enviados'], ...(ctx.data?.hr ? [['mediacao', 'Mediação (RH)'] as [Box, string]] : [])];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-bold text-ink">Feedbacks</h1><p className="text-sm text-muted">Situação, comportamento e impacto: feedback com contexto, nos dois sentidos.</p></div>
        <Link to="/pessoas/desenvolvimento/feedbacks/novo" className="inline-flex h-10 items-center gap-2 bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"><Plus className="h-4 w-4" aria-hidden />Novo feedback</Link>
      </div>
      <div role="tablist" aria-label="Caixas" className="flex w-fit border border-line bg-surface text-sm">
        {tabs.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={box === k} onClick={() => setBox(k)} className={clsx('px-3 py-1.5', box === k ? 'bg-primary text-white' : 'hover:bg-surface-2')}>{l}</button>)}
      </div>
      {q.isLoading ? <div className="card"><LoadingRows rows={4} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? (
        <div className="card"><EmptyState title={box === 'recebidos' ? 'Nenhum feedback recebido ainda' : box === 'enviados' ? 'Você ainda não registrou feedbacks' : 'Nada aguardando mediação'} description={box === 'mediacao' ? 'Feedbacks confidenciais de liderados para a liderança chegam aqui.' : 'Registre um feedback para um liderado ou para a sua liderança.'} /></div>
      ) : (
        <ul className="space-y-2">{q.data!.items.map((f) => <FeedbackRow key={f.id} f={f} />)}</ul>
      )}
    </div>
  );
}

function FeedbackRow({ f }: { f: Feedback }) {
  const other = f.myRole === 'remetente' ? f.recipient : f.sender;
  const pending = f.myRole === 'destinatario' && !f.acknowledgedAt;
  const viaRh = f.myRole === 'destinatario' && f.mode === 'confidencial';
  const href = f.status === 'rascunho' ? `/pessoas/desenvolvimento/feedbacks/novo?rascunho=${f.id}` : `/pessoas/desenvolvimento/feedbacks/${f.id}`;
  return (
    <li>
      <Link to={href} className={clsx('card flex items-start gap-3 p-4 hover:border-primary', pending && 'border-l-4 border-l-[#F5B400]')}>
        {viaRh ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-circle bg-primary-soft text-primary"><Lock className="h-5 w-5" aria-hidden /></span> : other && <Avatar name={other.name} userId={other.id} hasPhoto={other.hasPhoto} size={40} />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-ink">{viaRh ? 'Devolutiva do time (via RH)' : f.myRole === 'remetente' ? `Para ${other?.name ?? ''}` : f.myRole === 'rh' ? `${f.sender?.name ?? ''} → ${f.recipient?.name ?? ''}` : `De ${other?.name ?? ''}`}</span>
            <Chip>{f.modalityLabel}</Chip>
            {f.mode === 'confidencial' && f.myRole !== 'destinatario' && <Chip tone="purple">Confidencial</Chip>}
            <Chip tone={STATUS[f.status].tone}>{f.myRole === 'destinatario' && pending ? 'Aguardando sua ciência' : STATUS[f.status].label}</Chip>
          </span>
          <span className="mt-1 line-clamp-2 block text-sm text-text">{viaRh ? f.synthesis : f.behavior || 'Rascunho sem texto'}</span>
          <span className="mt-1 block text-xs text-muted">Aconteceu em {day(f.occurredOn)}{f.direction === 'ascendente' ? ' · para a liderança' : ' · da liderança'}</span>
        </span>
      </Link>
    </li>
  );
}
