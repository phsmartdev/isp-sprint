import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPROVAL_POLICY, buildOpinion, canDecide, customerKind, discountBp, materialChanges, monthsBetween, negotiationMargin, requiredApproval, userApprovalLevel,
  type AnalysisFingerprint, type ServiceLine,
} from './approvals';

describe('quem é o cliente', () => {
  it('cancelado continua da base; sem relacionamento é novo', () => {
    expect(customerKind({ lifecycle: 'cancelado', contracts: 0, wonOpportunities: 0, importedFromErp: false })).toMatchObject({ kind: 'base', label: 'Cliente da base (cancelado)' });
    expect(customerKind({ lifecycle: 'prospect', contracts: 0, wonOpportunities: 1, importedFromErp: false }).kind).toBe('base');
    expect(customerKind({ lifecycle: null, contracts: 0, wonOpportunities: 0, importedFromErp: false }).kind).toBe('novo');
  });
});

describe('alçadas', () => {
  it('menor alçada que comporta o desconto; vendedor não decide', () => {
    expect(requiredApproval(DEFAULT_APPROVAL_POLICY, 0, null)).toMatchObject({ level: 'supervisor', exceptional: false });
    expect(requiredApproval(DEFAULT_APPROVAL_POLICY, 1000, null).level).toBe('gerencia');
    expect(requiredApproval(DEFAULT_APPROVAL_POLICY, 3500, null)).toMatchObject({ level: 'diretoria', exceptional: true });
    expect(canDecide('vendedor', 'supervisor')).toBe(false);
    expect(canDecide('gerencia', 'supervisor')).toBe(true);
    expect(canDecide('gerencia', 'diretoria')).toBe(false);
    expect(userApprovalLevel(['supervisor'], ['diretoria'])).toBe('diretoria');
  });
  it('margem mínima sobe a alçada; sem margem calculável não cabe na alçada que exige', () => {
    const policy = { limits: [
      { level: 'vendedor' as const, maxDiscountBp: 0, minMarginBp: null },
      { level: 'supervisor' as const, maxDiscountBp: 1000, minMarginBp: 4000 },
      { level: 'gerencia' as const, maxDiscountBp: 2000, minMarginBp: null },
      { level: 'diretoria' as const, maxDiscountBp: 3000, minMarginBp: null },
    ] };
    expect(requiredApproval(policy, 500, 5000).level).toBe('supervisor');
    expect(requiredApproval(policy, 500, 3000).level).toBe('gerencia');
    expect(requiredApproval(policy, 500, null).level).toBe('gerencia');
  });
  it('desconto em pontos-base', () => {
    expect(discountBp(10000, 9000)).toBe(1000);
    expect(discountBp(10000, 12000)).toBe(0);
    expect(discountBp(null, 9000)).toBe(0);
  });
});

describe('margem e capacidade de negociação', () => {
  const services: ServiceLine[] = [
    { ref: 'c1', label: 'Link 100M', source: 'contrato', monthlyCents: 100_000, monthlyCostCents: 40_000 },
    { ref: 'c2', label: 'IP fixo', source: 'contrato', monthlyCents: 20_000, monthlyCostCents: 5_000 },
  ];
  it('serviço adicional: soma receita e margem, payback pelo investimento', () => {
    const m = negotiationMargin(services, { listMonthlyCents: 50_000, proposedMonthlyCents: 45_000, monthlyCostCents: 20_000, investmentCents: 100_000, replacesMonthlyCents: 0 });
    expect(m.current).toMatchObject({ revenueCents: 120_000, marginCents: 75_000, marginBp: 6250 });
    expect(m.incremental).toMatchObject({ revenueCents: 45_000, marginCents: 25_000, paybackMonths: 4 });
    expect(m.after).toMatchObject({ revenueCents: 165_000, marginCents: 100_000 });
    expect(m.discount.bp).toBe(1000);
    expect(m.reliable).toBe(true);
  });
  it('upgrade substitui receita sem duplicar', () => {
    const m = negotiationMargin(services, { listMonthlyCents: 150_000, proposedMonthlyCents: 150_000, monthlyCostCents: 60_000, investmentCents: 0, replacesMonthlyCents: 100_000 });
    expect(m.incremental.revenueCents).toBe(50_000);
    // custo substituído = 100k × (45k/120k) = 37.5k
    expect(m.incremental.costCents).toBe(60_000 - 37_500);
    expect(m.after.revenueCents).toBe(170_000);
  });
  it('sem custo de algum serviço: margem não é calculada e avisa', () => {
    const m = negotiationMargin([...services, { ref: 'v', label: 'Venda sem viabilidade', source: 'venda', monthlyCents: 10_000, monthlyCostCents: null }], { listMonthlyCents: 50_000, proposedMonthlyCents: 50_000, monthlyCostCents: 20_000, investmentCents: 1, replacesMonthlyCents: 0 });
    expect(m.current.marginCents).toBeNull();
    expect(m.after.marginCents).toBeNull();
    expect(m.incremental.marginCents).toBe(30_000); // o incremental de um serviço adicional não depende do custo atual
    expect(m.reliable).toBe(false);
    expect(m.warnings[0]).toContain('não pode ser calculada com segurança');
  });
});

