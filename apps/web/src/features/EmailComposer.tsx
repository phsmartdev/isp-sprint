import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { api, ApiError, qs } from '../lib/api';
import { Button, FormField, Input, Notice, Select, Textarea } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';
import { useAttachments } from './Attachments';

/** Envia proposta (com anexo) ou follow-up pelo SMTP da empresa; texto vem do modelo de instrução e pode ser editado. */
export function EmailComposer({ oppId, kind, open, onClose }: { oppId: string; kind: 'proposta' | 'followup'; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const files = useAttachments(oppId);
  const preview = useQuery({ queryKey: ['email-preview', oppId, kind], enabled: open, queryFn: () => api<{ to: string; subject: string; body: string }>(`/opportunities/${oppId}/email/preview${qs({ kind })}`) });
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachmentId, setAttachmentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (preview.data) { setTo(preview.data.to); setSubject(preview.data.subject); setBody(preview.data.body); }
  }, [preview.data]);
  const proposals = files.data?.items.filter((a) => a.kind === 'proposta') ?? [];
  useEffect(() => { if (!attachmentId && proposals[0]) setAttachmentId(proposals[0].id); }, [proposals, attachmentId]);
  const send = useMutation({
    mutationFn: () => api(`/opportunities/${oppId}/email`, { method: 'POST', body: { kind, to, subject, body, attachmentId: attachmentId || null } }),
    onSuccess: () => {
      for (const k of [['opportunity', oppId], ['timeline', oppId], ['activities'], ['emails', oppId]]) qc.invalidateQueries({ queryKey: k });
      toast({ tone: 'success', message: kind === 'proposta' ? 'Proposta enviada' : 'Follow-up enviado' });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message),
  });
  const needsFile = kind === 'proposta' && !proposals.length;
  return (
    <Modal open={open} onClose={onClose} title={kind === 'proposta' ? 'Enviar proposta' : 'Enviar follow-up'} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={needsFile || !to || !subject || !body} onClick={() => { setError(null); send.mutate(); }}>Enviar</Button></>}>
      <div className="space-y-3">
        {needsFile && <Notice tone="warning">Anexe a proposta na aba Anexos antes de enviar.</Notice>}
        {error && <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <FormField label="Para" htmlFor="em-to" hint="E-mail do cliente"><Input id="em-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></FormField>
        <FormField label="Assunto" htmlFor="em-subject"><Input id="em-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
        <FormField label="Mensagem" htmlFor="em-body" hint="Texto do modelo de instrução; ajuste à vontade. As respostas do cliente vão para o seu e-mail."><Textarea id="em-body" className="min-h-[200px]" value={body} onChange={(e) => setBody(e.target.value)} /></FormField>
        {proposals.length > 0 && (
          <FormField label={kind === 'proposta' ? 'Proposta anexada' : 'Anexo (opcional)'} htmlFor="em-att">
            <Select id="em-att" value={attachmentId} onChange={(e) => setAttachmentId(e.target.value)}>
              {kind === 'followup' && <option value="">Sem anexo</option>}
              {proposals.map((a) => <option key={a.id} value={a.id}>{a.filename}</option>)}
            </Select>
          </FormField>
        )}
      </div>
    </Modal>
  );
}
