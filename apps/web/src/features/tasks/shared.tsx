/** Tarefas: tipos, chips, criação rápida e painel de tarefas vinculadas (cliente, oportunidade, contrato, ata). */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ListChecks, Link2, Plus, Repeat } from 'lucide-react';
import { TASK_STATUS_LABELS, type ChecklistItem, type MyTaskBucket, type Recurrence, type TaskStatus } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type LinkRef = { id: string; name: string | null } | null;
export type TaskItem = {
  id: string; title: string; notes: string | null; status: TaskStatus; statusLabel: string; priority: 'baixa' | 'media' | 'alta'; type: string;
  ownerId: string; ownerName: string; createdBy: string | null; createdByName: string | null; dueOn: string | null; startOn: string | null; completedAt: string | null;
  tags: string[]; category: string | null; estimateMinutes: number | null; timeMinutes: number; checklist: ChecklistItem[]; checklistProgress: { done: number; total: number; pct: number | null };
  participants: string[]; waitingOn: string | null; recurrence: Recurrence | null; recurrenceText: string | null; requiresApproval: boolean; approverId: string | null; approvedAt: string | null;
  parentId: string | null; projectId: string | null; projectName: string | null; projectStageId: string | null; milestoneId: string | null;
  contactId: string | null; opportunityId: string | null; contractId: string | null; arpId: string | null;
  subDone: number; subTotal: number; blockedBy: number; comments: number; unread: number; overdue: boolean; bucket: MyTaskBucket | null; rowVersion: number;
  links: { contact: LinkRef; opportunity: LinkRef; contract: LinkRef; arp: LinkRef; project: LinkRef };
};
export type TaskList = { items: TaskItem[]; counts: Partial<Record<MyTaskBucket, number>>; today: string; tags: string[]; categories: string[] };

export const STATUS_TONE: Record<TaskStatus, Tone> = { a_fazer: 'neutral', em_andamento: 'blue', aguardando: 'orange', em_aprovacao: 'purple', concluida: 'green', cancelada: 'red' };
export const PRIO_TONE = { baixa: 'neutral', media: 'sky', alta: 'red' } as const;
export const PRIO_LABEL = { baixa: 'Baixa', media: 'Média', alta: 'Alta' } as const;

export const TaskStatusChip = ({ s }: { s: TaskStatus }) => <Chip tone={STATUS_TONE[s]}>{TASK_STATUS_LABELS[s]}</Chip>;

