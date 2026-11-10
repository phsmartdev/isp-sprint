/**
 * Zenith no contrato: campos do cadastro Zenith (o que o CRM não tinha, obrigatórios) e o espelho das telas do Zenith
 * com a origem de cada valor e as pendências. O envio aguarda a API do Zenith.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { ZENITH_MODALITIES, ZENITH_MODALITY_HINTS, ZENITH_MODALITY_LABELS, ZENITH_NO_SLA, slaDefined, type ZenithContact, type ZenithContract, type ZenithField, type ZenithLists } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { ErrorState, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';

/** Informação abaixo de cada campo que só existe por causa do Zenith. */
const ZEN = 'Cadastro Zenith';
const Tag = () => <span className="mt-1 block text-xs text-muted">{ZEN}</span>;
const hz = (extra?: string) => (extra ? `${ZEN}. ${extra}` : ZEN);

function YesNo({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <fieldset aria-labelledby={`${id}-l`}>
      <p id={`${id}-l`} className="text-sm font-semibold text-ink">{label}<span className="text-danger"> *</span></p>
      <p className="mb-1 text-xs text-muted">{hint}</p>
      <div className="flex gap-2">{[true, false].map((b) => <label key={String(b)} className={clsx('flex cursor-pointer items-center gap-2 border px-3 py-1.5 text-sm font-semibold', value === b ? 'border-primary bg-primary-soft text-ink' : 'border-line text-text')}><input type="radio" name={id} className="accent-primary" checked={value === b} onChange={() => onChange(b)} />{b ? 'Sim' : 'Não'}</label>)}</div>
      <Tag />
    </fieldset>
  );
}

function ContactFields({ id, title, c, set }: { id: string; title: string; c: ZenithContact; set: (c: ZenithContact) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-ink">{title}</p>
      <FormField label='Nome' htmlFor={`${id}-n`} required hint={ZEN}><Input id={`${id}-n`} value={c.name} onChange={(e) => set({ ...c, name: e.target.value })} /></FormField>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <FormField label='E-mail' htmlFor={`${id}-e`} hint={ZEN}><Input id={`${id}-e`} type="email" value={c.email ?? ''} onChange={(e) => set({ ...c, email: e.target.value || null })} /></FormField>
        <FormField label='Telefone' htmlFor={`${id}-p`} hint={ZEN}><Input id={`${id}-p`} inputMode="tel" value={c.phone ?? ''} onChange={(e) => set({ ...c, phone: e.target.value || null })} placeholder="(00) 00000-0000" /></FormField>
      </div>
    </div>
  );
}

