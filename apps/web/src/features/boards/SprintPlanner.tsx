/**
 * Planejar Semana (liderança/gestão do time): escolhe as tarefas, ajusta responsável, esforço, prazo e ordem, vê a
 * capacidade de cada pessoa e a distribuição 70/20/10 em horas. Salvar = rascunho; Abrir Sprint = compromisso da semana.
 * Também: faixa da Sprint no quadro (situação, retirar com motivo, encerrar com o comparativo) e o cadastro de capacidade.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, CalendarRange, Users } from 'lucide-react';
import {
  ABSENCE_KINDS, ABSENCE_KIND_LABELS, CAPACITY_CATEGORIES, CAPACITY_CATEGORY_LABELS, SPRINT_STATUS_LABELS, fmtMinutes, parseMinutes,
  type BoardKey, type CapacityCategory, type SprintStatus,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

const h = (m: number | null | undefined) => (m == null ? '—' : fmtMinutes(m) || '0h');
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const CAT_BAR: Record<CapacityCategory, string> = { comercial: 'bg-primary', interno: 'bg-[#8FA7C2]', hipotese: 'bg-[#E0A526]' };

type PlanTask = {
  id: string; ref: string; title: string; status: string; ownerId: string; ownerName: string | null; priority: string; dueDay: string | null; agreedDueAt: string | null;
  category: CapacityCategory | null; estimateMinutes: number | null; remainingMinutes: number | null; origin: string; selected: boolean; planOrder: number | null; protectedCommitment: boolean;
  dueThisWeek: boolean; issues: string[]; alerts: string[];
  opportunity: { id: string; label: string; client: string | null; valueCents: number | null; stage: string | null; ownerName: string | null } | null;
};
type Person = { userId: string; name: string; allocationBp: number; netMinutes: number | null; grossMinutes: number | null; unavailableMinutes: number | null; committedMinutes: number; overload: boolean };
export type Plan = {
  week: string; today: string; role: 'gestao' | 'lideranca' | 'colaborador'; policy: Record<CapacityCategory, number> & { version: number };
  sprint: { id: string; status: SprintStatus; objective: string | null; openedAt: string | null } | null;
  capacity: { totalNetMinutes: number; selectedMinutes: number; availableMinutes: number; targets: Record<CapacityCategory, number>; distribution: Record<CapacityCategory, number>; deviationPp: number; tolerancePp: number; people: Person[]; withoutSchedule: string[] };
  tasks: PlanTask[];
};
type Row = { id: string; ownerId: string; estimate: string; dueOn: string };

export const usePlan = (board: BoardKey, week: string | undefined) =>
  useQuery({ queryKey: ['planejamento', board, week], queryFn: () => api<Plan>(`/quadros/${board}/planejamento${qs({ week })}`), enabled: !!week });

/** Faixa da Sprint no topo do quadro: situação, objetivo e as ações de quem lidera. */
export function SprintBar({ board, week }: { board: BoardKey; week: string }) {
  const plan = usePlan(board, week);
  const [planning, setPlanning] = useState(false);
  const [closing, setClosing] = useState(false);
  const [capacity, setCapacity] = useState(false);
  const p = plan.data;
  if (!p) return null;
  const leads = p.role !== 'colaborador';
  const st = p.sprint?.status;
  return (
    <section aria-label="Sprint da semana" className="flex flex-wrap items-center gap-3 border border-line bg-surface px-4 py-3">
      <CalendarRange className="h-5 w-5 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">Sprint de {fmtDate(p.week)} a {fmtDate(addDays(p.week, 4))}: {st ? SPRINT_STATUS_LABELS[st] : 'não planejada'}</p>
        <p className="text-xs text-muted">
          {p.sprint?.objective ? `Objetivo: ${p.sprint.objective} · ` : ''}
          {h(p.capacity.selectedMinutes)} planejadas de {h(p.capacity.totalNetMinutes)} disponíveis
          {p.capacity.withoutSchedule.length ? ` · sem jornada cadastrada: ${p.capacity.withoutSchedule.join(', ')}` : ''}
        </p>
      </div>
      {leads && st !== 'encerrada' && st !== 'andamento' && <Button size="sm" variant="primary" onClick={() => setPlanning(true)}>Planejar semana</Button>}
      {leads && st === 'andamento' && <Button size="sm" variant="secondary" onClick={() => setPlanning(true)}>Ver o compromisso</Button>}
      {leads && st === 'andamento' && <Button size="sm" variant="primary" onClick={() => setClosing(true)}>Encerrar Sprint</Button>}
      <Button size="sm" variant="ghost" icon={<Users className="h-4 w-4" />} onClick={() => setCapacity(true)}>Capacidade</Button>
      {planning && <PlannerModal board={board} plan={p} onClose={() => setPlanning(false)} />}
      {closing && p.sprint && <CloseModal board={board} sprintId={p.sprint.id} onClose={() => setClosing(false)} />}
      {capacity && <CapacityModal board={board} week={p.week} leads={leads} onClose={() => setCapacity(false)} />}
    </section>
  );
}

