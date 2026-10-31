import { describe, expect, it } from 'vitest';
import { distanceM, fmtMeters, insideRing, nearestPoint, pathLengthM, routeTicketText, validLatLng, type LatLng } from './geo';

describe('viabilidade técnica — geometria', () => {
  it('mede distância em metros (1 grau de latitude ≈ 111 km)', () => {
    expect(distanceM([0, 0], [1, 0])).toBeGreaterThan(111_000);
    expect(distanceM([0, 0], [1, 0])).toBeLessThan(111_400);
    expect(distanceM([-10.9, -37.05], [-10.9, -37.05])).toBe(0);
  });
  it('soma os trechos do traçado', () => {
    const p: LatLng[] = [[-10.9, -37.05], [-10.9009, -37.05], [-10.9009, -37.0509]];
    const total = pathLengthM(p);
    expect(total).toBeCloseTo(distanceM(p[0]!, p[1]!) + distanceM(p[1]!, p[2]!), 6);
    expect(total).toBeGreaterThan(190);
    expect(total).toBeLessThan(205);
    expect(pathLengthM([[0, 0]])).toBe(0);
  });
  it('acha a CTO mais próxima dentro do raio', () => {
    const ctos = [{ name: 'CTO-01', at: [-10.9, -37.05] as LatLng }, { name: 'CTO-02', at: [-10.91, -37.05] as LatLng }];
    expect(nearestPoint(ctos, [-10.9001, -37.05], 50)?.point.name).toBe('CTO-01');
    expect(nearestPoint(ctos, [-10.95, -37.05], 50)).toBeNull();
  });
  it('sabe se o cliente está dentro da área de cobertura', () => {
    const ring: LatLng[] = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(insideRing([0.5, 0.5], ring)).toBe(true);
    expect(insideRing([1.5, 0.5], ring)).toBe(false);
  });
  it('valida coordenadas e formata metragem', () => {
    expect(validLatLng([-10.9, -37.05])).toBe(true);
    expect(validLatLng([100, 0])).toBe(false);
    expect(validLatLng(['a', 0])).toBe(false);
    expect(fmtMeters(182.4)).toBe('182 m');
    expect(fmtMeters(1240)).toBe('1,24 km');
  });
  it('monta o texto do chamado com metragem, porta e localização', () => {
    const t = routeTicketText({ code: 42, client: 'Maria', address: 'Rua A, 10', clientAt: [-10.9, -37.05], ctoName: 'CTO-07', ctoAt: [-10.901, -37.05], port: '4', lengthM: 150, slackM: 20, notes: null, vertices: 3 });
    expect(t).toContain('OP-42 · Maria');
    expect(t).toContain('CTO de origem: CTO-07');
    expect(t).toContain('Porta: 4');
    expect(t).toContain('Total estimado de cabo: 170 m');
    expect(t).toContain('google.com/maps?q=-10.900000,-37.050000');
  });
});
