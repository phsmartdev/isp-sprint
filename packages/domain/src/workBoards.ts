/**
 * Quadro de Tarefas dos departamentos (27/11/2026): uma visão sobre as tarefas que já existem nos módulos (CRM, Contratos,
 * Sucesso do Cliente, Projetos, avulsas) — um registro, várias visões. Aqui ficam as regras puras: quadros, categorias
 * de capacidade (70/20/10), origem da tarefa, coluna do Kanban (execução separada do planejamento) e a política padrão.
 */
import type { FeatureKey } from './modules';

/** Comercial e Gestão de Contratos são o mesmo time: um quadro só. */
export const BOARD_KEYS = ['comercial', 'sucesso_cliente', 'produto', 'marketing'] as const;
export type BoardKey = (typeof BOARD_KEYS)[number];
export const BOARD_LABELS: Record<BoardKey, string> = { comercial: 'Comercial e Contratos', sucesso_cliente: 'Sucesso do Cliente', produto: 'Produto', marketing: 'Marketing' };
/** submenu "Quadro de Tarefas" de cada módulo (liga e desliga em Configurações → Módulos) */
export const BOARD_FEATURE: Record<BoardKey, FeatureKey> = { comercial: 'crm.quadro_tarefas', sucesso_cliente: 'crm.quadro_sucesso', produto: 'produto.quadro_tarefas', marketing: 'marketing.quadro' };

export const CAPACITY_CATEGORIES = ['comercial', 'interno', 'hipotese'] as const;
export type CapacityCategory = (typeof CAPACITY_CATEGORIES)[number];
export const CAPACITY_CATEGORY_LABELS: Record<CapacityCategory, string> = { comercial: 'Estratégia comercial', interno: 'Atividades internas', hipotese: 'Testes de hipóteses' };
export const CAPACITY_CATEGORY_SHORT: Record<CapacityCategory, string> = { comercial: '70 · Comercial', interno: '20 · Interno', hipotese: '10 · Hipótese' };
/** Diretriz padrão por departamento (em bp): 70/20/10. A gerência ou diretoria ajusta; cada mudança é uma nova versão. */
export const DEFAULT_CAPACITY_POLICY: Record<CapacityCategory, number> = { comercial: 7000, interno: 2000, hipotese: 1000 };

export const TASK_ORIGINS = ['crm', 'contratos', 'sucesso_cliente', 'projetos', 'marketing', 'interna'] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];
export const TASK_ORIGIN_LABELS: Record<TaskOrigin, string> = { crm: 'CRM de Vendas', contratos: 'Gestão de Contratos', sucesso_cliente: 'Sucesso do Cliente', projetos: 'Projetos', marketing: 'Marketing', interna: 'Cadastro manual' };

type OriginInput = { opportunityId?: string | null; contractId?: string | null; projectId?: string | null; csKind?: string | null; csPlanId?: string | null };
/** Origem da tarefa: o registro a que ela pertence (preservada durante todo o ciclo). */
export function taskOrigin(t: OriginInput): TaskOrigin {
  if (t.csKind || t.csPlanId) return 'sucesso_cliente';
  if (t.contractId) return 'contratos';
  if (t.opportunityId) return 'crm';
  if (t.projectId) return 'projetos';
  return 'interna';
}

/**
 * Categoria de capacidade: a escolhida (pela liderança, com justificativa quando muda a automática) ou a automática —
 * tarefa ligada a oportunidade nasce como estratégia comercial. Sem escolha e sem oportunidade: sem categoria (precisa
 * classificar antes de entrar na semana).
 */
export function taskCategory(t: { capacityCategory?: string | null; opportunityId?: string | null }): CapacityCategory | null {
  if (t.capacityCategory && (CAPACITY_CATEGORIES as readonly string[]).includes(t.capacityCategory)) return t.capacityCategory as CapacityCategory;
  return t.opportunityId ? 'comercial' : null;
}

