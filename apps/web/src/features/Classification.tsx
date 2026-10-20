/** Classificação estratégica no cadastro do cliente: vigente, histórico e nova classificação (append-only). */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLASSIFICATION_DIMENSIONS, CLASSIFICATION_LABELS, type ClassificationDimension } from '@isp/domain';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';
import { Button, FormField, Select, Textarea } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';
import { errMsg } from './contracts/shared';
import type { Classification } from './approval/types';

type R = { current: Classification | null; history: Classification[]; options: Record<ClassificationDimension, string[]> };

export function ClassificationSection({ contactId }: { contactId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['classification', contactId], queryFn: () => api<R>(`/contacts/${contactId}/classification`) });
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const canEdit = can('clientes', 'equipe');
  const save = useMutation({
    mutationFn: () => api(`/contacts/${contactId}/classification`, { method: 'POST', body: Object.fromEntries([...CLASSIFICATION_DIMENSIONS.map((k) => [k, edit![k] || null]), ['notes', edit!.notes?.trim() || null]]) }),
    onSuccess: () => { setEdit(null); qc.invalidateQueries({ queryKey: ['classification', contactId] }); toast({ tone: 'success', message: 'Classificação registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ask = useMutation({
    mutationFn: () => api(`/contacts/${contactId}/classification/request-update`, { method: 'POST', body: {} }),
    onSuccess: () => toast({ tone: 'success', message: 'Tarefa de atualização criada' }),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!q.data) return null;
  const c = q.data.current;
  return (
    <section className="mt-6 border-t border-line pt-5" aria-labelledby="cls-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="cls-h" className="font-bold text-ink">Classificação estratégica</h2>
        <div className="flex gap-2">
          {canEdit && !edit && <Button size="sm" onClick={() => setEdit(Object.fromEntries([...CLASSIFICATION_DIMENSIONS.map((k) => [k, c?.[k] ?? '']), ['notes', c?.notes ?? '']]))}>{c ? 'Reclassificar' : 'Classificar'}</Button>}
          {!canEdit && <Button size="sm" variant="ghost" loading={ask.isPending} onClick={() => ask.mutate()}>Pedir atualização</Button>}
        </div>
      </div>
      {edit ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CLASSIFICATION_DIMENSIONS.map((k) => (
            <FormField key={k} label={CLASSIFICATION_LABELS[k]} htmlFor={`cls-${k}`}>
              <Select id={`cls-${k}`} value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}>
                <option value="">Não informado</option>
                {q.data.options[k].map((o) => <option key={o} value={o}>{o}</option>)}
                {edit[k] && !q.data.options[k].includes(edit[k]!) && <option value={edit[k]}>{edit[k]} (fora da lista)</option>}
              </Select>
            </FormField>
          ))}
          <FormField label="Observações estratégicas" htmlFor="cls-notes" className="sm:col-span-2 lg:col-span-3"><Textarea id="cls-notes" value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></FormField>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar classificação</Button><Button onClick={() => setEdit(null)}>Cancelar</Button></div>
        </div>
      ) : !c ? (
        <p className="text-md font-semibold text-muted">Não classificado</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm md:grid-cols-3">
            {CLASSIFICATION_DIMENSIONS.map((k) => <div key={k}><dt className="text-xs text-muted">{CLASSIFICATION_LABELS[k]}</dt><dd className="font-semibold text-ink">{c[k] ?? '—'}</dd></div>)}
          </dl>
          {c.notes && <p className="mt-2 text-sm text-text">{c.notes}</p>}
          <p className="mt-2 text-xs text-muted">Classificado em {fmtDate(c.classifiedAt)} por {c.classifiedBy ?? '—'}.{q.data.history.length > 1 ? ` ${q.data.history.length - 1} classificação(ões) anterior(es) no histórico.` : ''}</p>
        </>
      )}
    </section>
  );
}
