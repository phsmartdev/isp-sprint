/**
 * Tarefas (Etapa 4, 21/10/2026). Uma tarefa é uma `activity` do tipo `tarefa`: pode ser avulsa
 * ou vinculada a projeto, cliente, oportunidade, contrato ou ata. Regras puras aqui; o servidor aplica.
 */
import { addDaysIso } from './projects';

export const TASK_STATUSES = ['a_fazer', 'em_andamento', 'aguardando', 'em_aprovacao', 'concluida', 'cancelada'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  a_fazer: 'A fazer',
  em_andamento: 'Em andamento',
  aguardando: 'Aguardando terceiros',
  em_aprovacao: 'Em aprovação',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};
/** Situações que a pessoa escolhe diretamente. "Em aprovação" e "Concluída" com aprovação passam pelo fluxo de entrega. */
export const TASK_MANUAL_STATUSES: readonly TaskStatus[] = ['a_fazer', 'em_andamento', 'aguardando', 'concluida', 'cancelada'];
export const isClosedStatus = (s: TaskStatus) => s === 'concluida' || s === 'cancelada';

export type ChecklistItem = { id: string; text: string; done: boolean; doneAt?: string | null; doneBy?: string | null };
export function checklistProgress(items: ChecklistItem[] | null | undefined) {
  const list = items ?? [];
  const done = list.filter((i) => i.done).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : null };
}

// ------------------------------------------------------------------ recorrência
export const RECURRENCE_FREQS = ['diaria', 'semanal', 'mensal'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];
export const RECURRENCE_LABELS: Record<RecurrenceFreq, string> = { diaria: 'Diária', semanal: 'Semanal', mensal: 'Mensal' };
/** weekdays: 1 = segunda … 7 = domingo (ISO). Só para semanal. */
export type Recurrence = { freq: RecurrenceFreq; interval: number; weekdays?: number[]; until?: string | null; skipWeekends?: boolean };

export function validateRecurrence(r: Recurrence): string[] {
  const e: string[] = [];
  if (!RECURRENCE_FREQS.includes(r.freq)) e.push('Frequência inválida.');
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 365) e.push('O intervalo deve ser um número inteiro entre 1 e 365.');
  if (r.weekdays && (r.freq !== 'semanal' || r.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7))) e.push('Dias da semana só valem para recorrência semanal (1 = segunda … 7 = domingo).');
  return e;
}

const isoWeekday = (iso: string) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
function addMonthsIso(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(d, last)); // 31/01 + 1 mês = 28 ou 29/02
  return target.toISOString().slice(0, 10);
}

/** Próxima data da série depois de `from` (a data da ocorrência atual). Null quando passa do fim. */
export function nextOccurrence(r: Recurrence, from: string): string | null {
  let next: string;
  if (r.freq === 'diaria') {
    next = addDaysIso(from, r.interval);
    if (r.skipWeekends) while (isoWeekday(next) > 5) next = addDaysIso(next, 1);
  } else if (r.freq === 'semanal') {
    const days = [...new Set(r.weekdays?.length ? r.weekdays : [isoWeekday(from)])].sort();
    const wd = isoWeekday(from);
    const later = days.find((d) => d > wd);
    // mais tarde na mesma semana; senão o primeiro dia da semana seguinte do intervalo
    next = later ? addDaysIso(from, later - wd) : addDaysIso(from, 7 * r.interval - (wd - days[0]!));
  } else {
    next = addMonthsIso(from, r.interval);
  }
  if (r.until && next > r.until) return null;
  return next;
}

export function describeRecurrence(r: Recurrence) {
  const names = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const every = r.interval === 1 ? '' : ` a cada ${r.interval}`;
  const base = r.freq === 'diaria' ? (r.interval === 1 ? 'Todo dia' : `A cada ${r.interval} dias`) + (r.skipWeekends ? ' útil' : '')
    : r.freq === 'semanal' ? `Semanal${every ? `${every} semanas` : ''}${r.weekdays?.length ? ` (${r.weekdays.map((d) => names[d]).join(', ')})` : ''}`
    : r.interval === 1 ? 'Todo mês' : `A cada ${r.interval} meses`;
  return r.until ? `${base}, até ${r.until.split('-').reverse().join('/')}` : base;
}

// ------------------------------------------------------------------ dependências
/** Adicionar a aresta task → dependsOn cria ciclo? `edges` são as dependências atuais (de → depende de). */
export function createsCycle(edges: { from: string; to: string }[], from: string, to: string): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(adj.get(n) ?? []));
  }
  return false;
}

/** O que impede concluir a tarefa agora. */
export function completionBlockers(t: { openBlockers: { title: string }[]; openSubtasks: number }) {
  const r: string[] = [];
  if (t.openBlockers.length) r.push(`Depende de ${t.openBlockers.length === 1 ? `"${t.openBlockers[0]!.title}"` : `${t.openBlockers.length} tarefas`} ainda em aberto.`);
  if (t.openSubtasks) r.push(`${t.openSubtasks} subtarefa(s) em aberto.`);
  return r;
}

// ------------------------------------------------------------------ visões "Minhas tarefas"
export const MY_TASK_BUCKETS = ['hoje', 'proximas', 'atrasadas', 'sem_prazo', 'aguardando', 'delegadas', 'concluidas'] as const;
export type MyTaskBucket = (typeof MY_TASK_BUCKETS)[number];
export const MY_TASK_BUCKET_LABELS: Record<MyTaskBucket, string> = {
  hoje: 'Hoje', proximas: 'Próximas', atrasadas: 'Atrasadas', sem_prazo: 'Sem prazo', aguardando: 'Aguardando terceiros', delegadas: 'Delegadas', concluidas: 'Concluídas',
};

/** Em qual grupo de "Minhas tarefas" a tarefa cai, do ponto de vista de `me`. */
export function bucketOf(t: { ownerId: string; createdBy: string | null; status: TaskStatus; dueOn: string | null }, me: string, today: string): MyTaskBucket | null {
  if (t.ownerId !== me) return t.createdBy === me && !isClosedStatus(t.status) ? 'delegadas' : null;
  if (t.status === 'concluida') return 'concluidas';
  if (t.status === 'cancelada') return null;
  if (t.status === 'aguardando') return 'aguardando';
  if (!t.dueOn) return 'sem_prazo';
  if (t.dueOn < today) return 'atrasadas';
  if (t.dueOn === today) return 'hoje';
  return 'proximas';
}

export const fmtMinutes = (m: number | null | undefined) => {
  if (m === null || m === undefined) return '—';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`) : `${r}min`;
};
/** "1h30", "90", "1,5h", "45min" → minutos. */
export function parseMinutes(v: string): number | null {
  const s = v.trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+)h(\d{1,2})?(min)?$/))) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  if ((m = s.match(/^(\d+(?:\.\d+)?)h$/))) return Math.round(Number(m[1]) * 60);
  if ((m = s.match(/^(\d+)\s*(min|m)?$/))) return Number(m[1]);
  return null;
}
