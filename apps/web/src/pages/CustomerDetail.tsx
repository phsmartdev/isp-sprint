import { WorkLinks } from '../features/tasks/WorkLinks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MapPin, Phone, RefreshCw, UserRound } from 'lucide-react';
import { TIER_LABELS, type CustomerLifecycle, type Segment, type Tier } from '@isp/domain';
import { api, ApiError, qs } from '../lib/api';
import { fmtBRL, fmtDate, fmtDateTime, fmtRelative } from '../lib/format';
import type { Activity, LookupField, Opportunity, Paged } from '../lib/types';
import { CustomFieldsEditor, type CustomValues } from '../features/DealFields';
import { useToast } from '../components/ui/overlay';
import { useAuth } from '../auth/AuthProvider';
import { Account360 } from '../features/cs/Account360';
import { AddToAbmButton } from '../features/abm/shared';
import { Avatar, Breadcrumb, Button, Chip, EmptyState, ErrorState, LoadingRows, Notice, Tabs } from '../components/ui/primitives';
import { LifecycleChip, StageChip, productLabel } from '../components/badges';
import { ActivityRow } from '../features/ActivityRow';
import { ClassificationSection } from '../features/Classification';

type Detail = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  segment: Segment;
  city: string | null;
  isProvisional: boolean;
  custom: CustomValues;
  createdAt: string;
  ownerId: string | null;
  ownerName: string | null;
  customerId: string | null;
  lifecycle: CustomerLifecycle;
  sourceSystem: string | null;
  externalId: string | null;
  contractStart: string | null;
  nextDueOn: string | null;
  planName: string | null;
  planLine: string | null;
  planPriceCents: number | null;
  externalIds: { system: string; externalId: string }[];
  addresses: { id: string; street: string | null; number: string | null; district: string | null; city: string | null; state: string | null; validFrom: string; validTo: string | null }[];
  freshness: { ingestedAt: string; stale: boolean } | null;
  opportunities: Opportunity[];
  /** Tier pelo valor anual consolidado (ACV) e Score IPC, calculados pelo Sucesso do Cliente. null = ainda não é conta (sem venda ganha nem contrato). */
  strategic: null | {
    tier: Tier | null; acvCents: number | null; ownAcvCents: number | null; groupContacts: number;
    acvParts: { recorrente: number; medicao: number; frequente: number; semContrato: number } | null;
    acvExcluded: { count: number; cents: number } | null; classKey: string | null;
    ipc: { total: number | null; partial: number; pending: number }; computedAt: string;
  };
};

const TIER_TONE: Record<Tier, 'neutral' | 'blue' | 'green'> = { small: 'neutral', middle: 'blue', large: 'green' };

/** Tier, valor anual consolidado e IPC no resumo da conta, ao lado da classe estratégica. */
function StrategicSummary({ st }: { st: NonNullable<Detail['strategic']> }) {
  const p = st.acvParts;
  const parts = p ? [['Recorrente', p.recorrente], ['Medição', p.medicao], ['Frequente', p.frequente], ['Ganha sem contrato', p.semContrato]].filter(([, v]) => (v as number) > 0) as [string, number][] : [];
  return (
    <section aria-labelledby="tier-h" className="mb-5 border-b border-line pb-5">
      <h2 id="tier-h" className="mb-3 font-bold text-ink">Tier e potencial da conta</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-sm text-muted">Tier</dt><dd className="mt-0.5">{st.tier ? <Chip tone={TIER_TONE[st.tier]}>{TIER_LABELS[st.tier]}</Chip> : '—'}</dd></div>
        <div>
          <dt className="text-sm text-muted">Valor anual consolidado (ACV)</dt>
          <dd className="num font-semibold text-ink">{fmtBRL(st.acvCents)}<span className="font-normal text-muted">/ano</span></dd>
          {st.groupContacts > 1 && <dd className="text-xs text-muted">Grupo econômico: {st.groupContacts} contas somadas</dd>}
        </div>
        <div>
          <dt className="text-sm text-muted">Composição</dt>
          <dd className="text-sm text-ink">{parts.length ? parts.map(([l, v]) => <span key={l} className="mr-3 inline-block">{l} <span className="num font-semibold">{fmtBRL(v)}</span></span>) : '—'}</dd>
          {!!st.acvExcluded?.count && <dd className="text-xs text-muted">Fora da soma: {st.acvExcluded.count} oportunidade(s) de consumo de medição (<span className="num">{fmtBRL(st.acvExcluded.cents)}</span>), já previstas no contrato.</dd>}
        </div>
        <div>
          <dt className="text-sm text-muted">Score IPC</dt>
          <dd className="num font-semibold text-ink">{st.ipc.total !== null ? `${st.ipc.total} de 100` : `${st.ipc.partial} parcial`}</dd>
          {st.ipc.total === null && st.ipc.pending > 0 && <dd className="text-xs text-muted">{st.ipc.pending} critério(s) a avaliar no Sucesso do Cliente</dd>}
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted">Small até R$ 120 mil/ano · Middle de R$ 120 mil a R$ 500 mil · Large acima de R$ 500 mil. Calculado em {fmtDateTime(st.computedAt)}.</p>
    </section>
  );
}

