/**
 * Configuração → Módulos e liberação (Etapa 1): liga/desliga os sete módulos de negócio na empresa, define quem recebe
 * (todos os perfis com acesso ou só equipes e pessoas liberadas), desliga funcionalidades, registra liberações e
 * bloqueios com motivo e validade, ajusta ações sensíveis por perfil e mostra a prévia do acesso de um usuário.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BUSINESS_MODULE_LABELS, LEVEL_LABELS, MODULE_LABELS, RELEASE_MODES, RELEASE_MODE_LABELS, type BusinessModule, type Module, type ReleaseMode } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Grant = { id: string; subjectType: 'equipe' | 'usuario'; subjectId: string; subjectName: string; effect: 'liberar' | 'bloquear'; reason: string; validUntil: string | null; expired: boolean };
type ModuleRow = { key: BusinessModule; label: string; hint: string; enabled: boolean; mode: ReleaseMode; disabledFeatures: string[]; saved: boolean; technical: Module[]; features: { key: string; label: string; requires: BusinessModule[] }[]; grants: Grant[] };
type Actions = { actions: { key: string; label: string }[]; profiles: { key: string; label: string }[]; matrix: Record<string, Record<string, boolean>> };

const REASON_TEXT: Record<string, string> = {
  todos: 'liberado para todos os perfis com acesso', nao_liberado: 'só para liberados, e a pessoa não está liberada', empresa_desligou: 'desligado na empresa',
  pessoa_bloqueada: 'bloqueado para a pessoa', pessoa_liberada: 'liberado para a pessoa', equipe_bloqueada: 'bloqueado para a equipe', equipe_liberada: 'liberado para a equipe',
};

export function AdminModules() {
  const q = useQuery({ queryKey: ['admin', 'modules'], queryFn: () => api<{ items: ModuleRow[] }>('/admin/modules') });
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Módulos e liberação</h1><p className="text-sm text-muted">Os sete módulos de negócio sobre a mesma base. Ligar um módulo não dá acesso a tudo: o nível de cada perfil (Segurança), as funcionalidades e as ações sensíveis continuam valendo.</p></div>
      <Notice>A fundação (usuários, contas e pessoas, catálogo, auditoria, notificações, integrações) está sempre ligada. Desligar um módulo esconde telas e rotas, mas não apaga nada: ao religar, o histórico está inteiro.</Notice>
      {q.isLoading ? <div className="card"><LoadingRows rows={6} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="grid gap-4 xl:grid-cols-2">{q.data!.items.map((m) => <ModuleCard key={m.key} m={m} />)}</div>
      )}
      <ActionsMatrix />
      <AccessPreview />
    </div>
  );
}

function ModuleCard({ m }: { m: ModuleRow }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState({ enabled: m.enabled, mode: m.mode, disabledFeatures: m.disabledFeatures });
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  useEffect(() => { setV({ enabled: m.enabled, mode: m.mode, disabledFeatures: m.disabledFeatures }); }, [m.enabled, m.mode, m.disabledFeatures]);
  const changed = v.enabled !== m.enabled || v.mode !== m.mode || [...v.disabledFeatures].sort().join() !== [...m.disabledFeatures].sort().join();
  const save = useMutation({
    mutationFn: () => api(`/admin/modules/${m.key}`, { method: 'PUT', body: { ...v, note } }),
    onSuccess: () => { setNote(''); void qc.invalidateQueries({ queryKey: ['admin', 'modules'] }); void qc.invalidateQueries({ queryKey: ['me'] }); toast({ tone: 'success', message: `${m.label}: alteração salva` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const state = !m.enabled ? { tone: 'neutral' as const, text: 'Desligado' } : m.mode === 'liberados' ? { tone: 'orange' as const, text: 'Só liberados' } : { tone: 'green' as const, text: 'Ligado' };
  return (
    <section className="card space-y-3 p-4" aria-label={`Módulo ${m.label}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-lg font-bold text-ink">{m.label}</h2><p className="text-sm text-muted">{m.hint}</p></div>
        <Chip tone={state.tone} className="shrink-0">{state.text}</Chip>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" className="h-4 w-4 accent-primary" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />Ligado na empresa</label>
        <FormField label="Quem recebe" htmlFor={`md-${m.key}`}><Select id={`md-${m.key}`} disabled={!v.enabled} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as ReleaseMode })}>{RELEASE_MODES.map((x) => <option key={x} value={x}>{RELEASE_MODE_LABELS[x]}</option>)}</Select></FormField>
      </div>
      {m.features.length > 1 && (
        <fieldset disabled={!v.enabled}><legend className="mb-1 text-sm font-semibold text-ink">Funcionalidades</legend>
          <div className="grid gap-1 sm:grid-cols-2">{m.features.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!v.disabledFeatures.includes(f.key)} onChange={(e) => setV({ ...v, disabledFeatures: e.target.checked ? v.disabledFeatures.filter((x) => x !== f.key) : [...v.disabledFeatures, f.key] })} />
              {f.label}{f.requires.length ? <span className="text-xs text-muted"> (precisa de {f.requires.map((r) => BUSINESS_MODULE_LABELS[r]).join(', ')})</span> : null}</label>
          ))}</div>
        </fieldset>
      )}
      {changed && (
        <div className="space-y-2 rounded-md border border-line p-3">
          {!v.enabled && <Notice tone="warning">Ao desligar, {m.label} some do menu e das abas de outros módulos, e as rotas recusam acesso para todos, inclusive a gerência.</Notice>}
          <FormField label="Motivo da alteração" htmlFor={`mn-${m.key}`} required><Input id={`mn-${m.key}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: liberação da primeira onda para a equipe de implantação" /></FormField>
          <div className="flex gap-2"><Button variant="primary" disabled={note.trim().length < 10} loading={save.isPending} onClick={() => save.mutate()}>Salvar {m.label}</Button><Button onClick={() => setV({ enabled: m.enabled, mode: m.mode, disabledFeatures: m.disabledFeatures })}>Desfazer</Button></div>
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">Liberações e bloqueios</h3><Button size="sm" variant="ghost" onClick={() => setAdding(true)}>Adicionar</Button></div>
        {m.grants.length ? (
          <ul className="divide-y divide-line text-sm">{m.grants.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0"><Chip tone={g.effect === 'liberar' ? 'green' : 'red'}>{g.effect === 'liberar' ? 'Liberado' : 'Bloqueado'}</Chip> <b className="text-ink">{g.subjectName}</b> <span className="text-muted">({g.subjectType === 'equipe' ? 'equipe' : 'pessoa'}){g.validUntil ? ` · até ${fmtDate(g.validUntil)}` : ''}{g.expired ? ' · vencida' : ''}</span><span className="block text-xs text-muted">{g.reason}</span></span>
              <Button size="sm" variant="ghost" onClick={() => setRevoking(g)}>Retirar</Button>
            </li>
          ))}</ul>
        ) : <p className="text-sm text-muted">{m.mode === 'liberados' ? 'Ninguém liberado ainda: o módulo não aparece para ninguém.' : 'Nenhuma exceção: vale o nível de cada perfil.'}</p>}
      </div>
      {adding && <GrantDialog m={m} onClose={() => setAdding(false)} />}
      {revoking && <RevokeDialog g={revoking} module={m.label} onClose={() => setRevoking(null)} />}
    </section>
  );
}

function GrantDialog({ m, onClose }: { m: ModuleRow; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const lk = useLookups().data;
  const [v, setV] = useState({ subjectType: 'equipe' as 'equipe' | 'usuario', subjectId: '', effect: 'liberar' as 'liberar' | 'bloquear', reason: '', validUntil: '' });
  const options = v.subjectType === 'equipe' ? (lk?.teams ?? []) : (lk?.users ?? []);
  const add = useMutation({
    mutationFn: () => api(`/admin/modules/${m.key}/grants`, { method: 'POST', body: { ...v, validUntil: v.validUntil || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'modules'] }); void qc.invalidateQueries({ queryKey: ['me'] }); toast({ tone: 'success', message: 'Regra registrada' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={`Liberar ou bloquear ${m.label}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.subjectId || v.reason.trim().length < 10} loading={add.isPending} onClick={() => add.mutate()}>Registrar regra</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Para" htmlFor="gd-t"><Select id="gd-t" value={v.subjectType} onChange={(e) => setV({ ...v, subjectType: e.target.value as 'equipe' | 'usuario', subjectId: '' })}><option value="equipe">Uma equipe</option><option value="usuario">Uma pessoa</option></Select></FormField>
          <FormField label={v.subjectType === 'equipe' ? 'Equipe' : 'Pessoa'} htmlFor="gd-s"><Select id="gd-s" value={v.subjectId} onChange={(e) => setV({ ...v, subjectId: e.target.value })}><option value="">Escolha</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></FormField>
          <FormField label="Regra" htmlFor="gd-e"><Select id="gd-e" value={v.effect} onChange={(e) => setV({ ...v, effect: e.target.value as 'liberar' | 'bloquear' })}><option value="liberar">Liberar o módulo</option><option value="bloquear">Bloquear o módulo</option></Select></FormField>
          <FormField label="Válida até (opcional)" htmlFor="gd-v"><Input id="gd-v" type="date" value={v.validUntil} onChange={(e) => setV({ ...v, validUntil: e.target.value })} /></FormField>
        </div>
        <FormField label="Motivo" htmlFor="gd-r" required><Input id="gd-r" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="Ex.: piloto da implantação de Contratos" /></FormField>
        <p className="text-xs text-muted">A regra só abre ou fecha o módulo. O que a pessoa vê dentro dele continua definido pelo perfil em Segurança. A regra da pessoa vale acima da regra da equipe.</p>
      </div>
    </Modal>
  );
}

function RevokeDialog({ g, module, onClose }: { g: Grant; module: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const r = useMutation({
    mutationFn: () => api(`/admin/module-grants/${g.id}/revoke`, { method: 'POST', body: { note } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'modules'] }); void qc.invalidateQueries({ queryKey: ['me'] }); toast({ tone: 'success', message: 'Regra retirada' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Retirar regra" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={note.trim().length < 10} loading={r.isPending} onClick={() => r.mutate()}>Retirar regra</Button></>}>
      <p className="mb-3 text-sm">{g.effect === 'liberar' ? 'Liberação' : 'Bloqueio'} de {module} para <b>{g.subjectName}</b>. Sem a regra, volta a valer a configuração do módulo.</p>
      <FormField label="Motivo" htmlFor="rv-n" required><Input id="rv-n" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
    </Modal>
  );
}

function ActionsMatrix() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'actions'], queryFn: () => api<Actions>('/admin/actions') });
  const set = useMutation({
    mutationFn: (b: { profile: string; action: string; allowed: boolean }) => api('/admin/actions', { method: 'PUT', body: b }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'actions'] }); void qc.invalidateQueries({ queryKey: ['me'] }); toast({ tone: 'success', message: 'Permissão atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <section className="card p-4" aria-label="Ações sensíveis por perfil">
      <h2 className="text-lg font-bold text-ink">Ações sensíveis por perfil</h2>
      <p className="mb-3 text-sm text-muted">Sem "Ver valores financeiros", os valores em R$ chegam ocultos em todas as telas, relatórios e indicadores, e as planilhas com valores são recusadas.</p>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-line text-left text-muted"><th className="py-2 pr-3 font-semibold">Ação</th>{d.profiles.map((p) => <th key={p.key} className="px-2 py-2 text-center font-semibold">{p.label}</th>)}</tr></thead>
          <tbody>{d.actions.map((a) => (
            <tr key={a.key} className="border-b border-line last:border-0">
              <td className="py-2 pr-3 text-ink">{a.label}</td>
              {d.profiles.map((p) => <td key={p.key} className="px-2 py-2 text-center"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`${a.label} para ${p.label}`} checked={d.matrix[p.key]?.[a.key] ?? false} disabled={set.isPending} onChange={(e) => set.mutate({ profile: p.key, action: a.key, allowed: e.target.checked })} /></td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function AccessPreview() {
  const users = useLookups().data?.users ?? [];
  const [id, setId] = useState('');
  const q = useQuery({ queryKey: ['admin', 'access-preview', id], enabled: !!id, queryFn: () => api<{ profiles: string[]; modules: Record<BusinessModule, { enabled: boolean; reason: string }>; access: Record<Module, string>; profileAccess: Record<Module, string>; actions: Record<string, boolean> }>(`/admin/access-preview/${id}`) });
  return (
    <section className="card space-y-3 p-4" aria-label="Prévia de acesso">
      <h2 className="text-lg font-bold text-ink">Prévia de acesso</h2>
      <FormField label="Usuário" htmlFor="ap-u"><Select id="ap-u" value={id} onChange={(e) => setId(e.target.value)}><option value="">Escolha um usuário</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
      {q.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <ul className="space-y-1 text-sm">{(Object.keys(q.data.modules) as BusinessModule[]).map((m) => (
            <li key={m} className="flex flex-wrap items-center gap-2"><Chip tone={q.data!.modules[m].enabled ? 'green' : 'neutral'}>{q.data!.modules[m].enabled ? 'Ligado' : 'Desligado'}</Chip><b className="text-ink">{BUSINESS_MODULE_LABELS[m]}</b><span className="text-muted">{REASON_TEXT[q.data!.modules[m].reason] ?? q.data!.modules[m].reason}</span></li>
          ))}</ul>
          <ul className="space-y-1 text-sm">{(Object.keys(q.data.access) as Module[]).map((t) => (
            <li key={t} className="flex justify-between gap-2"><span className="text-ink">{MODULE_LABELS[t]}</span><span className="text-muted">{LEVEL_LABELS[q.data!.access[t] as keyof typeof LEVEL_LABELS]}{q.data!.access[t] !== q.data!.profileAccess[t] ? ` (perfil: ${LEVEL_LABELS[q.data!.profileAccess[t] as keyof typeof LEVEL_LABELS]}; módulo desligado)` : ''}</span></li>
          ))}</ul>
        </div>
      )}
    </section>
  );
}
