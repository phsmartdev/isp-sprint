import { describe, expect, it } from 'vitest';
import { consolidateBudget, costCenterAlert, decisionOutcome, executionCheck, lineFigures, lineFinancial, payableSituation, qtyToMilli, splitInstallments, totalCents, type LineInput } from './budgetLedger';

const L = (o: Partial<LineInput> = {}): LineInput => ({ plannedCents: 20_000_00, approvedCents: 18_000_00, firstApprovedCents: 18_000_00, limitCents: null, approvalState: 'aprovado', executionState: 'nao_iniciada', contractedCents: null, ...o });

describe('quantidade e valor', () => {
  it('quantidade decimal sem ponto flutuante', () => {
    expect(qtyToMilli('1,5')).toBe(1500);
    expect(qtyToMilli(500)).toBe(500_000);
    expect(() => qtyToMilli('1,2345')).toThrow();
    expect(totalCents(qtyToMilli(500), 40_00)).toBe(20_000_00);
    expect(totalCents(qtyToMilli('0,333'), 1_00)).toBe(33); // 33,3 → 33
    expect(totalCents(qtyToMilli('0,335'), 1_00)).toBe(34); // 33,5 → 34 (meio para cima)
  });
});

describe('números do lançamento', () => {
  it('comprometido e realizado não se somam (estágios da mesma obrigação)', () => {
    const f = lineFigures(L({ contractedCents: 17_500_00, executionState: 'em_execucao' }), [{ amountCents: 10_000_00, status: 'valido' }, { amountCents: 999_00, status: 'cancelado' }]);
    expect(f.committed).toBe(17_500_00);
    expect(f.realized).toBe(10_000_00);
    expect(f.consumption).toBe(17_500_00);
    expect(f.reserved).toBe(500_00);
    expect(f.balance).toBe(500_00);
    expect(f.economy).toBe(500_00);
    expect(f.deviation).toBe(-8_000_00);
  });
  it('não aprovado não conta como aprovado; pendente aparece como aguardando', () => {
    const f = lineFigures(L({ approvalState: 'questionado', approvedCents: null, firstApprovedCents: null }), []);
    expect(f.approved).toBe(0);
    expect(f.pending).toBe(20_000_00);
    expect(f.deviationPct).toBeNull();
  });
  it('encerrado libera a reserva e o pago desconta estornos; juros ficam à parte', () => {
    const f = lineFigures(L({ executionState: 'encerrado' }), [{ amountCents: 16_000_00, status: 'valido' }], [
      { payableId: 'a', amountCents: 16_000_00, interestCents: 50_00, fineCents: 20_00, discountCents: 0, paidOn: '2026-10-10', kind: 'pagamento', reconciled: false },
      { payableId: 'a', amountCents: 1_000_00, interestCents: 0, fineCents: 0, discountCents: 0, paidOn: '2026-10-11', kind: 'estorno', reconciled: false },
    ]);
    expect(f.reserved).toBe(0);
    expect(f.paid).toBe(15_000_00);
    expect(f.charges).toBe(70_00);
    expect(f.economy).toBe(2_000_00);
  });
  it('consolidação: saldo disponível sem dupla contagem', () => {
    const a = lineFigures(L({ contractedCents: 10_000_00 }), [{ amountCents: 4_000_00, status: 'valido' }]);
    const b = lineFigures(L({ approvalState: 'enviado', approvedCents: null, firstApprovedCents: null }), []);
    const k = consolidateBudget([{ f: a, executionState: 'em_execucao', sent: true }, { f: b, executionState: 'nao_iniciada', sent: true }], { unlinkedRealizedCents: 500_00, guardianApprovedCents: 1_000_00, guardianPendingCents: 300_00, guardianReserveCents: 5_000_00, guardianUsedCents: 1_000_00 });
    expect(k.approved).toBe(18_000_00);
    expect(k.revised).toBe(19_000_00);
    expect(k.committed).toBe(10_000_00);
    expect(k.realized).toBe(4_500_00);
    expect(k.reserved).toBe(8_000_00);
    expect(k.available).toBe(19_000_00 - 10_500_00 - 8_000_00);
    expect(k.awaiting).toBe(20_300_00);
    expect(k.guardianBalance).toBe(4_000_00);
    expect(k.projection).toBe(18_000_00 + 20_000_00 * 0 + 500_00);
  });
});

