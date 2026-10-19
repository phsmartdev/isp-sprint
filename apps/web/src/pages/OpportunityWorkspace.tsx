import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, CalendarPlus, CheckCircle2, Handshake, ListChecks, Mail, MapPin, Phone, Send, UserRound, XCircle } from 'lucide-react';
import {
  LOSS_REASON_LABELS, OPPORTUNITY_REASONS, REASON_LABELS, SEGMENTS, SEGMENT_LABELS, toCents,
  type CustomerLifecycle, type LossReason, type OpportunityReason, type SaleType, type Segment, type ViabilityResult,
} from '@isp/domain';
import { api, ApiError, qs } from '../lib/api';
import { fmtBRL, fmtDate, fmtDateTime, isoToLocalInput, localInputToIso } from '../lib/format';
import { useDebounced, useLookups } from '../lib/hooks';
import type { Activity, Opportunity, Paged } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Breadcrumb, Button, ChipGroup, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, SaveStatus, Select, Tabs, Textarea } from '../components/ui/primitives';
import { Drawer, Modal, useToast } from '../components/ui/overlay';
import { ContractChip, CoverageChip, LifecycleChip, ProposalChip, StageChip, productLabel } from '../components/badges';
import { SprintTimer } from '../features/SprintTimer';
import { Timeline } from '../features/Timeline';
import { ActivityComposer } from '../features/ActivityComposer';
import { ActivityRow } from '../features/ActivityRow';
import { TransitionDialog, isClosed, needsDialog, type TransitionRequest } from '../features/TransitionDialog';
import { useTransitionMutation } from '../features/useTransition';
import { AddressFields, CustomFieldsEditor, EquipmentOverride, ViabilityInputs, ViabilityPanel, emptyAddress, useViabilityMeta, viabilityPayload, type AddressValue, type CustomValues, type KitValue, type ViabilityValue } from '../features/DealFields';
import { Attachments } from '../features/Attachments';
import { EmailComposer } from '../features/EmailComposer';
import { Objections, StageScript } from '../features/Playbook';
import { EngineeringPanel } from '../features/Engineering';

const toReais = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

function Panel({ title, icon, children, className }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('card p-5', className)}>
      <h2 className="mb-3 flex items-center gap-2 text-md font-bold text-ink">{icon}{title}</h2>
      {children}
    </section>
  );
}

// =================================================================== Nova oportunidade

type ContactHit = { id: string; name: string; phone: string | null; segment: Segment; lifecycle: CustomerLifecycle | null; externalId: string | null };

