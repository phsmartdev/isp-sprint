/** Envia um anexo (proposta) pelo WhatsApp: pelo número da empresa (API) ou abrindo o WhatsApp do vendedor. */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Opportunity } from '../lib/types';
import { Button, FormField, Input, Textarea } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';

export function WhatsAppSend({ opp, attachment, open, onClose }: { opp: Pick<Opportunity, 'id' | 'contactName' | 'contactPhone'>; attachment: { id: string; filename: string } | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const first = opp.contactName.split(' ')[0] ?? '';
  const [phone, setPhone] = useState(opp.contactPhone ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setPhone(opp.contactPhone ?? ''); setMessage(`Olá, ${first}! Segue a proposta que preparamos para você. Qualquer dúvida, é só me chamar por aqui.`); setError(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useMutation({
    mutationFn: (mode: 'api' | 'link') => api<{ mode: 'api' | 'link'; waUrl?: string }>(`/opportunities/${opp.id}/attachments/${attachment!.id}/whatsapp`, { method: 'POST', body: { phone, message, mode } }),
    onSuccess: (r) => {
      for (const k of ['opportunity', 'timeline']) qc.invalidateQueries({ queryKey: [k] });
      if (r.mode === 'link' && r.waUrl) window.open(r.waUrl, '_blank', 'noopener');
      toast({ tone: 'success', message: r.mode === 'api' ? 'Proposta enviada pelo WhatsApp da empresa' : 'WhatsApp aberto com a mensagem e o link da proposta' });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message),
  });
  return (
    <Modal open={open && !!attachment} onClose={onClose} title="Enviar pelo WhatsApp" size="sm" footer={<>
      <Button onClick={onClose}>Cancelar</Button>
      <Button icon={<MessageCircle className="h-4 w-4" />} loading={send.isPending && send.variables === 'link'} onClick={() => { setError(null); send.mutate('link'); }}>Abrir no meu WhatsApp</Button>
      <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={send.isPending && send.variables === 'api'} onClick={() => { setError(null); send.mutate('api'); }}>Enviar pela empresa</Button>
    </>}>
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <p className="text-sm text-muted">Arquivo: <span className="font-semibold text-ink">{attachment?.filename}</span></p>
        <FormField label="WhatsApp do cliente" htmlFor="wa-phone" hint="Com DDD"><Input id="wa-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></FormField>
        <FormField label="Mensagem" htmlFor="wa-msg"><Textarea id="wa-msg" className="min-h-[96px]" value={message} onChange={(e) => setMessage(e.target.value)} /></FormField>
        <p className="text-xs text-muted">“Enviar pela empresa” manda o PDF pelo número do WhatsApp Business (precisa da integração ligada e de o cliente ter falado com vocês nas últimas 24 h). “Abrir no meu WhatsApp” abre a conversa com a mensagem e um link seguro para o PDF, válido por 15 dias.</p>
      </div>
    </Modal>
  );
}