const pctText = (n: number | null) => (n == null ? '' : String(n).replace('.', ','));
const pctOf = (t: string) => { const v = t.replace(/[^\d,.]/g, '').replace(',', '.'); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? Math.min(100, n) : null; };
/** Percentual com vírgula: o texto fica como digitado e o número vai para o cadastro. */
function PctInput({ id, value, onChange, placeholder }: { id: string; value: number | null; onChange: (n: number | null) => void; placeholder: string }) {
  const [t, setT] = useState(pctText(value));
  useEffect(() => { if (pctOf(t) !== value) setT(pctText(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Input id={id} inputMode="decimal" placeholder={placeholder} value={t} onChange={(e) => { const v = e.target.value.replace(/[^\d,.]/g, ''); setT(v); onChange(pctOf(v)); }} />;
}

/** Bloco do formulário do contrato. */
export function ZenithFieldset({ z, set }: { z: ZenithContract; set: (z: ZenithContract) => void }) {
  const lists = useQuery({ queryKey: ['contracts', 'zenith-lists'], queryFn: () => api<ZenithLists>('/contracts/zenith-lists'), staleTime: 300_000 });
  const p = (patch: Partial<ZenithContract>) => set({ ...z, ...patch });
  const conv = z.modality === 'convencional';
  const units = (v: string) => (v === '' ? null : Number(v.replace(/\D/g, '').slice(0, 7)));
  const slaTypes = lists.data?.slaTypes ?? [ZENITH_NO_SLA];
  const branches = (useLookups().data?.branches ?? []).map((b) => b.name);
  return (
    <fieldset className="rounded-md border border-primary/40 p-4" aria-describedby="zen-hint">
      <legend className="px-1 text-md font-bold text-ink">Cadastro Zenith</legend>
      <p id="zen-hint" className="-mt-1 mb-3 text-sm text-muted">O que o Zenith pede e o CRM não tem. Cliente, CNPJ, ICP (Score IPC), filial e número do contrato saem do CRM.</p>
      <p className="text-sm font-semibold text-ink">Modalidade do contrato<span className="text-danger"> *</span></p>
      <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2" role="radiogroup" aria-label="Modalidade do contrato no Zenith">
        {ZENITH_MODALITIES.map((m) => (
          <label key={m} className={clsx('flex cursor-pointer gap-3 border p-3', z.modality === m ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/60')}>
            <input type="radio" name="zen-mod" className="mt-1 accent-primary" checked={z.modality === m} onChange={() => p({ modality: m })} />
            <span><span className="block font-semibold text-ink">{ZENITH_MODALITY_LABELS[m]}</span><span className="block text-xs text-muted">{ZENITH_MODALITY_HINTS[m]}</span></span>
          </label>
        ))}
      </div>
      <div className="mb-4"><Tag /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label='Empresa detentora do contrato' htmlFor="zen-holder" required hint="Filial da oportunidade (Configurações → Filiais).">
          <Select id="zen-holder" value={z.holderCompany} onChange={(e) => p({ holderCompany: e.target.value })}><option value="">Escolha a filial</option>{[...new Set([...branches, ...(z.holderCompany ? [z.holderCompany] : [])])].map((b) => <option key={b} value={b}>{b}</option>)}</Select>
        </FormField>
        <FormField label='Alias / apelido' htmlFor="zen-alias" required hint={ZEN}><Input id="zen-alias" value={z.alias} onChange={(e) => p({ alias: e.target.value })} placeholder="Ex.: Enlaces corporativos" /></FormField>
        <FormField label='Tipo de SLA' htmlFor="zen-sla" required hint={ZEN}>
          <Select id="zen-sla" value={z.slaType} onChange={(e) => p({ slaType: e.target.value })}><option value="">Escolha</option>{[...new Set([...slaTypes, ...(z.slaType ? [z.slaType] : [])])].map((t) => <option key={t} value={t}>{t}</option>)}</Select>
        </FormField>
      </div>
      {slaDefined(z.slaType) && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Disponibilidade mensal mínima (%)" htmlFor="zen-av" required hint="Vira a meta de SLA do contrato (aba Execução)."><PctInput id="zen-av" placeholder="Ex.: 99,80" value={z.availabilityPct} onChange={(availabilityPct) => p({ availabilityPct })} /></FormField>
          <FormField label="Perda de pacote máxima admitida (%)" htmlFor="zen-pl" required hint="Vira a meta de SLA do contrato (aba Execução)."><PctInput id="zen-pl" placeholder="Ex.: 2" value={z.packetLossPct} onChange={(packetLossPct) => p({ packetLossPct })} /></FormField>
        </div>
      )}
      {conv && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <YesNo id="zen-mn" label="Contrato de rede gerenciada" hint="Habilita vincular em topologias." value={z.managedNetwork} onChange={(v) => p({ managedNetwork: v })} />
          <YesNo id="zen-ip" label="Possuirá IP público" hint="Habilita alocar IPs públicos nos circuitos." value={z.publicIp} onChange={(v) => p({ publicIp: v })} />
          <div>
            <p className="text-sm font-semibold text-ink">Gestão de saldos<span className="text-danger"> *</span></p>
            <label className="mb-1 mt-1 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={z.unlimitedBalance} onChange={(e) => p({ unlimitedBalance: e.target.checked })} />Ilimitado</label>
            {!z.unlimitedBalance && <div className="grid grid-cols-2 gap-2">
              <FormField label="Internet (CDI)" htmlFor="zen-cdi" required><Input id="zen-cdi" inputMode="numeric" value={z.cdiUnits ?? ''} onChange={(e) => p({ cdiUnits: units(e.target.value) })} placeholder="unidades" /></FormField>
              <FormField label="MPLS (CDM)" htmlFor="zen-cdm" required><Input id="zen-cdm" inputMode="numeric" value={z.cdmUnits ?? ''} onChange={(e) => p({ cdmUnits: units(e.target.value) })} placeholder="unidades" /></FormField>
            </div>}
            <Tag />
          </div>
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <ContactFields id="zen-tc" title="Contato técnico" c={z.techContact} set={(techContact) => p({ techContact })} />
        <ContactFields id="zen-ac" title="Contato administrativo" c={z.adminContact} set={(adminContact) => p({ adminContact })} />
      </div>
    </fieldset>
  );
}

const GROUPS: [ZenithField['group'], string][] = [['cliente', 'Novo cliente'], ['contrato', 'Modelagem do contrato'], ['sla', 'Diretriz de SLA'], ['contatos', 'Contatos']];

/** Aba do contrato: o que vai para cada campo do Zenith e de onde vem. */
export function ZenithPanel({ contractId }: { contractId: string }) {
  const q = useQuery({ queryKey: ['contracts', contractId, 'zenith'], queryFn: () => api<{ fields: ZenithField[]; missing: string[]; ready: boolean }>(`/contracts/${contractId}/zenith`) });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-5">
      {d.ready ? <Notice tone="info">Todos os campos do Zenith estão preenchidos. O envio automático começa quando a API do Zenith for conectada em Integrações.</Notice>
        : <Notice tone="warning">Falta para o Zenith: {d.missing.join(', ')}.</Notice>}
      {GROUPS.map(([g, title]) => {
        const rows = d.fields.filter((f) => f.group === g);
        return (
          <section key={g} aria-label={title}>
            <h2 className="mb-2 font-bold text-ink">{title}</h2>
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Campo no Zenith</th><th className="px-3 py-2 font-medium">Valor</th><th className="px-3 py-2 font-medium">Vem de</th></tr></thead>
              <tbody>{rows.map((f) => (
                <tr key={f.label} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold text-ink">{f.label}</td>
                  <td className="px-3 py-2">{f.missing ? <span className="inline-flex items-center gap-1 font-semibold text-danger"><CircleAlert className="h-4 w-4" aria-hidden />{f.hint ?? 'Falta preencher'}</span> : f.value ? <span className="inline-flex items-center gap-1 text-text"><CheckCircle2 className="h-4 w-4 text-[#15803D]" aria-hidden />{f.value}</span> : <span className="text-muted">Opcional</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted">{f.source === 'cadastro_zenith' ? <span className="font-semibold text-primary">cadastro Zenith</span> : f.from}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        );
      })}
    </div>
  );
}
