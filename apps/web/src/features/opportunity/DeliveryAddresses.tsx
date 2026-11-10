/**
 * Endereços de entrega: o principal e quantos outros forem precisos (licitação costuma entregar em várias unidades).
 * Cada produto da oportunidade pode apontar um deles.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Opportunity } from '../../lib/types';
import { Button, FormField, Input } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
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

/** No acompanhamento: edita o principal e os demais endereços de entrega. */
export function DeliveryAddressesPanel({ opp }: { opp: Opportunity }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useDeliveryAddresses(opp.id);
  const [principal, setPrincipal] = useState<AddressValue | null>(null);
  const [extras, setExtras] = useState<ExtraAddress[] | null>(null);
  useEffect(() => {
    if (q.data && principal === null) {
      const p = q.data.principal;
      setPrincipal({ ...emptyAddress, installCep: p.cep ?? '', installStreet: p.street ?? '', installNumber: p.number ?? '', installDistrict: p.district ?? '', installCity: p.city ?? '' });
      setExtras(q.data.items.map(fromSaved));
    }
  }, [q.data, principal]);
  const dirty = useMemo(() => {
    if (!q.data || !principal || !extras) return false;
    const p = q.data.principal;
    const savedP = [p.cep, p.street, p.number, p.district, p.city].map((x) => x ?? '').join('|');
    const curP = [principal.installCep, principal.installStreet, principal.installNumber, principal.installDistrict, principal.installCity].map((x) => x.trim()).join('|');
    return savedP !== curP || JSON.stringify(extras.filter((e) => !isBlank(e)).map(extraToInput)) !== JSON.stringify(q.data.items.map(fromSaved).map(extraToInput));
  }, [q.data, principal, extras]);
  const editable = !!q.data?.editable;
  const save = useMutation({
    mutationFn: () => api<{ opportunity: Opportunity; items: DeliveryAddress[] }>(`/opportunities/${opp.id}/delivery-addresses`, {
      method: 'PUT',
      body: { rowVersion: opp.rowVersion, principal: { cep: principal!.installCep.trim() || null, street: principal!.installStreet.trim() || null, number: principal!.installNumber.trim() || null, district: principal!.installDistrict.trim() || null, city: principal!.installCity.trim() || null }, items: extras!.filter((e) => !isBlank(e)).map(extraToInput) },
    }),
    onSuccess: (r) => {
      qc.setQueryData(['opportunity', opp.id], r.opportunity);
      setPrincipal(null); setExtras(null);
      for (const k of [['delivery-addresses', opp.id], ['opp-items', opp.id], ['timeline', opp.id]]) void qc.invalidateQueries({ queryKey: k });
      toast({ tone: 'success', message: 'Endereços de entrega salvos' });
    },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError && e.status === 409 ? 'A oportunidade mudou enquanto você editava. Aguarde salvar os outros campos e tente de novo.' : errMsg(e) }),
  });
  if (!principal || !extras) return <p className="text-sm text-muted">{q.isError ? errMsg(q.error) : 'Carregando…'}</p>;
  return (
    <section aria-label="Endereços de entrega" className="mb-6">
      <h2 className="mb-1 flex items-center gap-2 text-md font-bold text-ink"><MapPin className="h-5 w-5 text-primary" aria-hidden />Endereços de entrega</h2>
      <p className="mb-3 text-sm text-muted">Inclua quantos endereços a entrega tiver. Depois, escolha em cada produto onde ele será entregue.</p>
      <fieldset className="mb-3 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-semibold text-ink">Endereço 1 (principal)</legend>
        <AddressFields value={principal} onChange={(v) => setPrincipal((a) => ({ ...a!, ...v }))} disabled={!editable} idPrefix="da-main" hideCondominium />
      </fieldset>
      <ExtraAddressesEditor value={extras} onChange={setExtras} disabled={!editable} idPrefix="da" />
      {editable && dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setPrincipal(null); setExtras(null); }}>Descartar</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar endereços</Button>
        </div>
      )}
    </section>
  );
}
