/**
 * Quadro de tarefas do Marketing (Anexos V, VI e VII): Sprint quinzenal, colunas do fluxo, etiquetas das verticais
 * (Arte, Ciência, Disciplina, Interno, Tráfego), divisão 70/20/10, limite de tarefas simultâneas por pessoa,
 * regra de fura-fila e comunicações oficiais de abertura e encerramento.
 */
import { addDaysIso } from './projects';
export { addDaysIso };
export const MKT_COLUMNS = ['backlog', 'a_fazer', 'em_execucao', 'revisao', 'concluido'] as const;
export type MktColumn = (typeof MKT_COLUMNS)[number];
export const MKT_COLUMN_LABELS: Record<MktColumn, string> = { backlog: 'Backlog', a_fazer: 'A fazer', em_execucao: 'Em execução', revisao: 'Em revisão', concluido: 'Concluído' };

export const MKT_VERTICALS = ['arte', 'ciencia', 'disciplina', 'interno', 'trafego'] as const;
export type MktVertical = (typeof MKT_VERTICALS)[number];
export const MKT_VERTICAL_LABELS: Record<MktVertical, string> = { arte: 'Arte', ciencia: 'Ciência', disciplina: 'Disciplina', interno: 'Interno', trafego: 'Tráfego' };

/** Distribuição de esforço da Sprint (Anexo VII, V). */
export const MKT_ALLOCATIONS = ['comercial', 'interdepartamental', 'testes'] as const;
export type MktAllocation = (typeof MKT_ALLOCATIONS)[number];
export const MKT_ALLOCATION_LABELS: Record<MktAllocation, string> = { comercial: 'Estratégia comercial', interdepartamental: 'Apoio interdepartamental', testes: 'Testes e hipóteses' };
export const MKT_ALLOCATION_TARGET: Record<MktAllocation, number> = { comercial: 70, interdepartamental: 20, testes: 10 };

export const MKT_PRIORITIES = ['alta', 'media', 'baixa'] as const;
export type MktPriority = (typeof MKT_PRIORITIES)[number];
export const MKT_PRIORITY_LABELS: Record<MktPriority, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

/** Critérios aceitos para fura-fila (Anexo VII, VIII). */
export const FURA_FILA_CRITERIA = ['receita', 'risco', 'obrigacao', 'oportunidade'] as const;
export type FuraFilaCriterion = (typeof FURA_FILA_CRITERIA)[number];
export const FURA_FILA_LABELS: Record<FuraFilaCriterion, string> = {
  receita: 'Impacto direto em receita', risco: 'Risco reputacional ou operacional', obrigacao: 'Obrigação legal ou institucional', oportunidade: 'Oportunidade de alto impacto com prazo inadiável',
};

/** No máximo 2 a 3 tarefas simultâneas em execução por pessoa. */
export const MKT_WIP_LIMIT = 3;
/** Duração da Sprint em dias. */
export const MKT_SPRINT_DAYS = 15;

/** Itens que podem ser relacionados a uma tarefa ou etiqueta do Marketing. */
export const MKT_LINK_TYPES = ['oportunidade', 'conta', 'lead', 'campanha', 'contrato', 'tarefa'] as const;
export type MktLinkType = (typeof MKT_LINK_TYPES)[number];
export const MKT_LINK_LABELS: Record<MktLinkType, string> = { oportunidade: 'Oportunidade', conta: 'Conta', lead: 'Lead', campanha: 'Campanha', contrato: 'Contrato', tarefa: 'Tarefa' };

export type DueState = 'atrasada' | 'vence_hoje' | 'vence_em_breve' | 'no_prazo' | 'sem_prazo' | 'concluida';
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

/** Situação do prazo: atrasada, vence hoje, vence em até 2 dias, no prazo. */
export function dueState(c: { dueOn: string | null; column: string }, today: string): DueState {
  if (c.column === 'concluido') return 'concluida';
  if (!c.dueOn) return 'sem_prazo';
  const d = dayDiff(c.dueOn, today);
  return d < 0 ? 'atrasada' : d === 0 ? 'vence_hoje' : d <= 2 ? 'vence_em_breve' : 'no_prazo';
}


export type StatCard = { ownerId: string; column: string; dueOn: string | null; allocation: string | null; furaFila: boolean; sprintId: string | null; completedAt?: string | null };

