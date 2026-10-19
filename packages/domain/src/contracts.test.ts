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
