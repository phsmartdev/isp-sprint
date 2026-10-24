import { describe, expect, it } from 'vitest';
import { allowedDowntimeHours, certificateDue, clauseAlertOn, slaStatus } from './execution';

describe('execução do contrato', () => {
  it('SLA: sentido por métrica e horas permitidas de indisponibilidade', () => {
    expect(slaStatus('maior', 99.5, 99.7)).toBe('cumprido');
    expect(slaStatus('maior', 99.5, 99.2)).toBe('violado');
    expect(slaStatus('menor', 4, 6)).toBe('violado');
    expect(slaStatus('menor', 4, null)).toBe('sem_medicao');
    expect(allowedDowntimeHours(99.5)).toBe(3.6);
  });
  it('atestado: a partir da metade da vigência, até ser recebido', () => {
    const c = { startAt: '2026-01-01', endAt: '2026-12-31', hasReceived: false, hasRequested: false };
    expect(certificateDue(c, '2026-05-01')).toBeNull();
    expect(certificateDue(c, '2026-07-10')).toMatchObject({ stage: 'meio', requested: false });
    expect(certificateDue(c, '2026-12-15')).toMatchObject({ stage: 'fim' });
    expect(certificateDue({ ...c, hasReceived: true }, '2026-12-15')).toBeNull();
    expect(clauseAlertOn('2026-11-30', 15)).toBe('2026-11-15');
  });
});
