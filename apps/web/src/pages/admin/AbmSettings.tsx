/** Administração → ABM: quem vê e quem avalia o poder de influência, se a mudança exige aprovação e os nomes dos níveis. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_INFLUENCE_LABELS, INFLUENCE_LEVELS, validateInfluencePolicy, type InfluenceLevel, type InfluencePolicy } from '@isp/domain';
import { api } from '../../lib/api';
import { Button, ErrorState, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

const SCOPE = { proprio: 'Todos com acesso a Contas (inclusive só a própria carteira)', equipe: 'Liderança (acesso de equipe ou total em Contas)', total: 'Só acesso total em Contas' } as const;

export function AdminAbmSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['abm-settings'], queryFn: () => api<{ version: number; influence: InfluencePolicy; canEdit: boolean }>('/abm/settings') });
  const [p, setP] = useState<InfluencePolicy | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { if (q.data) setP(q.data.influence); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/abm/settings', { method: 'PUT', body: { influence: p, note } }),
    onSuccess: () => { setNote(''); void qc.invalidateQueries({ queryKey: ['abm-settings'] }); void qc.invalidateQueries({ queryKey: ['stakeholders'] }); toast({ tone: 'success', message: 'Configuração do ABM salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading || !p) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const errs = validateInfluencePolicy(p);
  const changed = JSON.stringify(p) !== JSON.stringify(q.data!.influence);
  const ro = !q.data!.canEdit;
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">ABM</h1><p className="text-sm text-muted">Regras do poder de influência dos stakeholders. A avaliação é sempre feita por uma pessoa, com justificativa, e fica na auditoria. Nenhuma automação, importação, sincronização, pesquisa ou IA altera esse valor.</p></div>
      {ro && <Notice tone="info">Só quem tem acesso total em Configurações altera estas regras.</Notice>}
      <section className="card space-y-4 p-4" aria-label="Permissões da influência">
        <h2 className="text-lg font-bold text-ink">Quem vê e quem avalia</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Quem vê o poder de influência" htmlFor="ab-v"><Select id="ab-v" disabled={ro} value={p.view} onChange={(e) => setP({ ...p, view: e.target.value as InfluencePolicy['view'] })}>{Object.entries(SCOPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
          <FormField label="Quem avalia (registra ou pede mudança)" htmlFor="ab-e"><Select id="ab-e" disabled={ro} value={p.edit} onChange={(e) => setP({ ...p, edit: e.target.value as InfluencePolicy['edit'] })}>{Object.entries(SCOPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={ro} checked={p.requireApproval} onChange={(e) => setP({ ...p, requireApproval: e.target.checked })} /><span><b className="text-ink">Exigir aprovação da liderança</b><span className="block text-xs text-muted">A avaliação vira um pedido; outra pessoa da liderança aprova ou recusa. Quem pediu não aprova o próprio pedido.</span></span></label>
      </section>
      <section className="card space-y-3 p-4" aria-label="Nomes dos níveis">
        <h2 className="text-lg font-bold text-ink">Nomes dos níveis</h2>
        <p className="text-xs text-muted">Só muda o nome exibido. A ordem dos níveis e o que já foi avaliado continuam iguais.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{INFLUENCE_LEVELS.map((l: InfluenceLevel) => <FormField key={l} label={`Nível “${DEFAULT_INFLUENCE_LABELS[l]}”`} htmlFor={`ab-l-${l}`}><Input id={`ab-l-${l}`} disabled={ro} maxLength={40} value={p.labels[l]} onChange={(e) => setP({ ...p, labels: { ...p.labels, [l]: e.target.value } })} /></FormField>)}</div>
      </section>
      {!ro && (
        <section className="card space-y-3 p-4">
          {errs.map((e) => <Notice key={e} tone="warning">{e}</Notice>)}
          <FormField label="Motivo da alteração" htmlFor="ab-n" required hint={`Versão atual: ${q.data!.version || 'padrão'}. Cada alteração vira uma nova versão.`}><Input id="ab-n" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <div className="flex gap-2"><Button variant="primary" disabled={!changed || !!errs.length || note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Salvar configuração</Button>{changed && <Button variant="secondary" onClick={() => setP(q.data!.influence)}>Desfazer</Button>}</div>
        </section>
      )}
    </div>
  );
}
