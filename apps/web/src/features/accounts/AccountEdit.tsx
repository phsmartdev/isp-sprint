/** Editar e excluir a conta: nome, contatos, segmento (onde o dinheiro está), cidade e natureza. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { SEGMENTS, SEGMENT_LABELS, type Segment } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { Drawer, useToast } from '../../components/ui/overlay';
import { Button, FormField, Input, Notice, Select } from '../../components/ui/primitives';

type Account = { id: string; name: string; phone: string | null; email: string | null; segment: Segment; city: string | null; nature?: 'publica' | 'privada' | null; contactSource: string };
const msg = (e: unknown) => (e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Não foi possível salvar.');

export function AccountEditButtons({ account }: { account: Account }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [f, setF] = useState(account);
  const erp = account.contactSource !== 'crm';
  const save = useMutation({
    mutationFn: () => api(`/contacts/${account.id}`, { method: 'PATCH', body: { ...(erp ? {} : { name: f.name }), phone: f.phone || null, email: f.email || null, segment: f.segment, city: f.city || null, nature: f.nature ?? null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['contact', account.id] }); void qc.invalidateQueries({ queryKey: ['customers'] }); setOpen(false); toast({ tone: 'success', message: 'Conta atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: msg(e) }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/contacts/${account.id}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['customers'] }); toast({ tone: 'success', message: 'Conta excluída' }); nav('/customers'); },
    onError: (e) => { setConfirm(false); toast({ tone: 'error', message: msg(e) }); },
  });
  const set = <K extends keyof Account>(k: K, v: Account[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <>
      <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => { setF(account); setOpen(true); }}>Editar conta</Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Editar conta" footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {confirm ? (
            <div className="flex flex-wrap items-center gap-2" role="alert">
              <span className="text-sm text-ink">Excluir esta conta?</span>
              <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Excluir conta</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button>
            </div>
          ) : <Button variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} disabled={erp} title={erp ? 'Conta do ERP: não pode ser excluída aqui' : 'Só contas sem oportunidade, contrato ou registro no ERP'} onClick={() => setConfirm(true)}>Excluir conta</Button>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Fechar</Button>
            <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>Salvar</Button>
          </div>
        </div>
      }>
        <div className="space-y-4">
          {erp && <Notice>Conta vinda do ERP: o nome e o CNPJ/CPF são mantidos pelo sistema de origem.</Notice>}
          <FormField label="Nome da conta" htmlFor="acc-name" required><Input id="acc-name" value={f.name} disabled={erp} onChange={(e) => set('name', e.target.value)} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Segmento" htmlFor="acc-seg" hint="Para saber onde a receita está concentrada (ex.: órgão público = Governamental)"><Select id="acc-seg" value={f.segment} onChange={(e) => set('segment', e.target.value as Segment)}>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</Select></FormField>
            <FormField label="Natureza" htmlFor="acc-nat"><Select id="acc-nat" value={f.nature ?? ''} onChange={(e) => set('nature', (e.target.value || null) as Account['nature'])}><option value="">Não informada</option><option value="publica">Pública</option><option value="privada">Privada</option></Select></FormField>
            <FormField label="Telefone" htmlFor="acc-phone"><Input id="acc-phone" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></FormField>
            <FormField label="E-mail" htmlFor="acc-email"><Input id="acc-email" type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></FormField>
            <FormField label="Cidade" htmlFor="acc-city"><Input id="acc-city" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></FormField>
          </div>
          <p className="text-xs text-muted">O CNPJ/CPF e os campos personalizados são editados no Resumo da conta.</p>
        </div>
      </Drawer>
    </>
  );
}
