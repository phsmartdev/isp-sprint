/**
 * Blocos do cadastro da oportunidade, usados na criação e no Sprint:
 * endereço com condomínio e campos personalizados da jornada.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Loader2, Search } from 'lucide-react';
import { api } from '../lib/api';
import { parseMoney } from '@isp/domain';
import type { LookupField } from '../lib/types';
import { Button, FormField, Input, Select, Textarea } from '../components/ui/primitives';

// ------------------------------------------------------------------ dados de apoio
export type Area = { regions: { id: string; name: string }[]; condominiums: { id: string; regionId: string; name: string; cep: string | null; street: string | null; number: string | null; district: string | null; city: string | null; blocks: string[]; hasNetwork: boolean; ctoPorts?: number | null; portsFree?: number | null }[] };
export const useArea = () => useQuery({ queryKey: ['area'], queryFn: () => api<Area>('/meta/area'), staleTime: 5 * 60_000 });

// ------------------------------------------------------------------ endereço
export type AddressValue = { installCep: string; installStreet: string; installNumber: string; installDistrict: string; installCity: string; condominiumId: string; installBlock: string; installUnit: string };
export const emptyAddress: AddressValue = { installCep: '', installStreet: '', installNumber: '', installDistrict: '', installCity: '', condominiumId: '', installBlock: '', installUnit: '' };

export function AddressFields({ value, onChange, disabled, idPrefix = 'ad', hideCondominium = false }: { value: AddressValue; onChange: (v: Partial<AddressValue>) => void; disabled?: boolean; idPrefix?: string; /** endereço de entrega/conta: sem a escolha de condomínio da venda residencial */ hideCondominium?: boolean }) {
  const area = useArea();
  const [looking, setLooking] = useState(false);
  const [cepMsg, setCepMsg] = useState<string | null>(null);
  const condo = area.data?.condominiums.find((c) => c.id === value.condominiumId);
  const pickCondo = (id: string) => {
    const c = area.data?.condominiums.find((x) => x.id === id);
    if (!c) return onChange({ condominiumId: '', installBlock: '' });
    onChange({ condominiumId: c.id, installBlock: c.blocks.length === 1 ? c.blocks[0]! : '', installCep: c.cep ?? value.installCep, installStreet: c.street ?? value.installStreet, installNumber: c.number ?? value.installNumber, installDistrict: c.district ?? value.installDistrict, installCity: c.city ?? value.installCity });
  };
  const lookup = async () => {
    if (!/^\d{5}-?\d{3}$/.test(value.installCep)) return setCepMsg('CEP no formato 00000-000');
    setLooking(true);
    setCepMsg(null);
    try {
      const r = await api<{ found: boolean; unavailable?: boolean; cep: string; street?: string; district?: string; city?: string; condominiums: { id: string; name: string }[] }>(`/meta/cep/${value.installCep}`);
      if (r.condominiums.length === 1) pickCondo(r.condominiums[0]!.id);
      if (r.found) onChange({ installCep: r.cep, installStreet: r.street || value.installStreet, installDistrict: r.district || value.installDistrict, installCity: r.city || value.installCity });
      setCepMsg(r.found ? (r.condominiums.length ? `Endereço preenchido · ${r.condominiums.length} condomínio(s) com este CEP` : 'Endereço preenchido') : r.unavailable ? 'Consulta de CEP indisponível agora: preencha à mão.' : 'CEP não encontrado.');
    } catch (e) {
      setCepMsg((e as Error).message);
    } finally {
      setLooking(false);
    }
  };
  const regionName = (id: string) => area.data?.regions.find((r) => r.id === id)?.name ?? 'Sem região';
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      {!hideCondominium && <FormField label="Condomínio" htmlFor={`${idPrefix}-condo`} className="sm:col-span-6" hint={condo ? `${regionName(condo.regionId)}${condo.hasNetwork ? ' · prédio já cabeado' : ' · prédio sem rede'}` : 'Escolha da lista ou deixe em branco se for casa/rua'}>
        <Select id={`${idPrefix}-condo`} value={value.condominiumId} disabled={disabled} onChange={(e) => pickCondo(e.target.value)}>
          <option value="">Não é condomínio / não cadastrado</option>
          {area.data?.regions.map((r) => (
            <optgroup key={r.id} label={r.name}>
              {area.data!.condominiums.filter((c) => c.regionId === r.id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.portsFree != null ? (c.portsFree > 0 ? ` · ${c.portsFree} porta(s) livre(s)` : ' · sem porta livre') : ''}</option>)}
            </optgroup>
          ))}
        </Select>
      </FormField>}
      {condo && !hideCondominium && (
        <>
          <FormField label="Bloco" htmlFor={`${idPrefix}-block`} className="sm:col-span-3">
            {condo.blocks.length ? (
              <Select id={`${idPrefix}-block`} value={value.installBlock} disabled={disabled} onChange={(e) => onChange({ installBlock: e.target.value })}>
                <option value="">Escolha</option>
                {condo.blocks.map((b) => <option key={b}>{b}</option>)}
              </Select>
            ) : <Input id={`${idPrefix}-block`} value={value.installBlock} disabled={disabled} onChange={(e) => onChange({ installBlock: e.target.value })} />}
          </FormField>
          <FormField label="Apartamento" htmlFor={`${idPrefix}-unit`} className="sm:col-span-3">
            <Input id={`${idPrefix}-unit`} value={value.installUnit} disabled={disabled} onChange={(e) => onChange({ installUnit: e.target.value })} placeholder="Ex.: 302" />
          </FormField>
        </>
      )}
      <FormField label="CEP" htmlFor={`${idPrefix}-cep`} className="sm:col-span-2" hint={cepMsg ?? undefined}>
        <div className="flex gap-2">
          <Input id={`${idPrefix}-cep`} inputMode="numeric" value={value.installCep} disabled={disabled} onChange={(e) => onChange({ installCep: e.target.value })} onBlur={() => value.installCep && !value.installStreet && void lookup()} placeholder="00000-000" />
          <Button aria-label="Buscar CEP" disabled={disabled || looking} onClick={() => void lookup()} icon={looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} />
        </div>
      </FormField>
      <FormField label="Logradouro" htmlFor={`${idPrefix}-street`} className="sm:col-span-3">
        <Input id={`${idPrefix}-street`} value={value.installStreet} disabled={disabled} onChange={(e) => onChange({ installStreet: e.target.value })} />
      </FormField>
      <FormField label="Número" htmlFor={`${idPrefix}-number`} className="sm:col-span-1">
        <Input id={`${idPrefix}-number`} value={value.installNumber} disabled={disabled} onChange={(e) => onChange({ installNumber: e.target.value })} />
      </FormField>
      <FormField label="Bairro" htmlFor={`${idPrefix}-district`} className="sm:col-span-3">
        <Input id={`${idPrefix}-district`} value={value.installDistrict} disabled={disabled} onChange={(e) => onChange({ installDistrict: e.target.value })} />
      </FormField>
      <FormField label="Cidade" htmlFor={`${idPrefix}-city`} className="sm:col-span-3">
        <Input id={`${idPrefix}-city`} value={value.installCity} disabled={disabled} onChange={(e) => onChange({ installCity: e.target.value })} />
      </FormField>
    </div>
  );
}