/** Colunas do quadro (as do Marketing). Backlog = ainda não planejada para a semana; não muda o status da tarefa. */
export const BOARD_COLUMNS = ['backlog', 'a_fazer', 'em_execucao', 'em_revisao', 'concluido'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];
export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = { backlog: 'Backlog', a_fazer: 'A fazer', em_execucao: 'Em execução', em_revisao: 'Em revisão', concluido: 'Concluído' };

/** Coluna a partir do status (execução) e do planejamento (semana/Sprint). "Aguardando terceiros" fica em execução, marcada como bloqueada. */
export function boardColumn(t: { status: string; planned: boolean }): BoardColumn {
  if (t.status === 'concluida') return 'concluido';
  if (t.status === 'em_aprovacao') return 'em_revisao';
  if (t.status === 'em_andamento' || t.status === 'aguardando') return 'em_execucao';
  return t.planned ? 'a_fazer' : 'backlog';
}
/** Status de execução ao soltar o cartão numa coluna (Backlog ↔ A fazer é planejamento: não muda status). */
export const COLUMN_STATUS: Partial<Record<BoardColumn, string>> = { a_fazer: 'a_fazer', em_execucao: 'em_andamento', em_revisao: 'em_aprovacao', concluido: 'concluida' };

/** Segunda-feira da semana de uma data (YYYY-MM-DD). */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Quadro de uma tarefa: o escolhido nela ou o da primeira equipe do responsável que está num quadro. */
export function boardOfTask(t: { boardKey?: string | null; ownerTeamIds: string[] }, boards: { key: BoardKey; teamIds: string[] }[]): BoardKey | null {
  if (t.boardKey && (BOARD_KEYS as readonly string[]).includes(t.boardKey)) return t.boardKey as BoardKey;
  for (const b of boards) if (b.teamIds.some((id) => t.ownerTeamIds.includes(id))) return b.key;
  return null;
}

// ------------------------------------------------------------------ capacidade semanal (Etapa 5)

/** Jornada por dia da semana, em minutos (1 = segunda … 7 = domingo). Sem jornada cadastrada, não há capacidade (não se presume). */
export type WeekSchedule = Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>>;
export const ABSENCE_KINDS = ['ausencia', 'afastamento', 'compromisso_fixo', 'reserva_operacional'] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];
export const ABSENCE_KIND_LABELS: Record<AbsenceKind, string> = { ausencia: 'Ausência', afastamento: 'Afastamento', compromisso_fixo: 'Compromisso fixo', reserva_operacional: 'Rotina operacional (fora das tarefas)' };

export type CapacityInput = {
  weekStart: string;
  schedule: WeekSchedule | null;
  holidays: string[];
  /** férias programadas: início e quantidade de dias corridos */
  vacations: { startDate: string; days: number }[];
  /** ausências, afastamentos, compromissos fixos e rotinas: dia todo (minutesPerDay vazio) ou X minutos por dia útil */
  absences: { startOn: string; endOn: string; minutesPerDay: number | null }[];
  /** parte da pessoa neste departamento (bp; 10000 = toda) */
  allocationBp: number;
};
export type CapacityResult = { grossMinutes: number; unavailableMinutes: number; netMinutes: number; days: { day: string; minutes: number; reason: string | null }[] } | null;

const addDaysIso = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Capacidade líquida da pessoa na semana = jornada dos dias − feriados − férias − ausências − reservas, vezes a parte
 * dela no departamento. Rotinas que já são tarefas não entram aqui (seriam deduzidas duas vezes).
 */
