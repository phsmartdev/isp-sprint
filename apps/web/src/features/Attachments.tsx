import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, fileToBase64, fmtBytes } from '../lib/files';
import { useAuth } from '../auth/AuthProvider';
import { Button, Chip, EmptyState, LoadingRows } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';

export type Attachment = { id: string; kind: 'proposta' | 'outro'; filename: string; mime: string; sizeBytes: number; createdAt: string; uploadedBy: string | null; uploadedByName: string | null };
export const useAttachments = (oppId: string) => useQuery({ queryKey: ['attachments', oppId], queryFn: () => api<{ items: Attachment[] }>(`/opportunities/${oppId}/attachments`) });

export function Attachments({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me, can } = useAuth();
  const file = useRef<HTMLInputElement>(null);
  const kindRef = useRef<'proposta' | 'outro'>('proposta');
  const q = useAttachments(oppId);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['attachments', oppId] }); qc.invalidateQueries({ queryKey: ['opportunity', oppId] }); qc.invalidateQueries({ queryKey: ['timeline', oppId] }); };
  const up = useMutation({
    mutationFn: async (f: File) => {
      if (f.size > MAX_ATTACHMENT_BYTES) throw new Error('O arquivo passa de 3 MB.');
      return api(`/opportunities/${oppId}/attachments`, { method: 'POST', body: { kind: kindRef.current, filename: f.name, data: await fileToBase64(f) } });
    },
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Arquivo anexado' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/opportunities/${oppId}/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Anexo removido' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const pick = (k: 'proposta' | 'outro') => { kindRef.current = k; file.current?.click(); };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" icon={<Paperclip className="h-4 w-4" />} loading={up.isPending && kindRef.current === 'proposta'} onClick={() => pick('proposta')}>Anexar proposta</Button>
        <Button size="sm" icon={<Paperclip className="h-4 w-4" />} loading={up.isPending && kindRef.current === 'outro'} onClick={() => pick('outro')}>Outro arquivo</Button>
        <span className="self-center text-xs text-muted">PDF, Word, Excel, PowerPoint, PNG ou JPG até 3 MB</span>
        <input ref={file} type="file" className="hidden" accept={ATTACHMENT_ACCEPT} aria-label="Arquivo para anexar" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
      </div>
      {q.isLoading ? <LoadingRows rows={2} /> : !q.data?.items.length ? <EmptyState title="Nenhum anexo" description="Anexe a proposta para enviar ao cliente e avançar nas etapas que exigem." /> : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {q.data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <FileText className="h-5 w-5 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{a.filename}</span>
                <span className="block text-xs text-muted">{fmtBytes(a.sizeBytes)} · {fmtDateTime(a.createdAt)}{a.uploadedByName ? ` · ${a.uploadedByName}` : ''}</span>
              </span>
              <Chip tone={a.kind === 'proposta' ? 'green' : 'neutral'}>{a.kind === 'proposta' ? 'Proposta' : 'Outro'}</Chip>
              <a className="rounded-sm p-1.5 text-ink hover:bg-surface-2" href={`/api/v1/opportunities/${oppId}/attachments/${a.id}/download`} aria-label={`Baixar ${a.filename}`}><Download className="h-4 w-4" /></a>
              {(a.uploadedBy === me?.user.id || can('oportunidades', 'equipe')) && (
                <button className="rounded-sm p-1.5 text-danger hover:bg-danger-soft" aria-label={`Remover ${a.filename}`} onClick={() => del.mutate(a.id)}><Trash2 className="h-4 w-4" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
