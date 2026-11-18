import { describe, expect, it } from 'vitest';
import { b2gFromEconomics, b2gViability, distribute, type B2gParams, type B2gProduct } from './b2gViability';
import { emptyEconInput, type CostLine, type EconSettings } from './finance';

const nfe = { name: 'NF-e', taxBp: 1000, fixedCents: 0 }; // 10%
const nfse = { name: 'NFS-e', taxBp: 1500, fixedCents: 0 }; // 15%
const base: B2gParams = { mode: 'A', variableBp: 0, riskBp: 0, incomeTaxBp: 3400, overheadBp: 3500, netMinBp: 800, termMonths: 36 };
const line = (kind: CostLine['kind'], cents: number, impact: CostLine['impact'] = 'servico'): CostLine => ({ description: 'custo', qtyMilli: 1000, unitCents: cents, kind, impact });
const prod = (id: string, kind: B2gProduct['kind'], profile: B2gProduct['profile'], est: number, doc = profile === 'fornecimento' ? nfe : nfse): B2gProduct => ({ id, description: id, kind, profile, estimatedCents: est, doc });

describe('viabilidade B2G', () => {
  it('só venda pura: sem bloco recorrente, sem rateio', () => {
    const r = b2gViability([prod('a', 'venda', 'fornecimento', 100_000)], [line('venda', 50_000, 'material')], [], { ...base, contributionBp: { fornecimento: 3000 } });
    expect(r.recorrente).toBeNull();
    expect(r.kinds).toEqual({ unica: true, recorrente: false });
    expect(r.unica!.overheadCents).toBe(0);
    expect(r.unica!.lines[0]!.overheadBase).toBeNull();
    // preço = 50.000 ÷ (1 − 10% − 30%)
    expect(r.unica!.lines[0]!.priceCents).toBe(Math.round(50_000 / 0.6));
  });

  it('só recorrente: mensalidade pela fórmula do payback (conta conferida)', () => {
    // custo direto da implantação R$ 10.000, rateio 35% sobre o custo = R$ 3.500 → investimento R$ 13.500
    // despesas fixas na mensalidade: (10.000 ÷ 12 + 1.000) ÷ (1 − 15% tributos − 35% fixas) = 1.833,33 ÷ 0,50 = R$ 3.666,67
    const r = b2gViability([prod('link', 'recorrencia', 'implantacao', 300_000)], [line('recorrencia', 1_000_000)], [{ description: 'mensal', qtyMilli: 1000, unitCents: 100_000 }], { ...base, paybackMonths: 12 });
    expect(r.unica).toBeNull();
    expect(r.recorrente!.investmentCents).toBe(1_000_000);
    expect(r.recorrente!.overheadOnCostCents).toBe(0);
    expect(r.recorrente!.lines[0]!.priceCents).toBe(366_667);
    expect(r.recorrente!.lines[0]!.overheadCents).toBe(128_333); // 35% da mensalidade, todo mês
    expect(r.recorrente!.lines[0]!.overheadBase).toBe('preco');
    expect(r.recorrente!.lines[0]!.paybackMonths).toBeCloseTo(12, 6);
  });

  it('misto: blocos independentes e consolidado que fecha com a soma', () => {
    const r = b2gViability(
      [prod('eq', 'venda', 'fornecimento', 200_000), prod('inst', 'servico', 'implantacao', 150_000), prod('link', 'recorrencia', 'implantacao', 300_000)],
      [line('venda', 100_000, 'material'), line('servico', 60_000), line('recorrencia', 1_000_000)], [{ description: 'mensal', qtyMilli: 1000, unitCents: 100_000 }],
      { ...base, netTargetBp: 1000, paybackMonths: 12 },
    );
    expect(r.unica).not.toBeNull();
    expect(r.recorrente).not.toBeNull();
    expect(r.global.priceCents).toBe(r.unica!.priceCents + r.recorrente!.priceCents);
    expect(r.global.netCents).toBe(r.unica!.netCents + r.recorrente!.netCents);
    expect(r.global.costCents).toBe(r.unica!.costCents + r.recorrente!.costCents);
    // Instalação avulsa e investimento recorrente permanecem em perfis independentes.
    const uniqueImpl = 60_000;
    expect(r.unica!.lines.find((l) => l.id === 'inst')!.costCents).toBe(uniqueImpl);
    expect(r.recorrente!.investmentCents).toBe(1_000_000);
    expect(r.global.markup).toBeCloseTo(r.global.priceCents / r.global.costCents, 10);
  });

  it('contribuição 35% + rateio 35% na Instalação (venda única) zera a margem de operação', () => {
    const r = b2gViability([prod('inst', 'servico', 'implantacao', 100_000)], [line('servico', 50_000)], [], { ...base, contributionBp: { instalacao: 3500 } });
    const c = r.unica!.cascade!.find((x) => x.profile === 'instalacao')!;
    expect(c.contributionPct).toBeCloseTo(35, 4);
    expect(c.overheadPct).toBe(35);
    expect(c.operatingPct).toBeCloseTo(0, 2);
    expect(r.unica!.lines[0]!.overheadBase).toBe('preco');
  });

  it('documento fiscal vazio bloqueia o cálculo', () => {
    const r = b2gViability([{ ...prod('a', 'venda', 'fornecimento', 1000), doc: null }], [], [], base);
    expect(r.verdict).toBe('bloqueado');
    expect(r.blocked).toHaveLength(1);
    expect(r.unica).toBeNull();
  });

  it('Modo B: piso, desconto máximo e faixa; no piso a margem líquida é a mínima (consistência A × B)', () => {
    const ps = [prod('eq', 'venda', 'fornecimento', 200_000), prod('inst', 'servico', 'implantacao', 150_000)];
    const costs = [line('venda', 100_000, 'material'), line('servico', 60_000)];
    const b = b2gViability(ps, costs, [], { ...base, mode: 'B' });
    for (const l of b.unica!.lines) {
      expect(l.floorCents).not.toBeNull();
      expect(l.bidRange).toEqual({ from: l.floorCents, to: l.estimatedCents });
      expect(l.maxDiscountPct).toBeCloseTo(Math.max(0, (1 - l.floorCents! / l.estimatedCents) * 100), 6);
    }
    // lance exatamente no piso → margem líquida = mínima
    const atFloor = b2gViability(ps.map((x) => ({ ...x, bidCents: b.unica!.lines.find((l) => l.id === x.id)!.floorCents })), costs, [], { ...base, mode: 'B' });
    for (const l of atFloor.unica!.lines) expect(l.netPct!).toBeCloseTo(8, 2);
    // recorrente: mensalidade no piso também entrega a mínima ao longo da vigência
    const rec = [prod('link', 'recorrencia', 'implantacao', 300_000)];
    const rc = [line('recorrencia', 1_000_000)], ro = [{ description: 'mensal', qtyMilli: 1000, unitCents: 100_000 }];
    const rb = b2gViability(rec, rc, ro, { ...base, mode: 'B' });
    const fl = rb.recorrente!.lines[0]!.floorCents!;
    const rf = b2gViability([{ ...rec[0]!, bidCents: fl }], rc, ro, { ...base, mode: 'B' });
    expect(rf.recorrente!.lines[0]!.netPct!).toBeCloseTo(8, 2);
    expect(rb.recorrente!.lines[0]!.paybackMonths).toBeGreaterThan(0);
  });

  it('Modo B: valor estimado abaixo do piso alerta; produto negativo não é compensado', () => {
    const r = b2gViability([prod('caro', 'venda', 'fornecimento', 1_000_000), prod('barato', 'servico', 'implantacao', 10_000)], [line('venda', 100_000, 'material'), line('servico', 60_000)], [], { ...base, mode: 'B' });
    const barato = r.unica!.lines.find((l) => l.id === 'barato')!;
    expect(barato.netPct!).toBeLessThan(0);
    expect(barato.alerts.join(' ')).toMatch(/negativa/);
    expect(r.verdict).toBe('produto_negativo');
  });

  it('target seek venda única: a margem líquida resultante é o alvo em cada cesta', () => {
    const r = b2gViability([prod('eq', 'venda', 'fornecimento', 200_000), prod('inst', 'servico', 'implantacao', 150_000)], [line('venda', 100_000, 'material'), line('servico', 60_000)], [], { ...base, netTargetBp: 1200 });
    for (const l of r.unica!.lines) expect(l.netPct!).toBeCloseTo(12, 4);
  });

  it('target seek recorrente: o payback resolvido reproduz a margem líquida alvo e fica entre 1 e a vigência', () => {
    const rc = [line('recorrencia', 1_000_000)], ro = [{ description: 'mensal', qtyMilli: 1000, unitCents: 100_000 }];
    const r = b2gViability([prod('link', 'recorrencia', 'implantacao', 300_000)], rc, ro, { ...base, netTargetBp: 1500, solvePayback: true });
    const D = r.recorrente!.paybackMonths!;
    expect(D).toBeGreaterThanOrEqual(1);
    expect(D).toBeLessThanOrEqual(36);
    expect(r.recorrente!.lines[0]!.netPct!).toBeCloseTo(15, 3);
    // sem explosão: a mensalidade não precisa recuperar a margem antes do break-even (payback não vai a 1 mês)
    expect(D).toBeGreaterThan(3);
  });

  it('distribuição: a soma por cesta é igual ao custo da engenharia; peso manual como exceção', () => {
    const ps = [prod('a', 'venda', 'fornecimento', 300), prod('b', 'venda', 'fornecimento', 700), prod('c', 'venda', 'fornecimento', 1000)];
    const d = distribute(ps, 100_001);
    expect([...d.values()].reduce((t, x) => t + x, 0)).toBe(100_001);
    expect(d.get('a')).toBe(Math.round(100_001 * 0.15));
    const m = distribute(ps, 100_000, { c: 0.5 });
    expect(m.get('c')).toBe(50_000);
    expect([...m.values()].reduce((t, x) => t + x, 0)).toBe(100_000);
  });

  it('sem margem líquida mínima configurada: avisa e não calcula o piso', () => {
    const r = b2gViability([prod('a', 'venda', 'fornecimento', 100_000)], [line('venda', 50_000, 'material')], [], { ...base, mode: 'B', netMinBp: null });
    expect(r.verdict).toBe('sem_minimo');
    expect(r.unica!.lines[0]!.floorCents).toBeNull();
    expect(r.alerts.join(' ')).toMatch(/Configure a margem líquida mínima/);
  });
  it('três perfis independentes: mudar a instalação não altera o custo ou preço mensal', () => {
    const ps = [prod('Venda', 'venda', 'fornecimento', 200000), prod('Avulso', 'servico', 'implantacao', 100000), prod('Link', 'recorrencia', 'implantacao', 10000), prod('Aluguel', 'locacao', 'fornecimento', 20000)];
    const capex = [line('venda', 50001), line('servico', 300001), line('recorrencia', 240003)];
    const params = { ...base, autoPrice: true, termMonths: 12, paybackMonths: 6, overheadBp: 0, netTargetBp: 2000 };
    const r = b2gViability(ps, capex, [line(null, 3000)], params);
    expect(r.unica!.lines.find((l) => l.id === 'Venda')!.costCents).toBe(50001);
    expect(r.unica!.lines.find((l) => l.id === 'Avulso')!).toMatchObject({ profile: 'instalacao', costCents: 300001 });
    expect(r.recorrente!.investmentCents).toBe(240003);
    expect(r.recorrente!.lines.every((l) => l.profile === 'implantacao')).toBe(true);
    expect(r.recorrente!.lines.reduce((t, l) => t + l.investmentCents!, 0)).toBe(240003);
    expect(r.baskets!.reduce((t, b) => t + b.costCents, 0)).toBe(r.global.costCents);
    expect(r.global.costCents).toBe(626005);
    const changed = b2gViability(ps, [...capex.slice(0, 1), line('servico', 700001), capex[2]!], [line(null, 3000)], params);
    expect(changed.recorrente).toEqual(r.recorrente);
    expect(changed.global.costCents - r.global.costCents).toBe(400000);
  });

  it.each([true, false])('mantém sugerido em ambos os contextos; valor informado = %s', (known) => {
    const ps = [prod('Venda', 'venda', 'fornecimento', known ? 100000 : 0), prod('Avulso', 'servico', 'instalacao', known ? 120000 : 0), prod('Link', 'recorrencia', 'implantacao', known ? 20000 : 0)].map((x) => ({ ...x, priceDefined: known }));
    const r = b2gViability(ps, [line('venda', 50001), line('servico', 60003), line('recorrencia', 120005)], [line(null, 1000)], { ...base, autoPrice: true, netTargetBp: 2000, paybackMonths: 6, termMonths: 12 });
    for (const l of [...r.unica!.lines, ...r.recorrente!.lines]) {
      expect(l.suggestedCents).toBeGreaterThan(0);
      expect(l.priceBasis).toBe(known ? 'informado' : 'sugerido');
      expect(l.priceCents).toBe(known ? l.estimatedCents : l.suggestedCents);
      expect(l.netPct).not.toBeNull();
    }
  });

  it('sem valores: divisão igual por cesta com centavos fechados e peso manual preservado', () => {
    const ps = [prod('A', 'venda', 'fornecimento', 0), prod('B', 'venda', 'fornecimento', 0), prod('C', 'servico', 'instalacao', 0)];
    const capex = [line('venda', 100001), line('servico', 70003)];
    const params = { ...base, autoPrice: true, netTargetBp: 2000 };
    const r = b2gViability(ps, capex, [], params);
    expect(r.unica!.lines.map((l) => l.costCents)).toEqual([50001, 50000, 70003]);
    const weighted = b2gViability(ps, capex, [], { ...params, weights: { A: 0.8 } });
    expect(weighted.unica!.lines.map((l) => l.costCents)).toEqual([80001, 20000, 70003]);
    expect(weighted.global.costCents).toBe(170004);
  });

  it('perfil sem produto avisa e mantém custo global, sem contaminar outra cesta', () => {
    const r = b2gViability([prod('Venda', 'venda', 'fornecimento', 100000)], [line('servico', 50001)], [], { ...base, autoPrice: true, netTargetBp: 2000 });
    expect(r.unica!.costCents).toBe(0);
    expect(r.global.costCents).toBe(50001);
    expect(r.alerts.join(' ')).toMatch(/não foi distribuído para outros perfis/);
    expect(r.verdict).toBe('abaixo_minimo');
  });
  it('usa margem e payback padrão quando não existe margem líquida alvo', () => {
    const settings: EconSettings = { marginTargetBp: 2000, tmaMonthlyBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true };
    const r = b2gFromEconomics({ publicSector: false, settings, input: { ...emptyEconInput(), capex: [line('venda', 60000), line('servico', 50000), line('recorrencia', 120000)] }, items: (['venda', 'servico', 'recorrencia'] as const).map((kind) => ({ description: kind, kind, priceDefined: false, revenueCents: 0, doc: { name: 'Doc', percentBp: 1000, fixedCents: 0, complete: true } })) });
    expect(r.unica!.lines.map((l) => l.suggestedCents)).toEqual([85714, 71429]);
    expect(r.recorrente!.monthlyPriceCents).toBe(22222);
  });

});
