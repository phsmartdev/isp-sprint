/**
 * Camada central de cálculo do orçamento (um lugar só; a API e a tela usam estas funções).
 * Tudo em centavos inteiros; quantidade em milésimos inteiros (sem ponto flutuante em dinheiro).
 *
 * Definições (prompt master, item 21):
 * - Planejado: valor originalmente pedido no lançamento.
 * - Aprovado: limite autorizado vigente do lançamento (pode ser menor que o pedido: aprovação parcial).
 * - Reservado: parte do aprovado ainda sem obrigação assumida nem despesa (separada para o item, indisponível para outro uso).
 * - Comprometido: obrigação assumida (valor contratado com o fornecedor).
 * - Realizado: despesa reconhecida (nota/baixa de execução) pela competência.
 * - Pago: pagamentos confirmados pelo Financeiro (principal), já descontados os estornos.
 * - Consumo: maior entre comprometido e realizado — são estágios da mesma obrigação e nunca se somam.
 * - Saldo do lançamento: aprovado − consumo.
 * - Desvio: realizado − aprovado; desvio % = desvio ÷ aprovado × 100 (sem aprovado, não há %).
 * - Economia: aprovado − consumo de um lançamento encerrado (ou contratado abaixo do aprovado); excedente: consumo acima do aprovado.
 * - Juros e multa ficam separados do valor da despesa.
 */

export const APPROVAL_STATES = ['rascunho', 'planejado', 'enviado', 'em_analise', 'questionado', 'em_revisao', 'aprovado', 'aprovado_ressalvas', 'rejeitado'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export const APPROVAL_STATE_LABELS: Record<ApprovalState, string> = {
  rascunho: 'Rascunho', planejado: 'Planejado', enviado: 'Enviado para aprovação', em_analise: 'Em análise', questionado: 'Questionado',
  em_revisao: 'Em revisão', aprovado: 'Aprovado', aprovado_ressalvas: 'Aprovado com ressalvas', rejeitado: 'Rejeitado',
};
/** Estado detalhado → estado resumido usado pelo planejamento trimestral existente. */
export const coarseStatus = (s: ApprovalState): 'rascunho' | 'em_aprovacao' | 'aprovado' | 'recusado' =>
  s === 'aprovado' || s === 'aprovado_ressalvas' ? 'aprovado' : s === 'rejeitado' ? 'recusado' : s === 'enviado' || s === 'em_analise' || s === 'questionado' ? 'em_aprovacao' : 'rascunho';
export const isApproved = (s: ApprovalState) => s === 'aprovado' || s === 'aprovado_ressalvas';
/** Onde o responsável ainda pode mudar o planejamento. */
export const EDITABLE_STATES: ApprovalState[] = ['rascunho', 'planejado', 'em_revisao', 'rejeitado'];
/** Onde quem aprova pode decidir. */
export const DECIDABLE_STATES: ApprovalState[] = ['enviado', 'em_analise', 'questionado'];

export const EXECUTION_STATES = ['nao_iniciada', 'comprometido', 'em_execucao', 'executado_parcial', 'executado', 'encerrado'] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];
export const EXECUTION_STATE_LABELS: Record<ExecutionState, string> = { nao_iniciada: 'Não iniciada', comprometido: 'Comprometido', em_execucao: 'Em execução', executado_parcial: 'Executado parcialmente', executado: 'Executado', encerrado: 'Encerrado' };

export const BUDGET_PRIORITIES = ['alta', 'media', 'baixa'] as const;
export const EXPENSE_TYPES = ['recorrente', 'pontual', 'investimento'] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];
export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = { recorrente: 'Recorrente (custeio)', pontual: 'Pontual', investimento: 'Investimento' };
export const BUDGET_UNITS = ['un', 'h', 'mes', 'kit', 'lote', 'km', 'servico'] as const;
export const BUDGET_UNIT_LABELS: Record<(typeof BUDGET_UNITS)[number], string> = { un: 'Unidade', h: 'Hora', mes: 'Mês', kit: 'Kit', lote: 'Lote', km: 'Km', servico: 'Serviço' };