/** Linha compacta usada nas listas (Minhas tarefas, painéis vinculados). */
export function TaskLine({ t, onOpen, showOwner }: { t: TaskItem; onOpen: (id: string) => void; showOwner?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <button type="button" onClick={() => onOpen(t.id)} className={clsx('min-w-0 flex-1 text-left font-semibold hover:underline', t.completedAt ? 'text-muted line-through' : 'text-ink')}>
        {t.title}
        {t.unread > 0 && <span className="ml-2 rounded-full bg-[#F5B400] px-1.5 text-2xs font-bold text-navy">{t.unread} novo(s)</span>}
      </button>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {t.recurrence && <Repeat className="h-3.5 w-3.5" aria-label={t.recurrenceText ?? 'Recorrente'} />}
        {t.checklistProgress.total > 0 && <span className="num inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" aria-hidden />{t.checklistProgress.done}/{t.checklistProgress.total}</span>}
        {t.subTotal > 0 && <span className="num">{t.subDone}/{t.subTotal} subtarefas</span>}
        {t.blockedBy > 0 && <Chip tone="orange">Bloqueada</Chip>}
        {t.links.project && <span className="rounded-sm bg-surface-2 px-1.5 py-0.5">{t.links.project.name}</span>}
        {t.links.contact && <span className="rounded-sm bg-surface-2 px-1.5 py-0.5">{t.links.contact.name}</span>}
        {t.tags.map((g) => <span key={g} className="rounded-sm bg-primary-soft px-1.5 py-0.5 text-primary">#{g}</span>)}
      </span>
      {showOwner && <span className="text-xs text-muted">{t.ownerName}</span>}
      {t.status !== 'a_fazer' && <TaskStatusChip s={t.status} />}
      <Chip tone={PRIO_TONE[t.priority]}>{PRIO_LABEL[t.priority]}</Chip>
      <span className={clsx('num w-24 text-right text-xs', t.overdue ? 'font-semibold text-danger' : 'text-muted')}>{t.dueOn ? fmtDate(t.dueOn) : 'sem prazo'}</span>
    </li>
  );
}

export type TaskPrefill = { contactId?: string | null; opportunityId?: string | null; contractId?: string | null; arpId?: string | null; projectId?: string | null; parentId?: string | null; label?: string };
const todayLocal = () => new Date().toLocaleDateString('en-CA');

export function useTaskTemplates(enabled: boolean) {
  return useQuery({ queryKey: ['task-templates'], enabled, queryFn: () => api<{ items: { id: string; name: string; title: string }[] }>('/task-templates'), staleTime: 60_000 });
}

export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => { for (const k of ['tasks', 'task', 'activities', 'project', 'projects', 'mentions']) void qc.invalidateQueries({ queryKey: [k] }); };
}

/** Criação rápida (o restante — checklist, dependências, recorrência… — fica no detalhe). */
export function NewTaskDialog({ open, onClose, prefill, onCreated }: { open: boolean; onClose: () => void; prefill?: TaskPrefill; onCreated?: (id: string) => void }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const tpl = useTaskTemplates(open);
  const blank = { title: '', notes: '', ownerId: me?.user.id ?? '', dueOn: '', priority: 'media' as TaskItem['priority'], templateId: '', tags: '' };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF({ ...blank, ownerId: me?.user.id ?? '' }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/tasks', {
      method: 'POST',
      body: {
        title: f.title, notes: f.notes || null, ownerId: f.ownerId || undefined, dueOn: f.dueOn || null, priority: f.priority, templateId: f.templateId || null,
        tags: f.tags ? f.tags.split(/[,\s]+/).map((x) => x.replace(/^#/, '')).filter(Boolean) : undefined,
        contactId: prefill?.contactId ?? null, opportunityId: prefill?.opportunityId ?? null, contractId: prefill?.contractId ?? null, arpId: prefill?.arpId ?? null, projectId: prefill?.projectId ?? null, parentId: prefill?.parentId ?? null,
      },
    }),
    onSuccess: (r) => { invalidate(); onClose(); toast({ tone: 'success', message: f.ownerId && f.ownerId !== me?.user.id ? 'Tarefa criada e enviada ao responsável' : 'Tarefa criada' }); onCreated?.(r.id); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open={open} onClose={onClose} title={prefill?.parentId ? 'Nova subtarefa' : 'Nova tarefa'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.title.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>Criar tarefa</Button></>}>
      <div className="space-y-4">
        {prefill?.label && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">Vinculada a <span className="font-semibold text-ink">{prefill.label}</span></p>}
        <FormField label="Título" htmlFor="nt-title" required><Input id="nt-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Responsável" htmlFor="nt-owner" hint="Outra pessoa recebe o aviso; a tarefa fica em Delegadas para você"><Select id="nt-owner" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me?.user.id ? ' (eu)' : ''}</option>)}</Select></FormField>
          <FormField label="Prazo" htmlFor="nt-due"><Input id="nt-due" type="date" min={todayLocal()} value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
          <FormField label="Prioridade" htmlFor="nt-prio"><Select id="nt-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TaskItem['priority'] })}>{Object.entries(PRIO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          {!prefill?.parentId && <FormField label="Modelo" htmlFor="nt-tpl" hint="Traz checklist, estimativa e etiquetas"><Select id="nt-tpl" value={f.templateId} onChange={(e) => { const t = tpl.data?.items.find((x) => x.id === e.target.value); setF({ ...f, templateId: e.target.value, title: f.title || t?.title || '' }); }}><option value="">Nenhum</option>{tpl.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>}
        </div>
        <FormField label="Etiquetas" htmlFor="nt-tags" hint="Separe por vírgula"><Input id="nt-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="comercial, governo" /></FormField>
        <FormField label="Descrição" htmlFor="nt-notes"><Textarea id="nt-notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

/** Painel de tarefas para as fichas do CRM: pendências, responsáveis, criar e vincular existente. */
export function LinkedTasks({ prefill, onOpen }: { prefill: TaskPrefill; onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const allowed = can('atividades');
  const filter = { contactId: prefill.contactId ?? undefined, opportunityId: prefill.opportunityId ?? undefined, contractId: prefill.contractId ?? undefined, arpId: prefill.arpId ?? undefined };
  const [done, setDone] = useState(false);
  const q = useQuery({ queryKey: ['tasks', 'linked', filter, done], enabled: allowed, queryFn: () => api<TaskList>(`/tasks${qs({ view: 'todas', ...filter, includeDone: done ? 'true' : undefined })}`) });
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['tasks', 'search', search], enabled: linking && search.trim().length >= 2, queryFn: () => api<TaskList>(`/tasks${qs({ view: 'todas', q: search })}`) });
  const link = useMutation({
    mutationFn: (t: TaskItem) => api(`/tasks/${t.id}`, { method: 'PATCH', body: { rowVersion: t.rowVersion, ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) } }),
    onSuccess: () => { invalidate(); setLinking(false); setSearch(''); toast({ tone: 'success', message: 'Tarefa vinculada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!allowed) return null;
  const items = q.data?.items ?? [];
  const late = items.filter((t) => t.overdue).length;
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><ListChecks className="h-5 w-5 text-primary" aria-hidden />Tarefas</h2>
          {!!items.length && <p className="text-sm text-muted">{items.filter((t) => !t.completedAt).length} pendente(s){late ? `, ${late} atrasada(s)` : ''} · responsáveis: {[...new Set(items.map((t) => t.ownerName.split(' ')[0]))].join(', ')}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={done} onChange={(e) => setDone(e.target.checked)} />Mostrar concluídas</label>
          <Button size="sm" variant="secondary" icon={<Link2 className="h-4 w-4" />} onClick={() => setLinking(true)}>Vincular existente</Button>
          <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova tarefa</Button>
        </div>
      </div>
      {q.isLoading ? <LoadingRows rows={2} /> : !items.length ? <EmptyState title="Nenhuma tarefa pendente" description="Tarefas avulsas ou de projetos ligadas a este registro aparecem aqui." /> : <ul className="divide-y divide-line">{items.map((t) => <TaskLine key={t.id} t={t} onOpen={onOpen} showOwner />)}</ul>}
      <NewTaskDialog open={creating} onClose={() => setCreating(false)} prefill={prefill} />
      <Modal open={linking} onClose={() => setLinking(false)} title="Vincular tarefa existente">
        <div className="space-y-3">
          <FormField label="Buscar tarefa" htmlFor="lk-q" hint="Pelo título, cliente ou projeto"><Input id="lk-q" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus /></FormField>
          {found.isFetching ? <LoadingRows rows={2} /> : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {(found.data?.items ?? []).filter((t) => !items.some((i) => i.id === t.id)).map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{t.title}</span><span className="text-xs text-muted">{t.ownerName} · {t.dueOn ? fmtDate(t.dueOn) : 'sem prazo'}</span></span><Button size="sm" variant="secondary" loading={link.isPending && link.variables?.id === t.id} onClick={() => link.mutate(t)}>Vincular</Button></li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </section>
  );
}
