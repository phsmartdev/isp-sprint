/**
 * Leituras da carteira de contratos para decisão (Painel): saúde de cada contrato, plano de vencimentos
 * pela situação da renovação, concentração por cliente (Pareto) e reajustes que vencem.
 * Funções puras: a API junta os dados e chama daqui.
 */
import { nextAnniversary } from './contracts';

const day = 86_400_000;
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * day).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / day);

export const HEALTH_STATES = ['em_dia', 'pendencia', 'divergente', 'em_risco'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];
export const PORTFOLIO_HEALTH_LABELS: Record<HealthState, string> = { em_dia: 'Em dia', pendencia: 'Com pendência vencida', divergente: 'Divergente do IXC', em_risco: 'Receita em risco' };
export const PORTFOLIO_HEALTH_HINTS: Record<HealthState, string> = {
  em_dia: 'Sem prazo vencido, sem divergência e sem vencimento próximo sem renovação.',
  pendencia: 'Notificação, etapa de processo ou tarefa com prazo vencido.',
  divergente: 'Cadastro ERP divergente do que está no IXC.',
  em_risco: 'Encerramento previsto ou vence em até 90 dias sem renovação concluída.',
};

export type RenewalState = 'renovado' | 'em_renovacao' | 'sem_acao' | 'encerramento';
export const RENEWAL_LABELS: Record<RenewalState, string> = { renovado: 'Renovação concluída', em_renovacao: 'Renovação em andamento', sem_acao: 'Sem renovação iniciada', encerramento: 'Encerramento previsto' };

export type PortfolioContract = {
  id: string; endAt: string | null; monthlyCents: number; closureExpected: boolean;
  /** processos de renovação do ciclo que termina em endAt */
  renewal: 'concluido' | 'aberto' | null;
  overdue: number; overdueTasks: number; erpStatus: string | null;
};

export function renewalState(c: Pick<PortfolioContract, 'closureExpected' | 'renewal'>): RenewalState {
  if (c.closureExpected) return 'encerramento';
  if (c.renewal === 'concluido') return 'renovado';
  if (c.renewal === 'aberto') return 'em_renovacao';
  return 'sem_acao';
}

/** Situação que mais pede atenção vence: risco de receita > divergência > pendência vencida > em dia. */
export function contractHealth(c: PortfolioContract, today: string): HealthState {
  const soon = !!c.endAt && c.endAt <= addDaysIso(today, 90);
  if (c.closureExpected || (soon && c.renewal !== 'concluido')) return 'em_risco';
  if (c.erpStatus === 'divergente') return 'divergente';
  if (c.overdue > 0 || c.overdueTasks > 0) return 'pendencia';
  return 'em_dia';
}

export function healthSummary(list: PortfolioContract[], today: string) {
  return HEALTH_STATES.map((k) => {
    const xs = list.filter((c) => contractHealth(c, today) === k);
    return { key: k, label: PORTFOLIO_HEALTH_LABELS[k], n: xs.length, monthlyCents: xs.reduce((a, c) => a + c.monthlyCents, 0) };
  });
}

/** Vencimentos dos próximos `months` meses (inclui o atual) em receita mensal, pela situação da renovação. */
export function expiringPlan(list: PortfolioContract[], today: string, months = 12) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  const keys = Array.from({ length: months }, (_, i) => new Date(Date.UTC(y, m + i, 1)).toISOString().slice(0, 7));
  return keys.map((month) => {
    const xs = list.filter((c) => c.endAt?.startsWith(month) && c.endAt >= today);
    const sum = (st: RenewalState) => xs.filter((c) => renewalState(c) === st);
    const out = { month, n: xs.length } as { month: string; n: number } & Record<RenewalState, number> & Record<`${RenewalState}N`, number>;
    for (const st of ['renovado', 'em_renovacao', 'sem_acao', 'encerramento'] as RenewalState[]) {
      const g = sum(st);
      out[st] = g.reduce((a, c) => a + c.monthlyCents, 0);
      out[`${st}N`] = g.length;
    }
    return out;
  });
}

