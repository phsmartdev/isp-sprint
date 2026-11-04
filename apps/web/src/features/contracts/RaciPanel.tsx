/**
 * Responsabilidades (Playbook Comercial PCOM 01.01): matriz RACI fixa do documento, titulares de cada papel e prazo (SLA) por atividade.
 * Titulares e prazos começam em aberto; quem tem nível Total em Contratos preenche quando a empresa definir.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import { PLAYBOOK_ROLE_LABELS, type PlaybookRole } from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { Button, ErrorState, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from './shared';

type Holder = { id: string; role: PlaybookRole; userId: string | null; userName: string | null; externalName: string | null };
type Row = { key: string; phase: string; label: string; R: PlaybookRole[]; A: PlaybookRole; C: PlaybookRole[]; I: PlaybookRole[]; slaHours: number | null };
type Data = { roles: { key: PlaybookRole; label: string; holders: Holder[] }[]; phases: { key: string; label: string }[]; matrix: Row[]; canManage: boolean };

const Code = ({ r, strong }: { r: PlaybookRole; strong?: boolean }) => (
  <span title={PLAYBOOK_ROLE_LABELS[r]} className={clsx('mr-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold', strong ? 'bg-primary text-white' : 'bg-surface-2 text-ink')}>{r.replace('_', ' ')}</span>
);

function SlaInput({ row, disabled }: { row: Row; disabled: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(row.slaHours == null ? '' : String(row.slaHours));
  const m = useMutation({
    mutationFn: () => api(`/contract-playbook/sla/${row.key}`, { method: 'PUT', body: { slaHours: v.trim() === '' ? null : Number(v) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract-playbook'] }),
    onError: (e) => { toast({ tone: 'error', message: errMsg(e) }); setV(row.slaHours == null ? '' : String(row.slaHours)); },
  });
  const changed = (v.trim() === '' ? null : Number(v)) !== row.slaHours;
  return (
    <Input aria-label={`SLA em horas: ${row.label}`} inputMode="numeric" className="w-24" placeholder="em aberto" disabled={disabled || m.isPending} value={v}
      onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} onBlur={() => { if (changed) m.mutate(); }} />
  );
}

export function RaciPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const q = useQuery({ queryKey: ['contract-playbook'], queryFn: () => api<Data>('/contract-playbook') });
  const [adding, setAdding] = useState<{ role: PlaybookRole; userId: string; externalName: string } | null>(null);
  const add = useMutation({
    mutationFn: (b: { role: PlaybookRole; userId: string | null; externalName: string | null }) => api('/contract-playbook/holders', { method: 'POST', body: b }),
    onSuccess: () => { setAdding(null); qc.invalidateQueries({ queryKey: ['contract-playbook'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/contract-playbook/holders/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['contract-playbook'] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const users = lookups.data?.users ?? [];
  return (
    <div className="space-y-4">
      <Notice>Matriz do Playbook Comercial (PCOM 01.01). R executa, A responde pelo resultado (um por atividade), C é consultado, I é informado. Titulares e prazos ficam em aberto até a empresa definir; sem prazo, a atividade não tem contagem de SLA.{!d.canManage && ' Só quem tem nível Total em Contratos altera titulares e prazos.'}</Notice>

      <section className="card p-5" aria-label="Titulares dos papéis">
        <h2 className="mb-1 font-bold text-ink">Titulares dos papéis</h2>
        <p className="mb-3 text-sm text-muted">Quem ocupa cada papel. Ator externo é nomeado, sem login no sistema. Com titulares de Supervisão definidos, a conferência do Cadastro ERP passa a ser só deles (ou da Gerência).</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {d.roles.map((r) => (
            <div key={r.key} className="min-w-0 border border-line p-3">
              <div className="mb-2 flex items-center justify-between gap-2"><p className="font-semibold text-ink"><Code r={r.key} />{r.label}</p>{d.canManage && <Button size="sm" aria-label={`Adicionar titular: ${r.label}`} icon={<Plus className="h-4 w-4" />} onClick={() => setAdding({ role: r.key, userId: '', externalName: '' })} />}</div>
              {!r.holders.length ? <p className="text-sm text-muted">Em aberto</p> : (
                <ul className="space-y-1">{r.holders.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate">{h.userName ?? <>{h.externalName} <span className="text-xs text-muted">(ator externo)</span></>}</span>{d.canManage && <button type="button" aria-label={`Remover ${h.userName ?? h.externalName}`} className="text-muted hover:text-danger" onClick={() => del.mutate(h.id)}><X className="h-4 w-4" /></button>}</li>
                ))}</ul>
              )}
              {adding?.role === r.key && (
                <div className="mt-2 space-y-2 border-t border-line pt-2">
                  <Select aria-label="Usuário" value={adding.userId} onChange={(e) => setAdding({ ...adding, userId: e.target.value, externalName: '' })}>
                    <option value="">Usuário do sistema…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                  <Input aria-label="Ator externo" placeholder="ou nome do ator externo" value={adding.externalName} onChange={(e) => setAdding({ ...adding, externalName: e.target.value, userId: '' })} />
                  <div className="flex justify-end gap-2"><Button size="sm" onClick={() => setAdding(null)}>Cancelar</Button><Button size="sm" variant="primary" loading={add.isPending} disabled={!adding.userId && adding.externalName.trim().length < 2} onClick={() => add.mutate({ role: r.key, userId: adding.userId || null, externalName: adding.userId ? null : adding.externalName.trim() })}>Incluir</Button></div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {d.phases.map((p) => (
        <section key={p.key} className="card p-5" aria-label={p.label}>
          <h2 className="mb-3 font-bold text-ink">{p.label}</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Atividade</th><th className="px-3 py-2 font-medium">R</th><th className="px-3 py-2 font-medium">A</th><th className="px-3 py-2 font-medium">C</th><th className="px-3 py-2 font-medium">I</th><th className="px-3 py-2 font-medium">SLA (horas)</th></tr></thead>
            <tbody>{d.matrix.filter((x) => x.phase === p.key).map((x) => (
              <tr key={x.key} className="border-t border-line">
                <td className="px-3 py-2 text-ink">{x.label}</td>
                <td className="px-3 py-2">{x.R.map((r) => <Code key={r} r={r} />)}</td>
                <td className="px-3 py-2"><Code r={x.A} strong /></td>
                <td className="px-3 py-2">{x.C.length ? x.C.map((r) => <Code key={r} r={r} />) : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2">{x.I.length ? x.I.map((r) => <Code key={r} r={r} />) : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2"><SlaInput row={x} disabled={!d.canManage} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}
    </div>
  );
}
