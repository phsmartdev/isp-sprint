/**
 * Gestão de Times — Fase 5: intervenções a partir da apuração oficial.
 * - Vermelho na competência → plano de ação obrigatório.
 * - Dois amarelos em competências consecutivas → plano de ação obrigatório.
 * - Primeiro amarelo → revisão simplificada (causa provável + decisão), que pode virar plano.
 * - Uma série de meta tem no máximo uma intervenção aberta: nova competência ruim entra como reincidência na que já existe.
 * - Prazo vencido sobe um nível na cadeia de responsáveis (escalonamento), até o topo.
 */
import type { TrafficColor } from './indicators';

/** competência seguinte (AAAA-MM); local para não criar dependência circular com indicators → performance */
const nextComp = (c: string) => { const [y, m] = c.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

export type InterventionKind = 'plano' | 'revisao';
export type InterventionTrigger = 'vermelho' | 'amarelos_consecutivos' | 'primeiro_amarelo';
export type InterventionStatus = 'aberta' | 'em_andamento' | 'concluida' | 'dispensada';
export const INTERVENTION_KIND_LABELS: Record<InterventionKind, string> = { plano: 'Plano de ação obrigatório', revisao: 'Revisão simplificada' };
export const INTERVENTION_TRIGGER_LABELS: Record<InterventionTrigger, string> = { vermelho: 'Resultado vermelho', amarelos_consecutivos: 'Dois amarelos seguidos', primeiro_amarelo: 'Primeiro amarelo' };
export const INTERVENTION_STATUS_LABELS: Record<InterventionStatus, string> = { aberta: 'Aguardando ação', em_andamento: 'Plano em execução', concluida: 'Concluída', dispensada: 'Dispensada' };
export const OPEN_INTERVENTION: InterventionStatus[] = ['aberta', 'em_andamento'];

export type InterventionConfig = { planDays: number; reviewDays: number; escalateAfterDays: number };
export const DEFAULT_INTERVENTION_CONFIG: InterventionConfig = { planDays: 7, reviewDays: 3, escalateAfterDays: 2 };
export function validateInterventionConfig(c: InterventionConfig): string[] {
  const e: string[] = [];
  for (const [k, l] of [['planDays', 'Prazo do plano'], ['reviewDays', 'Prazo da revisão'], ['escalateAfterDays', 'Tolerância antes de escalonar']] as const) {
    if (!Number.isInteger(c[k]) || c[k] < 0 || c[k] > 60) e.push(`${l}: informe de 0 a 60 dias.`);
  }
  if (c.planDays < 1 || c.reviewDays < 1) e.push('Os prazos de plano e revisão precisam de pelo menos 1 dia.');
  return e;
}

/** O que a competência mais recente pede, olhando a anterior (histórico em ordem crescente de competência). */
export function interventionNeed(history: { competencia: string; color: TrafficColor }[]): { kind: InterventionKind; trigger: InterventionTrigger; competencia: string } | null {
  const cur = history[history.length - 1];
  if (!cur) return null;
  if (cur.color === 'vermelho') return { kind: 'plano', trigger: 'vermelho', competencia: cur.competencia };
  if (cur.color !== 'amarelo') return null;
  const prev = history[history.length - 2];
  if (prev && prev.color === 'amarelo' && nextComp(prev.competencia) === cur.competencia) return { kind: 'plano', trigger: 'amarelos_consecutivos', competencia: cur.competencia };
  return { kind: 'revisao', trigger: 'primeiro_amarelo', competencia: cur.competencia };
}

/**
 * Decide o que fazer com a série diante da necessidade atual e da intervenção aberta (se houver).
 * - sem necessidade e aberta só por revisão de amarelo que melhorou → nada (a pessoa conclui a revisão);
 * - necessidade nova sem aberta → criar;
 * - aberta de revisão e agora é plano → promover para plano;
 * - aberta e competência nova ruim → reincidência (não duplica).
 */
export function interventionAction(need: ReturnType<typeof interventionNeed>, open: { kind: InterventionKind; competencias: string[] } | null):
  | { do: 'nada' } | { do: 'criar'; kind: InterventionKind; trigger: InterventionTrigger; competencia: string } | { do: 'promover'; trigger: InterventionTrigger; competencia: string } | { do: 'reincidencia'; trigger: InterventionTrigger; competencia: string } {
  if (!need) return { do: 'nada' };
  if (!open) return { do: 'criar', ...need };
  if (open.competencias.includes(need.competencia)) {
    return open.kind === 'revisao' && need.kind === 'plano' ? { do: 'promover', trigger: need.trigger, competencia: need.competencia } : { do: 'nada' };
  }
  if (open.kind === 'revisao' && need.kind === 'plano') return { do: 'promover', trigger: need.trigger, competencia: need.competencia };
  return { do: 'reincidencia', trigger: need.trigger, competencia: need.competencia };
}

/** Quantos níveis acima do responsável a intervenção deve estar hoje (0 = ainda no prazo). Datas ISO (AAAA-MM-DD). */
export function escalationLevel(dueOn: string, today: string, escalateAfterDays: number, chainLength: number) {
  const late = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000);
  if (late <= 0) return 0;
  return Math.min(chainLength, 1 + Math.floor((late - 1) / Math.max(1, escalateAfterDays)));
}