/** Concentração: maiores clientes por receita mensal, com participação e acumulado (Pareto). */
export function pareto(clients: { key: string; name: string; cents: number }[], top = 10) {
  const total = clients.reduce((a, c) => a + c.cents, 0);
  const sorted = [...clients].filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents);
  let acc = 0;
  const items = sorted.slice(0, top).map((c) => { acc += c.cents; return { ...c, share: total ? c.cents / total : 0, cumulative: total ? acc / total : 0 }; });
  // quantos clientes fazem 80% da receita
  let k = 0, s80 = 0;
  for (const c of sorted) { if (total && s80 / total >= 0.8) break; s80 += c.cents; k++; }
  return { totalCents: total, clients: sorted.length, items, clientsFor80: total ? k : null };
}

export type AdjustmentDue = { id: string; date: string; days: number; index: string | null; monthlyCents: number; status: 'aplicado' | 'em_andamento' | 'a_iniciar' };
/** Reajustes cuja data-base faz aniversário na janela; situação pelo processo do ciclo (data do aniversário). */
export function adjustmentsDue(list: { id: string; adjustmentBaseDate: string | null; adjustmentIndex: string | null; monthlyCents: number; processes: { cycleKey: string; status: string }[] }[], today: string, horizonDays = 90): AdjustmentDue[] {
  const out: AdjustmentDue[] = [];
  for (const c of list) {
    if (!c.adjustmentBaseDate) continue;
    // mesma regra dos alertas de reajuste (aniversário da data-base; 29/02 vira 28/02)
    const date = nextAnniversary(c.adjustmentBaseDate, today);
    const days = diffDays(today, date);
    if (days > horizonDays) continue;
    const p = c.processes.find((x) => x.cycleKey === date);
    out.push({ id: c.id, date, days, index: c.adjustmentIndex, monthlyCents: c.monthlyCents, status: p?.status === 'concluido' ? 'aplicado' : p?.status === 'aberto' ? 'em_andamento' : 'a_iniciar' });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Quanto da vigência já passou (0 a 1); sem datas, nulo. */
export function termProgress(startAt: string | null, endAt: string | null, today: string): number | null {
  if (!startAt || !endAt) return null;
  const total = diffDays(startAt, endAt);
  if (total <= 0) return null;
  return Math.max(0, Math.min(1, diffDays(startAt, today) / total));
}

// ------------------------------------------------------------------ desempenho da operação de contratos
export type PerfMetric = { key: string; label: string; value: number | null; unit: 'pct' | 'dias' | 'horas' | 'brl'; num?: number; den?: number; hint: string; goodHigh: boolean };

export type PerfInput = {
  today: string;
  windowDays: number;
  /** processos de renovação (cycleKey = término que está sendo renovado) */
  renewals: { cycleKey: string; status: string; openedAt: string; closedAt: string | null }[];
  /** contratos ainda ativos cujo término caiu na janela sem processo de renovação nem encerramento decidido */
  expiredWithoutRenewal: number;
  /** processos de reajuste (cycleKey = data-base); pct e newCents quando calculados */
  adjustments: { cycleKey: string; status: string; applied: boolean; pct: number | null; newCents: number | null }[];
  /** tarefas ligadas a contratos */
  tasks: { dueAt: string | null; completedAt: string | null; createdAt: string; acceptedAt: string | null }[];
  transfers: { accepted: number; returned: number };
  erp: { avgHours: number | null; firstPassRate: number | null };
};

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const ratio = (n: number, d: number) => (d ? n / d : null);

/** Indicadores de desempenho na janela (padrão: últimos 12 meses). Sem base, o valor é nulo (nunca zero inventado). */
export function contractPerformance(x: PerfInput): PerfMetric[] {
  const from = addDaysIso(x.today, -x.windowDays);
  const inW = (d: string | null) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= x.today;
  const ren = x.renewals.filter((r) => r.status !== 'cancelado' && /^\d{4}-\d{2}-\d{2}$/.test(r.cycleKey) && inW(r.cycleKey));
  const renDone = ren.filter((r) => r.status === 'concluido' && r.closedAt);
  const onTime = renDone.filter((r) => r.closedAt!.slice(0, 10) <= r.cycleKey);
  const renDen = ren.length + x.expiredWithoutRenewal;
  const adj = x.adjustments.filter((a) => a.status !== 'cancelado' && /^\d{4}-\d{2}-\d{2}$/.test(a.cycleKey) && inW(a.cycleKey));
  const applied = adj.filter((a) => a.applied);
  const pcts = applied.map((a) => a.pct).filter((p): p is number => typeof p === 'number');
  const added = applied.reduce((s, a) => s + (a.newCents && a.pct != null ? a.newCents - a.newCents / (1 + a.pct / 100) : 0), 0);
  const doneTasks = x.tasks.filter((t) => t.completedAt && inW(t.completedAt) && t.dueAt);
  const slaOk = doneTasks.filter((t) => t.completedAt! <= t.dueAt!);
  const acceptH = x.tasks.filter((t) => t.acceptedAt && inW(t.acceptedAt)).map((t) => (Date.parse(t.acceptedAt!) - Date.parse(t.createdAt)) / 3_600_000);
  const tr = x.transfers.accepted + x.transfers.returned;
  return [
    { key: 'renovacao_prazo', label: '% Renovação no prazo', value: ratio(onTime.length, renDen), unit: 'pct', num: onTime.length, den: renDen, goodHigh: true, hint: 'Renovações concluídas até o término do contrato ÷ contratos que terminaram na janela (inclui os que venceram sem renovação iniciada).' },
    { key: 'reajuste', label: '% Reajuste efetivado', value: ratio(applied.length, adj.length), unit: 'pct', num: applied.length, den: adj.length, goodHigh: true, hint: 'Reajustes aplicados ÷ reajustes com data-base na janela.' },
    { key: 'antecedencia', label: 'Antecedência média da renovação', value: avg(renDone.map((r) => diffDays(r.closedAt!.slice(0, 10), r.cycleKey))), unit: 'dias', goodHigh: true, hint: 'Dias entre a conclusão da renovação e o término do contrato (negativo = concluiu depois de vencer).' },
    { key: 'ciclo_renovacao', label: 'Tempo médio de renovação', value: avg(renDone.map((r) => diffDays(r.openedAt.slice(0, 10), r.closedAt!.slice(0, 10)))), unit: 'dias', goodHigh: false, hint: 'Dias entre abrir e concluir o processo de renovação.' },
    { key: 'reajuste_medio', label: 'Reajuste médio aplicado', value: pcts.length ? avg(pcts)! / 100 : null, unit: 'pct', goodHigh: true, hint: 'Média dos percentuais aplicados nos reajustes da janela.' },
    { key: 'receita_reajuste', label: 'Receita mensal capturada por reajuste', value: applied.length ? Math.round(added) : null, unit: 'brl', goodHigh: true, hint: 'Quanto os reajustes aplicados na janela acrescentaram ao valor mensal.' },
    { key: 'sla_atividades', label: '% Atividades no prazo', value: ratio(slaOk.length, doneTasks.length), unit: 'pct', num: slaOk.length, den: doneTasks.length, goodHigh: true, hint: 'Atividades de contrato concluídas até o prazo ÷ concluídas com prazo, na janela.' },
    { key: 'aceite', label: 'Tempo médio de aceite', value: avg(acceptH), unit: 'horas', goodHigh: false, hint: 'Horas entre a transferência da demanda e o aceite de quem recebe.' },
    { key: 'devolucao', label: '% Transferências devolvidas', value: ratio(x.transfers.returned, tr), unit: 'pct', num: x.transfers.returned, den: tr, goodHigh: false, hint: 'Demandas devolvidas sem aceite ÷ demandas respondidas (aceitas ou devolvidas) na janela.' },
    { key: 'erp_ciclo', label: 'Tempo médio do Cadastro ERP', value: x.erp.avgHours == null ? null : x.erp.avgHours / 24, unit: 'dias', goodHigh: false, hint: 'Da abertura do Cadastro ERP até ficar Conferido no IXC.' },
    { key: 'erp_primeira', label: '% Cadastro ERP aprovado na 1ª conferência', value: x.erp.firstPassRate == null ? null : x.erp.firstPassRate / 100, unit: 'pct', goodHigh: true, hint: 'Cadastros aprovados sem devolução ÷ cadastros conferidos.' },
  ];
}
