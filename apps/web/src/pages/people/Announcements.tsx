/** Comunicados oficiais para o colaborador: destaque no Meu Espaço, não lidos, prioridade e confirmação de leitura. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronDown, FileText, Megaphone } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtBytes } from '../../lib/files';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { RichText } from '../../features/RichText';
import { errMsg } from '../../features/contracts/shared';
import { mediaUrl, type Media } from './feed/api';

export type Ann = { id: string; title: string; body: string; category: string | null; priority: 'informativo' | 'importante' | 'urgente'; requireAck: boolean; pinned: boolean; version: number; publishedAt: string; expiresAt: string | null; viewed: boolean; acknowledged: boolean; media: Media[] };
export const PRIORITY: Record<Ann['priority'], { label: string; tone: 'red' | 'orange' | 'blue'; bar: string }> = {
  urgente: { label: 'Urgente', tone: 'red', bar: 'border-l-danger' },
  importante: { label: 'Importante', tone: 'orange', bar: 'border-l-[#F59E0B]' },
  informativo: { label: 'Informativo', tone: 'blue', bar: 'border-l-primary' },
};
export const useAnnouncements = () => useQuery({ queryKey: ['pessoas', 'comunicados'], queryFn: () => api<{ items: Ann[]; unread: number; pendingAck: number }>('/pessoas/comunicados'), refetchInterval: 120_000 });

export function AnnouncementsBlock() {
  const q = useAnnouncements();
  const items = q.data?.items.filter((a) => a.pinned || !a.viewed || (a.requireAck && !a.acknowledged)) ?? [];
  if (!items.length) return null;
  return (
    <section aria-label="Comunicados oficiais" className="space-y-2">
      <h2 className="flex items-center gap-2 text-md font-bold text-ink"><Megaphone className="h-5 w-5 text-primary" aria-hidden />Comunicados
        {!!q.data?.unread && <span className="bg-danger px-1.5 py-0.5 text-2xs font-bold text-white">{q.data.unread} não lido{q.data.unread > 1 ? 's' : ''}</span>}
        {!!q.data?.pendingAck && <span className="text-xs font-normal text-muted">· {q.data.pendingAck} aguardando sua confirmação</span>}
      </h2>
      {items.slice(0, 5).map((a) => <AnnouncementCard key={a.id} a={a} />)}
    </section>
  );
}

function AnnouncementCard({ a }: { a: Ann }) {
  const [open, setOpen] = useState(!a.viewed && a.priority === 'urgente');
  const qc = useQueryClient();
  const toast = useToast();
  const seen = useMutation({ mutationFn: () => api(`/pessoas/comunicados/${a.id}/visto`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['pessoas', 'comunicados'] }) });
  const ack = useMutation({
    mutationFn: () => api(`/pessoas/comunicados/${a.id}/confirmar`, { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas', 'comunicados'] }); toast({ tone: 'success', message: 'Leitura confirmada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const p = PRIORITY[a.priority];
  const toggle = () => { setOpen((v) => !v); if (!a.viewed) seen.mutate(); };
  return (
    <article className={clsx('card border-l-4', p.bar, !a.viewed && 'bg-primary-soft/40')} aria-label={`Comunicado: ${a.title}`}>
      <button type="button" className="flex w-full items-start gap-3 p-4 text-left" aria-expanded={open} onClick={toggle}>
        {a.priority === 'urgente' ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden /> : <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{a.title}</span><Chip tone={p.tone}>{p.label}</Chip>{a.category && <Chip>{a.category}</Chip>}{!a.viewed && <span className="text-2xs font-bold uppercase text-danger">novo</span>}</span>
          <span className="block text-xs text-muted">{fmtDateTime(a.publishedAt)}{a.expiresAt ? ` · até ${fmtDateTime(a.expiresAt)}` : ''}{a.version > 1 ? ` · atualizado (versão ${a.version})` : ''}</span>
        </span>
        <ChevronDown className={clsx('h-5 w-5 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          <RichText text={a.body} />
          {a.media.length > 0 && (
            <div className="space-y-2">
              {a.media.filter((m) => m.kind === 'imagem').map((m) => <img key={m.id} src={mediaUrl(m.id)} alt={m.filename} className="max-h-96 w-full object-contain bg-surface-2" />)}
              {a.media.filter((m) => m.kind !== 'imagem').map((m) => <a key={m.id} href={mediaUrl(m.id)} className="flex items-center gap-2 border border-line px-3 py-2 text-sm hover:bg-surface-2"><FileText className="h-4 w-4 text-primary" aria-hidden />{m.filename}<span className="ml-auto text-xs text-muted">{fmtBytes(m.sizeBytes)}</span></a>)}
            </div>
          )}
          {a.requireAck && (a.acknowledged
            ? <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Leitura confirmada</p>
            : <div className="flex flex-wrap items-center gap-3"><Button variant="primary" size="sm" loading={ack.isPending} onClick={() => ack.mutate()}>Li e estou ciente</Button><span className="text-xs text-muted">A confirmação registra que você leu esta versão; não é aceite formal de política.</span></div>)}
        </div>
      )}
    </article>
  );
}
