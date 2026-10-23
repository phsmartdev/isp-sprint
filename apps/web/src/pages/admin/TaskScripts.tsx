/** Modelos → Tipos de tarefa: o roteiro de cada tipo (ligação, reunião, visita…), mostrado a quem cria ou abre a tarefa. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, type ActivityType } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, ErrorState, FormField, LoadingRows, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Script = { type: ActivityType; script: string; updatedAt: string | null; updatedByName: string | null };

export function AdminTaskScripts() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'activity-scripts'], queryFn: () => api<{ items: Script[] }>('/admin/activity-scripts') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setDraft(Object.fromEntries(q.data.items.map((i) => [i.type, i.script]))); }, [q.data]);
  const save = useMutation({
    mutationFn: (type: ActivityType) => api('/admin/activity-scripts', { method: 'PUT', body: { type, script: draft[type] ?? '' } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'activity-scripts'] }); void qc.invalidateQueries({ queryKey: ['lookups'] }); toast({ tone: 'success', message: 'Roteiro salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card p-5"><LoadingRows rows={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      {ACTIVITY_TYPES.map((t) => {
        const cur = q.data!.items.find((i) => i.type === t);
        const dirty = (draft[t] ?? '') !== (cur?.script ?? '');
        return (
          <section key={t} className="card p-5" aria-label={`Roteiro: ${ACTIVITY_TYPE_LABELS[t]}`}>
            <FormField label={`Roteiro de ${ACTIVITY_TYPE_LABELS[t].toLowerCase()}`} htmlFor={`ts-${t}`} hint={cur?.updatedAt ? `Atualizado em ${fmtDateTime(cur.updatedAt)}${cur.updatedByName ? ` por ${cur.updatedByName}` : ''}` : 'Sem roteiro'}>
              <Textarea id={`ts-${t}`} rows={5} value={draft[t] ?? ''} placeholder="Passos, perguntas e cuidados para este tipo de tarefa" onChange={(e) => setDraft({ ...draft, [t]: e.target.value })} />
            </FormField>
            <div className="mt-3 flex justify-end"><Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending && save.variables === t} onClick={() => save.mutate(t)}>Salvar roteiro</Button></div>
          </section>
        );
      })}
    </div>
  );
}