function CustomerCustomFields({ contactId, initial }: { contactId: string; initial: CustomValues }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fq = useQuery({ queryKey: ['customer-fields'], queryFn: () => api<{ items: LookupField[] }>('/customer-fields'), staleTime: 60_000 });
  const [vals, setVals] = useState<CustomValues>(initial ?? {});
  const [dirty, setDirty] = useState<Record<string, true>>({});
  const save = useMutation({
    mutationFn: () => api<{ custom: CustomValues }>(`/contacts/${contactId}/custom`, { method: 'PATCH', body: { custom: Object.fromEntries(Object.keys(dirty).map((k) => [k, vals[k] ?? null])) } }),
    onSuccess: (r) => { setVals(r.custom); setDirty({}); qc.invalidateQueries({ queryKey: ['contact', contactId] }); toast({ tone: 'success', message: 'Campos salvos' }); },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message }),
  });
  const fields = fq.data?.items ?? [];
  if (!fields.length) return null;
  const missing = fields.some((f) => f.required && (vals[f.key] === undefined || vals[f.key] === null || vals[f.key] === ''));
  return (
    <section className="mt-6 border-t border-line pt-5" aria-labelledby="cust-cf">
      <h2 id="cust-cf" className="mb-3 font-bold text-ink">Campos personalizados</h2>
      <CustomFieldsEditor fields={fields} value={vals} idPrefix="cust-cf" onChange={(k, v) => { setVals((x) => ({ ...x, [k]: v })); setDirty((d) => ({ ...d, [k]: true })); }} />
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" disabled={!Object.keys(dirty).length} loading={save.isPending} onClick={() => save.mutate()}>Salvar campos</Button>
        {missing && <span className="text-sm text-warning">Há campos obrigatórios em branco.</span>}
      </div>
    </section>
  );
}