// ------------------------------------------------------------------ kit de equipamentos (campo guardado da oportunidade)
export type KitValue = { equipmentId: string; qty: number }[] | null;

// ------------------------------------------------------------------ campos personalizados
export type CustomValues = Record<string, string | number | boolean | null>;

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Valor em reais com a máscara brasileira: mostra "R$ 500.000,00" e guarda o número (500000). */
export function MoneyInput({ id, value, onChange, disabled }: { id: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? '' : brl(value));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>R$</span>
      <Input id={id} inputMode="decimal" className="pl-9 num" placeholder="0,00" value={shown} disabled={disabled}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ''); setText(t); const c = parseMoney(t); onChange(t === '' ? null : c === null ? value : c / 100); }}
        onBlur={() => setText(null)} />
    </div>
  );
}

export function CustomFieldsEditor({ fields, value, onChange, disabled, idPrefix = 'cf' }: { fields: LookupField[]; value: CustomValues; onChange: (key: string, v: string | number | boolean | null) => void; disabled?: boolean; idPrefix?: string }) {
  if (!fields.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const v = value[f.key];
        const label = f.label;
        if (f.type === 'sim_nao')
          return (
            <FormField key={f.key} label={label} htmlFor={id} required={f.required}>
              <Select id={id} value={v === true ? 'sim' : v === false ? 'nao' : ''} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value === '' ? null : e.target.value === 'sim')}>
                <option value="">—</option><option value="sim">Sim</option><option value="nao">Não</option>
              </Select>
            </FormField>
          );
        if (f.type === 'lista')
          return (
            <FormField key={f.key} label={label} htmlFor={id} required={f.required}>
              <Select id={id} value={(v as string) ?? ''} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value || null)}>
                <option value="">—</option>
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </Select>
            </FormField>
          );
        if (f.type === 'texto_longo')
          return (
            <FormField key={f.key} label={label} htmlFor={id} required={f.required} className="sm:col-span-2">
              <Textarea id={id} value={(v as string) ?? ''} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value || null)} />
            </FormField>
          );
        if (f.type === 'moeda')
          return (
            <FormField key={f.key} label={label} htmlFor={id} required={f.required}>
              <MoneyInput id={id} value={typeof v === 'number' ? v : null} disabled={disabled} onChange={(n) => onChange(f.key, n)} />
            </FormField>
          );
        if (f.type === 'numero')
          return (
            <FormField key={f.key} label={label} htmlFor={id} required={f.required}>
              <Input id={id} inputMode="decimal" value={v === null || v === undefined ? '' : String(v).replace('.', ',')} disabled={disabled} onChange={(e) => { const t = e.target.value.replace(/\./g, '').replace(',', '.'); onChange(f.key, t === '' ? null : Number.isFinite(Number(t)) ? Number(t) : (v as number) ?? null); }} />
            </FormField>
          );
        return (
          <FormField key={f.key} label={label} htmlFor={id} required={f.required}>
            <Input id={id} type={f.type === 'data' ? 'date' : 'text'} value={(v as string) ?? ''} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value || null)} />
          </FormField>
        );
      })}
    </div>
  );
}

export const CondoIcon = Building2;
