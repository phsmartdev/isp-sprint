import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_PRIORITIES, ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, PRIORITY_LABELS, type ActivityPriority, type ActivityType } from '@isp/domain';
import { api, ApiError } from '../lib/api';
import { localInputToIso } from '../lib/format';
import { useLookups } from '../lib/hooks';
import type { Activity } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Button, FormField, Input, Select, Textarea } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';

function defaultDue() {
  const d = new Date(Date.now() + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

export function ActivityComposer({ opportunityId, contactId, defaultType = 'ligacao', defaultTitle = '', onDone, formId = 'activity-form', hideSubmit }: { opportunityId?: string; contactId?: string; defaultType?: ActivityType; defaultTitle?: string; onDone?: () => void; formId?: string; hideSubmit?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me, can } = useAuth();
  const lookups = useLookups();
  const [type, setType] = useState<ActivityType>(defaultType);
  const [title, setTitle] = useState(defaultTitle);
  const [due, setDue] = useState(defaultDue());
  const [priority, setPriority] = useState<ActivityPriority>('media');
  const [ownerId, setOwnerId] = useState(me?.user.id ?? '');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const teamUsers = (lookups.data?.users ?? []).filter((u) => can('atividades', 'total') || me?.teamMemberIds.includes(u.id));

  const m = useMutation({
    mutationFn: () => api<Activity & { deduplicated: boolean }>('/activities', { method: 'POST', body: { type, title: title.trim(), dueAt: localInputToIso(due), priority, notes: notes || null, ownerId: ownerId || null, opportunityId: opportunityId ?? null, contactId: contactId ?? null } }),
    onSuccess: (a) => {
      toast({ tone: 'success', message: a.deduplicated ? 'Essa atividade já estava agendada' : 'Atividade agendada' });
      for (const k of ['activities', 'home', 'timeline']) qc.invalidateQueries({ queryKey: [k] });
      setTitle(''); setNotes('');
      onDone?.();
    },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: 'error', message: (e as Error).message }); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    if (title.trim().length < 2) return setErrors({ title: 'Descreva a atividade' });
    setErrors({});
    m.mutate();
  };
  return (
    <form id={formId} onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Tipo" htmlFor={`${formId}-type`}><Select id={`${formId}-type`} value={type} onChange={(e) => setType(e.target.value as ActivityType)}>{ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_TYPE_LABELS[t]}</option>)}</Select></FormField>
        <FormField label="Prioridade" htmlFor={`${formId}-prio`}><Select id={`${formId}-prio`} value={priority} onChange={(e) => setPriority(e.target.value as ActivityPriority)}>{ACTIVITY_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</Select></FormField>
      </div>
      {lookups.data?.activityScripts?.[type] && (
        <details className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm" open>
          <summary className="cursor-pointer font-semibold text-ink">Roteiro de {ACTIVITY_TYPE_LABELS[type].toLowerCase()}</summary>
          <p className="mt-2 whitespace-pre-line text-text">{lookups.data.activityScripts[type]}</p>
        </details>
      )}
      <FormField label="O que fazer" htmlFor={`${formId}-title`} required error={errors.title}>
        <Input id={`${formId}-title`} value={title} invalid={!!errors.title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Ligação para Mariana Costa" data-autofocus />
      </FormField>
      <FormField label="Descrição" htmlFor={`${formId}-notes`} hint="Aparece abaixo do título na agenda (ex.: Qualificação de interesse)">
        <Textarea id={`${formId}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" />
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Quando" htmlFor={`${formId}-due`} error={errors.dueAt}><Input id={`${formId}-due`} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
        {can('atividades', 'equipe') && (
          <FormField label="Responsável" htmlFor={`${formId}-owner`}><Select id={`${formId}-owner`} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{teamUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        )}
      </div>
      {!hideSubmit && <Button type="submit" variant="primary" loading={m.isPending}>Agendar</Button>}
    </form>
  );
}