function PlannerModal({ board, plan, onClose }: { board: BoardKey; plan: Plan; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const locked = plan.sprint?.status === 'andamento';
  const initial = useMemo(() => plan.tasks.filter((t) => t.selected).sort((a, b) => (a.planOrder ?? 9999) - (b.planOrder ?? 9999))
    .map((t): Row => ({ id: t.id, ownerId: t.ownerId, estimate: t.estimateMinutes != null ? fmtMinutes(t.estimateMinutes) : '', dueOn: t.dueDay ?? '' })), [plan]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [objective, setObjective] = useState(plan.sprint?.objective ?? '');
  const [justification, setJustification] = useState('');
  const [filter, setFilter] = useState<'todas' | 'comercial' | 'prazo' | 'alertas'>('todas');
  const [removing, setRemoving] = useState<PlanTask | null>(null);
  useEffect(() => setRows(initial), [initial]);
  const byId = useMemo(() => new Map(plan.tasks.map((t) => [t.id, t])), [plan]);
  const chosen = new Set(rows.map((r) => r.id));
  const minutesOf = (r: Row) => { const t = byId.get(r.id)!; return t.remainingMinutes ?? parseMinutes(r.estimate) ?? 0; };

  // capacidade recalculada com o que está na tela
  const perPerson = plan.capacity.people.map((p) => { const c = rows.filter((r) => r.ownerId === p.userId).reduce((s, r) => s + minutesOf(r), 0); return { ...p, committedMinutes: c, overload: p.netMinutes === null ? c > 0 : c > p.netMinutes }; });
  const dist = Object.fromEntries(CAPACITY_CATEGORIES.map((c) => [c, rows.filter((r) => byId.get(r.id)?.category === c).reduce((s, r) => s + minutesOf(r), 0)])) as Record<CapacityCategory, number>;
  const total = rows.reduce((s, r) => s + minutesOf(r), 0);
  const deviation = total ? Math.max(...CAPACITY_CATEGORIES.map((c) => Math.abs((dist[c] / total) * 100 - plan.policy[c] / 100))) : 0;
  const rowIssues = (r: Row) => { const t = byId.get(r.id)!; const i: string[] = []; if (!t.category) i.push('sem categoria'); if (!t.remainingMinutes && !parseMinutes(r.estimate)) i.push('sem esforço'); return i; };
  const blocking = rows.filter((r) => rowIssues(r).length);
  const needsJustification = perPerson.some((p) => p.overload) || deviation > plan.capacity.tolerancePp;

  const body = () => ({ week: plan.week, objective: objective.trim() || null, items: rows.map((r, n) => ({ activityId: r.id, ownerId: r.ownerId, estimateMinutes: r.estimate.trim() ? parseMinutes(r.estimate) : null, dueOn: r.dueOn || null, position: n })) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['planejamento', board] }); void qc.invalidateQueries({ queryKey: ['quadro', board] }); };
  const save = useMutation({ mutationFn: () => api<{ sprintId: string }>(`/quadros/${board}/planejamento`, { method: 'PUT', body: body() }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Planejamento salvo como rascunho' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const open = useMutation({
    mutationFn: async () => { const r = await api<{ sprintId: string }>(`/quadros/${board}/planejamento`, { method: 'PUT', body: body() }); return api(`/quadros/${board}/sprints/${r.sprintId}/abrir`, { method: 'POST', body: { justification: justification.trim() || undefined } }); },
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Sprint aberta: o plano original ficou registrado' }); onClose(); },
    onError: (e) => { refresh(); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const cancel = useMutation({ mutationFn: () => api(`/quadros/${board}/sprints/${plan.sprint!.id}/cancelar`, { method: 'POST', body: {} }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Planejamento descartado' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });

  const candidates = plan.tasks.filter((t) => !chosen.has(t.id)).filter((t) => filter === 'todas' || (filter === 'comercial' ? !!t.opportunity : filter === 'prazo' ? t.dueThisWeek || t.alerts.includes('vencida') : t.alerts.length > 0));
  const add = (t: PlanTask) => setRows([...rows, { id: t.id, ownerId: t.ownerId, estimate: t.estimateMinutes != null ? fmtMinutes(t.estimateMinutes) : '', dueOn: t.dueDay ?? '' }]);
  const move = (i: number, d: -1 | 1) => { const n = [...rows]; const a = n[i]!; n[i] = n[i + d]!; n[i + d] = a; setRows(n); };
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <Modal open onClose={onClose} size="xl" title={`${locked ? 'Compromisso' : 'Planejar semana'} · ${fmtDate(plan.week)} a ${fmtDate(addDays(plan.week, 4))}`}
      footer={locked ? <Button variant="ghost" onClick={onClose}>Fechar</Button> : <>
        {plan.sprint && <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Descartar planejamento</Button>}
        <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>Salvar rascunho</Button>
        <Button variant="primary" disabled={!rows.length || blocking.length > 0 || (needsJustification && justification.trim().length < 10)} loading={open.isPending} onClick={() => open.mutate()}>Abrir Sprint</Button>
      </>}>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          {locked && <p className="border-l-4 border-l-primary bg-surface-2 px-3 py-2 text-sm">A Sprint está aberta: o plano original está registrado. Para tirar uma tarefa, use Retirar (com motivo). Para incluir, aguarde o fura-fila.</p>}
          <FormField label="Objetivo da semana" htmlFor="sp-obj"><Input id="sp-obj" disabled={locked} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="O que o time precisa entregar nesta semana" /></FormField>
          <div>
            <h3 className="mb-1 text-sm font-bold text-ink">Na semana <span className="num font-normal text-muted">{rows.length} · {h(total)}</span></h3>
            {!rows.length ? <p className="text-sm text-muted">Escolha abaixo as tarefas que o time assume nesta semana.</p> : (
              <ol className="divide-y divide-line border border-line">
                {rows.map((r, i) => { const t = byId.get(r.id)!; const issues = rowIssues(r); return (
                  <li key={r.id} className="space-y-2 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className="num w-5 pt-0.5 text-xs text-muted">{i + 1}</span>
                      <div className="min-w-0 flex-1"><TaskLine t={t} />{issues.length > 0 && <p className="mt-0.5 text-xs font-semibold text-danger">Falta: {issues.join(', ')}</p>}</div>
                      {!locked && <div className="flex gap-1">
                        <button type="button" aria-label="Subir" disabled={i === 0} className="border border-line p-1 disabled:opacity-30" onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label="Descer" disabled={i === rows.length - 1} className="border border-line p-1 disabled:opacity-30" onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                        <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>Tirar</Button>
                      </div>}
                      {locked && <Button size="sm" variant="ghost" onClick={() => setRemoving(t)}>Retirar</Button>}
                    </div>
                    <div className="grid grid-cols-3 gap-2 pl-7">
                      <Select aria-label={`Responsável de ${t.title}`} disabled={locked} value={r.ownerId} onChange={(e) => set(i, { ownerId: e.target.value })}>
                        {!plan.capacity.people.some((p) => p.userId === r.ownerId) && <option value={r.ownerId}>{t.ownerName ?? 'Fora do time'}</option>}
                        {plan.capacity.people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                      </Select>
                      <Input aria-label={`Esforço de ${t.title}`} disabled={locked || t.remainingMinutes != null} value={t.remainingMinutes != null ? `${fmtMinutes(t.remainingMinutes)} restantes` : r.estimate} onChange={(e) => set(i, { estimate: e.target.value })} placeholder="Esforço (ex.: 2h)" />
                      <Input aria-label={`Prazo de ${t.title}`} type="date" disabled={locked} value={r.dueOn} onChange={(e) => set(i, { dueOn: e.target.value })} />
                    </div>
                  </li>
                ); })}
              </ol>
            )}
          </div>
          {!locked && <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-ink">Pendentes do time <span className="num font-normal text-muted">{candidates.length}</span></h3>
              <div role="radiogroup" aria-label="Filtrar pendentes" className="ml-auto inline-flex border border-line text-xs">
                {([['todas', 'Todas'], ['comercial', 'Comerciais'], ['prazo', 'Prazo na semana'], ['alertas', 'Com alerta']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={clsx('px-2 py-1 font-semibold', filter === k ? 'bg-primary text-white' : 'bg-surface')}>{l}</button>)}
              </div>
            </div>
            {!candidates.length ? <p className="text-sm text-muted">Nada pendente com esse filtro.</p> : (
              <ul className="max-h-80 divide-y divide-line overflow-y-auto border border-line">
                {candidates.map((t) => <li key={t.id} className="flex items-start gap-2 px-3 py-2"><div className="min-w-0 flex-1"><TaskLine t={t} /></div><Button size="sm" variant="secondary" onClick={() => add(t)}>Incluir</Button></li>)}
              </ul>
            )}
          </div>}
        </div>
        <aside aria-label="Capacidade da semana" className="space-y-4">
          <div className="border border-line p-3">
            <h3 className="text-sm font-bold text-ink">Capacidade</h3>
            <p className="num text-2xl font-extrabold text-ink">{h(total)} <span className="text-sm font-normal text-muted">de {h(plan.capacity.totalNetMinutes)}</span></p>
            <ul className="mt-2 space-y-2">{perPerson.map((p) => (
              <li key={p.userId} className="text-xs">
                <div className="flex justify-between"><span className="font-semibold text-ink">{p.name}</span><span className={clsx('num', p.overload && 'font-bold text-danger')}>{h(p.committedMinutes)} / {p.netMinutes == null ? 'sem jornada' : h(p.netMinutes)}</span></div>
                <div className="mt-0.5 h-1.5 bg-surface-2"><div className={clsx('h-full', p.overload ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.min(100, p.netMinutes ? (p.committedMinutes / p.netMinutes) * 100 : p.committedMinutes ? 100 : 0)}%` }} /></div>
              </li>
            ))}</ul>
          </div>
          <div className="border border-line p-3">
            <h3 className="text-sm font-bold text-ink">Diretriz {plan.policy.comercial / 100}/{plan.policy.interno / 100}/{plan.policy.hipotese / 100}</h3>
            <div className="mt-2 flex h-2 w-full overflow-hidden bg-surface-2" aria-hidden>{CAPACITY_CATEGORIES.map((c) => <div key={c} className={CAT_BAR[c]} style={{ width: `${total ? (dist[c] / total) * 100 : 0}%` }} />)}</div>
            <table className="mt-2 w-full text-xs"><thead><tr className="text-left text-muted"><th className="font-normal">Categoria</th><th className="font-normal">Planejado</th><th className="font-normal">Meta</th></tr></thead><tbody>
              {CAPACITY_CATEGORIES.map((c) => <tr key={c}><td>{CAPACITY_CATEGORY_LABELS[c]}</td><td className="num">{h(dist[c])}{total ? ` (${Math.round((dist[c] / total) * 100)}%)` : ''}</td><td className="num">{h(plan.capacity.targets[c])}</td></tr>)}
            </tbody></table>
            {deviation > plan.capacity.tolerancePp && <p className="mt-2 text-xs font-semibold text-[#7A4B00]">Distribuição {Math.round(deviation)} p.p. fora da diretriz.</p>}
          </div>
          {!locked && needsJustification && <FormField label="Justificativa para abrir" htmlFor="sp-just" required hint="Sobrecarga ou distribuição fora da diretriz ficam registradas na Sprint"><Textarea id="sp-just" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} /></FormField>}
          {!locked && blocking.length > 0 && <p className="flex gap-1.5 text-xs text-danger"><AlertTriangle className="h-4 w-4 shrink-0" />{blocking.length} tarefa(s) sem categoria ou esforço: complete antes de abrir.</p>}
        </aside>
      </div>
      {removing && plan.sprint && <RemoveModal board={board} sprintId={plan.sprint.id} task={removing} onClose={() => setRemoving(null)} />}
    </Modal>
  );
}

function TaskLine({ t }: { t: PlanTask }) {
  return (
    <div className="text-sm">
      <p className="font-semibold text-ink">{t.title} <span className="text-xs font-normal text-muted">{t.ref}</span></p>
      <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
        {t.category ? <Chip tone={t.category === 'comercial' ? 'blue' : 'neutral'}>{CAPACITY_CATEGORY_LABELS[t.category]}</Chip> : <Chip tone="neutral">Sem categoria</Chip>}
        <span className="text-muted">{t.ownerName ?? '—'}{t.dueDay ? ` · prazo ${fmtDate(t.dueDay)}` : ''}{t.estimateMinutes ? ` · ${h(t.estimateMinutes)}` : ''}</span>
        {t.protectedCommitment && <Chip tone="sky">Protegido</Chip>}
        {t.alerts.map((a) => <Chip key={a} tone="red">{a}</Chip>)}
      </div>
      {t.opportunity && <p className="mt-0.5 text-xs text-muted">{t.opportunity.label} · {t.opportunity.client ?? '—'}{t.opportunity.valueCents ? ` · ${fmtBRL(t.opportunity.valueCents)}` : ''}{t.opportunity.stage ? ` · ${t.opportunity.stage}` : ''}{t.opportunity.ownerName ? ` · ${t.opportunity.ownerName}` : ''}</p>}
    </div>
  );
}

function RemoveModal({ board, sprintId, task, onClose }: { board: BoardKey; sprintId: string; task: PlanTask; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/quadros/${board}/sprints/${sprintId}/retirar`, { method: 'POST', body: { activityId: task.id, reason } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['planejamento', board] }); void qc.invalidateQueries({ queryKey: ['quadro', board] }); toast({ tone: 'success', message: 'Tarefa retirada da Sprint' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Retirar da Sprint" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={reason.trim().length < 10} loading={m.isPending} onClick={() => m.mutate()}>Retirar</Button></>}>
      <p className="mb-3 text-sm">“{task.title}” sai do compromisso da semana e volta para as pendentes. O plano original continua registrado.</p>
      <FormField label="Motivo" htmlFor="rm-reason" required><Textarea id="rm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
    </Modal>
  );
}

type Closing = {
  original: { tasks: number; minutes: number; deliveredMinutes: number; deliveredTasks: number }; revised: { tasks: number; minutes: number; deliveredMinutes: number; deliveredTasks: number };
  replanned: { title: string; minutes: number; reason: string | null }[]; furaFilas: { title: string; minutes: number }[]; notDelivered: { title: string; minutes: number }[];
  impediments: { title: string; waitingOn: string | null }[]; finalDistribution: Record<CapacityCategory, number>;
};
function CloseModal({ board, sprintId, onClose }: { board: BoardKey; sprintId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [learnings, setLearnings] = useState('');
  const [result, setResult] = useState<Closing | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ closing: Closing }>(`/quadros/${board}/sprints/${sprintId}/encerrar`, { method: 'POST', body: { learnings: learnings.trim() || undefined } }),
    onSuccess: (r) => { setResult(r.closing); void qc.invalidateQueries({ queryKey: ['planejamento', board] }); void qc.invalidateQueries({ queryKey: ['quadro', board] }); toast({ tone: 'success', message: 'Sprint encerrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  return (
    <Modal open onClose={onClose} size="lg" title={result ? 'Resultado da Sprint' : 'Encerrar Sprint'}
      footer={result ? <Button variant="primary" onClick={onClose}>Fechar</Button> : <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Encerrar Sprint</Button></>}>
      {!result ? (
        <div className="space-y-3">
          <p className="text-sm">Encerrar compara o plano original com o revisado. As tarefas não concluídas voltam para as pendentes do time, com o histórico, para entrar no próximo planejamento se fizer sentido.</p>
          <FormField label="Aprendizados e impedimentos (opcional)" htmlFor="cl-learn"><Textarea id="cl-learn" rows={4} value={learnings} onChange={(e) => setLearnings(e.target.value)} /></FormField>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <table className="w-full"><thead><tr className="text-left text-xs text-muted"><th className="font-normal" /><th className="font-normal">Planejado</th><th className="font-normal">Entregue</th><th className="font-normal">Execução</th></tr></thead><tbody>
            <tr><td className="font-semibold">Plano original</td><td className="num">{result.original.tasks} · {h(result.original.minutes)}</td><td className="num">{result.original.deliveredTasks} · {h(result.original.deliveredMinutes)}</td><td className="num">{pct(result.original.deliveredMinutes, result.original.minutes)}</td></tr>
            <tr><td className="font-semibold">Plano revisado</td><td className="num">{result.revised.tasks} · {h(result.revised.minutes)}</td><td className="num">{result.revised.deliveredTasks} · {h(result.revised.deliveredMinutes)}</td><td className="num">{pct(result.revised.deliveredMinutes, result.revised.minutes)}</td></tr>
          </tbody></table>
          <p>Entregue por categoria: {CAPACITY_CATEGORIES.map((c) => `${CAPACITY_CATEGORY_LABELS[c]} ${h(result.finalDistribution[c])}`).join(' · ')}</p>
          {[['Não entregues (voltaram para as pendentes)', result.notDelivered], ['Retiradas durante a semana', result.replanned], ['Entraram por fura-fila', result.furaFilas]].map(([label, list]) => (list as { title: string; minutes: number; reason?: string | null }[]).length > 0 && (
            <div key={label as string}><h4 className="font-bold text-ink">{label as string}</h4><ul className="list-disc pl-5">{(list as { title: string; minutes: number; reason?: string | null }[]).map((x, i) => <li key={i}>{x.title} ({h(x.minutes)}){x.reason ? ` · ${x.reason}` : ''}</li>)}</ul></div>
          ))}
          {result.impediments.length > 0 && <div><h4 className="font-bold text-ink">Impedimentos</h4><ul className="list-disc pl-5">{result.impediments.map((x, i) => <li key={i}>{x.title}{x.waitingOn ? ` · aguardando ${x.waitingOn}` : ''}</li>)}</ul></div>}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ capacidade
type Cap = {
  week: string; role: string;
  people: (Person & { schedule: { validFrom: string; minutesByWeekday: Record<string, number>; allocations: Record<string, number> } | null; days: { day: string; minutes: number }[] })[];
  absences: { id: string; userId: string; kind: (typeof ABSENCE_KINDS)[number]; startOn: string; endOn: string; minutesPerDay: number | null; note: string | null }[];
  holidays: { id: string; day: string; name: string }[];
};
const WEEKDAYS: [string, string][] = [['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb'], ['7', 'Dom']];

function CapacityModal({ board, week, leads, onClose }: { board: BoardKey; week: string; leads: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['capacidade', board, week], queryFn: () => api<Cap>(`/quadros/${board}/capacidade${qs({ week })}`) });
  const [editing, setEditing] = useState<string | null>(null);
  const [absence, setAbsence] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => { void q.refetch(); void qc.invalidateQueries({ queryKey: ['planejamento', board] }); };
  const delAbs = useMutation({ mutationFn: (id: string) => api(`/quadros/${board}/capacidade/ausencias/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const d = q.data;
  const name = (id: string) => d?.people.find((p) => p.userId === id)?.name ?? '—';
  return (
    <Modal open onClose={onClose} size="xl" title={`Capacidade · semana de ${fmtDate(week)}`} footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d!.people.length ? <EmptyState title="Ninguém neste quadro" description="Defina as equipes do quadro em Configurações → Quadros de Tarefas." /> : (
        <div className="space-y-5">
          <p className="text-sm text-muted">Horas líquidas = jornada − feriados − férias programadas − ausências e rotinas, na parte da pessoa neste departamento.</p>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1 font-normal">Pessoa</th><th className="font-normal">Jornada</th><th className="font-normal">Parte aqui</th><th className="font-normal">Indisponível</th><th className="font-normal">Líquidas</th><th /></tr></thead>
            <tbody>{d!.people.map((p) => (
              <tr key={p.userId} className="border-b border-line">
                <td className="py-1.5 font-semibold">{p.name}</td>
                <td className="num">{p.schedule ? WEEKDAYS.filter(([k]) => p.schedule!.minutesByWeekday[k]).map(([k, l]) => `${l} ${h(p.schedule!.minutesByWeekday[k])}`).join(' · ') : <span className="text-danger">sem jornada</span>}</td>
                <td className="num">{p.allocationBp / 100}%</td>
                <td className="num">{h(p.unavailableMinutes)}</td>
                <td className="num font-bold">{h(p.netMinutes)}</td>
                <td className="text-right">{d!.role === 'gestao' && <Button size="sm" variant="ghost" onClick={() => setEditing(p.userId)}>Jornada</Button>}</td>
              </tr>
            ))}</tbody>
          </table>
          <div>
            <div className="mb-1 flex items-center"><h3 className="text-sm font-bold text-ink">Ausências, compromissos e rotinas</h3>{leads && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setAbsence(true)}>Registrar</Button>}</div>
            {!d!.absences.length ? <p className="text-sm text-muted">Nenhuma registrada.</p> : (
              <ul className="divide-y divide-line border border-line text-sm">{d!.absences.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-1.5"><span className="flex-1">{name(a.userId)} · {ABSENCE_KIND_LABELS[a.kind]} · {fmtDate(a.startOn)}{a.endOn !== a.startOn ? ` a ${fmtDate(a.endOn)}` : ''} · {a.minutesPerDay ? `${h(a.minutesPerDay)} por dia` : 'dia todo'}{a.note ? ` · ${a.note}` : ''}</span>{leads && <Button size="sm" variant="ghost" onClick={() => delAbs.mutate(a.id)}>Retirar</Button>}</li>
              ))}</ul>
            )}
          </div>
          <Holidays holidays={d!.holidays} onChange={refresh} />
        </div>
      )}
      {editing && d && <ScheduleModal board={board} person={d.people.find((p) => p.userId === editing)!} week={week} onClose={() => setEditing(null)} onSaved={refresh} />}
      {absence && d && <AbsenceModal board={board} people={d.people} week={week} onClose={() => setAbsence(false)} onSaved={refresh} />}
    </Modal>
  );
}

function ScheduleModal({ board, person, week, onClose, onSaved }: { board: BoardKey; person: Cap['people'][number]; week: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const init = person.schedule?.minutesByWeekday ?? { 1: 480, 2: 480, 3: 480, 4: 480, 5: 480 };
  const [days, setDays] = useState<Record<string, string>>(Object.fromEntries(WEEKDAYS.map(([k]) => [k, init[k] ? fmtMinutes(init[k]) : ''])));
  const [validFrom, setValidFrom] = useState(week);
  const [share, setShare] = useState(person.schedule?.allocations?.[board] != null ? String(person.schedule.allocations[board] / 100) : '');
  const invalid = Object.values(days).some((v) => v.trim() && parseMinutes(v) === null) || (share.trim() !== '' && !(Number(share) >= 0 && Number(share) <= 100));
  const m = useMutation({
    mutationFn: () => api(`/quadros/${board}/capacidade/jornada/${person.userId}`, { method: 'PUT', body: {
      validFrom, minutesByWeekday: Object.fromEntries(Object.entries(days).filter(([, v]) => v.trim()).map(([k, v]) => [k, parseMinutes(v)!])),
      allocations: { ...(person.schedule?.allocations ?? {}), ...(share.trim() ? { [board]: Math.round(Number(share) * 100) } : {}) },
    } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Jornada registrada' }); onSaved(); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title={`Jornada de ${person.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={invalid} loading={m.isPending} onClick={() => m.mutate()}>Salvar jornada</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-7 gap-1">{WEEKDAYS.map(([k, l]) => <FormField key={k} label={l} htmlFor={`wd-${k}`}><Input id={`wd-${k}`} value={days[k]} onChange={(e) => setDays({ ...days, [k]: e.target.value })} placeholder="0" /></FormField>)}</div>
        <p className="text-xs text-muted">Horas por dia (ex.: 8h, 4h30). Vazio = não trabalha.</p>
        <div className="flex gap-3">
          <FormField label="Vale a partir de" htmlFor="sc-from"><Input id="sc-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></FormField>
          <FormField label="Parte neste departamento (%)" htmlFor="sc-share" hint="Vazio = dividida igualmente entre os quadros das equipes da pessoa"><Input id="sc-share" inputMode="decimal" className="w-24" value={share} onChange={(e) => setShare(e.target.value.replace(',', '.'))} /></FormField>
        </div>
      </div>
    </Modal>
  );
}

function AbsenceModal({ board, people, week, onClose, onSaved }: { board: BoardKey; people: Cap['people']; week: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ userId: people[0]?.userId ?? '', kind: 'ausencia' as (typeof ABSENCE_KINDS)[number], startOn: week, endOn: week, partial: '', note: '' });
  const partialInvalid = !!f.partial.trim() && parseMinutes(f.partial) === null;
  const m = useMutation({
    mutationFn: () => api(`/quadros/${board}/capacidade/ausencias`, { method: 'POST', body: { userId: f.userId, kind: f.kind, startOn: f.startOn, endOn: f.endOn, minutesPerDay: f.partial.trim() ? parseMinutes(f.partial) : null, note: f.note.trim() || null } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Registrado' }); onSaved(); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Registrar ausência ou rotina" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.userId || f.endOn < f.startOn || partialInvalid} loading={m.isPending} onClick={() => m.mutate()}>Registrar</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Pessoa" htmlFor="ab-user"><Select id="ab-user" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>{people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</Select></FormField>
        <FormField label="Tipo" htmlFor="ab-kind"><Select id="ab-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>{ABSENCE_KINDS.map((k) => <option key={k} value={k}>{ABSENCE_KIND_LABELS[k]}</option>)}</Select></FormField>
        <FormField label="De" htmlFor="ab-start"><Input id="ab-start" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></FormField>
        <FormField label="Até" htmlFor="ab-end"><Input id="ab-end" type="date" value={f.endOn} onChange={(e) => setF({ ...f, endOn: e.target.value })} /></FormField>
        <FormField label="Horas por dia" htmlFor="ab-part" hint="Vazio = dia todo"><Input id="ab-part" value={f.partial} onChange={(e) => setF({ ...f, partial: e.target.value })} placeholder="ex.: 2h" aria-invalid={partialInvalid} /></FormField>
        <FormField label="Observação" htmlFor="ab-note"><Input id="ab-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FormField>
      </div>
      <p className="mt-2 text-xs text-muted">Férias vêm sozinhas do cadastro de férias (as programadas).</p>
    </Modal>
  );
}

function Holidays({ holidays, onChange }: { holidays: Cap['holidays']; onChange: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ day: '', name: '' });
  const add = useMutation({ mutationFn: () => api('/quadros/feriados', { method: 'POST', body: f }), onSuccess: () => { setF({ day: '', name: '' }); onChange(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const del = useMutation({ mutationFn: (id: string) => api(`/quadros/feriados/${id}`, { method: 'DELETE' }), onSuccess: onChange, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <div>
      <h3 className="mb-1 text-sm font-bold text-ink">Feriados da empresa</h3>
      {holidays.length > 0 && <ul className="mb-2 flex flex-wrap gap-1.5 text-sm">{holidays.map((x) => <li key={x.id} className="flex items-center gap-1 border border-line px-2 py-0.5">{fmtDate(x.day)} · {x.name}<button type="button" aria-label={`Retirar feriado ${x.name}`} className="text-muted hover:text-danger" onClick={() => del.mutate(x.id)}>×</button></li>)}</ul>}
      <div className="flex flex-wrap items-end gap-2">
        <FormField label="Dia" htmlFor="hol-day"><Input id="hol-day" type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></FormField>
        <FormField label="Nome" htmlFor="hol-name"><Input id="hol-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <Button size="sm" variant="secondary" disabled={!f.day || f.name.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>Incluir feriado</Button>
      </div>
      <p className="mt-1 text-xs text-muted">Feriado é da empresa toda: gestão ou administrador.</p>
    </div>
  );
}
