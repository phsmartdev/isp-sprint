/**
 * Endereços de entrega: o principal e quantos outros forem precisos (licitação costuma entregar em várias unidades).
 * Cada produto da oportunidade pode apontar um deles.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Opportunity } from '../../lib/types';
import { Button, FormField, Input } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { AddressFields, emptyAddress, type AddressValue } from '../DealFields';
import { errMsg } from '../contracts/shared';

export type DeliveryAddress = { id: string; label: string | null; cep: string | null; street: string | null; number: string | null; district: string | null; city: string | null; notes: string | null };
export type ExtraAddress = { key: string; id?: string; label: string; notes: string; address: AddressValue };

let seq = 0;
export const blankExtra = (): ExtraAddress => ({ key: `ea${++seq}`, label: '', notes: '', address: emptyAddress });
const fromSaved = (a: DeliveryAddress): ExtraAddress => ({ key: a.id, id: a.id, label: a.label ?? '', notes: a.notes ?? '', address: { ...emptyAddress, installCep: a.cep ?? '', installStreet: a.street ?? '', installNumber: a.number ?? '', installDistrict: a.district ?? '', installCity: a.city ?? '' } });
/** Corpo da API (vazio vira null). */
export const extraToInput = (e: ExtraAddress) => ({ ...(e.id ? { id: e.id } : {}), label: e.label.trim() || null, cep: e.address.installCep.trim() || null, street: e.address.installStreet.trim() || null, number: e.address.installNumber.trim() || null, district: e.address.installDistrict.trim() || null, city: e.address.installCity.trim() || null, notes: e.notes.trim() || null });
const isBlank = (e: ExtraAddress) => !Object.values(extraToInput({ ...e, id: undefined })).some(Boolean);

/** Uma linha curta para mostrar o endereço (rótulo + rua, número, bairro, cidade). */
export const addressLine = (a: Pick<DeliveryAddress, 'label' | 'street' | 'number' | 'district' | 'city'>) => {
  const where = [[a.street, a.number].filter(Boolean).join(', '), a.district, a.city].filter(Boolean).join(' · ');
  return [a.label, where].filter(Boolean).join(' — ') || 'Endereço sem dados';
};

/** Lista editável dos outros endereços de entrega (além do principal). */
export function ExtraAddressesEditor({ value, onChange, disabled, idPrefix = 'ea' }: { value: ExtraAddress[]; onChange: (v: ExtraAddress[]) => void; disabled?: boolean; idPrefix?: string }) {
  const set = (key: string, patch: Partial<ExtraAddress>) => onChange(value.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  return (
    <div className="space-y-3">
      {value.map((e, i) => (
        <fieldset key={e.key} className="rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Endereço {i + 2}</legend>
          <div className="mb-3 flex items-end gap-2">
            <FormField label="Identificação" htmlFor={`${idPrefix}-${e.key}-label`} className="flex-1" hint="Ex.: Escola Municipal X, Secretaria de Saúde, Lote 2">
              <Input id={`${idPrefix}-${e.key}-label`} value={e.label} disabled={disabled} maxLength={120} onChange={(ev) => set(e.key, { label: ev.target.value })} />
            </FormField>
            {!disabled && <Button variant="ghost" aria-label={`Remover endereço ${i + 2}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(value.filter((x) => x.key !== e.key))} />}
          </div>
          <AddressFields value={e.address} onChange={(v) => set(e.key, { address: { ...e.address, ...v } })} disabled={disabled} idPrefix={`${idPrefix}-${e.key}`} hideCondominium />
          <FormField label="Observação" htmlFor={`${idPrefix}-${e.key}-notes`} className="mt-3">
            <Input id={`${idPrefix}-${e.key}-notes`} value={e.notes} disabled={disabled} maxLength={500} onChange={(ev) => set(e.key, { notes: ev.target.value })} placeholder="Responsável pelo recebimento, horário, referência…" />
          </FormField>
        </fieldset>
      ))}
      {!disabled && <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...value, blankExtra()])}>Adicionar outro endereço de entrega</Button>}
    </div>
  );
}

type Data = { principal: { cep: string | null; street: string | null; number: string | null; district: string | null; city: string | null }; items: DeliveryAddress[]; rowVersion: number; editable: boolean };
export const useDeliveryAddresses = (oppId: string) => useQuery({ queryKey: ['delivery-addresses', oppId], queryFn: () => api<Data>(`/opportunities/${oppId}/delivery-addresses`) });

/**
 * Na tabela de produtos: cadastra um endereço de entrega novo sem sair da linha.
 * Sem endereço principal ainda, o novo vira o principal. Devolve o id do endereço criado ('' = principal).
 */
export function NewDeliveryAddressModal({ opp, open, onClose, onCreated }: { opp: Opportunity; open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useDeliveryAddresses(opp.id);
  const [draft, setDraft] = useState<ExtraAddress>(blankExtra);
  useEffect(() => { if (open) setDraft(blankExtra()); }, [open]);
  const p = q.data?.principal;
  const noPrincipal = !!q.data && !(p?.cep || p?.street || p?.number || p?.district || p?.city);
  const save = useMutation({
    mutationFn: () => {
      if (isBlank(draft)) throw new Error('Preencha ao menos o logradouro ou a cidade.');
      const d = extraToInput(draft);
      const principal = noPrincipal ? { cep: d.cep, street: d.street, number: d.number, district: d.district, city: d.city } : p!;
      const items = [...q.data!.items.map(fromSaved).map(extraToInput), ...(noPrincipal ? [] : [d])];
      return api<{ opportunity: Opportunity; items: DeliveryAddress[] }>(`/opportunities/${opp.id}/delivery-addresses`, { method: 'PUT', body: { rowVersion: opp.rowVersion, principal, items } });
    },
    onSuccess: (r) => {
      qc.setQueryData(['opportunity', opp.id], r.opportunity);
      for (const k of [['delivery-addresses', opp.id], ['opp-items', opp.id], ['timeline', opp.id]]) void qc.invalidateQueries({ queryKey: k });
      onCreated(noPrincipal ? '' : r.items[r.items.length - 1]!.id);
      toast({ tone: 'success', message: 'Endereço de entrega cadastrado' });
      onClose();
    },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError && e.status === 409 ? 'A oportunidade mudou enquanto você editava. Salve os produtos e tente de novo.' : errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title={noPrincipal ? 'Endereço de entrega (principal)' : 'Novo endereço de entrega'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!q.data} onClick={() => save.mutate()}>Cadastrar endereço</Button></>}>
      <div className="space-y-3">
        <FormField label="Identificação" htmlFor="nda-label" hint="Ex.: Escola Municipal X, Secretaria de Saúde, Lote 2">
          <Input id="nda-label" value={draft.label} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
        </FormField>
        <AddressFields value={draft.address} onChange={(v) => setDraft((d) => ({ ...d, address: { ...d.address, ...v } }))} idPrefix="nda" hideCondominium />
        <FormField label="Observação" htmlFor="nda-notes">
          <Input id="nda-notes" value={draft.notes} maxLength={500} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Responsável pelo recebimento, horário, referência…" />
        </FormField>
      </div>
    </Modal>
  );
}