export function weekCapacity(i: CapacityInput): CapacityResult {
  if (!i.schedule || !Object.values(i.schedule).some((m) => (m ?? 0) > 0)) return null;
  const days: { day: string; minutes: number; reason: string | null }[] = [];
  let gross = 0, unavailable = 0;
  for (let n = 0; n < 7; n++) {
    const day = addDaysIso(i.weekStart, n);
    const base = i.schedule[(n + 1) as 1] ?? 0;
    if (!base) continue;
    gross += base;
    let lost = 0; let reason: string | null = null;
    if (i.holidays.includes(day)) { lost = base; reason = 'feriado'; }
    else if (i.vacations.some((v) => day >= v.startDate && day <= addDaysIso(v.startDate, v.days - 1))) { lost = base; reason = 'férias'; }
    else {
      for (const a of i.absences) if (day >= a.startOn && day <= a.endOn) { lost += a.minutesPerDay == null ? base : a.minutesPerDay; reason = a.minutesPerDay == null ? 'ausência' : reason ?? 'reserva'; }
      lost = Math.min(lost, base);
    }
    unavailable += lost;
    days.push({ day, minutes: base - lost, reason });
  }
  const share = Math.max(0, Math.min(10_000, i.allocationBp)) / 10_000;
  return { grossMinutes: Math.round(gross * share), unavailableMinutes: Math.round(unavailable * share), netMinutes: Math.round((gross - unavailable) * share), days };
}

/** Meta de cada categoria (minutos) a partir da capacidade líquida do departamento e da diretriz. */
export function categoryTargets(netMinutes: number, policy: Record<CapacityCategory, number>): Record<CapacityCategory, number> {
  return { comercial: Math.round((netMinutes * policy.comercial) / 10_000), interno: Math.round((netMinutes * policy.interno) / 10_000), hipotese: Math.round((netMinutes * policy.hipotese) / 10_000) };
}

/** Pendências para comprometer a tarefa na Sprint: responsável, categoria e esforço estimado. */
export function commitIssues(t: { ownerId: string | null; category: CapacityCategory | null; estimateMinutes: number | null }): string[] {
  const out: string[] = [];
  if (!t.ownerId) out.push('sem responsável');
  if (!t.category) out.push('sem categoria');
  if (!t.estimateMinutes) out.push('sem esforço estimado');
  return out;
}

export const SPRINT_STATUSES = ['planejamento', 'andamento', 'encerrada', 'cancelada'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];
export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = { planejamento: 'Em planejamento', andamento: 'Em andamento', encerrada: 'Encerrada', cancelada: 'Cancelada' };

// ---------------------------------------------------------------------------------------------------------------------
// Fura-fila (Etapa 6): ordem obrigatória de consumo — capacidade livre → 10% hipóteses → 20% internas → 70% comercial.
// A camada comercial só pode ser usada quando as anteriores não bastam, e exige aprovação da gerência.
// ---------------------------------------------------------------------------------------------------------------------
/** ordem em que a capacidade comprometida é liberada */
export const FURA_FILA_ORDER: readonly CapacityCategory[] = ['hipotese', 'interno', 'comercial'];
export const FURA_FILA_STATUSES = ['pendente', 'ajustes', 'aguardando_gerencia', 'aprovada', 'rejeitada', 'mantida_backlog', 'cancelada'] as const;
export type FuraFilaStatus = (typeof FURA_FILA_STATUSES)[number];
export const FURA_FILA_STATUS_LABELS: Record<FuraFilaStatus, string> = {
  pendente: 'Aguardando a liderança', ajustes: 'Ajustes solicitados', aguardando_gerencia: 'Aguardando aprovação da gerência',
  aprovada: 'Incluída na Sprint', rejeitada: 'Rejeitada', mantida_backlog: 'Mantida no backlog', cancelada: 'Cancelada',
};

