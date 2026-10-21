/** Administração → Gestão de Times: estrutura organizacional (diretoria → área → unidade → times), responsáveis, substitutos e alçadas. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Unit = { id: string; name: string; kind: 'diretoria' | 'area' | 'unidade'; parentId: string | null; responsibleId: string | null; responsibleName: string | null; substituteId: string | null; substituteName: string | null; approvalLimitCents: number | null; active: boolean; rowVersion: number };
type Team = { id: string; name: string; orgUnitId: string | null; substituteLeadId: string | null; substituteLeadName: string | null; leads: (string | null)[]; members: number };
type Org = { units: Unit[]; teams: Team[]; events: { id: string; type: string; createdAt: string; actorName: string | null }[] };
const KIND: Record<Unit['kind'], string> = { diretoria: 'Diretoria', area: 'Área', unidade: 'Unidade' };

export function AdminResultsSettings() {
  const q = useQuery({ queryKey: ['results', 'org'], queryFn: () => api<Org>('/results/org') });
  const [edit, setEdit] = useState<Unit | 'new' | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data!;
  const node = (u: Unit, depth: number): React.ReactNode => (
    <div key={u.id}>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3" style={{ paddingLeft: 16 + depth * 28 }}>
        <Chip tone={u.kind === 'diretoria' ? 'purple' : u.kind === 'area' ? 'blue' : 'sky'}>{KIND[u.kind]}</Chip>
        <span className="min-w-[160px] flex-1 font-semibold text-ink">{u.name}{!u.active && <span className="ml-2 text-xs font-normal text-muted">(inativa)</span>}</span>
        <span className="text-sm">Responsável: <span className="font-semibold text-ink">{u.responsibleName ?? '—'}</span>{u.substituteName && <span className="text-muted"> · substituto {u.substituteName}</span>}</span>
        {u.approvalLimitCents !== null && <span className="num text-xs text-muted">alçada {fmtBRL(u.approvalLimitCents)}</span>}
        <Button size="sm" variant="secondary" onClick={() => setEdit(u)}>Editar</Button>
      </div>
      {o.teams.filter((t) => t.orgUnitId === u.id).map((t) => <TeamRow key={t.id} t={t} units={o.units} depth={depth + 1} />)}
      {o.units.filter((x) => x.parentId === u.id).map((x) => node(x, depth + 1))}
    </div>
  );
  const loose = o.teams.filter((t) => !t.orgUnitId || !o.units.some((u) => u.id === t.orgUnitId));
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Gestão de Times</h1><p className="text-sm text-muted">A estrutura define quem responde por quê: responsável por diretoria vê a perspectiva Diretoria; por área ou unidade, Gestão; líderes de time, Liderança. O cargo não dá acesso por si — o nível de acesso continua em Segurança.</p></div>
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between p-4"><h2 className="text-lg font-bold text-ink">Estrutura organizacional</h2><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Nova unidade</Button></div>
        {!o.units.length ? <div className="border-t border-line"><EmptyState title="Nenhuma unidade" description="Comece pela diretoria e crie as áreas abaixo dela; depois vincule os times." /></div> : o.units.filter((u) => !u.parentId).map((u) => node(u, 0))}
        {!!loose.length && <><p className="border-t border-line bg-surface-2 px-4 py-2 text-xs font-semibold text-muted">Times ainda sem unidade</p>{loose.map((t) => <TeamRow key={t.id} t={t} units={o.units} depth={0} />)}</>}
      </section>
      <section className="card p-4"><h2 className="mb-2 text-lg font-bold text-ink">Histórico da estrutura</h2>{!o.events.length ? <p className="text-sm text-muted">Sem alterações.</p> : <ul className="space-y-1 text-sm">{o.events.map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · {e.actorName}: {e.type.replace('_', ' ')}</li>)}</ul>}</section>
      <UnitDialog row={edit} units={o.units} onClose={() => setEdit(null)} />
    </div>
  );
}

function TeamRow({ t, units, depth }: { t: Team; units: Unit[]; depth: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const m = useMutation({ mutationFn: (body: Record<string, unknown>) => api(`/results/org/teams/${t.id}`, { method: 'PATCH', body }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['results'] }); toast({ tone: 'success', message: 'Time atualizado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-2/40 px-4 py-2.5" style={{ paddingLeft: 16 + depth * 28 }}>
      <Chip tone="neutral">Time</Chip>
      <span className="min-w-[140px] flex-1 font-semibold text-ink">{t.name} <span className="text-xs font-normal text-muted">· {t.members} pessoa(s) · líder: {t.leads.filter(Boolean).join(', ') || '—'}</span></span>
      <Select aria-label={`Unidade do time ${t.name}`} className="w-auto" value={t.orgUnitId ?? ''} onChange={(e) => m.mutate({ orgUnitId: e.target.value || null })}><option value="">Sem unidade</option>{units.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
      <Select aria-label={`Líder substituto do time ${t.name}`} className="w-auto" value={t.substituteLeadId ?? ''} onChange={(e) => m.mutate({ substituteLeadId: e.target.value || null })}><option value="">Sem substituto</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
    </div>
  );
}

function UnitDialog({ row, units, onClose }: { row: Unit | 'new' | null; units: Unit[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const blank = { name: '', kind: 'area' as Unit['kind'], parentId: '', responsibleId: '', substituteId: '', limit: '', active: true };
  const [f, setF] = useState(blank);
  const [key, setKey] = useState<string | null>(null);
  const k = row === 'new' ? 'new' : row?.id ?? null;
  if (k !== key) { setKey(k); setF(row && row !== 'new' ? { name: row.name, kind: row.kind, parentId: row.parentId ?? '', responsibleId: row.responsibleId ?? '', substituteId: row.substituteId ?? '', limit: row.approvalLimitCents === null ? '' : String(row.approvalLimitCents / 100), active: row.active } : blank); }
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name, kind: f.kind, parentId: f.parentId || null, responsibleId: f.responsibleId || null, substituteId: f.substituteId || null, approvalLimitCents: f.limit === '' ? null : Math.round(Number(f.limit.replace(/\./g, '').replace(',', '.')) * 100) };
      return row === 'new' ? api('/results/org/units', { method: 'POST', body }) : api(`/results/org/units/${(row as Unit).id}`, { method: 'PATCH', body: { ...body, active: f.active, rowVersion: (row as Unit).rowVersion } });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['results'] }); onClose(); toast({ tone: 'success', message: 'Estrutura atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={!!row} onClose={onClose} title={row === 'new' ? 'Nova unidade' : 'Editar unidade'} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.name.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>Salvar</Button></>}>
      <div className="space-y-3">
        <FormField label="Nome" htmlFor="un-name" required><Input id="un-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Tipo" htmlFor="un-kind"><Select id="un-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Unit['kind'] })}>{Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          <FormField label="Unidade superior" htmlFor="un-parent"><Select id="un-parent" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Nenhuma (topo)</option>{units.filter((u) => row === 'new' || u.id !== (row as Unit | null)?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <FormField label="Responsável" htmlFor="un-resp"><Select id="un-resp" value={f.responsibleId} onChange={(e) => setF({ ...f, responsibleId: e.target.value })}><option value="">Ninguém</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <FormField label="Substituto" htmlFor="un-sub"><Select id="un-sub" value={f.substituteId} onChange={(e) => setF({ ...f, substituteId: e.target.value })}><option value="">Ninguém</option>{users.filter((u) => u.id !== f.responsibleId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <FormField label="Alçada para aprovar (R$)" htmlFor="un-lim" hint="Investimentos e intervenções; em branco = sem alçada"><Input id="un-lim" inputMode="decimal" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} /></FormField>
        </div>
        {row !== 'new' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Ativa</label>}
      </div>
    </Modal>
  );
}
