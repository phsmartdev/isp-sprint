import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarPlus, CheckCircle2, Handshake, ListChecks, Mail, MapPin, Phone, UserRound, XCircle } from 'lucide-react';
import {
  LOSS_REASON_LABELS, OPPORTUNITY_REASONS, OPPORTUNITY_STAGES, REASON_LABELS, SEGMENTS, SEGMENT_LABELS, STAGE_LABELS, isTerminal,
  type CustomerLifecycle, type LossReason, type OpportunityReason, type OpportunityStage, type Segment,
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
import { TransitionDialog, needsDialog, type TransitionRequest } from '../features/TransitionDialog';
import { useTransitionMutation } from '../features/useTransition';

const CHANNELS = ['WhatsApp', 'Telefone', 'Presencial', 'E-mail', 'Chat do site', 'Outro'];

// =================================================================== Nova oportunidade

type ContactHit = { id: string; name: string; phone: string | null; segment: Segment; lifecycle: CustomerLifecycle | null; externalId: string | null };

export function NewOpportunityPage() {
  const { level } = useAuth();
  const lookups = useLookups();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'novo' | 'existente'>('novo');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [segment, setSegment] = useState<Segment>('residencial');
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [contact, setContact] = useState<ContactHit | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [channel, setChannel] = useState('');
  const [planId, setPlanId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [reasons, setReasons] = useState<OpportunityReason[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dq = useDebounced(search.trim(), 250);
  const hits = useQuery({
    queryKey: ['contacts', dq],
    enabled: mode === 'existente' && dq.length >= 2,
    queryFn: () => api<{ items: ContactHit[] }>(`/contacts${qs({ q: dq })}`),
  });
  const seg = mode === 'existente' ? contact?.segment ?? 'residencial' : segment;
  const plans = (lookups.data?.plans ?? []).filter((p) => p.segment === seg);
  const assign = level('oportunidades') !== 'proprio';

  const create = useMutation({
    mutationFn: () =>
      api<Opportunity>('/opportunities', {
        method: 'POST',
        body: {
          ...(mode === 'existente' ? { contactId: contact?.id } : { newContact: { name, phone: phone || null, segment, city: city || null } }),
          leadId: params.get('leadId') || null,
          sourceId: sourceId || null,
          channel: channel || null,
          planId: planId || null,
          ownerId: ownerId || null,
          reasons,
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
    if (mode === 'novo' && name.trim().length < 2) errs['newContact.name'] = 'Informe como chamar a pessoa (ao menos 2 letras)';
    if (mode === 'existente' && !contact) errs.contactId = 'Selecione um contato da lista';
    setErrors(errs);
    if (!Object.keys(errs).length) create.mutate();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb items={[{ label: 'Oportunidades', to: '/opportunities' }, { label: 'Nova' }]} />
      <div className="mb-5 flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary"><Handshake className="h-7 w-7" /></span>
        <div>
          <h1 className="text-xl font-extrabold text-ink">Nova oportunidade</h1>
          <p className="text-muted">Só o mínimo para abrir o Sprint. O cronômetro de 7 minutos começa quando você criar.</p>
        </div>
      </div>
      <form onSubmit={submit} className="card space-y-5 p-6" noValidate>
        <div role="radiogroup" aria-label="Quem é o contato" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['novo', 'existente'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={clsx('rounded-md border px-4 py-3 text-left', mode === m ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong')}>
              <span className="block font-bold text-ink">{m === 'novo' ? 'Pessoa nova' : 'Cliente da carteira'}</span>
              <span className="block text-sm text-muted">{m === 'novo' ? 'Cria um contato provisório' : 'Busca por nome, telefone ou código'}</span>
            </button>
          ))}
        </div>

        {mode === 'novo' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Nome" htmlFor="no-name" required error={errors['newContact.name']}>
              <Input id="no-name" value={name} invalid={!!errors['newContact.name']} onChange={(e) => setName(e.target.value)} autoFocus />
            </FormField>
            <FormField label="Telefone" htmlFor="no-phone" hint="Opcional" error={errors['newContact.phone']}>
              <Input id="no-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
            <FormField label="Segmento" htmlFor="no-seg">
              <Select id="no-seg" value={segment} onChange={(e) => { setSegment(e.target.value as Segment); setPlanId(''); }}>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</Select>
            </FormField>
            <FormField label="Cidade" htmlFor="no-city" hint="Opcional">
              <Input id="no-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Aracaju" />
            </FormField>
          </div>
        ) : (
          <div>
            <FormField label="Buscar cliente" htmlFor="no-search" required error={errors.contactId}>
              <Input id="no-search" value={search} invalid={!!errors.contactId} onChange={(e) => { setSearch(e.target.value); setContact(null); }} placeholder="Digite ao menos 2 letras" autoFocus />
            </FormField>
            {contact ? (
              <div className="mt-2 flex items-center justify-between rounded-md border border-primary bg-primary-soft px-3 py-2">
                <span><span className="font-semibold text-ink">{contact.name}</span> <span className="text-sm text-muted">{contact.phone}</span></span>
                <Button size="sm" variant="ghost" onClick={() => { setContact(null); setPlanId(''); }}>Trocar</Button>
              </div>
            ) : (
              dq.length >= 2 && (
                <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line" aria-label="Resultados">
                  {hits.isLoading && <li className="px-3 py-2 text-sm text-muted">Buscando…</li>}
                  {hits.data?.items.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhum cliente encontrado na sua carteira. Use “Pessoa nova”.</li>}
                  {hits.data?.items.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setContact(c); setPlanId(''); }}>
                        <span><span className="block font-semibold text-ink">{c.name}</span><span className="block text-sm text-muted">{c.phone ?? 'sem telefone'} · {SEGMENT_LABELS[c.segment]}</span></span>
                        {c.lifecycle && <LifecycleChip s={c.lifecycle} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {contact?.lifecycle && contact.lifecycle !== 'prospect' && (
              <div className="mt-2"><Notice tone="warning">Cliente já existente{contact.externalId ? ` (${contact.externalId})` : ''}. Confira os contratos ativos antes de qualquer nova contratação.</Notice></div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Plano de interesse" htmlFor="no-plan" hint="O valor vem do catálogo de planos">
            <Select id="no-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Ainda não definido</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtBRL(p.priceCents)}/mês</option>)}
            </Select>
          </FormField>
          <FormField label="Origem" htmlFor="no-source" hint="Pode ficar como não informada">
            <Select id="no-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Não informada</option>
              {lookups.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Canal da conversa" htmlFor="no-channel">
            <Select id="no-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">Não informado</option>
              {CHANNELS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </FormField>
          {assign && (
            <FormField label="Responsável" htmlFor="no-owner" hint="Em branco: você">
              <Select id="no-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Eu mesmo</option>
                {lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </FormField>
          )}
        </div>
        <ChipGroup legend="O que motivou o contato? (pode marcar mais de um)" options={OPPORTUNITY_REASONS} value={reasons} onChange={setReasons} labels={REASON_LABELS} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={() => nav(-1)}>Cancelar</Button>
          <Button type="submit" variant="primary" size="lg" loading={create.isPending}>Iniciar Sprint</Button>
        </div>
      </form>
    </div>
  );
}

// =================================================================== Workspace

type Fields = {
  title: string;
  reasons: OpportunityReason[];
  channel: string;
  sourceId: string;
  planId: string;
  nextAction: string;
  nextActionAt: string;
  notes: string;
};

const toFields = (o: Opportunity): Fields => ({
  title: o.title,
  reasons: o.reasons,
  channel: o.channel ?? '',
  sourceId: o.sourceId ?? '',
  planId: o.planId ?? '',
  nextAction: o.nextAction ?? '',
  nextActionAt: isoToLocalInput(o.nextActionAt),
  notes: o.notes ?? '',
});

function diffFields(a: Fields, b: Fields) {
  return (Object.keys(a) as (keyof Fields)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

function toPatch(f: Fields, keys: (keyof Fields)[]) {
  const p: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === 'nextActionAt') p.nextActionAt = localInputToIso(f.nextActionAt);
    else if (k === 'sourceId') p.sourceId = f.sourceId || null;
    else if (k === 'planId') p.planId = f.planId || null;
    else if (k === 'title') p.title = f.title.trim() || null;
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
          if (d.rowVersion === opp.rowVersion && diffFields({ ...initial, ...d.fields }, initial).length) {
            initial = { ...initial, ...d.fields };
            setRestored(true);
          } else localStorage.removeItem(draftKey(opp.id));
        }
      } catch { /* sem storage */ }
      setFields(initial);
      return;
    }
    if (opp.rowVersion > base.rowVersion) {
      // mudança vinda de fora (transição, outra aba): campos não editados acompanham o servidor
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
    inFlight.current = true;
    setStatus('saving');
    try {
      const updated = await api<Opportunity>(`/opportunities/${b.id}`, { method: 'PATCH', body: { ...toPatch(f, keys), rowVersion: b.rowVersion } });
      setBase(updated);
      qc.setQueryData(['opportunity', updated.id], updated);
      qc.invalidateQueries({ queryKey: ['timeline', updated.id] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      setStatus('saved');
      setConflict(false);
      if (!diffFields(latest.current.fields!, toFields(updated)).length) {
        try { localStorage.removeItem(draftKey(updated.id)); } catch { /* ignora */ }
      }
    } catch (e) {
      setStatus('error');
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
        if (keys.length) void api(`/opportunities/${b.id}`, { method: 'PATCH', body: { ...toPatch(f, keys), rowVersion: b.rowVersion }, keepalive: true }).catch(() => {});
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

  return { base, fields, setFields, status, conflict, restored, dismissRestored: () => setRestored(false), save, reloadFromServer };
}

function Pendencies({ opp, fields }: { opp: Opportunity; fields: Fields }) {
  const items: { tone: 'warning' | 'info'; text: string }[] = [];
  const open = !isTerminal(opp.stage);
  if (open && !fields.reasons.length) items.push({ tone: 'warning', text: 'Registre o motivo do contato. Curiosidade e comparação também contam.' });
  if (open && !fields.planId) items.push({ tone: 'warning', text: 'Escolha o plano de interesse: é ele que define o valor da proposta.' });
  if (open && opp.coverageStatus !== 'elegivel') items.push({ tone: 'warning', text: `Cobertura ${opp.coverageStatus === 'nao_consultada' ? 'não consultada' : 'não confirmada'}: não prometa plano nem data de instalação.` });
  if (open && (!fields.nextAction || !fields.nextActionAt)) items.push({ tone: 'warning', text: 'Defina a próxima ação e quando ela acontece.' });
  if (open && opp.overdue) items.push({ tone: 'warning', text: 'A próxima ação está vencida. Reagende ou conclua.' });
  if (opp.customerLifecycle && opp.customerLifecycle !== 'prospect') items.push({ tone: 'info', text: 'Cliente já existente: confira os contratos ativos antes de uma nova contratação.' });
  if (opp.contactProvisional) items.push({ tone: 'info', text: 'Contato provisório. Dados pessoais completos só quando forem necessários para contratar.' });
  if (opp.stage === 'ganha' && opp.contractRequestStatus !== 'confirmada') items.push({ tone: 'info', text: 'Venda fechada no comercial. O contrato só é confirmado depois da validação no IXC.' });
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Nenhuma pendência de dados.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.text} className={clsx('rounded-md border px-3 py-2 text-sm', i.tone === 'warning' ? 'border-warning/30 bg-warning-soft text-[#9A5B00]' : 'border-primary/20 bg-primary-soft text-primary')}>{i.text}</li>
          ))}
        </ul>
      )}
      <div className="rounded-md border border-dashed border-line p-3 text-sm text-muted">
        <p className="font-semibold text-ink">Copiloto do playbook</p>
        <p>Perguntas por segmento, comparação “situação atual × proposta” e objeções chegam na Fase 2. As pendências acima são regras fixas sobre os dados registrados.</p>
      </div>
    </div>
  );
}

export function OpportunityWorkspacePage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const lookups = useLookups();
  const q = useQuery({ queryKey: ['opportunity', id], queryFn: () => api<Opportunity>(`/opportunities/${id}`), refetchOnWindowFocus: true });
  const acts = useQuery({
    queryKey: ['activities', 'opp', id],
    enabled: !!q.data && can('atividades'),
    queryFn: () => api<Paged<Activity>>(`/activities${qs({ opportunityId: id, status: 'todas', scope: can('atividades', 'equipe') ? 'equipe' : 'minhas', pageSize: 50 })}`),
  });
  const a = useAutosave(q.data);
  const transition = useTransitionMutation();
  const [pending, setPending] = useState<TransitionRequest | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [copilot, setCopilot] = useState(false);
  const [mobileTab, setMobileTab] = useState<'cliente' | 'conversa' | 'passo' | 'historico'>('conversa');
  const [centerTab, setCenterTab] = useState<'atividades' | 'historico'>('atividades');

  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const opp = a.base ?? q.data!;
  const f = a.fields;
  if (!f) return <div className="card"><LoadingRows rows={8} /></div>;
  const canReopen = can('oportunidades', 'equipe');
  const editable = !isTerminal(opp.stage);
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => a.setFields((x) => (x ? { ...x, [k]: v } : x));
  const running = !isTerminal(opp.stage) && !!opp.sprintStartedAt && Date.now() - new Date(opp.sprintStartedAt).getTime() < 12 * 3_600_000;
  const plans = (lookups.data?.plans ?? []).filter((p) => p.segment === opp.contactSegment || p.id === f.planId);
  const selectedPlan = lookups.data?.plans.find((p) => p.id === f.planId);

  const requestMove = (to: OpportunityStage) => {
    if (to === opp.stage) return;
    const req = { from: opp.stage, to, title: opp.title };
    if (needsDialog(opp.stage, to)) setPending(req);
    else transition.mutate({ opp, payload: { toStage: to } });
  };

  const left = (
    <section aria-labelledby="ws-contact" className="space-y-4">
      <div className="card p-5">
        <h2 id="ws-contact" className="mb-3 flex items-center gap-2 text-md font-bold text-ink"><UserRound className="h-5 w-5 text-primary" aria-hidden />Cliente</h2>
        <p className="text-md font-bold text-ink">{opp.contactName}</p>
        <p className="text-sm text-muted">{productLabel(opp.contactSegment)}</p>
        <div className="mt-2 space-y-1 text-sm text-text">
          {opp.contactPhone && <p className="num flex items-center gap-2"><Phone className="h-4 w-4 text-success" aria-hidden />{opp.contactPhone}</p>}
          {opp.contactEmail && <p className="flex items-center gap-2 break-all"><Mail className="h-4 w-4 text-primary" aria-hidden />{opp.contactEmail}</p>}
          {opp.contactCity && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-purple" aria-hidden />{opp.contactCity}</p>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <LifecycleChip s={opp.customerLifecycle ?? 'prospect'} />
          {opp.contactProvisional && <span className="text-xs text-muted">Contato provisório</span>}
        </div>
        {can('clientes') && <Link to={`/customers/${opp.contactId}`} className="link mt-3 inline-block text-sm font-semibold">Abrir ficha do cliente</Link>}
      </div>
      <div className="card space-y-3 p-5 text-sm">
        <h2 className="text-md font-bold text-ink">Situação</h2>
        <div className="flex flex-wrap gap-1.5"><StageChip stage={opp.stage} /><CoverageChip s={opp.coverageStatus} /><ProposalChip s={opp.proposalStatus} /><ContractChip s={opp.contractRequestStatus} /></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-muted">Responsável</dt><dd className="flex items-center gap-2 text-text"><Avatar name={opp.ownerName} userId={opp.ownerId} hasPhoto={opp.ownerHasAvatar} size={22} />{opp.ownerName}</dd>
          <dt className="text-muted">Valor mensal</dt><dd className="num font-bold text-ink">{fmtBRL(opp.valueCents)}</dd>
          <dt className="text-muted">Origem</dt><dd className="text-text">{opp.sourceName ?? 'Não informada'}</dd>
          {opp.campaignName && (<><dt className="text-muted">Campanha</dt><dd className="text-text">{opp.campaignName}</dd></>)}
          <dt className="text-muted">Criada</dt><dd className="num text-text">{fmtDateTime(opp.createdAt)}</dd>
          <dt className="text-muted">Na etapa há</dt><dd className="num text-text">{opp.daysInStage} dia(s)</dd>
          {opp.lossReason && (<><dt className="text-muted">Perda</dt><dd className="text-text">{LOSS_REASON_LABELS[opp.lossReason as LossReason] ?? opp.lossReason}</dd></>)}
        </dl>
      </div>
    </section>
  );

  const center = (
    <section aria-label="Conversa e registro" className="space-y-4">
      {a.restored && (
        <Notice tone="warning">
          Recuperamos alterações que não tinham sido salvas. Elas serão gravadas agora.{' '}
          <button className="underline" onClick={a.dismissRestored}>Entendi</button>
        </Notice>
      )}
      {a.conflict && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>Outra pessoa alterou esta oportunidade. Suas últimas edições não foram salvas.</span>
          <Button size="sm" onClick={a.reloadFromServer}>Recarregar versão atual</Button>
        </div>
      )}
      <div className="card space-y-4 p-5">
        <ChipGroup legend="Motivo do contato" options={OPPORTUNITY_REASONS} value={f.reasons} onChange={(v) => editable && set('reasons', v)} labels={REASON_LABELS} disabled={!editable} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Plano" htmlFor="ws-plan" hint={selectedPlan ? `Valor do catálogo: ${fmtBRL(selectedPlan.priceCents)}/mês` : 'O valor vem do catálogo de planos'}>
            <Select id="ws-plan" value={f.planId} disabled={!editable} onChange={(e) => set('planId', e.target.value)}>
              <option value="">Ainda não definido</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtBRL(p.priceCents)}</option>)}
            </Select>
          </FormField>
          <FormField label="Título" htmlFor="ws-title">
            <Input id="ws-title" value={f.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} />
          </FormField>
          <FormField label="Origem" htmlFor="ws-source">
            <Select id="ws-source" value={f.sourceId} disabled={!editable} onChange={(e) => set('sourceId', e.target.value)}>
              <option value="">Não informada</option>
              {lookups.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Canal" htmlFor="ws-channel">
            <Select id="ws-channel" value={f.channel} disabled={!editable} onChange={(e) => set('channel', e.target.value)}>
              <option value="">Não informado</option>
              {CHANNELS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </FormField>
          <FormField label="Próxima ação" htmlFor="ws-na">
            <Input id="ws-na" value={f.nextAction} disabled={!editable} onChange={(e) => set('nextAction', e.target.value)} placeholder="Ex.: confirmar cobertura no endereço" />
          </FormField>
          <FormField label="Quando" htmlFor="ws-nat">
            <Input id="ws-nat" type="datetime-local" value={f.nextActionAt} disabled={!editable} onChange={(e) => set('nextActionAt', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Anotações da conversa" htmlFor="ws-notes" hint="O que o cliente valoriza, o que tem hoje (se ele disser), dúvidas e combinados.">
          <Textarea id="ws-notes" className="min-h-[140px]" value={f.notes} disabled={!editable} onChange={(e) => set('notes', e.target.value)} />
        </FormField>
      </div>

      <div className="card">
        <div className="px-5 pt-2">
          <Tabs
            label="Detalhes"
            value={centerTab}
            onChange={setCenterTab}
            tabs={[
              { key: 'atividades', label: 'Atividades', count: acts.data?.items.filter((x) => !x.completedAt).length },
              { key: 'historico', label: 'Histórico' },
            ]}
          />
        </div>
        <div className="p-5" role="tabpanel">
          {centerTab === 'atividades' ? (
            !can('atividades') ? <p className="text-sm text-muted">Seu perfil não tem acesso ao módulo Atividades.</p>
              : acts.isLoading ? <LoadingRows rows={3} /> : acts.data?.items.length ? (
                <ul className="divide-y divide-line">{acts.data.items.map((x) => <ActivityRow key={x.id} a={x} showOwner compact />)}</ul>
              ) : (
                <EmptyState title="Nenhuma atividade" description="Agende um retorno para não perder o fio da conversa." action={<Button variant="primary" onClick={() => setScheduling(true)}>Agendar retorno</Button>} />
              )
          ) : (
            <Timeline opportunityId={opp.id} />
          )}
        </div>
      </div>
    </section>
  );

  const right = (
    <section aria-labelledby="ws-next" className="card p-5">
      <h2 id="ws-next" className="mb-3 flex items-center gap-2 text-md font-bold text-ink"><ListChecks className="h-5 w-5 text-primary" aria-hidden />Próximo passo</h2>
      <Pendencies opp={opp} fields={f} />
    </section>
  );

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumb items={[{ label: 'Oportunidades', to: '/opportunities' }, { label: `OP-${opp.code}` }]} />
          <h1 className="truncate text-xl font-extrabold text-ink">{opp.contactName}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{opp.title}</span>
            <SaveStatus state={a.status} onRetry={() => void a.save()} />
          </p>
        </div>
        <SprintTimer startedAt={opp.sprintStartedAt} baseSeconds={opp.sprintElapsedSeconds} running={running} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="ws-stage" className="text-sm text-muted">Etapa</label>
        <Select id="ws-stage" className="w-auto" value={opp.stage} onChange={(e) => requestMove(e.target.value as OpportunityStage)} disabled={transition.isPending || (isTerminal(opp.stage) && !canReopen)}>
          {OPPORTUNITY_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </Select>
        {can('atividades') && <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)}>Agendar retorno</Button>}
        {editable && (
          <>
            <Button icon={<CheckCircle2 className="h-4 w-4 text-success" />} onClick={() => requestMove('ganha')}>Venda fechada</Button>
            <Button icon={<XCircle className="h-4 w-4 text-danger" />} onClick={() => requestMove('perdida')}>Marcar como perdida</Button>
          </>
        )}
        <Button className="ws3:hidden max-ws2:hidden" icon={<ListChecks className="h-4 w-4" />} onClick={() => setCopilot(true)}>Próximo passo</Button>
        {isTerminal(opp.stage) && <span className="text-sm text-muted">Encerrada em {fmtDate(opp.wonAt ?? opp.lostAt)}{canReopen ? ' — mude a etapa para reabrir.' : '. Reabrir é com a supervisão.'}</span>}
      </div>

      <div className="mb-3 ws2:hidden">
        <Tabs
          label="Seções do atendimento"
          value={mobileTab}
          onChange={setMobileTab}
          tabs={[{ key: 'conversa', label: 'Conversa' }, { key: 'cliente', label: 'Cliente' }, { key: 'passo', label: 'Próximo passo' }, { key: 'historico', label: 'Histórico' }]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 ws2:grid-cols-[270px_minmax(0,1fr)] ws3:grid-cols-[290px_minmax(0,1fr)_320px]">
        <div className={clsx(mobileTab !== 'cliente' && 'max-ws2:hidden')}>{left}</div>
        <div className={clsx(mobileTab !== 'conversa' && 'max-ws2:hidden')}>{center}</div>
        <div className={clsx('hidden ws3:block', mobileTab === 'passo' && 'max-ws2:block')}>{right}</div>
        {mobileTab === 'historico' && <div className="card p-4 ws2:hidden"><Timeline opportunityId={opp.id} /></div>}
      </div>

      <Drawer open={copilot} onClose={() => setCopilot(false)} title="Próximo passo">
        <Pendencies opp={opp} fields={f} />
      </Drawer>

      <Modal
        open={scheduling}
        onClose={() => setScheduling(false)}
        title="Agendar retorno"
        footer={<><Button onClick={() => setScheduling(false)}>Cancelar</Button><Button variant="primary" type="submit" form="ws-activity">Agendar</Button></>}
      >
        <ActivityComposer formId="ws-activity" hideSubmit opportunityId={opp.id} defaultTitle={f.nextAction} onDone={() => setScheduling(false)} />
      </Modal>

      <TransitionDialog
        request={pending}
        loading={transition.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(payload) => transition.mutate({ opp, payload }, { onSettled: () => setPending(null), onSuccess: () => q.refetch() })}
      />
    </div>
  );
}
