/**
 * Novo feedback situacional, no modelo Situação–Comportamento–Impacto: para quem, modalidade, (ascendente) modo,
 * quem vai ver, data do acontecimento, situação, comportamento observado, impacto, orientação e próximos passos.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Eye, Lock } from 'lucide-react';
import { api } from '../../../lib/api';
import { Avatar, Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Textarea } from '../../../components/ui/primitives';
import { ConfirmDialog, useToast } from '../../../components/ui/overlay';
import { errMsg } from '../../../features/contracts/shared';
import { MODALITY_HINT, useDevContext, whoSees, type Feedback, type Modality } from './api';

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const empty = { recipientId: '', modality: '' as Modality | '', mode: 'confidencial' as 'confidencial' | 'identificado', occurredOn: todayStr(), situation: '', behavior: '', impact: '', guidance: '', nextSteps: '' };

export function FeedbackFormPage() {
  const ctx = useDevContext();
  const [params] = useSearchParams();
  const draftId = params.get('rascunho');
  const draft = useQuery({ queryKey: ['pessoas', 'dev', 'feedback', draftId], enabled: !!draftId, queryFn: () => api<Feedback>(`/pessoas/desenvolvimento/feedbacks/${draftId}`) });
  const [f, setF] = useState({ ...empty, recipientId: params.get('para') ?? '' });
  const [confirm, setConfirm] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    const d = draft.data;
    if (d) setF({ recipientId: d.recipient?.id ?? '', modality: d.modality, mode: d.mode, occurredOn: d.occurredOn, situation: d.situation ?? '', behavior: d.behavior ?? '', impact: d.impact ?? '', guidance: d.guidance ?? '', nextSteps: d.nextSteps ?? '' });
  }, [draft.data]);
  const save = useMutation({
    mutationFn: (send: boolean) => {
      // modo efetivo: o que a política permite (descendente é sempre identificado)
      const allowed = ctx.data?.policy.feedback.ascendingModes ?? ['confidencial'];
      const body = { ...f, mode: allowed.includes(f.mode) ? f.mode : allowed[0], guidance: f.guidance.trim() || null, nextSteps: f.nextSteps.trim() || null, send };
      return draftId ? api(`/pessoas/desenvolvimento/feedbacks/${draftId}`, { method: 'PATCH', body }) : api<{ id: string }>('/pessoas/desenvolvimento/feedbacks', { method: 'POST', body });
    },
    onSuccess: (r, send) => {
      void qc.invalidateQueries({ queryKey: ['pessoas', 'dev'] });
      toast({ tone: 'success', message: send ? 'Feedback enviado' : 'Rascunho salvo' });
      const id = draftId ?? (r as { id: string }).id;
      nav(send ? `/pessoas/desenvolvimento/feedbacks/${id}` : '/pessoas/desenvolvimento/feedbacks');
    },
    onError: (e) => { setConfirm(false); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const del = useMutation({ mutationFn: () => api(`/pessoas/desenvolvimento/feedbacks/${draftId}`, { method: 'DELETE' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas', 'dev'] }); nav('/pessoas/desenvolvimento/feedbacks'); } });
  if (ctx.isLoading || draft.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (ctx.isError) return <ErrorState error={ctx.error} onRetry={() => ctx.refetch()} />;
  const c = ctx.data!;
  const pol = c.policy.feedback;
  if (!c.reports.length && !c.managers.length) return <div className="card"><EmptyState title="Ninguém para receber feedback por aqui" description="Feedback situacional vai para os seus liderados ou para a sua liderança, conforme os times cadastrados. Se o seu time estiver desatualizado, fale com quem cuida dos times." /></div>;
  const recipient = [...c.reports, ...c.managers].find((p) => p.id === f.recipientId);
  const dir: 'descendente' | 'ascendente' | null = !recipient ? null : c.reports.some((p) => p.id === f.recipientId) ? 'descendente' : 'ascendente';
  const mode = dir === 'ascendente' ? (pol.ascendingModes.includes(f.mode) ? f.mode : pol.ascendingModes[0]!) : 'identificado';
  const min = pol.minChars;
  const ready = !!recipient && !!f.modality && (['situation', 'behavior', 'impact'] as const).every((k) => f[k].trim().length >= min);
  const person = (p: { id: string; name: string; hasPhoto: boolean; jobTitle: string | null }, group: string) => (
    <label key={p.id} className={clsx('flex cursor-pointer items-center gap-3 border p-2.5', f.recipientId === p.id ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong')}>
      <input type="radio" name="para" className="sr-only" checked={f.recipientId === p.id} onChange={() => setF({ ...f, recipientId: p.id })} aria-label={`${p.name} (${group})`} />
      <Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={36} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{p.name}</span><span className="block truncate text-xs text-muted">{p.jobTitle ?? group}</span></span>
    </label>
  );
  const sbi = (k: 'situation' | 'behavior' | 'impact', label: string, hint: string, placeholder: string) => (
    <FormField label={label} htmlFor={`fb-${k}`} required hint={`${hint} · ${f[k].trim().length}/${min} no mínimo`}>
      <Textarea id={`fb-${k}`} rows={3} maxLength={2000} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={placeholder} />
    </FormField>
  );
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/pessoas/desenvolvimento/feedbacks" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Feedbacks</Link>
      <form className="card space-y-5 p-5" aria-label="Novo feedback" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }}>
        <h1 className="font-display text-xl font-bold text-ink">{draftId ? 'Continuar rascunho' : 'Novo feedback'}</h1>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Para quem <span className="text-danger">*</span></legend>
          {c.reports.length > 0 && <><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Meus liderados</p><div className="mb-3 grid gap-2 sm:grid-cols-2">{c.reports.map((p) => person(p, 'Liderado'))}</div></>}
          {c.managers.length > 0 && <><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Minha liderança</p><div className="grid gap-2 sm:grid-cols-2">{c.managers.map((p) => person(p, 'Liderança'))}</div></>}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Modalidade <span className="text-danger">*</span></legend>
          <div className="grid gap-2 sm:grid-cols-3">{pol.modalities.map((m) => (
            <label key={m} className={clsx('cursor-pointer border p-2.5 text-sm', f.modality === m ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong')}>
              <input type="radio" name="modalidade" className="sr-only" checked={f.modality === m} onChange={() => setF({ ...f, modality: m })} aria-label={c.modalities[m]} />
              <span className="block font-semibold text-ink">{c.modalities[m]}</span><span className="text-xs text-muted">{MODALITY_HINT[m]}</span>
            </label>
          ))}</div>
        </fieldset>
        {dir === 'ascendente' && pol.ascendingModes.length > 1 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">Como enviar</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['confidencial', 'identificado'] as const).map((m) => (
                <label key={m} className={clsx('cursor-pointer border p-2.5 text-sm', f.mode === m ? 'border-primary bg-primary-soft' : 'border-line')}>
                  <input type="radio" name="modo" className="sr-only" checked={f.mode === m} onChange={() => setF({ ...f, mode: m })} aria-label={m === 'confidencial' ? 'Confidencial, com mediação do RH' : 'Identificado'} />
                  <span className="flex items-center gap-1.5 font-semibold text-ink">{m === 'confidencial' && <Lock className="h-4 w-4" aria-hidden />}{m === 'confidencial' ? 'Confidencial, com mediação do RH' : 'Identificado'}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {recipient && dir && <p className="flex gap-2 border border-primary/40 bg-primary-soft px-3 py-2 text-sm text-ink" role="note" aria-label="Quem vai ver"><Eye className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /><span><b>Quem vai ver:</b> {whoSees(dir, mode, recipient.name.split(' ')[0]!)}</span></p>}
        <FormField label="Quando aconteceu" htmlFor="fb-when" required><Input id="fb-when" type="date" className="w-48" max={todayStr()} value={f.occurredOn} onChange={(e) => setF({ ...f, occurredOn: e.target.value })} /></FormField>
        {sbi('situation', 'Situação', 'Quando e onde: o contexto', 'Ex.: Na reunião de pipeline de terça, com o cliente Alfa…')}
        {sbi('behavior', 'Comportamento observado', 'O que a pessoa fez ou disse: fatos, não julgamentos', 'Ex.: Você apresentou os números sem consultar a planilha atualizada…')}
        {sbi('impact', 'Impacto', 'O efeito no time, no cliente ou no resultado', 'Ex.: O cliente questionou a previsão e precisamos refazer a proposta…')}
        <FormField label="Orientação" htmlFor="fb-guid" hint="Opcional: o que fazer de diferente (ou continuar fazendo)"><Textarea id="fb-guid" rows={2} maxLength={2000} value={f.guidance} onChange={(e) => setF({ ...f, guidance: e.target.value })} /></FormField>
        <FormField label="Próximos passos" htmlFor="fb-next" hint="Opcional: o combinado a partir daqui"><Textarea id="fb-next" rows={2} maxLength={2000} value={f.nextSteps} onChange={(e) => setF({ ...f, nextSteps: e.target.value })} /></FormField>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          {draftId && <Button variant="ghost" onClick={() => del.mutate()} loading={del.isPending}>Descartar rascunho</Button>}
          <Button onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false} disabled={!recipient || !f.modality}>Salvar rascunho</Button>
          <Button type="submit" variant="primary" disabled={!ready}>Enviar</Button>
        </div>
      </form>
      <ConfirmDialog open={confirm} title="Enviar feedback" confirmLabel="Enviar" loading={save.isPending && save.variables === true} onCancel={() => setConfirm(false)} onConfirm={() => save.mutate(true)}>
        <p>{recipient && dir ? whoSees(dir, mode, recipient.name.split(' ')[0]!) : ''}</p>
        <p className="mt-2 text-sm text-muted">Depois de enviado, o feedback não é editado: fica como registro, com histórico.</p>
      </ConfirmDialog>
    </div>
  );
}