export function NewOpportunityPage() {
  const { level } = useAuth();
  const lookups = useLookups();
  const vmeta = useViabilityMeta();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'novo' | 'existente'>('novo');
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [segment, setSegment] = useState<Segment>('residencial');
  const [search, setSearch] = useState('');
  const [contact, setContact] = useState<ContactHit | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [planId, setPlanId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [pipelineId, setPipelineId] = useState(params.get('pipelineId') ?? '');
  const [reasons, setReasons] = useState<OpportunityReason[]>([]);
  const [address, setAddress] = useState<AddressValue>(emptyAddress);
  const [vb, setVb] = useState<ViabilityValue>({ saleType: '', cableMeters: '', activationFee: '' });
  const [custom, setCustom] = useState<CustomValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const fee = vmeta.data?.defaultActivationFeeCents;
    if (fee !== null && fee !== undefined) setVb((v) => (v.activationFee === '' ? { ...v, activationFee: toReais(fee) } : v));
  }, [vmeta.data]);
  const dq = useDebounced(search.trim(), 250);
  const hits = useQuery({ queryKey: ['contacts', dq], enabled: mode === 'existente' && dq.length >= 2, queryFn: () => api<{ items: ContactHit[] }>(`/contacts${qs({ q: dq })}`) });
  const seg = mode === 'existente' ? contact?.segment ?? 'residencial' : segment;
  const journeys = (lookups.data?.pipelines ?? []).filter((p) => p.allowed);
  const autoJourney = journeys.find((p) => p.segments.includes(seg)) ?? journeys.find((p) => p.isDefault) ?? journeys[0];
  const journey = journeys.find((p) => p.id === pipelineId) ?? autoJourney;
  const plans = (lookups.data?.plans ?? []).filter((p) => p.segment === seg || (seg !== 'residencial' && p.segment !== 'residencial'));
  const assign = level('oportunidades') !== 'proprio';

  const simInput = useDebounced(JSON.stringify({ planId: planId || null, ...viabilityPayload(vb), location: address.condominiumId ? 'condominio' : address.installStreet ? 'rua' : null }), 350);
  const sim = useQuery({ queryKey: ['simulate', simInput], enabled: !!planId || vb.cableMeters !== '', queryFn: () => api<ViabilityResult>('/viability/simulate', { method: 'POST', body: JSON.parse(simInput) }), placeholderData: (p) => p });

  const create = useMutation({
    mutationFn: () =>
      api<Opportunity>('/opportunities', {
        method: 'POST',
        body: {
          ...(mode === 'existente' ? { contactId: contact?.id } : { newContact: { name, phone: phone || null, email: email || null, segment, city: address.installCity || null } }),
          title: title.trim() || null,
          leadId: params.get('leadId') || null,
          sourceId: sourceId || null,
          campaignId: campaignId || null,
          channel: lookups.data?.sources.find((s) => s.id === sourceId)?.name ?? null,
          planId: planId || null,
          ownerId: ownerId || null,
          pipelineId: journey?.id ?? null,
          reasons,
          ...Object.fromEntries(Object.entries(address).map(([k, v]) => [k, v || null])),
          ...viabilityPayload(vb),
          custom,
        },
      }),
    onSuccess: (o) => {
      qc.setQueryData(['opportunity', o.id], o);
      for (const k of ['pipeline', 'opportunities', 'home', 'leads']) qc.invalidateQueries({ queryKey: [k] });
      nav(`/opportunities/${o.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      toast({ tone: 'error', message: (e as Error).message });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    const errs: Record<string, string> = {};
    if (mode === 'novo' && name.trim().length < 2) errs['newContact.name'] = 'Informe o nome do cliente (ao menos 2 letras)';
    if (mode === 'existente' && !contact) errs.contactId = 'Selecione um cliente da lista';
    if (vb.activationFee.trim() && toCents(vb.activationFee) === null) errs.activationFeeCents = 'Use o formato 50,00';
    for (const f of journey?.fields ?? []) if (f.required && (custom[f.key] === undefined || custom[f.key] === null || custom[f.key] === '')) errs[`custom.${f.key}`] = 'Obrigatório';
    setErrors(errs);
    if (!Object.keys(errs).length) create.mutate();
    else toast({ tone: 'error', message: 'Confira os campos destacados.' });
  };

  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Oportunidades', to: '/opportunities' }, { label: 'Nova' }]} />
      <div className="mb-5 flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary"><Handshake className="h-7 w-7" /></span>
        <div>
          <h1 className="text-xl font-extrabold text-ink">Nova oportunidade</h1>
          <p className="text-muted">Preencha o que já souber. O cronômetro de 7 minutos começa quando você criar.</p>
        </div>
      </div>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <Panel title="Oportunidade" icon={<Handshake className="h-5 w-5 text-primary" />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Nome do deal" htmlFor="no-title" hint="Em branco: plano + cliente">
                <Input id="no-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: 500 Mega — Ap. 302 Bloco B" />
              </FormField>
              <FormField label="Jornada" htmlFor="no-pipe" hint={pipelineId ? undefined : `Pelo tipo do deal: ${autoJourney?.name ?? '—'}`}>
                <Select id="no-pipe" value={pipelineId} onChange={(e) => { setPipelineId(e.target.value); setCustom({}); }}>
                  <option value="">Automática</option>
                  {journeys.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Canal de entrada" htmlFor="no-source">
                <Select id="no-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  <option value="">Não informado</option>
                  {lookups.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Campanha" htmlFor="no-campaign" hint="Liga a venda ao resultado da campanha">
                <Select id="no-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                  <option value="">Nenhuma</option>
                  {lookups.data?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Responsável" htmlFor="no-owner" hint={assign ? 'Em branco: você' : 'Você'}>
                <Select id="no-owner" value={ownerId} disabled={!assign} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">Eu mesmo</option>
                  {assign && lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </FormField>
            </div>
          </Panel>

          <Panel title="Cliente" icon={<UserRound className="h-5 w-5 text-primary" />}>
            <div role="radiogroup" aria-label="Quem é o cliente" className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['novo', 'existente'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={clsx('rounded-md border px-4 py-3 text-left', mode === m ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong')}>
                  <span className="block font-bold text-ink">{m === 'novo' ? 'Cliente novo' : 'Cliente da carteira'}</span>
                  <span className="block text-sm text-muted">{m === 'novo' ? 'Cria um contato provisório' : 'Busca por nome, telefone ou código'}</span>
                </button>
              ))}
            </div>
            {mode === 'novo' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Nome do cliente" htmlFor="no-name" required error={errors['newContact.name']}>
                  <Input id="no-name" value={name} invalid={!!errors['newContact.name']} onChange={(e) => setName(e.target.value)} autoFocus />
                </FormField>
                <FormField label="Tipo do deal" htmlFor="no-seg">
                  <Select id="no-seg" value={segment} onChange={(e) => { setSegment(e.target.value as Segment); setPlanId(''); }}>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</Select>
                </FormField>
                <FormField label="Telefone" htmlFor="no-phone" error={errors['newContact.phone']}>
                  <Input id="no-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(79) 9 0000-0000" />
                </FormField>
                <FormField label="E-mail" htmlFor="no-email" error={errors['newContact.email']}>
                  <Input id="no-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </FormField>
              </div>
            ) : (
              <div>
                <FormField label="Buscar cliente" htmlFor="no-search" required error={errors.contactId}>
                  <Input id="no-search" value={search} invalid={!!errors.contactId} onChange={(e) => { setSearch(e.target.value); setContact(null); }} placeholder="Digite ao menos 2 letras" autoFocus />
                </FormField>
                {contact ? (
                  <div className="mt-2 flex items-center justify-between rounded-md border border-primary bg-primary-soft px-3 py-2">
                    <span><span className="font-semibold text-ink">{contact.name}</span> <span className="text-sm text-muted">{contact.phone} · {SEGMENT_LABELS[contact.segment]}</span></span>
                    <Button size="sm" variant="ghost" onClick={() => { setContact(null); setPlanId(''); }}>Trocar</Button>
                  </div>
                ) : dq.length >= 2 && (
                  <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line" aria-label="Resultados">
                    {hits.isLoading && <li className="px-3 py-2 text-sm text-muted">Buscando…</li>}
                    {hits.data?.items.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhum cliente encontrado na sua carteira. Use “Cliente novo”.</li>}
                    {hits.data?.items.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setContact(c); setPlanId(''); }}>
                          <span><span className="block font-semibold text-ink">{c.name}</span><span className="block text-sm text-muted">{c.phone ?? 'sem telefone'} · {SEGMENT_LABELS[c.segment]}</span></span>
                          {c.lifecycle && <LifecycleChip s={c.lifecycle} />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {contact?.lifecycle && contact.lifecycle !== 'prospect' && <div className="mt-2"><Notice tone="warning">Cliente já existente{contact.externalId ? ` (${contact.externalId})` : ''}. Confira os contratos ativos antes de qualquer nova contratação.</Notice></div>}
              </div>
            )}
          </Panel>

          <Panel title="Endereço de instalação" icon={<MapPin className="h-5 w-5 text-primary" />}>
            <AddressFields value={address} onChange={(v) => setAddress((a) => ({ ...a, ...v }))} idPrefix="no-ad" />
          </Panel>

          <Panel title="Plano e viabilidade" icon={<Building2 className="h-5 w-5 text-primary" />}>
            <div className="space-y-3">
              <FormField label="Plano" htmlFor="no-plan" hint="O valor vem do catálogo de planos">
                <Select id="no-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">Ainda não definido</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.speedMbps ? ` (${p.speedMbps} Mbps)` : ''} — {fmtBRL(p.priceCents)}/mês</option>)}
                </Select>
              </FormField>
              <ViabilityInputs value={vb} onChange={(v) => setVb((x) => ({ ...x, ...v }))} idPrefix="no-vb" />
              {errors.activationFeeCents && <p className="text-sm text-danger">{errors.activationFeeCents}</p>}
              {vmeta.data && !vmeta.data.configured && <Notice tone="warning">Os parâmetros de viabilidade ainda não foram cadastrados (Configurações → Viabilidade). O cálculo fica incompleto.</Notice>}
            </div>
          </Panel>

          {journey && journey.fields.length > 0 && (
            <Panel title={`Campos da jornada ${journey.name}`}>
              <CustomFieldsEditor fields={journey.fields} value={custom} onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))} idPrefix="no-cf" />
              {Object.keys(errors).some((k) => k.startsWith('custom.')) && <p className="mt-2 text-sm text-danger">Preencha os campos obrigatórios da jornada.</p>}
            </Panel>
          )}

          <Panel title="O que motivou o contato?">
            <ChipGroup legend="Pode marcar mais de um" options={OPPORTUNITY_REASONS} value={reasons} onChange={setReasons} labels={REASON_LABELS} />
          </Panel>
        </div>
        <aside className="space-y-4 xl:sticky xl:top-[88px] xl:self-start">
          <ViabilityPanel v={sim.data} loading={sim.isFetching} title="Prévia da viabilidade" />
          <div className="card flex flex-col gap-2 p-5">
            <Button type="submit" variant="primary" size="lg" loading={create.isPending}>Iniciar Sprint</Button>
            <Button onClick={() => nav(-1)}>Cancelar</Button>
          </div>
        </aside>
      </form>
    </div>
  );
}

// =================================================================== Workspace

type Fields = AddressValue & {
  title: string;
  reasons: OpportunityReason[];
  sourceId: string;
  campaignId: string;
  planId: string;
  nextAction: string;
  nextActionAt: string;
  notes: string;
  saleType: SaleType | '';
  cableMeters: string;
  activationFee: string;
  custom: CustomValues;
  routeId: string;
  equipment: KitValue;
  engineeringStatus: Opportunity['engineeringStatus'];
  engineeringTicket: string;
  executiveTicket: string;
};

const toFields = (o: Opportunity): Fields => ({
  title: o.title,
  reasons: o.reasons,
  sourceId: o.sourceId ?? '',
  campaignId: o.campaignId ?? '',
  planId: o.planId ?? '',
  nextAction: o.nextAction ?? '',
  nextActionAt: isoToLocalInput(o.nextActionAt),
  notes: o.notes ?? '',
  installCep: o.installCep ?? '',
  installStreet: o.installStreet ?? '',
  installNumber: o.installNumber ?? '',
  installDistrict: o.installDistrict ?? '',
  installCity: o.installCity ?? '',
  condominiumId: o.condominiumId ?? '',
  installBlock: o.installBlock ?? '',
  installUnit: o.installUnit ?? '',
  saleType: o.saleType ?? '',
  cableMeters: o.cableMeters === null ? '' : String(o.cableMeters),
  activationFee: toReais(o.activationFeeCents),
  custom: (o.custom ?? {}) as CustomValues,
  routeId: o.routeId ?? '',
  equipment: o.equipment,
  engineeringStatus: o.engineeringStatus ?? 'nao_necessaria',
  engineeringTicket: o.engineeringTicket ?? '',
  executiveTicket: o.executiveTicket ?? '',
});

const diffFields = (a: Fields, b: Fields) => (Object.keys(a) as (keyof Fields)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const ADDRESS_KEYS = Object.keys(emptyAddress) as (keyof AddressValue)[];

function toPatch(f: Fields, keys: (keyof Fields)[], base: Fields) {
  const p: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === 'nextActionAt') p.nextActionAt = localInputToIso(f.nextActionAt);
    else if (k === 'sourceId') p.sourceId = f.sourceId || null;
    else if (k === 'campaignId') p.campaignId = f.campaignId || null;
    else if (k === 'planId') p.planId = f.planId || null;
    else if (k === 'title') p.title = f.title.trim() || null;
    else if (k === 'saleType') p.saleType = f.saleType || null;
    else if (k === 'cableMeters') p.cableMeters = f.cableMeters === '' ? null : Number(f.cableMeters);
    else if (k === 'routeId') p.routeId = f.routeId || null;
    else if (k === 'equipment') p.equipment = f.equipment;
    else if (k === 'engineeringStatus') p.engineeringStatus = f.engineeringStatus;
    else if (k === 'engineeringTicket') p.engineeringTicket = f.engineeringTicket.trim() || null;
    else if (k === 'executiveTicket') p.executiveTicket = f.executiveTicket.trim() || null;
    else if (k === 'activationFee') p.activationFeeCents = f.activationFee.trim() === '' ? null : toCents(f.activationFee);
    else if (k === 'custom') {
      // só o que mudou; chave apagada vai como null
      const out: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(f.custom), ...Object.keys(base.custom)])) if (JSON.stringify(f.custom[key]) !== JSON.stringify(base.custom[key])) out[key] = f.custom[key] ?? null;
      p.custom = out;
    } else if (ADDRESS_KEYS.includes(k as keyof AddressValue)) p[k] = (f[k] as string) || null;
    else p[k] = (f[k] as string | string[]) === '' ? null : f[k];
  }
  return p;
}

const draftKey = (id: string) => `opp-draft:${id}`;
type Draft = { rowVersion: number; fields: Fields; savedAt: string };

/** Autosave com debounce, rascunho local para recuperar após refresh e envio ao sair. */
function useAutosave(opp: Opportunity | undefined) {
  const qc = useQueryClient();
  const [base, setBase] = useState<Opportunity | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [restored, setRestored] = useState(false);
  const inFlight = useRef(false);
  const latest = useRef<{ base: Opportunity | null; fields: Fields | null }>({ base: null, fields: null });
  latest.current = { base, fields };

  useEffect(() => {
    if (!opp) return;
    if (!base) {
      setBase(opp);
      let initial = toFields(opp);
      try {
        const raw = localStorage.getItem(draftKey(opp.id));
        if (raw) {
          const d = JSON.parse(raw) as Draft;
          const merged = { ...initial, ...d.fields };
          if (d.rowVersion === opp.rowVersion && diffFields(merged, initial).length) {
            initial = merged;
            setRestored(true);
          } else localStorage.removeItem(draftKey(opp.id));
        }
      } catch { /* sem storage */ }
      setFields(initial);
      return;
    }
    if (opp.rowVersion > base.rowVersion) {
      const dirtyKeys = fields ? diffFields(fields, toFields(base)) : [];
      const server = toFields(opp);
      setFields((f) => (f ? ({ ...server, ...Object.fromEntries(dirtyKeys.map((k) => [k, f[k]])) } as Fields) : server));
      setBase(opp);
    }
  }, [opp]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyKeys = useMemo(() => (base && fields ? diffFields(fields, toFields(base)) : []), [base, fields]);
  const debounced = useDebounced(fields, 900);

  const save = useCallback(async () => {
    const { base: b, fields: f } = latest.current;
    if (!b || !f || inFlight.current) return;
    const keys = diffFields(f, toFields(b));
    if (!keys.length) return;
    if (keys.includes('activationFee') && f.activationFee.trim() && toCents(f.activationFee) === null) { setStatus('error'); setError('Taxa de ativação no formato 50,00'); return; }
    inFlight.current = true;
    setStatus('saving');
    try {
      const updated = await api<Opportunity>(`/opportunities/${b.id}`, { method: 'PATCH', body: { ...toPatch(f, keys, toFields(b)), rowVersion: b.rowVersion } });
      setBase(updated);
      qc.setQueryData(['opportunity', updated.id], updated);
      qc.invalidateQueries({ queryKey: ['timeline', updated.id] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      setStatus('saved');
      setError(null);
      setConflict(false);
      if (!diffFields(latest.current.fields!, toFields(updated)).length) {
        try { localStorage.removeItem(draftKey(updated.id)); } catch { /* ignora */ }
      }
    } catch (e) {
      setStatus('error');
      setError(e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message);
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      inFlight.current = false;
    }
  }, [qc]);

  useEffect(() => {
    if (!base || !fields) return;
    try {
      if (dirtyKeys.length) localStorage.setItem(draftKey(base.id), JSON.stringify({ rowVersion: base.rowVersion, fields, savedAt: new Date().toISOString() } satisfies Draft));
    } catch { /* ignora */ }
  }, [fields]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debounced && !conflict && dirtyKeys.length) void save();
  }, [debounced, base]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      const { base: b, fields: f } = latest.current;
      if (b && f && diffFields(f, toFields(b)).length) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBefore);
    return () => {
      window.removeEventListener('beforeunload', onBefore);
      const { base: b, fields: f } = latest.current;
      if (b && f && !inFlight.current) {
        const keys = diffFields(f, toFields(b));
        if (keys.length) void api(`/opportunities/${b.id}`, { method: 'PATCH', body: { ...toPatch(f, keys, toFields(b)), rowVersion: b.rowVersion }, keepalive: true }).catch(() => {});
      }
    };
  }, []);

  const reloadFromServer = async () => {
    if (!base) return;
    const fresh = await api<Opportunity>(`/opportunities/${base.id}`);
    try { localStorage.removeItem(draftKey(base.id)); } catch { /* ignora */ }
    setBase(fresh);
    setFields(toFields(fresh));
    qc.setQueryData(['opportunity', fresh.id], fresh);
    setConflict(false);
    setStatus('idle');
  };

  return { base, fields, setFields, status, error, conflict, restored, dismissRestored: () => setRestored(false), save, reloadFromServer, dirty: dirtyKeys.length > 0 };
}

function Pendencies({ opp, fields, unmetFields }: { opp: Opportunity; fields: Fields; unmetFields: string[] }) {
  const items: { tone: 'warning' | 'info'; text: string }[] = [];
  const open = !isClosed(opp.stage);
  if (open && !fields.reasons.length) items.push({ tone: 'warning', text: 'Registre o motivo do contato. Curiosidade e comparação também contam.' });
  if (open && !fields.planId) items.push({ tone: 'warning', text: 'Escolha o plano: é ele que define o valor da proposta.' });
  if (open && (!fields.saleType || fields.cableMeters === '')) items.push({ tone: 'warning', text: 'Informe tipo de venda e metragem de cabo para calcular comissão, CAC e payback.' });
  if (open && !fields.condominiumId && !fields.installStreet) items.push({ tone: 'warning', text: 'Informe o endereço de instalação (condomínio, bloco e apartamento).' });
  if (open && unmetFields.length) items.push({ tone: 'warning', text: `Campos obrigatórios da jornada: ${unmetFields.join(', ')}.` });
  if (open && opp.coverageStatus !== 'elegivel') items.push({ tone: 'warning', text: `Cobertura ${opp.coverageStatus === 'nao_consultada' ? 'não consultada' : 'não confirmada'}: não prometa plano nem data de instalação.` });
  if (open && (!fields.nextAction || !fields.nextActionAt)) items.push({ tone: 'warning', text: 'Defina a próxima ação e quando ela acontece.' });
  if (open && opp.overdue) items.push({ tone: 'warning', text: 'A próxima ação está vencida. Reagende ou conclua.' });
  if (open && opp.viability?.engineering?.required && fields.engineeringStatus !== 'aprovada') items.push({ tone: 'warning', text: `Fora da autonomia (${opp.viability.engineering.reasons.join(' e ')}): abra o chamado de viabilidade na engenharia. A venda só fecha com a viabilidade aprovada.` });
  if (opp.stage === 'ganha' && opp.viability?.engineering?.required && !fields.executiveTicket) items.push({ tone: 'warning', text: 'Venda fechada fora da autonomia: abra o chamado de projeto executivo na engenharia.' });
  if (open && opp.viability?.route?.requiresApproval) items.push({ tone: 'info', text: `O caminho “${opp.viability.route.name}” exige aprovação antes de fechar.` });
  if (opp.customerLifecycle && opp.customerLifecycle !== 'prospect') items.push({ tone: 'info', text: 'Cliente já existente: confira os contratos ativos antes de uma nova contratação.' });
  if (opp.stage === 'ganha' && opp.contractRequestStatus !== 'confirmada') items.push({ tone: 'info', text: 'Venda fechada no comercial. O contrato só é confirmado depois da validação no IXC.' });
  return items.length === 0 ? (
    <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Nenhuma pendência de dados.</p>
  ) : (
    <ul className="space-y-2">
      {items.map((i) => <li key={i.text} className={clsx('rounded-md border px-3 py-2 text-sm', i.tone === 'warning' ? 'border-warning/30 bg-warning-soft text-[#9A5B00]' : 'border-primary/20 bg-primary-soft text-primary')}>{i.text}</li>)}
    </ul>
  );
}

export function OpportunityWorkspacePage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const lookups = useLookups();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['opportunity', id], queryFn: () => api<Opportunity>(`/opportunities/${id}`), refetchOnWindowFocus: true });
  const acts = useQuery({ queryKey: ['activities', 'opp', id], enabled: !!q.data && can('atividades'), queryFn: () => api<Paged<Activity>>(`/activities${qs({ opportunityId: id, status: 'todas', scope: can('atividades', 'equipe') ? 'equipe' : 'minhas', pageSize: 50 })}`) });
  const a = useAutosave(q.data);
  const transition = useTransitionMutation();
  const [pending, setPending] = useState<TransitionRequest | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [releaseReason, setReleaseReason] = useState('');
  const release = useMutation({
    mutationFn: () => api<Opportunity>(`/opportunities/${id}/release-port`, { method: 'POST', body: { reason: releaseReason, rowVersion: (a.base ?? q.data)!.rowVersion } }),
    onSuccess: (o) => { qc.setQueryData(['opportunity', o.id], o); qc.invalidateQueries({ queryKey: ['timeline', o.id] }); qc.invalidateQueries({ queryKey: ['area'] }); setReleasing(false); setReleaseReason(''); toast({ tone: 'success', message: 'Porta da CTO liberada' }); void q.refetch(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const [email, setEmail] = useState<'proposta' | 'followup' | null>(null);
  const [copilot, setCopilot] = useState(false);
  const [mobileTab, setMobileTab] = useState<'cliente' | 'conversa' | 'passo'>('conversa');
  const [centerTab, setCenterTab] = useState<'atividades' | 'historico' | 'anexos'>('atividades');
  const move = useMutation({
    mutationFn: (pipelineId: string) => api<Opportunity>(`/opportunities/${id}`, { method: 'PATCH', body: { pipelineId, rowVersion: (a.base ?? q.data)!.rowVersion } }),
    onSuccess: (o) => { qc.setQueryData(['opportunity', o.id], o); qc.invalidateQueries({ queryKey: ['pipeline'] }); toast({ tone: 'success', message: `Movida para a jornada ${o.pipelineName}` }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });

  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const opp = a.base ?? q.data!;
  const f = a.fields;
  if (!f) return <div className="card"><LoadingRows rows={8} /></div>;
  const canReopen = can('oportunidades', 'equipe');
  const editable = !isClosed(opp.stage);
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => a.setFields((x) => (x ? { ...x, [k]: v } : x));
  const running = editable && !!opp.sprintStartedAt && Date.now() - new Date(opp.sprintStartedAt).getTime() < 12 * 3_600_000;
  const plans = (lookups.data?.plans ?? []).filter((p) => p.segment === opp.contactSegment || p.id === f.planId || (opp.contactSegment !== 'residencial' && p.segment !== 'residencial'));
  const selectedPlan = lookups.data?.plans.find((p) => p.id === f.planId);
  const pipeline = lookups.data?.pipelines.find((p) => p.id === opp.pipelineId);
  const stages = pipeline?.stages ?? [];
  const current = stages.find((s) => s.key === opp.stage);
  const unmetFields = (pipeline?.fields ?? []).filter((x) => x.required && (f.custom[x.key] === undefined || f.custom[x.key] === null || f.custom[x.key] === '')).map((x) => x.label);

  const requestMove = (to: string) => {
    if (to === opp.stage) return;
    const target = stages.find((s) => s.key === to);
    if (!target) return;
    const req: TransitionRequest = { opp, from: opp.stage, to, fromName: current?.name ?? opp.stage, toName: target.name, toKind: target.kind, requirements: target.requirements ?? {}, title: opp.contactName };
    if (needsDialog(req)) setPending(req);
    else transition.mutate({ opp, payload: { toStage: to } });
  };

  const left = (
    <div className="space-y-4">
      <Panel title="Cliente" icon={<UserRound className="h-5 w-5 text-primary" />}>
        <p className="text-md font-bold text-ink">{opp.contactName}</p>
        <p className="text-sm text-muted">{productLabel(opp.contactSegment)}</p>
        <div className="mt-2 space-y-1 text-sm text-text">
          {opp.contactPhone && <p className="num flex items-center gap-2"><Phone className="h-4 w-4 text-success" aria-hidden />{opp.contactPhone}</p>}
          {opp.contactEmail && <p className="flex items-center gap-2 break-all"><Mail className="h-4 w-4 text-primary" aria-hidden />{opp.contactEmail}</p>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <LifecycleChip s={opp.customerLifecycle ?? 'prospect'} />
          {opp.contactProvisional && <span className="text-xs text-muted">Contato provisório</span>}
        </div>
        {can('clientes') && <Link to={`/customers/${opp.contactId}`} className="link mt-3 inline-block text-sm font-semibold">Abrir ficha do cliente</Link>}
      </Panel>
      <Panel title="Endereço de instalação" icon={<MapPin className="h-5 w-5 text-primary" />}>
        <AddressFields value={f} disabled={!editable} onChange={(v) => a.setFields((x) => (x ? { ...x, ...v } : x))} idPrefix="ws-ad" />
      </Panel>
      <Panel title="Situação">
        <div className="mb-3 flex flex-wrap gap-1.5"><StageChip stage={opp.stage} name={current?.name ?? opp.stageName} color={current?.color} /><CoverageChip s={opp.coverageStatus} /><ProposalChip s={opp.proposalStatus} /><ContractChip s={opp.contractRequestStatus} /></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted">Jornada</dt><dd className="text-text">{opp.pipelineName}</dd>
          <dt className="text-muted">Responsável</dt><dd className="flex items-center gap-2 text-text"><Avatar name={opp.ownerName} userId={opp.ownerId} hasPhoto={opp.ownerHasAvatar} size={22} />{opp.ownerName}</dd>
          <dt className="text-muted">Mensalidade</dt><dd className="num font-bold text-ink">{fmtBRL(opp.valueCents)}</dd>
          <dt className="text-muted">Canal</dt><dd className="text-text">{opp.sourceName ?? 'Não informado'}</dd>
          <dt className="text-muted">Criada</dt><dd className="num text-text">{fmtDateTime(opp.createdAt)}</dd>
          <dt className="text-muted">Na etapa há</dt><dd className="num text-text">{opp.daysInStage} dia(s)</dd>
          {opp.lossReason && (<><dt className="text-muted">Perda</dt><dd className="text-text">{LOSS_REASON_LABELS[opp.lossReason as LossReason] ?? opp.lossReason}</dd></>)}
          {opp.condominiumId && opp.stage !== 'perdida' && (<><dt className="text-muted">Porta CTO</dt><dd className="text-text">{opp.stage !== 'ganha' ? 'Reservada (libera se perder)' : opp.portReleasedAt ? `Liberada em ${fmtDate(opp.portReleasedAt)}` : 'Ocupada'}</dd></>)}
          {opp.duplicatedFromId && (<><dt className="text-muted">Origem</dt><dd><Link className="link" to={`/opportunities/${opp.duplicatedFromId}`}>oportunidade anterior</Link></dd></>)}
        </dl>
        {opp.stage === 'ganha' && opp.condominiumId && !opp.portReleasedAt && canReopen && (
          <Button size="sm" className="mt-3" onClick={() => setReleasing(true)}>Cliente cancelou: liberar porta</Button>
        )}
      </Panel>
    </div>
  );

  const center = (
    <div className="space-y-4">
      {a.restored && <Notice tone="warning">Recuperamos alterações que não tinham sido salvas. Elas serão gravadas agora. <button className="underline" onClick={a.dismissRestored}>Entendi</button></Notice>}
      {a.conflict && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>Outra pessoa alterou esta oportunidade. Suas últimas edições não foram salvas.</span>
          <Button size="sm" onClick={a.reloadFromServer}>Recarregar versão atual</Button>
        </div>
      )}
      {a.error && !a.conflict && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Não salvou: {a.error}</p>}
      <StageScript oppId={opp.id} pipelineKey={pipeline?.key ?? ''} stage={opp.stage} disabled={!editable} />
      <section className="card space-y-4 p-5">
        <ChipGroup legend="Motivo do contato" options={OPPORTUNITY_REASONS} value={f.reasons} onChange={(v) => editable && set('reasons', v)} labels={REASON_LABELS} disabled={!editable} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Nome do deal" htmlFor="ws-title"><Input id="ws-title" value={f.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} /></FormField>
          <FormField label="Plano" htmlFor="ws-plan" hint={selectedPlan ? `Catálogo: ${fmtBRL(selectedPlan.priceCents)}/mês${selectedPlan.speedMbps ? ` · ${selectedPlan.speedMbps} Mbps` : ''}` : 'O valor vem do catálogo'}>
            <Select id="ws-plan" value={f.planId} disabled={!editable} onChange={(e) => set('planId', e.target.value)}>
              <option value="">Ainda não definido</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtBRL(p.priceCents)}</option>)}
            </Select>
          </FormField>
          <FormField label="Canal de entrada" htmlFor="ws-source">
            <Select id="ws-source" value={f.sourceId} disabled={!editable} onChange={(e) => set('sourceId', e.target.value)}>
              <option value="">Não informado</option>
              {lookups.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Campanha" htmlFor="ws-campaign">
            <Select id="ws-campaign" value={f.campaignId} disabled={!editable} onChange={(e) => set('campaignId', e.target.value)}>
              <option value="">Nenhuma</option>
              {lookups.data?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Jornada" htmlFor="ws-pipe" hint={a.dirty ? 'Aguarde salvar para trocar' : 'Trocar de jornada mantém o histórico'}>
            <Select id="ws-pipe" value={opp.pipelineId} disabled={!editable || move.isPending || a.dirty} onChange={(e) => move.mutate(e.target.value)}>
              {lookups.data?.pipelines.filter((p) => p.allowed || p.id === opp.pipelineId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Próxima ação" htmlFor="ws-na"><Input id="ws-na" value={f.nextAction} disabled={!editable} onChange={(e) => set('nextAction', e.target.value)} placeholder="Ex.: confirmar cobertura no endereço" /></FormField>
          <FormField label="Quando" htmlFor="ws-nat"><Input id="ws-nat" type="datetime-local" value={f.nextActionAt} disabled={!editable} onChange={(e) => set('nextActionAt', e.target.value)} /></FormField>
        </div>
        <ViabilityInputs value={f} disabled={!editable} onChange={(v) => a.setFields((x) => (x ? { ...x, ...v } : x))} idPrefix="ws-vb" />
        <EquipmentOverride routeId={f.routeId} equipment={f.equipment} suggested={{ routeName: opp.viability?.route?.name ?? null }} disabled={!editable} onChange={(v) => a.setFields((x) => (x ? { ...x, ...v } : x))} idPrefix="ws-eq" />
        {pipeline && pipeline.fields.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Campos da jornada</p>
            <CustomFieldsEditor fields={pipeline.fields} value={f.custom} disabled={!editable} onChange={(k, v) => a.setFields((x) => (x ? { ...x, custom: { ...x.custom, [k]: v } } : x))} idPrefix="ws-cf" />
          </div>
        )}
        <FormField label="Anotações da conversa" htmlFor="ws-notes" hint="O que o cliente valoriza, o que tem hoje (se ele disser), dúvidas e combinados.">
          <Textarea id="ws-notes" className="min-h-[120px]" value={f.notes} disabled={!editable} onChange={(e) => set('notes', e.target.value)} />
        </FormField>
      </section>
      <section className="card">
        <div className="px-5 pt-2">
          <Tabs label="Detalhes" value={centerTab} onChange={setCenterTab} tabs={[
            { key: 'atividades', label: 'Atividades', count: acts.data?.items.filter((x) => !x.completedAt).length },
            { key: 'anexos', label: 'Anexos', count: opp.attachmentCount },
            { key: 'historico', label: 'Histórico' },
          ]} />
        </div>
        <div className="p-5" role="tabpanel">
          {centerTab === 'atividades' && (!can('atividades') ? <p className="text-sm text-muted">Seu perfil não tem acesso ao módulo Atividades.</p>
            : acts.isLoading ? <LoadingRows rows={3} /> : acts.data?.items.length ? <ul className="divide-y divide-line">{acts.data.items.map((x) => <ActivityRow key={x.id} a={x} showOwner compact />)}</ul>
            : <EmptyState title="Nenhuma atividade" description="Agende um retorno para não perder o fio da conversa." action={<Button variant="primary" onClick={() => setScheduling(true)}>Agendar retorno</Button>} />)}
          {centerTab === 'anexos' && <Attachments oppId={opp.id} />}
          {centerTab === 'historico' && <Timeline opportunityId={opp.id} />}
        </div>
      </section>
    </div>
  );

  const right = (
    <div className="space-y-4">
      <ViabilityPanel v={opp.viability} loading={a.status === 'saving'} title={opp.stage === 'ganha' ? 'Viabilidade no fechamento' : 'Viabilidade da venda'} />
      <EngineeringPanel opp={opp} planName={selectedPlan?.name ?? opp.planName ?? null} speedMbps={selectedPlan?.speedMbps ?? null} notes={f.notes} value={f} disabled={!editable} onChange={(v) => a.setFields((x) => (x ? { ...x, ...v } : x))} />
      <Panel title="Próximo passo" icon={<ListChecks className="h-5 w-5 text-primary" />}><Pendencies opp={opp} fields={f} unmetFields={unmetFields} /></Panel>
      <Objections pipelineKey={pipeline?.key ?? ''} />
    </div>
  );

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumb items={[{ label: 'Oportunidades', to: `/opportunities${qs({ pipelineId: opp.pipelineId })}` }, { label: `OP-${opp.code}` }]} />
          <h1 className="truncate text-xl font-extrabold text-ink">{opp.contactName}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{opp.title}</span>
            {opp.condominiumName && <span>· {opp.condominiumName}{opp.installBlock ? ` · Bl. ${opp.installBlock}` : ''}{opp.installUnit ? ` · Ap. ${opp.installUnit}` : ''}</span>}
            <SaveStatus state={a.status} onRetry={() => void a.save()} />
          </p>
        </div>
        <SprintTimer startedAt={opp.sprintStartedAt} baseSeconds={opp.sprintElapsedSeconds} running={running} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="ws-stage" className="text-sm text-muted">Etapa</label>
        <Select id="ws-stage" className="w-auto" value={opp.stage} onChange={(e) => requestMove(e.target.value)} disabled={transition.isPending || (isClosed(opp.stage) && !canReopen)}>
          {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </Select>
        {can('atividades') && <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)}>Agendar retorno</Button>}
        <Button icon={<Send className="h-4 w-4" />} onClick={() => setEmail('proposta')}>Enviar proposta</Button>
        <Button icon={<Mail className="h-4 w-4" />} onClick={() => setEmail('followup')}>Follow-up</Button>
        {editable && (
          <>
            <Button icon={<CheckCircle2 className="h-4 w-4 text-success" />} onClick={() => requestMove('ganha')}>Venda fechada</Button>
            <Button icon={<XCircle className="h-4 w-4 text-danger" />} onClick={() => requestMove('perdida')}>Marcar como perdida</Button>
          </>
        )}
        <Button className="ws3:hidden max-ws2:hidden" icon={<ListChecks className="h-4 w-4" />} onClick={() => setCopilot(true)}>Viabilidade e próximo passo</Button>
        {isClosed(opp.stage) && <span className="text-sm text-muted">Encerrada em {fmtDate(opp.wonAt ?? opp.lostAt)}{canReopen ? ' — mude a etapa para reabrir.' : '. Reabrir é com a supervisão.'}</span>}
      </div>

      <div className="mb-3 ws2:hidden">
        <Tabs label="Seções do atendimento" value={mobileTab} onChange={setMobileTab} tabs={[{ key: 'conversa', label: 'Conversa' }, { key: 'cliente', label: 'Cliente' }, { key: 'passo', label: 'Viabilidade' }]} />
      </div>

      <div className="grid grid-cols-1 gap-4 ws2:grid-cols-[300px_minmax(0,1fr)] ws3:grid-cols-[320px_minmax(0,1fr)_380px]">
        <div className={clsx(mobileTab !== 'cliente' && 'max-ws2:hidden')}>{left}</div>
        <div className={clsx(mobileTab !== 'conversa' && 'max-ws2:hidden')}>{center}</div>
        <div className={clsx('hidden ws3:block', mobileTab === 'passo' && 'max-ws2:block')}>{right}</div>
      </div>

      <Drawer open={copilot} onClose={() => setCopilot(false)} title="Viabilidade e próximo passo" width="lg">{right}</Drawer>
      <Modal open={releasing} onClose={() => setReleasing(false)} title="Liberar porta da CTO" size="sm" footer={<><Button onClick={() => setReleasing(false)}>Cancelar</Button><Button variant="primary" loading={release.isPending} disabled={releaseReason.trim().length < 3} onClick={() => release.mutate()}>Liberar porta</Button></>}>
        <p className="mb-3 text-sm text-text">Use quando o cliente cancelar. A porta volta a ficar livre na CTO do condomínio e o registro fica no histórico.</p>
        <FormField label="Motivo do cancelamento" htmlFor="rel-reason" required><Input id="rel-reason" value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} placeholder="Ex.: mudou de endereço" data-autofocus /></FormField>
      </Modal>
      <Modal open={scheduling} onClose={() => setScheduling(false)} title="Agendar retorno" footer={<><Button onClick={() => setScheduling(false)}>Cancelar</Button><Button variant="primary" type="submit" form="ws-activity">Agendar</Button></>}>
        <ActivityComposer formId="ws-activity" hideSubmit opportunityId={opp.id} defaultTitle={f.nextAction} onDone={() => setScheduling(false)} />
      </Modal>
      {email && <EmailComposer oppId={opp.id} kind={email} open onClose={() => setEmail(null)} />}
      <TransitionDialog request={pending} loading={transition.isPending} onCancel={() => setPending(null)} onConfirm={(payload) => transition.mutate({ opp, payload }, { onSettled: () => setPending(null), onSuccess: () => void q.refetch() })} />
    </div>
  );
}