describe('decisão da diretoria', () => {
  const base = { requestedCents: 20_000_00, requestedQtyMilli: 500_000 };
  it('exemplo do prompt: 500 × R$ 40, alvo R$ 35, limite R$ 18.000 com condição', () => {
    const r = decisionOutcome({ ...base, decision: 'aprovar_condicoes', approvedCents: 18_000_00, targetUnitCents: 35_00, limitCents: 18_000_00, conditions: 'Negociar com o fornecedor e preservar a qualidade' });
    expect(r).toMatchObject({ ok: true, state: 'aprovado_ressalvas', approvedCents: 18_000_00, limitCents: 18_000_00, targetUnitCents: 35_00 });
  });
  it('recusa aprovado acima do pedido, limite acima do aprovado e parcial sem motivo', () => {
    expect(decisionOutcome({ ...base, decision: 'aprovar', approvedCents: 21_000_00 }).ok).toBe(false);
    expect(decisionOutcome({ ...base, decision: 'aprovar', limitCents: 25_000_00 }).ok).toBe(false);
    expect(decisionOutcome({ ...base, decision: 'aprovar_parcial', approvedCents: 10_000_00 }).ok).toBe(false);
    expect(decisionOutcome({ ...base, decision: 'rejeitar' }).ok).toBe(false);
    expect(decisionOutcome({ ...base, decision: 'aprovar' })).toMatchObject({ ok: true, state: 'aprovado', approvedCents: 20_000_00 });
  });
  it('execução acima do limite exige nova aprovação', () => {
    expect(executionCheck({ approvalState: 'aprovado_ressalvas', approvedCents: 18_000_00, limitCents: 17_000_00 }, 17_500_00).ok).toBe(false);
    expect(executionCheck({ approvalState: 'aprovado', approvedCents: 18_000_00, limitCents: null }, 18_000_00).ok).toBe(true);
    expect(executionCheck({ approvalState: 'enviado', approvedCents: null, limitCents: null }, 1).ok).toBe(false);
  });
});

describe('pagamentos', () => {
  const p = { id: 'a', amountCents: 1_000_00, dueOn: '2026-10-10', status: 'aberto' as const };
  const pay = (o: object) => ({ payableId: 'a', amountCents: 1_000_00, interestCents: 0, fineCents: 0, discountCents: 0, paidOn: '2026-10-10', kind: 'pagamento' as const, reconciled: false, ...o });
  it('a vencer, vencido, parcial', () => {
    expect(payableSituation(p, [], '2026-10-01').flags).toEqual(['a_vencer']);
    expect(payableSituation(p, [], '2026-10-11').flags).toEqual(['vencido']);
    expect(payableSituation(p, [pay({ amountCents: 400_00 })], '2026-10-11')).toMatchObject({ flags: ['parcial', 'vencido'], openCents: 600_00 });
  });
  it('pago em atraso com juros; antecipado com desconto; conciliado; estorno reabre', () => {
    expect(payableSituation(p, [pay({ paidOn: '2026-10-15', interestCents: 10_00, fineCents: 20_00 })], '2026-10-20').flags).toEqual(['pago', 'pago_atraso', 'pago_com_juros']);
    expect(payableSituation(p, [pay({ paidOn: '2026-10-01', amountCents: 950_00, discountCents: 50_00, reconciled: true })], '2026-10-20').flags).toEqual(['pago', 'pago_antecipado', 'conciliado']);
    const s = payableSituation(p, [pay({}), pay({ kind: 'estorno', paidOn: '2026-10-12' })], '2026-10-20');
    expect(s.flags).toEqual(['estornado', 'vencido']);
    expect(s.openCents).toBe(1_000_00);
    expect(lineFinancial([p], [pay({})], '2026-10-20')).toBe('pago');
    expect(lineFinancial([], [], '2026-10-20')).toBe('sem_titulo');
  });
  it('parcelas somam o total e caem no fim do mês curto', () => {
    const ps = splitInstallments(1_000_00, 3, '2026-01-31');
    expect(ps.map((x) => x.amountCents)).toEqual([333_33, 333_33, 333_34]);
    expect(ps.map((x) => x.dueOn)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('alerta e bloqueio só com percentuais configurados', () => {
    expect(costCenterAlert(100_00, 95_00, { alertPct: 90, blockPct: 100 })).toBe('alerta');
    expect(costCenterAlert(100_00, 100_00, { alertPct: 90, blockPct: 100 })).toBe('bloqueio');
    expect(costCenterAlert(100_00, 95_00, { alertPct: null, blockPct: null })).toBeNull();
  });
});
