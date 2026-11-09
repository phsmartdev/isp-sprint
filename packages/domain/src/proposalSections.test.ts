import { describe, expect, it } from 'vitest';
import { investmentTable, layoutPhotos, normalizeSections, photoRows, validityDate } from './proposalSections';

describe('seções automáticas da proposta', () => {
  it('fotos por linha: sem foto sozinha no fim quando dá', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(photoRows)).toEqual([[1], [2], [3], [2, 2], [3, 2], [3, 3], [3, 2, 2], [3, 3, 2]]);
  });
  it('grade justificada: ocupa a largura, mesma altura na linha, proporção mantida, limite de altura', () => {
    const l = layoutPhotos([1.5, 0.75], 500, 10, 1000);
    const [a, b] = l.boxes;
    expect(a!.h).toBeCloseTo(b!.h);
    expect(a!.w + b!.w + 10).toBeCloseTo(500);
    expect(a!.w / a!.h).toBeCloseTo(1.5);
    const tall = layoutPhotos([0.6], 500, 10, 300);
    expect(tall.boxes[0]!.h).toBe(300);
    expect(tall.boxes[0]!.x).toBeCloseTo((500 - 180) / 2);
    expect(layoutPhotos([1, 1, 1, 1], 400, 0, 1000).rows.map((r) => r.indexes.length)).toEqual([2, 2]);
  });
  it('tabela de investimento com desconto e total', () => {
    const t = investmentTable([{ description: 'Fusão óptica', unit: 'un', qtyMilli: 10_000, unitCents: 7_000, discountCents: 1_000, surchargeCents: 0 }, { description: 'Hora técnica', unit: 'h', qtyMilli: 2_500, unitCents: 10_000, discountCents: 0, surchargeCents: 0 }]);
    expect(t.rows[0]).toEqual(['1', 'Fusão óptica', 'Und', '10', 'R$ 70,00', 'R$ 690,00']);
    expect(t.rows[1]![3]).toBe('2,5');
    expect(t.total).toBe('R$ 940,00');
  });
  it('configuração e validade', () => {
    expect(normalizeSections({ enabled: true, validityDays: 0 }).validityDays).toBe(15);
    expect(validityDate('2026-11-20', 15)).toBe('2026-12-05');
  });
});
