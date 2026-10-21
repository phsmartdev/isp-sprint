/** ABM → Conta 360: a conta inteira em um lugar, sobre os registros do CRM (sem cópias). */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, Plus } from 'lucide-react';
import {
  ABM_OBJECTIVE_KIND_LABELS, ABM_OBJECTIVE_STATUS_LABELS, ABM_ORIGIN_LABELS, ORG_UNIT_KIND_LABELS, objectiveTransition,
  type AbmObjectiveKind, type AbmObjectiveStatus, type AbmOrigin, type AbmPriority, type AbmStatus, type CommercialStatus, type ContractStage, type OrgUnitKind,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups, useUrlState } from '../../lib/hooks';
import { Breadcrumb, Button, Chip, ErrorState, FormField, Input, LoadingRows, Select, Tabs, Textarea, type Tone } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg, StageChip } from '../../features/contracts/shared';
import { WorkLinks } from '../../features/tasks/WorkLinks';
import { CommercialChip, PriorityChip, StatusChip } from '../../features/abm/shared';
import { AccountDrawer } from './Abm';

type Objective = { id: string; kind: AbmObjectiveKind; title: string; ownerName: string; ownerId: string; dueOn: string | null; status: AbmObjectiveStatus; successCriteria: string | null; result: string | null; rowVersion: number };
type Unit = { id: string; name: string; kind: OrgUnitKind; parentId: string | null; notes: string | null; active: boolean; depth: number; rowVersion: number };
type D360 = {
  commercial: CommercialStatus;
  abm: { id: string; contactId: string; status: AbmStatus; priority: AbmPriority; ownerName: string; objective: string | null; origin: AbmOrigin | null; reason: string; nextStep: string | null; nextStepOn: string | null };
  organization: { id: string; name: string; document: string | null; segment: string; nature: 'publica' | 'privada' | null; city: string | null; phone: string | null; email: string | null; crmOwnerName: string | null; rowVersion: number; sourceSystem: string; externalId: string | null };
  classification: { classKey: string | null; at: string } | null;
  lastInteraction: { title: string; type: string; at: string } | null;
  nextActivity: { id: string; title: string; due: string | null; ownerName: string | null } | null;
  objectives: Objective[]; units: Unit[];
  leads: { id: string; status: string; createdAt: string; ownerName: string | null }[];
  opportunities: { id: string; code: number; title: string; stage: string; valueCents: number | null; ownerName: string | null; createdAt: string }[];
  contracts: { id: string; code: number; stage: ContractStage; kind: string; number: string | null; monthlyCents: number | null; endAt: string | null }[];
  history: { id: string; at: string; source: 'abm' | 'atividade' | 'oportunidade'; type: string; text: string | null; payload: Record<string, unknown>; actor: string | null }[];
};
const OBJ_TONE: Record<AbmObjectiveStatus, Tone> = { planejado: 'neutral', em_andamento: 'blue', atingido: 'green', nao_atingido: 'orange', cancelado: 'neutral' };
const NATURE = { publica: 'Pública', privada: 'Privada' } as const;
const TABS = [
  { key: 'resumo', label: 'Resumo estratégico' }, { key: 'dados', label: 'Dados da organização' }, { key: 'estrutura', label: 'Estrutura organizacional' },
  { key: 'comercial', label: 'Leads e oportunidades' }, { key: 'contratos', label: 'Contratos' }, { key: 'trabalho', label: 'Projetos e tarefas' }, { key: 'historico', label: 'Histórico' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function Abm360Page() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [u, setU] = useUrlState({ t: 'resumo' });
  const q = useQuery({ queryKey: ['abm', '360', id], queryFn: () => api<D360>(`/abm/${id}/360`) });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const today = new Date().toLocaleDateString('en-CA');
  const tab = (TABS.some((t) => t.key === u.t) ? u.t : 'resumo') as Tab;
  return (
    <div>
      <Breadcrumb items={[{ label: 'ABM', to: '/abm' }, { label: d.organization.name }]} />
      <header className="card mb-4 p-5" aria-label="Cabeçalho da conta">
        <div className="flex flex-wrap items-start gap-4">
          <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary sm:flex"><Building2 className="h-7 w-7" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h1 className="break-words font-display text-xl font-bold text-ink sm:text-2xl">{d.organization.name}</h1>
            <p className="text-sm text-muted">{d.organization.nature ? NATURE[d.organization.nature] : 'Natureza não informada'} · {d.organization.segment}{d.organization.city && ` · ${d.organization.city}`}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2"><StatusChip s={d.abm.status} /><CommercialChip s={d.commercial} /><PriorityChip p={d.abm.priority} />{d.classification?.classKey && <Chip tone="blue">Classificação: {d.classification.classKey}</Chip>}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>Editar estratégia</Button>
            <Button variant="secondary" onClick={() => nav(`/customers/${d.abm.contactId}`)}>Abrir no CRM</Button>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-xs text-muted">Responsáveis</dt><dd>ABM: <b>{d.abm.ownerName}</b>{d.organization.crmOwnerName && d.organization.crmOwnerName !== d.abm.ownerName && <> · Carteira: {d.organization.crmOwnerName}</>}</dd></div>
          <div><dt className="text-xs text-muted">Última interação</dt><dd>{d.lastInteraction ? <>{d.lastInteraction.title} <span className="num text-muted">({fmtDate(d.lastInteraction.at)})</span></> : 'Nenhuma registrada'}</dd></div>
          <div><dt className="text-xs text-muted">Próxima ação</dt><dd>{d.nextActivity ? <><Link to={`/tarefas?task=${d.nextActivity.id}`} className="text-primary hover:underline">{d.nextActivity.title}</Link>{d.nextActivity.due && <span className={clsx('num', d.nextActivity.due < today ? 'font-semibold text-danger' : 'text-muted')}> ({fmtDate(d.nextActivity.due)})</span>}</> : d.abm.nextStep ? <>{d.abm.nextStep}{d.abm.nextStepOn && <span className="num text-muted"> ({fmtDate(d.abm.nextStepOn)})</span>}</> : 'Não definida'}</dd></div>
          <div><dt className="text-xs text-muted">Objetivo principal</dt><dd>{d.abm.objective ?? 'Não definido'}</dd></div>
        </dl>
      </header>
      <Tabs<Tab> label="Conta 360" value={tab} onChange={(t) => setU({ t })} tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: t.key === 'comercial' ? d.opportunities.length : t.key === 'contratos' ? d.contracts.length : undefined }))} className="mb-4" />
      {tab === 'resumo' && <Summary d={d} />}
      {tab === 'dados' && <Organization d={d} />}
      {tab === 'estrutura' && <Structure d={d} />}
      {tab === 'comercial' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="card p-4"><h2 className="mb-2 font-bold text-ink">Oportunidades</h2>{!d.opportunities.length ? <p className="text-sm text-muted">Nenhuma oportunidade com esta conta.</p> : <ul className="divide-y divide-line">{d.opportunities.map((o) => <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><Link to={`/opportunities/${o.id}`} className="min-w-0 flex-1 truncate font-semibold text-primary hover:underline">OP-{o.code} · {o.title}</Link><span className="text-xs text-muted">{o.stage} · {o.ownerName}</span>{o.valueCents !== null && <span className="num text-xs">{fmtBRL(o.valueCents)}/mês</span>}</li>)}</ul>}<Button variant="secondary" size="sm" className="mt-2" onClick={() => nav('/opportunities/new')}>Nova oportunidade</Button></section>
          <section className="card p-4"><h2 className="mb-2 font-bold text-ink">Leads</h2>{!d.leads.length ? <p className="text-sm text-muted">Nenhum lead registrado para esta conta.</p> : <ul className="divide-y divide-line">{d.leads.map((l) => <li key={l.id} className="flex items-center justify-between py-2 text-sm"><span>{l.status}</span><span className="text-xs text-muted">{l.ownerName} · {fmtDate(l.createdAt)}</span></li>)}</ul>}</section>
        </div>
      )}
      {tab === 'contratos' && (
        <section className="card p-4">{!d.contracts.length ? <p className="text-sm text-muted">Nenhum contrato com esta conta.</p> : <ul className="divide-y divide-line">{d.contracts.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><Link to={`/contracts/${c.id}`} className="min-w-0 flex-1 font-semibold text-primary hover:underline">{c.number ?? `Contrato ${c.code}`}</Link><StageChip stage={c.stage} />{c.monthlyCents !== null && <span className="num text-xs">{fmtBRL(c.monthlyCents)}/mês</span>}{c.endAt && <span className="num text-xs text-muted">até {fmtDate(c.endAt)}</span>}</li>)}</ul>}</section>
      )}
      {tab === 'trabalho' && <section className="card p-4"><WorkLinks prefill={{ contactId: d.abm.contactId, label: d.organization.name }} /></section>}
      {tab === 'historico' && <History d={d} />}
      <AccountDrawer id={editing ? d.abm.id : null} onClose={() => { setEditing(false); void q.refetch(); }} />
    </div>
  );
}

