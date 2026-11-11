/** Denunciar conteúdo: motivo, detalhe opcional e orientação para casos confidenciais (Canal de Confiança/CIEI). */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

export type ReportTarget = { targetType: 'publicacao' | 'comentario' | 'reconhecimento'; targetId: string };
type Opt = { key: string; label: string };
export const useReportOptions = () => useQuery({ queryKey: ['pessoas', 'denuncias', 'motivos'], staleTime: Infinity, queryFn: () => api<{ reasons: Opt[]; measures: Opt[] }>('/pessoas/denuncias/motivos') });

export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const toast = useToast();
  const opts = useReportOptions();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const send = useMutation({
    mutationFn: () => api('/pessoas/denuncias', { method: 'POST', body: { ...target, reason, details: details.trim() || null } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Denúncia enviada. A moderação vai analisar; quem publicou não sabe quem denunciou.' }); setReason(''); setDetails(''); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const what = target?.targetType === 'comentario' ? 'comentário' : target?.targetType === 'reconhecimento' ? 'reconhecimento' : 'publicação';
  return (
    <Modal open={!!target} onClose={onClose} title={`Denunciar ${what}`} size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="danger" loading={send.isPending} disabled={!reason || (reason === 'outro' && details.trim().length < 3)} onClick={() => send.mutate()}>Enviar denúncia</Button></>}>
      <fieldset className="space-y-1.5">
        <legend className="mb-2 text-sm font-semibold text-ink">Por que você está denunciando?</legend>
        {(opts.data?.reasons ?? []).map((r) => (
          <label key={r.key} className={clsx('flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm', reason === r.key ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2')}>
            <input type="radio" name="motivo" className="accent-primary" checked={reason === r.key} onChange={() => setReason(r.key)} />{r.label}
          </label>
        ))}
      </fieldset>
      {reason === 'assedio' && (
        <p className="mt-3 flex gap-2 border border-warning bg-warning-soft p-3 text-sm text-ink"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          Casos de assédio ou discriminação também podem ser levados ao Canal de Confiança, com tratamento confidencial pelo CIEI. Esta denúncia tira o conteúdo da vista quando a moderação decidir e não expõe ninguém no feed.</p>
      )}
      <label className="mt-3 block text-sm font-semibold text-ink" htmlFor="rep-det">Detalhes {reason === 'outro' ? '(obrigatório)' : '(opcional)'}</label>
      <Textarea id="rep-det" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Ajude a moderação a entender o problema" />
    </Modal>
  );
}