export const QUESTION_KINDS = ['valor_unitario', 'quantidade', 'necessidade', 'documentos', 'outro'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = { valor_unitario: 'Valor unitário', quantidade: 'Quantidade', necessidade: 'Necessidade da despesa', documentos: 'Documentos', outro: 'Outro' };

export const BUDGET_DECISIONS = ['aprovar', 'aprovar_parcial', 'aprovar_condicoes', 'rejeitar', 'revisao'] as const;
export type BudgetDecision = (typeof BUDGET_DECISIONS)[number];
export const BUDGET_DECISION_LABELS: Record<BudgetDecision, string> = { aprovar: 'Aprovar integralmente', aprovar_parcial: 'Aprovar parcialmente', aprovar_condicoes: 'Aprovar com condições', rejeitar: 'Rejeitar', revisao: 'Solicitar revisão' };

// ------------------------------------------------------------------ quantidade × valor unitário
/** "1,5" ou "1.5" ou 2 → milésimos inteiros (1500). */
export function qtyToMilli(q: string | number): number {
  const s = String(q).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new Error('Quantidade inválida');
  const [i, d = ''] = s.split('.');
  return Number(i) * 1000 + Number(d.padEnd(3, '0'));
}
export const milliToQty = (m: number) => (m % 1000 === 0 ? String(m / 1000) : (m / 1000).toFixed(3).replace(/0+$/, '').replace('.', ','));
/** Total = quantidade × valor unitário, arredondado ao centavo (meio para cima), só com inteiros. */
export function totalCents(qtyMilli: number, unitCents: number): number {
  const p = BigInt(qtyMilli) * BigInt(unitCents);
  return Number((p + 500n) / 1000n);
}

// ------------------------------------------------------------------ números do lançamento
export type LineInput = {
  plannedCents: number; approvedCents: number | null; firstApprovedCents: number | null; limitCents: number | null;
  approvalState: ApprovalState; executionState: ExecutionState; contractedCents: number | null;
};
export type ExpenseInput = { amountCents: number; status: 'valido' | 'cancelado' };
export type PayableInput = { id: string; amountCents: number; dueOn: string; status: 'aberto' | 'cancelado' };
export type PaymentInput = { id?: string; reversesId?: string | null; payableId: string; amountCents: number; interestCents: number; fineCents: number; discountCents: number; paidOn: string; kind: 'pagamento' | 'estorno'; reconciled: boolean };

/** Teto da execução: o valor-limite, quando a aprovação definiu; senão o aprovado. */
export const ceilingOf = (l: Pick<LineInput, 'approvedCents' | 'limitCents'>) => (l.limitCents ?? l.approvedCents ?? 0);

export function lineFigures(l: LineInput, expenses: ExpenseInput[], payments: PaymentInput[] = []) {
  const approved = isApproved(l.approvalState) ? (l.approvedCents ?? 0) : 0;
  const committed = l.contractedCents ?? 0;
  const realized = expenses.filter((e) => e.status === 'valido').reduce((t, e) => t + e.amountCents, 0);
  const paid = payments.reduce((t, p) => t + (p.kind === 'estorno' ? -p.amountCents : p.amountCents), 0);
  const charges = payments.reduce((t, p) => t + (p.kind === 'estorno' ? -(p.interestCents + p.fineCents) : p.interestCents + p.fineCents), 0);
  const consumption = Math.max(committed, realized);
  const closed = l.executionState === 'encerrado';
  const reserved = approved && !closed ? Math.max(0, approved - consumption) : 0;
  const balance = approved - consumption;
  const deviation = approved ? realized - approved : null;
  const deviationPct = approved ? Math.round(((realized - approved) / approved) * 1000) / 10 : null;
  const economy = approved && (closed || committed) ? Math.max(0, approved - consumption) : 0;
  const excess = Math.max(0, consumption - ceilingOf({ approvedCents: approved || null, limitCents: l.limitCents }));
  const pending = ['enviado', 'em_analise', 'questionado'].includes(l.approvalState) ? l.plannedCents : 0;
  return { planned: l.plannedCents, original: l.firstApprovedCents ?? 0, approved, reserved, committed, realized, paid, charges, consumption, balance, deviation, deviationPct, economy, excess, pending };
}
export type LineFigures = ReturnType<typeof lineFigures>;

/** Projeção de encerramento do lançamento: o que já foi consumido, e, se ainda está aberto, o aprovado inteiro. */
export const lineProjection = (f: LineFigures, executionState: ExecutionState) => (executionState === 'encerrado' ? f.consumption : Math.max(f.approved, f.consumption));

/** Consolida os indicadores executivos (área superior da tela). Os gastos sem lançamento entram no realizado e no consumo. */
export function consolidateBudget(rows: { f: LineFigures; executionState: ExecutionState; sent: boolean }[], extra: { unlinkedRealizedCents: number; guardianApprovedCents: number; guardianPendingCents: number; guardianReserveCents: number | null; guardianUsedCents: number }) {
  const sum = (k: keyof LineFigures) => rows.reduce((t, r) => t + (Number(r.f[k]) || 0), 0);
  const approved = sum('approved');
  const consumption = sum('consumption') + extra.unlinkedRealizedCents;
  const reserved = sum('reserved');
  const authorized = approved + extra.guardianApprovedCents;
  return {
    original: sum('original'),
    revised: authorized,
    approved,
    requested: rows.filter((r) => r.sent).reduce((t, r) => t + r.f.planned, 0),
    reserved,
    committed: sum('committed'),
    realized: sum('realized') + extra.unlinkedRealizedCents,
    paid: sum('paid'),
    charges: sum('charges'),
    available: authorized - consumption - reserved,
    awaiting: sum('pending') + extra.guardianPendingCents,
    excessAuthorized: extra.guardianApprovedCents,
    guardianBalance: extra.guardianReserveCents === null ? null : extra.guardianReserveCents - extra.guardianUsedCents,
    projection: rows.reduce((t, r) => t + lineProjection(r.f, r.executionState), 0) + extra.unlinkedRealizedCents,
    economy: sum('economy'),
    excess: sum('excess'),
  };
}

// ------------------------------------------------------------------ situação do pagamento (9.1)
export const PAYMENT_FLAGS = ['sem_titulo', 'a_vencer', 'vencido', 'pago_antecipado', 'pago_em_dia', 'pago_atraso', 'pago_com_juros', 'parcial', 'pago', 'conciliado', 'cancelado', 'estornado'] as const;
export type PaymentFlag = (typeof PAYMENT_FLAGS)[number];
export const PAYMENT_FLAG_LABELS: Record<PaymentFlag, string> = {
  sem_titulo: 'Sem título', a_vencer: 'A vencer', vencido: 'Vencido', pago_antecipado: 'Pago antecipadamente', pago_em_dia: 'Pago em dia', pago_atraso: 'Pago em atraso',
  pago_com_juros: 'Pago com juros/multa', parcial: 'Pago parcialmente', pago: 'Pago', conciliado: 'Conciliado', cancelado: 'Cancelado', estornado: 'Estornado',
};

/** Situação de um título (parcela): combinações possíveis, ex.: pago em atraso + com juros. */
export function payableSituation(p: PayableInput, pays: PaymentInput[], today: string): { flags: PaymentFlag[]; paidCents: number; openCents: number } {
  const mine = pays.filter((x) => x.payableId === p.id);
  const sign = (x: PaymentInput) => (x.kind === 'estorno' ? -1 : 1);
  const paidCents = mine.reduce((t, x) => t + sign(x) * x.amountCents, 0);
  const settled = mine.reduce((t, x) => t + sign(x) * (x.amountCents + x.discountCents), 0);
  const openCents = Math.max(0, p.amountCents - settled);
  if (p.status === 'cancelado') return { flags: ['cancelado'], paidCents, openCents: 0 };
  const flags: PaymentFlag[] = [];
  if (mine.some((x) => x.kind === 'estorno')) flags.push('estornado');
  const reversed = new Set(mine.filter((x) => x.kind === 'estorno' && x.reversesId).map((x) => x.reversesId));
  const effective = mine.filter((x) => x.kind === 'pagamento' && !(x.id && reversed.has(x.id)));
  if (openCents === 0 && settled > 0) {
    const last = effective.map((x) => x.paidOn).sort().at(-1)!;
    flags.push('pago', last < p.dueOn ? 'pago_antecipado' : last === p.dueOn ? 'pago_em_dia' : 'pago_atraso');
    if (effective.length && effective.every((x) => x.reconciled)) flags.push('conciliado');
  } else {
    if (paidCents > 0) flags.push('parcial');
    flags.push(p.dueOn < today ? 'vencido' : 'a_vencer');
  }
  if (effective.some((x) => x.interestCents + x.fineCents > 0)) flags.push('pago_com_juros');
  return { flags, paidCents, openCents };
}

/** Situação financeira resumida do lançamento (a pior das parcelas manda). */
export function lineFinancial(payables: PayableInput[], pays: PaymentInput[], today: string): PaymentFlag {
  const live = payables.filter((p) => p.status !== 'cancelado');
  if (!live.length) return payables.length ? 'cancelado' : 'sem_titulo';
  const sits = live.map((p) => payableSituation(p, pays, today));
  if (sits.some((s) => s.flags.includes('vencido'))) return 'vencido';
  if (sits.every((s) => s.flags.includes('conciliado'))) return 'conciliado';
  if (sits.every((s) => s.flags.includes('pago'))) return 'pago';
  if (sits.some((s) => s.paidCents > 0)) return 'parcial';
  return 'a_vencer';
}

/** Divide um título em parcelas iguais (a diferença de centavos vai na última) com vencimentos mensais. */
export function splitInstallments(totalCents: number, n: number, firstDue: string) {
  const base = Math.floor(totalCents / n);
  const [y, m, d] = firstDue.split('-').map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, i) => {
    const mm = m - 1 + i, yy = y + Math.floor(mm / 12), mon = (mm % 12) + 1;
    const last = new Date(Date.UTC(yy, mon, 0)).getUTCDate();
    return { n: i + 1, amountCents: i === n - 1 ? totalCents - base * (n - 1) : base, dueOn: `${yy}-${String(mon).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}` };
  });
}

