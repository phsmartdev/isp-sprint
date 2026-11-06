import { describe, expect, it } from 'vitest';
import { bidItemGap, bidItemResultError, winnerUnit } from './bidItemResults';

describe('resultado por item da licitação', () => {
  it('valida vencedora e valores', () => {
    expect(bidItemResultError({ finalUnitCents: 1000, winnerIsUs: false, winnerCompany: 'Rede Alfa', winnerUnitCents: 900 })).toBeNull();
    expect(bidItemResultError({ finalUnitCents: 1000, winnerIsUs: true, winnerCompany: null, winnerUnitCents: null })).toBeNull();
    expect(bidItemResultError({ finalUnitCents: 1000, winnerIsUs: true, winnerCompany: 'Rede Alfa', winnerUnitCents: null })).toMatch(/não os dois/);
    expect(bidItemResultError({ finalUnitCents: null, winnerIsUs: false, winnerCompany: '', winnerUnitCents: 900 })).toMatch(/empresa vencedora/);
    expect(bidItemResultError({ finalUnitCents: -1, winnerIsUs: false, winnerCompany: null, winnerUnitCents: null })).toMatch(/inválido/);
  });
  it('diferença usa o final (ou o lance) contra a vencedora', () => {
    expect(bidItemGap({ bidUnitCents: 1200, finalUnitCents: 1100 }, 1000)).toBeCloseTo(0.1, 10);
    expect(bidItemGap({ bidUnitCents: 1200, finalUnitCents: null }, 1000)).toBeCloseTo(0.2, 10);
    expect(bidItemGap({ bidUnitCents: null, finalUnitCents: null }, 1000)).toBeNull();
    expect(bidItemGap({ bidUnitCents: 1000, finalUnitCents: null }, null)).toBeNull();
    expect(winnerUnit({ finalUnitCents: 950, winnerIsUs: true, winnerCompany: null, winnerUnitCents: null })).toBe(950);
  });
});
