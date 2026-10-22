/** ABM Fase 4 — stakeholders da conta, avaliação manual de influência (com auditoria), relações e mapa de influência. */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Plus, UserPlus } from 'lucide-react';
import {
  ENTITY_LINK_ROLE_LABELS, type EntityLinkRole,
  INFLUENCE_CONTEXT_LABELS, INTEREST_LABELS, PARTICIPATION_LABELS, QUADRANT_LABELS, RELATIONSHIP_LABELS, STAKEHOLDER_ACCESS_LABELS, STAKEHOLDER_ROLE_LABELS, STANCE_LABELS, ABM_PRIORITY_LABELS,
  type InfluenceContext, type InfluenceLevel, type Interest, type Participation, type Quadrant, type RelationshipStrength, type StakeholderAccess, type StakeholderRole, type Stance, type AbmPriority,
} from '@isp/domain';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useDebounced, useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { InviteDialog } from '../../pages/cs/Surveys';

export type StakeholderRow = {
  id: string; personId: string; contactId: string; name: string; email: string | null; phone: string | null; title: string | null; unitId: string | null; unitName: string | null; account: string;
  roles: StakeholderRole[]; customRoles: string[]; interest: Interest; stance: Stance; relationshipStrength: RelationshipStrength; access: StakeholderAccess; participation: Participation; priority: AbmPriority;
  relationshipOwnerId: string | null; relationshipOwnerName: string | null; nextInteractionOn: string | null; notes: string | null; active: boolean; rowVersion: number;
  influence: InfluenceLevel | null; influenceContexts: { contextType: InfluenceContext; contextKey: string; contextLabel: string | null; level: InfluenceLevel }[]; influencePending: boolean;
};
type Policy = { labels: Record<InfluenceLevel, string>; view: boolean; edit: boolean; requireApproval: boolean };
const INF_TONE: Record<InfluenceLevel, Tone> = { muito_alto: 'red', alto: 'orange', medio: 'sky', baixo: 'neutral', muito_baixo: 'neutral', nao_avaliado: 'neutral' };
const STANCE_TONE: Record<Stance, Tone> = { defensor: 'green', favoravel: 'green', neutro: 'neutral', resistente: 'orange', opositor: 'red', desconhecido: 'neutral' };
export const InfluenceChip = ({ l, labels, pending }: { l: InfluenceLevel | null; labels: Record<InfluenceLevel, string>; pending?: boolean }) => l === null ? <span className="text-xs text-muted">sem acesso</span> : <span className="inline-flex items-center gap-1"><Chip tone={INF_TONE[l]}>{l === 'nao_avaliado' ? labels[l] : `Influência ${labels[l].toLowerCase()}`}</Chip>{pending && <span className="text-xs font-semibold text-warning">pedido pendente</span>}</span>;

type AccountData = { items: StakeholderRow[]; relations: { id: string; fromId: string; toId: string; kind: string; notes: string | null }[]; units: { id: string; name: string; parentId: string | null; active: boolean }[]; policy: Policy };

export function StakeholdersPanel({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['stakeholders', contactId], queryFn: () => api<AccountData>(`/accounts/${contactId}/stakeholders`) });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const active = d.items.filter((i) => i.active);
  return (
    <section className="card overflow-hidden" aria-label="Stakeholders da conta">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="text-sm text-muted"><b className="num text-ink">{active.length}</b> stakeholder(s) · <b className="num text-ink">{active.filter((i) => i.roles.includes('decisor')).length}</b> decisor(es){d.policy.view && <> · <b className="num text-ink">{active.filter((i) => i.influence === 'nao_avaliado').length}</b> sem influência avaliada</>}</p>
        <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Adicionar stakeholder</Button>
      </div>
      {!d.items.length ? <div className="border-t border-line"><EmptyState title="Nenhum stakeholder mapeado" description="Registre quem participa das decisões: decisores, influenciadores, avaliadores técnicos, fiscais de contrato…" /></div> : (
        <div className="scroll-thin overflow-x-auto border-t border-line">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Pessoa', 'Papéis', 'Influência', 'Interesse', 'Posicionamento', 'Relacionamento', 'Responsável', 'Próxima interação'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{d.items.map((s) => (
              <tr key={s.id} className={clsx('border-t border-line align-top', !s.active && 'opacity-60')}>
                <td className="px-3 py-2.5"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => setOpen(s.id)}>{s.name}</button><span className="block text-xs text-muted">{[s.title, s.unitName].filter(Boolean).join(' · ') || '—'}</span>{s.priority === 'critica' && <Chip tone="red">Prioridade crítica</Chip>}</td>
                <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1">{s.roles.map((r) => <Chip key={r} tone={r === 'bloqueador' ? 'red' : r === 'decisor' ? 'blue' : 'neutral'}>{STAKEHOLDER_ROLE_LABELS[r]}</Chip>)}{s.customRoles.map((r) => <Chip key={r}>{r}</Chip>)}</span></td>
                <td className="px-3 py-2.5"><InfluenceChip l={s.influence} labels={d.policy.labels} pending={s.influencePending} /></td>
                <td className="px-3 py-2.5">{INTEREST_LABELS[s.interest]}</td>
                <td className="px-3 py-2.5"><Chip tone={STANCE_TONE[s.stance]}>{STANCE_LABELS[s.stance]}</Chip></td>
                <td className="px-3 py-2.5 text-xs">{RELATIONSHIP_LABELS[s.relationshipStrength]} · acesso {STAKEHOLDER_ACCESS_LABELS[s.access].toLowerCase()}</td>
                <td className="px-3 py-2.5">{s.relationshipOwnerName ?? '—'}</td>
                <td className="num px-3 py-2.5">{s.nextInteractionOn ? fmtDate(s.nextInteractionOn) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <AddStakeholder open={adding} contactId={contactId} units={d.units} onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); setOpen(id); }} />
      <StakeholderDrawer id={open} contactId={contactId} units={d.units} peers={d.items} onClose={() => setOpen(null)} />
    </section>
  );
}

