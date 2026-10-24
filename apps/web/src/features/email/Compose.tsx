/** E-mail novo pelo CRM (por uma caixa conectada) e a assinatura de cada pessoa. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PenLine, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, FormField, Input, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Box = { id: string; kind: string; address: string; displayName: string | null; ownerId: string | null; status: string };
export const useSignature = () => useQuery({ queryKey: ['mail', 'signature'], queryFn: () => api<{ text: string; updatedAt: string | null }>('/mail/signature') });
const emails = (v: string) => v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Assinatura: editar e salvar (texto; vai depois de "-- " no fim dos e-mails). */
export function SignatureEditor({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useSignature();
  const [text, setText] = useState('');
  useEffect(() => { if (q.data) setText(q.data.text); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/mail/signature', { method: 'PUT', body: { text } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['mail', 'signature'] }); toast({ tone: 'success', message: 'Assinatura salva' }); onSaved?.(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-2">
      <FormField label="Minha assinatura" htmlFor="sig-text" hint="Vai no fim dos e-mails novos e das respostas. Dá para tirar na hora de enviar.">
        <Textarea id="sig-text" rows={4} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={'Paulo Henrique\nGerente Comercial · BKT\n(79) 9 0000-0000'} />
      </FormField>
      <div className="flex justify-end"><Button size="sm" variant="primary" loading={save.isPending} disabled={q.isLoading || text === (q.data?.text ?? '')} onClick={() => save.mutate()}>Salvar assinatura</Button></div>
    </div>
  );
}

export function ComposeButton({ boxes, onSent }: { boxes: Box[]; onSent: (threadId: string | null) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sig = useSignature();
  const usable = boxes.filter((b) => b.status === 'conectada');
  const [open, setOpen] = useState(false);
  const [editSig, setEditSig] = useState(false);
  const [box, setBox] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [withSig, setWithSig] = useState(true);
  const start = () => { setBox(usable.find((b) => b.kind === 'pessoal')?.id ?? usable[0]?.id ?? ''); setTo(''); setCc(''); setSubject(''); setText(''); setWithSig(true); setEditSig(false); setOpen(true); };
  const send = useMutation({
    mutationFn: () => api<{ threadId: string | null }>('/mail/compose', { method: 'POST', body: { mailboxId: box, to: emails(to), cc: emails(cc), subject: subject.trim(), text, signature: withSig } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['mail'] }); toast({ tone: 'success', message: 'E-mail enviado' }); setOpen(false); onSent(r.threadId); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ok = !!box && emails(to).length > 0 && subject.trim().length > 0 && text.trim().length > 0;
  return (
    <>
      <Button variant="primary" icon={<PenLine className="h-4 w-4" />} disabled={!usable.length} onClick={start}>Novo e-mail</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Novo e-mail" size="lg" footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!ok} onClick={() => send.mutate()}>Enviar</Button></>}>
        <div className="space-y-3">
          <FormField label="De" htmlFor="cp-box"><Select id="cp-box" value={box} onChange={(e) => setBox(e.target.value)}>{usable.map((b) => <option key={b.id} value={b.id}>{b.kind === 'pessoal' ? b.address : `${b.displayName ?? b.address} (${b.address})`}</option>)}</Select></FormField>
          <FormField label="Para" htmlFor="cp-to" hint="Separe vários endereços com vírgula"><Input id="cp-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="cliente@empresa.com.br" /></FormField>
          <FormField label="Cópia" htmlFor="cp-cc"><Input id="cp-cc" value={cc} onChange={(e) => setCc(e.target.value)} /></FormField>
          <FormField label="Assunto" htmlFor="cp-subject"><Input id="cp-subject" value={subject} maxLength={250} onChange={(e) => setSubject(e.target.value)} /></FormField>
          <FormField label="Mensagem" htmlFor="cp-text"><Textarea id="cp-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} /></FormField>
          <div className="border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={withSig} onChange={(e) => setWithSig(e.target.checked)} />Incluir assinatura</label>
              <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setEditSig(!editSig)}>{sig.data?.text ? 'Editar assinatura' : 'Criar assinatura'}</button>
            </div>
            {editSig ? <div className="mt-2"><SignatureEditor onSaved={() => setEditSig(false)} /></div>
              : withSig && sig.data?.text ? <p className="mt-2 whitespace-pre-line text-sm text-muted">-- {'\n'}{sig.data.text}</p> : null}
          </div>
        </div>
      </Modal>
    </>
  );
}
