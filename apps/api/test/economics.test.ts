/** Viabilidade econômica: documentos fiscais por filial, tributo no item, parâmetros, cálculo, fotografia e trava de payback. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());

describe('viabilidade econômica', () => {
  it('documentos fiscais por filial, item com documento, cálculo com tributo ponderado, fotografia e trava de payback', async () => {
    // parâmetros do motor (Configurações → Viabilidade)
    ok(await lucas.put('/admin/viability/econ', {}), 403);
    ok(await carlos.put('/admin/viability/econ', { marginTargetBp: 3500, tmaMonthlyBp: 0, commissionBp: 500, lossBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true }));

    // documentos fiscais na filial
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const branch = lk.branches[0].id;
    ok(await carlos.put(`/admin/fiscal-docs/${branch}`, { items: [{ id: null, fiscalKind: 'servico', code: 'x', name: 'Duplicado', active: true, taxes: [] }, { id: null, fiscalKind: 'servico', code: 'X', name: 'Duplicado', active: true, taxes: [] }] }), 422);
    const docs = ok(await carlos.put(`/admin/fiscal-docs/${branch}`, { items: [
      { id: null, fiscalKind: 'servico', code: 'nfs-e', name: 'Nota de serviço', active: true, taxes: [{ name: 'ISS', percentBp: 500, fixedCents: 0, active: true }, { name: 'PIS/COFINS', percentBp: 365, fixedCents: 0, active: true }] },
      { id: null, fiscalKind: 'servico', code: 'NFCOM', name: 'Nota de comunicação', active: true, taxes: [{ name: 'ICMS', percentBp: 2000, fixedCents: 0, active: true }] },
    ] })).json().items;
    const nfse = docs.find((d: { code: string }) => d.code === 'NFS-E');
    const nfcom = docs.find((d: { code: string }) => d.code === 'NFCOM');
    expect(nfse.rates).toMatchObject({ percentBp: 865, complete: true });

    // oportunidade com 2 itens (50/50) e documentos diferentes
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Empresa Viab ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: branch, saleKind: 'venda_consultiva' }), 201).json();
    const items = [
      { description: 'Link dedicado', unit: 'un', qtyMilli: 1000, unitCents: 500_000, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: nfcom.id },
      { description: 'Gerenciamento', unit: 'un', qtyMilli: 1000, unitCents: 500_000, discountCents: 0, surchargeCents: 0, fiscalDocTypeId: nfse.id },
    ];
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ ...items[0], fiscalDocTypeId: '00000000-0000-4000-8000-000000000000' }] }), 422);
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items }));

    const g = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(g.saved).toBeNull();
    // a = 0,5×20% + 0,5×8,65% = 14,325%
    expect(g.result.rates.a).toBeCloseTo(0.14325, 8);
    expect(g.result.withReservations).toBe(false);

    const input = { mode: 'recorrente', termMonths: 24, receiveMonth: 0, capex: [{ description: 'Roteador', qtyMilli: 1000, unitCents: 3_000_000 }], extraInitialCents: 0, opex: [{ description: 'Trânsito IP', qtyMilli: 1000, unitCents: 200_000 }], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null };
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, termMonths: 0 }), 422);
    const saved = ok(await carlos.put(`/opportunities/${o.id}/economics`, input)).json();
    // P = 10.000; MC = 10.000 − 1.432,50 − 500 − 2.000 = 6.067,50; payback = 30.000 ÷ 6.067,50 ≈ 4,9 meses (≤ 6)
    expect(saved.result.kpi.contributionCents).toBe(606_750);
    expect(saved.result.kpi.paybackMonths).toBeCloseTo(3_000_000 / 606_750, 4);
    expect(saved.result.verdict).not.toBe('fora_politica');
    expect(saved.history).toHaveLength(1);

    // investimento maior: payback passa de 6 meses no privado → não vai para aprovação
    ok(await carlos.put(`/opportunities/${o.id}/economics`, { ...input, capex: [{ description: 'Obra de rede', qtyMilli: 1000, unitCents: 6_000_000 }] }));
    const ap = await carlos.post(`/opportunities/${o.id}/approval/requests`, { negotiationType: 'novo_servico', proposedMonthlyCents: 1_000_000, activationFeeCents: 0, justification: 'Pedido de teste da trava' });
    expect(ap.statusCode, ap.body).toBe(422);
    expect(ap.json().detail).toMatch(/fora da política.*limite para setor privado é 6/);

    // fotografias são append-only
    await expect(ctx.db.execute(sql`update opportunity_economics_snapshots set reason = 'x' where opportunity_id = ${o.id}`)).rejects.toThrow(/append-only/);
    const h = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json().history;
    expect(h.length).toBe(2);

    // Inteligência: fluxo consolidado (em andamento começa neste mês; mês 0 = investimento)
    const intel = ok(await carlos.get('/intelligence/economics?status=andamento')).json();
    const mine = intel.items.find((i: { id: string }) => i.id === o.id);
    expect(mine.investmentCents).toBe(6_000_000);
    expect(mine.months).toBe(24);
    expect(intel.flow.outflow[0]).toBeLessThanOrEqual(-6_000_000);
    expect(intel.totals.investmentCents).toBeGreaterThanOrEqual(6_000_000);
    expect(ok(await carlos.get('/intelligence/economics?status=ganhas')).json().items.some((i: { id: string }) => i.id === o.id)).toBe(false);
  });

  it('filial emite só os tipos fiscais liberados; tipo de venda da oportunidade não depende da filial', async () => {
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const all = ok(await carlos.get('/admin/sales-branches')).json().items;
    const br = all[1];
    ok(await carlos.put('/admin/sales-branches', { items: all.map((b: { id: string; name: string; active: boolean }) => ({ id: b.id, name: b.name, active: b.active, fiscalKinds: b.id === br.id ? ['servico', 'locacao'] : [] })) }));
    expect(ok(await carlos.get('/meta/lookups')).json().branches.find((b: { id: string }) => b.id === br.id).fiscalKinds).toEqual(['servico', 'locacao']);
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    ok(await carlos.post('/opportunities', { newContact: { name: `Filial Tipo OK ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: br.id, saleKind: 'venda_consultiva' }), 201);
    const d = await carlos.put(`/admin/fiscal-docs/${br.id}`, { items: [{ id: null, fiscalKind: 'venda', code: 'NFE', name: 'Nota de venda', active: true, taxes: [] }] });
    expect(d.statusCode).toBe(422);
    expect(d.json().detail).toMatch(/não aceita Venda/);
    const saved = ok(await carlos.put(`/admin/fiscal-docs/${br.id}`, { items: [
      { id: null, fiscalKind: 'servico', code: 'NFSE', name: 'Nota de serviço', active: true, taxes: [{ name: 'ISS', percentBp: 200, fixedCents: 0, active: true }] },
      { id: null, fiscalKind: 'locacao', code: 'NFSE', name: 'Fatura de locação', active: true, taxes: [] },
    ] })).json();
    expect(saved.items.map((x: { fiscalKind: string }) => x.fiscalKind).sort()).toEqual(['locacao', 'servico']);
    ok(await carlos.put('/admin/sales-branches', { items: all.map((b: { id: string; name: string; active: boolean }) => ({ id: b.id, name: b.name, active: b.active, fiscalKinds: [] })) }));
  });

  it('item sem documento fiscal: calcula com ressalvas', async () => {
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const o = ok(await carlos.post('/opportunities', { newContact: { name: `Órgão Viab ${Date.now()}`, segment: 'governamental' }, pipelineId: lk.pipelines.find((p: { key: string }) => p.key === 'empresarial').id, branchId: lk.branches[0].id, saleKind: 'venda_consultiva' }), 201).json();
    ok(await carlos.put(`/opportunities/${o.id}/items`, { rowVersion: o.rowVersion, items: [{ description: 'Link', unit: 'un', qtyMilli: 1000, unitCents: 100_000, discountCents: 0, surchargeCents: 0 }] }));
    const r = ok(await carlos.get(`/opportunities/${o.id}/economics`)).json();
    expect(r.result.withReservations).toBe(true);
    expect(r.publicSector).toBe(true);
    expect(r.result.term.Dalvo).toBe(12);
  });
});