function AddStakeholder({ open, contactId, units, onClose, onCreated }: { open: boolean; contactId: string; units: AccountData['units']; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 250);
  const found = useQuery({ queryKey: ['people', term], enabled: open && term.trim().length >= 2, queryFn: () => api<{ items: { id: string; name: string; email: string | null; accounts: { account: string; title: string | null }[] }[] }>(`/people/search?q=${encodeURIComponent(term)}`) });
  const blank = { personId: '', personName: '', name: '', email: '', phone: '', title: '', unitId: '', roles: [] as StakeholderRole[], interest: 'desconhecido' as Interest, priority: 'media' as AbmPriority };
  const [f, setF] = useState(blank);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>(`/accounts/${contactId}/stakeholders`, { method: 'POST', body: { ...(f.personId ? { personId: f.personId } : { person: { name: f.name, email: f.email || null, phone: f.phone || null } }), title: f.title || null, unitId: f.unitId || null, roles: f.roles, interest: f.interest, priority: f.priority } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['stakeholders'] }); setF(blank); setSearch(''); toast({ tone: 'success', message: 'Stakeholder incluído. A influência começa como "não avaliado".' }); onCreated(r.id); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const valid = (f.personId || f.name.trim().length >= 2);
  return (
    <Modal open={open} onClose={onClose} title="Adicionar stakeholder" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Adicionar</Button></>}>
      <div className="space-y-4">
        {f.personId ? <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">Pessoa já cadastrada: <b>{f.personName}</b> <button type="button" className="ml-2 text-primary hover:underline" onClick={() => setF({ ...f, personId: '', personName: '' })}>trocar</button></p> : (
          <>
            <FormField label="Procurar pessoa já cadastrada" htmlFor="sk-s" hint="Evita duplicar: a mesma pessoa pode estar em várias organizações"><Input id="sk-s" value={search} onChange={(e) => setSearch(e.target.value)} /></FormField>
            {!!found.data?.items.length && <ul className="max-h-40 overflow-y-auto rounded-md border border-line">{found.data.items.map((p) => <li key={p.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setF({ ...f, personId: p.id, personName: p.name })}>{p.name}{p.email && <span className="text-xs text-muted"> · {p.email}</span>}{!!p.accounts.length && <span className="block text-xs text-muted">{p.accounts.map((a) => `${a.title ? `${a.title} em ` : ''}${a.account}`).join(' · ')}</span>}</button></li>)}</ul>}
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Nome (pessoa nova)" htmlFor="sk-n"><Input id="sk-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
              <FormField label="E-mail" htmlFor="sk-e" hint="Mesmo e-mail = mesma pessoa"><Input id="sk-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormField>
              <FormField label="Telefone" htmlFor="sk-p"><Input id="sk-p" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormField>
            </div>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Cargo" htmlFor="sk-t"><Input id="sk-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
          <FormField label="Departamento" htmlFor="sk-u"><Select id="sk-u" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}><option value="">Não informado</option>{units.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <FormField label="Interesse" htmlFor="sk-i"><Select id="sk-i" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value as Interest })}>{(Object.keys(INTEREST_LABELS) as Interest[]).map((k) => <option key={k} value={k}>{INTEREST_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Prioridade" htmlFor="sk-pr"><Select id="sk-pr" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as AbmPriority })}>{(Object.keys(ABM_PRIORITY_LABELS) as AbmPriority[]).map((k) => <option key={k} value={k}>{ABM_PRIORITY_LABELS[k]}</option>)}</Select></FormField>
        </div>
        <RolesPicker value={f.roles} onChange={(roles) => setF({ ...f, roles })} />
        <p className="text-xs text-muted">O poder de influência não é preenchido aqui: ele é avaliado depois, manualmente, com justificativa.</p>
      </div>
    </Modal>
  );
}

function RolesPicker({ value, onChange, disabled }: { value: StakeholderRole[]; onChange: (v: StakeholderRole[]) => void; disabled?: boolean }) {
  return (
    <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Papéis na decisão</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">{(Object.keys(STAKEHOLDER_ROLE_LABELS) as StakeholderRole[]).map((r) => <label key={r} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={disabled} checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />{STAKEHOLDER_ROLE_LABELS[r]}</label>)}</div>
    </fieldset>
  );
}

type Detail = StakeholderRow & {
  policy: Policy;
  influenceHistory: { id: string; contextType: InfluenceContext; contextLabel: string | null; fromLevel: InfluenceLevel; toLevel: InfluenceLevel; justification: string; evidence: string | null; actorName: string | null; approvedByName: string | null; createdAt: string }[];
  requests: { id: string; contextType: InfluenceContext; contextLabel: string | null; fromLevel: InfluenceLevel; toLevel: InfluenceLevel; justification: string; status: string; requestedByName: string | null; decidedByName: string | null; decisionNote: string | null; createdAt: string }[];
  events: { id: string; type: string; payload: Record<string, unknown>; actorName: string | null; createdAt: string }[];
  relations: { id: string; kind: string; otherName: string | null; direction: 'saida' | 'entrada' }[];
  links: { id: string; entityType: string; entityId: string; role: string; label: string; path: string }[];
  personOrigin: { sourceSystem: string; externalId: string | null } | null;
};
const REL_LABELS: Record<string, string> = { reporta_a: 'reporta a', influencia: 'influencia', aliado: 'é aliado de', conflito: 'tem conflito com', indicou: 'indicou', outro: 'se relaciona com' };

type Preset = { contextType: InfluenceContext; contextKey: string; contextLabel: string };
function StakeholderDrawer({ id, contactId, units, peers, onClose, preset }: { id: string | null; contactId: string; units: AccountData['units']; peers: StakeholderRow[]; onClose: () => void; preset?: Preset }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const q = useQuery({ queryKey: ['stakeholders', 'one', id], enabled: !!id, queryFn: () => api<Detail>(`/stakeholders/${id}`) });
  const d = q.data;
  const [f, setF] = useState<Partial<StakeholderRow> | null>(null);
  useEffect(() => setF(null), [id]);
  const cur = { ...d, ...f } as StakeholderRow;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['stakeholders'] }); void qc.invalidateQueries({ queryKey: ['influence-map'] }); };
  const save = useMutation({
    mutationFn: () => api(`/stakeholders/${id}`, { method: 'PATCH', body: { rowVersion: d!.rowVersion, ...f } }),
    onSuccess: () => { setF(null); refresh(); toast({ tone: 'success', message: 'Stakeholder atualizado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const [inf, setInf] = useState({ contextType: (preset?.contextType ?? 'conta') as InfluenceContext, contextKey: preset?.contextKey ?? '', contextLabel: preset?.contextLabel ?? '', level: 'nao_avaliado' as InfluenceLevel, justification: '', evidence: '' });
  useEffect(() => { if (preset) setInf((o) => ({ ...o, ...preset })); }, [preset?.contextKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const evaluate = useMutation({
    mutationFn: () => api<{ status: string }>(`/stakeholders/${id}/influence`, { method: 'POST', body: { ...inf, contextLabel: inf.contextLabel || (inf.contextType === 'unidade' ? units.find((u) => u.id === inf.contextKey)?.name : null) || null, evidence: inf.evidence || null } }),
    onSuccess: (r) => { setInf({ ...inf, justification: '', evidence: '' }); refresh(); toast({ tone: 'success', message: r.status === 'pendente' ? 'Pedido enviado para aprovação' : 'Influência avaliada e registrada na auditoria' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const [rel, setRel] = useState({ toId: '', kind: 'reporta_a' });
  const [survey, setSurvey] = useState(false);
  const addRel = useMutation({
    mutationFn: () => api(`/accounts/${contactId}/relations`, { method: 'POST', body: { fromId: id, toId: rel.toId, kind: rel.kind } }),
    onSuccess: () => { setRel({ toId: '', kind: 'reporta_a' }); refresh(); toast({ tone: 'success', message: 'Relação registrada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const curLevel = !d ? 'nao_avaliado' : inf.contextType === 'conta' ? d.influence : d.influenceContexts.find((c) => c.contextType === inf.contextType && c.contextKey === inf.contextKey)?.level ?? 'nao_avaliado';
  const sel = <K extends keyof StakeholderRow>(k: K, labels: Record<string, string>, label: string) => <FormField label={label} htmlFor={`sd-${String(k)}`}><Select id={`sd-${String(k)}`} value={String(cur[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{Object.entries(labels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>;
  return (
    <Drawer open={!!id} onClose={onClose} title="Stakeholder" width="lg">
      {!d ? <LoadingRows rows={6} /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-lg font-bold text-ink">{d.name}</h3><p className="text-sm text-muted">{[d.title, d.unitName, d.account].filter(Boolean).join(' · ')}</p>{(d.email || d.phone) && <p className="text-sm">{[d.email, d.phone].filter(Boolean).join(' · ')}</p>}</div><Button size="sm" variant="secondary" onClick={() => setSurvey(true)}>Enviar pesquisa</Button></div>
          {survey && <InviteDialog preset={{ contactId, account: d.account, stakeholderId: d.id }} onClose={() => setSurvey(false)} />}

          <section className="space-y-3 rounded-lg border border-line p-3" aria-label="Poder de influência">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-ink">Poder de influência</h4><InfluenceChip l={d.influence} labels={d.policy.labels} pending={d.influencePending} /></div>
            {!d.policy.view ? <p className="text-sm text-muted">Seu perfil não vê esta avaliação.</p> : (
              <>
                {!!d.influenceContexts.length && <ul className="space-y-0.5 text-sm">{d.influenceContexts.map((c) => <li key={c.contextType + c.contextKey}>{INFLUENCE_CONTEXT_LABELS[c.contextType]}{c.contextLabel && `: ${c.contextLabel}`} — <b>{d.policy.labels[c.level]}</b></li>)}</ul>}
                <p className="text-xs text-muted">Sempre avaliado por uma pessoa, com justificativa. Nenhuma automação, importação ou pesquisa muda esta classificação.{d.policy.requireApproval && ' Nesta empresa, mudanças passam por aprovação.'}</p>
                {d.policy.edit && (
                  <div className="space-y-2 rounded-md bg-surface-2 p-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <FormField label="Contexto" htmlFor="if-c"><Select id="if-c" value={inf.contextType} onChange={(e) => setInf({ ...inf, contextType: e.target.value as InfluenceContext, contextKey: '', contextLabel: '' })}>{([...(preset && !['conta', 'unidade', 'processo'].includes(preset.contextType) ? [preset.contextType] : []), 'conta', 'unidade', 'processo'] as InfluenceContext[]).map((c) => <option key={c} value={c}>{c === preset?.contextType ? `Est${c === 'oportunidade' ? 'a' : 'e'} ${INFLUENCE_CONTEXT_LABELS[c].toLowerCase()}` : INFLUENCE_CONTEXT_LABELS[c]}</option>)}</Select></FormField>
                      {inf.contextType === 'unidade' && <FormField label="Departamento" htmlFor="if-u"><Select id="if-u" value={inf.contextKey} onChange={(e) => setInf({ ...inf, contextKey: e.target.value })}><option value="">Escolha</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}
                      {inf.contextType === 'processo' && <FormField label="Processo decisório" htmlFor="if-p"><Input id="if-p" value={inf.contextLabel} onChange={(e) => setInf({ ...inf, contextLabel: e.target.value, contextKey: e.target.value.trim().toLowerCase().slice(0, 80) })} /></FormField>}
                      <FormField label={`Nova avaliação (atual: ${d.policy.labels[curLevel ?? 'nao_avaliado']})`} htmlFor="if-l"><Select id="if-l" value={inf.level} onChange={(e) => setInf({ ...inf, level: e.target.value as InfluenceLevel })}>{(Object.keys(d.policy.labels) as InfluenceLevel[]).map((l) => <option key={l} value={l}>{d.policy.labels[l]}</option>)}</Select></FormField>
                    </div>
                    {preset && inf.contextType === preset.contextType && <p className="text-xs text-muted">Avaliando a influência em: <b className="text-ink">{preset.contextLabel}</b></p>}
                    <FormField label="Justificativa" htmlFor="if-j" required hint="Por que esta pessoa tem este poder nesta decisão?"><Textarea id="if-j" rows={2} value={inf.justification} onChange={(e) => setInf({ ...inf, justification: e.target.value })} /></FormField>
                    <FormField label="Evidência" htmlFor="if-e"><Input id="if-e" value={inf.evidence} onChange={(e) => setInf({ ...inf, evidence: e.target.value })} /></FormField>
                    <Button size="sm" variant="primary" disabled={inf.justification.trim().length < 10 || inf.level === curLevel || (inf.contextType !== 'conta' && !inf.contextKey)} loading={evaluate.isPending} onClick={() => evaluate.mutate()}>{d.policy.requireApproval ? 'Enviar para aprovação' : 'Registrar avaliação'}</Button>
                  </div>
                )}
                {!!d.requests.filter((r) => r.status === 'pendente').length && <Notice tone="warning">Pedido pendente: {d.requests.filter((r) => r.status === 'pendente').map((r) => `${d.policy.labels[r.fromLevel]} → ${d.policy.labels[r.toLevel]} (${r.requestedByName})`).join('; ')}</Notice>}
                {!!d.influenceHistory.length && (
                  <details><summary className="cursor-pointer text-sm font-semibold text-primary">Auditoria da influência ({d.influenceHistory.length})</summary>
                    <ol className="mt-2 space-y-2 text-sm">{d.influenceHistory.map((h) => <li key={h.id}><span className="num text-xs text-muted">{fmtDateTime(h.createdAt)}</span> · <b>{h.actorName}</b>{h.approvedByName && ` (aprovado por ${h.approvedByName})`}: {INFLUENCE_CONTEXT_LABELS[h.contextType]}{h.contextLabel && ` ${h.contextLabel}`} — {d.policy.labels[h.fromLevel]} → <b>{d.policy.labels[h.toLevel]}</b><span className="block text-xs">{h.justification}{h.evidence && ` · evidência: ${h.evidence}`}</span></li>)}</ol>
                  </details>
                )}
              </>
            )}
          </section>

          <section className="space-y-3" aria-label="Classificações">
            <h4 className="font-bold text-ink">Vínculo e classificações</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Cargo" htmlFor="sd-title"><Input id="sd-title" value={cur.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value || null })} /></FormField>
              <FormField label="Departamento" htmlFor="sd-unit"><Select id="sd-unit" value={cur.unitId ?? ''} onChange={(e) => setF({ ...f, unitId: e.target.value || null })}><option value="">Não informado</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
              {sel('interest', INTEREST_LABELS, 'Interesse')}
              {sel('stance', STANCE_LABELS, 'Posicionamento')}
              {sel('relationshipStrength', RELATIONSHIP_LABELS, 'Força do relacionamento')}
              {sel('access', STAKEHOLDER_ACCESS_LABELS, 'Nível de acesso')}
              {sel('participation', PARTICIPATION_LABELS, 'Participação')}
              {sel('priority', ABM_PRIORITY_LABELS, 'Prioridade')}
              <FormField label="Responsável pelo relacionamento" htmlFor="sd-owner"><Select id="sd-owner" value={cur.relationshipOwnerId ?? ''} onChange={(e) => setF({ ...f, relationshipOwnerId: e.target.value || null })}><option value="">Ninguém</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
              <FormField label="Próxima interação" htmlFor="sd-next"><Input id="sd-next" type="date" value={cur.nextInteractionOn ?? ''} onChange={(e) => setF({ ...f, nextInteractionOn: e.target.value || null })} /></FormField>
            </div>
            <RolesPicker value={cur.roles ?? []} onChange={(roles) => setF({ ...f, roles })} />
            <FormField label="Observações" htmlFor="sd-notes"><Textarea id="sd-notes" rows={2} value={cur.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value || null })} /></FormField>
            <p className="text-xs text-muted">Posicionamento favorável não significa influência alta: são avaliações independentes.</p>
            {f && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar alterações</Button>}
          </section>

          {!!d.links?.length && (
            <section aria-label="Vínculos com registros"><h4 className="mb-1 font-bold text-ink">Vínculos com oportunidades, contratos e leads</h4><ul className="space-y-1 text-sm">{d.links.map((l) => <li key={l.id}><Link className="font-semibold text-primary hover:underline" to={l.path}>{l.label}</Link> · {ENTITY_LINK_ROLE_LABELS[l.role as EntityLinkRole] ?? l.role}</li>)}</ul></section>
          )}
          {d.personOrigin && <p className="text-xs text-muted">Cadastro vindo de {d.personOrigin.sourceSystem.toUpperCase()}{d.personOrigin.externalId && ` · ID externo ${d.personOrigin.externalId}`} (preservado; o ABM não altera).</p>}
          <section aria-label="Relações registradas">
            <h4 className="mb-1 font-bold text-ink">Relações registradas</h4>
            {!d.relations.length ? <p className="text-sm text-muted">Nenhuma relação registrada.</p> : <ul className="space-y-1 text-sm">{d.relations.map((r) => <li key={r.id}>{r.direction === 'saida' ? <>{d.name} <b>{REL_LABELS[r.kind]}</b> {r.otherName}</> : <>{r.otherName} <b>{REL_LABELS[r.kind]}</b> {d.name}</>}</li>)}</ul>}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <FormField label="Esta pessoa…" htmlFor="rl-k"><Select id="rl-k" value={rel.kind} onChange={(e) => setRel({ ...rel, kind: e.target.value })}>{Object.entries(REL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
              <FormField label="…quem" htmlFor="rl-t"><Select id="rl-t" value={rel.toId} onChange={(e) => setRel({ ...rel, toId: e.target.value })}><option value="">Escolha</option>{peers.filter((p) => p.id !== d.id && p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={!rel.toId} loading={addRel.isPending} onClick={() => addRel.mutate()}>Registrar relação</Button>
            </div>
          </section>

          <section><h4 className="mb-1 font-bold text-ink">Histórico</h4><ol className="space-y-1 text-sm">{d.events.map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · {e.actorName}: {e.type === 'incluido' ? 'incluiu como stakeholder' : e.type === 'alterado' ? `alterou ${(e.payload.fields as string[] | undefined)?.join(', ')}` : e.type.startsWith('influencia') ? 'pedido de influência ' + e.type.replace('influencia_', '') : e.type === 'relacao_incluida' ? 'registrou uma relação' : e.type}</li>)}</ol></section>
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- mapa de influência × interesse (interativo)
type MapPoint = { id: string; name: string; title: string | null; unitName: string | null; roles: StakeholderRole[]; stance: Stance; interest: Interest; influence: InfluenceLevel; quadrant: Quadrant | null };
const STANCE_FILL: Record<Stance, string> = { defensor: 'fill-success', favoravel: 'fill-success/70', neutro: 'fill-sky', resistente: 'fill-warning', opositor: 'fill-danger', desconhecido: 'fill-faint' };
const STANCE_BG: Record<Stance, string> = { defensor: 'bg-success', favoravel: 'bg-success/70', neutro: 'bg-sky', resistente: 'bg-warning', opositor: 'bg-danger', desconhecido: 'bg-faint' };
const REL_STROKE: Record<string, string> = { reporta_a: 'stroke-primary', influencia: 'stroke-warning', aliado: 'stroke-success', conflito: 'stroke-danger', indicou: 'stroke-sky', outro: 'stroke-muted' };
const ROWS: InfluenceLevel[] = ['muito_alto', 'alto', 'medio', 'baixo', 'muito_baixo'];
const COLS: Interest[] = ['baixo', 'medio', 'alto'];
/** Largura real do contêiner: o SVG é desenhado em pixels reais, para o texto continuar legível no celular. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (!e) return; const nw = Math.round(e.contentRect.width); if (nw > 0) setW((o) => (Math.abs(o - nw) > 2 ? nw : o)); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function InfluenceMapPanel({ contactId }: { contactId: string }) {
  const [unitId, setUnitId] = useState('');
  const [ctx, setCtx] = useState('conta');
  const [open, setOpen] = useState<string | null>(null);
  const base = useQuery({ queryKey: ['stakeholders', contactId], queryFn: () => api<AccountData>(`/accounts/${contactId}/stakeholders`) });
  const [ctype, ckey] = ctx.includes(':') ? (ctx.split(':') as [InfluenceContext, string]) : (['conta', ''] as const);
  const qs = `context=${ctype}&contextKey=${encodeURIComponent(ckey)}${unitId ? `&unitId=${unitId}` : ''}`;
  const q = useQuery({ queryKey: ['influence-map', contactId, unitId, ctx], enabled: !!base.data?.policy.view, queryFn: () => api<{ points: MapPoint[]; outside: MapPoint[]; labels: Record<InfluenceLevel, string> }>(`/accounts/${contactId}/influence-map?${qs}`) });
  if (base.isLoading) return <LoadingRows rows={5} />;
  if (base.isError) return <ErrorState error={base.error} onRetry={() => base.refetch()} />;
  if (!base.data!.policy.view) return <section className="card p-5"><Notice tone="info">Seu perfil não vê o poder de influência, por isso o mapa não é exibido.</Notice></section>;
  const contexts = [...new Map(base.data!.items.flatMap((s) => s.influenceContexts).map((c) => [`${c.contextType}:${c.contextKey}`, c])).values()];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Departamento" htmlFor="im-u"><Select id="im-u" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Toda a conta</option>{base.data!.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Influência considerada" htmlFor="im-c"><Select id="im-c" value={ctx} onChange={(e) => setCtx(e.target.value)}><option value="conta">Na conta</option>{contexts.map((c) => <option key={`${c.contextType}:${c.contextKey}`} value={`${c.contextType}:${c.contextKey}`}>{INFLUENCE_CONTEXT_LABELS[c.contextType]}: {c.contextLabel ?? c.contextKey}</option>)}</Select></FormField>
        <a href={`/api/v1/accounts/${contactId}/influence-map?format=csv&${qs}`} className="inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2"><Download className="h-4 w-4" />Exportar CSV</a>
      </div>
      {!q.data ? <LoadingRows rows={4} /> : (
        <>
          <InfluenceMatrix data={q.data} account={base.data!} onOpen={setOpen} />
          <section className="card p-4" aria-label="Fora da matriz">
            <h3 className="font-bold text-ink">Fora da matriz</h3>
            <p className="text-xs text-muted">Pessoas sem influência avaliada ou com interesse desconhecido. Clique para avaliar.</p>
            {!q.data.outside.length ? <p className="mt-1 text-sm text-muted">Todos os stakeholders estão avaliados.</p> : <ul className="mt-2 flex flex-wrap gap-1.5">{q.data.outside.map((p) => <li key={p.id}><button type="button" onClick={() => setOpen(p.id)} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs hover:border-primary hover:text-primary">{p.name} <span className="text-muted">({p.influence === 'nao_avaliado' ? 'influência não avaliada' : 'interesse desconhecido'})</span></button></li>)}</ul>}
          </section>
          <RelationshipNetwork data={base.data!} onOpen={setOpen} />
        </>
      )}
      <StakeholderDrawer id={open} contactId={contactId} units={base.data!.units} peers={base.data!.items} onClose={() => setOpen(null)} />
    </div>
  );
}

function InfluenceMatrix({ data, account, onOpen }: { data: { points: MapPoint[]; labels: Record<InfluenceLevel, string> }; account: AccountData; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const [stances, setStances] = useState<Stance[]>([]);
  const [role, setRole] = useState('');
  const [showRel, setShowRel] = useState(true);
  const [quad, setQuad] = useState<Quadrant | null>(null);
  const extra = new Map(account.items.map((i) => [i.id, i]));
  const [box, boxW] = useWidth<HTMLDivElement>(760);
  const W = Math.max(300, boxW), narrow = W < 560, L = narrow ? 74 : 96, T = 8, R = 8, B = 44, H = narrow ? 400 : 480;
  const cw = (W - L - R) / COLS.length, rh = (H - T - B) / ROWS.length;
  const named = cw >= 150; // há espaço para o primeiro nome abaixo de cada ponto
  // posição: célula (interesse × influência) e espalhamento determinístico dentro da célula
  const cells = new Map<string, MapPoint[]>();
  for (const p of data.points) { const k = `${p.interest}|${p.influence}`; cells.set(k, [...(cells.get(k) ?? []), p]); }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [k, pts] of cells) {
    const [it, inf] = k.split('|') as [Interest, InfluenceLevel];
    const cx = L + COLS.indexOf(it) * cw + cw / 2, cy = T + ROWS.indexOf(inf) * rh + rh / 2;
    const step = named ? 76 : 30, n = pts.length, per = Math.max(1, Math.min(n, Math.floor((cw - 12) / step))), lines = Math.ceil(n / per);
    pts.forEach((p, i) => { const row = Math.floor(i / per), inRow = Math.min(per, n - row * per), col = i % per; pos.set(p.id, { x: cx + (col - (inRow - 1) / 2) * step, y: cy - (named ? 6 : 0) + (row - (lines - 1) / 2) * Math.min(named ? 40 : 28, (rh - 12) / lines) }); });
  }
  const visible = (p: MapPoint) => (!stances.length || stances.includes(p.stance)) && (!role || p.roles.includes(role as StakeholderRole)) && (!quad || p.quadrant === quad);
  const related = new Set(hover ? account.relations.filter((r) => r.fromId === hover || r.toId === hover).flatMap((r) => [r.fromId, r.toId]) : []);
  const rels = account.relations.filter((r) => pos.has(r.fromId) && pos.has(r.toId));
  const hp = hover ? data.points.find((p) => p.id === hover) : null;
  const hx = hp ? extra.get(hp.id) : null;
  const splitX = L + cw, splitY = T + 3 * rh;
  const quads: { q: Quadrant; x: number; y: number; w: number; h: number; tone: string }[] = [
    { q: 'manter_satisfeito', x: L, y: T, w: cw, h: 3 * rh, tone: 'fill-warning/5' },
    { q: 'gerenciar_de_perto', x: splitX, y: T, w: 2 * cw, h: 3 * rh, tone: 'fill-primary/10' },
    { q: 'monitorar', x: L, y: splitY, w: cw, h: 2 * rh, tone: 'fill-surface-2' },
    { q: 'manter_informado', x: splitX, y: splitY, w: 2 * cw, h: 2 * rh, tone: 'fill-sky/5' },
  ];
  const count = (qd: Quadrant) => data.points.filter((p) => p.quadrant === qd).length;
  return (
    <section className="card p-4" aria-label="Mapa de influência">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por posicionamento">
          {(Object.keys(STANCE_LABELS) as Stance[]).map((s) => { const on = stances.includes(s); return (
            <button key={s} type="button" aria-pressed={on} onClick={() => setStances(on ? stances.filter((x) => x !== s) : [...stances, s])} className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary-soft font-semibold text-ink' : 'border-line text-muted hover:text-ink')}><span className={clsx('h-2.5 w-2.5 rounded-full', STANCE_BG[s])} />{STANCE_LABELS[s]}</button>
          ); })}
        </div>
        <Select aria-label="Filtrar por papel" value={role} onChange={(e) => setRole(e.target.value)} className="h-8 w-auto text-xs"><option value="">Todos os papéis</option>{(Object.keys(STAKEHOLDER_ROLE_LABELS) as StakeholderRole[]).map((r) => <option key={r} value={r}>{STAKEHOLDER_ROLE_LABELS[r]}</option>)}</Select>
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={showRel} onChange={(e) => setShowRel(e.target.checked)} />Mostrar relações</label>
        {(stances.length > 0 || role || quad) && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => { setStances([]); setRole(''); setQuad(null); }}>Limpar filtros</button>}
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="group" aria-label="Filtrar por quadrante">
        {(['gerenciar_de_perto', 'manter_satisfeito', 'manter_informado', 'monitorar'] as Quadrant[]).map((qd) => (
          <button key={qd} type="button" aria-pressed={quad === qd} onClick={() => setQuad(quad === qd ? null : qd)} title={QUADRANT_LABELS[qd].hint} className={clsx('rounded-md border px-2.5 py-1.5 text-left text-xs', quad === qd ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2')}>
            <span className="num block text-lg font-bold leading-tight text-ink">{count(qd)}</span>{QUADRANT_LABELS[qd].title}
          </button>
        ))}
      </div>
      <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full select-none" role="group" aria-label={`Matriz influência por interesse com ${data.points.length} stakeholders`}>
          {quads.map((r) => (
            <g key={r.q} className="cursor-pointer" onClick={() => setQuad(quad === r.q ? null : r.q)}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} className={clsx(r.tone, quad === r.q ? 'stroke-primary' : 'stroke-line')} strokeWidth={quad === r.q ? 2 : 1} />
              {!narrow && <text x={r.x + 8} y={r.y + 16} className={clsx('text-[12px] font-bold', r.q === 'gerenciar_de_perto' ? 'fill-primary' : 'fill-muted')}>{QUADRANT_LABELS[r.q].title}</text>}
            </g>
          ))}
          {ROWS.map((l, i) => <g key={l}><line x1={L} x2={W - R} y1={T + i * rh} y2={T + i * rh} className="stroke-line" strokeDasharray="2 4" /><text x={L - 8} y={T + i * rh + rh / 2 + 4} textAnchor="end" className="fill-muted text-[11px]">{data.labels[l]}</text></g>)}
          {COLS.map((c, i) => <text key={c} x={L + i * cw + cw / 2} y={H - B + 18} textAnchor="middle" className="fill-muted text-[11px]">{INTEREST_LABELS[c]}</text>)}
          <text x={L + (W - L - R) / 2} y={H - 6} textAnchor="middle" className="fill-ink text-[11px] font-semibold">Interesse →</text>
          <text x={14} y={T + (H - T - B) / 2} textAnchor="middle" transform={`rotate(-90 14 ${T + (H - T - B) / 2})`} className="fill-ink text-[11px] font-semibold">Influência →</text>
          {showRel && rels.map((r) => { const a = pos.get(r.fromId)!, b = pos.get(r.toId)!; const lit = !hover || r.fromId === hover || r.toId === hover; return <line key={r.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={clsx(REL_STROKE[r.kind] ?? 'stroke-muted', 'pointer-events-none transition-opacity')} strokeWidth={lit && hover ? 2.5 : 1.5} strokeDasharray={r.kind === 'conflito' ? '5 4' : undefined} opacity={lit ? 0.9 : 0.12} />; })}
          {data.points.map((p) => {
            const o = pos.get(p.id)!; const x = extra.get(p.id); const dec = p.roles.includes('decisor'); const r = dec ? 13 : 10;
            const dim = !visible(p) || (hover !== null && hover !== p.id && !related.has(p.id));
            return (
              <g key={p.id} role="button" tabIndex={0} aria-label={`${p.name}: influência ${data.labels[p.influence]}, interesse ${INTEREST_LABELS[p.interest]}, ${STANCE_LABELS[p.stance]}. Abrir ficha`}
                className={clsx('cursor-pointer outline-none transition-opacity focus-visible:[&>circle]:stroke-focus', dim && 'opacity-20')}
                onMouseEnter={() => setHover(p.id)} onFocus={() => setHover(p.id)} onBlur={() => setHover(null)} onClick={() => onOpen(p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.id); } }}>
                {x?.priority === 'critica' && <circle cx={o.x} cy={o.y} r={r + 4} className="fill-none stroke-danger" strokeWidth={1.5} strokeDasharray="3 2" />}
                <circle cx={o.x} cy={o.y} r={hover === p.id ? r + 2 : r} className={clsx(STANCE_FILL[p.stance], 'stroke-surface transition-all')} strokeWidth={2} />
                <text x={o.x} y={o.y + 3.5} textAnchor="middle" className="pointer-events-none fill-white text-[9px] font-bold">{initials(p.name)}</text>
                {named && <text x={o.x} y={o.y + r + 13} textAnchor="middle" className={clsx('pointer-events-none fill-ink text-[11px]', hover === p.id && 'font-bold')}>{p.name.split(' ')[0]}</text>}
                {p.roles.includes('bloqueador') && <text x={o.x + r - 2} y={o.y - r + 4} className="pointer-events-none fill-danger text-[11px] font-bold">!</text>}
              </g>
            );
          })}
        </svg>
        {hp && pos.get(hp.id) && (() => { const o = pos.get(hp.id)!; const left = (o.x / W) * 100, top = (o.y / H) * 100; const flip = left > 60; return (
          <div role="tooltip" className="pointer-events-none absolute z-10 hidden w-64 sm:block rounded-md border border-line bg-surface p-3 text-xs shadow-overlay" style={{ top: `calc(${top}% + 14px)`, ...(flip ? { right: `calc(${100 - left}% + 6px)` } : { left: `calc(${left}% + 6px)` }) }}>
            <p className="text-sm font-bold text-ink">{hp.name}</p>
            <p className="text-muted">{[hp.title, hp.unitName].filter(Boolean).join(' · ') || 'Sem cargo informado'}</p>
            {!!hp.roles.length && <p className="mt-1">{hp.roles.map((r) => STAKEHOLDER_ROLE_LABELS[r]).join(', ')}</p>}
            <dl className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5"><dt className="text-muted">Influência</dt><dd className="font-semibold">{data.labels[hp.influence]}</dd><dt className="text-muted">Interesse</dt><dd className="font-semibold">{INTEREST_LABELS[hp.interest]}</dd><dt className="text-muted">Posicionamento</dt><dd className="font-semibold">{STANCE_LABELS[hp.stance]}</dd>{hx && <><dt className="text-muted">Relacionamento</dt><dd className="font-semibold">{RELATIONSHIP_LABELS[hx.relationshipStrength]}</dd><dt className="text-muted">Responsável</dt><dd className="font-semibold">{hx.relationshipOwnerName ?? '—'}</dd>{hx.nextInteractionOn && <><dt className="text-muted">Próxima interação</dt><dd className="num font-semibold">{fmtDate(hx.nextInteractionOn)}</dd></>}</>}</dl>
            {related.size > 1 && <p className="mt-1.5 text-muted">{related.size - 1} relação(ões) destacada(s) no mapa</p>}
            <p className="mt-1.5 font-semibold text-primary">Clique para abrir a ficha</p>
          </div>
        ); })()}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>Cor: posicionamento</span><span>Círculo maior: decisor</span><span><span className="font-bold text-danger">!</span> bloqueador</span><span>Contorno vermelho tracejado: prioridade crítica</span>
        {showRel && <span>Linhas: azul reporta a · laranja influencia · verde aliado · vermelho tracejado conflito</span>}
        <span>Clique num quadrante para filtrar · toque num ponto para abrir a ficha</span>
      </div>
    </section>
  );
}

/** Rede de relacionamentos: pessoas em círculo agrupadas por departamento; só relações registradas. Passe o mouse para destacar, clique para abrir. */
function RelationshipNetwork({ data, onOpen }: { data: AccountData; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const [box, boxW] = useWidth<HTMLDivElement>(680);
  const people = data.items.filter((i) => i.active).sort((a, b) => (a.unitName ?? '').localeCompare(b.unitName ?? '') || a.name.localeCompare(b.name));
  if (people.length < 2) return null;
  const W = Math.min(820, Math.max(300, boxW)), narrow = W < 560, H = narrow ? 360 : 440, cx = W / 2, cy = H / 2, Rr = narrow ? Math.min(W / 2 - 50, 140) : 165;
  const pos = new Map(people.map((p, i) => { const a = (2 * Math.PI * i) / people.length - Math.PI / 2; return [p.id, { x: cx + Rr * Math.cos(a), y: cy + Rr * Math.sin(a), a }]; }));
  const lit = new Set(hover ? data.relations.filter((r) => r.fromId === hover || r.toId === hover).flatMap((r) => [r.fromId, r.toId]) : []);
  return (
    <section className="card p-4" aria-label="Rede de relacionamentos">
      <h3 className="font-bold text-ink">Rede de relacionamentos</h3>
      <p className="mb-2 text-xs text-muted">Só aparecem relações registradas pela equipe. Passe o mouse numa pessoa para ver as conexões dela; clique para abrir a ficha.</p>
      {!data.relations.length && <p className="text-sm text-muted">Nenhuma relação registrada ainda. Registre na ficha do stakeholder.</p>}
      <div ref={box}><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="group" aria-label={`${people.length} stakeholders e ${data.relations.length} relações registradas`} onMouseLeave={() => setHover(null)}>
        <defs><marker id="rn-arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="fill-muted" /></marker></defs>
        {data.relations.map((r) => { const a = pos.get(r.fromId), b = pos.get(r.toId); if (!a || !b) return null; const on = !hover || r.fromId === hover || r.toId === hover; return (
          <g key={r.id} opacity={on ? 1 : 0.1} className="transition-opacity">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={REL_STROKE[r.kind] ?? 'stroke-muted'} strokeWidth={hover && on ? 2.5 : 1.75} strokeDasharray={r.kind === 'conflito' ? '5 4' : undefined} markerEnd="url(#rn-arrow)" />
            {hover && on && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" className="fill-ink text-[10px] font-semibold [paint-order:stroke] stroke-surface [stroke-width:3px]">{REL_LABELS[r.kind]}</text>}
          </g>
        ); })}
        {people.map((p) => { const o = pos.get(p.id)!; const right = Math.cos(o.a) >= 0; const dec = p.roles.includes('decisor'); const dim = hover !== null && hover !== p.id && !lit.has(p.id); return (
          <g key={p.id} role="button" tabIndex={0} aria-label={`${p.name}. Abrir ficha`} className={clsx('cursor-pointer outline-none transition-opacity', dim && 'opacity-25')}
            onMouseEnter={() => setHover(p.id)} onFocus={() => setHover(p.id)} onBlur={() => setHover(null)} onClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.id); } }}>
            <circle cx={o.x} cy={o.y} r={(dec ? 10 : 7) + (hover === p.id ? 2 : 0)} className={clsx(STANCE_FILL[p.stance], 'stroke-surface transition-all')} strokeWidth={2} />
            <text x={o.x + (right ? 14 : -14)} y={o.y + 4} textAnchor={right ? 'start' : 'end'} className={clsx('fill-ink text-[11px]', hover === p.id && 'font-bold')}>{narrow ? p.name.split(' ')[0] : `${p.name}${p.unitName ? ` · ${p.unitName}` : ''}`}</text>
          </g>
        ); })}
      </svg></div>
    </section>
  );
}

// ---------------------------------------------------------------- visão geral (aba Stakeholders do ABM) e aprovações
/** Abre a ficha de um stakeholder fora da Conta 360 (carrega departamentos e colegas da conta dele). */
export function StakeholderDrawerFor({ id, contactId, onClose, preset }: { id: string | null; contactId: string | null; onClose: () => void; preset?: Preset }) {
  const q = useQuery({ queryKey: ['stakeholders', contactId], enabled: !!contactId, queryFn: () => api<AccountData>(`/accounts/${contactId}/stakeholders`) });
  return <StakeholderDrawer id={q.data ? id : null} contactId={contactId ?? ''} units={q.data?.units ?? []} peers={q.data?.items ?? []} onClose={onClose} preset={preset} />;
}

type DirRow = StakeholderRow & { abmId: string | null };
export function StakeholdersDirectory() {
  const [f, setF] = useState({ q: '', role: '', influence: '', priority: '' });
  const term = useDebounced(f.q, 300);
  const [open, setOpen] = useState<{ id: string; contactId: string } | null>(null);
  const params = new URLSearchParams(Object.entries({ ...f, q: term }).filter(([, v]) => v) as [string, string][]).toString();
  const q = useQuery({ queryKey: ['stakeholders', 'all', params], queryFn: () => api<{ items: DirRow[]; policy: { labels: Record<InfluenceLevel, string>; view: boolean }; counts: { total: number; decisores: number; naoAvaliados: number | null; criticos: number } }>(`/abm/stakeholders${params ? `?${params}` : ''}`) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <PendingInfluenceRequests />
      {d && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[['Stakeholders ativos', d.counts.total], ['Decisores', d.counts.decisores], ['Prioridade crítica', d.counts.criticos], ['Sem influência avaliada', d.counts.naoAvaliados ?? '—']].map(([l, v]) => (
            <div key={l} className="card p-4"><p className="text-xs text-muted">{l}</p><p className="num text-2xl font-bold text-ink">{v}</p></div>
          ))}
        </div>
      )}
      <section className="card overflow-hidden" aria-label="Stakeholders das contas ABM">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <FormField label="Buscar" htmlFor="sd-q"><Input id="sd-q" placeholder="Nome, cargo ou conta" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></FormField>
          <FormField label="Papel" htmlFor="sd-r"><Select id="sd-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="">Todos</option>{(Object.keys(STAKEHOLDER_ROLE_LABELS) as StakeholderRole[]).map((r) => <option key={r} value={r}>{STAKEHOLDER_ROLE_LABELS[r]}</option>)}</Select></FormField>
          {d?.policy.view !== false && <FormField label="Influência" htmlFor="sd-i"><Select id="sd-i" value={f.influence} onChange={(e) => setF({ ...f, influence: e.target.value })}><option value="">Todas</option>{(Object.keys(d?.policy.labels ?? {}) as InfluenceLevel[]).map((l) => <option key={l} value={l}>{d!.policy.labels[l]}</option>)}</Select></FormField>}
          <FormField label="Prioridade" htmlFor="sd-p"><Select id="sd-p" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="">Todas</option>{(Object.keys(ABM_PRIORITY_LABELS) as AbmPriority[]).map((k) => <option key={k} value={k}>{ABM_PRIORITY_LABELS[k]}</option>)}</Select></FormField>
        </div>
        {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d!.items.length ? <div className="border-t border-line"><EmptyState title="Nenhum stakeholder encontrado" description="Mapeie as pessoas na Conta 360 de cada conta estratégica, na aba Stakeholders." /></div> : (
          <div className="scroll-thin overflow-x-auto border-t border-line">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Pessoa', 'Conta', 'Papéis', 'Influência', 'Posicionamento', 'Responsável', 'Próxima interação'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{d!.items.map((s) => (
                <tr key={s.id} className={clsx('border-t border-line align-top', !s.active && 'opacity-60')}>
                  <td className="px-3 py-2.5"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => setOpen({ id: s.id, contactId: s.contactId })}>{s.name}</button><span className="block text-xs text-muted">{[s.title, s.unitName].filter(Boolean).join(' · ') || '—'}</span></td>
                  <td className="px-3 py-2.5">{s.abmId ? <Link to={`/abm/contas/${s.abmId}?t=stakeholders`} className="hover:underline">{s.account}</Link> : s.account}</td>
                  <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1">{s.roles.map((r) => <Chip key={r} tone={r === 'bloqueador' ? 'red' : r === 'decisor' ? 'blue' : 'neutral'}>{STAKEHOLDER_ROLE_LABELS[r]}</Chip>)}</span></td>
                  <td className="px-3 py-2.5"><InfluenceChip l={s.influence} labels={d!.policy.labels} pending={s.influencePending} /></td>
                  <td className="px-3 py-2.5"><Chip tone={STANCE_TONE[s.stance]}>{STANCE_LABELS[s.stance]}</Chip></td>
                  <td className="px-3 py-2.5">{s.relationshipOwnerName ?? '—'}</td>
                  <td className="num px-3 py-2.5">{s.nextInteractionOn ? fmtDate(s.nextInteractionOn) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <StakeholderDrawerFor id={open?.id ?? null} contactId={open?.contactId ?? null} onClose={() => setOpen(null)} />
    </div>
  );
}

type InfReq = { id: string; name: string; account: string; contactId: string; abmId: string | null; stakeholderId: string; contextType: InfluenceContext; contextLabel: string | null; fromLevel: InfluenceLevel; toLevel: InfluenceLevel; justification: string; evidence: string | null; requestedByName: string; createdAt: string; canDecide: boolean };
/** Pedidos de mudança de influência aguardando decisão (quando a empresa exige aprovação). */
function PendingInfluenceRequests() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['influence-requests'], queryFn: () => api<{ items: InfReq[] }>('/influence-requests') });
  const settings = useQuery({ queryKey: ['abm-settings'], queryFn: () => api<{ influence: { labels: Record<InfluenceLevel, string> } }>('/abm/settings') });
  const [refusing, setRefusing] = useState<InfReq | null>(null);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean; note: string }) => api(`/influence-requests/${v.id}/decide`, { method: 'POST', body: { approve: v.approve, note: v.note } }),
    onSuccess: (_r, v) => { setRefusing(null); setNote(''); void qc.invalidateQueries({ queryKey: ['influence-requests'] }); void qc.invalidateQueries({ queryKey: ['stakeholders'] }); toast({ tone: 'success', message: v.approve ? 'Pedido aprovado: influência atualizada e auditada' : 'Pedido recusado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  const L = settings.data?.influence.labels;
  const lbl = (l: InfluenceLevel) => L?.[l] ?? l;
  return (
    <section className="card overflow-hidden border-warning/50" aria-label="Pedidos de influência pendentes">
      <div className="p-4"><h3 className="font-bold text-ink">Pedidos de mudança de influência ({items.length})</h3><p className="text-xs text-muted">Quem pediu não pode aprovar o próprio pedido. A aprovação registra quem aprovou na auditoria.</p></div>
      <ul className="divide-y divide-line border-t border-line">{items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
          <div className="min-w-[220px] flex-1 text-sm">
            <p><b className="text-ink">{r.name}</b> · {r.abmId ? <Link className="hover:underline" to={`/abm/contas/${r.abmId}?t=stakeholders`}>{r.account}</Link> : r.account}</p>
            <p>{INFLUENCE_CONTEXT_LABELS[r.contextType]}{r.contextLabel && `: ${r.contextLabel}`} — {lbl(r.fromLevel)} → <b>{lbl(r.toLevel)}</b></p>
            <p className="text-xs text-muted">{r.requestedByName} em {fmtDateTime(r.createdAt)}: “{r.justification}”{r.evidence && ` · evidência: ${r.evidence}`}</p>
          </div>
          {r.canDecide ? (
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={decide.isPending && decide.variables?.id === r.id && decide.variables.approve} onClick={() => decide.mutate({ id: r.id, approve: true, note: '' })}>Aprovar</Button>
              <Button size="sm" variant="secondary" onClick={() => setRefusing(r)}>Recusar</Button>
            </div>
          ) : <span className="text-xs text-muted">Aguardando a liderança</span>}
        </li>
      ))}</ul>
      <Modal open={!!refusing} onClose={() => setRefusing(null)} title="Recusar pedido de influência" footer={<><Button variant="secondary" onClick={() => setRefusing(null)}>Cancelar</Button><Button variant="danger" disabled={note.trim().length < 5} loading={decide.isPending} onClick={() => refusing && decide.mutate({ id: refusing.id, approve: false, note })}>Recusar pedido</Button></>}>
        <FormField label="Motivo da recusa" htmlFor="rq-n" required><Textarea id="rq-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </Modal>
    </section>
  );
}
