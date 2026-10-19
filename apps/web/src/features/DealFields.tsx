/**
 * Blocos do cadastro da oportunidade, usados na criação e no Sprint:
 * endereço com condomínio, dados de viabilidade, campos personalizados da jornada e o painel de viabilidade.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Building2, Calculator, Loader2, MapPin, Search } from 'lucide-react';
import { SALE_TYPES, SALE_TYPE_LABELS, type SaleType, type ViabilityResult } from '@isp/domain';
import { api } from '../lib/api';
import { fmtBRL } from '../lib/format';
import { toCents } from '@isp/domain';
import type { LookupField } from '../lib/types';
import { Button, FormField, Input, Select, Textarea } from '../components/ui/primitives';

// ------------------------------------------------------------------ dados de apoio
export type Area = { regions: { id: string; name: string }[]; condominiums: { id: string; regionId: string; name: string; cep: string | null; street: string | null; number: string | null; district: string | null; city: string | null; blocks: string[]; hasNetwork: boolean }[] };
export const useArea = () => useQuery({ queryKey: ['area'], queryFn: () => api<Area>('/meta/area'), staleTime: 5 * 60_000 });
export type ViabilityMeta = { equipments: { id: string; name: string; costCents: number }[]; routes: { id: string; name: string; requiresApproval: boolean }[]; defaultActivationFeeCents: number | null; configured: boolean };
export const useViabilityMeta = () => useQuery({ queryKey: ['viability-meta'], queryFn: () => api<ViabilityMeta>('/meta/viability'), staleTime: 5 * 60_000 });

// ------------------------------------------------------------------ endereço
export type AddressValue = { installCep: string; installStreet: string; installNumber: string; installDistrict: string; installCity: string; condominiumId: string; installBlock: string; installUnit: string };
export const emptyAddress: AddressValue = { installCep: '', installStreet: '', installNumber: '', installDistrict: '', installCity: '', condominiumId: '', installBlock: '', installUnit: '' };

export function AddressFields({ value, onChange, disabled, idPrefix = 'ad' }: { value: AddressValue; onChange: (v: Partial<AddressValue>) => void; disabled?: boolean; idPrefix?: string }) {
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
      <FormField label="Condomínio" htmlFor={`${idPrefix}-condo`} className="sm:col-span-6" hint={condo ? `${regionName(condo.regionId)}${condo.hasNetwork ? ' · prédio já cabeado' : ' · prédio sem rede'}` : 'Escolha da lista ou deixe em branco se for casa/rua'}>
        <Select id={`${idPrefix}-condo`} value={value.condominiumId} disabled={disabled} onChange={(e) => pickCondo(e.target.value)}>
          <option value="">Não é condomínio / não cadastrado</option>
          {area.data?.regions.map((r) => (
            <optgroup key={r.id} label={r.name}>
              {area.data!.condominiums.filter((c) => c.regionId === r.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </Select>
      </FormField>
      {condo && (
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

// ------------------------------------------------------------------ viabilidade (entrada)
export type ViabilityValue = { saleType: SaleType | ''; cableMeters: string; activationFee: string };

export function ViabilityInputs({ value, onChange, disabled, idPrefix = 'vb' }: { value: ViabilityValue; onChange: (v: Partial<ViabilityValue>) => void; disabled?: boolean; idPrefix?: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <fieldset className="sm:col-span-1">
        <legend className="mb-1.5 text-sm font-semibold text-ink">Tipo de venda</legend>
        <div className="flex rounded-md border border-line bg-surface p-1" role="radiogroup" aria-label="Tipo de venda">
          {SALE_TYPES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={value.saleType === t} disabled={disabled} onClick={() => onChange({ saleType: t })} className={clsx('flex-1 rounded-sm px-3 py-2 text-sm', value.saleType === t ? 'bg-primary font-semibold text-white' : 'text-ink hover:bg-surface-2')}>
              {SALE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </fieldset>
      <FormField label="Metragem de cabo (m)" htmlFor={`${idPrefix}-m`} hint="Do ponto de rede até o cliente">
        <Input id={`${idPrefix}-m`} inputMode="numeric" value={value.cableMeters} disabled={disabled} onChange={(e) => onChange({ cableMeters: e.target.value.replace(/\D/g, '') })} placeholder="Ex.: 80" />
      </FormField>
      <FormField label="Taxa de ativação (R$)" htmlFor={`${idPrefix}-fee`} hint="Cobrada do cliente; abate o CAC">
        <Input id={`${idPrefix}-fee`} inputMode="decimal" value={value.activationFee} disabled={disabled} onChange={(e) => onChange({ activationFee: e.target.value })} placeholder="0,00" />
      </FormField>
    </div>
  );
}

export const viabilityPayload = (v: ViabilityValue) => ({
  saleType: v.saleType || null,
  cableMeters: v.cableMeters === '' ? null : Number(v.cableMeters),
  activationFeeCents: v.activationFee.trim() === '' ? null : toCents(v.activationFee),
});

// ------------------------------------------------------------------ caminho e equipamentos (troca manual)
export type KitValue = { equipmentId: string; qty: number }[] | null;

/** Caminho e equipamentos escolhidos à mão. Vazio = segue a regra de metragem/banda e o kit do caminho. */
export function EquipmentOverride({ routeId, equipment, suggested, onChange, disabled, idPrefix = 'eq' }: {
  routeId: string; equipment: KitValue; suggested?: { routeName: string | null }; onChange: (v: { routeId?: string; equipment?: KitValue }) => void; disabled?: boolean; idPrefix?: string;
}) {
  const meta = useViabilityMeta();
  const manualKit = equipment !== null;
  const qty = (id: string) => equipment?.find((e) => e.equipmentId === id)?.qty ?? 0;
  if (!meta.data?.configured) return null;
  return (
    <details className="rounded-md border border-line px-3 py-2" open={!!routeId || manualKit}>
      <summary className="cursor-pointer text-sm font-semibold text-ink">Caminho e equipamentos {routeId || manualKit ? '(ajustado à mão)' : '(automático)'}</summary>
      <div className="mt-3 space-y-3">
        <FormField label="Caminho de entrega" htmlFor={`${idPrefix}-route`} hint={routeId ? 'Escolhido à mão' : `Pela regra${suggested?.routeName ? `: ${suggested.routeName}` : ''}`}>
          <Select id={`${idPrefix}-route`} value={routeId} disabled={disabled} onChange={(e) => onChange({ routeId: e.target.value })}>
            <option value="">Automático (regra de metragem e banda)</option>
            {meta.data.routes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.requiresApproval ? ' (exige aprovação)' : ''}</option>)}
          </Select>
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={manualKit} disabled={disabled} onChange={(e) => onChange({ equipment: e.target.checked ? [] : null })} />
          Escolher os equipamentos (em vez do kit do caminho)
        </label>
        {manualKit && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {meta.data.equipments.map((eq) => (
              <li key={eq.id} className="flex items-center gap-2 text-sm">
                <Input aria-label={`Quantidade de ${eq.name}`} type="number" min={0} className="h-8 w-20" disabled={disabled} value={qty(eq.id)}
                  onChange={(e) => { const q = Math.max(0, Math.min(100_000, Math.round(Number(e.target.value || 0)))); onChange({ equipment: [...(equipment ?? []).filter((x) => x.equipmentId !== eq.id), ...(q ? [{ equipmentId: eq.id, qty: q }] : [])] }); }} />
                <span className="text-ink">{eq.name}</span><span className="num text-muted">{fmtBRL(eq.costCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ campos personalizados
export type CustomValues = Record<string, string | number | boolean | null>;

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
        if (f.type === 'numero' || f.type === 'moeda')
          return (
            <FormField key={f.key} label={f.type === 'moeda' ? `${label} (R$)` : label} htmlFor={id} required={f.required}>
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

// ------------------------------------------------------------------ painel de viabilidade
export function ViabilityPanel({ v, loading, title = 'Viabilidade da venda', compact }: { v: ViabilityResult | null | undefined; loading?: boolean; title?: string; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  if (!v) return (
    <section className="card p-5">
      <h2 className="mb-2 flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" />{title}</h2>
      <p className="text-sm text-muted">{loading ? 'Calculando…' : 'Escolha o plano, informe a metragem e o tipo de venda para ver custo, comissão, CAC e payback.'}</p>
    </section>
  );
  const pay = v.paybackMonths;
  const payTone = pay === null ? 'text-danger' : pay <= 6 ? 'text-success' : pay <= 12 ? 'text-[#B45309]' : 'text-danger';
  const ratio = v.ltv.ratio;
  return (
    <section className="card p-5" aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" />{title}</h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Recalculando" />}
      </div>
      {v.route && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span><span className="font-semibold text-ink">{v.route.name}</span>{v.route.byRule && <span className="block text-xs text-muted">pela regra “{v.route.byRule}”</span>}</span>
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2">
        <Metric label="Sua comissão" value={fmtBRL(v.commission.cents)} hint={v.commission.rule ? `${v.commission.rule}${v.commission.detail ? ` · ${v.commission.detail}` : ''}` : 'sem regra'} tone="text-success" />
        <Metric label="CAC" value={fmtBRL(v.cacCents)} hint="comissão + lançamento − ativação" />
        <Metric label="Margem mensal" value={fmtBRL(v.marginMonthlyCents)} hint="após tributos e parceiros" />
        <Metric label="Payback" value={pay === null ? 'não se paga' : `${String(pay).replace('.', ',')} meses`} tone={payTone} />
        <Metric label="LTV desta venda" value={v.ltv.dealCents === null ? '—' : fmtBRL(v.ltv.dealCents)} hint={v.ltv.months ? `${String(v.ltv.months).replace('.', ',')} meses · ${v.ltv.source === 'base' ? `base (n=${v.ltv.sample})` : 'parâmetro'}` : 'sem vida média'} />
        <Metric label="LTV histórico" value={v.ltv.historicalCents === null ? '—' : fmtBRL(v.ltv.historicalCents)} hint={ratio !== null ? `LTV/CAC desta venda: ${String(ratio).replace('.', ',')}` : undefined} tone={ratio !== null && ratio < 3 ? 'text-[#B45309]' : undefined} />
      </dl>
      {v.alerts.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {v.alerts.map((a) => <li key={a} className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-[#9A5B00]"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{a}</li>)}
        </ul>
      )}
      {v.missing.length > 0 && <p className="mt-3 text-xs text-muted">Para o cálculo completo falta: {v.missing.join(', ')}.</p>}
      <button className="link mt-3 text-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Ocultar detalhes' : 'Ver detalhes do cálculo'}</button>
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          <Lines title="Custos de entrada (uma vez)" lines={v.oneTimeCosts} extra={[...(v.commission.lines?.length ? v.commission.lines.map((l) => ({ ...l, label: `Comissão · ${l.label}` })) : [{ label: 'Comissão', cents: v.commission.cents }]), { label: 'Taxa de ativação (abate)', cents: -v.revenue.activationFeeCents }]} total={{ label: 'CAC', cents: v.cacCents }} />
          <Lines title="Por mês" lines={[{ label: 'Mensalidade', cents: v.revenue.monthlyCents }, ...v.monthlyDeductions.map((l) => ({ ...l, cents: -l.cents }))]} total={{ label: 'Margem mensal', cents: v.marginMonthlyCents }} />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={clsx('num text-md font-extrabold', tone ?? 'text-ink')}>{value}</dd>
      {hint && <dd className="text-2xs leading-tight text-faint">{hint}</dd>}
    </div>
  );
}

function Lines({ title, lines, extra = [], total }: { title: string; lines: { label: string; cents: number; detail?: string }[]; extra?: { label: string; cents: number; detail?: string }[]; total: { label: string; cents: number } }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-muted">{title}</p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {[...lines, ...extra].map((l, i) => (
          <li key={`${l.label}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-text">{l.label}{l.detail ? <span className="block text-2xs text-faint">{l.detail}</span> : null}</span>
            <span className={clsx('num', l.cents < 0 ? 'text-danger' : 'text-ink')}>{fmtBRL(l.cents)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between bg-surface-2 px-3 py-1.5 font-bold"><span>{total.label}</span><span className="num">{fmtBRL(total.cents)}</span></li>
      </ul>
    </div>
  );
}

export const CondoIcon = Building2;