// ------------------------------------------------------------------ decisões
export type BudgetDecisionInput = { decision: BudgetDecision; requestedCents: number; requestedQtyMilli: number; approvedQtyMilli?: number | null; approvedCents?: number | null; targetUnitCents?: number | null; limitCents?: number | null; conditions?: string | null; note?: string | null };
/** Confere a decisão e devolve o que gravar. Erros em português, campo a campo. */
export function decisionOutcome(d: BudgetDecisionInput): { ok: true; state: ApprovalState; approvedCents: number | null; approvedQtyMilli: number | null; limitCents: number | null; targetUnitCents: number | null } | { ok: false; errors: { path: string; message: string }[] } {
  const errors: { path: string; message: string }[] = [];
  if ((d.decision === 'rejeitar' || d.decision === 'revisao' || d.decision === 'aprovar_parcial') && !d.note?.trim()) errors.push({ path: 'note', message: 'Explique a decisão para o responsável' });
  if (d.decision === 'aprovar_condicoes' && !d.conditions?.trim()) errors.push({ path: 'conditions', message: 'Descreva as condições da aprovação' });
  if (d.decision === 'rejeitar' || d.decision === 'revisao') return errors.length ? { ok: false, errors } : { ok: true, state: d.decision === 'rejeitar' ? 'rejeitado' : 'em_revisao', approvedCents: null, approvedQtyMilli: null, limitCents: null, targetUnitCents: null };
  const approvedCents = d.decision === 'aprovar_parcial' ? (d.approvedCents ?? null) : (d.approvedCents ?? d.requestedCents);
  if (approvedCents === null || approvedCents <= 0) errors.push({ path: 'approvedCents', message: 'Informe o valor aprovado' });
  else if (approvedCents > d.requestedCents) errors.push({ path: 'approvedCents', message: 'O aprovado não pode passar do valor pedido; para dar mais, use o Budget Guardião' });
  else if (d.decision === 'aprovar_parcial' && approvedCents === d.requestedCents && (d.approvedQtyMilli ?? d.requestedQtyMilli) === d.requestedQtyMilli) errors.push({ path: 'approvedCents', message: 'Na aprovação parcial, aprove menos que o pedido' });
  const qty = d.approvedQtyMilli ?? d.requestedQtyMilli;
  if (qty <= 0 || qty > d.requestedQtyMilli) errors.push({ path: 'approvedQtyMilli', message: 'A quantidade aprovada precisa ser maior que zero e até a pedida' });
  const limit = d.limitCents ?? null;
  if (limit !== null && approvedCents !== null && limit > approvedCents) errors.push({ path: 'limitCents', message: 'O valor-limite não pode passar do valor aprovado' });
  if (limit !== null && limit <= 0) errors.push({ path: 'limitCents', message: 'Valor-limite inválido' });
  const target = d.targetUnitCents ?? null;
  if (target !== null && qty && approvedCents !== null && totalCents(qty, target) > (limit ?? approvedCents)) errors.push({ path: 'targetUnitCents', message: 'O valor-alvo × quantidade passa do limite autorizado' });
  if (errors.length) return { ok: false, errors };
  const withConditions = d.decision === 'aprovar_condicoes' || !!d.conditions?.trim() || target !== null || limit !== null;
  return { ok: true, state: withConditions ? 'aprovado_ressalvas' : 'aprovado', approvedCents, approvedQtyMilli: qty, limitCents: limit, targetUnitCents: target };
}

/** Execução acima do teto autorizado exige nova aprovação (ou Budget Guardião). */
export function executionCheck(l: Pick<LineInput, 'approvedCents' | 'limitCents' | 'approvalState'>, newConsumptionCents: number) {
  if (!isApproved(l.approvalState)) return { ok: false as const, message: 'O lançamento ainda não foi aprovado.', overCents: newConsumptionCents };
  const ceiling = ceilingOf(l);
  return newConsumptionCents <= ceiling ? { ok: true as const, overCents: 0 } : { ok: false as const, message: 'Passa do valor autorizado: peça nova aprovação ou o Budget Guardião.', overCents: newConsumptionCents - ceiling };
}

/** Alerta e bloqueio do centro de custo pela política (percentuais configurados; sem valor, não alerta). */
export function costCenterAlert(authorizedCents: number, consumedCents: number, policy: { alertPct: number | null; blockPct: number | null }) {
  if (authorizedCents <= 0) return consumedCents > 0 ? 'bloqueio' : null;
  const pct = (consumedCents / authorizedCents) * 100;
  if (policy.blockPct !== null && pct >= policy.blockPct) return 'bloqueio';
  if (policy.alertPct !== null && pct >= policy.alertPct) return 'alerta';
  return null;
}
