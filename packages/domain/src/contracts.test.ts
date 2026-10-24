import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTRACT_SETTINGS as C, adjustedCents, documentName, dueAlerts, endFromTerm, fillSubject, nextAnniversary, type AlertInput } from './contracts';

const base: AlertInput = { today: '2026-10-19', stage: 'vigente', endAt: null, closureExpected: false, closureAt: null, guaranteeExpiresAt: null, adjustmentBaseDate: null, signedAt: '2025-01-10', activationAt: '2025-02-01', validatedAt: null, hasSignedContractDoc: true, provisioningDone: true, openSignatureSince: null };
const kinds = (i: Partial<AlertInput>) => dueAlerts({ ...base, ...i }, C).map((a) => a.kind);

describe('contratos', () => {
  it('nome padrão do documento', () => {
    expect(documentName('2026-10-19', 'ADITIVO', 'Prefeitura de Aracaju', 'Link dedicado 1 Gbps')).toBe('261019 - ADITIVO - PREFEITURA DE ARACAJU - LINK DEDICADO 1 GBPS');
    expect(documentName('2026-01-05', 'contrato', 'A/B: Ltda', 'x')).toBe('260105 - CONTRATO - A B LTDA - X');
  });
  it('término pelo prazo e próximo aniversário', () => {
    expect(endFromTerm('2025-01-10', 12)).toBe('2026-01-09');
    expect(endFromTerm('2024-01-31', 1)).toBe('2024-02-28');
    expect(nextAnniversary('2024-03-15', '2026-10-19')).toBe('2027-03-15');
    expect(nextAnniversary('2024-11-01', '2026-10-19')).toBe('2026-11-01');
  });
  it('reajuste em centavos', () => {
    expect(adjustedCents(100_000, 4.5)).toBe(104_500);
    expect(adjustedCents(99_990, 3.33)).toBe(103_320);
  });
  it('renovação só a partir de 60 dias do término, com ciclo pela data de término', () => {
    expect(kinds({ endAt: '2026-12-19' })).toEqual([]);
    const a = dueAlerts({ ...base, endAt: '2026-12-18' }, C);
    expect(a).toEqual([{ kind: 'renovacao', cycleKey: '2026-12-18', dueAt: '2026-12-18' }]);
    expect(kinds({ endAt: '2026-12-01', closureExpected: true })).toEqual(['encerramento_90']);
    expect(kinds({ endAt: '2026-11-15', closureExpected: true })).toEqual(['encerramento_90', 'encerramento_30']);
    expect(kinds({ endAt: '2026-11-15', stage: 'arquivado' })).toEqual([]);
  });
  it('garantia, reajuste, provisionamento, implantação e documento pendente', () => {
    expect(kinds({ guaranteeExpiresAt: '2026-11-10' })).toEqual(['garantia']);
    expect(kinds({ adjustmentBaseDate: '2025-11-10' })).toEqual(['reajuste']);
    expect(kinds({ adjustmentBaseDate: '2026-11-10' })).toEqual([]);
    expect(kinds({ validatedAt: '2026-10-01T10:00:00Z', provisioningDone: false, activationAt: null, hasSignedContractDoc: false })).toEqual(['provisionamento', 'documento_pendente']);
    expect(kinds({ validatedAt: '2026-09-01T10:00:00Z', activationAt: null })).toEqual(['implantacao']);
    expect(kinds({ openSignatureSince: '2026-10-01' })).toEqual(['assinatura']);
  });
  it('assunto com número e cliente', () => {
    expect(fillSubject(C.renewalSubject, '12/2024', 'Prefeitura X')).toBe('Ofício de Renovação Contratual – Contrato 12/2024 – Cliente Prefeitura X');
  });
});

import { ledgerTotals, recurringBilledInPeriod } from './contracts';
describe('tipos e extrato', () => {
  it('saldo de medição', () => {
    expect(ledgerTotals([{ kind: 'credito', amountCents: 100_000 }, { kind: 'consumo', amountCents: 30_000 }, { kind: 'estorno', amountCents: 10_000 }, { kind: 'faturamento', amountCents: 5_000 }])).toEqual({ credited: 100_000, consumed: 20_000, billed: 5_000, available: 80_000, usedShare: 0.2 });
  });
  it('recorrente fatura pelos meses ativos no período', () => {
    expect(recurringBilledInPeriod(1000, '2026-02-15', '2026-12-31', '2026-01-01', '2026-03-31')).toBe(2000);
    expect(recurringBilledInPeriod(1000, '2025-01-01', '2026-01-31', '2026-01-01', '2026-03-31')).toBe(1000);
    expect(recurringBilledInPeriod(1000, null, null, '2026-01-01', '2026-03-31')).toBe(0);
  });
});

