/** Página do botão "Confirmar recebimento" dos avisos de atividades de contrato (pública, pelo token do aviso). */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Button, ErrorState, FormField, LoadingRows, Textarea } from '../components/ui/primitives';

type Notice = { title: string; recipientName: string; role: string | null; activity: { title: string; dueAt: string | null; done: boolean } | null; sentAt: string; confirmedAt: string | null; responseText: string | null; canRespond: boolean };

export function PublicNoticePage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-notice', token], retry: false, queryFn: () => api<Notice>(`/public/notices/${token}`) });
  const [response, setResponse] = useState('');
  const m = useMutation({ mutationFn: () => api<{ confirmedAt: string; responseText: string | null }>(`/public/notices/${token}/confirm`, { method: 'POST', body: { response: response.trim() || undefined } }), onSuccess: () => q.refetch() });
  const shell = (body: React.ReactNode) => <div className="min-h-screen bg-bg"><header className="bg-navy-active px-4 py-4 sm:px-8"><p className="font-display text-lg font-bold text-white">BKT · Gestão de Contratos</p></header><main className="mx-auto max-w-xl p-4 sm:p-8">{body}</main></div>;
  if (q.isLoading) return shell(<LoadingRows rows={4} />);
  if (q.isError) return shell(<ErrorState error={q.error} />);
  const d = q.data!;
  return shell(
    <div className="card space-y-4 p-6">
      <div>
        <p className="text-sm text-muted">Olá, {d.recipientName.split(' ')[0]}</p>
        <h1 className="font-display text-xl font-bold text-ink">{d.title}</h1>
      </div>
      <dl className="space-y-1 text-sm">
        {d.activity && <div><dt className="inline text-muted">Atividade: </dt><dd className="inline text-ink">{d.activity.title}{d.activity.done ? ' (concluída)' : ''}</dd></div>}
        {d.activity?.dueAt && <div><dt className="inline text-muted">Prazo: </dt><dd className="inline text-ink">{fmtDate(d.activity.dueAt)}</dd></div>}
        {d.role && <div><dt className="inline text-muted">Seu papel: </dt><dd className="inline text-ink">{d.role}</dd></div>}
        <div><dt className="inline text-muted">Enviado em: </dt><dd className="inline text-ink">{fmtDateTime(d.sentAt)}</dd></div>
      </dl>
      {d.confirmedAt ? (
        <div role="status" className="rounded-md bg-success-soft p-4">
          <p className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 className="h-5 w-5" />Recebimento confirmado em {fmtDateTime(d.confirmedAt)}</p>
          {d.responseText && <p className="mt-2 text-sm text-text">Sua resposta: “{d.responseText}”</p>}
          {d.canRespond && !d.responseText && <p className="mt-1 text-sm text-text">Se quiser, envie uma resposta abaixo.</p>}
        </div>
      ) : <p className="text-sm text-text">Confirme que recebeu este aviso. A confirmação fica registrada no histórico da atividade.</p>}
      {d.canRespond && !d.responseText && (
        <FormField label="Resposta (opcional)" htmlFor="pn-resp" hint="Aceite, dúvida, impedimento ou prazo. Chega a quem acompanha o contrato.">
          <Textarea id="pn-resp" rows={4} maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} />
        </FormField>
      )}
      {(!d.confirmedAt || (d.canRespond && !d.responseText)) && (
        <Button variant="primary" className="w-full sm:w-auto" loading={m.isPending} disabled={!!d.confirmedAt && !response.trim()} onClick={() => m.mutate()}>
          {d.confirmedAt ? 'Enviar resposta' : response.trim() ? 'Confirmar recebimento e enviar resposta' : 'Confirmar recebimento'}
        </Button>
      )}
      {m.isError && <ErrorState error={m.error} />}
    </div>,
  );
}
