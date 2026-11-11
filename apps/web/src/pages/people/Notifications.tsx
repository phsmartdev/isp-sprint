/** Notificações do módulo e preferências: escolher por evento e canal; avisos obrigatórios não se desligam. */
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { Avatar, Button, EmptyState, ErrorState, LoadingRows } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import type { PersonCard } from './shared';

type Item = { id: string; event: string; title: string; body: string | null; link: string; at: string; readAt: string | null; actor: PersonCard | null };
type Ev = { key: string; label: string; mandatory: boolean; channels: { channel: 'interna' | 'email' | 'whatsapp'; available: boolean; enabled: boolean }[] };
const CH: Record<string, string> = { interna: 'No sistema', email: 'E-mail', whatsapp: 'WhatsApp' };

export function NotificationsPage() {
  const q = useQuery({ queryKey: ['pessoas', 'notificacoes'], queryFn: () => api<{ items: Item[]; events: Ev[] }>('/pessoas/notificacoes') });
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['pessoas', 'notificacoes'] }); void qc.invalidateQueries({ queryKey: ['mentions'] }); };
  const read = useMutation({ mutationFn: (id: string) => api(`/me/notificacoes/${id}/lida`, { method: 'POST' }), onSuccess: refresh });
  const all = useMutation({ mutationFn: () => api('/me/notificacoes/lidas', { method: 'POST' }), onSuccess: refresh });
  const pref = useMutation({
    mutationFn: (i: { event: string; channel: string; enabled: boolean }) => api('/pessoas/notificacoes/preferencias', { method: 'PUT', body: { items: [i] } }),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Preferência salva' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const unread = q.data!.items.filter((i) => !i.readAt).length;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="card" aria-label="Avisos">
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="text-md font-bold text-ink">Avisos {unread > 0 && <span className="text-sm font-normal text-muted">({unread} não lidos)</span>}</h2>{unread > 0 && <Button size="sm" variant="ghost" loading={all.isPending} onClick={() => all.mutate()}>Marcar todos como lidos</Button>}</div>
        {!q.data!.items.length ? <EmptyState title="Nenhum aviso ainda" description="Menções, comentários, reconhecimentos, convites, comunicados e decisões da moderação aparecem aqui e no ícone de avisos do topo." /> : (
          <ul className="divide-y divide-line">{q.data!.items.map((i) => (
            <li key={i.id}>
              <Link to={i.link} onClick={() => !i.readAt && read.mutate(i.id)} className={clsx('flex items-start gap-3 px-4 py-3 hover:bg-surface-2', !i.readAt && 'bg-primary-soft/40')}>
                {i.actor ? <Avatar name={i.actor.name} userId={i.actor.id} hasPhoto={i.actor.hasPhoto} size={36} /> : <span className="h-9 w-9 rounded-circle bg-surface-2" aria-hidden />}
                <span className="min-w-0 flex-1"><span className="block text-sm text-ink">{!i.readAt && <span className="mr-1.5 inline-block h-2 w-2 rounded-circle bg-primary" aria-label="não lido" />}{i.title}</span>
                  {i.body && <span className="block text-sm text-muted">{i.body}</span>}<span className="text-xs text-muted">{fmtRelative(i.at)}</span></span>
              </Link>
            </li>
          ))}</ul>
        )}
      </section>
      <section className="card p-4" aria-label="Preferências de notificação">
        <h2 className="text-md font-bold text-ink">Como quero ser avisado</h2>
        <p className="mb-3 text-xs text-muted">E-mail e WhatsApp aparecem quando a empresa libera o canal para o evento; o texto enviado fora do sistema nunca leva o conteúdo das publicações.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-semibold">Evento</th>{(['interna', 'email', 'whatsapp'] as const).map((c) => <th key={c} className="px-1 text-center font-semibold">{CH[c]}</th>)}</tr></thead>
          <tbody>{q.data!.events.map((e) => (
            <tr key={e.key} className="border-t border-line">
              <td className="py-2 pr-2 text-ink">{e.label}{e.mandatory && <span className="block text-2xs text-muted">obrigatório no sistema</span>}</td>
              {e.channels.map((c) => (
                <td key={c.channel} className="px-1 text-center">
                  {c.available
                    ? <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`${e.label}: ${CH[c.channel]}`} checked={c.enabled} disabled={c.channel === 'interna' && e.mandatory} onChange={(ev) => pref.mutate({ event: e.key, channel: c.channel, enabled: ev.target.checked })} />
                    : <span className="text-muted" title="Canal não liberado pela empresa para este evento">—</span>}
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
