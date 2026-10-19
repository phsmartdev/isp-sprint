import { describe, expect, it } from 'vitest';
import { computeViability, pickRoute, pickCommission, lifetime, type ViabilityParams } from './viability';

const params: ViabilityParams = {
  taxes: [
    { id: 't1', name: 'Simples', kind: 'percent', percentBp: 600, amountCents: 0, active: true },
    { id: 't2', name: 'Fust', kind: 'fixed', percentBp: 0, amountCents: 100, active: true },
    { id: 't3', name: 'Inativo', kind: 'percent', percentBp: 9999, amountCents: 0, active: false },
  ],
  partners: [
    { id: 'p1', name: 'Link', kind: 'percent', percentBp: 1000, amountCents: 0, active: true },
    { id: 'p2', name: 'Só rádio', kind: 'fixed', percentBp: 0, amountCents: 5000, active: true, routeIds: ['radio'] },
  ],
  equipments: [{ id: 'onu', name: 'ONU', costCents: 12000, active: true }, { id: 'rot', name: 'Roteador', costCents: 15000, active: true }],
  routes: [
    { id: 'ftth', name: 'FTTH condomínio', cablePerMeterCents: 150, installCostCents: 8000, monthlyCostCents: 0, requiresApproval: false, kit: [{ equipmentId: 'onu', qty: 1 }, { equipmentId: 'rot', qty: 1 }], active: true },
    { id: 'radio', name: 'Rádio', cablePerMeterCents: 0, installCostCents: 20000, monthlyCostCents: 1000, requiresApproval: true, kit: [{ equipmentId: 'rot', qty: 1 }], active: true },
  ],
  rules: [
    { id: 'r1', name: 'Longe e banda alta', position: 1, minMeters: 301, maxMeters: null, minMbps: 600, maxMbps: null, routeId: 'radio', active: true },
  ],
  defaultRouteId: 'ftth',
  commissionRules: [
    { id: 'c1', name: 'Ativa', position: 1, saleType: 'ativa', minPriceCents: null, maxPriceCents: null, kind: 'percent', percentBp: 8000, multiplierX100: 0, amountCents: 0, active: true },
    { id: 'c2', name: 'Receptiva até 150', position: 2, saleType: 'receptiva', minPriceCents: null, maxPriceCents: 15000, kind: 'fixo', percentBp: 0, multiplierX100: 0, amountCents: 4000, active: true },
    { id: 'c3', name: 'Receptiva acima', position: 3, saleType: 'receptiva', minPriceCents: 15001, maxPriceCents: null, kind: 'mensalidades', percentBp: 0, multiplierX100: 50, amountCents: 0, active: true },
  ],
  ltv: { lifetimeMonths: 24, monthlyChurnBp: null, minSample: 30 },
  maxPaybackMonths: 12,
};

