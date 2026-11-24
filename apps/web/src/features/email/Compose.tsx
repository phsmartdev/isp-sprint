/** E-mail novo pelo CRM (por uma caixa conectada) e a assinatura de cada pessoa. */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PenLine, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, FormField, Input, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Box = { id: string; kind: string; address: string; displayName: string | null; ownerId: string | null; status: string };
type Sig = { text: string; hasImage: boolean; imageWidth: number | null; maxWidth: number; updatedAt: string | null };
export const useSignature = () => useQuery({ queryKey: ['mail', 'signature'], queryFn: () => api<Sig>('/mail/signature') });
const sigImgUrl = (s?: Sig) => `/api/v1/mail/signature/image?v=${encodeURIComponent(s?.updatedAt ?? '')}`;

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const naturalWidth = (url: string) => new Promise<number>((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = url; });
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
      <SignatureImage sig={q.data} />
    </div>
  );
}

/** Assinatura em imagem: a mesma programada na caixa do Gmail. Vai embutida no fim do e-mail; o texto acima vira a versão sem formatação. */
function SignatureImage({ sig }: { sig?: Sig }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; url: string; width: number } | null>(null);
  const [width, setWidth] = useState<number>(sig?.imageWidth ?? 400);
  useEffect(() => { if (sig?.imageWidth) setWidth(sig.imageWidth); }, [sig?.imageWidth]);
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.url); }, [pending]);
  const max = sig?.maxWidth ?? 600;
  const pick = async (f?: File) => {
    if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type)) { toast({ tone: 'error', message: 'Use PNG ou JPG: muitos programas de e-mail não mostram outros formatos.' }); return; }
    if (f.size > 1024 * 1024) { toast({ tone: 'error', message: 'A imagem passa de 1 MB. Exporte em tamanho menor.' }); return; }
    const url = URL.createObjectURL(f);
    const nw = await naturalWidth(url);
    const w = Math.max(80, Math.min(max, nw || 400));
    setPending({ file: f, url, width: w }); setWidth(w);
  };
  const done = () => { void qc.invalidateQueries({ queryKey: ['mail', 'signature'] }); };
  const save = useMutation({
    mutationFn: async () => api('/mail/signature/image', { method: 'PUT', body: { data: pending ? await fileToBase64(pending.file) : await (async () => { const r = await fetch(sigImgUrl(sig)); return fileToBase64(new File([await r.blob()], 'a')); })(), width } }),
    onSuccess: () => { setPending(null); done(); toast({ tone: 'success', message: 'Imagem da assinatura salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const remove = useMutation({
    mutationFn: () => api('/mail/signature/image', { method: 'DELETE' }),
    onSuccess: () => { done(); toast({ tone: 'success', message: 'Imagem tirada; fica a assinatura em texto' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const src = pending?.url ?? (sig?.hasImage ? sigImgUrl(sig) : null);
  const changed = !!pending || (sig?.hasImage && width !== sig.imageWidth);
  return (
    <div className="border-t border-line pt-3" aria-label="Assinatura em imagem">
      <p className="text-sm font-semibold text-ink">Assinatura em imagem</p>
      <p className="text-xs text-muted">A mesma imagem programada na sua caixa do Gmail (PNG ou JPG, até 1 MB). Vai no fim dos e-mails no lugar do texto; o texto acima fica como versão para quem não carrega imagens.</p>
      {src && (
        <div className="mt-2 overflow-x-auto border border-line bg-white p-3">
          <img src={src} alt="Prévia da assinatura" style={{ width, maxWidth: '100%', height: 'auto' }} className="block" />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Button size="sm" variant="secondary" type="button" onClick={() => input.current?.click()}>{src ? 'Trocar imagem' : 'Enviar imagem'}</Button>
        {src && (
          <label className="flex items-center gap-2 text-xs text-muted" htmlFor="sig-w">Largura
            <input id="sig-w" type="range" min={80} max={max} step={10} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-40" />
            <span className="num w-14 text-ink">{width} px</span>
          </label>
        )}
        {changed && <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar imagem</Button>}
        {pending && <Button size="sm" variant="ghost" onClick={() => { setPending(null); setWidth(sig?.imageWidth ?? 400); }}>Desfazer</Button>}
        {sig?.hasImage && !pending && <Button size="sm" variant="ghost" className="text-danger" loading={remove.isPending} onClick={() => remove.mutate()}>Tirar imagem</Button>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" aria-label="Imagem da assinatura" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
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
              <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setEditSig(!editSig)}>{sig.data?.text || sig.data?.hasImage ? 'Editar assinatura' : 'Criar assinatura'}</button>
            </div>
            {editSig ? <div className="mt-2"><SignatureEditor onSaved={() => setEditSig(false)} /></div>
              : withSig && sig.data?.hasImage ? <div className="mt-2"><p className="text-sm text-muted">-- </p><img src={sigImgUrl(sig.data)} alt="Assinatura" style={{ width: sig.data.imageWidth ?? undefined, maxWidth: '100%', height: 'auto' }} /></div>
              : withSig && sig.data?.text ? <p className="mt-2 whitespace-pre-line text-sm text-muted">-- {'\n'}{sig.data.text}</p> : null}
          </div>
        </div>
      </Modal>
    </>
  );
}
