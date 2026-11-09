import { describe, expect, it } from 'vitest';
import { certificateCredits, certificateRawPoints, certificateSettingsErrors, DEFAULT_CERTIFICATE_SETTINGS as D } from './certificates';

describe('certificados de cursos', () => {
  it('fixo + por hora até o limite', () => {
    expect(certificateRawPoints(8, D)).toBe(14); // 10 + 8 × 0,5
    expect(certificateRawPoints(200, D)).toBe(30); // horas limitadas a 40
  });
  it('teto mensal por pessoa, mês da validação', () => {
    const c = certificateCredits([
      { id: 'a', userId: 'u', hours: 40, approvedOn: '2026-11-03' },
      { id: 'b', userId: 'u', hours: 40, approvedOn: '2026-11-10' },
      { id: 'c', userId: 'u', hours: 40, approvedOn: '2026-12-01' },
      { id: 'd', userId: 'v', hours: 0, approvedOn: '2026-11-10' },
    ], D);
    expect(c.map((x) => [x.certificateId, x.points, x.capped])).toEqual([['a', 30, false], ['b', 10, true], ['d', 10, false], ['c', 30, false]]);
  });
  it('validação da regra', () => {
    expect(certificateSettingsErrors({ ...D, pointsPerCertificate: -1 })).toHaveLength(1);
    expect(certificateSettingsErrors(undefined)).toEqual([]);
  });
});
