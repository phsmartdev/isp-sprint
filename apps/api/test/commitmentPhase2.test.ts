/** Controle de Empenhos — fase 2: fontes de receita e rateio, reajuste com retroativo, aditivo de item, virada de exercício e projeções. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const year = new Date().getFullYear();
const comp = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
let cid = '';
const L: Record<string, string> = {};
const S: Record<string, string> = {};
type G = { lines: { id: string; itemNumber: string; qty4: number; price4: number; balance: Record<string, number> }[]; commitments: { id: string; number: string; balanceV4: number; suppressedV4: number; substitui: { number: string }[]; reempenhadaEm: { number: string }[]; items: { id: string; lineId: string; balance4: number }[] }[]; measurements: { id: string; title: string; items: { lineId: string; price4: number; allocations: { commitmentItemId: string; qty4: number }[]; uncovered4: number }[] }[]; pendencias: { kind: string; valueV4: number; retroId?: string }[]; totals: Record<string, number>; alerts: { key: string }[]; projection: { lines: { lineId: string }[]; years: unknown[] }; curve: unknown[]; settings: Record<string, unknown>; adjustments: unknown[] };
const get = async () => ok(await carlos.get(`/contracts/${cid}/commitment-control`)).json() as G;

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  const [o] = (await ctx.db.execute(sql`select o.id from opportunities o where o.stage = 'ganha' and o.deleted_at is null and not exists (select 1 from contracts c where c.opportunity_id = o.id) limit 1`)).rows as { id: string }[];
  const c = ok(await carlos.post('/contracts', { opportunityId: o!.id, billingType: 'medicao', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: carlos.me.user.id, version: { number: 'CTR-107/2025', object: 'Conectividade fictícia das escolas', signedAt: `${year}-01-10`, startAt: `${year}-01-10`, termMonths: 24, monthlyCents: 0, totalCents: 1_000_000, items: [], publicTerms: { agency: 'Secretaria Fictícia', processNumber: '2/2025', modality: 'Pregão', commitmentNote: null, budgetLine: null, extensionMaxMonths: null } } }), 201).json();
  cid = c.id;
  const ls = ok(await carlos.post(`/contracts/${cid}/lines`, { items: [
    { itemNumber: '1', description: 'Link dedicado mensal', unit: 'MES', classification: 'recorrente', qty: 120, price: 10, monthlyQty: 10 },
    { itemNumber: '2', description: 'Instalação de ponto', unit: 'UN', classification: 'demanda', qty: 50, price: 100 },
  ] }), 201).json();
  L.A = ls.ids[0]; L.B = ls.ids[1];
});
afterAll(async () => ctx.close());

describe('Controle de Empenhos — fase 2', () => {
  it('fontes de receita, proporção versionada e rateio com confirmação', async () => {
    S.est = ok(await carlos.post(`/contracts/${cid}/commitment-control/sources`, { name: 'Educação estadual' }), 201).json().id;
    S.mun = ok(await carlos.post(`/contracts/${cid}/commitment-control/sources`, { name: 'Educação municipal' }), 201).json().id;
    ok(await carlos.post(`/contracts/${cid}/commitment-control/sources`, { name: 'educação ESTADUAL' }), 422);
    // ativar rateio sem proporção não pode; sem confirmação explícita nem passa na validação
    ok(await carlos.post(`/contracts/${cid}/commitment-control/settings`, { allocation: { mode: 'rateio', confirm: true } }), 422);
    ok(await carlos.post(`/contracts/${cid}/commitment-control/shares`, { validFrom: `${year}-01`, definedBy: 'cliente', shares: [{ sourceId: S.est, pct: 60 }, { sourceId: S.mun, pct: 30 }] }), 422);
    ok(await carlos.post(`/contracts/${cid}/commitment-control/shares`, { validFrom: `${year}-01`, definedBy: 'cliente', shares: [{ sourceId: S.est, pct: 60 }, { sourceId: S.mun, pct: 40 }] }), 201);
    ok(await carlos.post(`/contracts/${cid}/commitment-control/settings`, { allocation: { mode: 'rateio' } }), 422);
    ok(await carlos.post(`/contracts/${cid}/commitment-control/settings`, { allocation: { mode: 'rateio', confirm: true }, agingDays: 45, toCommitPct: 20, windowMonths: 6 }));
    const g = await get();
    expect(g.settings).toMatchObject({ allocation: 'rateio', agingDays: 45, toCommitPct: 20, windowMonths: 6, allocationConfirmedBy: 'Carlos Silva' });
    // com rateio, NE sem fonte é recusada
    ok(await carlos.post(`/contracts/${cid}/commitment-control/commitments`, { number: `${year}NE000001`, issuedOn: `${year}-01-15`, items: [{ lineId: L.A, qty: 60 }] }), 422);
    ok(await carlos.post(`/contracts/${cid}/commitment-control/commitments`, { number: `${year}NE000001`, issuedOn: `${year}-01-15`, sourceId: S.est, items: [{ lineId: L.A, qty: 60 }] }), 201);
    ok(await carlos.post(`/contracts/${cid}/commitment-control/commitments`, { number: `${year}NE000002`, issuedOn: `${year}-01-10`, sourceId: S.mun, items: [{ lineId: L.A, qty: 30 }] }), 201);
    // cada fonte paga a sua parte: 40 → 24 estadual + 16 municipal; depois 50 → 30 + 20, mas a municipal só tem 14
    const m1 = ok(await carlos.post(`/contracts/${cid}/measurements`, { competence: comp, kind: 'mensal', title: 'Medição 1', items: [{ lineId: L.A, qty: 40 }] }), 201).json();
    const m2 = ok(await carlos.post(`/contracts/${cid}/measurements`, { competence: comp, kind: 'mensal', title: 'Medição 2', items: [{ lineId: L.A, qty: 50 }] }), 201).json();
    const g2 = await get();
    const neOf = (n: string) => g2.commitments.find((c) => c.number === n)!.items[0]!.id;
    const it1 = g2.measurements.find((m) => m.id === m1.id)!.items[0]!;
    expect(it1.allocations).toEqual(expect.arrayContaining([{ commitmentItemId: neOf(`${year}NE000001`), qty4: 240_000 }, { commitmentItemId: neOf(`${year}NE000002`), qty4: 160_000 }]));
    expect(g2.measurements.find((m) => m.id === m2.id)!.items[0]!.uncovered4).toBe(60_000);
    expect(m2.uncoveredV4).toBe(6 * 100_000);
  });

  it('reajuste: tabela nova, medições abertas no preço novo e retroativo das faturadas até a NF complementar', async () => {
    let g = await get();
    const m1 = g.measurements.find((m) => m.title === 'Medição 1')!;
    ok(await carlos.post(`/contracts/${cid}/measurements/${m1.id}/status`, { action: 'atestar' }));
    ok(await carlos.post(`/contracts/${cid}/measurements/${m1.id}/status`, { action: 'faturar', invoiceNumber: 'NF 77', invoiceDate: `${comp}-10` }));
    const body = { indexName: 'IPCA', mode: 'percentual', index: '10', baseDate: `${year}-01-10`, startCompetence: comp };
    ok(await carlos.post(`/contracts/${cid}/commitment-control/adjustments/preview`, { ...body, index: '10,12345' }), 422);
    // manter o preço das medições abertas: nada é repassado e a medição 2 também entra no retroativo
    const keep = ok(await carlos.post(`/contracts/${cid}/commitment-control/adjustments/preview`, { ...body, repriceOpen: false })).json();
    expect(keep).toMatchObject({ repriced: 0, retroTotalV4: 40 * 10_000 + 50 * 10_000 });
    const pv = ok(await carlos.post(`/contracts/${cid}/commitment-control/adjustments/preview`, body)).json();
    expect(pv.table.find((t: { lineId: string }) => t.lineId === L.A)).toMatchObject({ oldPrice4: 100_000, newPrice4: 110_000 });
    expect(pv).toMatchObject({ retroTotalV4: 40 * 10_000, repriced: 1 });
    expect(pv.retro[0]).toMatchObject({ measurementId: m1.id, diffV4: 400_000 });
    const a = ok(await carlos.post(`/contracts/${cid}/commitment-control/adjustments`, { ...body, note: 'Apostilamento 1' }), 201).json();
    expect(a.retroTotalV4).toBe(400_000);
    ok(await carlos.post(`/contracts/${cid}/commitment-control/adjustments`, body), 422); // mesma competência de início
    g = await get();
    expect(g.lines.find((l) => l.id === L.A)!.price4).toBe(110_000);
    expect(g.measurements.find((m) => m.title === 'Medição 2')!.items[0]!.price4).toBe(110_000);
    const retro = g.pendencias.find((p) => p.kind === 'retroativo')!;
    expect(retro.valueV4).toBe(400_000);
    expect(g.totals.invoiced).toBe(40 * 110_000 - 400_000);
    expect(g.alerts.map((x) => x.key)).toContain('retroativo');
    // empenho em R$: a municipal empenhou 30 × R$ 10 e já consumiu 30 × R$ 11 → falta R$ 30 de reforço de valor
    const mun = g.commitments.find((c) => c.number === `${year}NE000002`)! as unknown as { items: { id: string }[]; valueV4: number; balanceV4: number };
    expect(mun.valueV4).toBe(300 * 10_000);
    expect(mun.balanceV4).toBe(-30 * 10_000);
    expect(g.alerts.map((x) => x.key)).toContain('empenho_valor');
    expect(g.pendencias.find((p) => p.kind === 'reforco_valor')!.valueV4).toBe(30 * 10_000);
    ok(await carlos.post(`/contracts/${cid}/commitment-items/${mun.items[0]!.id}/moves`, { kind: 'reforco_valor', occurredOn: `${comp}-15`, reason: 'Reforço de valor após o reajuste' }), 422);
    ok(await carlos.post(`/contracts/${cid}/commitment-items/${mun.items[0]!.id}/moves`, { kind: 'reforco_valor', value: 30, occurredOn: `${comp}-15`, reason: 'Reforço de valor após o reajuste' }), 201);
    g = await get();
    expect(g.pendencias.some((p) => p.kind === 'reforco_valor')).toBe(false);
    expect(g.alerts.map((x) => x.key)).not.toContain('empenho_valor');
    // nova medição já sai pelo preço reajustado
    const m3 = ok(await carlos.post(`/contracts/${cid}/measurements`, { competence: comp, kind: 'avulsa', title: 'Medição 3', items: [{ lineId: L.B, qty: 1 }] }), 201).json();
    expect(m3.uncoveredV4).toBe(110 * 10_000);
    ok(await carlos.post(`/contracts/${cid}/commitment-control/retros/invoice`, { ids: [retro.retroId], invoiceNumber: 'NF 78-C', invoiceDate: `${comp}-20` }));
    g = await get();
    expect(g.pendencias.some((p) => p.kind === 'retroativo')).toBe(false);
    expect(g.totals.invoiced).toBe(40 * 110_000);
  });

  it('aditivo de quantidade do item e virada de exercício com NE antiga → NE nova', async () => {
    ok(await carlos.post(`/contracts/${cid}/lines/${L.B}/moves`, { kind: 'supressao', qty: 60, effectiveOn: `${year}-06-01`, reason: 'Supressão de 25%' }), 422);
    ok(await carlos.post(`/contracts/${cid}/lines/${L.A}/moves`, { kind: 'acrescimo', qty: 12, effectiveOn: `${year}-06-01`, reason: 'Acréscimo de 10%', reference: '1º termo aditivo' }), 201);
    let g = await get();
    expect(g.lines.find((l) => l.id === L.A)!.balance.contracted4).toBe(132 * 10_000);
    const ne1 = g.commitments.find((c) => c.number === `${year}NE000001`)!;
    const item = ne1.items[0]!;
    expect(item.balance4).toBe(60_000); // 60 − 24 − 30
    // reempenhar sem suprimir passa do que falta empenhar? 132 − 90 = 42: cabe; o teste é a rastreabilidade
    ok(await carlos.post(`/contracts/${cid}/commitment-control/rollover`, { year, occurredOn: `${year}-12-31`, reason: 'Virada do exercício', items: [{ commitmentItemId: item.id, qty: 7 }] }), 422);
    const r = ok(await carlos.post(`/contracts/${cid}/commitment-control/rollover`, { year, occurredOn: `${year}-12-31`, reason: 'Virada do exercício', items: [{ commitmentItemId: item.id, qty: 6 }], newCommitment: { number: `${year + 1}NE000010`, issuedOn: `${year + 1}-01-05`, sourceId: S.est, items: [{ lineId: L.A, qty: 6, code: '460319-2' }] } }), 201).json();
    // em quantidade sobravam 6, mas em R$ só R$ 6 (600 empenhados − 594 consumidos no preço reajustado)
    expect(r.suppressedV4).toBe(6 * 10_000);
    g = await get();
    const old = g.commitments.find((c) => c.number === `${year}NE000001`)!;
    const nw = g.commitments.find((c) => c.number === `${year + 1}NE000010`)!;
    expect(old).toMatchObject({ balanceV4: 0, suppressedV4: 6 * 10_000, reempenhadaEm: [{ number: `${year + 1}NE000010` }] });
    expect(nw.substitui).toEqual([{ number: `${year}NE000001`, id: old.id }]);
    // NE do ano seguinte não cobre medição deste ano
    expect(g.lines.find((l) => l.id === L.A)!.balance.committed4).toBe((60 - 6 + 30 + 6) * 10_000);
    // supressão sem NE nova e vínculo depois
    const ne2 = g.commitments.find((c) => c.number === `${year}NE000002`)!;
    expect(ne2.items[0]!.balance4).toBe(0); // municipal esgotou na medição 2
    ok(await carlos.post(`/contracts/${cid}/commitment-control/rollover/link`, { year, commitmentId: nw.id }), 422);
  });

  it('carteira: o contrato aparece com os saldos e o que está em risco', async () => {
    const r = ok(await carlos.get('/contracts/commitment-portfolio')).json();
    const row = r.items.find((x: { id: string }) => x.id === cid);
    expect(row).toMatchObject({ number: 'CTR-107/2025', agency: 'Secretaria Fictícia', lines: 2 });
    expect(row.totals.contracted).toBeGreaterThan(0);
    expect(row.pendingV4).toBeGreaterThan(0); // medição 2 e 3 sem empenho
  });

  it('projeção, curva e alertas parametrizados', async () => {
    const g = await get();
    expect(g.projection.lines).toHaveLength(2);
    expect(g.projection.years.length).toBeGreaterThanOrEqual(2);
    expect(g.curve.length).toBeGreaterThan(0);
    // limite de 20% a empenhar: B (R$ 5.000) e o acréscimo de A estão sem empenho
    expect(g.alerts.map((a) => a.key)).toContain('a_empenhar');
  });
});