describe('parecer', () => {
  it('só usa os dados recebidos e aponta pendências', () => {
    const margin = negotiationMargin([{ ref: 'c', label: 'x', source: 'contrato', monthlyCents: 100_000, monthlyCostCents: 50_000 }], { listMonthlyCents: 50_000, proposedMonthlyCents: 45_000, monthlyCostCents: 20_000, investmentCents: 100_000, replacesMonthlyCents: 0 });
    const o = buildOpinion({
      kind: 'base', customerName: 'Cliente', lifecycle: 'ativo', relationshipMonths: 30, activeContracts: 3, margin,
      classification: { classKey: 'Classe A', payerProfile: 'Pontual', risk: 'Baixo', potential: null, classifiedAt: '01/10/2026', classifiedBy: 'Carlos' },
      required: requiredApproval(DEFAULT_APPROVAL_POLICY, margin.discount.bp, margin.after.marginBp), paymentsAvailable: false,
      viability: { complete: true, missing: [] }, coverageStatus: 'elegivel',
      justification: 'Ampliação da filial', risks: null, leadSource: null, negotiationLabel: 'Novo serviço',
    });
    expect(o.summary).toContain('Cliente da base classificado como Classe A, perfil pagador pontual, 3 contrato(s) ativo(s).');
    expect(o.summary).toContain('amplia a receita recorrente em');
    expect(o.favorable.map((x) => x.text)).toContain('Perfil pagador: Pontual.');
    expect(o.pending.some((x) => x.text.includes('IXC'))).toBe(true);
    expect(o.authority.at(-1)!.text).toBe('Alçada necessária: Gerência.');
    for (const g of [o.favorable, o.attention, o.financial, o.strategic, o.pending, o.authority]) for (const it of g) expect(it.source).toBeTruthy();
  });
  it('sem classificação aparece como pendência', () => {
    const margin = negotiationMargin([], { listMonthlyCents: 10_000, proposedMonthlyCents: 10_000, monthlyCostCents: 4_000, investmentCents: 20_000, replacesMonthlyCents: 0 });
    const o = buildOpinion({ kind: 'base', customerName: 'X', lifecycle: 'cancelado', relationshipMonths: 5, activeContracts: 0, margin, classification: null, required: requiredApproval(DEFAULT_APPROVAL_POLICY, 0, null), paymentsAvailable: false, viability: null, coverageStatus: 'nao_consultada', justification: '', risks: null, leadSource: null, negotiationLabel: 'Retenção' });
    expect(o.pending.map((x) => x.text)).toContain('Cliente sem classificação estratégica (Não classificado).');
    expect(o.pending.map((x) => x.text)).toContain('Justificativa comercial não informada.');
  });
});

describe('mudança material e datas', () => {
  const base: AnalysisFingerprint = { proposedMonthlyCents: 10_000, listMonthlyCents: 12_000, investmentCents: 50_000, newServiceMarginCents: 5_000, currentRevenueCents: 100_000, activeContracts: 2, classificationId: 'a', lifecycle: 'ativo', proposalSha: 'x' };
  it('pequenas variações não contam; mudanças relevantes sim', () => {
    expect(materialChanges(base, { ...base, currentRevenueCents: 102_000 })).toEqual([]);
    expect(materialChanges(base, { ...base, currentRevenueCents: 120_000, classificationId: 'b' })).toEqual(['A receita recorrente atual do cliente mudou.', 'A classificação estratégica do cliente foi atualizada.']);
  });
  it('meses entre datas', () => {
    expect(monthsBetween('2024-01-15', '2026-01-14')).toBe(23);
    expect(monthsBetween('2024-01-15', '2026-01-15')).toBe(24);
  });
});