/** Resumo em cima do quadro: andamento da Sprint, prazos, carga por pessoa, divisão 70/20/10 e fura-filas. */
export function boardStats(cards: StatCard[], sprint: { id: string; startOn: string; endOn: string } | null, today: string, wipLimit = MKT_WIP_LIMIT) {
  const inSprint = sprint ? cards.filter((c) => c.sprintId === sprint.id) : cards.filter((c) => c.column !== 'backlog');
  const done = inSprint.filter((c) => c.column === 'concluido').length;
  const states = inSprint.map((c) => dueState(c, today));
  const wip = new Map<string, number>();
  for (const c of cards) if (c.column === 'em_execucao') wip.set(c.ownerId, (wip.get(c.ownerId) ?? 0) + 1);
  const alloc = Object.fromEntries(MKT_ALLOCATIONS.map((a) => [a, inSprint.filter((c) => c.allocation === a).length])) as Record<MktAllocation, number>;
  const classified = MKT_ALLOCATIONS.reduce((t, a) => t + alloc[a], 0);
  const daysLeft = sprint ? Math.max(0, dayDiff(sprint.endOn, today)) : null;
  const elapsedPct = sprint ? Math.min(100, Math.max(0, Math.round(((dayDiff(today, sprint.startOn) + 1) / (dayDiff(sprint.endOn, sprint.startOn) + 1)) * 100))) : null;
  return {
    total: inSprint.length, done, donePct: inSprint.length ? Math.round((done / inSprint.length) * 100) : 0,
    overdue: states.filter((s) => s === 'atrasada').length,
    dueToday: states.filter((s) => s === 'vence_hoje').length,
    dueSoon: states.filter((s) => s === 'vence_em_breve').length,
    inProgress: inSprint.filter((c) => c.column === 'em_execucao').length,
    furaFila: inSprint.filter((c) => c.furaFila).length,
    daysLeft, elapsedPct,
    overLimit: [...wip.entries()].filter(([, n]) => n > wipLimit).map(([ownerId, n]) => ({ ownerId, n })),
    wip: [...wip.entries()].map(([ownerId, n]) => ({ ownerId, n })),
    allocation: MKT_ALLOCATIONS.map((a) => ({ key: a, label: MKT_ALLOCATION_LABELS[a], n: alloc[a], pct: classified ? Math.round((alloc[a] / classified) * 100) : 0, target: MKT_ALLOCATION_TARGET[a] })),
  };
}

const br = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

/** Comunicação oficial da Sprint (modelos dos Anexos), pronta para revisar e enviar. */
export function sprintEmail(kind: 'abertura' | 'encerramento', s: { startOn: string; endOn: string; objective: string | null; highlights?: string | null },
  items: { title: string; column: string; furaFila: boolean; dueOn: string | null; rescheduledTo?: string | null }[], leader: string) {
  const period = `${br(s.startOn)} a ${br(s.endOn)}`;
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `• ${x}`).join('\n') : '• (nenhuma)');
  if (kind === 'abertura') {
    return {
      subject: 'Abertura da Sprint de Marketing | Planejamento Quinzenal',
      text: [
        'Prezados,', '',
        `Iniciamos a Sprint de Marketing referente à quinzena ${period}.`, '',
        'O planejamento desta Sprint foi definido com base nas prioridades estratégicas do negócio, capacidade do time e impacto esperado.',
        'O foco do período estará concentrado nas entregas abaixo.', '',
        'Objetivo da Sprint', s.objective?.trim() || '(defina o objetivo da quinzena)', '',
        'Principais entregas planejadas', list(items.map((i) => i.title)), '',
        'A Sprint encontra-se fechada. Novas demandas serão avaliadas exclusivamente por meio da regra de fura-fila, podendo implicar na reprogramação de entregas já previstas.',
        'O acompanhamento ocorrerá semanalmente e eventuais ajustes serão comunicados.', '',
        'Atenciosamente,', '', leader, 'Liderança de Marketing',
      ].join('\n'),
    };
  }
  const done = items.filter((i) => i.column === 'concluido').map((i) => i.title);
  const moved = items.filter((i) => i.column !== 'concluido').map((i) => `${i.title}${i.rescheduledTo ? ` – novo prazo ${br(i.rescheduledTo)}` : ' – reprogramada para a próxima Sprint'}`);
  return {
    subject: 'Encerramento da Sprint de Marketing - Entregas da Quinzena',
    text: [
      'Prezados,', '',
      `Encerramos a Sprint de Marketing da quinzena ${period}.`, 'Seguem abaixo as entregas realizadas no ciclo:', '',
      'Entregas concluídas', list(done), '',
      'Destaques do período', s.highlights?.trim() || '(resultados, impactos e aprendizados da quinzena)', '',
      ...(moved.length ? ['Reprogramações', list(moved), ''] : []),
      'As próximas prioridades serão comunicadas na abertura da Sprint seguinte.', '',
      'Atenciosamente,', leader, 'Liderança de Marketing',
    ].join('\n'),
  };
}
