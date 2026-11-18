/** Negociação por seções (tipos de negócio): itens por seção, custos com dedução, cálculo por seção e visão geral. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const ECON = { marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 4500, tmaAnnualBp: 0, inflationAnnualBp: 0, horizonMaxMonths: 120, badDebtBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 24, paybackMaxPublic: 24, blockOutsidePolicy: false, overheadBp: 0, incomeTaxBp: 0, validFrom: today };
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

describe('seções da negociação', () => {
  it('itens por seção, custos classificados, recorrência sem investimento no preço e venda com dedução direta', async () => {
    ok(await carlos.post('/admin/viability/econ', ECON), 201);
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const branch = lk.branches[0].id;
    const docs = ok(await carlos.put(`/admin/fiscal-docs/${branch}`, { items: [
      { id: null, fiscalKind: 'servico', code: 'SEC-SRV', name: 'Serviço fictício', active: true, taxes: [{ name: 'ISS', percentBp: 1200, fixedCents: 0, active: true }] },
      { id: null, fiscalKind: 'venda', code: 'SEC-NFE', name: 'Venda fictícia', active: true, taxes: [{ name: 'ICMS', percentBp: 1800, fixedCents: 0, active: true }] },
    ] })).json().items;
    const srv = docs.find((d: { code: string }) => d.code === 'SEC-SRV').id, nfe = docs.find((d: { code: string }) => d.code === 'SEC-NFE').id;
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Empresa Seções ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [
      { description: 'Link dedicado fictício', unit: 'un', qtyMilli: 1000, unitCents: 0, dealKind: 'recorrencia', fiscalDocTypeId: srv, section: 0 },
      { description: 'Roteador fictício', unit: 'un', qtyMilli: 2000, unitCents: 0, dealKind: 'venda', fiscalDocTypeId: nfe, section: 1 },
    ] }));
    const it = ok(await carlos.get(`/opportunities/${o.id}/items`)).json();
    expect(it.items.map((x: { section: number }) => x.section)).toEqual([0, 1]);

    const base = { mode: 'recorrente', termMonths: 12, receiveMonth: 0, capex: [], extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null };
    const sections = [
      { id: 's1', kind: 'recorrencia', termMonths: 36, receiveMonth: 0, marginTargetBp: 3000, paybackMonths: 12, priceCents: null, costs: [
        { description: 'ONU fictícia', qtyMilli: 1000, unitCents: 85_000, category: 'materia_prima', frequency: 'unico' },
        { description: 'Instalação fictícia', qtyMilli: 1000, unitCents: 120_000, category: 'mao_de_obra', frequency: 'unico' },
        { description: 'Última milha fictícia', qtyMilli: 1000, unitCents: 90_000, category: 'parceiros', frequency: 'mensal' },
        { description: 'Monitoramento fictício', qtyMilli: 1000, unitCents: 12_000, category: 'despesas_operacionais', frequency: 'mensal' },
      ] },
      { id: 's2', kind: 'venda', termMonths: 12, receiveMonth: 0, marginTargetBp: 2500, paybackMonths: null, priceCents: null, costs: [
        { description: 'Roteador fictício (custo)', qtyMilli: 2000, unitCents: 42_000, category: 'materia_prima', frequency: 'unico' },
      ] },
    ];
    // venda com custo mensal é recusada
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...base, sections: [sections[0], { ...sections[1], costs: [{ ...sections[1]!.costs[0], frequency: 'mensal' }] }] }), 422);
    const saved = ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...base, sections })).json().result;
    const [rec, sale] = saved.sections;
    // (os parâmetros vigentes podem ser de outro teste no mesmo banco: confere as regras, não o número exato)
    expect(rec.idealCents).toBeGreaterThan(Math.ceil(102_000 / 0.88));
    expect(rec.deductions).toMatchObject({ materia_prima: 0, mao_de_obra: 0 });
    expect(rec.deductions.parceiros).toBeGreaterThanOrEqual(90_000); // com a contingência dos custos mensais, quando houver
    expect(rec.deductions.despesas_operacionais).toBeGreaterThanOrEqual(12_000);
    expect(rec.investment.totalCents).toBeGreaterThanOrEqual(205_000);
    expect(rec.paybackOk).toBe(true);
    expect(sale.idealCents).toBeGreaterThan(Math.ceil(84_000 / 0.82));
    expect(sale.deductions.materia_prima).toBeGreaterThanOrEqual(84_000);
    expect(saved.sectionsOverview.total.revenue).toBe(rec.contract.revenue + sale.contract.revenue);
    // o catálogo aprendeu os custos (parceiro mensal fica como parceiro)
    const cat = ok(await carlos.get('/cost-items')).json().items;
    expect(cat.find((c: { name: string }) => c.name === 'Última milha fictícia')).toMatchObject({ kind: 'mensal', impact: 'parceiro' });
    expect(cat.find((c: { name: string }) => c.name === 'ONU fictícia')).toMatchObject({ kind: 'investimento', impact: 'material' });
    // consultar devolve o salvo, sem desatualizar
    const g = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(g.stale).toBe(false);
    expect(g.input.sections).toHaveLength(2);
    expect(g.input.sections[0].costs[0].costItemId).toBeTruthy();
  });
});