describe('viabilidade', () => {
  it('escolhe o caminho pela regra de metragem e banda, senão o padrão', () => {
    expect(pickRoute(params, 400, 800).route?.id).toBe('radio');
    expect(pickRoute(params, 400, 500).route?.id).toBe('ftth');
    expect(pickRoute(params, 100, 900).route?.id).toBe('ftth');
  });

  it('comissão por % , valor fixo por faixa e nº de mensalidades', () => {
    expect(pickCommission(params.commissionRules, 'ativa', 10000)?.id).toBe('c1');
    expect(pickCommission(params.commissionRules, 'receptiva', 14990)?.id).toBe('c2');
    expect(pickCommission(params.commissionRules, 'receptiva', 16990)?.id).toBe('c3');
  });

  it('calcula margem, CAC, payback e LTV (FTTH, venda ativa)', () => {
    const r = computeViability({ priceCents: 10000, mbps: 500, cableMeters: 80, activationFeeCents: 5000, saleType: 'ativa', equipment: null, routeId: null }, params);
    // deduções: 6% (600) + 100 + 10% (1000) = 1700 → margem 8300
    expect(r.marginMonthlyCents).toBe(8300);
    // CAC: comissão 8000 + cabo 80×150=12000 + instalação 8000 + ONU 12000 + roteador 15000 − ativação 5000 = 50000
    expect(r.cacCents).toBe(50000);
    expect(r.paybackMonths).toBe(6);
    expect(r.ltv.dealCents).toBe(8300 * 24);
    expect(r.ltv.source).toBe('parametro');
    expect(r.complete).toBe(true);
    expect(r.alerts).toEqual([]);
  });

  it('parceiro de rota específica, custo mensal do caminho e alerta de aprovação', () => {
    const r = computeViability({ priceCents: 20000, mbps: 1000, cableMeters: 500, activationFeeCents: 0, saleType: 'receptiva', equipment: null, routeId: null }, params);
    expect(r.route?.id).toBe('radio');
    // 6% 1200 + 100 + 10% 2000 + 5000 + custo mensal 1000 = 9300
    expect(r.marginMonthlyCents).toBe(10700);
    expect(r.commission.cents).toBe(10000);
    expect(r.alerts.some((a) => a.includes('exige aprovação'))).toBe(true);
  });

  it('sem margem positiva não há payback e avisa', () => {
    const r = computeViability({ priceCents: 1000, mbps: 100, cableMeters: 10, activationFeeCents: 0, saleType: 'ativa', equipment: [], routeId: null }, { ...params, partners: [{ id: 'x', name: 'Caro', kind: 'fixed', percentBp: 0, amountCents: 5000, active: true }] });
    expect(r.paybackMonths).toBeNull();
    expect(r.alerts.some((a) => a.includes('não se paga'))).toBe(true);
  });

  it('lista o que falta para o cálculo completo', () => {
    const r = computeViability({ priceCents: null, mbps: null, cableMeters: null, activationFeeCents: null, saleType: null, equipment: null, routeId: null }, params);
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(['plano (mensalidade)', 'metragem de cabo', 'tipo de venda (ativa ou receptiva)']);
  });

  it('LTV: base quando a amostra basta; senão parâmetro; churn vira vida média', () => {
    expect(lifetime(params.ltv, { customers: 40, avgLifetimeMonths: 30, avgMarginCents: 7000 })).toMatchObject({ months: 30, source: 'base' });
    expect(lifetime(params.ltv, { customers: 10, avgLifetimeMonths: 30, avgMarginCents: 7000 })).toMatchObject({ months: 24, source: 'parametro' });
    expect(lifetime({ lifetimeMonths: null, monthlyChurnBp: 250, minSample: 30 }, null)).toMatchObject({ months: 40, source: 'parametro' });
  });

  it('comissão pelos produtos do plano substitui a regra, por tipo de venda', () => {
    const products = [
      { name: 'Internet 300 Mega', qty: 1, unitPriceCents: 7990, commissionAtiva: { kind: 'percent' as const, value: 5000 }, commissionReceptiva: { kind: 'fixo' as const, value: 1000 } },
      { name: 'Ponto Wi-Fi extra', qty: 2, unitPriceCents: 1000, commissionAtiva: { kind: 'fixo' as const, value: 500 }, commissionReceptiva: null },
    ];
    const ativa = computeViability({ priceCents: 9990, mbps: 300, cableMeters: 80, activationFeeCents: 0, saleType: 'ativa', equipment: null, routeId: null, products }, params);
    expect(ativa.commission.cents).toBe(3995 + 1000);
    expect(ativa.commission.rule).toBe('Produtos do plano');
    const rec = computeViability({ priceCents: 9990, mbps: 300, cableMeters: 80, activationFeeCents: 0, saleType: 'receptiva', equipment: null, routeId: null, products }, params);
    expect(rec.commission.cents).toBe(1000);
    const none = computeViability({ priceCents: 9990, mbps: 300, cableMeters: 80, activationFeeCents: 0, saleType: 'receptiva', equipment: null, routeId: null, products: [{ ...products[1]!, commissionReceptiva: null }] }, params);
    expect(none.commission.rule).not.toBe('Produtos do plano');
  });

  it('ISS em % sobre a mensalidade menos o parceiro indicado', () => {
    const p2 = { ...params, taxes: [{ id: 'iss', name: 'ISS', kind: 'percent' as const, percentBp: 500, amountCents: 0, active: true, baseExcludeIds: ['upnet'] }], partners: [{ id: 'upnet', name: 'UPNET', kind: 'percent' as const, percentBp: 2000, amountCents: 0, active: true }] };
    const r = computeViability({ priceCents: 9990, mbps: 300, cableMeters: 80, activationFeeCents: 0, saleType: 'ativa', equipment: null, routeId: null }, p2);
    const iss = r.monthlyDeductions.find((l) => l.label === 'Tributo · ISS')!;
    expect(iss.cents).toBe(400); // 5% de (99,90 − 19,98) = 3,996
  });

  it('acima do limite de autonomia exige viabilidade da engenharia', () => {
    const p2 = { ...params, autonomy: { maxMeters: 100, maxMbps: 500 } };
    const base = { priceCents: 9990, activationFeeCents: 0, saleType: 'ativa' as const, equipment: null, routeId: null };
    expect(computeViability({ ...base, mbps: 500, cableMeters: 100 }, p2).engineering.required).toBe(false);
    const r = computeViability({ ...base, mbps: 600, cableMeters: 150 }, p2);
    expect(r.engineering.required).toBe(true);
    expect(r.engineering.reasons).toHaveLength(2);
  });

  it('parceiro com valor por plano só entra quando o plano tem valor', () => {
    const p2 = { ...params, partners: [{ id: 'playhub', name: 'PLAYHUB', kind: 'per_plan' as const, percentBp: 0, amountCents: 0, active: true }] };
    const base = { priceCents: 9990, mbps: 300, cableMeters: 50, activationFeeCents: 0, saleType: 'ativa' as const, equipment: null, routeId: null };
    expect(computeViability(base, p2).monthlyDeductions.some((l) => l.label.includes('PLAYHUB'))).toBe(false);
    const r = computeViability({ ...base, planPartnerCosts: { playhub: 790 } }, p2);
    expect(r.monthlyDeductions.find((l) => l.label.includes('PLAYHUB'))!.cents).toBe(790);
  });
});
