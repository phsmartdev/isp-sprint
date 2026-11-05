/**
 * Página do link dos avisos e comunicações de contratos (pública, pelo token). Abrir a página já registra a leitura
 * (como o pixel do e-mail); quem está fora do sistema pode responder por aqui.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { PublicShell } from '../components/layout/PublicShell';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Button, ErrorState, FormField, LoadingRows, Textarea } from '../components/ui/primitives';

type Notice = { title: string; recipientName: string; role: string | null; activity: { title: string; dueAt: string | null; done: boolean } | null; sentAt: string; confirmedAt: string | null; responseText: string | null; canRespond: boolean };

export function PublicNoticePage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-notice', token], retry: false, queryFn: () => api<Notice>(`/public/notices/${token}`) });
  const [response, setResponse] = useState('');
  const m = useMutation({ mutationFn: () => api<{ responseText: string | null }>(`/public/notices/${token}/confirm`, { method: 'POST', body: { response: response.trim() } }), onSuccess: () => q.refetch() });
  const shell = (body: React.ReactNode) => <PublicShell kicker="Gestão de Contratos" width="max-w-xl">{body}</PublicShell>;
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
      <p role="status" className="flex items-center gap-2 rounded-md bg-success-soft p-3 text-sm font-semibold text-success"><CheckCircle2 className="h-5 w-5" />Leitura registrada.</p>
      {d.canRespond && (d.responseText ? (
        <p className="text-sm text-text">Sua resposta: “{d.responseText}”</p>
      ) : (
        <>
          <FormField label="Resposta" htmlFor="pn-resp" hint="Aceite, dúvida, impedimento ou prazo. Chega a quem acompanha o contrato.">
            <Textarea id="pn-resp" rows={4} maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} />
          </FormField>
          <Button variant="primary" className="w-full sm:w-auto" loading={m.isPending} disabled={!response.trim()} onClick={() => m.mutate()}>Enviar resposta</Button>
        </>
      ))}
      {m.isError && <ErrorState error={m.error} />}
    </div>,
  );
}
