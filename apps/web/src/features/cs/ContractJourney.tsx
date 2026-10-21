/** Jornada do cliente na ficha do contrato: progresso e acesso, ou início manual. */
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

export function ContractJourney({ contractId }: { contractId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['cs-journeys', 'contract', contractId], queryFn: () => api<{ items: { id: string; templateName: string; progress: number; late: number; next: { title: string } | null }[] }>(`/cs/journeys?contractId=${contractId}`), retry: false });
  const start = useMutation({ mutationFn: () => api('/cs/journeys', { method: 'POST', body: { contractId } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cs-journeys', 'contract', contractId] }); toast({ tone: 'success', message: 'Jornada iniciada com apresentação de kickoff' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isError) return null;
  const j = q.data?.items[0];
  if (!q.data) return <span className="text-sm text-muted">…</span>;
  if (!j) return <button className="text-sm font-semibold text-primary hover:underline disabled:opacity-60" disabled={start.isPending} onClick={() => start.mutate()}>Iniciar jornada</button>;
  return <span className="text-sm"><Link className="font-semibold text-primary hover:underline" to={`/sucesso/jornadas/${j.id}`}>Jornada · {Math.round(j.progress * 100)}%</Link>{j.late ? <span className="text-danger"> · {j.late} atrasado(s)</span> : ''}{j.next ? <span className="block text-xs text-muted">Próximo: {j.next.title}</span> : null}</span>;
}