function Summary({ d }: { d: D360 }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const [adding, setAdding] = useState<{ kind: AbmObjectiveKind; title: string; ownerId: string; dueOn: string; successCriteria: string } | null>(null);
  const [closing, setClosing] = useState<{ o: Objective; to: AbmObjectiveStatus; result: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['abm'] });
  const add = useMutation({
    mutationFn: () => api(`/abm/${d.abm.id}/objectives`, { method: 'POST', body: { ...adding!, ownerId: adding!.ownerId || undefined, dueOn: adding!.dueOn || null, successCriteria: adding!.successCriteria || null } }),
    onSuccess: () => { setAdding(null); refresh(); toast({ tone: 'success', message: 'Objetivo incluído' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const move = useMutation({
    mutationFn: (v: { o: Objective; to: AbmObjectiveStatus; result?: string }) => api(`/abm/objectives/${v.o.id}`, { method: 'PATCH', body: { rowVersion: v.o.rowVersion, status: v.to, result: v.result } }),
    onSuccess: () => { setClosing(null); refresh(); toast({ tone: 'success', message: 'Objetivo atualizado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const open = d.objectives.filter((o) => o.status === 'planejado' || o.status === 'em_andamento');
  const done = d.objectives.filter((o) => !open.includes(o));
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <section className="card p-4" aria-label="Objetivos da conta">
        <div className="mb-2 flex items-center justify-between"><h2 className="font-bold text-ink">Objetivos da conta</h2>{!adding && <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding({ kind: 'abrir_relacionamento', title: '', ownerId: '', dueOn: '', successCriteria: '' })}>Novo objetivo</Button>}</div>
        {adding && (
          <div className="mb-3 space-y-3 rounded-md bg-surface-2 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Tipo" htmlFor="ob-k"><Select id="ob-k" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as AbmObjectiveKind, title: adding.title || ABM_OBJECTIVE_KIND_LABELS[e.target.value as AbmObjectiveKind] })}>{(Object.keys(ABM_OBJECTIVE_KIND_LABELS) as AbmObjectiveKind[]).map((k) => <option key={k} value={k}>{ABM_OBJECTIVE_KIND_LABELS[k]}</option>)}</Select></FormField>
              <FormField label="Objetivo" htmlFor="ob-t" required><Input id="ob-t" value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} /></FormField>
              <FormField label="Responsável" htmlFor="ob-o"><Select id="ob-o" value={adding.ownerId} onChange={(e) => setAdding({ ...adding, ownerId: e.target.value })}><option value="">Eu</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
              <FormField label="Prazo" htmlFor="ob-d"><Input id="ob-d" type="date" value={adding.dueOn} onChange={(e) => setAdding({ ...adding, dueOn: e.target.value })} /></FormField>
            </div>
            <FormField label="Como saber que foi atingido" htmlFor="ob-s"><Input id="ob-s" value={adding.successCriteria} onChange={(e) => setAdding({ ...adding, successCriteria: e.target.value })} /></FormField>
            <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setAdding(null)}>Cancelar</Button><Button size="sm" variant="primary" disabled={adding.title.trim().length < 3} loading={add.isPending} onClick={() => add.mutate()}>Incluir objetivo</Button></div>
          </div>
        )}
        {!d.objectives.length && !adding && <p className="text-sm text-muted">Defina o que se quer com esta conta: abrir relacionamento, identificar decisores, criar oportunidade…</p>}
        <ul className="divide-y divide-line">
          {[...open, ...done].map((o) => (
            <li key={o.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{o.title}</p><p className="text-xs text-muted">{ABM_OBJECTIVE_KIND_LABELS[o.kind]} · {o.ownerName}{o.dueOn && <> · até <span className="num">{fmtDate(o.dueOn)}</span></>}</p>{o.successCriteria && <p className="text-xs">Critério: {o.successCriteria}</p>}{o.result && <p className="text-xs">Resultado: {o.result}</p>}</div>
                <Chip tone={OBJ_TONE[o.status]}>{ABM_OBJECTIVE_STATUS_LABELS[o.status]}</Chip>
              </div>
              {closing?.o.id === o.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2"><FormField label={`Resultado (${ABM_OBJECTIVE_STATUS_LABELS[closing.to].toLowerCase()})`} htmlFor={`res-${o.id}`} className="min-w-[240px] flex-1"><Input id={`res-${o.id}`} value={closing.result} onChange={(e) => setClosing({ ...closing, result: e.target.value })} /></FormField><Button size="sm" variant="secondary" onClick={() => setClosing(null)}>Voltar</Button><Button size="sm" variant="primary" disabled={!!objectiveTransition(o.status, closing.to, closing.result)} loading={move.isPending} onClick={() => move.mutate({ o, to: closing.to, result: closing.result })}>Confirmar</Button></div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-3 text-xs font-semibold">
                  {o.status === 'planejado' && <button type="button" className="text-primary hover:underline" onClick={() => move.mutate({ o, to: 'em_andamento' })}>Iniciar</button>}
                  {(o.status === 'planejado' || o.status === 'em_andamento') && (['atingido', 'nao_atingido', 'cancelado'] as const).map((s) => <button key={s} type="button" className="text-muted hover:text-ink hover:underline" onClick={() => setClosing({ o, to: s, result: '' })}>Marcar como {ABM_OBJECTIVE_STATUS_LABELS[s].toLowerCase()}</button>)}
                  {(o.status === 'atingido' || o.status === 'nao_atingido' || o.status === 'cancelado') && <button type="button" className="text-muted hover:underline" onClick={() => move.mutate({ o, to: 'em_andamento' })}>Reabrir</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <aside className="space-y-4">
        <section className="card p-4 text-sm"><h2 className="mb-1 font-bold text-ink">Por que esta conta</h2><p>{d.abm.reason}</p>{d.abm.origin && <p className="mt-1 text-xs text-muted">Origem: {ABM_ORIGIN_LABELS[d.abm.origin]}</p>}</section>
        <section className="card p-4 text-sm"><h2 className="mb-1 font-bold text-ink">Panorama</h2><ul className="space-y-1"><li><span className="num font-semibold">{d.opportunities.filter((o) => o.stage !== 'ganha' && o.stage !== 'perdida').length}</span> oportunidade(s) aberta(s)</li><li><span className="num font-semibold">{d.contracts.filter((c) => ['implantacao', 'vigente', 'renovacao', 'reajuste'].includes(c.stage)).length}</span> contrato(s) ativo(s)</li><li><span className="num font-semibold">{d.units.filter((u) => u.active).length}</span> unidade(s) mapeada(s) na estrutura</li><li><span className="num font-semibold">{open.length}</span> objetivo(s) em aberto</li></ul></section>
      </aside>
    </div>
  );
}

function Organization({ d }: { d: D360 }) {
  const toast = useToast();
  const qc = useQueryClient();
  const o = d.organization;
  const [f, setF] = useState({ name: o.name, document: o.document ?? '', nature: o.nature ?? '', segment: o.segment, city: o.city ?? '', phone: o.phone ?? '', email: o.email ?? '' });
  const integrated = o.sourceSystem !== 'crm';
  const m = useMutation({
    mutationFn: () => api(`/abm/${d.abm.id}/organization`, { method: 'PATCH', body: { rowVersion: o.rowVersion, ...(integrated ? {} : { name: f.name, document: f.document || null }), nature: f.nature || null, segment: f.segment, city: f.city || null, phone: f.phone || null, email: f.email || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['abm'] }); toast({ tone: 'success', message: 'Dados da organização atualizados' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className="card max-w-3xl space-y-4 p-5">
      <p className="text-sm text-muted">Mesmo cadastro usado no CRM: o que você completar aqui vale para oportunidades, contratos e relatórios. {integrated && `Conta vinda de integração (${o.sourceSystem}): nome e CNPJ são mantidos pelo sistema de origem.`}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nome" htmlFor="og-n"><Input id="og-n" disabled={integrated} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <FormField label="CNPJ/CPF" htmlFor="og-d"><Input id="og-d" disabled={integrated} value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></FormField>
        <FormField label="Natureza" htmlFor="og-na"><Select id="og-na" value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })}><option value="">Não informada</option><option value="publica">Pública</option><option value="privada">Privada</option></Select></FormField>
        <FormField label="Segmento" htmlFor="og-s"><Select id="og-s" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })}><option value="empresarial">Empresarial</option><option value="governamental">Governamental</option><option value="institucional">Institucional</option><option value="residencial">Residencial</option></Select></FormField>
        <FormField label="Cidade" htmlFor="og-c"><Input id="og-c" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></FormField>
        <FormField label="Telefone institucional" htmlFor="og-p"><Input id="og-p" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormField>
        <FormField label="E-mail institucional" htmlFor="og-e"><Input id="og-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormField>
        {o.externalId && <FormField label="Código no sistema de origem" htmlFor="og-x"><Input id="og-x" disabled value={`${o.sourceSystem}: ${o.externalId}`} /></FormField>}
      </div>
      <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Salvar dados</Button>
    </section>
  );
}

function Structure({ d }: { d: D360 }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', kind: 'departamento' as OrgUnitKind, parentId: '' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['abm'] });
  const add = useMutation({
    mutationFn: () => api(`/abm/${d.abm.id}/units`, { method: 'POST', body: { name: f.name, kind: f.kind, parentId: f.parentId || null } }),
    onSuccess: () => { setF({ ...f, name: '' }); refresh(); toast({ tone: 'success', message: 'Unidade incluída na estrutura' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const toggle = useMutation({
    mutationFn: (u: Unit) => api(`/abm/units/${u.id}`, { method: 'PATCH', body: { abmId: d.abm.id, rowVersion: u.rowVersion, active: !u.active } }),
    onSuccess: () => refresh(), onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <section className="card p-4" aria-label="Estrutura organizacional">
        <p className="mb-3 text-sm text-muted">Hierarquia formal da organização (quem está abaixo de quem). Ela não mede poder de influência — isso é avaliado nos stakeholders.</p>
        {!d.units.length ? <p className="text-sm text-muted">Nenhuma unidade mapeada ainda.</p> : (
          <ul className="space-y-1">{d.units.map((u) => (
            <li key={u.id} className={clsx('flex items-center gap-2 rounded px-2 py-1.5 text-sm', !u.active && 'text-muted')} style={{ marginLeft: u.depth * 20 }}>
              <span className="min-w-0 flex-1"><b className={clsx(!u.active && 'line-through')}>{u.name}</b> <span className="text-xs text-muted">· {ORG_UNIT_KIND_LABELS[u.kind]}</span></span>
              <button type="button" className="text-xs font-semibold text-muted hover:underline" onClick={() => toggle.mutate(u)}>{u.active ? 'Desativar' : 'Reativar'}</button>
            </li>
          ))}</ul>
        )}
      </section>
      <section className="card space-y-3 p-4">
        <h2 className="font-bold text-ink">Incluir na estrutura</h2>
        <FormField label="Nome" htmlFor="un-n" required><Input id="un-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <FormField label="Tipo" htmlFor="un-k"><Select id="un-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as OrgUnitKind })}>{(Object.keys(ORG_UNIT_KIND_LABELS) as OrgUnitKind[]).map((k) => <option key={k} value={k}>{ORG_UNIT_KIND_LABELS[k]}</option>)}</Select></FormField>
        <FormField label="Fica abaixo de" htmlFor="un-p"><Select id="un-p" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Topo da organização</option>{d.units.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{'— '.repeat(u.depth)}{u.name}</option>)}</Select></FormField>
        <Button variant="primary" disabled={f.name.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>Incluir</Button>
      </section>
    </div>
  );
}

const HIST_TEXT: Record<string, string> = { criada: 'incluiu a conta no ABM', situacao: 'mudou o status ABM', alterada: 'atualizou a estratégia', organizacao: 'atualizou os dados da organização', objetivo_criado: 'criou um objetivo', objetivo_situacao: 'mudou a situação de um objetivo', objetivo_alterado: 'alterou um objetivo', estrutura: 'alterou a estrutura organizacional', created: 'criou a oportunidade', stage_changed: 'moveu a oportunidade' };
function History({ d }: { d: D360 }) {
  const [src, setSrc] = useState('');
  const items = d.history.filter((h) => !src || h.source === src);
  return (
    <section className="card p-4">
      <FormField label="Origem" htmlFor="hi-s" className="mb-3 w-52"><Select id="hi-s" value={src} onChange={(e) => setSrc(e.target.value)}><option value="">Tudo</option><option value="abm">Estratégia (ABM)</option><option value="atividade">Interações</option><option value="oportunidade">Oportunidades</option></Select></FormField>
      {!items.length ? <p className="text-sm text-muted">Nada registrado ainda.</p> : (
        <ol className="space-y-2">{items.map((h) => (
          <li key={h.id} className="text-sm"><span className="num text-xs text-muted">{fmtDateTime(h.at)}</span> · <b>{h.actor ?? 'Sistema'}</b> {h.source === 'atividade' ? `concluiu: ${h.text}` : `${HIST_TEXT[h.type] ?? h.type}${h.text ? `: ${h.text}` : ''}${typeof h.payload.title === 'string' ? ` — ${h.payload.title}` : ''}${h.source === 'oportunidade' && h.payload.to ? ` (${String(h.payload.to)})` : ''}`}</li>
        ))}</ol>
      )}
    </section>
  );
}