import { commitmentBalances, consumptionIndicator, dueAlerts as dueAlerts2, monthlyConsumption, DEFAULT_CONTRACT_SETTINGS as CS2 } from './contracts';
describe('consumo e empenho', () => {
  const base = { credited: 1_200_000, startAt: '2026-01-01', endAt: '2026-12-31', today: '2026-07-01' };
  it('ritmo: acelerado, lento, no ritmo; projeção de esgotamento e sobra no fim', () => {
    const fast = consumptionIndicator({ ...base, consumed: 900_000, monthly: [{ month: '2026-04', cents: 150_000 }, { month: '2026-05', cents: 150_000 }, { month: '2026-06', cents: 150_000 }] });
    expect(fast.pace).toBe('acelerado');
    expect(fast.exhaustAt).toBe('2026-08-31');
    expect(fast.exhaustBeforeEnd).toBe(true);
    const slow = consumptionIndicator({ ...base, consumed: 100_000, monthly: [{ month: '2026-06', cents: 20_000 }] });
    expect(slow.pace).toBe('lento');
    expect(slow.unusedAtEndCents).toBeGreaterThan(900_000);
    const ok = consumptionIndicator({ ...base, consumed: 600_000, monthly: [{ month: '2026-06', cents: 100_000 }] });
    expect(ok.pace).toBe('no_ritmo');
    expect(consumptionIndicator({ ...base, consumed: 1_200_000, monthly: [] }).pace).toBe('esgotado');
    expect(consumptionIndicator({ ...base, consumed: 1_100_000, monthly: [] }).lowBalance).toBe(true);
  });
  it('consumo mensal líquido; saldo de empenho; alertas por mês e por empenho', () => {
    expect(monthlyConsumption([{ kind: 'consumo', amountCents: 100, occurredOn: '2026-05-03' }, { kind: 'estorno', amountCents: 30, occurredOn: '2026-05-20' }, { kind: 'credito', amountCents: 999, occurredOn: '2026-05-01' }])).toEqual([{ month: '2026-05', cents: 70 }]);
    const b = commitmentBalances([{ id: 'e1', amountCents: 1000, cancelled: false }, { id: 'e2', amountCents: 500, cancelled: true }], [{ commitmentId: 'e1', kind: 'consumo', amountCents: 900 }, { commitmentId: 'e1', kind: 'estorno', amountCents: 50 }]);
    expect(b).toEqual([{ id: 'e1', used: 850, available: 150, share: 0.85 }, { id: 'e2', used: 0, available: 0, share: 0 }]);
    const input = { today: '2026-07-01', stage: 'vigente' as const, endAt: '2026-12-31', closureExpected: false, closureAt: null, guaranteeExpiresAt: null, adjustmentBaseDate: null, signedAt: null, activationAt: null, validatedAt: null, hasSignedContractDoc: true, provisioningDone: true, openSignatureSince: null };
    const k = consumptionIndicator({ ...base, consumed: 900_000, monthly: [{ month: '2026-06', cents: 150_000 }] });
    const kinds = dueAlerts2({ ...input, consumption: k, isPublic: true, commitments: [{ id: 'e1', number: '2026NE1', share: 0.85, available: 150 }] }, CS2).map((a) => `${a.kind}:${a.cycleKey}`);
    expect(kinds).toEqual(expect.arrayContaining(['consumo_acelerado:2026-07', 'esgotamento:2026-08', 'empenho_baixo:e1']));
    expect(dueAlerts2({ ...input, isPublic: true, commitments: [] }, CS2).map((a) => a.kind)).toContain('sem_empenho');
  });
});

import { docStatus } from './contracts';
describe('habilitação', () => {
  it('situação pela validade: 30/15/7 dias e vencida (o último dia ainda vale)', () => {
    expect(docStatus(null, '2026-10-24')).toEqual({ status: 'falta', days: null });
    expect(docStatus('2026-12-31', '2026-10-24').status).toBe('valida');
    expect(docStatus('2026-11-20', '2026-10-24').status).toBe('vence_30');
    expect(docStatus('2026-11-05', '2026-10-24').status).toBe('vence_15');
    expect(docStatus('2026-10-24', '2026-10-24')).toEqual({ status: 'vence_7', days: 0 });
    expect(docStatus('2026-10-23', '2026-10-24')).toEqual({ status: 'vencida', days: -1 });
  });
});

import { accumulatedPct, adjustmentWindow, amendmentError, amendmentLimits, indexCodeOf, originalValue } from './contracts';
describe('aditivos e reajuste', () => {
  it('limite legal: acréscimos e supressões separados; 25% ou 50% em reforma; supressão acima só com acordo', () => {
    const base = originalValue({ totalCents: null, monthlyCents: 100_000, termMonths: 12 });
    expect(base).toBe(1_200_000);
    const l = amendmentLimits(base, [{ kind: 'acrescimo', valueDeltaCents: 200_000 }, { kind: 'supressao', valueDeltaCents: -100_000 }]);
    expect(l.acrescimo).toMatchObject({ cents: 200_000, remainingCents: 100_000 });
    expect(l.supressao).toMatchObject({ cents: 100_000, remainingCents: 200_000 });
    expect(amendmentError(true, l, { kind: 'acrescimo', valueDeltaCents: 150_000 })).toMatch(/limite legal de acréscimo \(25%/);
    expect(amendmentError(true, l, { kind: 'acrescimo', valueDeltaCents: 100_000 })).toBeNull();
    expect(amendmentError(false, l, { kind: 'acrescimo', valueDeltaCents: 9_999_999 })).toBeNull();
    expect(amendmentError(true, l, { kind: 'supressao', valueDeltaCents: 300_000 })).toMatch(/acordo/);
    expect(amendmentError(true, l, { kind: 'supressao', valueDeltaCents: 300_000, acordo: true })).toBeNull();
    expect(amendmentLimits(base, [], true).acrescimo.remainingCents).toBe(600_000);
  });
  it('índice pelo nome, janela de 12 meses antes do aniversário e acumulado', () => {
    expect(indexCodeOf('IPCA/IBGE')).toEqual({ key: 'IPCA', code: 433 });
    expect(indexCodeOf('igp-m (FGV)')).toEqual({ key: 'IGP-M', code: 189 });
    expect(indexCodeOf('IST')).toBeNull();
    expect(adjustmentWindow('2026-03-10')).toEqual({ from: '2025-03-01', to: '2026-02-01' });
    expect(accumulatedPct([0.5, 0.5])).toBe(1.0025);
    expect(accumulatedPct(Array(12).fill(0.4))).toBe(4.9070);
  });
});
