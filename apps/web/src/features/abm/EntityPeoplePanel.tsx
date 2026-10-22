/** ABM Fase 8 — pessoas da conta ligadas a uma oportunidade, contrato ou lead, com o papel em cada um, e o contexto ABM da conta. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crosshair, Plus } from 'lucide-react';
import { ENTITY_LINK_ROLE_LABELS, STANCE_LABELS, type EntityLinkRole, type InfluenceLevel, type LinkEntity, type Stance } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { AddToAbmButton, CommercialChip, PriorityChip, StatusChip } from './shared';
import { InfluenceChip, StakeholderDrawerFor } from './stakeholders';

type Data = {
  entity: { type: LinkEntity; id: string; label: string; contactId: string; account: string; open: boolean };
  abm: { id: string; status: never; priority: never; tier: string; owner: string; commercial: never } | null;
  policy: { labels: Record<InfluenceLevel, string>; view: boolean };
  roles: EntityLinkRole[];
  people: { id: string; name: string; title: string | null; roles: string[] }[];
  links: { id: string; stakeholderId: string; role: EntityLinkRole; notes: string | null; rowVersion: number; name: string; title: string | null; stance: Stance; influence: InfluenceLevel | null; influenceHere: InfluenceLevel | null; createdByName: string | null; createdAt: string }[];
  plays: { id: string; status: string; play: string; startOn: string; abmId: string }[];
};
const ENTITY_WORD: Record<LinkEntity, string> = { oportunidade: 'nesta oportunidade', contrato: 'neste contrato', lead: 'neste lead' };

export function EntityPeoplePanel({ entity, entityId, compact }: { entity: LinkEntity; entityId: string; compact?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['entity-links', entity, entityId], queryFn: () => api<Data>(`/abm/entity-links?entity=${entity}&id=${entityId}`) });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ stakeholderId: '', role: '' });
  const [removing, setRemoving] = useState<Data['links'][number] | null>(null);
  const [reason, setReason] = useState('');
  const [drawer, setDrawer] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['entity-links', entity, entityId] }); void qc.invalidateQueries({ queryKey: ['stakeholders'] }); };
  const add = useMutation({
    mutationFn: () => api('/abm/entity-links', { method: 'POST', body: { entity, entityId, stakeholderId: f.stakeholderId, role: f.role } }),
    onSuccess: () => { setAdding(false); setF({ stakeholderId: '', role: '' }); refresh(); toast({ tone: 'success', message: 'Pessoa ligada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const role = useMutation({
    mutationFn: (v: { id: string; rowVersion: number; role: string }) => api(`/abm/entity-links/${v.id}`, { method: 'PATCH', body: { rowVersion: v.rowVersion, role: v.role } }),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Papel atualizado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const rm = useMutation({
    mutationFn: () => api(`/abm/entity-links/${removing!.id}/remove`, { method: 'POST', body: { reason } }),
    onSuccess: () => { setRemoving(null); setReason(''); refresh(); toast({ tone: 'success', message: 'Vínculo desfeito (fica no histórico da pessoa)' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.isError) return compact && q.error instanceof ApiError && q.error.status === 404 ? null : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const free = d.people.filter((p) => !d.links.some((l) => l.stakeholderId === p.id));
  const preset = entity === 'oportunidade' ? { contextType: 'oportunidade' as const, contextKey: entityId, contextLabel: d.entity.label } : undefined;
  return (
    <section className={compact ? 'space-y-3' : 'card space-y-4 p-4'} aria-label="Pessoas e ABM">
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
        <Crosshair className="h-4 w-4 text-primary" aria-hidden />
        {d.abm ? (
          <><span>Conta estratégica no ABM:</span><StatusChip s={d.abm.status} /><CommercialChip s={d.abm.commercial} /><PriorityChip p={d.abm.priority} /><span className="text-xs text-muted">resp. {d.abm.owner}</span><Link className="ml-auto font-semibold text-primary hover:underline" to={`/abm/contas/${d.abm.id}`}>Abrir Conta 360</Link></>
        ) : <><span className="text-muted">{d.entity.account} não está no ABM.</span><span className="ml-auto"><AddToAbmButton contactId={d.entity.contactId} contactName={d.entity.account} /></span></>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-ink">Pessoas {ENTITY_WORD[entity]}</h3>
        {!!free.length && <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Ligar pessoa</Button>}
      </div>
      {!d.people.length ? <p className="text-sm text-muted">Nenhuma pessoa mapeada nesta conta ainda. {d.abm ? <Link className="font-semibold text-primary hover:underline" to={`/abm/contas/${d.abm.id}?t=stakeholders`}>Mapear stakeholders na Conta 360</Link> : 'Inclua a conta no ABM para mapear as pessoas.'}</p>
        : !d.links.length ? <p className="text-sm text-muted">Ninguém ligado ainda. Diga quem decide, influencia ou acompanha {ENTITY_WORD[entity]}.</p> : (
          <ul className="divide-y divide-line rounded-md border border-line">{d.links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="min-w-[180px] flex-1">
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setDrawer(l.stakeholderId)}>{l.name}</button>
                <span className="block text-xs text-muted">{l.title ?? 'Sem cargo'} · {STANCE_LABELS[l.stance]}</span>
              </div>
              <Select aria-label={`Papel de ${l.name}`} className="h-9 w-auto text-sm" value={l.role} onChange={(e) => role.mutate({ id: l.id, rowVersion: l.rowVersion, role: e.target.value })}>{d.roles.map((r) => <option key={r} value={r}>{ENTITY_LINK_ROLE_LABELS[r]}</option>)}</Select>
              {d.policy.view && (
                <span className="flex flex-wrap items-center gap-1 text-xs">
                  {entity === 'oportunidade' && l.influenceHere ? <><InfluenceChip l={l.influenceHere} labels={d.policy.labels} /><span className="text-muted">nesta oportunidade</span></> : <><InfluenceChip l={l.influence} labels={d.policy.labels} />{l.influence && l.influence !== 'nao_avaliado' && <span className="text-muted">na conta</span>}</>}
                  {entity === 'oportunidade' && <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setDrawer(l.stakeholderId)}>{l.influenceHere ? 'Reavaliar aqui' : 'Avaliar aqui'}</button>}
                </span>
              )}
              <Button size="sm" variant="ghost" onClick={() => setRemoving(l)}>Desfazer</Button>
            </li>
          ))}</ul>
        )}
      {entity === 'oportunidade' && !!d.plays.length && (
        <div><h4 className="mb-1 text-sm font-bold text-ink">Plays nesta oportunidade</h4><ul className="space-y-1 text-sm">{d.plays.map((p) => <li key={p.id}><Link className="font-semibold text-primary hover:underline" to={`/abm/contas/${p.abmId}?t=plays`}>{p.play}</Link> · início {fmtDate(p.startOn)} · <Chip tone={p.status === 'em_andamento' ? 'blue' : 'neutral'}>{p.status === 'em_andamento' ? 'Em andamento' : p.status === 'concluido' ? 'Concluído' : 'Cancelado'}</Chip></li>)}</ul></div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title={`Ligar pessoa ${ENTITY_WORD[entity]}`} footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancelar</Button><Button variant="primary" disabled={!f.stakeholderId || !f.role} loading={add.isPending} onClick={() => add.mutate()}>Ligar</Button></>}>
        <div className="space-y-3">
          <FormField label="Pessoa da conta" htmlFor="el-p"><Select id="el-p" value={f.stakeholderId} onChange={(e) => setF({ ...f, stakeholderId: e.target.value })}><option value="">Escolha</option>{free.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` · ${p.title}` : ''}</option>)}</Select></FormField>
          <FormField label={`Papel ${ENTITY_WORD[entity]}`} htmlFor="el-r"><Select id="el-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="">Escolha</option>{d.roles.map((r) => <option key={r} value={r}>{ENTITY_LINK_ROLE_LABELS[r]}</option>)}</Select></FormField>
        </div>
      </Modal>
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Desfazer vínculo" footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={rm.isPending} onClick={() => rm.mutate()}>Desfazer vínculo</Button></>}>
        <FormField label="Motivo" htmlFor="el-m" required hint="Fica registrado no histórico da pessoa"><Textarea id="el-m" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </Modal>
      <StakeholderDrawerFor id={drawer} contactId={drawer ? d.entity.contactId : null} preset={preset} onClose={() => { setDrawer(null); refresh(); }} />
    </section>
  );
}
