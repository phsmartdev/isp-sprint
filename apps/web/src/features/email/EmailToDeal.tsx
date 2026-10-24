/**
 * E-mail → negociação: a partir de uma conversa de qualquer caixa do CRM (departamento ou pessoal), cria a negociação
 * no funil Corporativo. O e-mail vira anexo (.eml) e a resposta pela negociação sai por esta mesma conversa.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import { SALE_TYPE_KEYS, SALE_TYPE_LABELS, type SaleTypeKey } from '@isp/shared';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { Button, FormField, Input, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Thread = {
  id: string; subject: string; contact: { id: string; name: string } | null; suggestions: { id: string; name: string }[];
  messages: { direction: string; from: string; fromName: string | null }[];
};

export function EmailToDeal({ d }: { d: Thread }) {
  const nav = useNavigate();
  const toast = useToast();
  const lk = useLookups().data;
  const first = d.messages.find((m) => m.direction === 'entrada') ?? d.messages[0];
  const accounts = [...(d.contact ? [d.contact] : []), ...d.suggestions.filter((x) => x.id !== d.contact?.id)];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'existente' | 'nova'>('nova');
  const [contactId, setContactId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [doc, setDoc] = useState('');
  const [kind, setKind] = useState<SaleTypeKey | ''>('');
  const [branch, setBranch] = useState('');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const start = () => {
    setMode(accounts.length ? 'existente' : 'nova'); setContactId(accounts[0]?.id ?? '');
    const domain = first?.from.split('@')[1] ?? '';
    setName(first?.fromName?.trim() || domain.split('.')[0] || ''); setEmail(first?.from ?? ''); setDoc('');
    setKind(''); setBranch(lk?.branches[0]?.id ?? ''); setTitle(d.subject || ''); setErr(null); setOpen(true);
  };
  const corp = lk?.pipelines.find((p) => p.key === 'empresarial');
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/mail/threads/${d.id}/opportunity`, {
      method: 'POST',
      body: { opportunity: {
        pipelineId: corp!.id, saleKind: kind, branchId: branch || null, title: title.trim() || null,
        ...(mode === 'existente' ? { contactId } : { newContact: { name: name.trim(), email: email.trim() || null, document: doc.trim() || null, segment: kind === 'venda_consultiva' ? 'empresarial' : 'governamental' } }),
      } },
    }),
    onSuccess: (r) => { toast({ tone: 'success', message: 'Negociação criada a partir do e-mail' }); setOpen(false); nav(`/opportunities/${r.id}`); },
    onError: (e) => setErr(errMsg(e)),
  });
  const submit = () => {
    if (!corp) return setErr('O funil Corporativo não está ativo.');
    if (!kind) return setErr('Escolha o tipo de venda.');
    if (!branch) return setErr('Escolha a filial da venda.');
    if (mode === 'existente' && !contactId) return setErr('Escolha a conta.');
    if (mode === 'nova' && name.trim().length < 2) return setErr('Informe o nome do cliente.');
    setErr(null);
    create.mutate();
  };
  return (
    <>
      <Button variant="primary" size="sm" icon={<Briefcase className="h-4 w-4" />} onClick={start}>Transformar em negociação</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Transformar e-mail em negociação" footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" loading={create.isPending} onClick={submit}>Criar negociação</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-muted">A negociação nasce no funil Corporativo. Este e-mail vira anexo dela, e responder pela negociação sai por esta mesma conversa e caixa.</p>
          {err && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 text-sm font-semibold text-ink">Cliente</legend>
            <label className="flex items-center gap-2"><input type="radio" name="etd-mode" className="accent-primary" checked={mode === 'existente'} disabled={!accounts.length} onChange={() => setMode('existente')} />Conta existente</label>
            <label className="flex items-center gap-2"><input type="radio" name="etd-mode" className="accent-primary" checked={mode === 'nova'} onChange={() => setMode('nova')} />Nova conta</label>
          </fieldset>
          {mode === 'existente' ? (
            <FormField label="Conta" htmlFor="etd-acc"><Select id="etd-acc" value={contactId} onChange={(e) => setContactId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Nome do cliente" htmlFor="etd-name"><Input id="etd-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
              <FormField label="E-mail" htmlFor="etd-email"><Input id="etd-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
              <FormField label="CNPJ" htmlFor="etd-doc" hint="Se o CNPJ já tiver conta, use Conta existente"><Input id="etd-doc" value={doc} placeholder="00.000.000/0000-00" onChange={(e) => setDoc(e.target.value)} /></FormField>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Tipo de venda" htmlFor="etd-kind"><Select id="etd-kind" value={kind} onChange={(e) => setKind(e.target.value as SaleTypeKey | '')}><option value="">Escolha</option>{SALE_TYPE_KEYS.map((k) => <option key={k} value={k}>{SALE_TYPE_LABELS[k]}</option>)}</Select></FormField>
            <FormField label="Filial" htmlFor="etd-branch"><Select id="etd-branch" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">Escolha</option>{lk?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></FormField>
          </div>
          <FormField label="Nome do deal" htmlFor="etd-title"><Input id="etd-title" value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
        </div>
      </Modal>
    </>
  );
}