export type FuraFilaCandidate = { id: string; category: CapacityCategory | null; remainingMinutes: number; protectedCommitment: boolean; done: boolean };
export type FuraFilaInput = { neededMinutes: number; freeMinutes: number; candidates: FuraFilaCandidate[]; selectedIds?: string[] };
export type FuraFilaAnalysis = {
  neededMinutes: number; freeUsedMinutes: number; toRecoverMinutes: number;
  /** liberável por camada (sem concluídas e sem compromissos protegidos) */
  recoverable: Record<CapacityCategory, number>;
  /** sugestão na ordem obrigatória (tarefas inteiras) */
  suggestedIds: string[];
  /** o que a seleção libera, por camada */
  selected: Record<CapacityCategory, number>; selectedMinutes: number;
  sufficient: boolean; requiresManagerApproval: boolean;
  /** quebras da regra de ordem ou da seleção (bloqueiam a autorização) */
  issues: string[];
  /** por que uma tarefa não pode ser deslocada */
  blocked: { id: string; reason: string }[];
};

export function analyzeFuraFila(i: FuraFilaInput): FuraFilaAnalysis {
  const needed = Math.max(0, Math.round(i.neededMinutes));
  const freeUsed = Math.min(Math.max(0, i.freeMinutes), needed);
  const toRecover = needed - freeUsed;
  const blocked: { id: string; reason: string }[] = [];
  const eligible = i.candidates.filter((c) => {
    if (c.done) { blocked.push({ id: c.id, reason: 'já concluída: horas executadas não voltam' }); return false; }
    if (c.protectedCommitment) { blocked.push({ id: c.id, reason: 'compromisso protegido (prazo legal, contratual ou crítico)' }); return false; }
    if (!c.category) { blocked.push({ id: c.id, reason: 'sem categoria' }); return false; }
    if (c.remainingMinutes <= 0) { blocked.push({ id: c.id, reason: 'sem esforço restante' }); return false; }
    return true;
  });
  const zero = (): Record<CapacityCategory, number> => ({ comercial: 0, interno: 0, hipotese: 0 });
  const recoverable = zero();
  for (const c of eligible) recoverable[c.category!] += c.remainingMinutes;
  // sugestão: camada a camada; dentro da camada, as maiores primeiro (menos tarefas deslocadas)
  const suggestedIds: string[] = [];
  let left = toRecover;
  for (const cat of FURA_FILA_ORDER) {
    if (left <= 0) break;
    for (const c of eligible.filter((x) => x.category === cat).sort((a, b) => b.remainingMinutes - a.remainingMinutes)) {
      if (left <= 0) break;
      suggestedIds.push(c.id);
      left -= c.remainingMinutes;
    }
  }
  const selIds = new Set(i.selectedIds ?? suggestedIds);
  const issues: string[] = [];
  for (const id of selIds) {
    if (!i.candidates.some((c) => c.id === id)) issues.push('Tarefa selecionada fora da Sprint.');
    else if (!eligible.some((c) => c.id === id)) issues.push(`Tarefa selecionada não pode ser deslocada: ${blocked.find((b) => b.id === id)?.reason ?? ''}.`);
  }
  const chosen = eligible.filter((c) => selIds.has(c.id));
  const selected = zero();
  for (const c of chosen) selected[c.category!] += c.remainingMinutes;
  const selectedMinutes = chosen.reduce((t, c) => t + c.remainingMinutes, 0);
  // ordem obrigatória: só passa para a camada seguinte quando a anterior foi toda usada
  FURA_FILA_ORDER.forEach((cat, n) => {
    if (n === 0 || !selected[cat]) return;
    for (const prev of FURA_FILA_ORDER.slice(0, n))
      if (selected[prev] < recoverable[prev]) issues.push(`Ordem de consumo: use antes toda a capacidade liberável de ${prev === 'hipotese' ? 'testes de hipóteses' : 'atividades internas'}.`);
  });
  if (toRecover === 0 && selectedMinutes > 0) issues.push('Há capacidade livre suficiente: nenhuma tarefa precisa ser deslocada.');
  const sufficient = freeUsed + selectedMinutes >= needed;
  return {
    neededMinutes: needed, freeUsedMinutes: freeUsed, toRecoverMinutes: toRecover, recoverable, suggestedIds, selected, selectedMinutes,
    sufficient, requiresManagerApproval: selected.comercial > 0, issues: [...new Set(issues)], blocked,
  };
}
