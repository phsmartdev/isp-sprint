/** Política de desenvolvimento (RH): modalidades, feedback para a liderança e tamanho mínimo; cada mudança é uma nova versão. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { fmtDateTime } from '../../../lib/format';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows } from '../../../components/ui/primitives';
import { useToast } from '../../../components/ui/overlay';
import { errMsg } from '../../../features/contracts/shared';
import { useDevContext, type DevContext, type Modality } from './api';

type Policy = { version: number; effectiveFrom: string | null; config: { feedback: DevContext['policy']['feedback'] }; versions: { version: number; note: string | null; effectiveFrom: string; by: string | null }[]; canEdit: boolean };

export function AdminPolicyPage() {
  const q = useQuery({ queryKey: ['pessoas', 'dev', 'politica'], queryFn: () => api<Policy>('/pessoas/desenvolvimento/politica') });
  const ctx = useDevContext();
  const [fb, setFb] = useState<DevContext['policy']['feedback'] | null>(null);
  const [note, setNote] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => { if (q.data) setFb(q.data.config.feedback); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api<{ version: number }>('/pessoas/desenvolvimento/politica', { method: 'PUT', body: { config: { feedback: fb }, note } }),
    onSuccess: (r) => { setNote(''); void qc.invalidateQueries({ queryKey: ['pessoas', 'dev'] }); toast({ tone: 'success', message: `Versão ${r.version} publicada` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading || !fb) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.canEdit) return <div className="card"><EmptyState title="Só o RH altera a política" description="O papel de RH é o setor de Pessoas e Cultura, definido nas Configurações do módulo." /></div>;
  const labels = ctx.data?.modalities ?? ({} as Record<Modality, string>);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="space-y-4">
      <section className="card space-y-4 p-5" aria-label="Feedback situacional">
        <div><h2 className="text-md font-bold text-ink">Feedback situacional</h2><p className="text-sm text-muted">Versão vigente: {q.data!.version || 'padrão'}{q.data!.effectiveFrom && ` · desde ${fmtDateTime(q.data!.effectiveFrom)}`}. Feedbacks guardam a versão em que foram registrados.</p></div>
        <fieldset><legend className="mb-1.5 text-sm font-semibold text-ink">Modalidades disponíveis</legend>
          <div className="grid gap-1.5 sm:grid-cols-3">{(Object.keys(labels) as Modality[]).map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={fb.modalities.includes(m)} onChange={() => setFb({ ...fb, modalities: toggle(fb.modalities, m) })} />{labels[m]}</label>)}</div>
        </fieldset>
        <fieldset><legend className="mb-1.5 text-sm font-semibold text-ink">Feedback do liderado para a liderança</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={fb.ascendingModes.includes('confidencial')} onChange={() => setFb({ ...fb, ascendingModes: toggle(fb.ascendingModes, 'confidencial') })} />Confidencial, com mediação do RH (a liderança recebe só uma síntese)</label>
          <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={fb.ascendingModes.includes('identificado')} onChange={() => setFb({ ...fb, ascendingModes: toggle(fb.ascendingModes, 'identificado') })} />Identificado (vai direto à liderança, com o nome de quem enviou)</label>
        </fieldset>
        <FormField label="Mínimo de caracteres em situação, comportamento e impacto" htmlFor="pol-min" hint="Evita registros genéricos"><Input id="pol-min" type="number" min={10} max={500} className="w-32" value={fb.minChars} onChange={(e) => setFb({ ...fb, minChars: Number(e.target.value) || 10 })} /></FormField>
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <FormField label="O que mudou nesta versão" htmlFor="pol-note" required><Input id="pol-note" className="w-full sm:w-96" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
          <Button variant="primary" loading={save.isPending} disabled={note.trim().length < 3 || !fb.modalities.length || !fb.ascendingModes.length} onClick={() => save.mutate()}>Publicar nova versão</Button>
        </div>
      </section>
      {q.data!.versions.length > 0 && (
        <section className="card p-5" aria-label="Versões"><h2 className="mb-2 text-md font-bold text-ink">Versões</h2>
          <ul className="divide-y divide-line text-sm">{q.data!.versions.map((v) => <li key={v.version} className="py-2"><b>Versão {v.version}</b> · {fmtDateTime(v.effectiveFrom)}{v.by && ` · ${v.by}`}{v.note && <p className="text-muted">{v.note}</p>}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