const FUTURE_TABS: Record<string, string> = {
  contratos: 'Contratos chegam com a importação do IXC (Fases 3 e 4), preservando o histórico de cada mudança.',
  financeiro: 'Faturas, pagamentos e estornos chegam na Fase 4, com acesso restrito.',
  atendimentos: 'Atendimentos e ordens de serviço chegam na Fase 4, conforme o que o IXC disponibilizar.',
};

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { can, feature } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('t') ?? 'resumo');
  const q = useQuery({ queryKey: ['contact', id], queryFn: () => api<Detail>(`/contacts/${id}`) });
  const acts = useQuery({
    queryKey: ['activities', 'contact', id],
    enabled: can('atividades'),
    queryFn: () => api<Paged<Activity>>(`/activities${qs({ contactId: id, status: 'todas', scope: can('atividades', 'equipe') ? 'equipe' : 'minhas' })}`),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const open = c.opportunities.filter((o) => o.stage !== 'ganha' && o.stage !== 'perdida');
  const fict = c.sourceSystem === 'seed_ficticio';

  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Contas', to: '/customers' }, { label: c.name }]} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-circle bg-primary-soft text-primary"><UserRound className="h-7 w-7" /></span>
          <div>
            <h1 className="text-xl font-extrabold text-ink">{c.name}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <LifecycleChip s={c.lifecycle} />
              <span>{productLabel(c.segment)}</span>
              {c.externalIds.map((e) => <span key={e.system + e.externalId} className="num">{e.system === 'seed_ficticio' ? 'Código (fictício)' : e.system}: {e.externalId}</span>)}
              {c.isProvisional && <span>Contato provisório</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {feature('marketing.abm') && <AddToAbmButton contactId={id} contactName={c.name} />}
          {can('oportunidades') && <Button variant="primary" size="lg" onClick={() => nav('/opportunities/new')}>+ Nova oportunidade</Button>}
        </div>
      </div>
      {c.freshness?.stale && (
        <div className="mb-4">
          <Notice tone="warning"><span className="inline-flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Dados desatualizados: última sincronização {fmtRelative(c.freshness.ingestedAt)}. Confirme no sistema de origem antes de decidir.</span></Notice>
        </div>
      )}
      {c.lifecycle !== 'prospect' && open.length === 0 && (
        <div className="mb-4"><Notice>Cliente existente. Antes de nova contratação, confira os contratos ativos no IXC — a aba Contratos será preenchida na Fase 3.</Notice></div>
      )}
      <div className="card">
        <div className="px-5 pt-2">
          <Tabs label="Ficha do cliente" value={tab} onChange={setTab} tabs={[
            { key: 'resumo', label: 'Resumo' },
            ...(can('oportunidades') ? [{ key: 'oportunidades', label: 'Oportunidades', count: c.opportunities.length }] : []),
            { key: 'atividades', label: 'Interações', count: acts.data?.total },
            ...(feature('crm.sucesso_cliente') ? [{ key: 'sucesso', label: 'Sucesso do Cliente' }] : []),
            ...(can('contratos') ? [{ key: 'contratos', label: 'Contratos' }] : []),
            ...(can('projetos') ? [{ key: 'projetos', label: 'Tarefas e projetos' }] : []),
            { key: 'financeiro', label: 'Financeiro' },
            { key: 'atendimentos', label: 'Atendimentos/OS' },
          ]} />
        </div>
        <div className="p-5" role="tabpanel">
          {tab === 'resumo' && c.strategic && <StrategicSummary st={c.strategic} />}
          {tab === 'resumo' && (
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-sm text-muted">Telefone</dt><dd className="num flex items-center gap-2 text-ink"><Phone className="h-4 w-4 text-success" aria-hidden />{c.phone ?? '—'}</dd></div>
              <div><dt className="text-sm text-muted">E-mail</dt><dd className="flex items-center gap-2 break-all text-ink"><Mail className="h-4 w-4 text-primary" aria-hidden />{c.email ?? '—'}</dd></div>
              <div><dt className="text-sm text-muted">Cidade</dt><dd className="flex items-center gap-2 text-ink"><MapPin className="h-4 w-4 text-purple" aria-hidden />{c.city ?? '—'}</dd></div>
              <div><dt className="text-sm text-muted">Plano</dt><dd className="text-ink">{c.planName ? `${c.planName}${c.planLine ? ` · ${c.planLine}` : ''}` : '—'}{c.planPriceCents !== null && <span className="num text-sm text-muted"> · {fmtBRL(c.planPriceCents)}/mês</span>}</dd></div>
              <div><dt className="text-sm text-muted">Início do contrato</dt><dd className="num text-ink">{fmtDate(c.contractStart)}{fict && c.contractStart && <span className="text-xs text-muted"> (fictício)</span>}</dd></div>
              <div><dt className="text-sm text-muted">Próximo vencimento</dt><dd className="num text-ink">{fmtDate(c.nextDueOn)}</dd></div>
              <div><dt className="text-sm text-muted">Responsável</dt><dd className="flex items-center gap-2 text-ink">{c.ownerName ? <><Avatar name={c.ownerName} userId={c.ownerId} size={22} />{c.ownerName}</> : 'Sem responsável'}</dd></div>
              <div><dt className="text-sm text-muted">Cadastro no CRM</dt><dd className="num text-ink">{fmtDate(c.createdAt)}</dd></div>
              <div><dt className="text-sm text-muted">Fonte do cadastro</dt><dd className="text-ink">{fict ? 'Dados fictícios de demonstração' : c.sourceSystem ?? 'CRM'}{c.freshness && <span className="text-sm text-muted"> · sincronizado {fmtDateTime(c.freshness.ingestedAt)}</span>}</dd></div>
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-sm text-muted">Endereços</dt>
                <dd className="text-ink">
                  {c.addresses.length === 0 ? '—' : (
                    <ul className="space-y-1">
                      {c.addresses.map((a) => (
                        <li key={a.id}>{[a.street, a.number, a.district, a.city, a.state].filter(Boolean).join(', ')} <span className="text-sm text-muted">· desde {fmtDate(a.validFrom)}{a.validTo ? ` até ${fmtDate(a.validTo)}` : ' (atual)'}</span></li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
          )}
          {tab === 'sucesso' && <Account360 contactId={c.id} />}
          {tab === 'projetos' && <WorkLinks prefill={{ contactId: c.id, label: c.name, kind: 'implantacao' }} />}
          {tab === 'resumo' && <ClassificationSection contactId={c.id} />}
          {tab === 'resumo' && <CustomerCustomFields key={c.id} contactId={c.id} initial={c.custom} />}
          {tab === 'oportunidades' && (c.opportunities.length === 0 ? <EmptyState title="Nenhuma oportunidade visível" /> : (
            <ul className="divide-y divide-line">
              {c.opportunities.map((o) => (
                <li key={o.id}>
                  <Link to={`/opportunities/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-2 py-3 hover:bg-surface-2">
                    <span><span className="block font-semibold text-ink">{o.planName ?? o.title}</span><span className="num block text-sm text-muted">OP-{o.code} · {o.ownerName} · {fmtDate(o.createdAt)}</span></span>
                    <span className="flex items-center gap-3"><span className="num text-sm font-bold text-ink">{fmtBRL(o.valueCents)}</span><StageChip stage={o.stage} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
          {tab === 'atividades' && (!can('atividades') ? <p className="text-sm text-muted">Seu perfil não tem acesso ao módulo Atividades.</p> : acts.isLoading ? <LoadingRows rows={3} /> : acts.data?.items.length ? <ul className="divide-y divide-line">{acts.data.items.map((a) => <ActivityRow key={a.id} a={a} showOwner compact />)}</ul> : <EmptyState title="Nenhuma interação registrada" />)}
          {FUTURE_TABS[tab] && <EmptyState title="Ainda sem dados" description={FUTURE_TABS[tab]} />}
        </div>
      </div>
    </div>
  );
}
