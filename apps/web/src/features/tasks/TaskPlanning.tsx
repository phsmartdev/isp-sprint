/**
 * Seção "Planejamento" do drawer da tarefa (Quadro de Tarefas): departamento, categoria 70/20/10, esforço restante,
 * prazo acordado, compromisso protegido e o envio para o quadro de outro time. Só aparece para quem vê algum quadro.
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { BOARD_LABELS, CAPACITY_CATEGORIES, CAPACITY_CATEGORY_LABELS, TASK_ORIGIN_LABELS, fmtMinutes, parseMinutes, type BoardKey, type CapacityCategory, type TaskOrigin } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, Chip, FormField, Input, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { useInvalidateTasks } from './shared';

export type TaskPlanningData = {
  boardKey: BoardKey | null; originBoard: BoardKey | null; sentAt: string | null; category: CapacityCategory | null; categoryAuto: boolean; origin: TaskOrigin;
  estimateMinutes: number | null; remainingMinutes: number | null; agreedDueAt: string | null; plannedWeek: string | null; protectedCommitment: boolean;
};
type Boards = { items: { key: BoardKey; label: string; teamIds: string[]; role: 'gestao' | 'lideranca' | 'colaborador' }[] };
export const useBoards = () => useQuery({ queryKey: ['quadros'], queryFn: () => api<Boards>('/quadros'), staleTime: 60_000 });

export function TaskPlanning({ id, rowVersion, p, canEdit }: { id: string; rowVersion: number; p: TaskPlanningData; canEdit: boolean }) {
  const boards = useBoards();
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const init = { category: p.category ?? '', reason: '', remaining: p.remainingMinutes != null ? fmtMinutes(p.remainingMinutes) : '', agreed: p.agreedDueAt?.slice(0, 10) ?? '', protectedCommitment: p.protectedCommitment };
  const [f, setF] = useState(init);
  const [sending, setSending] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { rowVersion };
      if (f.category !== (p.category ?? '')) { body.capacityCategory = f.category || null; if (f.reason.trim()) body.categoryReason = f.reason.trim(); }
      const rem = f.remaining.trim() ? parseMinutes(f.remaining) : null;
      if (rem !== p.remainingMinutes) body.remainingMinutes = rem;
      if (f.agreed !== (p.agreedDueAt?.slice(0, 10) ?? '')) body.agreedDueOn = f.agreed || null;
      if (f.protectedCommitment !== p.protectedCommitment) body.protectedCommitment = f.protectedCommitment;
      return api(`/quadros/tarefas/${id}/planejamento`, { method: 'PATCH', body });
    },
    onSuccess: () => { invalidate(); toast({ tone: 'success', message: 'Planejamento salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!boards.data?.items.length) return null;
  const changingCategory = f.category !== (p.category ?? '') && !!p.category;
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  const remainingInvalid = !!f.remaining.trim() && parseMinutes(f.remaining) === null;
  return (
    <section aria-label="Planejamento" className="space-y-3 border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">Planejamento</h3>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Chip tone="neutral">Origem: {TASK_ORIGIN_LABELS[p.origin]}</Chip>
          {p.boardKey && <Chip tone="blue">Quadro: {BOARD_LABELS[p.boardKey]}</Chip>}
          {p.originBoard && p.originBoard !== p.boardKey && <Chip tone="sky">Enviada por {BOARD_LABELS[p.originBoard]}{p.sentAt ? ` em ${fmtDate(p.sentAt)}` : ''}</Chip>}
          {p.plannedWeek && <Chip tone="neutral">Semana de {fmtDate(p.plannedWeek)}</Chip>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Categoria de capacidade" htmlFor="tp-cat" hint={p.categoryAuto ? 'Automática: ligada a oportunidade' : undefined}>
          <Select id="tp-cat" disabled={!canEdit} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">Sem categoria</option>
            {CAPACITY_CATEGORIES.map((c) => <option key={c} value={c}>{CAPACITY_CATEGORY_LABELS[c]}</option>)}
          </Select>
        </FormField>
        <FormField label="Esforço restante" htmlFor="tp-rem" hint={p.estimateMinutes ? `Estimado: ${fmtMinutes(p.estimateMinutes)}` : 'Ex.: 1h30'}>
          <Input id="tp-rem" disabled={!canEdit} value={f.remaining} onChange={(e) => setF({ ...f, remaining: e.target.value })} aria-invalid={remainingInvalid} />
        </FormField>
        <FormField label="Prazo acordado" htmlFor="tp-agreed"><Input id="tp-agreed" type="date" disabled={!canEdit} value={f.agreed} onChange={(e) => setF({ ...f, agreed: e.target.value })} /></FormField>
      </div>
      {changingCategory && <FormField label="Por que a categoria muda" htmlFor="tp-reason" required><Textarea id="tp-reason" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Fica registrado no histórico da tarefa" /></FormField>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" disabled={!canEdit} checked={f.protectedCommitment} onChange={(e) => setF({ ...f, protectedCommitment: e.target.checked })} />Compromisso protegido (prazo legal, contratual ou crítico com o cliente)</label>
      <div className="flex flex-wrap gap-2">
        {canEdit && <Button size="sm" variant="primary" disabled={!dirty || remainingInvalid || (changingCategory && f.reason.trim().length < 10)} loading={save.isPending} onClick={() => save.mutate()}>Salvar planejamento</Button>}
        {canEdit && <Button size="sm" variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => setSending(true)}>Enviar para outro time</Button>}
      </div>
      {sending && <SendDialog id={id} current={p.boardKey} onClose={() => setSending(false)} />}
    </section>
  );
}

function SendDialog({ id, current, onClose }: { id: string; current: BoardKey | null; onClose: () => void }) {
  const boards = useBoards();
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  const [to, setTo] = useState<BoardKey | ''>('');
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => api(`/quadros/tarefas/${id}/enviar`, { method: 'POST', body: { to, note: note.trim() || undefined } }),
    onSuccess: () => { invalidate(); toast({ tone: 'success', message: `Tarefa enviada para ${BOARD_LABELS[to as BoardKey]}` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const options = (boards.data?.items ?? []).filter((b) => b.key !== current);
  return (
    <Modal open onClose={onClose} title="Enviar para outro time" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!to} loading={send.isPending} onClick={() => send.mutate()}>Enviar</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">A tarefa entra no backlog do outro time, com a liderança de lá, que distribui e planeja quando será executada. Você e a liderança do seu time acompanham em “Enviadas”, com os comentários e o que foi feito.</p>
        <FormField label="Para qual time" htmlFor="sd-to"><Select id="sd-to" value={to} onChange={(e) => setTo(e.target.value as BoardKey)}><option value="">Escolha</option>{options.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</Select></FormField>
        <FormField label="Recado para o time (opcional)" htmlFor="sd-note"><Textarea id="sd-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}
