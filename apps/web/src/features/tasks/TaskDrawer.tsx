/** Detalhe da tarefa: situação, campos, checklist, subtarefas, dependências, tempo, arquivos, comentários e histórico. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Ban, CheckCircle2, Download, Lock, Paperclip, Plus, Trash2, Undo2, X } from 'lucide-react';
import {
  RECURRENCE_FREQS, RECURRENCE_LABELS, TASK_MANUAL_STATUSES, TASK_STATUS_LABELS, fmtMinutes, parseMinutes,
  type Recurrence, type RecurrenceFreq, type TaskStatus,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { fileToBase64, fmtBytes, MAX_UPLOAD_BYTES } from '../../lib/files';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, Chip, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Drawer, useToast } from '../../components/ui/overlay';
import { MentionInput, mentionsIn, type Participant } from '../MentionInput';
import { errMsg } from '../contracts/shared';
import { NewTaskDialog, PRIO_LABEL, TaskStatusChip, useInvalidateTasks, type TaskItem, type TaskList } from './shared';

type Dep = { id: string; title: string; status: TaskStatus; ownerName: string };
type Detail = TaskItem & {
  subtasks: TaskItem[]; blockedBy: Dep[]; blocking: Dep[]; blockers: string[];
  comments: { id: string; body: string; createdAt: string; authorId: string | null; authorName: string | null }[];
  time: { id: string; minutes: number; workedOn: string; note: string | null; reversesId: string | null; userId: string; userName: string }[];
  files: { id: string; name: string; sizeBytes: number; createdAt: string; uploadedBy: string | null }[];
  events: { id: string; type: string; payload: Record<string, unknown> | null; occurredAt: string; actorName: string | null }[];
  parent: { id: string; title: string } | null; people: { id: string; name: string }[];
  stages: { id: string; name: string; done: boolean }[]; milestones: { id: string; name: string }[];
  can: { edit: boolean; assign: boolean; approve: boolean; comment: boolean };
};

const EVENT_LABELS: Record<string, string> = {
  created: 'criou a tarefa', completed: 'concluiu', reopened: 'reabriu', status: 'mudou a situação', cancelled: 'cancelou', assigned: 'reatribuiu', rescheduled: 'reagendou',
  updated: 'editou', checklist: 'atualizou o checklist', submitted: 'enviou para aprovação', approved: 'aprovou a entrega', rejected: 'devolveu a entrega',
  dependency: 'mudou dependências', file: 'anexou arquivo', file_removed: 'retirou arquivo', moved: 'moveu no quadro', removed: 'removeu',
};
type ChecklistRow = { id?: string; text: string; done: boolean };
const WD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const todayLocal = () => new Date().toLocaleDateString('en-CA');

export function TaskDrawer({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen?: (id: string) => void }) {
  const [cur, setCur] = useState<string | null>(id);
  useEffect(() => setCur(id), [id]);
  const open = (x: string) => (onOpen ? onOpen(x) : setCur(x));
  const q = useQuery({ queryKey: ['task', cur], enabled: !!cur, queryFn: () => api<Detail>(`/tasks/${cur}`) });
  return (
    <Drawer open={!!cur} onClose={onClose} title={q.data?.parent ? 'Subtarefa' : 'Tarefa'} width="lg">
      {q.isLoading || !q.data ? <LoadingRows rows={6} /> : <Body key={q.data.id} t={q.data} onOpen={open} onRemoved={onClose} />}
    </Drawer>
  );
}

function Body({ t, onOpen, onRemoved }: { t: Detail; onOpen: (id: string) => void; onRemoved: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const ro = !t.can.edit;
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ status: TaskStatus; next: { id: string; dueOn: string } | null }>(`/tasks/${t.id}`, { method: 'PATCH', body: { rowVersion: t.rowVersion, ...body } }),
    onSuccess: (r, body) => {
      invalidate();
      if (body.status === 'concluida') toast({ tone: 'success', message: r.status === 'em_aprovacao' ? 'Entrega enviada para aprovação' : r.next ? `Concluída. Próxima ocorrência em ${fmtDate(r.next.dueOn)}` : 'Tarefa concluída' });
      else toast({ tone: 'success', message: 'Tarefa salva' });
    },
    onError: (e) => { invalidate(); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const fromT = () => ({
    title: t.title, notes: t.notes ?? '', ownerId: t.ownerId, priority: t.priority, startOn: t.startOn ?? '', dueOn: t.dueOn ?? '', estimate: t.estimateMinutes ? fmtMinutes(t.estimateMinutes) : '',
    category: t.category ?? '', tags: t.tags.join(', '), participants: t.participants, requiresApproval: t.requiresApproval, approverId: t.approverId ?? '',
    recurring: !!t.recurrence, rec: (t.recurrence ?? { freq: 'semanal', interval: 1 }) as Recurrence, waitingOn: t.waitingOn ?? '',
  });
  const [f, setF] = useState(fromT);
  const dirty = (() => {
    const tags = f.tags.split(/[,\s]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter(Boolean);
    const est = f.estimate ? parseMinutes(f.estimate) : null;
    const body: Record<string, unknown> = {};
    if (f.title !== t.title) body.title = f.title;
    if (f.notes !== (t.notes ?? '')) body.notes = f.notes || null;
    if (f.ownerId !== t.ownerId) body.ownerId = f.ownerId;
    if (f.priority !== t.priority) body.priority = f.priority;
    if (f.startOn !== (t.startOn ?? '')) body.startOn = f.startOn || null;
    if (f.dueOn !== (t.dueOn ?? '')) body.dueOn = f.dueOn || null;
    if (est !== t.estimateMinutes && !(f.estimate && est === null)) body.estimateMinutes = est;
    if (f.category !== (t.category ?? '')) body.category = f.category || null;
    if (tags.join(',') !== t.tags.join(',')) body.tags = tags;
    if (f.participants.join(',') !== t.participants.join(',')) body.participants = f.participants;
    if (f.requiresApproval !== t.requiresApproval) body.requiresApproval = f.requiresApproval;
    if ((f.approverId || null) !== t.approverId && f.requiresApproval) body.approverId = f.approverId || null;
    const rec = f.recurring ? f.rec : null;
    if (JSON.stringify(rec) !== JSON.stringify(t.recurrence)) body.recurrence = rec;
    return body;
  })();
  // quando a tarefa muda no servidor, os campos sem edição pendente acompanham; o que está sendo digitado fica
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => { if (!Object.keys(dirtyRef.current).length) setF(fromT()); }, [t.rowVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const estimateInvalid = !!f.estimate && parseMinutes(f.estimate) === null;
  const [waiting, setWaiting] = useState<string | null>(null);
  const closed = t.status === 'concluida' || t.status === 'cancelada';

  return (
    <div className="space-y-6">
      {/* cabeçalho */}
      <div className="space-y-3">
        {t.parent && <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => onOpen(t.parent!.id)}>↑ {t.parent.title}</button>}
        <Input aria-label="Título da tarefa" className="text-lg font-bold" value={f.title} disabled={ro} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusChip s={t.status} />
          {t.overdue && <Chip tone="red">Atrasada</Chip>}
          {t.recurrenceText && <Chip tone="sky">{t.recurrenceText}</Chip>}
          {t.links.project && <Link to={`/projetos/${t.links.project.id}`} className="rounded-sm bg-surface-2 px-2 py-0.5 text-xs font-semibold text-primary hover:underline">Projeto: {t.links.project.name}</Link>}
          <span className="text-xs text-muted">Criada por {t.createdByName ?? '—'}</span>
        </div>
        {!!t.blockers.length && !closed && <Notice tone="warning"><Lock className="mr-1 inline h-4 w-4" aria-hidden />{t.blockers.join(' ')}</Notice>}
        {t.status === 'em_aprovacao' && <ApprovalBox t={t} />}
        {t.status === 'aguardando' && t.waitingOn && <p className="text-sm">Aguardando: <span className="font-semibold text-ink">{t.waitingOn}</span></p>}
        {!ro && (
          <div className="flex flex-wrap items-end gap-2">
            {!closed && t.status !== 'em_aprovacao' && <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} disabled={!!t.blockers.length} loading={patch.isPending && patch.variables?.status === 'concluida'} onClick={() => patch.mutate({ status: 'concluida' })}>{t.requiresApproval ? 'Concluir e enviar para aprovação' : 'Concluir'}</Button>}
            {(closed || t.status === 'em_aprovacao') && <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => patch.mutate({ status: 'em_andamento' })}>Reabrir</Button>}
            {!closed && t.status !== 'em_aprovacao' && (
              <FormField label="Situação" htmlFor="td-status">
                <Select id="td-status" value={waiting !== null ? 'aguardando' : t.status} onChange={(e) => { const s = e.target.value as TaskStatus; if (s === 'aguardando') setWaiting(t.waitingOn ?? ''); else { setWaiting(null); patch.mutate({ status: s }); } }}>
                  {TASK_MANUAL_STATUSES.filter((s) => s !== 'concluida').map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                </Select>
              </FormField>
            )}
            {waiting !== null && (
              <>
                <FormField label="Aguardando quem ou o quê" htmlFor="td-wait"><Input id="td-wait" className="w-56" value={waiting} onChange={(e) => setWaiting(e.target.value)} autoFocus /></FormField>
                <Button variant="secondary" onClick={() => { patch.mutate({ status: 'aguardando', waitingOn: waiting || null }); setWaiting(null); }}>Confirmar</Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* campos */}
      <fieldset disabled={ro} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Responsável" htmlFor="td-owner"><Select id="td-owner" value={f.ownerId} disabled={!t.can.assign} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Prioridade" htmlFor="td-prio"><Select id="td-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}>{Object.entries(PRIO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
        <FormField label="Início" htmlFor="td-start"><Input id="td-start" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></FormField>
        <FormField label="Prazo" htmlFor="td-due"><Input id="td-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
        <FormField label="Estimativa" htmlFor="td-est" hint={estimateInvalid ? 'Use 1h30, 90 ou 45min' : 'Ex.: 1h30'} error={estimateInvalid ? 'Formato inválido' : undefined}><Input id="td-est" value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} /></FormField>
        <FormField label="Categoria" htmlFor="td-cat"><Input id="td-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></FormField>
        <FormField label="Etiquetas" htmlFor="td-tags" hint="Separe por vírgula" className="sm:col-span-2"><Input id="td-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></FormField>
        <FormField label="Participantes" htmlFor="td-part" hint="Acompanham, comentam e marcam o checklist" className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {f.participants.map((p) => <span key={p} className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-1 text-sm">{users.find((u) => u.id === p)?.name ?? t.people.find((u) => u.id === p)?.name}{!ro && <button type="button" aria-label="Retirar participante" onClick={() => setF({ ...f, participants: f.participants.filter((x) => x !== p) })}><X className="h-3.5 w-3.5" /></button>}</span>)}
            {!ro && <Select id="td-part" className="w-auto" value="" onChange={(e) => e.target.value && setF({ ...f, participants: [...f.participants, e.target.value] })}><option value="">Adicionar</option>{users.filter((u) => u.id !== f.ownerId && !f.participants.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
          </div>
        </FormField>
        <div className="sm:col-span-2 space-y-2 rounded-md border border-line p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.requiresApproval} onChange={(e) => setF({ ...f, requiresApproval: e.target.checked })} />A entrega precisa de aprovação</label>
          {f.requiresApproval && <FormField label="Quem aprova" htmlFor="td-appr"><Select id="td-appr" value={f.approverId} onChange={(e) => setF({ ...f, approverId: e.target.value })}><option value="">Escolha</option>{users.filter((u) => u.id !== f.ownerId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>}
        </div>
        <div className="sm:col-span-2 space-y-2 rounded-md border border-line p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked })} />Repetir esta tarefa</label>
          {f.recurring && (
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Frequência" htmlFor="td-freq"><Select id="td-freq" value={f.rec.freq} onChange={(e) => setF({ ...f, rec: { ...f.rec, freq: e.target.value as RecurrenceFreq, weekdays: undefined } })}>{RECURRENCE_FREQS.map((x) => <option key={x} value={x}>{RECURRENCE_LABELS[x]}</option>)}</Select></FormField>
              <FormField label="A cada" htmlFor="td-int"><Input id="td-int" className="w-20" inputMode="numeric" value={String(f.rec.interval)} onChange={(e) => setF({ ...f, rec: { ...f.rec, interval: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) } })} /></FormField>
              {f.rec.freq === 'semanal' && <fieldset className="flex gap-1"><legend className="mb-1 text-sm text-muted">Dias</legend>{WD.map((d, i) => { const on = f.rec.weekdays?.includes(i + 1); return <button key={d} type="button" aria-pressed={on} onClick={() => setF({ ...f, rec: { ...f.rec, weekdays: on ? f.rec.weekdays!.filter((x) => x !== i + 1) : [...(f.rec.weekdays ?? []), i + 1] } })} className={clsx('h-9 w-10 rounded-sm border text-xs font-semibold', on ? 'border-primary bg-primary text-white' : 'border-line text-muted')}>{d}</button>; })}</fieldset>}
              {f.rec.freq === 'diaria' && <label className="flex h-10 items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!f.rec.skipWeekends} onChange={(e) => setF({ ...f, rec: { ...f.rec, skipWeekends: e.target.checked } })} />Só dias úteis</label>}
              <FormField label="Até" htmlFor="td-until"><Input id="td-until" type="date" value={f.rec.until ?? ''} onChange={(e) => setF({ ...f, rec: { ...f.rec, until: e.target.value || null } })} /></FormField>
            </div>
          )}
          {f.recurring && !f.dueOn && <p className="text-xs text-danger">Defina um prazo: a série conta a partir dele.</p>}
        </div>
        <FormField label="Descrição" htmlFor="td-notes" className="sm:col-span-2"><Textarea id="td-notes" rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
      </fieldset>
      {!ro && Object.keys(dirty).length > 0 && (
        <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
          <span className="mr-auto text-sm text-muted">Alterações não salvas</span>
          <Button variant="primary" disabled={estimateInvalid || f.title.trim().length < 2 || (f.requiresApproval && !f.approverId)} loading={patch.isPending} onClick={() => patch.mutate(dirty)}>Salvar alterações</Button>
        </div>
      )}

      <Links t={t} ro={ro} patch={(b) => patch.mutate(b)} />
      <Checklist t={t} canTick={t.can.edit || t.participants.includes(me?.user.id ?? '')} canEdit={t.can.edit} />
      {!t.parentId && <Subtasks t={t} onOpen={onOpen} />}
      <Dependencies t={t} onOpen={onOpen} />
      <Time t={t} />
      <Files t={t} />
      <Comments t={t} />
      <section>
        <h3 className="mb-2 text-base font-bold text-ink">Histórico</h3>
        <ol className="space-y-1.5 text-sm">{t.events.map((e) => <li key={e.id} className="flex gap-2"><span className="num shrink-0 text-xs text-muted">{fmtDateTime(e.occurredAt)}</span><span><span className="font-semibold text-ink">{e.actorName ?? 'Sistema'}</span> {EVENT_LABELS[e.type] ?? e.type}{e.type === 'rejected' && e.payload?.note ? `: ${String(e.payload.note)}` : ''}</span></li>)}</ol>
      </section>
      {(t.createdBy === me?.user.id || t.can.assign) && <RemoveTask t={t} onRemoved={onRemoved} />}
    </div>
  );
}

function ApprovalBox({ t }: { t: Detail }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: (approve: boolean) => api(`/tasks/${t.id}/approval`, { method: 'POST', body: { approve, note } }),
    onSuccess: (_, approve) => { invalidate(); toast({ tone: 'success', message: approve ? 'Entrega aprovada' : 'Entrega devolvida ao responsável' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const approver = t.people.find((p) => p.id === t.approverId)?.name;
  if (!t.can.approve) return <Notice tone="info">Entrega aguardando aprovação de {approver ?? 'quem foi indicado'}.</Notice>;
  return (
    <div className="space-y-2 rounded-md border border-purple/40 bg-purple-soft/40 p-3">
      <p className="text-sm font-semibold text-ink">{t.ownerName} enviou a entrega para você aprovar.</p>
      <FormField label="Observação" htmlFor="ap-note" hint="Obrigatória para devolver"><Textarea id="ap-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      <div className="flex gap-2"><Button variant="primary" loading={m.isPending && m.variables === true} onClick={() => m.mutate(true)}>Aprovar entrega</Button><Button variant="danger" disabled={note.trim().length < 5} loading={m.isPending && m.variables === false} onClick={() => m.mutate(false)}>Devolver</Button></div>
    </div>
  );
}

function Links({ t, ro, patch }: { t: Detail; ro: boolean; patch: (b: Record<string, unknown>) => void }) {
  const items = [
    t.links.contact && { k: 'contactId', label: 'Cliente', name: t.links.contact.name, to: `/customers/${t.links.contact.id}` },
    t.links.opportunity && { k: 'opportunityId', label: 'Oportunidade', name: t.links.opportunity.name, to: `/opportunities/${t.links.opportunity.id}` },
    t.links.contract && { k: 'contractId', label: 'Contrato', name: t.links.contract.name, to: `/contracts/${t.links.contract.id}` },
    t.links.arp && { k: 'arpId', label: 'Ata', name: t.links.arp.name, to: `/contracts/atas/${t.links.arp.id}` },
  ].filter(Boolean) as { k: string; label: string; name: string; to: string }[];
  return (
    <section>
      <h3 className="mb-2 text-base font-bold text-ink">Vínculos</h3>
      {!items.length ? <p className="text-sm text-muted">Tarefa avulsa. Para vincular, use "Vincular existente" na ficha do cliente, da oportunidade, do contrato ou da ata.</p> : (
        <ul className="flex flex-wrap gap-2">{items.map((i) => <li key={i.k} className="inline-flex items-center gap-1.5 rounded-sm bg-surface-2 px-2 py-1 text-sm"><span className="text-muted">{i.label}:</span><Link to={i.to} className="font-semibold text-primary hover:underline">{i.name}</Link>{!ro && <button type="button" aria-label={`Desvincular ${i.label}`} onClick={() => patch({ [i.k]: null })} className="text-muted hover:text-danger"><X className="h-3.5 w-3.5" /></button>}</li>)}</ul>
      )}
    </section>
  );
}

function Checklist({ t, canTick, canEdit }: { t: Detail; canTick: boolean; canEdit: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const [text, setText] = useState('');
  type Op = { op: 'add'; text: string } | { op: 'toggle'; itemId: string; done: boolean } | { op: 'remove'; itemId: string };
  // resposta imediata na tela; cada item é gravado sozinho no servidor (sem conflito entre pessoas)
  const [local, setLocal] = useState<ChecklistRow[] | null>(null);
  useEffect(() => setLocal(null), [t.rowVersion]);
  const list: ChecklistRow[] = local ?? t.checklist ?? [];
  const m = useMutation({
    mutationFn: (op: Op) => api<{ checklist: ChecklistRow[] }>(`/tasks/${t.id}/checklist`, { method: 'POST', body: op }),
    onSuccess: (r) => { setLocal(r.checklist); invalidate(); },
    onError: (e) => { setLocal(null); invalidate(); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const run = (op: Op) => {
    setLocal(op.op === 'add' ? [...list, { text: op.text, done: false }] : op.op === 'toggle' ? list.map((c) => (c.id === op.itemId ? { ...c, done: op.done } : c)) : list.filter((c) => c.id !== op.itemId));
    m.mutate(op);
  };
  const done = list.filter((c) => c.done).length;
  return (
    <section>
      <h3 className="mb-2 flex items-center justify-between text-base font-bold text-ink">Checklist {list.length > 0 && <span className="num text-sm font-normal text-muted">{done} de {list.length}</span>}</h3>
      <ul className="space-y-1">
        {list.map((c, i) => (
          <li key={c.id ?? `novo-${i}`} className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={c.text} checked={c.done} disabled={!canTick || !c.id || m.isPending} onChange={(e) => c.id && run({ op: 'toggle', itemId: c.id, done: e.target.checked })} />
            <span className={clsx('flex-1 text-sm', c.done && 'text-muted line-through')}>{c.text}</span>
            {canEdit && c.id && <button type="button" aria-label={`Retirar ${c.text}`} className="text-muted hover:text-danger" disabled={m.isPending} onClick={() => run({ op: 'remove', itemId: c.id! })}><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}
      </ul>
      {canEdit && <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { run({ op: 'add', text: text.trim() }); setText(''); } }}><Input aria-label="Novo item do checklist" placeholder="Novo item" value={text} onChange={(e) => setText(e.target.value)} /><Button type="submit" variant="secondary" disabled={!text.trim() || m.isPending}>Adicionar</Button></form>}
    </section>
  );
}

function Subtasks({ t, onOpen }: { t: Detail; onOpen: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const done = useMutation({
    mutationFn: (s: TaskItem) => api(`/tasks/${s.id}`, { method: 'PATCH', body: { rowVersion: s.rowVersion, status: s.completedAt ? 'a_fazer' : 'concluida' } }),
    onSuccess: invalidate,
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section>
      <h3 className="mb-2 flex items-center justify-between text-base font-bold text-ink">Subtarefas {t.subtasks.length > 0 && <span className="num text-sm font-normal text-muted">{t.subtasks.filter((s) => s.completedAt).length} de {t.subtasks.length}</span>}</h3>
      <ul className="space-y-1">
        {t.subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Concluir ${s.title}`} checked={!!s.completedAt} disabled={done.isPending} onChange={() => done.mutate(s)} />
            <button type="button" className={clsx('flex-1 text-left text-sm hover:underline', s.completedAt ? 'text-muted line-through' : 'text-ink')} onClick={() => onOpen(s.id)}>{s.title}</button>
            <span className="text-xs text-muted">{s.ownerName.split(' ')[0]}{s.dueOn ? ` · ${fmtDate(s.dueOn)}` : ''}</span>
          </li>
        ))}
      </ul>
      {t.can.edit && <Button className="mt-2" size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Subtarefa</Button>}
      <NewTaskDialog open={adding} onClose={() => setAdding(false)} prefill={{ parentId: t.id, label: t.title }} />
    </section>
  );
}

function Dependencies({ t, onOpen }: { t: Detail; onOpen: (id: string) => void }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['tasks', 'dep-search', search], enabled: search.trim().length >= 2, queryFn: () => api<TaskList>(`/tasks${qs({ view: 'todas', q: search })}`) });
  const add = useMutation({ mutationFn: (dependsOnId: string) => api(`/tasks/${t.id}/dependencies`, { method: 'POST', body: { dependsOnId } }), onSuccess: () => { invalidate(); setSearch(''); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const del = useMutation({ mutationFn: (dependsOnId: string) => api(`/tasks/${t.id}/dependencies/${dependsOnId}`, { method: 'DELETE' }), onSuccess: invalidate, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const row = (d: Dep, removable: boolean) => (
    <li key={d.id} className="flex items-center gap-2 text-sm">
      <button type="button" className={clsx('flex-1 text-left hover:underline', d.status === 'concluida' ? 'text-muted line-through' : 'text-ink')} onClick={() => onOpen(d.id)}>{d.title}</button>
      <span className="text-xs text-muted">{d.ownerName.split(' ')[0]}</span><TaskStatusChip s={d.status} />
      {removable && t.can.edit && <button type="button" aria-label={`Retirar dependência de ${d.title}`} className="text-muted hover:text-danger" onClick={() => del.mutate(d.id)}><X className="h-4 w-4" /></button>}
    </li>
  );
  const options = (found.data?.items ?? []).filter((x) => x.id !== t.id && !t.blockedBy.some((d) => d.id === x.id));
  return (
    <section>
      <h3 className="mb-2 text-base font-bold text-ink">Dependências</h3>
      <p className="mb-1 text-sm text-muted">Depende de (só conclui depois destas):</p>
      {t.blockedBy.length ? <ul className="mb-2 space-y-1">{t.blockedBy.map((d) => row(d, true))}</ul> : <p className="mb-2 text-sm text-muted">Nenhuma.</p>}
      {t.can.edit && (
        <div className="mb-3 space-y-1">
          <Input aria-label="Buscar tarefa da qual esta depende" placeholder="Buscar tarefa para adicionar" value={search} onChange={(e) => setSearch(e.target.value)} />
          {!!options.length && <ul className="max-h-40 overflow-y-auto rounded-md border border-line">{options.slice(0, 8).map((o) => <li key={o.id}><button type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => add.mutate(o.id)}>{o.title} <span className="text-xs text-muted">· {o.ownerName}</span></button></li>)}</ul>}
        </div>
      )}
      {!!t.blocking.length && <><p className="mb-1 text-sm text-muted">Bloqueia:</p><ul className="space-y-1">{t.blocking.map((d) => row(d, false))}</ul></>}
    </section>
  );
}

function Time({ t }: { t: Detail }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const { me } = useAuth();
  const [f, setF] = useState({ minutes: '', workedOn: todayLocal(), note: '' });
  const mins = parseMinutes(f.minutes);
  const add = useMutation({ mutationFn: () => api(`/tasks/${t.id}/time`, { method: 'POST', body: { minutes: mins, workedOn: f.workedOn, note: f.note || null } }), onSuccess: () => { invalidate(); setF({ ...f, minutes: '', note: '' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const rev = useMutation({ mutationFn: (entryId: string) => api(`/tasks/${t.id}/time/${entryId}/reverse`, { method: 'POST' }), onSuccess: invalidate, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const reversed = new Set(t.time.filter((e) => e.reversesId).map((e) => e.reversesId));
  const canLog = t.can.edit || t.participants.includes(me?.user.id ?? '');
  return (
    <section>
      <h3 className="mb-2 flex items-center justify-between text-base font-bold text-ink">Tempo <span className="num text-sm font-normal text-muted">{fmtMinutes(t.timeMinutes)}{t.estimateMinutes ? ` de ${fmtMinutes(t.estimateMinutes)} estimados` : ''}</span></h3>
      {t.estimateMinutes && t.timeMinutes > t.estimateMinutes && <p className="mb-2 text-sm text-[#C2610C]">Passou da estimativa em {fmtMinutes(t.timeMinutes - t.estimateMinutes)}.</p>}
      {!!t.time.length && <ul className="mb-2 space-y-1 text-sm">{t.time.map((e) => <li key={e.id} className={clsx('flex items-center gap-2', (e.reversesId || reversed.has(e.id)) && 'text-muted')}><span className="num w-20">{fmtDate(e.workedOn)}</span><span className="num w-16 font-semibold">{e.minutes < 0 ? '−' : ''}{fmtMinutes(Math.abs(e.minutes))}</span><span className="flex-1 truncate">{e.userName}{e.note ? ` · ${e.note}` : ''}</span>{!e.reversesId && !reversed.has(e.id) && (e.userId === me?.user.id) && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => rev.mutate(e.id)}>Estornar</button>}</li>)}</ul>}
      {canLog && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (mins) add.mutate(); }}>
          <FormField label="Tempo" htmlFor="tm-min"><Input id="tm-min" className="w-24" placeholder="1h30" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></FormField>
          <FormField label="Dia" htmlFor="tm-day"><Input id="tm-day" type="date" max={todayLocal()} value={f.workedOn} onChange={(e) => setF({ ...f, workedOn: e.target.value })} /></FormField>
          <FormField label="O que foi feito" htmlFor="tm-note" className="min-w-[160px] flex-1"><Input id="tm-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FormField>
          <Button type="submit" variant="secondary" disabled={!mins} loading={add.isPending}>Registrar</Button>
        </form>
      )}
    </section>
  );
}

function Files({ t }: { t: Detail }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const input = useRef<HTMLInputElement>(null);
  const up = useMutation({
    mutationFn: async (file: File) => { if (file.size > MAX_UPLOAD_BYTES) throw new Error('Arquivo maior que 3 MB.'); return api(`/tasks/${t.id}/files`, { method: 'POST', body: { name: file.name, mime: file.type, data: await fileToBase64(file) } }); },
    onSuccess: invalidate, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const del = useMutation({ mutationFn: (fid: string) => api(`/tasks/${t.id}/files/${fid}`, { method: 'DELETE' }), onSuccess: invalidate, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <section>
      <h3 className="mb-2 flex items-center justify-between text-base font-bold text-ink">Arquivos <Button size="sm" variant="secondary" icon={<Paperclip className="h-4 w-4" />} loading={up.isPending} onClick={() => input.current?.click()}>Anexar</Button></h3>
      <input ref={input} type="file" className="sr-only" aria-label="Arquivo da tarefa" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
      {!t.files.length ? <p className="text-sm text-muted">Nenhum arquivo.</p> : <ul className="space-y-1 text-sm">{t.files.map((f) => <li key={f.id} className="flex items-center gap-2"><a className="flex-1 truncate font-semibold text-primary hover:underline" href={`/api/v1/tasks/${t.id}/files/${f.id}`} download><Download className="mr-1 inline h-4 w-4" aria-hidden />{f.name}</a><span className="text-xs text-muted">{fmtBytes(f.sizeBytes)} · {f.uploadedBy}</span>{t.can.edit && <button type="button" aria-label={`Retirar ${f.name}`} className="text-muted hover:text-danger" onClick={() => del.mutate(f.id)}><Ban className="h-4 w-4" /></button>}</li>)}</ul>}
    </section>
  );
}

function Comments({ t }: { t: Detail }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const users = useLookups().data?.users ?? [];
  const people: Participant[] = users.map((u) => ({ id: u.id, name: u.name, jobTitle: null, hasAvatar: u.hasAvatar }));
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Participant[]>([]);
  const m = useMutation({
    mutationFn: () => api(`/tasks/${t.id}/comments`, { method: 'POST', body: { body: text.trim(), mentions: mentionsIn(text, picked) } }),
    onSuccess: () => { invalidate(); setText(''); setPicked([]); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section>
      <h3 className="mb-2 text-base font-bold text-ink">Comentários</h3>
      <ul className="mb-3 space-y-3">
        {t.comments.map((c) => (
          <li key={c.id} className="flex gap-2.5"><Avatar name={c.authorName} size={28} /><div className="min-w-0 flex-1"><p className="text-xs text-muted"><span className="font-semibold text-ink">{c.authorName}</span> · {fmtDateTime(c.createdAt)}</p><p className="whitespace-pre-line text-sm">{c.body}</p></div></li>
        ))}
        {!t.comments.length && <li className="text-sm text-muted">Sem comentários. Use @ para chamar alguém: a pessoa recebe o aviso em Menções e passa a acompanhar a tarefa.</li>}
      </ul>
      <MentionInput people={people} value={text} onChange={setText} picked={picked} onPick={(p) => setPicked((x) => [...x, p])} label="Comentário" placeholder="Escreva um comentário… use @ para mencionar" rows={2} />
      <div className="mt-2 flex justify-end"><Button variant="primary" size="sm" disabled={!text.trim()} loading={m.isPending} onClick={() => m.mutate()}>Comentar</Button></div>
    </section>
  );
}

function RemoveTask({ t, onRemoved }: { t: Detail; onRemoved: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const [sure, setSure] = useState(false);
  const m = useMutation({ mutationFn: () => api(`/tasks/${t.id}`, { method: 'DELETE' }), onSuccess: () => { invalidate(); onRemoved(); toast({ tone: 'success', message: 'Tarefa removida' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <div className="border-t border-line pt-4">
      {!sure ? <Button variant="ghost" className="text-danger" onClick={() => setSure(true)}>Remover tarefa</Button> : (
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm">Remover{t.subtasks.length ? ` com ${t.subtasks.length} subtarefa(s)` : ''}? O histórico fica guardado.</span><Button variant="danger" size="sm" loading={m.isPending} onClick={() => m.mutate()}>Remover</Button><Button variant="secondary" size="sm" onClick={() => setSure(false)}>Cancelar</Button></div>
      )}
    </div>
  );
}
