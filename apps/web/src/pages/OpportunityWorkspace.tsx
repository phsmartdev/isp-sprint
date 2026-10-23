import { SALE_TYPE_KEYS } from '@isp/shared';
import { LinkedTasks } from '../features/tasks/shared';
import { TaskDrawer } from '../features/tasks/TaskDrawer';
import { LinkedProjects } from '../features/projects/shared';
import { AccountPanel, SideSection } from '../features/opportunity/AccountPanel';
import { OpportunityContacts } from '../features/opportunity/OpportunityContacts';
import { OutcomeCelebration, type Outcome } from '../features/opportunity/Outcome';
import { OpportunityItems } from '../features/opportunity/OpportunityItems';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, CalendarPlus, FileSignature, FileText, CheckCircle2, Handshake, ListChecks, Mail, MapPin, Phone, Scale, Send, UserRound, XCircle } from 'lucide-react';
import {
  LOSS_REASON_LABELS, OPPORTUNITY_REASONS, REASON_LABELS, SEGMENTS, SEGMENT_LABELS, toCents,
  type CustomerLifecycle, type LossReason, type OpportunityReason, type SaleType, type Segment, type ViabilityResult,
} from '@isp/domain';
import { api, ApiError, qs } from '../lib/api';
import { fmtBRL, fmtDate, fmtDateTime, isoToLocalInput, localInputToIso } from '../lib/format';
import { useDebounced, useLookups } from '../lib/hooks';
import type { Activity, Opportunity, Paged } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { OpportunityArpPanel } from '../features/arp/OpportunityArp';
import { Avatar, Breadcrumb, Button, ChipGroup, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, SaveStatus, Select, Tabs, Textarea } from '../components/ui/primitives';
import { Drawer, Modal, useToast } from '../components/ui/overlay';
import { ContractChip, CoverageChip, LifecycleChip, ProposalChip, StageChip, productLabel } from '../components/badges';
import { SprintTimer } from '../features/SprintTimer';
import { Timeline } from '../features/Timeline';
import { NegotiationChat, useUnread } from '../features/NegotiationChat';
import { ActivityComposer } from '../features/ActivityComposer';
import { ActivityRow } from '../features/ActivityRow';
import { TransitionDialog, isClosed, needsDialog, type TransitionRequest } from '../features/TransitionDialog';
import { useTransitionMutation } from '../features/useTransition';
import { AddressFields, CustomFieldsEditor, EquipmentOverride, ViabilityInputs, ViabilityPanel, emptyAddress, useViabilityMeta, viabilityPayload, type AddressValue, type CustomValues, type KitValue, type ViabilityValue } from '../features/DealFields';
import { MeasurementBox } from '../features/MeasurementBox';
import { Attachments } from '../features/Attachments';
import { GlpiTickets } from '../features/GlpiTickets';
import { EmailComposer } from '../features/EmailComposer';
import { ProposalGenerator } from '../features/ProposalGenerator';
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
  const [segment, setSegment] = useState<Segment>('empresarial');
  const [document_, setDocument] = useState('');
  const [accAddress, setAccAddress] = useState<AddressValue>(emptyAddress);
  const [search, setSearch] = useState('');
  const [contact, setContact] = useState<ContactHit | null>(null);
  const [cs, setCs] = useState<'' | 'sim' | 'nao'>('');
  const [sourceId, setSourceId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [planId, setPlanId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [pipelineId, setPipelineId] = useState(params.get('pipelineId') ?? '');
  const [branchId, setBranchId] = useState('');
  const [stage, setStage] = useState('');
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
  // abertura por tipo de venda: só as jornadas de tipo de venda (a residencial saiu da abertura em 23/10)
  const journeys = (lookups.data?.pipelines ?? []).filter((p) => p.allowed && (SALE_TYPE_KEYS as readonly string[]).includes(p.key));
  const autoJourney = journeys.find((p) => p.segments.includes(seg)) ?? journeys.find((p) => p.isDefault) ?? journeys[0];
  const journey = journeys.find((p) => p.id === pipelineId);
  const plans = (lookups.data?.plans ?? []).filter((p) => p.segment === seg || (seg !== 'residencial' && p.segment !== 'residencial'));
  const assign = level('oportunidades') !== 'proprio';

  const simInput = useDebounced(JSON.stringify({ planId: planId || null, ...viabilityPayload(vb), location: address.condominiumId ? 'condominio' : address.installStreet ? 'rua' : null }), 350);
  const sim = useQuery({ queryKey: ['simulate', simInput], enabled: !!planId || vb.cableMeters !== '', queryFn: () => api<ViabilityResult>('/viability/simulate', { method: 'POST', body: JSON.parse(simInput) }), placeholderData: (p) => p });

  const isBase = mode === 'existente' && !!contact?.lifecycle && contact.lifecycle !== 'prospect';
  const create = useMutation({
    mutationFn: () =>
      api<Opportunity>('/opportunities', {
        method: 'POST',
        body: {
          ...(mode === 'existente' ? { contactId: contact?.id, customerSuccess: isBase ? cs === 'sim' : undefined } : { newContact: { name, phone: phone || null, email: email || null, segment: journey?.key === 'venda_consultiva' ? segment : 'governamental', city: accAddress.installCity || address.installCity || null, document: document_.trim() || null, address: { postalCode: accAddress.installCep || null, street: accAddress.installStreet || null, number: accAddress.installNumber || null, district: accAddress.installDistrict || null, city: accAddress.installCity || null, state: null } } }),
          title: title.trim() || null,
          leadId: params.get('leadId') || null,
          sourceId: sourceId || null,
          campaignId: campaignId || null,
          channel: lookups.data?.sources.find((s) => s.id === sourceId)?.name ?? null,
          planId: null,
          ownerId: ownerId || null,
          pipelineId: journey?.id ?? null,
          branchId: branchId || null,
          stage: stage || null,
          reasons: [],
          ...Object.fromEntries(Object.entries(address).map(([k, v]) => [k, v || null])),
          custom,
        },
      }),
    onSuccess: (o) => {
      if ((o as Opportunity & { customerSuccessId?: string | null }).customerSuccessId) toast({ tone: 'success', message: 'Sucesso do Cliente acionado: a oportunidade também foi para o funil Sucesso do Cliente.' });
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
    if (!journey) errs.pipelineId = 'Escolha o tipo de venda';
    if ((lookups.data?.branches ?? []).length && !branchId) errs.branchId = 'Escolha a filial da venda';
    if (mode === 'novo' && name.trim().length < 2) errs['newContact.name'] = 'Informe o nome da conta (ao menos 2 letras)';
    if (mode === 'existente' && !contact) errs.contactId = 'Selecione um cliente da lista';
    if (mode === 'existente' && isBase && !cs) errs.customerSuccess = 'Responda se aciona Sucesso do Cliente';
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
          <p className="text-muted">Escolha o tipo de venda e preencha o que já souber. O cronômetro começa quando você criar.</p>
        </div>
      </div>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <Panel title="Oportunidade" icon={<Handshake className="h-5 w-5 text-primary" />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Nome do deal" htmlFor="no-title" hint="Em branco: tipo de venda + cliente">
                <Input id="no-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Link dedicado 200 Mb — Prefeitura" />
              </FormField>
              <FormField label="Tipo de venda" htmlFor="no-pipe" required error={errors.pipelineId} hint={journey?.description ?? undefined}>
                <Select id="no-pipe" value={pipelineId} invalid={!!errors.pipelineId} onChange={(e) => { setPipelineId(e.target.value); setCustom({}); setStage(''); }}>
                  <option value="">Escolha o tipo de venda</option>
                  {journeys.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </FormField>
              {journey && (
                <FormField label="Etapa do funil" htmlFor="no-stage" hint="Em branco: a primeira etapa">
                  <Select id="no-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">{journey.stages.find((x) => x.kind === 'open')?.name ?? 'Primeira etapa'}</option>
                    {journey.stages.filter((x) => x.kind === 'open').slice(1).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                  </Select>
                </FormField>
              )}
              <FormField label="Filial" htmlFor="no-branch" required error={errors.branchId}>
                <Select id="no-branch" value={branchId} invalid={!!errors.branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">Escolha a filial</option>
                  {lookups.data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Nome do cliente" htmlFor="no-name" required error={errors['newContact.name']} hint="Razão social ou nome da conta">
                    <Input id="no-name" value={name} invalid={!!errors['newContact.name']} onChange={(e) => setName(e.target.value)} autoFocus />
                  </FormField>
                  <FormField label="CNPJ" htmlFor="no-doc" error={errors['newContact.document']} hint="Se já existir uma conta com este CNPJ, use “Cliente da carteira”">
                    <Input id="no-doc" inputMode="numeric" value={document_} invalid={!!errors['newContact.document']} onChange={(e) => setDocument(e.target.value)} placeholder="00.000.000/0000-00" />
                  </FormField>
                  <FormField label="Telefone" htmlFor="no-phone" error={errors['newContact.phone']}>
                    <Input id="no-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(79) 9 0000-0000" />
                  </FormField>
                  <FormField label="E-mail" htmlFor="no-email" error={errors['newContact.email']}>
                    <Input id="no-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </FormField>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink">Endereço do cliente</p>
                  <AddressFields value={accAddress} onChange={(v) => setAccAddress((a) => ({ ...a, ...v }))} idPrefix="no-acc" hideCondominium />
                </div>
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
                        <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setContact(c); setPlanId(''); setCs(''); }}>
                          <span><span className="block font-semibold text-ink">{c.name}</span><span className="block text-sm text-muted">{c.phone ?? 'sem telefone'} · {SEGMENT_LABELS[c.segment]}</span></span>
                          {c.lifecycle && <LifecycleChip s={c.lifecycle} />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {isBase && <div className="mt-2"><Notice tone="warning">Cliente já existente{contact!.externalId ? ` (${contact!.externalId})` : ''}. Confira os contratos ativos antes de qualquer nova contratação.</Notice></div>}
                {isBase && (
                  <fieldset className="mt-3 rounded-md border border-line p-3" aria-describedby={errors.customerSuccess ? 'cs-err' : undefined}>
                    <legend className="px-1 text-sm font-semibold text-ink">Acionar o processo de Sucesso do Cliente? <span className="text-danger">*</span></legend>
                    <p className="mb-2 text-xs text-muted">Sim: a oportunidade também vai para o funil Sucesso do Cliente. Não: segue só aqui, sem duplicar.</p>
                    <div className="flex gap-5 text-sm">
                      <label className="flex items-center gap-2"><input type="radio" name="no-cs" checked={cs === 'sim'} onChange={() => setCs('sim')} />Sim, acionar</label>
                      <label className="flex items-center gap-2"><input type="radio" name="no-cs" checked={cs === 'nao'} onChange={() => setCs('nao')} />Não</label>
                    </div>
                    {errors.customerSuccess && <p id="cs-err" className="mt-1 text-sm text-danger">{errors.customerSuccess}</p>}
                  </fieldset>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Endereço de entrega" icon={<MapPin className="h-5 w-5 text-primary" />}>
            <AddressFields value={address} onChange={(v) => setAddress((a) => ({ ...a, ...v }))} idPrefix="no-ad" hideCondominium />
          </Panel>

          {journey && journey.fields.length > 0 && (
            <Panel title={`Informações de ${journey.name}`}>
              <CustomFieldsEditor fields={journey.fields} value={custom} onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))} idPrefix="no-cf" />
              {Object.keys(errors).some((k) => k.startsWith('custom.')) && <p className="mt-2 text-sm text-danger">Preencha os campos obrigatórios da jornada.</p>}
            </Panel>
          )}

        </div>
        <aside className="space-y-4 xl:sticky xl:top-[88px] xl:self-start">
          <div className="card flex flex-col gap-2 p-5">
            <Button type="submit" variant="primary" size="lg" loading={create.isPending}>Iniciar Negociação</Button>
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
      // mostra também o campo recusado, para quem vê o aviso saber o que corrigir
      const fe = e instanceof ApiError ? (e.problem.errors ?? []).map((x) => `${x.path}: ${x.message}`).slice(0, 3).join('; ') : '';
      setError(e instanceof ApiError ? `${e.problem.detail ?? e.message}${fe ? ` (${fe})` : ''}` : (e as Error).message);
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

export function OpportunityWorkspacePage() {
  const { id = '' } = useParams();
  const { can, feature } = useAuth();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const nav = useNavigate();
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
  const [genProposal, setGenProposal] = useState(false);
  const [copilot, setCopilot] = useState(false);
  const [search] = useSearchParams();
  // abas do acompanhamento; endereços antigos (?aba=atividades|trabalho|chat|pessoas) continuam funcionando
  const [centerTab, setCenterTab] = useState<'historico' | 'projetos' | 'tarefas' | 'anexos' | 'chamados'>(() => { const t = search.get('aba'); return t === 'projetos' || t === 'anexos' || t === 'chamados' ? t : t === 'tarefas' || t === 'atividades' || t === 'trabalho' ? 'tarefas' : 'historico'; });
  const [taskOpen, setTaskOpen] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'cliente' | 'conversa' | 'passo'>(() => { const t = search.get('aba'); return t === 'chat' ? 'passo' : t === 'pessoas' ? 'cliente' : t ? 'conversa' : 'cliente'; });
  const unread = useUnread(id!);
  const glpiUnseen = useQuery({ queryKey: ['glpi', 'unseen', id], enabled: feature('crm.chamados'), refetchInterval: 60_000, queryFn: () => api<{ total: number; open: number; unseen: number }>(`/opportunities/${id}/glpi-tickets/unseen`) });
  const setBranch = useMutation({
    mutationFn: (branchId: string) => api<Opportunity>(`/opportunities/${id}`, { method: 'PATCH', body: { branchId: branchId || null, rowVersion: (a.base ?? q.data)!.rowVersion } }),
    onSuccess: (o) => { qc.setQueryData(['opportunity', o.id], o); toast({ tone: 'success', message: 'Filial alterada' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const move = useMutation({
    mutationFn: (pipelineId: string) => api<Opportunity>(`/opportunities/${id}`, { method: 'PATCH', body: { pipelineId, rowVersion: (a.base ?? q.data)!.rowVersion } }),
    onSuccess: (o) => { qc.setQueryData(['opportunity', o.id], o); qc.invalidateQueries({ queryKey: ['pipeline'] }); toast({ tone: 'success', message: `Movida para a jornada ${o.pipelineName}` }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });

  const loaded = !!q.data;
  useEffect(() => {
    if (!loaded) return;
    const t = search.get('aba');
    const target = t === 'chat' ? document.getElementById('ws-chat') : null;
    if (target) setTimeout(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const workPrefill = { opportunityId: opp.id, contactId: opp.contactId, label: `OP-${opp.code} · ${opp.contactName}`, kind: 'implantacao' as const, name: `Implantação ${opp.contactName}` };
  const interactions = (acts.data?.items ?? []).filter((x) => x.type !== 'tarefa');
  const unmetFields = (pipeline?.fields ?? []).filter((x) => x.required && (f.custom[x.key] === undefined || f.custom[x.key] === null || f.custom[x.key] === '')).map((x) => x.label);

  const requestMove = (to: string) => {
    if (to === opp.stage) return;
    const target = stages.find((s) => s.key === to);
    if (!target) return;
    const req: TransitionRequest = { opp, from: opp.stage, to, fromName: current?.name ?? opp.stage, toName: target.name, toKind: target.kind, requirements: target.requirements ?? {}, title: opp.contactName };
    if (needsDialog(req)) setPending(req);
    else transition.mutate({ opp, payload: { toStage: to } }, { onSuccess: () => celebrate(target.kind) });
  };
  // venda fechada comemora; perdida lamenta
  const celebrate = (kind: string | undefined) => {
    if (kind === 'won' || kind === 'lost') setOutcome({ kind, who: (opp.ownerName ?? '').split(' ')[0] || 'time', deal: opp.title || opp.contactName });
  };

  const addressSummary = f.condominiumId ? [opp.condominiumName, f.installBlock && `Bl. ${f.installBlock}`, f.installUnit && `Ap. ${f.installUnit}`].filter(Boolean).join(' · ') : [f.installStreet, f.installNumber, f.installCity].filter(Boolean).join(', ');
  const left = (
    <div className="space-y-4">
      <section className="card p-5" aria-label="Informações do deal">
        <h2 className="mb-2 flex items-center gap-2 text-md font-bold text-ink"><Handshake className="h-5 w-5 text-primary" aria-hidden />Deal</h2>
        <p className="font-bold text-ink">{opp.title}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted">Tipo de venda</dt><dd className="text-text">{opp.pipelineName}</dd>
          <dt className="text-muted">Filial</dt><dd className="text-text">{lookups.data?.branches.find((b) => b.id === opp.branchId)?.name ?? 'Não informada'}</dd>
          <dt className="text-muted">Responsável</dt><dd className="flex items-center gap-2 text-text"><Avatar name={opp.ownerName} userId={opp.ownerId} hasPhoto={opp.ownerHasAvatar} size={22} />{opp.ownerName}</dd>
          <dt className="text-muted">Valor</dt><dd className="num font-bold text-ink">{fmtBRL(opp.valueCents)}{opp.valueCents !== null && !opp.itemCount ? <span className="font-normal text-muted"> /mês</span> : null}{opp.itemCount ? <span className="font-normal text-muted"> · {opp.itemCount} item(ns)</span> : null}</dd>
          {(selectedPlan ?? opp.planName) && (<><dt className="text-muted">Solução</dt><dd className="text-text">{selectedPlan?.name ?? opp.planName}</dd></>)}
          <dt className="text-muted">Canal</dt><dd className="text-text">{opp.sourceName ?? 'Não informado'}</dd>
          <dt className="text-muted">Criada</dt><dd className="num text-text">{fmtDateTime(opp.createdAt)}</dd>
          <dt className="text-muted">Na etapa há</dt><dd className="num text-text">{opp.daysInStage} dia(s)</dd>
          {(opp.wonAt || opp.lostAt) && (<><dt className="text-muted">Encerrada</dt><dd className="num text-text">{fmtDate(opp.wonAt ?? opp.lostAt)}</dd></>)}
          {opp.lossReason && (<><dt className="text-muted">Perda</dt><dd className="text-text">{LOSS_REASON_LABELS[opp.lossReason as LossReason] ?? opp.lossReason}</dd></>)}
          {opp.condominiumId && opp.stage !== 'perdida' && (<><dt className="text-muted">Porta CTO</dt><dd className="text-text">{opp.stage !== 'ganha' ? 'Reservada (libera se perder)' : opp.portReleasedAt ? `Liberada em ${fmtDate(opp.portReleasedAt)}` : 'Ocupada'}</dd></>)}
          {opp.duplicatedFromId && (<><dt className="text-muted">Origem</dt><dd><Link className="link" to={`/opportunities/${opp.duplicatedFromId}`}>oportunidade anterior</Link></dd></>)}
        </dl>
        {opp.stage === 'ganha' && opp.condominiumId && !opp.portReleasedAt && canReopen && (
          <Button size="sm" className="mt-3" onClick={() => setReleasing(true)}>Cliente cancelou: liberar porta</Button>
        )}


        {/* coluna estreita: as grades internas dos formulários viram uma coluna só */}
        <div className="mt-4 space-y-3 [&_.grid>*]:!col-span-1 [&_.grid]:!grid-cols-1">
          <SideSection id="dados" title="Dados do deal" defaultOpen summary={f.title}>
            <div className="space-y-3">
              <FormField label="Nome do deal" htmlFor="ws-title"><Input id="ws-title" value={f.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} /></FormField>
              <FormField label="Filial" htmlFor="ws-branch" hint={a.dirty ? 'Aguarde salvar para trocar' : undefined}>
                <Select id="ws-branch" value={opp.branchId ?? ''} disabled={!editable || setBranch.isPending || a.dirty} onChange={(e) => setBranch.mutate(e.target.value)}>
                  <option value="">Não informada</option>
                  {lookups.data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Canal de entrada" htmlFor="ws-source">
                <Select id="ws-source" value={f.sourceId} disabled={!editable} onChange={(e) => set('sourceId', e.target.value)}>
                  <option value="">Não informado</option>
                  {lookups.data?.sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Campanha" htmlFor="ws-campaign">
                <Select id="ws-campaign" value={f.campaignId} disabled={!editable} onChange={(e) => set('campaignId', e.target.value)}>
                  <option value="">Nenhuma</option>
                  {lookups.data?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormField>
            </div>
          </SideSection>
          {pipeline && pipeline.fields.length > 0 && (
            <SideSection id="tipo" title="Informações do tipo de venda" defaultOpen={unmetFields.length > 0 || pipeline.fields.every((x) => f.custom[x.key] == null || f.custom[x.key] === '')} summary={unmetFields.length ? `Falta: ${unmetFields.join(', ')}` : `${pipeline.fields.length} campo(s)`}>
              <CustomFieldsEditor fields={pipeline.fields} value={f.custom} disabled={!editable} onChange={(k, v) => a.setFields((x) => (x ? { ...x, custom: { ...x.custom, [k]: v } } : x))} idPrefix="ws-cf" />
            </SideSection>
          )}
          <SideSection id="endereco" title="Endereço de entrega" defaultOpen={!f.condominiumId && !f.installStreet} summary={addressSummary || 'Não informado'}>
            <AddressFields value={f} disabled={!editable} onChange={(v) => a.setFields((x) => (x ? { ...x, ...v } : x))} idPrefix="ws-ad" hideCondominium={!f.condominiumId} />
          </SideSection>
        </div>
      </section>
      <OpportunityContacts oppId={opp.id} editable={editable} />
      <AccountPanel opp={opp} openMore={search.get('aba') === 'pessoas'} extra={<MeasurementBox opp={opp} />} />
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
      <OpportunityItems opp={opp} />
      <OpportunityArpPanel oppId={opp.id} stage={opp.stage} />
      <section className="card">
        <div className="px-5 pt-2">
          <Tabs label="Acompanhamento" className="!gap-3 [&_[role=tab]]:text-sm" value={centerTab} onChange={setCenterTab} tabs={[
            { key: 'historico', label: unread.data?.comments ? `Histórico • ${unread.data.comments} novo(s)` : 'Histórico' },
            ...(can('projetos') ? [{ key: 'projetos' as const, label: 'Projetos' }] : []),
            { key: 'tarefas', label: 'Tarefas', count: acts.data?.items.filter((x) => !x.completedAt).length || undefined },
            { key: 'anexos', label: 'Anexos', count: opp.attachmentCount || undefined },
            ...(feature('crm.chamados') ? [{ key: 'chamados' as const, label: glpiUnseen.data?.unseen ? `Chamados • ${glpiUnseen.data.unseen} novo(s)` : 'Chamados', count: glpiUnseen.data?.unseen ? undefined : glpiUnseen.data?.total || undefined }] : []),
          ]} />
        </div>
        <div className="p-5" role="tabpanel">
          {centerTab === 'historico' && <Timeline opportunityId={opp.id} />}
          {centerTab === 'projetos' && <LinkedProjects prefill={workPrefill} />}
          {centerTab === 'tarefas' && (
            <div className="space-y-5">
              <LinkedTasks prefill={workPrefill} onOpen={setTaskOpen} />
              <section aria-label="Retornos e interações">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-ink">Retornos e interações</h3>
                  {can('atividades') && editable && <Button size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)}>Agendar retorno</Button>}
                </div>
                {!can('atividades') ? <p className="text-sm text-muted">Seu perfil não tem acesso ao módulo Atividades.</p>
                  : acts.isLoading ? <LoadingRows rows={3} /> : interactions.length ? <ul className="divide-y divide-line">{interactions.map((x) => <ActivityRow key={x.id} a={x} showOwner compact />)}</ul>
                  : <EmptyState title="Nenhum retorno agendado" description="Agende um retorno para não perder o fio da conversa." />}
              </section>
              <TaskDrawer id={taskOpen} onClose={() => setTaskOpen(null)} onOpen={setTaskOpen} />
            </div>
          )}
          {centerTab === 'anexos' && <Attachments oppId={opp.id} />}
          {centerTab === 'chamados' && <GlpiTickets oppId={opp.id} contactName={opp.contactName} hasCustomer={!!opp.customerId} />}
        </div>
      </section>
    </div>
  );

  const right = (
    <div className="space-y-4">
      <ViabilityPanel v={opp.viability} loading={a.status === 'saving'} title={opp.stage === 'ganha' ? 'Viabilidade no fechamento' : 'Viabilidade da venda'} />
      <EngineeringPanel opp={opp} planName={selectedPlan?.name ?? opp.planName ?? null} speedMbps={selectedPlan?.speedMbps ?? null} notes={f.notes} value={f} disabled={!editable} onChange={(v) => a.setFields((x) => (x ? { ...x, ...v } : x))} />
      <section id="ws-chat" className="card scroll-mt-4">
        <NegotiationChat oppId={opp.id} className="max-h-[560px]" />
      </section>
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
        <Button icon={<FileText className="h-4 w-4" />} onClick={() => setGenProposal(true)}>Gerar proposta</Button>
        <Button icon={<Send className="h-4 w-4" />} onClick={() => setEmail('proposta')}>Enviar proposta</Button>
        <Button icon={<Mail className="h-4 w-4" />} onClick={() => setEmail('followup')}>Follow-up</Button>
        <Button className="ws3:hidden max-ws2:hidden" icon={<ListChecks className="h-4 w-4" />} onClick={() => setCopilot(true)}>{unread.data?.chat ? `Viabilidade e chat • ${unread.data.chat} nova(s)` : 'Viabilidade e chat'}</Button>
        <Button icon={<Scale className="h-4 w-4" />} onClick={() => nav(`/opportunities/${opp.id}/aprovacao`)}>
          Pedir aprovação{opp.approvalStatus ? <span className={clsx('ml-1 rounded-sm px-1.5 py-0.5 text-2xs font-bold', { pendente: 'bg-[#FFF6D6] text-[#9A6B00]', aprovada: 'bg-success-soft text-[#15803D]', reprovada: 'bg-danger-soft text-danger', correcao: 'bg-warning-soft text-[#C2610C]', substituida: 'bg-surface-2 text-muted' }[opp.approvalStatus] ?? 'bg-surface-2 text-muted')}>{{ pendente: 'pendente', aprovada: 'aprovada', reprovada: 'reprovada', correcao: 'correção', substituida: 'pendente' }[opp.approvalStatus] ?? opp.approvalStatus}</span> : null}
        </Button>
        {editable && (
          <>
            <Button className="!bg-success !text-white hover:!opacity-90" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => requestMove('ganha')}>Venda fechada</Button>
            <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => requestMove('perdida')}>Venda perdida</Button>
          </>
        )}
        {opp.stage === 'ganha' && can('contratos') && (opp.contractId
          ? <Button variant="primary" icon={<FileSignature className="h-4 w-4" />} onClick={() => nav(`/contracts/${opp.contractId}`)}>{opp.handoffStage === 'sucesso_cliente' ? 'Contrato · Sucesso do Cliente' : 'Ver contrato'}</Button>
          : <Button variant="primary" icon={<FileSignature className="h-4 w-4" />} onClick={() => nav(`/contracts/new?opportunityId=${opp.id}`)}>Cadastrar contrato</Button>)}
        {isClosed(opp.stage) && <span className="text-sm text-muted">Encerrada em {fmtDate(opp.wonAt ?? opp.lostAt)}{canReopen ? ' — mude a etapa para reabrir.' : '. Reabrir é com a supervisão.'}</span>}
      </div>

      <div className="mb-3 ws2:hidden">
        <Tabs label="Seções do atendimento" value={mobileTab} onChange={setMobileTab} tabs={[{ key: 'cliente', label: 'Deal e conta' }, { key: 'conversa', label: 'Acompanhamento' }, { key: 'passo', label: unread.data?.chat ? `Viabilidade e chat • ${unread.data.chat}` : 'Viabilidade e chat' }]} />
      </div>

      <div className="grid grid-cols-1 gap-4 ws2:grid-cols-[300px_minmax(0,1fr)] ws3:grid-cols-[320px_minmax(0,1fr)_380px]">
        <div className={clsx(mobileTab !== 'cliente' && 'max-ws2:hidden')}>{left}</div>
        <div className={clsx(mobileTab !== 'conversa' && 'max-ws2:hidden')}>{center}</div>
        <div className={clsx('hidden ws3:block', mobileTab === 'passo' && 'max-ws2:block')}>{right}</div>
      </div>

      <Drawer open={copilot} onClose={() => setCopilot(false)} title="Viabilidade e chat" width="lg">{right}</Drawer>
      <Modal open={releasing} onClose={() => setReleasing(false)} title="Liberar porta da CTO" size="sm" footer={<><Button onClick={() => setReleasing(false)}>Cancelar</Button><Button variant="primary" loading={release.isPending} disabled={releaseReason.trim().length < 3} onClick={() => release.mutate()}>Liberar porta</Button></>}>
        <p className="mb-3 text-sm text-text">Use quando o cliente cancelar. A porta volta a ficar livre na CTO do condomínio e o registro fica no histórico.</p>
        <FormField label="Motivo do cancelamento" htmlFor="rel-reason" required><Input id="rel-reason" value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} placeholder="Ex.: mudou de endereço" data-autofocus /></FormField>
      </Modal>
      <Modal open={scheduling} onClose={() => setScheduling(false)} title="Agendar retorno" footer={<><Button onClick={() => setScheduling(false)}>Cancelar</Button><Button variant="primary" type="submit" form="ws-activity">Agendar</Button></>}>
        <ActivityComposer formId="ws-activity" hideSubmit opportunityId={opp.id} defaultTitle={f.nextAction} onDone={() => { setScheduling(false); setCenterTab('tarefas'); }} />
      </Modal>
      <ProposalGenerator oppId={opp.id} open={genProposal} onClose={() => setGenProposal(false)} />
      {email && <EmailComposer oppId={opp.id} kind={email} open onClose={() => setEmail(null)} />}
      <TransitionDialog request={pending} loading={transition.isPending} onCancel={() => setPending(null)} onConfirm={(payload) => { const kind = pending?.toKind; transition.mutate({ opp, payload }, { onSettled: () => setPending(null), onSuccess: () => { void q.refetch(); celebrate(kind); } }); }} />
      <OutcomeCelebration outcome={outcome} onClose={() => setOutcome(null)} />
    </div>
  );
}
